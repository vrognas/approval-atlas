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

// UI copy uses commas, colons or parentheses instead; en-dash ranges ("1995–2026") stay.
test("no label value and no index.html text uses an em-dash", () => {
  assert.deepEqual([...textValues(labels)].filter((text) => text.includes("—")), []);
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.deepEqual(html.match(/.{0,30}—.{0,30}/g), null);
});

// "Authorized today" reads as "got its authorization today" (phase 4c): "currently authorized".
test("no label value says 'authorized today'", () => {
  assert.deepEqual([...textValues(labels)].filter((text) => /authorized today/i.test(text)), []);
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
  H: ["SYSTEMIC HORMONAL PREPARATIONS, EXCL. SEX HORMONES AND INSULINS", "Systemic Hormonal Preparations, excl. Sex Hormones and Insulins"],
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
  for (const [raw, expected] of Object.values(ATC_LEVEL_ONE)) assert.equal(labels.atcDisplayName(raw), expected);
  // Minor words stay lower-case unless first or last; hyphen parts are capitalized.
  assert.equal(labels.atcDisplayName("THE USE OF IN-VITRO TESTS OR TO SEE WITH AN EYE BY NIGHT"), "The Use of In-Vitro Tests or to See with an Eye by Night");
  assert.equal(
    labels.atcDisplayName("AGENTS ON, AS, AT, FROM, PER, VIA, VS, NOR, BUT AND/OR BY"),
    "Agents on, as, at, from, per, via, vs, nor, but and/or By",
  );
});

// Real WHO names at levels 2-5 (atc_classes.json, ChEMBL_37) and their display form.
const ATC_NAMES = {
  A02B: ["DRUGS FOR PEPTIC ULCER AND GASTRO-OESOPHAGEAL REFLUX DISEASE (GORD)", "Drugs for Peptic Ulcer and Gastro-Oesophageal Reflux Disease (GORD)"],
  A10: ["DRUGS USED IN DIABETES", "Drugs Used in Diabetes"],
  A11C: ["VITAMIN A AND D, INCL. COMBINATIONS OF THE TWO", "Vitamin A and D, incl. Combinations of the Two"],
  A11D: ["VITAMIN B1, PLAIN AND IN COMBINATION WITH VITAMIN B6 AND B12", "Vitamin B1, Plain and in Combination with Vitamin B6 and B12"],
  A11G: ["ASCORBIC ACID (VITAMIN C), INCL. COMBINATIONS", "Ascorbic Acid (Vitamin C), incl. Combinations"],
  B05B: ["I.V. SOLUTIONS", "I.V. Solutions"],
  C01B: ["ANTIARRHYTHMICS, CLASS I AND III", "Antiarrhythmics, Class I and III"],
  // A minor word ends the name: capitalized (Chicago).
  C02D: ["ARTERIOLAR SMOOTH MUSCLE, AGENTS ACTING ON", "Arteriolar Smooth Muscle, Agents Acting On"],
  C03AH: ["Thiazides, combinations with psycholeptics and/or analgesics", "Thiazides, Combinations with Psycholeptics and/or Analgesics"],
  C09: ["AGENTS ACTING ON THE RENIN-ANGIOTENSIN SYSTEM", "Agents Acting on the Renin-Angiotensin System"],
  C09XX: ["Other agents acting on the renin-angiotensin system", "Other Agents Acting on the Renin-Angiotensin System"],
  C09A: ["ACE INHIBITORS, PLAIN", "ACE Inhibitors, Plain"],
  C09C: ["ANGIOTENSIN II RECEPTOR BLOCKERS (ARBs), PLAIN", "Angiotensin II Receptor Blockers (ARBs), Plain"],
  D02B: ["PROTECTIVES AGAINST UV-RADIATION", "Protectives Against UV-Radiation"],
  D04: ["ANTIPRURITICS, INCL. ANTIHISTAMINES, ANESTHETICS, ETC.", "Antipruritics, incl. Antihistamines, Anesthetics, Etc."],
  L04: ["IMMUNOSUPPRESSANTS", "Immunosuppressants"],
  M01B: ["ANTIINFLAMMATORY/ANTIRHEUMATIC AGENTS IN COMBINATION", "Antiinflammatory/Antirheumatic Agents in Combination"],
  N06B: ["PSYCHOSTIMULANTS, AGENTS USED FOR ADHD AND NOOTROPICS", "Psychostimulants, Agents Used for ADHD and Nootropics"],
  S01GA: ["Sympathomimetics used as decongestants", "Sympathomimetics Used as Decongestants"],
  // "AIDS" here is a word, not the acronym.
  S01K: ["SURGICAL AIDS", "Surgical Aids"],
  V08A: ["X-RAY CONTRAST MEDIA, IODINATED", "X-Ray Contrast Media, Iodinated"],
  V10B: ["PAIN PALLIATION (BONE SEEKING AGENTS)", "Pain Palliation (Bone Seeking Agents)"],
  H01AA: ["ACTH", "ACTH"],
  A10BH: ["Dipeptidyl peptidase 4 (DPP-4) inhibitors", "Dipeptidyl Peptidase 4 (DPP-4) Inhibitors"],
  A10BJ: ["Glucagon-like peptide-1 (GLP-1) analogues", "Glucagon-Like Peptide-1 (GLP-1) Analogues"],
  A10BK: ["Sodium-glucose co-transporter 2 (SGLT2) inhibitors", "Sodium-Glucose Co-Transporter 2 (SGLT2) Inhibitors"],
  B05XX: ["Other i.v. solution additives", "Other I.V. Solution Additives"],
  C10AA: ["HMG CoA reductase inhibitors", "HMG CoA Reductase Inhibitors"],
  J07BN: ["Covid-19 vaccines", "Covid-19 Vaccines"],
  L01EC: ["B-Raf serine-threonine kinase (BRAF) inhibitors", "B-Raf Serine-Threonine Kinase (BRAF) Inhibitors"],
  L01EG: ["Mammalian target of rapamycin (mTOR) kinase inhibitors", "Mammalian Target of Rapamycin (mTOR) Kinase Inhibitors"],
  L01EL: ["Bruton's tyrosine kinase (BTK) inhibitors", "Bruton's Tyrosine Kinase (BTK) Inhibitors"],
  L01FD: ["HER2 (Human Epidermal Growth Factor Receptor 2) inhibitors", "HER2 (Human Epidermal Growth Factor Receptor 2) Inhibitors"],
  L01FF: ["PD-1/PD-L1 (Programmed cell death protein 1/death ligand 1) inhibitors", "PD-1/PD-L1 (Programmed Cell Death Protein 1/Death Ligand 1) Inhibitors"],
  // Hyphenated compounds capitalize every part, as "Musculo-Skeletal".
  L04AB: ["Tumor necrosis factor alpha (TNF-alpha) inhibitors", "Tumor Necrosis Factor Alpha (TNF-Alpha) Inhibitors"],
  L04AC: ["Interleukin inhibitors", "Interleukin Inhibitors"],
  N04BD: ["Monoamine oxidase B inhibitors", "Monoamine Oxidase B Inhibitors"],
  V08AA: ["Watersoluble, nephrotropic, high osmolar X-ray contrast media", "Watersoluble, Nephrotropic, High Osmolar X-Ray Contrast Media"],
  A09AA02: ["multienzymes (lipase, protease etc.)", "Multienzymes (Lipase, Protease Etc.)"],
  A10AB01: ["insulin (human)", "Insulin (Human)"],
  A10BD07: ["metformin and sitagliptin", "Metformin and Sitagliptin"],
  A10BJ06: ["semaglutide", "Semaglutide"],
  B02BD01: ["coagulation factor IX, II, VII and X in combination", "Coagulation Factor IX, II, VII and X in Combination"],
  B02BD06: ["von Willebrand factor and coagulation factor VIII in combination", "Von Willebrand Factor and Coagulation Factor VIII in Combination"],
  B02BD08: ["coagulation factor VIIa", "Coagulation Factor VIIa"],
  B05AX04: ["stem cells from umbilical cord blood", "Stem Cells from Umbilical Cord Blood"],
  C07AB11: ["s-atenolol", "S-Atenolol"],
  J06BA01: ["immunoglobulins, normal human, for extravascular adm.", "Immunoglobulins, Normal Human, for Extravascular Adm."],
  J06BB01: ["anti-D (rh) immunoglobulin", "Anti-D (Rh) Immunoglobulin"],
  J07AG54: ["haemophilus influenza B, combinations with meningococcus C,Y, conjugated", "Haemophilus Influenza B, Combinations with Meningococcus C,Y, Conjugated"],
  J07BN01: ["covid-19, RNA-based vaccine", "Covid-19, RNA-Based Vaccine"],
  L03AB07: ["interferon beta-1a", "Interferon Beta-1a"],
  L04AC05: ["ustekinumab", "Ustekinumab"],
  V09IX17: ["PSMA-1007 (18F)", "PSMA-1007 (18F)"],
};

test("ATC names at every level display in title case: acronyms, digits and inner capitals as written", () => {
  for (const [raw, expected] of Object.values(ATC_NAMES)) assert.equal(labels.atcDisplayName(raw), expected, raw);
});

test("an ATC class shows as '{code} {Title Case name}', the code alone without a WHO name", () => {
  assert.equal(labels.atcClassLabel("L", ATC_LEVEL_ONE.L[0]), "L Antineoplastic and Immunomodulating Agents");
  assert.equal(labels.atcClassLabel("L04", "IMMUNOSUPPRESSANTS"), "L04 Immunosuppressants");
  assert.equal(labels.atcClassLabel("L04AC05", "ustekinumab"), "L04AC05 Ustekinumab");
  assert.equal(labels.atcClassLabel("X", undefined), "X");
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

test(
  "the level 2-5 names tested are the file's, and display changes only letter case",
  { skip: existsSync(atcClassesFile) ? false : "site/public/data/atc_classes.json not found" },
  () => {
    const names = new Map(JSON.parse(readFileSync(atcClassesFile, "utf8")).map((row) => [row.atc_code, row.name]));
    assert.deepEqual(Object.keys(ATC_NAMES).filter((code) => names.get(code) !== ATC_NAMES[code][0]), []);
    const changed = [...names.values()].filter((name) => labels.atcDisplayName(name).toLowerCase() !== name.toLowerCase());
    assert.deepEqual(changed, []);
  },
);

test("the Union Register chip and note use U.S. labels", () => {
  assert.equal(labels.UI.register.chip("Withdrawn", "2026-05-04"), "EU register: Withdrawn (4 May 2026)");
  assert.equal(labels.UI.register.chip("Active", null), "EU register: Active");
  assert.equal(
    labels.UI.register.note,
    "EMA and the Commission's Union Register (the legal record) show different statuses; either can lag behind a recent decision.",
  );
  // Under all the tiles: names the population it counts in (the medicines EMA lists as currently authorized).
  assert.equal(labels.UI.register.notAuthorized(24), "24 of the medicines EMA lists as currently authorized are no longer authorized according to the EU Union Register.");
  assert.equal(labels.UI.register.notAuthorized(1), "1 of the medicines EMA lists as currently authorized is no longer authorized according to the EU Union Register.");
});

test("the About disclosure states intended use and privacy", () => {
  assert.equal(labels.UI.about.intendedUse, "Informational only: not medical or legal advice; not a medical device. Data can lag EMA.");
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
  assert.equal(labels.UI.offline("2026-09-26"), "Offline: data as of 26 Sep 2026");
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

test("tiles: every medicine and those currently authorized, then the four types with their share", () => {
  assert.deepEqual(labels.UI.tiles.map((tile) => [tile.key, tile.label]), [
    ["products", "Medicines"],
    ["authorized", "Currently authorized"],
    ["orphan", "Orphan"],
    ["biosimilar", "Biosimilar"],
    ["generic", "Generic"],
    ["advancedTherapy", "Advanced therapy"],
  ]);
  // The Medicines tile's caption follows the filters.
  assert.equal(labels.UI.tiles[0].caption, "Every status in the EMA data");
  assert.equal(labels.UI.tiles[0].captionFiltered, "Every status, matching the filters");
  assert.equal(labels.UI.undatedAuthorized(6), "6 authorized medicines without an approval date are not counted as currently authorized.");
  assert.equal(labels.UI.undatedAuthorized(1), "1 authorized medicine without an approval date is not counted as currently authorized.");
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

// One dashboard (phase 4a): every medicine in the EMA data, and how many of them are currently authorized
// (phase 4c: not "authorized today", which reads as "authorized on this date").
test("the dashboard headline counts the medicines and those currently authorized, with or without filters", () => {
  const { headline } = labels.UI;
  assert.equal(plain(headline.home(2351, 1567)), "1,567 of 2,351 medicines in the EMA data are currently authorized in the EU.");
  assert.deepEqual(toned(headline.home(2351, 1567)), [["1,567", "number"], ["2,351", "number"]]);
  assert.equal(plain(headline.filtered(12, 5)), "12 medicines match these filters, 5 of them currently authorized.");
  assert.deepEqual(toned(headline.filtered(12, 5)), [["12", "number"], ["5", "number"]]);
  assert.equal(plain(headline.filtered(12, 12)), "12 medicines match these filters, all of them currently authorized.");
  assert.equal(plain(headline.filtered(12, 0)), "12 medicines match these filters, none of them currently authorized.");
  assert.equal(plain(headline.filtered(1, 1)), "1 medicine matches these filters; it is currently authorized.");
  assert.equal(plain(headline.filtered(1, 0)), "1 medicine matches these filters; it is not currently authorized.");
  assert.deepEqual(toned(headline.filtered(1, 0)), [["1", "number"], ["not", "negative"]]);
  assert.equal(plain(headline.filtered(0, 0)), "No medicines match these filters.");
  assert.deepEqual(toned(headline.filtered(0, 0)), []);
});

test("the dek starts with the medicines by status: the top four, then how many more", () => {
  const { statuses } = labels.UI.headline;
  const all = [
    ["Authorised", 1573], ["Withdrawn", 363], ["Application withdrawn", 268], ["Refused", 64], ["Lapsed", 27], ["Opinion", 25],
    ["Expired", 17], ["Revoked", 9], ["Opinion under re-examination", 2], ["Withdrawn from rolling review", 2], ["Suspended", 1],
  ].map(([status, count]) => ({ status, count }));
  assert.equal(statuses(all), "By status: 1,573 authorized, 363 withdrawn, 268 applications withdrawn, 64 refused and 83 more.");
  assert.equal(statuses(all.slice(0, 4)), "By status: 1,573 authorized, 363 withdrawn, 268 applications withdrawn and 64 refused.");
  assert.equal(statuses([{ status: "Withdrawn", count: 1 }]), "By status: 1 withdrawn.");
  assert.equal(
    statuses([{ status: "Opinion", count: 2 }, { status: "Application withdrawn", count: 1 }, { status: "Opinion under re-examination", count: 1 }]),
    "By status: 2 awaiting a decision, 1 application withdrawn and 1 under re-examination.",
  );
  assert.equal(statuses([{ status: "Something new", count: 3 }]), "By status: 3 something new.");
  assert.equal(statuses([]), null);
  // Phase 4c review: the authorized ones without an approval date are named, so the dek agrees with
  // the headline's "currently authorized" count (1,567 = 1,573 - 6).
  assert.equal(
    statuses(all, 6),
    "By status: 1,573 authorized (6 without an approval date, not counted above), 363 withdrawn, 268 applications withdrawn, 64 refused and 83 more.",
  );
  assert.equal(statuses(all.slice(0, 1), 1), "By status: 1,573 authorized (1 without an approval date, not counted above).");
  assert.equal(statuses(all.slice(0, 1), 0), "By status: 1,573 authorized.");
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
  assert.equal(plain(headline.medicine("Wegovy", "authorized")), "Wegovy is authorized in the EU.");
  assert.equal(plain(headline.medicine("Acomplia", "ended")), "Acomplia is not authorized in the EU.");
  assert.deepEqual(toned(headline.medicine("Acomplia", "ended")), [["not", "negative"]]);
  assert.deepEqual(toned(headline.medicine("Grasustek", "refused")), [["not", "negative"]]);
  // Opinion adopted, no decision yet: "not yet", in the pending tone.
  assert.equal(plain(headline.medicine("Vyloy", "pending")), "Vyloy is not yet authorized in the EU.");
  assert.deepEqual(toned(headline.medicine("Vyloy", "pending")), [["not yet", "pending"]]);
  assert.equal(plain(headline.substance("semaglutide", 5)), "Semaglutide is authorized in the EU in 5 medicines.");
  assert.deepEqual(toned(headline.substance("semaglutide", 5)), [["5", "number"]]);
  assert.equal(plain(headline.substance("rimonabant", 0)), "Rimonabant is not authorized in the EU.");
  assert.equal(plain(headline.substance("insulin human", 1)), "Insulin human is authorized in the EU in 1 medicine.");
  // Phase 4c review: EMA's therapeutic-area tags, not indications; narrower terms count too.
  assert.equal(plain(headline.condition("Psoriasis", 52, true)), "52 authorized medicines are tagged by EMA with Psoriasis or a narrower condition.");
  assert.equal(plain(headline.condition("Psoriasis", 1, false)), "1 authorized medicine is tagged by EMA with Psoriasis.");
  assert.deepEqual(toned(headline.condition("Psoriasis", 52, true)), [["52", "number"]]);
  assert.equal(plain(headline.condition("Kuru", 0, false)), "No authorized medicines are tagged by EMA with Kuru.");
  assert.equal(plain(headline.condition("Kuru", 0, true)), "No authorized medicines are tagged by EMA with Kuru or a narrower condition.");
});

test("a condition page names its narrower conditions and splits the tagged medicines", () => {
  const { condition } = labels.UI;
  assert.equal(condition.narrowerLead(1), "Includes the narrower condition ");
  assert.equal(condition.narrowerLead(3), "Includes the narrower conditions ");
  assert.equal(condition.narrowerMore(4), " and 4 more");
  assert.equal(condition.taggedOwn("Psoriasis", 43), "Tagged by EMA with Psoriasis (43)");
  assert.equal(condition.taggedNarrower(9), "Tagged with a narrower condition (9)");
  assert.equal(condition.rowTagged, "Tagged with ");
});

test("an ATC class without a WHO name reads as its code alone", () => {
  assert.equal(labels.atcClassLabel("L04AL", null), "L04AL");
  assert.equal(labels.atcClassLabel("L04AL", undefined), "L04AL");
});

test("next to a code badge the name stands alone in title case, a missing name says so", () => {
  assert.equal(labels.atcName(ATC_LEVEL_ONE.L[0]), "Antineoplastic and Immunomodulating Agents");
  assert.equal(labels.atcName("Interleukin inhibitors"), "Interleukin Inhibitors");
  assert.equal(labels.atcName(null), "no WHO name yet");
});

test("ATC segment buttons name the level and class they filter by", () => {
  const { filterBy } = labels.UI.atc;
  assert.equal(filterBy(2, "L04", "IMMUNOSUPPRESSANTS"), "Filter by ATC level 2: L04 Immunosuppressants");
  assert.equal(filterBy(1, "L", ATC_LEVEL_ONE.L[0]), "Filter by ATC level 1: L Antineoplastic and Immunomodulating Agents");
  assert.equal(filterBy(4, "L04AL", null), "Filter by ATC level 4: L04AL no WHO name yet");
  // The badge's segments are one toolbar.
  assert.equal(labels.UI.atc.toolbar("L04AC05"), "ATC L04AC05");
});

// Accessible names: the badge, name and count spans would otherwise read glued together.
test("tree, path and bar controls name the class and its count of medicines", () => {
  const { classCount } = labels.UI.atc;
  assert.equal(classCount("L04AC05", "ustekinumab", 12), "L04AC05 Ustekinumab, 12 medicines");
  assert.equal(classCount("L", ATC_LEVEL_ONE.L[0], 1481), "L Antineoplastic and Immunomodulating Agents, 1,481 medicines");
  assert.equal(classCount("L04AL", null, 1), "L04AL no WHO name yet, 1 medicine");
  assert.equal(classCount("L04", "IMMUNOSUPPRESSANTS", null), "L04 Immunosuppressants");
});

test("stacked ATC bars name their split by medicine type", () => {
  const { typeSplit } = labels.UI.breakdown;
  assert.equal(typeSplit([["Other", 1], ["Biosimilar", 11]]), "1 Other, 11 Biosimilar");
  assert.equal(
    `${labels.UI.atc.classCount("L04AC05", "ustekinumab", 12)}: ${typeSplit([["Other", 1], ["Biosimilar", 11]])}`,
    "L04AC05 Ustekinumab, 12 medicines: 1 Other, 11 Biosimilar",
  );
});

test("the ATC tree: search, expand buttons, classes included under a checked one, name filters", () => {
  const { atc } = labels.UI;
  assert.equal(atc.find, "Find an ATC class");
  assert.equal(atc.expand("L04"), "Classes in L04");
  assert.equal(atc.included("L04AC", "Interleukin inhibitors", 30, "L04"), "L04AC Interleukin Inhibitors, 30 medicines, included in L04");
  assert.equal(atc.nameQueries(["insulin"]), "Also filtering by class names matching “insulin”.");
  assert.equal(atc.nameQueries(["insulin", "statin"]), "Also filtering by class names matching “insulin” or “statin”.");
  assert.equal(atc.noMatches, "No matching ATC classes");
  assert.equal(labels.UI.sentence.many.atc(3), "3 ATC classes");
});

// Hover and focus explanations of the medicine types and the orphan flag.
test("each type badge has an explanation of at most 12 words", () => {
  const { typeTips } = labels.UI;
  // Phase 4c review: Other, the largest type, is explained too.
  assert.deepEqual(Object.keys(typeTips).sort(), ["Advanced therapy", "Biosimilar", "Generic", "Orphan", "Other"]);
  assert.equal(typeTips.Other, "Not a generic, biosimilar or advanced therapy (e.g. a new active substance).");
  assert.equal(typeTips.Orphan, "For rare diseases (at most 5 in 10,000 people in the EU).");
  assert.equal(typeTips.Biosimilar, "Highly similar to a biological medicine already approved in the EU.");
  assert.equal(typeTips.Generic, "Same active substance as an already approved reference medicine.");
  assert.equal(typeTips["Advanced therapy"], "Gene therapy, cell therapy or tissue-engineered medicine.");
  for (const tip of Object.values(typeTips)) assert.ok(tip.split(" ").length <= 12, tip);
});

// Visible text first in the accessible name, so speech input can use it (WCAG 2.5.3).
test("quick document links: PI and EPAR, named with the medicine", () => {
  const { documentLinks } = labels.UI;
  assert.equal(documentLinks.productInformation.text, "PI");
  assert.equal(documentLinks.productInformation.label("Wegovy"), "PI, product information PDF for Wegovy");
  assert.equal(documentLinks.epar.text, "EPAR");
  assert.equal(documentLinks.epar.label("Wegovy"), "EPAR public assessment report PDF for Wegovy");
});

test("filter sentence, sidebar and sheet copy", () => {
  const { sentence, facets, sheet } = labels.UI;
  // Tokens: the visible text first (WCAG 2.5.3), then the filter they belong to.
  assert.equal(sentence.tokenName("type", "all medicine types"), "all medicine types, medicine type filter");
  assert.equal(sentence.tokenName("from", "1995"), "1995, start year filter");
  assert.equal(sentence.tokenName("to", "2026"), "2026, end year filter");
  assert.equal(sentence.tokenName("areas", "all therapeutic areas"), "all therapeutic areas, therapeutic area filter");
  assert.equal(sentence.remove("type", "Biosimilar"), "Remove medicine type filter: Biosimilar");
  assert.equal(sentence.remove("from", "2010"), "Remove start year filter: 2010");
  // One approval year: one token for both ends.
  assert.equal(sentence.words.approvedIn, ", approved in ");
  assert.equal(sentence.tokenName("year", "2024"), "2024, approval year filter");
  assert.equal(sentence.remove("year", "2024"), "Remove approval year filter: 2024");
  for (const key of ["type", "atc", "mah", "areas", "branch", "area", "from", "to", "year", "status"]) assert.ok(sentence.dimensions[key], key);
  assert.equal(sentence.reset, "Reset");
  assert.equal(sentence.allFilters, "All filters");
  assert.equal(facets.active(0), null);
  assert.equal(facets.active(2), "2 active");
  assert.equal(facets.counts, "Counts: medicines matching the other filters.");
  assert.equal(facets.search(659, "areas"), "Filter 659 areas");
  assert.equal(facets.showAll(41), "Show all 41");
  assert.equal(facets.showMore(20), "Show 20 more");
  assert.equal(facets.matches(0), "No matches");
  assert.equal(facets.matches(1), "1 match");
  assert.equal(facets.matches(1234), "1,234 matches");
  assert.equal(sheet.show(33), "Show 33 medicines");
  assert.equal(sheet.show(1), "Show 1 medicine");
  assert.equal(sheet.clear, "Clear");
  assert.equal(sheet.close, "Close filters");
});

test("approval-years strip copy: slider names, the summary and tooltips of the stacked bars, the undated note", () => {
  const { yearStrip } = labels.UI;
  const statuses = [{ status: "Authorised", count: 1567 }, { status: "Withdrawn", count: 362 }];
  assert.equal(yearStrip.start, "Start year");
  assert.equal(yearStrip.end, "End year");
  assert.equal(
    yearStrip.summary(1995, 2026, 1985, 2021, 95, statuses),
    "Column chart of approvals per year, 1995 to 2026, stacked by current status, of the medicines matching the other filters: " +
      "1,985 in total (1,567 Authorized, 362 Withdrawn), most in 2021 (95).",
  );
  assert.equal(yearStrip.summary(1995, 2026, 0, 1995, 0, []), "No medicines with an approval date match the other filters.");
  assert.equal(yearStrip.tooltip(2015, 71, [{ status: "Authorised", count: 65 }, { status: "Withdrawn", count: 6 }]), "2015: 71 approvals\n65 Authorized\n6 Withdrawn");
  assert.equal(yearStrip.tooltip(1996, 0, []), "1996: 0 approvals");
  assert.equal(yearStrip.undated(366), "366 medicines without an approval date (refused, application withdrawn, pending…) are not in this chart.");
  assert.equal(yearStrip.undated(1), "1 medicine without an approval date (refused, application withdrawn, pending…) is not in this chart.");
  // Phase 4c review: a year filter also leaves them out of every count.
  assert.equal(
    yearStrip.undated(366, true),
    "366 medicines without an approval date (refused, application withdrawn, pending…) are not in this chart, and the year filter leaves them out of every count.",
  );
  // The legend states the stack order, so position identifies a segment, not only its colour.
  assert.equal(yearStrip.legendLead, "Bottom to top:");
});

// Shown with and without filters (phase 4c), with a hint that leads to the condition pages.
test("the most common conditions card names the medicines it covers and how to open a condition", () => {
  const { conditions } = labels.UI;
  assert.equal(conditions.title, "Most common conditions");
  // Phase 4c review: each row counts every status, then the authorized ones (the condition page's list).
  assert.equal(conditions.subtitle(2351, false), "Therapeutic areas of all 2,351 medicines in the EMA data: medicines of every status, then those authorized");
  assert.equal(conditions.subtitle(33, true), "Therapeutic areas of the 33 medicines matching the filters: medicines of every status, then those authorized");
  assert.equal(conditions.subtitle(1, true), "Therapeutic areas of the 1 medicine matching the filters: medicines of every status, then those authorized");
  assert.equal(conditions.authorized(48), "48 authorized");
  assert.equal(conditions.hint, "Open a condition to see its approval timeline.");
  assert.equal(conditions.empty(0), "No medicines match the current filters.");
  assert.equal(conditions.empty(1), "No therapeutic area is listed for this medicine.");
  assert.equal(conditions.empty(3), "No therapeutic areas are listed for these medicines.");
  assert.equal(conditions.open("Neoplasms"), "Open condition page: Neoplasms");
});

// Every link to another website says where it goes and that it opens a new tab (phase 4c).
test("external links name their destination for screen readers and as a tooltip", () => {
  const { external } = labels.UI;
  assert.equal(external.destinations["www.ema.europa.eu"], "EMA website");
  assert.equal(external.newTab("EMA website"), "(opens EMA website in a new tab)");
  assert.equal(external.title("EMA website", "www.ema.europa.eu"), "EMA website (www.ema.europa.eu)");
  assert.equal(external.title("example.org", "example.org"), "example.org");
});

test("condition and substance results are tables with the medicines table's columns, holder last", () => {
  assert.deepEqual(labels.UI.results.headers, ["Medicine", "ATC", "Approved · Status", "Type", "Holder"]);
  // Phase 4c review: substance cards add what each medicine is for, after the medicine.
  assert.equal(labels.UI.results.areas, "Therapeutic area");
});

test("the results timeline explains its dots and lines", () => {
  const { timeline } = labels.UI;
  assert.equal(timeline.caption, "One dot per medicine; lines join medicines with the same active substances (reference, generics, biosimilars). Tap or point at a dot for its name.");
  assert.equal(timeline.hollow, "Hollow dots: only mentioned in the indication text.");
  assert.equal(timeline.mentioned, "Only mentioned in the indication text");
});

test("the medicines table lists every matching medicine, undated ones last", () => {
  const { caption } = labels.UI.table;
  assert.equal(caption(2351, 366), "2,351 medicines, newest approval first; the 366 without an approval date last, by status");
  assert.equal(caption(12, 0), "12 medicines, newest approval first");
  assert.equal(caption(1, 1), "1 medicine without an approval date");
  assert.equal(caption(2, 2), "2 medicines without an approval date, by status");
});

// "Who is active where": holders x ATC groups or therapeutic area groups.
test("the holder activity card: title, modes, cell names and the holder-name note", () => {
  const { activity } = labels.UI;
  assert.equal(activity.title, "Who is active where");
  assert.deepEqual(activity.modes, { atc: "ATC groups", area: "Therapeutic areas" });
  assert.equal(
    activity.cell("Novartis Europharm Limited", "L Antineoplastic and Immunomodulating Agents", 30),
    "Novartis Europharm Limited, L Antineoplastic and Immunomodulating Agents: 30 medicines",
  );
  assert.equal(activity.cell("Accord Healthcare S.L.U.", "Neoplasms", 1), "Accord Healthcare S.L.U., Neoplasms: 1 medicine");
  assert.equal(activity.subtitle(15), "The 15 holders with the most matching medicines; a medicine can count in several columns.");
  assert.equal(activity.subtitle(1), "The holder of the matching medicines; a medicine can count in several columns.");
  assert.equal(activity.note, "Holder names are shown as EMA publishes them; the same company can appear under several names.");
  assert.equal(activity.other, "Other");
});

test("ladder links name the level, the class and the medicines currently authorized", () => {
  const { ladderLink } = labels.UI.atc;
  assert.equal(ladderLink(1, "A", ATC_LEVEL_ONE.A[0], 180), "Level 1, A Alimentary Tract and Metabolism: 180 authorized medicines");
  assert.equal(ladderLink(5, "A10BJ06", "semaglutide", 1), "Level 5, A10BJ06 Semaglutide: 1 authorized medicine");
  assert.equal(ladderLink(4, "L04AL", null, 0), "Level 4, L04AL no WHO name yet: 0 authorized medicines");
  // Counts still loading.
  assert.equal(ladderLink(2, "A10", "DRUGS USED IN DIABETES", null), "Level 2, A10 Drugs Used in Diabetes");
});

test("the class headline counts the medicines in one ATC class and those currently authorized", () => {
  const { atcClass } = labels.UI.headline;
  const label = "L Antineoplastic and Immunomodulating Agents";
  assert.equal(plain(atcClass(481, 330, label)), `481 medicines in ${label}, 330 of them currently authorized.`);
  assert.deepEqual(toned(atcClass(481, 330, label)), [["481", "number"], ["330", "number"]]);
  assert.equal(plain(atcClass(3, 0, "L04AL")), "3 medicines in L04AL, none of them currently authorized.");
  assert.equal(plain(atcClass(1, 1, "L04AL")), "1 medicine in L04AL; it is currently authorized.");
  assert.equal(plain(atcClass(0, 0, "X01")), "No medicines in the EMA data are classed X01.");
  assert.deepEqual(toned(atcClass(0, 0, "X01")), []);
});

test("the ATC breakdown copy counts medicines of every status", () => {
  const { atc } = labels.UI;
  assert.equal(labels.UI.breakdown.atc.title, "Medicines by ATC level 1");
  assert.equal(labels.UI.breakdown.atc.titleIn("L04 Immunosuppressants"), "Medicines in L04 Immunosuppressants by ATC class");
  assert.equal(labels.UI.breakdown.atc.titleLeaf("L04AC05 Ustekinumab"), "Medicines in L04AC05 Ustekinumab");
  assert.equal(labels.UI.breakdown.area.title, "Medicines by therapeutic area group (MeSH branch)");
  assert.equal(labels.UI.breakdown.mah.title, "Medicines by marketing authorization holder");
  assert.equal(labels.UI.breakdown.empty, "No medicines match the current filters.");
  // Phase 4c review: retired and incomplete codes are mapped (atcCode()), so the note says how.
  assert.equal(atc.note, "Retired codes count under the class WHO moved them to; codes EMA left incomplete are completed from the product information (SmPC) where it gives one.");
  assert.equal(atc.incomplete, "code incomplete");
});

test("a substance card names the medicines classed under another code", () => {
  assert.equal(labels.UI.atc.classed(["Kyinsu"], "A10AE57"), "Kyinsu is classed A10AE57.");
  assert.equal(labels.UI.atc.classed(["MabThera", "Truxima", "Ruxience"], "L01XC02"), "MabThera, Truxima and Ruxience are classed L01XC02.");
});

test("drug classes are a lookup suggestion group with an authorized count", () => {
  assert.equal(labels.UI.lookup.groups.classes, "Drug classes");
  assert.equal(labels.UI.lookup.classMeta(1234), "1,234 authorized");
  assert.equal(labels.UI.lookup.classMeta(20, true), "no WHO name yet · 20 authorized");
  // A drug class example opens the class alone (url.js classState()).
  assert.deepEqual(labels.UI.lookup.examples.at(-1), { label: "L04AC", atc: "L04AC" });
});

test("breakdown notes say how many medicines have no value", () => {
  assert.equal(labels.UI.breakdown.atc.excluded(20), "20 medicines without a valid ATC code are not shown.");
  assert.equal(labels.UI.breakdown.area.excluded(1), "1 medicine without a therapeutic area is not shown.");
  assert.equal(labels.UI.breakdown.mah.excluded, undefined);
});

test("document lines leave out a missing update date instead of printing null", () => {
  assert.equal(labels.UI.card.updated(null), null);
  assert.equal(labels.UI.card.updated("8 Feb 2018"), "updated 8 Feb 2018");
  assert.equal(labels.UI.card.documentMeta(true, null), "PDF");
  assert.equal(labels.UI.card.documentMeta(true, "8 Feb 2018"), "PDF · updated 8 Feb 2018");
});

// Phase 4c: the sidebar splitter, sorting, and the per-year chart's stack category.
test("the sidebar splitter is named for what it resizes, with a hint", () => {
  assert.equal(labels.UI.sidebar.resize, "Resize filters");
  assert.equal(labels.UI.sidebar.hint, "Drag or use the arrow keys to resize the filters; double-click to reset");
});

test("the breakdown sorts by count or by code (ATC) and name (areas, holders)", () => {
  const { sort } = labels.UI.breakdown;
  assert.equal(sort.label, "Sort");
  assert.equal(sort.count, "Count");
  assert.deepEqual(sort.key, { atc: "Code", area: "Name", mah: "Name" });
});

test("the holder activity card: sort buttons, column order and row names with the total", () => {
  const { activity } = labels.UI;
  assert.equal(activity.sortBy("L Antineoplastic and Immunomodulating Agents"), "Sort holders by L Antineoplastic and Immunomodulating Agents");
  assert.equal(activity.sortByName, "Sort holders by name");
  assert.equal(activity.order.label, "Column order");
  assert.deepEqual(activity.order.key, { atc: "Code", area: "Name" });
  assert.equal(activity.order.count, "Count");
  assert.equal(activity.holderRow("Novartis Europharm Limited", 30), "Novartis Europharm Limited, 30 medicines");
  assert.equal(activity.holderRow("Accord Healthcare S.L.U.", 1), "Accord Healthcare S.L.U., 1 medicine");
  // Phase 4c review: a visible "Total" sort (the default), filter toggles that say what they do,
  // and the drilled-into class as a toggle of its own.
  assert.equal(activity.sortName, "Name");
  assert.equal(activity.sortTotal, "Total");
  assert.equal(activity.sortByTotal, "Sort holders by their total of matching medicines");
  assert.equal(activity.filterBy("Novartis Europharm Limited"), "Show only Novartis Europharm Limited");
  assert.equal(activity.pressedTitle, "Shown alone: click again to clear");
  assert.equal(activity.filterHint, "Filters the dashboard; select again to clear.");
  assert.equal(activity.parentLead, "Columns: classes in");
});

test("approvals per year: stack modes, the summary and the counting note per mode", () => {
  const { years } = labels.UI;
  assert.equal(years.stack.label, "Stack by");
  assert.deepEqual(years.stack.modes, { type: "Medicine type", atc: "ATC", mah: "Holder" });
  assert.equal(
    years.summary(1995, 2026, 1985, 2021, 95, years.by.type),
    "Stacked column chart of EMA approvals per year by medicine type, 1995 to 2026: 1,985 medicines in total, most in 2021 (95).",
  );
  assert.equal(years.by.atcIn("L04 Immunosuppressants"), "ATC class in L04 Immunosuppressants");
  assert.equal(years.by.atc, "ATC group");
  assert.equal(years.by.mah, "marketing authorization holder");
  const howTo = "Click a year to show only that year (again for all years), or drag across the chart to select several; the approval-years slider is the keyboard path.";
  assert.equal(years.note(years.counting.type), `Year of EU marketing authorization; each medicine counted once. ${howTo}`);
  assert.equal(years.note(years.counting.atc(6, false)), `Year of EU marketing authorization; a medicine with codes in several ATC classes is counted in each. ${howTo}`);
  // Phase 4c review: the top classes or holders and Other only when there is an Other segment.
  assert.equal(
    years.note(years.counting.atc(6, true)),
    `Year of EU marketing authorization; a medicine with codes in several ATC classes is counted in each: the 6 classes with the most matching medicines, the rest as Other classes. ${howTo}`,
  );
  assert.equal(
    years.note(years.counting.mah(8, true)),
    `Year of EU marketing authorization; each medicine counted once: the 8 holders with the most matching medicines, the rest as Other holders. ${howTo}`,
  );
  assert.equal(years.note(years.counting.mah(1, false)), `Year of EU marketing authorization; each medicine counted once. ${howTo}`);
  assert.deepEqual(years.other, { atc: "Other classes", mah: "Other holders" });
  assert.equal(years.onlyCoded(3, "L04AC"), "3 medicines coded only as L04AC are not shown.");
  assert.equal(years.onlyCoded(1, "L04AC"), "1 medicine coded only as L04AC is not shown.");
});

// Phase 4c review: the code shown can differ from EMA's (retired, completed from the product
// information, or EMA has none); a short flag beside the badge, the full sentence elsewhere.
test("ATC codes that differ from EMA's published one say how", () => {
  const names = new Map([["L01XC02", "rituximab"]]);
  const years = new Map([["L01XC02", 2022]]);
  const { atcOriginText, atcOriginFlag } = labels;
  assert.equal(atcOriginText(null, names, years), null);
  assert.equal(atcOriginText({ kind: "retired", from: "L01XC02", now: "L01FA01" }, names, years), "L01XC02 Rituximab: retired 2022, now L01FA01.");
  assert.equal(atcOriginText({ kind: "retired", from: "L01XE", now: "L01E" }, names, years), "L01XE: retired, now L01E.");
  assert.equal(atcOriginText({ kind: "completed", published: "L01XL" }, names, years), "EMA publishes L01XL; the full code is from the product information (SmPC).");
  assert.equal(atcOriginText({ kind: "conflict", published: "C09" }, names, years), "EMA publishes C09; this code is from the product information (SmPC).");
  assert.equal(atcOriginText({ kind: "smpc" }, names, years), "EMA publishes no ATC code; this one is from the product information (SmPC).");
  assert.equal(atcOriginFlag({ kind: "retired", from: "L01XC02", now: "L01FA01" }), "was L01XC02");
  assert.equal(atcOriginFlag({ kind: "completed", published: "L01XL" }), "EMA: L01XL");
  assert.equal(atcOriginFlag({ kind: "smpc" }), "SmPC");
  assert.equal(labels.UI.table.source("ema_smpc"), "Source: EMA product information (SmPC)");
});

// Phase 4c review: a medicine card names a namesake (the refused Mylotarg and the authorized one).
test("a medicine card points to a namesake and to the documents that are the namesake's", () => {
  const { namesake } = labels.UI.card;
  assert.equal(namesake.link("Mylotarg", "EMEA/H/C/004204"), "Another medicine named Mylotarg (EMEA/H/C/004204)");
  assert.equal(namesake.authorized("2018-04-19"), " is authorized since 19 Apr 2018.");
  assert.equal(namesake.other("Refused"), ": Refused.");
  assert.equal(namesake.other("Authorised"), ": Authorized.");
  assert.equal(namesake.documents(7), "7 later documents EMA lists here belong to ");
  assert.equal(namesake.documents(1), "1 later document EMA lists here belongs to ");
  assert.equal(namesake.documentsLink("Mylotarg"), "the other Mylotarg");
});

// Phase 4c review: "what for" on the first screen: the indication's first sentence, or its first
// 200 characters, with the rest behind a disclosure.
test("an indication's lead: the whole text when short, else its first sentence, else 200 characters", () => {
  const { indicationLead } = labels;
  assert.deepEqual(indicationLead("Mylotarg is indicated for AML."), { lead: "Mylotarg is indicated for AML.", more: false });
  const keytruda = "Melanoma Keytruda as monotherapy is indicated for the treatment of adults and adolescents aged 12 years and older with advanced (unresectable or metastatic) melanoma. Keytruda as monotherapy is indicated for the adjuvant treatment of adults.";
  assert.deepEqual(indicationLead(keytruda), {
    lead: "Melanoma Keytruda as monotherapy is indicated for the treatment of adults and adolescents aged 12 years and older with advanced (unresectable or metastatic) melanoma.",
    more: true,
  });
  // "e.g. dysglycaemia" does not end a sentence; a long first sentence is cut at a word.
  const long = `Adults Wegovy is indicated e.g. dysglycaemia ${"and weight management ".repeat(12)}in adults. Adolescents too.`;
  const { lead, more } = indicationLead(long);
  assert.equal(more, true);
  assert.ok(lead.length <= 201, lead);
  assert.ok(lead.endsWith("…"), lead);
  assert.ok(long.startsWith(lead.slice(0, -1)), lead);
  assert.ok(!lead.slice(0, -1).endsWith(" "), lead);
  assert.equal(labels.UI.card.fullIndication, "Show full indication");
});

// Phase 4c review: the tab's title names the view (WCAG 2.4.2); the dashboard under a lookup result
// has its own heading.
test("page titles name the view; the overview under a result is headed as such", () => {
  const { UI } = labels;
  assert.equal(UI.pageTitle("Wegovy"), "Wegovy · Approval Atlas");
  assert.equal(UI.pageTitle(null), "Approval Atlas");
  assert.equal(UI.textTitle("wegovy"), "“wegovy”");
  assert.equal(UI.explore.title, "Explore all EMA medicines");
  assert.equal(UI.explore.note, "The filters apply to this overview, not to the result above.");
});
