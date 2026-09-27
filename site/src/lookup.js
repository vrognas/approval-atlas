// Lookup result panel: medicine card, substance card, condition / free-text results, each led by
// a kicker, an answer headline and (medicine, substance) an answer strip.
// Data beyond the first-load search index is loaded on demand and the panel re-renders when it
// arrives ("Loading…" until then). All text goes in via text nodes: EMA text contains "<" and ">".
import { isAuthorizedNow, statusDate } from "./approvals.js";
import { atcCode, atcIncomplete, atcLadder, atcOrigin, atcPrefixCounts, atcPrefixes, mainAtcCode } from "./atc.js";
import { atcHue, atcSegments, statusHue, typeBadges } from "./badges.js";
import { groupDocuments, primaryDocuments, quickDocuments, splitNamesakeDocuments } from "./documents.js";
import {
  NOT_STATED,
  UI,
  atcClassLabel,
  atcName,
  atcOriginFlag,
  atcOriginText,
  formatDate,
  indicationLead,
  statusDateLine,
  statusKind,
  statusLabel,
  statusSentence,
  statusesByFrequency,
} from "./labels.js";
import { markExternal } from "./links.js";
import { espacenetUrl, protectionSummary } from "./protection.js";
import { buildConditions, conditionPhrases, foldSearchText, suggest, textMatches } from "./search.js";
import { renderTimeline } from "./timeline.js";
import { DEFAULT_LOOKUP, DEFAULT_STATE, classState, encodeUrl, lookupView } from "./url.js";

const FAILED = Symbol("failed");

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row[key])) groups.set(row[key], []);
    groups.get(row[key]).push(row);
  }
  return groups;
}

const PDF_URL = /\.pdf(-\d+)?$/i;

// Third-party URLs: https only, new tab, no opener or referrer; marked as leaving the site.
function externalLink(text, url) {
  if (!url?.startsWith("https://")) return text;
  return markExternal(el("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, text, PDF_URL.test(url) ? el("span", { class: "pdf" }, UI.card.pdf) : null));
}

// "PI" and "EPAR": compact links to a medicine's current product information and latest public
// assessment report. urls: quickDocuments() output, null while the documents index loads; a
// missing document gets no link (none at all: null).
export function documentLinks(name, urls) {
  const links = Object.entries(UI.documentLinks).filter(([key]) => urls?.[key]?.startsWith("https://")).map(([key, copy]) =>
    markExternal(el("a", { class: "doc-link", href: urls[key], target: "_blank", rel: "noopener noreferrer", "aria-label": copy.label(name) }, copy.text)));
  return links.length ? el("span", { class: "doc-links" }, links) : null;
}

// Headline parts (labels.js UI.headline) -> text, with toned words in spans.
export function headlineNodes(parts) {
  return parts.map((part) => (typeof part === "string" ? part : el("span", { class: `tone-${part.tone}` }, part.text)));
}

// data-focus-key: re-renders (data arriving, status toggle) give focus back to the same control.
const title = (content) => el("h2", { tabindex: "-1", "data-focus-key": "title" }, content);
const kicker = (kind) => el("p", { class: "kicker" }, UI.kicker[kind]);

// Dot and label in the status's hue; pill: on its light fill (answer strip).
const statusBadge = (status, pill = false) => el("span", { class: `status hue-${statusHue(status)}${pill ? " pill" : ""}` }, statusLabel(status));

// Each badge explains its type on hover and on a tap (tabindex -1: focusable, no tab stop).
function typeBadgeList(row) {
  const badges = typeBadges(row);
  return badges.length ? el("span", { class: "badges" }, badges.map((badge) =>
    el("span", { class: `badge hue-${badge.hue}`, "data-tip": UI.typeTips[badge.label], tabindex: "-1" }, badge.label))) : null;
}

// The medicine card has room: each type badge with its explanation as visible text, one per line
// (read by everyone, no tooltip needed).
function explainedTypes(row) {
  return typeBadges(row).map((badge) => el("span", { class: "type-explained" },
    el("span", { class: `badge hue-${badge.hue}` }, badge.label), " ", el("span", { class: "muted" }, UI.typeTips[badge.label])));
}

// Segmented ATC badge (display only: the card's ladders are the links): one segment per level, in
// the group's hue.
function atcBadge(code) {
  return el("span", { class: `atc-badge hue-${atcHue(code)}` },
    atcSegments(code).map((segment) => el("span", { class: segment.level ? `atc-seg level-${segment.level}` : "atc-seg" }, segment.text)));
}

// Answer strip: [label, value, wide] items (null items are left out); the wide one spans a row on phones.
function strip(items) {
  return el("dl", { class: "strip", "aria-label": UI.card.strip.label }, items.filter(Boolean).map(([label, value, wide]) =>
    el("div", { class: wide ? "strip-wide" : null }, el("dt", null, label), el("dd", null, value))));
}

// SmPC / EPAR as a full-width secondary button: document name (with the external-link icon), then
// "PDF · updated {date}".
function documentButton({ key, row }) {
  if (!row.url?.startsWith("https://")) return null;
  const heading = el("span", { class: "doc-button-title" }, UI.documents[key]);
  return markExternal(el("a", { class: "doc-button", href: row.url, target: "_blank", rel: "noopener noreferrer" },
    heading,
    el("span", { class: "doc-button-meta" }, UI.card.documentMeta(PDF_URL.test(row.url), formatDate(row.last_updated_date)))), heading);
}

const byDate = (direction) => (a, b) => {
  const [left, right] = [a.marketing_authorisation_date, b.marketing_authorisation_date];
  if (left === right) return a.name_of_medicine.localeCompare(b.name_of_medicine);
  if (left === null) return 1;
  if (right === null) return -1;
  return direction * left.localeCompare(right);
};
const familyOf = (row) => (row.substance_keys?.length ? [...new Set(row.substance_keys)].sort().join("|") : null);

export function createLookup(panel, { index, loadFile, navigate, snapshotDate }) {
  const DATASETS = {
    medicines: [["ema_medicines.json"], (rows) => new Map(rows.map((row) => [row.ema_product_number, row]))],
    // Rows without a code to use (atcCode()) are left out.
    atc: [["ema_medicine_atc_codes.json", "atc_classes.json"], (rows, classes) => ({
      byProduct: groupBy(rows.filter((row) => atcCode(row) !== null), "ema_product_number"),
      names: new Map(classes.map((row) => [row.atc_code, row.name])),
      retiredYears: new Map(classes.filter((row) => row.status === "retired").map((row) => [row.atc_code, row.changed_year ?? null])),
      classes,
    })],
    // Medicines currently authorized per ATC prefix, no filters: ladder counts, drug-class suggestions.
    atcCounts: [["ema_medicines.json", "ema_medicine_atc_codes.json"], (medicines, rows) => {
      const byProduct = groupBy(rows, "ema_product_number");
      return atcPrefixCounts(medicines.filter(isAuthorizedNow).map((medicine) => ({ atc: byProduct.get(medicine.ema_product_number) ?? [] })));
    }],
    areas: [["ema_medicine_therapeutic_areas.json"], (rows) => groupBy(rows, "ema_product_number")],
    conditions: [["mesh_descriptor_areas.json", "ema_medicine_therapeutic_areas.json", "ema_therapeutic_area_branches.json"],
      (descriptorAreaRows, areaRows, branchRows) => buildConditions(index, { descriptorAreaRows, areaRows, branchRows })],
    documents: [["ema_medicine_documents.json"], (rows) => groupBy(rows, "ema_product_number")],
    protection: [["ema_medicine_protection.json", "ema_medicine_orphan_exclusivity.json"], (rows, orphanRows) => ({
      byProduct: new Map(rows.map((row) => [row.ema_product_number, row])),
      orphan: groupBy(orphanRows, "ema_product_number"),
    })],
    register: [["ema_medicine_register_status.json"], (rows) => new Map(rows.map((row) => [row.ema_product_number, row]))],
  };
  const values = new Map();
  const listeners = [];
  let lastState = null;
  let renderedKey = null;
  let showAll = false;
  let showAllKey = null; // the lookup view the "Show all statuses" choice belongs to
  let focusNext = false;
  let timeline = null;
  const resizeObserver = new ResizeObserver(() => {
    if (timeline && timeline.container.clientWidth !== timeline.width) drawTimeline();
  });

  // Value, FAILED, or undefined while loading (the first call starts the load).
  function need(name) {
    if (values.has(name)) return values.get(name);
    values.set(name, undefined);
    const [files, build] = DATASETS[name];
    Promise.all(files.map(loadFile)).then((rows) => build(...rows), () => FAILED).then((value) => {
      values.set(name, value);
      for (const listener of listeners) listener(name);
      if (lastState) render(lastState, true);
    });
    return undefined;
  }
  const ready = (value) => value !== undefined && value !== FAILED;
  const pending = (value) => el("p", { class: "muted" }, value === FAILED ? UI.lookup.notAvailable : UI.lookup.loading);

  // patch: lookup keys (a card or result), or filters (a drug class on the dashboard: classState()).
  // label: an accessible name replacing the text's.
  function internalLink(text, patch, className = null, label = null) {
    const href = `?${encodeUrl({ ...DEFAULT_STATE, ...DEFAULT_LOOKUP, ...patch })}`;
    return el("a", {
      href,
      class: className,
      "aria-label": label,
      onclick: (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(patch);
      },
    }, text);
  }

  const fact = (label, content) => (content === null || (Array.isArray(content) && content.length === 0) ? null : [el("dt", null, label), el("dd", null, content)]);

  // ATC ladder of one code: a row per level (badge, name, medicines currently authorized) linking to
  // the dashboard filtered to that level alone. counts: null until loaded (rows show without
  // counts). A malformed code has no levels: its badge only.
  function atcLadderList(code, names, counts) {
    const levels = atcLadder(code, counts, names);
    if (!levels.length) return el("p", null, atcBadge(code));
    return el("ol", { class: `plain atc-ladder hue-${atcHue(code)}`, "aria-label": UI.atc.ladder(code) }, levels.map((level) => el("li", null,
      internalLink([
        el("span", { class: "ladder-rail" }, el("span", { class: `code-badge level-${level.level}` }, level.code)),
        el("span", { class: level.name ? "ladder-name" : "ladder-name no-name" }, atcName(level.name)),
        level.count === null ? null : el("span", { class: "ladder-count" }, UI.atc.count(level.count)),
      ], classState(level.code), "ladder-row", UI.atc.ladderLink(level.level, level.code, level.name, level.count)))));
  }

  // Over the ladder counts, at the end of the ATC label's row.
  const ladderHead = (counts) => (ready(counts) ? el("span", { class: "ladder-head", "aria-hidden": "true" }, UI.atc.countsHead) : null);

  // Medicine card: one ladder per code to use (atcCode()), incomplete codes flagged, and how the code
  // differs from EMA's published one (atcOrigin()).
  function atcLadders(number, atc, counts) {
    if (!ready(atc)) return pending(atc);
    const rows = atc.byProduct.get(number) ?? [];
    if (!rows.length) return null;
    return rows.map((row) => {
      const origin = atcOriginText(atcOrigin(row), atc.names, atc.retiredYears);
      return [
        atcLadderList(atcCode(row), atc.names, ready(counts) ? counts : null),
        atcIncomplete(atcCode(row)) ? el("p", { class: "ladder-flag" }, el("span", { class: "chip", title: UI.table.incompleteTitle }, UI.table.incomplete)) : null,
        origin ? el("p", { class: "muted ladder-origin" }, origin) : null,
      ];
    });
  }

  // The ATC fact spans the card; its label row ends with the ladder counts' head.
  const ladderFact = (content, head) => (content === null ? null : [
    el("dt", { class: "fact-wide ladder-title" }, el("span", null, UI.card.atc), head),
    el("dd", { class: "fact-wide" }, content)]);

  // Substance card: the ladder of its medicines' most common code; medicines classed otherwise are named.
  function substanceAtc(rows, atc, counts) {
    if (!ready(atc)) return null;
    const { code, others } = mainAtcCode(rows.map((row) => ({
      name: row.name_of_medicine,
      codes: (atc.byProduct.get(row.ema_product_number) ?? []).map(atcCode),
    })));
    if (!code) return null;
    return el("section", { class: "card-section" },
      el("div", { class: "ladder-title" }, el("h3", null, UI.card.atc), ladderHead(counts)),
      atcLadderList(code, atc.names, ready(counts) ? counts : null),
      others.map((other) => el("p", { class: "muted" }, UI.atc.classed(other.names, other.code))));
  }

  function areaLinks(number, areas, conditions) {
    if (!ready(areas)) return pending(areas);
    return termLinks((areas.get(number) ?? []).map((row) => row.therapeutic_area_mesh), conditions);
  }

  // The documents list below the SmPC / EPAR buttons. groups: groupDocuments() output; rest: the
  // groups without the button rows (primaryDocuments()). namesakeNote: the line naming the
  // namesake's documents left out (or null).
  function documentsSection(documents, groups, rest, medicine, namesakeNote) {
    const items = rest.flatMap((group) => (group.key === "variations"
      ? el("li", null, el("details", { "data-key": "variations" },
        el("summary", null, UI.documents.variations(group.rows.length)),
        el("ul", { class: "plain doc-sublist" }, group.rows.map((row) => el("li", null,
          externalLink(row.title, row.url), " ", el("span", { class: "muted" }, formatDate(row.last_updated_date)))))))
      : group.rows.map((row) => el("li", null,
        externalLink(row.ownTitle ? row.title : row.archive ? UI.documents.archive(UI.documents[group.key]) : UI.documents[group.key], row.url), row.last_updated_date ? [" ", el("span", { class: "muted" }, UI.card.updated(formatDate(row.last_updated_date)))] : null))));
    if (medicine?.medicine_url) items.push(el("li", null, externalLink(UI.card.medicinePage, medicine.medicine_url)));
    return el("section", { class: "card-section" },
      el("h3", null, UI.card.documents),
      ready(documents) ? null : pending(documents),
      ready(documents) && groups.length === 0 ? el("p", { class: "muted" }, UI.card.noDocuments) : null,
      items.length ? el("ul", { class: "plain doc-list" }, items) : null,
      namesakeNote);
  }

  // Other medicines with the same name (folded): index rows.
  function namesakesOf(row) {
    const folded = foldSearchText(row.name_of_medicine);
    return index.medicines.filter((item) => item.folded === folded && item.row !== row).map((item) => item.row);
  }

  // Under the dek: each namesake as a link to its card, then its status (authorized: since when).
  const namesakeNotes = (namesakes) => namesakes.map((other) => el("p", { class: "namesake" },
    internalLink(UI.card.namesake.link(other.name_of_medicine, other.ema_product_number), { med: other.ema_product_number }),
    statusKind(other.medicine_status) === "authorized" && other.marketing_authorisation_date
      ? UI.card.namesake.authorized(other.marketing_authorisation_date)
      : UI.card.namesake.other(other.medicine_status)));

  // A medicine never authorized, with a namesake approved later: the namesake that approval
  // belongs to (the earliest), or null. Documents from its approval on are the namesake's.
  function laterNamesake(row, namesakes) {
    if (statusKind(row.medicine_status) === "authorized" || row.marketing_authorisation_date) return null;
    return namesakes.filter((other) => other.marketing_authorisation_date)
      .sort((a, b) => a.marketing_authorisation_date.localeCompare(b.marketing_authorisation_date))[0] ?? null;
  }

  // The indication's lead (indicationLead()) on the card's first screen, the full text behind a disclosure.
  function indicationFact(text) {
    if (!text) return null;
    const { lead, more } = indicationLead(text);
    return fact(UI.card.indication, [
      el("p", { class: "indication-lead" }, lead),
      more ? el("details", { class: "indication", "data-key": "indication" }, el("summary", null, UI.card.fullIndication), el("p", null, text)) : null,
    ]);
  }

  function protectionSection(row) {
    const protection = need("protection");
    const heading = (status) => el("h3", null, UI.protection.title, status ? [" ", el("span", { class: "chip" }, status)] : null);
    if (!ready(protection)) return el("section", { class: "card-section" }, heading(null), pending(protection));
    const names = row.substances ? row.substances.split("; ") : [];
    const summary = protectionSummary(
      protection.byProduct.get(row.ema_product_number),
      protection.orphan.get(row.ema_product_number) ?? [],
      names.length ? names.join(" + ") : UI.protection.thisSubstance,
      snapshotDate,
    );
    if (!summary) return null;
    return el("section", { class: "card-section protection" },
      heading(summary.status),
      summary.lines.map((line) => el("p", null, line)),
      summary.orphan.map((line) => el("p", null, line)),
      el("p", null, UI.protection.patents, " ", externalLink(UI.protection.espacenet, espacenetUrl(names[0] ?? row.name_of_medicine))),
      el("details", { "data-key": "caveats" },
        el("summary", null, UI.protection.caveatsTitle),
        el("ul", null, UI.protection.caveats.map((caveat) => el("li", null, caveat)))));
  }

  function notFound(kind, value) {
    return el("article", { class: "card" },
      kicker(kind),
      title(UI.card.notFoundTitle),
      el("p", null, UI.card.notFound(UI.card.kinds[kind], value)));
  }

  function medicineCard(number) {
    const row = index.byNumber.get(number);
    if (!row) return notFound("medicine", number);
    const medicines = need("medicines");
    const medicine = ready(medicines) ? medicines.get(number) : null;
    const [atc, atcCounts, areas, conditions, documents] = [need("atc"), need("atcCounts"), need("areas"), need("conditions"), need("documents")];
    const authorized = statusKind(row.medicine_status) === "authorized";
    // Orphan shows as a type badge; the other flags as neutral chips.
    const flags = Object.entries(UI.card.flags).filter(([flag]) => flag !== "orphan_medicine" && (medicine ?? row)[flag] === true);
    const substances = (row.substances ? row.substances.split("; ") : []).map((name) => {
      const key = row.substance_keys.find((candidate) => candidate === name.toLowerCase());
      return key ? internalLink(name, { sub: key }) : name;
    });
    const register = need("register");
    const registerRow = ready(register) ? register.get(number) : null;
    const registerDiffers = registerRow?.agrees_with_ema === false;
    const namesakes = namesakesOf(row);
    // EMA can list a later namesake's documents under a medicine never authorized: left out here.
    const later = laterNamesake(row, namesakes);
    const split = ready(documents) ? splitNamesakeDocuments(documents.get(number) ?? [], later?.marketing_authorisation_date ?? null) : null;
    const groups = split ? groupDocuments(split.own) : [];
    const { primary, rest } = primaryDocuments(groups, row.medicine_status);
    const namesakeDocuments = split?.namesake.length
      ? el("p", { class: "muted" }, UI.card.namesake.documents(split.namesake.length),
        internalLink(UI.card.namesake.documentsLink(later.name_of_medicine), { med: later.ema_product_number }), ".")
      : null;
    const sentence = medicine ? statusSentence(row.medicine_status, statusDate(medicine), medicine.opinion_status) : null;
    // Order for a talk or poster: the answer (with any namesake), holder, since when and status in
    // the strip, what for (the therapeutic areas) right under it, and the SmPC / EPAR buttons on the
    // first phone screen; then the indication's lead above the documents list.
    return el("article", { class: "card" },
      kicker("medicine"),
      title(headlineNodes(UI.headline.medicine(row.name_of_medicine, statusKind(row.medicine_status)))),
      sentence ? el("p", { class: "dek" }, sentence) : null,
      namesakeNotes(namesakes),
      strip([
        [UI.card.strip.holder, ready(medicines) ? medicine?.marketing_authorisation_developer_applicant_holder ?? NOT_STATED : pending(medicines), true],
        // Never-approved medicines (refused, withdrawn applications) have no approval cell.
        authorized || row.marketing_authorisation_date
          ? [authorized ? UI.card.strip.since : UI.card.strip.approved, formatDate(row.marketing_authorisation_date) ?? NOT_STATED]
          : null,
        [UI.card.strip.status, statusBadge(row.medicine_status, true)],
      ]),
      el("dl", { class: "areas-line" }, el("dt", null, UI.card.areas), el("dd", null, areaLinks(number, areas, conditions))),
      registerDiffers
        ? el("p", null, el("span", { class: "chip warning" },
          externalLink(UI.register.chip(registerRow.register_status, registerRow.register_last_decision_date), registerRow.register_url)))
        : null,
      registerDiffers ? el("p", { class: "muted" }, UI.register.note) : null,
      primary.length ? el("div", { class: "doc-buttons" }, primary.map(documentButton)) : null,
      el("dl", { class: "facts card-section what-for" },
        ready(medicines) ? indicationFact(medicine?.therapeutic_indication) : fact(UI.card.indication, pending(medicines))),
      documentsSection(documents, groups, rest, medicine, namesakeDocuments),
      el("dl", { class: "facts card-section" },
        fact(UI.card.substances, substances.map((link, position) => [link, position < substances.length - 1 ? "; " : ""])),
        // A type without a badge (Other) as text with its explanation.
        fact(UI.card.type, [
          typeBadges({ medicine_type: row.medicine_type }).length
            ? null
            : [el("span", { class: "type-explained" }, row.medicine_type, " ", el("span", { class: "muted" }, UI.typeTips[row.medicine_type] ?? "")), " "],
          explainedTypes(medicine ?? row),
          flags.map(([, label]) => [" ", el("span", { class: "chip" }, label)]),
        ]),
        ladderFact(atcLadders(number, atc, atcCounts), ready(atc) ? ladderHead(atcCounts) : null),
      ),
      protectionSection(row));
  }

  // A result row's ATC codes (atcCode()): display-only badges with the level names as tooltip and
  // for screen readers (as in the medicines table), incomplete codes and codes that differ from EMA's
  // flagged. Nothing while loading.
  function atcCodes(number, atc) {
    if (!ready(atc)) return null;
    return (atc.byProduct.get(number) ?? []).map((row) => {
      const code = atcCode(row);
      const names = atcPrefixes(code).filter((prefix) => atc.names.has(prefix)).map((prefix) => atcClassLabel(prefix, atc.names.get(prefix)));
      const originRow = atcOrigin(row);
      const origin = atcOriginText(originRow, atc.names, atc.retiredYears);
      return el("span", { class: "code", title: [...names, ...(origin ? [origin] : [])].join("\n") || null },
        atcBadge(code),
        names.length ? el("span", { class: "visually-hidden" }, ` (${names.join("; ")})`) : null,
        atcIncomplete(code) ? el("span", { class: "flag", title: UI.table.incompleteTitle }, UI.table.incomplete) : null,
        origin ? [el("span", { class: "flag", "aria-hidden": "true" }, atcOriginFlag(originRow)), el("span", { class: "visually-hidden" }, ` ${origin}`)] : null);
    });
  }

  // Condition page links for EMA terms (plain text where the descriptor is unknown), "; " between them.
  function termLinks(terms, conditions) {
    return terms.map((term, position) => {
      const ui = ready(conditions) ? conditions.termUi.get(term) : null;
      return [ui ? internalLink(term, { cond: ui }) : term, position < terms.length - 1 ? "; " : ""];
    });
  }

  // entries: search-index rows (+ snippet, + terms: the narrower conditions a row is tagged with) ->
  // a table, one tbody per medicine: Medicine (the name opens its card; substances, unless they are
  // the card's own substance (sameSubstance(row)); the narrower terms; PI and EPAR once the
  // documents index has loaded), with areas (substance cards: what each medicine is for) its
  // therapeutic areas, ATC, Approved · Status, Type, Holder, then the matched indication text in a
  // full-width row. Phones stack the rows (style.css); explicit roles keep the table semantics
  // there. labelledBy: the heading's id.
  function resultTable(entries, medicines, labelledBy, { areas = false, sameSubstance = () => false } = {}) {
    if (!entries.length) return el("p", { class: "muted" }, UI.condition.none);
    const [documents, atc] = [need("documents"), need("atc")];
    const [areaRows, conditions] = areas ? [need("areas"), need("conditions")] : [null, null];
    const headers = areas ? [UI.results.headers[0], UI.results.areas, ...UI.results.headers.slice(1)] : UI.results.headers;
    const cell = (className, ...content) => el("td", { class: className, role: "cell" }, content);
    const bodies = entries.map(({ row, snippet, terms }) => {
      const medicine = ready(medicines) ? medicines.get(row.ema_product_number) : null;
      const dates = statusDateLine(row.medicine_status, row.marketing_authorisation_date, medicine?.authorized_until ?? null);
      const urls = ready(documents) ? quickDocuments(documents.get(row.ema_product_number) ?? [], row.medicine_status) : null;
      return el("tbody", { role: "rowgroup" },
        el("tr", { role: "row" },
          cell("result-medicine",
            internalLink(row.name_of_medicine, { med: row.ema_product_number }, "medicine-name"),
            row.substances && !sameSubstance(row) ? el("span", { class: "medicine-substances" }, row.substances) : null,
            terms?.length ? el("span", { class: "matched-terms" }, UI.condition.rowTagged, termLinks(terms, need("conditions"))) : null,
            documentLinks(row.name_of_medicine, urls)),
          areas
            ? cell("result-areas", ready(areaRows) ? termLinks((areaRows.get(row.ema_product_number) ?? []).map((item) => item.therapeutic_area_mesh), conditions) : null)
            : null,
          cell("result-atc", atcCodes(row.ema_product_number, atc)),
          cell("status-cell", statusBadge(row.medicine_status), dates ? el("span", { class: "status-date" }, dates) : null),
          cell("type-cell", typeBadgeList(row)),
          cell("result-holder", ready(medicines) ? medicine?.marketing_authorisation_developer_applicant_holder ?? NOT_STATED : null)),
        snippet
          ? el("tr", { role: "row", class: "snippet-row" }, el("td", { role: "cell", colspan: headers.length },
            el("p", { class: "snippet" }, snippet.before, el("mark", null, snippet.match), snippet.after)))
          : null);
    });
    return el("div", { class: "result-table" }, el("table", { role: "table", "aria-labelledby": labelledBy },
      el("thead", { role: "rowgroup" }, el("tr", { role: "row" }, headers.map((header) => el("th", { scope: "col", role: "columnheader" }, header)))),
      bodies));
  }

  // Fewer dated medicines than this: no timeline (a month axis with a dot or two says nothing).
  const TIMELINE_MIN = 3;

  // A surface block holding the timeline and its caption; none with fewer than TIMELINE_MIN dated
  // rows. mentioned: product numbers found only in indication texts (hollow dots).
  function timelineBlock(rows, medicines, mentioned = new Set()) {
    if (rows.filter((row) => row.marketing_authorisation_date).length < TIMELINE_MIN) return null;
    const container = el("div", { class: "timeline chart" });
    const items = rows.map((row) => ({
      id: row.ema_product_number,
      name: row.name_of_medicine,
      date: row.marketing_authorisation_date,
      type: row.medicine_type,
      family: familyOf(row),
      status: row.medicine_status,
      holder: ready(medicines) ? medicines.get(row.ema_product_number)?.marketing_authorisation_developer_applicant_holder ?? null : null,
      mentioned: mentioned.has(row.ema_product_number),
    }));
    timeline = { container, items, width: null };
    return el("div", { class: "card-section" },
      el("p", { class: "muted timeline-caption" }, UI.timeline.caption, mentioned.size ? [" ", UI.timeline.hollow] : null),
      container);
  }

  function drawTimeline() {
    timeline.width = timeline.container.clientWidth;
    renderTimeline(timeline.container, timeline.items, { link: (item) => internalLink(item.name, { med: item.id }) });
  }

  function substanceCard(key) {
    const substance = index.substances.get(key);
    if (!substance) return notFound("substance", key);
    const medicines = need("medicines");
    const rows = [...substance.products].sort(byDate(1));
    const first = rows[0]?.marketing_authorisation_date ? rows[0] : null;
    const authorizedRows = rows.filter((row) => statusKind(row.medicine_status) === "authorized");
    const authorized = authorizedRows.length;
    // Holders of the medicines authorized now; of all its medicines when none is.
    const holders = ready(medicines)
      ? [...new Set((authorized ? authorizedRows : rows).map((row) => medicines.get(row.ema_product_number)?.marketing_authorisation_developer_applicant_holder ?? NOT_STATED))]
      : null;
    const [atc, atcCounts] = [need("atc"), need("atcCounts")];
    return el("article", { class: "card" },
      kicker("substance"),
      title(headlineNodes(UI.headline.substance(substance.name, authorized))),
      el("p", { class: "dek" }, UI.substance.firstApproval(first?.marketing_authorisation_date, first?.name_of_medicine)),
      strip([
        [UI.card.strip.holder, holders === null ? pending(medicines) : holders.length === 1 ? holders[0] : UI.substance.holders(holders.length), true],
        first ? [authorized ? UI.card.strip.since : UI.card.strip.approved, formatDate(first.marketing_authorisation_date)] : null,
        // None authorized now: the statuses themselves (e.g. Withdrawn), which say more than "0 authorized".
        [UI.card.strip.status, authorized > 0
          ? el("span", { class: `status pill hue-${statusHue("Authorised")}` }, UI.substance.authorized(authorized))
          : el("span", { class: "badges" }, statusesByFrequency(rows.map((row) => row.medicine_status)).map((status) => statusBadge(status, true)))],
      ]),
      timelineBlock(rows, medicines),
      el("h3", { id: "results-substance" }, UI.substance.products(rows.length)),
      // What each medicine is for (its therapeutic areas); the substance line only where it differs.
      resultTable(rows.map((row) => ({ row })), medicines, "results-substance", {
        areas: true,
        sameSubstance: (row) => row.substance_keys?.length === 1 && row.substance_keys[0] === key,
      }),
      substanceAtc(rows, atc, atcCounts));
  }

  // The dek of a condition with narrower ones: "Includes the narrower condition(s) {links}", the
  // first NARROWER_SHOWN, then how many more.
  const NARROWER_SHOWN = 5;
  function narrowerDek(descriptor) {
    const terms = descriptor.narrowerTerms;
    if (!terms.length) return null;
    const shown = terms.slice(0, NARROWER_SHOWN);
    return el("p", { class: "dek" },
      UI.condition.narrowerLead(terms.length),
      shown.map(({ term, ui }, position) => [ui ? internalLink(term, { cond: ui }) : term, position < shown.length - 1 ? "; " : ""]),
      terms.length > shown.length ? UI.condition.narrowerMore(terms.length - shown.length) : null,
      ".");
  }

  function conditionResults(ui, query) {
    const conditions = need("conditions");
    const medicines = need("medicines");
    let heading;
    let descriptor = null;
    let phrases;
    let related = [];
    if (ui) {
      if (!ready(conditions)) return el("article", { class: "card" }, pending(conditions));
      descriptor = conditions.descriptors.get(ui);
      if (!descriptor) return notFound("condition", ui);
      heading = headlineNodes(UI.headline.condition(descriptor.name, descriptor.authorized, descriptor.narrowerTerms.length > 0));
      phrases = conditionPhrases(descriptor);
    } else {
      heading = UI.condition.textHeading(query);
      phrases = [foldSearchText(query)];
      if (ready(conditions)) related = suggest(index, conditions, query).conditions;
    }
    const shown = (row) => showAll || row.medicine_status === "Authorised";
    // Tagged with the condition itself, or only with a narrower one (each row names it).
    const tagged = descriptor ? [...descriptor.products].map((number) => index.byNumber.get(number)).filter(Boolean) : [];
    const taggedShown = tagged.filter(shown).sort(byDate(-1));
    const own = taggedShown.filter((row) => descriptor.ownProducts.has(row.ema_product_number));
    const narrower = taggedShown.filter((row) => !descriptor.ownProducts.has(row.ema_product_number))
      .map((row) => ({ row, terms: descriptor.narrowerByProduct.get(row.ema_product_number) ?? [] }));
    const mentioned = ready(medicines)
      ? textMatches([...medicines.values()], phrases, new Set(tagged.map((row) => row.ema_product_number)))
        .map(({ product, snippet }) => ({ row: index.byNumber.get(product.ema_product_number), snippet }))
        .filter(({ row }) => row && shown(row))
        .sort((a, b) => byDate(-1)(a.row, b.row))
      : null;
    const toggle = el("label", { class: "toggle-all" },
      el("input", { type: "checkbox", checked: showAll, "data-focus-key": "show-all", onchange: (event) => {
        showAll = event.currentTarget.checked;
        render(lastState, true);
      } }),
      " ", UI.condition.showAll);
    const mentionedRows = (mentioned ?? []).map((entry) => entry.row);
    return el("article", { class: "card" },
      kicker(ui ? "condition" : "text"),
      title(heading),
      descriptor ? narrowerDek(descriptor) : null,
      related.length ? el("p", { class: "related" }, `${UI.condition.relatedConditions}: `,
        related.map((condition) => [internalLink(condition.name, { cond: condition.ui }), " "])) : null,
      toggle,
      timelineBlock([...taggedShown, ...mentionedRows], medicines, descriptor ? new Set(mentionedRows.map((row) => row.ema_product_number)) : undefined),
      descriptor
        ? [el("h3", { id: "results-tagged" }, UI.condition.taggedOwn(descriptor.name, own.length)), resultTable(own.map((row) => ({ row })), medicines, "results-tagged")]
        : null,
      narrower.length
        ? [el("h3", { id: "results-narrower" }, UI.condition.taggedNarrower(narrower.length)), resultTable(narrower, medicines, "results-narrower")]
        : null,
      el("h3", { id: "results-mentioned" }, mentioned
        ? `${descriptor ? UI.condition.alsoMentioned : UI.condition.mentioned} (${mentioned.length})`
        : descriptor ? UI.condition.alsoMentioned : UI.condition.mentioned),
      mentioned ? resultTable(mentioned, medicines, "results-mentioned") : pending(medicines));
  }

  // Re-renders only when the lookup view changed, a dataset arrived (force) or the status toggle changed.
  function render(state, force = false) {
    lastState = state;
    const view = lookupView(state);
    const key = JSON.stringify(view);
    const sameView = key === renderedKey;
    if (!force && sameView) return;
    renderedKey = key;
    // A new view retries data that failed to load (not forced re-renders: that would loop).
    if (!force) for (const [name, value] of values) if (value === FAILED) values.delete(name);
    // A new search, substance or condition starts at Authorized only; opening a medicine card
    // and coming back keeps the choice.
    if (view.kind !== null && view.kind !== "medicine" && key !== showAllKey) {
      showAll = false;
      showAllKey = key;
    }
    // Same view re-rendered: keep open disclosures and the focused control.
    const open = new Set(sameView ? [...panel.querySelectorAll("details[open][data-key]")].map((details) => details.dataset.key) : []);
    const focusKey = sameView && panel.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
    timeline = null;
    resizeObserver.disconnect();
    panel.hidden = view.kind === null;
    if (view.kind === null) {
      panel.replaceChildren();
      return;
    }
    // Data the card cannot handle is logged and the card says so, instead of staying on "Loading…".
    let content;
    try {
      content = view.kind === "medicine" ? medicineCard(view.value)
        : view.kind === "substance" ? substanceCard(view.value)
          : conditionResults(view.kind === "condition" ? view.value : null, view.value);
    } catch (error) {
      console.error(error);
      timeline = null;
      content = el("article", { class: "card" }, kicker(view.kind), el("p", { class: "muted" }, UI.lookup.notAvailable));
    }
    panel.replaceChildren(content);
    for (const details of panel.querySelectorAll("details[data-key]")) if (open.has(details.dataset.key)) details.open = true;
    if (timeline) {
      drawTimeline();
      resizeObserver.observe(timeline.container);
    }
    if (focusNext) {
      focusNext = false;
      const heading = panel.querySelector("h2");
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: "nearest" });
    } else if (focusKey) {
      panel.querySelector(`[data-focus-key="${focusKey}"]`)?.focus({ preventScroll: true });
    }
  }

  // The name of the view a lookup state shows (the tab's title), or null while unknown.
  function viewTitle(state) {
    const { kind, value } = lookupView(state);
    if (kind === "medicine") return index.byNumber.get(value)?.name_of_medicine ?? null;
    if (kind === "substance") return index.substances.get(value)?.name ?? null;
    if (kind === "condition") return ready(values.get("conditions")) ? values.get("conditions").descriptors.get(value)?.name ?? null : null;
    return kind === "text" ? UI.textTitle(value) : null;
  }

  return {
    render,
    need,
    title: viewTitle,
    conditions: () => (ready(values.get("conditions")) ? values.get("conditions") : null),
    // Document rows by product (the table's PI and EPAR links): null until need("documents") has loaded them.
    documents: () => (ready(values.get("documents")) ? values.get("documents") : null),
    // Drug-class suggestions need the class names and the current counts: null until both have loaded.
    atcClasses: () => {
      const [atc, counts] = [values.get("atc"), values.get("atcCounts")];
      return ready(atc) && ready(counts) ? { classes: atc.classes, counts } : null;
    },
    link: internalLink,
    onData: (listener) => listeners.push(listener),
    focusOnNextRender: () => {
      focusNext = true;
    },
  };
}
