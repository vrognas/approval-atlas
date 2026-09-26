// Pure layout for the results timeline: lanes by medicine type, dots dodged within a lane.

export const LANE_ORDER = ["Other", "Generic", "Biosimilar", "Advanced therapy"];

// Greedy slots 0, 1, -1, 2, -2, …: a dot takes the first slot whose last dot is at least `step`
// to its left. Slots are `step` apart vertically, so no two dots overlap. Returns slots in input order.
export function dodge(xs, step) {
  const order = xs.map((x, index) => index).sort((a, b) => xs[a] - xs[b] || a - b);
  const lastX = new Map();
  const slots = new Array(xs.length);
  for (const index of order) {
    let slot = 0;
    for (let k = 1; lastX.has(slot) && xs[index] - lastX.get(slot) < step; k++) slot = k % 2 ? (k + 1) / 2 : -k / 2;
    lastX.set(slot, xs[index]);
    slots[index] = slot;
  }
  return slots;
}

// items: [{ x, type, … }] -> lanes present, in LANE_ORDER: { type, dots: [{ …item, slot }], minSlot, maxSlot }.
export function layoutLanes(items, step) {
  return LANE_ORDER.map((type) => {
    const laneItems = items.filter((item) => item.type === type);
    const slots = dodge(laneItems.map((item) => item.x), step);
    return {
      type,
      dots: laneItems.map((item, index) => ({ ...item, slot: slots[index] })),
      minSlot: Math.min(...slots),
      maxSlot: Math.max(...slots),
    };
  }).filter((lane) => lane.dots.length > 0);
}

// Dots sharing a family key (substance_set_key), two or more, each family in x order.
export function families(dots) {
  const groups = new Map();
  for (const dot of dots) {
    if (dot.family === null) continue;
    if (!groups.has(dot.family)) groups.set(dot.family, []);
    groups.get(dot.family).push(dot);
  }
  return [...groups.values()].filter((group) => group.length > 1).map((group) => [...group].sort((a, b) => a.x - b.x));
}
