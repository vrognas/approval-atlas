// Desktop (>= 1024px; F · Spacious, phase 1): a filter chip's controls in a popover under the chip:
// a non-modal <dialog> opened with show() (dialog semantics, named by its title; the page stays
// usable), which borrows the chip's facet section (as the sheet does, so controls and state are
// shared) and puts it back when it closes. Filters apply live; Clear resets its dimension, Done
// closes it. Escape, Done and a click outside close it and hand focus back to the chip (a click
// outside only when focus did not go to what was clicked); tabbing out of it closes it too.
import { UI } from "./labels.js";

// Pure: the popover's left edge in the chip bar, at the chip's left edge (anchorLeft), moved left
// as far as it must to end inside the bar (containerWidth: the main column, inside the viewport),
// never before the bar's left edge.
export function popoverLeft(anchorLeft, width, containerWidth) {
  return Math.max(0, Math.min(Math.round(anchorLeft), Math.round(containerWidth - width)));
}

// Pure: whether focus moving to target (focusout's relatedTarget), or a press on it (pointerdown),
// leaves the popover: outside the dialog and not on its own chip (anchor), whose click toggles it
// (review of phase 1: focus moving to the chip on mousedown closed it, and the click reopened it).
// Focus lost to nothing (null: a row re-rendered, the sections going back) does not.
export const leavesPopover = (target, dialog, anchor) => Boolean(target) && !dialog.contains(target) && !anchor?.contains(target);

// Pure: the popover's max-height (review of phase 1: it ran below the fold): the room under its chip
// (chipBottom, viewport px) less 24px, at most 70% of the viewport, at least 240px (the page then
// scrolls it into view).
export function popoverMaxHeight(chipBottom, viewportHeight) {
  return Math.max(240, Math.floor(Math.min(viewportHeight * 0.7, viewportHeight - chipBottom - 24)));
}

// Pure: the chip whose popover is open after a click on chip key (open: the one open now, or null):
// its own chip closes it, another chip opens its own.
export const nextOpenChip = (open, key) => (open === key ? null : key);

// dialog: index.html #filter-popover, positioned in the chip bar (its offset parent).
// onClear(keys): its Clear button resets these filter keys.
export function createPopover(dialog, { onClear }) {
  const title = dialog.querySelector("#popover-title");
  const body = dialog.querySelector("#popover-body");
  const clear = dialog.querySelector("#popover-clear");
  const done = dialog.querySelector("#popover-done");
  let current = null;

  clear.textContent = UI.filters.popoverClear;
  done.textContent = UI.filters.done;
  dialog.querySelector("#popover-note").textContent = UI.facets.counts;
  clear.addEventListener("click", () => onClear(current.clears));
  done.addEventListener("click", () => close());

  // Under its chip, inside the bar (CSSOM custom properties; style.css places it).
  function place() {
    if (!current) return;
    const anchor = current.anchor();
    const container = dialog.offsetParent;
    if (!anchor || !container) return;
    const box = container.getBoundingClientRect();
    const chip = anchor.getBoundingClientRect();
    dialog.style.setProperty("--popover-x", `${popoverLeft(chip.left - box.left, dialog.offsetWidth, container.clientWidth)}px`);
    dialog.style.setProperty("--popover-y", `${Math.round(chip.bottom - box.top + 8)}px`);
    dialog.style.setProperty("--popover-max-h", `${popoverMaxHeight(chip.bottom, window.innerHeight)}px`);
  }

  // Puts the borrowed sections back (their markers keep their place) and closes the dialog.
  // restoreFocus: the chip gets focus back (Escape, Done, the chip itself); false: focus went
  // elsewhere (a tab out, a click on another control).
  function close({ restoreFocus = true } = {}) {
    if (!current) return;
    const { sections, markers, restore, onClose } = current;
    current = null;
    markers.forEach((marker, index) => marker.replaceWith(sections[index]));
    if (dialog.open) dialog.close();
    onClose?.();
    if (restoreFocus) restore()?.focus();
  }

  // Escape closes it, unless a tip or a search with text takes it first (the tips hide, the search
  // clears: the browser's own Escape).
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || (event.target.type === "search" && event.target.value)) return;
    event.preventDefault();
    close();
  });
  // Tabbing out of it (focus moving to a control outside, not its own chip) closes it.
  dialog.addEventListener("focusout", (event) => {
    if (current && leavesPopover(event.relatedTarget, dialog, current.anchor())) close({ restoreFocus: false });
  });
  // A click outside it (not on its own chip, which toggles it) closes it; focus goes back to the chip
  // when the click moved it nowhere (a blank area).
  document.addEventListener("pointerdown", (event) => {
    if (!current || !leavesPopover(event.target, dialog, current.anchor())) return;
    const { restore } = current;
    close({ restoreFocus: false });
    setTimeout(() => {
      if (document.activeElement === document.body || document.activeElement === null) restore()?.focus({ preventScroll: true });
    }, 0);
  }, true);
  window.addEventListener("resize", place);

  return {
    // key: the chip's filter key; sections: facet elements to show; clears: the keys Clear resets;
    // wide: the trees' wider popover; anchor(), restore(): the chip (looked up again, as chips are
    // rebuilt on every render); focus(): the control that takes focus (its first checked row, else
    // its first control), or null for the title; onClose(): after it closed; optional.
    open({ key, title: text, sections, clears, wide = false, anchor, restore, focus, onClose }) {
      close({ restoreFocus: false });
      const markers = sections.map((section) => {
        const marker = document.createComment("");
        section.before(marker);
        return marker;
      });
      current = { key, sections, markers, clears, anchor, restore, onClose };
      title.textContent = text;
      dialog.classList.toggle("popover-wide", wide);
      body.replaceChildren(...sections);
      body.scrollTop = 0;
      dialog.show();
      place();
      (focus?.() ?? title).focus({ preventScroll: true });
      // With little room under the chip (240px at least), the page scrolls so all of it shows.
      if (dialog.getBoundingClientRect().bottom > window.innerHeight) dialog.scrollIntoView({ block: "nearest" });
    },
    close,
    // Follows its chip, which can move when the chips change (after every render).
    place,
    isOpen: () => current !== null,
    openKey: () => current?.key ?? null,
  };
}
