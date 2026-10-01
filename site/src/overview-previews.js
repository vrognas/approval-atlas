// The Overview tab's previews of other tabs (F · Spacious, phase 2, as the F overview mockup): a few
// rows each (the company groups with the most medicines, the conditions with the most treatments,
// the years estimated market protection ends), a bar and a count per row, and a link to the tab
// with the whole card (index.html .preview-tab-link, main.js). Built from the data helpers the
// full cards use; text via textContent only, bar widths through the CSSOM.
import * as d3 from "d3";
import { keyCounts, topKeys } from "./facets.js";

// How many rows a preview shows.
export const PREVIEW_ROWS = 5;

// Pure: each count as a bar length in percent of scale (the largest count by default; 0 when it is
// 0), { width, clamped }: a count above the scale stops at full length (clamped: drawn broken, as
// the protection card's bar of the later years, which span several).
export function previewShares(counts, scale = Math.max(0, ...counts)) {
  return counts.map((count) => ({ width: scale ? Math.min(count / scale, 1) * 100 : 0, clamped: count > scale }));
}

// Pure: the n company groups (group_key) with the most of products, most first (ties by key), as
// { key, count }; medicines without a group are in none.
export function topGroups(products, n = PREVIEW_ROWS) {
  const counts = keyCounts(products, (product) => (product.group_key ? [product.group_key] : []));
  return topKeys(counts, n).map((key) => ({ key, count: counts.get(key) }));
}

const formatCount = d3.format(",");

function node(tag, className, ...children) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.append(...children.filter((child) => child !== null && child !== undefined));
  return element;
}

// A row's label. A lead (a company's badge) before a link goes inside it, the name after it in a span
// (bug hunt 2026-10-01 fix-up: the badge and the gap beside it were no part of the link, so a tap
// there near the row's edge could open the next row's page): the whole label is the row's target.
// The name carries the link's underline, which would otherwise run under the badge's monogram too.
function labelOf({ lead, label }) {
  if (!lead || label?.nodeName !== "A") return node("span", "preview-label", lead, lead ? " " : null, label);
  label.classList.add("preview-lead-link");
  label.replaceChildren(lead, node("span", "preview-name", ...label.childNodes));
  return node("span", "preview-label", label);
}

// container: a preview card's .preview-body. rows: [{ key, lead (a node before the label, inside it
// when it is a link, or null), label (text or a node), count, unit (what the count counts, read after
// it) }]. line: a line in
// place of the rows (loading, none), or null; caption: a muted line under the rows, or null; scale:
// the count a full bar stands for (the largest by default). Rebuilt on every render; a focused link
// keeps its focus (by its row's key).
export function renderPreview(container, { rows = [], line = null, caption = null, scale = undefined }) {
  const active = container.contains(document.activeElement) ? document.activeElement.closest("[data-key]")?.dataset.key : undefined;
  container.replaceChildren();
  if (line !== null) {
    container.append(node("p", "muted", line));
    return;
  }
  const shares = previewShares(rows.map((row) => row.count), scale);
  const list = node("ol", "preview-list");
  rows.forEach((row, index) => {
    const fill = node("span", "preview-fill");
    fill.style.width = `${shares[index].width}%`;
    const item = node("li", "preview-row",
      labelOf(row),
      node("span", `preview-bar${shares[index].clamped ? " pc-clamped" : ""}`, fill),
      node("span", "preview-count", formatCount(row.count), node("span", "visually-hidden", ` ${row.unit}`)));
    item.dataset.key = row.key;
    item.querySelector(".preview-bar").setAttribute("aria-hidden", "true");
    list.append(item);
  });
  container.append(list);
  if (caption) container.append(node("p", "muted preview-caption", caption));
  if (active !== undefined) list.querySelector(`[data-key="${CSS.escape(active)}"] a`)?.focus();
}
