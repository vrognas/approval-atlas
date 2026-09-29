import { test } from "node:test";
import assert from "node:assert/strict";
import { areaNote, buildMeshNotes, meshTipText, scopeNoteLead } from "./mesh-notes.js";

// Rows in the form of mesh_descriptor_notes.json (NLM's scope notes, MeSH 2026).
const row = (ui, name, numbers, note) => ({ mesh_descriptor_ui: ui, mesh_descriptor_name: name, tree_numbers: numbers, scope_note: note, source: "nlm_mesh" });
const psoriasis = row("D011565", "Psoriasis", ["C17.800.859.675"],
  "A common genetically determined, chronic, inflammatory skin disease characterized by rounded erythematous, dry, scaling patches. The lesions have a predilection for nails, scalp, genitalia, extensor surfaces, and the lumbosacral region. Accelerated epidermopoiesis is considered to be the fundamental pathologic feature in psoriasis.");
const neoplasms = row("D009369", "Neoplasms", ["C04"],
  "New abnormal growth of tissue. Malignant neoplasms show a greater degree of anaplasia and have the properties of invasion and metastasis, compared to benign neoplasms.");
const breast = row("D001943", "Breast Neoplasms", ["C04.588.180", "C17.800.090.500"], "Tumors or cancer of the human BREAST.");
const bySite = row("D009371", "Neoplasms by Site", ["C04.588"], null);
// A branch without a category descriptor: no descriptor, no note.
const noDescriptor = row(null, null, ["C26"], null);
const notes = buildMeshNotes([bySite, breast, neoplasms, psoriasis, noDescriptor]);

test("buildMeshNotes: by descriptor and by tree number; no rows (a missing file) is empty", () => {
  assert.equal(notes.byUi.get("D001943"), breast);
  assert.equal(notes.byTreeNumber.get("C17.800.090.500"), breast);
  assert.equal(notes.byTreeNumber.get("C04"), neoplasms);
  assert.equal(notes.byTreeNumber.get("C26"), noDescriptor);
  assert.equal(notes.byUi.has(null), false);
  assert.deepEqual(notes.rows.length, 5);
  assert.equal(buildMeshNotes(null).byUi.size, 0);
});

test("areaNote: a term by its descriptor, a branch or tree node by the descriptor holding that number", () => {
  const uiOf = new Map([["Psoriasis", "D011565"], ["Cancer", "D009369"]]);
  const noteOf = (key) => areaNote(notes, key, (term) => uiOf.get(term));
  assert.equal(noteOf("Psoriasis"), psoriasis);
  // An entry term: its descriptor's note.
  assert.equal(noteOf("Cancer"), neoplasms);
  assert.equal(noteOf("C04"), neoplasms);
  assert.equal(noteOf("C04.588.180"), breast);
  assert.equal(noteOf("Unknown term"), null);
  assert.equal(areaNote(null, "C04", () => undefined), null);
});

test("scopeNoteLead: whole sentences up to 200 characters, else the first cut at a word", () => {
  assert.equal(scopeNoteLead(neoplasms.scope_note), neoplasms.scope_note);
  assert.equal(scopeNoteLead(psoriasis.scope_note), "A common genetically determined, chronic, inflammatory skin disease characterized by rounded erythematous, dry, scaling patches.");
  // A period before a lower-case word ("e.g. rash") does not end a sentence.
  const abbreviation = `Reactions, e.g. rash or fever, ${"x".repeat(170)} end. Next sentence.`;
  assert.equal(scopeNoteLead(abbreviation).endsWith("…"), true);
  const long = `${"word ".repeat(60)}end.`;
  const lead = scopeNoteLead(long);
  assert.equal(lead.length <= 201, true);
  assert.equal(lead, `${"word ".repeat(40).trim()}…`);
});

// Step 4 review: "St. Louis" inside a parenthesis cut the tooltip mid-parenthesis ("…viral
// encephalitis (e.g., Japanese and St."). Real note (D000096724, mesh_descriptor_notes.json).
test("scopeNoteLead: no end inside open parentheses or after an abbreviation", () => {
  const mosquito = "Infectious diseases transmitted by mosquito vectors. Mosquito-borne human viral diseases include Chikungunya, Dengue, viral encephalitis (e.g., Japanese and St. Louis types), West Nile, Yellow fever, Zika virus infections. Mosquito-borne human parasitic diseases include malaria and lymphatic filariasis. Equine encephalomyelitis and dirofilariasis are mosquito-borne viral diseases mostly in animals.";
  assert.equal(scopeNoteLead(mosquito), "Infectious diseases transmitted by mosquito vectors.");
  // An abbreviation outside parentheses ("St. Louis") does not end one either: the cut at a word.
  const saint = `Outbreaks in St. Louis and ${"x ".repeat(90)}end. Next sentence.`;
  assert.equal(scopeNoteLead(saint).endsWith("…"), true);
  // A real end after a closed parenthesis still counts.
  const closed = `Tumors (benign or malignant). More ${"x ".repeat(90)}end.`;
  assert.equal(scopeNoteLead(closed), "Tumors (benign or malignant).");
});

test("meshTipText: name, tree numbers and the note's lead; none without a scope note", () => {
  assert.equal(meshTipText(breast), "Breast Neoplasms (MeSH C04.588.180, C17.800.090.500): Tumors or cancer of the human BREAST.");
  assert.equal(meshTipText(psoriasis), "Psoriasis (MeSH C17.800.859.675): A common genetically determined, chronic, inflammatory skin disease characterized by rounded erythematous, dry, scaling patches.");
  assert.equal(meshTipText(bySite), null);
  assert.equal(meshTipText(null), null);
  // More than three tree numbers: the first three, then how many more.
  const many = row("D010146", "Pain", ["C10.597.617", "C23.888.592.612", "F02.830.816", "G11.561.790.444"], "An unpleasant sensation.");
  assert.equal(meshTipText(many), "Pain (MeSH C10.597.617, C23.888.592.612, F02.830.816 and 1 more): An unpleasant sensation.");
  assert.equal(/—/.test(meshTipText(many)), false);
});
