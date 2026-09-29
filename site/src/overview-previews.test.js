import { test } from "node:test";
import assert from "node:assert/strict";
import { PREVIEW_ROWS, previewShares, topGroups } from "./overview-previews.js";

// F · Spacious, phase 2: the Overview's previews of other tabs.
test("preview bars are in percent of the largest count, or of a scale, longer ones clamped", () => {
  const widths = (shares) => shares.map((share) => share.width);
  assert.deepEqual(widths(previewShares([50, 25, 10])), [100, 50, 20]);
  assert.deepEqual(previewShares([0, 0]), [{ width: 0, clamped: false }, { width: 0, clamped: false }]);
  assert.deepEqual(previewShares([]), []);
  // The protection preview: to the scale of the busiest single year, the later years clamped.
  assert.deepEqual(previewShares([28, 56, 268], 56), [{ width: 50, clamped: false }, { width: 100, clamped: false }, { width: 100, clamped: true }]);
});

test("the company groups with the most medicines, most first, ties by key, none without a group", () => {
  const products = [
    { group_key: "g.b" }, { group_key: "g.a" }, { group_key: "g.b" }, { group_key: "g.c" }, { group_key: "g.a" },
    { group_key: null }, { group_key: null }, { group_key: null }, { group_key: "g.d" },
  ];
  assert.deepEqual(topGroups(products, 3), [{ key: "g.a", count: 2 }, { key: "g.b", count: 2 }, { key: "g.c", count: 1 }]);
  assert.equal(topGroups(products).length, 4);
  assert.equal(PREVIEW_ROWS, 5);
});
