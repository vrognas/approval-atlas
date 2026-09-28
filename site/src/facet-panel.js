// Facet sections (static markup in index.html): the desktop sidebar, and the phone and tablet
// sheets, which borrow the same section elements while open. Rows are real checkboxes with their
// counts, updated in place on every render so focus and scroll stay put.
import * as d3 from "d3";
import { statusHue, statusTip, typeTip } from "./badges.js";
import { TYPE_ORDER, facetRows } from "./facets.js";
import { UI, statusLabel } from "./labels.js";

const formatCount = d3.format(",");
const slug = (text) => text.toLowerCase().replaceAll(" ", "-");

// rows: facetRows() rows; dotClass(row): a colour key before the label (type or status), or null.
// tipOf(row): the row value's explanation (typeTip(), statusTip(): { text, id }), or null; shown
// on hover and focus, and the checkbox's description.
function renderChecklist(list, rows, { onToggle, dotClass = () => null, tipOf = () => null }) {
  const active = document.activeElement;
  const focused = list.contains(active) ? d3.select(active.closest("li")).datum()?.value : undefined;
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
  items.select("label").attr("data-tip", (row) => tipOf(row)?.text ?? null);
  items.select("input")
    .property("checked", (row) => row.selected)
    .attr("aria-describedby", (row) => tipOf(row)?.id ?? null);
  items.select(".facet-dot").attr("class", (row) => ["facet-dot", dotClass(row)].filter(Boolean).join(" ")).attr("hidden", (row) => (dotClass(row) ? null : ""));
  items.select(".facet-name").text((row) => row.label);
  items.select(".facet-count").text((row) => formatCount(row.count));
  // A checked row moved (pinned first): the move dropped its focus.
  if (focused !== undefined && !list.contains(document.activeElement)) {
    items.filter((row) => row.value === focused).node()?.querySelector("input")?.focus({ preventScroll: true });
  }
}

// root: the sidebar (its head stays; sections are found by id, as a sheet may hold them).
// onChange(patch): a checkbox changed its dimension's values. The ATC classes, therapeutic areas
// and companies are trees of their own (atc-tree.js, area-tree.js, phase 4f; company-tree.js,
// companies part 2).
export function createFacetPanel(root, { onChange }) {
  const section = (key) => document.getElementById(`facet-${key}`);
  // Values unchecked here stay listed (facetRows() keep), so the row keeps its focus even when it
  // was listed only because it was selected.
  const kept = { status: new Set() };
  let model = null;

  const toggle = (key) => (value, checked) => {
    const values = model.state[key];
    kept[key]?.add(value);
    onChange({ [key]: checked ? [...values, value] : values.filter((item) => item !== value) });
  };

  // model: { state, counts: { type, status } (facetCounts()), activeCount }. The approval
  // years are the main column's strip (year-slider.js); the ATC, therapeutic area and company
  // sections are trees (atc-tree.js, area-tree.js, company-tree.js).
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
      tipOf: (row) => typeTip(row.value),
    });

    const status = facetRows(counts.status, state.status, { labelOf: statusLabel, keep: kept.status });
    renderChecklist(section("status").querySelector(".facet-list"), status.rows, {
      onToggle: toggle("status"),
      dotClass: (row) => `hue-${statusHue(row.value)}`,
      tipOf: (row) => statusTip(row.value),
    });
  }

  return { render };
}
