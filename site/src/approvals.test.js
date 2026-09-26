import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MEDICINE_TYPES,
  areaTermsFor,
  buildAreaIndex,
  buildSubstanceIndex,
  countApprovalsByYear,
  distinctSorted,
  filterMedicines,
  newestFirst,
} from "./approvals.js";

const medicines = [
  { ema_product_number: "EMEA/H/C/000001", name_of_medicine: "Alpha", medicine_status: "Authorised", marketing_authorisation_date: "2018-03-01", medicine_type: "Other" },
  { ema_product_number: "EMEA/H/C/000002", name_of_medicine: "Beta", medicine_status: "Withdrawn", marketing_authorisation_date: "2020-07-15", medicine_type: "Biosimilar" },
  { ema_product_number: "EMEA/H/C/000003", name_of_medicine: "Gamma", medicine_status: "Authorised", marketing_authorisation_date: "2020-01-10", medicine_type: "Generic" },
  { ema_product_number: "EMEA/H/C/000004", name_of_medicine: "Delta", medicine_status: "Refused", marketing_authorisation_date: null, medicine_type: "Other" },
  { ema_product_number: "EMEA/H/C/000005", name_of_medicine: "Epsilon", medicine_status: "Authorised", marketing_authorisation_date: null, medicine_type: "Advanced therapy" },
];

const areaRows = [
  { ema_product_number: "EMEA/H/C/000001", therapeutic_area_mesh: "Diabetes Mellitus, Type 2" },
  { ema_product_number: "EMEA/H/C/000002", therapeutic_area_mesh: "Arthritis, Rheumatoid" },
  { ema_product_number: "EMEA/H/C/000002", therapeutic_area_mesh: "Psoriasis" },
  { ema_product_number: "EMEA/H/C/000003", therapeutic_area_mesh: "Psoriasis" },
  { ema_product_number: "EMEA/H/C/000004", therapeutic_area_mesh: "Hepatitis C" },
];

const substanceRows = [
  { ema_product_number: "EMEA/H/C/000001", active_substance: "metformin" },
  { ema_product_number: "EMEA/H/C/000001", active_substance: "sitagliptin" },
  { ema_product_number: "EMEA/H/C/000002", active_substance: "adalimumab" },
];

const allStatuses = new Set(["Authorised", "Withdrawn", "Refused"]);
const ids = (rows) => rows.map((row) => row.ema_product_number);

test("buildAreaIndex maps each term to the set of product numbers", () => {
  const index = buildAreaIndex(areaRows);
  assert.deepEqual([...index.get("Psoriasis")], ["EMEA/H/C/000002", "EMEA/H/C/000003"]);
  assert.deepEqual([...index.get("Hepatitis C")], ["EMEA/H/C/000004"]);
  assert.equal(index.size, 4);
});

test("buildSubstanceIndex maps each product number to its substances", () => {
  const index = buildSubstanceIndex(substanceRows);
  assert.deepEqual(index.get("EMEA/H/C/000001"), ["metformin", "sitagliptin"]);
  assert.deepEqual(index.get("EMEA/H/C/000002"), ["adalimumab"]);
  assert.equal(index.get("EMEA/H/C/000003"), undefined);
});

test("filterMedicines keeps only the selected statuses", () => {
  const areaIndex = buildAreaIndex(areaRows);
  const result = filterMedicines(medicines, { statuses: new Set(["Withdrawn"]), therapeuticArea: "" }, areaIndex);
  assert.deepEqual(ids(result), ["EMEA/H/C/000002"]);
});

test("filterMedicines with an empty area keeps every area", () => {
  const areaIndex = buildAreaIndex(areaRows);
  const result = filterMedicines(medicines, { statuses: allStatuses, therapeuticArea: "" }, areaIndex);
  assert.equal(result.length, 5);
});

test("filterMedicines matches the therapeutic area exactly", () => {
  const areaIndex = buildAreaIndex(areaRows);
  const psoriasis = filterMedicines(medicines, { statuses: allStatuses, therapeuticArea: "Psoriasis" }, areaIndex);
  assert.deepEqual(ids(psoriasis), ["EMEA/H/C/000002", "EMEA/H/C/000003"]);
  const partial = filterMedicines(medicines, { statuses: allStatuses, therapeuticArea: "Psoria" }, areaIndex);
  assert.deepEqual(partial, []);
});

test("filterMedicines combines status and area filters", () => {
  const areaIndex = buildAreaIndex(areaRows);
  const result = filterMedicines(medicines, { statuses: new Set(["Authorised"]), therapeuticArea: "Psoriasis" }, areaIndex);
  assert.deepEqual(ids(result), ["EMEA/H/C/000003"]);
});

test("countApprovalsByYear fills years without approvals with zeros", () => {
  const counts = countApprovalsByYear(medicines, MEDICINE_TYPES);
  assert.deepEqual(counts, [
    { year: "2018", "Advanced therapy": 0, Biosimilar: 0, Generic: 0, Other: 1 },
    { year: "2019", "Advanced therapy": 0, Biosimilar: 0, Generic: 0, Other: 0 },
    { year: "2020", "Advanced therapy": 0, Biosimilar: 1, Generic: 1, Other: 0 },
  ]);
});

test("countApprovalsByYear excludes medicines without an approval date", () => {
  const undated = medicines.filter((medicine) => medicine.marketing_authorisation_date === null);
  assert.deepEqual(countApprovalsByYear(undated, MEDICINE_TYPES), []);
  assert.deepEqual(countApprovalsByYear([], MEDICINE_TYPES), []);
});

test("a medicine with several therapeutic areas is counted once", () => {
  const areaIndex = buildAreaIndex(areaRows);
  const all = filterMedicines(medicines, { statuses: allStatuses, therapeuticArea: "" }, areaIndex);
  const total = countApprovalsByYear(all, MEDICINE_TYPES)
    .reduce((sum, row) => sum + MEDICINE_TYPES.reduce((rowSum, type) => rowSum + row[type], 0), 0);
  assert.equal(total, 3);
  const psoriasis = filterMedicines(medicines, { statuses: allStatuses, therapeuticArea: "Psoriasis" }, areaIndex);
  const year2020 = countApprovalsByYear(psoriasis, MEDICINE_TYPES).find((row) => row.year === "2020");
  assert.equal(year2020.Biosimilar, 1);
});

test("newestFirst sorts by approval date descending, then by name", () => {
  const dated = medicines.filter((medicine) => medicine.marketing_authorisation_date !== null);
  const tie = { ...dated[1], ema_product_number: "EMEA/H/C/000009", name_of_medicine: "Aardvark" };
  assert.deepEqual(newestFirst([...dated, tie]).map((medicine) => medicine.name_of_medicine), ["Aardvark", "Beta", "Gamma", "Alpha"]);
  assert.deepEqual(ids(dated), ["EMEA/H/C/000001", "EMEA/H/C/000002", "EMEA/H/C/000003"]);
});

test("distinctSorted removes duplicates and sorts", () => {
  assert.deepEqual(distinctSorted(["Withdrawn", "Authorised", "Withdrawn"]), ["Authorised", "Withdrawn"]);
});

test("areaTermsFor lists the distinct terms of the given medicines only", () => {
  const dated = medicines.filter((medicine) => medicine.marketing_authorisation_date !== null);
  assert.deepEqual(areaTermsFor(areaRows, dated), ["Arthritis, Rheumatoid", "Diabetes Mellitus, Type 2", "Psoriasis"]);
});
