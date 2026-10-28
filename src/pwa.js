import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const STATIC_ASSETS = [
  "/offline.html",
  "/offline.js",
  "/base.css",
  "/styles.css",
  "/app.js",
  "/pwa.js",
  "/favicon.svg",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
];

export function serviceWorkerSource() {
  const root = new URL("../public/", import.meta.url);
  const template = readFileSync(new URL("sw.js", root), "utf8");
  const hash = createHash("sha256").update(template);
  // Include generic HTML in the version hash without ever caching page responses.
  for (const path of [...STATIC_ASSETS, "/index.html"]) {
    hash
      .update(path)
      .update(readFileSync(fileURLToPath(new URL(path.slice(1), root))));
  }
  return template
    .replace("__ASSET_VERSION__", hash.digest("hex").slice(0, 24))
    .replace("__STATIC_ASSETS__", JSON.stringify(STATIC_ASSETS));
}
