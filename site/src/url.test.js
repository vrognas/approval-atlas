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
  withoutLookup,
} from "./url.js";

const domain = {
  mahs: new Set(["Merck Sharp & Dohme B.V.", "Sanofi Pasteur MSD, SNC", "Pfizer Europe MA EEIG", "Not stated"]),
  branches: new Set(["C04", "C14"]),
  areas: new Set(["Arthritis, Rheumatoid", "Psoriasis"]),
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
    area: ["Arthritis, Rheumatoid"],
    branch: ["C14", "C04"],
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
  assert.deepEqual(state.branch, ["C04", "C14"]);
  assert.deepEqual(state.status, ["Authorised", "Withdrawn"]);
  assert.deepEqual(state.atc, ["H03", "L01"]);
  assert.equal(encodeState(state).toString(), query);
});

test("keys are written in one canonical order with sorted, distinct list values", () => {
  const query = encode({ by: "area", status: ["Withdrawn"], type: ["Other"], atc: ["H03", "C", "C"], area: ["Psoriasis"], branch: ["C04", "C04"], to: 2020, from: 2000, mah: ["b", "a"] });
  assert.equal(query, "mah=a&mah=b&from=2000&to=2020&branch=C04&area=Psoriasis&atc=C&atc=H03&type=Other&status=Withdrawn&by=area");
});

test("unknown values are dropped and reported, never thrown", () => {
  const long = "x".repeat(ATC_QUERY_MAX + 1);
  const { state, dropped } = decode(`by=modality&mah=Nobody&mah=Pfizer+Europe+MA+EEIG&from=19x5&branch=Z99&type=Vaccine&status=Authorized&atc=${long}&atc=L04&med=1`);
  assert.equal(state.by, "atc");
  assert.deepEqual(state.mah, ["Pfizer Europe MA EEIG"]);
  assert.equal(state.from, null);
  assert.deepEqual([state.branch, state.type, state.status, state.atc], [[], [], [], ["L04"]]);
  assert.deepEqual(dropped.map((item) => item.key).sort(), ["atc", "branch", "by", "from", "mah", "status", "type"]);
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

// Lookup keys: q (free text), med (EMA product number), sub (substance_key), cond (MeSH descriptor UI).
const lookupOf = (search) => decodeLookup(new URLSearchParams(search));

test("lookup keys decode trimmed, with empty values as absent", () => {
  assert.deepEqual(lookupOf(""), DEFAULT_LOOKUP);
  assert.deepEqual(lookupOf("q=+breast+cancer+&cond=D001943&med=&sub=%20"), { q: "breast cancer", med: null, sub: null, cond: "D001943" });
  assert.equal(lookupOf(`q=${"x".repeat(LOOKUP_QUERY_MAX + 20)}`).q.length, LOOKUP_QUERY_MAX);
});

test("lookup keys come first in the URL, then the filters; values round-trip", () => {
  const lookup = { q: "type 2 diabetes", med: "EMEA/H/C/003820", sub: "tenofovir disoproxil", cond: "D003924" };
  const query = encodeUrl({ ...structuredClone(DEFAULT_STATE), ...lookup, mah: ["A & B, C"] }).toString();
  assert.equal(query, "q=type+2+diabetes&med=EMEA%2FH%2FC%2F003820&sub=tenofovir+disoproxil&cond=D003924&mah=A+%26+B%2C+C");
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
  assert.deepEqual(decode("q=hiv&med=M1&sub=s&cond=D1"), { state: structuredClone(DEFAULT_STATE), dropped: [] });
});

test("lookupView shows one result: medicine > substance > condition > free text of 2+ characters", () => {
  assert.deepEqual(lookupView({ q: "x", med: "M1", sub: "s", cond: "D1" }), { kind: "medicine", value: "M1" });
  assert.deepEqual(lookupView({ q: "x", med: null, sub: "s", cond: "D1" }), { kind: "substance", value: "s" });
  assert.deepEqual(lookupView({ q: "breast", med: null, sub: null, cond: "D1" }), { kind: "condition", value: "D1" });
  assert.deepEqual(lookupView({ q: "breast", med: null, sub: null, cond: null }), { kind: "text", value: "breast" });
  assert.deepEqual(lookupView({ q: "b", med: null, sub: null, cond: null }), { kind: null, value: null });
});
