const HOUR = 60 * 60 * 1000;
const SITE = "";
const hourOf = timestamp => Math.floor(timestamp / HOUR);
const firstHour = (hour, days) => hour - days * 24 + 1;

export class TrafficCounters {
  constructor(db, write, now) {
    this.write = write;
    this.lastSweepHour = null;
    db.exec(`
      CREATE TABLE IF NOT EXISTS traffic_views (
        scope TEXT NOT NULL,
        hour INTEGER NOT NULL,
        count INTEGER NOT NULL CHECK(count > 0),
        PRIMARY KEY(scope, hour)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS traffic_views_hour ON traffic_views(hour);
      CREATE TABLE IF NOT EXISTS traffic_collection (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        started_at INTEGER NOT NULL
      );
    `);
    db.prepare("INSERT OR IGNORE INTO traffic_collection VALUES (1, ?)").run(now);
    this.startedAt = db.prepare("SELECT started_at FROM traffic_collection WHERE singleton = 1").get().started_at;
    this.increment = db.prepare(`
      INSERT INTO traffic_views VALUES (?, ?, 1)
      ON CONFLICT(scope, hour) DO UPDATE SET count = count + 1
    `);
    this.totals = db.prepare(`
      SELECT coalesce(sum(CASE WHEN hour >= ? THEN count END), 0) AS days7,
             coalesce(sum(count), 0) AS days30
      FROM traffic_views WHERE scope = ? AND hour BETWEEN ? AND ?
    `);
    this.removeOld = db.prepare("DELETE FROM traffic_views WHERE hour < ?");
  }

  record(now, id = SITE) {
    const hour = hourOf(now);
    return this.write(() => {
      this.increment.run(SITE, hour);
      if (id !== SITE) this.increment.run(id, hour);
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
    await this.write(() => this.removeOld.run(firstHour(hour, 30)));
    this.lastSweepHour = hour;
  }
}
