const SHELL_CACHE = "murattab-shell-v3";
const RUNTIME_CACHE = "murattab-runtime-v3";
const PRECACHE_OFFLINE = ["/offline", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_OFFLINE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("murattab-") &&
                key !== SHELL_CACHE &&
                key !== RUNTIME_CACHE
            )
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Exclude non-GET, API routes, video media, and Range requests
  if (
    request.method !== "GET" ||
    request.url.includes("/api/") ||
    request.destination === "video" ||
    request.url.endsWith(".mp4") ||
    request.headers.has("range")
  ) {
    return;
  }

  const url = new URL(request.url);
  // Same-origin only
  if (url.origin !== self.location.origin) {
    return;
  }

  // 1. Navigation requests (HTML pages): NETWORK FIRST
  // Online: always fetch latest deployment from network and update runtime cache
  // Offline: return previously cached page if visited, or fallback to /offline
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.status === 200) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone)).catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offlineFallback = await caches.match("/offline");
          if (offlineFallback) return offlineFallback;
          return new Response("الخدمة غير متوفرة دون اتصال", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        })
    );
    return;
  }

  // 2. Immutable Next.js static assets: CACHE FIRST
  // Content-hashed files under /_next/static/ never change content for the same URL
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok && response.status === 200) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone)).catch(() => {});
          }
          return response;
        });
      })
    );
    return;
  }

  // 3. Other same-origin GET requests (manifest, icons, RSC payloads, etc.): NETWORK FIRST with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.status === 200) {
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone)).catch(() => {});
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        return cached || Response.error();
      })
  );
});
