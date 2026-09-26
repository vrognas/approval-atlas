import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATC_QUERY_MAX,
  DEFAULT_LOOKUP,
  DEFAULT_STATE,
  LOOKUP_QUERY_MAX,
  decodeLookup,
  decodeState,
  encodeState,
  encodeUrl,
  lookupView,
  normalizeYearRange,
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
    view: "years",
    mah: ["Sanofi Pasteur MSD, SNC", "Merck Sharp & Dohme B.V.", "Not stated"],
    area: ["Arthritis, Rheumatoid"],
    branch: ["C14", "C04"],
    from: 2010,
    to: 2015,
    atc: "L01",
    type: ["Generic"],
    status: ["Withdrawn", "Authorised"],
    by: "mah",
  });
  const { state, dropped } = decode(query);
  assert.deepEqual(dropped, []);
  assert.deepEqual(state.mah, ["Merck Sharp & Dohme B.V.", "Not stated", "Sanofi Pasteur MSD, SNC"]);
  assert.deepEqual(state.branch, ["C04", "C14"]);
  assert.deepEqual(state.status, ["Authorised", "Withdrawn"]);
  assert.equal(encodeState(state).toString(), query);
});

test("keys are written in one canonical order with sorted, distinct list values", () => {
  const query = encode({ by: "area", status: ["Withdrawn"], type: ["Other"], atc: "A10", area: ["Psoriasis"], branch: ["C04", "C04"], to: 2020, from: 2000, mah: ["b", "a"], view: "years" });
  assert.equal(query, "view=years&mah=a&mah=b&from=2000&to=2020&branch=C04&area=Psoriasis&atc=A10&type=Other&status=Withdrawn&by=area");
});

test("unknown values are dropped and reported, never thrown", () => {
  const long = "x".repeat(ATC_QUERY_MAX + 1);
  const { state, dropped } = decode(`view=lifecycle&by=modality&mah=Nobody&mah=Pfizer+Europe+MA+EEIG&from=19x5&branch=Z99&type=Vaccine&status=Authorized&atc=${long}&med=1`);
  assert.equal(state.view, "now");
  assert.equal(state.by, "atc");
  assert.deepEqual(state.mah, ["Pfizer Europe MA EEIG"]);
  assert.equal(state.from, null);
  assert.deepEqual([state.branch, state.type, state.status, state.atc], [[], [], [], ""]);
  assert.deepEqual(dropped.map((item) => item.key).sort(), ["atc", "branch", "by", "from", "mah", "status", "type", "view"]);
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

test("the ATC text is trimmed in the URL but kept as typed in state", () => {
  assert.equal(encode({ atc: "  antineoplastic agents " }), "atc=antineoplastic+agents");
  assert.equal(encode({ atc: "   " }), "");
  assert.equal(decode("atc=+l01+").state.atc, "l01");
});

test("a full ATC class name typed in the filter survives the URL round trip", () => {
  const name = "SYSTEMIC HORMONAL PREPARATIONS, EXCL. SEX HORMONES AND INSULINS";
  assert.deepEqual(decode(encode({ atc: name })), { state: { ...structuredClone(DEFAULT_STATE), atc: name }, dropped: [] });
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
  const query = encodeUrl({ ...structuredClone(DEFAULT_STATE), ...lookup, view: "years", mah: ["A & B, C"] }).toString();
  assert.equal(query, "q=type+2+diabetes&med=EMEA%2FH%2FC%2F003820&sub=tenofovir+disoproxil&cond=D003924&view=years&mah=A+%26+B%2C+C");
  assert.deepEqual(lookupOf(query), lookup);
  assert.equal(encodeUrl({ ...structuredClone(DEFAULT_STATE), ...DEFAULT_LOOKUP }).toString(), "");
});

test("before the filter domain is known, the URL's filter part is passed through verbatim", () => {
  const filters = withoutLookup(new URLSearchParams("q=x&mah=B&med=M1&mah=A&from=2010"));
  assert.equal(filters.toString(), "mah=B&mah=A&from=2010");
  const query = encodeUrl({ ...structuredClone(DEFAULT_STATE), ...DEFAULT_LOOKUP, med: "M2" }, filters).toString();
  assert.equal(query, "med=M2&mah=B&mah=A&from=2010");
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
