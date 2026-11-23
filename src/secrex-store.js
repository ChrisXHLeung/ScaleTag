import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Algorithm, hash, verify } from "@node-rs/argon2";
import { openDatabase } from "./database.js";
import { AppError } from "./validation.js";

const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 };
const sessionHash = value => createHash("sha256").update(value, "ascii").digest("hex");

function unavailable() {
  return new AppError(404, "This secret is unavailable or the share password is incorrect.");
}

export class SecrexStore {
  constructor(directory, { clock = Date.now, pendingMs = 604800000, sessionMs = 300000 } = {}) {
    this.directory = directory;
    this.clock = clock;
    this.pendingMs = pendingMs;
    this.sessionMs = sessionMs;
    this.hashesInFlight = 0;
  }

  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    // The ScaleTag post archive deliberately excludes this short-lived database.
    const filename = join(this.directory, "secrex.sqlite");
    this.db = openDatabase(filename);
    try {
      chmodSync(filename, 0o600);
      this.db.exec(`
        PRAGMA busy_timeout=3000;
        PRAGMA journal_mode=DELETE;
        PRAGMA synchronous=FULL;
        PRAGMA secure_delete=ON;
        PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS secrex_history (
          id TEXT PRIMARY KEY, created_at INTEGER NOT NULL,
          state TEXT NOT NULL, finished_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS secrex_payload (
          id TEXT PRIMARY KEY REFERENCES secrex_history(id),
          envelope TEXT NOT NULL, verifier TEXT NOT NULL,
          pending_until INTEGER NOT NULL, session_hash TEXT,
          session_until INTEGER
        );
        CREATE TABLE IF NOT EXISTS secrex_revocation (
          id TEXT PRIMARY KEY REFERENCES secrex_payload(id) ON DELETE CASCADE,
          verifier TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS secrex_creation ON secrex_history(created_at);
        CREATE INDEX IF NOT EXISTS secrex_pending ON secrex_payload(pending_until);
        CREATE INDEX IF NOT EXISTS secrex_sessions ON secrex_payload(session_until);
      `);
      this.sweep();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  close() {
    this.db?.close();
    this.db = null;
  }

  async argon(operation) {
    if (this.hashesInFlight >= 4)
      throw new AppError(429, "Secrex is busy. Try again shortly.");
    this.hashesInFlight++;
    try {
      return await operation();
    } finally {
      this.hashesInFlight--;
    }
  }

  async create({ id, claim, ...envelope }, revokeVerifier) {
    const verifier = await this.argon(() => hash(claim, { ...ARGON, salt: randomBytes(16) }));
    this.db.transaction(() => {
      if (this.db.prepare("SELECT 1 FROM secrex_history WHERE id=?").get(id))
        throw new AppError(409, "This share address already exists.");
      if (this.db.prepare("SELECT count(*) AS count FROM secrex_payload").get().count >= 2000)
        throw new AppError(503, "Secrex is currently at capacity.");
      const now = this.clock();
      this.db.prepare("INSERT INTO secrex_history VALUES (?, ?, 'pending', NULL)").run(id, now);
      this.db.prepare("INSERT INTO secrex_payload VALUES (?, ?, ?, ?, NULL, NULL)")
        .run(id, JSON.stringify(envelope), verifier, now + this.pendingMs);
      if (revokeVerifier)
        this.db.prepare("INSERT INTO secrex_revocation VALUES (?, ?)").run(id, revokeVerifier);
    }).immediate();
  }

  createdCount(after, now) {
    return this.db.prepare("SELECT count(*) AS count FROM secrex_history WHERE created_at > ? AND created_at <= ?")
      .get(after, now).count;
  }

  finish(id, now, state) {
    this.db.prepare("DELETE FROM secrex_payload WHERE id=?").run(id);
    this.db.prepare("UPDATE secrex_history SET state=?, finished_at=? WHERE id=?")
      .run(state, now, id);
  }

  live(id, now) {
    const row = this.db.prepare("SELECT * FROM secrex_payload WHERE id=?").get(id);
    if (row && (row.session_until ?? row.pending_until) <= now) {
      this.finish(id, now, "expired");
      return undefined;
    }
    return row;
  }

  async claim(id, claim, session) {
    const digest = sessionHash(session);
    const candidate = this.db.transaction(() => this.live(id, this.clock())).immediate();
    if (!candidate || (candidate.session_hash && digest !== candidate.session_hash))
      throw unavailable();
    if (!await this.argon(() => verify(candidate.verifier, claim))) throw unavailable();

    const result = this.db.transaction(() => {
      // Argon2 runs outside the lock. A competing request may have won or the
      // record may have expired, so make the decision again within the write lock.
      const now = this.clock();
      const row = this.live(id, now);
      if (!row || row.verifier !== candidate.verifier) return null;
      if (row.session_hash && row.session_hash !== digest) return null;
      const expiresAt = row.session_until ?? Math.min(now + this.sessionMs, row.pending_until);
      if (!row.session_hash) {
        this.db.prepare("UPDATE secrex_payload SET session_hash=?, session_until=? WHERE id=?")
          .run(digest, expiresAt, id);
        this.db.prepare("DELETE FROM secrex_revocation WHERE id=?").run(id);
        this.db.prepare("UPDATE secrex_history SET state='reading' WHERE id=?").run(id);
      }
      return { ...JSON.parse(row.envelope), expiresAt, remainingMs: expiresAt - now };
    }).immediate();
    if (!result) throw unavailable();
    return result;
  }

  revoke(id, code) {
    const digest = createHash("sha256").update(`scaletag:secrex:revoke:v1:${id}:${code}`).digest();
    const revoked = this.db.transaction(() => {
      const now = this.clock();
      const row = this.live(id, now);
      if (!row || row.session_hash) return false;
      const record = this.db.prepare("SELECT verifier FROM secrex_revocation WHERE id=?").get(id);
      if (!record) return false;
      const expected = Buffer.from(record.verifier, "base64url");
      if (expected.length !== digest.length || !timingSafeEqual(expected, digest)) return false;
      this.finish(id, now, "revoked");
      return true;
    }).immediate();
    if (!revoked) throw new AppError(404, "This secret cannot be revoked or the code is incorrect.");
  }

  end(id, session) {
    const digest = sessionHash(session);
    const ended = this.db.transaction(() => {
      const now = this.clock();
      const row = this.live(id, now);
      if (!row) {
        return !!this.db.prepare(
          "SELECT 1 FROM secrex_history WHERE id=? AND finished_at IS NOT NULL"
        ).get(id);
      }
      if (row.session_hash !== digest) return false;
      this.finish(id, now, "destroyed");
      return true;
    }).immediate();
    if (!ended) throw unavailable();
  }

  sweep() {
    this.db.transaction(() => {
      const now = this.clock();
      const rows = this.db.prepare(`
        SELECT id FROM secrex_payload
        WHERE pending_until<=? OR session_until<=?
      `).all(now, now);
      for (const { id } of rows) this.finish(id, now, "expired");
    }).immediate();
  }
}
