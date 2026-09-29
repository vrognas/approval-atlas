// The conditions card (redesign 2026-09-29, owner-approved): the therapeutic areas of the medicines
// shown as a compact table, one row per specific condition (MeSH level 3 and deeper; broad
// categories such as Neoplasms are left out: owner decision 2026-09-29), counted as its condition
// page counts (facets.js conditionRows(): a MeSH descriptor with its narrower EMA terms; review
// 2026-09-29): the condition (a link to its condition page, with its MeSH explainer and its branch
// chips, area-chips.js), its treatments (distinct authorized active substances or combinations) and
// its authorized medicines with a bar of every status (the authorized part solid). Ranked by
// treatments or authorized medicines, most or fewest first: a sort button in each of those headers
// (the site's convention: facets.js nextSort(), a second click on the sort in force reverses it;
// aria-sort on the sorted header, the pressed button's name says the order). The first 10 rows,
// then "Show 10 more"; the count shown goes back to 10 when the sort or the filters change. The
// sort and the count are UI state (not in the URL), kept across renders. Rebuilt on every render;
// focus goes back to the same link, chip or button. Explicit table roles keep the semantics where
// narrow cards and phones stack each row on two lines (style.css). Text goes in via textContent
// only; bar widths through the CSSOM.
import * as d3 from "d3";
import { appendSortIcon } from "./activity.js";
import { areaChips, chipTogglable, fillTerm } from "./area-chips.js";
import { FAILED } from "./datasets.js";
import { conditionRows, conditionsCardState, nextSort } from "./facets.js";
import { UI } from "./labels.js";
import { addMeshTip } from "./mesh-notes.js";
import { focusToolbarButton, toolbarKeydown } from "./toolbar.js";

const COPY = UI.conditions;
const PAGE = 10;
const ARIA_SORT = { asc: "ascending", desc: "descending" };
const SORTS = ["treatments", "medicines"];
const formatCount = d3.format(",");

function node(tag, className, ...children) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.append(...children.filter((child) => child !== null && child !== undefined));
  return element;
}

// section: #conditions. link(term, descriptorUi): a link to the term's condition page. noteOf(ui):
// its MeSH note (mesh-notes.js), or null until the notes have loaded. branches: the terms' MeSH
// branches (areas.js termBranches()). onAreaChip(branch): a chip was clicked (the area filter with
// the branch toggled); focusAreaFallback(): where focus goes when the clicked chip is gone.
export function createConditionsCard(section, { link, noteOf, branches, onAreaChip, focusAreaFallback }) {
  const title = section.querySelector("#conditions-title");
  const subtitle = section.querySelector("#conditions-subtitle");
  const table = section.querySelector("#conditions-table");
  const more = section.querySelector("#conditions-more");
  const unlisted = section.querySelector("#conditions-unlisted");
  const empty = section.querySelector("#conditions-empty");
  let sort = { key: "treatments", direction: "desc" };
  let limit = PAGE;
  let filterKey = null;
  let last = null;
  // What to focus after the next render (a clicked chip or sort button), else what had focus.
  let refocus = null;

  // A clicked chip toggles its branch in the area filter (as the tree), unless it is included
  // through a selected category (area-chips.js); focus comes back to it after the render.
  table.addEventListener("click", (event) => {
    const chip = event.target.closest("button.area-chip");
    if (!chip || !chipTogglable(chip)) return;
    refocus = { row: chip.closest("tr").dataset.key, area: chip.dataset.area };
    onAreaChip(chip.dataset.area);
  });
  // Toolbar keys (a condition's chips and "+n"): Left/Right to the neighboring item, Home/End.
  table.addEventListener("keydown", (event) => toolbarKeydown(event, "button.area-chip, .area-more"));
  // "Show 10 more" only adds rows: focus goes to the first one revealed (its link, else its chips).
  more.addEventListener("click", () => {
    const shown = table.tBodies[0]?.rows.length ?? 0;
    limit += PAGE;
    render(last);
    const row = table.tBodies[0]?.rows[shown];
    const target = row?.querySelector("a, button.area-chip[tabindex='0']");
    if (target) target.focus();
    else more.scrollIntoView({ block: "nearest" });
  });

  // The focused control as something a rebuilt table has again: a chip or "+n" by its condition,
  // anything else by its focus key.
  function focusedControl() {
    const active = document.activeElement;
    if (!section.contains(active)) return null;
    const row = active.closest("tr[data-key]")?.dataset.key ?? null;
    if (active.matches("button.area-chip")) return { row, area: active.dataset.area };
    if (active.matches(".area-more")) return { row, more: true };
    return active.dataset.focusKey ? { key: active.dataset.focusKey } : null;
  }

  // Back to the same control: a chip of the same condition (else that condition's "+n", where a chip
  // no longer within the area filter can go; else the same chip of another condition; else the
  // area filter), or the control with the same focus key. With the table hidden (a chip's filter
  // left no condition with an authorized medicine), a chip's focus goes to the area filter.
  function restore(target) {
    if (table.hidden) {
      if (target.area) focusAreaFallback();
      return;
    }
    if (target.key) {
      section.querySelector(`[data-focus-key="${CSS.escape(target.key)}"]`)?.focus();
      return;
    }
    const row = [...(table.tBodies[0]?.rows ?? [])].find((tr) => tr.dataset.key === target.row);
    const chip = `button.area-chip[data-area="${CSS.escape(target.area ?? "")}"]`;
    const found = (target.area ? row?.querySelector(chip) : null) ?? row?.querySelector(".area-more")
      ?? (target.area ? table.querySelector(chip) : null);
    if (found) focusToolbarButton(found);
    else if (target.area) focusAreaFallback();
  }

  function sortButton(key) {
    const pressed = sort.key === key;
    const direction = pressed ? sort.direction : "desc";
    const button = node("button", "sort-button sort-text", node("span", null, COPY.headers[key]));
    button.type = "button";
    button.dataset.focusKey = `sort:${key}`;
    button.setAttribute("aria-pressed", String(pressed));
    button.setAttribute("aria-label", UI.sortOrder.name(COPY.sortBy[key], "count", pressed ? direction : null));
    appendSortIcon(d3.select(button), direction === "asc");
    button.addEventListener("click", () => {
      sort = nextSort(sort, key);
      limit = PAGE;
      refocus = { key: `sort:${key}` };
      render(last);
    });
    return button;
  }

  // The header cells are named by their column's name (aria-label), not by the sort button inside
  // (its name says the order), so a cell's column reads "Treatments".
  function header(key) {
    const cell = node("th", `cond-${key}`);
    cell.scope = "col";
    cell.setAttribute("role", "columnheader");
    if (key === "condition") {
      cell.textContent = COPY.headers.condition;
      return cell;
    }
    cell.setAttribute("aria-label", COPY.headers[key]);
    if (sort.key === key) cell.setAttribute("aria-sort", ARIA_SORT[sort.direction]);
    cell.append(sortButton(key));
    return cell;
  }

  function conditionCell(row, selectedArea) {
    const cell = node("th", "cond-condition");
    cell.scope = "row";
    cell.setAttribute("role", "rowheader");
    let name = row.name;
    if (row.descriptorUi) {
      name = addMeshTip(link(row.name, row.descriptorUi), noteOf(row.descriptorUi));
      name.dataset.focusKey = `cond:${row.key}`;
    }
    const term = node("span", "term");
    fillTerm(term, node("span", "cond-name", name), areaChips(row.term, branches, selectedArea), true);
    cell.append(term);
    return cell;
  }

  function cell(className, ...children) {
    const element = node("td", className, ...children);
    element.setAttribute("role", "cell");
    return element;
  }

  // Phones: what a number counts, after it (the header is hidden there, and says it).
  function unit(text) {
    const element = node("span", "cond-unit", ` ${text}`);
    element.setAttribute("aria-hidden", "true");
    return element;
  }

  // The authorized medicines, then (muted) of every status, after a bar of every status (the
  // authorized part solid; scaled to the largest count shown), 1px apart. authorizedOnly: only
  // authorized medicines are shown (the default status filter): the number alone.
  function medicinesCell(row, max, authorizedOnly) {
    const bar = node("span", "cond-bar");
    bar.setAttribute("aria-hidden", "true");
    const parts = [
      ["cond-bar-authorized", row.authorized],
      ["cond-bar-rest", row.count - row.authorized],
    ].filter(([, count]) => count > 0);
    for (const [index, [className, count]] of parts.entries()) {
      const width = (100 * count) / max;
      d3.select(bar.appendChild(node("span", className))).style("width", index ? `calc(${width}% - 1px)` : `${width}%`);
    }
    const value = node("span", "cond-value",
      node("span", "cond-number", formatCount(row.authorized)), " ",
      authorizedOnly ? null : node("span", "cond-of", COPY.of(row.count), node("span", "visually-hidden", COPY.everyStatus(row.count))),
      unit(COPY.authorizedUnit));
    const element = cell("cond-medicines", bar, value);
    // What the numbers count, as a tooltip (a data-tip as every explanation, not a native title;
    // PR #15), shown on a tap too (tabindex -1, no tab stop), as the type badges'.
    element.dataset.tip = authorizedOnly ? COPY.authorizedTip(row.authorized) : COPY.medicinesTip(row.authorized, row.count);
    element.tabIndex = -1;
    return element;
  }

  // A line in place of the table (loading, not available, no condition, nothing ranked).
  function showLine(text) {
    empty.textContent = text;
    unlisted.textContent = "";
    table.hidden = true;
    more.hidden = true;
  }

  // view: { products (the medicines shown), anyFilter, authorizedOnly (only authorized ones shown: the
  // default status filter), within (term) => bool or null, broad (term) =>
  // bool (a broad category, not ranked: owner decision 2026-09-29; the area tree's), descriptorOf,
  // descriptors (buildConditions()'s, so each row counts as its condition page; undefined while
  // they load, FAILED when they could not), setKeyOf, selectedArea (the area filter, for the chips),
  // filterKey (the filters, so a change shows the first 10 again) }.
  function render(view) {
    last = view;
    if (view.filterKey !== filterKey) {
      filterKey = view.filterKey;
      limit = PAGE;
    }
    const target = refocus ?? focusedControl();
    refocus = null;
    title.textContent = COPY.title(sort.key, sort.direction);
    subtitle.textContent = COPY.subtitle(view.products.length, view.anyFilter, view.within !== null, view.authorizedOnly);
    if (view.descriptors === undefined || view.descriptors === FAILED) {
      showLine(view.descriptors === FAILED ? UI.lookup.notAvailable : UI.lookup.loading);
      if (target) restore(target);
      return;
    }
    const result = conditionRows(view.products, {
      descriptorOf: view.descriptorOf, descriptors: view.descriptors, within: view.within, broad: view.broad, setKeyOf: view.setKeyOf, sort: sort.key, direction: sort.direction, limit,
    });
    const { rows, total, unlisted: left } = result;
    const state = conditionsCardState(result);
    if (state !== "table") {
      if (state === "none") showLine(COPY.empty(view.products.length));
      else showLine(state === "broad" ? COPY.onlyBroad(result.broad) : COPY.noneAuthorized(total + left));
      if (target) restore(target);
      return;
    }
    empty.textContent = "";
    unlisted.textContent = left ? COPY.unlisted(left) : "";
    table.hidden = false;
    more.hidden = rows.length >= total;
    more.textContent = COPY.showMore(Math.min(PAGE, total - rows.length));
    const thead = node("thead", null, node("tr", null, ...["condition", ...SORTS].map(header)));
    const max = d3.max(rows, (row) => row.count) || 1;
    const tbody = node("tbody");
    for (const row of rows) {
      const tr = node("tr", null,
        conditionCell(row, view.selectedArea),
        cell("cond-treatments", node("span", "cond-value", node("span", "cond-number", formatCount(row.treatments)), unit(COPY.treatmentsUnit(row.treatments)))),
        medicinesCell(row, max, view.authorizedOnly));
      tr.dataset.key = row.key;
      tbody.append(tr);
    }
    for (const group of [thead, tbody]) {
      group.setAttribute("role", "rowgroup");
      for (const tr of group.rows) tr.setAttribute("role", "row");
    }
    table.replaceChildren(thead, tbody);
    if (target) restore(target);
  }

  return { render };
}
