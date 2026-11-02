process.umask(0o077);
// Offline migration: both serving instances must be stopped by the operator.
import Database from 'better-sqlite3-multiple-ciphers';
import { parseEncryptionKey } from './encryption.js';
import { openDatabase } from './database.js';
import { readFileSync } from 'node:fs';
const filename = `${process.env.DATA_DIR ?? '/data'}/scaletag.sqlite`;
const key = parseEncryptionKey(process.env.SCALETAG_ENCRYPTION_KEY);
if (readFileSync(filename).subarray(0, 16).toString() === 'SQLite format 3\0') {
  const db = new Database(filename, { fileMustExist: true });
  try {
    db.pragma('busy_timeout=10000');
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.pragma('journal_mode=DELETE');
    db.pragma("cipher='sqlcipher'");
    db.rekey(key);
  } finally { db.close(); key.fill(0); }
}
const check = openDatabase(filename, { fileMustExist: true });
try {
  if (check.pragma('integrity_check', { simple: true }) !== 'ok') throw Error('Encrypted database integrity check failed');
  console.log('Encrypted database verified');
} finally { check.close(); }
