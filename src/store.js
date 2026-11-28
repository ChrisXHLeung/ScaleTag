import { mkdir, readdir, unlink, chmod, statfs } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { Algorithm, hash, verify } from "@node-rs/argon2";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import {
  AppError,
  distanceKm,
  TASK_STATES,
  FINAL_TASK_STATES,
  MANAGE_KEY_PATTERN,
  LEGACY_TASK_NO_REPLIES,
  REPLY_CONTACT_REQUIRED,
  encryptedContactInput,
  taskCredentialsInput,
} from "./validation.js";

export const DAY = 24 * 60 * 60 * 1000;
export const ID_PATTERN = /^[a-f0-9]{24}$/;
const ARGON2_OPTIONS = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const ARGON2_VERIFIER = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/;
let activePasswordOperations = 0;
async function passwordOperation(fn) {
  if (activePasswordOperations >= 2)
    throw new AppError(429, "Management is busy. Please try again.");
  activePasswordOperations++;
  try {
    return await fn();
  } finally {
    activePasswordOperations--;
  }
}

export const voterHash = (value) =>
  createHash("sha256").update(value).digest("hex");
const reportHash = (token) => voterHash(`report:${token}`);
const REPORT_FREEZE_THRESHOLD = 6;
const REPORT_REASONS = new Set(["spam", "privacy", "inappropriate", "other"]);
const FROZEN_POST = "This post has been permanently frozen after reports.";
const REVIEWABLE_POST = "This post is hidden after reports.";
const isDiscoverable = (p, now) =>
  p.visibility !== "unlisted" &&
  p.frozenAt == null && p.withdrawnAt == null && p.deleteAt > now &&
  (p.type !== "sale" || (p.giveawayVersion === 1 && (p.saleState ?? "open") === "open" && p.endsAt > now));

export function saleStateOf(post, now) {
  const state = post.saleState ?? "open";
  return state === "open" && Number.isSafeInteger(post.reservedUntil) && post.reservedUntil > now
    ? "reserved" : state;
}

function publicSaleAvailability(post, now) {
  if (post.type !== "sale") return {};
  const saleState = saleStateOf(post, now);
  return {
    saleState,
    ...(saleState === "reserved" ? { reservedUntil: post.reservedUntil } : {}),
    ...(["open", "reserved"].includes(saleState) && post.pickupWindow ? { pickupWindow: post.pickupWindow } : {}),
  };
}

function activePickupRequests(post, now) {
  const pickup = post.replyAuthors?.pickup;
  const selectedId = post.reservedUntil > now ? pickup.selectedId : undefined;
  const requests = pickup.requests.filter(request =>
    request.id === selectedId || (request.id !== pickup.selectedId && validPickupRequestTime(post, request.pickupAt, now)));
  return { pickup, selectedId, requests };
}

function privatePickupManagement(post, now) {
  if (!post.pickupByRequest || post.saleState === "claimed") return {};
  const { pickup, selectedId, requests } = activePickupRequests(post, now);
  return {
    pickupLocation: pickup.location,
    pickupRequests: requests.map(({ id, pickupAt }) => ({ id, pickupAt })),
    selectedPickupRequestId: selectedId ?? null,
  };
}

function validPickupRequestTime(post, pickupAt, now) {
  const window = post.pickupWindow;
  return Number.isSafeInteger(pickupAt) && pickupAt > now && pickupAt < post.endsAt
    && (!window || (pickupAt >= window.startsAt && pickupAt < window.endsAt));
}

function filterPickupRows(rows, now, pickup) {
  let next = Infinity;
  const available = rows.filter(({ post }) => {
    const window = post.pickupWindow;
    if (post.type !== "sale" || post.pickupByRequest || !window) return false;
    const upcoming = pickup === "upcoming";
    const startsAt = Math.max(upcoming ? window.startsAt - DAY : window.startsAt, post.reservedUntil ?? 0);
    const endsAt = Math.min(upcoming ? window.startsAt : window.endsAt, post.endsAt);
    if (startsAt >= endsAt || endsAt <= now) return false;
    const current = startsAt <= now;
    next = Math.min(next, current ? endsAt : startsAt);
    return current;
  });
  return { rows: available, refreshAfterMs: Number.isFinite(next) ? next - now : undefined };
}

function validatePickupWindow(window, createdAt, expiresAt, now) {
  if (window && (window.startsAt < Math.floor(createdAt / 60000) * 60000 ||
      window.endsAt <= now || window.endsAt > expiresAt))
    throw new AppError(400, "Choose a pickup window within the giveaway lifetime that has not ended.");
}

const onMapGrid = ({ latitude, longitude }) => ({
  latitude: Math.round(latitude * 100) / 100 || 0,
  longitude: Math.round(longitude * 100) / 100 || 0,
});
const DISTANCE_BANDS_PER_KM = 10;

function nearbyRows(posts, location, radiusKm, sort) {
  if (!location) return posts.map(post => ({ post, distanceBand: 0 }));
  return posts.flatMap(post => {
    const distance = distanceKm(location, onMapGrid(post.location));
    // Group by 100 m from the coarse grid center, with newest first for ties.
    return distance <= radiusKm
      ? [{ post, distanceBand: sort === "nearest" ? Math.floor(distance * DISTANCE_BANDS_PER_KM) : 0 }]
      : [];
  });
}

function compareNearbyRows(a, b) {
  return a.distanceBand - b.distanceBand ||
    b.post.createdAt - a.post.createdAt || b.post.id.localeCompare(a.post.id);
}

function mapPosition(location) {
  const { latitude, longitude } = onMapGrid(location);
  return [longitude, latitude];
}

const normalizeSearch = (value) => value.normalize("NFKC").toLowerCase();

function searchFilter(query) {
  const terms = normalizeSearch(query).trim().split(/\s+/u).filter(Boolean);
  if (!terms.length) return () => true;
  return (post) => {
    const content = normalizeSearch(`${post.title ?? ""}\n${post.searchDescription ?? post.description ?? ""}`);
    return terms.every(term => content.includes(term));
  };
}

const discoveryType = post => post.taskKind ?? post.type ?? "poll";

// Tasks created before progress states existed have no taskState and are open.
const taskStateOf = (p) =>
  (p.type ?? "poll") === "task" ? (p.taskState ?? "open") : undefined;
// Tasks created before management credentials were introduced have no verifier.
export const hasManageKey = (p) =>
  ["poll", "task", "sale"].includes(p.type ?? "poll") &&
  typeof p.manageKeyHash === "string" &&
  (MANAGE_KEY_PATTERN.test(p.manageKeyHash) || ARGON2_VERIFIER.test(p.manageKeyHash));
// Public reply view: name and message only. Phone and email are never
// included, for new replies or for replies stored before contacts became
// private (including legacy tasks, whose contacts nobody can view any more).
const publicReply = (r) => ({
  id: r.id,
  name: r.name,
  message: r.message,
  createdAt: r.createdAt,
  ...(r.amount ? { amount: r.amount } : {}),
});
// Private reply view, returned only after management-key verification.
const privateReply = (r) => ({
  ...publicReply(r),
  ...(r.encryptedContact ? { encryptedContact: r.encryptedContact } : {}),
  ...(r.phone ? { phone: r.phone } : {}),
  ...(r.email ? { email: r.email } : {}),
});
// Completed/closed tasks count as ended in status filters; retention is unchanged.
export function postStatus(p, now) {
  if (["claimed", "closed"].includes(p.saleState) || FINAL_TASK_STATES.includes(taskStateOf(p))) return "closed";
  return now < p.endsAt ? "open" : "closed";
}
function pollResultsHidden(p, now) {
  return p.resultsVisibility === "after_close" && now < p.endsAt;
}

function savedPostStatus(type, post, now) {
  if (!post || (post.type ?? "poll") !== type ||
      post.deleteAt <= now || post.frozenAt != null || post.withdrawnAt != null ||
      (type === "sale" && (post.giveawayVersion !== 1 || post.saleState === "closed" || post.endsAt <= now)))
    return "unavailable";
  if (type === "poll") return now < post.endsAt ? "poll_open" : "poll_final";
  if (type === "sale") return `sale_${saleStateOf(post, now)}`;
  const state = taskStateOf(post);
  if (post.taskKind === "wanted") {
    return post.taskAssigned && !FINAL_TASK_STATES.includes(state) ? "wanted_in_progress" : `wanted_${state}`;
  }
  if (post.taskKind === "found") {
    return post.taskAssigned && !FINAL_TASK_STATES.includes(state) ? "found_in_progress" : `found_${state}`;
  }
  return post.taskAssigned && !FINAL_TASK_STATES.includes(state) ? "task_assigned" : `task_${state}`;
}

function pollOptionsEditable(p, now) {
  return !p.ballotStarted && p.totalVotes === 0 && now < p.endsAt;
}

const INVALID_MANAGE_LINK = "This management link is invalid for this task.";

export class PollStore {
  constructor(
    directory,
    {
      clock = Date.now,
      maxPolls = 10000,
      maxVotes = 50000,
      diskReserveBytes = 256 * 1024 * 1024,
      reportReviewEnabled = false,
    } = {},
  ) {
    this.directory = directory;
    this.clock = clock;
    this.maxPolls = maxPolls;
    this.maxVotes = maxVotes;
    this.diskReserveBytes = diskReserveBytes;
    if (reportReviewEnabled && typeof this.recordReportReason !== "function")
      throw Error("SCALETAG_REPORT_REVIEW requires STORAGE_BACKEND=sqlite");
    this.reportReviewEnabled = reportReviewEnabled;
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
        if (db.data.deleteAt <= this.clock() || (db.data.type === "sale" && db.data.giveawayVersion !== 1)) await this.remove(id);
        else this.index.set(id, this.summary(db.data));
      }
    }
    await this.sweep();
  }

  summary(p) {
    return {
      id: p.id,
      type: p.type ?? "poll",
      taskKind: p.taskKind,
      reward: p.reward,
      price: p.price,
      saleState: p.saleState,
      reservedUntil: p.reservedUntil,
      pickupWindow: p.pickupWindow,
      pickupByRequest: p.pickupByRequest,
      giveawayVersion: p.giveawayVersion,
      taskState: p.taskState,
      ...(p.type === "task" && p.assignedReplyId ? { taskAssigned: true } : {}),
      frozenAt: p.frozenAt,
      withdrawnAt: p.withdrawnAt,
      ...(p.contactPublicKey ? { contactPublicKey: p.contactPublicKey } : {}),
      totalLikes: p.totalLikes ?? 0,
      replyCount: p.replies?.length ?? p.replyCount ?? 0,
      title: p.title,
      searchDescription: p.description,
      visibility: p.visibility,
      signature: p.signature,
      createdAt: p.createdAt,
      endsAt: p.endsAt,
      deleteAt: p.deleteAt,
      resultsVisibility: p.resultsVisibility,
      selectionMode: p.selectionMode,
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

  async live(id, { allowWithdrawn = false, expectedType } = {}) {
    const db = await this.read(id);
    if (!db.data)
      throw new AppError(
        404,
        "This poll does not exist or has been removed from the website.",
      );
    if (expectedType && (db.data.type ?? "poll") !== expectedType)
      throw new AppError(404, "This post is unavailable.");
    if (db.data.type === "sale" && (db.data.giveawayVersion !== 1 || db.data.saleState === "closed" || db.data.endsAt <= this.clock()))
      throw new AppError(404, "This giveaway is no longer available.");
    if (db.data.deleteAt <= this.clock()) {
      if (db.data.type !== "sale") await this.remove(id);
      throw new AppError(
        404,
        "This poll does not exist or has been removed from the website.",
      );
    }
    if (db.data.frozenAt != null)
      throw new AppError(404, this.reportReviewEnabled ? REVIEWABLE_POST : FROZEN_POST);
    if (db.data.withdrawnAt != null && !allowWithdrawn)
      throw new AppError(404, "This poll has been taken down.");
    return db;
  }

  async create(input) {
    const type = input.type ?? "poll";
    const manageKey = type === "task" ? undefined : randomBytes(32).toString("hex");
    const secret = type === "task" ? input.authKey : manageKey;
    const manageKeyHash = await passwordOperation(() =>
      hash(secret, { ...ARGON2_OPTIONS, salt: randomBytes(16) }));
    return this.exclusive("create", async () => {
      if (this.storedCount() >= this.maxPolls)
        throw new AppError(
          503,
          "The service is currently at capacity. Please try again later.",
        );
      const now = this.clock();
      const id = randomBytes(12).toString("hex");
      const { authKey, votingHours = 168, ...postInput } = input;
      const lifetime = type === "sale" ? 3 * DAY :
        type === "task" ? 30 * DAY : votingHours * 3600000;
      if (type === "sale") validatePickupWindow(input.pickupWindow, now, now + lifetime, now);
      const p = {
        version: 1,
        ...postInput,
        type,
        id,
        createdAt: now,
        endsAt: now + lifetime,
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
        manageKeyHash,
      };
      // Only the verifier is persisted. Poll and giveaway creation return the password once.
      if (type === "sale") p.saleState = "open";
      if (type === "sale" && p.pickupByRequest) {
        // Legacy readers and index projections already exclude replyAuthors.
        p.replyAuthors.pickup = { location: input.pickupLocation, requests: [] };
        delete p.pickupLocation;
      }
      if (type === "task") {
        p.taskState = "open";
        p.contactPublicKey = input.contactPublicKey;
        p.encryptedPrivateKey = input.encryptedPrivateKey;
      }
      const db = new Low(new JSONFile(join(this.directory, `${id}.json`)), p);
      await this.write(db);
      return manageKey
        ? { ...this.public(p), ...privatePickupManagement(p, now), manageKey }
        : this.public(p);
    });
  }

  count() {
    const now = this.clock();
    return [...this.index.values()].filter((p) => isDiscoverable(p, now)).length;
  }

  storedCount() {
    return this.index.size;
  }

  createdCounts(after, now) {
    const counts = { polls: 0, tasks: 0, giveaways: 0 };
    for (const post of this.index.values()) {
      if (post.createdAt <= after || post.createdAt > now) continue;
      if (post.type === "poll") counts.polls++;
      if (post.type === "task") counts.tasks++;
      if (post.type === "sale" && post.giveawayVersion === 1) counts.giveaways++;
    }
    return counts;
  }

  public(p, token) {
    const {
      location,
      voters,
      ballotStarted,
      version,
      needsPrune,
      searchDescription,
      mapVisible,
      mapConsentSource,
      likers,
      replies,
      replyAuthors,
      reportHashes,
      frozenAt,
      withdrawnAt,
      manageKeyHash,
      manageKey,
      authKey,
      encryptedPrivateKey,
      taskState,
      assignedReplyId,
      pickupLocation,
      pickupWindow,
      reservedUntil,
      totalVotes,
      options,
      ...result
    } = p;
    const now = this.clock();
    const resultsHidden = pollResultsHidden(p, now);
    const ownVote = token && voters?.[voterHash(token)];
    return {
      ...result,
      type: p.type ?? "poll",
      ...publicSaleAvailability(p, now),
      ...(p.resultsVisibility === "after_close" ? { resultsHidden } : {}),
      ...(resultsHidden ? {} : { totalVotes }),
      options: resultsHidden ? options.map(({ id, label }) => ({ id, label })) : options,
      ...(pickupLocation !== undefined && !p.pickupByRequest && p.saleState !== "claimed" ? { pickupLocation } : {}),
      ...(taskStateOf(p) ? { taskState: taskStateOf(p) } : {}),
      ...(p.type === "task" && assignedReplyId ? { taskAssigned: true } : {}),
      totalLikes: p.totalLikes ?? 0,
      replyCount: p.replies?.length ?? p.replyCount ?? 0,
      status: postStatus(p, now),
      hasVoted: Boolean(ownVote),
      ...(now < p.endsAt && Array.isArray(ownVote) ? { yourOptionIds: ownVote } : {}),
      serverTime: now,
    };
  }

  async get(id, token, options) {
    return this.exclusive(id, async () =>
      this.public((await this.live(id, options)).data, token),
    );
  }

  savedStatusRows(ids) {
    return ids.map(id => this.index.get(id)).filter(Boolean);
  }

  savedStatuses(references) {
    const ids = [...new Set(references.map(({ id }) => id))];
    const byId = new Map(this.savedStatusRows(ids).map(post => [post.id, post]));
    const now = this.clock();
    let nextChange = Infinity;
    const statuses = references.map(({ type, id }) => {
      const post = byId.get(id);
      const status = savedPostStatus(type, post, now);
      if (status !== "unavailable") {
        const expiration = type === "sale" ? post.endsAt : post.deleteAt;
        nextChange = Math.min(nextChange, expiration);
        if (status === "sale_reserved") nextChange = Math.min(nextChange, post.reservedUntil);
        if (status === "poll_open") nextChange = Math.min(nextChange, post.endsAt);
      }
      return status;
    });
    return { statuses, refreshAfterMs: Number.isFinite(nextChange) ? nextChange - now : null };
  }

  async vote(id, token, selection, changing = false) {
    return this.exclusive(id, async () => {
      const db = await this.live(id);
      const p = db.data;
      if (["task", "sale"].includes(p.type))
        throw new AppError(400, "This post does not accept votes.");
      if (this.clock() >= p.endsAt)
        throw new AppError(
          409,
          "Voting has ended. You can still view results and share the QR code.",
        );
      const hash = voterHash(token);
      const previous = p.voters[hash];
      if (changing && (!p.allowBallotChanges || !Array.isArray(previous)))
        throw new AppError(409, "There is no editable ballot for this browser.");
      if (!changing && previous)
        throw new AppError(409, "This browser has already voted in this poll.");
      const withdrawing = changing && selection === null;
      const multiple = p.selectionMode === "multiple";
      const selectedIds = withdrawing ? [] : Array.isArray(selection) ? selection : [selection];
      if (!withdrawing && multiple && (!Array.isArray(selection) || selectedIds.length < 1 ||
          selectedIds.length > p.options.length || new Set(selectedIds).size !== selectedIds.length))
        throw new AppError(400, "Please select one or more different options.");
      if (!withdrawing && !multiple && !Number.isInteger(selection))
        throw new AppError(400, "Please select exactly one option.");
      const selected = p.options.filter(option => selectedIds.includes(option.id));
      if (selected.length !== selectedIds.length)
        throw new AppError(400, multiple ? "Please select one or more different options." : "Please select a valid option.");
      if (!changing && p.totalVotes >= this.maxVotes)
        throw new AppError(
          503,
          "This poll has reached its current vote limit.",
        );
      if (changing) {
        for (const option of p.options) if (previous.includes(option.id)) option.votes -= 1;
      }
      if (withdrawing) {
        delete p.voters[hash];
        p.totalVotes -= 1;
      } else {
        for (const option of selected) option.votes += 1;
        if (!changing) p.totalVotes += 1;
        p.voters[hash] = p.allowBallotChanges ? selected.map(option => option.id) : true;
        if (p.allowBallotChanges) p.ballotStarted = true;
      }
      await this.write(db);
      return this.public(p, token);
    });
  }

  list({ location, radiusKm = 100, sort = "newest", status = "all", cursor, type = "all", query = "", pickup } = {}) {
    let before;
    if (cursor) {
      try {
        before = JSON.parse(Buffer.from(cursor, "base64url").toString());
        if (
          !Number.isFinite(before.createdAt) || !ID_PATTERN.test(before.id) ||
          (sort === "nearest" && (
            !Number.isInteger(before.distanceBand) || before.distanceBand < 0 ||
            before.distanceBand > radiusKm * DISTANCE_BANDS_PER_KM
          ))
        )
          throw Error();
      } catch {
        throw new AppError(400, "Invalid page cursor. Please reload the list.");
      }
    }
    const now = this.clock();
    let rows = [...this.index.values()].filter((p) => isDiscoverable(p, now));
    if (type !== "all") rows = rows.filter((p) => discoveryType(p) === type);
    if (status !== "all")
      rows = rows.filter((p) => postStatus(p, now) === status);
    rows = rows.filter(searchFilter(query));
    let ordered = nearbyRows(rows, location, radiusKm, sort);
    let refreshAfterMs;
    if (pickup) ({ rows: ordered, refreshAfterMs } = filterPickupRows(ordered, now, pickup));
    if (before) {
      const boundary = { post: before, distanceBand: sort === "nearest" ? before.distanceBand : 0 };
      ordered = ordered.filter(row => compareNearbyRows(row, boundary) > 0);
    }
    ordered.sort(compareNearbyRows);
    const page = ordered.slice(0, 20);
    const last = page.at(-1);
    return {
      polls: page.map(({ post }) => this.public(post)),
      ...(refreshAfterMs === undefined ? {} : { refreshAfterMs }),
      nextCursor:
        ordered.length > 20
          ? Buffer.from(
              JSON.stringify({
                createdAt: last.post.createdAt,
                id: last.post.id,
                ...(sort === "nearest" ? { distanceBand: last.distanceBand } : {}),
              }),
            ).toString("base64url")
          : null,
    };
  }

  map({ location, radiusKm = 100, sort = "newest", status = "all", type = "all", query = "", pickup } = {}) {
    const now = this.clock();
    const posts = [...this.index.values()]
      .filter((p) => p.mapVisible && isDiscoverable(p, now))
      .filter((p) => type === "all" || discoveryType(p) === type)
      .filter((p) => status === "all" || postStatus(p, now) === status)
      .filter(searchFilter(query));
    let rows = nearbyRows(posts, location, radiusKm, sort);
    let refreshAfterMs;
    if (pickup) ({ rows, refreshAfterMs } = filterPickupRows(rows, now, pickup));
    rows.sort(compareNearbyRows);
    return {
      serverTime: now,
      ...(refreshAfterMs === undefined ? {} : { refreshAfterMs }),
      total: rows.length,
      // Bound response size; the UI identifies the 1,000 result limit.
      polls: rows.slice(0, 1000).map(({ post: p }) => ({
        id: p.id,
        type: p.type ?? "poll",
        reward: p.reward,
        taskKind: p.taskKind,
        price: p.price,
        ...publicSaleAvailability(p, now),
        ...(taskStateOf(p) ? { taskState: taskStateOf(p) } : {}),
        title: p.title,
        ...(p.selectionMode === "multiple" ? { selectionMode: p.selectionMode } : {}),
        ...(p.pickupByRequest ? { pickupByRequest: true } : {}),
        ...(pollResultsHidden(p, now) ? { resultsHidden: true } : { totalVotes: p.totalVotes }),
        createdAt: p.createdAt,
        endsAt: p.endsAt,
        deleteAt: p.deleteAt,
        status: postStatus(p, now),
        // One stable grid prevents averaging multiple requests to recover GPS.
        // Rounding is a coarse public position, not an anonymity guarantee.
        position: mapPosition(p.location),
      })),
    };
  }

  social(p, token) {
    const task = ["task", "sale"].includes(p.type);
    return {
      type: p.type ?? "poll",
      totalLikes: p.totalLikes ?? 0,
      hasLiked: Boolean(
        token && Object.hasOwn(p.likers ?? {}, voterHash(token)),
      ),
      ...(p.visibility === "unlisted" ? { visibility: p.visibility } : {}),
      hasReported: Boolean(token && p.reportHashes?.includes(reportHash(token))),
      ...(this.reportReviewEnabled ? { reportReviewEnabled: true } : {}),
      // Unauthenticated: never includes phone or email.
      replies: task && p.taskKind !== "found" ? (p.replies ?? []).map(publicReply) : [],
      ...(p.taskKind === "found" ? { claimCount: p.replies?.length ?? 0 } : {}),
      ...(task ? { acceptsPrivateContacts: hasManageKey(p) && (p.type !== "task" || Boolean(p.contactPublicKey && p.encryptedPrivateKey)) } : {}),
      ...publicSaleAvailability(p, this.clock()),
      ...(taskStateOf(p) ? { taskState: taskStateOf(p) } : {}),
      ...(p.type === "task" && p.assignedReplyId ? { taskAssigned: true } : {}),
      deleteAt: p.type === "sale" ? p.endsAt : p.deleteAt,
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

  async report(id, token, reason = "other") {
    if (this.reportReviewEnabled && !REPORT_REASONS.has(reason))
      throw new AppError(400, "Choose a valid report reason.");
    return this.exclusive(id, async () => {
      const db = await this.live(id);
      const p = db.data;
      const hash = reportHash(token);
      p.reportHashes ??= [];
      if (p.reportHashes.includes(hash)) return { hasReported: true, frozen: false };
      p.reportHashes.push(hash);
      const frozen = p.reportHashes.length >= REPORT_FREEZE_THRESHOLD;
      if (frozen) p.frozenAt = this.clock();
      await this.write(db);
      if (this.reportReviewEnabled) this.recordReportReason(id, reason);
      return { hasReported: true, frozen };
    });
  }

  async reply(id, token, input) {
    return this.exclusive(id, async () => {
      const db = await this.live(id),
        p = db.data;
      if (!["task", "sale"].includes(p.type))
        throw new AppError(400, "Replies are available on tasks and sales only.");
      if ((p.taskKind === "found") !== (input.privateClaim === true))
        throw new AppError(400, "Use the reply or claim form for this post.");
      // Check final task states first: postStatus also reports them as closed.
      if (FINAL_TASK_STATES.includes(taskStateOf(p)))
        throw new AppError(
          409,
          `This task is ${taskStateOf(p)} and no longer accepts replies.`,
        );
      if (postStatus(p, this.clock()) === "closed")
        throw new AppError(409, "This post is closed and no longer accepts replies.");
      if (!hasManageKey(p))
        throw new AppError(409, LEGACY_TASK_NO_REPLIES);
      if (p.type === "task" && p.assignedReplyId)
        throw new AppError(409, "This task already has someone assigned.");
      if (p.type === "task" && (!p.contactPublicKey || !p.encryptedPrivateKey))
        throw new AppError(409, LEGACY_TASK_NO_REPLIES);
      const hasContact = p.type === "task" ? Boolean(input.encryptedContact) : Boolean(input.phone || input.email);
      if (!hasContact)
        throw new AppError(400, REPLY_CONTACT_REQUIRED);
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
      const reply = {
        id: randomBytes(12).toString("hex"),
        ...(input.privateClaim ? {} : { name: input.name ?? "Anonymous", message: input.message }),
        ...(p.type === "sale" ? { amount: input.amount } : {}),
        ...(p.type === "task" ? { encryptedContact: input.encryptedContact } : {
          ...(input.phone ? { phone: input.phone } : {}),
          ...(input.email ? { email: input.email } : {}),
        }),
        createdAt: now,
      };
      p.replies.push(reply);
      p.replyAuthors[hash] = now;
      await this.write(db);
      return { ...this.social(p, token), ...(input.privateClaim ? {} : { createdReplyId: reply.id }) };
    });
  }

  async withManagedPost(id, key, type, fn, { prepare, allowWithdrawn = false } = {}) {
    if (typeof key !== "string" || !MANAGE_KEY_PATTERN.test(key))
      throw new AppError(403, INVALID_MANAGE_LINK);
    const snapshot = (await this.read(id)).data;
    if (!snapshot || (snapshot.type ?? "poll") !== type || snapshot.deleteAt <= this.clock() ||
        (type === "sale" && (snapshot.giveawayVersion !== 1 ||
         snapshot.saleState === "closed" || snapshot.endsAt <= this.clock())))
      throw new AppError(404, "Post not found.");
    if (snapshot.frozenAt != null)
      throw new AppError(404, this.reportReviewEnabled ? REVIEWABLE_POST : FROZEN_POST);
    if (snapshot.withdrawnAt != null && !allowWithdrawn)
      throw new AppError(404, "This poll has been taken down.");
    const verifier = snapshot.manageKeyHash;
    if (!hasManageKey(snapshot)) throw new AppError(403, INVALID_MANAGE_LINK);
    // Verify outside the SQLite writer transaction; recheck the live record
    // under the write lock before returning contacts or changing state.
    const valid = ARGON2_VERIFIER.test(verifier)
      ? await passwordOperation(() => verify(verifier, key))
      : timingSafeEqual(Buffer.from(voterHash(key), "hex"), Buffer.from(verifier, "hex"));
    if (!valid) throw new AppError(403, INVALID_MANAGE_LINK);
    // Media processing runs only after authentication and without a database lock.
    const prepared = await prepare?.();
    return this.exclusive(id, async () => {
      const db = await this.live(id, { allowWithdrawn });
      if ((db.data.type ?? "poll") !== type || db.data.manageKeyHash !== verifier)
        throw new AppError(403, INVALID_MANAGE_LINK);
      return fn(db, prepared);
    });
  }

  async managePoll(id, key) {
    return this.withManagedPost(id, key, "poll", ({ data: p }) => ({
      ...this.public(p),
      canEditOptions: pollOptionsEditable(p, this.clock()),
    }));
  }

  async setPollState(id, key, state, decision) {
    if (!["closed", "withdrawn", "confirmed"].includes(state))
      throw new AppError(400, "Choose a valid poll status.");
    return this.withManagedPost(id, key, "poll", async (db) => {
      const p = db.data;
      const now = this.clock();
      if (state === "withdrawn") {
        if (p.withdrawnAt == null) {
          p.withdrawnAt = now;
          await this.write(db);
        }
        return { withdrawn: true };
      }
      let changed = false;
      if (state === "confirmed") {
        const { optionId, startsAt, endsAt } = decision ?? {};
        if (!p.options.some(option => option.id === optionId))
          throw new AppError(400, "Please select exactly one option.");
        const scheduled = startsAt !== undefined || endsAt !== undefined;
        if (scheduled && (!Number.isSafeInteger(startsAt) || !Number.isSafeInteger(endsAt) ||
            startsAt % 60000 !== 0 || endsAt % 60000 !== 0 || startsAt >= endsAt ||
            startsAt < 0 || endsAt >= Date.UTC(10000, 0, 1)))
          throw new AppError(400, "Choose an event start and end time in order.");
        const previous = p.decision;
        if (!previous || previous.optionId !== optionId || previous.startsAt !== startsAt || previous.endsAt !== endsAt) {
          p.decision = {
            optionId, ...(scheduled ? { startsAt, endsAt } : {}),
            updatedAt: now, revision: (previous?.revision ?? -1) + 1,
          };
          changed = true;
        }
      }
      if (now < p.endsAt) {
        p.endsAt = now;
        p.voters = {};
        changed = true;
      }
      if (changed) await this.write(db);
      return { ...this.public(p), canEditOptions: false };
    }, { allowWithdrawn: state === "withdrawn" });
  }

  async editManagedPost(id, key, type, changes, prepareImages) {
    const { options, images, privatePickupLocation, ...copy } = changes;
    return this.withManagedPost(id, key, type, async (db, preparedImages) => {
      const post = db.data;
      const now = this.clock();
      if (type === "sale" && post.saleState === "claimed")
        throw new AppError(409, "This giveaway has already been claimed.");
      if (post.taskKind === "wanted" && Object.hasOwn(copy, "reward"))
        throw new AppError(400, "Item requests are for free items only.");
      if (post.taskKind === "found" && (images?.length || Object.hasOwn(copy, "reward")))
        throw new AppError(400, "Found notices cannot include photos or a reward.");
      if (type === "sale") validatePickupWindow(copy.pickupWindow, post.createdAt, post.endsAt, now);
      const questionChanged = type === "poll" && copy.title !== undefined && copy.title !== post.title;
      const optionsChanged = options && (options.length !== post.options.length ||
        options.some((label, index) => label !== post.options[index].label));
      const ballotChanged = questionChanged || optionsChanged;
      if (ballotChanged && !pollOptionsEditable(post, now))
        throw new AppError(409, "The poll question and options can change only before the first vote and before voting closes.");
      if (privatePickupLocation !== undefined && !post.pickupByRequest)
        throw new AppError(400, "Choose a valid pickup method.");
      if (post.pickupByRequest && copy.pickupLocation !== undefined)
        throw new AppError(400, "Choose a valid pickup method.");
      if (privatePickupLocation !== undefined) post.replyAuthors.pickup.location = privatePickupLocation;
      Object.assign(post, copy);
      if (preparedImages) post.images = preparedImages;
      if (ballotChanged) {
        // A ballot loaded before a rewrite can never cast a vote for a new option.
        const lastId = Math.max(0, ...post.options.map(option => option.id));
        const labels = options ?? post.options.map(option => option.label);
        post.options = labels.map((label, i) => ({ id: lastId + i + 1, label, votes: 0 }));
      }
      await this.write(db);
      return {
        ...this.public(post),
        ...privatePickupManagement(post, now),
        ...(type === "poll" ? { canEditOptions: pollOptionsEditable(post, now) } : {}),
      };
    }, { prepare: images === undefined ? undefined : () => prepareImages(images) });
  }

  // Authenticated view: the only response that includes reply phone/email.
  async manageTask(id, key) {
    return this.withManagedPost(id, key, "task", ({ data: p }) => {
      return {
        ...this.public(p),
        assignedReplyId: p.assignedReplyId ?? null,
        encryptedPrivateKey: p.encryptedPrivateKey,
        replies: (p.replies ?? []).map(privateReply),
      };
    });
  }

  async setTaskState(id, key, state) {
    return this.withManagedPost(id, key, "task", async (db) => {
      const p = db.data;
      if (!TASK_STATES.includes(state))
        throw new AppError(400, "Choose a valid task status.");
      const current = taskStateOf(p);
      if (current === state) return this.public(p);
      if (p.assignedReplyId && state === "open")
        throw new AppError(409, "Reopen applications from task management.");
      if (FINAL_TASK_STATES.includes(current))
        throw new AppError(
          409,
          `This task is already ${current}. Its status can no longer change.`,
        );
      // Only progress fields change: createdAt, endsAt and deleteAt (the
      // 30-day retention deadline) are deliberately left untouched.
      p.taskState = state;
      p.stateChangedAt = this.clock();
      await this.write(db);
      return this.public(p);
    });
  }

  async setTaskAssignment(id, key, replyId) {
    return this.withManagedPost(id, key, "task", async (db) => {
      const post = db.data;
      if (FINAL_TASK_STATES.includes(taskStateOf(post)))
        throw new AppError(409, "This task can no longer change its assignment.");
      const previous = post.assignedReplyId ?? null;
      if (previous !== replyId) {
        if (previous && replyId)
          throw new AppError(409, "Reopen applications before selecting another reply.");
        if (replyId && !(post.replies ?? []).some(reply => reply.id === replyId))
          throw new AppError(404, "Task reply not found.");
        if (replyId) post.assignedReplyId = replyId;
        else delete post.assignedReplyId;
        post.taskState = replyId ? "in_progress" : "open";
        post.stateChangedAt = this.clock();
        await this.write(db);
      }
      return { ...this.public(post), assignedReplyId: replyId };
    });
  }

  async manageSale(id, key) {
    return this.withManagedPost(id, key, "sale", ({ data: p }) => {
      return { ...this.public(p), ...privatePickupManagement(p, this.clock()), replies: (p.replies ?? []).map(privateReply) };
    });
  }

  async pickupRequest(id, token, action, pickupAt) {
    if (!["status", "request", "cancel"].includes(action))
      throw new AppError(400, "Choose a valid pickup action.");
    return this.exclusive(id, async () => {
      const db = await this.live(id, { expectedType: "sale" });
      const post = db.data;
      if (!post.pickupByRequest) throw new AppError(404, "This giveaway does not accept pickup requests.");
      if (post.saleState === "claimed") return { state: "unavailable" };
      const now = this.clock();
      const { pickup, selectedId, requests } = activePickupRequests(post, now);
      const applicant = voterHash(token);
      let request = requests.find(item => item.applicant === applicant);
      if (action === "request" && !request) {
        if (!validPickupRequestTime(post, pickupAt, now))
          throw new AppError(400, "Choose a future time within the pickup hours and giveaway lifetime.");
        if (requests.length >= 30) throw new AppError(409, "This giveaway has reached its pickup request limit.");
        request = { id: randomBytes(12).toString("hex"), applicant, pickupAt };
        pickup.requests = [...requests, request];
        await this.write(db);
      } else if (action === "cancel" && request) {
        pickup.requests = requests.filter(item => item !== request);
        if (request.id === selectedId) {
          delete pickup.selectedId;
          delete post.reservedUntil;
        }
        await this.write(db);
        return { state: "none" };
      }
      if (!request) return { state: "none" };
      return {
        requestId: request.id,
        pickupAt: request.pickupAt,
        ...(request.id === selectedId
          ? { state: "accepted", pickupLocation: pickup.location, reservedUntil: post.reservedUntil, serverTime: now }
          : { state: "pending" }),
      };
    });
  }

  async closeSale(id, key) {
    return this.setSaleState(id, key, "closed");
  }

  async setSaleState(id, key, state, reservedUntil, requestId) {
    if (!["claimed", "closed", "reserved", "open"].includes(state))
      throw new AppError(400, "Choose a valid giveaway status.");
    return this.withManagedPost(id, key, "sale", async (db) => {
      const post = db.data;
      if (state === "claimed" && post.saleState === "claimed") return this.public(post);
      if (post.saleState === "claimed")
        throw new AppError(409, "This giveaway has already been claimed.");
      const now = this.clock();
      if (post.pickupByRequest) {
        const { pickup, selectedId, requests } = activePickupRequests(post, now);
        if (state === "reserved") {
          if (selectedId && selectedId !== requestId)
            throw new AppError(409, "Release the current pickup hold before selecting another request.");
          if (selectedId && selectedId === requestId)
            return { ...this.public(post), ...privatePickupManagement(post, now) };
          const selected = requests.find(request => request.id === requestId);
          if (!selected || !validPickupRequestTime(post, selected.pickupAt, now))
            throw new AppError(409, "That pickup request is no longer available.");
          pickup.requests = requests;
          pickup.selectedId = selected.id;
          post.reservedUntil = Math.min(post.endsAt, selected.pickupAt + 3600000);
        } else {
          pickup.requests = state === "open" ? requests.filter(request => request.id !== selectedId) : [];
          delete pickup.selectedId;
          delete post.reservedUntil;
          post.saleState = state;
        }
        await this.write(db);
        return { ...this.public(post), ...privatePickupManagement(post, now) };
      }
      if (state === "reserved") {
        if (!Number.isSafeInteger(reservedUntil) || reservedUntil <= this.clock() || reservedUntil > post.endsAt)
          throw new AppError(400, "Choose a future hold time within the giveaway lifetime.");
        if (post.reservedUntil === reservedUntil) return this.public(post);
        post.reservedUntil = reservedUntil;
      } else {
        if (state === "open" && post.reservedUntil === undefined) return this.public(post);
        delete post.reservedUntil;
        post.saleState = state;
      }
      await this.write(db);
      return this.public(post);
    });
  }

  async sweep() {
    for (const [id, info] of this.index) {
      if (info.deleteAt <= this.clock() || (info.type === "sale" && info.giveawayVersion !== 1))
        await this.exclusive(id, () => this.remove(id));
      else if (info.endsAt <= this.clock() && info.needsPrune)
        await this.exclusive(id, async () => {
          const db = await this.read(id);
          if (Object.keys(db.data?.voters ?? {}).length) {
            db.data.voters = {}; // Deduplication identifiers are no longer needed after voting ends.
            await this.write(db);
          }
        });
    }
  }
}
