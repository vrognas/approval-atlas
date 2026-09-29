import { test } from "node:test";
import assert from "node:assert/strict";
import { nextOpenChip, popoverLeft } from "./popover.js";

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
