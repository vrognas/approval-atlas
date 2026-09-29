// Filter and lookup state <-> URL query string. Encode/decode are pure; the writer touches history.
import { splitAtcValues } from "./filters.js";

export const BREAKDOWNS = ["atc", "area", "mah", "mod"];
// F · Spacious, phase 2: the dashboard's tabs, in their order (Serial Position / Pareto: Protection
// next to the Overview, the conference question "is it still protected?").
export const TABS = ["overview", "protection", "classes", "companies", "years", "medicines"];
// The longest ATC value a link may carry (a class-name query); the longest ATC class name is 113.
export const ATC_QUERY_MAX = 120;

export const DEFAULT_STATE = Object.freeze({
  // Companies part 2: company group keys ("g.roche"), company keys ("c.roche") and EMA holder
  // names (older links carry those) in one list, combined with OR; none includes another.
  mah: [],
  from: null, // whole years, inclusive; null = open end
  to: null,
  // Therapeutic areas (phase 4f): MeSH branch codes ("C04"), tree numbers ("C04.588.180") and EMA's
  // terms ("Psoriasis") in one list, combined with OR; none covers another.
  area: [],
  atc: [], // ATC codes at any level, or class-name queries (older links), combined with OR
  type: [],
  // Modality (M2 phase 2): group and modality keys (modalities.json) in one list, combined with OR;
  // none covers another.
  mod: [],
  // Owner decision 2026-09-29 ("Authorized by default"): the overview shows the authorized medicines
  // unless the viewer widens the Status filter; empty = every status (the URL's status=all).
  status: ["Authorised"],
  by: "atc",
  // The dashboard's tab (F · Spacious, phase 2): a view, not a filter, as the breakdown's mode.
  tab: "overview",
});

// The keys that are views, not filters: the breakdown's mode and the tab. No filter count, Clear or
// announcement of a filter change counts them.
const VIEW_KEYS = ["by", "tab"];
export const FILTER_KEYS = Object.freeze(Object.keys(DEFAULT_STATE).filter((key) => !VIEW_KEYS.includes(key)));

// Every status in the URL (the default, Authorised, has no key; an empty list would have none too).
export const STATUS_ALL = "all";

// The default status filter (Authorised alone) is no active filter.
export const isDefaultStatus = (status) => status.length === DEFAULT_STATE.status.length && status.every((value) => DEFAULT_STATE.status.includes(value));

// Whether a filter key differs from its default: a list with values (the status: any other than the
// default, every status included), a year bound or the breakdown set.
export function filterIsSet(state, key) {
  if (key === "status") return !isDefaultStatus(state.status);
  return Array.isArray(DEFAULT_STATE[key]) ? state[key].length > 0 : state[key] !== DEFAULT_STATE[key];
}

// The filter dimensions set (the approval years one, however many ends), for "Reset all", the
// headline's forms and the sentence's Reset; except: a dimension left out.
const FILTER_DIMENSIONS = { mah: ["mah"], date: ["from", "to"], area: ["area"], atc: ["atc"], type: ["type"], mod: ["mod"], status: ["status"] };
export function activeFilterCount(state, except = null) {
  return Object.entries(FILTER_DIMENSIONS).filter(([dimension, keys]) => dimension !== except && keys.some((key) => filterIsSet(state, key))).length;
}

// Keys of earlier versions, ignored without a note: view (the "Authorized now" / "Approvals per
// year" tabs, replaced by one dashboard in phase 4a).
const IGNORED_KEYS = ["view"];

// Repeated keys, because MAH names and MeSH terms contain commas. Value = domain set name. The
// therapeutic areas (area, and branch from before phase 4f) and the companies (mah) are decoded on
// their own.
const LIST_KEYS = { type: "types", status: "statuses" };

const sortedDistinct = (values) => [...new Set(values)].sort();

// ATC values as the URL and state keep them: trimmed, codes upper-case, empty ones dropped, and no
// selected class covering another (a code under a selected one is dropped, as toggleAtcCode()).
function atcValues(values) {
  const { codes, names } = splitAtcValues(values);
  const covered = (code) => codes.some((other) => other.length < code.length && code.startsWith(other));
  return sortedDistinct([...codes.filter((code) => !covered(code)), ...names]);
}

export function encodeState(state) {
  const params = new URLSearchParams();
  const appendAll = (key, values = sortedDistinct(state[key])) => {
    for (const value of values) params.append(key, value);
  };
  appendAll("mah");
  if (state.from !== null) params.set("from", String(state.from));
  if (state.to !== null) params.set("to", String(state.to));
  appendAll("area");
  appendAll("atc", atcValues(state.atc));
  appendAll("type");
  appendAll("mod");
  if (state.status.length === 0) params.set("status", STATUS_ALL);
  else if (!isDefaultStatus(state.status)) appendAll("status");
  if (state.by !== DEFAULT_STATE.by) params.set("by", state.by);
  if (state.tab !== DEFAULT_STATE.tab) params.set("tab", state.tab);
  return params;
}

// null = open end, so a bound at the data's first/last year is canonicalized away.
export function normalizeYearRange(from, to, [minYear, maxYear]) {
  const clamp = (year) => (year === null ? null : Math.min(maxYear, Math.max(minYear, year)));
  let [lower, upper] = [clamp(from), clamp(to)];
  if (lower !== null && upper !== null && lower > upper) [lower, upper] = [upper, lower];
  return { from: lower === minYear ? null : lower, to: upper === maxYear ? null : upper };
}

// domain: { mahs, areas (every therapeutic area tree key), types, statuses: Set, years: [min, max],
// areaAncestors(key): the branches and nodes above a tree key (a Set; optional), areaCanonical(key):
// the keys a value is selected as (a term that is a branch or node: that key; optional),
// mahAncestors(value), mahCanonical(value): the same for companies (companies.js ancestors(),
// canonical(); optional), modalities: the modality tree's keys and modalityAncestors(key): a
// modality's group (modalities.js; optional: without them every modality value is dropped) }.
// Invalid values are dropped and returned so the page can say how many were ignored.
export function decodeState(params, domain) {
  const state = structuredClone(DEFAULT_STATE);
  const dropped = [];
  const oneOf = (key, allowed) => {
    const value = params.get(key);
    if (value === null) return DEFAULT_STATE[key];
    if (allowed.includes(value)) return value;
    dropped.push({ key, value });
    return DEFAULT_STATE[key];
  };
  state.by = oneOf("by", BREAKDOWNS);
  // Links from before the tabs have no key: the Overview.
  state.tab = oneOf("tab", TABS);

  for (const [key, domainName] of Object.entries(LIST_KEYS)) {
    const values = sortedDistinct(params.getAll(key));
    // The status: "all" is every status (whatever else is listed); no valid value leaves the default.
    if (key === "status" && values.includes(STATUS_ALL)) {
      state.status = [];
      continue;
    }
    const valid = values.filter((value) => domain[domainName].has(value));
    state[key] = key === "status" && valid.length === 0 ? structuredClone(DEFAULT_STATE.status) : valid;
    for (const value of values) if (!domain[domainName].has(value)) dropped.push({ key, value });
  }

  const year = (key) => {
    const raw = params.get(key);
    if (raw === null) return null;
    if (/^\d{4}$/.test(raw)) return Number(raw);
    dropped.push({ key, value: raw });
    return null;
  };
  Object.assign(state, normalizeYearRange(year("from"), year("to"), domain.years));

  // Therapeutic areas: one list since phase 4f; links from before carry branch codes under "branch"
  // and EMA's terms under "area" (a term that is a branch or tree node loads as it, so the tree
  // shows one checked row). A value under another selected one is dropped, as toggleArea().
  const above = domain.areaAncestors ?? (() => new Set());
  const canonical = domain.areaCanonical ?? ((value) => [value]);
  const areas = [];
  for (const key of ["area", "branch"]) {
    for (const value of sortedDistinct(params.getAll(key))) {
      if (domain.areas.has(value)) areas.push(...canonical(value));
      else dropped.push({ key, value });
    }
  }
  state.area = sortedDistinct(areas).filter((value) => !areas.some((other) => above(value).has(other)));

  // Companies (companies part 2): group and company keys, and EMA holder names from older links; a
  // value a row stands for loads as that row's (a company shown as its group), and a value within
  // another selected one is dropped, as toggleCompany().
  const mahAbove = domain.mahAncestors ?? (() => new Set());
  const mahCanonical = domain.mahCanonical ?? ((value) => [value]);
  const mahs = [];
  for (const value of sortedDistinct(params.getAll("mah"))) {
    if (domain.mahs.has(value)) mahs.push(...mahCanonical(value));
    else dropped.push({ key: "mah", value });
  }
  state.mah = sortedDistinct(mahs).filter((value) => !mahs.some((other) => mahAbove(value).has(other)));

  // Modalities (M2 phase 2): a modality under a selected group is dropped, as toggleModality().
  const modAbove = domain.modalityAncestors ?? (() => new Set());
  const mods = [];
  for (const value of sortedDistinct(params.getAll("mod"))) {
    if (domain.modalities?.has(value)) mods.push(value);
    else dropped.push({ key: "mod", value });
  }
  state.mod = mods.filter((value) => !mods.some((other) => modAbove(value).has(other)));

  // One value (links from before phase 4a) or several; a value too long for a class name is dropped.
  const atc = params.getAll("atc");
  for (const value of atc.filter((item) => item.trim().length > ATC_QUERY_MAX)) dropped.push({ key: "atc", value });
  state.atc = atcValues(atc.filter((item) => item.trim().length <= ATC_QUERY_MAX));

  return { state, dropped };
}

// A filter patch ({ key: values } of list keys) is set when each of its keys holds exactly those
// values, in any order.
export function patchIsSet(state, patch) {
  return Object.entries(patch).every(([key, values]) =>
    state[key].length === values.length && values.every((value) => state[key].includes(value)));
}

// A control that sets a filter patch clears its keys again when a click finds it exactly set (the
// holder activity card's row and column headers and cells).
export function togglePatch(state, patch) {
  if (!patchIsSet(state, patch)) return patch;
  return Object.fromEntries(Object.keys(patch).map((key) => [key, structuredClone(DEFAULT_STATE[key])]));
}

// A drug class opened from a suggestion, a card ladder or a Try link: the class alone (other
// filters cleared, ATC breakdown on the Classes and areas tab), so the link's href and its click
// agree.
export const classState = (code) => ({ ...structuredClone(DEFAULT_STATE), atc: [code], tab: "classes" });

// A modality opened from a medicine or substance card (M2 phase 2): the overview filtered to it
// alone, broken down by modality (a group's bars are its modalities), on the Classes and areas tab.
export const modalityState = (key) => ({ ...structuredClone(DEFAULT_STATE), mod: [key], by: "mod", tab: "classes" });

// A therapeutic area opened from the intro card (owner decision 2026-09-29): the overview filtered to
// it alone, broken down by therapeutic area (its bars are the areas under it), on the Classes and
// areas tab.
export const areaState = (key) => ({ ...structuredClone(DEFAULT_STATE), area: [key], by: "area", tab: "classes" });

// Lookup keys: free text, EMA product number, substance_key, MeSH descriptor UI, company group or
// company key (companies part 2). Kept verbatim: an unknown value shows a "not found" result
// instead of being dropped.
export const LOOKUP_KEYS = ["q", "med", "sub", "cond", "co"];
export const LOOKUP_QUERY_MAX = 100;
export const DEFAULT_LOOKUP = Object.freeze({ q: "", med: null, sub: null, cond: null, co: null });

export function decodeLookup(params) {
  const value = (key) => params.get(key)?.trim() || null;
  return { q: (value("q") ?? "").slice(0, LOOKUP_QUERY_MAX), med: value("med"), sub: value("sub"), cond: value("cond"), co: value("co") };
}

// The one result the page shows for a lookup state.
export function lookupView({ q, med, sub, cond, co = null }) {
  if (med) return { kind: "medicine", value: med };
  if (sub) return { kind: "substance", value: sub };
  if (cond) return { kind: "condition", value: cond };
  if (co) return { kind: "company", value: co };
  if (q.length >= 2) return { kind: "text", value: q };
  return { kind: null, value: null };
}

// The URL's filter part: without the lookup keys and the ignored keys of earlier versions.
export function withoutLookup(params) {
  const rest = new URLSearchParams(params);
  for (const key of [...LOOKUP_KEYS, ...IGNORED_KEYS]) rest.delete(key);
  return rest;
}

// The verbatim filter part with the filter keys in patch replaced (others kept as they are), for
// filter changes made before the filter domain has loaded (a drug class opened from the search).
export function patchFilterParams(params, patch) {
  const next = new URLSearchParams(params);
  const encoded = encodeState({ ...DEFAULT_STATE, ...patch });
  for (const key of Object.keys(patch).filter((name) => name in DEFAULT_STATE)) {
    next.delete(key);
    for (const value of encoded.getAll(key)) next.append(key, value);
  }
  return next;
}

// Lookup keys first, then the filters. filterParams: the URL's filter part kept verbatim while the
// filter domain is still loading (so a shared link's filters survive the first lookups).
export function encodeUrl(state, filterParams = null) {
  const params = new URLSearchParams();
  for (const key of LOOKUP_KEYS) if (state[key]) params.set(key, state[key]);
  for (const [key, value] of filterParams ?? encodeState(state)) params.append(key, value);
  return params;
}

// At most one history write per animation frame (Chrome silently drops bursts of
// replaceState calls). Filter edits replace the entry; an opened result or drug class pushes one.
let pendingWrite = null;
export function scheduleUrlWrite(state, push = false, filterParams = null) {
  if (pendingWrite) {
    pendingWrite = { state, push: pendingWrite.push || push, filterParams };
    return;
  }
  pendingWrite = { state, push, filterParams };
  requestAnimationFrame(() => {
    const { state: latest, push: shouldPush, filterParams: latestFilters } = pendingWrite;
    pendingWrite = null;
    const query = encodeUrl(latest, latestFilters).toString();
    const search = query ? `?${query}` : "";
    if (search === window.location.search) return;
    const url = `${window.location.pathname}${search}${window.location.hash}`;
    if (shouldPush) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  });
}
