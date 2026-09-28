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
