// Pure: counts for the facet sidebar and sheets, the filter sentence's tokens and the most
// common conditions of a filtered view. No DOM. Products come from buildProducts().
import { isAuthorizedNow } from "./approvals.js";
import { filterProducts, parseAtcQuery } from "./filters.js";
import { UI, atcClassLabel, statusLabel } from "./labels.js";

// Stack order of the medicine types (bars left to right, legends, facet rows).
export const TYPE_ORDER = ["Other", "Generic", "Biosimilar", "Advanced therapy"];

// A product's values in each facet dimension (the predicate keys of makePredicates()).
export const FACET_VALUES = {
  type: (product) => [product.medicine_type],
  status: (product) => [product.medicine_status],
  mah: (product) => [product.mah],
  branch: (product) => product.branches,
  area: (product) => product.areas,
  date: (product) => (product.year === null ? [] : [product.year]),
};

const everyProduct = () => true;
const isDated = (product) => product.year !== null;

// The products a facet counts. Authorized now: the authorized-now products (the view's own),
// except Status, which counts every status (it could only ever show Authorized otherwise).
// Approvals per year: the products with an approval date, as the per-year table, for every facet.
export function facetPopulation(view, dimension) {
  if (view === "years") return isDated;
  return dimension === "status" ? everyProduct : isAuthorizedNow;
}

// Products per value of one dimension: every filter applies except that dimension's own, then
// the population; a product counts once per distinct value (valuesOf: FACET_VALUES entry).
export function facetCounts(products, predicates, dimension, valuesOf, population) {
  const counts = new Map();
  for (const product of filterProducts(products, predicates, dimension)) {
    if (!population(product)) continue;
    for (const value of new Set(valuesOf(product))) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

// The approval-years strip's histogram: products per approval year by the facet rule (every
// filter but the year filter, the view's population), one row per year of [first, last].
export function yearHistogram(products, predicates, view, [first, last]) {
  const counts = facetCounts(products, predicates, "date", FACET_VALUES.date, facetPopulation(view, "date"));
  const rows = [];
  for (let year = first; year <= last; year++) rows.push({ year, count: counts.get(year) ?? 0 });
  return rows;
}

// Checkbox rows: values with products, most first (ties by label), matching the query. Selected
// values are always listed (count 0 included), first when pinned; so are kept ones (keep: values
// just unchecked, so the row and its focus stay). limit: how many other rows to show. total: the
// rows matching the query, shown or not; hidden: those not shown.
export function facetRows(counts, selected, { labelOf, query = "", limit = Infinity, pin = false, keep = [] }) {
  const chosen = new Set(selected);
  const kept = new Set(keep);
  const needle = query.trim().toLowerCase();
  const all = [...new Set([...counts.keys(), ...chosen, ...kept])]
    .map((value) => ({ value, label: labelOf(value), count: counts.get(value) ?? 0, selected: chosen.has(value) }))
    .filter((row) => row.selected || kept.has(row.value) || row.count > 0)
    .sort((a, b) => (pin ? b.selected - a.selected : 0) || b.count - a.count || a.label.localeCompare(b.label));
  const matching = all.filter((row) => row.label.toLowerCase().includes(needle));
  const shown = new Set(matching.filter((row) => !row.selected).slice(0, limit));
  const listed = (row) => row.selected || kept.has(row.value) || shown.has(row);
  return {
    rows: all.filter(listed),
    total: matching.length,
    hidden: matching.filter((row) => !listed(row)).length,
  };
}

// One sentence token's text: the default phrase, or the selection. lookups: { years: [min, max],
// branchNames, atcNames: Map }.
export function tokenLabel(dimension, state, { years, branchNames, atcNames }) {
  const copy = UI.sentence;
  if (dimension === "from") return String(state.from ?? years[0]);
  if (dimension === "to") return String(state.to ?? years[1]);
  if (dimension === "atc") {
    const query = parseAtcQuery(state.atc);
    if (query.kind === "code") return atcClassLabel(query.value, atcNames.get(query.value));
    return query.kind === "name" ? copy.atcName(state.atc.trim()) : copy.defaults.atc;
  }
  const values = state[dimension];
  if (values.length === 0) return copy.defaults[dimension];
  if (values.length > 1) return copy.many[dimension](values.length);
  if (dimension === "branch") return branchNames.get(values[0]) ?? values[0];
  if (dimension === "status") return copy.status(statusLabel(values[0]));
  return values[0];
}

function isActive(key, state) {
  if (key === "from" || key === "to") return state[key] !== null;
  if (key === "atc") return state.atc.trim() !== "";
  return state[key].length > 0;
}

// "Showing [all medicine types] in [all ATC classes] from [all holders] in [all therapeutic
// areas], approved [1995]–[2026], with [any status]." as strings and tokens { key, text, active,
// clears: the state keys its remove button (or Clear) resets }. Therapeutic area groups and areas
// share one token until either is set.
export function sentenceParts(state, lookups) {
  const words = UI.sentence.words;
  const token = (key) => ({ key, text: tokenLabel(key, state, lookups), active: isActive(key, state), clears: [key] });
  const areaTokens = ["branch", "area"].filter((key) => isActive(key, state)).map(token);
  const areas = areaTokens.length
    ? areaTokens.flatMap((part, index) => (index ? [words.and, part] : [part]))
    : [{ key: "areas", text: UI.sentence.defaults.area, active: false, clears: ["branch", "area"] }];
  return [
    words.showing, token("type"), words.in, token("atc"), words.from, token("mah"), words.in, ...areas,
    words.approved, token("from"), words.to, token("to"), words.with, token("status"), words.end,
  ];
}

// The n therapeutic areas with the most products (ties by term); descriptorOf: EMA term -> MeSH
// descriptor UI, so a term can open its condition lookup (null when unknown).
export function topAreas(products, descriptorOf, n = 8) {
  const counts = new Map();
  for (const product of products) {
    for (const term of new Set(product.areas)) counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts]
    .sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b))
    .slice(0, n)
    .map(([term, count]) => ({ term, count, descriptorUi: descriptorOf.get(term) ?? null }));
}

// key -> (medicine type -> products), each product once per distinct key (keysOf(product)).
export function typeSplit(products, keysOf) {
  const split = new Map();
  for (const product of products) {
    for (const key of new Set(keysOf(product))) {
      if (!split.has(key)) split.set(key, new Map());
      const types = split.get(key);
      types.set(product.medicine_type, (types.get(product.medicine_type) ?? 0) + 1);
    }
  }
  return split;
}
