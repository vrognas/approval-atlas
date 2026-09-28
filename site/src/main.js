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
import { areaBreakdownRows, areaExactLabel, buildAreaTree, inAreas, toggleArea } from "./areas.js";
import { atcChildren, atcClassesAt, atcCode, atcExactCounts, atcIncompleteAt, atcLevel, atcPrefixCounts, atcPrefixes, toggleAtcCode } from "./atc.js";
import { renderAtcPath } from "./atc-picker.js";
import { createAtcTree } from "./atc-tree.js";
import { atcHue, companySeriesColors, statusColor, statusTipId, typeTipId } from "./badges.js";
import { renderBreakdown } from "./breakdown.js";
import { renderChart, renderLegend, renderStackLegend, typeColor } from "./chart.js";
import { buildCompanies, companyBreakdownRows, matchesCompany, namesBehind, suggestCompanies, toggleCompany } from "./companies.js";
import { createCompanyTree, renderCompanyPath } from "./company-tree.js";
import { createFacetPanel } from "./facet-panel.js";
import {
  FACET_VALUES,
  OTHER_KEY,
  TYPE_ORDER,
  defaultSortDirection,
  facetCounts,
  holderActivity,
  keyCounts,
  nextSort,
  orderActivityColumns,
  sentenceParts,
  sortActivityRows,
  statusBreakdown,
  topAreas,
  topKeys,
  topWithOther,
  typeSplit,
  yearHistogram,
  yearStacks,
} from "./facets.js";
import { renderSentence } from "./filter-sentence.js";
import { filterProducts, makePredicates, splitAtcValues } from "./filters.js";
import { companyBadge, holderDisplay } from "./holders.js";
import { UI, atcClassLabel, atcName, statusLabel } from "./labels.js";
import { markExternal, openIcon } from "./links.js";
import { createLookup, headlineNodes } from "./lookup.js";
import { renderOverTime, renderOverTimeLegend } from "./over-time.js";
import { createSearchBox } from "./search-box.js";
import { buildLookupIndex, suggest, suggestAtcClasses } from "./search.js";
import { createSheet } from "./sheet.js";
import { createSidebarResize } from "./sidebar-resize.js";
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
  patchIsSet,
  scheduleUrlWrite,
  togglePatch,
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
  "ema_therapeutic_area_subtree.json",
  // Companies part 2: holders by company group (shared with the lookup's cards and search).
  "companies.json",
  "ema_medicine_companies.json",
];
// Loaded after the dashboard's first render; shared with the medicine card (same loadFile promise),
// as is the documents index (lookup.need("documents")).
const REGISTER_FILE = "ema_medicine_register_status.json";
// The filter each breakdown ignores and toggles.
const BREAKDOWN_FILTER = { atc: "atc", area: "area", mah: "mah" };
// The facet sidebar from this width; below it, the sentence's tokens open bottom sheets.
const DESKTOP = window.matchMedia("(min-width: 1024px)");
// Facet sections (index.html #facet-{key}) each sheet shows, the sheet each sentence token
// opens, and the filter keys each section sets. The year tokens have no sheet: they focus the
// approval-years strip's thumbs (YEAR_THUMBS), which is in the main column at every width.
const SHEET_SECTIONS = {
  type: ["type"],
  atc: ["atc"],
  mah: ["mah"],
  area: ["area"],
  status: ["status"],
  all: ["type", "atc", "area", "mah", "status"],
};
const TOKEN_SHEETS = { type: "type", atc: "atc", mah: "mah", area: "area", status: "status" };
const SECTION_KEYS = { type: ["type"], atc: ["atc"], mah: ["mah"], area: ["area"], status: ["status"] };
const YEAR_THUMBS = { from: "start", to: "end", year: "start", years: "start" };
// Desktop: the control each token focuses, the first one of its own section (the ATC, therapeutic
// area and company trees: their first checked row, else their search: facet-tree.js focusTarget()).
const TOKEN_TARGETS = {
  type: "#facet-type input",
  status: "#facet-status input",
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
// ones, then Other on top. Child classes: damped hue mids, neighbouring hues far apart (1px gaps
// separate the segments too); company groups: their own colours (badges.js companySeriesColors()).
// Level-1 ATC groups: the top six, each in its own group's hue. Other:
// the raised fill with a --field-border outline (3:1, palette.test.js), so it does not outweigh
// the named series.
const STACK_TOP = 8;
const STACK_ATC_GROUPS = 6;
const STACK_HUES = ["blue", "gold", "teal", "red", "indigo", "olive", "pink", "sky"];
const STACK_OTHER = { color: "var(--raised)", stroke: "var(--field-border)" };

const $ = (selector) => document.querySelector(selector);

// Desktop: the sidebar's width, the viewer's stored one set now, before the first render, so the
// layout does not jump. The charts wait for a drag's end to follow the new width (resizeObserver).
const sidebar = createSidebarResize($("#sidebar-resize"), { label: UI.sidebar.resize, hint: UI.sidebar.hint, onDragEnd: () => scheduleRender() });

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

// The tab's title names the view (a card, condition, search or drug class), so history, tabs and
// bookmarks tell them apart and screen readers hear the change (WCAG 2.4.2).
function updateTitle() {
  document.title = UI.pageTitle(lookupView(state).kind !== null ? lookup.title(state) : dashboard?.title() ?? null);
}

function render() {
  lookup.render(state);
  const lookupOpen = lookupView(state).kind !== null;
  $("#lookup-try").hidden = lookupOpen; // home state only
  $(".answer").hidden = lookupOpen; // the lookup result is the answer; one headline per screen
  // Below a lookup result, the dashboard is the overview of every medicine, under its own heading.
  $("#explore").hidden = !lookupOpen;
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
  // Companies part 2: the curated company groups ("As of 2026-09-28") and GLEIF's LEI data.
  d3.select("#credit-companies").text(UI.footer.companies(versionOf(/company groups/i)?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null));
}

// The type and status explanations as hidden elements, which describe the focusable carriers (facet
// rows, the sentence's type and status tokens) through aria-describedby (a hidden element still
// gives its text).
function renderTypeTips() {
  const container = d3.select("body").append("div").attr("hidden", "");
  for (const [label, tip] of Object.entries(UI.typeTips)) container.append("p").attr("id", typeTipId(label)).text(tip);
  for (const [status, tip] of Object.entries(UI.statusTips)) container.append("p").attr("id", statusTipId(status)).text(tip);
}

// The type and status tooltips (data-tip, style.css) are dismissible (WCAG 1.4.13): Escape hides
// them (and does nothing else, so the sidebar's Escape waits for the next press) until the pointer
// reaches another carrier or focus moves; a pointer click on a tip only hides it, as it lies over
// other controls. A carrier whose tip is anchored to its row (static: lookup rows, the sentence)
// puts the tip under its own line (--tip-top, CSSOM); a tip starting at its carrier that would
// cross the viewport's right edge (a status near the right of a phone) moves left (--tip-left).
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
    if (!carrier) return;
    if (getComputedStyle(carrier).position === "static") {
      carrier.style.setProperty("--tip-top", `${carrier.offsetTop + carrier.offsetHeight}px`);
      return;
    }
    carrier.style.removeProperty("--tip-left");
    // Its width once shown (a tip spanning its carrier, as on tiles and facet rows, never moves),
    // else the widest it can be (style.css max-width).
    const measured = parseFloat(getComputedStyle(carrier, "::after").width);
    const width = Number.isFinite(measured) ? measured : Math.min(16 * parseFloat(getComputedStyle(root).fontSize), root.clientWidth - 32);
    const overflow = carrier.getBoundingClientRect().left + width - (root.clientWidth - 16);
    if (overflow > 0) carrier.style.setProperty("--tip-left", `${-Math.ceil(overflow)}px`);
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

// Filled before any data loads, so it shows even when the data files are missing. The footer's
// links to other websites are marked as such (after their text is set).
function renderAbout() {
  d3.select("#about-summary").text(UI.about.summary);
  d3.select("#about-use").text(UI.about.intendedUse);
  d3.select("#about-privacy").text(UI.about.privacy);
  d3.select("#about-security").text(UI.about.security);
  for (const anchor of document.querySelectorAll('footer a[target="_blank"]')) markExternal(anchor);
}

// The colour tokens of both modes (style.css :root and its prefers-color-scheme: dark override),
// read once from the page's style sheets, so companySeriesColors() can keep the company stacks apart
// in either mode. Empty maps when the sheets cannot be read (the colours are then not compared).
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
      else if (rule.media?.mediaText.includes("prefers-color-scheme: dark")) {
        for (const inner of rule.cssRules) if (inner.selectorText === ":root") read(inner, dark);
      }
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
function suggestionGroups(result, classes, companies) {
  const copy = UI.lookup;
  const companyGroup = {
    key: "companies",
    label: copy.groups.companies,
    options: companies.map((row) => ({ label: row.name, meta: copy.companyMeta(row.synonym, row.authorized), value: row.key, named: row.named })),
  };
  const named = companies.some((row) => row.named);
  return [
    ...(named ? [companyGroup] : []),
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
    ...(named ? [] : [companyGroup]),
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
    companies: (value) => ({ co: value }), // the company page
  };
  const searchBox = createSearchBox(input, $("#lookup-listbox"), $("#lookup-status"), {
    suggestionsFor: (query) => {
      const atc = lookup.atcClasses();
      const companies = lookup.companies();
      return suggestionGroups(
        suggest(index, lookup.conditions(), query),
        atc ? suggestAtcClasses(query, atc.classes, atc.counts) : [],
        companies ? suggestCompanies(companies, query) : [],
      );
    },
    onPick: (group, value) => navigate(PICKS[group](value)),
    onSubmit: (text) => navigate({ q: text }),
  });
  // Conditions, drug classes and companies join the suggestions once their background data has
  // loaded (and a condition or company page's title its name).
  lookup.onData((name) => {
    if (["conditions", "atc", "atcCounts", "companies"].includes(name)) searchBox.refresh();
    if (name === "conditions" || name === "companies") updateTitle();
  });
  // The wordmark opens the overview: every lookup and filter cleared, one history entry.
  $("#home-link").addEventListener("click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    searchBox.setText("");
    navigate(structuredClone(DEFAULT_STATE));
  });
  d3.select("#explore-title").text(UI.explore.title);
  d3.select("#explore-note").text(UI.explore.note);
  for (const name of ["conditions", "atc", "atcCounts", "companies"]) lookup.need(name);

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

function startDashboard(meta, [medicines, areaRows, substanceRows, atcRows, atcClasses, branchRows, seriesRows, subtreeRows, companyRows, medicineCompanyRows]) {
  // The therapeutic area tree (phase 4f): MeSH branch › level 2 › level 3 › EMA's terms.
  const meshTree = buildAreaTree(branchRows, subtreeRows);
  // Companies part 2: company groups › companies › EMA holder names.
  const companies = buildCompanies(companyRows, medicineCompanyRows);
  const products = buildProducts(medicines, { areaRows, branchRows, atcRows, companyRows: medicineCompanyRows, areaTree: meshTree });
  const seriesDates = seriesRows.map((row) => row.date);
  const approvalYears = d3.extent(products, (product) => product.year);
  const atcNames = new Map(atcClasses.map((row) => [row.atc_code, row.name]));
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
  // A small icon link to a condition page (ui: its descriptor) after a row: sidebar area rows,
  // therapeutic area group bars. name: the condition, for its accessible name and tooltip.
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
  };

  renderOverTimeLegend($("#over-time-legend"));

  // Every filter key reset to its default (the sentence's remove buttons, Clear, Reset).
  const cleared = (keys) => Object.fromEntries(keys.map((key) => [key, structuredClone(DEFAULT_STATE[key])]));
  // A therapeutic area's condition page: a term's descriptor, else (branches and tree nodes) the
  // descriptor of that name, known once the lookup's conditions data has loaded; null otherwise.
  const areaDescriptor = (key) => (meshTree.isTerm(key) ? descriptorOf.get(key) : lookup.conditions()?.uiByName.get(meshTree.name(key))) ?? null;
  // Tree rows link to their condition page; followed from a sheet, the sheet closes (the page's
  // heading takes focus, not the token that opened the sheet).
  const areaRowLink = (key) => {
    const ui = areaDescriptor(key);
    if (!ui) return null;
    const link = conditionIconLink(ui, meshTree.name(key));
    link.addEventListener("click", (event) => {
      if (event.defaultPrevented) sheet.close({ restoreFocus: false }); // a plain click: opened here
    });
    return link;
  };
  const facetPanel = createFacetPanel($("#facets"), { onChange: (patch) => setState(patch) });
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
  // Therapeutic areas (phase 4f): the tree adds or removes one area (toggleArea()); drill-downs,
  // paths and "Up one level" show one area alone (none: all). A term that is a node is that node
  // (canonical()), wherever it is picked.
  const toggleAreaKey = (key) => setState({ area: toggleArea(meshTree, state.area, key) });
  const openArea = (key) => setState({ area: key === null ? [] : meshTree.canonical(key) });
  // Exactly one area selected: the area the breakdown drills into and the activity card splits.
  const drillArea = () => (state.area.length === 1 && meshTree.has(state.area[0]) ? state.area[0] : null);
  const areaFacet = createAreaTree($("#facet-area"), { tree: meshTree, onToggle: toggleAreaKey, linkOf: areaRowLink });
  // Companies (companies part 2): the tree adds or removes one value (toggleCompany()); drill-downs,
  // paths and "Up one level" show one value alone (none: all), as the tree selects it (canonical()).
  const toggleCompanyValue = (value) => setState({ mah: toggleCompany(companies, state.mah, value) });
  const openCompany = (value) => setState({ mah: value === null ? [] : companies.canonical(value) });
  // Exactly one company value selected: the value the company breakdown drills into.
  const drillCompany = () => (state.mah.length === 1 && companies.has(state.mah[0]) ? state.mah[0] : null);
  // Tree rows link to their company page; followed from a sheet, the sheet closes (as area rows).
  const companyRowLink = (value) => {
    const link = companyIconLink(value);
    link.addEventListener("click", (event) => {
      if (event.defaultPrevented) sheet.close({ restoreFocus: false });
    });
    return link;
  };
  const companyFacet = createCompanyTree($("#facet-mah"), { companies, onToggle: toggleCompanyValue, linkOf: companyRowLink });
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
      const trees = { atc: atcTree, area: areaFacet, mah: companyFacet };
      const target = (trees[key] ? trees[key].focusTarget() : $(TOKEN_TARGETS[key])) ?? sections[0];
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
  $("#activity-by").setAttribute("aria-label", UI.activity.modesLabel);
  d3.select("#activity-title").text(UI.activity.title);
  d3.select("#activity-note").text(UI.activity.note(companies.asOf));
  d3.select("#activity-order-label").text(UI.activity.order.label);
  d3.selectAll("#activity-order button").on("click", (event) => {
    activityOrder[activityMode] = nextSort(activityOrder[activityMode], event.currentTarget.dataset.order);
    scheduleRender();
  });
  // A segmented sort button (key: its data-sort / data-order value; current: the sort in force):
  // its text, then an arrow for the order in force, else for the order it starts in; pressed, its
  // name says that order.
  function renderSortButton(button, text, key, current) {
    const pressed = current.key === key;
    const direction = pressed ? current.direction : defaultSortDirection(key);
    const node = d3.select(button)
      .text(text)
      .attr("aria-pressed", String(pressed))
      .attr("aria-label", pressed ? UI.sortOrder.name(text, key, direction) : null);
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

  const table = createTable($("#medicines-table"), $("#table-more"), $("#table-caption"), {
    substanceIndex: buildSubstanceIndex(substanceRows),
    atcNames,
    atcRetiredYears,
    branchNamesByTerm,
    // Names open the medicine card (EMA's page is linked from there), terms their condition page,
    // company groups their company page.
    medicineLink: (product) => lookup.link(product.name_of_medicine, { med: product.ema_product_number }, "medicine-name"),
    conditionLink,
    holderOf,
    // A segment adds its class to the ATC filter; pressed again, it removes it.
    onAtcSelect: toggleAtc,
    focusFallback: focusAtcFilter,
  });

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

  // The answer headline counts the medicines matching the filters (every status) and those
  // currently authorized; with exactly one ATC code, or one therapeutic area (phase 4g), and no
  // other filter it names the class or area, with its levels below. The dek: the medicines by status
  // (the authorized ones without an approval date named, as the headline leaves them out), then
  // substances and types. areaCounts: medicines per area key matching every filter but the area one.
  function renderHeadline(predicates, filtered, atcCounts, areaCounts, undatedAuthorized) {
    const authorized = filtered.filter(isAuthorizedNow).length;
    const activeCount = Object.keys(predicates).length;
    const classCode = activeCount === 1 ? drillCode() : null;
    const areaKey = activeCount === 1 ? drillArea() : null;
    classTitle = classCode ? atcClassLabel(classCode, atcNames.get(classCode)) : null;
    let parts;
    if (classCode) parts = UI.headline.atcClass(filtered.length, authorized, atcClassLabel(classCode, atcNames.get(classCode)));
    else if (areaKey) parts = UI.headline.area(filtered.length, authorized, meshTree.name(areaKey), meshTree.isRootTag(areaKey));
    else if (activeCount) parts = UI.headline.filtered(filtered.length, authorized);
    else parts = UI.headline.home(filtered.length, authorized);
    $("#headline").replaceChildren(...headlineNodes(parts));
    d3.select("#headline-dek").text([UI.headline.statuses(statusBreakdown(filtered), undatedAuthorized), UI.headline.dek(countTiles(filtered))].filter(Boolean).join(" "));
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
  // itself. Otherwise the MeSH branches; with several areas selected, the branches holding one are
  // marked (toggles: a marked branch removes its areas, another is added). population: every
  // filter but the area one.
  function areaBreakdown(population) {
    const current = drillArea();
    const rows = areaBreakdownRows(meshTree, current, population);
    if (current === null) {
      const selected = state.area;
      const under = (branch) => selected.filter((value) => value === branch || meshTree.ancestors(value).has(branch));
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
        if (by === "area") openArea(meshTree.parent(current));
        else if (by === "mah") openCompany(companies.parentOf(current));
        else openAtc(atcPrefixes(current).at(-2) ?? null);
      });
    const path = container.appendChild(document.createElement("div"));
    if (by === "area") renderAreaPath(path, { tree: meshTree, current, onSelect: openArea });
    else if (by === "mah") renderCompanyPath(path, { companies, current, onSelect: openCompany });
    else renderAtcPath(path, { current, names: atcNames, onSelect: openAtc, label: UI.atc.path });
    if (focused !== undefined) container.querySelector(`[data-focus-key="${CSS.escape(focused)}"]`)?.focus();
  }

  // Always shown (phase 4c; it used to show only with a filter): the therapeutic areas of the
  // medicines shown, as links to their condition page where the MeSH descriptor is known, with a
  // hint that the pages exist; a line instead when none of the medicines has one. With a therapeutic
  // area filter, only the terms within it (phase 4f). Rebuilt on every render: a focused link keeps
  // its focus.
  function renderConditions(filtered, anyFilter) {
    const within = state.area.length ? (term) => inAreas(meshTree, state.area, term) : null;
    const rows = topAreas(filtered, descriptorOf, 8, within);
    d3.select("#conditions-title").text(UI.conditions.title);
    d3.select("#conditions-subtitle").text(UI.conditions.subtitle(filtered.length, anyFilter, within !== null));
    d3.select("#conditions-hint").text(rows.some((row) => row.descriptorUi) ? UI.conditions.hint : "");
    d3.select("#conditions-empty").text(rows.length ? "" : UI.conditions.empty(filtered.length));
    const list = d3.select("#conditions-list").attr("hidden", rows.length ? null : "");
    const focused = list.node().contains(document.activeElement) ? document.activeElement.textContent : null;
    list.selectChildren().remove();
    for (const row of rows) {
      const item = list.append("li");
      if (row.descriptorUi) item.append(() => lookup.link(row.term, { cond: row.descriptorUi }));
      else item.append("span").text(row.term);
      item.append("span").attr("class", "bar-track").attr("aria-hidden", "true")
        .append("span").attr("class", "bar-fill").style("width", `${(100 * row.count) / rows[0].count}%`);
      const value = item.append("span").attr("class", "bar-value");
      value.append("span").text(d3.format(",")(row.count));
      value.append("span").attr("class", "bar-authorized").text(UI.conditions.authorized(row.authorized));
    }
    if (focused !== null) [...list.node().querySelectorAll("a")].find((link) => link.textContent === focused)?.focus();
  }

  // The breakdown card over every matching medicine: ATC (stacked by type), areas or holders.
  function renderBreakdownCard(predicates, withoutAtcFilter, atcCounts, atcExact, atcIncomplete) {
    d3.selectAll("#breakdown-by button").attr("aria-pressed", function pressed() {
      return String(this.dataset.by === state.by);
    });
    d3.selectAll("#breakdown-sort button").each(function sortButton() {
      const { sort } = this.dataset;
      renderSortButton(this, sort === "count" ? UI.breakdown.sort.count : UI.breakdown.sort.key[state.by], sort, breakdownSort);
    });
    const card = $("#breakdown").closest(".chart-card");
    const hadFocus = card.contains(document.activeElement);
    const atcTypes = state.by === "atc"
      ? {
        prefix: typeSplit(withoutAtcFilter, (product) => product.atc.flatMap((row) => atcPrefixes(atcCode(row)))),
        exact: typeSplit(withoutAtcFilter, (product) => product.atc.map(atcCode).filter(atcLevel)),
      }
      : null;
    const atc = atcTypes ? atcBreakdown(atcCounts, atcExact, atcTypes, atcIncomplete) : null;
    const population = filterProducts(products, predicates, BREAKDOWN_FILTER[state.by]);
    // Every mode drills down (a tree each: ATC classes, therapeutic areas, companies).
    const tree = atc ?? (state.by === "area" ? areaBreakdown(population) : companyBreakdown(population));
    d3.select("#breakdown-title").text(tree.title);
    d3.select("#breakdown-note").text(UI.breakdown[state.by].note).attr("hidden", UI.breakdown[state.by].note ? null : "");
    // One legend per card: the medicine types the stacked ATC bars show.
    const legendTypes = TYPE_ORDER.filter((type) => atc?.rows.some((row) => row.segments.some((segment) => segment.type === type)));
    renderLegend($("#breakdown-legend"), legendTypes);
    $("#breakdown-legend").hidden = legendTypes.length === 0;
    renderBreakdownPath(state.by, tree.current);
    const rows = sortBreakdownRows(tree.rows, breakdownSort.key, state.by, breakdownSort.direction);
    let options = { isSelected: tree.isSelected, onToggle: tree.onToggle, linkOf: areaLink };
    if (atc) options = { isSelected: atc.isSelected, onToggle: atc.onToggle, badgeOf: (row) => ({ text: row.key, hue: atcHue(row.key), level: atcLevel(row.key) }) };
    // Company groups carry their monogram badge; groups and companies link to their page.
    else if (state.by === "mah") {
      options = {
        isSelected: tree.isSelected,
        onToggle: tree.onToggle,
        badgeOf: (row) => (!row.incomplete && companies.kind(row.key) === "group" ? { element: () => companyBadge(companies.row(row.key)) } : null),
        linkOf: (row) => (row.incomplete || companies.pageOf(row.key) === null ? null : companyIconLink(companies.pageOf(row.key))),
      };
    }
    renderBreakdown($("#breakdown"), rows, options);
    const { excluded } = UI.breakdown[state.by];
    // Products without any ATC code, therapeutic area or holder matter at the top level only.
    showCount("#breakdown-excluded", excluded && !tree.current ? breakdownExcluded(population, state.by) : 0, excluded);
    // Drilling down or going up rebuilds the controls: keep focus in the card.
    if (hadFocus && !card.contains(document.activeElement)) (card.querySelector("#breakdown button") ?? card.querySelector("#breakdown-path button"))?.focus();
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
        parentClass = { key: parent, badge: parent, label: atcClassLabel(parent, name), name: atcName(name), filter: { atc: [parent] } };
      }
      // A product's classes at the column level (the leaf itself when parent is level 5).
      keysOf = (product) => atcClassesAt(product, parent);
      columns = [...keyCounts(filtered, keysOf).keys()].map((code) => ({
        key: code, badge: code, label: atcClassLabel(code, atcNames.get(code)), title: atcClassLabel(code, atcNames.get(code)), filter: { atc: [code] },
      }));
    } else {
      // The MeSH branches, or with one area selected (drillArea()) the areas one level below it, a
      // leaf itself; that area is a toggle above the table (phase 4f, as the ATC classes).
      const parent = drillArea();
      if (parent !== null) {
        const name = meshTree.label(parent);
        parentClass = { key: parent, badge: null, label: name, name, lead: UI.activity.parentLeadArea, filter: { area: [parent] } };
      }
      const children = parent === null ? meshTree.roots : meshTree.children(parent);
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
  // the legend entry's explanation }] bottom to top), by (the summary's phrase), counting (the
  // note's) and unstacked (the dated medicines no stack holds: without an ATC class at the level
  // shown; "" when none). dated: the medicines shown.
  function yearStackSpec(dated) {
    if (stackMode === "type") {
      return {
        keysOf: (product) => [product.medicine_type],
        series: MEDICINE_TYPES.map((type) => ({ key: type, label: type, color: typeColor(type) })),
        by: UI.years.by.type,
        counting: UI.years.counting.type,
        unstacked: "",
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
        unstacked: "",
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
    // Company groups (companies part 2): each in its group's colour, or, too near a colour already
    // in the chart in either mode, its text shade or the nearest other hue (companySeriesColors()),
    // with its badge and, as the legend's
    // explanation, the EMA holder names behind it.
    if (stackMode === "mah") {
      const groupOf = (product) => (product.group_key ? [product.group_key] : []);
      const top = topWithOther(dated, groupOf, STACK_TOP);
      const colors = companySeriesColors(top.keys.filter((key) => key !== OTHER_KEY), readPalette());
      const series = topSeries(top.keys, (key) => colors.get(key), companies.name, UI.years.other.mah).map((item) => {
        if (item.key === OTHER_KEY) return item;
        const names = namesBehind(item.label, dated.filter((product) => product.group_key === item.key));
        return { ...item, badge: companies.row(item.key), tip: names.length ? UI.companies.named(item.label, names) : null };
      });
      const missing = dated.filter((product) => groupOf(product).length === 0).length;
      return {
        keysOf: top.keysOf,
        series,
        by: UI.years.by.mah,
        counting: UI.years.counting.mah(...counted(top.keys)),
        unstacked: missing ? UI.breakdown.mah.excluded(missing) : "",
      };
    }
    const parent = drillCode();
    const classesOf = (product) => atcClassesAt(product, parent);
    const missing = dated.filter((product) => classesOf(product).length === 0).length;
    const unstacked = missing === 0 ? "" : parent === null ? UI.breakdown.atc.excluded(missing) : UI.years.onlyCoded(missing, parent);
    const label = (code) => atcClassLabel(code, atcNames.get(code));
    // Level-1 groups: the top STACK_ATC_GROUPS (14 neighbouring hues could not be told apart).
    const top = topWithOther(dated, classesOf, parent === null ? STACK_ATC_GROUPS : STACK_TOP);
    const keys = [...top.keys.filter((key) => key !== OTHER_KEY).sort(), ...top.keys.filter((key) => key === OTHER_KEY)];
    const colorOf = parent === null ? (code) => `var(--${atcHue(code)}-mid)` : (code, index) => `var(--${STACK_HUES[index]}-mid)`;
    return {
      keysOf: top.keysOf,
      series: topSeries(keys, colorOf, label, UI.years.other.atc),
      by: parent === null ? UI.years.by.atc : UI.years.by.atcIn(label(parent)),
      counting: UI.years.counting.atc(...counted(keys)),
      unstacked,
    };
  }

  function renderYears(withoutDateFilter) {
    d3.selectAll("#chart-stack button").attr("aria-pressed", function pressed() {
      return String(this.dataset.stack === stackMode);
    });
    const dated = withoutDateFilter.filter((product) => product.year !== null);
    const stack = yearStackSpec(dated);
    const rows = yearStacks(dated, stack.keysOf, approvalYears);
    renderChart($("#chart"), { rows, series: stack.series, by: stack.by }, state, (range) => {
      keepInPlace($("#chart"));
      setState(range);
    }, ({ from, to }) => showReadout(from, to));
    renderStackLegend($("#legend"), stack.series);
    d3.select("#chart-note").text(UI.years.note(stack.counting));
    // By status, the note names the statuses the chart cannot show.
    const undated = withoutDateFilter.length - dated.length;
    d3.select("#undated-note").text(stackMode === "status"
      ? (undated ? UI.years.undatedStatuses(undated, state.from !== null || state.to !== null) : "")
      : UI.years.undated(undated));
    d3.select("#unstacked-note").text(stack.unstacked);
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
    showReadout(state.from ?? approvalYears[0], state.to ?? approvalYears[1]);

    const predicates = makePredicates(state, atcClasses);
    const activeCount = Object.keys(predicates).length;
    safely($("#facets"), () => facetPanel.render({
      state,
      counts: Object.fromEntries(FACETS.map((dimension) => [dimension, facetCounts(products, predicates, dimension, FACET_VALUES[dimension])])),
      activeCount,
    }));
    // The per-year chart, the strip and the over-time line ignore the approval-year filter and
    // mark the range instead.
    const withoutDateFilter = filterProducts(products, predicates, "date");
    safely($("#year-strip"), () => yearStrip.render({ rows: yearHistogram(products, predicates, approvalYears), from: state.from, to: state.to }));
    safely($(".sentence-row"), () => renderSentence($("#filter-sentence"), sentenceParts(state, { years: approvalYears, areaNames: meshTree.labels, atcNames, mahName: companies.label, mahSelection: companies.selectionName }), {
      anyActive: activeCount > 0,
      sheetOf: (key) => TOKEN_SHEETS[key],
      popup: !DESKTOP.matches,
      onOpen: openFilters,
      // One of two ATC pills removes its class only.
      onRemove: (token) => setState(token.value === undefined ? cleared(token.clears) : { atc: state.atc.filter((value) => value !== token.value) }),
      onReset: () => setState(cleared(FILTER_KEYS)),
    }));
    // ATC counts per prefix (and per exact code, for the products coded only down to an
    // incomplete level) of the medicines matching every other filter: tree, breakdown, class path.
    const withoutAtcFilter = filterProducts(products, predicates, "atc");
    const atcCounts = atcPrefixCounts(withoutAtcFilter);
    const atcExact = atcExactCounts(withoutAtcFilter);
    const atcIncomplete = atcIncompleteAt(withoutAtcFilter);
    const { codes: atcCodes, names: atcQueries } = atcSelection();
    safely($("#facet-atc"), () => atcTree.render({ selected: atcCodes, names: atcQueries, counts: atcCounts, exact: atcExact, incompleteAt: atcIncomplete, classNames: atcNames }));
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

    const filtered = predicates.date ? withoutDateFilter.filter(predicates.date) : withoutDateFilter;
    const authorizedNow = filtered.filter(isAuthorizedNow);
    sheet.update(filtered.length);
    const undatedAuthorized = filtered.filter((product) => product.medicine_status === "Authorised" && product.authorized_from === null);
    safely($(".answer"), () => renderHeadline(predicates, filtered, atcCounts, areaCounts, undatedAuthorized.length));
    safely($(".tiles-frame"), () => renderTiles($("#tiles"), { ...countTiles(filtered), authorized: authorizedNow.length }, activeCount > 0));
    showCount("#register-note", authorizedNow.filter(registerDiffers).length, UI.register.notAuthorized);
    showCount("#undated-authorized", undatedAuthorized.length, UI.undatedAuthorized);
    safely(cardOf("#breakdown"), () => renderBreakdownCard(predicates, withoutAtcFilter, atcCounts, atcExact, atcIncomplete));
    safely(cardOf("#activity-table"), () => renderActivityCard(filtered));
    safely(cardOf("#chart"), () => renderYears(withoutDateFilter));
    safely(cardOf("#conditions-list"), () => renderConditions(filtered, activeCount > 0));

    safely(cardOf("#over-time"), () => {
      renderOverTime($("#over-time"), authorizedSeries(withoutDateFilter, seriesDates), state);
      const excluded = withoutDateFilter.filter((product) => product.series_exclusion === "ended_without_end_date");
      d3.select("#over-time-note").text(UI.overTime.excluded(excluded.length));
    });

    const undated = filtered.filter((product) => product.year === null).length;
    safely(cardOf("#medicines-table"), () => table(newestFirst(filtered), UI.table.caption(filtered.length, undated), register, atcSelection().codes, lookup.documents()));
  }

  dashboard = { domain, render: renderDashboard, title: () => classTitle };
  applyUrl();
  scheduleUrlWrite(state); // canonical form, invalid values removed
  d3.select("#app-loading").attr("hidden", "");
  d3.select("#app").attr("hidden", null);
  d3.select("#facets").attr("hidden", null);
  d3.select("#sidebar-resize").attr("hidden", null);
  // The charts follow their width; while the sidebar is dragged they wait for its release (a
  // render per frame would stutter the drag).
  const resizeObserver = new ResizeObserver(() => {
    if (!sidebar.dragging()) scheduleRender();
  });
  for (const selector of ["#chart", "#over-time", "#year-hist"]) resizeObserver.observe($(selector));
  render();
  loadFile(REGISTER_FILE).then((rows) => {
    register = new Map(rows.map((row) => [row.ema_product_number, row]));
    scheduleRender();
  }, () => {});
  // The table's PI and EPAR links: the documents index (~5 MB, shared with the cards) in the
  // background; the therapeutic area groups' condition page links: the conditions data.
  lookup.onData((name) => {
    if (name === "documents" || name === "conditions") scheduleRender();
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
