// Offline support (registered only in production builds). Hashed /assets/* are cache-first;
// the page, manifest, icon and data files are network-first with the cache as fallback. Cross-origin
// requests (EMA PDFs, links) are never intercepted or cached. A cache failure never breaks a
// network response.
const CACHE = "approval-atlas-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// One cached page for every ?med=… / ?q=… navigation.
const cacheKey = (request) => (request.mode === "navigate" ? new URL(request.url).pathname : request);

function remember(event, response) {
  if (response.ok) {
    const copy = response.clone();
    event.waitUntil(caches.open(CACHE).then((cache) => cache.put(cacheKey(event.request), copy)).catch(() => {}));
  }
  return response;
}

const cached = (request) => caches.match(cacheKey(request)).catch(() => undefined);

async function cacheFirst(event) {
  return (await cached(event.request)) ?? remember(event, await fetch(event.request));
}

async function networkFirst(event) {
  try {
    return remember(event, await fetch(event.request));
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

// First visit: the page and the files it fetched before this worker took control bypassed it.
// The page sends their URLs; the ones this worker would cache are fetched into the cache now.
self.addEventListener("message", (event) => {
  if (!Array.isArray(event.data)) return;
  const urls = new Set(["/", ...event.data].map((url) => new URL(url, self.location.origin)).filter((url) => isAsset(url) || isPageOrData(url)).map((url) => url.href));
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all([...urls].map((url) => cache.add(url).catch(() => {})))).catch(() => {}));
});
