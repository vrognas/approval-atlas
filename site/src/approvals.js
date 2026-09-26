// Pure data helpers: no DOM, no D3, so they run under node:test.

export const MEDICINE_TYPES = ["Advanced therapy", "Biosimilar", "Generic", "Other"];

export function buildAreaIndex(areaRows) {
  const index = new Map();
  for (const { ema_product_number, therapeutic_area_mesh } of areaRows) {
    if (!index.has(therapeutic_area_mesh)) index.set(therapeutic_area_mesh, new Set());
    index.get(therapeutic_area_mesh).add(ema_product_number);
  }
  return index;
}

export function buildSubstanceIndex(substanceRows) {
  const index = new Map();
  for (const { ema_product_number, active_substance } of substanceRows) {
    if (!index.has(ema_product_number)) index.set(ema_product_number, []);
    index.get(ema_product_number).push(active_substance);
  }
  return index;
}

export function filterMedicines(medicines, { statuses, therapeuticArea }, areaIndex) {
  const areaIds = therapeuticArea ? areaIndex.get(therapeuticArea) ?? new Set() : null;
  return medicines.filter(
    (medicine) =>
      statuses.has(medicine.medicine_status) &&
      (areaIds === null || areaIds.has(medicine.ema_product_number)),
  );
}

export function countApprovalsByYear(medicines, medicineTypes) {
  const countsByYear = new Map();
  for (const medicine of medicines) {
    if (medicine.marketing_authorisation_date === null) continue;
    const year = Number(medicine.marketing_authorisation_date.slice(0, 4));
    if (!countsByYear.has(year)) countsByYear.set(year, new Map());
    const counts = countsByYear.get(year);
    counts.set(medicine.medicine_type, (counts.get(medicine.medicine_type) ?? 0) + 1);
  }
  if (countsByYear.size === 0) return [];

  const years = [...countsByYear.keys()];
  const rows = [];
  for (let year = Math.min(...years); year <= Math.max(...years); year++) {
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

export function areaTermsFor(areaRows, medicines) {
  const ids = new Set(medicines.map((medicine) => medicine.ema_product_number));
  return distinctSorted(
    areaRows.filter((row) => ids.has(row.ema_product_number)).map((row) => row.therapeutic_area_mesh),
  );
}
