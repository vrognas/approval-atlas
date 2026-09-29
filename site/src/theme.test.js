import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { UI } from "./labels.js";
import { THEME_STORAGE_KEY, colorSchemeContent, nextTheme, readTheme, shownScheme, storeTheme, themeColors } from "./theme.js";

// A localStorage stand-in; broken: every access throws (blocked site data).
function storage(entries = {}, broken = false) {
  const map = new Map(Object.entries(entries));
  const guard = () => {
    if (broken) throw new Error("blocked");
  };
  return {
    map,
    getItem: (key) => (guard(), map.has(key) ? map.get(key) : null),
    setItem: (key, value) => (guard(), map.set(key, String(value))),
    removeItem: (key) => (guard(), map.delete(key)),
  };
}

test("readTheme: the stored Light or Dark, else Auto (nothing stored, another value, no or blocked storage)", () => {
  assert.equal(readTheme(storage({ [THEME_STORAGE_KEY]: "light" })), "light");
  assert.equal(readTheme(storage({ [THEME_STORAGE_KEY]: "dark" })), "dark");
  assert.equal(readTheme(storage()), "auto");
  assert.equal(readTheme(storage({ [THEME_STORAGE_KEY]: "sepia" })), "auto");
  assert.equal(readTheme(undefined), "auto");
  assert.equal(readTheme(storage({ [THEME_STORAGE_KEY]: "dark" }, true)), "auto");
});

test("storeTheme: Light and Dark are stored, Auto removes the entry, blocked storage is ignored", () => {
  const store = storage();
  storeTheme(store, "dark");
  assert.equal(store.map.get(THEME_STORAGE_KEY), "dark");
  storeTheme(store, "light");
  assert.equal(store.map.get(THEME_STORAGE_KEY), "light");
  storeTheme(store, "auto");
  assert.equal(store.map.has(THEME_STORAGE_KEY), false);
  assert.doesNotThrow(() => storeTheme(storage({}, true), "dark"));
  assert.doesNotThrow(() => storeTheme(undefined, "dark"));
});

test("shownScheme: Auto shows the device's scheme, Light and Dark their own", () => {
  assert.equal(shownScheme("auto", true), "dark");
  assert.equal(shownScheme("auto", false), "light");
  assert.equal(shownScheme("light", true), "light");
  assert.equal(shownScheme("dark", false), "dark");
});

// Every press flips the page (bug 2026-09-29: Dark to Auto on a dark device changed nothing, so it
// took two presses); back on the device's own scheme it is Auto again (nothing stored).
test("nextTheme: every press shows the other scheme; the device's own is Auto", () => {
  for (const deviceDark of [true, false]) {
    for (const theme of ["auto", "light", "dark"]) {
      const next = nextTheme(theme, deviceDark);
      assert.notEqual(shownScheme(next, deviceDark), shownScheme(theme, deviceDark), `${theme}, device dark: ${deviceDark}`);
    }
  }
  assert.equal(nextTheme("auto", true), "light");
  assert.equal(nextTheme("light", true), "auto");
  assert.equal(nextTheme("auto", false), "dark");
  assert.equal(nextTheme("dark", false), "auto");
  // A choice made on the other scheme (the device changed since): Dark on a dark device flips to Light.
  assert.equal(nextTheme("dark", true), "light");
  assert.equal(nextTheme("light", false), "dark");
});

const METAS = [
  { media: "(prefers-color-scheme: light)", content: "#f3f3ee" },
  { media: "(prefers-color-scheme: dark)", content: "#1b1c19" },
];

test("themeColors: Auto keeps each theme-color tag's own colour, Light and Dark give every tag theirs", () => {
  assert.deepEqual(themeColors(METAS, "auto"), ["#f3f3ee", "#1b1c19"]);
  assert.deepEqual(themeColors(METAS, "light"), ["#f3f3ee", "#f3f3ee"]);
  assert.deepEqual(themeColors(METAS, "dark"), ["#1b1c19", "#1b1c19"]);
});

test("colorSchemeContent: both schemes under Auto, else the chosen one", () => {
  assert.equal(colorSchemeContent("auto"), "light dark");
  assert.equal(colorSchemeContent("light"), "light");
  assert.equal(colorSchemeContent("dark"), "dark");
});

test("the theme button's name says the scheme shown; its tooltip whether it follows the device and what a press does", () => {
  assert.equal(UI.theme.button("dark"), "Theme: Dark");
  assert.equal(UI.theme.button("light"), "Theme: Light");
  assert.equal(UI.theme.hint("auto", "dark"), "Theme: Dark (follows your device). Select to switch to Light.");
  assert.equal(UI.theme.hint("light", "light"), "Theme: Light. Select to switch to Dark.");
});

// public/theme-init.js runs before the first paint (a classic script in <head>, as the CSP allows no
// inline script): it sets the stored theme the way theme.js reads and applies it. Returns data-theme,
// the theme-color tags' contents, what they keep for Auto, and the color-scheme tag's content.
function runInit(store) {
  const root = { dataset: {} };
  const tags = METAS.map((meta) => ({ ...meta, dataset: {} }));
  const colorScheme = { content: "light dark", setAttribute(name, value) {
    this[name] = value;
  } };
  const document = {
    documentElement: root,
    querySelectorAll: (selector) => (selector === 'meta[name="theme-color"]' ? tags : []),
    querySelector: (selector) => (selector === 'meta[name="color-scheme"]' ? colorScheme : null),
  };
  const window = {};
  Object.defineProperty(window, "localStorage", {
    get() {
      if (store === "throws") throw new Error("SecurityError");
      return store;
    },
  });
  vm.runInNewContext(readFileSync(new URL("../public/theme-init.js", import.meta.url), "utf8"), { window, document });
  return {
    theme: root.dataset.theme,
    colors: tags.map((tag) => tag.content),
    kept: tags.map((tag) => tag.dataset.deviceContent ?? tag.content),
    colorScheme: colorScheme.content,
  };
}

test("theme-init.js applies a stored Light or Dark as theme.js does, and leaves Auto, other values and blocked storage alone", () => {
  for (const theme of ["dark", "light"]) {
    assert.deepEqual(runInit(storage({ [THEME_STORAGE_KEY]: theme })), {
      theme, colors: themeColors(METAS, theme), kept: themeColors(METAS, "auto"), colorScheme: colorSchemeContent(theme),
    });
  }
  const untouched = { theme: undefined, colors: themeColors(METAS, "auto"), kept: themeColors(METAS, "auto"), colorScheme: colorSchemeContent("auto") };
  for (const store of [storage(), storage({ [THEME_STORAGE_KEY]: "sepia" }), storage({}, true), "throws"]) {
    assert.deepEqual(runInit(store), untouched);
  }
});

// Before the stylesheet, so it runs as soon as it arrives instead of waiting for the CSS.
test("index.html loads theme-init.js as a classic script before the stylesheet", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const script = html.indexOf('<script src="/theme-init.js"></script>');
  assert.ok(script > 0, "no classic theme-init.js script");
  assert.ok(script < html.indexOf('<link rel="stylesheet"'));
});
