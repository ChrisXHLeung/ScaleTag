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

test("sale discovery links and mobile creation form", async (t) => {
  const f = await fixture(t);
  await f.page.goto(f.origin + "/");
  await f.page.getByRole("link", { name: "Create a Listing", exact: true }).first().waitFor({timeout:3000});
  await f.page.goto(f.origin + "/create/sale");
  await f.page.locator("#sale-form").waitFor({timeout:3000});
  assert.equal(await f.page.locator('#sale-images').getAttribute('type'), 'file');
  await f.page.locator('#sale-images').setInputFiles({name:'large.png',mimeType:'image/png',buffer:Buffer.alloc(1048577)});
  await f.page.locator('#sale-image-error', {hasText:'1 MiB'}).waitFor();
  for (const width of [1440,768]) { await f.page.setViewportSize({width,height:900}); await f.page.screenshot({path:`/tmp/scaletag-sale-create-${width}.png`,fullPage:true}); }
  await f.page.setViewportSize({width:320,height:800});
  assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await f.page.screenshot({path:'/tmp/scaletag-sale-create-320.png',fullPage:true});
  await f.page.locator('#sale-images').setInputFiles([]);
  await f.page.locator('#language-select').selectOption('zh');
  await f.page.getByRole('heading', {name:'发布出售信息'}).waitFor();
  assert.deepEqual(f.errors, []);
});

async function publishSale(f) {
  await f.page.goto(f.origin + '/create/sale');
  await f.page.locator('#sale-title').fill('Reading chair <script>bad()</script>');
  await f.page.locator('#sale-description').fill('A sturdy chair with a worn arm.');
  await f.page.locator('#sale-price').fill('CAD 25, negotiable');
  const png = await f.page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 12; c.getContext('2d').fillRect(0,0,12,12); return c.toDataURL('image/png'); });
  await f.page.locator('#sale-images').setInputFiles({name:'chair.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1], 'base64')});
  await f.page.locator('#sale-map-consent').check();
  await f.page.locator('#sale-retention').check();
  let upload;
  f.page.on('request',r => {if(new URL(r.url()).pathname === '/api/sales') upload = r.postDataJSON();});
  await f.page.locator('#publish-sale').click();
  await f.page.getByRole('heading', {name:'Manage listing',exact:true}).waitFor();
  assert.equal(upload.images[0],png,'original file bytes go to server without browser recompression');
  const id = new URL(f.page.url()).pathname.split('/')[2];
  const key = new URLSearchParams(new URL(f.page.url()).hash.slice(1)).get('key');
  return {id,key};
}

test('original photo upload, public offer privacy, management language hash and final closure', async t => {
  const f = await fixture(t), {id,key} = await publishSale(f);
  assert.equal(await f.page.locator('.sale-photos img').count(),1);
  assert.equal(await f.page.locator('.poll-title').textContent(),'Reading chair <script>bad()</script>');
  const requests=[]; f.page.on('request',r => requests.push(r.url()));
  await f.page.locator('#language-select').selectOption('zh');
  await f.page.getByRole('heading',{name:'管理出售信息',exact:true}).waitFor();
  assert.ok(f.page.url().endsWith('#key='+key));
  await f.page.locator('#language-select').selectOption('en');
  await f.page.getByRole('heading',{name:'Manage listing',exact:true}).waitFor();
  const other = await f.browser.newContext();
  const visitor = await other.newPage(); visitor.setDefaultTimeout(7000);
  await visitor.goto(f.origin+'/sale/'+id);
  await visitor.waitForFunction(() => !document.querySelector('#send-offer')?.disabled);
  assert.equal(await visitor.locator('.manage-card').count(),0);
  await visitor.locator('#offer-amount').fill('CAD 20');
  await visitor.locator('#offer-name').fill('Neighbour <img src=x onerror=alert(1)>');
  await visitor.locator('#offer-message').fill('I can pick this up tomorrow.');
  await visitor.locator('#offer-email').fill('buyer@example.com');
  await visitor.locator('#offer-privacy').check();
  await visitor.locator('#offer-nonbinding').check();
  await visitor.locator('#offer-amount').fill('555-1234');
  await visitor.locator('#send-offer').click();
  await visitor.locator('#offer-error', {hasText:'Remove the phone number or email address'}).waitFor();
  assert.equal(await visitor.locator('#offer-list .reply-card').count(),0);
  await visitor.locator('#offer-amount').fill('CAD 20');
  await visitor.locator('#send-offer').click();
  await visitor.locator('#offer-list .reply-card').waitFor();
  assert.match(await visitor.locator('#offer-list').textContent(),/CAD 20/);
  assert.ok(!(await visitor.locator('body').textContent()).includes('buyer@example.com'));
  const publicSocial = await visitor.evaluate(async id => (await fetch('/api/posts/'+id+'/social')).json(),id);
  assert.ok(!JSON.stringify(publicSocial).includes('buyer@example.com'));
  await f.page.locator('#refresh-contacts').click();
  await f.page.locator('#private-offers').getByText('Email: buyer@example.com').waitFor();
  await f.page.addInitScript(() => Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('denied'))}}));
  await f.page.reload();
  await f.page.locator('#copy-sale-link').click();
  assert.equal(await f.page.locator('#public-sale-link').inputValue(),f.origin+'/sale/'+id);
  f.page.once('dialog',d=>d.accept());
  await f.page.locator('#close-sale').click();
  await f.page.locator('#sale-state',{hasText:'Closed'}).waitFor();
  await visitor.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await visitor.locator('#offers-closed').waitFor();
  assert.ok(await visitor.locator('#offer-form').isHidden());
  assert.ok(requests.every(url=>!url.includes(key)));
  const cached = await f.page.evaluate(async()=>{const urls=[];for(const n of await caches.keys())for(const r of await(await caches.open(n)).keys())urls.push(r.url);return urls;});
  assert.ok(cached.every(url=>!url.includes('/sale/')&&!url.includes('/api/')));
  await other.close();
  f.advance(30*DAY);
  await f.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await f.page.getByRole('heading',{name:'This page is unavailable.'}).waitFor();
  assert.ok(!(await f.page.locator('body').textContent()).includes('buyer@example.com'));
  assert.deepEqual(f.errors,[]);
});

test('sale filters in list and real MapLibre, private page rejects missing or wrong keys', async t => {
  const f = await fixture(t), {id,key} = await publishSale(f);
  await f.context.route('https://tiles.openfreemap.org/**',route => route.request().url().includes('/styles/') ? route.fulfill({json:{version:8,sources:{},glyphs:'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',layers:[{id:'background',type:'background',paint:{'background-color':'#eef3f7'}}]}}) : route.fulfill({body:Buffer.alloc(0),contentType:'application/x-protobuf'}));
  await f.page.goto(f.origin+'/PostList');
  await f.page.locator('#content-type').selectOption('sale');
  await f.page.locator('.sale-list-card').waitFor();
  assert.equal(await f.page.locator('.sale-list-card').count(),1);
  await f.page.getByRole('button',{name:'Map',exact:true}).click();
  await f.page.locator('#mapped-poll-links a').waitFor({state:'attached'});
  assert.equal(await f.page.locator('#mapped-poll-links a').getAttribute('href'),'/sale/'+id);
  await f.page.waitForFunction(()=>document.querySelector('.maplibregl-canvas'));
  for(const path of ['/create/sale','/sale/'+id,'/sale/'+id+'/manage#key='+key,'/PostList']) {
    await f.page.setViewportSize({width:320,height:800});
    await f.page.goto(f.origin+path); await f.page.waitForFunction(()=>!document.querySelector('.loading-state'));
    assert.ok(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),path);
  }
  await f.page.goto(f.origin+'/sale/'+id+'/manage');
  await f.page.getByText('management link is incomplete',{exact:false}).waitFor();
  assert.equal(await f.page.locator('.manage-card').count(),0);
  await f.page.goto('about:blank');
  await f.page.goto(f.origin+'/sale/'+id+'/manage#key='+'0'.repeat(64));
  await f.page.getByText('management link is invalid',{exact:false}).waitFor();
  assert.equal(await f.page.locator('.manage-card').count(),0);
  assert.deepEqual(f.errors,[]);
});
