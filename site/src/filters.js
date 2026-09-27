// Pure: one predicate per filter dimension, so a chart can apply every filter except its own.
// Products come from buildProducts() in approvals.js.
import { ATC_CODE, ATC_PREFIX_LENGTHS } from "./badges.js";

// "L01" / "l01fa" -> code prefix; anything else -> case-insensitive name search.
export function parseAtcQuery(query) {
  const trimmed = query.trim();
  if (ATC_CODE.test(trimmed.toUpperCase())) return { kind: "code", value: trimmed.toUpperCase() };
  return trimmed ? { kind: "name", value: trimmed.toLowerCase() } : { kind: "none" };
}

// A product code "starts with" a class code exactly when one of its level-length prefixes equals it.
function matchesAnyClass(code, classCodes) {
  return ATC_PREFIX_LENGTHS.some((length) => length <= code.length && classCodes.has(code.slice(0, length)));
}

function atcPredicate(query, atcClasses) {
  const parsed = parseAtcQuery(query);
  if (parsed.kind === "code") {
    return (product) => product.atc.some((row) => row.atc_code_human.startsWith(parsed.value));
  }
  if (parsed.kind === "name") {
    const classCodes = new Set(
      atcClasses.filter((row) => row.name?.toLowerCase().includes(parsed.value)).map((row) => row.atc_code),
    );
    return (product) => product.atc.some((row) => matchesAnyClass(row.atc_code_human, classCodes));
  }
  return null;
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
  if (state.branch.length) {
    const selected = inSet(state.branch);
    predicates.branch = (product) => product.branches.some((branch) => selected.has(branch));
  }
  if (state.area.length) {
    const selected = inSet(state.area);
    predicates.area = (product) => product.areas.some((area) => selected.has(area));
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
