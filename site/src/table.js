import * as d3 from "d3";
import { atcHue, atcSegments, typeBadges } from "./badges.js";
import { UI, atcLevelOneLabel, statusDateLine, statusKind, statusLabel } from "./labels.js";

const PAGE_SIZE = 100;
const ATC_PREFIX_LENGTHS = [1, 3, 4, 5, 7];
const HEADERS = UI.table.headers;

function hasIndication(product) {
  return product.therapeutic_indication !== null;
}

function indicationRowId(product) {
  return `indication-${product.ema_product_number}`;
}

function toggleIndication(event, product) {
  const expanded = this.getAttribute("aria-expanded") !== "true";
  d3.select(this).attr("aria-expanded", expanded).text(expanded ? UI.table.hide : UI.table.show);
  d3.select(document.getElementById(indicationRowId(product))).attr("hidden", expanded ? null : "");
}

// "L01FA01" -> one name per level found in atc_classes (level 1 in title case, the others verbatim).
function atcLevelNames(row, atcNames) {
  return ATC_PREFIX_LENGTHS
    .filter((length) => length <= row.atc_code_human.length)
    .map((length) => row.atc_code_human.slice(0, length))
    .filter((prefix) => atcNames.has(prefix))
    .map((prefix) => (prefix.length === 1 ? atcLevelOneLabel(prefix, atcNames.get(prefix)) : `${prefix} ${atcNames.get(prefix)}`));
}

// Tooltip: the level names one per line, then the source.
function atcTitle(row, atcNames) {
  const lines = atcLevelNames(row, atcNames);
  if (row.atc_incomplete) lines.push(UI.table.incompleteTitle);
  return [...lines, UI.table.source(row.source)].join("\n");
}

// Name link, then the active substance(s) in secondary text.
function renderNameCell(cell, product, substances) {
  // URLs come from third-party data; only link https so a javascript: URL can never become a link.
  if (product.medicine_url?.startsWith("https://")) {
    cell.append("a")
      .attr("class", "medicine-name")
      .attr("href", product.medicine_url)
      .attr("rel", "noopener noreferrer")
      .attr("target", "_blank")
      .text(product.name_of_medicine);
  } else {
    cell.append("span").attr("class", "medicine-name").text(product.name_of_medicine);
  }
  if (substances.length) cell.append("span").attr("class", "medicine-substances").text(substances.join("; "));
}

// Segmented ATC badge (display only in this phase): one segment per level, in the group's hue.
function appendAtcBadge(parent, code) {
  const badge = parent.append("span").attr("class", `atc-badge hue-${atcHue(code)}`);
  badge.selectAll("span")
    .data(atcSegments(code))
    .join("span")
    .attr("class", (segment) => (segment.level ? `atc-seg level-${segment.level}` : "atc-seg"))
    .text((segment) => segment.text);
  return badge;
}

function renderAtcCell(cell, product, atcNames) {
  const codes = cell.selectAll("span.code").data(product.atc).join("span").attr("class", "code").attr("title", (row) => atcTitle(row, atcNames));
  codes.each(function badge(row) {
    const code = d3.select(this);
    appendAtcBadge(code, row.atc_code_human);
    // The tooltip is out of reach for keyboard, touch and screen-reader users; phase 2 names the segments.
    const names = atcLevelNames(row, atcNames);
    if (names.length) code.append("span").attr("class", "visually-hidden").text(` (${names.join("; ")})`);
  });
  codes.filter((row) => row.atc_incomplete).append("span").attr("class", "flag").text(UI.table.incomplete);
}

function renderTypeCell(cell, product) {
  const badges = typeBadges(product);
  if (!badges.length) return;
  cell.append("span")
    .attr("class", "badges")
    .selectAll("span")
    .data(badges)
    .join("span")
    .attr("class", (badge) => `badge hue-${badge.hue}`)
    .text((badge) => badge.label);
}

// Merged "Approved · Status": dot and status label, then the date line. Union Register
// disagreement: a visible marker, the full text as tooltip and for screen readers.
function renderStatusCell(cell, product, register) {
  cell.append("span").attr("class", `status status-${statusKind(product.medicine_status)}`).text(statusLabel(product.medicine_status));
  const dates = statusDateLine(product.medicine_status, product.authorized_from, product.authorized_until);
  if (dates) cell.append("span").attr("class", "status-date").text(dates);
  const row = register?.get(product.ema_product_number);
  if (row?.agrees_with_ema !== false) return;
  const text = `${UI.register.chip(row.register_status, row.register_last_decision_date)}. ${UI.register.note}`;
  const flag = cell.append("span").attr("class", "flag register-flag").attr("title", text);
  flag.append("span").attr("aria-hidden", "true").text(UI.register.marker);
  flag.append("span").attr("class", "visually-hidden").text(text);
}

function renderAreaCell(cell, product, branchNamesByTerm) {
  cell.selectAll("span.term")
    .data(product.areas)
    .join("span")
    .attr("class", "term")
    .attr("title", (term) => (branchNamesByTerm.get(term) ?? []).join("\n") || UI.table.noBranch)
    .text((term, index) => (index < product.areas.length - 1 ? `${term}; ` : term));
}

// lookups: substanceIndex (product -> EMA active substances), atcNames (code -> name),
// branchNamesByTerm (MeSH term -> branch names).
// All text goes through .text(): decoded indications contain literal "<" and ">".
export function createTable(table, moreButton, { substanceIndex, atcNames, branchNamesByTerm }) {
  let current = null;
  let shown = 0;

  // One tbody per medicine keeps its full-width indication row directly beneath it.
  function appendRows(products) {
    const groups = d3.select(table).selectAll(null).data(products).enter().append("tbody");
    const rows = groups.append("tr");
    rows.append("td").attr("class", "breakable").each(function nameCell(product) {
      renderNameCell(d3.select(this), product, substanceIndex.get(product.ema_product_number) ?? []);
    });
    rows.append("td").text((product) => product.marketing_authorisation_developer_applicant_holder);
    rows.append("td").attr("class", "status-cell").each(function statusCell(product) {
      renderStatusCell(d3.select(this), product, current.register);
    });
    rows.append("td").each(function typeCell(product) {
      renderTypeCell(d3.select(this), product);
    });
    rows.append("td").attr("class", "atc").each(function atcCell(product) {
      renderAtcCell(d3.select(this), product, atcNames);
    });
    rows.append("td").attr("class", "area").each(function areaCell(product) {
      renderAreaCell(d3.select(this), product, branchNamesByTerm);
    });
    rows.append("td")
      .filter(hasIndication)
      .append("button")
      .attr("type", "button")
      .attr("class", "toggle")
      .attr("aria-expanded", "false")
      .attr("aria-controls", indicationRowId)
      .text(UI.table.show)
      .on("click", toggleIndication);
    groups.filter(hasIndication)
      .append("tr")
      .attr("class", "indication")
      .attr("id", indicationRowId)
      .attr("hidden", "")
      .append("td")
      .attr("colspan", HEADERS.length)
      .text((product) => product.therapeutic_indication);
  }

  function showMore() {
    const next = current.products.slice(shown, shown + PAGE_SIZE);
    appendRows(next);
    shown += next.length;
    const remaining = current.products.length - shown;
    d3.select(moreButton)
      .attr("hidden", remaining > 0 ? null : "")
      .text(UI.table.showMore(Math.min(PAGE_SIZE, remaining), current.products.length));
  }

  d3.select(moreButton).on("click", showMore);

  // Rebuilds only when the rows, caption or register (ema_medicine_register_status.json rows by
  // product, null until loaded) changed, so resizes keep the pages already shown.
  return function update(products, caption, register) {
    const unchanged = current !== null && current.caption === caption && current.register === register &&
      current.products.length === products.length && current.products.every((product, index) => product === products[index]);
    if (unchanged) return;
    current = { products, caption, register };
    shown = 0;
    const root = d3.select(table);
    root.selectChildren().remove();
    root.append("caption").text(caption);
    root.append("thead").append("tr")
      .selectAll("th")
      .data(HEADERS)
      .join("th")
      .attr("scope", "col")
      .text((header) => header);
    showMore();
  };
}
