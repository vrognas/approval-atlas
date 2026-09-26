import * as d3 from "d3";
import { UI } from "./labels.js";

// Horizontal bars as HTML toggle buttons. rows: breakdownCounts() output.
// Other has no bar: it would dwarf the named rows, and it is not a filter value.
export function renderBreakdown(container, rows, { isSelected, onToggle }) {
  const root = d3.select(container);
  // Rebuilt on every render; keep keyboard focus on the same value.
  const focusedKey = container.contains(document.activeElement) ? d3.select(document.activeElement).datum()?.key : undefined;
  root.selectChildren().remove();
  if (rows.length === 0) {
    root.append("p").attr("class", "muted").text(UI.breakdown.empty);
    return;
  }
  const named = rows.filter((row) => !row.other);
  const max = d3.max(named, (row) => row.count) ?? 1;
  const anySelected = named.some((row) => isSelected(row.key));
  root.classed("has-selection", anySelected);

  const items = root.selectAll(".bar-row")
    .data(rows)
    .join((enter) => enter.append((row) => document.createElement(row.other ? "div" : "button")))
    .attr("class", (row) => (row.other ? "bar-row other" : "bar-row"));
  items.filter((row) => !row.other)
    .attr("type", "button")
    .attr("aria-pressed", (row) => String(isSelected(row.key)))
    .on("click", (event, row) => onToggle(row.key));
  items.append("span").attr("class", "bar-label").text((row) => row.label);
  items.append("span")
    .attr("class", "bar-track")
    .attr("aria-hidden", "true")
    .append("span")
    .attr("class", "bar-fill")
    .style("width", (row) => (row.other ? "0" : `${(100 * row.count) / max}%`));
  items.append("span").attr("class", "bar-value").text((row) => d3.format(",")(row.count));
  items.filter((row) => !row.other && focusedKey !== undefined && row.key === focusedKey).each(function focus() {
    this.focus();
  });
}
