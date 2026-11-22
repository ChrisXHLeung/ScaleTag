import { voterHash } from "./store.js";

const HOUR = 60 * 60 * 1000;
const SITE = "";
const hourOf = timestamp => Math.floor(timestamp / HOUR);
const firstHour = (hour, days) => hour - days * 24 + 1;

export class TrafficCounters {
  constructor(db, write, now) {
    this.write = write;
    this.lastSweepHour = null;
    db.exec(`
      CREATE TABLE IF NOT EXISTS traffic_visitors (
        scope TEXT NOT NULL,
        browser_hash TEXT NOT NULL,
        hour INTEGER NOT NULL,
        PRIMARY KEY(scope, browser_hash)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS traffic_visitors_scope_hour ON traffic_visitors(scope, hour);
      CREATE INDEX IF NOT EXISTS traffic_visitors_hour ON traffic_visitors(hour);
      CREATE TABLE IF NOT EXISTS traffic_visitor_collection (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        started_at INTEGER NOT NULL
      );
    `);
    db.prepare("INSERT OR IGNORE INTO traffic_visitor_collection VALUES (1, ?)").run(now);
    this.startedAt = db.prepare("SELECT started_at FROM traffic_visitor_collection WHERE singleton = 1").get().started_at;
    this.touch = db.prepare(`
      INSERT INTO traffic_visitors VALUES (?, ?, ?)
      ON CONFLICT(scope, browser_hash) DO UPDATE SET hour = excluded.hour
      WHERE excluded.hour > traffic_visitors.hour
    `);
    this.totals = db.prepare(`
      SELECT count(CASE WHEN hour >= ? THEN 1 END) AS days7, count(*) AS days30
      FROM traffic_visitors WHERE scope = ? AND hour BETWEEN ? AND ?
    `);
    this.removeOld = db.prepare("DELETE FROM traffic_visitors WHERE hour < ?");
    // Raw page views collected by old deployments age out under the same policy.
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'traffic_views'").get())
      this.removeOldPageViews = db.prepare("DELETE FROM traffic_views WHERE hour < ?");
  }

  record(now, browserToken, id = SITE) {
    const hour = hourOf(now);
    // Use different hashes for the same browser on the site and each post.
    const siteHash = voterHash(`traffic:${SITE}:${browserToken}`);
    const postHash = id === SITE ? null : voterHash(`traffic:${id}:${browserToken}`);
    return this.write(() => {
      this.touch.run(SITE, siteHash, hour);
      if (postHash) this.touch.run(id, postHash, hour);
    });
  }

  views(now, id = SITE) {
    const hour = hourOf(now);
    const { days7, days30 } = this.totals.get(firstHour(hour, 7), id, firstHour(hour, 30), hour);
    return { days7, days30 };
  }

  async sweep(now) {
    const hour = hourOf(now);
    if (hour === this.lastSweepHour) return;
    const cutoff = firstHour(hour, 30);
    await this.write(() => {
      this.removeOld.run(cutoff);
      this.removeOldPageViews?.run(cutoff);
    });
    this.lastSweepHour = hour;
  }
}
