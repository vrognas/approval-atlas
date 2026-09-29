import { test } from "node:test";
import assert from "node:assert/strict";
import { besidePanel, tipAbove, tipHeightEstimate, tipShift } from "./tips.js";

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

// Step 4 review: the area tree's tips covered the next rows, and as a tip is hoverable a pointer
// moving down stayed in it. On desktop they go beside the sidebar, level with the row.
test("besidePanel: right of the panel, level with its row, and a bridge from the row to the tip", () => {
  const row = { top: 200, bottom: 232, right: 288, height: 32 };
  assert.deepEqual(besidePanel(row, 320, 900), {
    x: 336, top: 200, bottom: null, bridge: { left: 288, top: 200, width: 48, height: 32 },
  });
  // In the lower half of the viewport it grows up from the row's bottom, so it stays on screen.
  const low = { top: 700, bottom: 732, right: 288, height: 32 };
  assert.deepEqual(besidePanel(low, 320.4, 900), {
    x: 336, top: null, bottom: 168, bridge: { left: 288, top: 700, width: 48, height: 32 },
  });
});

test("tipHeightEstimate: lines of about half an em per character, with padding and border", () => {
  // A 260-character MeSH explainer at 22rem (352px): 6 lines.
  assert.equal(tipHeightEstimate(260, 352), 6 * 18 + 14);
  assert.equal(tipHeightEstimate(20, 256), 18 + 14);
  assert.equal(tipHeightEstimate(0, 256), 18 + 14);
});
