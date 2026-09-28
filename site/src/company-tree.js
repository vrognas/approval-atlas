// The facet sidebar's company section (companies part 2; the phone sheet borrows it): the tree of
// company groups › companies › EMA holder names (companies.js, facet-tree.js), each row with its
// name and count, a group's monogram badge, and a link to its company page. Checked rows combine
// with OR (state.mah holds their filter values). The top groups first, then "Show 20 more". Also
// the path of the company breakdown (renderCompanyPath()).
import * as d3 from "d3";
import { companyTreeChildren, companyTreeRows, companyTreeSearch } from "./companies.js";
import { createFacetTree } from "./facet-tree.js";
import { companyBadge } from "./holders.js";
import { UI } from "./labels.js";

// Groups shown at first, and how many more each "Show more" adds (as the holder list before).
const TOP = 8;
const MORE = 20;

// section: #facet-mah; companies: buildCompanies(). onToggle(value): a checkbox changed its filter
// value. linkOf(value): a link to a group's or company's page, or null. render(model): { selected:
// state.mah, counts: medicines per row key (companies.countKeys()) matching every other filter }.
export function createCompanyTree(section, { companies, onToggle, linkOf }) {
  section.querySelector(".tree-note").textContent = UI.companies.note(companies.asOf);
  const nameOf = (key) => companies.name(companies.rowShows(key));
  // A holder name repeating the name of the row above it shows as "(same name)"; its checkbox's
  // name keeps the name, then says so.
  const labelOf = (key) => (companies.repeatsParent(key) ? UI.companies.sameNameLabel(nameOf(key)) : nameOf(key));
  // A group or company row whose rows are holder names.
  const byHolder = (key) => companies.rows(key).some((child) => companies.kind(companies.rowShows(child)) === "holder");
  return createFacetTree(section, {
    copy: {
      find: UI.companies.find,
      tree: UI.companies.tree,
      noMatches: UI.companies.noMatches,
      matches: UI.facets.matches,
      static: () => UI.companies.noHolder,
      expand: (key) => UI.companies.expand(nameOf(key), byHolder(key)),
      row: (key, count) => UI.companies.count(labelOf(key), count),
      included: (key, count, ancestor) => UI.companies.included(labelOf(key), count, companies.name(ancestor)),
    },
    // Only group and company rows have children: their keys ("g.roche", "g.roche/c.roche") are
    // valid, unique ids.
    idPrefix: "company-children-",
    visible: (model) => companyTreeRows(companies, model.counts, model.selected),
    children: (parent, visible, model) => companyTreeChildren(companies, parent, visible, model.counts),
    // A company row's medicines EMA names no holder for (under its holder name rows).
    exact: (parent, model) => model.counts.get(companies.noHolderKey(parent)) ?? 0,
    search: (visible, query) => companyTreeSearch(companies, visible, query),
    checkState: (key, model) => companies.checkState(key, model.selected),
    includedIn: (key, model) => companies.includedIn(key, model.selected),
    levelsAbove: (value) => companies.levelsAbove(value),
    name: (key) => (companies.repeatsParent(key) ? { text: UI.companies.sameName, missing: true } : { text: nameOf(key), missing: false }),
    // A group's monogram badge before its name (aria-hidden: the name follows).
    decorate: (label, key) => {
      const value = companies.rowShows(key);
      if (companies.kind(value) === "group") label.append(() => companyBadge(companies.row(value)));
    },
    // Group and company rows link to their page (a company under two groups: its one page).
    link: (key) => {
      const page = companies.pageOf(companies.rowShows(key));
      return page === null ? null : linkOf(page);
    },
    limit: TOP,
    more: MORE,
  }, { onToggle: (key) => onToggle(companies.rowValue(key)) });
}

const formatCount = d3.format(",");

// Above the drilled-down company bars: "All companies" (all), then one button per level of the
// path to current (a filter value; the last is current, aria-current). Controls carry
// data-focus-key so a rebuild can put focus back.
export function renderCompanyPath(container, { companies, current, counts = null, onSelect, all = true }) {
  const focused = container.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
  const root = d3.select(container);
  root.selectChildren().remove();
  const items = [...(all ? [null] : []), ...companies.pathOf(current)];
  const buttons = root.append("ol")
    .attr("class", "atc-path")
    .attr("aria-label", UI.companies.path)
    .selectAll("li")
    .data(items)
    .join("li")
    .append("button")
    .attr("type", "button")
    .attr("data-focus-key", (value) => value ?? "all")
    .attr("aria-current", (value, index) => (index === items.length - 1 ? "location" : null))
    .on("click", (event, value) => onSelect(value));
  buttons.filter((value) => value === null).attr("class", "path-all").text(UI.companies.all);
  buttons.filter((value) => value !== null).each(function level(value) {
    const count = counts?.get(value) ?? null;
    const name = companies.name(value);
    const button = d3.select(this).attr("aria-label", count === null ? name : UI.companies.count(name, count));
    if (companies.kind(value) === "group") button.append(() => companyBadge(companies.row(value)));
    button.append("span").text(name);
    if (count !== null) button.append("span").attr("class", "path-count").text(formatCount(count));
  });
  if (focused !== undefined) (container.querySelector(`[data-focus-key="${CSS.escape(focused)}"]`) ?? container.querySelector("[aria-current]"))?.focus();
}
