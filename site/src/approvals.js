// Pure data helpers: no DOM, no D3, so they run under node:test.
import { NOT_STATED, UI } from "./labels.js";

export const MEDICINE_TYPES = ["Advanced therapy", "Biosimilar", "Generic", "Other"];

export function buildSubstanceIndex(substanceRows) {
  const index = new Map();
  for (const { ema_product_number, active_substance } of substanceRows) {
    if (!index.has(ema_product_number)) index.set(ema_product_number, []);
    index.get(ema_product_number).push(active_substance);
  }
  return index;
}

// yearRange [first, last] fixes the x domain; without it the rows span the data's own years.
export function countApprovalsByYear(medicines, medicineTypes, yearRange = null) {
  const countsByYear = new Map();
  for (const medicine of medicines) {
    if (medicine.marketing_authorisation_date === null) continue;
    const year = Number(medicine.marketing_authorisation_date.slice(0, 4));
    if (!countsByYear.has(year)) countsByYear.set(year, new Map());
    const counts = countsByYear.get(year);
    counts.set(medicine.medicine_type, (counts.get(medicine.medicine_type) ?? 0) + 1);
  }
  if (countsByYear.size === 0 && yearRange === null) return [];

  const years = [...countsByYear.keys()];
  const [first, last] = yearRange ?? [Math.min(...years), Math.max(...years)];
  const rows = [];
  for (let year = first; year <= last; year++) {
    const counts = countsByYear.get(year) ?? new Map();
    const row = { year: String(year) };
    for (const type of medicineTypes) row[type] = counts.get(type) ?? 0;
    rows.push(row);
  }
  return rows;
}

export function newestFirst(medicines) {
  return [...medicines].sort(
    (a, b) =>
      b.marketing_authorisation_date.localeCompare(a.marketing_authorisation_date) ||
      a.name_of_medicine.localeCompare(b.name_of_medicine),
  );
}

export function distinctSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function groupRows(rows, keyOf, valueOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(valueOf(row));
  }
  return groups;
}

// One record per medicine with the fields the filters and views need.
export function buildProducts(medicines, { areaRows, branchRows, atcRows }) {
  const areasByProduct = groupRows(areaRows, (row) => row.ema_product_number, (row) => row.therapeutic_area_mesh);
  const branchesByTerm = groupRows(
    branchRows.filter((row) => row.branch !== null),
    (row) => row.therapeutic_area_mesh,
    (row) => row.branch,
  );
  const atcByProduct = groupRows(atcRows, (row) => row.ema_product_number, (row) => row);
  return medicines.map((medicine) => {
    const areas = areasByProduct.get(medicine.ema_product_number) ?? [];
    return {
      ...medicine,
      mah: medicine.marketing_authorisation_developer_applicant_holder ?? NOT_STATED,
      year: medicine.authorized_from === null ? null : Number(medicine.authorized_from.slice(0, 4)),
      areas,
      branches: distinctSorted(areas.flatMap((area) => branchesByTerm.get(area) ?? [])),
      atc: atcByProduct.get(medicine.ema_product_number) ?? [],
    };
  });
}

export function isAuthorizedNow(product) {
  return product.medicine_status === "Authorised" && product.authorized_from !== null;
}

function distinctSubstanceSets(products) {
  return new Set(products.map((product) => product.substance_set_key).filter((key) => key !== null)).size;
}

export function countTiles(products) {
  const count = (flag) => products.filter((product) => product[flag]).length;
  return {
    products: products.length,
    substances: distinctSubstanceSets(products),
    orphan: count("orphan_medicine"),
    biosimilar: count("biosimilar"),
    generic: count("generic"),
    advancedTherapy: count("advanced_therapy"),
  };
}

// Counted on date d: no series_exclusion and authorized_from <= d < authorized_until (open if null).
// A sweep over sorted start and end dates; ISO date strings compare correctly as text.
export function authorizedSeries(products, dates) {
  const counted = products.filter(
    (product) =>
      product.series_exclusion === null &&
      product.authorized_from !== null &&
      (product.authorized_until === null || product.authorized_until > product.authorized_from),
  );
  const starts = [...counted].sort((a, b) => a.authorized_from.localeCompare(b.authorized_from));
  const ends = counted
    .filter((product) => product.authorized_until !== null)
    .sort((a, b) => a.authorized_until.localeCompare(b.authorized_until));
  const setCounts = new Map();
  const adjust = (key, change) => {
    if (key === null) return;
    const next = (setCounts.get(key) ?? 0) + change;
    if (next === 0) setCounts.delete(key);
    else setCounts.set(key, next);
  };
  let started = 0;
  let ended = 0;
  return dates.map((date) => {
    while (started < starts.length && starts[started].authorized_from <= date) adjust(starts[started++].substance_set_key, 1);
    while (ended < ends.length && ends[ended].authorized_until <= date) adjust(ends[ended++].substance_set_key, -1);
    return { date, authorized_products: started - ended, authorized_substances: setCounts.size };
  });
}

const BREAKDOWN_VALUES = {
  atc: (product) => product.atc.map((row) => row.atc_code_human.slice(0, 1)),
  area: (product) => product.branches,
  mah: (product) => [product.mah],
};

// Products per value (a product counts once per distinct value), top n by count then label,
// plus one Other row counting the distinct products that have any value outside the top n.
export function breakdownCounts(products, by, labelOf = (key) => key, n = 20) {
  const counts = new Map();
  for (const product of products) {
    for (const key of new Set(BREAKDOWN_VALUES[by](product))) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rows = [...counts]
    .map(([key, count]) => ({ key, label: labelOf(key), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (rows.length <= n) return rows;
  const tail = new Set(rows.slice(n).map((row) => row.key));
  const otherCount = products.filter((product) => BREAKDOWN_VALUES[by](product).some((key) => tail.has(key))).length;
  return [...rows.slice(0, n), { key: null, label: UI.other, count: otherCount, other: true }];
}
