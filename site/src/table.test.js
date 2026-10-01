import { test } from "node:test";
import assert from "node:assert/strict";
import { rowChunks } from "./table.js";

// The medicines table's page in chunks (design sweep 2026-10-01, L3): a tap on the Medicines tab on a
// phone draws 20 rows first, then 20 more after each paint, so no task holds the page for long.
test("rowChunks: a page at once, or its first rows and then as many again", () => {
  assert.deepEqual(rowChunks(100), [100]);
  assert.deepEqual(rowChunks(100, null), [100]);
  assert.deepEqual(rowChunks(100, 20), [20, 20, 20, 20, 20]);
  assert.deepEqual(rowChunks(35, 20), [20, 15]);
  assert.deepEqual(rowChunks(12, 20), [12]);
  assert.deepEqual(rowChunks(20, 20), [20]);
  assert.deepEqual(rowChunks(0, 20), []);
  assert.deepEqual(rowChunks(0), []);
  // Every row once.
  for (const count of [1, 19, 21, 99, 100]) assert.equal(rowChunks(count, 20).reduce((sum, size) => sum + size, 0), count);
});
