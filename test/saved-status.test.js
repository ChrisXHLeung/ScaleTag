import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskCredentials } from "../public/task-crypto.js";
import { createApp } from "../src/app.js";
import { PollStore, DAY } from "../src/store.js";
import { SQLiteStore } from "../src/sqlite-store.js";

for (const Store of [PollStore, SQLiteStore]) {
  test(`${Store.name}: saved lookups return only public status for canonical post references`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "scaletag-saved-status-"));
    const origin = "https://scaletag.test";
    let now = Date.now();
    const store = new Store(directory, { clock: () => now });
    await store.init();
    const server = createApp(store, { origin }).listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(async () => {
      await new Promise(resolve => server.close(resolve));
      store.close?.();
      await rm(directory, { recursive: true, force: true });
    });
    const url = `http://127.0.0.1:${server.address().port}/api/posts/statuses`;
    const request = (posts, requestOrigin = origin) => fetch(url, {
      method: "POST", headers: { origin: requestOrigin, "content-type": "application/json" },
      body: JSON.stringify({ posts }),
    });

    const options = { title: "Local status test", options: ["A", "B"], signature: "Test", images: [] };
    const open = await store.create({ ...options, visibility: "unlisted", resultsVisibility: "after_close" });
    const closed = await store.create(options);
    await store.setPollState(closed.id, closed.manageKey, "closed");
    const withdrawn = await store.create(options);
    await store.setPollState(withdrawn.id, withdrawn.manageKey, "withdrawn");
    const frozen = await store.create(options);
    for (let i = 0; i < 6; i++) await store.report(frozen.id, `reporter-${i}`);
    const { authKey, contactPublicKey, encryptedPrivateKey } = await createTaskCredentials();
    const task = await store.create({ ...options, type: "task", authKey, contactPublicKey, encryptedPrivateKey });
    const reply = await store.reply(task.id, "applicant", { message: "I can help.", encryptedContact: {} });
    await store.setTaskAssignment(task.id, authKey, reply.replies[0].id);
    const giveaway = await store.create({ ...options, type: "sale", giveawayVersion: 1 });
    await store.setSaleState(giveaway.id, giveaway.manageKey, "claimed");
    const held = await store.create({ ...options, type: "sale", giveawayVersion: 1 });
    await store.setSaleState(held.id, held.manageKey, "reserved", now + 7200000);

    const posts = [
      { type: "poll", id: open.id }, { type: "poll", id: closed.id },
      { type: "task", id: task.id }, { type: "sale", id: giveaway.id },
      { type: "poll", id: withdrawn.id }, { type: "poll", id: frozen.id },
      { type: "sale", id: closed.id }, { type: "poll", id: "0".repeat(24) },
      { type: "sale", id: held.id },
    ];
    const response = await request(posts);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(await response.json(), {
      statuses: ["poll_open", "poll_final", "task_assigned", "sale_claimed",
        "unavailable", "unavailable", "unavailable", "unavailable", "sale_reserved"],
    });
    assert.equal((await request(posts, "https://other.test")).status, 403);
    assert.equal((await request(Array(21).fill(posts[0]))).status, 400);
    assert.equal((await request([{ type: "secrex", id: open.id }])).status, 400);
    assert.equal((await request([{ type: "poll", id: "https://other.test/" }])).status, 400);
    now += 7200000;
    assert.deepEqual(await (await request([posts.at(-1)])).json(), { statuses: ["sale_open"] });
    now += 3 * DAY;
    assert.deepEqual(await (await request([posts[3]])).json(), { statuses: ["unavailable"] });
  });
}
