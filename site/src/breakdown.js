import * as d3 from "d3";
import { UI } from "./labels.js";

// Horizontal bars as HTML toggle buttons. rows: breakdownCounts() output.
// Other has no bar: it would dwarf the named rows, and it is not a filter value.
// badgeOf(row) -> { text, hue } puts a letter badge before the label and colors the row's bar
// in that hue (ATC groups); null keeps the accent bar (areas, holders).
export function renderBreakdown(container, rows, { isSelected, onToggle, badgeOf = () => null }) {
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
    .attr("class", (row) => {
      const badge = row.other ? null : badgeOf(row);
      return ["bar-row", row.other ? "other" : null, badge ? `hue-${badge.hue}` : null].filter(Boolean).join(" ");
    });
  items.filter((row) => !row.other)
    .attr("type", "button")
    .attr("aria-pressed", (row) => String(isSelected(row.key)))
    .on("click", (event, row) => onToggle(row.key));
  const labels = items.append("span").attr("class", "bar-label");
  labels.filter((row) => !row.other && badgeOf(row)).append("span").attr("class", "letter-badge").text((row) => badgeOf(row).text);
  labels.append("span").text((row) => row.label);
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
