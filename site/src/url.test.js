import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATC_QUERY_MAX,
  DEFAULT_LOOKUP,
  DEFAULT_STATE,
  LOOKUP_QUERY_MAX,
  classState,
  decodeLookup,
  decodeState,
  encodeState,
  encodeUrl,
  lookupView,
  normalizeYearRange,
  patchFilterParams,
  patchIsSet,
  togglePatch,
  withoutLookup,
} from "./url.js";

// Phase 4c: a control that sets filters ("Who is active where") clears them on a repeat click.
test("a filter patch is set when each of its keys holds exactly its values, in any order", () => {
  const state = { ...structuredClone(DEFAULT_STATE), mah: ["Novartis Europharm Limited"], atc: ["L", "C"], type: ["Generic"] };
  assert.equal(patchIsSet(state, { mah: ["Novartis Europharm Limited"] }), true);
  assert.equal(patchIsSet(state, { atc: ["C", "L"] }), true);
  assert.equal(patchIsSet(state, { atc: ["L"] }), false);
  assert.equal(patchIsSet(state, { mah: ["Novartis Europharm Limited"], atc: ["L"] }), false);
  assert.equal(patchIsSet(state, { mah: ["Novartis Europharm Limited"], type: ["Generic"] }), true);
  assert.equal(patchIsSet(state, { area: ["C04"] }), false);
});

test("toggling a filter patch: set it, or clear its keys when it is already exactly set", () => {
  const state = { ...structuredClone(DEFAULT_STATE), mah: ["Novartis Europharm Limited"], area: ["C04"], type: ["Generic"] };
  assert.deepEqual(togglePatch(state, { mah: ["Novartis Europharm Limited"] }), { mah: [] });
  assert.deepEqual(togglePatch(state, { mah: ["Novartis Europharm Limited"], area: ["C04"] }), { mah: [], area: [] });
  assert.deepEqual(togglePatch(state, { mah: ["Pfizer Europe MA EEIG"] }), { mah: ["Pfizer Europe MA EEIG"] });
  // Partly set: the whole patch is set (the other filters stay).
  assert.deepEqual(togglePatch(state, { mah: ["Novartis Europharm Limited"], area: ["C14"] }), { mah: ["Novartis Europharm Limited"], area: ["C14"] });
});

// Therapeutic areas (phase 4f): branch codes, tree numbers and EMA's terms in one list.
const ABOVE = new Map([
  ["C04.588", new Set(["C04"])],
  ["C04.588.180", new Set(["C04", "C04.588"])],
  ["C17.800", new Set(["C17"])],
  ["Psoriasis", new Set(["C17", "C17.800"])],
  ["Arthritis, Rheumatoid", new Set(["C05", "C17", "C20"])],
  ["Cancer", new Set(["C04"])],
]);
// EMA's terms that are a tree node themselves (buildAreaTree().canonical()); a tag matched at a
// branch root ("Cancer") is itself since phase 4g.
const CANONICAL = new Map([["Breast Neoplasms", ["C04.588.180"]]]);
const domain = {
  mahs: new Set(["Merck Sharp & Dohme B.V.", "Sanofi Pasteur MSD, SNC", "Pfizer Europe MA EEIG", "Not stated"]),
  areas: new Set(["C04", "C04.588", "C04.588.180", "C05", "C14", "C17", "C17.800", "C20", "Arthritis, Rheumatoid", "Breast Neoplasms", "Cancer", "Psoriasis"]),
  areaAncestors: (key) => ABOVE.get(key) ?? new Set(),
  areaCanonical: (key) => CANONICAL.get(key) ?? [key],
  types: new Set(["Advanced therapy", "Biosimilar", "Generic", "Other"]),
  statuses: new Set(["Authorised", "Withdrawn"]),
  years: [1995, 2026],
};
const decode = (search) => decodeState(new URLSearchParams(search), domain);
const encode = (patch) => encodeState({ ...structuredClone(DEFAULT_STATE), ...patch }).toString();

test("default state encodes to an empty query string and back", () => {
  assert.equal(encodeState(DEFAULT_STATE).toString(), "");
  assert.deepEqual(decode(""), { state: structuredClone(DEFAULT_STATE), dropped: [] });
});

test("names with commas, ampersands and slashes round-trip via repeated keys", () => {
  const query = encode({
    mah: ["Sanofi Pasteur MSD, SNC", "Merck Sharp & Dohme B.V.", "Not stated"],
    area: ["Arthritis, Rheumatoid", "C14", "C04"],
    from: 2010,
    to: 2015,
    atc: ["L01", "H03"],
    type: ["Generic"],
    status: ["Withdrawn", "Authorised"],
    by: "mah",
  });
  const { state, dropped } = decode(query);
  assert.deepEqual(dropped, []);
  assert.deepEqual(state.mah, ["Merck Sharp & Dohme B.V.", "Not stated", "Sanofi Pasteur MSD, SNC"]);
  assert.deepEqual(state.area, ["Arthritis, Rheumatoid", "C04", "C14"]);
  assert.deepEqual(state.status, ["Authorised", "Withdrawn"]);
  assert.deepEqual(state.atc, ["H03", "L01"]);
  assert.equal(encodeState(state).toString(), query);
});

test("keys are written in one canonical order with sorted, distinct list values", () => {
  const query = encode({ by: "area", status: ["Withdrawn"], type: ["Other"], atc: ["H03", "C", "C"], area: ["Psoriasis", "C04", "C04"], to: 2020, from: 2000, mah: ["b", "a"] });
  assert.equal(query, "mah=a&mah=b&from=2000&to=2020&area=C04&area=Psoriasis&atc=C&atc=H03&type=Other&status=Withdrawn&by=area");
});

test("unknown values are dropped and reported, never thrown", () => {
  const long = "x".repeat(ATC_QUERY_MAX + 1);
  const { state, dropped } = decode(`by=modality&mah=Nobody&mah=Pfizer+Europe+MA+EEIG&from=19x5&branch=Z99&area=Kuru&type=Vaccine&status=Authorized&atc=${long}&atc=L04&med=1`);
  assert.equal(state.by, "atc");
  assert.deepEqual(state.mah, ["Pfizer Europe MA EEIG"]);
  assert.equal(state.from, null);
  assert.deepEqual([state.area, state.type, state.status, state.atc], [[], [], [], ["L04"]]);
  assert.deepEqual(dropped.map((item) => item.key).sort(), ["area", "atc", "branch", "by", "from", "mah", "status", "type"]);
});

// Phase 4f: one therapeutic area tree; links from before carry branch codes under "branch".
test("therapeutic areas: old branch links load into the area list, and no selected area covers another", () => {
  assert.deepEqual(decode("branch=C17&area=Psoriasis").state.area, ["C17"]);
  assert.deepEqual(decode("branch=C04&area=Psoriasis").state.area, ["C04", "Psoriasis"]);
  assert.deepEqual(decode("area=C17.800&area=Psoriasis&area=C05").state.area, ["C05", "C17.800"]);
  assert.equal("branch" in DEFAULT_STATE, false);
  assert.equal(encodeState(decode("branch=C04&branch=C14").state).toString(), "area=C04&area=C14");
});

// Links from before phase 4f name EMA's terms; a term that is a tree node loads as it, so the tree
// shows one checked row for it. A tag matched at a branch root (phase 4g) stays the tag.
test("therapeutic areas: a linked term that is a node loads as that node, a root tag as itself", () => {
  assert.deepEqual(decode("area=Breast+Neoplasms").state.area, ["C04.588.180"]);
  assert.deepEqual(decode("area=Cancer&area=C04.588.180&area=Psoriasis").state.area, ["C04.588.180", "Cancer", "Psoriasis"]);
  assert.deepEqual(decode("area=Cancer&area=C04").state.area, ["C04"]);
  assert.equal(encodeState(decode("area=Breast+Neoplasms").state).toString(), "area=C04.588.180");
  assert.deepEqual(decode("area=Cancer"), { state: { ...structuredClone(DEFAULT_STATE), area: ["Cancer"] }, dropped: [] });
  // Without the tree (areaCanonical left out) terms stay as they are.
  const plain = { ...domain, areaCanonical: undefined };
  assert.deepEqual(decodeState(new URLSearchParams("area=Breast+Neoplasms"), plain).state.area, ["Breast Neoplasms"]);
});

// Companies part 2: group keys, company keys and EMA holder names (older links) in one list; a
// value a tree row stands for loads as that row's (a company folded into its group), and a value
// within another selected one is dropped.
test("companies: older holder links still load, keys load as the tree selects them, none within another", () => {
  const companies = {
    ...domain,
    mahs: new Set([...domain.mahs, "g.roche", "c.roche", "Roche Registration GmbH", "g.sanofi", "c.genzyme-europe", "Genzyme Europe B.V."]),
    mahAncestors: (value) => new Map([
      ["c.roche", new Set(["g.roche"])],
      ["Roche Registration GmbH", new Set(["g.roche", "c.roche"])],
      ["c.genzyme-europe", new Set(["g.sanofi"])],
      ["Genzyme Europe B.V.", new Set(["g.sanofi", "c.genzyme-europe"])],
    ]).get(value) ?? new Set(),
    // Roche's one company has its name: its row is the group's.
    mahCanonical: (value) => (value === "c.roche" ? ["g.roche"] : [value]),
  };
  const load = (search) => decodeState(new URLSearchParams(search), companies);
  assert.deepEqual(load("mah=Roche+Registration+GmbH"), { state: { ...structuredClone(DEFAULT_STATE), mah: ["Roche Registration GmbH"] }, dropped: [] });
  assert.deepEqual(load("mah=c.roche").state.mah, ["g.roche"]);
  assert.deepEqual(load("mah=g.roche&mah=Roche+Registration+GmbH&mah=Genzyme+Europe+B.V.").state.mah, ["Genzyme Europe B.V.", "g.roche"]);
  assert.deepEqual(load("mah=c.genzyme-europe&mah=Genzyme+Europe+B.V.&mah=g.nobody").state.mah, ["c.genzyme-europe"]);
  assert.deepEqual(load("mah=g.nobody").dropped, [{ key: "mah", value: "g.nobody" }]);
  assert.equal(encodeState(load("mah=c.roche").state).toString(), "mah=g.roche");
});

// The "Authorized now" / "Approvals per year" tabs (view=years) are gone: one dashboard (phase 4a).
test("old links with a view key still load: the key is ignored, not reported", () => {
  assert.deepEqual(decode("view=years&atc=L04AC"), { state: { ...structuredClone(DEFAULT_STATE), atc: ["L04AC"] }, dropped: [] });
  assert.deepEqual(decode("view=lifecycle"), { state: structuredClone(DEFAULT_STATE), dropped: [] });
  assert.equal("view" in DEFAULT_STATE, false);
  // Kept verbatim until the filter domain loads, but without the ignored key.
  assert.equal(withoutLookup(new URLSearchParams("q=x&view=years&atc=L04AC")).toString(), "atc=L04AC");
});

test("the ATC filter is a list: repeated keys, one legacy value, codes upper-cased, names kept", () => {
  assert.deepEqual(decode("atc=C&atc=H03").state.atc, ["C", "H03"]);
  assert.deepEqual(decode("atc=L04AC").state.atc, ["L04AC"]);
  assert.deepEqual(decode("atc=h03&atc=insulin&atc=H03&atc=+").state.atc, ["H03", "insulin"]);
  assert.equal(encode({ atc: ["insulin", "L04", "L04"] }), "atc=L04&atc=insulin");
});

test("no selected ATC class covers another: a class under a selected one is dropped, name queries kept", () => {
  assert.deepEqual(decode("atc=C&atc=C01&atc=H03").state.atc, ["C", "H03"]);
  assert.deepEqual(decode("atc=l04ac05&atc=L04&atc=cardio").state.atc, ["L04", "cardio"]);
  assert.equal(encode({ atc: ["C01", "C", "C01EB"] }), "atc=C");
});

test("years are clamped, swapped and open-ended at the data bounds", () => {
  assert.deepEqual([decode("from=2020&to=2012").state.from, decode("from=2020&to=2012").state.to], [2012, 2020]);
  assert.deepEqual([decode("from=1900&to=2100").state.from, decode("from=1900&to=2100").state.to], [null, null]);
  assert.equal(encodeState(decode("from=1995&to=2003").state).toString(), "to=2003");
});

test("normalizeYearRange clamps, swaps and nulls the data bounds", () => {
  assert.deepEqual(normalizeYearRange(2020, 2012, [1995, 2026]), { from: 2012, to: 2020 });
  assert.deepEqual(normalizeYearRange(1990, 2030, [1995, 2026]), { from: null, to: null });
  assert.deepEqual(normalizeYearRange(null, 2003, [1995, 2026]), { from: null, to: 2003 });
  assert.deepEqual(normalizeYearRange(2026, 2026, [1995, 2026]), { from: 2026, to: null });
});

test("ATC values are trimmed in the URL; empty ones are left out", () => {
  assert.equal(encode({ atc: ["  antineoplastic agents "] }), "atc=antineoplastic+agents");
  assert.equal(encode({ atc: ["   "] }), "");
  assert.deepEqual(decode("atc=+l01+").state.atc, ["L01"]);
});

test("a full ATC class name in a link survives the URL round trip", () => {
  const name = "SYSTEMIC HORMONAL PREPARATIONS, EXCL. SEX HORMONES AND INSULINS";
  assert.deepEqual(decode(encode({ atc: [name] })), { state: { ...structuredClone(DEFAULT_STATE), atc: [name] }, dropped: [] });
});

// Lookup keys: q (free text), med (EMA product number), sub (substance_key), cond (MeSH descriptor UI),
// co (company group or company key; companies part 2).
const lookupOf = (search) => decodeLookup(new URLSearchParams(search));

test("lookup keys decode trimmed, with empty values as absent", () => {
  assert.deepEqual(lookupOf(""), DEFAULT_LOOKUP);
  assert.deepEqual(lookupOf("q=+breast+cancer+&cond=D001943&med=&sub=%20"), { q: "breast cancer", med: null, sub: null, cond: "D001943", co: null });
  assert.equal(lookupOf("co=+g.roche+").co, "g.roche");
  assert.equal(lookupOf(`q=${"x".repeat(LOOKUP_QUERY_MAX + 20)}`).q.length, LOOKUP_QUERY_MAX);
});

test("lookup keys come first in the URL, then the filters; values round-trip", () => {
  const lookup = { q: "type 2 diabetes", med: "EMEA/H/C/003820", sub: "tenofovir disoproxil", cond: "D003924", co: "g.roche" };
  const query = encodeUrl({ ...structuredClone(DEFAULT_STATE), ...lookup, mah: ["A & B, C"] }).toString();
  assert.equal(query, "q=type+2+diabetes&med=EMEA%2FH%2FC%2F003820&sub=tenofovir+disoproxil&cond=D003924&co=g.roche&mah=A+%26+B%2C+C");
  assert.deepEqual(lookupOf(query), lookup);
  assert.equal(encodeUrl({ ...structuredClone(DEFAULT_STATE), ...DEFAULT_LOOKUP }).toString(), "");
});

test("before the filter domain is known, the URL's filter part is passed through verbatim", () => {
  const filters = withoutLookup(new URLSearchParams("q=x&mah=B&med=M1&mah=A&from=2010"));
  assert.equal(filters.toString(), "mah=B&mah=A&from=2010");
  const query = encodeUrl({ ...structuredClone(DEFAULT_STATE), ...DEFAULT_LOOKUP, med: "M2" }, filters).toString();
  assert.equal(query, "med=M2&mah=B&mah=A&from=2010");
});

// A drug class opened from the search before the dashboard has loaded: the kept filter part
// takes the new values and keeps the rest.
test("patchFilterParams replaces the patched filter keys in a verbatim filter part", () => {
  const filters = new URLSearchParams("mah=B&atc=L01&mah=A&atc=H03");
  assert.equal(patchFilterParams(filters, { ...DEFAULT_LOOKUP, atc: ["L04AC"] }).toString(), "mah=B&mah=A&atc=L04AC");
  assert.equal(patchFilterParams(filters, { atc: [] }).toString(), "mah=B&mah=A");
  assert.equal(filters.toString(), "mah=B&atc=L01&mah=A&atc=H03");
});

// Suggestion, card ladder and Try link: the link's href and its click give the same view.
test("a drug class opens alone: default filters with only its ATC code", () => {
  assert.deepEqual(classState("L04AC"), { ...structuredClone(DEFAULT_STATE), atc: ["L04AC"] });
  assert.equal(encodeUrl({ ...DEFAULT_LOOKUP, ...classState("L04AC") }).toString(), "atc=L04AC");
  // Applied before the dashboard has loaded, it clears the kept filters too.
  assert.equal(patchFilterParams(new URLSearchParams("mah=B&atc=C&by=mah"), classState("L04AC")).toString(), "atc=L04AC");
  assert.notEqual(classState("L").mah, DEFAULT_STATE.mah);
  assert.notEqual(classState("L").atc, classState("L").atc);
});

test("the filter decoder ignores lookup keys", () => {
  assert.deepEqual(decode("q=hiv&med=M1&sub=s&cond=D1&co=g.roche"), { state: structuredClone(DEFAULT_STATE), dropped: [] });
});

test("lookupView shows one result: medicine > substance > condition > company > free text of 2+ characters", () => {
  assert.deepEqual(lookupView({ q: "x", med: "M1", sub: "s", cond: "D1" }), { kind: "medicine", value: "M1" });
  assert.deepEqual(lookupView({ q: "x", med: null, sub: "s", cond: "D1" }), { kind: "substance", value: "s" });
  assert.deepEqual(lookupView({ q: "breast", med: null, sub: null, cond: "D1" }), { kind: "condition", value: "D1" });
  assert.deepEqual(lookupView({ q: "breast", med: null, sub: null, cond: "D1", co: "g.roche" }), { kind: "condition", value: "D1" });
  assert.deepEqual(lookupView({ q: "breast", med: null, sub: null, cond: null, co: "g.roche" }), { kind: "company", value: "g.roche" });
  assert.deepEqual(lookupView({ q: "breast", med: null, sub: null, cond: null }), { kind: "text", value: "breast" });
  assert.deepEqual(lookupView({ q: "b", med: null, sub: null, cond: null }), { kind: null, value: null });
});
