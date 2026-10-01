import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Phone layout fixes of the bug hunt of 2026-10-01 (style.css): guards on the rules, as the browser
// checks behind them (Playwright, touch emulation) do not run in the test suite.
const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

// The bodies of the at-rules starting with head (braces matched).
function blocks(head) {
  const bodies = [];
  for (let start = css.indexOf(head); start !== -1; start = css.indexOf(head, start + 1)) {
    const open = css.indexOf("{", start);
    let depth = 0;
    for (let index = open; index < css.length; index++) {
      if (css[index] === "{") depth++;
      if (css[index] === "}" && --depth === 0) {
        bodies.push(css.slice(open + 1, index));
        break;
      }
    }
  }
  return bodies;
}

const flat = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
const phones = flat(blocks("@media (max-width: 720px) {").join(" "));
// The declarations of the rules whose selector list is exactly selector, in source.
const declarations = (source, selector) => [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, selectors]) => selectors.trim() === selector)
  .map(([, , body]) => body)
  .join(" ");

test("phones: a long filter chip value is cut with an ellipsis inside its pill", () => {
  // It ran over the pill's x, which then opened the sheet instead of removing the filter.
  const value = declarations(phones, ".chip-value");
  assert.match(value, /overflow: hidden/);
  assert.match(value, /text-overflow: ellipsis/);
  assert.match(value, /white-space: nowrap/);
  assert.match(declarations(flat(css), ".chip-open"), /min-width: 0/);
});

test("the Overview previews' links fill their rows; their tab links are 24px, 44px on touch", () => {
  const all = flat(css);
  assert.match(declarations(all, ".preview-row .preview-label > a"), /display: block;.*padding: 6px 0/);
  assert.match(declarations(phones, ".preview-row .preview-label > a"), /padding: 12px 0/);
  assert.match(declarations(all, ".preview-tab-link"), /min-height: 24px/);
  assert.match(flat(blocks("@media (pointer: coarse) {").join(" ")), /\.preview-tab-link \{ min-height: 44px; \}/);
});

test("phones: Show full indication, a Documents block's links and the company protection list are 44px", () => {
  assert.match(declarations(phones, ".block-indication .indication > summary"), /padding-block: max\(0px, \(44px - 1lh\) \/ 2\)/);
  assert.match(declarations(phones, ":is(.pc-company-list, .block-documents .doc-list) a"), /display: inline-block;.*padding-block: max\(0px, \(44px - 1lh\) \/ 2\)/);
});

test("phones: the activity table's company column is narrow, its name under the badge", () => {
  assert.match(declarations(phones, '.activity th[scope="row"]'), /width: 7\.5rem;.*max-width: 7\.5rem/);
  assert.match(declarations(phones, '.activity th[scope="row"] button'), /grid-template-areas: "badge total" "name name"/);
  assert.match(declarations(phones, ".activity-row-head .cond-link"), /height: 44px/);
});

test("the Try line's separators belong to the example before them and take no width", () => {
  // A separator of its own began the second line at 390px.
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  assert.match(main, /item\.append\("span"\)\.attr\("class", "try-sep"\)/);
  const all = flat(css);
  assert.match(declarations(all, ".try-sep"), /width: 4px;.*margin: 0 -12px 0 8px/);
  assert.match(declarations(all, ".try"), /column-gap: 20px/);
});

test("the search's first files are preloaded as fetch() asks for them, before the theme script", () => {
  const theme = html.indexOf('<script src="/theme-init.js">');
  for (const file of ["meta.json", "ema_search_index.json", "mesh_entry_terms.json"]) {
    const link = html.indexOf(`<link rel="preload" href="/data/${file}" as="fetch" crossorigin />`);
    assert.ok(link !== -1 && link < theme, file);
  }
  // main.js loads exactly these first.
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  assert.match(main, /const FIRST_FILES = \["meta\.json", "ema_search_index\.json", "mesh_entry_terms\.json"\];/);
});
