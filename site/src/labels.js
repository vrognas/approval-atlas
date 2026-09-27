// The one display map: raw EMA values -> U.S. labels, plus all UI copy written from JS.
// Raw values stay unchanged in the data and the URL. WHO ATC names are shown verbatim, except
// level-1 group names, displayed in title case (user decision 2026-09-26).

const formatCount = new Intl.NumberFormat("en-US").format;
const formatPercent = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format;
const plural = (count, one, many) => `${formatCount(count)} ${count === 1 ? one : many}`;

// Fixed month names: Intl's en-GB "short" month is "Sept" in current ICU.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2018-02-08" -> "8 Feb 2018" for display; data, URL and state keep ISO dates.
export function formatDate(iso) {
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

// "10.4%": share of the authorized products, one decimal.
export function formatShare(part, total) {
  return `${formatPercent(total ? (100 * part) / total : 0)}%`;
}

export const STATUS_LABELS = {
  Authorised: "Authorized",
};

export function statusLabel(status) {
  return STATUS_LABELS[status] ?? status;
}

// Raw EMA status -> the kind that picks its dot colour; unknown statuses count as ended.
const STATUS_KINDS = {
  Authorised: "authorized",
  Opinion: "pending",
  "Opinion under re-examination": "pending",
  Refused: "refused",
  "Application withdrawn": "refused",
  "Withdrawn from rolling review": "refused",
};

export function statusKind(status) {
  return STATUS_KINDS[status] ?? "ended";
}

// Second line of the merged "Approved · Status" cell: the approval date; for an authorization
// that ended on a known date, "{end} · approved {approval}".
export function statusDateLine(status, approved, ended) {
  if (statusKind(status) === "authorized") return formatDate(approved) ?? UI.card.noDate;
  if (ended) return approved ? `${formatDate(ended)} · approved ${formatDate(approved)}` : formatDate(ended);
  return approved ? `approved ${formatDate(approved)}` : null;
}

// Why a medicine is not authorized, from EMA's own date for its status (statusDate() in
// approvals.js) and, for opinions, EMA's opinion status. Nothing is inferred.
export function statusSentence(status, date, opinion) {
  if (statusKind(status) === "authorized") return null;
  const on = date ? ` on ${formatDate(date)}` : "";
  if (status === "Opinion under re-examination") return "Opinion under re-examination; not yet authorized.";
  if (status === "Opinion") {
    if (opinion === "Negative") return `Negative opinion${on}.`;
    return `${opinion === "Positive" ? "Positive opinion" : "Opinion adopted"}${on}; not yet authorized.`;
  }
  return `${statusLabel(status)}${on}.`;
}

// Distinct raw statuses, most common first (ties alphabetical): a substance's answer strip shows
// them when none of its medicines is authorized now.
export function statusesByFrequency(statuses) {
  const counts = new Map();
  for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1);
  return [...counts].sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b)).map(([status]) => status);
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

// Codes EMA uses that atc_classes.json has no name for.
const NO_ATC_NAME = "no WHO name yet";

// A class in running text: "L — Antineoplastic and Immunomodulating Agents" (level 1),
// "L04 IMMUNOSUPPRESSANTS"; the code alone without a WHO name.
export function atcClassLabel(code, name) {
  if (!name) return code;
  return code.length === 1 ? atcLevelOneLabel(code, name) : `${code} ${name}`;
}

// A class named for screen readers: atcClassLabel(), a missing name said as such.
const namedClass = (code, name) => (name ? atcClassLabel(code, name) : `${code} ${NO_ATC_NAME}`);

// The name next to a code badge: level 1 in title case, others verbatim.
export function atcName(code, name) {
  if (!name) return NO_ATC_NAME;
  return code.length === 1 ? titleCaseAtcName(name) : name;
}

export const SOURCE_LABELS = {
  ema: "EMA",
  chembl_atc_class: "ChEMBL",
};

// URL value and label for the medicines whose holder field is empty.
export const NOT_STATED = "Not stated";

// Headline parts: plain strings, or { text, tone } for the words the page colors
// (tone "number": counts in the accent; "negative": the "not" of "not authorized").
const number = (count) => ({ text: formatCount(count), tone: "number" });
const NOT = { text: "not", tone: "negative" };
const NOT_YET = { text: "not yet", tone: "pending" };

// "a, b and c".
const listing = (items) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items[0]);

export const UI = {
  dataDate: (date) => `EMA human medicines · data as of ${formatDate(date)}`,
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

  // Answer headlines: the dashboard's (home, filters) and the lookup results'.
  headline: {
    home: (count) => [number(count), ` ${count === 1 ? "medicine is" : "medicines are"} authorized in the EU today.`],
    filtered: (count) => (count === 0
      ? ["No authorized medicines match these filters."]
      : [number(count), ` authorized ${count === 1 ? "medicine matches" : "medicines match"} these filters.`]),
    // Approvals per year view: medicines with an approval date, any status. range: "2015–2020"
    // when the approval-year filter is set, else null.
    approvedSince: (count, year) => [number(count), ` ${count === 1 ? "medicine has" : "medicines have"} been approved in the EU since ${year}.`],
    approvedFiltered: (count, range) => {
      const medicines = count === 1 ? "medicine" : "medicines";
      const match = `${count === 1 ? "matches" : "match"} these filters.`;
      if (count === 0) return [range ? `No medicines approved in ${range} match these filters.` : "No approved medicines match these filters."];
      return range ? [number(count), ` ${medicines} approved in ${range} ${match}`] : [number(count), ` approved ${medicines} ${match}`];
    },
    // counts: countTiles() output; flag clauses with a zero count are left out.
    dek: ({ products, substances, orphan, generic, biosimilar, advancedTherapy }) => {
      if (products === 0) return null;
      const clause = (count, one, many) => (count === 0 ? null : `${formatCount(count)} ${count === 1 ? one : many}`);
      const clauses = [
        clause(orphan, "carries an orphan designation", "carry an orphan designation"),
        clause(generic, "is a generic", "are generics"),
        clause(biosimilar, "is a biosimilar", "are biosimilars"),
        clause(advancedTherapy, "is an advanced therapy", "are advanced therapies"),
      ].filter(Boolean);
      const contents = `${products === 1 ? "It contains" : "They contain"} ${plural(substances, "distinct active substance", "distinct active substances")}.`;
      return clauses.length ? `${contents} ${listing(clauses)}.` : contents;
    },
    // Only an ATC code filter is active (Authorized now). label: atcClassLabel().
    atcClass: (count, label) => (count === 0
      ? [`No medicines in ${label} are authorized in the EU.`]
      : [number(count), ` ${count === 1 ? "medicine" : "medicines"} in ${label} ${count === 1 ? "is" : "are"} authorized in the EU.`]),
    // kind: statusKind(); an opinion without a decision yet is "not yet" authorized.
    medicine: (name, kind) => {
      if (kind === "authorized") return [`${name} is authorized in the EU.`];
      return [`${name} is `, kind === "pending" ? NOT_YET : NOT, " authorized in the EU."];
    },
    // Substance names stay as in the data (lower-case INN) except for the first letter.
    substance: (name, count) => (count > 0
      ? [`${capitalize(name)} is authorized in the EU in `, number(count), ` ${count === 1 ? "medicine" : "medicines"}.`]
      : [`${capitalize(name)} is `, NOT, " authorized in the EU."]),
    condition: (name, count) => (count > 0
      ? [number(count), ` ${count === 1 ? "medicine is" : "medicines are"} authorized for ${name}.`]
      : [`No authorized medicines are tagged with ${name}.`]),
  },
  kicker: { medicine: "Medicine", substance: "Substance", condition: "Condition", text: "Indication text" },

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
    chip: (status, date) => `EU register: ${statusLabel(status)}${date ? ` (${formatDate(date)})` : ""}`,
    // Neutral: either source can be the one behind (e.g. Suboxone: EMA withdrawn, register still active).
    note: "EMA and the Commission's Union Register (the legal record) show different statuses; either can lag behind a recent decision.",
    marker: "⚠ register differs",
    notAuthorized: (count) => `${formatCount(count)} of these ${count === 1 ? "is" : "are"} no longer authorized according to the EU Union Register.`,
  },

  breakdown: {
    atc: {
      title: "Authorized products by ATC level 1",
      // Drilled into a class (label: atcClassLabel()); a leaf shows only itself.
      titleIn: (label) => `Authorized products in ${label} by ATC class`,
      titleLeaf: (label) => `Authorized products in ${label}`,
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
      "Marketing authorization holder",
      "Approved · Status",
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

  // ATC filtering at every level: table badge segments, the picker, the breakdown, ladders.
  atc: {
    noName: NO_ATC_NAME,
    filterBy: (level, code, name) => `Filter by ATC level ${level}: ${namedClass(code, name)}`,
    toolbar: (code) => `ATC ${code}`,
    all: "All ATC classes",
    path: "ATC level path",
    classPath: "ATC levels of this class",
    browse: "Browse ATC classes",
    childrenLabel: (level, parent) => (parent ? `ATC level ${level} classes in ${parent}` : "ATC level 1 groups"),
    // Picker rows, path items and bars: the class and its count (null: no count shown).
    classCount: (code, name, count) => `${namedClass(code, name)}${count === null ? "" : `, ${formatCount(count)} authorized`}`,
    // The products whose code stops at the parent class (no child class).
    incomplete: "code incomplete",
    nameFilter: (query) => `Showing all groups; the name filter “${query}” is applied.`,
    note: "Codes as published by EMA; some outdated codes (e.g. L01XC, L01XE) are not yet mapped to current classes.",
    up: "Up one level",
    // Ladders (medicine and substance cards): counts are the medicines authorized today, no filters.
    ladder: (code) => `ATC levels of ${code}`,
    ladderLink: (level, code, name, count) =>
      `Level ${level}, ${namedClass(code, name)}${count === null ? "" : `: ${plural(count, "authorized medicine", "authorized medicines")}`}`,
    countsHead: "Authorized today",
    count: (count) => formatCount(count),
    classed: (names, code) => `${listing(names)} ${names.length === 1 ? "is" : "are"} classed ${code}.`,
  },

  filtersSummary: (count) => (count ? `Filters (${formatCount(count)} active)` : "Filters"),
  offline: (date) => `Offline — data as of ${formatDate(date)}`,

  lookup: {
    groups: { medicines: "Medicines", substances: "Substances", conditions: "Conditions", classes: "Drug classes" },
    medicineMeta: (status, year) => [statusLabel(status), year].filter(Boolean).join(" · "),
    substanceMeta: (count) => plural(count, "medicine", "medicines"),
    conditionMeta: (synonym, count) => [synonym ? `matches “${synonym}”` : null, `${formatCount(count)} authorized`].filter(Boolean).join(" · "),
    classMeta: (count, unnamed = false) => [unnamed ? NO_ATC_NAME : null, `${formatCount(count)} authorized`].filter(Boolean).join(" · "),
    noMatches: "No matches",
    matches: (count) => plural(count, "suggestion", "suggestions"),
    loading: "Loading…",
    notAvailable: "Not available right now.",
    // Home state only: example lookups (ids checked against the data 2026-09-26).
    tryLead: "Try",
    examples: [
      { label: "Keytruda", patch: { med: "EMEA/H/C/003820" } },
      { label: "semaglutide", patch: { sub: "semaglutide" } },
      { label: "psoriasis", patch: { cond: "D011565" } },
      // A drug class: the dashboard filtered to it alone (url.js classState()).
      { label: "L04AC", atc: "L04AC" },
    ],
  },

  card: {
    notFoundTitle: "Not found",
    notFound: (kind, value) => `No ${kind} “${value}” in the EMA data.`,
    noDate: "no approval date",
    kinds: { medicine: "medicine", substance: "substance", condition: "condition" },
    // Answer strip under a lookup headline: "Since" while authorized, "Approved" otherwise.
    strip: { label: "Answer summary", holder: "Holder", since: "Since", approved: "Approved", status: "Status" },
    documentMeta: (isPdf, date) => [isPdf ? UI.card.pdf : null, UI.card.updated(date)].filter(Boolean).join(" · "),
    substances: "Active substance(s)",
    type: "Medicine type",
    atc: "ATC classification",
    areas: "Therapeutic areas",
    indication: "Indication",
    documents: "Documents",
    pdf: "PDF",
    updated: (date) => (date ? `updated ${date}` : null),
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
    // ended: the date (the range's later end) is before the data date.
    dataExclusivity: (date, ended) => `Data exclusivity ${ended ? "ended" : "ends"} (est.) ${formatDate(date)}`,
    marketProtection: (min, max, ended) => `Market protection ${ended ? "ended" : "ends"} (est.) ${formatDate(min)} – ${formatDate(max)}`,
    countedFrom: (substance, name, date) => `Counted from the first EU approval of ${substance}: ${name}, ${formatDate(date)}`,
    thisSubstance: "this active substance",
    follows: (name) => `No protection of its own; follows ${name}`,
    referenceNotFound: "No protection of its own; reference product not found in EU central authorizations",
    orphan: (condition, date, source, ended) =>
      `Orphan market exclusivity for ${condition}: ${ended ? "ended" : "ends"} ${formatDate(date)} ${source === "register" ? "(register)" : "(estimate)"}`,
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
    firstApproval: (date, name) => (date ? `First EU approval: ${formatDate(date)} (${name})` : "No EU approval date"),
    products: (count) => plural(count, "medicine", "medicines"),
    holders: (count) => plural(count, "holder", "holders"),
    authorized: (count) => `${formatCount(count)} authorized`,
  },

  condition: {
    narrower: (count) => `Includes ${plural(count, "narrower term", "narrower terms")}.`,
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
    atc: "ATC classification © WHO Collaborating Centre for Drug Statistics Methodology.",
    // CC BY 4.0 requires indicating that the material was modified.
    unionRegister: "Orphan exclusivity and EU register status: © European Union, Union Register, CC BY 4.0, modified.",
  },

  about: {
    summary: "About this site",
    intendedUse: "Informational only — not medical or legal advice; not a medical device. Data can lag EMA.",
    privacy:
      "No cookies, no analytics, no tracking. Searches run in your browser. The site is hosted on GitHub Pages; GitHub may log IP addresses and page addresses, which include your search when a page is reloaded or opened from a link. Offline mode stores only this site's files and data on your device.",
    security: "Security policy and how to report a vulnerability (GitHub)",
  },
};
