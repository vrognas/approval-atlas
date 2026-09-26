// Pure: EPAR document rows (ema_medicine_documents.json) of one medicine -> labelled groups in
// display order, newest first. URLs are third-party data: only https links are kept.

const GROUPS = [
  { key: "productInformation", types: ["product-information"] },
  { key: "epar", types: ["assessment-report"] },
  { key: "scientificDiscussion", types: ["scientific-discussion"] }, // older products only
  { key: "variations", types: ["variation-report", "scientific-discussion-variation"] },
  { key: "overview", types: ["overview"] },
  { key: "rmpSummary", types: ["rmp-summary"] },
  { key: "proceduralSteps", types: ["procedural-steps-after"] },
];

const newestFirst = (a, b) => (b.last_updated_date ?? "").localeCompare(a.last_updated_date ?? "") || a.title.localeCompare(b.title);

// EMA's "assessment-report" type also holds referral (Article 20/31), refusal and withdrawal
// reports; only the standard EPAR gets the EPAR label, the others keep their EMA title (ownTitle).
const STANDARD_EPAR = /EPAR - Public assessment report\s*$/i;

// EMA splits some documents (mostly procedural steps) into a current file and an "(archive)" file
// with older entries; both are kept and the archive one is flagged for its label.
export function groupDocuments(rows) {
  const safe = rows.filter((row) => row.url?.startsWith("https://")).map((row) => ({
    ...row,
    archive: /\(archive\)\s*$/i.test(row.title),
    ownTitle: row.document_type === "assessment-report" && !STANDARD_EPAR.test(row.title),
  }));
  const groups = GROUPS.map(({ key, types }) => ({ key, rows: safe.filter((row) => types.includes(row.document_type)).sort(newestFirst) }))
    .filter((group) => group.rows.length > 0);
  const hasEpar = groups.some((group) => group.key === "epar" && group.rows.some((row) => !row.ownTitle));
  return groups.filter((group) => !(hasEpar && group.key === "scientificDiscussion"));
}
