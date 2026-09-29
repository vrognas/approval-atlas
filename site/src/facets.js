// Pure: counts for the facet sidebar and sheets, the approval-years strip, the filter sentence's
// tokens, the most common conditions and the holder activity of the filtered medicines. No DOM.
// Products come from buildProducts(); every status counts (one dashboard, phase 4a).
import { byStatusOrder } from "./approvals.js";
import { filterProducts, parseAtcQuery } from "./filters.js";
import { UI, atcClassLabel, statusLabel } from "./labels.js";

// Stack order of the medicine types (bars left to right, legends, facet rows).
export const TYPE_ORDER = ["Other", "Generic", "Biosimilar", "Advanced therapy"];

// A product's values in each facet dimension (the predicate keys of makePredicates()).
export const FACET_VALUES = {
  type: (product) => [product.medicine_type],
  status: (product) => [product.medicine_status],
  // The therapeutic area tree (phase 4f): every branch, node and term a medicine touches.
  area: (product) => product.areaKeys,
  // The modality tree (M2 phase 2): every group and modality of a medicine's substances.
  mod: (product) => product.modalityKeys,
  date: (product) => (product.year === null ? [] : [product.year]),
};

// "Approvals per year" stacked by child ATC classes, modality groups or a group's modalities: the
// damped hues' mids in this order, neighbouring hues far apart (1px gaps separate the segments too;
// palette.test.js).
export const STACK_HUES = ["blue", "gold", "teal", "red", "indigo", "olive", "pink", "sky"];

// key -> products, each product once per distinct key (keysOf(product): its keys).
export function keyCounts(products, keysOf) {
  const counts = new Map();
  for (const product of products) {
    for (const key of new Set(keysOf(product))) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// The n keys with the most products (ties by key).
export function topKeys(counts, n = Infinity) {
  return [...counts].sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b)).slice(0, n).map(([key]) => key);
}

// Products per value of one dimension: every filter applies except that dimension's own; a
// product counts once per distinct value (valuesOf: FACET_VALUES entry).
export function facetCounts(products, predicates, dimension, valuesOf) {
  return keyCounts(filterProducts(products, predicates, dimension), valuesOf);
}

// The approval-years strip's histogram: products per approval year by the facet rule (every
// filter but the year filter), one row per year of [first, last] (the status stacks are the
// per-year chart's, Stack by Status).
export function yearHistogram(products, predicates, [first, last]) {
  const byYear = keyCounts(filterProducts(products, predicates, "date"), FACET_VALUES.date);
  const rows = [];
  for (let year = first; year <= last; year++) rows.push({ year, count: byYear.get(year) ?? 0 });
  return rows;
}

// The stack key of every key beyond the top ones (topWithOther()).
export const OTHER_KEY = "__other__";

// The n keys with the most products (topKeys()), then OTHER_KEY when any product has another key;
// keysOf maps those other keys to OTHER_KEY.
export function topWithOther(products, keysOf, n) {
  const counts = keyCounts(products, keysOf);
  const top = topKeys(counts, n);
  const shown = new Set(top);
  return {
    keys: counts.size > top.length ? [...top, OTHER_KEY] : top,
    keysOf: (product) => keysOf(product).map((key) => (shown.has(key) ? key : OTHER_KEY)),
  };
}

// The stack key of the dated products a mode cannot place (withUnplaced()).
export const UNPLACED_KEY = "__unplaced__";

// Every dated product in the stacks (user decision 2026-09-28: every mode gives the same yearly
// totals): a product without a key (no ATC code, coded only as the class shown, no company) gets
// UNPLACED_KEY. any: whether a dated product has none, so the segment shows only when needed.
export function withUnplaced(products, keysOf) {
  return {
    any: products.some((product) => product.year !== null && keysOf(product).length === 0),
    keysOf: (product) => {
      const keys = keysOf(product);
      return keys.length ? keys : [UNPLACED_KEY];
    },
  };
}

// "Approvals per year": the products with an approval date per year of [first, last] (zeros
// included), each counted once in every stack key it has (keysOf(product): its keys, e.g. its
// medicine type, ATC classes or holder) and not at all without one (withUnplaced() gives them one).
// Rows: { year (a string, the chart's band domain), total: the products counted, counts: key ->
// products }.
export function yearStacks(products, keysOf, [first, last]) {
  const byYear = new Map();
  for (const product of products) {
    const keys = new Set(product.year === null ? [] : keysOf(product));
    if (keys.size === 0) continue;
    if (!byYear.has(product.year)) byYear.set(product.year, { total: 0, counts: new Map() });
    const row = byYear.get(product.year);
    row.total += 1;
    for (const key of keys) row.counts.set(key, (row.counts.get(key) ?? 0) + 1);
  }
  const rows = [];
  for (let year = first; year <= last; year++) rows.push({ year: String(year), ...(byYear.get(year) ?? { total: 0, counts: new Map() }) });
  return rows;
}

// Products per current status, most first (ties in stack order): the headline dek's breakdown.
export function statusBreakdown(products) {
  return [...keyCounts(products, FACET_VALUES.status)]
    .sort(([a, countA], [b, countB]) => countB - countA || byStatusOrder(a, b))
    .map(([status, count]) => ({ status, count }));
}

// "Who is active where": the n holders with the most products (ties by label), each with its
// products per key (cells: key -> count; keysOf(product): its columns, a product counts once per
// distinct key and can count in several) and its products (members). holderOf(product): its row
// key (companies part 2: its company group; null: in no row), labelOf(key): the row's name.
export function holderActivity(products, keysOf, n = 15, holderOf = (product) => product.mah, labelOf = (key) => key) {
  const byHolder = new Map();
  for (const product of products) {
    const key = holderOf(product);
    if (key === null) continue;
    if (!byHolder.has(key)) byHolder.set(key, []);
    byHolder.get(key).push(product);
  }
  return [...byHolder]
    .map(([key, members]) => ({ key, label: labelOf(key), count: members.length, cells: keyCounts(members, keysOf), members }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, n);
}

// A sort's first direction: names and codes ("name", "key") A-Z, "asc"; counts ("total", "count",
// a column key) most first, "desc".
export function defaultSortDirection(key) {
  return key === "name" || key === "key" ? "asc" : "desc";
}

// The sort after a click on a sort control (key): the one in force (current: { key, direction })
// reverses, another starts in its first direction.
export function nextSort(current, key) {
  if (current.key === key) return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  return { key, direction: defaultSortDirection(key) };
}

// Holder rows (holderActivity() output) in the chosen order: "total" (most products first, ties by
// name), "name" (A-Z) or a column key (most in that column first, ties by total, then name);
// direction reverses the order but not the ties ("asc": fewest first, "desc" for names: Z-A).
export function sortActivityRows(rows, sort, direction = defaultSortDirection(sort)) {
  const sign = direction === "asc" ? 1 : -1;
  const byName = (a, b) => a.label.localeCompare(b.label);
  const byTotal = (a, b) => b.count - a.count || byName(a, b);
  const compare = {
    name: (a, b) => sign * byName(a, b),
    total: (a, b) => sign * (a.count - b.count) || byName(a, b),
  }[sort] ?? ((a, b) => sign * ((a.cells.get(sort) ?? 0) - (b.cells.get(sort) ?? 0)) || byTotal(a, b));
  return [...rows].sort(compare);
}

// Activity columns ({ key, label, other }) in the chosen order: "key" (ATC groups by code, therapeutic
// areas by name; by: "atc" | "area") or "count" (most products first, counts: key -> products, ties
// by key); direction reverses the order but not the ties. The Other column stays last.
export function orderActivityColumns(columns, counts, order, by, direction = defaultSortDirection(order)) {
  const sign = direction === "asc" ? 1 : -1;
  const byKey = by === "atc" ? (a, b) => a.key.localeCompare(b.key) : (a, b) => a.label.localeCompare(b.label);
  const byCount = (a, b) => sign * ((counts.get(a.key) ?? 0) - (counts.get(b.key) ?? 0)) || a.key.localeCompare(b.key);
  return [
    ...columns.filter((column) => !column.other).sort(order === "count" ? byCount : (a, b) => sign * byKey(a, b)),
    ...columns.filter((column) => column.other),
  ];
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

// One selected ATC value: a class ("L04AC Interleukin Inhibitors"; the code alone when short, as
// two classes read "C and H03") or a class-name query.
function atcValueText(value, atcNames, short) {
  const query = parseAtcQuery(value);
  if (query.kind !== "code") return UI.sentence.atcName(value.trim());
  return short ? query.value : atcClassLabel(query.value, atcNames.get(query.value));
}

// One sentence token's text: the default phrase, or the selection. lookups: { years: [min, max],
// areaNames (therapeutic area tree key -> name; areas.js labels: a root tag "tagged Neoplasms"),
// atcNames: Map, mahName(value): a company group's or company's name (companies part 2; EMA holder
// names as they are), mahSelection(values): the name of several values that are one company's
// rows (a company under two groups), or null; modalityNames: modality key -> name (null or left
// out: the modality data has not loaded, and the sentence has no modality token) }.
export function tokenLabel(dimension, state, { years, areaNames, atcNames, mahName = (value) => value, mahSelection = () => null, modalityNames = null }) {
  const copy = UI.sentence;
  if (dimension === "from") return String(state.from ?? years[0]);
  if (dimension === "to") return String(state.to ?? years[1]);
  const values = state[dimension];
  if (values.length === 0) return copy.defaults[dimension];
  if (dimension === "atc" && values.length === 2) return values.map((value) => atcValueText(value, atcNames, true)).join(copy.words.and);
  if (dimension === "mah" && values.length > 1 && mahSelection(values)) return mahSelection(values);
  if (values.length > 1) return copy.many[dimension](values.length);
  if (dimension === "atc") return atcValueText(values[0], atcNames, false);
  if (dimension === "area") return areaNames.get(values[0]) ?? values[0];
  if (dimension === "status") return copy.status(statusLabel(values[0]));
  if (dimension === "mah") return mahName(values[0]);
  if (dimension === "mod") return modalityNames?.get(values[0]) ?? values[0];
  return values[0];
}

function isActive(key, state) {
  if (key === "from" || key === "to") return state[key] !== null;
  return state[key].length > 0;
}

// "Showing [all medicine types] with [all modalities] in [all ATC classes] from [all holders] in
// [all therapeutic areas], approved [1995]–[2026], with [any status]." as strings and tokens { key,
// text, active, clears: the state keys its remove button (or Clear) resets }; the modality token
// only once the modality data has loaded (lookups.modalityNames). The type token naming one type also has tip: that type
// when it has an explanation (UI.typeTips), else null; so has the status token naming one status
// (UI.statusTips) and the modality token naming one modality (its key). Two ATC classes are two tokens ("[C] and
// [H03]") with value: the one class their remove button removes; more are one token. One
// approval year (a year bar clicked) is one token, "approved in [2024]", clearing both ends.
export function sentenceParts(state, lookups) {
  const words = UI.sentence.words;
  const [onlyType] = state.type.length === 1 ? state.type : [];
  const token = (key) => ({ key, text: tokenLabel(key, state, lookups), active: isActive(key, state), clears: [key] });
  const typeToken = { ...token("type"), tip: UI.typeTips[onlyType] ? onlyType : null };
  const [onlyStatus] = state.status.length === 1 ? state.status : [];
  const statusToken = { ...token("status"), tip: UI.statusTips[onlyStatus] ? onlyStatus : null };
  const [onlyModality] = state.mod.length === 1 ? state.mod : [];
  const modality = lookups.modalityNames
    ? [words.withModality, { ...token("mod"), tip: UI.modalityTips[onlyModality] ? onlyModality : null }]
    : [];
  const joined = (tokens) => tokens.flatMap((part, index) => (index ? [words.and, part] : [part]));
  const atc = state.atc.length === 2
    ? joined(state.atc.map((value) => ({ key: "atc", text: atcValueText(value, lookups.atcNames, true), active: true, clears: ["atc"], value })))
    : [token("atc")];
  // Without a year filter, every medicine counts, the never approved too: "approved in [any year]"
  // (phase 4c review; a year range there read as if they were left out). A range leaves them out,
  // and says so.
  const from = tokenLabel("from", state, lookups);
  const ranged = state.from !== null || state.to !== null;
  const oneYear = ranged && from === tokenLabel("to", state, lookups);
  let years = [words.approvedIn, { key: "years", text: UI.sentence.anyYear, active: false, clears: ["from", "to"] }];
  if (oneYear) years = [words.approvedIn, { key: "year", text: from, active: true, clears: ["from", "to"] }, words.undatedOut];
  else if (ranged) years = [words.approved, token("from"), words.to, token("to"), words.undatedOut];
  return [
    words.showing, typeToken, ...modality, words.in, ...atc, words.from, token("mah"), words.in, token("area"),
    ...years, words.with, statusToken, words.end,
  ];
}

// The n therapeutic areas with the most products (ties by term), each with how many of them have
// EMA status Authorised (the condition page lists those first); descriptorOf: EMA term -> MeSH
// descriptor UI, so a term can open its condition lookup (null when unknown). within(term): only
// the terms within the therapeutic area filter (phase 4f; areas.js inAreas()), or null for all.
// setKeyOf(product): its substance set (step 4, #10: equivalent spellings joined), when given each
// row also counts the distinct sets of its authorized medicines (substances).
export function topAreas(products, descriptorOf, n = 8, within = null, setKeyOf = null) {
  const termsOf = (product) => (within ? product.areas.filter(within) : product.areas);
  const counts = keyCounts(products, termsOf);
  const authorizedProducts = products.filter((product) => product.medicine_status === "Authorised");
  const authorized = keyCounts(authorizedProducts, termsOf);
  const sets = new Map();
  if (setKeyOf) {
    for (const product of authorizedProducts) {
      const key = setKeyOf(product);
      if (key === null) continue;
      for (const term of termsOf(product)) {
        if (!sets.has(term)) sets.set(term, new Set());
        sets.get(term).add(key);
      }
    }
  }
  return [...counts]
    .sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b))
    .slice(0, n)
    .map(([term, count]) => ({
      term,
      count,
      authorized: authorized.get(term) ?? 0,
      ...(setKeyOf ? { substances: sets.get(term)?.size ?? 0 } : {}),
      descriptorUi: descriptorOf.get(term) ?? null,
    }));
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
