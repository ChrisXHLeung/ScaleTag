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
import { serviceWorkerSource, STATIC_ASSETS } from "../src/pwa.js";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "scaletag-pwa-"));
  let now = Date.now();
  const store = new PollStore(directory, { clock: () => now });
  await store.init();
  let app,
    nextVersion = false;
  const server = createServer((req, res) => {
    if (req.url === "/sw.js" && nextVersion) {
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
  app = createApp(store, { origin });
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
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
    advance: (ms) => {
      now += ms;
    },
  };
}

async function cachedPaths(page) {
  const urls = await page.evaluate(async () => {
    const result = [];
    for (const name of await caches.keys()) {
      for (const key of await (await caches.open(name)).keys()) result.push(key.url);
    }
    return result;
  });
  const origin = new URL(page.url()).origin;
  return urls.map(value => {
    const url = new URL(value);
    assert.equal(url.origin, origin, 'Never cache third-party resources');
    assert.equal(url.search, '', 'Never cache query parameters');
    assert.ok(!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/vote/'), 'Never cache poll data or poll URLs');
    assert.ok(!['/', '/create', '/VoteList', '/privacy'].includes(url.pathname), 'Do not cache page responses');
    return url.pathname;
  }).sort();
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
    await page.getByRole("checkbox").check();
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
    await page.getByRole("checkbox").check();
    await context.setOffline(true);
    await page.getByRole("button", { name: "Publish my poll" }).click();
    await page
      .locator("#form-error")
      .getByText(/offline/)
      .waitFor();
    assert.equal(f.store.index.size, 1);
    await page.goto(origin + `/vote/${id}`);
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
    // Navigating back to a draft is not needed: a fresh visit can show the waiting update.
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
    assert.equal(await page.getByLabel("The question").inputValue(), "");
    assert.deepEqual(await cachedPaths(page), [...STATIC_ASSETS].sort());
    assert.deepEqual(f.errors, []);
  },
);
