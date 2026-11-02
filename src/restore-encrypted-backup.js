process.umask(0o077);
// Restore to a NEW database only; never overwrite a serving database.
import { existsSync } from 'node:fs';
import { openDatabase } from './database.js';
import { decryptDocument, parseEncryptionKey } from './encryption.js';
const filename = process.argv[2];
if (!filename || existsSync(filename)) throw Error('Restore target must be a new database path');
let raw = ''; for await (const part of process.stdin) raw += part;
const key = parseEncryptionKey(process.env.SCALETAG_ENCRYPTION_KEY);
const data = decryptDocument(raw, key, 'scaletag:backup:v1');
key.fill(0);
if (data.version !== 1 || !Array.isArray(data.posts)) throw Error('Invalid backup');
const db = openDatabase(filename);
try {
 db.exec(`CREATE TABLE posts(id TEXT PRIMARY KEY,document TEXT NOT NULL CHECK(json_valid(document)),created_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,delete_at INTEGER NOT NULL); CREATE INDEX posts_expiry ON posts(delete_at); CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE rate_limits(key TEXT PRIMARY KEY,start INTEGER NOT NULL,count INTEGER NOT NULL); BEGIN IMMEDIATE`);
 const insert=db.prepare('INSERT INTO posts VALUES(?,?,?,?,?)');
 for(const p of data.posts) {
  if(JSON.parse(p.document).id !== p.id) throw Error('Invalid post identity');
  insert.run(p.id,p.document,p.created_at,p.ends_at,p.delete_at);
 }
 for(const row of data.metadata) db.prepare('INSERT INTO metadata VALUES(?,?)').run(row.key,row.value);
 for(const row of data.rate_limits) db.prepare('INSERT INTO rate_limits VALUES(?,?,?)').run(row.key,row.start,row.count);
 db.exec('COMMIT');
 if(db.pragma('integrity_check',{simple:true}) !== 'ok') throw Error('Restore integrity check failed');
 console.log('Encrypted restore verified');
} finally {db.close();}
