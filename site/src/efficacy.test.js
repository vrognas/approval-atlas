import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { analysisLine, efficacySourceUrl, endpointLine, formatArms, formatEffect, groupEfficacy, populationNote, regimenLine, teaserText } from "./efficacy.js";

const row = (fields) => ({ indication: "NSCLC first line", trial: "FLAURA", endpoint: "PFS", effect_type: "hr", value: "0.46", ci_low: "0.37", ci_high: "0.57", ci_level: 95, ci_is_range: false, comparator: "gefitinib or erlotinib", arm_treatment: "18.9", arm_control: "10.2", arm_measure: "median months (95% CI)", lead: true, row_order: 1, ...fields });

test("an HR reads with its CI level as printed", () => {
  assert.equal(formatEffect(row({})), "HR 0.46 (95% CI 0.37–\u20600.57)");
  assert.equal(formatEffect(row({ ci_level: 97.38, value: "0.63", ci_low: "0.43", ci_high: "0.91" })), "HR 0.63 (97.38% CI 0.43–\u20600.91)");
});

test("a range printed like a CI says range; no significance words are added", () => {
  const text = formatEffect(row({ effect_type: "single_arm_median", value: "11.1", ci_low: "6.9", ci_high: "15.0", ci_is_range: true, ci_level: null }));
  assert.equal(text.includes("range 6.9–\u206015.0"), true);
  assert.equal(/significan/i.test(formatEffect(row({}))), false);
});

test("other effect types, and values without a CI", () => {
  assert.equal(formatEffect(row({ effect_type: "hr_noninferiority", value: "0.94", ci_low: "0.84", ci_high: "1.05" })), "HR 0.94 (95% CI 0.84–\u20601.05), non-inferiority");
  assert.equal(formatEffect(row({ effect_type: "rate_difference", value: "21.6", ci_low: "13.0", ci_high: "30.3", ci_level: 99 })), "difference 21.6 percentage points (99% CI 13.0–\u206030.3)");
  assert.equal(formatEffect(row({ effect_type: "single_arm_rate", value: "37%", ci_low: "29", ci_high: "47" })), "response rate 37% (95% CI 29–\u206047)");
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
  assert.equal(teaserText(groups), "Pivotal trial FLAURA: progression-free survival HR 0.46 (95% CI 0.37–\u20600.57) vs gefitinib or erlotinib");
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
test("the ORR single-arm teaser does not repeat the endpoint name", () => {
  const single = groupEfficacy([row({ comparator: null, effect_type: "single_arm_rate", endpoint: "ORR", value: "37.1", ci_low: "28.6", ci_high: "46.2" })]);
  assert.equal(teaserText(single), "Pivotal trial FLAURA: response rate 37.1 (95% CI 28.6–\u206046.2), single-arm");
});

test("a missing CI level reads CI, never null", () => {
  assert.equal(formatEffect(row({ ci_level: null })), "HR 0.46 (CI 0.37–\u20600.57)");
});

test("a comparative lead without a comparator drops the comparison, not guessing one", () => {
  assert.equal(teaserText(groupEfficacy([row({ comparator: null })])), "Pivotal trial FLAURA: progression-free survival HR 0.46 (95% CI 0.37–\u20600.57)");
});

test("a null trial or an unknown endpoint leaves no double spaces or inherited names", () => {
  const text = teaserText(groupEfficacy([row({ trial: null, endpoint: "constructor" })]));
  assert.equal(text, "Pivotal trial: constructor HR 0.46 (95% CI 0.37–\u20600.57) vs gefitinib or erlotinib");
  assert.equal(teaserText(groupEfficacy([row({ endpoint: null })])).includes("  "), false);
});

test("the context match ignores case; no match, or a null-indication group, falls back to the first", () => {
  const groups = groupEfficacy([row({ indication: null }), row({ indication: "Melanoma", trial: "KEYNOTE", row_order: 2 })]);
  assert.match(teaserText(groups, "MELANOMA"), /KEYNOTE/);
  assert.match(teaserText(groups, "asthma"), /FLAURA/);
  assert.match(teaserText(groups, "melanoma"), /KEYNOTE/);
});

test("a rate difference already printed with % or pp gets no unit text", () => {
  assert.equal(formatEffect(row({ effect_type: "rate_difference", value: "21.6%", ci_low: "13.0", ci_high: "30.3", ci_level: 99 })), "difference 21.6% (99% CI 13.0–\u206030.3)");
  assert.equal(formatEffect(row({ effect_type: "rate_difference", value: "21.6 pp", ci_low: null, ci_high: null })), "difference 21.6 pp");
});

test("median arm measures keep the unit, whatever the punctuation", () => {
  assert.equal(formatArms(row({ arm_measure: "Median, months" })), "median 18.9 vs 10.2 months");
  assert.equal(formatArms(row({ arm_measure: "median (95% CI) months" })), "median 18.9 vs 10.2 months");
});
// Task 9: the More details section's lines (pure parts of lookup.js efficacySection()).
test("the population note names a matching subgroup, a broader trial or another population; none when the trial matches", () => {
  assert.equal(populationNote(row({ population_match: "subgroup_matches" })), "subgroup (matches EU indication)");
  assert.equal(populationNote(row({ population_match: "whole_trial_broader" })), "whole trial (EU indication is narrower)");
  assert.equal(populationNote(row({ population_match: "other" })), "population differs from the EU indication");
  assert.equal(populationNote(row({ population_match: "whole_trial_matches" })), null);
  assert.equal(populationNote(row({ population_match: null })), null);
});

test("the regimen line compares, or says single-arm; it never invents a regimen", () => {
  assert.equal(regimenLine(row({ regimen: "osimertinib", n_treatment: 279, n_control: 277 })), "osimertinib (n\u00a0=\u00a0279) vs gefitinib or erlotinib (n\u00a0=\u00a0277)");
  assert.equal(regimenLine(row({ regimen: "sotorasib", comparator: null, n_treatment: 126, n_control: null, effect_type: "single_arm_rate" })), "sotorasib (n\u00a0=\u00a0126), single-arm");
  assert.equal(regimenLine(row({ regimen: null, n_treatment: null, n_control: null })), "vs gefitinib or erlotinib");
  assert.equal(regimenLine(row({ regimen: null, comparator: null, n_treatment: null, n_control: null })), null);
});

test("the endpoint line says a primary endpoint only when the source does", () => {
  assert.equal(endpointLine(row({ assessment: "investigator", is_primary: true })), "progression-free survival (PFS), assessed by investigator, primary endpoint");
  assert.equal(endpointLine(row({ endpoint: "Time to deterioration", assessment: null, is_primary: null })), "Time to deterioration");
  assert.equal(endpointLine(row({ endpoint: null, assessment: null, is_primary: false })), null);
});

test("the analysis line names its role, then the source's words", () => {
  assert.equal(analysisLine(row({ analysis_role: "primary", analysis: "data cut-off 12 June 2017" })), "Primary analysis: data cut-off 12 June 2017");
  assert.equal(analysisLine(row({ analysis_role: "later", analysis: "updated OS, 2019" })), "Later analysis: updated OS, 2019");
  assert.equal(analysisLine(row({ analysis_role: "exploratory", analysis: null })), "Exploratory analysis");
  assert.equal(analysisLine(row({ analysis_role: null, analysis: "OS immature" })), "OS immature");
  assert.equal(analysisLine(row({ analysis_role: null, analysis: null })), null);
});

test("the source link opens the PDF at its page; https only", () => {
  const url = "https://www.ema.europa.eu/en/documents/product-information/x-epar-product-information_en.pdf";
  assert.equal(efficacySourceUrl(row({ source_url: url, page: 41 })), `${url}#page=41`);
  assert.equal(efficacySourceUrl(row({ source_url: url, page: null })), url);
  assert.equal(efficacySourceUrl(row({ source_url: "http://example.org/x.pdf", page: 2 })), null);
});

const dataPath = new URL("../public/data/ema_medicine_efficacy.json", import.meta.url);
test("every product in the data file has exactly one lead per indication and https sources", { skip: !existsSync(dataPath) }, () => {
  const rows = JSON.parse(readFileSync(dataPath, "utf8"));
  const leads = new Map();
  for (const row of rows) {
    assert.match(row.source_url, /^https:\/\//);
    if (row.lead) {
      const key = `${row.ema_product_number}|${row.indication}`;
      assert.equal(leads.has(key), false, key);
      leads.set(key, true);
    }
  }
  // Every indication has its lead (the card's teaser and each block start with it).
  const indications = new Set(rows.map((row) => `${row.ema_product_number}|${row.indication}`));
  assert.equal(leads.size, indications.size);
});

// Fix round 1 of Task 9 review: an interval never breaks after its dash (word joiner, U+2060).
test("an interval keeps its dash with the upper bound", () => {
  assert.equal(formatEffect(row({})).includes("0.37–\u2060" + "0.57"), true);
  assert.equal(formatEffect(row({ effect_type: "single_arm_median", ci_is_range: true })).includes("range 0.37–\u2060" + "0.57"), true);
});

test("a single-arm median prints the unit its measure states, never an invented one", () => {
  const median = (fields) => formatEffect(row({ effect_type: "single_arm_median", value: "11.1", ci_low: null, ci_high: null, arm_treatment: null, arm_control: null, comparator: null, ...fields }));
  assert.equal(median({ arm_measure: "median months (95% CI)" }), "median 11.1 months");
  assert.equal(median({ arm_measure: "Median DoR, weeks" }), "median 11.1 weeks");
  assert.equal(median({ arm_measure: null }), "median 11.1");
  assert.equal(median({ arm_measure: "median (95% CI)" }), "median 11.1");
  assert.equal(median({ arm_measure: "median months", ci_low: "6.9", ci_high: "15.0", ci_is_range: true }), "median 11.1 months (range 6.9–\u2060" + "15.0)");
});