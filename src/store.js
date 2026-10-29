import { mkdir, readdir, unlink, chmod, statfs } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { AppError, distanceKm } from "./validation.js";

export const DAY = 24 * 60 * 60 * 1000;
export const ID_PATTERN = /^[a-f0-9]{24}$/;
export const voterHash = (value) =>
  createHash("sha256").update(value).digest("hex");

export class PollStore {
  constructor(
    directory,
    {
      clock = Date.now,
      maxPolls = 10000,
      maxVotes = 50000,
      diskReserveBytes = 256 * 1024 * 1024,
    } = {},
  ) {
    this.directory = directory;
    this.clock = clock;
    this.maxPolls = maxPolls;
    this.maxVotes = maxVotes;
    this.diskReserveBytes = diskReserveBytes;
    this.index = new Map();
    this.queues = new Map();
  }

  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    // lowdb/steno uses hidden .tmp files. Never retain crash leftovers containing data.
    for (const name of await readdir(this.directory)) {
      if (/^\.[a-f0-9]{24}\.json\.tmp$/.test(name))
        await unlink(join(this.directory, name));
      if (/^[a-f0-9]{24}\.json$/.test(name)) {
        const id = name.slice(0, -5);
        const db = await this.read(id);
        if (
          !db.data ||
          db.data.id !== id ||
          !Number.isFinite(db.data.deleteAt)
        ) {
          throw new Error("Invalid poll file; manual inspection required");
        }
        if (db.data.deleteAt <= this.clock()) await this.remove(id);
        else this.index.set(id, this.summary(db.data));
      }
    }
    await this.sweep();
  }

  summary(p) {
    return {
      id: p.id,
      type: p.type ?? "poll",
      reward: p.reward,
      totalLikes: p.totalLikes ?? 0,
      replyCount: p.replies?.length ?? p.replyCount ?? 0,
      title: p.title,
      signature: p.signature,
      createdAt: p.createdAt,
      endsAt: p.endsAt,
      deleteAt: p.deleteAt,
      totalVotes: p.totalVotes,
      options: (p.options ?? []).map((o) => ({ ...o })),
      location: p.location,
      mapVisible: p.mapVisible === true,
      needsPrune: Object.keys(p.voters ?? {}).length > 0,
    };
  }

  async exclusive(key, fn) {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(fn);
    this.queues.set(key, current);
    try {
      return await current;
    } finally {
      if (this.queues.get(key) === current) this.queues.delete(key);
    }
  }

  async read(id) {
    if (!ID_PATTERN.test(id))
      throw new AppError(
        404,
        "This poll does not exist or has been removed from the website.",
      );
    const db = new Low(new JSONFile(join(this.directory, `${id}.json`)), null);
    await db.read();
    return db;
  }

  async write(db) {
    const disk = await statfs(this.directory);
    if (disk.bavail * disk.bsize < this.diskReserveBytes)
      throw new AppError(
        503,
        "Storage is currently at capacity. Please try again later.",
      );
    await db.write(); // steno writes a temporary file, then atomically renames it.
    await chmod(join(this.directory, `${db.data.id}.json`), 0o600);
    this.index.set(db.data.id, this.summary(db.data));
  }

  async remove(id) {
    await unlink(join(this.directory, `${id}.json`)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
    await unlink(join(this.directory, `.${id}.json.tmp`)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
    this.index.delete(id);
  }

  async live(id) {
    const db = await this.read(id);
    if (!db.data)
      throw new AppError(
        404,
        "This poll does not exist or has been removed from the website.",
      );
    if (db.data.deleteAt <= this.clock()) {
      await this.remove(id);
      throw new AppError(
        404,
        "This poll does not exist or has been removed from the website.",
      );
    }
    return db;
  }

  async create(input) {
    return this.exclusive("create", async () => {
      if ((await this.count()) >= this.maxPolls)
        throw new AppError(
          503,
          "The service is currently at capacity. Please try again later.",
        );
      const now = this.clock();
      const id = randomBytes(12).toString("hex");
      const p = {
        version: 1,
        ...input,
        id,
        createdAt: now,
        endsAt: now + (input.type === "task" ? 30 : 7) * DAY,
        deleteAt: now + 30 * DAY,
        options: input.options.map((label, n) => ({
          id: n + 1,
          label,
          votes: 0,
        })),
        totalVotes: 0,
        voters: {},
        totalLikes: 0,
        likers: {},
        replies: [],
        replyAuthors: {},
      };
      const db = new Low(new JSONFile(join(this.directory, `${id}.json`)), p);
      await this.write(db);
      return this.public(p);
    });
  }

  count() { return this.index.size; }

  public(p, token) {
    const {
      location,
      voters,
      version,
      needsPrune,
      mapVisible,
      mapConsentSource,
      likers,
      replies,
      replyAuthors,
      ...result
    } = p;
    return {
      ...result,
      type: p.type ?? "poll",
      totalLikes: p.totalLikes ?? 0,
      replyCount: p.replies?.length ?? p.replyCount ?? 0,
      status: this.clock() < p.endsAt ? "open" : "closed",
      hasVoted: Boolean(
        token && voters && Object.hasOwn(voters, voterHash(token)),
      ),
      serverTime: this.clock(),
    };
  }

  async get(id, token) {
    return this.exclusive(id, async () =>
      this.public((await this.live(id)).data, token),
    );
  }

  async vote(id, token, optionId) {
    return this.exclusive(id, async () => {
      const db = await this.live(id);
      const p = db.data;
      if (p.type === "task")
        throw new AppError(400, "Tasks do not accept votes.");
      if (this.clock() >= p.endsAt)
        throw new AppError(
          409,
          "Voting has ended. You can still view results and share the QR code.",
        );
      if (Object.hasOwn(p.voters, voterHash(token)))
        throw new AppError(409, "This browser has already voted in this poll.");
      const option = p.options.find((o) => o.id === optionId);
      if (!option) throw new AppError(400, "Please select a valid option.");
      if (p.totalVotes >= this.maxVotes)
        throw new AppError(
          503,
          "This poll has reached its current vote limit.",
        );
      option.votes += 1;
      p.totalVotes += 1;
      p.voters[voterHash(token)] = true;
      await this.write(db);
      return this.public(p, token);
    });
  }

  list({ location, status = "all", cursor, type = "all" } = {}) {
    let before;
    if (cursor) {
      try {
        before = JSON.parse(Buffer.from(cursor, "base64url").toString());
        if (!Number.isFinite(before.createdAt) || !ID_PATTERN.test(before.id))
          throw Error();
      } catch {
        throw new AppError(400, "Invalid page cursor. Please reload the list.");
      }
    }
    const now = this.clock();
    let rows = [...this.index.values()].filter((p) => p.deleteAt > now);
    if (type !== "all") rows = rows.filter((p) => (p.type ?? "poll") === type);
    if (status !== "all")
      rows = rows.filter(
        (p) => (p.endsAt > now ? "open" : "closed") === status,
      );
    if (before)
      rows = rows.filter(
        (p) =>
          p.createdAt < before.createdAt ||
          (p.createdAt === before.createdAt && p.id < before.id),
      );
    if (location)
      rows = rows.filter((p) => distanceKm(location, p.location) <= 100);
    rows.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    const page = rows.slice(0, 20);
    const last = page.at(-1);
    return {
      polls: page.map((p) => this.public(p)),
      nextCursor:
        rows.length > 20
          ? Buffer.from(
              JSON.stringify({ createdAt: last.createdAt, id: last.id }),
            ).toString("base64url")
          : null,
    };
  }

  map({ location, status = "all", type = "all" } = {}) {
    const now = this.clock();
    const rows = [...this.index.values()]
      .filter((p) => p.mapVisible && p.deleteAt > now)
      .filter((p) => type === "all" || (p.type ?? "poll") === type)
      .filter(
        (p) =>
          status === "all" || (p.endsAt > now ? "open" : "closed") === status,
      )
      .filter((p) => !location || distanceKm(location, p.location) <= 100)
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    return {
      serverTime: now,
      total: rows.length,
      // Bound response size; the UI explicitly identifies the newest 1,000 limit.
      polls: rows.slice(0, 1000).map((p) => ({
        id: p.id,
        type: p.type ?? "poll",
        reward: p.reward,
        title: p.title,
        totalVotes: p.totalVotes,
        createdAt: p.createdAt,
        endsAt: p.endsAt,
        deleteAt: p.deleteAt,
        status: p.endsAt > now ? "open" : "closed",
        // One stable grid prevents averaging multiple requests to recover GPS.
        // Rounding is a coarse public position, not an anonymity guarantee.
        position: [
          Number((Math.round(p.location.longitude * 100) / 100).toFixed(2)),
          Number((Math.round(p.location.latitude * 100) / 100).toFixed(2)),
        ],
      })),
    };
  }

  social(p, token) {
    return {
      type: p.type ?? "poll",
      totalLikes: p.totalLikes ?? 0,
      hasLiked: Boolean(
        token && Object.hasOwn(p.likers ?? {}, voterHash(token)),
      ),
      replies: p.type === "task" ? (p.replies ?? []) : [],
      deleteAt: p.deleteAt,
      serverTime: this.clock(),
    };
  }

  async getSocial(id, token) {
    return this.exclusive(id, async () =>
      this.social((await this.live(id)).data, token),
    );
  }

  async like(id, token) {
    return this.exclusive(id, async () => {
      const db = await this.live(id),
        p = db.data;
      p.likers ??= {};
      const hash = voterHash(token);
      if (!Object.hasOwn(p.likers, hash)) {
        if ((p.totalLikes ?? 0) >= this.maxVotes)
          throw new AppError(503, "This post has reached its like limit.");
        p.likers[hash] = true;
        p.totalLikes = (p.totalLikes ?? 0) + 1;
        await this.write(db);
      }
      return this.social(p, token);
    });
  }

  async reply(id, token, input) {
    return this.exclusive(id, async () => {
      const db = await this.live(id),
        p = db.data;
      if (p.type !== "task")
        throw new AppError(400, "Replies are available on tasks only.");
      p.replies ??= [];
      p.replyAuthors ??= {};
      if (p.replies.length >= 200)
        throw new AppError(409, "This task has reached its 200-reply limit.");
      const hash = voterHash(token),
        now = this.clock();
      if (
        Object.hasOwn(p.replyAuthors, hash) &&
        now - p.replyAuthors[hash] < 60000
      )
        throw new AppError(
          429,
          "Please wait a minute before posting another reply to this task.",
        );
      p.replies.push({
        id: randomBytes(12).toString("hex"),
        ...input,
        createdAt: now,
      });
      p.replyAuthors[hash] = now;
      await this.write(db);
      return this.social(p, token);
    });
  }

  async sweep() {
    for (const [id, info] of this.index) {
      if (info.deleteAt <= this.clock())
        await this.exclusive(id, () => this.remove(id));
      else if (info.endsAt <= this.clock() && info.needsPrune)
        await this.exclusive(id, async () => {
          const db = await this.live(id);
          if (Object.keys(db.data.voters).length) {
            db.data.voters = {}; // Deduplication identifiers are no longer needed after voting ends.
            await this.write(db);
          }
        });
    }
  }
}
