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
import { atcChildren, atcExactCounts, atcLevel, atcPrefixCounts, atcPrefixes } from "./atc.js";
import { renderAtcPath, renderAtcPicker } from "./atc-picker.js";
import { atcHue } from "./badges.js";
import { renderBreakdown } from "./breakdown.js";
import { renderChart, renderLegend } from "./chart.js";
import { createFacetPanel } from "./facet-panel.js";
import { FACET_VALUES, TYPE_ORDER, facetCounts, facetPopulation, sentenceParts, topAreas, typeSplit, yearHistogram } from "./facets.js";
import { renderSentence } from "./filter-sentence.js";
import { filterProducts, makePredicates, parseAtcQuery } from "./filters.js";
import { UI, atcClassLabel, atcName } from "./labels.js";
import { createLookup, headlineNodes } from "./lookup.js";
import { renderOverTime, renderOverTimeLegend } from "./over-time.js";
import { createSearchBox } from "./search-box.js";
import { buildLookupIndex, suggest, suggestAtcClasses } from "./search.js";
import { createSheet } from "./sheet.js";
import { createTable } from "./table.js";
import { initTabs } from "./tabs.js";
import { renderTiles } from "./tiles.js";
import {
  ATC_QUERY_MAX,
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
// Loaded after the dashboard's first render; shared with the medicine card (same loadFile promise).
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
const YEAR_THUMBS = { from: "start", to: "end" };
// Desktop: the control each token focuses, the first one of its own section.
const TOKEN_TARGETS = {
  type: "#facet-type input",
  atc: "#atc-input",
  mah: "#facet-mah .facet-search",
  areas: "#facet-branch input",
  branch: "#facet-branch input",
  area: "#facet-area .facet-search",
  status: "#facet-status input",
};
const FACETS = ["type", "status", "branch", "area", "mah"];

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
// Filter edits (not the first render, tabs or lookups) announce the new headline, debounced.
const FILTER_KEYS = Object.keys(DEFAULT_STATE).filter((key) => key !== "view" && key !== "by");
let announceFilters = false;
let announceTimer = 0;
// A drug class opened from a card or the search: its headline takes focus once shown.
let focusAnswer = false;

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
  // Approval years: the main column's strip (histogram + two-thumb slider); the tab chart's brush
  // also sets the range, and both follow state.from/to.
  const yearStrip = createYearStrip($("#year-strip"), { years: approvalYears, onRange: (range) => setState(range) });
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
      const target = $(TOKEN_TARGETS[key]) ?? sections[0];
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
    // The ATC sheet has room for the classes: open the picker's list (its own toggle).
    if (sheetKey === "atc") $('#atc-picker .atc-browse[aria-expanded="false"]')?.click();
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
  const otherStatuses = $("#other-statuses-open");
  otherStatuses.textContent = UI.otherStatuses.action;
  otherStatuses.addEventListener("click", () => navigate({ view: "years" })); // focus: the new headline

  const atcInput = $("#atc-input");
  atcInput.maxLength = ATC_QUERY_MAX;
  atcInput.addEventListener("input", () => setState({ atc: atcInput.value }));
  // The ATC code filter (null for none or a name query).
  const selectedAtc = () => {
    const query = parseAtcQuery(state.atc);
    return query.kind === "code" ? query.value : null;
  };
  const selectAtc = (code) => setState({ atc: code ?? "" });
  // The picker's current level in the sidebar, or the sentence's ATC token (phones, tablets).
  const focusAtcFilter = () => (DESKTOP.matches ? $("#atc-picker [aria-current]") : $('#filter-sentence [data-sheet="atc"]'))?.focus();

  const readout = $("#year-readout");
  const showReadout = (from, to) => {
    readout.textContent = from === approvalYears[0] && to === approvalYears[1] ? UI.allYears : UI.yearRange(from, to);
  };

  const renderTabs = initTabs($('[role="tablist"]'), (view) => {
    if (view !== state.view) setState({ view }, true);
  });
  d3.selectAll("#breakdown-by button").on("click", (event) => setState({ by: event.currentTarget.dataset.by }));

  const table = createTable($("#medicines-table"), $("#table-more"), {
    substanceIndex: buildSubstanceIndex(substanceRows),
    atcNames,
    branchNamesByTerm,
    // A segment filters by its level; pressed again, it clears the ATC filter.
    onAtcSelect: (code) => selectAtc(code === selectedAtc() ? null : code),
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

  // The answer headline follows the view and the filters: authorized medicines (Authorized now),
  // or the medicines with an approval date that the per-year table lists (Approvals per year).
  // With only an ATC code filter (Authorized now) it names the class, with its levels below.
  function renderHeadline(predicates, tableRows, authorizedCounts, atcCounts) {
    const filtersActive = Object.keys(predicates).length > 0;
    const classCode = state.view === "now" && Object.keys(predicates).length === 1 ? selectedAtc() : null;
    let counts = authorizedCounts;
    let parts;
    if (classCode) {
      parts = UI.headline.atcClass(counts.products, atcClassLabel(classCode, atcNames.get(classCode)));
    } else if (state.view === "now") {
      parts = filtersActive ? UI.headline.filtered(counts.products) : UI.headline.home(counts.products);
    } else {
      counts = countTiles(tableRows);
      const range = predicates.date ? UI.yearRange(state.from ?? approvalYears[0], state.to ?? approvalYears[1]) : null;
      parts = filtersActive ? UI.headline.approvedFiltered(counts.products, range) : UI.headline.approvedSince(counts.products, approvalYears[0]);
    }
    $("#headline").replaceChildren(...headlineNodes(parts));
    d3.select("#headline-dek").text(UI.headline.dek(counts) ?? "");
    const classPath = $("#class-path");
    classPath.hidden = classCode === null;
    if (classCode) renderAtcPath(classPath, { current: classCode, counts: atcCounts, names: atcNames, onSelect: selectAtc, all: false, label: UI.atc.classPath });
    else classPath.replaceChildren();
    if (!announceFilters) return;
    announceFilters = false;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      // An open sheet makes the page behind it inert, and inert live regions are not announced.
      $(sheet.isOpen() ? "#sheet-status" : "#filter-result").textContent = $("#headline").textContent;
    }, 500);
  }

  // ATC breakdown: the classes one level below the ATC code filter (level-1 groups without one,
  // or for a name query), then the products coded exactly at it (a static row); a class without
  // children shows only itself. counts, exact: atcPrefixCounts(), atcExactCounts() of the
  // breakdown's population; types: that population split by medicine type (typeSplit()) per
  // prefix and per exact code, for the stacked bars.
  function atcBreakdown(counts, exact, types) {
    const current = selectedAtc();
    const stack = (row) => {
      const split = (row.incomplete ? types.exact : types.prefix).get(row.code);
      const segments = TYPE_ORDER.filter((type) => split?.get(type)).map((type) => ({ type, count: split.get(type) }));
      return { segments, split: UI.breakdown.typeSplit(segments.map((segment) => [segment.type, segment.count])) };
    };
    const toRow = (row) => {
      const { segments, split } = stack(row);
      return row.incomplete
        ? { key: row.code, label: UI.atc.incomplete, count: row.count, static: true, incomplete: true, segments, split }
        : { key: row.code, label: atcName(row.code, row.name), count: row.count, segments, split, ariaLabel: `${UI.atc.classCount(row.code, row.name, row.count)}: ${split}` };
    };
    const children = atcChildren(current, counts, atcNames, exact);
    if (current === null) return { current, title: UI.breakdown.atc.title, rows: children.map(toRow) };
    const label = atcClassLabel(current, atcNames.get(current));
    if (children.length) return { current, title: UI.breakdown.atc.titleIn(label), rows: children.map(toRow) };
    const count = counts.get(current) ?? 0;
    const self = { code: current, name: atcNames.get(current) ?? null, count };
    return { current, title: UI.breakdown.atc.titleLeaf(label), rows: count ? [{ ...toRow(self), static: true }] : [] };
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
      .on("click", () => selectAtc(atcPrefixes(current).at(-2) ?? null));
    renderAtcPath(container.appendChild(document.createElement("div")), { current, names: atcNames, onSelect: selectAtc, label: UI.atc.path });
    if (focused !== undefined) container.querySelector(`[data-focus-key="${focused}"]`)?.focus();
  }

  // With any filter active: the therapeutic areas of the authorized medicines shown, as links to
  // their condition lookup where the MeSH descriptor is known.
  function renderConditions(authorizedNow) {
    const rows = topAreas(authorizedNow, descriptorOf);
    const card = $("#conditions");
    card.hidden = rows.length === 0;
    if (card.hidden) return;
    d3.select("#conditions-title").text(UI.conditions.title);
    d3.select("#conditions-subtitle").text(UI.conditions.subtitle(authorizedNow.length));
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

  function renderNow(predicates, authorizedNow, counts, withoutDateFilter, atcCounts, atcExact, atcTypes) {
    renderTiles($("#tiles"), counts);
    showCount("#register-note", authorizedNow.filter(registerDiffers).length, UI.register.notAuthorized);
    const undated = withoutDateFilter.filter((product) => product.medicine_status === "Authorised" && product.authorized_from === null);
    d3.select("#undated-authorized").text(UI.undatedAuthorized(undated.length));

    d3.selectAll("#breakdown-by button").attr("aria-pressed", function pressed() {
      return String(this.dataset.by === state.by);
    });
    const card = $("#breakdown").closest(".chart-card");
    const hadFocus = card.contains(document.activeElement);
    const atc = state.by === "atc" ? atcBreakdown(atcCounts, atcExact, atcTypes) : null;
    d3.select("#breakdown-title").text(atc?.title ?? UI.breakdown[state.by].title);
    d3.select("#breakdown-note").text(UI.breakdown[state.by].note).attr("hidden", UI.breakdown[state.by].note ? null : "");
    // One legend per card: the medicine types the stacked ATC bars show.
    const legendTypes = TYPE_ORDER.filter((type) => atc?.rows.some((row) => row.segments.some((segment) => segment.type === type)));
    renderLegend($("#breakdown-legend"), legendTypes);
    $("#breakdown-legend").hidden = legendTypes.length === 0;
    renderBreakdownPath(atc?.current ?? null);
    const population = filterProducts(products, predicates, BREAKDOWN_FILTER[state.by]).filter(isAuthorizedNow);
    renderBreakdown($("#breakdown"), atc ? atc.rows : breakdownCounts(population, state.by, breakdownLabel[state.by]), atc
      ? { onToggle: selectAtc, badgeOf: (row) => ({ text: row.key, hue: atcHue(row.key), level: atcLevel(row.key) }) }
      : { isSelected: isBreakdownSelected, onToggle: toggleBreakdown });
    const { excluded } = UI.breakdown[state.by];
    // Products without any ATC code matter at level 1 only.
    showCount("#breakdown-excluded", excluded && !atc?.current ? breakdownExcluded(population, state.by) : 0, excluded);
    // Drilling down or going up rebuilds the controls: keep focus in the card.
    if (hadFocus && !card.contains(document.activeElement)) (card.querySelector("#breakdown button") ?? card.querySelector("#breakdown-path button"))?.focus();
  }

  function renderYears(withoutDateFilter) {
    const dated = withoutDateFilter.filter((product) => product.year !== null);
    const rows = countApprovalsByYear(dated, MEDICINE_TYPES, approvalYears);
    renderChart($("#chart"), rows, state, (range) => setState(range), ({ from, to }) => showReadout(from, to));
    d3.select("#undated-note").text(UI.years.undated(withoutDateFilter.length - dated.length));
  }

  function renderDashboard() {
    renderTabs(state.view);
    if (atcInput.value !== state.atc) atcInput.value = state.atc;
    showReadout(state.from ?? approvalYears[0], state.to ?? approvalYears[1]);

    const predicates = makePredicates(state, atcClasses);
    const activeCount = Object.keys(predicates).length;
    facetPanel.render({
      view: state.view,
      state,
      counts: Object.fromEntries(FACETS.map((dimension) => [
        dimension,
        facetCounts(products, predicates, dimension, FACET_VALUES[dimension], facetPopulation(state.view, dimension)),
      ])),
      activeCount,
    });
    yearStrip.render({ rows: yearHistogram(products, predicates, state.view, approvalYears), view: state.view, from: state.from, to: state.to });
    renderSentence($("#filter-sentence"), sentenceParts(state, { years: approvalYears, branchNames, atcNames }), {
      anyActive: activeCount > 0,
      sheetOf: (key) => TOKEN_SHEETS[key],
      popup: !DESKTOP.matches,
      onOpen: openFilters,
      onRemove: (token) => setState(cleared(token.clears)),
      onReset: () => setState(cleared(FILTER_KEYS)),
    });
    // ATC counts per prefix (and per exact code, for the products coded only down to an
    // incomplete level) of the products matching every other filter: authorized now for the
    // breakdown and class path; the view's population (facetPopulation()) for the picker.
    const withoutAtcFilter = filterProducts(products, predicates, "atc");
    const atcPopulation = withoutAtcFilter.filter(isAuthorizedNow);
    const atcCounts = atcPrefixCounts(atcPopulation);
    const atcExact = atcExactCounts(atcPopulation);
    const pickerPopulation = state.view === "now" ? atcPopulation : withoutAtcFilter.filter(facetPopulation(state.view, "atc"));
    const atcQuery = parseAtcQuery(state.atc);
    renderAtcPicker($("#atc-picker"), {
      current: selectedAtc(),
      nameQuery: atcQuery.kind === "name" ? state.atc.trim() : null,
      counts: state.view === "now" ? atcCounts : atcPrefixCounts(pickerPopulation),
      exact: state.view === "now" ? atcExact : atcExactCounts(pickerPopulation),
      names: atcNames,
      onSelect: selectAtc,
      countNoun: state.view === "now" ? "authorized" : "approved",
    });
    // The per-year chart and the over-time line ignore the approval-year filter and mark the range instead.
    const withoutDateFilter = filterProducts(products, predicates, "date");
    const filtered = predicates.date ? withoutDateFilter.filter(predicates.date) : withoutDateFilter;
    const authorizedNow = filtered.filter(isAuthorizedNow);
    const counts = countTiles(authorizedNow);
    const tableRows = state.view === "now"
      ? authorizedNow
      : filtered.filter((product) => product.year !== null);
    sheet.update(tableRows.length);
    renderHeadline(predicates, tableRows, counts, atcCounts);
    // Authorized now cannot show other statuses: say where the Status facet's counts are.
    const elsewhere = state.view === "now" && state.status.some((status) => status !== "Authorised")
      ? filtered.filter((product) => product.year !== null).length
      : 0;
    $("#other-statuses").hidden = elsewhere === 0;
    $("#other-statuses-text").textContent = elsewhere ? UI.otherStatuses.note(elsewhere) : "";
    if (state.view === "now") {
      const atcTypes = state.by === "atc"
        ? {
          prefix: typeSplit(atcPopulation, (product) => product.atc.flatMap((row) => atcPrefixes(row.atc_code_human))),
          exact: typeSplit(atcPopulation, (product) => product.atc.map((row) => row.atc_code_human).filter(atcLevel)),
        }
        : null;
      renderNow(predicates, authorizedNow, counts, withoutDateFilter, atcCounts, atcExact, atcTypes);
    } else {
      renderYears(withoutDateFilter);
    }
    if (state.view === "now" && activeCount > 0) renderConditions(authorizedNow);
    else $("#conditions").hidden = true;

    renderOverTime($("#over-time"), authorizedSeries(withoutDateFilter, seriesDates), state);
    const excluded = withoutDateFilter.filter((product) => product.series_exclusion === "ended_without_end_date");
    d3.select("#over-time-note").text(UI.overTime.excluded(excluded.length));

    const caption = state.view === "now" ? UI.table.captionNow(tableRows.length) : UI.table.captionYears(tableRows.length);
    table(newestFirst(tableRows), caption, register, selectedAtc());
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
}

// Desktop: the sidebar starts below the fixed header, whose height follows its text (the offline
// note, user text spacing).
const header = $("header");
new ResizeObserver(() => document.documentElement.style.setProperty("--header-h", `${header.offsetHeight}px`)).observe(header);

renderAbout();
Promise.all(FIRST_FILES.map(loadFile)).then(startLookup, showMissingData);
