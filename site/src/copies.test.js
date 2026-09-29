import { test } from "node:test";
import assert from "node:assert/strict";
import { copiesLinePlan, copiesSummary, countedFromName, equivalentSetKey, firstApprovalShown, followsReference, setGroups, siblingSubstances, substanceEquivalents, substanceGroup, substanceSetCount } from "./copies.js";

// ema_substance_equivalents.json rows (hand-checked pairs; both directions in the file).
const pair = (substance_key, equivalent_key) => ({
  substance_key, equivalent_key, basis: "curated", evidence_url: "https://www.ema.europa.eu/", checked_date: "2026-09-28", source: "curated",
});
const EQUIVALENT_ROWS = [
  pair("dasatinib", "dasatinib (anhydrous)"), pair("dasatinib (anhydrous)", "dasatinib"),
  pair("metformin", "metformin hydrochloride"), pair("metformin hydrochloride", "metformin"),
  // Two pairs through one key: the three keys name one substance.
  pair("sitagliptin", "sitagliptin fumarate"), pair("sitagliptin", "sitagliptin hydrochloride monohydrate"),
];

// Search-index rows (real products, ema_search_index.json 2026-09-28).
const medicine = (ema_product_number, name_of_medicine, substance_keys, medicine_type, medicine_status, marketing_authorisation_date) => ({
  ema_product_number, name_of_medicine, substance_keys, medicine_type, medicine_status, marketing_authorisation_date,
});
const TRUDEXA = medicine("EMEA/H/C/000482", "Trudexa", ["adalimumab"], "Other", "Withdrawn", "2003-09-01");
const HUMIRA = medicine("EMEA/H/C/000481", "Humira", ["adalimumab"], "Other", "Authorised", "2003-09-08");
const AMGEVITA = medicine("EMEA/H/C/004212", "Amgevita", ["adalimumab"], "Biosimilar", "Authorised", "2017-03-21");
const SOLYMBIC = medicine("EMEA/H/C/004373", "Solymbic", ["adalimumab"], "Biosimilar", "Withdrawn", "2017-03-22");
const IMRALDI = medicine("EMEA/H/C/004279", "Imraldi", ["adalimumab"], "Biosimilar", "Authorised", "2017-08-24");
const HYRIMOZ = medicine("EMEA/H/C/004320", "Hyrimoz", ["adalimumab"], "Biosimilar", "Authorised", "2018-07-26");
const HEFIYA = medicine("EMEA/H/C/004865", "Hefiya", ["adalimumab"], "Biosimilar", "Authorised", "2018-07-26");
const FYZOCLAD = medicine("EMEA/H/C/005253", "Fyzoclad", ["adalimumab"], "Other", "Application withdrawn", null);
const OZEMPIC = medicine("EMEA/H/C/004174", "Ozempic", ["semaglutide"], "Other", "Authorised", "2018-02-08");
const RYBELSUS = medicine("EMEA/H/C/004953", "Rybelsus", ["semaglutide"], "Other", "Authorised", "2020-04-03");
const WEGOVY = medicine("EMEA/H/C/005422", "Wegovy", ["semaglutide"], "Other", "Authorised", "2022-01-06");
const KYINSU = medicine("EMEA/H/C/006279", "Kyinsu", ["insulin icodec", "semaglutide"], "Other", "Authorised", "2025-11-24");
const SPRYCEL = medicine("EMEA/H/C/000709", "Sprycel", ["dasatinib (anhydrous)"], "Other", "Authorised", "2006-11-20");
const DASATINIB_ACCORD = medicine("EMEA/H/C/005446", "Dasatinib Accord", ["dasatinib (anhydrous)"], "Generic", "Withdrawn", "2022-03-24");
const DASATINIB_ACCORD_HEALTHCARE = medicine("EMEA/H/C/006251", "Dasatinib Accord Healthcare", ["dasatinib"], "Generic", "Authorised", "2024-07-26");
const ROWS = [TRUDEXA, HUMIRA, AMGEVITA, SOLYMBIC, IMRALDI, HYRIMOZ, HEFIYA, FYZOCLAD, OZEMPIC, RYBELSUS, WEGOVY, KYINSU, SPRYCEL, DASATINIB_ACCORD, DASATINIB_ACCORD_HEALTHCARE];

// ema_medicine_companies.json group_key.
const GROUPS = new Map([
  [HUMIRA.ema_product_number, "g.abbvie"], [TRUDEXA.ema_product_number, "g.abbvie"], [AMGEVITA.ema_product_number, "g.amgen"],
  [SOLYMBIC.ema_product_number, "g.amgen"], [IMRALDI.ema_product_number, "g.samsung-bioepis"], [HYRIMOZ.ema_product_number, "g.sandoz"],
  [HEFIYA.ema_product_number, "g.sandoz"],
]);
const groupOf = (number) => GROUPS.get(number) ?? null;

test("substanceEquivalents: each key maps to the others naming the same substance, both ways and through chains", () => {
  const equivalents = substanceEquivalents(EQUIVALENT_ROWS);
  assert.deepEqual([...equivalents.get("dasatinib")], ["dasatinib (anhydrous)"]);
  assert.deepEqual([...equivalents.get("dasatinib (anhydrous)")], ["dasatinib"]);
  // Only sitagliptin's pairs are listed; its two salts are the same substance too.
  assert.deepEqual([...equivalents.get("sitagliptin fumarate")].sort(), ["sitagliptin", "sitagliptin hydrochloride monohydrate"]);
  assert.equal(equivalents.has("adalimumab"), false);
});

test("substanceEquivalents: no file (older data) or a row naming its own key gives no equivalents", () => {
  assert.equal(substanceEquivalents(undefined).size, 0);
  assert.equal(substanceEquivalents([pair("x", "x")]).size, 0);
});

test("equivalentSetKey: a medicine's substance set with each substance named once, as substance_set_key", () => {
  const equivalents = substanceEquivalents(EQUIVALENT_ROWS);
  assert.equal(equivalentSetKey(["dasatinib (anhydrous)"], equivalents), "dasatinib");
  assert.equal(equivalentSetKey(["sitagliptin fumarate", "metformin hydrochloride"], equivalents), "metformin|sitagliptin");
  assert.equal(equivalentSetKey(["semaglutide", "insulin icodec", "semaglutide"], equivalents), "insulin icodec|semaglutide");
  assert.equal(equivalentSetKey(["adalimumab"], new Map()), "adalimumab");
  assert.equal(equivalentSetKey([], equivalents), null);
  assert.equal(equivalentSetKey(undefined, equivalents), null);
});

// Step 4 (#10): "N medicines, K active substances or combinations" per condition (Giant Cell Tumor
// of Bone: 15 medicines, 1 substance; a combination counts on its own, so the copy names it).
test("substanceSetCount: distinct substance sets, salts of one substance once, combinations apart", () => {
  const equivalents = substanceEquivalents(EQUIVALENT_ROWS);
  const keys = [SPRYCEL, DASATINIB_ACCORD_HEALTHCARE, OZEMPIC, WEGOVY, KYINSU, FYZOCLAD].map((row) => row.substance_keys);
  // dasatinib, semaglutide, insulin icodec|semaglutide, adalimumab.
  assert.equal(substanceSetCount(keys, equivalents), 4);
  // Without the pair table the salt spelling counts apart.
  assert.equal(substanceSetCount(keys, new Map()), 5);
  // Medicines without substances are not counted.
  assert.equal(substanceSetCount([null, [], undefined], equivalents), 0);
});

test("setGroups: medicines by substance set, salts of one substance together, combinations apart", () => {
  const groups = setGroups(ROWS, substanceEquivalents(EQUIVALENT_ROWS));
  assert.deepEqual(groups.get("dasatinib").map((row) => row.name_of_medicine), ["Sprycel", "Dasatinib Accord", "Dasatinib Accord Healthcare"]);
  assert.deepEqual(groups.get("semaglutide").map((row) => row.name_of_medicine), ["Ozempic", "Rybelsus", "Wegovy"]);
  assert.deepEqual(groups.get("insulin icodec|semaglutide").map((row) => row.name_of_medicine), ["Kyinsu"]);
  // Without the pair table, the salt spelling splits the substance (as EMA's data does).
  assert.equal(setGroups(ROWS, new Map()).get("dasatinib").length, 1);
});

test("copiesSummary: an originator's authorized biosimilars, their company groups and the first of them", () => {
  const groups = setGroups(ROWS, new Map());
  const summary = copiesSummary(HUMIRA, groups.get("adalimumab"), groupOf);
  assert.equal(summary.copy, false);
  assert.deepEqual(summary.copies.map(({ type, count, companies, first }) => ({ type, count, companies, first: first.name_of_medicine })), [
    // Withdrawn Solymbic is not counted; Hyrimoz and Hefiya are one company group.
    { type: "Biosimilar", count: 4, companies: 3, first: "Amgevita" },
  ]);
  assert.equal(summary.others, 4);
  // The first central approval of the set is another medicine's, before Humira's.
  assert.equal(summary.first, TRUDEXA);
});

test("copiesSummary: a copy counts the other authorized medicines of its set and names the first approval", () => {
  const summary = copiesSummary(HYRIMOZ, setGroups(ROWS, new Map()).get("adalimumab"), groupOf);
  assert.equal(summary.copy, true);
  assert.equal(summary.others, 4); // Humira, Amgevita, Imraldi, Hefiya
  assert.equal(summary.first, TRUDEXA);
});

test("copiesSummary: no copies yet, and the first approval of the set when it came before this medicine", () => {
  const groups = setGroups(ROWS, new Map());
  const wegovy = copiesSummary(WEGOVY, groups.get("semaglutide"), groupOf);
  assert.deepEqual(wegovy.copies, []);
  assert.equal(wegovy.others, 2);
  assert.equal(wegovy.first, OZEMPIC);
  // Ozempic was the first: no earlier approval to name.
  assert.equal(copiesSummary(OZEMPIC, groups.get("semaglutide"), groupOf).first, null);
});

test("copiesSummary: with the pair table, a salt spelling's generic counts as a copy of the originator", () => {
  const groups = setGroups(ROWS, substanceEquivalents(EQUIVALENT_ROWS));
  const sprycel = copiesSummary(SPRYCEL, groups.get("dasatinib"), groupOf);
  assert.deepEqual(sprycel.copies.map(({ type, count, first }) => ({ type, count, first: first.name_of_medicine })), [
    { type: "Generic", count: 1, first: "Dasatinib Accord Healthcare" },
  ]);
  const generic = copiesSummary(DASATINIB_ACCORD_HEALTHCARE, groups.get("dasatinib"), groupOf);
  assert.equal(generic.others, 1);
  assert.equal(generic.first, SPRYCEL);
});

test("copiesSummary: company groups unknown (not loaded) count as null; generics before biosimilars", () => {
  const generic = medicine("G1", "Generic one", ["x"], "Generic", "Authorised", "2020-01-01");
  const biosimilar = medicine("B1", "Biosimilar one", ["x"], "Biosimilar", "Authorised", "2019-01-01");
  const undated = medicine("G2", "Generic two", ["x"], "Generic", "Authorised", null);
  const own = medicine("O1", "Own", ["x"], "Other", "Authorised", "2010-01-01");
  const summary = copiesSummary(own, [own, biosimilar, undated, generic], null);
  assert.deepEqual(summary.copies.map(({ type, count, companies, first }) => ({ type, count, companies, first: first.name_of_medicine })), [
    { type: "Generic", count: 2, companies: null, first: "Generic one" },
    { type: "Biosimilar", count: 1, companies: null, first: "Biosimilar one" },
  ]);
});

test("copiesSummary: a medicine never approved counts the set's first approval as before it", () => {
  const summary = copiesSummary(FYZOCLAD, setGroups(ROWS, new Map()).get("adalimumab"), groupOf);
  assert.equal(summary.first, TRUDEXA);
});

// ema_medicine_protection.json rows (2026-09-28): R names one brand of the first approval's company
// approved within 30 days of it (an authorized one: Humira over Trudexa a week earlier), and
// counted_from is the first approval's date, not always the named brand's own (Humira's rows count
// from Trudexa's 1 Sep 2003). The card names a medicine with its own date.
const reference = (row, ref, counted_from, basis = "own") => ({
  ema_product_number: row.ema_product_number, basis, reference_product_number: ref.ema_product_number, reference_name: ref.name_of_medicine, counted_from,
});

test("firstApprovalShown: the set's first dated medicine, named by the estimate's reference when approved that day", () => {
  const groups = setGroups(ROWS, new Map());
  const hyrimoz = copiesSummary(HYRIMOZ, groups.get("adalimumab"), groupOf);
  const follows = reference(HYRIMOZ, HUMIRA, "2003-09-01", "follows_reference");
  // Humira was approved a week after the first approval, Trudexa's: Trudexa with its own date.
  assert.deepEqual(firstApprovalShown(HYRIMOZ, hyrimoz, follows, HUMIRA.marketing_authorisation_date),
    { name: "Trudexa", date: "2003-09-01", number: TRUDEXA.ema_product_number });
  const humira = copiesSummary(HUMIRA, groups.get("adalimumab"), groupOf);
  assert.equal(firstApprovalShown(HUMIRA, humira, reference(HUMIRA, HUMIRA, "2003-09-01"), HUMIRA.marketing_authorisation_date).name, "Trudexa");
  // The reference approved on the first day names it (Ozempic for Wegovy).
  const wegovy = copiesSummary(WEGOVY, groups.get("semaglutide"), groupOf);
  assert.deepEqual(firstApprovalShown(WEGOVY, wegovy, reference(WEGOVY, OZEMPIC, "2018-02-08"), "2018-02-08"),
    { name: "Ozempic", date: "2018-02-08", number: OZEMPIC.ema_product_number });
  // No estimate (never approved, or its reference not found): the first dated medicine.
  const fyzoclad = copiesSummary(FYZOCLAD, groups.get("adalimumab"), groupOf);
  assert.deepEqual(firstApprovalShown(FYZOCLAD, fyzoclad, undefined, null), { name: "Trudexa", date: "2003-09-01", number: TRUDEXA.ema_product_number });
  assert.equal(firstApprovalShown(HYRIMOZ, hyrimoz, { ...follows, basis: "reference_not_found", reference_product_number: null }, null).name, "Trudexa");
  assert.equal(firstApprovalShown(OZEMPIC, copiesSummary(OZEMPIC, groups.get("semaglutide"), groupOf), undefined, null), null);
});

// Step 3 review: the reference can be approved days after this medicine (Iscover 14 Jul 1998,
// Plavix the next day; Trudexa a week before Humira): this medicine came first, so the card names
// no earlier "first central approval", whether counted_from is the first day or (older files) the
// reference's own date.
test("firstApprovalShown: a reference approved after this medicine is not named as its first approval", () => {
  const iscover = medicine("EMEA/H/C/000175", "Iscover", ["clopidogrel"], "Other", "Authorised", "1998-07-14");
  const plavix = medicine("EMEA/H/C/000174", "Plavix", ["clopidogrel"], "Other", "Authorised", "1998-07-15");
  const clopidogrel = copiesSummary(iscover, [plavix, iscover], groupOf);
  for (const countedFrom of ["1998-07-14", "1998-07-15"]) {
    assert.equal(firstApprovalShown(iscover, clopidogrel, reference(iscover, plavix, countedFrom), "1998-07-15"), null);
  }
  const adalimumab = setGroups(ROWS, new Map()).get("adalimumab");
  assert.equal(firstApprovalShown(TRUDEXA, copiesSummary(TRUDEXA, adalimumab, groupOf), reference(TRUDEXA, HUMIRA, "2003-09-01"), "2003-09-08"), null);
  // A medicine between the set's first and a later reference: the set's first dated medicine.
  const between = medicine("X1", "Between", ["adalimumab"], "Other", "Withdrawn", "2003-09-05");
  assert.deepEqual(firstApprovalShown(between, copiesSummary(between, [...adalimumab, between], groupOf), reference(between, HUMIRA, "2003-09-01"), "2003-09-08"),
    { name: "Trudexa", date: "2003-09-01", number: TRUDEXA.ema_product_number });
});

test("countedFromName: a medicine approved on the date the estimate counts from", () => {
  const plavix = medicine("EMEA/H/C/000174", "Plavix", ["clopidogrel"], "Other", "Authorised", "1998-07-15");
  const iscover = medicine("EMEA/H/C/000175", "Iscover", ["clopidogrel"], "Other", "Authorised", "1998-07-14");
  // The reference approved that day.
  assert.equal(countedFromName(WEGOVY, { name: "Ozempic", date: "2018-02-08" }, reference(WEGOVY, OZEMPIC, "2018-02-08"), "2018-02-08"), "Ozempic");
  // Else this medicine (Iscover, whose reference Plavix came a day later).
  assert.equal(countedFromName(iscover, null, reference(iscover, plavix, "1998-07-14"), "1998-07-15"), "Iscover");
  // Else the set's first (Humira's rows count from Trudexa's approval).
  assert.equal(countedFromName(HUMIRA, { name: "Trudexa", date: "2003-09-01" }, reference(HUMIRA, HUMIRA, "2003-09-01"), "2003-09-08"), "Trudexa");
  // None approved that day, or no estimate.
  assert.equal(countedFromName(HYRIMOZ, null, reference(HYRIMOZ, HUMIRA, "2003-09-01"), "2003-09-08"), null);
  assert.equal(countedFromName(HYRIMOZ, null, undefined, null), null);
});

// Owner's decision (2026-09-29): a first approval within 30 days of the medicine's own is its twin
// (another brand of the same application: Trudexa a week before Humira, Iscover a day before
// Plavix). The copies line covers it, so the card names no earlier approval ("same" line left out,
// the copies named as this medicine's); Wegovy, four years after Ozempic, keeps it.
const KYMRIAH = medicine("EMEA/H/C/004090", "Kymriah", ["tisagenlecleucel"], "Advanced therapy", "Authorised", "2018-08-23");
const shown = (first) => (first ? { name: first.name_of_medicine, date: first.marketing_authorisation_date, number: first.ema_product_number } : null);

test("copiesLinePlan: a first approval within 30 days (a twin) is not named; Wegovy's Ozempic is", () => {
  const adalimumab = setGroups(ROWS, new Map()).get("adalimumab");
  const humira = copiesLinePlan(HUMIRA, copiesSummary(HUMIRA, adalimumab, groupOf), shown(TRUDEXA));
  assert.deepEqual(humira, { copies: "list", first: null, same: false });
  const iscover = medicine("EMEA/H/C/000175", "Iscover", ["clopidogrel"], "Other", "Authorised", "1998-07-14");
  const plavix = medicine("EMEA/H/C/000174", "Plavix", ["clopidogrel"], "Other", "Authorised", "1998-07-15");
  assert.deepEqual(copiesLinePlan(plavix, copiesSummary(plavix, [plavix, iscover], groupOf), shown(iscover)), { copies: "none", first: null, same: false });
  const semaglutide = setGroups(ROWS, new Map()).get("semaglutide");
  assert.deepEqual(copiesLinePlan(WEGOVY, copiesSummary(WEGOVY, semaglutide, groupOf), shown(OZEMPIC)), { copies: "none", first: shown(OZEMPIC), same: true });
  // 30 days is still a twin (R's window, inclusive); 31 is not.
  const at = (date) => medicine("X2", "Later", ["adalimumab"], "Other", "Authorised", date);
  assert.equal(copiesLinePlan(at("2003-10-01"), copiesSummary(at("2003-10-01"), adalimumab, groupOf), shown(TRUDEXA)).first, null);
  assert.deepEqual(copiesLinePlan(at("2003-10-02"), copiesSummary(at("2003-10-02"), adalimumab, groupOf), shown(TRUDEXA)).first, shown(TRUDEXA));
});

test("copiesLinePlan: a copy gets the same line; a medicine never approved no copies line", () => {
  const adalimumab = setGroups(ROWS, new Map()).get("adalimumab");
  assert.deepEqual(copiesLinePlan(HYRIMOZ, copiesSummary(HYRIMOZ, adalimumab, groupOf), shown(TRUDEXA)), { copies: null, first: shown(TRUDEXA), same: true });
  // Never approved: no twin to compare with, the set's first approval stays.
  assert.deepEqual(copiesLinePlan(FYZOCLAD, copiesSummary(FYZOCLAD, adalimumab, groupOf), shown(TRUDEXA)), { copies: null, first: shown(TRUDEXA), same: true });
});

// Owner's decision (2026-09-29): "No generic or biosimilar authorized yet" is true of an advanced
// therapy but reads oddly there.
test("copiesLinePlan: an advanced therapy without copies gets no \"none yet\" line", () => {
  assert.deepEqual(copiesLinePlan(KYMRIAH, copiesSummary(KYMRIAH, [KYMRIAH], groupOf), null), { copies: null, first: null, same: false });
  // Other types still say so (Ozempic, the first semaglutide).
  const semaglutide = setGroups(ROWS, new Map()).get("semaglutide");
  assert.equal(copiesLinePlan(OZEMPIC, copiesSummary(OZEMPIC, semaglutide, groupOf), null).copies, "none");
});

// Step 4: R's curated hybrid list gives hybrids (EMA type Other) the basis of a copy: they follow
// their reference's protection (follows_reference), or their reference is not a central one
// (reference_not_found). Their cards read as a copy's, not as the originator's "No generic or
// biosimilar authorized yet." Real rows (ema_search_index.json and ema_medicine_protection.json,
// 2026-09-29).
const VICTOZA = medicine("EMEA/H/C/001026", "Victoza", ["liraglutide"], "Other", "Authorised", "2009-06-30");
const SAXENDA = medicine("EMEA/H/C/003780", "Saxenda", ["liraglutide"], "Other", "Authorised", "2015-03-23");
const LIRAGLUTIDE_STADA = medicine("EMEA/H/C/006615", "Liraglutide STADA", ["liraglutide"], "Other", "Authorised", "2026-07-15");
const COLCHICINE_AGEPHA = medicine("EMEA/H/C/006653", "Colchicine Agepha Pharma", ["colchicine"], "Other", "Authorised", "2026-07-24");
const estimate = (row, basis, ref = null) => ({
  ema_product_number: row.ema_product_number, basis, reference_product_number: ref?.ema_product_number ?? null,
  reference_name: ref?.name_of_medicine ?? null, counted_from: ref?.marketing_authorisation_date ?? null, status: basis === "reference_not_found" ? "unclear" : "ended",
});

test("followsReference: a hybrid whose estimate follows a reference, or finds none, reads as a copy", () => {
  const liraglutide = [VICTOZA, SAXENDA, LIRAGLUTIDE_STADA];
  const stada = copiesSummary(LIRAGLUTIDE_STADA, liraglutide, groupOf);
  assert.equal(stada.copy, false);
  const asCopy = followsReference(stada, estimate(LIRAGLUTIDE_STADA, "follows_reference", VICTOZA));
  assert.equal(asCopy.copy, true);
  // No "No generic or biosimilar authorized yet." (the originator's line); the "same" line naming Victoza.
  assert.deepEqual(copiesLinePlan(LIRAGLUTIDE_STADA, asCopy, shown(VICTOZA)), { copies: null, first: shown(VICTOZA), same: true });
  // A hybrid of a nationally authorized medicine (Colchicine Tiofarma): no central first approval to name.
  const colchicine = followsReference(copiesSummary(COLCHICINE_AGEPHA, [COLCHICINE_AGEPHA], groupOf), estimate(COLCHICINE_AGEPHA, "reference_not_found"));
  assert.deepEqual(copiesLinePlan(COLCHICINE_AGEPHA, colchicine, null), { copies: null, first: null, same: true });
  // The originator (basis own) and an estimate still loading change nothing.
  const victoza = copiesSummary(VICTOZA, liraglutide, groupOf);
  assert.equal(followsReference(victoza, estimate(VICTOZA, "own", VICTOZA)), victoza);
  assert.equal(followsReference(stada, undefined), stada);
  // A generic stays a copy whatever its estimate.
  const hyrimoz = copiesSummary(HYRIMOZ, setGroups(ROWS, new Map()).get("adalimumab"), groupOf);
  assert.equal(followsReference(hyrimoz, undefined).copy, true);
});

// R names a medicine's substances by its active substance field where EMA's INN field repeats the
// medicine's name (Vysribli, a denosumab biosimilar; real row of ema_search_index.json 2026-09-28):
// it joins denosumab's set.
const VYSRIBLI = {
  ema_product_number: "EMEA/H/C/006797", name_of_medicine: "Vysribli (previously Denosumab Intas)", substances: "denosumab", substance_keys: ["denosumab"],
  active_substance: "denosumab", medicine_status: "Authorised", marketing_authorisation_date: "2025-11-17", medicine_type: "Biosimilar", orphan_medicine: false,
};
const PROLIA = medicine("EMEA/H/C/001120", "Prolia", ["denosumab"], "Other", "Authorised", "2010-05-26");
const XGEVA = medicine("EMEA/H/C/002173", "Xgeva", ["denosumab"], "Other", "Authorised", "2011-07-13");

test("copiesSummary: Vysribli counts among denosumab's biosimilars and names Prolia first", () => {
  const denosumab = setGroups([PROLIA, XGEVA, VYSRIBLI], new Map()).get("denosumab");
  assert.deepEqual(copiesSummary(XGEVA, denosumab, groupOf).copies.map(({ type, count }) => ({ type, count })), [{ type: "Biosimilar", count: 1 }]);
  const vysribli = copiesSummary(VYSRIBLI, denosumab, groupOf);
  assert.equal(vysribli.others, 2);
  assert.equal(vysribli.first, PROLIA);
});

// Step 3 review (#8): "dasatinib" + Enter showed "Since 26 Jul 2024" under "First central EU
// approval: 20 Nov 2006 (Sprycel)": the card's headline, dek and strip describe the substance with
// its other spellings, so both dates are the group's first.
test("substanceGroup: the substance's medicines with its other spellings', their first approval and the authorized ones", () => {
  const substances = new Map([
    ["dasatinib", { key: "dasatinib", name: "dasatinib", products: [DASATINIB_ACCORD_HEALTHCARE] }],
    ["dasatinib (anhydrous)", { key: "dasatinib (anhydrous)", name: "dasatinib (anhydrous)", products: [SPRYCEL, DASATINIB_ACCORD] }],
  ]);
  const siblings = siblingSubstances("dasatinib", substances, substanceEquivalents(EQUIVALENT_ROWS));
  const group = substanceGroup(substances.get("dasatinib").products, siblings);
  assert.deepEqual(group.rows.map((row) => row.name_of_medicine), ["Dasatinib Accord Healthcare", "Sprycel", "Dasatinib Accord"]);
  assert.equal(group.first, SPRYCEL);
  assert.deepEqual(group.authorized.map((row) => row.name_of_medicine), ["Dasatinib Accord Healthcare", "Sprycel"]);
  // Without other spellings: the substance's own medicines; a medicine in both lists counts once.
  const own = substanceGroup([SPRYCEL, DASATINIB_ACCORD], []);
  assert.equal(own.first, SPRYCEL);
  assert.equal(own.rows.length, 2);
  assert.equal(substanceGroup([SPRYCEL], [{ substance: { products: [SPRYCEL] } }]).rows.length, 1);
  assert.equal(substanceGroup([FYZOCLAD], []).first, null);
});

test("siblingSubstances: the other keys of the same substance with their medicines and first approval", () => {
  const substances = new Map([
    ["dasatinib", { key: "dasatinib", name: "dasatinib", products: [DASATINIB_ACCORD_HEALTHCARE] }],
    ["dasatinib (anhydrous)", { key: "dasatinib (anhydrous)", name: "dasatinib (anhydrous)", products: [DASATINIB_ACCORD, SPRYCEL] }],
  ]);
  const siblings = siblingSubstances("dasatinib", substances, substanceEquivalents(EQUIVALENT_ROWS));
  assert.deepEqual(siblings.map(({ substance, count, first }) => ({ key: substance.key, count, first: first.name_of_medicine })), [
    { key: "dasatinib (anhydrous)", count: 2, first: "Sprycel" },
  ]);
  // A pair naming a key the data does not have is left out.
  assert.deepEqual(siblingSubstances("metformin", substances, substanceEquivalents(EQUIVALENT_ROWS)), []);
  assert.deepEqual(siblingSubstances("dasatinib", substances, new Map()), []);
});
