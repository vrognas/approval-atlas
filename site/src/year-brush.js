import * as d3 from "d3";
import { toggleYear } from "./year-slider.js";

// Pure: with paddingOuter = paddingInner / 2 a band scale's steps tile the range exactly,
// so year boundaries sit at left + i * step and a pixel range snaps to whole years.
export function snapToYears(x, [px0, px1]) {
  const years = x.domain();
  const [left] = x.range();
  const step = x.step();
  const clampIndex = (index) => Math.max(0, Math.min(years.length - 1, index));
  let first = clampIndex(Math.round((px0 - left) / step));
  let end = Math.min(years.length, Math.round((px1 - left) / step));
  // A short drag can round both edges to one boundary; take the year it was drawn in, not the next one.
  if (end <= first) {
    first = clampIndex(Math.floor(((px0 + px1) / 2 - left) / step));
    end = first + 1;
  }
  return { from: Number(years[first]), to: Number(years[end - 1]), pixels: [left + first * step, left + end * step] };
}

// Pure: the year whose column (band step) holds pixel px, clamped to the data's years.
export function yearAtPixel(x, px) {
  const years = x.domain();
  const index = Math.floor((px - x.range()[0]) / x.step());
  return Number(years[Math.max(0, Math.min(years.length - 1, index))]);
}

export function pixelsForYears(x, from, to) {
  const years = x.domain().map(Number);
  const [left] = x.range();
  const first = years.indexOf(from ?? years[0]);
  const end = years.indexOf(to ?? years.at(-1)) + 1;
  return [left + first * x.step(), left + end * x.step()];
}

// The x of a mouse or touch event in the svg (a touch end has only changedTouches).
const pointerX = (event, svg) => d3.pointer(event.changedTouches?.[0] ?? event, svg)[0];
// A press and release closer than this (px) is a click, not a drag.
const CLICK_SLOP = 3;

// Draws the brush over an already-rendered per-year chart; re-call after every chart render.
// onRange({ from, to }) fires on release with null = open end; onReadout fires while dragging.
// A click without a drag selects the clicked year alone, or every year when it was the one
// selected year (toggleYear()).
export function attachYearBrush(svg, x, [top, bottom], { from, to }, onRange, onReadout) {
  const years = x.domain().map(Number);
  let press = null;
  const brush = d3.brushX()
    .extent([[x.range()[0], top], [x.range()[1], bottom]])
    .on("start", (event) => {
      if (event.sourceEvent) press = pointerX(event.sourceEvent, svg);
    })
    .on("brush", (event) => {
      if (event.sourceEvent && event.selection) onReadout(snapToYears(x, event.selection));
    })
    .on("end", (event) => {
      if (!event.sourceEvent) return; // programmatic move: ignore, avoids a loop
      const release = pointerX(event.sourceEvent, svg);
      if (!event.selection || Math.abs(release - (press ?? release)) < CLICK_SLOP) {
        onRange(toggleYear(yearAtPixel(x, press ?? release), { from, to }, [years[0], years.at(-1)]));
        return;
      }
      const snapped = snapToYears(x, event.selection);
      onRange({
        from: snapped.from === years[0] ? null : snapped.from,
        to: snapped.to === years.at(-1) ? null : snapped.to,
      });
    });
  const brushGroup = d3.select(svg).append("g").attr("class", "brush").call(brush);
  // Mouse only: the keyboard path is the approval-years slider (year-slider.js).
  brushGroup.selectAll(".overlay, .selection, .handle").attr("aria-hidden", "true");
  if (from !== null || to !== null) brushGroup.call(brush.move, pixelsForYears(x, from, to));
  return brushGroup;
}
