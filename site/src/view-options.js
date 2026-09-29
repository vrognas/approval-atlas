// "View options" (F · Spacious, phase 2; Hick's Law): a card's secondary controls (Sort, Stack by,
// Columns, Column order) behind one disclosure button per card, so each card opens in one view.
// The button (index.html .view-options-button) has aria-expanded and aria-controls its panel
// (.view-options, hidden while closed); a native button, so Enter and Space toggle it and focus
// stays on it. Open or closed is UI state, kept across renders (the markup is static).
export function setupViewOptions(root, text) {
  for (const button of root.querySelectorAll(".view-options-button")) {
    const panel = document.getElementById(button.getAttribute("aria-controls"));
    button.querySelector(".view-options-text").textContent = text;
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
    });
  }
}

// (i) (F · Spacious, phase 3; Cognitive Load): each dashboard card's method description (the
// captions and notes that used to sit under its title) behind one disclosure button beside its
// title (index.html .info-button: aria-expanded, aria-controls its panel .card-info, described by
// the card's title; name: label, "About this card"). A real button, so a tap, Enter or Space opens
// it; open or closed is UI state, kept across renders.
export function setupCardInfo(root, label) {
  for (const button of root.querySelectorAll(".info-button")) {
    const panel = document.getElementById(button.getAttribute("aria-controls"));
    button.setAttribute("aria-label", label);
    button.title = label;
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
    });
  }
}
