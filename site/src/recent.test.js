import { test } from "node:test";
import assert from "node:assert/strict";
import { RECENT_MAX, addRecent, createRecent, parseRecent, readRecent, recentEntry, recentGroup, storeRecent } from "./recent.js";
import { UI } from "./labels.js";
import { DEFAULT_LOOKUP, DEFAULT_STATE, classState } from "./url.js";

const home = { ...structuredClone(DEFAULT_STATE), ...DEFAULT_LOOKUP };
const wegovy = { kind: "medicines", value: "EMEA/H/C/005422", label: "Wegovy" };
const psoriasis = { kind: "conditions", value: "D011565", label: "Psoriasis" };

test("a viewed medicine, substance, condition, company or class is an entry; other views are not", () => {
  assert.deepEqual(recentEntry({ ...home, med: "EMEA/H/C/005422" }, "Wegovy"), wegovy);
  assert.deepEqual(recentEntry({ ...home, sub: "semaglutide" }, "Semaglutide"), { kind: "substances", value: "semaglutide", label: "Semaglutide" });
  assert.deepEqual(recentEntry({ ...home, cond: "D011565" }, "Psoriasis"), psoriasis);
  assert.deepEqual(recentEntry({ ...home, co: "g.roche" }, "Roche"), { kind: "companies", value: "g.roche", label: "Roche" });
  // A drug class: the dashboard filtered to it alone, named by the dashboard (main.js classTitle).
  assert.deepEqual(recentEntry({ ...home, ...classState("L04AC") }, "L04AC Interleukin Inhibitors"), { kind: "classes", value: "L04AC", label: "L04AC Interleukin Inhibitors" });
  // Not yet named (its data still loading): nothing to record yet.
  assert.equal(recentEntry({ ...home, cond: "D011565" }, null), null);
  // An indication-text search, the overview, a filtered overview are not views to resume.
  assert.equal(recentEntry({ ...home, q: "wegovy" }, "“wegovy”"), null);
  assert.equal(recentEntry(home, null), null);
  assert.equal(recentEntry({ ...home, atc: ["L04AC", "C"] }, null), null);
  assert.equal(recentEntry({ ...home, atc: ["L04AC"] }, null), null);
});

test("adding puts the newest first, drops the older copy and keeps five", () => {
  let list = [];
  for (const [position, value] of ["a", "b", "c", "d", "e", "f"].entries()) {
    list = addRecent(list, { kind: "medicines", value, label: `M${position}` });
  }
  assert.equal(RECENT_MAX, 5);
  assert.deepEqual(list.map((entry) => entry.value), ["f", "e", "d", "c", "b"]);
  // Opened again: moved to the top, under its newest name.
  list = addRecent(list, { kind: "medicines", value: "c", label: "Renamed" });
  assert.deepEqual(list.map((entry) => entry.value), ["c", "f", "e", "d", "b"]);
  assert.equal(list[0].label, "Renamed");
  // The same value of another kind is another entry.
  list = addRecent(list, { kind: "substances", value: "c", label: "c" });
  assert.deepEqual(list.slice(0, 2).map((entry) => entry.kind), ["substances", "medicines"]);
  // An invalid entry leaves the list as it is.
  assert.equal(addRecent(list, null), list);
  assert.equal(addRecent(list, { kind: "text", value: "x", label: "x" }), list);
});

test("stored text that is not a list of entries reads as an empty or shorter list", () => {
  assert.deepEqual(parseRecent(null), []);
  assert.deepEqual(parseRecent(""), []);
  assert.deepEqual(parseRecent("{not json"), []);
  assert.deepEqual(parseRecent('{"kind":"medicines"}'), []);
  assert.deepEqual(parseRecent("42"), []);
  const mixed = JSON.stringify([
    wegovy,
    null,
    "Wegovy",
    { kind: "bogus", value: "x", label: "x" },
    { kind: "medicines", value: "", label: "Empty" },
    { kind: "medicines", value: 7, label: "Number" },
    { kind: "conditions", value: "D011565" },
    { kind: "medicines", value: "x".repeat(201), label: "Too long" },
    { ...psoriasis, extra: "<script>" },
    { ...wegovy, label: "Wegovy again" },
  ]);
  // Valid entries only, first copy kept, extra fields dropped.
  assert.deepEqual(parseRecent(mixed), [wegovy, psoriasis]);
  const many = JSON.stringify(Array.from({ length: 9 }, (_, index) => ({ kind: "medicines", value: `m${index}`, label: `M${index}` })));
  assert.equal(parseRecent(many).length, RECENT_MAX);
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

test("the list is kept per device under approval-atlas:recent; blocked storage only forgets it", () => {
  const kept = storage();
  assert.deepEqual(readRecent(kept), []);
  storeRecent(kept, [wegovy, psoriasis]);
  assert.deepEqual(JSON.parse(kept.items.get("approval-atlas:recent")), [wegovy, psoriasis]);
  assert.deepEqual(readRecent(kept), [wegovy, psoriasis]);
  // Cleared: the key is removed.
  storeRecent(kept, []);
  assert.equal(kept.items.size, 0);
  assert.deepEqual(readRecent(storage({ "approval-atlas:recent": "garbage" })), []);
  const blocked = storage({}, true);
  assert.equal(readRecent(blocked), null);
  assert.doesNotThrow(() => storeRecent(blocked, [wegovy]));
  assert.equal(readRecent(undefined), null);
  assert.doesNotThrow(() => storeRecent(undefined, [wegovy]));
});

test("the search list's group: the entries but the view open now, then Clear", () => {
  const group = recentGroup([wegovy, psoriasis]);
  assert.equal(group.key, "recent");
  assert.equal(group.label, UI.lookup.recent.label);
  assert.deepEqual(group.options.slice(0, 2), [
    { label: "Wegovy", meta: UI.lookup.recent.kinds.medicines, value: "EMEA/H/C/005422", pick: "medicines" },
    { label: "Psoriasis", meta: UI.lookup.recent.kinds.conditions, value: "D011565", pick: "conditions" },
  ]);
  // Clear: visible "Clear", named in full (the visible text first, WCAG 2.5.3).
  const clear = group.options.at(-1);
  assert.equal(clear.action, "clear");
  assert.equal(clear.label, "Clear");
  assert.ok(clear.name.startsWith(clear.label));
  // The view open now is left out (it is on screen); nothing left: no group.
  assert.deepEqual(recentGroup([wegovy, psoriasis], { ...wegovy }).options.map((option) => option.label), ["Psoriasis", "Clear"]);
  assert.equal(recentGroup([wegovy], wegovy), null);
  assert.equal(recentGroup([]), null);
  // Every kind has a name.
  for (const kind of ["medicines", "substances", "conditions", "companies", "classes"]) assert.ok(UI.lookup.recent.kinds[kind], kind);
});

test("a view is added when it opens or is named, not on every render; Clear sticks", () => {
  const kept = storage();
  const recent = createRecent(kept);
  const stored = () => JSON.parse(kept.items.get("approval-atlas:recent") ?? "[]").map((entry) => entry.label);
  recent.view(null); // a condition still loading, or the overview
  assert.deepEqual(stored(), []);
  recent.view(wegovy);
  recent.view(psoriasis);
  assert.deepEqual(stored(), ["Psoriasis", "Wegovy"]);
  // The view shown is left out of the group.
  assert.deepEqual(recent.group().options.map((option) => option.label), ["Wegovy", "Clear"]);
  // Cleared, then re-rendered on the same view: it does not come back by itself.
  recent.clear();
  assert.equal(kept.items.size, 0);
  recent.view({ ...psoriasis });
  assert.equal(kept.items.size, 0);
  assert.equal(recent.group(), null);
  // Another view, and back: both added again.
  recent.view(wegovy);
  recent.view(psoriasis);
  assert.deepEqual(stored(), ["Psoriasis", "Wegovy"]);
  // Another tab's additions are read when the list is shown.
  kept.items.set("approval-atlas:recent", JSON.stringify([{ kind: "companies", value: "g.roche", label: "Roche" }, psoriasis]));
  assert.deepEqual(recent.group().options.map((option) => option.label), ["Roche", "Clear"]);
  // Blocked storage: kept for the visit only.
  const blocked = createRecent(storage({}, true));
  blocked.view(wegovy);
  blocked.view(psoriasis);
  assert.deepEqual(blocked.group().options.map((option) => option.label), ["Wegovy", "Clear"]);
});
