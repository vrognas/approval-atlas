// Pure: medicines with the same active substance(s) as a medicine (its "set"), for the medicine
// card's copies lines and the substance card's salt siblings (step 3, #7 and #8). EMA spells some
// substances several ways ("dasatinib", "dasatinib (anhydrous)"); ema_substance_equivalents.json
// names the spellings checked by hand as one substance. Never a salt-stripping rule: fluticasone
// furoate and propionate are different substances.

const COPY_TYPES = ["Generic", "Biosimilar"];
const AUTHORIZED = "Authorised";

// ema_substance_equivalents.json rows -> Map substance_key -> Set of the other keys naming the same
// substance. Both directions, and chains (two pairs through one key) join one group; no file
// (older data): an empty Map.
export function substanceEquivalents(rows) {
  const groups = new Map();
  for (const { substance_key: key, equivalent_key: other } of rows ?? []) {
    if (!key || !other || key === other) continue;
    const joined = new Set([key, other, ...(groups.get(key) ?? []), ...(groups.get(other) ?? [])]);
    for (const member of joined) groups.set(member, joined);
  }
  return new Map([...groups].map(([key, group]) => [key, new Set([...group].filter((member) => member !== key))]));
}

// One name per substance: the first of its spellings in code-unit order (as R sorts keys).
const representative = (key, equivalents) => [key, ...(equivalents.get(key) ?? [])].sort()[0];

// A medicine's substance keys as a set key (sorted, "|"-joined, as R's substance_set_key), each
// substance named by one spelling; null without substances.
export function equivalentSetKey(keys, equivalents) {
  if (!keys?.length) return null;
  return [...new Set(keys.map((key) => representative(key, equivalents)))].sort().join("|");
}

// Step 4 (#10): how many distinct treatments, not marketing authorizations: the distinct substance
// sets of medicines' substance keys (lists; none: not counted), equivalent spellings joined.
export function substanceSetCount(keyLists, equivalents) {
  return new Set(keyLists.map((keys) => equivalentSetKey(keys, equivalents)).filter((key) => key !== null)).size;
}

// Search-index rows -> Map set key -> rows (input order); rows without substances are left out.
// R names a medicine's substances by its active substance field where EMA's INN field repeats the
// medicine's name (Vysribli is denosumab in the search index), so its set is the estimate's.
export function setGroups(rows, equivalents) {
  const groups = new Map();
  for (const row of rows) {
    const key = equivalentSetKey(row.substance_keys, equivalents);
    if (key === null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

const earliest = (rows) => rows.filter((row) => row.marketing_authorisation_date)
  .sort((a, b) => a.marketing_authorisation_date.localeCompare(b.marketing_authorisation_date) || a.name_of_medicine.localeCompare(b.name_of_medicine))[0] ?? null;

// Backlog (step 4 review): a copy EMA does not flag, checked by hand (ema_curated_copies.json
// copy_type), has that type here: Tuznue (EMA type Other) is a biosimilar of Herceptin, Sugammadex
// Adroiq a generic of Bridion. A hybrid is neither, even where EMA flags it Generic (Riulvy).
const CURATED_TYPES = { generic: "Generic", biosimilar: "Biosimilar", hybrid: "Hybrid" };
const copyType = (row, curatedCopies) => CURATED_TYPES[curatedCopies?.get(row.ema_product_number)?.copy_type] ?? row.medicine_type;

// QA 2026-09-29 (#9): the medicine card explains EMA's type (UI.typeTips), which a curated copy
// type can contradict: Riulvy (EMA Generic, "same active substance") is a hybrid of Tecfidera with
// another substance; Tuznue and Sugammadex Adroiq (EMA Other, "not a generic, biosimilar …") are a
// biosimilar and a generic. The card then says what the EPAR page calls it (UI.copies.typeDiffers).
// medicineType: EMA's type; curatedRow: the ema_curated_copies.json row (undefined without one).
// A hybrid agrees with Other.
const AGREEING_TYPES = { generic: "Generic", biosimilar: "Biosimilar", hybrid: "Other" };
export function curatedTypeDiffers(medicineType, curatedRow) {
  const agreeing = AGREEING_TYPES[curatedRow?.copy_type];
  return Boolean(agreeing) && agreeing !== medicineType;
}

// row: a search-index row; setRows: the rows of its set (setGroups()); groupOf: product number ->
// company group key (null while the companies load: companies then null); curatedCopies: product
// number -> ema_curated_copies.json row (null or left out: EMA's flags only). Returns
// { copy: the row is a generic or biosimilar, or a curated copy of any type (a hybrid too),
//   copies: per type (generics, then biosimilars) the authorized ones of the set other than row,
//     [{ type, count, companies (distinct groups), first (the earliest) }],
//   others: the set's other authorized medicines (any type),
//   first: the set's first dated medicine when it came before row (row undated: any), else null }.
export function copiesSummary(row, setRows, groupOf, curatedCopies = null) {
  const others = setRows.filter((other) => other !== row);
  const authorized = others.filter((other) => other.medicine_status === AUTHORIZED);
  const copies = COPY_TYPES.map((type) => {
    const rows = authorized.filter((other) => copyType(other, curatedCopies) === type);
    const companies = groupOf ? new Set(rows.map((other) => groupOf(other.ema_product_number) ?? other.ema_product_number)).size : null;
    return { type, count: rows.length, companies, first: earliest(rows) ?? rows[0] ?? null };
  }).filter((entry) => entry.count > 0);
  const first = earliest(others);
  const before = first && (!row.marketing_authorisation_date || first.marketing_authorisation_date < row.marketing_authorisation_date) ? first : null;
  const copy = COPY_TYPES.includes(row.medicine_type) || Boolean(curatedCopies?.has(row.ema_product_number));
  return { copy, copies, others: authorized.length, first: before };
}

// Step 4: a hybrid (EMA type Other; R's curated hybrid list) shares its reference's protection:
// its estimate follows the reference (follows_reference), or finds no central one
// (reference_not_found), as a generic's. Its card then reads as a copy's (Liraglutide STADA, a
// hybrid of Victoza: the "same active substance" line, not the originator's "No generic or
// biosimilar authorized yet."). protectionRow: its ema_medicine_protection.json row (undefined
// while loading). Returns summary, with copy true for such an estimate.
const COPY_BASES = ["follows_reference", "reference_not_found"];
export function followsReference(summary, protectionRow) {
  return !summary.copy && COPY_BASES.includes(protectionRow?.basis) ? { ...summary, copy: true } : summary;
}

// The set's first central approval as the medicine card names it ({ name, date, number }, or null
// when this medicine came first): the set's first dated medicine before this one (copiesSummary()),
// named by the protection estimate's reference when that was approved the same day, so card and
// estimate agree. Always a medicine with its own approval date: R names one brand among those of
// the first approval's company approved within 30 days (ema_medicine_protection.json), and
// counted_from is the first approval's date, not always the named brand's (Humira's rows count
// from Trudexa's 1 Sep 2003; Iscover came a day before Plavix, its reference).
// referenceDate: the reference's own approval date.
export function firstApprovalShown(row, summary, protectionRow, referenceDate) {
  const { first } = summary;
  if (!first) return null;
  const number = protectionRow?.reference_product_number;
  if (number && number !== row.ema_product_number && referenceDate === first.marketing_authorisation_date) {
    return { name: protectionRow.reference_name, date: referenceDate, number };
  }
  return { name: first.name_of_medicine, date: first.marketing_authorisation_date, number: first.ema_product_number };
}

// A first approval this many days or fewer before the medicine's own is its twin: another brand of
// the same application (Trudexa a week before Humira, Iscover a day before Plavix; R's
// reference_window_days).
const TWIN_DAYS = 30;
const DAY_MS = 86_400_000;

// Which of the medicine card's copies lines show (lookup.js copiesLines()): copies ("list": the
// set's authorized generics and biosimilars, "none": none yet, null: no line, for a copy, a
// medicine never approved, or an advanced therapy without copies, where "none yet" reads oddly;
// owner's decision 2026-09-29), first (firstApprovalShown(), null for a twin: the copies line
// covers it, owner's decision 2026-09-29) and same (the "same active substance" line: a copy's
// card, or a first approval before this medicine that is not its twin, Wegovy's Ozempic).
export function copiesLinePlan(row, summary, first) {
  const date = row.marketing_authorisation_date;
  const twin = first && date && (Date.parse(date) - Date.parse(first.date)) / DAY_MS <= TWIN_DAYS;
  const shown = twin ? null : first;
  const copies = summary.copy || !date ? null
    : summary.copies.length ? "list"
      : row.medicine_type === "Advanced therapy" ? null : "none";
  return { copies, first: shown, same: summary.copy || shown !== null };
}

// The medicine the protection estimate is counted from, as its lines name it: one approved on
// counted_from (the reference, else this medicine, else first: firstApprovalShown()), or null when
// none is known (the lines then give the date alone).
export function countedFromName(row, first, protectionRow, referenceDate) {
  const date = protectionRow?.counted_from;
  if (!date) return null;
  if (referenceDate === date) return protectionRow.reference_name;
  if (row.marketing_authorisation_date === date) return row.name_of_medicine;
  return first?.date === date ? first.name : null;
}

// The substance card's siblings: the other keys the data has for the same substance, each
// { substance (index.substances entry), count (its medicines), first (its first dated medicine or
// null) }, the earliest first.
export function siblingSubstances(key, substances, equivalents) {
  return [...(equivalents.get(key) ?? [])]
    .map((other) => substances.get(other))
    .filter(Boolean)
    .map((substance) => ({ substance, count: substance.products.length, first: earliest(substance.products) }))
    .sort((a, b) => (a.first?.marketing_authorisation_date ?? "9999").localeCompare(b.first?.marketing_authorisation_date ?? "9999") || a.substance.key.localeCompare(b.substance.key));
}

// The substance card's answer (headline, dek, strip) describes the substance under all its
// spellings (step 3 review: "dasatinib" showed "Since 26 Jul 2024" under "First central EU
// approval: 20 Nov 2006 (Sprycel)", filed as "dasatinib (anhydrous)"). products: the opened
// spelling's medicines; siblings: siblingSubstances(). Returns { rows (its own, then the
// siblings', each once), first (the earliest dated of them, or null), authorized (status
// Authorised) }.
export function substanceGroup(products, siblings) {
  const rows = [...new Set([...products, ...siblings.flatMap((sibling) => sibling.substance.products)])];
  return { rows, first: earliest(rows), authorized: rows.filter((row) => row.medicine_status === AUTHORIZED) };
}

// A search suggestion's count for a substance key (bug hunt 2026-10-01, review of lookup.md #8:
// "dasatinib" and "dasatinib (anhydrous)" said "1 authorized" each, their cards 2): its medicines
// with status Authorised under all its spellings, as its card counts them (substanceGroup());
// substances: the search index's; equivalents: substanceEquivalents(), empty until loaded.
export function substanceAuthorizedCount(key, substances, equivalents) {
  const substance = substances.get(key);
  if (!substance) return 0;
  return substanceGroup(substance.products, siblingSubstances(key, substances, equivalents)).authorized.length;
}
