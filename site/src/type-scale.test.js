import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The type scale (design sweep 2026-10-01, B11): style.css sizes text with the --font-size-{px}
// tokens on :root, so a new size is a decision, not a one-off. Literal sizes are the exceptions
// listed here, each with its reason.
const css = readFileSync(new URL("./style.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const SCALE = { 11: "0.6875rem", 12: "0.75rem", 13: "0.8125rem", 14: "0.875rem", 15: "0.9375rem", 16: "1rem", 17: "1.0625rem", 20: "1.25rem", 24: "1.5rem", 26: "1.625rem", 30: "1.875rem", 36: "2.25rem" };
const LITERAL = new Set([
  // The search field's placeholder, sized to fit the phones' field (fit rules).
  "11.5px", "12.5px", "13.9px",
  // The ATC code and letter badges' mono, not folded to the scale (it would change every ATC
  // badge's width and the medicines table's minimum width).
  "0.78125rem",
  // The page's base, and the charts' SVG text, laid out in px.
  "16px", "12px",
]);

test("type scale: the tokens on :root are the scale, each its px size in rem", () => {
  const root = css.match(/:root\s*\{([^}]*)\}/)[1];
  const tokens = Object.fromEntries([...root.matchAll(/--font-size-(\d+):\s*([^;]+);/g)].map(([, px, value]) => [px, value.trim()]));
  assert.deepEqual(tokens, Object.fromEntries(Object.entries(SCALE).map(([px, rem]) => [px, rem])));
  for (const [px, rem] of Object.entries(SCALE)) assert.equal(parseFloat(rem) * 16, Number(px));
});

test("type scale: every font size is a token, inherited, relative or a listed exception", () => {
  const sizes = [
    ...[...css.matchAll(/(?:^|[^-\w])font-size:\s*([^;]+);/gm)].map(([, value]) => value.trim()),
    ...[...css.matchAll(/(?:^|[^-\w])font:\s*([^;]+);/gm)].map(([, value]) => value.trim())
      .filter((value) => value !== "inherit")
      .map((value) => value.match(/^(?:\d{3}\s+)?(var\(--font-size-\d+\)|[\d.]+(?:rem|px|em))/)?.[1] ?? value),
  ];
  const offScale = sizes.filter((size) => {
    const token = size.match(/^var\(--font-size-(\d+)\)$/);
    if (token) return !(token[1] in SCALE);
    return !(size === "inherit" || /^[\d.]+em$/.test(size) || LITERAL.has(size));
  });
  assert.deepEqual(offScale, []);
  assert.ok(sizes.filter((size) => size.startsWith("var(")).length > 100);
});
