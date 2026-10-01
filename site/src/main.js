import * as d3 from "d3";
import {
  MEDICINE_TYPES,
  authorizedSeries,
  breakdownExcluded,
  buildProducts,
  buildSubstanceIndex,
  byStatusOrder,
  countTiles,
  isAuthorizedNow,
  newestFirst,
  sortBreakdownRows,
} from "./approvals.js";
import { appendSortIcon, renderActivity } from "./activity.js";
import { createAreaTree, renderAreaPath } from "./area-tree.js";
import { areaBreakdownRows, areaCategoryTip, areaDrillVia, areaExactLabel, areaUpLevel, buildAreaTree, inAreas, termBranches, toggleArea } from "./areas.js";
import {
  atcChildren, atcClassesAt, atcClassTip, atcCode, atcExactCounts, atcExplanation, atcIncompleteAt, atcLevel, atcPrefixCounts, atcPrefixes, buildAtcExplanations, toggleAtcCode,
} from "./atc.js";
import { renderAtcPath } from "./atc-picker.js";
import { createAtcTree } from "./atc-tree.js";
import { NEGATIVE_OPINION, atcHue, companySeriesColors, statusColor, statusTipId, typeTipId } from "./badges.js";
import { renderBreakdown } from "./breakdown.js";
import { renderChart, renderLegend, renderStackLegend, typeColor } from "./chart.js";
import { buildCompanies, companyBreakdownRows, matchesCompany, namesBehind, suggestCompanies, toggleCompany } from "./companies.js";
import { createCompanyTree, renderCompanyPath } from "./company-tree.js";
import { createConditionsCard } from "./conditions-card.js";
import { equivalentSetKey, substanceAuthorizedCount } from "./copies.js";
import { csvFileName, medicinesCsv } from "./csv.js";
import { FAILED, settledOrAfter } from "./datasets.js";
import { createFacetPanel } from "./facet-panel.js";
import {
  FACET_VALUES,
  OTHER_KEY,
  STACK_HUES,
  TYPE_ORDER,
  conditionRows,
  defaultSortDirection,
  facetCounts,
  filterChips,
  holderActivity,
  keyCounts,
  nextSort,
  orderActivityColumns,
  sortActivityRows,
  statusBreakdown,
  statusStackAvailable,
  topKeys,
  topWithOther,
  typeSplit,
  UNPLACED_KEY,
  withUnplaced,
  yearHistogram,
  yearStackMode,
  yearStacks,
} from "./facets.js";
import { renderFilterChips, renderFilterSummary } from "./filter-bar.js";
import { OVER_TIME_EXCEPT, filterProducts, makePredicates, splitAtcValues } from "./filters.js";
import { createHistoryScroll, placeAt, restoreStep } from "./history-scroll.js";
import { companyBadge, holderDisplay } from "./holders.js";
import { createIntro } from "./intro.js";
import { SOURCES, UI, atcClassLabel, atcName, statusLabel } from "./labels.js";
import { isWebLink, markExternal, openIcon } from "./links.js";
import { createLookup, headlineNodes } from "./lookup.js";
import { areaNote, describedTip, meshTip } from "./mesh-notes.js";
import { NOT_CLASSIFIED, buildModalityTree, modalityBreakdownRows, modalityTip, modalityTipId, toggleModality } from "./modalities.js";
import { createModalityTree, renderModalityPath } from "./modality-tree.js";
import { renderOverTime, renderOverTimeLegend } from "./over-time.js";
import { PREVIEW_ROWS, renderPreview, topGroups } from "./overview-previews.js";
import { renderProtectionCalendar } from "./protection-calendar-card.js";
import { LATER, calendarBuckets, protectionEnding } from "./protection-calendar.js";
import { createSearchBox } from "./search-box.js";
import { createRecent, keptOpenedClass, openedClass, recentEntry, recentLookupState } from "./recent.js";
import { MIN_QUERY, buildLookupIndex, didYouMean, foldSearchText, knownSubstance, searchWithFallback, suggest, suggestAtcClasses } from "./search.js";
import { createPopover, nextOpenChip } from "./popover.js";
import { createSheet } from "./sheet.js";
import { tabsKeydown } from "./tabs.js";
import { createTable } from "./table.js";
import { createThemeToggle } from "./theme.js";
import { renderTiles } from "./tiles.js";
import { atPointer, isSwipe, pointerBridge, tipAbove, tipBounds, tipClick, tipFitsAbove, tipHeightEstimate, tipMaxWidth, tipShift, towardTip } from "./tips.js";
import {
  DEFAULT_LOOKUP,
  DEFAULT_STATE,
  FILTER_KEYS,
  STATUS_ALL,
  activeFilterCount,
  classState,
  decodeLookup,
  decodeState,
  encodeUrl,
  isDefaultStatus,
  lookupView,
  patchFilterParams,
  patchIsSet,
  scheduleUrlWrite,
  setHistoryWriter,
  togglePatch,
  withoutLookup,
} from "./url.js";
import { activityTakeaway, breakdownTakeaway, conditionsTakeaway, overTimeTakeaway, protectionTakeaway, takeawayYear, yearsTakeaway } from "./takeaways.js";
import { setupCardInfo, setupViewOptions } from "./view-options.js";
import { createYearStrip } from "./year-slider.js";

// First load: enough for the search box. Everything else loads in the background or on demand.
const FIRST_FILES = ["meta.json", "ema_search_index.json", "mesh_entry_terms.json"];
const DASHBOARD_FILES = [
  "ema_medicines.json",
  "ema_medicine_therapeutic_areas.json",
  "ema_medicine_active_substances.json",
  "ema_medicine_atc_codes.json",
  "atc_classes.json",
  "ema_therapeutic_area_branches.json",
  "ema_authorized_series.json",
  "ema_therapeutic_area_subtree.json",
  // Companies part 2: holders by company group (shared with the lookup's cards and search).
  "companies.json",
  "ema_medicine_companies.json",
];
// Modality (M2 phase 2): with the dashboard's files (the filter and a link's mod values need them),
// shared with the cards (lookup.need("modalities")); without them (older data files) the page
// works and shows no modality.
const MODALITY_FILES = ["modalities.json", "ema_medicine_modalities.json"];
// The ATC class explanations (owner decisions 2026-09-29): with the dashboard's files, optional as
// the modality files (without them the ATC tips are as before), shared with the lookup's result
// tables (lookup.need("atc")).
const ATC_EXPLANATION_FILES = ["atc_class_explanations.json"];
// Loaded after the dashboard's first render; shared with the medicine card (same loadFile promise),
// as are the primary documents (lookup.need("primaryDocuments")).
const REGISTER_FILE = "ema_medicine_register_status.json";
// The filter each breakdown ignores and toggles.
const BREAKDOWN_FILTER = { atc: "atc", area: "area", mah: "mah", mod: "mod" };
// Desktop from this width: a chip opens its popover; below it, a bottom sheet.
const DESKTOP = window.matchMedia("(min-width: 1024px)");
// The facet section (index.html #facet-{id}) each filter chip opens, and the filter keys it sets.
const CHIP_SECTIONS = { type: "type", mod: "modality", atc: "atc", area: "area", mah: "mah", status: "status", years: "years" };
const CHIP_KEYS = { type: ["type"], mod: ["mod"], atc: ["atc"], area: ["area"], mah: ["mah"], status: ["status"], years: ["from", "to"] };
// The trees need a wider popover.
const WIDE_CHIPS = new Set(["atc", "area", "mah", "mod"]);
// Desktop: the control a popover focuses when it opens (the trees: their first checked row, else
// their search: facet-tree.js focusTarget(); the years: the slider's Start thumb).
const FOCUS_TARGETS = {
  type: "#facet-type input",
  status: "#facet-status input",
  years: "#year-start",
};
// The checklist sections (facet-panel.js); the ATC classes, therapeutic areas and companies are trees.
const FACETS = ["type", "status"];
// "Who is active where": holders (rows), therapeutic area columns, and the column key of the areas
// beyond them.
const ACTIVITY_HOLDERS = 15;
const ACTIVITY_AREAS = 12;
const ACTIVITY_OTHER = "__other__";
// The column of the medicines at the area itself (areas.js areaExactLabel()).
const ACTIVITY_EXACT = "__exact__";
// "Approvals per year" stacked by company group, or by the child classes of one ATC class: the top
// ones, then Other on top. Child classes and modalities: damped hue mids (facets.js STACK_HUES),
// neighbouring hues far apart (1px gaps separate the segments too); company groups: their own
// colours (badges.js companySeriesColors()). Level-1 ATC groups: the top six, each in its own
// group's hue. Other (and the modalities' Not classified and "not more specific"):
// the raised fill with a --field-border outline (3:1, palette.test.js), so it does not outweigh
// the named series. The medicines a mode cannot place: the same, hatched (chart.js), on top.
const STACK_TOP = 8;
const STACK_ATC_GROUPS = 6;
const STACK_OTHER = { color: "var(--raised)", stroke: "var(--field-border)" };
const STACK_UNPLACED = { ...STACK_OTHER, hatch: true };

const $ = (selector) => document.querySelector(selector);

// The header's theme button (Auto, Light, Dark). The charts' colours are CSS var()s, so they follow
// a new theme at once; a render (as after a resize) keeps anything drawn from the tokens in step
// (none before the search's data has loaded).
createThemeToggle($("#theme-toggle"), { onChange: () => lookup && scheduleRender() });

// The landing intro card: shown or hidden on every render (the untouched overview, until closed),
// and the Try line with it (hidden while the card shows). Its examples are lookup links (pushState,
// as the Try line's), made on the first render.
const intro = createIntro($("#intro"), $("#intro-link"), { link: (...args) => lookup.link(...args), tryLine: $("#lookup-try") });

// The viewer's recently viewed (recent.js; this device only): each medicine, substance, condition,
// company or class view once named (updateTitle()), offered by the search while it is empty; a class
// only when a lookup opened it (navigate(); not a filter or a drill: openClass), and only entries
// that still resolve (a condition or company kept until its data has loaded; a class always).
let openClass = null;
const recent = createRecent(undefined, (entry) => {
  const lookupState = recentLookupState(entry);
  if (!lookupState || !lookup) return true;
  if ((entry.kind === "conditions" && !lookup.conditions()) || (entry.kind === "companies" && !lookup.companies())) return true;
  return lookup.title(lookupState) !== null;
});

// A shared medicine link (?med=, the phone lookup during a talk): once the search works, the
// card's document buttons (the small primary-documents file) load before any other file, which
// waits for it (or its failure), so the buttons do not share the network with the dashboard's
// megabyte (audit 2026-09-30, S5); but no longer than FIRST_FILE_WAIT_MS, as a stalled small
// file must not hold the card's other parts (it takes about 0.4 s on the audit's phone profile).
// null: no file waits.
const PRIMARY_DOCUMENTS_FILE = "ema_medicine_primary_documents.json";
const FIRST_FILE_WAIT_MS = 1500;
let firstFile = null;
const files = new Map();
function loadFile(file) {
  if (!files.has(file)) {
    const request = () => d3.json(`/data/${file}`);
    files.set(file, (firstFile && file !== PRIMARY_DOCUMENTS_FILE ? firstFile.then(request) : request()).catch((error) => {
      // A failed load (flaky network) is retried by the next caller; the primary documents' 404
      // (older data without the file) is kept for this page load, so it is not asked for again.
      if (file !== PRIMARY_DOCUMENTS_FILE || !String(error?.message).startsWith("404")) files.delete(file);
      throw error;
    }));
  }
  return files.get(file);
}

// Saves text as a file on the viewer's device through a Blob link (same origin, so the CSP allows
// it; nothing is sent anywhere). The URL is released later, as some browsers read it after click().
function saveFile(text, fileName, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 40000);
}

// Runs callback once the page is idle (Safari has no requestIdleCallback: after 2 seconds).
function whenIdle(callback) {
  if ("requestIdleCallback" in window) window.requestIdleCallback(callback, { timeout: 10000 });
  else setTimeout(callback, 2000);
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
  // A worker taking control (first visit, or a new build whose worker deleted the old asset cache)
  // lacks what was loaded before; hand it those URLs (in-flight data files included) so the
  // site opens offline after one visit.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    const loaded = performance.getEntriesByType("resource").map((entry) => entry.name);
    navigator.serviceWorker.controller?.postMessage([...loaded, ...[...files.keys()].map((file) => `/data/${file}`)]);
  });
}

// One state for the lookup (q/med/sub/cond) and the filters. Until the dashboard's data has
// loaded, the filter domain is unknown, so the URL's filter part is kept verbatim.
let state = { ...structuredClone(DEFAULT_STATE), ...DEFAULT_LOOKUP };
let dashboard = null;
let pendingFilters = new URLSearchParams();
let lookup = null;
// Whether a chip's filter popover is open (set once the dashboard exists): the intro card stays as
// it is shown until it closes (intro.js introVisible() held).
let filtersOpen = () => false;
// Closes an open filter popover or sheet without handing focus back to its chip (set once the
// dashboard exists): Back or Forward shows another view, which the open filters would edit unseen.
// True when one was open.
let closeFiltersNow = () => false;
let frame = 0;
// History entries pushed or popped so far: an Enter waiting for the search's data (search-box.js)
// is dropped when one comes first (bug hunt 2026-10-01).
let navigations = 0;
const urlNote = $("#url-note");
// Filter edits (not the first render, the breakdown's mode, the tab or lookups) announce the new
// headline, debounced (url.js FILTER_KEYS: every state key but the views, by and tab).
let announceFilters = false;
let announceTimer = 0;
// A drug class opened from a card or the search: its headline takes focus once shown.
let focusAnswer = false;
// A change made on a chart (the per-year chart's brush) re-renders the cards above it with other
// heights: the chart stays where it was on screen, under the pointer (applied after the render).
let scrollAnchor = null;
const keepInPlace = (element) => {
  scrollAnchor = { element, top: element.getBoundingClientRect().top };
};

// Scroll positions per history entry (history-scroll.js): the page restores them itself. A new view
// (a push) scrolls to its heading, which takes focus (render()); Back and Forward return to where
// the view was left, once it has rendered (a reload too, once the dashboard has). Until then scroll
// anchoring is off (html.restoring-scroll), as it would move the page by the height of a card put
// back above (lookup.md #1); a wheel, touch, key or pointer press ends a restore still waiting, so
// the page never jumps under the user. A place is kept by the part at the middle of the screen (the
// result or the overview), with the result's open disclosures, which the card made anew reopens
// (lookup.js render(): More details, the full indication).
const TOP = placeAt(0, 0, { result: null, overview: null });
// The place a Back, Forward or reload goes to once rendered (restoreScroll()), else null.
let pendingScroll = null;
// The parts a place is kept by: the lookup result and the overview (#app), by their document tops.
function pageMarks() {
  const documentTop = (element) => element.getBoundingClientRect().top + window.scrollY;
  const result = $("#result");
  const app = $("#app");
  return {
    result: result.hidden ? null : { top: documentTop(result), height: result.offsetHeight },
    overview: app.hidden ? null : documentTop(app),
  };
}
// While a restore waits, the place it goes to (a second Back, a reload before it).
function pagePlace() {
  if (pendingScroll !== null) return pendingScroll;
  const result = $("#result");
  const open = result.hidden ? [] : [...result.querySelectorAll("details[open][data-key]")].map((details) => details.dataset.key);
  return placeAt(window.scrollY, window.innerHeight, pageMarks(), open);
}
const historyScroll = createHistoryScroll(window, pagePlace);
setHistoryWriter(historyScroll);
// The disclosures the next render's lookup card reopens (Back, Forward, a reload), then null.
let reopenKeys = historyScroll.initial?.open ?? null;
// Back or Forward closed a filter popover or sheet, whose chip took focus back: settled after the
// restore (settleFocus()).
let refocus = false;
function stopRestoring() {
  pendingScroll = null;
  refocus = false;
  document.documentElement.classList.remove("restoring-scroll");
}
function startRestoring(place) {
  pendingScroll = place;
  document.documentElement.classList.add("restoring-scroll");
}
// The chip a closed sheet gave focus back to can be out of view in the view shown (the restored card
// at the top, the chip below it), and a closed popover leaves focus on the page: focus goes to the
// view's heading when in view, else to the page (dashboard.md #2 review).
function settleFocus() {
  const inView = (element) => {
    const box = element.getBoundingClientRect();
    return box.bottom > 0 && box.top < window.innerHeight;
  };
  const active = document.activeElement;
  if (active && active !== document.body && inView(active)) return;
  const heading = lookupView(state).kind !== null ? $("#result").querySelector("h1") : $("#headline");
  if (heading && inView(heading)) heading.focus({ preventScroll: true });
  else active?.blur();
}
// After a render (the lookup's own too, as its data arrives): final once the dashboard is there and
// the lookup view's data has loaded (the page's height then holds, short of later data: the page's
// end will do).
function restoreScroll() {
  if (pendingScroll === null) return;
  const step = restoreStep(pendingScroll, pageMarks(), {
    maxScroll: document.documentElement.scrollHeight - window.innerHeight,
    viewportHeight: window.innerHeight,
    final: dashboard !== null && !lookup?.loading(),
  });
  if (!step) return;
  const settle = refocus;
  window.scrollTo(0, step.y);
  stopRestoring();
  if (settle) settleFocus();
}
if (historyScroll.initial !== null) startRestoring(historyScroll.initial);
// A second after the page stops scrolling, the entry notes where it is; and the tab, when the page
// is left or hidden (a reload within that second; at most one history write a second).
let scrollSaveTimer = 0;
window.addEventListener("scroll", () => {
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(historyScroll.save, 1000);
}, { passive: true });
window.addEventListener("pagehide", historyScroll.leave);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") historyScroll.leave();
});
for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
  window.addEventListener(type, () => {
    if (pendingScroll !== null) stopRestoring();
  }, { capture: true, passive: true });
}

function applyUrl() {
  const params = new URLSearchParams(window.location.search);
  const lookupState = decodeLookup(params);
  if (!dashboard) {
    pendingFilters = withoutLookup(params);
    state = { ...state, ...lookupState };
    return;
  }
  const decoded = decodeState(params, dashboard.domain);
  state = { ...decoded.state, ...lookupState };
  urlNote.hidden = decoded.dropped.length === 0;
  urlNote.textContent = UI.ignoredValues(decoded.dropped.length);
}

// The tab's title names the view (a card, condition, search or drug class), so history, tabs and
// bookmarks tell them apart and screen readers hear the change (WCAG 2.4.2).
function updateTitle() {
  const lookupOpen = lookupView(state).kind !== null;
  const name = lookupOpen ? lookup.title(state) : dashboard?.title() ?? null;
  // The dashboard's tab follows the view's name (F · Spacious, phase 2: "L04AC … · Classes and
  // areas"); a recent entry is named by the view alone.
  const tab = lookupOpen ? null : dashboard?.tabName() ?? null;
  document.title = UI.pageTitle([name, tab].filter(Boolean).join(" · ") || null);
  openClass = keptOpenedClass(state, openClass);
  recent.view(recentEntry(state, name, openClass));
}

function render() {
  placeTopbar();
  lookup.render(state, false, reopenKeys);
  reopenKeys = null;
  const lookupOpen = lookupView(state).kind !== null;
  $(".answer").hidden = lookupOpen; // the lookup result is the answer; one headline per screen
  // Below a lookup result, the dashboard is the overview of every medicine: its heading says so and
  // a note replaces the lead. The page has one h1 at the top: the result's headline while a result
  // is open (lookup.js), and then the overview's heading is an h2 (review of phase 1).
  const level = lookupOpen ? "H2" : "H1";
  let pageTitle = $("#page-title");
  if (pageTitle.tagName !== level) {
    const heading = document.createElement(level);
    heading.id = "page-title";
    pageTitle.replaceWith(heading);
    pageTitle = heading;
  }
  // The overview heading and its scope line; "Explore EMA medicines" names the source itself. With
  // the status filter widened neither says "approved" or "authorized" (owner decisions 2026-09-30);
  // before the dashboard's data has loaded, the URL's status values are still verbatim
  // (pendingFilters).
  const widened = dashboard
    ? !isDefaultStatus(state.status)
    : pendingFilters.getAll("status").some((value) => !DEFAULT_STATE.status.includes(value));
  pageTitle.textContent = lookupOpen ? UI.explore.title : UI.page.title(SOURCES, { widened });
  const scope = $("#page-scope");
  scope.hidden = lookupOpen;
  scope.textContent = UI.page.scope(SOURCES, { widened });
  $("#explore-note").hidden = !lookupOpen;
  // The intro card, and the Try line with it. Before the dashboard's data has loaded, the URL's
  // filters are still verbatim (pendingFilters). While a filter popover is open it stays as it is.
  intro.render(state, dashboard ? null : pendingFilters, { hold: filtersOpen() });
  dashboard?.render();
  updateTitle();
  if (scrollAnchor) {
    const { element, top } = scrollAnchor;
    scrollAnchor = null;
    window.scrollBy(0, element.getBoundingClientRect().top - top);
  }
  if (focusAnswer && dashboard && !lookupOpen) {
    focusAnswer = false;
    const headline = $("#headline");
    headline.focus({ preventScroll: true });
    headline.scrollIntoView({ block: "nearest" });
  }
  restoreScroll();
}

function scheduleRender() {
  if (!frame) frame = requestAnimationFrame(() => {
    frame = 0;
    render();
  });
}

function setState(patch, push = false) {
  // Navigations (push) move focus to the new headline instead.
  if (!push && FILTER_KEYS.some((key) => key in patch)) announceFilters = true;
  if (push) navigations += 1;
  state = { ...state, ...patch };
  // Before the dashboard has loaded, filter changes go into the URL's kept filter part.
  if (!dashboard) pendingFilters = patchFilterParams(pendingFilters, patch);
  urlNote.hidden = true;
  scheduleRender();
  scheduleUrlWrite(state, push, dashboard ? null : pendingFilters);
}

// Opening a card or result, or a drug class on the dashboard (patch without lookup keys): one
// history entry, focus moves to its heading.
function navigate(patch) {
  const next = { ...DEFAULT_LOOKUP, ...patch };
  openClass = openedClass(next);
  focusAnswer = lookupView(next).kind === null;
  if (!focusAnswer) lookup.focusOnNextRender();
  setState(next, true);
}

function showMissingData() {
  const [before, command, after] = UI.missingData;
  d3.select("#message")
    .attr("hidden", null)
    .call((message) => message.append("span").text(before))
    .call((message) => message.append("code").text(command))
    .call((message) => message.append("span").text(after));
  d3.select("#app-loading").attr("hidden", "");
  // The main column no longer holds a screen's height for the dashboard, and the search, which kept
  // its place in the top bar while loading (style.css), shows, disabled: there is nothing to search.
  d3.select("main").classed("load-failed", true);
  $("#lookup").hidden = false;
}

// Copy parts (labels.js UI.footer, UI.about) into an element: text as text nodes, { text, url } as a
// link to another website (new tab, no opener or referrer, marked by markExternal()) or, a mailto:
// url, an email link (isWebLink(): in place, unmarked), never parsed as HTML.
function appendParts(element, parts) {
  for (const part of parts) {
    if (typeof part === "string") {
      element.append(part);
      continue;
    }
    const anchor = document.createElement("a");
    anchor.href = part.url;
    anchor.textContent = part.text;
    element.append(anchor);
    if (!isWebLink(part.url)) continue;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    markExternal(anchor);
  }
}

// The footer's three lines and the About disclosure (legal review 2026-09-30). Rendered before any
// data loads (meta null: no versions or dates), and again with meta.json's sources: the data's date,
// the MeSH version, the ChEMBL release, the company groups' curation date, and whether the data
// credits the ATC class explanations and WHO's INN stems (older data: neither).
function renderFooter(meta = null) {
  const sources = meta?.sources ?? [];
  const versionOf = (pattern) => sources.find((source) => pattern.test(source.name))?.version ?? null;
  const credits = {
    date: meta ? (meta.snapshot_date ?? meta.source_timestamp?.slice(0, 10) ?? null) : null,
    mesh: versionOf(/mesh/i),
    chembl: versionOf(/chembl/i),
    explained: sources.some((source) => /atc class explanations/i.test(source.name)),
    innStems: sources.some((source) => /inn stems/i.test(source.name)),
    efficacy: sources.some((source) => /pivotal results/i.test(source.name)),
  };
  const groupsDate = versionOf(/company groups/i)?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  const line = (id, parts) => {
    const element = document.getElementById(id);
    element.replaceChildren();
    appendParts(element, parts);
  };
  line("footer-sources", UI.footer.sources(credits));
  line("footer-use", [UI.footer.use]);
  line("footer-licence", UI.footer.licence);

  const { about } = UI;
  const body = document.getElementById("about-body");
  body.replaceChildren();
  // Each part a real heading (heading navigation), styled run-in before its text (style.css).
  const section = (head, content) => {
    const part = document.createElement("div");
    part.className = "about-part";
    const heading = document.createElement("h3");
    heading.textContent = head;
    part.append(heading, " ", content);
    body.append(part);
  };
  const paragraph = (parts) => {
    const element = document.createElement("p");
    appendParts(element, parts);
    return element;
  };
  section(about.heads.what, paragraph([about.what]));
  section(about.heads.scope, paragraph([about.scope]));
  section(about.heads.use, paragraph([about.use(groupsDate).join(" ")]));
  const list = document.createElement("ul");
  list.className = "about-sources";
  for (const parts of about.sources(credits)) {
    const item = document.createElement("li");
    appendParts(item, parts);
    list.append(item);
  }
  section(about.heads.sources, list);
  section(about.heads.privacy, paragraph([about.privacy]));
  section(about.heads.contact, paragraph(about.contact));
}

// The type and status explanations as hidden elements, which describe the focusable carriers (facet
// rows, the filter chips' type, status and modality values) through aria-describedby (a hidden element still
// gives its text).
function renderTypeTips() {
  const container = d3.select("body").append("div").attr("hidden", "");
  for (const [label, tip] of Object.entries(UI.typeTips)) container.append("p").attr("id", typeTipId(label)).text(tip);
  for (const [status, tip] of Object.entries(UI.statusTips)) container.append("p").attr("id", statusTipId(status)).text(tip);
  // A negative opinion's: the medicines table's status dots (owner decision 2026-09-30).
  container.append("p").attr("id", statusTipId(NEGATIVE_OPINION)).text(UI.negativeOpinionTip);
  // The modality explainers (M2 phase 2): tree rows, a filter chip, breakdown bars.
  for (const [key, tip] of Object.entries(UI.modalityTips)) container.append("p").attr("id", modalityTipId(key)).text(tip);
}

// The tooltips (data-tip, style.css) are dismissible (WCAG 1.4.13): Escape hides them (and does
// nothing else, so a popover's Escape waits for the next press) until the pointer reaches another
// carrier or focus moves (on touch screens a swipe does too); a pointer click on a tip only hides it,
// as it lies over other controls, and a pointer click on a MeSH explainer's carrier hides it too
// (step 4 review: it covered the next
// rows, so checking one row and moving to the next took two clicks). On mouse hover (owner decision
// 2026-09-29) a tip opens at the pointer: fixed (.tip-at-pointer, --pointer-tip-x/-y, CSSOM),
// 12px below and right of where the pointer entered its carrier, or, for a MeSH explainer, where it
// rests when its pause ends, flipped above or left without room (atPointer()); it stays put, and
// leaving the carrier toward it holds it, so the pointer can move onto it. Keyboard focus and touch
// taps anchor it to its carrier: a carrier whose tip is anchored to its row (static: lookup rows, the
// ATC, area and modality trees in a popover or sheet) puts the tip under its own line (--tip-top; a
// tapped tree row's above it where it fits: staticTipTop()); a tip starting at its carrier that
// would cross the viewport's right edge (a status near the right of a phone) or its
// scroll box's (the medicines table) moves left (--tip-left), and goes above it where the box has no
// room below (.tip-above).
function setupTips() {
  const root = document.documentElement;
  let hiddenOn = null; // the carrier under the pointer when the tips were hidden
  // Where a pointer click hid them: until the pointer moves, pointerover there comes from the page
  // changing under it (a drilled breakdown's new bars), and focus from a click or a script (a
  // label's checkbox, the first new bar), neither of which shows them again.
  let clickedAt = null;
  const carrierOf = (target) => (target instanceof Element ? target.closest("[data-tip]") : null);
  const showing = () => [...document.querySelectorAll("[data-tip]:is(:hover, :focus-within, .tip-hold)")]
    .some((carrier) => getComputedStyle(carrier, "::after").content !== "none");
  const pointAt = (event) => ({ x: event.clientX, y: event.clientY });
  // Touch screens (phones) and touch input anchor tips to their carriers, as before.
  const touchScreen = window.matchMedia("(hover: none)");
  const touch = (event) => event.pointerType === "touch" || touchScreen.matches;
  // What a mouse click focuses: the element itself, or the nearest such ancestor.
  const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]";
  // A scroll box's visible area inside its borders and scrollbars and the viewport, in viewport
  // pixels.
  function scrollArea(box) {
    const rect = box.getBoundingClientRect();
    const top = rect.top + box.clientTop;
    const left = rect.left + box.clientLeft;
    return {
      left: Math.max(left, 0),
      top: Math.max(top, 0),
      right: Math.min(left + box.clientWidth, root.clientWidth),
      bottom: Math.min(top + box.clientHeight, root.clientHeight),
    };
  }
  function reveal() {
    hiddenOn = null;
    clickedAt = null;
    root.classList.remove("tips-hidden");
  }
  // under: the carrier the tips stay hidden on while the pointer is there (the one under it; none
  // after a swipe, so a tap on the carrier shows its tip again).
  function hide(at = null, under = document.querySelector("[data-tip]:hover")) {
    release();
    hiddenOn = under;
    clickedAt = at;
    root.classList.add("tips-hidden");
  }
  // A tip in a scroll box (clip) is no wider than the box (--tip-max, style.css), else as wide as
  // its style allows.
  function capWidth(carrier, clip) {
    if (clip) carrier.style.setProperty("--tip-max", `${tipMaxWidth(clip)}px`);
    else carrier.style.removeProperty("--tip-max");
  }
  // A static carrier's tip (anchored to its row): under its own line, or, for a tree row whose tip a
  // tap shows (tapped), above the row where it fits in the visible part of its scroll box, over rows
  // already passed (bug hunt 2026-10-01: under it, A02's covered A03 and A04 in the ATC sheet;
  // tipFitsAbove()). In px from the containing block's top; style.css adds 4px (top: calc(--tip-top
  // + 4px)), so a tip above ends 4px over the row.
  function staticTipTop(carrier, tapped) {
    const below = carrier.offsetTop + carrier.offsetHeight;
    if (!tapped || !carrier.matches(".atc-row")) return below;
    const box = carrier.closest(".sheet-body, .popover-body");
    const clip = box ? scrollArea(box) : { top: 0 };
    const measured = parseFloat(getComputedStyle(carrier, "::after").height);
    const height = Number.isFinite(measured) ? measured
      : tipHeightEstimate(carrier.dataset.tip.length, carrier.offsetParent?.clientWidth ?? root.clientWidth);
    return tipFitsAbove(carrier.getBoundingClientRect(), height, clip) ? carrier.offsetTop - height - 8 : below;
  }
  // Keyboard focus and touch taps (tapped): the tip at its carrier.
  function anchor(carrier, tapped = false) {
    carrier.classList.remove("tip-at-pointer");
    if (pointed?.carrier === carrier) pointed = null;
    if (getComputedStyle(carrier).position === "static") {
      carrier.style.setProperty("--tip-top", `${staticTipTop(carrier, tapped)}px`);
      return;
    }
    carrier.style.removeProperty("--tip-left");
    carrier.classList.remove("tip-above");
    // In a scroll box, no wider than the box (--tip-max; review of the ATC class explanations).
    const scroller = carrier.closest(".table-scroll, .activity-scroll");
    const clip = scroller ? scrollArea(scroller) : null;
    capWidth(carrier, clip);
    // Its width once shown (a tip spanning its carrier, as on tiles and facet rows, never moves),
    // else the widest it can be (its style.css max-width: wider for the MeSH explainers).
    const tip = getComputedStyle(carrier, "::after");
    const measured = parseFloat(tip.width);
    const widest = parseFloat(tip.maxWidth);
    const width = Number.isFinite(measured) ? measured
      : Number.isFinite(widest) ? widest : Math.min(16 * parseFloat(getComputedStyle(root).fontSize), root.clientWidth - 32);
    // It starts where the carrier's first line does (a link wrapping in a narrow cell) and stays
    // inside the scroll box that clips it, within its scrollbars (step 4 review: the medicines
    // table's ended 17px before the viewport's limit), never starting left of it.
    const start = (carrier.getClientRects()[0] ?? carrier.getBoundingClientRect()).left;
    const shift = tipShift(start, width, Math.min(root.clientWidth - 16, clip ? clip.right - 8 : Infinity), clip ? clip.left + 8 : -Infinity);
    if (shift) carrier.style.setProperty("--tip-left", `${shift}px`);
    if (!clip) return;
    const measuredHeight = parseFloat(tip.height);
    const height = Number.isFinite(measuredHeight) ? measuredHeight : tipHeightEstimate(carrier.dataset.tip.length, width);
    if (tipAbove(carrier.getBoundingClientRect(), height, clip)) carrier.classList.add("tip-above");
  }
  // Mouse hover: the tip at the pointer. pointed: the carrier placed so last, where the pointer was
  // (anchor) and the tip is (rect, viewport pixels), its size, the origin of its fixed containing
  // block (the viewport, or an ancestor that makes one, e.g. a sheet while its transform animates:
  // a probe finds it) and the scroll box that bounds it (clip), kept inside that box as an anchored
  // tip is (step 4 review).
  let pointed = null;
  function fixedOrigin(carrier) {
    const probe = document.createElement("span");
    probe.className = "tip-probe";
    carrier.append(probe);
    const { left, top } = probe.getBoundingClientRect();
    probe.remove();
    return { x: left, y: top };
  }
  // Its size once shown, else its widest (its max-width) and the height its text takes there.
  function tipSize(carrier) {
    const tip = getComputedStyle(carrier, "::after");
    const width = parseFloat(tip.width);
    const height = parseFloat(tip.height);
    if (Number.isFinite(width) && Number.isFinite(height)) return { width, height, measured: true };
    const widest = parseFloat(tip.maxWidth);
    const estimate = Number.isFinite(widest) ? widest : Math.min(256, root.clientWidth - 32);
    return { width: estimate, height: tipHeightEstimate(carrier.dataset.tip.length, estimate), measured: false };
  }
  function moveTip(point) {
    const { carrier, size, origin, clip } = pointed;
    // .tip-pointer-above: above the pointer (the medicines table's status dots, whose row's PI and
    // EPAR links a tip below covered).
    const place = atPointer(point, size, tipBounds(root.clientWidth, root.clientHeight, clip), carrier.classList.contains("tip-pointer-above"));
    pointed.anchor = point;
    pointed.rect = { ...place, width: size.width, height: size.height, right: place.left + size.width, bottom: place.top + size.height };
    const bridge = pointerBridge(point, pointed.rect);
    pointed.bridge = bridge;
    const set = (name, value) => carrier.style.setProperty(name, `${value}px`);
    set("--pointer-tip-x", place.left - origin.x);
    set("--pointer-tip-y", place.top - origin.y);
    set("--bridge-x", bridge.left - origin.x);
    set("--bridge-y", bridge.top - origin.y);
    set("--bridge-w", bridge.width);
    set("--bridge-h", bridge.height);
  }
  // The pointer has left carrier and its tip: the tip leaves the pointer's place, back to the
  // carrier while it has keyboard focus (review 2026-09-29: it stayed where the pointer had been).
  function unpoint(carrier) {
    carrier.classList.remove("tip-at-pointer");
    if (pointed?.carrier === carrier) pointed = null;
    if (carrier.matches(":focus-visible, :has(:focus-visible)")) anchor(carrier);
  }
  function placeAtPointer(carrier, point) {
    carrier.classList.remove("tip-above");
    carrier.classList.add("tip-at-pointer");
    const scroller = carrier.closest(".table-scroll, .activity-scroll");
    const clip = scroller ? scrollArea(scroller) : null;
    capWidth(carrier, clip);
    pointed = { carrier, size: tipSize(carrier), origin: fixedOrigin(carrier), clip };
    moveTip(point);
    if (pointed.size.measured) return;
    requestAnimationFrame(() => {
      if (pointed?.carrier !== carrier) return;
      const size = tipSize(carrier);
      if (!size.measured) return;
      pointed.size = size;
      moveTip(pointed.anchor);
    });
  }
  // A tip at the pointer holds when the pointer leaves its carrier on the way to it (.tip-hold:
  // shown without its pause, style.css; towardTip()), so the pointer can move onto it (WCAG 1.4.13).
  // The hold ends when the pointer leaves that way, reaches another carrier, or after a moment
  // unless the pointer is on the carrier or its tip (then as long as it stays). Only a tip already
  // shown (a MeSH explainer's pause over) holds. Most ways onto the tip need no hold: they cross
  // its bridge (pointerBridge(), style.css), part of the carrier. No style or layout is read in
  // pointerout on the way to a hold: a style update between the carrier losing :hover and the class
  // arriving would drop the tip and restart its pause.
  const PAUSE_MS = 600;
  const pauseOf = (carrier) => (carrier.classList.contains("mesh-tip") ? PAUSE_MS : 0);
  let entered = { carrier: null, at: 0 };
  let held = null;
  let holdTimer = 0;
  function release() {
    clearTimeout(holdTimer);
    const was = held;
    held = null;
    if (!was) return;
    was.classList.remove("tip-hold");
    if (!was.matches(":hover")) unpoint(was);
  }
  const shownAt = (carrier, time) => !root.classList.contains("tips-hidden")
    && (held === carrier || (entered.carrier === carrier && time - entered.at >= pauseOf(carrier)));
  const onTheWay = (carrier, point) => pointed?.carrier === carrier && towardTip(pointed.anchor, pointed.rect, point);
  document.addEventListener("pointerout", (event) => {
    const carrier = carrierOf(event.target);
    if (!carrier || carrier.contains(event.relatedTarget)) return;
    if (!shownAt(carrier, event.timeStamp) || !onTheWay(carrier, pointAt(event))) {
      if (held === carrier) release();
      unpoint(carrier);
      return;
    }
    // Another carrier is never held here (entering this one released it), so none is read.
    if (held !== carrier) release();
    clearTimeout(holdTimer);
    held = carrier;
    carrier.classList.add("tip-hold");
    holdTimer = setTimeout(() => {
      if (!held?.matches(":hover")) release();
    }, 500);
  });
  document.addEventListener("pointerover", (event) => {
    const carrier = carrierOf(event.target);
    const fresh = entered.carrier !== carrier;
    if (fresh) entered = { carrier, at: event.timeStamp };
    if (!carrier) return;
    const returning = carrier === held; // back from the way to its tip, or on it
    if (!returning) release();
    if (carrier === hiddenOn) return;
    if (clickedAt && event.clientX === clickedAt.x && event.clientY === clickedAt.y) return;
    reveal();
    // A tap or the pointer on it: a quiet tip (focusQuietly()) shows again.
    carrier.classList.remove("tip-quiet");
    if (touch(event)) anchor(carrier, true);
    else if (!returning && (fresh || pointed?.carrier !== carrier)) placeAtPointer(carrier, pointAt(event));
  });
  document.addEventListener("pointermove", (event) => {
    if (touch(event)) return;
    const carrier = carrierOf(event.target);
    const point = pointAt(event);
    if (held && carrier !== held && !onTheWay(held, point)) release();
    // A MeSH explainer opens where the pointer rests when its pause ends: until then it follows.
    if (pointed && carrier === pointed.carrier && carrier === entered.carrier && carrier !== held
      && event.timeStamp - entered.at < pauseOf(carrier)) moveTip(point);
  }, { passive: true });
  document.addEventListener("focusin", (event) => {
    const visible = event.target.matches(":focus-visible");
    if (clickedAt && !visible) return;
    reveal();
    const carrier = carrierOf(event.target);
    // Focus a pointer click gives keeps the tip where the pointer opened it.
    if (carrier && (visible || !carrier.classList.contains("tip-at-pointer"))) anchor(carrier, !visible && touchScreen.matches);
  });
  document.addEventListener("focusout", (event) => {
    const carrier = carrierOf(event.target);
    if (carrier && !carrier.contains(event.relatedTarget)) carrier.classList.remove("tip-quiet");
  });
  // Touch screens: a swipe (the page or a scroll box scrolling under the finger) hides the tips, so
  // a tapped one never hangs over the rows scrolled to (bug hunt 2026-10-01: an ATC segment's 212px
  // tip covered the medicines table's next rows); the next tap on a carrier, or focus moving, shows
  // them again. A tap's own small movement is no swipe (isSwipe()).
  let touchStart = null;
  document.addEventListener("touchstart", (event) => {
    const [first] = event.touches;
    touchStart = event.touches.length === 1 ? { x: first.clientX, y: first.clientY } : null;
  }, { capture: true, passive: true });
  document.addEventListener("touchmove", (event) => {
    const [first] = event.touches;
    if (!touchStart || !first || !isSwipe(touchStart, { x: first.clientX, y: first.clientY })) return;
    touchStart = null;
    if (!root.classList.contains("tips-hidden") && showing()) hide(null, null);
  }, { capture: true, passive: true });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || root.classList.contains("tips-hidden") || !showing()) return;
    event.preventDefault();
    hide();
  }, true);
  // Keyboard and scripted clicks (detail 0) have no position. On touch screens a tap on a carrier
  // of a short tip (.tap-tip: the modalities', the ATC classes', the MeSH categories') shows it, as
  // a tap on a type or status carrier does:
  // there a tip takes no taps (style.css), so it never stands in the way of the next one. A tip at
  // the pointer can lie over its own carrier: a click on it is told apart by where it shows, and
  // where it lies over the carrier the click is meant for the control under it (review 2026-09-29:
  // the first click on a row's count or an area row's condition page link only hid the tip), which
  // gets it once the tip is hidden; so does a click on its bridge (unseen), over the next row or
  // over its own carrier's controls (review of PR #15: an ATC badge's other segments; tipClick()).
  // The tip and bridge are the carrier's, so the click reached the carrier.
  document.addEventListener("click", (event) => {
    const carrier = carrierOf(event.target);
    if (!carrier || event.detail === 0) return;
    const at = pointAt(event);
    const where = tipClick(at, carrier.getBoundingClientRect(), pointed?.carrier === carrier
      ? { shown: shownAt(carrier, event.timeStamp), tip: pointed.rect, bridge: pointed.bridge }
      : null);
    if (where === "carrier") {
      const tapShows = touchScreen.matches && carrier.classList.contains("tap-tip");
      if (carrier.classList.contains("mesh-tip") && !tapShows) hide(at);
      return;
    }
    hide(at);
    if (where === "tip") {
      event.preventDefault();
      return;
    }
    const under = document.elementFromPoint(at.x, at.y);
    if (!under || under === event.target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Within a label, to its checkbox: a scripted click on the label would also focus the checkbox
    // with a keyboard focus ring. Focus goes where the click would have put it (the synthetic click
    // moves none): the segment a table re-render focuses again, a checkbox, a link.
    const target = under.closest("label")?.control ?? under;
    target.closest(FOCUSABLE)?.focus({ preventScroll: true, focusVisible: false });
    target.dispatchEvent(new MouseEvent("click", event));
  }, true);
}

// Focus a script moves after a tap elsewhere (the drilled breakdown's first new bar): on touch
// screens, where focus alone shows a tip, its tip waits for a tap on it or keyboard focus (.tip-quiet,
// style.css; setupTips() drops the class when the pointer reaches it or focus leaves it). Bug hunt
// 2026-10-01: after a drill, L01's tip covered L04 and L03, so L read as having two subclasses.
function focusQuietly(element) {
  element?.closest("[data-tip]")?.classList.add("tip-quiet");
  element?.focus();
}

// Filled before any data loads, so it shows even when the data files are missing: the top bar's
// source line (the data's date follows with meta.json), the search field's name and placeholder, the
// page heading, the filter bar's name, the footer and the About disclosure (without the data's
// versions and dates until meta.json has loaded: renderFooter(meta)).
function renderAbout() {
  d3.select("#data-date").text(UI.dataDate(null));
  d3.select("#page-title").text(UI.page.title(SOURCES));
  d3.select("#page-scope").text(UI.page.scope(SOURCES));
  d3.select("#filter-bar-label").text(UI.filters.label);
  d3.select("#lookup-label").text(UI.lookup.label);
  d3.select("#lookup-input").attr("placeholder", UI.lookup.placeholder);
  d3.select("#about-summary").text(UI.about.summary);
  renderFooter();
}

// The colour tokens of both modes (style.css :root and its dark override, read from the chosen Dark
// theme's block, which equals the device's dark block), read once from the page's style sheets, so
// companySeriesColors() can keep the company stacks apart in either mode, whichever is shown. Empty
// maps when the sheets cannot be read (the colours are then not compared).
let palette = null;
function readPalette() {
  if (palette) return palette;
  const light = {};
  const dark = {};
  const read = (rule, into) => {
    for (const name of rule.style) if (name.startsWith("--")) into[name] = rule.style.getPropertyValue(name).trim();
  };
  for (const sheet of document.styleSheets) {
    let rules = [];
    try {
      rules = [...sheet.cssRules];
    } catch {
      continue; // a sheet from another origin
    }
    for (const rule of rules) {
      if (rule.selectorText === ":root") read(rule, light);
      else if (rule.selectorText === ':root[data-theme="dark"]') read(rule, dark);
    }
  }
  palette = { light, dark: { ...light, ...dark } };
  return palette;
}

function showOfflineNote(meta) {
  const note = $("#offline-note");
  const update = () => {
    note.hidden = navigator.onLine;
    note.textContent = UI.offline(meta.snapshot_date);
  };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

// result: suggest() output; classes: suggestAtcClasses() output; companies: suggestCompanies() output.
// The Companies group comes first when the query names a group (its name, monogram or another name
// exactly: "msd", "pfizer"), and Enter then opens its page (submitChoice(): named).
// medicines: ema_medicines rows by product number (EMA's opinion: a negative one says so), null
// until loaded.
// Step 2: a condition's exact entry term names it ("ADHD", #4); a substance found through another
// name says so and is named by it ("adrenaline", #19); a company found only through a derived
// monogram is weak (#4: Enter never opens it as the only suggestion). substanceCount(substance):
// its medicines authorized under all its spellings, as its card counts (copies.js
// substanceAuthorizedCount()).
function suggestionGroups(result, classes, companies, medicines, substanceCount) {
  const copy = UI.lookup;
  const companyGroup = {
    key: "companies",
    label: copy.groups.companies,
    options: companies.map((row) => ({ label: row.name, meta: copy.companyMeta(row.synonym, row.authorized), value: row.key, named: row.named, weak: row.weak })),
  };
  const named = companies.some((row) => row.named);
  return [
    ...(named ? [companyGroup] : []),
    {
      key: "medicines",
      label: copy.groups.medicines,
      options: result.medicines.map((row) => ({
        label: row.name_of_medicine,
        meta: copy.medicineMeta(row.medicine_status, row.marketing_authorisation_date?.slice(0, 4), medicines?.get(row.ema_product_number)?.opinion_status),
        value: row.ema_product_number,
      })),
    },
    {
      key: "substances",
      label: copy.groups.substances,
      options: result.substances.map((substance) => ({
        label: substance.name, meta: copy.substanceMeta(substanceCount(substance), substance.synonym), value: substance.key, named: substance.named,
      })),
    },
    {
      key: "conditions",
      label: copy.groups.conditions,
      options: result.conditions.map((condition) => ({
        label: condition.name, meta: copy.conditionMeta(condition.synonym, condition.authorized), value: condition.ui, named: condition.exact,
      })),
    },
    {
      key: "classes",
      label: copy.groups.classes,
      options: classes.map((row) => ({ label: atcClassLabel(row.code, row.name), meta: copy.classMeta(row.count, row.name === null), value: row.code })),
    },
    ...(named ? [] : [companyGroup]),
  ];
}

// A "did you mean" entry (didYouMean()) as an option: a medicine or substance opens its card, a
// WHO substance with no medicine through EMA runs the text search for its name (which says so).
function fuzzyOption(entry, substanceCount) {
  const copy = UI.lookup;
  if (entry.kind === "medicine") {
    return { label: entry.label, meta: copy.medicineMeta(entry.row.medicine_status, entry.row.marketing_authorisation_date?.slice(0, 4)), value: entry.value, pick: "medicines" };
  }
  if (entry.kind === "substance") return { label: entry.label, meta: copy.substanceMeta(substanceCount(entry.substance)), value: entry.value, pick: "substances" };
  return { label: atcName(entry.label), meta: copy.whoMeta(entry.code), value: entry.value, pick: "text" };
}

// The search list (step 2): the typed query's suggestions, or else those of a relaxed one (dose,
// form and qualifier words dropped, then the last word; #3: "Showing results for …"); when nothing
// matches, "No matches" (or that the WHO substance named has no medicine through EMA, #2) and up
// to 3 close names (#5); always last, the indication-text search for the typed text (#14).
// run(text): suggestionGroups() for a query. atcClasses: atc_classes.json rows, [] until loaded.
// substanceCount(substance): a substance option's authorized count. loading (bug hunt 2026-10-01,
// lookup.md #2): the conditions, drug classes or companies are still loading: more suggestions can
// come ("Loading…" under the list, search-box.js), so nothing found is no "No matches" yet; the
// close names guessed from the search index show meanwhile (review: they waited for the data).
function searchSuggestions(index, query, run, atcClasses, substanceCount, loading = false) {
  const text = query.trim();
  if (foldSearchText(text).length < MIN_QUERY) return { groups: [], note: null, query: text, loading: false };
  const copy = UI.lookup;
  const { groups, shownFor } = searchWithFallback(text, run);
  const found = groups.some((group) => group.options.length > 0);
  let note = shownFor ? copy.showingFor(shownFor) : null;
  const extra = [];
  if (!found) {
    if (!loading) {
      const known = knownSubstance(index, text, atcClasses);
      note = known ? copy.empty.known(atcName(known.name), known.code) : copy.noMatches;
    }
    const fuzzy = didYouMean(index, text, atcClasses);
    if (fuzzy.length) extra.push({ key: "fuzzy", label: copy.groups.fuzzy, options: fuzzy.map((entry) => fuzzyOption(entry, substanceCount)) });
  }
  extra.push({ key: "text", label: null, name: copy.groups.text, options: [{ label: copy.searchText(text), value: text }] });
  return { groups: [...groups, ...extra], note, query: shownFor ?? text, loading };
}

// Search icon (decorative) inside the search bar.
function addSearchIcon() {
  const icon = d3.select(".lookup-box").insert("svg", "input")
    .attr("class", "search-icon")
    .attr("viewBox", "0 0 20 20")
    .attr("aria-hidden", "true")
    .attr("focusable", "false");
  icon.append("circle").attr("cx", 8.5).attr("cy", 8.5).attr("r", 5.75);
  icon.append("path").attr("d", "M12.75 12.75l4.5 4.5");
}

// "Try Keytruda (brand) · semaglutide (active substance) · …": links that open those lookups, each
// followed by the kind of thing it is (kept on one line with its link).
function renderTryLinks() {
  const line = d3.select("#lookup-try");
  line.append("span").text(UI.lookup.tryLead);
  for (const [position, example] of UI.lookup.examples.entries()) {
    if (position > 0) line.append("span").attr("aria-hidden", "true").text("·");
    const item = line.append("span").attr("class", "try-item");
    item.append(() => lookup.link(example.label, example.atc ? classState(example.atc) : example.patch));
    item.append("span").attr("class", "try-kind").text(` ${UI.lookup.exampleKind(example.kind)}`);
  }
}

function startLookup([meta, searchRows, entryTermRows]) {
  if (new URLSearchParams(window.location.search).has("med")) {
    firstFile = settledOrAfter(loadFile(PRIMARY_DOCUMENTS_FILE), FIRST_FILE_WAIT_MS).then(() => {
      firstFile = null;
    });
  }
  d3.select("#data-date").text(UI.dataDate(meta.snapshot_date ?? meta.source_timestamp.slice(0, 10)));
  renderFooter(meta);
  showOfflineNote(meta);

  const index = buildLookupIndex(searchRows, entryTermRows);
  // Step 4 (#12): the days from a positive opinion to the EU decision, median and 90th percentile
  // (none in older data).
  const days = (value) => (Number.isInteger(value) && value > 0 ? value : null);
  const { median_days: medianDays, p90_days: p90Days } = meta.opinion_to_decision ?? {};
  lookup = createLookup($("#result"), {
    index,
    loadFile,
    navigate,
    // "Show all statuses" is in the URL (show=all), as filter edits replace the entry.
    onShowAll: (checked) => setState({ show: checked ? STATUS_ALL : null }),
    snapshotDate: meta.snapshot_date,
    meshVersion: meta.sources?.find((source) => /mesh/i.test(source.name))?.version ?? null,
    decision: days(medianDays) ? { median: medianDays, p90: days(p90Days) } : null,
  });
  addSearchIcon();
  renderTryLinks();
  const input = $("#lookup-input");
  const PICKS = {
    medicines: (value) => ({ med: value }),
    substances: (value) => ({ sub: value }),
    conditions: (value) => ({ cond: value }),
    classes: classState, // the dashboard filtered to the class alone
    companies: (value) => ({ co: value }), // the company page
    text: (value) => ({ q: value }), // the indication-text search
  };
  const noEquivalents = new Map();
  const searchBox = createSearchBox(input, $("#lookup-listbox"), $("#lookup-status"), {
    suggestionsFor: (query) => {
      const atc = lookup.atcClasses();
      const companies = lookup.companies();
      // Under all its spellings once the equivalents have loaded, as its card counts.
      const equivalents = lookup.equivalents() ?? noEquivalents;
      const substanceCount = (substance) => substanceAuthorizedCount(substance.key, index.substances, equivalents);
      const run = (text) => suggestionGroups(
        suggest(index, lookup.conditions(), text),
        atc ? suggestAtcClasses(text, atc.classes, atc.counts) : [],
        companies ? suggestCompanies(companies, text) : [],
        lookup.medicines(),
        substanceCount,
      );
      return searchSuggestions(index, query, run, atc?.classes ?? [], substanceCount, lookup.searchLoading());
    },
    onPick: (group, value) => navigate(PICKS[group](value)),
    onSubmit: (text) => navigate({ q: text }),
    recent,
    // Enter waits for these (bug hunt 2026-10-01), unless a navigation comes first.
    pending: () => (lookup.searchLoading() ? lookup.searchSettled() : null),
    navigations: () => navigations,
  });
  // Conditions, drug classes and companies join the suggestions once their background data has
  // loaded (and a condition or company page's title its name); so do EMA's opinions (a negative
  // one is named in a medicine's meta line).
  lookup.onData((name) => {
    if (["conditions", "atc", "atcCounts", "companies", "medicines", "equivalents"].includes(name)) searchBox.refresh();
    if (name === "conditions" || name === "companies") updateTitle();
    // A restore waiting for the card's data: once the lookup has rendered it (after the listeners).
    queueMicrotask(restoreScroll);
  });
  // The wordmark opens the overview: every lookup and filter cleared, one history entry.
  $("#home-link").addEventListener("click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    searchBox.setText("");
    navigate(structuredClone(DEFAULT_STATE));
  });
  d3.select("#explore-note").text(UI.explore.note);
  // medicines: the dashboard loads the same file (one request, loadFile()); equivalents (small):
  // the substance suggestions' counts under every spelling.
  for (const name of ["conditions", "atc", "atcCounts", "companies", "medicines", "equivalents"]) lookup.need(name);

  applyUrl();
  searchBox.setText(state.q);
  scheduleUrlWrite(state, false, pendingFilters);
  // Back or Forward: open filters close (dashboard.md #2), and the view returns to where it was left
  // (the top when unknown) once rendered, its card's disclosures open as they were. A fragment
  // navigation (Chrome fires popstate for location.hash and #links), or Back and Forward over one,
  // shows the same view: nothing to close or render, the entry's place when known (the browser
  // scrolls to a new fragment itself).
  window.addEventListener("popstate", (event) => {
    navigations += 1;
    const { place, hashOnly } = historyScroll.popped(event.state);
    if (hashOnly) {
      if (place) {
        startRestoring(place);
        restoreScroll();
      }
      return;
    }
    refocus = closeFiltersNow();
    reopenKeys = place?.open ?? [];
    startRestoring(place ?? TOP);
    applyUrl();
    searchBox.setText(state.q);
    scheduleRender();
  });
  $("#lookup").hidden = false;
  input.disabled = false;
  render();

  // The modality and ATC explanation files are optional (null when missing), the others not.
  const optional = (file) => loadFile(file).catch(() => null);
  Promise.all([...DASHBOARD_FILES.map(loadFile), ...MODALITY_FILES.map(optional), ...ATC_EXPLANATION_FILES.map(optional)])
    .then((rows) => startDashboard(meta, rows), showMissingData);
}

function startDashboard(meta, [
  medicines, areaRows, substanceRows, atcRows, atcClasses, branchRows, seriesRows, subtreeRows, companyRows, medicineCompanyRows, modalityTaxonomy, medicineModalityRows,
  atcExplanationRows,
]) {
  // The therapeutic area tree (phase 4f): MeSH category › branch › level 2 › level 3 › EMA's terms.
  const meshTree = buildAreaTree(branchRows, subtreeRows);
  // Companies part 2: company groups › companies › EMA holder names.
  const companies = buildCompanies(companyRows, medicineCompanyRows);
  // Modality (M2 phase 2): groups › modalities; null without the modality data (older data files):
  // no tree, chip, breakdown or stack then.
  const modalityTree = modalityTaxonomy?.length && medicineModalityRows ? buildModalityTree(modalityTaxonomy) : null;
  const products = buildProducts(medicines, {
    areaRows, branchRows, atcRows, companyRows: medicineCompanyRows, areaTree: meshTree, modalityRows: modalityTree ? medicineModalityRows : [], modalityTree,
  });
  const seriesDates = seriesRows.map((row) => row.date);
  const approvalYears = d3.extent(products, (product) => product.year);
  const atcNames = new Map(atcClasses.map((row) => [row.atc_code, row.name]));
  // The ATC tree rows' explainers read a code's status too (atcClassTip()).
  const atcClassRows = new Map(atcClasses.map((row) => [row.atc_code, row]));
  // Our plain-language explanations of the classes at levels 1-4 (empty without the file): they
  // lead the ATC tips (tree rows, breakdown bars, activity columns, the per-year legend, badges).
  const atcExplanations = buildAtcExplanations(atcExplanationRows);
  // An ATC class's explainer as the tree rows' ({ text, id }: one hidden description per class).
  const atcTip = (code) => describedTip(`atc-tip-${code}`, atcClassTip(code, atcClassRows, atcExplanations), "atc-tips");
  // A class's explanation alone, as a description beside a control's own (activity columns).
  const atcExplanationTip = (code) => describedTip(`atc-explanation-${code}`, atcExplanation(code, atcExplanations), "atc-tips");
  // The filter chips' modality names (null without the modality data: no modality chip).
  const modalityNames = modalityTree ? new Map(modalityTree.keys.map((key) => [key, modalityTree.name(key)])) : null;
  const atcRetiredYears = new Map(atcClasses.filter((row) => row.status === "retired").map((row) => [row.atc_code, row.changed_year ?? null]));
  const branchNamesByTerm = d3.rollup(
    branchRows.filter((row) => row.branch !== null),
    (rows) => rows.map((row) => row.branch_name),
    (row) => row.therapeutic_area_mesh,
  );
  // EMA term -> MeSH descriptor, so a common condition opens its condition lookup.
  const descriptorOf = new Map(branchRows.map((row) => [row.therapeutic_area_mesh, row.mesh_descriptor_ui]));
  // A therapeutic area term as a link to its condition page (a lookup: ?cond=), or null when its
  // descriptor is unknown.
  const conditionLink = (term) => (descriptorOf.get(term) ? lookup.link(term, { cond: descriptorOf.get(term) }) : null);
  // A therapeutic area's MeSH explainer ({ text, id }: mesh-notes.js meshTip(); owner request
  // 2026-09-28) for its tree row, breakdown bar, table link or common-condition link: a term by its
  // descriptor, a branch or node by the descriptor of its tree number; null until the notes have
  // loaded (after the first render) or without a scope note. A MeSH category has no descriptor, so
  // no scope note: its own explainer from the data (owner feedback 2026-09-29: areaCategoryTip()).
  const areaTip = (key) => (meshTree.isCategory(key)
    ? describedTip(`mesh-category-tip-${key}`, areaCategoryTip(meshTree, key))
    : meshTip(areaNote(lookup.meshNotes(), key, (term) => descriptorOf.get(term))));
  // A small icon link to a condition page (ui: its descriptor) after a row: area tree rows,
  // therapeutic area group bars. name: the condition, for its accessible name and tooltip (a tree
  // row with an explainer drops the tooltip: facet-tree.js).
  const conditionIconLink = (ui, name) => {
    const link = lookup.link(openIcon(), { cond: ui }, "cond-link", UI.conditions.open(name));
    link.title = UI.conditions.open(name);
    return link;
  };
  // A group's or company's page as a small icon link after a row (tree rows, company bars, activity
  // rows; as the condition page links). value: its key.
  const companyIconLink = (value) => {
    const name = companies.name(value);
    const link = lookup.link(openIcon(), { co: value }, "cond-link", UI.companies.open(name));
    link.title = UI.companies.open(name);
    return link;
  };
  // A medicine's Company · Holder (holders.js): its group, a link to its page, and EMA's holder name.
  const companyLink = (text, key) => lookup.link(text, { co: key }, "company-link");
  const holderOf = (product) => {
    const entry = companies.entry(product.ema_product_number);
    return entry ? holderDisplay(entry, { link: companyLink }) : product.mah;
  };
  const domain = {
    // Companies part 2: group and company keys, EMA holder names (older links).
    mahs: new Set([...products.map((product) => product.mah), ...companies.values()]),
    mahAncestors: companies.ancestors,
    mahCanonical: companies.canonical,
    // Every tree key (branch codes, tree numbers, terms), and terms without a branch.
    areas: new Set([...meshTree.names.keys(), ...areaRows.map((row) => row.therapeutic_area_mesh)]),
    areaAncestors: meshTree.ancestors,
    areaCanonical: meshTree.canonical,
    types: new Set(MEDICINE_TYPES),
    statuses: new Set(products.map((product) => product.medicine_status)),
    years: approvalYears,
    // Modality groups and modalities (none without the modality data: a link's values are ignored).
    modalities: new Set(modalityTree?.keys ?? []),
    modalityAncestors: (key) => modalityTree?.ancestors(key) ?? new Set(),
  };
  // Modality: the breakdown and stack modes (and the chip, filterChips()) show once the data is there.
  for (const selector of ['#breakdown-by [data-by="mod"]', '#chart-stack [data-stack="mod"]']) $(selector).hidden = !modalityTree;

  renderOverTimeLegend($("#over-time-legend"));
  $("#over-time-subtitle").textContent = UI.overTime.subtitle;

  // Every filter key reset to its default (a chip's remove button, Clear, Clear filters).
  const cleared = (keys) => Object.fromEntries(keys.map((key) => [key, structuredClone(DEFAULT_STATE[key])]));
  // A therapeutic area's condition page: a term's descriptor, else (branches and tree nodes) the
  // descriptor of that name, known once the lookup's conditions data has loaded; null otherwise,
  // and for a MeSH category (no descriptor: owner decision 2026-09-29).
  const areaDescriptor = (key) => (meshTree.isCategory(key) ? null
    : (meshTree.isTerm(key) ? descriptorOf.get(key) : lookup.conditions()?.uiByName.get(meshTree.name(key))) ?? null);
  // Tree rows link to their condition page; followed from a popover or sheet, it closes (the page's
  // heading takes focus, not the chip that opened it).
  const areaRowLink = (key) => {
    const ui = areaDescriptor(key);
    if (!ui) return null;
    const link = conditionIconLink(ui, meshTree.name(key));
    link.addEventListener("click", (event) => {
      if (event.defaultPrevented) closeFilters(); // a plain click: opened here
    });
    return link;
  };
  const facetPanel = createFacetPanel({ onChange: (patch) => setState(patch) });
  // A chip's controls: a popover under it (desktop) or a bottom sheet (below 1024px); each borrows
  // the chip's section from the hidden store. Clear resets the chip's filter keys.
  const popover = createPopover($("#filter-popover"), { onClear: (keys) => setState(cleared(keys)) });
  filtersOpen = () => popover.isOpen();
  // In the headline's lead (owner decision 2026-09-29, "Authorized by default"; inline after the
  // headline, F · Spacious): include the medicines of every status; the control goes, so focus goes
  // to the headline, which then counts them.
  // The tabs (F · Spacious, phase 2; the WAI-ARIA tabs pattern since 2026-09-30, owner decision):
  // a tablist of buttons, one tab stop; the arrows, Home and End move focus (tabs.js), Enter, Space
  // or a click shows the tab (manual activation: one history entry, as a lookup link, ?tab=…); only
  // the tab shown renders its cards (renderDashboard()). Focus stays on the tab; from an Overview
  // preview's "… tab" link it moves to the tab, scrolled into view (the preview link is gone with
  // the Overview).
  $("#tabs").setAttribute("aria-label", UI.tabs.label);
  const tabButtons = [...document.querySelectorAll("#tabs [role=tab]")];
  const tabPanels = [...document.querySelectorAll("#app .tab-panel")];
  const previewTabLinks = [...document.querySelectorAll("#app .preview-tab-link")];
  const plainClick = (event) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  let focusTab = false;
  let tabShown = null;
  function showTab(tab, focus = false) {
    focusTab = focus;
    if (tab === state.tab) scheduleRender();
    else setState({ tab }, true);
  }
  for (const button of tabButtons) {
    button.textContent = UI.tabs.names[button.dataset.tab];
    button.addEventListener("click", () => showTab(button.dataset.tab));
  }
  $("#tabs").addEventListener("keydown", tabsKeydown);
  for (const link of previewTabLinks) {
    link.textContent = UI.previews.tabLink(UI.tabs.names[link.dataset.tabLink]);
    link.addEventListener("click", (event) => {
      if (!plainClick(event)) return;
      event.preventDefault();
      showTab(link.dataset.tabLink, true);
    });
  }
  // The tabs and their panels follow the state: the tab shown aria-selected and the tab stop (the
  // others tabindex -1). The previews' links keep the rest of the view (filters, lookup) in their
  // hrefs, so a new browser tab opens the same view on that tab. Phones: the strip scrolls
  // sideways, the tab shown kept in it.
  function renderTabs() {
    const hrefOf = (tab) => `?${encodeUrl({ ...state, tab })}`;
    for (const button of tabButtons) {
      const current = button.dataset.tab === state.tab;
      button.setAttribute("aria-selected", String(current));
      button.tabIndex = current ? 0 : -1;
    }
    for (const link of previewTabLinks) link.href = hrefOf(link.dataset.tabLink);
    for (const panel of tabPanels) panel.hidden = panel.dataset.tabPanel !== state.tab;
    const current = tabButtons.find((button) => button.dataset.tab === state.tab);
    if (tabShown !== state.tab) {
      tabShown = state.tab;
      const nav = $("#tabs");
      const start = current.offsetLeft - nav.offsetLeft;
      if (start < nav.scrollLeft || start + current.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = Math.max(0, start - 16);
    }
    if (focusTab) {
      focusTab = false;
      $("#tabs").scrollIntoView({ block: "start" });
      current.focus({ preventScroll: true });
    } else if (tabButtons.includes(document.activeElement) && document.activeElement !== current) {
      // Back/forward changed the tab under a focused tab: keep focus on the selected one, the only tab stop.
      current.focus({ preventScroll: true });
    }
  }
  // "View options": each card's secondary controls behind one disclosure (Hick's Law).
  setupViewOptions($("#app"), UI.viewOptions);
  // (i): each card's method description behind one disclosure (F · Spacious, phase 3); under the
  // title the card leads with its takeaway (takeaways.js), empty (hidden) when it has none.
  setupCardInfo($("#app"), UI.cardInfo, UI.cardInfoLead);
  const setTakeaway = (selector, text) => {
    $(selector).textContent = text ?? "";
  };

  const includeEveryStatus = $("#status-include");
  includeEveryStatus.textContent = UI.statusScope.include;
  includeEveryStatus.setAttribute("aria-label", UI.statusScope.includeLabel);
  includeEveryStatus.addEventListener("click", () => {
    setState({ status: [] });
    $("#headline").focus();
  });
  const sheet = createSheet($("#sheet"), { onClear: (keys) => setState(cleared(keys)) });
  // A link followed from a popover or sheet (a condition or company page): it closes without handing
  // focus back to the chip (the page's heading takes it).
  const closeFilters = () => {
    popover.close({ restoreFocus: false });
    sheet.close({ restoreFocus: false });
  };
  closeFiltersNow = () => {
    const open = popover.isOpen() || sheet.isOpen();
    closeFilters();
    return open;
  };
  DESKTOP.addEventListener("change", () => {
    // A chip opens a popover from 1024px, a sheet below: the other one closes.
    if (DESKTOP.matches) sheet.close();
    else popover.close({ restoreFocus: false });
    scheduleRender();
  });
  // Approval years (histogram + two-thumb slider, the Approval year chip's section); the per-year
  // chart's brush also sets the range, and both follow state.from/to.
  const yearStrip = createYearStrip($("#facet-years"), { years: approvalYears, onRange: (range) => setState(range) });
  // The ATC selection: codes (any level) and, from older links, class-name queries, with OR.
  const atcSelection = () => splitAtcValues(state.atc);
  // Exactly one ATC code and no name query: the class the breakdown drills into, the class
  // headline names and the activity card's columns split.
  const drillCode = () => {
    const { codes, names } = atcSelection();
    return codes.length === 1 && names.length === 0 ? codes[0] : null;
  };
  // The tree, table segments and marked breakdown groups add or remove one class; drill-downs,
  // paths and "Up one level" show one class alone (none: all).
  const toggleAtc = (code) => setState({ atc: toggleAtcCode(state.atc, code) });
  const openAtc = (code) => setState({ atc: code === null ? [] : [code] });
  const atcTree = createAtcTree($("#facet-atc"), { onToggle: toggleAtc });
  // Therapeutic areas (phase 4f): the tree adds or removes one area (toggleArea()); drill-downs,
  // paths and "Up one level" show one area alone (none: all). A term that is a node is that node
  // (canonical()), wherever it is picked.
  const toggleAreaKey = (key) => setState({ area: toggleArea(meshTree, state.area, key) });
  const openArea = (key) => setState({ area: key === null ? [] : meshTree.canonical(key) });
  // Exactly one area selected: the area the breakdown drills into and the activity card splits.
  const drillArea = () => (state.area.length === 1 && meshTree.has(state.area[0]) ? state.area[0] : null);
  // The charts start at the branches (owner decision 2026-09-29): the breakdown's "Up one level" from
  // a branch goes to its category only when the branch was opened from it (UI state, areas.js
  // areaDrillVia(), followed on every render), else to all areas.
  let areaShown = null;
  let areaVia = null;
  const areaFacet = createAreaTree($("#facet-area"), { tree: meshTree, onToggle: toggleAreaKey, linkOf: areaRowLink, tipOf: areaTip });
  // Companies (companies part 2): the tree adds or removes one value (toggleCompany()); drill-downs,
  // paths and "Up one level" show one value alone (none: all), as the tree selects it (canonical()).
  const toggleCompanyValue = (value) => setState({ mah: toggleCompany(companies, state.mah, value) });
  const openCompany = (value) => setState({ mah: value === null ? [] : companies.canonical(value) });
  // Exactly one company value selected: the value the company breakdown drills into.
  const drillCompany = () => (state.mah.length === 1 && companies.has(state.mah[0]) ? state.mah[0] : null);
  // Tree rows link to their company page; followed from a popover or sheet, it closes (as area rows).
  const companyRowLink = (value) => {
    const link = companyIconLink(value);
    link.addEventListener("click", (event) => {
      if (event.defaultPrevented) closeFilters();
    });
    return link;
  };
  const companyFacet = createCompanyTree($("#facet-mah"), { companies, onToggle: toggleCompanyValue, linkOf: companyRowLink });
  // Modality (M2 phase 2): the tree adds or removes one group or modality (toggleModality());
  // drill-downs, paths and "Up one level" show one alone (none: all). None without the data.
  const toggleModalityKey = (key) => setState({ mod: toggleModality(modalityTree, state.mod, key) });
  const openModality = (key) => setState({ mod: key === null ? [] : [key] });
  // Exactly one modality value selected: the one the breakdown drills into and the per-year chart
  // splits (a group into its modalities).
  const drillModality = () => (modalityTree && state.mod.length === 1 && modalityTree.has(state.mod[0]) ? state.mod[0] : null);
  const modalityFacet = modalityTree ? createModalityTree($("#facet-modality"), { tree: modalityTree, onToggle: toggleModalityKey }) : null;
  // A chip's open button (chips are rebuilt on every render: looked up again by its key).
  const chipButton = (key) => $(`#filter-chips [data-focus-key="${key}:open"]`);
  // A chip opens its section: on desktop in a popover under it, focus on its first checked row
  // (the trees), its first checkbox or the Start thumb, a click on the same chip closing it again;
  // below 1024px in a bottom sheet, focus on the sheet's title. Focus goes back to the chip when it
  // closes (WCAG 2.4.3).
  function openChip(key) {
    const section = $(`#facet-${CHIP_SECTIONS[key]}`);
    const options = {
      title: DESKTOP.matches ? UI.filters.popoverTitle(key) : UI.filters.names[key],
      sections: [section],
      clears: CHIP_KEYS[key],
      restore: () => chipButton(key),
    };
    if (!DESKTOP.matches) {
      sheet.open(options);
      return;
    }
    if (nextOpenChip(popover.openKey(), key) === null) {
      popover.close();
      scheduleRender();
      return;
    }
    const trees = { atc: atcTree, area: areaFacet, mah: companyFacet, mod: modalityFacet };
    popover.open({
      ...options,
      key,
      wide: WIDE_CHIPS.has(key),
      anchor: () => chipButton(key),
      focus: () => (trees[key] ? trees[key].focusTarget() : $(FOCUS_TARGETS[key])),
      onClose: () => scheduleRender(), // the chip's aria-expanded
    });
    scheduleRender();
  }

  // A table's ATC segment, or a branch chip, whose control is gone after a re-render: focus goes to
  // the ATC class or Therapeutic area filter chip.
  const focusAtcFilter = () => chipButton("atc")?.focus();
  const focusAreaFilter = () => chipButton("area")?.focus();

  const readout = $("#year-readout");
  const showReadout = (from, to) => {
    readout.textContent = from === approvalYears[0] && to === approvalYears[1] ? UI.allYears : UI.yearRange(from, to);
  };

  d3.selectAll("#breakdown-by button").on("click", (event) => setState({ by: event.currentTarget.dataset.by }));
  // Sort controls ({ key, direction }: nextSort()): a click on the one in force reverses it, another
  // starts most first (count) or A-Z (key). The breakdown's bar order: most first, or by code (ATC)
  // or name (UI state, not in the URL).
  let breakdownSort = { key: "count", direction: "desc" };
  d3.select("#breakdown-sort-label").text(UI.breakdown.sort.label);
  d3.selectAll("#breakdown-sort button").on("click", (event) => {
    breakdownSort = nextSort(breakdownSort, event.currentTarget.dataset.sort);
    scheduleRender();
  });
  // The activity card's columns: ATC groups or therapeutic area groups; their order (ATC groups by
  // code and areas by count at first); the holder rows' sort: "total", "name" or a column key (UI
  // state, not in the URL).
  let activityMode = "atc";
  const activityOrder = { atc: { key: "key", direction: "asc" }, area: { key: "count", direction: "desc" } };
  const TOTAL_SORT = { key: "total", direction: "desc" };
  let activitySort = TOTAL_SORT;
  d3.selectAll("#activity-by button")
    .text(function label() {
      return UI.activity.modes[this.dataset.mode];
    })
    .on("click", (event) => {
      if (activityMode !== event.currentTarget.dataset.mode) activitySort = TOTAL_SORT; // the columns change
      activityMode = event.currentTarget.dataset.mode;
      scheduleRender();
    });
  d3.select("#activity-by-label").text(UI.activity.modesLabel);
  d3.select("#activity-title").text(UI.activity.title);
  d3.select("#activity-note").text(UI.activity.note(companies.asOf));
  d3.select("#activity-order-label").text(UI.activity.order.label);
  d3.selectAll("#activity-order button").on("click", (event) => {
    activityOrder[activityMode] = nextSort(activityOrder[activityMode], event.currentTarget.dataset.order);
    scheduleRender();
  });
  // A segmented sort button (key: its data-sort / data-order value; current: the sort in force;
  // kind: how its name says the order, UI.sortOrder, the key by default): its text, then an arrow
  // for the order in force, else for the order it starts in; pressed, its name says that order.
  function renderSortButton(button, text, key, current, kind = key) {
    const pressed = current.key === key;
    const direction = pressed ? current.direction : defaultSortDirection(key);
    const node = d3.select(button)
      .text(text)
      .attr("aria-pressed", String(pressed))
      .attr("aria-label", pressed ? UI.sortOrder.name(text, kind, direction) : null);
    appendSortIcon(node, direction === "asc");
  }
  // "Approvals per year": stacked by medicine type, ATC class, holder or status (UI state, not in the URL).
  let stackMode = "type";
  d3.select("#chart-stack-label").text(UI.years.stack.label);
  d3.selectAll("#chart-stack button")
    .text(function label() {
      return UI.years.stack.modes[this.dataset.stack];
    })
    .on("click", (event) => {
      stackMode = event.currentTarget.dataset.stack;
      scheduleRender();
    });
  // Stack by Status only with the status filter widened (owner decision 2026-09-30); under the
  // default the panel says how, and its button widens the filter, stacks by status and moves focus to
  // the Status button (its own button is then hidden).
  const statusStackButton = $('#chart-stack [data-stack="status"]');
  const offerStatusStack = (offered) => {
    statusStackButton.hidden = !offered;
    $("#chart-stack-hint").hidden = offered;
  };
  d3.select("#chart-stack-widen")
    .text(UI.years.stack.statusHint.button)
    .attr("aria-describedby", "chart-stack-hint-after")
    .on("click", () => {
      stackMode = "status";
      setState({ status: [] });
      offerStatusStack(true);
      statusStackButton.focus();
    });
  d3.select("#chart-stack-hint-after").text(UI.years.stack.statusHint.after);

  const substanceIndex = buildSubstanceIndex(substanceRows);
  const areaBranches = termBranches(branchRows);
  const table = createTable($("#medicines-table"), $("#table-more"), $("#table-caption"), {
    substanceIndex,
    atcNames,
    atcRetiredYears,
    atcExplanations,
    // Each badge segment is described by its class's explanation (levels 1-4).
    atcClassTip: atcExplanationTip,
    branchNamesByTerm,
    // Names open the medicine card (EMA's page is linked from there), terms their condition page,
    // company groups their company page.
    medicineLink: (product) => lookup.link(product.name_of_medicine, { med: product.ema_product_number }, "medicine-name"),
    conditionLink,
    termTip: areaTip,
    holderOf,
    // A segment adds its class to the ATC filter; pressed again, it removes it.
    onAtcSelect: toggleAtc,
    focusFallback: focusAtcFilter,
    // A term's branch chip adds its branch to the area filter (as the tree: toggleArea()); pressed
    // again, it removes it (owner decision 2026-09-29).
    branches: areaBranches,
    onAreaSelect: toggleAreaKey,
    focusAreaFallback: focusAreaFilter,
  });
  // The conditions card (redesign 2026-09-29): each condition opens its condition page; its branch
  // chips toggle the area filter as the table's do.
  const conditionsCard = createConditionsCard($("#conditions"), {
    link: (term, ui) => lookup.link(term, { cond: ui }),
    noteOf: (ui) => lookup.meshNotes()?.byUi.get(ui) ?? null,
    branches: areaBranches,
    onAreaChip: toggleAreaKey,
    focusAreaFallback: focusAreaFilter,
  });
  // "Download CSV" (#18): every medicine the table lists (all that match the filters, not only the
  // pages shown), in its order, named by the data's date. Two buttons (F · Spacious, phase 1): the
  // page header's, at the right of the heading, and the table card's.
  let tableRows = [];
  const dataDate = meta.snapshot_date ?? meta.source_timestamp.slice(0, 10);
  const downloadCsv = () => {
    const text = medicinesCsv(tableRows, {
      substancesOf: (product) => substanceIndex.get(product.ema_product_number) ?? [],
      groupNameOf: (product) => (product.group_key ? companies.name(product.group_key) : null),
      dataDate,
    });
    saveFile(text, csvFileName(dataDate), "text/csv;charset=utf-8");
  };
  $("#table-download").textContent = UI.csv.button;
  $("#page-download-text").textContent = UI.csv.button;
  for (const button of [$("#table-download"), $("#page-download")]) button.addEventListener("click", downloadCsv);

  // After a therapeutic area's bar: its condition page (areaDescriptor(): for a branch or tree node
  // found by name once the lookup's conditions data has loaded; the card re-renders then). None
  // after the "not more specific" row.
  function areaLink(row) {
    const ui = row.incomplete ? null : areaDescriptor(row.key);
    return ui ? conditionIconLink(ui, meshTree.name(row.key)) : null;
  }

  // Union Register rows by product; null until the file has loaded (or if it failed).
  let register = null;
  // The one ATC class the dashboard shows alone (its headline names it; so does the tab), or null.
  let classTitle = null;
  const registerDiffers = (product) => register?.get(product.ema_product_number)?.agrees_with_ema === false;
  const showCount = (selector, count, text) => d3.select(selector).text(count ? text(count) : "").attr("hidden", count ? null : "");

  // The answer headline. By default (owner decision 2026-09-29, "Authorized by default": status
  // Authorised) it counts the authorized medicines matching the other filters, and one quiet line
  // under the dek says how many of other statuses the default leaves out (statusHidden), with a
  // control to include them; with another status filter (every status included, or a choice) it
  // counts the medicines matching the filters and those currently authorized, and the dek starts
  // with the medicines by status (the authorized ones without an approval date named, as the
  // headline leaves them out). With exactly one ATC code, or one therapeutic area (phase 4g), and no
  // other filter (the status: the default, or every status) it names the class or area, with its
  // levels below. Then substances and types. areaCounts: medicines per area key matching every
  // filter but the area one.
  function renderHeadline(filtered, atcCounts, areaCounts, undatedAuthorized, statusHidden) {
    const authorized = filtered.filter(isAuthorizedNow).length;
    const byDefault = isDefaultStatus(state.status);
    const others = activeFilterCount(state, "status");
    // Every status included reads as the default does (no narrowing); a choice of statuses is one
    // more filter.
    const narrowing = others + (byDefault || state.status.length === 0 ? 0 : 1);
    const classCode = narrowing === 1 && others === 1 ? drillCode() : null;
    const areaKey = narrowing === 1 && others === 1 ? drillArea() : null;
    classTitle = classCode ? atcClassLabel(classCode, atcNames.get(classCode)) : null;
    const copy = byDefault ? UI.headline.authorized : null;
    let parts;
    if (classCode) {
      const label = atcClassLabel(classCode, atcNames.get(classCode));
      parts = copy ? copy.atcClass(filtered.length, label) : UI.headline.atcClass(filtered.length, authorized, label);
    } else if (areaKey) {
      const [name, tag] = [meshTree.name(areaKey), meshTree.isRootTag(areaKey)];
      parts = copy ? copy.area(filtered.length, name, tag) : UI.headline.area(filtered.length, authorized, name, tag);
    } else if (narrowing) parts = copy ? copy.filtered(filtered.length) : UI.headline.filtered(filtered.length, authorized);
    else parts = copy ? copy.home(filtered.length) : UI.headline.home(filtered.length, authorized);
    $("#headline").replaceChildren(...headlineNodes(parts));
    const statuses = byDefault ? null : UI.headline.statuses(statusBreakdown(filtered), undatedAuthorized);
    d3.select("#headline-dek").text([statuses, UI.headline.dek(countTiles(filtered))].filter(Boolean).join(" "));
    const scope = $("#status-scope");
    scope.hidden = !(byDefault && statusHidden > 0);
    $("#status-scope-text").textContent = scope.hidden ? "" : UI.statusScope.more(statusHidden, others > 0);
    const classPath = $("#class-path");
    classPath.hidden = classCode === null && areaKey === null;
    if (classCode) renderAtcPath(classPath, { current: classCode, counts: atcCounts, names: atcNames, onSelect: openAtc, all: false, label: UI.atc.classPath });
    else if (areaKey) renderAreaPath(classPath, { tree: meshTree, current: areaKey, counts: areaCounts, onSelect: openArea, all: false, label: UI.areas.classPath });
    else classPath.replaceChildren();
    if (!announceFilters) return;
    announceFilters = false;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      // An open sheet makes the page behind it inert, and inert live regions are not announced.
      $(sheet.isOpen() ? "#sheet-status" : "#filter-result").textContent = $("#headline").textContent;
    }, 500);
  }

  // ATC breakdown: with exactly one ATC code (drillCode()), the classes one level below it, then
  // the products coded exactly at it (a static row); a class without children shows only itself.
  // Otherwise the level-1 groups; with several codes selected, the groups holding one are marked
  // (toggles: a marked group removes its codes, another is added). counts, exact:
  // atcPrefixCounts(), atcExactCounts() of the breakdown's population; types: that population
  // split by medicine type (typeSplit()) per prefix and per exact code, for the stacked bars.
  function atcBreakdown(counts, exact, types, incompleteAt) {
    const current = drillCode();
    const { codes } = atcSelection();
    const stack = (row) => {
      const split = (row.incomplete ? types.exact : types.prefix).get(row.code);
      const segments = TYPE_ORDER.filter((type) => split?.get(type)).map((type) => ({ type, count: split.get(type) }));
      return { segments, split: UI.breakdown.typeSplit(segments.map((segment) => [segment.type, segment.count])) };
    };
    // The products coded only down to the class: "code incomplete", unless their codes are complete
    // there (atc_final_level: J07BX03 moved up to J07BN; phase 4e).
    const toRow = (row) => {
      const { segments, split } = stack(row);
      return row.incomplete
        ? { key: row.code, label: incompleteAt.has(row.code) ? UI.atc.incomplete : UI.atc.codedHere, count: row.count, static: true, incomplete: true, segments, split }
        : { key: row.code, label: atcName(row.name), count: row.count, segments, split, ariaLabel: `${UI.atc.classCount(row.code, row.name, row.count)}: ${split}` };
    };
    const children = atcChildren(current, counts, atcNames, exact);
    if (current === null) {
      const marked = codes.length > 0;
      const under = (group) => codes.filter((code) => code.startsWith(group));
      return {
        current,
        title: UI.breakdown.atc.title,
        rows: children.map(toRow),
        isSelected: marked ? (group) => under(group).length > 0 : null,
        onToggle: marked
          ? (group) => (under(group).length ? setState({ atc: state.atc.filter((value) => !under(group).includes(value)) }) : toggleAtc(group))
          : openAtc,
      };
    }
    const label = atcClassLabel(current, atcNames.get(current));
    if (children.length) return { current, title: UI.breakdown.atc.titleIn(label), rows: children.map(toRow), isSelected: null, onToggle: openAtc };
    const count = counts.get(current) ?? 0;
    const self = { code: current, name: atcNames.get(current) ?? null, count };
    return { current, title: UI.breakdown.atc.titleLeaf(label), rows: count ? [{ ...toRow(self), static: true }] : [], isSelected: null, onToggle: openAtc };
  }

  // Therapeutic area breakdown (phase 4f, as the ATC one): with exactly one area selected
  // (drillArea()), the areas one level below it, then the medicines tagged with it itself (a static
  // row; a branch's: tagged only at its root, phase 4g); an area without children shows only
  // itself. Otherwise the MeSH branches (the charts start there, owner decision 2026-09-29; one
  // category selected: its branches); with several areas selected, the branches holding one or
  // under a selected category are marked (toggles: a marked branch removes the areas that mark it,
  // another is added). population: every filter but the area one.
  function areaBreakdown(population) {
    const current = drillArea();
    const rows = areaBreakdownRows(meshTree, current, population);
    if (current === null) {
      const selected = state.area;
      const under = (branch) => selected.filter((value) => value === branch || meshTree.ancestors(value).has(branch) || meshTree.ancestors(branch).has(value));
      const marked = selected.length > 0;
      return {
        current,
        title: UI.breakdown.area.title,
        rows,
        isSelected: marked ? (branch) => under(branch).length > 0 : null,
        onToggle: marked
          ? (branch) => (under(branch).length ? setState({ area: selected.filter((value) => !under(branch).includes(value)) }) : toggleAreaKey(branch))
          : openArea,
      };
    }
    const name = meshTree.name(current);
    if (rows.length) return { current, title: UI.breakdown.area.titleIn(name), rows, isSelected: null, onToggle: openArea };
    const count = population.filter((product) => product.areaKeys.includes(current)).length;
    // A root tag (older links) reads as a tag, not as its branch (phase 4g review).
    const title = UI.breakdown.area.titleLeaf(name, meshTree.isRootTag(current));
    return { current, title, rows: count ? [{ key: current, label: meshTree.label(current), count, static: true }] : [], isSelected: null, onToggle: openArea };
  }

  // Company breakdown (companies part 2, as the area one): with exactly one company value selected
  // (drillCompany()), the level below it (a group's companies, or its holder names when its one
  // company has its name; a company's holder names); a value without one shows only itself.
  // Otherwise the company groups; with several values selected, the groups holding one are marked
  // (toggles: a marked group removes its values, another is added). Each bar names the EMA holder
  // names behind it (its tooltip and name); groups carry their badge and every bar a link to its
  // company page. population: every filter but the company one.
  function companyBreakdown(population) {
    const current = drillCompany();
    const toRow = (row) => (row.other ? row : {
      ...row,
      title: row.names.length ? UI.companies.named(row.label, row.names) : null,
      ariaLabel: UI.companies.barLabel(row.label, row.count, row.names),
    });
    const rows = companyBreakdownRows(companies, current, population).map(toRow);
    if (current === null) {
      const selected = state.mah;
      const under = (group) => selected.filter((value) => companies.groupsOf(value).has(group));
      const marked = selected.length > 0;
      return {
        current,
        title: UI.breakdown.mah.title,
        rows,
        isSelected: marked ? (group) => under(group).length > 0 : null,
        onToggle: marked
          ? (group) => (under(group).length ? setState({ mah: selected.filter((value) => !under(group).includes(value)) }) : toggleCompanyValue(group))
          : openCompany,
      };
    }
    const name = companies.name(current);
    if (rows.length) {
      return { current, title: UI.breakdown.mah.titleIn(name, companies.kind(rows[0].key) === "holder"), rows, isSelected: null, onToggle: openCompany };
    }
    const members = population.filter((product) => matchesCompany(current, product));
    const self = toRow({ key: current, label: name, count: members.length, names: namesBehind(name, members) });
    return { current, title: UI.breakdown.mah.titleLeaf(name), rows: members.length ? [{ ...self, static: true }] : [], isSelected: null, onToggle: openCompany };
  }

  // Modality breakdown (M2 phase 2, as the area one): with exactly one value selected
  // (drillModality()), a group's modalities, then its medicines no source names the modality of (a
  // static row); a modality, or Small molecule, shows only itself. Otherwise the groups, then the
  // medicines not classified (a static row); with several values selected the groups holding one
  // are marked (toggles: a marked group removes its values, another is added). Bars are stacked by
  // medicine type, as the ATC bars (the biosimilars among the antibodies). population: every filter
  // but the modality one.
  function modalityBreakdown(population) {
    const current = drillModality();
    const split = {
      keys: typeSplit(population, (product) => product.modalityKeys),
      exact: typeSplit(population, (product) => product.modalityExact),
    };
    const stacked = (row) => {
      const types = (row.incomplete ? split.exact : split.keys).get(row.key);
      const segments = TYPE_ORDER.filter((type) => types?.get(type)).map((type) => ({ type, count: types.get(type) }));
      const text = UI.breakdown.typeSplit(segments.map((segment) => [segment.type, segment.count]));
      return { ...row, segments, split: text, ariaLabel: row.static ? null : `${UI.modality.count(row.label, row.count)}: ${text}` };
    };
    const rows = modalityBreakdownRows(modalityTree, current, population).map(stacked);
    if (current === null) {
      const selected = state.mod;
      const under = (group) => selected.filter((value) => value === group || modalityTree.parent(value) === group);
      const marked = selected.length > 0;
      return {
        current,
        title: UI.breakdown.mod.title,
        rows,
        isSelected: marked ? (group) => under(group).length > 0 : null,
        onToggle: marked
          ? (group) => (under(group).length ? setState({ mod: selected.filter((value) => !under(group).includes(value)) }) : toggleModalityKey(group))
          : openModality,
      };
    }
    const name = modalityTree.name(current);
    if (rows.length) return { current, title: UI.breakdown.mod.titleIn(name), rows, isSelected: null, onToggle: openModality };
    const count = population.filter((product) => product.modalityKeys.includes(current)).length;
    const self = stacked({ key: current, label: name, count, static: true });
    return { current, title: UI.breakdown.mod.titleLeaf(name), rows: count ? [self] : [], isSelected: null, onToggle: openModality };
  }

  // Above the drilled-down ATC or area bars: "Up one level" and the path of levels (by: the mode).
  function renderBreakdownPath(by, current) {
    const container = $("#breakdown-path");
    const focused = container.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
    container.replaceChildren();
    container.hidden = current === null;
    if (current === null) return;
    d3.select(container).append("button")
      .attr("type", "button")
      .attr("class", "up-level")
      .attr("data-focus-key", "up")
      .text(UI.atc.up)
      .on("click", () => {
        if (by === "area") openArea(areaUpLevel(meshTree, current, areaVia));
        else if (by === "mah") openCompany(companies.parentOf(current));
        else if (by === "mod") openModality(modalityTree.parent(current));
        else openAtc(atcPrefixes(current).at(-2) ?? null);
      });
    const path = container.appendChild(document.createElement("div"));
    if (by === "area") renderAreaPath(path, { tree: meshTree, current, onSelect: openArea });
    else if (by === "mah") renderCompanyPath(path, { companies, current, onSelect: openCompany });
    else if (by === "mod") renderModalityPath(path, { tree: modalityTree, current, onSelect: openModality });
    else renderAtcPath(path, { current, names: atcNames, onSelect: openAtc, label: UI.atc.path });
    if (focused !== undefined) container.querySelector(`[data-focus-key="${CSS.escape(focused)}"]`)?.focus();
  }

  // Always shown (phase 4c; it used to show only with a filter): the therapeutic areas of the
  // medicines shown, as a table ranked by treatments or authorized medicines (redesign 2026-09-29,
  // conditions-card.js); a line instead when none of the medicines has one. With a therapeutic area
  // filter, only the terms within it (phase 4f). Each row counts as its condition page (review
  // 2026-09-29: the lookup's conditions dataset, asked for when the lookup starts; a line until it
  // has loaded). Treatments (step 4, #10): the authorized medicines' distinct substance sets,
  // equivalent spellings joined once they have loaded.
  const NO_EQUIVALENTS = new Map();
  // The conditions of the medicines shown with the most treatments, as the conditions card ranks
  // them (its default order): the card's takeaway and the Overview's preview; null until the
  // lookup's conditions data has loaded (FAILED when it failed).
  function conditionRanking(filtered, limit) {
    const conditions = lookup.need("conditions");
    if (conditions === undefined || conditions === FAILED) return conditions;
    const equivalents = lookup.equivalents() ?? NO_EQUIVALENTS;
    return conditionRows(filtered, {
      descriptorOf,
      descriptors: conditions.descriptors,
      within: state.area.length ? (term) => inAreas(meshTree, state.area, term) : null,
      broad: meshTree.broad,
      setKeyOf: (product) => equivalentSetKey(product.substance_set_key?.split("|"), equivalents),
      limit,
    }).rows;
  }
  function renderConditions(filtered, anyFilter) {
    const equivalents = lookup.equivalents() ?? NO_EQUIVALENTS;
    const conditions = lookup.need("conditions");
    // Every condition ranked, so ties are counted beyond the rows shown (review of phase 3).
    const ranked = conditionRanking(filtered, Infinity);
    setTakeaway("#conditions-takeaway", Array.isArray(ranked) ? conditionsTakeaway(ranked) : null);
    conditionsCard.render({
      products: filtered,
      anyFilter,
      // By default only authorized medicines are shown: their number alone, no "of" every status.
      authorizedOnly: isDefaultStatus(state.status),
      within: state.area.length ? (term) => inAreas(meshTree, state.area, term) : null,
      // Only specific conditions are ranked (owner decision 2026-09-29): MeSH level 3 and deeper.
      broad: meshTree.broad,
      descriptorOf,
      descriptors: conditions === FAILED ? FAILED : conditions?.descriptors,
      setKeyOf: (product) => equivalentSetKey(product.substance_set_key?.split("|"), equivalents),
      selectedArea: state.area,
      filterKey: JSON.stringify(FILTER_KEYS.map((key) => state[key])),
    });
  }

  // The breakdown card over every matching medicine: ATC (stacked by type), areas, holders or
  // modalities (stacked by type; the ATC classes until the modality data has loaded).
  function renderBreakdownCard(predicates, withoutAtcFilter, atcCounts, atcExact, atcIncomplete) {
    const by = state.by === "mod" && !modalityTree ? "atc" : state.by;
    d3.selectAll("#breakdown-by button").attr("aria-pressed", function pressed() {
      return String(this.dataset.by === by);
    });
    d3.selectAll("#breakdown-sort button").each(function sortButton() {
      const { sort } = this.dataset;
      // Areas and modalities by key: tree order ("MeSH, tree order"), not A to Z.
      renderSortButton(this, sort === "count" ? UI.breakdown.sort.count : UI.breakdown.sort.key[by], sort, breakdownSort, sort === "key" && (by === "area" || by === "mod") ? "tree" : sort);
    });
    const card = $("#breakdown").closest(".chart-card");
    const hadFocus = card.contains(document.activeElement);
    const atcTypes = by === "atc"
      ? {
        prefix: typeSplit(withoutAtcFilter, (product) => product.atc.flatMap((row) => atcPrefixes(atcCode(row)))),
        exact: typeSplit(withoutAtcFilter, (product) => product.atc.map(atcCode).filter(atcLevel)),
      }
      : null;
    const atc = atcTypes ? atcBreakdown(atcCounts, atcExact, atcTypes, atcIncomplete) : null;
    const population = filterProducts(products, predicates, BREAKDOWN_FILTER[by]);
    // Every mode drills down (a tree each: ATC classes, therapeutic areas, companies, modalities).
    const drill = { area: areaBreakdown, mah: companyBreakdown, mod: modalityBreakdown };
    const tree = atc ?? drill[by](population);
    // Its takeaway: the group with the most medicines among its bars (an ATC class with its code).
    // None while several values are selected (review of phase 3): the bars are then every group, the
    // selected ones marked, and the largest can be unrelated to the selection.
    setTakeaway("#breakdown-takeaway", tree.isSelected ? null : breakdownTakeaway(tree.rows, atc ? (row) => atcClassLabel(row.key, atcNames.get(row.key)) : undefined, by));
    d3.select("#breakdown-title").text(tree.title);
    d3.select("#breakdown-note").text(UI.breakdown[by].note).attr("hidden", UI.breakdown[by].note ? null : "");
    // One legend per card: the medicine types the stacked ATC or modality bars show.
    const stacked = atc ?? (by === "mod" ? tree : null);
    const legendTypes = TYPE_ORDER.filter((type) => stacked?.rows.some((row) => row.segments.some((segment) => segment.type === type)));
    renderLegend($("#breakdown-legend"), legendTypes);
    $("#breakdown-legend").hidden = legendTypes.length === 0;
    renderBreakdownPath(by, tree.current);
    const rows = sortBreakdownRows(tree.rows, breakdownSort.key, by, breakdownSort.direction);
    let options = { isSelected: tree.isSelected, onToggle: tree.onToggle, linkOf: areaLink, tipOf: (row) => (row.incomplete ? null : areaTip(row.key)) };
    // ATC classes: each bar explained as its tree row (atcClassTip(): its explanation, then its
    // level), on a tap too (short tips, as the tree's).
    if (atc) {
      options = {
        isSelected: atc.isSelected,
        onToggle: atc.onToggle,
        badgeOf: (row) => ({ text: row.key, hue: atcHue(row.key), level: atcLevel(row.key) }),
        tipOf: (row) => (row.incomplete ? null : atcTip(row.key)),
        tapTip: true,
      };
    }
    // Modalities: each bar explained on hover and focus (its explainer, the button's description),
    // and on touch screens on a tap (short tips, as the modality tree's).
    else if (by === "mod") options = { isSelected: tree.isSelected, onToggle: tree.onToggle, tipOf: (row) => (row.static ? null : modalityTip(row.key)), tapTip: true };
    // Company groups carry their monogram badge; groups and companies link to their page.
    else if (by === "mah") {
      options = {
        isSelected: tree.isSelected,
        onToggle: tree.onToggle,
        badgeOf: (row) => (!row.incomplete && companies.kind(row.key) === "group" ? { element: () => companyBadge(companies.row(row.key)) } : null),
        linkOf: (row) => (row.incomplete || companies.pageOf(row.key) === null ? null : companyIconLink(companies.pageOf(row.key))),
      };
    }
    renderBreakdown($("#breakdown"), rows, options);
    const { excluded } = UI.breakdown[by];
    // Products without any ATC code, therapeutic area or holder matter at the top level only (the
    // modalities' not classified are a static row).
    showCount("#breakdown-excluded", excluded && !tree.current ? breakdownExcluded(population, by) : 0, excluded);
    // Drilling down or going up rebuilds the controls: keep focus in the card, quietly (no tip on a
    // touch screen: it covered the next bars; keyboard focus still shows it).
    if (hadFocus && !card.contains(document.activeElement)) focusQuietly(card.querySelector("#breakdown button") ?? card.querySelector("#breakdown-path button"));
  }

  // "Who is active where": the top holders of the medicines shown by ATC group (the classes one
  // level below a drilled-into code: drillCode()) or by the top therapeutic area groups (+ Other).
  // Columns in the chosen order, rows sorted by total, name or one column; headers and cells toggle
  // the filters they set (togglePatch()).
  function renderActivityCard(filtered) {
    d3.selectAll("#activity-by button").attr("aria-pressed", function pressed() {
      return String(this.dataset.mode === activityMode);
    });
    d3.selectAll("#activity-order button").each(function orderButton() {
      const { order } = this.dataset;
      renderSortButton(this, order === "count" ? UI.activity.order.count : UI.activity.order.key[activityMode], order, activityOrder[activityMode]);
    });
    let keysOf;
    let columns;
    let parentClass = null;
    if (activityMode === "atc") {
      const parent = drillCode();
      // The class split into its children: a toggle above the table that clears it again.
      if (parent !== null) {
        const name = atcNames.get(parent);
        parentClass = {
          key: parent, badge: parent, label: atcClassLabel(parent, name), name: atcName(name), filter: { atc: [parent] }, explanation: atcExplanationTip(parent),
        };
      }
      // A product's classes at the column level (the leaf itself when parent is level 5), each
      // explained in its header's tip (levels 1-4).
      keysOf = (product) => atcClassesAt(product, parent);
      columns = [...keyCounts(filtered, keysOf).keys()].map((code) => ({
        key: code, badge: code, label: atcClassLabel(code, atcNames.get(code)), title: atcClassLabel(code, atcNames.get(code)), filter: { atc: [code] },
        explanation: atcExplanationTip(code),
      }));
    } else {
      // The MeSH branches (owner decision 2026-09-29: not the categories), or with one area selected
      // (drillArea()) the areas one level below it (a category's: its branches), a leaf itself; that
      // area is a toggle above the table (phase 4f, as the ATC classes).
      const parent = drillArea();
      if (parent !== null) {
        const name = meshTree.label(parent);
        parentClass = { key: parent, badge: null, label: name, name, lead: UI.activity.parentLeadArea, filter: { area: [parent] } };
      }
      const children = parent === null ? meshTree.branches : meshTree.children(parent);
      const level = new Set(children.length ? children : [parent]);
      const inLevel = (product) => product.areaKeys.filter((key) => level.has(key));
      const top = topKeys(keyCounts(filtered, inLevel), ACTIVITY_AREAS);
      const shown = new Set(top);
      // A branch with root tags (phase 4g): a static last column of the medicines tagged only with
      // them, as the breakdown's static row (no child column holds them). Not for a node, where it
      // would mostly repeat the total (phase 4g review).
      const tagged = parent !== null && children.length > 0 && meshTree.rootTerms(parent).length > 0;
      const atParent = (product) => tagged && product.areaExact.includes(parent);
      keysOf = (product) => [...inLevel(product).map((key) => (shown.has(key) ? key : ACTIVITY_OTHER)), ...(atParent(product) ? [ACTIVITY_EXACT] : [])];
      const other = filtered.some((product) => inLevel(product).some((key) => !shown.has(key)));
      const exactLabel = tagged ? areaExactLabel(meshTree, parent) : null;
      columns = [
        ...top.map((key) => ({ key, label: meshTree.label(key), filter: { area: meshTree.canonical(key) } })),
        ...(other ? [{ key: ACTIVITY_OTHER, label: UI.activity.other, title: UI.activity.otherTitle, filter: null, other: true }] : []),
        ...(filtered.some(atParent) ? [{ key: ACTIVITY_EXACT, label: exactLabel, title: exactLabel, filter: null, other: true }] : []),
      ];
    }
    const order = activityOrder[activityMode];
    columns = orderActivityColumns(columns, keyCounts(filtered, keysOf), order.key, activityMode, order.direction);
    // A column sort whose column is gone (other filters) falls back to the total.
    const sort = ["total", "name"].includes(activitySort.key) || columns.some((column) => column.key === activitySort.key) ? activitySort : TOTAL_SORT;
    // Rows: company groups (companies part 2), each with its badge and the EMA holder names behind it.
    const groups = holderActivity(filtered, keysOf, ACTIVITY_HOLDERS, (product) => product.group_key, companies.name).map((row) => {
      const names = namesBehind(row.label, row.members);
      return { ...row, badge: companies.row(row.key), names: names.length ? UI.companies.legalNames(names, row.label) : null };
    });
    const rows = sortActivityRows(groups, sort.key, sort.direction);
    // Its takeaway: the company with the most medicines (whatever the rows' sort) and its largest column.
    // Over every company, not only the rows shown, so ties are counted beyond them (review of phase 3).
    setTakeaway("#activity-takeaway", activityTakeaway(holderActivity(filtered, keysOf, Infinity, (product) => product.group_key, companies.name), columns));
    d3.select("#activity-subtitle").text(rows.length ? UI.activity.subtitle(rows.length) : "");
    // Touch screens show no tooltips: the ATC columns' names under the table.
    d3.select("#activity-legend").text(columns.filter((column) => column.badge).map((column) => column.label).join(" · "));
    renderActivity($("#activity-table"), {
      rows,
      columns,
      sort,
      parent: parentClass,
      labelledBy: "activity-title",
      describedBy: "activity-subtitle",
      onFilter: (patch) => setState(togglePatch(state, patch)),
      onSort: (key) => {
        activitySort = nextSort(sort, key);
        scheduleRender();
      },
      isSet: (patch) => patchIsSet(state, patch),
      // After the row's filter button: its company page (a secondary way in).
      linkOf: (row) => companyIconLink(row.key),
    });
  }

  // The per-year chart's stacks for its mode: keysOf(product), series ([{ key, label, color, tip:
  // the legend entry's explanation }] bottom to top), by (the summary's phrase) and counting (the
  // note's). dated: the medicines shown. Every mode gives the same yearly totals (user decision
  // 2026-09-28): the medicines a mode cannot place (no ATC code, coded only as the class shown, no
  // company) are one low-key hatched segment on top, when there are any (withUnplaced()).
  function yearStackSpec(dated) {
    if (stackMode === "type") {
      return {
        keysOf: (product) => [product.medicine_type],
        series: MEDICINE_TYPES.map((type) => ({ key: type, label: type, color: typeColor(type) })),
        by: UI.years.by.type,
        counting: UI.years.counting.type,
      };
    }
    // The statuses present in STATUS_ORDER, Authorized at the bottom (the approval-years strip's
    // stacks until phase 4f), each explained in the legend.
    if (stackMode === "status") {
      return {
        keysOf: (product) => [product.medicine_status],
        series: [...new Set(dated.map((product) => product.medicine_status))].sort(byStatusOrder)
          .map((status) => ({ key: status, label: statusLabel(status), color: statusColor(status), tip: UI.statusTips[status] ?? null })),
        by: UI.years.by.status,
        counting: UI.years.counting.status,
      };
    }
    // The top holders (most at the bottom), or the top classes (in code order: level-1 groups in
    // their group's hue, child classes of one ATC class in STACK_HUES); Other on top, low-key
    // (STACK_OTHER) so the named series carry the colour. counted: the top ones, and whether the
    // rest are an Other segment.
    const topSeries = (keys, colorOf, labelOf, other) => keys.map((key, index) => (key === OTHER_KEY
      ? { key, label: other, ...STACK_OTHER }
      : { key, label: labelOf(key), color: colorOf(key, index) }));
    const counted = (keys) => [keys.filter((key) => key !== OTHER_KEY).length, keys.includes(OTHER_KEY)];
    const unplacedSeries = (stack, label) => (stack.any ? [{ key: UNPLACED_KEY, label, ...STACK_UNPLACED }] : []);
    // Modality (M2 phase 2): the groups in tree order, each in a STACK_HUES mid, then the medicines
    // not classified; with exactly one group selected (drillModality()), its modalities, then its
    // medicines no source names the modality of. Those last ones are low-key (STACK_OTHER); a
    // medicine counts once in every group (or modality) it has; only the series present show, each
    // explained in the legend.
    if (stackMode === "mod" && modalityTree) {
      const parent = drillModality();
      const children = parent === null ? [] : modalityTree.children(parent);
      const [shown, restKey, restLabel, restTip] = children.length
        ? [children, parent, UI.modality.groupOnly(modalityTree.name(parent)), UI.modality.groupOnlyTip]
        : [modalityTree.roots, NOT_CLASSIFIED, UI.modality.notClassified, UI.modality.notClassifiedTip];
      const inShown = new Set(shown);
      const keysOf = (product) => [
        ...product.modalityKeys.filter((key) => inShown.has(key)),
        ...(product.modalityExact.includes(restKey) ? [restKey] : []),
      ];
      const stack = withUnplaced(dated, keysOf);
      const present = keyCounts(dated, keysOf);
      const series = [
        ...shown.map((key, index) => ({ key, label: modalityTree.name(key), color: `var(--${STACK_HUES[index % STACK_HUES.length]}-mid)`, tip: UI.modalityTips[key] ?? null })),
        { key: restKey, label: restLabel, ...STACK_OTHER, tip: restTip },
      ].filter((item) => present.has(item.key));
      return {
        keysOf: stack.keysOf,
        series: [...series, ...unplacedSeries(stack, UI.years.unplaced.mod)],
        by: children.length ? UI.years.by.modIn(modalityTree.name(parent)) : UI.years.by.mod,
        counting: UI.years.counting.mod,
      };
    }
    // Company groups (companies part 2): each in its group's colour, or, too near a colour already
    // in the chart in either mode, its text shade or the nearest other hue (companySeriesColors()),
    // with its badge and, as the legend's
    // explanation, the EMA holder names behind it.
    if (stackMode === "mah") {
      const groupOf = (product) => (product.group_key ? [product.group_key] : []);
      const top = topWithOther(dated, groupOf, STACK_TOP);
      const stack = withUnplaced(dated, top.keysOf);
      const colors = companySeriesColors(top.keys.filter((key) => key !== OTHER_KEY), readPalette());
      const series = topSeries(top.keys, (key) => colors.get(key), companies.name, UI.years.other.mah).map((item) => {
        if (item.key === OTHER_KEY) return item;
        const names = namesBehind(item.label, dated.filter((product) => product.group_key === item.key));
        return { ...item, badge: companies.row(item.key), tip: names.length ? UI.companies.named(item.label, names) : null };
      });
      return {
        keysOf: stack.keysOf,
        series: [...series, ...unplacedSeries(stack, UI.years.unplaced.mah)],
        by: UI.years.by.mah,
        counting: UI.years.counting.mah(...counted(top.keys)),
      };
    }
    const parent = drillCode();
    const classesOf = (product) => atcClassesAt(product, parent);
    const label = (code) => atcClassLabel(code, atcNames.get(code));
    // Level-1 groups: the top STACK_ATC_GROUPS (14 neighbouring hues could not be told apart).
    const top = topWithOther(dated, classesOf, parent === null ? STACK_ATC_GROUPS : STACK_TOP);
    const stack = withUnplaced(dated, top.keysOf);
    const keys = [...top.keys.filter((key) => key !== OTHER_KEY).sort(), ...top.keys.filter((key) => key === OTHER_KEY)];
    const colorOf = parent === null ? (code) => `var(--${atcHue(code)}-mid)` : (code, index) => `var(--${STACK_HUES[index]}-mid)`;
    return {
      keysOf: stack.keysOf,
      series: [
        // Each class explained in the legend (its explanation, levels 1-4), as the modalities.
        ...topSeries(keys, colorOf, label, UI.years.other.atc).map((item) => ({ ...item, tip: atcExplanation(item.key, atcExplanations) })),
        ...unplacedSeries(stack, parent === null ? UI.years.unplaced.atc : UI.years.unplaced.atcIn(parent)),
      ],
      by: parent === null ? UI.years.by.atc : UI.years.by.atcIn(label(parent)),
      counting: UI.years.counting.atc(...counted(keys)),
    };
  }

  function renderYears(withoutDateFilter) {
    stackMode = yearStackMode(stackMode, state.status);
    offerStatusStack(statusStackAvailable(state.status));
    d3.selectAll("#chart-stack button").attr("aria-pressed", function pressed() {
      return String(this.dataset.stack === stackMode);
    });
    const dated = withoutDateFilter.filter((product) => product.year !== null);
    const stack = yearStackSpec(dated);
    // Its takeaway: the last full year's approvals (the chart ignores the year filter, and so does it).
    // The year: the last full one inside the year filter (review of phase 3).
    const takeaway = takeawayYear(calendarFirstYear, state.from, state.to);
    setTakeaway("#chart-takeaway", yearsTakeaway(dated, takeaway.year, takeaway.partial));
    const rows = yearStacks(dated, stack.keysOf, approvalYears);
    renderChart($("#chart"), { rows, series: stack.series, by: stack.by }, state, (range) => {
      keepInPlace($("#chart"));
      setState(range);
    }, ({ from, to }) => showReadout(from, to));
    // Stacked by status (owner call 2026-09-30): the legend is headed "Status today", the note says
    // the colors are each medicine's status today.
    const byStatus = stackMode === "status";
    renderStackLegend($("#legend"), stack.series, byStatus ? UI.years.legendHeading : null);
    d3.select("#chart-note").text(byStatus ? UI.years.noteStatus : UI.years.note(stack.counting));
    // By status, the note names the statuses the chart cannot show.
    const undated = withoutDateFilter.length - dated.length;
    // By default (authorized) the undated ones are authorized ones: the plain note.
    d3.select("#undated-note").text(stackMode === "status" && !isDefaultStatus(state.status)
      ? (undated ? UI.years.undatedStatuses(undated, state.from !== null || state.to !== null) : "")
      : UI.years.undated(undated));
  }

  // The charts that follow their width (the year bars: their popover's or sheet's, once shown there),
  // and the width each was last drawn at.
  const CHART_SELECTORS = ["#chart", "#over-time", "#year-hist"];
  const chartWidths = new Map();
  const chartWidth = (element) => Math.round(element.getBoundingClientRect().width);

  // Draft (loss-of-exclusivity calendar): the currently authorized medicines matching the filters
  // whose estimated market protection runs, by the year it ends at the earliest (this year, the next
  // four, later); a year's medicines listed below, or (calendarYear ORPHAN_ONLY) those whose orphan
  // market exclusivity alone runs on (UI state, not in the URL). The protection files
  // load lazily (the card near the viewport, or the page idle): "Loading estimates…" until then.
  let calendarYear = null;
  let calendarShowAll = false;
  const calendarFirstYear = Number(dataDate.slice(0, 4));
  function renderCalendarCard(authorizedNow, anyFilter) {
    d3.select("#pc-title").text(UI.protectionCalendar.title);
    d3.select("#pc-note").text(UI.protectionCalendar.note);
    // Shown, it asks for its files (a direct link to the tab need not wait for the page to be idle).
    const protection = lookup.need("protection");
    if (protection === undefined || protection === FAILED) {
      setTakeaway("#pc-takeaway", null);
      renderProtectionCalendar($("#pc-body"), { status: protection === FAILED ? "failed" : "loading" });
      return;
    }
    const { rows, orphanOnly, unclear, unclearLatest } = protectionEnding(authorizedNow, protection, dataDate);
    // Its takeaway: how many may lose market protection (est.) within two years.
    setTakeaway("#pc-takeaway", protectionTakeaway(rows, calendarFirstYear));
    renderProtectionCalendar($("#pc-body"), {
      status: "ready",
      buckets: calendarBuckets(rows, calendarFirstYear, 5),
      unclear,
      unclearLatest,
      orphanOnly,
      running: rows.length,
      authorized: authorizedNow.length,
      filtered: anyFilter,
      selected: calendarYear,
      showAll: calendarShowAll,
    }, {
      onSelect: (key) => {
        calendarYear = calendarYear === key ? null : key;
        calendarShowAll = false;
        scheduleRender();
      },
      onShowAll: () => {
        calendarShowAll = true;
        scheduleRender();
      },
      medicineLink: (product) => lookup.link(product.name_of_medicine, { med: product.ema_product_number }),
      companyOf: (product) => {
        const group = companies.entry(product.ema_product_number)?.group;
        return group ? [companyBadge(group), " ", companyLink(group.name, group.key)] : null;
      },
      substancesOf: (product) => (substanceIndex.get(product.ema_product_number) ?? []).join("; "),
    });
  }

  // The Overview's previews of other tabs (F · Spacious, phase 2): the company groups with the most
  // medicines shown (each a link to its company page), the conditions with the most treatments (as
  // the conditions card ranks them, each a link to its condition page) and the medicines currently
  // authorized by the year their estimated market protection ends at the earliest (as the
  // protection card counts them; its files load once the page is idle: "Loading estimates…").
  function renderPreviews(filtered, authorizedNow, narrowed) {
    d3.select("#preview-companies-title").text(UI.previews.companies.title);
    d3.select("#preview-conditions-title").text(UI.previews.conditions.title);
    d3.select("#preview-protection-title").text(UI.previews.protection.title);
    const body = (id) => $(`#${id} .preview-body`);
    safely($("#preview-companies"), () => renderPreview(body("preview-companies"), {
      rows: topGroups(filtered).map(({ key, count }) => ({
        key, lead: companyBadge(companies.row(key)), label: companyLink(companies.name(key), key), count, unit: UI.previews.companies.unit(count),
      })),
      line: filtered.some((product) => product.group_key) ? null : UI.breakdown.empty,
    }));
    safely($("#preview-conditions"), () => {
      const rows = conditionRanking(filtered, PREVIEW_ROWS);
      if (!Array.isArray(rows)) {
        renderPreview(body("preview-conditions"), { line: rows === FAILED ? UI.lookup.notAvailable : UI.lookup.loading });
        return;
      }
      const ranked = rows.filter((row) => row.treatments > 0);
      renderPreview(body("preview-conditions"), {
        rows: ranked.map((row) => ({
          key: row.key,
          lead: null,
          label: row.descriptorUi ? lookup.link(row.name, { cond: row.descriptorUi }) : row.name,
          count: row.treatments,
          unit: UI.previews.conditions.unit(row.treatments),
        })),
        line: ranked.length ? null : UI.previews.conditions.none,
      });
    });
    safely($("#preview-protection"), () => {
      const protection = lookup.protection();
      if (protection === undefined || protection === FAILED) {
        renderPreview(body("preview-protection"), { line: protection === FAILED ? UI.lookup.notAvailable : UI.protectionCalendar.loading });
        return;
      }
      const { rows } = protectionEnding(authorizedNow, protection, dataDate);
      const buckets = calendarBuckets(rows, calendarFirstYear, 5);
      // To the scale of the busiest single year, as the protection card (the later bar spans
      // several years: drawn broken when longer).
      renderPreview(body("preview-protection"), {
        scale: Math.max(0, ...buckets.filter((bucket) => bucket.key !== LATER).map((bucket) => bucket.count)) || undefined,
        rows: buckets.map((bucket) => ({
          key: bucket.key, lead: null, label: UI.protectionCalendar.yearLabel(bucket), count: bucket.count, unit: UI.previews.protection.unit(bucket.count),
        })),
        line: rows.length ? null : UI.protectionCalendar.none(narrowed),
        caption: UI.previews.protection.caption,
      });
    });
  }

  // One part's failure (data it cannot handle) must not blank the parts after it: the error is
  // logged and the part says its content is not available until a render succeeds.
  function safely(container, draw) {
    const note = container.querySelector(":scope > .card-error");
    try {
      draw();
      note?.remove();
    } catch (error) {
      console.error(error);
      if (!note) d3.select(container).append("p").attr("class", "muted card-error").text(UI.lookup.notAvailable);
    }
  }
  const cardOf = (selector) => $(selector).closest(".chart-card");

  function renderDashboard() {
    renderTabs();
    showReadout(state.from ?? approvalYears[0], state.to ?? approvalYears[1]);
    const areaNow = drillArea();
    areaVia = areaDrillVia(meshTree, areaVia, areaShown, areaNow);
    areaShown = areaNow;

    const predicates = makePredicates(state, atcClasses);
    // The filters set (url.js activeFilterCount()): the default status (authorized; owner decision
    // 2026-09-29) is none, every status or a choice of statuses is one; the chip bar counts the same.
    const activeCount = activeFilterCount(state);
    // Whether the medicines shown are fewer than the default overview's or every medicine's: the
    // cards that say "all … medicines" (conditions, protection calendar) say "matching the filters".
    const narrowed = activeFilterCount(state, "status") > 0 || (!isDefaultStatus(state.status) && state.status.length > 0);
    // The names the filter chips give the selections (facets.js filterChips()).
    const selectionNames = {
      years: approvalYears, areaNames: meshTree.labels, atcNames, mahName: companies.label, mahSelection: companies.selectionName, modalityNames,
    };
    safely($("#facet-type"), () => facetPanel.render({
      state,
      counts: Object.fromEntries(FACETS.map((dimension) => [dimension, facetCounts(products, predicates, dimension, FACET_VALUES[dimension])])),
    }));
    // The per-year chart, the year filter's bars and the over-time line ignore the approval-year
    // filter and mark the range instead.
    const withoutDateFilter = filterProducts(products, predicates, "date");
    safely($("#facet-years"), () => yearStrip.render({ rows: yearHistogram(products, predicates, approvalYears), from: state.from, to: state.to }));
    // The filter chips, then "[n] active filters · Clear filters" (F · Spacious, phase 1).
    safely($(".filter-bar"), () => {
      const chips = filterChips(state, selectionNames);
      renderFilterChips($("#filter-chips"), chips, {
        openKey: popover.openKey(),
        onOpen: openChip,
        onRemove: (chip) => setState(cleared(chip.clears)),
      });
      renderFilterSummary($("#filter-summary"), activeCount, {
        onClear: () => {
          setState(cleared(FILTER_KEYS));
          $("#filter-chips button")?.focus(); // the button goes with the last filter
        },
      });
      popover.place();
    });
    // ATC counts per prefix (and per exact code, for the products coded only down to an
    // incomplete level) of the medicines matching every other filter: tree, breakdown, class path.
    const withoutAtcFilter = filterProducts(products, predicates, "atc");
    const atcCounts = atcPrefixCounts(withoutAtcFilter);
    const atcExact = atcExactCounts(withoutAtcFilter);
    const atcIncomplete = atcIncompleteAt(withoutAtcFilter);
    const { codes: atcCodes, names: atcQueries } = atcSelection();
    safely($("#facet-atc"), () => atcTree.render({ selected: atcCodes, names: atcQueries, counts: atcCounts, exact: atcExact, incompleteAt: atcIncomplete, classNames: atcNames, classes: atcClassRows, explanations: atcExplanations }));
    // Therapeutic areas: medicines per tree key, and in each key's static row (tagged at a node itself,
    // only at a branch's root), matching every other filter.
    const withoutAreaFilter = filterProducts(products, predicates, "area");
    const areaCounts = keyCounts(withoutAreaFilter, (product) => product.areaKeys);
    safely($("#facet-area"), () => areaFacet.render({
      selected: state.area,
      counts: areaCounts,
      exact: keyCounts(withoutAreaFilter, (product) => product.areaExact),
    }));
    // Companies: medicines per tree row (group, company, EMA holder name) matching every other filter.
    safely($("#facet-mah"), () => companyFacet.render({
      selected: state.mah,
      counts: keyCounts(filterProducts(products, predicates, "mah"), companies.countKeys),
    }));
    // Modality: medicines per group and modality, and in each static row (a group's medicines no
    // source names the modality of; those not classified), matching every other filter.
    if (modalityFacet) {
      const withoutModalityFilter = filterProducts(products, predicates, "mod");
      safely($("#facet-modality"), () => modalityFacet.render({
        selected: state.mod,
        counts: keyCounts(withoutModalityFilter, (product) => product.modalityKeys),
        exact: keyCounts(withoutModalityFilter, (product) => product.modalityExact),
      }));
    }

    const filtered = predicates.date ? withoutDateFilter.filter(predicates.date) : withoutDateFilter;
    const authorizedNow = filtered.filter(isAuthorizedNow);
    sheet.update(filtered.length);
    const undatedAuthorized = filtered.filter((product) => product.medicine_status === "Authorised" && product.authorized_from === null);
    // By default, the medicines of other statuses matching the other filters, which the headline's
    // quiet line offers to include.
    const statusHidden = isDefaultStatus(state.status) ? filterProducts(products, predicates, "status").length - filtered.length : 0;
    safely($(".answer"), () => renderHeadline(filtered, atcCounts, areaCounts, undatedAuthorized.length, statusHidden));
    // Download CSV (the page header's, on every tab): every medicine the table lists.
    tableRows = newestFirst(filtered);
    // Doherty Threshold (F · Spacious, phase 2): only the tab shown renders its cards; a tab's cards
    // render when it is shown (a render follows every tab change).
    const tab = state.tab;
    if (tab === "overview") {
      // The top row: "Authorized over time" beside the four type tiles (owner decision 2026-09-29).
      // It is authorization history: neither the status filter nor the year filter applies (the
      // chart marks the range instead; OVER_TIME_EXCEPT).
      safely(cardOf("#over-time"), () => {
        const history = filterProducts(products, predicates, OVER_TIME_EXCEPT);
        const series = authorizedSeries(history, seriesDates);
        renderOverTime($("#over-time"), series, state);
        setTakeaway("#over-time-takeaway", overTimeTakeaway(series, {
          status: !isDefaultStatus(state.status), years: state.from !== null || state.to !== null,
        }));
        const excluded = history.filter((product) => product.series_exclusion === "ended_without_end_date");
        d3.select("#over-time-note").text(UI.overTime.excluded(excluded.length));
      });
      // What the tiles' shares are of: the authorized medicines (the default), all of them (every
      // status) or those matching the filters.
      const tileScope = narrowed ? "filtered" : isDefaultStatus(state.status) ? "authorized" : "all";
      safely($("#tiles"), () => renderTiles($("#tiles"), countTiles(filtered), UI.tileShare(tileScope)));
      showCount("#register-note", authorizedNow.filter(registerDiffers).length, UI.register.notAuthorized);
      showCount("#undated-authorized", undatedAuthorized.length, UI.undatedAuthorized);
      renderPreviews(filtered, authorizedNow, narrowed);
    } else if (tab === "protection") {
      safely(cardOf("#pc-body"), () => renderCalendarCard(authorizedNow, narrowed));
    } else if (tab === "classes") {
      safely(cardOf("#breakdown"), () => renderBreakdownCard(predicates, withoutAtcFilter, atcCounts, atcExact, atcIncomplete));
      safely($("#conditions"), () => renderConditions(filtered, narrowed));
    } else if (tab === "companies") {
      safely(cardOf("#activity-table"), () => renderActivityCard(filtered));
    } else if (tab === "years") {
      safely(cardOf("#chart"), () => renderYears(withoutDateFilter));
    } else {
      const undated = filtered.filter((product) => product.year === null).length;
      safely(cardOf("#medicines-table"), () => table(tableRows, UI.table.caption(filtered.length, undated), register, atcSelection().codes, lookup.documents(), lookup.meshNotes(), state.area));
    }
    // The widths the charts were drawn at (the ResizeObserver below re-renders only on a change).
    for (const selector of CHART_SELECTORS) {
      const element = $(selector);
      const width = chartWidth(element);
      if (width > 0) chartWidths.set(element, width);
    }
  }

  // toggleArea(key): the area filter with key toggled (a card's branch chip; as the tree's). The
  // page's title names the drug class shown alone (title(): also a recent entry's name) and the tab
  // (tabName(): not the Overview).
  const tabName = () => (state.tab === DEFAULT_STATE.tab ? null : UI.tabs.names[state.tab]);
  dashboard = { domain, render: renderDashboard, title: () => classTitle, tabName, toggleArea: (key) => toggleArea(meshTree, state.area, key) };
  applyUrl();
  scheduleUrlWrite(state); // canonical form, invalid values removed
  d3.select("#app-loading").attr("hidden", "");
  d3.select("#app").attr("hidden", null);
  // The charts follow their width (the year bars: their popover's or sheet's, once shown there).
  // Only a width that changed since it was drawn re-renders (review of F phase 2: showing a tab
  // unhid its charts, width 0 to their width, and rendered twice): a hidden chart (width 0) is
  // skipped, and every render notes the widths it drew at (renderDashboard()).
  const resizeObserver = new ResizeObserver((entries) => {
    if (entries.some((entry) => {
      const width = chartWidth(entry.target);
      return width > 0 && width !== chartWidths.get(entry.target);
    })) scheduleRender();
  });
  for (const selector of CHART_SELECTORS) resizeObserver.observe($(selector));
  render();
  loadFile(REGISTER_FILE).then((rows) => {
    register = new Map(rows.map((row) => [row.ema_product_number, row]));
    scheduleRender();
  }, () => {});
  // The table's PI and EPAR links: the primary documents (small, shared with the cards; the
  // documents index where that file is missing) in the background; the therapeutic area groups'
  // condition page links: the conditions data; the therapeutic areas' MeSH explainers and the
  // tree's order of EMA's terms (their tree numbers): the MeSH notes.
  lookup.onData((name) => {
    if (name === "meshNotes") meshTree.setNotes(lookup.meshNotes()?.rows ?? null);
    if (name === "primaryDocuments" || name === "documents" || name === "conditions" || name === "meshNotes" || name === "equivalents" || name === "protection") scheduleRender();
  });
  lookup.need("primaryDocuments");
  lookup.need("meshNotes");
  // The most common conditions' substance counts (step 4, #10): the substance equivalents (small).
  lookup.need("equivalents");
  // Conference Wi-Fi (#13): the medicine card's protection and orphan exclusivity files (about
  // 61 KB gzipped) once the page is idle, so a card opened later, offline or on a slow network,
  // has them (the service worker keeps what was loaded).
  whenIdle(() => lookup.need("protection"));
  // The pivotal results (optional; the card's teaser and section) likewise, for offline cards.
  whenIdle(() => lookup.need("efficacy"));
  // The full documents index (~5 MB, 300 KB gzipped): the cards' documents lists, and the table's
  // links where the primary documents are missing (older data); a card asks for it at once where
  // it needs it (lookup.js medicineCard()).
  whenIdle(() => lookup.need("documents"));
  // Draft (loss-of-exclusivity calendar): or as soon as its card comes near the viewport.
  new IntersectionObserver((entries, observer) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    lookup.need("protection");
  }, { rootMargin: "400px 0px" }).observe(cardOf("#pc-body"));
}

// Below 1024px the top bar is sticky with its first row (wordmark, "What is this?", theme) scrolling
// away, so the search stays at the top (style.css): --topbar-hide is how far it scrolls before it
// sticks (the search row's top less its 8px padding), --topbar-shown what stays, for the page's
// scroll padding (WCAG 2.4.11). Both follow the bar's height (the offline note, user text spacing,
// the search showing once its data has loaded) and every render (render()).
function placeTopbar() {
  const header = $("header");
  const searchRow = $("#lookup");
  const hide = DESKTOP.matches || searchRow.hidden ? 0 : Math.max(0, searchRow.offsetTop - 8);
  const root = document.documentElement.style;
  root.setProperty("--topbar-hide", `${hide}px`);
  root.setProperty("--topbar-shown", `${header.offsetHeight - hide}px`);
}
new ResizeObserver(placeTopbar).observe($("header"));

renderAbout();
renderTypeTips();
setupTips();
Promise.all(FIRST_FILES.map(loadFile)).then(startLookup, showMissingData);
