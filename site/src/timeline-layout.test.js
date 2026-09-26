import { test } from "node:test";
import assert from "node:assert/strict";
import { dodge, families, layoutLanes } from "./timeline-layout.js";

test("dodge stacks dots that would overlap, alternating around the lane center", () => {
  assert.deepEqual(dodge([100, 100, 100, 100], 10), [0, 1, -1, 2]);
  assert.deepEqual(dodge([100, 110, 120], 10), [0, 0, 0]);
  assert.deepEqual(dodge([100, 105, 111], 10), [0, 1, 0]);
});

test("dodge returns slots in input order even when the input is unsorted", () => {
  assert.deepEqual(dodge([120, 100, 104], 10), [0, 0, 1]);
});

test("dots sharing a slot are always at least one step apart", () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const xs = Array.from({ length: 400 }, () => random() * 340);
  const slots = dodge(xs, 10);
  const bySlot = new Map();
  xs.forEach((x, index) => bySlot.set(slots[index], [...(bySlot.get(slots[index]) ?? []), x]));
  for (const positions of bySlot.values()) {
    positions.sort((a, b) => a - b);
    for (let i = 1; i < positions.length; i++) assert.ok(positions[i] - positions[i - 1] >= 10 - 1e-9);
  }
});

test("lanes are the medicine types present, in a fixed order, each with its slot range", () => {
  const items = [
    { id: "a", x: 10, type: "Biosimilar" },
    { id: "b", x: 10, type: "Other" },
    { id: "c", x: 12, type: "Other" },
    { id: "d", x: 50, type: "Advanced therapy" },
  ];
  const lanes = layoutLanes(items, 10);
  assert.deepEqual(lanes.map((lane) => [lane.type, lane.minSlot, lane.maxSlot, lane.dots.map((dot) => `${dot.id}:${dot.slot}`)]), [
    ["Other", 0, 1, ["b:0", "c:1"]],
    ["Biosimilar", 0, 0, ["a:0"]],
    ["Advanced therapy", 0, 0, ["d:0"]],
  ]);
});

test("families join two or more dots with the same key, in x order", () => {
  const dots = [
    { id: "ref", x: 40, family: "adalimumab" },
    { id: "bio2", x: 90, family: "adalimumab" },
    { id: "bio1", x: 70, family: "adalimumab" },
    { id: "alone", x: 10, family: "pembrolizumab" },
    { id: "none", x: 20, family: null },
  ];
  assert.deepEqual(families(dots).map((family) => family.map((dot) => dot.id)), [["ref", "bio1", "bio2"]]);
});
