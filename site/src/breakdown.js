import * as d3 from "d3";
import { typeColor } from "./chart.js";
import { UI } from "./labels.js";

// Horizontal bars as HTML buttons. rows: areaBreakdownRows() or companyBreakdownRows() output, or
// ATC classes.
// Other has no bar: it would dwarf the named rows, and it is not a filter value. A static row
// (the ATC class shown alone) is not a button either.
// isSelected(key) makes the buttons toggles (aria-pressed); null makes them plain buttons (the
// ATC rows drill down). badgeOf(row) -> { text, hue, level } puts a code badge before the label
// (level 1: the letter badge), or { element() } a node (a company's monogram badge); null for
// areas. row.title: the bar's tooltip (a company's EMA holder names). row.segments ([{ type, count }], ATC
// rows) stacks the bar by medicine type, 1px apart; without them the bar is one accent fill.
// row.ariaLabel: the button's name (ATC rows: badge, name, count and type split would read glued
// together); row.split: the type split, read after a static row's count; row.incomplete: a
// muted label (the products coded only down to the parent class). linkOf(row): a link shown after
// the row (therapeutic area groups: their condition page), or null. tipOf(row): a bar's explainer
// ({ text, id }: the therapeutic areas' MeSH notes, mesh-notes.js meshTip()), or null: a tooltip on
// the bar, its text the button's description.
export function renderBreakdown(container, rows, { isSelected = null, onToggle, badgeOf = () => null, linkOf = () => null, tipOf = () => null }) {
  const root = d3.select(container);
  // Rebuilt on every render; keep keyboard focus on the same value's row or link.
  const active = container.contains(document.activeElement) ? document.activeElement : null;
  const focusedKey = active ? d3.select(active).datum()?.key : undefined;
  const linkFocused = active?.tagName === "A";
  root.selectChildren().remove();
  if (rows.length === 0) {
    root.append("p").attr("class", "muted").text(UI.breakdown.empty);
    return;
  }
  const named = rows.filter((row) => !row.other);
  const max = d3.max(named, (row) => row.count) ?? 1;
  const anySelected = isSelected !== null && named.some((row) => isSelected(row.key));
  root.classed("has-selection", anySelected);

  // Each row in an item, so a link can follow the row's button (no link inside a button).
  const rowItems = root.selectAll(".bar-item").data(rows).join("div").attr("class", "bar-item");
  const items = rowItems.append((row) => document.createElement(row.other || row.static ? "div" : "button"))
    .attr("class", (row) => {
      const badge = row.other ? null : badgeOf(row);
      return ["bar-row", row.other ? "other" : null, badge?.hue ? `hue-${badge.hue}` : null].filter(Boolean).join(" ");
    })
    .attr("title", (row) => row.title ?? null);
  items.filter((row) => !row.other && !row.static)
    .attr("type", "button")
    .attr("aria-pressed", isSelected === null ? null : (row) => String(isSelected(row.key)))
    .attr("aria-label", (row) => row.ariaLabel ?? null)
    .on("click", (event, row) => onToggle(row.key))
    .each(function explain(row) {
      const tip = tipOf(row);
      if (tip) d3.select(this).attr("data-tip", tip.text).attr("aria-describedby", tip.id).classed("mesh-tip", true);
    });
  const labels = items.append("span").attr("class", "bar-label");
  labels.filter((row) => !row.other && badgeOf(row)).each(function badge(row) {
    const spec = badgeOf(row);
    if (spec.element) {
      this.append(spec.element());
      return;
    }
    d3.select(this).append("span").attr("class", spec.level > 1 ? `code-badge level-${spec.level}` : "letter-badge").text(spec.text);
  });
  labels.append("span").attr("class", (row) => (row.incomplete ? "no-name" : null)).text((row) => row.label);
  const share = (count) => (100 * count) / max;
  items.append("span")
    .attr("class", "bar-track")
    .attr("aria-hidden", "true")
    .each(function track(row) {
      if (!row.segments) {
        d3.select(this).append("span").attr("class", "bar-fill").style("width", row.other ? "0" : `${share(row.count)}%`);
        return;
      }
      // Each gap takes its pixel from the segment after it, so the stack keeps the row's length.
      d3.select(this).selectAll("span")
        .data(row.segments)
        .join("span")
        .attr("class", "bar-seg")
        .style("width", (segment, index) => (index ? `calc(${share(segment.count)}% - 1px)` : `${share(segment.count)}%`))
        .style("background", (segment) => typeColor(segment.type));
    });
  items.append("span").attr("class", "bar-value").text((row) => d3.format(",")(row.count));
  items.filter((row) => row.static && row.split).append("span").attr("class", "visually-hidden").text((row) => `: ${row.split}`);
  rowItems.each(function link(row) {
    const anchor = row.other ? null : linkOf(row);
    if (anchor) d3.select(this).append(() => anchor).datum(row);
  });
  const focused = rowItems.filter((row) => !row.other && focusedKey !== undefined && row.key === focusedKey);
  focused.select(linkFocused ? "a" : "button").node()?.focus();
}
