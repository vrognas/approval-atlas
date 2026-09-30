import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { UI } from "./labels.js";
import { LATER, barShares, calendarBuckets, endingByYear, orphanLater, protectionEnding } from "./protection-calendar.js";

// Draft (loss-of-exclusivity calendar): estimates only, never "patent".

const protectionRow = (number, status, min, max = min, basis = "own") => ({
  ema_product_number: number, basis, status, market_protection_end_min: min, market_protection_end_max: max,
});
const product = (number, name) => ({ ema_product_number: number, name_of_medicine: name });
const TODAY = "2026-09-28";
const protectionOf = (rows, orphanRows = []) => ({
  byProduct: new Map(rows.map((row) => [row.ema_product_number, row])),
  orphan: Map.groupBy(orphanRows, (row) => row.ema_product_number),
});

test("orphanLater: the latest orphan exclusivity end after the date and its source, else null", () => {
  const rows = [
    { exclusivity_end: "2030-01-01", end_source: "register" },
    { exclusivity_end: "2033-05-01", end_source: "computed" },
    { exclusivity_end: null, end_source: null },
  ];
  assert.deepEqual(orphanLater(rows, "2029-06-01"), { end: "2033-05-01", source: "computed" });
  assert.deepEqual(orphanLater(rows.slice(0, 1), "2029-06-01"), { end: "2030-01-01", source: "register" });
  assert.equal(orphanLater(rows, "2033-05-01"), null); // the same day is not later
  assert.equal(orphanLater([], "2031-06-01"), null);
});

test("protectionEnding: protected estimates only, sorted by earliest end, then latest end, then name; unclear counted apart", () => {
  const products = [product("3", "Cebra"), product("1", "Alfa"), product("2", "Beta"), product("4", "Delta"), product("5", "Echo"), product("6", "Foxtrot")];
  const protection = protectionOf([
    protectionRow("1", "protected", "2028-03-01", "2029-03-01"),
    protectionRow("2", "protected", "2027-06-01", "2028-06-01"),
    protectionRow("3", "protected", "2027-06-01", "2028-06-01"),
    protectionRow("4", "unclear", "2026-01-01", "2027-01-01"),
    protectionRow("5", "ended", "2020-01-01", "2021-01-01"),
    // 6 has no estimate
  ], [
    { ema_product_number: "1", exclusivity_end: "2032-01-01", end_source: "computed" },
    { ema_product_number: "2", exclusivity_end: "2028-01-01", end_source: "computed" },
  ]);
  const { rows, unclear, unclearLatest, orphanOnly } = protectionEnding(products, protection, TODAY);
  assert.deepEqual(rows.map((row) => [row.product.name_of_medicine, row.min, row.max, row.orphanEnd?.end ?? null]), [
    ["Beta", "2027-06-01", "2028-06-01", null], // orphan exclusivity ends before the market protection's latest end
    ["Cebra", "2027-06-01", "2028-06-01", null],
    ["Alfa", "2028-03-01", "2029-03-01", "2032-01-01"],
  ]);
  assert.equal(unclear, 1);
  assert.equal(unclearLatest, 2027);
  assert.deepEqual(orphanOnly, []);
});

// A copy (a generic or biosimilar) follows its reference medicine's protection: counting it would
// count one loss of exclusivity twice (Palbociclib Viatris beside Ibrance); a copy whose reference
// is not in EU central data has no estimate of its own either.
test("protectionEnding: copies are left out, protected or unclear", () => {
  const products = [product("1", "Ibrance"), product("2", "Palbociclib Viatris"), product("3", "Copy of a national reference"), product("4", "Own unclear")];
  const protection = protectionOf([
    protectionRow("1", "protected", "2026-11-09", "2027-11-09"),
    protectionRow("2", "protected", "2026-11-09", "2027-11-09", "follows_reference"),
    protectionRow("3", "unclear", null, null, "reference_not_found"),
    protectionRow("4", "unclear", "2026-01-01", "2026-12-01"),
  ]);
  const { rows, unclear, unclearLatest } = protectionEnding(products, protection, TODAY);
  assert.deepEqual(rows.map((row) => row.product.name_of_medicine), ["Ibrance"]);
  assert.equal(unclear, 1);
  assert.equal(unclearLatest, 2026);
});

// Orphan market exclusivity belongs to the product itself, so a copy with its own still running is
// listed apart (morning QA 2026-09-29: Hyftor, a hybrid, and Kinpeygo were missing), with no market
// protection dates of its own; a copy without one stays out.
test("protectionEnding: a copy with its own orphan market exclusivity running is listed apart, without dates", () => {
  const products = [product("1", "Hyftor"), product("2", "Kinpeygo"), product("3", "Plain generic")];
  const protection = protectionOf([
    protectionRow("1", "ended", "2021-01-01", "2022-01-01", "follows_reference"),
    protectionRow("2", "unclear", null, null, "reference_not_found"),
    protectionRow("3", "protected", "2027-01-01", "2028-01-01", "follows_reference"),
  ], [
    { ema_product_number: "1", exclusivity_end: "2033-05-26", end_source: "computed" },
    { ema_product_number: "2", exclusivity_end: "2032-07-18", end_source: "register" },
  ]);
  const { rows, unclear, orphanOnly } = protectionEnding(products, protection, TODAY);
  assert.deepEqual(rows, []);
  assert.equal(unclear, 0);
  assert.deepEqual(orphanOnly.map((entry) => [entry.product.name_of_medicine, entry.status, entry.min, entry.max, entry.orphanEnd.end]), [
    ["Kinpeygo", "copy", null, null, "2032-07-18"],
    ["Hyftor", "copy", null, null, "2033-05-26"],
  ]);
});

// Morning QA 2026-09-29: "10 years from approval" read as the medicine's own approval.
test("the caveat counts market protection from the substance's first central approval; a copy row says it has none", () => {
  const copy = UI.protectionCalendar;
  assert.match(copy.company.note, /10 years from the first central EU approval of the active substance/);
  assert.doesNotMatch(copy.company.note, /years from approval/);
  assert.equal(copy.copyNoOwn, "No market protection of its own (a copy)");
});

// Orphan market exclusivity still running after the market protection estimate has ended, or after
// its latest end where that end has not passed yet (unclear): listed apart, never in the years nor
// in the unclear count.
test("protectionEnding: orphan market exclusivity running after an ended or unclear estimate is returned apart, by its end", () => {
  const products = [product("1", "Soliris"), product("2", "Wakix"), product("3", "Ended, orphan ended"), product("4", "Unclear, orphan within"), product("5", "Hyftor")];
  const protection = protectionOf([
    protectionRow("1", "ended", "2017-06-20", "2018-06-20"),
    protectionRow("2", "unclear", "2026-03-31", "2027-03-31"),
    protectionRow("3", "ended", "2015-01-01", "2016-01-01"),
    protectionRow("4", "unclear", "2026-02-01", "2027-02-01"),
    protectionRow("5", "ended", "2020-01-01", "2021-01-01"),
  ], [
    { ema_product_number: "1", exclusivity_end: "2029-08-28", end_source: "computed" },
    { ema_product_number: "2", exclusivity_end: "2028-04-04", end_source: "computed" },
    { ema_product_number: "3", exclusivity_end: "2025-01-01", end_source: "register" },
    { ema_product_number: "4", exclusivity_end: "2027-01-01", end_source: "computed" }, // before its latest end
    { ema_product_number: "5", exclusivity_end: "2033-05-26", end_source: "register" },
  ]);
  const { rows, unclear, unclearLatest, orphanOnly } = protectionEnding(products, protection, TODAY);
  assert.deepEqual(rows, []);
  assert.deepEqual(orphanOnly.map((entry) => [entry.product.name_of_medicine, entry.status, entry.max, entry.orphanEnd]), [
    ["Wakix", "unclear", "2027-03-31", { end: "2028-04-04", source: "computed" }],
    ["Soliris", "ended", "2018-06-20", { end: "2029-08-28", source: "computed" }],
    ["Hyftor", "ended", "2021-01-01", { end: "2033-05-26", source: "register" }],
  ]);
  assert.equal(unclear, 1); // "Unclear, orphan within"
  assert.equal(unclearLatest, 2027);
});

test("protectionEnding: a range without a latest end is one date; no unclear estimate, no latest year", () => {
  const { rows, unclear, unclearLatest } = protectionEnding([product("1", "Alfa")], protectionOf([protectionRow("1", "protected", "2028-03-01", null)]), TODAY);
  assert.equal(rows[0].max, "2028-03-01");
  assert.equal(unclear, 0);
  assert.equal(unclearLatest, null);
});

test("calendarBuckets: the first year and the next ones (zeros kept), then later; orphan exclusivity running later counted apart", () => {
  const rows = [
    { min: "2026-11-01", max: "2027-11-01", orphanEnd: null },
    { min: "2027-02-01", max: "2028-02-01", orphanEnd: "2031-01-01" },
    { min: "2027-09-01", max: "2028-09-01", orphanEnd: null },
    { min: "2031-01-01", max: "2032-01-01", orphanEnd: null },
    { min: "2036-01-01", max: "2037-01-01", orphanEnd: "2040-01-01" },
  ];
  const buckets = calendarBuckets(rows, 2026, 5);
  assert.deepEqual(buckets.map((bucket) => [bucket.key, bucket.year, bucket.count, bucket.orphanLater]), [
    ["2026", 2026, 1, 0],
    ["2027", 2027, 2, 1],
    ["2028", 2028, 0, 0],
    ["2029", 2029, 0, 0],
    ["2030", 2030, 0, 0],
    [LATER, 2031, 2, 1],
  ]);
  assert.deepEqual(buckets[1].rows, rows.slice(1, 3));
});

test("barShares: bars in percent of the widest single year; a longer later bar stops at full length, marked clamped", () => {
  const bucket = (key, count, orphan = 0) => ({ key, count, orphanLater: orphan });
  const shares = barShares([bucket("2026", 10, 2), bucket("2027", 40), bucket(LATER, 200, 20)]);
  assert.deepEqual(shares, [
    { plain: 20, orphan: 5, clamped: false },
    { plain: 100, orphan: 0, clamped: false },
    { plain: 90, orphan: 10, clamped: true },
  ]);
  // No medicine in any single year: the later bar is the scale.
  assert.deepEqual(barShares([bucket("2026", 0), bucket(LATER, 4, 1)]), [
    { plain: 0, orphan: 0, clamped: false },
    { plain: 75, orphan: 25, clamped: false },
  ]);
  assert.deepEqual(barShares([bucket("2026", 0), bucket(LATER, 0)]).map((share) => share.plain), [0, 0]);
});

test("endingByYear: every end year of the rows, in order", () => {
  const rows = [{ min: "2027-02-01" }, { min: "2027-09-01" }, { min: "2034-01-01" }];
  assert.deepEqual(endingByYear(rows).map((item) => [item.year, item.rows.length]), [[2027, 2], [2034, 1]]);
});

test("endingByYear: orphan-only medicines under the year their orphan market exclusivity ends, by date, marked", () => {
  const rows = [
    { product: product("1", "Alfa"), min: "2027-02-01" },
    { product: product("2", "Beta"), min: "2027-09-01" },
  ];
  const orphanOnly = [
    { product: product("3", "Wakix"), min: "2026-03-31", orphanEnd: { end: "2027-04-04", source: "computed" } },
    { product: product("4", "Soliris"), min: "2017-06-20", orphanEnd: { end: "2029-08-28", source: "computed" } },
  ];
  assert.deepEqual(endingByYear(rows, orphanOnly).map((item) => [item.year, item.rows.map((row) => [row.product.name_of_medicine, row.orphanOnly ?? false])]), [
    [2027, [["Alfa", false], ["Wakix", true], ["Beta", false]]],
    [2029, [["Soliris", true]]],
  ]);
});

test("the calendar's copy never says patent, has no em-dash and uses U.S. spelling", () => {
  const texts = [];
  const walk = (value) => {
    if (typeof value === "string") texts.push(value);
    else if (typeof value === "function") texts.push(String(value));
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(UI.protectionCalendar);
  assert.ok(texts.length > 5);
  for (const text of texts) {
    assert.doesNotMatch(text, /patent/i);
    assert.doesNotMatch(text, /—|authoris/);
  }
});

test("the calendar's labels: year buttons name the year and the count first (WCAG 2.5.3), later ones say so", () => {
  const copy = UI.protectionCalendar;
  assert.equal(copy.yearLabel({ key: "2027", year: 2027 }), "2027");
  assert.equal(copy.yearLabel({ key: LATER, year: 2031 }), "2031 or later");
  assert.equal(copy.yearName("2027", 44, 0), "2027: 44 medicines");
  assert.equal(copy.yearName("2031 or later", 1, 1), "2031 or later: 1 medicine, 1 with orphan market exclusivity (est.) running later");
  assert.equal(copy.yearOrphan(4), "4 orphan");
  assert.equal(copy.range("2027-03-12", "2028-03-12"), "Market protection ends (est.) 12 Mar 2027 – 12 Mar 2028");
  assert.equal(copy.range("2027-03-12", "2027-03-12"), "Market protection ends (est.) 12 Mar 2027");
  // The list's heading names the earliest end; the legend names what the segments differ in.
  assert.equal(copy.listTitle("2027", 11), "Earliest estimated end of market protection in 2027: 11 medicines");
  assert.equal(copy.legend.protection, "No later orphan market exclusivity");
  assert.equal(copy.legend.orphan([{ source: "computed" }]), "Orphan market exclusivity (est.) runs later");
});

// Owner decision 2026-09-30 ("be specific where you can, else estimate"): a label covering several
// orphan ends says "(est.)" when all are computed, nothing when all are the register's (exact), and
// "(partly est.)" when they mix; with none it keeps "(est.)".
test("the calendar's labels: a label over several orphan ends is marked by their sources", () => {
  const copy = UI.protectionCalendar;
  const computed = { end: "2031-01-01", source: "computed" };
  const register = { end: "2031-01-01", source: "register" };
  assert.equal(copy.legend.orphan([computed, computed]), "Orphan market exclusivity (est.) runs later");
  assert.equal(copy.legend.orphan([register]), "Orphan market exclusivity runs later");
  assert.equal(copy.legend.orphan([register, computed]), "Orphan market exclusivity (partly est.) runs later");
  assert.equal(copy.legend.orphan([]), "Orphan market exclusivity (est.) runs later");
  assert.equal(copy.yearName("2029", 3, 2, [register, register]), "2029: 3 medicines, 2 with orphan market exclusivity running later");
  assert.equal(copy.yearName("2029", 3, 2, [register, computed]), "2029: 3 medicines, 2 with orphan market exclusivity (partly est.) running later");
  assert.equal(copy.orphanOnlyLine(2, 2029, 2031, [register, register]),
    "2 more medicines have orphan market exclusivity running after their estimated market protection, ending 2029–2031. Not counted above.");
  assert.equal(copy.orphanOnlyTitle(2, [computed, register]), "Orphan market exclusivity (partly est.) after market protection: 2 medicines");
  assert.equal(copy.orphanOnlyTitle(2, [computed, computed]), "Orphan market exclusivity (est.) after market protection: 2 medicines");
});

test("calendarBuckets: each year keeps its medicines' orphan ends, whose sources mark its labels", () => {
  const computed = { end: "2033-01-01", source: "computed" };
  const register = { end: "2030-01-01", source: "register" };
  const rows = [
    { min: "2026-11-01", max: "2027-11-01", orphanEnd: computed },
    { min: "2026-12-01", max: "2027-12-01", orphanEnd: null },
    { min: "2027-02-01", max: "2028-02-01", orphanEnd: register },
  ];
  const [y2026, y2027] = calendarBuckets(rows, 2026, 5);
  assert.deepEqual([y2026.count, y2026.orphanLater, y2026.orphanEnds], [2, 1, [computed]]);
  assert.deepEqual([y2027.count, y2027.orphanLater, y2027.orphanEnds], [1, 1, [register]]);
});

test("orphanLater: on the same day, the register's exact end wins over a computed one", () => {
  const rows = [
    { exclusivity_end: "2031-03-01", end_source: "register" },
    { exclusivity_end: "2031-03-01", end_source: "computed" },
  ];
  assert.deepEqual(orphanLater(rows, "2026-09-29"), { end: "2031-03-01", source: "register" });
  assert.deepEqual(orphanLater([...rows].reverse(), "2026-09-29"), { end: "2031-03-01", source: "register" });
});

// The labels read end_source: every dated orphan end names one ("register", exact, or "computed",
// an estimate), so none is marked by default.
test("real data: every orphan exclusivity end says whether it is the register's or computed", { skip: !existsSync(new URL("../public/data/ema_medicine_orphan_exclusivity.json", import.meta.url)) }, () => {
  const rows = JSON.parse(readFileSync(new URL("../public/data/ema_medicine_orphan_exclusivity.json", import.meta.url), "utf8"));
  const unnamed = rows.filter((row) => row.exclusivity_end && row.end_source !== "register" && row.end_source !== "computed");
  assert.deepEqual(unnamed.map((row) => row.ema_product_number), []);
});

// Orphan market exclusivity ends computed from the link date (every one after the data date on
// 2026-09-28) are estimates, as the medicine card marks them; the register's own ends are not.
test("the calendar's labels: orphan market exclusivity ends say (est.) unless the register publishes them", () => {
  const copy = UI.protectionCalendar;
  assert.equal(copy.orphan({ end: "2029-11-20", source: "computed" }), "Orphan market exclusivity (est.) runs later, until 20 Nov 2029");
  assert.equal(copy.orphan({ end: "2029-11-20", source: "register" }), "Orphan market exclusivity runs later, until 20 Nov 2029");
  assert.equal(copy.company.orphan({ end: "2029-11-20", source: "computed" }), "orphan market exclusivity (est.) until 2029");
  assert.equal(copy.company.orphan({ end: "2029-11-20", source: "register" }), "orphan market exclusivity until 2029");
  assert.equal(copy.company.orphanOnly({ end: "2029-11-20", source: "computed" }), "orphan market exclusivity (est.) only");
  assert.equal(copy.company.orphanOnly({ end: "2029-11-20", source: "register" }), "orphan market exclusivity only");
  assert.equal(copy.orphanOnlyUntil({ end: "2029-11-20", source: "computed" }), "Orphan market exclusivity (est.) until 20 Nov 2029");
});

test("the calendar's labels: the unclear line names the latest year, the empty year counts only what is counted", () => {
  const copy = UI.protectionCalendar;
  assert.equal(copy.unclear(38, 2027), "38 more medicines may lose market protection by 2027: their earliest estimated end has passed, their latest has not. Not counted above.");
  assert.equal(copy.unclear(1, 2026), "1 more medicine may lose market protection by 2026: its earliest estimated end has passed, its latest has not. Not counted above.");
  assert.equal(copy.empty("2028", false), "No medicine counted here has its earliest estimated end in 2028.");
  assert.equal(copy.empty("2028", true), "No medicine matching the filters counted here has its earliest estimated end in 2028.");
  assert.equal(copy.orphanOnlyLine(20, 2027, 2036), "20 more medicines have orphan market exclusivity (est.) running after their estimated market protection, ending 2027–2036. Not counted above.");
  assert.equal(copy.orphanOnlyLine(1, 2029, 2029), "1 more medicine has orphan market exclusivity (est.) running after its estimated market protection, ending 2029. Not counted above.");
  assert.equal(copy.orphanOnlyTitle(20), "Orphan market exclusivity (est.) after market protection: 20 medicines");
  assert.equal(copy.ended("2018-06-20"), "Market protection ended (est.) 20 Jun 2018");
  // The caption repeats the medicine card's caveats (copies not yet checked, the range, national authorizations).
  for (const note of [copy.note, copy.company.note]) {
    assert.match(note, /earlier national authorizations are not counted/);
    assert.match(note, /copies not yet checked by hand count as medicines of their own/);
    assert.match(note, /possible extra year/);
    assert.doesNotMatch(note, /pediatric extensions/);
  }
});

// Spot check on the committed data (skipped before a pipeline run): the dashboard's unfiltered
// counts equal a count straight from the files.
const dataFile = (name) => new URL(`../public/data/${name}`, import.meta.url);
const files = ["ema_search_index.json", "ema_medicine_protection.json", "ema_medicine_orphan_exclusivity.json", "meta.json"];
test("the real data: every protected estimate of a currently authorized medicine lands in one bucket", { skip: files.every((file) => existsSync(dataFile(file))) ? false : "data files not found" }, () => {
  const [index, protectionRows, orphanRows, meta] = files.map((file) => JSON.parse(readFileSync(dataFile(file), "utf8")));
  const authorized = index.filter((row) => row.medicine_status === "Authorised" && row.marketing_authorisation_date);
  const numbers = new Set(authorized.map((row) => row.ema_product_number));
  // Every estimate of its own: basis own or other_company_reference (copies follow a reference).
  const own = protectionRows.filter((row) => numbers.has(row.ema_product_number) && !["follows_reference", "reference_not_found"].includes(row.basis));
  const expected = own.filter((row) => row.status === "protected");
  const { rows, unclear, orphanOnly } = protectionEnding(authorized, protectionOf(protectionRows, orphanRows), meta.snapshot_date);
  assert.equal(rows.length, expected.length);
  // Every own unclear estimate is on the unclear line or, with orphan market exclusivity running
  // after its latest end, in the orphan-only list.
  assert.equal(unclear + orphanOnly.filter((entry) => entry.status === "unclear").length, own.filter((row) => row.status === "unclear").length);
  assert.ok(orphanOnly.every((entry) => entry.orphanEnd.end > meta.snapshot_date));
  const first = Number(meta.snapshot_date.slice(0, 4));
  const buckets = calendarBuckets(rows, first, 5);
  assert.equal(buckets.reduce((sum, bucket) => sum + bucket.count, 0), expected.length);
  // "protected" means the earliest end is after the data date, so nothing falls before its year.
  assert.ok(rows.every((row) => Number(row.min.slice(0, 4)) >= first));
});
