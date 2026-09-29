// A facet section's expandable tree (the ATC classes, atc-tree.js; the therapeutic areas,
// area-tree.js; the phone sheets borrow the section): nested lists, each node row an expand button
// (none on leaves), a checkbox with the node's name and count, and, for some trees, a link after it.
// Checked nodes combine with OR; a node under a checked one shows checked and disabled, one above a
// checked node indeterminate. A search expands the tree to matching nodes (it does not filter).
// Which nodes are open is UI state: the levels above a newly selected node open by themselves.
// Rows are keyed, so focus stays put across renders.
import * as d3 from "d3";
import { UI } from "./labels.js";

const formatCount = d3.format(",");

// A row's number badge (spec.number(): { text, level } or null: hidden). A tree number has no break
// opportunity of its own (digits and dots stay together), so the badge may wrap after its dots only
// (<wbr>), never inside a part: a term's number runs to 35 characters ("C10.228.140.163.…").
function setNumber(badge, number) {
  const text = number?.text ?? "";
  badge.attr("hidden", number ? null : "").attr("class", `code-badge tree-number${number ? ` level-${number.level}` : ""}`);
  if (badge.attr("data-number") === text) return;
  badge.attr("data-number", text);
  const parts = text.split(".");
  badge.node().replaceChildren(...parts.flatMap((part, index) => (index < parts.length - 1 ? [`${part}.`, document.createElement("wbr")] : [part])));
}

// section: the facet section (.facet-search, .facet-live, the top list .atc-tree, .facet-empty).
// onToggle(key): a checkbox changed. spec (model: render()'s argument, with selected: the keys
// checked):
//   copy: { find, tree, noMatches, matches(count), static(parent, model): the static row's text,
//     expand(key, model), row(key, count, model, parent), included(key, count, ancestor, model,
//     parent): names (parent: the row's, null at the top level) }
//   idPrefix: of a node's child list id
//   visible(model): the keys shown (a Set)
//   children(parent, visible, model): the keys below parent (null: the top level), in order
//   exact(parent, model): the medicines at parent itself (a static row after its children), or 0
//   rootStatic: exact(null, model) is a static last row of the top level (the modalities' "Not
//     classified"), shown even without rows above it; optional
//   staticTip(parent, model): a static row's explainer (text), or null; optional
//   search(visible, query, model): null for a blank query, else { matches, open: Set, shows(parent, key) }
//   checkState(key, model), includedIn(key, model): the checked key above (for the row's name)
//   levelsAbove(key): the keys to open above a newly selected one
//   name(key, model): { text, missing }
//   decorate(label, key): content before the name (the ATC code badge), optional
//   number(key, parent, model): { text, level } or null: a code badge before the name that can
//     change or arrive later (the therapeutic areas' MeSH tree numbers, a term's under its row's
//     parent), able to wrap after its dots only; optional
//   link(key): an element after the row (a condition page link), or null; optional
//   note(model): a line under the tree (older links' ATC name queries, root tags), or ""; optional
//   tip(key, model): { text, id } or null: the row's explainer (the therapeutic areas' MeSH notes,
//     mesh-notes.js meshTip()), a tooltip on its row and the description (id) of its checkbox;
//     optional
//   tapTip: the tips are short (the modalities', at most 12 words), so a tap on a touch screen shows
//     them, as the type and status tips (class tap-tip; the MeSH notes' long tips stay hidden on a
//     tap, style.css); optional
//   limit, more: the top-level rows shown at first and how many more each click of the section's
//     .facet-more button shows (the company tree's hundreds of groups); rows whose checkbox is not
//     unchecked always show, and during a search every match. Optional: without them every row
//     shows.
//   open: the keys open at first (the therapeutic areas' Diseases category); optional
export function createFacetTree(section, spec, { onToggle }) {
  // The section's collapsible body (facet-sections.js) holds its controls.
  const body = section.querySelector(":scope > .facet-body") ?? section;
  const search = body.querySelector(".facet-search");
  const status = body.querySelector(".facet-live");
  const tree = body.querySelector(":scope > .atc-tree");
  const empty = body.querySelector(".facet-empty");
  const noteLine = body.querySelector(".tree-names");
  const more = body.querySelector(":scope > .facet-more");
  let limit = spec.limit ?? Infinity;
  let hiddenTop = 0; // top-level rows the limit leaves out
  // Rows toggled here stay listed (unchecked, at count 0, past the limit) until the search or "Show
  // …" changes, so the checkbox that had focus is still there (as the flat facet lists' keep).
  const kept = new Set();
  const expanded = new Set(spec.open ?? []);
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
    kept.clear();
    limit = spec.limit ?? Infinity;
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
  // "Show 20 more" only adds rows: focus goes to the first one revealed (the button moved below them).
  more?.addEventListener("click", () => {
    const before = new Set(d3.select(tree).selectAll(":scope > li").data().map((row) => row.key));
    kept.clear();
    limit += spec.more;
    render(model);
    const revealed = d3.select(tree).selectAll(":scope > li").filter((row) => !before.has(row.key)).select(":scope > .atc-row input").node();
    if (revealed) revealed.focus();
    else more.scrollIntoView({ block: "nearest" });
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
  // one; the top-level limit applies outside a search only, so every match announced shows), then,
  // outside a search, the medicines at parent itself (a static row).
  function rowsOf(parent) {
    let children = spec.children(parent, visible, model).filter((key) => !found || found.shows(parent, key));
    if (parent === null) {
      const shown = found ? children : children.filter((key, index) => index < limit || kept.has(key) || spec.checkState(key, model) !== "unchecked");
      hiddenTop = children.length - shown.length;
      children = shown;
    }
    const rows = children.map((key) => ({ key, parent, count: model.counts.get(key) ?? 0 }));
    const exact = found || (parent === null && !spec.rootStatic) ? 0 : spec.exact(parent, model);
    return (children.length || parent === null) && exact ? [...rows, { key: `${parent}#static`, parent, count: exact, static: true }] : rows;
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
        // Its explainer (spec.staticTip) for screen readers; shown as the row's tooltip.
        text.append("span").attr("class", "visually-hidden static-tip");
        return;
      }
      line.append("button")
        .attr("type", "button")
        .attr("class", "atc-expand")
        .on("click", () => toggleOpen(row.key));
      const label = line.append("label").attr("class", "facet-row atc-check");
      label.append("input").attr("type", "checkbox").on("change", () => {
        kept.add(row.key);
        onToggle(row.key);
      });
      spec.decorate?.(label, row.key);
      if (spec.number) label.append("span").attr("class", "code-badge tree-number").attr("hidden", "");
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
    // A static row's explainer: a tooltip spanning the row on hover and, on touch screens, on a tap
    // (it takes focus: tabindex -1, no tab stop, as the type badges); its text read after the count.
    items.filter((row) => row.static).each(function explain(row) {
      const tip = spec.staticTip?.(row.parent, model) ?? null;
      const item = d3.select(this);
      item.select(":scope > .atc-row .atc-static").attr("data-tip", tip).attr("tabindex", tip === null ? null : "-1");
      item.select(":scope > .atc-row .static-tip").text(tip === null ? "" : `. ${tip}`);
    });
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
      const tip = spec.tip?.(row.key, model) ?? null;
      item.select(":scope > .atc-row input")
        .property("checked", state === "checked" || state === "included")
        .property("indeterminate", state === "mixed")
        .property("disabled", state === "included")
        .attr("aria-label", ancestor ? spec.copy.included(row.key, row.count, ancestor, model, row.parent) : spec.copy.row(row.key, row.count, model, row.parent))
        .attr("aria-describedby", tip?.id ?? null);
      if (spec.number) setNumber(item.select(":scope > .atc-row .tree-number"), spec.number(row.key, row.parent, model));
      // Its explainer (the data can arrive later), on hover and keyboard focus: on the whole row, so
      // the tip's hover bridge beside the desktop sidebar never covers the row's link (style.css).
      item.select(":scope > .atc-row").attr("data-tip", tip?.text ?? null).classed("mesh-tip", tip !== null)
        .classed("tap-tip", tip !== null && Boolean(spec.tapTip));
      item.select(":scope > .atc-row .facet-name").text(text).classed("no-name", missing);
      // Muted at 0 unless checked: checked rows sit on the accent wash, never muted (as facet-panel.js).
      item.select(":scope > .atc-row .facet-row").classed("empty", row.count === 0 && state !== "checked" && state !== "included");
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
    visible = new Set([...spec.visible(model), ...kept]);
    found = spec.search(visible, search.value, model);
    renderLevel(tree, null);
    if (more) d3.select(more).attr("hidden", hiddenTop ? null : "").text(UI.facets.showMore(Math.min(spec.more, hiddenTop)));
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
