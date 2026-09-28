// Pure: one predicate per filter dimension, so a chart can apply every filter except its own.
// Products come from buildProducts() in approvals.js.
import { atcCode, atcPrefixes } from "./atc.js";
import { ATC_CODE } from "./badges.js";

// "L01" / "l01fa" -> code prefix; anything else -> case-insensitive name search.
export function parseAtcQuery(query) {
  const trimmed = query.trim();
  if (ATC_CODE.test(trimmed.toUpperCase())) return { kind: "code", value: trimmed.toUpperCase() };
  return trimmed ? { kind: "name", value: trimmed.toLowerCase() } : { kind: "none" };
}

// An ATC selection (state.atc) split into its codes (upper case) and class-name queries (as given,
// trimmed; older links); blank values are left out.
export function splitAtcValues(values) {
  const codes = [];
  const names = [];
  for (const value of values) {
    const parsed = parseAtcQuery(value);
    if (parsed.kind === "code") codes.push(parsed.value);
    else if (parsed.kind === "name") names.push(value.trim());
  }
  return { codes, names };
}

// Any selected class (a code prefix, or a class whose name matches a query) matches: OR. A product
// code (atcCode(): the code to use) is in a class when one of its levels (atcPrefixes()) is that
// class, so a malformed code (EMA's LX1XX02) is in none, as in the tree and breakdown counts
// (atcPrefixCounts()).
function atcPredicate(values, atcClasses) {
  const { codes, names } = splitAtcValues(values);
  if (!codes.length && !names.length) return null;
  const needles = names.map((name) => name.toLowerCase());
  const selected = new Set([
    ...codes,
    ...atcClasses.filter((row) => needles.some((needle) => row.name?.toLowerCase().includes(needle))).map((row) => row.atc_code),
  ]);
  return (product) => product.atc.some((row) => atcPrefixes(atcCode(row)).some((prefix) => selected.has(prefix)));
}

export function makePredicates(state, atcClasses) {
  const predicates = {};
  const inSet = (values) => new Set(values);
  if (state.mah.length) {
    const selected = inSet(state.mah);
    predicates.mah = (product) => selected.has(product.mah);
  }
  if (state.from !== null || state.to !== null) {
    const from = state.from ?? -Infinity;
    const to = state.to ?? Infinity;
    predicates.date = (product) => product.year !== null && product.year >= from && product.year <= to;
  }
  // Therapeutic areas (phase 4f): branch codes, tree numbers and EMA's terms, each matching the
  // products tagged with it or with a term under it (product.areaKeys: areas.js keysOf()).
  if (state.area.length) {
    const selected = inSet(state.area);
    predicates.area = (product) => product.areaKeys.some((key) => selected.has(key));
  }
  const atc = atcPredicate(state.atc, atcClasses);
  if (atc) predicates.atc = atc;
  if (state.type.length) {
    const selected = inSet(state.type);
    predicates.type = (product) => selected.has(product.medicine_type);
  }
  if (state.status.length) {
    const selected = inSet(state.status);
    predicates.status = (product) => selected.has(product.medicine_status);
  }
  return predicates;
}

export function filterProducts(products, predicates, except = null) {
  const active = Object.entries(predicates)
    .filter(([dimension]) => dimension !== except)
    .map(([, predicate]) => predicate);
  return products.filter((product) => active.every((predicate) => predicate(product)));
}
