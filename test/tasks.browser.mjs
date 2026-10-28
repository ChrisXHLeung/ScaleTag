import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import { createApp } from "../src/app.js";
import { PollStore, DAY } from "../src/store.js";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "scaletag-tasks-"));
  let now = Date.now(),
    app;
  const store = new PollStore(directory, { clock: () => now });
  await store.init();
  const server = createServer((req, res) => app(req, res)).listen(
    0,
    "127.0.0.1",
  );
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  app = createApp(store, { origin });
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
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  t.after(async () => {
    await browser.close();
    await new Promise((r) => server.close(r));
    await rm(directory, { recursive: true, force: true });
  });
  const input = {
    type: "task",
    title: "Help plant a community garden",
    description: "Bring a little time and a pair of gloves.",
    reward: "CAD 30 or a thank-you coffee",
    signature: "Neighbour",
    options: [],
    images: [],
    location: { latitude: 43.65, longitude: -79.38 },
    mapVisible: true,
  };
  return {
    origin,
    page,
    context,
    browser,
    store,
    input,
    errors,
    advance(ms) {
      now += ms;
    },
  };
}

test("anonymous task publication, persistent likes and public email reply work end to end", async (t) => {
  const f = await fixture(t);
  await f.page.goto(f.origin + "/create");
  await f.page.locator('.post-kind-switch a[href="/create/task"]').click();
  await f.page.getByLabel("Title", { exact: true }).fill(f.input.title);
  await f.page
    .getByLabel("Description", { exact: true })
    .fill(f.input.description);
  await f.page.getByLabel("Reward", { exact: true }).fill(f.input.reward);
  await f.page.locator("#task-map-consent").check();
  await f.page.locator("#task-retention").check();
  await f.page.getByRole("button", { name: "Publish my task" }).click();
  await f.page.waitForURL(/\/task\/[a-f0-9]{24}/);
  const id = new URL(f.page.url()).pathname.split("/").pop();
  await f.page.getByRole("heading", { name: f.input.title }).waitFor();
  await f.page.getByRole("heading", { name: f.input.reward }).waitFor();
  const like = f.page.locator("#like-post");
  await like.waitFor();
  await f.page.waitForFunction(
    () => !document.querySelector("#like-post").disabled,
  );
  await like.click();
  await f.page.locator('#like-post[aria-pressed="true"]').waitFor();
  assert.equal(await f.page.locator("#like-count").textContent(), "1");
  await f.page.reload();
  await f.page.locator('#like-post[aria-pressed="true"]').waitFor();
  await f.page
    .getByLabel("Your reply", { exact: true })
    .fill("I can help on Saturday.");
  await f.page.locator("#contact-consent").check();
  await f.page.locator("#send-reply").click();
  await f.page
    .locator("#reply-error")
    .filter({ hasText: "Provide a phone" })
    .waitFor();
  await f.page.locator("#reply-email").fill("helper@example.com");
  await f.page.locator("#send-reply").click();
  await f.page
    .locator("#reply-list")
    .getByText("I can help on Saturday.", { exact: true })
    .waitFor();
  assert.equal(
    await f.page.locator(".reply-contacts a").textContent(),
    "Email: helper@example.com",
  );
  const other = await f.browser.newContext();
  const second = await other.newPage();
  await second.goto(f.origin + `/task/${id}`);
  await second.waitForFunction(
    () => !document.querySelector("#like-post")?.disabled,
  );
  await second.locator("#like-post").click();
  await second.locator('#like-post[aria-pressed="true"]').waitFor();
  assert.equal(await second.locator("#like-count").textContent(), "2");
  assert.equal((await f.store.getSocial(id)).replies.length, 1);
  await other.close();
  assert.deepEqual(f.errors, []);
});

test("phone-only and dual-contact replies are escaped; polls have likes without reply fields", async (t) => {
  const f = await fixture(t),
    task = await f.store.create(f.input);
  await f.page.goto(f.origin + `/task/${task.id}`);
  await f.page.waitForFunction(
    () => !document.querySelector("#send-reply")?.disabled,
  );
  await f.page
    .locator("#reply-message")
    .fill('<img src=x onerror="window.injected=true">');
  await f.page.locator("#reply-phone").fill("+1 416 555 0123");
  await f.page.locator("#contact-consent").check();
  await f.page.locator("#send-reply").click();
  await f.page.locator(".reply-card").waitFor();
  assert.equal(await f.page.locator(".reply-card img").count(), 0);
  assert.equal(await f.page.evaluate(() => window.injected), undefined);
  f.advance(60000);
  await f.page.locator("#reply-message").fill("A second reply");
  await f.page.locator("#reply-phone").fill("416-555-0124");
  await f.page.locator("#reply-email").fill("both@example.com");
  await f.page.locator("#contact-consent").check();
  await f.page.locator("#send-reply").click();
  await f.page.waitForFunction(
    () => document.querySelectorAll(".reply-card").length === 2,
  );
  assert.equal(await f.page.locator(".reply-contacts a").count(), 3);
  const poll = await f.store.create({
    ...f.input,
    type: "poll",
    options: ["Yes", "No"],
  });
  await f.page.goto(f.origin + `/vote/${poll.id}`);
  await f.page.waitForFunction(
    () => !document.querySelector("#like-post")?.disabled,
  );
  await f.page.locator("#like-post").click();
  await f.page.locator('#like-post[aria-pressed="true"]').waitFor();
  assert.equal(await f.page.locator("#reply-form").count(), 0);
  assert.equal((await f.store.get(poll.id)).totalVotes, 0);
  assert.deepEqual(f.errors, []);
});

test("task and poll discovery filters work in list and real MapLibre; mobile form fits", async (t) => {
  const f = await fixture(t),
    task = await f.store.create(f.input);
  await f.store.create({
    ...f.input,
    type: "poll",
    title: "A poll nearby?",
    options: ["Yes", "No"],
  });
  await f.context.route("https://tiles.openfreemap.org/**", (route) =>
    route.request().url().includes("/styles/")
      ? route.fulfill({
          json: {
            version: 8,
            sources: {},
            glyphs:
              "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
            layers: [
              {
                id: "background",
                type: "background",
                paint: { "background-color": "#eef3f7" },
              },
            ],
          },
        })
      : route.fulfill({
          body: Buffer.alloc(0),
          contentType: "application/x-protobuf",
        }),
  );
  await f.page.goto(f.origin + "/VoteList");
  await f.page.locator("#content-type").selectOption("task");
  await f.page.waitForFunction(
    () => document.querySelectorAll(".task-list-card").length === 1,
  );
  assert.equal(await f.page.locator(".poll-list-card").count(), 1);
  await f.page.getByRole("button", { name: "Map", exact: true }).click();
  await f.page.waitForFunction(() =>
    document.querySelector("#map-count").textContent.includes("1 of 1"),
  );
  assert.equal(
    await f.page.locator("#mapped-poll-links a").getAttribute("href"),
    `/task/${task.id}`,
  );
  await f.page.locator("#content-type").selectOption("poll");
  await f.page.waitForFunction(() =>
    document
      .querySelector("#mapped-poll-links a")
      ?.getAttribute("href")
      .startsWith("/vote/"),
  );
  for (const path of ["/create/task", `/task/${task.id}`, "/VoteList"]) {
    await f.page.setViewportSize({ width: 320, height: 800 });
    await f.page.goto(f.origin + path);
    await f.page.waitForFunction(
      () => !document.querySelector(".loading-state"),
    );
    assert.ok(
      await f.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      path,
    );
  }
  assert.deepEqual(f.errors, []);
});

test("offline social writes are disabled, contacts are not cached, and task expiry removes replies", async (t) => {
  const f = await fixture(t),
    task = await f.store.create(f.input);
  await f.page.goto(f.origin + `/task/${task.id}`);
  await f.page.evaluate(() => navigator.serviceWorker.ready);
  await f.page.waitForFunction(
    () => !document.querySelector("#send-reply")?.disabled,
  );
  await f.context.setOffline(true);
  assert.equal(await f.page.locator("#like-post").isDisabled(), true);
  assert.equal(await f.page.locator("#send-reply").isDisabled(), true);
  assert.equal((await f.store.getSocial(task.id)).totalLikes, 0);
  await f.context.setOffline(false);
  await f.page.waitForFunction(
    () => !document.querySelector("#send-reply")?.disabled,
  );
  await f.page.locator("#reply-message").fill("A public reply");
  await f.page.locator("#reply-email").fill("expiry@example.com");
  await f.page.locator("#contact-consent").check();
  await f.page.locator("#send-reply").click();
  await f.page.locator(".reply-card").waitFor();
  const keys = await f.page.evaluate(async () => {
    const result = [];
    for (const name of await caches.keys())
      for (const key of await (await caches.open(name)).keys())
        result.push(key.url);
    return result;
  });
  assert.ok(
    keys.every((url) => !url.includes("/api/") && !url.includes("/task/")),
  );
  f.advance(30 * DAY);
  await f.page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await f.page
    .getByRole("heading", { name: "This page is unavailable." })
    .waitFor();
  assert.equal(
    await f.page.getByText("expiry@example.com", { exact: false }).count(),
    0,
  );
  assert.deepEqual(f.errors, []);
});
