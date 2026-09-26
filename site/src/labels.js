// The one display map: raw EMA values -> U.S. labels, plus all UI copy written from JS.
// Raw values stay unchanged in the data and the URL. WHO ATC names are shown verbatim, except
// level-1 group names, displayed in title case (user decision 2026-09-26, noted in the credit).

const formatCount = new Intl.NumberFormat("en-US").format;
const plural = (count, one, many) => `${formatCount(count)} ${count === 1 ? one : many}`;

export const STATUS_LABELS = {
  Authorised: "Authorized",
};

export function statusLabel(status) {
  return STATUS_LABELS[status] ?? status;
}

const MINOR_WORDS = new Set(["and", "or", "for", "of", "the", "in", "to"]);
const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);

// "MUSCULO-SKELETAL SYSTEM" -> "Musculo-Skeletal System"; "excl." -> "Excl.".
export function titleCaseAtcName(name) {
  return name
    .toLowerCase()
    .split(" ")
    .map((word, position) => (position > 0 && MINOR_WORDS.has(word) ? word : word.split("-").map(capitalize).join("-")))
    .join(" ");
}

export function atcLevelOneLabel(code, name) {
  return name ? `${code} — ${titleCaseAtcName(name)}` : code;
}

export const SOURCE_LABELS = {
  ema: "EMA",
  chembl_atc_class: "ChEMBL",
};

// URL value and label for the medicines whose holder field is empty.
export const NOT_STATED = "Not stated";

export const UI = {
  dataDate: (date) => `EMA data as of ${date}`,
  missingData: ["No data found. Run ", "Rscript scripts/run-pipeline.R", " first."],
  ignoredValues: (count) => `${plural(count, "filter value", "filter values")} in the link ${count === 1 ? "was" : "were"} not recognized and ignored.`,

  filters: {
    mah: "Marketing authorization holder",
    branch: "Therapeutic area group",
    area: "Therapeutic area",
    type: "Medicine type",
    status: "Status",
  },
  multiSelect: {
    placeholder: "All",
    search: "Search…",
    selected: (label) => `Selected: ${label}`,
    remove: (name) => `Remove ${name}`,
    added: (name, count) => `Added ${name}. ${formatCount(count)} selected.`,
    removed: (name, count) => `Removed ${name}. ${formatCount(count)} selected.`,
    noMatches: "No matches",
    matches: (count, shown) => `${plural(count, "match", "matches")}${count > shown ? `, showing first ${shown}` : ""}`,
  },
  allYears: "All years",
  yearRange: (from, to) => (from === to ? `${from}` : `${from}–${to}`),

  tiles: [
    { key: "products", label: "Authorized products", caption: "Medicines with status Authorized and an approval date" },
    { key: "substances", label: "Distinct active substances", caption: "Distinct normalized INN sets; combinations count as one set" },
    { key: "orphan", label: "Orphan", caption: "Authorized products with orphan designation" },
    { key: "biosimilar", label: "Biosimilar", caption: "Authorized biosimilar products" },
    { key: "generic", label: "Generic", caption: "Authorized generic products" },
    { key: "advancedTherapy", label: "Advanced therapy", caption: "Authorized advanced therapy medicinal products" },
  ],
  undatedAuthorized: (count) =>
    `${plural(count, "authorized medicine", "authorized medicines")} without an approval date ${count === 1 ? "is" : "are"} not counted.`,

  // Union Register (the Commission's legal record) vs EMA's status: shown only when they disagree.
  register: {
    chip: (status, date) => `EU register: ${statusLabel(status)}${date ? ` (${date})` : ""}`,
    // Neutral: either source can be the one behind (e.g. Suboxone: EMA withdrawn, register still active).
    note: "EMA and the Commission's Union Register (the legal record) show different statuses; either can lag behind a recent decision.",
    marker: "⚠ register differs",
    notAuthorized: (count) => `${formatCount(count)} of these ${count === 1 ? "is" : "are"} no longer authorized according to the EU Union Register.`,
  },

  breakdown: {
    atc: {
      title: "Authorized products by ATC level 1",
      note: "A medicine with codes in several ATC groups appears in each.",
      excluded: (count) => `${plural(count, "authorized medicine", "authorized medicines")} without an ATC code ${count === 1 ? "is" : "are"} not shown.`,
    },
    area: {
      title: "Authorized products by therapeutic area group (MeSH branch)",
      note: "A medicine can appear in several areas.",
      excluded: (count) => `${plural(count, "authorized medicine", "authorized medicines")} without a therapeutic area ${count === 1 ? "is" : "are"} not shown.`,
    },
    // A missing holder is counted as "Not stated", so no medicine is left out.
    mah: { title: "Authorized products by marketing authorization holder", note: "" },
    empty: "No authorized products match the current filters.",
  },
  other: "Other",

  years: {
    undated: (count) => `${plural(count, "medicine", "medicines")} without an approval date ${count === 1 ? "is" : "are"} not shown.`,
    empty: "No dated medicines match the current filters.",
    summary: (first, last, total, peakYear, peakCount) =>
      `Stacked column chart of EMA approvals per year by medicine type, ${first} to ${last}: ` +
      `${formatCount(total)} medicines in total, most in ${peakYear} (${formatCount(peakCount)}).`,
    tooltipTitle: (year, total) => `${year}: ${plural(total, "approval", "approvals")}`,
  },

  overTime: {
    products: "Authorized products",
    substances: "Distinct active substances",
    excluded: (count) =>
      `${plural(count, "medicine", "medicines")} with an ended status but no end date ${count === 1 ? "is" : "are"} excluded.`,
    summary: (last, products, substances) =>
      `Line chart of authorized products and distinct active substances over time; on ${last}: ` +
      `${formatCount(products)} products and ${formatCount(substances)} substances.`,
    range: "Selected approval years",
  },

  table: {
    headers: [
      "Medicine",
      "Active substance(s)",
      "Marketing authorization holder",
      "Approval date",
      "Status",
      "Type",
      "ATC",
      "Therapeutic area",
      "Indication",
    ],
    captionNow: (count) => `${plural(count, "authorized medicine", "authorized medicines")}, newest approval first`,
    captionYears: (count) => `${plural(count, "medicine", "medicines")} with an approval date, newest first`,
    showMore: (next, total) => `Show next ${formatCount(next)} (of ${formatCount(total)})`,
    show: "Show",
    hide: "Hide",
    incomplete: "incomplete",
    incompleteTitle: "Incomplete code: fewer than 7 characters or not a valid ATC code",
    source: (source) => `Source: ${SOURCE_LABELS[source] ?? source}`,
    noBranch: "No MeSH branch matched",
  },

  filtersSummary: (count) => (count ? `Filters (${formatCount(count)} active)` : "Filters"),
  offline: (date) => `Offline — data as of ${date}`,

  lookup: {
    groups: { medicines: "Medicines", substances: "Substances", conditions: "Conditions" },
    medicineMeta: (status, year) => [statusLabel(status), year].filter(Boolean).join(" · "),
    substanceMeta: (count) => plural(count, "medicine", "medicines"),
    conditionMeta: (synonym, count) => [synonym ? `matches “${synonym}”` : null, `${formatCount(count)} authorized`].filter(Boolean).join(" · "),
    noMatches: "No matches",
    matches: (count) => plural(count, "suggestion", "suggestions"),
    loading: "Loading…",
    notAvailable: "Not available right now.",
  },

  card: {
    notFoundTitle: "Not found",
    notFound: (kind, value) => `No ${kind} “${value}” in the EMA data.`,
    noDate: "no approval date",
    kinds: { medicine: "medicine", substance: "substance", condition: "condition" },
    approved: (date) => `EU approval ${date ?? "date not stated"}`,
    statusEnded: (label, date) => `${label} on ${date}`,
    holder: "Marketing authorization holder",
    substances: "Active substance(s)",
    type: "Medicine type",
    atc: "ATC",
    areas: "Therapeutic areas",
    indication: "Indication",
    documents: "Documents",
    pdf: "PDF",
    updated: (date) => `updated ${date}`,
    medicinePage: "EMA medicine page",
    noDocuments: "No EPAR documents listed.",
    flags: {
      orphan_medicine: "Orphan",
      conditional_approval: "Conditional approval",
      exceptional_circumstances: "Exceptional circumstances",
      additional_monitoring: "Additional monitoring",
      prime_priority_medicine: "PRIME",
      accelerated_assessment: "Accelerated assessment",
    },
  },

  documents: {
    productInformation: "Product information (SmPC)",
    epar: "EPAR public assessment report",
    scientificDiscussion: "Scientific discussion",
    variations: (count) => `Assessment reports for variations and extensions (${formatCount(count)})`,
    overview: "Summary for the public",
    rmpSummary: "Risk management plan (RMP) summary",
    proceduralSteps: "Procedural steps after authorization",
    archive: (label) => `${label} (archive)`,
  },

  protection: {
    title: "EU regulatory protection (estimate)",
    status: { protected: "Protected", ended: "Ended", unclear: "Unclear" },
    // Names what the chip covers, so it is not read as covering orphan exclusivity too.
    chip: (status) => `Data/market protection: ${status}`,
    dataExclusivity: (date) => `Data exclusivity ends (est.) ${date}`,
    marketProtection: (min, max) => `Market protection ends (est.) ${min} – ${max}`,
    countedFrom: (substance, name, date) => `Counted from the first EU approval of ${substance}: ${name}, ${date}`,
    thisSubstance: "this active substance",
    follows: (name) => `No protection of its own; follows ${name}`,
    referenceNotFound: "No protection of its own; reference product not found in EU central authorizations",
    orphan: (condition, date, source, ended) =>
      `Orphan market exclusivity for ${condition}: ${ended ? "ended" : "ends"} ${date} ${source === "register" ? "(register)" : "(estimate)"}`,
    orphanNoEnd: (condition, designationStatus) =>
      `Orphan designation for ${condition}: ${designationStatus.toLowerCase()} (end date not published)`,
    patents: "Patents and supplementary protection certificates: not shown — no open EU-wide source.",
    espacenet: "Search patents on Espacenet",
    caveatsTitle: "Caveats",
    caveats: [
      "Not legal advice.",
      "Based only on EU central authorization dates.",
      "Ignores earlier national authorizations, the possible extra year (shown as a range), pediatric rewards, orphan exclusivity reductions and derogations.",
      "The legal basis is inferred from EMA flags.",
      "The EU pharmaceutical reform (not adopted as of September 2026) would change the rules only for new applications.",
    ],
  },

  substance: {
    firstApproval: (date, name) => (date ? `First EU approval: ${date} (${name})` : "No EU approval date"),
    products: (count) => plural(count, "medicine", "medicines"),
  },

  condition: {
    heading: (name, narrower) => `Approved for ${name}${narrower ? ` (includes ${plural(narrower, "narrower term", "narrower terms")})` : ""}`,
    textHeading: (query) => `Mentioned in indication texts: “${query}”`,
    tagged: "Tagged by EMA with this condition",
    alsoMentioned: "Also mentioned in indication text",
    mentioned: "Mentioned in indication text",
    showAll: "Show all statuses",
    none: "None.",
    relatedConditions: "Matching conditions",
  },

  timeline: {
    summary: (count, first, last, lanes) =>
      `Timeline of ${plural(count, "approval", "approvals")} from ${first} to ${last}: ${lanes}.`,
    undated: (count) => `${plural(count, "medicine", "medicines")} without an approval date ${count === 1 ? "is" : "are"} not shown.`,
  },

  footer: {
    mesh: (version) => `MeSH® courtesy of the U.S. National Library of Medicine${version ? ` (${version})` : ""}.`,
    chembl: (version) => `ATC classification from ChEMBL${version ? ` (${version})` : ""}. ChEMBL data is from https://www.ebi.ac.uk/chembl.`,
    atc: "ATC classification © WHO Collaborating Centre for Drug Statistics Methodology; names reproduced verbatim in the data; level-1 names displayed in title case.",
    unionRegister: "Orphan market exclusivity dates and EU register status: © European Union, Union Register of medicinal products, CC BY 4.0; changes made.",
  },

  about: {
    summary: "About this site",
    intendedUse: "Informational only — not medical or legal advice; not a medical device. Data can lag EMA.",
    privacy:
      "No cookies, no analytics, no tracking. Searches run in your browser. The site is hosted on GitHub Pages; GitHub may log IP addresses and page addresses, which include your search when a page is reloaded or opened from a link. Offline mode stores only this site's files and data on your device.",
    security: "Security policy and how to report a vulnerability (GitHub)",
  },
};
