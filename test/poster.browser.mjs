import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import sharp from "sharp";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import { createApp } from "../src/app.js";
import { DAY, PollStore } from "../src/store.js";

async function makePhotoDataUrl(r, g, b) {
  const buf = await sharp({
    create: { width: 120, height: 90, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "scaletag-poster-"));
  let now = Date.now();
  const store = new PollStore(directory, { clock: () => now });
  await store.init();
  let app;
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
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  t.after(async () => {
    await browser.close();
    await new Promise((r) => server.close(r));
    await rm(directory, { recursive: true, force: true });
  });

  return { store, origin, page, errors, advance: (ms) => { now += ms; } };
}

test("poll, task, and sale generate 2480x3508 A4 posters, preserve pure QR, follow language, and invoke print", async (t) => {
  const { store, origin, page, errors } = await fixture(t);

  const img1 = await makePhotoDataUrl(23, 70, 162);
  const img2 = await makePhotoDataUrl(199, 40, 61);
  const img3 = await makePhotoDataUrl(83, 100, 127);

  const poll = await store.create({
    type: "poll",
    title: "Community Garden Watering Schedule",
    description: "Should we water the raised beds on Tuesday and Friday evenings?",
    options: ["Tuesday & Friday 6 PM", "Wednesday & Saturday 7 AM", "Keep current schedule"],
    signature: "Maple Block",
    images: [img1, img2],
    location: { latitude: 43.65, longitude: -79.38 },
    retentionAccepted: true,
  });

  const task = await store.create({
    type: "task",
    title: "Help carry donated chairs to Room B",
    description: "Need two people for 20 minutes before the Saturday meetup.",
    reward: "Fresh coffee and muffins",
    signature: "Alex",
    authKey: "a".repeat(64),
    options: [],
    images: [],
    location: { latitude: 43.65, longitude: -79.38 },
    retentionAccepted: true,
  });

  const sale = await store.create({
    type: "sale",
    title: "Wooden Kids Bookshelf",
    description: "Solid pine, gently used, clean and ready for pickup at the lobby.",
    pickupLocation: "Outside the north library entrance",
    giveawayVersion: 1,
    signature: "Sam",
    options: [],
    images: [img1, img2],
    location: { latitude: 43.65, longitude: -79.38 },
    retentionAccepted: true,
  });

  for (const [path, qrHref, hasSaveQr] of [
    [`/vote/${poll.id}`, `/api/polls/${poll.id}/qr.png`, true],
    [`/task/${task.id}`, `/api/tasks/${task.id}/qr.png`, true],
    [`/sale/${sale.id}`, `/api/sales/${sale.id}/qr.png`, false],
  ]) {
    await page.goto(`${origin}${path}?lang=en`, { waitUntil: "networkidle" });
    await page.waitForSelector("#print-poster-btn");

    // Pure QR image remains intact
    const qrSrc = await page.getAttribute(".qr-frame img", "src");
    assert.equal(qrSrc, qrHref);
    if (hasSaveQr) {
      const saveQrText = await page.textContent(`.share-card a[href^="${qrHref}"]`);
      assert.match(saveQrText, /Save QR image/);
    }

    // Stub window.print to verify it is invoked and inspect #poster-print-root
    await page.evaluate(() => {
      window.__printCalls = 0;
      window.print = () => {
        window.__printCalls += 1;
      };
    });

    await page.click("#print-poster-btn");
    await page.waitForFunction(() => window.__printCalls === 1);

    const dims = await page.evaluate(() => {
      const img = document.querySelector("#poster-print-root img");
      return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
    });
    assert.deepEqual(dims, { w: 2480, h: 3508 });

    // Save A4 poster download produces a real 2480x3508 PNG
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#save-poster-btn"),
    ]);
    assert.match(download.suggestedFilename(), /^ScaleTag-poster-.*\.png$/);
    const downloadedPath = await download.path();
    const meta = await sharp(await readFile(downloadedPath)).metadata();
    assert.equal(meta.format, "png");
    assert.equal(meta.width, 2480);
    assert.equal(meta.height, 3508);
  }

  // Switch to Chinese via the UI language selector and verify Chinese poster UI + generation
  await page.selectOption("#language-select", "zh");
  await page.waitForSelector("#print-poster-btn");
  assert.match(await page.textContent("#print-poster-btn"), /打印 A4 海报/);
  assert.match(await page.textContent("#save-poster-btn"), /保存 A4 海报/);

  await page.evaluate(() => {
    window.__printCalls = 0;
    window.print = () => {
      window.__printCalls += 1;
    };
  });
  await page.click("#print-poster-btn");
  await page.waitForFunction(() => window.__printCalls === 1);

  const zhDims = await page.evaluate(() => {
    const img = document.querySelector("#poster-print-root img");
    return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
  });
  assert.deepEqual(zhDims, { w: 2480, h: 3508 });

  assert.deepEqual(errors, []);
});

test("poll result cards download public totals and never offer withheld counts", async (t) => {
  const { store, origin, page, errors, advance } = await fixture(t);
  const options = ["Morning", "Evening", ...Array.from({ length: 10 }, (_, i) =>
    `${i + 1} ${"社区花园使用时间".repeat(13)}`)];
  const input = {
    type: "poll",
    title: "When should the community garden open?",
    options,
    signature: "Maple Block",
    images: [],
    location: { latitude: 43.65, longitude: -79.38 },
  };
  const live = await store.create(input);
  const withheld = await store.create({ ...input, resultsVisibility: "after_close" });
  for (const poll of [live, withheld]) {
    await store.vote(poll.id, "first-browser", 1);
    await store.vote(poll.id, "second-browser", 2);
    await store.vote(poll.id, "third-browser", 2);
  }
  await page.addInitScript(() => {
    window.resultCardText = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.resultCardText.push(text);
      return fillText.call(this, text, ...args);
    };
  });

  const downloadButton = page.getByRole("button", { name: "Download result card" });
  const copyButton = page.getByRole("button", { name: "Copy results as text", exact: true });
  await page.goto(`${origin}/vote/${live.id}?lang=en`);
  await downloadButton.waitFor({ timeout: 3500 });
  const [liveDownload] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
  assert.equal(liveDownload.suggestedFilename(), `ScaleTag-results-${live.id}.png`);
  const liveMeta = await sharp(await readFile(await liveDownload.path())).metadata();
  assert.equal(liveMeta.format, "png");
  assert.ok(liveMeta.height > liveMeta.width);
  const drawn = await page.evaluate(() => window.resultCardText);
  assert.ok(drawn.join(" ").includes(input.title), "The full question is present after wrapping");
  for (const value of ["Morning", "Evening", "33.3%", "66.7%", "Total votes", "3", "Voting closes", "Snapshot time"]) {
    assert.ok(drawn.includes(value), `Expected the card to draw ${value}`);
  }
  assert.ok(drawn.join("").includes(options.at(-1)), "The last long option is complete");

  await page.goto(`${origin}/vote/${withheld.id}`);
  await page.getByText("Results will appear when voting closes.").first().waitFor();
  assert.equal(await downloadButton.count(), 0);
  assert.equal(await copyButton.count(), 0);
  await page.locator("#download-result-card").evaluate((button) => button.click());
  await page.locator("#toast", { hasText: "Could not download the result card" }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.resultCardText), []);

  advance(7 * DAY + 1);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await downloadButton.waitFor();
  await copyButton.waitFor();
  const [finalDownload] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
  assert.equal(finalDownload.suggestedFilename(), `ScaleTag-results-${withheld.id}.png`);
  assert.equal((await sharp(await readFile(await finalDownload.path())).metadata()).format, "png");
  assert.ok((await page.evaluate(() => window.resultCardText)).includes("Final results"));
  assert.deepEqual(errors, []);
});

test("copy fresh aggregate poll results as text with a permission fallback", async (t) => {
  const { store, origin, page, errors } = await fixture(t);
  const poll = await store.create({ title: "Watering schedule", options: ["Morning", "Evening"], visibility: "unlisted" });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const url = `${origin}/vote/${poll.id}`;
  await page.goto(`${url}?lang=en#results`);
  const copy = page.getByRole("button", { name: "Copy results as text", exact: true });
  await copy.waitFor({ timeout: 5000 });
  await store.vote(poll.id, "next-browser", 2);
  await copy.click();
  await page.getByText("Results copied.", { exact: true }).waitFor();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(text, /^Watering schedule\nLive results\nTotal votes: 1\n/u);
  assert.match(text, /Morning: 0 votes \(0%\)\nEvening: 1 vote \(100%\)\n/u);
  assert.ok(text.endsWith(url));
  assert.ok(!text.includes(poll.manageKey) && !text.includes("?lang=") && !text.includes("#results"));

  await page.evaluate(() => { navigator.clipboard.write = async () => { throw new DOMException("Denied", "NotAllowedError"); }; });
  await copy.click();
  const fallback = page.getByRole("textbox", { name: "Results text", exact: true });
  await fallback.waitFor();
  assert.equal(await fallback.inputValue(), text);
  assert.ok(await fallback.evaluate(input => document.activeElement === input && input.selectionStart === 0 &&
    input.selectionEnd === input.value.length));
  await store.setPollState(poll.id, poll.manageKey, "withdrawn");
  await copy.click();
  await page.getByText("Could not copy results. Please try again.", { exact: true }).waitFor();
  assert.equal(await fallback.isVisible(), false);
  assert.deepEqual(errors, []);
});

test("a withdrawn poll cannot copy a delayed result after the page becomes unavailable", async (t) => {
  const { store, origin, page, errors } = await fixture(t);
  const poll = await store.create({ title: "Old snapshot", options: ["Morning", "Evening"], visibility: "unlisted" });
  const apiUrl = `${origin}/api/polls/${poll.id}`;
  await page.goto(`${origin}/vote/${poll.id}`);
  const copy = page.getByRole("button", { name: "Copy results as text", exact: true });
  await copy.waitFor();
  await page.evaluate(() => {
    navigator.clipboard.write = async ([item]) => {
      window.testClipboardStarted = true;
      try { window.testClipboard = await (await item.getType("text/plain")).text(); }
      finally { window.testClipboardSettled = true; }
    };
  });
  let entered, release;
  const captured = new Promise(resolve => { entered = resolve; });
  const delayed = new Promise(resolve => { release = resolve; });
  let interceptFirst = true;
  await page.route(apiUrl, async route => {
    if (route.request().method() !== "GET" || !interceptFirst) return route.continue();
    interceptFirst = false;
    const response = await route.fetch();
    entered();
    await delayed;
    await route.fulfill({ response });
  });
  try {
    await copy.click();
    await captured;
    assert.equal(await page.evaluate(() => window.testClipboardStarted), true);
    await store.setPollState(poll.id, poll.manageKey, "withdrawn");
    await page.evaluate(() => dispatchEvent(new Event("online")));
    await page.getByRole("heading", { name: "This page is unavailable.", exact: true }).waitFor();
  } finally { release(); }
  await page.waitForFunction(() => window.testClipboardSettled);
  assert.equal(await page.evaluate(() => window.testClipboard), undefined);
  assert.deepEqual(errors, []);
});
