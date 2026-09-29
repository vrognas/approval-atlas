import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { serviceWorkerVersion } from "../vite.config.js";

const WORKER = new URL("../public/sw.js", import.meta.url);

// Runs the build plugin on a copy of public/sw.js, as Vite does after copying public/ to dist/.
function stamp(fileNames) {
  const dir = mkdtempSync(join(tmpdir(), "sw-"));
  copyFileSync(WORKER, join(dir, "sw.js"));
  serviceWorkerVersion().writeBundle({ dir }, Object.fromEntries(fileNames.map((name) => [name, {}])));
  return readFileSync(join(dir, "sw.js"), "utf8").match(/const ASSET_CACHE = `\$\{CACHE_PREFIX\}assets-(.*)`;/)[1];
}

// Loads public/sw.js (stamped "current") with fake caches, network and timers; returns its
// listeners, the calls made and the timers set. stored: cached responses by key (a page's path, else
// the request's URL); fetch: the network (offline by default).
function loadWorker(cacheNames, { stored = new Map(), fetch = async () => { throw new TypeError("offline"); } } = {}) {
  const listeners = {};
  const calls = { deleted: [], added: [], put: [], fetched: [] };
  const timers = [];
  const worker = {
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
    clients: { claim: async () => {} },
    location: { origin: "https://example.org" },
  };
  const keyOf = (key) => (typeof key === "string" ? key : key.url);
  const caches = {
    keys: async () => cacheNames,
    delete: async (name) => calls.deleted.push(name),
    match: async (key) => stored.get(keyOf(key)),
    open: async (name) => ({
      add: async (url) => calls.added.push([name, url]),
      put: async (key, response) => calls.put.push([name, keyOf(key), response.body]),
    }),
  };
  const network = (request) => {
    calls.fetched.push(request.url);
    return fetch(request);
  };
  const setTimeout = (callback, ms) => timers.push({ callback, ms });
  vm.runInNewContext(readFileSync(WORKER, "utf8").replace("__BUILD_VERSION__", "current"), { self: worker, caches, URL, fetch: network, setTimeout });
  return { listeners, calls, timers };
}

const response = (body) => ({ body, ok: true, clone: () => response(body) });

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Lets the worker's pending promise callbacks run.
const tick = () => new Promise((resolve) => setImmediate(resolve));

// A GET request for url (mode "navigate" for a page); returns the response promise and a function
// resolving once every waitUntil promise, later ones included, has settled.
function fetchEvent(listener, url, mode = "cors") {
  const extended = [];
  let responded;
  listener({ request: { method: "GET", url, mode }, respondWith: (promise) => (responded = promise), waitUntil: (promise) => extended.push(promise) });
  const settled = async () => {
    for (let index = 0; index < extended.length; index += 1) await extended[index];
  };
  return { response: responded, settled };
}

// Resolves once the handler's waitUntil promise settles.
function dispatch(listener, data) {
  let pending;
  listener({ data, waitUntil: (promise) => (pending = promise) });
  return pending;
}

test("the build stamps the worker with a version derived from the built file names", () => {
  const files = ["index.html", "assets/index-a1.js", "assets/index-b2.css"];
  const version = stamp(files);
  assert.match(version, /^[0-9a-f]{12}$/);
  assert.equal(stamp([...files].reverse()), version);
  assert.notEqual(stamp(["index.html", "assets/index-a1.js", "assets/index-c3.css"]), version);
});

test("the build fails if the worker has no version placeholder", () => {
  const dir = mkdtempSync(join(tmpdir(), "sw-"));
  writeFileSync(join(dir, "sw.js"), 'const CACHE = "fixed";');
  assert.throws(() => serviceWorkerVersion().writeBundle({ dir }, { "index.html": {} }), /__BUILD_VERSION__/);
});

// Data files cached on an earlier visit (a card's documents, condition results) must survive a deploy.
test("activate deletes earlier builds' asset caches and legacy caches but keeps the data cache", async () => {
  const { listeners, calls } = loadWorker([
    "approval-atlas-v1",
    "approval-atlas-0123456789ab",
    "approval-atlas-assets-0123456789ab",
    "approval-atlas-assets-current",
    "approval-atlas-data",
    "another-site",
  ]);
  await dispatch(listeners.activate);
  assert.deepEqual(calls.deleted, ["approval-atlas-v1", "approval-atlas-0123456789ab", "approval-atlas-assets-0123456789ab"]);
});

test("URLs sent by the page go to the asset cache or the data cache", async () => {
  const { listeners, calls } = loadWorker([]);
  await dispatch(listeners.message, ["/assets/index-a1.js", "/data/ema_search_index.json", "/theme-init.js", "https://www.ema.europa.eu/x.pdf"]);
  assert.deepEqual(calls.added.sort(), [
    ["approval-atlas-assets-current", "https://example.org/assets/index-a1.js"],
    ["approval-atlas-data", "https://example.org/"],
    ["approval-atlas-data", "https://example.org/data/ema_search_index.json"],
    ["approval-atlas-data", "https://example.org/theme-init.js"],
  ]);
});

// The theme script (public/theme-init.js) holds up the first paint: a cached copy answers at once,
// however slow the network, and the network's answer is kept for the next load.
const THEME_SCRIPT = "https://example.org/theme-init.js";

test("the theme script: a cached copy answers at once, and the network refreshes the cache", async () => {
  const network = deferred();
  const { listeners, calls, timers } = loadWorker([], { stored: new Map([[THEME_SCRIPT, response("cached script")]]), fetch: () => network.promise });
  const event = fetchEvent(listeners.fetch, THEME_SCRIPT);
  assert.equal((await event.response).body, "cached script");
  assert.deepEqual(timers, []);
  network.resolve(response("fresh script"));
  await event.settled();
  assert.deepEqual(calls.put, [["approval-atlas-data", THEME_SCRIPT, "fresh script"]]);
});

test("the theme script: without a cached copy, the network answers and is cached", async () => {
  const { listeners, calls } = loadWorker([], { fetch: async () => response("fresh script") });
  const event = fetchEvent(listeners.fetch, THEME_SCRIPT);
  assert.equal((await event.response).body, "fresh script");
  await event.settled();
  assert.deepEqual(calls.put, [["approval-atlas-data", THEME_SCRIPT, "fresh script"]]);
});

test("the theme script: offline with a cached copy, that copy answers", async () => {
  const { listeners } = loadWorker([], { stored: new Map([[THEME_SCRIPT, response("cached script")]]) });
  const event = fetchEvent(listeners.fetch, THEME_SCRIPT);
  assert.equal((await event.response).body, "cached script");
  await event.settled();
});

// Conference Wi-Fi (#13): a slow network must not hang the page when a copy is at hand.
const META = "https://example.org/data/meta.json";

test("with a cached copy, a network slower than 3 seconds serves that copy, and its answer updates the cache", async () => {
  const network = deferred();
  const { listeners, calls, timers } = loadWorker([], { stored: new Map([[META, response("cached")]]), fetch: () => network.promise });
  const event = fetchEvent(listeners.fetch, META);
  await tick();
  assert.deepEqual(timers.map((timer) => timer.ms), [3000]);
  timers[0].callback();
  assert.equal((await event.response).body, "cached");
  network.resolve(response("fresh"));
  await event.settled();
  assert.deepEqual(calls.put, [["approval-atlas-data", META, "fresh"]]);
});

test("with a cached copy, a network answer within 3 seconds is served and cached", async () => {
  const { listeners, calls } = loadWorker([], { stored: new Map([[META, response("cached")]]), fetch: async () => response("fresh") });
  const event = fetchEvent(listeners.fetch, META);
  assert.equal((await event.response).body, "fresh");
  await event.settled();
  assert.deepEqual(calls.put, [["approval-atlas-data", META, "fresh"]]);
});

test("with a cached copy, a failed network serves that copy without waiting", async () => {
  const { listeners } = loadWorker([], { stored: new Map([[META, response("cached")]]) });
  const event = fetchEvent(listeners.fetch, META);
  assert.equal((await event.response).body, "cached"); // no timer fired
  await event.settled();
});

test("without a cached copy, the network is awaited however long it takes", async () => {
  const network = deferred();
  const { listeners, calls, timers } = loadWorker([], { fetch: () => network.promise });
  const event = fetchEvent(listeners.fetch, META);
  await tick();
  assert.deepEqual(timers, []);
  network.resolve(response("fresh"));
  assert.equal((await event.response).body, "fresh");
  await event.settled();
  assert.deepEqual(calls.put, [["approval-atlas-data", META, "fresh"]]);
});

test("without a cached copy, a failed network fails the request", async () => {
  const { listeners } = loadWorker([]);
  const event = fetchEvent(listeners.fetch, META);
  await assert.rejects(event.response, /offline/);
  await event.settled();
});

// Review of step 4: a page is never answered from the cache while the network works. The cached page
// can be an older build's, whose hashed assets a new worker has deleted and the server no longer has
// (a blank page; its asset URLs, posted to the new worker, fail, so the next offline visit is blank
// too). The page is small (index.html, about 4.5 KB gzipped); the data files keep the race.
test("the page: a slow network is awaited even with a cached copy, as that copy's assets can be gone", async () => {
  const network = deferred();
  const { listeners, calls, timers } = loadWorker([], { stored: new Map([["/", response("cached page")]]), fetch: () => network.promise });
  const event = fetchEvent(listeners.fetch, "https://example.org/?med=EMEA%2FH%2FC%2F004174", "navigate");
  let answered = false;
  event.response.then(() => (answered = true));
  await tick();
  assert.deepEqual(timers, []);
  assert.equal(answered, false);
  network.resolve(response("fresh page"));
  assert.equal((await event.response).body, "fresh page");
  await event.settled();
  assert.deepEqual(calls.put, [["approval-atlas-data", "/", "fresh page"]]);
});

test("the page: offline, the one cached copy answers every lookup address", async () => {
  const { listeners, timers } = loadWorker([], { stored: new Map([["/", response("cached page")]]) });
  const event = fetchEvent(listeners.fetch, "https://example.org/?med=EMEA%2FH%2FC%2F004174", "navigate");
  assert.equal((await event.response).body, "cached page");
  assert.deepEqual(timers, []);
  await event.settled();
});

test("hashed assets stay cache-first: a cached copy is served with no network request or timer", async () => {
  const asset = "https://example.org/assets/index-a1.js";
  const { listeners, calls, timers } = loadWorker([], { stored: new Map([[asset, response("cached asset")]]), fetch: async () => response("fresh asset") });
  const event = fetchEvent(listeners.fetch, asset);
  assert.equal((await event.response).body, "cached asset");
  assert.deepEqual([calls.fetched, timers], [[], []]);
});

test("requests to other sites are never answered by the worker", () => {
  const { listeners } = loadWorker([]);
  const event = fetchEvent(listeners.fetch, "https://www.ema.europa.eu/en/documents/x.pdf");
  assert.equal(event.response, undefined);
});
