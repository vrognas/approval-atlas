// Phones and tablets: filters in a bottom sheet — a native <dialog> opened with showModal() (focus
// trap, Escape, the page inert behind it). While open it borrows facet sections from the sidebar
// (same controls and state) and puts them back when it closes; filters apply live.
import { UI } from "./labels.js";

// onClear(keys): the sheet's Clear button resets these filter keys.
export function createSheet(dialog, { onClear }) {
  const title = dialog.querySelector("#sheet-title");
  const body = dialog.querySelector("#sheet-body");
  const clear = dialog.querySelector("#sheet-clear");
  const done = dialog.querySelector("#sheet-done");
  const closeButton = dialog.querySelector("#sheet-close");
  let current = null;

  clear.textContent = UI.sheet.clear;
  clear.addEventListener("click", () => onClear(current.clears));
  done.addEventListener("click", () => dialog.close());
  // A visible way out besides the backdrop, Escape and "Show N medicines".
  closeButton.setAttribute("aria-label", UI.sheet.close);
  closeButton.title = UI.sheet.close;
  closeButton.addEventListener("click", () => dialog.close());
  // A click outside the sheet's box lands on the dialog itself (its backdrop).
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  // Puts the borrowed sections back; returns the restore() of the sheet that had them.
  function giveBack() {
    if (!current) return null;
    const { sections, markers, restore } = current;
    current = null;
    markers.forEach((marker, index) => marker.replaceWith(sections[index]));
    return restore;
  }
  // The close event is queued: the token that opened the sheet may have been rebuilt meanwhile.
  dialog.addEventListener("close", () => giveBack()?.()?.focus());

  return {
    // sections: facet elements to show; clears: filter keys Clear resets; restore(): the control
    // that gets focus back (looked up on close).
    open({ title: text, sections, clears, restore }) {
      if (dialog.open) return; // the page behind an open sheet is inert
      giveBack(); // closed, but its close event has not run yet
      const markers = sections.map((section) => {
        const marker = document.createComment("");
        section.before(marker);
        return marker;
      });
      current = { sections, markers, clears, restore };
      title.textContent = text;
      body.replaceChildren(...sections);
      body.scrollTop = 0;
      dialog.showModal();
      // The title, not the first control: a search field would open the phone keyboard.
      title.focus();
    },
    // restoreFocus false: a link in the sheet opened a page, whose heading takes focus instead.
    close({ restoreFocus = true } = {}) {
      if (!restoreFocus && current) current.restore = () => null;
      if (dialog.open) dialog.close();
    },
    isOpen: () => dialog.open,
    // count: the medicines matching the filters as they are now.
    update(count) {
      done.textContent = UI.sheet.show(count);
    },
  };
}
