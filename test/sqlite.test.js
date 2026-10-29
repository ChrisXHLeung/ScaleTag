import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { once } from "node:events";
import { SQLiteStore } from "../src/sqlite-store.js";
import { DAY } from "../src/store.js";
import { createApp } from "../src/app.js";

const input = {
  title: "Shared data", options: ["A", "B"], description: "", signature: "",
  images: [], location: { latitude: 43, longitude: -79 }, mapVisible: true,
};
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "scaletag-sqlite-"));
  const a = new SQLiteStore(dir, options), b = new SQLiteStore(dir, options);
  await a.init(); await b.init();
  t.after(async () => { a.close(); b.close(); await rm(dir, { recursive: true, force: true }); });
  return { a, b, dir };
}

test("SQLite shares fresh discovery, counters, contacts and deduplication between connections", async t => {
  const { a, b } = await fixture(t);
  const poll = await a.create(input);
  assert.equal(b.list().polls[0].id, poll.id);
  assert.equal(b.map().polls[0].id, poll.id);
  await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).vote(poll.id, `v${i}`, 1)));
  assert.equal((await b.get(poll.id)).totalVotes, 20);
  await assert.rejects(a.vote(poll.id, "v0", 1), { status: 409 });
  await Promise.all([a.like(poll.id, "same"), b.like(poll.id, "same")]);
  assert.equal((await a.getSocial(poll.id, "same")).totalLikes, 1);
  const task = await b.create({ ...input, type: "task", options: [], reward: "Coffee" });
  await a.reply(task.id, "helper", { message: "Available", email: "helper@example.com" });
  assert.equal((await b.getSocial(task.id)).replies[0].email, "helper@example.com");
  await assert.rejects(b.reply(task.id, "helper", { message: "Again" }), { status: 429 });
  assert.equal(a.list({ type: "task" }).polls[0].replyCount, 1);
});

test("SQLite locks read-modify-write across independent Node processes", async t => {
  const { a, dir } = await fixture(t);
  const post = await a.create(input);
  const code = `
    import {SQLiteStore} from './src/sqlite-store.js';
    const s=new SQLiteStore(process.argv[1]);await s.init();
    for(let i=0;i<15;i++)await s.vote(process.argv[2],process.argv[3]+i,1);
    await s.like(process.argv[2],'same-browser');s.close();
  `;
  const children = ["first", "second"].map(prefix => spawn(process.execPath,
    ["--input-type=module", "-e", code, dir, post.id, prefix], { stdio: ["ignore", "pipe", "pipe"] }));
  await Promise.all(children.map(async child => {
    let errors = ""; child.stderr.on("data", data => errors += data);
    const [code] = await once(child, "exit");
    assert.equal(code, 0, errors);
  }));
  assert.equal((await a.get(post.id)).totalVotes, 30);
  assert.equal((await a.getSocial(post.id)).totalLikes, 1);
});

test("SQLite transactions roll back partial mutations and share resource limits", async t => {
  const { a, b } = await fixture(t, { maxPolls: 1 });
  const post = await a.create(input);
  await assert.rejects(b.create(input), { status: 503 });
  await assert.rejects(a.exclusive("test", () => {
    a.remove(post.id); throw Error("abort");
  }));
  assert.equal((await b.get(post.id)).id, post.id);
  assert.equal(await a.consumeLimit("create", 2), true);
  assert.equal(await b.consumeLimit("create", 2), true);
  assert.equal(await a.consumeLimit("create", 2), false);
});

test("SQLite enforces seven/30-day expiry and prunes closed-poll identifiers", async t => {
  let now = Date.now();
  const { a, b } = await fixture(t, { clock: () => now });
  const p = await a.create(input);
  await b.vote(p.id, "voter", 1);
  now += 7 * DAY;
  await assert.rejects(a.vote(p.id, "new", 1), { status: 409 });
  await b.sweep();
  assert.deepEqual(a.read(p.id).data.voters, {});
  now += 23 * DAY;
  assert.equal(b.list().polls.length, 0);
  await assert.rejects(a.get(p.id), { status: 404 });
  await b.sweep();
  assert.equal(a.read(p.id).data, null);
});

test("JSON import is explicit, atomic, idempotent and preserves source and timestamps", async t => {
  const { a, b, dir } = await fixture(t);
  const original = await a.create(input);
  const raw = JSON.stringify(a.read(original.id).data);
  a.remove(original.id);
  await writeFile(join(dir, `${original.id}.json`), raw);
  const rejected = new SQLiteStore(dir);
  await assert.rejects(rejected.init(), /Legacy JSON/);
  const migrate = () => execFileSync(process.execPath, ["src/migrate-sqlite.js"], {
    env: { ...process.env, DATA_DIR: dir }, encoding: "utf8",
  });
  const invalid = join(dir, `${"f".repeat(24)}.json`);
  await writeFile(invalid, JSON.stringify({ id: "f".repeat(24) }));
  assert.notEqual(spawnSync(process.execPath, ["src/migrate-sqlite.js"], {
    env: { ...process.env, DATA_DIR: dir }, stdio: "ignore",
  }).status, 0);
  assert.equal(b.count(), 0);
  await rm(invalid);
  assert.match(migrate(), /Imported 1 live posts/);
  assert.equal((await b.get(original.id)).createdAt, original.createdAt);
  assert.equal(await readFile(join(dir, `${original.id}.json`), "utf8"), raw);
  assert.match(migrate(), /already completed/);
  assert.equal(b.list().polls.length, 1);
  execFileSync(process.execPath, ["src/migrate-sqlite.js", "--remove-source"], {
    env: { ...process.env, DATA_DIR: dir }, stdio: "ignore",
  });
  await assert.rejects(readFile(join(dir, `${original.id}.json`)), { code: "ENOENT" });
});

test("SQLite recovers a killed writer without publishing its uncommitted changes", async t => {
  const { a, dir } = await fixture(t);
  const post = await a.create(input);
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import {DatabaseSync} from 'node:sqlite';
    const db=new DatabaseSync(process.argv[1]);
    db.exec('BEGIN IMMEDIATE');
    db.prepare("UPDATE posts SET document=json_set(document,'$.totalVotes',999)").run();
    process.kill(process.pid,'SIGKILL');
  `, join(dir, "scaletag.sqlite")], { stdio: "ignore" });
  assert.equal(child.signal, "SIGKILL");
  assert.equal((await a.get(post.id)).totalVotes, 0);
  await a.vote(post.id, "after-recovery", 1);
  assert.equal((await a.get(post.id)).totalVotes, 1);
});

test("readiness reflects storage access and includes instance/revision for the demo", async t => {
  const { a } = await fixture(t);
  const server = createApp(a, { instance: "app2", revision: "test", ready: () => a.ready() }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(r => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}/readyz`;
  assert.deepEqual(await (await fetch(url)).json(), { status: "ok", instance: "app2", revision: "test" });
  a.close();
  assert.equal((await fetch(url)).status, 503);
});
