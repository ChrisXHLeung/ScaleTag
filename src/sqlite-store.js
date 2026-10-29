import { DatabaseSync } from "node:sqlite";
import { mkdir, readdir } from "node:fs/promises";
import { statfsSync, chmodSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { PollStore, ID_PATTERN } from "./store.js";
import { AppError } from "./validation.js";

// Also serialize connections in the same JS process: a synchronous busy wait
// must never prevent another connection's pending microtask from committing.
const queues = new Map();
export class SQLiteStore extends PollStore {
  constructor(directory, options = {}) {
    super(resolve(directory), options);
    this.filename = join(this.directory, "scaletag.sqlite");
  }

  async init({ allowImport = false } = {}) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const legacy = (await readdir(this.directory)).some(n => /^[a-f0-9]{24}\.json$/.test(n));
    if (!allowImport && legacy && !existsSync(this.filename))
      throw Error("Legacy JSON found: stop the JSON writer and run npm run migrate:sqlite first.");
    this.db = new DatabaseSync(this.filename);
    chmodSync(this.filename, 0o600);
    this.db.exec(`
      PRAGMA busy_timeout=3000;
      PRAGMA journal_mode=DELETE;
      PRAGMA synchronous=FULL;
      PRAGMA cache_size=-2048;
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY CHECK(length(id)=24),
        document TEXT NOT NULL CHECK(json_valid(document)),
        created_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
        delete_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS posts_expiry ON posts(delete_at);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, start INTEGER NOT NULL, count INTEGER NOT NULL);
    `);
    const imported = this.db.prepare("SELECT 1 FROM metadata WHERE key='json-import'").get();
    if (!allowImport && !imported && legacy) {
      this.close();
      throw Error("Legacy JSON found: stop the JSON writer and run npm run migrate:sqlite first.");
    }
  }

  async exclusive(key, fn) {
    const previous = queues.get(this.filename) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      // Lock BEFORE reading, not merely while writing: counters and browser
      // deduplication must be checked and updated in the same transaction.
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn();
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      } finally {
        this.index.clear();
      }
    });
    queues.set(this.filename, current);
    try { return await current; }
    finally { if (queues.get(this.filename) === current) queues.delete(this.filename); }
  }

  read(id) {
    if (!ID_PATTERN.test(id)) throw new AppError(404, "Post not found.");
    const row = this.db.prepare("SELECT document FROM posts WHERE id=?").get(id);
    return { data: row ? JSON.parse(row.document) : null };
  }

  write({ data }) {
    const disk = statfsSync(this.directory);
    if (disk.bavail * disk.bsize < this.diskReserveBytes)
      throw new AppError(503, "Storage is currently at capacity. Please try again later.");
    this.db.prepare(`INSERT INTO posts VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET document=excluded.document,
      created_at=excluded.created_at, ends_at=excluded.ends_at, delete_at=excluded.delete_at`)
      .run(data.id, JSON.stringify(data), data.createdAt, data.endsAt, data.deleteAt);
  }

  remove(id) { this.db.prepare("DELETE FROM posts WHERE id=?").run(id); }

  count() {
    return this.db.prepare("SELECT count(*) AS count FROM posts WHERE delete_at>?").get(this.clock()).count;
  }

  refreshIndex() {
    this.index = new Map(this.db.prepare(`SELECT json_set(
      json_remove(document,'$.voters','$.likers','$.replies','$.replyAuthors'),
      '$.replyCount',coalesce(json_array_length(document,'$.replies'),0)) AS document
      FROM posts WHERE delete_at>?`)
      .all(this.clock()).map(({ document }) => {
        const post = JSON.parse(document);
        return [post.id, this.summary(post)];
      }));
  }

  list(options) {
    this.refreshIndex();
    try { return super.list(options); } finally { this.index.clear(); }
  }

  map(options) {
    this.refreshIndex();
    try { return super.map(options); } finally { this.index.clear(); }
  }

  async sweep() {
    return this.exclusive("sweep", () => {
      this.db.prepare("DELETE FROM posts WHERE delete_at<=?").run(this.clock());
      this.db.prepare(`UPDATE posts SET document=json_set(document,'$.voters',json('{}'))
        WHERE ends_at<=? AND EXISTS(SELECT 1 FROM json_each(document,'$.voters'))`)
        .run(this.clock());
    });
  }

  ready() {
    this.db.prepare("SELECT id FROM posts LIMIT 1").get();
    return true;
  }

  async consumeLimit(key, limit) {
    return this.exclusive("rate", () => {
      const now = this.clock();
      this.db.prepare(`INSERT INTO rate_limits VALUES(?,?,1)
        ON CONFLICT(key) DO UPDATE SET
        start=CASE WHEN ?-start>=60000 THEN ? ELSE start END,
        count=CASE WHEN ?-start>=60000 THEN 1 ELSE count+1 END`)
        .run(key, now, now, now, now);
      const row = this.db.prepare("SELECT count FROM rate_limits WHERE key=?").get(key);
      return row.count <= limit;
    });
  }

  close() { this.db?.close(); this.db = null; }
}
