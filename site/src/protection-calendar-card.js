// Draft (loss-of-exclusivity calendar, 2026-09-29): the dashboard card "Estimated protection
// ending" (after "Approvals per year"). One toggle button per year (protection-calendar.js
// calendarBuckets(): this year, the next four, then later), its bar split into the medicines
// without and with orphan market exclusivity running past the market protection estimate; the
// unclear estimates as a line of their own; the medicines whose orphan market exclusivity alone
// runs on as a line whose toggle lists them; the selected year's (or those) medicines listed below,
// by date. Text goes in via textContent only; bar widths through the CSSOM (the CSP allows no style
// attributes).
import * as d3 from "d3";
import { UI } from "./labels.js";
import { ORPHAN_ONLY, barShares, orphanEndsOf } from "./protection-calendar.js";

const COPY = UI.protectionCalendar;
// The selected year lists its first medicines; "Show {n} more" the rest.
const LIST_LIMIT = 20;

function node(tag, className, ...children) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) element.append(child);
  return element;
}

// view: { status: "loading" | "failed" | "ready", and when ready: buckets, unclear, unclearLatest,
// orphanOnly (protectionEnding()'s), running, authorized, filtered (any filter active), selected
// (a bucket key, ORPHAN_ONLY or null), showAll }.
// actions: onSelect(key) (toggles the year or the orphan-only list), onShowAll(),
// medicineLink(product), companyOf(product) (nodes, or null), substancesOf(product) (text).
export function renderProtectionCalendar(container, view, actions = {}) {
  // Rebuilt on every render: focus goes back to the same control.
  const focusKey = container.contains(document.activeElement) ? document.activeElement.dataset.focusKey ?? null : null;
  container.replaceChildren();
  if (view.status !== "ready") {
    container.append(node("p", "muted", view.status === "failed" ? UI.lookup.notAvailable : COPY.loading));
    return;
  }
  const { buckets, unclear, unclearLatest, orphanOnly, running, authorized, filtered, selected, showAll } = view;
  container.append(node("p", "pc-summary", running ? COPY.summary(running, authorized, filtered) : COPY.none(filtered)));
  if (running) {
    container.append(
      node("ul", "legend pc-legend",
        node("li", null, node("span", "swatch pc-swatch pc-protection"), COPY.legend.protection),
        node("li", null, node("span", "swatch pc-swatch pc-orphan"), COPY.legend.orphan(buckets.flatMap((bucket) => bucket.orphanEnds)))),
      ...bars(buckets, selected, actions).filter(Boolean),
    );
  }
  if (unclear) container.append(node("p", "muted pc-unclear", COPY.unclear(unclear, unclearLatest)));
  if (orphanOnly.length) container.append(orphanOnlyLine(orphanOnly, selected === ORPHAN_ONLY, actions));
  const list = container.appendChild(node("div", "pc-list"));
  list.id = "pc-list";
  const bucket = buckets.find((item) => item.key === selected);
  if (selected === ORPHAN_ONLY && orphanOnly.length) orphanOnlyList(list, orphanOnly, showAll, actions);
  else if (running && bucket) medicineList(list, bucket, showAll, filtered, actions);
  else list.hidden = true;
  if (focusKey) container.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
}

// "{n} more medicines have orphan market exclusivity (est.) running after …", then a toggle that
// lists them below (as a year's button does).
function orphanOnlyLine(orphanOnly, pressed, { onSelect }) {
  const years = orphanOnly.map((entry) => Number(entry.orphanEnd.end.slice(0, 4)));
  const toggle = node("button", "text-button pc-orphan-toggle", COPY.orphanOnlyToggle);
  toggle.type = "button";
  toggle.dataset.focusKey = ORPHAN_ONLY;
  toggle.setAttribute("aria-pressed", String(pressed));
  toggle.setAttribute("aria-controls", "pc-list");
  toggle.addEventListener("click", () => onSelect(ORPHAN_ONLY));
  return node("p", "muted pc-unclear pc-orphan-only", COPY.orphanOnlyLine(orphanOnly.length, Math.min(...years), Math.max(...years), orphanEndsOf(orphanOnly)), " ", toggle);
}

function bars(buckets, selected, { onSelect }) {
  const shares = barShares(buckets);
  const group = node("div", `pc-bars${selected ? " has-selection" : ""}`);
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", COPY.bars);
  for (const [position, bucket] of buckets.entries()) {
    const label = COPY.yearLabel(bucket);
    const share = shares[position];
    const track = node("span", `bar-track pc-track${share.clamped ? " pc-clamped" : ""}`,
      share.plain ? node("span", "pc-seg pc-protection") : null,
      share.orphan ? node("span", "pc-seg pc-orphan") : null);
    track.setAttribute("aria-hidden", "true");
    const widths = [share.plain, share.orphan].filter(Boolean);
    // Each gap takes its pixel from the segment after it, so the bar keeps its length.
    d3.select(track).selectAll(".pc-seg").data(widths).style("width", (width, index) => (index ? `calc(${width}% - 1px)` : `${width}%`));
    // The orphan segment's count under the year, so the split is not told by colour alone.
    const labelPart = node("span", "bar-label pc-bar-label", label,
      bucket.orphanLater ? node("span", "pc-bar-orphan", COPY.yearOrphan(bucket.orphanLater)) : null);
    const button = node("button", "bar-row pc-bar", labelPart, track, node("span", "bar-value", d3.format(",")(bucket.count)));
    button.type = "button";
    button.dataset.focusKey = `year-${bucket.key}`;
    button.setAttribute("aria-pressed", String(bucket.key === selected));
    button.setAttribute("aria-controls", "pc-list");
    button.setAttribute("aria-label", COPY.yearName(label, bucket.count, bucket.orphanLater, bucket.orphanEnds));
    button.addEventListener("click", () => onSelect(bucket.key));
    group.append(button);
  }
  return [group, shares.some((share) => share.clamped) ? node("p", "muted pc-scale", COPY.clamped) : null];
}

function medicineList(list, bucket, showAll, filtered, actions) {
  const label = COPY.yearLabel(bucket);
  if (bucket.count === 0) {
    list.append(node("p", "muted", COPY.empty(label, filtered)));
    return;
  }
  listOf(list, COPY.listTitle(label, bucket.count), bucket.rows, showAll, actions, (row) => [
    node("span", "pc-item-range", COPY.range(row.min, row.max)),
    row.orphanEnd ? node("span", "pc-item-orphan", COPY.orphan(row.orphanEnd)) : null,
  ]);
}

// The medicines whose orphan market exclusivity alone runs on, by its end: their market protection
// estimate (ended, or its range) and the orphan end.
function orphanOnlyList(list, orphanOnly, showAll, actions) {
  listOf(list, COPY.orphanOnlyTitle(orphanOnly.length, orphanEndsOf(orphanOnly)), orphanOnly, showAll, actions, (entry) => [
    node("span", "pc-item-range", entry.status === "copy" ? COPY.copyNoOwn : entry.status === "ended" ? COPY.ended(entry.max) : COPY.range(entry.min, entry.max)),
    node("span", "pc-item-orphan", COPY.orphanOnlyUntil(entry.orphanEnd)),
  ]);
}

// A titled list of medicines (the first LIST_LIMIT, then "Show {n} more"): name, company, substances,
// then lines(row). Links carry focus keys, so a re-render keeps a focused one.
function listOf(list, titleText, rows, showAll, { onShowAll, medicineLink, companyOf, substancesOf }, lines) {
  const title = list.appendChild(node("h3", "pc-list-title", titleText));
  title.id = "pc-list-title";
  const shown = showAll ? rows : rows.slice(0, LIST_LIMIT);
  const items = list.appendChild(node("ol", "pc-medicines"));
  items.setAttribute("aria-labelledby", title.id);
  for (const row of shown) {
    const number = row.product.ema_product_number;
    const link = medicineLink(row.product);
    link.dataset.focusKey = `med-${number}`;
    const nodes = companyOf(row.product);
    const company = nodes ? node("span", "pc-company", nodes) : null;
    company?.querySelector("a")?.setAttribute("data-focus-key", `co-${number}`);
    const substances = substancesOf(row.product);
    items.append(node("li", "pc-item",
      node("span", "pc-item-head", link, company),
      substances ? node("span", "pc-item-substance", substances) : null,
      lines(row)));
  }
  if (shown.length < rows.length) {
    // A list end as every list end: a text button, "Show {n} more" (design sweep 2026-10-01, B6).
    const more = list.appendChild(node("button", "text-button pc-more", COPY.showMore(rows.length - shown.length)));
    more.type = "button";
    more.dataset.focusKey = "show-all";
    more.addEventListener("click", () => {
      // The button goes away (the card is rebuilt on the next frame): focus the first medicine it adds.
      onShowAll();
      requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll("#pc-list .pc-item")[shown.length]?.querySelector("a")?.focus()));
    });
  }
}
