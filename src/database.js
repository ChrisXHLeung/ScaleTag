import Database from 'better-sqlite3-multiple-ciphers';
import { parseEncryptionKey } from './encryption.js';

export function openDatabase(filename, { key = process.env.SCALETAG_ENCRYPTION_KEY, ...options } = {}) {
  const bytes = key ? parseEncryptionKey(key) : null;
  const db = new Database(filename, options);
  try {
    if (bytes) {
      db.pragma("cipher='sqlcipher'");
      db.key(bytes);
    }
    db.prepare('SELECT count(*) FROM sqlite_master').get();
    return db;
  } catch {
    db.close();
    throw new Error('Cannot open database: encryption key is missing or incorrect, or migration is required');
  } finally { bytes?.fill(0); }
}
