// A facet section's expandable tree (the ATC classes, atc-tree.js; the therapeutic areas,
// area-tree.js; the phone sheets borrow the section): nested lists, each node row an expand button
// (none on leaves), a checkbox with the node's name and count, and, for some trees, a link after it.
// Checked nodes combine with OR; a node under a checked one shows checked and disabled, one above a
// checked node indeterminate. A search expands the tree to matching nodes (it does not filter).
// Which nodes are open is UI state: the levels above a newly selected node open by themselves.
// Rows are keyed, so focus stays put across renders.
import * as d3 from "d3";

const formatCount = d3.format(",");

// section: the facet section (.facet-search, .facet-live, the top list .atc-tree, .facet-empty).
// onToggle(key): a checkbox changed. spec (model: render()'s argument, with selected: the keys
// checked):
//   copy: { find, tree, noMatches, matches(count), static(parent, model): the static row's text,
//     expand(key, model), row(key, count, model), included(key, count, ancestor, model): names }
//   idPrefix: of a node's child list id
//   visible(model): the keys shown (a Set)
//   children(parent, visible, model): the keys below parent (null: the top level), in order
//   exact(parent, model): the medicines at parent itself (a static row after its children), or 0
//   search(visible, query, model): null for a blank query, else { matches, open: Set, shows(parent, key) }
//   checkState(key, model), includedIn(key, model): the checked key above (for the row's name)
//   levelsAbove(key): the keys to open above a newly selected one
//   name(key, model): { text, missing }
//   decorate(label, key): content before the name (the ATC code badge), optional
//   link(key): an element after the row (a condition page link), or null; optional
//   note(model): a line under the tree (older links' ATC name queries), or ""; optional
export function createFacetTree(section, spec, { onToggle }) {
  const search = section.querySelector(".facet-search");
  const status = section.querySelector(".facet-live");
  const tree = section.querySelector(":scope > .atc-tree");
  const empty = section.querySelector(".facet-empty");
  const noteLine = section.querySelector(".tree-names");
  const expanded = new Set();
  // Levels the search opened that the user closed again (until the search changes).
  const closed = new Set();
  let seen = new Set();
  let model = null;
  let visible = new Set();
  let found = null; // spec.search() of the current query
  let timer = 0;

  search.setAttribute("aria-label", spec.copy.find);
  search.placeholder = spec.copy.find;
  tree.setAttribute("aria-label", spec.copy.tree);
  search.addEventListener("input", () => {
    closed.clear();
    render(model);
    // The tree changes silently: announce the matches once typing pauses.
    clearTimeout(timer);
    timer = setTimeout(() => {
      status.textContent = found ? spec.copy.matches(found.matches.length) : "";
    }, 400);
  });
  // In a sheet, the search goes to the top so the rows show below it (above the phone keyboard).
  search.addEventListener("focus", () => {
    if (search.closest(".sheet-body")) search.scrollIntoView({ block: "start" });
  });

  // A boolean: it is written to aria-expanded ("undefined" would read as not expandable).
  const isOpen = (key) => expanded.has(key) || Boolean(found?.open.has(key) && !closed.has(key));

  function toggleOpen(key) {
    if (isOpen(key)) {
      expanded.delete(key);
      if (found?.open.has(key)) closed.add(key);
    } else {
      expanded.add(key);
      closed.delete(key);
    }
    render(model);
  }

  // The rows under parent (the top level for null): its children the search shows (all without
  // one), then, outside a search, the medicines at parent itself (a static row).
  function rowsOf(parent) {
    const children = spec.children(parent, visible, model).filter((key) => !found || found.shows(parent, key));
    const rows = children.map((key) => ({ key, count: model.counts.get(key) ?? 0 }));
    const exact = parent === null || found ? 0 : spec.exact(parent, model);
    return children.length && exact ? [...rows, { key: `${parent}#static`, parent, count: exact, static: true }] : rows;
  }

  function enterRow(enter) {
    return enter.append("li").attr("class", "atc-node").each(function build(row) {
      const item = d3.select(this);
      const line = item.append("div").attr("class", "atc-row");
      if (row.static) {
        const text = line.append("span").attr("class", "atc-static");
        text.append("span").attr("class", "facet-name no-name");
        text.append("span").attr("class", "visually-hidden").text(", ");
        text.append("span").attr("class", "facet-count");
        return;
      }
      line.append("button")
        .attr("type", "button")
        .attr("class", "atc-expand")
        .on("click", () => toggleOpen(row.key));
      const label = line.append("label").attr("class", "facet-row atc-check");
      label.append("input").attr("type", "checkbox").on("change", () => onToggle(row.key));
      spec.decorate?.(label, row.key);
      // Name and count wrap together: short of room beside the badge, they move under it.
      const text = label.append("span").attr("class", "atc-text");
      text.append("span").attr("class", "facet-name");
      text.append("span").attr("class", "facet-count");
      item.append("ul").attr("class", "atc-tree").attr("hidden", "");
    });
  }

  function renderLevel(list, parent) {
    const items = d3.select(list).selectAll(":scope > li").data(rowsOf(parent), (row) => row.key).join(enterRow).order();
    items.select(":scope > .atc-row .facet-count").text((row) => formatCount(row.count));
    items.filter((row) => row.static).select(":scope > .atc-row .facet-name")
      .text((row) => spec.copy.static(row.parent, model));
    items.filter((row) => !row.static).each(function update(row) {
      const item = d3.select(this);
      const { text, missing } = spec.name(row.key, model);
      const hasChildren = spec.children(row.key, visible, model).length > 0;
      const open = hasChildren && isOpen(row.key);
      // Only a row with children has a child list id: leaves (EMA's terms, which contain spaces and
      // sit under several parents) have none, so ids stay valid and unique.
      const listId = hasChildren ? `${spec.idPrefix}${row.key}` : null;
      item.select(":scope > .atc-row > .atc-expand")
        .attr("hidden", hasChildren ? null : "")
        .attr("aria-controls", listId)
        .attr("aria-expanded", open ? "true" : "false")
        .attr("aria-label", spec.copy.expand(row.key, model));
      const state = spec.checkState(row.key, model);
      const ancestor = state === "included" ? spec.includedIn(row.key, model) : null;
      item.select(":scope > .atc-row input")
        .property("checked", state === "checked" || state === "included")
        .property("indeterminate", state === "mixed")
        .property("disabled", state === "included")
        .attr("aria-label", ancestor ? spec.copy.included(row.key, row.count, ancestor, model) : spec.copy.row(row.key, row.count, model));
      item.select(":scope > .atc-row .facet-name").text(text).classed("no-name", missing);
      item.select(":scope > .atc-row .facet-row").classed("empty", row.count === 0);
      // A link after the row (the data it needs can arrive later): added once it exists.
      const line = item.select(":scope > .atc-row");
      if (spec.link && line.select(":scope > a").empty()) {
        const link = spec.link(row.key);
        if (link) line.append(() => link);
      }
      const children = item.select(":scope > ul").attr("id", listId).attr("hidden", open ? null : "");
      if (open) renderLevel(children.node(), row.key);
      else children.selectChildren().remove();
    });
  }

  // next: { selected, counts: key -> medicines, ...whatever spec's functions read }.
  function render(next) {
    model = next;
    // A node selected elsewhere (table, breakdown, link): its levels open once.
    for (const key of model.selected.filter((value) => !seen.has(value))) for (const above of spec.levelsAbove(key)) expanded.add(above);
    seen = new Set(model.selected);
    visible = spec.visible(model);
    found = spec.search(visible, search.value, model);
    renderLevel(tree, null);
    d3.select(empty).text(spec.copy.noMatches).attr("hidden", found && found.matches.length === 0 ? null : "");
    const note = spec.note?.(model) ?? "";
    if (noteLine) d3.select(noteLine).text(note).attr("hidden", note ? null : "");
  }

  return {
    render,
    // Desktop focus target: the first checked node, else the search.
    focusTarget: () => tree.querySelector("input:checked:not(:disabled)") ?? search,
  };
}
