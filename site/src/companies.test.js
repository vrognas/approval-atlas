import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  buildCompanies,
  companyBreakdownRows,
  companyPath,
  companyTreeChildren,
  companyTreeRows,
  companyTreeSearch,
  holderNames,
  matchesCompany,
  namesBehind,
  suggestCompanies,
  toggleCompany,
} from "./companies.js";
import { HOLDER_NAME_FIXES, holderName } from "./labels.js";

// Companies part 2 (user decisions 2026-09-28): group › company › EMA holder name, the medicine's
// EMA holder name always kept. Rows shaped as companies.json and ema_medicine_companies.json.
const company = (key, name, groupKey, fields = {}) => ({
  key, kind: "company", name, group_key: groupKey, monogram: null, joint_venture: false, partners: [], other_partners: [],
  representative: false, lei: null, gleif_legal_name: null, gleif_ultimate_parent: null, gleif_ultimate_parent_lei: null,
  member_holders: [name], original_holders: [], sources: ["ema"], as_of: "2026-09-27", ...fields,
});
const group = (key, name, monogram, fields = {}) => ({
  ...company(key, name, null), kind: "group", monogram, monogram_source: "curated", sources: ["ema", "curated"], as_of: "2026-09-28", ...fields,
});
const companyRows = [
  group("g.roche", "Roche", "RO", { member_holders: ["Roche Registration GmbH", "Roche Registration Ltd."] }),
  company("c.roche", "Roche Registration GmbH", "g.roche", { member_holders: ["Roche Registration GmbH", "Roche Registration Ltd."] }),
  // The Union Register moved one medicine EMA lists under Roche Registration Ltd. to Galenus.
  group("g.galenus", "Galenus Mannheim GmbH", "GAM", { monogram_source: "derived", sources: ["ema"], as_of: "2026-09-27" }),
  company("c.galenus", "Galenus Mannheim GmbH", "g.galenus", { original_holders: ["Roche Registration Ltd."] }),
  // Ownership notes (provenance; older data files have none): the holders of one note together.
  group("g.sanofi", "Sanofi", "SNY", {
    ownership: [
      { holder: "Genzyme Europe B.V.", note: "Genzyme acquired by Sanofi in 2011", evidence_url: "https://en.wikipedia.org/wiki/Genzyme" },
      { holder: "Genzyme Europe BV", note: "Genzyme acquired by Sanofi in 2011", evidence_url: "https://en.wikipedia.org/wiki/Genzyme" },
      { holder: "Sanofi Winthrop Industrie", note: "Sanofi's French operating company", evidence_url: "https://www.sanofi.com/" },
    ],
  }),
  company("c.sanofi", "Sanofi Winthrop Industrie", "g.sanofi"),
  company("c.genzyme", "Genzyme Europe B.V.", "g.sanofi", { member_holders: ["Genzyme Europe B.V.", "Genzyme Europe BV"] }),
  // Its one company has its name: the group row stands for it; the company has two holder names.
  group("g.krka", "Krka", "KRK"),
  company("c.krka", "Krka", "g.krka", { member_holders: ["Krka", "KRKA, d.d., Novo mesto"] }),
  // The same name at every level: one row.
  group("g.4sc", "4SC AG", "4SC", { monogram_source: "derived", sources: ["ema"], as_of: "2026-09-27" }),
  company("c.4sc", "4SC AG", "g.4sc"),
  // Another name, one holder name of its own: group › company.
  group("g.almirall", "Almirall", "ALM"),
  company("c.almirall", "Almirall, S.A.", "g.almirall"),
  group("g.pfizer", "Pfizer", "PFE"),
  group("g.bristol-myers-squibb", "Bristol Myers Squibb", "BMS"),
  group("g.bms-pfizer", "Bristol Myers Squibb and Pfizer (joint venture)", "BPF", { joint_venture: true, partners: ["g.bristol-myers-squibb", "g.pfizer"] }),
  company("c.bms-pfizer", "Bristol-Myers Squibb / Pfizer EEIG", "g.bms-pfizer"),
  // A company whose medicines are with two groups (a per-medicine owner): its row under each.
  group("g.msd", "MSD", "MSD"),
  group("g.organon", "Organon", "OGN"),
  company("c.msd", "Merck Sharp & Dohme B.V.", "g.msd", { member_holders: ["Merck Sharp & Dohme B.V.", "Merck Sharp & Dohme Ltd"] }),
  company("c.organon", "Organon N.V.", "g.organon"),
];
const medicine = (number, holder, companyKey, groupKey, fields = {}) => ({
  ema_product_number: number, holder_ema: holder, holder_register: null, holder_used: holder, holder_basis: "ema",
  company_key: companyKey, group_key: groupKey, country: null, source: "curated", ...fields,
});
const medicineRows = [
  medicine("M01", "Roche Registration GmbH", "c.roche", "g.roche"),
  medicine("M02", "Roche Registration GmbH", "c.roche", "g.roche"),
  medicine("M03", "Roche Registration Ltd.", "c.roche", "g.roche"),
  medicine("M04", "Roche Registration Ltd.", "c.galenus", "g.galenus", { holder_register: "Galenus Mannheim GmbH", holder_used: "Galenus Mannheim GmbH", holder_basis: "register", source: "holder_name" }),
  medicine("M05", "Sanofi Winthrop Industrie", "c.sanofi", "g.sanofi"),
  medicine("M06", "Genzyme Europe B.V.", "c.genzyme", "g.sanofi"),
  medicine("M07", "Genzyme Europe B.V.", "c.genzyme", "g.sanofi"),
  medicine("M08", "Genzyme Europe BV", "c.genzyme", "g.sanofi"),
  medicine("M09", "Krka", "c.krka", "g.krka"),
  medicine("M10", "KRKA, d.d., Novo mesto", "c.krka", "g.krka"),
  medicine("M11", "4SC AG", "c.4sc", "g.4sc"),
  medicine("M12", "Almirall, S.A.", "c.almirall", "g.almirall"),
  medicine("M13", "Bristol-Myers Squibb / Pfizer EEIG", "c.bms-pfizer", "g.bms-pfizer"),
  // No holder at all: no company or group.
  medicine("M14", null, null, null, { holder_used: null, holder_basis: null, source: null }),
  medicine("M15", "Merck Sharp & Dohme B.V.", "c.msd", "g.msd"),
  medicine("M16", "Merck Sharp & Dohme B.V.", "c.msd", "g.msd"),
  medicine("M17", "Merck Sharp & Dohme B.V.", "c.msd", "g.organon", {
    source: "curated_medicine", group_note: "MSD's women's health went to Organon in 2021", group_evidence_url: "https://www.sec.gov/organon-10k.htm",
  }),
  // EMA names no holder; the Union Register does.
  medicine("M18", null, "c.msd", "g.msd", { holder_register: "Merck Sharp & Dohme B.V.", holder_used: "Merck Sharp & Dohme B.V.", holder_basis: "register" }),
  medicine("M19", "Organon N.V.", "c.organon", "g.organon"),
  medicine("M20", "Merck Sharp & Dohme Ltd", "c.msd", "g.msd"),
];
const AUTHORIZED = new Set(["M01", "M02", "M05", "M06", "M09"]);
const companies = buildCompanies(companyRows, medicineRows, { isAuthorized: (number) => AUTHORIZED.has(number) });
// Products as buildProducts() makes them: mah is EMA's holder name ("Not stated" without one).
const products = medicineRows.map((row) => ({ ema_product_number: row.ema_product_number, mah: row.holder_ema ?? "Not stated", company_key: row.company_key, group_key: row.group_key }));

test("company tree: groups › companies › EMA holder names, a level left out where its one row repeats the name above", () => {
  assert.deepEqual(companies.rows(null).sort(), ["g.4sc", "g.almirall", "g.bms-pfizer", "g.galenus", "g.krka", "g.msd", "g.organon", "g.roche", "g.sanofi"]);
  assert.deepEqual(companies.rows("g.roche"), ["g.roche/c.roche"]);
  assert.deepEqual(companies.rows("g.roche/c.roche"), ["g.roche/c.roche/Roche Registration GmbH", "g.roche/c.roche/Roche Registration Ltd."]);
  assert.deepEqual(companies.rows("g.sanofi"), ["g.sanofi/c.sanofi", "g.sanofi/c.genzyme"]);
  // Sanofi Winthrop Industrie's one holder name is its own: no row below it.
  assert.deepEqual(companies.rows("g.sanofi/c.sanofi"), []);
  // Krka's one company is named Krka: its holder names sit under the group.
  assert.deepEqual(companies.rows("g.krka"), ["g.krka/c.krka/Krka", "g.krka/c.krka/KRKA, d.d., Novo mesto"]);
  assert.equal(companies.rowParent("g.krka/c.krka/Krka"), "g.krka");
  // 4SC AG › 4SC AG › 4SC AG: one row.
  assert.deepEqual(companies.rows("g.4sc"), []);
  assert.deepEqual(companies.rows("g.almirall"), ["g.almirall/c.almirall"]);
  assert.deepEqual(companies.rows("g.almirall/c.almirall"), []);
  // A holder name the Union Register split between companies shows under each.
  assert.deepEqual(companies.rowsShowing("Roche Registration Ltd."), ["g.roche/c.roche/Roche Registration Ltd.", "g.galenus/c.galenus/Roche Registration Ltd."]);
  assert.deepEqual(companies.rows("g.galenus"), ["g.galenus/c.galenus/Roche Registration Ltd."]);
  assert.equal(companies.rowShows("g.galenus/c.galenus/Roche Registration Ltd."), "Roche Registration Ltd.");
  // A holder name with a "/" keeps it.
  assert.deepEqual(companies.rows("g.bms-pfizer"), ["g.bms-pfizer/c.bms-pfizer"]);
  assert.equal(companies.rowValue("g.bms-pfizer/c.bms-pfizer"), "c.bms-pfizer");
  assert.deepEqual(companies.rowAncestors("g.roche/c.roche/Roche Registration Ltd."), ["g.roche", "g.roche/c.roche"]);
  // A company under two groups: a row under each. Medicines EMA names no holder for have no row
  // ("Not stated" is no holder name): they count at the company's row.
  assert.deepEqual(companies.rows("g.msd/c.msd"), ["g.msd/c.msd/Merck Sharp & Dohme B.V.", "g.msd/c.msd/Merck Sharp & Dohme Ltd"]);
  assert.deepEqual(companies.rows("g.organon"), ["g.organon/c.msd", "g.organon/c.organon"]);
  assert.deepEqual(companies.rows("g.organon/c.msd"), []);
  assert.deepEqual(companies.rowsShowing("Not stated"), []);
});

test("company tree: a row selects exactly its medicines: its value, or its path when the value shows elsewhere", () => {
  // Shown once: the value itself.
  assert.equal(companies.rowValue("g.roche"), "g.roche");
  assert.equal(companies.rowValue("g.roche/c.roche"), "c.roche");
  assert.equal(companies.rowValue("g.sanofi/c.genzyme/Genzyme Europe BV"), "Genzyme Europe BV");
  assert.equal(companies.rowValue("g.msd/c.msd/Merck Sharp & Dohme Ltd"), "Merck Sharp & Dohme Ltd");
  // Shown under two groups or companies: the row's path.
  assert.equal(companies.rowValue("g.organon/c.msd"), "g.organon/c.msd");
  assert.equal(companies.rowValue("g.msd/c.msd"), "g.msd/c.msd");
  assert.equal(companies.rowValue("g.galenus/c.galenus/Roche Registration Ltd."), "g.galenus/c.galenus/Roche Registration Ltd.");
  assert.equal(companies.rowValue("g.msd/c.msd/Merck Sharp & Dohme B.V."), "g.msd/c.msd/Merck Sharp & Dohme B.V.");
  // Every row's count is what its value filters.
  const counts = new Map();
  for (const product of products) for (const key of companies.countKeys(product)) counts.set(key, (counts.get(key) ?? 0) + 1);
  const rowKeys = (parent) => companies.rows(parent).flatMap((key) => [key, ...rowKeys(key)]);
  const wrong = rowKeys(null).filter((key) => products.filter((product) => matchesCompany(companies.rowValue(key), product)).length !== counts.get(key));
  assert.deepEqual(wrong, []);
  // The Organon row of Merck Sharp & Dohme B.V. selects its one medicine, not MSD's.
  const numbers = (value) => products.filter((product) => matchesCompany(value, product)).map((product) => product.ema_product_number);
  assert.deepEqual(numbers("g.organon/c.msd"), ["M17"]);
  assert.deepEqual(numbers("g.galenus/c.galenus/Roche Registration Ltd."), ["M04"]);
  assert.deepEqual(numbers("c.msd"), ["M15", "M16", "M17", "M18", "M20"]);
});

test("company paths: a row path as a filter value, a holder name keeping its slashes", () => {
  assert.deepEqual(companyPath("g.organon/c.msd"), { group: "g.organon", company: "c.msd", holder: null });
  assert.deepEqual(companyPath("g.bms-pfizer/c.bms-pfizer/Bristol-Myers Squibb / Pfizer EEIG"), { group: "g.bms-pfizer", company: "c.bms-pfizer", holder: "Bristol-Myers Squibb / Pfizer EEIG" });
  assert.equal(companyPath("g.roche"), null);
  assert.equal(companyPath("Bristol-Myers Squibb / Pfizer EEIG"), null);
  assert.equal(companies.name("g.organon/c.msd"), "Merck Sharp & Dohme B.V.");
  assert.equal(companies.label("g.organon/c.msd"), "Merck Sharp & Dohme B.V. (Organon)");
  assert.equal(companies.label("g.roche"), "Roche");
  // A company under two groups, selected whole (its rows' paths), is named as the company.
  assert.equal(companies.selectionName(["g.msd/c.msd", "g.organon/c.msd"]), "Merck Sharp & Dohme B.V.");
  assert.equal(companies.selectionName(["g.galenus/c.galenus/Roche Registration Ltd.", "g.roche/c.roche/Roche Registration Ltd."]), "Roche Registration Ltd. (EMA holder name)");
  assert.equal(companies.selectionName(["g.msd/c.msd", "g.roche"]), null);
  assert.equal(companies.selectionName(["g.roche", "g.sanofi"]), null);
  assert.equal(companies.kind("g.organon/c.msd"), "company");
  assert.equal(companies.kind("g.msd/c.msd/Merck Sharp & Dohme B.V."), "holder");
  assert.equal(companies.kind("g.roche/c.msd"), null);
  assert.deepEqual([...companies.groupsOf("g.organon/c.msd")], ["g.organon"]);
  // The company page a value opens.
  assert.equal(companies.pageOf("g.organon/c.msd"), "c.msd");
  assert.equal(companies.pageOf("g.roche"), "g.roche");
  assert.equal(companies.pageOf("c.genzyme"), "c.genzyme");
  assert.equal(companies.pageOf("Genzyme Europe BV"), null);
  assert.equal(companies.pageOf("g.msd/c.msd/Merck Sharp & Dohme B.V."), null);
  assert.ok(companies.values().includes("g.organon/c.msd"));
});

test("company tree: a product counts in its group, company and holder name rows as the tree shows them", () => {
  const keys = (number) => companies.countKeys({ ema_product_number: number });
  assert.deepEqual(keys("M03"), ["g.roche", "g.roche/c.roche", "g.roche/c.roche/Roche Registration Ltd."]);
  assert.deepEqual(keys("M04"), ["g.galenus", "g.galenus/c.galenus/Roche Registration Ltd."]);
  assert.deepEqual(keys("M05"), ["g.sanofi", "g.sanofi/c.sanofi"]);
  assert.deepEqual(keys("M10"), ["g.krka", "g.krka/c.krka/KRKA, d.d., Novo mesto"]);
  assert.deepEqual(keys("M11"), ["g.4sc"]);
  assert.deepEqual(keys("M14"), []);
  // EMA names no holder: the company's row, and its static row's count.
  assert.deepEqual(keys("M18"), ["g.msd", "g.msd/c.msd", companies.noHolderKey("g.msd/c.msd")]);
  assert.deepEqual(keys("M17"), ["g.organon", "g.organon/c.msd"]);
});

test("company tree rows: those with medicines plus the selection and the rows above it, most medicines first", () => {
  const counts = new Map([["g.sanofi", 4], ["g.sanofi/c.genzyme", 3], ["g.sanofi/c.sanofi", 1], ["g.roche", 0], ["g.krka", 2]]);
  const visible = companyTreeRows(companies, counts, ["Roche Registration GmbH"]);
  assert.deepEqual([...visible].sort(), ["g.krka", "g.roche", "g.roche/c.roche", "g.roche/c.roche/Roche Registration GmbH", "g.sanofi", "g.sanofi/c.genzyme", "g.sanofi/c.sanofi"]);
  assert.deepEqual(companyTreeChildren(companies, null, visible, counts), ["g.sanofi", "g.krka", "g.roche"]);
  assert.deepEqual(companyTreeChildren(companies, "g.sanofi", visible, counts), ["g.sanofi/c.genzyme", "g.sanofi/c.sanofi"]);
});

test("company selection: check states by row, a value checked wherever it shows", () => {
  const state = (key, selected) => companies.checkState(key, selected);
  assert.equal(state("g.roche", ["g.roche"]), "checked");
  assert.equal(state("g.roche/c.roche", ["g.roche"]), "included");
  assert.equal(state("g.roche/c.roche/Roche Registration Ltd.", ["g.roche"]), "included");
  assert.equal(companies.includedIn("g.roche/c.roche/Roche Registration Ltd.", ["c.roche"]), "c.roche");
  assert.equal(state("g.roche", ["Roche Registration GmbH"]), "mixed");
  assert.equal(state("g.roche/c.roche", ["Roche Registration GmbH"]), "mixed");
  // Galenus's row of the name is not under Roche, and selects only its own medicine.
  const galenus = "g.galenus/c.galenus/Roche Registration Ltd.";
  assert.equal(state(galenus, ["g.roche"]), "unchecked");
  assert.equal(state(galenus, [galenus]), "checked");
  assert.equal(state("g.roche/c.roche/Roche Registration Ltd.", [galenus]), "unchecked");
  assert.equal(state("g.roche", [galenus]), "unchecked");
  assert.equal(state("g.galenus", [galenus]), "mixed");
  // The name itself (older links, before it loads as its rows) covers both rows.
  assert.equal(state(galenus, ["Roche Registration Ltd."]), "checked");
  assert.equal(state("g.roche/c.roche/Roche Registration Ltd.", ["Roche Registration Ltd."]), "checked");
  // Organon's row of MSD's company: its own state, not MSD's.
  assert.equal(state("g.organon/c.msd", ["g.organon/c.msd"]), "checked");
  assert.equal(state("g.msd/c.msd", ["g.organon/c.msd"]), "unchecked");
  assert.equal(state("g.msd", ["g.organon/c.msd"]), "unchecked");
  assert.equal(state("g.organon", ["g.organon/c.msd"]), "mixed");
  assert.equal(state("g.msd/c.msd/Merck Sharp & Dohme Ltd", ["g.msd/c.msd"]), "included");
  assert.equal(companies.includedIn("g.msd/c.msd/Merck Sharp & Dohme Ltd", ["g.msd/c.msd"]), "g.msd/c.msd");
  assert.equal(state("g.sanofi", []), "unchecked");
});

test("company selection: values load as the row that shows them; one within another is dropped on a toggle", () => {
  // Folded levels: the row that stands for them.
  assert.deepEqual(companies.canonical("c.krka"), ["g.krka"]);
  assert.deepEqual(companies.canonical("c.4sc"), ["g.4sc"]);
  assert.deepEqual(companies.canonical("4SC AG"), ["g.4sc"]);
  assert.deepEqual(companies.canonical("Almirall, S.A."), ["c.almirall"]);
  assert.deepEqual(companies.canonical("Sanofi Winthrop Industrie"), ["c.sanofi"]);
  // Shown values stay themselves.
  assert.deepEqual(companies.canonical("Roche Registration GmbH"), ["Roche Registration GmbH"]);
  assert.deepEqual(companies.canonical("c.genzyme"), ["c.genzyme"]);
  // Within: all of a value's medicines are under it.
  assert.deepEqual([...companies.ancestors("Roche Registration GmbH")].sort(), ["c.roche", "g.roche"]);
  assert.deepEqual([...companies.ancestors("Roche Registration Ltd.")], []);
  assert.deepEqual([...companies.ancestors("c.genzyme")], ["g.sanofi"]);
  assert.deepEqual([...companies.ancestors("g.sanofi")], []);
  assert.deepEqual(toggleCompany(companies, ["Roche Registration GmbH", "c.genzyme"], "g.roche"), ["c.genzyme", "g.roche"]);
  // A value shown under several rows loads as each row's path; a row's path as itself.
  const galenus = "g.galenus/c.galenus/Roche Registration Ltd.";
  assert.deepEqual(companies.canonical("Roche Registration Ltd."), [galenus, "g.roche/c.roche/Roche Registration Ltd."]);
  assert.deepEqual(companies.canonical("c.msd"), ["g.msd/c.msd", "g.organon/c.msd"]);
  assert.deepEqual(companies.canonical("Merck Sharp & Dohme B.V."), ["g.msd/c.msd/Merck Sharp & Dohme B.V.", "g.organon/c.msd"]);
  assert.deepEqual(companies.canonical("g.organon/c.msd"), ["g.organon/c.msd"]);
  // A path to a folded level loads as the row that shows it; one the data lacks stays itself.
  assert.deepEqual(companies.canonical("g.krka/c.krka"), ["g.krka"]);
  assert.deepEqual(companies.canonical("g.roche/c.nobody"), ["g.roche/c.nobody"]);
  assert.deepEqual(companies.canonical("Not stated"), ["Not stated"]);
  assert.deepEqual([...companies.ancestors("g.organon/c.msd")], ["g.organon"]);
  assert.deepEqual([...companies.ancestors("g.msd/c.msd/Merck Sharp & Dohme B.V.")].sort(), ["g.msd", "g.msd/c.msd"]);
  assert.deepEqual([...companies.ancestors("c.msd")], []);
  assert.deepEqual(toggleCompany(companies, ["g.roche"], galenus), ["g.roche", galenus]);
  assert.deepEqual(toggleCompany(companies, ["g.roche", galenus], galenus), ["g.roche"]);
  assert.deepEqual(toggleCompany(companies, ["g.organon/c.msd"], "g.msd/c.msd"), ["g.organon/c.msd", "g.msd/c.msd"]);
  assert.deepEqual(toggleCompany(companies, ["g.organon/c.msd"], "g.organon"), ["g.organon"]);
  assert.deepEqual(toggleCompany(companies, ["g.sanofi"], "Genzyme Europe BV"), ["Genzyme Europe BV"]);
  assert.deepEqual(toggleCompany(companies, [], "c.krka"), ["g.krka"]);
  // The rows to open above a selected value.
  assert.deepEqual(companies.levelsAbove("Roche Registration Ltd."), ["g.roche", "g.roche/c.roche", "g.galenus"]);
  assert.deepEqual(companies.levelsAbove("g.roche"), []);
  assert.deepEqual(companies.levelsAbove("g.organon/c.msd"), ["g.organon"]);
});

test("company tree search: matching rows by name, spelling or monogram, their levels opened", () => {
  const visible = new Set([...companies.rows(null), ...companies.rows(null).flatMap((key) => companies.rows(key)), ...companies.rows("g.roche/c.roche"), ...companies.rows("g.sanofi/c.genzyme")]);
  assert.equal(companyTreeSearch(companies, visible, " "), null);
  const genzyme = companyTreeSearch(companies, visible, "genzyme");
  assert.deepEqual(genzyme.matches, ["g.sanofi/c.genzyme"]);
  assert.ok(genzyme.open.has("g.sanofi"));
  assert.equal(genzyme.shows(null, "g.sanofi"), true);
  assert.equal(genzyme.shows(null, "g.roche"), false);
  assert.equal(genzyme.shows("g.sanofi/c.genzyme", "g.sanofi/c.genzyme/Genzyme Europe BV"), true);
  // A group by its monogram (from its first letter); a spelling a row shows matches that row.
  assert.deepEqual(companyTreeSearch(companies, visible, "sny").matches, ["g.sanofi"]);
  assert.deepEqual(companyTreeSearch(companies, visible, "KRKA, d").matches, ["g.krka/c.krka/KRKA, d.d., Novo mesto"]);
  // Holder names: under each row that shows them and is not already shown by a match.
  const ltd = companyTreeSearch(companies, visible, "registration ltd");
  assert.deepEqual(ltd.matches.sort(), ["g.galenus/c.galenus/Roche Registration Ltd.", "g.roche/c.roche/Roche Registration Ltd."]);
  assert.equal(ltd.shows("g.roche/c.roche", "g.roche/c.roche/Roche Registration GmbH"), false);
  assert.ok(ltd.open.has("g.roche/c.roche"));
  // Short of 3 characters only a monogram matches.
  assert.deepEqual(companyTreeSearch(companies, visible, "ro").matches, ["g.roche"]);
});

test("company breakdown: the level below a value, most first, with the EMA holder names behind each bar", () => {
  const rows = (current, n) => companyBreakdownRows(companies, current, products, n).map((row) => [row.key, row.count, row.names]);
  // No "Not stated" among the names: EMA names no holder for one of MSD's medicines.
  assert.deepEqual(rows(null).slice(0, 3), [
    ["g.msd", 4, ["Merck Sharp & Dohme B.V.", "Merck Sharp & Dohme Ltd"]],
    ["g.sanofi", 4, ["Genzyme Europe B.V.", "Genzyme Europe BV", "Sanofi Winthrop Industrie"]],
    ["g.roche", 3, ["Roche Registration GmbH", "Roche Registration Ltd."]],
  ]);
  // A bar whose one holder name is its own name names none (it would repeat itself).
  assert.deepEqual(rows("g.sanofi"), [["c.genzyme", 3, ["Genzyme Europe B.V.", "Genzyme Europe BV"]], ["c.sanofi", 1, []]]);
  assert.deepEqual(rows("g.krka").map(([key]) => key), ["Krka", "KRKA, d.d., Novo mesto"]);
  assert.deepEqual(rows("c.roche").map(([key, count]) => [key, count]), [["Roche Registration GmbH", 2], ["g.roche/c.roche/Roche Registration Ltd.", 1]]);
  // A group's rows: a company under another group too by its path here, which opens only these.
  assert.deepEqual(rows("g.organon").map(([key, count]) => [key, count]), [["g.organon/c.msd", 1], ["c.organon", 1]]);
  // The medicines EMA names no holder for: a static row after the holder names.
  const msd = companyBreakdownRows(companies, "g.msd/c.msd", products);
  assert.deepEqual(msd.map((row) => [row.key, row.count, Boolean(row.static)]), [
    ["g.msd/c.msd/Merck Sharp & Dohme B.V.", 2, false], ["Merck Sharp & Dohme Ltd", 1, false], ["g.msd/c.msd", 1, true],
  ]);
  assert.equal(msd.at(-1).label, "No EMA holder name");
  // Leaves show alone.
  assert.deepEqual(rows("g.4sc"), []);
  assert.deepEqual(rows("c.almirall"), []);
  assert.deepEqual(rows("Roche Registration GmbH"), []);
  // The top n, then Other.
  const top = companyBreakdownRows(companies, null, products, 2);
  assert.deepEqual(top.map((row) => [row.key, row.count, Boolean(row.other)]), [["g.msd", 4, false], ["g.sanofi", 4, false], [null, 11, true]]);
  assert.deepEqual(companies.pathOf("Roche Registration GmbH"), ["g.roche", "c.roche", "Roche Registration GmbH"]);
  assert.deepEqual(companies.pathOf("KRKA, d.d., Novo mesto"), ["g.krka", "KRKA, d.d., Novo mesto"]);
  assert.equal(companies.parentOf("c.genzyme"), "g.sanofi");
  assert.equal(companies.parentOf("g.sanofi"), null);
  assert.deepEqual(companies.pathOf("g.organon/c.msd"), ["g.organon", "g.organon/c.msd"]);
  assert.equal(companies.parentOf("g.organon/c.msd"), "g.organon");
});

test("companies: a medicine's holder entry, a group's companies and holder names, joint ventures and as-of", () => {
  // Without provenance fields (older data files): null; not moved by a per-medicine row.
  const none = { moved: false, groupNote: null, groupEvidenceUrl: null, sponsorNote: null, sponsorEvidenceUrl: null, sponsorRenameEvidenceUrl: null };
  assert.deepEqual(companies.entry("M04"), {
    holder: "Roche Registration Ltd.", register: "Galenus Mannheim GmbH", basis: "register",
    company: companyRows.find((row) => row.key === "c.galenus"), group: companyRows.find((row) => row.key === "g.galenus"), ...none,
  });
  assert.deepEqual(companies.entry("M14"), { holder: null, register: null, basis: null, company: null, group: null, ...none });
  assert.equal(companies.entry("M18").holder, null);
  assert.equal(companies.entry("M18").register, "Merck Sharp & Dohme B.V.");
  assert.equal(companies.entry("M99"), null);
  assert.deepEqual(companies.structure("g.sanofi"), [
    {
      key: "c.genzyme", count: 3, values: ["c.genzyme"], unnamed: 0,
      holders: [{ name: "Genzyme Europe B.V.", count: 2, values: ["Genzyme Europe B.V."] }, { name: "Genzyme Europe BV", count: 1, values: ["Genzyme Europe BV"] }],
    },
    { key: "c.sanofi", count: 1, values: ["c.sanofi"], unnamed: 0, holders: [{ name: "Sanofi Winthrop Industrie", count: 1, values: ["c.sanofi"] }] },
  ]);
  // Each name opens exactly the medicines it counts: on a group's page, its own rows' values.
  assert.deepEqual(companies.structure("g.organon"), [
    { key: "c.msd", count: 1, values: ["g.organon/c.msd"], unnamed: 0, holders: [{ name: "Merck Sharp & Dohme B.V.", count: 1, values: ["g.organon/c.msd"] }] },
    { key: "c.organon", count: 1, values: ["c.organon"], unnamed: 0, holders: [{ name: "Organon N.V.", count: 1, values: ["c.organon"] }] },
  ]);
  // A company's page: every group's rows; its count includes the medicine EMA names no holder for.
  assert.deepEqual(companies.structure("c.msd"), [{
    key: "c.msd", count: 5, values: ["g.msd/c.msd", "g.organon/c.msd"], unnamed: 1,
    holders: [
      { name: "Merck Sharp & Dohme B.V.", count: 3, values: ["g.msd/c.msd/Merck Sharp & Dohme B.V.", "g.organon/c.msd"] },
      { name: "Merck Sharp & Dohme Ltd", count: 1, values: ["Merck Sharp & Dohme Ltd"] },
    ],
  }]);
  assert.deepEqual(companies.numbersOf("Roche Registration Ltd."), ["M03", "M04"]);
  assert.deepEqual(companies.numbersOf("g.roche"), ["M01", "M02", "M03"]);
  assert.deepEqual(companies.jointVentures("g.pfizer"), ["g.bms-pfizer"]);
  assert.deepEqual([...companies.groupsOf("Roche Registration Ltd.")].sort(), ["g.galenus", "g.roche"]);
  assert.equal(companies.kind("g.roche"), "group");
  assert.equal(companies.kind("Genzyme Europe BV"), "holder");
  assert.equal(companies.kind("Nobody"), null);
  assert.equal(companies.name("c.genzyme"), "Genzyme Europe B.V.");
  // The latest curation date of the curated groups.
  assert.equal(companies.asOf, "2026-09-28");
  assert.deepEqual(holderNames(products.slice(4, 8)), ["Genzyme Europe B.V.", "Genzyme Europe BV", "Sanofi Winthrop Industrie"]);
  // "Not stated" (EMA names no holder) is no holder name.
  assert.deepEqual(holderNames(products.slice(12, 14)), ["Bristol-Myers Squibb / Pfizer EEIG"]);
});

test("company suggestions: name, monogram, then the names that lead to a group, with authorized counts", () => {
  const found = (query) => suggestCompanies(companies, query).map((row) => [row.key, row.synonym, row.authorized]);
  // Galenus holds a medicine EMA lists under Roche Registration Ltd.
  assert.deepEqual(found("roche"), [["g.roche", null, 2], ["g.galenus", "Roche Registration Ltd.", 0]]);
  assert.deepEqual(found("SNY"), [["g.sanofi", null, 2]]);
  assert.deepEqual(found("genzyme"), [["g.sanofi", "Genzyme Europe B.V.", 2]]);
  assert.deepEqual(found("roche registration ltd"), [["g.roche", "Roche Registration Ltd.", 2], ["g.galenus", "Roche Registration Ltd.", 0]]);
  assert.deepEqual(found("r"), []);
  assert.deepEqual(suggestCompanies(companies, "krka")[0], { key: "g.krka", name: "Krka", monogram: "KRK", synonym: null, named: true, weak: false, count: 2, authorized: 1 });
  // named: the query is the group's name, monogram or another name exactly (Enter opens it).
  const named = (query) => suggestCompanies(companies, query).map((row) => [row.key, row.named]);
  assert.deepEqual(named("sny"), [["g.sanofi", true]]);
  assert.deepEqual(named("genzyme europe bv"), [["g.sanofi", true]]);
  assert.deepEqual(named("genzyme"), [["g.sanofi", false]]);
  assert.deepEqual(named("sano"), [["g.sanofi", false]]);
});

// Step 2 (#4): derived monograms (initials, e.g. "ALL", "CAR", "TB") read as clinical abbreviations
// and opened companies on Enter. Only a curated monogram names its group; a derived one still
// finds it, last and weak (Enter never opens it as the only suggestion). Rows without
// monogram_source (older data files) count as derived.
test("company suggestions: only a curated monogram names its group; a derived one is a weak match", () => {
  const rows = (query) => suggestCompanies(companies, query).map((row) => [row.key, row.named, row.weak]);
  assert.deepEqual(rows("sny"), [["g.sanofi", true, false]]);
  assert.deepEqual(rows("gam"), [["g.galenus", false, true]]);
  assert.deepEqual(rows("4sc"), [["g.4sc", false, false]]); // its name's start ("4SC AG"), not its monogram
  const older = buildCompanies(companyRows.map(({ monogram_source: _source, ...row }) => row), medicineRows, { isAuthorized: () => false });
  assert.deepEqual(suggestCompanies(older, "sny").map((row) => [row.key, row.named, row.weak]), [["g.sanofi", false, true]]);
});

test("companies provenance: why a medicine sits under its group, a sponsor's evidence, a group's ownership notes", () => {
  assert.deepEqual(companies.entry("M17"), {
    ...companies.entry("M17"),
    moved: true, groupNote: "MSD's women's health went to Organon in 2021", groupEvidenceUrl: "https://www.sec.gov/organon-10k.htm", sponsorNote: null, sponsorEvidenceUrl: null,
    sponsorRenameEvidenceUrl: null,
  });
  // A plain note (curated_medicine_notes()): about its later ownership, the medicine not moved.
  const noted = buildCompanies([group("g.coherus", "Coherus BioSciences", "CHRS"), company("c.coherus", "Coherus BioSciences", "g.coherus")], [
    medicine("M40", "ERA Consulting GmbH", "c.coherus", "g.coherus", {
      holder_basis: "curated_sponsor", source: "holder_name", group_note: "Coherus sold its U.S. rights in 2025", group_evidence_url: "https://www.globenewswire.com/x.html",
    }),
  ]);
  assert.equal(noted.entry("M40").moved, false);
  assert.equal(noted.entry("M40").groupNote, "Coherus sold its U.S. rights in 2025");
  assert.equal(noted.entry("M40").groupEvidenceUrl, "https://www.globenewswire.com/x.html");
  const sponsored = buildCompanies([group("g.otsuka", "Otsuka", "OTS"), company("c.avanir", "Avanir Pharmaceuticals", "g.otsuka")], [
    medicine("M30", "Jenson Pharmaceutical Services Limited", "c.avanir", "g.otsuka", {
      holder_basis: "curated_sponsor", sponsor_note: "Avanir's medicine, held by Jenson", sponsor_evidence_url: "https://www.ema.europa.eu/nuedexta.pdf",
    }),
  ]);
  assert.equal(sponsored.entry("M30").sponsorNote, "Avanir's medicine, held by Jenson");
  assert.equal(sponsored.entry("M30").sponsorEvidenceUrl, "https://www.ema.europa.eu/nuedexta.pdf");
  assert.equal(sponsored.entry("M30").sponsorRenameEvidenceUrl, null);
  // A sponsor renamed since (its note names it as it was then): the rename's evidence too.
  const renamed = buildCompanies([group("g.talphera", "Talphera", "TAL"), company("c.talphera", "Talphera", "g.talphera")], [
    medicine("M31", "FGK Representative Service GmbH", "c.talphera", "g.talphera", {
      holder_basis: "curated_sponsor", sponsor_note: "Returned to AcelRx (renamed Talphera in 2024)", sponsor_evidence_url: "https://www.sec.gov/acrx-10q.htm",
      sponsor_rename_evidence_url: "https://www.prnewswire.com/talphera.html",
    }),
  ]);
  assert.equal(renamed.entry("M31").sponsorEvidenceUrl, "https://www.sec.gov/acrx-10q.htm");
  assert.equal(renamed.entry("M31").sponsorRenameEvidenceUrl, "https://www.prnewswire.com/talphera.html");
  // A group's notes, the holders of one note together, in the data's order.
  const genzyme = { holders: ["Genzyme Europe B.V.", "Genzyme Europe BV"], note: "Genzyme acquired by Sanofi in 2011", url: "https://en.wikipedia.org/wiki/Genzyme" };
  assert.deepEqual(companies.ownership("g.sanofi"), [genzyme, { holders: ["Sanofi Winthrop Industrie"], note: "Sanofi's French operating company", url: "https://www.sanofi.com/" }]);
  // A company's page: its groups' notes on its own names.
  assert.deepEqual(companies.ownership("c.genzyme"), [genzyme]);
  // None: a group without notes (older data files: no ownership field), an unknown key.
  assert.deepEqual(companies.ownership("g.roche"), []);
  assert.deepEqual(companies.ownership("c.roche"), []);
  assert.deepEqual(companies.ownership("g.nobody"), []);
});

test("companies: an old name in a group's ownership notes (a renamed sponsor) finds it and shows on its pages", () => {
  const acelrxNote = { holder: "AcelRx Pharmaceuticals", note: "Renamed Talphera in January 2024", evidence_url: "https://www.prnewswire.com/x.html" };
  const avanirNote = { holder: "Avanir Pharmaceuticals", note: "Avanir acquired by Otsuka in 2015", evidence_url: "https://www.sec.gov/x.htm" };
  const oldNote = { holder: "Otsuka Old Name Ltd", note: "Renamed in 2010", evidence_url: "https://www.prnewswire.com/y.html" };
  // No holder name of their medicines is the old one: the sponsors' medicines are held by representatives.
  const renamed = buildCompanies([
    group("g.talphera", "Talphera", "TAL", { member_holders: [], ownership: [acelrxNote] }),
    company("c.talphera", "Talphera", "g.talphera", { member_holders: [], original_holders: ["FGK Representative Service GmbH"] }),
    group("g.otsuka", "Otsuka", "OTS", { ownership: [avanirNote, oldNote] }),
    company("c.otsuka", "Otsuka Pharmaceutical Netherlands B.V.", "g.otsuka"),
    company("c.avanir", "Avanir Pharmaceuticals", "g.otsuka", { member_holders: [] }),
  ], [
    medicine("T1", "FGK Representative Service GmbH", "c.talphera", "g.talphera", { holder_basis: "curated_sponsor", source: "holder_name" }),
    medicine("T2", "Otsuka Pharmaceutical Netherlands B.V.", "c.otsuka", "g.otsuka"),
    medicine("T3", "Jenson Pharmaceutical Services Limited", "c.avanir", "g.otsuka", { holder_basis: "curated_sponsor" }),
  ], { isAuthorized: () => true });
  // Suggestions: the old name leads to its group (Enter opens it when typed in full).
  const found = (query) => suggestCompanies(renamed, query).map((row) => [row.key, row.synonym, row.named]);
  assert.deepEqual(found("acelrx"), [["g.talphera", "AcelRx Pharmaceuticals", false]]);
  assert.deepEqual(found("AcelRx Pharmaceuticals"), [["g.talphera", "AcelRx Pharmaceuticals", true]]);
  assert.deepEqual(found("otsuka old"), [["g.otsuka", "Otsuka Old Name Ltd", false]]);
  // The tree: the row it belongs to (Talphera's group row stands for its one company); an old name
  // of a group of several companies, no row's, the group; a name a row shows stays that row's.
  const visible = new Set(["g.talphera", "g.otsuka", "g.otsuka/c.otsuka", "g.otsuka/c.avanir"]);
  assert.deepEqual(companyTreeSearch(renamed, visible, "acelrx").matches, ["g.talphera"]);
  assert.deepEqual(companyTreeSearch(renamed, visible, "otsuka old").matches, ["g.otsuka"]);
  assert.deepEqual(companyTreeSearch(renamed, visible, "avanir").matches, ["g.otsuka/c.avanir"]);
  // Pages: a company shows its groups' notes on its names, and every note of a group it alone makes up.
  const acelrx = { holders: ["AcelRx Pharmaceuticals"], note: "Renamed Talphera in January 2024", url: "https://www.prnewswire.com/x.html" };
  assert.deepEqual(renamed.ownership("g.talphera"), [acelrx]);
  assert.deepEqual(renamed.ownership("c.talphera"), [acelrx]);
  assert.deepEqual(renamed.ownership("c.avanir"), [{ holders: ["Avanir Pharmaceuticals"], note: "Avanir acquired by Otsuka in 2015", url: "https://www.sec.gov/x.htm" }]);
  assert.deepEqual(renamed.ownership("c.otsuka"), []);
});

test("companies: a company all of whose medicines a per-medicine row put under another owner", () => {
  const moved = (fields = {}) => ({ source: "curated_medicine", group_note: "Guerbet bought the business in 2015", group_evidence_url: "https://www.sec.gov/x.htm", ...fields });
  const optimark = buildCompanies([group("g.guerbet", "Guerbet", "GBT"), company("c.mallinckrodt", "Mallinckrodt Deutschland GmbH", "g.guerbet")], [
    medicine("M50", "Mallinckrodt Deutschland GmbH", "c.mallinckrodt", "g.guerbet", moved()),
  ]);
  assert.equal(optimark.allMoved("c.mallinckrodt"), true);
  // Some stay (MSD's with MSD), a group, an unknown key: no.
  assert.equal(companies.allMoved("c.msd"), false);
  assert.equal(companies.allMoved("c.roche"), false);
  assert.equal(optimark.allMoved("g.guerbet"), false);
  assert.equal(optimark.allMoved("c.nobody"), false);
});

test("company tree: a row repeating the name of the row above it (shown as the same name)", () => {
  assert.equal(companies.repeatsParent("g.roche/c.roche/Roche Registration GmbH"), true);
  assert.equal(companies.repeatsParent("g.roche/c.roche/Roche Registration Ltd."), false);
  // Krka's one company is folded into the group: its holder name "Krka" repeats the group's.
  assert.equal(companies.repeatsParent("g.krka/c.krka/Krka"), true);
  assert.equal(companies.repeatsParent("g.roche/c.roche"), false);
  assert.equal(companies.repeatsParent("g.roche"), false);
  assert.equal(companies.repeatsParent("g.nobody"), false);
});

test("company tree search: names match by word start, as the Companies suggestions", () => {
  const rocheAndNeurochem = buildCompanies([
    group("g.roche", "Roche", "RO"), company("c.roche", "Roche Registration GmbH", "g.roche"),
    group("g.neurochem", "Neurochem Luxco II SARL", "NL"), company("c.neurochem", "Neurochem Luxco II SARL", "g.neurochem"),
  ], [medicine("N1", "Roche Registration GmbH", "c.roche", "g.roche"), medicine("N2", "Neurochem Luxco II SARL", "c.neurochem", "g.neurochem")]);
  const visible = new Set(["g.roche", "g.roche/c.roche", "g.neurochem"]);
  assert.deepEqual(companyTreeSearch(rocheAndNeurochem, visible, "roche").matches, ["g.roche"]);
  assert.deepEqual(companyTreeSearch(rocheAndNeurochem, visible, "neuro").matches, ["g.neurochem"]);
  assert.deepEqual(companyTreeSearch(rocheAndNeurochem, visible, "luxco ii").matches, ["g.neurochem"]);
  assert.deepEqual(companyTreeSearch(rocheAndNeurochem, visible, "registration").matches, ["g.roche/c.roche"]);
  assert.deepEqual(companyTreeSearch(rocheAndNeurochem, visible, "chem").matches, []);
});

test("company breakdown and aggregated views: no holder names that only repeat the row's own name", () => {
  const byKey = new Map(companyBreakdownRows(companies, "c.roche", products).map((row) => [row.key, row.names]));
  assert.deepEqual(byKey.get("Roche Registration GmbH"), []);
  assert.deepEqual(namesBehind("4SC AG", products.filter((product) => product.group_key === "g.4sc")), []);
  assert.deepEqual(namesBehind("Roche", products.filter((product) => product.group_key === "g.roche")), ["Roche Registration GmbH", "Roche Registration Ltd."]);
  // Its own name among others stays (the labels list the others after "also": UI.companies.legalNames()).
  assert.deepEqual(namesBehind("Roche Registration GmbH", products.filter((product) => product.group_key === "g.roche")), ["Roche Registration GmbH", "Roche Registration Ltd."]);
});

test("company filter labels: an EMA holder name is named as one (the sentence's pill)", () => {
  assert.equal(companies.label("Roche Registration GmbH"), "Roche Registration GmbH (EMA holder name)");
  assert.equal(companies.label("c.roche"), "Roche Registration GmbH");
  assert.equal(companies.label("g.galenus/c.galenus/Roche Registration Ltd."), "Roche Registration Ltd. (EMA holder name, Galenus Mannheim GmbH)");
  assert.equal(companies.label("Not stated"), "Not stated");
  assert.equal(companies.selectionName(["g.galenus/c.galenus/Roche Registration Ltd.", "g.roche/c.roche/Roche Registration Ltd."]), "Roche Registration Ltd. (EMA holder name)");
});

// Design sweep 2026-10-01 (C8): EMA's file spells Primavax's holder "Pasteur Mà¨rieux MSD", which the
// search showed as "matches “Pasteur Mà¨rieux MSD”". Shown as the company spelled it everywhere a
// holder name reaches (labels.js holderName()); the rows given stay as they were.
test("a holder name with a broken encoding in EMA's file shows as the company spelled it", () => {
  const [bad, good] = [...HOLDER_NAME_FIXES][0];
  assert.equal(holderName(bad), good);
  assert.equal(holderName("Roche Registration GmbH"), "Roche Registration GmbH");
  assert.equal(holderName(null), null);
  const rows = [
    group("g.spmsd", "Sanofi Pasteur MSD, SNC", "SPM", { monogram_source: "derived", member_holders: [bad], ownership: [{ holder: bad, note: "A note", evidence_url: "https://example.org/" }] }),
    company("c.spmsd", "Sanofi Pasteur MSD, SNC", "g.spmsd", { member_holders: [bad, "Sanofi Pasteur MSD, SNC"] }),
  ];
  const fixed = buildCompanies(rows, [medicine("P1", bad, "c.spmsd", "g.spmsd")]);
  assert.equal(fixed.entry("P1").holder, good);
  assert.ok(fixed.values().includes(good));
  assert.ok(!fixed.values().includes(bad));
  assert.deepEqual(fixed.row("c.spmsd").member_holders, [good, "Sanofi Pasteur MSD, SNC"]);
  assert.deepEqual(fixed.ownership("g.spmsd").flatMap((item) => item.holders), [good]);
  assert.doesNotMatch(JSON.stringify(suggestCompanies(fixed, "pasteur")), /Mà¨rieux/);
  assert.equal(rows[1].member_holders[0], bad);
});

// The data files as the pipeline writes them (skipped before a run): every medicine with a group is
// in the tree, each value selected loads as a row that shows it, and no row count exceeds its parent's.
const dataDir = new URL("../public/data/", import.meta.url);
const files = ["companies.json", "ema_medicine_companies.json"].map((file) => new URL(file, dataDir));
test(
  "the company tree holds every medicine of the data files, each value selectable as a row",
  { skip: files.every((file) => existsSync(file)) ? false : "companies data not found: run the pipeline first" },
  () => {
    const [rows, medicines] = files.map((file) => JSON.parse(readFileSync(file, "utf8")));
    const real = buildCompanies(rows, medicines);
    const counts = new Map();
    for (const row of medicines) for (const key of real.countKeys(row)) counts.set(key, (counts.get(key) ?? 0) + 1);
    const withGroup = medicines.filter((row) => row.group_key);
    assert.equal(real.rows(null).reduce((sum, key) => sum + counts.get(key), 0), withGroup.length);
    const overfull = [...counts].filter(([key]) => real.rowParent(key) !== null && counts.get(key) > counts.get(real.rowParent(key)));
    assert.deepEqual(overfull, []);
    const unshown = real.values().filter((value) => real.canonical(value).some((key) => real.rowsShowing(key).length === 0));
    // Only "Not stated" medicines without any company have no row.
    assert.ok(unshown.every((value) => value === "Not stated"), unshown.join(", "));
    // Every row selects exactly the medicines it counts (a value shown under several rows by the
    // row's path), and a value loads as rows holding exactly its medicines.
    // The holder name as products read it (approvals.js buildProducts(): holderName(), C8).
    const products = medicines.map((row) => ({ ema_product_number: row.ema_product_number, mah: holderName(row.holder_ema) ?? "Not stated", company_key: row.company_key, group_key: row.group_key }));
    const rowKeys = (parent) => real.rows(parent).flatMap((key) => [key, ...rowKeys(key)]);
    const matching = (value) => products.filter((product) => matchesCompany(value, product));
    const wrong = rowKeys(null).filter((key) => matching(real.rowValue(key)).length !== counts.get(key));
    assert.deepEqual(wrong, []);
    const widened = real.values().filter((value) => value !== "Not stated")
      .filter((value) => new Set(real.canonical(value).flatMap(matching)).size !== matching(value).length);
    assert.deepEqual(widened, []);
    // No holder row for the medicines EMA names no holder for.
    assert.deepEqual(rowKeys(null).filter((key) => real.rowShows(key) === "Not stated"), []);
    const groups = rows.filter((row) => row.kind === "group");
    assert.equal(new Set(groups.map((row) => row.monogram)).size, groups.length);
    // Every holder name labels.js fixes is still in EMA's data (C8), and none is shown as EMA spells it.
    const holders = new Set(medicines.map((row) => row.holder_ema));
    assert.deepEqual([...HOLDER_NAME_FIXES.keys()].filter((name) => !holders.has(name)), []);
    assert.deepEqual(real.values().filter((value) => HOLDER_NAME_FIXES.has(value)), []);
  },
);
