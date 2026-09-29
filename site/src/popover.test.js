import { test } from "node:test";
import assert from "node:assert/strict";
import { leavesPopover, nextOpenChip, popoverLeft, popoverMaxHeight } from "./popover.js";

// F · Spacious, phase 1: a chip's popover opens under it, its left edge at the chip's, moved left
// as far as it must to stay inside the chip bar (the main column, inside the viewport).
test("popoverLeft: at the chip, kept inside the bar", () => {
  assert.equal(popoverLeft(262, 380, 1200), 262);
  // Near the right edge: moved left so its right edge meets the bar's.
  assert.equal(popoverLeft(1000, 380, 1200), 820);
  assert.equal(popoverLeft(1000.6, 440, 1200), 760);
  // A bar narrower than the popover: from its left edge.
  assert.equal(popoverLeft(40, 440, 400), 0);
  assert.equal(popoverLeft(-3, 380, 1200), 0);
});

// A click on the chip whose popover is open closes it; on another chip, that one opens.
test("nextOpenChip: a chip toggles its own popover, another chip takes over", () => {
  assert.equal(nextOpenChip(null, "atc"), "atc");
  assert.equal(nextOpenChip("atc", "atc"), null);
  assert.equal(nextOpenChip("atc", "area"), "area");
});

// Review of phase 1 (M1): pressing the open chip moves focus to it (mousedown) before its click: that
// focusout must not close the popover, or the click reopens it. Focus leaving to anything else outside
// the popover closes it; focus lost to nothing (a row re-rendered) does not.
test("leavesPopover: focus or a press outside, not on its own chip or inside, closes it", () => {
  const row = { contains: (other) => other === row };
  const dialog = { contains: (other) => other === dialog || other === row };
  const chip = { contains: (other) => other === chip };
  const elsewhere = { contains: (other) => other === elsewhere };
  assert.equal(leavesPopover(elsewhere, dialog, chip), true);
  assert.equal(leavesPopover(chip, dialog, chip), false);
  assert.equal(leavesPopover(row, dialog, chip), false);
  assert.equal(leavesPopover(null, dialog, chip), false);
  assert.equal(leavesPopover(elsewhere, dialog, null), true);
  // The press on the open chip: pointerdown and focusout leave it open, the click closes it.
  let open = "atc";
  if (leavesPopover(chip, dialog, chip)) open = null; // pointerdown
  if (leavesPopover(chip, dialog, chip)) open = null; // focusout to the chip
  open = nextOpenChip(open, "atc"); // click
  assert.equal(open, null);
});

// Review of phase 1 (S1): a popover never runs below the fold: at most 70% of the viewport, and no
// taller than the room under its chip (less 24px), but at least 240px (the page scrolls it into view).
test("popoverMaxHeight: the room under the chip, within 240px and 70% of the viewport", () => {
  assert.equal(popoverMaxHeight(100, 900), 630);
  assert.equal(popoverMaxHeight(592, 720), 240);
  assert.equal(popoverMaxHeight(305, 720), 391);
  assert.equal(popoverMaxHeight(305.4, 720), 390);
});
