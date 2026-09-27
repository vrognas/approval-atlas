import { test } from "node:test";
import assert from "node:assert/strict";
import {
  atcCheckState,
  atcChildren,
  atcClassesAt,
  atcCode,
  atcExactCounts,
  atcIncomplete,
  atcLadder,
  atcLevel,
  atcOrigin,
  atcPrefixCounts,
  atcPrefixes,
  atcTreeChildren,
  atcTreeCodes,
  atcTreeSearch,
  mainAtcCode,
  toggleAtcCode,
} from "./atc.js";

test("a code's level prefixes: all five, only those an incomplete code has, none for a malformed code", () => {
  assert.deepEqual(atcPrefixes("L04AC05"), ["L", "L04", "L04A", "L04AC", "L04AC05"]);
  assert.deepEqual(atcPrefixes("L01XE"), ["L", "L01", "L01X", "L01XE"]);
  assert.deepEqual(atcPrefixes("V"), ["V"]);
  assert.deepEqual(atcPrefixes("LX1XX02"), []);
  assert.deepEqual(atcPrefixes("VO4D"), []);
  assert.deepEqual(atcPrefixes("l04"), []);
  assert.deepEqual(atcPrefixes(""), []);
  assert.deepEqual(atcPrefixes(null), []);
});

test("atcLevel is the level of a valid code, null otherwise", () => {
  assert.deepEqual(["L", "L04", "L04A", "L04AC", "L04AC05"].map(atcLevel), [1, 2, 3, 4, 5]);
  assert.equal(atcLevel("LX1XX02"), null);
  assert.equal(atcLevel(""), null);
  assert.equal(atcLevel(null), null);
});

const product = (...codes) => ({ atc: codes.map((code) => ({ atc_code_human: code })) });
const products = [
  product("L04AC05"),
  product("L04AC07"),
  product("L04AC"), // incomplete: counts up to its last level
  product("L04AB02", "L04AB04"), // two codes in one class: counted once per prefix
  product("A10BJ06"),
  product("LX1XX02"), // malformed: no prefix
  product(),
];
const counts = atcPrefixCounts(products);
const names = new Map([
  ["A", "ALIMENTARY TRACT AND METABOLISM"],
  ["L", "ANTINEOPLASTIC AND IMMUNOMODULATING AGENTS"],
  ["L04", "IMMUNOSUPPRESSANTS"],
  ["L04A", "IMMUNOSUPPRESSANTS"],
  ["L04AC", "Interleukin inhibitors"],
  ["L04AC05", "ustekinumab"],
]);

test("prefix counts: products per prefix, each product once per prefix", () => {
  assert.deepEqual(Object.fromEntries(counts), {
    L: 4, L04: 4, L04A: 4, L04AC: 3, L04AC05: 1, L04AC07: 1, L04AB: 1, L04AB02: 1, L04AB04: 1,
    A: 1, A10: 1, A10B: 1, A10BJ: 1, A10BJ06: 1,
  });
  assert.equal(atcPrefixCounts([]).size, 0);
});

test("children: the next level under a prefix with products, most first, names from atc_classes or null", () => {
  assert.deepEqual(atcChildren(null, counts, names), [
    { code: "L", level: 1, name: "ANTINEOPLASTIC AND IMMUNOMODULATING AGENTS", count: 4 },
    { code: "A", level: 1, name: "ALIMENTARY TRACT AND METABOLISM", count: 1 },
  ]);
  assert.deepEqual(atcChildren("L04A", counts, names), [
    { code: "L04AC", level: 4, name: "Interleukin inhibitors", count: 3 },
    { code: "L04AB", level: 4, name: null, count: 1 },
  ]);
  // Ties by code.
  assert.deepEqual(atcChildren("L04AC", counts, names).map((row) => row.code), ["L04AC05", "L04AC07"]);
});

test("exact counts: products per code as published (valid codes only), each product once per code", () => {
  assert.deepEqual(Object.fromEntries(atcExactCounts([...products, product("L04AC", "L04AC")])), {
    L04AC05: 1, L04AC07: 1, L04AC: 2, L04AB02: 1, L04AB04: 1, A10BJ06: 1,
  });
});

test("children end with the products whose code stops at the prefix, so the rows add up to it", () => {
  const exact = atcExactCounts(products);
  assert.deepEqual(atcChildren("L04AC", counts, names, exact), [
    { code: "L04AC05", level: 5, name: "ustekinumab", count: 1 },
    { code: "L04AC07", level: 5, name: null, count: 1 },
    { code: "L04AC", level: 4, name: null, count: 1, incomplete: true },
  ]);
  // No such products: no row. Without exact counts: children only.
  assert.deepEqual(atcChildren("L04A", counts, names, exact).map((row) => row.code), ["L04AC", "L04AB"]);
  assert.deepEqual(atcChildren("L04AC", counts, names).map((row) => row.code), ["L04AC05", "L04AC07"]);
  // A class whose products all stop at it has no children: it is a leaf, not an incomplete row.
  const leaf = [product("B01")];
  assert.deepEqual(atcChildren("B01", atcPrefixCounts(leaf), names, atcExactCounts(leaf)), []);
});

test("a level-5 code, a class without products and a malformed prefix have no children", () => {
  assert.deepEqual(atcChildren("L04AC05", counts, names), []);
  assert.deepEqual(atcChildren("B01", counts, names), []);
  assert.deepEqual(atcChildren("LX1", counts, names), []);
});

test("the ladder of a code: one row per level with name and count", () => {
  assert.deepEqual(atcLadder("L04AC05", counts, names), [
    { level: 1, code: "L", name: "ANTINEOPLASTIC AND IMMUNOMODULATING AGENTS", count: 4 },
    { level: 2, code: "L04", name: "IMMUNOSUPPRESSANTS", count: 4 },
    { level: 3, code: "L04A", name: "IMMUNOSUPPRESSANTS", count: 4 },
    { level: 4, code: "L04AC", name: "Interleukin inhibitors", count: 3 },
    { level: 5, code: "L04AC05", name: "ustekinumab", count: 1 },
  ]);
  // An incomplete code stops at its last level; a prefix nobody has counts 0.
  assert.deepEqual(atcLadder("B01", counts, names), [
    { level: 1, code: "B", name: null, count: 0 },
    { level: 2, code: "B01", name: null, count: 0 },
  ]);
  // Counts not loaded yet: null.
  assert.deepEqual(atcLadder("A10", null, names).map((row) => row.count), [null, null]);
  assert.deepEqual(atcLadder("LX1XX02", counts, names), []);
});

test("a substance's main code is its medicines' most common; the others name their medicines", () => {
  assert.deepEqual(mainAtcCode([
    { name: "Ozempic", codes: ["A10BJ06"] },
    { name: "Rybelsus", codes: ["A10BJ06"] },
    { name: "Kyinsu", codes: ["A10AE57"] },
    { name: "Wegovy", codes: ["A10BJ06"] },
  ]), { code: "A10BJ06", others: [{ code: "A10AE57", names: ["Kyinsu"] }] });
  // A medicine that also has the main code is not listed; one without codes is not "classed".
  assert.deepEqual(mainAtcCode([
    { name: "Humalog", codes: ["A10AB04", "A10AD04"] },
    { name: "Liprolog", codes: ["A10AB04", "A10AD04"] },
    { name: "Admelog", codes: ["A10AB04"] },
    { name: "Other", codes: [] },
  ]), { code: "A10AB04", others: [] });
  assert.deepEqual(mainAtcCode([
    { name: "A", codes: ["L01XC02"] },
    { name: "B", codes: ["L01FA01"] },
    { name: "C", codes: ["L01FA01"] },
    { name: "D", codes: ["L01XC02"] },
  ]).others, [{ code: "L01FA01", names: ["B", "C"] }]);
});

test("main code ties: the shorter code, then the first seen", () => {
  assert.equal(mainAtcCode([{ name: "X", codes: ["L04AC05"] }, { name: "Y", codes: ["L04AC"] }]).code, "L04AC");
  assert.equal(mainAtcCode([{ name: "X", codes: ["B01AC06"] }, { name: "Y", codes: ["A01AA01"] }]).code, "B01AC06");
  assert.deepEqual(mainAtcCode([{ name: "X", codes: [] }]), { code: null, others: [] });
  assert.deepEqual(mainAtcCode([]), { code: null, others: [] });
});

// The ATC filter is a list of classes combined with OR ("C and H03"): the tree, table segments and
// breakdown toggle one class at a time, and no selected class ever covers another.
test("toggling a class: removed when selected, else added in place of the classes it covers or is covered by", () => {
  assert.deepEqual(toggleAtcCode(["C", "H03"], "H03"), ["C"]);
  assert.deepEqual(toggleAtcCode(["C"], "H03"), ["C", "H03"]);
  assert.deepEqual(toggleAtcCode(["C01", "H03", "C03AA"], "C"), ["H03", "C"]);
  assert.deepEqual(toggleAtcCode(["L", "H03"], "L04"), ["H03", "L04"]);
  // Class-name queries (from older links) stay, even when they start with the code's letters.
  assert.deepEqual(toggleAtcCode(["Cardiac", "insulin"], "C"), ["Cardiac", "insulin", "C"]);
  assert.deepEqual(toggleAtcCode([], "L04AC"), ["L04AC"]);
});

test("a tree checkbox: checked, included under a checked class, mixed above one, or unchecked", () => {
  const selected = ["C", "H03", "L04AC"];
  assert.equal(atcCheckState("C", selected), "checked");
  assert.equal(atcCheckState("C01", selected), "included");
  assert.equal(atcCheckState("C01AA05", selected), "included");
  assert.equal(atcCheckState("H", selected), "mixed");
  assert.equal(atcCheckState("L04A", selected), "mixed");
  assert.equal(atcCheckState("L04AC05", selected), "included");
  assert.equal(atcCheckState("H02", selected), "unchecked");
  assert.equal(atcCheckState("A", []), "unchecked");
});

test("tree nodes: every class with products, plus the selected classes and their levels", () => {
  const nodes = atcTreeCodes(counts, ["B01AC06", "L04AC"]);
  assert.deepEqual([...nodes].sort(), [...counts.keys(), "B", "B01", "B01A", "B01AC", "B01AC06"].sort());
  assert.equal(atcTreeCodes(new Map([["A", 0]]), []).size, 0);
});

test("tree children: the next level under a class (level 1 under none), in code order", () => {
  const nodes = atcTreeCodes(counts, []);
  assert.deepEqual(atcTreeChildren(null, nodes), ["A", "L"]);
  assert.deepEqual(atcTreeChildren("L04A", nodes), ["L04AB", "L04AC"]);
  assert.deepEqual(atcTreeChildren("L04AC05", nodes), []);
});

test("tree search: the top matching classes by code prefix or name, their levels opened", () => {
  const nodes = atcTreeCodes(counts, []);
  const sorted = (set) => [...set].sort();
  const byCode = atcTreeSearch(nodes, names, " l04a ");
  assert.deepEqual(byCode.matches, ["L04A"]);
  assert.deepEqual(sorted(byCode.open), ["L", "L04"]);
  assert.deepEqual(sorted(byCode.shown), ["L", "L04", "L04A", "L04AB", "L04AB02", "L04AB04", "L04AC", "L04AC05", "L04AC07"]);
  const byName = atcTreeSearch(nodes, names, "interleukin");
  assert.deepEqual(byName.matches, ["L04AC"]);
  assert.deepEqual(sorted(byName.open), ["L", "L04", "L04A"]);
  assert.deepEqual(sorted(byName.shown), ["L", "L04", "L04A", "L04AC", "L04AC05", "L04AC07"]);
  // A class under a matching class is not a match of its own (its level stays closed).
  assert.deepEqual(atcTreeSearch(nodes, names, "Immuno").matches, ["L"]);
  // Names match from 3 characters; a single letter is a level-1 code.
  assert.deepEqual(atcTreeSearch(nodes, names, "a").matches, ["A"]);
  assert.deepEqual(atcTreeSearch(nodes, names, "xyz").matches, []);
  assert.equal(atcTreeSearch(nodes, names, "  "), null);
});

// Phase 4c: the per-year chart stacks (and the activity card's columns) by the classes one level
// below the selected class.
test("a product's classes one level below a class: level 1 under none, the class itself at level 5", () => {
  const multi = product("L04AC05", "L01FA01", "A10BJ06", "LX1XX02");
  assert.deepEqual(atcClassesAt(multi, null), ["L", "L", "A"]);
  assert.deepEqual(atcClassesAt(multi, "L"), ["L04", "L01"]);
  assert.deepEqual(atcClassesAt(multi, "L04AC"), ["L04AC05"]);
  // Coded only down to the class: no class below it.
  assert.deepEqual(atcClassesAt(product("L04AC"), "L04AC"), []);
  assert.deepEqual(atcClassesAt(product("L04AC05"), "L04AC05"), ["L04AC05"]);
  assert.deepEqual(atcClassesAt(product("A10BJ06"), "L"), []);
  assert.deepEqual(atcClassesAt(product(), null), []);
});
// Phase 4c review (data contract, phase 4d): rows carry the code to use (`atc_code`, completed from
// the product information when EMA's is incomplete) and the code a retired one moved to
// (`current_atc_code`); products without an EMA code have `atc_code_human` null.
const row = (atc_code_human, atc_code = atc_code_human, extra = {}) => ({ atc_code_human, atc_code, current_atc_code: null, atc_code_conflict: false, ...extra });

test("atcCode: the current code of a retired one, else the code to use, else EMA's (older files); null without one", () => {
  assert.equal(atcCode(row("L01XC02", "L01XC02", { current_atc_code: "L01FA01" })), "L01FA01");
  assert.equal(atcCode(row("L01XL", "L01XL12")), "L01XL12");
  assert.equal(atcCode(row(null, "L04AG05")), "L04AG05");
  assert.equal(atcCode({ atc_code_human: "L04AC05" }), "L04AC05");
  assert.equal(atcCode({ atc_code_human: null }), null);
});

test("counts, classes and prefixes follow the code to use; rows without a code are skipped", () => {
  const entyvio = { atc: [row(null, "L04AG05")] };
  const retired = { atc: [row("L01XC02", "L01XC02", { current_atc_code: "L01FA01" })] };
  const empty = { atc: [{ atc_code_human: null }] };
  const counted = atcPrefixCounts([entyvio, retired, empty]);
  assert.equal(counted.get("L04AG05"), 1);
  assert.equal(counted.get("L01FA"), 1);
  assert.equal(counted.has("L01XC"), false);
  assert.deepEqual(Object.fromEntries(atcExactCounts([entyvio, retired, empty])), { L04AG05: 1, L01FA01: 1 });
  assert.deepEqual(atcClassesAt(entyvio, null), ["L"]);
  assert.deepEqual(atcClassesAt(empty, null), []);
});

test("atcOrigin: how the code shown differs from EMA's published one (null when it does not)", () => {
  assert.equal(atcOrigin(row("L04AC05")), null);
  assert.equal(atcOrigin({ atc_code_human: "L04AC05" }), null);
  assert.deepEqual(atcOrigin(row("L01XC02", "L01XC02", { current_atc_code: "L01FA01" })), { kind: "retired", from: "L01XC02", now: "L01FA01" });
  assert.deepEqual(atcOrigin(row("L01XL", "L01XL12")), { kind: "completed", published: "L01XL" });
  assert.deepEqual(atcOrigin(row("C09", "C03DA05", { atc_code_conflict: true })), { kind: "conflict", published: "C09" });
  assert.deepEqual(atcOrigin(row(null, "L04AG05")), { kind: "smpc" });
});

test("a code is incomplete unless it is a valid level-5 code", () => {
  assert.equal(atcIncomplete("L04AC05"), false);
  assert.equal(atcIncomplete("L04AC"), true);
  assert.equal(atcIncomplete("LX1XX02"), true);
});
