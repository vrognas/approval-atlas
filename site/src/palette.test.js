import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// WCAG 2.2 contrast of the style.css tokens, light and dark: text >= 4.5:1 on every background
// it is used on, chart marks >= 3:1. Status dots and the stacked strip's status segments use the
// hue mids, checked as chart marks.
const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");

function declarations(block) {
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

const light = declarations(css.match(/:root\s*\{([^}]*)\}/)[1]);
const dark = { ...light, ...declarations(css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/)[1]) };

function resolve(tokens, name) {
  const value = tokens[name];
  assert.ok(value, `${name} is not defined`);
  const reference = value.match(/^var\((--[\w-]+)\)$/);
  return reference ? resolve(tokens, reference[1]) : value;
}

function luminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(tokens, foreground, background) {
  const [high, low] = [luminance(resolve(tokens, foreground)), luminance(resolve(tokens, background))].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

const ATC_HUES = ["green", "teal", "blue", "indigo", "purple", "plum", "pink", "red", "orange", "gold", "olive", "brown", "sky", "slate"];
// Status hues (badges.js statusHue()): the label's text colour on the page and the card; on its
// pill fill (level 1) the hue table below checks it.
const STATUS_HUES = ["green", "red", "orange", "brown", "pink", "plum", "purple", "slate", "gold"];
const BACKGROUNDS = ["--page", "--surface"];
// Holder activity cells: five accent shades, each with its own number colour.
const HEAT_STEPS = [1, 2, 3, 4, 5];

const TEXT_PAIRS = [
  ...["--ink", "--ink-secondary", "--muted", "--link", "--link-hover", "--accent"].flatMap((text) => BACKGROUNDS.map((background) => [text, background])),
  ["--ink", "--input"],
  ["--on-accent", "--accent"],
  ["--accent", "--accent-wash"],
  // Checked facet rows: name and count on the accent wash.
  ["--ink", "--accent-wash"],
  ["--ink-secondary", "--accent-wash"],
  ["--ink", "--mark"],
  // Headline tones: the "not" of "not authorized" and the "not yet" of a pending opinion.
  ...["--status-ended-text", "--status-pending-text"].flatMap((text) => BACKGROUNDS.map((background) => [text, background])),
  ...STATUS_HUES.flatMap((hue) => BACKGROUNDS.map((background) => [`--${hue}-text`, background])),
  ...ATC_HUES.flatMap((hue) => [1, 2, 3, 4, 5].map((level) => [`--${hue}-text`, `--${hue}-${level}`])),
  ...HEAT_STEPS.map((step) => [`--heat-${step}-text`, `--heat-${step}`]),
];

const MARK_PAIRS = [
  "--type-other", "--type-generic", "--type-biosimilar", "--type-advanced-therapy",
  "--series-products", "--series-substances", "--bar", "--status-authorized",
  ...ATC_HUES.map((hue) => `--${hue}-mid`),
].flatMap((mark) => BACKGROUNDS.map((background) => [mark, background]));

// WCAG 1.4.11: text-field borders against the field and what surrounds it; the year slider's
// thumb ring and selected track against the card and the unselected track; the approval-years
// bars outside the range and the unselected track: a --field-border outline against the card and
// their --raised fill.
const NON_TEXT_PAIRS = [
  ...["--input", ...BACKGROUNDS].map((background) => ["--field-border", background]),
  ["--field-border", "--raised"],
  ["--accent", "--surface"],
  ["--accent", "--raised"],
];

for (const [mode, tokens] of [["light", light], ["dark", dark]]) {
  test(`${mode} text tokens reach 4.5:1 on their backgrounds`, () => {
    const failing = TEXT_PAIRS.map(([text, background]) => [text, background, contrast(tokens, text, background)]).filter(([, , ratio]) => ratio < 4.5);
    assert.deepEqual(failing, []);
  });

  test(`${mode} chart marks reach 3:1 on page and surface`, () => {
    const failing = MARK_PAIRS.map(([mark, background]) => [mark, background, contrast(tokens, mark, background)]).filter(([, , ratio]) => ratio < 3);
    assert.deepEqual(failing, []);
  });

  test(`${mode} non-text component colors reach 3:1`, () => {
    const failing = NON_TEXT_PAIRS.map(([color, background]) => [color, background, contrast(tokens, color, background)]).filter(([, , ratio]) => ratio < 3);
    assert.deepEqual(failing, []);
  });

  // WCAG 1.4.1: Authorized, the bottom segment of every approval-years bar, differs in lightness
  // from each status stacked on it (red/green alone fails for protan and deutan vision).
  test(`${mode} the Authorized strip segment differs in lightness from every other status (1.5:1)`, () => {
    const others = STATUS_HUES.filter((hue) => hue !== "green");
    const failing = others.map((hue) => [hue, contrast(tokens, "--status-authorized", `--${hue}-mid`)]).filter(([, ratio]) => ratio < 1.5);
    assert.deepEqual(failing, []);
  });
}

test("light tokens match the approved E · Sage palette", () => {
  const expected = {
    "--page": "#f3f3ee", "--surface": "#fafaf7", "--raised": "#eaeae3", "--input": "#fffffc", "--grid": "#ddddd4", "--axis": "#c8c8bc",
    "--ink": "#282828", "--ink-secondary": "#50504f", "--muted": "#6a6a64", "--link": "#576a39", "--link-underline": "#8c957b",
    "--accent": "#2b4a31", "--accent-wash": "#dfe6da",
    "--status-ended-text": "#7a2e22", "--status-pending-text": "#5e4a10",
    "--type-other": "#6f86a6", "--type-generic": "#a8812a", "--type-biosimilar": "#4e8f86", "--type-advanced-therapy": "#8a6ba8",
    "--gold-1": "#efe4c6", "--gold-5": "#cdb47b", "--blue-3": "#bfccdd", "--slate-text": "#3d403b",
  };
  assert.deepEqual(Object.fromEntries(Object.keys(expected).map((name) => [name, resolve(light, name).toLowerCase()])), expected);
});

test("dark tokens start from the brief's dark palette", () => {
  const expected = { "--page": "#1b1c19", "--surface": "#232420", "--ink": "#e8e8e1", "--accent": "#a7c4a0", "--link": "#b9c4a4" };
  assert.deepEqual(Object.fromEntries(Object.keys(expected).map((name) => [name, resolve(dark, name).toLowerCase()])), expected);
});
