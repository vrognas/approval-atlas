import * as d3 from "d3";
import { MEDICINE_TYPES } from "./approvals.js";

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

function tooltipText(row) {
  const total = totalOf(row);
  const lines = MEDICINE_TYPES.map((type) => `${type}: ${formatCount(row[type])}`);
  return [`${row.year}: ${formatCount(total)} ${total === 1 ? "approval" : "approvals"}`, ...lines].join("\n");
}

function summaryText(rows) {
  const total = d3.sum(rows, totalOf);
  const peak = d3.greatest(rows, totalOf);
  return `Stacked column chart of EMA approvals per year by medicine type, ` +
    `${rows[0].year} to ${rows.at(-1).year}: ${formatCount(total)} medicines in total, ` +
    `most in ${peak.year} (${formatCount(totalOf(peak))}).`;
}

function xTickValues(years, plotWidth) {
  const maxTicks = Math.max(1, Math.floor(plotWidth / 44));
  const step = [1, 2, 5, 10, 20].find((candidate) => years.length / candidate <= maxTicks) ?? 50;
  return years.filter((year) => Number(year) % step === 0);
}

export function renderLegend(list) {
  const items = d3.select(list).selectAll("li").data(MEDICINE_TYPES).join("li");
  items.append("span").attr("class", "swatch").attr("aria-hidden", "true").style("background", typeColor);
  items.append("span").text((type) => type);
}

export function renderChart(container, rows) {
  const root = d3.select(container);
  root.selectChildren().remove();
  if (rows.length === 0) {
    root.append("p").attr("class", "muted").text("No dated medicines match the current filters.");
    return;
  }

  const width = container.clientWidth;
  const years = rows.map((row) => row.year);
  const x = d3.scaleBand(years, [MARGIN.left, width - MARGIN.right]).paddingInner(0.2);
  const y = d3.scaleLinear([0, d3.max(rows, totalOf)], [HEIGHT - MARGIN.bottom, MARGIN.top]).nice();
  const barWidth = Math.min(MAX_BAR_WIDTH, x.bandwidth());
  const barOffset = (x.bandwidth() - barWidth) / 2;

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

  columns.append("title").text(tooltipText);

  columns.append("rect")
    .attr("class", "hit")
    .attr("x", (row) => x(row.year) - (x.step() - x.bandwidth()) / 2)
    .attr("y", MARGIN.top)
    .attr("width", x.step())
    .attr("height", HEIGHT - MARGIN.top - MARGIN.bottom);

  // A surface-coloured gap separates stacked segments; a 1px floor keeps a
  // single-medicine segment visible when the gap would otherwise swallow it.
  columns.selectAll("path")
    .data((row) => stackSegments(row).map((segment) => ({ ...segment, row })))
    .join("path")
    .style("fill", (segment) => typeColor(segment.type))
    .attr("d", (segment) => {
      const top = y(segment.upper);
      const gap = segment.lower > 0 ? SEGMENT_GAP : 0;
      const height = Math.max(1, y(segment.lower) - top - gap);
      const isTop = segment.upper === totalOf(segment.row);
      return columnPath(x(segment.row.year) + barOffset, top, barWidth, height, isTop ? CORNER_RADIUS : 0);
    });
}
