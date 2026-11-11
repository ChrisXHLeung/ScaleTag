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
  await f.page.goto(f.origin+'/create/sale');
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
