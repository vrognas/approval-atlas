import * as d3 from "d3";
import { MEDICINE_TYPES } from "./approvals.js";
import { UI } from "./labels.js";
import { attachYearBrush } from "./year-brush.js";

const HEIGHT = 320;
const MARGIN = { top: 12, right: 8, bottom: 28, left: 40 };
const MAX_BAR_WIDTH = 24;
const SEGMENT_GAP = 2;
const CORNER_RADIUS = 4;
const formatCount = d3.format(",");

function typeColor(type) {
  return `var(--type-${type.toLowerCase().replaceAll(" ", "-")})`;
}

function totalOf(row) {
  return d3.sum(MEDICINE_TYPES, (type) => row[type]);
}

function stackSegments(row) {
  let lower = 0;
  return MEDICINE_TYPES.filter((type) => row[type] > 0).map((type) => {
    const segment = { type, lower, upper: lower + row[type] };
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

function summaryText(rows) {
  const peak = d3.greatest(rows, totalOf);
  return UI.years.summary(rows[0].year, rows.at(-1).year, d3.sum(rows, totalOf), peak.year, totalOf(peak));
}

function xTickValues(years, plotWidth) {
  const maxTicks = Math.max(1, Math.floor(plotWidth / 44));
  const step = [1, 2, 5, 10, 20].find((candidate) => years.length / candidate <= maxTicks) ?? 50;
  return years.filter((year) => Number(year) % step === 0);
}

// One tooltip per chart container: the value leads, the series name follows, keyed by a short line.
export function showTooltip(container, [left, top], title, items) {
  const tooltip = d3.select(container).selectAll(".tooltip").data([null]).join("div").attr("class", "tooltip").attr("hidden", null);
  tooltip.selectChildren().remove();
  tooltip.append("p").attr("class", "tooltip-title").text(title);
  const rows = tooltip.selectAll("p.tooltip-row").data(items).join("p").attr("class", "tooltip-row");
  rows.append("span").attr("class", "line-key").style("background", (item) => item.color);
  rows.append("strong").text((item) => formatCount(item.value));
  rows.append("span").text((item) => item.label);
  const width = tooltip.node().offsetWidth;
  const flip = left + 16 + width > container.clientWidth;
  tooltip.style("left", `${flip ? left - 16 - width : left + 16}px`).style("top", `${top}px`);
}

export function hideTooltip(container) {
  d3.select(container).select(".tooltip").attr("hidden", "");
}

export function renderLegend(list) {
  const items = d3.select(list).selectAll("li").data(MEDICINE_TYPES).join("li");
  items.append("span").attr("class", "swatch").attr("aria-hidden", "true").style("background", typeColor);
  items.append("span").text((type) => type);
}

// rows cover every year of the data (zeros included) so the brush's year grid stays fixed.
// The chart ignores the approval-year filter itself: years outside the range are greyed.
export function renderChart(container, rows, { from, to }, onRange, onReadout) {
  const root = d3.select(container);
  root.selectChildren().remove();
  if (d3.sum(rows, totalOf) === 0) {
    root.append("p").attr("class", "muted").text(UI.years.empty);
    return;
  }

  const width = container.clientWidth;
  const years = rows.map((row) => row.year);
  // paddingOuter = paddingInner / 2 makes the bands tile the range, so the brush snaps to years.
  const x = d3.scaleBand(years, [MARGIN.left, width - MARGIN.right]).paddingInner(0.2).paddingOuter(0.1);
  const y = d3.scaleLinear([0, d3.max(rows, totalOf)], [HEIGHT - MARGIN.bottom, MARGIN.top]).nice();
  const barWidth = Math.min(MAX_BAR_WIDTH, x.bandwidth());
  const barOffset = (x.bandwidth() - barWidth) / 2;
  const inRange = (year) => (from === null || Number(year) >= from) && (to === null || Number(year) <= to);

  const svg = root.append("svg")
    .attr("width", width)
    .attr("height", HEIGHT)
    .attr("viewBox", [0, 0, width, HEIGHT])
    .attr("role", "img")
    .attr("aria-label", summaryText(rows));

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

  // A surface-colored gap separates stacked segments; a 1px floor keeps a
  // single-medicine segment visible when the gap would otherwise swallow it.
  columns.selectAll("path")
    .data((row) => stackSegments(row).map((segment) => ({ ...segment, row })))
    .join("path")
    .style("fill", (segment) => (inRange(segment.row.year) ? typeColor(segment.type) : "var(--out-of-range)"))
    .attr("d", (segment) => {
      const top = y(segment.upper);
      const gap = segment.lower > 0 ? SEGMENT_GAP : 0;
      const height = Math.max(1, y(segment.lower) - top - gap);
      const isTop = segment.upper === totalOf(segment.row);
      return columnPath(x(segment.row.year) + barOffset, top, barWidth, height, isTop ? CORNER_RADIUS : 0);
    });

  attachYearBrush(svg.node(), x, [MARGIN.top, HEIGHT - MARGIN.bottom], { from, to }, onRange, onReadout);

  // The brush overlay sits on top of the columns, so hover is resolved from the pointer's x.
  svg.on("pointermove", (event) => {
    const [pointerX, pointerY] = d3.pointer(event);
    const index = Math.floor((pointerX - x.range()[0]) / x.step());
    const row = rows[index];
    hits.classed("hover", (candidate) => candidate === row);
    if (!row) return hideTooltip(container);
    // Listed top to bottom, as stacked.
    const items = [...MEDICINE_TYPES].reverse().map((type) => ({ value: row[type], label: type, color: typeColor(type) }));
    showTooltip(container, [pointerX, pointerY], UI.years.tooltipTitle(row.year, totalOf(row)), items);
  });
  svg.on("pointerleave", () => {
    hits.classed("hover", false);
    hideTooltip(container);
  });
}
