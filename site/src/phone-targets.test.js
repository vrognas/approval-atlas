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
  // The row's padding is a token (design sweep A5): the bar and count take the same offset, so a
  // wrapped name's row reads along its first line.
  assert.match(declarations(all, ".preview-row .preview-label > a"), /display: block;.*padding: var\(--preview-pad\) 0/);
  assert.match(declarations(all, ".preview-row"), /--preview-pad: 6px;/);
  assert.match(declarations(phones, ".preview-row"), /--preview-pad: 12px;.*min-height: 44px/);
  // The bar is the tab's 10px bar (design sweep B11), centred on the 20px first line.
  assert.match(declarations(all, ".preview-row > .preview-bar"), /margin-top: calc\(var\(--preview-pad\) \+ 5px\)/);
  assert.match(declarations(all, ".preview-bar"), /height: 10px/);
  assert.match(declarations(all, ".preview-row > .preview-count"), /padding-top: var\(--preview-pad\)/);
  assert.match(declarations(all, ".preview-tab-link"), /min-height: 24px/);
  assert.match(flat(blocks("@media (pointer: coarse) {").join(" ")), /\.preview-tab-link \{ min-height: 44px; \}/);
});

test("the Overview previews' company badges are part of their row's link", () => {
  // Fix-up: a tap on the badge opened nothing, and one in the gap beside it near the row's edge the
  // next row's page. The badge goes inside the link, the name in a span with the link's underline.
  const previews = readFileSync(new URL("./overview-previews.js", import.meta.url), "utf8");
  assert.match(previews, /label\.replaceChildren\(lead, node\("span", "preview-name", \.\.\.label\.childNodes\)\)/);
  const all = flat(css);
  assert.match(declarations(all, ".preview-row .preview-label > a.preview-lead-link"), /display: flex;.*gap: 6px;.*text-decoration: none/);
  assert.match(declarations(all, ".preview-lead-link > .preview-name"), /text-decoration: underline 1px var\(--link-underline\)/);
});

test("phones: Show full indication, a Documents block's links and the company protection list are 44px", () => {
  assert.match(declarations(phones, ".block-indication .indication > summary"), /padding-block: max\(0px, \(44px - 1lh\) \/ 2\)/);
  // The Indication block's other reveal control, "and n more", likewise (design sweep B6 fix-up),
  // and both at one size, 14px (it was 16px under the 14px summary).
  assert.match(declarations(phones, ".toggle.areas-more"), /display: block;.*padding-block: max\(0px, \(44px - 1lh\) \/ 2\)/);
  const all = flat(css);
  assert.match(declarations(all, ".toggle.areas-more"), /font-size: var\(--font-size-14\)/);
  assert.match(declarations(all, ".block-indication .indication > summary"), /font-size: var\(--font-size-14\)/);
  assert.match(declarations(phones, ":is(.pc-company-list, .block-documents .doc-list) a"), /display: inline-block;.*padding-block: max\(0px, \(44px - 1lh\) \/ 2\)/);
});

test("phones: Limits of the estimate, the documents sublist and List them are 44px (design sweep L1)", () => {
  // Each sat at 24px beside 44px siblings.
  assert.match(declarations(phones, ".protection > details > summary"), /padding-block: max\(0px, \(44px - 1lh\) \/ 2\);.*margin-bottom: min\(0px, \(1lh - 44px\) \/ 2\)/);
  // Its padding never reaches over the line above (the Patents line's link): no negative top margin.
  assert.doesNotMatch(declarations(phones, ".protection > details > summary"), /margin-(top|block):/);
  assert.match(declarations(phones, ".doc-list > li > details > summary"), /padding-block: max\(0px, \(44px - 1lh\) \/ 2\);.*margin-block: -4px/);
  // -4px only takes the list items' own margins.
  assert.match(declarations(flat(css), ".doc-list > li"), /margin: 4px 0/);
  // List them: a 44px area over its 24px box (review of L1: a 44px box's focus ring struck through
  // the line above), so the ring stays on the 24px box.
  assert.match(declarations(phones, ".pc-orphan-toggle"), /position: relative/);
  assert.doesNotMatch(declarations(phones, ".pc-orphan-toggle"), /min-height|margin/);
  assert.match(declarations(phones, ".pc-orphan-toggle::before"), /content: "";.*position: absolute;.*inset: -10px 0/);
  assert.match(declarations(flat(css), ".pc-orphan-toggle"), /min-height: 24px/);
});

test("phones: a not-authorized medicine's protection lead keeps its 44px area over its second line", () => {
  // Review of C3b: its 44px box lay under the lead's second line, which took the bottom 10px of its
  // taps, and its focus ring struck through that line. An area 10px above and below the 24px box,
  // positioned so it is painted over that line, as List them.
  assert.match(declarations(phones, ".lead-plain a.lead-link"), /position: relative;.*display: inline-block;.*min-height: 0;.*margin: 0/);
  assert.match(declarations(phones, ".lead-plain a.lead-link::before"), /content: "";.*position: absolute;.*inset: -10px 0/);
  // Authorized medicines' leads (20px answer type) keep their 44px box.
  assert.match(declarations(phones, "a.lead-link"), /min-height: 44px;.*margin: -10px 0/);
});

test("phones: the plain-language overview under the document buttons is a 44px text link", () => {
  // Owner decision 2026-10-01 (design sweep L8): a third 52px button pushed the Protection lead below
  // a 390x664 screen. One 20px line, 12px under the button above (the 8px gap and 4px), an area 12px
  // above and below it (20 + 2 x 12 = 44px) reaching no button; the block's padding under it 10px.
  const lookup = readFileSync(new URL("./lookup.js", import.meta.url), "utf8");
  assert.match(lookup, /class: key === "overview" \? "doc-button doc-overview" : "doc-button"/);
  const link = declarations(phones, ".block-documents .doc-button + .doc-button.doc-overview");
  assert.match(link, /position: relative;.*display: block;.*min-height: 0;.*margin-top: 4px;.*padding: 0;.*border: 0;.*line-height: 1\.25rem/);
  assert.match(declarations(phones, ".block-documents .doc-button + .doc-button.doc-overview::before"), /content: "";.*position: absolute;.*inset: -12px 0/);
  assert.match(declarations(flat(css), ".doc-buttons"), /gap: 8px/);
  assert.match(declarations(phones, ".doc-button + .doc-overview .doc-button-meta"), /display: none/);
  assert.match(declarations(phones, ".card-block.block-documents:has(.doc-button + .doc-overview)"), /padding-bottom: 10px/);
});

test("the protection lead's (est.) stays on the line of its years", () => {
  // Review of C3b: after the link, an inline block on phones, a line could break before the no-break
  // space of "(est.)", which then began the next line (44 of the 46 leads with one at 320; Wegovy's
  // and Rinvoq's at 360 and 375). The link and its "(est.)" go in one span that does not wrap.
  const lookup = readFileSync(new URL("./lookup.js", import.meta.url), "utf8");
  assert.match(lookup, /estimate \? el\("span", \{ class: "lead-keep" \}, link, estimate\) : link/);
  assert.match(declarations(flat(css), ".lead-keep"), /white-space: nowrap/);
});

test("a condition page's MeSH definition is a closed disclosure, its summary 44px on phones", () => {
  // Owner decision 2026-10-01 (L2): as a paragraph it put Psoriasis's first medicine below a 390x664
  // screen. Closed (no open attribute), kept open across re-renders and history by its data-key.
  const lookup = readFileSync(new URL("./lookup.js", import.meta.url), "utf8");
  assert.match(lookup, /el\("details", \{ class: "mesh-definition", "data-key": "mesh-definition" \},\s+el\("summary", \{ "data-focus-key": "mesh-definition" \}, UI\.mesh\.definition\)/);
  // Its padding in the 12px gaps around it, so it reaches neither the dek nor Show all statuses.
  assert.match(declarations(phones, ".card .mesh-definition"), /margin-block: 12px/);
  assert.match(declarations(phones, ".mesh-definition > summary"), /padding-block: max\(0px, \(44px - 1lh\) \/ 2\);.*margin-block: min\(0px, \(1lh - 44px\) \/ 2\)/);
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

test("the search's first files but the MeSH terms are preloaded as fetch() asks for them, before the theme script", () => {
  const theme = html.indexOf('<script src="/theme-init.js">');
  for (const file of ["meta.json", "ema_search_index.json"]) {
    const link = html.indexOf(`<link rel="preload" href="/data/${file}" as="fetch" crossorigin />`);
    assert.ok(link !== -1 && link < theme, file);
  }
  // Fix-up: with the MeSH terms too, their bytes shared Slow 4G's bandwidth with the stylesheet, and
  // the first paint came 0.24 s later; main.js asks for them once it runs.
  assert.doesNotMatch(html, /rel="preload" href="\/data\/mesh_entry_terms\.json"/);
  // main.js loads exactly these first.
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  assert.match(main, /const FIRST_FILES = \["meta\.json", "ema_search_index\.json", "mesh_entry_terms\.json"\];/);
});
