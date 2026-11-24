import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { PollStore } from "../src/store.js";
import { SQLiteStore } from "../src/sqlite-store.js";
import { createTaskCredentials } from "../public/task-crypto.js";

const origin = "https://scaletag.test";
const location = { latitude: 43.65, longitude: -79.38 };
const input = {
  title: "Community notice",
  description: "Meet in the neighborhood",
  options: ["Morning", "Evening"],
  signature: "Neighbor",
  retentionAccepted: true,
};

async function fixture(t, Store) {
  const dir = await mkdtemp(join(tmpdir(), "scaletag-discovery-"));
  const store = new Store(dir);
  await store.init();
  const server = createApp(store, { origin, createLimit: 100 }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    store.close?.();
    await rm(dir, { recursive: true, force: true });
  });
  const request = (path, body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, body === undefined
    ? {} : { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  async function publish(type, props) {
    const response = await request(`/api/${type}s`, { ...input, ...props });
    assert.equal(response.status, 201);
    return response.json();
  }
  return { store, request, publish };
}

for (const Store of [PollStore, SQLiteStore]) {
  test(`${Store.name}: link-only posts can be shared without GPS and stay out of discovery`, async t => {
    const { store, request, publish } = await fixture(t, Store);
    const publicPost = await publish("poll", { location, mapVisible: true });
    const { authKey, contactPublicKey, encryptedPrivateKey } = await createTaskCredentials();
    const entries = [
      ["poll", "vote", "poll", { mapVisible: true }],
      ["task", "task", "task", { mapVisible: true, location, reward: "Coffee", authKey, contactPublicKey, encryptedPrivateKey }],
      ["sale", "sale", "giveaway", { mapVisible: true, location, pickupLocation: "Library entrance" }],
    ];
    for (const [type, page, visitsType, props] of entries) {
      const post = await publish(type, { ...props, visibility: "unlisted" });
      assert.equal(post.visibility, "unlisted");
      const saved = (await store.read(post.id)).data;
      assert.equal(saved.mapVisible, false);
      assert.equal(Object.hasOwn(saved, "location"), false);
      const html = await request(`/${page}/${post.id}`);
      assert.equal(html.headers.get("set-cookie"), null);
      assert.equal((await request(`/api/visits/${visitsType}/${post.id}`)).status, 404);
      for (const path of [`/${page}/${post.id}`, `/api/${type}s/${post.id}`, `/api/${type}s/${post.id}/qr.png`, `/api/posts/${post.id}/social`]) {
        const response = await request(path);
        assert.equal(response.status, 200);
        assert.match(response.headers.get("x-robots-tag"), /noindex/);
      }
    }
    for (const [path, body] of [
      ["/api/posts"], ["/api/polls"], ["/api/posts/search", {}],
      ["/api/polls/search", { location, sort: "nearest" }],
      ["/api/posts/search", { query: "community" }], ["/api/map/search", {}],
    ]) {
      const { polls } = await (await request(path, body)).json();
      assert.deepEqual(polls.map(poll => poll.id), [publicPost.id]);
    }
    assert.equal(store.count(), 1);
    assert.equal((await request("/api/polls", { ...input, visibility: "bogus", location })).status, 400);
    assert.equal((await request("/api/polls", input)).status, 400);
  });

  test(`${Store.name}: keyword search combines type, status, distance and pagination`, async t => {
    const { request, publish } = await fixture(t, Store);
    const wanted = await publish("poll", { title: "Weekly discussion", description: "共享花园 CHAIR repair", location, mapVisible: true });
    await publish("poll", { title: "Different post", description: "花园 tools", location, mapVisible: true });
    await publish("poll", { title: "遠方花园 chair", location: { latitude: 50, longitude: 10 }, mapVisible: true });
    await publish("sale", { title: "花园 chair", pickupLocation: "Library entrance", location, mapVisible: true });
    const query = { query: "花园 ｃｈＡｉＲ", location, radiusKm: 2, sort: "nearest", type: "poll", status: "open" };
    const list = await (await request("/api/posts/search", query)).json();
    assert.deepEqual(list.polls.map(post => post.id), [wanted.id]);
    const map = await (await request("/api/map/search", query)).json();
    assert.deepEqual(map.polls.map(post => post.id), [wanted.id]);
    for (const path of ["/api/posts/search", "/api/map/search"]) {
      assert.equal((await request(path, { query: ["chair"] })).status, 400);
      assert.equal((await request(path, { query: "花".repeat(121) })).status, 400);
    }
    const expected = new Set();
    for (let i = 0; i < 22; i++) {
      const post = await publish("poll", { title: `Pagination example ${i}`, location });
      expected.add(post.id);
    }
    const search = { query: "Pagination example", location, sort: "nearest", radiusKm: 2 };
    const first = await (await request("/api/posts/search", search)).json();
    assert.equal(first.polls.length, 20);
    const second = await (await request("/api/posts/search", { ...search, cursor: first.nextCursor })).json();
    assert.equal(second.polls.length, 2);
    assert.equal(second.nextCursor, null);
    assert.deepEqual(new Set([...first.polls, ...second.polls].map(post => post.id)), expected);
  });

  test(`${Store.name}: pickup-now search applies window and hold boundaries in List and Map`, async t => {
    const { store, request, publish } = await fixture(t, Store);
    const start = Math.floor(Date.now() / 60000) * 60000;
    let now = start;
    store.clock = () => now;
    const sale = (title, pickupWindow, extra = {}) => publish("sale", {
      title, pickupLocation: "Library entrance", location, mapVisible: true, pickupWindow, ...extra,
    });
    const current = await sale("Garden chair", { startsAt: start, endsAt: start + 5000 });
    const later = await sale("Garden table", { startsAt: start + 5000, endsAt: start + 15000 });
    const held = await sale("Garden tools", { startsAt: start, endsAt: start + 17000 });
    await store.setSaleState(held.id, held.manageKey, "reserved", start + 10000);
    const unknown = await sale("Garden rake");
    await sale("Other item", { startsAt: start, endsAt: start + 1000 });
    await sale("Private garden stool", { startsAt: start, endsAt: start + 1000 }, { visibility: "unlisted" });
    await publish("poll", { title: "Garden poll", location, mapVisible: true });

    for (const [offset, ids, refreshAfterMs] of [
      [0, [current.id], 5000],
      [5000, [later.id], 5000],
      [10000, [later.id, held.id], 5000],
      [15000, [held.id], 2000],
      [17000, [], undefined],
    ]) {
      now = start + offset;
      for (const path of ["/api/posts/search", "/api/map/search"]) {
        const response = await request(path, { query: "garden", pickup: "now", location, radiusKm: 2 });
        assert.equal(response.status, 200);
        const data = await response.json();
        assert.deepEqual(new Set(data.polls.map(post => post.id)), new Set(ids));
        assert.equal(data.refreshAfterMs, refreshAfterMs);
      }
    }
    const response = await request("/api/posts/search", { type: "sale", query: "garden" });
    assert.ok((await response.json()).polls.some(post => post.id === unknown.id));
    assert.equal((await request("/api/posts?pickup=tomorrow")).status, 400);
    assert.equal((await request("/api/map/search", { pickup: ["now"] })).status, 400);
  });
}

test("offline.html and base.css enforce skip-link landmark and reduced-motion accessibility rules", async () => {
  const [offlineHtml, offlineJs, baseCss] = await Promise.all([
    readFile(new URL("../public/offline.html", import.meta.url), "utf8"),
    readFile(new URL("../public/offline.js", import.meta.url), "utf8"),
    readFile(new URL("../public/base.css", import.meta.url), "utf8"),
  ]);
  assert.match(offlineHtml, /<a\s+class="skip-link"\s+href="#main">Skip to content<\/a>/);
  assert.match(offlineHtml, /<main\s+id="main"\s+tabindex="-1">/);
  assert.match(offlineJs, /\.skip-link/);
  assert.match(offlineJs, /t\("Skip to content",\s*"跳至内容"\)/);
  assert.match(baseCss, /\.skip-link\s*\{[^}]*z-index:\s*100;[^}]*\}/);
  assert.match(baseCss, /\.skip-link\s*\{[^}]*transform:\s*translateY\(-200%\);[^}]*\}/);
  assert.match(baseCss, /\.skip-link:focus\s*\{[^}]*transform:\s*none;[^}]*\}/);
  assert.match(baseCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\*,\s*\*::before,\s*\*::after\s*\{[\s\S]*?animation:\s*none\s*!important;/);
  assert.match(baseCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.button:hover:not\(:disabled\),\s*\.poll-list-card:hover\s*\{\s*transform:\s*none;\s*\}/);
});
