import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  STATUS_ORDER,
  authorizedSeries,
  byStatusOrder,
  breakdownCounts,
  breakdownExcluded,
  buildProducts,
  buildSubstanceIndex,
  countTiles,
  distinctSorted,
  isAuthorizedNow,
  newestFirst,
  sortBreakdownRows,
  statusDate,
} from "./approvals.js";

const medicines = [
  { ema_product_number: "EMEA/H/C/000001", name_of_medicine: "Alpha", medicine_status: "Authorised", marketing_authorisation_date: "2018-03-01", medicine_type: "Other" },
  { ema_product_number: "EMEA/H/C/000002", name_of_medicine: "Beta", medicine_status: "Withdrawn", marketing_authorisation_date: "2020-07-15", medicine_type: "Biosimilar" },
  { ema_product_number: "EMEA/H/C/000003", name_of_medicine: "Gamma", medicine_status: "Authorised", marketing_authorisation_date: "2020-01-10", medicine_type: "Generic" },
  { ema_product_number: "EMEA/H/C/000004", name_of_medicine: "Delta", medicine_status: "Refused", marketing_authorisation_date: null, medicine_type: "Other" },
  { ema_product_number: "EMEA/H/C/000005", name_of_medicine: "Epsilon", medicine_status: "Authorised", marketing_authorisation_date: null, medicine_type: "Advanced therapy" },
];

const substanceRows = [
  { ema_product_number: "EMEA/H/C/000001", active_substance: "metformin" },
  { ema_product_number: "EMEA/H/C/000001", active_substance: "sitagliptin" },
  { ema_product_number: "EMEA/H/C/000002", active_substance: "adalimumab" },
];

const ids = (rows) => rows.map((row) => row.ema_product_number);

test("buildSubstanceIndex maps each product number to its substances", () => {
  const index = buildSubstanceIndex(substanceRows);
  assert.deepEqual(index.get("EMEA/H/C/000001"), ["metformin", "sitagliptin"]);
  assert.deepEqual(index.get("EMEA/H/C/000002"), ["adalimumab"]);
  assert.equal(index.get("EMEA/H/C/000003"), undefined);
});

test("newestFirst sorts by approval date descending, then by name", () => {
  const dated = medicines.filter((medicine) => medicine.marketing_authorisation_date !== null);
  const tie = { ...dated[1], ema_product_number: "EMEA/H/C/000009", name_of_medicine: "Aardvark" };
  assert.deepEqual(newestFirst([...dated, tie]).map((medicine) => medicine.name_of_medicine), ["Aardvark", "Beta", "Gamma", "Alpha"]);
  assert.deepEqual(ids(dated), ["EMEA/H/C/000001", "EMEA/H/C/000002", "EMEA/H/C/000003"]);
});

test("newestFirst puts medicines without an approval date last, by status (stack order) then name", () => {
  const opinion = { ...medicines[3], ema_product_number: "EMEA/H/C/000006", name_of_medicine: "Zeta", medicine_status: "Opinion" };
  const refused = { ...medicines[3], ema_product_number: "EMEA/H/C/000007", name_of_medicine: "Alpha 2" };
  assert.deepEqual(newestFirst([opinion, ...medicines, refused]).map((medicine) => medicine.name_of_medicine), [
    "Beta", "Gamma", "Alpha", "Epsilon", "Alpha 2", "Delta", "Zeta",
  ]);
});

test("statuses in stack order: Authorized, the ended ones, never-authorized, pending; unknown last, by name", () => {
  assert.deepEqual(STATUS_ORDER, [
    "Authorised", "Withdrawn", "Expired", "Lapsed", "Suspended", "Revoked",
    "Refused", "Application withdrawn", "Withdrawn from rolling review", "Opinion", "Opinion under re-examination",
  ]);
  assert.deepEqual(["Zzz new", "Opinion", "Aaa new", "Withdrawn", "Authorised"].sort(byStatusOrder), ["Authorised", "Withdrawn", "Opinion", "Aaa new", "Zzz new"]);
});

test("distinctSorted removes duplicates and sorts", () => {
  assert.deepEqual(distinctSorted(["Withdrawn", "Authorised", "Withdrawn"]), ["Authorised", "Withdrawn"]);
});

// Phase 1: products joined with lookups, tiles, breakdowns and the authorized series.
const medicine = (id, fields) => ({
  ema_product_number: id,
  medicine_status: "Authorised",
  marketing_authorisation_developer_applicant_holder: "Holder A",
  authorized_from: "2010-05-01",
  authorized_until: null,
  series_exclusion: null,
  substance_set_key: `key-${id}`,
  orphan_medicine: false,
  biosimilar: false,
  generic: false,
  advanced_therapy: false,
  ...fields,
});

test("buildProducts joins holder, year, MeSH terms, branches and ATC rows", () => {
  const [first, second] = buildProducts(
    [
      medicine("P1", { marketing_authorisation_developer_applicant_holder: null }),
      medicine("P2", { authorized_from: null }),
    ],
    {
      areaRows: [
        { ema_product_number: "P1", therapeutic_area_mesh: "Lymphoma" },
        { ema_product_number: "P1", therapeutic_area_mesh: "Leukemia" },
        { ema_product_number: "P1", therapeutic_area_mesh: "Unmatched term" },
      ],
      branchRows: [
        { therapeutic_area_mesh: "Leukemia", branch: "C04" },
        { therapeutic_area_mesh: "Leukemia", branch: "C15" },
        { therapeutic_area_mesh: "Lymphoma", branch: "C04" },
        { therapeutic_area_mesh: "Lymphoma", branch: "C15" },
        { therapeutic_area_mesh: "Lymphoma", branch: "C20" },
        { therapeutic_area_mesh: "Unmatched term", branch: null },
      ],
      atcRows: [{ ema_product_number: "P2", atc_code_human: "L01XE", atc_incomplete: true, source: "ema" }],
    },
  );
  assert.equal(first.mah, "Not stated");
  assert.equal(first.year, 2010);
  assert.deepEqual(first.areas, ["Lymphoma", "Leukemia", "Unmatched term"]);
  assert.deepEqual(first.branches, ["C04", "C15", "C20"]);
  assert.deepEqual(first.atc, []);
  assert.equal(second.mah, "Holder A");
  assert.equal(second.year, null);
  assert.deepEqual(second.atc.map((row) => row.atc_code_human), ["L01XE"]);
  assert.deepEqual([second.areas, second.branches], [[], []]);
  // Phase 4f: the therapeutic area tree keys (terms and every branch and node above them) and the
  // nodes a term is itself; no subtree rows here, so each term is matched at its branch roots: the
  // product is tagged only at those roots (phase 4g: the branches' static rows).
  assert.deepEqual([...first.areaKeys].sort(), ["C04", "C15", "C20", "Leukemia", "Lymphoma", "Unmatched term"]);
  assert.deepEqual([...first.areaExact].sort(), ["C04", "C15", "C20"]);
  assert.deepEqual([second.areaKeys, second.areaExact], [[], []]);
});

test("buildProducts: tree keys from the subtree rows, and the nodes a product's terms are", () => {
  const [product] = buildProducts([medicine("P1")], {
    areaRows: [{ ema_product_number: "P1", therapeutic_area_mesh: "Breast Neoplasms" }],
    branchRows: [{ therapeutic_area_mesh: "Breast Neoplasms", mesh_descriptor_name: "Breast Neoplasms", branch: "C04", branch_name: "Neoplasms" }],
    subtreeRows: [
      { therapeutic_area_mesh: "Breast Neoplasms", branch: "C04", node: "C04.588", level: 2, parent: "C04", node_name: "Neoplasms by Site" },
      { therapeutic_area_mesh: "Breast Neoplasms", branch: "C04", node: "C04.588.180", level: 3, parent: "C04.588", node_name: "Breast Neoplasms" },
    ],
    atcRows: [],
  });
  assert.deepEqual([...product.areaKeys].sort(), ["Breast Neoplasms", "C04", "C04.588", "C04.588.180"]);
  assert.deepEqual(product.areaExact, ["C04.588.180"]);
});

test("statusDate picks the EMA date of the event behind the current status", () => {
  const row = {
    marketing_authorisation_date: "2006-06-19",
    authorized_from: "2006-06-19",
    authorized_until: "2009-01-16",
    refusal_of_marketing_authorisation_date: "2004-09-07",
    withdrawal_of_application_date: "2006-01-19",
    opinion_adopted_date: "2026-09-17",
  };
  const dateFor = (medicine_status) => statusDate({ ...row, medicine_status });
  assert.equal(dateFor("Authorised"), "2006-06-19");
  assert.equal(dateFor("Withdrawn"), "2009-01-16");
  assert.equal(dateFor("Expired"), "2009-01-16");
  assert.equal(dateFor("Refused"), "2004-09-07");
  assert.equal(dateFor("Application withdrawn"), "2006-01-19");
  assert.equal(dateFor("Withdrawn from rolling review"), "2009-01-16");
  assert.equal(dateFor("Opinion"), "2026-09-17");
  assert.equal(statusDate({ medicine_status: "Suspended", authorized_until: null }), null);
});

test("isAuthorizedNow needs status Authorised and an approval date", () => {
  assert.equal(isAuthorizedNow(medicine("P1", {})), true);
  assert.equal(isAuthorizedNow(medicine("P2", { authorized_from: null })), false);
  assert.equal(isAuthorizedNow(medicine("P3", { medicine_status: "Withdrawn" })), false);
});

test("countTiles counts products, distinct substance sets and flags", () => {
  const tiles = countTiles([
    medicine("P1", { substance_set_key: "a|b", orphan_medicine: true }),
    medicine("P2", { substance_set_key: "a|b", biosimilar: true }),
    medicine("P3", { substance_set_key: null, generic: true }),
    medicine("P4", { substance_set_key: "c", advanced_therapy: true, orphan_medicine: true }),
  ]);
  assert.deepEqual(tiles, { products: 4, substances: 2, orphan: 2, biosimilar: 1, generic: 1, advancedTherapy: 1 });
});

test("authorizedSeries counts products whose interval covers each date", () => {
  const dates = ["2009-12-31", "2010-05-01", "2012-01-31", "2015-06-30", "2020-01-01"];
  const series = authorizedSeries([
    medicine("P1", { authorized_from: "2010-05-01", substance_set_key: "a" }),
    medicine("P2", { authorized_from: "2012-01-31", authorized_until: "2015-06-30", substance_set_key: "a" }),
    medicine("P3", { authorized_from: "2012-01-01", authorized_until: "2020-01-02", substance_set_key: null }),
    medicine("P4", { authorized_from: "2011-01-01", series_exclusion: "ended_without_end_date" }),
    medicine("P5", { authorized_from: null, series_exclusion: "no_approval_date" }),
    medicine("P6", { authorized_from: "2012-01-01", authorized_until: "2011-01-01", substance_set_key: "z" }),
  ], dates);
  assert.deepEqual(series, [
    { date: "2009-12-31", authorized_products: 0, authorized_substances: 0 },
    { date: "2010-05-01", authorized_products: 1, authorized_substances: 1 },
    { date: "2012-01-31", authorized_products: 3, authorized_substances: 1 },
    { date: "2015-06-30", authorized_products: 2, authorized_substances: 1 },
    { date: "2020-01-01", authorized_products: 2, authorized_substances: 1 },
  ]);
});

const dataDir = new URL("../public/data/", import.meta.url);
const seriesFile = new URL("ema_authorized_series.json", dataDir);
test(
  "the unfiltered browser series equals the pipeline's ema_authorized_series.json",
  { skip: existsSync(seriesFile) ? false : "site/public/data/ema_authorized_series.json not found: run the pipeline first" },
  () => {
    const expected = JSON.parse(readFileSync(seriesFile, "utf8"));
    const all = JSON.parse(readFileSync(new URL("ema_medicines.json", dataDir), "utf8"));
    assert.deepEqual(authorizedSeries(all, expected.map((row) => row.date)), expected);
  },
);

test("breakdownCounts counts a product once per distinct ATC level 1", () => {
  const products = [
    { atc: [{ atc_code_human: "L01XE" }, { atc_code_human: "L04AA" }] },
    { atc: [{ atc_code_human: "A10BA02" }, { atc_code_human: "L01FA01" }] },
    { atc: [] },
  ];
  const names = new Map([["L", "ANTINEOPLASTIC AND IMMUNOMODULATING AGENTS"], ["A", "ALIMENTARY TRACT AND METABOLISM"]]);
  assert.deepEqual(breakdownCounts(products, "atc", (key) => names.get(key)), [
    { key: "L", label: "ANTINEOPLASTIC AND IMMUNOMODULATING AGENTS", count: 2 },
    { key: "A", label: "ALIMENTARY TRACT AND METABOLISM", count: 1 },
  ]);
});

test("breakdownExcluded counts the products a breakdown cannot show", () => {
  const products = buildProducts(
    [medicine("P1", { marketing_authorisation_developer_applicant_holder: null }), medicine("P2", {}), medicine("P3", {})],
    {
      areaRows: [
        { ema_product_number: "P2", therapeutic_area_mesh: "Lymphoma" },
        { ema_product_number: "P3", therapeutic_area_mesh: "Unmatched term" },
      ],
      branchRows: [{ therapeutic_area_mesh: "Lymphoma", branch: "C04" }, { therapeutic_area_mesh: "Unmatched term", branch: null }],
      atcRows: [{ ema_product_number: "P3", atc_code_human: "L01XE", atc_incomplete: true, source: "ema" }],
    },
  );
  assert.equal(breakdownExcluded(products, "atc"), 2);
  assert.equal(breakdownExcluded(products, "area"), 2);
  // Phase 4c review: a product without an EMA code but with one from its product information
  // (atc_code_human null) is in its class; a row without any code does not break the count.
  const smpc = buildProducts([medicine("P4", {}), medicine("P5", {})], {
    areaRows: [],
    branchRows: [],
    atcRows: [
      { ema_product_number: "P4", atc_code_human: null, atc_code: "L04AG05", current_atc_code: null, source: "ema_smpc" },
      { ema_product_number: "P5", atc_code_human: null, source: "ema" },
    ],
  });
  assert.equal(breakdownExcluded(smpc, "atc"), 1);
  assert.deepEqual(breakdownCounts(smpc, "atc").map((row) => [row.key, row.count]), [["L", 1]]);
  // A missing holder is counted as "Not stated".
  assert.equal(breakdownExcluded(products, "mah"), 0);
});

test("breakdownCounts counts a product in every branch it touches", () => {
  const rows = breakdownCounts([{ branches: ["C04", "C15"] }, { branches: ["C04"] }], "area");
  assert.deepEqual(rows, [{ key: "C04", label: "C04", count: 2 }, { key: "C15", label: "C15", count: 1 }]);
});

test("breakdownCounts keeps the top n and folds distinct remaining products into Other", () => {
  const products = [
    ...["A", "A", "A", "B", "B", "C", "D"].map((mah) => ({ mah, branches: [mah] })),
    { mah: "E", branches: ["C", "D"] },
  ];
  assert.deepEqual(breakdownCounts(products, "mah", undefined, 2), [
    { key: "A", label: "A", count: 3 },
    { key: "B", label: "B", count: 2 },
    { key: null, label: "Other", count: 3, other: true },
  ]);
  // Ties sort by label; Other counts each product once even when it has two tail branches.
  assert.deepEqual(breakdownCounts(products, "area", undefined, 2).at(-1), { key: null, label: "Other", count: 3, other: true });
  assert.deepEqual(breakdownCounts(products, "area", undefined, 2).map((row) => row.key), ["A", "B", null]);
});

// Phase 4c: the breakdown's Sort control (UI state).
test("sortBreakdownRows: count keeps the rows; key sorts ATC classes by code, the others by name; Other and incomplete stay last", () => {
  const holders = [
    { key: "Zeta", label: "Zeta", count: 5 },
    { key: "alpha", label: "alpha", count: 3 },
    { key: "Beta", label: "Beta", count: 3 },
    { key: null, label: "Other", count: 9, other: true },
  ];
  assert.equal(sortBreakdownRows(holders, "count", "mah"), holders);
  assert.deepEqual(sortBreakdownRows(holders, "key", "mah").map((row) => row.label), ["alpha", "Beta", "Zeta", "Other"]);
  // Areas sort by their branch name, not by the branch code.
  const areas = [{ key: "C04", label: "Neoplasms", count: 9 }, { key: "C14", label: "Cardiovascular Diseases", count: 4 }];
  assert.deepEqual(sortBreakdownRows(areas, "key", "area").map((row) => row.key), ["C14", "C04"]);
  const atc = [
    { key: "L04AC", label: "Interleukin Inhibitors", count: 30 },
    { key: "L04AB", label: "TNF-Alpha Inhibitors", count: 20 },
    { key: "L04AA", label: "Selective Immunosuppressants", count: 40 },
    { key: "L04A", label: "code incomplete", count: 2, static: true, incomplete: true },
  ];
  assert.deepEqual(sortBreakdownRows(atc, "key", "atc").map((row) => row.key), ["L04AA", "L04AB", "L04AC", "L04A"]);
  // A copy: the input keeps its order.
  assert.equal(atc[0].key, "L04AC");
  // Phase 4f: a second click reverses the order: fewest first (ties keep their order), Z-A; Other
  // and the incomplete-code row still last.
  assert.deepEqual(sortBreakdownRows(atc, "count", "atc", "asc").map((row) => row.key), ["L04AB", "L04AC", "L04AA", "L04A"]);
  assert.deepEqual(sortBreakdownRows(holders, "count", "mah", "asc").map((row) => row.label), ["alpha", "Beta", "Zeta", "Other"]);
  assert.deepEqual(sortBreakdownRows(holders, "key", "mah", "desc").map((row) => row.label), ["Zeta", "Beta", "alpha", "Other"]);
  assert.deepEqual(sortBreakdownRows(atc, "key", "atc", "desc").map((row) => row.key), ["L04AC", "L04AB", "L04AA", "L04A"]);
  assert.equal(sortBreakdownRows(holders, "count", "mah", "desc"), holders);
});