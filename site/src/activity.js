// "Who is active where": a table of the top holders (rows) by ATC groups or therapeutic area
// groups (columns). Each cell is the number of the holder's matching medicines in that column, on
// one of five accent shades (--heat-1..5; empty when 0); a non-empty cell is a button that filters
// by the holder and the column, the row and column headers by one of them; each is a toggle
// (aria-pressed): a click on a filter it set exactly clears it again. Row headers show the holder's
// matching medicines after the name. A second header row holds the sort buttons (toggles), so the
// column headers keep their names: "Name" and "Total" under Holder (Total, the default, pressed
// when no other sort is), an arrow under each column (most in that column first); aria-sort on the
// sorted header. With one ATC class shown by its child classes (parent), that class is a pressed
// toggle above the table, so the filter a column set can be cleared again. Rebuilt on every
// render; focus goes back to the same control.
import * as d3 from "d3";
import { appendCodeBadge } from "./atc-picker.js";
import { UI } from "./labels.js";

const STEPS = 5;
const formatCount = d3.format(",");
const HINT_ID = "activity-filter-hint";

// A count's shade, 1-5, relative to the table's largest count.
const shade = (count, max) => Math.max(1, Math.ceil((STEPS * count) / max));

// A small button that sorts the rows: an arrow down (most first) or up (names A-Z), after its
// visible text when it has one ("Name", "Total").
function appendSortButton(parent, { key, label, text = null, pressed, ascending, onClick }) {
  const button = parent.append("button")
    .attr("type", "button")
    .attr("class", text ? "sort-button sort-text" : "sort-button")
    .attr("data-focus-key", `sort:${key}`)
    .attr("aria-label", label)
    .attr("aria-pressed", String(pressed))
    .on("click", onClick);
  if (text) button.append("span").text(text);
  const icon = button.append("svg").attr("viewBox", "0 0 16 16").attr("aria-hidden", "true").attr("focusable", "false");
  icon.append("path").attr("d", ascending ? "M8 13V3M4 7l4-4 4 4" : "M8 3v10M4 9l4 4 4-4");
  return button;
}

// A filter toggle's tooltip ("Show only …") and its description: what a click does.
const filterButton = (button, label, pressed) => button
  .attr("aria-pressed", String(pressed))
  .attr("aria-describedby", HINT_ID)
  .attr("title", pressed ? UI.activity.pressedTitle : UI.activity.filterBy(label));

// rows: holderActivity() output, in display order. columns: [{ key, label: its name in cell names,
// badge: an ATC code shown as a badge (else the label is the header's text), title: a tooltip,
// filter: the filter patch its header and cells set (null: a static column, "Other")}] in display
// order. sort: "total" | "name" | a column key. parent: the one ATC class whose child classes the
// columns are ({ key, badge, label, filter }), or null. onFilter(patch), onSort(sort). isSet(patch):
// the patch is exactly the current filter (the control is pressed). labelledBy, describedBy: the ids
// naming and describing the table (outside the scroll area, so they stay readable on a phone).
export function renderActivity(container, { rows, columns, sort, parent = null, labelledBy, describedBy, onFilter, onSort, isSet }) {
  const focused = container.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
  const root = d3.select(container);
  root.selectChildren().remove();
  root.append("p").attr("id", HINT_ID).attr("class", "visually-hidden").text(UI.activity.filterHint);
  // The class the columns split: a pressed toggle (its click clears the ATC filter it set).
  if (parent) {
    const line = root.append("p").attr("class", "activity-parent");
    line.append("span").attr("class", "tools-label").text(UI.activity.parentLead);
    const button = line.append("button")
      .attr("type", "button")
      .attr("class", "activity-parent-button")
      .attr("data-focus-key", `column:${parent.key}`)
      .attr("aria-label", parent.label)
      .on("click", () => onFilter(parent.filter));
    filterButton(button, parent.label, isSet(parent.filter));
    appendCodeBadge(button, parent.badge);
    button.append("span").attr("class", "activity-parent-name").attr("aria-hidden", "true").text(parent.name);
    button.append("span").attr("class", "activity-parent-remove").attr("aria-hidden", "true").text("×");
  }
  if (rows.length === 0) {
    root.append("p").attr("class", "muted").text(UI.breakdown.empty);
    return;
  }
  const max = d3.max(rows, (row) => d3.max(columns, (column) => row.cells.get(column.key) ?? 0)) || 1;
  const table = root.append("table").attr("class", "activity").attr("aria-labelledby", labelledBy).attr("aria-describedby", describedBy);
  const thead = table.append("thead");
  const head = thead.append("tr");
  // Holder names A-Z ("ascending"), or by total medicines, the default ("other": not by name).
  head.append("th").attr("scope", "col").attr("aria-sort", { name: "ascending", total: "other" }[sort] ?? null).text(UI.activity.holder);
  head.selectAll("th.activity-col").data(columns).join("th").attr("scope", "col").attr("class", "activity-col").each(function header(column) {
    const cell = d3.select(this).attr("title", column.title ?? null).attr("aria-sort", sort === column.key ? "descending" : null);
    if (!column.filter) {
      cell.append("span").attr("class", "activity-col-name").text(column.label);
      return;
    }
    const button = cell.append("button")
      .attr("type", "button")
      .attr("data-focus-key", `column:${column.key}`)
      .on("click", () => onFilter(column.filter));
    filterButton(button, column.label, isSet(column.filter));
    if (column.badge) appendCodeBadge(button.attr("aria-label", column.label), column.badge);
    else button.text(column.label);
  });
  // The sort buttons, in a row of their own (not headers, so they are not part of a column's name).
  const sorts = thead.append("tr").attr("class", "activity-sorts");
  const holderSorts = sorts.append("td").append("span").attr("class", "activity-head");
  appendSortButton(holderSorts, {
    key: "name",
    label: UI.activity.sortByName,
    text: UI.activity.sortName,
    pressed: sort === "name",
    ascending: true,
    onClick: () => onSort(sort === "name" ? "total" : "name"),
  });
  appendSortButton(holderSorts, {
    key: "total",
    label: UI.activity.sortByTotal,
    text: UI.activity.sortTotal,
    pressed: sort === "total",
    ascending: false,
    onClick: () => onSort("total"),
  });
  sorts.selectAll("td.activity-sort").data(columns).join("td").attr("class", "activity-sort").each(function sortCell(column) {
    appendSortButton(d3.select(this), {
      key: column.key,
      label: UI.activity.sortBy(column.title ?? column.label),
      pressed: sort === column.key,
      ascending: false,
      onClick: () => onSort(sort === column.key ? "total" : column.key),
    });
  });
  const lines = table.append("tbody").selectAll("tr").data(rows).join("tr");
  const holders = lines.append("th")
    .attr("scope", "row")
    .append("button")
    .attr("type", "button")
    .attr("data-focus-key", (row) => `row:${row.mah}`)
    .attr("aria-label", (row) => UI.activity.holderRow(row.mah, row.count))
    .each(function holder(row) {
      filterButton(d3.select(this), row.mah, isSet({ mah: [row.mah] }));
    })
    .on("click", (event, row) => onFilter({ mah: [row.mah] }));
  holders.append("span").attr("class", "activity-holder").text((row) => row.mah);
  holders.append("span").attr("class", "activity-total").text((row) => formatCount(row.count));
  lines.selectAll("td")
    .data((row) => columns.map((column) => ({ row, column, count: row.cells.get(column.key) ?? 0 })))
    .join("td")
    .attr("class", (cell) => (cell.count ? `heat heat-${shade(cell.count, max)}` : "heat"))
    .each(function value(cell) {
      if (!cell.count) return;
      const text = formatCount(cell.count);
      if (!cell.column.filter) {
        d3.select(this).append("span").text(text);
        return;
      }
      const patch = { mah: [cell.row.mah], ...cell.column.filter };
      d3.select(this).append("button")
        .attr("type", "button")
        .attr("data-focus-key", `cell:${cell.row.mah}|${cell.column.key}`)
        .attr("aria-label", UI.activity.cell(cell.row.mah, cell.column.label, cell.count))
        .attr("aria-pressed", String(isSet(patch)))
        .attr("aria-describedby", HINT_ID)
        .text(text)
        .on("click", () => onFilter(patch));
    });
  // Focus scrolls a cell clear of the sticky holder column (WCAG 2.4.11), whatever its width.
  root.style("scroll-padding-inline-start", `${table.select("tbody th").node().offsetWidth + 4}px`);
  // A click filtered or sorted the table: the same control; a cell that drilled into its class: the
  // class's toggle above the table; else the table's first button (focus stays in the card).
  if (focused === undefined) return;
  const same = container.querySelector(`[data-focus-key="${CSS.escape(focused)}"]`);
  (same ?? container.querySelector(".activity-parent-button") ?? container.querySelector("table button"))?.focus();
}
