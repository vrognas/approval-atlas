// Filter/view and lookup state <-> URL query string. Encode/decode are pure; the writer touches history.

export const VIEWS = ["now", "years"];
export const BREAKDOWNS = ["atc", "area", "mah"];
// Also the ATC input's maxLength, so typed text always survives the URL; the longest ATC class name is 113.
export const ATC_QUERY_MAX = 120;

export const DEFAULT_STATE = Object.freeze({
  view: "now",
  mah: [],
  from: null, // whole years, inclusive; null = open end
  to: null,
  branch: [],
  area: [],
  atc: "",
  type: [],
  status: [], // empty = all statuses
  by: "atc",
});

// Repeated keys, because MAH names and MeSH terms contain commas. Value = domain set name.
const LIST_KEYS = { mah: "mahs", branch: "branches", area: "areas", type: "types", status: "statuses" };

const sortedDistinct = (values) => [...new Set(values)].sort();

export function encodeState(state) {
  const params = new URLSearchParams();
  const appendAll = (key) => {
    for (const value of sortedDistinct(state[key])) params.append(key, value);
  };
  if (state.view !== DEFAULT_STATE.view) params.set("view", state.view);
  appendAll("mah");
  if (state.from !== null) params.set("from", String(state.from));
  if (state.to !== null) params.set("to", String(state.to));
  appendAll("branch");
  appendAll("area");
  if (state.atc.trim()) params.set("atc", state.atc.trim());
  appendAll("type");
  appendAll("status");
  if (state.by !== DEFAULT_STATE.by) params.set("by", state.by);
  return params;
}

// null = open end, so a bound at the data's first/last year is canonicalized away.
export function normalizeYearRange(from, to, [minYear, maxYear]) {
  const clamp = (year) => (year === null ? null : Math.min(maxYear, Math.max(minYear, year)));
  let [lower, upper] = [clamp(from), clamp(to)];
  if (lower !== null && upper !== null && lower > upper) [lower, upper] = [upper, lower];
  return { from: lower === minYear ? null : lower, to: upper === maxYear ? null : upper };
}

// domain: { mahs, branches, areas, types, statuses: Set, years: [min, max] }.
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
  state.view = oneOf("view", VIEWS);
  state.by = oneOf("by", BREAKDOWNS);

  for (const [key, domainName] of Object.entries(LIST_KEYS)) {
    const values = sortedDistinct(params.getAll(key));
    state[key] = values.filter((value) => domain[domainName].has(value));
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

  const atc = (params.get("atc") ?? "").trim();
  if (atc.length > ATC_QUERY_MAX) dropped.push({ key: "atc", value: atc });
  else state.atc = atc;

  return { state, dropped };
}

// A drug class opened from a suggestion, a card ladder or a Try link: the class alone (other
// filters cleared, view "now", ATC breakdown), so the link's href and its click agree.
export const classState = (code) => ({ ...structuredClone(DEFAULT_STATE), atc: code });

// Lookup keys: free text, EMA product number, substance_key, MeSH descriptor UI. Kept verbatim:
// an unknown value shows a "not found" result instead of being dropped.
export const LOOKUP_KEYS = ["q", "med", "sub", "cond"];
export const LOOKUP_QUERY_MAX = 100;
export const DEFAULT_LOOKUP = Object.freeze({ q: "", med: null, sub: null, cond: null });

export function decodeLookup(params) {
  const value = (key) => params.get(key)?.trim() || null;
  return { q: (value("q") ?? "").slice(0, LOOKUP_QUERY_MAX), med: value("med"), sub: value("sub"), cond: value("cond") };
}

// The one result the page shows for a lookup state.
export function lookupView({ q, med, sub, cond }) {
  if (med) return { kind: "medicine", value: med };
  if (sub) return { kind: "substance", value: sub };
  if (cond) return { kind: "condition", value: cond };
  if (q.length >= 2) return { kind: "text", value: q };
  return { kind: null, value: null };
}

export function withoutLookup(params) {
  const rest = new URLSearchParams(params);
  for (const key of LOOKUP_KEYS) rest.delete(key);
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
// replaceState calls). Filter edits replace the entry; a tab change or opened result pushes one.
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
