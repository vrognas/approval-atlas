// A toolbar's buttons (role="toolbar": the medicines table's ATC badge segments, the branch chips
// after each condition): one tab stop, Left/Right to the neighboring button, Home/End to the first
// and last (the WAI-ARIA toolbar pattern). DOM only.

// Focus one button and make it its toolbar's tab stop.
export function focusToolbarButton(button) {
  for (const other of button.closest("[role=toolbar]").querySelectorAll("button")) other.tabIndex = other === button ? 0 : -1;
  button.focus();
}

// A keydown on a toolbar button matching selector: moves focus as above (the key's default
// prevented); other keys and targets are left alone.
export function toolbarKeydown(event, selector) {
  const button = event.target.closest(selector);
  if (!button) return;
  const buttons = [...button.closest("[role=toolbar]").querySelectorAll("button")];
  const index = buttons.indexOf(button);
  const target = buttons[{ ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: buttons.length - 1 }[event.key]];
  if (!target) return;
  event.preventDefault();
  focusToolbarButton(target);
}
