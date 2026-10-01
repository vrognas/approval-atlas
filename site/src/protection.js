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
// count from Trudexa's), null for none known; left out, the reference's name. Data exclusivity is a
// range where R gives its end counted from the company's own first approval too
// (data_exclusivity_end_max, other_company_reference rows; owner request 2026-09-28).
// copy (step 4 review), for a curated copy (copy_source "curated"): curated, its
// ema_curated_copies.json row (undefined without one: older data, a missing file), which names its
// copy type ("a hybrid of Tecfidera"), a national reference and the EMA page that says so;
// referenceSubstance, the central reference's substances (null when unknown).
// A curated copy is counted as its reference is, so its counted-from line names the reference
// (firstName: the reference's name when it was approved on counted_from). puma (2026-09-29), for
// basis paediatric_use: its ema_curated_pumas.json row (undefined without one). A pediatric-use
// marketing authorization has protection of its own, counted from its own approval (R: its
// reference is itself), so its line never calls it the substance's first central approval
// (Alkindi, 2018: hydrocortisone's was Plenadren, 2011). A line is a string, or parts: strings and
// { text, url } for an external link.
export function protectionSummary(row, orphanRows, substanceLabel, snapshotDate, firstName = row?.reference_name, copy = {}) {
  if (!row) return null;
  const lines = [];
  const curated = row.copy_source === "curated";
  if (row.basis === "reference_not_found") {
    lines.push(curated ? nationalReference(copy.curated) : COPY.referenceNotFound);
  } else {
    if (row.basis === "other_company_reference") lines.push(COPY.otherCompany(substanceLabel, firstName, row.counted_from, row.own_counted_from ?? null));
    if (row.basis === "follows_reference") lines.push(curated && copy.curated ? curatedFollows(row, copy.curated) : COPY.follows(row.reference_name));
    const exclusivityMax = row.data_exclusivity_end_max ?? null;
    lines.push(
      exclusivityMax && exclusivityMax !== row.data_exclusivity_end
        ? COPY.dataExclusivityRange(row.data_exclusivity_end, exclusivityMax, exclusivityMax < snapshotDate)
        : COPY.dataExclusivity(row.data_exclusivity_end, row.data_exclusivity_end < snapshotDate),
      COPY.marketProtection(row.market_protection_end_min, row.market_protection_end_max, row.market_protection_end_max < snapshotDate),
      row.basis === "paediatric_use" ? paediatricUse(row, copy.puma)
        : !curated || !row.reference_name ? COPY.countedFrom(substanceLabel, firstName, row.counted_from)
          : firstName === row.reference_name ? COPY.countedFromReference(row.reference_name, row.counted_from)
            : COPY.countedAsReference(row.reference_name, copy.referenceSubstance ?? null, firstName, row.counted_from),
    );
  }
  return {
    status: COPY.chip(isCopy(row) ? COPY.noneOfItsOwn : COPY.status[row.status] ?? COPY.status.unclear),
    lines,
    orphan: orphanRows.map((orphan) => orphan.exclusivity_end === null
      ? COPY.orphanNoEnd(orphan.condition, orphan.designation_status)
      : COPY.orphan(orphan.condition, orphan.exclusivity_end, orphan.end_source, orphan.exclusivity_end < snapshotDate)),
  };
}

// A curated copy without a central reference: its national reference (curatedRow.reference_name)
// and a link to the EMA page that says so (https only); the generic line without a curated row
// naming a national reference.
function nationalReference(curatedRow) {
  if (!curatedRow?.reference_name || curatedRow.reference_product_number) return COPY.referenceNotFound;
  return withEvidence(COPY.nationalReference(curatedRow.copy_type, curatedRow.reference_name), curatedRow);
}

// A curated copy of a central reference (backlog, step 4 review): its copy type and the reference
// as the estimate names it ("a hybrid of Tecfidera"), then the same evidence link.
function curatedFollows(row, curatedRow) {
  return withEvidence(COPY.curatedFollows(curatedRow.copy_type, row.reference_name ?? curatedRow.reference_name), curatedRow);
}

const withEvidence = (text, curatedRow) => (curatedRow?.evidence_url?.startsWith("https://")
  ? [text, " ", { text: COPY.copyEvidence, url: curatedRow.evidence_url }]
  : text);

// A pediatric-use marketing authorization: counted from its own approval (counted_from), then a
// link to its public assessment report (pumaRow: its ema_curated_pumas.json row; the sentence alone
// without one).
const paediatricUse = (row, pumaRow) => withEvidence(COPY.paediatricUse(row.counted_from), pumaRow);

// A copy (a generic, biosimilar or hybrid, EMA-flagged or curated) has no protection of its own:
// its row's status and dates are its reference's (follows_reference), or unknown (no central
// reference). QA 2026-09-29 (#1): chip and protection lead never show them as the copy's own.
export const isCopy = (row) => row.basis === "follows_reference" || row.basis === "reference_not_found";

// The medicine card's protection lead says "(est.)" only after "Market protection until …": a medicine's own
// protection still running (review of F · Spacious, phase 4), not "Ended", "Unclear" or a copy's.
export const glanceIsEstimate = (row) => Boolean(row) && !isCopy(row) && row.status === "protected";

// The medicine card's protection lead (step 3, #7; the answer strip's cell before F · Spacious,
// phase 4): { value: "Market protection until 2031–2032" | "Market protection ended" | "Market
// protection unclear" (the years of the market protection range while protected, else the status;
// named since the Laws of UX second pass, 2026-09-30), reference: null,
// orphan: the latest orphan market exclusivity still running ("Orphan market exclusivity until 2033
// (est.)", no "(est.)" when the Union Register publishes that end) or null }; null without a row.
// A copy: value "Follows Ibrance" (a reference by name, else "None of its own"), reference: the
// reference's years while it is protected ("Ibrance's: until 2026–2027"), else null.
// Orphan rows by their exclusivity end, on the same day the register's (exact) after a computed one,
// so the latest is the register's where both end then.
export const byOrphanEnd = (a, b) =>
  a.exclusivity_end.localeCompare(b.exclusivity_end) || Number(a.end_source === "register") - Number(b.end_source === "register");

export function protectionGlance(row, orphanRows, snapshotDate) {
  if (!row) return null;
  const year = (date) => Number(date.slice(0, 4));
  const running = orphanRows.filter((orphan) => orphan.exclusivity_end && orphan.exclusivity_end >= snapshotDate)
    .sort(byOrphanEnd).at(-1);
  const orphan = running ? COPY.glance.orphan(year(running.exclusivity_end), running.end_source ?? null) : null;
  const range = [row.market_protection_end_min, row.market_protection_end_max].map((date) => (date ? year(date) : null));
  if (isCopy(row)) {
    const follows = row.basis === "follows_reference" && row.reference_name;
    return {
      value: follows ? COPY.glance.follows(row.reference_name) : COPY.noneOfItsOwn,
      reference: follows && row.status === "protected" ? COPY.glance.referenceUntil(row.reference_name, ...range) : null,
      orphan,
    };
  }
  const value = row.status === "protected" ? COPY.glance.until(...range) : COPY.glance[row.status] ?? COPY.glance.unclear;
  return { value, reference: null, orphan };
}

export function espacenetUrl(inn) {
  return `https://worldwide.espacenet.com/patent/search?q=${encodeURIComponent(inn)}`;
}
