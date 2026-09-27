import { test } from "node:test";
import assert from "node:assert/strict";
import { nearestThumb, startOnTop, thumbCenter, thumbRange, toggleYear, yearAt, yearTicks } from "./year-slider.js";

const YEARS = [1995, 2026];

test("thumbCenter: a thumb travels from half its width to the width minus half its width", () => {
  assert.equal(thumbCenter(1995, YEARS, 644, 24), 12);
  assert.equal(thumbCenter(2026, YEARS, 644, 24), 632);
  // 31 steps over 620px: 20px per year.
  assert.equal(thumbCenter(2000, YEARS, 644, 24), 112);
  // Phone: a 44px thumb box (28px visible).
  assert.equal(thumbCenter(1995, YEARS, 256, 44), 22);
  assert.equal(thumbCenter(2026, YEARS, 256, 44), 234);
});

test("yearAt: the year whose thumb centre is nearest a click (thumbCenter() inverted)", () => {
  assert.equal(yearAt(12, YEARS, 644, 24), 1995);
  assert.equal(yearAt(632, YEARS, 644, 24), 2026);
  assert.equal(yearAt(112, YEARS, 644, 24), 2000);
  // 20px per year: rounded to the nearer year.
  assert.equal(yearAt(121, YEARS, 644, 24), 2000);
  assert.equal(yearAt(123, YEARS, 644, 24), 2001);
  // Past the thumbs' travel (the track's ends): clamped to the data range.
  assert.equal(yearAt(0, YEARS, 644, 24), 1995);
  assert.equal(yearAt(644, YEARS, 644, 24), 2026);
  assert.equal(yearAt(-30, YEARS, 644, 24), 1995);
  // Phone: a 44px thumb box.
  assert.equal(yearAt(22, YEARS, 256, 44), 1995);
  assert.equal(yearAt(234, YEARS, 256, 44), 2026);
  for (const year of [1995, 2003, 2019, 2026]) assert.equal(yearAt(thumbCenter(year, YEARS, 256, 44), YEARS, 256, 44), year);
});

test("nearestThumb: a click moves the closer thumb", () => {
  assert.equal(nearestThumb(2001, 2000, 2010), "start");
  assert.equal(nearestThumb(1995, 2000, 2010), "start");
  assert.equal(nearestThumb(2008, 2000, 2010), "end");
  assert.equal(nearestThumb(2026, 2000, 2010), "end");
});

test("nearestThumb: at equal distance, the start thumb below the range, else the end thumb", () => {
  assert.equal(nearestThumb(2005, 2000, 2010), "end");
  // Thumbs on the same year: the one on the clicked side, so neither is stuck under the other.
  assert.equal(nearestThumb(2005, 2010, 2010), "start");
  assert.equal(nearestThumb(2015, 2010, 2010), "end");
  assert.equal(nearestThumb(2010, 2010, 2010), "end");
});

test("thumbRange: thumbs inside the data range give a closed range", () => {
  assert.deepEqual(thumbRange(2010, 2015, "start", YEARS), { start: 2010, end: 2015, from: 2010, to: 2015 });
  assert.deepEqual(thumbRange(2010, 2015, "end", YEARS), { start: 2010, end: 2015, from: 2010, to: 2015 });
});

test("thumbRange: the moved thumb stops at the other, so they never cross", () => {
  assert.deepEqual(thumbRange(2018, 2015, "start", YEARS), { start: 2015, end: 2015, from: 2015, to: 2015 });
  assert.deepEqual(thumbRange(2010, 2005, "end", YEARS), { start: 2010, end: 2010, from: 2010, to: 2010 });
  // Home on the end thumb, End on the start thumb.
  assert.deepEqual(thumbRange(2010, 1995, "end", YEARS), { start: 2010, end: 2010, from: 2010, to: 2010 });
  assert.deepEqual(thumbRange(2026, 2012, "start", YEARS), { start: 2012, end: 2012, from: 2012, to: 2012 });
});

test("thumbRange: a thumb at the data's first or last year leaves that end open", () => {
  assert.deepEqual(thumbRange(1995, 2026, "start", YEARS), { start: 1995, end: 2026, from: null, to: null });
  assert.deepEqual(thumbRange(1995, 2020, "end", YEARS), { start: 1995, end: 2020, from: null, to: 2020 });
  assert.deepEqual(thumbRange(2026, 2026, "start", YEARS), { start: 2026, end: 2026, from: 2026, to: null });
  assert.deepEqual(thumbRange(1995, 1995, "end", YEARS), { start: 1995, end: 1995, from: null, to: 1995 });
});

test("startOnTop: where the thumbs overlap, the one that can move away lies on top", () => {
  // Both at the last year: only the start thumb can move.
  assert.equal(startOnTop(2026, 2026, YEARS), true);
  assert.equal(startOnTop(2024, 2026, YEARS), true);
  // Both at the first year: only the end thumb can move.
  assert.equal(startOnTop(1995, 1995, YEARS), false);
  assert.equal(startOnTop(1995, 1997, YEARS), false);
  assert.equal(startOnTop(1995, 2026, YEARS), false);
});

test("toggleYear: a year's bar selects that year alone", () => {
  assert.deepEqual(toggleYear(2010, { from: null, to: null }, YEARS), { from: 2010, to: 2010 });
  assert.deepEqual(toggleYear(2010, { from: 2005, to: 2015 }, YEARS), { from: 2010, to: 2010 });
  assert.deepEqual(toggleYear(2011, { from: 2010, to: 2010 }, YEARS), { from: 2011, to: 2011 });
  // A range starting or ending at that year is not that year alone.
  assert.deepEqual(toggleYear(2010, { from: 2010, to: 2012 }, YEARS), { from: 2010, to: 2010 });
  // The data's first or last year stays an open end, as normalizeYearRange().
  assert.deepEqual(toggleYear(1995, { from: null, to: null }, YEARS), { from: null, to: 1995 });
  assert.deepEqual(toggleYear(2026, { from: null, to: 2020 }, YEARS), { from: 2026, to: null });
});

test("toggleYear: the bar of the one selected year shows every year again", () => {
  assert.deepEqual(toggleYear(2010, { from: 2010, to: 2010 }, YEARS), { from: null, to: null });
  assert.deepEqual(toggleYear(1995, { from: null, to: 1995 }, YEARS), { from: null, to: null });
  assert.deepEqual(toggleYear(2026, { from: 2026, to: null }, YEARS), { from: null, to: null });
});

test("yearTicks: every 5 years when the labels fit, else every 10", () => {
  assert.deepEqual(yearTicks(YEARS, 32), [1995, 2000, 2005, 2010, 2015, 2020, 2025]);
  assert.deepEqual(yearTicks(YEARS, 8), [1995, 2000, 2005, 2010, 2015, 2020, 2025]);
  assert.deepEqual(yearTicks(YEARS, 7), [2000, 2010, 2020]);
});
