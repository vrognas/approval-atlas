import { test } from "node:test";
import assert from "node:assert/strict";
import { espacenetUrl, protectionGlance, protectionSummary } from "./protection.js";

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
      "Data exclusivity ended (est.) 17 Jul 2023",
      "Market protection ended (est.) 17 Jul 2025 – 17 Jul 2026",
      "Counted from the first central EU approval of pembrolizumab: Keytruda, 17 Jul 2015",
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
    "Data exclusivity ends (est.) 26 Sep 2026",
    "Market protection ends (est.) 1 Jan 2026 – 1 Jan 2027",
  ]);
});

test("a generic or biosimilar has no protection of its own and follows its reference", () => {
  const follows = { ...own, basis: "follows_reference", reference_name: "Humira", status: "ended" };
  const summary = protectionSummary(follows, [], "adalimumab", "2026-09-26");
  assert.equal(summary.status, "Data/market protection: Ended");
  assert.equal(summary.lines[0], "No protection of its own; follows Humira");
  assert.equal(summary.lines.length, 4);
});

test("a generic whose reference is not centrally authorized shows no dates", () => {
  const missing = { ...own, basis: "reference_not_found", reference_product_number: null, reference_name: null, counted_from: null, data_exclusivity_end: null, market_protection_end_min: null, market_protection_end_max: null, status: null };
  assert.deepEqual(protectionSummary(missing, [], "x", "2026-09-26"), {
    status: "Data/market protection: Unclear",
    lines: ["No protection of its own; reference product not found in EU central authorizations"],
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
    "Orphan market exclusivity for Treatment of spinal muscular atrophy: ends 30 May 2031 (register)",
    "Orphan market exclusivity for Treatment of X: ends 1 Jan 2032 (estimate)",
    "Orphan market exclusivity for Treatment of Hodgkin lymphoma: ended 20 Jun 2024 (register)",
    "Orphan market exclusivity for Treatment of Y: ends 26 Sep 2026 (estimate)",
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
    "The first central EU approval of ruxolitinib was another company's medicine (Jakavi, 23 Aug 2012); counted from this company's own first approval (19 Apr 2023), protection would end later, so the market protection range covers both.",
    "Data exclusivity ended (est.) 23 Aug 2020",
    "Market protection ends (est.) 23 Aug 2022 – 19 Apr 2034",
    "Counted from the first central EU approval of ruxolitinib: Jakavi, 23 Aug 2012",
  ]);
  const both = protectionSummary({ ...other, status: "protected", own_counted_from: null }, [], "x", "2026-09-28", null);
  assert.equal(both.status, "Data/market protection: Protected");
  assert.equal(both.lines[0], "The first central EU approval of x was another company's medicine (23 Aug 2012); counted from this company's own first approval, protection would end later, so the market protection range covers both.");
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
  assert.equal(lines[1], "Data exclusivity ends (est.) between 15 Mar 2018 and 18 Nov 2028");
  assert.equal(protectionSummary({ ...menQuadfi, data_exclusivity_end_max: "2026-01-01" }, [], "x", "2026-09-28").lines[1],
    "Data exclusivity ended (est.) between 15 Mar 2018 and 1 Jan 2026");
  // Null (older data, other rows) or the same date: one date, as before.
  assert.equal(protectionSummary({ ...menQuadfi, data_exclusivity_end_max: null }, [], "x", "2026-09-28").lines[1], "Data exclusivity ended (est.) 15 Mar 2018");
  assert.equal(protectionSummary({ ...menQuadfi, data_exclusivity_end_max: "2018-03-15" }, [], "x", "2026-09-28").lines[1], "Data exclusivity ended (est.) 15 Mar 2018");
});

// Step 3 review: counted_from is the set's first approval date, not always the reference's own
// (Iscover 14 Jul 1998, whose reference Plavix came a day later): the line names a medicine
// approved that day (copies.js countedFromName()), or the date alone.
test("the counted-from line names the medicine approved that day, or the date alone", () => {
  const iscover = {
    ...own, ema_product_number: "EMEA/H/C/000175", reference_product_number: "EMEA/H/C/000174", reference_name: "Plavix", counted_from: "1998-07-14",
    data_exclusivity_end: "2006-07-14", market_protection_end_min: "2008-07-14", market_protection_end_max: "2009-07-14", status: "ended",
  };
  assert.equal(protectionSummary(iscover, [], "clopidogrel", "2026-09-28", "Iscover").lines.at(-1), "Counted from the first central EU approval of clopidogrel: Iscover, 14 Jul 1998");
  assert.equal(protectionSummary(iscover, [], "clopidogrel", "2026-09-28", null).lines.at(-1), "Counted from the first central EU approval of clopidogrel: 14 Jul 1998");
  // Without a name passed: the reference's.
  assert.equal(protectionSummary(iscover, [], "clopidogrel", "2026-09-28").lines.at(-1), "Counted from the first central EU approval of clopidogrel: Plavix, 14 Jul 1998");
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
  assert.equal(summary.status, "Data/market protection: Ended");
  assert.deepEqual(summary.lines, [
    "No protection of its own; follows Tecfidera",
    "Data exclusivity ended (est.) 30 Jan 2022",
    "Market protection ended (est.) 30 Jan 2024 – 30 Jan 2025",
    "Counted from its reference medicine Tecfidera's first central approval: 30 Jan 2014",
  ]);
  assert.ok(summary.lines.every((line) => !line.includes("tegomil")));
  // Liraglutide STADA, a hybrid of Victoza (same substance): the reference too, not "of liraglutide".
  assert.equal(protectionSummary(liraglutideStada, [], "liraglutide", "2026-09-29", "Victoza", { referenceSubstance: "liraglutide" }).lines.at(-1),
    "Counted from its reference medicine Victoza's first central approval: 30 Jun 2009");
  // Without a name passed: the reference's.
  assert.equal(protectionSummary(liraglutideStada, [], "liraglutide", "2026-09-29").lines.at(-1),
    "Counted from its reference medicine Victoza's first central approval: 30 Jun 2009");
  // A copy EMA flags keeps the substance's line (Dimethyl fumarate Neuraxpharm, a generic of Tecfidera).
  assert.equal(protectionSummary({ ...riulvy, ema_product_number: "EMEA/H/C/005950", copy_source: "ema_flag" }, [], "dimethyl fumarate", "2026-09-29", "Tecfidera").lines.at(-1),
    "Counted from the first central EU approval of dimethyl fumarate: Tecfidera, 30 Jan 2014");
});

// Ablymico, a hybrid of Saxenda (approved 23 Mar 2015), is counted as Saxenda is: from Victoza's
// 30 Jun 2009, the first central approval of liraglutide (real row 2026-09-29), so "its reference
// medicine Saxenda's first central approval" would give Saxenda another medicine's date.
test("a curated copy whose reference is counted from another medicine names both", () => {
  const ablymico = { ...liraglutideStada, ema_product_number: "EMEA/H/C/006620", reference_product_number: "EMEA/H/C/003780", reference_name: "Saxenda" };
  assert.equal(protectionSummary(ablymico, [], "liraglutide", "2026-09-29", "Victoza", { referenceSubstance: "liraglutide" }).lines.at(-1),
    "Counted, as for its reference medicine Saxenda, from the first central EU approval of liraglutide: Victoza, 30 Jun 2009");
  assert.equal(protectionSummary(ablymico, [], "liraglutide", "2026-09-29", null, { referenceSubstance: "liraglutide" }).lines.at(-1),
    "Counted, as for its reference medicine Saxenda, from the first central EU approval of liraglutide: 30 Jun 2009");
  assert.equal(protectionSummary(ablymico, [], "liraglutide", "2026-09-29", null).lines.at(-1),
    "Counted, as for its reference medicine Saxenda, from the first central EU approval of its active substance: 30 Jun 2009");
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
  assert.equal(summary.status, "Data/market protection: Unclear");
  assert.deepEqual(summary.lines, [[
    "No protection of its own; a hybrid of Subutex (authorized nationally), whose protection dates are not in EU central data.",
    " ",
    { text: "Source", url: "https://www.ema.europa.eu/en/medicines/human/EPAR/buprenorphine-neuraxpharm" },
  ]]);
  // The copy type as the row gives it (Sugammadex Adroiq is a generic, Tuznue a biosimilar).
  assert.equal(protectionSummary(buprenorphineNeuraxpharm, [], "x", "2026-09-29", null, { curated: { ...buprenorphineNeuraxpharmCopy, copy_type: "generic" } }).lines[0][0],
    "No protection of its own; a generic of Subutex (authorized nationally), whose protection dates are not in EU central data.");
  // No https evidence: the sentence alone.
  assert.deepEqual(protectionSummary(buprenorphineNeuraxpharm, [], "x", "2026-09-29", null, { curated: { ...buprenorphineNeuraxpharmCopy, evidence_url: "http://example.org" } }).lines,
    ["No protection of its own; a hybrid of Subutex (authorized nationally), whose protection dates are not in EU central data."]);
});

test("without its curated row (older data, a missing file) a copy without a central reference reads as before", () => {
  const generic = "No protection of its own; reference product not found in EU central authorizations";
  assert.deepEqual(protectionSummary(buprenorphineNeuraxpharm, [], "buprenorphine", "2026-09-29", null).lines, [generic]);
  assert.deepEqual(protectionSummary(buprenorphineNeuraxpharm, [], "buprenorphine", "2026-09-29", null, { curated: undefined }).lines, [generic]);
  // A generic EMA flags whose reference is national has no curated row either.
  assert.deepEqual(protectionSummary({ ...buprenorphineNeuraxpharm, copy_source: "ema_flag" }, [], "x", "2026-09-29", null, { curated: buprenorphineNeuraxpharmCopy }).lines, [generic]);
});

test("protectionGlance: the answer strip's short form of the estimate", () => {
  const protectedRow = { ...own, market_protection_end_min: "2031-01-06", market_protection_end_max: "2032-01-06", status: "protected" };
  assert.deepEqual(protectionGlance(protectedRow, [], "2026-09-28"), { value: "Until 2031–2032", orphan: null });
  assert.deepEqual(protectionGlance({ ...own, status: "ended" }, [], "2026-09-28"), { value: "Ended", orphan: null });
  assert.deepEqual(protectionGlance(own, [], "2026-09-28"), { value: "Unclear", orphan: null });
  assert.deepEqual(protectionGlance({ ...own, basis: "other_company_reference", status: "unclear" }, [], "2026-09-28").value, "Unclear");
  assert.deepEqual(protectionGlance({ ...own, basis: "reference_not_found", status: null }, [], "2026-09-28").value, "Unclear");
  assert.equal(protectionGlance(undefined, [], "2026-09-28"), null);
});

test("protectionGlance: orphan market exclusivity still running is named with its latest end year", () => {
  const orphan = [
    { condition: "A", exclusivity_end: "2024-06-20", end_source: "register" },
    { condition: "B", exclusivity_end: "2033-05-30", end_source: "register" },
    { condition: "C", exclusivity_end: "2031-01-01", end_source: "computed" },
    { condition: "D", exclusivity_end: null, end_source: null, designation_status: "Withdrawn" },
  ];
  assert.deepEqual(protectionGlance({ ...own, status: "ended" }, orphan, "2026-09-28"), { value: "Ended", orphan: "Orphan exclusivity until 2033" });
  assert.equal(protectionGlance({ ...own, status: "ended" }, orphan.slice(0, 1), "2026-09-28").orphan, null);
});

test("the Espacenet link searches the first INN", () => {
  assert.equal(espacenetUrl("tenofovir disoproxil"), "https://worldwide.espacenet.com/patent/search?q=tenofovir%20disoproxil");
});
