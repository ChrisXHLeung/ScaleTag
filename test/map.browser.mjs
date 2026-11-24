import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createApp } from "../src/app.js";
import { PollStore, DAY } from "../src/store.js";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "scaletag-map-"));
  let now = Date.now();
  const store = new PollStore(directory, { clock: () => now });
  await store.init();
  const server = createApp(store).listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Rebuild with the actual origin for same-origin POST requests.
  await new Promise((r) => server.close(r));
  const live = createApp(store, { origin }).listen(
    Number(new URL(origin).port),
    "127.0.0.1",
  );
  await once(live, "listening");
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const context = await browser.newContext({
    permissions: ["geolocation"],
    geolocation: { latitude: 43.65, longitude: -79.38 },
  });
  const page = await context.newPage();
  const errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  context.on("request", (r) => {
    if (new URL(r.url()).origin !== origin) requests.push(r.url());
  });
  await context.route("https://tiles.openfreemap.org/**", (route) => {
    if (route.request().url().includes("/styles/"))
      return route.fulfill({
        json: {
          version: 8,
          sources: {},
          glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
          layers: [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "#eef3f7" },
            },
          ],
        },
      });
    // Empty protobuf: map interactions and clusters are tested without a network dependency.
    return route.fulfill({
      body: Buffer.alloc(0),
      contentType: "application/x-protobuf",
    });
  });
  t.after(async () => {
    await browser.close();
    await new Promise((r) => live.close(r));
    await rm(directory, { recursive: true, force: true });
  });
  const input = {
    title: "Trees for our street?",
    description: "",
    signature: "Neighbour",
    options: ["Yes", "No"],
    images: [],
    location: { latitude: 43.6532, longitude: -79.3832 },
    mapVisible: true,
  };
  return {
    page,
    context,
    browser,
    store,
    origin,
    errors,
    requests,
    input,
    advance(ms) {
      now += ms;
    },
  };
}

test("Pickup now follows giveaway time boundaries in List and Map", async (t) => {
  const { advance, errors, input, origin, page, store } = await fixture(t);
  const now = store.clock();
  const make = (title, pickupWindow) => store.create({ ...input, title, type: "sale", giveawayVersion: 1,
    pickupLocation: "Library entrance", pickupWindow,
  });
  const current = await make("Available chair", { startsAt: now, endsAt: now + 60000 });
  const future = await make("Scheduled chair", { startsAt: now + 60000, endsAt: now + 120000 });
  const unknown = await make("Unscheduled chair");
  await page.clock.install({ time: new Date(now) });
  await page.goto(`${origin}/PostList`);
  const type = page.locator("#content-type");
  const pickup = page.getByRole("combobox", { name: "Pickup time", exact: true });
  assert.equal(await pickup.isVisible(), false);
  await type.selectOption("sale");
  const card = sale => page.locator(`#poll-list a[href="/sale/${sale.id}"]`);
  await card(unknown).waitFor();
  await pickup.selectOption("now");
  await card(unknown).waitFor({ state: "hidden" });
  await card(current).waitFor();
  assert.equal(await card(future).count(), 0);

  advance(61000);
  await page.clock.fastForward(61000);
  await card(future).waitFor();
  assert.equal(await card(current).count(), 0);

  await mapReady(page);
  const mapped = sale => page.locator(`#mapped-poll-links a[href="/sale/${sale.id}"]`);
  await mapped(future).waitFor({ state: "attached" });
  assert.equal(await mapped(unknown).count(), 0);
  assert.equal(await mapped(current).count(), 0);
  advance(60000);
  await page.clock.fastForward(60000);
  await page.getByText("No mapped posts match these filters. Try List to see all posts.", { exact: true }).waitFor();
  assert.equal(await mapped(future).count(), 0);
  await page.getByRole("button", { name: "List", exact: true }).click();
  assert.equal(await pickup.inputValue(), "now");
  await page.getByText("No giveaways match the current pickup time.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clear all filters", exact: true }).click();
  assert.equal(await pickup.isVisible(), false);
  await card(unknown).waitFor();
  assert.deepEqual(errors, []);
});

test("pickup timing transitions reconcile a delayed Load more without dropping results", async (t) => {
  const { advance, input, origin, page, store, context } = await fixture(t);
  const now = store.clock();
  const make = (title, startsAt, endsAt) => store.create({ ...input, title, type: "sale", giveawayVersion: 1,
    pickupLocation: "Library entrance", pickupWindow: { startsAt, endsAt },
  });
  for (let i = 0; i < 21; i++) await make(`Stable pickup ${i}`, now, now + 240000);
  advance(1000);
  const expiring = await make("Expiring pickup", now + 1000, now + 60000);
  const beginning = await make("Beginning pickup", now + 60000, now + 120000);
  await page.clock.install({ time: new Date(now + 1000) });
  await page.goto(`${origin}/PostList`);
  await page.locator("#content-type").selectOption("sale");
  const pickup = page.getByRole("combobox", { name: "Pickup time", exact: true });
  await pickup.selectOption("now");
  const cards = page.locator("#poll-list .sale-list-card");
  const card = sale => cards.filter({ hasText: sale.title });
  await card(expiring).waitFor();
  const more = page.getByRole("button", { name: "Load more posts", exact: true });
  let entered, release;
  const requested = new Promise(resolve => { entered = resolve; });
  const delayed = new Promise(resolve => { release = resolve; });
  await context.route("**/api/posts/search", async route => {
    if (route.request().postDataJSON().cursor) {
      entered();
      await delayed;
    }
    await route.continue();
  });
  try {
    await more.click();
    await requested;
    advance(60000);
    await page.clock.fastForward(60000);
  } finally {
    release();
  }
  await card(beginning).waitFor();
  assert.equal(await card(expiring).count(), 0);
  assert.equal(await cards.count(), 22);
  const last = cards.last();
  const href = await last.getAttribute("href");
  await last.focus();
  advance(60000);
  await page.clock.fastForward(60000);
  await card(beginning).waitFor({ state: "hidden" });
  assert.equal(await cards.count(), 21);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("href")), href);
});

test("upcoming pickup enters the 24-hour range and moves out when it starts", async (t) => {
  const { advance, input, origin, page, store, errors } = await fixture(t);
  const now = store.clock();
  const make = (title, start) => store.create({ ...input, title, type: "sale", giveawayVersion: 1,
    pickupLocation: "Library entrance", pickupWindow: { startsAt: now + start, endsAt: now + start + 120000 },
  });
  const next = await make("Soon pickup", 60000);
  const far = await make("Next-day pickup", DAY + 30000);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.clock.install({ time: new Date(now) });
  await page.goto(`${origin}/PostList`);
  await page.locator("#content-type").selectOption("sale");
  const pickup = page.getByRole("combobox", { name: "Pickup time", exact: true });
  const card = sale => page.locator(`#poll-list a[href="/sale/${sale.id}"]`);
  await card(far).waitFor();
  await pickup.selectOption({ label: "Starts in the next 24 hours" });
  await card(far).waitFor({ state: "hidden" });
  await card(next).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  advance(31000);
  await page.clock.fastForward(31000);
  await card(far).waitFor();
  await mapReady(page);
  const link = sale => page.locator(`#mapped-poll-links a[href="/sale/${sale.id}"]`);
  await link(next).waitFor({ state: "attached" });
  await link(far).waitFor({ state: "attached" });
  assert.match(await link(next).textContent(), /Pickup window ·/u);
  await page.locator(".mapped-polls summary").click();
  await link(far).focus();
  advance(31000);
  await page.clock.fastForward(31000);
  await link(next).waitFor({ state: "detached" });
  assert.equal(await link(far).count(), 1);
  assert.equal(await link(far).evaluate(element => document.activeElement === element), true);
  await page.getByRole("button", { name: "List", exact: true }).click();
  assert.equal(await pickup.inputValue(), "upcoming");
  await pickup.selectOption("now");
  await card(next).waitFor();
  assert.equal(await card(far).count(), 0);
  assert.deepEqual(errors, []);
});

async function mapReady(page) {
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#poll-map canvas") !== null,
  );
  await page.waitForFunction(() =>
    document
      .querySelector("#map-count")
      .textContent.includes("matching mapped posts"),
  );
}

test("empty list and map results can clear filters without changing the view", async (t) => {
  const { page, origin, store, input } = await fixture(t);
  const poll = await store.create(input);
  const view = mode => page.getByRole("button", { name: mode, exact: true });
  const reset = page.getByRole("button", { name: "Clear all filters", exact: true });
  const search = page.locator("#post-query");
  const apply = async () => {
    await page.locator("#content-type").selectOption("task");
    await page.getByRole("button", { name: "Ended", exact: true }).click();
    await search.fill("Nonmatching keyword");
    await page.getByRole("button", { name: "Search", exact: true }).click();
  };
  await page.goto(`${origin}/PostList`);
  await page.locator(`#poll-list a[href="/vote/${poll.id}"]`).waitFor();
  assert.equal(await reset.count(), 0);
  await page.locator("#nearby").click();
  await page.locator("#nearby[aria-pressed=true]").waitFor();
  await page.locator("#nearby-radius").selectOption("10");
  await apply();
  await page.getByText("No posts match your search.", { exact: true }).waitFor();
  await reset.click({ timeout: 5000 });
  await page.locator(`#poll-list a[href="/vote/${poll.id}"]`).waitFor();
  assert.equal(await search.inputValue(), "");
  assert.equal(await page.locator("#content-type").inputValue(), "all");
  assert.equal(await page.locator("#nearby").getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator("#nearby-radius").inputValue(), "100");
  assert.equal(await view("List").getAttribute("aria-pressed"), "true");

  await apply();
  await view("Map").click();
  await page.getByText("No mapped posts match these filters.", { exact: false }).waitFor();
  await reset.click({ timeout: 5000 });
  await page.locator(`#mapped-poll-links a[href="/vote/${poll.id}"]`).waitFor({ state: "attached" });
  assert.equal(await view("Map").getAttribute("aria-pressed"), "true");
  assert.equal(await page.getByRole("button", { name: "All posts", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(page.url(), `${origin}/PostList`);
});

test("canceling a pending nearby lookup allows immediate retry and ignores the old callback", async (t) => {
  const { page, origin } = await fixture(t);
  await page.addInitScript(() => {
    window.locationLookups = [];
    navigator.geolocation.getCurrentPosition = success => window.locationLookups.push(success);
  });
  await page.goto(`${origin}/PostList`);
  const nearby = page.locator("#nearby");
  const cancel = page.getByRole("button", { name: "Cancel nearby search", exact: true });
  await nearby.click();
  await page.waitForFunction(() => window.locationLookups.length === 1);
  await cancel.click({ timeout: 5000 });
  assert.equal(await nearby.getAttribute("aria-pressed"), "false");
  await nearby.click();
  await page.waitForFunction(() => window.locationLookups.length === 2);
  await page.evaluate(() => window.locationLookups[0]({ coords: { latitude: 1, longitude: 2 } }));
  await cancel.waitFor();
  assert.equal(await page.locator("#location-privacy").isHidden(), true);

  await page.locator("#content-type").selectOption("sale");
  await page.getByRole("button", { name: "Clear all filters", exact: true }).click();
  assert.equal(await nearby.getAttribute("aria-pressed"), "false");
  await nearby.click();
  await page.waitForFunction(() => window.locationLookups.length === 3);
  const result = page.waitForRequest(request => request.url() === `${origin}/api/posts/search` && request.postDataJSON()?.location);
  await page.evaluate(() => {
    window.locationLookups[1]({ coords: { latitude: 3, longitude: 4 } });
    window.locationLookups[2]({ coords: { latitude: 43.65, longitude: -79.38 } });
  });
  assert.deepEqual((await result).postDataJSON().location, { latitude: 43.65, longitude: -79.38 });
  assert.equal(await nearby.getAttribute("aria-pressed"), "true");
});

test("an unchanged automatic map refresh keeps keyboard focus on Clear all filters", async (t) => {
  const { page, origin } = await fixture(t);
  let release;
  let requestStarted;
  const pendingRefresh = new Promise(resolve => { requestStarted = resolve; });
  await page.route(`${origin}/api/map/search`, async route => {
    if (release) {
      requestStarted();
      await release;
    }
    await route.continue();
  });
  await page.clock.install();
  await page.goto(`${origin}/PostList`);
  await page.locator("#content-type").selectOption("task");
  await page.getByRole("button", { name: "Map", exact: true }).click();
  const clear = page.getByRole("button", { name: "Clear all filters", exact: true });
  await clear.focus();
  await page.locator("#map-count").evaluate(message => {
    window.mapResultUpdated = false;
    new MutationObserver(() => { window.mapResultUpdated = true; }).observe(message, { childList: true });
  });
  let unblock;
  release = new Promise(resolve => { unblock = resolve; });
  try {
    await page.clock.fastForward(31000);
    await pendingRefresh;
    assert.equal(await clear.evaluate(button => document.activeElement === button, undefined, { timeout: 5000 }), true);
  } finally {
    unblock();
  }
  await page.waitForFunction(() => window.mapResultUpdated);
  assert.equal(await clear.evaluate(button => document.activeElement === button), true);
});

test("background map refresh keeps markers and links visible and Clear all filters keeps focus in map", async (t) => {
  const { page, origin, store, input } = await fixture(t);
  const poll = await store.create(input);
  let release;
  let requestStarted;
  const pendingRefresh = new Promise(resolve => { requestStarted = resolve; });
  await page.route(`${origin}/api/map/search`, async route => {
    if (release) {
      requestStarted();
      await release;
    }
    await route.continue();
  });
  await page.clock.install();
  await page.goto(`${origin}/PostList`);
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await mapReady(page);
  await page.locator(`#mapped-poll-links a[href="/vote/${poll.id}"]`).waitFor({ state: "attached" });
  let unblock;
  release = new Promise(resolve => { unblock = resolve; });
  try {
    await page.clock.fastForward(31000);
    await pendingRefresh;
    assert.equal(await page.locator(`#mapped-poll-links a[href="/vote/${poll.id}"]`).count(), 1);
  } finally {
    unblock();
  }
  await page.locator(`#mapped-poll-links a[href="/vote/${poll.id}"]`).waitFor({ state: "attached" });
  release = undefined;

  await page.locator("#content-type").selectOption("task");
  const clear = page.getByRole("button", { name: "Clear all filters", exact: true });
  await clear.click();
  assert.equal(await page.locator("#map-count").evaluate(el => document.activeElement === el), true);
});

test("a non-cached Back navigation restores the discovery view and public filters only", async (t) => {
  const { page, origin, store, input } = await fixture(t);
  const poll = await store.create(input);
  await page.goto(`${origin}/PostList`);
  await page.locator("#nearby").click();
  await page.locator("#nearby[aria-pressed=true]").waitFor();
  await page.locator("#content-type").selectOption("poll");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.locator("#post-query").fill("Trees");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await mapReady(page);
  assert.deepEqual(await page.evaluate(() => history.state?.scaleTagPostList), {
    mode: "map", type: "poll", status: "open",
  });

  await page.goto(`${origin}/vote/${poll.id}`);
  await page.getByRole("heading", { name: poll.title }).waitFor();
  const results = page.waitForResponse(`${origin}/api/map/search`, { timeout: 5000 });
  await page.goBack();
  assert.equal(await page.evaluate(() => performance.getEntriesByType("navigation")[0].type), "back_forward");
  assert.deepEqual((await results).request().postDataJSON(), { status: "open", type: "poll", query: "" });
  assert.equal(await page.getByRole("button", { name: "Map", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#post-query").inputValue(), "");
  assert.equal(await page.locator("#nearby").getAttribute("aria-pressed"), "false");
  assert.equal(page.url(), `${origin}/PostList`);
  await page.reload();
  assert.equal(await page.getByRole("button", { name: "List", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#content-type").inputValue(), "all");
});

test("Back restores the upcoming pickup selection while reload resets it", async (t) => {
  const { page, origin, store, input } = await fixture(t);
  const now = store.clock();
  const sale = await store.create({ ...input, type: "sale", giveawayVersion: 1,
    pickupLocation: "Library entrance", pickupWindow: { startsAt: now + 60000, endsAt: now + 120000 },
  });
  await page.goto(`${origin}/PostList`);
  await page.locator("#content-type").selectOption("sale");
  const pickup = page.getByRole("combobox", { name: "Pickup time", exact: true });
  await pickup.selectOption("upcoming");
  assert.equal(await page.evaluate(() => history.state?.scaleTagPostList?.pickup), "upcoming");
  await page.locator(`#poll-list a[href="/sale/${sale.id}"]`).click();
  await page.getByRole("heading", { name: sale.title, exact: true }).waitFor();
  const results = page.waitForResponse(`${origin}/api/posts/search`, { timeout: 10000 });
  await page.goBack();
  assert.equal((await results).request().postDataJSON().pickup, "upcoming");
  assert.equal(await pickup.inputValue(), "upcoming");
  await page.reload();
  assert.equal(await page.locator("#content-type").inputValue(), "all");
  assert.equal(await pickup.isVisible(), false);
});

test("a cached PostList restores its map and refreshes the current filters", async (t) => {
  const { page, origin, store, input, errors } = await fixture(t);
  const poll = await store.create(input);
  await page.goto(`${origin}/PostList`);
  await page.locator("#content-type").selectOption("poll");
  await page.locator("#post-query").fill("Trees");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await mapReady(page);
  const canvas = page.locator("#poll-map canvas");
  await canvas.evaluate(element => { element.dataset.originalCanvas = "yes"; });

  for (let attempt = 0; attempt < 2; attempt++) {
    const incoming = page.waitForResponse(`${origin}/api/map/search`, { timeout: 5000 });
    await page.evaluate(() => {
      dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    assert.deepEqual((await incoming).request().postDataJSON(), { status: "all", type: "poll", query: "Trees" });
    assert.equal(await canvas.getAttribute("data-original-canvas", { timeout: 5000 }), "yes");
    await page.locator(`#mapped-poll-links a[href="/vote/${poll.id}"]`).waitFor({ state: "attached" });
  }
  assert.equal(await page.locator("#post-query").inputValue(), "Trees");
  assert.equal(await page.getByRole("button", { name: "Map", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(page.url(), `${origin}/PostList`);
  assert.deepEqual(errors, []);
});

test("a cached PostList list updates expired holds without rebuilding results", async (t) => {
  const { page, origin, store, input } = await fixture(t);
  const sale = await store.create({ ...input, type: "sale", giveawayVersion: 1, options: [] });
  await store.setSaleState(sale.id, sale.manageKey, "reserved", sale.createdAt + 60000);
  await page.goto(`${origin}/PostList`);
  const card = page.locator(`#poll-list a[href="/sale/${sale.id}"]`);
  await card.getByText("Reserved", { exact: true }).waitFor();
  await card.evaluate(element => { element.dataset.originalCard = "yes"; });
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await page.clock.setFixedTime(new Date(Date.now() + 120000));
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await card.getByText("Available", { exact: true }).waitFor({ timeout: 5000 });
  assert.equal(await card.getAttribute("data-original-card"), "yes");
});

test("map is opt-in, renders real MapLibre markers, filters and provides accessible poll links", async (t) => {
  const f = await fixture(t);
  const poll = await f.store.create(f.input);
  await f.store.create({
    ...f.input,
    mapVisible: false,
    title: "Legacy list-only",
  });
  await f.page.goto(f.origin + "/PostList");
  await f.page.getByRole("link", { name: /Legacy list-only/ }).waitFor();
  assert.equal(
    f.requests.length,
    0,
    "List never loads third-party map resources",
  );
  await mapReady(f.page);
  await f.page
    .locator("#map-message")
    .filter({ hasText: "Select a dot" })
    .waitFor();
  assert.ok(f.requests.some((url) => url.includes("/styles/positron")));
  await f.page.locator("#mapped-poll-links a").waitFor({ state: "attached" });
  assert.equal(await f.page.locator("#mapped-poll-links a").count(), 1);
  assert.equal(
    await f.page.locator("#mapped-poll-links a").getAttribute("href"),
    `/vote/${poll.id}`,
  );
  // The only marker is centered by fitBounds; click the actual WebGL canvas.
  await f.page.waitForTimeout(600);
  const box = await f.page.locator("#poll-map canvas").boundingBox();
  await f.page
    .locator("#poll-map canvas")
    .click({ position: { x: box.width / 2, y: box.height / 2 } });
  await f.page.locator(".map-poll-link").waitFor();
  assert.match(
    await f.page.locator(".map-poll-link").innerText(),
    /Trees for our street/,
  );
  await f.page.getByRole("button", { name: "Ended", exact: true }).click();
  await f.page
    .getByText("No mapped posts match these filters.", { exact: false })
    .waitFor();
  await f.page.getByRole("button", { name: "Open", exact: true }).click();
  await f.page.locator("#map-count").filter({ hasText: "1 of 1" }).waitFor();
  await f.page.getByRole("button", { name: /Within 100 km/ }).click();
  await f.page.locator("#nearby[aria-pressed=true]").waitFor();
  await f.page.locator("#map-count").filter({ hasText: "1 of 1" }).waitFor();
  await f.context.setGeolocation({ latitude: 49.28, longitude: -123.12 });
  await f.page.getByRole("button", { name: /Within 100 km/ }).click();
  await f.page.getByRole("button", { name: /Within 100 km/ }).click();
  await f.page
    .getByText("No mapped posts match these filters.", { exact: false })
    .waitFor();
  await f.page.getByRole("button", { name: "List", exact: true }).click();
  assert.equal(await f.page.locator("#map-panel").isVisible(), false);
  assert.equal(await f.page.locator("#poll-map canvas").count(), 0);
  assert.deepEqual(f.errors, []);
});

test("map handles failure, offline and expiry without retaining markers in PWA caches", async (t) => {
  const f = await fixture(t);
  await f.store.create(f.input);
  await f.page.goto(f.origin + "/PostList");
  await f.page.evaluate(() => navigator.serviceWorker.ready);
  await mapReady(f.page);
  await f.context.setOffline(true);
  await f.page
    .locator("#map-count")
    .filter({ hasText: "You’re offline" })
    .waitFor();
  assert.equal(await f.page.locator("#mapped-poll-links a").count(), 0);
  await f.context.setOffline(false);
  await f.page.locator("#map-count").filter({ hasText: "1 of 1" }).waitFor();
  f.advance(30 * DAY);
  await f.page
    .getByRole("button", { name: "Fit all markers", exact: false })
    .click();
  await f.page
    .getByText("No mapped posts match these filters.", { exact: false })
    .waitFor();
  assert.equal(await f.page.locator("#mapped-poll-links a").count(), 0);
  const keys = await f.page.evaluate(async () => {
    const urls = [];
    for (const name of await caches.keys())
      for (const req of await (await caches.open(name)).keys())
        urls.push(req.url);
    return urls;
  });
  assert.ok(
    keys.every(
      (url) =>
        !url.includes("/api/") &&
        !url.includes("openfreemap") &&
        !url.includes("/vendor/"),
    ),
  );
  await f.context.route("**/api/map/search", (route) =>
    route.fulfill({ status: 503, json: { error: "Test map unavailable" } }),
  );
  await f.page
    .getByRole("button", { name: "Fit all markers", exact: false })
    .click();
  await f.page
    .locator("#list-error")
    .filter({ hasText: "Test map unavailable" })
    .waitFor();
  assert.deepEqual(f.errors, []);
});

test("visitors can search a chosen map area without geolocation permission", async (t) => {
  const f = await fixture(t);
  await f.context.clearPermissions();
  await f.page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = () => { throw new Error("Geolocation must not be called"); };
  });
  await f.store.create(f.input);
  await f.store.create({
    ...f.input,
    title: "Far away",
    location: { latitude: 49.28, longitude: -123.12 },
    mapVisible: false,
  });
  await f.page.goto(f.origin + "/PostList");
  await f.page.getByRole("button", { name: "Choose area on map" }).click();
  await f.page.locator("#map-message").filter({ hasText: "Select a dot" }).waitFor();
  await f.page.getByLabel("Search radius").selectOption("2");
  await f.page.getByRole("button", { name: "Search this area" }).click();
  await f.page.getByRole("button", { name: "List", exact: true }).click();
  await f.page.getByRole("link", { name: /Trees for our street/ }).waitFor();
  assert.equal(await f.page.getByRole("link", { name: /Far away/ }).count(), 0);
  assert.equal(await f.page.getByLabel("Sort posts").inputValue(), "nearest");
  assert.deepEqual(f.errors, []);
});

test("link-only publication skips location and public keyword search filters both views", async (t) => {
  const f = await fixture(t);
  await f.context.clearPermissions();
  await f.page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = () => { throw new Error("Geolocation must not be called"); };
  });
  await f.store.create({ ...f.input, title: "Library equipment", description: "A guide to the shared tools" });
  await f.store.create({ ...f.input, title: "Community garden" });
  await f.page.goto(f.origin + "/create");
  await f.page.getByLabel("The question").fill("Shared tools schedule");
  await f.page.getByLabel("Option 1", { exact: true }).fill("Before noon");
  await f.page.getByLabel("Option 2", { exact: true }).fill("After noon");
  await f.page.getByLabel("Your signature").fill("Neighbor");
  await f.page.getByLabel("Post visibility").selectOption("unlisted");
  assert.equal(await f.page.locator("#map-consent").isDisabled(), true);
  await f.page.reload();
  assert.equal(await f.page.getByLabel("Post visibility").inputValue(), "unlisted");
  assert.equal(await f.page.locator("#map-consent").isDisabled(), true);
  await f.page.locator("#retention").check();
  const creation = f.page.waitForResponse(response => response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/api/polls");
  await f.page.getByRole("button", { name: "Publish my poll" }).click();
  const response = await creation;
  assert.equal(response.status(), 201);
  const { id } = await response.json();
  const visitor = await f.context.newPage();
  const direct = await visitor.goto(`${f.origin}/vote/${id}`);
  assert.equal(direct.status(), 200);
  assert.match(direct.headers()["x-robots-tag"], /noindex/);
  await visitor.getByRole("heading", { name: "Shared tools schedule" }).waitFor();

  await f.page.goto(f.origin + "/PostList");
  await f.page.getByLabel("Search posts").fill("shared TOOLS");
  await f.page.getByRole("button", { name: "Search", exact: true }).click();
  await f.page.getByRole("link", { name: /Library equipment/ }).waitFor();
  assert.equal(await f.page.locator("#poll-list a").count(), 1);
  await mapReady(f.page);
  await f.page.getByText("Browse mapped posts without the map", { exact: true }).click();
  assert.equal(await f.page.locator("#mapped-poll-links a").count(), 1);
  assert.match(await f.page.locator("#mapped-poll-links a").innerText(), /Library equipment/);
  assert.deepEqual(f.errors, []);
});

test("mobile layout, explicit publishing consent and rapid view changes", async (t) => {
  const f = await fixture(t);
  await f.store.create({
    ...f.input,
    title: '<img src=x onerror="window.injected=true">',
  });
  await f.page.setViewportSize({ width: 320, height: 740 });
  await f.page.goto(f.origin + "/create");
  assert.equal(await f.page.locator("#map-consent").isChecked(), false);
  assert.equal(
    await f.page.locator("#map-consent").getAttribute("required"),
    "",
  );
  await f.page.goto(f.origin + "/PostList");
  await mapReady(f.page);
  assert.ok(
    await f.page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.equal(await f.page.evaluate(() => window.injected), undefined);
  assert.equal(await f.page.locator("#mapped-poll-links img").count(), 0);
  for (let n = 0; n < 3; n++) {
    await f.page.getByRole("button", { name: "List", exact: true }).click();
    await f.page.getByRole("button", { name: "Map", exact: true }).click();
  }
  await f.page.getByRole("button", { name: "List", exact: true }).click();
  await f.page.waitForTimeout(700);
  assert.equal(await f.page.locator("#poll-map canvas").count(), 0);
  assert.deepEqual(f.errors, []);
});

test("cluster expands and overlapping grid markers expose all polls safely", async (t) => {
  const f = await fixture(t);
  await f.store.create(f.input);
  await f.store.create({
    ...f.input,
    title: "Another question in the same area",
  });
  await f.page.goto(f.origin + "/PostList");
  await mapReady(f.page);
  await f.page
    .locator("#map-message")
    .filter({ hasText: "Select a dot" })
    .waitFor();
  await f.page.waitForTimeout(700);
  const canvas = f.page.locator("#poll-map canvas");
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await f.page.waitForTimeout(700);
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await f.page.locator(".map-poll-link").first().waitFor();
  assert.equal(await f.page.locator(".map-poll-link").count(), 2);
  assert.deepEqual(f.errors, []);

  await f.page.emulateMedia({ reducedMotion: "no-preference" });
  const normalDuration = await f.page.evaluate(async () => {
    const { clusterEaseDuration } = await import("/map.js");
    return {
      defaultMatch: clusterEaseDuration(),
      reduceTrue: clusterEaseDuration(() => ({ matches: true })),
      reduceFalse: clusterEaseDuration(() => ({ matches: false })),
      noMatchMedia: clusterEaseDuration(null),
    };
  });
  assert.deepEqual(normalDuration, {
    defaultMatch: 300,
    reduceTrue: 0,
    reduceFalse: 300,
    noMatchMedia: 300,
  });

  await f.page.emulateMedia({ reducedMotion: "reduce" });
  const reducedDuration = await f.page.evaluate(async () => {
    const { clusterEaseDuration } = await import("/map.js");
    return clusterEaseDuration();
  });
  assert.equal(reducedDuration, 0);
});
