// The ATC class explanations on the real data files (owner decisions 2026-09-29): every class the
// data uses at levels 1-4 is explained first in its tip; no text names a medicine or substance of
// the data (the R pipeline stops on one: check_atc_explanations()), holds an em-dash, runs over 20
// words or lacks its closing period (the two lines of a tip read apart as one description).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { atcClassTip, atcCode, atcLevel, atcPrefixes, buildAtcExplanations } from "./atc.js";

const dataFile = (name) => new URL(`../public/data/${name}`, import.meta.url);
const explanationsFile = dataFile("atc_class_explanations.json");
const readJson = (url) => JSON.parse(readFileSync(url, "utf8"));
const skip = existsSync(explanationsFile) ? false : "site/public/data/atc_class_explanations.json not found (run the pipeline)";

// As R's fold_explanation_words(): lower-case words, one space apart, a space at each end.
const fold = (text) => ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

// The words R's atc_explanation_allowed_words() allows, folded, each with the classes it is allowed
// in (and their descendants) (R/atc-explanations.R, one source of truth).
function allowedWords() {
  const source = readFileSync(new URL("../../R/atc-explanations.R", import.meta.url), "utf8");
  return new Map([...source.matchAll(/^ {4}"([^"]+)", (c\([^)]*\)|"[^"]+"), paste\($/gm)]
    .map((match) => [fold(match[1]), [...match[2].matchAll(/"([^"]+)"/g)].map((code) => code[1])]));
}

test("the published explanations are the committed texts of the classes in use", { skip }, () => {
  const published = readJson(explanationsFile);
  const committed = new Map(readJson(new URL("../../data-raw/atc-class-explanations.json", import.meta.url)).map((row) => [row.code, row]));
  assert.ok(published.length > 500, `${published.length} rows`);
  assert.deepEqual(published.map((row) => row.atc_code), [...published.map((row) => row.atc_code)].sort());
  for (const row of published) {
    assert.deepEqual(Object.keys(row), ["atc_code", "level", "explanation", "checked_date", "source"]);
    assert.equal(row.source, "approval_atlas");
    assert.equal(row.level, atcLevel(row.atc_code));
    assert.equal(row.explanation, committed.get(row.atc_code)?.explanation, row.atc_code);
  }
});

test("every class the data uses at levels 1-4 has a tip led by its explanation", { skip }, () => {
  const explanations = buildAtcExplanations(readJson(explanationsFile));
  const classes = new Map(readJson(dataFile("atc_classes.json")).map((row) => [row.atc_code, row]));
  const used = new Set(readJson(dataFile("ema_medicine_atc_codes.json"))
    .flatMap((row) => atcPrefixes(atcCode(row)))
    .filter((code) => atcLevel(code) < 5));
  const unexplained = [];
  for (const code of used) {
    const explanation = explanations.get(code);
    if (!explanation) {
      unexplained.push(code);
      continue;
    }
    const [lead, second] = atcClassTip(code, classes, explanations).split("\n");
    assert.equal(lead, explanation, code);
    assert.match(second, new RegExp(`^ATC level ${atcLevel(code)}, `), code);
  }
  // Only a class WHO does not name may go without (the pipeline warns; none on 2026-09-29).
  assert.deepEqual(unexplained.filter((code) => classes.has(code)), []);
  assert.ok(used.size - unexplained.length > 500, `${used.size} classes, ${unexplained.length} without`);
});

test("no explanation names a medicine or substance of the data, uses an em-dash or runs long", { skip }, () => {
  const published = readJson(explanationsFile);
  const classes = new Map(readJson(dataFile("atc_classes.json")).map((row) => [row.atc_code, row.name]));
  const allowed = allowedWords();
  assert.ok(allowed.size >= 6, [...allowed.keys()].join(","));
  assert.deepEqual(allowed.get(" testosterone "), ["L02AE", "L02B"]);
  // Medicine names, substance keys and EMA's active-substance texts (salts the keys spell otherwise).
  const terms = new Set([
    ...readJson(dataFile("ema_medicines.json")).map((row) => row.name_of_medicine),
    ...readJson(dataFile("ema_medicine_substances.json")).map((row) => row.substance_key),
    ...readJson(dataFile("ema_medicine_active_substances.json")).map((row) => row.active_substance),
  ].filter(Boolean).map(fold).filter((term) => term.trim()));
  assert.ok(terms.has(" dopamine "));
  const allowedIn = (term, code) => (allowed.get(term) ?? []).some((prefix) => code.startsWith(prefix));
  const naming = [];
  for (const row of published) {
    const text = fold(row.explanation);
    const name = fold(classes.get(row.atc_code) ?? "");
    for (const term of terms) if (text.includes(term) && !name.includes(term) && !allowedIn(term, row.atc_code)) naming.push(`${row.atc_code}: ${term.trim()}`);
    assert.ok(!row.explanation.includes("—"), row.atc_code);
    assert.ok(row.explanation.split(/\s+/).length <= 20, row.atc_code);
    assert.match(row.explanation, /\.$/, row.atc_code);
  }
  assert.deepEqual(naming, []);
});
