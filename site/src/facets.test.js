import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STATE } from "./url.js";
import { makePredicates } from "./filters.js";
import {
  FACET_VALUES,
  TYPE_ORDER,
  facetCounts,
  facetPopulation,
  facetRows,
  sentenceParts,
  tokenLabel,
  topAreas,
  typeSplit,
  yearHistogram,
} from "./facets.js";

const product = (id, fields) => ({
  ema_product_number: id,
  mah: "Pfizer Europe MA EEIG",
  year: 2015,
  authorized_from: "2015-03-01",
  branches: [],
  areas: [],
  atc: [],
  medicine_type: "Other",
  medicine_status: "Authorised",
  ...fields,
});

const products = [
  product("P1", { medicine_type: "Biosimilar", branches: ["C17"], areas: ["Psoriasis"], year: 2020, authorized_from: "2020-01-01" }),
  product("P2", { medicine_type: "Biosimilar", branches: ["C17", "C05"], areas: ["Psoriasis", "Arthritis, Psoriatic"] }),
  product("P3", { medicine_type: "Generic", mah: "Accord Healthcare S.L.U.", areas: ["Psoriasis"] }),
  // Withdrawn: in the approvals view and in every Status count, not "Authorized now".
  product("P4", { medicine_status: "Withdrawn", branches: ["C17"], areas: ["Psoriasis"] }),
  // Authorised without an approval date: not authorized now, not dated.
  product("P5", { year: null, authorized_from: null, medicine_type: "Generic" }),
  // Refused: never dated.
  product("P6", { medicine_status: "Refused", year: null, authorized_from: null }),
];
const predicatesOf = (patch) => makePredicates({ ...structuredClone(DEFAULT_STATE), ...patch }, []);
const counted = (patch, dimension, view = "now") =>
  Object.fromEntries(facetCounts(products, predicatesOf(patch), dimension, FACET_VALUES[dimension], facetPopulation(view, dimension)));

test("Authorized now: facets count authorized-now products; Status counts every product", () => {
  const now = facetPopulation("now", "type");
  assert.deepEqual(products.filter(now).map((row) => row.ema_product_number), ["P1", "P2", "P3"]);
  for (const dimension of ["type", "mah", "branch", "area", "atc", "date"]) assert.equal(facetPopulation("now", dimension), now);
  assert.deepEqual(products.filter(facetPopulation("now", "status")).length, products.length);
});

test("Approvals per year: every facet, Status included, counts the products with an approval date", () => {
  for (const dimension of ["type", "mah", "branch", "area", "atc", "date", "status"]) {
    assert.deepEqual(products.filter(facetPopulation("years", dimension)).map((row) => row.ema_product_number), ["P1", "P2", "P3", "P4"]);
  }
});

test("a facet's counts ignore its own filter and apply every other one", () => {
  assert.deepEqual(counted({}, "type"), { Biosimilar: 2, Generic: 1 });
  // Selecting a type does not change the type counts...
  assert.deepEqual(counted({ type: ["Generic"] }, "type"), { Biosimilar: 2, Generic: 1 });
  // ...but narrows the others.
  assert.deepEqual(counted({ type: ["Biosimilar"] }, "mah"), { "Pfizer Europe MA EEIG": 2 });
  assert.deepEqual(counted({ mah: ["Accord Healthcare S.L.U."] }, "type"), { Generic: 1 });
});

test("a product counts once for each of its values", () => {
  assert.deepEqual(counted({}, "branch"), { C17: 2, C05: 1 });
  assert.deepEqual(counted({}, "area"), { Psoriasis: 3, "Arthritis, Psoriatic": 1 });
  assert.deepEqual(counted({}, "branch", "years"), { C17: 3, C05: 1 });
});

test("Status counts follow the other filters in both views", () => {
  assert.deepEqual(counted({}, "status"), { Authorised: 4, Withdrawn: 1, Refused: 1 });
  assert.deepEqual(counted({ type: ["Generic"] }, "status"), { Authorised: 2 });
  assert.deepEqual(counted({ status: ["Withdrawn"] }, "status", "years"), { Authorised: 3, Withdrawn: 1 });
});

test("approval years count per year and ignore the year filter itself", () => {
  assert.deepEqual(counted({ from: 2018 }, "date"), { 2015: 2, 2020: 1 });
  assert.deepEqual(counted({ from: 2018 }, "type"), { Biosimilar: 1 });
});

const histogram = (patch, view) => yearHistogram(products, predicatesOf(patch), view, [2014, 2021]);
const nonZero = (rows) => Object.fromEntries(rows.filter((row) => row.count > 0).map((row) => [row.year, row.count]));

test("year histogram: one row per year of the data range, zeros included", () => {
  const rows = histogram({}, "now");
  assert.deepEqual(rows.map((row) => row.year), [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021]);
  assert.deepEqual(rows[0], { year: 2014, count: 0 });
});

test("year histogram: Authorized now counts authorized-now products, as the sidebar's year bars did", () => {
  // P4 (withdrawn) and the undated P5 and P6 are left out.
  assert.deepEqual(nonZero(histogram({}, "now")), { 2015: 2, 2020: 1 });
});

test("year histogram: Approvals per year counts every product with an approval date", () => {
  assert.deepEqual(nonZero(histogram({}, "years")), { 2015: 3, 2020: 1 });
});

test("year histogram: ignores the year filter and applies every other one", () => {
  assert.deepEqual(nonZero(histogram({ from: 2018 }, "now")), { 2015: 2, 2020: 1 });
  assert.deepEqual(nonZero(histogram({ from: 2018, to: 2019, type: ["Biosimilar"] }, "now")), { 2015: 1, 2020: 1 });
  assert.deepEqual(nonZero(histogram({ status: ["Withdrawn"] }, "years")), { 2015: 1 });
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
  branchNames: new Map([["C17", "Skin and Connective Tissue Diseases"]]),
  atcNames: new Map([["L04AC", "Interleukin inhibitors"], ["L", "ANTINEOPLASTIC AND IMMUNOMODULATING AGENTS"]]),
};
const stateOf = (patch) => ({ ...structuredClone(DEFAULT_STATE), ...patch });

test("sentence tokens read as defaults without filters", () => {
  const label = (dimension) => tokenLabel(dimension, stateOf({}), lookups);
  assert.deepEqual(
    ["type", "atc", "mah", "branch", "area", "from", "to", "status"].map(label),
    ["all medicine types", "all ATC classes", "all holders", "all therapeutic area groups", "all therapeutic areas", "1995", "2026", "any status"],
  );
});

test("sentence tokens name one selection, or count several", () => {
  assert.equal(tokenLabel("type", stateOf({ type: ["Biosimilar"] }), lookups), "Biosimilar");
  assert.equal(tokenLabel("type", stateOf({ type: ["Biosimilar", "Generic"] }), lookups), "2 medicine types");
  assert.equal(tokenLabel("mah", stateOf({ mah: ["Novo Nordisk A/S"] }), lookups), "Novo Nordisk A/S");
  assert.equal(tokenLabel("mah", stateOf({ mah: ["A", "B", "C"] }), lookups), "3 holders");
  assert.equal(tokenLabel("branch", stateOf({ branch: ["C17"] }), lookups), "Skin and Connective Tissue Diseases");
  assert.equal(tokenLabel("branch", stateOf({ branch: ["C17", "C05"] }), lookups), "2 therapeutic area groups");
  assert.equal(tokenLabel("area", stateOf({ area: ["Psoriasis"] }), lookups), "Psoriasis");
  assert.equal(tokenLabel("area", stateOf({ area: ["Psoriasis", "Asthma"] }), lookups), "2 therapeutic areas");
  assert.equal(tokenLabel("status", stateOf({ status: ["Authorised"] }), lookups), "status Authorized");
  assert.equal(tokenLabel("status", stateOf({ status: ["Refused", "Withdrawn"] }), lookups), "2 statuses");
  assert.equal(tokenLabel("from", stateOf({ from: 2015 }), lookups), "2015");
  assert.equal(tokenLabel("to", stateOf({ to: 2020 }), lookups), "2020");
});

test("the ATC token names the class, or quotes a name filter", () => {
  assert.equal(tokenLabel("atc", stateOf({ atc: "L04AC" }), lookups), "L04AC Interleukin inhibitors");
  assert.equal(tokenLabel("atc", stateOf({ atc: "L" }), lookups), "L — Antineoplastic and Immunomodulating Agents");
  assert.equal(tokenLabel("atc", stateOf({ atc: "L04AL" }), lookups), "L04AL");
  assert.equal(tokenLabel("atc", stateOf({ atc: "insulin" }), lookups), "ATC classes matching “insulin”");
});

const text = (parts) => parts.map((part) => (typeof part === "string" ? part : `[${part.text}]`)).join("");

test("the filter sentence: one areas token until an area filter is set", () => {
  assert.equal(
    text(sentenceParts(stateOf({}), lookups)),
    "Showing [all medicine types] in [all ATC classes] from [all holders] in [all therapeutic areas], approved [1995]–[2026], with [any status].",
  );
  const [areas] = sentenceParts(stateOf({}), lookups).filter((part) => part.key === "areas");
  assert.deepEqual(areas, { key: "areas", text: "all therapeutic areas", active: false, clears: ["branch", "area"] });
});

test("the filter sentence: active tokens, each clearing its own filter", () => {
  const parts = sentenceParts(stateOf({ type: ["Biosimilar"], atc: "L04AC", branch: ["C17"], area: ["Psoriasis"], from: 2015, status: ["Authorised"] }), lookups);
  assert.equal(
    text(parts),
    "Showing [Biosimilar] in [L04AC Interleukin inhibitors] from [all holders] in [Skin and Connective Tissue Diseases] and [Psoriasis], approved [2015]–[2026], with [status Authorized].",
  );
  const tokens = parts.filter((part) => typeof part !== "string");
  assert.deepEqual(tokens.filter((part) => part.active).map((part) => [part.key, part.clears]), [
    ["type", ["type"]], ["atc", ["atc"]], ["branch", ["branch"]], ["area", ["area"]], ["from", ["from"]], ["status", ["status"]],
  ]);
  assert.deepEqual(tokens.filter((part) => !part.active).map((part) => part.key), ["mah", "to"]);
});

test("the most common conditions: areas by products, with the MeSH descriptor when known", () => {
  const descriptorOf = new Map([["Psoriasis", "D011565"]]);
  assert.deepEqual(topAreas(products.slice(0, 3), descriptorOf), [
    { term: "Psoriasis", count: 3, descriptorUi: "D011565" },
    { term: "Arthritis, Psoriatic", count: 1, descriptorUi: null },
  ]);
  assert.deepEqual(topAreas(products.slice(0, 3), descriptorOf, 1).map((row) => row.term), ["Psoriasis"]);
  assert.deepEqual(topAreas([], descriptorOf), []);
});

test("type split: products per key and medicine type, each product once per key", () => {
  const split = typeSplit(products.slice(0, 5), (row) => row.branches.concat(row.branches));
  assert.deepEqual(Object.fromEntries([...split].map(([key, types]) => [key, Object.fromEntries(types)])), {
    C17: { Biosimilar: 2, Other: 1 },
    C05: { Biosimilar: 1 },
  });
});
