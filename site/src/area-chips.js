// Branch chips (owner decision 2026-09-29): after a condition's name in the medicines table, the
// substance card's result table and the medicine card, its MeSH branches as small mono chips (at
// most two, then "+n" naming the rest: not a button, its tooltip and visually hidden text), each a
// filter toggle as the ATC badge's segments: one toolbar per condition with one tab stop
// (toolbar.js), pressed when its branch is within the area filter, a branch under a selected
// category too (branchSelected()), explained by the branch's name (data-tip). A chip included
// through a selected category is disabled, as the tree's included row (branchIncludedIn()). The pure
// parts are areas.js termBranches(), branchChips(), branchSelected() and branchIncludedIn(); the
// click is the caller's (chipTogglable()). The visible chip is its fill (.area-chip-fill) inside the
// button, so on phones the button's transparent rim can give way to every fill (style.css).
import { branchChips, branchIncludedIn, branchSelected } from "./areas.js";
import { UI } from "./labels.js";

const CHIP = "button.area-chip";

const node = (tag, className, text = null) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== null) element.textContent = text;
  return element;
};

// The chips of term (branches: termBranches(); selected: the area filter), or null for a term
// without a branch.
export function areaChips(term, branches, selected) {
  const { shown, rest } = branchChips(branches.of(term));
  if (!shown.length) return null;
  const toolbar = node("span", "area-chips");
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", UI.areas.chips(term));
  for (const code of shown) {
    const chip = node("button", "area-chip");
    chip.type = "button";
    chip.dataset.area = code;
    chip.dataset.name = branches.name(code);
    chip.setAttribute("aria-label", UI.areas.chipFilter(code, branches.name(code)));
    chip.append(node("span", "area-chip-fill", code));
    toolbar.append(chip);
  }
  const wrap = node("span", "term-branches");
  wrap.append(toolbar);
  if (rest.length) {
    const text = UI.areas.chipsRest(rest.map((code) => ({ code, name: branches.name(code) })));
    const more = node("span", "area-more");
    more.dataset.tip = text;
    more.tabIndex = -1; // a tap focuses it and shows the tooltip; no tab stop
    const count = node("span", null, UI.areas.chipsMore(rest.length));
    count.setAttribute("aria-hidden", "true");
    more.append(count, node("span", "visually-hidden", ` ${text}`));
    wrap.append(more);
  }
  markAreaChips(wrap, selected);
  return wrap;
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

// Pressed: the chips whose branch is within the selection (the area filter); disabled, their
// description and tooltip saying so, those included through a selected category. Each toolbar's one
// tab stop: its first pressed chip, else its first.
export function markAreaChips(root, selected) {
  for (const toolbar of root.querySelectorAll(".area-chips")) {
    const chips = [...toolbar.querySelectorAll(CHIP)];
    const pressed = chips.find((chip) => branchSelected(selected, chip.dataset.area));
    for (const chip of chips) {
      const category = branchIncludedIn(selected, chip.dataset.area);
      chip.setAttribute("aria-pressed", String(branchSelected(selected, chip.dataset.area)));
      chip.tabIndex = chip === (pressed ?? chips[0]) ? 0 : -1;
      chip.dataset.tip = category ? UI.areas.chipIncludedTip(chip.dataset.name, UI.areas.categories[category] ?? category) : chip.dataset.name;
      if (category) {
        chip.setAttribute("aria-disabled", "true");
        chip.setAttribute("aria-describedby", includedDescription(category));
      } else {
        chip.removeAttribute("aria-disabled");
        chip.removeAttribute("aria-describedby");
      }
    }
  }
}

// A chip a click toggles: not one included through a selected category (aria-disabled).
export const chipTogglable = (chip) => chip.getAttribute("aria-disabled") !== "true";
