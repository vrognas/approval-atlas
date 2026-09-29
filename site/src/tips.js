// Pure: where a tooltip (data-tip, style.css; the charts' tooltips) goes; main.js setupTips() and
// the charts measure and apply it. Rectangles are viewport pixels ({ top, bottom, right, height }).

// The gap between a carrier and its tip (style.css: top: calc(100% + 4px)).
const GAP = 4;

// A tip at the pointer: this far below and right of it (owner decision 2026-09-29).
const POINTER_OFFSET = 12;

// A tip at the pointer's bridge reaches this far into the tip, which is drawn over it: at 1.5x the
// tip's edge was drawn half a pixel off the band's, and the next row showed through between them.
const BRIDGE_OVERLAP = 1;

// A tip at the pointer stays this far inside the viewport's edges, and a scroll box's.
const EDGE = 8;

// The shift (px, 0 or less) that keeps a tip starting at start and width wide inside limit: the
// viewport's right edge less 16px, or its scroll box's less 8px (step 4 review: the medicines
// table's box ended 17px before the viewport's limit, cutting every line of a tip).
export function tipShift(start, width, limit) {
  const overflow = start + width - limit;
  return overflow > 0 ? -Math.ceil(overflow) : 0;
}

// Whether a tip goes above its carrier: it does not fit below it inside clip (its scroll box,
// { top, bottom }) and there is more room above (step 4 review: in the medicines table's last
// visible row a tip ran 57px past the box, which clips it).
export function tipAbove(carrier, height, clip) {
  const below = clip.bottom - carrier.bottom - GAP;
  const above = carrier.top - clip.top - GAP;
  return height > below && above > below;
}

// A tip beside a panel (the area tree's rows in the desktop sidebar, with keyboard focus; step 4
// review: under the row it covered the next rows): gap px right of the panel's right edge (clear of
// its splitter), level with the row, growing down from the row's top in the upper half of the
// viewport, else up from its bottom (bottom: from the viewport's bottom edge), so it stays on screen.
export function besidePanel(row, panelRight, viewportHeight, gap = 16) {
  const down = row.top + row.height / 2 <= viewportHeight / 2;
  return {
    x: Math.round(panelRight + gap),
    top: down ? row.top : null,
    bottom: down ? null : viewportHeight - row.bottom,
  };
}

// A tip's height before it shows (its size cannot be measured yet): its text in lines of about half
// an em per character (13px text on 18px lines), within width less the padding and border (22px),
// plus the padding and border (14px).
export function tipHeightEstimate(length, width) {
  const perLine = Math.max(1, Math.floor((width - 22) / 6.5));
  return Math.max(1, Math.ceil(length / perLine)) * 18 + 14;
}

// Where a tip at the pointer may go: the viewport (width x height) less EDGE, and within clip (a
// scroll box's visible area, { left, top, right, bottom }) less EDGE when it is in one.
export function tipBounds(width, height, clip = null) {
  const bounds = { left: EDGE, top: EDGE, right: width - EDGE, bottom: height - EDGE };
  if (!clip) return bounds;
  return {
    left: Math.max(bounds.left, clip.left + EDGE),
    top: Math.max(bounds.top, clip.top + EDGE),
    right: Math.min(bounds.right, clip.right - EDGE),
    bottom: Math.min(bounds.bottom, clip.bottom - EDGE),
  };
}

// One axis of a tip at the pointer: after it when it fits, else before it, else as far after it as
// fits inside [min, max].
function pointerSide(at, length, min, max) {
  const after = at + POINTER_OFFSET;
  if (after + length <= max) return after;
  const before = at - POINTER_OFFSET - length;
  if (before >= min) return before;
  return Math.max(min, Math.min(after, max - length));
}

// A tip at the pointer (owner decision 2026-09-29: hover tips open at the cursor): its top-left
// corner, in whole viewport pixels, 12px below and right of pointer ({ x, y }), flipped left or
// above where size ({ width, height }) does not fit inside bounds (tipBounds()).
export function atPointer(pointer, size, bounds) {
  return {
    left: Math.round(pointerSide(pointer.x, size.width, bounds.left, bounds.right)),
    top: Math.round(pointerSide(pointer.y, size.height, bounds.top, bounds.bottom)),
  };
}

// The band a tip at the pointer bridges (style.css ::before, part of its carrier; WCAG 1.4.13;
// review 2026-09-29: a pointer entering a row near its bottom edge crossed the next row on the way
// to the tip and got that row's tip): from anchor (where the pointer opened it) to the tip's near
// edge ({ left, top, width, height }), as wide as the tip, or, beside a tip level with the pointer
// (taller than the room above and below it), across to its near side, as tall as the tip; reaching
// BRIDGE_OVERLAP px into the tip.
export function pointerBridge(anchor, tip) {
  const right = tip.left + tip.width;
  const bottom = tip.top + tip.height;
  if (anchor.y <= tip.top || anchor.y >= bottom) {
    const [top, end] = anchor.y <= tip.top ? [anchor.y, tip.top + BRIDGE_OVERLAP] : [bottom - BRIDGE_OVERLAP, anchor.y];
    const left = Math.min(anchor.x, tip.left);
    return { left, top, width: Math.max(anchor.x, right) - left, height: end - top };
  }
  const [left, end] = anchor.x < tip.left ? [anchor.x, tip.left + BRIDGE_OVERLAP] : [Math.min(anchor.x, right - BRIDGE_OVERLAP), anchor.x];
  return { left, top: tip.top, width: end - left, height: tip.height };
}

// Whether point lies on the way from anchor (where the pointer opened the tip) to the tip
// ({ left, top, width, height }), or on it: the ray from anchor through point meets the tip,
// tolerance px larger all round, at or beyond point. A tip at the pointer stays put, so the pointer
// can move onto it (WCAG 1.4.13): leaving its carrier this way holds it (setupTips()).
export function towardTip(anchor, tip, point, tolerance = 8) {
  const axes = [
    [anchor.x, point.x - anchor.x, tip.left - tolerance, tip.left + tip.width + tolerance],
    [anchor.y, point.y - anchor.y, tip.top - tolerance, tip.top + tip.height + tolerance],
  ];
  let low = 1;
  let high = Infinity;
  for (const [from, delta, min, max] of axes) {
    if (delta === 0) {
      if (from < min || from > max) return false;
      continue;
    }
    const [enter, exit] = [(min - from) / delta, (max - from) / delta].sort((a, b) => a - b);
    low = Math.max(low, enter);
    high = Math.min(high, exit);
  }
  return low <= high;
}
