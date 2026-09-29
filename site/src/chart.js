import * as d3 from "d3";
import { companyBadge } from "./holders.js";
import { UI } from "./labels.js";
import { atPointer, tipBounds } from "./tips.js";
import { attachYearBrush } from "./year-brush.js";

const HEIGHT = 320;
const MARGIN = { top: 12, right: 8, bottom: 28, left: 40 };
const MAX_BAR_WIDTH = 24;
const SEGMENT_GAP = 1;
const CORNER_RADIUS = 4;
const formatCount = d3.format(",");

export function typeColor(type) {
  return `var(--type-${type.toLowerCase().replaceAll(" ", "-")})`;
}

// A column's height: its stack counts summed (in the ATC stacks a medicine can count in several).
function stackedOf(row, series) {
  return d3.sum(series, (item) => row.counts.get(item.key) ?? 0);
}

function stackSegments(row, series) {
  let lower = 0;
  return series.filter((item) => row.counts.get(item.key) > 0).map((item) => {
    const segment = { item, lower, upper: lower + row.counts.get(item.key) };
    lower = segment.upper;
    return segment;
  });
}

// Only the top of a column is rounded; the baseline end stays square.
function columnPath(x, y, width, height, radius) {
  const r = Math.min(radius, height, width / 2);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}` +
    `H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

// The medicines counted (each once), not the stacked height.
function summaryText(rows, by) {
  const peak = d3.greatest(rows, (row) => row.total);
  return UI.years.summary(rows[0].year, rows.at(-1).year, d3.sum(rows, (row) => row.total), peak.year, peak.total, by);
}

function xTickValues(years, plotWidth) {
  const maxTicks = Math.max(1, Math.floor(plotWidth / 44));
  const step = [1, 2, 5, 10, 20].find((candidate) => years.length / candidate <= maxTicks) ?? 50;
  return years.filter((year) => Number(year) % step === 0);
}

// A low-key series (Other: stroke) is drawn as an outline on its fill; swatches and keys too.
const outline = (item) => (item.stroke ? `inset 0 0 0 1px ${item.stroke}` : null);

// A hatched series (the medicines a mode cannot place: hatch) is told apart from Other by diagonal
// --field-border lines on its fill: an SVG pattern in the chart, a gradient in swatches and keys.
const HATCH_ID = "stack-hatch";
const HATCH_STEP = 4;
const swatchOf = (item) => (item.hatch
  ? `repeating-linear-gradient(135deg, ${item.stroke} 0 1px, ${item.color} 1px ${HATCH_STEP}px)`
  : item.color);
const fillOf = (item) => (item.hatch ? `url(#${HATCH_ID})` : item.color);

function appendHatch(svg, item) {
  const pattern = svg.append("defs").append("pattern")
    .attr("id", HATCH_ID)
    .attr("patternUnits", "userSpaceOnUse")
    .attr("width", HATCH_STEP)
    .attr("height", HATCH_STEP)
    .attr("patternTransform", "rotate(45)");
  pattern.append("rect").attr("width", HATCH_STEP).attr("height", HATCH_STEP).style("fill", item.color);
  pattern.append("line").attr("x1", HATCH_STEP / 2).attr("y1", 0).attr("x2", HATCH_STEP / 2).attr("y2", HATCH_STEP)
    .style("stroke", item.stroke).style("stroke-width", "1.5px");
}

// A chart's tooltip (element, absolute in container, which is positioned) at the pointer (the
// event's viewport position; owner decision 2026-09-29), as the data-tip tips: 12px below and right
// of it inside the viewport, flipped above or left without room (atPointer()). It takes no pointer
// events, so it follows the pointer.
export function placeTooltip(element, container, event) {
  const place = atPointer({ x: event.clientX, y: event.clientY }, { width: element.offsetWidth, height: element.offsetHeight },
    tipBounds(document.documentElement.clientWidth, document.documentElement.clientHeight));
  const box = container.getBoundingClientRect();
  d3.select(element)
    .style("left", `${place.left - box.left - container.clientLeft}px`)
    .style("top", `${place.top - box.top - container.clientTop}px`);
}

// One tooltip per chart container, at the pointer (event): the value leads, the series name
// follows, keyed by a short line.
export function showTooltip(container, event, title, items) {
  const tooltip = d3.select(container).selectAll(".tooltip").data([null]).join("div").attr("class", "tooltip").attr("hidden", null);
  tooltip.selectChildren().remove();
  tooltip.append("p").attr("class", "tooltip-title").text(title);
  const rows = tooltip.selectAll("p.tooltip-row").data(items).join("p").attr("class", "tooltip-row");
  rows.append("span").attr("class", "line-key").style("background", (item) => item.color).style("box-shadow", outline);
  rows.append("strong").text((item) => formatCount(item.value));
  rows.append("span").text((item) => item.label);
  placeTooltip(tooltip.node(), container, event);
}

export function hideTooltip(container) {
  d3.select(container).select(".tooltip").attr("hidden", "");
}

// types: the medicine types to list (the stacked ATC breakdown shows only those present).
export function renderLegend(list, types) {
  const items = d3.select(list).selectAll("li").data(types).join("li");
  items.selectChildren().remove();
  items.append("span").attr("class", "swatch").attr("aria-hidden", "true").style("background", typeColor);
  items.append("span").text((type) => type);
}

// The per-year chart's legend: "Bottom to top:", then the stack series in stack order (position
// tells the segments apart, not only colour). series: [{ key, label, color, tip }]; an entry with a
// tip (the statuses; a company's EMA holder names) explains itself on hover and on a tap (tabindex
// -1: focusable, no tab stop), as the type and status badges do; an entry with a badge (a company
// group, companies part 2) shows its monogram before its name.
export function renderStackLegend(list, series) {
  const root = d3.select(list);
  root.selectChildren().remove();
  if (series.length === 0) return;
  root.append("li").attr("class", "legend-lead").text(UI.years.legendLead);
  const items = root.selectAll("li.legend-series").data(series).join("li").attr("class", "legend-series");
  items.filter((item) => item.tip).attr("data-tip", (item) => item.tip).attr("tabindex", "-1");
  items.append("span").attr("class", "swatch").attr("aria-hidden", "true").style("background", swatchOf).style("box-shadow", outline);
  items.filter((item) => item.badge).append((item) => companyBadge(item.badge));
  items.append("span").text((item) => item.label);
}

// rows: yearStacks() output, every year of the data (zeros included) so the brush's year grid stays
// fixed. series: [{ key, label, color, stroke: an outline for a low-key series, hatch: its fill
// hatched with the stroke colour }] bottom to top.
// by: what the columns are stacked by, for the summary (UI.years.by). The chart ignores the
// approval-year filter itself: years outside the range are greyed.
export function renderChart(container, { rows, series, by }, { from, to }, onRange, onReadout) {
  const root = d3.select(container);
  root.selectChildren().remove();
  if (d3.sum(rows, (row) => stackedOf(row, series)) === 0) {
    root.append("p").attr("class", "muted").text(UI.years.empty);
    return;
  }

  // No width yet (laid out at 0, as while the page is hidden): nothing to draw, and the brush's extent
  // would be negative; the container's ResizeObserver (main.js) draws it once it has one.
  const width = container.clientWidth;
  if (width <= MARGIN.left + MARGIN.right) return;
  const years = rows.map((row) => row.year);
  // paddingOuter = paddingInner / 2 makes the bands tile the range, so the brush snaps to years.
  const x = d3.scaleBand(years, [MARGIN.left, width - MARGIN.right]).paddingInner(0.2).paddingOuter(0.1);
  const y = d3.scaleLinear([0, d3.max(rows, (row) => stackedOf(row, series))], [HEIGHT - MARGIN.bottom, MARGIN.top]).nice();
  const barWidth = Math.min(MAX_BAR_WIDTH, x.bandwidth());
  const barOffset = (x.bandwidth() - barWidth) / 2;
  const inRange = (year) => (from === null || Number(year) >= from) && (to === null || Number(year) <= to);

  const svg = root.append("svg")
    .attr("width", width)
    .attr("height", HEIGHT)
    .attr("viewBox", [0, 0, width, HEIGHT])
    .attr("role", "img")
    .attr("aria-label", summaryText(rows, by));
  const hatched = series.find((item) => item.hatch);
  if (hatched) appendHatch(svg, hatched);

  svg.append("g")
    .attr("class", "axis y-axis")
    .attr("transform", `translate(${MARGIN.left},0)`)
    .call(d3.axisLeft(y)
      .tickValues(y.ticks(5).filter(Number.isInteger))
      .tickFormat(formatCount)
      .tickSize(-(width - MARGIN.left - MARGIN.right))
      .tickPadding(8))
    .call((axis) => axis.select(".domain").remove());

  svg.append("g")
    .attr("class", "axis x-axis")
    .attr("transform", `translate(0,${HEIGHT - MARGIN.bottom})`)
    .call(d3.axisBottom(x)
      .tickValues(xTickValues(years, width - MARGIN.left - MARGIN.right))
      .tickSize(0)
      .tickPadding(8))
    .call((axis) => axis.select(".domain").remove());

  svg.append("line")
    .attr("class", "baseline")
    .attr("x1", MARGIN.left)
    .attr("x2", width - MARGIN.right)
    .attr("y1", y(0))
    .attr("y2", y(0));

  const columns = svg.append("g")
    .selectAll("g")
    .data(rows)
    .join("g")
    .attr("class", "year");

  const hits = columns.append("rect")
    .attr("class", "hit")
    .attr("x", (row) => x(row.year) - (x.step() - x.bandwidth()) / 2)
    .attr("y", MARGIN.top)
    .attr("width", x.step())
    .attr("height", HEIGHT - MARGIN.top - MARGIN.bottom);

  // A 1px surface-colored gap separates stacked segments (neighbours of similar lightness stay
  // apart); a 1px floor keeps a single-medicine segment visible when the gap would swallow it.
  columns.selectAll("path")
    .data((row) => stackSegments(row, series).map((segment) => ({ ...segment, row })))
    .join("path")
    .style("fill", (segment) => (inRange(segment.row.year) ? fillOf(segment.item) : "var(--out-of-range)"))
    .style("stroke", (segment) => (inRange(segment.row.year) && segment.item.stroke ? segment.item.stroke : null))
    .style("stroke-width", (segment) => (segment.item.stroke ? "1px" : null))
    .attr("d", (segment) => {
      const top = y(segment.upper);
      const gap = segment.lower > 0 ? SEGMENT_GAP : 0;
      const height = Math.max(1, y(segment.lower) - top - gap);
      const isTop = segment.upper === stackedOf(segment.row, series);
      return columnPath(x(segment.row.year) + barOffset, top, barWidth, height, isTop ? CORNER_RADIUS : 0);
    });

  attachYearBrush(svg.node(), x, [MARGIN.top, HEIGHT - MARGIN.bottom], { from, to }, onRange, onReadout);

  // The brush overlay sits on top of the columns, so hover is resolved from the pointer's x.
  svg.on("pointermove", (event) => {
    const [pointerX] = d3.pointer(event);
    const index = Math.floor((pointerX - x.range()[0]) / x.step());
    const row = rows[index];
    hits.classed("hover", (candidate) => candidate === row);
    if (!row) return hideTooltip(container);
    // Listed top to bottom, as stacked; the series without medicines that year are left out.
    const items = [...series].reverse()
      .filter((item) => row.counts.get(item.key) > 0)
      // A 2px key's outline would cover its hatch: the hatched one reads as a dashed line instead.
      .map((item) => ({ value: row.counts.get(item.key), label: item.label, color: swatchOf(item), stroke: item.hatch ? null : item.stroke }));
    showTooltip(container, event, UI.years.tooltipTitle(row.year, row.total), items);
  });
  svg.on("pointerleave", () => {
    hits.classed("hover", false);
    hideTooltip(container);
  });
}
