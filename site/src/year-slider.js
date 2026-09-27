// The approval-years strip (main column, index.html #year-strip): a compact per-year histogram of
// every medicine with an approval date, stacked by current status (aria-hidden, with a text
// summary and a legend), above a two-thumb range slider: two native range inputs over one track;
// the thumbs take the pointer, and a click on the track moves the nearest thumb there (no drag
// needed, WCAG 2.5.7). Each bar sits at its year's thumb position; a click on a bar selects that
// year alone, on the one selected year's bar every year (the bars take no focus: the slider is
// the keyboard path).
import * as d3 from "d3";
import { byStatusOrder } from "./approvals.js";
import { statusHue } from "./badges.js";
import { UI, statusLabel } from "./labels.js";
import { normalizeYearRange } from "./url.js";

const PAGE_YEARS = 5;
const TICK_HEIGHT = 18;
const MAX_BAR_WIDTH = 16;
// Stacked status segments are 1px apart (the card shows through), so neighbours of similar
// lightness stay distinct.
const SEGMENT_GAP = 1;

// Pure: a native range thumb's centre (px from the input's left edge). Browsers keep the thumb
// inside the input, so it travels from thumb / 2 to width - thumb / 2.
export function thumbCenter(value, [min, max], width, thumb) {
  return thumb / 2 + ((value - min) / (max - min)) * (width - thumb);
}

// Pure: the year whose thumb centre is nearest x (thumbCenter() inverted), within the data range.
export function yearAt(x, [min, max], width, thumb) {
  const year = Math.round(min + ((x - thumb / 2) / (width - thumb)) * (max - min));
  return Math.min(max, Math.max(min, year));
}

// Pure: the thumb a click on the track or a bar moves: the closer one; at equal distance (or on
// the same year) the start thumb below the range, else the end thumb.
export function nearestThumb(year, start, end) {
  const toStart = Math.abs(year - start);
  const toEnd = Math.abs(year - end);
  if (toStart !== toEnd) return toStart < toEnd ? "start" : "end";
  return year < start ? "start" : "end";
}

// Pure: the thumbs after one moved (moved: "start" | "end"); the moved one stops at the other, so
// they never cross. from/to: the year filter, null where a thumb is at the data's first or last
// year (open end, as normalizeYearRange()).
export function thumbRange(start, end, moved, years) {
  const [lower, upper] = moved === "start" ? [Math.min(start, end), end] : [start, Math.max(start, end)];
  return { start: lower, end: upper, ...normalizeYearRange(lower, upper, years) };
}

// Pure: where the thumbs overlap (or coincide), the one that can move away lies on top: the start
// thumb when the range sits in the right half, else the end thumb.
export function startOnTop(start, end, [first, last]) {
  return start + end > first + last;
}

// Pure: the year filter after a click on a year's bar (here or in the per-year chart): that year
// alone, or every year when it was already the one selected year. from/to: null = open end.
export function toggleYear(year, { from, to }, years) {
  const [first, last] = years;
  if ((from ?? first) === year && (to ?? last) === year) return { from: null, to: null };
  return normalizeYearRange(year, year, years);
}

// Pure: x-axis years, every 5 years when their labels fit, else every 10.
export function yearTicks([first, last], pixelsPerYear) {
  const every = pixelsPerYear * 5 >= 40 ? 5 : 10;
  return d3.range(first, last + 1).filter((year) => year % every === 0);
}

// root: #year-strip. years: [first, last] of the data. onRange({ from, to }): the year filter
// (null = open end) changed.
export function createYearStrip(root, { years, onRange }) {
  const [first, last] = years;
  const chart = root.querySelector("#year-hist");
  const summary = root.querySelector("#year-hist-summary");
  const slider = root.querySelector(".year-slider");
  const fill = root.querySelector(".year-track-fill");
  const reset = root.querySelector("#year-reset");
  const legend = root.querySelector("#year-legend");
  const undatedNote = root.querySelector("#year-undated");
  const inputs = { start: root.querySelector("#year-start"), end: root.querySelector("#year-end") };
  const values = { start: root.querySelector("#year-start-value"), end: root.querySelector("#year-end-value") };
  let applied = { from: null, to: null }; // the filter as last rendered
  let latest = applied;
  // A pointer drag is under way: the thumbs are ahead of the state until release. The filter
  // waits for it, as the headline and sentence above would reflow and move the strip mid-drag.
  let dragging = false;
  let current = { start: first, end: last };
  let bars = d3.select(null);
  const thumbSize = () => parseFloat(getComputedStyle(slider).getPropertyValue("--thumb"));

  function apply() {
    dragging = false;
    if (latest.from === applied.from && latest.to === applied.to) return;
    onRange(latest);
    applied = latest; // release fires pointerup and change: apply once
  }

  // Thumbs, year texts, track and bar colours follow at once.
  function show(start, end) {
    current = { start, end };
    for (const key of ["start", "end"]) {
      inputs[key].value = current[key];
      inputs[key].setAttribute("aria-valuetext", String(current[key]));
      values[key].textContent = current[key];
    }
    slider.classList.toggle("start-on-top", startOnTop(start, end, years));
    d3.select(fill)
      .style("left", `${(100 * (start - first)) / (last - first)}%`)
      .style("right", `${(100 * (last - end)) / (last - first)}%`);
    bars.classed("in-range", (row) => row.year >= start && row.year <= end);
    reset.disabled = start === first && end === last;
  }

  // settle: a key press, a click or the end of a drag applies the filter; dragging, it waits.
  function move(key, value, settle) {
    const next = thumbRange(key === "start" ? value : current.start, key === "end" ? value : current.end, key, years);
    show(next.start, next.end);
    latest = { from: next.from, to: next.to };
    if (settle) apply();
    else dragging = true;
  }

  // A click on the track: the nearest thumb moves there and takes focus (as a native slider's
  // track click).
  function jump(year) {
    const key = nearestThumb(year, current.start, current.end);
    move(key, year, true);
    inputs[key].focus({ preventScroll: true });
  }

  // A click on a year's bar: that year alone, or every year again (toggleYear()).
  function pickYear(year) {
    latest = toggleYear(year, applied, years);
    show(latest.from ?? first, latest.to ?? last);
    apply();
  }

  for (const [key, input] of Object.entries(inputs)) {
    Object.assign(input, { min: first, max: last, step: 1 });
    input.setAttribute("aria-label", UI.yearStrip[key]);
    // Keys fire input then change at once; a drag, input until release.
    input.addEventListener("input", () => move(key, input.valueAsNumber, false));
    input.addEventListener("change", () => move(key, input.valueAsNumber, true));
    // Browsers step PageUp/PageDown by a tenth of the range; here, 5 years.
    input.addEventListener("keydown", (event) => {
      const direction = { PageUp: 1, PageDown: -1 }[event.key];
      if (!direction) return;
      event.preventDefault();
      move(key, Math.min(last, Math.max(first, input.valueAsNumber + direction * PAGE_YEARS)), true);
    });
  }
  reset.addEventListener("click", () => {
    latest = { from: null, to: null };
    show(first, last);
    apply();
    inputs.start.focus(); // the button is disabled now
  });
  // A drag that ends on the year it started from fires no change event.
  for (const type of ["pointerup", "pointercancel"]) {
    window.addEventListener(type, () => {
      if (dragging) apply();
    });
  }
  // The inputs ignore the pointer outside their thumbs, so track clicks reach the slider. A click
  // ending a thumb drag lands there too (the common ancestor): only presses on the track count.
  let pressOnTrack = false;
  slider.addEventListener("pointerdown", (event) => {
    pressOnTrack = !(event.target instanceof HTMLInputElement);
  });
  slider.addEventListener("click", (event) => {
    if (!pressOnTrack) return;
    const box = slider.getBoundingClientRect();
    jump(yearAt(event.clientX - box.left, years, box.width, thumbSize()));
  });

  // rows: yearHistogram() output (statuses bottom up); bars line up with the thumbs (thumbCenter()).
  function draw(rows) {
    const width = chart.clientWidth;
    const height = chart.clientHeight;
    const thumb = thumbSize();
    const x = (year) => thumbCenter(year, years, width, thumb);
    const step = (width - thumb) / (last - first);
    const barWidth = Math.max(2, Math.min(MAX_BAR_WIDTH, step * 0.64));
    const bottom = height - TICK_HEIGHT;
    const y = d3.scaleLinear([0, d3.max(rows, (row) => row.count) || 1], [bottom, 2]);
    const segments = (row) => {
      let lower = 0;
      return row.statuses.map(({ status, count }) => {
        const segment = { status, lower, upper: lower + count };
        lower = segment.upper;
        return segment;
      });
    };

    const container = d3.select(chart);
    container.selectChildren().remove();
    const svg = container.append("svg").attr("width", width).attr("height", height).attr("viewBox", [0, 0, width, height]).attr("focusable", "false");
    const columns = svg.append("g").selectAll("g").data(rows).join("g").attr("class", "year-col").on("click", (event, row) => pickYear(row.year));
    columns.append("title").text((row) => UI.yearStrip.tooltip(row.year, row.count, row.statuses));
    columns.append("rect")
      .attr("class", "year-hit")
      .attr("x", (row) => x(row.year) - step / 2)
      .attr("width", step)
      .attr("height", bottom);
    // A 1px floor keeps a one-medicine segment visible when the gap would swallow it.
    columns.selectAll("rect.year-bar")
      .data((row) => segments(row).map((segment) => ({ ...segment, year: row.year })))
      .join("rect")
      .attr("class", (segment) => `year-bar hue-${statusHue(segment.status)}`)
      .attr("x", (segment) => x(segment.year) - barWidth / 2)
      .attr("y", (segment) => Math.min(y(segment.upper), bottom - 1))
      .attr("width", barWidth)
      .attr("height", (segment) => Math.max(1, y(segment.lower) - y(segment.upper) - (segment.lower > 0 ? SEGMENT_GAP : 0)));
    bars = columns;
    svg.append("line").attr("class", "year-baseline").attr("x1", 0).attr("x2", width).attr("y1", bottom).attr("y2", bottom);
    svg.append("g")
      .selectAll("text")
      .data(yearTicks(years, step))
      .join("text")
      .attr("class", "year-tick")
      .attr("x", x)
      .attr("y", height - 4)
      .text((year) => year);

    // The statuses shown, in stack order, with their totals: summary and legend.
    const totals = d3.rollup(rows.flatMap((row) => row.statuses), (items) => d3.sum(items, (item) => item.count), (item) => item.status);
    const statuses = [...totals.keys()].sort(byStatusOrder).map((status) => ({ status, count: totals.get(status) }));
    const peak = d3.greatest(rows, (row) => row.count);
    summary.textContent = UI.yearStrip.summary(first, last, d3.sum(rows, (row) => row.count), peak.year, peak.count, statuses);
    // "Bottom to top:", then the statuses in stack order.
    if (!legend.querySelector(".legend-lead")) d3.select(legend).append("li").attr("class", "legend-lead").text(UI.yearStrip.legendLead);
    d3.select(legend).select(".legend-lead").attr("hidden", statuses.length ? null : "");
    const items = d3.select(legend).selectAll("li.legend-status").data(statuses, (item) => item.status).join((enter) => {
      const item = enter.append("li").attr("class", "legend-status");
      item.append("span").attr("class", (row) => `swatch hue-${statusHue(row.status)}`);
      item.append("span").text((row) => statusLabel(row.status));
      return item;
    });
    items.order();
  }

  return {
    // The dashboard's render: counts follow the other filters; the thumbs follow the state (the
    // per-year chart's brush, the sentence's remove buttons, Reset) unless a drag is ahead of it.
    // undated: the medicines matching the other filters that have no approval date (not shown).
    render({ rows, from, to, undated }) {
      applied = { from, to };
      draw(rows);
      d3.select(undatedNote).text(undated ? UI.yearStrip.undated(undated) : "");
      if (dragging) show(current.start, current.end);
      else {
        latest = applied;
        show(from ?? first, to ?? last);
      }
    },
    // The sentence's year tokens: key "start" | "end".
    focus(key) {
      root.scrollIntoView({ block: "nearest" });
      inputs[key].focus({ preventScroll: true });
    },
  };
}
