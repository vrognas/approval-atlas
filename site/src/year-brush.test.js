import { test } from "node:test";
import assert from "node:assert/strict";
import * as d3 from "d3";
import { isTouch, isTouchTap, pixelsForYears, snapToYears, yearAtPixel, yearTapAction } from "./year-brush.js";

const years = d3.range(1995, 2027).map(String);
// Same padding as chart.js: paddingOuter = paddingInner / 2 makes the steps tile the range.
const x = d3.scaleBand(years, [40, 1032]).paddingInner(0.2).paddingOuter(0.1);
const step = x.step();

test("the chart's band scale tiles the range exactly", () => {
  assert.equal(step * years.length, 1032 - 40);
});

test("snapToYears rounds to year boundaries and keeps at least one year", () => {
  assert.deepEqual(snapToYears(x, [40 + 15.4 * step, 40 + 20.6 * step]), { from: 2010, to: 2015, pixels: [40 + 15 * step, 40 + 21 * step] });
  assert.equal(snapToYears(x, [40 + 3.1 * step, 40 + 3.2 * step]).to, 1998);
  assert.deepEqual(snapToYears(x, [0, 5000]), { from: 1995, to: 2026, pixels: [40, 1032] });
});

test("a short drag inside one column selects that column", () => {
  for (const [start, end] of [[3.6, 3.7], [3.55, 3.95], [3.1, 3.2]]) {
    assert.deepEqual(snapToYears(x, [40 + start * step, 40 + end * step]), { from: 1998, to: 1998, pixels: [40 + 3 * step, 40 + 4 * step] });
  }
});

test("yearAtPixel: the year whose column holds a click, clamped to the data", () => {
  assert.equal(yearAtPixel(x, 40), 1995);
  assert.equal(yearAtPixel(x, 40 + 15.5 * step), 2010);
  assert.equal(yearAtPixel(x, 40 + 16 * step - 0.01), 2010);
  assert.equal(yearAtPixel(x, 1031), 2026);
  assert.equal(yearAtPixel(x, 0), 1995);
  assert.equal(yearAtPixel(x, 5000), 2026);
});

test("pixelsForYears is the inverse of snapToYears", () => {
  for (const [from, to] of [[2010, 2015], [null, 2003], [2020, null], [2026, 2026], [null, null]]) {
    const snapped = snapToYears(x, pixelsForYears(x, from, to));
    assert.deepEqual([snapped.from, snapped.to], [from ?? 1995, to ?? 2026]);
  }
});

// Bug hunt 2026-10-01 fix-up (dashboard.md #4): by touch a tap set the year filter and showed nothing,
// so a phone could not read a year's numbers without changing the filter. A first tap on a year shows
// its numbers; a second tap on the same year sets the filter, as a click does.
test("isTouch: a brush gesture ended by a finger (a touch end carries changedTouches)", () => {
  assert.equal(isTouch({ type: "touchend", changedTouches: [{ clientX: 1, clientY: 2 }] }), true);
  assert.equal(isTouch({ type: "mouseup", clientX: 1, clientY: 2 }), false);
  assert.equal(isTouch(null), false);
});

test("isTouchTap: a finger released within 10px of where it touched; a swipe is none", () => {
  assert.equal(isTouchTap({ x: 100, y: 200 }, { x: 100, y: 200 }), true);
  assert.equal(isTouchTap({ x: 100, y: 200 }, { x: 106, y: 208 }), true);
  // A vertical swipe (the brush takes the touch, so the page does not scroll) set the year under the
  // finger before: no tap.
  assert.equal(isTouchTap({ x: 100, y: 200 }, { x: 101, y: 80 }), false);
  assert.equal(isTouchTap(null, { x: 100, y: 200 }), false);
});

test("yearTapAction: a tap shows a year's numbers, a second tap on it sets the filter", () => {
  assert.equal(yearTapAction(null, 2016), "show");
  assert.equal(yearTapAction(2004, 2016), "show");
  assert.equal(yearTapAction(2016, 2016), "filter");
});
