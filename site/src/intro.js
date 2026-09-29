// The landing intro (user-approved design 2026-09-28): a card between the search and the headline
// that says what the site is for, so a first-time visitor gets it in seconds. It shows on the
// untouched overview (no lookup, no filter) on the viewer's first visit only (2026-09-29, the
// paradox of the active user: people start using a site at once, so the card has one turn), until
// the viewer does any lookup or filter or closes it (×); later visits start with it collapsed to
// the header's "What is this?", which shows it (and undoes the close) wherever the viewer asks
// until the view changes or it is closed. The visit and the close are kept in localStorage, every
// access wrapped, and the page works without it.
// Owner decision 2026-09-29: three onboarding cards (icon on a tint, bold title, one plain sentence,
// an example to try) and one quiet line on scope and use, in place of the two lists.
import { UI } from "./labels.js";
import { DEFAULT_STATE, FILTER_KEYS, areaState, encodeUrl, filterIsSet, lookupView } from "./url.js";

const STORAGE_KEY = "approval-atlas:intro-closed";
const SEEN_KEY = "approval-atlas:intro-seen";
// Pure: no lookup open, no filter set (url.js FILTER_KEYS: the breakdown's mode and the tab are
// views, not filters) and the Overview tab shown (review of F · Spacious phase 2: a tab other than
// the Overview leaves the untouched overview too, so the card has had its turn). pendingFilters: the
// URL's filter part kept verbatim while the dashboard's data loads (main.js), whose keys count as
// leaving it (every key but "by": a "tab" key names a tab other than the Overview; links from
// before phase 4f carry areas as "branch"); null once the data has loaded.
export function isOverview(state, pendingFilters = null) {
  if (lookupView(state).kind !== null) return false;
  // The default status (authorized) is no filter (owner decision 2026-09-29).
  if (FILTER_KEYS.some((key) => filterIsSet(state, key))) return false;
  if ((state.tab ?? DEFAULT_STATE.tab) !== DEFAULT_STATE.tab) return false;
  return pendingFilters === null || [...pendingFilters.keys()].every((key) => key === "by");
}

// Pure: whether the card has had its turn: the viewer saw it on an earlier visit (seenBefore), or has
// left the untouched overview on this one (any lookup or filter; spent: the last answer).
export function introSpent({ seenBefore, spent, overview }) {
  return seenBefore || spent || !overview;
}

// Pure: whether the card shows. overview: isOverview(); closed: the viewer closed it; requested: the
// viewer asked for it on the view shown; spent: introSpent(); held: it showed when a filter popover
// opened, which is still open (review of F · Spacious phase 1: hiding it moved the chip bar and the
// popover under the pointer), so it stays until the popover closes, spent or not.
export function introVisible({ overview, closed, requested, held = false, spent = false }) {
  return requested || (((overview && !spent) || held) && !closed);
}

// Pure (owner decision 2026-09-29): the Try line under the search hides while the card shows, whose
// examples stand in for it, and is back once the card is closed and on the filtered overview. A
// lookup hides it as before (redesign E: the result starts right under the search on a phone).
export function tryLineVisible(introShown, lookupOpen = false) {
  return !introShown && !lookupOpen;
}

// Pure: the state a card's example opens (labels.js UI.intro.cards): a medicine card, or the
// overview filtered to one therapeutic area alone.
export function introCardPatch(card) {
  return card.area ? areaState(card.area) : card.patch;
}

export function readIntroClosed(storage) {
  try {
    return storage?.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function storeIntroClosed(storage, closed) {
  try {
    if (closed) storage?.setItem(STORAGE_KEY, "1");
    else storage?.removeItem(STORAGE_KEY);
  } catch {
    // Blocked storage: the choice lasts for this visit only.
  }
}

// The first visit: "1" once the page has started (on this device and browser).
export function readIntroSeen(storage) {
  try {
    return storage?.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function storeIntroSeen(storage) {
  try {
    storage?.setItem(SEEN_KEY, "1");
  } catch {
    // Blocked storage: every visit is a first one.
  }
}

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function element(tag, className, text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = text;
  return node;
}

// The cards' icons (24 x 24, drawn at 24px so 2px strokes on whole coordinates stay crisp):
// stroked paths in the hue's text shade ("thin" ones 1.5px), "solid" fills in it too, "soft" fills
// in its mid.
const ICONS = {
  // A magnifier over a capsule (9 x 4.5, turned 45°): its outline with one half filled (review
  // 2026-09-29: a two-tone capsule without an outline, its soft half 1.6:1 on the tile, read as a
  // smudge at 1x).
  lookup: {
    stroked: ["M10 2.5a7.5 7.5 0 1 1 0 15a7.5 7.5 0 1 1 0-15z", "M15.5 15.5 21 21"],
    solid: ["M8.41 8.41 10 6.82a2.25 2.25 0 0 1 3.18 3.18L11.59 11.59z"],
    thin: ["M10 13.18 13.18 10a2.25 2.25 0 0 0-3.18-3.18L6.82 10a2.25 2.25 0 0 0 3.18 3.18z"],
  },
  // A shield with a check mark.
  shield: {
    soft: ["M12 3 19 6v5c0 4.5-3 8-7 10c-4-2-7-5.5-7-10V6z"],
    stroked: ["M12 3 19 6v5c0 4.5-3 8-7 10c-4-2-7-5.5-7-10V6z", "M8.75 12 11 14.25 15.5 9.75"],
  },
  // Rising bars on a baseline.
  chart: {
    soft: ["M4 19v-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5z", "M10 19V9a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v10z"],
    solid: ["M16 19V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v14z"],
    stroked: ["M3 21h18"],
  },
  // The action's arrow (16 x 16).
  arrow: { stroked: ["M3 8h9.5", "M9 4.5 12.5 8 9 11.5"] },
};

const SVG = "http://www.w3.org/2000/svg";

function icon(name, className, size = 24) {
  const svg = document.createElementNS(SVG, "svg");
  for (const [attribute, value] of Object.entries({ class: className, viewBox: `0 0 ${size} ${size}`, "aria-hidden": "true", focusable: "false" })) {
    svg.setAttribute(attribute, value);
  }
  const { soft = [], solid = [], stroked = [], thin = [] } = ICONS[name];
  // Soft fills first, so the strokes and solid fills lie on them.
  for (const [kind, paths] of [["soft", soft], ["solid", solid], ["stroked", stroked], ["thin", thin]]) {
    for (const d of paths) {
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", `icon-${kind}`);
      svg.append(path);
    }
  }
  return svg;
}

// One card: its icon on the hue's tint, the title (a heading under the card's hidden one), the
// sentence and the example link. link(text, patch, className): lookup.link (a pushState link, as the
// Try line's). The space between sentence and link shows where they run on in one line (phone rows);
// side by side, the link is at the card's foot.
function introCard(card, link) {
  const item = element("li", "intro-card");
  const tile = element("span", `intro-icon hue-${card.hue}`);
  tile.append(icon(card.icon, "intro-icon-svg"));
  const body = element("div", "intro-card-body");
  body.append(
    element("h3", "intro-card-title", card.title),
    element("p", "intro-card-text", card.text),
    " ",
    link([card.action, icon("arrow", "intro-arrow", 16)], introCardPatch(card), "intro-action"),
  );
  item.append(tile, body);
  return item;
}

// card: index.html #intro (hidden); link: the header's "What is this?" button; options.link: makes
// the cards' example links (lookup.link, called once the page first renders, when it exists);
// options.tryLine: the Try line (#lookup-try, hidden until the first render), shown or hidden with
// the card. render(state, pendingFilters, { hold }) after every page render shows or hides both.
export function createIntro(card, link, { link: exampleLink, tryLine }) {
  const copy = UI.intro;
  const storage = browserStorage();
  let closed = readIntroClosed(storage);
  // Read before this visit marks itself, so the card has its turn on this one.
  const seenBefore = readIntroSeen(storage);
  storeIntroSeen(storage);
  let spent = seenBefore;
  let requested = null; // the view (encodeUrl()) the viewer asked for the card on
  let last = null; // the last render's { state, pendingFilters }

  const title = element("h2", "visually-hidden", copy.title);
  title.id = "intro-title";
  const close = element("button", "intro-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", copy.close);
  close.title = copy.closeHint;
  const cards = element("ul", "intro-cards");
  card.append(title, close, cards, element("p", "intro-scope", copy.scope));
  card.setAttribute("aria-labelledby", title.id);
  card.tabIndex = -1;
  link.textContent = copy.link;
  link.setAttribute("aria-controls", card.id);

  const view = () => encodeUrl(last.state, last.pendingFilters).toString();
  function update() {
    if (!last) return;
    if (requested !== null && requested !== view()) requested = null; // the view changed
    const held = last.hold && !card.hidden;
    const overview = isOverview(last.state, last.pendingFilters);
    spent = introSpent({ seenBefore, spent, overview });
    const shown = introVisible({ overview, closed, requested: requested !== null, held, spent });
    card.hidden = !shown;
    tryLine.hidden = !tryLineVisible(shown, lookupView(last.state).kind !== null);
  }

  // Closed: focus goes to the link that brings it back (the card's place is gone).
  close.addEventListener("click", () => {
    closed = true;
    requested = null;
    storeIntroClosed(storage, true);
    update();
    link.focus();
  });
  link.addEventListener("click", () => {
    if (!last) return;
    closed = false;
    storeIntroClosed(storage, false);
    requested = view();
    update();
    card.focus();
  });

  return {
    // hold: a filter popover is open; the card stays as it is shown until it closes.
    render(state, pendingFilters = null, { hold = false } = {}) {
      if (!last) cards.append(...copy.cards.map((entry) => introCard(entry, exampleLink)));
      last = { state, pendingFilters, hold };
      update();
    },
  };
}
