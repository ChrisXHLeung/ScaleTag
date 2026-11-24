import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { PollStore, DAY } from "../src/store.js";
import { SecrexStore } from "../src/secrex-store.js";
import { serviceWorkerSource, STATIC_ASSETS } from "../src/pwa.js";
import { createTaskCredentials } from "../public/task-crypto.js";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "scaletag-pwa-"));
  let now = Date.now();
  const store = new PollStore(directory, { clock: () => now });
  await store.init();
  const secrex = new SecrexStore(directory, { clock: () => now });
  await secrex.init();
  let app, nextVersion = false;
  let unavailablePaths = new Map();
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname === "/healthz") {
      // The public ingress does not expose the internal health check.
      res.writeHead(404).end();
    } else if (unavailablePaths.has(pathname)) {
      res.writeHead(unavailablePaths.get(pathname)).end();
    } else if (req.url === "/sw.js" && nextVersion) {
      res.writeHead(200, {
        "Content-Type": "application/javascript",
        "Cache-Control": "no-store",
        "Service-Worker-Allowed": "/",
      });
      res.end(
        serviceWorkerSource().replace(
          "scaletag-static-",
          "scaletag-static-next-",
        ),
      );
    } else app(req, res);
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  app = createApp(store, { origin, secrex });
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    secrex.close();
    await rm(directory, { recursive: true, force: true });
  });
  const context = await browser.newContext({
    permissions: ["geolocation"],
    geolocation: { latitude: 0, longitude: 0 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  return {
    origin,
    browser,
    context,
    page,
    store,
    errors,
    nextVersion: () => {
      nextVersion = true;
    },
    setUnavailablePath: (paths = [], status = 503) => {
      unavailablePaths = new Map([paths].flat().map(path => [path, status]));
    },
    advance: (ms) => {
      now += ms;
    },
  };
}

async function cachedPaths(page) {
  const urls = await page.evaluate(async () => {
    const result = [];
    for (const name of await caches.keys()) {
      for (const key of await (await caches.open(name)).keys())
        result.push(key.url);
    }
    return result;
  });
  const origin = new URL(page.url()).origin;
  return urls
    .map((value) => {
      const url = new URL(value);
      assert.equal(url.origin, origin, "Never cache third-party resources");
      assert.equal(url.search, "", "Never cache query parameters");
      assert.ok(
        !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/vote/"),
        "Never cache poll data or poll URLs",
      );
      assert.ok(
        !["/", "/create", "/PostList", "/privacy"].includes(url.pathname),
        "Do not cache page responses",
      );
      return url.pathname;
    })
    .sort();
}

test(
  "PWA manifest, icons, static allowlist, online-only data and offline recovery",
  { timeout: 90000 },
  async (t) => {
    const f = await fixture(t);
    const { page, context, origin } = f;
    const response = await context.request.get(
      origin + "/manifest.webmanifest",
    );
    assert.equal(response.status(), 200);
    assert.match(response.headers()["content-type"], /manifest\+json/);
    const manifest = await response.json();
    assert.equal(manifest.id, "/");
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.start_url, "/");
    assert.equal(
      manifest.icons.filter((icon) => icon.purpose === "any").length,
      2,
    );
    for (const icon of manifest.icons) {
      const image = await context.request.get(origin + icon.src);
      const bytes = await image.body();
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.equal(
        `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`,
        icon.sizes,
      );
    }
    const worker = await context.request.get(origin + "/sw.js");
    assert.equal(worker.headers()["service-worker-allowed"], "/");
    assert.match(worker.headers()["cache-control"], /no-store/);
    assert.ok(!(await worker.text()).includes("__ASSET_VERSION__"));
    const cdp = await context.newCDPSession(page);
    const appManifest = await cdp.send("Page.getAppManifest");
    assert.deepEqual(appManifest.errors, []);
    assert.deepEqual(await cachedPaths(page), [...STATIC_ASSETS].sort());

    await page.goto(origin + "/create");
    await page.getByLabel("The question").fill("An isolated PWA test?");
    await page
      .getByRole("textbox", { name: "Option 1", exact: true })
      .fill("A");
    await page
      .getByRole("textbox", { name: "Option 2", exact: true })
      .fill("B");
    await page.getByLabel("Your signature").fill("Test");
    await page.locator("#map-consent").check();
    await page.locator("#retention").check();
    await page.getByRole("button", { name: "Publish my poll" }).click();
    await page.waitForURL(/\/vote\/[a-f0-9]{24}/);
    const id = new URL(page.url()).pathname.split("/").at(-1);
    await page.getByRole("radio", { name: "A", exact: true }).check();
    await page.getByRole("button", { name: "Cast my vote" }).click();
    await page.getByRole("button", { name: "Your vote is counted" }).waitFor();
    await page.evaluate(async (id) => {
      await fetch(`/api/polls/${id}/qr.png?download=1`);
      await fetch("/api/polls/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: { latitude: 0, longitude: 0 } }),
      });
    }, id);
    assert.deepEqual(await cachedPaths(page), [...STATIC_ASSETS].sort());
    assert.equal((await f.store.get(id)).totalVotes, 1);

    // On the already-open form, offline publication is rejected rather than queued.
    await page.goto(origin + "/create");
    await page.getByLabel("The question").fill("Never submitted offline");
    await page
      .getByRole("textbox", { name: "Option 1", exact: true })
      .fill("A");
    await page
      .getByRole("textbox", { name: "Option 2", exact: true })
      .fill("B");
    await page.getByLabel("Your signature").fill("Test");
    await page.getByRole("button", { name: "Enable location" }).click();
    await page
      .getByText("Location ready. You’re all set to publish.")
      .waitFor();
    await page.locator("#map-consent").check();
    await page.locator("#retention").check();
    await context.setOffline(true);
    await page.getByRole("button", { name: "Publish my poll" }).click();
    await page
      .locator("#form-error")
      .getByText(/offline/)
      .waitFor();
    assert.equal(f.store.index.size, 1);
    const voteUrl = `${origin}/vote/${id}?lang=en#ballot`;
    await page.goto(voteUrl);
    await page
      .getByRole("heading", { name: "Connection unavailable." })
      .waitFor();
    assert.ok(
      !(await page.locator("body").innerText()).includes(
        "An isolated PWA test?",
      ),
    );
    const apiOffline = await page.evaluate(async (id) => {
      try {
        await fetch(`/api/polls/${id}`);
        return false;
      } catch {
        return true;
      }
    }, id);
    assert.equal(apiOffline, true);
    assert.deepEqual(await cachedPaths(page), [...STATIC_ASSETS].sort());
    await context.setOffline(false);
    try {
      await page
        .getByRole("heading", { name: "An isolated PWA test?" })
        .waitFor({ timeout: 10000 });
    } catch (error) {
      console.log(
        "Reconnect diagnostics:",
        await page.evaluate(() => ({
          url: location.href,
          online: navigator.onLine,
          heading: document.querySelector("h1")?.textContent,
          scripts: [...document.scripts].map((s) => s.src),
          status: document.querySelector("#offline-status")?.textContent,
          resources: performance
            .getEntriesByType("resource")
            .map((r) => r.name),
        })),
      );
      throw error;
    }
    assert.equal(page.url(), voteUrl);
    assert.equal(f.store.index.size, 1); // No queued offline publication on reconnect.

    f.advance(30 * DAY);
    const expired = await page.reload();
    assert.equal(expired.status(), 404);
    await page
      .getByRole("heading", { name: "This page is unavailable." })
      .waitFor();
    assert.deepEqual(await cachedPaths(page), [...STATIC_ASSETS].sort());
    assert.deepEqual(f.errors, []);
  },
);

test("the browser restores public draft text and keeps saved post links locally", { timeout: 40000 }, async (t) => {
  const { page, origin } = await fixture(t);
  await page.goto(`${origin}/create`);
  await page.getByLabel("The question").fill("Neighborhood draft");
  await page.getByLabel("Option 1", { exact: true }).fill("Morning");
  await page.getByLabel("Option 2", { exact: true }).fill("Evening");
  await page.getByLabel("Your signature").fill("Test");
  await page.getByLabel("Voting duration").selectOption("6");
  await page.getByLabel("Show results").selectOption("after_close");
  await page.locator("#map-consent").check();
  await page.reload();
  assert.equal(await page.getByLabel("The question").inputValue(), "Neighborhood draft");
  assert.equal(await page.getByLabel("Option 2", { exact: true }).inputValue(), "Evening");
  assert.equal(await page.getByLabel("Voting duration").inputValue(), "6");
  assert.equal(await page.getByLabel("Show results").inputValue(), "after_close");
  assert.equal(await page.locator("#map-consent").isChecked(), false);
  await page.locator("#map-consent").check();
  await page.locator("#retention").check();
  await page.getByRole("button", { name: "Publish my poll" }).click();
  await page.waitForURL(/\/vote\/[a-f0-9]{24}/);
  await page.locator("#results-updated").getByText("Results will appear when voting closes.").waitFor();
  assert.equal(await page.locator("#results meter, #results progress").count(), 0);
  const path = new URL(page.url()).pathname;
  await page.getByRole("button", { name: "Save post" }).click();
  await page.goto(`${origin}/saved`);
  assert.equal(await page.getByRole("link", { name: "Neighborhood draft" }).getAttribute("href"), path);
  await page.getByRole("button", { name: "Remove" }).click();
  assert.equal(await page.getByRole("link", { name: "Neighborhood draft" }).count(), 0);
  await page.goto(`${origin}/create`);
  assert.equal(await page.getByLabel("The question").inputValue(), "");

  await page.getByLabel("The question").fill("Draft being published");
  await page.getByLabel("Option 1", { exact: true }).fill("Morning");
  await page.getByLabel("Option 2", { exact: true }).fill("Evening");
  await page.getByLabel("Your signature").fill("Test");
  await page.locator("#map-consent").check();
  await page.locator("#retention").check();
  await page.route(`${origin}/api/polls`, async (route) => {
    await page.getByLabel("The question").fill("Newer edit before the response");
    await route.continue();
  }, { times: 1 });
  await page.getByRole("button", { name: "Publish my poll" }).click();
  await page.getByRole("heading", { name: "Draft being published" }).waitFor();
  await page.goto(`${origin}/create`);
  assert.equal(await page.getByLabel("The question").inputValue(), "Newer edit before the response");
});

test("poll draft options can be reordered with the keyboard and retain their order on reload", async (t) => {
  const { page, origin } = await fixture(t);
  await page.goto(`${origin}/create`);
  await page.getByLabel("Option 1", { exact: true }).fill("Morning");
  await page.getByLabel("Option 2", { exact: true }).fill("Evening");
  await page.getByRole("button", { name: "Add an option", exact: true }).click();
  await page.getByLabel("Option 3", { exact: true }).fill("Afternoon");
  const firstUp = page.getByRole("button", { name: "Move option 1 up", exact: true });
  await firstUp.waitFor({ timeout: 5000 });
  assert.equal(await firstUp.isDisabled(), true);

  const thirdUp = page.getByRole("button", { name: "Move option 3 up", exact: true });
  await thirdUp.focus();
  await page.keyboard.press("Enter");
  const secondUp = page.getByRole("button", { name: "Move option 2 up", exact: true });
  assert.equal(await secondUp.evaluate(button => document.activeElement === button), true);
  await page.keyboard.press("Enter");
  const firstDown = page.getByRole("button", { name: "Move option 1 down", exact: true });
  assert.equal(await firstDown.evaluate(button => document.activeElement === button), true);
  const reordered = ["Afternoon", "Morning", "Evening"];
  const currentOptions = () => page.locator("#option-inputs input").evaluateAll(inputs => inputs.map(input => input.value));
  assert.deepEqual(await currentOptions(), reordered);
  await page.waitForFunction(expected => {
    const draft = JSON.parse(localStorage.getItem("scaletag-text-draft-poll"));
    return JSON.stringify(draft?.choices) === JSON.stringify(expected);
  }, reordered);
  await page.reload();
  await page.getByText("Text draft restored.", { exact: true }).waitFor();
  assert.deepEqual(await currentOptions(), reordered);
});

test("a poll owner can reorder choices until the first vote", async (t) => {
  const { page, origin, store } = await fixture(t);
  const poll = await store.create({ title: "Garden pickup schedule", options: ["Morning", "Evening"], visibility: "unlisted" });
  await page.goto(`${origin}/vote/${poll.id}/manage`);
  await page.getByLabel("Management password").fill(poll.manageKey);
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await page.getByText("Edit public details", { exact: true }).click();
  await page.getByRole("button", { name: "Move option 1 down", exact: true }).click({ timeout: 5000 });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Changes saved.", { exact: true }).waitFor();
  await page.goto(`${origin}/vote/${poll.id}`);
  assert.deepEqual(await page.locator("#vote-options label").allTextContents().then(labels => labels.map(label => label.trim())), ["Evening", "Morning"]);
  await page.getByRole("radio", { name: "Evening", exact: true }).check();
  await page.getByRole("button", { name: "Cast my vote" }).click();
  await page.getByRole("button", { name: "Your vote is counted" }).waitFor();
  await page.goto(`${origin}/vote/${poll.id}/manage`);
  await page.getByLabel("Management password").fill(poll.manageKey);
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await page.getByText("Edit public details", { exact: true }).click();
  await page.getByText("The poll question and options can change only before the first vote and before voting closes.", { exact: true }).waitFor();
  assert.equal(await page.locator(".poll-option-order").count(), 0);
});

test("a stale draft keeps local edits and requires a choice before replacing saved text", async (t) => {
  const { page, context, origin } = await fixture(t);
  const other = await context.newPage();
  await page.goto(`${origin}/create`);
  await page.getByLabel("The question").fill("Shared starting draft");
  await page.getByText("Text draft saved on this browser.").waitFor();
  await other.goto(`${origin}/create`);
  await other.getByLabel("The question").fill("Newer saved draft");
  await other.getByLabel("Post visibility").selectOption("unlisted");
  await other.getByText("Text draft saved on this browser.").waitFor();
  const key = "scaletag-text-draft-poll";
  const read = () => page.evaluate(key => localStorage.getItem(key), key);
  const saved = await read();
  await page.getByLabel("The question").fill("Unmerged local edit");
  const load = page.getByRole("button", { name: "Load saved draft", exact: true });
  const keep = page.getByRole("button", { name: "Replace saved draft", exact: true });
  await keep.waitFor({ timeout: 5000 });
  assert.equal(await read(), saved);
  assert.equal(await page.getByLabel("The question").inputValue(), "Unmerged local edit");

  page.once("dialog", dialog => dialog.dismiss());
  await keep.click();
  assert.equal(await read(), saved);
  page.once("dialog", dialog => dialog.accept());
  await load.click();
  await page.getByText("Text draft restored.").waitFor();
  assert.equal(await page.getByLabel("The question").inputValue(), "Newer saved draft");
  assert.equal(await page.getByLabel("Post visibility").inputValue(), "unlisted");
  assert.equal(await page.locator(".post-location-fields").isHidden(), true);

  await other.getByLabel("The question").fill("Still newer saved draft");
  await page.getByLabel("The question").fill("Explicit replacement");
  await keep.waitFor();
  page.once("dialog", dialog => dialog.accept());
  await keep.click();
  await page.getByText("Text draft saved on this browser.").waitFor();
  assert.match(await read(), /Explicit replacement/);
});

test("clearing or publishing from a stale create tab preserves another tab's draft", async (t) => {
  const { page, context, origin } = await fixture(t);
  await page.goto(`${origin}/create`);
  await page.getByLabel("The question").fill("Old tab poll to publish");
  await page.getByLabel("Option 1", { exact: true }).fill("First choice");
  await page.getByLabel("Option 2", { exact: true }).fill("Second choice");
  await page.getByLabel("Your signature").fill("Draft test");
  await page.getByLabel("Post visibility").selectOption("unlisted");
  const other = await context.newPage();
  await other.goto(`${origin}/create`);
  await other.getByLabel("The question").fill("Keep this newer draft");
  await other.getByText("Text draft saved on this browser.").waitFor();
  const read = () => other.evaluate(() => localStorage.getItem("scaletag-text-draft-poll"));
  const newer = await read();

  await page.getByRole("button", { name: "Clear draft", exact: true }).click();
  assert.equal(await read(), newer);
  assert.equal(await page.getByLabel("The question").inputValue(), "Old tab poll to publish");
  await page.getByRole("button", { name: "Replace saved draft", exact: true }).waitFor({ timeout: 5000 });
  await page.locator("#retention").check();
  await page.getByRole("button", { name: "Publish my poll" }).click();
  await page.getByRole("heading", { name: "Manage this poll" }).waitFor();
  assert.equal(await read(), newer);
});

test("owners can copy public text to a new draft without copying publication details", { timeout: 40000 }, async (t) => {
  const { page, origin, store, errors, context } = await fixture(t);
  const poll = await store.create({
    title: "Neighborhood meetup", description: "Bring a book.", signature: "Jules",
    options: ["Morning", "Afternoon"], visibility: "unlisted", votingHours: 6,
    resultsVisibility: "after_close", images: ["https://example.test/old-picture.jpg"],
    location: { latitude: 12.3456, longitude: 78.9123 },
  });
  const copy = page.getByRole("button", { name: "Copy to new draft" });
  const management = `${origin}/vote/${poll.id}/manage`;
  await page.goto(`${origin}/vote/${poll.id}`);
  await page.getByRole("heading", { name: poll.title }).waitFor();
  assert.equal(await copy.count(), 0);
  await page.goto(`${origin}/create`);
  await page.getByLabel("The question").fill("My existing draft");
  const draftKey = "scaletag-text-draft-poll";
  let before = await page.evaluate((key) => localStorage.getItem(key), draftKey);
  await page.goto(management);
  assert.equal(await copy.count(), 0);
  await page.getByLabel("Management password").fill(poll.manageKey);
  await page.getByRole("button", { name: "Unlock" }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await copy.click();
  assert.equal(page.url(), management);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), draftKey), before);

  const other = await context.newPage();
  await other.goto(`${origin}/create`);
  const nextDialog = page.waitForEvent("dialog");
  const copying = copy.click();
  const dialog = await nextDialog;
  await other.getByLabel("The question").fill("Newer draft from another tab");
  await dialog.accept();
  await copying;
  await page.getByText("The draft changed in another tab. Try again.").waitFor();
  assert.equal(page.url(), management);
  before = await page.evaluate((key) => localStorage.getItem(key), draftKey);
  assert.match(before, /Newer draft from another tab/);
  await other.close();

  await page.evaluate(() => {
    window.restoreDraftStorage = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, ...args) {
      if (key.startsWith("scaletag-text-draft-")) throw new DOMException("Disabled", "QuotaExceededError");
      return window.restoreDraftStorage.call(this, key, ...args);
    };
  });
  page.once("dialog", (dialog) => dialog.accept());
  await copy.click();
  await page.getByText("This browser cannot store this item.").waitFor();
  assert.equal(page.url(), management);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), draftKey), before);
  await page.evaluate(() => { Storage.prototype.setItem = window.restoreDraftStorage; });

  page.once("dialog", (dialog) => dialog.accept());
  await copy.click();
  await page.waitForURL(`${origin}/create`);
  assert.equal(await page.getByLabel("The question").inputValue(), poll.title);
  assert.equal(await page.locator("#description").inputValue(), "Bring a book.");
  assert.equal(await page.getByLabel("Option 2", { exact: true }).inputValue(), "Afternoon");
  assert.equal(await page.getByLabel("Your signature").inputValue(), "Jules");
  assert.equal(await page.getByLabel("Voting duration").inputValue(), "168");
  assert.equal(await page.getByLabel("Show results").inputValue(), "live");
  assert.equal(await page.getByLabel("Post visibility").inputValue(), "public");
  assert.equal(await page.locator("#map-consent").isChecked(), false);
  assert.equal(await page.locator("#retention").isChecked(), false);
  const snapshot = await page.evaluate((key) => localStorage.getItem(key), draftKey);
  for (const value of [poll.manageKey, poll.id, "old-picture.jpg", "12.3456", "78.9123", "after_close", "unlisted"]) {
    assert.equal(snapshot.includes(value), false);
  }
  assert.equal(store.storedCount(), 1);
  await page.locator("#map-consent").check();
  await page.locator("#retention").check();
  const response = page.waitForResponse((res) => res.url() === `${origin}/api/polls` && res.request().method() === "POST");
  await page.getByRole("button", { name: "Publish my poll" }).click();
  const published = await (await response).json();
  await page.getByRole("heading", { name: "Manage this poll" }).waitFor();
  assert.notEqual(published.id, poll.id);
  assert.notEqual(published.manageKey, poll.manageKey);
  assert.equal(store.storedCount(), 2);

  const { password, ...credentials } = await createTaskCredentials();
  const task = await store.create({
    ...credentials, type: "task", title: "Help with books", description: "Sort books by author.",
    signature: "Jules", reward: "Coffee", options: [], visibility: "unlisted",
  });
  await page.goto(`${origin}/task/${task.id}/manage`);
  await page.getByLabel("Management password").fill(password);
  await page.getByRole("button", { name: "Unlock" }).click();
  await copy.click();
  await page.waitForURL(`${origin}/create/task`);
  assert.equal(await page.locator("#task-title").inputValue(), task.title);
  assert.equal(await page.locator("#task-description").inputValue(), task.description);
  assert.equal(await page.locator("#task-reward").inputValue(), task.reward);
  assert.equal(await page.locator("#task-name").inputValue(), task.signature);
  assert.equal(await page.getByLabel("Post visibility").inputValue(), "public");

  const giveaway = await store.create({
    type: "sale", giveawayVersion: 1, title: "Free books", description: "Two used books.",
    signature: "Jules", pickupLocation: "Old pickup address", options: [], visibility: "unlisted",
    pickupWindow: { startsAt: Date.now() + 3600000, endsAt: Date.now() + 7200000 },
  });
  await page.goto(`${origin}/sale/${giveaway.id}/manage`);
  await page.getByLabel("Management password").fill(giveaway.manageKey);
  await page.getByRole("button", { name: "Unlock" }).click();
  await copy.click();
  await page.waitForURL(`${origin}/create/sale`);
  assert.equal(await page.locator("#sale-title").inputValue(), giveaway.title);
  assert.equal(await page.locator("#sale-description").inputValue(), giveaway.description);
  assert.equal(await page.locator("#sale-name").inputValue(), giveaway.signature);
  assert.equal(await page.locator("#pickup-location").inputValue(), "");
  assert.equal(await page.locator("#sale-pickup-start").inputValue(), "");
  assert.equal(await page.locator("#sale-pickup-end").inputValue(), "");
  assert.deepEqual(errors, []);
});

test("saved links show current public status and stay usable if status checks fail", async (t) => {
  const { store, page, origin, context, setUnavailablePath } = await fixture(t);
  const poll = await store.create({ title: "Only for the group", signature: "Test", visibility: "unlisted", options: ["A", "B"] });
  const managePath = `/vote/${poll.id}/manage`;
  const gonePath = `/task/${"0".repeat(24)}`;
  const saved = [{ path: managePath, title: poll.title }, { path: gonePath, title: "Old task" }];
  await page.evaluate(items => localStorage.setItem("scaletag-saved-posts", JSON.stringify(items)), saved);
  const lookup = page.waitForRequest(`${origin}/api/posts/statuses`, { timeout: 5000 });
  await page.goto(`${origin}/saved`);
  assert.deepEqual((await lookup).postDataJSON(), {
    posts: [{ type: "poll", id: poll.id }, { type: "task", id: "0".repeat(24) }],
  });
  const rows = page.locator(".saved-posts li");
  await rows.filter({ hasText: poll.title }).getByText("Open for votes", { exact: true }).waitFor();
  await rows.filter({ hasText: "Old task" }).getByText("Post link unavailable", { exact: true }).waitFor();
  assert.equal(await rows.first().locator("a").getAttribute("href"), managePath);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("scaletag-saved-posts"))), saved);

  setUnavailablePath("/api/posts/statuses");
  await page.reload();
  await rows.first().getByText("Could not check post status.", { exact: true }).waitFor();
  assert.equal(await rows.first().locator("a").getAttribute("href"), managePath);
  setUnavailablePath(undefined);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await rows.first().getByText("Open for votes", { exact: true }).waitFor();
  await rows.last().getByRole("button", { name: "Remove" }).click();
  assert.equal(await rows.count(), 1);

  const other = await context.newPage();
  await other.goto(origin);
  await store.setPollState(poll.id, poll.manageKey, "closed");
  await other.evaluate(items => localStorage.setItem("scaletag-saved-posts", JSON.stringify(items)), saved.slice().reverse());
  await page.bringToFront();
  await rows.last().getByText("Final results", { exact: true }).waitFor();
  assert.equal(await rows.last().locator("a").getAttribute("href"), managePath);
});

test("Saved links filter by local title and type without changing data or requesting again", async (t) => {
  const { store, page, context, origin } = await fixture(t);
  const poll = await store.create({ title: "Garden poll", options: ["A", "B"] });
  const entries = [
    { path: `/vote/${poll.id}/manage`, title: "Garden poll" },
    { path: `/sale/${"a".repeat(24)}`, title: "Ｇａｒｄｅｎ tools" },
    { path: `/task/${"b".repeat(24)}`, title: "Books task" },
  ];
  await page.evaluate(items => localStorage.setItem("scaletag-saved-posts", JSON.stringify(items)), entries);
  const requests = [];
  page.on("request", request => {
    if (request.url().startsWith(`${origin}/api/`)) requests.push(request.postDataJSON());
  });
  await page.goto(`${origin}/saved`);
  await page.getByText("Open for votes", { exact: true }).waitFor();
  const initialRequests = requests.length;
  const search = page.getByLabel("Search saved links", { exact: true });
  const type = page.getByLabel("Post type", { exact: true });
  const rows = page.locator(".saved-posts li:visible");
  await search.fill(" GARDEN ", { timeout: 5000 });
  await rows.filter({ hasText: "Ｇａｒｄｅｎ tools" }).waitFor();
  assert.equal(await rows.count(), 2);
  await type.selectOption("sale");
  assert.equal(await rows.count(), 1);
  await search.fill("private test query without results");
  await page.getByText("No saved links match these filters.", { exact: true }).waitFor();
  assert.equal(await rows.count(), 0);
  await page.getByRole("button", {name:"Clear all filters", exact:true}).click();
  assert.equal(await rows.count(), 3);
  assert.equal(requests.length, initialRequests);
  assert.equal(page.url(), `${origin}/saved`);
  await context.setOffline(true);
  await search.fill("garden poll");
  assert.equal(await rows.count(), 1);
  assert.equal(await rows.getByRole("link").getAttribute("href"), entries[0].path);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("scaletag-saved-posts"))), entries);
});

test("saved links can be copied directly and manually when clipboard access is denied", async (t) => {
  const { page, context, origin } = await fixture(t);
  const id = "a".repeat(24);
  const paths = [`/vote/${id}`, `/vote/${id}/manage`];
  await page.evaluate(paths => localStorage.setItem("scaletag-saved-posts", JSON.stringify([
    { path: paths[0], title: "Garden poll" },
    { path: paths[1], title: "Manage garden poll", password: "must-not-be-copied" },
  ])), paths);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.goto(`${origin}/saved?lang=en`);

  const publicRow = page.locator(".saved-posts li").filter({ has: page.getByRole("link", { name: "Garden poll", exact: true }) });
  await publicRow.getByRole("button", { name: "Copy link", exact: true }).click({ timeout: 5000 });
  await publicRow.getByText("Link copied.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${origin}${paths[0]}`);

  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new DOMException("Denied", "NotAllowedError"); };
  });
  const managementRow = page.locator(".saved-posts li").filter({ hasText: "Manage garden poll" });
  await managementRow.getByRole("button", { name: "Copy management URL", exact: true }).click();
  const fallback = managementRow.getByRole("textbox", { name: "Management URL", exact: true });
  await fallback.waitFor();
  assert.equal(await fallback.inputValue(), `${origin}${paths[1]}`);
  assert.equal(await fallback.evaluate(input => document.activeElement === input &&
    input.selectionStart === 0 && input.selectionEnd === input.value.length), true);
  assert.equal(new URL(page.url()).pathname, "/saved");
});

test("Saved links can be opened offline from the fallback and refresh on reconnect", async (t) => {
  const { store, page, context, origin } = await fixture(t);
  const poll = await store.create({ title: "Local garden vote", options: ["Yes", "No"] });
  const path = `/vote/${poll.id}/manage`;
  await page.evaluate(([path, title]) => localStorage.setItem("scaletag-saved-posts", JSON.stringify([{ path, title }])), [path, poll.title]);
  const requests = [];
  page.on("request", request => {
    if (request.url().startsWith(`${origin}/api/`)) requests.push(request.url());
  });
  await context.setOffline(true);
  await page.goto(`${origin}/privacy`);
  await page.getByRole("heading", { name: "Connection unavailable.", exact: true }).waitFor();
  await page.getByRole("link", { name: "Saved links", exact: true }).click({ timeout: 5000 });
  await page.getByRole("heading", { name: "Saved links", exact: true }).waitFor();
  await page.getByText("Reconnect to open posts and check their current status.", { exact: true }).waitFor();
  const row = page.locator(".saved-posts li");
  assert.equal(await row.getByRole("link").getAttribute("href"), path);
  assert.equal(await row.locator(".saved-post-status").count(), 0);
  await page.getByLabel("Search saved links", { exact: true }).fill("Garden");
  assert.equal(await row.isVisible(), true);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await row.getByRole("button", { name: "Copy management URL", exact: true }).click({ timeout: 5000 });
  await row.getByText("Link copied.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${origin}${path}`);
  assert.deepEqual(requests, []);
  assert.deepEqual(await cachedPaths(page), [...STATIC_ASSETS].sort());
  await context.setOffline(false);
  await row.getByText("Open for votes", { exact: true }).waitFor();
  assert.equal(page.url(), `${origin}/saved`);
});

test("a server outage can use cached static assets for the offline Saved page", async (t) => {
  const { page, origin, setUnavailablePath } = await fixture(t);
  await page.evaluate(() => localStorage.setItem("scaletag-saved-posts", JSON.stringify([
    { path: `/sale/${"a".repeat(24)}`, title: "Saved through an outage" },
  ])));
  setUnavailablePath(["/saved", "/styles.css", "/offline.js", "/local-posts.js"]);
  await page.goto(`${origin}/saved`);
  await page.getByRole("link", { name: "Saved through an outage", exact: true }).waitFor({ timeout: 5000 });
  await page.getByText("Reconnect to open posts and check their current status.", { exact: true }).waitFor();
  assert.deepEqual(await cachedPaths(page), [...STATIC_ASSETS].sort());

  setUnavailablePath("/favicon.svg", 404);
  assert.equal(await page.evaluate(async () => (await fetch("/favicon.svg")).status), 404);
  setUnavailablePath(["/icons/icon-512.png", "/api/visits"]);
  const statuses = await page.evaluate(async () => {
    for (const cacheName of await caches.keys()) await (await caches.open(cacheName)).delete("/icons/icon-512.png");
    return Promise.all(["/icons/icon-512.png", "/api/visits"].map(async path => (await fetch(path)).status));
  });
  assert.deepEqual(statuses, [503, 503]);
});

test("an open Saved page refreshes when a giveaway hold ends", async (t) => {
  const { store, page, origin, advance } = await fixture(t);
  const giveaway = await store.create({
    type: "sale", giveawayVersion: 1, visibility: "unlisted", title: "Held books", options: [],
  });
  const remaining = 1000;
  await store.setSaleState(giveaway.id, giveaway.manageKey, "reserved", giveaway.createdAt + remaining);
  const path = `/sale/${giveaway.id}`;
  await page.evaluate(item => localStorage.setItem("scaletag-saved-posts", JSON.stringify([item])), {
    path, title: giveaway.title,
  });
  await page.goto(`${origin}/saved`);
  const status = page.locator(".saved-post-status");
  await status.getByText("Reserved", { exact: true }).waitFor();
  advance(remaining);
  await status.getByText("Available", { exact: true }).waitFor({ timeout: 5000 });
});

test("post detail and management save buttons reflect changes in another tab", async (t) => {
  const { store, page, context, origin } = await fixture(t);
  const poll = await store.create({ title: "Save from two tabs", options: ["A", "B"] });
  const publicPath = `/vote/${poll.id}`;
  const managementPath = `${publicPath}/manage`;
  const saved = await context.newPage();
  for (const [path, label] of [[publicPath, "Save post"], [managementPath, "Save management link"]]) {
    await page.goto(`${origin}${path}`);
    if (path === managementPath) {
      await page.getByLabel("Management password").fill(poll.manageKey);
      await page.getByRole("button", { name: "Unlock", exact: true }).click();
    }
    await page.getByRole("button", { name: label, exact: true }).click();
    await saved.goto(`${origin}/saved`);
    await saved.getByRole("button", { name: "Remove", exact: true }).click();
    const button = page.getByRole("button", { name: label, exact: true });
    await button.waitFor({ timeout: 5000 });
    assert.equal(await button.getAttribute("aria-pressed"), "false");
  }
});

test("poll readers can manually copy a public URL when clipboard access is denied", async (t) => {
  const { page, origin, store } = await fixture(t);
  const poll = await store.create({ title: "Poll link fallback", options: ["Yes", "No"], visibility: "unlisted" });
  const publicUrl = `${origin}/vote/${poll.id}`;
  await page.goto(`${publicUrl}?created=1#local-fragment`);
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new DOMException("Denied", "NotAllowedError"); };
  });
  await page.getByRole("button", { name: "Copy poll link", exact: true }).click();
  const link = page.getByLabel("Public link", { exact: true });
  await link.waitFor({ timeout: 5000 });
  assert.equal(await link.inputValue(), publicUrl);
  assert.deepEqual(await link.evaluate(input => [document.activeElement === input, input.selectionStart, input.selectionEnd]),
    [true, 0, publicUrl.length]);
});

test("a poll owner can share the public URL directly from the management page", async (t) => {
  const { page, context, origin, store } = await fixture(t);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const poll = await store.create({ title: "Owner share shortcut", options: ["Yes", "No"], visibility: "unlisted" });
  const publicUrl = `${origin}/vote/${poll.id}`;
  await page.goto(`${publicUrl}/manage?created=1#local-fragment`);
  await page.getByLabel("Management password").fill(poll.manageKey);
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  const copy = page.getByRole("button", { name: "Copy public link", exact: true });
  await copy.click({ timeout: 5000 });
  await page.getByText("Poll link copied.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), publicUrl);

  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new DOMException("Denied", "NotAllowedError"); };
  });
  await copy.click();
  assert.equal(await page.getByLabel("Public link", { exact: true }).inputValue(), publicUrl);
  assert.equal(new URL(page.url()).pathname, `/vote/${poll.id}/manage`);
});

test("new poll owner can copy management details, edit photos, end and take down", { timeout: 60000 }, async (t) => {
  const { page, context, origin } = await fixture(t);
  await context.grantPermissions(["geolocation", "clipboard-read", "clipboard-write"], { origin });
  await page.goto(`${origin}/create`);
  await page.getByLabel("The question").fill("A question for our street");
  await page.getByLabel("Option 1", { exact: true }).fill("Today");
  await page.getByLabel("Option 2", { exact: true }).fill("Tomorrow");
  await page.getByLabel("Your signature").fill("Test");
  await page.locator("#map-consent").check();
  await page.locator("#retention").check();
  const creation = page.waitForResponse(response =>
    response.url() === `${origin}/api/polls` && response.request().method() === "POST");
  await page.getByRole("button", { name: "Publish my poll" }).click();
  const response = await creation;
  assert.equal(response.status(), 201);
  const { id, manageKey } = await response.json();
  await page.getByRole("heading", { name: "Manage this poll" }).waitFor();
  assert.equal(new URL(page.url()).pathname, `/vote/${id}`);
  assert.ok(!page.url().includes(manageKey));
  await page.getByRole("button", { name: "Copy URL and password" }).click();
  await page.getByText("Management details copied.", { exact: true }).waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(copied.includes(manageKey) && copied.includes(`/vote/${id}/manage`));

  const visitor = await context.newPage();
  await visitor.goto(`${origin}/vote/${id}`);
  await visitor.getByRole("heading", { name: "A question for our street" }).waitFor();

  await page.getByRole("link", { name: "Open poll management" }).click();
  await page.getByLabel("Management password").fill(manageKey);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.getByText("Edit public details", { exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("A clearer question for our street");
  await page.getByLabel("Option 1", { exact: true }).fill("This week");
  await page.locator("#owner-images").setInputFiles("public/icons/icon-192.png");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Changes saved.", { exact: true }).waitFor();
  await visitor.evaluate(() => window.dispatchEvent(new Event("online")));
  await visitor.getByRole("heading", { name: "A clearer question for our street" }).waitFor();
  await visitor.getByRole("radio", { name: "This week" }).check();
  await visitor.reload();
  await visitor.locator(".sale-photos img").waitFor();
  await visitor.getByRole("radio", { name: "This week" }).check();
  await visitor.getByRole("button", { name: "Cast my vote" }).click();
  await visitor.getByRole("button", { name: "Your vote is counted" }).waitFor();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "End voting now" }).click();
  await page.getByText("Voting closed", { exact: true }).waitFor();
  await visitor.reload();
  await visitor.locator("#total-votes").getByText("1 vote").waitFor();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Take down" }).click();
  await page.getByRole("heading", { name: "This poll has been taken down." }).waitFor();
  assert.equal((await visitor.reload()).status(), 404);
  assert.equal((await context.request.get(`${origin}/api/polls/${id}/qr.png`)).status(), 404);
});

test("manual retry restores the original page once the public route responds", { timeout: 40000 }, async (t) => {
  const { context, errors, origin, page, setUnavailablePath } = await fixture(t);
  const path = "/vote/000000000000000000000000";
  const url = `${origin}${path}?lang=en#ballot`;
  assert.equal((await context.request.get(`${origin}/healthz`)).status(), 404);
  // Pause automatic retries so only the click can restore the page.
  const time = Date.now();
  await page.clock.install({ time });
  await page.clock.pauseAt(time + 60000);
  setUnavailablePath(path);
  await page.goto(url);
  await page.getByRole("heading", { name: "Connection unavailable." }).waitFor();
  const status = page.locator("#offline-status");
  await status.getByText(/ScaleTag is not reachable yet/).waitFor();
  setUnavailablePath();
  const navigation = page.waitForResponse(
    (response) => response.request().isNavigationRequest() &&
      response.status() === 404 && new URL(response.url()).pathname === path,
  );
  await page.locator("#retry-connection").click();
  await navigation;
  await page.getByRole("heading", { name: "This page is unavailable." }).waitFor();
  assert.equal(page.url(), url);
  assert.deepEqual(errors, []);
});

test(
  "install help, native prompt, standalone mode and mobile layout",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const { page } = f;
    await page
      .getByRole("button", { name: "Install app", exact: true })
      .click();
    await page.getByRole("dialog", { name: "Install ScaleTag" }).waitFor();
    await page.getByText(/Open ScaleTag in Safari/).waitFor();
    await page
      .getByRole("button", { name: "Close installation guide" })
      .click();
    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      event.prompt = async () => {};
      event.userChoice = Promise.resolve({ outcome: "accepted" });
      dispatchEvent(event);
    });
    await page
      .getByRole("button", { name: "Install app", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Install ScaleTag", exact: true })
      .click();
    assert.equal(
      await page.locator("#install-dialog").evaluate((e) => e.open),
      false,
    );
    assert.equal(await page.locator("#install-app").isVisible(), false);
    const standalone = await f.browser.newContext();
    await standalone.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query) =>
        query === "(display-mode: standalone)"
          ? { matches: true, addEventListener() {} }
          : original(query);
    });
    const installed = await standalone.newPage();
    await installed.goto(f.origin);
    assert.equal(await installed.locator("#install-app").isVisible(), false);
    await page.reload();
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await page
        .getByRole("button", { name: "Install app", exact: true })
        .click();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      assert.ok(
        await page
          .locator("#install-dialog")
          .evaluate((e) => e.scrollWidth <= e.clientWidth),
      );
      await page
        .getByRole("button", { name: "Close installation guide" })
        .click();
    }
    assert.deepEqual(f.errors, []);
  },
);

test(
  "new worker waits for user approval, preserves draft, and clears old static cache",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const { page } = f;
    await page.goto(f.origin + "/create");
    await page.getByLabel("The question").fill("Keep this unsent draft");
    const originalCache = await page.evaluate(() => caches.keys());
    f.nextVersion();
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration.update();
    });
    await page.locator("#app-update").waitFor({ state: "visible" });
    assert.equal(
      await page.getByLabel("The question").inputValue(),
      "Keep this unsent draft",
    );
    await page.getByRole("button", { name: "Later", exact: true }).click();
    assert.equal(
      await page.getByLabel("The question").inputValue(),
      "Keep this unsent draft",
    );
    // A fresh visit can still show the waiting update and restore the local text.
    await page.reload();
    await page.locator("#app-update").waitFor({ state: "visible" });
    await page.getByLabel("The question").fill("Explicitly reload this draft");
    await page.getByRole("button", { name: "Update & reload" }).click();
    await page.waitForFunction(async (old) => {
      const keys = await caches.keys();
      return (
        keys.length === 1 &&
        !old.includes(keys[0]) &&
        !document.querySelector("#app-update")?.offsetHeight
      );
    }, originalCache);
    assert.equal(await page.getByLabel("The question").inputValue(), "Explicitly reload this draft");
    assert.deepEqual(await cachedPaths(page), [...STATIC_ASSETS].sort());
    assert.deepEqual(f.errors, []);
  },
);

test(
  "homepage QR leads to platform-specific installation; Android confirms directly",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const image = f.page.getByRole("img", {
      name: "QR code for the ScaleTag installation guide",
    });
    await image.waitFor();
    assert.equal(await image.getAttribute("src"), "/install/qr.png");
    const qr = await f.context.request.get(f.origin + "/install/qr.png", {
      headers: { host: "untrusted.example" },
    });
    assert.equal(qr.status(), 200);
    assert.equal(qr.headers()["content-type"], "image/png");
    await f.page
      .getByRole("link", { name: "Open the installation guide" })
      .click();
    // A changed URL can precede attachment of the destination document.
    // Wait for the guide itself before testing a direct reload.
    await f.page
      .getByRole("heading", { name: "Install ScaleTag.", exact: true })
      .waitFor();
    assert.equal(new URL(f.page.url()).pathname, "/install");
    assert.equal((await f.page.reload()).status(), 200);

    const iphone = await f.browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    });
    const ios = await iphone.newPage();
    await ios.goto(f.origin + "/install");
    assert.equal(
      await ios
        .locator('[data-install-platform="ios"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await ios.locator('[data-platform-panel="ios"]').isVisible(),
      true,
    );
    assert.equal(
      await ios.locator('[data-platform-panel="android"]').isVisible(),
      false,
    );
    await ios.getByRole("heading", { name: "Tap Share" }).waitFor();
    await ios
      .getByRole("heading", { name: "Add to Home Screen", exact: true })
      .waitFor();
    assert.equal(await ios.locator("#install-page-native").isVisible(), false);
    await ios.setViewportSize({ width: 320, height: 844 });
    assert.ok(
      await ios.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await ios.getByRole("button", { name: "Android / desktop" }).click();
    assert.equal(
      await ios.locator('[data-platform-panel="android"]').isVisible(),
      true,
    );

    const android = await f.browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      userAgent:
        "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36",
    });
    const phone = await android.newPage();
    await phone.goto(f.origin + "/install");
    assert.equal(
      await phone
        .locator('[data-install-platform="android"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    await phone.evaluate(() => {
      window.installRequests = 0;
      const event = new Event("beforeinstallprompt", { cancelable: true });
      event.prompt = async () => {
        window.installRequests++;
        dispatchEvent(new Event("appinstalled"));
      };
      event.userChoice = Promise.resolve({ outcome: "accepted" });
      dispatchEvent(event);
    });
    await phone.locator("#install-page-native").click();
    assert.equal(await phone.evaluate(() => window.installRequests), 1);
    assert.match(
      await phone.locator(".install-page-note").innerText(),
      /Publishing/,
    );
    assert.equal(await phone.locator("#install-page-done").isVisible(), true);
    assert.equal(
      await phone.locator("#install-page-native").isVisible(),
      false,
    );
    assert.equal(f.store.index.size, 0);
    assert.deepEqual(f.errors, []);
  },
);

test(
  "vote page polling skips unchanged DOM writes, recovers its hint, survives bfcache and stops after 404",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const { page, origin, store } = f;
    const poll = await store.create({
      title: "Polling regression poll", description: "", signature: "Tester",
      options: ["Yes", "No"], visibility: "unlisted", votingHours: 6, images: [],
      location: { latitude: 0, longitude: 0 },
    });
    const apiPath = `/api/polls/${poll.id}`;
    let apiRequests = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === apiPath) apiRequests++;
    });
    // Track the vote page's 15s refresh interval so the test can fire it on
    // demand instead of waiting in real time.
    await page.addInitScript(() => {
      const setI = window.setInterval;
      const clearI = window.clearInterval;
      window.__pollTimers = new Map();
      window.setInterval = function (fn, ms, ...rest) {
        const handle = setI.call(this, fn, ms, ...rest);
        // mountSocial also registers a 15s `refresh` (for /api/posts/:id/social);
        // only track the vote page's own poller, which fetches /api/polls/:id.
        if (
          ms === 15000 &&
          fn?.name === "refresh" &&
          String(fn).includes("/api/polls/")
        )
          window.__pollTimers.set(handle, fn);
        return handle;
      };
      window.clearInterval = function (handle) {
        window.__pollTimers.delete(handle);
        return clearI.call(this, handle);
      };
      window.__tickPoll = () => {
        for (const fn of window.__pollTimers.values()) void fn();
        return window.__pollTimers.size;
      };
    });
    const tick = async () => {
      const response = page.waitForResponse(
        (r) => new URL(r.url()).pathname === apiPath,
      );
      assert.equal(await page.evaluate(() => window.__tickPoll()), 1);
      await response;
      await page.waitForTimeout(250);
    };
    const hint = "Results refresh every 15 seconds while this page is visible.";

    await page.goto(`${origin}/vote/${poll.id}`);
    await page.getByRole("heading", { name: poll.title }).waitFor();
    await page.locator("#results meter").first().waitFor();
    assert.equal(await page.locator("#total-votes").getAttribute("aria-live"), "polite");
    assert.equal(await page.locator("#results-updated").textContent(), hint);

    // 1. Unchanged data on a 15s refresh does not touch #total-votes/#results.
    await page.evaluate(() => {
      window.__mutations = 0;
      const observer = new MutationObserver((records) => {
        window.__mutations += records.length;
      });
      for (const selector of ["#total-votes", "#results"])
        observer.observe(document.querySelector(selector), {
          childList: true, subtree: true, characterData: true, attributes: true,
        });
    });
    await tick();
    await tick();
    assert.equal(await page.evaluate(() => window.__mutations), 0);

    // 2. A single failed refresh shows the error; the next success restores the hint.
    f.setUnavailablePath(apiPath);
    await tick();
    await page.locator("#results-updated").getByText(/Could not refresh results/).waitFor();
    f.setUnavailablePath(undefined);
    await tick();
    await page.locator("#results-updated").getByText(hint).waitFor();

    // 3. pagehide(persisted) stops polling; pageshow(persisted) resumes it and refreshes.
    await page.evaluate(() =>
      dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
    );
    assert.equal(await page.evaluate(() => window.__pollTimers.size), 0);
    const resumed = page.waitForResponse(
      (r) => new URL(r.url()).pathname === apiPath,
    );
    await page.evaluate(() =>
      dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
    );
    await resumed;
    assert.equal(await page.evaluate(() => window.__pollTimers.size), 1);
    await page.waitForTimeout(250);

    // 4. After a 404 polling stops for good: no timer and `online` sends nothing.
    f.advance(30 * DAY);
    await tick();
    await page.getByRole("heading", { name: "This page is unavailable." }).waitFor();
    assert.equal(await page.evaluate(() => window.__pollTimers.size), 0);
    const before = apiRequests;
    await page.evaluate(() => {
      dispatchEvent(new Event("online"));
      dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await page.waitForTimeout(500);
    assert.equal(apiRequests, before);
    assert.equal(await page.evaluate(() => window.__pollTimers.size), 0);
    assert.deepEqual(f.errors, []);
  },
);

test(
  "poll results render accessible <meter> bars and vote-page 404 stops social polling",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const { page, origin, store } = f;
    const poll = await store.create({
      title: "Meter regression poll", description: "", signature: "Tester",
      options: ["Yes", "No"], votingHours: 6, images: [],
      location: { latitude: 0, longitude: 0 },
    });
    const socialPath = `/api/posts/${poll.id}/social`;
    let socialRequests = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === socialPath) socialRequests++;
    });
    const readMeter = (locator) =>
      locator.evaluate((m) => ({
        tag: m.tagName.toLowerCase(),
        min: m.getAttribute("min"),
        max: m.getAttribute("max"),
        value: m.getAttribute("value"),
        label: m.getAttribute("aria-label"),
        valuetext: m.getAttribute("aria-valuetext"),
        low: m.hasAttribute("low") || m.hasAttribute("high") || m.hasAttribute("optimum"),
        height: getComputedStyle(m).height,
      }));

    // 1. Vote page: <meter> with min/max/value, a plain label and localized valuetext.
    await page.goto(`${origin}/vote/${poll.id}`);
    await page.getByRole("heading", { name: poll.title }).waitFor();
    await page.getByRole("radio", { name: "Yes", exact: true }).check();
    await page.getByRole("button", { name: "Cast my vote" }).click();
    await page.getByRole("button", { name: "Your vote is counted" }).waitFor();
    await page.locator("#results meter").first().waitFor();
    assert.equal(await page.locator("#results progress").count(), 0);
    assert.equal(await page.locator("#results meter").count(), 2);
    const [yes, no] = await Promise.all([
      readMeter(page.locator("#results meter").nth(0)),
      readMeter(page.locator("#results meter").nth(1)),
    ]);
    assert.deepEqual(yes, {
      tag: "meter", min: "0", max: "1", value: "1", label: "Yes",
      valuetext: "100% (1 vote)", low: false, height: "7px",
    });
    assert.deepEqual(no, {
      tag: "meter", min: "0", max: "1", value: "0", label: "No",
      valuetext: "0% (0 votes)", low: false, height: "7px",
    });
    for (const m of [yes, no]) {
      assert.doesNotMatch(`${m.label} ${m.valuetext}`, /percent/i);
    }

    // 2. /PostList cards: compact 4px <meter> with a percentage valuetext.
    await page.goto(`${origin}/PostList`);
    const card = page.locator(".poll-list-card").filter({ hasText: poll.title });
    await card.locator(".mini-results meter").first().waitFor();
    assert.equal(await page.locator(".mini-results progress").count(), 0);
    const listYes = await readMeter(card.locator(".mini-results meter").first());
    assert.deepEqual(listYes, {
      tag: "meter", min: "0", max: "1", value: "1", label: "Yes",
      valuetext: "100%", low: false, height: "4px",
    });
    assert.doesNotMatch(`${listYes.label} ${listYes.valuetext}`, /percent/i);

    // 3. A vote-page 404 also stops mountSocial: later visibilitychange, online
    //    and pageshow(persisted) send no further /social requests. The social
    //    endpoint is made unavailable (503) so only votePage's 404 handler can
    //    stop it, not mountSocial's own 404 branch.
    const firstSocial = page.waitForResponse(
      (r) => new URL(r.url()).pathname === socialPath,
    );
    await page.goto(`${origin}/vote/${poll.id}`);
    await page.getByRole("heading", { name: poll.title }).waitFor();
    await firstSocial;
    f.setUnavailablePath(socialPath);
    f.advance(30 * DAY);
    await page.evaluate(() => dispatchEvent(new Event("online")));
    await page.getByRole("heading", { name: "This page is unavailable." }).waitFor();
    await page.waitForTimeout(300);
    f.setUnavailablePath(undefined);
    const before = socialRequests;
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      dispatchEvent(new Event("online"));
      dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await page.waitForTimeout(500);
    assert.equal(socialRequests, before);
    assert.deepEqual(f.errors, []);
  },
);

test(
  "progressive Web Share button mounts only on public poll, task and giveaway pages",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const { page, context, origin, store } = f;
    const poll = await store.create({
      title: "Shareable neighborhood poll",
      options: ["Yes", "No"],
      visibility: "unlisted",
    });
    const { password: taskPassword, ...taskCredentials } =
      await createTaskCredentials();
    const task = await store.create({
      ...taskCredentials,
      type: "task",
      title: "Shareable local task",
      description: "Carry two boxes.",
      signature: "Alex",
      reward: "Coffee",
      options: [],
      visibility: "unlisted",
    });
    const sale = await store.create({
      type: "sale",
      giveawayVersion: 1,
      title: "Shareable free giveaway",
      description: "Gently used lamp.",
      signature: "Alex",
      pickupLocation: "Front porch",
      options: [],
      visibility: "unlisted",
    });

    // 1. When navigator.share is absent, public pages do not render [data-native-share].
    await page.evaluate(() => {
      delete navigator.share;
      delete navigator.canShare;
    });
    await page.goto(`${origin}/vote/${poll.id}`);
    await page.getByRole("heading", { name: poll.title }).waitFor();
    assert.equal(await page.locator("[data-native-share]").count(), 0);

    // 2. When navigator.share is supported, test public pages, canonical URL, errors & exclusions.
    const sharePage = await context.newPage();
    const shareErrors = [];
    sharePage.on("pageerror", (e) => shareErrors.push(e.message));
    await sharePage.addInitScript(() => {
      window.__sharedCalls = [];
      window.__shareOutcome = "resolve";
      navigator.canShare = (data) => Boolean(data && data.url);
      navigator.share = async (data) => {
        window.__sharedCalls.push(data);
        if (window.__shareOutcome === "abort") {
          throw new DOMException("User cancelled", "AbortError");
        }
        if (window.__shareOutcome === "error") {
          throw new DOMException("Share failed", "NotAllowedError");
        }
      };
    });

    // Public poll page
    await sharePage.goto(`${origin}/vote/${poll.id}?created=1#extra`);
    await sharePage.getByRole("heading", { name: poll.title }).waitFor();
    const pollShare = sharePage.locator("[data-native-share]");
    assert.equal(await pollShare.count(), 1);
    assert.equal(await pollShare.textContent(), "Share link");
    await sharePage.getByRole("button", { name: "Copy poll link", exact: true }).waitFor();
    await pollShare.click();
    assert.deepEqual(await sharePage.evaluate(() => window.__sharedCalls), [
      { title: poll.title, url: `${origin}/vote/${poll.id}` },
    ]);

    // Clipboard fallback on poll page still works (nextElementSibling intact)
    await sharePage.evaluate(() => {
      navigator.clipboard.writeText = async () => {
        throw new DOMException("Denied", "NotAllowedError");
      };
    });
    await sharePage.getByRole("button", { name: "Copy poll link", exact: true }).click();
    const fallbackInput = sharePage.getByLabel("Public link", { exact: true });
    await fallbackInput.waitFor();
    assert.equal(await fallbackInput.inputValue(), `${origin}/vote/${poll.id}`);

    // AbortError is silent; other errors show fallback toast
    await sharePage.evaluate(() => {
      window.__shareOutcome = "abort";
      document.querySelector("#toast").classList.remove("show");
      document.querySelector("#toast").textContent = "";
    });
    await pollShare.click();
    assert.equal(await sharePage.locator("#toast").textContent(), "");

    await sharePage.evaluate(() => {
      window.__shareOutcome = "error";
    });
    await pollShare.click();
    await sharePage
      .locator("#toast")
      .getByText("Could not open share sheet. Use Copy link instead.", { exact: true })
      .waitFor();

    // Public task page
    await sharePage.goto(`${origin}/task/${task.id}?ref=1#hash`);
    await sharePage.getByRole("heading", { name: task.title }).waitFor();
    assert.equal(await sharePage.locator("[data-native-share]").count(), 1);
    await sharePage.getByRole("button", { name: "Copy task link", exact: true }).waitFor();
    await sharePage.evaluate(() => {
      window.__sharedCalls = [];
      window.__shareOutcome = "resolve";
    });
    await sharePage.locator("[data-native-share]").click();
    assert.deepEqual(await sharePage.evaluate(() => window.__sharedCalls), [
      { title: task.title, url: `${origin}/task/${task.id}` },
    ]);

    // Public giveaway page
    await sharePage.goto(`${origin}/sale/${sale.id}?ref=1#hash`);
    await sharePage.getByRole("heading", { name: sale.title }).waitFor();
    assert.equal(await sharePage.locator("[data-native-share]").count(), 1);
    await sharePage.getByRole("button", { name: "Copy public link", exact: true }).waitFor();
    await sharePage.evaluate(() => {
      window.__sharedCalls = [];
      window.__shareOutcome = "resolve";
    });
    await sharePage.locator("[data-native-share]").click();
    assert.deepEqual(await sharePage.evaluate(() => window.__sharedCalls), [
      { title: sale.title, url: `${origin}/sale/${sale.id}` },
    ]);

    // Management pages and /secrex never render [data-native-share]
    await sharePage.goto(`${origin}/vote/${poll.id}/manage`);
    await sharePage.getByLabel("Management password").fill(poll.manageKey);
    await sharePage.getByRole("button", { name: "Unlock", exact: true }).click();
    await sharePage.getByRole("heading", { name: "Manage this poll" }).waitFor();
    assert.equal(await sharePage.locator("[data-native-share]").count(), 0);

    await sharePage.goto(`${origin}/task/${task.id}/manage`);
    await sharePage.getByLabel("Management password").fill(taskPassword);
    await sharePage.getByRole("button", { name: "Unlock", exact: true }).click();
    await sharePage.getByRole("heading", { name: "Manage this task" }).waitFor();
    assert.equal(await sharePage.locator("[data-native-share]").count(), 0);

    await sharePage.goto(`${origin}/sale/${sale.id}/manage`);
    await sharePage.getByLabel("Management password").fill(sale.manageKey);
    await sharePage.getByRole("button", { name: "Unlock", exact: true }).click();
    await sharePage.getByRole("heading", { name: "Manage giveaway" }).waitFor();
    assert.equal(await sharePage.locator("[data-native-share]").count(), 0);

    await sharePage.goto(`${origin}/secrex`);
    await sharePage.locator("#secrex-compose").waitFor();
    assert.equal(await sharePage.locator("[data-native-share]").count(), 0);

    assert.deepEqual(shareErrors, []);
    assert.deepEqual(f.errors, []);
  },
);

test(
  "form error focus and locate button feedback across giveaway and task forms",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const { page, origin } = f;

    // 1. /create/sale: #sale-location-status has aria-live="polite", locate button toggles Try again / Refresh location
    await page.goto(`${origin}/create/sale`);
    await page.locator("#sale-form").waitFor();
    assert.equal(
      await page.locator("#sale-location-status").getAttribute("aria-live"),
      "polite",
    );

    await page.evaluate(() => {
      window.__origGetCurrentPosition =
        navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      navigator.geolocation.getCurrentPosition = (_success, error) => {
        error({ code: 1, PERMISSION_DENIED: 1 });
      };
    });
    await page.locator("#sale-locate").click();
    await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
    assert.equal(await page.locator("#sale-locate").textContent(), "Try again");
    assert.equal(await page.locator("#sale-locate").isDisabled(), false);

    await page.evaluate(() => {
      navigator.geolocation.getCurrentPosition = window.__origGetCurrentPosition;
    });
    await page.locator("#sale-locate").click();
    await page.getByRole("button", { name: "Refresh location", exact: true }).waitFor();
    assert.equal(
      await page.locator("#sale-locate").textContent(),
      "Refresh location",
    );
    assert.equal(await page.locator("#sale-locate").isDisabled(), false);

    // 2. /create/sale submission error focuses #sale-error with tabIndex === -1
    await page.locator("#sale-title").fill("Free desk lamp");
    await page.locator("#sale-description").fill("Works well, warm bulb included.");
    await page.locator("#pickup-location").fill("Outside north entrance");
    await page.locator("#sale-pickup-start").fill("2026-06-10T15:00");
    await page.locator("#sale-pickup-end").fill("2026-06-10T14:00");
    await page.locator("#sale-map-consent").check();
    await page.locator("#sale-retention").check();
    await page.locator("#publish-sale").click();

    const saleErrorState = await page.evaluate(() => {
      const node = document.querySelector("#sale-error");
      return {
        hidden: node.hidden,
        text: node.textContent,
        tabIndex: node.tabIndex,
        isFocused: document.activeElement === node,
      };
    });
    assert.equal(saleErrorState.hidden, false);
    assert.equal(
      saleErrorState.text,
      "Choose a pickup start and end time in order.",
    );
    assert.equal(saleErrorState.tabIndex, -1);
    assert.equal(saleErrorState.isFocused, true);

    // 3. /create/task locate button toggles Try again / Refresh location
    await page.goto(`${origin}/create/task`);
    await page.locator("#task-form").waitFor();
    await page.evaluate(() => {
      window.__origGetCurrentPosition =
        navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      navigator.geolocation.getCurrentPosition = (_success, error) => {
        error({ code: 1, PERMISSION_DENIED: 1 });
      };
    });
    await page.locator("#task-locate").click();
    await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
    assert.equal(await page.locator("#task-locate").textContent(), "Try again");
    assert.equal(await page.locator("#task-locate").isDisabled(), false);

    await page.evaluate(() => {
      navigator.geolocation.getCurrentPosition = window.__origGetCurrentPosition;
    });
    await page.locator("#task-locate").click();
    await page.getByRole("button", { name: "Refresh location", exact: true }).waitFor();
    assert.equal(
      await page.locator("#task-locate").textContent(),
      "Refresh location",
    );
    assert.equal(await page.locator("#task-locate").isDisabled(), false);

    assert.deepEqual(f.errors, []);
  },
);

test(
  "header navigation aria-current synchronization and 390x844 mobile touch targets",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const { page, origin, store } = f;

    async function navState() {
      return page.evaluate(() =>
        [...document.querySelectorAll("header nav a[data-nav]")].map((link) => ({
          nav: link.dataset.nav,
          active: link.classList.contains("active"),
          ariaCurrent: link.getAttribute("aria-current"),
        })),
      );
    }

    const expectedRoutes = [
      { path: "/PostList", activeNav: "list", waitSelector: ".list-page", expectedCount: 3 },
      { path: "/saved", activeNav: "saved", waitSelector: "main h1", expectedCount: 3 },
      { path: "/create", activeNav: "create", waitSelector: "#create-form", expectedCount: 3 },
      { path: "/create/task", activeNav: "create", waitSelector: "#task-form", expectedCount: 3 },
      { path: "/create/sale", activeNav: "create", waitSelector: "#sale-form", expectedCount: 3 },
      { path: "/secrex", activeNav: "create", waitSelector: "#secrex-compose", expectedCount: 2 },
    ];

    for (const { path, activeNav, waitSelector, expectedCount } of expectedRoutes) {
      await page.goto(`${origin}${path}`);
      await page.locator(waitSelector).waitFor();
      const state = await navState();
      assert.equal(state.length, expectedCount, `Expected ${expectedCount} header nav links on ${path}`);
      for (const item of state) {
        if (item.nav === activeNav) {
          assert.equal(item.active, true, `${path} -> [data-nav="${item.nav}"] should have .active`);
          assert.equal(item.ariaCurrent, "page", `${path} -> [data-nav="${item.nav}"] should have aria-current="page"`);
        } else {
          assert.equal(item.active, false, `${path} -> [data-nav="${item.nav}"] should not have .active`);
          assert.equal(item.ariaCurrent, null, `${path} -> [data-nav="${item.nav}"] should not have aria-current`);
        }
      }
    }

    const poll = await store.create({
      title: "Nav reset detail poll",
      options: ["Yes", "No"],
      visibility: "unlisted",
    });
    await page.goto(`${origin}/vote/${poll.id}`);
    await page.getByRole("heading", { name: poll.title }).waitFor();
    const detailNav = await navState();
    for (const item of detailNav) {
      assert.equal(item.active, false, `/vote/:id -> [data-nav="${item.nav}"] should not have .active`);
      assert.equal(item.ariaCurrent, null, `/vote/:id -> [data-nav="${item.nav}"] should not have aria-current`);
    }

    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto(`${origin}/PostList`);
    await page.locator(".list-page").waitFor();
    const postListMetrics = await page.evaluate(() => {
      const selectors = [
        'header nav a[data-nav="list"]',
        'header nav a[data-nav="saved"]',
        'header nav a[data-nav="create"]',
        ".filter-tabs button",
        ".view-switch button",
        ".near-button",
        ".language-control select",
      ];
      const heights = {};
      for (const sel of selectors) {
        const els = [...document.querySelectorAll(sel)];
        heights[sel] = els.map((el) => el.getBoundingClientRect().height);
      }
      return {
        heights,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });
    assert.ok(
      postListMetrics.scrollWidth <= postListMetrics.innerWidth,
      `Expected /PostList scrollWidth (${postListMetrics.scrollWidth}) <= innerWidth (${postListMetrics.innerWidth})`,
    );
    for (const [sel, list] of Object.entries(postListMetrics.heights)) {
      assert.ok(list.length > 0, `Expected elements for ${sel} on /PostList`);
      for (const h of list) {
        assert.ok(h >= 44, `Expected ${sel} height (${h}) >= 44 on /PostList at 390x844`);
      }
    }

    await page.goto(`${origin}/create`);
    await page.locator("#create-form").waitFor();
    const createMetrics = await page.evaluate(() => {
      const selectors = [
        'header nav a[data-nav="list"]',
        'header nav a[data-nav="saved"]',
        'header nav a[data-nav="create"]',
        ".language-control select",
      ];
      const heights = {};
      for (const sel of selectors) {
        const els = [...document.querySelectorAll(sel)];
        heights[sel] = els.map((el) => el.getBoundingClientRect().height);
      }
      return {
        heights,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });
    assert.ok(
      createMetrics.scrollWidth <= createMetrics.innerWidth,
      `Expected /create scrollWidth (${createMetrics.scrollWidth}) <= innerWidth (${createMetrics.innerWidth})`,
    );
    for (const [sel, list] of Object.entries(createMetrics.heights)) {
      assert.ok(list.length > 0, `Expected elements for ${sel} on /create`);
      for (const h of list) {
        assert.ok(h >= 44, `Expected ${sel} height (${h}) >= 44 on /create at 390x844`);
      }
    }

    assert.deepEqual(f.errors, []);
  },
);
