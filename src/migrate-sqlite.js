import { readdir, readFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { SQLiteStore } from "./sqlite-store.js";
import { ID_PATTERN } from "./store.js";

// The caller MUST hold the legacy .writer.lock with flock after stopping the
// old service. Import is atomic, one-time and never overwrites existing rows.
process.umask(0o077);
const directory = resolve(process.env.DATA_DIR ?? "./data");
const store = new SQLiteStore(directory);
try {
  await store.init({ allowImport: true });
  const documents = [], sources = [];
  for (const name of await readdir(directory)) {
    if (!/^[a-f0-9]{24}\.json$/.test(name)) continue;
    sources.push(join(directory, name));
    const p = JSON.parse(await readFile(join(directory, name), "utf8"));
    if (!ID_PATTERN.test(p.id) || name !== `${p.id}.json` ||
        ![p.createdAt, p.endsAt, p.deleteAt].every(Number.isFinite) ||
        !Array.isArray(p.options) || !p.location || !p.voters)
      throw Error("Invalid legacy document; import aborted.");
    if (p.deleteAt > Date.now()) documents.push(p);
  }
  await store.exclusive("import", () => {
    if (store.db.prepare("SELECT 1 FROM metadata WHERE key='json-import'").get()) {
      console.log("JSON import already completed; no changes.");
      return;
    }
    if (store.db.prepare("SELECT 1 FROM posts LIMIT 1").get())
      throw Error("SQLite is not empty; refusing to merge legacy data.");
    for (const data of documents) store.write({ data });
    store.db.prepare("INSERT INTO metadata VALUES('json-import','complete')").run();
    console.log(`Imported ${documents.length} live posts; original JSON files preserved.`);
  });
  // Use only after creating a verified private 90-day archive. Removing stale
  // source files prevents an ignored second copy outliving public retention.
  if (process.argv.includes("--remove-source")) {
    for (const path of sources) await unlink(path);
    console.log("Removed legacy JSON source files after successful import.");
  }
} finally { store.close(); }
