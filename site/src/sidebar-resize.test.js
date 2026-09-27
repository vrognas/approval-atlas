import { test } from "node:test";
import assert from "node:assert/strict";
import { SIDEBAR_DEFAULT, clampSidebar, readSidebarWidth, sidebarBounds, sidebarKeyWidth, storeSidebarWidth } from "./sidebar-resize.js";

test("sidebar bounds: 260px up to min(560px, 45% of the viewport)", () => {
  assert.equal(SIDEBAR_DEFAULT, 320);
  assert.deepEqual(sidebarBounds(1024), { min: 260, max: 460 });
  assert.deepEqual(sidebarBounds(1440), { min: 260, max: 560 });
  assert.deepEqual(sidebarBounds(1245), { min: 260, max: 560 });
  // Never below the minimum.
  assert.deepEqual(sidebarBounds(400), { min: 260, max: 260 });
});

test("a width is clamped to the bounds and rounded to whole pixels", () => {
  const bounds = sidebarBounds(1024);
  assert.equal(clampSidebar(100, bounds), 260);
  assert.equal(clampSidebar(900, bounds), 460);
  assert.equal(clampSidebar(333.6, bounds), 334);
});

test("keys: arrows move 16px (64px with Shift), Home/End go to the bounds, Enter resets; other keys do nothing", () => {
  const bounds = sidebarBounds(1440);
  assert.equal(sidebarKeyWidth("ArrowRight", false, 320, bounds), 336);
  assert.equal(sidebarKeyWidth("ArrowLeft", false, 320, bounds), 304);
  assert.equal(sidebarKeyWidth("ArrowRight", true, 320, bounds), 384);
  assert.equal(sidebarKeyWidth("ArrowLeft", true, 300, bounds), 260);
  assert.equal(sidebarKeyWidth("Home", false, 400, bounds), 260);
  assert.equal(sidebarKeyWidth("End", false, 400, bounds), 560);
  assert.equal(sidebarKeyWidth("Enter", false, 500, bounds), 320);
  assert.equal(sidebarKeyWidth("ArrowUp", false, 320, bounds), null);
  assert.equal(sidebarKeyWidth("a", false, 320, bounds), null);
});

// Browser storage can be missing, blocked (throws) or hold anything.
test("the stored width is read and written safely: a missing, blocked or invalid value gives the default", () => {
  const storage = (value) => ({ getItem: () => value, setItem() {} });
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(readSidebarWidth(storage("400")), 400);
  assert.equal(readSidebarWidth(storage(null)), SIDEBAR_DEFAULT);
  assert.equal(readSidebarWidth(storage("wide")), SIDEBAR_DEFAULT);
  assert.equal(readSidebarWidth(blocked), SIDEBAR_DEFAULT);
  assert.equal(readSidebarWidth(undefined), SIDEBAR_DEFAULT);
  const written = [];
  storeSidebarWidth({ setItem: (key, value) => written.push([key, value]) }, 384);
  assert.deepEqual(written, [["approval-atlas:sidebar-width", "384"]]);
  assert.doesNotThrow(() => storeSidebarWidth(blocked, 384));
  assert.doesNotThrow(() => storeSidebarWidth(undefined, 384));
});
