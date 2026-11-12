import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  parseEncryptionKey,
  encryptDocument,
  decryptDocument,
  createTaskCredentials,
  deriveTaskAuthKey,
  encryptReplyContact,
  decryptReplyContacts,
  unwrapTaskPrivateKey,
} from '../src/encryption.js';

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

test('task contact asymmetric encryption separates auth and decryption keys and protects phone/email', async () => {
  const creds = await createTaskCredentials();
  assert.match(creds.password, /^[a-f0-9]{64}$/);
  assert.match(creds.authKey, /^[a-f0-9]{64}$/);
  assert.notEqual(creds.authKey, creds.password);
  assert.equal(await deriveTaskAuthKey(creds.password), creds.authKey);

  const c1 = await encryptReplyContact(creds.contactPublicKey, { phone: '+1 (416) 555-0123' });
  const c2 = await encryptReplyContact(creds.contactPublicKey, { email: 'helper@example.com' });
  const c3 = await encryptReplyContact(creds.contactPublicKey, { phone: '416-555-0124', email: 'both@example.com' });
  for (const envelope of [c1, c2, c3]) {
    const serialized = JSON.stringify(envelope);
    assert.ok(!serialized.includes('416'));
    assert.ok(!serialized.includes('example.com'));
  }

  // The server-visible authKey cannot unwrap the private key or decrypt contacts.
  await assert.rejects(
    unwrapTaskPrivateKey(creds.authKey, creds.contactPublicKey, creds.encryptedPrivateKey),
  );
  await assert.rejects(
    decryptReplyContacts(creds.authKey, {
      contactPublicKey: creds.contactPublicKey,
      encryptedPrivateKey: creds.encryptedPrivateKey,
      replies: [{ id: '1', name: 'A', message: 'Hi', createdAt: 1, encryptedContact: c1 }],
    }),
  );

  // Tampered ciphertext or mismatched context is rejected.
  const otherCreds = await createTaskCredentials();
  await assert.rejects(
    unwrapTaskPrivateKey(creds.password, otherCreds.contactPublicKey, creds.encryptedPrivateKey),
  );
  const tampered = { ...c2, ciphertext: Buffer.from(c2.ciphertext, 'base64').map((b, i) => (i === 0 ? b ^ 1 : b)).toString('base64') };
  await assert.rejects(
    decryptReplyContacts(creds.password, {
      contactPublicKey: creds.contactPublicKey,
      encryptedPrivateKey: creds.encryptedPrivateKey,
      replies: [{ id: '1', name: 'A', message: 'Hi', createdAt: 1, encryptedContact: tampered }],
    }),
  );
  const boundContact = await encryptReplyContact(creds.contactPublicKey, { phone: '416-555-9999' }, 'task:abc');
  await assert.rejects(
    decryptReplyContacts(
      creds.password,
      {
        contactPublicKey: creds.contactPublicKey,
        encryptedPrivateKey: creds.encryptedPrivateKey,
        replies: [{ id: '1', name: 'A', message: 'Hi', createdAt: 1, encryptedContact: boundContact }],
      },
      'task:xyz',
    ),
  );

  const decrypted = await decryptReplyContacts(creds.password, {
    contactPublicKey: creds.contactPublicKey,
    encryptedPrivateKey: creds.encryptedPrivateKey,
    replies: [
      { id: '1', name: 'A', message: 'M1', createdAt: 1, encryptedContact: c1 },
      { id: '2', name: 'B', message: 'M2', createdAt: 2, encryptedContact: c2 },
      { id: '3', name: 'C', message: 'M3', createdAt: 3, encryptedContact: c3 },
    ],
  });
  assert.deepEqual(
    decrypted.map((r) => [r.phone, r.email, r.encryptedContact]),
    [
      ['+1 (416) 555-0123', undefined, undefined],
      [undefined, 'helper@example.com', undefined],
      ['416-555-0124', 'both@example.com', undefined],
    ],
  );
});
