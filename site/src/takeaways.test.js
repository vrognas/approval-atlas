import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activityTakeaway,
  breakdownTakeaway,
  conditionsTakeaway,
  overTimeTakeaway,
  protectionTakeaway,
  takeawayYear,
  topTies,
  yearsTakeaway,
} from "./takeaways.js";

// F · Spacious, phase 3 (Cognitive Load / Selective Attention): each dashboard card leads with one
// sentence computed from the data it shows; the method description moved into its (i) panel.

test("topTies: the largest count and every item that has it, in their order", () => {
  const rows = [{ k: "a", n: 3 }, { k: "b", n: 5 }, { k: "c", n: 5 }, { k: "d", n: 0 }];
  assert.deepEqual(topTies(rows, (row) => row.n), { count: 5, items: [rows[1], rows[2]] });
  assert.deepEqual(topTies([], (row) => row.n), { count: 0, items: [] });
  assert.deepEqual(topTies([{ n: 0 }], (row) => row.n), { count: 0, items: [] });
});

// Review of phase 3: the series counts the medicines with an approval date (the headline counts the
// authorized ones without one too), and neither the status nor the year filter applies to it.
test("Authorized over time: authorized with an approval date, the 12-month change, the filters it ignores", () => {
  const series = [
    { date: "2025-08-31", authorized_products: 1450 },
    { date: "2025-09-30", authorized_products: 1462 },
    { date: "2026-08-31", authorized_products: 1560 },
    { date: "2026-09-29", authorized_products: 1567 },
  ];
  // Compared with the point nearest to a year before the last (2025-09-30 for 2026-09-29).
  assert.equal(overTimeTakeaway(series), "1,567 medicines authorized with an approval date, up 105 in the last 12 months.");
  assert.equal(overTimeTakeaway([{ date: "2025-09-30", authorized_products: 12 }, { date: "2026-09-29", authorized_products: 10 }]), "10 medicines authorized with an approval date, down 2 in the last 12 months.");
  assert.equal(overTimeTakeaway([{ date: "2025-09-30", authorized_products: 1 }, { date: "2026-09-29", authorized_products: 1 }]), "1 medicine authorized with an approval date, unchanged over the last 12 months.");
  assert.equal(overTimeTakeaway([{ date: "2025-09-30", authorized_products: 3 }, { date: "2026-09-29", authorized_products: 0 }]), "No medicines authorized with an approval date, down 3 in the last 12 months.");
  // A series shorter than a year: no change named.
  assert.equal(overTimeTakeaway([{ date: "2026-08-31", authorized_products: 4 }, { date: "2026-09-29", authorized_products: 5 }]), "5 medicines authorized with an approval date.");
  assert.equal(overTimeTakeaway([]), null);
  // A status or year filter set: said not to apply to this history.
  assert.equal(overTimeTakeaway(series, { status: true }), "1,567 medicines authorized with an approval date, up 105 in the last 12 months. The status filter does not apply to this history.");
  assert.equal(overTimeTakeaway(series, { years: true }), "1,567 medicines authorized with an approval date, up 105 in the last 12 months. The year filter does not apply to this history.");
  assert.equal(overTimeTakeaway(series, { status: true, years: true }), "1,567 medicines authorized with an approval date, up 105 in the last 12 months. The status and year filters do not apply to this history.");
});

// Review of phase 3: the year the per-year takeaway names follows the year filter: the last full
// year inside the selection, or its last year (so far, when that is the data's year).
test("the per-year takeaway's year: the last full year, inside the year filter", () => {
  assert.deepEqual(takeawayYear(2026, null, null), { year: 2025, partial: false });
  assert.deepEqual(takeawayYear(2026, 2015, 2020), { year: 2020, partial: false });
  assert.deepEqual(takeawayYear(2026, 2015, null), { year: 2025, partial: false });
  assert.deepEqual(takeawayYear(2026, null, 2010), { year: 2010, partial: false });
  assert.deepEqual(takeawayYear(2026, 2026, null), { year: 2026, partial: true });
  assert.deepEqual(takeawayYear(2026, 2026, 2026), { year: 2026, partial: true });
});

// Review of phase 3: worded by the population shown (by default the authorized medicines: EMA
// approved 109 in 2025, one of them withdrawn since), never as EMA's yearly total.
test("Approvals per year: of the medicines shown, those approved in the year and its biosimilars", () => {
  const product = (year, type = "Other") => ({ year, medicine_type: type });
  // The default (authorized), every status or another status: the same form, "of the medicines shown".
  const products = [product(2025), product(2025, "Biosimilar"), product(2025, "Generic"), product(2024), product(null)];
  assert.equal(yearsTakeaway(products, 2025), "Of the medicines shown, 3 were approved in 2025, 1 of them a biosimilar.");
  assert.equal(yearsTakeaway([...products, product(2025, "Biosimilar")], 2025), "Of the medicines shown, 4 were approved in 2025, 2 of them biosimilars.");
  assert.equal(yearsTakeaway([product(2025)], 2025), "Of the medicines shown, 1 was approved in 2025, not a biosimilar.");
  assert.equal(yearsTakeaway([product(2025), product(2025)], 2025), "Of the medicines shown, 2 were approved in 2025, none of them biosimilars.");
  assert.equal(yearsTakeaway([product(2025, "Biosimilar")], 2025), "Of the medicines shown, 1 was approved in 2025, a biosimilar.");
  assert.equal(yearsTakeaway([product(2025, "Biosimilar"), product(2025, "Biosimilar")], 2025), "Of the medicines shown, 2 were approved in 2025, all of them biosimilars.");
  assert.equal(yearsTakeaway([product(2024)], 2025), "None of the medicines shown was approved in 2025.");
  // The data's own year: so far.
  assert.equal(yearsTakeaway([product(2026)], 2026, true), "Of the medicines shown, 1 was approved in 2026 so far, not a biosimilar.");
  assert.equal(yearsTakeaway([], 2026, true), "None of the medicines shown was approved in 2026 so far.");
});

test("Breakdown: the group with the most medicines; ties, one group, static rows left out", () => {
  const rows = [
    { key: "L", label: "Antineoplastic", count: 490 },
    { key: "J", label: "Antiinfectives", count: 192 },
    { key: "L04", label: "code incomplete", count: 900, static: true, incomplete: true },
    { key: "__other__", label: "Other", count: 999, other: true },
  ];
  assert.equal(breakdownTakeaway(rows), "Antineoplastic has the most medicines (490).");
  assert.equal(breakdownTakeaway(rows, (row) => `${row.key} ${row.label}`), "L Antineoplastic has the most medicines (490).");
  assert.equal(breakdownTakeaway([{ key: "a", label: "A", count: 5 }, { key: "b", label: "B", count: 5 }]), "A and B have the most medicines (5 each).");
  assert.equal(breakdownTakeaway([{ key: "a", label: "A", count: 5 }, { key: "b", label: "B", count: 5 }, { key: "c", label: "C", count: 5 }]), "3 groups have the most medicines (5 each).");
  assert.equal(breakdownTakeaway([{ key: "a", label: "A", count: 1 }]), "A: 1 medicine, the only group here.");
  // In ATC mode, classes (final round before merge).
  assert.equal(breakdownTakeaway([{ key: "L", label: "L X", count: 1 }], undefined, "atc"), "L X: 1 medicine, the only class here.");
  assert.equal(breakdownTakeaway([{ key: "a", label: "A", count: 5 }, { key: "b", label: "B", count: 5 }, { key: "c", label: "C", count: 5 }], undefined, "atc"), "3 classes have the most medicines (5 each).");
  assert.equal(breakdownTakeaway([{ key: "a", label: "A", count: 7, static: true }]), null);
  assert.equal(breakdownTakeaway([]), null);
  // Review of phase 3: every bar shown tied and more in Other (the top 20 cap): how many tie is unknown.
  const capped = [...Array.from({ length: 20 }, (_, index) => ({ key: `k${index}`, label: `K${index}`, count: 1 })), { key: "__other__", label: "Other", count: 9, other: true }];
  assert.equal(breakdownTakeaway(capped), "Several groups have the most medicines (1 each).");
  // Two of them tied, another shown with fewer, more in Other: exact (Other holds only fewer).
  assert.equal(breakdownTakeaway([{ key: "a", label: "A", count: 5 }, { key: "b", label: "B", count: 5 }, { key: "c", label: "C", count: 4 }, { key: "__other__", label: "Other", count: 9, other: true }]), "A and B have the most medicines (5 each).");
});

test("Who is active where: the company with the most medicines, and how many in its largest column", () => {
  const rows = [
    { key: "g.novartis", label: "Novartis", count: 77, cells: new Map([["L", 30], ["J", 4], ["__other__", 50]]) },
    { key: "g.intas", label: "Intas", count: 71, cells: new Map([["L", 20]]) },
  ];
  const columns = [{ key: "L", label: "L Antineoplastic" }, { key: "J", label: "J Antiinfectives" }, { key: "__other__", label: "Other", other: true }];
  assert.equal(activityTakeaway(rows, columns), "Novartis has the most medicines (77), 30 of them in L Antineoplastic.");
  assert.equal(activityTakeaway([{ ...rows[0], count: 4 }, { ...rows[1], count: 4 }], columns), "Novartis and Intas have the most medicines (4 each).");
  assert.equal(activityTakeaway([{ ...rows[0], cells: new Map() }, rows[1]], columns), "Novartis has the most medicines (77).");
  assert.equal(activityTakeaway([{ ...rows[0], count: 5, cells: new Map([["J", 5]]) }, rows[1]].reverse().sort((a, b) => b.count - a.count), columns), "Intas has the most medicines (71), 20 of them in L Antineoplastic.");
  assert.equal(activityTakeaway([], columns), null);
  // Review of phase 3: one company only.
  assert.equal(activityTakeaway([rows[1]], columns), "Intas: 71 medicines, 20 of them in L Antineoplastic.");
  assert.equal(activityTakeaway([{ ...rows[1], count: 20 }], columns), "Intas: 20 medicines, all of them in L Antineoplastic.");
  assert.equal(activityTakeaway([{ ...rows[1], count: 1, cells: new Map([["L", 1]]) }], columns), "Intas: 1 medicine, in L Antineoplastic.");
  assert.equal(activityTakeaway([{ ...rows[1], cells: new Map() }], columns), "Intas: 71 medicines.");
  // Review of phase 3: ties counted over every company, not the 15 rows shown.
  const many = Array.from({ length: 20 }, (_, index) => ({ key: `g.${index}`, label: `C${index}`, count: 2, cells: new Map() }));
  assert.equal(activityTakeaway(many, columns), "20 companies have the most medicines (2 each).");
});

test("Protection: how many may lose market protection (est.) within two years, and orphan exclusivity after; never a patent", () => {
  const row = (min, orphanEnd = null) => ({ min, orphanEnd });
  const orphan = { end: "2033-01-01", source: "computed" };
  const rows = [row("2026-11-01"), row("2027-03-01", orphan), row("2028-12-31"), row("2029-01-01", orphan), row("2031-05-01")];
  assert.equal(protectionTakeaway(rows, 2026), "Of the 5 medicines with market protection running (est.), 3 may lose it by the end of 2028, 1 of them with orphan market exclusivity (est.) running later.");
  assert.equal(protectionTakeaway([row("2026-11-01"), row("2027-01-01")], 2026), "Of the 2 medicines with market protection running (est.), 2 may lose it by the end of 2028.");
  assert.equal(protectionTakeaway([row("2026-11-01")], 2026), "The 1 medicine with market protection running (est.) may lose it by the end of 2028.");
  assert.equal(protectionTakeaway([row("2026-11-01", orphan)], 2026), "The 1 medicine with market protection running (est.) may lose it by the end of 2028, with orphan market exclusivity (est.) running later.");
  assert.equal(protectionTakeaway([row("2026-11-01", orphan), row("2027-01-01", orphan)], 2026), "Of the 2 medicines with market protection running (est.), 2 may lose it by the end of 2028, all of them with orphan market exclusivity (est.) running later.");
  // Owner decision 2026-09-30: orphan ends the Union Register publishes are exact, no "(est.)"; mixed ones "(partly est.)".
  const exact = { end: "2031-01-01", source: "register" };
  assert.equal(protectionTakeaway([row("2026-11-01", exact)], 2026), "The 1 medicine with market protection running (est.) may lose it by the end of 2028, with orphan market exclusivity running later.");
  assert.equal(protectionTakeaway([row("2026-11-01", exact), row("2027-01-01", orphan)], 2026), "Of the 2 medicines with market protection running (est.), 2 may lose it by the end of 2028, all of them with orphan market exclusivity (partly est.) running later.");
  assert.equal(protectionTakeaway([row("2026-11-01"), row("2031-05-01")], 2026), "Of the 2 medicines with market protection running (est.), 1 may lose it by the end of 2028.");
  assert.equal(protectionTakeaway([row("2031-05-01")], 2026), "The 1 medicine with market protection running is not estimated to lose it by the end of 2028.");
  assert.equal(protectionTakeaway([row("2031-05-01"), row("2032-01-01")], 2026), "None of the 2 medicines with market protection running is estimated to lose it by the end of 2028.");
  assert.equal(protectionTakeaway([], 2026), null);
  for (const text of [protectionTakeaway(rows, 2026), protectionTakeaway([row("2031-05-01")], 2026)]) assert.doesNotMatch(text, /patent/i);
});

test("Conditions: the condition with the most treatments; ties over every condition; none ranked", () => {
  const rows = [{ name: "Lymphoproliferative Disorders", treatments: 67 }, { name: "Diabetes Mellitus", treatments: 52 }];
  assert.equal(conditionsTakeaway(rows), "Lymphoproliferative Disorders has the most treatments (67).");
  assert.equal(conditionsTakeaway([{ name: "A", treatments: 1 }]), "A has the most treatments (1).");
  assert.equal(conditionsTakeaway([{ name: "A", treatments: 3 }, { name: "B", treatments: 3 }]), "A and B have the most treatments (3 each).");
  assert.equal(conditionsTakeaway([{ name: "A", treatments: 0 }]), null);
  assert.equal(conditionsTakeaway([]), null);
  // Review of phase 3: 10 tied (?mah=g.bio-thera-solutions), counted over the whole ranking.
  // Final round before merge: more than two tied on 1 treatment says little: no sentence.
  assert.equal(conditionsTakeaway(Array.from({ length: 10 }, (_, index) => ({ name: `C${index}`, treatments: 1 }))), null);
  assert.equal(conditionsTakeaway(Array.from({ length: 10 }, (_, index) => ({ name: `C${index}`, treatments: 2 }))), "10 conditions have the most treatments (2 each).");
  assert.equal(conditionsTakeaway([{ name: "A", treatments: 1 }, { name: "B", treatments: 1 }]), "A and B have the most treatments (1 each).");
});
