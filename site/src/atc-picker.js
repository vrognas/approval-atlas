// ATC level path: a path of level badges (the breakdown's drill-down and the class headline).
// Controls carry data-focus-key ("all" or a code) so a rebuild can put focus back.
import * as d3 from "d3";
import { atcLadder, atcLevel } from "./atc.js";
import { atcHue } from "./badges.js";
import { UI } from "./labels.js";

const formatCount = d3.format(",");

// The full code of one level, in its group's hue and level shade.
export function appendCodeBadge(parent, code) {
  return parent.append("span").attr("class", `code-badge hue-${atcHue(code)} level-${atcLevel(code)}`).text(code);
}

// Put focus on the control with this key, else on the current path item.
function focusKey(container, key) {
  (container.querySelector(`[data-focus-key="${key}"]`) ?? container.querySelector("[aria-current]"))?.focus();
}

// Path of current's levels as buttons: "All ATC classes" (all), then one badge per level; the
// last is the current class (aria-current). counts: medicines, shown after each badge (every
// button names its class and count via aria-label). label: the list's name.
export function renderAtcPath(container, { current, counts = null, names, onSelect, all = true, label = null }) {
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
    if (item.count !== null) button.append("span").attr("class", "path-count").text(formatCount(item.count));
  });
  if (focused !== undefined) focusKey(container, focused);
}
