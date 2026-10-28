import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  readdir,
  writeFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { PollStore, DAY, voterHash } from "../src/store.js";
import { createApp } from "../src/app.js";
import { pollInput, distanceKm } from "../src/validation.js";

const origin = "https://scaletag.test";
const input = (overrides = {}) => ({
  title: "A better neighborhood?",
  description: "Choose one.",
  signature: "Neighbor",
  options: ["More trees", "More benches"],
  images: [],
  location: { latitude: 43.6532, longitude: -79.3832 },
  retentionAccepted: true,
  ...overrides,
});
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "scaletag-test-"));
  let now = Date.UTC(2026, 9, 26, 12);
  const store = new PollStore(directory, { clock: () => now, ...options });
  await store.init();
  const server = createApp(store, {
    origin,
    createLimit: options.createLimit ?? 1000,
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const request = (path, data, cookie, headers = {}) =>
    fetch(url + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        ...(data === undefined
          ? {}
          : { origin, "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  async function create(overrides) {
    const r = await request("/api/polls", input(overrides));
    assert.equal(r.status, 201);
    return r.json();
  }
  async function session(id) {
    const r = await request(`/api/polls/${id}`);
    return r.headers.get("set-cookie").split(";")[0];
  }
  return {
    store,
    directory,
    request,
    create,
    session,
    now: () => now,
    advance: (delta) => {
      now += delta;
    },
  };
}

test("server controls duration; only validated fields are persisted; data is private", async (t) => {
  const f = await fixture(t);
  const p = await f.create({
    createdAt: 1,
    endsAt: 1,
    deleteAt: 1,
    voters: { injected: true },
    totalVotes: 500,
  });
  assert.equal(p.createdAt, f.now());
  assert.equal(p.endsAt - p.createdAt, 7 * DAY);
  assert.equal(p.deleteAt - p.createdAt, 30 * DAY);
  assert.equal(p.totalVotes, 0);
  assert.equal(p.location, undefined);
  assert.equal(p.voters, undefined);
  const disk = JSON.parse(
    await readFile(join(f.directory, `${p.id}.json`), "utf8"),
  );
  assert.deepEqual(disk.location, input().location);
  assert.deepEqual(disk.voters, {});
  assert.equal(
    (await stat(join(f.directory, `${p.id}.json`))).mode & 0o777,
    0o600,
  );
  const response = await f.request(`/api/polls/${p.id}`);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, new RegExp(`Path=/api/polls/${p.id}(;|$)`));
  assert.match(cookie, /Max-Age=604800/);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
});

test("missing GPS, multi-select, invalid input, and insecure image URLs are rejected", async (t) => {
  const f = await fixture(t);
  for (const body of [
    input({ location: null }),
    input({ location: { latitude: 100, longitude: 0 } }),
    input({ title: " " }),
    input({ options: ["same", " SAME "] }),
    input({ options: ["Only one"] }),
    input({ images: ["http://example.com/a.jpg"] }),
    input({ images: ["javascript:alert(1)"] }),
    input({ images: ["https://user:secret@example.com/a.jpg"] }),
    input({ retentionAccepted: false }),
  ]) {
    assert.equal((await f.request("/api/polls", body)).status, 400);
  }
  const p = await f.create();
  const cookie = await f.session(p.id);
  assert.equal(
    (await f.request(`/api/polls/${p.id}/votes`, { optionId: [1, 2] }, cookie))
      .status,
    400,
  );
  assert.equal(
    (await f.request(`/api/polls/${p.id}/votes`, { optionId: 99 }, cookie))
      .status,
    400,
  );
});

test("concurrent requests from one browser count exactly once", async (t) => {
  const f = await fixture(t);
  const p = await f.create();
  const cookie = await f.session(p.id);
  const replies = await Promise.all(
    Array.from({ length: 30 }, () =>
      f.request(`/api/polls/${p.id}/votes`, { optionId: 1 }, cookie),
    ),
  );
  assert.equal(replies.filter((r) => r.status === 200).length, 1);
  assert.equal(replies.filter((r) => r.status === 409).length, 29);
  const result = await (
    await f.request(`/api/polls/${p.id}`, undefined, cookie)
  ).json();
  assert.equal(result.totalVotes, 1);
  assert.equal(result.options[0].votes, 1);
  assert.equal(result.hasVoted, true);
});

test("concurrent distinct votes survive restart and sum correctly", async (t) => {
  const f = await fixture(t);
  const p = await f.create();
  const cookies = await Promise.all(
    Array.from({ length: 40 }, () => f.session(p.id)),
  );
  const replies = await Promise.all(
    cookies.map((cookie, i) =>
      f.request(`/api/polls/${p.id}/votes`, { optionId: (i % 2) + 1 }, cookie),
    ),
  );
  assert.ok(replies.every((r) => r.status === 200));
  const fresh = new PollStore(f.directory, { clock: f.now });
  await fresh.init();
  const result = await fresh.get(p.id);
  assert.equal(result.totalVotes, 40);
  assert.deepEqual(
    result.options.map((o) => o.votes),
    [20, 20],
  );
  const disk = await readFile(join(f.directory, `${p.id}.json`), "utf8");
  for (const cookie of cookies) {
    const token = cookie.split("=")[1];
    assert.ok(!disk.includes(token));
    assert.ok(disk.includes(voterHash(token)));
  }
  assert.ok(!disk.includes("ipAddress"));
});

test("cookies differ between polls and a cookie from another poll cannot cast a vote", async (t) => {
  const f = await fixture(t);
  const a = await f.create(),
    b = await f.create();
  const ca = await f.session(a.id),
    cb = await f.session(b.id);
  assert.notEqual(ca, cb);
  assert.equal(
    (await f.request(`/api/polls/${b.id}/votes`, { optionId: 1 }, ca)).status,
    403,
  );
  assert.equal(
    (await f.request(`/api/polls/${b.id}/votes`, { optionId: 1 }, cb)).status,
    200,
  );
});

test("voting ends at exactly 168 hours; results and QR remain; identifiers are cleared", async (t) => {
  const f = await fixture(t);
  const p = await f.create();
  const cookie = await f.session(p.id);
  f.advance(7 * DAY - 1);
  assert.equal(
    (await f.request(`/api/polls/${p.id}/votes`, { optionId: 1 }, cookie))
      .status,
    200,
  );
  f.advance(1);
  const other = `st_${p.id}=${"a".repeat(64)}`;
  assert.equal(
    (await f.request(`/api/polls/${p.id}/votes`, { optionId: 2 }, other))
      .status,
    409,
  );
  const result = await (await f.request(`/api/polls/${p.id}`)).json();
  assert.equal(result.status, "closed");
  assert.equal(result.totalVotes, 1);
  assert.equal((await f.request(`/vote/${p.id}`)).status, 200);
  assert.equal((await f.request(`/api/polls/${p.id}/qr.png`)).status, 200);
  await f.store.sweep();
  const disk = JSON.parse(
    await readFile(join(f.directory, `${p.id}.json`), "utf8"),
  );
  assert.deepEqual(disk.voters, {});
  assert.equal(disk.totalVotes, 1);
});

test("30-day deletion removes JSON, list entry, original page, QR and crash leftovers", async (t) => {
  const f = await fixture(t);
  const p = await f.create();
  const b = await f.create();
  await writeFile(join(f.directory, `.${p.id}.json.tmp`), "{}");
  f.advance(30 * DAY);
  assert.equal((await (await f.request("/api/polls")).json()).polls.length, 0);
  assert.equal((await f.request(`/vote/${p.id}`)).status, 404);
  assert.equal((await f.request(`/api/polls/${p.id}/qr.png`)).status, 404);
  assert.equal((await f.request(`/api/polls/${p.id}`)).status, 404);
  await f.store.sweep();
  assert.deepEqual(await readdir(f.directory), []);
  assert.equal((await f.request(`/api/polls/${b.id}`)).status, 404);
});

test("startup clears expired records and abandoned atomic-write files", async (t) => {
  const f = await fixture(t);
  const p = await f.create();
  await writeFile(join(f.directory, `.${p.id}.json.tmp`), "{}");
  f.advance(30 * DAY);
  const fresh = new PollStore(f.directory, { clock: f.now });
  await fresh.init();
  assert.equal(fresh.list().polls.length, 0);
  assert.deepEqual(await readdir(f.directory), []);
});

test("VoteList sorts newest first; nearby is exactly 100 km; coordinates stay private", async (t) => {
  const f = await fixture(t);
  const base = { latitude: 0, longitude: 0 };
  const latitude = (km) => ((km / 6371.0088) * 180) / Math.PI;
  const a = await f.create({ location: base, title: "Oldest" });
  f.advance(1000);
  const b = await f.create({
    location: { latitude: latitude(99.99), longitude: 0 },
    title: "Within",
  });
  f.advance(1000);
  const c = await f.create({
    location: { latitude: latitude(100.01), longitude: 0 },
    title: "Outside",
  });
  assert.deepEqual(
    (await (await f.request("/api/polls")).json()).polls.map((p) => p.id),
    [c.id, b.id, a.id],
  );
  const nearby = await (
    await f.request("/api/polls/search", { location: base })
  ).json();
  assert.deepEqual(
    nearby.polls.map((p) => p.id),
    [b.id, a.id],
  );
  assert.ok(nearby.polls.every((p) => !("location" in p) && !("voters" in p)));
  assert.equal(distanceKm(base, base), 0);
  assert.ok(
    distanceKm(
      { latitude: 0, longitude: 179.9 },
      { latitude: 0, longitude: -179.9 },
    ) < 25,
  );
});

test("pagination has no duplicates at equal timestamps and rejects malformed cursors", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 25; i++) await f.create({ title: `Question ${i}` });
  const first = await (await f.request("/api/polls")).json();
  assert.equal(first.polls.length, 20);
  const second = await (
    await f.request("/api/polls/search", { cursor: first.nextCursor })
  ).json();
  assert.equal(second.polls.length, 5);
  assert.equal(
    new Set([...first.polls, ...second.polls].map((p) => p.id)).size,
    25,
  );
  assert.equal(second.nextCursor, null);
  assert.equal(
    (await f.request("/api/polls/search", { cursor: "not-a-cursor" })).status,
    400,
  );
});

test("origin enforcement, payload limits, cache policy and data path isolation", async (t) => {
  const f = await fixture(t);
  const p = await f.create();
  assert.equal(
    (
      await f.request("/api/polls", input(), undefined, {
        origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.request("/api/polls", input(), undefined, { origin: "" })).status,
    403,
  );
  assert.equal(
    (await f.request("/api/polls", input({ description: "x".repeat(30000) })))
      .status,
    413,
  );
  for (const path of [`/data/${p.id}.json`, "/.env", "/src/app.js"])
    assert.equal((await f.request(path)).status, 404);
  const page = await f.request("/");
  assert.match(
    page.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.equal(page.headers.get("cache-control"), "no-store, max-age=0");
});

test("QR download is a PNG with a safe filename", async (t) => {
  const f = await fixture(t);
  const p = await f.create();
  const r = await f.request(`/api/polls/${p.id}/qr.png?download=1`);
  assert.equal(r.headers.get("content-type"), "image/png");
  assert.match(
    r.headers.get("content-disposition"),
    /attachment; filename="ScaleTag-[a-f0-9]+.png"/,
  );
  assert.equal(
    Buffer.from(await r.arrayBuffer())
      .subarray(0, 8)
      .toString("hex"),
    "89504e470d0a1a0a",
  );
});

test("anonymous global creation limit caps resource usage without collecting IPs", async (t) => {
  const f = await fixture(t, { createLimit: 2 });
  await f.create();
  await f.create();
  assert.equal((await f.request("/api/polls", input())).status, 429);
  f.advance(60000);
  await f.create();
});

test("capacity limits reject extra data without changing existing vote totals", async (t) => {
  const f = await fixture(t, { maxPolls: 1, maxVotes: 1 });
  const p = await f.create();
  assert.equal((await f.request("/api/polls", input())).status, 503);
  const a = await f.session(p.id),
    b = await f.session(p.id);
  assert.equal(
    (await f.request(`/api/polls/${p.id}/votes`, { optionId: 1 }, a)).status,
    200,
  );
  assert.equal(
    (await f.request(`/api/polls/${p.id}/votes`, { optionId: 2 }, b)).status,
    503,
  );
  assert.equal((await f.store.get(p.id)).totalVotes, 1);
});

test("validation preserves plain text, never interprets HTML or mutable lifecycle fields", () => {
  const data = pollInput(
    input({
      title: "<img src=x onerror=alert(1)>",
      description: "<script>alert(1)</script>",
      endsAt: 0,
    }),
  );
  assert.equal(data.title, "<img src=x onerror=alert(1)>");
  assert.equal(data.endsAt, undefined);
});

test("low disk reserve rejects writes without creating partial poll records", async (t) => {
  const f = await fixture(t, { diskReserveBytes: Number.MAX_SAFE_INTEGER });
  assert.equal((await f.request("/api/polls", input())).status, 503);
  assert.equal(f.store.index.size, 0);
  assert.deepEqual(await readdir(f.directory), []);
});

test("map publishes only opted-in coarse locations; search stays private and expires on time", async (t) => {
  const f = await fixture(t);
  const legacy = await f.create();
  const exact = { latitude: 43.653256, longitude: -79.383289 };
  const mapped = await f.create({
    location: exact,
    mapVisible: true,
    title: "Mapped poll",
  });
  const distant = await f.create({
    mapVisible: true,
    location: { latitude: 49.2827, longitude: -123.1207 },
  });
  const response = await f.request("/api/map/search", { status: "all" });
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  const data = await response.json();
  assert.equal(data.total, 2);
  assert.ok(!data.polls.some((p) => p.id === legacy.id));
  const pin = data.polls.find((p) => p.id === mapped.id);
  assert.deepEqual(pin.position, [-79.38, 43.65]);
  assert.deepEqual(
    Object.keys(pin).sort(),
    [
      "id",
      "title",
      "totalVotes",
      "createdAt",
      "endsAt",
      "deleteAt",
      "status",
      "position",
    ].sort(),
  );
  assert.ok(!JSON.stringify(data).includes("43.653256"));
  const nearby = await (
    await f.request("/api/map/search", { location: exact })
  ).json();
  assert.deepEqual(
    nearby.polls.map((p) => p.id),
    [mapped.id],
  );
  const disk = JSON.parse(
    await readFile(join(f.directory, mapped.id + ".json"), "utf8"),
  );
  assert.deepEqual(disk.location, exact);
  assert.equal(disk.mapVisible, true);
  const reopened = new PollStore(f.directory, { clock: f.now });
  await reopened.init();
  assert.equal(reopened.map().total, 2);
  assert.equal(
    (await f.request("/api/map/search", { status: "nope" })).status,
    400,
  );
  assert.equal(
    (
      await f.request("/api/map/search", {
        location: { latitude: 91, longitude: 0 },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request("/api/map/search", {}, undefined, {
        origin: "https://other.test",
      })
    ).status,
    403,
  );
  f.advance(7 * DAY);
  assert.equal(
    (await (await f.request("/api/map/search", { status: "open" })).json())
      .total,
    0,
  );
  assert.equal(
    (await (await f.request("/api/map/search", { status: "closed" })).json())
      .total,
    2,
  );
  f.advance(23 * DAY);
  assert.equal(
    (await (await f.request("/api/map/search", {})).json()).total,
    0,
  );
  assert.equal((await f.request(`/api/polls/${distant.id}`)).status, 404);
});

test("map radius uses original GPS, caps payload and handles poles and the date line", async (t) => {
  const f = await fixture(t);
  const make = (id, location, createdAt = f.now()) => ({
    id: id.toString(16).padStart(24, "0"),
    title: "Pin",
    mapVisible: true,
    location,
    createdAt,
    endsAt: f.now() + 7 * DAY,
    deleteAt: f.now() + 30 * DAY,
    totalVotes: 0,
  });
  const latitude = (km) => ((km / 6371.0088) * 180) / Math.PI;
  f.store.index.set(
    "inside",
    make(1, { latitude: latitude(99.99), longitude: 0 }),
  );
  f.store.index.set(
    "outside",
    make(2, { latitude: latitude(100.01), longitude: 0 }),
  );
  assert.deepEqual(
    f.store
      .map({ location: { latitude: 0, longitude: 0 } })
      .polls.map((p) => p.id),
    [make(1, {}).id],
  );
  for (let n = 3; n <= 1105; n++)
    f.store.index.set(
      String(n),
      make(n, { latitude: 90, longitude: 180 }, f.now() + n),
    );
  const data = f.store.map();
  assert.equal(data.total, 1105);
  assert.equal(data.polls.length, 1000);
  assert.equal(data.polls[0].id, make(1105, {}).id);
  assert.deepEqual(data.polls[0].position, [180, 90]);
});

test("map library is pinned and served locally without exposing dependency directories", async (t) => {
  const f = await fixture(t);
  for (const name of [
    "maplibre-gl.mjs",
    "maplibre-gl-worker.mjs",
    "maplibre-gl.css",
  ]) {
    const r = await f.request(`/vendor/maplibre/6.16.0/${name}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("cache-control"), /must-revalidate/);
    assert.match(
      r.headers.get("content-security-policy"),
      /connect-src 'self' https:\/\/tiles.openfreemap.org;/,
    );
  }
  assert.equal(
    (await f.request("/vendor/maplibre/6.16.0/package.json")).status,
    404,
  );
  assert.equal(
    (await f.request("/node_modules/maplibre-gl/package.json")).status,
    404,
  );
});
