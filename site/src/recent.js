// "Recently viewed" (2026-09-29; resuming unfinished work): the last medicines, substances,
// conditions, companies and drug classes the viewer opened, newest first, offered in the search
// list while the field is focused and empty. Kept per device in localStorage (approval-atlas:recent;
// every access wrapped, the page works without it); never sent anywhere. Each entry is the kind (the
// search's group key, which opens it as a picked suggestion does: main.js PICKS), the URL state's
// value and the name shown.
import { UI } from "./labels.js";
import { DEFAULT_LOOKUP, FILTER_KEYS, filterIsSet, lookupView } from "./url.js";

const STORAGE_KEY = "approval-atlas:recent";
export const RECENT_MAX = 5;
// A stored value or name longer than this is not one the site wrote.
const TEXT_MAX = 200;
const KINDS = new Set(["medicines", "substances", "conditions", "companies", "classes"]);
const KIND_OF_VIEW = { medicine: "medicines", substance: "substances", condition: "conditions", company: "companies" };
const LOOKUP_KEY = { medicines: "med", substances: "sub", conditions: "cond", companies: "co" };

const validText = (text) => typeof text === "string" && text.length > 0 && text.length <= TEXT_MAX;

// A clean copy of an entry, or null when it is not one (stored text is not trusted).
function clean(entry) {
  if (!entry || typeof entry !== "object" || !KINDS.has(entry.kind) || !validText(entry.value) || !validText(entry.label)) return null;
  return { kind: entry.kind, value: entry.value, label: entry.label };
}

const same = (a, b) => a.kind === b.kind && a.value === b.value;

// Pure (review 2026-09-29: drilling the ATC breakdown or filtering to one class stored every
// level): the class a navigation opens as a lookup (url.js classState(): the Drug classes
// suggestion, a ladder, the Try link, a recent pick; main.js navigate()), else null. The views (the
// breakdown's mode, the tab: classState() opens Classes and areas, F · Spacious phase 2) are no
// filters (url.js FILTER_KEYS).
export function openedClass(patch) {
  if (patch.atc?.length !== 1 || lookupView({ ...DEFAULT_LOOKUP, ...patch }).kind !== null) return null;
  const others = FILTER_KEYS.filter((key) => key !== "atc");
  return others.every((key) => key in patch && !filterIsSet(patch, key)) ? patch.atc[0] : null;
}

// Pure: opened (openedClass()) while the state still shows that class alone, else null (a drill, a
// filter, a card or the overview ends it).
export function keptOpenedClass(state, opened) {
  const shown = lookupView(state).kind === null && state.atc?.length === 1 && state.atc[0] === opened;
  return shown ? opened : null;
}

// Pure: the entry for the view a state shows, named name (the tab's title: lookup.title(), or the
// dashboard's class title, which is set only while one ATC class is shown alone); a class only when
// a lookup opened it (opened: keptOpenedClass()); null for other views (the overview, filters, an
// indication-text search) and while the name is unknown.
export function recentEntry(state, name, opened = null) {
  if (!name) return null;
  const { kind, value } = lookupView(state);
  if (kind) return KIND_OF_VIEW[kind] ? clean({ kind: KIND_OF_VIEW[kind], value, label: name }) : null;
  return state.atc?.length === 1 && state.atc[0] === opened ? clean({ kind: "classes", value: opened, label: name }) : null;
}

// Pure: the lookup state an entry opens (to ask lookup.title() whether it still resolves); null for
// a class, which is not a lookup.
export function recentLookupState(entry) {
  return LOOKUP_KEY[entry.kind] ? { ...DEFAULT_LOOKUP, [LOOKUP_KEY[entry.kind]]: entry.value } : null;
}

// Pure: entry first (its older copy dropped, so a renamed one takes its new name), at most RECENT_MAX.
export function addRecent(list, entry) {
  const added = clean(entry);
  if (!added) return list;
  return [added, ...list.filter((item) => !same(item, added))].slice(0, RECENT_MAX);
}

// Pure: the stored text as entries; anything else (corrupt or foreign) is left out.
export function parseRecent(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const list = [];
  for (const entry of parsed.map(clean)) {
    if (entry && !list.some((item) => same(item, entry))) list.push(entry);
  }
  return list.slice(0, RECENT_MAX);
}

// The stored list, or null when storage is blocked or missing (the caller keeps its own copy).
export function readRecent(storage) {
  try {
    return storage ? parseRecent(storage.getItem(STORAGE_KEY)) : null;
  } catch {
    return null;
  }
}

export function storeRecent(storage, list) {
  try {
    if (list.length) storage?.setItem(STORAGE_KEY, JSON.stringify(list));
    else storage?.removeItem(STORAGE_KEY);
  } catch {
    // Blocked storage: the list lasts for this visit only.
  }
}

// Pure: the search list's group (search-box.js): the entries but the view open now (current: its
// entry, it is on screen), then Clear, which empties the list; null when none is left.
export function recentGroup(list, current = null) {
  const copy = UI.lookup.recent;
  const entries = list.filter((entry) => !current || !same(entry, current));
  if (!entries.length) return null;
  return {
    key: "recent",
    label: copy.label,
    options: [
      ...entries.map((entry) => ({ label: entry.label, meta: copy.kinds[entry.kind], value: entry.value, pick: entry.kind })),
      { label: copy.clear, name: copy.clearName, value: null, action: "clear" },
    ],
  };
}

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

// The viewer's list. view(entry) for every render (recentEntry(); null for other views): a view is
// added when it changes (opened, or named once its data has loaded), not on every render, so a view
// left open after Clear does not come back by itself. group(): recentGroup() of the list read afresh
// (another tab may have added to it), without the view shown and without the entries resolves(entry)
// rejects (review 2026-09-29: a value that no longer resolves; they stay stored and age out).
// clear() empties it.
export function createRecent(storage = browserStorage(), resolves = () => true) {
  let list = readRecent(storage) ?? [];
  let viewed = null;
  const read = () => {
    list = readRecent(storage) ?? list;
    return list;
  };
  return {
    view(entry) {
      const unchanged = entry && viewed ? same(entry, viewed) && entry.label === viewed.label : entry === viewed;
      if (unchanged) return;
      viewed = entry;
      if (!entry) return;
      list = addRecent(read(), entry);
      storeRecent(storage, list);
    },
    group: () => recentGroup(read().filter(resolves), viewed),
    clear() {
      list = [];
      storeRecent(storage, list);
    },
  };
}
