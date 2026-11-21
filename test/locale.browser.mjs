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
import { SecrexStore } from '../src/secrex-store.js';
import { createTaskCredentials } from '../public/task-crypto.js';

test('browser language, manual preference, storage fallback and offline switching', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'scaletag-locale-'));
  const store = new PollStore(directory);
  await store.init();
  const secrex = new SecrexStore(directory);
  await secrex.init();
  let app;
  const server = createServer((req, res) => app(req, res)).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  app = createApp(store, { origin, secrex });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  t.after(async () => {
    await browser.close();
    secrex.close();
    await new Promise(r => server.close(r));
    await rm(directory, { recursive: true, force: true });
  });

  // 1. Auto-detect all 5 languages (zh, en, ja, ko, fr) + unsupported fallback to en
  for (const [locale, htmlLang, home, task, privacy, secrex] of [
    ['zh-CN', 'zh-Hans', '关心身边事', '发布任务', '隐私', '创建阅后即焚私密信息'],
    ['zh-TW', 'zh-Hans', '关心身边事', '发布任务', '隐私', '创建阅后即焚私密信息'],
    ['en-US', 'en', 'Local questions', 'Your new task', 'Privacy', 'Create a one-time secret'],
    ['ja-JP', 'ja', '身近な疑問から', '新しいタスク', 'プライバシーとデータ保持', 'ワンタイムシークレットを作成'],
    ['ko-KR', 'ko', '우리 동네의 질문', '새 작업 만들기', '개인정보 및 데이터 보관', '일회성 비밀 메시지 만들기'],
    ['fr-FR', 'fr', 'Questions locales', 'Votre nouvelle tâche', 'Confidentialité et conservation des données', 'Créer un secret à usage unique'],
    ['de-DE', 'en', 'Local questions', 'Your new task', 'Privacy', 'Create a one-time secret'],
  ]) {
    const context = await browser.newContext({ locale });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin);
    await page.getByText(home, { exact: false }).first().waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), htmlLang);
    const options = await page.locator('#language-select option').evaluateAll(nodes =>
      nodes.map(node => ({ value: node.value, text: node.textContent, lang: node.lang })),
    );
    assert.deepEqual(options, [
      { value: 'en', text: 'English', lang: 'en' },
      { value: 'zh', text: '中文', lang: 'zh-Hans' },
      { value: 'ja', text: '日本語', lang: 'ja' },
      { value: 'ko', text: '한국어', lang: 'ko' },
      { value: 'fr', text: 'Français', lang: 'fr' },
    ]);
    await page.goto(`${origin}/create/task`);
    await page.getByText(task, { exact: false }).first().waitFor();
    await page.goto(`${origin}/privacy`);
    await page.getByText(privacy, { exact: false }).first().waitFor();
    await page.goto(`${origin}/secrex`);
    await page.getByText(secrex, { exact: false }).first().waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }

  // 2. Manual switching across all 5 languages, reload persistence, draft guard, management hash, offline switching
  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const mainErrors = [];
  page.on('pageerror', e => mainErrors.push(e.message));

  await page.goto(origin);
  await page.locator('#language-select').selectOption('en');
  await page.getByRole('heading', { name: /Local questions/ }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(new URL(page.url()).searchParams.has('lang'), false);
  await page.reload();
  await page.getByRole('heading', { name: /Local questions/ }).waitFor();

  for (const [lang, htmlLang, homeSnippet, labelText] of [
    ['ja', 'ja', /身近な疑問から/, '言語'],
    ['ko', 'ko', /우리 동네의 질문/, '언어'],
    ['fr', 'fr', /Questions locales/, 'Langue'],
  ]) {
    await page.locator('#language-select').selectOption(lang);
    await page.getByRole('heading', { name: homeSnippet }).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), htmlLang);
    assert.equal(await page.locator('label[for="language-select"]').textContent(), labelText);
    assert.equal(new URL(page.url()).searchParams.has('lang'), false);
    await page.reload();
    assert.equal(await page.locator('#language-select').inputValue(), lang);
    assert.equal(await page.locator('html').getAttribute('lang'), htmlLang);
    await page.getByRole('heading', { name: homeSnippet }).waitFor();
  }

  await page.locator('#language-select').selectOption('en');
  await page.getByRole('heading', { name: /Local questions/ }).waitFor();
  await page.getByRole('link', { name: 'Create a task', exact: true }).first().click();
  await page.getByText('Your new task', { exact: true }).waitFor();
  await page.locator('#task-title').fill('我的标题 / My title');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#language-select').selectOption('zh');
  assert.equal(await page.locator('#task-title').inputValue(), '我的标题 / My title');
  assert.equal(await page.locator('#language-select').inputValue(), 'en');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#language-select').selectOption('zh');
  await page.getByText('发布任务', { exact: true }).first().waitFor();
  await page.reload();
  assert.equal(await page.locator('#language-select').inputValue(), 'zh');

  await page.goto(`${origin}/privacy`);
  await page.getByText('无需账户，不使用设备指纹。', { exact: true }).waitFor();

  const { authKey, contactPublicKey, encryptedPrivateKey } = await createTaskCredentials();
  const task = await store.create({
    type: 'task',
    title: 'My task 我的任务',
    description: 'Keep my words 原样',
    reward: 'Coffee 咖啡',
    signature: 'Neighbour',
    options: [],
    images: [],
    location: { latitude: 43.65, longitude: -79.38 },
    mapVisible: true,
    authKey,
    contactPublicKey,
    encryptedPrivateKey,
  });

  await page.goto(`${origin}/task/${task.id}`);
  await page.getByRole('heading', { name: 'My task 我的任务', exact: true }).waitFor();
  await page.locator('#reply-message').fill('草稿 draft');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#language-select').selectOption('en');
  assert.equal(await page.locator('#reply-message').inputValue(), '草稿 draft');

  await page.goto(`${origin}/task/${task.id}/manage?created=1#key=${authKey}`);
  await page.getByRole('heading', { name: 'My task 我的任务', exact: true }).waitFor();
  await page.locator('#language-select').selectOption('en');
  await page.getByText('Private reply contacts', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, `#key=${authKey}`);
  assert.equal(new URL(page.url()).searchParams.get('created'), '1');
  assert.equal(new URL(page.url()).searchParams.has('key'), false);
  assert.equal(await page.locator('.poll-description').textContent(), 'Keep my words 原样');

  await page.locator('#language-select').selectOption('ja');
  await page.getByText('返信者の非公開連絡先', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, `#key=${authKey}`);
  await page.locator('#language-select').selectOption('zh');
  await page.getByText('回复者的私人联系方式', { exact: true }).waitFor();

  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const box = await page.locator('#language-select').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, `visible language selector at ${width}px`);
  }
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({ path: '/tmp/scaletag-language-mobile.png' });

  // Offline switching via service worker precache (/locale-translations.js included)
  await page.goto(`${origin}/`);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.goto(`${origin}/privacy`);
  await page.getByRole('heading', { name: '无法连接。', exact: true }).waitFor();
  await page.locator('#language-select').selectOption('ja');
  await page.getByRole('heading', { name: '接続できません。', exact: true }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'ja');
  await page.locator('#language-select').selectOption('fr');
  await page.getByRole('heading', { name: 'Connexion indisponible.', exact: true }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'fr');
  await page.locator('#language-select').selectOption('en');
  await page.getByRole('heading', { name: 'Connection unavailable.', exact: true }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.deepEqual(mainErrors, []);
  await context.close();

  // 3. Storage blocked fallback via ?lang=
  const blocked = await browser.newContext({ locale: 'en-US' });
  await blocked.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
    Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  const fallback = await blocked.newPage();
  const errors = [];
  fallback.on('pageerror', error => errors.push(error.message));
  await fallback.goto(origin);
  await fallback.locator('#language-select').selectOption('zh');
  await fallback.getByRole('heading', { name: /关心身边事/ }).waitFor();
  assert.equal(new URL(fallback.url()).searchParams.get('lang'), 'zh');
  await fallback.locator('#language-storage-note').waitFor();
  await fallback.getByRole('link', { name: '创建任务', exact: true }).first().click();
  await fallback.getByText('发布任务', { exact: true }).first().waitFor();
  await fallback.reload();
  await fallback.getByText('发布任务', { exact: true }).first().waitFor();
  assert.equal(await fallback.locator('#language-select').inputValue(), 'zh');

  await fallback.locator('#language-select').selectOption('ko');
  await fallback.getByText('새 작업 만들기', { exact: true }).first().waitFor();
  assert.equal(new URL(fallback.url()).searchParams.get('lang'), 'ko');
  assert.equal(await fallback.locator('#language-select').inputValue(), 'ko');
  assert.equal(await fallback.locator('html').getAttribute('lang'), 'ko');
  assert.deepEqual(errors, []);
  await blocked.close();

  // 4. Read-only storage fallback
  const readOnly = await browser.newContext({ locale: 'en-US' });
  const readOnlyPage = await readOnly.newPage();
  readOnlyPage.setDefaultTimeout(5000);
  await readOnlyPage.goto(origin);
  await readOnlyPage.evaluate(() => localStorage.setItem('scaletag-language', 'en'));
  await readOnly.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  });
  await readOnlyPage.reload();
  await readOnlyPage.locator('#language-select').selectOption('fr');
  await readOnlyPage.getByRole('heading', { name: /Questions locales/ }).waitFor();
  assert.equal(await readOnlyPage.locator('#language-select').inputValue(), 'fr');
  assert.equal(await readOnlyPage.locator('html').getAttribute('lang'), 'fr');
  await readOnly.close();
});
