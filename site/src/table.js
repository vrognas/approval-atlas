import * as d3 from "d3";
import { areaChips, chipTogglable, fillTerm, markAreaChips } from "./area-chips.js";
import { atcBadgeTip, atcCode, atcLevelNames, atcOrigin, atcRowIncomplete } from "./atc.js";
import { atcHue, atcSegments, statusColor, statusHue, statusShape, statusTip, typeBadges } from "./badges.js";
import { quickDocuments } from "./documents.js";
import { UI, atcOriginFlag, atcOriginText, formatDate, statusDotLine, statusDotTipLine, statusKind, statusLabel, statusOpinionLabel } from "./labels.js";
import { documentLinks } from "./lookup.js";
import { focusToolbarButton, toolbarKeydown } from "./toolbar.js";

const PAGE_SIZE = 100;
const HEADERS = UI.table.headers;

// The sizes in which a page of count rows is added: all at once, or (first) that many first, then
// as many again in each later task (design sweep 2026-10-01, L3: on a phone's CPU 100 rows held the
// Medicines tab's first paint up to 1.9 s; 20 at a time keep each task short).
export function rowChunks(count, first = null) {
  if (!first || first >= count) return count > 0 ? [count] : [];
  const chunks = [];
  for (let start = 0; start < count; start += first) chunks.push(Math.min(first, count - start));
  return chunks;
}

// After the next paint: a frame, then a task (its rows then never hold up the paint before them).
const afterPaint = (callback) => requestAnimationFrame(() => setTimeout(callback, 0));

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
// keys move between them). classTip(code): a segment's class explanation as a hidden description
// ({ text, id }; levels 1-4), or null: read when the segment has focus (review of the ATC class
// explanations: the badge's tip shows it, but a data-tip never reaches a screen reader).
function appendAtcBadge(parent, code, atcNames, classTip = () => null) {
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
    .attr("aria-label", (segment) => UI.atc.filterBy(segment.level, segment.code, atcNames.get(segment.code)))
    .attr("aria-describedby", (segment) => classTip(segment.code)?.id ?? null);
  return badge;
}

// One badge per code to use (atcCode(); rows without one are skipped), flagged when incomplete
// (atcRowIncomplete(): atc_final_level, so B03AC is not; phase 4e) or
// when it differs from EMA's published code (atcOrigin(): a short flag, the sentence in the tooltip
// and for screen readers). The tooltip (atcBadgeTip(): the explanation of its deepest class at
// levels 1-4, level names, origin, source) is a data-tip as the type badges' (owner feedback
// 2026-09-29: it was a native title, which looked and behaved
// otherwise); a tap shows it (tabindex -1, no tab stop), a tap on a segment once it has filtered
// (the table puts focus back on the segment; review of PR #15: most badges are all segments, so a
// tap had nowhere else to show it), and keyboard focus on a segment.
function renderAtcCell(cell, product, atcNames, retiredYears, explanations, classTip) {
  const rows = product.atc.filter((row) => atcCode(row) !== null);
  const codes = cell.selectAll("span.code").data(rows).join("span").attr("class", "code tip-lines")
    .attr("data-tip", (row) => atcBadgeTip(row, atcNames, retiredYears, explanations))
    .attr("tabindex", "-1");
  codes.each(function badge(row) {
    const code = d3.select(this);
    appendAtcBadge(code, atcCode(row), atcNames, classTip);
    // The level names for screen readers (the tooltip is left out of accessible names).
    const names = atcLevelNames(atcCode(row), atcNames);
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

const SVG = "http://www.w3.org/2000/svg";

function svgElement(parent, name, attributes) {
  const node = parent.appendChild(document.createElementNS(SVG, name));
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

// The dot's shape (statusShape()) in a 12px box, drawn in currentColor: forced colors keep the
// shape, in the text colour.
function statusMark(shape) {
  const svg = document.createElementNS(SVG, "svg");
  for (const [key, value] of Object.entries({ viewBox: "0 0 12 12", width: "12", height: "12", "aria-hidden": "true", focusable: "false", class: `status-mark mark-${shape}` })) svg.setAttribute(key, value);
  if (shape === "filled") svgElement(svg, "circle", { cx: "6", cy: "6", r: "5", fill: "currentColor" });
  if (shape === "ring" || shape === "half") svgElement(svg, "circle", { cx: "6", cy: "6", r: "4.25", fill: "none", stroke: "currentColor", "stroke-width": "1.5" });
  if (shape === "half") svgElement(svg, "path", { d: "M6 1.75A4.25 4.25 0 0 0 6 10.25Z", fill: "currentColor" });
  if (shape === "cross") svgElement(svg, "path", { d: "M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round" });
  return svg;
}

// The dots' shapes, on a line of their own after the caption, when the rows have a status other than
// Authorized (review of the status dot, 2026-09-30: the shapes had no key; the default view, every
// dot filled, needs none): each shape present, in the ink colour (a key to shapes, not colours;
// aria-hidden), then its word, read as text.
const SHAPE_ORDER = ["filled", "ring", "half", "cross"];

function renderShapesKey(caption, products) {
  const present = new Set(products.map((product) => statusShape(product.medicine_status)));
  const shapes = SHAPE_ORDER.filter((shape) => present.has(shape));
  if (!shapes.some((shape) => shape !== "filled")) return;
  const key = caption.append("span").attr("class", "shapes-key");
  key.append("span").text(`${UI.table.shapesKey.lead} `);
  shapes.forEach((shape, index) => {
    const item = key.append("span").attr("class", "shapes-key-item");
    item.append(() => statusMark(shape));
    item.append("span").text(`${UI.table.shapesKey[shape]}${index < shapes.length - 1 ? "," : ""}`);
    if (index < shapes.length - 1) key.append(() => document.createTextNode(" "));
  });
}

// A status other than Authorized as visible text (statusDotLine(): "Withdrawn 16 Jan 2009",
// "Refused"), its end date kept on one line; aria-hidden, as the dot's hidden name says it.
function appendStatusText(parent, className, product) {
  const { medicine_status: status, authorized_until: ended } = product;
  const text = parent.append("span").attr("class", className).attr("aria-hidden", "true")
    .text(statusOpinionLabel(status, product.opinion_status ?? null));
  if (!ended) return;
  // The space outside the date, so the line can break there.
  text.append(() => document.createTextNode(" "));
  text.append("span").attr("class", "nowrap").text(formatDate(ended));
}

// The status dot (owner decision 2026-09-30): the status's colour (statusColor()) in a shape per
// status kind (statusShape()), named by its status and end date ("Withdrawn 16 Jan 2009",
// "Authorized since 6 Jan 2022", statusDotLine(); visually hidden text), the tooltip that line with
// the approval date of a status other than Authorized (statusDotTipLine()) and the status's
// explanation (statusTip(): UI.statusTips, a negative opinion its own), which also describes it; a
// 24px carrier a tap shows it on (tabindex -1, no tab stop), as the type badges. On hover the tip
// waits the explainers' pause (.mesh-tip; review of the status dot: sweeping down the column opened
// one per row) and opens above the pointer (.tip-pointer-above: below, it covered the row's PI and
// EPAR links); a tap shows it (.tap-tip). On phones the status follows the dot as text
// (aria-hidden: the hidden name says it): "Authorized", else the Approved cell's status text.
function renderStatusDot(cell, product) {
  const status = product.medicine_status;
  const opinion = product.opinion_status ?? null;
  const { authorized_from: approved, authorized_until: ended } = product;
  const tip = statusTip(status, opinion);
  const tipLine = statusDotTipLine(status, approved, ended, opinion);
  const dot = cell.append("span")
    .attr("class", `status-dot mesh-tip tap-tip tip-pointer-above hue-${statusHue(status)}${tip ? " tip-lines" : ""}`)
    .attr("data-tip", tip ? `${tipLine}\n${tip.text}` : tipLine)
    .attr("tabindex", "-1")
    .attr("aria-describedby", tip?.id ?? null)
    .style("color", statusColor(status));
  dot.append(() => statusMark(statusShape(status)));
  dot.append("span").attr("class", "visually-hidden").text(statusDotLine(status, approved, ended, opinion));
  if (statusKind(status) === "authorized") dot.append("span").attr("class", "status-dot-label").attr("aria-hidden", "true").text(statusLabel(status));
  else appendStatusText(dot, "status-dot-label", product);
}

// The Approved column: the approval date ("No date" without one, "No approval date" on phones,
// where no header names the column), then, for a status other than Authorized, the status and its
// end date as muted text (review of the status dot, 2026-09-30: a keyboard or colour-blind reader
// had them only in the dot's tip; phones show it after the dot instead). On phones "Approved" goes
// before a date (aria-hidden: the column header says it). Union Register disagreement: a visible
// marker, the full text as tooltip (a data-tip, shown on a tap too; owner feedback 2026-09-29: it
// was a native title) and for screen readers.
function renderApprovedCell(cell, product, register) {
  const date = cell.append("span").attr("class", "approved-date");
  const approved = formatDate(product.authorized_from);
  if (approved) {
    date.append("span").attr("class", "approved-prefix").attr("aria-hidden", "true").text(`${UI.table.approved} `);
    date.append("span").text(approved);
  } else {
    date.append("span").attr("class", "no-date-short").text(UI.table.noDate);
    date.append("span").attr("class", "no-date-long").text(UI.table.noApprovalDate);
  }
  if (statusKind(product.medicine_status) !== "authorized") appendStatusText(cell, "approved-status", product);
  const row = register?.get(product.ema_product_number);
  if (row?.agrees_with_ema !== false) return;
  const text = `${UI.register.chip(row.register_status, row.register_last_decision_date)}. ${UI.register.note}`;
  const flag = cell.append("span").attr("class", "flag register-flag").attr("data-tip", text).attr("tabindex", "-1");
  flag.append("span").attr("aria-hidden", "true").text(UI.register.marker);
  flag.append("span").attr("class", "visually-hidden").text(text);
}

// The terms in one flow, "; " between them, each a group (fillTerm()): its name, a link to its
// condition page where its MeSH descriptor is known (conditionLink()) and explained
// (explainTerms()), then its branch chips (area-chips.js; owner decision 2026-09-29), which wrap
// below the name when it leaves them no room.
function renderAreaCell(cell, product, branchNamesByTerm, conditionLink, termTip, branches, selectedArea) {
  cell.selectAll("span.term")
    .data(product.areas)
    .join("span")
    .attr("class", "term")
    .each(function term(value, index) {
      const name = document.createElement("span");
      name.className = "term-name";
      name.append(conditionLink(value) ?? value);
      const last = index === product.areas.length - 1;
      fillTerm(this, name, areaChips(value, branches, selectedArea), last);
      if (!last) this.after(" ");
    });
  explainTerms(cell, branchNamesByTerm, termTip);
}

// A term's MeSH explainer on its link once the notes have loaded (termTip(term): { text, id } or
// null; owner request 2026-09-28): a tooltip, and the link's description. Until then, or without
// one, its branch names as the name's tooltip, one per line, with the explainers' pause (a data-tip
// on the name only, so it never shows over the chips' own tips; owner feedback 2026-09-29: it was a
// native title; never both). A name without a link takes a tap (tabindex -1), as the type badges.
function explainTerms(cell, branchNamesByTerm, termTip) {
  cell.selectAll("span.term").each(function explain(term) {
    const name = this.querySelector(".term-name");
    const link = name.querySelector("a");
    const tip = link ? termTip(term) : null;
    d3.select(name)
      .attr("data-tip", tip ? null : (branchNamesByTerm.get(term) ?? []).join("\n") || UI.table.noBranch)
      .classed("mesh-tip tip-lines", !tip)
      .attr("tabindex", tip || link ? null : "-1");
    if (link) d3.select(link).attr("data-tip", tip?.text ?? null).attr("aria-describedby", tip?.id ?? null).classed("mesh-tip", tip !== null);
  });
}

// lookups: substanceIndex (product -> EMA active substances), atcNames (code -> name),
// atcRetiredYears (retired code -> the year WHO retired it), atcExplanations (code -> our
// plain-language explanation, atc.js buildAtcExplanations(): it leads the badge tips), atcClassTip
// (code -> that explanation as a hidden description, { text, id } or null: describes each segment),
// branchNamesByTerm (MeSH term -> branch names). medicineLink(product): the name as a link to its
// medicine card; conditionLink(term): a link to the term's condition page, or null; termTip(term):
// its MeSH explainer ({ text, id }), or null (none, or the notes still load).
// holderOf(product): its Company · Holder cell's content (holders.js holderDisplay(); companies
// part 2), a node or text. onAtcSelect(code): an ATC segment was clicked; focusFallback(): where
// focus goes when the clicked segment's row is gone after the update. branches: the terms' MeSH
// branches (areas.js termBranches()); onAreaSelect(branch): a branch chip was clicked;
// focusAreaFallback(): as focusFallback() for a chip.
// All text goes through .text() or text nodes: decoded indications contain literal "<" and ">".
export function createTable(table, moreButton, captionNode, {
  substanceIndex, atcNames, atcRetiredYears, atcExplanations = new Map(), atcClassTip = () => null, branchNamesByTerm, medicineLink, conditionLink, termTip = () => null, holderOf, onAtcSelect, focusFallback,
  branches, onAreaSelect, focusAreaFallback,
}) {
  let current = null;
  let shown = 0;
  // A clicked ATC segment or branch chip, until the next update: { number, selector (the button),
  // within (a chip's term, as the same branch can follow several), fallback }.
  let refocus = null;
  // The sticky header's height (--thead-h), so a focused control keeps clear of it (style.css
  // scroll-margin-top; WCAG 2.4.11, audit 2026-09-30, M2). It follows the header's wrapping and text
  // spacing.
  const headerSize = new ResizeObserver(([entry]) => table.style.setProperty("--thead-h", `${entry.target.offsetHeight}px`));

  // Pressed: the segments whose class is selected in the ATC filter, and the branch chips whose
  // branch is within the area filter. Each badge's one tab stop: the first pressed segment, else the
  // last (the full code); each chip toolbar's: markAreaChips().
  function markPressed() {
    for (const badge of table.querySelectorAll(".atc-badge[role=toolbar]")) {
      const segments = [...badge.querySelectorAll("button.atc-seg")];
      const pressed = segments.find((segment) => current.selectedAtc.includes(segment.dataset.code));
      for (const segment of segments) {
        segment.setAttribute("aria-pressed", String(current.selectedAtc.includes(segment.dataset.code)));
        segment.tabIndex = segment === (pressed ?? segments.at(-1)) ? 0 : -1;
      }
    }
    markAreaChips(table, current.selectedArea);
  }

  d3.select(table).on("click", (event) => {
    const button = event.target.closest("button.atc-seg, button.area-chip");
    if (!button) return;
    const number = d3.select(button.closest("tbody")).datum().ema_product_number;
    if (button.matches(".area-chip")) {
      // Included through a selected category: disabled, as the tree's row (area-chips.js).
      if (!chipTogglable(button)) return;
      const term = button.closest("span.term");
      const index = [...term.parentNode.children].indexOf(term);
      refocus = { number, selector: `button.area-chip[data-area="${button.dataset.area}"]`, within: `td.area > span.term:nth-child(${index + 1})`, fallback: focusAreaFallback };
      onAreaSelect(button.dataset.area);
      return;
    }
    refocus = { number, selector: `button.atc-seg[data-code="${button.dataset.code}"]`, within: null, fallback: focusFallback };
    onAtcSelect(button.dataset.code);
  });

  // Toolbar keys (the ATC segments, the branch chips and their "+n"): Left/Right to the neighboring
  // item, Home/End to the first/last.
  d3.select(table).on("keydown", (event) => toolbarKeydown(event, "button.atc-seg, button.area-chip, .area-more"));

  // The rows are rebuilt: back to the same button of the same medicine (a chip: of the same term,
  // else that term's "+n", where a chip no longer within the area filter can go: branchChips()),
  // else of any medicine.
  function restoreFocus() {
    const { number, selector, within, fallback } = refocus;
    refocus = null;
    const row = d3.select(table).selectAll("tbody").filter((product) => product.ema_product_number === number).node();
    const inTerm = within ? row?.querySelector(`${within} ${selector}`) ?? row?.querySelector(`${within} .area-more`) : null;
    const target = inTerm ?? row?.querySelector(selector) ?? table.querySelector(selector);
    if (target) focusToolbarButton(target);
    else fallback();
  }

  // One tbody per medicine keeps its full-width indication row directly beneath it. Explicit roles
  // keep the table semantics where narrow cards stack the rows (style.css).
  function appendRows(products) {
    const groups = d3.select(table).selectAll(null).data(products).enter().append("tbody").attr("role", "rowgroup");
    const rows = groups.append("tr").attr("role", "row");
    rows.append("td").attr("class", "status-dot-cell").each(function statusCell(product) {
      renderStatusDot(d3.select(this), product);
    });
    rows.append("td").attr("class", "breakable").each(function nameCell(product) {
      renderNameCell(d3.select(this), product, substanceIndex.get(product.ema_product_number) ?? [], current.documents, medicineLink);
    });
    rows.append("td").attr("class", "holder-cell").each(function holderCell(product) {
      this.append(holderOf(product));
    });
    rows.append("td").attr("class", "approved-cell").each(function approvedCell(product) {
      renderApprovedCell(d3.select(this), product, current.register);
    });
    rows.append("td").attr("class", "type-cell").each(function typeCell(product) {
      renderTypeCell(d3.select(this), product);
    });
    rows.append("td").attr("class", "atc").each(function atcCell(product) {
      renderAtcCell(d3.select(this), product, atcNames, atcRetiredYears, atcExplanations, atcClassTip);
    });
    rows.append("td").attr("class", "area").each(function areaCell(product) {
      renderAreaCell(d3.select(this), product, branchNamesByTerm, conditionLink, termTip, branches, current.selectedArea);
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

  // Rows of the page still to add, in later tasks (rowChunks()), and the update they belong to (a
  // rebuild drops them).
  let pending = [];
  let build = 0;

  function addRows(count) {
    const next = current.products.slice(shown, shown + count);
    appendRows(next);
    markPressed();
    shown += next.length;
    const remaining = current.products.length - shown - pending.reduce((sum, size) => sum + size, 0);
    d3.select(moreButton)
      .attr("hidden", remaining > 0 ? null : "")
      .text(UI.table.showMore(Math.min(PAGE_SIZE, remaining), current.products.length));
  }

  // The next page: first (phones, a tab just shown) its first rows, the rest after each paint.
  function showMore(first = null) {
    const chunks = rowChunks(Math.min(PAGE_SIZE, current.products.length - shown), first);
    pending = chunks.slice(1);
    addRows(chunks[0] ?? 0);
    const mine = build;
    const later = () => {
      if (mine !== build || !pending.length) return;
      addRows(pending.shift());
      if (pending.length) afterPaint(later);
    };
    if (pending.length) afterPaint(later);
  }

  // "Show 100 more": the rows still pending first, then the next page.
  d3.select(moreButton).on("click", () => {
    while (pending.length) addRows(pending.shift());
    showMore();
  });
  // Named by the card's heading and described by the caption above the scroll area (inside it, a
  // wide table's caption was cut off on phones).
  d3.select(table).attr("role", "table").attr("aria-labelledby", "table-title").attr("aria-describedby", captionNode.id);

  // Rebuilds only when the rows, caption or register (ema_medicine_register_status.json rows by
  // product, null until loaded) changed, so resizes keep the pages already shown. selectedAtc: the
  // ATC codes selected in the filter, shown as pressed segments. documents: the documents index by
  // product (null until loaded); its arrival adds the links in place. notes: the MeSH notes (null
  // until loaded); their arrival adds the terms' explainers in place (termTip()). selectedArea: the
  // area filter (state.area), shown as pressed branch chips. first: when the rows are rebuilt, add
  // that many first and the rest of the page after each paint (null: the whole page at once).
  return function update(products, caption, register, selectedAtc, documents, notes = null, selectedArea = [], first = null) {
    const unchanged = current !== null && current.caption === caption && current.register === register &&
      current.products.length === products.length && current.products.every((product, index) => product === products[index]);
    if (unchanged) {
      if (String(current.selectedAtc) !== String(selectedAtc) || String(current.selectedArea) !== String(selectedArea)) {
        current.selectedAtc = selectedAtc;
        current.selectedArea = selectedArea;
        markPressed();
      }
      if (current.documents !== documents) {
        current.documents = documents;
        d3.select(table).selectAll("tbody").each(function links(product) {
          renderDocumentLinks(d3.select(this).select("td.breakable"), product, documents);
        });
      }
      if (current.notes !== notes) {
        current.notes = notes;
        d3.select(table).selectAll("td.area").each(function explain() {
          explainTerms(d3.select(this), branchNamesByTerm, termTip);
        });
      }
      if (refocus) restoreFocus();
      return;
    }
    current = { products, caption, register, selectedAtc, documents, notes, selectedArea };
    shown = 0;
    build += 1;
    pending = [];
    const root = d3.select(table);
    root.selectChildren().remove();
    captionNode.textContent = caption;
    renderShapesKey(d3.select(captionNode), products);
    root.append("thead").attr("role", "rowgroup").append("tr").attr("role", "row")
      .selectAll("th")
      .data(HEADERS)
      .join("th")
      .attr("scope", "col")
      .attr("role", "columnheader")
      .attr("class", (header, index) => (index === 0 ? "status-dot-head" : null))
      .each(function header(text, index) {
        // The dot column's header is read, not shown: the dots name themselves.
        if (index === 0) d3.select(this).append("span").attr("class", "visually-hidden").text(text);
        else this.textContent = text;
      });
    headerSize.disconnect();
    headerSize.observe(root.select("thead").node());
    showMore(first);
    if (refocus) restoreFocus();
  };
}
