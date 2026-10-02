import { test } from "node:test";
import assert from "node:assert/strict";
import { keepsTap } from "./chart.js";

// Bug hunt 2026-10-01 fix-up (a touch laptop): after a finger tap, "Authorized over time" kept its
// tooltip while the mouse moved over the chart and left it, with a stale month, until the next press.
// A mouse moving over a chart takes over from a tap (its tooltip follows the mouse and hides when it
// leaves); a finger or pen moving keeps the tapped one.
test("keepsTap: a mouse move ends a tap's tooltip, a touch or pen move keeps it", () => {
  assert.equal(keepsTap("mouse"), false);
  assert.equal(keepsTap("touch"), true);
  assert.equal(keepsTap("pen"), true);
});
