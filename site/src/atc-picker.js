// ATC drill-down: a path of level badges and the classes one level below the current code, with
// counts. Reusable containers (the Filters disclosure now; the facet sidebar and phone sheet
// later). Controls carry data-focus-key ("all" or a code) so a rebuild can put focus back.
import * as d3 from "d3";
import { atcChildren, atcLadder, atcLevel } from "./atc.js";
import { atcHue } from "./badges.js";
import { UI, atcClassLabel, atcName } from "./labels.js";

const formatCount = d3.format(",");

// The full code of one level, in its group's hue and level shade.
function appendCodeBadge(parent, code) {
  return parent.append("span").attr("class", `code-badge hue-${atcHue(code)} level-${atcLevel(code)}`).text(code);
}

// Put focus on the control with this key, else on the current path item.
function focusKey(container, key) {
  (container.querySelector(`[data-focus-key="${key}"]`) ?? container.querySelector("[aria-current]"))?.focus();
}

// Path of current's levels as buttons: "All ATC classes" (all), then one badge per level; the
// last is the current class (aria-current). counts: shown after each badge; showName: the
// current class's name shown too (every button names its class and count via aria-label).
// label: the list's name.
export function renderAtcPath(container, { current, counts = null, names, onSelect, all = true, showName = false, label = null }) {
  const focused = container.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
  const root = d3.select(container);
  root.selectChildren().remove();
  const items = [...(all ? [{ code: null }] : []), ...atcLadder(current ?? "", counts, names)];
  const buttons = root.append("ol")
    .attr("class", "atc-path")
    .attr("aria-label", label)
    .selectAll("li")
    .data(items)
    .join("li")
    .append("button")
    .attr("type", "button")
    .attr("data-focus-key", (item) => item.code ?? "all")
    .attr("aria-current", (item, index) => (index === items.length - 1 ? "location" : null))
    .on("click", (event, item) => onSelect(item.code));
  buttons.filter((item) => item.code === null).attr("class", "path-all").text(UI.atc.all);
  buttons.filter((item) => item.code !== null).each(function level(item) {
    const button = d3.select(this).attr("aria-label", UI.atc.classCount(item.code, item.name, item.count));
    appendCodeBadge(button, item.code);
    if (showName && item === items.at(-1)) button.append("span").attr("class", "path-name").text(atcName(item.code, item.name));
    if (item.count !== null) button.append("span").attr("class", "path-count").text(formatCount(item.count));
  });
  if (focused !== undefined) focusKey(container, focused);
}

// After a pick, where focus goes on the next render: "first-child" (drilled down) or a path key.
const nextFocus = new WeakMap();
// Whether the class list is shown ({ open, current } of the last render): closed at first, so
// the always-open desktop filter row stays short; it opens when a code gets selected and
// otherwise stays as the user left it.
const listState = new WeakMap();

// current: the ATC code filter (null for none); nameQuery: the ATC filter text when it is a name,
// not a code (all groups are shown). counts, exact: products per prefix and per exact code
// (atcPrefixCounts(), atcExactCounts()); names: code -> WHO name; onSelect(code | null).
export function renderAtcPicker(container, { current, nameQuery = null, counts, exact = null, names, onSelect }) {
  const focused = container.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
  const intent = nextFocus.get(container);
  nextFocus.delete(container);
  const last = listState.get(container);
  const open = last === undefined ? current !== null : last.open || (current !== null && current !== last.current);
  listState.set(container, { open, current });
  // A rebuild of the same list keeps its scroll position.
  const previous = container.querySelector(".atc-children");
  const scroll = previous ? { label: previous.getAttribute("aria-label"), top: previous.scrollTop } : null;
  const pick = (code, focus) => {
    nextFocus.set(container, focus);
    onSelect(code);
  };
  const root = d3.select(container);
  root.selectChildren().remove();

  renderAtcPath(root.append("nav").attr("aria-label", UI.atc.path).node(), {
    current, counts, names, showName: true, onSelect: (code) => pick(code, code ?? "all"),
  });
  if (nameQuery) root.append("p").attr("class", "muted").text(UI.atc.nameFilter(nameQuery));

  // Children as buttons; the products coded only down to current as a static last row.
  const children = atcChildren(current, counts, names, exact);
  if (children.length) {
    const parent = current === null ? null : atcClassLabel(current, names.get(current));
    const toggle = root.append("button")
      .attr("type", "button")
      .attr("class", "atc-browse")
      .attr("data-focus-key", "browse")
      .attr("aria-expanded", String(open))
      .text(UI.atc.browse);
    const list = root.append("ul")
      .attr("class", "atc-children")
      .attr("aria-label", UI.atc.childrenLabel(children[0].level, parent))
      .attr("hidden", open ? null : "");
    toggle.on("click", () => {
      const next = toggle.attr("aria-expanded") !== "true";
      listState.set(container, { open: next, current });
      toggle.attr("aria-expanded", String(next));
      list.attr("hidden", next ? null : "");
    });
    const rows = list.selectAll("li")
      .data(children)
      .join("li")
      .append((row) => document.createElement(row.incomplete ? "div" : "button"))
      .attr("class", (row) => (row.incomplete ? "atc-child-static" : null));
    rows.filter((row) => !row.incomplete)
      .attr("type", "button")
      .attr("data-focus-key", (row) => row.code)
      .attr("aria-label", (row) => UI.atc.classCount(row.code, row.name, row.count))
      .on("click", (event, row) => pick(row.code, "first-child"));
    rows.each(function badge(row) {
      appendCodeBadge(d3.select(this), row.code);
    });
    rows.append("span")
      .attr("class", (row) => (row.name ? "atc-child-name" : "atc-child-name no-name"))
      .text((row) => (row.incomplete ? UI.atc.incomplete : atcName(row.code, row.name)));
    rows.append("span").attr("class", "atc-child-count").text((row) => formatCount(row.count));
    if (scroll?.label === list.attr("aria-label")) list.node().scrollTop = scroll.top;
  }
  root.append("p").attr("class", "muted atc-note").text(UI.atc.note);

  // Drilled down: the first child (none: the class itself). Went up: that path item. Otherwise a
  // rebuild keeps focus where it was.
  const key = intent === "first-child" ? children[0]?.code ?? current ?? "all" : intent ?? focused;
  if (key !== undefined) focusKey(container, key);
}
