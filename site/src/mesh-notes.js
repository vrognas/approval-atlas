// MeSH scope notes (mesh_descriptor_notes.json) as explainers of the therapeutic areas (owner
// request 2026-09-28): a tooltip wherever a term or tree node shows, the full note on its condition
// page. NLM's text verbatim; the tooltip only shortens it. Pure but meshTip() (DOM).
import { UI } from "./labels.js";

// rows (null: the file is missing) -> { rows, byUi: descriptor UI -> row, byTreeNumber: tree number
// -> row (a branch code is its category descriptor's tree number) }.
export function buildMeshNotes(rows) {
  const list = rows ?? [];
  return {
    rows: list,
    byUi: new Map(list.filter((row) => row.mesh_descriptor_ui).map((row) => [row.mesh_descriptor_ui, row])),
    byTreeNumber: new Map(list.flatMap((row) => (row.tree_numbers ?? []).map((number) => [number, row]))),
  };
}

// A therapeutic area key's note: a term by its descriptor (uiOfTerm(term)), a branch code or tree
// number by the descriptor holding that number; null when unknown (or notes null: not loaded).
export function areaNote(notes, key, uiOfTerm) {
  if (!notes) return null;
  return notes.byUi.get(uiOfTerm(key)) ?? notes.byTreeNumber.get(key) ?? null;
}

// A period ends a sentence only outside parentheses and after a word that is no abbreviation (step 4
// review: "(e.g., Japanese and St. Louis types)" was cut after "St.").
const ABBREVIATION = /\b(?:St|Dr|vs|e\.g|i\.e)\.$/;
const count = (text, character) => text.split(character).length - 1;
function endsSentence(text, end) {
  const before = text.slice(0, end);
  return count(before, "(") === count(before, ")") && !ABBREVIATION.test(before);
}

// The start of a scope note for a tooltip: its whole sentences up to max characters (a period, then
// a capital, ends one: "e.g. rash" goes on; endsSentence()), else its first max characters cut at a
// word with "…".
export function scopeNoteLead(text, max = 200) {
  if (text.length <= max) return text;
  const fit = [...text.matchAll(/\.\s+(?=\p{Lu})/gu)].map((match) => match.index + 1)
    .filter((end) => end <= max && endsSentence(text, end)).at(-1);
  if (fit) return text.slice(0, fit);
  const cut = text.lastIndexOf(" ", max);
  return `${text.slice(0, cut > 0 ? cut : max).replace(/[\s,;:]+$/, "")}…`;
}

// A note's tooltip, "{name} (MeSH {tree numbers}): {lead}", or null without a scope note.
export function meshTipText(note) {
  if (!note?.scope_note) return null;
  return UI.mesh.tip(note.mesh_descriptor_name, note.tree_numbers ?? [], scopeNoteLead(note.scope_note));
}

// DOM: { text: meshTipText(), id } for a carrier's data-tip, or null. The text also sits in a
// hidden element (one per descriptor, created on first use) that describes focusable carriers
// through aria-describedby, as the type tips' (main.js renderTypeTips()).
export function meshTip(note) {
  const text = meshTipText(note);
  if (!text) return null;
  const id = `mesh-tip-${note.mesh_descriptor_ui ?? note.tree_numbers?.[0]}`;
  if (!document.getElementById(id)) {
    let container = document.getElementById("mesh-tips");
    if (!container) {
      container = document.body.appendChild(document.createElement("div"));
      container.id = "mesh-tips";
      container.hidden = true;
    }
    const description = container.appendChild(document.createElement("p"));
    description.id = id;
    description.textContent = text;
  }
  return { text, id };
}

// DOM: puts a note's tooltip on carrier (nothing without a scope note) and its description on
// focusable (the carrier by default; null for a carrier that is no tab stop, which gets tabindex
// -1 so a tap shows the tip, as the type badges). The tip is left out of accessible names
// (style.css). Returns carrier.
export function addMeshTip(carrier, note, focusable = carrier) {
  const tip = meshTip(note);
  if (!tip) return carrier;
  carrier.dataset.tip = tip.text;
  carrier.classList.add("mesh-tip");
  if (focusable) focusable.setAttribute("aria-describedby", tip.id);
  else carrier.tabIndex = -1;
  return carrier;
}
