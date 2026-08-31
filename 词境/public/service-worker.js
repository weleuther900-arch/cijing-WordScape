const CACHE_NAME = "wordscape-shell-v63";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./refresh.html",
  "./styles.css",
  "./enhancements.css",
  "./content-library.js",

  "./ai-example-index.js",
  "./released-example-words.js",
  "./sync-core.js",
  "./daily-quotes.js",
  "./app.js",
  "./manifest.webmanifest",
  "./app-icon.png",
  "./bundled-imports/27-one.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_FILES);
    // Large optional data (the offline dictionary and example shards) is never
    // part of installation.  Safari otherwise waits for tens of megabytes
    // before a Home Screen app can open, and can fail the installation outright.
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME && key !== "wordscape-user-state-v1").map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

async function refreshCachedAsset(cacheKey, request) {
  try {
    const response = await fetch(request);
    if (!response?.ok) return response;
    const cache = await caches.open(CACHE_NAME);
    await cache.put(cacheKey, response.clone());
    return response;
  } catch {
    return null;
  }
}
self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith("/api/")) return;
  if (requestUrl.pathname.endsWith("/refresh.html")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }).catch(() => caches.match(event.request)).then((response) => response || new Response("暂时无法打开修复页面，请检查网络后重试。", { status: 503 })));
    return;
  }
  if (event.request.mode === "navigate") {
    // New deployments must be visible on the same launch. The old cache-first
    // behavior made installed PWAs keep showing a previous page until later.
    // Cache remains the offline fallback.
    event.respondWith(refreshCachedAsset("./index.html", event.request).then((response) => response || caches.match("./index.html")).then((response) => response || new Response("暂时无法连接词境，请检查网络后重试。", { status: 503 })));
    return;
  }
  const isVersionedCoreAsset = requestUrl.searchParams.has("v") && /\.(?:js|css)$/i.test(requestUrl.pathname);
  if (isVersionedCoreAsset) {
    // Versioned JS/CSS cannot silently use an old build while online; otherwise
    // a new page may run against stale application code.
    event.respondWith(refreshCachedAsset(event.request, event.request).then((response) => response || caches.match(event.request)).then((cached) => cached || caches.match(requestUrl.pathname, { ignoreSearch: true })).then((cached) => cached || new Response("离线资源尚未准备完成。", { status: 503 })));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    return response;
  })));
});
