import { test } from "node:test";
import assert from "node:assert/strict";
import { introVisible, isOverview, readIntroClosed, storeIntroClosed } from "./intro.js";
import { DEFAULT_LOOKUP, DEFAULT_STATE } from "./url.js";

const home = { ...structuredClone(DEFAULT_STATE), ...DEFAULT_LOOKUP };

test("the untouched overview: no lookup and no filter", () => {
  assert.equal(isOverview(home), true);
  // The breakdown's mode is not a filter.
  assert.equal(isOverview({ ...home, by: "area" }), true);
  // One letter typed and submitted opens no result.
  assert.equal(isOverview({ ...home, q: "k" }), true);
  for (const lookup of [{ q: "wegovy" }, { med: "EMEA/H/C/005422" }, { sub: "semaglutide" }, { cond: "D011565" }, { co: "g.roche" }]) {
    assert.equal(isOverview({ ...home, ...lookup }), false, JSON.stringify(lookup));
  }
  for (const filter of [{ atc: ["L04AC"] }, { area: ["C04"] }, { mah: ["g.roche"] }, { type: ["Generic"] }, { status: ["Refused"] }, { from: 2015 }, { to: 2020 }]) {
    assert.equal(isOverview({ ...home, ...filter }), false, JSON.stringify(filter));
  }
});

// Before the dashboard's data has loaded, the URL's filters are kept verbatim (main.js pendingFilters).
test("filters still loading count as filters; the breakdown's mode does not", () => {
  assert.equal(isOverview(home, new URLSearchParams("")), true);
  assert.equal(isOverview(home, new URLSearchParams("by=mah")), true);
  assert.equal(isOverview(home, new URLSearchParams("atc=L04AC")), false);
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
