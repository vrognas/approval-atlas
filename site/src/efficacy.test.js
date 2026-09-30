import { test } from "node:test";
import assert from "node:assert/strict";
import { formatArms, formatEffect, groupEfficacy, teaserText } from "./efficacy.js";

const row = (fields) => ({ indication: "NSCLC first line", trial: "FLAURA", endpoint: "PFS", effect_type: "hr", value: "0.46", ci_low: "0.37", ci_high: "0.57", ci_level: 95, ci_is_range: false, comparator: "gefitinib or erlotinib", arm_treatment: "18.9", arm_control: "10.2", arm_measure: "median months (95% CI)", lead: true, row_order: 1, ...fields });

test("an HR reads with its CI level as printed", () => {
  assert.equal(formatEffect(row({})), "HR 0.46 (95% CI 0.37–0.57)");
  assert.equal(formatEffect(row({ ci_level: 97.38, value: "0.63", ci_low: "0.43", ci_high: "0.91" })), "HR 0.63 (97.38% CI 0.43–0.91)");
});

test("a range printed like a CI says range; no significance words are added", () => {
  const text = formatEffect(row({ effect_type: "single_arm_median", value: "11.1", ci_low: "6.9", ci_high: "15.0", ci_is_range: true, ci_level: null }));
  assert.equal(text.includes("range 6.9–15.0"), true);
  assert.equal(/significan/i.test(formatEffect(row({}))), false);
});

test("other effect types, and values without a CI", () => {
  assert.equal(formatEffect(row({ effect_type: "hr_noninferiority", value: "0.94", ci_low: "0.84", ci_high: "1.05" })), "HR 0.94 (95% CI 0.84–1.05), non-inferiority");
  assert.equal(formatEffect(row({ effect_type: "rate_difference", value: "21.6", ci_low: "13.0", ci_high: "30.3", ci_level: 99 })), "difference 21.6 percentage points (99% CI 13.0–30.3)");
  assert.equal(formatEffect(row({ effect_type: "single_arm_rate", value: "37%", ci_low: "29", ci_high: "47" })), "response rate 37% (95% CI 29–47)");
  assert.equal(formatEffect(row({ effect_type: "single_arm_rate", value: "37.1", ci_low: null, ci_high: null })), "response rate 37.1");
  assert.equal(formatEffect(row({ ci_low: null, ci_high: null })), "HR 0.46");
});

test("NR stays NR", () => {
  assert.equal(formatArms(row({ arm_treatment: "NR (44.4, NR)", arm_control: "20.8" })).includes("NR"), true);
});

test("arms read as medians or as a pair; none without arms", () => {
  assert.equal(formatArms(row({})), "median 18.9 vs 10.2 months");
  assert.equal(formatArms(row({ arm_measure: "rate (%)" })), "18.9 vs 10.2 (rate (%))");
  assert.equal(formatArms(row({ arm_treatment: null, arm_control: null })), null);
});

test("rows group by indication, the lead first", () => {
  const groups = groupEfficacy([row({ lead: false, endpoint: "OS", row_order: 2 }), row({})]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].lead.endpoint, "PFS");
  assert.equal(groups[0].more.length, 1);
});

test("groups follow the lowest row_order; a group without a lead takes its first row", () => {
  const groups = groupEfficacy([
    row({ indication: "B", lead: false, row_order: 5 }),
    row({ indication: "A", lead: false, row_order: 3, endpoint: "OS" }),
    row({ indication: "B", lead: false, row_order: 4, endpoint: "ORR" }),
    row({ indication: null, lead: true, row_order: 9 }),
  ]);
  assert.deepEqual(groups.map((group) => group.indication), ["A", "B", null]);
  assert.equal(groups[1].lead.row_order, 4);
  assert.deepEqual(groups[1].more.map((item) => item.row_order), [5]);
});

test("the teaser names the trial, the effect and the comparator; single-arm says so", () => {
  const groups = groupEfficacy([row({})]);
  assert.equal(teaserText(groups), "Pivotal trial FLAURA: progression-free survival HR 0.46 (95% CI 0.37–0.57) vs gefitinib or erlotinib");
  const single = groupEfficacy([row({ comparator: null, effect_type: "single_arm_rate", endpoint: "ORR", value: "37.1", ci_low: "28.6", ci_high: "46.2" })]);
  assert.match(teaserText(single), /single-arm$/);
});

test("the teaser follows the condition in context, else the first group", () => {
  const groups = groupEfficacy([row({}), row({ indication: "Melanoma", trial: "KEYNOTE", row_order: 2 })]);
  assert.match(teaserText(groups, "melanoma"), /KEYNOTE/);
  assert.match(teaserText(groups, "asthma"), /FLAURA/);
});

test("no rows, no teaser", () => {
  assert.equal(teaserText([]), null);
});