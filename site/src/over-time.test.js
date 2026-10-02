import { test } from "node:test";
import assert from "node:assert/strict";
import { TAP_SLOP, isTap } from "./over-time.js";

// Bug hunt 2026-10-01 (dashboard.md #4): "Authorized over time" showed nothing by touch, as a tap
// fires no pointermove and a touch pointer leaves on release. A touch or pen press released where it
// started is a tap, which shows the month's values; a pan (moved, or cancelled by the page's scroll)
// is not.
const down = { id: 3, type: "touch", x: 100, y: 200 };

test("isTap: a touch or pen press released within the slop of where it started", () => {
  assert.equal(isTap(down, { id: 3, x: 100, y: 200 }), true);
  assert.equal(isTap(down, { id: 3, x: 100 + TAP_SLOP, y: 200 }), true);
  assert.equal(isTap({ ...down, type: "pen" }, { id: 3, x: 104, y: 197 }), true);
});

test("isTap: no for a pan, another pointer, a mouse or no press", () => {
  assert.equal(isTap(down, { id: 3, x: 100 + TAP_SLOP + 1, y: 200 }), false);
  assert.equal(isTap(down, { id: 3, x: 108, y: 208 }), false);
  assert.equal(isTap(down, { id: 4, x: 100, y: 200 }), false);
  // A mouse shows the month on hover (pointermove) already.
  assert.equal(isTap({ ...down, type: "mouse" }, { id: 3, x: 100, y: 200 }), false);
  assert.equal(isTap(null, { id: 3, x: 100, y: 200 }), false);
});
