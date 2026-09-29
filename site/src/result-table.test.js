import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The lookup's result tables stack each medicine's row when narrow (style.css container queries on
// .result-table): the five-column tables under 600px, the substance card's six-column table (its
// Therapeutic area column, .with-areas) under 780px (chips review 2026-09-29: its columns' minimum
// reaches 751px, so at 1024px with the 320px sidebar it crossed its 623px card and scrolled the
// page sideways). Its block repeats the five-column one for .with-areas: the two must stay alike.
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

test("the six-column result table stacks as the five-column ones, below a wider width", () => {
  const narrow = blocks("@container (max-width: 599px) {").filter((body) => body.includes(".result-table thead"));
  const wide = blocks("@container (max-width: 779px) {").filter((body) => body.includes(".result-table.with-areas thead"));
  assert.equal(narrow.length, 1);
  assert.equal(wide.length, 1);
  assert.equal(rules(wide[0]).replaceAll(".result-table.with-areas", ".result-table"), rules(narrow[0]));
  // Every selector of the wide block is the six-column table's.
  assert.doesNotMatch(rules(wide[0]).replaceAll(".result-table.with-areas", ""), /\.result-table/);
});
