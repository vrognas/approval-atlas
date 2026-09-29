// The dashboard cards' takeaways (F · Spacious, phase 3; Cognitive Load / Selective Attention): one
// sentence under each card's title, computed from the data the card shows (the filters applied),
// in place of the method description, which moved into the card's (i) panel. Pure; copy in
// labels.js UI.takeaways. null: no sentence (nothing to say, the card's own empty line says why).
// Review of phase 3: ties are counted over everything the card ranks, not only the rows it shows
// (the conditions and companies: the whole ranking; the breakdown's top 20: "several" when every
// bar shown ties and Other holds more).
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
// month ends, then the data's date): the medicines authorized with an approval date at its last
// point, and the change from the point nearest to a year before it (none when the series is shorter
// than about a year: within 45 days of it). ignored: { status, years }, a status (other than the
// default) or year filter is set, which this history does not apply (review of phase 3).
export function overTimeTakeaway(series, ignored = {}) {
  const last = series.at(-1);
  if (!last) return null;
  const target = time(last.date) - 365 * DAY_MS;
  let before = null;
  for (const row of series.slice(0, -1)) {
    if (!before || Math.abs(time(row.date) - target) < Math.abs(time(before.date) - target)) before = row;
  }
  const change = before && Math.abs(time(before.date) - target) <= 45 * DAY_MS ? last.authorized_products - before.authorized_products : null;
  return COPY.overTime(last.authorized_products, change, { status: Boolean(ignored.status), years: Boolean(ignored.years) });
}

// The year the per-year takeaway names: the last full year (the data's year less 1) inside the
// year filter (from, to: null = open), else the filter's last year; partial: it is the data's year,
// not over yet.
export function takeawayYear(dataYear, from, to) {
  let year = Math.min(dataYear - 1, to ?? Infinity);
  if (from !== null && year < from) year = Math.min(to ?? dataYear, dataYear);
  return { year, partial: year >= dataYear };
}

// "Approvals per year": products (the dated medicines the chart shows: every filter but the years)
// approved in year, and how many of them are biosimilars; worded by the medicines shown, as by
// default they are the authorized ones, not EMA's yearly total (review of phase 3).
export function yearsTakeaway(products, year, partial = false) {
  const approved = products.filter((product) => product.year === year);
  return COPY.years(approved.length, year, approved.filter((product) => product.medicine_type === "Biosimilar").length, partial);
}

// The breakdown: its bars (rows: { key, label, count, static, other, incomplete }), the group with
// the most medicines; labelOf(row): its name (an ATC class with its code). Static rows (a class
// shown alone, "code incomplete", "not more specific", "not classified") and Other are no group.
// Every bar shown tied while Other holds more: the ties may go on beyond the bars ("several").
// by: the breakdown's mode; "atc" names its bars classes (final round before merge).
export function breakdownTakeaway(rows, labelOf = (row) => row.label, by = null) {
  const [one, many] = by === "atc" ? ["class", "classes"] : ["group", "groups"];
  const groups = rows.filter((row) => !row.static && !row.other && !row.incomplete);
  const { count, items } = topTies(groups, (row) => row.count);
  if (!items.length) return null;
  if (groups.length === 1 && !rows.some((row) => row.other)) return COPY.onlyGroup(labelOf(items[0]), count, one);
  if (items.length === groups.length && rows.some((row) => row.other && row.count > 0)) return COPY.mostMedicines(null, count, many);
  return COPY.mostMedicines(items.map(labelOf), count, many);
}

// "Who is active where": rows (facets.js holderActivity() of every company, most medicines first)
// and columns ([{ key, label, other }]): the company with the most, and its medicines in its largest
// column (not Other); companies tied for the most are named without; one company alone, by itself.
export function activityTakeaway(rows, columns) {
  const { count, items } = topTies(rows, (row) => row.count);
  if (!items.length) return null;
  if (items.length > 1) return COPY.mostMedicines(items.map((row) => row.label), count, "companies");
  const [top] = items;
  const { count: inColumn, items: tops } = topTies(columns.filter((column) => !column.other), (column) => top.cells.get(column.key) ?? 0);
  return COPY.activity(top.label, count, tops.length ? tops[0].label : null, inColumn, rows.length === 1);
}

// Protection: rows (protection-calendar.js protectionEnding() rows: medicines whose estimated market
// protection runs, min its earliest end, orphanEnd its orphan market exclusivity running after it,
// or null), how many may lose it by the end of firstYear + span, and how many of those have orphan
// market exclusivity running later (review of phase 3: so "lose market protection" is not read as
// "open to copies").
export function protectionTakeaway(rows, firstYear, span = 2) {
  if (!rows.length) return null;
  const year = firstYear + span;
  const ending = rows.filter((row) => Number(row.min.slice(0, 4)) <= year);
  return COPY.protection(ending.length, rows.length, year, ending.filter((row) => row.orphanEnd).length);
}

// Conditions: rows (facets.js conditionRows(), every condition ranked, most treatments first), the
// condition(s) with the most treatments; none when more than two tie on 1 treatment, which says
// little (final round before merge).
export function conditionsTakeaway(rows) {
  const { count, items } = topTies(rows, (row) => row.treatments);
  if (!items.length || (count === 1 && items.length > 2)) return null;
  return COPY.conditions(items.map((row) => row.name), count);
}
