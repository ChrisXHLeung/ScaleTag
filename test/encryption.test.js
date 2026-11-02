import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { parseEncryptionKey, encryptDocument, decryptDocument } from '../src/encryption.js';

test('AES-GCM authenticates document, key, record identity and ciphertext', () => {
  const key = parseEncryptionKey(randomBytes(32).toString('hex'));
  const value = { question: 'private content', votes: 12 };
  const encrypted = encryptDocument(value, key, 'post:123');
  assert.deepEqual(decryptDocument(encrypted, key, 'post:123'), value);
  assert.ok(!encrypted.includes('private content'));
  assert.notEqual(encryptDocument(value, key, 'post:123'), encrypted);
  assert.throws(() => decryptDocument(encrypted, randomBytes(32), 'post:123'));
  assert.throws(() => decryptDocument(encrypted, key, 'post:456'));
  const changed = JSON.parse(encrypted);
  const bytes = Buffer.from(changed.ciphertext, 'base64');
  bytes[0] ^= 1;
  changed.ciphertext = bytes.toString('base64');
  assert.throws(() => decryptDocument(JSON.stringify(changed), key, 'post:123'));
  assert.throws(() => parseEncryptionKey('invalid'));
});
