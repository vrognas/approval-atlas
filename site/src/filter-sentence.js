// The filter sentence under the headline (facets.js sentenceParts()): tokens are buttons that
// open their filter; an active token is a pill with a remove button, and a Reset button follows
// while any filter is active. Rebuilt on every render; focus goes back to the same control, else
// to a token opening the same sheet, else to the first token.
import * as d3 from "d3";
import { UI } from "./labels.js";

// sheetOf(key): the filter a token opens (tokens opening the same one share it); popup: tokens
// open a dialog (the sheets below 1024px); onOpen(key), onRemove(token), onReset().
export function renderSentence(container, parts, { anyActive, sheetOf, popup, onOpen, onRemove, onReset }) {
  const active = container.contains(document.activeElement) ? document.activeElement : null;
  container.replaceChildren(); // text nodes too
  const root = d3.select(container);
  const tokenButton = (parent, part) => parent.append("button")
    .attr("type", "button")
    .attr("class", "token")
    .attr("data-focus-key", `${part.key}:open`)
    .attr("data-sheet", sheetOf(part.key))
    .attr("aria-label", UI.sentence.tokenName(part.key, part.text))
    .attr("aria-haspopup", popup ? "dialog" : null)
    .text(part.text)
    .on("click", () => onOpen(part.key));
  // The year range ("[1995]–[2026]") does not break across lines.
  let parent = root;
  for (const part of parts) {
    if (part.key === "from") parent = root.append("span").attr("class", "token-range");
    if (typeof part === "string") {
      parent.node().append(part);
    } else if (part.active) {
      const pill = parent.append("span").attr("class", "token-pill");
      tokenButton(pill, part);
      pill.append("button")
        .attr("type", "button")
        .attr("class", "token-remove")
        .attr("data-focus-key", `${part.key}:remove`)
        .attr("data-sheet", sheetOf(part.key))
        .attr("aria-label", UI.sentence.remove(part.key, part.text))
        .text("×")
        .on("click", () => onRemove(part));
    } else {
      tokenButton(parent, part);
    }
    if (part.key === "to") parent = root;
  }
  if (anyActive) {
    container.append(" ");
    root.append("button").attr("type", "button").attr("class", "text-button sentence-reset").attr("data-focus-key", "reset").text(UI.sentence.reset).on("click", onReset);
  }
  if (!active) return;
  const { focusKey, sheet } = active.dataset;
  (container.querySelector(`[data-focus-key="${focusKey}"]`) ?? container.querySelector(`[data-sheet="${sheet}"]`) ?? container.querySelector("button"))?.focus();
}
