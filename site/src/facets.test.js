import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STATE } from "./url.js";
import { atcClassesAt } from "./atc.js";
import { makePredicates } from "./filters.js";
import {
  FACET_VALUES,
  OTHER_KEY,
  TYPE_ORDER,
  defaultSortDirection,
  facetCounts,
  facetRows,
  holderActivity,
  keyCounts,
  nextSort,
  orderActivityColumns,
  sentenceParts,
  sortActivityRows,
  statusBreakdown,
  tokenLabel,
  topAreas,
  topKeys,
  topWithOther,
  typeSplit,
  yearHistogram,
  yearStacks,
} from "./facets.js";

const product = (id, fields) => ({
  ema_product_number: id,
  mah: "Pfizer Europe MA EEIG",
  year: 2015,
  authorized_from: "2015-03-01",
  branches: [],
  areas: [],
  areaKeys: [],
  atc: [],
  medicine_type: "Other",
  medicine_status: "Authorised",
  ...fields,
});

const products = [
  // areaKeys: the therapeutic area tree keys (areas.js keysOf()); P3's term matched no branch.
  product("P1", { medicine_type: "Biosimilar", branches: ["C17"], areas: ["Psoriasis"], areaKeys: ["Psoriasis", "C17", "C17.800"], year: 2020, authorized_from: "2020-01-01" }),
  product("P2", { medicine_type: "Biosimilar", branches: ["C17", "C05"], areas: ["Psoriasis", "Arthritis, Psoriatic"], areaKeys: ["Psoriasis", "C17", "C17.800", "Arthritis, Psoriatic", "C05"] }),
  product("P3", { medicine_type: "Generic", mah: "Accord Healthcare S.L.U.", areas: ["Psoriasis"], areaKeys: ["Psoriasis"] }),
  // Withdrawn: counted like any other status (one dashboard, every status).
  product("P4", { medicine_status: "Withdrawn", branches: ["C17"], areas: ["Psoriasis"], areaKeys: ["Psoriasis", "C17", "C17.800"] }),
  // Authorised without an approval date: counted, but not in the approval years.
  product("P5", { year: null, authorized_from: null, medicine_type: "Generic" }),
  // Refused: never dated.
  product("P6", { medicine_status: "Refused", year: null, authorized_from: null }),
];
const predicatesOf = (patch) => makePredicates({ ...structuredClone(DEFAULT_STATE), ...patch }, []);
const counted = (patch, dimension) => Object.fromEntries(facetCounts(products, predicatesOf(patch), dimension, FACET_VALUES[dimension]));

test("facets count every matching medicine, whatever its status", () => {
  assert.deepEqual(counted({}, "type"), { Biosimilar: 2, Generic: 2, Other: 2 });
  assert.deepEqual(counted({}, "status"), { Authorised: 4, Withdrawn: 1, Refused: 1 });
});

test("a facet's counts ignore its own filter and apply every other one", () => {
  // Selecting a type does not change the type counts...
  assert.deepEqual(counted({ type: ["Generic"] }, "type"), { Biosimilar: 2, Generic: 2, Other: 2 });
  // ...but narrows the others.
  assert.deepEqual(counted({ type: ["Biosimilar"] }, "mah"), { "Pfizer Europe MA EEIG": 2 });
  assert.deepEqual(counted({ mah: ["Accord Healthcare S.L.U."] }, "type"), { Generic: 1 });
  assert.deepEqual(counted({ type: ["Generic"] }, "status"), { Authorised: 2 });
  assert.deepEqual(counted({ status: ["Withdrawn"] }, "status"), { Authorised: 4, Withdrawn: 1, Refused: 1 });
  assert.deepEqual(counted({ status: ["Withdrawn"] }, "type"), { Other: 1 });
});

test("a product counts once for each of its values", () => {
  // Phase 4f: the therapeutic area tree counts every key a medicine touches.
  assert.deepEqual(counted({}, "area"), { Psoriasis: 4, C17: 3, "C17.800": 3, "Arthritis, Psoriatic": 1, C05: 1 });
  assert.equal("branch" in FACET_VALUES, false);
});

test("approval years count per year and ignore the year filter itself", () => {
  assert.deepEqual(counted({ from: 2018 }, "date"), { 2015: 3, 2020: 1 });
  assert.deepEqual(counted({ from: 2018 }, "type"), { Biosimilar: 1 });
});

const histogram = (patch, rows = products) => yearHistogram(rows, predicatesOf(patch), [2014, 2021]);
const nonZero = (rows) => Object.fromEntries(rows.filter((row) => row.count > 0).map((row) => [row.year, row.count]));

test("year histogram: one row per year of the data range, zeros included", () => {
  const rows = histogram({});
  assert.deepEqual(rows.map((row) => row.year), [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021]);
  assert.deepEqual(rows[0], { year: 2014, count: 0 });
});

// Phase 4f: the strip is a slim one-colour year filter; the status stacks moved to the per-year
// chart ("Stack by" Status, yearStacks()).
test("year histogram: every medicine with an approval date, one count per year", () => {
  // The undated P5 and P6 are left out; the withdrawn P4 counts like any other status.
  assert.deepEqual(nonZero(histogram({})), { 2015: 3, 2020: 1 });
  assert.deepEqual(histogram({})[1], { year: 2015, count: 3 });
});

test("year histogram: ignores the year filter and applies every other one", () => {
  assert.deepEqual(nonZero(histogram({ from: 2018 })), { 2015: 3, 2020: 1 });
  assert.deepEqual(nonZero(histogram({ from: 2018, to: 2019, type: ["Biosimilar"] })), { 2015: 1, 2020: 1 });
  assert.deepEqual(nonZero(histogram({ status: ["Withdrawn"] })), { 2015: 1 });
});

test("status breakdown: statuses by count, ties in stack order", () => {
  assert.deepEqual(statusBreakdown(products), [
    { status: "Authorised", count: 4 },
    { status: "Withdrawn", count: 1 },
    { status: "Refused", count: 1 },
  ]);
  assert.deepEqual(statusBreakdown([]), []);
});

const labelOf = (value) => value.toUpperCase();

test("facet rows: most first (ties by label), zero counts left out, selected values always listed", () => {
  const counts = new Map([["b", 5], ["a", 5], ["c", 9], ["d", 0]]);
  assert.deepEqual(facetRows(counts, [], { labelOf }).rows.map((row) => row.value), ["c", "a", "b"]);
  const { rows } = facetRows(counts, ["d", "x"], { labelOf });
  assert.deepEqual(rows.map((row) => [row.value, row.count, row.selected]), [["c", 9, false], ["a", 5, false], ["b", 5, false], ["d", 0, true], ["x", 0, true]]);
});

test("facet rows: a limit keeps the top rows and every selected one; total counts all matches", () => {
  const counts = new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4]]);
  const limited = facetRows(counts, ["a"], { labelOf, limit: 2 });
  assert.deepEqual(limited.rows.map((row) => row.value), ["d", "c", "a"]);
  assert.equal(limited.total, 4);
  assert.equal(limited.hidden, 1);
  assert.equal(facetRows(counts, [], { labelOf }).hidden, 0);
  // Pinned: the selected values first.
  assert.deepEqual(facetRows(counts, ["a"], { labelOf, limit: 2, pin: true }).rows.map((row) => row.value), ["a", "d", "c"]);
});

test("facet rows: the search matches labels case-insensitively; selected rows stay", () => {
  const counts = new Map([["psoriasis", 3], ["arthritis, psoriatic", 1], ["asthma", 7]]);
  const found = facetRows(counts, ["asthma"], { labelOf, query: " PSOR ", pin: true });
  assert.deepEqual(found.rows.map((row) => row.value), ["asthma", "psoriasis", "arthritis, psoriatic"]);
  assert.equal(found.total, 2);
  assert.equal(found.hidden, 0);
  assert.deepEqual(facetRows(counts, [], { labelOf, query: "zzz" }), { rows: [], total: 0, hidden: 0 });
});

test("facet rows: kept values stay listed like selected ones (a row just unchecked keeps its place for focus)", () => {
  const counts = new Map([["a", 1], ["b", 2], ["c", 3], ["d", 0]]);
  // Beyond the limit, with a count of 0, or not matching the search: still listed, not hidden.
  const kept = facetRows(counts, [], { labelOf, limit: 1, keep: ["a", "d"] });
  assert.deepEqual(kept.rows.map((row) => [row.value, row.selected]), [["c", false], ["a", false], ["d", false]]);
  assert.equal(kept.hidden, 1);
  assert.deepEqual(facetRows(counts, [], { labelOf, query: "b", keep: ["a"] }).rows.map((row) => row.value), ["b", "a"]);
  assert.deepEqual(facetRows(counts, [], { labelOf, limit: 1 }).rows.map((row) => row.value), ["c"]);
});

test("medicine types show in stack order", () => {
  assert.deepEqual(TYPE_ORDER, ["Other", "Generic", "Biosimilar", "Advanced therapy"]);
});

const lookups = {
  years: [1995, 2026],
  areaNames: new Map([["C17", "Skin and Connective Tissue Diseases"], ["C17.800", "Skin Diseases"], ["Psoriasis", "Psoriasis"]]),
  atcNames: new Map([["L04AC", "Interleukin inhibitors"], ["L", "ANTINEOPLASTIC AND IMMUNOMODULATING AGENTS"], ["C", "CARDIOVASCULAR SYSTEM"]]),
};
const stateOf = (patch) => ({ ...structuredClone(DEFAULT_STATE), ...patch });

test("sentence tokens read as defaults without filters", () => {
  const label = (dimension) => tokenLabel(dimension, stateOf({}), lookups);
  assert.deepEqual(
    ["type", "atc", "mah", "area", "from", "to", "status"].map(label),
    ["all medicine types", "all ATC classes", "all holders", "all therapeutic areas", "1995", "2026", "any status"],
  );
});

test("sentence tokens name one selection, or count several", () => {
  assert.equal(tokenLabel("type", stateOf({ type: ["Biosimilar"] }), lookups), "Biosimilar");
  assert.equal(tokenLabel("type", stateOf({ type: ["Biosimilar", "Generic"] }), lookups), "2 medicine types");
  assert.equal(tokenLabel("mah", stateOf({ mah: ["Novo Nordisk A/S"] }), lookups), "Novo Nordisk A/S");
  assert.equal(tokenLabel("mah", stateOf({ mah: ["A", "B", "C"] }), lookups), "3 holders");
  // Phase 4f: one therapeutic area list: a branch, tree node or term by its name.
  assert.equal(tokenLabel("area", stateOf({ area: ["C17"] }), lookups), "Skin and Connective Tissue Diseases");
  assert.equal(tokenLabel("area", stateOf({ area: ["C17.800"] }), lookups), "Skin Diseases");
  assert.equal(tokenLabel("area", stateOf({ area: ["Psoriasis"] }), lookups), "Psoriasis");
  assert.equal(tokenLabel("area", stateOf({ area: ["Psoriasis", "Asthma"] }), lookups), "2 therapeutic areas");
  assert.equal(tokenLabel("status", stateOf({ status: ["Authorised"] }), lookups), "status Authorized");
  assert.equal(tokenLabel("status", stateOf({ status: ["Refused", "Withdrawn"] }), lookups), "2 statuses");
  assert.equal(tokenLabel("from", stateOf({ from: 2015 }), lookups), "2015");
  assert.equal(tokenLabel("to", stateOf({ to: 2020 }), lookups), "2020");
});

test("the ATC token names one class, quotes a name filter, reads two as codes and counts more", () => {
  assert.equal(tokenLabel("atc", stateOf({ atc: ["L04AC"] }), lookups), "L04AC Interleukin Inhibitors");
  assert.equal(tokenLabel("atc", stateOf({ atc: ["L"] }), lookups), "L Antineoplastic and Immunomodulating Agents");
  assert.equal(tokenLabel("atc", stateOf({ atc: ["L04AL"] }), lookups), "L04AL");
  assert.equal(tokenLabel("atc", stateOf({ atc: ["insulin"] }), lookups), "ATC classes matching “insulin”");
  assert.equal(tokenLabel("atc", stateOf({ atc: ["C", "H03"] }), lookups), "C and H03");
  assert.equal(tokenLabel("atc", stateOf({ atc: ["A", "C", "H03"] }), lookups), "3 ATC classes");
});

const text = (parts) => parts.map((part) => (typeof part === "string" ? part : `[${part.text}]`)).join("");

test("the filter sentence: defaults, one therapeutic area token", () => {
  assert.equal(
    text(sentenceParts(stateOf({}), lookups)),
    "Showing [all medicine types] in [all ATC classes] from [all holders] in [all therapeutic areas], approved in [any year], with [any status].",
  );
  const [areas] = sentenceParts(stateOf({}), lookups).filter((part) => part.key === "area");
  assert.deepEqual(areas, { key: "area", text: "all therapeutic areas", active: false, clears: ["area"] });
  // Phase 4c review: without a year filter the count includes medicines never approved, so the
  // sentence does not name a year range; one token focuses the slider.
  const [years] = sentenceParts(stateOf({}), lookups).filter((part) => part.key === "years");
  assert.deepEqual(years, { key: "years", text: "any year", active: false, clears: ["from", "to"] });
});

test("the filter sentence: active tokens, each clearing its own filter", () => {
  const parts = sentenceParts(stateOf({ type: ["Biosimilar"], atc: ["L04AC"], area: ["C17"], from: 2015, status: ["Authorised"] }), lookups);
  assert.equal(
    text(parts),
    "Showing [Biosimilar] in [L04AC Interleukin Inhibitors] from [all holders] in [Skin and Connective Tissue Diseases], approved [2015]–[2026] (medicines without an approval date left out), with [status Authorized].",
  );
  const tokens = parts.filter((part) => typeof part !== "string");
  assert.deepEqual(tokens.filter((part) => part.active).map((part) => [part.key, part.clears]), [
    ["type", ["type"]], ["atc", ["atc"]], ["area", ["area"]], ["from", ["from"]], ["status", ["status"]],
  ]);
  assert.deepEqual(tokens.filter((part) => !part.active).map((part) => part.key), ["mah", "to"]);
});

test("the filter sentence: one approval year is one token clearing both ends", () => {
  const parts = sentenceParts(stateOf({ from: 2024, to: 2024 }), lookups);
  assert.equal(
    text(parts),
    "Showing [all medicine types] in [all ATC classes] from [all holders] in [all therapeutic areas], approved in [2024] (medicines without an approval date left out), with [any status].",
  );
  assert.deepEqual(parts.find((part) => part.key === "year"), { key: "year", text: "2024", active: true, clears: ["from", "to"] });
  // The data's first or last year alone keeps that end open (normalizeYearRange()).
  assert.match(text(sentenceParts(stateOf({ from: null, to: 1995 }), lookups)), /, approved in \[1995\] \(/);
  assert.match(text(sentenceParts(stateOf({ from: 2026, to: null }), lookups)), /, approved in \[2026\] \(/);
  assert.match(text(sentenceParts(stateOf({ from: 2023, to: 2024 }), lookups)), /, approved \[2023\]–\[2024\] \(/);
});

test("the filter sentence: two ATC classes are two pills, each removing its own class; more are one", () => {
  const two = sentenceParts(stateOf({ atc: ["C", "H03"] }), lookups);
  assert.match(text(two), / in \[C\] and \[H03\] from /);
  assert.deepEqual(two.filter((part) => part.key === "atc").map((part) => [part.text, part.value, part.active]), [["C", "C", true], ["H03", "H03", true]]);
  const three = sentenceParts(stateOf({ atc: ["A", "C", "H03"] }), lookups).filter((part) => part.key === "atc");
  assert.deepEqual(three.map((part) => [part.text, part.value, part.clears]), [["3 ATC classes", undefined, ["atc"]]]);
});

test("the filter sentence: a type token naming one type with an explanation carries it", () => {
  const typeToken = (type) => sentenceParts(stateOf({ type }), lookups).find((part) => part.key === "type");
  assert.equal(typeToken(["Biosimilar"]).tip, "Biosimilar");
  assert.equal(typeToken(["Advanced therapy"]).tip, "Advanced therapy");
  // Phase 4c review: Other is explained too.
  assert.equal(typeToken(["Other"]).tip, "Other");
  assert.equal(typeToken(["Biosimilar", "Generic"]).tip, null);
  assert.equal(typeToken([]).tip, null);
});

// Phase 4f: statuses explain themselves as the types do (UI.statusTips).
test("the filter sentence: a status token naming one status with an explanation carries it", () => {
  const statusToken = (status) => sentenceParts(stateOf({ status }), lookups).find((part) => part.key === "status");
  assert.equal(statusToken(["Lapsed"]).tip, "Lapsed");
  assert.equal(statusToken(["Authorised"]).tip, "Authorised");
  assert.equal(statusToken(["Something new"]).tip, null);
  assert.equal(statusToken(["Refused", "Withdrawn"]).tip, null);
  assert.equal(statusToken([]).tip, null);
});

test("the most common conditions: areas by products, with the MeSH descriptor when known", () => {
  const descriptorOf = new Map([["Psoriasis", "D011565"]]);
  assert.deepEqual(topAreas(products.slice(0, 3), descriptorOf), [
    { term: "Psoriasis", count: 3, authorized: 3, descriptorUi: "D011565" },
    { term: "Arthritis, Psoriatic", count: 1, authorized: 1, descriptorUi: null },
  ]);
  // Phase 4c review: every status counts, and how many are authorized is kept (the condition page
  // opens with those): the withdrawn P4 counts, but not as authorized.
  assert.deepEqual(topAreas(products.slice(0, 4), descriptorOf)[0], { term: "Psoriasis", count: 4, authorized: 3, descriptorUi: "D011565" });
  assert.deepEqual(topAreas(products.slice(0, 3), descriptorOf, 1).map((row) => row.term), ["Psoriasis"]);
  assert.deepEqual(topAreas([], descriptorOf), []);
  // Phase 4f: with a therapeutic area filter, only the terms within it (within(term)).
  assert.deepEqual(topAreas(products.slice(0, 3), descriptorOf, 8, (term) => term !== "Psoriasis").map((row) => row.term), ["Arthritis, Psoriatic"]);
});

test("type split: products per key and medicine type, each product once per key", () => {
  const split = typeSplit(products.slice(0, 5), (row) => row.branches.concat(row.branches));
  assert.deepEqual(Object.fromEntries([...split].map(([key, types]) => [key, Object.fromEntries(types)])), {
    C17: { Biosimilar: 2, Other: 1 },
    C05: { Biosimilar: 1 },
  });
});

// "Who is active where": holders (rows) x ATC groups or therapeutic area groups (columns).
test("key counts and the top keys: most first, ties by key", () => {
  const counts = keyCounts(products, (row) => row.branches.concat(row.branches));
  assert.deepEqual(Object.fromEntries(counts), { C17: 3, C05: 1 });
  assert.deepEqual(topKeys(new Map([["b", 2], ["a", 2], ["c", 5], ["d", 1]]), 3), ["c", "a", "b"]);
  assert.deepEqual(topKeys(counts), ["C17", "C05"]);
});

// Phase 4c: the holder rows sort by total, name or one column; the columns by code/name or count.
const activityRows = [
  { mah: "Pfizer Europe MA EEIG", count: 5, cells: new Map([["C17", 3], ["C05", 1]]) },
  { mah: "Accord Healthcare S.L.U.", count: 1, cells: new Map() },
  { mah: "Zentiva k.s.", count: 3, cells: new Map([["C05", 2]]) },
  { mah: "Amgen Europe B.V.", count: 3, cells: new Map([["C05", 2]]) },
];

test("holder rows sort by total (ties by name), by name, or by a column's count (ties by total, then name)", () => {
  const order = (sort) => sortActivityRows(activityRows, sort).map((row) => row.mah);
  assert.deepEqual(order("total"), ["Pfizer Europe MA EEIG", "Amgen Europe B.V.", "Zentiva k.s.", "Accord Healthcare S.L.U."]);
  assert.deepEqual(order("name"), ["Accord Healthcare S.L.U.", "Amgen Europe B.V.", "Pfizer Europe MA EEIG", "Zentiva k.s."]);
  assert.deepEqual(order("C05"), ["Amgen Europe B.V.", "Zentiva k.s.", "Pfizer Europe MA EEIG", "Accord Healthcare S.L.U."]);
  assert.deepEqual(order("C17"), ["Pfizer Europe MA EEIG", "Amgen Europe B.V.", "Zentiva k.s.", "Accord Healthcare S.L.U."]);
  // A copy: the rows keep their order.
  assert.equal(activityRows[0].mah, "Pfizer Europe MA EEIG");
});

// Phase 4f: every sort reverses on a second click; ties keep their order (total, then name).
test("holder rows sort in either direction: counts fewest first, names Z-A; ties by total, then name", () => {
  const order = (sort, direction) => sortActivityRows(activityRows, sort, direction).map((row) => row.mah);
  assert.deepEqual(order("total", "asc"), ["Accord Healthcare S.L.U.", "Amgen Europe B.V.", "Zentiva k.s.", "Pfizer Europe MA EEIG"]);
  assert.deepEqual(order("total", "desc"), order("total"));
  assert.deepEqual(order("name", "desc"), ["Zentiva k.s.", "Pfizer Europe MA EEIG", "Amgen Europe B.V.", "Accord Healthcare S.L.U."]);
  assert.deepEqual(order("name", "asc"), order("name"));
  assert.deepEqual(order("C05", "asc"), ["Accord Healthcare S.L.U.", "Pfizer Europe MA EEIG", "Amgen Europe B.V.", "Zentiva k.s."]);
  assert.deepEqual(order("C17", "asc"), ["Amgen Europe B.V.", "Zentiva k.s.", "Accord Healthcare S.L.U.", "Pfizer Europe MA EEIG"]);
});

test("sorts start most first (counts) or A-Z (names, codes); the sort in force reverses on a second click", () => {
  assert.equal(defaultSortDirection("total"), "desc");
  assert.equal(defaultSortDirection("count"), "desc");
  assert.equal(defaultSortDirection("C05"), "desc");
  assert.equal(defaultSortDirection("name"), "asc");
  assert.equal(defaultSortDirection("key"), "asc");
  assert.deepEqual(nextSort({ key: "total", direction: "desc" }, "total"), { key: "total", direction: "asc" });
  assert.deepEqual(nextSort({ key: "total", direction: "asc" }, "total"), { key: "total", direction: "desc" });
  assert.deepEqual(nextSort({ key: "total", direction: "asc" }, "name"), { key: "name", direction: "asc" });
  assert.deepEqual(nextSort({ key: "name", direction: "asc" }, "name"), { key: "name", direction: "desc" });
  assert.deepEqual(nextSort({ key: "name", direction: "desc" }, "C05"), { key: "C05", direction: "desc" });
  assert.deepEqual(nextSort({ key: "count", direction: "desc" }, "key"), { key: "key", direction: "asc" });
});

test("activity columns: ATC groups by code, areas by name, or most medicines first; Other stays last", () => {
  const counts = new Map([["L", 9], ["A", 3], ["C", 9], ["C04", 7], ["C14", 12], ["__other__", 30]]);
  const atc = [{ key: "L", label: "L Antineoplastic" }, { key: "A", label: "A Alimentary" }, { key: "C", label: "C Cardiovascular" }];
  assert.deepEqual(orderActivityColumns(atc, counts, "key", "atc").map((column) => column.key), ["A", "C", "L"]);
  assert.deepEqual(orderActivityColumns(atc, counts, "count", "atc").map((column) => column.key), ["C", "L", "A"]);
  const areas = [{ key: "C04", label: "Neoplasms" }, { key: "C14", label: "Cardiovascular Diseases" }, { key: "__other__", label: "Other", other: true }];
  assert.deepEqual(orderActivityColumns(areas, counts, "key", "area").map((column) => column.key), ["C14", "C04", "__other__"]);
  assert.deepEqual(orderActivityColumns(areas, counts, "count", "area").map((column) => column.key), ["C14", "C04", "__other__"]);
  // Phase 4f: reversed on a second click (ties by key, A-Z either way); Other stays last.
  assert.deepEqual(orderActivityColumns(atc, counts, "key", "atc", "desc").map((column) => column.key), ["L", "C", "A"]);
  assert.deepEqual(orderActivityColumns(atc, counts, "count", "atc", "asc").map((column) => column.key), ["A", "C", "L"]);
  assert.deepEqual(orderActivityColumns(areas, counts, "key", "area", "desc").map((column) => column.key), ["C04", "C14", "__other__"]);
  assert.deepEqual(orderActivityColumns(areas, counts, "count", "area", "asc").map((column) => column.key), ["C04", "C14", "__other__"]);
});

// Approvals per year, stacked by medicine type, ATC class or holder (the top n and Other).
const dated = [
  product("D1", { year: 2015, medicine_type: "Generic", atc: [{ atc_code_human: "L04AC05" }, { atc_code_human: "A10BJ06" }] }),
  product("D2", { year: 2015, medicine_type: "Other", atc: [{ atc_code_human: "L04AB02" }, { atc_code_human: "L01FA01" }] }),
  product("D3", { year: 2017, medicine_type: "Generic", mah: "Accord Healthcare S.L.U.", atc: [{ atc_code_human: "L04AC" }] }),
  product("D4", { year: 2017, mah: "Zentiva k.s.", atc: [] }),
  product("D5", { year: null, authorized_from: null, mah: "Zentiva k.s." }),
];
const stacked = (rows) => rows.map((row) => [row.year, row.total, Object.fromEntries(row.counts)]);

test("year stacks by medicine type: one row per year of the range (zeros included), each medicine once", () => {
  assert.deepEqual(stacked(yearStacks(dated, (row) => [row.medicine_type], [2014, 2017])), [
    ["2014", 0, {}],
    ["2015", 2, { Generic: 1, Other: 1 }],
    ["2016", 0, {}],
    ["2017", 2, { Generic: 1, Other: 1 }],
  ]);
  assert.deepEqual(stacked(yearStacks([], (row) => [row.medicine_type], [2016, 2017])), [["2016", 0, {}], ["2017", 0, {}]]);
});

test("year stacks by ATC class: a medicine counts once in each class it has, not at all without one", () => {
  assert.deepEqual(stacked(yearStacks(dated, (row) => atcClassesAt(row, null), [2015, 2017])), [
    ["2015", 2, { L: 2, A: 1 }],
    ["2016", 0, {}],
    ["2017", 1, { L: 1 }],
  ]);
  // One class selected: its child classes; a medicine coded only down to it has none.
  assert.deepEqual(stacked(yearStacks(dated, (row) => atcClassesAt(row, "L04"), [2015, 2017])), [
    ["2015", 2, { L04A: 2 }],
    ["2016", 0, {}],
    ["2017", 1, { L04A: 1 }],
  ]);
  assert.deepEqual(stacked(yearStacks(dated, (row) => atcClassesAt(row, "L04A"), [2015, 2017]))[0], ["2015", 2, { L04AC: 1, L04AB: 1 }]);
  assert.deepEqual(stacked(yearStacks(dated, (row) => atcClassesAt(row, "L04AC"), [2017, 2017])), [["2017", 0, {}]]);
});

test("year stacks by holder: the top n holders, the rest as Other on top", () => {
  const top = topWithOther(dated, (row) => [row.mah], 1);
  assert.deepEqual(top.keys, ["Pfizer Europe MA EEIG", OTHER_KEY]);
  assert.deepEqual(stacked(yearStacks(dated, top.keysOf, [2015, 2017])), [
    ["2015", 2, { "Pfizer Europe MA EEIG": 2 }],
    ["2016", 0, {}],
    ["2017", 2, { [OTHER_KEY]: 2 }],
  ]);
  // Every key within the top n: no Other.
  assert.deepEqual(topWithOther(dated, (row) => [row.mah], 8).keys, ["Pfizer Europe MA EEIG", "Zentiva k.s.", "Accord Healthcare S.L.U."]);
  assert.deepEqual(topWithOther([], (row) => [row.mah], 8).keys, []);
});

test("holder activity: the top holders by medicines, each with its medicines per key", () => {
  const rows = holderActivity(products, (row) => row.branches);
  assert.deepEqual(rows.map((row) => [row.mah, row.count, Object.fromEntries(row.cells)]), [
    ["Pfizer Europe MA EEIG", 5, { C17: 3, C05: 1 }],
    ["Accord Healthcare S.L.U.", 1, {}],
  ]);
  assert.deepEqual(holderActivity(products, (row) => row.branches, 1).map((row) => row.mah), ["Pfizer Europe MA EEIG"]);
  assert.deepEqual(holderActivity([], (row) => row.branches), []);
});
