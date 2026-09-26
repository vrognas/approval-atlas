// Filter/view state <-> URL query string. Encode/decode are pure; the writer touches history.

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

// At most one history write per animation frame (Chrome silently drops bursts of
// replaceState calls). Filter edits replace the entry; a tab change pushes one.
let pendingWrite = null;
export function scheduleUrlWrite(state, push = false) {
  if (pendingWrite) {
    pendingWrite = { state, push: pendingWrite.push || push };
    return;
  }
  pendingWrite = { state, push };
  requestAnimationFrame(() => {
    const { state: latest, push: shouldPush } = pendingWrite;
    pendingWrite = null;
    const query = encodeState(latest).toString();
    const search = query ? `?${query}` : "";
    if (search === window.location.search) return;
    const url = `${window.location.pathname}${search}${window.location.hash}`;
    if (shouldPush) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  });
}
