// The facet sidebar's therapeutic area section (the phone sheet borrows it; phase 4f): one tree of
// MeSH branch › level 2 › level 3 › EMA's terms (areas.js, facet-tree.js), each row with its name,
// count and a link to its condition page once known. Checked areas combine with OR (state.area).
// Also the path of areas of the breakdown and the one-area headline (renderAreaPath()).
import * as d3 from "d3";
import { areaCheckState, areaExactLabel, areaIncludedIn, areaTreeChildren, areaTreeKeys, areaTreeSearch } from "./areas.js";
import { createFacetTree } from "./facet-tree.js";
import { UI } from "./labels.js";

// section: #facet-area; tree: buildAreaTree(). onToggle(key): a checkbox changed. linkOf(key): a
// link to the area's condition page, or null (not known yet). render(model): { selected: state.area,
// counts, exact: medicines per key and at each node itself, of the medicines matching every other
// filter }.
export function createAreaTree(section, { tree, onToggle, linkOf }) {
  section.querySelector(".tree-note").textContent = UI.areas.note;
  return createFacetTree(section, {
    copy: {
      find: UI.areas.find,
      tree: UI.areas.tree,
      noMatches: UI.areas.noMatches,
      matches: UI.facets.matches,
      static: (parent) => areaExactLabel(tree, parent),
      expand: (key) => UI.areas.expand(tree.name(key)),
      row: (key, count) => UI.areas.count(tree.name(key), count),
      included: (key, count, ancestor) => UI.areas.included(tree.name(key), count, tree.name(ancestor)),
    },
    // Only rows with children get a child list id: branch codes and tree numbers ("C04.588"), valid
    // and unique; terms (spaces, several parents) never have children.
    idPrefix: "area-children-",
    visible: (model) => areaTreeKeys(tree, model.counts, model.selected),
    children: (parent, visible) => areaTreeChildren(tree, parent, visible),
    exact: (parent, model) => model.exact.get(parent) ?? 0,
    search: (visible, query) => areaTreeSearch(tree, visible, query),
    checkState: (key, model) => areaCheckState(tree, key, model.selected),
    includedIn: (key, model) => areaIncludedIn(tree, key, model.selected),
    levelsAbove: (key) => [...tree.ancestors(key)].filter((above) => above !== key),
    name: (key) => ({ text: tree.name(key), missing: false }),
    link: linkOf,
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
