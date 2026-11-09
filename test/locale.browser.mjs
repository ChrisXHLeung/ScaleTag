import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createApp } from '../src/app.js';
import { PollStore } from '../src/store.js';

test('browser language, manual preference, storage fallback and offline switching', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'scaletag-locale-'));
  const store = new PollStore(directory); await store.init();
  let app; const server = createServer((req, res) => app(req, res)).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  app = createApp(store, { origin });
  const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
  t.after(async () => { await browser.close(); await new Promise(r => server.close(r)); await rm(directory, {recursive:true, force:true}); });
  for (const [locale, language, home, task, privacy] of [
    ['zh-CN', 'zh', '身边的问题', '发布任务', '隐私'],
    ['en-US', 'en', 'Local questions', 'Your new task', 'Privacy'],
    ['fr-FR', 'en', 'Local questions', 'Your new task', 'Privacy'],
    ['zh-TW', 'zh', '身边的问题', '发布任务', '隐私'],
  ]) {
    const context = await browser.newContext({locale}); const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin); await page.getByText(home, {exact:false}).first().waitFor();
    assert.match(await page.locator('html').getAttribute('lang'), new RegExp(`^${language}`));
    await page.goto(`${origin}/create/task`); await page.getByText(task, {exact:false}).first().waitFor();
    await page.goto(`${origin}/privacy`); await page.getByText(privacy, {exact:false}).first().waitFor();
    assert.deepEqual(errors, []); await context.close();
  }
  const context = await browser.newContext({locale: 'zh-CN'});
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(origin);
  await page.locator('#language-select').selectOption('en');
  await page.getByRole('heading', {name: /Local questions/}).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(new URL(page.url()).searchParams.has('lang'), false);
  await page.reload();
  await page.getByRole('heading', {name: /Local questions/}).waitFor();
  await page.getByRole('link', {name: 'Create a task', exact: true}).first().click();
  await page.getByText('Your new task', {exact: true}).waitFor();
  await page.locator('#task-title').fill('我的标题 / My title');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#language-select').selectOption('zh');
  assert.equal(await page.locator('#task-title').inputValue(), '我的标题 / My title');
  assert.equal(await page.locator('#language-select').inputValue(), 'en');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#language-select').selectOption('zh');
  await page.getByText('发布任务', {exact: true}).first().waitFor();
  await page.reload();
  assert.equal(await page.locator('#language-select').inputValue(), 'zh');
  await page.goto(`${origin}/privacy`);
  await page.getByText('无需账户，不使用设备指纹。', {exact: true}).waitFor();
  const task = await store.create({type:'task', title:'My task 我的任务', description:'Keep my words 原样', reward:'Coffee 咖啡', signature:'Neighbour', options:[], images:[], location:{latitude:43.65,longitude:-79.38}, mapVisible:true});
  await page.goto(`${origin}/task/${task.id}`);
  await page.getByRole('heading', {name: 'My task 我的任务', exact:true}).waitFor();
  await page.locator('#reply-message').fill('草稿 draft');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#language-select').selectOption('en');
  assert.equal(await page.locator('#reply-message').inputValue(), '草稿 draft');
  await page.goto(`${origin}/task/${task.id}/manage?created=1#key=${task.manageKey}`);
  await page.getByRole('heading', {name: 'My task 我的任务', exact:true}).waitFor();
  await page.locator('#language-select').selectOption('en');
  await page.getByText('Private reply contacts', {exact:true}).waitFor();
  assert.equal(new URL(page.url()).hash, `#key=${task.manageKey}`);
  assert.equal(new URL(page.url()).searchParams.get('created'), '1');
  assert.equal(new URL(page.url()).searchParams.has('key'), false);
  assert.equal(await page.locator('.poll-description').textContent(), 'Keep my words 原样');
  await page.locator('#language-select').selectOption('zh');
  await page.getByText('回复者的私人联系方式', {exact:true}).waitFor();
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({width, height:900});
    const box = await page.locator('#language-select').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, `visible language selector at ${width}px`);
  }
  await page.setViewportSize({width:320, height:900});
  await page.screenshot({path:'/tmp/scaletag-language-mobile.png'});
  await page.goto(`${origin}/`);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.goto(`${origin}/privacy`);
  await page.getByRole('heading', {name: '无法连接。', exact: true}).waitFor();
  await page.locator('#language-select').selectOption('en');
  await page.getByRole('heading', {name: 'Connection unavailable.', exact: true}).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await context.close();

  const blocked = await browser.newContext({locale: 'en-US'});
  await blocked.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {get() {throw new DOMException('Blocked', 'SecurityError');}});
    Object.defineProperty(window, 'sessionStorage', {get() {throw new DOMException('Blocked', 'SecurityError');}});
  });
  const fallback = await blocked.newPage();
  const errors = []; fallback.on('pageerror', error => errors.push(error.message));
  await fallback.goto(origin);
  await fallback.locator('#language-select').selectOption('zh');
  await fallback.getByRole('heading', {name: /身边的问题/}).waitFor();
  assert.equal(new URL(fallback.url()).searchParams.get('lang'), 'zh');
  await fallback.locator('#language-storage-note').waitFor();
  await fallback.getByRole('link', {name: '创建任务', exact: true}).first().click();
  await fallback.getByText('发布任务', {exact: true}).first().waitFor();
  await fallback.reload();
  await fallback.getByText('发布任务', {exact: true}).first().waitFor();
  assert.equal(await fallback.locator('#language-select').inputValue(), 'zh');
  assert.deepEqual(errors, []);
  await blocked.close();

  const readOnly = await browser.newContext({locale: 'en-US'});
  const readOnlyPage = await readOnly.newPage();
  readOnlyPage.setDefaultTimeout(5000);
  await readOnlyPage.goto(origin);
  await readOnlyPage.evaluate(() => localStorage.setItem('scaletag-language', 'en'));
  await readOnly.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  });
  await readOnlyPage.reload();
  await readOnlyPage.locator('#language-select').selectOption('zh');
  await readOnlyPage.getByRole('heading', {name: /身边的问题/}).waitFor();
  assert.equal(await readOnlyPage.locator('#language-select').inputValue(), 'zh');
  await readOnly.close();

});
