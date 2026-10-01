import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeFade, revealScroll } from "./filter-bar.js";

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

// Design sweep 2026-10-01, L5: a filter set from a link or a table left its chip off the phone's row
// (?mah=g.roche at 390px: the Company chip at 554-658px, the row at 0). The row scrolls it into view,
// clear of the 40px fades.
test("revealScroll: the scroll that shows a chip clear of the edges, or null when it shows", () => {
  // The Company chip at 554-658 in a 390px row 900px wide: its end 40px from the right edge.
  assert.equal(revealScroll(0, 390, 900, 554, 658, 40), 308);
  // Already in view, margins included.
  assert.equal(revealScroll(0, 390, 900, 120, 300, 40), null);
  assert.equal(revealScroll(308, 390, 900, 554, 658, 40), null);
  // Left of the view: its start 40px from the left edge.
  assert.equal(revealScroll(400, 390, 900, 200, 300, 40), 160);
  // Near either end the scroll stops at its limits.
  assert.equal(revealScroll(300, 390, 900, 20, 120, 40), 0);
  assert.equal(revealScroll(0, 390, 900, 800, 890, 40), 510);
  // Too wide for the room between the fades (320px: the ATC chip, 288px): centred, whole.
  assert.equal(revealScroll(0, 320, 900, 273, 561, 40), 257);
  assert.equal(revealScroll(257, 320, 900, 273, 561, 40), null);
  // Wider than the row: its start shows.
  assert.equal(revealScroll(0, 390, 1200, 500, 900, 40), 500);
  // Sub-pixel differences are no scroll.
  assert.equal(revealScroll(308.4, 390, 900, 554, 658, 40), null);
});
