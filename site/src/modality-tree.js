// The facet sidebar's modality section (M2 phase 2; the phone sheet borrows it): the tree of
// modality groups › modalities (modalities.js, facet-tree.js), each row with its name, count and
// explainer; under a group its medicines no source names the modality of, and last the medicines
// no source classifies (static rows, count only). Checked rows combine with OR (state.mod). Also
// the path of the modality breakdown (renderModalityPath()).
import * as d3 from "d3";
import { createFacetTree } from "./facet-tree.js";
import { UI } from "./labels.js";
import {
  NOT_CLASSIFIED,
  modalityCheckState,
  modalityIncludedIn,
  modalityTip,
  modalityTreeChildren,
  modalityTreeKeys,
  modalityTreeSearch,
} from "./modalities.js";

// section: #facet-modality; tree: buildModalityTree(). onToggle(key): a checkbox changed.
// render(model): { selected: state.mod, counts: medicines per key, exact: medicines per static row
// key (a group: its group-only row; NOT_CLASSIFIED), of the medicines matching every other filter }.
export function createModalityTree(section, { tree, onToggle }) {
  section.querySelector(".tree-note").textContent = UI.modality.note;
  return createFacetTree(section, {
    copy: {
      find: UI.modality.find,
      tree: UI.modality.tree,
      noMatches: UI.modality.noMatches,
      matches: UI.facets.matches,
      static: (parent) => (parent === null ? UI.modality.notClassified : UI.modality.notMoreSpecific),
      expand: (key) => UI.modality.expand(tree.name(key)),
      row: (key, count) => UI.modality.count(tree.name(key), count),
      included: (key, count, group) => UI.modality.included(tree.name(key), count, tree.name(group)),
    },
    // Keys are id-safe ("protein"); only groups have children.
    idPrefix: "modality-children-",
    visible: (model) => modalityTreeKeys(tree, model.counts, model.selected),
    children: (parent, visible) => modalityTreeChildren(tree, parent, visible),
    exact: (parent, model) => model.exact.get(parent ?? NOT_CLASSIFIED) ?? 0,
    rootStatic: true,
    staticTip: (parent) => (parent === null ? UI.modality.notClassifiedTip : UI.modality.groupOnlyTip),
    search: (visible, query) => modalityTreeSearch(tree, visible, query),
    checkState: (key, model) => modalityCheckState(tree, key, model.selected),
    includedIn: (key, model) => modalityIncludedIn(tree, key, model.selected),
    levelsAbove: (key) => [...tree.ancestors(key)],
    name: (key) => ({ text: tree.name(key), missing: false }),
    tip: (key) => modalityTip(key),
    // At most 12 words: a tap shows them on touch screens too (the MeSH notes' do not).
    tapTip: true,
  }, { onToggle });
}

const formatCount = d3.format(",");

// Above the drilled-down modality bars: "All modalities", then the group and, for a modality, the
// modality (the last is current, aria-current); counts: medicines per key (null: none shown).
// Controls carry data-focus-key so a rebuild can put focus back.
export function renderModalityPath(container, { tree, current, counts = null, onSelect }) {
  const focused = container.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
  const root = d3.select(container);
  root.selectChildren().remove();
  const items = [null, ...tree.path(current)];
  const buttons = root.append("ol")
    .attr("class", "atc-path")
    .attr("aria-label", UI.modality.path)
    .selectAll("li")
    .data(items)
    .join("li")
    .append("button")
    .attr("type", "button")
    .attr("data-focus-key", (key) => key ?? "all")
    .attr("aria-current", (key, index) => (index === items.length - 1 ? "location" : null))
    .on("click", (event, key) => onSelect(key));
  buttons.filter((key) => key === null).attr("class", "path-all").text(UI.modality.all);
  buttons.filter((key) => key !== null).each(function level(key) {
    const count = counts?.get(key) ?? null;
    const name = tree.name(key);
    const button = d3.select(this).attr("aria-label", count === null ? name : UI.modality.count(name, count));
    button.append("span").text(name);
    if (count !== null) button.append("span").attr("class", "path-count").text(formatCount(count));
  });
  if (focused !== undefined) (container.querySelector(`[data-focus-key="${CSS.escape(focused)}"]`) ?? container.querySelector("[aria-current]"))?.focus();
}
