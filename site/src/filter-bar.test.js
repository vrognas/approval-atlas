import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeFade } from "./filter-bar.js";

// Review of F · Spacious phase 1: on phones the chip row scrolls sideways with 2 of 7 chips showing
// at 320px and no hint that more follow. An edge fades where more chips lie beyond it.
test("edgeFade: the edges past which more chips lie", () => {
  assert.deepEqual(edgeFade(0, 800, 390), { start: false, end: true });
  assert.deepEqual(edgeFade(200, 800, 390), { start: true, end: true });
  // Scrolled to the end (sub-pixel scroll positions round).
  assert.deepEqual(edgeFade(409.5, 800, 390), { start: true, end: false });
  // Everything fits: no fade.
  assert.deepEqual(edgeFade(0, 390, 390), { start: false, end: false });
});
