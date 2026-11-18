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
import { PollStore } from "../src/store.js";

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
  const store = new PollStore(directory);
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

  return { store, origin, page, errors };
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
