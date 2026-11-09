import test from 'node:test';
import assert from 'node:assert/strict';
import { languageFor, translate } from '../public/locale.js';
test('selects Chinese from the browser preferred language and English otherwise', () => {
  assert.equal(languageFor(['zh-CN', 'en-US']), 'zh');
  assert.equal(languageFor(['zh-TW']), 'zh');
  assert.equal(languageFor(['en-US', 'zh-CN']), 'en');
  assert.equal(languageFor([]), 'en');
  assert.equal(translate('en', 'Hello', '你好'), 'Hello');
  assert.equal(translate('zh', 'Hello', '你好'), '你好');
});
