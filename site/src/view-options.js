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
