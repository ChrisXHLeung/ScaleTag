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

async function mapReady(page) {
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#poll-map canvas") !== null,
  );
  await page.waitForFunction(() =>
    document
      .querySelector("#map-count")
      .textContent.includes("matching mapped polls"),
  );
}

test("map is opt-in, renders real MapLibre markers, filters and provides accessible poll links", async (t) => {
  const f = await fixture(t);
  const poll = await f.store.create(f.input);
  await f.store.create({
    ...f.input,
    mapVisible: false,
    title: "Legacy list-only",
  });
  await f.page.goto(f.origin + "/VoteList");
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
    .getByText("No mapped polls match these filters.", { exact: false })
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
    .getByText("No mapped polls match these filters.", { exact: false })
    .waitFor();
  await f.page.getByRole("button", { name: "List", exact: true }).click();
  assert.equal(await f.page.locator("#map-panel").isVisible(), false);
  assert.equal(await f.page.locator("#poll-map canvas").count(), 0);
  assert.deepEqual(f.errors, []);
});

test("map handles failure, offline and expiry without retaining markers in PWA caches", async (t) => {
  const f = await fixture(t);
  await f.store.create(f.input);
  await f.page.goto(f.origin + "/VoteList");
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
    .getByText("No mapped polls match these filters.", { exact: false })
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
  await f.page.goto(f.origin + "/VoteList");
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
  await f.page.goto(f.origin + "/VoteList");
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
});
