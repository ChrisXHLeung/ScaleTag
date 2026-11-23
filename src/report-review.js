import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./database.js";
import { ID_PATTERN } from "./store.js";

const reviewable = `delete_at > ?
  AND json_extract(document,'$.frozenAt') IS NOT NULL
  AND json_extract(document,'$.withdrawnAt') IS NULL
  AND (coalesce(json_extract(document,'$.type'),'poll') <> 'sale'
       OR (ends_at > ? AND coalesce(json_extract(document,'$.saleState'),'open') <> 'closed'))`;
const STORED_PHOTO = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

function reasonCounts(db, id) {
  const rows = db.prepare("SELECT reason, count FROM post_report_reasons WHERE post_id=?").all(id);
  return Object.fromEntries(rows.map(({ reason, count }) => [reason, count]));
}

export function listFrozenReports(db, now = Date.now()) {
  const rows = db.prepare(`SELECT id, coalesce(json_extract(document,'$.type'),'poll') AS type,
    json_extract(document,'$.title') AS title, json_extract(document,'$.frozenAt') AS frozenAt,
    coalesce(json_array_length(document,'$.reportHashes'),0) AS reports
    FROM posts WHERE ${reviewable} ORDER BY frozenAt DESC, id LIMIT 100`).all(now, now);
  return rows.map(row => ({ ...row, reasons: reasonCounts(db, row.id) }));
}

function readFrozenPost(db, id, now) {
  if (!ID_PATTERN.test(id)) return undefined;
  const row = db.prepare(`SELECT document FROM posts WHERE id=? AND ${reviewable}`).get(id, now, now);
  return row && JSON.parse(row.document);
}

export function showFrozenReport(db, id, now = Date.now()) {
  const post = readFrozenPost(db, id, now);
  if (!post) return undefined;
  return {
    id, type: post.type ?? "poll", title: post.title, description: post.description,
    signature: post.signature, optionLabels: (post.options ?? []).map(option => option.label),
    reward: post.reward,
    ...(post.saleState !== "claimed" ? { pickupLocation: post.pickupLocation } : {}),
    photos: (post.images ?? []).map((image, index) => {
      const format = STORED_PHOTO.exec(image)?.[1];
      return format ? { number: index + 1, format } : { number: index + 1, externalLink: image };
    }),
    frozenAt: post.frozenAt, reports: post.reportHashes?.length ?? 0,
    reasons: reasonCounts(db, id),
  };
}

export function readFrozenPhoto(db, id, number, now = Date.now()) {
  if (!Number.isSafeInteger(number) || number < 1) return undefined;
  const image = readFrozenPost(db, id, now)?.images?.[number - 1];
  const match = STORED_PHOTO.exec(image);
  if (match) return Buffer.from(match[2], "base64");
}

export function restoreFrozenReport(db, id, now = Date.now()) {
  if (!ID_PATTERN.test(id)) return false;
  return db.transaction(() => {
    const { changes } = db.prepare(`UPDATE posts SET document=json_remove(document,'$.frozenAt','$.reportHashes')
      WHERE id=? AND ${reviewable}`).run(id, now, now);
    if (changes) db.prepare("DELETE FROM post_report_reasons WHERE post_id=?").run(id);
    return changes === 1;
  }).immediate();
}

function run() {
  if (process.env.SCALETAG_REPORT_REVIEW !== "1")
    throw Error("Report review is disabled. Set SCALETAG_REPORT_REVIEW=1 in the deployment configuration to enable it.");
  const [command, id, number, ...extra] = process.argv.slice(2);
  const valid = command === "list" ? id === undefined : ID_PATTERN.test(id) &&
    (command === "photo" ? /^[1-9][0-9]?$/.test(number) : ["show", "restore"].includes(command) && number === undefined);
  if (extra.length || !valid)
    throw Error("Usage: node src/report-review.js list | show POST_ID | photo POST_ID NUMBER | restore POST_ID");
  const filename = join(resolve(process.env.DATA_DIR ?? "./data"), "scaletag.sqlite");
  const db = openDatabase(filename, { fileMustExist: true, readonly: command !== "restore" });
  try {
    db.pragma("busy_timeout=3000");
    if (command === "photo") {
      const bytes = readFrozenPhoto(db, id, Number(number));
      if (!bytes) throw Error("No stored photo matches that post and number.");
      process.stdout.write(bytes);
      return;
    }
    const result = command === "list" ? listFrozenReports(db) : command === "show"
      ? showFrozenReport(db, id) : restoreFrozenReport(db, id);
    if (!result) throw Error("No active frozen post matches that ID.");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
