import { once } from "node:events";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { createApp } from "../src/app.js";
import { SQLiteStore } from "../src/sqlite-store.js";

const run = promisify(execFile);

async function fixture(t, reportReviewEnabled) {
  const directory = await mkdtemp(join(tmpdir(), "scaletag-reports-"));
  const store = new SQLiteStore(directory, { reportReviewEnabled });
  await store.init();
  const origin = "https://scaletag.test";
  const server = createApp(store, { origin }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const photo = await readFile(new URL("../public/icons/icon-192.png", import.meta.url));
  const poll = await store.create({ type: "poll", title: "Evening meeting", description: "Where should we meet?", options: ["Hall", "Library"], location: { latitude: 1, longitude: 1 }, images: [`data:image/png;base64,${photo.toString("base64")}`] });
  const prefix = `/api/posts/${poll.id}`;
  const get = (path) => fetch(base + path);
  async function session() {
    const response = await get(`${prefix}/social`);
    return { cookie: response.headers.get("set-cookie").split(";")[0], body: await response.json() };
  }
  const report = (cookie, body = {}) => fetch(base + `${prefix}/reports`, {
    method: "POST", headers: { origin, cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { directory, store, poll, photo, get, session, report };
}

test("report review is off by default and keeps anonymous automatic freezing", async (t) => {
  const f = await fixture(t);
  const first = await f.session();
  assert.equal(first.body.reportReviewEnabled, undefined);
  assert.deepEqual(await (await f.report(first.cookie, { reason: "privacy" })).json(), { hasReported: true, frozen: false });
  for (let i = 1; i < 6; i++) {
    const { cookie } = await f.session();
    const result = await (await f.report(cookie)).json();
    assert.equal(result.frozen, i === 5);
  }
  assert.equal((await f.get(`/vote/${f.poll.id}`)).status, 404);
  assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM post_report_reasons").get().n, 0);
});

test("opt-in report reasons stay private and a local reviewer can restore a frozen post", async (t) => {
  const f = await fixture(t, true);
  const first = await f.session();
  assert.equal(first.body.reportReviewEnabled, true);
  assert.equal((await f.report(first.cookie, { reason: "text is not a reason" })).status, 400);
  assert.equal((await f.report(first.cookie, { reason: "privacy" })).status, 200);
  assert.equal((await f.report(first.cookie, { reason: "spam" })).status, 200);
  const before = await (await f.get(`/api/polls/${f.poll.id}`)).json();
  assert.equal(Object.hasOwn(before, "reportHashes"), false);
  assert.equal(JSON.stringify(before).includes("privacy"), false);
  for (let i = 1; i < 6; i++) {
    const { cookie } = await f.session();
    await f.report(cookie, i === 1 ? {} : { reason: "spam" });
  }
  assert.equal((await f.get(`/vote/${f.poll.id}`)).status, 404);
  assert.equal((await f.get("/api/report-review")).status, 404);
  assert.equal((await (await f.get(`/api/polls/${f.poll.id}`)).json()).error, "This post is hidden after reports.");
  const { listFrozenReports, showFrozenReport, readFrozenPhoto, restoreFrozenReport } = await import("../src/report-review.js");
  const [entry] = listFrozenReports(f.store.db);
  assert.equal(entry.id, f.poll.id);
  assert.deepEqual(entry.reasons, { other: 1, privacy: 1, spam: 4 });
  const env = { ...process.env, DATA_DIR: f.directory };
  const cli = [process.execPath, ["src/report-review.js", "list"]];
  await assert.rejects(run(...cli, { env: { ...env, SCALETAG_REPORT_REVIEW: "0" } }), {
    code: 1, stderr: /Report review is disabled/,
  });
  const { stdout } = await run(...cli, { env: { ...env, SCALETAG_REPORT_REVIEW: "1" } });
  assert.deepEqual(JSON.parse(stdout), [entry]);
  const details = showFrozenReport(f.store.db, f.poll.id);
  assert.equal(details.description, "Where should we meet?");
  assert.deepEqual(details.photos, [{ number: 1, format: "png" }]);
  assert.deepEqual(readFrozenPhoto(f.store.db, f.poll.id, 1), f.photo);
  const output = await run(process.execPath, ["src/report-review.js", "photo", f.poll.id, "1"], {
    env: { ...env, SCALETAG_REPORT_REVIEW: "1" }, encoding: "buffer",
  });
  assert.deepEqual(output.stdout, f.photo);
  assert.equal(restoreFrozenReport(f.store.db, f.poll.id), true);
  assert.equal(restoreFrozenReport(f.store.db, f.poll.id), false);
  assert.equal((await f.get(`/vote/${f.poll.id}`)).status, 200);
  assert.deepEqual(listFrozenReports(f.store.db), []);
  await f.report(first.cookie, { reason: "privacy" });
  await f.store.exclusive(f.poll.id, () => f.store.remove(f.poll.id));
  assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM post_report_reasons").get().n, 0);
});
