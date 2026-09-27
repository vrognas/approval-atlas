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
  distinctSorted,
  isAuthorizedNow,
  newestFirst,
} from "./approvals.js";
import { atcChildren, atcExactCounts, atcLevel, atcPrefixCounts, atcPrefixes } from "./atc.js";
import { renderAtcPath, renderAtcPicker } from "./atc-picker.js";
import { atcHue } from "./badges.js";
import { renderBreakdown } from "./breakdown.js";
import { renderChart, renderLegend } from "./chart.js";
import { filterProducts, makePredicates, parseAtcQuery } from "./filters.js";
import { UI, atcClassLabel, atcName, statusLabel } from "./labels.js";
import { createLookup, headlineNodes } from "./lookup.js";
import { createMultiSelect } from "./multi-select.js";
import { renderOverTime, renderOverTimeLegend } from "./over-time.js";
import { createSearchBox } from "./search-box.js";
import { buildLookupIndex, suggest, suggestAtcClasses } from "./search.js";
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
  normalizeYearRange,
  patchFilterParams,
  scheduleUrlWrite,
  withoutLookup,
} from "./url.js";

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
const WIDE = window.matchMedia("(min-width: 721px)");

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
  const byLabel = (a, b) => a.label.localeCompare(b.label);
  const options = {
    mah: distinctSorted(products.map((product) => product.mah)).map((value) => ({ value, label: value })),
    branch: [...branchNames].map(([value, label]) => ({ value, label })).sort(byLabel),
    area: distinctSorted(areaRows.map((row) => row.therapeutic_area_mesh)).map((value) => ({ value, label: value })),
    type: MEDICINE_TYPES.map((value) => ({ value, label: value })),
    status: distinctSorted(products.map((product) => product.medicine_status)).map((value) => ({ value, label: statusLabel(value) })).sort(byLabel),
  };
  const domain = {
    mahs: new Set(options.mah.map((option) => option.value)),
    branches: new Set(options.branch.map((option) => option.value)),
    areas: new Set(options.area.map((option) => option.value)),
    types: new Set(MEDICINE_TYPES),
    statuses: new Set(options.status.map((option) => option.value)),
    years: approvalYears,
  };
  const breakdownLabel = {
    area: (branch) => branchNames.get(branch) ?? branch,
    mah: (mah) => mah,
  };

  renderLegend($("#legend"));
  renderOverTimeLegend($("#over-time-legend"));

  // Phones: the filter row collapses into a closed disclosure; wider screens keep it open.
  const disclosure = $("#filters");
  const syncDisclosure = () => {
    disclosure.open = WIDE.matches;
  };
  WIDE.addEventListener("change", syncDisclosure);
  syncDisclosure();

  const selects = Object.fromEntries(Object.keys(options).map((key) => [key, createMultiSelect($(`#filter-${key}`), {
    label: UI.filters[key],
    options: options[key],
    onChange: (values) => setState({ [key]: values }),
  })]));
  const atcInput = $("#atc-input");
  atcInput.maxLength = ATC_QUERY_MAX;
  atcInput.addEventListener("input", () => setState({ atc: atcInput.value }));
  // The ATC code filter (null for none or a name query).
  const selectedAtc = () => {
    const query = parseAtcQuery(state.atc);
    return query.kind === "code" ? query.value : null;
  };
  const selectAtc = (code) => setState({ atc: code ?? "" });
  // The picker's current level, or the disclosure's summary while it is closed (phones).
  const focusAtcPicker = () => (disclosure.open ? $("#atc-picker [aria-current]") : $("#filters-summary"))?.focus();

  const fromInput = $("#year-from");
  const toInput = $("#year-to");
  for (const input of [fromInput, toInput]) Object.assign(input, { min: approvalYears[0], max: approvalYears[1] });
  const readYear = (input) => (Number.isInteger(input.valueAsNumber) ? input.valueAsNumber : null);
  const readYears = () => setState(normalizeYearRange(readYear(fromInput), readYear(toInput), approvalYears));
  fromInput.addEventListener("change", readYears);
  toInput.addEventListener("change", readYears);
  $("#year-reset").addEventListener("click", () => setState({ from: null, to: null }));
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
    focusFallback: focusAtcPicker,
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
      $("#filter-result").textContent = $("#headline").textContent;
    }, 500);
  }

  // ATC breakdown: the classes one level below the ATC code filter (level-1 groups without one,
  // or for a name query), then the products coded exactly at it (a static row); a class without
  // children shows only itself. counts, exact: atcPrefixCounts(), atcExactCounts() of the
  // breakdown's population.
  function atcBreakdown(counts, exact) {
    const current = selectedAtc();
    const toRow = (row) => (row.incomplete
      ? { key: row.code, label: UI.atc.incomplete, count: row.count, static: true, incomplete: true }
      : { key: row.code, label: atcName(row.code, row.name), count: row.count, ariaLabel: UI.atc.classCount(row.code, row.name, row.count) });
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

  function renderNow(predicates, authorizedNow, counts, withoutDateFilter, atcCounts, atcExact) {
    renderTiles($("#tiles"), counts);
    showCount("#register-note", authorizedNow.filter(registerDiffers).length, UI.register.notAuthorized);
    const undated = withoutDateFilter.filter((product) => product.medicine_status === "Authorised" && product.authorized_from === null);
    d3.select("#undated-authorized").text(UI.undatedAuthorized(undated.length));

    d3.selectAll("#breakdown-by button").attr("aria-pressed", function pressed() {
      return String(this.dataset.by === state.by);
    });
    const card = $("#breakdown").closest(".chart-card");
    const hadFocus = card.contains(document.activeElement);
    const atc = state.by === "atc" ? atcBreakdown(atcCounts, atcExact) : null;
    d3.select("#breakdown-title").text(atc?.title ?? UI.breakdown[state.by].title);
    d3.select("#breakdown-note").text(UI.breakdown[state.by].note).attr("hidden", UI.breakdown[state.by].note ? null : "");
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
    for (const [key, select] of Object.entries(selects)) select.update(options[key], state[key]);
    if (atcInput.value !== state.atc) atcInput.value = state.atc;
    fromInput.value = state.from ?? approvalYears[0];
    toInput.value = state.to ?? approvalYears[1];
    $("#year-reset").disabled = state.from === null && state.to === null;
    showReadout(state.from ?? approvalYears[0], state.to ?? approvalYears[1]);

    const predicates = makePredicates(state, atcClasses);
    d3.select("#filters-summary").text(UI.filtersSummary(Object.keys(predicates).length));
    // ATC facet counts: authorized products matching every other filter, per prefix (and per
    // exact code, for the products coded only down to an incomplete level).
    const atcPopulation = filterProducts(products, predicates, "atc").filter(isAuthorizedNow);
    const atcCounts = atcPrefixCounts(atcPopulation);
    const atcExact = atcExactCounts(atcPopulation);
    const atcQuery = parseAtcQuery(state.atc);
    renderAtcPicker($("#atc-picker"), {
      current: selectedAtc(),
      nameQuery: atcQuery.kind === "name" ? state.atc.trim() : null,
      counts: atcCounts,
      exact: atcExact,
      names: atcNames,
      onSelect: selectAtc,
    });
    // The per-year chart and the over-time line ignore the approval-year filter and mark the range instead.
    const withoutDateFilter = filterProducts(products, predicates, "date");
    const filtered = predicates.date ? withoutDateFilter.filter(predicates.date) : withoutDateFilter;
    const authorizedNow = filtered.filter(isAuthorizedNow);
    const counts = countTiles(authorizedNow);
    const tableRows = state.view === "now"
      ? authorizedNow
      : filtered.filter((product) => product.year !== null);
    renderHeadline(predicates, tableRows, counts, atcCounts);
    if (state.view === "now") renderNow(predicates, authorizedNow, counts, withoutDateFilter, atcCounts, atcExact);
    else renderYears(withoutDateFilter);

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
  const resizeObserver = new ResizeObserver(scheduleRender);
  for (const selector of ["#chart", "#over-time"]) resizeObserver.observe($(selector));
  render();
  loadFile(REGISTER_FILE).then((rows) => {
    register = new Map(rows.map((row) => [row.ema_product_number, row]));
    scheduleRender();
  }, () => {});
}

renderAbout();
Promise.all(FIRST_FILES.map(loadFile)).then(startLookup, showMissingData);
