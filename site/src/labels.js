// The one display map: raw EMA values -> U.S. labels, plus all UI copy written from JS.
// Raw values stay unchanged in the data and the URL. WHO ATC names (all levels) are displayed in
// title case (atcDisplayName(); user decisions 2026-09-26 and 2026-09-27). No em-dashes in UI copy.

const formatCount = new Intl.NumberFormat("en-US").format;
const formatPercent = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format;
const plural = (count, one, many) => `${formatCount(count)} ${count === 1 ? one : many}`;
// A curated copy's copy_type (ema_curated_copies.json) as a word; "copy" for a type not known here.
const copyTypeWord = (type) => ({ hybrid: "hybrid", generic: "generic", biosimilar: "biosimilar" })[type] ?? "copy";

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

// A status with EMA's opinion when that opinion was negative (step 2, #11: not a pending one), for
// the search's meta line and the medicine card's answer strip; opinion: ema_medicines
// opinion_status, null until that file has loaded.
export function statusOpinionLabel(status, opinion) {
  return status === "Opinion" && opinion === "Negative" ? "Opinion (negative)" : statusLabel(status);
}

// One medicine's status explanation (UI.statusTips), its own for a negative opinion (user decision
// 2026-09-28); opinion: as statusOpinionLabel(). Null for a status without one.
export function statusTipText(status, opinion = null) {
  if (status === "Opinion" && opinion === "Negative") return UI.negativeOpinionTip;
  return UI.statusTips[status] ?? null;
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
// approvals.js) and, for opinions, EMA's opinion status. Nothing is inferred. Step 4: an authorized
// medicine's sentence names a conditional authorization or exceptional circumstances (#9; flags: a
// search-index or ema_medicines row, null while unknown), and a positive opinion how many days the
// EU decision usually takes (#12; decision: meta.json opinion_to_decision as { median, p90 } days,
// null in older data) and, once past that, how long it has waited by the data's date (asOf).
export function statusSentence(status, date, opinion, { decision = null, asOf = null, flags = null } = {}) {
  if (statusKind(status) === "authorized") {
    if (flags?.conditional_approval === true) return UI.card.qualifiers.conditional_approval;
    return flags?.exceptional_circumstances === true ? UI.card.qualifiers.exceptional_circumstances : null;
  }
  const on = date ? ` on ${formatDate(date)}` : "";
  if (status === "Opinion under re-examination") {
    return opinion === "Negative" ? `Negative opinion${on}; under re-examination at the company's request.` : "Opinion under re-examination; not yet authorized.";
  }
  if (status === "Opinion") {
    if (opinion === "Negative") return `Negative opinion${on}.`;
    const sentence = `${opinion === "Positive" ? "Positive opinion" : "Opinion adopted"}${on}; not yet authorized.`;
    if (opinion !== "Positive" || !decision) return sentence;
    // ISO dates parse as UTC midnight, so the difference is whole days.
    const waited = date && asOf ? Math.round((Date.parse(asOf) - Date.parse(date)) / 86400000) : null;
    return [
      sentence,
      UI.card.decisionUsually(decision.median),
      waited !== null && waited > decision.median ? UI.card.waited(waited, decision.p90 !== null && waited > decision.p90) : null,
    ].filter(Boolean).join(" ");
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
  curated: "checked by hand (WHO ATC index, WHO temporary list or SmPC text)",
  chembl_atc_class: "ChEMBL",
};

// atc.js atcOrigin() -> the sentence saying how the code shown differs from EMA's published one
// (null: it does not). names: code -> WHO name; years: retired code -> the year WHO retired it.
export function atcOriginText(origin, names, years) {
  if (!origin) return null;
  const copy = UI.atc.origin;
  if (origin.kind === "retired") return copy.retired(atcClassLabel(origin.from, names.get(origin.from)), years.get(origin.from) ?? null, origin.now);
  if (origin.kind === "curated") return copy.curated(origin.published, origin.conflict, origin.evidence);
  return origin.kind === "smpc" ? copy.smpc : copy[origin.kind](origin.published);
}

// The same as a short flag beside the badge (the sentence is its tooltip).
export function atcOriginFlag(origin) {
  if (!origin) return null;
  const copy = UI.atc.originFlag;
  if (origin.kind === "retired") return copy.retired(origin.from);
  if (origin.kind === "curated" && !origin.published) return copy.curated[origin.evidence] ?? copy.curated.other;
  return origin.kind === "smpc" ? copy.smpc : copy.published(origin.published);
}

// URL value and label for the medicines whose holder field is empty.
export const NOT_STATED = "Not stated";

// Headline parts: plain strings, or { text, tone } for the words the page colors
// (tone "number": counts in the accent; "negative": the "not" of "not authorized"; "aside": a
// closing qualifier on a line of its own in smaller type, so the answer stays short on a phone).
const number = (count) => ({ text: formatCount(count), tone: "number" });
const NOT = { text: "not", tone: "negative" };
const NOT_YET = { text: "not yet", tone: "pending" };

// "a, b and c".
const listing = (items) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items[0]);
// A curated note (a fragment) as a sentence: one full stop at the end.
const sentenceOf = (text) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

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
  // Under the wordmark, always shown (landing, user-approved design 2026-09-28): what the site is for.
  tagline: "Heard of a drug at a talk, a poster or anywhere? Look it up in seconds: EU approval, what it's for, who owns it, how long it's protected.",
  // The scope (step 2, #1): EMA's central procedure, every status; national authorizations are not in
  // it. The header shows it alone until the data's date is known.
  scopeLine: "Human medicines, EMA central procedure",
  dataDate: (date) => `${UI.scopeLine} · data as of ${formatDate(date)}`,
  // The landing intro card (intro.js): on the untouched overview (no lookup, no filter) until the
  // viewer closes it; the header's link brings it back.
  intro: {
    link: "What is this?",
    // The card's heading (visually hidden; the link's text, so the link and its target agree).
    title: "What is this?",
    close: "Close the introduction",
    closeHint: "Close; “What is this?” at the top brings it back",
    lookupLead: "Look up a drug or active ingredient to see:",
    lookup: [
      "whether it's approved in the EU and since when",
      "what it's approved for",
      "which company owns it",
      "how long its market protection runs (an estimate, not patents)",
      "its official product information and EMA assessment report",
    ],
    // Phones: the summary of a disclosure holding the list below (intro.js).
    exploreLead: "Or explore all EMA medicines:",
    explore: [
      "which companies have which kinds of drugs",
      "which conditions have the most, or the fewest, approved treatments",
      "how approvals changed over the years, by drug class, condition or company",
    ],
    scope: "Only medicines authorized EU-wide through the European Medicines Agency (EMA) are included. Many older or common medicines, such as paracetamol, are authorized country by country and are not here.",
    authorized: "Authorized means it may be marketed in the EU, Iceland, Liechtenstein and Norway; whether it is sold or reimbursed in your country is decided nationally.",
    smallPrint: "Data from EMA, updated daily. For information only, not medical advice.",
  },
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
      // Before the modality token (M2 phase 2): "Showing [all medicine types] with [all modalities] in …".
      withModality: " with ",
      // After a year range: the medicines never approved are no longer counted.
      undatedOut: " (medicines without an approval date left out)",
    },
    // The year token without a year filter (it focuses the approval-years slider).
    anyYear: "any year",
    defaults: {
      type: "all medicine types",
      atc: "all ATC classes",
      mah: "all companies",
      area: "all therapeutic areas",
      status: "any status",
      mod: "all modalities",
    },
    many: {
      type: (count) => plural(count, "medicine type", "medicine types"),
      mod: (count) => plural(count, "modality", "modalities"),
      atc: (count) => plural(count, "ATC class", "ATC classes"),
      mah: (count) => plural(count, "company", "companies"),
      area: (count) => plural(count, "therapeutic area", "therapeutic areas"),
      status: (count) => plural(count, "status", "statuses"),
    },
    atcName: (query) => `ATC classes matching “${query}”`,
    status: (label) => `status ${label}`,
    // The filter each token (sentenceParts() key) belongs to, for its accessible name.
    dimensions: {
      type: "medicine type",
      atc: "ATC class",
      mah: "company",
      area: "therapeutic area",
      from: "start year",
      to: "end year",
      years: "approval years",
      // One approval year: a single token for both ends.
      year: "approval year",
      status: "status",
      mod: "modality",
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
    titles: { all: "Filters" },
  },
  allYears: "All years",
  yearRange: (from, to) => (from === to ? `${from}` : `${from}–${to}`),
  // The approval-years strip in the main column: a slim one-colour histogram of every medicine with
  // an approval date (aria-hidden; the summary is read instead; a tooltip per bar,
  // UI.years.tooltipTitle()) above a two-thumb slider.
  yearStrip: {
    start: "Start year",
    end: "End year",
    summary: (first, last, total, peakYear, peakCount) => (total === 0
      ? "No medicines with an approval date match the other filters."
      : `Column chart of approvals per year, ${first} to ${last}, of the medicines matching the other filters: ` +
        `${formatCount(total)} in total, most in ${peakYear} (${formatCount(peakCount)}).`),
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
    // Only one therapeutic area is selected, no other filter (phase 4g): named as atcClass names its
    // class, its levels below. tag: a tag matched at a branch root (older links: ?area=Neoplasms).
    area: (total, authorized, name, tag = false) => {
      const place = `${tag ? "tagged" : "in"} ${name}`;
      return total === 0
        ? [`No medicines in the EMA data are ${place}.`]
        : [number(total), ` ${total === 1 ? "medicine" : "medicines"} ${place}`, ...currentlyAuthorized(total, authorized)];
    },
    // kind: statusKind(); an opinion without a decision yet is "not yet" authorized, unless it was
    // negative (opinion: ema_medicines opinion_status; step 2, #11): then "not".
    medicine: (name, kind, opinion = null) => {
      if (kind === "authorized") return [`${name} is authorized in the EU.`];
      return [`${name} is `, kind === "pending" && opinion !== "Negative" ? NOT_YET : NOT, " authorized in the EU."];
    },
    // Substance names stay as in the data (lower-case INN) except for the first letter. Step 2 (#1):
    // the data holds EMA's central procedure only, so a substance with no medicine there (celecoxib)
    // can still be authorized nationally.
    substance: (name, count) => (count > 0
      ? [`${capitalize(name)} is authorized EU-wide through EMA in `, number(count), ` ${count === 1 ? "medicine" : "medicines"}.`]
      : [`${capitalize(name)}: `, { text: "no medicine", tone: "negative" }, " is currently authorized through EMA ",
        { text: "(national authorizations are not included).", tone: "aside" }]),
    // EMA's therapeutic-area tags (not indications); narrower: the count includes medicines tagged
    // with a narrower condition (Psoriasis: Arthritis, Psoriatic). The name is a part of its own
    // (tone "term", no style of its own), which carries its MeSH explainer (lookup.js).
    condition: (name, count, narrower) => {
      const what = ["tagged by EMA with ", { text: name, tone: "term" }, `${narrower ? " or a narrower condition" : ""}.`];
      return count > 0
        ? [number(count), ` authorized ${count === 1 ? "medicine is" : "medicines are"} `, ...what]
        : ["No authorized medicines are ", ...what];
    },
  },
  kicker: { medicine: "Medicine", substance: "Substance", condition: "Condition", text: "Indication text", company: "Company" },

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
    // Step 3 (#7, d): not "a new active substance", which Wegovy, Rybelsus and Kyinsu are not.
    Other: "Not a generic, biosimilar or advanced therapy.",
  },
  // The same for the EMA statuses (keys: raw EMA values), wherever a status dot or pill, facet row,
  // "Stack by Status" legend entry or the sentence's status token names one; at most 10 words.
  statusTips: {
    // Step 2 (#16): authorized is not available or reimbursed everywhere.
    Authorised: "Can be marketed EU-wide; availability and reimbursement vary by country.",
    Opinion: "EMA has given its opinion; EU decision pending.",
    "Opinion under re-examination": "EMA is re-examining its opinion at the company's request.",
    Refused: "The EU refused authorization.",
    "Application withdrawn": "The company withdrew its application before a decision.",
    "Withdrawn from rolling review": "The company stopped the early (rolling) review.",
    Withdrawn: "Authorization withdrawn, usually at the company's request.",
    Expired: "Authorization not renewed.",
    Lapsed: "Authorization ended: not marketed for 3 years.",
    Suspended: "Authorization temporarily suspended.",
    Revoked: "Authorization canceled by the EU.",
  },
  // A medicine's status Opinion when EMA's opinion was negative (statusTipText(); user decision
  // 2026-09-28), on its dots and pills; at most 10 words.
  negativeOpinionTip: "EMA recommended refusal; no EU decision published yet.",
  // Sort controls (breakdown, activity rows and columns): a second click on the one in force
  // reverses it; counts sort most first, names and codes A to Z. name(): a control's name, its
  // visible text then the order in force (direction null: not in force).
  sortOrder: {
    count: { desc: "most first", asc: "fewest first" },
    key: { asc: "A to Z", desc: "Z to A" },
    // The breakdown's therapeutic areas in MeSH tree order ("MeSH"), or reversed.
    tree: { asc: "tree order", desc: "tree order reversed" },
    name: (text, kind, direction) => (direction ? `${text}, ${UI.sortOrder[kind][direction]}` : text),
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
      "atcddd.fhi.no": "WHOCC website",
      "search.gleif.org": "GLEIF website",
      // A medicine's modality source (M2 phase 2): its ChEMBL record, a curated row's PubMed evidence.
      "www.ebi.ac.uk": "ChEMBL website",
      "pubmed.ncbi.nlm.nih.gov": "PubMed",
      // Evidence of the companies' ownership, sponsor and group notes (companies provenance; every
      // host in companies.json, ema_medicine_companies.json and R/curated-companies.R on 2026-09-28,
      // and Business Wire).
      "en.wikipedia.org": "Wikipedia",
      "www.sec.gov": "SEC website",
      "www.prnewswire.com": "PR Newswire",
      "www.globenewswire.com": "GlobeNewswire",
      "www.businesswire.com": "Business Wire",
      "clinicaltrials.gov": "ClinicalTrials.gov",
      "www.nasdaq.com": "Nasdaq website",
      "www.biospace.com": "BioSpace",
      "www.ansa.it": "ANSA website",
      "www.indiaratings.co.in": "India Ratings website",
      "www.essonne.fr": "Essonne department website",
      "english.autoriteitnvs.nl": "ANVS website",
      "advenchen.com": "Advenchen website",
      "www.amgen.com": "Amgen website",
      "www.berlin-chemie.de": "Berlin-Chemie website",
      "www.boehringer-ingelheim.com": "Boehringer Ingelheim website",
      "www.gsk.com": "GSK website",
      "investor.jazzpharma.com": "Jazz Pharmaceuticals website",
      "johnsonandjohnson.gcs-web.com": "Johnson & Johnson website",
      "www.krka.biz": "Krka website",
      "mabxience.com": "mAbxience website",
      "www.menarini.com": "Menarini website",
      "investor.mylan.com": "Mylan website",
      "www.novartis.com": "Novartis website",
      "ir.orchard-tx.com": "Orchard Therapeutics website",
      "www.organon.com": "Organon website",
      "investor.perrigo.com": "Perrigo website",
      "www.pfizer.com": "Pfizer website",
      "www.sandoz.com": "Sandoz website",
      "sentynl.com": "Sentynl website",
      "www.shionogi.com": "Shionogi website",
      "ir.tevapharm.com": "Teva website",
      "www.teva.de": "Teva Germany website",
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
      // Drilled into an area (phase 4f, as the ATC breakdown); a leaf shows only itself.
      titleIn: (name) => `Medicines in ${name} by therapeutic area`,
      // tag: a tag matched at a branch root (UI.areas.tag()).
      titleLeaf: (name, tag = false) => `Medicines ${tag ? "tagged" : "in"} ${name}`,
      note: "A medicine can appear in several areas.",
      excluded: (count) => `${plural(count, "medicine", "medicines")} without a therapeutic area ${count === 1 ? "is" : "are"} not shown.`,
    },
    // Companies by current owner (companies part 2): the groups, a group's companies (its holder
    // names when its one company has its name), a company's holder names; byHolder: the bars are
    // holder names. Medicines without a holder have no company.
    mah: {
      title: "Medicines by company",
      titleIn: (name, byHolder) => `Medicines of ${name} by ${byHolder ? "EMA holder name" : "company"}`,
      titleLeaf: (name) => `Medicines of ${name}`,
      note: "Companies by current owner; each bar lists the holder names EMA publishes in its tooltip.",
      excluded: (count) => `${plural(count, "medicine", "medicines")} without a holder ${count === 1 ? "is" : "are"} not shown.`,
    },
    // Modality (M2 phase 2): the groups (the medicines not classified a static last row), a group's
    // modalities (its medicines no source names the modality of a static last row); a modality, or
    // Small molecule, shows only itself.
    mod: {
      title: "Medicines by modality group",
      titleIn: (name) => `Medicines in ${name} by modality`,
      titleLeaf: (name) => `Medicines in ${name}`,
      note: "A medicine whose substances have several modalities appears in each.",
    },
    empty: "No medicines match the current filters.",
    // Bar order (UI state): most first, or ATC classes by code, areas in MeSH tree order (owner
    // request 2026-09-28, as the tree), modalities in tree order and holders by name.
    sort: { label: "Sort", count: "Count", key: { atc: "Code", area: "MeSH", mah: "Name", mod: "Tree" } },
    // A stacked ATC bar's medicine types: [[type, count]] in stack order.
    typeSplit: (entries) => entries.map(([type, count]) => `${formatCount(count)} ${type}`).join(", "),
  },
  // The therapeutic areas of the medicines shown (all of them without a filter); each opens its
  // condition page (a lookup, ?cond=) where its MeSH descriptor is known.
  conditions: {
    title: "Most common conditions",
    // Each row counts every status, then the authorized ones (the list a condition page opens with)
    // and their distinct active substances (step 4, #10: substance sets, so a combination counts on
    // its own and the copy says so; review of step 4: HIV Infections has 40 sets of 27 substances).
    // within: a therapeutic area filter is set, and only the terms within it are listed.
    subtitle: (count, filtered, within = false) => `${filtered
      ? `Therapeutic areas of the ${plural(count, "medicine", "medicines")} matching the filters`
      : `Therapeutic areas of all ${plural(count, "medicine", "medicines")} in the EMA data`}${within ? ", within the selected areas" : ""}: medicines of every status, then those authorized and their active substances or combinations`,
    authorized: (count) => `${formatCount(count)} authorized`,
    substances: (count) => plural(count, "active substance or combination", "active substances or combinations"),
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
      `${count === 1 ? "The company of the matching medicines" : `The ${formatCount(count)} companies with the most matching medicines`}; a medicine can count in several columns.`,
    holder: "Company",
    // The therapeutic areas beyond the top 12.
    other: "Other",
    otherTitle: "Other therapeutic areas",
    cell: (holder, column, count) => `${holder}, ${column}: ${plural(count, "medicine", "medicines")}`,
    // A row header: the company, then its matching medicines (shown after the name), then the
    // holder names EMA publishes for them (names: UI.companies.legalNames(); companies part 2).
    holderRow: (holder, count, names = null) => `${holder}, ${plural(count, "medicine", "medicines")}${names ? `: ${names}` : ""}`,
    // Rows are company groups (companies part 2); date: their curation date.
    note: (date) => `Companies by current owner${date ? ` as of ${formatDate(date)}` : ""}; each row lists the holder names EMA publishes in its tooltip.`,
    // Sort buttons (toggles) in their own header row: rows by holder name ("Name"), by total ("Total",
    // the default) or by a column's count (an arrow).
    sortBy: (column) => `Sort companies by ${column}`,
    sortByName: "Sort companies by name",
    sortName: "Name",
    sortTotal: "Total",
    sortByTotal: "Sort companies by their total of matching medicines",
    // Row and column headers and cells filter the dashboard (tooltips say what a click does).
    filterBy: (label) => `Show only ${label}`,
    pressedTitle: "Shown alone: click again to clear",
    filterHint: "Filters the dashboard; select again to clear.",
    // With one ATC class selected the columns are its child classes; the class is a toggle above.
    // The same for one therapeutic area (phase 4f).
    parentLead: "Columns: classes in",
    parentLeadArea: "Columns: areas in",
    // Column order (UI state): ATC groups by code, therapeutic areas by name, or most first.
    order: { label: "Column order", key: { atc: "Code", area: "Name" }, count: "Count" },
  },
  other: "Other",

  // "Approvals per year", stacked by medicine type, ATC class, holder or status (UI state).
  years: {
    undated: (count) => `${plural(count, "medicine", "medicines")} without an approval date ${count === 1 ? "is" : "are"} not shown.`,
    // Stacked by status: the statuses the chart cannot show. ranged: a year filter is set, which
    // leaves them out of the dashboard's counts too.
    undatedStatuses: (count, ranged = false) =>
      `${plural(count, "medicine", "medicines")} without an approval date (refused, application withdrawn, pending…) ${count === 1 ? "is" : "are"} not in this chart${ranged ? ", and the year filter leaves them out of every count" : ""}.`,
    // Before the legend (in stack order): position tells the segments apart, not only colour.
    legendLead: "Bottom to top:",
    empty: "No dated medicines match the current filters.",
    // by: what the columns are stacked by (UI.years.by).
    summary: (first, last, total, peakYear, peakCount, by) =>
      `Stacked column chart of EMA approvals per year by ${by}, ${first} to ${last}: ` +
      `${formatCount(total)} medicines in total, most in ${peakYear} (${formatCount(peakCount)}).`,
    tooltipTitle: (year, total) => `${year}: ${plural(total, "approval", "approvals")}`,
    stack: { label: "Stack by", modes: { type: "Medicine type", atc: "ATC", mah: "Company", status: "Status", mod: "Modality" } },
    // label: atcClassLabel() of the one ATC class selected, whose child classes the columns stack;
    // name: the one modality group selected, whose modalities the columns stack.
    by: {
      type: "medicine type", atc: "ATC group", atcIn: (label) => `ATC class in ${label}`, mah: "company", status: "current status",
      mod: "modality group", modIn: (name) => `modality in ${name}`,
    },
    // How a medicine is counted in each mode (the card's note); count: the top classes or holders
    // stacked, named only when the rest are an Other segment (other).
    counting: {
      type: "each medicine counted once",
      atc: (count, other) => `a medicine with codes in several ATC classes is counted in each${other
        ? `: the ${plural(count, "class", "classes")} with the most matching medicines, the rest as Other classes`
        : ""}`,
      mah: (count, other) => `each medicine counted once${other
        ? `: the ${plural(count, "company", "companies")} with the most matching medicines, the rest as Other companies`
        : ""}`,
      status: "each medicine counted once, by its current status",
      mod: "a medicine whose substances have several modalities is counted in each",
    },
    // Step 4 (#17): EMA's annual reports count CHMP opinions (by the opinion's year), so their totals differ.
    note: (counting) =>
      `Year of EU marketing authorization; ${counting}. EMA's annual reports count CHMP opinions instead, so their yearly totals differ. Click a year to show only that year (again for all years), or drag across the chart to select several; the approval-years slider is the keyboard path.`,
    // The segment on top of the stacks beyond the top ones.
    other: { atc: "Other classes", mah: "Other companies" },
    // The segment on top for the medicines a mode cannot place, so every mode gives the same yearly
    // totals: no ATC code; with one ATC class selected, coded only down to it; no company.
    unplaced: { atc: "No ATC code", atcIn: (code) => `Coded only as ${code}`, mah: "No company", mod: "No modality" },
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
      "Company · Holder",
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

  // "Download CSV" by the medicines table (#18, csv.js): every medicine the table lists. The first
  // line acknowledges EMA (its reuse terms) and the WHOCC (the ATC codes; its terms require the
  // reference, and the file travels without the site's footer; review of step 4) as one cell a tool
  // can skip as a comment, so it has no comma or quote; codes, never WHO's ATC names (not ours to
  // redistribute).
  csv: {
    button: "Download CSV",
    source: (date) =>
      `# Source: European Medicines Agency (EMA) medicines data as of ${date} (https://www.ema.europa.eu/en/medicines/download-medicine-data). © EMA. ` +
      "ATC codes © WHO Collaborating Centre for Drug Statistics Methodology (https://atcddd.fhi.no); not for commercial distribution. " +
      "Exported from Approval Atlas: company groups and some ATC codes are its additions; the compilation is licensed CC BY-SA 4.0 and values from other sources keep their own terms. " +
      "Not affiliated with or endorsed by EMA.",
    headers: [
      "EMA product number", "Medicine", "Active substances", "Status", "Approval date", "Medicine type", "Orphan",
      "Company group", "Holder (EMA)", "ATC codes", "Therapeutic areas",
    ],
    yes: "Yes",
    no: "No",
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
    // The same when their codes are complete there (phase 4e, atc_final_level: B03AC, which WHO
    // does not subdivide; J07BX03, which WHO moved up to J07BN).
    codedHere: "coded at this level",
    note: "Retired codes count under the class WHO moved them to; codes EMA left incomplete are completed from the product information (SmPC) where it gives one, else from WHO's ATC index, WHO's temporary list or the SmPC text, checked by hand.",
    // A code shown that differs from EMA's (atcOriginText(), atcOriginFlag()).
    origin: {
      retired: (label, year, now) => `${label}: retired${year ? ` ${year}` : ""}, now ${now}.`,
      completed: (published) => `EMA publishes ${published}; the full code is from the product information (SmPC).`,
      conflict: (published) => `EMA publishes ${published}; this code is from the product information (SmPC).`,
      smpc: "EMA publishes no ATC code; this one is from the product information (SmPC).",
      // Curated (phase 4e: checked by hand; evidence: atcOrigin()); published null: EMA has none.
      curated: (published, conflict, evidence) => `${published
        ? `EMA publishes ${published}; ${conflict ? "this code" : "the full code"}`
        : "EMA publishes no ATC code; this one"} was added from ${UI.atc.evidence[evidence] ?? UI.atc.evidence.other}.`,
    },
    originFlag: {
      retired: (from) => `was ${from}`,
      published: (code) => `EMA: ${code}`,
      smpc: "SmPC",
      curated: { whocc_index: "WHO index", whocc_temporary: "WHO temporary", ema_smpc_text: "SmPC text", other: "curated" },
    },
    // Where a curated code was checked, in running text and as the medicine card's evidence link.
    evidence: {
      whocc_index: "the WHO ATC index",
      whocc_temporary: "WHO's temporary list (it can still change)",
      ema_smpc_text: "the SmPC text",
      other: "a source checked by hand",
    },
    evidenceLink: {
      whocc_index: "WHO ATC index page",
      whocc_temporary: "WHO temporary list (Excel)",
      ema_smpc_text: "Product information (SmPC)",
      other: "Evidence",
    },
    up: "Up one level",
    // Ladders (medicine and substance cards): counts are the medicines currently authorized, no filters.
    ladder: (code) => `ATC levels of ${code}`,
    ladderLink: (level, code, name, count) =>
      `Level ${level}, ${namedClass(code, name)}${count === null ? "" : `: ${plural(count, "authorized medicine", "authorized medicines")}`}`,
    countsHead: "Currently authorized",
    count: (count) => formatCount(count),
    classed: (names, code) => `${listing(names)} ${names.length === 1 ? "is" : "are"} classed ${code}.`,
  },

  // The therapeutic-area tree (phase 4f; areas.js, area-tree.js): MeSH branch › level 2 › level 3 ›
  // EMA's terms, in the sidebar, the breakdown's path and the activity card.
  areas: {
    find: "Find a therapeutic area",
    tree: "Therapeutic areas",
    expand: (name) => `Areas in ${name}`,
    // Rows, path items: the area and its count of medicines.
    count: (name, count) => `${name}, ${plural(count, "medicine", "medicines")}`,
    // An area under a checked one (on some path): checked and disabled.
    included: (name, count, ancestor) => `${UI.areas.count(name, count)}, included in ${ancestor}`,
    noMatches: "No matching therapeutic areas",
    // The medicines tagged with the node's own term: a static last row.
    notMoreSpecific: "not more specific",
    // A branch's static last row (phase 4g): the medicines tagged only with its root tags (tags: the
    // heading first, "Neoplasms", then its entry terms, "Cancer").
    taggedOnly: (tags) => `Tagged only as ${tags.length > 1 ? `${tags.slice(0, -1).join(", ")} or ${tags.at(-1)}` : tags[0]}`,
    // The one-area headline's level path (phase 4g).
    classPath: "Levels of this therapeutic area",
    // A tag matched at a branch root selected on its own (older links: ?area=Neoplasms filters the
    // medicines tagged Neoplasms, not the branch): its name wherever it shows (areas.js label()),
    // and the tree's note, as its branch row is only indeterminate.
    tag: (name) => `tagged ${name}`,
    tagNote: (tags) => `Also filtering by the ${tags.length === 1 ? "tag" : "tags"} ${tags.map((tag) => `“${tag}”`).join(" or ")}.`,
    note: "MeSH branches and their first two levels, then EMA's terms. A medicine counts in every area it is tagged with or under, so the areas below one need not add up to it.",
    all: "All therapeutic areas",
    path: "Therapeutic area path",
  },

  // Modality (M2 phase 2, spec 2026-09-29; modalities.js): group › modality. Names (U.S. spelling;
  // "kind", as "type" is the medicine type) and explainers of at most 12 words, keyed by the
  // taxonomy's keys (modalities.json); the peptide explainer has no amino-acid limit (user decision
  // 2026-09-29).
  modalities: {
    small_molecule: "Small molecule",
    protein: "Protein and peptide",
    peptide: "Peptide",
    hormone_cytokine: "Hormone, cytokine or growth factor",
    enzyme: "Enzyme",
    coagulation_factor: "Coagulation factor",
    fusion_protein: "Fusion protein",
    other_protein: "Other protein",
    antibody: "Antibody",
    monoclonal_antibody: "Monoclonal antibody",
    adc: "Antibody-drug conjugate",
    bispecific_antibody: "Bispecific antibody",
    antibody_fragment: "Antibody fragment",
    polyclonal_immunoglobulin: "Polyclonal immunoglobulin",
    nucleic_acid: "Nucleic acid",
    mrna: "mRNA",
    sirna: "siRNA",
    antisense: "Antisense oligonucleotide",
    aptamer: "Aptamer",
    other_oligonucleotide: "Other oligonucleotide",
    cell_gene: "Cell and gene therapy",
    car_t: "CAR-T cell therapy",
    gene_modified_cells: "Gene-modified cell therapy",
    gene_therapy: "Gene therapy",
    other_cell_therapy: "Other cell therapy",
    tissue_engineered: "Tissue-engineered product",
    vaccine: "Vaccine",
    live_vaccine: "Live attenuated vaccine",
    inactivated_vaccine: "Inactivated or subunit vaccine",
    vector_vaccine: "Viral vector vaccine",
    radiopharmaceutical: "Radiopharmaceutical",
    diagnostic_radiopharmaceutical: "Diagnostic radiopharmaceutical",
    therapeutic_radiopharmaceutical: "Therapeutic radiopharmaceutical",
    other: "Other",
    allergen: "Allergen extract",
    polysaccharide: "Heparin or polysaccharide",
    plant_extract: "Plant extract",
    polymer: "Polymer",
  },
  modalityTips: {
    small_molecule: "Chemically made drug with a small, well-defined structure.",
    protein: "Chain of amino acids, made by living cells or synthesis.",
    peptide: "Short chain of amino acids, often made by synthesis, such as semaglutide.",
    hormone_cytokine: "Natural signaling protein made in the lab, such as insulin.",
    enzyme: "Protein that speeds up a chemical reaction, often replacing a missing one.",
    coagulation_factor: "Blood-clotting protein, such as factor VIII or fibrinogen.",
    fusion_protein: "Two proteins joined into one, often with an antibody part.",
    other_protein: "Protein medicine that fits none of the kinds above.",
    antibody: "Immune protein that binds a precise target.",
    monoclonal_antibody: "Lab-made antibody that binds one target.",
    adc: "Antibody that carries a cell-killing drug or toxin to its target.",
    bispecific_antibody: "Antibody built to bind two different targets at once.",
    antibody_fragment: "Smaller piece of an antibody that still binds its target.",
    polyclonal_immunoglobulin: "Mix of many antibodies purified from human or animal blood.",
    nucleic_acid: "Strand of RNA or DNA that changes which proteins cells make.",
    mrna: "Messenger RNA that instructs cells to make a protein.",
    sirna: "Short double-stranded RNA that silences one gene.",
    antisense: "Short single strand that binds one RNA to block or fix it.",
    aptamer: "Folded nucleic acid strand that binds a target like an antibody.",
    other_oligonucleotide: "Nucleic acid medicine that fits none of the kinds above.",
    cell_gene: "Advanced therapy made from living cells, tissue or genes.",
    car_t: "Patient's T cells engineered to find and kill cancer cells.",
    gene_modified_cells: "Cells given a new or edited gene outside the body.",
    gene_therapy: "Virus or DNA that carries a working gene into the body.",
    other_cell_therapy: "Living cells, not genetically modified, given as a treatment.",
    tissue_engineered: "Cells grown into tissue that repairs or replaces damaged tissue.",
    vaccine: "Trains the immune system against a germ; mRNA vaccines are under mRNA.",
    live_vaccine: "Weakened live germ that trains immunity without causing disease.",
    inactivated_vaccine: "Killed germ or purified germ parts; cannot cause the infection.",
    vector_vaccine: "Harmless virus carrying a gene for one of the germ's proteins.",
    radiopharmaceutical: "Medicine with a radioactive atom, used for scans or treatment.",
    diagnostic_radiopharmaceutical: "Radioactive tracer that shows disease on a scan.",
    therapeutic_radiopharmaceutical: "Carries radiation to diseased cells to destroy them.",
    other: "Kinds outside the groups above, such as allergen extracts.",
    allergen: "Allergen given in rising doses to calm an allergy.",
    polysaccharide: "Chain of sugar units, such as heparin.",
    plant_extract: "Extract of a plant, such as birch bark.",
    polymer: "Large synthetic chain of repeating units, such as sevelamer.",
  },
  // The modality tree (sidebar, sheet; modality-tree.js), the breakdown's path and the medicine and
  // substance cards' Modality line.
  modality: {
    label: "Modality",
    find: "Find a modality",
    tree: "Modalities",
    expand: (name) => `Kinds of ${name}`,
    // Rows, path items: the group or modality and its count of medicines.
    count: (name, count) => `${name}, ${plural(count, "medicine", "medicines")}`,
    included: (name, count, group) => `${UI.modality.count(name, count)}, included in ${group}`,
    noMatches: "No matching modalities",
    // Static rows (count only, user decision 2026-09-29): a group's medicines no source names the
    // modality of, and the medicines no source classifies; each with its explainer.
    notMoreSpecific: "not more specific",
    groupOnly: (name) => `${name}, not more specific`,
    groupOnlyTip: "Our sources name the group, not the exact modality.",
    notClassified: "Not classified",
    notClassifiedTip: "No source we use states its modality yet.",
    note: "Groups, then the kinds in each, from WHO INN stems, ChEMBL, EMA data and checks by hand. A medicine counts in every modality of its substances.",
    all: "All modalities",
    path: "Modality path",
    // The card's source line: the group's source, then the kind's when another source named it.
    source: "Source: ",
    kindFrom: "; kind from ",
    sources: {
      stem: (stem) => `WHO INN stem “${stem}”`,
      innGroup: (name) => `WHO INN group “${name}”`,
      radionuclide: (nuclide) => `Radionuclide in its INN (${nuclide})`,
      // A Greek letter as the INN's second word (ATryn's "antithrombin alfa"): WHO names proteins so.
      greek: (letter) => `WHO INN naming of proteins (Greek letter “${letter}”)`,
      chembl: (id, release) => `ChEMBL ${id}${release ? ` (${release})` : ""}`,
      chemblType: (type) => `ChEMBL molecule type “${type}”`,
      atc: (label) => `WHO ATC class ${label}`,
      atmp: "EMA: advanced therapy medicinal product",
      text: (detail) => `EMA text “${detail}”`,
      // After the evidence's link: "Source: EPAR public assessment report (checked by hand)".
      curated: " (checked by hand)",
      curatedNoLink: "Checked by hand",
    },
    // A curated row's evidence, by the document its link opens (modalities.js evidenceDocument()).
    documents: {
      productInformation: "Product information (SmPC)",
      epar: "EPAR public assessment report",
      refusal: "Refusal assessment report",
      withdrawalReport: "Withdrawal assessment report",
      scientificDiscussion: "Scientific discussion",
      questionsAnswers: "EMA questions and answers",
      summaryOfOpinion: "CHMP summary of opinion",
      medicinePage: "EMA medicine page",
      pubmed: (id) => `PubMed ${id}`,
      chembl: (id) => `ChEMBL ${id}`,
    },
  },

  // MeSH explainers of the therapeutic areas (owner request 2026-09-28; mesh-notes.js): a tooltip
  // wherever a term or tree node shows, "{name} (MeSH {tree numbers}): {the scope note's lead}"
  // (three numbers, then how many more), and on a condition page NLM's full scope note with its
  // tree numbers and the credit NLM asks for (the MeSH version: meta.json).
  mesh: {
    tip: (name, numbers, lead) => `${name}${numbers.length ? ` (MeSH ${UI.mesh.numbers(numbers)})` : ""}: ${lead}`,
    numbers: (numbers) => (numbers.length > 3 ? `${numbers.slice(0, 3).join(", ")} and ${formatCount(numbers.length - 3)} more` : numbers.join(", ")),
    definition: "MeSH definition: ",
    treeNumbers: (numbers) => `${numbers.length === 1 ? "Tree number" : "Tree numbers"} ${numbers.join(", ")}.`,
    source: (version) => `From MeSH®${version ? ` (${version})` : ""}, courtesy of the U.S. National Library of Medicine.`,
  },

  // Companies (companies part 2, user decisions 2026-09-28): holders grouped by their current owner
  // (companies.js), a monogram badge per group, EMA's holder name always shown.
  companies: {
    // The line under a medicine's company group: EMA's holder name (left out when it is the name
    // shown above it), how the holder was decided. entry: companies.js entry(); shown: the group's
    // name; representative: the company is a regulatory representative holding for another.
    // holder: null when EMA names none (the Union Register does).
    holderLine: ({ holder, register, basis, company }, shown, representative = false) => {
      // A sponsor's medicine: the sponsor when its group has another name (Avanir, Otsuka's), then
      // the representative holding it (the Union Register's when it decided).
      if (basis === "curated_sponsor") {
        const held = register
          ? [holder === null ? "EMA names no holder" : `EMA: ${holder}`, `via register: ${register}, a regulatory representative`]
          : [`via a regulatory representative: ${holder}`];
        return [...(company?.name && company.name !== shown ? [company.name] : []), ...held].join(" · ");
      }
      const parts = basis === "register" && register
        ? [holder === null ? "EMA names no holder" : `EMA: ${holder}`, `via register: ${register}`]
        : holder === null || holder === shown ? [] : [holder];
      if (representative) parts.push("held via a regulatory representative");
      return parts.length ? parts.join(" · ") : null;
    },
    // Before a plain EMA holder name, for screen readers, and its tooltip.
    emaHolder: "EMA holder name: ",
    holderTitle: "The holder name as EMA publishes it",
    // The results timeline's tooltip: the group, then EMA's name when it differs.
    tipHolder: (group, holder) => (holder === null || group === holder ? group : `${group} (${holder})`),
    // The company tree's and breakdown's static row: a company's medicines EMA names no holder for.
    noHolder: "No EMA holder name",
    // A row's value that also shows under another group, named with its group (the filter sentence).
    inGroup: (name, group) => `${name} (${group})`,
    // An EMA holder name as a filter value (the sentence's pill; a company can have the same name),
    // with its group when the row's value is its path.
    holderValue: (name, group = null) => `${name} (EMA holder name${group ? `, ${group}` : ""})`,
    // A holder name that repeats its company's name one level down (tree rows, the company page).
    sameName: "(same name)",
    sameNameLabel: (name) => `${name} (same name)`,
    // Aggregated views (breakdown bars, activity rows, the per-year legend): the EMA holder names
    // behind a company, most medicines first; the first 8, then how many more. own: the row's name;
    // when it is one of several names, the others after "also" (the row already names it).
    legalNames: (names, own = null) => {
      const others = names.length > 1 && names.includes(own) ? names.filter((name) => name !== own) : names;
      const list = others.length > 8 ? `${others.slice(0, 8).join(", ")} and ${formatCount(others.length - 8)} more` : others.join(", ");
      return others.length < names.length ? `also ${list}` : list;
    },
    named: (name, names) => `${name}: ${UI.companies.legalNames(names, name)}`,
    barLabel: (name, count, names) => `${name}, ${plural(count, "medicine", "medicines")}${names.length ? `: ${UI.companies.legalNames(names, name)}` : ""}`,
    // The company tree (company-tree.js): group › company › EMA holder name.
    find: "Find a company",
    tree: "Companies",
    // kind: companies.js kind() of the row's value; byHolder: its rows are holder names.
    expand: (name, byHolder) => `${byHolder ? "Holder names of" : "Companies in"} ${name}`,
    count: (name, count) => `${name}, ${plural(count, "medicine", "medicines")}`,
    included: (name, count, ancestor) => `${UI.companies.count(name, count)}, included in ${ancestor}`,
    noMatches: "No matching companies",
    note: (date) => `Companies by current owner${date ? ` as of ${formatDate(date)}` : ""}, then the companies they hold and the holder names EMA publishes. A level that only repeats a name is left out.`,
    open: (name) => `Open company page: ${name}`,
    all: "All companies",
    path: "Company path",
    // The company page (a lookup, ?co=): the group (or company), its medicines of every status and
    // those currently authorized.
    headline: (name, total, authorized) => [
      `${name}: `, number(total), ` ${total === 1 ? "medicine" : "medicines"}, `,
      ...(authorized ? [number(authorized), " currently authorized."] : ["none currently authorized."]),
    ],
    jointVentureOf: "A joint venture of ",
    jointVentures: "Its joint ventures: ",
    partOf: "Part of ",
    // A company all of whose medicines went to another owner (per-medicine rows): not part of it.
    medicinesUnder: (count) => (count === 1 ? "Its medicine is under " : "Its medicines are under "),
    // After each group of a company whose medicines are with several: its medicines there.
    groupCount: (count) => `(${plural(count, "medicine", "medicines")})`,
    and: " and ",
    representative: "A regulatory representative: it holds medicines on behalf of other companies.",
    asOf: (date) => `Company group as of ${formatDate(date)}: the current owner, not the owner at approval. Each medicine keeps the holder name EMA publishes.`,
    // The medicine card's fact.
    asOfShort: (date) => `Company group as of ${formatDate(date)} (current owner).`,
    // Provenance (curated notes are fragments; a sentence ends with one full stop): why a
    // per-medicine row put the medicine under its group, a plain note on a medicine's later
    // ownership (group_note without a move: no "Why"), a curated sponsor behind a regulatory
    // representative (its evidence link alone when there is no note), each followed by a link to
    // its evidence ("Source"); a sponsor renamed since, whose note names the rename ("AcelRx
    // (renamed Talphera in 2024)"), then a second link to the rename's evidence ("Rename source").
    // On phones a long note sits behind a disclosure: its summary, then the note alone (noteBody).
    why: (group, note) => `Why ${group}: ${sentenceOf(note)}`,
    note: (note) => `Ownership: ${sentenceOf(note)}`,
    sponsor: (note) => `Sponsor: ${sentenceOf(note)}`,
    whySummary: (group) => `Why ${group}?`,
    noteSummary: "Ownership",
    sponsorSummary: "Sponsor",
    noteBody: (note) => sentenceOf(note),
    sponsorEvidence: "Sponsor evidence",
    evidence: "Source",
    renameEvidence: "Rename source",
    // The company page's Sources: the ownership notes of its members (acquisitions, renames,
    // spin-offs), the holders of one note together, and its medicines' notes (after the medicine's
    // name, a link to its card): the group a per-medicine row moved it to, unless that is the page's
    // own (group null), then the note.
    ownership: "Ownership",
    ownershipNote: (holders, note) => `${holders.join(", ")}: ${sentenceOf(note)}`,
    moved: (group, note) => `${group ? ` (under ${group})` : ""}: ${sentenceOf(note)}`,
    names: "Companies and EMA holder names",
    namesHint: "Each opens the overview filtered to it.",
    atc: "ATC groups",
    atcHint: "Each opens the overview filtered to this company and ATC group.",
    areas: "Most common conditions",
    // The medicine list: authorized ones (as condition pages), or every status (the "Show all
    // statuses" toggle, or a company with no authorized medicine).
    medicines: (count, everyStatus) => `${everyStatus ? "Medicines of every status" : "Authorized medicines"} (${formatCount(count)})`,
    // A mix row's link: the group or area, then its count.
    mixLink: (label, count) => `${label}, ${plural(count, "medicine", "medicines")}`,
    sources: "Sources",
    lei: (lei) => `LEI ${lei}`,
    legalName: (name) => `Legal name (GLEIF): ${name}`,
    parent: (name) => `Ultimate parent reported to GLEIF: ${name}`,
    sourceNames: { ema: "EMA holder names", union_register: "the EU Union Register", curated: "company groups checked by hand", gleif: "GLEIF LEI records" },
    from: (sources) => `From ${listing(sources)}.`,
  },

  offline: (date) => `Offline: data as of ${formatDate(date)}`,

  // The splitter on the desktop sidebar's right edge (sidebar-resize.js); hint: its tooltip.
  sidebar: {
    resize: "Resize filters",
    hint: "Drag or use the arrow keys to resize the filters; double-click to reset",
  },

  // The header's theme button (theme.js; owner request 2026-09-28): an icon of the theme shown; a
  // press moves to the next one (nextTheme()). button: its name; hint: its tooltip.
  theme: {
    names: { auto: "Auto", light: "Light", dark: "Dark" },
    button: (theme) => `Theme: ${UI.theme.names[theme]}`,
    hint: (theme, next) => {
      const name = (key) => (key === "auto" ? `${UI.theme.names.auto} (follows your device)` : UI.theme.names[key]);
      return `Theme: ${name(theme)}. Select to switch to ${name(next)}.`;
    },
  },

  lookup: {
    // The search field (landing, 2026-09-28): plain words; ATC codes still work, so its name says so.
    placeholder: "Drug name, active ingredient or condition",
    label: "Search by drug name, active ingredient, condition or ATC code",
    // fuzzy: close names when nothing matched (step 2, #5); text: the name of the last group, the
    // indication-text search (#14), which has no visible heading.
    groups: {
      medicines: "Medicines", substances: "Substances", conditions: "Conditions", classes: "Drug classes", companies: "Companies",
      fuzzy: "Did you mean", text: "Indication text search",
    },
    // opinion: EMA's opinion (statusOpinionLabel()), once ema_medicines.json has loaded.
    medicineMeta: (status, year, opinion = null) => [statusOpinionLabel(status, opinion), year].filter(Boolean).join(" · "),
    // synonym: another name of the substance that matched (#19: "adrenaline" for epinephrine).
    substanceMeta: (count, synonym = null) => [synonym ? `matches “${synonym}”` : null, plural(count, "medicine", "medicines")].filter(Boolean).join(" · "),
    // A WHO level-5 name with no medicine in the data, as a "did you mean" option (a text search).
    whoMeta: (code) => `ATC ${code} · not in EMA's central procedure`,
    // Step 2: the list's note (a retried query, #3, or no matches) and the option ending every list.
    showingFor: (query) => `Showing results for “${query}”`,
    searchText: (query) => `Search indication texts for “${query}”`,
    // Announced after each keystroke: the note, then how many suggestions (the text search not counted);
    // a note ending in a period is joined to the count without a second one.
    status: (note, count) => {
      const counted = count ? plural(count, "suggestion", "suggestions") : null;
      return [counted ? note?.replace(/\.$/, "") : note, counted].filter(Boolean).join(". ");
    },
    // Step 2 (#2): an indication-text search that found nothing says why: first what was found (a
    // WHO substance with no medicine through EMA, a name, medicines of another status, or nothing),
    // then what can be searched, what cannot yet, and what is not in the data.
    empty: {
      nothing: (query) => `Nothing in the EMA data matches “${query}”.`,
      known: (name, code) => `${name} (ATC ${code}) is a known active substance, but no medicine with it went through EMA's central procedure; it may be authorized nationally.`,
      noText: (query) => `No indication text mentions “${query}”.`,
      otherStatuses: (count) => `No currently authorized medicine mentions it in its indication; ${plural(count, "medicine", "medicines")} of another status ${count === 1 ? "does" : "do"} (Show all statuses).`,
      sameClass: "Medicines in the same drug class: ",
      names: "Matching names: ",
      didYouMean: "Did you mean: ",
      searchable: "You can search by brand name, active ingredient (INN), condition or ATC code.",
      notYet: "Not searchable yet: development codes (such as MK-3475) and brand names used outside the EU.",
      notInData: "Not in the data: medicines authorized only nationally, country by country. Look them up in the ",
      registers: "national registers of authorized medicines",
      registersAfter: " (EMA's list). The pack of a medicine authorized through EMA carries an EU number (EU/1/…).",
    },
    conditionMeta: (synonym, count) => [synonym ? `matches “${synonym}”` : null, `${formatCount(count)} authorized`].filter(Boolean).join(" · "),
    classMeta: (count, unnamed = false) => [unnamed ? NO_ATC_NAME : null, `${formatCount(count)} authorized`].filter(Boolean).join(" · "),
    // synonym: the other name that matched (a company, spelling or EMA holder name of the group).
    companyMeta: (synonym, count) => [synonym ? `matches “${synonym}”` : null, `${formatCount(count)} authorized`].filter(Boolean).join(" · "),
    noMatches: "No matches",
    matches: (count) => plural(count, "suggestion", "suggestions"),
    loading: "Loading…",
    notAvailable: "Not available right now.",
    // Home state only: example lookups (ids checked against the data 2026-09-26), each followed by
    // the kind of thing it is (landing, 2026-09-28).
    tryLead: "Try",
    examples: [
      { label: "Keytruda", kind: "brand", patch: { med: "EMEA/H/C/003820" } },
      { label: "semaglutide", kind: "active ingredient", patch: { sub: "semaglutide" } },
      { label: "psoriasis", kind: "condition", patch: { cond: "D011565" } },
      // A drug class: the dashboard filtered to it alone (url.js classState()).
      { label: "L04AC", kind: "drug class", atc: "L04AC" },
    ],
    exampleKind: (kind) => `(${kind})`,
  },

  card: {
    notFoundTitle: "Not found",
    notFound: (kind, value) => `No ${kind} “${value}” in the EMA data.`,
    noDate: "no approval date",
    kinds: { medicine: "medicine", substance: "substance", condition: "condition", company: "company" },
    // Answer strip under a lookup headline: "Since" while authorized, "Approved" otherwise.
    // "Company": it leads with the company group, as the table's "Company · Holder" column.
    strip: { label: "Answer summary", company: "Company", since: "Since", approved: "Approved", status: "Status", protection: "Protection (est.)" },
    documentMeta: (isPdf, date) => [isPdf ? UI.card.pdf : null, UI.card.updated(date)].filter(Boolean).join(" · "),
    substances: "Active substance(s)",
    // The medicine's company group and holder (companies part 2), with the groups' as-of date.
    company: "Company",
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
    // Step 4 (#9): the symbol of additional monitoring (EMA's black inverted triangle), before the
    // chip's name (hidden from screen readers, which read the name).
    blackTriangle: "▼",
    // The dek of a medicine authorized with a qualifier (statusSentence()): one short clause, as the
    // chip beside the status explains it on hover and tap (UI.flagTips; review of step 4: longer
    // sentences took 4 lines at 320px and pushed the product information a screen down).
    qualifiers: {
      conditional_approval: "Conditionally authorized: renewed yearly until full data are provided.",
      exceptional_circumstances: "Authorized under exceptional circumstances: reviewed yearly.",
    },
    // Step 4 (#12): after a positive opinion's sentence; days: meta.json opinion_to_decision.median_days.
    decisionUsually: (days) => `The EU decision usually comes about ${formatCount(days)} days after the opinion.`,
    // Review of step 4: a positive opinion past the median, by the data's date; beyondMost: past the
    // 90th percentile of the last 5 years' decisions (opinion_to_decision.p90_days).
    waited: (days, beyondMost) => `This one has waited ${formatCount(days)} days so far${beyondMost ? ", longer than 9 in 10 decisions of the last 5 years took" : ""}.`,
    // Step 4 (#15): the SmPC, EPAR and overview buttons (the documents list keeps UI.documents).
    buttons: {
      productInformation: "Product information (SmPC and package leaflet)",
      epar: "EPAR public assessment report",
      overview: "Plain-language overview",
    },
  },
  // Step 4 (#9): the approval flags' explanations, on hover and tap (the chips beside the status and
  // among the card's facts, the result tables' markers); at most 12 words. Orphan is a type badge.
  flagTips: {
    conditional_approval: "Approved on less complete data for an unmet need; renewed yearly.",
    exceptional_circumstances: "Full data cannot be collected, e.g. very rare disease; reviewed yearly.",
    additional_monitoring: "Black triangle ▼: monitored more closely; report any suspected side effects.",
    prime_priority_medicine: "EMA's priority medicines scheme: early support for an unmet need.",
    accelerated_assessment: "Assessed in 150 days instead of the usual 210.",
  },
  // The result tables' compact markers beside an authorized medicine's status: the visible text
  // (aria-hidden) and the name read instead. Each shows a word (review of step 4: a bare "▼" meant
  // nothing to a keyboard user, who cannot bring up its tip, or to a lay reader).
  flagMarkers: {
    conditional_approval: { text: "Conditional", name: "Conditional approval" },
    exceptional_circumstances: { text: "Exceptional", name: "Exceptional circumstances" },
    additional_monitoring: { text: "▼ Additional monitoring", name: "Additional monitoring" },
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
    // Counted from another company's first approval and from the company's own (owner request
    // 2026-09-28: data_exclusivity_end_max); ended: the later end is before the data date.
    dataExclusivityRange: (min, max, ended) => `Data exclusivity ${ended ? "ended" : "ends"} (est.) between ${formatDate(min)} and ${formatDate(max)}`,
    marketProtection: (min, max, ended) => `Market protection ${ended ? "ended" : "ends"} (est.) ${formatDate(min)} – ${formatDate(max)}`,
    // Step 2 (#1): earlier national authorizations are not in the data.
    // name: a medicine approved that day (step 3 review: never the reference with another's date),
    // null when none is known.
    countedFrom: (substance, name, date) => `Counted from the first central EU approval of ${substance}: ${name ? `${name}, ` : ""}${formatDate(date)}`,
    thisSubstance: "this active substance",
    // Step 4 review: a curated copy (ema_curated_copies.json) is counted as its reference medicine
    // is, whose substance can be another (Riulvy, tegomil fumarate: Tecfidera, dimethyl fumarate),
    // so the line names the reference, never the copy's substance. countedFromReference: the
    // reference was approved on that date; countedAsReference: it counts from an earlier medicine
    // (Ablymico: Saxenda, counted from Victoza); substance: the reference's, null when unknown.
    countedFromReference: (reference, date) => `Counted from its reference medicine ${reference}'s first central approval: ${formatDate(date)}`,
    countedAsReference: (reference, substance, name, date) =>
      `Counted, as for its reference medicine ${reference}, from the first central EU approval of ${substance ?? "its active substance"}: ${name ? `${name}, ` : ""}${formatDate(date)}`,
    follows: (name) => `No protection of its own; follows ${name}`,
    // Backlog (step 4 review): a curated copy of a central reference says what it is (type: the
    // row's copy_type), then links the EMA page that says so (copyEvidence), as nationalReference.
    curatedFollows: (type, name) => `No protection of its own; a ${copyTypeWord(type)} of ${name}.`,
    referenceNotFound: "No protection of its own; reference product not found in EU central authorizations",
    // Step 4 review: a curated copy of a nationally authorized medicine (no central reference);
    // type: the row's copy_type; then a link to the EMA page that says so (copyEvidence).
    nationalReference: (type, name) =>
      `No protection of its own; a ${copyTypeWord(type)} of ${name} (authorized nationally), whose protection dates are not in EU central data.`,
    copyEvidence: "Source",
    // Step 3 (#6): counted from another company group's earlier medicine of the same substance set
    // (basis other_company_reference; own: the medicine's own group's first approval date, or
    // null). The status is unclear where the two estimates' statuses differ, else protected (step 3
    // review), so the line does not say which.
    otherCompany: (substance, name, date, own) =>
      `The first central EU approval of ${substance} was another company's medicine (${name ? `${name}, ` : ""}${formatDate(date)}); counted from this company's own first approval${own ? ` (${formatDate(own)})` : ""}, protection would end later, so the market protection range covers both.`,
    // Step 3 (#7, e): the estimate's basis, next to the chip (it used to sit in the collapsed caveats).
    basisNote: "Estimated from EU central (EMA) approval dates only; earlier national authorizations are not counted.",
    // The answer strip's "Protection (est.)" cell (protectionGlance()): the market protection
    // range's years while protected, else the status; then orphan exclusivity still running.
    // link: after the value, for screen readers (the cell jumps to the section).
    glance: {
      until: (from, to) => (from === to ? `Until ${from}` : `Until ${from}–${to}`),
      orphan: (year) => `Orphan exclusivity until ${year}`,
      link: ", see the estimate below",
    },
    orphan: (condition, date, source, ended) =>
      `Orphan market exclusivity for ${condition}: ${ended ? "ended" : "ends"} ${formatDate(date)} ${source === "register" ? "(register)" : "(estimate)"}`,
    orphanNoEnd: (condition, designationStatus) =>
      `Orphan designation for ${condition}: ${designationStatus.toLowerCase()} (end date not published)`,
    patents: "Patents and supplementary protection certificates: not shown (no open EU-wide source).",
    espacenet: "Search patents on Espacenet",
    caveatsTitle: "Caveats",
    caveats: [
      "Not legal advice.",
      "Ignores earlier national authorizations, the possible extra year (shown as a range), pediatric rewards, orphan exclusivity reductions and derogations.",
      "The legal basis is inferred from EMA's generic and biosimilar flags and, for copies EMA does not flag (such as hybrids), from their EPAR pages, checked by hand; copies not yet checked count as medicines of their own.",
      "The EU pharmaceutical reform (not adopted as of September 2026) would change the rules only for new applications.",
    ],
  },

  substance: {
    // Step 2 (#1): central only (metformin's first EU approval was not Avandamet's).
    firstApproval: (date, name) => (date ? `First central EU approval: ${formatDate(date)} (${name})` : "No central EU approval date"),
    products: (count) => plural(count, "medicine", "medicines"),
    // Step 3 review: with other spellings (the headline and strip count them all), the list's heading.
    productsListed: (count, name) => `${plural(count, "medicine", "medicines")} listed as ${name}`,
    companies: (count) => plural(count, "company", "companies"),
    authorized: (count) => `${formatCount(count)} authorized`,
    // Step 3 (#8): another spelling of the same substance in EMA's data (copies.js
    // siblingSubstances()), as parts: { text, link } is the sibling's name, a link to its card.
    // first: { name, date } or null.
    sibling: (name, count, first) => [
      "Also listed as ", { text: name, link: "sibling" }, `: ${plural(count, "medicine", "medicines")}`,
      first ? `, first central approval ${formatDate(first.date)} (${first.name})` : "", ".",
    ],
  },

  // Step 3 (#7): the medicine card's lines under the answer strip (copies.js copiesSummary()), as
  // parts: strings, and { text, link } for a link (link: the entry's position, "substance" or
  // "first"). Counted by the same substance set (equivalent spellings joined), not by EMA's
  // reference product, so Humira's biosimilars (whose reference is Trudexa) count.
  copies: {
    none: "No generic or biosimilar authorized yet.",
    // entries: [{ type ("Generic" | "Biosimilar"), count, companies (null: unknown), first: { name, date } }].
    // substance: named on a medicine that is not its substance's first (step 3 review: Opzelura's
    // generic is Jakavi's, "1 generic of ruxolitinib …"); null on the first's (Humira, Sprycel).
    line: (entries, substance = null) => [...entries.flatMap((entry, position) => [
      position ? "; " : "",
      `${entry.type === "Generic" ? plural(entry.count, "generic", "generics") : plural(entry.count, "biosimilar", "biosimilars")}${substance ? ` of ${substance}` : ""}${entry.companies === null
        ? ""
        : ` from ${plural(entry.companies, "company", "companies")}`}, first `,
      { text: entry.first.name, link: position },
      entry.first.date ? ` ${formatDate(entry.first.date)}` : "",
    ]), "."],
    // A copy's card, or a medicine whose set was approved before it (Wegovy: Ozempic): the set's
    // other authorized medicines (count), its name (substances: how many it has) and its first
    // central approval ({ name, date, status (raw EMA status, or null when unknown) }, or null when
    // it is this medicine). A first approval no longer authorized says so (owner request
    // 2026-09-28: Qdenga's "No other authorized medicine …; first central approval … (Dengvaxia)"
    // read against itself, Dengvaxia being withdrawn).
    same: (count, substance, substances, first) => {
      const ended = first?.status && statusKind(first.status) !== "authorized";
      return [
        `${count === 0 ? "No other authorized medicine has" : `${plural(count, "other authorized medicine", "other authorized medicines")} ${count === 1 ? "has" : "have"}`} the same active ${substances === 1 ? "substance" : "substances"} (`,
        { text: substance, link: "substance" }, ")",
        !first ? []
          : ended ? ["; the first central approval was ", { text: first.name, link: "first" }, ` (${formatDate(first.date)}), since ${statusLabel(first.status).toLowerCase()}`]
            : [`; first central approval ${formatDate(first.date)} (`, { text: first.name, link: "first" }, ")"],
        ".",
      ].flat();
    },
  },

  condition: {
    // The dek: the narrower conditions (links), the first few then how many more.
    narrowerLead: (count) => `Includes the narrower ${count === 1 ? "condition" : "conditions"} `,
    narrowerMore: (count) => ` and ${formatCount(count)} more`,
    textHeading: (query) => `Mentioned in indication texts: “${query}”`,
    // Step 2 (#19): the text search also looks for EMA's name of the substance typed.
    alsoSearched: (name) => `Also searching for “${name}”, the name EMA uses.`,
    // The tagged medicines: those tagged with the condition itself, then those tagged only with a
    // narrower one (each row says which).
    taggedOwn: (name, count) => `Tagged by EMA with ${name} (${formatCount(count)})`,
    taggedNarrower: (count) => `Tagged with a narrower condition (${formatCount(count)})`,
    rowTagged: "Tagged with ",
    // Phase 4f: a medicine found only through its indication text says which words matched (the
    // indication's own spelling), and the dek gives both counts of the lists shown (every: "Show
    // all statuses" is on; mentioned: null while the indication texts load).
    rowMentions: (text) => `Indication mentions “${text}”`,
    // Step 4 (#10): substances: the tagged medicines' distinct active substances (substance sets,
    // equivalent spellings joined, a combination on its own, so named as UI.conditions.substances();
    // null while they load).
    counts: (tagged, mentioned, every, substances = null) => `${every ? "Every status" : "Authorized"}: ${plural(tagged, "medicine", "medicines")} tagged by EMA${tagged && substances !== null
      ? ` (${UI.conditions.substances(substances)})`
      : ""}${mentioned === null
      ? ""
      : ` and ${formatCount(mentioned)}${tagged ? " more" : ""} mentioned in the indication text`}.`,
    alsoMentioned: "Also mentioned in indication text",
    mentioned: "Mentioned in indication text",
    showAll: "Show all statuses",
    none: "None.",
    relatedConditions: "Matching conditions",
  },

  // Condition, indication-text and substance results: a table, one row per medicine (lookup.js
  // resultTable()); the name opens its card.
  results: {
    headers: ["Medicine", "ATC", "Approved · Status", "Type", "Company · Holder"],
    // Substance cards: what each medicine is for, after the Medicine column.
    areas: "Therapeutic area",
  },

  timeline: {
    caption: "One dot per medicine; lines join medicines with the same active substances (reference, generics, biosimilars). Tap or point at a dot for its name.",
    // Step 4 (#17): after the caption on condition and indication-text pages ("this use": an
    // indication-text search is not a condition; review of step 4).
    firstApproval: "Dots show each medicine's first approval, not when this use was added to its indication.",
    // Condition pages: a legend of the dots, filled (tagged by EMA) and hollow (found only in the
    // indication text; phase 4f), and the hollow dot's tooltip line.
    legend: { tagged: "Tagged by EMA", mentioned: "Mentioned in the indication" },
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
    unionRegister: "Orphan exclusivity, EU register status and holders: © European Union, Union Register, CC BY 4.0, modified.",
    // date: the company groups' curation date.
    companies: (date) => `Company groups (current owner${date ? ` as of ${formatDate(date)}` : ""}) curated by Approval Atlas; LEI data from the Global Legal Entity Identifier Foundation (GLEIF), CC0. GLEIF does not provide or endorse this site.`,
    // Modality (M2 phase 2): WHO INN stems (Stem book 2024, CC BY-NC-SA 3.0 IGO: credited, no
    // endorsement), ChEMBL molecule types (release: ChEMBL's in meta.json) and EMA data.
    modality: (release) => `Modalities from WHO INN stems (WHO Stem book 2024, CC BY-NC-SA 3.0 IGO), ChEMBL molecule types${release ? ` (${release})` : ""} and EMA data, some checked by hand.`,
  },

  about: {
    summary: "About this site",
    // Step 2 (#1, #16): what is in the data, where a central authorization is valid, and that
    // availability and reimbursement are national.
    scope: "Only human medicines that went through the European Medicines Agency's (EMA) central procedure are included, whatever their status. Many older or common medicines are authorized country by country and are not here; check your national medicines agency. A central authorization is valid in the EU, Iceland, Liechtenstein and Norway, not in the UK or Switzerland; whether a medicine is sold or reimbursed in a country is decided nationally.",
    intendedUse: "Informational only: not medical or legal advice; not a medical device. Data can lag EMA.",
    privacy:
      "No cookies, no analytics, no tracking. Searches run in your browser. The site is hosted on GitHub Pages; GitHub may log IP addresses and page addresses, which include your search when a page is reloaded or opened from a link. Offline mode stores only this site's files and data on your device.",
    security: "Security policy and how to report a vulnerability (GitHub)",
  },
};
