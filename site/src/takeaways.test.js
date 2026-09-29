import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activityTakeaway,
  breakdownTakeaway,
  conditionsTakeaway,
  overTimeTakeaway,
  protectionTakeaway,
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

test("Authorized over time: authorized now and the change over the last 12 months", () => {
  const series = [
    { date: "2025-08-31", authorized_products: 1450 },
    { date: "2025-09-30", authorized_products: 1462 },
    { date: "2026-08-31", authorized_products: 1560 },
    { date: "2026-09-29", authorized_products: 1567 },
  ];
  // Compared with the point nearest to a year before the last (2025-09-30 for 2026-09-29).
  assert.equal(overTimeTakeaway(series), "1,567 authorized now, up 105 in the last 12 months.");
  assert.equal(overTimeTakeaway([{ date: "2025-09-30", authorized_products: 12 }, { date: "2026-09-29", authorized_products: 10 }]), "10 authorized now, down 2 in the last 12 months.");
  assert.equal(overTimeTakeaway([{ date: "2025-09-30", authorized_products: 1 }, { date: "2026-09-29", authorized_products: 1 }]), "1 authorized now, unchanged over the last 12 months.");
  assert.equal(overTimeTakeaway([{ date: "2025-09-30", authorized_products: 3 }, { date: "2026-09-29", authorized_products: 0 }]), "None authorized now, down 3 in the last 12 months.");
  // A series shorter than a year: no change named.
  assert.equal(overTimeTakeaway([{ date: "2026-08-31", authorized_products: 4 }, { date: "2026-09-29", authorized_products: 5 }]), "5 authorized now.");
  assert.equal(overTimeTakeaway([]), null);
});

test("Approvals per year: the last full year's approvals and its biosimilars", () => {
  const product = (year, type = "Other") => ({ year, medicine_type: type });
  const products = [product(2025), product(2025, "Biosimilar"), product(2025, "Generic"), product(2024), product(null)];
  assert.equal(yearsTakeaway(products, 2025), "3 approvals in 2025, 1 of them a biosimilar.");
  assert.equal(yearsTakeaway([...products, product(2025, "Biosimilar")], 2025), "4 approvals in 2025, 2 of them biosimilars.");
  assert.equal(yearsTakeaway([product(2025)], 2025), "1 approval in 2025, not a biosimilar.");
  assert.equal(yearsTakeaway([product(2025), product(2025)], 2025), "2 approvals in 2025, none of them biosimilars.");
  assert.equal(yearsTakeaway([product(2025, "Biosimilar")], 2025), "1 approval in 2025, a biosimilar.");
  assert.equal(yearsTakeaway([product(2025, "Biosimilar"), product(2025, "Biosimilar")], 2025), "2 approvals in 2025, all of them biosimilars.");
  assert.equal(yearsTakeaway([product(2024)], 2025), "No approvals in 2025.");
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
  assert.equal(breakdownTakeaway([{ key: "a", label: "A", count: 7, static: true }]), null);
  assert.equal(breakdownTakeaway([]), null);
});

test("Who is active where: the company with the most medicines, and how many in its largest column", () => {
  const rows = [
    { key: "g.novartis", label: "Novartis", count: 77, cells: new Map([["L", 30], ["J", 4], ["__other__", 50]]) },
    { key: "g.intas", label: "Intas", count: 71, cells: new Map([["L", 20]]) },
  ];
  const columns = [{ key: "L", label: "L Antineoplastic" }, { key: "J", label: "J Antiinfectives" }, { key: "__other__", label: "Other", other: true }];
  assert.equal(activityTakeaway(rows, columns), "Novartis has the most medicines (77), 30 of them in L Antineoplastic.");
  assert.equal(activityTakeaway([{ ...rows[0], count: 4, cells: new Map([["J", 4]]) }], columns), "Novartis has the most medicines (4), all of them in J Antiinfectives.");
  assert.equal(activityTakeaway([{ ...rows[0], count: 1, cells: new Map([["J", 1]]) }], columns), "Novartis has the most medicines (1), in J Antiinfectives.");
  assert.equal(activityTakeaway([{ ...rows[0], cells: new Map() }], columns), "Novartis has the most medicines (77).");
  assert.equal(activityTakeaway([rows[0], { ...rows[1], count: 77 }], columns), "Novartis and Intas have the most medicines (77 each).");
  assert.equal(activityTakeaway([], columns), null);
});

test("Protection: how many may lose market protection (est.) within two years; never a patent", () => {
  const row = (min) => ({ min });
  const rows = [row("2026-11-01"), row("2027-03-01"), row("2028-12-31"), row("2029-01-01"), row("2031-05-01")];
  assert.equal(protectionTakeaway(rows, 2026), "3 medicines may lose market protection (est.) by the end of 2028.");
  assert.equal(protectionTakeaway([row("2026-11-01")], 2026), "1 medicine may lose market protection (est.) by the end of 2028.");
  assert.equal(protectionTakeaway([row("2031-05-01")], 2026), "None of the 1 medicine with market protection running is estimated to lose it by the end of 2028.");
  assert.equal(protectionTakeaway([row("2031-05-01"), row("2032-01-01")], 2026), "None of the 2 medicines with market protection running is estimated to lose it by the end of 2028.");
  assert.equal(protectionTakeaway([], 2026), null);
  for (const text of [protectionTakeaway(rows, 2026), protectionTakeaway([row("2031-05-01")], 2026)]) assert.doesNotMatch(text, /patent/i);
});

test("Conditions: the condition with the most treatments; ties; none ranked", () => {
  const rows = [{ name: "Lymphoproliferative Disorders", treatments: 67 }, { name: "Diabetes Mellitus", treatments: 52 }];
  assert.equal(conditionsTakeaway(rows), "Lymphoproliferative Disorders has the most treatments (67).");
  assert.equal(conditionsTakeaway([{ name: "A", treatments: 1 }]), "A has the most treatments (1).");
  assert.equal(conditionsTakeaway([{ name: "A", treatments: 3 }, { name: "B", treatments: 3 }]), "A and B have the most treatments (3 each).");
  assert.equal(conditionsTakeaway([{ name: "A", treatments: 0 }]), null);
  assert.equal(conditionsTakeaway([]), null);
});
