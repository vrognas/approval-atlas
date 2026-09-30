import { test } from "node:test";
import assert from "node:assert/strict";
import { FAILED, createDatasets, settledOrAfter } from "./datasets.js";

// Settles the loads started so far (fake files resolve at once).
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// A fake loadFile: rows by file name; a name missing from `files` fails (404 or offline). Counts
// the requests per file.
function fakeFiles(files) {
  const requests = new Map();
  const loadFile = (name) => {
    requests.set(name, (requests.get(name) ?? 0) + 1);
    return name in files ? Promise.resolve(files[name]) : Promise.reject(new Error(`404 ${name}`));
  };
  return { files, requests, loadFile };
}

const DEFINITIONS = {
  // The protection dataset's shape: two files it needs, one it can do without (older data).
  protection: [["protection.json", "orphan.json", { optional: "copies.json" }], (rows, orphanRows, copyRows) => ({
    rows, orphanRows, copies: copyRows ?? [],
  })],
  register: [["register.json"], (rows) => rows.length],
};

test("need: undefined while loading, then the built value; onLoad names the dataset", async () => {
  const { loadFile } = fakeFiles({ "protection.json": [1], "orphan.json": [2], "copies.json": [3], "register.json": [4, 5] });
  const loaded = [];
  const datasets = createDatasets(DEFINITIONS, loadFile, (name) => loaded.push(name));
  assert.equal(datasets.need("protection"), undefined);
  assert.equal(datasets.peek("register"), undefined); // peek never starts a load
  await settle();
  assert.deepEqual(datasets.need("protection"), { rows: [1], orphanRows: [2], copies: [3] });
  assert.deepEqual(loaded, ["protection"]);
  assert.equal(datasets.peek("register"), undefined);
});

test("a needed file that fails gives FAILED, loaded again after retry()", async () => {
  const { files, loadFile, requests } = fakeFiles({});
  const datasets = createDatasets(DEFINITIONS, loadFile, () => {});
  datasets.need("register");
  await settle();
  assert.equal(datasets.need("register"), FAILED);
  files["register.json"] = [1, 2, 3];
  datasets.retry();
  assert.equal(datasets.need("register"), undefined);
  await settle();
  assert.equal(datasets.need("register"), 3);
  assert.equal(requests.get("register.json"), 2);
});

// Backlog (step 4 review): an optional file that failed (offline, flaky Wi-Fi) used to leave its
// part empty until a reload (a curated copy's card without its reference and source link).
test("a missing optional file builds without it and is retried once, the value kept meanwhile", async () => {
  const { files, loadFile, requests } = fakeFiles({ "protection.json": [1], "orphan.json": [2] });
  const loaded = [];
  const datasets = createDatasets(DEFINITIONS, loadFile, (name) => loaded.push(name));
  datasets.need("protection");
  await settle();
  const without = datasets.need("protection");
  assert.deepEqual(without, { rows: [1], orphanRows: [2], copies: [] });
  files["copies.json"] = [3];
  datasets.retry();
  // The card keeps what it has while the file is asked for again (no "Loading…").
  assert.equal(datasets.need("protection"), without);
  await settle();
  assert.deepEqual(datasets.need("protection"), { rows: [1], orphanRows: [2], copies: [3] });
  assert.deepEqual(loaded, ["protection", "protection"]);
  assert.equal(requests.get("copies.json"), 2);
  // Complete now: later views ask for nothing.
  datasets.retry();
  datasets.need("protection");
  await settle();
  assert.equal(requests.get("copies.json"), 2);
});

// Review (backlog step 4): the retry ran on any new view, the overview too, where no card uses the
// file; still offline there, it was used up, and every later card missed the curated copies.
test("retry() alone asks for nothing: the next need() of that dataset retries it", async () => {
  const definitions = {
    protection: [["protection.json", { optional: "copies.json" }], (rows, copyRows) => copyRows ?? []],
    modalities: [[{ optional: "modalities.json" }], (rows) => rows ?? []],
  };
  const { files, loadFile, requests } = fakeFiles({ "protection.json": [1] });
  const loaded = [];
  const datasets = createDatasets(definitions, loadFile, (name) => loaded.push(name));
  datasets.need("protection");
  datasets.need("modalities");
  await settle();
  // Back to the overview, still offline: nothing is asked for, and peek() does not ask either.
  datasets.retry();
  assert.deepEqual(datasets.peek("protection"), []);
  await settle();
  assert.equal(requests.get("copies.json"), 1);
  assert.equal(requests.get("protection.json"), 1);
  // Online again, a card: only the dataset it uses is asked for, keeping its value meanwhile.
  files["copies.json"] = [3];
  files["modalities.json"] = [4];
  datasets.retry();
  assert.deepEqual(datasets.need("protection"), []);
  assert.equal(requests.get("copies.json"), 2);
  assert.equal(requests.get("modalities.json"), 1);
  await settle();
  assert.deepEqual(datasets.need("protection"), [3]);
  assert.deepEqual(loaded, ["protection", "modalities", "protection"]);
  // The one retry is used: the same card re-rendered, or the next one, asks for nothing more.
  datasets.need("protection");
  datasets.retry();
  datasets.need("protection");
  await settle();
  assert.equal(requests.get("copies.json"), 2);
  // The other dataset kept its retry for the card that uses it.
  assert.deepEqual(datasets.need("modalities"), []);
  await settle();
  assert.deepEqual(datasets.need("modalities"), [4]);
  assert.equal(requests.get("modalities.json"), 2);
});

test("an optional file still missing on its one retry keeps the value and is not asked for again", async () => {
  const { loadFile, requests } = fakeFiles({ "protection.json": [1], "orphan.json": [2] });
  const loaded = [];
  const datasets = createDatasets(DEFINITIONS, loadFile, (name) => loaded.push(name));
  datasets.need("protection");
  await settle();
  const without = datasets.need("protection");
  datasets.retry();
  datasets.need("protection");
  await settle();
  assert.equal(datasets.need("protection"), without);
  assert.deepEqual(loaded, ["protection"]); // nothing changed, no re-render
  assert.equal(requests.get("copies.json"), 2);
  datasets.retry();
  datasets.need("protection");
  await settle();
  assert.equal(requests.get("copies.json"), 2); // older data: one extra request, not one per card
});

test("a needed file failing during the retry keeps the value built before", async () => {
  const { files, loadFile } = fakeFiles({ "protection.json": [1], "orphan.json": [2] });
  const datasets = createDatasets(DEFINITIONS, loadFile, () => {});
  datasets.need("protection");
  await settle();
  const without = datasets.need("protection");
  // main.js loadFile caches a file that loaded; this fake fetches again, so drop it to fail.
  delete files["protection.json"];
  files["copies.json"] = [3];
  datasets.retry();
  datasets.need("protection");
  await settle();
  assert.equal(datasets.need("protection"), without);
});

test("retry() leaves complete datasets, loads in progress and datasets never needed alone", async () => {
  const { loadFile, requests } = fakeFiles({ "protection.json": [1], "orphan.json": [2], "copies.json": [3], "register.json": [4] });
  const datasets = createDatasets(DEFINITIONS, loadFile, () => {});
  datasets.need("protection");
  datasets.retry(); // still loading
  await settle();
  datasets.retry(); // complete
  await settle();
  assert.equal(requests.get("protection.json"), 1);
  assert.equal(requests.get("copies.json"), 1);
  assert.equal(requests.has("register.json"), false);
});

// main.js: the files a shared medicine link holds back wait for the small primary-documents file,
// but no longer than the time given (review of the primary documents, 2026-09-30).
test("settledOrAfter waits for the promise, or the time given when it takes longer", async () => {
  const order = [];
  await Promise.all([
    settledOrAfter(Promise.resolve(1), 1000).then(() => order.push("resolved")),
    settledOrAfter(Promise.reject(new Error("404")), 1000).then(() => order.push("rejected")),
  ]);
  assert.deepEqual(order.sort(), ["rejected", "resolved"]);
  const started = Date.now();
  await settledOrAfter(new Promise(() => {}), 30);
  assert.ok(Date.now() - started >= 25);
});
