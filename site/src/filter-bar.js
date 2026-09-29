// The filter chips under the page heading (F · Spacious, phase 1; they replace the filter sentence
// and the sidebar): one chip per filter dimension (facets.js filterChips()), a dashed "⊕ {name}"
// button when inactive, an accent-wash "{name} | {value}" pill with a remove button when active;
// then "[n] active filters · Clear filters" while any is active. A chip opens its controls (main.js:
// a popover under it on desktop, a sheet below 1024px). Rebuilt on every render; focus goes back to
// the same control (a removed pill's chip gets it: its open button).
import { statusTip, typeTip } from "./badges.js";
import { UI } from "./labels.js";
import { modalityTip } from "./modalities.js";

// The explanation of a chip naming one value (chip.tip), by its filter.
const TIPS = { type: typeTip, status: statusTip, mod: modalityTip };
const SVG = "http://www.w3.org/2000/svg";

// A 14px stroke icon (aria-hidden): "add" (a circled plus) or "remove" (an x).
function icon(kind) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", `chip-icon chip-icon-${kind}`);
  const shapes = kind === "add"
    ? [["circle", { cx: "8", cy: "8", r: "6.25" }], ["path", { d: "M8 5v6M5 8h6" }]]
    : [["path", { d: "M4 4l8 8M12 4l-8 8" }]];
  for (const [tag, attributes] of shapes) {
    const shape = svg.appendChild(document.createElementNS(SVG, tag));
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
  }
  return svg;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Pure: which edges of the chip row (phones: it scrolls sideways) have more chips beyond them, for a
// fade there (review of phase 1: with 2 of 7 chips showing at 320px nothing said more followed).
export function edgeFade(scrollLeft, scrollWidth, clientWidth) {
  return { start: scrollLeft > 1, end: scrollLeft + clientWidth < scrollWidth - 1 };
}

// The row's fade classes (style.css), after a render, a scroll or a resize.
function fadeEdges(row) {
  const { start, end } = edgeFade(row.scrollLeft, row.scrollWidth, row.clientWidth);
  row.classList.toggle("scroll-start", start);
  row.classList.toggle("scroll-end", end);
}
const faded = new WeakSet();

// row: the chips' container (#filter-chips). chips: filterChips(). openKey: the chip whose popover
// is open (aria-expanded), or null. onOpen(key), onRemove(chip).
export function renderFilterChips(row, chips, { openKey, onOpen, onRemove }) {
  const focused = row.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
  const nodes = chips.map((chip) => {
    const name = UI.filters.names[chip.key];
    const open = element("button", chip.active ? "chip-open" : "filter-chip filter-chip-add");
    open.type = "button";
    open.dataset.focusKey = `${chip.key}:open`;
    open.dataset.chip = chip.key;
    open.setAttribute("aria-haspopup", "dialog");
    open.setAttribute("aria-expanded", String(openKey === chip.key));
    open.addEventListener("click", () => onOpen(chip.key));
    if (!chip.active) {
      open.append(icon("add"), name);
      return open;
    }
    // Read as "Medicine type: Biosimilar" (the "|" is aria-hidden; a hidden colon stands in).
    open.append(
      element("span", "chip-name", name),
      element("span", "chip-sep", "|"),
      element("span", "visually-hidden", ": "),
      element("span", "chip-value", chip.value),
    );
    open.querySelector(".chip-sep").setAttribute("aria-hidden", "true");
    const pill = element("span", "filter-chip filter-chip-active");
    pill.dataset.chip = chip.key;
    // A type's, status's or modality's explanation on hover and focus, and as the button's description.
    const tip = chip.tip ? TIPS[chip.key]?.(chip.tip) ?? null : null;
    if (tip) {
      pill.dataset.tip = tip.text;
      open.setAttribute("aria-describedby", tip.id);
    }
    const remove = element("button", "chip-remove");
    remove.type = "button";
    remove.dataset.focusKey = `${chip.key}:remove`;
    remove.setAttribute("aria-label", UI.filters.remove(chip.key, chip.value));
    remove.title = UI.filters.remove(chip.key, chip.value);
    remove.append(icon("remove"));
    remove.addEventListener("click", () => onRemove(chip));
    pill.append(open, remove);
    return pill;
  });
  row.replaceChildren(...nodes);
  if (!faded.has(row)) {
    faded.add(row);
    row.addEventListener("scroll", () => fadeEdges(row), { passive: true });
    new ResizeObserver(() => fadeEdges(row)).observe(row);
  }
  fadeEdges(row);
  if (!focused) return;
  const chipKey = focused.split(":")[0];
  (row.querySelector(`[data-focus-key="${focused}"]`) ?? row.querySelector(`[data-focus-key="${chipKey}:open"]`) ?? row.querySelector("button"))?.focus();
}

// summary: #filter-summary, "[2] active filters · Clear filters"; hidden without a filter.
// onClear(): every filter cleared.
export function renderFilterSummary(summary, count, { onClear }) {
  summary.hidden = count === 0;
  if (count === 0) {
    summary.replaceChildren();
    return;
  }
  const hadFocus = summary.contains(document.activeElement);
  const clear = element("button", "text-button filter-clear", UI.filters.clear);
  clear.type = "button";
  clear.addEventListener("click", onClear);
  const separator = element("span", "filter-sep", "·");
  separator.setAttribute("aria-hidden", "true");
  summary.replaceChildren(
    element("span", "filter-count", String(count)),
    ` ${UI.filters.active(count)} `,
    separator,
    " ",
    clear,
  );
  if (hadFocus) clear.focus();
}
