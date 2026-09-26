// Offline support (registered only in production builds). Hashed /assets/* are cache-first;
// the page, manifest, icon and data files are network-first with the cache as fallback. Cross-origin
// requests (EMA PDFs, links) are never intercepted or cached. A cache failure never breaks a
// network response.
const CACHE_PREFIX = "approval-atlas-";
// Page, manifest, icon and data files: one cache kept across builds, so files cached on an earlier
// visit (a card's documents, condition results) stay available offline after a deploy.
const DATA_CACHE = `${CACHE_PREFIX}data`;
// The build replaces the placeholder with a version (site/vite.config.js), so each deploy that
// changes an asset gets a new asset cache and the previous builds' asset caches are deleted on activate.
const ASSET_CACHE = `${CACHE_PREFIX}assets-__BUILD_VERSION__`;

async function deleteOldCaches() {
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== DATA_CACHE && name !== ASSET_CACHE).map((name) => caches.delete(name)));
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(Promise.all([deleteOldCaches().catch(() => {}), self.clients.claim()])));

// One cached page for every ?med=… / ?q=… navigation.
const cacheKey = (request) => (request.mode === "navigate" ? new URL(request.url).pathname : request);

function remember(event, response, cacheName) {
  if (response.ok) {
    const copy = response.clone();
    event.waitUntil(caches.open(cacheName).then((cache) => cache.put(cacheKey(event.request), copy)).catch(() => {}));
  }
  return response;
}

// One response per URL: entries cached from the page's URL list (message below) carry no Origin
// header, so a `Vary: Origin` response would never match the page's crossorigin asset requests.
const cached = (request) => caches.match(cacheKey(request), { ignoreVary: true }).catch(() => undefined);

async function cacheFirst(event) {
  return (await cached(event.request)) ?? remember(event, await fetch(event.request), ASSET_CACHE);
}

async function networkFirst(event) {
  try {
    return remember(event, await fetch(event.request), DATA_CACHE);
  } catch (error) {
    const hit = await cached(event.request);
    if (hit) return hit;
    throw error;
  }
}

const isSameOrigin = (url) => url.origin === self.location.origin;
const isAsset = (url) => isSameOrigin(url) && url.pathname.startsWith("/assets/");
const isPageOrData = (url) => isSameOrigin(url) && (["/", "/index.html", "/manifest.webmanifest", "/icon.svg"].includes(url.pathname) || /^\/data\/[^/]+\.json$/.test(url.pathname));

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (isAsset(url)) event.respondWith(cacheFirst(event));
  else if (isPageOrData(url)) event.respondWith(networkFirst(event));
});

// First visit or new build: the files the page fetched before this worker took control bypassed it
// (or went into the old build's asset cache, now deleted). The page sends their URLs; the ones this
// worker would cache are fetched into the matching cache now.
self.addEventListener("message", (event) => {
  if (!Array.isArray(event.data)) return;
  const urls = new Set(["/", ...event.data].map((url) => new URL(url, self.location.origin)).filter((url) => isAsset(url) || isPageOrData(url)).map((url) => url.href));
  const add = (url) => caches.open(isAsset(new URL(url)) ? ASSET_CACHE : DATA_CACHE).then((cache) => cache.add(url)).catch(() => {});
  event.waitUntil(Promise.all([...urls].map(add)));
});
