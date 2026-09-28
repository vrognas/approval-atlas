// Pure: display text for the regulatory-protection estimate (ema_medicine_protection.json) and
// orphan market exclusivity (ema_medicine_orphan_exclusivity.json). Estimates, never patents.
import { UI } from "./labels.js";

const COPY = UI.protection;

// row: the medicine's protection row (undefined when it has none); orphanRows: its orphan rows;
// snapshotDate: the data date, which decides whether a protection "ends" or "ended" (a range
// has ended only once its later end is past). Basis other_company_reference (step 3): the set's
// first approval was another company group's medicine and the medicine's own group's came later
// (own_counted_from); a reason line says so before the dates, whose market protection range covers
// both estimates. firstName: the medicine approved on counted_from (copies.js countedFromName();
// counted_from is the set's first approval date, not always the reference's own: Humira's rows
// count from Trudexa's), null for none known; left out, the reference's name.
export function protectionSummary(row, orphanRows, substanceLabel, snapshotDate, firstName = row?.reference_name) {
  if (!row) return null;
  const lines = [];
  if (row.basis === "reference_not_found") {
    lines.push(COPY.referenceNotFound);
  } else {
    if (row.basis === "other_company_reference") lines.push(COPY.otherCompany(substanceLabel, firstName, row.counted_from, row.own_counted_from ?? null));
    if (row.basis === "follows_reference") lines.push(COPY.follows(row.reference_name));
    lines.push(
      COPY.dataExclusivity(row.data_exclusivity_end, row.data_exclusivity_end < snapshotDate),
      COPY.marketProtection(row.market_protection_end_min, row.market_protection_end_max, row.market_protection_end_max < snapshotDate),
      COPY.countedFrom(substanceLabel, firstName, row.counted_from),
    );
  }
  return {
    status: COPY.chip(COPY.status[row.status] ?? COPY.status.unclear),
    lines,
    orphan: orphanRows.map((orphan) => orphan.exclusivity_end === null
      ? COPY.orphanNoEnd(orphan.condition, orphan.designation_status)
      : COPY.orphan(orphan.condition, orphan.exclusivity_end, orphan.end_source, orphan.exclusivity_end < snapshotDate)),
  };
}

// The answer strip's short form (step 3, #7): { value: "Until 2031–2032" | "Ended" | "Unclear"
// (the status; the years of the market protection range while protected), orphan: the latest
// orphan market exclusivity still running ("Orphan exclusivity until 2033") or null }; null
// without a row.
export function protectionGlance(row, orphanRows, snapshotDate) {
  if (!row) return null;
  const year = (date) => Number(date.slice(0, 4));
  const value = row.status === "protected"
    ? COPY.glance.until(year(row.market_protection_end_min), year(row.market_protection_end_max))
    : COPY.status[row.status] ?? COPY.status.unclear;
  const running = orphanRows.map((orphan) => orphan.exclusivity_end).filter((end) => end && end >= snapshotDate).sort().at(-1);
  return { value, orphan: running ? COPY.glance.orphan(year(running)) : null };
}

export function espacenetUrl(inn) {
  return `https://worldwide.espacenet.com/patent/search?q=${encodeURIComponent(inn)}`;
}
