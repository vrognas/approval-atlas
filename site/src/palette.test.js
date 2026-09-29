import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { ATC_GROUP_HUES as ATC_GROUPS, BRAND_HUES, SERIES_DISTANCE, companySeriesColors, tokenDistance } from "./badges.js";
import { OTHER_KEY, STACK_HUES, topWithOther } from "./facets.js";

// WCAG 2.2 contrast of the style.css tokens, light and dark: text >= 4.5:1 on every background
// it is used on, chart marks >= 3:1. Status dots and the per-year chart's status stacks (Stack by
// Status) use the hue mids, checked as chart marks; the approval year filter's bars are --bar.
const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");

function declarations(block) {
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

const light = declarations(css.match(/:root\s*\{([^}]*)\}/)[1]);
// Dark tokens: the device's dark scheme under Auto, and the viewer's Dark (theme.js), two blocks of
// the same declarations (checked below).
const DARK_AUTO = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/;
const DARK_CHOSEN = /\n:root\[data-theme="dark"\]\s*\{([^}]*)\}/;
const dark = { ...light, ...declarations(css.match(DARK_AUTO)[1]) };

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
// Company badges (companies part 2): the brand hues (badges.js BRAND_HUES); other groups take the
// hues above.
const BRANDS = Object.values(BRAND_HUES).map((brand) => brand.hue);

const TEXT_PAIRS = [
  ...["--ink", "--ink-secondary", "--muted", "--link", "--link-hover", "--accent"].flatMap((text) => BACKGROUNDS.map((background) => [text, background])),
  ["--ink", "--input"],
  ["--on-accent", "--accent"],
  ["--accent", "--accent-wash"],
  // Checked facet rows: name and count on the accent wash.
  ["--ink", "--accent-wash"],
  ["--ink-secondary", "--accent-wash"],
  ["--ink", "--mark"],
  // The search list's last option, the indication-text search (step 2), in link colour when active.
  ["--link", "--option-active"],
  // Headline tones: the "not" of "not authorized" and the "not yet" of a pending opinion.
  ...["--status-ended-text", "--status-pending-text"].flatMap((text) => BACKGROUNDS.map((background) => [text, background])),
  ...STATUS_HUES.flatMap((hue) => BACKGROUNDS.map((background) => [`--${hue}-text`, background])),
  ...ATC_HUES.flatMap((hue) => [1, 2, 3, 4, 5].map((level) => [`--${hue}-text`, `--${hue}-${level}`])),
  ...HEAT_STEPS.map((step) => [`--heat-${step}-text`, `--heat-${step}`]),
  // A company badge's monogram on its fill.
  ...BRANDS.map((hue) => [`--${hue}-text`, `--${hue}-1`]),
];

// The hue mids also stack "Approvals per year" by ATC group (each group's own hue) and by child
// class (main.js STACK_HUES). Their Other segment is the --raised fill with a --field-border
// outline (phase 4c review; NON_TEXT_PAIRS checks that outline on the card and on the fill); the
// segment of the medicines a mode cannot place adds --field-border hatching on that fill (the same
// pairs).
// Company groups stack by their hue's mid, a second group of one hue family by its text shade
// (badges.js companySeriesColors()).
const MARK_PAIRS = [
  "--type-other", "--type-generic", "--type-biosimilar", "--type-advanced-therapy",
  "--series-products", "--series-substances", "--bar", "--bar-rest", "--status-authorized",
  ...ATC_HUES.map((hue) => `--${hue}-mid`),
  ...[...ATC_HUES, ...BRANDS].map((hue) => `--${hue}-text`),
  ...BRANDS.map((hue) => `--${hue}-mid`),
].flatMap((mark) => BACKGROUNDS.map((background) => [mark, background]));

// WCAG 1.4.11: text-field borders against the field and what surrounds it; the year slider's
// thumb ring and selected track against the card and the unselected track; the approval-years
// bars outside the range and the unselected track: a --field-border outline against the card and
// their --raised fill. The sidebar splitter (sidebar-resize.js): its grip (--field-border) and its
// line on hover, focus and drag (--accent) against the sidebar and the page. A pressed branch chip's
// accent underline (area-chips.js; owner decision 2026-09-29) on the chip's fill.
const NON_TEXT_PAIRS = [
  ...["--input", ...BACKGROUNDS].map((background) => ["--field-border", background]),
  ["--field-border", "--raised"],
  ["--accent", "--surface"],
  ["--accent", "--raised"],
  ["--accent", "--page"],
  ["--accent", "--slate-2"],
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

  // WCAG 1.4.1: Authorized, the bottom segment of every per-year column stacked by status (the
  // approval-years strip's until phase 4f), differs in lightness from each status stacked on it
  // (red/green alone fails for protan and deutan vision).
  test(`${mode} the Authorized status segment differs in lightness from every other status (1.5:1)`, () => {
    const others = STATUS_HUES.filter((hue) => hue !== "green");
    const failing = others.map((hue) => [hue, contrast(tokens, "--status-authorized", `--${hue}-mid`)]).filter(([, ratio]) => ratio < 1.5);
    assert.deepEqual(failing, []);
  });

  // WCAG 1.4.1 (draft, loss-of-exclusivity calendar): a year's bar is --bar, then its medicines with
  // orphan market exclusivity running later in --pink-mid beside it (1px apart): they differ in
  // lightness too, not in hue alone.
  test(`${mode} the calendar's orphan segment differs in lightness from the bar beside it (1.5:1)`, () => {
    assert.ok(contrast(tokens, "--bar", "--pink-mid") >= 1.5, `--bar ~ --pink-mid ${contrast(tokens, "--bar", "--pink-mid").toFixed(2)}`);
  });

  // The conditions card (redesign 2026-09-29): each Medicines bar is its medicines of every status,
  // the authorized part --bar, the rest --bar-rest (a lighter tone of the accent; a chart mark on the
  // card, MARK_PAIRS), 1px apart: they differ in lightness, not only in shade.
  test(`${mode} the conditions card's authorized part differs in lightness from the rest of its bar (1.5:1)`, () => {
    assert.ok(contrast(tokens, "--bar", "--bar-rest") >= 1.5, `--bar ~ --bar-rest ${contrast(tokens, "--bar", "--bar-rest").toFixed(2)}`);
  });
}

// Checked facet rows sit on the accent wash, where --muted is under 4.5:1: a tree row's muted name
// (.no-name: the company tree's "(same name)", an ATC class without a name) takes another colour
// there, one that passes on the wash in both modes.
test("checked facet rows recolour muted names for the accent wash", () => {
  const selector = ".facet-row:has(input:checked) .no-name";
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g);
  const rule = [...rules].find(([, selectors]) => selectors.split(",").map((part) => part.trim()).includes(selector));
  assert.ok(rule, `no rule for ${selector}`);
  const color = rule[2].match(/(?:^|[;\s])color:\s*var\((--[\w-]+)\)/)?.[1];
  assert.ok(color, `${selector} sets no colour token`);
  for (const [mode, tokens] of [["light", light], ["dark", dark]]) {
    assert.ok(contrast(tokens, color, "--accent-wash") >= 4.5, `${mode}: ${color} on --accent-wash`);
  }
});

// "Approvals per year" stacked by company (companySeriesColors()): the 8 groups with the most dated
// medicines, overall and within each ATC group, can be told apart in both modes (skipped before a
// pipeline run). Same-hue brands (Teva and Pfizer, Roche and AbbVie) must not share a near twin.
const dataFile = (name) => new URL(`../public/data/${name}`, import.meta.url);
const stackFiles = ["ema_medicines.json", "ema_medicine_companies.json", "ema_medicine_atc_codes.json"];
test(
  "company stacks: the real top-8 sets differ by the series distance in light and dark",
  { skip: stackFiles.every((name) => existsSync(dataFile(name))) ? false : "data files not found" },
  () => {
    const [medicines, companyRows, atcRows] = stackFiles.map((name) => JSON.parse(readFileSync(dataFile(name), "utf8")));
    const tokensOf = (tokens) => Object.fromEntries(Object.keys(tokens).map((name) => [name, resolve(tokens, name)]));
    const palette = { light: tokensOf(light), dark: tokensOf(dark) };
    const groupOf = new Map(companyRows.map((row) => [row.ema_product_number, row.group_key]));
    const lettersOf = new Map();
    for (const row of atcRows) {
      const letter = (row.current_atc_code ?? row.atc_code ?? row.atc_code_human ?? "").charAt(0);
      if (!lettersOf.has(row.ema_product_number)) lettersOf.set(row.ema_product_number, new Set());
      if (letter) lettersOf.get(row.ema_product_number).add(letter);
    }
    const dated = medicines.filter((row) => row.authorized_from !== null && groupOf.get(row.ema_product_number));
    const sets = [["all", dated], ...Object.keys(ATC_GROUPS).map((letter) => [letter, dated.filter((row) => lettersOf.get(row.ema_product_number)?.has(letter))])];
    const failing = [];
    for (const [name, rows] of sets) {
      const keys = topWithOther(rows, (row) => [groupOf.get(row.ema_product_number)], 8).keys.filter((key) => key !== OTHER_KEY);
      const colors = [...companySeriesColors(keys, palette)].map(([key, color]) => [key, color.slice(4, -1)]);
      for (const [mode, tokens] of Object.entries(palette)) {
        for (const [index, [key, color]] of colors.entries()) {
          for (const [other, otherColor] of colors.slice(index + 1)) {
            const distance = tokenDistance({ light: tokens, dark: tokens }, color, otherColor);
            if (distance < SERIES_DISTANCE) failing.push(`${name} ${mode}: ${key} ${color} ~ ${other} ${otherColor} (${distance.toFixed(3)})`);
          }
        }
      }
    }
    assert.deepEqual(failing, []);
  },
);

// "Approvals per year" stacked by modality (M2 phase 2): the groups (or one group's modalities) in
// tree order take the STACK_HUES mids in order, so neighbouring segments differ by the series
// distance in both modes and every mid reaches 3:1 on page and surface; Not classified and a
// group's "not more specific" are the low-key --raised fill with a --field-border outline (checked
// above).
test("modality stacks: neighbouring stack hues differ by the series distance, each mark reaches 3:1", () => {
  const tokensOf = (tokens) => Object.fromEntries(Object.keys(tokens).map((name) => [name, resolve(tokens, name)]));
  const palette = { light: tokensOf(light), dark: tokensOf(dark) };
  const failing = [];
  for (const [mode, tokens] of Object.entries(palette)) {
    for (const [index, hue] of STACK_HUES.entries()) {
      for (const background of BACKGROUNDS) {
        const ratio = contrast(tokens, `--${hue}-mid`, background);
        if (ratio < 3) failing.push(`${mode}: --${hue}-mid on ${background} ${ratio.toFixed(2)}`);
      }
      const next = STACK_HUES[index + 1];
      if (!next) continue;
      const distance = tokenDistance({ light: tokens, dark: tokens }, `--${hue}-mid`, `--${next}-mid`);
      if (distance < SERIES_DISTANCE) failing.push(`${mode}: ${hue} ~ ${next} (${distance.toFixed(3)})`);
    }
  }
  assert.deepEqual(failing, []);
});

// Theme button (theme.js): the viewer's Dark repeats the device's dark block, declaration for
// declaration (color-scheme included), so the two cannot drift apart.
test("the chosen Dark theme's block equals the device's dark block", () => {
  const all = (block) => [...block.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => `${name}: ${value.trim()}`);
  const [auto, chosen] = [DARK_AUTO, DARK_CHOSEN].map((pattern) => css.match(pattern)?.[1]);
  assert.ok(auto && chosen, "a dark block is missing");
  assert.ok(all(auto).includes("color-scheme: dark"));
  assert.deepEqual(all(chosen), all(auto));
});

// The browser's toolbar colour (theme.js themeColors()) is each mode's page colour.
test("index.html's theme-color tags are the page colour of each mode", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const tag = (scheme) => html.match(new RegExp(`<meta name="theme-color" content="(#[0-9a-f]{6})" media="\\(prefers-color-scheme: ${scheme}\\)"`, "i"))?.[1].toLowerCase();
  assert.deepEqual([tag("light"), tag("dark")], [resolve(light, "--page").toLowerCase(), resolve(dark, "--page").toLowerCase()]);
});

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
