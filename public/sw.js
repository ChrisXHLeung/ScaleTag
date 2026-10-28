// The server injects a content hash and an explicit public-resource allowlist.
const CACHE_NAME = "scaletag-static-__ASSET_VERSION__";
const STATIC_ASSETS = __STATIC_ASSETS__;
const ALLOWED = new Set(STATIC_ASSETS);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(
        STATIC_ASSETS.map((path) => new Request(path, { cache: "reload" })),
      );
      // Updated workers wait until the user chooses Update & reload.
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("scaletag-static-") && name !== CACHE_NAME)
          await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Never intercept mutations, APIs, QR codes, location searches or third-party images.
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/healthz"
  )
    return;

  if (request.mode === "navigate") {
    // Page URLs and HTML containing live state are never saved in CacheStorage.
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request, { cache: "no-store" });
          if (response.status < 500) return response; // Preserve real 404s after expiry.
        } catch {}
        return (
          (await caches.match("/offline.html", { cacheName: CACHE_NAME })) ??
          Response.error()
        );
      })(),
    );
    return;
  }

  if (url.search || !ALLOWED.has(url.pathname)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request, { cache: "no-store" });
        if (response.ok && response.type === "basic") {
          // Only allowlisted static bytes enter this cache, never cookies or poll data.
          event.waitUntil(cache.put(url.pathname, response.clone()));
        }
        return response;
      } catch {
        return (await cache.match(url.pathname)) ?? Response.error();
      }
    })(),
  );
});
