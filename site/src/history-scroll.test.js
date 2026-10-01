import { test } from "node:test";
import assert from "node:assert/strict";
import { SCROLL_KEY, createHistoryScroll, placeAt, placeFrom, restoreStep } from "./history-scroll.js";

// A window with a history stack, a location and session storage, as the browser keeps them.
function fakeWindow(initialState = null, url = "/") {
  const entries = [{ state: initialState, url }];
  let index = 0;
  const location = { pathname: "/", search: "", hash: "" };
  const show = (next) => {
    const parsed = new URL(next, "https://example.test");
    Object.assign(location, { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash });
  };
  show(url);
  const stored = new Map();
  const win = {
    scrollY: 0,
    location,
    sessionStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, String(value)),
    },
    history: {
      scrollRestoration: "auto",
      get state() {
        return entries[index].state;
      },
      pushState(state, title, next) {
        entries.splice(index + 1, Infinity, { state: structuredClone(state), url: next });
        index += 1;
        show(next);
      },
      replaceState(state, title, next = entries[index].url) {
        entries[index] = { state: structuredClone(state), url: next };
        show(next);
      },
    },
    // Back or Forward: the entry moves, the page does not scroll ("manual"); returns popstate's state.
    go(delta) {
      index += delta;
      show(entries[index].url);
      return entries[index].state;
    },
    // A fragment navigation (location.hash = …): a new entry without a state.
    fragment(hash) {
      entries.splice(index + 1, Infinity, { state: null, url: `${location.pathname}${location.search}${hash}` });
      index += 1;
      show(entries[index].url);
      return null;
    },
    entries,
    stored,
  };
  return win;
}

// The page's place as main.js measures it, here the scroll position alone (no landmarks).
const measureOf = (win, open = []) => () => placeAt(win.scrollY, 600, { result: null, overview: null }, open);
const yOf = (popped) => popped.place?.y ?? null;

test("placeAt anchors the place to the part at the middle of the screen", () => {
  const marks = { result: { top: 100, height: 3000 }, overview: 3100 };
  // Above the result (the intro card): the position itself.
  assert.deepEqual(placeAt(0, 100, marks), { y: 0, anchor: null, offset: 0, height: null, open: [] });
  // In the result card: from its top, with its height (to tell whether it came back shorter).
  assert.deepEqual(placeAt(1500, 600, marks, ["more-details"]), { y: 1500, anchor: "result", offset: 1400, height: 3000, open: ["more-details"] });
  // The card's end at the top of the screen, the overview from its middle: the overview's place.
  assert.deepEqual(placeAt(2900, 600, marks), { y: 2900, anchor: "overview", offset: -200, height: null, open: [] });
  assert.deepEqual(placeAt(5000, 600, marks), { y: 5000, anchor: "overview", offset: 1900, height: null, open: [] });
  // No result, the overview not shown yet (it is loading): the position itself.
  assert.deepEqual(placeAt(800, 600, { result: null, overview: null }), { y: 800, anchor: null, offset: 800, height: null, open: [] });
});

test("restoreStep returns to the part left, wherever it now is", () => {
  const options = { maxScroll: 20000, viewportHeight: 600, final: false };
  // The overview moved up by the intro card that closed after the first lookup (dashboard.md #1).
  const overview = placeAt(1543, 664, { result: null, overview: 500 });
  assert.deepEqual(restoreStep(overview, { result: null, overview: 140 }, options), { y: 1183 });
  // The card put back above the overview (lookup.md #1): its place in the card.
  const card = placeAt(608, 664, { result: { top: 97, height: 9700 }, overview: 9797 });
  assert.deepEqual(restoreStep(card, { result: { top: 97, height: 9700 }, overview: 9797 }, options), { y: 608 });
  // The card came back shorter: wait while its data loads (a reload); once nothing more will load
  // (a disclosure that did not reopen), its end mid-screen at most, not the overview below it.
  const deep = placeAt(5975, 600, { result: { top: 97, height: 6500 }, overview: 6597 });
  assert.equal(restoreStep(deep, { result: { top: 97, height: 3000 }, overview: 3097 }, options), null);
  assert.deepEqual(restoreStep(deep, { result: { top: 97, height: 3000 }, overview: 3097 }, { ...options, final: true }), { y: 97 + 3000 - 300 });
  // As tall as when left: no wait.
  assert.deepEqual(restoreStep(deep, { result: { top: 140, height: 6500 }, overview: 6640 }, options), { y: 6018 });
  // Above the result: the position itself.
  const above = placeAt(40, 400, { result: { top: 300, height: 900 }, overview: 1200 });
  assert.equal(above.anchor, null);
  assert.deepEqual(restoreStep(above, { result: null, overview: 100 }, options), { y: 40 });
});

test("restoreStep waits for the part and the page's height, unless nothing more will load", () => {
  const place = placeAt(5000, 600, { result: null, overview: 300 });
  // The overview is not shown yet (a reload before the dashboard's data): wait, or, nothing more
  // to come, the position itself within the page.
  assert.equal(restoreStep(place, { result: null, overview: null }, { maxScroll: 9000, viewportHeight: 600, final: false }), null);
  assert.deepEqual(restoreStep(place, { result: null, overview: null }, { maxScroll: 3000, viewportHeight: 600, final: true }), { y: 3000 });
  // Shorter than the position: wait, or the page's end.
  assert.equal(restoreStep(place, { result: null, overview: 300 }, { maxScroll: 800, viewportHeight: 600, final: false }), null);
  assert.deepEqual(restoreStep(place, { result: null, overview: 300 }, { maxScroll: 800, viewportHeight: 600, final: true }), { y: 800 });
  assert.deepEqual(restoreStep(place, { result: null, overview: 300 }, { maxScroll: -20, viewportHeight: 600, final: true }), { y: 0 });
  const top = placeAt(0, 600, { result: null, overview: null });
  assert.deepEqual(restoreStep(top, { result: null, overview: null }, { maxScroll: 0, viewportHeight: 600, final: false }), { y: 0 });
});

test("placeFrom keeps only a well-formed place", () => {
  const place = placeAt(1500, 600, { result: { top: 100, height: 3000 }, overview: 3100 }, ["more-details", "indication"]);
  assert.deepEqual(placeFrom(structuredClone(place)), place);
  assert.equal(placeFrom(null), null);
  assert.equal(placeFrom("x"), null);
  assert.equal(placeFrom({ y: "12" }), null);
  assert.equal(placeFrom({ y: 10, anchor: "elsewhere", offset: 10 }), null);
  assert.equal(placeFrom({ y: 10, anchor: "result", offset: Number.NaN }), null);
  // Open disclosures: keys only (strings, short), at most 50.
  assert.deepEqual(placeFrom({ y: 10, anchor: null, offset: 10, open: ["a", 3, "x".repeat(101), null] }).open, ["a"]);
  assert.deepEqual(placeFrom({ y: 10, anchor: null, offset: 10, open: "a" }).open, []);
  assert.equal(placeFrom({ y: 10, anchor: null, offset: 10, open: Array(80).fill("a") }).open.length, 50);
});

test("the page restores scroll positions itself, and the entry shown gets an id", () => {
  const win = fakeWindow();
  const memory = createHistoryScroll(win, measureOf(win));
  assert.equal(win.history.scrollRestoration, "manual");
  assert.equal(typeof win.history.state.id, "string");
  assert.equal(memory.initial, null);
});

test("a push keeps where the entry left was, in memory and in its state", () => {
  const win = fakeWindow();
  const memory = createHistoryScroll(win, measureOf(win, ["more-details"]));
  win.scrollY = 5000;
  memory.push("/?med=M1");
  assert.equal(win.entries.length, 2);
  assert.equal(win.entries[0].state.place.y, 5000);
  assert.deepEqual(win.entries[0].state.place.open, ["more-details"]);
  assert.equal(win.entries[1].url, "/?med=M1");
  assert.notEqual(win.entries[1].state.id, win.entries[0].state.id);
  // The new view scrolls to its heading; Back finds the list where it was left, with its open
  // disclosures.
  win.scrollY = 97;
  const back = memory.popped(win.go(-1));
  assert.equal(back.hashOnly, false);
  assert.equal(yOf(back), 5000);
  assert.deepEqual(back.place.open, ["more-details"]);
  // Forward finds the card where Back left it.
  win.scrollY = 5000;
  assert.equal(yOf(memory.popped(win.go(1))), 97);
});

test("Back and Forward keep each entry's position, also one left by Back", () => {
  const win = fakeWindow();
  const memory = createHistoryScroll(win, measureOf(win));
  win.scrollY = 600;
  memory.push("/?cond=D1");
  win.scrollY = 1200;
  memory.push("/?med=M1");
  win.scrollY = 300;
  assert.equal(yOf(memory.popped(win.go(-1))), 1200);
  win.scrollY = 1500; // scrolled further on the condition page after Back
  assert.equal(yOf(memory.popped(win.go(-1))), 600);
  assert.equal(yOf(memory.popped(win.go(1))), 1500);
  assert.equal(yOf(memory.popped(win.go(1))), 300);
});

test("a replace keeps the entry's state (its id)", () => {
  const win = fakeWindow();
  const memory = createHistoryScroll(win, measureOf(win));
  const { id } = win.history.state;
  memory.replace("/?type=Generic");
  assert.equal(win.entries.length, 1);
  assert.equal(win.entries[0].url, "/?type=Generic");
  assert.equal(win.history.state.id, id);
});

test("an entry without an id (an older build's, the first visit) is unknown and gets one", () => {
  const win = fakeWindow();
  const memory = createHistoryScroll(win, measureOf(win));
  win.history.pushState(null, "", "/?old=1"); // pushed by an older build
  win.go(-1);
  win.go(1);
  assert.equal(memory.popped(null).place, null);
  assert.equal(typeof win.history.state.id, "string");
});

test("a fragment navigation, or Back and Forward over one, is no new view", () => {
  const win = fakeWindow(null, "/?med=M1");
  const memory = createHistoryScroll(win, measureOf(win));
  // location.hash = "#protection": popstate before the browser scrolls to the fragment.
  const jump = memory.popped(win.fragment("#protection"));
  assert.deepEqual(jump, { place: null, hashOnly: true });
  win.scrollY = 2400; // the browser scrolled to it
  // Back to the card as it was: where it was left; Forward: the fragment's place.
  const back = memory.popped(win.go(-1));
  assert.equal(back.hashOnly, true);
  assert.equal(yOf(back), 0);
  win.scrollY = 0;
  assert.equal(yOf(memory.popped(win.go(1))), 2400);
  // A push from there and Back: a new view, then the fragment's entry.
  memory.push("/?cond=D1");
  win.scrollY = 97;
  const left = memory.popped(win.go(-1));
  assert.equal(left.hashOnly, false);
  assert.equal(yOf(left), 0);
  // A replace keeps the view the page shows (a later fragment is still recognized).
  memory.replace("/?med=M1&show=all");
  assert.equal(memory.popped(win.fragment("#documents")).hashOnly, true);
});

test("a reload finds where the page was left: the tab's stored place, else the entry's state", () => {
  const win = fakeWindow();
  const memory = createHistoryScroll(win, measureOf(win, ["indication"]));
  win.scrollY = 2500;
  memory.save();
  const { id } = win.history.state;
  // The reloaded page: same entry, same state.
  const reloaded = createHistoryScroll(win, measureOf(win));
  assert.equal(reloaded.initial.y, 2500);
  assert.deepEqual(reloaded.initial.open, ["indication"]);
  assert.equal(win.history.state.id, id);
  // Left (pagehide) within a second of the last scroll: the tab's session storage has it.
  win.scrollY = 3100;
  reloaded.leave();
  assert.equal(JSON.parse(win.stored.get(SCROLL_KEY)).id, id);
  assert.equal(createHistoryScroll(win, measureOf(win)).initial.y, 3100);
  // Another entry's stored place is not this one's.
  win.stored.set(SCROLL_KEY, JSON.stringify({ id: "other", place: placeAt(9000, 600, { result: null, overview: null }) }));
  assert.equal(createHistoryScroll(win, measureOf(win)).initial.y, 2500);
  win.stored.set(SCROLL_KEY, "{not json");
  assert.equal(createHistoryScroll(win, measureOf(win)).initial.y, 2500);
  // A state that is no object, or a place that is not one, is unknown.
  assert.equal(createHistoryScroll(fakeWindow("x"), () => null).initial, null);
  assert.equal(createHistoryScroll(fakeWindow({ id: "a", place: { y: "12" } }), () => null).initial, null);
});

test("blocked storage and a history write the browser refuses keep the position in memory", () => {
  const win = fakeWindow();
  win.sessionStorage = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("SecurityError");
    },
  };
  const memory = createHistoryScroll(win, measureOf(win));
  assert.equal(memory.initial, null);
  memory.leave();
  const replace = win.history.replaceState;
  win.history.replaceState = () => {
    throw new Error("SecurityError"); // Safari: past 100 writes in 30 seconds
  };
  win.scrollY = 700;
  memory.save();
  memory.push("/?med=M1");
  win.history.replaceState = replace;
  assert.equal(win.entries.length, 2);
  assert.equal(yOf(memory.popped(win.go(-1))), 700);
});
