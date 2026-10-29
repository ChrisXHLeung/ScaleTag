import { resolve } from "node:path";
import { PollStore } from "./store.js";
import { createApp } from "./app.js";

process.umask(0o077);
function positive(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw Error(`Invalid ${name}`);
  return value;
}
const port = positive("PORT", 3000);
const host = process.env.HOST ?? "127.0.0.1";
if (!["127.0.0.1", "0.0.0.0"].includes(host))
  throw Error("HOST must be 127.0.0.1 or 0.0.0.0");
const origin = process.env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`;
if (process.env.NODE_ENV === "production" && !origin.startsWith("https://"))
  throw Error("Production requires an HTTPS PUBLIC_ORIGIN");
const Store = process.env.STORAGE_BACKEND === "sqlite"
  ? (await import("./sqlite-store.js")).SQLiteStore : PollStore;
if (process.env.STORAGE_BACKEND && !["json", "sqlite"].includes(process.env.STORAGE_BACKEND))
  throw Error("STORAGE_BACKEND must be json or sqlite");
const store = new Store(resolve(process.env.DATA_DIR ?? "./data"), {
  maxPolls: positive("MAX_POLLS", 10000),
  maxVotes: positive("MAX_VOTES_PER_POLL", 50000),
});
await store.init();
const app = createApp(store, {
  origin,
  createLimit: positive("CREATE_LIMIT_PER_MINUTE", 20),
  instance: process.env.INSTANCE_ID ?? "single",
  revision: process.env.APP_REVISION ?? "development",
  ready: () => !draining && (store.ready?.() ?? true),
});
let draining = false;
let sweeping = false;
const cleanup = setInterval(async () => {
  if (sweeping) return;
  sweeping = true;
  try {
    await store.sweep();
  } catch (e) {
    console.error("Retention cleanup failed:", e.code ?? e.name);
  } finally {
    sweeping = false;
  }
}, 30000);
cleanup.unref();
const server = app.listen(port, host, () =>
  console.log(`ScaleTag listening on ${host}:${port}`),
);
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    draining = true;
    clearInterval(cleanup);
    server.close(() => { store.close?.(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  });
