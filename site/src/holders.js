// Company badges and holder displays (companies part 2, user decisions 2026-09-28): a group's
// monogram in its hue (badges.js companyHue(); a joint venture's outlined, dashed), and wherever a
// medicine's holder is shown, its company group (the badge and the name, a link to the company
// page) with the holder name EMA publishes under it (once when the same) and how the holder was
// decided (UI.companies.holderLine()). Text goes in via textContent only.
import { companyHue } from "./badges.js";
import { NOT_STATED, UI } from "./labels.js";

// group: a companies.json group row. Always next to the group's name: hidden from screen readers,
// and without a tooltip of its own (it would hide its carrier's: activity rows, bars, path buttons).
export function companyBadge(group) {
  const badge = document.createElement("span");
  badge.className = `company-badge hue-${companyHue(group.key).hue}${group.joint_venture ? " jv" : ""}`;
  badge.textContent = group.monogram ?? "";
  badge.setAttribute("aria-hidden", "true");
  return badge;
}

// entry: companies.js entry() of a medicine (or with holder: several EMA names joined, a
// substance's; null when EMA names none). link(text, key): a link to the company page. Without a
// company group (no holder): EMA's name alone ("Not stated").
export function holderDisplay(entry, { link }) {
  const root = document.createElement("span");
  root.className = "holder";
  if (!entry.group) {
    root.append(entry.holder ?? NOT_STATED);
    return root;
  }
  const main = root.appendChild(document.createElement("span"));
  main.className = "holder-main";
  main.append(companyBadge(entry.group), " ", link(entry.group.name, entry.group.key));
  const line = UI.companies.holderLine(entry, entry.group.name, Boolean(entry.company?.representative));
  if (!line) return root;
  const note = root.appendChild(document.createElement("span"));
  note.className = "holder-ema";
  // A plain EMA holder name is said as such (the register and representative lines name theirs):
  // for screen readers, and as a tooltip (a data-tip, shown on a tap too; owner feedback
  // 2026-09-29: it was a native title).
  if (entry.basis !== "register" && entry.basis !== "curated_sponsor" && entry.holder !== null && entry.holder !== entry.group.name) {
    const hidden = note.appendChild(document.createElement("span"));
    hidden.className = "visually-hidden";
    hidden.textContent = UI.companies.emaHolder;
    note.dataset.tip = UI.companies.holderTitle;
    note.tabIndex = -1;
  }
  note.append(line);
  return root;
}
