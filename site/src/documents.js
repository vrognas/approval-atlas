// Pure: EPAR document rows of one medicine (ema_medicine_documents.json, or its few rows in
// ema_medicine_primary_documents.json) -> labelled groups in display order, newest first. URLs are
// third-party data: only https links are kept.
import { statusKind } from "./labels.js";

const GROUPS = [
  { key: "productInformation", types: ["product-information"] },
  { key: "epar", types: ["assessment-report"] },
  { key: "scientificDiscussion", types: ["scientific-discussion"] }, // older products only
  { key: "variations", types: ["variation-report", "scientific-discussion-variation"] },
  { key: "overview", types: ["overview"] },
  { key: "rmpSummary", types: ["rmp-summary"] },
  { key: "proceduralSteps", types: ["procedural-steps-after"] },
];

const newestFirst = (a, b) => (b.last_updated_date ?? "").localeCompare(a.last_updated_date ?? "") || (a.title ?? "").localeCompare(b.title ?? "");

// EMA's "assessment-report" type also holds referral (Article 20/31), refusal and withdrawal
// reports; only the standard EPAR gets the EPAR label, the others keep their EMA title (ownTitle).
const STANDARD_EPAR = /EPAR - Public assessment report\s*$/i;
const REFUSAL = /refusal/i;

// A row's flags: an "(archive)" file, an assessment report with a title of its own (ownTitle), a
// refusal report (one of those naming a refusal). A primary-documents row (refusal_report set, no
// title) is the pipeline's pick by the same rules (R build_primary_documents_table(): never an
// archive file, and its only own-title rows are refusal reports).
function flags(row) {
  if (row.refusal_report !== undefined) return { archive: false, ownTitle: row.refusal_report, refusal: row.refusal_report };
  const ownTitle = row.document_type === "assessment-report" && !STANDARD_EPAR.test(row.title);
  return { archive: /\(archive\)\s*$/i.test(row.title), ownTitle, refusal: ownTitle && REFUSAL.test(row.title) };
}

// EMA splits some documents (mostly procedural steps) into a current file and an "(archive)" file
// with older entries; both are kept and the archive one is flagged for its label.
export function groupDocuments(rows) {
  const safe = rows.filter((row) => row.url?.startsWith("https://")).map((row) => ({ ...row, ...flags(row) }));
  const groups = GROUPS.map(({ key, types }) => ({ key, rows: safe.filter((row) => types.includes(row.document_type)).sort(newestFirst) }))
    .filter((group) => group.rows.length > 0);
  const hasEpar = groups.some((group) => group.key === "epar" && group.rows.some((row) => !row.ownTitle));
  return groups.filter((group) => !(hasEpar && group.key === "scientificDiscussion"));
}

// Step 4 (#15): EMA's plain-language overview (for the public) is the card's third button; rows
// (quickDocuments()) keep the compact SmPC and EPAR links only.
const PRIMARY = ["productInformation", "epar", "overview"];
const QUICK = ["productInformation", "epar"];

// A group's primary row for a medicine with this EMA status. A medicine never authorized (refused,
// application withdrawn, opinion; statusKind()) has no product information, and only a refused one
// has an EPAR: its refusal report (older ones carry the standard title). EMA's index can list an
// authorized namesake's documents under it (Mylotarg EMEA/H/C/000705, refused, gets 004204's), so
// those are never its primary links; they stay in the list.
function primaryRow(group, status) {
  const current = (row) => !row.archive && !row.ownTitle;
  if (!["refused", "pending"].includes(statusKind(status))) return PRIMARY.includes(group.key) ? group.rows.find(current) : undefined;
  if (status !== "Refused" || group.key !== "epar") return undefined;
  return group.rows.find((row) => row.refusal && !row.archive) ?? group.rows.find(current);
}

// groupDocuments() output -> the newest current SmPC, standard EPAR and overview (shown as buttons)
// and the remaining groups (the list), without those rows. status: the medicine's EMA status
// (primaryRow(); none: both links, as for an authorized one).
export function primaryDocuments(groups, status) {
  const primary = [];
  const rest = [];
  for (const group of groups) {
    const row = primaryRow(group, status);
    if (row) primary.push({ key: group.key, row });
    const rows = group.rows.filter((candidate) => candidate !== row);
    if (rows.length) rest.push({ ...group, rows });
  }
  return { primary, rest };
}

// EMA's documents index can list an authorized namesake's documents under a medicine never
// authorized (Mylotarg EMEA/H/C/000705, refused in 2008, gets 004204's, approved in 2018): the rows
// first published on or after since (the namesake's approval date) are the namesake's.
export function splitNamesakeDocuments(rows, since) {
  if (!since) return { own: rows, namesake: [] };
  const later = (row) => (row.first_published_date ?? row.last_updated_date ?? "") >= since;
  return { own: rows.filter((row) => !later(row)), namesake: rows.filter(later) };
}

// One medicine's document rows and EMA status -> { productInformation, epar }: the URLs of its
// primary documents (primaryDocuments()), a key only where there is one; the "PI" and "EPAR" row links.
export function quickDocuments(rows, status) {
  return Object.fromEntries(primaryDocuments(groupDocuments(rows), status).primary
    .filter(({ key }) => QUICK.includes(key))
    .map(({ key, row }) => [key, row.url]));
}
