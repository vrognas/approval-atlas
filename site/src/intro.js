// The landing intro (user-approved design, 2026-09-28): a card between the search and the headline
// that says what the site is for, so a first-time visitor gets it in seconds. It shows on the
// untouched overview (no lookup, no filter) until the viewer closes it (×; kept in localStorage,
// every access wrapped, and the page works without it), and wherever the viewer asks for it (the
// header's "What is this?", which also undoes the close) until the view changes or it is closed.
import { UI } from "./labels.js";
import { DEFAULT_STATE, encodeUrl, lookupView } from "./url.js";

const STORAGE_KEY = "approval-atlas:intro-closed";
// The breakdown's mode ("by") is not a filter.
const FILTER_KEYS = Object.keys(DEFAULT_STATE).filter((key) => key !== "by");

// Pure: no lookup open and no filter set. pendingFilters: the URL's filter part kept verbatim while
// the dashboard's data loads (main.js), whose keys count as filters (every key but "by": links from
// before phase 4f carry areas as "branch"); null once the data has loaded.
export function isOverview(state, pendingFilters = null) {
  if (lookupView(state).kind !== null) return false;
  const isSet = (key) => (Array.isArray(DEFAULT_STATE[key]) ? state[key].length > 0 : state[key] !== DEFAULT_STATE[key]);
  if (FILTER_KEYS.some(isSet)) return false;
  return pendingFilters === null || [...pendingFilters.keys()].every((key) => key === "by");
}

// Pure: whether the card shows. overview: isOverview(); closed: the viewer closed it; requested: the
// viewer asked for it on the view shown.
export function introVisible({ overview, closed, requested }) {
  return requested || (overview && !closed);
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

function itemList(items) {
  const ul = element("ul", "intro-list");
  ul.append(...items.map((item) => element("li", null, item)));
  return ul;
}

function list(lead, items) {
  const block = element("div", "intro-block");
  block.append(element("p", "intro-lead", lead), itemList(items));
  return block;
}

// Phones (below 600px; user decision 2026-09-28): the explore list sits behind a disclosure whose
// summary is its lead, so the card stays short; wider, it shows as the lookup list does. The list
// moves between the two when the width crosses the breakpoint (a rotated phone).
const PHONE = "(max-width: 599.98px)";

function disclosureList(lead, items) {
  const block = element("div", "intro-block");
  const ul = itemList(items);
  const paragraph = element("p", "intro-lead", lead);
  const details = element("details", "intro-more");
  details.append(element("summary", null, lead));
  const phone = window.matchMedia?.(PHONE);
  function place() {
    if (phone?.matches) {
      details.append(ul);
      block.replaceChildren(details);
    } else {
      block.replaceChildren(paragraph, ul);
    }
  }
  place();
  phone?.addEventListener("change", place);
  return block;
}

// card: index.html #intro (hidden); link: the header's "What is this?" button. render(state,
// pendingFilters) after every page render shows or hides the card.
export function createIntro(card, link) {
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
  const columns = element("div", "intro-columns");
  columns.append(list(copy.lookupLead, copy.lookup), disclosureList(copy.exploreLead, copy.explore));
  card.append(
    title,
    close,
    columns,
    element("p", "intro-scope", copy.scope),
    element("p", "intro-authorized", copy.authorized),
    element("p", "intro-small", copy.smallPrint),
  );
  card.setAttribute("aria-labelledby", title.id);
  card.tabIndex = -1;
  link.textContent = copy.link;
  link.setAttribute("aria-controls", card.id);

  const view = () => encodeUrl(last.state, last.pendingFilters).toString();
  function update() {
    if (!last) return;
    if (requested !== null && requested !== view()) requested = null; // the view changed
    card.hidden = !introVisible({ overview: isOverview(last.state, last.pendingFilters), closed, requested: requested !== null });
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
    render(state, pendingFilters = null) {
      last = { state, pendingFilters };
      update();
    },
  };
}
