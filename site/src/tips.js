// Pure: where a tooltip (data-tip, style.css) goes; main.js setupTips() measures and applies it.
// Rectangles are viewport pixels ({ top, bottom, right, height }).

// The gap between a carrier and its tip (style.css: top: calc(100% + 4px)).
const GAP = 4;

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

// A tip beside a panel (the area tree's rows in the desktop sidebar; step 4 review: under the row it
// covered the next rows, and as a tip is hoverable a pointer moving down stayed in it): gap px right
// of the panel's right edge (clear of its splitter), level with the row, growing down from the row's
// top in the upper half of the viewport, else up from its bottom (bottom: from the viewport's bottom
// edge), so it stays on screen. bridge: the strip from the row's right edge to the tip, part of the
// carrier, so the pointer can move onto the tip (WCAG 1.4.13).
export function besidePanel(row, panelRight, viewportHeight, gap = 16) {
  const x = Math.round(panelRight + gap);
  const down = row.top + row.height / 2 <= viewportHeight / 2;
  return {
    x,
    top: down ? row.top : null,
    bottom: down ? null : viewportHeight - row.bottom,
    bridge: { left: row.right, top: row.top, width: Math.max(0, x - row.right), height: row.height },
  };
}

// A tip's height before it shows (its size cannot be measured yet): its text in lines of about half
// an em per character (13px text on 18px lines), within width less the padding and border (22px),
// plus the padding and border (14px).
export function tipHeightEstimate(length, width) {
  const perLine = Math.max(1, Math.floor((width - 22) / 6.5));
  return Math.max(1, Math.ceil(length / perLine)) * 18 + 14;
}
