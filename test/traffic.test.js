import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { SQLiteStore } from "../src/sqlite-store.js";
import { SecrexStore } from "../src/secrex-store.js";

const HOUR = 3600000;
const DAY = 24 * HOUR;

test("counts successful page GETs, shares counters across slots, and keeps operations totals local", async t => {
  const directory = await mkdtemp(join(tmpdir(), "scaletag-traffic-"));
  let now = Date.UTC(2026, 10, 22, 6);
  const clock = () => now;
  const primary = new SQLiteStore(directory, { clock });
  const standby = new SQLiteStore(directory, { clock });
  const secrex = new SecrexStore(directory, { clock });
  await primary.init();
  await standby.init();
  await secrex.init();

  const servers = [primary, standby].map(store =>
    createServer(createApp(store, { secrex })).listen(0, "127.0.0.1"));
  await Promise.all(servers.map(server => once(server, "listening")));
  t.after(async () => {
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    primary.close();
    standby.close();
    secrex.close();
    await rm(directory, { recursive: true, force: true });
  });
  const request = (path, options, slot = 0) =>
    fetch(`http://127.0.0.1:${servers[slot].address().port}${path}`, options);
  const statusWithHeaders = (path, headers) => new Promise((resolve, reject) => {
    get({ host: "127.0.0.1", port: servers[0].address().port, path, headers }, response => {
      response.resume();
      resolve(response.statusCode);
    }).on("error", reject);
  });
  const json = async (path, slot = 0) => {
    const response = await request(path, undefined, slot);
    assert.equal(response.status, 200, path);
    return response.json();
  };

  const input = { title: "Public post", description: "", signature: "", images: [], location: { latitude: 0, longitude: 0 } };
  const poll = await primary.create({ ...input, type: "poll", options: ["Yes", "No"] });
  const task = await primary.create({ ...input, type: "task", options: [], authKey: "a".repeat(64) });
  const giveaway = await primary.create({ ...input, type: "sale", giveawayVersion: 1, options: [] });
  await secrex.create({ id: "public-test-id", claim: "not-a-real-credential" });
  secrex.finish("public-test-id", now, "destroyed");

  assert.equal((await request("/")).status, 200);
  assert.equal(await statusWithHeaders("/", { "If-Modified-Since": new Date(Date.now() + HOUR).toUTCString() }), 304);
  assert.equal((await request(`/vote/${poll.id}`, undefined, 1)).status, 200);
  assert.equal((await request(`/task/${task.id}`)).status, 200);
  assert.equal((await request(`/sale/${giveaway.id}`, undefined, 1)).status, 200);
  assert.equal((await request(`/task/${task.id}/manage`)).status, 200);
  assert.equal((await request("/", { method: "HEAD" })).status, 200);
  assert.equal((await request("/", { headers: { "Sec-Purpose": "prefetch" } })).status, 200);
  assert.equal((await request("/locale.js")).status, 200);
  assert.equal((await request(`/vote/${"0".repeat(24)}`)).status, 404);
  assert.deepEqual(await json("/api/visits", 1), { days7: 5, days30: 5 });
  assert.deepEqual(await json(`/api/visits/poll/${poll.id}`), { days7: 1, days30: 1 });
  assert.deepEqual(await json(`/api/visits/task/${task.id}`, 1), { days7: 1, days30: 1 });
  assert.deepEqual(await json(`/api/visits/giveaway/${giveaway.id}`), { days7: 1, days30: 1 });
  assert.equal((await request(`/api/visits/task/${poll.id}`)).status, 404);
  assert.equal((await request("/api/stats", { headers: { "CF-Ray": "public-request" } })).status, 404);
  assert.equal(await statusWithHeaders("/api/stats", { Host: "example.com" }), 404);

  const first = await json("/api/stats");
  const created = { polls: 1, tasks: 1, giveaways: 1, secrex: 1 };
  assert.deepEqual(first.days7, { visits: 5, created });
  assert.deepEqual(first.days30, { visits: 5, created });
  assert.equal(first.collectionStartedAt, new Date(now).toISOString());
  assert.equal(JSON.stringify(first).includes("public-test-id"), false);

  now += 7 * DAY;
  assert.equal((await request(`/vote/${poll.id}`)).status, 200);
  const later = await json("/api/stats");
  assert.deepEqual(later.days7, { visits: 1, created: { polls: 0, tasks: 0, giveaways: 0, secrex: 0 } });
  assert.deepEqual(later.days30, { visits: 6, created });
  now += 23 * DAY;
  await primary.traffic.sweep(now);
  assert.deepEqual(await json("/api/visits", 1), { days7: 0, days30: 1 });
});
