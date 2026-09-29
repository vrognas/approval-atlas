// Draft (loss-of-exclusivity calendar, 2026-09-29; branch draft/exclusivity-calendar): pure, no DOM.
// The currently authorized medicines whose estimated EU market protection is still running
// (ema_medicine_protection.json status "protected"), by the year that estimate ends at the
// earliest (market_protection_end_min). Estimates only, never patents; "unclear" estimates are
// counted apart, never in the years. Orphan market exclusivity (ema_medicine_orphan_exclusivity.json)
// is noted where it runs past the market protection's latest end. Copies (basis follows_reference
// or reference_not_found) have no protection of their own: a generic follows its reference's, so
// counting it would count one loss of exclusivity twice.

export const LATER = "later";
// The list of medicines whose orphan market exclusivity alone runs on (a key like a year's).
export const ORPHAN_ONLY = "orphan-only";
const COPY_BASES = new Set(["follows_reference", "reference_not_found"]);

const yearOf = (date) => Number(date.slice(0, 4));

// The latest orphan market exclusivity end after the date (an ISO date) as { end, source }
// (source: its end_source, "register" or "computed", an estimate), else null.
export function orphanLater(orphanRows, after) {
  const latest = orphanRows.filter((row) => row.exclusivity_end && row.exclusivity_end > after)
    .sort((a, b) => a.exclusivity_end.localeCompare(b.exclusivity_end)).at(-1);
  return latest ? { end: latest.exclusivity_end, source: latest.end_source ?? null } : null;
}

const byName = (a, b) => a.product.name_of_medicine.localeCompare(b.product.name_of_medicine);

// products: currently authorized medicines (rows with ema_product_number and name_of_medicine);
// protection: the lookup's protection dataset ({ byProduct, orphan }); today: the data's date (ISO).
// Returns the protected ones as rows { product, min, max, orphanEnd } by earliest end, latest end,
// then name; orphanOnly: those whose estimate has ended or is unclear but whose orphan market
// exclusivity runs after today and after the estimate's latest end, as { product, status, min,
// max, orphanEnd } by orphan end, then name; unclear: how many other estimates are unclear (the
// earliest end passed, the latest not), and unclearLatest: the year of their latest end (or null).
export function protectionEnding(products, protection, today) {
  const rows = [];
  const orphanOnly = [];
  let unclear = 0;
  let unclearLatest = null;
  for (const product of products) {
    const row = protection.byProduct.get(product.ema_product_number);
    if (!row || COPY_BASES.has(row.basis)) continue;
    const orphanRows = protection.orphan.get(product.ema_product_number) ?? [];
    const min = row.market_protection_end_min;
    const max = row.market_protection_end_max ?? min;
    if (row.status === "protected" && min) {
      rows.push({ product, min, max, orphanEnd: orphanLater(orphanRows, max) });
      continue;
    }
    if (row.status !== "ended" && row.status !== "unclear") continue;
    const orphanEnd = orphanLater(orphanRows, max && max > today ? max : today);
    if (orphanEnd) orphanOnly.push({ product, status: row.status, min, max, orphanEnd });
    else if (row.status === "unclear") {
      unclear += 1;
      if (max) unclearLatest = Math.max(unclearLatest ?? 0, yearOf(max));
    }
  }
  rows.sort((a, b) => a.min.localeCompare(b.min) || a.max.localeCompare(b.max) || byName(a, b));
  orphanOnly.sort((a, b) => a.orphanEnd.end.localeCompare(b.orphanEnd.end) || byName(a, b));
  return { rows, orphanOnly, unclear, unclearLatest };
}

// rows: protectionEnding() rows. One bucket per year from firstYear (the data's year) for `years`
// years, zeros kept, then LATER: { key, year (LATER: its first year), rows, count, orphanLater }.
export function calendarBuckets(rows, firstYear, years = 5) {
  const buckets = Array.from({ length: years }, (_, offset) => ({ key: String(firstYear + offset), year: firstYear + offset, rows: [] }));
  buckets.push({ key: LATER, year: firstYear + years, rows: [] });
  for (const row of rows) buckets[Math.min(Math.max(yearOf(row.min) - firstYear, 0), years)].rows.push(row);
  return buckets.map((bucket) => ({ ...bucket, count: bucket.rows.length, orphanLater: bucket.rows.filter((row) => row.orphanEnd).length }));
}

// Bar lengths in percent: { plain (no orphan exclusivity running later), orphan, clamped }. The
// scale is the widest single year, as the later bucket spans many years; a later bar longer than
// that stops at full length (clamped: drawn broken). With no medicine in any single year the later
// bar is the scale.
export function barShares(buckets) {
  const widestYear = Math.max(0, ...buckets.filter((bucket) => bucket.key !== LATER).map((bucket) => bucket.count));
  const scale = widestYear || Math.max(0, ...buckets.map((bucket) => bucket.count)) || 1;
  return buckets.map((bucket) => {
    const unit = 100 / Math.max(scale, bucket.count);
    return { plain: (bucket.count - bucket.orphanLater) * unit, orphan: bucket.orphanLater * unit, clamped: bucket.count > scale };
  });
}

// rows: protectionEnding() rows, under the year their market protection ends at the earliest;
// orphanOnly: its orphanOnly entries, under the year their orphan market exclusivity ends (marked
// orphanOnly: true). Every year they have, in order, each by that date: [{ year, rows }].
export function endingByYear(rows, orphanOnly = []) {
  const entries = [...rows, ...orphanOnly.map((entry) => ({ ...entry, orphanOnly: true }))];
  const dateOf = (entry) => (entry.orphanOnly ? entry.orphanEnd.end : entry.min);
  entries.sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
  const years = new Map();
  for (const entry of entries) {
    const year = yearOf(dateOf(entry));
    if (!years.has(year)) years.set(year, []);
    years.get(year).push(entry);
  }
  return [...years].sort(([a], [b]) => a - b).map(([year, items]) => ({ year, rows: items }));
}
