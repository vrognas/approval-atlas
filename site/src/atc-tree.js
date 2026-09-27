// The facet sidebar's ATC section (the phone sheet borrows it): an expandable tree of the ATC
// classes with products, each node row an expand button (none on leaves), a checkbox, the code
// badge, the Title Case name and the count. Checked classes combine with OR (state.atc); a class
// under a checked one shows checked and disabled, one above a checked class indeterminate. A
// search expands the tree to matching codes and names (it does not filter). Which nodes are open
// is UI state: the levels above a newly selected class open by themselves. Rows are keyed, so
// focus stays put across renders.
import * as d3 from "d3";
import { appendCodeBadge } from "./atc-picker.js";
import { atcCheckState, atcPrefixes, atcTreeChildren, atcTreeCodes, atcTreeSearch } from "./atc.js";
import { UI, atcName } from "./labels.js";

const formatCount = d3.format(",");

// section: #facet-atc. onToggle(code): a checkbox changed.
export function createAtcTree(section, { onToggle }) {
  const search = section.querySelector("#atc-search");
  const status = section.querySelector(".facet-live");
  const tree = section.querySelector("#atc-tree");
  const empty = section.querySelector(".facet-empty");
  const nameNote = section.querySelector("#atc-names");
  const expanded = new Set();
  // Levels the search opened that the user closed again (until the search changes).
  const closed = new Set();
  let seen = new Set();
  let model = null;
  let found = null; // atcTreeSearch() of the current query
  let timer = 0;

  search.setAttribute("aria-label", UI.atc.find);
  search.placeholder = UI.atc.find;
  tree.setAttribute("aria-label", UI.atc.tree);
  section.querySelector(".atc-note").textContent = UI.atc.note;
  search.addEventListener("input", () => {
    closed.clear();
    render(model);
    // The tree changes silently: announce the matches once typing pauses.
    clearTimeout(timer);
    timer = setTimeout(() => {
      status.textContent = found ? UI.facets.matches(found.matches.length) : "";
    }, 400);
  });
  // In a sheet, the search goes to the top so the rows show below it (above the phone keyboard).
  search.addEventListener("focus", () => {
    if (search.closest(".sheet-body")) search.scrollIntoView({ block: "start" });
  });

  // A boolean: it is written to aria-expanded ("undefined" would read as not expandable).
  const isOpen = (code) => expanded.has(code) || Boolean(found?.open.has(code) && !closed.has(code));

  function toggleOpen(code) {
    if (isOpen(code)) {
      expanded.delete(code);
      if (found?.open.has(code)) closed.add(code);
    } else {
      expanded.add(code);
      closed.delete(code);
    }
    render(model);
  }

  // The rows under parent (level 1 for null): its children shown by the search (all without
  // one), then, outside a search, the products coded exactly at parent (a static row), so the
  // rows add up to it.
  function rowsOf(parent, codes) {
    const children = atcTreeChildren(parent, codes).filter((code) => !found || found.shown.has(code));
    const rows = children.map((code) => ({ key: code, code, count: model.counts.get(code) ?? 0 }));
    const exact = parent === null || found ? 0 : model.exact.get(parent) ?? 0;
    return children.length && exact ? [...rows, { key: `${parent}#incomplete`, count: exact, incomplete: true }] : rows;
  }

  function enterRow(enter) {
    return enter.append("li").attr("class", "atc-node").each(function build(row) {
      const item = d3.select(this);
      const line = item.append("div").attr("class", "atc-row");
      if (row.incomplete) {
        const text = line.append("span").attr("class", "atc-static");
        text.append("span").attr("class", "facet-name no-name").text(UI.atc.incomplete);
        text.append("span").attr("class", "visually-hidden").text(", ");
        text.append("span").attr("class", "facet-count");
        return;
      }
      line.append("button")
        .attr("type", "button")
        .attr("class", "atc-expand")
        .attr("aria-controls", `atc-children-${row.code}`)
        .attr("aria-label", UI.atc.expand(row.code))
        .on("click", () => toggleOpen(row.code));
      const label = line.append("label").attr("class", "facet-row atc-check");
      label.append("input").attr("type", "checkbox").on("change", () => onToggle(row.code));
      appendCodeBadge(label, row.code);
      // Name and count wrap together: short of room beside the badge, they move under it.
      const text = label.append("span").attr("class", "atc-text");
      text.append("span").attr("class", "facet-name");
      text.append("span").attr("class", "facet-count");
      item.append("ul").attr("class", "atc-tree").attr("id", `atc-children-${row.code}`).attr("hidden", "");
    });
  }

  function renderLevel(list, parent, codes, selected) {
    const items = d3.select(list).selectAll(":scope > li").data(rowsOf(parent, codes), (row) => row.key).join(enterRow).order();
    items.select(":scope > .atc-row .facet-count").text((row) => formatCount(row.count));
    items.filter((row) => !row.incomplete).each(function update(row) {
      const item = d3.select(this);
      const name = model.classNames.get(row.code) ?? null;
      const hasChildren = atcTreeChildren(row.code, codes).length > 0;
      const open = hasChildren && isOpen(row.code);
      item.select(":scope > .atc-row > .atc-expand").attr("hidden", hasChildren ? null : "").attr("aria-expanded", open ? "true" : "false");
      const state = atcCheckState(row.code, selected);
      // The class above the checked one that includes it.
      const ancestor = state === "included" ? atcPrefixes(row.code).find((prefix) => selected.includes(prefix)) : null;
      item.select(":scope > .atc-row input")
        .property("checked", state === "checked" || state === "included")
        .property("indeterminate", state === "mixed")
        .property("disabled", state === "included")
        .attr("aria-label", ancestor ? UI.atc.included(row.code, name, row.count, ancestor) : UI.atc.classCount(row.code, name, row.count));
      item.select(":scope > .atc-row .facet-name").text(atcName(name)).classed("no-name", name === null);
      item.select(":scope > .atc-row .facet-row").classed("empty", row.count === 0);
      const children = item.select(":scope > ul").attr("hidden", open ? null : "");
      if (open) renderLevel(children.node(), row.code, codes, selected);
      else children.selectChildren().remove();
    });
  }

  // next: { codes: the selected ATC codes (splitAtcValues()), names: the class-name queries
  // (older links), counts, exact: atcPrefixCounts() and atcExactCounts() of the medicines matching
  // every other filter, classNames: code -> WHO name }.
  function render(next) {
    model = next;
    const selected = model.codes;
    // A class selected elsewhere (table, breakdown, link): its levels open once.
    for (const code of selected.filter((value) => !seen.has(value))) for (const prefix of atcPrefixes(code).slice(0, -1)) expanded.add(prefix);
    seen = new Set(selected);
    const codes = atcTreeCodes(model.counts, selected);
    found = atcTreeSearch(codes, model.classNames, search.value);
    renderLevel(tree, null, codes, selected);
    d3.select(empty).text(UI.atc.noMatches).attr("hidden", found && found.matches.length === 0 ? null : "");
    d3.select(nameNote).text(model.names.length ? UI.atc.nameQueries(model.names) : "").attr("hidden", model.names.length ? null : "");
  }

  return {
    render,
    // Desktop focus target: the first checked class, else the search.
    focusTarget: () => tree.querySelector("input:checked:not(:disabled)") ?? search,
  };
}
