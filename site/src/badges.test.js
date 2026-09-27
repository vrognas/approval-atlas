import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ATC_GROUP_HUES, atcHue, atcSegments, typeBadges } from "./badges.js";

test("a level-5 ATC code splits into its five levels, each showing only its new characters", () => {
  assert.deepEqual(atcSegments("L04AC05"), [
    { level: 1, code: "L", text: "L" },
    { level: 2, code: "L04", text: "04" },
    { level: 3, code: "L04A", text: "A" },
    { level: 4, code: "L04AC", text: "C" },
    { level: 5, code: "L04AC05", text: "05" },
  ]);
});

test("an incomplete code yields only the levels it has", () => {
  assert.deepEqual(atcSegments("L01XE").map((segment) => segment.text), ["L", "01", "X", "E"]);
  assert.deepEqual(atcSegments("A10"), [{ level: 1, code: "A", text: "A" }, { level: 2, code: "A10", text: "10" }]);
  assert.deepEqual(atcSegments("V"), [{ level: 1, code: "V", text: "V" }]);
});

// The two malformed EMA codes (atc_level null in the data) are shown whole, never split.
test("a malformed code is one segment with the whole code and no level", () => {
  assert.deepEqual(atcSegments("LX1XX02"), [{ level: null, code: "LX1XX02", text: "LX1XX02" }]);
  assert.deepEqual(atcSegments("VO4D"), [{ level: null, code: "VO4D", text: "VO4D" }]);
  assert.deepEqual(atcSegments("l04ac05"), [{ level: null, code: "l04ac05", text: "l04ac05" }]);
});

test("no code, no segments", () => {
  assert.deepEqual(atcSegments(""), []);
  assert.deepEqual(atcSegments(null), []);
});

test("every ATC level-1 group has its own hue; codes take the hue of their first letter", () => {
  assert.deepEqual(Object.keys(ATC_GROUP_HUES).sort(), ["A", "B", "C", "D", "G", "H", "J", "L", "M", "N", "P", "R", "S", "V"]);
  assert.equal(new Set(Object.values(ATC_GROUP_HUES)).size, 14);
  assert.equal(atcHue("L04AC05"), "blue");
  assert.equal(atcHue("A"), "gold");
  assert.equal(atcHue("LX1XX02"), "blue");
  assert.equal(atcHue("X01"), "slate");
});

test("style.css defines the five level shades, mid and text colour of every hue", () => {
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  const missing = Object.values(ATC_GROUP_HUES).flatMap((hue) =>
    ["1", "2", "3", "4", "5", "mid", "text"].map((step) => `--${hue}-${step}`).filter((token) => !css.includes(`${token}:`)),
  );
  assert.deepEqual(missing, []);
  const classes = Object.values(ATC_GROUP_HUES).filter((hue) => !css.includes(`.hue-${hue} {`));
  assert.deepEqual(classes, []);
});

test("type badges: Generic, Biosimilar and Advanced therapy get a badge, Other none; orphans add one", () => {
  assert.deepEqual(typeBadges({ medicine_type: "Generic", orphan_medicine: false }), [{ label: "Generic", hue: "gold" }]);
  assert.deepEqual(typeBadges({ medicine_type: "Biosimilar", orphan_medicine: false }), [{ label: "Biosimilar", hue: "teal" }]);
  assert.deepEqual(typeBadges({ medicine_type: "Advanced therapy", orphan_medicine: true }), [
    { label: "Advanced therapy", hue: "purple" },
    { label: "Orphan", hue: "pink" },
  ]);
  assert.deepEqual(typeBadges({ medicine_type: "Other", orphan_medicine: true }), [{ label: "Orphan", hue: "pink" }]);
  assert.deepEqual(typeBadges({ medicine_type: "Other", orphan_medicine: false }), []);
});
