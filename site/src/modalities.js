// Pure: the modality taxonomy (M2 phase 2, spec 2026-09-29; modalities.json): groups › modalities
// in tree order, and each medicine's modalities (ema_medicine_modalities.json: one row per medicine
// and substance, each with its source). Small molecule is a group without modalities under it: its
// rows carry modality "small_molecule", so a null modality always means "group only". A medicine
// counts once in every group and modality its substances have (children need not add up). Names
// and explainers are UI copy (labels.js UI.modalities, UI.modalityTips). No DOM.
import { UI } from "./labels.js";
import { foldSearchText } from "./search.js";

// The static rows' key for the medicines no source classifies (the tree's last row, a breakdown
// row, a stack segment). A group's key stands for its "not more specific" row in the exact keys.
export const NOT_CLASSIFIED = "__not_classified__";

// rows: modalities.json ({ key, kind: "group" | "modality", group_key, order }).
export function buildModalityTree(rows) {
  const sorted = [...rows].sort((a, b) => a.order - b.order);
  const roots = sorted.filter((row) => row.kind === "group").map((row) => row.key);
  const children = new Map(roots.map((key) => [key, []]));
  const parents = new Map();
  for (const row of sorted) {
    if (row.kind === "group" || !children.has(row.group_key)) continue;
    children.get(row.group_key).push(row.key);
    parents.set(row.key, row.group_key);
  }
  const keys = sorted.map((row) => row.key).filter((key) => children.has(key) || parents.has(key));
  const known = new Set(keys);
  const parent = (key) => parents.get(key) ?? null;
  // A row's group and modality as the tree has them: an unknown group is none (not classified), a
  // modality outside its group none (group only).
  const groupOf = (row) => (children.has(row.modality_group) ? row.modality_group : null);
  const modalityOf = (row) => {
    const group = groupOf(row);
    if (group === null) return null;
    if (children.get(group).length === 0) return group; // Small molecule is its own modality
    return parent(row.modality) === group ? row.modality : null;
  };
  const tree = {
    roots,
    keys,
    has: (key) => known.has(key),
    isGroup: (key) => children.has(key),
    name: (key) => UI.modalities[key] ?? key,
    // The keys one level below (the groups for null).
    children: (key) => (key === null ? roots : children.get(key) ?? []),
    parent,
    // A modality's group (the tree's included rows, the URL's normalization).
    ancestors: (key) => new Set(parent(key) ? [parent(key)] : []),
    // Group to key.
    path: (key) => (known.has(key) ? [...(parent(key) ? [parent(key)] : []), key] : []),
    groupOf,
    modalityOf,
    // A medicine's keys (rows: its ema_medicine_modalities rows): every group and modality.
    keysOf: (medicineRows) => {
      const found = new Set();
      for (const item of medicineRows) {
        const group = groupOf(item);
        if (group === null) continue;
        found.add(group);
        const modality = modalityOf(item);
        if (modality !== null) found.add(modality);
      }
      return [...found];
    },
    // The keys of its static rows: a group none of whose sources names the modality (its "not more
    // specific" row), NOT_CLASSIFIED for a substance no source classifies (or no row at all).
    exactOf: (medicineRows) => {
      const found = new Set(medicineRows.length ? [] : [NOT_CLASSIFIED]);
      for (const item of medicineRows) {
        const group = groupOf(item);
        if (group === null) found.add(NOT_CLASSIFIED);
        else if (modalityOf(item) === null) found.add(group);
      }
      return [...found];
    },
  };
  return tree;
}

// The hidden element holding a modality's explainer, which its focusable carriers (tree rows, the
// sentence's token, breakdown bars) name with aria-describedby: keys are id-safe.
export const modalityTipId = (key) => `modality-tip-${key}`;

// A group's or modality's explainer and the id of its hidden copy, or null for an unknown key.
export function modalityTip(key) {
  return UI.modalityTips[key] ? { text: UI.modalityTips[key], id: modalityTipId(key) } : null;
}

// A tree row's checkbox against the selection (state.mod): "checked", "included" (under a checked
// group: shown checked and disabled), "mixed" (a checked modality is under it) or "unchecked".
export function modalityCheckState(tree, key, selected) {
  if (selected.includes(key)) return "checked";
  if (modalityIncludedIn(tree, key, selected) !== null) return "included";
  if (selected.some((value) => tree.parent(value) === key)) return "mixed";
  return "unchecked";
}

// The selected group that includes key, or null.
export function modalityIncludedIn(tree, key, selected) {
  const group = tree.parent(key);
  return group !== null && selected.includes(group) ? group : null;
}

// The selection after one value is toggled (as toggleAtcCode()): a selected value is removed;
// another is added in place of the selected values it covers or is covered by.
export function toggleModality(tree, selected, key) {
  if (selected.includes(key)) return selected.filter((value) => value !== key);
  const related = (value) => tree.parent(value) === key || tree.parent(key) === value;
  return [...selected.filter((value) => !related(value)), key];
}

// The tree's rows: the keys with medicines (counts: key -> medicines) plus the selection and the
// groups above it, so a selection always shows.
export function modalityTreeKeys(tree, counts, selected) {
  const keys = new Set(tree.keys.filter((key) => (counts.get(key) ?? 0) > 0));
  for (const value of selected.filter(tree.has)) {
    keys.add(value);
    for (const key of tree.ancestors(value)) keys.add(key);
  }
  return keys;
}

export function modalityTreeChildren(tree, parent, visible) {
  return tree.children(parent).filter((key) => visible.has(key));
}

// Names match a search from this many characters.
const SEARCH_MIN = 3;

// The tree searched (not filtered), by name or key ("adc", "car t"): matches = the matching groups,
// then the matching modalities whose group is not a match; open = their groups; shows(parent,
// key): whether a row shows (a group matching or open; a modality under a matching group, or
// matching itself). null for a blank query.
export function modalityTreeSearch(tree, visible, query) {
  const needle = foldSearchText(query);
  if (!needle) return null;
  const hit = (key) => needle.length >= SEARCH_MIN
    && [tree.name(key), key.replaceAll("_", " ")].some((name) => foldSearchText(name).includes(needle));
  const shown = tree.keys.filter((key) => visible.has(key));
  const groups = new Set(shown.filter((key) => tree.isGroup(key) && hit(key)));
  const modalities = new Set(shown.filter((key) => !tree.isGroup(key) && hit(key) && !groups.has(tree.parent(key))));
  const open = new Set([...modalities].map(tree.parent));
  return {
    matches: shown.filter((key) => groups.has(key) || modalities.has(key)),
    open,
    shows: (parent, key) => (parent === null ? groups.has(key) || open.has(key) : groups.has(parent) || modalities.has(key)),
  };
}

// The breakdown's rows one level below parent (the groups for null): medicines per child (products:
// { modalityKeys, modalityExact }), most first (ties in tree order; rank: a row's place in tree
// order, sortBreakdownRows()), then a static row: the medicines not classified (top level) or those
// of the group no source names the modality of. A modality, or a group without modalities, has
// none: the breakdown shows it alone.
export function modalityBreakdownRows(tree, parent, products) {
  const children = tree.children(parent);
  if (parent !== null && children.length === 0) return [];
  const rank = new Map(children.map((key, index) => [key, index]));
  const counts = new Map();
  for (const product of products) {
    for (const key of product.modalityKeys) if (rank.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rows = [...counts]
    .map(([key, count]) => ({ key, label: tree.name(key), count, rank: rank.get(key) }))
    .sort((a, b) => b.count - a.count || a.rank - b.rank);
  const staticKey = parent ?? NOT_CLASSIFIED;
  const exact = products.filter((product) => product.modalityExact.includes(staticKey)).length;
  if (exact === 0) return rows;
  const label = parent === null ? UI.modality.notClassified : UI.modality.notMoreSpecific;
  return [...rows, { key: staticKey, label, count: exact, static: true, incomplete: true }];
}

// "177lu" -> "177Lu", "99mtc" -> "99mTc"; anything else as written.
const nuclideName = (text) => text.replace(/^(\d+m?)([a-z]{1,2})$/, (match, mass, element) => mass + element.charAt(0).toUpperCase() + element.slice(1));

const httpsOnly = (url) => (typeof url === "string" && url.startsWith("https://") ? url : null);

// A curated row's evidence (evidence_url) named by the document it links to: EMA's product
// information, assessment report (a refusal's too), withdrawal assessment report (Skycovion's is
// filed as a variation report), scientific discussion, questions and answers, CHMP summary of
// opinion or medicine page, a PubMed record, a ChEMBL record; another page by its host. null for a
// value that is not a URL.
export function evidenceDocument(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const { host, pathname } = parsed;
  if (host === "www.ema.europa.eu") {
    if (pathname.includes("/withdrawal-report/") || pathname.includes("withdrawal-assessment-report")) return { kind: "withdrawalReport" };
    if (pathname.includes("/medicine-qa/")) return { kind: "questionsAnswers" };
    if (pathname.includes("/smop")) return { kind: "summaryOfOpinion" };
    if (/\/medicines\/human\/epar\//i.test(pathname)) return { kind: "medicinePage" };
    if (pathname.includes("/product-information/")) return { kind: "productInformation" };
    if (pathname.includes("/scientific-discussion/")) return { kind: "scientificDiscussion" };
    if (pathname.includes("/assessment-report/")) return { kind: pathname.includes("refusal") ? "refusal" : "epar" };
  }
  if (host === "pubmed.ncbi.nlm.nih.gov" && /\d+/.test(pathname)) return { kind: "pubmed", id: pathname.match(/\d+/)[0] };
  if (host === "www.ebi.ac.uk" && /CHEMBL\d+/.test(pathname)) return { kind: "chembl", id: pathname.match(/CHEMBL\d+/)[0] };
  return { kind: "other", host };
}

// A classification's source as the card names it (ema_medicine_modalities.json source, rule and
// evidence; the same for leaf_source and leaf_rule): a WHO INN stem ("stem:-siran"), an INN group
// name ("inn_group:insulin"), a radionuclide in the INN ("inn:radionuclide (177lu)"), a Greek
// letter as the INN's second word, WHO's naming of proteins ("inn:greek second word (alfa)"), a ChEMBL
// record (evidence "CHEMBL941 ChEMBL_37", with a link), a WHO ATC class, EMA's advanced therapy
// flag, EMA text, a row checked by hand (evidence: its URL); any other as its rule. null without a
// source.
export function modalitySource(source, rule, evidence = null) {
  if (!source) return null;
  const colon = rule?.indexOf(":") ?? -1;
  const prefix = colon >= 0 ? rule.slice(0, colon) : rule;
  const detail = colon >= 0 ? rule.slice(colon + 1).trim() : null;
  if (source === "curated") {
    const url = httpsOnly(evidence);
    return { kind: "curated", url, document: url ? evidenceDocument(url) : null };
  }
  if (source === "chembl") {
    const match = /^(CHEMBL\d+)(?:\s+(\S+))?/.exec(evidence ?? "");
    const id = match?.[1] ?? null;
    return {
      kind: "chembl",
      id,
      release: match?.[2] ?? null,
      type: prefix === "chembl" ? detail : null,
      url: id ? `https://www.ebi.ac.uk/chembl/explore/compound/${id}` : null,
    };
  }
  if (source === "atc") return { kind: "atc", code: /^[A-Z]\d{2}/.test(evidence ?? "") ? evidence : detail };
  if (source === "ema_atmp") return { kind: "atmp" };
  if (source === "ema_text") return { kind: "text", detail: detail ?? rule };
  if (source === "inn_stem" && prefix === "stem" && detail) return { kind: "stem", stem: detail.replace(/\s*\(.*\)$/, "") };
  if (source === "inn_stem" && prefix === "inn_group" && detail) return { kind: "innGroup", name: detail };
  const greek = source === "inn_stem" && prefix === "inn" ? /^greek second word \((.+)\)$/.exec(detail ?? "") : null;
  if (greek) return { kind: "greek", letter: greek[1] };
  const nuclide = source === "inn_stem" ? /radionuclide\s*\(([^)]+)\)/.exec(detail ?? "") : null;
  if (nuclide) return { kind: "radionuclide", nuclide: nuclideName(nuclide[1]) };
  return { kind: "other", detail: rule };
}

// A medicine's modalities for its card: one line per distinct (group, modality) of its rows, with
// the substances classified so (a combination of one modality: one line) and the first such row
// (its sources). group null: not classified; modality null: group only; Small molecule: modality
// "small_molecule".
export function modalityLines(tree, rows) {
  if (rows.length === 0) return [{ group: null, modality: null, substances: [], row: null }];
  const lines = new Map();
  for (const item of rows) {
    const group = tree.groupOf(item);
    const modality = tree.modalityOf(item);
    const key = `${group}|${modality}`;
    if (!lines.has(key)) lines.set(key, { group, modality, substances: [], row: item });
    if (item.substance_key) lines.get(key).substances.push(item.substance_key);
  }
  return [...lines.values()];
}
