// Pure: what the ATC and medicine-type badges show and which hue they take (the hue classes and
// their level shades are in style.css). No DOM.
import { UI } from "./labels.js";

const ATC_CODE = /^[A-Z](\d{2}([A-Z]([A-Z](\d{2})?)?)?)?$/;
const ATC_PREFIX_LENGTHS = [1, 3, 4, 5, 7]; // lengths of ATC level 1-5 codes

// Every ATC badge takes the hue of its level-1 group.
export const ATC_GROUP_HUES = {
  A: "gold",
  B: "red",
  C: "pink",
  D: "orange",
  G: "purple",
  H: "plum",
  J: "teal",
  L: "blue",
  M: "olive",
  N: "indigo",
  P: "brown",
  R: "sky",
  S: "green",
  V: "slate",
};

export function atcHue(code) {
  return ATC_GROUP_HUES[code.charAt(0)] ?? "slate";
}

// "L04AC05" -> L | 04 | A | C | 05, each segment with its level and full code; an incomplete code
// stops at the levels it has. A malformed code (EMA's "LX1XX02", "VO4D") stays one segment with
// level null: splitting it would invent levels.
export function atcSegments(code) {
  if (!code) return [];
  if (!ATC_CODE.test(code)) return [{ level: null, code, text: code }];
  return ATC_PREFIX_LENGTHS.filter((length) => length <= code.length).map((length, index) => ({
    level: index + 1,
    code: code.slice(0, length),
    text: code.slice(index === 0 ? 0 : ATC_PREFIX_LENGTHS[index - 1], length),
  }));
}

const TYPE_HUES = { Generic: "gold", Biosimilar: "teal", "Advanced therapy": "purple" };

// ema_medicines / search-index row -> [{ label, hue }]: the medicine type (none for Other), then Orphan.
export function typeBadges(row) {
  const badges = TYPE_HUES[row.medicine_type] ? [{ label: row.medicine_type, hue: TYPE_HUES[row.medicine_type] }] : [];
  if (row.orphan_medicine) badges.push({ label: UI.card.flags.orphan_medicine, hue: "pink" });
  return badges;
}
