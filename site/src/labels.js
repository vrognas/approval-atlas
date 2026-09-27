// The one display map: raw EMA values -> U.S. labels, plus all UI copy written from JS.
// Raw values stay unchanged in the data and the URL. WHO ATC names (all levels) are displayed in
// title case (atcDisplayName(); user decisions 2026-09-26 and 2026-09-27). No em-dashes in UI copy.

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

// The start of an indication text for the medicine card's first screen: the whole text when short,
// else its first sentence (a period, then a capital: "e.g. dysglycaemia" goes on), else its first
// max characters cut at a word with "…". more: text was left out.
export function indicationLead(text, max = 200) {
  if (text.length <= max) return { lead: text, more: false };
  const end = text.search(/\.\s+(?=\p{Lu})/u);
  if (end >= 0 && end < max) return { lead: text.slice(0, end + 1), more: true };
  const cut = text.lastIndexOf(" ", max);
  return { lead: `${text.slice(0, cut > 0 ? cut : max).replace(/[\s,;:]+$/, "")}…`, more: true };
}

// Distinct raw statuses, most common first (ties alphabetical): a substance's answer strip shows
// them when none of its medicines is authorized now.
export function statusesByFrequency(statuses) {
  const counts = new Map();
  for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1);
  return [...counts].sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b)).map(([status]) => status);
}

// Lower-case in ATC names unless first or last (Chicago: "Agents Acting On"; "A" alone is a
// vitamin: "VITAMIN A AND D").
const MINOR_WORDS = new Set([
  "and", "or", "and/or", "nor", "but", "for", "of", "the", "in", "on", "at", "as", "to", "from", "with", "by", "per", "via", "vs",
  "a", "an", "excl.", "incl.",
]);
// The acronyms in WHO's all-capitals ATC names (atc_classes.json, scanned 2026-09-27); their other
// words are ordinary ones ("SURGICAL AIDS"). In mixed-case names capitals are always acronyms.
const ATC_ACRONYMS = new Set(["ACE", "ACTH", "ADHD", "GORD", "II", "III", "PSMA", "UV"]);
const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);

// "mTOR", "CoA", "ARBs": an upper-case letter after the first, beside lower-case ones.
function hasInnerCapital(part) {
  const letters = part.replace(/\P{L}/gu, "");
  return /\p{Ll}/u.test(letters) && /\p{Lu}/u.test(letters.slice(1));
}

// One hyphen- or slash-separated part of a word; shouted: the name is in capitals throughout.
// With digits ("GLP-1", "beta-1a", "B12") or inner capitals it stays as written (a leading
// lower-case letter capitalized); letter runs split at periods ("I.V.", "etc.").
function titleCasePart(part, shouted) {
  if (/\d/.test(part)) return part.replace(/^(\(?)(\p{Ll})/u, (match, bracket, letter) => bracket + letter.toUpperCase());
  if (hasInnerCapital(part)) return part;
  return part.replace(/[\p{L}']+/gu, (run) => {
    if (run !== run.toUpperCase()) return capitalize(run);
    return shouted && !ATC_ACRONYMS.has(run) ? capitalize(run.toLowerCase()) : run;
  });
}

// A WHO ATC name (any level) for display; the data keeps it verbatim. "MUSCULO-SKELETAL SYSTEM"
// -> "Musculo-Skeletal System", "ACE INHIBITORS, PLAIN" -> "ACE Inhibitors, Plain",
// "insulin (human)" -> "Insulin (Human)", "metformin and sitagliptin" -> "Metformin and Sitagliptin".
export function atcDisplayName(name) {
  const shouted = !/\p{Ll}{2}/u.test(name);
  const words = name.split(" ");
  return words.map((word, position) => {
    const bare = word.replace(/^\(+|[),;:]+$/g, "");
    const inside = position > 0 && position < words.length - 1;
    if (inside && bare !== "A" && MINOR_WORDS.has(bare.toLowerCase())) return word.toLowerCase();
    return word.split(/([-/])/).map((part) => titleCasePart(part, shouted)).join("");
  }).join(" ");
}

// Codes EMA uses that atc_classes.json has no name for.
const NO_ATC_NAME = "no WHO name yet";

// A class in running text: "L Antineoplastic and Immunomodulating Agents", "L04 Immunosuppressants";
// the code alone without a WHO name.
export function atcClassLabel(code, name) {
  return name ? `${code} ${atcDisplayName(name)}` : code;
}

// A class named for screen readers: atcClassLabel(), a missing name said as such.
const namedClass = (code, name) => (name ? atcClassLabel(code, name) : `${code} ${NO_ATC_NAME}`);

// The name next to a code badge; a missing name says so.
export function atcName(name) {
  return name ? atcDisplayName(name) : NO_ATC_NAME;
}

export const SOURCE_LABELS = {
  ema: "EMA",
  ema_smpc: "EMA product information (SmPC)",
  chembl_atc_class: "ChEMBL",
};

// atc.js atcOrigin() -> the sentence saying how the code shown differs from EMA's published one
// (null: it does not). names: code -> WHO name; years: retired code -> the year WHO retired it.
export function atcOriginText(origin, names, years) {
  if (!origin) return null;
  const copy = UI.atc.origin;
  if (origin.kind === "retired") return copy.retired(atcClassLabel(origin.from, names.get(origin.from)), years.get(origin.from) ?? null, origin.now);
  return origin.kind === "smpc" ? copy.smpc : copy[origin.kind](origin.published);
}

// The same as a short flag beside the badge (the sentence is its tooltip).
export function atcOriginFlag(origin) {
  if (!origin) return null;
  const copy = UI.atc.originFlag;
  if (origin.kind === "retired") return copy.retired(origin.from);
  return origin.kind === "smpc" ? copy.smpc : copy.published(origin.published);
}

// URL value and label for the medicines whose holder field is empty.
export const NOT_STATED = "Not stated";

// Headline parts: plain strings, or { text, tone } for the words the page colors
// (tone "number": counts in the accent; "negative": the "not" of "not authorized").
const number = (count) => ({ text: formatCount(count), tone: "number" });
const NOT = { text: "not", tone: "negative" };
const NOT_YET = { text: "not yet", tone: "pending" };

// "a, b and c".
const listing = (items) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items[0]);

// The end of a dashboard headline: how many of the total medicines are currently authorized (not
// "authorized today", which reads as "authorized on this date").
function currentlyAuthorized(total, authorized) {
  if (total === 1) return authorized ? ["; it is currently authorized."] : ["; it is ", NOT, " currently authorized."];
  if (authorized === 0) return [", none of them currently authorized."];
  if (authorized === total) return [", all of them currently authorized."];
  return [", ", number(authorized), " of them currently authorized."];
}

// A count of medicines with one status, in running text ("268 applications withdrawn").
const STATUS_PHRASES = {
  Authorised: () => "authorized",
  "Application withdrawn": (count) => (count === 1 ? "application withdrawn" : "applications withdrawn"),
  Opinion: () => "awaiting a decision",
  "Opinion under re-examination": () => "under re-examination",
};
const statusCount = ({ status, count }) => `${formatCount(count)} ${STATUS_PHRASES[status]?.(count) ?? statusLabel(status).toLowerCase()}`;
// The dek lists this many statuses; the rest are summed up.
const DEK_STATUSES = 4;

export const UI = {
  dataDate: (date) => `EMA human medicines · data as of ${formatDate(date)}`,
  // The tab's title: the view's name (a medicine, substance, condition, search or drug class) first.
  pageTitle: (name) => (name ? `${name} · Approval Atlas` : "Approval Atlas"),
  textTitle: (query) => `“${query}”`,
  // Above the dashboard while a lookup result is open.
  explore: {
    title: "Explore all EMA medicines",
    note: "The filters apply to this overview, not to the result above.",
  },
  missingData: ["No data found. Run ", "Rscript scripts/run-pipeline.R", " first."],
  ignoredValues: (count) => `${plural(count, "filter value", "filter values")} in the link ${count === 1 ? "was" : "were"} not recognized and ignored.`,

  // The filter sentence under the headline (facets.js sentenceParts()): each token opens its
  // sidebar section (desktop) or sheet (phones, tablets); an active one has a remove button.
  sentence: {
    words: {
      showing: "Showing ", in: " in ", from: " from ", and: " and ", approved: ", approved ", approvedIn: ", approved in ", to: "–", with: ", with ", end: ".",
      // After a year range: the medicines never approved are no longer counted.
      undatedOut: " (medicines without an approval date left out)",
    },
    // The year token without a year filter (it focuses the approval-years slider).
    anyYear: "any year",
    defaults: {
      type: "all medicine types",
      atc: "all ATC classes",
      mah: "all holders",
      branch: "all therapeutic area groups",
      area: "all therapeutic areas",
      status: "any status",
    },
    many: {
      type: (count) => plural(count, "medicine type", "medicine types"),
      atc: (count) => plural(count, "ATC class", "ATC classes"),
      mah: (count) => plural(count, "holder", "holders"),
      branch: (count) => plural(count, "therapeutic area group", "therapeutic area groups"),
      area: (count) => plural(count, "therapeutic area", "therapeutic areas"),
      status: (count) => plural(count, "status", "statuses"),
    },
    atcName: (query) => `ATC classes matching “${query}”`,
    status: (label) => `status ${label}`,
    // The filter each token (sentenceParts() key) belongs to, for its accessible name.
    dimensions: {
      type: "medicine type",
      atc: "ATC class",
      mah: "holder",
      areas: "therapeutic area",
      branch: "therapeutic area group",
      area: "therapeutic area",
      from: "start year",
      to: "end year",
      years: "approval years",
      // One approval year: a single token for both ends.
      year: "approval year",
      status: "status",
    },
    // The visible text first, so speech input can use it (WCAG 2.5.3).
    tokenName: (key, text) => `${text}, ${UI.sentence.dimensions[key]} filter`,
    remove: (key, text) => `Remove ${UI.sentence.dimensions[key]} filter: ${text}`,
    reset: "Reset",
    allFilters: "All filters",
  },
  // Facet sections: the desktop sidebar and the phone sheets.
  facets: {
    active: (count) => (count ? `${formatCount(count)} active` : null),
    counts: "Counts: medicines matching the other filters.",
    search: (count, noun) => `Filter ${formatCount(count)} ${noun}`,
    nouns: { area: "areas", mah: "holders" },
    searchLabel: { area: "Filter therapeutic areas", mah: "Filter marketing authorization holders" },
    showAll: (count) => `Show all ${formatCount(count)}`,
    showFewer: "Show fewer",
    showMore: (count) => `Show ${formatCount(count)} more`,
    noMatches: "No matches",
    // Announced after typing in a facet search.
    matches: (count) => (count ? plural(count, "match", "matches") : UI.facets.noMatches),
  },
  sheet: {
    show: (count) => `Show ${plural(count, "medicine", "medicines")}`,
    clear: "Clear",
    close: "Close filters",
    // Sheets with more than one section; single sections take their heading.
    titles: { areas: "Therapeutic areas", all: "Filters" },
  },
  allYears: "All years",
  yearRange: (from, to) => (from === to ? `${from}` : `${from}–${to}`),
  // The approval-years strip in the main column: a histogram of every medicine with an approval
  // date, stacked by current status (aria-hidden; the summary is read instead; tooltips per bar)
  // above a two-thumb slider. statuses: [{ status, count }] in stack order.
  yearStrip: {
    start: "Start year",
    end: "End year",
    summary: (first, last, total, peakYear, peakCount, statuses) => {
      if (total === 0) return "No medicines with an approval date match the other filters.";
      const split = statuses.map(({ status, count }) => `${formatCount(count)} ${statusLabel(status)}`).join(", ");
      return `Column chart of approvals per year, ${first} to ${last}, stacked by current status, of the medicines matching the other filters: ` +
        `${formatCount(total)} in total (${split}), most in ${peakYear} (${formatCount(peakCount)}).`;
    },
    tooltip: (year, total, statuses) =>
      [UI.years.tooltipTitle(year, total), ...statuses.map(({ status, count }) => `${formatCount(count)} ${statusLabel(status)}`)].join("\n"),
    // ranged: a year filter is set, which leaves them out of the dashboard's counts too.
    undated: (count, ranged = false) =>
      `${plural(count, "medicine", "medicines")} without an approval date (refused, application withdrawn, pending…) ${count === 1 ? "is" : "are"} not in this chart${ranged ? ", and the year filter leaves them out of every count" : ""}.`,
    // Before the legend (in stack order): position tells the segments apart, not only colour.
    legendLead: "Bottom to top:",
  },

  // Answer headlines: the dashboard's (home, filters, one ATC class) and the lookup results'. The
  // dashboard counts every medicine in the EMA data (total) and those currently authorized.
  headline: {
    home: (total, authorized) => [number(authorized), " of ", number(total), " medicines in the EMA data are currently authorized in the EU."],
    filtered: (total, authorized) => (total === 0
      ? ["No medicines match these filters."]
      : [number(total), ` ${total === 1 ? "medicine matches" : "medicines match"} these filters`, ...currentlyAuthorized(total, authorized)]),
    // entries: statusBreakdown() output, most first; the top four, the rest summed up. undated: the
    // authorized ones without an approval date, which the headline does not count.
    statuses: (entries, undated = 0) => {
      if (entries.length === 0) return null;
      const shown = entries.length > DEK_STATUSES ? entries.slice(0, DEK_STATUSES) : entries;
      const rest = entries.slice(shown.length).reduce((sum, entry) => sum + entry.count, 0);
      const count = (entry) => (statusKind(entry.status) === "authorized" && undated
        ? `${statusCount(entry)} (${formatCount(undated)} without an approval date, not counted above)`
        : statusCount(entry));
      return `By status: ${listing([...shown.map(count), ...(rest ? [`${formatCount(rest)} more`] : [])])}.`;
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
    // Only one ATC code is selected, no other filter. label: atcClassLabel().
    atcClass: (total, authorized, label) => (total === 0
      ? [`No medicines in the EMA data are classed ${label}.`]
      : [number(total), ` ${total === 1 ? "medicine" : "medicines"} in ${label}`, ...currentlyAuthorized(total, authorized)]),
    // kind: statusKind(); an opinion without a decision yet is "not yet" authorized.
    medicine: (name, kind) => {
      if (kind === "authorized") return [`${name} is authorized in the EU.`];
      return [`${name} is `, kind === "pending" ? NOT_YET : NOT, " authorized in the EU."];
    },
    // Substance names stay as in the data (lower-case INN) except for the first letter.
    substance: (name, count) => (count > 0
      ? [`${capitalize(name)} is authorized in the EU in `, number(count), ` ${count === 1 ? "medicine" : "medicines"}.`]
      : [`${capitalize(name)} is `, NOT, " authorized in the EU."]),
    // EMA's therapeutic-area tags (not indications); narrower: the count includes medicines tagged
    // with a narrower condition (Psoriasis: Arthritis, Psoriatic).
    condition: (name, count, narrower) => {
      const what = `tagged by EMA with ${name}${narrower ? " or a narrower condition" : ""}.`;
      return count > 0
        ? [number(count), ` authorized ${count === 1 ? "medicine is" : "medicines are"} ${what}`]
        : [`No authorized medicines are ${what}`];
    },
  },
  kicker: { medicine: "Medicine", substance: "Substance", condition: "Condition", text: "Indication text" },

  // The medicines matching the filters (every status) and those currently authorized, then the four
  // types with their share of the medicines. captionFiltered: the caption while a filter is active.
  tiles: [
    { key: "products", label: "Medicines", caption: "Every status in the EMA data", captionFiltered: "Every status, matching the filters" },
    { key: "authorized", label: "Currently authorized", caption: "Status Authorized, with an approval date" },
    { key: "orphan", label: "Orphan", caption: "Medicines with an orphan designation" },
    { key: "biosimilar", label: "Biosimilar", caption: "Biosimilar medicines" },
    { key: "generic", label: "Generic", caption: "Generic medicines" },
    { key: "advancedTherapy", label: "Advanced therapy", caption: "Advanced therapy medicinal products" },
  ],
  undatedAuthorized: (count) =>
    `${plural(count, "authorized medicine", "authorized medicines")} without an approval date ${count === 1 ? "is" : "are"} not counted as currently authorized.`,
  // Shown on hover and focus wherever a type badge, tile, facet row or sentence token names one
  // (keys: typeBadges() labels, medicine types); at most 12 words.
  typeTips: {
    Orphan: "For rare diseases (at most 5 in 10,000 people in the EU).",
    Biosimilar: "Highly similar to a biological medicine already approved in the EU.",
    Generic: "Same active substance as an already approved reference medicine.",
    "Advanced therapy": "Gene therapy, cell therapy or tissue-engineered medicine.",
    Other: "Not a generic, biosimilar or advanced therapy (e.g. a new active substance).",
  },
  // Links to other websites open in a new tab (links.js markExternal()): an icon, and the
  // destination, named by its host, said after the link text and shown as its tooltip. A host
  // missing here is named by itself.
  external: {
    destinations: {
      "www.ema.europa.eu": "EMA website",
      "ec.europa.eu": "European Commission website",
      "worldwide.espacenet.com": "Espacenet",
      "github.com": "GitHub",
      "creativecommons.org": "Creative Commons website",
    },
    newTab: (destination) => `(opens ${destination} in a new tab)`,
    title: (destination, host) => (destination === host ? host : `${destination} (${host})`),
  },
  // Compact links on medicine rows (result tables, the medicines table) to the current product
  // information and the latest public assessment report (documents.js quickDocuments()).
  documentLinks: {
    productInformation: { text: "PI", label: (name) => `PI, product information PDF for ${name}` },
    epar: { text: "EPAR", label: (name) => `EPAR public assessment report PDF for ${name}` },
  },

  // Union Register (the Commission's legal record) vs EMA's status: shown only when they disagree.
  register: {
    chip: (status, date) => `EU register: ${statusLabel(status)}${date ? ` (${formatDate(date)})` : ""}`,
    // Neutral: either source can be the one behind (e.g. Suboxone: EMA withdrawn, register still active).
    note: "EMA and the Commission's Union Register (the legal record) show different statuses; either can lag behind a recent decision.",
    marker: "⚠ register differs",
    // Under the tiles: of the "Currently authorized" medicines.
    notAuthorized: (count) =>
      `${formatCount(count)} of the medicines EMA lists as currently authorized ${count === 1 ? "is" : "are"} no longer authorized according to the EU Union Register.`,
  },

  // Every matching medicine, whatever its status.
  breakdown: {
    atc: {
      title: "Medicines by ATC level 1",
      // Drilled into a class (label: atcClassLabel()); a leaf shows only itself.
      titleIn: (label) => `Medicines in ${label} by ATC class`,
      titleLeaf: (label) => `Medicines in ${label}`,
      note: "A medicine with codes in several ATC groups appears in each.",
      excluded: (count) => `${plural(count, "medicine", "medicines")} without a valid ATC code ${count === 1 ? "is" : "are"} not shown.`,
    },
    area: {
      title: "Medicines by therapeutic area group (MeSH branch)",
      note: "A medicine can appear in several areas.",
      excluded: (count) => `${plural(count, "medicine", "medicines")} without a therapeutic area ${count === 1 ? "is" : "are"} not shown.`,
    },
    // A missing holder is counted as "Not stated", so no medicine is left out.
    mah: { title: "Medicines by marketing authorization holder", note: "" },
    empty: "No medicines match the current filters.",
    // Bar order (UI state): most first, or ATC classes by code and areas and holders by name.
    sort: { label: "Sort", count: "Count", key: { atc: "Code", area: "Name", mah: "Name" } },
    // A stacked ATC bar's medicine types: [[type, count]] in stack order.
    typeSplit: (entries) => entries.map(([type, count]) => `${formatCount(count)} ${type}`).join(", "),
  },
  // The therapeutic areas of the medicines shown (all of them without a filter); each opens its
  // condition page (a lookup, ?cond=) where its MeSH descriptor is known.
  conditions: {
    title: "Most common conditions",
    // Each row counts every status, then the authorized ones (the list a condition page opens with).
    subtitle: (count, filtered) => `${filtered
      ? `Therapeutic areas of the ${plural(count, "medicine", "medicines")} matching the filters`
      : `Therapeutic areas of all ${plural(count, "medicine", "medicines")} in the EMA data`}: medicines of every status, then those authorized`,
    authorized: (count) => `${formatCount(count)} authorized`,
    hint: "Open a condition to see its approval timeline.",
    // count: the medicines shown, none of which has a therapeutic area.
    empty: (count) => {
      if (count === 0) return "No medicines match the current filters.";
      return count === 1 ? "No therapeutic area is listed for this medicine." : "No therapeutic areas are listed for these medicines.";
    },
    // Condition page links beside a therapeutic area group or term (breakdown, sidebar).
    open: (name) => `Open condition page: ${name}`,
  },
  // "Who is active where": the top holders (rows) x ATC groups or therapeutic area groups.
  activity: {
    title: "Who is active where",
    modes: { atc: "ATC groups", area: "Therapeutic areas" },
    modesLabel: "Columns",
    subtitle: (count) =>
      `${count === 1 ? "The holder of the matching medicines" : `The ${formatCount(count)} holders with the most matching medicines`}; a medicine can count in several columns.`,
    holder: "Holder",
    // The therapeutic area groups beyond the top 12.
    other: "Other",
    otherTitle: "Other therapeutic area groups",
    cell: (holder, column, count) => `${holder}, ${column}: ${plural(count, "medicine", "medicines")}`,
    // A row header: the holder, then its matching medicines (shown after the name).
    holderRow: (holder, count) => `${holder}, ${plural(count, "medicine", "medicines")}`,
    note: "Holder names are shown as EMA publishes them; the same company can appear under several names.",
    // Sort buttons (toggles) in their own header row: rows by holder name ("Name"), by total ("Total",
    // the default) or by a column's count (an arrow).
    sortBy: (column) => `Sort holders by ${column}`,
    sortByName: "Sort holders by name",
    sortName: "Name",
    sortTotal: "Total",
    sortByTotal: "Sort holders by their total of matching medicines",
    // Row and column headers and cells filter the dashboard (tooltips say what a click does).
    filterBy: (label) => `Show only ${label}`,
    pressedTitle: "Shown alone: click again to clear",
    filterHint: "Filters the dashboard; select again to clear.",
    // With one ATC class selected the columns are its child classes; the class is a toggle above.
    parentLead: "Columns: classes in",
    // Column order (UI state): ATC groups by code, therapeutic areas by name, or most first.
    order: { label: "Column order", key: { atc: "Code", area: "Name" }, count: "Count" },
  },
  other: "Other",

  // "Approvals per year", stacked by medicine type, ATC class or holder (UI state).
  years: {
    undated: (count) => `${plural(count, "medicine", "medicines")} without an approval date ${count === 1 ? "is" : "are"} not shown.`,
    empty: "No dated medicines match the current filters.",
    // by: what the columns are stacked by (UI.years.by).
    summary: (first, last, total, peakYear, peakCount, by) =>
      `Stacked column chart of EMA approvals per year by ${by}, ${first} to ${last}: ` +
      `${formatCount(total)} medicines in total, most in ${peakYear} (${formatCount(peakCount)}).`,
    tooltipTitle: (year, total) => `${year}: ${plural(total, "approval", "approvals")}`,
    stack: { label: "Stack by", modes: { type: "Medicine type", atc: "ATC", mah: "Holder" } },
    // label: atcClassLabel() of the one ATC class selected, whose child classes the columns stack.
    by: { type: "medicine type", atc: "ATC group", atcIn: (label) => `ATC class in ${label}`, mah: "marketing authorization holder" },
    // How a medicine is counted in each mode (the card's note); count: the top classes or holders
    // stacked, named only when the rest are an Other segment (other).
    counting: {
      type: "each medicine counted once",
      atc: (count, other) => `a medicine with codes in several ATC classes is counted in each${other
        ? `: the ${plural(count, "class", "classes")} with the most matching medicines, the rest as Other classes`
        : ""}`,
      mah: (count, other) => `each medicine counted once${other
        ? `: the ${plural(count, "holder", "holders")} with the most matching medicines, the rest as Other holders`
        : ""}`,
    },
    note: (counting) =>
      `Year of EU marketing authorization; ${counting}. Click a year to show only that year (again for all years), or drag across the chart to select several; the approval-years slider is the keyboard path.`,
    // The segment on top of the stacks beyond the top ones.
    other: { atc: "Other classes", mah: "Other holders" },
    // One ATC class selected: its medicines coded only down to it have no child class to stack in.
    onlyCoded: (count, code) => `${plural(count, "medicine", "medicines")} coded only as ${code} ${count === 1 ? "is" : "are"} not shown.`,
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
    // Every matching medicine; undated: those without an approval date, listed last by status.
    caption: (count, undated) => {
      if (undated && undated === count) return `${plural(count, "medicine", "medicines")} without an approval date${count > 1 ? ", by status" : ""}`;
      const tail = undated ? `; the ${formatCount(undated)} without an approval date last, by status` : "";
      return `${plural(count, "medicine", "medicines")}, newest approval first${tail}`;
    },
    showMore: (next, total) => `Show next ${formatCount(next)} (of ${formatCount(total)})`,
    // The indication toggle names what it shows: stacked rows (phones) have no visible header.
    show: "Show indication",
    hide: "Hide indication",
    incomplete: "incomplete",
    incompleteTitle: "Incomplete code: fewer than 7 characters or not a valid ATC code",
    source: (source) => `Source: ${SOURCE_LABELS[source] ?? source}`,
    noBranch: "No MeSH branch matched",
  },

  // ATC filtering at every level: table badge segments, the tree, the breakdown, ladders.
  atc: {
    noName: NO_ATC_NAME,
    filterBy: (level, code, name) => `Filter by ATC level ${level}: ${namedClass(code, name)}`,
    toolbar: (code) => `ATC ${code}`,
    all: "All ATC classes",
    path: "ATC level path",
    classPath: "ATC levels of this class",
    // Tree rows, path items and bars: the class and its count of medicines (null: no count shown).
    classCount: (code, name, count) => `${namedClass(code, name)}${count === null ? "" : `, ${plural(count, "medicine", "medicines")}`}`,
    // The sidebar's ATC tree: a search (not a filter), expand buttons, checkboxes.
    find: "Find an ATC class",
    tree: "ATC classes",
    expand: (code) => `Classes in ${code}`,
    // A class under a checked one: checked and disabled.
    included: (code, name, count, ancestor) => `${UI.atc.classCount(code, name, count)}, included in ${ancestor}`,
    noMatches: "No matching ATC classes",
    // Class-name queries from older links: a filter the tree cannot show.
    nameQueries: (queries) => `Also filtering by class names matching ${queries.map((query) => `“${query}”`).join(" or ")}.`,
    // The products whose code stops at the parent class (no child class).
    incomplete: "code incomplete",
    note: "Retired codes count under the class WHO moved them to; codes EMA left incomplete are completed from the product information (SmPC) where it gives one.",
    // A code shown that differs from EMA's (atcOriginText(), atcOriginFlag()).
    origin: {
      retired: (label, year, now) => `${label}: retired${year ? ` ${year}` : ""}, now ${now}.`,
      completed: (published) => `EMA publishes ${published}; the full code is from the product information (SmPC).`,
      conflict: (published) => `EMA publishes ${published}; this code is from the product information (SmPC).`,
      smpc: "EMA publishes no ATC code; this one is from the product information (SmPC).",
    },
    originFlag: { retired: (from) => `was ${from}`, published: (code) => `EMA: ${code}`, smpc: "SmPC" },
    up: "Up one level",
    // Ladders (medicine and substance cards): counts are the medicines currently authorized, no filters.
    ladder: (code) => `ATC levels of ${code}`,
    ladderLink: (level, code, name, count) =>
      `Level ${level}, ${namedClass(code, name)}${count === null ? "" : `: ${plural(count, "authorized medicine", "authorized medicines")}`}`,
    countsHead: "Currently authorized",
    count: (count) => formatCount(count),
    classed: (names, code) => `${listing(names)} ${names.length === 1 ? "is" : "are"} classed ${code}.`,
  },

  offline: (date) => `Offline: data as of ${formatDate(date)}`,

  // The splitter on the desktop sidebar's right edge (sidebar-resize.js); hint: its tooltip.
  sidebar: {
    resize: "Resize filters",
    hint: "Drag or use the arrow keys to resize the filters; double-click to reset",
  },

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
    fullIndication: "Show full indication",
    // Another medicine with the same name (the refused and the authorized Mylotarg): a link to its
    // card, then its status; documents: the namesake's documents EMA lists under this one.
    namesake: {
      link: (name, number) => `Another medicine named ${name} (${number})`,
      authorized: (date) => ` is authorized since ${formatDate(date)}.`,
      other: (status) => `: ${statusLabel(status)}.`,
      documents: (count) => `${plural(count, "later document", "later documents")} EMA lists here ${count === 1 ? "belongs" : "belong"} to `,
      documentsLink: (name) => `the other ${name}`,
    },
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
    patents: "Patents and supplementary protection certificates: not shown (no open EU-wide source).",
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
    // The dek: the narrower conditions (links), the first few then how many more.
    narrowerLead: (count) => `Includes the narrower ${count === 1 ? "condition" : "conditions"} `,
    narrowerMore: (count) => ` and ${formatCount(count)} more`,
    textHeading: (query) => `Mentioned in indication texts: “${query}”`,
    // The tagged medicines: those tagged with the condition itself, then those tagged only with a
    // narrower one (each row says which).
    taggedOwn: (name, count) => `Tagged by EMA with ${name} (${formatCount(count)})`,
    taggedNarrower: (count) => `Tagged with a narrower condition (${formatCount(count)})`,
    rowTagged: "Tagged with ",
    alsoMentioned: "Also mentioned in indication text",
    mentioned: "Mentioned in indication text",
    showAll: "Show all statuses",
    none: "None.",
    relatedConditions: "Matching conditions",
  },

  // Condition, indication-text and substance results: a table, one row per medicine (lookup.js
  // resultTable()); the name opens its card.
  results: {
    headers: ["Medicine", "ATC", "Approved · Status", "Type", "Holder"],
    // Substance cards: what each medicine is for, after the Medicine column.
    areas: "Therapeutic area",
  },

  timeline: {
    caption: "One dot per medicine; lines join medicines with the same active substances (reference, generics, biosimilars). Tap or point at a dot for its name.",
    // Condition pages: medicines found only in indication texts (hollow dots), and the dot's tooltip line.
    hollow: "Hollow dots: only mentioned in the indication text.",
    mentioned: "Only mentioned in the indication text",
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
    intendedUse: "Informational only: not medical or legal advice; not a medical device. Data can lag EMA.",
    privacy:
      "No cookies, no analytics, no tracking. Searches run in your browser. The site is hosted on GitHub Pages; GitHub may log IP addresses and page addresses, which include your search when a page is reloaded or opened from a link. Offline mode stores only this site's files and data on your device.",
    security: "Security policy and how to report a vulnerability (GitHub)",
  },
};
