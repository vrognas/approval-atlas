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
import { renderBreakdown } from "./breakdown.js";
import { renderChart, renderLegend } from "./chart.js";
import { filterProducts, makePredicates, parseAtcQuery } from "./filters.js";
import { UI, atcLevelOneLabel, statusLabel } from "./labels.js";
import { createLookup } from "./lookup.js";
import { createMultiSelect } from "./multi-select.js";
import { renderOverTime, renderOverTimeLegend } from "./over-time.js";
import { createSearchBox } from "./search-box.js";
import { buildLookupIndex, suggest } from "./search.js";
import { createTable } from "./table.js";
import { initTabs } from "./tabs.js";
import { renderTiles } from "./tiles.js";
import {
  ATC_QUERY_MAX,
  DEFAULT_LOOKUP,
  DEFAULT_STATE,
  decodeLookup,
  decodeState,
  normalizeYearRange,
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
  // First visit: everything loaded before the worker took control bypassed its cache; hand it
  // those URLs (in-flight data files included) so the site opens offline after one visit.
  if (!navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      const loaded = performance.getEntriesByType("resource").map((entry) => entry.name);
      navigator.serviceWorker.controller.postMessage([...loaded, ...[...files.keys()].map((file) => `/data/${file}`)]);
    }, { once: true });
  }
}

// One state for the lookup (q/med/sub/cond) and the filters. Until the dashboard's data has
// loaded, the filter domain is unknown, so the URL's filter part is kept verbatim.
let state = { ...structuredClone(DEFAULT_STATE), ...DEFAULT_LOOKUP };
let dashboard = null;
let pendingFilters = new URLSearchParams();
let lookup = null;
let frame = 0;
const urlNote = $("#url-note");

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
  dashboard?.render();
}

function scheduleRender() {
  if (!frame) frame = requestAnimationFrame(() => {
    frame = 0;
    render();
  });
}

function setState(patch, push = false) {
  state = { ...state, ...patch };
  urlNote.hidden = true;
  scheduleRender();
  scheduleUrlWrite(state, push, dashboard ? null : pendingFilters);
}

// Opening a card or result: one history entry, focus moves to its heading.
function navigate(patch) {
  lookup.focusOnNextRender();
  setState({ ...DEFAULT_LOOKUP, ...patch }, true);
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

function suggestionGroups(result) {
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
  ];
}

function startLookup([meta, searchRows, entryTermRows]) {
  d3.select("#data-date").text(UI.dataDate(meta.snapshot_date ?? meta.source_timestamp.slice(0, 10)));
  renderFooter(meta);
  showOfflineNote(meta);

  const index = buildLookupIndex(searchRows, entryTermRows);
  lookup = createLookup($("#result"), { index, loadFile, navigate, snapshotDate: meta.snapshot_date });
  const input = $("#lookup-input");
  const searchBox = createSearchBox(input, $("#lookup-listbox"), $("#lookup-status"), {
    suggestionsFor: (query) => suggestionGroups(suggest(index, lookup.conditions(), query)),
    onPick: (group, value) => navigate(group === "medicines" ? { med: value } : group === "substances" ? { sub: value } : { cond: value }),
    onSubmit: (text) => navigate({ q: text }),
  });
  lookup.onData((name) => {
    if (name === "conditions") searchBox.refresh();
  });
  lookup.need("conditions");

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
    atc: (code) => atcLevelOneLabel(code, atcNames.get(code)),
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
  });

  function isBreakdownSelected(key) {
    if (state.by === "atc") {
      const query = parseAtcQuery(state.atc);
      return query.kind === "code" && query.value === key;
    }
    return state[BREAKDOWN_FILTER[state.by]].includes(key);
  }

  function toggleBreakdown(key) {
    if (state.by === "atc") {
      setState({ atc: isBreakdownSelected(key) ? "" : key });
      return;
    }
    const filter = BREAKDOWN_FILTER[state.by];
    const values = state[filter];
    setState({ [filter]: values.includes(key) ? values.filter((value) => value !== key) : [...values, key] });
  }

  // Union Register rows by product; null until the file has loaded (or if it failed).
  let register = null;
  const registerDiffers = (product) => register?.get(product.ema_product_number)?.agrees_with_ema === false;
  const showCount = (selector, count, text) => d3.select(selector).text(count ? text(count) : "").attr("hidden", count ? null : "");

  function renderNow(predicates, filtered, withoutDateFilter) {
    const authorizedNow = filtered.filter(isAuthorizedNow);
    renderTiles($("#tiles"), countTiles(authorizedNow));
    showCount("#register-note", authorizedNow.filter(registerDiffers).length, UI.register.notAuthorized);
    const undated = withoutDateFilter.filter((product) => product.medicine_status === "Authorised" && product.authorized_from === null);
    d3.select("#undated-authorized").text(UI.undatedAuthorized(undated.length));

    d3.selectAll("#breakdown-by button").attr("aria-pressed", function pressed() {
      return String(this.dataset.by === state.by);
    });
    d3.select("#breakdown-title").text(UI.breakdown[state.by].title);
    d3.select("#breakdown-note").text(UI.breakdown[state.by].note).attr("hidden", UI.breakdown[state.by].note ? null : "");
    const population = filterProducts(products, predicates, BREAKDOWN_FILTER[state.by]).filter(isAuthorizedNow);
    renderBreakdown($("#breakdown"), breakdownCounts(population, state.by, breakdownLabel[state.by]), {
      isSelected: isBreakdownSelected,
      onToggle: toggleBreakdown,
    });
    const { excluded } = UI.breakdown[state.by];
    showCount("#breakdown-excluded", excluded ? breakdownExcluded(population, state.by) : 0, excluded);
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
    // The per-year chart and the over-time line ignore the approval-year filter and mark the range instead.
    const withoutDateFilter = filterProducts(products, predicates, "date");
    const filtered = predicates.date ? withoutDateFilter.filter(predicates.date) : withoutDateFilter;
    if (state.view === "now") renderNow(predicates, filtered, withoutDateFilter);
    else renderYears(withoutDateFilter);

    renderOverTime($("#over-time"), authorizedSeries(withoutDateFilter, seriesDates), state);
    const excluded = withoutDateFilter.filter((product) => product.series_exclusion === "ended_without_end_date");
    d3.select("#over-time-note").text(UI.overTime.excluded(excluded.length));

    const tableRows = state.view === "now"
      ? filtered.filter(isAuthorizedNow)
      : filtered.filter((product) => product.year !== null);
    const caption = state.view === "now" ? UI.table.captionNow(tableRows.length) : UI.table.captionYears(tableRows.length);
    table(newestFirst(tableRows), caption, register);
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

Promise.all(FIRST_FILES.map(loadFile)).then(startLookup, showMissingData);
