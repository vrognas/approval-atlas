import { test } from "node:test";
import assert from "node:assert/strict";
import { espacenetUrl, protectionSummary } from "./protection.js";

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
      "Data exclusivity ends (est.) 2023-07-17",
      "Market protection ends (est.) 2025-07-17 – 2026-07-17",
      "Counted from the first EU approval of pembrolizumab: Keytruda, 2015-07-17",
    ],
    orphan: [],
  });
  assert.equal(protectionSummary({ ...own, status: "protected" }, [], "x", "2026-09-26").status, "Data/market protection: Protected");
  assert.equal(protectionSummary({ ...own, status: "ended" }, [], "x", "2026-09-26").status, "Data/market protection: Ended");
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
    "Orphan market exclusivity for Treatment of spinal muscular atrophy: ends 2031-05-30 (register)",
    "Orphan market exclusivity for Treatment of X: ends 2032-01-01 (estimate)",
    "Orphan market exclusivity for Treatment of Hodgkin lymphoma: ended 2024-06-20 (register)",
    "Orphan market exclusivity for Treatment of Y: ends 2026-09-26 (estimate)",
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

test("the Espacenet link searches the first INN", () => {
  assert.equal(espacenetUrl("tenofovir disoproxil"), "https://worldwide.espacenet.com/patent/search?q=tenofovir%20disoproxil");
});
