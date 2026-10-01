import { test } from "node:test";
import assert from "node:assert/strict";
import { createHistoryScroll, restoreStep } from "./history-scroll.js";

// A window with a history stack and a scroll position, as the browser keeps them.
function fakeWindow(initialState = null) {
  const entries = [{ state: initialState, url: "/" }];
  let index = 0;
  const win = {
    scrollY: 0,
    history: {
      scrollRestoration: "auto",
      get state() {
        return entries[index].state;
      },
      pushState(state, title, url) {
        entries.splice(index + 1, Infinity, { state: structuredClone(state), url });
        index += 1;
      },
      replaceState(state, title, url = entries[index].url) {
        entries[index] = { state: structuredClone(state), url };
      },
    },
    // Back or Forward: the entry moves, the page does not scroll ("manual"); returns popstate's state.
    go(delta) {
      index += delta;
      return entries[index].state;
    },
    entries,
  };
  return win;
}

test("the page restores scroll positions itself, and the entry shown gets an id", () => {
  const win = fakeWindow();
  const memory = createHistoryScroll(win);
  assert.equal(win.history.scrollRestoration, "manual");
  assert.equal(typeof win.history.state.id, "string");
  assert.equal(memory.initial, null);
});

test("a push keeps where the entry left was, in memory and in its state", () => {
  const win = fakeWindow();
  const memory = createHistoryScroll(win);
  win.scrollY = 5000;
  memory.push("/?med=M1");
  assert.equal(win.entries.length, 2);
  assert.equal(win.entries[0].state.scrollY, 5000);
  assert.equal(win.entries[1].url, "/?med=M1");
  assert.notEqual(win.entries[1].state.id, win.entries[0].state.id);
  // The new view scrolls to its heading; Back finds the list where it was left.
  win.scrollY = 97;
  assert.equal(memory.popped(win.go(-1)), 5000);
  // Forward finds the card where Back left it.
  win.scrollY = 5000;
  assert.equal(memory.popped(win.go(1)), 97);
});

test("Back and Forward keep each entry's position, also one left by Back", () => {
  const win = fakeWindow();
  const memory = createHistoryScroll(win);
  win.scrollY = 600;
  memory.push("/?cond=D1");
  win.scrollY = 1200;
  memory.push("/?med=M1");
  win.scrollY = 300;
  assert.equal(memory.popped(win.go(-1)), 1200);
  win.scrollY = 1500; // scrolled further on the condition page after Back
  assert.equal(memory.popped(win.go(-1)), 600);
  assert.equal(memory.popped(win.go(1)), 1500);
  assert.equal(memory.popped(win.go(1)), 300);
});

test("a replace keeps the entry's state (its id)", () => {
  const win = fakeWindow();
  const memory = createHistoryScroll(win);
  const { id } = win.history.state;
  memory.replace("/?type=Generic");
  assert.equal(win.entries.length, 1);
  assert.equal(win.entries[0].url, "/?type=Generic");
  assert.equal(win.history.state.id, id);
});

test("an entry without an id (an older build's, the first visit) is unknown and gets one", () => {
  const win = fakeWindow();
  const memory = createHistoryScroll(win);
  win.history.pushState(null, "", "/?old=1"); // pushed by an older build
  win.go(-1);
  win.go(1);
  assert.equal(memory.popped(null), null);
  assert.equal(typeof win.history.state.id, "string");
});

test("a reload finds where the page stopped scrolling", () => {
  const win = fakeWindow();
  const memory = createHistoryScroll(win);
  win.scrollY = 2500;
  memory.save();
  const { id } = win.history.state;
  // The reloaded page: same entry, same state.
  const reloaded = createHistoryScroll(win);
  assert.equal(reloaded.initial, 2500);
  assert.equal(win.history.state.id, id);
  // A state that is no object, or a position that is no number, is unknown.
  assert.equal(createHistoryScroll(fakeWindow("x")).initial, null);
  assert.equal(createHistoryScroll(fakeWindow({ id: "a", scrollY: "12" })).initial, null);
});

test("a history write the browser refuses (Safari's limit) keeps the position in memory", () => {
  const win = fakeWindow();
  const memory = createHistoryScroll(win);
  const replace = win.history.replaceState;
  win.history.replaceState = () => {
    throw new Error("SecurityError");
  };
  win.scrollY = 700;
  memory.save();
  memory.push("/?med=M1");
  win.history.replaceState = replace;
  assert.equal(win.entries.length, 2);
  assert.equal(memory.popped(win.go(-1)), 700);
});

test("restoreStep scrolls once the page reaches the position, else waits, or ends at the page's end", () => {
  assert.deepEqual(restoreStep(5000, 30000, false), { y: 5000, done: true });
  assert.deepEqual(restoreStep(0, 0, false), { y: 0, done: true });
  // Content still loading: wait (no scroll), unless nothing more will load.
  assert.equal(restoreStep(5000, 800, false), null);
  assert.deepEqual(restoreStep(5000, 800, true), { y: 800, done: true });
  assert.deepEqual(restoreStep(5000, -20, true), { y: 0, done: true });
});
