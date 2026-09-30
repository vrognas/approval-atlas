// A toolbar's items (role="toolbar": the medicines table's ATC badge segments, the branch chips
// after each condition): one tab stop, Left/Right to the neighboring item, Home/End to the first
// and last (the WAI-ARIA toolbar pattern). Its items are its buttons and links (the lookup cards'
// branch chips link to condition pages; Laws of UX, second pass, 2026-09-30) and any .toolbar-item:
// a span the arrows reach but that is never the tab stop (the branch chips' "+n", whose tooltip had
// no keyboard path; chips review 2026-09-29). DOM only.
const CONTROLS = "button, a[href]";
const ITEMS = `${CONTROLS}, .toolbar-item`;

// Focus one item; a button or link becomes its toolbar's tab stop (a .toolbar-item keeps tabindex -1).
export function focusToolbarButton(item) {
  if (item.matches(CONTROLS)) {
    for (const other of item.closest("[role=toolbar]").querySelectorAll(CONTROLS)) other.tabIndex = other === item ? 0 : -1;
  }
  item.focus();
}

// A keydown on a toolbar item matching selector: moves focus as above (the key's default
// prevented); other keys and targets are left alone.
export function toolbarKeydown(event, selector) {
  const item = event.target.closest(selector);
  if (!item) return;
  const items = [...item.closest("[role=toolbar]").querySelectorAll(ITEMS)];
  const index = items.indexOf(item);
  const target = items[{ ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: items.length - 1 }[event.key]];
  if (!target) return;
  event.preventDefault();
  focusToolbarButton(target);
}
