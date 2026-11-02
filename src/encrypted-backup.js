process.umask(0o077);
import { openDatabase } from './database.js';
import { encryptDocument, decryptDocument, parseEncryptionKey } from './encryption.js';
const key = parseEncryptionKey(process.env.SCALETAG_ENCRYPTION_KEY);
const context = 'scaletag:backup:v1';
if (process.argv.includes('--verify')) {
  let raw = ''; for await (const part of process.stdin) raw += part;
  const data = decryptDocument(raw, key, context);
  if (data.version !== 1 || !Array.isArray(data.posts)) throw Error('Invalid backup');
  process.stdout.write(JSON.stringify({ verified: true, count: data.posts.length }));
} else {
  const db = openDatabase(`${process.env.DATA_DIR ?? '/data'}/scaletag.sqlite`, { readonly: true, fileMustExist: true, ...(process.argv.includes("--plaintext-source") ? { key: "" } : {}) });
  try {
    db.exec('BEGIN');
    const data = { version: 1, createdAt: new Date().toISOString(), posts: db.prepare('SELECT * FROM posts').all(), metadata: db.prepare('SELECT * FROM metadata').all(), rate_limits: db.prepare('SELECT * FROM rate_limits').all() };
    db.exec('COMMIT');
    const encrypted = encryptDocument(data, key, context);
    decryptDocument(encrypted, key, context);
    process.stdout.write(encrypted);
  } finally { db.close(); key.fill(0); }
}
