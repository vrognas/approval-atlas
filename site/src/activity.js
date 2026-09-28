// "Who is active where": a table of the top holders (rows) by ATC groups or therapeutic area
// groups (columns). Each cell is the number of the holder's matching medicines in that column, on
// one of five accent shades (--heat-1..5; empty when 0); a non-empty cell is a button that filters
// by the holder and the column, the row and column headers by one of them; each is a toggle
// (aria-pressed): a click on a filter it set exactly clears it again. Row headers show the holder's
// matching medicines after the name. A second header row holds the sort buttons (toggles), so the
// column headers keep their names: "Name" and "Total" under Holder (Total, most first, the default,
// pressed when no other sort is), an arrow under each column (most in that column first); a
// second click on the sort in force reverses it (fewest first, Z-A), its arrow shows the order and
// its header has aria-sort. With one ATC class shown by its child classes (parent), that class is
// a pressed toggle above the table, so the filter a column set can be cleared again. Rebuilt on
// every render; focus goes back to the same control.
import * as d3 from "d3";
import { appendCodeBadge } from "./atc-picker.js";
import { defaultSortDirection } from "./facets.js";
import { companyBadge } from "./holders.js";
import { UI } from "./labels.js";

const STEPS = 5;
const formatCount = d3.format(",");
const HINT_ID = "activity-filter-hint";

// A count's shade, 1-5, relative to the table's largest count.
const shade = (count, max) => Math.max(1, Math.ceil((STEPS * count) / max));

// A sort arrow (decorative): up for ascending (fewest first, A-Z), down for descending. Also the
// breakdown's and the column order's sort controls (main.js).
export function appendSortIcon(parent, ascending) {
  const icon = parent.append("svg").attr("class", "sort-icon").attr("viewBox", "0 0 16 16").attr("aria-hidden", "true").attr("focusable", "false");
  icon.append("path").attr("d", ascending ? "M8 13V3M4 7l4-4 4 4" : "M8 3v10M4 9l4 4 4-4");
  return icon;
}

// A small button that sorts the rows (key: "name", "total" or a column key; sort: the one in
// force, { key, direction }): an arrow for the order in force, else for the order it starts in,
// after its visible text when it has one ("Name", "Total"); its name says the order in force.
function appendSortButton(parent, { key, label, text = null, sort, onSort }) {
  const pressed = sort.key === key;
  const direction = pressed ? sort.direction : defaultSortDirection(key);
  const button = parent.append("button")
    .attr("type", "button")
    .attr("class", text ? "sort-button sort-text" : "sort-button")
    .attr("data-focus-key", `sort:${key}`)
    .attr("aria-label", UI.sortOrder.name(label, key === "name" ? "key" : "count", pressed ? direction : null))
    .attr("aria-pressed", String(pressed))
    .on("click", () => onSort(key));
  if (text) button.append("span").text(text);
  appendSortIcon(button, direction === "asc");
  return button;
}

const ARIA_SORT = { asc: "ascending", desc: "descending" };

// A filter toggle's tooltip ("Show only …") and its description: what a click does.
const filterButton = (button, label, pressed) => button
  .attr("aria-pressed", String(pressed))
  .attr("aria-describedby", HINT_ID)
  .attr("title", pressed ? UI.activity.pressedTitle : UI.activity.filterBy(label));

// rows: holderActivity() output, in display order (companies part 2: company groups, each with
// badge: its group row, and names: the EMA holder names behind it, in its name and tooltip);
// linkOf(row): a link after the row's button (its company page), or null. columns: [{ key, label: its name in cell names,
// badge: an ATC code shown as a badge (else the label is the header's text), title: a tooltip,
// filter: the filter patch its header and cells set (null: a static column, "Other")}] in display
// order. sort: { key: "total" | "name" | a column key, direction: "asc" | "desc" }. parent: the one
// ATC class or therapeutic area whose children the columns are ({ key, badge: an ATC code or null,
// label, name, lead: the text before it, filter }), or null.
// onFilter(patch), onSort(key): a sort button was clicked. isSet(patch):
// the patch is exactly the current filter (the control is pressed). labelledBy, describedBy: the ids
// naming and describing the table (outside the scroll area, so they stay readable on a phone).
export function renderActivity(container, { rows, columns, sort, parent = null, labelledBy, describedBy, onFilter, onSort, isSet, linkOf = () => null }) {
  const focused = container.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
  const root = d3.select(container);
  root.selectChildren().remove();
  root.append("p").attr("id", HINT_ID).attr("class", "visually-hidden").text(UI.activity.filterHint);
  // The class the columns split: a pressed toggle (its click clears the ATC filter it set).
  if (parent) {
    const line = root.append("p").attr("class", "activity-parent");
    line.append("span").attr("class", "tools-label").text(parent.lead ?? UI.activity.parentLead);
    const button = line.append("button")
      .attr("type", "button")
      .attr("class", "activity-parent-button")
      .attr("data-focus-key", `column:${parent.key}`)
      .attr("aria-label", parent.label)
      .on("click", () => onFilter(parent.filter));
    filterButton(button, parent.label, isSet(parent.filter));
    if (parent.badge) appendCodeBadge(button, parent.badge);
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
  // The Holder column is sorted by name or by the total its cells show after the name.
  const holderSorted = sort.key === "name" || sort.key === "total";
  head.append("th").attr("scope", "col").attr("aria-sort", holderSorted ? ARIA_SORT[sort.direction] : null).text(UI.activity.holder);
  head.selectAll("th.activity-col").data(columns).join("th").attr("scope", "col").attr("class", "activity-col").each(function header(column) {
    const cell = d3.select(this).attr("title", column.title ?? null).attr("aria-sort", sort.key === column.key ? ARIA_SORT[sort.direction] : null);
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
  appendSortButton(holderSorts, { key: "name", label: UI.activity.sortByName, text: UI.activity.sortName, sort, onSort });
  appendSortButton(holderSorts, { key: "total", label: UI.activity.sortByTotal, text: UI.activity.sortTotal, sort, onSort });
  sorts.selectAll("td.activity-sort").data(columns).join("td").attr("class", "activity-sort").each(function sortCell(column) {
    appendSortButton(d3.select(this), { key: column.key, label: UI.activity.sortBy(column.title ?? column.label), sort, onSort });
  });
  const lines = table.append("tbody").selectAll("tr").data(rows).join("tr");
  const heads = lines.append("th").attr("scope", "row");
  const holders = heads.append("span").attr("class", "activity-row-head")
    .append("button")
    .attr("type", "button")
    .attr("data-focus-key", (row) => `row:${row.key}`)
    .attr("aria-label", (row) => UI.activity.holderRow(row.label, row.count, row.names ?? null))
    .each(function holder(row) {
      const button = filterButton(d3.select(this), row.label, isSet({ mah: [row.key] }));
      // The EMA holder names behind the company, then what a click does.
      if (row.names) button.attr("title", `${row.label}: ${row.names}\n${button.attr("title")}`);
    })
    .on("click", (event, row) => onFilter({ mah: [row.key] }));
  holders.filter((row) => row.badge).append((row) => companyBadge(row.badge));
  holders.append("span").attr("class", "activity-holder").text((row) => row.label);
  holders.append("span").attr("class", "activity-total").text((row) => formatCount(row.count));
  heads.select(".activity-row-head").each(function link(row) {
    const anchor = linkOf(row);
    if (anchor) this.append(anchor);
  });
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
      const patch = { mah: [cell.row.key], ...cell.column.filter };
      d3.select(this).append("button")
        .attr("type", "button")
        .attr("data-focus-key", `cell:${cell.row.key}|${cell.column.key}`)
        .attr("aria-label", UI.activity.cell(cell.row.label, cell.column.label, cell.count))
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
