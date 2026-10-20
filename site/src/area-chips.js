// Branch chips (owner decision 2026-09-29): after a condition's name in the medicines table, the
// substance card's result table and the medicine card, its MeSH branches as small mono chips (at
// most two, those within the area filter first: branchChips(); then "+n" naming the rest: not a
// button, an image named by them, with a tooltip), each a filter toggle as the ATC badge's segments:
// one toolbar per condition with one tab stop (toolbar.js; the arrow keys reach "+n" too), pressed
// when its branch is within the area filter, a branch under a selected category too
// (branchSelected()), explained by the branch's name (data-tip). A chip included through a selected
// category is disabled, as the tree's included row (branchIncludedIn()); every chip is, unpressed,
// while the area filter is unknown (null: the lookup's cards before the dashboard's data has loaded;
// chips review 2026-09-29). The pure parts are areas.js termBranches(), branchChips(),
// branchSelected() and branchIncludedIn(); the click is the caller's (chipTogglable()). The visible
// chip is its fill (.area-chip-fill) inside the button, so on phones the button's transparent rim can
// give way to every fill (style.css).
// On the lookup's cards (the medicine card, the substance card's table; Laws of UX, second pass,
// owner decision 2026-09-30) a chip is a link to its branch's condition page instead (link option):
// a tag-like chip that filtered the overview swapped the card for it. Neither pressed nor disabled
// there; the toolbar stays (its first link the one tab stop, the arrow keys to the others and "+n",
// whose tooltip needs that keyboard path), as the dashboard's chips. It looks like a link (owner
// decision 2026-10-01, B9: it looked like the dashboard's toggles): outlined, unfilled, with the page
// glyph of the condition page links (links.js openIcon(); style.css).
import { branchChips, branchIncludedIn, branchSelected } from "./areas.js";
import { UI } from "./labels.js";
import { openIcon } from "./links.js";

const CHIP = "button.area-chip";

// Each toolbar's term branches ({ codes, branches: termBranches(), link }), so markAreaChips() can
// show other chips when the area filter changes.
const sources = new WeakMap();

const node = (tag, className, text = null) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== null) element.textContent = text;
  return element;
};

// The chips of term (branches: termBranches(); selected: the area filter, null while unknown), or
// null for a term without a branch. link(code, name, fill): a chip as a link (the lookup's cards):
// the element holding fill, or null for a branch without a page (then a plain label).
export function areaChips(term, branches, selected, { link = null } = {}) {
  const codes = branches.of(term);
  if (!codes.length) return null;
  const toolbar = node("span", "area-chips");
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", UI.areas.chips(term));
  sources.set(toolbar, { codes, branches, link });
  const wrap = node("span", "term-branches");
  wrap.append(toolbar);
  if (link) {
    const { shown, rest } = branchChips(codes);
    fillChips(toolbar, shown, rest);
  } else {
    markAreaChips(wrap, selected);
  }
  return wrap;
}

// A card's chip: a link to its branch's condition page (named "Open condition page: C10 Nervous
// System Diseases", the branch's name its tooltip; the page glyph after its code), else, without a
// page, a plain label the arrow keys and a tap still reach for its tooltip.
function linkChip(code, name, link) {
  const fill = node("span", "area-chip-fill", code);
  const chip = link(code, name, fill);
  if (chip) {
    fill.append(openIcon());
    chip.classList.add("area-chip");
    chip.setAttribute("aria-label", UI.areas.chipLink(code, name));
  } else {
    const label = node("span", "area-chip toolbar-item");
    label.append(fill);
    label.tabIndex = -1;
    label.setAttribute("role", "img");
    label.setAttribute("aria-label", UI.areas.chipName(code, name));
    label.dataset.tip = name;
    return label;
  }
  chip.dataset.tip = name;
  return chip;
}

// The toolbar's chips (branchChips(): those within the selection first), then "+n" naming the rest,
// in the toolbar so its arrow keys reach it (chips review 2026-09-29: it had no keyboard path to its
// tooltip; toolbar.js .toolbar-item); it stays a span with tabindex -1 (a tap or the arrows focus
// it; never the tab stop), an image named by the branches it stands for (conditions card review
// 2026-09-29: focused, it was an unnamed generic), at least 24px (44px on phones, style.css).
function fillChips(toolbar, shown, rest) {
  const { branches, link } = sources.get(toolbar);
  const chips = shown.map((code) => {
    if (link) return linkChip(code, branches.name(code), link);
    const chip = node("button", "area-chip");
    chip.type = "button";
    chip.dataset.area = code;
    chip.dataset.name = branches.name(code);
    chip.setAttribute("aria-label", UI.areas.chipFilter(code, branches.name(code)));
    chip.append(node("span", "area-chip-fill", code));
    return chip;
  });
  toolbar.replaceChildren(...chips);
  // A card's toolbar: its first link the one tab stop.
  if (link) {
    const links = [...toolbar.querySelectorAll("a.area-chip")];
    for (const chip of links) chip.tabIndex = chip === links[0] ? 0 : -1;
  }
  if (!rest.length) return;
  const text = UI.areas.chipsRest(rest.map((code) => ({ code, name: branches.name(code) })));
  // As a chip, its visible part (.area-more-fill) inside, so on phones its rim can give way.
  const more = node("span", "area-more toolbar-item");
  more.append(node("span", "area-more-fill", UI.areas.chipsMore(rest.length)));
  more.dataset.tip = text;
  more.tabIndex = -1;
  more.setAttribute("role", "img");
  more.setAttribute("aria-label", text);
  toolbar.append(more);
}

// A condition's group (term: its span.term, an inline block in one flow; review 2026-09-29): its name,
// then its chips, then (unless last) the ";" before the next, kept with the chips (or the name) so
// it never starts a line. The caller puts a space between groups.
export function fillTerm(term, name, chips, last) {
  term.append(name);
  if (chips) term.append(" ", chips);
  if (!last) (chips ?? term).append(node("span", "term-sep", ";"));
}

// The hidden description of the chips included in a category ("included in Diseases"): one element
// per category, made once.
function includedDescription(category) {
  const id = `area-chip-included-${category}`;
  if (!document.getElementById(id)) {
    const description = node("span", null, UI.areas.chipIncluded(UI.areas.categories[category] ?? category));
    description.id = id;
    description.hidden = true;
    document.body.append(description);
  }
  return id;
}

// Shown: the chips branchChips() picks for the selection (the area filter; null while unknown: as
// none), rebuilt only when they change. Pressed: those whose branch is within the selection;
// disabled, their description and tooltip saying so, those included through a selected category,
// and every chip while the selection is unknown. Each toolbar's one tab stop: its first pressed
// chip, else its first.
export function markAreaChips(root, selected) {
  const known = selected ?? [];
  for (const toolbar of root.querySelectorAll(".area-chips")) {
    if (sources.get(toolbar).link) continue; // a card's links: no filter state
    const { shown, rest } = branchChips(sources.get(toolbar).codes, known);
    if (String(shown) !== String([...toolbar.querySelectorAll(CHIP)].map((chip) => chip.dataset.area))) fillChips(toolbar, shown, rest);
    const chips = [...toolbar.querySelectorAll(CHIP)];
    const pressed = chips.find((chip) => branchSelected(known, chip.dataset.area));
    for (const chip of chips) {
      const category = branchIncludedIn(known, chip.dataset.area);
      chip.setAttribute("aria-pressed", String(branchSelected(known, chip.dataset.area)));
      chip.tabIndex = chip === (pressed ?? chips[0]) ? 0 : -1;
      chip.dataset.tip = category ? UI.areas.chipIncludedTip(chip.dataset.name, UI.areas.categories[category] ?? category) : chip.dataset.name;
      if (category || selected === null) chip.setAttribute("aria-disabled", "true");
      else chip.removeAttribute("aria-disabled");
      if (category) chip.setAttribute("aria-describedby", includedDescription(category));
      else chip.removeAttribute("aria-describedby");
    }
  }
}

// A chip a click toggles: not one included through a selected category, nor any while the area
// filter is unknown (aria-disabled).
export const chipTogglable = (chip) => chip.getAttribute("aria-disabled") !== "true";
