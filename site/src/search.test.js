import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  buildConditions,
  buildLookupIndex,
  conditionPhrases,
  findWholeWord,
  foldSearchText,
  foldWithMap,
  makeSnippet,
  searchWords,
  suggest,
  suggestAtcClasses,
  textMatches,
} from "./search.js";

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

test("suggest needs at least 2 characters", () => {
  assert.deepEqual(suggest(index, conditions, "k"), { medicines: [], substances: [], conditions: [] });
});

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

test("conditions: every word must start a word of one entry term; words under 4 characters match whole", () => {
  assert.deepEqual(suggest(index, conditions, "hiv").conditions.map((c) => c.ui), ["D5"]);
  assert.deepEqual(suggest(index, conditions, "rheum arth").conditions.map((c) => c.ui), ["D4"]);
  assert.deepEqual(suggest(index, conditions, "depressive disorders").conditions, []);
  assert.deepEqual(suggest(index, conditions, "hiv").medicines, []);
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
