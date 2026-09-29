// The landing intro (user-approved design 2026-09-28): a card between the search and the headline
// that says what the site is for, so a first-time visitor gets it in seconds. It shows on the
// untouched overview (no lookup, no filter) until the viewer closes it (×; kept in localStorage,
// every access wrapped, and the page works without it), and wherever the viewer asks for it (the
// header's "What is this?", which also undoes the close) until the view changes or it is closed.
// Owner decision 2026-09-29: three onboarding cards (icon on a tint, bold title, one plain sentence,
// an example to try) and one quiet line on scope and use, in place of the two lists.
import { UI } from "./labels.js";
import { DEFAULT_STATE, areaState, encodeUrl, filterIsSet, lookupView } from "./url.js";

const STORAGE_KEY = "approval-atlas:intro-closed";
// The breakdown's mode ("by") is not a filter.
const FILTER_KEYS = Object.keys(DEFAULT_STATE).filter((key) => key !== "by");

// Pure: no lookup open and no filter set. pendingFilters: the URL's filter part kept verbatim while
// the dashboard's data loads (main.js), whose keys count as filters (every key but "by": links from
// before phase 4f carry areas as "branch"); null once the data has loaded.
export function isOverview(state, pendingFilters = null) {
  if (lookupView(state).kind !== null) return false;
  // The default status (authorized) is no filter (owner decision 2026-09-29).
  if (FILTER_KEYS.some((key) => filterIsSet(state, key))) return false;
  return pendingFilters === null || [...pendingFilters.keys()].every((key) => key === "by");
}

// Pure: whether the card shows. overview: isOverview(); closed: the viewer closed it; requested: the
// viewer asked for it on the view shown; held: it showed when a filter popover opened, which is still
// open (review of F · Spacious phase 1: hiding it moved the chip bar and the popover under the
// pointer), so it stays until the popover closes.
export function introVisible({ overview, closed, requested, held = false }) {
  return requested || ((overview || held) && !closed);
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
    const shown = introVisible({ overview: isOverview(last.state, last.pendingFilters), closed, requested: requested !== null, held });
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
