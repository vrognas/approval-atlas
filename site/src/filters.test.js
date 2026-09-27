import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STATE } from "./url.js";
import { filterProducts, makePredicates, parseAtcQuery, splitAtcValues } from "./filters.js";

const product = (id, fields) => ({
  ema_product_number: id,
  mah: "Pfizer Europe MA EEIG",
  year: 2015,
  branches: [],
  areas: [],
  atc: [],
  medicine_type: "Other",
  medicine_status: "Authorised",
  ...fields,
});
const atcRows = (...codes) => codes.map((code) => ({ atc_code_human: code }));

const products = [
  product("P1", { mah: "Not stated", year: 2001, branches: ["C04"], areas: ["Lymphoma"], atc: atcRows("L01FA01") }),
  product("P2", { year: 2010, branches: ["C04", "C14"], areas: ["Breast Neoplasms"], atc: atcRows("L01XE"), medicine_type: "Generic" }),
  product("P3", { year: null, branches: ["C18"], areas: ["Diabetes Mellitus, Type 2"], atc: atcRows("A10BA02", "A10BH01"), medicine_status: "Withdrawn" }),
  product("P4", { mah: "Sanofi Pasteur MSD, SNC", year: 2020, atc: [], medicine_type: "Biosimilar" }),
];
const atcClasses = [
  { atc_code: "A", level: 1, name: "ALIMENTARY TRACT AND METABOLISM" },
  { atc_code: "A10", level: 2, name: "DRUGS USED IN DIABETES" },
  { atc_code: "A10BA02", level: 5, name: "metformin" },
  { atc_code: "L", level: 1, name: "ANTINEOPLASTIC AND IMMUNOMODULATING AGENTS" },
  { atc_code: "L01", level: 2, name: "ANTINEOPLASTIC AGENTS" },
  { atc_code: "L01FA", level: 4, name: "CD20 (Clusters of Differentiation 20) inhibitors" },
  { atc_code: "L01FA01", level: 5, name: "rituximab" },
];
const ids = (rows) => rows.map((row) => row.ema_product_number);
const run = (patch, except = null) =>
  ids(filterProducts(products, makePredicates({ ...structuredClone(DEFAULT_STATE), ...patch }, atcClasses), except));

test("the default state has no predicates and keeps every product", () => {
  assert.deepEqual(makePredicates(DEFAULT_STATE, atcClasses), {});
  assert.deepEqual(run({}), ["P1", "P2", "P3", "P4"]);
});

test("mah matches any selected holder, including the null-holder option", () => {
  assert.deepEqual(run({ mah: ["Not stated", "Sanofi Pasteur MSD, SNC"] }), ["P1", "P4"]);
});

test("the approval-year range is inclusive, open-ended and drops undated products only when set", () => {
  assert.deepEqual(run({ from: 2010, to: 2020 }), ["P2", "P4"]);
  assert.deepEqual(run({ from: 2010 }), ["P2", "P4"]);
  assert.deepEqual(run({ to: 2001 }), ["P1"]);
  assert.ok(run({}).includes("P3"));
});

test("branch and area match a product with any selected value", () => {
  assert.deepEqual(run({ branch: ["C14", "C18"] }), ["P2", "P3"]);
  assert.deepEqual(run({ area: ["Lymphoma", "Breast Neoplasms"] }), ["P1", "P2"]);
});

test("an ATC code is a case-insensitive prefix of any of the product's codes", () => {
  assert.deepEqual(run({ atc: ["l01"] }), ["P1", "P2"]);
  assert.deepEqual(run({ atc: ["L01F"] }), ["P1"]);
  assert.deepEqual(run({ atc: ["A10BH01"] }), ["P3"]);
});

test("ATC text that is not a code matches class names at any level, case-insensitively", () => {
  assert.deepEqual(run({ atc: ["Antineoplastic"] }), ["P1", "P2"]);
  assert.deepEqual(run({ atc: ["RITUX"] }), ["P1"]);
  assert.deepEqual(run({ atc: ["diabetes"] }), ["P3"]);
  assert.deepEqual(run({ atc: ["no such class"] }), []);
});

test("several ATC values combine with OR: codes and class-name queries alike", () => {
  assert.deepEqual(run({ atc: ["L01F", "A10BH01"] }), ["P1", "P3"]);
  assert.deepEqual(run({ atc: ["RITUX", "A10"] }), ["P1", "P3"]);
  assert.deepEqual(run({ atc: ["L01XE", "no such class"] }), ["P2"]);
  assert.deepEqual(makePredicates({ ...structuredClone(DEFAULT_STATE), atc: [] }, atcClasses), {});
});

test("ATC filters match valid code levels only: a malformed code (EMA's LX1XX02, VO4D) is in no class", () => {
  const coded = [product("M1", { atc: atcRows("LX1XX02") }), product("M2", { atc: atcRows("VO4D", "L04AC05") })];
  const match = (atc) => ids(filterProducts(coded, makePredicates({ ...structuredClone(DEFAULT_STATE), atc }, atcClasses)));
  assert.deepEqual(match(["L"]), ["M2"]);
  assert.deepEqual(match(["V"]), []);
  assert.deepEqual(match(["Antineoplastic"]), ["M2"]);
});

test("splitAtcValues: the codes (upper case) and the class-name queries of an ATC selection", () => {
  assert.deepEqual(splitAtcValues(["l04ac", "insulin", "C", " "]), { codes: ["L04AC", "C"], names: ["insulin"] });
  assert.deepEqual(splitAtcValues([]), { codes: [], names: [] });
});

test("type and status match the selected raw values", () => {
  assert.deepEqual(run({ type: ["Generic", "Biosimilar"] }), ["P2", "P4"]);
  assert.deepEqual(run({ status: ["Withdrawn"] }), ["P3"]);
});

test("filters combine, and except skips one dimension", () => {
  assert.deepEqual(run({ mah: ["Pfizer Europe MA EEIG"], branch: ["C04"] }), ["P2"]);
  assert.deepEqual(run({ mah: ["Pfizer Europe MA EEIG"], branch: ["C04"] }, "mah"), ["P1", "P2"]);
  assert.deepEqual(run({ from: 2018, atc: ["L"] }, "date"), ["P1", "P2"]);
});

test("parseAtcQuery tells code prefixes from names", () => {
  assert.deepEqual(parseAtcQuery("l01fa"), { kind: "code", value: "L01FA" });
  assert.deepEqual(parseAtcQuery(" L "), { kind: "code", value: "L" });
  assert.deepEqual(parseAtcQuery("L01FA01"), { kind: "code", value: "L01FA01" });
  assert.deepEqual(parseAtcQuery("Antineoplastic"), { kind: "name", value: "antineoplastic" });
  assert.deepEqual(parseAtcQuery("L1"), { kind: "name", value: "l1" });
  assert.deepEqual(parseAtcQuery("  "), { kind: "none" });
});
