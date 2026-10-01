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
// the search's meta line and the medicine card's Status block; opinion: ema_medicines
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

// Second line of the result tables' merged "Approved · Status" cell: the approval date; for an
// authorization that ended on a known date, "{end} · approved {approval}".
export function statusDateLine(status, approved, ended) {
  if (statusKind(status) === "authorized") return formatDate(approved) ?? UI.card.noDate;
  if (ended) return approved ? `${formatDate(ended)} · approved ${formatDate(approved)}` : formatDate(ended);
  return approved ? `approved ${formatDate(approved)}` : null;
}

// The medicines table's status dot (owner decision 2026-09-30): its accessible name, and, for a
// status other than Authorized, the text under the approval date (review of the status dot: the
// status within a kind was told by colour alone). Authorized: since its approval; any other status:
// its label (a negative opinion's too: statusOpinionLabel()), then the date it ended where EMA has
// one: "Withdrawn 16 Jan 2009", "Refused". The approval date is the Approved column's.
export function statusDotLine(status, approved, ended, opinion = null) {
  const label = statusOpinionLabel(status, opinion);
  if (statusKind(status) === "authorized") return approved ? `${label} since ${formatDate(approved)}` : `${label}, ${UI.card.noDate}`;
  return ended ? `${label} ${formatDate(ended)}` : label;
}

// The first line of the dot's tooltip: its name, then, for a status other than Authorized, its
// approval date where it had one: "Withdrawn 16 Jan 2009 (approved 19 Jun 2006)".
export function statusDotTipLine(status, approved, ended, opinion = null) {
  const line = statusDotLine(status, approved, ended, opinion);
  return statusKind(status) !== "authorized" && approved ? `${line} (approved ${formatDate(approved)})` : line;
}

// Why a medicine is not authorized, from EMA's own date for its status (statusDate() in
// approvals.js) and, for opinions, EMA's opinion status. Nothing is inferred. None for an authorized
// medicine: its qualifiers (conditional, exceptional circumstances) are the chips beside its status,
// each explained by its tooltip (owner decision 2026-09-30: step 4's sentence repeated them). Step 4:
// a positive opinion says how many days the EU decision usually takes (#12; decision: meta.json
// opinion_to_decision as { median, p90 } days, null in older data) and, once past that, how long it
// has waited by the data's date (asOf).
export function statusSentence(status, date, opinion, { decision = null, asOf = null } = {}) {
  if (statusKind(status) === "authorized") return null;
  const on = date ? ` on ${formatDate(date)}` : "";
  if (status === "Opinion under re-examination") {
    return opinion === "Negative" ? `Negative opinion${on}; under re-examination at the company's request.` : "Opinion under re-examination at the company's request.";
  }
  if (status === "Opinion") {
    if (opinion === "Negative") return `Negative opinion${on}: EMA recommended refusal.`;
    const sentence = opinion === "Positive" ? `Positive opinion${on}: EMA recommended approval.` : `Opinion adopted${on}; EU decision pending.`;
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

// Distinct raw statuses, most common first (ties alphabetical): a substance's Status block shows
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
const NO_ATC_NAME = "no WHO name";

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
// Draft (loss-of-exclusivity calendar): the caveats of its captions (the medicine card's, shortened).
const CALENDAR_CAVEATS = "Estimated from EU central (EMA) approval dates only; earlier national authorizations are not counted. Market protection runs 10 years from the first central EU approval of the active substance (from its own approval for a pediatric-use marketing authorization), or 11 with the possible extra year; each range spans both. The estimates ignore derogations and pediatric rewards other than a pediatric-use marketing authorization's own protection; copies not yet checked by hand count as medicines of their own. Not legal advice.";
// Orphan market exclusivity ends (owner decision 2026-09-30, "be specific where you can, else
// estimate"): an end the Union Register publishes (end_source "register") is exact, no mark; one
// computed from the link date (+ 10 years + extension) is an estimate, "(est.)". A label covering
// several ends (a legend, a year's orphan count, a list's heading) says "(est.)" when all are
// computed, nothing when all are the register's, "(partly est.)" when they mix; with no end at all,
// "(est.)" (every running end was computed on 2026-09-29: the register fills EndDate only once
// exclusivity has ended). ends: { source } objects (protection-calendar.js orphanLater()).
const orphanEstimateOf = (ends = []) => {
  const computed = ends.filter((end) => end.source !== "register").length;
  if (ends.length && !computed) return "";
  return computed === ends.length ? " (est.)" : " (partly est.)";
};
const orphanEstimate = (orphanEnd) => orphanEstimateOf([orphanEnd]);
// The per-year chart's how-to, after what it counts (copy review 2026-09-29; adapted: the year slider is
// the Approval year chip's since F · Spacious phase 1, not "above").
const YEARS_HOW_TO = "EMA's annual reports count recommendations (CHMP opinions) instead, so their totals differ. Click a year to show only that year (click again for all; on a touch screen the first tap shows its numbers), or drag across several years; with a keyboard, use the Approval year filter.";

// A medicine card's modality source "EMA text naming …": the modality rules' text hints (the "text:…"
// rule values of ema_medicine_modalities.json) in words; another rule "vaccine {kind}" reads "a {kind}
// vaccine", any other as it is.
const TEXT_RULE_WORDS = {
  "vaccine live": "a live vaccine",
  "vaccine inactivated": "an inactivated vaccine",
  "vaccine whole cell": "a whole-cell vaccine",
  "vaccine acellular": "an acellular vaccine",
  "vaccine rdna": "an rDNA vaccine",
  "vaccine conjugate": "a conjugate vaccine",
  "vaccine recombinant": "a recombinant vaccine",
  "vaccine surface antigen": "a surface-antigen vaccine",
  "vaccine split virion": "a split-virion vaccine",
  "vaccine polysaccharide": "a polysaccharide vaccine",
  "vaccine rvsv": "an rVSV vector vaccine",
  "vaccine ad26.": "an Ad26 vector vaccine",
  "vaccine mva-bn": "an MVA-BN vector vaccine",
  "vaccine chadox1": "a ChAdOx1 vector vaccine",
  toxin: "a toxin",
  coagulation: "a coagulation factor",
  immunoglobulin: "an immunoglobulin",
  hormone: "a hormone",
  "gene + vector": "a gene and its vector",
  "c1 inhibitor": "C1 inhibitor",
  "proteinase inhibitor": "a proteinase inhibitor",
  extract: "an extract",
  "monoclonal antibody": "a monoclonal antibody",
  mrna: "mRNA",
};

// The regulators whose data the overview covers, as the page header's scope line names them (owner
// decision 2026-09-30): one phrase each, so another source (a national agency, the FDA) joins the
// line without a redesign. Only sources the data has: never one that is planned. `scope` says where
// its medicines are authorized (the default overview shows authorized ones only); `neutral` names the
// source without "authorized", for an overview widened to other statuses (owner decision 2026-09-30);
// `list` names its list of medicines, for the widened overview's heading (Laws of UX, second pass,
// owner decision 2026-09-30: "Approved medicines" stood over refused and pending ones).
export const SOURCES = [{ key: "ema", scope: "EU-wide through EMA", neutral: "EU-wide through EMA's central procedure", list: "EMA's list" }];

// The footer's and About's links (https): sources, licenses, the repository.
const LINKS = {
  emaData: "https://www.ema.europa.eu/en/medicines/download-medicine-data",
  whocc: "https://atcddd.fhi.no",
  unionRegister: "https://ec.europa.eu/health/documents/community-register/html/index_en.htm",
  chembl: "https://www.ebi.ac.uk/chembl",
  chemblPaper: "https://doi.org/10.1093/nar/gky1075",
  ccBy: "https://creativecommons.org/licenses/by/4.0/",
  ccBySa3: "https://creativecommons.org/licenses/by-sa/3.0/",
  ccBySa4: "https://creativecommons.org/licenses/by-sa/4.0/",
  ofl: "https://openfontlicense.org/open-font-license-official-text/",
  mit: "https://github.com/vrognas/approval-atlas/blob/main/LICENSE",
  issues: "https://github.com/vrognas/approval-atlas/issues",
  security: "https://github.com/vrognas/approval-atlas/blob/main/SECURITY.md",
  // The operator's email (owner decision 2026-09-30): a mailto link, not another website (links.js
  // isWebLink(): no new tab, no external marking).
  email: "mailto:viktor@vrognas.com",
};

export const UI = {
  // Under the wordmark in the top bar (F · Spacious, phase 1): the source and the data's date ("EMA
  // data" until meta.json has loaded). The tagline and the scope line left the bar: beside the
  // search they did not fit one clean line; the intro card and the About disclosure say what the site
  // covers (EMA's central procedure).
  dataDate: (date) => (date ? `EMA data as of ${formatDate(date)}` : "EMA data"),
  // The dashboard's page heading (F · Spacious, phase 1): the answer headline is its lead paragraph.
  // Source-neutral since 2026-09-30 (owner decision: other regulators' data may follow); the scope
  // line under it names the sources (SOURCES): "Human medicines authorized EU-wide through EMA", or,
  // with the status filter widened (every status, or a choice of statuses), the neutral "Human
  // medicines, EU-wide through EMA's central procedure" (owner decision 2026-09-30). The heading
  // follows the same scope (Laws of UX, second pass, owner decision 2026-09-30): widened, it names
  // the sources' lists, "Medicines in EMA's list", as the overview then holds refused and pending ones.
  page: {
    title: (sources, { widened = false } = {}) =>
      (widened ? `Medicines in ${listing(sources.map((source) => source.list))}` : "Approved medicines"),
    scope: (sources, { widened = false } = {}) =>
      widened
        ? `Human medicines, ${listing(sources.map((source) => source.neutral))}`
        : `Human medicines authorized ${listing(sources.map((source) => source.scope))}`,
  },
  // The dashboard's tabs (F · Spacious, phase 2; url.js TABS): a tablist under the chip bar (the
  // WAI-ARIA tabs pattern since 2026-09-30); label names it.
  tabs: {
    label: "Dashboard views",
    names: {
      overview: "Overview",
      protection: "Protection",
      classes: "Classes and areas",
      companies: "Companies",
      years: "By year",
      medicines: "Medicines",
    },
  },
  // A card's secondary controls (Sort, Stack by, Columns, Column order) behind one disclosure
  // (F · Spacious, phase 2; Hick's Law: each card opens in one view).
  viewOptions: "View options",
  // A card's (i) button (F · Spacious, phase 3): its method description in a panel. Named "About"
  // and the card's title (aria-labelledby; review of phase 3), its tooltip "About this card".
  cardInfo: "About this card",
  cardInfoLead: "About",
  // Each dashboard card's one-sentence takeaway (F · Spacious, phase 3; takeaways.js), computed from
  // the data it shows. Estimates say so; never "patent".
  takeaways: {
    // count: medicines authorized with an approval date at the data's date (the series; the headline
    // also counts those without one: review of phase 3); change: since a year before, or null;
    // ignored: { status, years }, the filters set that this history does not apply.
    overTime: (count, change, { status = false, years = false } = {}) => {
      const now = `${count === 0 ? "No medicines" : plural(count, "medicine", "medicines")} authorized with an approval date`;
      const trend = change === null ? `${now}.`
        : change === 0 ? `${now}, unchanged over the last 12 months.`
          : `${now}, ${change > 0 ? "up" : "down"} ${formatCount(Math.abs(change))} in the last 12 months.`;
      if (!status && !years) return trend;
      const which = status && years ? "The status and year filters do not" : `The ${status ? "status" : "year"} filter does not`;
      return `${trend} ${which} apply to this history.`;
    },
    // count: the medicines shown approved in year; biosimilars: how many of them; partial: year is the
    // data's own (so far). Worded by the medicines shown, not as EMA's yearly total (review of
    // phase 3: by default they are the authorized ones).
    years: (count, year, biosimilars, partial = false) => {
      const when = `${year}${partial ? " so far" : ""}`;
      if (count === 0) return `None of the medicines shown was approved in ${when}.`;
      const lead = `Of the medicines shown, ${formatCount(count)} ${count === 1 ? "was" : "were"} approved in ${when}`;
      if (count === 1) return `${lead}, ${biosimilars ? "a biosimilar" : "not a biosimilar"}.`;
      if (biosimilars === 0) return `${lead}, none of them biosimilars.`;
      if (biosimilars === count) return `${lead}, all of them biosimilars.`;
      return `${lead}, ${formatCount(biosimilars)} of them ${biosimilars === 1 ? "a biosimilar" : "biosimilars"}.`;
    },
    // names: the group(s), company(ies) tied for the most (null: more tie than the bars show);
    // count: their medicines each; noun: "groups", "classes" (ATC) or "companies".
    mostMedicines: (names, count, noun = "groups") => {
      if (names === null) return `Several ${noun} have the most medicines (${formatCount(count)} each).`;
      if (names.length === 1) return `${names[0]} has the most medicines (${formatCount(count)}).`;
      const who = names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.length} ${noun}`;
      return `${who} have the most medicines (${formatCount(count)} each).`;
    },
    // noun: "group", or "class" in ATC mode (final round before merge).
    onlyGroup: (name, count, noun = "group") => `${name}: ${plural(count, "medicine", "medicines")}, the only ${noun} here.`,
    // company: the company with the most medicines (count); column: its largest column (inColumn
    // of them there), or null; alone: the only company shown.
    activity: (company, count, column, inColumn, alone = false) => {
      const lead = alone ? `${company}: ${plural(count, "medicine", "medicines")}` : `${company} has the most medicines (${formatCount(count)})`;
      if (!column) return `${lead}.`;
      if (count === 1) return `${lead}, in ${column}.`;
      return `${lead}, ${inColumn === count ? "all" : formatCount(inColumn)} of them in ${column}.`;
    },
    // ending: medicines whose market protection may end (est.) by the end of year, of running;
    // orphan: how many of those have orphan market exclusivity running later (review of phase 3);
    // orphanEnds: their orphan ends ({ source }), which decide its "(est.)" (orphanEstimateOf()).
    // Scoped to the medicines with market protection running, so it stands alone (final round
    // before merge).
    protection: (ending, running, year, orphan = 0, orphanEnds = []) => {
      if (!ending) {
        return running === 1
          ? `The 1 medicine with market protection running is not estimated to lose it by the end of ${year}.`
          : `None of the ${plural(running, "medicine", "medicines")} with market protection running is estimated to lose it by the end of ${year}.`;
      }
      const lead = running === 1
        ? `The 1 medicine with market protection running (est.) may lose it by the end of ${year}`
        : `Of the ${plural(running, "medicine", "medicines")} with market protection running (est.), ${formatCount(ending)} may lose it by the end of ${year}`;
      if (!orphan) return `${lead}.`;
      const exclusivity = `orphan market exclusivity${orphanEstimateOf(orphanEnds)} running later`;
      if (ending === 1) return `${lead}, with ${exclusivity}.`;
      return `${lead}, ${orphan === ending ? "all" : formatCount(orphan)} of them with ${exclusivity}.`;
    },
    conditions: (names, count) => {
      if (names.length === 1) return `${names[0]} has the most treatments (${formatCount(count)}).`;
      const who = names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.length} conditions`;
      return `${who} have the most treatments (${formatCount(count)} each).`;
    },
  },
  // The Overview's previews of other tabs (overview-previews.js): each a few rows and a link to its
  // tab ("Companies tab").
  previews: {
    tabLink: (name) => `${name} tab`,
    companies: {
      title: "Companies with the most medicines",
      unit: (count) => (count === 1 ? "medicine" : "medicines"),
    },
    conditions: {
      title: "Conditions with the most treatments",
      unit: (count) => (count === 1 ? "treatment" : "treatments"),
      none: "No condition of these medicines is ranked.",
    },
    protection: {
      title: "Market protection ending (est.)",
      caption: "Currently authorized medicines by the year their estimated market protection ends at the earliest.",
      unit: (count) => (count === 1 ? "medicine" : "medicines"),
    },
  },
  // The landing intro card (intro.js): on the untouched overview (no lookup, no filter) on the first
  // visit, until the viewer does anything or closes it; the header's link brings it back.
  intro: {
    link: "What is this?",
    // The card's heading (visually hidden; the link's text, so the link and its target agree).
    title: "What is this?",
    close: "Close the introduction",
    // "Remembered on this device": the close is kept in localStorage (legal review 2026-09-30:
    // storage the viewer asked for, said next to the control).
    closeHint: "Close (remembered on this device). “What is this?” at the top brings it back.",
    // Owner decision 2026-09-29: three onboarding cards, each an icon on its hue's tint (hue: a .hue-*
    // class; icon: intro.js ICONS), a bold title, one plain sentence and an example to try: a medicine
    // card (patch, ids checked against the data), or the overview filtered to one therapeutic area
    // alone (area: a MeSH branch; url.js areaState()).
    cards: [
      {
        hue: "green",
        icon: "lookup",
        title: "Look up a drug",
        text: "Type a brand or active substance: is it authorized in the EU, what for, since when, and who owns it?",
        action: "Try Keytruda",
        patch: { med: "EMEA/H/C/003820" },
      },
      {
        hue: "gold",
        icon: "shield",
        title: "Protection and copies",
        text: "See roughly how long market protection runs, and whether generics or biosimilars are authorized yet.",
        action: "Try Humira",
        patch: { med: "EMEA/H/C/000481" },
      },
      {
        hue: "blue",
        icon: "chart",
        title: "Explore the landscape",
        text: "Which conditions have the most treatments, which companies are active where, and how approvals change over time.",
        action: "Explore cancer medicines",
        area: "C04",
      },
    ],
    // One quiet line under the cards: the scope (step 2, #1) and the intended use.
    scope: "Covers medicines authorized EU-wide through the European Medicines Agency (EMA). Many older medicines, such as paracetamol, are authorized country by country and aren't here. For information only, not medical advice.",
  },
  // The tab's title: the view's name (a medicine, substance, condition, search or drug class) first.
  pageTitle: (name) => (name ? `${name} · Approval Atlas` : "Approval Atlas"),
  textTitle: (query) => `“${query}”`,
  // Above the dashboard while a lookup result is open.
  explore: {
    title: "Explore EMA medicines",
    note: "The filters apply to this overview, not to the result above.",
  },
  missingData: ["Could not load the data. Check your connection and reload. Developers: run ", "Rscript scripts/run-pipeline.R", " first."],
  ignoredValues: (count) => `${plural(count, "filter value", "filter values")} in the link ${count === 1 ? "was" : "were"} not recognized and ignored.`,

  // The filter tokens (facets.js sentenceParts()), which the filter chips read (facets.js
  // filterChips(): which dimensions are active, their explanations); the words are those of the
  // sentence the chips replaced (F · Spacious, phase 1).
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
      // Nothing selected: every status, a filter of its own since authorized is the default (owner
      // decision 2026-09-29).
      status: "every status",
      mod: "all modalities",
    },
    // The status token by default (owner decision 2026-09-29, "Authorized by default"): no filter.
    statusDefault: "authorized status",
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
  },
  // The filter chips under the page heading (F · Spacious, phase 1; filter-bar.js): one per
  // dimension, in this order; an inactive one reads "⊕ {name}", an active one "{name} | {value}"
  // (facets.js filterChips(), sectionSummary()) with a remove button. A chip opens its controls: a
  // popover under it on desktop (popover.js), a bottom sheet below 1024px (sheet.js).
  filters: {
    label: "Filters",
    names: {
      type: "Medicine type",
      mod: "Modality",
      atc: "ATC class",
      area: "Therapeutic area",
      mah: "Company",
      status: "Status",
      years: "Approval year",
    },
    // In the remove buttons' names and the popovers' titles.
    dimensions: {
      type: "medicine type",
      mod: "modality",
      atc: "ATC class",
      area: "therapeutic area",
      mah: "company",
      status: "status",
      years: "approval year",
    },
    remove: (key, value) => `Remove ${UI.filters.dimensions[key]} filter: ${value}`,
    popoverTitle: (key) => `Filter by ${UI.filters.dimensions[key]}`,
    // After the chips while any filter is active: "[2] active filters · Clear filters" (the number
    // in its own badge).
    active: (count) => (count === 1 ? "active filter" : "active filters"),
    clear: "Clear filters",
    // A popover's buttons: Clear resets its dimension, Done closes it.
    popoverClear: "Clear",
    done: "Done",
  },
  // Facet sections: the chips' popovers (desktop) and sheets (phones, tablets).
  facets: {
    counts: "Counts: medicines matching the other filters.",
    showMore: (count) => `Show ${formatCount(count)} more`,
    noMatches: "No matches",
    // Announced after typing in a facet search.
    matches: (count) => (count ? plural(count, "match", "matches") : UI.facets.noMatches),
    // An active chip's value (facets.js sectionSummary()): several values selected; one is named.
    selected: (count) => `${formatCount(count)} selected`,
    // The Status section with every status included (owner decision 2026-09-29).
    everyStatus: "Every status",
    // Under the Status rows: widen the default to every status, or go back to it.
    statusWiden: "Include withdrawn, refused and pending",
    statusDefault: "Authorized only",
  },
  // Below 1024px a chip opens its section in a bottom sheet, titled by the chip's name.
  sheet: {
    show: (count) => `Show ${plural(count, "medicine", "medicines")}`,
    clear: "Clear",
    close: "Close filters",
  },
  allYears: "All years",
  yearRange: (from, to) => (from === to ? `${from}` : `${from}–${to}`),
  // The approval year filter (the Approval year chip's popover or sheet, F · Spacious): a slim
  // one-colour histogram of every medicine with an approval date (aria-hidden; the summary is read
  // instead; a tooltip per bar, UI.years.tooltipTitle()) above a two-thumb slider.
  yearStrip: {
    start: "Start year",
    end: "End year",
    summary: (first, last, total, peakYear, peakCount) => (total === 0
      ? "No medicines with an approval date match the other filters."
      : `Approvals per year, ${first} to ${last}, for the medicines matching the other filters: ` +
        `${formatCount(total)} in total, most in ${peakYear} (${formatCount(peakCount)}).`),
  },

  // Answer headlines: the dashboard's (home, filters, one ATC class) and the lookup results'. With a
  // status filter other than the default, the dashboard counts the medicines shown (total) and those
  // currently authorized; by default (authorized) only the medicines shown (headline.authorized).
  headline: {
    // Every status included (?status=all; owner decision 2026-09-29: the headline says so).
    home: (total, authorized) => [number(total), " medicines in the EMA data, ", number(authorized), " of them currently authorized."],
    // Owner decision 2026-09-29 ("Authorized by default"): the medicines with status Authorised, as
    // the dashboard lists them (the ones without an approval date included).
    authorized: {
      home: (count) => [number(count), ` ${count === 1 ? "medicine is" : "medicines are"} authorized EU-wide through EMA.`],
      filtered: (count) => (count === 0
        ? ["No authorized medicines match these filters."]
        : [number(count), ` authorized ${count === 1 ? "medicine matches" : "medicines match"} these filters.`]),
      atcClass: (count, label) => (count === 0
        ? [`No authorized medicines are classed ${label}.`]
        : [number(count), ` authorized ${count === 1 ? "medicine" : "medicines"} in ${label}.`]),
      area: (count, name, tag = false) => {
        const place = `${tag ? "tagged" : "in"} ${name}`;
        return count === 0 ? [`No authorized medicines are ${place}.`] : [number(count), ` authorized ${count === 1 ? "medicine" : "medicines"} ${place}.`];
      },
    },
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
      return `By status: ${listing([...shown.map(count), ...(rest ? [`${formatCount(rest)} with ${rest === 1 ? "another status" : "other statuses"}`] : [])])}.`;
    },
    // counts: countTiles() output; flag clauses with a zero count are left out.
    dek: ({ products, substances, orphan, generic, biosimilar, advancedTherapy }) => {
      if (products === 0) return null;
      const clause = (count, one, many) => (count === 0 ? null : `${formatCount(count)} ${count === 1 ? one : many}`);
      const clauses = [
        clause(orphan, "is an orphan medicine", "are orphan medicines"),
        clause(generic, "is a generic", "are generics"),
        clause(biosimilar, "is a biosimilar", "are biosimilars"),
        clause(advancedTherapy, "is an advanced therapy", "are advanced therapies"),
      ].filter(Boolean);
      const contents = `${products === 1 ? "It contains" : "They contain"} ${plural(substances, "active substance or combination", "different active substances or combinations")}.`;
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
      // F · Spacious, phase 4 (Von Restorff): the answer word in the status's colour, as "not".
      if (kind === "authorized") return [`${name} is `, { text: "authorized", tone: "authorized" }, " in the EU."];
      return [`${name} is `, kind === "pending" && opinion !== "Negative" ? NOT_YET : NOT, " authorized in the EU."];
    },
    // Substance names stay as in the data (lower-case INN) except for the first letter. Step 2 (#1):
    // the data holds EMA's central procedure only, so a substance with no medicine there (celecoxib)
    // can still be authorized nationally.
    substance: (name, count) => (count > 0
      ? [`${capitalize(name)} is in `, number(count), ` ${count === 1 ? "medicine" : "medicines"} authorized EU-wide through EMA.`]
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
  // Under the default headline (owner decision 2026-09-29), in place of the breakdown by every
  // status: the medicines of other statuses the default leaves out, and a control to include them.
  statusScope: {
    more: (count, filtered) => `${filtered
      ? `${plural(count, "more medicine", "more medicines")} matching these filters ${count === 1 ? "is" : "are"}`
      : `EMA's list also has ${plural(count, "medicine", "medicines")} that ${count === 1 ? "is" : "are"}`} not authorized: withdrawn, refused, expired or awaiting a decision.`,
    include: "Include them",
    includeLabel: "Include them: show medicines of every status",
  },
  kicker: { medicine: "Medicine", substance: "Active substance", condition: "Condition", text: "Indication text", company: "Company" },

  // The four types with their share of the medicines matching the filters (by default the authorized
  // ones); the headline states those medicines (owner decision 2026-09-29).
  tiles: [
    { key: "orphan", label: "Orphan", caption: "Medicines with an orphan designation" },
    { key: "biosimilar", label: "Biosimilar", caption: "Biosimilar medicines" },
    { key: "generic", label: "Generic", caption: "Generic medicines" },
    { key: "advancedTherapy", label: "Advanced therapy", caption: "Advanced therapy medicinal products" },
  ],
  // What a tile's share is of (copy review 2026-09-29, adapted: one caption for the four tiles, by
  // the medicines shown; the type's own description is its tip): scope "authorized" (the default
  // status and no other filter), "all" (every status, no other filter) or "filtered".
  tileShare: (scope) => ({ authorized: "Share of the authorized medicines", all: "Share of all medicines", filtered: "Share of the matching medicines" })[scope],
  undatedAuthorized: (count) =>
    `${plural(count, "authorized medicine", "authorized medicines")} without an approval date ${count === 1 ? "is" : "are"} left out of “Authorized over time” and of the currently authorized count.`,
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
  // "Stack by Status" legend entry or the Status chip names one; at most 10 words.
  statusTips: {
    // Step 2 (#16): authorized is not available or reimbursed everywhere.
    Authorised: "Can be sold EU-wide; availability and reimbursement vary by country.",
    Opinion: "EMA has given its opinion; EU decision pending.",
    "Opinion under re-examination": "EMA is re-examining its opinion at the company's request.",
    Refused: "The EU refused authorization.",
    "Application withdrawn": "The company withdrew its application before a decision.",
    "Withdrawn from rolling review": "The company stopped the early (rolling) review.",
    Withdrawn: "Authorization withdrawn, usually at the company's request.",
    Expired: "Authorization ended: not renewed.",
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
      // The About disclosure's font licence and ChEMBL citation (legal review 2026-09-30).
      "openfontlicense.org": "Open Font License website",
      "doi.org": "the article (DOI)",
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
    epar: { text: "EPAR", label: (name) => `EPAR, European public assessment report PDF for ${name}` },
  },

  // Union Register (the Commission's legal record) vs EMA's status: shown only when they disagree.
  register: {
    chip: (status, date) => `EU register: ${statusLabel(status)}${date ? ` (${formatDate(date)})` : ""}`,
    // Neutral: either source can be the one behind (e.g. Suboxone: EMA withdrawn, register still active).
    note: "EMA and the EU Union Register (the legal record) show different statuses; either can lag behind a recent decision.",
    marker: "⚠ register differs",
    // Under the top row (over time, tiles): of the medicines currently authorized.
    notAuthorized: (count) =>
      `${plural(count, "medicine", "medicines")} that EMA lists as currently authorized ${count === 1 ? "is" : "are"} no longer authorized according to the EU Union Register.`,
  },

  // Every matching medicine (by default the authorized ones).
  breakdown: {
    atc: {
      title: "Medicines by ATC group",
      // Drilled into a class (label: atcClassLabel()); a leaf shows only itself.
      titleIn: (label) => `Medicines in ${label} by ATC class`,
      titleLeaf: (label) => `Medicines in ${label}`,
      note: "A medicine with codes in several ATC classes appears in each.",
      excluded: (count) => `${plural(count, "medicine", "medicines")} without a valid ATC code ${count === 1 ? "is" : "are"} not shown.`,
    },
    area: {
      title: "Medicines by therapeutic area (MeSH branch)",
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
      note: "Companies grouped by current owner; each bar's tooltip lists the EMA holder names.",
      excluded: (count) => `${plural(count, "medicine", "medicines")} without a company ${count === 1 ? "is" : "are"} not shown.`,
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
  // The conditions card (redesign 2026-09-29; conditions-card.js): the therapeutic areas of the
  // medicines shown (all of them without a filter) as a table ranked by treatments or authorized
  // medicines, most or fewest first; each opens its condition page (a lookup, ?cond=) where its MeSH
  // descriptor is known. The title says the ranking (a proposal for the owner).
  conditions: {
    title: (sort, direction) => `Conditions with the ${direction === "asc" ? "fewest" : "most"} ${sort === "medicines" ? "authorized medicines" : "treatments"}`,
    // Each condition counted as its condition page counts, with its narrower ones (review
    // 2026-09-29). Treatments: the authorized medicines' distinct active substances (step 4, #10:
    // substance sets, so a combination counts on its own and the copy says so; review of step 4: HIV
    // Infections has 40 sets of 27 substances). within: a therapeutic area filter is set, and only
    // the conditions within it are listed. Kept short (review 2026-09-29: at 1024px it took 3 lines).
    // Broad categories are not ranked (owner decision 2026-09-29: only MeSH level 3 and deeper), and
    // the last sentence says where they are.
    // authorizedOnly: every medicine shown is authorized (the default status filter, owner decision
    // 2026-09-29).
    subtitle: (count, filtered, within = false, authorizedOnly = false) => {
      const medicines = authorizedOnly ? plural(count, "authorized medicine", "authorized medicines") : plural(count, "medicine", "medicines");
      const which = filtered ? `Conditions of the ${medicines} matching the filters` : `Conditions of all ${medicines}${authorizedOnly ? "" : " in the EMA data"}`;
      const treatments = authorizedOnly ? "their active substances or combinations" : "the active substances or combinations of the authorized ones";
      return `${which}${within ? ", within the selected areas" : ""}, each with its narrower ones; treatments are ${treatments}. Broad categories such as Neoplasms are in the therapeutic area filter.`;
    },
    headers: { condition: "Condition", treatments: "Treatments", medicines: "Authorized medicines" },
    // The sort buttons in the headers (UI.sortOrder.name() adds the order to the pressed one's).
    sortBy: { treatments: "Sort by treatments", medicines: "Sort by authorized medicines" },
    // A medicines cell: the authorized, then (muted) of every status, visually hidden what that
    // counts (review 2026-09-29: "47 of 64" did not say); its tooltip says both.
    of: (count) => `of ${formatCount(count)}`,
    everyStatus: (count) => ` ${count === 1 ? "medicine" : "medicines"} of every status`,
    // Only authorized medicines shown: the number alone (no "of"), and its tooltip.
    authorizedTip: (count) => plural(count, "authorized medicine", "authorized medicines"),
    medicinesTip: (authorized, count) => `${formatCount(authorized)} authorized of ${plural(count, "medicine", "medicines")} of every status`,
    // Phones (the header hidden): after each number, what it counts (aria-hidden: the header says it).
    treatmentsUnit: (count) => (count === 1 ? "treatment" : "treatments"),
    authorizedUnit: "authorized",
    showMore: (count) => `Show ${formatCount(count)} more`,
    // Fewest first leaves out the conditions without an authorized treatment.
    unlisted: (count) => `${plural(count, "condition", "conditions")} without an authorized treatment ${count === 1 ? "is" : "are"} not listed.`,
    // A condition page's count of the tagged medicines' substance sets (UI.condition.counts()).
    substances: (count) => plural(count, "active substance or combination", "active substances or combinations"),
    // count: the medicines shown, none of which has a therapeutic area.
    empty: (count) => {
      if (count === 0) return "No medicines match the current filters.";
      return count === 1 ? "No therapeutic area is listed for this medicine." : "No therapeutic areas are listed for these medicines.";
    },
    // count: the conditions of the medicines shown, none with an authorized medicine (e.g. only
    // withdrawn ones shown): no ranking (review 2026-09-29).
    noneAuthorized: (count) => (count === 1
      ? "The one condition of these medicines has no authorized medicine, so it is not ranked."
      : `None of the ${formatCount(count)} conditions of these medicines has an authorized medicine, so they are not ranked.`),
    // count: the conditions of the medicines shown, every one a broad category (owner decision
    // 2026-09-29: not ranked).
    onlyBroad: (count) => (count === 1
      ? "The one condition of these medicines is a broad category, not ranked here: see the therapeutic area filter."
      : `The ${formatCount(count)} conditions of these medicines are broad categories, not ranked here: see the therapeutic area filter.`),
    // Condition page links beside a therapeutic area group or term (breakdown, area tree rows).
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
    note: (date) => `Companies grouped by current owner${date ? ` as of ${formatDate(date)}` : ""}; each row's tooltip lists the EMA holder names.`,
    // Sort buttons (toggles) in their own header row: rows by holder name ("Name"), by total ("Total",
    // the default) or by a column's count (an arrow).
    sortBy: (column) => `Sort companies by ${column}`,
    sortByName: "Sort companies by name",
    sortName: "Name",
    sortTotal: "Total",
    sortByTotal: "Sort companies by total matching medicines",
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
    empty: "No medicines with an approval date match the current filters.",
    // by: what the columns are stacked by (UI.years.by).
    summary: (first, last, total, peakYear, peakCount, by) =>
      `Stacked column chart of EU approvals per year by ${by}, ${first} to ${last}: ` +
      `${formatCount(total)} medicines in total, most in ${peakYear} (${formatCount(peakCount)}).`,
    tooltipTitle: (year, total) => `${year}: ${plural(total, "approval", "approvals")}`,
    // Under the numbers a tap shows on a touch screen (bug hunt 2026-10-01 fix-up): what a second tap
    // on that year does (toggleYear()); alone: it is the one year shown, so every year comes back.
    tapAgain: (year, alone) => (alone ? "Tap again to show every year." : `Tap again to show only ${year}.`),
    stack: {
      label: "Stack by",
      modes: { type: "Medicine type", atc: "ATC", mah: "Company", status: "Status", mod: "Modality" },
      // Under the default status filter (authorized only) Status would be one series, so it is not
      // offered (owner decision 2026-09-30); the panel says how to get it, its button widening the
      // status filter (described by the words after it).
      statusHint: {
        button: "Include withdrawn, refused and pending",
        after: " to stack by status.",
      },
    },
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
        ? `: the top ${plural(count, "class", "classes")}, the rest as Other classes`
        : ""}`,
      mah: (count, other) => `each medicine counted once${other
        ? `: the top ${plural(count, "company", "companies")}, the rest as Other companies`
        : ""}`,
      status: "each medicine counted once, by its current status",
      mod: "a medicine whose substances have several modalities is counted in each",
    },
    // Step 4 (#17): EMA's annual reports count CHMP opinions (by the opinion's year), so their totals differ.
    note: (counting) =>
      `Year of EU marketing authorization; ${counting}. ${YEARS_HOW_TO}`,
    // Stacked by status (owner call 2026-09-30): the colors are each medicine's status today.
    noteStatus: `Each medicine once, in the year it was first approved; colors show its status today. ${YEARS_HOW_TO}`,
    // Stacked by status, before the legend's "Bottom to top:" (owner call 2026-09-30).
    legendHeading: "Status today",
    // The card's title (owner call 2026-09-30; was "Approvals per year").
    title: "Medicines by year of approval",
    // The segment on top of the stacks beyond the top ones.
    other: { atc: "Other classes", mah: "Other companies" },
    // The segment on top for the medicines a mode cannot place, so every mode gives the same yearly
    // totals: no ATC code; with one ATC class selected, coded only down to it; no company.
    unplaced: { atc: "No ATC code", atcIn: (code) => `Coded only as ${code}`, mah: "No company", mod: "No modality" },
  },

  overTime: {
    // Owner decision 2026-09-29: authorization history, whatever a medicine's status now, so the status
    // filter does not apply (nor the year filter: the chart shades the range).
    subtitle: "Authorized medicines and their active substances or combinations at each month end, those withdrawn since included. All filters apply except the status and the approval years, which are shaded.",
    products: "Authorized medicines",
    substances: "Active substances or combinations",
    excluded: (count) =>
      `${plural(count, "medicine", "medicines")} with an ended status but no end date ${count === 1 ? "is" : "are"} excluded.`,
    summary: (last, products, substances) =>
      `Line chart of authorized medicines and their active substances or combinations over time; on ${last}: ` +
      `${formatCount(products)} medicines and ${formatCount(substances)} active substances or combinations.`,
    range: "Selected approval years",
  },

  table: {
    // Owner decision 2026-09-30: a status dot column first (its header visually hidden), then a
    // narrow "Approved" date column, in place of "Approved · Status".
    headers: [
      "Status",
      "Medicine",
      "Company · Holder",
      "Approved",
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
    // The Approved column: a medicine without an approval date ("No approval date" on phones, where
    // no header names the column); on phones a date follows "Approved".
    noDate: "No date",
    noApprovalDate: "No approval date",
    approved: "Approved",
    // The status dots' shapes, after the caption when the status filter is not the default (review of
    // the status dot, 2026-09-30); keys: badges.js statusShape().
    shapesKey: {
      lead: "Status shapes:",
      filled: "authorized",
      ring: "ended",
      half: "awaiting decision",
      cross: "never authorized",
    },
    incomplete: "incomplete",
    incompleteTitle: "Incomplete code: not at WHO's most specific level, or not a valid ATC code",
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
      "Company group", "EMA holder name", "ATC codes", "Therapeutic areas",
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
    // The ATC tree (its chip's popover or sheet): a search (not a filter), expand buttons, checkboxes.
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
    // The two static rows' explainers (owner feedback 2026-09-29: every row of the tree explains
    // itself).
    incompleteTip: "Medicines coded only down to this class: their ATC code has no more specific level.",
    codedHereTip: "Medicines whose complete ATC code is this class itself.",
    // A tree row's explainer (owner feedback 2026-09-29; atc.js atcClassTip()): its level (not the
    // class's code and name, which the row or bar beside it already shows: owner feedback
    // 2026-10-01) with WHO's meaning for it (WHOCC, ATC structure and principles: 2nd levels pharmacological or
    // therapeutic groups, 3rd and 4th chemical, pharmacological or therapeutic subgroups), the class
    // above it by its code (owner decision 2026-09-29: shorter tips), and a retired (atc_classes.json
    // replaced_by, changed_year; now null: deleted) or temporary code's status. Since the ATC class
    // explanations (owner decisions 2026-09-29) this is the tip's second line, after the class's
    // explanation (atc_class_explanations.json; levels 1-4), where it has one.
    levels: {
      1: "anatomical main group",
      2: "pharmacological or therapeutic subgroup",
      3: "chemical, pharmacological or therapeutic subgroup",
      4: "chemical, pharmacological or therapeutic subgroup",
      5: "chemical substance",
    },
    classTip: (level, parentCode) => `ATC level ${level}, ${UI.atc.levels[level]}${parentCode ? `, in ${parentCode}` : ""}.`,
    retired: (year, now) => `Retired${year ? ` ${year}` : ""}, ${now ? `now ${now}` : "with no successor"}.`,
    temporary: "On WHO's temporary list: it can still change.",
    note: "Retired codes count under the class WHO moved them to. Missing or incomplete EMA codes are filled in where possible: from the product information (SmPC), else from WHO's ATC index, its temporary list or the SmPC text, checked by hand.",
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

  // The therapeutic-area tree (phase 4f; areas.js, area-tree.js): MeSH category › branch › level 2 ›
  // level 3 › EMA's terms, in its chip's popover or sheet, the breakdown's path and the activity card.
  areas: {
    // The MeSH categories, the tree's top level (owner decision 2026-09-29), by a branch code's
    // letter: NLM's names verbatim, from the MeSH Tree Structures (https://meshb.nlm.nih.gov/treeView).
    categories: {
      A: "Anatomy",
      B: "Organisms",
      C: "Diseases",
      D: "Chemicals and Drugs",
      E: "Analytical, Diagnostic and Therapeutic Techniques, and Equipment",
      F: "Psychiatry and Psychology",
      G: "Phenomena and Processes",
      H: "Disciplines and Occupations",
      I: "Anthropology, Education, Sociology, and Social Phenomena",
      J: "Technology, Industry, and Agriculture",
      K: "Humanities",
      L: "Information Science",
      M: "Named Groups",
      N: "Health Care",
      V: "Publication Characteristics",
      Z: "Geographicals",
    },
    // A category's explainer (owner feedback 2026-09-29; areas.js areaCategoryTip()): no descriptor
    // holds a category, so it has no NLM scope note; branches: its branch codes in the data, in order.
    categoryTip: (name, letter, branches) => `${name} (MeSH category ${letter}): the top level of the MeSH tree; ${branches.length === 1
      ? `its branch here: ${branches[0]}`
      : `its branches here: ${branches[0]}–${branches.at(-1)}`}.`,
    find: "Find a therapeutic area",
    tree: "Therapeutic areas",
    expand: (name) => `Areas in ${name}`,
    // Rows, path items: the area and its count of medicines.
    count: (name, count) => `${name}, ${plural(count, "medicine", "medicines")}`,
    // A tree row's name (owner decision 2026-09-29): the area, then the MeSH tree number its badge
    // shows (null: none known), "Neoplasms by Site, C04.588".
    numbered: (name, number) => (number ? `${name}, ${number}` : name),
    // An area under a checked one (on some path): checked and disabled.
    included: (name, count, ancestor) => `${UI.areas.count(name, count)}, included in ${ancestor}`,
    noMatches: "No matching therapeutic areas",
    // The medicines tagged with the node's own term: a static last row.
    notMoreSpecific: "tagged at this level",
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
    note: "MeSH categories, branches and two more levels, then EMA's terms, each with its tree number. A medicine counts once in every area that holds one of its terms, so sub-areas need not add up to their parent. MeSH: Medical Subject Headings, from the U.S. National Library of Medicine.",
    all: "All therapeutic areas",
    path: "Therapeutic area path",
    // Branch chips after each condition (owner decision 2026-09-29; area-chips.js): a toolbar of
    // filter toggles per condition, then "+n" naming the branches behind it (tooltip, hidden text).
    chips: (term) => `MeSH branches of ${term}`,
    chipFilter: (code, name) => `Filter by therapeutic area ${code} ${name}`,
    // On the lookup's cards a chip opens its branch's condition page (Laws of UX, second pass, owner
    // decision 2026-09-30), as the area tree's link for the branch; without a page, its name alone.
    chipLink: (code, name) => `Open condition page: ${code} ${name}`,
    chipName: (code, name) => `${code} ${name}`,
    chipsMore: (count) => `+${count}`,
    chipsRest: (branches) => `Also in ${branches.map(({ code, name }) => `${code} ${name}`).join("; ")}`,
    // A chip under a selected category (review 2026-09-29): pressed and disabled, as the tree's
    // included row; its description (a hidden element) and its tooltip.
    chipIncluded: (category) => `included in ${category}`,
    chipIncludedTip: (name, category) => `${name}, included in ${category}`,
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
    small_molecule: "Small chemical compound with a well-defined structure.",
    protein: "Chain of amino acids, made by living cells or synthesis.",
    peptide: "Short chain of amino acids, often made by synthesis, such as semaglutide.",
    hormone_cytokine: "Lab-made form of a natural signaling protein, such as insulin.",
    enzyme: "Protein that speeds up a chemical reaction, often replacing a missing one.",
    coagulation_factor: "Blood-clotting protein, such as factor VIII or fibrinogen.",
    fusion_protein: "Two proteins joined into one, often with an antibody part.",
    other_protein: "Other protein medicine, such as botulinum toxin or antithrombin.",
    antibody: "Immune protein that binds a precise target.",
    monoclonal_antibody: "Lab-made antibody that binds one target.",
    adc: "Antibody that carries a cell-killing drug or toxin to its target.",
    bispecific_antibody: "Antibody built to bind two different targets at once.",
    antibody_fragment: "Smaller piece of an antibody that still binds its target.",
    polyclonal_immunoglobulin: "Mix of many antibodies purified from human or animal blood.",
    nucleic_acid: "Strand of RNA or DNA; most change which proteins cells make.",
    mrna: "Messenger RNA that tells cells to make a protein.",
    sirna: "Short double-stranded RNA that silences one gene.",
    antisense: "Short single strand that binds one RNA to block or fix it.",
    aptamer: "Folded nucleic acid strand that binds a target like an antibody.",
    other_oligonucleotide: "Other short DNA or RNA medicine, such as defibrotide.",
    cell_gene: "Advanced therapy made from living cells, tissue or genes.",
    car_t: "Patient's T cells engineered to find and kill cancer cells.",
    gene_modified_cells: "Cells given a new or edited gene outside the body.",
    gene_therapy: "Virus or DNA that delivers a gene into the body's cells.",
    other_cell_therapy: "Living cells, not genetically modified, given as a treatment.",
    tissue_engineered: "Cells grown into tissue that repairs or replaces damaged tissue.",
    vaccine: "Trains the immune system against a germ; mRNA vaccines are under mRNA.",
    live_vaccine: "Weakened live germ, or a related virus, that trains immunity.",
    inactivated_vaccine: "Killed germ or purified germ parts; cannot cause the infection.",
    vector_vaccine: "Modified virus carrying a gene for one of the germ's proteins.",
    radiopharmaceutical: "Medicine with a radioactive atom, used for scans or treatment.",
    diagnostic_radiopharmaceutical: "Radioactive tracer that shows disease on a scan.",
    therapeutic_radiopharmaceutical: "Carries radiation to diseased cells to destroy them.",
    other: "Other kinds of medicine, such as allergen extracts, heparins and polymers.",
    allergen: "Allergen given in rising doses to calm an allergy.",
    polysaccharide: "Chain of sugar units, such as heparin.",
    plant_extract: "Extract of a plant, such as birch bark.",
    polymer: "Large synthetic chain of repeating units, such as sevelamer.",
  },
  // The modality tree (its chip's popover or sheet; modality-tree.js), the breakdown's path and the medicine and
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
    note: "What kind of medicine each active substance is: groups, then kinds. From WHO INN stems (name parts such as -mab, for antibodies), ChEMBL, EMA data and checks by hand. A medicine counts in every modality of its substances.",
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
      // The rule's words (ema_medicine_modalities.json "text:…", kept as they are) as what EMA's text names.
      text: (detail) => `EMA text naming ${TEXT_RULE_WORDS[detail] ?? (detail.startsWith("vaccine ") ? `a ${detail.slice(8)} vaccine` : detail)}`,
      // After the evidence's link: "Source: EPAR public assessment report (checked by hand)".
      curated: " (checked by hand)",
      curatedNoLink: "Checked by hand",
    },
    // A curated row's evidence, by the document its link opens (modalities.js evidenceDocument()).
    documents: {
      productInformation: "Product information (SmPC)",
      epar: "Public assessment report (EPAR)",
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
          ? [holder === null ? "EMA names no holder" : `EMA: ${holder}`, `EU register: ${register}, a regulatory representative`]
          : [`via a regulatory representative: ${holder}`];
        return [...(company?.name && company.name !== shown ? [company.name] : []), ...held].join(" · ");
      }
      const parts = basis === "register" && register
        ? [holder === null ? "EMA names no holder" : `EMA: ${holder}`, `EU register: ${register}`]
        : holder === null || holder === shown ? [] : [holder];
      if (representative) parts.push("a regulatory representative, holding for another company");
      return parts.length ? parts.join(" · ") : null;
    },
    // Before a plain EMA holder name, for screen readers, and its tooltip.
    emaHolder: "EMA holder name: ",
    holderTitle: "The holder name as EMA publishes it",
    // The results timeline's tooltip: the group, then EMA's name when it differs.
    tipHolder: (group, holder) => (holder === null || group === holder ? group : `${group} (${holder})`),
    // The company tree's and breakdown's static row: a company's medicines EMA names no holder for.
    noHolder: "No EMA holder name",
    // A row's value that also shows under another group, named with its group (the Company chip).
    inGroup: (name, group) => `${name} (${group})`,
    // An EMA holder name as a filter value (the Company chip; a company can have the same name),
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
    expand: (name, byHolder) => `${byHolder ? "EMA holder names of" : "Companies in"} ${name}`,
    count: (name, count) => `${name}, ${plural(count, "medicine", "medicines")}`,
    included: (name, count, ancestor) => `${UI.companies.count(name, count)}, included in ${ancestor}`,
    noMatches: "No matching companies",
    note: (date) => `Grouped by current owner${date ? ` (as of ${formatDate(date)})` : ""}, then company, then EMA holder name. A level that only repeats a name is left out.`,
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
    representative: "A regulatory representative: it holds medicines for other companies.",
    asOf: (date) => `Grouped by current owner as of ${formatDate(date)}, not the owner at approval. Each medicine keeps its EMA holder name.`,
    // The medicine card's fact.
    asOfShort: (date) => `Company group as of ${formatDate(date)} (the current owner).`,
    // Provenance (curated notes are fragments; a sentence ends with one full stop): why a
    // per-medicine row put the medicine under its group, a plain note on a medicine's later
    // ownership (group_note without a move: no "Why"), a curated sponsor behind a regulatory
    // representative (its evidence link alone when there is no note), each followed by a link to
    // its evidence ("Source"); a sponsor renamed since, whose note names the rename ("AcelRx
    // (renamed Talphera in 2024)"), then a second link to the rename's evidence ("Rename source").
    // On phones a long note sits behind a disclosure: its summary, then the note alone (noteBody).
    why: (group, note) => `Why ${group}: ${sentenceOf(note)}`,
    // Not "note": that key is the company tree's note above (QA 2026-09-29: a second "note" replaced it).
    groupNote: (note) => `Ownership: ${sentenceOf(note)}`,
    sponsor: (note) => `Sponsor: ${sentenceOf(note)}`,
    whySummary: (group) => `Why ${group}?`,
    noteSummary: "Ownership",
    sponsorSummary: "Sponsor",
    noteBody: (note) => sentenceOf(note),
    sponsorEvidence: "Sponsor source",
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
    namesHint: "Each lists its medicines in the overview's Medicines tab.",
    atc: "ATC groups",
    atcHint: "Each opens the overview's Classes and areas tab, filtered to this company and ATC group.",
    areas: "Most common conditions",
    // The medicine list: authorized ones (as condition pages), or every status (the "Show all
    // statuses" toggle, or a company with no authorized medicine).
    medicines: (count, everyStatus) => `${everyStatus ? "Medicines of every status" : "Authorized medicines"} (${formatCount(count)})`,
    // A mix row's link: the group or area, then its count.
    mixLink: (label, count) => `${label}, ${plural(count, "medicine", "medicines")}`,
    sources: "Sources",
    lei: (lei) => `LEI (legal entity identifier) ${lei}`,
    legalName: (name) => `Legal name (GLEIF): ${name}`,
    parent: (name) => `Ultimate parent reported to GLEIF: ${name}`,
    sourceNames: { ema: "EMA holder names", union_register: "the EU Union Register", curated: "company groups checked by hand", gleif: "GLEIF LEI records" },
    from: (sources) => `From ${listing(sources)}.`,
  },

  offline: (date) => `Offline: data as of ${formatDate(date)}`,

  // The header's theme button (theme.js; owner request 2026-09-28): an icon of the scheme shown; a
  // press shows the other one (nextTheme()). button: its name; hint: its tooltip (theme: the stored
  // choice, Auto following the device).
  theme: {
    names: { light: "Light", dark: "Dark" },
    button: (shown) => `Theme: ${UI.theme.names[shown]}`,
    // stores: the press stores a choice (legal review 2026-09-30: said next to the control); a press
    // back to Auto removes it.
    hint: (theme, shown, stores = false) => {
      const other = shown === "dark" ? "light" : "dark";
      const follows = theme === "auto" ? " (follows your device)" : "";
      return `Theme: ${UI.theme.names[shown]}${follows}. Select to switch to ${UI.theme.names[other]}${stores ? " (remembered on this device)" : ""}.`;
    },
  },

  lookup: {
    // The search field (landing, 2026-09-28): plain words; ATC codes still work, so its name says so.
    placeholder: "Drug name, active substance or condition",
    label: "Search by drug name, active substance, condition, company or ATC code",
    // fuzzy: close names when nothing matched (step 2, #5); text: the name of the last group, the
    // indication-text search (#14), which has no visible heading.
    groups: {
      medicines: "Medicines", substances: "Substances", conditions: "Conditions", classes: "Drug classes", companies: "Companies",
      fuzzy: "Did you mean", text: "Indication text search",
    },
    // Laws of UX, second pass (owner decision 2026-09-30): on phones a group shows a few suggestions,
    // then this option expanding it in place (search.js collapseGroups()), announced when it does.
    // count: the suggestions it adds, not "all" (review of PR #39: a group is capped at
    // MAX_SUGGESTIONS, so more can match than the list holds).
    groupNouns: {
      medicines: ["medicine", "medicines"], substances: ["substance", "substances"], conditions: ["condition", "conditions"],
      classes: ["drug class", "drug classes"], companies: ["company", "companies"],
    },
    moreOf: (count, group) => `${formatCount(count)} more ${(UI.lookup.groupNouns[group] ?? ["suggestion", "suggestions"])[count === 1 ? 0 : 1]}`,
    showMore: (count, group) => `Show ${UI.lookup.moreOf(count, group)}`,
    expanded: (count, group) => `Showing ${UI.lookup.moreOf(count, group)}`,
    // opinion: EMA's opinion (statusOpinionLabel()), once ema_medicines.json has loaded.
    medicineMeta: (status, year, opinion = null) => [statusOpinionLabel(status, opinion), year].filter(Boolean).join(" · "),
    // synonym: another name of the substance that matched (#19: "adrenaline" for epinephrine);
    // count: its medicines with status Authorised, as the other groups count (bug hunt 2026-10-01),
    // under all its spellings, as its card counts (copies.js substanceAuthorizedCount()).
    substanceMeta: (count, synonym = null) => [synonym ? `matches “${synonym}”` : null, `${formatCount(count)} authorized`].filter(Boolean).join(" · "),
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
      known: (name, code) => `${name} (ATC ${code}): no medicine with it went through EMA's central procedure, but it may be authorized nationally.`,
      noText: (query) => `No indication text mentions “${query}”.`,
      otherStatuses: (count) => `No currently authorized medicine mentions it in its indication; ${plural(count, "medicine", "medicines")} of another status ${count === 1 ? "does" : "do"} (Show all statuses).`,
      sameClass: "Medicines in the same drug class: ",
      names: "Matching names: ",
      didYouMean: "Did you mean: ",
      searchable: "Search by brand name, active substance (such as pembrolizumab), condition, company or ATC code.",
      notYet: "Not searchable yet: development codes (such as MK-3475) and brand names used outside the EU.",
      notInData: "Not in the data: medicines authorized only nationally. Find them in the ",
      registers: "national medicine registers",
      registersAfter: " (EMA's list). A medicine authorized through EMA has an EU number (EU/1/…) on its pack.",
    },
    conditionMeta: (synonym, count) => [synonym ? `matches “${synonym}”` : null, `${formatCount(count)} authorized`].filter(Boolean).join(" · "),
    classMeta: (count, unnamed = false) => [unnamed ? NO_ATC_NAME : null, `${formatCount(count)} authorized`].filter(Boolean).join(" · "),
    // synonym: the other name that matched (a company, spelling or EMA holder name of the group).
    companyMeta: (synonym, count) => [synonym ? `matches “${synonym}”` : null, `${formatCount(count)} authorized`].filter(Boolean).join(" · "),
    noMatches: "No matches",
    matches: (count) => plural(count, "suggestion", "suggestions"),
    // 2026-09-29: the viewer's last lookups (recent.js), listed while the search field is focused and
    // empty; kinds name each entry's kind in its meta line; Clear (named in full) empties the list.
    recent: {
      // Kept in localStorage, never sent (legal review 2026-09-30: said where the list shows).
      label: "Recently viewed (kept on this device)",
      kinds: { medicines: "Medicine", substances: "Active substance", conditions: "Condition", companies: "Company", classes: "Drug class" },
      clear: "Clear",
      clearName: "Clear recently viewed",
      status: (count) => `Recently viewed: ${plural(count, "item", "items")}`,
      cleared: "Recently viewed cleared",
    },
    // Also the line under the search list while the conditions, drug classes or companies load,
    // announced while nothing matches yet, and what Enter announces while it waits for them (bug
    // hunt 2026-10-01).
    loading: "Loading…",
    notAvailable: "Not available right now.",
    // Home state only: example lookups (ids checked against the data 2026-09-26), each followed by
    // the kind of thing it is (landing, 2026-09-28).
    tryLead: "Try",
    examples: [
      { label: "Keytruda", kind: "brand", patch: { med: "EMEA/H/C/003820" } },
      { label: "semaglutide", kind: "active substance", patch: { sub: "semaglutide" } },
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
    kinds: { medicine: "medicine", substance: "active substance", condition: "condition", company: "company" },
    documentMeta: (isPdf, date) => [isPdf ? UI.card.pdf : null, UI.card.updated(date)].filter(Boolean).join(" · "),
    substances: "Active substance(s)",
    // The medicine's company group and holder (companies part 2), with the groups' as-of date; the
    // Status blocks' label too (it leads with the company group, as the table's "Company · Holder").
    company: "Company",
    type: "Medicine type",
    atc: "Drug class (ATC)",
    areas: "Therapeutic areas",
    fullIndication: "Show full indication",
    // F · Spacious, phase 4: the Status block's first three conditions (with their branch chips since
    // 2026-09-30), then this button, which opens More details at the full list; hidden: the rest of
    // its name.
    moreAreas: (count) => ({ text: `and ${formatCount(count)} more`, hidden: count === 1 ? " therapeutic area" : " therapeutic areas" }),
    // F · Spacious, phase 4 (Miller's Law / chunking): the card's three blocks and, after them, the
    // indication's (what it is for); then one disclosure at the end holding the rest (its hint says what).
    blocks: { status: "Status", protection: "Protection and copies", documents: "Documents", indication: "Indication" },
    more: {
      summary: "More details",
      // Short, as it is the summary's name; documents: More details holds the documents list (a
      // medicine with product information buttons; the others have it in the Documents block).
      hint: (documents) => `All therapeutic areas, substances, type, modality, ATC, protection estimate${documents ? ", documents" : ""}`,
      about: "About this medicine",
      allDocuments: "All documents",
    },
    // The Status block's lead after the status pill: "since 6 Jan 2022" while authorized, else
    // "approved 26 Jul 2016".
    since: "since",
    approvedOn: "approved",
    // A substance's Status lead: the "2 authorized" pill, then "first approved 20 Nov 2006" (the first of them).
    firstApproved: "first approved",
    // After the protection lead of a medicine's own estimate ("Market protection until 2028–2029 (est.)").
    estimate: "(est.)",
    // Another medicine with the same name (the refused and the authorized Mylotarg): a link to its
    // card, then its status; documents: the namesake's documents EMA lists under this one.
    namesake: {
      link: (name, number) => `Another medicine named ${name} (${number})`,
      authorized: (date) => ` has been authorized since ${formatDate(date)}.`,
      other: (status) => `: ${statusLabel(status)}.`,
      documents: (count) => `${plural(count, "later document", "later documents")} EMA lists here ${count === 1 ? "belongs" : "belong"} to `,
      documentsLink: (name) => `the other ${name}`,
    },
    pdf: "PDF",
    updated: (date) => (date ? `updated ${date}` : null),
    medicinePage: "EMA medicine page",
    noDocuments: "No EPAR documents listed.",
    // The Status lead's qualifier chips on 320px phones (2026-09-30: two full names took two lines
    // there): shown only, the full name (flags) stays the one read and the tip explains it.
    flagsShort: {
      conditional_approval: "Conditional",
      exceptional_circumstances: "Exceptional",
      additional_monitoring: "Monitoring",
    },
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
    // Step 4 (#12): after a positive opinion's sentence; days: meta.json opinion_to_decision.median_days.
    decisionUsually: (days) => `The EU decision usually comes about ${formatCount(days)} days after the opinion.`,
    // Review of step 4: a positive opinion past the median, by the data's date; beyondMost: past the
    // 90th percentile of the last 5 years' decisions (opinion_to_decision.p90_days).
    waited: (days, beyondMost) => `This one has waited ${formatCount(days)} days so far${beyondMost ? "; 9 in 10 decisions of the last 5 years came sooner" : ""}.`,
    // Step 4 (#15): the SmPC, EPAR and overview buttons (the documents list keeps UI.documents).
    buttons: {
      productInformation: "Product information (SmPC and package leaflet)",
      epar: "Public assessment report (EPAR)",
      overview: "Plain-language overview",
    },
  },
  // Pivotal results (medicine card; efficacy.js): per-trial effects extracted automatically from the
  // product information. Numbers are shown as printed there; no word about significance is added.
  efficacy: {
    title: "Pivotal results",
    auto: "Extracted automatically from the product information; check the source.",
    caveat: "Results come from different trials, populations and comparators; not a head-to-head comparison.",
    teaser: (trial, endpoint, effect, comparator) =>
      [`${trial ? `Pivotal trial ${trial}` : "Pivotal trial"}:`, endpoint, effect, comparator ? `vs ${comparator}` : ""].filter(Boolean).join(" "),
    // endpoint and effect may be empty or null (no value): left out with their comma.
    teaserSingleArm: (trial, endpoint, effect) =>
      `${[`${trial ? `Pivotal trial ${trial}` : "Pivotal trial"}:`, endpoint, effect].filter(Boolean).join(" ")}${endpoint || effect ? "," : ""} single-arm`,
    moreIndications: (count) => `and results for ${formatCount(count)} more ${count === 1 ? "indication" : "indications"}`,
    subgroup: "subgroup (matches EU indication)",
    broader: "whole trial (EU indication is narrower)",
    otherPopulation: "population differs from the EU indication",
    // A group whose rows name no indication (the extractor found none to tie them to).
    noIndication: "Indication not stated",
    regimen: (regimen, comparator) => [regimen, comparator ? `vs ${comparator}` : "single-arm"].filter(Boolean).join(regimen && !comparator ? ", " : " "),
    // "n = 279" kept on one line (no-break spaces).
    armSize: (text, n) => (n === null || n === undefined ? text : `${text} (n = ${formatCount(n)})`),
    endpoint: (name, assessment, primary) => [name, assessment ? `assessed by ${assessment}` : null, primary ? "primary endpoint" : null].filter(Boolean).join(", "),
    // The analysis's role as the extractor read it, before the source's own words (its data cut).
    roles: { primary: "Primary analysis", later: "Later analysis", exploratory: "Exploratory analysis" },
    analysisLine: (role, text) => (role && text ? `${role}: ${text}` : role || text || null),
    analysis: (text) => (text ? String(text) : null),
    source: (page) => (page ? `Source: product information, p. ${page}` : "Source: product information"),
    more: "More results",
    moreResults: (count) => `More results (${formatCount(count)})`,
    // After the teaser's text, for screen readers: where the link goes.
    teaserLink: ", see the results in More details",
    stale: (date) => `From the product information of ${formatDate(date)}; EMA has updated it since.`,
    endpointNames: {
      OS: "overall survival",
      PFS: "progression-free survival",
      EFS: "event-free survival",
      DFS: "disease-free survival",
      ORR: "response rate",
      DoR: "duration of response",
      pCR: "pathological complete response",
      MPR: "major pathological response",
    },
    // Effect wording; the values and the confidence level are printed as the source gives them.
    effectHr: "HR",
    effectNonInferiority: "non-inferiority",
    effectDifference: "difference",
    percentagePoints: "percentage points",
    effectResponseRate: "response rate",
    effectMedian: "median",
    ci: (level) => (level === null || level === undefined ? "CI" : `${level}% CI`),
    range: "range",
    vs: "vs",
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
    epar: "Public assessment report (EPAR)",
    scientificDiscussion: "Scientific discussion",
    variations: (count) => `Assessment reports on changes after authorization (${formatCount(count)})`,
    overview: "Plain-language overview",
    rmpSummary: "Risk management plan summary",
    proceduralSteps: "Procedural steps after authorization",
    archive: (label) => `${label} (archive)`,
  },

  protection: {
    title: "EU regulatory protection (est.)",
    status: { protected: "Protected", ended: "Ended", unclear: "Unclear" },
    // QA 2026-09-29 (#1): a copy's chip and protection lead (basis follows_reference or
    // reference_not_found): its status and dates are its reference's, never its own.
    noneOfItsOwn: "None of its own",
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
    countedFromReference: (reference, date) => `Counted from the approval of its reference medicine, ${reference}: ${formatDate(date)}`,
    countedAsReference: (reference, substance, name, date) =>
      `As for its reference medicine ${reference}, counted from the first central EU approval of ${substance ?? "its active substance"}: ${name ? `${name}, ` : ""}${formatDate(date)}`,
    // 2026-09-29: a pediatric-use marketing authorization (basis paediatric_use,
    // ema_curated_pumas.json) has protection of its own, counted from its own approval, not from
    // its substance's first central approval (Alkindi 2018, hydrocortisone's Plenadren 2011); then
    // a link to its public assessment report (copyEvidence).
    paediatricUse: (date) => `A pediatric-use marketing authorization (for children): protection counted from its own approval, ${formatDate(date)}`,
    follows: (name) => `No protection of its own; the dates below are for its reference medicine, ${name}`,
    // Backlog (step 4 review): a curated copy of a central reference says what it is (type: the
    // row's copy_type), then links the EMA page that says so (copyEvidence), as nationalReference.
    curatedFollows: (type, name) => `No protection of its own; a ${copyTypeWord(type)} of ${name}.`,
    referenceNotFound: "No protection of its own; its reference medicine was not found among EU central authorizations",
    // Step 4 review: a curated copy of a nationally authorized medicine (no central reference);
    // type: the row's copy_type; then a link to the EMA page that says so (copyEvidence).
    nationalReference: (type, name) =>
      `No protection of its own; a ${copyTypeWord(type)} of ${name} (authorized nationally, so no EU central date to count from).`,
    copyEvidence: "Source",
    // Step 3 (#6): counted from another company group's earlier medicine of the same substance set
    // (basis other_company_reference; own: the medicine's own group's first approval date, or
    // null). The status is unclear where the two estimates' statuses differ, else protected (step 3
    // review), so the line does not say which.
    otherCompany: (substance, name, date, own) =>
      `The first central EU approval of ${substance} was another company's medicine (${name ? `${name}, ` : ""}${formatDate(date)}). Counted from this company's own first approval${own ? ` (${formatDate(own)})` : ""}, protection would end later; the market protection range covers both.`,
    // Step 3 (#7, e): the estimate's basis, next to the chip (it used to sit in the collapsed caveats).
    basisNote: "Estimated from EU central (EMA) approval dates only; earlier national authorizations are not counted.",
    // The medicine card's protection lead (protectionGlance(); the answer strip's "Protection (est.)"
    // cell before F · Spacious, phase 4): the market protection
    // range's years while protected, else the status; then orphan exclusivity still running.
    // link: after the value, for screen readers (the medicine card's protection lead opens the
    // estimate in More details; F · Spacious, phase 4).
    // A copy's cell: the reference it follows, then, while that is protected, the reference's
    // years as secondary text (QA 2026-09-29, #1).
    // Laws of UX, second pass (owner decision 2026-09-30): the lead names what runs until then, so
    // "Until 2031–2032" is not read as "generics from 2031"; "ended" and "unclear" likewise.
    // label: the lead's first words, in the card's body type; the rest in the answer's.
    glance: {
      label: "Market protection",
      until: (from, to) => `Market protection until ${from === to ? from : `${from}–${to}`}`,
      ended: "Market protection ended",
      unclear: "Market protection unclear",
      follows: (name) => `Follows ${name}`,
      // An estimate like the lead's "Market protection until …" (owner decision 2026-09-30: computed dates say so).
      referenceUntil: (name, from, to) => `${name}'s protection until ${from === to ? from : `${from}–${to}`} (est.)`,
      // source: the end's end_source ("(est.)" unless the register publishes it).
      orphan: (year, source) => `Orphan exclusivity until ${year}${orphanEstimate({ source })}`,
      link: ", see the estimate in More details",
    },
    orphan: (condition, date, source, ended) =>
      `Orphan market exclusivity for ${condition}: ${ended ? "ended" : "ends"} ${formatDate(date)} ${source === "register" ? "(Union Register)" : "(est.)"}`,
    orphanNoEnd: (condition, designationStatus) =>
      `Orphan designation for ${condition}: ${designationStatus.toLowerCase()} (end date not published)`,
    patents: "Patents and supplementary protection certificates: not shown (no open EU-wide source).",
    espacenet: "Search patents on Espacenet",
    caveatsTitle: "Limits of the estimate",
    caveats: [
      "Not legal advice.",
      "The possible extra year (for a significant new indication) is not known, so market protection is shown as a range.",
      "Ignores pediatric rewards other than a pediatric-use marketing authorization's own protection, orphan exclusivity reductions and derogations.",
      "The legal basis comes from EMA's generic and biosimilar flags and from EMA documents checked by hand (hybrids and other unflagged copies, pediatric-use marketing authorizations). Copies not yet checked count as medicines of their own.",
      "The EU pharmaceutical reform (not adopted as of September 2026) would change the rules only for new applications.",
    ],
  },

  // Draft (loss-of-exclusivity calendar, 2026-09-29; protection-calendar.js): the dashboard card
  // "Estimated protection ending" and the company page's list. Estimates only, never "patent".
  protectionCalendar: {
    title: "Protection ending (est.)",
    note: `Currently authorized medicines whose EU market protection (est.) still runs, by the earliest year it can end. Select a year to list them. ${CALENDAR_CAVEATS}`,
    loading: "Loading estimates…",
    summary: (running, authorized, filtered) =>
      `${formatCount(running)} of ${formatCount(authorized)} currently authorized medicines${filtered ? " matching the filters" : ""} ${running === 1 ? "has" : "have"} market protection running (est.).`,
    none: (filtered) => `No currently authorized medicine${filtered ? " matching the filters" : ""} has estimated market protection running.`,
    // The two segments of a year's bar: what they differ in (both end that year at the earliest).
    // orphan(ends): the orphan ends the bars count ({ source }; orphanEstimateOf()).
    legend: {
      protection: "No later orphan market exclusivity",
      orphan: (ends) => `Orphan market exclusivity${orphanEstimateOf(ends)} runs later`,
    },
    bars: "Medicines by the year their estimated market protection ends at the earliest",
    // The later bar spans several years: drawn broken when longer than the widest single year's.
    clamped: "Bars share the busiest single year's scale; the broken bar spans several years and is cut to fit.",
    yearLabel: (bucket) => (bucket.key === "later" ? `${bucket.year} or later` : String(bucket.year)),
    // A year button's name: its visible year and count first (WCAG 2.5.3); orphanEnds: the year's
    // orphan ends ({ source }; orphanEstimateOf()).
    yearName: (label, count, orphan, orphanEnds = []) =>
      `${label}: ${plural(count, "medicine", "medicines")}${orphan ? `, ${formatCount(orphan)} with orphan market exclusivity${orphanEstimateOf(orphanEnds)} running later` : ""}`,
    // Under the year: its medicines with orphan market exclusivity running later, the pink segment
    // (so the split is not told by colour alone).
    yearOrphan: (count) => `${formatCount(count)} orphan`,
    // Never mixed into the years: the earliest end passed, the latest not (year: the latest of them).
    unclear: (count, year) => {
      const their = count === 1 ? "its" : "their";
      return `${plural(count, "more medicine", "more medicines")} may lose market protection${year ? ` by ${year}` : ""}: ${their} earliest estimated end has passed, ${their} latest has not. Not counted above.`;
    },
    // Estimates ended or unclear, orphan market exclusivity still running after them: a line under
    // the bars (first and last: the years it ends), its toggle and list; orphanEnds: the listed
    // medicines' orphan ends ({ source }; orphanEstimateOf()).
    orphanOnlyLine: (count, first, last, orphanEnds = []) =>
      `${plural(count, "more medicine has", "more medicines have")} orphan market exclusivity${orphanEstimateOf(orphanEnds)} running after ${count === 1 ? "its" : "their"} estimated market protection, ending ${first === last ? first : `${first}–${last}`}. Not counted above.`,
    orphanOnlyToggle: "List them",
    orphanOnlyTitle: (count, orphanEnds = []) => `Orphan market exclusivity${orphanEstimateOf(orphanEnds)} after market protection: ${plural(count, "medicine", "medicines")}`,
    orphanOnlyUntil: (orphanEnd) => `Orphan market exclusivity${orphanEstimate(orphanEnd)} until ${formatDate(orphanEnd.end)}`,
    listTitle: (label, count) => `Earliest estimated end of market protection in ${label}: ${plural(count, "medicine", "medicines")}`,
    empty: (label, filtered) => `No medicine${filtered ? " matching the filters" : ""} counted here has its earliest estimated end in ${label}.`,
    range: (min, max) => `Market protection ends (est.) ${formatDate(min)}${max && max !== min ? ` – ${formatDate(max)}` : ""}`,
    ended: (date) => `Market protection ended (est.) ${formatDate(date)}`,
    // A copy (generic, biosimilar, hybrid) with its own orphan market exclusivity (morning QA 2026-09-29).
    copyNoOwn: "No market protection of its own (a copy)",
    orphan: (orphanEnd) => `Orphan market exclusivity${orphanEstimate(orphanEnd)} runs later, until ${formatDate(orphanEnd.end)}`,
    showAll: (count) => `Show all ${formatCount(count)}`,
    // The company page (?co=): its currently authorized medicines by end year (orphan-only ones by
    // the year their orphan market exclusivity ends); unclear ones as the dashboard's line.
    company: {
      title: "Protection ending (est.)",
      note: `Its currently authorized medicines by the earliest year their EU market protection can end (est.); where only orphan market exclusivity still runs, by the year it ends. ${CALENDAR_CAVEATS}`,
      none: "None of its currently authorized medicines has estimated market protection or orphan market exclusivity running.",
      orphan: (orphanEnd) => `orphan market exclusivity${orphanEstimate(orphanEnd)} until ${orphanEnd.end.slice(0, 4)}`,
      orphanOnly: (orphanEnd) => `orphan market exclusivity${orphanEstimate(orphanEnd)} only`,
    },
  },

  substance: {
    // Step 2 (#1): central only (metformin's first EU approval was not Avandamet's).
    firstApproval: (date, name) => (date ? `First central EU approval: ${formatDate(date)} (${name})` : "No central EU approval date"),
    products: (count) => plural(count, "medicine", "medicines"),
    // Step 3 review: with other spellings (the headline and Status block count them all), the list's heading.
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

  // Step 3 (#7): the medicine card's lines in its Protection and copies block (copies.js copiesSummary()), as
  // parts: strings, and { text, link } for a link (link: the entry's position, "substance" or
  // "first"). Counted by the same substance set (equivalent spellings joined), not by EMA's
  // reference product, so Humira's biosimilars (whose reference is Trudexa) count.
  copies: {
    none: "No generic or biosimilar authorized yet.",
    // QA 2026-09-29 (#9): the card's Type fact, in place of EMA's type explanation (UI.typeTips),
    // where a curated copy type contradicts it (copies.js curatedTypeDiffers(): Riulvy, EMA
    // Generic, a hybrid of Tecfidera); type: the curated row's copy_type, reference: its reference_name.
    typeDiffers: (type, reference) => `As EMA's data lists it; its EPAR page calls it a ${copyTypeWord(type)}${reference ? ` of ${reference}` : ""}.`,
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

  // The footer and "About this site" (legal review of 2026-09-30, .remember/legal/footer-review.md;
  // not legal advice). Rendered by main.js renderFooter() in the DOM (text nodes, no HTML): a part is text, or
  // { text, url } for a link to another website (markExternal()) or, a mailto: url, an email link
  // (no new tab or marking). Every third-party credit stands in the visible first line, equally prominent (CC BY-SA 3.0 4(c): ChEMBL's too), with the licence
  // links CC BY 4.0 and CC BY-SA 3.0 require; About has the detail. The operator and contact (owner
  // decision 2026-09-30): Viktor Rognås, viktor@vrognas.com (GDPR Art. 13; footer review §2b).
  footer: {
    // mesh, chembl: meta.json's versions ("MeSH 2026", "ChEMBL_37"); date: the data's date (null
    // until meta.json has loaded).
    sources: ({ date = null, mesh = null, chembl = null } = {}) => [
      "Sources: ",
      { text: "European Medicines Agency (EMA)", url: LINKS.emaData },
      `, © EMA${date ? `, data as of ${formatDate(date)}` : ""} · MeSH® courtesy of the U.S. National Library of Medicine${mesh ? ` (${mesh})` : ""} · ATC © `,
      { text: "WHO Collaborating Centre for Drug Statistics Methodology", url: LINKS.whocc },
      " · ",
      { text: "Union Register", url: LINKS.unionRegister },
      " © European Union, ",
      { text: "CC BY 4.0", url: LINKS.ccBy },
      ", modified · ",
      { text: "ChEMBL", url: LINKS.chembl },
      `${chembl ? ` (${chembl})` : ""}, `,
      { text: "CC BY-SA 3.0", url: LINKS.ccBySa3 },
      ".",
    ],
    use: "For information only: not medical, legal or regulatory advice. Not affiliated with or endorsed by EMA, the European Commission, WHO or its Collaborating Centre, NLM, EMBL-EBI, GLEIF or Anthropic.",
    licence: [
      "Data ",
      { text: "CC BY-SA 4.0", url: LINKS.ccBySa4 },
      " (third-party values keep their own terms) · Code ",
      { text: "MIT", url: LINKS.mit },
      // A no-break space keeps "Contact:" on the address's line.
      " · No cookies or tracking · Run by Viktor Rognås · Contact: ",
      { text: "viktor@vrognas.com", url: LINKS.email },
    ],
  },

  about: {
    summary: "About this site",
    // Run-in headings of the disclosure's paragraphs.
    heads: {
      what: "What this is.",
      scope: "Scope.",
      use: "Use with care.",
      sources: "Sources and licenses.",
      privacy: "Privacy.",
      contact: "Contact.",
    },
    // A personal, non-commercial project, and who runs it (owner decision 2026-09-30; GDPR Art. 13:
    // the controller's identity, should the operator count as one of GitHub's logs).
    what: "Approval Atlas is a free, non-commercial lookup of human medicines that went through the European Medicines Agency's central procedure, run by Viktor Rognås (Sweden) as a personal project and rebuilt daily from public data.",
    // Step 2 (#1, #16): what is in the data, where a central authorization is valid, and that
    // availability and reimbursement are national.
    scope: "It covers the medicines EMA lists from its central procedure, whatever their status. Many older or common medicines are authorized country by country and are not here: check your national medicines agency. A central authorization is valid in the EU, Iceland, Liechtenstein and Norway, not the UK or Switzerland. Availability and reimbursement vary by country.",
    // The intended purpose (MDCG 2019-11: no medical purpose of its own, so not a medical device), no
    // warranty, the protection estimates (never patents), the company groups (date: their curation date).
    use: (date = null) => [
      "For information only: not medical, legal or regulatory advice, and not meant for decisions about any patient's care, so it is not a medical device. Check the official product information and ask a health professional. Approval Atlas does not recommend any medicine.",
      "Data are processed automatically and partly checked by hand; they can lag EMA or contain errors. Provided as is, without warranty.",
      "Protection dates are rough estimates from EU central approval dates only: not patent or supplementary protection certificate data, and not legal advice.",
      `Company groups show the current owner as curated here${date ? ` (as of ${formatDate(date)})` : ""}, not an official record.`,
    ],
    // One list item per source (parts). explained: the data credits the ATC class explanations (owner
    // decisions 2026-09-29); innStems: the data credits WHO's INN stems (modality, M2 phase 2);
    // efficacy: the data credits the pivotal results (extracted from EMA product information).
    sources: ({ mesh = null, chembl = null, explained = false, innStems = false, efficacy = false } = {}) => [
      ["Source: ", { text: "European Medicines Agency (EMA)", url: LINKS.emaData }, ": medicines data, EPAR documents and orphan designations. © EMA. Filtered and reshaped."],
      [{ text: "Union Register of medicinal products", url: LINKS.unionRegister }, " © European Union, ", { text: "CC BY 4.0", url: LINKS.ccBy }, ", modified: matched to EMA records."],
      [`MeSH® courtesy of the U.S. National Library of Medicine${mesh ? ` (${mesh})` : ""}; definitions verbatim.`],
      [
        "ATC codes and names © ",
        { text: "WHO Collaborating Centre for Drug Statistics Methodology", url: LINKS.whocc },
        `, Oslo: verbatim in the data, shown in title case; not for commercial distribution.${explained ? " The plain-language class explanations are Approval Atlas's own, not WHO's." : ""}`,
      ],
      [
        "ChEMBL data is from ",
        { text: "https://www.ebi.ac.uk/chembl", url: LINKS.chembl },
        `${chembl ? ` (${chembl})` : ""}, `,
        { text: "CC BY-SA 3.0", url: LINKS.ccBySa3 },
        ": molecule types, and ATC names mapped. Mendez D. et al., Nucleic Acids Res. 2019;47(D1):D930–D940, ",
        { text: "doi:10.1093/nar/gky1075", url: LINKS.chemblPaper },
        ".",
      ],
      ...(innStems ? [["Modalities from WHO INN stems (World Health Organization, 2024), read as facts in our own words, ChEMBL molecule types and EMA data, some checked by hand."]] : []),
      ...(efficacy ? [["Pivotal results: extracted automatically from EMA product information (section 5.1) with an AI model (Claude, Anthropic) and checked against the text automatically; not checked by EMA or Anthropic. Check the source."]] : []),
      ["LEI data: Global Legal Entity Identifier Foundation (GLEIF), CC0. GLEIF does not provide or endorse this site."],
      ["Fonts: Geist and Geist Mono © The Geist Project Authors, ", { text: "SIL Open Font License 1.1", url: LINKS.ofl }, "."],
      [
        "Approval Atlas's data files are licensed ",
        { text: "CC BY-SA 4.0", url: LINKS.ccBySa4 },
        ", ChEMBL-derived values adapted from CC BY-SA 3.0. Values from other sources, including WHO's ATC codes and names and quoted text, keep their own terms. Code: ",
        { text: "MIT", url: LINKS.mit },
        ".",
      ],
      ["Medicine and company names are trademarks of their owners; their use here identifies them only."],
    ],
    // What reaches GitHub (the host), and what this browser keeps (intro.js, recent.js, theme.js, the
    // service worker).
    privacy: "No cookies, analytics or tracking; searches run in your browser. The site is hosted on GitHub Pages (GitHub, Inc., USA), which logs visitors' IP addresses and, like any web server, the page addresses they request (including any search in a link), for security. This browser keeps, on this device only and never sent: your theme, whether you have seen or closed the intro, your recently viewed items (Clear removes them) and, for offline use, the site's files and data. Clearing this site's data in your browser removes them.",
    contact: [
      "Questions and corrections: ",
      { text: "viktor@vrognas.com", url: LINKS.email },
      " or ",
      { text: "GitHub issues", url: LINKS.issues },
      ". Security reports: see the ",
      { text: "security policy", url: LINKS.security },
      ".",
    ],
  },
};
