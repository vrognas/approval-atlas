// Pure: the ATC hierarchy — a code's level prefixes, products per prefix, a prefix's children and
// the ladder of one code. No DOM. Names: atc_classes.json code -> name (verbatim; null when missing).
import { ATC_CODE, ATC_PREFIX_LENGTHS } from "./badges.js";

// 1-5 for a valid code, else null.
export function atcLevel(code) {
  return code && ATC_CODE.test(code) ? ATC_PREFIX_LENGTHS.indexOf(code.length) + 1 : null;
}

// "L04AC05" -> L, L04, L04A, L04AC, L04AC05; an incomplete code only its levels; malformed -> [].
export function atcPrefixes(code) {
  if (!atcLevel(code)) return [];
  return ATC_PREFIX_LENGTHS.filter((length) => length <= code.length).map((length) => code.slice(0, length));
}

// products: buildProducts() rows (or any { atc: [{ atc_code_human }] }). A product counts once per
// prefix, however many of its codes share it.
export function atcPrefixCounts(products) {
  const counts = new Map();
  for (const product of products) {
    const prefixes = new Set(product.atc.flatMap((row) => atcPrefixes(row.atc_code_human)));
    for (const prefix of prefixes) counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return counts;
}

// Products per code exactly as published (valid codes only): those whose code stops at an
// incomplete level have no child class below it.
export function atcExactCounts(products) {
  const counts = new Map();
  for (const product of products) {
    for (const code of new Set(product.atc.map((row) => row.atc_code_human))) {
      if (atcLevel(code)) counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return counts;
}

// The classes one level below prefix (level 1 for null) that have products, most first. exact
// (atcExactCounts()): the products coded exactly prefix follow as one row marked incomplete, so
// the rows add up to the prefix; a prefix without children is a leaf and gets none.
export function atcChildren(prefix, counts, names, exact = null) {
  const level = prefix === null ? 0 : atcLevel(prefix);
  if (level === null || level === ATC_PREFIX_LENGTHS.length) return [];
  const length = ATC_PREFIX_LENGTHS[level];
  const children = [...counts]
    .filter(([code, count]) => count > 0 && code.length === length && (prefix === null || code.startsWith(prefix)))
    .map(([code, count]) => ({ code, level: level + 1, name: names.get(code) ?? null, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  const incomplete = prefix === null ? 0 : exact?.get(prefix) ?? 0;
  return children.length && incomplete ? [...children, { code: prefix, level, name: null, count: incomplete, incomplete: true }] : children;
}

// One row per level of code; counts null (not loaded yet) gives null counts.
export function atcLadder(code, counts, names) {
  return atcPrefixes(code).map((prefix, index) => ({
    level: index + 1,
    code: prefix,
    name: names.get(prefix) ?? null,
    count: counts === null ? null : counts.get(prefix) ?? 0,
  }));
}

// medicines: [{ name, codes }] in display order. The code most of them carry (ties: the shorter,
// then the first seen), and for every other code the medicines that carry it but not the main one.
export function mainAtcCode(medicines) {
  const counts = new Map();
  for (const { codes } of medicines) for (const code of new Set(codes)) counts.set(code, (counts.get(code) ?? 0) + 1);
  const [code = null] = [...counts].sort(([a, countA], [b, countB]) => countB - countA || a.length - b.length).map(([candidate]) => candidate);
  const others = new Map();
  for (const medicine of medicines) {
    if (medicine.codes.includes(code)) continue;
    for (const other of new Set(medicine.codes)) {
      if (!others.has(other)) others.set(other, []);
      others.get(other).push(medicine.name);
    }
  }
  return { code, others: [...others].map(([other, names]) => ({ code: other, names })) };
}
