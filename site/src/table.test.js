import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

// Owner decision 2026-10-01: on a touch screen the stacked (phone) table shows its ATC badge's tip
// in flow, a line of the row's own after the badge's (main.js updateFlow() copies it to the row),
// never drawn over the next rows; elsewhere (keyboard, mouse, the wide table) as before. The rules
// sit in a (hover: none) block's (max-width: 599px) container query.
test("style.css: on touch screens the stacked table's ATC tip is in flow, the anchored one not drawn", () => {
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  // The body of the at-rule starting at index start (braces matched).
  const body = (start) => {
    const open = css.indexOf("{", start);
    let depth = 0;
    for (let index = open; index < css.length; index++) {
      if (css[index] === "{") depth++;
      if (css[index] === "}" && --depth === 0) return css.slice(open + 1, index);
    }
    return "";
  };
  const head = "@media (hover: none)";
  let block = null;
  for (let at = css.indexOf(head); at !== -1; at = css.indexOf(head, at + 1)) {
    const text = body(at);
    if (text.includes("data-flow-tip")) block = text;
  }
  assert.ok(block, "a (hover: none) block with the in-flow tip");
  assert.match(block, /@container \(max-width: 599px\)/);
  const rule = (selector) => {
    const index = block.indexOf(selector);
    assert.notEqual(index, -1, selector);
    return block.slice(block.indexOf("{", index) + 1, block.indexOf("}", index));
  };
  // The badge draws none; its row draws it, a line of its own across the row, before the areas.
  assert.match(rule("#medicines-table td.atc .code[data-tip]::after"), /display: none/);
  assert.match(rule("#medicines-table tr[data-flow-tip]::after"), /content: attr\(data-flow-tip\) \/ ""/);
  assert.match(rule("#medicines-table tr[data-flow-tip]::after"), /flex: 1 0 100%/);
  assert.match(rule("#medicines-table tr[data-flow-tip] > :is(td.area, td.indication-cell)"), /order: 1/);
});
