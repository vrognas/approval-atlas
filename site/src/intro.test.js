import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { introCardPatch, introSpent, introVisible, isOverview, readIntroClosed, readIntroSeen, storeIntroClosed, storeIntroSeen, tryLineVisible } from "./intro.js";
import { UI } from "./labels.js";
import { DEFAULT_LOOKUP, DEFAULT_STATE, areaState, encodeUrl } from "./url.js";

const home = { ...structuredClone(DEFAULT_STATE), ...DEFAULT_LOOKUP };

// Owner decision 2026-09-29: each card's action runs an example, as the Try line does: a medicine
// card, or the overview filtered to one therapeutic area alone (other filters cleared).
test("the intro cards' actions open a medicine card or one therapeutic area alone", () => {
  const [keytruda, humira, cancer] = UI.intro.cards.map(introCardPatch);
  assert.deepEqual(keytruda, { med: "EMEA/H/C/003820" });
  assert.deepEqual(humira, { med: "EMEA/H/C/000481" });
  assert.deepEqual(cancer, areaState("C04"));
  assert.equal(encodeUrl({ ...home, ...cancer }).toString(), "area=C04&by=area");
  // None opens the untouched overview (the card would stay on screen).
  for (const patch of [keytruda, humira, cancer]) assert.equal(isOverview({ ...home, ...patch }), false);
});

// The examples exist in the data (skipped before a pipeline run): the medicines by product number
// and name, the area as a MeSH branch.
const dataFile = (name) => new URL(`../public/data/${name}`, import.meta.url);
const exampleFiles = ["ema_search_index.json", "ema_therapeutic_area_branches.json"];
test(
  "the intro cards' examples are in the data",
  { skip: exampleFiles.every((name) => existsSync(dataFile(name))) ? false : "data files not found" },
  () => {
    const [index, branches] = exampleFiles.map((name) => JSON.parse(readFileSync(dataFile(name), "utf8")));
    const nameOf = new Map(index.map((row) => [row.ema_product_number, row.name_of_medicine]));
    const [keytruda, humira, cancer] = UI.intro.cards.map(introCardPatch);
    assert.equal(nameOf.get(keytruda.med), "Keytruda");
    assert.equal(nameOf.get(humira.med), "Humira");
    assert.equal(branches.find((row) => row.branch === cancer.area[0])?.branch_name, "Neoplasms");
  },
);

test("the untouched overview: no lookup and no filter", () => {
  assert.equal(isOverview(home), true);
  // The breakdown's mode is not a filter.
  assert.equal(isOverview({ ...home, by: "area" }), true);
  // One letter typed and submitted opens no result.
  assert.equal(isOverview({ ...home, q: "k" }), true);
  for (const lookup of [{ q: "wegovy" }, { med: "EMEA/H/C/005422" }, { sub: "semaglutide" }, { cond: "D011565" }, { co: "g.roche" }]) {
    assert.equal(isOverview({ ...home, ...lookup }), false, JSON.stringify(lookup));
  }
  // Every status (owner decision 2026-09-29: authorized is the default, not a filter) is a filter.
  for (const filter of [{ atc: ["L04AC"] }, { area: ["C04"] }, { mah: ["g.roche"] }, { type: ["Generic"] }, { status: ["Refused"] }, { status: [] }, { from: 2015 }, { to: 2020 }]) {
    assert.equal(isOverview({ ...home, ...filter }), false, JSON.stringify(filter));
  }
  assert.equal(isOverview({ ...home, status: ["Authorised"] }), true);
});

// Before the dashboard's data has loaded, the URL's filters are kept verbatim (main.js pendingFilters).
test("filters still loading count as filters; the breakdown's mode does not", () => {
  assert.equal(isOverview(home, new URLSearchParams("")), true);
  assert.equal(isOverview(home, new URLSearchParams("by=mah")), true);
  assert.equal(isOverview(home, new URLSearchParams("atc=L04AC")), false);
  assert.equal(isOverview(home, new URLSearchParams("status=all")), false);
  // Links from before phase 4f carry therapeutic areas under "branch".
  assert.equal(isOverview(home, new URLSearchParams("branch=C04")), false);
});

test("the intro shows on the untouched overview until closed, and wherever the viewer asks for it", () => {
  assert.equal(introVisible({ overview: true, closed: false, requested: false }), true);
  assert.equal(introVisible({ overview: true, closed: true, requested: false }), false);
  assert.equal(introVisible({ overview: false, closed: false, requested: false }), false);
  assert.equal(introVisible({ overview: false, closed: false, requested: true }), true);
  assert.equal(introVisible({ overview: true, closed: true, requested: true }), true);
});

// Review of F · Spacious phase 1: the first filter set in a chip's popover hid the card above the chip
// bar, which moved up under the pointer with the popover. While a popover is open the card stays as
// it was shown (held), until the popover closes; closing the card still hides it.
test("the intro stays while a filter popover opened on it is open", () => {
  assert.equal(introVisible({ overview: false, closed: false, requested: false, held: true }), true);
  assert.equal(introVisible({ overview: false, closed: true, requested: false, held: true }), false);
  assert.equal(introVisible({ overview: false, closed: false, requested: false, held: false }), false);
});

// Paradox of the active user (2026-09-29): the card shows on the first visit only, until the viewer
// does anything (a lookup or a filter); then, and on later visits, "What is this?" alone brings it.
test("the intro has its turn on the first visit, until the viewer leaves the untouched overview", () => {
  // First visit, still on the untouched overview: not spent.
  assert.equal(introSpent({ seenBefore: false, spent: false, overview: true }), false);
  // A lookup or a filter spends it for the rest of the visit, back on the overview too.
  assert.equal(introSpent({ seenBefore: false, spent: false, overview: false }), true);
  assert.equal(introSpent({ seenBefore: false, spent: true, overview: true }), true);
  // Seen on an earlier visit.
  assert.equal(introSpent({ seenBefore: true, spent: false, overview: true }), true);
  // Spent: hidden on the overview, but still shown where the viewer asks for it.
  assert.equal(introVisible({ overview: true, closed: false, requested: false, spent: true }), false);
  assert.equal(introVisible({ overview: true, closed: false, requested: true, spent: true }), true);
  assert.equal(introVisible({ overview: false, closed: false, requested: true, spent: true }), true);
  assert.equal(introVisible({ overview: true, closed: false, requested: false, spent: false }), true);
});

test("a visit is remembered per viewer; blocked or missing storage shows the card each visit", () => {
  const kept = storage();
  assert.equal(readIntroSeen(kept), false);
  storeIntroSeen(kept);
  assert.equal(kept.items.get("approval-atlas:intro-seen"), "1");
  assert.equal(readIntroSeen(kept), true);
  assert.equal(readIntroSeen(storage({ "approval-atlas:intro-seen": "yes" })), false);
  const blocked = storage({}, true);
  assert.equal(readIntroSeen(blocked), false);
  assert.doesNotThrow(() => storeIntroSeen(blocked));
  assert.equal(readIntroSeen(undefined), false);
  assert.doesNotThrow(() => storeIntroSeen(undefined));
});

// Owner decision 2026-09-29: the cards' examples stand in for the Try line while the card shows; the
// line is back once it is closed and on the filtered overview; a lookup hides it, as before.
test("the Try line hides while the intro shows or a lookup is open", () => {
  assert.equal(tryLineVisible(true), false);
  assert.equal(tryLineVisible(false), true);
  assert.equal(tryLineVisible(false, true), false); // a lookup: the result starts under the search
  const shown = (overview, closed, requested) => introVisible({ overview, closed, requested });
  assert.equal(tryLineVisible(shown(true, false, false), false), false); // the untouched overview
  assert.equal(tryLineVisible(shown(true, true, false), false), true); // closed
  assert.equal(tryLineVisible(shown(false, false, false), false), true); // a filter
  assert.equal(tryLineVisible(shown(false, false, false), true), false); // a lookup
  assert.equal(tryLineVisible(shown(false, true, true), true), false); // asked for on a lookup
});

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

test("closing the intro is remembered per viewer; blocked or missing storage only forgets it", () => {
  const kept = storage();
  assert.equal(readIntroClosed(kept), false);
  storeIntroClosed(kept, true);
  assert.equal(readIntroClosed(kept), true);
  storeIntroClosed(kept, false);
  assert.equal(readIntroClosed(kept), false);
  assert.equal(kept.items.size, 0);
  assert.equal(readIntroClosed(storage({ "approval-atlas:intro-closed": "something else" })), false);
  const blocked = storage({}, true);
  assert.equal(readIntroClosed(blocked), false);
  assert.doesNotThrow(() => storeIntroClosed(blocked, true));
  assert.equal(readIntroClosed(undefined), false);
  assert.doesNotThrow(() => storeIntroClosed(undefined, true));
});
