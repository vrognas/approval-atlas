// The dashboard's tabs (F · Spacious, phase 2; the WAI-ARIA APG tabs pattern since 2026-09-30,
// owner decision): one tab stop, the tab shown; Left/Right move focus to the previous or next tab
// (wrapping), Home/End to the first and last. Manual activation: the keys only move focus, Enter or
// Space (the tab is a button) shows the tab, so a key press neither pushes a history entry nor
// renders a tab.

// The index of the tab a key moves focus to, from the tab at index among count; null for other keys.
export function tabKeyTarget(key, index, count) {
  if (count < 1) return null;
  switch (key) {
    case "ArrowLeft":
      return (index - 1 + count) % count;
    case "ArrowRight":
      return (index + 1) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

// A keydown on a tab of the tablist: focus moves as above (the key's default prevented); other keys
// and targets are left alone. DOM only.
export function tabsKeydown(event) {
  const tab = event.target.closest?.("[role=tab]");
  if (!tab || event.altKey || event.ctrlKey || event.metaKey) return;
  const tabs = [...tab.closest("[role=tablist]").querySelectorAll("[role=tab]")];
  const target = tabKeyTarget(event.key, tabs.indexOf(tab), tabs.length);
  if (target === null) return;
  event.preventDefault();
  tabs[target].focus();
}
