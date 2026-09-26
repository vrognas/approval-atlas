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

// Loads public/sw.js (stamped "current") with fake caches; returns its listeners and the calls made.
function loadWorker(cacheNames) {
  const listeners = {};
  const calls = { deleted: [], added: [] };
  const worker = {
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
    clients: { claim: async () => {} },
    location: { origin: "https://example.org" },
  };
  const caches = {
    keys: async () => cacheNames,
    delete: async (name) => calls.deleted.push(name),
    open: async (name) => ({ add: async (url) => calls.added.push([name, url]) }),
  };
  vm.runInNewContext(readFileSync(WORKER, "utf8").replace("__BUILD_VERSION__", "current"), { self: worker, caches, URL });
  return { listeners, calls };
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
  await dispatch(listeners.message, ["/assets/index-a1.js", "/data/ema_search_index.json", "https://www.ema.europa.eu/x.pdf"]);
  assert.deepEqual(calls.added.sort(), [
    ["approval-atlas-assets-current", "https://example.org/assets/index-a1.js"],
    ["approval-atlas-data", "https://example.org/"],
    ["approval-atlas-data", "https://example.org/data/ema_search_index.json"],
  ]);
});
