import * as d3 from "d3";

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

export function pixelsForYears(x, from, to) {
  const years = x.domain().map(Number);
  const [left] = x.range();
  const first = years.indexOf(from ?? years[0]);
  const end = years.indexOf(to ?? years.at(-1)) + 1;
  return [left + first * x.step(), left + end * x.step()];
}

// Draws the brush over an already-rendered per-year chart; re-call after every chart render.
// onRange({ from, to }) fires on release with null = open end; onReadout fires while dragging.
export function attachYearBrush(svg, x, [top, bottom], { from, to }, onRange, onReadout) {
  const years = x.domain().map(Number);
  const brush = d3.brushX()
    .extent([[x.range()[0], top], [x.range()[1], bottom]])
    .on("brush", (event) => {
      if (event.sourceEvent && event.selection) onReadout(snapToYears(x, event.selection));
    })
    .on("end", (event) => {
      if (!event.sourceEvent) return; // programmatic move: ignore, avoids a loop
      if (!event.selection) {
        onRange({ from: null, to: null }); // a click without a drag clears the range
        return;
      }
      const snapped = snapToYears(x, event.selection);
      onRange({
        from: snapped.from === years[0] ? null : snapped.from,
        to: snapped.to === years.at(-1) ? null : snapped.to,
      });
    });
  const brushGroup = d3.select(svg).append("g").attr("class", "brush").call(brush);
  // Mouse only: the keyboard path is the pair of year inputs in the filter row.
  brushGroup.selectAll(".overlay, .selection, .handle").attr("aria-hidden", "true");
  if (from !== null || to !== null) brushGroup.call(brush.move, pixelsForYears(x, from, to));
  return brushGroup;
}
