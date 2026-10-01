import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tabKeyTarget, tabsKeydown } from "./tabs.js";
import { TABS } from "./url.js";

// The dashboard's tabs (the WAI-ARIA tabs pattern since 2026-09-30, owner decision; manual
// activation): the arrows wrap, Home and End go to the ends, other keys (Enter, Space, Tab) move
// nothing, so the button's own click shows the tab.
test("tabs: Left/Right move to the neighboring tab, wrapping; Home/End to the ends; other keys none", () => {
  assert.equal(tabKeyTarget("ArrowRight", 0, 6), 1);
  assert.equal(tabKeyTarget("ArrowRight", 5, 6), 0);
  assert.equal(tabKeyTarget("ArrowLeft", 3, 6), 2);
  assert.equal(tabKeyTarget("ArrowLeft", 0, 6), 5);
  assert.equal(tabKeyTarget("Home", 4, 6), 0);
  assert.equal(tabKeyTarget("End", 1, 6), 5);
  for (const key of ["Enter", " ", "Tab", "ArrowUp", "ArrowDown", "a"]) assert.equal(tabKeyTarget(key, 2, 6), null);
  assert.equal(tabKeyTarget("ArrowRight", 0, 1), 0);
  assert.equal(tabKeyTarget("ArrowRight", 0, 0), null);
});

// A minimal DOM for tabsKeydown(): tabs that record focus, in a tablist.
function fakeTablist(count) {
  const focused = [];
  const tabs = [];
  const tablist = { querySelectorAll: () => tabs };
  for (let index = 0; index < count; index += 1) {
    const tab = {
      index,
      closest: (selector) => (selector === "[role=tab]" ? tab : selector === "[role=tablist]" ? tablist : null),
      focus: () => focused.push(index),
    };
    tabs.push(tab);
  }
  return { tabs, focused };
}

function keydown(target, key, modifiers = {}) {
  const event = { target, key, altKey: false, ctrlKey: false, metaKey: false, ...modifiers, prevented: false };
  event.preventDefault = () => {
    event.prevented = true;
  };
  tabsKeydown(event);
  return event;
}

test("tabs: a keydown moves focus only for the navigation keys, their default prevented", () => {
  const { tabs, focused } = fakeTablist(6);
  assert.equal(keydown(tabs[0], "ArrowLeft").prevented, true);
  assert.equal(keydown(tabs[5], "ArrowRight").prevented, true);
  assert.equal(keydown(tabs[2], "End").prevented, true);
  assert.deepEqual(focused, [5, 0, 5]);
  // Enter and Space are the button's own (its click shows the tab); modified arrows are the browser's.
  assert.equal(keydown(tabs[2], "Enter").prevented, false);
  assert.equal(keydown(tabs[2], " ").prevented, false);
  assert.equal(keydown(tabs[2], "ArrowRight", { altKey: true }).prevented, false);
  assert.deepEqual(focused, [5, 0, 5]);
  const outside = { closest: () => null };
  assert.equal(keydown(outside, "ArrowRight").prevented, false);
});

// index.html: a tablist of the six tabs in TABS order, each a button tab controlling its panel,
// each panel a tabpanel named by its tab; one tab stop (the Overview's, the default) and every
// panel focusable, as each starts with a card title.
test("tabs: index.html has the tablist, its tabs and their panels wired both ways", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const tablist = html.match(/<div id="tabs" class="tabs" role="tablist">([\s\S]*?)<\/div>/);
  assert.ok(tablist, "tablist");
  const tabs = [...tablist[1].matchAll(/<button ([^>]*)>/g)].map((match) => match[1]);
  const attribute = (attributes, name) => attributes.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;
  assert.deepEqual(tabs.map((tab) => attribute(tab, "data-tab")), TABS);
  for (const tab of tabs) {
    const key = attribute(tab, "data-tab");
    assert.equal(attribute(tab, "role"), "tab");
    assert.equal(attribute(tab, "type"), "button");
    assert.equal(attribute(tab, "id"), `tab-button-${key}`);
    assert.equal(attribute(tab, "aria-controls"), `tab-${key}`);
    assert.equal(attribute(tab, "aria-selected"), String(key === "overview"));
    assert.equal(attribute(tab, "tabindex"), key === "overview" ? null : "-1");
    const panel = html.match(new RegExp(`<div id="tab-${key}" ([^>]*)>`));
    assert.ok(panel, `panel ${key}`);
    assert.equal(attribute(panel[1], "role"), "tabpanel");
    assert.equal(attribute(panel[1], "aria-labelledby"), `tab-button-${key}`);
    assert.equal(attribute(panel[1], "tabindex"), "0");
    assert.equal(/\shidden(\s|$)/.test(panel[1]), key !== "overview");
  }
  assert.ok(!html.includes('aria-current="page"'));
});

// Design sweep 2026-10-01, L3 (Doherty Threshold): a tap shows the tab selected and its panel before
// the tab's cards render (after that paint), so the tap is answered at once on a phone's CPU too.
test("tabs: a tap selects the tab and shows its panel at once, its render after the paint", () => {
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  assert.match(main, /renderTabs\(tab\);\s*quickTab = true;\s*setState\(\{ tab \}, true, true\);/);
  assert.match(main, /if \(afterPaint\) \{\s*setTimeout\(/);
  // A panel drawn for another view is busy until its cards are drawn again.
  assert.match(main, /panel\.dataset\.drawnFor !== panelView\(\)\) panel\.setAttribute\("aria-busy", "true"\)/);
  assert.match(main, /panel\.dataset\.drawnFor = panelView\(\);\s*panel\.removeAttribute\("aria-busy"\);/);
  // Dimmed only once that takes 150 ms (an animation: a hidden panel has no style to transition from).
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(css, /\.tab-panel\[aria-busy="true"\] \{\s*animation: tab-busy 1ms linear 150ms forwards;/);
});
