// Results timeline: x = approval date (UTC), one lane per medicine type present, one dot per
// medicine (dodged), thin lines joining a substance family. Hover or tap shows a tooltip; tapping
// a dot pins it so its name link can be followed. The result list below is the non-visual equivalent.
import * as d3 from "d3";
import { UI, formatDate, statusLabel } from "./labels.js";
import { families, layoutLanes } from "./timeline-layout.js";

const RADIUS = 4;
const STEP = 10; // dot diameter plus its 2px surface ring
const LANE_LABEL = 20;
const LANE_GAP = 10;
const MARGIN = { top: 4, right: 12, bottom: 28, left: 12 };
const HIT_RADIUS = 24; // pointer distance that still finds a dot
const DAY = 864e5;
const parseDate = d3.utcParse("%Y-%m-%d");
const typeColor = (type) => `var(--type-${type.toLowerCase().replaceAll(" ", "-")})`;

function summary(dots, lanes) {
  const years = d3.extent(dots, (dot) => dot.date.slice(0, 4));
  const counts = lanes.map((lane) => `${lane.dots.length} ${lane.type}`).join(", ");
  return UI.timeline.summary(dots.length, years[0], years[1], counts);
}

// items: [{ id, name, date, type, family, status, holder }]; link(item) -> <a> that opens the card.
export function renderTimeline(container, items, { link }) {
  const root = d3.select(container);
  root.selectChildren().remove();
  const dated = items.filter((item) => item.date !== null);
  const undated = items.length - dated.length;
  if (dated.length === 0) {
    if (undated) root.append("p").attr("class", "muted").text(UI.timeline.undated(undated));
    return;
  }
  const width = container.clientWidth;
  const [first, last] = d3.extent(dated, (item) => parseDate(item.date));
  const pad = Math.max(180 * DAY, (last - first) * 0.03);
  const x = d3.scaleUtc([new Date(+first - pad), new Date(+last + pad)], [MARGIN.left, width - MARGIN.right]);
  const lanes = layoutLanes(dated.map((item) => ({ ...item, x: x(parseDate(item.date)) })), STEP);

  let top = MARGIN.top;
  for (const lane of lanes) {
    lane.top = top;
    lane.center = top + LANE_LABEL + (-lane.minSlot) * STEP + RADIUS + 1;
    for (const dot of lane.dots) dot.y = lane.center + dot.slot * STEP;
    top += LANE_LABEL + (lane.maxSlot - lane.minSlot + 1) * STEP + LANE_GAP;
  }
  const height = top + MARGIN.bottom;
  const dots = lanes.flatMap((lane) => lane.dots);

  const svg = root.append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [0, 0, width, height])
    .attr("role", "img")
    .attr("aria-label", summary(dots, lanes));

  const laneGroups = svg.append("g").selectAll("g").data(lanes).join("g");
  laneGroups.append("line")
    .attr("class", "lane-line")
    .attr("x1", MARGIN.left)
    .attr("x2", width - MARGIN.right)
    .attr("y1", (lane) => lane.center)
    .attr("y2", (lane) => lane.center);
  laneGroups.append("text")
    .attr("class", "lane-label")
    .attr("x", MARGIN.left)
    .attr("y", (lane) => lane.top + 13)
    .text((lane) => lane.type);

  svg.append("g")
    .selectAll("path")
    .data(families(dots))
    .join("path")
    .attr("class", "family-line")
    .attr("d", d3.line((dot) => dot.x, (dot) => dot.y));

  const circles = svg.append("g")
    .selectAll("circle")
    .data(dots)
    .join("circle")
    .attr("class", "dot")
    .attr("cx", (dot) => dot.x)
    .attr("cy", (dot) => dot.y)
    .attr("r", RADIUS)
    .style("fill", (dot) => typeColor(dot.type));

  svg.append("g")
    .attr("class", "axis x-axis")
    .attr("transform", `translate(0,${height - MARGIN.bottom + 4})`)
    .call(d3.axisBottom(x).ticks(Math.max(2, Math.floor((width - MARGIN.left - MARGIN.right) / 80))).tickSize(0).tickPadding(8))
    .call((axis) => axis.select(".domain").remove());

  if (undated) root.append("p").attr("class", "muted").text(UI.timeline.undated(undated));

  const delaunay = d3.Delaunay.from(dots, (dot) => dot.x, (dot) => dot.y);
  const nearest = (event) => {
    const [px, py] = d3.pointer(event, svg.node());
    const dot = dots[delaunay.find(px, py)];
    return Math.hypot(dot.x - px, dot.y - py) <= HIT_RADIUS ? dot : null;
  };
  let pinned = null;
  const tip = root.append("div").attr("class", "timeline-tip").attr("hidden", "");

  function show(dot, pin) {
    pinned = pin ? dot : null;
    circles.classed("active", (candidate) => candidate === dot);
    tip.attr("hidden", null).classed("pinned", pin).selectChildren().remove();
    tip.append("p").attr("class", "tip-name").append(() => link(dot));
    tip.append("p").text(`${formatDate(dot.date)} · ${statusLabel(dot.status)}`);
    if (dot.holder) tip.append("p").attr("class", "tip-holder").text(dot.holder);
    const tipWidth = tip.node().offsetWidth;
    const left = dot.x + 12 + tipWidth > width ? Math.max(0, dot.x - 12 - tipWidth) : dot.x + 12;
    tip.style("left", `${left}px`).style("top", `${dot.y + 10}px`);
  }
  function hide() {
    pinned = null;
    circles.classed("active", false);
    tip.attr("hidden", "");
  }

  svg.on("pointermove", (event) => {
    if (pinned || event.pointerType === "touch") return;
    const dot = nearest(event);
    if (dot) show(dot, false);
    else hide();
  });
  svg.on("pointerleave", () => {
    if (!pinned) hide();
  });
  svg.on("click", (event) => {
    const dot = nearest(event);
    if (dot && dot !== pinned) show(dot, true);
    else hide();
  });
  tip.on("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
}
