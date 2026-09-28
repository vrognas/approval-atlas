import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  ATC_CODE,
  ATC_GROUP_HUES,
  ATC_PREFIX_LENGTHS,
  BRAND_HUES,
  atcHue,
  companyHue,
  companySeriesColors,
  atcSegments,
  oklab,
  statusColor,
  statusHue,
  statusTip,
  statusTipId,
  tokenDistance,
  typeBadges,
  typeTip,
  typeTipId,
} from "./badges.js";

test("the ATC code shape and level lengths are defined once, here", () => {
  assert.deepEqual(ATC_PREFIX_LENGTHS, [1, 3, 4, 5, 7]);
  assert.deepEqual(["L", "L04", "L04A", "L04AC", "L04AC05", "LX1XX02", "L4", "l04"].map((code) => ATC_CODE.test(code)), [true, true, true, true, true, false, false, false]);
  const folder = new URL("./", import.meta.url);
  const copies = readdirSync(folder)
    .filter((file) => file.endsWith(".js") && !file.endsWith(".test.js") && file !== "badges.js")
    .filter((file) => /\[1, 3, 4, 5, 7\]|\\d\{2\}\(\[A-Z\]/.test(readFileSync(new URL(file, folder), "utf8")));
  assert.deepEqual(copies, []);
});

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
  // Phase 4c review: a row without an EMA code (atc_code_human null) never throws.
  assert.equal(atcHue(null), "slate");
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

// Status colours (phase 4a review): one damped hue per status for dots, pills and the stacked strip.
test("every status has its own hue; the two pending opinions share gold, the withdrawn applications slate", () => {
  const hues = {
    Authorised: "green",
    Withdrawn: "red",
    Expired: "orange",
    Lapsed: "brown",
    Suspended: "pink",
    Revoked: "plum",
    Refused: "purple",
    "Application withdrawn": "slate",
    "Withdrawn from rolling review": "slate",
    Opinion: "gold",
    "Opinion under re-examination": "gold",
    "Something new": "slate",
  };
  assert.deepEqual(Object.fromEntries(Object.keys(hues).map((status) => [status, statusHue(status)])), hues);
});

test("each type explanation has one element id, which focusable carriers are described by", () => {
  assert.equal(typeTipId("Advanced therapy"), "type-tip-advanced-therapy");
  assert.equal(typeTipId("Orphan"), "type-tip-orphan");
});

// Phase 4f: status explanations (UI.statusTips), shown and described as the type ones.
test("each status explanation has one element id; tips give the text and that id, or null", () => {
  assert.equal(statusTipId("Opinion under re-examination"), "status-tip-opinion-under-re-examination");
  assert.equal(statusTipId("Authorised"), "status-tip-authorised");
  assert.deepEqual(statusTip("Lapsed"), { text: "Authorization ended: not marketed for 3 years.", id: "status-tip-lapsed" });
  assert.equal(statusTip("Something new"), null);
  assert.deepEqual(typeTip("Orphan"), { text: "For rare diseases (at most 5 in 10,000 people in the EU).", id: "type-tip-orphan" });
  assert.equal(typeTip(null), null);
});

// Phase 4f: "Approvals per year" stacked by status: the strip's colours of phase 4a.
test("a status's chart colour: its hue's mid, Authorized the darker --status-authorized", () => {
  assert.equal(statusColor("Authorised"), "var(--status-authorized)");
  assert.equal(statusColor("Withdrawn"), "var(--red-mid)");
  assert.equal(statusColor("Something new"), "var(--slate-mid)");
});

// Companies part 2 (user decision 2026-09-28): monogram badges, the largest groups in a damped
// version of their brand colour, every other group in a damped hue that is the same on every page.
test("company badges: brand hues for the largest groups, a stable damped hue (never slate) for the rest", () => {
  assert.deepEqual(companyHue("g.roche"), { hue: "co-roche" });
  assert.deepEqual(companyHue("g.eli-lilly"), { hue: "co-lilly" });
  const hue = companyHue("g.stada");
  assert.deepEqual(companyHue("g.stada"), hue);
  assert.ok(Object.values(ATC_GROUP_HUES).includes(hue.hue));
  const hashed = Array.from({ length: 200 }, (_, index) => companyHue(`g.company-${index}`).hue);
  assert.equal(hashed.includes("slate"), false);
  assert.ok(new Set(hashed).size >= 10);
  assert.equal(new Set(Object.values(BRAND_HUES).map((brand) => brand.hue)).size, Object.keys(BRAND_HUES).length);
  // The ~25 largest groups (spec): the user's 20, then Krka, CSL and Gedeon Richter.
  assert.ok(Object.keys(BRAND_HUES).length >= 23);
});

test("style.css defines each brand hue's fill, mid and text in both modes, and its hue class", () => {
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  const light = css.match(/:root\s*\{([^}]*)\}/)[1];
  const dark = css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/)[1];
  const missing = Object.values(BRAND_HUES).flatMap(({ hue }) => ["1", "mid", "text"].flatMap((step) =>
    [[light, "light"], [dark, "dark"]].filter(([block]) => !block.includes(`--${hue}-${step}:`)).map(([, mode]) => `${mode} --${hue}-${step}`)));
  assert.deepEqual(missing, []);
  assert.deepEqual(Object.values(BRAND_HUES).filter(({ hue }) => !css.includes(`.hue-${hue} {`)), []);
});

// The brand keys are group keys the pipeline writes (skipped before a run).
const companiesFile = new URL("../public/data/companies.json", import.meta.url);
test("every brand hue belongs to a company group in companies.json", { skip: existsSync(companiesFile) ? false : "companies.json not found" }, () => {
  const groups = new Set(JSON.parse(readFileSync(companiesFile, "utf8")).filter((row) => row.kind === "group").map((row) => row.key));
  assert.deepEqual(Object.keys(BRAND_HUES).filter((key) => !groups.has(key)), []);
});

test("company chart colours: its mid, else its text shade, else the nearest other hue that differs from those taken", () => {
  // A palette where Pfizer's mid is Roche's twin, Amgen's mid and text are Roche's and Pfizer's
  // text, and the blue mid is near them too: the next nearest hue far enough, indigo.
  const tokens = {
    "--co-roche-mid": "#4662a5", "--co-roche-text": "#1d305d",
    "--co-pfizer-mid": "#4763a6", "--co-pfizer-text": "#1e245c",
    "--co-amgen-mid": "#4662a4", "--co-amgen-text": "#1e245d",
    "--blue-mid": "#4a64a0", "--indigo-mid": "#8a4fb0", "--co-novartis-mid": "#a6763a",
  };
  const colors = companySeriesColors(["g.roche", "g.novartis", "g.pfizer", "g.amgen"], { light: tokens, dark: tokens });
  assert.equal(colors.get("g.roche"), "var(--co-roche-mid)");
  assert.equal(colors.get("g.novartis"), "var(--co-novartis-mid)");
  assert.equal(colors.get("g.pfizer"), "var(--co-pfizer-text)");
  assert.equal(colors.get("g.amgen"), "var(--indigo-mid)");
  // Without the palette's colours: each its mid, a second group of one hue its text shade.
  const firstOfHue = new Map();
  let [a, b] = [null, null];
  for (let index = 0; b === null; index++) {
    const key = `g.company-${index}`;
    const { hue } = companyHue(key);
    if (firstOfHue.has(hue)) [a, b] = [firstOfHue.get(hue), key];
    else firstOfHue.set(hue, key);
  }
  const plain = companySeriesColors(["g.roche", a, b]);
  assert.equal(plain.get("g.roche"), "var(--co-roche-mid)");
  assert.equal(plain.get(a), `var(--${companyHue(a).hue}-mid)`);
  assert.equal(plain.get(b), `var(--${companyHue(b).hue}-text)`);
});

test("colour distance: OKLab, the smaller of both modes", () => {
  assert.equal(tokenDistance({ light: {}, dark: {} }, "--a", "--a"), 0);
  assert.equal(tokenDistance({ light: {}, dark: {} }, "--a", "--b"), Infinity);
  const palette = { light: { "--a": "#000000", "--b": "#ffffff" }, dark: { "--a": "#000000", "--b": "#000000" } };
  assert.equal(tokenDistance(palette, "--a", "--b"), 0);
  assert.ok(Math.abs(oklab("#ffffff")[0] - 1) < 1e-6);
  assert.equal(oklab("var(--x)"), null);
});