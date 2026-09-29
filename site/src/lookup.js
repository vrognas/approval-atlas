// Lookup result panel: medicine card, substance card, condition / free-text results, each led by
// a kicker, an answer headline and (medicine, substance) an answer strip.
// Data beyond the first-load search index is loaded on demand and the panel re-renders when it
// arrives ("Loading…" until then). All text goes in via text nodes: EMA text contains "<" and ">".
import { authorizedFirst, isAuthorizedNow, statusDate } from "./approvals.js";
import { areaChips, chipTogglable, fillTerm, markAreaChips } from "./area-chips.js";
import { termBranches } from "./areas.js";
import { atcBadgeTip, atcCode, atcLadder, atcLevelNames, atcOrigin, atcPrefixCounts, atcPrefixes, atcRowIncomplete, mainAtcCode } from "./atc.js";
import { atcHue, atcSegments, statusFlags, statusHue, typeBadges } from "./badges.js";
import { buildCompanies } from "./companies.js";
import {
  copiesLinePlan, copiesSummary, countedFromName, curatedTypeDiffers, equivalentSetKey, firstApprovalShown, followsReference, setGroups, siblingSubstances, substanceEquivalents, substanceGroup,
  substanceSetCount,
} from "./copies.js";
import { FAILED, createDatasets } from "./datasets.js";
import { groupDocuments, primaryDocuments, quickDocuments, splitNamesakeDocuments } from "./documents.js";
import { companyBadge, holderDisplay } from "./holders.js";
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
  statusOpinionLabel,
  statusSentence,
  statusTipText,
  statusesByFrequency,
} from "./labels.js";
import { markExternal } from "./links.js";
import { addMeshTip, buildMeshNotes } from "./mesh-notes.js";
import { buildModalityTree, modalityLines, modalitySource } from "./modalities.js";
import { espacenetUrl, protectionGlance, protectionSummary } from "./protection.js";
import { endingByYear, protectionEnding } from "./protection-calendar.js";
import { buildConditions, conditionPhrases, didYouMean, foldSearchText, knownSubstance, searchWithFallback, suggest, textMatches, textPhrases } from "./search.js";
import { renderTimeline } from "./timeline.js";
import { toolbarKeydown } from "./toolbar.js";
import { DEFAULT_LOOKUP, DEFAULT_STATE, classState, encodeUrl, lookupView, modalityState } from "./url.js";

const formatNumber = new Intl.NumberFormat("en-US").format;
// The medicine card's therapeutic areas shown on phones before "Show n more" (areaLinks()).
const CARD_AREAS = 3;

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
// EMA's list of the EU/EEA countries' registers of nationally authorized medicines (checked 2026-09-28).
const NATIONAL_REGISTERS_URL = "https://www.ema.europa.eu/en/medicines/national-registers-authorised-medicines";

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
// The page's h1 while a result is open (the overview's heading below it is then an h2: main.js).
const title = (content) => el("h1", { tabindex: "-1", "data-focus-key": "title" }, content);
const kicker = (kind) => el("p", { class: "kicker" }, UI.kicker[kind]);

// Dot and label in the status's hue; pill: on its light fill (answer strip). It explains the
// status on hover and on a tap (UI.statusTips; tabindex -1: focusable, no tab stop), as the type
// badges do; label: the text shown instead of the status's (a substance's "3 authorized"); opinion:
// EMA's opinion (a negative one has its own tip, statusTipText()).
function statusBadge(status, pill = false, label = statusLabel(status), opinion = null) {
  const badge = el("span", { class: `status hue-${statusHue(status)}${pill ? " pill" : ""}` }, label);
  const tip = statusTipText(status, opinion);
  return tip ? el("span", { class: "status-tip", "data-tip": tip, tabindex: "-1" }, badge) : badge;
}

// Each badge explains its type on hover and on a tap (tabindex -1: focusable, no tab stop).
function typeBadgeList(row) {
  const badges = typeBadges(row);
  return badges.length ? el("span", { class: "badges" }, badges.map((badge) =>
    el("span", { class: `badge hue-${badge.hue}`, "data-tip": UI.typeTips[badge.label], tabindex: "-1" }, badge.label))) : null;
}

// The medicine card has room: each type badge with its explanation as visible text, one per line
// (read by everyone, no tooltip needed). typeText: the medicine type's explanation (a curated copy
// type can replace it: typeExplanation()).
function explainedTypes(row, typeText = UI.typeTips[row.medicine_type]) {
  return typeBadges(row).map((badge) => el("span", { class: "type-explained" },
    el("span", { class: `badge hue-${badge.hue}` }, badge.label), " ",
    el("span", { class: "muted" }, badge.label === row.medicine_type ? typeText : UI.typeTips[badge.label])));
}

// The card's explanation of EMA's type, or, where a curated copy type contradicts it, what the
// EPAR page calls the medicine (QA 2026-09-29, #9: Riulvy, EMA Generic, a hybrid of Tecfidera).
// curatedRow: its ema_curated_copies.json row (undefined without one, or while it loads).
function typeExplanation(medicineType, curatedRow) {
  return curatedTypeDiffers(medicineType, curatedRow)
    ? UI.copies.typeDiffers(curatedRow.copy_type, curatedRow.reference_name)
    : UI.typeTips[medicineType] ?? "";
}

// Segmented ATC badge (display only: the card's ladders are the links): one segment per level, in
// the group's hue.
function atcBadge(code) {
  return el("span", { class: `atc-badge hue-${atcHue(code)}` },
    atcSegments(code).map((segment) => el("span", { class: segment.level ? `atc-seg level-${segment.level}` : "atc-seg" }, segment.text)));
}

// Answer strip: [label, value, wide] items (null items are left out); the wide one spans a row on
// narrow cards. In a size container, as its columns follow the strip's own width (the
// page sets it), not the viewport's (step 3 review: four items, a medicine's protection cell;
// step 4 review: three, a substance's "13 authorized" crossed the strip's border at 1024px).
function strip(items) {
  const shown = items.filter(Boolean);
  return el("div", { class: "strip-frame" }, el("dl", { class: shown.length === 4 ? "strip strip-4" : "strip", "aria-label": UI.card.strip.label }, shown.map(([label, value, wide]) =>
    el("div", { class: wide ? "strip-wide" : null }, el("dt", null, label), el("dd", null, value)))));
}

// Step 4 (#9): an approval flag's chip (UI.card.flags) explaining itself on hover and on a tap
// (UI.flagTips; tabindex -1: focusable, no tab stop, as the type badges) and, visually hidden, to
// screen readers (the card has room, as for its type explanations); additional monitoring leads
// with EMA's black triangle (aria-hidden).
function flagChip(flag) {
  const tip = UI.flagTips[flag] ?? null;
  return el("span", { class: "chip flag-chip", "data-tip": tip, tabindex: tip ? "-1" : null },
    flag === "additional_monitoring" ? [el("span", { class: "black-triangle", "aria-hidden": "true" }, UI.card.blackTriangle), " "] : null,
    UI.card.flags[flag],
    tip ? el("span", { class: "visually-hidden" }, `: ${tip}`) : null);
}

// The result tables' compact markers beside an authorized medicine's status (statusFlags()): the
// short text shown (aria-hidden), the full name read, the explanation on hover and on a tap.
function flagMarker(flag) {
  const marker = UI.flagMarkers[flag];
  return el("span", { class: "flag flag-marker", "data-tip": UI.flagTips[flag], tabindex: "-1" },
    el("span", { "aria-hidden": "true" }, marker.text), el("span", { class: "visually-hidden" }, marker.name));
}

// SmPC / EPAR / overview as a full-width secondary button: document name (with the external-link
// icon), then "PDF · updated {date}".
function documentButton({ key, row }) {
  if (!row.url?.startsWith("https://")) return null;
  const heading = el("span", { class: "doc-button-title" }, UI.card.buttons[key] ?? UI.documents[key]);
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

// meshVersion: the MeSH version in meta.json ("MeSH 2026"), credited under a condition's definition.
// decision: the days from a positive opinion to the EU decision, { median, p90 } (meta.json
// opinion_to_decision; step 4, #12; p90 null when unknown), null in older data.
// onAreaChip(branch): a condition's branch chip was clicked (owner decision 2026-09-29).
// areaFilter(): the area filter its chips show and toggle, null while it is unknown (before the
// dashboard's data has loaded: the chips are inert then; chips review 2026-09-29).
export function createLookup(panel, {
  index, loadFile, navigate, snapshotDate, meshVersion = null, decision = null, onAreaChip = () => {}, areaFilter = () => null,
}) {
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
    // With the terms' MeSH branches, for their chips (areas.js termBranches()).
    conditions: [["mesh_descriptor_areas.json", "ema_medicine_therapeutic_areas.json", "ema_therapeutic_area_branches.json"],
      (descriptorAreaRows, areaRows, branchRows) => ({ ...buildConditions(index, { descriptorAreaRows, areaRows, branchRows }), branches: termBranches(branchRows) })],
    documents: [["ema_medicine_documents.json"], (rows) => groupBy(rows, "ema_product_number")],
    // Step 4 review: the curated copies (their national references and evidence) with it, and the
    // curated pediatric-use marketing authorizations (their evidence); none when a file is missing
    // (older data).
    protection: [["ema_medicine_protection.json", "ema_medicine_orphan_exclusivity.json", { optional: "ema_curated_copies.json" }, { optional: "ema_curated_pumas.json" }], (rows, orphanRows, copyRows, pumaRows) => ({
      byProduct: new Map(rows.map((row) => [row.ema_product_number, row])),
      orphan: groupBy(orphanRows, "ema_product_number"),
      curatedCopies: new Map((copyRows ?? []).map((row) => [row.ema_product_number, row])),
      pumas: new Map((pumaRows ?? []).map((row) => [row.ema_product_number, row])),
    })],
    register: [["ema_medicine_register_status.json"], (rows) => new Map(rows.map((row) => [row.ema_product_number, row]))],
    // Step 3 (#7, #8): substance spellings checked by hand as one substance (copies.js).
    equivalents: [["ema_substance_equivalents.json"], substanceEquivalents],
    // MeSH scope notes (mesh-notes.js): the therapeutic areas' explainers, loaded on first use
    // (the dashboard asks for them after its first render).
    meshNotes: [["mesh_descriptor_notes.json"], buildMeshNotes],
    // Companies part 2: holders by company group (the dashboard loads the same files); the search
    // counts a group's medicines with status Authorised, as the other suggestion groups.
    companies: [["companies.json", "ema_medicine_companies.json"], (rows, medicineRows) => buildCompanies(rows, medicineRows, {
      isAuthorized: (number) => index.byNumber.get(number)?.medicine_status === "Authorised",
    })],
    // Modality (M2 phase 2; the dashboard loads the same files): the tree and each medicine's rows;
    // null when a file is missing (older data: the cards show no modality).
    modalities: [[{ optional: "modalities.json" }, { optional: "ema_medicine_modalities.json" }], (taxonomy, rows) => (taxonomy?.length && rows
      ? { tree: buildModalityTree(taxonomy), byProduct: groupBy(rows, "ema_product_number") }
      : null)],
  };
  const listeners = [];
  let lastState = null;
  let renderedKey = null;
  let showAll = false;
  let showAllKey = null; // the lookup view the "Show all statuses" choice belongs to
  const expandedAreas = new Set(); // medicine cards whose areas beyond the first CARD_AREAS were shown (phones)
  let focusNext = false;
  let timeline = null;
  const resizeObserver = new ResizeObserver(() => {
    if (timeline && timeline.container.clientWidth !== timeline.width) drawTimeline();
  });

  // need(name): the value, FAILED, or undefined while loading (the first call starts the load). A
  // file given as { optional } is null when it fails to load (a newer file missing from older
  // data), and is asked for once more by the next card or list that uses it (datasets.js).
  const datasets = createDatasets(DATASETS, loadFile, (name) => {
    for (const listener of listeners) listener(name);
    if (lastState) render(lastState, true);
  });
  const { need } = datasets;
  const ready = (value) => value !== undefined && value !== FAILED;

  // Branch chips (area-chips.js): a click toggles the branch (the caller's), unless it is included
  // through a selected category (disabled, as the tree's row) or the area filter is still unknown;
  // the arrow keys move within a condition's chips and "+n".
  panel.addEventListener("click", (event) => {
    const chip = event.target.closest("button.area-chip");
    if (chip && chipTogglable(chip)) onAreaChip(chip.dataset.area);
  });
  panel.addEventListener("keydown", (event) => toolbarKeydown(event, "button.area-chip, .area-more"));
  const pending = (value) => el("p", { class: "muted" }, value === FAILED ? UI.lookup.notAvailable : UI.lookup.loading);

  // The substance equivalents (step 3): none when the file is missing (older data), undefined while
  // it loads. setsOf(): the search index's medicines by substance set, kept for one equivalents value.
  const NO_EQUIVALENTS = new Map();
  function equivalentsNow() {
    const equivalents = need("equivalents");
    return equivalents === FAILED ? NO_EQUIVALENTS : equivalents;
  }
  let sets = null;
  function setsOf(equivalents) {
    if (sets?.equivalents !== equivalents) sets = { equivalents, groups: setGroups([...index.byNumber.values()], equivalents) };
    return sets.groups;
  }

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

  // Label parts (strings, and { text, link } for links: labels.js UI.copies) -> nodes; patchOf(link):
  // the link's lookup patch, or null for plain text.
  const partNodes = (parts, patchOf) => parts.map((part) => {
    if (typeof part === "string") return part;
    const patch = patchOf(part.link);
    return patch ? internalLink(part.text, patch) : part.text;
  });

  const fact = (label, content) => (content === null || (Array.isArray(content) && content.length === 0) ? null : [el("dt", null, label), el("dd", null, content)]);

  // A link to a company group's (or company's) page (companies part 2).
  const companyLink = (text, key) => internalLink(text, { co: key }, "company-link");

  // A medicine's Company · Holder (companies part 2): its company group (badge, a link to its
  // page) with the holder name EMA publishes; EMA's name alone until the companies have loaded
  // (medicines: the medicines dataset), null while both load.
  function holderOf(number, medicines) {
    const companies = need("companies");
    const entry = ready(companies) ? companies.entry(number) : null;
    if (entry) return holderDisplay(entry, { link: companyLink });
    return ready(medicines) ? medicines.get(number)?.marketing_authorisation_developer_applicant_holder ?? NOT_STATED : null;
  }

  // A provenance line: the note, then a link to its evidence and, for a sponsor renamed since
  // (its note names the rename), one to the rename's evidence (https only; none without one).
  function evidenceLine(text, url, linkText = UI.companies.evidence, renameUrl = null) {
    const links = [[linkText, url], [UI.companies.renameEvidence, renameUrl]]
      .filter(([, href]) => href?.startsWith("https://"))
      .map(([label, href], index) => [index > 0 ? " · " : text ? " " : null, externalLink(label, href)]);
    return el("p", { class: "muted company-evidence" }, text, links);
  }
  // A note with its label ("Why Theramex: …"); on phones a long one sits behind a disclosure (its
  // summary, then the note alone), so the Company fact stays compact. Decided when rendered: a
  // rotated phone keeps it, and both forms show the note.
  const LONG_NOTE = 120;
  const PHONE = window.matchMedia("(max-width: 600px)");
  function noteLine(text, note, url, summary, key, renameUrl = null) {
    if (text.length <= LONG_NOTE || !PHONE.matches) return evidenceLine(text, url, UI.companies.evidence, renameUrl);
    return el("details", { class: "company-note", "data-key": key }, el("summary", null, summary), evidenceLine(UI.companies.noteBody(note), url, UI.companies.evidence, renameUrl));
  }

  // The medicine card's Company fact: the holder display, the sponsor's evidence (a curated sponsor
  // behind a regulatory representative; renamed since, the rename's too), why a per-medicine row
  // put it under its group (or a plain note on its later ownership, the medicine not moved), then
  // how current the group is. Provenance lines only where the data has them (older files: none).
  function companyFact(number) {
    const companies = need("companies");
    const entry = ready(companies) ? companies.entry(number) : null;
    if (!entry?.group) return null;
    let sponsor = null;
    if (entry.sponsorNote) {
      sponsor = noteLine(UI.companies.sponsor(entry.sponsorNote), entry.sponsorNote, entry.sponsorEvidenceUrl, UI.companies.sponsorSummary, "company-sponsor",
        entry.sponsorRenameEvidenceUrl);
    } else if (entry.sponsorEvidenceUrl?.startsWith("https://")) {
      sponsor = evidenceLine(null, entry.sponsorEvidenceUrl, UI.companies.sponsorEvidence);
    }
    let group = null;
    if (entry.groupNote && entry.moved) {
      group = noteLine(UI.companies.why(entry.group.name, entry.groupNote), entry.groupNote, entry.groupEvidenceUrl, UI.companies.whySummary(entry.group.name), "company-why");
    } else if (entry.groupNote) {
      group = noteLine(UI.companies.groupNote(entry.groupNote), entry.groupNote, entry.groupEvidenceUrl, UI.companies.noteSummary, "company-note");
    }
    return [holderDisplay(entry, { link: companyLink }), sponsor, group, el("p", { class: "muted company-as-of" }, UI.companies.asOfShort(entry.group.as_of))];
  }

  // Modality (M2 phase 2): a group's or modality's name as a link to the overview filtered to it
  // alone (modalityState(): broken down by modality; pushState, as every lookup link).
  const modalityLink = (tree, key) => internalLink(tree.name(key), modalityState(key), "modality-link");

  // A curated row's evidence named by its document (modalities.js evidenceDocument()).
  function evidenceName(document) {
    const copy = UI.modality.documents;
    if (document?.kind === "pubmed") return copy.pubmed(document.id);
    if (document?.kind === "chembl") return copy.chembl(document.id);
    return copy[document?.kind] ?? document?.host ?? UI.atc.evidenceLink.other;
  }

  // A classification's source (modalities.js modalitySource()) as text, with a link where it has
  // one (a ChEMBL record, a curated row's evidence); atcNames: WHO names of the ATC classes (null
  // while they load: the code alone).
  function modalitySourceNodes(source, atcNames) {
    const copy = UI.modality.sources;
    if (source.kind === "stem") return copy.stem(source.stem);
    if (source.kind === "innGroup") return copy.innGroup(source.name);
    if (source.kind === "radionuclide") return copy.radionuclide(source.nuclide);
    if (source.kind === "greek") return copy.greek(source.letter);
    if (source.kind === "chembl") return source.id ? externalLink(copy.chembl(source.id, source.release), source.url) : copy.chemblType(source.type ?? "");
    if (source.kind === "atc") return copy.atc(atcClassLabel(source.code, atcNames?.get(source.code)));
    if (source.kind === "atmp") return copy.atmp;
    if (source.kind === "text") return copy.text(source.detail);
    if (source.kind === "curated") return source.url ? [externalLink(evidenceName(source.document), source.url), copy.curated] : copy.curatedNoLink;
    return source.detail ?? "";
  }

  // A modality line's name (modalities.js modalityLines()): "{Group} › {Modality}" (links), a group
  // without a named modality "{Group}, not more specific", none classified "Not classified"; and
  // its explainer.
  function modalityName(line, tree) {
    const copy = UI.modality;
    if (line.group === null) return { name: copy.notClassified, tip: copy.notClassifiedTip };
    if (line.modality === null) return { name: [modalityLink(tree, line.group), ", ", copy.notMoreSpecific], tip: `${UI.modalityTips[line.group]} ${copy.groupOnlyTip}` };
    if (line.modality === line.group) return { name: modalityLink(tree, line.group), tip: UI.modalityTips[line.group] };
    return { name: [modalityLink(tree, line.group), " › ", modalityLink(tree, line.modality)], tip: UI.modalityTips[line.modality] };
  }

  // One modality line: the substances when the medicine has several modalities, its name, its
  // explainer, then its source and, when another source named the modality, that one ("; kind from
  // …").
  function modalityLineNodes(line, tree, atcNames, several) {
    const copy = UI.modality;
    const { name, tip } = modalityName(line, tree);
    const source = modalitySource(line.row?.source, line.row?.rule, line.row?.evidence);
    const kindSource = modalitySource(line.row?.leaf_source, line.row?.leaf_rule);
    return el("div", { class: "modality-line" },
      el("p", { class: "modality-name" }, several && line.substances.length ? `${line.substances.join(" + ")}: ` : null, name),
      tip ? el("p", { class: "muted modality-explainer" }, tip) : null,
      source ? el("p", { class: "muted modality-source" }, copy.source, modalitySourceNodes(source, atcNames),
        kindSource ? [copy.kindFrom, modalitySourceNodes(kindSource, atcNames)] : null) : null);
  }

  // The medicine card's Modality fact: one line per distinct modality of its substances. Loading…
  // while the data loads; none without it (older data files).
  function modalityFact(number, atc) {
    const modalities = need("modalities");
    if (!ready(modalities)) return modalities === undefined ? pending(modalities) : null;
    if (modalities === null) return null;
    const lines = modalityLines(modalities.tree, modalities.byProduct.get(number) ?? []);
    const atcNames = ready(atc) ? atc.names : null;
    return lines.map((line) => modalityLineNodes(line, modalities.tree, atcNames, lines.length > 1));
  }

  // The substance card's Modality line: the modality its medicines' rows for this substance give
  // most often (links, then its explainer); none without such rows or the data.
  function substanceModality(rows, key) {
    const modalities = need("modalities");
    if (!ready(modalities) || modalities === null) return null;
    const substanceRows = rows.flatMap((row) => (modalities.byProduct.get(row.ema_product_number) ?? []).filter((item) => item.substance_key === key));
    if (!substanceRows.length) return null;
    const { tree } = modalities;
    const countOf = (line) => substanceRows.filter((item) => tree.groupOf(item) === line.group && tree.modalityOf(item) === line.modality).length;
    const [common] = modalityLines(tree, substanceRows).sort((a, b) => countOf(b) - countOf(a));
    const { name, tip } = modalityName(common, tree);
    return el("dl", { class: "areas-line modality-summary" }, el("dt", null, UI.modality.label),
      el("dd", null, name, tip ? [" ", el("span", { class: "muted" }, tip)] : null));
  }

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

  // Medicine card: one ladder per code to use (atcCode()), incomplete codes flagged (atc_final_level:
  // atcRowIncomplete()), and how the code differs from EMA's published one (atcOrigin()); a curated
  // code links its evidence (phase 4e: the WHO index page, WHO's temporary list or the SmPC).
  function atcLadders(number, atc, counts) {
    if (!ready(atc)) return pending(atc);
    const rows = atc.byProduct.get(number) ?? [];
    if (!rows.length) return null;
    return rows.map((row) => {
      const originRow = atcOrigin(row);
      const origin = atcOriginText(originRow, atc.names, atc.retiredYears);
      const evidence = originRow?.kind === "curated" && originRow.url?.startsWith("https://")
        ? [" ", externalLink(UI.atc.evidenceLink[originRow.evidence ?? "other"], originRow.url)]
        : null;
      return [
        atcLadderList(atcCode(row), atc.names, ready(counts) ? counts : null),
        atcRowIncomplete(row)
          ? el("p", { class: "ladder-flag" }, el("span", { class: "chip", "data-tip": UI.table.incompleteTitle, tabindex: "-1" }, UI.table.incomplete))
          : null,
        origin ? el("p", { class: "muted ladder-origin" }, origin, evidence) : null,
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

  // The medicine card's therapeutic areas with their branch chips. On phones the first CARD_AREAS,
  // the rest (.term-extra) hidden by CSS behind "Show n more" (review 2026-09-29: with chips, a long
  // list pushed the product information button below the first screen); a card whose rest was
  // shown (expandedAreas) keeps it across re-renders.
  function areaLinks(number, areas, conditions) {
    if (!ready(areas)) return pending(areas);
    const terms = (areas.get(number) ?? []).map((row) => row.therapeutic_area_mesh);
    const groups = termLinks(terms, conditions, { chips: true }).flat();
    if (terms.length <= CARD_AREAS) return groups;
    const extras = groups.filter((node) => node.classList?.contains("term")).slice(CARD_AREAS);
    for (const group of extras) group.classList.add("term-extra");
    const more = UI.card.moreAreas(extras.length);
    const list = el("span", { class: expandedAreas.has(number) ? "card-areas areas-all" : "card-areas" }, groups, " ",
      el("button", { type: "button", class: "toggle areas-more", onclick: () => {
        expandedAreas.add(number);
        list.classList.add("areas-all");
        // The button goes: focus to the first condition it showed (its link, else its chips).
        const target = extras[0].querySelector("a, button.area-chip[tabindex='0']") ?? extras[0];
        if (target === extras[0]) target.tabIndex = -1;
        target.focus();
      } }, more.text, el("span", { class: "visually-hidden" }, more.hidden)));
    return list;
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

  // The section's heading is the target of the strip's "Protection (est.)" cell (focusable, kept
  // focused across re-renders); the estimate's basis stands next to its chip (step 3, #7).
  function protectionSection(row) {
    const protection = need("protection");
    const heading = (status) => el("h3", { id: "protection", tabindex: "-1", "data-focus-key": "protection" },
      UI.protection.title, status ? [" ", el("span", { class: "chip" }, status)] : null);
    if (!ready(protection)) return el("section", { class: "card-section" }, heading(null), pending(protection));
    const names = row.substances ? row.substances.split("; ") : [];
    const protectionRow = protection.byProduct.get(row.ema_product_number);
    const reference = protectionRow?.copy_source === "curated" ? index.byNumber.get(protectionRow.reference_product_number) : undefined;
    const summary = protectionSummary(
      protectionRow,
      protection.orphan.get(row.ema_product_number) ?? [],
      names.length ? names.join(" + ") : UI.protection.thisSubstance,
      snapshotDate,
      countedFromOf(row, protectionRow, protection),
      {
        curated: protection.curatedCopies.get(row.ema_product_number),
        referenceSubstance: reference?.substances?.split("; ").join(" + ") ?? null,
        puma: protection.pumas.get(row.ema_product_number),
      },
    );
    if (!summary) return null;
    return el("section", { class: "card-section protection" },
      heading(summary.status),
      el("p", { class: "muted protection-basis" }, UI.protection.basisNote),
      summary.lines.map((line) => el("p", null, Array.isArray(line)
        ? line.map((part) => (typeof part === "string" ? part : externalLink(part.text, part.url)))
        : line)),
      summary.orphan.map((line) => el("p", null, line)),
      el("p", null, UI.protection.patents, " ", externalLink(UI.protection.espacenet, espacenetUrl(names[0] ?? row.name_of_medicine))),
      el("details", { "data-key": "caveats" },
        el("summary", null, UI.protection.caveatsTitle),
        el("ul", null, UI.protection.caveats.map((caveat) => el("li", null, caveat)))));
  }

  // A link within the card: focus and show the protection section's heading (not a hash change,
  // which the page's URL state would keep). Data arriving later (the 5 MB documents index) renders
  // above the section and would push it off screen: render() shows it again while the jump is
  // pending, until the next view or the user scrolls or types.
  let pendingJump = false;
  const showProtection = () => panel.querySelector("#protection")?.closest("section")?.scrollIntoView({ block: "start" });
  for (const type of ["wheel", "touchstart", "keydown"]) {
    window.addEventListener(type, () => {
      pendingJump = false;
    }, { passive: true });
  }
  function jumpToProtection(event) {
    const heading = panel.querySelector("#protection");
    if (!heading) return;
    event.preventDefault();
    heading.focus({ preventScroll: true });
    showProtection();
    pendingJump = true;
  }

  // The strip's "Protection (est.)" cell (step 3, #7): the estimate's short form, a link to the
  // section, then orphan exclusivity still running. Medicines never approved have no estimate.
  function protectionCell(row) {
    if (!row.marketing_authorisation_date) return null;
    const protection = need("protection");
    if (!ready(protection)) return [UI.card.strip.protection, pending(protection)];
    const glance = protectionGlance(protection.byProduct.get(row.ema_product_number), protection.orphan.get(row.ema_product_number) ?? [], snapshotDate);
    if (!glance) return null;
    return [UI.card.strip.protection, [
      el("a", { href: "#protection", class: "strip-link", onclick: jumpToProtection }, glance.value, el("span", { class: "visually-hidden" }, UI.protection.glance.link)),
      // A copy: its reference's years, as secondary text (QA 2026-09-29, #1).
      glance.reference ? el("span", { class: "strip-note" }, glance.reference) : null,
      glance.orphan ? el("span", { class: "strip-note" }, glance.orphan) : null,
    ]];
  }

  // The medicines of a medicine's substance set (setGroups(); equivalents: none while they load).
  const setRowsOf = (row, equivalents) => setsOf(equivalents).get(equivalentSetKey(row.substance_keys, equivalents)) ?? [row];
  const referenceDate = (protectionRow) => index.byNumber.get(protectionRow?.reference_product_number)?.marketing_authorisation_date ?? null;
  // The set's first central approval before this medicine (firstApprovalShown()), for the
  // protection section's lines.
  const firstOfSet = (row, protectionRow) => firstApprovalShown(row, copiesSummary(row, setRowsOf(row, equivalentsNow() ?? NO_EQUIVALENTS), null),
    protectionRow, referenceDate(protectionRow));
  // The medicine the estimate is counted from, as its lines name it (countedFromName()). A curated
  // copy is counted as its reference is (R: the reference's counted_from), whose substance set can
  // be another (Riulvy, tegomil fumarate: Tecfidera), so it is named by the reference's estimate,
  // never by the copy's own set: the reference when approved that day, else the medicine the
  // reference's card names (Ablymico: Saxenda, counted from Victoza), else none.
  function countedFromOf(row, protectionRow, protection) {
    if (protectionRow?.copy_source !== "curated" || !protectionRow.reference_product_number) {
      return countedFromName(row, firstOfSet(row, protectionRow), protectionRow, referenceDate(protectionRow));
    }
    if (referenceDate(protectionRow) === protectionRow.counted_from) return protectionRow.reference_name;
    const reference = index.byNumber.get(protectionRow.reference_product_number);
    const referenceRow = protection.byProduct.get(protectionRow.reference_product_number);
    if (!reference || referenceRow?.counted_from !== protectionRow.counted_from) return null;
    return countedFromName(reference, firstOfSet(reference, referenceRow), referenceRow, referenceDate(referenceRow));
  }

  // Under the strip (step 3, #7): the authorized generics and biosimilars of the medicine's
  // substance set (medicines approved but not copies themselves; named as the substance's when this
  // medicine is not its first), then, on a copy's card (a hybrid's too) or when the set was first approved as
  // another medicine more than 30 days before (Wegovy: Ozempic; copiesLinePlan()), the set's other authorized medicines
  // and that approval, so "Since 2024" does not read as a new substance. Counted by substance set
  // with equivalent spellings joined, company groups once the companies have loaded.
  function copiesLines(row) {
    const [equivalents, companies, protection] = [equivalentsNow(), need("companies"), need("protection")];
    if (equivalents === undefined || companies === undefined || protection === undefined || !row.substance_keys?.length) return null;
    const keys = [...new Set(row.substance_keys)];
    const substanceLabel = (row.substances ? row.substances.split("; ") : keys).join(" + ");
    const groupOf = ready(companies) ? (number) => companies.entry(number)?.group?.key ?? null : null;
    // The set's first approval, named as the protection estimate names it where it can be; a hybrid
    // following a reference reads as a copy (followsReference()).
    // Copies EMA does not flag, checked by hand, count as their type (Herceptin's Tuznue).
    const protectionRow = ready(protection) ? protection.byProduct.get(row.ema_product_number) : undefined;
    const curatedCopies = ready(protection) ? protection.curatedCopies : null;
    const summary = followsReference(copiesSummary(row, setRowsOf(row, equivalents), groupOf, curatedCopies), protectionRow);
    // A twin's first approval (Humira's Trudexa) is not named: the copies line covers it.
    const { copies, first, same } = copiesLinePlan(row, summary, firstApprovalShown(row, summary, protectionRow, referenceDate(protectionRow)));
    const lines = [];
    if (copies) {
      // Named as the substance's copies when this medicine is not its first (Opzelura: Jakavi's).
      lines.push(copies === "list"
        ? partNodes(UI.copies.line(summary.copies.map((entry) => ({
          ...entry, first: { name: entry.first.name_of_medicine, date: entry.first.marketing_authorisation_date },
        })), first ? substanceLabel : null), (position) => ({ med: summary.copies[position].first.ema_product_number }))
        : UI.copies.none);
    }
    if (same) {
      // A first approval no longer authorized says so (Qdenga: Dengvaxia, since withdrawn).
      const firstShown = first ? { ...first, status: index.byNumber.get(first.number)?.medicine_status ?? null } : null;
      lines.push(partNodes(UI.copies.same(summary.others, substanceLabel, keys.length, firstShown), (link) => (link === "first"
        ? { med: first.number }
        : keys.length === 1 ? { sub: keys[0] } : null)));
    }
    return lines.map((line) => el("p", { class: "copies" }, line));
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
    // Step 4 (#9): EMA's flags from the search index (since step 4), else once ema_medicines.json
    // has loaded. Those qualifying a current authorization (conditional, exceptional
    // circumstances, additional monitoring) sit beside its status; orphan shows as a type badge;
    // the others as chips among the facts, each explained.
    const flagRow = medicine ?? (row.additional_monitoring === undefined ? null : row);
    const besideStatus = statusFlags(row.medicine_status, flagRow);
    const flags = Object.keys(UI.card.flags).filter((flag) => flag !== "orphan_medicine" && !besideStatus.includes(flag) && flagRow?.[flag] === true);
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
    const protection = need("protection");
    const typeText = typeExplanation(row.medicine_type, ready(protection) ? protection.curatedCopies.get(number) : undefined);
    // An authorized medicine's sentence needs only its flags (a qualifier, #9); a positive opinion's
    // says when the EU decision usually comes (#12) and, past that, how long it has waited by the data's date.
    const sentence = medicine || authorized
      ? statusSentence(row.medicine_status, medicine ? statusDate(medicine) : null, medicine?.opinion_status ?? null, { decision, asOf: snapshotDate, flags: flagRow })
      : null;
    // A negative opinion reads "not" authorized, not "not yet" (step 2, #11), once EMA's rows have loaded.
    const opinion = medicine?.opinion_status ?? null;
    // Order for a talk or poster: the answer (with any namesake), holder, since when and status in
    // the strip, what for (the therapeutic areas) right under it, and the SmPC / EPAR buttons on the
    // first phone screen; then the indication's lead above the documents list.
    return el("article", { class: "card" },
      kicker("medicine"),
      title(headlineNodes(UI.headline.medicine(row.name_of_medicine, statusKind(row.medicine_status), opinion))),
      sentence ? el("p", { class: "dek" }, sentence) : null,
      namesakeNotes(namesakes),
      strip([
        [UI.card.strip.company, holderOf(number, medicines) ?? pending(medicines), true],
        // Never-approved medicines (refused, withdrawn applications) have no approval cell.
        authorized || row.marketing_authorisation_date
          ? [authorized ? UI.card.strip.since : UI.card.strip.approved, formatDate(row.marketing_authorisation_date) ?? NOT_STATED]
          : null,
        [UI.card.strip.status, [
          statusBadge(row.medicine_status, true, statusOpinionLabel(row.medicine_status, opinion), opinion),
          besideStatus.length ? el("span", { class: "strip-flags" }, besideStatus.map(flagChip)) : null,
        ]],
        protectionCell(row),
      ]),
      copiesLines(row),
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
        fact(UI.card.company, companyFact(number)),
        // A type without a badge (Other) as text with its explanation.
        fact(UI.card.type, [
          typeBadges({ medicine_type: row.medicine_type }).length
            ? null
            : [el("span", { class: "type-explained" }, row.medicine_type, " ", el("span", { class: "muted" }, typeText)), " "],
          explainedTypes(medicine ?? row, typeText),
          flags.map((flag) => [" ", flagChip(flag)]),
        ]),
        fact(UI.modality.label, modalityFact(number, atc)),
        ladderFact(atcLadders(number, atc, atcCounts), ready(atc) ? ladderHead(atcCounts) : null),
      ),
      protectionSection(row));
  }

  // A result row's ATC codes (atcCode()): display-only badges with the medicines table's tooltip
  // (atcBadgeTip(): level names, origin, source; a data-tip as the type badges', shown on a tap too;
  // owner feedback 2026-09-29: it was a native title) and the level names for screen readers,
  // incomplete codes and codes that differ from EMA's flagged. Nothing while loading.
  function atcCodes(number, atc) {
    if (!ready(atc)) return null;
    return (atc.byProduct.get(number) ?? []).map((row) => {
      const code = atcCode(row);
      const names = atcLevelNames(code, atc.names);
      const originRow = atcOrigin(row);
      const origin = atcOriginText(originRow, atc.names, atc.retiredYears);
      return el("span", { class: "code tip-lines", "data-tip": atcBadgeTip(row, atc.names, atc.retiredYears), tabindex: "-1" },
        atcBadge(code),
        names.length ? el("span", { class: "visually-hidden" }, ` (${names.join("; ")})`) : null,
        atcRowIncomplete(row) ? el("span", { class: "flag" }, UI.table.incomplete) : null,
        origin ? [el("span", { class: "flag", "aria-hidden": "true" }, atcOriginFlag(originRow)), el("span", { class: "visually-hidden" }, ` ${origin}`)] : null);
    });
  }

  // A condition page link explained by its MeSH scope note once the notes have loaded (a tooltip,
  // and the link's description; mesh-notes.js); ui: the descriptor.
  function conditionLink(text, ui, className = null, label = null) {
    const notes = need("meshNotes");
    return addMeshTip(internalLink(text, { cond: ui }, className, label), ready(notes) ? notes.byUi.get(ui) : null);
  }

  // Condition page links for EMA terms (plain text where the descriptor is unknown), "; " between them.
  // chips (the medicine card, the substance card's table; owner decision 2026-09-29): each term a
  // group in the flow (span.term, area-chips.js fillTerm()) followed by its branch chips.
  function termLinks(terms, conditions, { chips = false } = {}) {
    return terms.map((term, position) => {
      const ui = ready(conditions) ? conditions.termUi.get(term) : null;
      const name = ui ? conditionLink(term, ui) : term;
      const last = position === terms.length - 1;
      if (!chips) return [name, last ? "" : "; "];
      const group = el("span", { class: "term" });
      fillTerm(group, name, ready(conditions) ? areaChips(term, conditions.branches, areaFilter()) : null, last);
      return last ? group : [group, " "];
    });
  }

  // A condition page's MeSH definition: NLM's full scope note, its tree numbers and the credit NLM
  // asks for (with the MeSH version); nothing without a note (or while the notes load).
  function meshDefinition(ui) {
    const notes = need("meshNotes");
    const note = ready(notes) ? notes.byUi.get(ui) : null;
    if (!note?.scope_note) return null;
    return el("p", { class: "mesh-definition" },
      el("span", { class: "mesh-definition-label" }, UI.mesh.definition), note.scope_note, " ",
      el("span", { class: "muted" }, note.tree_numbers?.length ? `${UI.mesh.treeNumbers(note.tree_numbers)} ` : null, UI.mesh.source(meshVersion)));
  }

  // entries: search-index rows (+ snippet, + terms: the narrower conditions a row is tagged with, +
  // mentions: on a condition page, the indication's words that matched) -> a table, one tbody per
  // medicine: Medicine (the name opens its card; substances, unless they are the card's own
  // substance (sameSubstance(row)); the narrower terms or the words mentioned; PI and EPAR once the
  // documents index has loaded), with areas (substance cards: what each medicine is for) its
  // therapeutic areas, ATC, Approved · Status, Type, Holder, then the matched indication text in a
  // full-width row. Phones stack the rows (style.css; with areas, .with-areas, below a wider width:
  // six columns need more room); explicit roles keep the table semantics there. labelledBy: the
  // heading's id.
  function resultTable(entries, medicines, labelledBy, { areas = false, sameSubstance = () => false } = {}) {
    if (!entries.length) return el("p", { class: "muted" }, UI.condition.none);
    const [documents, atc] = [need("documents"), need("atc")];
    const [areaRows, conditions] = areas ? [need("areas"), need("conditions")] : [null, null];
    const headers = areas ? [UI.results.headers[0], UI.results.areas, ...UI.results.headers.slice(1)] : UI.results.headers;
    const cell = (className, ...content) => el("td", { class: className, role: "cell" }, content);
    const bodies = entries.map(({ row, snippet, terms, mentions }) => {
      const medicine = ready(medicines) ? medicines.get(row.ema_product_number) : null;
      const dates = statusDateLine(row.medicine_status, row.marketing_authorisation_date, medicine?.authorized_until ?? null);
      const urls = ready(documents) ? quickDocuments(documents.get(row.ema_product_number) ?? [], row.medicine_status) : null;
      // Step 4 (#9): conditional, exceptional circumstances, additional monitoring (search index,
      // else ema_medicines once loaded).
      const markers = statusFlags(row.medicine_status, medicine ?? (row.additional_monitoring === undefined ? null : row));
      return el("tbody", { role: "rowgroup" },
        el("tr", { role: "row" },
          cell("result-medicine",
            internalLink(row.name_of_medicine, { med: row.ema_product_number }, "medicine-name"),
            row.substances && !sameSubstance(row) ? el("span", { class: "medicine-substances" }, row.substances) : null,
            terms?.length ? el("span", { class: "matched-terms" }, UI.condition.rowTagged, termLinks(terms, need("conditions"))) : null,
            mentions ? el("span", { class: "matched-terms" }, UI.condition.rowMentions(mentions)) : null,
            documentLinks(row.name_of_medicine, urls)),
          areas
            ? cell("result-areas", ready(areaRows) ? termLinks((areaRows.get(row.ema_product_number) ?? []).map((item) => item.therapeutic_area_mesh), conditions, { chips: true }) : null)
            : null,
          cell("result-atc", atcCodes(row.ema_product_number, atc)),
          cell("status-cell", statusBadge(row.medicine_status, false, undefined, medicine?.opinion_status ?? null), dates ? el("span", { class: "status-date" }, dates) : null,
            markers.length ? el("span", { class: "flag-markers" }, markers.map(flagMarker)) : null),
          cell("type-cell", typeBadgeList(row)),
          cell("result-holder", holderOf(row.ema_product_number, medicines))),
        snippet
          ? el("tr", { role: "row", class: "snippet-row" }, el("td", { role: "cell", colspan: headers.length },
            el("p", { class: "snippet" }, snippet.before, el("mark", null, snippet.match), snippet.after)))
          : null);
    });
    return el("div", { class: areas ? "result-table with-areas" : "result-table" }, el("table", { role: "table", "aria-labelledby": labelledBy },
      el("thead", { role: "rowgroup" }, el("tr", { role: "row" }, headers.map((header) => el("th", { scope: "col", role: "columnheader" }, header)))),
      bodies));
  }

  // Fewer dated medicines than this: no timeline (a month axis with a dot or two says nothing).
  const TIMELINE_MIN = 3;

  // A surface block holding the timeline and its caption; none with fewer than TIMELINE_MIN dated
  // rows. mentioned: product numbers found only in indication texts (hollow dots; a legend then
  // names the dots of each kind present: tagged by EMA, filled; mentioned, hollow). caveat: a
  // sentence after the caption (condition and indication-text pages: the dots are first approvals;
  // step 4, #17).
  function timelineBlock(rows, medicines, mentioned = new Set(), caveat = null) {
    if (rows.filter((row) => row.marketing_authorisation_date).length < TIMELINE_MIN) return null;
    const container = el("div", { class: "timeline chart" });
    const companies = need("companies");
    // The tooltip's holder: the company group, then EMA's name when it differs (companies part 2).
    const holderText = (number) => {
      const entry = ready(companies) ? companies.entry(number) : null;
      if (entry?.group) return UI.companies.tipHolder(entry.group.name, entry.holder);
      return ready(medicines) ? medicines.get(number)?.marketing_authorisation_developer_applicant_holder ?? null : null;
    };
    const items = rows.map((row) => ({
      id: row.ema_product_number,
      name: row.name_of_medicine,
      date: row.marketing_authorisation_date,
      type: row.medicine_type,
      family: familyOf(row),
      status: row.medicine_status,
      holder: holderText(row.ema_product_number),
      mentioned: mentioned.has(row.ema_product_number),
    }));
    timeline = { container, items, width: null };
    const tagged = rows.some((row) => !mentioned.has(row.ema_product_number));
    const legend = mentioned.size
      ? el("ul", { class: "legend dot-legend" },
        tagged ? el("li", null, el("span", { class: "dot-key", "aria-hidden": "true" }), UI.timeline.legend.tagged) : null,
        el("li", null, el("span", { class: "dot-key hollow", "aria-hidden": "true" }), UI.timeline.legend.mentioned))
      : null;
    return el("div", { class: "card-section" },
      el("p", { class: "muted timeline-caption" }, UI.timeline.caption, caveat ? [" ", caveat] : null),
      legend,
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
    // Step 3 (#8): the same substance under another spelling in EMA's data (dasatinib: Sprycel is
    // "dasatinib (anhydrous)"), each a link to its card. The answer (headline, dek, strip) is the
    // substance's under all its spellings (substanceGroup()), so its dates and counts agree; the
    // timeline and the list stay this spelling's.
    const siblings = siblingSubstances(key, index.substances, equivalentsNow() ?? NO_EQUIVALENTS);
    const group = substanceGroup(rows, siblings);
    const groupRows = [...group.rows].sort(byDate(1));
    const { first } = group;
    const authorizedRows = [...group.authorized].sort(byDate(1));
    const authorized = authorizedRows.length;
    // Holders of the medicines authorized now; of all its medicines when none is: one company group
    // shows as the medicine card's (EMA's names joined), several are counted (companies part 2).
    const companies = need("companies");
    let holders = null;
    if (ready(companies)) {
      const entries = (authorized ? authorizedRows : groupRows).map((row) => companies.entry(row.ema_product_number)).filter(Boolean);
      const groups = new Set(entries.map((entry) => entry.group?.key ?? entry.holder));
      if (groups.size === 1 && entries[0].group) {
        // EMA's names (none for a medicine EMA names no holder for).
        const names = [...new Set(entries.map((entry) => entry.holder).filter((name) => name !== null))];
        holders = holderDisplay({ ...entries[0], basis: null, holder: names.length ? names.join("; ") : null }, { link: companyLink });
      } else {
        holders = groups.size === 1 ? entries[0].holder ?? NOT_STATED : UI.substance.companies(groups.size);
      }
    }
    const [atc, atcCounts] = [need("atc"), need("atcCounts")];
    const siblingLines = siblings.map((sibling) => el("p", { class: "namesake" }, partNodes(UI.substance.sibling(sibling.substance.name, sibling.count,
      sibling.first ? { name: sibling.first.name_of_medicine, date: sibling.first.marketing_authorisation_date } : null), () => ({ sub: sibling.substance.key }))));
    // A status pill's opinion: negative when each of its medicines had a negative opinion (Kinselby's).
    const opinionOf = (status) => (ready(medicines) && groupRows.filter((row) => row.medicine_status === status)
      .every((row) => medicines.get(row.ema_product_number)?.opinion_status === "Negative") ? "Negative" : null);
    return el("article", { class: "card" },
      kicker("substance"),
      title(headlineNodes(UI.headline.substance(substance.name, authorized))),
      el("p", { class: "dek" }, UI.substance.firstApproval(first?.marketing_authorisation_date, first?.name_of_medicine)),
      siblingLines,
      strip([
        [UI.card.strip.company, holders ?? pending(companies), true],
        first ? [authorized ? UI.card.strip.since : UI.card.strip.approved, formatDate(first.marketing_authorisation_date)] : null,
        // None authorized now: the statuses themselves (e.g. Withdrawn), which say more than "0 authorized".
        [UI.card.strip.status, authorized > 0
          ? statusBadge("Authorised", true, UI.substance.authorized(authorized))
          : el("span", { class: "badges" }, statusesByFrequency(groupRows.map((row) => row.medicine_status)).map((status) => statusBadge(status, true, undefined, opinionOf(status))))],
      ]),
      substanceModality(rows, key),
      timelineBlock(rows, medicines),
      el("h3", { id: "results-substance" }, siblings.length ? UI.substance.productsListed(rows.length, substance.name) : UI.substance.products(rows.length)),
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
      shown.map(({ term, ui }, position) => [ui ? conditionLink(term, ui) : term, position < shown.length - 1 ? "; " : ""]),
      terms.length > shown.length ? UI.condition.narrowerMore(terms.length - shown.length) : null,
      ".");
  }

  // Step 2 (#2): an indication-text search with nothing to show (among the statuses shown) says
  // why, in place of "None.": what it found instead (medicines of another status, a matching or
  // close name, a WHO substance with no medicine through EMA and, when its class has medicines
  // authorized now, that class), then, when no name matched, what can be searched, what cannot yet
  // and what is not in the data. hidden: matches of another status.
  function emptyState(query, hidden) {
    const [atc, atcCounts, conditions] = [need("atc"), need("atcCounts"), need("conditions")];
    const copy = UI.lookup.empty;
    const known = knownSubstance(index, query, ready(atc) ? atc.classes : []);
    const level4 = known?.code.slice(0, 5) ?? null;
    const classCount = level4 && ready(atcCounts) ? atcCounts.get(level4) ?? 0 : 0;
    // Names matching the query (a text search can be asked for anyway), else close ones.
    const { groups } = searchWithFallback(query, (text) => {
      const found = suggest(index, ready(conditions) ? conditions : null, text);
      return [
        { key: "medicines", options: found.medicines.map((row) => ({ label: row.name_of_medicine, patch: { med: row.ema_product_number } })) },
        { key: "substances", options: found.substances.map((substance) => ({ label: substance.name, patch: { sub: substance.key } })) },
      ];
    });
    const names = groups.flatMap((group) => group.options).slice(0, 3);
    const fuzzy = names.length ? [] : didYouMean(index, query, ready(atc) ? atc.classes : []).map((entry) => ({
      label: entry.kind === "who" ? atcName(entry.label) : entry.label,
      patch: entry.kind === "medicine" ? { med: entry.value } : entry.kind === "substance" ? { sub: entry.value } : { q: entry.value },
    }));
    const links = (items) => items.map((item, position) => [position ? ", " : "", internalLink(item.label, item.patch)]);
    const lead = hidden ? copy.otherStatuses(hidden)
      : names.length ? copy.noText(query)
        : known ? copy.known(atcName(known.name), known.code)
          : copy.nothing(query);
    return el("div", { class: "empty-state" },
      el("p", { class: "empty-lead" }, lead),
      known && classCount
        ? el("p", null, copy.sameClass, internalLink(atcClassLabel(level4, atc.names.get(level4) ?? null), classState(level4)), ` (${UI.lookup.classMeta(classCount)})`)
        : null,
      names.length ? el("p", null, copy.names, links(names)) : null,
      fuzzy.length ? el("p", null, copy.didYouMean, links(fuzzy)) : null,
      hidden || names.length ? null : el("ul", { class: "empty-list" },
        el("li", null, copy.searchable),
        el("li", null, copy.notYet),
        el("li", null, copy.notInData, externalLink(copy.registers, NATIONAL_REGISTERS_URL), copy.registersAfter)));
  }

  function conditionResults(ui, query) {
    const conditions = need("conditions");
    const medicines = need("medicines");
    let heading;
    let descriptor = null;
    let phrases;
    let variant = null;
    let related = [];
    if (ui) {
      if (!ready(conditions)) return el("article", { class: "card" }, pending(conditions));
      descriptor = conditions.descriptors.get(ui);
      if (!descriptor) return notFound("condition", ui);
      // "or a narrower condition" only when some authorized medicine it counts is tagged only so (phase 4f).
      const narrowerCounted = [...descriptor.narrowerByProduct.keys()].some((number) =>
        !descriptor.ownProducts.has(number) && index.byNumber.get(number)?.medicine_status === "Authorised");
      heading = headlineNodes(UI.headline.condition(descriptor.name, descriptor.authorized, narrowerCounted));
      // The condition's name explained on hover or tap (its full definition follows the deks).
      const notes = need("meshNotes");
      const name = heading.find((node) => node.classList?.contains("tone-term"));
      if (name && ready(notes)) addMeshTip(name, notes.byUi.get(ui), null);
      phrases = conditionPhrases(descriptor);
    } else {
      heading = UI.condition.textHeading(query);
      ({ phrases, variant } = textPhrases(query));
      if (ready(conditions)) related = suggest(index, conditions, query).conditions;
    }
    const shown = (row) => showAll || row.medicine_status === "Authorised";
    // Tagged with the condition itself, or only with a narrower one (each row names it).
    const tagged = descriptor ? [...descriptor.products].map((number) => index.byNumber.get(number)).filter(Boolean) : [];
    const taggedShown = tagged.filter(shown).sort(byDate(-1));
    const own = taggedShown.filter((row) => descriptor.ownProducts.has(row.ema_product_number));
    const narrower = taggedShown.filter((row) => !descriptor.ownProducts.has(row.ema_product_number))
      .map((row) => ({ row, terms: descriptor.narrowerByProduct.get(row.ema_product_number) ?? [] }));
    const matches = ready(medicines)
      ? textMatches([...medicines.values()], phrases, new Set(tagged.map((row) => row.ema_product_number)))
        // On a condition page each row says which words of its indication matched (phase 4f).
        .map(({ product, snippet }) => ({ row: index.byNumber.get(product.ema_product_number), snippet, mentions: descriptor ? snippet?.match ?? null : null }))
        .filter(({ row }) => row)
      : null;
    const mentioned = matches ? matches.filter(({ row }) => shown(row)).sort((a, b) => byDate(-1)(a.row, b.row)) : null;
    // A text search with nothing to show says why (step 2, #2), once its related conditions are known.
    const empty = !descriptor && mentioned?.length === 0 && related.length === 0 && conditions !== undefined;
    const toggle = el("label", { class: "toggle-all" },
      el("input", { type: "checkbox", checked: showAll, "data-focus-key": "show-all", onchange: (event) => {
        showAll = event.currentTarget.checked;
        render(lastState, true);
      } }),
      " ", UI.condition.showAll);
    const mentionedRows = (mentioned ?? []).map((entry) => entry.row);
    // Step 4 (#10): the tagged medicines' distinct active substances (equivalent spellings joined),
    // once the equivalents have loaded (or failed: EMA's spellings).
    const equivalents = equivalentsNow();
    const substances = descriptor && equivalents !== undefined ? substanceSetCount(taggedShown.map((row) => row.substance_keys), equivalents) : null;
    return el("article", { class: "card" },
      kicker(ui ? "condition" : "text"),
      title(heading),
      descriptor ? narrowerDek(descriptor) : null,
      // Step 2 (#19): "aspirin" also searches for "acetylsalicylic acid".
      variant ? el("p", { class: "dek" }, UI.condition.alsoSearched(variant)) : null,
      // Both counts of the lists below (phase 4f): tagged by EMA, and only mentioned in the indication.
      descriptor ? el("p", { class: "dek" }, UI.condition.counts(taggedShown.length, mentioned?.length ?? null, showAll, substances)) : null,
      related.length ? el("p", { class: "related" }, `${UI.condition.relatedConditions}: `,
        related.map((condition) => [conditionLink(condition.name, condition.ui), " "])) : null,
      // What the condition is: NLM's scope note (owner request 2026-09-28).
      descriptor ? meshDefinition(ui) : null,
      toggle,
      timelineBlock([...taggedShown, ...mentionedRows], medicines, descriptor ? new Set(mentionedRows.map((row) => row.ema_product_number)) : undefined, UI.timeline.firstApproval),
      descriptor
        ? [el("h3", { id: "results-tagged" }, UI.condition.taggedOwn(descriptor.name, own.length)), resultTable(own.map((row) => ({ row })), medicines, "results-tagged")]
        : null,
      narrower.length
        ? [el("h3", { id: "results-narrower" }, UI.condition.taggedNarrower(narrower.length)), resultTable(narrower, medicines, "results-narrower")]
        : null,
      el("h3", { id: "results-mentioned" }, mentioned
        ? `${descriptor ? UI.condition.alsoMentioned : UI.condition.mentioned} (${mentioned.length})`
        : descriptor ? UI.condition.alsoMentioned : UI.condition.mentioned),
      mentioned ? (empty ? emptyState(query, matches.length) : resultTable(mentioned, medicines, "results-mentioned")) : pending(medicines));
  }

  // "a, b and c" of nodes (or node lists).
  const joinNodes = (items) => items.map((item, position) => [
    position === 0 ? "" : position === items.length - 1 ? UI.companies.and : ", ", item]);
  // A group as its badge and a link to its page.
  const groupLink = (group) => [companyBadge(group), " ", companyLink(group.name, group.key)];
  // A bar's track and fill (share: of the longest bar, in percent); the width is set through the
  // CSSOM (the page's CSP allows no style attributes).
  function bar(share) {
    const fill = el("span", { class: "bar-fill" });
    fill.style.width = `${share}%`;
    return el("span", { class: "bar-track", "aria-hidden": "true" }, fill);
  }
  // A mix row: a link (its name names the count), a bar and the count.
  const mixRow = (link, count, max) => el("li", null, link, bar((100 * count) / max), el("span", { class: "bar-value" }, formatNumber(count)));
  // Rows per key (keysOf(number): its keys, each once), most first (ties by key).
  function mixCounts(numbers, keysOf) {
    const counts = new Map();
    for (const number of numbers) for (const key of new Set(keysOf(number))) counts.set(key, (counts.get(key) ?? 0) + 1);
    return [...counts].sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b));
  }

  // Company page (companies part 2, ?co=): a company group (or one company) with its medicines of
  // every status and those currently authorized; a joint venture's partners, a group's joint
  // ventures or a company's group; how current the grouping is; its companies and EMA holder names
  // (each opens the overview filtered to it); its approvals timeline, ATC groups (each opens the
  // overview filtered to the company and group) and most common conditions; its medicines
  // (authorized ones, or every status); and where the grouping comes from (GLEIF, sources, the
  // ownership notes and the medicines moved to their current owner, with their evidence).
  const MIX_AREAS = 8;
  function companyPage(key) {
    const companies = need("companies");
    if (!ready(companies)) return el("article", { class: "card" }, kicker("company"), pending(companies));
    const row = companies.row(key);
    if (!row) return notFound("company", key);
    // A company's groups: those its medicines are with (a medicine can have gone to another owner
    // than the company's), else the company's own.
    const groups = row.kind === "group" ? [row] : [...companies.groupsOf(key)].map(companies.row).filter(Boolean);
    if (row.kind === "company" && groups.length === 0 && companies.row(row.group_key)) groups.push(companies.row(row.group_key));
    const groupCount = (group) => companies.numbersOf(`${group.key}/${key}`).length;
    groups.sort((a, b) => groupCount(b) - groupCount(a) || a.name.localeCompare(b.name));
    const medicines = need("medicines");
    const numbers = companies.numbersOf(key);
    const all = numbers.map((number) => index.byNumber.get(number)).filter(Boolean).sort(byDate(-1));
    // Currently authorized ones first (as condition pages; counted as the headline, so an authorized
    // medicine without an approval date is under "Show all statuses"), every status with the
    // toggle; a company with none currently authorized shows every status (no toggle then).
    const { current, everyStatus, shown } = authorizedFirst(all, showAll);
    const anyAuthorized = current > 0;
    // The overview filtered to values (as the tree selects them: companies.js structure()) and more,
    // with every status (status []), as this page counts them (owner decision 2026-09-29: the
    // overview shows authorized medicines by default).
    const filtered = (values, extra = {}) => ({ ...structuredClone(DEFAULT_STATE), mah: values, status: [], ...extra });

    const partners = [...row.partners.map(companies.row).filter(Boolean).map(groupLink), ...row.other_partners];
    const ventures = row.kind === "group" ? companies.jointVentures(key).map(companies.row).filter(Boolean).map(groupLink) : [];
    // A company with medicines under several groups names each, with its medicines there.
    const partOf = groups.length > 1 ? groups.map((group) => [groupLink(group), " ", UI.companies.groupCount(groupCount(group))]) : groups.map(groupLink);
    // A company all of whose medicines a per-medicine row moved is not part of their group.
    const partOfLead = companies.allMoved(key) ? UI.companies.medicinesUnder(numbers.length) : UI.companies.partOf;
    const deks = [
      row.joint_venture && partners.length ? el("p", { class: "dek" }, UI.companies.jointVentureOf, joinNodes(partners), ".") : null,
      ventures.length ? el("p", { class: "dek" }, UI.companies.jointVentures, joinNodes(ventures), ".") : null,
      row.kind === "company" && groups.length ? el("p", { class: "dek" }, partOfLead, joinNodes(partOf), ".") : null,
      row.representative ? el("p", { class: "dek" }, UI.companies.representative) : null,
      // A company's grouping is as current as its groups' curation (its own as_of is the snapshot's).
      el("p", { class: "muted" }, UI.companies.asOf(row.kind === "group" ? row.as_of : groups.map((group) => group.as_of).sort().at(-1) ?? row.as_of)),
    ];

    // Its companies, each with its EMA holder names (left out when only its own name; its own name
    // among others as "(same name)", as the tree) and its medicines EMA names no holder for.
    const structure = companies.structure(key);
    const holderLink = (holder, company) => (holder.name === companies.name(company.key)
      ? internalLink(UI.companies.sameName, filtered(holder.values), null, UI.companies.sameNameLabel(holder.name))
      : internalLink(holder.name, filtered(holder.values)));
    const names = el("section", { class: "card-section" },
      el("h3", null, UI.companies.names),
      el("p", { class: "muted" }, UI.companies.namesHint),
      el("ul", { class: "plain company-names" }, structure.map((company) => {
        const own = company.holders.length === 1 && company.holders[0].name === companies.name(company.key) && !company.unnamed;
        return el("li", null,
          internalLink(companies.name(company.key), filtered(company.values)), " ", el("span", { class: "muted" }, UI.substance.products(company.count)),
          own ? null : el("ul", { class: "plain company-holders" }, company.holders.map((holder) => el("li", null,
            holderLink(holder, company), " ", el("span", { class: "muted" }, UI.substance.products(holder.count)))),
          // The medicines EMA names no holder for (the Union Register does), as the tree's static row.
          company.unnamed ? el("li", { class: "muted" }, UI.companies.noHolder, " ", UI.substance.products(company.unnamed)) : null));
      })));

    // ATC groups (level 1) of its medicines, every status.
    const atc = need("atc");
    let atcMix = null;
    if (ready(atc)) {
      const rows = mixCounts(numbers, (number) => (atc.byProduct.get(number) ?? []).flatMap((item) => atcPrefixes(atcCode(item)).slice(0, 1)));
      atcMix = rows.length ? el("section", { class: "card-section" },
        el("h3", null, UI.companies.atc),
        el("p", { class: "muted" }, UI.companies.atcHint),
        el("ol", { class: "condition-list company-mix" }, rows.map(([code, count]) => mixRow(
          internalLink([el("span", { class: `letter-badge hue-${atcHue(code)}` }, code), " ", el("span", null, atcName(atc.names.get(code)))],
            filtered(companies.canonical(key), { atc: [code] }), "mix-link", UI.companies.mixLink(atcClassLabel(code, atc.names.get(code)), count)),
          count, rows[0][1])))) : null;
    }

    // Its most common conditions (EMA's therapeutic area terms), each opening its condition page.
    const [areas, conditions] = [need("areas"), need("conditions")];
    let areaMix = null;
    if (ready(areas)) {
      const rows = mixCounts(numbers, (number) => (areas.get(number) ?? []).map((item) => item.therapeutic_area_mesh)).slice(0, MIX_AREAS);
      areaMix = rows.length ? el("section", { class: "card-section" },
        el("h3", null, UI.companies.areas),
        el("ol", { class: "condition-list company-mix" }, rows.map(([term, count]) => {
          const ui = ready(conditions) ? conditions.termUi.get(term) : null;
          return mixRow(ui ? conditionLink(term, ui, null, UI.companies.mixLink(term, count)) : el("span", null, term), count, rows[0][1]);
        }))) : null;
    }

    // Draft (loss-of-exclusivity calendar): its currently authorized medicines by the year their
    // estimated market protection ends at the earliest, those whose orphan market exclusivity alone
    // runs on by the year it ends; unclear estimates only counted.
    const protection = need("protection");
    const endingCopy = UI.protectionCalendar;
    let protectionEndingPart = el("p", { class: "muted" }, protection === FAILED ? UI.lookup.notAvailable : endingCopy.loading);
    if (ready(protection)) {
      const { rows: ending, orphanOnly, unclear, unclearLatest } = protectionEnding(anyAuthorized ? authorizedFirst(all, false).shown : [], protection, snapshotDate);
      const orphanNote = (item) => (item.orphanOnly ? endingCopy.company.orphanOnly(item.orphanEnd) : item.orphanEnd ? endingCopy.company.orphan(item.orphanEnd) : null);
      protectionEndingPart = [
        ending.length || orphanOnly.length
          ? el("ul", { class: "plain pc-company-list" }, endingByYear(ending, orphanOnly).map(({ year, rows }) => el("li", null,
            el("span", { class: "pc-company-year" }, String(year)), " ",
            rows.map((item, position) => [
              position ? ", " : "",
              internalLink(item.product.name_of_medicine, { med: item.product.ema_product_number }),
              orphanNote(item) ? [" (", orphanNote(item), ")"] : null,
            ]))))
          : el("p", null, endingCopy.company.none),
        unclear ? el("p", { class: "muted" }, endingCopy.unclear(unclear, unclearLatest)) : null,
      ];
    }
    const protectionEndingSection = el("section", { class: "card-section" },
      el("h3", null, endingCopy.company.title),
      el("p", { class: "muted" }, endingCopy.company.note),
      protectionEndingPart);

    const toggle = anyAuthorized ? el("label", { class: "toggle-all" },
      el("input", { type: "checkbox", checked: showAll, "data-focus-key": "show-all", onchange: (event) => {
        showAll = event.currentTarget.checked;
        render(lastState, true);
      } }),
      " ", UI.condition.showAll) : null;
    const gleifUrl = row.lei ? `https://search.gleif.org/#/record/${encodeURIComponent(row.lei)}` : null;
    // Ownership (provenance; none in older data files): the curated notes on its members
    // (acquisitions, renames, spin-offs) and a renamed sponsor's old name (companies.ownership()),
    // then its medicines' notes: those a per-medicine row put
    // under their current owner (named unless it is this page's group) and plain notes on a
    // medicine's later ownership, each with a link to its evidence.
    const evidence = (url) => (url?.startsWith("https://") ? [" ", externalLink(UI.companies.evidence, url)] : null);
    const ownership = companies.ownership(key);
    const noted = numbers.map((number) => [number, companies.entry(number)]).filter(([, entry]) => entry?.groupNote && entry.group);
    const ownershipPart = ownership.length || noted.length
      ? [
        el("h4", { class: "sources-part" }, UI.companies.ownership),
        el("ul", { class: "plain company-ownership" },
          ownership.map((item) => el("li", null, UI.companies.ownershipNote(item.holders, item.note), evidence(item.url))),
          noted.map(([number, entry]) => el("li", null,
            internalLink(index.byNumber.get(number)?.name_of_medicine ?? number, { med: number }),
            UI.companies.moved(entry.moved && entry.group.key !== key ? entry.group.name : null, entry.groupNote), evidence(entry.groupEvidenceUrl)))),
      ]
      : null;
    const sources = el("section", { class: "card-section" },
      el("h3", null, UI.companies.sources),
      gleifUrl ? el("p", null, externalLink(UI.companies.lei(row.lei), gleifUrl), row.gleif_legal_name ? [" ", UI.companies.legalName(row.gleif_legal_name)] : null) : null,
      row.gleif_ultimate_parent && row.gleif_ultimate_parent !== row.gleif_legal_name ? el("p", null, UI.companies.parent(row.gleif_ultimate_parent)) : null,
      el("p", null, UI.companies.from(row.sources.map((source) => UI.companies.sourceNames[source] ?? source))),
      ownershipPart);

    // The headline's badge: the group's own, a company's group (companies.json group_key: where its
    // medicines are unless a per-medicine row moved some, so a company split between groups has one).
    const badgeGroup = row.kind === "group" ? row : companies.row(row.group_key) ?? (groups.length === 1 ? groups[0] : null);
    return el("article", { class: "card company-page" },
      kicker("company"),
      title([badgeGroup ? [companyBadge(badgeGroup), " "] : null, headlineNodes(UI.companies.headline(row.name, all.length, current))]),
      deks,
      names,
      timelineBlock(shown, medicines),
      atcMix,
      areaMix,
      protectionEndingSection,
      el("h3", { id: "results-company" }, UI.companies.medicines(shown.length, everyStatus)),
      toggle,
      resultTable(shown.map((item) => ({ row: item })), medicines, "results-company"),
      sources);
  }

  // Re-renders only when the lookup view changed, a dataset arrived (force) or the status toggle changed.
  function render(state, force = false) {
    lastState = state;
    // The branch chips follow the area filter (a chip's popover can change it under a card; the
    // dashboard's arrival makes it known).
    markAreaChips(panel, areaFilter());
    const view = lookupView(state);
    const key = JSON.stringify(view);
    const sameView = key === renderedKey;
    if (!force && sameView) return;
    renderedKey = key;
    // A new view retries data that failed to load, and, once, an optional file that was missing,
    // each when a card or list next needs it (not forced re-renders: that would loop).
    if (!force) datasets.retry();
    // A new search, substance or condition starts at Authorized only; opening a medicine card
    // and coming back keeps the choice.
    if (view.kind !== null && view.kind !== "medicine" && key !== showAllKey) {
      showAll = false;
      showAllKey = key;
    }
    // Same view re-rendered: keep open disclosures and the focused control.
    const open = new Set(sameView ? [...panel.querySelectorAll("details[open][data-key]")].map((details) => details.dataset.key) : []);
    const focusKey = sameView && panel.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
    if (!sameView) pendingJump = false;
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
          : view.kind === "company" ? companyPage(view.value)
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
      const heading = panel.querySelector("h1, h2");
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: "nearest" });
    } else if (focusKey) {
      panel.querySelector(`[data-focus-key="${focusKey}"]`)?.focus({ preventScroll: true });
      if (focusKey === "protection" && pendingJump) showProtection();
    }
  }

  // The name of the view a lookup state shows (the tab's title), or null while unknown.
  function viewTitle(state) {
    const { kind, value } = lookupView(state);
    if (kind === "medicine") return index.byNumber.get(value)?.name_of_medicine ?? null;
    if (kind === "substance") return index.substances.get(value)?.name ?? null;
    if (kind === "condition") return ready(datasets.peek("conditions")) ? datasets.peek("conditions").descriptors.get(value)?.name ?? null : null;
    if (kind === "company") return ready(datasets.peek("companies")) ? datasets.peek("companies").row(value)?.name ?? null : null;
    return kind === "text" ? UI.textTitle(value) : null;
  }

  return {
    render,
    need,
    title: viewTitle,
    conditions: () => (ready(datasets.peek("conditions")) ? datasets.peek("conditions") : null),
    // Company groups (the "Companies" suggestions): null until need("companies") has loaded them.
    companies: () => (ready(datasets.peek("companies")) ? datasets.peek("companies") : null),
    // ema_medicines rows by product (EMA's opinion in the suggestions): null until need("medicines").
    medicines: () => (ready(datasets.peek("medicines")) ? datasets.peek("medicines") : null),
    // Document rows by product (the table's PI and EPAR links): null until need("documents") has loaded them.
    documents: () => (ready(datasets.peek("documents")) ? datasets.peek("documents") : null),
    // MeSH scope notes (buildMeshNotes()): null until need("meshNotes") has loaded them (or failed).
    meshNotes: () => (ready(datasets.peek("meshNotes")) ? datasets.peek("meshNotes") : null),
    // Substance equivalents (substanceEquivalents()): null until need("equivalents") has loaded them
    // (none when that failed: older data).
    equivalents: () => (ready(datasets.peek("equivalents")) ? datasets.peek("equivalents") : null),
    // Draft (loss-of-exclusivity calendar): the protection dataset as need() gives it (undefined
    // while loading or not asked for yet, FAILED), without starting a load.
    protection: () => datasets.peek("protection"),
    // Drug-class suggestions need the class names and the current counts: null until both have loaded.
    atcClasses: () => {
      const [atc, counts] = [datasets.peek("atc"), datasets.peek("atcCounts")];
      return ready(atc) && ready(counts) ? { classes: atc.classes, counts } : null;
    },
    link: internalLink,
    onData: (listener) => listeners.push(listener),
    focusOnNextRender: () => {
      focusNext = true;
    },
  };
}
