// Pure: what the ATC and medicine-type badges show and which hue they take (the hue classes and
// their level shades are in style.css). No DOM.
import { UI } from "./labels.js";

// A valid ATC code at any level (upper case), and the lengths of ATC level 1-5 codes: the one
// definition the other modules import.
export const ATC_CODE = /^[A-Z](\d{2}([A-Z]([A-Z](\d{2})?)?)?)?$/;
export const ATC_PREFIX_LENGTHS = [1, 3, 4, 5, 7];

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
  return ATC_GROUP_HUES[code?.charAt(0)] ?? "slate";
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

// Each EMA status in its own damped hue (dots, pills, the stacked approval-years strip); the two
// pending opinions share gold, withdrawn applications and rolling reviews slate, as do unknown ones.
const STATUS_HUES = {
  Authorised: "green",
  Withdrawn: "red",
  Expired: "orange",
  Lapsed: "brown",
  Suspended: "pink",
  Revoked: "plum",
  Refused: "purple",
  "Application withdrawn": "slate",
  "Withdrawn from rolling review": "slate",
  Opinion: "gold",
  "Opinion under re-examination": "gold",
};

export function statusHue(status) {
  return STATUS_HUES[status] ?? "slate";
}

// A status in "Approvals per year" (Stack by Status): its hue's mid; Authorized, the bottom
// segment of every column, the darker --status-authorized, so it differs in lightness from every
// status stacked on it (palette.test.js).
export function statusColor(status) {
  return status === "Authorised" ? "var(--status-authorized)" : `var(--${statusHue(status)}-mid)`;
}

// Company monogram badges (companies part 2, user decision 2026-09-28; no logos): the largest
// groups in a damped version of their brand colour (the user's list, and Krka, CSL and Gedeon
// Richter among the 25 largest; tokens --co-{hue}-1, -mid and -text in style.css, checked in
// palette.test.js), every other group in one of the damped hues, stable per group (a hash of its
// key; slate, the hue of unknown values, left out).
export const BRAND_HUES = {
  "g.roche": { hue: "co-roche" },
  "g.novartis": { hue: "co-novartis" },
  "g.pfizer": { hue: "co-pfizer" },
  "g.astrazeneca": { hue: "co-astrazeneca" },
  "g.sanofi": { hue: "co-sanofi" },
  "g.gsk": { hue: "co-gsk" },
  "g.msd": { hue: "co-msd" },
  "g.novo-nordisk": { hue: "co-novo-nordisk" },
  "g.eli-lilly": { hue: "co-lilly" },
  "g.bristol-myers-squibb": { hue: "co-bms" },
  "g.johnson-johnson": { hue: "co-jnj" },
  "g.abbvie": { hue: "co-abbvie" },
  "g.bayer": { hue: "co-bayer" },
  "g.boehringer-ingelheim": { hue: "co-boehringer" },
  "g.takeda": { hue: "co-takeda" },
  "g.gilead": { hue: "co-gilead" },
  "g.amgen": { hue: "co-amgen" },
  "g.teva": { hue: "co-teva" },
  "g.sandoz": { hue: "co-sandoz" },
  "g.viatris": { hue: "co-viatris" },
  // Krka: Pantone 355 green; CSL: red; Gedeon Richter: deep blue.
  "g.krka": { hue: "co-krka" },
  "g.csl": { hue: "co-csl" },
  "g.gedeon-richter": { hue: "co-gedeon-richter" },
};

const HASH_HUES = ["green", "teal", "blue", "indigo", "purple", "plum", "pink", "red", "orange", "gold", "olive", "brown", "sky"];

// FNV-1a over the key's UTF-16 code units: the same hue for a group on every page and build.
function hash(text) {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return value;
}

// A group's badge hue: { hue (the .hue-* class and token prefix) }.
export function companyHue(key) {
  return BRAND_HUES[key] ?? { hue: HASH_HUES[hash(key) % HASH_HUES.length] };
}

// Chart colours of groups stacked in one chart differ by at least this OKLab distance in light and
// in dark mode (where the palette allows; palette.test.js checks the real top-8 sets).
export const SERIES_DISTANCE = 0.06;

const toLinear = (channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);

// "#rrggbb" -> OKLab [L, a, b] (Björn Ottosson's matrices), or null for any other value.
export function oklab(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex ?? "")) return null;
  const [r, g, b] = [1, 3, 5].map((index) => toLinear(parseInt(hex.slice(index, index + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

// The smaller OKLab distance of two colour tokens ("--co-roche-mid") over the palette's modes
// (palette: { light, dark }: token -> "#rrggbb"); 0 for the same token, Infinity when unknown.
export function tokenDistance(palette, a, b) {
  if (a === b) return 0;
  return Math.min(...[palette.light, palette.dark].map((tokens) => {
    const [x, y] = [oklab(tokens?.[a]), oklab(tokens?.[b])];
    return x && y ? Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) : Infinity;
  }));
}

// Chart colours for groups stacked in one chart (keys: most medicines first), as CSS var()s. Each
// takes the first of: its hue's mid, its text shade (another lightness), then the mids and text
// shades of the other damped hues, nearest to its own first, that differs from every colour taken
// before it by SERIES_DISTANCE in both modes (brand mids and damped mids can be near twins: Teva
// and Pfizer, Roche and AbbVie); failing all, the one farthest from them.
export function companySeriesColors(keys, palette = { light: {}, dark: {} }) {
  const mid = (hue) => `--${hue}-mid`;
  const text = (hue) => `--${hue}-text`;
  const used = [];
  const colors = new Map();
  for (const key of keys) {
    const own = companyHue(key).hue;
    const others = HASH_HUES.filter((hue) => hue !== own)
      .map((hue) => [hue, tokenDistance(palette, mid(own), mid(hue))])
      .sort(([, a], [, b]) => a - b)
      .map(([hue]) => hue);
    const candidates = [mid(own), text(own), ...others.map(mid), ...others.map(text)].filter((token) => !used.includes(token));
    const nearest = (token) => Math.min(Infinity, ...used.map((other) => tokenDistance(palette, token, other)));
    const pick = candidates.find((token) => nearest(token) >= SERIES_DISTANCE)
      ?? candidates.reduce((best, token) => (nearest(token) > nearest(best) ? token : best));
    used.push(pick);
    colors.set(key, `var(${pick})`);
  }
  return colors;
}

// The element holding a type's explanation (UI.typeTips), which focusable carriers reference with
// aria-describedby: "Advanced therapy" -> "type-tip-advanced-therapy".
export const typeTipId = (label) => `type-tip-${label.toLowerCase().replaceAll(" ", "-")}`;
// The same for a status's (UI.statusTips): "Application withdrawn" -> "status-tip-application-withdrawn".
export const statusTipId = (status) => `status-tip-${status.toLowerCase().replaceAll(" ", "-")}`;

// A medicine type's or status's explanation and the id of its hidden copy (the description of a
// focusable carrier), or null when it has none.
export function typeTip(label) {
  return UI.typeTips[label] ? { text: UI.typeTips[label], id: typeTipId(label) } : null;
}

export function statusTip(status) {
  return UI.statusTips[status] ? { text: UI.statusTips[status], id: statusTipId(status) } : null;
}
