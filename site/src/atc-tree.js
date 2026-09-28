// The facet sidebar's ATC section (the phone sheet borrows it): the tree of the ATC classes with
// products (facet-tree.js), each row with the code badge, the Title Case name and the count.
// Checked classes combine with OR (state.atc).
import { appendCodeBadge } from "./atc-picker.js";
import { atcCheckState, atcPrefixes, atcTreeChildren, atcTreeCodes, atcTreeSearch } from "./atc.js";
import { createFacetTree } from "./facet-tree.js";
import { UI, atcName } from "./labels.js";

// section: #facet-atc. onToggle(code): a checkbox changed. render(model): { selected: the selected
// ATC codes (splitAtcValues() codes), names: the class-name queries (older links), counts, exact:
// atcPrefixCounts() and atcExactCounts() of the medicines matching every other filter,
// incompleteAt: the classes some of those medicines are coded at with an incomplete code
// (atcIncompleteAt()), classNames: code -> WHO name }.
export function createAtcTree(section, { onToggle }) {
  section.querySelector(".atc-note").textContent = UI.atc.note;
  return createFacetTree(section, {
    copy: {
      find: UI.atc.find,
      tree: UI.atc.tree,
      noMatches: UI.atc.noMatches,
      matches: UI.facets.matches,
      // The products coded only down to the parent class: an incomplete code, or one WHO does not
      // subdivide (B03AC) or moved there (J07BX03 -> J07BN; atc_final_level).
      static: (parent, model) => (model.incompleteAt.has(parent) ? UI.atc.incomplete : UI.atc.codedHere),
      expand: (code) => UI.atc.expand(code),
      row: (code, count, model) => UI.atc.classCount(code, model.classNames.get(code) ?? null, count),
      included: (code, count, ancestor, model) => UI.atc.included(code, model.classNames.get(code) ?? null, count, ancestor),
    },
    idPrefix: "atc-children-",
    visible: (model) => atcTreeCodes(model.counts, model.selected),
    children: (parent, codes) => atcTreeChildren(parent, codes),
    exact: (parent, model) => model.exact.get(parent) ?? 0,
    search: (codes, query, model) => {
      const found = atcTreeSearch(codes, model.classNames, query);
      return found && { ...found, shows: (parent, code) => found.shown.has(code) };
    },
    checkState: (code, model) => atcCheckState(code, model.selected),
    includedIn: (code, model) => atcPrefixes(code).find((prefix) => model.selected.includes(prefix)),
    levelsAbove: (code) => atcPrefixes(code).slice(0, -1),
    name: (code, model) => {
      const name = model.classNames.get(code) ?? null;
      return { text: atcName(name), missing: name === null };
    },
    decorate: (label, code) => appendCodeBadge(label, code),
    note: (model) => (model.names.length ? UI.atc.nameQueries(model.names) : ""),
  }, { onToggle });
}
