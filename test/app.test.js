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

test("PostList sorts newest first; nearby is exactly 100 km; coordinates stay private", async (t) => {
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
      "type",
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

const taskBody = (extra = {}) => ({
  title: "Help with a local garden",
  description: "Move a few planters.",
  reward: "CAD 30",
  location: { latitude: 43.6532, longitude: -79.3832 },
  mapVisible: true,
  retentionAccepted: true,
  ...extra,
});
async function createTask(f, extra) {
  const r = await f.request("/api/tasks", taskBody(extra));
  assert.equal(r.status, 201);
  return r.json();
}
async function socialSession(f, id) {
  const r = await f.request(`/api/posts/${id}/social`);
  assert.equal(r.status, 200);
  return {
    cookie: r.headers.get("set-cookie").split(";")[0],
    header: r.headers.get("set-cookie"),
    data: await r.json(),
  };
}
const replyBody = (extra = {}) => ({
  name: "Neighbour",
  message: "I can help on Saturday.",
  email: "helper@example.com",
  privacyAccepted: true,
  ...extra,
});
const CONTACT_STRINGS = [
  "helper@example.com",
  "both@example.com",
  "+1 (416) 555-0123",
  "416-555-0124",
  // JSON keys; error messages may mention the words, never these keys.
  '"phone"',
  '"email"',
];
function assertNoContacts(text, label) {
  for (const value of CONTACT_STRINGS)
    assert.ok(!text.includes(value), `${label} leaked ${value}`);
}
// Hoisted so the reply-privacy tests below can use them before the
// management-link section defines its own helpers.
function manageRequest(f, id, body, headers) {
  return f.request(`/api/tasks/${id}/manage`, body, undefined, headers);
}
function stateRequest(f, id, body, headers) {
  return f.request(`/api/tasks/${id}/state`, body, undefined, headers);
}

test("tasks require title, description, reward and GPS; discover by type and share a canonical QR", async (t) => {
  const f = await fixture(t);
  for (const extra of [
    { title: "" },
    { description: "" },
    { reward: "" },
    { location: null },
    { retentionAccepted: false },
  ])
    assert.equal((await f.request("/api/tasks", taskBody(extra))).status, 400);
  const task = await createTask(f, {
    type: "poll",
    endsAt: 1,
    totalLikes: 900,
  });
  assert.equal(task.type, "task");
  assert.equal(task.signature, "Anonymous");
  assert.equal(task.totalLikes, 0);
  assert.equal(task.deleteAt - task.createdAt, 30 * DAY);
  assert.equal(task.endsAt, task.deleteAt);
  assert.equal(task.location, undefined);
  await f.create();
  const list = await (
    await f.request("/api/polls/search", { type: "task" })
  ).json();
  assert.deepEqual(
    list.polls.map((p) => p.id),
    [task.id],
  );
  assert.equal(
    (await (await f.request("/api/map/search", { type: "task" })).json())
      .polls[0].type,
    "task",
  );
  assert.equal(
    (await f.request("/api/map/search", { type: "bad" })).status,
    400,
  );
  assert.equal((await f.request(`/api/polls/${task.id}`)).status, 404);
  assert.equal((await f.request(`/vote/${task.id}`)).status, 404);
  assert.equal((await f.request(`/task/${task.id}`)).status, 200);
  assert.equal(
    (await f.request(`/api/tasks/${task.id}/qr.png?download=1`)).headers.get(
      "content-type",
    ),
    "image/png",
  );
  assert.equal((await f.request(`/api/polls/${task.id}/qr.png`)).status, 404);
});

test("anonymous likes are atomic and idempotent on polls and tasks, independent of votes", async (t) => {
  const f = await fixture(t);
  for (const p of [await f.create(), await createTask(f)]) {
    const session = await socialSession(f, p.id);
    assert.match(session.header, /HttpOnly/);
    assert.match(session.header, /Secure/);
    assert.match(session.header, /SameSite=Strict/);
    assert.match(session.header, new RegExp(`Path=/api/posts/${p.id}`));
    assert.match(session.header, /Max-Age=2592000/);
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        f.request(`/api/posts/${p.id}/likes`, {}, session.cookie),
      ),
    );
    assert.ok(responses.every((r) => r.status === 200));
    const state = await (
      await f.request(`/api/posts/${p.id}/social`, undefined, session.cookie)
    ).json();
    assert.equal(state.totalLikes, 1);
    assert.equal(state.hasLiked, true);
    assert.equal((await f.store.get(p.id)).totalVotes, 0);
    const disk = JSON.parse(
      await readFile(join(f.directory, `${p.id}.json`), "utf8"),
    );
    assert.equal(Object.keys(disk.likers).length, 1);
    assert.ok(!JSON.stringify(disk).includes(session.cookie.split("=")[1]));
    assert.equal((await f.request(`/api/posts/${p.id}/likes`, {})).status, 403);
    assert.equal(
      (
        await f.request(`/api/posts/${p.id}/likes`, {}, session.cookie, {
          origin: "https://other.test",
        })
      ).status,
      403,
    );
  }
  const reload = new PollStore(f.directory, { clock: f.now });
  await reload.init();
  assert.ok(reload.list().polls.every((p) => p.totalLikes === 1));
});

test("task replies require privacy consent; phone-only, email-only and both work; no public endpoint returns contacts", async (t) => {
  const f = await fixture(t),
    task = await createTask(f),
    session = await socialSession(f, task.id);
  assert.equal(session.data.acceptsPrivateContacts, true);
  for (const extra of [
    { email: "", phone: "" },
    { email: "bad" },
    { email: "", phone: "abc" },
    { privacyAccepted: false },
    // The former "contacts are public" acknowledgement is no longer accepted.
    { privacyAccepted: undefined, contactAccepted: true },
    { message: "" },
    { email: "bad\r\n@example.com" },
    // Contact details in public fields are rejected.
    { message: "Email me at helper@example.com" },
    { message: "Call +44 20 7946 0958 any time" },
    { message: "Text me: (416) 555-0123" },
    { name: "helper@example.com" },
  ]) {
    const r = await f.request(
      `/api/posts/${task.id}/replies`,
      replyBody(extra),
      session.cookie,
    );
    assert.equal(r.status, 400, JSON.stringify(extra));
    assertNoContacts(await r.text(), "rejection");
  }
  for (const extra of [
    { email: "", phone: "+1 (416) 555-0123" },
    { email: "helper@example.com" },
    { email: "both@example.com", phone: "416-555-0124" },
  ]) {
    const r = await f.request(
      `/api/posts/${task.id}/replies`,
      replyBody(extra),
      session.cookie,
    );
    assert.equal(r.status, 201);
    assert.equal(r.headers.get("cache-control"), "no-store, max-age=0");
    // The unauthenticated reply response is public social data.
    assertNoContacts(await r.text(), "POST replies");
    f.advance(60000);
  }
  // Public text, counts and order are preserved.
  const state = await (await f.request(`/api/posts/${task.id}/social`)).json();
  assert.equal(state.replies.length, 3);
  assert.deepEqual(Object.keys(state.replies[0]).sort(), [
    "createdAt",
    "id",
    "message",
    "name",
  ]);
  assert.equal(state.replies[0].message, "I can help on Saturday.");
  assert.equal(state.replies[0].name, "Neighbour");
  const like = await f.request(`/api/posts/${task.id}/likes`, {}, session.cookie);
  assert.equal(like.status, 200);
  for (const [label, response] of [
    ["GET social", await f.request(`/api/posts/${task.id}/social`)],
    ["GET social with cookie", await f.request(`/api/posts/${task.id}/social`, undefined, session.cookie)],
    ["POST likes", like],
    ["GET task", await f.request(`/api/tasks/${task.id}`)],
    ["GET posts", await f.request("/api/posts")],
    ["GET polls", await f.request("/api/polls")],
    ["POST search", await f.request("/api/posts/search", { type: "task" })],
    ["POST map", await f.request("/api/map/search", {})],
    ["POST state", await stateRequest(f, task.id, { key: task.manageKey, state: "in_progress" })],
  ]) {
    const text = await response.text();
    assertNoContacts(text, label);
    assert.ok(!text.includes("replyAuthors"), label);
    assert.ok(!text.includes("likers"), label);
  }
  const listed = (await (await f.request("/api/posts")).json()).polls[0];
  assert.equal(listed.replyCount, 3);
  assert.equal((await (await f.request(`/api/tasks/${task.id}`)).json()).replyCount, 3);
  // Only the authenticated management POST returns contacts.
  const managed = await (await manageRequest(f, task.id, { key: task.manageKey })).json();
  assert.deepEqual(
    managed.replies.map((r) => [r.message, r.phone, r.email]),
    [
      ["I can help on Saturday.", "+1 (416) 555-0123", undefined],
      ["I can help on Saturday.", undefined, "helper@example.com"],
      ["I can help on Saturday.", "416-555-0124", "both@example.com"],
    ],
  );
  // Contacts remain in the private store (and therefore in private backups).
  const disk = JSON.parse(await readFile(join(f.directory, `${task.id}.json`), "utf8"));
  assert.equal(disk.replies[2].email, "both@example.com");
  const poll = await f.create(),
    pollSession = await socialSession(f, poll.id);
  assert.equal(pollSession.data.acceptsPrivateContacts, undefined);
  assert.equal(
    (
      await f.request(
        `/api/posts/${poll.id}/replies`,
        replyBody(),
        pollSession.cookie,
      )
    ).status,
    400,
  );
});

test("reply contacts are returned only after management-key verification, with private no-store caching", async (t) => {
  const f = await fixture(t),
    task = await createTask(f),
    other = await createTask(f),
    session = await socialSession(f, task.id);
  assert.equal(
    (await f.request(`/api/posts/${task.id}/replies`, replyBody(), session.cookie)).status,
    201,
  );
  for (const body of [
    {},
    { key: "0".repeat(64) },
    { key: other.manageKey },
    { key: task.manageKey.toUpperCase() },
  ]) {
    const r = await manageRequest(f, task.id, body);
    assert.equal(r.status, 403);
    assertNoContacts(await r.text(), "rejected manage");
  }
  // Keys in the URL are ignored, so contacts cannot be fetched via a link.
  const viaQuery = await f.request(`/api/tasks/${task.id}/manage?key=${task.manageKey}`, {});
  assert.equal(viaQuery.status, 403);
  assertNoContacts(await viaQuery.text(), "query-string manage");
  // GET is not a management route.
  assert.equal((await f.request(`/api/tasks/${task.id}/manage`)).status, 404);
  // Cross-origin requests are rejected even with the right key.
  const crossSite = await manageRequest(f, task.id, { key: task.manageKey }, { origin: "https://evil.example" });
  assert.equal(crossSite.status, 403);
  assertNoContacts(await crossSite.text(), "cross-site manage");
  // Another task's key never reveals this task's contacts.
  const otherManaged = await (await manageRequest(f, other.id, { key: other.manageKey })).json();
  assert.deepEqual(otherManaged.replies, []);
  const ok = await manageRequest(f, task.id, { key: task.manageKey });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store, private, max-age=0");
  assert.equal(ok.headers.get("pragma"), "no-cache");
  const data = await ok.json();
  assert.equal(data.replies[0].email, "helper@example.com");
  assert.equal(data.manageKey, undefined);
  assert.equal(data.manageKeyHash, undefined);
  assert.equal(data.replyAuthors, undefined);
  // Contacts share the task's 30-day lifecycle.
  f.advance(30 * DAY - 1);
  assert.equal((await manageRequest(f, task.id, { key: task.manageKey })).status, 200);
  f.advance(1);
  const expired = await manageRequest(f, task.id, { key: task.manageKey });
  assert.equal(expired.status, 404);
  assertNoContacts(await expired.text(), "expired manage");
});

test("replies stored before contacts became private are hidden publicly but shown to the management link", async (t) => {
  const f = await fixture(t),
    task = await createTask(f);
  const path = join(f.directory, `${task.id}.json`),
    disk = JSON.parse(await readFile(path, "utf8"));
  // Shape written by the previous version: contacts at top level, empty
  // strings for omitted fields.
  disk.replies = [
    { id: "a".repeat(24), name: "Old helper", message: "Still available.", phone: "+1 416 555 0199", email: "", createdAt: f.now() },
    { id: "b".repeat(24), name: "Anonymous", message: "Me too.", phone: "", email: "old@example.com", createdAt: f.now() },
  ];
  await writeFile(path, JSON.stringify(disk));
  const social = await f.request(`/api/posts/${task.id}/social`);
  const text = await social.text();
  assert.ok(!text.includes("+1 416 555 0199"));
  assert.ok(!text.includes("old@example.com"));
  const data = JSON.parse(text);
  assert.deepEqual(data.replies.map((r) => [r.name, r.message]), [
    ["Old helper", "Still available."],
    ["Anonymous", "Me too."],
  ]);
  const managed = await (await manageRequest(f, task.id, { key: task.manageKey })).json();
  assert.deepEqual(
    managed.replies.map((r) => [r.phone, r.email]),
    [["+1 416 555 0199", undefined], [undefined, "old@example.com"]],
  );
});

test("contact detection in public reply fields ignores dates, times and prices", async () => {
  const { looksLikeContact } = await import("../src/validation.js");
  for (const value of [
    "Reach me at someone@example.org",
    "+1 416 555 0123",
    "+442079460958",
    "(416) 555-0123",
    "416.555.0123",
    "4165550123",
  ])
    assert.equal(looksLikeContact(value), true, value);
  for (const value of [
    "I can help on Saturday.",
    "Available 2026-11-09 10:00 to 14:30",
    "CAD 30 or a coffee",
    "Around 1,000,000 leaves to rake",
    "Unit 12, 3 hours",
    "@neighbour sure",
  ])
    assert.equal(looksLikeContact(value), false, value);
});

test("reply bursts serialize and full post expiry removes likes, replies, contacts and all endpoints", async (t) => {
  const f = await fixture(t),
    task = await createTask(f),
    session = await socialSession(f, task.id);
  const burst = await Promise.all(
    Array.from({ length: 10 }, () =>
      f.request(`/api/posts/${task.id}/replies`, replyBody(), session.cookie),
    ),
  );
  assert.equal(burst.filter((r) => r.status === 201).length, 1);
  assert.equal(burst.filter((r) => r.status === 429).length, 9);
  await f.request(`/api/posts/${task.id}/likes`, {}, session.cookie);
  f.advance(7 * DAY);
  assert.equal(
    (await f.request(`/api/posts/${task.id}/likes`, {}, session.cookie)).status,
    200,
  );
  assert.equal((await f.request(`/api/tasks/${task.id}`)).status, 200);
  f.advance(23 * DAY);
  for (const route of [
    `/task/${task.id}`,
    `/api/tasks/${task.id}`,
    `/api/tasks/${task.id}/qr.png`,
    `/api/posts/${task.id}/social`,
  ])
    assert.equal((await f.request(route)).status, 404);
  assert.equal(
    (
      await f.request(
        `/api/posts/${task.id}/replies`,
        replyBody(),
        session.cookie,
      )
    ).status,
    404,
  );
  assert.equal(
    (await f.request(`/api/posts/${task.id}/likes`, {}, session.cookie)).status,
    404,
  );
  assert.equal(
    (await readdir(f.directory)).filter((n) => n.endsWith(".json")).length,
    0,
  );
});

test("legacy polls initialize social fields without changing votes or exposing hashes", async (t) => {
  const f = await fixture(t),
    poll = await f.create();
  const path = join(f.directory, `${poll.id}.json`),
    disk = JSON.parse(await readFile(path, "utf8"));
  for (const key of ["type", "likers", "totalLikes", "replies", "replyAuthors"])
    delete disk[key];
  await writeFile(path, JSON.stringify(disk));
  const session = await socialSession(f, poll.id);
  assert.equal(session.data.totalLikes, 0);
  assert.equal(
    (await f.request(`/api/posts/${poll.id}/likes`, {}, session.cookie)).status,
    200,
  );
  const result = await (await f.request(`/api/polls/${poll.id}`)).json();
  assert.equal(result.totalLikes, 1);
  assert.equal(result.totalVotes, 0);
  assert.equal(result.type, "poll");
  assert.ok(!("likers" in result));
});

test("legacy listing links redirect to PostList and preserve query parameters", async (t) => {
  const f = await fixture(t);
  // fetch defaults to following redirects, so check the alias directly.
  const response = await fetch(
    (await f.request("/healthz")).url.replace(
      "/healthz",
      "/VoteList?type=task&status=open",
    ),
    { redirect: "manual" },
  );
  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get("location"),
    "/PostList?type=task&status=open",
  );
  const canonical = await f.request("/PostList");
  assert.equal(canonical.status, 200);
  const html = await canonical.text();
  assert.ok(html.includes('href="/PostList"'));
  assert.ok(!html.includes("VoteList"));
  const manifest = await (await f.request("/manifest.webmanifest")).json();
  assert.ok(
    manifest.shortcuts.some(
      (s) => s.url === "/PostList" && s.name.includes("PostList"),
    ),
  );
});

// ---------------------------------------------------------------------------
// Task progress states and private management links
// ---------------------------------------------------------------------------
const manage = (f, id, body, headers) =>
  f.request(`/api/tasks/${id}/manage`, body, undefined, headers);
const setState = (f, id, body, headers) =>
  f.request(`/api/tasks/${id}/state`, body, undefined, headers);

test("task creation returns a private management key once; only its hash is stored and it never leaks", async (t) => {
  const f = await fixture(t);
  const task = await createTask(f, {
    taskState: "completed",
    manageKeyHash: "0".repeat(64),
    manageKey: "f".repeat(64),
  });
  assert.match(task.manageKey, /^[a-f0-9]{64}$/);
  assert.notEqual(task.manageKey, "f".repeat(64));
  assert.equal(task.taskState, "open");
  assert.equal(task.status, "open");
  assert.equal(task.manageKeyHash, undefined);
  const disk = JSON.parse(
    await readFile(join(f.directory, `${task.id}.json`), "utf8"),
  );
  assert.equal(disk.manageKeyHash, voterHash(task.manageKey));
  assert.equal(disk.taskState, "open");
  assert.ok(!JSON.stringify(disk).includes(task.manageKey));
  assert.ok(!("manageKey" in disk));
  const session = await socialSession(f, task.id);
  for (const response of [
    await f.request(`/api/tasks/${task.id}`),
    await f.request("/api/posts"),
    await f.request("/api/posts/search", { type: "task" }),
    await f.request("/api/map/search", {}),
    await f.request(`/api/posts/${task.id}/social`, undefined, session.cookie),
  ]) {
    const text = await response.text();
    assert.ok(!text.includes(task.manageKey), "management key leaked");
    assert.ok(!text.includes(disk.manageKeyHash), "management hash leaked");
    assert.ok(!text.includes("manageKey"), "management field leaked");
  }
  const reopened = new PollStore(f.directory, { clock: f.now });
  await reopened.init();
  assert.ok(!JSON.stringify(reopened.list()).includes(disk.manageKeyHash));
  // Polls have no management links or task states.
  const poll = await f.create();
  assert.equal(poll.manageKey, undefined);
  assert.equal(poll.taskState, undefined);
});

test("only the matching management key can read management state or change status", async (t) => {
  const f = await fixture(t);
  const task = await createTask(f),
    other = await createTask(f);
  const poll = await f.create();
  for (const body of [
    {},
    { key: "" },
    { key: "nope" },
    { key: "A".repeat(64) },
    { key: "0".repeat(64) },
    { key: other.manageKey },
    { key: [task.manageKey] },
  ]) {
    assert.equal((await manage(f, task.id, body)).status, 403);
    assert.equal(
      (await setState(f, task.id, { ...body, state: "completed" })).status,
      403,
    );
  }
  // Cross-site requests are rejected even with the correct key.
  assert.equal(
    (
      await setState(
        f,
        task.id,
        { key: task.manageKey, state: "closed" },
        { origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  // Keys are never accepted from the URL.
  assert.equal(
    (await f.request(`/api/tasks/${task.id}/state?key=${task.manageKey}`, { state: "closed" })).status,
    403,
  );
  assert.equal(
    (await setState(f, poll.id, { key: task.manageKey, state: "closed" })).status,
    404,
  );
  assert.equal(
    (await setState(f, task.id, { key: task.manageKey, state: "deleted" })).status,
    400,
  );
  assert.equal((await f.store.get(task.id)).taskState, "open");
  const ok = await manage(f, task.id, { key: task.manageKey });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store, private, max-age=0");
  const data = await ok.json();
  assert.equal(data.taskState, "open");
  assert.deepEqual(data.replies, []);
  assert.equal(data.manageKey, undefined);
  assert.equal(data.manageKeyHash, undefined);
  assert.equal((await f.request(`/task/${task.id}/manage`)).status, 200);
  assert.equal((await f.request(`/task/${poll.id}/manage`)).status, 404);
});

test("progress states: in progress accepts replies; completed and closed are final and reject new replies", async (t) => {
  const f = await fixture(t);
  const task = await createTask(f);
  const session = await socialSession(f, task.id);
  const reply = () =>
    f.request(`/api/posts/${task.id}/replies`, replyBody(), session.cookie);
  let r = await setState(f, task.id, { key: task.manageKey, state: "in_progress" });
  assert.equal(r.status, 200);
  let data = await r.json();
  assert.equal(data.taskState, "in_progress");
  assert.equal(data.status, "open");
  assert.equal(data.endsAt, task.endsAt);
  assert.equal(data.deleteAt, task.deleteAt);
  assert.equal((await reply()).status, 201);
  f.advance(60000);
  r = await setState(f, task.id, { key: task.manageKey, state: "open" });
  assert.equal((await r.json()).taskState, "open");
  r = await setState(f, task.id, { key: task.manageKey, state: "completed" });
  data = await r.json();
  assert.equal(data.taskState, "completed");
  assert.equal(data.status, "closed");
  assert.equal(data.deleteAt, task.deleteAt, "retention must not change");
  const rejected = await reply();
  assert.equal(rejected.status, 409);
  assert.match((await rejected.json()).error, /no longer accepts replies/);
  for (const state of ["open", "in_progress", "closed"])
    assert.equal(
      (await setState(f, task.id, { key: task.manageKey, state })).status,
      409,
    );
  // Repeating the current final state is idempotent.
  assert.equal(
    (await setState(f, task.id, { key: task.manageKey, state: "completed" })).status,
    200,
  );
  const social = await (
    await f.request(`/api/posts/${task.id}/social`, undefined, session.cookie)
  ).json();
  assert.equal(social.taskState, "completed");
  assert.equal(social.replies.length, 1, "existing replies stay visible");
  // Likes remain available; they never reopen a task.
  assert.equal(
    (await f.request(`/api/posts/${task.id}/likes`, {}, session.cookie)).status,
    200,
  );
  // Closed tasks behave the same.
  const closed = await createTask(f);
  const closedSession = await socialSession(f, closed.id);
  await setState(f, closed.id, { key: closed.manageKey, state: "closed" });
  assert.equal(
    (
      await f.request(
        `/api/posts/${closed.id}/replies`,
        replyBody(),
        closedSession.cookie,
      )
    ).status,
    409,
  );
  // Status filters and map reflect final states.
  const open = await (
    await f.request("/api/posts/search", { type: "task", status: "open" })
  ).json();
  assert.deepEqual(open.polls.map((p) => p.id), []);
  const ended = await (
    await f.request("/api/posts/search", { type: "task", status: "closed" })
  ).json();
  assert.deepEqual(
    ended.polls.map((p) => [p.id, p.taskState]).sort(),
    [
      [task.id, "completed"],
      [closed.id, "closed"],
    ].sort(),
  );
  const pins = await (await f.request("/api/map/search", { type: "task" })).json();
  assert.ok(pins.polls.every((p) => p.status === "closed"));
  assert.deepEqual(
    pins.polls.map((p) => p.taskState).sort(),
    ["closed", "completed"],
  );
  // Persisted across restart.
  const reopened = new PollStore(f.directory, { clock: f.now });
  await reopened.init();
  assert.equal((await reopened.get(task.id)).taskState, "completed");
});

test("managed tasks still leave the website at exactly 30 days, including management endpoints", async (t) => {
  const f = await fixture(t);
  const task = await createTask(f);
  await setState(f, task.id, { key: task.manageKey, state: "in_progress" });
  f.advance(30 * DAY - 1);
  assert.equal((await manage(f, task.id, { key: task.manageKey })).status, 200);
  f.advance(1);
  for (const response of [
    await manage(f, task.id, { key: task.manageKey }),
    await setState(f, task.id, { key: task.manageKey, state: "completed" }),
    await f.request(`/task/${task.id}/manage`),
    await f.request(`/api/tasks/${task.id}`),
  ])
    assert.equal(response.status, 404);
  await f.store.sweep();
  assert.equal(
    (await readdir(f.directory)).filter((n) => n.endsWith(".json")).length,
    0,
  );
});

test("legacy tasks without progress fields stay open, reject new replies and cannot be managed", async (t) => {
  const f = await fixture(t);
  const task = await createTask(f);
  const path = join(f.directory, `${task.id}.json`),
    disk = JSON.parse(await readFile(path, "utf8"));
  delete disk.taskState;
  delete disk.manageKeyHash;
  // A reply stored by the previous version, when contacts were public.
  disk.replies = [
    { id: "c".repeat(24), name: "Earlier", message: "Earlier reply.", phone: "", email: "legacy@example.com", createdAt: f.now() },
  ];
  await writeFile(path, JSON.stringify(disk));
  const fresh = new PollStore(f.directory, { clock: f.now });
  await fresh.init();
  assert.equal((await fresh.get(task.id)).taskState, "open");
  const result = await (await f.request(`/api/tasks/${task.id}`)).json();
  assert.equal(result.taskState, "open");
  assert.equal(result.status, "open");
  const session = await socialSession(f, task.id);
  assert.equal(session.data.taskState, "open");
  // Nobody holds a key, so contacts cannot be retrieved and new replies are prevented.
  assert.equal(session.data.acceptsPrivateContacts, false);
  assert.ok(!JSON.stringify(session.data).includes("legacy@example.com"));
  assert.deepEqual(session.data.replies.map((r) => r.message), ["Earlier reply."]);
  for (const extra of [{}, { email: "", phone: "+1 416 555 0123" }, { email: "", phone: "" }]) {
    const rejected = await f.request(`/api/posts/${task.id}/replies`, replyBody(extra), session.cookie);
    assert.equal(rejected.status, 409);
    const { error } = await rejected.json();
    assert.match(error, /no private management link/);
    assert.match(error, /cannot retrieve contact details/);
  }
  // Contact details smuggled into public fields are rejected by input validation first.
  assert.equal(
    (await f.request(`/api/posts/${task.id}/replies`, replyBody({ email: "", message: "Mail me: x@example.com" }), session.cookie)).status,
    400,
  );
  // The originally issued key no longer matches anything stored, so the
  // management view (and its contacts) is unavailable.
  assert.equal(
    (await setState(f, task.id, { key: task.manageKey, state: "closed" })).status,
    403,
  );
  const managed = await manage(f, task.id, { key: task.manageKey });
  assert.equal(managed.status, 403);
  assert.ok(!(await managed.text()).includes("legacy@example.com"));
  const list = await (
    await f.request("/api/posts/search", { type: "task", status: "open" })
  ).json();
  assert.deepEqual(list.polls.map((p) => p.id), [task.id]);
});
