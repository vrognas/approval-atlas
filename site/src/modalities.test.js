import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { UI } from "./labels.js";
import {
  NOT_CLASSIFIED,
  buildModalityTree,
  evidenceDocument,
  modalityBreakdownRows,
  modalityCheckState,
  modalityIncludedIn,
  modalityLines,
  modalitySource,
  modalityTip,
  modalityTipId,
  modalityTreeChildren,
  modalityTreeKeys,
  modalityTreeSearch,
  toggleModality,
} from "./modalities.js";

// modalities.json as the spec's data contract gives it (2026-09-29, section 2): one row per node in
// tree order; Small molecule is a group without modalities under it.
const TAXONOMY = [
  ["small_molecule"],
  ["protein"], ["peptide", "protein"], ["hormone_cytokine", "protein"], ["enzyme", "protein"], ["coagulation_factor", "protein"],
  ["fusion_protein", "protein"], ["other_protein", "protein"],
  ["antibody"], ["monoclonal_antibody", "antibody"], ["adc", "antibody"], ["bispecific_antibody", "antibody"], ["antibody_fragment", "antibody"],
  ["polyclonal_immunoglobulin", "antibody"],
  ["nucleic_acid"], ["mrna", "nucleic_acid"], ["sirna", "nucleic_acid"], ["antisense", "nucleic_acid"], ["aptamer", "nucleic_acid"],
  ["other_oligonucleotide", "nucleic_acid"],
  ["cell_gene"], ["car_t", "cell_gene"], ["gene_modified_cells", "cell_gene"], ["gene_therapy", "cell_gene"], ["other_cell_therapy", "cell_gene"],
  ["tissue_engineered", "cell_gene"],
  ["vaccine"], ["live_vaccine", "vaccine"], ["inactivated_vaccine", "vaccine"], ["vector_vaccine", "vaccine"],
  ["radiopharmaceutical"], ["diagnostic_radiopharmaceutical", "radiopharmaceutical"], ["therapeutic_radiopharmaceutical", "radiopharmaceutical"],
  ["other"], ["allergen", "other"], ["polysaccharide", "other"], ["plant_extract", "other"], ["polymer", "other"],
].map(([key, group = null], index) => ({ key, kind: group ? "modality" : "group", group_key: group, order: index + 1 }));

// ema_medicine_modalities.json rows (the spec's examples: Leqvio, Tresiba, Glivec, Emerflu; Xultophy
// with two substances; a withdrawn application without substance data).
const row = (number, substance, group, modality, source = null, rule = null, evidence = null, extra = {}) => ({
  ema_product_number: number,
  substance_key: substance,
  substance_basis: substance ? "inn" : "none",
  modality_group: group,
  modality,
  source,
  rule,
  evidence,
  leaf_source: null,
  leaf_rule: null,
  ...extra,
});
const LEQVIO = row("EMEA/H/C/005333", "inclisiran", "nucleic_acid", "sirna", "inn_stem", "stem:-siran");
const TRESIBA = row("EMEA/H/C/002498", "insulin degludec", "protein", "hormone_cytokine", "inn_stem", "inn_group:insulin");
const GLIVEC = row("EMEA/H/C/000406", "imatinib", "small_molecule", "small_molecule", "chembl", "chembl:Small molecule", "CHEMBL941 ChEMBL_37");
const EMERFLU = row("EMEA/H/C/000859", null, "vaccine", null, "atc", "atc:J07BB", "J07BB");
const XULTOPHY = [
  row("EMEA/H/C/002647", "insulin degludec", "protein", "hormone_cytokine", "inn_stem", "inn_group:insulin"),
  row("EMEA/H/C/002647", "liraglutide", "protein", "peptide", "inn_stem", "stem:-tide"),
];
const UNCLASSIFIED = row("EMEA/H/C/000999", null, null, null);

const tree = buildModalityTree(TAXONOMY);

test("the modality tree: groups in tree order, each with its modalities; Small molecule has none", () => {
  assert.deepEqual(tree.roots, ["small_molecule", "protein", "antibody", "nucleic_acid", "cell_gene", "vaccine", "radiopharmaceutical", "other"]);
  assert.deepEqual(tree.children(null), tree.roots);
  assert.deepEqual(tree.children("protein"), ["peptide", "hormone_cytokine", "enzyme", "coagulation_factor", "fusion_protein", "other_protein"]);
  assert.deepEqual(tree.children("antibody"), ["monoclonal_antibody", "adc", "bispecific_antibody", "antibody_fragment", "polyclonal_immunoglobulin"]);
  assert.deepEqual(tree.children("small_molecule"), []);
  assert.deepEqual(tree.children("sirna"), []);
  assert.equal(tree.parent("bispecific_antibody"), "antibody");
  assert.equal(tree.parent("antibody"), null);
  assert.equal(tree.parent("unknown"), null);
  assert.equal(tree.isGroup("small_molecule"), true);
  assert.equal(tree.isGroup("sirna"), false);
  assert.equal(tree.has("sirna"), true);
  assert.equal(tree.has("unknown"), false);
  assert.deepEqual([...tree.ancestors("bispecific_antibody")], ["antibody"]);
  assert.deepEqual([...tree.ancestors("antibody")], []);
  assert.deepEqual(tree.path("bispecific_antibody"), ["antibody", "bispecific_antibody"]);
  assert.deepEqual(tree.path("small_molecule"), ["small_molecule"]);
  assert.equal(tree.keys.length, 38);
  // Rows given out of order still build in tree order.
  assert.deepEqual(buildModalityTree([...TAXONOMY].reverse()).roots, tree.roots);
});

test("modality names and explainers: every key has both, each explainer at most 12 words", () => {
  const keys = TAXONOMY.map((node) => node.key).sort();
  assert.deepEqual(Object.keys(UI.modalities).sort(), keys);
  assert.deepEqual(Object.keys(UI.modalityTips).sort(), keys);
  const tips = [...Object.values(UI.modalityTips), UI.modality.groupOnlyTip, UI.modality.notClassifiedTip];
  for (const tip of tips) {
    assert.ok(tip.split(" ").length <= 12, tip);
    assert.ok(!tip.includes("—"), tip);
    assert.match(tip, /\.$/, tip);
  }
  assert.equal(tree.name("adc"), "Antibody-drug conjugate");
  assert.equal(tree.name("protein"), "Protein and peptide");
  // R10 (user decision 2026-09-29): no amino-acid limit in the peptide explainer.
  assert.doesNotMatch(UI.modalityTips.peptide, /40/);
  assert.deepEqual(modalityTip("sirna"), { text: UI.modalityTips.sirna, id: "modality-tip-sirna" });
  assert.equal(modalityTipId("car_t"), "modality-tip-car_t");
  assert.equal(modalityTip("unknown"), null);
});

const dataFile = (name) => new URL(`../public/data/${name}`, import.meta.url);
test(
  "the real taxonomy file has the keys the labels name, in a valid tree",
  { skip: existsSync(dataFile("modalities.json")) ? false : "modalities.json not found" },
  () => {
    const rows = JSON.parse(readFileSync(dataFile("modalities.json"), "utf8"));
    assert.deepEqual(rows.map((node) => node.key).sort(), Object.keys(UI.modalities).sort());
    const real = buildModalityTree(rows);
    for (const node of rows.filter((item) => item.kind !== "group")) assert.equal(real.isGroup(node.group_key), true, node.key);
  },
);

test(
  "every modality of the real medicine file is in the taxonomy, a modality under its own group",
  { skip: ["modalities.json", "ema_medicine_modalities.json"].every((name) => existsSync(dataFile(name))) ? false : "modality files not found" },
  () => {
    const real = buildModalityTree(JSON.parse(readFileSync(dataFile("modalities.json"), "utf8")));
    const rows = JSON.parse(readFileSync(dataFile("ema_medicine_modalities.json"), "utf8"));
    const bad = rows.filter((item) => (item.modality_group !== null && !real.isGroup(item.modality_group))
      || (item.modality !== null && item.modality !== item.modality_group && real.parent(item.modality) !== item.modality_group));
    assert.deepEqual(bad, []);
  },
);

test(
  "every source of the real medicine file reads as words on the card, never a raw rule or a bare host",
  { skip: existsSync(dataFile("ema_medicine_modalities.json")) ? false : "ema_medicine_modalities.json not found" },
  () => {
    const rows = JSON.parse(readFileSync(dataFile("ema_medicine_modalities.json"), "utf8"));
    const sources = rows.flatMap((item) => [
      modalitySource(item.source, item.rule, item.evidence),
      modalitySource(item.leaf_source, item.leaf_rule),
    ]).filter(Boolean);
    const raw = sources.filter((source) => !UI.modality.sources[source.kind]);
    assert.deepEqual(raw, []);
    const hosts = sources.filter((source) => source.kind === "curated" && !UI.modality.documents[source.document?.kind]);
    assert.deepEqual(hosts.map((source) => source.url), []);
  },
);

test("a medicine's keys: every group and modality of its substances; static rows: group only, not classified", () => {
  assert.deepEqual(tree.keysOf([LEQVIO]), ["nucleic_acid", "sirna"]);
  assert.deepEqual(tree.exactOf([LEQVIO]), []);
  // Small molecule: the group only, which is also its modality.
  assert.deepEqual(tree.keysOf([GLIVEC]), ["small_molecule"]);
  assert.deepEqual(tree.exactOf([GLIVEC]), []);
  // A source names the group, none the modality: the group's "not more specific" row.
  assert.deepEqual(tree.keysOf([EMERFLU]), ["vaccine"]);
  assert.deepEqual(tree.exactOf([EMERFLU]), ["vaccine"]);
  // Several substances: each counts once per modality and once per group.
  assert.deepEqual(tree.keysOf(XULTOPHY).sort(), ["hormone_cytokine", "peptide", "protein"]);
  assert.deepEqual(tree.exactOf(XULTOPHY), []);
  // No source (or no row at all): not classified.
  assert.deepEqual(tree.keysOf([UNCLASSIFIED]), []);
  assert.deepEqual(tree.exactOf([UNCLASSIFIED]), [NOT_CLASSIFIED]);
  assert.deepEqual(tree.exactOf([]), [NOT_CLASSIFIED]);
  // A modality outside its group (the build stops on it) counts as the group only.
  assert.deepEqual(tree.keysOf([row("X", "x", "protein", "sirna")]), ["protein"]);
  assert.deepEqual(tree.exactOf([row("X", "x", "protein", "sirna")]), ["protein"]);
});

test("checkbox states: checked, included under a checked group, mixed above a checked modality", () => {
  assert.equal(modalityCheckState(tree, "antibody", ["antibody"]), "checked");
  assert.equal(modalityCheckState(tree, "adc", ["antibody"]), "included");
  assert.equal(modalityIncludedIn(tree, "adc", ["antibody"]), "antibody");
  assert.equal(modalityIncludedIn(tree, "antibody", ["antibody"]), null);
  assert.equal(modalityCheckState(tree, "antibody", ["adc"]), "mixed");
  assert.equal(modalityCheckState(tree, "protein", ["adc"]), "unchecked");
  assert.equal(modalityCheckState(tree, "mrna", []), "unchecked");
});

test("toggling a modality: removes it, or adds it in place of the values it covers or is covered by", () => {
  assert.deepEqual(toggleModality(tree, ["antibody"], "antibody"), []);
  assert.deepEqual(toggleModality(tree, ["adc", "sirna"], "antibody"), ["sirna", "antibody"]);
  assert.deepEqual(toggleModality(tree, ["antibody", "sirna"], "adc"), ["sirna", "adc"]);
  assert.deepEqual(toggleModality(tree, ["sirna"], "mrna"), ["sirna", "mrna"]);
});

test("tree rows: groups and modalities with medicines, plus the selection and its group", () => {
  const counts = new Map([["antibody", 3], ["monoclonal_antibody", 2], ["adc", 0], ["small_molecule", 5]]);
  const visible = modalityTreeKeys(tree, counts, ["mrna"]);
  assert.deepEqual([...visible].sort(), ["antibody", "monoclonal_antibody", "mrna", "nucleic_acid", "small_molecule"]);
  assert.deepEqual(modalityTreeChildren(tree, null, visible), ["small_molecule", "antibody", "nucleic_acid"]);
  assert.deepEqual(modalityTreeChildren(tree, "antibody", visible), ["monoclonal_antibody"]);
});

test("the tree's search: matching groups, then matching modalities of other groups, with their groups open", () => {
  const visible = new Set(tree.keys);
  assert.equal(modalityTreeSearch(tree, visible, "  "), null);
  const rna = modalityTreeSearch(tree, visible, "rna");
  assert.deepEqual(rna.matches, ["mrna", "sirna"]);
  assert.deepEqual([...rna.open], ["nucleic_acid"]);
  assert.equal(rna.shows(null, "nucleic_acid"), true);
  assert.equal(rna.shows(null, "protein"), false);
  assert.equal(rna.shows("nucleic_acid", "mrna"), true);
  assert.equal(rna.shows("nucleic_acid", "aptamer"), false);
  // A matching group shows every modality under it; its own matching modalities are not matches.
  const antibody = modalityTreeSearch(tree, visible, "antibod");
  assert.deepEqual(antibody.matches, ["antibody"]);
  assert.equal(antibody.shows("antibody", "adc"), true);
  // Keys match too ("adc", "car t"); fewer than 3 characters match nothing.
  assert.deepEqual(modalityTreeSearch(tree, visible, "ADC").matches, ["adc"]);
  assert.deepEqual(modalityTreeSearch(tree, visible, "car-t").matches, ["car_t"]);
  assert.deepEqual(modalityTreeSearch(tree, visible, "mr").matches, []);
  // Hidden rows are not searched.
  assert.deepEqual(modalityTreeSearch(tree, new Set(["nucleic_acid", "mrna"]), "rna").matches, ["mrna"]);
});

// Products as buildProducts() gives them: modalityKeys (keysOf()) and modalityExact (exactOf()).
const product = (rows) => ({ modalityKeys: tree.keysOf(rows), modalityExact: tree.exactOf(rows) });
const products = [product([LEQVIO]), product([TRESIBA]), product(XULTOPHY), product([GLIVEC]), product([GLIVEC]), product([EMERFLU]), product([UNCLASSIFIED])];

test("breakdown rows: groups most first (ties in tree order), then the medicines not classified; a group's modalities, then its group only row", () => {
  assert.deepEqual(modalityBreakdownRows(tree, null, products), [
    { key: "small_molecule", label: "Small molecule", count: 2, rank: 0 },
    { key: "protein", label: "Protein and peptide", count: 2, rank: 1 },
    { key: "nucleic_acid", label: "Nucleic acid", count: 1, rank: 3 },
    { key: "vaccine", label: "Vaccine", count: 1, rank: 5 },
    { key: NOT_CLASSIFIED, label: "Not classified", count: 1, static: true, incomplete: true },
  ]);
  assert.deepEqual(modalityBreakdownRows(tree, "protein", products), [
    { key: "hormone_cytokine", label: "Hormone, cytokine or growth factor", count: 2, rank: 1 },
    { key: "peptide", label: "Peptide", count: 1, rank: 0 },
  ]);
  assert.deepEqual(modalityBreakdownRows(tree, "vaccine", products), [
    { key: "vaccine", label: "not more specific", count: 1, static: true, incomplete: true },
  ]);
  // A modality, or a group without modalities: shown alone (none here).
  assert.deepEqual(modalityBreakdownRows(tree, "sirna", products), []);
  assert.deepEqual(modalityBreakdownRows(tree, "small_molecule", products), []);
});

test("a classification's source, as the card names it", () => {
  assert.deepEqual(modalitySource("inn_stem", "stem:-siran"), { kind: "stem", stem: "-siran" });
  assert.deepEqual(modalitySource("inn_stem", "stem:-cel (one word)"), { kind: "stem", stem: "-cel" });
  assert.deepEqual(modalitySource("inn_stem", "inn_group:insulin"), { kind: "innGroup", name: "insulin" });
  assert.deepEqual(modalitySource("inn_stem", "inn:radionuclide (177lu)"), { kind: "radionuclide", nuclide: "177Lu" });
  assert.deepEqual(modalitySource("inn_stem", "inn:radionuclide (99mtc)"), { kind: "radionuclide", nuclide: "99mTc" });
  // ATryn (EMEA/H/C/000587): a Greek letter as the INN's second word, WHO's naming of proteins.
  assert.deepEqual(modalitySource("inn_stem", "inn:greek second word (alfa)"), { kind: "greek", letter: "alfa" });
  assert.deepEqual(modalitySource("inn_stem", "inn:greek second word (beta-1a)"), { kind: "greek", letter: "beta-1a" });
  assert.deepEqual(modalitySource("chembl", "chembl:Small molecule", "CHEMBL941 ChEMBL_37"), {
    kind: "chembl", id: "CHEMBL941", release: "ChEMBL_37", type: "Small molecule", url: "https://www.ebi.ac.uk/chembl/explore/compound/CHEMBL941",
  });
  assert.deepEqual(modalitySource("chembl", "chembl:Protein", null), { kind: "chembl", id: null, release: null, type: "Protein", url: null });
  assert.deepEqual(modalitySource("atc", "atc:V09IA01", "V09IA01"), { kind: "atc", code: "V09IA01" });
  assert.deepEqual(modalitySource("atc", "atc:J07BB", null), { kind: "atc", code: "J07BB" });
  assert.deepEqual(modalitySource("ema_atmp", "ema_atmp:advanced_therapy"), { kind: "atmp" });
  assert.deepEqual(modalitySource("ema_text", "text:vaccine live"), { kind: "text", detail: "vaccine live" });
  const url = "https://www.ema.europa.eu/en/documents/assessment-report/kymriah-epar-public-assessment-report_en.pdf";
  assert.deepEqual(modalitySource("curated", "curated", url), { kind: "curated", url, document: { kind: "epar" } });
  assert.deepEqual(modalitySource("curated", "curated", "http://example.org/x"), { kind: "curated", url: null, document: null });
  assert.deepEqual(modalitySource("something_new", "new:rule"), { kind: "other", detail: "new:rule" });
  assert.equal(modalitySource(null, null), null);
});

test("a curated row's evidence is named by the document it links to", () => {
  const ema = (path) => evidenceDocument(`https://www.ema.europa.eu/en/documents/${path}`);
  assert.deepEqual(ema("product-information/blincyto-epar-product-information_en.pdf"), { kind: "productInformation" });
  assert.deepEqual(ema("assessment-report/trulicity-epar-public-assessment-report_en.pdf"), { kind: "epar" });
  assert.deepEqual(ema("assessment-report/mycograb-epar-refusal-public-assessment-report_en.pdf"), { kind: "refusal" });
  assert.deepEqual(ema("scientific-discussion/macugen-epar-scientific-discussion_en.pdf"), { kind: "scientificDiscussion" });
  // The other EMA pages curated rows cite (2026-09-29): withdrawal assessment reports (Skycovion's
  // filed as a variation report), questions and answers, a CHMP summary of opinion, a medicine page.
  for (const path of [
    "withdrawal-report/withdrawal-assessment-report-entolimod-tmc_en.pdf",
    "withdrawal-report/withdrawal-assessment-report-izelvay_en.pdf",
    "withdrawal-report/withdrawal-assessment-report-rayoqta_en.pdf",
    "withdrawal-report/withdrawal-assessment-report-surfaxin_en.pdf",
    "variation-report/skycovion-epar-withdrawal-assessment-report_en.pdf",
  ]) assert.deepEqual(ema(path), { kind: "withdrawalReport" }, path);
  assert.deepEqual(ema("medicine-qa/questions-and-answers-withdrawal-marketing-application-gastromotal_en.pdf"), { kind: "questionsAnswers" });
  assert.deepEqual(ema("medicine-qa/questions-and-answers-withdrawal-marketing-application-riquent_en.pdf"), { kind: "questionsAnswers" });
  assert.deepEqual(ema("smop-initial/chmp-summary-positive-opinion-lyrokaul_en.pdf"), { kind: "summaryOfOpinion" });
  assert.deepEqual(evidenceDocument("https://www.ema.europa.eu/en/medicines/human/EPAR/rotashield"), { kind: "medicinePage" });
  // Another EMA page: by its host, as before.
  assert.deepEqual(evidenceDocument("https://www.ema.europa.eu/en/about-us"), { kind: "other", host: "www.ema.europa.eu" });
  assert.deepEqual(evidenceDocument("https://pubmed.ncbi.nlm.nih.gov/38142486/"), { kind: "pubmed", id: "38142486" });
  assert.deepEqual(evidenceDocument("https://www.ebi.ac.uk/chembl/explore/compound/CHEMBL928"), { kind: "chembl", id: "CHEMBL928" });
  assert.deepEqual(evidenceDocument("https://www.ebi.ac.uk/chembl/api/data/molecule/CHEMBL4297586.json"), { kind: "chembl", id: "CHEMBL4297586" });
  assert.deepEqual(evidenceDocument("https://example.org/page"), { kind: "other", host: "example.org" });
  assert.equal(evidenceDocument("not a url"), null);
});

test("the card's lines: one per distinct modality, naming its substances; none classified reads so", () => {
  assert.deepEqual(modalityLines(tree, [LEQVIO]), [{ group: "nucleic_acid", modality: "sirna", substances: ["inclisiran"], row: LEQVIO }]);
  assert.deepEqual(modalityLines(tree, [GLIVEC]), [{ group: "small_molecule", modality: "small_molecule", substances: ["imatinib"], row: GLIVEC }]);
  assert.deepEqual(modalityLines(tree, [EMERFLU]), [{ group: "vaccine", modality: null, substances: [], row: EMERFLU }]);
  assert.deepEqual(modalityLines(tree, XULTOPHY).map((line) => [line.modality, line.substances]), [
    ["hormone_cytokine", ["insulin degludec"]], ["peptide", ["liraglutide"]],
  ]);
  // Two substances of one modality: one line.
  const combination = [row("Y", "a", "small_molecule", "small_molecule"), row("Y", "b", "small_molecule", "small_molecule")];
  assert.deepEqual(modalityLines(tree, combination).map((line) => line.substances), [["a", "b"]]);
  assert.deepEqual(modalityLines(tree, [UNCLASSIFIED]), [{ group: null, modality: null, substances: [], row: UNCLASSIFIED }]);
  assert.deepEqual(modalityLines(tree, []), [{ group: null, modality: null, substances: [], row: null }]);
});
