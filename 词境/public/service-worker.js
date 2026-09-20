const CACHE_NAME = "wordscape-shell-v85";
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

const VERSIONED_CORE_FILES = [
  "./styles.css?v=20260815-08",
  "./enhancements.css?v=20260917-02",
  "./content-library.js?v=20260815-08",
  "./ai-example-index.js?v=20260821-02",
  "./released-example-words.js?v=20260821-01",
  "./sync-core.js?v=20260830-14",
  "./daily-quotes.js?v=20260815-10",
  "./app.js?v=20260917-04"
];


self.addEventListener("install", (event) => {
  // Do not block installation on Cache Storage. Safari can leave its cache
  // database pending; a pending install previously made the web app unreachable.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  // Leave old caches alone here. Activation must succeed even if Safari's
  // Cache Storage is unhealthy; recovery can explicitly clear shell caches.
  event.waitUntil(self.clients.claim());
});

const NETWORK_TIMEOUT_MS = 4500;
const CACHE_TIMEOUT_MS = 900;

function resolveWithin(promise, timeoutMs) {
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  return Promise.race([Promise.resolve(promise).catch(() => null), deadline]).finally(() => clearTimeout(timer));
}
function cachedResponse(cacheKey) {
  return resolveWithin(caches.open(CACHE_NAME).then((cache) => cache.match(cacheKey)), CACHE_TIMEOUT_MS);
}
function cacheResponse(cacheKey, response) {
  void resolveWithin(caches.open(CACHE_NAME), CACHE_TIMEOUT_MS).then((cache) => {
    if (!cache) return;
    return cache.put(cacheKey, response.clone()).catch(() => undefined);
  });
}
async function networkFirstWithCacheFallback(request, cacheKey, fallbackText) {
  // Safari may reject a navigation Request when fetch options are supplied.
  const online = await resolveWithin(Promise.resolve().then(() => fetch(request)), NETWORK_TIMEOUT_MS);
  if (online) {
    if (online.ok) cacheResponse(cacheKey, online);
    return online;
  }
  const cached = await cachedResponse(cacheKey);
  return cached || new Response(fallbackText, { status: 503 });
}
self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith("/api/")) return;
  // iPad home-screen launches use a network-only URL.  Returning without
  // respondWith leaves the navigation to Safari's native network stack and
  // avoids the standalone Service Worker startup stall.
  if (requestUrl.searchParams.get("standalone") === "1") return;

  const isRefreshPage = requestUrl.pathname === "/refresh" || requestUrl.pathname.endsWith("/refresh.html");
  if (isRefreshPage) {
    event.respondWith(networkFirstWithCacheFallback(event.request, "./refresh.html", "暂时无法打开修复页面，请检查网络后重试。"));
    return;
  }
  if (event.request.mode === "navigate") {
    // Network is authoritative. Cache Storage is only a short offline fallback
    // so an unhealthy iPad cache database cannot block page startup.
    event.respondWith(networkFirstWithCacheFallback(event.request, "./index.html", "暂时无法连接词境，请检查网络后重试。"));
    return;
  }
  const isVersionedCoreAsset = requestUrl.searchParams.has("v") && /\.(?:js|css)$/i.test(requestUrl.pathname);
  if (isVersionedCoreAsset) {
    // A page and its scripts must arrive from the same network build whenever
    // possible; a cache is used only if the network request actually fails.
    event.respondWith(networkFirstWithCacheFallback(event.request, event.request, "离线资源尚未准备完成。"));
    return;
  }
  event.respondWith(networkFirstWithCacheFallback(event.request, event.request, "离线资源暂不可用，请检查网络后重试。"));
});
