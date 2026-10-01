import { test } from "node:test";
import assert from "node:assert/strict";
import { espacenetUrl, glanceIsEstimate, isCopy, protectionGlance, protectionSummary } from "./protection.js";

const own = {
  ema_product_number: "EMEA/H/C/003820",
  basis: "own",
  reference_product_number: "EMEA/H/C/003820",
  reference_name: "Keytruda",
  counted_from: "2015-07-17",
  data_exclusivity_end: "2023-07-17",
  market_protection_end_min: "2025-07-17",
  market_protection_end_max: "2026-07-17",
  status: "unclear",
  source: "estimate_from_ema_dates",
};

test("own protection: status chip, estimated ends and what they are counted from", () => {
  assert.deepEqual(protectionSummary(own, [], "pembrolizumab", "2026-09-26"), {
    status: "Data/market protection: Unclear",
    lines: [
      "Data exclusivity ended\u00a0(est.) 17\u00a0Jul\u00a02023",
      "Market protection ended\u00a0(est.) 17\u00a0Jul\u00a02025\u00a0– 17\u00a0Jul\u00a02026",
      "Counted from the first central EU approval of pembrolizumab: Keytruda, 17\u00a0Jul\u00a02015",
    ],
    orphan: [],
  });
  assert.equal(protectionSummary({ ...own, status: "protected" }, [], "x", "2026-09-26").status, "Data/market protection: Protected");
  assert.equal(protectionSummary({ ...own, status: "ended" }, [], "x", "2026-09-26").status, "Data/market protection: Ended");
});

// Relative to the data date: a date before it has ended, the data date itself and later ones end.
test("protection ends read 'ended' once past the data date and 'ends' until then", () => {
  const future = { ...own, data_exclusivity_end: "2026-09-26", market_protection_end_min: "2026-01-01", market_protection_end_max: "2027-01-01" };
  assert.deepEqual(protectionSummary(future, [], "x", "2026-09-26").lines.slice(0, 2), [
    "Data exclusivity ends\u00a0(est.) 26\u00a0Sep\u00a02026",
    "Market protection ends\u00a0(est.) 1\u00a0Jan\u00a02026\u00a0– 1\u00a0Jan\u00a02027",
  ]);
});

test("a generic or biosimilar has no protection of its own and follows its reference", () => {
  const follows = { ...own, basis: "follows_reference", reference_name: "Humira", status: "ended" };
  const summary = protectionSummary(follows, [], "adalimumab", "2026-09-26");
  // QA 2026-09-29 (#1): the chip never shows the reference's status as the copy's own.
  assert.equal(summary.status, "Data/market protection: None of its own");
  assert.equal(protectionSummary({ ...follows, status: "protected" }, [], "adalimumab", "2026-09-26").status, "Data/market protection: None of its own");
  assert.equal(summary.lines[0], "No protection of its own; the dates below are for its reference medicine, Humira");
  assert.equal(summary.lines.length, 4);
});

test("a generic whose reference is not centrally authorized shows no dates", () => {
  const missing = { ...own, basis: "reference_not_found", reference_product_number: null, reference_name: null, counted_from: null, data_exclusivity_end: null, market_protection_end_min: null, market_protection_end_max: null, status: null };
  assert.deepEqual(protectionSummary(missing, [], "x", "2026-09-26"), {
    status: "Data/market protection: None of its own",
    lines: ["No protection of its own; its reference medicine was not found among EU central authorizations"],
    orphan: [],
  });
});

test("orphan market exclusivity rows say whether it ends or ended and where the date comes from", () => {
  const orphan = [
    { condition: "Treatment of spinal muscular atrophy", exclusivity_end: "2031-05-30", end_source: "register" },
    { condition: "Treatment of X", exclusivity_end: "2032-01-01", end_source: "computed" },
    { condition: "Treatment of Hodgkin lymphoma", exclusivity_end: "2024-06-20", end_source: "register" },
    { condition: "Treatment of Y", exclusivity_end: "2026-09-26", end_source: "computed" },
  ];
  assert.deepEqual(protectionSummary(own, orphan, "x", "2026-09-26").orphan, [
    "Orphan market exclusivity for Treatment of spinal muscular atrophy: ends 30\u00a0May\u00a02031\u00a0(Union Register)",
    "Orphan market exclusivity for Treatment of X: ends 1\u00a0Jan\u00a02032\u00a0(est.)",
    "Orphan market exclusivity for Treatment of Hodgkin lymphoma: ended 20\u00a0Jun\u00a02024\u00a0(Union Register)",
    "Orphan market exclusivity for Treatment of Y: ends 26\u00a0Sep\u00a02026\u00a0(est.)",
  ]);
});

test("an inactive designation without an end date says so instead of showing a date", () => {
  const orphan = [{ condition: "Treatment of Z", exclusivity_end: null, end_source: null, designation_status: "Withdrawn" }];
  assert.deepEqual(protectionSummary(own, orphan, "x", "2026-09-26").orphan, [
    "Orphan designation for Treatment of Z: withdrawn (end date not published)",
  ]);
});

test("no protection row, no summary", () => {
  assert.equal(protectionSummary(undefined, [], "x", "2026-09-26"), null);
});

// Step 3 (#6): counted from another company group's earlier medicine of the same substance set,
// while the company's own first approval came later (Opzelura, Incyte, after Novartis's Jakavi;
// real row 2026-09-28): the market protection range covers both estimates, and the status is
// unclear where their statuses differ, protected where both are (step 3 review: Qdenga).
test("protection counted from another company's medicine says so before the dates", () => {
  const other = {
    ...own, ema_product_number: "EMEA/H/C/005843", basis: "other_company_reference", reference_product_number: "EMEA/H/C/002464",
    reference_name: "Jakavi", counted_from: "2012-08-23", own_reference_product_number: "EMEA/H/C/005843", own_counted_from: "2023-04-19",
    data_exclusivity_end: "2020-08-23", market_protection_end_min: "2022-08-23", market_protection_end_max: "2034-04-19", status: "unclear",
  };
  const summary = protectionSummary(other, [], "ruxolitinib", "2026-09-28", "Jakavi");
  assert.equal(summary.status, "Data/market protection: Unclear");
  assert.deepEqual(summary.lines, [
    "The first central EU approval of ruxolitinib was another company's medicine (Jakavi, 23\u00a0Aug\u00a02012). Counted from this company's own first approval (19\u00a0Apr\u00a02023), protection would end later; the market protection range covers both.",
    "Data exclusivity ended\u00a0(est.) 23\u00a0Aug\u00a02020",
    "Market protection ends\u00a0(est.) 23\u00a0Aug\u00a02022\u00a0– 19\u00a0Apr\u00a02034",
    "Counted from the first central EU approval of ruxolitinib: Jakavi, 23\u00a0Aug\u00a02012",
  ]);
  const both = protectionSummary({ ...other, status: "protected", own_counted_from: null }, [], "x", "2026-09-28", null);
  assert.equal(both.status, "Data/market protection: Protected");
  assert.equal(both.lines[0], "The first central EU approval of x was another company's medicine (23\u00a0Aug\u00a02012). Counted from this company's own first approval, protection would end later; the market protection range covers both.");
});

// Step 4 (owner request 2026-09-28): R writes the data exclusivity counted from the company's own
// first approval as data_exclusivity_end_max on other_company_reference rows; the line then gives
// the range (MenQuadfi, Sanofi, after GSK's Menveo; dates from the rows' rule, 8 years).
test("data exclusivity counted from another company's medicine is a range when R gives its later end", () => {
  const menQuadfi = {
    ...own, ema_product_number: "EMEA/H/C/005084", basis: "other_company_reference", reference_product_number: "EMEA/H/C/001095",
    reference_name: "Menveo", counted_from: "2010-03-15", own_reference_product_number: "EMEA/H/C/005084", own_counted_from: "2020-11-18",
    data_exclusivity_end: "2018-03-15", data_exclusivity_end_max: "2028-11-18", market_protection_end_min: "2020-03-15", market_protection_end_max: "2031-11-18", status: "unclear",
  };
  const lines = protectionSummary(menQuadfi, [], "meningococcal group a, c, w-135 and y conjugate vaccine", "2026-09-28", "Menveo").lines;
  assert.equal(lines[1], "Data exclusivity ends\u00a0(est.) 15\u00a0Mar\u00a02018\u00a0– 18\u00a0Nov\u00a02028");
  assert.equal(protectionSummary({ ...menQuadfi, data_exclusivity_end_max: "2026-01-01" }, [], "x", "2026-09-28").lines[1],
    "Data exclusivity ended\u00a0(est.) 15\u00a0Mar\u00a02018\u00a0– 1\u00a0Jan\u00a02026");
  // Null (older data, other rows) or the same date: one date, as before.
  assert.equal(protectionSummary({ ...menQuadfi, data_exclusivity_end_max: null }, [], "x", "2026-09-28").lines[1], "Data exclusivity ended\u00a0(est.) 15\u00a0Mar\u00a02018");
  assert.equal(protectionSummary({ ...menQuadfi, data_exclusivity_end_max: "2018-03-15" }, [], "x", "2026-09-28").lines[1], "Data exclusivity ended\u00a0(est.) 15\u00a0Mar\u00a02018");
});

// Step 3 review: counted_from is the set's first approval date, not always the reference's own
// (Iscover 14 Jul 1998, whose reference Plavix came a day later): the line names a medicine
// approved that day (copies.js countedFromName()), or the date alone.
test("the counted-from line names the medicine approved that day, or the date alone", () => {
  const iscover = {
    ...own, ema_product_number: "EMEA/H/C/000175", reference_product_number: "EMEA/H/C/000174", reference_name: "Plavix", counted_from: "1998-07-14",
    data_exclusivity_end: "2006-07-14", market_protection_end_min: "2008-07-14", market_protection_end_max: "2009-07-14", status: "ended",
  };
  assert.equal(protectionSummary(iscover, [], "clopidogrel", "2026-09-28", "Iscover").lines.at(-1), "Counted from the first central EU approval of clopidogrel: Iscover, 14\u00a0Jul\u00a01998");
  assert.equal(protectionSummary(iscover, [], "clopidogrel", "2026-09-28", null).lines.at(-1), "Counted from the first central EU approval of clopidogrel: 14\u00a0Jul\u00a01998");
  // Without a name passed: the reference's.
  assert.equal(protectionSummary(iscover, [], "clopidogrel", "2026-09-28").lines.at(-1), "Counted from the first central EU approval of clopidogrel: Plavix, 14\u00a0Jul\u00a01998");
});

// Step 4 review (rFix a): a curated copy (copy_source "curated", a row of ema_curated_copies.json)
// follows its reference medicine, whose substance can be another: Riulvy (tegomil fumarate) is a
// hybrid of Tecfidera (dimethyl fumarate). Its counted-from line names the reference, never "the
// first central EU approval of tegomil fumarate", which is Riulvy itself (real rows 2026-09-29).
const curatedFollower = {
  basis: "follows_reference", copy_source: "curated", own_reference_product_number: null, own_counted_from: null,
  data_exclusivity_end_max: null, status: "ended", source: "estimate_from_ema_dates",
};
const riulvy = {
  ...curatedFollower, ema_product_number: "EMEA/H/C/006427", reference_product_number: "EMEA/H/C/002601", reference_name: "Tecfidera",
  counted_from: "2014-01-30", data_exclusivity_end: "2022-01-30", market_protection_end_min: "2024-01-30", market_protection_end_max: "2025-01-30",
};
const liraglutideStada = {
  ...curatedFollower, ema_product_number: "EMEA/H/C/006615", reference_product_number: "EMEA/H/C/001026", reference_name: "Victoza",
  counted_from: "2009-06-30", data_exclusivity_end: "2017-06-30", market_protection_end_min: "2019-06-30", market_protection_end_max: "2020-06-30",
};

test("a curated copy's counted-from line names its reference medicine, not its own substance", () => {
  const summary = protectionSummary(riulvy, [], "tegomil fumarate", "2026-09-29", "Tecfidera", { referenceSubstance: "dimethyl fumarate" });
  assert.equal(summary.status, "Data/market protection: None of its own");
  assert.deepEqual(summary.lines, [
    "No protection of its own; the dates below are for its reference medicine, Tecfidera",
    "Data exclusivity ended\u00a0(est.) 30\u00a0Jan\u00a02022",
    "Market protection ended\u00a0(est.) 30\u00a0Jan\u00a02024\u00a0– 30\u00a0Jan\u00a02025",
    "Counted from the approval of its reference medicine, Tecfidera: 30\u00a0Jan\u00a02014",
  ]);
  assert.ok(summary.lines.every((line) => !line.includes("tegomil")));
  // Liraglutide STADA, a hybrid of Victoza (same substance): the reference too, not "of liraglutide".
  assert.equal(protectionSummary(liraglutideStada, [], "liraglutide", "2026-09-29", "Victoza", { referenceSubstance: "liraglutide" }).lines.at(-1),
    "Counted from the approval of its reference medicine, Victoza: 30\u00a0Jun\u00a02009");
  // Without a name passed: the reference's.
  assert.equal(protectionSummary(liraglutideStada, [], "liraglutide", "2026-09-29").lines.at(-1),
    "Counted from the approval of its reference medicine, Victoza: 30\u00a0Jun\u00a02009");
  // A copy EMA flags keeps the substance's line (Dimethyl fumarate Neuraxpharm, a generic of Tecfidera).
  assert.equal(protectionSummary({ ...riulvy, ema_product_number: "EMEA/H/C/005950", copy_source: "ema_flag" }, [], "dimethyl fumarate", "2026-09-29", "Tecfidera").lines.at(-1),
    "Counted from the first central EU approval of dimethyl fumarate: Tecfidera, 30\u00a0Jan\u00a02014");
});

// Ablymico, a hybrid of Saxenda (approved 23 Mar 2015), is counted as Saxenda is: from Victoza's
// 30 Jun 2009, the first central approval of liraglutide (real row 2026-09-29), so "its reference
// medicine Saxenda's first central approval" would give Saxenda another medicine's date.
test("a curated copy whose reference is counted from another medicine names both", () => {
  const ablymico = { ...liraglutideStada, ema_product_number: "EMEA/H/C/006620", reference_product_number: "EMEA/H/C/003780", reference_name: "Saxenda" };
  assert.equal(protectionSummary(ablymico, [], "liraglutide", "2026-09-29", "Victoza", { referenceSubstance: "liraglutide" }).lines.at(-1),
    "As for its reference medicine Saxenda, counted from the first central EU approval of liraglutide: Victoza, 30\u00a0Jun\u00a02009");
  assert.equal(protectionSummary(ablymico, [], "liraglutide", "2026-09-29", null, { referenceSubstance: "liraglutide" }).lines.at(-1),
    "As for its reference medicine Saxenda, counted from the first central EU approval of liraglutide: 30\u00a0Jun\u00a02009");
  assert.equal(protectionSummary(ablymico, [], "liraglutide", "2026-09-29", null).lines.at(-1),
    "As for its reference medicine Saxenda, counted from the first central EU approval of its active substance: 30\u00a0Jun\u00a02009");
});

// Step 4 review (rFix b): a curated copy of a nationally authorized medicine has no central
// reference (reference_not_found); its ema_curated_copies.json row names the reference and the EMA
// page that says so (Buprenorphine Neuraxpharm, a hybrid of Subutex; real rows 2026-09-29).
const buprenorphineNeuraxpharm = {
  ema_product_number: "EMEA/H/C/006188", basis: "reference_not_found", copy_source: "curated", reference_product_number: null, reference_name: null,
  counted_from: null, own_reference_product_number: null, own_counted_from: null, data_exclusivity_end: null, data_exclusivity_end_max: null,
  market_protection_end_min: null, market_protection_end_max: null, status: "unclear", source: "estimate_from_ema_dates",
};
const buprenorphineNeuraxpharmCopy = {
  ema_product_number: "EMEA/H/C/006188", copy_type: "hybrid", reference_product_number: null, reference_name: "Subutex",
  evidence_url: "https://www.ema.europa.eu/en/medicines/human/EPAR/buprenorphine-neuraxpharm",
  evidence_quote: "Buprenorphine Neuraxpharm contains the active substance buprenorphine and is a ‘hybrid medicine’.",
  checked_date: "2026-09-29", note: null, source: "curated",
};

test("a curated copy of a nationally authorized medicine names its reference and the evidence", () => {
  const summary = protectionSummary(buprenorphineNeuraxpharm, [], "buprenorphine", "2026-09-29", null, { curated: buprenorphineNeuraxpharmCopy });
  assert.equal(summary.status, "Data/market protection: None of its own");
  assert.deepEqual(summary.lines, [[
    "No protection of its own; a hybrid of Subutex (authorized nationally, so no EU central date to count from).",
    " ",
    { text: "Source", url: "https://www.ema.europa.eu/en/medicines/human/EPAR/buprenorphine-neuraxpharm" },
  ]]);
  // The copy type as the row gives it (Sugammadex Adroiq is a generic, Tuznue a biosimilar).
  assert.equal(protectionSummary(buprenorphineNeuraxpharm, [], "x", "2026-09-29", null, { curated: { ...buprenorphineNeuraxpharmCopy, copy_type: "generic" } }).lines[0][0],
    "No protection of its own; a generic of Subutex (authorized nationally, so no EU central date to count from).");
  // No https evidence: the sentence alone.
  assert.deepEqual(protectionSummary(buprenorphineNeuraxpharm, [], "x", "2026-09-29", null, { curated: { ...buprenorphineNeuraxpharmCopy, evidence_url: "http://example.org" } }).lines,
    ["No protection of its own; a hybrid of Subutex (authorized nationally, so no EU central date to count from)."]);
});

test("without its curated row (older data, a missing file) a copy without a central reference reads as before", () => {
  const generic = "No protection of its own; its reference medicine was not found among EU central authorizations";
  assert.deepEqual(protectionSummary(buprenorphineNeuraxpharm, [], "buprenorphine", "2026-09-29", null).lines, [generic]);
  assert.deepEqual(protectionSummary(buprenorphineNeuraxpharm, [], "buprenorphine", "2026-09-29", null, { curated: undefined }).lines, [generic]);
  // A generic EMA flags whose reference is national has no curated row either.
  assert.deepEqual(protectionSummary({ ...buprenorphineNeuraxpharm, copy_source: "ema_flag" }, [], "x", "2026-09-29", null, { curated: buprenorphineNeuraxpharmCopy }).lines, [generic]);
});

// Backlog (step 4 review): a curated copy following a central reference says what it is, from its
// ema_curated_copies.json row, with a link to the EMA page that says so, as one with a national
// reference does (real rows 2026-09-29).
const curatedRow = (ema_product_number, copy_type, reference_product_number, reference_name, slug) => ({
  ema_product_number, copy_type, reference_product_number, reference_name,
  evidence_url: `https://www.ema.europa.eu/en/medicines/human/EPAR/${slug}`, evidence_quote: "…", checked_date: "2026-09-29", note: null, source: "curated",
});

test("a curated copy of a central reference names its copy type and the evidence", () => {
  const riulvyCopy = curatedRow("EMEA/H/C/006427", "hybrid", "EMEA/H/C/002601", "Tecfidera", "riulvy");
  const summary = protectionSummary(riulvy, [], "tegomil fumarate", "2026-09-29", "Tecfidera", { curated: riulvyCopy, referenceSubstance: "dimethyl fumarate" });
  assert.deepEqual(summary.lines[0], [
    "No protection of its own; a hybrid of Tecfidera.",
    " ",
    { text: "Source", url: "https://www.ema.europa.eu/en/medicines/human/EPAR/riulvy" },
  ]);
  // The dates and the counted-from line as before.
  assert.equal(summary.lines.length, 4);
  assert.equal(summary.lines[3], "Counted from the approval of its reference medicine, Tecfidera: 30\u00a0Jan\u00a02014");
  // A generic (Sugammadex Adroiq: Bridion) and a biosimilar (Tuznue: Herceptin) EMA does not flag.
  const sugammadexAdroiq = { ...curatedFollower, ema_product_number: "EMEA/H/C/006046", reference_product_number: "EMEA/H/C/000885", reference_name: "Bridion",
    counted_from: "2008-07-25", data_exclusivity_end: "2016-07-25", market_protection_end_min: "2018-07-25", market_protection_end_max: "2019-07-25" };
  assert.equal(protectionSummary(sugammadexAdroiq, [], "sugammadex", "2026-09-29", "Bridion",
    { curated: curatedRow("EMEA/H/C/006046", "generic", "EMEA/H/C/000885", "Bridion", "sugammadex-adroiq") }).lines[0][0],
  "No protection of its own; a generic of Bridion.");
  const tuznue = { ...sugammadexAdroiq, ema_product_number: "EMEA/H/C/006252", reference_product_number: "EMEA/H/C/000278", reference_name: "Herceptin" };
  assert.equal(protectionSummary(tuznue, [], "trastuzumab", "2026-09-29", "Herceptin",
    { curated: curatedRow("EMEA/H/C/006252", "biosimilar", "EMEA/H/C/000278", "Herceptin", "tuznue") }).lines[0][0],
  "No protection of its own; a biosimilar of Herceptin.");
  // No https evidence: the sentence alone.
  assert.equal(protectionSummary(riulvy, [], "x", "2026-09-29", "Tecfidera", { curated: { ...riulvyCopy, evidence_url: null } }).lines[0],
    "No protection of its own; a hybrid of Tecfidera.");
  // Without its curated row (older data, a missing file), or a copy EMA flags: "follows" as before.
  assert.equal(protectionSummary(riulvy, [], "x", "2026-09-29", "Tecfidera").lines[0], "No protection of its own; the dates below are for its reference medicine, Tecfidera");
  assert.equal(protectionSummary({ ...riulvy, copy_source: "ema_flag" }, [], "x", "2026-09-29", "Tecfidera", { curated: riulvyCopy }).lines[0],
    "No protection of its own; the dates below are for its reference medicine, Tecfidera");
});

// 2026-09-29: a pediatric-use marketing authorization (basis paediatric_use, a row of
// ema_curated_pumas.json) has protection of its own, counted from its own approval (R: its
// reference is itself). Alkindi (2018) is not the first central approval of hydrocortisone
// (Plenadren, 2011), so its line never says so; Buccolam is midazolam's first, and reads the same
// way (real rows 2026-09-29).
const pumaRow = (ema_product_number, slug) => ({
  ema_product_number,
  evidence_url: `https://www.ema.europa.eu/en/documents/assessment-report/${slug}-epar-public-assessment-report_en.pdf`,
  evidence_quote: "an application for a Paediatric Use marketing authorisation in accordance with Article 30 of Regulation (EC) No 1901/2006",
  checked_date: "2026-09-29", note: null, source: "curated",
});
const alkindi = {
  ema_product_number: "EMEA/H/C/004416", basis: "paediatric_use", copy_source: null, reference_product_number: "EMEA/H/C/004416",
  reference_name: "Alkindi", counted_from: "2018-02-09", own_reference_product_number: null, own_counted_from: null,
  data_exclusivity_end: "2026-02-09", data_exclusivity_end_max: null, market_protection_end_min: "2028-02-09",
  market_protection_end_max: "2029-02-09", status: "protected", source: "estimate_from_ema_dates",
};
const buccolam = {
  ...alkindi, ema_product_number: "EMEA/H/C/002267", reference_product_number: "EMEA/H/C/002267", reference_name: "Buccolam",
  counted_from: "2011-09-04", data_exclusivity_end: "2019-09-04", market_protection_end_min: "2021-09-04", market_protection_end_max: "2022-09-04", status: "ended",
};

test("a pediatric-use marketing authorization counts from its own approval, not as its substance's first", () => {
  // lookup.js passes the name countedFromName() gives: Alkindi, approved on counted_from.
  const summary = protectionSummary(alkindi, [], "hydrocortisone", "2026-09-29", "Alkindi", { puma: pumaRow("EMEA/H/C/004416", "alkindi") });
  assert.equal(summary.status, "Data/market protection: Protected");
  assert.deepEqual(summary.lines, [
    "Data exclusivity ended\u00a0(est.) 9\u00a0Feb\u00a02026",
    "Market protection ends\u00a0(est.) 9\u00a0Feb\u00a02028\u00a0– 9\u00a0Feb\u00a02029",
    [
      "A pediatric-use marketing authorization (for children): protection counted from its own approval, 9\u00a0Feb\u00a02018",
      " ",
      { text: "Source", url: "https://www.ema.europa.eu/en/documents/assessment-report/alkindi-epar-public-assessment-report_en.pdf" },
    ],
  ]);
  assert.ok(summary.lines.flat().every((line) => typeof line !== "string" || !line.includes("first central EU approval")));
  // Buccolam, the first central approval of midazolam, is no different: its own protection.
  assert.deepEqual(protectionSummary(buccolam, [], "midazolam", "2026-09-29", "Buccolam", { puma: pumaRow("EMEA/H/C/002267", "buccolam") }), {
    status: "Data/market protection: Ended",
    lines: [
      "Data exclusivity ended\u00a0(est.) 4\u00a0Sep\u00a02019",
      "Market protection ended\u00a0(est.) 4\u00a0Sep\u00a02021\u00a0– 4\u00a0Sep\u00a02022",
      [
        "A pediatric-use marketing authorization (for children): protection counted from its own approval, 4\u00a0Sep\u00a02011",
        " ",
        { text: "Source", url: "https://www.ema.europa.eu/en/documents/assessment-report/buccolam-epar-public-assessment-report_en.pdf" },
      ],
    ],
    orphan: [],
  });
  // Without its curated row (a missing ema_curated_pumas.json) or without https evidence: the sentence alone.
  const sentence = "A pediatric-use marketing authorization (for children): protection counted from its own approval, 9\u00a0Feb\u00a02018";
  assert.equal(protectionSummary(alkindi, [], "hydrocortisone", "2026-09-29", "Alkindi").lines[2], sentence);
  assert.equal(protectionSummary(alkindi, [], "hydrocortisone", "2026-09-29", "Alkindi", { puma: { ...pumaRow("EMEA/H/C/004416", "alkindi"), evidence_url: null } }).lines[2], sentence);
});

test("protectionGlance: a pediatric-use marketing authorization shows its own protection", () => {
  assert.deepEqual(protectionGlance(alkindi, [], "2026-09-29"), { value: "Market protection until 2028–2029", reference: null, orphan: null });
  assert.deepEqual(protectionGlance(buccolam, [], "2026-09-29"), { value: "Market protection ended", reference: null, orphan: null });
});

test("protectionGlance: the answer strip's short form of the estimate", () => {
  const protectedRow = { ...own, market_protection_end_min: "2031-01-06", market_protection_end_max: "2032-01-06", status: "protected" };
  assert.deepEqual(protectionGlance(protectedRow, [], "2026-09-28"), { value: "Market protection until 2031–2032", reference: null, orphan: null });
  assert.deepEqual(protectionGlance({ ...own, status: "ended" }, [], "2026-09-28"), { value: "Market protection ended", reference: null, orphan: null });
  assert.deepEqual(protectionGlance(own, [], "2026-09-28"), { value: "Market protection unclear", reference: null, orphan: null });
  assert.deepEqual(protectionGlance({ ...own, basis: "other_company_reference", status: "unclear" }, [], "2026-09-28").value, "Market protection unclear");
  assert.equal(protectionGlance(undefined, [], "2026-09-28"), null);
  // Laws of UX, second pass (owner decision 2026-09-30): the lead names market protection, never
  // "patent", and stays an estimate.
  for (const status of ["protected", "ended", "unclear"]) {
    const { value } = protectionGlance({ ...protectedRow, status }, [], "2026-09-28");
    assert.match(value, /^Market protection /);
    assert.doesNotMatch(value, /patent/i);
  }
});

// QA 2026-09-29 (#1): a copy has no protection of its own; the strip never shows its reference's
// range or status as the copy's own (Palbociclib Viatris, a generic of Ibrance, showed "Until
// 2026–2027"; real row 2026-09-29). While the reference is protected, its range follows as
// secondary text naming the reference.
test("protectionGlance: a copy follows its reference and never shows the reference's protection as its own", () => {
  const palbociclibViatris = {
    ...own, ema_product_number: "EMEA/H/C/006624", basis: "follows_reference", copy_source: "ema_flag", reference_product_number: "EMEA/H/C/003853",
    reference_name: "Ibrance", counted_from: "2016-11-09", data_exclusivity_end: "2024-11-09", market_protection_end_min: "2026-11-09",
    market_protection_end_max: "2027-11-09", status: "protected",
  };
  assert.deepEqual(protectionGlance(palbociclibViatris, [], "2026-09-29"), { value: "Follows Ibrance", reference: "Ibrance's protection until 2026–2027\u00a0(est.)", orphan: null });
  assert.equal(protectionGlance({ ...palbociclibViatris, market_protection_end_min: "2027-01-01" }, [], "2026-09-29").reference, "Ibrance's protection until 2027\u00a0(est.)");
  // Once the reference's protection has ended (or is unclear): the reference alone.
  assert.deepEqual(protectionGlance({ ...palbociclibViatris, status: "ended" }, [], "2026-09-29"), { value: "Follows Ibrance", reference: null, orphan: null });
  assert.equal(protectionGlance({ ...palbociclibViatris, status: "unclear" }, [], "2026-09-29").reference, null);
  // A curated copy (Riulvy, a hybrid of Tecfidera) the same way.
  assert.deepEqual(protectionGlance(riulvy, [], "2026-09-29"), { value: "Follows Tecfidera", reference: null, orphan: null });
  assert.equal(protectionGlance({ ...riulvy, status: "protected", market_protection_end_min: "2030-01-30", market_protection_end_max: "2031-01-30" }, [], "2026-09-29").value,
    "Follows Tecfidera");
  // No central reference (a copy of a nationally authorized medicine, curated or not): none of its own.
  assert.deepEqual(protectionGlance({ ...own, basis: "reference_not_found", reference_name: null, status: null }, [], "2026-09-28"),
    { value: "None of its own", reference: null, orphan: null });
  assert.deepEqual(protectionGlance(buprenorphineNeuraxpharm, [], "2026-09-29"), { value: "None of its own", reference: null, orphan: null });
  // Its own orphan exclusivity still shows.
  assert.equal(protectionGlance(palbociclibViatris, [{ condition: "A", exclusivity_end: "2033-05-30", end_source: "register" }], "2026-09-29").orphan,
    "Orphan market exclusivity until 2033");
});

// F · Spacious, phase 4: the medicine card's protection lead says "(est.)" after an estimate of the
// medicine's own protection, not after a copy's "Follows Ibrance" or "None of its own".
test("isCopy: a copy's estimate is its reference's (or none), never its own", () => {
  assert.equal(isCopy({ basis: "follows_reference" }), true);
  assert.equal(isCopy({ basis: "reference_not_found" }), true);
  for (const basis of ["own", "other_company_reference", "paediatric_use"]) assert.equal(isCopy({ basis }), false);
});

// Review of phase 4: "(est.)" follows only the "Market protection until …" form (a medicine's own
// protection running), not "ended", "unclear" or a copy's value.
test("glanceIsEstimate: only a medicine's own protection still running", () => {
  assert.equal(glanceIsEstimate({ basis: "own", status: "protected" }), true);
  assert.equal(glanceIsEstimate({ basis: "other_company_reference", status: "protected" }), true);
  assert.equal(glanceIsEstimate({ basis: "own", status: "ended" }), false);
  assert.equal(glanceIsEstimate({ basis: "own", status: "unclear" }), false);
  assert.equal(glanceIsEstimate({ basis: "follows_reference", status: "protected" }), false);
  assert.equal(glanceIsEstimate(undefined), false);
});

test("protectionGlance: orphan market exclusivity still running is named with its latest end year", () => {
  const orphan = [
    { condition: "A", exclusivity_end: "2024-06-20", end_source: "register" },
    { condition: "B", exclusivity_end: "2033-05-30", end_source: "register" },
    { condition: "C", exclusivity_end: "2031-01-01", end_source: "computed" },
    { condition: "D", exclusivity_end: null, end_source: null, designation_status: "Withdrawn" },
  ];
  assert.deepEqual(protectionGlance({ ...own, status: "ended" }, orphan, "2026-09-28"), { value: "Market protection ended", reference: null, orphan: "Orphan market exclusivity until 2033" });
  assert.equal(protectionGlance({ ...own, status: "ended" }, orphan.slice(0, 1), "2026-09-28").orphan, null);
});

// Owner decision 2026-09-30 ("be specific where you can, else estimate"): the lead's orphan line
// says "(est.)" after an end computed from the link date (Soliris, Vyndaqel on 2026-09-29), not
// after one the Union Register publishes; on the same day the register's end is the one named.
test("protectionGlance: the orphan line marks a computed end as an estimate, a register end as exact", () => {
  const computed = [
    { condition: "A", exclusivity_end: "2019-06-22", end_source: "register" },
    { condition: "B", exclusivity_end: "2029-08-28", end_source: "computed" },
  ];
  assert.equal(protectionGlance({ ...own, status: "ended" }, computed, "2026-09-29").orphan, "Orphan market exclusivity until 2029\u00a0(est.)");
  const sameDay = [
    { condition: "A", exclusivity_end: "2030-02-19", end_source: "register" },
    { condition: "B", exclusivity_end: "2030-02-19", end_source: "computed" },
  ];
  assert.equal(protectionGlance({ ...own, status: "ended" }, sameDay, "2026-09-29").orphan, "Orphan market exclusivity until 2030");
  assert.equal(protectionGlance({ ...own, status: "ended" }, [...sameDay].reverse(), "2026-09-29").orphan, "Orphan market exclusivity until 2030");
});

test("the Espacenet link searches the first INN", () => {
  assert.equal(espacenetUrl("tenofovir disoproxil"), "https://worldwide.espacenet.com/patent/search?q=tenofovir%20disoproxil");
});
