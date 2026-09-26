// The one display map: raw EMA values -> U.S. labels, plus all UI copy written from JS.
// Raw values stay unchanged in the data and the URL. WHO ATC names are shown verbatim
// (WHOCC forbids modification), so they never pass through here.

const formatCount = new Intl.NumberFormat("en-US").format;
const plural = (count, one, many) => `${formatCount(count)} ${count === 1 ? one : many}`;

export const STATUS_LABELS = {
  Authorised: "Authorized",
};

export function statusLabel(status) {
  return STATUS_LABELS[status] ?? status;
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

  breakdown: {
    atc: { title: "Authorized products by ATC level 1", note: "A medicine with codes in several ATC groups appears in each." },
    area: { title: "Authorized products by therapeutic area group (MeSH branch)", note: "A medicine can appear in several areas." },
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

  footer: {
    mesh: (version) => `MeSH® courtesy of the U.S. National Library of Medicine${version ? ` (${version})` : ""}.`,
    chembl: (version) => `ATC classification from ChEMBL${version ? ` (${version})` : ""}. ChEMBL data is from https://www.ebi.ac.uk/chembl.`,
    atc: "ATC level names © WHO Collaborating Centre for Drug Statistics Methodology, reproduced verbatim and excluded from the data license.",
  },
};
