// The therapeutic area section (its chip's popover or sheet borrows it; phase 4f): one tree of
// MeSH category › branch › level 2 › level 3 › EMA's terms (areas.js, facet-tree.js), each row with
// its MeSH tree number (a badge, once known), name, count and a link to its condition page once
// known (none for a category). Checked areas combine with OR (state.area). Diseases starts open
// (owner decision 2026-09-29), the other categories closed. Also the path of areas of the breakdown and the one-area headline
// (renderAreaPath()).
import * as d3 from "d3";
import { areaCheckState, areaExactLabel, areaIncludedIn, areaNumberLevel, areaTreeChildren, areaTreeKeys, areaTreeSearch } from "./areas.js";
import { createFacetTree } from "./facet-tree.js";
import { UI } from "./labels.js";

// The category open at first (owner decision 2026-09-29): Diseases.
const OPEN_CATEGORY = "C";

// section: #facet-area; tree: buildAreaTree(). onToggle(key): a checkbox changed. linkOf(key): a
// link to the area's condition page, or null (not known yet). tipOf(key): its MeSH explainer
// ({ text, id }: mesh-notes.js meshTip()), or null (none, or the notes still load). render(model):
// { selected: state.area, counts, exact: medicines per key and at each node itself, of the
// medicines matching every other filter }.
export function createAreaTree(section, { tree, onToggle, linkOf, tipOf = () => null }) {
  section.querySelector(".tree-note").textContent = UI.areas.note;
  return createFacetTree(section, {
    copy: {
      find: UI.areas.find,
      tree: UI.areas.tree,
      noMatches: UI.areas.noMatches,
      matches: UI.facets.matches,
      static: (parent) => areaExactLabel(tree, parent),
      expand: (key) => UI.areas.expand(tree.name(key)),
      // Named by the area, then the tree number its badge shows (owner decision 2026-09-29).
      row: (key, count, model, parent) => UI.areas.count(UI.areas.numbered(tree.name(key), tree.number(key, parent)), count),
      included: (key, count, ancestor, model, parent) => UI.areas.included(UI.areas.numbered(tree.name(key), tree.number(key, parent)), count, tree.name(ancestor)),
    },
    // Each row's MeSH tree number as a code badge, as the ATC tree's codes (owner decision
    // 2026-09-29): a term's under its row's parent once the notes have loaded.
    number: (key, parent) => {
      const number = tree.number(key, parent);
      return number && { text: number, level: areaNumberLevel(number) };
    },
    // Only rows with children get a child list id: category letters, branch codes and tree numbers
    // ("C04.588"), valid and unique; terms (spaces, several parents) never have children.
    idPrefix: "area-children-",
    open: [OPEN_CATEGORY],
    visible: (model) => areaTreeKeys(tree, model.counts, model.selected),
    children: (parent, visible) => areaTreeChildren(tree, parent, visible),
    exact: (parent, model) => model.exact.get(parent) ?? 0,
    search: (visible, query) => areaTreeSearch(tree, visible, query),
    checkState: (key, model) => areaCheckState(tree, key, model.selected),
    includedIn: (key, model) => areaIncludedIn(tree, key, model.selected),
    levelsAbove: (key) => [...tree.ancestors(key)].filter((above) => above !== key),
    name: (key) => ({ text: tree.name(key), missing: false }),
    link: linkOf,
    tip: tipOf,
    // A category's explainer is short (areaCategoryTip()): a tap on a touch screen shows it while it
    // checks the row (owner decision 2026-09-29); the other rows' MeSH notes stay hidden on a tap.
    tapTip: (key) => tree.isCategory(key),
    // A selected root tag (older links) has no row of its own: its branch is only indeterminate.
    note: (model) => {
      const tags = model.selected.filter(tree.isRootTag);
      return tags.length ? UI.areas.tagNote(tags) : "";
    },
  }, { onToggle });
}

const formatCount = d3.format(",");

// Above the drilled-down area bars and under the one-area headline (phase 4g): "All therapeutic
// areas" (all), then one button per level of the path to current (the last is current,
// aria-current); counts: medicines per key (null: none shown); label: the list's name. Controls
// carry data-focus-key so a rebuild can put focus back.
export function renderAreaPath(container, { tree, current, counts = null, onSelect, all = true, label = UI.areas.path }) {
  const focused = container.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
  const root = d3.select(container);
  root.selectChildren().remove();
  const items = [...(all ? [null] : []), ...tree.path(current)];
  const buttons = root.append("ol")
    .attr("class", "atc-path")
    .attr("aria-label", label)
    .selectAll("li")
    .data(items)
    .join("li")
    .append("button")
    .attr("type", "button")
    .attr("data-focus-key", (key) => key ?? "all")
    .attr("aria-current", (key, index) => (index === items.length - 1 ? "location" : null))
    .on("click", (event, key) => onSelect(key));
  buttons.filter((key) => key === null).attr("class", "path-all").text(UI.areas.all);
  buttons.filter((key) => key !== null).each(function level(key) {
    const count = counts?.get(key) ?? null;
    const name = tree.label(key); // a root tag: "tagged Neoplasms", not its branch's name
    const button = d3.select(this).attr("aria-label", count === null ? name : UI.areas.count(name, count));
    button.append("span").text(name);
    if (count !== null) button.append("span").attr("class", "path-count").text(formatCount(count));
  });
  if (focused !== undefined) (container.querySelector(`[data-focus-key="${CSS.escape(focused)}"]`) ?? container.querySelector("[aria-current]"))?.focus();
}
