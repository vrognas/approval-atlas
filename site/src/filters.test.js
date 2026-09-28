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
  areaKeys: [],
  atc: [],
  medicine_type: "Other",
  medicine_status: "Authorised",
  ...fields,
});
const atcRows = (...codes) => codes.map((code) => ({ atc_code_human: code }));

const products = [
  // areaKeys: buildAreaTree().keysOf(areas), a product's terms and every branch and tree node above them.
  product("P1", { mah: "Not stated", year: 2001, branches: ["C04"], areas: ["Lymphoma"], areaKeys: ["Lymphoma", "C04", "C04.557", "C15"], atc: atcRows("L01FA01") }),
  product("P2", { year: 2010, branches: ["C04", "C14"], areas: ["Breast Neoplasms"], areaKeys: ["Breast Neoplasms", "C04", "C04.588", "C04.588.180", "C17"], atc: atcRows("L01XE"), medicine_type: "Generic" }),
  product("P3", { year: null, branches: ["C18"], areas: ["Diabetes Mellitus, Type 2"], areaKeys: ["Diabetes Mellitus, Type 2", "C18", "C19"], atc: atcRows("A10BA02", "A10BH01"), medicine_status: "Withdrawn" }),
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

// Companies part 2: company group keys, company keys and EMA holder names, combined with OR.
test("mah matches a product's company group, company or EMA holder name", () => {
  const grouped = [
    product("C1", { company_key: "c.pfizer", group_key: "g.pfizer" }),
    product("C2", { mah: "Wyeth Europa Ltd.", company_key: "c.wyeth", group_key: "g.pfizer" }),
    product("C3", { mah: "Sanofi Pasteur MSD, SNC", company_key: "c.sanofi-pasteur-msd", group_key: "g.sanofi-pasteur-msd" }),
    product("C4", { mah: "Not stated", company_key: null, group_key: null }),
  ];
  const match = (mah) => ids(filterProducts(grouped, makePredicates({ ...structuredClone(DEFAULT_STATE), mah }, atcClasses)));
  assert.deepEqual(match(["g.pfizer"]), ["C1", "C2"]);
  assert.deepEqual(match(["c.wyeth"]), ["C2"]);
  assert.deepEqual(match(["c.wyeth", "Sanofi Pasteur MSD, SNC"]), ["C2", "C3"]);
  assert.deepEqual(match(["Not stated"]), ["C4"]);
});

// A company tree row whose value also shows under another group (or company) selects by its path:
// "group/company" or "group/company/EMA holder name", only the medicines that row counts.
test("mah matches a row path: that group's medicines of the company (and EMA holder name)", () => {
  const split = [
    product("M1", { mah: "Merck Sharp & Dohme B.V.", company_key: "c.msd", group_key: "g.msd" }),
    product("M2", { mah: "Merck Sharp & Dohme B.V.", company_key: "c.msd", group_key: "g.organon" }),
    product("M3", { mah: "Organon N.V.", company_key: "c.organon", group_key: "g.organon" }),
    product("M4", { mah: "Merck Sharp & Dohme Ltd", company_key: "c.msd", group_key: "g.msd" }),
  ];
  const match = (mah) => ids(filterProducts(split, makePredicates({ ...structuredClone(DEFAULT_STATE), mah }, atcClasses)));
  assert.deepEqual(match(["g.organon/c.msd"]), ["M2"]);
  assert.deepEqual(match(["g.msd/c.msd"]), ["M1", "M4"]);
  assert.deepEqual(match(["g.msd/c.msd/Merck Sharp & Dohme B.V."]), ["M1"]);
  assert.deepEqual(match(["g.organon/c.msd", "M4"]), ["M2"]);
  assert.deepEqual(match(["g.organon/c.msd", "Merck Sharp & Dohme Ltd"]), ["M2", "M4"]);
  // The plain company is all of it.
  assert.deepEqual(match(["c.msd"]), ["M1", "M2", "M4"]);
});

test("the approval-year range is inclusive, open-ended and drops undated products only when set", () => {
  assert.deepEqual(run({ from: 2010, to: 2020 }), ["P2", "P4"]);
  assert.deepEqual(run({ from: 2010 }), ["P2", "P4"]);
  assert.deepEqual(run({ to: 2001 }), ["P1"]);
  assert.ok(run({}).includes("P3"));
});

// Phase 4f: one therapeutic area filter holding branch codes, tree numbers and EMA's terms.
test("the area filter matches a product with any selected branch, tree node or term", () => {
  assert.deepEqual(run({ area: ["C17", "C18"] }), ["P2", "P3"]);
  assert.deepEqual(run({ area: ["C04.588"] }), ["P2"]);
  assert.deepEqual(run({ area: ["Lymphoma", "Breast Neoplasms"] }), ["P1", "P2"]);
  assert.deepEqual(makePredicates({ ...structuredClone(DEFAULT_STATE), area: [] }, atcClasses), {});
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

// Phase 4c review: the filter uses the code to use (atcCode()): a retired code under the class WHO
// moved it to, a code from the product information for a product without an EMA code.
test("ATC filters match the code to use: a retired code's current class, a product information code", () => {
  const coded = [
    product("R1", { atc: [{ atc_code_human: "L01XC02", atc_code: "L01XC02", current_atc_code: "L01FA01" }] }),
    product("S1", { atc: [{ atc_code_human: null, atc_code: "L04AG05", current_atc_code: null }] }),
    product("N1", { atc: [{ atc_code_human: null }] }),
  ];
  const match = (atc) => ids(filterProducts(coded, makePredicates({ ...structuredClone(DEFAULT_STATE), atc }, atcClasses)));
  assert.deepEqual(match(["L01FA"]), ["R1"]);
  assert.deepEqual(match(["L01XC"]), []);
  assert.deepEqual(match(["L04AG"]), ["S1"]);
  assert.deepEqual(match(["L"]), ["R1", "S1"]);
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
  assert.deepEqual(run({ mah: ["Pfizer Europe MA EEIG"], area: ["C04"] }), ["P2"]);
  assert.deepEqual(run({ mah: ["Pfizer Europe MA EEIG"], area: ["C04"] }, "mah"), ["P1", "P2"]);
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
