import * as d3 from "d3";
import { hideTooltip, keepsTap, onPressOutside, showTooltip } from "./chart.js";
import { UI, formatDate } from "./labels.js";

const HEIGHT = 260;
const MARGIN = { top: 12, right: 56, bottom: 28, left: 48 };
const SERIES = [
  { key: "authorized_products", label: UI.overTime.products, color: "var(--series-products)" },
  { key: "authorized_substances", label: UI.overTime.substances, color: "var(--series-substances)" },
];
const formatCount = d3.format(",");
const parseDate = d3.utcParse("%Y-%m-%d");

// A touch or pen press released closer than this (px) to where it started is a tap, not a pan.
export const TAP_SLOP = 10;

// Pure: whether a press (pointerdown: { id, type, x, y }, or null) and its release (pointerup:
// { id, x, y }) are a touch or pen tap. A mouse shows a month on hover already.
export function isTap(down, up, slop = TAP_SLOP) {
  return down !== null && down.type !== "mouse" && down.id === up.id && Math.hypot(up.x - down.x, up.y - down.y) <= slop;
}

export function renderOverTimeLegend(list) {
  const items = d3.select(list).selectAll("li").data(SERIES).join("li");
  items.append("span").attr("class", "line-key").attr("aria-hidden", "true").style("background", (series) => series.color);
  items.append("span").text((series) => series.label);
}

// series: [{ date, authorized_products, authorized_substances }]; { from, to } = approval-year range, marked as a band.
export function renderOverTime(container, series, { from, to }) {
  const root = d3.select(container);
  root.selectChildren().remove();
  const width = container.clientWidth;
  const dates = series.map((row) => parseDate(row.date));
  const x = d3.scaleUtc(d3.extent(dates), [MARGIN.left, width - MARGIN.right]);
  const maxValue = d3.max(series, (row) => Math.max(row.authorized_products, row.authorized_substances));
  const y = d3.scaleLinear([0, maxValue || 1], [HEIGHT - MARGIN.bottom, MARGIN.top]).nice();
  const last = series.at(-1);

  const svg = root.append("svg")
    .attr("width", width)
    .attr("height", HEIGHT)
    .attr("viewBox", [0, 0, width, HEIGHT])
    .attr("role", "img")
    .attr("aria-label", UI.overTime.summary(formatDate(last.date), last.authorized_products, last.authorized_substances));

  if (from !== null || to !== null) {
    const [start, end] = x.domain();
    const bandStart = from === null ? start : d3.max([start, new Date(Date.UTC(from, 0, 1))]);
    const bandEnd = to === null ? end : d3.min([end, new Date(Date.UTC(to + 1, 0, 1))]);
    svg.append("rect")
      .attr("class", "range-band")
      .attr("x", x(bandStart))
      .attr("y", MARGIN.top)
      .attr("width", Math.max(0, x(bandEnd) - x(bandStart)))
      .attr("height", HEIGHT - MARGIN.top - MARGIN.bottom)
      .append("title")
      .text(UI.overTime.range);
  }

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
    .call(d3.axisBottom(x).ticks(Math.max(2, Math.floor((width - MARGIN.left - MARGIN.right) / 80))).tickSize(0).tickPadding(8))
    .call((axis) => axis.select(".domain").remove());

  svg.append("line")
    .attr("class", "baseline")
    .attr("x1", MARGIN.left)
    .attr("x2", width - MARGIN.right)
    .attr("y1", y(0))
    .attr("y2", y(0));

  for (const { key, color } of SERIES) {
    svg.append("path")
      .attr("class", "series-line")
      .style("stroke", color)
      .attr("d", d3.line((row, index) => x(dates[index]), (row) => y(row[key]))(series));
  }

  // Values at the line ends; the axis, legend and tooltip carry the rest.
  const ends = svg.append("g").selectAll("g").data(SERIES).join("g")
    .attr("transform", ({ key }) => `translate(${x(dates.at(-1))},${y(last[key])})`);
  ends.append("circle").attr("class", "end-dot").attr("r", 4).style("fill", (series) => series.color);
  ends.append("text").attr("class", "end-label").attr("x", 8).attr("dy", "0.32em").text(({ key }) => formatCount(last[key]));

  const crosshair = svg.append("line").attr("class", "crosshair").attr("y1", MARGIN.top).attr("y2", HEIGHT - MARGIN.bottom).attr("display", "none");
  const bisect = d3.bisector((date) => date).center;
  // Touch (bug hunt 2026-10-01: a tap showed nothing, as it fires no pointermove and the pointer
  // leaves on release): a tap shows the month tapped, as a hover does, and stays until a tap
  // elsewhere; a pan (the page scrolls) hides it, and a mouse moving over the chart takes over
  // (keepsTap()). press: the pointerdown; tapped: a tap shows.
  let press = null;
  let tapped = false;
  function show(event) {
    const [pointerX] = d3.pointer(event, svg.node());
    const index = bisect(dates, x.invert(pointerX));
    const row = series[index];
    crosshair.attr("x1", x(dates[index])).attr("x2", x(dates[index])).attr("display", null);
    const items = SERIES.map(({ key, label, color }) => ({ value: row[key], label, color }));
    showTooltip(container, event, formatDate(row.date), items);
  }
  function hide() {
    tapped = false;
    crosshair.attr("display", "none");
    hideTooltip(container);
  }
  const overlay = svg.append("rect")
    .attr("class", "hover-overlay")
    .attr("x", MARGIN.left)
    .attr("y", MARGIN.top)
    .attr("width", Math.max(0, width - MARGIN.left - MARGIN.right))
    .attr("height", HEIGHT - MARGIN.top - MARGIN.bottom)
    .on("pointerdown", (event) => {
      press = { id: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY };
      tapped = false;
    })
    .on("pointermove", (event) => {
      if (!keepsTap(event.pointerType)) tapped = false;
      show(event);
    })
    .on("pointerup", (event) => {
      if (isTap(press, { id: event.pointerId, x: event.clientX, y: event.clientY })) {
        show(event);
        tapped = true;
      }
      press = null;
    })
    .on("pointercancel", () => {
      press = null;
    })
    .on("pointerleave", () => {
      if (!tapped) hide();
    });
  onPressOutside(container, overlay.node(), () => {
    if (tapped) hide();
  });
}
