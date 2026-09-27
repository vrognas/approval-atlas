// Desktop (>= 1024px): the filter sidebar's width, set on a splitter at its right edge (the ARIA
// window splitter: role separator, focusable, aria-valuenow in px). Drag it (pointer capture),
// or use Left/Right (16px; 64px with Shift), Home/End (narrowest, widest) and Enter or a double
// click (back to 320px). The width is one CSS custom property (--sidebar-w on <html>, CSSOM) that
// the header, the sidebar and the main column's offset follow (style.css). Each viewer's width is
// kept in localStorage: every access is wrapped, and the page works without it.

export const SIDEBAR_DEFAULT = 320;
const SIDEBAR_MIN = 260;
const SIDEBAR_MAX = 560;
const MAX_SHARE = 0.45;
const STEP = 16;
const BIG_STEP = 64;
const STORAGE_KEY = "approval-atlas:sidebar-width";

// Pure: the allowed widths at a viewport width: 260px up to min(560px, 45vw).
export function sidebarBounds(viewportWidth) {
  return { min: SIDEBAR_MIN, max: Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.floor(viewportWidth * MAX_SHARE))) };
}

// Pure: a width within the bounds, in whole pixels.
export function clampSidebar(width, { min, max }) {
  return Math.round(Math.min(max, Math.max(min, width)));
}

// Pure: the width after a key press on the splitter; null for keys it does not handle.
export function sidebarKeyWidth(key, shift, width, bounds) {
  const step = shift ? BIG_STEP : STEP;
  const next = { ArrowLeft: width - step, ArrowRight: width + step, Home: bounds.min, End: bounds.max, Enter: SIDEBAR_DEFAULT }[key];
  return next === undefined ? null : clampSidebar(next, bounds);
}

// The viewer's stored width, else the default (storage missing, blocked or holding anything else).
export function readSidebarWidth(storage) {
  try {
    const width = Number.parseInt(storage?.getItem(STORAGE_KEY) ?? "", 10);
    return Number.isFinite(width) ? width : SIDEBAR_DEFAULT;
  } catch {
    return SIDEBAR_DEFAULT;
  }
}

export function storeSidebarWidth(storage, width) {
  try {
    storage?.setItem(STORAGE_KEY, String(width));
  } catch {
    // Blocked storage: the width lasts for this visit only.
  }
}

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

// handle: the splitter (index.html #sidebar-resize). label, hint: its accessible name and tooltip.
// Sets the stored width at once (called before the first render, so the layout does not jump).
// dragging(): a pointer drag is under way (the page can skip costly re-renders until it ends);
// onDragEnd(): the drag ended.
export function createSidebarResize(handle, { label, hint, onDragEnd = () => {} }) {
  const root = document.documentElement;
  const storage = browserStorage();
  // The width the viewer chose; shown clamped to the viewport's bounds, so a wider window gives
  // it back.
  let preferred = readSidebarWidth(storage);
  let width = preferred;
  let drag = null;

  function show() {
    const bounds = sidebarBounds(window.innerWidth);
    width = clampSidebar(preferred, bounds);
    root.style.setProperty("--sidebar-w", `${width}px`);
    handle.setAttribute("aria-valuenow", String(width));
    handle.setAttribute("aria-valuemin", String(bounds.min));
    handle.setAttribute("aria-valuemax", String(bounds.max));
  }

  function choose(next, persist) {
    preferred = clampSidebar(next, sidebarBounds(window.innerWidth));
    show();
    if (persist) storeSidebarWidth(storage, preferred);
  }

  handle.setAttribute("aria-label", label);
  handle.title = hint;
  show();
  window.addEventListener("resize", show);

  handle.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = sidebarKeyWidth(event.key, event.shiftKey, width, sidebarBounds(window.innerWidth));
    if (next === null) return;
    event.preventDefault();
    choose(next, true);
  });
  handle.addEventListener("dblclick", () => choose(SIDEBAR_DEFAULT, true));

  // The grab point stays under the pointer (offset: where on the handle it was pressed).
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault(); // no text selection while dragging
    handle.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, offset: event.clientX - width };
    root.classList.add("sidebar-resizing");
  });
  handle.addEventListener("pointermove", (event) => {
    if (drag?.id === event.pointerId) choose(event.clientX - drag.offset, false);
  });
  function end(event) {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    root.classList.remove("sidebar-resizing");
    storeSidebarWidth(storage, preferred);
    onDragEnd();
  }
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  handle.addEventListener("lostpointercapture", end);

  return { dragging: () => drag !== null };
}
