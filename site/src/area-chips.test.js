// The lookup cards' branch chips (Laws of UX, second pass, 2026-09-30; area-chips.js with the link
// option): links to their branch's condition page in a toolbar with one tab stop, a plain label for a
// branch without a page. The tests run without a browser, so a minimal DOM stands in: elements with
// the properties and methods area-chips.js uses, and selectors of one tag and/or class.
import { test } from "node:test";
import assert from "node:assert/strict";

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.className = "";
    this.text = "";
    this.tabIndex = -1;
  }
  get classList() {
    return { add: (name) => { this.className = [...new Set([...this.className.split(" ").filter(Boolean), name])].join(" "); } };
  }
  set textContent(value) { this.text = value; }
  get textContent() { return this.text + this.children.map((child) => (typeof child === "string" ? child : child.textContent)).join(""); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  matches(selector) {
    const [, tag, name] = selector.match(/^([a-z]*)(?:\.([\w-]+))?$/);
    return (!tag || this.tagName === tag.toUpperCase()) && (!name || this.className.split(" ").includes(name));
  }
  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (typeof child === "string") continue;
        if (child.matches(selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
}

globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
  // The page glyph (links.js openIcon()): an svg with paths.
  createElementNS: (namespace, tag) => new FakeElement(tag),
  getElementById: () => null,
  body: new FakeElement("body"),
};
const { areaChips } = await import("./area-chips.js");

// C10 and C16 have pages; C18 has none (a plain label); C19 goes behind "+1".
const branches = {
  of: (term) => (term === "Adrenoleukodystrophy" ? ["C10", "C16", "C18", "C19"] : []),
  name: (code) => ({ C10: "Nervous System Diseases", C16: "Congenital, Hereditary, and Neonatal Diseases and Abnormalities", C18: "Nutritional and Metabolic Diseases", C19: "Endocrine System Diseases" })[code],
};
const pages = { C10: "D009422", C16: "D009358" };
const link = (code, name, fill) => {
  if (!pages[code]) return null;
  const anchor = new FakeElement("a");
  anchor.setAttribute("href", `?cond=${pages[code]}`);
  anchor.append(fill);
  return anchor;
};

test("card chips: links to the branch's condition page, the first the toolbar's one tab stop", () => {
  const wrap = areaChips("Adrenoleukodystrophy", branches, null, { link });
  const toolbar = wrap.querySelectorAll("span.area-chips")[0];
  assert.equal(toolbar.getAttribute("role"), "toolbar");
  const chips = toolbar.querySelectorAll(".area-chip");
  // The first two in code order (no filter brings any forward on a card), then "+n".
  assert.deepEqual(chips.map((chip) => chip.textContent), ["C10", "C16"]);
  assert.deepEqual(chips.map((chip) => chip.tagName), ["A", "A"]);
  assert.deepEqual(chips.map((chip) => chip.getAttribute("href")), ["?cond=D009422", "?cond=D009358"]);
  assert.equal(chips[0].getAttribute("aria-label"), "Open condition page: C10 Nervous System Diseases");
  assert.equal(chips[0].dataset.tip, "Nervous System Diseases");
  assert.deepEqual(chips.map((chip) => chip.tabIndex), [0, -1]);
  // They look like links (owner decision 2026-10-01, B9): the condition page links' page glyph after
  // the code, inside the outlined fill (aria-hidden; the chip's name is its aria-label).
  for (const chip of chips) {
    const [fill] = chip.querySelectorAll(".area-chip-fill");
    const [glyph] = fill.querySelectorAll("svg");
    assert.equal(glyph.getAttribute("class"), "link-icon");
    assert.equal(glyph.getAttribute("aria-hidden"), "true");
  }
  // Never a filter toggle's state.
  for (const chip of chips) {
    assert.equal(chip.getAttribute("aria-pressed"), null);
    assert.equal(chip.getAttribute("aria-disabled"), null);
  }
  const more = toolbar.querySelectorAll(".area-more")[0];
  assert.equal(more.getAttribute("aria-label"), "Also in C18 Nutritional and Metabolic Diseases; C19 Endocrine System Diseases");
  assert.equal(more.tabIndex, -1);
});

test("card chips: a branch without a page is a plain label the arrow keys still reach", () => {
  const only = { of: () => ["C18"], name: branches.name };
  const chip = areaChips("Obesity", only, null, { link }).querySelectorAll(".area-chip")[0];
  assert.equal(chip.tagName, "SPAN");
  assert.ok(chip.className.split(" ").includes("toolbar-item"));
  assert.equal(chip.getAttribute("role"), "img");
  assert.equal(chip.getAttribute("aria-label"), "C18 Nutritional and Metabolic Diseases");
  assert.equal(chip.dataset.tip, "Nutritional and Metabolic Diseases");
  assert.equal(chip.tabIndex, -1);
  // Not a link: no page glyph.
  assert.equal(chip.querySelectorAll("svg").length, 0);
});

test("dashboard chips stay filter toggles (buttons, pressed within the area filter)", () => {
  const chips = areaChips("Adrenoleukodystrophy", branches, ["C16"]).querySelectorAll(".area-chip");
  assert.deepEqual(chips.map((chip) => chip.tagName), ["BUTTON", "BUTTON"]);
  assert.deepEqual(chips.map((chip) => chip.getAttribute("aria-pressed")), ["false", "true"]);
  // Unchanged by B9: no page glyph.
  assert.equal(chips.flatMap((chip) => chip.querySelectorAll("svg")).length, 0);
});
