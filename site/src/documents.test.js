import { test } from "node:test";
import assert from "node:assert/strict";
import { groupDocuments, primaryDocuments, quickDocuments, splitNamesakeDocuments } from "./documents.js";

const doc = (document_type, last_updated_date, url = `https://www.ema.europa.eu/en/documents/${document_type}/x-${last_updated_date}_en.pdf`) => ({
  ema_product_number: "P1",
  document_type,
  title: `${document_type} ${last_updated_date}`,
  url,
  first_published_date: last_updated_date,
  last_updated_date,
});

test("documents are grouped by type in display order, newest first", () => {
  const groups = groupDocuments([
    doc("variation-report", "2019-01-01"),
    doc("product-information", "2026-09-03"),
    doc("scientific-discussion-variation", "2008-05-05"),
    doc("variation-report", "2024-06-30"),
    doc("assessment-report", "2017-10-13"),
    doc("overview", "2025-01-01"),
    doc("rmp-summary", "2023-03-03"),
    doc("procedural-steps-after", "2026-08-01"),
  ]);
  assert.deepEqual(groups.map((group) => [group.key, group.rows.map((row) => row.last_updated_date)]), [
    ["productInformation", ["2026-09-03"]],
    ["epar", ["2017-10-13"]],
    ["variations", ["2024-06-30", "2019-01-01", "2008-05-05"]],
    ["overview", ["2025-01-01"]],
    ["rmpSummary", ["2023-03-03"]],
    ["proceduralSteps", ["2026-08-01"]],
  ]);
});

test("older products show the scientific discussion in place of the public assessment report", () => {
  const groups = groupDocuments([doc("scientific-discussion", "2006-01-01")]);
  assert.deepEqual(groups.map((group) => group.key), ["scientificDiscussion"]);
  const both = groupDocuments([doc("scientific-discussion", "2006-01-01"), { ...doc("assessment-report", "2010-01-01"), title: "Twynsta : EPAR - Public assessment report" }]);
  assert.deepEqual(both.map((group) => group.key), ["epar"]);
});

test("only a standard EPAR is labelled as one; referral and refusal reports keep their EMA title", () => {
  // Kinzalkomb (EMEA/H/C/000415): its only assessment report is an Article 31 referral.
  const kinzalkomb = groupDocuments([
    { ...doc("assessment-report", "2014-10-03"), title: "Kinzalkomb-H-C-415-A31-0084 : EPAR - Assessment Report - Article 31" },
    { ...doc("scientific-discussion", "2008-06-04"), title: "Kinzalkomb : EPAR - Scientific Discussion" },
  ]);
  assert.deepEqual(kinzalkomb.map((group) => [group.key, group.rows.map((row) => row.ownTitle)]), [["epar", [true]], ["scientificDiscussion", [false]]]);
  // Mylotarg (EMEA/H/C/004204): the approval EPAR and the earlier refusal EPAR.
  const [mylotarg] = groupDocuments([
    { ...doc("assessment-report", "2008-04-17"), title: "Mylotarg : EPAR - Refusal public assessment report" },
    { ...doc("assessment-report", "2018-05-04"), title: "Mylotarg : EPAR - Public Assessment Report" },
  ]);
  assert.deepEqual(mylotarg.rows.map((row) => [row.last_updated_date, row.ownTitle]), [["2018-05-04", false], ["2008-04-17", true]]);
});

test("EMA's archive file of a document type is flagged so its link can be told apart", () => {
  const current = { ...doc("procedural-steps-after", "2026-06-05"), title: "Zarzio : EPAR - Procedural steps taken and scientific information after authorisation" };
  const archive = { ...doc("procedural-steps-after", "2026-06-05", "https://www.ema.europa.eu/en/documents/procedural-steps-after/x-archive_en.pdf"), title: `${current.title} (archive)` };
  const [group] = groupDocuments([archive, current]);
  assert.deepEqual(group.rows.map((row) => [row.title === current.title, row.archive]), [[true, false], [false, true]]);
});

test("the newest SmPC and the standard EPAR become the primary links; everything else stays in the list", () => {
  const groups = groupDocuments([
    doc("product-information", "2026-09-03"),
    { ...doc("assessment-report", "2008-04-17"), title: "Mylotarg : EPAR - Refusal public assessment report" },
    { ...doc("assessment-report", "2018-05-04"), title: "Mylotarg : EPAR - Public Assessment Report" },
    doc("overview", "2025-01-01"),
  ]);
  const { primary, rest } = primaryDocuments(groups);
  assert.deepEqual(primary.map(({ key, row }) => [key, row.last_updated_date]), [["productInformation", "2026-09-03"], ["epar", "2018-05-04"]]);
  assert.deepEqual(rest.map((group) => [group.key, group.rows.map((row) => row.last_updated_date)]), [["epar", ["2008-04-17"]], ["overview", ["2025-01-01"]]]);
});

test("archive files and non-standard assessment reports are never primary links", () => {
  const current = { ...doc("product-information", "2026-06-05"), title: "X : EPAR - Product information" };
  const archive = { ...doc("product-information", "2026-06-06", "https://www.ema.europa.eu/en/documents/product-information/x-archive_en.pdf"), title: `${current.title} (archive)` };
  const referral = { ...doc("assessment-report", "2014-10-03"), title: "Kinzalkomb-H-C-415-A31-0084 : EPAR - Assessment Report - Article 31" };
  const { primary, rest } = primaryDocuments(groupDocuments([archive, current, referral]));
  assert.deepEqual(primary.map(({ row }) => row.title), [current.title]);
  assert.deepEqual(rest.map((group) => [group.key, group.rows.map((row) => row.title)]), [["productInformation", [archive.title]], ["epar", [referral.title]]]);
  assert.deepEqual(primaryDocuments([]), { primary: [], rest: [] });
});

test("quick links: the URLs of the primary SmPC and EPAR, each only when EMA lists one", () => {
  const pi = doc("product-information", "2026-09-03");
  const epar = { ...doc("assessment-report", "2018-05-04"), title: "Wegovy : EPAR - Public assessment report" };
  const refusal = { ...doc("assessment-report", "2008-04-17"), title: "Mylotarg : EPAR - Refusal public assessment report" };
  assert.deepEqual(quickDocuments([doc("overview", "2025-01-01"), epar, pi]), { productInformation: pi.url, epar: epar.url });
  assert.deepEqual(quickDocuments([pi, refusal]), { productInformation: pi.url });
  assert.deepEqual(quickDocuments([{ ...pi, url: "http://example.org/a.pdf" }]), {});
  assert.deepEqual(quickDocuments([]), {});
});

// EMA's index can list an authorized namesake's documents under a medicine that was never
// authorized (Mylotarg EMEA/H/C/000705, refused, gets 004204's product information and EPAR).
test("a medicine never authorized has no product information link; a refused one's EPAR is its refusal report", () => {
  const pi = doc("product-information", "2026-09-03");
  const epar = { ...doc("assessment-report", "2018-05-04"), title: "Mylotarg : EPAR - Public Assessment Report" };
  const refusal = { ...doc("assessment-report", "2008-04-17"), title: "Mylotarg : EPAR - Refusal public assessment report" };
  const withdrawal = { ...doc("assessment-report", "2010-03-31"), title: "Withdrawal assessment report" };
  assert.deepEqual(quickDocuments([pi, epar, refusal], "Refused"), { epar: refusal.url });
  // Older refusal EPARs carry the standard title (Kynamro, EMEA/H/C/002429).
  assert.deepEqual(quickDocuments([epar], "Refused"), { epar: epar.url });
  for (const status of ["Application withdrawn", "Withdrawn from rolling review", "Opinion", "Opinion under re-examination"]) {
    assert.deepEqual(quickDocuments([pi, epar, withdrawal], status), {}, status);
  }
  // Authorized and ended medicines keep both links.
  for (const status of ["Authorised", "Withdrawn", "Expired", undefined]) {
    assert.deepEqual(quickDocuments([pi, epar, refusal], status), { productInformation: pi.url, epar: epar.url }, status);
  }
  // The medicine card: the same buttons; every document stays in the list.
  const { primary, rest } = primaryDocuments(groupDocuments([pi, epar, refusal]), "Refused");
  assert.deepEqual(primary.map(({ key, row }) => [key, row.title]), [["epar", refusal.title]]);
  assert.deepEqual(rest.map((group) => [group.key, group.rows.map((row) => row.title)]), [["productInformation", [pi.title]], ["epar", [epar.title]]]);
});

test("only https links survive; unknown types are ignored", () => {
  const groups = groupDocuments([
    doc("product-information", "2020-01-01", "javascript:alert(1)"),
    doc("product-information", "2020-01-02", "http://example.org/a.pdf"),
    doc("pip-compliance", "2020-01-03"),
  ]);
  assert.deepEqual(groups, []);
});

// Phase 4c review: EMA lists the authorized Mylotarg's documents (EMEA/H/C/004204, approved
// 2018-04-19) under the refused one (EMEA/H/C/000705, refused 2008): those first published on or
// after the namesake's approval are the namesake's.
test("documents first published from a namesake's approval on are the namesake's", () => {
  const refusal = { ...doc("assessment-report", "2008-04-17"), title: "Mylotarg : EPAR - Refusal public assessment report" };
  const pi = { ...doc("product-information", "2025-09-17"), first_published_date: "2018-05-04" };
  const epar = doc("assessment-report", "2018-05-04");
  const split = splitNamesakeDocuments([refusal, pi, epar], "2018-04-19");
  assert.deepEqual(split.own, [refusal]);
  assert.deepEqual(split.namesake, [pi, epar]);
  // No namesake approval: every document is the medicine's own.
  assert.deepEqual(splitNamesakeDocuments([refusal, pi], null), { own: [refusal, pi], namesake: [] });
});
