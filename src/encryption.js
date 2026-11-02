import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Callers supply the key at runtime; never persist it with encrypted data.
export function parseEncryptionKey(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value))
    throw new Error('Encryption key must contain exactly 64 hexadecimal characters');
  return Buffer.from(value, 'hex');
}

export function encryptDocument(value, key, context) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') });
}

export function decryptDocument(envelope, key, context) {
  const data = JSON.parse(envelope);
  if (data.version !== 1) throw new Error('Unsupported encrypted document version');
  const iv = Buffer.from(data.iv, 'base64');
  const tag = Buffer.from(data.tag, 'base64');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted document');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
}
