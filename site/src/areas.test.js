import { test } from "node:test";
import assert from "node:assert/strict";
import {
  areaBreakdownRows,
  areaCheckState,
  areaIncludedIn,
  areaTreeChildren,
  areaTreeKeys,
  areaTreeSearch,
  buildAreaTree,
  inAreas,
  toggleArea,
} from "./areas.js";

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

test("area tree: MeSH branches by name, then level-2 and level-3 nodes, EMA's terms as leaves", () => {
  assert.deepEqual(tree.roots, ["C05", "C04", "C17"]); // Musculoskeletal, Neoplasms, Skin (by name)
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

test("area tree: a term matched at a branch root is that branch (no leaf 'Neoplasms › Neoplasms')", () => {
  assert.deepEqual(tree.children("C04"), ["C04.588"]);
  // The heading and its entry term: the branch's "not more specific" medicines.
  assert.deepEqual(tree.exact("C04"), ["Cancer", "Neoplasms"]);
  assert.deepEqual(tree.parents("Cancer"), []);
  assert.deepEqual(tree.exactOf(["Cancer", "Psoriasis"]), ["C04"]);
  assert.deepEqual(areaTreeSearch(tree, everyKey, "cancer").matches, ["C04"]);
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

test("area tree: a term that is a node or branch is selected as it; other keys as themselves", () => {
  assert.deepEqual(tree.canonical("Breast Neoplasms"), ["C04.588.180"]);
  assert.deepEqual(tree.canonical("Cancer"), ["C04"]);
  assert.deepEqual(tree.canonical("Arthritis, Juvenile Rheumatoid"), ["C05.799.056"]);
  assert.deepEqual(alcohol.canonical("Alcohol-Related Disorders"), ["C25.775.100", "F03.900.100"]);
  assert.deepEqual(tree.canonical("Psoriasis"), ["Psoriasis"]);
  assert.deepEqual(tree.canonical("C17.800"), ["C17.800"]);
  assert.deepEqual(tree.canonical("Unmatched term"), ["Unmatched term"]);
});

test("area tree: ancestors over every path, keys and exact nodes per product", () => {
  assert.deepEqual([...tree.ancestors("C17.800.859")].sort(), ["C17", "C17.800"]);
  assert.deepEqual([...tree.ancestors("Breast Neoplasms")].sort(), ["C04", "C04.588", "C04.588.180", "C17", "C17.800", "C17.800.090"]);
  assert.deepEqual([...tree.ancestors("C04")], []);
  assert.deepEqual(tree.keysOf(["Psoriasis", "Cancer"]).sort(), ["C04", "C17", "C17.800", "C17.800.859", "Cancer", "Psoriasis"]);
  assert.deepEqual(tree.keysOf(["Unmatched term"]), ["Unmatched term"]);
  assert.deepEqual(tree.exactOf(["Breast Neoplasms", "Psoriasis"]), ["C04.588.180"]);
  // The path follows the first parent in tree order.
  assert.deepEqual(tree.path("Breast Neoplasms"), ["C17", "C17.800", "C17.800.090", "Breast Neoplasms"]);
  assert.deepEqual(tree.path("C04.588.180"), ["C04", "C04.588", "C04.588.180"]);
  assert.equal(tree.parent("C04.588"), "C04");
  assert.equal(tree.parent("C04"), null);
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
  assert.deepEqual(toggleArea(tree, ["C04.588"], "Cancer"), ["C04"]);
  assert.deepEqual(toggleArea(alcohol, ["C25.775.100"], "Alcohol-Related Disorders"), ["C25.775.100", "F03.900.100"]);
  assert.deepEqual(toggleArea(alcohol, ["C25.775.100", "F03.900.100", "C17"], "Alcohol-Related Disorders"), ["C17"]);
});

test("inAreas: a term within the selection (itself or under a selected node)", () => {
  assert.equal(inAreas(tree, ["C17"], "Psoriasis"), true);
  assert.equal(inAreas(tree, ["Psoriasis"], "Psoriasis"), true);
  assert.equal(inAreas(tree, ["C04"], "Psoriasis"), false);
});

test("area tree nodes: those with medicines plus the selection and its ancestors", () => {
  const counts = new Map([["C17", 2], ["C17.800", 2], ["C17.800.859", 2], ["Psoriasis", 2], ["C04", 0]]);
  const keys = areaTreeKeys(tree, counts, ["Triple Negative Breast Neoplasms"]);
  assert.deepEqual([...keys].sort(), ["C04", "C04.588", "C04.588.180", "C17", "C17.800", "C17.800.090", "C17.800.859", "Psoriasis", "Triple Negative Breast Neoplasms"]);
  assert.deepEqual(areaTreeChildren(tree, null, keys), ["C04", "C17"]);
  assert.deepEqual(areaTreeChildren(tree, "C04.588.180", keys), ["Triple Negative Breast Neoplasms"]);
});

test("area tree search: matching nodes and leaves with their levels opened, a match's subtree shown", () => {
  assert.equal(areaTreeSearch(tree, everyKey, "  "), null);
  const found = areaTreeSearch(tree, everyKey, "breast");
  // The node Breast Neoplasms and the node Breast Diseases; the leaves under them are not matches of their own.
  assert.deepEqual(found.matches, ["C04.588.180", "C17.800.090"]);
  assert.deepEqual([...found.open].sort(), ["C04", "C04.588", "C17", "C17.800"]);
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

const product = (areas) => ({ areas, areaKeys: tree.keysOf(areas), areaExact: tree.exactOf(areas) });

test("area breakdown: the level below a node, most first, then the medicines at the node itself", () => {
  const products = [product(["Breast Neoplasms"]), product(["Triple Negative Breast Neoplasms"]), product(["Psoriasis", "Cancer"])];
  assert.deepEqual(areaBreakdownRows(tree, null, products).map((row) => [row.key, row.count]), [["C04", 3], ["C17", 3]]);
  assert.deepEqual(areaBreakdownRows(tree, "C04.588.180", products), [
    { key: "Triple Negative Breast Neoplasms", label: "Triple Negative Breast Neoplasms", count: 1 },
    { key: "C04.588.180", label: "not more specific", count: 1, static: true, incomplete: true },
  ]);
  // A branch ends with its own medicines too (tagged Cancer or Neoplasms).
  assert.deepEqual(areaBreakdownRows(tree, "C04", products), [
    { key: "C04.588", label: "Neoplasms by Site", count: 2 },
    { key: "C04", label: "not more specific", count: 1, static: true, incomplete: true },
  ]);
  // A leaf has no rows of its own; the breakdown shows it alone.
  assert.deepEqual(areaBreakdownRows(tree, "Psoriasis", products), []);
  // Beyond n rows: one Other row counting each medicine once.
  const rows = areaBreakdownRows(tree, null, products, 1);
  assert.deepEqual(rows.map((row) => [row.key, row.count, row.other ?? false]), [["C04", 3, false], [null, 3, true]]);
});
