// Pure: the therapeutic-area tree (phase 4f, user decision): MeSH category › branch › level 2 ›
// level 3, with EMA's therapeutic-area terms as leaves. A category (owner decision 2026-09-29) is
// MeSH's top level, a branch code's letter ("C": Diseases, by NLM's name, UI.areas.categories); the
// tree starts there, the charts at the branches (tree.branches). EMA's terms are MeSH terms: a term
// whose descriptor is a level-2 or level-3 node is that node (no leaf of its own there: exact()), a
// term deeper than level 3 is a leaf under its level-3 node(s); a term can sit under several
// branches and nodes. A term matched at a branch root ("Neoplasms", "Cancer") is a tag of that
// branch (phase 4g, user decision 2026-09-28: rootTerms()), neither a leaf nor the branch itself:
// the branch's static row counts the medicines tagged only with such tags there. Keys: category
// letters ("C"), branch codes ("C04"), tree numbers ("C04.588.180") and EMA's terms ("Psoriasis");
// the filter (state.area) holds any of them, a term that is a node as that key (canonical()). Every
// level in MeSH tree order (owner request 2026-09-28, as the ATC tree by code): categories by
// letter, branches by code, nodes by tree number, a term by its descriptor's tree number under that
// parent (mesh_descriptor_notes.json, which can load later: setNotes()), terms without one last by
// name. No DOM.
import { UI } from "./labels.js";
import { foldSearchText } from "./search.js";

// Tree numbers ("C04.588.180": three-character parts) sort as strings.
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// branchRows: ema_therapeutic_area_branches.json; subtreeRows: ema_therapeutic_area_subtree.json;
// noteRows: mesh_descriptor_notes.json (its tree_numbers order the terms), or null.
export function buildAreaTree(branchRows, subtreeRows, noteRows = null) {
  // key -> { kind: "category" | "branch" | "node" | "term", name, parent (branches, nodes),
  // children, parents (terms), exact (nodes: the terms that are the node), roots (branches: the
  // terms matched at the root), above (terms: every category, branch and node above or at it) }
  const entries = new Map();
  const add = (key, fields) => {
    if (!entries.has(key)) {
      entries.set(key, { key, parent: null, children: new Set(), parents: new Set(), exact: new Set(), roots: new Set(), above: new Set(), ...fields });
    }
    return entries.get(key);
  };
  const descriptorName = new Map();
  const descriptorUi = new Map();
  for (const row of branchRows) {
    if (row.branch === null) continue;
    const category = row.branch[0];
    add(category, { kind: "category", name: UI.areas.categories[category] ?? category });
    add(row.branch, { kind: "branch", name: row.branch_name ?? row.branch, parent: category });
    add(row.therapeutic_area_mesh, { kind: "term", name: row.therapeutic_area_mesh }).above.add(row.branch).add(category);
    descriptorName.set(row.therapeutic_area_mesh, row.mesh_descriptor_name);
    if (row.mesh_descriptor_ui) descriptorUi.set(row.therapeutic_area_mesh, row.mesh_descriptor_ui);
  }
  const rowsByTerm = new Map();
  for (const row of subtreeRows) {
    add(row.node, { kind: "node", name: row.node_name ?? row.node, parent: row.parent });
    const term = entries.get(row.therapeutic_area_mesh);
    if (term?.kind !== "term") continue;
    if (!rowsByTerm.has(term.key)) rowsByTerm.set(term.key, []);
    rowsByTerm.get(term.key).push(row);
  }
  for (const entry of entries.values()) if (entry.kind === "node" || entry.kind === "branch") entries.get(entry.parent)?.children.add(entry.key);
  const place = (parent, term) => {
    entries.get(parent).children.add(term.key);
    term.parents.add(parent);
  };
  for (const term of [...entries.values()].filter((entry) => entry.kind === "term")) {
    const rows = rowsByTerm.get(term.key) ?? [];
    for (const row of rows) {
      term.above.add(row.node);
      if (row.node_name !== null && row.node_name === descriptorName.get(term.key)) entries.get(row.node).exact.add(term.key);
    }
    // Matched at a branch root (no node of that branch above it): a tag of the branch, not a leaf.
    const branches = new Set(rows.map((row) => row.branch));
    for (const key of term.above) {
      if (entries.get(key).kind !== "branch" || branches.has(key)) continue;
      entries.get(key).roots.add(term.key);
      term.parents.add(key);
    }
    // A leaf under each node above it that is not the term itself and has none of its nodes below.
    const parents = new Set(rows.map((row) => row.parent));
    for (const row of rows) if (!entries.get(row.node).exact.has(term.key) && !parents.has(row.node)) place(row.node, term);
  }

  // A child's place under parent: a branch's or node's key; a term's descriptor's tree number under
  // parent (the smallest there), else null (last, by name).
  let termNumbers = new Map();
  const numberUnder = (key, parent) => (entries.get(key).kind !== "term" ? key
    : (termNumbers.get(key) ?? []).filter((number) => number === parent || number.startsWith(`${parent}.`)).sort(byCode)[0] ?? null);
  // The number a row shows (owner decision 2026-09-29): as numberUnder(), but a term's strictly
  // below parent, so a root tag (its descriptor is the branch) shows none of its own.
  const number = (key, parent = null) => {
    if (!entries.has(key)) return null;
    const found = numberUnder(key, parent);
    return found === parent ? null : found;
  };
  const treeOrder = (parent) => (a, b) => {
    const [first, second] = [numberUnder(a, parent), numberUnder(b, parent)];
    if (first !== null && second !== null && first !== second) return byCode(first, second);
    if ((first === null) !== (second === null)) return first === null ? 1 : -1;
    return entries.get(a).name.localeCompare(entries.get(b).name) || byCode(a, b);
  };
  let children = new Map();
  const setNotes = (rows) => {
    const numbersByUi = new Map((rows ?? []).filter((row) => row.mesh_descriptor_ui).map((row) => [row.mesh_descriptor_ui, row.tree_numbers ?? []]));
    termNumbers = new Map([...descriptorUi].map(([term, ui]) => [term, numbersByUi.get(ui) ?? []]));
    children = new Map([...entries.values()].map((entry) => [entry.key, [...entry.children].sort(treeOrder(entry.key))]));
  };
  setNotes(noteRows);
  const parents = new Map([...entries.values()].map((entry) => [entry.key, entry.kind === "term" ? [...entry.parents].sort() : entry.parent ? [entry.parent] : []]));
  const ancestors = new Map();
  for (const entry of entries.values()) {
    if (entry.kind === "term") {
      ancestors.set(entry.key, entry.above);
      continue;
    }
    const chain = new Set();
    for (let parent = entry.parent; parent && entries.has(parent); parent = entries.get(parent).parent) chain.add(parent);
    ancestors.set(entry.key, chain);
  }
  // Folded names a search matches: a node's own and those of the terms that are it (a branch's: its
  // root tags, so "cancer" finds Neoplasms).
  const searchNames = new Map([...entries.values()].map((entry) => [entry.key, [entry.name, ...entry.exact, ...entry.roots].map(foldSearchText)]));
  // term -> the nodes it is (one descriptor can have several tree numbers), sorted.
  const nodesOf = new Map();
  for (const entry of entries.values()) for (const term of entry.exact) nodesOf.set(term, [...(nodesOf.get(term) ?? []), entry.key].sort());
  // branch -> its root tags: the heading first (its name is the descriptor's), then by name.
  const isHeading = (term) => descriptorName.get(term) === term;
  const rootTerms = new Map([...entries.values()].map((entry) => [
    entry.key,
    [...entry.roots].sort((a, b) => isHeading(b) - isHeading(a) || a.localeCompare(b)),
  ]));
  const rootTags = new Set([...entries.values()].flatMap((entry) => [...entry.roots]));
  const label = (key) => {
    const name = entries.get(key)?.name ?? key;
    return rootTags.has(key) ? UI.areas.tag(name) : name;
  };
  const NONE = new Set();
  // The branches a product's terms touch only through root tags (no more specific term there).
  const rootOnly = (terms) => {
    const branches = new Set(terms.flatMap((term) => [...(ancestors.get(term) ?? NONE)].filter((key) => entries.get(key).roots.has(term))));
    return [...branches].filter((branch) => terms.every((term) => entries.get(branch).roots.has(term) || !(ancestors.get(term) ?? NONE).has(branch)));
  };
  const keysOfKind = (kind) => [...entries.values()].filter((entry) => entry.kind === kind).map((entry) => entry.key).sort(byCode);
  const tree = {
    // The tree's top level: the MeSH categories present, by letter.
    roots: keysOfKind("category"),
    // The charts' top level (breakdown, activity columns; owner decision 2026-09-29): the MeSH
    // branches, by code.
    branches: keysOfKind("branch"),
    names: new Map([...entries.values()].map((entry) => [entry.key, entry.name])),
    has: (key) => entries.has(key),
    isTerm: (key) => entries.get(key)?.kind === "term",
    isCategory: (key) => entries.get(key)?.kind === "category",
    name: (key) => entries.get(key)?.name ?? key,
    // A tag matched at a branch root selected on its own reads as a tag ("tagged Neoplasms"), never
    // as its branch; every other key by its name. Headline, paths, sentence token, activity columns.
    isRootTag: (key) => rootTags.has(key),
    label,
    labels: new Map([...entries.keys()].map((key) => [key, label(key)])),
    // The keys one level below (the categories for null), in tree order.
    children: (key) => (key === null ? tree.roots : children.get(key) ?? []),
    // The descriptors' tree numbers arrived (mesh_descriptor_notes.json rows; null: none): the
    // terms go in tree order.
    setNotes,
    // A row's MeSH tree number (owner decision 2026-09-29: shown as the ATC tree shows its codes): a
    // category's letter, a branch's code, a node's tree number, a term's descriptor's number under
    // parent (the one its place there comes from; null before the notes load or without one).
    number,
    // A term's parents in tree order (a root tag's: its branch); a node's or branch's one parent (a
    // branch's: its category); none for a category.
    parents: (key) => parents.get(key) ?? [],
    parent: (key) => parents.get(key)?.[0] ?? null,
    // The terms that are this node (its "not more specific" medicines).
    exact: (key) => [...(entries.get(key)?.exact ?? [])].sort(),
    // A branch's tags matched at its root (its static row), heading first; none for other keys.
    rootTerms: (key) => rootTerms.get(key) ?? [],
    // Every category, branch and node above (for a term: above or at it), over every path.
    ancestors: (key) => ancestors.get(key) ?? NONE,
    searchNames: (key) => searchNames.get(key) ?? [],
    // A product's tree keys (its terms and everything above them) and the keys of its static rows:
    // the nodes its terms are, and the branches it is tagged only at the root of.
    keysOf: (terms) => [...new Set(terms.flatMap((term) => [term, ...(ancestors.get(term) ?? [])]))],
    exactOf: (terms) => [...new Set([...terms.flatMap((term) => nodesOf.get(term) ?? []), ...rootOnly(terms)])],
    // The keys a value is selected as: a term that is a node is that node (so its leaves elsewhere
    // and the node show one checkbox state); any other value (a root tag too) itself.
    canonical: (key) => nodesOf.get(key) ?? [key],
    // Root to key, through the first parent in tree order.
    path: (key) => {
      const path = [];
      for (let current = key; current !== null && entries.has(current); current = tree.parent(current)) path.unshift(current);
      return path;
    },
  };
  return tree;
}

// A tree row's checkbox against the selection (state.area, canonical keys): "checked" (a term's
// leaf too when the nodes it is are selected), "included" (under a selected node on some path:
// shown checked and disabled), "mixed" (a selected value is under it) or "unchecked".
export function areaCheckState(tree, key, selected) {
  if (tree.canonical(key).every((value) => selected.includes(value))) return "checked";
  if (areaIncludedIn(tree, key, selected) !== null) return "included";
  if (selected.some((value) => tree.ancestors(value).has(key))) return "mixed";
  return "unchecked";
}

// The selected node above key that includes it, or null.
export function areaIncludedIn(tree, key, selected) {
  const above = tree.ancestors(key);
  return selected.find((value) => above.has(value)) ?? null;
}

// The selection after one value is toggled, as its canonical keys (a term that is a node toggles
// that node): selected ones are removed; otherwise they are added in place of the selected values
// they cover or are covered by, so none covers another.
export function toggleArea(tree, selected, key) {
  const keys = tree.canonical(key);
  if (keys.every((value) => selected.includes(value))) return selected.filter((value) => !keys.includes(value));
  const related = (value) => keys.some((other) => other === value || tree.ancestors(other).has(value) || tree.ancestors(value).has(other));
  return [...selected.filter((value) => !related(value)), ...keys];
}

// A term (or node) within the selection: selected itself, or under a selected node.
export function inAreas(tree, selected, key) {
  return selected.includes(key) || areaIncludedIn(tree, key, selected) !== null;
}

// The tree's rows: the keys with medicines (counts: key -> medicines) plus the selection and
// everything above it, so a selection always shows.
export function areaTreeKeys(tree, counts, selected) {
  const keys = new Set([...counts].filter(([key, count]) => count > 0 && tree.has(key)).map(([key]) => key));
  for (const value of selected.filter(tree.has)) {
    keys.add(value);
    for (const key of tree.ancestors(value)) keys.add(key);
  }
  return keys;
}

export function areaTreeChildren(tree, parent, visible) {
  return tree.children(parent).filter((key) => visible.has(key));
}

// A tree number's badge shade (owner decision 2026-09-29, as the ATC code badges' levels): a
// category's letter 1, a branch's code 2, level-2 and level-3 nodes 3 and 4, a term's number 5.
export function areaNumberLevel(number) {
  return number.length === 1 ? 1 : Math.min(5, number.split(".").length + 1);
}

// Names match a search from this many characters; a tree number ("C04.588", any case, a trailing dot
// too) from the first, as a prefix (owner decision 2026-09-29, as the ATC tree's codes).
const SEARCH_MIN = 3;
const TREE_NUMBER = /^[a-z](?:\d{1,3}(?:\.\d{1,3})*\.?)?$/i;

// The tree searched (not filtered): matches = the top matching nodes (a node under a matching one
// is not a match of its own), then the terms matching where their parent is not already shown by a
// match; open = the levels above them; shows(parent, key): whether a row shows (a node when open or
// in a match's subtree; a term under a match, or matching itself). A category (owner decision
// 2026-09-29) matches by its name only when nothing below it does ("anatomy"), so "diseases" still
// finds the branches and nodes named so. A tree number typed as a prefix matches the rows whose
// number starts with it (tree.number(); a term's under each parent). null for a blank query.
export function areaTreeSearch(tree, visible, query) {
  const needle = foldSearchText(query);
  if (!needle) return null;
  const prefix = TREE_NUMBER.test(query.trim()) ? query.trim().toUpperCase() : null;
  const numberHit = (key, parent) => prefix !== null && Boolean(tree.number(key, parent)?.startsWith(prefix));
  const hit = (key) => needle.length >= SEARCH_MIN && tree.searchNames(key).some((name) => name.includes(needle));
  const nodes = [...visible].filter((key) => !tree.isTerm(key));
  const hitBelow = (category) => [...visible].some((key) => key !== category && tree.ancestors(key).has(category) && hit(key));
  const hits = new Set(nodes.filter((key) => numberHit(key) || (hit(key) && !(tree.isCategory(key) && hitBelow(key)))));
  const matchNodes = [...hits].filter((key) => ![...tree.ancestors(key)].some((above) => hits.has(above))).sort();
  const matched = new Set(matchNodes);
  const covered = new Set(nodes.filter((key) => matched.has(key) || [...tree.ancestors(key)].some((above) => matched.has(above))));
  const open = new Set(matchNodes.flatMap((key) => [...tree.ancestors(key)]));
  const leaves = new Set();
  const matchTerms = [];
  for (const term of [...visible].filter((key) => tree.isTerm(key)).sort()) {
    const named = hit(term);
    const places = tree.parents(term).filter((parent) => visible.has(parent) && !covered.has(parent) && (named || numberHit(term, parent)));
    if (!places.length) continue;
    matchTerms.push(term);
    for (const parent of places) {
      leaves.add(`${parent}\n${term}`);
      open.add(parent);
      for (const above of tree.ancestors(parent)) open.add(above);
    }
  }
  return {
    matches: [...matchNodes, ...matchTerms],
    open,
    shows: (parent, key) => (tree.isTerm(key) ? covered.has(parent) || leaves.has(`${parent}\n${key}`) : open.has(key) || covered.has(key)),
  };
}

// The breakdown's rows one level below parent (the branches for null: the charts start there, owner
// decision 2026-09-29; a category's: its branches): medicines per child (a medicine counts once in
// every child it touches; products: { areaKeys, areaExact }), most first (ties by name), the top n
// then one Other row counting each medicine in the rest once; then the medicines at parent itself
// (a static row, areaExactLabel()) when it has children. A leaf (a term, or a node without
// children) has none: the breakdown shows it alone. rank: a row's place in tree order (the Sort
// control's MeSH order, sortBreakdownRows()).
export function areaBreakdownRows(tree, parent, products, n = 20) {
  const rank = new Map((parent === null ? tree.branches : tree.children(parent)).map((key, index) => [key, index]));
  const keysOf = (product) => product.areaKeys.filter((key) => rank.has(key));
  const counts = new Map();
  for (const product of products) for (const key of keysOf(product)) counts.set(key, (counts.get(key) ?? 0) + 1);
  const rows = [...counts]
    .map(([key, count]) => ({ key, label: tree.name(key), count, rank: rank.get(key) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (rows.length === 0) return [];
  let result = rows;
  if (rows.length > n) {
    const tail = new Set(rows.slice(n).map((row) => row.key));
    const count = products.filter((product) => keysOf(product).some((key) => tail.has(key))).length;
    result = [...rows.slice(0, n), { key: null, label: UI.other, count, other: true }];
  }
  const exact = parent === null ? 0 : products.filter((product) => product.areaExact.includes(parent)).length;
  return exact ? [...result, { key: parent, label: areaExactLabel(tree, parent), count: exact, static: true, incomplete: true }] : result;
}

// The charts start at the branches (owner decision 2026-09-29), so "Up one level" from a branch
// goes to its category only when the branch was opened from the category's view (via:
// areaDrillVia()), else to all areas (null); from any other key to its parent.
export function areaUpLevel(tree, key, via = null) {
  const parent = tree.parent(key);
  return tree.isCategory(parent) && via?.branch !== key ? null : parent;
}

// The view the one area shown (state.area alone) was opened from, for areaUpLevel(): { branch,
// category } when it went from a category to one of its branches, kept while it stays that branch
// or under it; else null. previous, current: the area shown before and now (null: none).
export function areaDrillVia(tree, via, previous, current) {
  if (current === null) return null;
  if (tree.isCategory(previous) && tree.parent(current) === previous) return { branch: current, category: previous };
  return via && (current === via.branch || tree.ancestors(current).has(via.branch)) ? via : null;
}

// The static row after a key's children (tree, breakdown, activity card): a branch's medicines
// tagged only at its root ("Tagged only as Neoplasms or Cancer"), a node's tagged with it itself.
export function areaExactLabel(tree, key) {
  const tags = tree.rootTerms(key);
  return tags.length ? UI.areas.taggedOnly(tags) : UI.areas.notMoreSpecific;
}
