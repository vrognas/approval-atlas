// The medicine type and status sections (static markup in index.html #facet-store; a chip's popover
// or sheet borrows the section while open). Rows are real checkboxes with their counts, updated in
// place on every render so focus and scroll stay put.
import * as d3 from "d3";
import { statusHue, statusTip, typeTip } from "./badges.js";
import { TYPE_ORDER, facetRows } from "./facets.js";
import { UI, statusLabel } from "./labels.js";
import { DEFAULT_STATE, isDefaultStatus } from "./url.js";

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

// The medicine type and status checklists (sections found by id, wherever they are: the hidden
// store, a popover or a sheet). onChange(patch): a checkbox changed its dimension's values. The ATC
// classes, therapeutic areas, companies and modalities are trees of their own.
export function createFacetPanel({ onChange }) {
  const section = (key) => document.getElementById(`facet-${key}`);
  // Values unchecked here stay listed (facetRows() keep), so the row keeps its focus even when it
  // was listed only because it was selected.
  const kept = { status: new Set() };
  let model = null;
  // Under the Status rows (owner decision 2026-09-29, "Authorized by default"): include every status
  // (status []), or, with any other choice, back to the default. Unchecking the one checked row
  // leaves none checked, which is every status too (as in every facet), never an empty dashboard.
  const widen = section("status").querySelector("#status-widen");
  widen.addEventListener("click", () => {
    onChange({ status: isDefaultStatus(model.state.status) ? [] : structuredClone(DEFAULT_STATE.status) });
  });

  const toggle = (key) => (value, checked) => {
    const values = model.state[key];
    kept[key]?.add(value);
    onChange({ [key]: checked ? [...values, value] : values.filter((item) => item !== value) });
  };

  // model: { state, counts: { type, status } (facetCounts()) }. The approval years, ATC classes,
  // therapeutic areas, companies and modalities have sections of their own (year-slider.js and the
  // trees: atc-tree.js, area-tree.js, company-tree.js, modality-tree.js).
  function render(next) {
    model = next;
    const { state, counts } = model;

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
    widen.textContent = isDefaultStatus(state.status) ? UI.facets.statusWiden : UI.facets.statusDefault;
  }

  return { render };
}
