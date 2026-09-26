// Pure lookup search: folding, word-start matching, ranking, indication-text matches. No DOM, no D3.

const DASHES = /[-‐-―]/g;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const NON_WORD = /[^\p{L}\p{N}]+/u;
export const MIN_QUERY = 2;
export const MAX_SUGGESTIONS = 8;
const SHORT_WORD = 4; // condition query words shorter than this must match a whole word

// Identical to R fold_search_text() (R/mesh.R): lower-case; "ae|oe" -> "e" in one pass; hyphen and
// U+2010-U+2015 dashes -> space; collapse and trim whitespace (str_squish). MeSH entry terms arrive
// folded; queries and indications are folded here.
export function foldSearchText(text) {
  return text.toLowerCase().replace(/ae|oe/g, "e").replace(DASHES, " ").replace(/\s+/g, " ").trim();
}

// Same steps, keeping each output character's source range [start, end) so a match in the folded
// text can be cut from the original. Lower-casing is done on the whole string (final sigma).
export function foldWithMap(text) {
  let chars = [];
  let starts = [];
  let ends = [];
  const lower = text.toLowerCase();
  if (lower.length === text.length) {
    chars = [...lower.split("")];
    starts = chars.map((_, index) => index);
    ends = chars.map((_, index) => index + 1);
  } else {
    let at = 0;
    for (const char of text) {
      for (const unit of char.toLowerCase().split("")) {
        chars.push(unit);
        starts.push(at);
        ends.push(at + char.length);
      }
      at += char.length;
    }
  }
  const next = { chars: [], starts: [], ends: [] };
  for (let i = 0; i < chars.length; i++) {
    const joined = (chars[i] === "a" || chars[i] === "o") && chars[i + 1] === "e";
    next.chars.push(joined ? "e" : chars[i]);
    next.starts.push(starts[i]);
    next.ends.push(ends[joined ? ++i : i]);
  }
  ({ chars, starts, ends } = next);
  chars = chars.map((char) => char.replace(DASHES, " "));
  const out = { chars: [], starts: [], ends: [] };
  for (let i = 0; i < chars.length; i++) {
    if (!/\s/.test(chars[i])) {
      out.chars.push(chars[i]);
      out.starts.push(starts[i]);
      out.ends.push(ends[i]);
      continue;
    }
    const first = i;
    while (i + 1 < chars.length && /\s/.test(chars[i + 1])) i++;
    if (out.chars.length === 0 || i === chars.length - 1) continue; // trim
    out.chars.push(" ");
    out.starts.push(starts[first]);
    out.ends.push(ends[i]);
  }
  return { text: out.chars.join(""), starts: out.starts, ends: out.ends };
}

export function searchWords(text) {
  return foldSearchText(text).split(NON_WORD).filter(Boolean);
}

// Every query word starts some word of the term (whole-word match for short words when asked).
function matchesWords(tokens, words, shortWhole) {
  return words.every((word) => tokens.some((token) => (shortWhole && word.length < SHORT_WORD ? token === word : token.startsWith(word))));
}

const sameWordSet = (a, b) => {
  const left = [...new Set(a)].sort().join(" ");
  return left !== "" && left === [...new Set(b)].sort().join(" ");
};

// searchRows: ema_search_index.json; entryTermRows: mesh_entry_terms.json (folded).
export function buildLookupIndex(searchRows, entryTermRows) {
  const substances = new Map();
  for (const row of searchRows) {
    const names = row.substances ? row.substances.split("; ") : [];
    for (const key of row.substance_keys ?? []) {
      if (!substances.has(key)) {
        const name = names.find((item) => item.toLowerCase() === key) ?? key;
        substances.set(key, { key, name, tokens: searchWords(key), products: [] });
      }
      substances.get(key).products.push(row);
    }
  }
  return {
    medicines: searchRows.map((row) => ({ row, folded: foldSearchText(row.name_of_medicine), tokens: searchWords(row.name_of_medicine) })),
    byNumber: new Map(searchRows.map((row) => [row.ema_product_number, row])),
    substances,
    entryTerms: entryTermRows.map((row) => ({ term: row.entry_term, ui: row.mesh_descriptor_ui, tokens: searchWords(row.entry_term) })),
  };
}

// Background data: mesh_descriptor_areas.json, ema_medicine_therapeutic_areas.json, ema_therapeutic_area_branches.json.
export function buildConditions(index, { descriptorAreaRows, areaRows, branchRows }) {
  const productsByTerm = new Map();
  for (const row of areaRows) {
    if (!productsByTerm.has(row.therapeutic_area_mesh)) productsByTerm.set(row.therapeutic_area_mesh, []);
    productsByTerm.get(row.therapeutic_area_mesh).push(row.ema_product_number);
  }
  const termUi = new Map(branchRows.filter((row) => row.mesh_descriptor_ui).map((row) => [row.therapeutic_area_mesh, row.mesh_descriptor_ui]));
  const descriptors = new Map();
  for (const row of descriptorAreaRows) {
    const ui = row.mesh_descriptor_ui;
    if (!descriptors.has(ui)) {
      descriptors.set(ui, { ui, name: row.mesh_descriptor_name, nameTokens: searchWords(row.mesh_descriptor_name), terms: [], products: new Set(), synonyms: [], narrower: 0 });
    }
    const descriptor = descriptors.get(ui);
    descriptor.terms.push(row.therapeutic_area_mesh);
    const own = termUi.has(row.therapeutic_area_mesh) ? termUi.get(row.therapeutic_area_mesh) === ui : row.therapeutic_area_mesh === row.mesh_descriptor_name;
    if (!own) descriptor.narrower++;
    for (const number of productsByTerm.get(row.therapeutic_area_mesh) ?? []) descriptor.products.add(number);
  }
  for (const { term, ui } of index.entryTerms) descriptors.get(ui)?.synonyms.push(term);
  for (const descriptor of descriptors.values()) {
    descriptor.authorized = [...descriptor.products].filter((number) => index.byNumber.get(number)?.medicine_status === "Authorised").length;
  }
  return { descriptors, termUi };
}

const byName = (a, b) => a.localeCompare(b);

function suggestMedicines(index, folded, words) {
  const rank = (medicine) => (medicine.folded === folded ? 0 : medicine.folded.startsWith(folded) ? 1 : 2);
  return index.medicines
    .filter((medicine) => matchesWords(medicine.tokens, words, false))
    .map((medicine) => ({ medicine, rank: rank(medicine), authorized: medicine.row.medicine_status === "Authorised" ? 0 : 1 }))
    .sort((a, b) => a.rank - b.rank || a.authorized - b.authorized || byName(a.medicine.row.name_of_medicine, b.medicine.row.name_of_medicine))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ medicine }) => medicine.row);
}

function suggestSubstances(index, folded, words) {
  const rank = (substance) => (substance.key === folded ? 0 : substance.key.startsWith(folded) ? 1 : 2);
  return [...index.substances.values()]
    .filter((substance) => matchesWords(substance.tokens, words, false))
    .sort((a, b) => rank(a) - rank(b) || b.products.length - a.products.length || byName(a.name, b.name))
    .slice(0, MAX_SUGGESTIONS);
}

function suggestConditions(index, conditions, words) {
  const matches = new Map();
  for (const entry of index.entryTerms) {
    if (!matchesWords(entry.tokens, words, true) || !conditions.descriptors.has(entry.ui)) continue;
    const exact = sameWordSet(entry.tokens, words);
    const best = matches.get(entry.ui);
    if (!best || (exact && !best.exact) || (exact === best.exact && entry.term.length < best.term.length)) matches.set(entry.ui, { term: entry.term, exact });
  }
  return [...matches]
    .map(([ui, best]) => {
      const descriptor = conditions.descriptors.get(ui);
      const nameMatch = matchesWords(descriptor.nameTokens, words, true);
      return {
        ui,
        name: descriptor.name,
        synonym: nameMatch ? null : best.term,
        exact: best.exact || sameWordSet(descriptor.nameTokens, words),
        nameMatch,
        authorized: descriptor.authorized,
      };
    })
    .sort((a, b) => b.exact - a.exact || b.nameMatch - a.nameMatch || b.authorized - a.authorized || byName(a.name, b.name))
    .slice(0, MAX_SUGGESTIONS);
}

// Grouped suggestions; conditions stay empty until their background data (conditions) has loaded.
export function suggest(index, conditions, query) {
  const folded = foldSearchText(query);
  const words = searchWords(query);
  if (folded.length < MIN_QUERY || words.length === 0) return { medicines: [], substances: [], conditions: [] };
  return {
    medicines: suggestMedicines(index, folded, words),
    substances: suggestSubstances(index, folded, words),
    conditions: conditions ? suggestConditions(index, conditions, words) : [],
  };
}

// First occurrence of phrase in folded text with no letter or digit directly before or after it.
export function findWholeWord(folded, phrase) {
  if (!phrase) return -1;
  for (let at = folded.indexOf(phrase); at >= 0; at = folded.indexOf(phrase, at + 1)) {
    const before = at === 0 ? "" : folded[at - 1];
    const after = folded[at + phrase.length] ?? "";
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) return at;
  }
  return -1;
}

// Original-text snippet around the first whole-word match of a folded phrase; plain strings only,
// the page puts them in text nodes. Cuts fall on spaces so no partial words show.
export function makeSnippet(text, phrase, context = 90) {
  const mapped = foldWithMap(text);
  const at = findWholeWord(mapped.text, phrase);
  if (at < 0) return null;
  const start = mapped.starts[at];
  const end = mapped.ends[at + phrase.length - 1];
  let from = Math.max(0, start - context);
  let to = Math.min(text.length, end + context);
  if (from > 0) {
    const space = text.indexOf(" ", from);
    if (space >= 0 && space < start) from = space + 1;
  }
  if (to < text.length) {
    const space = text.lastIndexOf(" ", to);
    if (space > end) to = space;
  }
  return {
    before: `${from > 0 ? "…" : ""}${text.slice(from, start)}`,
    match: text.slice(start, end),
    after: `${text.slice(end, to)}${to < text.length ? "…" : ""}`,
  };
}

// A picked condition's text phrases: its folded name and synonyms, with MeSH's inverted
// "arthritis, rheumatoid" also read as "rheumatoid arthritis" ("leukemia, myeloid, acute" as
// "acute myeloid leukemia").
export function conditionPhrases(descriptor) {
  const phrases = new Set([foldSearchText(descriptor.name), ...descriptor.synonyms]);
  for (const phrase of [...phrases]) {
    const parts = phrase.split(", ");
    if (parts.length > 1) phrases.add(parts.reverse().join(" "));
  }
  return [...phrases];
}

// Folded indications are cached per product row (they never change after load).
const foldedIndications = new WeakMap();
function foldedIndication(product) {
  if (!foldedIndications.has(product)) foldedIndications.set(product, foldSearchText(product.therapeutic_indication ?? ""));
  return foldedIndications.get(product);
}

// products: ema_medicines rows; phrases: folded; first matching phrase wins.
export function textMatches(products, phrases, exclude = new Set()) {
  const matches = [];
  for (const product of products) {
    if (exclude.has(product.ema_product_number) || !product.therapeutic_indication) continue;
    const phrase = phrases.find((candidate) => findWholeWord(foldedIndication(product), candidate) >= 0);
    if (phrase) matches.push({ product, snippet: makeSnippet(product.therapeutic_indication, phrase) });
  }
  return matches;
}
