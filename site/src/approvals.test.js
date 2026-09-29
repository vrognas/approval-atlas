import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  STATUS_ORDER,
  authorizedFirst,
  authorizedSeries,
  byStatusOrder,
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
import { NOT_CLASSIFIED, buildModalityTree } from "./modalities.js";

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
  // product is tagged only at those roots (phase 4g: the branches' static rows). The branches'
  // MeSH category too (owner decision 2026-09-29), once.
  assert.deepEqual([...first.areaKeys].sort(), ["C", "C04", "C15", "C20", "Leukemia", "Lymphoma", "Unmatched term"]);
  assert.deepEqual([...first.areaExact].sort(), ["C04", "C15", "C20"]);
  assert.deepEqual([second.areaKeys, second.areaExact], [[], []]);
  // Companies part 2: without company rows, no company or group; mah stays EMA's holder name.
  assert.deepEqual([second.company_key, second.group_key, second.holder_ema], [null, null, "Holder A"]);
});

test("buildProducts joins each medicine's company, group and how its holder was decided", () => {
  const [product, bare] = buildProducts([medicine("P1", { marketing_authorisation_developer_applicant_holder: "Mylan Pharmaceuticals Limited" }), medicine("P2")], {
    areaRows: [],
    branchRows: [],
    atcRows: [],
    companyRows: [{
      ema_product_number: "P1", holder_ema: "Mylan Pharmaceuticals Limited", holder_register: "Viatris Limited", holder_used: "Viatris Limited",
      holder_basis: "register", company_key: "c.viatris", group_key: "g.viatris", country: "IE", source: "curated",
    }],
  });
  assert.equal(product.mah, "Mylan Pharmaceuticals Limited");
  assert.deepEqual(
    [product.holder_ema, product.holder_register, product.holder_basis, product.company_key, product.group_key],
    ["Mylan Pharmaceuticals Limited", "Viatris Limited", "register", "c.viatris", "g.viatris"],
  );
  assert.deepEqual([bare.company_key, bare.group_key, bare.holder_basis, bare.holder_register], [null, null, null, null]);
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
  assert.deepEqual([...product.areaKeys].sort(), ["Breast Neoplasms", "C", "C04", "C04.588", "C04.588.180"]);
  assert.deepEqual(product.areaExact, ["C04.588.180"]);
});

// Modality (M2 phase 2): a product's modality rows (per substance, for its card), its keys (every
// group and modality: the filter, tree and charts) and its static rows' keys; none without the tree.
test("buildProducts: each medicine's modalities, their keys and static rows", () => {
  const modalityTree = buildModalityTree([
    { key: "small_molecule", kind: "group", group_key: null, order: 1 },
    { key: "protein", kind: "group", group_key: null, order: 2 },
    { key: "peptide", kind: "modality", group_key: "protein", order: 3 },
    { key: "hormone_cytokine", kind: "modality", group_key: "protein", order: 4 },
  ]);
  const modalityRows = [
    { ema_product_number: "P1", substance_key: "insulin degludec", modality_group: "protein", modality: "hormone_cytokine" },
    { ema_product_number: "P1", substance_key: "liraglutide", modality_group: "protein", modality: "peptide" },
    { ema_product_number: "P2", substance_key: "x", modality_group: "protein", modality: null },
  ];
  const [p1, p2, p3] = buildProducts([medicine("P1"), medicine("P2"), medicine("P3")], { areaRows: [], branchRows: [], atcRows: [], modalityRows, modalityTree });
  assert.deepEqual(p1.modalityRows, modalityRows.slice(0, 2));
  assert.deepEqual([...p1.modalityKeys].sort(), ["hormone_cytokine", "peptide", "protein"]);
  assert.deepEqual(p1.modalityExact, []);
  assert.deepEqual([p2.modalityKeys, p2.modalityExact], [["protein"], ["protein"]]);
  // No row: not classified.
  assert.deepEqual([p3.modalityRows, p3.modalityKeys, p3.modalityExact], [[], [], [NOT_CLASSIFIED]]);
  // Without the modality data (older data files): no keys at all.
  const [bare] = buildProducts([medicine("P1")], { areaRows: [], branchRows: [], atcRows: [] });
  assert.deepEqual([bare.modalityRows, bare.modalityKeys, bare.modalityExact], [[], [], []]);
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

test("authorizedFirst lists the currently authorized search-index rows, counted as the headline does", () => {
  // Epsilon is Authorised without an approval date: not currently authorized, so not listed.
  const { current, everyStatus, shown } = authorizedFirst(medicines, false);
  assert.equal(current, 2);
  assert.equal(everyStatus, false);
  assert.deepEqual(ids(shown), ["EMEA/H/C/000001", "EMEA/H/C/000003"]);
  assert.equal(shown.length, current);
});

test("authorizedFirst lists every status when asked or when none is currently authorized", () => {
  const all = authorizedFirst(medicines, true);
  assert.equal(all.current, 2);
  assert.equal(all.everyStatus, true);
  assert.deepEqual(ids(all.shown), ids(medicines));
  const undated = authorizedFirst(medicines.slice(3), false);
  assert.equal(undated.current, 0);
  assert.equal(undated.everyStatus, true);
  assert.deepEqual(ids(undated.shown), ["EMEA/H/C/000004", "EMEA/H/C/000005"]);
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
      companyRows: [
        { ema_product_number: "P2", holder_ema: "Holder A", company_key: "c.holder-a", group_key: "g.holder-a" },
        { ema_product_number: "P3", holder_ema: "Holder A", company_key: "c.holder-a", group_key: "g.holder-a" },
      ],
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
  // Companies part 2: the company breakdown shows company groups; a medicine without a holder has none.
  assert.equal(breakdownExcluded(products, "mah"), 1);
});

// Phase 4c: the breakdown's Sort control (UI state).
test("sortBreakdownRows: count keeps the rows; key sorts ATC classes by code, areas in tree order, holders by name; Other and incomplete stay last", () => {
  const holders = [
    { key: "Zeta", label: "Zeta", count: 5 },
    { key: "alpha", label: "alpha", count: 3 },
    { key: "Beta", label: "Beta", count: 3 },
    { key: null, label: "Other", count: 9, other: true },
  ];
  assert.equal(sortBreakdownRows(holders, "count", "mah"), holders);
  assert.deepEqual(sortBreakdownRows(holders, "key", "mah").map((row) => row.label), ["alpha", "Beta", "Zeta", "Other"]);
  // Areas in MeSH tree order (owner request 2026-09-28: their rank, areaBreakdownRows()), not by
  // name: Infections (C01), Neoplasms (C04), Cardiovascular Diseases (C14); the static row last.
  const areas = [
    { key: "C04", label: "Neoplasms", count: 9, rank: 1 },
    { key: "C14", label: "Cardiovascular Diseases", count: 4, rank: 2 },
    { key: "C01", label: "Infections", count: 2, rank: 0 },
    { key: "C04", label: "Tagged only as Neoplasms or Cancer", count: 1, static: true, incomplete: true },
  ];
  assert.deepEqual(sortBreakdownRows(areas, "key", "area").map((row) => row.label), ["Infections", "Neoplasms", "Cardiovascular Diseases", "Tagged only as Neoplasms or Cancer"]);
  assert.deepEqual(sortBreakdownRows(areas, "key", "area", "desc").map((row) => row.label), ["Cardiovascular Diseases", "Neoplasms", "Infections", "Tagged only as Neoplasms or Cancer"]);
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
  // Modality (M2 phase 2): groups and modalities in tree order, as the areas; Not classified last.
  const modalities = [
    { key: "antibody", label: "Antibody", count: 300, rank: 2 },
    { key: "small_molecule", label: "Small molecule", count: 1400, rank: 0 },
    { key: "protein", label: "Protein and peptide", count: 350, rank: 1 },
    { key: "__not_classified__", label: "Not classified", count: 40, static: true, incomplete: true },
  ];
  assert.deepEqual(sortBreakdownRows(modalities, "key", "mod").map((row) => row.key), ["small_molecule", "protein", "antibody", "__not_classified__"]);
});