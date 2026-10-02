import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  PHONE_GROUP_LIMIT,
  SPELLING_VARIANTS,
  buildConditions,
  collapseGroups,
  buildLookupIndex,
  conditionPhrases,
  didYouMean,
  editDistance,
  euNumberIndex,
  euNumberStarted,
  findWholeWord,
  foldSearchText,
  foldWithMap,
  knownSubstance,
  makeSnippet,
  matchesWords,
  medicineByNumber,
  medicineNumber,
  numberAnswer,
  queryWords,
  relaxedQueries,
  searchWithFallback,
  searchWords,
  spellingVariant,
  submitChoice,
  keepShownList,
  suggest,
  suggestAtcClasses,
  textMatches,
  textPhrases,
} from "./search.js";
import { substanceAuthorizedCount } from "./copies.js";

// The R rule (fold_search_text in R/mesh.R): str_to_lower; str_replace_all("ae|oe", "e");
// "[\\-\\x{2010}-\\x{2015}]" -> " "; str_squish.
test("foldSearchText follows the R folding rule", () => {
  assert.equal(foldSearchText("Haemophilia A"), "hemophilia a");
  assert.equal(foldSearchText("Oesophageal  Cancer"), "esophageal cancer");
  assert.equal(foldSearchText("Non-Small-Cell Lung"), "non small cell lung");
  assert.equal(foldSearchText("type‐2 – diabetes ― x"), "type 2 diabetes x"); // U+2010, U+2013, U+2015
  assert.equal(foldSearchText("a−b"), "a−b"); // U+2212 minus is not a dash here
  assert.equal(foldSearchText("  a \tb  "), "a b");
  assert.equal(foldSearchText("Arthritis, Rheumatoid"), "arthritis, rheumatoid");
  // One regex pass, like R's "ae|oe": the "e" it produces is not folded again.
  assert.equal(foldSearchText("oae"), "oe");
  assert.equal(foldSearchText("AAE"), "ae");
  assert.equal(foldSearchText(""), "");
});

// The R test of fold_search_text() reads the same file (tests/testthat/test-mesh.R).
test("foldSearchText folds every case of the shared fixture", () => {
  const cases = JSON.parse(readFileSync(new URL("../../tests/testthat/fixtures/fold-cases.json", import.meta.url), "utf8"));
  assert.ok(cases.length > 15);
  for (const { input, expected } of cases) {
    assert.equal(foldSearchText(input), expected, JSON.stringify(input));
    assert.equal(foldWithMap(input).text, expected, JSON.stringify(input));
  }
});

test("foldWithMap gives the same text as foldSearchText and maps back to the source", () => {
  const cases = ["Haemophilia A", "  Oesophageal--cancer  ", "oae aae", "a   b", "Crohn’s", "<b> & ≥", "ΟΔΟΣ"];
  for (const text of cases) assert.equal(foldWithMap(text).text, foldSearchText(text), text);
  const mapped = foldWithMap("  Haemo-philia");
  assert.equal(mapped.text, "hemo philia");
  assert.deepEqual([mapped.starts[1], mapped.ends[1]], [3, 5]); // "e" <- "ae"
  assert.deepEqual([mapped.starts[4], mapped.ends[4]], [7, 8]); // " " <- "-"
});

const dataDir = new URL("../public/data/", import.meta.url);
const medicinesFile = new URL("ema_medicines.json", dataDir);
test(
  "foldWithMap equals foldSearchText on every real indication",
  { skip: existsSync(medicinesFile) ? false : "site/public/data/ema_medicines.json not found" },
  () => {
    const medicines = JSON.parse(readFileSync(medicinesFile, "utf8"));
    const texts = medicines.map((row) => row.therapeutic_indication).filter(Boolean);
    assert.ok(texts.length > 1000);
    assert.deepEqual(texts.filter((text) => foldWithMap(text).text !== foldSearchText(text)), []);
  },
);

const entryTermsFile = new URL("mesh_entry_terms.json", dataDir);
test(
  "every entry term in mesh_entry_terms.json is already folded",
  { skip: existsSync(entryTermsFile) ? false : "site/public/data/mesh_entry_terms.json not found" },
  () => {
    const rows = JSON.parse(readFileSync(entryTermsFile, "utf8"));
    assert.deepEqual(rows.filter((row) => foldSearchText(row.entry_term) !== row.entry_term).slice(0, 5), []);
  },
);

test("searchWords splits the folded text on anything that is not a letter or digit", () => {
  assert.deepEqual(searchWords("Crohn's disease (type-2)"), ["crohn", "s", "disease", "type", "2"]);
  assert.deepEqual(searchWords("  "), []);
});

// Step 2 (#4): "glp1" is how people type GLP-1; names and queries split the same way.
test("searchWords splits letters from digits", () => {
  assert.deepEqual(searchWords("glp1"), ["glp", "1"]);
  assert.deepEqual(searchWords("GLP-1"), ["glp", "1"]);
  assert.deepEqual(searchWords("Lutetium (177Lu) chloride"), ["lutetium", "177", "lu", "chloride"]);
  assert.deepEqual(searchWords("B12c"), ["b", "12", "c"]);
});

// A query keeps each typed word's parts together: "h1n1" is one word of four parts, not four words.
test("queryWords: the query's words, each split into its letter and digit parts", () => {
  assert.deepEqual(queryWords("glp1 H1N1-v"), [["glp", "1"], ["h", "1", "n", "1"], ["v"]]);
  assert.deepEqual(queryWords("IL-17").flat(), searchWords("IL-17"));
  assert.deepEqual(queryWords("  "), []);
});

// Step 2 (#4): "IL-17" opened Lutetium Billev (previously Illuzyce), its only suggestion: "il" started
// "illuzyce" and "17" started "177". A short word before a number must be a whole word; otherwise a
// word stays a prefix ("hum" finds Humira as it is typed, "hep b" hepatitis B). Step 2 review: the
// parts of a glued word match consecutive words, the parts before the last whole ("h1n1" is not
// "H5N1"; "b12" is not "hepatitis B" + "C127I"; "a1c" is not "Clopidogrel 1A").
test("matchesWords: a glued word's parts match consecutive words; a short word before a number is whole", () => {
  const matches = (name, query, shortWhole = false) => matchesWords(searchWords(name), queryWords(query), shortWhole);
  assert.equal(matches("Humira", "hum"), true);
  assert.equal(matches("Lutetium (177Lu) chloride Billev (previously Illuzyce)", "IL-17"), false);
  assert.equal(matches("Lutetium (177Lu) chloride Billev (previously Illuzyce)", "il17"), false);
  assert.equal(matches("Lutetium (177Lu) chloride", "177lu"), true);
  assert.equal(matches("Glucagon-like peptide-1 (GLP-1) analogues", "glp1"), true);
  assert.equal(matches("CAR T cells", "car t"), true);
  assert.equal(matches("Carvykti", "car t"), false);
  assert.equal(matches("insulin glargine", "insulin gla"), true);
  assert.equal(matches("insulin glargine", "ins gla"), true);
  assert.equal(matches("hepatitis B surface antigen", "hep b"), true);
  assert.equal(matches("Pandemic influenza vaccine H5N1", "h1n1"), false);
  assert.equal(matches("Pandemic influenza vaccine H5N1", "H5N1"), true);
  assert.equal(matches("Pandemic influenza vaccine H5N1", "h5"), true);
  assert.equal(matches("influenza vaccine H1N1v", "v1"), false);
  assert.equal(matches("hepatitis B surface antigens [murine (C127I) cells]", "b12"), false);
  assert.equal(matches("Clopidogrel 1A Pharma", "a1c"), false);
  // Conditions keep their rule: every short word whole, the last one too.
  assert.equal(matches("hivx", "hiv", true), false);
  assert.equal(matches("HIV-1 infection", "hiv1", true), true);
});

test("findWholeWord needs word boundaries on both sides", () => {
  assert.equal(findWholeWord("small cell lung; sma type 1", "sma"), 17);
  assert.equal(findWholeWord("plasma small", "sma"), -1);
  assert.equal(findWholeWord("hiv negative", "hiv"), 0);
  assert.equal(findWholeWord("x", ""), -1);
});

test("makeSnippet cuts the original text around the match, at most ~90 characters each side", () => {
  const text = `${"word ".repeat(40)}treatment of Haemophilia A in adults ${"more ".repeat(40)}`;
  const snippet = makeSnippet(text, foldSearchText("hemophilia a"));
  assert.equal(snippet.match, "Haemophilia A");
  assert.ok(snippet.before.startsWith("…"));
  assert.ok(snippet.after.endsWith("…"));
  assert.ok(snippet.before.length <= 92 && snippet.after.length <= 92);
  assert.ok(snippet.before.endsWith("treatment of "));
  // No partial words at the cut ends.
  assert.match(snippet.before, /^…word /);
  assert.match(snippet.after, / more…$/);
});

test("makeSnippet returns plain strings (markup stays text) and null without a match", () => {
  const snippet = makeSnippet("Use <b>only</b> in HIV-1 infection", foldSearchText("hiv 1"));
  assert.deepEqual(snippet, { before: "Use <b>only</b> in ", match: "HIV-1", after: " infection" });
  assert.equal(makeSnippet("plasma", "sma"), null);
});

const searchRows = [
  { ema_product_number: "P1", name_of_medicine: "Keytruda", substances: "pembrolizumab", substance_keys: ["pembrolizumab"], medicine_status: "Authorised", marketing_authorisation_date: "2015-07-17", medicine_type: "Other" },
  { ema_product_number: "P2", name_of_medicine: "Humira", substances: "adalimumab", substance_keys: ["adalimumab"], medicine_status: "Authorised", marketing_authorisation_date: "2003-09-08", medicine_type: "Other" },
  { ema_product_number: "P3", name_of_medicine: "Hulio", substances: "adalimumab", substance_keys: ["adalimumab"], medicine_status: "Withdrawn", marketing_authorisation_date: "2018-09-17", medicine_type: "Biosimilar" },
  { ema_product_number: "P4", name_of_medicine: "Adalimumab Test", substances: "Adalimumab", substance_keys: ["adalimumab"], medicine_status: "Authorised", marketing_authorisation_date: "2020-01-01", medicine_type: "Biosimilar" },
  { ema_product_number: "P5", name_of_medicine: "Truvada", substances: "emtricitabine; tenofovir disoproxil", substance_keys: ["emtricitabine", "tenofovir disoproxil"], medicine_status: "Authorised", marketing_authorisation_date: "2005-02-21", medicine_type: "Other" },
  { ema_product_number: "P6", name_of_medicine: "Hulk", substances: null, substance_keys: [], medicine_status: "Refused", marketing_authorisation_date: null, medicine_type: "Other" },
  { ema_product_number: "P7", name_of_medicine: "Lutetium (177Lu) chloride Billev (previously Illuzyce)", substances: "lutetium (177Lu) chloride", substance_keys: ["lutetium (177lu) chloride"], medicine_status: "Authorised", marketing_authorisation_date: "2022-11-02", medicine_type: "Other" },
  { ema_product_number: "P8", name_of_medicine: "Eurneffy", substances: "epinephrine", substance_keys: ["epinephrine"], medicine_status: "Authorised", marketing_authorisation_date: "2024-08-22", medicine_type: "Other" },
  { ema_product_number: "P9", name_of_medicine: "Ozempic", substances: "semaglutide", substance_keys: ["semaglutide"], medicine_status: "Authorised", marketing_authorisation_date: "2018-02-08", medicine_type: "Other" },
];
const entryTermRows = [
  { entry_term: "bipolar depression", mesh_descriptor_ui: "D1" },
  { entry_term: "bipolar disorder", mesh_descriptor_ui: "D1" },
  { entry_term: "depressive disorder", mesh_descriptor_ui: "D2" },
  { entry_term: "depression disorder", mesh_descriptor_ui: "D2" },
  { entry_term: "depression", mesh_descriptor_ui: "D3" },
  { entry_term: "arthritis, rheumatoid", mesh_descriptor_ui: "D4" },
  { entry_term: "hiv infections", mesh_descriptor_ui: "D5" },
  { entry_term: "hivx", mesh_descriptor_ui: "D6" },
];
const descriptorAreaRows = [
  { mesh_descriptor_ui: "D1", mesh_descriptor_name: "Bipolar Disorder", therapeutic_area_mesh: "Bipolar Disorder" },
  { mesh_descriptor_ui: "D2", mesh_descriptor_name: "Depressive Disorder", therapeutic_area_mesh: "Depressive Disorder" },
  { mesh_descriptor_ui: "D2", mesh_descriptor_name: "Depressive Disorder", therapeutic_area_mesh: "Depressive Disorder, Major" },
  { mesh_descriptor_ui: "D3", mesh_descriptor_name: "Depression", therapeutic_area_mesh: "Depression" },
  { mesh_descriptor_ui: "D4", mesh_descriptor_name: "Arthritis, Rheumatoid", therapeutic_area_mesh: "Arthritis, Rheumatoid" },
  { mesh_descriptor_ui: "D5", mesh_descriptor_name: "HIV Infections", therapeutic_area_mesh: "HIV Infections" },
  { mesh_descriptor_ui: "D6", mesh_descriptor_name: "Other HIV", therapeutic_area_mesh: "HIV Infections" },
];
const areaRows = [
  { ema_product_number: "P1", therapeutic_area_mesh: "Bipolar Disorder" },
  { ema_product_number: "P2", therapeutic_area_mesh: "Bipolar Disorder" },
  { ema_product_number: "P4", therapeutic_area_mesh: "Bipolar Disorder" },
  { ema_product_number: "P2", therapeutic_area_mesh: "Depressive Disorder, Major" },
  { ema_product_number: "P3", therapeutic_area_mesh: "Depressive Disorder" },
  { ema_product_number: "P5", therapeutic_area_mesh: "HIV Infections" },
  { ema_product_number: "P2", therapeutic_area_mesh: "Arthritis, Rheumatoid" },
];
const branchRows = [
  { therapeutic_area_mesh: "Depressive Disorder", mesh_descriptor_ui: "D2" },
  { therapeutic_area_mesh: "Depressive Disorder, Major", mesh_descriptor_ui: "D7" },
];
const index = buildLookupIndex(searchRows, entryTermRows);
const conditions = buildConditions(index, { descriptorAreaRows, areaRows, branchRows });

test("buildConditions precomputes products, authorized counts and narrower terms per descriptor", () => {
  const depressive = conditions.descriptors.get("D2");
  assert.deepEqual([...depressive.products].sort(), ["P2", "P3"]);
  assert.equal(depressive.authorized, 1);
  assert.equal(depressive.narrower, 1);
  assert.deepEqual(depressive.synonyms, ["depressive disorder", "depression disorder"]);
  assert.equal(conditions.termUi.get("Depressive Disorder, Major"), "D7");
});

// Phase 4c review: a condition page tells its own medicines from those tagged only with a narrower
// term (Psoriasis vs Arthritis, Psoriatic), and names the narrower terms.
test("buildConditions tells a descriptor's own products from those tagged with a narrower term", () => {
  const depressive = conditions.descriptors.get("D2");
  assert.deepEqual([...depressive.ownProducts], ["P3"]);
  assert.deepEqual(depressive.narrowerTerms, [{ term: "Depressive Disorder, Major", ui: "D7" }]);
  assert.deepEqual(Object.fromEntries(depressive.narrowerByProduct), { P2: ["Depressive Disorder, Major"] });
  const bipolar = conditions.descriptors.get("D1");
  assert.deepEqual([...bipolar.ownProducts].sort(), ["P1", "P2", "P4"]);
  assert.deepEqual(bipolar.narrowerTerms, []);
});

// A therapeutic area group (MeSH branch) is named after its root descriptor: its condition page.
test("buildConditions finds a descriptor by its name", () => {
  assert.equal(conditions.uiByName.get("Depressive Disorder"), "D2");
  assert.equal(conditions.uiByName.get("Other HIV"), "D6");
  assert.equal(conditions.uiByName.get("Neoplasms"), undefined);
});

test("suggest needs at least 2 characters", () => {
  assert.deepEqual(suggest(index, conditions, "k"), { medicines: [], substances: [], conditions: [], numbered: null });
});

// Design sweep 2026-10-01 (C7): "EU/1/21/1608", "EMEA/H/C/005422" and "005422" found nothing.
test("medicineNumber reads an EMA product number or a pack's EU number as typed", () => {
  const wegovy = { kind: "ema", number: "EMEA/H/C/005422" };
  assert.deepEqual(medicineNumber("EMEA/H/C/005422"), wegovy);
  assert.deepEqual(medicineNumber(" emea / h / c / 005422 "), wegovy);
  assert.deepEqual(medicineNumber("005422"), wegovy);
  const eu = { kind: "eu", number: "EU/1/21/1608" };
  assert.deepEqual(medicineNumber("EU/1/21/1608"), eu);
  assert.deepEqual(medicineNumber("eu/1/21/1608/001"), eu); // a pack's own number
  assert.deepEqual(medicineNumber("EU / 1 / 21 / 1608"), eu);
  assert.deepEqual(medicineNumber("EU/1/96/023"), { kind: "eu", number: "EU/1/96/023" });
  for (const text of ["5422", "0054221", "wegovy", "EU/1/21", "EU/3/21/1608", "L04AC", "glp 1"]) assert.equal(medicineNumber(text), null, text);
  // Typing one: the search asks for the register's EU numbers from "EU/" on.
  for (const text of ["EU/", " eu / 1", "EU/1/21/1608"]) assert.equal(euNumberStarted(text), true, text);
  for (const text of ["EU", "eurneffy", "005422", "EMEA/H/C/005422"]) assert.equal(euNumberStarted(text), false, text);
});

test("a typed number names its medicine: by EMA product number at once, by EU number once the register is in", () => {
  const rows = [{ ema_product_number: "EMEA/H/C/005422", name_of_medicine: "Wegovy", substances: "semaglutide", substance_keys: ["semaglutide"], medicine_status: "Authorised", marketing_authorisation_date: "2022-01-06", medicine_type: "Other" }];
  const numbered = buildLookupIndex(rows, []);
  const register = new Map([["EMEA/H/C/005422", { ema_product_number: "EMEA/H/C/005422", eu_number: "EU/1/21/1608" }], ["EMEA/H/C/000001", { ema_product_number: "EMEA/H/C/000001", eu_number: null }]]);
  const euNumbers = euNumberIndex(register);
  assert.equal(euNumberIndex(register), euNumbers); // built once per dataset
  assert.deepEqual(Object.fromEntries(euNumbers), { "EU/1/21/1608": "EMEA/H/C/005422" });
  assert.equal(suggest(numbered, null, "EMEA/H/C/005422").numbered.row.name_of_medicine, "Wegovy");
  assert.deepEqual(suggest(numbered, null, "005422").numbered.number, "EMEA/H/C/005422");
  const found = suggest(numbered, null, "EU/1/21/1608/001", { euNumbers });
  assert.equal(found.numbered.row.name_of_medicine, "Wegovy");
  assert.equal(found.numbered.number, "EU/1/21/1608");
  assert.equal(suggest(numbered, null, "EU/1/21/1608").numbered, null); // the register not in yet
  assert.equal(medicineByNumber(numbered, "EU/1/99/9999", euNumbers), null);
  assert.equal(medicineByNumber(numbered, "EMEA/H/C/999999"), null);
  // Not also listed by name.
  assert.deepEqual(suggest(numbered, null, "wegovy").numbered, null);
});

// C7 review: Glivec's EU number EU/1/01/198 (no row in the register file) and Wegovy's, with the
// register file failed or still loading, were all "No medicine in the EMA data has the EU number …".
test("numberAnswer says what a typed number tells, and for an EU number only once the register's numbers are in", () => {
  const rows = [
    { ema_product_number: "EMEA/H/C/005422", name_of_medicine: "Wegovy", substances: "semaglutide", substance_keys: ["semaglutide"], medicine_status: "Authorised", marketing_authorisation_date: "2022-01-06", medicine_type: "Other" },
    { ema_product_number: "EMEA/H/C/000406", name_of_medicine: "Glivec", substances: "imatinib", substance_keys: ["imatinib"], medicine_status: "Authorised", marketing_authorisation_date: "2001-11-07", medicine_type: "Other" },
  ];
  const numbered = buildLookupIndex(rows, []);
  // Glivec has no register row, so its EU number is not among the register's.
  const euNumbers = euNumberIndex(new Map([["EMEA/H/C/005422", { ema_product_number: "EMEA/H/C/005422", eu_number: "EU/1/21/1608" }]]));
  const wegovy = numbered.byNumber.get("EMEA/H/C/005422");
  assert.equal(numberAnswer(numbered, "wegovy", euNumbers), null);
  assert.deepEqual(numberAnswer(numbered, "EU/1/21/1608/001", euNumbers), { kind: "eu", number: "EU/1/21/1608", row: wegovy, state: "found" });
  assert.deepEqual(numberAnswer(numbered, "EU/1/01/198", euNumbers), { kind: "eu", number: "EU/1/01/198", row: null, state: "notFound" });
  // The register's numbers loading (undefined) or failed (null): nothing is known of an EU number.
  assert.deepEqual(numberAnswer(numbered, "EU/1/21/1608", undefined), { kind: "eu", number: "EU/1/21/1608", row: null, state: "loading" });
  assert.deepEqual(numberAnswer(numbered, "EU/1/21/1608", null), { kind: "eu", number: "EU/1/21/1608", row: null, state: "unavailable" });
  // An EMA product number needs no register: the search index lists every medicine.
  for (const euState of [undefined, null, euNumbers]) {
    assert.equal(numberAnswer(numbered, "000406", euState).row.name_of_medicine, "Glivec");
    assert.equal(numberAnswer(numbered, "EMEA/H/C/999999", euState).state, "notFound");
  }
  // medicineByNumber() and suggest() name the medicine found only.
  assert.equal(medicineByNumber(numbered, "EU/1/21/1608", undefined), null);
  assert.equal(suggest(numbered, null, "EU/1/21/1608", { euNumbers: undefined }).numbered, null);
  assert.deepEqual(medicineByNumber(numbered, "EU/1/21/1608", euNumbers), { row: wegovy, kind: "eu", number: "EU/1/21/1608" });
});

const registerFile = new URL("../public/data/ema_medicine_register_status.json", import.meta.url);
test(
  "on the real data, every EU number reads as one and names a medicine of the search index (C7)",
  { skip: existsSync(registerFile) && existsSync(new URL("../public/data/ema_search_index.json", import.meta.url)) ? false : "data files not found" },
  () => {
    const rows = JSON.parse(readFileSync(registerFile, "utf8"));
    const searchIndex = buildLookupIndex(JSON.parse(readFileSync(new URL("../public/data/ema_search_index.json", import.meta.url), "utf8")), []);
    const euNumbers = euNumberIndex(new Map(rows.map((row) => [row.ema_product_number, row])));
    const unread = rows.filter((row) => row.eu_number && medicineNumber(row.eu_number)?.number !== row.eu_number);
    assert.deepEqual(unread, []);
    const missing = rows.filter((row) => row.eu_number && medicineByNumber(searchIndex, `${row.eu_number}/001`, euNumbers)?.row.ema_product_number !== row.ema_product_number);
    assert.deepEqual(missing.map((row) => row.eu_number), []);
    assert.deepEqual([...searchIndex.byNumber.keys()].filter((number) => medicineNumber(number)?.number !== number), []);
  },
);

test("medicine names match by word start; exact and prefix matches first, then authorized, then name", () => {
  assert.deepEqual(suggest(index, null, "hu").medicines.map((m) => m.name_of_medicine), ["Humira", "Hulio", "Hulk"]);
  assert.deepEqual(suggest(index, null, "test").medicines.map((m) => m.name_of_medicine), ["Adalimumab Test"]);
  assert.deepEqual(suggest(index, null, "adalimumab").medicines.map((m) => m.name_of_medicine), ["Adalimumab Test"]);
});

test("substances match INN items and carry their product count", () => {
  const { substances } = suggest(index, null, "teno");
  assert.deepEqual(substances.map((s) => [s.key, s.name, s.products.length]), [["tenofovir disoproxil", "tenofovir disoproxil", 1]]);
  assert.deepEqual(suggest(index, null, "ADALIMUMAB").substances.map((s) => [s.name, s.products.length]), [["adalimumab", 3]]);
});

// Bug hunt 2026-10-01 (lookup.md #8): the suggestions' meta counts medicines with status
// Authorised in every group; substances counted every status ("17 medicines" beside "52 authorized").
// main.js counts a substance suggestion by substanceAuthorizedCount() (copies.test.js: every spelling).
test("substances suggested are counted by their authorized medicines, as conditions and companies", () => {
  const authorized = (substance) => substanceAuthorizedCount(substance.key, index.substances, new Map());
  assert.deepEqual(suggest(index, null, "ADALIMUMAB").substances.map((s) => [s.name, authorized(s)]), [["adalimumab", 2]]);
  assert.equal(authorized(index.substances.get("pembrolizumab")), 1);
  // Through another name too (#19: "adrenaline" for epinephrine).
  assert.deepEqual(suggest(index, null, "adrenaline").substances.map((s) => [s.name, s.synonym, authorized(s)]), [["epinephrine", "adrenaline", 1]]);
});

test("conditions: every word must start a word of one entry term; words under 4 characters match whole", () => {
  // A one-word 3-letter query also matches a first word's start (owner decision 2026-10-01, below):
  // "hivx" (D6), after the whole word.
  assert.deepEqual(suggest(index, conditions, "hiv").conditions.map((c) => c.ui), ["D5", "D6"]);
  assert.deepEqual(suggest(index, conditions, "hiv inf").conditions, []);
  assert.deepEqual(suggest(index, conditions, "rheum arth").conditions.map((c) => c.ui), ["D4"]);
  assert.deepEqual(suggest(index, conditions, "depressive disorders").conditions, []);
  assert.deepEqual(suggest(index, conditions, "hiv").medicines, []);
});

// Owner decision 2026-10-01 (design sweep L8): no condition was suggested before the 4th letter.
test("conditions: a one-word 3-letter query matches a term's first word by its start, ranked after whole words", () => {
  const terms = [
    { entry_term: "psoriasis", mesh_descriptor_ui: "C1" },
    { entry_term: "arthritis, psoriatic", mesh_descriptor_ui: "C2" },
    { entry_term: "psoriatic arthritis", mesh_descriptor_ui: "C2" },
    { entry_term: "influenza, human", mesh_descriptor_ui: "C3" },
    { entry_term: "human flu", mesh_descriptor_ui: "C3" },
    { entry_term: "fluorosis, dental", mesh_descriptor_ui: "C4" },
    { entry_term: "lupus erythematosus, cutaneous", mesh_descriptor_ui: "C5" },
  ];
  const named = [["C1", "Psoriasis"], ["C2", "Arthritis, Psoriatic"], ["C3", "Influenza, Human"], ["C4", "Fluorosis, Dental"], ["C5", "Lupus Erythematosus, Cutaneous"]];
  const own = buildLookupIndex(searchRows, terms);
  const ownConditions = buildConditions(own, {
    descriptorAreaRows: named.map(([ui, name]) => ({ mesh_descriptor_ui: ui, mesh_descriptor_name: name, therapeutic_area_mesh: name })),
    // Fluorosis has more authorized medicines than influenza: the whole word still ranks first.
    areaRows: [["P1", "Psoriasis"], ["P2", "Arthritis, Psoriatic"], ["P4", "Fluorosis, Dental"], ["P5", "Fluorosis, Dental"]].map(([number, term]) => ({ ema_product_number: number, therapeutic_area_mesh: term })),
    branchRows: [],
  });
  const found = (query) => suggest(own, ownConditions, query).conditions.map((c) => [c.ui, c.synonym, c.prefix]);
  // The name's first word, else an entry term's (named in the meta line).
  assert.deepEqual(found("pso"), [["C1", null, true], ["C2", "psoriatic arthritis", true]]);
  assert.deepEqual(found("PSO"), found("pso"));
  assert.deepEqual(found("flu"), [["C3", "human flu", false], ["C4", null, true]]);
  // Only a first word: "ery" starts the second word of C5's term.
  assert.deepEqual(found("ery"), []);
  // Two letters, several words, a digit: the rule as before (short words whole).
  for (const query of ["ps", "pso art", "art pso", "h1n", "fl1"]) assert.deepEqual(found(query), [], query);
  // From 4 letters any word's start matches, as before.
  assert.deepEqual(found("psor").map(([ui]) => ui).sort(), ["C1", "C2"]);
  assert.deepEqual(found("eryt").map(([ui]) => ui), ["C5"]);
  // A 3-letter start names no condition (exact): Enter opens one by it only as the only suggestion.
  assert.equal(suggest(own, ownConditions, "pso").conditions.some((c) => c.exact), false);
});

test("conditions rank exact folded match > descriptor-name match > authorized count", () => {
  const ranked = suggest(index, conditions, "depression");
  // D3 exact; D2 and D1 match via synonyms only: D1 has more authorized products.
  assert.deepEqual(ranked.conditions.map((c) => [c.ui, c.name, c.synonym, c.authorized]), [
    ["D3", "Depression", null, 0],
    ["D1", "Bipolar Disorder", "bipolar depression", 3],
    ["D2", "Depressive Disorder", "depression disorder", 1],
  ]);
  // Word order does not matter for an exact match; the descriptor name beats counts.
  assert.equal(suggest(index, conditions, "rheumatoid arthritis").conditions[0].exact, true);
  assert.deepEqual(suggest(index, conditions, "disorder").conditions.map((c) => c.ui), ["D1", "D2"]);
});

test("a condition's text phrases are its folded name and synonyms, inverted MeSH forms read naturally", () => {
  assert.deepEqual(conditionPhrases({ name: "Arthritis, Rheumatoid", synonyms: ["arthritis, rheumatoid"] }), ["arthritis, rheumatoid", "rheumatoid arthritis"]);
  assert.deepEqual(conditionPhrases(conditions.descriptors.get("D2")), ["depressive disorder", "depression disorder"]);
  // Three-part names: MeSH's natural-order entry term is deduplicated away in R, so it is rebuilt here.
  assert.deepEqual(conditionPhrases({ name: "Leukemia, Myeloid, Acute", synonyms: [] }), ["leukemia, myeloid, acute", "acute myeloid leukemia"]);
  assert.deepEqual(conditionPhrases({ name: "Lymphoma, Large B-Cell, Diffuse", synonyms: [] }), ["lymphoma, large b cell, diffuse", "diffuse large b cell lymphoma"]);
});

const atcClasses = [
  { atc_code: "A", level: 1, name: "ALIMENTARY TRACT AND METABOLISM" },
  { atc_code: "A10", level: 2, name: "DRUGS USED IN DIABETES" },
  { atc_code: "A10A", level: 3, name: "INSULINS AND ANALOGUES" },
  { atc_code: "A10AE", level: 4, name: "Insulins and analogues for injection, long-acting" },
  { atc_code: "A10B", level: 3, name: "BLOOD GLUCOSE LOWERING DRUGS, EXCL. INSULINS" },
  { atc_code: "A10BJ", level: 4, name: "Glucagon-like peptide-1 (GLP-1) analogues" },
  { atc_code: "A10BJ06", level: 5, name: "semaglutide" },
  { atc_code: "C10", level: 2, name: "LIPID MODIFYING AGENTS" },
  { atc_code: "L04AC", level: 4, name: "Interleukin inhibitors" },
  // WHO level-5 names without a medicine in the data (the empty search's hint, "did you mean").
  { atc_code: "N02BE", level: 4, name: "Anilides" },
  { atc_code: "N02BE01", level: 5, name: "paracetamol" },
  { atc_code: "C10AA05", level: 5, name: "atorvastatin" },
];
// Authorized-now products per prefix; C10 has none, L01XE and A10AE57 have no WHO name.
const classCounts = new Map([
  ["A", 180], ["A10", 94], ["A10A", 30], ["A10AE", 12], ["A10AE57", 1], ["A10B", 63], ["A10BJ", 11], ["A10BJ06", 4],
  ["L04AC", 33], ["L01XE", 20],
]);
const classCodes = (query) => suggestAtcClasses(query, atcClasses, classCounts).map((row) => row.code);

test("an ATC code query lists the classes under it, shortest code first, then most products", () => {
  assert.deepEqual(classCodes("a10"), ["A10", "A10B", "A10A", "A10AE", "A10BJ", "A10BJ06", "A10AE57"]);
  assert.deepEqual(suggestAtcClasses("A10BJ06", atcClasses, classCounts), [{ code: "A10BJ06", level: 5, name: "semaglutide", count: 4 }]);
  // Codes are not folded ("ae" stays), and codes EMA uses without a WHO name are found too.
  assert.deepEqual(classCodes(" A10ae "), ["A10AE", "A10AE57"]);
  assert.deepEqual(suggestAtcClasses("l01xe", atcClasses, classCounts), [{ code: "L01XE", level: 4, name: null, count: 20 }]);
});

test("a name query matches word starts in level 1-4 class names with products; level-5 names are substances", () => {
  assert.deepEqual(classCodes("glp"), ["A10BJ"]);
  assert.deepEqual(classCodes("semaglutide"), []);
  assert.deepEqual(classCodes("lipid"), []);
  assert.deepEqual(classCodes("interleukin inhib"), ["L04AC"]);
  assert.deepEqual(classCodes("ukin"), []);
});

test("class names rank exact > prefix > contains, then by authorized count", () => {
  assert.deepEqual(classCodes("insulin"), ["A10A", "A10AE", "A10B"]);
  assert.deepEqual(classCodes("analogues"), ["A10A", "A10AE", "A10BJ"]);
  assert.deepEqual(classCodes("Insulins and analogues"), ["A10A", "A10AE"]);
  assert.deepEqual(suggestAtcClasses("glucagon", atcClasses, classCounts), [
    { code: "A10BJ", level: 4, name: "Glucagon-like peptide-1 (GLP-1) analogues", count: 11 },
  ]);
});

test("class suggestions need 2 characters and stop at 8", () => {
  assert.deepEqual(classCodes("a"), []);
  const many = new Map(Array.from({ length: 12 }, (_, index) => [`B01AC${String(index + 1).padStart(2, "0")}`, 1]));
  assert.equal(suggestAtcClasses("B01AC", [], many).length, 8);
});

test("textMatches finds whole-word folded mentions and skips excluded products", () => {
  const products = [
    { ema_product_number: "A", therapeutic_indication: "Treatment of haemophilia A." },
    { ema_product_number: "B", therapeutic_indication: "Plasma-derived" },
    { ema_product_number: "C", therapeutic_indication: "Hemophilia A prophylaxis" },
    { ema_product_number: "D", therapeutic_indication: null },
  ];
  const matches = textMatches(products, ["hemophilia a", "plasma"], new Set(["C"]));
  assert.deepEqual(matches.map((m) => [m.product.ema_product_number, m.snippet.match]), [["A", "haemophilia A"], ["B", "Plasma"]]);
});

// Phase 4c review: Enter (the phone keyboard's Search key) without an option picked opens the
// suggestion the query names ("wegovy" -> Wegovy's card) or the only one; else the text search.
test("submitChoice: the suggestion whose label (or class code) the query is, else the only one, else none", () => {
  const groups = [
    { key: "medicines", options: [{ label: "Wegovy", value: "EMEA/H/C/005422" }, { label: "Wegovy Pen", value: "P9" }] },
    { key: "substances", options: [{ label: "semaglutide", value: "semaglutide" }] },
    { key: "conditions", options: [] },
    { key: "classes", options: [{ label: "L04AC Interleukin Inhibitors", value: "L04AC" }] },
  ];
  assert.deepEqual(submitChoice(groups, " WEGOVY "), { group: "medicines", value: "EMEA/H/C/005422" });
  assert.deepEqual(submitChoice(groups, "Semaglutide"), { group: "substances", value: "semaglutide" });
  assert.deepEqual(submitChoice(groups, "l04ac"), { group: "classes", value: "L04AC" });
  assert.equal(submitChoice(groups, "weg"), null);
  assert.deepEqual(submitChoice([{ key: "medicines", options: [{ label: "Keytruda", value: "P1" }] }], "keytr"), { group: "medicines", value: "P1" });
  assert.equal(submitChoice([], "anything"), null);
  // Companies part 2: a company group the query names by its monogram ("msd" on a phone) opens,
  // though its label differs and other suggestions show.
  const companies = [
    { key: "companies", options: [{ label: "MSD (Merck & Co.)", value: "g.msd", named: true }] },
    { key: "medicines", options: [{ label: "MSD Vaccine", value: "P2" }, { label: "Other", value: "P3" }] },
  ];
  assert.deepEqual(submitChoice(companies, "msd"), { group: "companies", value: "g.msd" });
  companies[0].options[0].named = false;
  assert.equal(submitChoice(companies, "msd"), null);
});

// Step 2 (#4): "ADHD" is an exact MeSH entry term of its condition, which the condition option marks
// as named; "TB" found only Theravance Biopharma through its derived monogram (weak), which Enter
// no longer opens on its own. The indication-text option (#14) and "did you mean" (#5) never open
// by Enter, nor count as the only suggestion.
test("submitChoice: a named condition opens; weak, text-search and fuzzy options never open by Enter", () => {
  const adhd = [
    { key: "conditions", options: [{ label: "Attention Deficit Disorder with Hyperactivity", value: "D001289", named: true }] },
    { key: "classes", options: [{ label: "N06BA Centrally Acting Sympathomimetics", value: "N06BA" }] },
  ];
  assert.deepEqual(submitChoice(adhd, "ADHD"), { group: "conditions", value: "D001289" });
  const tb = [{ key: "companies", options: [{ label: "Theravance Biopharma Ireland Limited", value: "g.theravance-biopharma", weak: true }] }];
  assert.equal(submitChoice(tb, "TB"), null);
  const text = { key: "text", options: [{ label: "Search indication texts for “keytr”", value: "keytr" }] };
  assert.deepEqual(submitChoice([{ key: "medicines", options: [{ label: "Keytruda", value: "P1" }] }, text], "keytr"), { group: "medicines", value: "P1" });
  assert.equal(submitChoice([text], "keytr"), null);
  const fuzzy = { key: "fuzzy", options: [{ label: "Ozempic", value: "P9", pick: "medicines" }] };
  assert.equal(submitChoice([fuzzy, text], "ozempic"), null);
});

test("submitChoice: 'ALL' and 'CAR' open no company through a derived monogram", () => {
  const all = [
    { key: "medicines", options: [{ label: "Alli", value: "M1" }, { label: "Allex", value: "M2" }] },
    { key: "conditions", options: [{ label: "Precursor Cell Lymphoblastic Leukemia-Lymphoma", value: "D054198", named: false }] },
    { key: "companies", options: [{ label: "Allos Therapeutics Ltd", value: "g.allos-therapeutics", named: false, weak: true }] },
  ];
  assert.equal(submitChoice(all, "ALL"), null);
  const car = [{ key: "medicines", options: [{ label: "Carvykti", value: "M3" }] }, { key: "companies", options: [{ label: "Carisma Therapeutics", value: "g.carisma", weak: true }] }];
  assert.equal(submitChoice(car, "CAR"), null);
});

// Bug hunt 2026-10-01 (lookup.md #2): with the conditions, drug classes or companies still loading,
// Enter opens a suggestion the query names at once (a brand typed in the first seconds), but not
// the only one: another may come with the data ("roche": Bondenza now, the company Roche then).
test("submitChoice with onlyNamed: the suggestion the query names, never the only one", () => {
  const one = [{ key: "medicines", options: [{ label: "Bondenza (previously Ibandronic Acid Roche)", value: "P1" }] }];
  assert.deepEqual(submitChoice(one, "roche"), { group: "medicines", value: "P1" });
  assert.equal(submitChoice(one, "roche", { onlyNamed: true }), null);
  const groups = [
    { key: "medicines", options: [{ label: "Humira", value: "P2" }] },
    { key: "classes", options: [{ label: "L04AC Interleukin Inhibitors", value: "L04AC" }] },
    { key: "companies", options: [{ label: "MSD (Merck & Co.)", value: "g.msd", named: true }] },
  ];
  assert.deepEqual(submitChoice(groups, "humira", { onlyNamed: true }), { group: "medicines", value: "P2" });
  assert.deepEqual(submitChoice(groups, "L04ac", { onlyNamed: true }), { group: "classes", value: "L04AC" });
  assert.deepEqual(submitChoice(groups, "msd", { onlyNamed: true }), { group: "companies", value: "g.msd" });
});

// Bug hunt 2026-10-01 (lookup.md #2) and its review: data arriving under an open list rebuilt it
// with the new groups above the options shown ("Roche" above Bondenza, 70px down; "msd": a tap
// aimed at Vorinostat MSD opened Sanofi's company page), and the "Loading…" note above the options
// went (the text search 32px up), so a tap aimed at an option in that moment hit another. Nothing
// shown moves now: the groups and options shown keep their places, new groups come below them,
// where the "Loading…" line was, even one naming the query; the next keystroke sorts as usual.
test("keepShownList: what the list shows stays in place; new groups and notes come below it", () => {
  const option = (label, extra = {}) => ({ label, value: label, ...extra });
  const group = (key, ...labels) => ({ key, options: labels.map((label) => option(label)) });
  const text = group("text", "Search indication texts for “roche”");
  const keys = (list) => list.groups.map((entry) => entry.key);
  const labels = (list) => list.groups.map((entry) => `${entry.key}: ${entry.options.map((item) => item.meta ? `${item.label} (${item.meta})` : item.label).join(", ")}`);
  const notes = { loadingNote: "Loading…", quietNote: "No matches" };
  // Nothing shown (a keystroke): as given, "Loading…" under the list while data loads.
  const loading = { groups: [group("medicines", "Bondenza"), text], note: null, loading: true };
  assert.deepEqual(keepShownList(null, loading, notes), { groups: loading.groups, note: null, end: "Loading…" });
  assert.deepEqual(keepShownList(null, { ...loading, note: "No matches", loading: false }, notes), { groups: loading.groups, note: "No matches", end: null });
  // The companies arrive with the group the query names: below the text search, not above Bondenza.
  const shown = { groups: loading.groups, note: null };
  const roche = { groups: [{ key: "companies", options: [option("Roche", { value: "g.roche", named: true })] }, group("medicines", "Bondenza"), text], note: null, loading: false };
  assert.deepEqual(keys(keepShownList(shown, roche, notes)), ["medicines", "text", "companies"]);
  assert.equal(keepShownList(shown, roche, notes).end, null);
  // Still loading another dataset: "Loading…" stays last, under the new group.
  assert.equal(keepShownList(shown, { ...roche, loading: true }, notes).end, "Loading…");
  // A class named by its code, a condition by its name: the same.
  const psoriasis = { groups: [group("conditions", "Psoriasis"), text], note: null, loading: false };
  assert.deepEqual(keys(keepShownList({ groups: [text], note: null }, psoriasis, notes)), ["text", "conditions"]);
  // A group shown keeps its options and their order: updated in place (an opinion in the meta),
  // one gone now kept as shown, one new to it left for the next keystroke; a group gone now
  // (did you mean, once something matches) kept as shown.
  const medicines = { key: "medicines", options: [option("Kinselby", { meta: "Opinion" }), option("Keytruda", { meta: "Authorized" })] };
  const fuzzy = group("fuzzy", "Keytruda");
  const next = {
    groups: [{ key: "medicines", options: [option("Keytruda", { meta: "Authorized" }), option("Kinselby", { meta: "Opinion (negative)" }), option("Kisplyx")] }, group("conditions", "Keratitis"), text],
    note: null,
    loading: false,
  };
  assert.deepEqual(labels(keepShownList({ groups: [medicines, fuzzy, text], note: null }, next, notes)), [
    "medicines: Kinselby (Opinion (negative)), Keytruda (Authorized)",
    "fuzzy: Keytruda",
    "text: Search indication texts for “roche”",
    "conditions: Keratitis",
  ]);
  // The note shown above the options stays (as it reads now); one the list did not show comes
  // below it, but "No matches", which the status says and a "Did you mean" heading shows.
  const retried = { groups: [group("medicines", "Ozempic"), text], note: "Showing results for “ozempic”", loading: false };
  assert.equal(keepShownList({ groups: retried.groups, note: "Showing results for “ozempic”" }, retried, notes).note, "Showing results for “ozempic”");
  assert.deepEqual(keepShownList({ groups: [fuzzy, text], note: null }, { groups: [fuzzy, text], note: "No matches", loading: false }, notes), { groups: [fuzzy, text], note: null, end: null });
  const known = "Paracetamol (ATC N02BE01): no medicine with it went through EMA's central procedure, but it may be authorized nationally.";
  assert.deepEqual(keepShownList({ groups: [text], note: null }, { groups: [text], note: known, loading: false }, notes), { groups: [text], note: null, end: known });
  // Empty groups are no groups.
  assert.deepEqual(keys(keepShownList({ groups: [text], note: null }, { groups: [text, { key: "classes", options: [] }], note: null, loading: false }, notes)), ["text"]);
});

test("suggest: 'IL-17' no longer finds Lutetium Billev (previously Illuzyce); 'glp1' reads as GLP-1", () => {
  assert.deepEqual(suggest(index, null, "IL-17").medicines, []);
  assert.deepEqual(suggest(index, null, "lutetium 177").medicines.map((row) => row.ema_product_number), ["P7"]);
  assert.deepEqual(classCodes("glp1"), ["A10BJ"]);
});

// Step 2 review, on real records: splitting "h1n1" into four free words listed only H5N1 vaccines;
// "b12" opened Hepacare ("hepatitis B" + "C127I") and "a1c" Clopidogrel 1A Pharma; "hep b", "ins gla"
// and "hum ins" found nothing once a short word had to be whole.
const moreRows = [
  { ema_product_number: "EMEA/H/C/003963", name_of_medicine: "Pandemic influenza vaccine H5N1 AstraZeneca (previously Pandemic influenza vaccine H5N1 Medimmune)", substances: "pandemic influenza vaccine (H5N1) (live attenuated, nasal)", substance_keys: ["pandemic influenza vaccine (h5n1) (live attenuated, nasal)"], medicine_status: "Authorised", marketing_authorisation_date: "2016-05-20", medicine_type: "Other" },
  { ema_product_number: "EMEA/H/C/000710", name_of_medicine: "Focetria", substances: "influenza vaccine H1N1v (surface antigen, inactivated, adjuvanted)", substance_keys: ["influenza vaccine h1n1v (surface antigen, inactivated, adjuvanted)"], medicine_status: "Expired", marketing_authorisation_date: "2007-05-02", medicine_type: "Other" },
  { ema_product_number: "EMEA/H/C/000261", name_of_medicine: "Hepacare", substances: "hepatitis B surface antigens recombinant (S, pre-S1, pre-S2) adsorbed on aluminium hydroxide [produced on genetically engineered murine (C127I) cells]", substance_keys: ["hepatitis b surface antigens recombinant (s, pre-s1, pre-s2) adsorbed on aluminium hydroxide [produced on genetically engineered murine (c127i) cells]"], medicine_status: "Withdrawn", marketing_authorisation_date: "2000-08-04", medicine_type: "Other" },
  { ema_product_number: "EMEA/H/C/005063", name_of_medicine: "Heplisav B", substances: "hepatitis B surface antigen", substance_keys: ["hepatitis b surface antigen"], medicine_status: "Authorised", marketing_authorisation_date: "2021-02-18", medicine_type: "Other" },
  { ema_product_number: "EMEA/H/C/001054", name_of_medicine: "Clopidogrel 1A Pharma", substances: "clopidogrel", substance_keys: ["clopidogrel"], medicine_status: "Withdrawn", marketing_authorisation_date: "2009-07-28", medicine_type: "Generic" },
  { ema_product_number: "EMEA/H/C/000284", name_of_medicine: "Lantus", substances: "insulin glargine", substance_keys: ["insulin glargine"], medicine_status: "Authorised", marketing_authorisation_date: "2000-06-09", medicine_type: "Other" },
  { ema_product_number: "EMEA/H/C/000424", name_of_medicine: "Actrapid", substances: "human insulin (rDNA)", substance_keys: ["human insulin (rdna)"], medicine_status: "Authorised", marketing_authorisation_date: "2002-10-07", medicine_type: "Other" },
];
const moreIndex = buildLookupIndex([...searchRows, ...moreRows], []);
const found = (query) => {
  const { medicines, substances } = suggest(moreIndex, null, query);
  return [...medicines.map((row) => row.name_of_medicine), ...substances.map((substance) => substance.key)];
};

test("suggest: 'H1N1' finds no H5N1 vaccine, 'b12', 'a1c' and 'v1' nothing", () => {
  assert.deepEqual(found("H1N1"), ["influenza vaccine h1n1v (surface antigen, inactivated, adjuvanted)"]);
  assert.deepEqual(found("H5N1"), [moreRows[0].name_of_medicine, moreRows[0].substance_keys[0]]);
  assert.deepEqual(found("b12"), []);
  assert.deepEqual(found("a1c"), []);
  assert.deepEqual(found("v1"), []);
});

test("suggest: 'hep b', 'ins gla' and 'hum ins' find their substances; 'glp1', 'lutetium 177' and '177lu' still work", () => {
  assert.deepEqual(found("hep b"), [
    "Heplisav B",
    "hepatitis b surface antigen",
    "hepatitis b surface antigens recombinant (s, pre-s1, pre-s2) adsorbed on aluminium hydroxide [produced on genetically engineered murine (c127i) cells]",
  ]);
  assert.deepEqual(found("ins gla"), ["insulin glargine"]);
  assert.deepEqual(found("hum ins"), ["human insulin (rdna)"]);
  assert.deepEqual(found("IL-17"), []);
  assert.deepEqual(found("lutetium 177").slice(0, 1), ["Lutetium (177Lu) chloride Billev (previously Illuzyce)"]);
  assert.deepEqual(found("177lu").slice(0, 1), ["Lutetium (177Lu) chloride Billev (previously Illuzyce)"]);
  assert.deepEqual(classCodes("glp1"), ["A10BJ"]);
});

// Step 2 (#3): text copied from a pack or the news ("Ozempic 1 mg", "Mounjaro pen", "weight loss
// drug") names more than the medicine: the dose, form and qualifier words go, then the last word.
test("relaxedQueries drops dose, form and qualifier words, a leading 'anti', then the last word", () => {
  assert.deepEqual(relaxedQueries("Ozempic 1 mg"), ["ozempic"]);
  assert.deepEqual(relaxedQueries("Wegovy 2.4mg"), ["wegovy"]);
  assert.deepEqual(relaxedQueries("Keytruda 25 mg/ml"), ["keytruda"]);
  assert.deepEqual(relaxedQueries("Mounjaro pen"), ["mounjaro"]);
  assert.deepEqual(relaxedQueries("Wegovy tablets"), ["wegovy"]);
  assert.deepEqual(relaxedQueries("Stelara biosimilar"), ["stelara"]);
  assert.deepEqual(relaxedQueries("weight loss drug"), ["weight loss", "weight"]);
  assert.deepEqual(relaxedQueries("HPV vaccine"), ["hpv"]);
  assert.deepEqual(relaxedQueries("adalimumab-atto"), ["adalimumab"]);
  assert.deepEqual(relaxedQueries("Keytruda melanoma"), ["keytruda"]);
  assert.deepEqual(relaxedQueries("anti-TNF"), ["tnf"]);
  assert.deepEqual(relaxedQueries("anti-CD20"), ["cd 20"]);
  // A number without a unit stays (a strength without its unit reads as part of a name).
  assert.deepEqual(relaxedQueries("Ozempic 2 pens"), ["ozempic 2", "ozempic"]);
  // Nothing to drop, or what is left is too short to mean anything ("il", "car").
  assert.deepEqual(relaxedQueries("ozempic"), []);
  assert.deepEqual(relaxedQueries("IL-17"), []);
  assert.deepEqual(relaxedQueries("car t"), []);
  assert.deepEqual(relaxedQueries("anti"), []);
  assert.deepEqual(relaxedQueries("mg"), []);
});

test("searchWithFallback: the typed query first, then each relaxed query until one finds something", () => {
  const results = {
    "ozempic": [{ key: "medicines", options: [{ label: "Ozempic", value: "P9" }] }],
    "weight loss": [{ key: "conditions", options: [] }],
    "weight": [{ key: "conditions", options: [{ label: "Body Weight", value: "D1" }] }],
  };
  const run = (query) => results[query] ?? [{ key: "medicines", options: [] }];
  assert.deepEqual(searchWithFallback("Ozempic 1 mg", run), { groups: results.ozempic, shownFor: "ozempic" });
  assert.deepEqual(searchWithFallback("ozempic", run), { groups: results.ozempic, shownFor: null });
  assert.deepEqual(searchWithFallback("weight loss drug", run), { groups: results.weight, shownFor: "weight" });
  assert.deepEqual(searchWithFallback("paracetamol", run), { groups: [{ key: "medicines", options: [] }], shownFor: null });
});

test("editDistance counts insertions, deletions, substitutions and adjacent swaps, stopping past a limit", () => {
  assert.equal(editDistance("ozempik", "ozempic"), 1);
  assert.equal(editDistance("semaglutde", "semaglutide"), 1);
  assert.equal(editDistance("semaglutdie", "semaglutide"), 1); // a swap
  assert.equal(editDistance("mounjaru", "mounjaro"), 1);
  assert.equal(editDistance("abc", "abc"), 0);
  assert.equal(editDistance("", "abc"), 3);
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.equal(editDistance("kitten", "sitting", 1), 2); // limit + 1 once it must exceed the limit
  assert.equal(editDistance("a", "abcdef", 2), 3);
});

// Step 2 (#5): names heard in a talk ("Ozempik", "pembrolizumav"): only when nothing else matched.
test("didYouMean: close names within 1 edit (4-6 characters) or 2 (longer), authorized first, at most 3", () => {
  const names = (query) => didYouMean(index, query, atcClasses).map((entry) => [entry.kind, entry.label, entry.distance]);
  assert.deepEqual(names("Ozempik"), [["medicine", "Ozempic", 1]]);
  assert.deepEqual(names("adalimumav"), [["substance", "adalimumab", 1]]); // not also "Adalimumab Test"
  assert.deepEqual(names("humra"), [["medicine", "Humira", 1]]);
  assert.deepEqual(names("keytrda 1 mg"), [["medicine", "Keytruda", 1]]); // dose words dropped first
  // Authorized first, then by name: Hulio (Withdrawn) and Hulk (Refused) at 1 edit from "huli".
  assert.deepEqual(names("hulx"), [["medicine", "Hulk", 1]]);
  assert.deepEqual(names("huli"), [["medicine", "Hulio", 1], ["medicine", "Hulk", 1]]);
  // WHO level-5 names of substances with no medicine in the data; an exact one is knownSubstance()'s.
  assert.deepEqual(names("paracetamoll"), [["who", "paracetamol", 1]]);
  assert.deepEqual(names("paracetamol"), []);
  // Short queries (under 4 characters) and far names: none.
  assert.deepEqual(names("hum"), []);
  assert.deepEqual(names("zzzzzzzz"), []);
  assert.ok(didYouMean(index, "hul", atcClasses).length === 0);
  const many = buildLookupIndex(["Abcde", "Abcdf", "Abcdg", "Abcdh"].map((name, position) => ({
    ...searchRows[0], ema_product_number: `Q${position}`, name_of_medicine: name, substance_keys: [], medicine_status: position === 3 ? "Authorised" : "Withdrawn",
  })), []);
  assert.deepEqual(didYouMean(many, "abcdx", []).map((entry) => entry.label), ["Abcdh", "Abcde", "Abcdf"]);
});

// Step 2 (#2): paracetamol is a real substance with no medicine through EMA: the empty search says so.
test("knownSubstance: a WHO level-5 name the query is, when no medicine in the data has it", () => {
  assert.deepEqual(knownSubstance(index, " Paracetamol ", atcClasses), { code: "N02BE01", name: "paracetamol" });
  assert.equal(knownSubstance(index, "semaglutide", atcClasses), null); // Ozempic has it
  assert.equal(knownSubstance(index, "paracet", atcClasses), null);
  assert.equal(knownSubstance(index, "paracetamol", []), null);
});

// Step 2 (#19): EMA uses the INN; people say adrenaline, cyclosporine or aspirin.
test("spellingVariant: another name of a substance becomes the name EMA uses", () => {
  assert.deepEqual(spellingVariant("Adrenaline"), { alias: "adrenaline", target: "epinephrine", query: "epinephrine" });
  assert.deepEqual(spellingVariant("aspirin 100 mg"), { alias: "aspirin", target: "acetylsalicylic acid", query: "acetylsalicylic acid 100 mg" });
  assert.equal(spellingVariant("epinephrine"), null);
  assert.equal(spellingVariant("adrena"), null);
  assert.ok(Object.keys(SPELLING_VARIANTS).length >= 10);
});

test("suggest: a substance found through another name says which name matched", () => {
  const found = suggest(index, null, "adrenaline").substances;
  assert.deepEqual(found.map((substance) => [substance.key, substance.synonym, substance.named]), [["epinephrine", "adrenaline", true]]);
  // The literal name still comes first and carries no synonym.
  assert.deepEqual(suggest(index, null, "epinephrine").substances.map((substance) => [substance.key, substance.synonym ?? null]), [["epinephrine", null]]);
  assert.deepEqual(submitChoice([{ key: "substances", options: [{ label: "epinephrine", value: "epinephrine", named: true }] }], "adrenaline"), { group: "substances", value: "epinephrine" });
});

test("textPhrases: the typed text, its letters split from digits, and the name EMA uses", () => {
  assert.deepEqual(textPhrases("aspirin"), { phrases: ["aspirin", "acetylsalicylic acid"], variant: "acetylsalicylic acid" });
  assert.deepEqual(textPhrases("glp1"), { phrases: ["glp1", "glp 1"], variant: null });
  assert.deepEqual(textPhrases("NSCLC"), { phrases: ["nsclc"], variant: null });
  assert.deepEqual(textPhrases("Arthritis, Rheumatoid"), { phrases: ["arthritis, rheumatoid"], variant: null });
});

const searchIndexFile = new URL("ema_search_index.json", dataDir);
test(
  "every spelling variant leads to a substance or an indication text in the data",
  { skip: existsSync(searchIndexFile) && existsSync(medicinesFile) ? false : "site/public/data files not found" },
  () => {
    const keys = new Set(JSON.parse(readFileSync(searchIndexFile, "utf8")).flatMap((row) => row.substance_keys ?? []));
    const medicines = JSON.parse(readFileSync(medicinesFile, "utf8"));
    const missing = Object.entries(SPELLING_VARIANTS).filter(([alias, target]) =>
      keys.has(alias) || (!keys.has(target) && textMatches(medicines, [target]).length === 0));
    assert.deepEqual(missing, []);
  },
);

// Laws of UX, second pass (owner decision 2026-09-30): on phones each group shows at most 3
// suggestions, those the query names first, then "Show all" (the search box's) for the rest.
test("collapseGroups: at most 3 per group on phones, the named match first, expandable in place", () => {
  const option = (label, fields = {}) => ({ label, value: label.toLowerCase(), ...fields });
  const groups = [
    { key: "medicines", options: ["Humira", "Hulio", "Humalog", "Humulin", "Hukyndra"].map((label) => option(label)) },
    { key: "substances", options: [option("human albumin"), option("human fibrinogen"), option("human thrombin"), option("humira", { named: true }), option("x")] },
    { key: "conditions", options: ["A", "B", "C", "D"].map((label) => option(label)) },
    { key: "classes", options: ["L04AB Tumor Necrosis Factor Alpha (TNF-α) Inhibitors", "L04", "L04A", "L04AB04", "L01"].map((label) => option(label)) },
    { key: "fuzzy", options: ["a", "b", "c", "d", "e"].map((label) => option(label)) },
    { key: "text", options: [option("Search indication texts for “humira”")] },
  ];
  assert.equal(PHONE_GROUP_LIMIT, 3);
  const collapsed = collapseGroups(groups, "Humira");
  const labels = (key, list = collapsed) => list.find((group) => group.key === key).options.map((entry) => entry.label);
  const hidden = (key, list = collapsed) => list.find((group) => group.key === key).hidden;
  assert.deepEqual(labels("medicines"), ["Humira", "Hulio", "Humalog"]);
  assert.equal(hidden("medicines"), 2);
  // The option the query names comes first (marked named, or its label, or a class's code, is the query).
  assert.deepEqual(labels("substances"), ["humira", "human albumin", "human fibrinogen"]);
  // One more than the limit: shown whole, as "Show all 4" would take the same row.
  assert.deepEqual(labels("conditions"), ["A", "B", "C", "D"]);
  assert.equal(hidden("conditions"), 0);
  assert.deepEqual(labels("classes", collapseGroups(groups, "l04ab04")).slice(0, 1), ["L04AB04"]);
  // Did you mean and the indication-text search are never collapsed.
  assert.equal(labels("fuzzy").length, 5);
  assert.equal(hidden("fuzzy"), 0);
  assert.deepEqual(labels("text"), ["Search indication texts for “humira”"]);
  // Expanded: every option, the shown ones first in the same order, nothing hidden.
  const expanded = collapseGroups(groups, "Humira", { expanded: new Set(["substances"]) });
  assert.deepEqual(labels("substances", expanded), ["humira", "human albumin", "human fibrinogen", "human thrombin", "x"]);
  assert.equal(hidden("substances", expanded), 0);
  assert.equal(hidden("medicines", expanded), 2);
  // Nothing is lost: shown plus hidden is every option.
  for (const group of collapsed) assert.equal(group.options.length + group.hidden, groups.find((other) => other.key === group.key).options.length);
});