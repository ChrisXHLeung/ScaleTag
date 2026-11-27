import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import { createApp } from "../src/app.js";
import { PollStore, DAY } from "../src/store.js";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "scaletag-sales-"));
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
  page.setDefaultTimeout(7000);
  page.on("pageerror", (e) => errors.push(e.message));
  t.after(async () => {
    await browser.close();
    server.closeAllConnections();
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

test("publish a giveaway, like it and take it down", async t => {
  const f=await fixture(t);
  await f.page.setViewportSize({ width: 320, height: 900 });
  await f.page.goto(f.origin);
  const entry = f.page.getByRole("link", { name: "Give away", exact: true });
  assert.equal(await entry.getAttribute("href"), "/create/sale");
  assert.equal(await entry.evaluate((link) => {
    const range = document.createRange();
    range.selectNodeContents(link.firstChild);
    return range.getClientRects().length;
  }), 1);
  await entry.click();
  for (const width of [1440,768,320]) {
    await f.page.setViewportSize({width,height:900});
    assert.ok(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await f.page.screenshot({path:`/tmp/giveaway-create-${width}.png`,fullPage:true});
  }
  assert.equal(await f.page.locator('#sale-price, #offer-form, input[type=email], input[type=tel]').count(),0);
  await f.page.locator('#sale-title').fill('Reading chair');
  await f.page.locator('#sale-description').fill('Good condition');
  await f.page.locator('#pickup-location').fill('Outside the library');
  await f.page.locator('#sale-map-consent').check();
  await f.page.locator('#sale-retention').check();
  await f.page.locator('#publish-sale').click();
  await f.page.getByRole('heading',{name:'Manage giveaway'}).waitFor();
  const url=new URL(f.page.url()), id=url.pathname.split('/')[2];
  assert.equal(url.hash, "");
  await f.page.evaluate(() => {
    navigator.clipboard.writeText = async (text) => { window.copiedManagement = text; };
  });
  await f.page.getByRole("button", { name: "Copy URL and password" }).click();
  const message = await f.page.evaluate(() => window.copiedManagement);
  const [, manageUrl, password] = /^Management URL: (.+)\nManagement password: ([a-f0-9]{64})$/.exec(message);
  assert.equal(manageUrl, f.origin + `/sale/${id}/manage`);
  await f.page.goto(manageUrl);
  await f.page.getByLabel("Management password").fill(password);
  await f.page.getByRole("button", { name: "Unlock" }).click();
  await f.page.getByRole("heading", { name: "Manage giveaway" }).waitFor();
  const visitor=await f.context.newPage();
  await visitor.goto(f.origin+'/sale/'+id);
  await visitor.getByText('Outside the library').waitFor();
  const expiry=await visitor.evaluate(async id=>{ const item=await (await fetch('/api/sales/'+id)).json(); return {expected:new Intl.DateTimeFormat('en',{dateStyle:'medium',timeStyle:'short'}).format(new Date(item.endsAt)), later:new Intl.DateTimeFormat('en',{dateStyle:'medium',timeStyle:'short'}).format(new Date(item.deleteAt))}; },id);
  assert.notEqual(expiry.expected,expiry.later);
  assert.ok((await visitor.locator('.poll-meta').innerText()).includes(expiry.expected));
  await visitor.locator('#like-post:not([disabled])').waitFor();
  await visitor.locator('#like-post').click();
  await visitor.getByText('♥ Liked').waitFor();
  f.page.once('dialog', d=>d.accept());
  await f.page.locator('#close-sale').click();
  await f.page.getByText('This giveaway is no longer available.').waitFor();
  assert.equal((await visitor.goto(f.origin+'/sale/'+id)).status(),404);
  assert.deepEqual(f.errors,[]);
});

test('Chinese giveaway form',async t=>{
  const f=await fixture(t); await f.page.goto(f.origin+'/create/sale');
  await f.page.locator('#language-select').selectOption('zh');
  await f.page.getByRole('heading',{name:'发布闲置赠予'}).waitFor();
  await f.page.getByLabel('领取地点（公开）').waitFor();
  assert.deepEqual(f.errors,[]);
});

test("a visitor requests pickup, sees the address after selection, and loses it when released", async t => {
  const f = await fixture(t);
  const owner = f.page;
  const address = "Private library entrance";
  await owner.goto(f.origin + "/create/sale");
  await owner.getByLabel("Pickup method", { exact: true }).selectOption("request", { timeout: 3500 });
  await owner.locator("#sale-title").fill("Assorted garden tools");
  await owner.locator("#sale-description").fill("Good condition");
  await owner.getByLabel("Pickup location (private)", { exact: true }).fill(address);
  await owner.locator("#post-visibility").selectOption("unlisted");
  await owner.locator("#sale-retention").check();
  await owner.getByRole("button", { name: "Publish giveaway", exact: true }).click();
  await owner.getByRole("heading", { name: "Manage giveaway" }).waitFor();
  const path = new URL(owner.url()).pathname.replace(/\/manage$/, "");
  const context = await f.browser.newContext({ viewport: { width: 320, height: 844 } });
  const visitor = await context.newPage();
  await visitor.goto(f.origin + path);
  assert.equal(await visitor.getByText(address, { exact: true }).count(), 0);
  const time = await visitor.evaluate(() => {
    const date = new Date(Date.now() + 30 * 60000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  await visitor.getByLabel("When can you pick it up?", { exact: true }).fill(time);
  await visitor.getByRole("button", { name: "Request pickup", exact: true }).click();
  await visitor.getByText("Your pickup request is pending.", { exact: true }).waitFor();
  assert.equal(await visitor.getByText(address, { exact: true }).count(), 0);
  await owner.getByRole("button", { name: "Refresh pickup requests", exact: true }).click();
  await owner.getByRole("button", { name: "Confirm pickup request", exact: true }).click();
  await owner.getByText("A pickup request is confirmed.", { exact: true }).waitFor();
  await visitor.getByRole("button", { name: "Check pickup request", exact: true }).click();
  await visitor.getByText(address, { exact: true }).waitFor();
  assert.equal(await visitor.evaluate(() => document.documentElement.scrollWidth), 320);
  await owner.getByRole("button", { name: "Release hold", exact: true }).click();
  await owner.getByText("No pickup requests yet.", { exact: true }).waitFor();
  await visitor.getByRole("button", { name: "Check pickup request", exact: true }).click();
  await visitor.getByText(address, { exact: true }).waitFor({ state: "detached" });
  assert.deepEqual(f.errors, []);
});

test("pickup management refreshes when a confirmed visitor cancels and poster hides private address", async t => {
  const f = await fixture(t);
  const owner = f.page;
  const address = "Secret courtyard gate 7";
  await owner.addInitScript(() => {
    window.posterText = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.posterText.push(String(text));
      return fillText.call(this, text, ...args);
    };
  });
  await owner.goto(f.origin + "/create/sale");
  await owner.getByLabel("Pickup method", { exact: true }).selectOption("request", { timeout: 3500 });
  await owner.locator("#sale-title").fill("Ceramic plant pots");
  await owner.locator("#sale-description").fill("Set of three");
  await owner.getByLabel("Pickup location (private)", { exact: true }).fill(address);
  await owner.locator("#post-visibility").selectOption("unlisted");
  await owner.locator("#sale-retention").check();
  await owner.getByRole("button", { name: "Publish giveaway", exact: true }).click();
  await owner.getByRole("heading", { name: "Manage giveaway" }).waitFor();
  const path = new URL(owner.url()).pathname.replace(/\/manage$/, "");

  const contextA = await f.browser.newContext({ viewport: { width: 320, height: 844 } });
  const visitorA = await contextA.newPage();
  const contextB = await f.browser.newContext({ viewport: { width: 320, height: 844 } });
  const visitorB = await contextB.newPage();
  await Promise.all([visitorA.goto(f.origin + path), visitorB.goto(f.origin + path)]);
  const [timeA, timeB] = await visitorA.evaluate(() => [30, 45].map(mins => {
    const date = new Date(Date.now() + mins * 60000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }));
  await visitorA.getByLabel("When can you pick it up?", { exact: true }).fill(timeA);
  await visitorA.getByRole("button", { name: "Request pickup", exact: true }).click();
  await visitorA.getByText("Your pickup request is pending.", { exact: true }).waitFor();

  await visitorB.getByLabel("When can you pick it up?", { exact: true }).fill(timeB);
  await visitorB.getByRole("button", { name: "Request pickup", exact: true }).click();
  await visitorB.getByText("Your pickup request is pending.", { exact: true }).waitFor();

  await owner.getByRole("button", { name: "Refresh pickup requests", exact: true }).click();
  await owner.getByRole("button", { name: "Confirm pickup request", exact: true }).first().click();
  await owner.getByText("A pickup request is confirmed.", { exact: true }).waitFor();
  await owner.locator("#sale-availability").getByText("Reserved", { exact: true }).waitFor();

  await visitorA.getByRole("button", { name: "Check pickup request", exact: true }).click();
  await visitorA.getByText(address, { exact: true }).waitFor();
  visitorA.once("dialog", dialog => dialog.accept());
  await visitorA.getByRole("button", { name: "Cancel pickup request", exact: true }).click();
  await visitorA.getByRole("button", { name: "Request pickup", exact: true }).waitFor();

  await owner.evaluate(() => window.dispatchEvent(new Event("online")));
  await owner.locator("#sale-availability").getByText("Available", { exact: true }).waitFor();
  await owner.getByRole("button", { name: "Confirm pickup request", exact: true }).waitFor();

  await owner.evaluate(() => {
    window.posterText = [];
    window.__printed = 0;
    window.print = () => { window.__printed += 1; };
  });
  await owner.locator("#print-poster-btn").click();
  await owner.waitForFunction(() => window.__printed === 1);
  const drawn = await owner.evaluate(() => window.posterText);
  assert.ok(drawn.includes("PICKUP LOCATION"));
  assert.ok(drawn.includes("Request before pickup"));
  assert.ok(!drawn.includes("ASKING PRICE"));
  assert.ok(!drawn.some(text => text.includes(address)));
  await contextA.close();
  await contextB.close();
  assert.deepEqual(f.errors, []);
});

test("set a pickup window and hold a giveaway until it becomes available again", async (t) => {
  const f = await fixture(t);
  const publisher = f.page;
  await publisher.goto(`${f.origin}/create/sale`);
  await publisher.getByLabel("Item title").fill("Pickup test chair");
  await publisher.getByLabel("Description and condition").fill("Good condition");
  await publisher.getByLabel("Pickup location (public)").fill("North library entrance");
  const [starts, ends] = await publisher.evaluate(() => {
    const minute = Math.floor(Date.now() / 60000) * 60000;
    return [6, 10].map(offset => {
      const d = new Date(minute + offset * 60000);
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    });
  });
  await publisher.getByLabel("Pickup starts").fill(starts);
  await publisher.getByLabel("Pickup ends").fill(ends);
  await publisher.locator("#sale-map-consent").check();
  await publisher.locator("#sale-retention").check();
  await publisher.getByRole("button", { name: "Publish giveaway" }).click();
  await publisher.getByRole("heading", { name: "Manage giveaway" }).waitFor();
  const id = new URL(publisher.url()).pathname.split("/")[2];
  const visitor = await f.context.newPage();
  await visitor.goto(`${f.origin}/sale/${id}`);
  await visitor.locator("#sale-pickup-window", { hasText: "Pickup window" }).waitFor();
  const calendar = visitor.getByRole("link", { name: "Add pickup time to calendar", exact: true });
  const downloading = visitor.waitForEvent("download", { timeout: 6000 });
  await calendar.click({ timeout: 6000 });
  const download = await downloading;
  assert.match(download.suggestedFilename(), /\.ics$/);
  const calendarText = await readFile(await download.path(), "utf8");
  assert.match(calendarText, /BEGIN:VEVENT\r\n/);
  assert.ok(calendarText.includes(`URL:${f.origin}/sale/${id}\r\n`));
  assert.equal(await publisher.getByRole("link", { name: "Add pickup time to calendar", exact: true }).count(), 0);
  await publisher.getByLabel("Hold until").fill(starts);
  await publisher.getByRole("button", { name: "Hold item" }).click();
  await publisher.getByText("Reserved", { exact: true }).waitFor();
  assert.ok((await f.store.get(id)).reservedUntil);
  await visitor.goto(`${f.origin}/PostList`);
  await visitor.getByRole("link", { name: /Reserved.*Pickup test chair/ }).waitFor();
  await visitor.clock.install({ time: new Date() });
  await visitor.goto(`${f.origin}/sale/${id}`);
  await visitor.getByText("Reserved", { exact: true }).waitFor();
  const copyPickup = visitor.getByRole("button", { name: "Copy pickup location", exact: true });
  assert.equal(await calendar.isVisible(), false);
  assert.equal(await copyPickup.isVisible(), false);
  f.advance(7 * 60000);
  await visitor.clock.fastForward(7 * 60000);
  await visitor.getByText("Available", { exact: true }).waitFor();
  await calendar.waitFor();
  await copyPickup.waitFor();
  assert.equal(await visitor.getByText("Reserved", { exact: true }).isVisible(), false);
  await visitor.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  publisher.once("dialog", dialog => dialog.accept());
  await publisher.getByRole("button", { name: "Mark as claimed" }).click();
  await publisher.getByText("Claimed", { exact: true }).waitFor();
  await visitor.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await visitor.getByText("Claimed", { exact: true }).waitFor({ timeout: 4500 });
  assert.equal(await calendar.isVisible(), false);
  assert.equal(await copyPickup.count(), 0);
  assert.deepEqual(f.errors, []);
});

test("hide the calendar link as soon as the pickup window ends", async (t) => {
  const f = await fixture(t);
  const now = Date.now();
  const sale = await f.store.create({ ...f.input, type: "sale", giveawayVersion: 1,
    title: "Short pickup window", pickupLocation: "Library",
    pickupWindow: { startsAt: now + 1000, endsAt: now + 4000 },
  });
  await f.page.clock.install({ time: new Date(now) });
  await f.page.goto(`${f.origin}/sale/${sale.id}`);
  const calendar = f.page.getByRole("link", { name: "Add pickup time to calendar", exact: true });
  await calendar.waitFor();
  f.advance(5000);
  await f.page.clock.fastForward(5000);
  await calendar.waitFor({ state: "hidden", timeout: 4000 });
});

test("pickup windows identify the visitor’s offset, including each side of a DST change", async (t) => {
  const f = await fixture(t);
  const startsAt = Date.UTC(2027, 2, 14, 6, 30);
  const endsAt = Date.UTC(2027, 2, 14, 7, 30);
  f.advance(startsAt - Date.now() - 60 * 60000);
  const sale = await f.store.create({ ...f.input, type: "sale", giveawayVersion: 1,
    title: "Timezone pickup", pickupLocation: "Library", pickupWindow: { startsAt, endsAt },
  });
  for (const [timezoneId, endpoints, offsets] of [
    ["America/Toronto", ["1:30 AM (UTC−05:00)", "3:30 AM (UTC−04:00)"], ["UTC−05:00", "UTC−04:00"]],
    ["Asia/Tokyo", ["3:30 PM", "4:30 PM (UTC+09:00)"], ["UTC+09:00"]],
    ["Asia/Kolkata", ["12:00 PM", "1:00 PM (UTC+05:30)"], ["UTC+05:30"]],
  ]) {
    const context = await f.browser.newContext({ timezoneId, locale: "en-US", viewport: { width: 360, height: 800 } });
    try {
      const page = await context.newPage();
      await page.goto(`${f.origin}/sale/${sale.id}`);
      const pickup = page.locator("#sale-pickup-window");
      const text = (await pickup.textContent()).normalize("NFKC");
      assert.deepEqual(text.match(/UTC[+−]\d{2}:\d{2}/g), offsets);
      for (const endpoint of endpoints) assert.ok(text.includes(endpoint), text);
      await page.goto(`${f.origin}/PostList`);
      const card = page.locator(`a[href="/sale/${sale.id}"]`);
      assert.deepEqual(await card.textContent().then(text => text.match(/UTC[+−]\d{2}:\d{2}/g)), offsets);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    } finally {
      await context.close();
    }
  }
});

test("copy an available giveaway's pickup text and offer manual copy if denied", async (t) => {
  const { origin, context, page, store, input } = await fixture(t);
  const pickup = "図書館  North entrance\nUse the ramp";
  const now = Date.now();
  const sale = await store.create({ ...input, type: "sale", giveawayVersion: 1,
    title: "Pickup location copy check", pickupLocation: pickup,
  });
  const path = `${origin}/sale/${sale.id}`;
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(path);
  const copy = page.getByRole("button", { name: "Copy pickup location", exact: true });
  const fallback = page.getByRole("textbox", { name: "Pickup location (public)", exact: true });
  const heading = page.locator("#sale-pickup h2");
  await heading.waitFor();
  assert.equal(await heading.innerText(), pickup);
  assert.equal(await fallback.isVisible(), false);
  await copy.click({ timeout: 5000 });
  await page.getByText("Pickup location copied.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), pickup);
  assert.equal(await fallback.isVisible(), false);

  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new DOMException("Denied", "NotAllowedError"); };
  });
  await copy.click();
  await fallback.waitFor();
  assert.equal(await fallback.inputValue(), pickup);
  assert.ok(await fallback.evaluate(input => document.activeElement === input &&
    input.selectionStart === 0 && input.selectionEnd === input.value.length));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  await store.setSaleState(sale.id, sale.manageKey, "reserved", now + 20 * 60000);
  await page.reload();
  await page.getByText("Reserved", { exact: true }).waitFor();
  assert.equal(await copy.isVisible(), false);
  assert.equal(await fallback.isVisible(), false);
  await store.setSaleState(sale.id, sale.manageKey, "claimed");
  await page.reload();
  await page.getByText("This item has been picked up.", { exact: true }).waitFor();
  assert.equal(await copy.count(), 0);
  assert.equal(await page.getByText(pickup, { exact: true }).count(), 0);
});

test("claim a giveaway and keep its shared address without the pickup location", async t => {
  const f = await fixture(t);
  const pickup = "Behind the west library entrance";
  const sale = await f.store.create({
    type: "sale",
    title: "Free garden chair",
    description: "Good condition",
    signature: "Neighbour",
    options: [],
    images: [],
    location: f.input.location,
    pickupLocation: pickup,
    mapVisible: true,
    giveawayVersion: 1,
  });
  const publicUrl = `${f.origin}/sale/${sale.id}`;
  await f.page.goto(`${publicUrl}/manage`);
  await f.page.getByLabel("Management password").fill(sale.manageKey);
  await f.page.getByRole("button", { name: "Unlock" }).click();
  await f.page.getByRole("heading", { name: "Manage giveaway" }).waitFor();
  await f.page.getByText(pickup, { exact: true }).waitFor();

  const visitor = await f.context.newPage();
  await visitor.goto(publicUrl);
  await visitor.getByText(pickup, { exact: true }).waitFor();
  f.page.once("dialog", dialog => dialog.accept());
  await f.page.getByRole("button", { name: "Mark as claimed" }).click();
  await f.page.getByText("Claimed", { exact: true }).waitFor();
  assert.equal(await f.page.getByText(pickup, { exact: true }).count(), 0);
  assert.equal(await f.page.getByRole("button", { name: "Print A4 poster" }).count(), 0);
  await f.page.getByRole("button", { name: "Copy URL and password" }).waitFor();

  assert.equal((await visitor.reload()).status(), 200);
  await visitor.getByText("Claimed", { exact: true }).waitFor();
  assert.equal(await visitor.getByText(pickup, { exact: true }).count(), 0);
  const qr = visitor.getByAltText("Public giveaway QR code");
  await qr.waitFor();
  await visitor.waitForFunction(() => document.querySelector(".qr-frame img").naturalWidth > 0);

  f.advance(3 * DAY);
  assert.equal((await visitor.reload()).status(), 404);
  assert.deepEqual(f.errors, []);
});

test("create forms show live character counts, 90% threshold warnings, and sync on draft discard", async t => {
  const f = await fixture(t);

  // 1. /create (Poll)
  await f.page.goto(`${f.origin}/create`);
  const pollTitleCount = f.page.locator("#title-count");
  const pollDescCount = f.page.locator("#description-count");
  const pollTitleStatus = f.page.locator("#title-limit-status");
  await pollTitleCount.waitFor();
  assert.equal(await pollTitleCount.textContent(), "0 / 140");
  assert.equal(await pollDescCount.textContent(), "0 / 4,000");

  await f.page.locator("#title").fill("a".repeat(126));
  assert.equal(await pollTitleCount.textContent(), "126 / 140");
  assert.equal(await pollTitleCount.evaluate(el => el.classList.contains("char-limit-near")), true);
  assert.equal(await pollTitleStatus.textContent(), "Approaching the character limit.");

  await f.page.locator("#title").fill("a".repeat(140));
  assert.equal(await pollTitleCount.textContent(), "140 / 140");
  assert.equal(await pollTitleStatus.textContent(), "Character limit reached.");

  await f.page.locator("#description").fill("hello world");
  assert.equal(await pollDescCount.textContent(), "11 / 4,000");

  await f.page.reload();
  await pollDescCount.waitFor();
  assert.equal(await pollDescCount.textContent(), "11 / 4,000");
  assert.equal(await pollTitleCount.textContent(), "140 / 140");

  await f.page.getByRole("button", { name: "Clear draft", exact: true }).click();
  await f.page.getByText("Text draft cleared.").waitFor();
  assert.equal(await pollTitleCount.textContent(), "0 / 140");
  assert.equal(await pollDescCount.textContent(), "0 / 4,000");
  assert.equal(await pollTitleStatus.textContent(), "");
  assert.equal(await pollTitleCount.evaluate(el => el.classList.contains("char-limit-near")), false);

  // 2. /create/task
  await f.page.goto(`${f.origin}/create/task`);
  const taskTitleCount = f.page.locator("#task-title-count");
  const taskDescCount = f.page.locator("#task-description-count");
  const taskRewardCount = f.page.locator("#task-reward-count");
  const taskRewardStatus = f.page.locator("#task-reward-limit-status");
  await taskTitleCount.waitFor();
  assert.equal(await taskTitleCount.textContent(), "0 / 140");
  assert.equal(await taskDescCount.textContent(), "0 / 4,000");
  assert.equal(await taskRewardCount.textContent(), "0 / 160");

  await f.page.locator("#task-reward").fill("r".repeat(144));
  assert.equal(await taskRewardCount.textContent(), "144 / 160");
  assert.equal(await taskRewardCount.evaluate(el => el.classList.contains("char-limit-near")), true);
  assert.equal(await taskRewardStatus.textContent(), "Approaching the character limit.");

  // 3. /create/sale
  await f.page.goto(`${f.origin}/create/sale`);
  const saleTitleCount = f.page.locator("#sale-title-count");
  const saleDescCount = f.page.locator("#sale-description-count");
  const pickupCount = f.page.locator("#pickup-location-count");
  const pickupStatus = f.page.locator("#pickup-location-limit-status");
  await saleTitleCount.waitFor();
  assert.equal(await saleTitleCount.textContent(), "0 / 140");
  assert.equal(await saleDescCount.textContent(), "0 / 4,000");
  assert.equal(await pickupCount.textContent(), "0 / 300");

  await f.page.locator("#pickup-location").fill("p".repeat(300));
  assert.equal(await pickupCount.textContent(), "300 / 300");
  assert.equal(await pickupStatus.textContent(), "Character limit reached.");
  assert.deepEqual(f.errors, []);
});
