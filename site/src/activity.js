// "Who is active where": a table of the top holders (rows) by ATC groups or therapeutic area
// groups (columns). Each cell is the number of the holder's matching medicines in that column, on
// one of five accent shades (--heat-1..5; empty when 0); a non-empty cell is a button that filters
// by the holder and the column, the row and column headers by one of them. Rebuilt on every
// render; focus goes back to the same control.
import * as d3 from "d3";
import { appendCodeBadge } from "./atc-picker.js";
import { UI } from "./labels.js";

const STEPS = 5;
const formatCount = d3.format(",");

// A count's shade, 1-5, relative to the table's largest count.
const shade = (count, max) => Math.max(1, Math.ceil((STEPS * count) / max));

// rows: holderActivity() output. columns: [{ key, label: its name in cell names, badge: an ATC
// code shown as a badge (else the label is the header's text), title: a tooltip, filter: the
// filter patch its header and cells set (null: a static column, "Other")}]. onFilter(patch).
// labelledBy, describedBy: the ids naming and describing the table (outside the scroll area, so
// they stay readable on a phone).
export function renderActivity(container, { rows, columns, labelledBy, describedBy, onFilter }) {
  const focused = container.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
  const root = d3.select(container);
  root.selectChildren().remove();
  if (rows.length === 0) {
    root.append("p").attr("class", "muted").text(UI.breakdown.empty);
    return;
  }
  const max = d3.max(rows, (row) => d3.max(columns, (column) => row.cells.get(column.key) ?? 0)) || 1;
  const table = root.append("table").attr("class", "activity").attr("aria-labelledby", labelledBy).attr("aria-describedby", describedBy);
  const head = table.append("thead").append("tr");
  head.append("th").attr("scope", "col").text(UI.activity.holder);
  head.selectAll("th.activity-col").data(columns).join("th").attr("scope", "col").attr("class", "activity-col").each(function header(column) {
    const cell = d3.select(this).attr("title", column.title ?? null);
    if (!column.filter) {
      cell.text(column.label);
      return;
    }
    const button = cell.append("button")
      .attr("type", "button")
      .attr("data-focus-key", `column:${column.key}`)
      .on("click", () => onFilter(column.filter));
    if (column.badge) appendCodeBadge(button.attr("aria-label", column.label), column.badge);
    else button.text(column.label);
  });
  const lines = table.append("tbody").selectAll("tr").data(rows).join("tr");
  lines.append("th")
    .attr("scope", "row")
    .append("button")
    .attr("type", "button")
    .attr("data-focus-key", (row) => `row:${row.mah}`)
    .text((row) => row.mah)
    .on("click", (event, row) => onFilter({ mah: [row.mah] }));
  lines.selectAll("td")
    .data((row) => columns.map((column) => ({ row, column, count: row.cells.get(column.key) ?? 0 })))
    .join("td")
    .attr("class", (cell) => (cell.count ? `heat heat-${shade(cell.count, max)}` : "heat"))
    .each(function value(cell) {
      if (!cell.count) return;
      const text = formatCount(cell.count);
      if (!cell.column.filter) {
        d3.select(this).append("span").text(text);
        return;
      }
      d3.select(this).append("button")
        .attr("type", "button")
        .attr("data-focus-key", `cell:${cell.row.mah}|${cell.column.key}`)
        .attr("aria-label", UI.activity.cell(cell.row.mah, cell.column.label, cell.count))
        .text(text)
        .on("click", () => onFilter({ mah: [cell.row.mah], ...cell.column.filter }));
    });
  // Focus scrolls a cell clear of the sticky holder column (WCAG 2.4.11), whatever its width.
  root.style("scroll-padding-inline-start", `${table.select("tbody th").node().offsetWidth + 4}px`);
  // A click filtered the table: the same control, else its first one (focus stays in the card).
  if (focused !== undefined) (container.querySelector(`[data-focus-key="${CSS.escape(focused)}"]`) ?? container.querySelector("button"))?.focus();
}
