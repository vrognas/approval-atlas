// Pure: display text for the regulatory-protection estimate (ema_medicine_protection.json) and
// orphan market exclusivity (ema_medicine_orphan_exclusivity.json). Estimates, never patents.
import { UI } from "./labels.js";

const COPY = UI.protection;

// row: the medicine's protection row (undefined when it has none); orphanRows: its orphan rows;
// snapshotDate: the data date, which decides whether a protection "ends" or "ended" (a range
// has ended only once its later end is past).
export function protectionSummary(row, orphanRows, substanceLabel, snapshotDate) {
  if (!row) return null;
  const lines = [];
  if (row.basis === "reference_not_found") {
    lines.push(COPY.referenceNotFound);
  } else {
    if (row.basis === "follows_reference") lines.push(COPY.follows(row.reference_name));
    lines.push(
      COPY.dataExclusivity(row.data_exclusivity_end, row.data_exclusivity_end < snapshotDate),
      COPY.marketProtection(row.market_protection_end_min, row.market_protection_end_max, row.market_protection_end_max < snapshotDate),
      COPY.countedFrom(substanceLabel, row.reference_name, row.counted_from),
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

export function espacenetUrl(inn) {
  return `https://worldwide.espacenet.com/patent/search?q=${encodeURIComponent(inn)}`;
}
