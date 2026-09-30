// Pure: the ATC hierarchy — a code's level prefixes, products per prefix, a prefix's children and
// the ladder of one code. No DOM. Names: atc_classes.json code -> name (verbatim; null when missing).
import { ATC_CODE, ATC_PREFIX_LENGTHS } from "./badges.js";
import { UI, atcClassLabel, atcOriginText } from "./labels.js";

// 1-5 for a valid code, else null.
export function atcLevel(code) {
  return code && ATC_CODE.test(code) ? ATC_PREFIX_LENGTHS.indexOf(code.length) + 1 : null;
}

// "L04AC05" -> L, L04, L04A, L04AC, L04AC05; an incomplete code only its levels; malformed -> [].
export function atcPrefixes(code) {
  if (!atcLevel(code)) return [];
  return ATC_PREFIX_LENGTHS.filter((length) => length <= code.length).map((length) => code.slice(0, length));
}

// The code the site groups, filters and shows an ATC row (ema_medicine_atc_codes.json) by, as the
// data contract says: the code WHO moved a retired one to, else the code to use (EMA's, or completed
// from the product information), else EMA's as published (data files from before phase 4b); null
// when there is none. A product without an EMA code has atc_code_human null.
export function atcCode(row) {
  return row.current_atc_code ?? row.atc_code ?? row.atc_code_human ?? null;
}

// A curated code's evidence (phase 4e: the ATC/DDD Index page, WHO's temporary list or the product
// information PDF, atc_code_document_url), by its URL.
const CURATED_EVIDENCE = [
  ["whocc_temporary", /^https:\/\/atcddd\.fhi\.no\/.*temporary/],
  ["whocc_index", /^https:\/\/atcddd\.fhi\.no\/atc_ddd_index\//],
  ["ema_smpc_text", /^https:\/\/www\.ema\.europa\.eu\/.*\.pdf(-\d+)?$/i],
];

// How the code shown (atcCode()) differs from EMA's published one, or null: "retired" (from: the
// code WHO retired, now: its current code), "completed" / "conflict" (published: EMA's incomplete
// code, which the product information completes or contradicts), "smpc" (EMA publishes none),
// "curated" (phase 4e: checked by hand; published: EMA's code or null, conflict, evidence:
// "whocc_index" | "whocc_temporary" | "ema_smpc_text" | null, url: the evidence).
export function atcOrigin(row) {
  const code = atcCode(row);
  if (code === null || code === row.atc_code_human) return null;
  if (row.current_atc_code) return { kind: "retired", from: row.atc_code ?? row.atc_code_human, now: row.current_atc_code };
  if (row.atc_code_source === "curated") {
    const url = row.atc_code_document_url ?? null;
    const [evidence = null] = CURATED_EVIDENCE.find(([, pattern]) => url !== null && pattern.test(url)) ?? [];
    return { kind: "curated", published: row.atc_code_human ?? null, conflict: Boolean(row.atc_code_conflict), evidence, url };
  }
  if (row.atc_code_human === null) return { kind: "smpc" };
  return { kind: row.atc_code_conflict ? "conflict" : "completed", published: row.atc_code_human };
}

// Not a valid level-5 code: fewer levels, or malformed (EMA's "LX1XX02").
export const atcIncomplete = (code) => atcLevel(code) !== ATC_PREFIX_LENGTHS.length;

// Whether the code a row shows (atcCode()) is incomplete: the data's atc_final_level (phase 4e: a
// level-4 code WHO does not subdivide, B03AC, or moved a code up to, J07BX03 -> J07BN, is
// complete), else (older data files) not a level-5 code.
export const atcRowIncomplete = (row) => (typeof row.atc_final_level === "boolean" ? !row.atc_final_level : atcIncomplete(atcCode(row)));

// "L01FA01" -> "{code} {Title Case name}" for each of its levels WHO names (names: code -> name),
// top first; a level without a name left out.
export function atcLevelNames(code, names) {
  return atcPrefixes(code).filter((prefix) => names.has(prefix)).map((prefix) => atcClassLabel(prefix, names.get(prefix)));
}

// The ATC class explanations (atc_class_explanations.json; owner decisions 2026-09-29): our own
// plain-language summaries of the classes at levels 1-4 the data uses, each generic to its WHO
// class. rows (null: the file is missing, older data) -> code -> explanation.
export function buildAtcExplanations(rows) {
  return new Map((rows ?? []).map((row) => [row.atc_code, row.explanation]));
}

const NO_EXPLANATIONS = new Map();

// A class's explanation (explanations: buildAtcExplanations()), or null: none for level 5 (its
// substance's name says what it is) or a class without one.
export function atcExplanation(code, explanations = NO_EXPLANATIONS) {
  const level = atcLevel(code);
  return level && level < ATC_PREFIX_LENGTHS.length ? explanations.get(code) ?? null : null;
}

// A tip led by a class's explanation, on a line of its own (the carrier keeps line breaks: class
// tip-lines, or the facet tree's and breakdown's rows); text alone without one. Each explanation
// ends with a period, so the two read apart as one description too (aria-describedby).
export const explainedTip = (explanation, text) => (explanation ? `${explanation}\n${text}` : text);

// An ATC badge's explainer, the same in the medicines table and the result tables (owner feedback
// 2026-09-29: a data-tip as the type badges', no longer a native title), one line each: the
// explanation of the code's deepest class at levels 1-4 (a level-5 code's level-4 class; owner
// decisions 2026-09-29: one tip per badge, as its segments are all one carrier), the code's level
// names, why it is incomplete, how it differs from EMA's published code (atcOriginText(); years:
// retired code -> the year WHO retired it), then its source (atc_code_source; older data files: the
// row's source). explanations: buildAtcExplanations() (none: as before).
export function atcBadgeTip(row, names, years, explanations = NO_EXPLANATIONS) {
  const lines = atcLevelNames(atcCode(row), names);
  if (atcRowIncomplete(row)) lines.push(UI.table.incompleteTitle);
  const origin = atcOriginText(atcOrigin(row), names, years);
  if (origin) lines.push(origin);
  const deepest = atcPrefixes(atcCode(row)).filter((prefix) => atcLevel(prefix) < ATC_PREFIX_LENGTHS.length).at(-1) ?? null;
  return explainedTip(atcExplanation(deepest, explanations), [...lines, UI.table.source(row.atc_code_source ?? row.source)].join("\n"));
}

// An ATC tree row's explainer (owner feedback 2026-09-29): the class's explanation (levels 1-4,
// where there is one), then on a line of its own its level and what WHO calls that level (not
// the class's code and name: the row or bar carrying the tip shows them; owner feedback
// 2026-10-01), the class above it by its code only (owner decision 2026-09-29: shorter tips; the tree
// shows its name), and whether WHO retired it (and what replaced it) or lists it as temporary.
// classes: code -> atc_classes.json row ({ name, status, replaced_by, changed_year });
// explanations: buildAtcExplanations(). Null for a malformed code. Also the ATC breakdown's bars.
export function atcClassTip(code, classes, explanations = NO_EXPLANATIONS) {
  const level = atcLevel(code);
  if (!level) return null;
  const parent = atcPrefixes(code).at(-2) ?? null;
  const tip = UI.atc.classTip(level, parent);
  const entry = classes.get(code);
  const status = entry?.status === "retired" ? UI.atc.retired(entry.changed_year ?? null, entry.replaced_by ?? null)
    : entry?.status === "temporary" ? UI.atc.temporary : null;
  return explainedTip(atcExplanation(code, explanations), status ? `${tip} ${status}` : tip);
}

// The valid codes some product is coded at exactly with an incomplete code (atcRowIncomplete()):
// the tree's and breakdown's static row there reads "code incomplete", else "coded at this level".
export function atcIncompleteAt(products) {
  const codes = new Set();
  for (const product of products) {
    for (const row of product.atc) if (atcLevel(atcCode(row)) && atcRowIncomplete(row)) codes.add(atcCode(row));
  }
  return codes;
}

// products: buildProducts() rows (or any { atc: [rows] }, codes by atcCode()). A product counts once
// per prefix, however many of its codes share it.
export function atcPrefixCounts(products) {
  const counts = new Map();
  for (const product of products) {
    const prefixes = new Set(product.atc.flatMap((row) => atcPrefixes(atcCode(row))));
    for (const prefix of prefixes) counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return counts;
}

// Products per code exactly (valid codes only): those whose code stops at an incomplete level have
// no child class below it.
export function atcExactCounts(products) {
  const counts = new Map();
  for (const product of products) {
    for (const code of new Set(product.atc.map(atcCode))) {
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

// A product's classes one level below parent (level 1 for null), one per code under parent (so a
// class can repeat); a code that stops at parent has none, a level-5 parent is its own class.
export function atcClassesAt(product, parent) {
  const depth = parent === null ? 0 : atcLevel(parent);
  return product.atc
    .map((row) => atcPrefixes(atcCode(row)))
    .filter((prefixes) => parent === null || prefixes.includes(parent))
    .map((prefixes) => prefixes[depth] ?? (depth === ATC_PREFIX_LENGTHS.length ? parent : null))
    .filter(Boolean);
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

// A class strictly under another: for valid ATC codes, a longer code with the other as its start.
const isUnder = (code, ancestor) => code.length > ancestor.length && code.startsWith(ancestor);

// The ATC selection (state.atc) after one class is toggled: a selected class is removed; otherwise
// it is added in place of the selected classes it covers or is covered by, so no selected class
// covers another. Class-name queries (older links) stay.
export function toggleAtcCode(selected, code) {
  if (selected.includes(code)) return selected.filter((value) => value !== code);
  const covering = (value) => ATC_CODE.test(value) && (isUnder(value, code) || isUnder(code, value));
  return [...selected.filter((value) => !covering(value)), code];
}

// A tree node's checkbox against the selected codes: "checked", "included" (under a checked
// class: shown checked and disabled), "mixed" (a class under it is checked) or "unchecked".
export function atcCheckState(code, selectedCodes) {
  if (selectedCodes.includes(code)) return "checked";
  if (selectedCodes.some((selected) => isUnder(code, selected))) return "included";
  if (selectedCodes.some((selected) => isUnder(selected, code))) return "mixed";
  return "unchecked";
}

// The ATC tree's nodes: every class with products (counts: atcPrefixCounts()) plus the selected
// codes and their levels, so a selection always shows.
export function atcTreeCodes(counts, selectedCodes) {
  const codes = new Set([...counts].filter(([, count]) => count > 0).map(([code]) => code));
  for (const code of selectedCodes) for (const prefix of atcPrefixes(code)) codes.add(prefix);
  return codes;
}

// The tree nodes one level below parent (level 1 for null), in code order.
export function atcTreeChildren(parent, codes) {
  const level = parent === null ? 1 : atcLevel(parent) + 1;
  return [...codes].filter((code) => atcLevel(code) === level && (parent === null || code.startsWith(parent))).sort();
}

// Class names match a search from this many characters (a single letter is a level-1 code).
const NAME_SEARCH_MIN = 3;

// The tree filtered by a search (not a filter): matches = the top matching nodes (code prefix, or
// name from 3 characters; a node under a match is not one of its own), in code order; open = their
// levels above, opened; shown = those levels, the matches and everything under them. null for a
// blank query. names: code -> WHO name.
export function atcTreeSearch(codes, names, query) {
  const text = query.trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  const lower = text.toLowerCase();
  const hits = [...codes].filter((code) => code.startsWith(upper) ||
    (text.length >= NAME_SEARCH_MIN && Boolean(names.get(code)?.toLowerCase().includes(lower))));
  const matches = hits.filter((code) => !hits.some((other) => isUnder(code, other))).sort();
  const open = new Set(matches.flatMap((code) => atcPrefixes(code).slice(0, -1)));
  const shown = new Set([...codes].filter((code) => open.has(code) || matches.some((match) => code.startsWith(match))));
  return { matches, open, shown };
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
