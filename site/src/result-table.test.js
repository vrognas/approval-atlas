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

// The rules of a block: { selectors (top-level list), declarations }.
function ruleList(body) {
  return [...rules(body).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, declarations]) => ({
    selectors: splitList(selectors.trim()),
    declarations,
  }));
}

// A selector list split at its top-level commas.
function splitList(list) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < list.length; index++) {
    if (list[index] === "(") depth++;
    else if (list[index] === ")") depth--;
    else if (list[index] === "," && depth === 0) {
      parts.push(list.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts;
}

const IDENT = /^-?[\w-]+/;
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// The specificity [ids, classes, types] of one complex selector (Selectors Level 4: :is(), :not()
// and :has() count as their most specific argument, :where() as nothing).
function specificity(selector) {
  const score = [0, 0, 0];
  for (let index = 0; index < selector.length;) {
    const char = selector[index];
    if (char === "#" || char === ".") {
      score[char === "#" ? 0 : 1]++;
      index += 1 + IDENT.exec(selector.slice(index + 1))[0].length;
    } else if (char === "[") {
      score[1]++;
      index = selector.indexOf("]", index) + 1;
    } else if (selector.startsWith("::", index)) {
      score[2]++;
      index += 2 + IDENT.exec(selector.slice(index + 2))[0].length;
    } else if (char === ":") {
      const name = IDENT.exec(selector.slice(index + 1))[0];
      index += 1 + name.length;
      let args = "";
      if (selector[index] === "(") {
        let depth = 0;
        const open = index;
        for (; index < selector.length; index++) {
          if (selector[index] === "(") depth++;
          if (selector[index] === ")" && --depth === 0) break;
        }
        args = selector.slice(open + 1, index);
        index++;
      }
      if (["is", "not", "has"].includes(name)) {
        const best = splitList(args).map(specificity).reduce((a, b) => (compare(a, b) >= 0 ? a : b));
        best.forEach((value, place) => { score[place] += value; });
      } else if (name !== "where") score[1]++;
    } else if (/[a-z]/i.test(char)) {
      score[2]++;
      index += IDENT.exec(selector.slice(index))[0].length;
    } else index++; // combinators, whitespace, *
  }
  return score;
}

test("specificity counts :is(), :not() and :has() by their most specific argument, :where() as none", () => {
  assert.deepEqual(specificity("#a .b [c]:hover::after"), [1, 3, 1]);
  assert.deepEqual(specificity("a:not(.b, .c .d .e)"), [0, 3, 1]);
  assert.deepEqual(specificity("a:not(.b, :where(.c .d .e))"), [0, 1, 1]);
  assert.deepEqual(specificity(":is(#a, .b) :is(a:not(.c), .d)"), [1, 1, 1]);
  assert.deepEqual(specificity(".a:has(> .b .c)"), [0, 3, 0]);
});

// Phones (bug hunt 2026-10-01, fix-up): every tip carrier in the tables is positioned and raised a
// little (z-index 1, so its tap-target rim lies under the fills and links around it), and to 5 while
// its tip shows, so the next rows' links, ATC segments and chips never paint over the tip. The first
// rule must never outrank the second: excluding the result tables' type badges with a complex
// selector inside :not() raised it to (1,4,0), over the raise's (1,3,0), and the tips of status dots,
// ATC badges and type badges went under the next rows' controls.
test("phones: a table's tip carrier is raised over the next rows while its tip shows", () => {
  const phone = blocks("@media (max-width: 720px) {").filter((body) => body.includes(":is(#medicines-table, .result-table)"));
  assert.equal(phone.length, 1);
  const carriers = (zIndex) => ruleList(phone[0])
    .filter(({ declarations }) => new RegExp(`z-index: ${zIndex};`).test(declarations))
    .flatMap(({ selectors }) => selectors)
    .filter((selector) => selector.startsWith(":is(#medicines-table, .result-table)") && selector.includes("[data-tip]"));
  const rims = carriers(1);
  const raised = carriers(5);
  assert.ok(rims.length > 0 && raised.length > 0);
  for (const rim of rims) {
    for (const raise of raised) {
      assert.ok(compare(specificity(raise), specificity(rim)) > 0, `${raise} ${specificity(raise)} must outrank ${rim} ${specificity(rim)}`);
    }
  }
});

test("the six-column result table stacks as the five-column ones, below a wider width", () => {
  const narrow = blocks("@container (max-width: 599px) {").filter((body) => body.includes(".result-table thead"));
  const wide = blocks("@container (max-width: 779px) {").filter((body) => body.includes(".result-table.with-areas thead"));
  assert.equal(narrow.length, 1);
  assert.equal(wide.length, 1);
  assert.equal(rules(wide[0]).replaceAll(".result-table.with-areas", ".result-table"), rules(narrow[0]));
  // Every selector of the wide block is the six-column table's.
  assert.doesNotMatch(rules(wide[0]).replaceAll(".result-table.with-areas", ""), /\.result-table/);
});
