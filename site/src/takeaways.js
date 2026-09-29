// The dashboard cards' takeaways (F · Spacious, phase 3; Cognitive Load / Selective Attention): one
// sentence under each card's title, computed from the data the card shows (the filters applied),
// in place of the method description, which moved into the card's (i) panel. Pure; copy in
// labels.js UI.takeaways. null: no sentence (nothing to say, the card's own empty line says why).
import { UI } from "./labels.js";

const COPY = UI.takeaways;

// The largest count (above 0) and every item that has it, in their order.
export function topTies(items, countOf) {
  const count = Math.max(0, ...items.map(countOf));
  return { count, items: count > 0 ? items.filter((item) => countOf(item) === count) : [] };
}

const DAY_MS = 86400000;
const time = (date) => Date.parse(`${date}T00:00:00Z`);

// "Authorized over time": series (approvals.js authorizedSeries(): { date, authorized_products },
// month ends, then the data's date). The last point, and its change from the point nearest to a
// year before it (none when the series is shorter than about a year: within 45 days of it).
export function overTimeTakeaway(series) {
  const last = series.at(-1);
  if (!last) return null;
  const target = time(last.date) - 365 * DAY_MS;
  let before = null;
  for (const row of series.slice(0, -1)) {
    if (!before || Math.abs(time(row.date) - target) < Math.abs(time(before.date) - target)) before = row;
  }
  const change = before && Math.abs(time(before.date) - target) <= 45 * DAY_MS ? last.authorized_products - before.authorized_products : null;
  return COPY.overTime(last.authorized_products, change);
}

// "Approvals per year": products (the dated medicines the chart shows) approved in year (the last
// full year), and how many of them are biosimilars.
export function yearsTakeaway(products, year) {
  const approved = products.filter((product) => product.year === year);
  return COPY.years(approved.length, year, approved.filter((product) => product.medicine_type === "Biosimilar").length);
}

// The breakdown: its bars (rows: { key, label, count, static, other, incomplete }), the group with
// the most medicines; labelOf(row): its name (an ATC class with its code). Static rows (a class
// shown alone, "code incomplete", "not more specific", "not classified") and Other are no group.
export function breakdownTakeaway(rows, labelOf = (row) => row.label) {
  const groups = rows.filter((row) => !row.static && !row.other && !row.incomplete);
  const { count, items } = topTies(groups, (row) => row.count);
  if (!items.length) return null;
  if (groups.length === 1) return COPY.onlyGroup(labelOf(items[0]), count);
  return COPY.mostMedicines(items.map(labelOf), count);
}

// "Who is active where": rows (facets.js holderActivity(), most medicines first) and columns
// ([{ key, label, other }]): the company with the most, and its medicines in its largest column
// (not Other); companies tied for the most are named without.
export function activityTakeaway(rows, columns) {
  const { count, items } = topTies(rows, (row) => row.count);
  if (!items.length) return null;
  if (items.length > 1) return COPY.mostMedicines(items.map((row) => row.label), count);
  const [top] = items;
  const { count: inColumn, items: tops } = topTies(columns.filter((column) => !column.other), (column) => top.cells.get(column.key) ?? 0);
  return COPY.activity(top.label, count, tops.length ? tops[0].label : null, inColumn);
}

// Protection: rows (protection-calendar.js protectionEnding() rows: medicines whose estimated market
// protection runs, min its earliest end), how many may lose it by the end of firstYear + span.
export function protectionTakeaway(rows, firstYear, span = 2) {
  if (!rows.length) return null;
  const year = firstYear + span;
  const ending = rows.filter((row) => Number(row.min.slice(0, 4)) <= year).length;
  return COPY.protection(ending, rows.length, year);
}

// Conditions: rows (facets.js conditionRows(), most treatments first), the condition(s) with the
// most treatments.
export function conditionsTakeaway(rows) {
  const { count, items } = topTies(rows, (row) => row.treatments);
  return items.length ? COPY.conditions(items.map((row) => row.name), count) : null;
}
