import { test } from "node:test";
import assert from "node:assert/strict";
import { atPointer, pointerBridge, tipAbove, tipBounds, tipClick, tipHeightEstimate, tipShift, towardTip } from "./tips.js";

// Owner decision 2026-09-29: on mouse hover a tip opens at the pointer (just below and right of
// it), inside the viewport (and a scroll box that clips it), flipped above or left without room.
test("atPointer: 12px below and right of the pointer when it fits", () => {
  const bounds = { left: 8, top: 8, right: 1432, bottom: 892 };
  assert.deepEqual(atPointer({ x: 100, y: 100 }, { width: 200, height: 50 }, bounds), { left: 112, top: 112 });
  // Whole pixels.
  assert.deepEqual(atPointer({ x: 100.4, y: 99.6 }, { width: 200, height: 50 }, bounds), { left: 112, top: 112 });
  // Exactly at the edge still fits.
  assert.deepEqual(atPointer({ x: 1220, y: 830 }, { width: 200, height: 50 }, bounds), { left: 1232, top: 842 });
});

test("atPointer: flips left of the pointer near the right edge and above it near the bottom", () => {
  const bounds = { left: 8, top: 8, right: 1432, bottom: 892 };
  assert.deepEqual(atPointer({ x: 1300, y: 100 }, { width: 200, height: 50 }, bounds), { left: 1088, top: 112 });
  assert.deepEqual(atPointer({ x: 100, y: 850 }, { width: 200, height: 50 }, bounds), { left: 112, top: 788 });
  assert.deepEqual(atPointer({ x: 1300, y: 850 }, { width: 200, height: 50 }, bounds), { left: 1088, top: 788 });
});

test("atPointer: kept inside its bounds where neither side has room", () => {
  // A 352px explainer on a 390px screen: as far right as fits.
  const phone = { left: 8, top: 8, right: 382, bottom: 836 };
  assert.deepEqual(atPointer({ x: 200, y: 100 }, { width: 352, height: 120 }, phone), { left: 30, top: 112 });
  // Wider than its bounds: from their left edge.
  assert.deepEqual(atPointer({ x: 200, y: 100 }, { width: 400, height: 120 }, phone), { left: 8, top: 112 });
  // Taller than either side's room: as low as fits.
  assert.deepEqual(atPointer({ x: 100, y: 450 }, { width: 200, height: 800 }, { left: 8, top: 8, right: 1432, bottom: 892 }), { left: 112, top: 92 });
  // A scroll box's area: above the pointer in its last visible row.
  assert.deepEqual(atPointer({ x: 600, y: 700 }, { width: 256, height: 60 }, { left: 368, top: 300, right: 1384, bottom: 720 }), { left: 612, top: 628 });
});

test("tipBounds: the viewport less 8px, within a scroll box's visible area less 8px", () => {
  assert.deepEqual(tipBounds(1440, 900), { left: 8, top: 8, right: 1432, bottom: 892 });
  assert.deepEqual(tipBounds(1440, 900, { left: 360, top: 0, right: 1392, bottom: 900 }), { left: 368, top: 8, right: 1384, bottom: 892 });
  assert.deepEqual(tipBounds(1440, 900, { left: 0, top: 200, right: 1500, bottom: 700 }), { left: 8, top: 208, right: 1432, bottom: 692 });
});

// A tip at the pointer stays put, so the pointer can move onto it (WCAG 1.4.13): leaving its carrier
// on the way there holds it, going elsewhere does not.
test("towardTip: on the way from the pointer's anchor to the tip, or on it", () => {
  const anchor = { x: 100, y: 100 };
  const tip = { left: 112, top: 112, width: 200, height: 50 };
  assert.equal(towardTip(anchor, tip, { x: 106, y: 106 }), true);
  assert.equal(towardTip(anchor, tip, { x: 103, y: 110 }), true);
  assert.equal(towardTip(anchor, tip, { x: 110, y: 101 }), true);
  assert.equal(towardTip(anchor, tip, { x: 200, y: 140 }), true);
  // Straight down, up or left from the anchor, or past the tip: elsewhere.
  assert.equal(towardTip(anchor, tip, { x: 100, y: 130 }), false);
  assert.equal(towardTip(anchor, tip, { x: 100, y: 90 }), false);
  assert.equal(towardTip(anchor, tip, { x: 90, y: 104 }), false);
  assert.equal(towardTip(anchor, tip, { x: 400, y: 200 }), false);
  // A tip flipped above and left of the pointer.
  const flipped = { left: -112, top: 38, width: 200, height: 50 };
  assert.equal(towardTip(anchor, flipped, { x: 95, y: 95 }), true);
  assert.equal(towardTip(anchor, flipped, { x: 105, y: 95 }), false);
});

// Review 2026-09-29: a pointer entering a row near its bottom edge crossed the next row on its way
// to the tip 12px below, and got that row's tip. The band from the pointer to the tip's near edge,
// as wide as the tip, is part of the carrier (style.css ::before); it reaches 1px into the tip, as
// at 1.5x the tip's edge was drawn half a pixel off the band's, and the next row showed through.
test("pointerBridge: from the pointer 1px into the tip's near edge, as wide as the tip, for every flip", () => {
  const size = { width: 200, height: 50 };
  // Below and right, below and left.
  assert.deepEqual(pointerBridge({ x: 100, y: 100 }, { left: 112, top: 112, ...size }), { left: 100, top: 100, width: 212, height: 13 });
  assert.deepEqual(pointerBridge({ x: 1300, y: 100 }, { left: 1088, top: 112, ...size }), { left: 1088, top: 100, width: 212, height: 13 });
  // Above and right, above and left.
  assert.deepEqual(pointerBridge({ x: 100, y: 850 }, { left: 112, top: 788, ...size }), { left: 100, top: 837, width: 212, height: 13 });
  assert.deepEqual(pointerBridge({ x: 1300, y: 850 }, { left: 1088, top: 788, ...size }), { left: 1088, top: 837, width: 212, height: 13 });
  // Kept inside its bounds across the pointer (a wide explainer on a narrow screen).
  assert.deepEqual(pointerBridge({ x: 200, y: 100 }, { left: 30, top: 112, width: 352, height: 120 }), { left: 30, top: 100, width: 352, height: 13 });
});

test("pointerBridge: beside a tip level with the pointer, across to its near side", () => {
  // Taller than the room above and below the pointer (atPointer() keeps it inside its bounds).
  assert.deepEqual(pointerBridge({ x: 100, y: 450 }, { left: 112, top: 92, width: 200, height: 800 }), { left: 100, top: 92, width: 13, height: 800 });
  assert.deepEqual(pointerBridge({ x: 1300, y: 450 }, { left: 1088, top: 92, width: 200, height: 800 }), { left: 1287, top: 92, width: 13, height: 800 });
  // Under the pointer: nothing to bridge.
  assert.deepEqual(pointerBridge({ x: 200, y: 450 }, { left: 8, top: 8, width: 400, height: 880 }), { left: 200, top: 8, width: 0, height: 880 });
});

// Review of PR #15: a tip at the pointer and its unseen bridge can lie over controls, the next row's
// or its own carrier's (an ATC badge's segments, entered from above: the click on "L" reached the
// badge, not the segment). A click there goes on to the control under it; a click on the tip where
// it does not lie over its carrier only hides it.
test("tipClick: on the tip, through it or its bridge to the control under them, or on the carrier", () => {
  const badge = { left: 960, top: 436, width: 121, height: 22 };
  const anchor = { x: 976, y: 440 };
  const tip = { left: 988, top: 452, width: 236, height: 90 };
  const pointed = { shown: true, tip, bridge: pointerBridge(anchor, tip) };
  // The bridge over its own carrier's segments, and over the next row.
  assert.equal(tipClick({ x: 1010, y: 446 }, badge, pointed), "through");
  assert.equal(tipClick({ x: 1150, y: 445 }, badge, pointed), "through");
  // The tip over its own carrier, and off it.
  assert.equal(tipClick({ x: 1000, y: 455 }, badge, pointed), "through");
  assert.equal(tipClick({ x: 1100, y: 500 }, badge, pointed), "tip");
  // The carrier outside the tip and its bridge; off all three (a child reaching past the carrier).
  assert.equal(tipClick({ x: 965, y: 438 }, badge, pointed), "carrier");
  assert.equal(tipClick({ x: 950, y: 470 }, badge, pointed), "carrier");
  // Not shown yet (a MeSH explainer's pause) or hidden: neither the tip nor its bridge takes a click.
  assert.equal(tipClick({ x: 1010, y: 446 }, badge, { ...pointed, shown: false }), "carrier");
  assert.equal(tipClick({ x: 1100, y: 500 }, badge, { ...pointed, shown: false }), "carrier");
  // An anchored tip (keyboard focus, a tap): a click that reached its carrier off it is on the tip.
  assert.equal(tipClick({ x: 1010, y: 446 }, badge, null), "carrier");
  assert.equal(tipClick({ x: 1010, y: 470 }, badge, null), "tip");
});

// Step 4 review: at 1440 the medicines table's scroll box ended at 1392 while tips were kept inside
// the viewport less 16px (1409), so the last ~17px of every line was cut; a tip in the box's last
// visible row ran 57px past its bottom.
test("tipShift: moves a tip left by what crosses the limit, never right", () => {
  assert.equal(tipShift(1200, 352, 1392 - 8), -168);
  assert.equal(tipShift(1000.4, 352, 1384), 0);
  assert.equal(tipShift(1032.5, 352, 1384), -1);
  assert.equal(tipShift(100, 200, 1409), 0);
});

test("tipAbove: above the carrier only when it does not fit below inside its box and there is more room above", () => {
  const clip = { top: 0, bottom: 473 };
  // The last visible row: 122px of tip below it would run past the box.
  assert.equal(tipAbove({ top: 400, bottom: 420 }, 122, clip), true);
  // Room below.
  assert.equal(tipAbove({ top: 100, bottom: 120 }, 122, clip), false);
  // Neither fits: the side with more room.
  assert.equal(tipAbove({ top: 60, bottom: 80 }, 500, clip), false);
  assert.equal(tipAbove({ top: 300, bottom: 320 }, 500, clip), true);
});

test("tipHeightEstimate: lines of about half an em per character, with padding and border", () => {
  // A 260-character MeSH explainer at 22rem (352px): 6 lines.
  assert.equal(tipHeightEstimate(260, 352), 6 * 18 + 14);
  assert.equal(tipHeightEstimate(20, 256), 18 + 14);
  assert.equal(tipHeightEstimate(0, 256), 18 + 14);
});
