import * as d3 from "d3";
import {
  MEDICINE_TYPES,
  authorizedSeries,
  breakdownCounts,
  breakdownExcluded,
  buildProducts,
  buildSubstanceIndex,
  countApprovalsByYear,
  countTiles,
  isAuthorizedNow,
  newestFirst,
} from "./approvals.js";
import { renderActivity } from "./activity.js";
import { atcChildren, atcExactCounts, atcLevel, atcPrefixCounts, atcPrefixes, toggleAtcCode } from "./atc.js";
import { renderAtcPath } from "./atc-picker.js";
import { createAtcTree } from "./atc-tree.js";
import { atcHue, typeTipId } from "./badges.js";
import { renderBreakdown } from "./breakdown.js";
import { renderChart, renderLegend } from "./chart.js";
import { createFacetPanel } from "./facet-panel.js";
import {
  FACET_VALUES,
  TYPE_ORDER,
  facetCounts,
  holderActivity,
  keyCounts,
  sentenceParts,
  statusBreakdown,
  topAreas,
  topKeys,
  typeSplit,
  yearHistogram,
} from "./facets.js";
import { renderSentence } from "./filter-sentence.js";
import { filterProducts, makePredicates, splitAtcValues } from "./filters.js";
import { UI, atcClassLabel, atcName } from "./labels.js";
import { createLookup, headlineNodes } from "./lookup.js";
import { renderOverTime, renderOverTimeLegend } from "./over-time.js";
import { createSearchBox } from "./search-box.js";
import { buildLookupIndex, suggest, suggestAtcClasses } from "./search.js";
import { createSheet } from "./sheet.js";
import { createTable } from "./table.js";
import { renderTiles } from "./tiles.js";
import {
  DEFAULT_LOOKUP,
  DEFAULT_STATE,
  classState,
  decodeLookup,
  decodeState,
  lookupView,
  patchFilterParams,
  scheduleUrlWrite,
  withoutLookup,
} from "./url.js";
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
];
// Loaded after the dashboard's first render; shared with the medicine card (same loadFile promise),
// as is the documents index (lookup.need("documents")).
const REGISTER_FILE = "ema_medicine_register_status.json";
// The filter each breakdown ignores and toggles.
const BREAKDOWN_FILTER = { atc: "atc", area: "branch", mah: "mah" };
// The facet sidebar from this width; below it, the sentence's tokens open bottom sheets.
const DESKTOP = window.matchMedia("(min-width: 1024px)");
// Facet sections (index.html #facet-{key}) each sheet shows, the sheet each sentence token
// opens, and the filter keys each section sets. The year tokens have no sheet: they focus the
// approval-years strip's thumbs (YEAR_THUMBS), which is in the main column at every width.
const SHEET_SECTIONS = {
  type: ["type"],
  atc: ["atc"],
  mah: ["mah"],
  areas: ["branch", "area"],
  status: ["status"],
  all: ["type", "atc", "branch", "area", "mah", "status"],
};
const TOKEN_SHEETS = { type: "type", atc: "atc", mah: "mah", branch: "areas", area: "areas", areas: "areas", status: "status" };
const SECTION_KEYS = { type: ["type"], atc: ["atc"], mah: ["mah"], branch: ["branch"], area: ["area"], status: ["status"] };
const YEAR_THUMBS = { from: "start", to: "end", year: "start" };
// Desktop: the control each token focuses, the first one of its own section (ATC: the tree's
// first checked class, else its search: atc-tree.js focusTarget()).
const TOKEN_TARGETS = {
  type: "#facet-type input",
  mah: "#facet-mah .facet-search",
  areas: "#facet-branch input",
  branch: "#facet-branch input",
  area: "#facet-area .facet-search",
  status: "#facet-status input",
};
const FACETS = ["type", "status", "branch", "area", "mah"];
// "Who is active where": holders (rows), therapeutic area group columns, and the column key of the
// area groups beyond them.
const ACTIVITY_HOLDERS = 15;
const ACTIVITY_AREAS = 12;
const ACTIVITY_OTHER = "__other__";

const $ = (selector) => document.querySelector(selector);

const files = new Map();
function loadFile(file) {
  if (!files.has(file)) {
    files.set(file, d3.json(`/data/${file}`).catch((error) => {
      files.delete(file); // a failed load (flaky network) is retried by the next caller
      throw error;
    }));
  }
  return files.get(file);
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
let frame = 0;
const urlNote = $("#url-note");
// Filter edits (not the first render, the breakdown's mode or lookups) announce the new headline, debounced.
const FILTER_KEYS = Object.keys(DEFAULT_STATE).filter((key) => key !== "by");
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

function render() {
  lookup.render(state);
  const lookupOpen = lookupView(state).kind !== null;
  $("#lookup-try").hidden = lookupOpen; // home state only
  $(".answer").hidden = lookupOpen; // the lookup result is the answer; one headline per screen
  dashboard?.render();
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
}

function renderFooter(meta) {
  const versionOf = (pattern) => meta.sources?.find((source) => pattern.test(source.name))?.version ?? null;
  d3.select("#attribution").text(meta.attribution);
  d3.select("#credit-mesh").text(UI.footer.mesh(versionOf(/mesh/i)));
  d3.select("#credit-chembl").text(UI.footer.chembl(versionOf(/chembl/i)));
  d3.select("#credit-atc").text(UI.footer.atc);
  d3.select("#credit-union-register").text(UI.footer.unionRegister);
}

// The type explanations as hidden elements, which describe the focusable carriers (facet rows, the
// sentence's type token) through aria-describedby (a hidden element still gives its text).
function renderTypeTips() {
  const container = d3.select("body").append("div").attr("hidden", "");
  for (const [label, tip] of Object.entries(UI.typeTips)) container.append("p").attr("id", typeTipId(label)).text(tip);
}

// The type tooltips (data-tip, style.css) are dismissible (WCAG 1.4.13): Escape hides them (and
// does nothing else, so the sidebar's Escape waits for the next press) until the pointer reaches
// another carrier or focus moves; a pointer click on a tip only hides it, as it lies over other
// controls. A carrier whose tip is anchored to its row (static: lookup rows, the sentence) puts
// the tip under its own line (--tip-top, CSSOM).
function setupTips() {
  const root = document.documentElement;
  let hiddenOn = null; // the carrier under the pointer when the tips were hidden
  const carrierOf = (target) => (target instanceof Element ? target.closest("[data-tip]") : null);
  const showing = () => [...document.querySelectorAll("[data-tip]:hover, [data-tip]:focus-within")]
    .some((carrier) => getComputedStyle(carrier, "::after").content !== "none");
  function hide() {
    hiddenOn = document.querySelector("[data-tip]:hover");
    root.classList.add("tips-hidden");
  }
  function show(carrier) {
    hiddenOn = null;
    root.classList.remove("tips-hidden");
    if (carrier && getComputedStyle(carrier).position === "static") carrier.style.setProperty("--tip-top", `${carrier.offsetTop + carrier.offsetHeight}px`);
  }
  document.addEventListener("pointerover", (event) => {
    const carrier = carrierOf(event.target);
    if (carrier && carrier !== hiddenOn) show(carrier);
  });
  document.addEventListener("focusin", (event) => show(carrierOf(event.target)));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || root.classList.contains("tips-hidden") || !showing()) return;
    event.preventDefault();
    hide();
  }, true);
  // Keyboard and scripted clicks (detail 0) have no position.
  document.addEventListener("click", (event) => {
    const carrier = carrierOf(event.target);
    if (!carrier || event.detail === 0) return;
    const box = carrier.getBoundingClientRect();
    if (event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom) return;
    event.preventDefault();
    hide();
  }, true);
}

// Filled before any data loads, so it shows even when the data files are missing.
function renderAbout() {
  d3.select("#about-summary").text(UI.about.summary);
  d3.select("#about-use").text(UI.about.intendedUse);
  d3.select("#about-privacy").text(UI.about.privacy);
  d3.select("#about-security").text(UI.about.security);
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

// result: suggest() output; classes: suggestAtcClasses() output.
function suggestionGroups(result, classes) {
  const copy = UI.lookup;
  return [
    {
      key: "medicines",
      label: copy.groups.medicines,
      options: result.medicines.map((row) => ({
        label: row.name_of_medicine,
        meta: copy.medicineMeta(row.medicine_status, row.marketing_authorisation_date?.slice(0, 4)),
        value: row.ema_product_number,
      })),
    },
    {
      key: "substances",
      label: copy.groups.substances,
      options: result.substances.map((substance) => ({ label: substance.name, meta: copy.substanceMeta(substance.products.length), value: substance.key })),
    },
    {
      key: "conditions",
      label: copy.groups.conditions,
      options: result.conditions.map((condition) => ({ label: condition.name, meta: copy.conditionMeta(condition.synonym, condition.authorized), value: condition.ui })),
    },
    {
      key: "classes",
      label: copy.groups.classes,
      options: classes.map((row) => ({ label: atcClassLabel(row.code, row.name), meta: copy.classMeta(row.count, row.name === null), value: row.code })),
    },
  ];
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

// "Try Keytruda · semaglutide · psoriasis": links that open those lookups.
function renderTryLinks() {
  const line = d3.select("#lookup-try");
  line.append("span").text(UI.lookup.tryLead);
  for (const [position, example] of UI.lookup.examples.entries()) {
    if (position > 0) line.append("span").attr("aria-hidden", "true").text("·");
    line.append(() => lookup.link(example.label, example.atc ? classState(example.atc) : example.patch));
  }
}

function startLookup([meta, searchRows, entryTermRows]) {
  d3.select("#data-date").text(UI.dataDate(meta.snapshot_date ?? meta.source_timestamp.slice(0, 10)));
  renderFooter(meta);
  showOfflineNote(meta);

  const index = buildLookupIndex(searchRows, entryTermRows);
  lookup = createLookup($("#result"), { index, loadFile, navigate, snapshotDate: meta.snapshot_date });
  addSearchIcon();
  renderTryLinks();
  const input = $("#lookup-input");
  const PICKS = {
    medicines: (value) => ({ med: value }),
    substances: (value) => ({ sub: value }),
    conditions: (value) => ({ cond: value }),
    classes: classState, // the dashboard filtered to the class alone
  };
  const searchBox = createSearchBox(input, $("#lookup-listbox"), $("#lookup-status"), {
    suggestionsFor: (query) => {
      const atc = lookup.atcClasses();
      return suggestionGroups(suggest(index, lookup.conditions(), query), atc ? suggestAtcClasses(query, atc.classes, atc.counts) : []);
    },
    onPick: (group, value) => navigate(PICKS[group](value)),
    onSubmit: (text) => navigate({ q: text }),
  });
  // Conditions and drug classes join the suggestions once their background data has loaded.
  lookup.onData((name) => {
    if (["conditions", "atc", "atcCounts"].includes(name)) searchBox.refresh();
  });
  for (const name of ["conditions", "atc", "atcCounts"]) lookup.need(name);

  applyUrl();
  searchBox.setText(state.q);
  scheduleUrlWrite(state, false, pendingFilters);
  window.addEventListener("popstate", () => {
    applyUrl();
    searchBox.setText(state.q);
    scheduleRender();
  });
  $("#lookup").hidden = false;
  input.disabled = false;
  render();

  Promise.all(DASHBOARD_FILES.map(loadFile)).then((rows) => startDashboard(meta, rows), showMissingData);
}

function startDashboard(meta, [medicines, areaRows, substanceRows, atcRows, atcClasses, branchRows, seriesRows]) {
  const products = buildProducts(medicines, { areaRows, branchRows, atcRows });
  const seriesDates = seriesRows.map((row) => row.date);
  const approvalYears = d3.extent(products, (product) => product.year);
  const atcNames = new Map(atcClasses.map((row) => [row.atc_code, row.name]));
  const branchNames = new Map(branchRows.filter((row) => row.branch !== null).map((row) => [row.branch, row.branch_name]));
  const branchNamesByTerm = d3.rollup(
    branchRows.filter((row) => row.branch !== null),
    (rows) => rows.map((row) => row.branch_name),
    (row) => row.therapeutic_area_mesh,
  );
  // EMA term -> MeSH descriptor, so a common condition opens its condition lookup.
  const descriptorOf = new Map(branchRows.map((row) => [row.therapeutic_area_mesh, row.mesh_descriptor_ui]));
  const domain = {
    mahs: new Set(products.map((product) => product.mah)),
    branches: new Set(branchNames.keys()),
    areas: new Set(areaRows.map((row) => row.therapeutic_area_mesh)),
    types: new Set(MEDICINE_TYPES),
    statuses: new Set(products.map((product) => product.medicine_status)),
    years: approvalYears,
  };
  const branchName = (branch) => branchNames.get(branch) ?? branch;
  const breakdownLabel = {
    area: branchName,
    mah: (mah) => mah,
  };

  renderLegend($("#legend"));
  renderOverTimeLegend($("#over-time-legend"));

  // Every filter key reset to its default (the sentence's remove buttons, Clear, Reset).
  const cleared = (keys) => Object.fromEntries(keys.map((key) => [key, structuredClone(DEFAULT_STATE[key])]));
  const facetPanel = createFacetPanel($("#facets"), { onChange: (patch) => setState(patch), labelOf: { branch: branchName } });
  $("#reset-all").addEventListener("click", () => {
    setState(cleared(FILTER_KEYS));
    $("#facets-title").focus(); // the button is disabled now
  });
  const sheet = createSheet($("#sheet"), { onClear: (keys) => setState(cleared(keys)) });
  DESKTOP.addEventListener("change", () => {
    if (DESKTOP.matches) sheet.close(); // its sections go back to the sidebar
    scheduleRender(); // tokens open a dialog only below 1024px
  });
  // Approval years: the main column's strip (histogram + two-thumb slider); the per-year chart's
  // brush also sets the range, and both follow state.from/to.
  const yearStrip = createYearStrip($("#year-strip"), { years: approvalYears, onRange: (range) => setState(range) });
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
  // The token whose sidebar section has focus (desktop): Escape goes back to it.
  let opener = null;
  // A sentence token (its key) or All filters ("all"): on desktop, the token's own section and
  // control; below that, a sheet with its sections. Year tokens focus the strip's thumbs.
  function openFilters(key) {
    if (YEAR_THUMBS[key]) {
      yearStrip.focus(YEAR_THUMBS[key]);
      return;
    }
    const sheetKey = TOKEN_SHEETS[key] ?? key;
    const sections = SHEET_SECTIONS[sheetKey].map((section) => $(`#facet-${section}`));
    if (DESKTOP.matches) {
      const target = (key === "atc" ? atcTree.focusTarget() : $(TOKEN_TARGETS[key])) ?? sections[0];
      target.closest(".facet").scrollIntoView({ block: "start" });
      target.focus({ preventScroll: true });
      opener = key;
      return;
    }
    sheet.open({
      title: UI.sheet.titles[sheetKey] ?? sections[0].querySelector(".facet-title").textContent,
      sections,
      // All filters clears every filter, the years too (as the sidebar's Reset all).
      clears: sheetKey === "all" ? FILTER_KEYS : SHEET_SECTIONS[sheetKey].flatMap((section) => SECTION_KEYS[section]),
      restore: () => $(`#filter-sentence [data-sheet="${sheetKey}"]`) ?? $("#all-filters"),
    });
  }
  // Escape in the sidebar returns to the results: the token that led there, else the headline.
  // A search with text clears first (the browser's own Escape).
  $("#facets").addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || (event.target.type === "search" && event.target.value)) return;
    ($(`#filter-sentence [data-focus-key="${opener}:open"]`) ?? $(`#filter-sentence [data-sheet="${TOKEN_SHEETS[opener]}"]`) ?? $("#headline")).focus();
  });
  const allFilters = $("#all-filters");
  allFilters.textContent = UI.sentence.allFilters;
  allFilters.addEventListener("click", () => openFilters("all"));

  // The first checked class in the tree (sidebar), or the sentence's ATC token (phones, tablets).
  const focusAtcFilter = () => (DESKTOP.matches ? atcTree.focusTarget() : $('#filter-sentence [data-sheet="atc"]'))?.focus();

  const readout = $("#year-readout");
  const showReadout = (from, to) => {
    readout.textContent = from === approvalYears[0] && to === approvalYears[1] ? UI.allYears : UI.yearRange(from, to);
  };

  d3.selectAll("#breakdown-by button").on("click", (event) => setState({ by: event.currentTarget.dataset.by }));
  // The activity card's columns: ATC groups or therapeutic area groups (UI state, not in the URL).
  let activityMode = "atc";
  d3.selectAll("#activity-by button")
    .text(function label() {
      return UI.activity.modes[this.dataset.mode];
    })
    .on("click", (event) => {
      activityMode = event.currentTarget.dataset.mode;
      scheduleRender();
    });
  $("#activity-by").setAttribute("aria-label", UI.activity.modesLabel);
  d3.select("#activity-title").text(UI.activity.title);
  d3.select("#activity-note").text(UI.activity.note);

  const table = createTable($("#medicines-table"), $("#table-more"), {
    substanceIndex: buildSubstanceIndex(substanceRows),
    atcNames,
    branchNamesByTerm,
    // A segment adds its class to the ATC filter; pressed again, it removes it.
    onAtcSelect: toggleAtc,
    focusFallback: focusAtcFilter,
  });

  // Area and holder rows toggle their filter value; ATC rows drill down (atcBreakdown()).
  function isBreakdownSelected(key) {
    return state[BREAKDOWN_FILTER[state.by]].includes(key);
  }

  function toggleBreakdown(key) {
    const filter = BREAKDOWN_FILTER[state.by];
    const values = state[filter];
    setState({ [filter]: values.includes(key) ? values.filter((value) => value !== key) : [...values, key] });
  }

  // Union Register rows by product; null until the file has loaded (or if it failed).
  let register = null;
  const registerDiffers = (product) => register?.get(product.ema_product_number)?.agrees_with_ema === false;
  const showCount = (selector, count, text) => d3.select(selector).text(count ? text(count) : "").attr("hidden", count ? null : "");

  // The answer headline counts the medicines matching the filters (every status) and those
  // authorized today; with exactly one ATC code and no other filter it names the class, with its
  // levels below. The dek: the medicines by status, then substances and types.
  function renderHeadline(predicates, filtered, atcCounts) {
    const authorized = filtered.filter(isAuthorizedNow).length;
    const activeCount = Object.keys(predicates).length;
    const classCode = activeCount === 1 ? drillCode() : null;
    let parts;
    if (classCode) parts = UI.headline.atcClass(filtered.length, authorized, atcClassLabel(classCode, atcNames.get(classCode)));
    else if (activeCount) parts = UI.headline.filtered(filtered.length, authorized);
    else parts = UI.headline.home(filtered.length, authorized);
    $("#headline").replaceChildren(...headlineNodes(parts));
    d3.select("#headline-dek").text([UI.headline.statuses(statusBreakdown(filtered)), UI.headline.dek(countTiles(filtered))].filter(Boolean).join(" "));
    const classPath = $("#class-path");
    classPath.hidden = classCode === null;
    if (classCode) renderAtcPath(classPath, { current: classCode, counts: atcCounts, names: atcNames, onSelect: openAtc, all: false, label: UI.atc.classPath });
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
  function atcBreakdown(counts, exact, types) {
    const current = drillCode();
    const { codes } = atcSelection();
    const stack = (row) => {
      const split = (row.incomplete ? types.exact : types.prefix).get(row.code);
      const segments = TYPE_ORDER.filter((type) => split?.get(type)).map((type) => ({ type, count: split.get(type) }));
      return { segments, split: UI.breakdown.typeSplit(segments.map((segment) => [segment.type, segment.count])) };
    };
    const toRow = (row) => {
      const { segments, split } = stack(row);
      return row.incomplete
        ? { key: row.code, label: UI.atc.incomplete, count: row.count, static: true, incomplete: true, segments, split }
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

  // Above the drilled-down ATC bars: "Up one level" and the path of level badges.
  function renderBreakdownPath(current) {
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
      .on("click", () => openAtc(atcPrefixes(current).at(-2) ?? null));
    renderAtcPath(container.appendChild(document.createElement("div")), { current, names: atcNames, onSelect: openAtc, label: UI.atc.path });
    if (focused !== undefined) container.querySelector(`[data-focus-key="${focused}"]`)?.focus();
  }

  // With any filter active: the therapeutic areas of the medicines shown, as links to their
  // condition lookup where the MeSH descriptor is known.
  function renderConditions(filtered) {
    const rows = topAreas(filtered, descriptorOf);
    const card = $("#conditions");
    card.hidden = rows.length === 0;
    if (card.hidden) return;
    d3.select("#conditions-title").text(UI.conditions.title);
    d3.select("#conditions-subtitle").text(UI.conditions.subtitle(filtered.length));
    const list = d3.select("#conditions-list");
    list.selectChildren().remove();
    for (const row of rows) {
      const item = list.append("li");
      if (row.descriptorUi) item.append(() => lookup.link(row.term, { cond: row.descriptorUi }));
      else item.append("span").text(row.term);
      item.append("span").attr("class", "bar-track").attr("aria-hidden", "true")
        .append("span").attr("class", "bar-fill").style("width", `${(100 * row.count) / rows[0].count}%`);
      item.append("span").attr("class", "bar-value").text(d3.format(",")(row.count));
    }
  }

  // The breakdown card over every matching medicine: ATC (stacked by type), areas or holders.
  function renderBreakdownCard(predicates, withoutAtcFilter, atcCounts, atcExact) {
    d3.selectAll("#breakdown-by button").attr("aria-pressed", function pressed() {
      return String(this.dataset.by === state.by);
    });
    const card = $("#breakdown").closest(".chart-card");
    const hadFocus = card.contains(document.activeElement);
    const atcTypes = state.by === "atc"
      ? {
        prefix: typeSplit(withoutAtcFilter, (product) => product.atc.flatMap((row) => atcPrefixes(row.atc_code_human))),
        exact: typeSplit(withoutAtcFilter, (product) => product.atc.map((row) => row.atc_code_human).filter(atcLevel)),
      }
      : null;
    const atc = atcTypes ? atcBreakdown(atcCounts, atcExact, atcTypes) : null;
    d3.select("#breakdown-title").text(atc?.title ?? UI.breakdown[state.by].title);
    d3.select("#breakdown-note").text(UI.breakdown[state.by].note).attr("hidden", UI.breakdown[state.by].note ? null : "");
    // One legend per card: the medicine types the stacked ATC bars show.
    const legendTypes = TYPE_ORDER.filter((type) => atc?.rows.some((row) => row.segments.some((segment) => segment.type === type)));
    renderLegend($("#breakdown-legend"), legendTypes);
    $("#breakdown-legend").hidden = legendTypes.length === 0;
    renderBreakdownPath(atc?.current ?? null);
    const population = filterProducts(products, predicates, BREAKDOWN_FILTER[state.by]);
    renderBreakdown($("#breakdown"), atc ? atc.rows : breakdownCounts(population, state.by, breakdownLabel[state.by]), atc
      ? { isSelected: atc.isSelected, onToggle: atc.onToggle, badgeOf: (row) => ({ text: row.key, hue: atcHue(row.key), level: atcLevel(row.key) }) }
      : { isSelected: isBreakdownSelected, onToggle: toggleBreakdown });
    const { excluded } = UI.breakdown[state.by];
    // Products without any ATC code matter at level 1 only.
    showCount("#breakdown-excluded", excluded && !atc?.current ? breakdownExcluded(population, state.by) : 0, excluded);
    // Drilling down or going up rebuilds the controls: keep focus in the card.
    if (hadFocus && !card.contains(document.activeElement)) (card.querySelector("#breakdown button") ?? card.querySelector("#breakdown-path button"))?.focus();
  }

  // "Who is active where": the top holders of the medicines shown by ATC group (the classes one
  // level below a drilled-into code: drillCode()) or by the top therapeutic area groups (+ Other).
  function renderActivityCard(filtered) {
    d3.selectAll("#activity-by button").attr("aria-pressed", function pressed() {
      return String(this.dataset.mode === activityMode);
    });
    let keysOf;
    let columns;
    if (activityMode === "atc") {
      const parent = drillCode();
      const depth = parent ? atcLevel(parent) : 0;
      // A product's classes at the column level (the leaf itself when parent is level 5).
      keysOf = (product) => product.atc
        .map((row) => atcPrefixes(row.atc_code_human))
        .filter((prefixes) => parent === null || prefixes.includes(parent))
        .map((prefixes) => prefixes[depth] ?? (depth === 5 ? parent : null))
        .filter(Boolean);
      columns = [...keyCounts(filtered, keysOf).keys()].sort().map((code) => ({
        key: code, badge: code, label: atcClassLabel(code, atcNames.get(code)), title: atcClassLabel(code, atcNames.get(code)), filter: { atc: [code] },
      }));
    } else {
      const top = topKeys(keyCounts(filtered, (product) => product.branches), ACTIVITY_AREAS);
      const shown = new Set(top);
      keysOf = (product) => product.branches.map((branch) => (shown.has(branch) ? branch : ACTIVITY_OTHER));
      const other = filtered.some((product) => product.branches.some((branch) => !shown.has(branch)));
      columns = [
        ...top.map((branch) => ({ key: branch, label: branchName(branch), filter: { branch: [branch] } })),
        ...(other ? [{ key: ACTIVITY_OTHER, label: UI.activity.other, title: UI.activity.otherTitle, filter: null }] : []),
      ];
    }
    const rows = holderActivity(filtered, keysOf, ACTIVITY_HOLDERS);
    d3.select("#activity-subtitle").text(rows.length ? UI.activity.subtitle(rows.length) : "");
    renderActivity($("#activity-table"), { rows, columns, labelledBy: "activity-title", describedBy: "activity-subtitle", onFilter: (patch) => setState(patch) });
  }

  function renderYears(withoutDateFilter) {
    const dated = withoutDateFilter.filter((product) => product.year !== null);
    const rows = countApprovalsByYear(dated, MEDICINE_TYPES, approvalYears);
    renderChart($("#chart"), rows, state, (range) => {
      keepInPlace($("#chart"));
      setState(range);
    }, ({ from, to }) => showReadout(from, to));
    d3.select("#undated-note").text(UI.years.undated(withoutDateFilter.length - dated.length));
  }

  function renderDashboard() {
    showReadout(state.from ?? approvalYears[0], state.to ?? approvalYears[1]);

    const predicates = makePredicates(state, atcClasses);
    const activeCount = Object.keys(predicates).length;
    facetPanel.render({
      state,
      counts: Object.fromEntries(FACETS.map((dimension) => [dimension, facetCounts(products, predicates, dimension, FACET_VALUES[dimension])])),
      activeCount,
    });
    // The per-year chart, the strip and the over-time line ignore the approval-year filter and
    // mark the range instead.
    const withoutDateFilter = filterProducts(products, predicates, "date");
    yearStrip.render({
      rows: yearHistogram(products, predicates, approvalYears),
      from: state.from,
      to: state.to,
      undated: withoutDateFilter.filter((product) => product.year === null).length,
    });
    renderSentence($("#filter-sentence"), sentenceParts(state, { years: approvalYears, branchNames, atcNames }), {
      anyActive: activeCount > 0,
      sheetOf: (key) => TOKEN_SHEETS[key],
      popup: !DESKTOP.matches,
      onOpen: openFilters,
      // One of two ATC pills removes its class only.
      onRemove: (token) => setState(token.value === undefined ? cleared(token.clears) : { atc: state.atc.filter((value) => value !== token.value) }),
      onReset: () => setState(cleared(FILTER_KEYS)),
    });
    // ATC counts per prefix (and per exact code, for the products coded only down to an
    // incomplete level) of the medicines matching every other filter: tree, breakdown, class path.
    const withoutAtcFilter = filterProducts(products, predicates, "atc");
    const atcCounts = atcPrefixCounts(withoutAtcFilter);
    const atcExact = atcExactCounts(withoutAtcFilter);
    atcTree.render({ ...atcSelection(), counts: atcCounts, exact: atcExact, classNames: atcNames });

    const filtered = predicates.date ? withoutDateFilter.filter(predicates.date) : withoutDateFilter;
    const authorizedNow = filtered.filter(isAuthorizedNow);
    sheet.update(filtered.length);
    renderHeadline(predicates, filtered, atcCounts);
    renderTiles($("#tiles"), { ...countTiles(filtered), authorized: authorizedNow.length }, activeCount > 0);
    showCount("#register-note", authorizedNow.filter(registerDiffers).length, UI.register.notAuthorized);
    const undatedAuthorized = withoutDateFilter.filter((product) => product.medicine_status === "Authorised" && product.authorized_from === null);
    showCount("#undated-authorized", undatedAuthorized.length, UI.undatedAuthorized);
    renderBreakdownCard(predicates, withoutAtcFilter, atcCounts, atcExact);
    renderActivityCard(filtered);
    renderYears(withoutDateFilter);
    if (activeCount > 0) renderConditions(filtered);
    else $("#conditions").hidden = true;

    renderOverTime($("#over-time"), authorizedSeries(withoutDateFilter, seriesDates), state);
    const excluded = withoutDateFilter.filter((product) => product.series_exclusion === "ended_without_end_date");
    d3.select("#over-time-note").text(UI.overTime.excluded(excluded.length));

    const undated = filtered.filter((product) => product.year === null).length;
    table(newestFirst(filtered), UI.table.caption(filtered.length, undated), register, atcSelection().codes, lookup.documents());
  }

  dashboard = { domain, render: renderDashboard };
  applyUrl();
  scheduleUrlWrite(state); // canonical form, invalid values removed
  d3.select("#app-loading").attr("hidden", "");
  d3.select("#app").attr("hidden", null);
  d3.select("#facets").attr("hidden", null);
  const resizeObserver = new ResizeObserver(scheduleRender);
  for (const selector of ["#chart", "#over-time", "#year-hist"]) resizeObserver.observe($(selector));
  render();
  loadFile(REGISTER_FILE).then((rows) => {
    register = new Map(rows.map((row) => [row.ema_product_number, row]));
    scheduleRender();
  }, () => {});
  // The table's PI and EPAR links: the documents index (~5 MB, shared with the cards) in the background.
  lookup.onData((name) => {
    if (name === "documents") scheduleRender();
  });
  lookup.need("documents");
}

// Desktop: the sidebar starts below the fixed header, whose height follows its text (the offline
// note, user text spacing).
const header = $("header");
new ResizeObserver(() => document.documentElement.style.setProperty("--header-h", `${header.offsetHeight}px`)).observe(header);

renderAbout();
renderTypeTips();
setupTips();
Promise.all(FIRST_FILES.map(loadFile)).then(startLookup, showMissingData);
