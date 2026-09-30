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
    "EMA and the EU Union Register (the legal record) show different statuses; either can lag behind a recent decision.",
  );
  // Under all the tiles: names the population it counts in (the medicines EMA lists as currently authorized).
  assert.equal(labels.UI.register.notAuthorized(24), "24 medicines that EMA lists as currently authorized are no longer authorized according to the EU Union Register.");
  assert.equal(labels.UI.register.notAuthorized(1), "1 medicine that EMA lists as currently authorized is no longer authorized according to the EU Union Register.");
});

// A footer or About line's links ({ text, url } parts; partsText() below gives the text shown).
const partsUrls = (parts) => parts.filter((part) => typeof part !== "string").map((part) => part.url);

// Legal review 2026-09-30 (.remember/legal/footer-review.md; not legal advice): what the site is,
// its scope, use with care, sources and licenses, privacy and contact.
test("the About disclosure states scope, intended use and privacy", () => {
  const { about } = labels.UI;
  assert.equal(
    about.what,
    "Approval Atlas is a free, non-commercial lookup of human medicines that went through the European Medicines Agency's central procedure, run as a personal project and rebuilt daily from public data.",
  );
  // Step 2 (#1, #16): central only; where an authorization is valid; availability is national.
  assert.equal(
    about.scope,
    "It covers the medicines EMA lists from its central procedure, whatever their status. Many older or common medicines are authorized country by country and are not here: check your national medicines agency. A central authorization is valid in the EU, Iceland, Liechtenstein and Norway, not the UK or Switzerland. Availability and reimbursement vary by country.",
  );
  // The intended purpose (no medical purpose, so not a medical device), no warranty, the estimates
  // never patents, the company groups not an official record.
  assert.deepEqual(about.use("2026-09-28"), [
    "For information only: not medical, legal or regulatory advice, and not meant for decisions about any patient's care, so it is not a medical device. Check the official product information and ask a health professional. Approval Atlas does not recommend any medicine.",
    "Data are processed automatically and partly checked by hand; they can lag EMA or contain errors. Provided as is, without warranty.",
    "Protection dates are rough estimates from EU central approval dates only: not patent or supplementary protection certificate data, and not legal advice.",
    "Company groups show the current owner as curated here (as of 28 Sep 2026), not an official record.",
  ]);
  assert.equal(about.use(null)[3], "Company groups show the current owner as curated here, not an official record.");
  // GitHub logs IP addresses (its own page says so: not "may"); every item this browser keeps, and how to clear them.
  assert.equal(
    about.privacy,
    "No cookies, analytics or tracking; searches run in your browser. The site is hosted on GitHub Pages (GitHub, Inc., USA), which logs visitors' IP addresses and, like any web server, the page addresses they request (including any search in a link), for security. This browser keeps, on this device only and never sent: your theme, whether you have seen or closed the intro, your recently viewed items (Clear removes them) and, for offline use, the site's files and data. Clearing this site's data in your browser removes them.",
  );
  // No personal name or email until the owner decides: the repository's issues.
  assert.equal(partsText(about.contact), "Questions and corrections: GitHub issues. Security reports: see the security policy.");
  assert.deepEqual(partsUrls(about.contact), [
    "https://github.com/vrognas/approval-atlas/issues",
    "https://github.com/vrognas/approval-atlas/blob/main/SECURITY.md",
  ]);
  assert.deepEqual(Object.values(about.heads), ["What this is.", "Scope.", "Use with care.", "Sources and licenses.", "Privacy.", "Contact."]);
});

// Every source's credit with the licence links CC BY 4.0 and CC BY-SA 3.0 require, ChEMBL's as
// prominent as the others (all in the visible first line); then the use and non-affiliation line,
// then the site's own licences and contact.
test("the footer's three lines: sources with their licences, use and non-affiliation, licences and contact", () => {
  const { footer } = labels.UI;
  const sources = footer.sources({ date: "2026-09-29", mesh: "MeSH 2026", chembl: "ChEMBL_37" });
  assert.equal(
    partsText(sources),
    "Sources: European Medicines Agency (EMA), © EMA, data as of 29 Sep 2026 · MeSH® courtesy of the U.S. National Library of Medicine (MeSH 2026) · ATC © WHO Collaborating Centre for Drug Statistics Methodology · Union Register © European Union, CC BY 4.0, modified · ChEMBL (ChEMBL_37), CC BY-SA 3.0.",
  );
  assert.deepEqual(partsUrls(sources), [
    "https://www.ema.europa.eu/en/medicines/download-medicine-data",
    "https://atcddd.fhi.no",
    "https://ec.europa.eu/health/documents/community-register/html/index_en.htm",
    "https://creativecommons.org/licenses/by/4.0/",
    "https://www.ebi.ac.uk/chembl",
    "https://creativecommons.org/licenses/by-sa/3.0/",
  ]);
  // Before meta.json has loaded: no date or versions.
  assert.equal(
    partsText(footer.sources()),
    "Sources: European Medicines Agency (EMA), © EMA · MeSH® courtesy of the U.S. National Library of Medicine · ATC © WHO Collaborating Centre for Drug Statistics Methodology · Union Register © European Union, CC BY 4.0, modified · ChEMBL, CC BY-SA 3.0.",
  );
  assert.equal(
    footer.use,
    "For information only: not medical, legal or regulatory advice. Not affiliated with or endorsed by EMA, the European Commission, WHO or its Collaborating Centre, NLM, EMBL-EBI or GLEIF.",
  );
  assert.equal(partsText(footer.licence), "Data CC BY-SA 4.0 (third-party values keep their own terms) · Code MIT · No cookies or tracking · Contact");
  assert.deepEqual(partsUrls(footer.licence), [
    "https://creativecommons.org/licenses/by-sa/4.0/",
    "https://github.com/vrognas/approval-atlas/blob/main/LICENSE",
    "https://github.com/vrognas/approval-atlas/issues",
  ]);
});

test("About's sources: each credit and licence, the ChEMBL citation, WHO's names shown in title case", () => {
  const { sources } = labels.UI.about;
  const lines = sources({ mesh: "MeSH 2026", chembl: "ChEMBL_37", explained: true, innStems: true }).map(partsText);
  assert.deepEqual(lines, [
    "Source: European Medicines Agency (EMA): medicines data, EPAR documents and orphan designations. © EMA. Filtered and reshaped.",
    "Union Register of medicinal products © European Union, CC BY 4.0, modified: matched to EMA records.",
    "MeSH® courtesy of the U.S. National Library of Medicine (MeSH 2026); definitions verbatim.",
    "ATC codes and names © WHO Collaborating Centre for Drug Statistics Methodology, Oslo: verbatim in the data, shown in title case; not for commercial distribution. The plain-language class explanations are Approval Atlas's own, not WHO's.",
    "ChEMBL data is from https://www.ebi.ac.uk/chembl (ChEMBL_37), CC BY-SA 3.0: molecule types, and ATC names mapped. Mendez D. et al., Nucleic Acids Res. 2019;47(D1):D930–D940, doi:10.1093/nar/gky1075.",
    "Modalities from WHO INN stems (World Health Organization, 2024), read as facts in our own words, ChEMBL molecule types and EMA data, some checked by hand.",
    "LEI data: Global Legal Entity Identifier Foundation (GLEIF), CC0. GLEIF does not provide or endorse this site.",
    "Fonts: Geist and Geist Mono © The Geist Project Authors, SIL Open Font License 1.1.",
    "Approval Atlas's data files are licensed CC BY-SA 4.0, ChEMBL-derived values adapted from CC BY-SA 3.0. Values from other sources, including WHO's ATC codes and names and quoted text, keep their own terms. Code: MIT.",
    "Medicine and company names are trademarks of their owners; their use here identifies them only.",
  ]);
  // Older data: no ATC class explanations or INN stems credited, so neither line claims them.
  const older = sources({}).map(partsText);
  assert.equal(older.length, 9);
  assert.equal(older[3], "ATC codes and names © WHO Collaborating Centre for Drug Statistics Methodology, Oslo: verbatim in the data, shown in title case; not for commercial distribution.");
  assert.ok(!older.some((line) => line.startsWith("Modalities")));
  // The WHO INN stems are read as facts: no non-commercial licence is claimed for the site's data.
  assert.ok(!lines.some((line) => /NC-SA/.test(line)));
});

test("dates display as day, abbreviated month and year; missing dates stay missing", () => {
  assert.equal(labels.formatDate("2018-02-08"), "8 Feb 2018");
  assert.equal(labels.formatDate("2026-09-26"), "26 Sep 2026");
  assert.equal(labels.formatDate("2009-01-16"), "16 Jan 2009");
  assert.equal(labels.formatDate("1995-12-31"), "31 Dec 1995");
  assert.equal(labels.formatDate(null), null);
  assert.equal(labels.formatDate(undefined), null);
});

test("the top bar shows the source and the data date in display form", () => {
  // F · Spacious, phase 1: the wordmark's second line names EMA's data (the page heading reads "EU
  // medicines"; the intro card and the About disclosure say it covers EMA's central procedure).
  assert.equal(labels.UI.dataDate("2026-09-26"), "EMA data as of 26 Sep 2026");
  assert.equal(labels.UI.dataDate(null), "EMA data");
  assert.equal(labels.UI.page.title, "EU medicines");
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

// Owner decision 2026-09-30: the medicines table's status dot names its status and dates.
test("the status dot's name: since the approval, or the status and its end", () => {
  assert.equal(labels.statusDotLine("Authorised", "2022-01-06", null), "Authorized since 6 Jan 2022");
  assert.equal(labels.statusDotLine("Authorised", null, null), "Authorized, no approval date");
  assert.equal(labels.statusDotLine("Withdrawn", "2006-06-19", "2009-01-16"), "Withdrawn 16 Jan 2009");
  assert.equal(labels.statusDotLine("Withdrawn", "2006-06-19", null), "Withdrawn");
  assert.equal(labels.statusDotLine("Withdrawn from rolling review", null, "2021-10-29"), "Withdrawn from rolling review 29 Oct 2021");
  assert.equal(labels.statusDotLine("Refused", null, null), "Refused");
  assert.equal(labels.statusDotLine("Opinion", null, null, "Negative"), "Opinion (negative)");
});

test("the status dot's tip adds the approval date of a status other than Authorized", () => {
  assert.equal(labels.statusDotTipLine("Authorised", "2022-01-06", null), "Authorized since 6 Jan 2022");
  assert.equal(labels.statusDotTipLine("Withdrawn", "2006-06-19", "2009-01-16"), "Withdrawn 16 Jan 2009 (approved 19 Jun 2006)");
  assert.equal(labels.statusDotTipLine("Withdrawn", "2006-06-19", null), "Withdrawn (approved 19 Jun 2006)");
  assert.equal(labels.statusDotTipLine("Refused", null, null), "Refused");
});

test("a medicine that is not authorized gets a status sentence built from EMA's dates only", () => {
  assert.equal(labels.statusSentence("Authorised", "2018-02-08", null), null);
  assert.equal(labels.statusSentence("Withdrawn", "2009-01-16", null), "Withdrawn on 16 Jan 2009.");
  assert.equal(labels.statusSentence("Withdrawn", null, null), "Withdrawn.");
  assert.equal(labels.statusSentence("Suspended", null, null), "Suspended.");
  assert.equal(labels.statusSentence("Refused", "2004-09-07", null), "Refused on 7 Sep 2004.");
  assert.equal(labels.statusSentence("Refused", null, null), "Refused.");
  assert.equal(labels.statusSentence("Application withdrawn", "2006-01-19", null), "Application withdrawn on 19 Jan 2006.");
  assert.equal(labels.statusSentence("Opinion", "2026-09-17", "Positive"), "Positive opinion on 17 Sep 2026: EMA recommended approval.");
  assert.equal(labels.statusSentence("Opinion", "2025-05-22", "Negative"), "Negative opinion on 22 May 2025: EMA recommended refusal.");
  assert.equal(labels.statusSentence("Opinion", null, null), "Opinion adopted; EU decision pending.");
  // Step 2 (#11): a negative opinion under re-examination says it was negative (the headline says "not").
  assert.equal(labels.statusSentence("Opinion under re-examination", "2026-06-25", "Negative"), "Negative opinion on 25 Jun 2026; under re-examination at the company's request.");
  assert.equal(labels.statusSentence("Opinion under re-examination", null, "Positive"), "Opinion under re-examination at the company's request.");
  assert.equal(labels.statusSentence("Opinion under re-examination", null, null), "Opinion under re-examination at the company's request.");
});

// Step 4 (#12): 21 positive opinions await the Commission's decision, which usually follows about
// 2 months later (meta.json opinion_to_decision: median 57 days, 90th percentile 69). decision:
// those figures; asOf: the data's date, from which the days waited so far are counted.
test("a positive opinion says how long the EU decision usually takes, when the data has the figure", () => {
  const { statusSentence } = labels;
  const decision = { median: 57, p90: 69 };
  const usually = "The EU decision usually comes about 57 days after the opinion.";
  // Zeydovio: 11 days since its opinion, within the usual time.
  assert.equal(statusSentence("Opinion", "2026-09-17", "Positive", { decision, asOf: "2026-09-28" }), `Positive opinion on 17 Sep 2026: EMA recommended approval. ${usually}`);
  // Pebrilzo: positive, no opinion date.
  assert.equal(statusSentence("Opinion", null, "Positive", { decision, asOf: "2026-09-28" }), `Positive opinion: EMA recommended approval. ${usually}`);
  // No figure (older meta.json): as before.
  assert.equal(statusSentence("Opinion", "2026-09-17", "Positive", { decision: null, asOf: "2026-09-28" }), "Positive opinion on 17 Sep 2026: EMA recommended approval.");
  // A negative opinion, an unknown one, a re-examination: no expectation.
  assert.equal(statusSentence("Opinion", "2025-05-22", "Negative", { decision, asOf: "2026-09-28" }), "Negative opinion on 22 May 2025: EMA recommended refusal.");
  assert.equal(statusSentence("Opinion", null, null, { decision, asOf: "2026-09-28" }), "Opinion adopted; EU decision pending.");
  assert.equal(statusSentence("Opinion under re-examination", null, "Positive", { decision, asOf: "2026-09-28" }), "Opinion under re-examination at the company's request.");
});

// Review of step 4: 9 of the 21 are past the median, Nylaspeg and Onswik (95 days) past the 90th
// percentile; "usually comes about 57 days after" alone read as "any day now" or as stale data.
test("a positive opinion past the usual time says how long it has waited", () => {
  const { statusSentence } = labels;
  const decision = { median: 57, p90: 69 };
  const usually = "The EU decision usually comes about 57 days after the opinion.";
  // Lynavoy: 67 days, past the median.
  assert.equal(statusSentence("Opinion", "2026-07-23", "Positive", { decision, asOf: "2026-09-28" }), `Positive opinion on 23 Jul 2026: EMA recommended approval. ${usually} This one has waited 67 days so far.`);
  // Nylaspeg: 95 days, past 9 in 10.
  assert.equal(
    statusSentence("Opinion", "2026-06-25", "Positive", { decision, asOf: "2026-09-28" }),
    `Positive opinion on 25 Jun 2026: EMA recommended approval. ${usually} This one has waited 95 days so far; 9 in 10 decisions of the last 5 years came sooner.`,
  );
  // At the median: not past it.
  assert.equal(statusSentence("Opinion", "2026-08-02", "Positive", { decision, asOf: "2026-09-28" }), `Positive opinion on 2 Aug 2026: EMA recommended approval. ${usually}`);
  // No 90th percentile, or no data date: the median alone, and only what can be counted.
  assert.equal(statusSentence("Opinion", "2026-06-25", "Positive", { decision: { median: 57, p90: null }, asOf: "2026-09-28" }), `Positive opinion on 25 Jun 2026: EMA recommended approval. ${usually} This one has waited 95 days so far.`);
  assert.equal(statusSentence("Opinion", "2026-06-25", "Positive", { decision, asOf: null }), `Positive opinion on 25 Jun 2026: EMA recommended approval. ${usually}`);
});

// Step 4 (#9) put a conditional authorization or exceptional circumstances in the sentence too;
// owner decision 2026-09-30: the chips beside the status say it once (their tooltips explain it), so
// an authorized medicine has no status sentence, whatever its flags.
test("an authorized medicine has no status sentence; its qualifiers are chips", () => {
  const { statusSentence } = labels;
  assert.equal(statusSentence("Authorised", "2020-12-14", null), null);
  assert.equal(statusSentence("Authorised", "2006-01-08", null, { decision: { median: 57, p90: 69 }, asOf: "2026-09-28" }), null);
  assert.equal(labels.UI.card.qualifiers, undefined);
  for (const flag of ["conditional_approval", "exceptional_circumstances"]) assert.ok(labels.UI.flagTips[flag], flag);
  assert.equal(statusSentence("Withdrawn", "2023-01-01", null), "Withdrawn on 1 Jan 2023.");
});

// Step 4 (#9): the flags' explanations (the chips beside the status, the result tables' markers,
// the card's other flags), on hover and tap as the type and status tips.
test("each approval flag has an explanation of at most 12 words", () => {
  const { flagTips, flagMarkers, card } = labels.UI;
  assert.deepEqual(flagTips, {
    conditional_approval: "Approved on less complete data for an unmet need; renewed yearly.",
    exceptional_circumstances: "Full data cannot be collected, e.g. very rare disease; reviewed yearly.",
    additional_monitoring: "Black triangle ▼: monitored more closely; report any suspected side effects.",
    prime_priority_medicine: "EMA's priority medicines scheme: early support for an unmet need.",
    accelerated_assessment: "Assessed in 150 days instead of the usual 210.",
  });
  for (const tip of Object.values(flagTips)) assert.ok(tip.split(" ").length <= 12, tip);
  // Every flag chip but Orphan (a type badge) has one.
  assert.deepEqual(Object.keys(card.flags).filter((flag) => !flagTips[flag]), ["orphan_medicine"]);
  // The result tables' compact markers: visible text, and the full name read instead. Review of
  // step 4: each shows a word, as the tip needs a mouse or a tap (a bare "▼" meant nothing to a
  // keyboard user or a lay reader).
  assert.deepEqual(flagMarkers, {
    conditional_approval: { text: "Conditional", name: "Conditional approval" },
    exceptional_circumstances: { text: "Exceptional", name: "Exceptional circumstances" },
    additional_monitoring: { text: "▼ Additional monitoring", name: "Additional monitoring" },
  });
  for (const { text } of Object.values(flagMarkers)) assert.match(text, /[A-Za-z]{4,}/);
  assert.equal(card.blackTriangle, "▼");
});

// Step 2 (#11): a negative opinion is not "pending" in the search's meta line or the answer strip.
test("a negative opinion is labeled as such; other statuses keep their label", () => {
  assert.equal(labels.statusOpinionLabel("Opinion", "Negative"), "Opinion (negative)");
  assert.equal(labels.statusOpinionLabel("Opinion", "Positive"), "Opinion");
  assert.equal(labels.statusOpinionLabel("Opinion", null), "Opinion");
  assert.equal(labels.statusOpinionLabel("Authorised", null), "Authorized");
  // An opinion has no approval year.
  assert.equal(labels.UI.lookup.medicineMeta("Opinion", undefined, "Negative"), "Opinion (negative)");
  assert.equal(labels.UI.lookup.medicineMeta("Opinion", undefined, null), "Opinion");
  assert.equal(labels.UI.lookup.medicineMeta("Authorised", "2018"), "Authorized · 2018");
});

test("the medicines table: a status dot column first, then a narrow Approved column", () => {
  assert.deepEqual(labels.UI.table.headers, [
    "Status",
    "Medicine",
    "Company · Holder",
    "Approved",
    "Type",
    "ATC",
    "Therapeutic area",
    "Indication",
  ]);
});

// Owner decision 2026-09-29 (layout): the headline states every medicine and those currently
// authorized, so only the four type tiles stay (under "Authorized over time").
test("tiles: the four types with their share", () => {
  assert.deepEqual(labels.UI.tiles.map((tile) => [tile.key, tile.label]), [
    ["orphan", "Orphan"],
    ["biosimilar", "Biosimilar"],
    ["generic", "Generic"],
    ["advancedTherapy", "Advanced therapy"],
  ]);
  for (const tile of labels.UI.tiles) assert.equal(tile.captionFiltered, undefined, tile.key);
  // Copy review 2026-09-29 (adapted): one caption for the four shares, by the medicines shown.
  assert.deepEqual(["authorized", "all", "filtered"].map(labels.UI.tileShare), ["Share of the authorized medicines", "Share of all medicines", "Share of the matching medicines"]);
  // Owner decision 2026-09-29 ("Authorized by default"): the default headline counts them (status
  // Authorised), "Authorized over time" and the currently authorized count leave them out.
  assert.equal(labels.UI.undatedAuthorized(6), "6 authorized medicines without an approval date are left out of “Authorized over time” and of the currently authorized count.");
  assert.equal(labels.UI.undatedAuthorized(1), "1 authorized medicine without an approval date is left out of “Authorized over time” and of the currently authorized count.");
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
  // Owner decision 2026-09-29: with every status included (?status=all), the headline says so.
  assert.equal(plain(headline.home(2351, 1567)), "2,351 medicines in the EMA data, 1,567 of them currently authorized.");
  assert.deepEqual(toned(headline.home(2351, 1567)), [["2,351", "number"], ["1,567", "number"]]);
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

// Owner decision 2026-09-29 ("Authorized by default"): the overview shows the authorized medicines
// unless the viewer widens the Status filter; the headline says what is shown.
test("the default headline counts the authorized medicines, with or without other filters", () => {
  const { authorized } = labels.UI.headline;
  assert.equal(plain(authorized.home(1573)), "1,573 medicines are authorized EU-wide through EMA.");
  assert.deepEqual(toned(authorized.home(1573)), [["1,573", "number"]]);
  assert.equal(plain(authorized.home(1)), "1 medicine is authorized EU-wide through EMA.");
  assert.equal(plain(authorized.filtered(385)), "385 authorized medicines match these filters.");
  assert.deepEqual(toned(authorized.filtered(385)), [["385", "number"]]);
  assert.equal(plain(authorized.filtered(1)), "1 authorized medicine matches these filters.");
  assert.equal(plain(authorized.filtered(0)), "No authorized medicines match these filters.");
  assert.equal(plain(authorized.atcClass(12, "L04AC Interleukin Inhibitors")), "12 authorized medicines in L04AC Interleukin Inhibitors.");
  assert.equal(plain(authorized.atcClass(1, "L04AC Interleukin Inhibitors")), "1 authorized medicine in L04AC Interleukin Inhibitors.");
  assert.equal(plain(authorized.atcClass(0, "B06C")), "No authorized medicines are classed B06C.");
  assert.equal(plain(authorized.area(386, "Neoplasms")), "386 authorized medicines in Neoplasms.");
  assert.equal(plain(authorized.area(17, "Cancer", true)), "17 authorized medicines tagged Cancer.");
  assert.equal(plain(authorized.area(0, "Psoriasis")), "No authorized medicines are in Psoriasis.");
});

// One quiet line under the default headline (no breakdown by every status): what the default leaves
// out, with a control to include them.
test("the default dek says how many medicines of other statuses are left out", () => {
  const { statusScope } = labels.UI;
  assert.equal(statusScope.more(778, false), "EMA's list also has 778 medicines that are not authorized: withdrawn, refused, expired or awaiting a decision.");
  assert.equal(statusScope.more(1, false), "EMA's list also has 1 medicine that is not authorized: withdrawn, refused, expired or awaiting a decision.");
  assert.equal(statusScope.more(40, true), "40 more medicines matching these filters are not authorized: withdrawn, refused, expired or awaiting a decision.");
  assert.equal(statusScope.more(1, true), "1 more medicine matching these filters is not authorized: withdrawn, refused, expired or awaiting a decision.");
  assert.equal(statusScope.include, "Include them");
  // The visible text first (WCAG 2.5.3).
  assert.ok(statusScope.includeLabel.startsWith(statusScope.include));
  // The Status section: widen to every status, or back to the default.
  assert.equal(labels.UI.facets.statusWiden, "Include withdrawn, refused and pending");
  assert.equal(labels.UI.facets.statusDefault, "Authorized only");
  assert.equal(labels.UI.facets.everyStatus, "Every status");
  assert.equal(labels.UI.sentence.statusDefault, "authorized status");
  assert.equal(labels.UI.sentence.defaults.status, "every status");
});

// "Authorized over time" is authorization history: the status filter does not apply (owner decision
// 2026-09-29); its note says so.
test("the over-time subtitle says the status filter does not apply", () => {
  assert.equal(labels.UI.overTime.subtitle, "Authorized medicines and their active substances or combinations at each month end, those withdrawn since included. All filters apply except the status and the approval years, which are shaded.");
});

test("the dek starts with the medicines by status: the top four, then how many more", () => {
  const { statuses } = labels.UI.headline;
  const all = [
    ["Authorised", 1573], ["Withdrawn", 363], ["Application withdrawn", 268], ["Refused", 64], ["Lapsed", 27], ["Opinion", 25],
    ["Expired", 17], ["Revoked", 9], ["Opinion under re-examination", 2], ["Withdrawn from rolling review", 2], ["Suspended", 1],
  ].map(([status, count]) => ({ status, count }));
  assert.equal(statuses(all), "By status: 1,573 authorized, 363 withdrawn, 268 applications withdrawn, 64 refused and 83 with other statuses.");
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
    "By status: 1,573 authorized (6 without an approval date, not counted above), 363 withdrawn, 268 applications withdrawn, 64 refused and 83 with other statuses.",
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
    "They contain 1,012 different active substances or combinations. 163 are orphan medicines, 246 are generics, 150 are biosimilars and 23 are advanced therapies.",
  );
  assert.equal(
    dek({ products: 1, substances: 1, orphan: 1, generic: 0, biosimilar: 0, advancedTherapy: 0 }),
    "It contains 1 active substance or combination. 1 is an orphan medicine.",
  );
  assert.equal(
    dek({ products: 3, substances: 2, orphan: 0, generic: 1, biosimilar: 1, advancedTherapy: 1 }),
    "They contain 2 different active substances or combinations. 1 is a generic, 1 is a biosimilar and 1 is an advanced therapy.",
  );
  assert.equal(dek({ products: 2, substances: 2, orphan: 0, generic: 0, biosimilar: 0, advancedTherapy: 0 }), "They contain 2 different active substances or combinations.");
  assert.equal(dek({ products: 0, substances: 0, orphan: 0, generic: 0, biosimilar: 0, advancedTherapy: 0 }), null);
});

test("lookup headlines answer whether it is authorized; 'not' and counts are toned", () => {
  const { headline } = labels.UI;
  assert.equal(plain(headline.medicine("Wegovy", "authorized")), "Wegovy is authorized in the EU.");
  // F · Spacious, phase 4 (Von Restorff): the answer word is toned as the status is, "not" and "not yet" too.
  assert.deepEqual(toned(headline.medicine("Wegovy", "authorized")), [["authorized", "authorized"]]);
  assert.equal(plain(headline.medicine("Acomplia", "ended")), "Acomplia is not authorized in the EU.");
  assert.deepEqual(toned(headline.medicine("Acomplia", "ended")), [["not", "negative"]]);
  assert.deepEqual(toned(headline.medicine("Grasustek", "refused")), [["not", "negative"]]);
  // Opinion adopted, no decision yet: "not yet", in the pending tone.
  assert.equal(plain(headline.medicine("Vyloy", "pending")), "Vyloy is not yet authorized in the EU.");
  assert.deepEqual(toned(headline.medicine("Vyloy", "pending")), [["not yet", "pending"]]);
  assert.deepEqual(toned(headline.medicine("Vyloy", "pending", "Positive")), [["not yet", "pending"]]);
  // Step 2 (#11): a negative opinion (Kinselby; Yartemlea under re-examination) is "not", in the negative tone.
  assert.equal(plain(headline.medicine("Kinselby", "pending", "Negative")), "Kinselby is not authorized in the EU.");
  assert.deepEqual(toned(headline.medicine("Kinselby", "pending", "Negative")), [["not", "negative"]]);
  // Step 2 (#1): a substance's answer names EMA (national authorizations are not in the data).
  assert.equal(plain(headline.substance("semaglutide", 5)), "Semaglutide is in 5 medicines authorized EU-wide through EMA.");
  assert.deepEqual(toned(headline.substance("semaglutide", 5)), [["5", "number"]]);
  assert.equal(
    plain(headline.substance("celecoxib", 0)),
    "Celecoxib: no medicine is currently authorized through EMA (national authorizations are not included).",
  );
  // The qualifier closes the headline in smaller type (tone "aside"), so the answer stays short on a phone.
  assert.deepEqual(toned(headline.substance("celecoxib", 0)), [["no medicine", "negative"], ["(national authorizations are not included).", "aside"]]);
  assert.equal(plain(headline.substance("insulin human", 1)), "Insulin human is in 1 medicine authorized EU-wide through EMA.");
  // Phase 4c review: EMA's therapeutic-area tags, not indications; narrower terms count too.
  assert.equal(plain(headline.condition("Psoriasis", 52, true)), "52 authorized medicines are tagged by EMA with Psoriasis or a narrower condition.");
  assert.equal(plain(headline.condition("Psoriasis", 1, false)), "1 authorized medicine is tagged by EMA with Psoriasis.");
  // The name is a part of its own, for its MeSH explainer (owner request 2026-09-28).
  assert.deepEqual(toned(headline.condition("Psoriasis", 52, true)), [["52", "number"], ["Psoriasis", "term"]]);
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

// Phase 4f: medicines found only through the indication text are marked and counted apart.
test("a condition page marks the medicines only mentioned in the indication, and counts both", () => {
  const { condition } = labels.UI;
  assert.equal(condition.rowMentions("neuropathic pain"), "Indication mentions “neuropathic pain”");
  assert.equal(condition.counts(5, 1, false), "Authorized: 5 medicines tagged by EMA and 1 more mentioned in the indication text.");
  assert.equal(condition.counts(1, 12, true), "Every status: 1 medicine tagged by EMA and 12 more mentioned in the indication text.");
  assert.equal(condition.counts(0, 3, false), "Authorized: 0 medicines tagged by EMA and 3 mentioned in the indication text.");
  // The indication texts still loading.
  assert.equal(condition.counts(5, null, false), "Authorized: 5 medicines tagged by EMA.");
  // Step 4 (#10): the tagged medicines' distinct substance sets (Arthritis, Rheumatoid: 47, 16).
  // Review of step 4: a combination counts on its own (HIV Infections: 40 sets of 27 substances),
  // so the copy names combinations.
  assert.equal(condition.counts(47, 5, false, 16), "Authorized: 47 medicines tagged by EMA (16 active substances or combinations) and 5 more mentioned in the indication text.");
  assert.equal(condition.counts(15, null, true, 1), "Every status: 15 medicines tagged by EMA (1 active substance or combination).");
  assert.equal(condition.counts(0, 3, false, 0), "Authorized: 0 medicines tagged by EMA and 3 mentioned in the indication text.");
});

// Phase 4f: one therapeutic area tree (MeSH branch › level 2 › level 3 › EMA's terms).
test("the therapeutic area tree: search, rows, included areas, the static row and the path", () => {
  const { areas } = labels.UI;
  assert.equal(areas.find, "Find a therapeutic area");
  assert.equal(areas.tree, "Therapeutic areas");
  assert.equal(areas.expand("Neoplasms"), "Areas in Neoplasms");
  assert.equal(areas.count("Breast Neoplasms", 55), "Breast Neoplasms, 55 medicines");
  assert.equal(areas.count("Psoriasis", 1), "Psoriasis, 1 medicine");
  assert.equal(areas.included("Psoriasis", 43, "Skin Diseases"), "Psoriasis, 43 medicines, included in Skin Diseases");
  assert.equal(areas.noMatches, "No matching therapeutic areas");
  assert.equal(areas.notMoreSpecific, "tagged at this level");
  // Phase 4g: a branch's tags matched at its root, one static row.
  assert.equal(areas.taggedOnly(["Neoplasms", "Cancer"]), "Tagged only as Neoplasms or Cancer");
  assert.equal(areas.taggedOnly(["Diagnosis"]), "Tagged only as Diagnosis");
  assert.equal(areas.taggedOnly(["A", "B", "C"]), "Tagged only as A, B or C");
  assert.equal(areas.classPath, "Levels of this therapeutic area");
  // Phase 4g review: a root tag selected on its own reads as a tag, never as its branch, and the
  // tree names it under the search (the branch row is only indeterminate).
  assert.equal(areas.tag("Neoplasms"), "tagged Neoplasms");
  assert.equal(areas.tagNote(["Cancer"]), "Also filtering by the tag “Cancer”.");
  assert.equal(areas.tagNote(["Neoplasms", "Cancer"]), "Also filtering by the tags “Neoplasms” or “Cancer”.");
  assert.equal(areas.all, "All therapeutic areas");
  // Owner decision 2026-09-29: the tree is grouped by MeSH category, NLM's names verbatim (MeSH Tree
  // Structures), every category letter MeSH has.
  assert.deepEqual(Object.keys(areas.categories), [..."ABCDEFGHIJKLMNVZ"]);
  assert.equal(areas.categories.C, "Diseases");
  assert.equal(areas.categories.E, "Analytical, Diagnostic and Therapeutic Techniques, and Equipment");
  assert.equal(areas.categories.I, "Anthropology, Education, Sociology, and Social Phenomena");
  assert.match(areas.note, /^MeSH categories/);
  // Owner decision 2026-09-29: branch chips after each condition (tables, medicine card), filter
  // toggles in one toolbar per condition; "+n" names the branches behind it.
  assert.equal(areas.chips("Adrenoleukodystrophy"), "MeSH branches of Adrenoleukodystrophy");
  assert.equal(areas.chipFilter("C10", "Nervous System Diseases"), "Filter by therapeutic area C10 Nervous System Diseases");
  assert.equal(areas.chipsMore(2), "+2");
  assert.equal(
    areas.chipsRest([{ code: "C18", name: "Nutritional and Metabolic Diseases" }, { code: "C19", name: "Endocrine System Diseases" }]),
    "Also in C18 Nutritional and Metabolic Diseases; C19 Endocrine System Diseases",
  );
  // Review 2026-09-29: a chip included through a selected category (checked and disabled, as the
  // tree's row): its description and tooltip say so.
  assert.equal(areas.chipIncluded("Diseases"), "included in Diseases");
  assert.equal(areas.chipIncludedTip("Nervous System Diseases", "Diseases"), "Nervous System Diseases, included in Diseases");
  assert.equal(labels.UI.breakdown.area.titleIn("Neoplasms"), "Medicines in Neoplasms by therapeutic area");
  assert.equal(labels.UI.breakdown.area.titleLeaf("Psoriasis"), "Medicines in Psoriasis");
  assert.equal(labels.UI.breakdown.area.titleLeaf("Neoplasms", true), "Medicines tagged Neoplasms");
  assert.equal(labels.UI.activity.parentLeadArea, "Columns: areas in");
  assert.equal(labels.UI.activity.otherTitle, "Other therapeutic areas");
  assert.equal(
    labels.UI.conditions.subtitle(33, true, true),
    "Conditions of the 33 medicines matching the filters, within the selected areas, each with its narrower ones; treatments are the active substances or combinations of the authorized ones. Broad categories such as Neoplasms are in the therapeutic area filter.",
  );
});

// Phase 4e: curated codes say where they were checked; the card links the evidence.
test("a curated ATC code says where it was checked", () => {
  const { atcOriginText, atcOriginFlag } = labels;
  const none = new Map();
  const curated = (published, conflict, evidence) => ({ kind: "curated", published, conflict, evidence, url: null });
  assert.equal(atcOriginText(curated("N02AC", false, "whocc_index"), none, none), "EMA publishes N02AC; the full code was added from the WHO ATC index.");
  assert.equal(atcOriginText(curated("N07", true, "whocc_index"), none, none), "EMA publishes N07; this code was added from the WHO ATC index.");
  assert.equal(
    atcOriginText(curated("C10AX", false, "whocc_temporary"), none, none),
    "EMA publishes C10AX; the full code was added from WHO's temporary list (it can still change).",
  );
  assert.equal(atcOriginText(curated(null, false, "ema_smpc_text"), none, none), "EMA publishes no ATC code; this one was added from the SmPC text.");
  assert.equal(atcOriginText(curated("B03", false, null), none, none), "EMA publishes B03; the full code was added from a source checked by hand.");
  assert.equal(atcOriginFlag(curated("N02AC", false, "whocc_index")), "EMA: N02AC");
  assert.equal(atcOriginFlag(curated(null, false, "whocc_temporary")), "WHO temporary");
  assert.equal(labels.UI.atc.evidenceLink.whocc_index, "WHO ATC index page");
  assert.equal(labels.UI.table.source("curated"), "Source: checked by hand (WHO ATC index, WHO temporary list or SmPC text)");
  assert.equal(labels.UI.external.destinations["atcddd.fhi.no"], "WHOCC website");
});

test("an ATC class without a WHO name reads as its code alone", () => {
  assert.equal(labels.atcClassLabel("L04AL", null), "L04AL");
  assert.equal(labels.atcClassLabel("L04AL", undefined), "L04AL");
});

test("next to a code badge the name stands alone in title case, a missing name says so", () => {
  assert.equal(labels.atcName(ATC_LEVEL_ONE.L[0]), "Antineoplastic and Immunomodulating Agents");
  assert.equal(labels.atcName("Interleukin inhibitors"), "Interleukin Inhibitors");
  assert.equal(labels.atcName(null), "no WHO name");
});

test("ATC segment buttons name the level and class they filter by", () => {
  const { filterBy } = labels.UI.atc;
  assert.equal(filterBy(2, "L04", "IMMUNOSUPPRESSANTS"), "Filter by ATC level 2: L04 Immunosuppressants");
  assert.equal(filterBy(1, "L", ATC_LEVEL_ONE.L[0]), "Filter by ATC level 1: L Antineoplastic and Immunomodulating Agents");
  assert.equal(filterBy(4, "L04AL", null), "Filter by ATC level 4: L04AL no WHO name");
  // The badge's segments are one toolbar.
  assert.equal(labels.UI.atc.toolbar("L04AC05"), "ATC L04AC05");
});

// Accessible names: the badge, name and count spans would otherwise read glued together.
test("tree, path and bar controls name the class and its count of medicines", () => {
  const { classCount } = labels.UI.atc;
  assert.equal(classCount("L04AC05", "ustekinumab", 12), "L04AC05 Ustekinumab, 12 medicines");
  assert.equal(classCount("L", ATC_LEVEL_ONE.L[0], 1481), "L Antineoplastic and Immunomodulating Agents, 1,481 medicines");
  assert.equal(classCount("L04AL", null, 1), "L04AL no WHO name, 1 medicine");
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
  // Step 3 (#7): Wegovy, Rybelsus and Kyinsu are "Other" but not new active substances.
  assert.equal(typeTips.Other, "Not a generic, biosimilar or advanced therapy.");
  assert.equal(typeTips.Orphan, "For rare diseases (at most 5 in 10,000 people in the EU).");
  assert.equal(typeTips.Biosimilar, "Highly similar to a biological medicine already approved in the EU.");
  assert.equal(typeTips.Generic, "Same active substance as an already approved reference medicine.");
  assert.equal(typeTips["Advanced therapy"], "Gene therapy, cell therapy or tissue-engineered medicine.");
  for (const tip of Object.values(typeTips)) assert.ok(tip.split(" ").length <= 12, tip);
  // QA 2026-09-29 (#9): the card's explanation where a curated copy type contradicts EMA's type.
  const { typeDiffers } = labels.UI.copies;
  assert.equal(typeDiffers("hybrid", "Tecfidera"), "As EMA's data lists it; its EPAR page calls it a hybrid of Tecfidera.");
  assert.equal(typeDiffers("biosimilar", "Herceptin"), "As EMA's data lists it; its EPAR page calls it a biosimilar of Herceptin.");
  assert.equal(typeDiffers("generic", null), "As EMA's data lists it; its EPAR page calls it a generic.");
});

// Phase 4f: hover, focus and tap explanations of the EMA statuses, keyed by the raw status.
const searchIndexFile = new URL("../public/data/ema_search_index.json", import.meta.url);
test("each EMA status has an explanation of at most 10 words", () => {
  const { statusTips } = labels.UI;
  assert.deepEqual(statusTips, {
    // Step 2 (#16): authorized is not available or reimbursed everywhere.
    Authorised: "Can be sold EU-wide; availability and reimbursement vary by country.",
    Opinion: "EMA has given its opinion; EU decision pending.",
    "Opinion under re-examination": "EMA is re-examining its opinion at the company's request.",
    Refused: "The EU refused authorization.",
    "Application withdrawn": "The company withdrew its application before a decision.",
    "Withdrawn from rolling review": "The company stopped the early (rolling) review.",
    Withdrawn: "Authorization withdrawn, usually at the company's request.",
    Expired: "Authorization ended: not renewed.",
    Lapsed: "Authorization ended: not marketed for 3 years.",
    Suspended: "Authorization temporarily suspended.",
    // U.S. spelling (the user's wording had "cancelled").
    Revoked: "Authorization canceled by the EU.",
  });
  for (const tip of Object.values(statusTips)) {
    assert.ok(tip.split(" ").length <= 10, tip);
    assert.ok(!tip.includes("—"), tip);
  }
});

// User decision 2026-09-28: a negative opinion (Kinselby) is not "EU decision pending" in the usual
// sense; its dots and pills (answer strip, result tables, medicines table) say it was negative.
test("a negative opinion has its own explanation; a positive one keeps the Opinion tip", () => {
  const { UI, statusTipText } = labels;
  assert.equal(UI.negativeOpinionTip, "EMA recommended refusal; no EU decision published yet.");
  assert.ok(UI.negativeOpinionTip.split(" ").length <= 10);
  assert.ok(!UI.negativeOpinionTip.includes("—"));
  assert.equal(statusTipText("Opinion", "Negative"), UI.negativeOpinionTip);
  assert.equal(statusTipText("Opinion", "Positive"), UI.statusTips.Opinion);
  // EMA's opinions not loaded yet: the Opinion tip.
  assert.equal(statusTipText("Opinion", null), UI.statusTips.Opinion);
  assert.equal(statusTipText("Opinion"), UI.statusTips.Opinion);
  // Other statuses keep theirs, whatever the opinion was.
  assert.equal(statusTipText("Opinion under re-examination", "Negative"), UI.statusTips["Opinion under re-examination"]);
  assert.equal(statusTipText("Refused", "Negative"), UI.statusTips.Refused);
  assert.equal(statusTipText("Authorised", "Positive"), UI.statusTips.Authorised);
  assert.equal(statusTipText("Something new", "Negative"), null);
});

test(
  "every status in the data has an explanation",
  { skip: existsSync(searchIndexFile) ? false : "site/public/data/ema_search_index.json not found" },
  () => {
    const statuses = new Set(JSON.parse(readFileSync(searchIndexFile, "utf8")).map((row) => row.medicine_status));
    assert.ok(statuses.size >= 5);
    assert.deepEqual([...statuses].filter((status) => !labels.UI.statusTips[status]), []);
  },
);

// Phase 4f: every sort control reverses on a second click; its name says the order in force.
test("sort controls name the order in force: most or fewest first, A to Z or Z to A", () => {
  const { sortOrder } = labels.UI;
  assert.equal(sortOrder.name("Count", "count", "desc"), "Count, most first");
  assert.equal(sortOrder.name("Count", "count", "asc"), "Count, fewest first");
  assert.equal(sortOrder.name("Name", "key", "asc"), "Name, A to Z");
  assert.equal(sortOrder.name("Code", "key", "desc"), "Code, Z to A");
  // Not in force: the text alone.
  assert.equal(sortOrder.name("Count", "count", null), "Count");
});

// Visible text first in the accessible name, so speech input can use it (WCAG 2.5.3).
test("quick document links: PI and EPAR, named with the medicine", () => {
  const { documentLinks } = labels.UI;
  assert.equal(documentLinks.productInformation.text, "PI");
  assert.equal(documentLinks.productInformation.label("Wegovy"), "PI, product information PDF for Wegovy");
  assert.equal(documentLinks.epar.text, "EPAR");
  assert.equal(documentLinks.epar.label("Wegovy"), "EPAR, European public assessment report PDF for Wegovy");
});

// Step 4 (#15): the medicine card's buttons say what the product information holds and add EMA's
// plain-language overview; the documents list keeps its names.
test("the medicine card's document buttons", () => {
  const { card, documents } = labels.UI;
  assert.deepEqual(card.buttons, {
    productInformation: "Product information (SmPC and package leaflet)",
    epar: "Public assessment report (EPAR)",
    overview: "Plain-language overview",
  });
  assert.equal(documents.productInformation, "Product information (SmPC)");
  assert.equal(documents.overview, "Plain-language overview");
});

// F · Spacious, phase 4 (Miller's Law / chunking): the medicine card in three blocks, the rest behind
// one "More details" at the end. Estimates only, never "patent".
test("the medicine card's blocks and More details", () => {
  const { card } = labels.UI;
  assert.deepEqual(card.blocks, { status: "Status", protection: "Protection and copies", documents: "Documents", indication: "Indication" });
  // The indication shows after the Documents block, so More details does not name it again.
  assert.doesNotMatch(card.more.hint(true), /indication/i);
  // Review of phase 4: a short hint (the summary's name), "documents" only where More details has them.
  assert.equal(card.more.hint(true), "All therapeutic areas, substances, type, modality, ATC, protection estimate, documents");
  assert.equal(card.more.hint(false), "All therapeutic areas, substances, type, modality, ATC, protection estimate");
  assert.ok(card.more.hint(true).split(/\s+/).length <= 12);
  assert.equal(card.more.summary, "More details");
  assert.equal(card.more.about, "About this medicine");
  assert.equal(card.more.allDocuments, "All documents");
  assert.equal(card.estimate, "(est.)");
  assert.equal(card.since, "since");
  assert.equal(card.approvedOn, "approved");
  // A substance's "2 authorized first approved 20 Nov 2006": the first of them, not all.
  assert.equal(card.firstApproved, "first approved");
  // An authorized medicine without an approval date: no "since", this instead.
  assert.equal(card.noDate, "no approval date");
  for (const text of [...Object.values(card.blocks), card.more.summary, card.more.hint(true), card.more.about, card.more.allDocuments]) {
    assert.doesNotMatch(text, /patent|—/i);
  }
});

test("filter chips, popover and sheet copy", () => {
  const { sentence, filters, facets, sheet } = labels.UI;
  // F · Spacious, phase 1: one chip per dimension, named as the sidebar's sections were.
  assert.deepEqual(filters.names, {
    type: "Medicine type", mod: "Modality", atc: "ATC class", area: "Therapeutic area", mah: "Company", status: "Status", years: "Approval year",
  });
  assert.deepEqual(Object.keys(filters.dimensions), Object.keys(filters.names));
  assert.equal(filters.label, "Filters");
  assert.equal(filters.remove("type", "Biosimilar"), "Remove medicine type filter: Biosimilar");
  assert.equal(filters.remove("years", "2015–2026"), "Remove approval year filter: 2015–2026");
  assert.equal(filters.remove("atc", "2 selected"), "Remove ATC class filter: 2 selected");
  assert.equal(filters.popoverTitle("atc"), "Filter by ATC class");
  assert.equal(filters.popoverTitle("years"), "Filter by approval year");
  assert.equal(filters.active(1), "active filter");
  assert.equal(filters.active(2), "active filters");
  assert.equal(filters.clear, "Clear filters");
  assert.equal(filters.popoverClear, "Clear");
  assert.equal(filters.done, "Done");
  // The filter tokens the chips read (facets.js sentenceParts()).
  assert.equal(sentence.words.approvedIn, ", approved in ");
  // Phase 4f: one therapeutic area tree, no separate group filter.
  assert.equal(sentence.defaults.branch, undefined);
  // The sentence's own controls, the sidebar's count and its splitter are gone.
  for (const removed of ["tokenName", "remove", "reset", "allFilters", "dimensions"]) assert.equal(sentence[removed], undefined, removed);
  assert.equal(facets.active, undefined);
  assert.equal(labels.UI.sidebar, undefined);
  assert.equal(facets.counts, "Counts: medicines matching the other filters.");
  assert.equal(facets.showMore(20), "Show 20 more");
  assert.equal(facets.matches(0), "No matches");
  assert.equal(facets.matches(1), "1 match");
  assert.equal(facets.matches(1234), "1,234 matches");
  // An active chip with several values selected.
  assert.equal(facets.selected(2), "2 selected");
  assert.equal(facets.selected(1234), "1,234 selected");
  assert.equal(sheet.show(33), "Show 33 medicines");
  assert.equal(sheet.show(1), "Show 1 medicine");
  assert.equal(sheet.clear, "Clear");
  assert.equal(sheet.close, "Close filters");
});

// Modality (M2 phase 2): the filter chip, the tree, the breakdown and the card's source line.
test("modality copy: filter chip, tree rows, static rows, breakdown and sources", () => {
  const { sentence, filters, modality, breakdown, about } = labels.UI;
  assert.equal(filters.names.mod, "Modality");
  assert.equal(filters.remove("mod", "siRNA"), "Remove modality filter: siRNA");
  assert.equal(sentence.many.mod(2), "2 modalities");
  assert.equal(sentence.words.withModality, " with ");
  assert.equal(modality.count("Antibody", 312), "Antibody, 312 medicines");
  assert.equal(modality.included("Bispecific antibody", 1, "Antibody"), "Bispecific antibody, 1 medicine, included in Antibody");
  assert.equal(modality.expand("Antibody"), "Kinds of Antibody");
  assert.equal(modality.groupOnly("Vaccine"), "Vaccine, not more specific");
  assert.equal(modality.notClassified, "Not classified");
  assert.equal(breakdown.mod.titleIn("Antibody"), "Medicines in Antibody by modality");
  assert.equal(modality.sources.stem("-siran"), "WHO INN stem “-siran”");
  assert.equal(modality.sources.chembl("CHEMBL941", "ChEMBL_37"), "ChEMBL CHEMBL941 (ChEMBL_37)");
  assert.equal(modality.sources.radionuclide("177Lu"), "Radionuclide in its INN (177Lu)");
  // Review of the copy pass: an EMA text rule reads as what the text names, not as literal keywords.
  assert.equal(modality.sources.text("vaccine live"), "EMA text naming a live vaccine");
  assert.equal(modality.sources.text("vaccine ad26."), "EMA text naming an Ad26 vector vaccine");
  assert.equal(modality.sources.text("mrna"), "EMA text naming mRNA");
  assert.equal(modality.sources.text("vaccine toxoid"), "EMA text naming a toxoid vaccine");
  assert.equal(modality.sources.text("cells"), "EMA text naming cells");
  assert.equal(modality.documents.pubmed("38142486"), "PubMed 38142486");
  // The modality credit is in About's sources (legal review 2026-09-30), once the data credits WHO's INN stems.
  assert.ok(about.sources({ innStems: true }).some((parts) => parts[0] === "Modalities from WHO INN stems (World Health Organization, 2024), read as facts in our own words, ChEMBL molecule types and EMA data, some checked by hand."));
});

// Phase 4f: the strip is a slim one-colour year filter; its status stacks, legend and undated note
// moved to "Approvals per year" (Stack by Status).
test("approval-years strip copy: slider names and the summary of its bars", () => {
  const { yearStrip } = labels.UI;
  assert.equal(yearStrip.start, "Start year");
  assert.equal(yearStrip.end, "End year");
  assert.equal(
    yearStrip.summary(1995, 2026, 1985, 2021, 95),
    "Approvals per year, 1995 to 2026, for the medicines matching the other filters: 1,985 in total, most in 2021 (95).",
  );
  assert.equal(yearStrip.summary(1995, 2026, 0, 1995, 0), "No medicines with an approval date match the other filters.");
  assert.equal(labels.UI.years.tooltipTitle(1996, 0), "1996: 0 approvals");
});

test("approvals per year by status: the mode, its summary phrase, counting note, legend lead and undated note", () => {
  const { years } = labels.UI;
  assert.equal(years.stack.modes.status, "Status");
  assert.equal(years.by.status, "current status");
  assert.equal(years.note(years.counting.status), "Year of EU marketing authorization; each medicine counted once, by its current status. EMA's annual reports count recommendations (CHMP opinions) instead, so their totals differ. Click a year to show only that year (click again for all), or drag across several years; with a keyboard, use the Approval year filter.");
  // The legend states the stack order, so position identifies a segment, not only its colour.
  assert.equal(years.legendLead, "Bottom to top:");
  // Owner calls 2026-09-30: stacked by status, the note says the colors are the status today and the
  // legend is headed so; the card is named by what it counts.
  assert.match(years.noteStatus, /^Each medicine once, in the year it was first approved; colors show its status today\. EMA/);
  assert.equal(years.legendHeading, "Status today");
  assert.equal(years.title, "Medicines by year of approval");
  assert.equal(years.undatedStatuses(366), "366 medicines without an approval date (refused, application withdrawn, pending…) are not in this chart.");
  assert.equal(years.undatedStatuses(1), "1 medicine without an approval date (refused, application withdrawn, pending…) is not in this chart.");
  // Phase 4c review: a year filter also leaves them out of every count.
  assert.equal(
    years.undatedStatuses(366, true),
    "366 medicines without an approval date (refused, application withdrawn, pending…) are not in this chart, and the year filter leaves them out of every count.",
  );
});

// The conditions card (redesign 2026-09-29): a table ranked by treatments or authorized medicines,
// most or fewest first; its title says which (a proposal for the owner). Shown with and without
// filters (phase 4c).
test("the conditions card names its ranking, what it counts, its columns and sorts", () => {
  const { conditions, sortOrder } = labels.UI;
  assert.equal(conditions.title("treatments", "desc"), "Conditions with the most treatments");
  assert.equal(conditions.title("treatments", "asc"), "Conditions with the fewest treatments");
  assert.equal(conditions.title("medicines", "desc"), "Conditions with the most authorized medicines");
  assert.equal(conditions.title("medicines", "asc"), "Conditions with the fewest authorized medicines");
  // The medicines covered, each condition with its narrower ones (as its condition page counts;
  // review 2026-09-29), then what a treatment is (step 4, #10: distinct substance sets, a combination
  // on its own); then where the broad categories are (owner decision 2026-09-29: not ranked here).
  assert.equal(conditions.subtitle(2351, false), "Conditions of all 2,351 medicines in the EMA data, each with its narrower ones; treatments are the active substances or combinations of the authorized ones. Broad categories such as Neoplasms are in the therapeutic area filter.");
  assert.equal(conditions.subtitle(33, true), "Conditions of the 33 medicines matching the filters, each with its narrower ones; treatments are the active substances or combinations of the authorized ones. Broad categories such as Neoplasms are in the therapeutic area filter.");
  assert.equal(conditions.subtitle(1, true), "Conditions of the 1 medicine matching the filters, each with its narrower ones; treatments are the active substances or combinations of the authorized ones. Broad categories such as Neoplasms are in the therapeutic area filter.");
  // Owner decision 2026-09-29 ("Authorized by default"): only authorized medicines shown.
  assert.equal(conditions.subtitle(1573, false, false, true), "Conditions of all 1,573 authorized medicines, each with its narrower ones; treatments are their active substances or combinations. Broad categories such as Neoplasms are in the therapeutic area filter.");
  assert.equal(conditions.subtitle(33, true, true, true), "Conditions of the 33 authorized medicines matching the filters, within the selected areas, each with its narrower ones; treatments are their active substances or combinations. Broad categories such as Neoplasms are in the therapeutic area filter.");
  assert.equal(conditions.subtitle(1, true, false, true), "Conditions of the 1 authorized medicine matching the filters, each with its narrower ones; treatments are their active substances or combinations. Broad categories such as Neoplasms are in the therapeutic area filter.");
  assert.equal(conditions.authorizedTip(120), "120 authorized medicines");
  assert.equal(conditions.authorizedTip(1), "1 authorized medicine");
  assert.deepEqual(conditions.headers, { condition: "Condition", treatments: "Treatments", medicines: "Authorized medicines" });
  // Sort buttons (the site's convention: a second click reverses; the pressed one names its order).
  assert.equal(sortOrder.name(conditions.sortBy.treatments, "count", "asc"), "Sort by treatments, fewest first");
  assert.equal(sortOrder.name(conditions.sortBy.medicines, "count", "desc"), "Sort by authorized medicines, most first");
  // Each medicines cell: the authorized, then (muted) of every status; on phones each number says
  // what it counts (the header is hidden there).
  assert.equal(conditions.of(64), "of 64");
  // Visually hidden after it (review 2026-09-29: "47 of 64" did not say what the 64 counts).
  assert.equal(conditions.everyStatus(64), " medicines of every status");
  assert.equal(conditions.everyStatus(1), " medicine of every status");
  assert.equal(conditions.treatmentsUnit(16), "treatments");
  assert.equal(conditions.treatmentsUnit(1), "treatment");
  assert.equal(conditions.authorizedUnit, "authorized");
  assert.equal(conditions.medicinesTip(47, 64), "47 authorized of 64 medicines of every status");
  assert.equal(conditions.medicinesTip(1, 1), "1 authorized of 1 medicine of every status");
  assert.equal(conditions.showMore(10), "Show 10 more");
  assert.equal(conditions.showMore(3), "Show 3 more");
  // Fewest first leaves out the conditions without an authorized treatment, and says so.
  assert.equal(conditions.unlisted(12), "12 conditions without an authorized treatment are not listed.");
  assert.equal(conditions.unlisted(1), "1 condition without an authorized treatment is not listed.");
  assert.equal(conditions.substances(16), "16 active substances or combinations");
  assert.equal(conditions.substances(1), "1 active substance or combination");
  assert.equal(conditions.empty(0), "No medicines match the current filters.");
  assert.equal(conditions.empty(1), "No therapeutic area is listed for this medicine.");
  assert.equal(conditions.empty(3), "No therapeutic areas are listed for these medicines.");
  // None of the conditions has an authorized medicine (e.g. only withdrawn ones shown): nothing to
  // rank, so a line instead of the table (review 2026-09-29).
  assert.equal(conditions.noneAuthorized(207), "None of the 207 conditions of these medicines has an authorized medicine, so they are not ranked.");
  assert.equal(conditions.noneAuthorized(1), "The one condition of these medicines has no authorized medicine, so it is not ranked.");
  // Every condition of the medicines shown is a broad category (owner decision 2026-09-29): a line.
  assert.equal(conditions.onlyBroad(3), "The 3 conditions of these medicines are broad categories, not ranked here: see the therapeutic area filter.");
  assert.equal(conditions.onlyBroad(1), "The one condition of these medicines is a broad category, not ranked here: see the therapeutic area filter.");
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
  assert.deepEqual(labels.UI.results.headers, ["Medicine", "ATC", "Approved · Status", "Type", "Company · Holder"]);
  // Phase 4c review: substance cards add what each medicine is for, after the medicine.
  assert.equal(labels.UI.results.areas, "Therapeutic area");
});

test("the results timeline explains its dots and lines", () => {
  const { timeline } = labels.UI;
  assert.equal(timeline.caption, "One dot per medicine; lines join medicines with the same active substances (reference, generics, biosimilars). Tap or point at a dot for its name.");
  // Phase 4f: condition pages name both kinds of dot in a legend.
  assert.deepEqual(timeline.legend, { tagged: "Tagged by EMA", mentioned: "Mentioned in the indication" });
  assert.equal(timeline.mentioned, "Only mentioned in the indication text");
  // Step 4 (#17): on condition and indication-text pages a dot is not the date the use was added
  // (review: "this use", as an indication-text search is not a condition).
  assert.equal(timeline.firstApproval, "Dots show each medicine's first approval, not when this use was added to its indication.");
});

// Step 4 (#17): the per-year totals differ from EMA's annual reports, which count CHMP opinions.
test("the approvals per year note says why its totals differ from EMA's annual reports", () => {
  const { years } = labels.UI;
  assert.match(years.note(years.counting.type), /^Year of EU marketing authorization; each medicine counted once\. EMA's annual reports count recommendations \(CHMP opinions\) instead, so their totals differ\. Click a year/);
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
  // Companies part 2: the rows are company groups, each naming the EMA holder names behind it.
  assert.equal(activity.subtitle(15), "The 15 companies with the most matching medicines; a medicine can count in several columns.");
  assert.equal(activity.subtitle(1), "The company of the matching medicines; a medicine can count in several columns.");
  assert.equal(activity.note("2026-09-28"), "Companies grouped by current owner as of 28 Sep 2026; each row's tooltip lists the EMA holder names.");
  assert.equal(activity.holder, "Company");
  assert.equal(activity.other, "Other");
});

test("ladder links name the level, the class and the medicines currently authorized", () => {
  const { ladderLink } = labels.UI.atc;
  assert.equal(ladderLink(1, "A", ATC_LEVEL_ONE.A[0], 180), "Level 1, A Alimentary Tract and Metabolism: 180 authorized medicines");
  assert.equal(ladderLink(5, "A10BJ06", "semaglutide", 1), "Level 5, A10BJ06 Semaglutide: 1 authorized medicine");
  assert.equal(ladderLink(4, "L04AL", null, 0), "Level 4, L04AL no WHO name: 0 authorized medicines");
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

// Phase 4g: one therapeutic area as the only filter, named as the ATC class headline names its
// class (the level path is below it, not in it); a root tag (older links) as a tag.
test("the area headline counts the medicines in one therapeutic area and those currently authorized", () => {
  const { area } = labels.UI.headline;
  assert.equal(plain(area(97, 80, "Breast Neoplasms")), "97 medicines in Breast Neoplasms, 80 of them currently authorized.");
  assert.deepEqual(toned(area(97, 80, "Breast Neoplasms")), [["97", "number"], ["80", "number"]]);
  assert.equal(plain(area(1, 0, "Neoplasms")), "1 medicine in Neoplasms; it is not currently authorized.");
  assert.equal(plain(area(0, 0, "Neoplasms")), "No medicines in the EMA data are in Neoplasms.");
  assert.equal(plain(area(2, 2, "Neoplasms", true)), "2 medicines tagged Neoplasms, all of them currently authorized.");
  assert.equal(plain(area(0, 0, "Cancer", true)), "No medicines in the EMA data are tagged Cancer.");
  // A MeSH category (owner decision 2026-09-29) by its name, as any area.
  assert.equal(plain(area(1800, 1200, "Diseases")), "1,800 medicines in Diseases, 1,200 of them currently authorized.");
});

test("the ATC breakdown copy counts medicines of every status", () => {
  const { atc } = labels.UI;
  assert.equal(labels.UI.breakdown.atc.title, "Medicines by ATC group");
  assert.equal(labels.UI.breakdown.atc.titleIn("L04 Immunosuppressants"), "Medicines in L04 Immunosuppressants by ATC class");
  assert.equal(labels.UI.breakdown.atc.titleLeaf("L04AC05 Ustekinumab"), "Medicines in L04AC05 Ustekinumab");
  assert.equal(labels.UI.breakdown.area.title, "Medicines by therapeutic area (MeSH branch)");
  assert.equal(labels.UI.breakdown.mah.title, "Medicines by company");
  assert.equal(labels.UI.breakdown.mah.titleIn("Sanofi", false), "Medicines of Sanofi by company");
  assert.equal(labels.UI.breakdown.mah.titleIn("Genzyme Europe B.V.", true), "Medicines of Genzyme Europe B.V. by EMA holder name");
  assert.equal(labels.UI.breakdown.mah.titleLeaf("Roche"), "Medicines of Roche");
  assert.equal(labels.UI.breakdown.empty, "No medicines match the current filters.");
  // Phase 4c review: retired and incomplete codes are mapped (atcCode()), so the note says how.
  // Phase 4e: curated codes (checked by hand) complete the rest.
  assert.equal(atc.note, "Retired codes count under the class WHO moved them to. Missing or incomplete EMA codes are filled in where possible: from the product information (SmPC), else from WHO's ATC index, its temporary list or the SmPC text, checked by hand.");
  assert.equal(atc.incomplete, "code incomplete");
  assert.equal(atc.codedHere, "coded at this level");
});

// Owner feedback 2026-09-29: the ATC tree's rows explain their class (atc.js atcClassTip()), its
// static rows what they count; the five levels as WHOCC's structure and principles page defines them
// (review of PR #15: level 2 "pharmacological or therapeutic", levels 3 and 4 "chemical,
// pharmacological or therapeutic"; the metformin example alone gave level 2 "therapeutic").
test("the ATC tree's explainers: WHO's level meanings, at most 25 words of copy, U.S. spelling, no em-dashes", () => {
  const { atc } = labels.UI;
  assert.deepEqual(atc.levels, {
    1: "anatomical main group",
    2: "pharmacological or therapeutic subgroup",
    3: "chemical, pharmacological or therapeutic subgroup",
    4: "chemical, pharmacological or therapeutic subgroup",
    5: "chemical substance",
  });
  const tips = [
    atc.classTip("L04AC", 4, "L04A"),
    `${atc.classTip("L01XC", 4, "L01X")} ${atc.retired(2022, "L01F")}`,
    `${atc.classTip("J07BX99", 5, "J07BX")} ${atc.retired(2023, null)}`,
    `${atc.classTip("C10AX21", 5, "C10AX")} ${atc.temporary}`,
    atc.incompleteTip,
    atc.codedHereTip,
  ];
  for (const tip of tips) {
    assert.ok(tip.split(" ").length <= 25, tip);
    assert.ok(!/—|authoris/i.test(tip), tip);
  }
  assert.equal(atc.incompleteTip, "Medicines coded only down to this class: their ATC code has no more specific level.");
  assert.equal(atc.codedHereTip, "Medicines whose complete ATC code is this class itself.");
});

test("a substance card names the medicines classed under another code", () => {
  assert.equal(labels.UI.atc.classed(["Kyinsu"], "A10AE57"), "Kyinsu is classed A10AE57.");
  assert.equal(labels.UI.atc.classed(["MabThera", "Truxima", "Ruxience"], "L01XC02"), "MabThera, Truxima and Ruxience are classed L01XC02.");
});

test("drug classes are a lookup suggestion group with an authorized count", () => {
  assert.equal(labels.UI.lookup.groups.classes, "Drug classes");
  assert.equal(labels.UI.lookup.classMeta(1234), "1,234 authorized");
  assert.equal(labels.UI.lookup.classMeta(20, true), "no WHO name · 20 authorized");
  // A drug class example opens the class alone (url.js classState()).
  assert.deepEqual(labels.UI.lookup.examples.at(-1), { label: "L04AC", kind: "drug class", atc: "L04AC" });
});

// Landing (user-approved design, 2026-09-28): a first-time visitor sees what the site is for.
test("the search says what to type, and each Try example says what kind of thing it is", () => {
  const { lookup } = labels.UI;
  assert.equal(lookup.placeholder, "Drug name, active substance or condition");
  // ATC codes still work: the field's name says so.
  assert.equal(lookup.label, "Search by drug name, active substance, condition, company or ATC code");
  assert.deepEqual(lookup.examples.map((example) => `${example.label} ${lookup.exampleKind(example.kind)}`), [
    "Keytruda (brand)",
    "semaglutide (active substance)",
    "psoriasis (condition)",
    "L04AC (drug class)",
  ]);
});

// Step 2 (#2, #3, #5, #14, #19): the search list says what it shows; an empty search says why.
test("search copy: retried and empty lists, did you mean, the indication-text option, another name", () => {
  const { lookup, condition } = labels.UI;
  assert.equal(lookup.showingFor("ozempic"), "Showing results for “ozempic”");
  assert.equal(lookup.searchText("NSCLC"), "Search indication texts for “NSCLC”");
  assert.equal(lookup.groups.fuzzy, "Did you mean");
  assert.equal(lookup.substanceMeta(2, "adrenaline"), "matches “adrenaline” · 2 medicines");
  assert.equal(lookup.substanceMeta(1), "1 medicine");
  assert.equal(lookup.whoMeta("N02BE01"), "ATC N02BE01 · not in EMA's central procedure");
  assert.equal(lookup.status("Showing results for “ozempic”", 1), "Showing results for “ozempic”. 1 suggestion");
  assert.equal(lookup.status(lookup.noMatches, 0), "No matches");
  assert.equal(lookup.status(null, 3), "3 suggestions");
  const { empty } = lookup;
  assert.equal(empty.nothing("paracetamol"), "Nothing in the EMA data matches “paracetamol”.");
  // Step 2 review: the data holds EMA's central procedure only; a substance outside it may still be
  // authorized nationally. A note that ends a sentence is joined to the count with one period.
  assert.equal(
    empty.known("Paracetamol", "N02BE01"),
    "Paracetamol (ATC N02BE01): no medicine with it went through EMA's central procedure, but it may be authorized nationally.",
  );
  assert.equal(
    lookup.status(empty.known("Omeprazole", "A02BC01"), 1),
    "Omeprazole (ATC A02BC01): no medicine with it went through EMA's central procedure, but it may be authorized nationally. 1 suggestion",
  );
  assert.equal(lookup.status(empty.known("Omeprazole", "A02BC01"), 0), empty.known("Omeprazole", "A02BC01"));
  assert.equal(empty.noText("Humira"), "No indication text mentions “Humira”.");
  assert.equal(empty.otherStatuses(1), "No currently authorized medicine mentions it in its indication; 1 medicine of another status does (Show all statuses).");
  assert.equal(empty.otherStatuses(3), "No currently authorized medicine mentions it in its indication; 3 medicines of another status do (Show all statuses).");
  assert.equal(empty.searchable, "Search by brand name, active substance (such as pembrolizumab), condition, company or ATC code.");
  assert.equal(empty.notYet, "Not searchable yet: development codes (such as MK-3475) and brand names used outside the EU.");
  assert.equal(
    `${empty.notInData}${empty.registers}${empty.registersAfter}`,
    "Not in the data: medicines authorized only nationally. Find them in the national medicine registers (EMA's list). A medicine authorized through EMA has an EU number (EU/1/…) on its pack.",
  );
  assert.equal(condition.alsoSearched("acetylsalicylic acid"), "Also searching for “acetylsalicylic acid”, the name EMA uses.");
});

test("the intro card says what the site is for and what it covers", () => {
  const { UI } = labels;
  // F · Spacious, phase 1: the tagline and the scope line left the top bar (the intro card says it).
  assert.equal(UI.tagline, undefined);
  assert.equal(UI.scopeLine, undefined);
  assert.equal(UI.intro.link, "What is this?");
  // Owner decision 2026-09-29: three onboarding cards (a bold title, one plain sentence, an example to
  // try) in place of the two lists, then one quiet line on scope and use.
  assert.deepEqual(UI.intro.cards.map(({ hue, title, text, action }) => ({ hue, title, text, action })), [
    { hue: "green", title: "Look up a drug", text: "Type a brand or active substance: is it authorized in the EU, what for, since when, and who owns it?", action: "Try Keytruda" },
    { hue: "gold", title: "Protection and copies", text: "See roughly how long market protection runs, and whether generics or biosimilars are authorized yet.", action: "Try Humira" },
    { hue: "blue", title: "Explore the landscape", text: "Which conditions have the most treatments, which companies are active where, and how approvals change over time.", action: "Explore cancer medicines" },
  ]);
  assert.deepEqual(UI.intro.cards.map((card) => card.patch ?? { area: card.area }), [{ med: "EMEA/H/C/003820" }, { med: "EMEA/H/C/000481" }, { area: "C04" }]);
  assert.equal(
    UI.intro.scope,
    "Covers medicines authorized EU-wide through the European Medicines Agency (EMA). Many older medicines, such as paracetamol, are authorized country by country and aren't here. For information only, not medical advice.",
  );
  for (const removed of ["lookupLead", "lookup", "exploreLead", "explore", "authorized", "smallPrint"]) assert.equal(UI.intro[removed], undefined, removed);
});

// Step 2 (#1): 284 of 1,278 substances have no centrally authorized medicine (celecoxib, testosterone),
// and "first EU approval" overstated metformin's. Every answer about a substance or a condition, and the
// scope lines, say they cover EMA's central procedure only.
test("substance and condition answers name EMA or the central procedure", () => {
  const { UI } = labels;
  const texts = [
    plain(UI.headline.substance("semaglutide", 5)),
    plain(UI.headline.substance("celecoxib", 0)),
    plain(UI.headline.condition("Psoriasis", 52, true)),
    plain(UI.headline.condition("Kuru", 0, false)),
    UI.substance.firstApproval("2003-02-11", "Avandamet"),
    UI.substance.firstApproval(null, null),
    UI.protection.countedFrom("pembrolizumab", "Keytruda", "2015-07-17"),
    UI.condition.counts(6, 5, false),
    UI.condition.taggedOwn("Psoriasis", 43),
    UI.lookup.empty.known("Paracetamol", "N02BE01"),
    UI.lookup.whoMeta("N02BE01"),
    UI.dataDate("2026-09-26"),
    UI.intro.scope,
    UI.about.scope,
  ];
  for (const text of texts) assert.match(text, /\bEMA\b|\bcentral/, text);
  assert.equal(UI.substance.firstApproval("2003-02-11", "Avandamet"), "First central EU approval: 11 Feb 2003 (Avandamet)");
  assert.equal(UI.substance.firstApproval(null, null), "No central EU approval date");
});

// Parts ({ text, link } for links) as the text they read.
const partsText = (parts) => parts.map((part) => (typeof part === "string" ? part : part.text)).join("");

// Step 3 (#7): the medicine card's copies lines, counted by substance set, not by EMA's reference.
test("copies lines: generics and biosimilars of the same substance, or none yet", () => {
  const { copies } = labels.UI;
  assert.equal(copies.none, "No generic or biosimilar authorized yet.");
  const humira = copies.line([{ type: "Biosimilar", count: 10, companies: 8, first: { name: "Amgevita", date: "2017-03-21" } }]);
  assert.equal(partsText(humira), "10 biosimilars from 8 companies, first Amgevita 21 Mar 2017.");
  assert.deepEqual(humira.filter((part) => typeof part !== "string"), [{ text: "Amgevita", link: 0 }]);
  assert.equal(
    partsText(copies.line([
      { type: "Generic", count: 1, companies: 1, first: { name: "Dasatinib Accord Healthcare", date: "2024-07-26" } },
      { type: "Biosimilar", count: 2, companies: null, first: { name: "B", date: null } },
    ])),
    "1 generic from 1 company, first Dasatinib Accord Healthcare 26 Jul 2024; 2 biosimilars, first B.",
  );
  // Step 3 review: on a medicine that is not its substance's first (Opzelura, after Jakavi), the
  // copies are named as the substance's, not this medicine's.
  const opzelura = copies.line([{ type: "Generic", count: 1, companies: 1, first: { name: "Ruxolitinib Viatris", date: "2026-09-18" } }], "ruxolitinib");
  assert.equal(partsText(opzelura), "1 generic of ruxolitinib from 1 company, first Ruxolitinib Viatris 18 Sep 2026.");
  assert.deepEqual(opzelura.filter((part) => typeof part !== "string"), [{ text: "Ruxolitinib Viatris", link: 0 }]);
  assert.equal(
    partsText(copies.line([{ type: "Biosimilar", count: 2, companies: null, first: { name: "B", date: null } }], "denosumab")),
    "2 biosimilars of denosumab, first B.",
  );
});

test("copies lines: a copy's card names the other medicines of its substance and its first central approval", () => {
  const { copies } = labels.UI;
  const hyrimoz = copies.same(10, "adalimumab", 1, { name: "Trudexa", date: "2003-09-01" });
  assert.equal(partsText(hyrimoz), "10 other authorized medicines have the same active substance (adalimumab); first central approval 1 Sep 2003 (Trudexa).");
  assert.deepEqual(hyrimoz.filter((part) => typeof part !== "string"), [{ text: "adalimumab", link: "substance" }, { text: "Trudexa", link: "first" }]);
  assert.equal(partsText(copies.same(1, "sitagliptin + metformin hydrochloride", 2, null)), "1 other authorized medicine has the same active substances (sitagliptin + metformin hydrochloride).");
  assert.equal(partsText(copies.same(0, "x", 1, null)), "No other authorized medicine has the same active substance (x).");
  // Step 4 (owner request 2026-09-28): a first approval no longer authorized says so, so "No other
  // authorized medicine" does not read against it (Qdenga: Dengvaxia, withdrawn).
  const qdenga = copies.same(0, "dengue tetravalent vaccine (live, attenuated)", 1, { name: "Dengvaxia", date: "2018-12-12", status: "Withdrawn" });
  assert.equal(partsText(qdenga), "No other authorized medicine has the same active substance (dengue tetravalent vaccine (live, attenuated)); the first central approval was Dengvaxia (12 Dec 2018), since withdrawn.");
  assert.deepEqual(qdenga.filter((part) => typeof part !== "string"), [{ text: "dengue tetravalent vaccine (live, attenuated)", link: "substance" }, { text: "Dengvaxia", link: "first" }]);
  assert.equal(partsText(copies.same(2, "x", 1, { name: "Y", date: "2010-01-01", status: "Expired" })), "2 other authorized medicines have the same active substance (x); the first central approval was Y (1 Jan 2010), since expired.");
  // Authorized, or its status unknown: as before.
  assert.equal(partsText(copies.same(2, "x", 1, { name: "Y", date: "2010-01-01", status: "Authorised" })), "2 other authorized medicines have the same active substance (x); first central approval 1 Jan 2010 (Y).");
});

// Step 3 (#8): salt spellings of one substance on the substance card.
test("substance card: another spelling of the same substance, with its medicines and first approval", () => {
  const { substance } = labels.UI;
  const line = substance.sibling("dasatinib (anhydrous)", 3, { name: "Sprycel", date: "2006-11-20" });
  assert.equal(partsText(line), "Also listed as dasatinib (anhydrous): 3 medicines, first central approval 20 Nov 2006 (Sprycel).");
  assert.deepEqual(line.filter((part) => typeof part !== "string"), [{ text: "dasatinib (anhydrous)", link: "sibling" }]);
  assert.equal(partsText(substance.sibling("x", 1, null)), "Also listed as x: 1 medicine.");
  // Step 3 review: with other spellings, the headline and strip count them all, the list this one's.
  assert.equal(substance.productsListed(1, "dasatinib"), "1 medicine listed as dasatinib");
  assert.equal(substance.productsListed(3, "dasatinib (anhydrous)"), "3 medicines listed as dasatinib (anhydrous)");
});

// Step 3 (#6, #7): the strip's short form, the estimate's basis next to the chip, and why a medicine
// counted from another company's is unclear. Estimates, never "patent".
test("protection copy: strip cell, basis note and the other-company reason", () => {
  const { protection, card } = labels.UI;
  assert.equal(card.estimate, "(est.)");
  assert.equal(protection.glance.until(2031, 2032), "Until 2031–2032");
  assert.equal(protection.glance.until(2031, 2031), "Until 2031");
  // Owner decision 2026-09-30: "(est.)" unless the Union Register publishes the end.
  assert.equal(protection.glance.orphan(2033, "computed"), "Orphan exclusivity until 2033 (est.)");
  assert.equal(protection.glance.orphan(2033, "register"), "Orphan exclusivity until 2033");
  assert.equal(protection.glance.orphan(2033, null), "Orphan exclusivity until 2033 (est.)");
  assert.equal(protection.basisNote, "Estimated from EU central (EMA) approval dates only; earlier national authorizations are not counted.");
  assert.ok(!protection.caveats.includes("Based only on EU central authorization dates."));
  for (const text of [card.estimate, protection.basisNote, protection.otherCompany("x", "Y", "2012-08-23", "2023-04-19"), protection.glance.link]) {
    assert.doesNotMatch(text, /patent/i);
  }
});

// Backlog (step 4 review): the legal basis is no longer EMA's flags alone; copies EMA does not flag
// are checked by hand against their EPAR pages (ema_curated_copies.json), and not every one yet.
test("protection caveats: the legal basis comes from EMA flags and from copies checked by hand", () => {
  const { caveats } = labels.UI.protection;
  assert.ok(!caveats.includes("The legal basis is inferred from EMA flags."));
  assert.ok(caveats.includes("The legal basis comes from EMA's generic and biosimilar flags and from EMA documents checked by hand (hybrids and other unflagged copies, pediatric-use marketing authorizations). Copies not yet checked count as medicines of their own."));
  // Copy review 2026-09-29: the possible extra year is its own caveat (the old one said the estimate ignored it and showed it as a range).
  assert.ok(caveats.includes("The possible extra year (for a significant new indication) is not known, so market protection is shown as a range."));
});

// 2026-09-29: a pediatric-use marketing authorization's own protection (Regulation (EC) No
// 1901/2006, Art. 38) is a pediatric reward the estimate now counts, so no caveat says pediatric
// rewards are ignored altogether.
test("protection caveats: pediatric rewards are ignored except a pediatric-use marketing authorization's own protection", () => {
  const { protection, protectionCalendar } = labels.UI;
  for (const text of [...protection.caveats, protectionCalendar.note, protectionCalendar.company.note]) {
    if (/pediatric rewards/i.test(text)) assert.match(text, /pediatric rewards other than a pediatric-use marketing authorization's own protection/i);
  }
  assert.ok(protection.caveats.some((caveat) => caveat.includes("pediatric rewards other than a pediatric-use marketing authorization's own protection")));
  assert.equal(protection.paediatricUse("2018-02-09"), "A pediatric-use marketing authorization (for children): protection counted from its own approval, 9 Feb 2018");
});

test("breakdown notes say how many medicines have no value", () => {
  assert.equal(labels.UI.breakdown.atc.excluded(20), "20 medicines without a valid ATC code are not shown.");
  assert.equal(labels.UI.breakdown.area.excluded(1), "1 medicine without a therapeutic area is not shown.");
  // Companies part 2: medicines without a holder have no company group.
  assert.equal(labels.UI.breakdown.mah.excluded(5), "5 medicines without a company are not shown.");
});

test("document lines leave out a missing update date instead of printing null", () => {
  assert.equal(labels.UI.card.updated(null), null);
  assert.equal(labels.UI.card.updated("8 Feb 2018"), "updated 8 Feb 2018");
  assert.equal(labels.UI.card.documentMeta(true, null), "PDF");
  assert.equal(labels.UI.card.documentMeta(true, "8 Feb 2018"), "PDF · updated 8 Feb 2018");
});

// Phase 4c: sorting, and the per-year chart's stack category.

test("the breakdown sorts by count or by code (ATC), MeSH tree order (areas) and name (holders)", () => {
  const { sort } = labels.UI.breakdown;
  assert.equal(sort.label, "Sort");
  assert.equal(sort.count, "Count");
  // Owner request 2026-09-28: the areas as the tree orders them, so not "Name".
  // Modality (M2 phase 2): the tree's order, as the areas.
  assert.deepEqual(sort.key, { atc: "Code", area: "MeSH", mah: "Name", mod: "Tree" });
  assert.equal(labels.UI.sortOrder.name("MeSH", "tree", "asc"), "MeSH, tree order");
  assert.equal(labels.UI.sortOrder.name("MeSH", "tree", "desc"), "MeSH, tree order reversed");
});

// Owner request 2026-09-28: the therapeutic areas' MeSH explainers (mesh-notes.js builds the tip).
test("MeSH explainers: the tooltip, and a condition page's definition with its tree numbers and NLM's credit", () => {
  const { mesh } = labels.UI;
  assert.equal(mesh.tip("Neoplasms", ["C04"], "New abnormal growth of tissue."), "Neoplasms (MeSH C04): New abnormal growth of tissue.");
  assert.equal(mesh.tip("X", [], "Y."), "X: Y.");
  assert.equal(mesh.numbers(["A01", "B02", "C03", "D04", "E05"]), "A01, B02, C03 and 2 more");
  assert.equal(mesh.definition, "MeSH definition: ");
  assert.equal(mesh.treeNumbers(["C04.588.180", "C17.800.090.500"]), "Tree numbers C04.588.180, C17.800.090.500.");
  assert.equal(mesh.treeNumbers(["C04"]), "Tree number C04.");
  assert.equal(mesh.source("MeSH 2026"), "From MeSH® (MeSH 2026), courtesy of the U.S. National Library of Medicine.");
  assert.equal(mesh.source(null), "From MeSH®, courtesy of the U.S. National Library of Medicine.");
});

test("the holder activity card: sort buttons, column order and row names with the total", () => {
  const { activity } = labels.UI;
  assert.equal(activity.sortBy("L Antineoplastic and Immunomodulating Agents"), "Sort companies by L Antineoplastic and Immunomodulating Agents");
  assert.equal(activity.sortByName, "Sort companies by name");
  assert.equal(activity.order.label, "Column order");
  assert.deepEqual(activity.order.key, { atc: "Code", area: "Name" });
  assert.equal(activity.order.count, "Count");
  assert.equal(activity.holderRow("Novartis Europharm Limited", 30), "Novartis Europharm Limited, 30 medicines");
  assert.equal(activity.holderRow("Accord Healthcare S.L.U.", 1), "Accord Healthcare S.L.U., 1 medicine");
  assert.equal(activity.holderRow("Roche", 40, "Roche Registration GmbH, Roche Registration Ltd."), "Roche, 40 medicines: Roche Registration GmbH, Roche Registration Ltd.");
  // Phase 4c review: a visible "Total" sort (the default), filter toggles that say what they do,
  // and the drilled-into class as a toggle of its own.
  assert.equal(activity.sortName, "Name");
  assert.equal(activity.sortTotal, "Total");
  assert.equal(activity.sortByTotal, "Sort companies by total matching medicines");
  assert.equal(activity.filterBy("Novartis Europharm Limited"), "Show only Novartis Europharm Limited");
  assert.equal(activity.pressedTitle, "Shown alone: click again to clear");
  assert.equal(activity.filterHint, "Filters the dashboard; select again to clear.");
  assert.equal(activity.parentLead, "Columns: classes in");
});

test("approvals per year: stack modes, the summary and the counting note per mode", () => {
  const { years } = labels.UI;
  assert.equal(years.stack.label, "Stack by");
  assert.deepEqual(years.stack.modes, { type: "Medicine type", atc: "ATC", mah: "Company", status: "Status", mod: "Modality" });
  // Modality (M2 phase 2): groups, or one group's modalities; a medicine counts in each it has.
  assert.equal(years.by.mod, "modality group");
  assert.equal(years.by.modIn("Antibody"), "modality in Antibody");
  assert.equal(years.note(years.counting.mod), `Year of EU marketing authorization; a medicine whose substances have several modalities is counted in each. EMA's annual reports count recommendations (CHMP opinions) instead, so their totals differ. Click a year to show only that year (click again for all), or drag across several years; with a keyboard, use the Approval year filter.`);
  assert.equal(
    years.summary(1995, 2026, 1985, 2021, 95, years.by.type),
    "Stacked column chart of EU approvals per year by medicine type, 1995 to 2026: 1,985 medicines in total, most in 2021 (95).",
  );
  assert.equal(years.by.atcIn("L04 Immunosuppressants"), "ATC class in L04 Immunosuppressants");
  assert.equal(years.by.atc, "ATC group");
  assert.equal(years.by.mah, "company");
  const howTo = "EMA's annual reports count recommendations (CHMP opinions) instead, so their totals differ. Click a year to show only that year (click again for all), or drag across several years; with a keyboard, use the Approval year filter.";
  assert.equal(years.note(years.counting.type), `Year of EU marketing authorization; each medicine counted once. ${howTo}`);
  assert.equal(years.note(years.counting.atc(6, false)), `Year of EU marketing authorization; a medicine with codes in several ATC classes is counted in each. ${howTo}`);
  // Phase 4c review: the top classes or holders and Other only when there is an Other segment.
  assert.equal(
    years.note(years.counting.atc(6, true)),
    `Year of EU marketing authorization; a medicine with codes in several ATC classes is counted in each: the top 6 classes, the rest as Other classes. ${howTo}`,
  );
  assert.equal(
    years.note(years.counting.mah(8, true)),
    `Year of EU marketing authorization; each medicine counted once: the top 8 companies, the rest as Other companies. ${howTo}`,
  );
  assert.equal(years.note(years.counting.mah(1, false)), `Year of EU marketing authorization; each medicine counted once. ${howTo}`);
  assert.deepEqual(years.other, { atc: "Other classes", mah: "Other companies" });
  // The segment on top for the medicines a mode cannot place (user decision 2026-09-28).
  assert.equal(years.unplaced.atc, "No ATC code");
  assert.equal(years.unplaced.atcIn("L04AC"), "Coded only as L04AC");
  assert.equal(years.unplaced.mah, "No company");
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
  assert.equal(namesake.authorized("2018-04-19"), " has been authorized since 19 Apr 2018.");
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
  // F · Spacious, phase 4: the Status block shows the first three conditions, the rest in More
  // details, opened by a button whose name ends in what it shows.
  assert.deepEqual(labels.UI.card.moreAreas(7), { text: "and 7 more", hidden: " therapeutic areas" });
  assert.deepEqual(labels.UI.card.moreAreas(1), { text: "and 1 more", hidden: " therapeutic area" });
});

// Phase 4c review: the tab's title names the view (WCAG 2.4.2); the dashboard under a lookup result
// has its own heading.
test("page titles name the view; the overview under a result is headed as such", () => {
  const { UI } = labels;
  assert.equal(UI.pageTitle("Wegovy"), "Wegovy · Approval Atlas");
  assert.equal(UI.pageTitle(null), "Approval Atlas");
  assert.equal(UI.textTitle("wegovy"), "“wegovy”");
  // Owner decision 2026-09-29: the overview shows the authorized medicines by default, not all.
  assert.equal(UI.explore.title, "Explore EMA medicines");
  assert.equal(UI.explore.note, "The filters apply to this overview, not to the result above.");
});

// Companies part 2 (user decisions 2026-09-28): holders grouped by their current owner; EMA's
// holder name stays visible wherever a company is shown (once when the same).
test("companies: the line under a company group keeps EMA's holder name and says how the holder was decided", () => {
  const { companies } = labels.UI;
  assert.equal(companies.holderLine({ holder: "Roche Registration GmbH", register: null, basis: "ema" }, "Roche"), "Roche Registration GmbH");
  assert.equal(companies.holderLine({ holder: "Krka", register: null, basis: "ema" }, "Krka"), null);
  assert.equal(
    companies.holderLine({ holder: "Mylan Pharmaceuticals Limited", register: "Viatris Limited", basis: "register" }, "Viatris"),
    "EMA: Mylan Pharmaceuticals Limited · EU register: Viatris Limited",
  );
  assert.equal(
    companies.holderLine({ holder: "FGK Representative Service GmbH", register: null, basis: "curated_sponsor" }, "Acme"),
    "via a regulatory representative: FGK Representative Service GmbH",
  );
  // A sponsor in another group is named (Avanir, Otsuka's); Zokinvy: EMA names one representative, the
  // Union Register (deciding) another; EMA's name stays.
  assert.equal(
    companies.holderLine({ holder: "Jenson Pharmaceutical Services Limited", register: null, basis: "curated_sponsor", company: { name: "Avanir Pharmaceuticals" } }, "Otsuka"),
    "Avanir Pharmaceuticals · via a regulatory representative: Jenson Pharmaceutical Services Limited",
  );
  assert.equal(
    companies.holderLine({ holder: "TMC Pharma (EU) Limited", register: "Integral Pharma Solutions EU Limited", basis: "curated_sponsor", company: { name: "Sentynl Therapeutics" } }, "Zydus Lifesciences"),
    "Sentynl Therapeutics · EMA: TMC Pharma (EU) Limited · EU register: Integral Pharma Solutions EU Limited, a regulatory representative",
  );
  assert.equal(
    companies.holderLine({ holder: "FGK Representative Service GmbH", register: null, basis: "curated_sponsor", company: { name: "Bio-Thera Solutions" } }, "Bio-Thera Solutions"),
    "via a regulatory representative: FGK Representative Service GmbH",
  );
  assert.equal(
    companies.holderLine({ holder: "FGK Representative Service GmbH", register: null, basis: "ema" }, "FGK Representative Service GmbH", true),
    "a regulatory representative, holding for another company",
  );
  assert.equal(companies.tipHolder("Roche", "Roche Registration GmbH"), "Roche (Roche Registration GmbH)");
  assert.equal(companies.tipHolder("Krka", "Krka"), "Krka");
  // EMA names no holder (the Union Register does): said so, never as a holder name "Not stated".
  assert.equal(
    companies.holderLine({ holder: null, register: "Janssen-Cilag International NV", basis: "register" }, "Johnson & Johnson"),
    "EMA names no holder · EU register: Janssen-Cilag International NV",
  );
  assert.equal(companies.holderLine({ holder: null, register: null, basis: null }, "Johnson & Johnson"), null);
  assert.equal(companies.tipHolder("Johnson & Johnson", null), "Johnson & Johnson");
  assert.equal(companies.noHolder, "No EMA holder name");
});

test("companies: a company under several groups names its group where no group shows beside it, and counts per group", () => {
  const { companies } = labels.UI;
  assert.equal(companies.inGroup("Merck Sharp & Dohme B.V.", "Organon"), "Merck Sharp & Dohme B.V. (Organon)");
  assert.equal(companies.groupCount(10), "(10 medicines)");
  assert.equal(companies.groupCount(1), "(1 medicine)");
});

test("companies: aggregated views name the EMA holder names behind a company, the first 8 then how many more", () => {
  const { companies } = labels.UI;
  assert.equal(companies.named("Roche", ["Roche Registration GmbH", "Roche Registration Ltd."]), "Roche: Roche Registration GmbH, Roche Registration Ltd.");
  const many = Array.from({ length: 11 }, (_, index) => `Holder ${index + 1}`);
  assert.equal(companies.legalNames(many), "Holder 1, Holder 2, Holder 3, Holder 4, Holder 5, Holder 6, Holder 7, Holder 8 and 3 more");
  assert.equal(companies.barLabel("Roche", 40, ["Roche Registration GmbH"]), "Roche, 40 medicines: Roche Registration GmbH");
  assert.equal(companies.barLabel("Roche Registration GmbH", 1, []), "Roche Registration GmbH, 1 medicine");
  // A company named after one of its holder names: the others, after "also".
  const roche = ["Roche Registration GmbH", "Roche Registration Ltd.", "Roche Registration Limited"];
  assert.equal(companies.legalNames(roche, "Roche Registration GmbH"), "also Roche Registration Ltd., Roche Registration Limited");
  assert.equal(companies.named("Roche Registration GmbH", roche), "Roche Registration GmbH: also Roche Registration Ltd., Roche Registration Limited");
  assert.equal(companies.barLabel("Roche Registration GmbH", 41, roche), "Roche Registration GmbH, 41 medicines: also Roche Registration Ltd., Roche Registration Limited");
  assert.equal(companies.legalNames(roche, "Roche"), roche.join(", "));
  assert.equal(companies.legalNames(["Holder 0", ...many], "Holder 0"), `also ${companies.legalNames(many)}`);
});

test("companies: tree, company page, search and footer copy", () => {
  const { companies, lookup, about, sentence, filters, card } = labels.UI;
  assert.equal(companies.find, "Find a company");
  // QA 2026-09-29 (#6): the tree's note (a second "note" key, the ownership line, used to replace it).
  assert.equal(companies.note("2026-09-28"),
    "Grouped by current owner (as of 28 Sep 2026), then company, then EMA holder name. A level that only repeats a name is left out.");
  assert.equal(companies.note(null),
    "Grouped by current owner, then company, then EMA holder name. A level that only repeats a name is left out.");
  assert.equal(companies.expand("Sanofi", false), "Companies in Sanofi");
  assert.equal(companies.expand("Genzyme Europe B.V.", true), "EMA holder names of Genzyme Europe B.V.");
  assert.equal(companies.count("Roche", 1), "Roche, 1 medicine");
  assert.equal(companies.included("Roche Registration GmbH", 38, "Roche"), "Roche Registration GmbH, 38 medicines, included in Roche");
  assert.equal(companies.open("Roche"), "Open company page: Roche");
  const text = (parts) => parts.map((part) => (typeof part === "string" ? part : part.text)).join("");
  assert.equal(text(companies.headline("Roche", 40, 31)), "Roche: 40 medicines, 31 currently authorized.");
  assert.equal(text(companies.headline("Sanofi Pasteur MSD (joint venture)", 1, 0)), "Sanofi Pasteur MSD (joint venture): 1 medicine, none currently authorized.");
  assert.equal(companies.asOf("2026-09-28"), "Grouped by current owner as of 28 Sep 2026, not the owner at approval. Each medicine keeps its EMA holder name.");
  assert.equal(companies.from(["EMA holder names", "company groups checked by hand"]), "From EMA holder names and company groups checked by hand.");
  assert.equal(lookup.groups.companies, "Companies");
  assert.equal(lookup.companyMeta("Genzyme Europe B.V.", 12), "matches “Genzyme Europe B.V.” · 12 authorized");
  assert.equal(lookup.companyMeta(null, 31), "31 authorized");
  assert.equal(sentence.defaults.mah, "all companies");
  assert.equal(filters.remove("mah", "Roche"), "Remove company filter: Roche");
  assert.equal(card.company, "Company");
  assert.equal(labels.UI.kicker.company, "Company");
  assert.equal(labels.UI.external.destinations["search.gleif.org"], "GLEIF website");
  // Legal review 2026-09-30: the groups' curation date in About's "Use with care", GLEIF among its sources.
  assert.ok(about.use("2026-09-28").includes("Company groups show the current owner as curated here (as of 28 Sep 2026), not an official record."));
  assert.ok(about.sources().some((parts) => parts[0] === "LEI data: Global Legal Entity Identifier Foundation (GLEIF), CC0. GLEIF does not provide or endorse this site."));
  // F · Spacious, phase 2: the links land on the tab that shows what they count.
  assert.equal(companies.atcHint, "Each opens the overview's Classes and areas tab, filtered to this company and ATC group.");
  assert.equal(companies.namesHint, "Each lists its medicines in the overview's Medicines tab.");
});

// F · Spacious, phase 2: the tabs (url.js TABS), in their order, and the previews' links to them.
test("tabs: a name for every tab, the previews' links named after their tab", () => {
  const { tabs, previews, viewOptions } = labels.UI;
  assert.deepEqual(Object.keys(tabs.names), ["overview", "protection", "classes", "companies", "years", "medicines"]);
  assert.deepEqual(Object.values(tabs.names), ["Overview", "Protection", "Classes and areas", "Companies", "By year", "Medicines"]);
  assert.equal(previews.tabLink(tabs.names.companies), "Companies tab");
  assert.equal(viewOptions, "View options");
  assert.equal(previews.companies.unit(1), "medicine");
  assert.equal(previews.conditions.unit(2), "treatments");
});

test("companies: the company page's medicine list says which statuses it shows", () => {
  const { companies } = labels.UI;
  assert.equal(companies.medicines(31, false), "Authorized medicines (31)");
  assert.equal(companies.medicines(1234, true), "Medicines of every status (1,234)");
});

test("companies: an EMA holder name as a filter value, and a holder name that repeats its company's", () => {
  const { companies } = labels.UI;
  assert.equal(companies.holderValue("Roche Registration GmbH"), "Roche Registration GmbH (EMA holder name)");
  assert.equal(companies.holderValue("Roche Registration Ltd.", "Galenus Mannheim GmbH"), "Roche Registration Ltd. (EMA holder name, Galenus Mannheim GmbH)");
  assert.equal(companies.sameName, "(same name)");
  assert.equal(companies.sameNameLabel("Roche Registration GmbH"), "Roche Registration GmbH (same name)");
});

test("companies: provenance, why a medicine sits under its group, a sponsor, a group's ownership notes", () => {
  const { companies, external } = labels.UI;
  // Notes are fragments: a sentence ends with one full stop.
  assert.equal(companies.why("AbbVie", "Abbott's pharmaceuticals became AbbVie in 2013 (the holder stayed with Abbott)"),
    "Why AbbVie: Abbott's pharmaceuticals became AbbVie in 2013 (the holder stayed with Abbott).");
  assert.equal(companies.why("Organon", "Went to Organon in 2021."), "Why Organon: Went to Organon in 2021.");
  assert.equal(companies.sponsor("AcelRx's medicine"), "Sponsor: AcelRx's medicine.");
  assert.equal(companies.sponsorEvidence, "Sponsor source");
  assert.equal(companies.evidence, "Source");
  // A sponsor note naming a rename ("AcelRx (renamed Talphera in 2024)"): a second link, to the
  // rename's evidence.
  assert.equal(companies.renameEvidence, "Rename source");
  assert.equal(companies.ownership, "Ownership");
  assert.equal(companies.ownershipNote(["Wyeth Europa Ltd", "Wyeth Lederle Vaccines S.A."], "Wyeth acquired by Pfizer in 2009"),
    "Wyeth Europa Ltd, Wyeth Lederle Vaccines S.A.: Wyeth acquired by Pfizer in 2009.");
  assert.equal(`Trudexa${companies.moved("AbbVie", "Humira's second brand")}`, "Trudexa (under AbbVie): Humira's second brand.");
  // On the page of the group it is under: no "(under …)"; a plain note (the medicine not moved) too.
  assert.equal(`Trudexa${companies.moved(null, "Humira's second brand")}`, "Trudexa: Humira's second brand.");
  // A plain note (group_note without a per-medicine move): about its later ownership, no "Why".
  assert.equal(companies.groupNote("Coherus sold its U.S. rights in 2025"), "Ownership: Coherus sold its U.S. rights in 2025.");
  // On phones a long note sits behind a disclosure: its summary, then the note alone.
  assert.equal(companies.whySummary("Theramex"), "Why Theramex?");
  assert.equal(companies.sponsorSummary, "Sponsor");
  assert.equal(companies.noteSummary, "Ownership");
  assert.equal(companies.noteBody("Went to Organon in 2021"), "Went to Organon in 2021.");
  // A company all of whose medicines went to another owner is not part of that group.
  assert.equal(companies.medicinesUnder(1), "Its medicine is under ");
  assert.equal(companies.medicinesUnder(3), "Its medicines are under ");
  assert.equal(external.destinations["en.wikipedia.org"], "Wikipedia");
  assert.equal(external.destinations["www.sec.gov"], "SEC website");
});
