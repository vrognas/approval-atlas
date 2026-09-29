import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The conditions card's table (style.css). Review 2026-09-29: on phones in landscape (586 to 720px)
// the card was 520px or wider, so its rows stayed one 27px line while the phone rules made each
// condition link and chip rim 44px tall: a tap on a row's lower part opened the next row's
// condition. Phones now stack each row on two lines whatever the card's width: the block under
// @media (max-width: 720px) repeats the narrow card's (@container (max-width: 519px)), and the two
// must stay alike. Forced colors keep the two-tone bar and the pressed sort button.
const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");

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

const rules = (body) => body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();

test("phones stack the conditions table's rows as a narrow card does", () => {
  const stacked = (head) => blocks(head).filter((body) => body.includes(".conditions-table thead tr"));
  const narrow = stacked("@container (max-width: 519px) {");
  const phones = stacked("@media (max-width: 720px) {");
  assert.equal(narrow.length, 1);
  assert.equal(phones.length, 1);
  assert.equal(rules(phones[0]), rules(narrow[0]));
});

test("forced colors keep the conditions card's two-tone bar and its pressed sort button", () => {
  const forced = rules(blocks("@media (forced-colors: active) {").join(" "));
  assert.match(forced, /\.cond-bar > span \{[^}]*forced-color-adjust: none/);
  assert.match(forced, /\.cond-bar-authorized \{[^}]*background: CanvasText/);
  assert.match(forced, /\.cond-bar-rest \{[^}]*background: Canvas;[^}]*border: 1px solid CanvasText/);
  assert.match(forced, /\.conditions-table \.sort-button\)\[aria-pressed="true"\] \{[^}]*outline: 2px solid SelectedItem/);
});
