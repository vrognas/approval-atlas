// Scroll positions per history entry (navigation fixes, 2026-10-01). With the browser's own
// restoration ("auto"), Back landed at the top of the view it went back to (the entry was pushed
// after the new view had scrolled to its heading, so it kept that position), or thousands of pixels
// down (the position was restored before the view was rendered, and scroll anchoring then moved it
// by the height of the card put back above it). The page keeps them itself ("manual"): each entry's
// state carries an id; where an entry was left is kept by id (in memory, and in the entry's state
// when a push leaves it or the page has stopped scrolling, so a reload finds it); main.js scrolls
// there once a Back or Forward has rendered.

const stateOf = (value) => (value !== null && typeof value === "object" ? value : {});
const positionOf = (value) => (Number.isFinite(stateOf(value).scrollY) ? stateOf(value).scrollY : null);

// win: window (history, scrollY). The history writer of url.js (push, replace) and popped(state)
// for popstate.
export function createHistoryScroll(win) {
  const { history } = win;
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const positions = new Map();
  const session = Date.now().toString(36);
  let serial = 0;
  const newId = () => `${session}-${(serial += 1)}`;
  // The entry shown gets an id when it has none (the first visit, an entry an older build pushed).
  const adopt = (value) => {
    const { id } = stateOf(value);
    if (typeof id === "string") return id;
    const fresh = newId();
    history.replaceState({ ...stateOf(value), id: fresh }, "");
    return fresh;
  };
  const initial = positionOf(history.state);
  let current = adopt(history.state);
  // Where the entry shown is: kept, and written into its state (Safari throws past 100 writes in 30
  // seconds: the position in memory still holds).
  const keep = () => {
    positions.set(current, win.scrollY);
    try {
      history.replaceState({ ...stateOf(history.state), id: current, scrollY: win.scrollY }, "");
    } catch {
      // kept in memory only
    }
  };
  return {
    // A reload: where this entry was left (null: unknown).
    initial,
    push(url) {
      keep();
      current = newId();
      history.pushState({ id: current }, "", url);
    },
    replace(url) {
      history.replaceState(history.state, "", url);
    },
    // popstate: the entry left keeps where it was (the page has not scrolled yet: "manual"); returns
    // where the entry now shown was left, null when unknown.
    popped(value) {
      positions.set(current, win.scrollY);
      current = adopt(value);
      return positions.get(current) ?? positionOf(value);
    },
    // The page stopped scrolling (main.js, a second after the last scroll event): a reload finds
    // where it was. Not on pagehide: Chrome drops a state written then.
    save: keep,
  };
}

// A pending restore once a render is done: { y, done } to scroll to y, or null to wait (the page is
// still shorter than the position: its data is loading). final: nothing more will load, so the
// page's end will do.
export function restoreStep(target, maxScroll, final) {
  if (maxScroll >= target) return { y: target, done: true };
  return final ? { y: Math.max(0, maxScroll), done: true } : null;
}
