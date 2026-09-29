// Pure data helpers: no DOM, no D3, so they run under node:test.
import { buildAreaTree } from "./areas.js";
import { atcCode, atcPrefixes } from "./atc.js";
import { NOT_STATED } from "./labels.js";

export const MEDICINE_TYPES = ["Advanced therapy", "Biosimilar", "Generic", "Other"];

export function buildSubstanceIndex(substanceRows) {
  const index = new Map();
  for (const { ema_product_number, active_substance } of substanceRows) {
    if (!index.has(ema_product_number)) index.set(ema_product_number, []);
    index.get(ema_product_number).push(active_substance);
  }
  return index;
}

// Statuses in stack order ("Approvals per year" by status bottom up, undated table rows, dek ties):
// authorized, the ended authorizations, never authorized, pending; unknown ones last, by name.
export const STATUS_ORDER = [
  "Authorised", "Withdrawn", "Expired", "Lapsed", "Suspended", "Revoked",
  "Refused", "Application withdrawn", "Withdrawn from rolling review", "Opinion", "Opinion under re-examination",
];

const statusRank = (status) => (STATUS_ORDER.includes(status) ? STATUS_ORDER.indexOf(status) : STATUS_ORDER.length);

export function byStatusOrder(a, b) {
  return statusRank(a) - statusRank(b) || a.localeCompare(b);
}

// Newest approval first (ties by name); medicines without an approval date last, by status then name.
export function newestFirst(medicines) {
  return [...medicines].sort((a, b) => {
    const [left, right] = [a.marketing_authorisation_date, b.marketing_authorisation_date];
    if ((left === null) !== (right === null)) return left === null ? 1 : -1;
    const byDate = left === null ? byStatusOrder(a.medicine_status, b.medicine_status) : right.localeCompare(left);
    return byDate || a.name_of_medicine.localeCompare(b.name_of_medicine);
  });
}

export function distinctSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function groupRows(rows, keyOf, valueOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(valueOf(row));
  }
  return groups;
}

// One record per medicine with the fields the filters and views need. areaTree: buildAreaTree() of
// branchRows and subtreeRows (built here when not given): areaKeys are a product's therapeutic area
// tree keys (its terms and every branch and node above them), areaExact the keys of its static rows
// (the nodes its terms are, the branches it is tagged only at the root of; areas.js exactOf()).
// companyRows: ema_medicine_companies.json (companies part 2): a product's company and group
// (null without a holder), how its holder was decided and the Union Register's holder; mah stays
// EMA's holder name (older links filter by it).
export function buildProducts(medicines, { areaRows, branchRows, atcRows, companyRows = [], subtreeRows = [], areaTree = buildAreaTree(branchRows, subtreeRows) }) {
  const areasByProduct = groupRows(areaRows, (row) => row.ema_product_number, (row) => row.therapeutic_area_mesh);
  const branchesByTerm = groupRows(
    branchRows.filter((row) => row.branch !== null),
    (row) => row.therapeutic_area_mesh,
    (row) => row.branch,
  );
  const atcByProduct = groupRows(atcRows, (row) => row.ema_product_number, (row) => row);
  const companyByProduct = new Map(companyRows.map((row) => [row.ema_product_number, row]));
  return medicines.map((medicine) => {
    const areas = areasByProduct.get(medicine.ema_product_number) ?? [];
    const company = companyByProduct.get(medicine.ema_product_number);
    return {
      ...medicine,
      mah: medicine.marketing_authorisation_developer_applicant_holder ?? NOT_STATED,
      holder_ema: medicine.marketing_authorisation_developer_applicant_holder ?? null,
      holder_register: company?.holder_register ?? null,
      holder_basis: company?.holder_basis ?? null,
      company_key: company?.company_key ?? null,
      group_key: company?.group_key ?? null,
      year: medicine.authorized_from === null ? null : Number(medicine.authorized_from.slice(0, 4)),
      areas,
      branches: distinctSorted(areas.flatMap((area) => branchesByTerm.get(area) ?? [])),
      areaKeys: areaTree.keysOf(areas),
      areaExact: areaTree.exactOf(areas),
      atc: atcByProduct.get(medicine.ema_product_number) ?? [],
    };
  });
}

// EMA's date field for the event behind each status; the others (ended statuses, and
// "Withdrawn from rolling review", as in the table's date line) use authorized_until.
const STATUS_DATE_FIELDS = {
  Authorised: "authorized_from",
  Refused: "refusal_of_marketing_authorisation_date",
  "Application withdrawn": "withdrawal_of_application_date",
  Opinion: "opinion_adopted_date",
  "Opinion under re-examination": "opinion_adopted_date",
};

// The date of the event behind a medicine's current status (ema_medicines row), or null.
export function statusDate(medicine) {
  return medicine[STATUS_DATE_FIELDS[medicine.medicine_status] ?? "authorized_until"] ?? null;
}

export function isAuthorizedNow(product) {
  return product.medicine_status === "Authorised" && product.authorized_from !== null;
}

// A lookup list of search-index rows (ema_search_index.json): the currently authorized ones (as
// isAuthorizedNow(): status Authorised with an approval date, so a list's count matches its
// headline's), or every status when showAll is set or none is currently authorized.
export function authorizedFirst(rows, showAll) {
  const authorized = rows.filter((row) => row.medicine_status === "Authorised" && Boolean(row.marketing_authorisation_date));
  const everyStatus = showAll || authorized.length === 0;
  return { current: authorized.length, everyStatus, shown: everyStatus ? rows : authorized };
}

function distinctSubstanceSets(products) {
  return new Set(products.map((product) => product.substance_set_key).filter((key) => key !== null)).size;
}

export function countTiles(products) {
  const count = (flag) => products.filter((product) => product[flag]).length;
  return {
    products: products.length,
    substances: distinctSubstanceSets(products),
    orphan: count("orphan_medicine"),
    biosimilar: count("biosimilar"),
    generic: count("generic"),
    advancedTherapy: count("advanced_therapy"),
  };
}

// Counted on date d: no series_exclusion and authorized_from <= d < authorized_until (open if null).
// A sweep over sorted start and end dates; ISO date strings compare correctly as text.
export function authorizedSeries(products, dates) {
  const counted = products.filter(
    (product) =>
      product.series_exclusion === null &&
      product.authorized_from !== null &&
      (product.authorized_until === null || product.authorized_until > product.authorized_from),
  );
  const starts = [...counted].sort((a, b) => a.authorized_from.localeCompare(b.authorized_from));
  const ends = counted
    .filter((product) => product.authorized_until !== null)
    .sort((a, b) => a.authorized_until.localeCompare(b.authorized_until));
  const setCounts = new Map();
  const adjust = (key, change) => {
    if (key === null) return;
    const next = (setCounts.get(key) ?? 0) + change;
    if (next === 0) setCounts.delete(key);
    else setCounts.set(key, next);
  };
  let started = 0;
  let ended = 0;
  return dates.map((date) => {
    while (started < starts.length && starts[started].authorized_from <= date) adjust(starts[started++].substance_set_key, 1);
    while (ended < ends.length && ends[ended].authorized_until <= date) adjust(ends[ended++].substance_set_key, -1);
    return { date, authorized_products: started - ended, authorized_substances: setCounts.size };
  });
}

// ATC: the level-1 group of each valid code (atcCode(): the code to use; none for a row without a
// code or with a malformed one, as in the ATC bars, atcPrefixCounts()).
const BREAKDOWN_VALUES = {
  atc: (product) => product.atc.flatMap((row) => atcPrefixes(atcCode(row)).slice(0, 1)),
  area: (product) => product.branches,
  // Companies part 2: company groups; medicines without a holder have none.
  mah: (product) => (product.group_key ? [product.group_key] : []),
};

// Products with no value for the breakdown, so the page can say they are not shown.
export function breakdownExcluded(products, by) {
  return products.filter((product) => BREAKDOWN_VALUES[by](product).length === 0).length;
}

// Breakdown rows (areas.js areaBreakdownRows() or companies.js companyBreakdownRows() output, or
// ATC classes) in the Sort control's order: "count"
// as computed (most first) or, direction "asc", fewest first (ties keep their order); "key" ATC
// classes by code, areas in MeSH tree order (their rank, areaBreakdownRows(); owner request
// 2026-09-28) and holders by name, A-Z or, direction "desc", Z-A. The Other row and the
// incomplete-code row stay last.
export function sortBreakdownRows(rows, order, by, direction = order === "key" ? "asc" : "desc") {
  if (order !== "key" && direction === "desc") return rows;
  const last = (row) => Boolean(row.other || row.incomplete);
  const sign = direction === "asc" ? 1 : -1;
  const byLabel = (a, b) => a.label.localeCompare(b.label);
  const byKey = by === "atc" ? (a, b) => a.key.localeCompare(b.key)
    : by === "area" ? (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || byLabel(a, b)
      : byLabel;
  const compare = order === "key" ? (a, b) => sign * byKey(a, b) : (a, b) => a.count - b.count;
  return [...rows.filter((row) => !last(row)).sort(compare), ...rows.filter(last)];
}
