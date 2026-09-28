// Pure: companies (companies part 2; user decisions 2026-09-28). companies.json holds one row per
// company (the spellings and legal entities of a holder name folded) and per group (the current
// owner); ema_medicine_companies.json one row per medicine: EMA's holder name (holder_ema, always
// shown), the Union Register's when it decided, and the medicine's company and group. The company
// tree: group › company › EMA holder name, a level left out where its one row repeats the name
// above ("4SC AG" › "4SC AG" shows once). Tree rows are keyed by their path ("g.roche",
// "g.roche/c.roche", "g.roche/c.roche/Roche Registration GmbH"): a company can sit under two
// groups (a medicine went to another owner) and an EMA holder name under two companies (the Union
// Register moved some of its medicines). Medicines EMA names no holder for (the Union Register
// named one) have no holder row: they count at their company's row (a static "No EMA holder name"
// row under it when it has holder rows). Filter values (state.mah): group keys, company keys and
// EMA holder names (older links carry those), and, for a row whose value also shows elsewhere, the
// row's path, so a row selects exactly the medicines it counts; combined with OR. No DOM.
import { NOT_STATED, UI } from "./labels.js";
import { MAX_SUGGESTIONS, MIN_QUERY, foldSearchText, matchesWords, queryWords, searchWords } from "./search.js";

// Group and company keys are id-safe slugs ("g.<slug>", "c.<slug>"), so "/" only separates a
// row path; an EMA holder name, last, may contain it.
const SEP = "/";
const PATH = /^(g\.[a-z0-9-]+)\/(c\.[a-z0-9-]+)(?:\/(.+))?$/s;
const NONE = new Set();
// Suffix of the count key of the medicines at a row without a holder row (the tree's static row).
const NO_HOLDER = "#no-holder";

// A path filter value ("g.organon/c.merck-sharp-dohme", "g.viatris/c.mylan/Mylan S.A.S") as its
// parts, or null for a group key, company key or EMA holder name.
export function companyPath(value) {
  const match = PATH.exec(value);
  return match ? { group: match[1], company: match[2], holder: match[3] ?? null } : null;
}

// Whether a product (buildProducts(): mah, company_key, group_key) is under a filter value.
export function matchesCompany(value, product) {
  const path = companyPath(value);
  if (!path) return product.mah === value || product.company_key === value || product.group_key === value;
  return product.group_key === path.group && product.company_key === path.company && (path.holder === null || product.mah === path.holder);
}

function pushTo(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function addTo(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

// Distinct values, most common first (ties by name).
function byFrequency(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b)).map(([value]) => value);
}

const distinct = (values) => [...new Set(values)];

// companyRows: companies.json; medicineRows: ema_medicine_companies.json. isAuthorized(number):
// the medicine counts as authorized (the search's counts).
export function buildCompanies(companyRows, medicineRows, { isAuthorized = () => false } = {}) {
  const rows = new Map(companyRows.map((row) => [row.key, row]));
  const byProduct = new Map(medicineRows.map((row) => [row.ema_product_number, row]));
  // group -> company -> EMA holder name (null: EMA names none) -> product numbers.
  const paths = new Map();
  const groupsOf = new Map(); // company key or holder name -> groups
  const pathsOf = new Map(); // group key, company key or holder name -> its paths ("g", "g/c", "g/c/h")
  const numbersOf = new Map(); // any filter value, paths too -> product numbers
  for (const row of medicineRows) {
    const number = row.ema_product_number;
    const holder = row.holder_ema ?? null;
    pushTo(numbersOf, holder ?? NOT_STATED, number); // older links: "Not stated" filters by EMA's field
    if (!row.group_key || !row.company_key) continue;
    const [group, company] = [row.group_key, row.company_key];
    if (!paths.has(group)) paths.set(group, new Map());
    const companies = paths.get(group);
    if (!companies.has(company)) companies.set(company, new Map());
    pushTo(companies.get(company), holder, number);
    const companyPathKey = `${group}${SEP}${company}`;
    for (const value of [group, company, companyPathKey]) pushTo(numbersOf, value, number);
    addTo(pathsOf, group, group);
    addTo(pathsOf, company, companyPathKey);
    addTo(groupsOf, company, group);
    if (holder !== null) {
      const holderPathKey = `${companyPathKey}${SEP}${holder}`;
      pushTo(numbersOf, holderPathKey, number);
      addTo(pathsOf, holder, holderPathKey);
      addTo(groupsOf, holder, group);
    }
  }
  const pathOfValue = (value) => companyPath(value);
  const name = (value) => {
    if (rows.has(value)) return rows.get(value).name;
    const path = pathOfValue(value);
    return path ? name(path.holder ?? path.company) : value;
  };
  const kindOf = (value) => {
    if (rows.has(value)) return rows.get(value).kind;
    if (!numbersOf.has(value)) return null;
    const path = pathOfValue(value);
    return path && path.holder === null ? "company" : "holder";
  };
  const companiesIn = (group) => [...(paths.get(group)?.keys() ?? [])];
  // The EMA holder names under a company in a group (not the medicines EMA names none for).
  const holdersIn = (group, company) => [...(paths.get(group)?.get(company)?.keys() ?? [])].filter((holder) => holder !== null);
  // Shown once: a group whose one company has its name, a company whose one holder name is its own
  // (unless EMA names none for some of its medicines: the name's row then holds only its own), or
  // that has none.
  const groupFolds = (group) => {
    const companies = companiesIn(group);
    return companies.length === 1 && name(companies[0]) === name(group);
  };
  const companyFolds = (group, company) => {
    const holders = holdersIn(group, company);
    const unnamed = paths.get(group)?.get(company)?.has(null);
    return holders.length === 0 || (holders.length === 1 && holders[0] === name(company) && !unnamed);
  };

  // The tree's rows: path key -> { value (the group key, company key or holder name it shows),
  // parent (row key or null), children, below: the filter values under it }; each path
  // ("g", "g/c", "g/c/h") -> the row that shows it (a folded level: the row above).
  const tree = new Map();
  const ROOT = null;
  const topRows = [];
  const rowOfPath = new Map();
  const addRow = (key, parent, value) => {
    tree.set(key, { key, parent, value, children: [], below: new Set() });
    if (parent === ROOT) topRows.push(key);
    else tree.get(parent).children.push(key);
  };
  // A product's rows (group, company and holder name as far as the tree shows them) and count keys
  // (its rows, and the static row of a company row it is at without a holder row).
  const rowKeysOf = new Map();
  const countKeysOf = new Map();
  for (const [group, companies] of paths) {
    addRow(group, ROOT, group);
    rowOfPath.set(group, group);
    const folded = groupFolds(group);
    for (const [company, holders] of companies) {
      const companyRow = folded ? group : `${group}${SEP}${company}`;
      if (!folded) addRow(companyRow, group, company);
      rowOfPath.set(`${group}${SEP}${company}`, companyRow);
      const companyFolded = companyFolds(group, company);
      for (const [holder, numbers] of holders) {
        const holderRow = holder === null ? null : `${group}${SEP}${company}${SEP}${holder}`;
        if (holderRow) {
          if (!companyFolded) addRow(holderRow, companyRow, holder);
          rowOfPath.set(holderRow, companyFolded ? companyRow : holderRow);
        }
        const keys = distinct([group, companyRow, ...(holderRow && !companyFolded ? [holderRow] : [])]);
        const countKeys = holderRow === null && !companyFolded ? [...keys, `${companyRow}${NO_HOLDER}`] : keys;
        for (const number of numbers) {
          rowKeysOf.set(number, keys);
          countKeysOf.set(number, countKeys);
        }
      }
    }
  }
  const rowCounts = new Map();
  for (const keys of rowKeysOf.values()) for (const key of keys) rowCounts.set(key, (rowCounts.get(key) ?? 0) + 1);
  // A row's filter value: the value it shows when the row holds all of its medicines, else the
  // row's path (Organon's "Merck Sharp & Dohme B.V." row: "g.organon/c.merck-sharp-dohme").
  const rowValue = (key) => {
    const row = tree.get(key);
    if (!row) return null;
    return (numbersOf.get(row.value)?.length ?? 0) === rowCounts.get(key) ? row.value : key;
  };
  const rowAncestors = (key) => {
    const above = [];
    for (let parent = tree.get(key)?.parent ?? ROOT; parent !== ROOT; parent = tree.get(parent).parent) above.unshift(parent);
    return above;
  };
  // The rows standing for a filter value: a path's row; a group's, a company's (one per group) or a
  // holder name's (one per company); none for a value without a company ("Not stated").
  const rowsFor = (value) => {
    if (rowOfPath.has(value)) return [rowOfPath.get(value)];
    if (pathOfValue(value)) return [];
    return distinct([...(pathsOf.get(value) ?? [])].map((path) => rowOfPath.get(path)));
  };
  // The values above a row that include it (a folded company too: its medicines include the row's).
  const valuesAbove = (key) => {
    const parts = companyPath(key);
    if (!parts) return [];
    return parts.holder === null ? [parts.group] : [parts.group, parts.company, `${parts.group}${SEP}${parts.company}`];
  };
  // Every path, its value and its row's filter value is below the rows above that row.
  for (const [path, key] of rowOfPath) {
    const parts = companyPath(path);
    const values = [path, rowValue(key), ...(parts ? [parts.holder ?? parts.company] : [])];
    const above = path === key ? rowAncestors(key) : [...rowAncestors(key), key];
    for (const row of above) for (const value of values) if (value !== rowValue(row)) tree.get(row).below.add(value);
  }

  // The ownership notes behind a group (companies.json ownership: each curated member's note, and a
  // renamed sponsor's old name, with its evidence), or behind a company: its groups' notes on its own
  // names, and every note of a group it alone makes up (an old name need not be a holder name of its
  // medicines: AcelRx, Talphera's); the holders of one note together, in the data's order:
  // [{ holders, note, url }]. None in older data files.
  const ownershipOf = (key) => {
    const row = rows.get(key);
    if (!row) return [];
    const groups = row.kind === "group" ? [row] : distinct([...(groupsOf.get(key) ?? []), row.group_key]).map((group) => rows.get(group)).filter(Boolean);
    const names = row.kind === "group" ? null : new Set([row.name, ...(row.member_holders ?? [])]);
    const alone = (group) => companiesIn(group.key).length === 1 && companiesIn(group.key)[0] === key;
    const notes = new Map();
    for (const group of groups) {
      for (const item of group.ownership ?? []) {
        if (!item?.note || (names && !names.has(item.holder) && !alone(group))) continue;
        const id = `${item.note}\n${item.evidence_url ?? ""}`;
        if (!notes.has(id)) notes.set(id, { holders: [], note: item.note, url: item.evidence_url ?? null });
        if (!notes.get(id).holders.includes(item.holder)) notes.get(id).holders.push(item.holder);
      }
    }
    return [...notes.values()];
  };
  const oldNames = (key) => ownershipOf(key).flatMap((item) => item.holders);

  // Search names per row, as their words (matched by word start, as the Companies suggestions): its
  // name; a company's also its other spellings (holder names folded into it that no row below it
  // shows: older names, the Union Register's) and old names (ownership notes); a group's also its
  // monogram (companyTreeSearch()), when its one company is folded into it that company's names,
  // and the old names of its notes no company's (an old name a row shows stays that row's match).
  const holdersOfCompany = (company) => new Set([...(groupsOf.get(company) ?? [])].flatMap((group) => holdersIn(group, company)));
  const companyNames = (company) => {
    const shown = holdersOfCompany(company);
    return [name(company), ...[...(rows.get(company)?.member_holders ?? []), ...oldNames(company)].filter((holder) => !shown.has(holder))];
  };
  const groupOldNames = (group) => {
    const known = new Set(companiesIn(group).flatMap((company) => [...companyNames(company), ...holdersIn(group, company)]));
    return oldNames(group).filter((holder) => !known.has(holder));
  };
  const searchTokens = new Map([...tree.values()].map((row) => {
    const kind = kindOf(row.value);
    let names = [name(row.value)];
    if (kind === "company") names = companyNames(row.value);
    if (kind === "group") names = [...names, ...(groupFolds(row.value) ? companyNames(companiesIn(row.value)[0]) : []), ...groupOldNames(row.value)];
    return [row.key, [...new Set(names)].map(searchWords)];
  }));

  const authorizedOf = (value) => (numbersOf.get(value) ?? []).filter(isAuthorized).length;
  // Search entries per group: its name, monogram, and the other names that lead to it (its
  // companies, their spellings, the EMA holder names of its medicines and the old names of its
  // ownership notes: "acelrx" finds Talphera).
  const searchEntries = [...paths.keys()].map((group) => {
    const others = new Set([...(rows.get(group)?.member_holders ?? []), ...oldNames(group)]);
    for (const company of companiesIn(group)) {
      for (const other of [name(company), ...(rows.get(company)?.member_holders ?? [])]) others.add(other);
      for (const holder of holdersIn(group, company)) others.add(holder);
    }
    others.delete(name(group));
    return {
      key: group,
      name: name(group),
      folded: foldSearchText(name(group)),
      tokens: searchWords(name(group)),
      monogram: rows.get(group)?.monogram ?? null,
      // Step 2 (#4): only a curated monogram names its group (derived ones read as abbreviations:
      // "ALL", "CAR", "TB"); rows without monogram_source (older data files) count as derived.
      monogramCurated: rows.get(group)?.monogram_source === "curated",
      others: [...others].sort().map((other) => ({ name: other, folded: foldSearchText(other), tokens: searchWords(other) })),
      count: numbersOf.get(group)?.length ?? 0,
      authorized: authorizedOf(group),
    };
  });

  // The filter values of the rows showing a company (holder: one of its EMA holder names) in some
  // groups: exactly those medicines.
  const valuesOf = (groups, company, holder = null) => distinct(groups
    .map((group) => rowOfPath.get(holder === null ? `${group}${SEP}${company}` : `${group}${SEP}${company}${SEP}${holder}`))
    .filter(Boolean)
    .map(rowValue)).sort();

  const companies = {
    // companies.json rows, and the latest curation date of the groups (their "as of").
    row: (key) => rows.get(key) ?? null,
    asOf: [...rows.values()].filter((row) => row.kind === "group" && row.sources.includes("curated")).map((row) => row.as_of).sort().at(-1) ?? null,
    // A value's name (a path's: its last part's), and its label where no group shows beside it
    // (the filter sentence): a path's with its group, "Merck Sharp & Dohme B.V. (Organon)"; an EMA
    // holder name said as one, as a company can have the same name ("Roche Registration GmbH").
    name,
    label: (value) => {
      const path = pathOfValue(value);
      const group = path ? name(path.group) : null;
      if (kindOf(value) === "holder" && value !== NOT_STATED) return UI.companies.holderValue(name(value), group);
      return path ? UI.companies.inGroup(name(value), group) : name(value);
    },
    // "group" | "company" | "holder" | null (not in the data).
    kind: kindOf,
    has: (value) => kindOf(value) !== null,
    // The company page a value opens: a group's or company's own (a path's company), or null.
    pageOf: (value) => {
      const path = pathOfValue(value);
      if (path) return path.holder === null ? path.company : null;
      return ["group", "company"].includes(kindOf(value)) ? value : null;
    },
    // Every filter value: group and company keys, EMA holder names, paths.
    values: () => [...numbersOf.keys()],
    // A medicine's holder: { holder (EMA's name; null when EMA names none), register (the Union
    // Register's, when it decided), basis, company, group (companies.json rows; null without a
    // holder), moved (a per-medicine row put it under its group: source "curated_medicine"), and
    // the provenance (null in older data files): groupNote and groupEvidenceUrl (moved: why it is
    // under its group; else a plain note on its later ownership, curated_medicine_notes()),
    // sponsorNote and sponsorEvidenceUrl (a curated sponsor behind a regulatory representative),
    // sponsorRenameEvidenceUrl (that sponsor renamed since: the rename's evidence, as its note
    // names it as it was then, "AcelRx (renamed Talphera in 2024)") }, or null.
    entry(number) {
      const row = byProduct.get(number);
      if (!row) return null;
      return {
        holder: row.holder_ema ?? null,
        register: row.holder_register ?? null,
        basis: row.holder_basis ?? null,
        company: rows.get(row.company_key) ?? null,
        group: rows.get(row.group_key) ?? null,
        moved: row.source === "curated_medicine",
        groupNote: row.group_note ?? null,
        groupEvidenceUrl: row.group_evidence_url ?? null,
        sponsorNote: row.sponsor_note ?? null,
        sponsorEvidenceUrl: row.sponsor_evidence_url ?? null,
        sponsorRenameEvidenceUrl: row.sponsor_rename_evidence_url ?? null,
      };
    },
    // A group's or company's ownership notes (ownershipOf()).
    ownership: ownershipOf,
    numbersOf: (value) => numbersOf.get(value) ?? [],
    // A company all of whose medicines a per-medicine row put under another owner's group: its
    // medicines are there, the company is not part of it (Mallinckrodt Deutschland's Optimark).
    allMoved: (key) => rows.get(key)?.kind === "company" && (numbersOf.get(key) ?? []).length > 0
      && numbersOf.get(key).every((number) => byProduct.get(number)?.source === "curated_medicine"),
    // The groups a value's medicines are in.
    groupsOf: (value) => {
      if (kindOf(value) === "group") return new Set([value]);
      const path = pathOfValue(value);
      if (path) return numbersOf.has(value) ? new Set([path.group]) : NONE;
      return groupsOf.get(value) ?? NONE;
    },
    // The joint ventures a group is a partner in.
    jointVentures: (group) => [...rows.values()].filter((row) => row.kind === "group" && row.partners.includes(group)).map((row) => row.key).sort(),
    // A group's (or a company's) companies and their EMA holder names, most medicines first, each
    // with the filter values selecting exactly its medicines there (a company's in every group):
    // [{ key, count, values, holders: [{ name, count, values }], unnamed }]. A company's count
    // includes the medicines EMA names no holder for (unnamed).
    structure(value) {
      const kind = kindOf(value);
      const companyKeys = kind === "group" ? companiesIn(value) : kind === "company" ? [value] : [];
      return companyKeys.map((company) => {
        const groups = kind === "group" ? [value] : [...(groupsOf.get(company) ?? [])];
        const counts = new Map();
        for (const group of groups) {
          for (const [holder, numbers] of paths.get(group)?.get(company) ?? []) counts.set(holder, (counts.get(holder) ?? 0) + numbers.length);
        }
        const holders = [...counts].filter(([holder]) => holder !== null)
          .map(([holder, count]) => ({ name: holder, count, values: valuesOf(groups, company, holder) }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        const count = [...counts.values()].reduce((sum, item) => sum + item, 0);
        return { key: company, count, values: valuesOf(groups, company), holders, unnamed: counts.get(null) ?? 0 };
      }).sort((a, b) => b.count - a.count || name(a.key).localeCompare(name(b.key)));
    },

    // The company tree (company-tree.js): a product's count keys (the facet counts), the rows under
    // a row (null: the groups), a row's filter value, parent and ancestors (top first).
    countKeys: (product) => countKeysOf.get(product.ema_product_number) ?? [],
    // The count key of the medicines at a row without a holder row (its static row).
    noHolderKey: (key) => `${key}${NO_HOLDER}`,
    rows: (parent) => [...(parent === ROOT ? topRows : tree.get(parent)?.children ?? [])],
    rowValue,
    // The value a row shows (its name's), whatever it selects.
    rowShows: (key) => tree.get(key)?.value ?? null,
    rowParent: (key) => tree.get(key)?.parent ?? null,
    rowAncestors,
    isLeafRow: (key) => (tree.get(key)?.children.length ?? 0) === 0,
    // Whether a row repeats the name of the row above it: an EMA holder name that is its company's
    // own name, among its other holder names ("Roche Registration GmbH" under the company of that
    // name); the tree and the company page show it as the same name.
    repeatsParent: (key) => {
      const row = tree.get(key);
      const parent = row && row.parent !== ROOT ? tree.get(row.parent) : null;
      return Boolean(parent) && name(row.value) === name(parent.value);
    },
    searchTokens: (key) => searchTokens.get(key) ?? [],
    monogram: (key) => (kindOf(key) === "group" && rows.get(key).monogram ? foldSearchText(rows.get(key).monogram) : null),
    // The rows standing for a filter value, and the rows above them (opened when it is selected).
    rowsShowing: rowsFor,
    levelsAbove: (value) => distinct(rowsFor(value).flatMap(rowAncestors)),
    // A row's checkbox against the selection: "checked", "included" (a value above it is
    // selected: checked and disabled), "mixed" (a value under it is) or "unchecked".
    checkState(key, selected) {
      const row = tree.get(key);
      if (!row) return "unchecked";
      if (selected.includes(rowValue(key)) || selected.includes(row.value)) return "checked";
      if (valuesAbove(key).some((value) => selected.includes(value))) return "included";
      if (selected.some((value) => row.below.has(value))) return "mixed";
      return "unchecked";
    },
    // The selected value above a row that includes it, or null.
    includedIn: (key, selected) => valuesAbove(key).find((value) => selected.includes(value)) ?? null,
    // The values a value is selected as: the filter values of the rows standing for it (a company
    // shown as its group; a company under two groups as each row's path), or itself when no row
    // does (a holder name of medicines without any company; a path not in the data).
    canonical(value) {
      const keys = rowsFor(value);
      return keys.length ? distinct(keys.map(rowValue)).sort() : [value];
    },
    // The values whose medicines include all of this value's (a filter value under them is dropped):
    // the filter values of the rows above the rows standing for it.
    ancestors(value) {
      const numbers = numbersOf.get(value) ?? [];
      const candidates = distinct(rowsFor(value).flatMap(rowAncestors).map(rowValue)).filter((other) => other !== value);
      const within = candidates.filter((other) => {
        const theirs = new Set(numbersOf.get(other) ?? []);
        return numbers.every((number) => theirs.has(number));
      });
      return within.length ? new Set(within) : NONE;
    },
    // The breakdown's levels (by filter value): the path of a value, top first, and its parent.
    pathOf(value) {
      const [row] = rowsFor(value);
      return row ? [...rowAncestors(row), row].map(rowValue) : [value];
    },
    // Search suggestions (suggestCompanies()).
    searchEntries,
  };
  companies.parentOf = (value) => companies.pathOf(value).at(-2) ?? null;
  // The name of a selection of several values that are exactly the rows of one company or EMA
  // holder name (a company under two groups: "?mah=c.mylan" loads as both rows; a holder name said
  // as one, as companies.label()), else null.
  companies.selectionName = (values) => {
    const path = pathOfValue(values[0] ?? "");
    const whole = path ? path.holder ?? path.company : null;
    const keys = whole === null ? [] : companies.canonical(whole);
    if (!(keys.length > 1 && keys.length === values.length && keys.every((key) => values.includes(key)))) return null;
    return path.holder === null ? name(whole) : UI.companies.holderValue(whole);
  };
  // A product's filter value one level below a breakdown value (null: the groups), or null when
  // it is not under the value or at the value's row itself (EMA names no holder); null instead of a
  // function when the value is a leaf: a group's companies (its holder names when its one company is
  // folded into it), a company's holder names (none when its one holder name is its own).
  companies.childOf = (value) => {
    const parents = value === null ? null : new Set(rowsFor(value));
    if (parents && ![...parents].some((key) => tree.get(key).children.length)) return null;
    return (product) => {
      const keys = rowKeysOf.get(product.ema_product_number) ?? [];
      const child = parents === null ? keys[0] : keys.find((key) => parents.has(tree.get(key).parent));
      return child === undefined ? null : rowValue(child);
    };
  };
  return companies;
}

// The rows of a selection and the tree's rows (counts: row key -> medicines): those with medicines,
// plus the rows showing a selected value and the rows above them, so a selection always shows.
export function companyTreeRows(companies, counts, selected) {
  const keys = new Set([...counts].filter(([key, count]) => count > 0 && companies.rowValue(key) !== null).map(([key]) => key));
  for (const value of selected) {
    for (const row of companies.rowsShowing(value)) {
      keys.add(row);
      for (const above of companies.rowAncestors(row)) keys.add(above);
    }
  }
  return keys;
}

// The rows under parent (null: the groups) that are shown, most medicines first (ties by name).
export function companyTreeChildren(companies, parent, visible, counts) {
  const nameOf = (key) => companies.name(companies.rowShows(key));
  return companies.rows(parent)
    .filter((key) => visible.has(key))
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || nameOf(a).localeCompare(nameOf(b)) || a.localeCompare(b));
}

// Names match a search from this many characters (a monogram from its first).
const SEARCH_MIN = 3;

// The tree searched (not filtered), as the therapeutic area tree: matches = the top matching group
// and company rows (a row under a matching one is not a match of its own; names by word start, as
// the Companies suggestions, so "roche" is not Neurochem; a group also by its monogram), then the
// holder names matching where their row is not already shown by a match; open = the levels above
// them; shows(parent, key): whether a row shows. null for a blank query.
export function companyTreeSearch(companies, visible, query) {
  const needle = foldSearchText(query);
  if (!needle) return null;
  const words = queryWords(query);
  const named = (key) => needle.length >= SEARCH_MIN && words.length > 0 && companies.searchTokens(key).some((tokens) => matchesWords(tokens, words, false));
  const hit = (key) => named(key) || companies.monogram(companies.rowShows(key)) === needle;
  const nodes = [...visible].filter((key) => !companies.isLeafRow(key));
  const hits = new Set(nodes.filter(hit));
  const matchNodes = [...hits].filter((key) => !companies.rowAncestors(key).some((above) => hits.has(above)));
  const matched = new Set(matchNodes);
  const covered = (key) => key !== null && (matched.has(key) || companies.rowAncestors(key).some((above) => matched.has(above)));
  const open = new Set(matchNodes.flatMap(companies.rowAncestors));
  const leaves = [...visible].filter((key) => companies.isLeafRow(key) && !covered(companies.rowParent(key)) && hit(key));
  for (const key of leaves) for (const above of companies.rowAncestors(key)) open.add(above);
  const matchedLeaves = new Set(leaves);
  return {
    matches: [...matchNodes, ...leaves],
    open,
    shows: (parent, key) => (companies.isLeafRow(key) ? covered(parent) || matchedLeaves.has(key) : open.has(key) || covered(key)),
  };
}

// The selection after one value is toggled, as its canonical values: selected ones are removed;
// otherwise they are added in place of the selected values they include or are included in, so
// none includes another.
export function toggleCompany(companies, selected, value) {
  const keys = companies.canonical(value);
  if (keys.every((key) => selected.includes(key))) return selected.filter((key) => !keys.includes(key));
  const related = (other) => keys.some((key) => key === other || companies.ancestors(key).has(other) || companies.ancestors(other).has(key));
  return [...selected.filter((other) => !related(other)), ...keys];
}

// The EMA holder names of some products (their mah), most common first; none for the medicines
// EMA names no holder for.
export function holderNames(products) {
  return byFrequency(products.map((product) => product.mah).filter((name) => name !== NOT_STATED));
}

// The EMA holder names behind a bar, row or legend entry named label (holderNames()); none when
// they only repeat that name ("Teva B.V., 38 medicines: Teva B.V.").
export function namesBehind(label, products) {
  const names = holderNames(products);
  return names.length === 1 && names[0] === label ? [] : names;
}

// The breakdown's rows one level below a value (the groups for null; companies.childOf()): products
// per child (each once), most first (ties by name), the top n then one Other row counting each
// product in the rest once; each row with the EMA holder names of its products (names; none when
// they only repeat the row's name, namesBehind()); then a
// static row of the value's medicines EMA names no holder for (no holder row holds them). A leaf
// value has none: the breakdown shows it alone.
export function companyBreakdownRows(companies, current, products, n = 20) {
  const childOf = companies.childOf(current);
  if (!childOf) return [];
  const byChild = new Map();
  let exact = 0;
  for (const product of products) {
    const child = childOf(product);
    if (child !== null && child !== undefined) pushTo(byChild, child, product);
    else if (current !== null && matchesCompany(current, product)) exact += 1;
  }
  const rows = [...byChild]
    .map(([key, members]) => ({ key, label: companies.name(key), count: members.length, names: namesBehind(companies.name(key), members) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  let result = rows;
  if (rows.length > n) {
    const count = rows.slice(n).reduce((sum, row) => sum + row.count, 0);
    result = [...rows.slice(0, n), { key: null, label: UI.other, count, other: true }];
  }
  return exact ? [...result, { key: current, label: UI.companies.noHolder, count: exact, names: [], static: true, incomplete: true }] : result;
}

// "Companies" search suggestions: groups whose name, monogram or other names (their companies,
// spellings and EMA holder names) match the query by word start; ranked name exact > curated
// monogram > name prefix > name words > another name (named as synonym) > derived monogram, then
// authorized medicines. named: the query names the group (its name, curated monogram or another
// name exactly), so Enter opens it. weak: found only through a derived monogram, which Enter never
// opens as the only suggestion (submitChoice()).
export function suggestCompanies(companies, query) {
  const folded = foldSearchText(query);
  const words = queryWords(query);
  if (folded.length < MIN_QUERY || words.length === 0) return [];
  const found = [];
  for (const entry of companies.searchEntries) {
    let rank = null;
    let synonym = null;
    const monogram = entry.monogram && foldSearchText(entry.monogram) === folded;
    if (entry.folded === folded) rank = 0;
    else if (monogram && entry.monogramCurated) rank = 1;
    else if (entry.folded.startsWith(folded)) rank = 2;
    else if (matchesWords(entry.tokens, words, false)) rank = 3;
    else {
      const other = entry.others.find((item) => item.folded === folded) ?? entry.others.find((item) => matchesWords(item.tokens, words, false));
      if (other) [rank, synonym] = [other.folded === folded ? 4 : 5, other.name];
      else if (monogram) rank = 6;
    }
    if (rank !== null) {
      found.push({ key: entry.key, name: entry.name, monogram: entry.monogram, synonym, named: [0, 1, 4].includes(rank), weak: rank === 6, rank, count: entry.count, authorized: entry.authorized });
    }
  }
  return found
    .sort((a, b) => a.rank - b.rank || b.authorized - a.authorized || a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ rank, ...row }) => row);
}
