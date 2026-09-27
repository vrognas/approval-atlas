import { test } from "node:test";
import assert from "node:assert/strict";
import { atcChildren, atcExactCounts, atcLadder, atcLevel, atcPrefixCounts, atcPrefixes, mainAtcCode } from "./atc.js";

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
