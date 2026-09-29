import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FACET_SECTIONS, readOpenSections, storeOpenSections } from "./facet-sections.js";

// A fake localStorage; throwing: blocked storage (private windows, disabled site data).
function storage(initial = {}, throwing = false) {
  const items = new Map(Object.entries(initial));
  const guard = (action) => (...args) => {
    if (throwing) throw new Error("SecurityError");
    return action(...args);
  };
  return {
    items,
    getItem: guard((key) => items.get(key) ?? null),
    setItem: guard((key, value) => items.set(key, String(value))),
    removeItem: guard((key) => items.delete(key)),
  };
}

const KEY = "approval-atlas:facets-open";

test("the sidebar's sections, in page order", () => {
  assert.deepEqual(FACET_SECTIONS, ["type", "modality", "atc", "area", "mah", "status"]);
});

// The group keeps its title alone as its name; the button holds the title and the summary.
test("index.html: each section's heading is a collapsed disclosure button controlling its body", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const key of FACET_SECTIONS) {
    assert.match(html, new RegExp(`<div id="facet-${key}" class="facet" role="group" aria-labelledby="facet-${key}-title"`), key);
    assert.match(html, new RegExp(`<button class="facet-toggle" type="button" aria-expanded="false" aria-controls="facet-${key}-body"><span id="facet-${key}-title" class="facet-heading">[^<]+</span><span class="facet-summary" hidden></span></button>`), key);
    assert.match(html, new RegExp(`<div id="facet-${key}-body" class="facet-body" hidden>`), key);
  }
});

// Owner decision 2026-09-29 (2): collapsed by default; the sections a viewer opened are remembered.
test("sections start collapsed; the open ones are remembered per viewer", () => {
  const kept = storage();
  assert.deepEqual([...readOpenSections(kept)], []);
  storeOpenSections(kept, new Set(["mah", "atc"]));
  assert.equal(kept.items.get(KEY), '["atc","mah"]');
  assert.deepEqual([...readOpenSections(kept)].sort(), ["atc", "mah"]);
  // All closed again: nothing kept.
  storeOpenSections(kept, new Set());
  assert.equal(kept.items.size, 0);
  assert.deepEqual([...readOpenSections(kept)], []);
});

test("stored values that are not open sections are ignored", () => {
  assert.deepEqual([...readOpenSections(storage({ [KEY]: '["atc","branch",3,"status"]' }))], ["atc", "status"]);
  assert.deepEqual([...readOpenSections(storage({ [KEY]: '{"atc":true}' }))], []);
  assert.deepEqual([...readOpenSections(storage({ [KEY]: "not json" }))], []);
});

test("blocked or missing storage: every section collapsed, and nothing throws", () => {
  const blocked = storage({}, true);
  assert.deepEqual([...readOpenSections(blocked)], []);
  assert.doesNotThrow(() => storeOpenSections(blocked, new Set(["atc"])));
  assert.deepEqual([...readOpenSections(undefined)], []);
  assert.doesNotThrow(() => storeOpenSections(undefined, new Set(["atc"])));
});
