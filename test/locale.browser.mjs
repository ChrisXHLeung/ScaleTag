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

test('browser language selects Chinese or English across pages', async (t) => {
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
  ]) {
    const context = await browser.newContext({locale}); const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin); await page.getByText(home, {exact:false}).first().waitFor();
    assert.match(await page.locator('html').getAttribute('lang'), new RegExp(`^${language}`));
    await page.goto(`${origin}/create/task`); await page.getByText(task, {exact:false}).first().waitFor();
    await page.goto(`${origin}/privacy`); await page.getByText(privacy, {exact:false}).first().waitFor();
    assert.deepEqual(errors, []); await context.close();
  }
});
