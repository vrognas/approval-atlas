import * as d3 from "d3";
import { atcCode, atcOrigin, atcPrefixes, atcRowIncomplete } from "./atc.js";
import { atcHue, atcSegments, statusHue, typeBadges } from "./badges.js";
import { quickDocuments } from "./documents.js";
import { UI, atcClassLabel, atcOriginFlag, atcOriginText, statusDateLine, statusLabel, statusTipText } from "./labels.js";
import { documentLinks } from "./lookup.js";

const PAGE_SIZE = 100;
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
  return atcPrefixes(atcCode(row))
    .filter((prefix) => atcNames.has(prefix))
    .map((prefix) => atcClassLabel(prefix, atcNames.get(prefix)));
}

// Tooltip: the level names one per line, how the code differs from EMA's, then the source.
function atcTitle(row, atcNames, retiredYears) {
  const lines = atcLevelNames(row, atcNames);
  if (atcRowIncomplete(row)) lines.push(UI.table.incompleteTitle);
  const origin = atcOriginText(atcOrigin(row), atcNames, retiredYears);
  if (origin) lines.push(origin);
  return [...lines, UI.table.source(row.atc_code_source ?? row.source)].join("\n");
}

// The PI and EPAR links under the name (for its EMA status: quickDocuments()), replaced when the
// documents index (rows by product; null until loaded) arrives.
function renderDocumentLinks(cell, product, documents) {
  cell.select(".doc-links").remove();
  const rows = documents?.get(product.ema_product_number) ?? [];
  const links = documents ? documentLinks(product.name_of_medicine, quickDocuments(rows, product.medicine_status)) : null;
  if (links) cell.append(() => links);
}

// The name (a link to its medicine card: medicineLink()), then the active substance(s) in
// secondary text, then the PI and EPAR links.
function renderNameCell(cell, product, substances, documents, medicineLink) {
  cell.append(() => medicineLink(product));
  if (substances.length) cell.append("span").attr("class", "medicine-substances").text(substances.join("; "));
  renderDocumentLinks(cell, product, documents);
}

// Segmented ATC badge in the group's hue: one button per level that filters by that prefix; a
// malformed code stays one plain segment. No whitespace between segments: copied, the badge
// reads as the plain code. The buttons form a toolbar with one tab stop (markPressed(); arrow
// keys move between them).
function appendAtcBadge(parent, code, atcNames) {
  const segments = atcSegments(code);
  const badge = parent.append("span").attr("class", `atc-badge hue-${atcHue(code)}`);
  if (segments.some((segment) => segment.level)) badge.attr("role", "toolbar").attr("aria-label", UI.atc.toolbar(code));
  badge.selectAll(".atc-seg")
    .data(segments)
    .join((enter) => enter.append((segment) => document.createElement(segment.level ? "button" : "span")))
    .attr("class", (segment) => (segment.level ? `atc-seg level-${segment.level}` : "atc-seg"))
    .text((segment) => segment.text)
    .filter((segment) => segment.level)
    .attr("type", "button")
    .attr("data-code", (segment) => segment.code)
    .attr("aria-label", (segment) => UI.atc.filterBy(segment.level, segment.code, atcNames.get(segment.code)));
  return badge;
}

// One badge per code to use (atcCode(); rows without one are skipped), flagged when incomplete
// (atcRowIncomplete(): atc_final_level, so B03AC is not; phase 4e) or
// when it differs from EMA's published code (atcOrigin(): a short flag, the sentence as tooltip and
// for screen readers).
function renderAtcCell(cell, product, atcNames, retiredYears) {
  const rows = product.atc.filter((row) => atcCode(row) !== null);
  const codes = cell.selectAll("span.code").data(rows).join("span").attr("class", "code").attr("title", (row) => atcTitle(row, atcNames, retiredYears));
  codes.each(function badge(row) {
    const code = d3.select(this);
    appendAtcBadge(code, atcCode(row), atcNames);
    // The tooltip is out of reach for keyboard, touch and screen-reader users.
    const names = atcLevelNames(row, atcNames);
    if (names.length) code.append("span").attr("class", "visually-hidden").text(` (${names.join("; ")})`);
    if (atcRowIncomplete(row)) code.append("span").attr("class", "flag").text(UI.table.incomplete);
    const origin = atcOrigin(row);
    if (!origin) return;
    code.append("span").attr("class", "flag").attr("aria-hidden", "true").text(atcOriginFlag(origin));
    code.append("span").attr("class", "visually-hidden").text(` ${atcOriginText(origin, atcNames, retiredYears)}`);
  });
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
    .attr("data-tip", (badge) => UI.typeTips[badge.label])
    .attr("tabindex", "-1") // a tap focuses it and shows the explanation; no tab stop
    .text((badge) => badge.label);
}

// Merged "Approved · Status": dot and status label (explained on hover and on a tap, as the type
// badges: UI.statusTips; a negative opinion its own, statusTipText()), then the date line. Union
// Register disagreement: a visible marker, the full text as tooltip and for screen readers.
function renderStatusCell(cell, product, register) {
  const status = product.medicine_status;
  const tip = statusTipText(status, product.opinion_status);
  const carrier = tip ? cell.append("span").attr("class", "status-tip").attr("data-tip", tip).attr("tabindex", "-1") : cell;
  carrier.append("span").attr("class", `status hue-${statusHue(status)}`).text(statusLabel(status));
  const dates = statusDateLine(product.medicine_status, product.authorized_from, product.authorized_until);
  if (dates) cell.append("span").attr("class", "status-date").text(dates);
  const row = register?.get(product.ema_product_number);
  if (row?.agrees_with_ema !== false) return;
  const text = `${UI.register.chip(row.register_status, row.register_last_decision_date)}. ${UI.register.note}`;
  const flag = cell.append("span").attr("class", "flag register-flag").attr("title", text);
  flag.append("span").attr("aria-hidden", "true").text(UI.register.marker);
  flag.append("span").attr("class", "visually-hidden").text(text);
}

// Each term links to its condition page where its MeSH descriptor is known (conditionLink()); its
// branch names as tooltip.
function renderAreaCell(cell, product, branchNamesByTerm, conditionLink) {
  cell.selectAll("span.term")
    .data(product.areas)
    .join("span")
    .attr("class", "term")
    .attr("title", (term) => (branchNamesByTerm.get(term) ?? []).join("\n") || UI.table.noBranch)
    .each(function term(value, index) {
      const link = conditionLink(value);
      if (link) this.append(link);
      else this.append(value);
      if (index < product.areas.length - 1) this.append("; ");
    });
}

// lookups: substanceIndex (product -> EMA active substances), atcNames (code -> name),
// atcRetiredYears (retired code -> the year WHO retired it), branchNamesByTerm (MeSH term ->
// branch names). medicineLink(product): the name as a link to its
// medicine card; conditionLink(term): a link to the term's condition page, or null.
// holderOf(product): its Company · Holder cell's content (holders.js holderDisplay(); companies
// part 2), a node or text. onAtcSelect(code): an ATC segment was clicked; focusFallback(): where
// focus goes when the clicked segment's row is gone after the update.
// All text goes through .text() or text nodes: decoded indications contain literal "<" and ">".
export function createTable(table, moreButton, captionNode, { substanceIndex, atcNames, atcRetiredYears, branchNamesByTerm, medicineLink, conditionLink, holderOf, onAtcSelect, focusFallback }) {
  let current = null;
  let shown = 0;
  let refocus = null; // { number, code } of a clicked ATC segment, until the next update

  // Pressed: the segments whose class is selected in the ATC filter. Each badge's one tab stop: the
  // first pressed segment, else the last (the full code).
  function markPressed() {
    for (const badge of table.querySelectorAll(".atc-badge[role=toolbar]")) {
      const segments = [...badge.querySelectorAll("button.atc-seg")];
      const pressed = segments.find((segment) => current.selectedAtc.includes(segment.dataset.code));
      for (const segment of segments) {
        segment.setAttribute("aria-pressed", String(current.selectedAtc.includes(segment.dataset.code)));
        segment.tabIndex = segment === (pressed ?? segments.at(-1)) ? 0 : -1;
      }
    }
  }

  // Focus one segment and make it its badge's tab stop.
  function focusSegment(button) {
    for (const segment of button.parentNode.querySelectorAll("button.atc-seg")) segment.tabIndex = segment === button ? 0 : -1;
    button.focus();
  }

  d3.select(table).on("click", (event) => {
    const button = event.target.closest("button.atc-seg");
    if (!button) return;
    refocus = { number: d3.select(button.closest("tbody")).datum().ema_product_number, code: button.dataset.code };
    onAtcSelect(button.dataset.code);
  });

  // Toolbar keys: Left/Right to the neighboring segment, Home/End to the first/last.
  d3.select(table).on("keydown", (event) => {
    const button = event.target.closest("button.atc-seg");
    if (!button) return;
    const segments = [...button.parentNode.querySelectorAll("button.atc-seg")];
    const index = segments.indexOf(button);
    const target = segments[{ ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: segments.length - 1 }[event.key]];
    if (!target) return;
    event.preventDefault();
    focusSegment(target);
  });

  // The rows are rebuilt: back to the same segment of the same medicine, else of any medicine.
  function restoreFocus() {
    const { number, code } = refocus;
    refocus = null;
    const selector = `button.atc-seg[data-code="${code}"]`;
    const row = d3.select(table).selectAll("tbody").filter((product) => product.ema_product_number === number);
    const target = row.select(selector).node() ?? table.querySelector(selector);
    if (target) focusSegment(target);
    else focusFallback();
  }

  // One tbody per medicine keeps its full-width indication row directly beneath it. Explicit roles
  // keep the table semantics where narrow cards stack the rows (style.css).
  function appendRows(products) {
    const groups = d3.select(table).selectAll(null).data(products).enter().append("tbody").attr("role", "rowgroup");
    const rows = groups.append("tr").attr("role", "row");
    rows.append("td").attr("class", "breakable").each(function nameCell(product) {
      renderNameCell(d3.select(this), product, substanceIndex.get(product.ema_product_number) ?? [], current.documents, medicineLink);
    });
    rows.append("td").attr("class", "holder-cell").each(function holderCell(product) {
      this.append(holderOf(product));
    });
    rows.append("td").attr("class", "status-cell").each(function statusCell(product) {
      renderStatusCell(d3.select(this), product, current.register);
    });
    rows.append("td").attr("class", "type-cell").each(function typeCell(product) {
      renderTypeCell(d3.select(this), product);
    });
    rows.append("td").attr("class", "atc").each(function atcCell(product) {
      renderAtcCell(d3.select(this), product, atcNames, atcRetiredYears);
    });
    rows.append("td").attr("class", "area").each(function areaCell(product) {
      renderAreaCell(d3.select(this), product, branchNamesByTerm, conditionLink);
    });
    rows.append("td").attr("class", "indication-cell")
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
      .attr("role", "row")
      .attr("class", "indication")
      .attr("id", indicationRowId)
      .attr("hidden", "")
      .append("td")
      .attr("colspan", HEADERS.length)
      .text((product) => product.therapeutic_indication);
    groups.selectAll("td").attr("role", "cell");
  }

  function showMore() {
    const next = current.products.slice(shown, shown + PAGE_SIZE);
    appendRows(next);
    markPressed();
    shown += next.length;
    const remaining = current.products.length - shown;
    d3.select(moreButton)
      .attr("hidden", remaining > 0 ? null : "")
      .text(UI.table.showMore(Math.min(PAGE_SIZE, remaining), current.products.length));
  }

  d3.select(moreButton).on("click", showMore);
  // Named by the card's heading and described by the caption above the scroll area (inside it, a
  // wide table's caption was cut off on phones).
  d3.select(table).attr("role", "table").attr("aria-labelledby", "table-title").attr("aria-describedby", captionNode.id);

  // Rebuilds only when the rows, caption or register (ema_medicine_register_status.json rows by
  // product, null until loaded) changed, so resizes keep the pages already shown. selectedAtc: the
  // ATC codes selected in the filter, shown as pressed segments. documents: the documents index by
  // product (null until loaded); its arrival adds the links in place.
  return function update(products, caption, register, selectedAtc, documents) {
    const unchanged = current !== null && current.caption === caption && current.register === register &&
      current.products.length === products.length && current.products.every((product, index) => product === products[index]);
    if (unchanged) {
      if (String(current.selectedAtc) !== String(selectedAtc)) {
        current.selectedAtc = selectedAtc;
        markPressed();
      }
      if (current.documents !== documents) {
        current.documents = documents;
        d3.select(table).selectAll("tbody").each(function links(product) {
          renderDocumentLinks(d3.select(this).select("td.breakable"), product, documents);
        });
      }
      if (refocus) restoreFocus();
      return;
    }
    current = { products, caption, register, selectedAtc, documents };
    shown = 0;
    const root = d3.select(table);
    root.selectChildren().remove();
    captionNode.textContent = caption;
    root.append("thead").attr("role", "rowgroup").append("tr").attr("role", "row")
      .selectAll("th")
      .data(HEADERS)
      .join("th")
      .attr("scope", "col")
      .attr("role", "columnheader")
      .text((header) => header);
    showMore();
    if (refocus) restoreFocus();
  };
}
