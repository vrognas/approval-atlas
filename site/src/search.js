// Pure lookup search: folding, word-start matching, ranking, indication-text matches. No DOM, no D3.
import { atcLevel } from "./atc.js";
import { ATC_CODE } from "./badges.js";

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

// Letters and digits apart ("glp1" -> "glp 1", "177Lu" -> "177 lu"), in names and queries alike.
const LETTER_DIGIT = /(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/gu;
const splitLetterDigits = (folded) => folded.replace(LETTER_DIGIT, " ");
const STARTS_WITH_DIGIT = /^\p{N}/u;

// A query's words, each as its letter and digit parts ("h1n1" -> ["h", "1", "n", "1"]), kept
// together so they match consecutive words (matchesWords()).
export function queryWords(text) {
  return foldSearchText(text).split(NON_WORD).filter(Boolean).map((word) => splitLetterDigits(word).split(" "));
}

// A name's words, its letters split from digits.
export function searchWords(text) {
  return queryWords(text).flat();
}

// Every query word (queryWords()) matches where its parts are consecutive words of the term: the
// parts before the last whole words ("h1n1" is not "H5N1", "b12" not "hepatitis B" + "C127I"), the
// last a prefix, or a whole word when it is short and the next query word is a number ("il 17": not
// "Illuzyce" + "177") or, with shortWhole (conditions), always ("hep b" and "hum" as Humira is typed
// stay prefixes).
export function matchesWords(tokens, words, shortWhole) {
  return words.every((parts, position) => {
    const next = words[position + 1]?.[0] ?? "";
    const lastWhole = parts.at(-1).length < SHORT_WORD && (shortWhole || STARTS_WITH_DIGIT.test(next));
    return tokens.some((_, start) => parts.every((part, offset) => {
      const token = tokens[start + offset] ?? "";
      return offset < parts.length - 1 || lastWhole ? token === part : token.startsWith(part);
    }));
  });
}

// Step 2 (#19): other names of a substance (BAN, USAN, common names) -> the name EMA uses (the
// INN), each checked against the data (a substance key or an indication text).
export const SPELLING_VARIANTS = {
  adrenaline: "epinephrine",
  aspirin: "acetylsalicylic acid",
  beclomethasone: "beclometasone",
  busulphan: "busulfan",
  cholecalciferol: "colecalciferol",
  cyclosporin: "ciclosporin",
  cyclosporine: "ciclosporin",
  cysteamine: "mercaptamine",
  frusemide: "furosemide",
  glyburide: "glibenclamide",
  hydroxyurea: "hydroxycarbamide",
  lignocaine: "lidocaine",
};

// The query with another name of a substance replaced by EMA's: { alias, target, query } (query:
// the words joined), or null.
export function spellingVariant(query) {
  const words = searchWords(query);
  const at = words.findIndex((word) => Object.hasOwn(SPELLING_VARIANTS, word));
  if (at < 0) return null;
  const alias = words[at];
  const target = SPELLING_VARIANTS[alias];
  return { alias, target, query: [...words.slice(0, at), target, ...words.slice(at + 1)].join(" ") };
}

// Step 2 (#3): words a pack or a news line adds to a name. Units go anywhere, with the numbers
// right before them ("1 mg", "2.4mg"); forms and qualifiers anywhere; "anti" when it leads
// ("anti-TNF": the target's name follows).
const UNITS = new Set(["mg", "ml", "mcg", "µg", "μg"]);
const QUALIFIERS = new Set([
  "pen", "pens", "tablet", "tablets", "injection", "injections", "solution", "vaccine", "vaccines",
  "biosimilar", "biosimilars", "generic", "generics", "drug", "drugs", "pill", "pills",
]);
const NUMBER = /^\d+$/;
// Shorter than this, a query left by dropping its last word means little ("il", "car").
const MIN_SHORTENED = 4;

// The query's words without dose, form and qualifier words (the words themselves when none).
function coreWords(words) {
  const drop = words.map((word) => UNITS.has(word) || QUALIFIERS.has(word));
  for (let at = words.length - 1; at >= 0; at--) {
    if (!UNITS.has(words[at])) continue;
    for (let before = at - 1; before >= 0 && NUMBER.test(words[before]); before--) drop[before] = true;
  }
  const kept = words.filter((_, position) => !drop[position]);
  return kept[0] === "anti" && kept.length > 1 ? kept.slice(1) : kept;
}

// Queries to try, in order, when the typed one finds nothing: without dose, form and qualifier
// words, then also without the last word ("Keytruda melanoma", "adalimumab-atto").
export function relaxedQueries(query) {
  const words = searchWords(query);
  const core = coreWords(words);
  const queries = [];
  if (core.length && core.join(" ") !== words.join(" ")) queries.push(core.join(" "));
  const shorter = core.slice(0, -1).join(" ");
  if (core.length > 1 && shorter.length >= MIN_SHORTENED) queries.push(shorter);
  return queries;
}

const hasOptions = (groups) => groups.some((group) => group.options.length > 0);

// run(query) -> suggestion groups ([{ key, options }]). The typed query's groups, or else those of
// the first relaxed query that finds something (shownFor: that query, which the list names).
export function searchWithFallback(query, run) {
  const groups = run(query);
  if (hasOptions(groups)) return { groups, shownFor: null };
  for (const relaxed of relaxedQueries(query)) {
    const found = run(relaxed);
    if (hasOptions(found)) return { groups: found, shownFor: relaxed };
  }
  return { groups, shownFor: null };
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
// Per descriptor: its EMA terms and products; ownProducts: those tagged with the descriptor's own
// term; narrowerTerms ([{ term, ui }]): the EMA terms of narrower descriptors; narrowerByProduct:
// product -> the narrower terms it is tagged with.
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
      descriptors.set(ui, {
        ui, name: row.mesh_descriptor_name, nameTokens: searchWords(row.mesh_descriptor_name), terms: [], products: new Set(), synonyms: [], narrower: 0,
        ownProducts: new Set(), narrowerTerms: [], narrowerByProduct: new Map(),
      });
    }
    const descriptor = descriptors.get(ui);
    const term = row.therapeutic_area_mesh;
    descriptor.terms.push(term);
    const own = termUi.has(term) ? termUi.get(term) === ui : term === row.mesh_descriptor_name;
    if (!own) {
      descriptor.narrower++;
      descriptor.narrowerTerms.push({ term, ui: termUi.get(term) ?? null });
    }
    for (const number of productsByTerm.get(term) ?? []) {
      descriptor.products.add(number);
      if (own) descriptor.ownProducts.add(number);
      else descriptor.narrowerByProduct.set(number, [...(descriptor.narrowerByProduct.get(number) ?? []), term]);
    }
  }
  for (const { term, ui } of index.entryTerms) descriptors.get(ui)?.synonyms.push(term);
  for (const descriptor of descriptors.values()) {
    descriptor.authorized = [...descriptor.products].filter((number) => index.byNumber.get(number)?.medicine_status === "Authorised").length;
  }
  // Descriptor names are unique in MeSH: a therapeutic area group's name is its root descriptor's.
  const uiByName = new Map([...descriptors.values()].map((descriptor) => [descriptor.name, descriptor.ui]));
  return { descriptors, termUi, uiByName };
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

function matchingSubstances(index, folded, words) {
  const rank = (substance) => (substance.key === folded ? 0 : substance.key.startsWith(folded) ? 1 : 2);
  return [...index.substances.values()]
    .filter((substance) => matchesWords(substance.tokens, words, false))
    .sort((a, b) => rank(a) - rank(b) || b.products.length - a.products.length || byName(a.name, b.name));
}

// Then the substances another name leads to (#19), each saying which name matched (synonym) and
// named when the query is exactly that other name.
function suggestSubstances(index, folded, words, query) {
  const found = matchingSubstances(index, folded, words);
  const variant = spellingVariant(query);
  if (variant) {
    const seen = new Set(found.map((substance) => substance.key));
    for (const substance of matchingSubstances(index, variant.query, queryWords(variant.query))) {
      if (!seen.has(substance.key)) found.push({ ...substance, synonym: variant.alias, named: substance.key === variant.query });
    }
  }
  return found.slice(0, MAX_SUGGESTIONS);
}

function suggestConditions(index, conditions, words) {
  const matches = new Map();
  for (const entry of index.entryTerms) {
    if (!matchesWords(entry.tokens, words, true) || !conditions.descriptors.has(entry.ui)) continue;
    const exact = sameWordSet(entry.tokens, words.flat());
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
        exact: best.exact || sameWordSet(descriptor.nameTokens, words.flat()),
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
  const words = queryWords(query);
  if (folded.length < MIN_QUERY || words.length === 0) return { medicines: [], substances: [], conditions: [] };
  return {
    medicines: suggestMedicines(index, folded, words),
    substances: suggestSubstances(index, folded, words, query),
    conditions: conditions ? suggestConditions(index, conditions, words) : [],
  };
}

// Groups Enter never opens: "did you mean" (a guess) and the indication-text search (#14), which
// Enter runs anyway when nothing else opens.
const CLICK_ONLY = new Set(["fuzzy", "text"]);

// Enter without a picked option: the suggestion the query names (folded label, an ATC class's
// code, or an option marked named: a company group's curated monogram or other name, a condition's
// exact entry term, a substance's other name), first in group order, else the only suggestion
// unless it is weak (found only through a derived monogram), else null (a text search). groups:
// the search box's [{ key, options: [{ label, value, named, weak }] }]. onlyNamed (bug hunt
// 2026-10-01, lookup.md #2: data still loading): the suggestion the query names only, as more can come.
export function submitChoice(groups, query, { onlyNamed = false } = {}) {
  const folded = foldSearchText(query);
  const options = groups.filter((group) => !CLICK_ONLY.has(group.key)).flatMap((group) => group.options.map((option) => ({ group: group.key, option })));
  const named = options.find(({ group, option }) => namesQuery(group, option, folded));
  const only = !onlyNamed && options.length === 1 && !options[0].option.weak ? options[0] : null;
  const choice = named ?? only;
  return choice ? { group: choice.group, value: choice.option.value } : null;
}

// Whether a suggestion is the one the folded query names: marked named, its label, or a class's code.
function namesQuery(groupKey, option, folded) {
  return Boolean(option.named) || foldSearchText(option.label) === folded || (groupKey === "classes" && foldSearchText(option.value) === folded);
}

// Bug hunt 2026-10-01 (lookup.md #2) and its review: background data arriving under an open list
// rebuilt it with new groups above the options shown ("Roche", the company, above Bondenza, 70px
// down; "msd": a tap aimed at Vorinostat MSD opened Sanofi's company page) and without the
// "Loading…" note above them (the text search 32px up), so a tap aimed at an option then hit
// another. The list's layout: next: { groups, note, loading } as the search gives them now;
// shown: { groups, note } as the open list shows them (groups before collapseGroups()), null for a
// new list (a keystroke). Returns { groups, note, end }: note above the groups, end under them.
// A new list: as given, end "Loading…" (loadingNote) while data loads, as what comes then comes
// there. An open list keeps what it shows in place until the next keystroke sorts it as usual: its
// groups in their order, each with the options it shows (as they read now: a negative opinion in
// a medicine's meta; one gone now kept as shown; one new to the group left out), a group gone now
// kept as shown (did you mean, once something matches); new groups under them, where "Loading…"
// was, even one the query names (Enter still opens it: submitChoice()); its note kept as it reads
// now, and a note it did not show under the groups ("Paracetamol (ATC N02BE01): …"), but "No
// matches" (quietNote), which the status says and a "Did you mean" heading shows.
export function keepShownList(shown, next, { loadingNote, quietNote }) {
  const groups = next.groups.filter((group) => group.options.length > 0);
  const end = next.loading ? loadingNote : null;
  if (!shown) return { groups, note: next.note ?? null, end };
  const optionKey = (option) => `${option.pick ?? ""}\u0000${option.value}`;
  const nextByKey = new Map(groups.map((group) => [group.key, group]));
  const kept = shown.groups.map((group) => {
    const now = nextByKey.get(group.key);
    const current = new Map((now?.options ?? []).map((option) => [optionKey(option), option]));
    return { ...group, ...now, options: group.options.map((option) => current.get(optionKey(option)) ?? option) };
  });
  const shownKeys = new Set(shown.groups.map((group) => group.key));
  const added = groups.filter((group) => !shownKeys.has(group.key));
  const note = shown.note ? next.note ?? shown.note : null;
  const unshown = !shown.note && next.note && next.note !== quietNote ? next.note : null;
  return { groups: [...kept, ...added], note, end: end ?? unshown };
}

// Laws of UX, second pass (owner decision 2026-09-30; Hick's Law, Choice Overload): on a phone, with
// the keyboard up, the list had up to 8 options in each of 5 groups. There each group of suggestions
// shows at most PHONE_GROUP_LIMIT, the ones the query names first (as submitChoice() reads them), and
// how many it leaves out (hidden), for a "Show 5 more" option that expands the group in place (the
// search box's). A group one longer than the limit is shown whole ("Show 1 more" would take the same
// row); "did you mean", the indication-text search and the recently viewed list are never collapsed.
// An expanded group keeps that order, so the options it adds follow those shown. groups: the search
// box's; query: the one the labels are compared with.
export const PHONE_GROUP_LIMIT = 3;
const COLLAPSIBLE = new Set(["medicines", "substances", "conditions", "classes", "companies"]);
export function collapseGroups(groups, query, { limit = PHONE_GROUP_LIMIT, expanded = new Set() } = {}) {
  const folded = foldSearchText(query);
  return groups.map((group) => {
    if (!COLLAPSIBLE.has(group.key)) return { ...group, hidden: 0 };
    const named = (option) => namesQuery(group.key, option, folded);
    const options = [...group.options.filter(named), ...group.options.filter((option) => !named(option))];
    if (expanded.has(group.key) || options.length <= limit + 1) return { ...group, options, hidden: 0 };
    return { ...group, options: options.slice(0, limit), hidden: options.length - limit };
  });
}

// Step 2 (#5): Damerau-Levenshtein distance (optimal string alignment: an adjacent swap is one
// edit), or max + 1 as soon as it must exceed max. Every row holds a cell no larger than any swap
// in the next, so a row's minimum bounds the result.
export function editDistance(a, b, max = Infinity) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before = null;
  let previous = Array.from({ length: b.length + 1 }, (_, position) => position);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, before[j - 2] + 1);
      current.push(value);
    }
    if (Math.min(...current) > max) return max + 1;
    [before, previous] = [previous, current];
  }
  return Math.min(previous[b.length], max + 1);
}

// Edits allowed for a query of this length: none under 4 characters, 1 up to 6, else 2.
const fuzzyLimit = (length) => (length < 4 ? -1 : length <= 6 ? 1 : 2);
const MAX_FUZZY = 3;
const KIND_ORDER = { substance: 0, medicine: 1, who: 2 };

// Per lookup index: its folded substance keys, and the texts a misspelling is compared with (the
// first word and the whole name of each medicine, each substance key).
const fuzzyIndexes = new WeakMap();
function fuzzyIndex(index) {
  if (!fuzzyIndexes.has(index)) {
    const candidates = [];
    for (const substance of index.substances.values()) {
      candidates.push({ text: foldSearchText(substance.key), kind: "substance", value: substance.key, label: substance.name, substance, authorized: substance.products.some(isAuthorised) });
    }
    for (const medicine of index.medicines) {
      const entry = { kind: "medicine", value: medicine.row.ema_product_number, label: medicine.row.name_of_medicine, row: medicine.row, authorized: isAuthorised(medicine.row), first: medicine.tokens[0] };
      for (const text of new Set([medicine.tokens[0], medicine.folded])) if (text) candidates.push({ ...entry, text });
    }
    fuzzyIndexes.set(index, { candidates, keys: new Set([...index.substances.keys()].map(foldSearchText)) });
  }
  return fuzzyIndexes.get(index);
}

// Per atc_classes array: folded WHO level-5 name -> { code, name } (the first code by code order).
const whoNameMaps = new WeakMap();
function whoNames(atcClasses) {
  if (!whoNameMaps.has(atcClasses)) {
    const names = new Map();
    for (const row of [...atcClasses].sort((a, b) => a.atc_code.localeCompare(b.atc_code))) {
      if (row.level === 5 && row.name && !names.has(foldSearchText(row.name))) names.set(foldSearchText(row.name), { code: row.atc_code, name: row.name });
    }
    whoNameMaps.set(atcClasses, names);
  }
  return whoNameMaps.get(atcClasses);
}

function isAuthorised(row) {
  return row.medicine_status === "Authorised";
}

// Step 2 (#2): the WHO level-5 substance the query names ({ code, name }), when no medicine in the
// data has it as an active substance (paracetamol), else null.
export function knownSubstance(index, query, atcClasses) {
  const folded = foldSearchText(query);
  if (fuzzyIndex(index).keys.has(folded)) return null;
  return whoNames(atcClasses).get(folded) ?? null;
}

// Step 2 (#5): "did you mean" for a name heard in a talk: medicines (first word or whole name),
// substances and WHO level-5 names of substances with no medicine in the data, within 1 edit of the
// query (without dose and form words) for 4-6 characters or 2 when longer; at most 3, closest
// first, then authorized, substances before medicines, then name. A medicine named after a
// substance found (Abiraterone Accord) leaves the substance to stand for it; a WHO name the query
// is exactly is knownSubstance()'s. [{ kind: "medicine" | "substance" | "who", value, label,
// distance, authorized, row | substance | code }]
export function didYouMean(index, query, atcClasses = []) {
  const text = coreWords(searchWords(query)).join(" ");
  const limit = fuzzyLimit(text.length);
  if (limit < 0) return [];
  const { candidates, keys } = fuzzyIndex(index);
  const who = [...whoNames(atcClasses)].filter(([name]) => !keys.has(name))
    .map(([name, row]) => ({ text: name, kind: "who", value: row.name, label: row.name, code: row.code, authorized: false }));
  const best = new Map();
  for (const candidate of [...candidates, ...who]) {
    const distance = editDistance(text, candidate.text, limit);
    if (distance > limit || (candidate.kind === "who" && distance === 0)) continue;
    const id = `${candidate.kind}:${candidate.value}`;
    if (!best.has(id) || distance < best.get(id).distance) best.set(id, { ...candidate, distance });
  }
  const substances = new Set([...best.values()].filter((entry) => entry.kind === "substance").map((entry) => entry.text));
  return [...best.values()]
    .filter((entry) => !(entry.kind === "medicine" && substances.has(entry.first)))
    .sort((a, b) => a.distance - b.distance || b.authorized - a.authorized || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || byName(a.label, b.label))
    .slice(0, MAX_FUZZY)
    .map(({ text: _text, first: _first, ...entry }) => entry);
}

// Per atc_classes array: code -> name, and per row its folded name and words (computed once).
const classNameMaps = new WeakMap();
const classEntries = new WeakMap();
function classNames(atcClasses) {
  if (!classNameMaps.has(atcClasses)) classNameMaps.set(atcClasses, new Map(atcClasses.map((row) => [row.atc_code, row.name])));
  return classNameMaps.get(atcClasses);
}
function classEntry(row) {
  if (!classEntries.has(row)) classEntries.set(row, { folded: foldSearchText(row.name), tokens: searchWords(row.name) });
  return classEntries.get(row);
}

// Drug classes (atc_classes.json rows) with at least one product in counts (products per prefix).
// A query shaped like an ATC code (not folded: "A10AE") lists the classes under it, shortest code
// first, codes without a WHO name included; other text matches word starts in level 1-4 names
// (level-5 names are substances, suggested as such). Ranked exact > prefix > contains, then count.
export function suggestAtcClasses(query, atcClasses, counts) {
  const folded = foldSearchText(query);
  const words = queryWords(query);
  if (folded.length < MIN_QUERY || words.length === 0) return [];
  const code = query.trim().toUpperCase();
  if (ATC_CODE.test(code)) {
    const names = classNames(atcClasses);
    return [...counts]
      .filter(([candidate, count]) => count > 0 && candidate.startsWith(code))
      .sort(([a, countA], [b, countB]) => a.length - b.length || countB - countA || a.localeCompare(b))
      .slice(0, MAX_SUGGESTIONS)
      .map(([candidate, count]) => ({ code: candidate, level: atcLevel(candidate), name: names.get(candidate) ?? null, count }));
  }
  const rank = (row) => {
    const name = classEntry(row).folded;
    return name === folded ? 0 : name.startsWith(folded) ? 1 : 2;
  };
  const count = (row) => counts.get(row.atc_code) ?? 0;
  return atcClasses
    .filter((row) => row.level <= 4 && row.name && count(row) > 0 && matchesWords(classEntry(row).tokens, words, false))
    .sort((a, b) => rank(a) - rank(b) || count(b) - count(a) || a.atc_code.localeCompare(b.atc_code))
    .slice(0, MAX_SUGGESTIONS)
    .map((row) => ({ code: row.atc_code, level: row.level, name: row.name, count: count(row) }));
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

// A free-text query's phrases (textMatches()): the folded text, then its letters split from digits
// ("glp1" also as "glp 1", as indications write GLP-1), then with another name of a substance
// replaced by EMA's (#19: "aspirin" also as "acetylsalicylic acid"; variant: that name, else null).
export function textPhrases(query) {
  const folded = foldSearchText(query);
  const variant = spellingVariant(query);
  const phrases = [...new Set([folded, splitLetterDigits(folded), variant?.query].filter(Boolean))];
  return { phrases, variant: variant?.query ?? null };
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
