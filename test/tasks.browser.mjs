import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
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
    directory,
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

test("anonymous task publication, persistent likes and private email reply work end to end", async (t) => {
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
  await f.page.waitForURL(/\/task\/[a-f0-9]{24}\/manage\?created=1$/);
  const id = new URL(f.page.url()).pathname.split("/")[2];
  await f.page.getByRole("heading", { name: f.input.title }).waitFor();
  await f.page.evaluate(() => {
    navigator.clipboard.writeText = async (text) => { window.copiedManagement = text; };
  });
  await f.page.getByRole("button", { name: "Copy URL and password" }).click();
  const message = await f.page.evaluate(() => window.copiedManagement);
  const [, url, password] = /^Management URL: (.+)\nManagement password: ([a-f0-9]{64})$/.exec(message);
  assert.equal(url, f.origin + `/task/${id}/manage`);
  assert.equal(new URL(f.page.url()).hash, "");
  const manager = await f.context.newPage();
  await manager.goto(url);
  await manager.getByLabel("Management password").fill("0".repeat(64));
  await manager.getByRole("button", { name: "Unlock" }).click();
  await manager.getByRole("alert").filter({ hasText: "invalid" }).waitFor();
  assert.equal(await manager.locator("[data-task-state]").count(), 0);
  await manager.getByLabel("Management password").fill(password);
  await manager.getByRole("button", { name: "Unlock" }).click();
  await manager.getByRole("heading", { name: "Manage this task" }).waitFor();
  await manager.close();
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
  await f.page.getByLabel("Management password").fill(password);
  await f.page.getByRole("button", { name: "Unlock" }).click();
  await f.page.locator('#like-post[aria-pressed="true"]').waitFor();
  await f.page.locator("#reply-message").fill("I can help on Saturday.");
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
    await f.page.locator("#private-reply-list .reply-contacts a").textContent(),
    "Email: helper@example.com",
  );
  assert.equal(await f.page.locator("#reply-list .reply-contacts").count(), 0);
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
  assert.equal(await second.locator(".reply-contacts").count(), 0);
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
  assert.equal(await f.page.locator(".reply-contacts").count(), 0);
  f.advance(60000);
  await f.page.locator("#reply-message").fill("A second reply");
  await f.page.locator("#reply-phone").fill("416-555-0124");
  await f.page.locator("#reply-email").fill("both@example.com");
  await f.page.locator("#contact-consent").check();
  await f.page.locator("#send-reply").click();
  await f.page.waitForFunction(
    () => document.querySelectorAll(".reply-card").length === 2,
  );
  assert.equal(await f.page.locator(".reply-contacts").count(), 0);
  await f.page.goto(f.origin + `/task/${task.id}/manage#key=${task.manageKey}`);
  await f.page.waitForFunction(
    () => document.querySelectorAll("#private-reply-list .reply-card").length === 2,
  );
  assert.equal(await f.page.locator("#private-reply-list .reply-contacts a").count(), 3);
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
  await f.page.goto(f.origin + "/PostList");
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
  for (const path of ["/create/task", `/task/${task.id}`, "/PostList"]) {
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

test("private management link changes progress; final states stop replies for every visitor", async (t) => {
  const f = await fixture(t),
    task = await f.store.create(f.input);
  const requests = [];
  f.page.on("request", (r) => requests.push(r.url()));
  // An incomplete or wrong link never shows management controls.
  await f.page.goto(f.origin + `/task/${task.id}/manage`);
  await f.page.getByLabel("Management password").waitFor();
  // Hash-only changes do not reload a page; reset between navigations.
  await f.page.goto("about:blank");
  await f.page.goto(f.origin + `/task/${task.id}/manage#key=${"0".repeat(64)}`);
  await f.page.getByText("management link is invalid", { exact: false }).waitFor();
  assert.equal(await f.page.locator("[data-task-state]").count(), 0);
  await f.page.goto("about:blank");
  await f.page.goto(f.origin + `/task/${task.id}/manage#key=${task.manageKey}`);
  await f.page.getByRole("heading", { name: "Manage this task" }).waitFor();
  assert.equal(await f.page.locator("#task-state").textContent(), "Open");
  assert.ok(
    (await f.page.locator("#manage-link").inputValue()).endsWith(
      `/task/${task.id}/manage#key=${task.manageKey}`,
    ),
  );
  await f.page.locator('[data-task-state="in_progress"]').click();
  await f.page.locator("#task-state", { hasText: "In progress" }).waitFor();
  assert.equal((await f.store.get(task.id)).taskState, "in_progress");
  // Public visitors see the status and may still reply while in progress.
  const other = await f.browser.newContext();
  const visitor = await other.newPage();
  await visitor.goto(f.origin + `/task/${task.id}`);
  await visitor.locator("#task-state", { hasText: "In progress" }).waitFor();
  assert.equal(await visitor.locator("[data-task-state]").count(), 0);
  assert.equal(await visitor.locator(".manage-card").count(), 0);
  await visitor.waitForFunction(
    () => !document.querySelector("#send-reply")?.disabled,
  );
  // Completing requires confirmation and is final.
  f.page.once("dialog", (d) => d.accept());
  await f.page.locator('[data-task-state="completed"]').click();
  await f.page.locator("#task-state", { hasText: "Completed" }).waitFor();
  await f.page.locator("#replies-closed", { hasText: "completed" }).waitFor();
  assert.equal(await f.page.locator("#reply-form").isHidden(), true);
  assert.equal(
    await f.page.locator('[data-task-state="open"]').isDisabled(),
    true,
  );
  await visitor.reload();
  await visitor.locator("#replies-closed", { hasText: "no longer accepts" }).waitFor();
  assert.equal(await visitor.locator("#reply-form").isHidden(), true);
  await other.close();
  // The secret never appears in any request URL.
  assert.ok(requests.every((url) => !url.includes(task.manageKey)));
  assert.deepEqual(f.errors, []);
});

test("public link copy fallback on the management page never exposes the private key", async (t) => {
  const f = await fixture(t),
    task = await f.store.create(f.input);
  // Simulate a browser that denies clipboard access.
  await f.page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
  });
  await f.page.goto(f.origin + `/task/${task.id}/manage#key=${task.manageKey}`);
  await f.page.getByRole("heading", { name: "Manage this task" }).waitFor();
  assert.equal(await f.page.locator("#public-link-fallback").isHidden(), true);
  await f.page.locator("#copy-task-link").click();
  const input = f.page.locator("#public-task-link");
  await input.waitFor({ state: "visible" });
  const publicLink = `${f.origin}/task/${task.id}`;
  assert.equal(await input.inputValue(), publicLink);
  assert.deepEqual(
    await input.evaluate((el) => [
      document.activeElement === el,
      el.selectionStart,
      el.selectionEnd,
    ]),
    [true, 0, publicLink.length],
  );
  const toast = await f.page.locator("#toast").textContent();
  assert.match(toast, /public task link/);
  assert.ok(!/address bar/i.test(toast));
  assert.ok(!toast.includes(task.manageKey));
  assert.ok(!(await input.inputValue()).includes(task.manageKey));
  assert.ok(!(await input.inputValue()).includes("manage"));
  assert.deepEqual(f.errors, []);
});

test("legacy tasks without management keys show explanation and prevent replies", async (t) => {
  const f = await fixture(t),
    task = await f.store.create(f.input);
  const path = join(f.directory, `${task.id}.json`),
    disk = JSON.parse(await readFile(path, "utf8"));
  delete disk.manageKeyHash;
  await writeFile(path, JSON.stringify(disk));
  await f.store.init();
  await f.page.goto(f.origin + `/task/${task.id}`);
  await f.page.waitForFunction(
    () => !document.querySelector(".loading-state"),
  );
  await f.page.locator("#replies-closed", { hasText: "no private management link" }).waitFor();
  assert.equal(await f.page.locator("#reply-form").isHidden(), true);
  assert.deepEqual(f.errors, []);
});

test("poll and task real photo uploads, >600 KiB compression, legacy external poll images, bilingual UI and 30-day expiry", async (t) => {
  const f = await fixture(t);
  const largePng = await sharp(randomBytes(500 * 500 * 3), {
    raw: { width: 500, height: 500, channels: 3 },
  })
    .withMetadata({ exif: { IFD0: { Artist: "Private creator" } } })
    .png()
    .toBuffer();
  assert.ok(largePng.length > 614400 && largePng.length <= 1048576);
  const smallPng = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#234567" },
  })
    .png()
    .toBuffer();

  // 1. Poll creation: photo limits (EN + ZH), real upload + compression, display on /vote/:id
  await f.page.goto(f.origin + "/create");
  assert.equal(await f.page.locator("#poll-images").getAttribute("type"), "file");
  await f.page.locator("#poll-images").setInputFiles({
    name: "too-big.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(1048577),
  });
  await f.page.locator("#poll-image-error", { hasText: "1 MiB" }).waitFor();
  await f.page.locator("#poll-images").setInputFiles([
    { name: "1.png", mimeType: "image/png", buffer: smallPng },
    { name: "2.png", mimeType: "image/png", buffer: smallPng },
    { name: "3.png", mimeType: "image/png", buffer: smallPng },
    { name: "4.png", mimeType: "image/png", buffer: smallPng },
  ]);
  await f.page.locator("#poll-image-error", { hasText: "no more than 3" }).waitFor();
  await f.page.locator("#poll-images").setInputFiles([]);
  await f.page.locator("#language-select").selectOption("zh");
  await f.page.getByRole("heading", { name: "创建投票" }).waitFor();
  await f.page.locator("#poll-images").setInputFiles({
    name: "too-big.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(1048577),
  });
  await f.page.locator("#poll-image-error", { hasText: "超过 1 MiB" }).waitFor();
  await f.page.locator("#poll-images").setInputFiles([]);
  await f.page.locator("#language-select").selectOption("en");
  await f.page.getByRole("heading", { name: "Your new poll" }).waitFor();

  await f.page.getByLabel("The question").fill("Which park bench design?");
  await f.page.getByRole("textbox", { name: "Option 1", exact: true }).fill("Cedar");
  await f.page.getByRole("textbox", { name: "Option 2", exact: true }).fill("Steel");
  await f.page.getByLabel("Your signature").fill("Planner");
  await f.page.locator("#poll-images").setInputFiles([
    { name: "bench-large.png", mimeType: "image/png", buffer: largePng },
    { name: "bench-small.png", mimeType: "image/png", buffer: smallPng },
  ]);
  await f.page.locator("#poll-photo-preview img").nth(1).waitFor();
  await f.page.locator("#map-consent").check();
  await f.page.locator("#retention").check();
  await f.page.getByRole("button", { name: "Publish my poll" }).click();
  await f.page.waitForURL(/\/vote\/[a-f0-9]{24}\?created=1$/);
  const pollId = new URL(f.page.url()).pathname.split("/")[2];
  assert.equal(await f.page.locator(".sale-photos img").count(), 2);
  assert.equal(await f.page.locator("#load-images").count(), 0);
  const storedPoll = await f.store.get(pollId);
  assert.equal(storedPoll.images.length, 2);
  const compressedPollBytes = Buffer.from(storedPoll.images[0].split(",")[1], "base64");
  assert.ok(compressedPollBytes.length <= 307200);
  assert.equal((await sharp(compressedPollBytes).metadata()).exif, undefined);

  // 2. Task creation: photo limits, real upload + compression, display on manage and public pages
  await f.page.goto(f.origin + "/create/task");
  assert.equal(await f.page.locator("#task-images").getAttribute("type"), "file");
  await f.page.locator("#task-images").setInputFiles({
    name: "too-big.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(1048577),
  });
  await f.page.locator("#task-image-error", { hasText: "1 MiB" }).waitFor();
  await f.page.getByLabel("Title", { exact: true }).fill("Repair garden gate");
  await f.page.getByLabel("Description", { exact: true }).fill("Hinge is loose; see photo.");
  await f.page.getByLabel("Reward", { exact: true }).fill("CAD 40");
  await f.page.locator("#task-images").setInputFiles({
    name: "gate.png",
    mimeType: "image/png",
    buffer: largePng,
  });
  await f.page.locator("#task-photo-preview img").waitFor();
  await f.page.locator("#task-map-consent").check();
  await f.page.locator("#task-retention").check();
  await f.page.getByRole("button", { name: "Publish my task" }).click();
  await f.page.waitForURL(/\/task\/[a-f0-9]{24}\/manage\?created=1$/);
  const taskId = new URL(f.page.url()).pathname.split("/")[2];
  assert.equal(await f.page.locator(".sale-photos img").count(), 1);
  const storedTask = await f.store.get(taskId);
  const compressedTaskBytes = Buffer.from(storedTask.images[0].split(",")[1], "base64");
  assert.ok(compressedTaskBytes.length <= 307200);
  assert.equal((await sharp(compressedTaskBytes).metadata()).exif, undefined);
  await f.page.goto(f.origin + `/task/${taskId}`);
  assert.equal(await f.page.locator(".sale-photos img").count(), 1);

  // 3. List endpoints never return large base64 images
  const listJson = await f.page.evaluate(async () => (await fetch("/api/posts")).json());
  assert.ok(!JSON.stringify(listJson).includes("data:image/"));

  // 4. Historical poll with external HTTPS image URL retains on-demand loading & privacy notice (EN + ZH)
  const legacyPoll = await f.store.create({
    title: "Historic external image poll",
    description: "Legacy external link",
    signature: "Archivist",
    options: ["Keep", "Replace"],
    images: ["https://example.test/legacy-photo.png"],
    location: { latitude: 43.65, longitude: -79.38 },
    mapVisible: true,
  });
  let externalRequested = 0;
  await f.context.route("https://example.test/legacy-photo.png", (route) => {
    externalRequested++;
    return route.fulfill({ body: smallPng, contentType: "image/png" });
  });
  await f.page.goto(f.origin + `/vote/${legacyPoll.id}`);
  await f.page.locator("#load-images", { hasText: "Show 1 external image" }).waitFor();
  await f.page.getByText("Images load from third-party hosts, which may receive your IP address.").waitFor();
  assert.equal(externalRequested, 0);
  assert.equal(await f.page.locator("#poll-images img").count(), 0);
  await f.page.locator("#language-select").selectOption("zh");
  await f.page.locator("#load-images", { hasText: "显示 1 张外部图片" }).waitFor();
  await f.page.getByText("图片从第三方服务器加载，该服务可能接收你的 IP 地址。").waitFor();
  assert.equal(externalRequested, 0);
  await f.page.locator("#load-images").click();
  await f.page.locator("#poll-images img").waitFor();
  assert.equal(externalRequested, 1);
  await f.page.locator("#language-select").selectOption("en");
  await f.page.locator("#load-images", { hasText: "Show 1 external image" }).waitFor();

  // 5. 30-day expiry removes poll, task and all photos
  f.advance(30 * DAY);
  for (const path of [`/vote/${pollId}`, `/task/${taskId}`, `/vote/${legacyPoll.id}`]) {
    const res = await f.page.goto(f.origin + path);
    assert.equal(res.status(), 404);
    assert.equal(await f.page.locator(".sale-photos img").count(), 0);
  }
  assert.deepEqual(f.errors, []);
});
