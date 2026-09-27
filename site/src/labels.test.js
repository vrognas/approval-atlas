import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as labels from "./labels.js";

// Values only: raw EMA keys such as "Authorised" are allowed as object keys.
function* textValues(value) {
  if (typeof value === "string") yield value;
  else if (typeof value === "function") yield value.toString();
  else if (value && typeof value === "object") for (const item of Object.values(value)) yield* textValues(item);
}

test("no label value uses the British spelling 'authoris…'", () => {
  const values = [...textValues(labels)];
  assert.ok(values.length > 50);
  assert.deepEqual(values.filter((text) => /authoris/i.test(text)), []);
});

test("index.html has no British spelling 'authoris…'", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.deepEqual(html.match(/.{0,30}authoris.{0,30}/gi), null);
});

test("raw EMA statuses map to U.S. labels and unknown values pass through", () => {
  assert.equal(labels.statusLabel("Authorised"), "Authorized");
  assert.equal(labels.statusLabel("Withdrawn"), "Withdrawn");
  assert.equal(labels.statusLabel("Something new"), "Something new");
});

// All 14 WHO ATC level-1 names (atc_classes.json, ChEMBL_37) and their display form.
const ATC_LEVEL_ONE = {
  A: ["ALIMENTARY TRACT AND METABOLISM", "Alimentary Tract and Metabolism"],
  B: ["BLOOD AND BLOOD FORMING ORGANS", "Blood and Blood Forming Organs"],
  C: ["CARDIOVASCULAR SYSTEM", "Cardiovascular System"],
  D: ["DERMATOLOGICALS", "Dermatologicals"],
  G: ["GENITO URINARY SYSTEM AND SEX HORMONES", "Genito Urinary System and Sex Hormones"],
  H: ["SYSTEMIC HORMONAL PREPARATIONS, EXCL. SEX HORMONES AND INSULINS", "Systemic Hormonal Preparations, Excl. Sex Hormones and Insulins"],
  J: ["ANTIINFECTIVES FOR SYSTEMIC USE", "Antiinfectives for Systemic Use"],
  L: ["ANTINEOPLASTIC AND IMMUNOMODULATING AGENTS", "Antineoplastic and Immunomodulating Agents"],
  M: ["MUSCULO-SKELETAL SYSTEM", "Musculo-Skeletal System"],
  N: ["NERVOUS SYSTEM", "Nervous System"],
  P: ["ANTIPARASITIC PRODUCTS, INSECTICIDES AND REPELLENTS", "Antiparasitic Products, Insecticides and Repellents"],
  R: ["RESPIRATORY SYSTEM", "Respiratory System"],
  S: ["SENSORY ORGANS", "Sensory Organs"],
  V: ["VARIOUS", "Various"],
};

test("ATC level-1 names display in title case with minor words lower-case", () => {
  for (const [raw, expected] of Object.values(ATC_LEVEL_ONE)) assert.equal(labels.titleCaseAtcName(raw), expected);
  // Minor words and, or, for, of, the, in, to stay lower-case unless first; hyphen parts are capitalized.
  assert.equal(labels.titleCaseAtcName("THE USE OF IN-VITRO TESTS OR TO SEE"), "The Use of In-Vitro Tests or to See");
});

test("a level-1 ATC group shows as '{code} — {Title Case}'", () => {
  assert.equal(labels.atcLevelOneLabel("L", ATC_LEVEL_ONE.L[0]), "L — Antineoplastic and Immunomodulating Agents");
  assert.equal(labels.atcLevelOneLabel("X", undefined), "X");
});

const atcClassesFile = new URL("../public/data/atc_classes.json", import.meta.url);
test(
  "the title-case test covers every level-1 name in atc_classes.json",
  { skip: existsSync(atcClassesFile) ? false : "site/public/data/atc_classes.json not found" },
  () => {
    const levelOne = JSON.parse(readFileSync(atcClassesFile, "utf8")).filter((row) => row.level === 1);
    assert.deepEqual(
      Object.fromEntries(levelOne.map((row) => [row.atc_code, row.name])),
      Object.fromEntries(Object.entries(ATC_LEVEL_ONE).map(([code, [raw]]) => [code, raw])),
    );
  },
);

test("the Union Register chip and note use U.S. labels", () => {
  assert.equal(labels.UI.register.chip("Withdrawn", "2026-05-04"), "EU register: Withdrawn (4 May 2026)");
  assert.equal(labels.UI.register.chip("Active", null), "EU register: Active");
  assert.equal(
    labels.UI.register.note,
    "EMA and the Commission's Union Register (the legal record) show different statuses; either can lag behind a recent decision.",
  );
  assert.equal(labels.UI.register.notAuthorized(24), "24 of these are no longer authorized according to the EU Union Register.");
  assert.equal(labels.UI.register.notAuthorized(1), "1 of these is no longer authorized according to the EU Union Register.");
});

test("the About disclosure states intended use and privacy", () => {
  assert.equal(labels.UI.about.intendedUse, "Informational only — not medical or legal advice; not a medical device. Data can lag EMA.");
  assert.equal(
    labels.UI.about.privacy,
    "No cookies, no analytics, no tracking. Searches run in your browser. The site is hosted on GitHub Pages; GitHub may log IP addresses and page addresses, which include your search when a page is reloaded or opened from a link. Offline mode stores only this site's files and data on your device.",
  );
});

test("dates display as day, abbreviated month and year; missing dates stay missing", () => {
  assert.equal(labels.formatDate("2018-02-08"), "8 Feb 2018");
  assert.equal(labels.formatDate("2026-09-26"), "26 Sep 2026");
  assert.equal(labels.formatDate("2009-01-16"), "16 Jan 2009");
  assert.equal(labels.formatDate("1995-12-31"), "31 Dec 1995");
  assert.equal(labels.formatDate(null), null);
  assert.equal(labels.formatDate(undefined), null);
});

test("the header shows the data date in display form", () => {
  assert.equal(labels.UI.dataDate("2026-09-26"), "EMA human medicines · data as of 26 Sep 2026");
  assert.equal(labels.UI.offline("2026-09-26"), "Offline — data as of 26 Sep 2026");
});

test("raw EMA statuses fall into four kinds; unknown statuses count as ended", () => {
  const kinds = {
    Authorised: "authorized",
    Withdrawn: "ended",
    Expired: "ended",
    Lapsed: "ended",
    Revoked: "ended",
    Suspended: "ended",
    Opinion: "pending",
    "Opinion under re-examination": "pending",
    Refused: "refused",
    "Application withdrawn": "refused",
    "Withdrawn from rolling review": "refused",
    "Something new": "ended",
  };
  assert.deepEqual(Object.fromEntries(Object.keys(kinds).map((status) => [status, labels.statusKind(status)])), kinds);
});

test("the date line of the merged status cell: approval date, or end date and approval date", () => {
  assert.equal(labels.statusDateLine("Authorised", "2026-09-21", null), "21 Sep 2026");
  assert.equal(labels.statusDateLine("Authorised", null, null), "no approval date");
  assert.equal(labels.statusDateLine("Withdrawn", "2006-06-19", "2009-01-16"), "16 Jan 2009 · approved 19 Jun 2006");
  assert.equal(labels.statusDateLine("Withdrawn", "2006-06-19", null), "approved 19 Jun 2006");
  assert.equal(labels.statusDateLine("Withdrawn from rolling review", null, "2021-10-29"), "29 Oct 2021");
  assert.equal(labels.statusDateLine("Refused", null, null), null);
});

test("a medicine that is not authorized gets a status sentence built from EMA's dates only", () => {
  assert.equal(labels.statusSentence("Authorised", "2018-02-08", null), null);
  assert.equal(labels.statusSentence("Withdrawn", "2009-01-16", null), "Withdrawn on 16 Jan 2009.");
  assert.equal(labels.statusSentence("Withdrawn", null, null), "Withdrawn.");
  assert.equal(labels.statusSentence("Suspended", null, null), "Suspended.");
  assert.equal(labels.statusSentence("Refused", "2004-09-07", null), "Refused on 7 Sep 2004.");
  assert.equal(labels.statusSentence("Refused", null, null), "Refused.");
  assert.equal(labels.statusSentence("Application withdrawn", "2006-01-19", null), "Application withdrawn on 19 Jan 2006.");
  assert.equal(labels.statusSentence("Opinion", "2026-09-17", "Positive"), "Positive opinion on 17 Sep 2026; not yet authorized.");
  assert.equal(labels.statusSentence("Opinion", "2025-05-22", "Negative"), "Negative opinion on 22 May 2025.");
  assert.equal(labels.statusSentence("Opinion", null, null), "Opinion adopted; not yet authorized.");
  assert.equal(labels.statusSentence("Opinion under re-examination", "2026-06-25", "Negative"), "Opinion under re-examination; not yet authorized.");
});

test("the medicines table merges approval date and status into one column", () => {
  assert.deepEqual(labels.UI.table.headers, [
    "Medicine",
    "Marketing authorization holder",
    "Approved · Status",
    "Type",
    "ATC",
    "Therapeutic area",
    "Indication",
  ]);
});

test("tile shares are percentages with one decimal", () => {
  assert.equal(labels.formatShare(163, 1567), "10.4%");
  assert.equal(labels.formatShare(23, 1567), "1.5%");
  assert.equal(labels.formatShare(5, 5), "100.0%");
  assert.equal(labels.formatShare(0, 0), "0.0%");
});

// Headline parts: strings, or { text, tone } for the words the page colors.
const plain = (parts) => parts.map((part) => (typeof part === "string" ? part : part.text)).join("");
const toned = (parts) => parts.filter((part) => typeof part !== "string").map((part) => [part.text, part.tone]);

test("the home headline answers how many medicines are authorized, with or without filters", () => {
  const { headline } = labels.UI;
  assert.equal(plain(headline.home(1567)), "1,567 medicines are authorized in the EU today.");
  assert.deepEqual(toned(headline.home(1567)), [["1,567", "number"]]);
  assert.equal(plain(headline.filtered(12)), "12 authorized medicines match these filters.");
  assert.equal(plain(headline.filtered(1)), "1 authorized medicine matches these filters.");
  assert.equal(plain(headline.filtered(0)), "No authorized medicines match these filters.");
  assert.deepEqual(toned(headline.filtered(0)), []);
});

test("the years-view headline counts approved medicines and names a filtered year range", () => {
  const { headline } = labels.UI;
  assert.equal(plain(headline.approvedSince(2105, 1995)), "2,105 medicines have been approved in the EU since 1995.");
  assert.deepEqual(toned(headline.approvedSince(2105, 1995)), [["2,105", "number"]]);
  assert.equal(plain(headline.approvedSince(1, 1995)), "1 medicine has been approved in the EU since 1995.");
  assert.equal(plain(headline.approvedFiltered(425, "2015–2020")), "425 medicines approved in 2015–2020 match these filters.");
  assert.equal(plain(headline.approvedFiltered(1, "2015")), "1 medicine approved in 2015 matches these filters.");
  assert.equal(plain(headline.approvedFiltered(398, null)), "398 approved medicines match these filters.");
  assert.equal(plain(headline.approvedFiltered(1, null)), "1 approved medicine matches these filters.");
  assert.equal(plain(headline.approvedFiltered(0, "2015–2020")), "No medicines approved in 2015–2020 match these filters.");
  assert.equal(plain(headline.approvedFiltered(0, null)), "No approved medicines match these filters.");
  assert.deepEqual(toned(headline.approvedFiltered(0, null)), []);
});

test("a substance with no authorized medicine shows its medicines' statuses, most common first", () => {
  assert.deepEqual(labels.statusesByFrequency(["Withdrawn", "Withdrawn"]), ["Withdrawn"]);
  assert.deepEqual(labels.statusesByFrequency(["Expired", "Withdrawn", "Withdrawn", "Expired", "Withdrawn"]), ["Withdrawn", "Expired"]);
  // Ties: alphabetical.
  assert.deepEqual(labels.statusesByFrequency(["Withdrawn", "Refused"]), ["Refused", "Withdrawn"]);
  assert.deepEqual(labels.statusesByFrequency([]), []);
});

test("the home dek names substances and flag counts with plurals and without zero clauses", () => {
  const { dek } = labels.UI.headline;
  const counts = { products: 1567, substances: 1012, orphan: 163, generic: 246, biosimilar: 150, advancedTherapy: 23 };
  assert.equal(
    dek(counts),
    "They contain 1,012 distinct active substances. 163 carry an orphan designation, 246 are generics, 150 are biosimilars and 23 are advanced therapies.",
  );
  assert.equal(
    dek({ products: 1, substances: 1, orphan: 1, generic: 0, biosimilar: 0, advancedTherapy: 0 }),
    "It contains 1 distinct active substance. 1 carries an orphan designation.",
  );
  assert.equal(
    dek({ products: 3, substances: 2, orphan: 0, generic: 1, biosimilar: 1, advancedTherapy: 1 }),
    "They contain 2 distinct active substances. 1 is a generic, 1 is a biosimilar and 1 is an advanced therapy.",
  );
  assert.equal(dek({ products: 2, substances: 2, orphan: 0, generic: 0, biosimilar: 0, advancedTherapy: 0 }), "They contain 2 distinct active substances.");
  assert.equal(dek({ products: 0, substances: 0, orphan: 0, generic: 0, biosimilar: 0, advancedTherapy: 0 }), null);
});

test("lookup headlines answer whether it is authorized; 'not' and counts are toned", () => {
  const { headline } = labels.UI;
  assert.equal(plain(headline.medicine("Wegovy", true)), "Wegovy is authorized in the EU.");
  assert.equal(plain(headline.medicine("Acomplia", false)), "Acomplia is not authorized in the EU.");
  assert.deepEqual(toned(headline.medicine("Acomplia", false)), [["not", "negative"]]);
  assert.equal(plain(headline.substance("semaglutide", 5)), "Semaglutide is authorized in the EU in 5 medicines.");
  assert.deepEqual(toned(headline.substance("semaglutide", 5)), [["5", "number"]]);
  assert.equal(plain(headline.substance("rimonabant", 0)), "Rimonabant is not authorized in the EU.");
  assert.equal(plain(headline.substance("insulin human", 1)), "Insulin human is authorized in the EU in 1 medicine.");
  assert.equal(plain(headline.condition("Psoriasis", 52)), "52 medicines are authorized for Psoriasis.");
  assert.equal(plain(headline.condition("Psoriasis", 1)), "1 medicine is authorized for Psoriasis.");
  assert.equal(plain(headline.condition("Kuru", 0)), "No authorized medicines are tagged with Kuru.");
});

test("breakdown notes say how many authorized medicines have no value", () => {
  assert.equal(labels.UI.breakdown.atc.excluded(20), "20 authorized medicines without an ATC code are not shown.");
  assert.equal(labels.UI.breakdown.area.excluded(1), "1 authorized medicine without a therapeutic area is not shown.");
  assert.equal(labels.UI.breakdown.mah.excluded, undefined);
});

test("document lines leave out a missing update date instead of printing null", () => {
  assert.equal(labels.UI.card.updated(null), null);
  assert.equal(labels.UI.card.updated("8 Feb 2018"), "updated 8 Feb 2018");
  assert.equal(labels.UI.card.documentMeta(true, null), "PDF");
  assert.equal(labels.UI.card.documentMeta(true, "8 Feb 2018"), "PDF · updated 8 Feb 2018");
});
