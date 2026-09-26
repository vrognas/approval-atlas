import * as d3 from "d3";
import { UI, statusLabel } from "./labels.js";

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

// "L01FA01" -> one line per level found in atc_classes (names verbatim), then the source.
function atcTitle(row, atcNames) {
  const lines = ATC_PREFIX_LENGTHS
    .filter((length) => length <= row.atc_code_human.length)
    .map((length) => row.atc_code_human.slice(0, length))
    .filter((prefix) => atcNames.has(prefix))
    .map((prefix) => `${prefix} ${atcNames.get(prefix)}`);
  if (row.atc_incomplete) lines.push(UI.table.incompleteTitle);
  return [...lines, UI.table.source(row.source)].join("\n");
}

function renderNameCell(cell, product) {
  // URLs come from third-party data; only link https so a javascript: URL can never become a link.
  if (!product.medicine_url?.startsWith("https://")) {
    cell.text(product.name_of_medicine);
    return;
  }
  cell.append("a")
    .attr("href", product.medicine_url)
    .attr("rel", "noopener noreferrer")
    .attr("target", "_blank")
    .text(product.name_of_medicine);
}

function renderAtcCell(cell, product, atcNames) {
  const codes = cell.selectAll("span.code").data(product.atc).join("span").attr("class", "code").attr("title", (row) => atcTitle(row, atcNames));
  codes.append("span").text((row) => row.atc_code_human);
  codes.filter((row) => row.atc_incomplete).append("span").attr("class", "flag").text(UI.table.incomplete);
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
      renderNameCell(d3.select(this), product);
    });
    rows.append("td").attr("class", "breakable").text((product) => (substanceIndex.get(product.ema_product_number) ?? []).join("; "));
    rows.append("td").text((product) => product.marketing_authorisation_developer_applicant_holder);
    rows.append("td").attr("class", "date").text((product) => product.authorized_from);
    rows.append("td").text((product) => statusLabel(product.medicine_status));
    rows.append("td").text((product) => product.medicine_type);
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

  // Rebuilds only when the rows or caption changed, so resizes keep the pages already shown.
  return function update(products, caption) {
    const unchanged = current !== null && current.caption === caption &&
      current.products.length === products.length && current.products.every((product, index) => product === products[index]);
    if (unchanged) return;
    current = { products, caption };
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
