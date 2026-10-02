// Scroll positions per history entry (navigation fixes, 2026-10-01). With the browser's own
// restoration ("auto"), Back landed at the top of the view it went back to (the entry was pushed
// after the new view had scrolled to its heading, so it kept that position), or thousands of pixels
// down (the position was restored before the view was rendered, and scroll anchoring then moved it
// by the height of the card put back above it). The page keeps them itself ("manual"): each entry's
// state carries an id; where an entry was left (its place) is kept by id (in memory, in the entry's
// state when a push leaves it or the page has stopped scrolling, and in the tab's session storage
// when the page is left, so a reload finds it); main.js scrolls there once a Back or Forward has
// rendered.
//
// A place is { y, anchor, offset, height, open } (fix-up of the review, 2026-10-01): the part of
// the page at the middle of the screen (the lookup result, the overview below it, else neither) and
// the position from its top, as the parts above can come back other heights (the intro card closes
// after the first lookup; the card is put back above the overview); the result's height (a card that
// comes back shorter is not scrolled past); and the result's open disclosures (details[data-key]:
// More details, the full indication), reopened before the restore, as the card is made anew.

export const SCROLL_KEY = "approval-atlas:scroll";
const ANCHORS = new Set(["result", "overview"]);
const OPEN_MAX = 50;
const KEY_MAX = 100;

const stateOf = (value) => (value !== null && typeof value === "object" ? value : {});

// marks: the document tops of the parts shown, { result: { top, height } | null, overview: number |
// null }; open: the result's open disclosure keys.
export function placeAt(y, viewportHeight, marks, open = []) {
  const middle = y + viewportHeight / 2;
  const { result, overview } = marks;
  if (overview !== null && middle >= overview) return { y, anchor: "overview", offset: y - overview, height: null, open };
  if (result && middle >= result.top) return { y, anchor: "result", offset: y - result.top, height: result.height, open };
  return { y, anchor: null, offset: y, height: null, open };
}

// The scroll position as it will be without a band of the page that does not come back with its
// view (band: { top, height }, document pixels, or null: the medicines table's in-flow ATC tip,
// main.js flowTipBand()): the band's part above the point kept still is left out, so what was there
// comes back there. That point is the control just pressed (focus: { top, bottom }, document
// pixels, or null) when it is in view below the band (a link tapped under the tip), else the middle
// of the screen, where a place is kept (review of the in-flow tip, 2026-10-02).
export function scrollWithout(y, viewportHeight, band, focus) {
  if (!band) return y;
  const inView = focus !== null && focus.bottom > y && focus.top < y + viewportHeight;
  const still = inView && focus.top >= band.top + band.height ? focus.top : y + viewportHeight / 2;
  return y - Math.min(Math.max(still - band.top, 0), band.height);
}

// A place read back from a history state or session storage, or null when it is not one.
export function placeFrom(value) {
  if (value === null || typeof value !== "object") return null;
  const { y, anchor = null, offset, height = null, open = [] } = value;
  if (!Number.isFinite(y) || !Number.isFinite(offset) || (anchor !== null && !ANCHORS.has(anchor))) return null;
  return {
    y,
    anchor,
    offset,
    height: Number.isFinite(height) ? height : null,
    open: Array.isArray(open) ? open.filter((key) => typeof key === "string" && key.length <= KEY_MAX).slice(0, OPEN_MAX) : [],
  };
}

// Where a place is now, or null while it cannot be told: its part is not shown, or the result is
// shorter than when left and its data may still be loading (final: nothing more will load: then
// something in it did not come back, so its end mid-screen at most, not the overview below it).
function targetOf(place, marks, viewportHeight, final) {
  if (place.anchor === null) return place.y;
  if (place.anchor === "overview") return marks.overview === null ? null : marks.overview + place.offset;
  const { result } = marks;
  if (!result) return null;
  if (place.height === null || result.height >= place.height - 1) return result.top + place.offset;
  return final ? result.top + Math.min(place.offset, Math.max(0, result.height - viewportHeight / 2)) : null;
}

// A pending restore once a render is done: { y } to scroll to, or null to wait (its part is not
// shown or complete yet, or the page is still shorter than the position: its data is loading).
// final: nothing more will load, so the position itself, or the page's end, will do.
export function restoreStep(place, marks, { maxScroll, viewportHeight, final }) {
  const target = targetOf(place, marks, viewportHeight, final);
  if (target === null) return final ? { y: Math.max(0, Math.min(place.y, maxScroll)) } : null;
  if (maxScroll >= target) return { y: Math.max(0, target) };
  return final ? { y: Math.max(0, maxScroll) } : null;
}

// win: window (history, location, sessionStorage); measure(): the page's place now (placeAt()). The
// history writer of url.js (push, replace), popped(state) for popstate, save() and leave().
export function createHistoryScroll(win, measure) {
  const { history } = win;
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const places = new Map();
  const session = Date.now().toString(36);
  let serial = 0;
  const newId = () => `${session}-${(serial += 1)}`;
  // The view the page shows: a popstate that leaves it as it is changed only the fragment.
  const viewOf = () => `${win.location.pathname}${win.location.search}`;
  let shown = viewOf();
  // The entry shown gets an id when it has none (the first visit, an entry an older build pushed, a
  // fragment navigation).
  const adopt = (value) => {
    const { id } = stateOf(value);
    if (typeof id === "string") return id;
    const fresh = newId();
    history.replaceState({ ...stateOf(value), id: fresh }, "");
    return fresh;
  };
  const readStored = () => {
    try {
      return JSON.parse(win.sessionStorage.getItem(SCROLL_KEY));
    } catch {
      return null; // blocked storage, or not JSON
    }
  };
  // A reload: the place the tab stored when it left this entry, else the one in its state.
  const stored = stateOf(readStored());
  const initial = (typeof stored.id === "string" && stored.id === stateOf(history.state).id ? placeFrom(stored.place) : null)
    ?? placeFrom(stateOf(history.state).place);
  let current = adopt(history.state);
  // Where the entry shown is: kept, and written into its state (Safari throws past 100 writes in 30
  // seconds: the place in memory still holds).
  const keep = () => {
    const place = measure();
    places.set(current, place);
    try {
      history.replaceState({ ...stateOf(history.state), id: current, place }, "");
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
      shown = viewOf();
    },
    replace(url) {
      history.replaceState(history.state, "", url);
      shown = viewOf();
    },
    // popstate: the entry left keeps where it was (the page has not scrolled yet: "manual", and a
    // fragment navigation scrolls after it); returns where the entry now shown was left (null when
    // unknown) and whether only the fragment changed (hashOnly: the same view, nothing to render).
    popped(value) {
      places.set(current, measure());
      const view = viewOf();
      const hashOnly = view === shown;
      shown = view;
      current = adopt(value);
      return { place: places.get(current) ?? placeFrom(stateOf(value).place), hashOnly };
    },
    // The page stopped scrolling (main.js, a second after the last scroll event): a reload finds
    // where it was.
    save: keep,
    // The page is left (pagehide, or hidden): the tab keeps where, for a reload within that second
    // (Chrome drops a history state written then; session storage holds).
    leave() {
      try {
        win.sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ id: current, place: measure() }));
      } catch {
        // blocked storage: the entry's state still has the place of the last save
      }
    },
  };
}
