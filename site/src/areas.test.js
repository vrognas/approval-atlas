import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  areaBreakdownRows,
  areaCategoryTip,
  areaCheckState,
  areaDrillVia,
  areaExactLabel,
  areaIncludedIn,
  areaNumberLevel,
  areaTreeChildren,
  areaTreeKeys,
  areaTreeSearch,
  areaUpLevel,
  branchChips,
  branchIncludedIn,
  branchSelected,
  buildAreaTree,
  inAreas,
  termBranches,
  toggleArea,
} from "./areas.js";
import { tokenLabel } from "./facets.js";
import { UI } from "./labels.js";
import { DEFAULT_STATE, decodeState, encodeState } from "./url.js";

// Real rows (ema_therapeutic_area_branches.json, ema_therapeutic_area_subtree.json, 2026-09-28).
const branch = (term, name, code, branchName) => ({ therapeutic_area_mesh: term, mesh_descriptor_name: name, branch: code, branch_name: branchName });
const branchRows = [
  branch("Neoplasms", "Neoplasms", "C04", "Neoplasms"),
  branch("Cancer", "Neoplasms", "C04", "Neoplasms"),
  branch("Breast Neoplasms", "Breast Neoplasms", "C04", "Neoplasms"),
  branch("Breast Neoplasms", "Breast Neoplasms", "C17", "Skin and Connective Tissue Diseases"),
  branch("Triple Negative Breast Neoplasms", "Triple Negative Breast Neoplasms", "C04", "Neoplasms"),
  branch("Triple Negative Breast Neoplasms", "Triple Negative Breast Neoplasms", "C17", "Skin and Connective Tissue Diseases"),
  branch("Psoriasis", "Psoriasis", "C17", "Skin and Connective Tissue Diseases"),
  branch("Arthritis, Juvenile", "Arthritis, Juvenile", "C05", "Musculoskeletal Diseases"),
  branch("Arthritis, Juvenile Rheumatoid", "Arthritis, Juvenile", "C05", "Musculoskeletal Diseases"),
  branch("Unmatched term", null, null, null),
];
const node = (term, code, level, parent, name) => ({ therapeutic_area_mesh: term, branch: code.slice(0, 3), node: code, level, parent, node_name: name });
const subtreeRows = [
  node("Breast Neoplasms", "C04.588", 2, "C04", "Neoplasms by Site"),
  node("Breast Neoplasms", "C04.588.180", 3, "C04.588", "Breast Neoplasms"),
  node("Breast Neoplasms", "C17.800", 2, "C17", "Skin Diseases"),
  node("Breast Neoplasms", "C17.800.090", 3, "C17.800", "Breast Diseases"),
  node("Triple Negative Breast Neoplasms", "C04.588", 2, "C04", "Neoplasms by Site"),
  node("Triple Negative Breast Neoplasms", "C04.588.180", 3, "C04.588", "Breast Neoplasms"),
  node("Triple Negative Breast Neoplasms", "C17.800", 2, "C17", "Skin Diseases"),
  node("Triple Negative Breast Neoplasms", "C17.800.090", 3, "C17.800", "Breast Diseases"),
  node("Psoriasis", "C17.800", 2, "C17", "Skin Diseases"),
  node("Psoriasis", "C17.800.859", 3, "C17.800", "Skin Diseases, Papulosquamous"),
  node("Arthritis, Juvenile", "C05.550", 2, "C05", "Joint Diseases"),
  node("Arthritis, Juvenile", "C05.550.114", 3, "C05.550", "Arthritis"),
  node("Arthritis, Juvenile", "C05.799", 2, "C05", "Rheumatic Diseases"),
  node("Arthritis, Juvenile", "C05.799.056", 3, "C05.799", "Arthritis, Juvenile"),
  node("Arthritis, Juvenile Rheumatoid", "C05.550", 2, "C05", "Joint Diseases"),
  node("Arthritis, Juvenile Rheumatoid", "C05.550.114", 3, "C05.550", "Arthritis"),
  node("Arthritis, Juvenile Rheumatoid", "C05.799", 2, "C05", "Rheumatic Diseases"),
  node("Arthritis, Juvenile Rheumatoid", "C05.799.056", 3, "C05.799", "Arthritis, Juvenile"),
];
const tree = buildAreaTree(branchRows, subtreeRows);
const everyKey = new Set([...tree.names.keys()]);

// Owner feedback 2026-09-29: a MeSH category has no scope note (no descriptor holds one), so its
// row's explainer is computed from the data: the first and last of its branches here.
test("areaCategoryTip: a category's explainer names its level and its branches in the data; none for other keys", () => {
  assert.equal(areaCategoryTip(tree, "C"), "Diseases (MeSH category C): the top level of the MeSH tree; its branches here: C04–C17.");
  const one = buildAreaTree([branch("Anatomy term", "Anatomy term", "A02", "Musculoskeletal System")], []);
  assert.equal(areaCategoryTip(one, "A"), "Anatomy (MeSH category A): the top level of the MeSH tree; its branch here: A02.");
  assert.deepEqual(["C04", "C04.588", "Psoriasis", "X"].map((key) => areaCategoryTip(tree, key)), [null, null, null, null]);
});

test("area tree: MeSH categories, then branches by code, level-2 and level-3 nodes, EMA's terms as leaves", () => {
  // Owner decision 2026-09-29: the top level is the MeSH category (a branch code's letter), by NLM's name.
  assert.deepEqual(tree.roots, ["C"]);
  assert.deepEqual(tree.children(null), ["C"]);
  assert.equal(tree.name("C"), "Diseases");
  assert.deepEqual([tree.isCategory("C"), tree.isCategory("C04"), tree.isCategory("Psoriasis"), tree.isCategory(null)], [true, false, false, false]);
  assert.equal(tree.isTerm("C"), false);
  // MeSH tree order (owner request 2026-09-28, as the ATC tree by code): not by name.
  assert.deepEqual(tree.children("C"), ["C04", "C05", "C17"]); // Neoplasms, Musculoskeletal, Skin
  assert.equal(tree.parent("C04"), "C");
  // The charts start at the branches (owner decision 2026-09-29).
  assert.deepEqual(tree.branches, ["C04", "C05", "C17"]);
  assert.deepEqual(tree.children("C17"), ["C17.800"]);
  assert.deepEqual(tree.children("C17.800"), ["C17.800.090", "C17.800.859"]);
  // Deeper than level 3: leaves under their level-3 node.
  assert.deepEqual(tree.children("C17.800.090"), ["Breast Neoplasms", "Triple Negative Breast Neoplasms"]);
  assert.deepEqual(tree.children("C17.800.859"), ["Psoriasis"]);
  assert.equal(tree.name("C17.800.859"), "Skin Diseases, Papulosquamous");
  assert.equal(tree.name("C04"), "Neoplasms");
  assert.equal(tree.name("Psoriasis"), "Psoriasis");
  assert.equal(tree.isTerm("Psoriasis"), true);
  assert.equal(tree.isTerm("C17.800"), false);
  // An unmatched term has no place in the tree.
  assert.equal(tree.has("Unmatched term"), false);
});

// Owner request 2026-09-28: every level in MeSH tree order, as the ATC tree by code. EMA's terms
// deeper than level 3 by their descriptor's tree number under the row's parent (from
// mesh_descriptor_notes.json, which loads after the tree: setNotes()); terms without one last, by
// name. Arthritis, Gouty (C05.550.114.423) comes after Arthritis, Juvenile (C05.550.114.099),
// though its name comes first.
const withUi = (row, ui) => ({ ...row, mesh_descriptor_ui: ui });
const orderBranchRows = [
  ...branchRows.map((row) => withUi(row, { "Arthritis, Juvenile": "D001171", "Arthritis, Juvenile Rheumatoid": "D001171", Psoriasis: "D011565" }[row.therapeutic_area_mesh] ?? null)),
  withUi(branch("Arthritis, Gouty", "Arthritis, Gouty", "C05", "Musculoskeletal Diseases"), "D015210"),
  withUi(branch("Arthritis, Experimental", "Arthritis, Experimental", "C05", "Musculoskeletal Diseases"), "D001169"),
];
const orderSubtreeRows = [
  ...subtreeRows,
  node("Arthritis, Gouty", "C05.550", 2, "C05", "Joint Diseases"),
  node("Arthritis, Gouty", "C05.550.114", 3, "C05.550", "Arthritis"),
  node("Arthritis, Gouty", "C05.550.354", 3, "C05.550", "Gout"),
  node("Arthritis, Experimental", "C05.550", 2, "C05", "Joint Diseases"),
  node("Arthritis, Experimental", "C05.550.114", 3, "C05.550", "Arthritis"),
];
const note = (ui, name, numbers) => ({ mesh_descriptor_ui: ui, mesh_descriptor_name: name, tree_numbers: numbers, scope_note: null, source: "nlm_mesh" });
// No row for Arthritis, Experimental: it has no tree number here.
const noteRows = [
  note("D001171", "Arthritis, Juvenile", ["C05.550.114.099", "C05.799.056"]),
  note("D015210", "Arthritis, Gouty", ["C05.550.114.423", "C05.550.354.500"]),
  note("D011565", "Psoriasis", ["C17.800.859.675"]),
];

test("area tree order: terms by their tree number under the row's parent, those without one last by name", () => {
  const ordered = buildAreaTree(orderBranchRows, orderSubtreeRows, noteRows);
  assert.deepEqual(ordered.roots, ["C"]);
  assert.deepEqual(ordered.children("C"), ["C04", "C05", "C17"]);
  assert.deepEqual(ordered.children("C05.550"), ["C05.550.114", "C05.550.354"]);
  assert.deepEqual(ordered.children("C05.550.114"), ["Arthritis, Juvenile", "Arthritis, Juvenile Rheumatoid", "Arthritis, Gouty", "Arthritis, Experimental"]);
  assert.deepEqual(ordered.children("C05.550.354"), ["Arthritis, Gouty"]);
});

test("area tree order: before the notes load, terms by name; setNotes() puts them in tree order", () => {
  const ordered = buildAreaTree(orderBranchRows, orderSubtreeRows);
  assert.deepEqual(ordered.children("C05.550.114"), ["Arthritis, Experimental", "Arthritis, Gouty", "Arthritis, Juvenile", "Arthritis, Juvenile Rheumatoid"]);
  ordered.setNotes(noteRows);
  assert.deepEqual(ordered.children("C05.550.114"), ["Arthritis, Juvenile", "Arthritis, Juvenile Rheumatoid", "Arthritis, Gouty", "Arthritis, Experimental"]);
  // Nodes keep their order; no notes (a missing file) is the order by name again.
  assert.deepEqual(ordered.children("C05.550"), ["C05.550.114", "C05.550.354"]);
  ordered.setNotes(null);
  assert.deepEqual(ordered.children("C05.550.114")[0], "Arthritis, Experimental");
});

// Owner decision 2026-09-29: each tree row shows its MeSH tree number, as the ATC tree its code: a
// category's letter, a branch's code, a node's tree number, a term's descriptor's tree number under
// the row's parent (the one the order uses; none before the notes load, or without one there).
test("area tree numbers: category letter, branch code, node number, a term's number under the row's parent", () => {
  const numbered = buildAreaTree(orderBranchRows, orderSubtreeRows, noteRows);
  assert.deepEqual(["C", "C05", "C05.550", "C05.550.114"].map((key) => numbered.number(key)), ["C", "C05", "C05.550", "C05.550.114"]);
  // A term under two nodes has a number under each.
  assert.equal(numbered.number("Arthritis, Gouty", "C05.550.114"), "C05.550.114.423");
  assert.equal(numbered.number("Arthritis, Gouty", "C05.550.354"), "C05.550.354.500");
  assert.equal(numbered.number("Psoriasis", "C17.800.859"), "C17.800.859.675");
  // None without a number under that parent, or before the notes load.
  assert.equal(numbered.number("Arthritis, Experimental", "C05.550.114"), null);
  assert.equal(numbered.number("Arthritis, Gouty", "C17.800.859"), null);
  assert.equal(buildAreaTree(orderBranchRows, orderSubtreeRows).number("Arthritis, Gouty", "C05.550.114"), null);
  assert.equal(numbered.number("Unknown key"), null);
  // A tag matched at a branch root (its descriptor is the branch) has none of its own there.
  const tagged = buildAreaTree([withUi(branch("Cancer", "Neoplasms", "C04", "Neoplasms"), "D009369")], [], [note("D009369", "Neoplasms", ["C04"])]);
  assert.equal(tagged.number("Cancer", "C04"), null);
});

test("area tree numbers: the badge's level shade by depth, as the ATC code badges", () => {
  assert.deepEqual(
    ["C", "C04", "C04.588", "C04.588.180", "C04.588.180.260", "C10.228.140.163.100.435.825.700.875"].map(areaNumberLevel),
    [1, 2, 3, 4, 5, 5],
  );
});

test("area tree rows: named by the area, then its tree number (when known), then the count", () => {
  assert.equal(UI.areas.count(UI.areas.numbered("Neoplasms by Site", "C04.588"), 284), "Neoplasms by Site, C04.588, 284 medicines");
  assert.equal(UI.areas.count(UI.areas.numbered("Breast Neoplasms", null), 1), "Breast Neoplasms, 1 medicine");
});

test("area tree: a term whose descriptor is a level-2/3 node shows once, as that node", () => {
  // Breast Neoplasms is C04.588.180 itself: no leaf of the same name below it.
  assert.deepEqual(tree.children("C04.588"), ["C04.588.180"]);
  assert.deepEqual(tree.children("C04.588.180"), ["Triple Negative Breast Neoplasms"]);
  assert.deepEqual(tree.exact("C04.588.180"), ["Breast Neoplasms"]);
  // An entry term of the node's descriptor collapses into it too; a node whose terms are all its own is a leaf.
  assert.deepEqual(tree.exact("C05.799.056"), ["Arthritis, Juvenile", "Arthritis, Juvenile Rheumatoid"]);
  assert.deepEqual(tree.children("C05.799.056"), []);
  // Elsewhere the same term is a leaf (C17: level 4 under Breast Diseases; C05: under Arthritis).
  assert.deepEqual(tree.parents("Breast Neoplasms"), ["C17.800.090"]);
  assert.deepEqual(tree.children("C05.550.114"), ["Arthritis, Juvenile", "Arthritis, Juvenile Rheumatoid"]);
});

// Phase 4g (user decision 2026-09-28): tags matched at a branch root are one static row of the
// branch ("Tagged only as Neoplasms or Cancer"), not a leaf and not the branch itself.
test("area tree: tags matched at a branch root are the branch's static row, not leaves", () => {
  assert.deepEqual(tree.children("C04"), ["C04.588"]);
  assert.deepEqual(tree.exact("C04"), []);
  // The heading first, then its entry terms by name.
  assert.deepEqual(tree.rootTerms("C04"), ["Neoplasms", "Cancer"]);
  assert.deepEqual(tree.rootTerms("C04.588.180"), []);
  assert.equal(areaExactLabel(tree, "C04"), "Tagged only as Neoplasms or Cancer");
  assert.equal(areaExactLabel(tree, "C04.588.180"), "not more specific");
  // A tag of the branch: its parent (the path and "Up one level" go through the branch).
  assert.deepEqual(tree.parents("Cancer"), ["C04"]);
  assert.deepEqual(tree.path("Cancer"), ["C", "C04", "Cancer"]);
  assert.equal(tree.isTerm("Neoplasms"), true);
  // The static row counts the medicines tagged only at the root: none more specific in that branch.
  assert.deepEqual(tree.exactOf(["Cancer", "Psoriasis"]), ["C04"]);
  assert.deepEqual(tree.exactOf(["Neoplasms", "Cancer"]), ["C04"]);
  assert.deepEqual(tree.exactOf(["Cancer", "Breast Neoplasms"]), ["C04.588.180"]);
  assert.deepEqual(tree.exactOf(["Cancer", "Triple Negative Breast Neoplasms"]), []);
  // A search still finds the branch by its tags.
  assert.deepEqual(areaTreeSearch(tree, everyKey, "cancer").matches, ["C04"]);
});

// Owner decision 2026-09-29: the conditions card ranks only specific conditions. A term is broad when
// every tree number of its descriptor is at level 1 or 2 (a tag matched at a branch root, or a
// level-2 node only: Lung Diseases, C08.381), specific with one at level 3 or deeper on any path
// (Diabetes Mellitus: C18.452.394.750 as well as C19.246). Real rows (2026-09-28).
test("area tree: broad terms (every tree number at level 1 or 2) and specific ones", () => {
  const broadTree = buildAreaTree(
    [
      ...branchRows,
      branch("Lung Diseases", "Lung Diseases", "C08", "Respiratory Tract Diseases"),
      branch("Diabetes Mellitus", "Diabetes Mellitus", "C18", "Nutritional and Metabolic Diseases"),
      branch("Diabetes Mellitus", "Diabetes Mellitus", "C19", "Endocrine System Diseases"),
    ],
    [
      ...subtreeRows,
      node("Lung Diseases", "C08.381", 2, "C08", "Lung Diseases"),
      node("Diabetes Mellitus", "C18.452", 2, "C18", "Metabolic Diseases"),
      node("Diabetes Mellitus", "C18.452.394", 3, "C18.452", "Glucose Metabolism Disorders"),
      node("Diabetes Mellitus", "C19.246", 2, "C19", "Diabetes Mellitus"),
    ],
  );
  const broad = (terms) => terms.map((term) => broadTree.broad(term));
  assert.deepEqual(broad(["Neoplasms", "Cancer", "Lung Diseases"]), [true, true, true]);
  // At level 3 (Breast Neoplasms is C04.588.180), deeper, or both (Diabetes Mellitus).
  assert.deepEqual(broad(["Breast Neoplasms", "Triple Negative Breast Neoplasms", "Psoriasis", "Arthritis, Juvenile", "Diabetes Mellitus"]), [false, false, false, false, false]);
  // Only terms: categories, branches, nodes and unknown terms are never broad conditions.
  assert.deepEqual(broad(["C", "C04", "C08.381", "Unmatched term", "Not a term"]), [false, false, false, false, false]);
  // Read from the tree's own rows, so the tree numbers arriving later change nothing.
  broadTree.setNotes([{ mesh_descriptor_ui: "D008171", tree_numbers: ["C08.381"] }]);
  assert.equal(broadTree.broad("Lung Diseases"), true);
  assert.equal(broadTree.broad("Diabetes Mellitus"), false);
});

test("area selection: a root tag (older links) is selected as itself, within its branch", () => {
  assert.deepEqual(tree.canonical("Neoplasms"), ["Neoplasms"]);
  assert.equal(areaCheckState(tree, "C04", ["Cancer"]), "mixed");
  assert.equal(inAreas(tree, ["C04"], "Cancer"), true);
  assert.deepEqual(toggleArea(tree, ["Cancer"], "C04"), ["C04"]);
  assert.deepEqual(toggleArea(tree, ["C04.588", "Psoriasis"], "Cancer"), ["C04.588", "Psoriasis", "Cancer"]);
  // A link loads it without an error, as the tag (the medicines tagged with it); the branch covers it.
  const domain = { mahs: new Set(), types: new Set(), statuses: new Set(), years: [1995, 2026], areas: everyKey, areaAncestors: tree.ancestors, areaCanonical: tree.canonical };
  const { state, dropped } = decodeState(new URLSearchParams("area=Neoplasms&area=Cancer"), domain);
  assert.deepEqual([state.area, dropped], [["Cancer", "Neoplasms"], []]);
  assert.equal(encodeState(state).toString(), "area=Cancer&area=Neoplasms");
  assert.deepEqual(decodeState(new URLSearchParams("area=Cancer&area=C04"), domain).state.area, ["C04"]);
});

// Phase 4g review: `?area=Neoplasms` filters the medicines tagged Neoplasms, not the branch, so
// it never shows by the branch's name alone ("Neoplasms › Neoplasms"): headline, paths, sentence
// token and activity columns read tree.label().
test("area labels: a root tag reads as a tag, every other key by its name", () => {
  assert.deepEqual(["Neoplasms", "Cancer", "C04", "C04.588", "Psoriasis", "Breast Neoplasms"].map(tree.isRootTag), [true, true, false, false, false, false]);
  assert.equal(tree.label("Neoplasms"), "tagged Neoplasms");
  assert.equal(tree.label("C04"), "Neoplasms");
  assert.equal(tree.label("Psoriasis"), "Psoriasis");
  assert.deepEqual(tree.path("Neoplasms").map(tree.label), ["Diseases", "Neoplasms", "tagged Neoplasms"]);
  assert.equal(tree.labels.get("Cancer"), "tagged Cancer");
  assert.equal(tree.labels.get("C04.588"), "Neoplasms by Site");
  const lookups = { years: [1995, 2026], areaNames: tree.labels, atcNames: new Map() };
  assert.equal(tokenLabel("area", { ...DEFAULT_STATE, area: ["Neoplasms"] }, lookups), "tagged Neoplasms");
  assert.equal(tokenLabel("area", { ...DEFAULT_STATE, area: ["C04"] }, lookups), "Neoplasms");
  // A category by NLM's name (owner decision 2026-09-29).
  assert.equal(tree.label("C"), "Diseases");
  assert.equal(tokenLabel("area", { ...DEFAULT_STATE, area: ["C"] }, lookups), "Diseases");
});

// A term exact at two nodes (one descriptor, two tree numbers) and at none elsewhere.
const alcohol = buildAreaTree(
  [...branchRows, branch("Alcohol-Related Disorders", "Alcohol-Related Disorders", "C25", "Chemically-Induced Disorders"), branch("Alcohol-Related Disorders", "Alcohol-Related Disorders", "F03", "Mental Disorders")],
  [
    ...subtreeRows,
    node("Alcohol-Related Disorders", "C25.775", 2, "C25", "Substance-Related Disorders"),
    node("Alcohol-Related Disorders", "C25.775.100", 3, "C25.775", "Alcohol-Related Disorders"),
    node("Alcohol-Related Disorders", "F03.900", 2, "F03", "Substance-Related Disorders"),
    node("Alcohol-Related Disorders", "F03.900.100", 3, "F03.900", "Alcohol-Related Disorders"),
  ],
);

test("area tree: a term that is a node is selected as it; other keys (root tags too) as themselves", () => {
  assert.deepEqual(tree.canonical("Breast Neoplasms"), ["C04.588.180"]);
  assert.deepEqual(tree.canonical("Cancer"), ["Cancer"]);
  assert.deepEqual(tree.canonical("Arthritis, Juvenile Rheumatoid"), ["C05.799.056"]);
  assert.deepEqual(alcohol.canonical("Alcohol-Related Disorders"), ["C25.775.100", "F03.900.100"]);
  assert.deepEqual(tree.canonical("Psoriasis"), ["Psoriasis"]);
  assert.deepEqual(tree.canonical("C17.800"), ["C17.800"]);
  assert.deepEqual(tree.canonical("Unmatched term"), ["Unmatched term"]);
});

test("area tree: ancestors over every path, keys and exact nodes per product", () => {
  assert.deepEqual([...tree.ancestors("C17.800.859")].sort(), ["C", "C17", "C17.800"]);
  assert.deepEqual([...tree.ancestors("Breast Neoplasms")].sort(), ["C", "C04", "C04.588", "C04.588.180", "C17", "C17.800", "C17.800.090"]);
  assert.deepEqual([...tree.ancestors("C04")], ["C"]);
  assert.deepEqual([...tree.ancestors("C")], []);
  assert.deepEqual(tree.keysOf(["Psoriasis", "Cancer"]).sort(), ["C", "C04", "C17", "C17.800", "C17.800.859", "Cancer", "Psoriasis"]);
  assert.deepEqual(tree.keysOf(["Unmatched term"]), ["Unmatched term"]);
  assert.deepEqual(tree.exactOf(["Breast Neoplasms", "Psoriasis"]), ["C04.588.180"]);
  // The path follows the first parent in tree order.
  assert.deepEqual(tree.path("Breast Neoplasms"), ["C", "C17", "C17.800", "C17.800.090", "Breast Neoplasms"]);
  assert.deepEqual(tree.path("C04.588.180"), ["C", "C04", "C04.588", "C04.588.180"]);
  assert.equal(tree.parent("C04.588"), "C04");
  assert.equal(tree.parent("C"), null);
});

// Owner decision 2026-09-29: the tree is grouped by MeSH category (A Anatomy, C Diseases, F
// Psychiatry and Psychology…), each a selectable row; a medicine counts once per category it touches.
test("area tree: MeSH categories group the branches, by NLM's names", () => {
  assert.deepEqual(alcohol.roots, ["C", "F"]);
  assert.deepEqual([alcohol.name("C"), alcohol.name("F")], ["Diseases", "Psychiatry and Psychology"]);
  assert.deepEqual(alcohol.children("C"), ["C04", "C05", "C17", "C25"]);
  assert.deepEqual(alcohol.children("F"), ["F03"]);
  assert.deepEqual(alcohol.branches, ["C04", "C05", "C17", "C25", "F03"]);
  // A term under branches of two categories is under both; its tree keys hold each category once.
  assert.deepEqual([...alcohol.ancestors("Alcohol-Related Disorders")].filter(alcohol.isCategory).sort(), ["C", "F"]);
  const keys = alcohol.keysOf(["Alcohol-Related Disorders", "Psoriasis"]);
  assert.deepEqual(keys.filter(alcohol.isCategory).sort(), ["C", "F"]);
  // No medicine is tagged at a category itself: no static row there.
  assert.deepEqual(alcohol.exactOf(["Alcohol-Related Disorders"]).filter(alcohol.isCategory), []);
  assert.deepEqual(alcohol.exact("C"), []);
  assert.deepEqual(alcohol.rootTerms("C"), []);
  // A category is selected as itself; its name matches a search.
  assert.deepEqual(alcohol.canonical("F"), ["F"]);
  assert.deepEqual(alcohol.searchNames("F"), ["psychiatry and psychology"]);
});

test("area selection: a category includes its branches, is mixed above a selected branch and replaces them", () => {
  assert.equal(areaCheckState(tree, "C", ["C"]), "checked");
  assert.equal(areaCheckState(tree, "C04", ["C"]), "included");
  assert.equal(areaCheckState(tree, "Psoriasis", ["C"]), "included");
  assert.equal(areaIncludedIn(tree, "C17.800", ["C"]), "C");
  assert.equal(areaCheckState(tree, "C", ["C17"]), "mixed");
  assert.equal(areaCheckState(tree, "C", ["Psoriasis"]), "mixed");
  assert.equal(inAreas(tree, ["C"], "Breast Neoplasms"), true);
  // Selecting a category drops the branches and areas under it; unchecking it clears it.
  assert.deepEqual(toggleArea(tree, ["C04", "Psoriasis"], "C"), ["C"]);
  assert.deepEqual(toggleArea(tree, ["C"], "C"), []);
  assert.deepEqual(toggleArea(alcohol, ["C04", "F03"], "C"), ["F03", "C"]);
  // Links: a branch under a selected category is dropped; older links load as before.
  const domain = { mahs: new Set(), types: new Set(), statuses: new Set(), years: [1995, 2026], areas: everyKey, areaAncestors: tree.ancestors, areaCanonical: tree.canonical };
  assert.deepEqual(decodeState(new URLSearchParams("area=C04&area=C"), domain).state.area, ["C"]);
  assert.deepEqual(decodeState(new URLSearchParams("area=C04&area=Psoriasis"), domain).state.area, ["C04", "Psoriasis"]);
  assert.deepEqual(decodeState(new URLSearchParams("branch=C04&area=Psoriasis"), domain).state.area, ["C04", "Psoriasis"]);
  assert.equal(encodeState(decodeState(new URLSearchParams("area=C"), domain).state).toString(), "area=C");
});

// The charts start at the branches (owner decision 2026-09-29): "Up one level" from a branch goes
// to its category when the branch was opened from the category's view, else to all areas.
test("area charts: up one level from a branch goes to its category only when opened from it", () => {
  assert.equal(areaUpLevel(tree, "C04", null), null);
  assert.equal(areaUpLevel(tree, "C04", { branch: "C04", category: "C" }), "C");
  assert.equal(areaUpLevel(tree, "C04", { branch: "C17", category: "C" }), null);
  assert.equal(areaUpLevel(tree, "C", null), null);
  assert.equal(areaUpLevel(tree, "C04.588", null), "C04");
  assert.equal(areaUpLevel(tree, "Cancer", null), "C04");
  // The view a branch was opened from: set going from a category to one of its branches, kept
  // while the one area shown stays that branch or under it, else cleared.
  const via = { branch: "C04", category: "C" };
  assert.deepEqual(areaDrillVia(tree, null, "C", "C04"), via);
  assert.equal(areaDrillVia(tree, null, null, "C04"), null);
  assert.equal(areaDrillVia(tree, null, "C17", "C17.800"), null);
  assert.deepEqual(areaDrillVia(tree, via, "C04", "C04.588"), via);
  assert.deepEqual(areaDrillVia(tree, via, "C04.588", "C04"), via);
  assert.equal(areaDrillVia(tree, via, "C04", null), null);
  assert.equal(areaDrillVia(tree, via, "C04", "C17"), null);
  assert.equal(areaDrillVia(tree, via, "C04", "C"), null);
});

test("area selection: check states over every path", () => {
  assert.equal(areaCheckState(tree, "C17", ["C17"]), "checked");
  assert.equal(areaCheckState(tree, "Psoriasis", ["C17"]), "included");
  // A term included through one branch shows included under every parent.
  assert.equal(areaCheckState(tree, "Breast Neoplasms", ["C04.588"]), "included");
  assert.equal(areaCheckState(tree, "C17", ["Triple Negative Breast Neoplasms"]), "mixed");
  assert.equal(areaCheckState(tree, "C04.588.180", ["Triple Negative Breast Neoplasms"]), "mixed");
  assert.equal(areaCheckState(tree, "C05", ["Triple Negative Breast Neoplasms"]), "unchecked");
  assert.equal(areaIncludedIn(tree, "Breast Neoplasms", ["C17"]), "C17");
  assert.equal(areaIncludedIn(tree, "Psoriasis", ["C04"]), null);
});

test("area selection: a term that is a node shows checked wherever it appears when that node is selected", () => {
  // The node C04.588.180 and the leaf Breast Neoplasms under C17's Breast Diseases are one area.
  assert.equal(areaCheckState(tree, "C04.588.180", ["C04.588.180"]), "checked");
  assert.equal(areaCheckState(tree, "Breast Neoplasms", ["C04.588.180"]), "checked");
  assert.equal(areaCheckState(tree, "Triple Negative Breast Neoplasms", ["C04.588.180"]), "included");
  assert.equal(areaCheckState(tree, "C17.800.090", ["C04.588.180"]), "unchecked");
  // A term at two nodes: checked when both are.
  assert.equal(alcohol.canonical("Alcohol-Related Disorders").every((key) => areaCheckState(alcohol, key, ["C25.775.100", "F03.900.100"]) === "checked"), true);
});

test("area selection: a toggle removes a selected value, or adds one in place of those it covers or is covered by", () => {
  assert.deepEqual(toggleArea(tree, ["C17", "C04"], "C17"), ["C04"]);
  assert.deepEqual(toggleArea(tree, ["Psoriasis", "Triple Negative Breast Neoplasms", "C05"], "C17"), ["C05", "C17"]);
  assert.deepEqual(toggleArea(tree, ["C04"], "Triple Negative Breast Neoplasms"), ["Triple Negative Breast Neoplasms"]);
  assert.deepEqual(toggleArea(tree, [], "Psoriasis"), ["Psoriasis"]);
});

test("area selection: a term that is a node toggles as that node, from its leaf too", () => {
  assert.deepEqual(toggleArea(tree, [], "Breast Neoplasms"), ["C04.588.180"]);
  assert.deepEqual(toggleArea(tree, ["C04.588.180"], "Breast Neoplasms"), []);
  assert.deepEqual(toggleArea(tree, ["Triple Negative Breast Neoplasms", "C05"], "Breast Neoplasms"), ["C05", "C04.588.180"]);
  assert.deepEqual(toggleArea(alcohol, ["C25.775.100"], "Alcohol-Related Disorders"), ["C25.775.100", "F03.900.100"]);
  assert.deepEqual(toggleArea(alcohol, ["C25.775.100", "F03.900.100", "C17"], "Alcohol-Related Disorders"), ["C17"]);
});

test("inAreas: a term within the selection (itself or under a selected node)", () => {
  assert.equal(inAreas(tree, ["C17"], "Psoriasis"), true);
  assert.equal(inAreas(tree, ["Psoriasis"], "Psoriasis"), true);
  assert.equal(inAreas(tree, ["C04"], "Psoriasis"), false);
});

// Owner decision 2026-09-29: in the tables and on the medicine card each condition is followed by
// chips for its MeSH branches (at most 2, then "+n"), each a filter toggle.
test("branch chips: a term's MeSH branches, distinct, in code order, with their names", () => {
  const rows = [
    branch("Adrenoleukodystrophy", "Adrenoleukodystrophy", "C18", "Nutritional and Metabolic Diseases"),
    branch("Adrenoleukodystrophy", "Adrenoleukodystrophy", "C10", "Nervous System Diseases"),
    branch("Adrenoleukodystrophy", "Adrenoleukodystrophy", "C16", "Congenital, Hereditary, and Neonatal Diseases and Abnormalities"),
    branch("Adrenoleukodystrophy", "Adrenoleukodystrophy", "C19", "Endocrine System Diseases"),
    branch("Adrenoleukodystrophy", "Adrenoleukodystrophy", "C10", "Nervous System Diseases"),
    ...branchRows,
  ];
  const branches = termBranches(rows);
  assert.deepEqual(branches.of("Adrenoleukodystrophy"), ["C10", "C16", "C18", "C19"]);
  assert.deepEqual(branches.of("Breast Neoplasms"), ["C04", "C17"]);
  // A tag matched at a branch root has that branch.
  assert.deepEqual(branches.of("Cancer"), ["C04"]);
  // Terms without a branch: none.
  assert.deepEqual(branches.of("Unmatched term"), []);
  assert.deepEqual(branches.of("Not in the data"), []);
  assert.equal(branches.name("C10"), "Nervous System Diseases");
  assert.equal(branches.name("C17"), "Skin and Connective Tissue Diseases");
});

test("branch chips: at most two, the rest behind +n", () => {
  assert.deepEqual(branchChips(["C10", "C16", "C18", "C19"]), { shown: ["C10", "C16"], rest: ["C18", "C19"] });
  assert.deepEqual(branchChips(["C10", "C16", "C18"]), { shown: ["C10", "C16"], rest: ["C18"] });
  assert.deepEqual(branchChips(["C04", "C17"]), { shown: ["C04", "C17"], rest: [] });
  assert.deepEqual(branchChips(["C04"]), { shown: ["C04"], rest: [] });
  assert.deepEqual(branchChips([]), { shown: [], rest: [] });
});

// Chips review 2026-09-29: a selected branch behind "+n" showed no pressed chip (?area=C18:
// Adrenoleukodystrophy read [C10] [C16] +2, both unpressed). A branch within the selection (selected
// itself, then one included through its selected category) is shown among the two, in code order.
test("branch chips: a selected branch behind +n is shown among the two, in code order", () => {
  const codes = ["C10", "C16", "C18", "C19"];
  assert.deepEqual(branchChips(codes, ["C18"]), { shown: ["C10", "C18"], rest: ["C16", "C19"] });
  assert.deepEqual(branchChips(codes, ["C19"]), { shown: ["C10", "C19"], rest: ["C16", "C18"] });
  assert.deepEqual(branchChips(codes, ["C18", "C19"]), { shown: ["C18", "C19"], rest: ["C10", "C16"] });
  assert.deepEqual(branchChips(codes, ["C04", "C19"]), { shown: ["C10", "C19"], rest: ["C16", "C18"] });
  // Shown already, or nothing within the selection: the first two.
  assert.deepEqual(branchChips(codes, ["C16"]), { shown: ["C10", "C16"], rest: ["C18", "C19"] });
  assert.deepEqual(branchChips(codes, ["C04"]), { shown: ["C10", "C16"], rest: ["C18", "C19"] });
  assert.deepEqual(branchChips(codes, []), { shown: ["C10", "C16"], rest: ["C18", "C19"] });
  // An area under a branch does not select the whole branch (as branchSelected()).
  assert.deepEqual(branchChips(codes, ["C18.452"]), { shown: ["C10", "C16"], rest: ["C18", "C19"] });
  // Included through its selected category (pressed, disabled): shown too.
  assert.deepEqual(branchChips(["C10", "C16", "F03"], ["F"]), { shown: ["C10", "F03"], rest: ["C16"] });
  assert.deepEqual(branchChips(codes, ["C"]), { shown: ["C10", "C16"], rest: ["C18", "C19"] });
  // A branch selected itself before those only included.
  assert.deepEqual(branchChips(["C10", "C16", "F03"], ["C", "F03"]), { shown: ["C10", "F03"], rest: ["C16"] });
  // Every shown chip pressed while any of the rest is.
  for (const selected of [["C10"], ["C16"], ["C18"], ["C19"], ["C16", "C19"], ["C18", "C19"], ["C"], ["C", "F03"], ["F"]]) {
    const { shown, rest } = branchChips(["C10", "C16", "C18", "C19", "F03"], selected);
    if (rest.some((code) => branchSelected(selected, code))) assert.ok(shown.every((code) => branchSelected(selected, code)), String(selected));
  }
});

test("branch chips: pressed when the branch or its category is selected, as inAreas()", () => {
  assert.equal(branchSelected(["C17"], "C17"), true);
  assert.equal(branchSelected(["C04", "C17"], "C17"), true);
  // A branch under a selected category shows as selected too.
  assert.equal(branchSelected(["C"], "C17"), true);
  // An area under the branch, or another branch: not the whole branch.
  assert.equal(branchSelected(["C17.800"], "C17"), false);
  assert.equal(branchSelected(["Psoriasis"], "C17"), false);
  assert.equal(branchSelected(["C04"], "C17"), false);
  assert.equal(branchSelected([], "C17"), false);
  for (const selected of [[], ["C"], ["C04"], ["C17"], ["C17.800"], ["C04.588.180"], ["Psoriasis"], ["Cancer"], ["C04", "C05"]]) {
    for (const key of tree.branches) assert.equal(branchSelected(selected, key), inAreas(tree, selected, key), `${selected} ${key}`);
  }
});

// Review 2026-09-29: a chip pressed only because its category is selected mirrors the tree's
// included row (checked and disabled, "included in Diseases"): a click would not toggle it.
test("branch chips: included through a selected category, as the tree's included rows", () => {
  assert.equal(branchIncludedIn(["C"], "C17"), "C");
  assert.equal(branchIncludedIn(["C", "F03"], "C17"), "C");
  // Selected itself, or not within the selection: not included.
  assert.equal(branchIncludedIn(["C17"], "C17"), null);
  assert.equal(branchIncludedIn(["C04"], "C17"), null);
  assert.equal(branchIncludedIn(["C17.800"], "C17"), null);
  assert.equal(branchIncludedIn(["F"], "C17"), null);
  assert.equal(branchIncludedIn([], "C17"), null);
  for (const selected of [[], ["C"], ["C04"], ["C17"], ["C17.800"], ["Psoriasis"], ["C04", "C05"], ["C", "C17"]]) {
    for (const key of tree.branches) {
      const included = areaCheckState(tree, key, selected) === "included";
      assert.equal(branchIncludedIn(selected, key) !== null, included, `${selected} ${key}`);
      if (included) assert.equal(branchIncludedIn(selected, key), areaIncludedIn(tree, key, selected));
    }
  }
});

test("branch chips: a click toggles the branch as the tree does (toggleArea())", () => {
  assert.deepEqual(toggleArea(tree, [], "C17"), ["C17"]);
  assert.deepEqual(toggleArea(tree, ["C17"], "C17"), []);
  assert.deepEqual(toggleArea(tree, ["C04"], "C17"), ["C04", "C17"]);
  // In place of an area under it, or of its category (pressed, as included: the chip narrows to it).
  assert.deepEqual(toggleArea(tree, ["Psoriasis", "C05"], "C17"), ["C05", "C17"]);
  assert.deepEqual(toggleArea(tree, ["C"], "C17"), ["C17"]);
});

test("area tree nodes: those with medicines plus the selection and its ancestors", () => {
  const counts = new Map([["C17", 2], ["C17.800", 2], ["C17.800.859", 2], ["Psoriasis", 2], ["C04", 0]]);
  const keys = areaTreeKeys(tree, counts, ["Triple Negative Breast Neoplasms"]);
  assert.deepEqual([...keys].sort(), ["C", "C04", "C04.588", "C04.588.180", "C17", "C17.800", "C17.800.090", "C17.800.859", "Psoriasis", "Triple Negative Breast Neoplasms"]);
  assert.deepEqual(areaTreeChildren(tree, null, keys), ["C"]);
  assert.deepEqual(areaTreeChildren(tree, "C", keys), ["C04", "C17"]);
  assert.deepEqual(areaTreeChildren(tree, "C04.588.180", keys), ["Triple Negative Breast Neoplasms"]);
});

test("area tree search: matching nodes and leaves with their levels opened, a match's subtree shown", () => {
  assert.equal(areaTreeSearch(tree, everyKey, "  "), null);
  const found = areaTreeSearch(tree, everyKey, "breast");
  // The node Breast Neoplasms and the node Breast Diseases; the leaves under them are not matches of their own.
  assert.deepEqual(found.matches, ["C04.588.180", "C17.800.090"]);
  assert.deepEqual([...found.open].sort(), ["C", "C04", "C04.588", "C17", "C17.800"]);
  assert.equal(found.shows("C04.588.180", "Triple Negative Breast Neoplasms"), true);
  assert.equal(found.shows("C17.800", "C17.800.859"), false);
  assert.equal(found.shows("C04", "Cancer"), false);
  // A leaf matches where its parent is not a match already, in every such place.
  const juvenile = areaTreeSearch(tree, everyKey, "juvenile rheum");
  assert.deepEqual(juvenile.matches, ["C05.799.056", "Arthritis, Juvenile Rheumatoid"]);
  assert.equal(juvenile.shows("C05.550.114", "Arthritis, Juvenile Rheumatoid"), true);
  assert.equal(juvenile.shows("C05.550.114", "Arthritis, Juvenile"), false);
  assert.equal(juvenile.open.has("C05.550.114"), true);
  // Fewer than 3 characters match nothing.
  assert.deepEqual(areaTreeSearch(tree, everyKey, "br").matches, []);
});

// Owner decision 2026-09-29: the search matches category names too. A category is a match of its
// own (its branches shown under it) only when nothing below it matches: "diseases" still lists the
// branches and nodes named so under Diseases.
test("area tree search: a category matches by its name when nothing below it does", () => {
  const psychiatry = areaTreeSearch(alcohol, new Set(alcohol.names.keys()), "psychiatry");
  assert.deepEqual(psychiatry.matches, ["F"]);
  assert.equal(psychiatry.shows(null, "F"), true);
  assert.equal(psychiatry.shows("F", "F03"), true);
  assert.equal(psychiatry.shows(null, "C"), false);
  const diseases = areaTreeSearch(tree, everyKey, "diseases");
  assert.deepEqual(diseases.matches, ["C05", "C17"]);
  assert.equal(diseases.open.has("C"), true);
  assert.equal(diseases.shows(null, "C"), true);
  assert.equal(diseases.shows("C", "C04"), false);
});

// Owner decision 2026-09-29: a tree number typed as a prefix ("C04.588", any case) finds the rows
// whose number starts with it, from the first character, as the ATC tree's code prefix: the top
// ones, their levels opened; a term where its number under that parent does.
test("area tree search: a tree number prefix finds the rows whose number starts with it", () => {
  const sites = areaTreeSearch(tree, everyKey, "C04.588");
  assert.deepEqual(sites.matches, ["C04.588"]);
  assert.deepEqual([...sites.open].sort(), ["C", "C04"]);
  assert.equal(sites.shows("C04", "C04.588"), true);
  assert.equal(sites.shows("C04.588", "C04.588.180"), true);
  assert.equal(sites.shows("C", "C17"), false);
  assert.deepEqual(areaTreeSearch(tree, everyKey, " c04.588 ").matches, ["C04.588"]);
  assert.deepEqual(areaTreeSearch(tree, everyKey, "C04.588.").matches, ["C04.588.180"]);
  assert.deepEqual(areaTreeSearch(tree, everyKey, "C0").matches, ["C04", "C05"]);
  // A category by its letter (a branch under it is no match of its own).
  assert.deepEqual(areaTreeSearch(tree, everyKey, "c").matches, ["C"]);
  assert.deepEqual(areaTreeSearch(tree, everyKey, "C99").matches, []);
  // Terms by their number under each parent (from the notes): Arthritis, Gouty is C05.550.114.423
  // and C05.550.354.500.
  const numbered = buildAreaTree(orderBranchRows, orderSubtreeRows, noteRows);
  const keys = new Set(numbered.names.keys());
  const gouty = areaTreeSearch(numbered, keys, "C05.550.114.4");
  assert.deepEqual(gouty.matches, ["Arthritis, Gouty"]);
  assert.equal(gouty.shows("C05.550.114", "Arthritis, Gouty"), true);
  assert.equal(gouty.shows("C05.550.354", "Arthritis, Gouty"), false);
  assert.equal(gouty.shows("C05.550.114", "Arthritis, Juvenile"), false);
  assert.deepEqual([...gouty.open].sort(), ["C", "C05", "C05.550", "C05.550.114"]);
  const gout = areaTreeSearch(numbered, keys, "C05.550.354.5");
  assert.equal(gout.shows("C05.550.354", "Arthritis, Gouty"), true);
  assert.equal(gout.shows("C05.550.114", "Arthritis, Gouty"), false);
  // Names still need 3 characters.
  assert.deepEqual(areaTreeSearch(tree, everyKey, "ps").matches, []);
});

const product = (areas) => ({ areas, areaKeys: tree.keysOf(areas), areaExact: tree.exactOf(areas) });

test("area breakdown: the level below a node, most first, then the medicines at the node itself", () => {
  const products = [
    product(["Breast Neoplasms"]),
    product(["Triple Negative Breast Neoplasms"]),
    product(["Psoriasis", "Cancer"]),
    product(["Neoplasms", "Breast Neoplasms"]),
  ];
  assert.deepEqual(areaBreakdownRows(tree, null, products).map((row) => [row.key, row.count]), [["C04", 4], ["C17", 4]]);
  // rank: the row's place in tree order, for the Sort control's MeSH order (sortBreakdownRows()).
  assert.deepEqual(areaBreakdownRows(tree, "C04.588.180", products), [
    { key: "Triple Negative Breast Neoplasms", label: "Triple Negative Breast Neoplasms", count: 1, rank: 0 },
    { key: "C04.588.180", label: "not more specific", count: 2, static: true, incomplete: true },
  ]);
  // A branch ends with the medicines tagged only at its root (one static row; the medicine also
  // tagged Breast Neoplasms counts under Neoplasms by Site only).
  assert.deepEqual(areaBreakdownRows(tree, "C04", products), [
    { key: "C04.588", label: "Neoplasms by Site", count: 3, rank: 0 },
    { key: "C04", label: "Tagged only as Neoplasms or Cancer", count: 1, static: true, incomplete: true },
  ]);
  assert.deepEqual(areaBreakdownRows(tree, null, products).map((row) => [row.key, row.rank]), [["C04", 0], ["C17", 2]]);
  // The charts start at the branches (owner decision 2026-09-29); one category selected: its
  // branches (no medicine is tagged at a category itself: no static row).
  assert.deepEqual(areaBreakdownRows(tree, "C", products), [
    { key: "C04", label: "Neoplasms", count: 4, rank: 0 },
    { key: "C17", label: "Skin and Connective Tissue Diseases", count: 4, rank: 2 },
  ]);
  // A leaf has no rows of its own; the breakdown shows it alone.
  assert.deepEqual(areaBreakdownRows(tree, "Psoriasis", products), []);
  assert.deepEqual(areaBreakdownRows(tree, "Cancer", products), []);
  // Beyond n rows: one Other row counting each medicine once.
  const rows = areaBreakdownRows(tree, null, products, 1);
  assert.deepEqual(rows.map((row) => [row.key, row.count, row.other ?? false]), [["C04", 4, false], [null, 4, true]]);
});

// Real data (ema_therapeutic_area_branches.json, ema_therapeutic_area_subtree.json and, when the
// pipeline has written it, mesh_descriptor_notes.json).
const dataFile = (name) => new URL(`../public/data/${name}`, import.meta.url);
const realFiles = ["ema_therapeutic_area_branches.json", "ema_therapeutic_area_subtree.json"].map(dataFile);
const notesFile = dataFile("mesh_descriptor_notes.json");
test(
  "area tree (real data): every level lists its children in MeSH tree order; root tags are no one's children",
  { skip: realFiles.every(existsSync) ? false : "therapeutic area data files not found" },
  () => {
    const [branches, subtree] = realFiles.map((file) => JSON.parse(readFileSync(file, "utf8")));
    const notes = existsSync(notesFile) ? JSON.parse(readFileSync(notesFile, "utf8")) : null;
    const real = buildAreaTree(branches, subtree, notes);
    // Each child's tree number under its parent (a node's key; a term's descriptor's number under
    // it, null without one): non-decreasing, the unnumbered ones last by name.
    const numbersOf = new Map((notes ?? []).map((row) => [row.mesh_descriptor_ui, row.tree_numbers]));
    const uiOf = new Map(branches.map((row) => [row.therapeutic_area_mesh, row.mesh_descriptor_ui]));
    const numberUnder = (key, parent) => (!real.isTerm(key) ? key
      : (numbersOf.get(uiOf.get(key)) ?? []).filter((number) => number === parent || number.startsWith(`${parent}.`)).sort()[0] ?? null);
    const outOfOrder = (parent) => {
      const children = real.children(parent);
      return children.some((key, index) => {
        if (index === 0) return false;
        const [before, after] = [numberUnder(children[index - 1], parent), numberUnder(key, parent)];
        if (before === null) return after !== null || real.name(children[index - 1]).localeCompare(real.name(key)) > 0;
        return after !== null && before > after;
      });
    };
    assert.deepEqual(real.roots, [...real.roots].sort());
    const keys = [null, ...real.names.keys()];
    assert.deepEqual(keys.filter(outOfOrder), []);
    if (notes) {
      // With the notes, every term under a node has its tree number there, the one its row shows.
      assert.deepEqual(keys.filter((key) => key !== null && real.children(key).some((child) => numberUnder(child, key) === null)), []);
      assert.deepEqual(keys.filter((key) => key !== null && real.children(key).some((child) => real.number(child, key) !== numberUnder(child, key))), []);
    }
    assert.deepEqual(areaTreeSearch(real, new Set(real.names.keys()), "C04.588").matches, ["C04.588"]);
    // Owner decision 2026-09-29: grouped by MeSH category, each by NLM's name, its branches those of
    // its letter (on 2026-09-28: A, B, C, D, E, F, G and N).
    assert.deepEqual(real.roots, [...new Set(real.branches.map((branch) => branch[0]))].sort());
    assert.deepEqual(["A", "C", "F"].filter((key) => !real.roots.includes(key)), []);
    assert.deepEqual(real.roots.filter((key) => real.name(key) === key), []);
    assert.deepEqual(real.roots.filter((key) => real.children(key).some((branch) => branch[0] !== key || real.parent(branch) !== key)), []);
    assert.deepEqual(real.roots.flatMap((key) => real.children(key)), real.branches);
    const rootTags = real.branches.flatMap((key) => real.rootTerms(key));
    assert.deepEqual(real.rootTerms("C04"), ["Neoplasms", "Cancer"]);
    assert.deepEqual(rootTags.filter((term) => keys.some((key) => real.children(key).includes(term))), []);
    assert.deepEqual(rootTags.filter((term) => real.canonical(term).join() !== term), []);
  },
);

test(
  "branch chips (real data): Adrenoleukodystrophy's four branches; pressed exactly as inAreas() for every branch",
  { skip: realFiles.every(existsSync) ? false : "therapeutic area data files not found" },
  () => {
    const [branches, subtree] = realFiles.map((file) => JSON.parse(readFileSync(file, "utf8")));
    const real = buildAreaTree(branches, subtree);
    const chips = termBranches(branches);
    assert.deepEqual(chips.of("Adrenoleukodystrophy"), ["C10", "C16", "C18", "C19"]);
    assert.deepEqual(branchChips(chips.of("Adrenoleukodystrophy")).rest, ["C18", "C19"]);
    assert.deepEqual(branchChips(chips.of("Adrenoleukodystrophy"), ["C18"]), { shown: ["C10", "C18"], rest: ["C16", "C19"] });
    assert.deepEqual(chips.of("Cancer"), ["C04"]);
    // Every term's chips are the branches above it in the tree.
    const terms = [...new Set(branches.map((row) => row.therapeutic_area_mesh))];
    const differs = terms.filter((term) => chips.of(term).join() !== [...real.ancestors(term)].filter((key) => real.branches.includes(key)).sort().join());
    assert.deepEqual(differs, []);
    for (const selected of [[], ["C"], ["F"], ["C04"], ["C10", "F03"], ["C04.588"], ["Psoriasis"], ["Cancer"]]) {
      assert.deepEqual(real.branches.filter((key) => branchSelected(selected, key) !== inAreas(real, selected, key)), [], String(selected));
      assert.deepEqual(real.branches.filter((key) => (branchIncludedIn(selected, key) !== null) !== (areaCheckState(real, key, selected) === "included")), [], String(selected));
    }
  },
);
