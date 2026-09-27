// Facet sections (static markup in index.html): the desktop sidebar, and the phone and tablet
// sheets, which borrow the same section elements while open. Rows are real checkboxes with their
// counts, updated in place on every render so focus and scroll stay put.
import * as d3 from "d3";
import { statusHue, typeTipId } from "./badges.js";
import { TYPE_ORDER, facetRows } from "./facets.js";
import { UI, statusLabel } from "./labels.js";

// Rows shown before "Show all" / "Show more", and how many more each click shows.
const TOP = 8;
const MORE = 20;
const formatCount = d3.format(",");
const slug = (text) => text.toLowerCase().replaceAll(" ", "-");

// rows: facetRows() rows; dotClass(row): a colour key before the label (type or status), or null.
// tipOf(row): the row value's explanation label (UI.typeTips key: medicine types), or null; shown
// on hover and focus, and the checkbox's description.
function renderChecklist(list, rows, { onToggle, dotClass = () => null, tipOf = () => null }) {
  const active = document.activeElement;
  const focused = list.contains(active) ? d3.select(active).datum()?.value : undefined;
  const items = d3.select(list)
    .selectAll(":scope > li")
    .data(rows, (row) => row.value)
    .join((enter) => {
      const item = enter.append("li");
      const label = item.append("label").attr("class", "facet-row");
      label.append("input").attr("type", "checkbox").on("change", (event, row) => onToggle(row.value, event.currentTarget.checked));
      label.append("span").attr("class", "facet-dot").attr("aria-hidden", "true");
      label.append("span").attr("class", "facet-name");
      label.append("span").attr("class", "visually-hidden").text(", "); // read as "Biosimilar, 150"
      label.append("span").attr("class", "facet-count");
      return item;
    });
  items.classed("empty", (row) => row.count === 0 && !row.selected);
  items.select("label").attr("data-tip", (row) => (tipOf(row) ? UI.typeTips[tipOf(row)] : null));
  items.select("input")
    .property("checked", (row) => row.selected)
    .attr("aria-describedby", (row) => (tipOf(row) ? typeTipId(tipOf(row)) : null));
  items.select(".facet-dot").attr("class", (row) => ["facet-dot", dotClass(row)].filter(Boolean).join(" ")).attr("hidden", (row) => (dotClass(row) ? null : ""));
  items.select(".facet-name").text((row) => row.label);
  items.select(".facet-count").text((row) => formatCount(row.count));
  // A checked row moved (pinned first): the move dropped its focus.
  if (focused !== undefined && !list.contains(document.activeElement)) {
    items.filter((row) => row.value === focused).select("input").node()?.focus({ preventScroll: true });
  }
}

// root: the sidebar (its head stays; sections are found by id, as a sheet may hold them).
// onChange(patch): a checkbox changed its dimension's values. labelOf.branch(code): the branch name.
export function createFacetPanel(root, { onChange, labelOf }) {
  const section = (key) => document.getElementById(`facet-${key}`);
  const limits = { branch: TOP, area: TOP, mah: TOP };
  const queries = { area: "", mah: "" };
  // Values unchecked here stay listed (facetRows() keep) until the search or the limit changes,
  // so the row keeps its focus even when it was listed only because it was selected.
  const kept = { branch: new Set(), area: new Set(), mah: new Set(), status: new Set() };
  const totals = {};
  let model = null;

  const toggle = (key) => (value, checked) => {
    const values = model.state[key];
    kept[key]?.add(value);
    onChange({ [key]: checked ? [...values, value] : values.filter((item) => item !== value) });
  };

  for (const key of ["area", "mah"]) {
    const search = section(key).querySelector(".facet-search");
    const status = section(key).querySelector(".facet-live");
    let timer = 0;
    search.setAttribute("aria-label", UI.facets.searchLabel[key]);
    search.addEventListener("input", () => {
      queries[key] = search.value;
      limits[key] = TOP;
      kept[key].clear();
      render(model);
      // The list changes silently: announce the matches once typing pauses.
      clearTimeout(timer);
      timer = setTimeout(() => {
        status.textContent = queries[key].trim() ? UI.facets.matches(totals[key]) : "";
      }, 400);
    });
    // In a sheet, the search goes to the top so the rows it filters show below it (above the
    // phone keyboard).
    search.addEventListener("focus", () => {
      if (search.closest(".sheet-body")) search.scrollIntoView({ block: "start" });
    });
  }
  for (const key of ["branch", "area", "mah"]) {
    section(key).querySelector(".facet-more").addEventListener("click", (event) => {
      const button = event.currentTarget;
      const list = section(key).querySelector(".facet-list");
      const before = new Set(d3.select(list).selectAll(":scope > li").data().map((row) => row.value));
      if (key === "branch") limits.branch = limits.branch === Infinity ? TOP : Infinity;
      else limits[key] += MORE;
      kept[key].clear();
      render(model);
      // Rows added: focus the first one revealed (the button moved out of view below them).
      const revealed = d3.select(list).selectAll(":scope > li").filter((row) => !before.has(row.value)).select("input").node();
      if (revealed) revealed.focus();
      else button.scrollIntoView({ block: "nearest" });
    });
  }

  function renderMore(key, { total, hidden }) {
    const button = section(key).querySelector(".facet-more");
    const text = key === "branch"
      ? (limits.branch === Infinity ? UI.facets.showFewer : UI.facets.showAll(total))
      : UI.facets.showMore(Math.min(MORE, hidden));
    const shown = key === "branch" ? total > TOP : hidden > 0;
    button.hidden = !shown;
    button.textContent = text;
    // "Show all" / "Show fewer" is a disclosure; "Show 20 more" only adds rows.
    if (key === "branch") button.setAttribute("aria-expanded", String(limits.branch === Infinity));
  }

  // model: { state, counts: { type, status, branch, area, mah } (facetCounts()), activeCount }.
  // The approval years are the main column's strip (year-slider.js); the ATC section is the tree
  // (atc-tree.js).
  function render(next) {
    model = next;
    const { state, counts, activeCount } = model;
    const active = UI.facets.active(activeCount);
    d3.select(root.querySelector("#facets-active")).text(active ?? "").attr("hidden", active ? null : "");
    root.querySelector("#reset-all").disabled = activeCount === 0;
    root.querySelector("#facets-note").textContent = UI.facets.counts;

    const typeRows = TYPE_ORDER.map((type) => ({ value: type, label: type, count: counts.type.get(type) ?? 0, selected: state.type.includes(type) }));
    renderChecklist(section("type").querySelector(".facet-list"), typeRows, {
      onToggle: toggle("type"),
      dotClass: (row) => `type-${slug(row.value)}`,
      tipOf: (row) => (UI.typeTips[row.value] ? row.value : null),
    });

    const branch = facetRows(counts.branch, state.branch, { labelOf: labelOf.branch, limit: limits.branch, keep: kept.branch });
    renderChecklist(section("branch").querySelector(".facet-list"), branch.rows, { onToggle: toggle("branch") });
    renderMore("branch", branch);

    for (const key of ["area", "mah"]) {
      const container = section(key);
      const available = [...counts[key].values()].filter((count) => count > 0).length;
      container.querySelector(".facet-search").placeholder = UI.facets.search(available, UI.facets.nouns[key]);
      const found = facetRows(counts[key], state[key], { labelOf: String, query: queries[key], limit: limits[key], pin: true, keep: kept[key] });
      totals[key] = found.total;
      renderChecklist(container.querySelector(".facet-list"), found.rows, { onToggle: toggle(key) });
      d3.select(container.querySelector(".facet-empty")).text(UI.facets.noMatches).attr("hidden", found.total || !queries[key].trim() ? "" : null);
      renderMore(key, found);
    }

    const status = facetRows(counts.status, state.status, { labelOf: statusLabel, keep: kept.status });
    renderChecklist(section("status").querySelector(".facet-list"), status.rows, { onToggle: toggle("status"), dotClass: (row) => `hue-${statusHue(row.value)}` });
  }

  return { render };
}
