import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { UI } from "./labels.js";
import { destinationOf, isWebLink } from "./links.js";

test("an external link's destination is named by its host, an unknown host by itself", () => {
  assert.deepEqual(destinationOf("https://www.ema.europa.eu/en/medicines/human/EPAR/keytruda"), { name: "EMA website", host: "www.ema.europa.eu" });
  assert.deepEqual(destinationOf("https://ec.europa.eu/health/documents/community-register/html/h1005.htm"), {
    name: "European Commission website",
    host: "ec.europa.eu",
  });
  assert.deepEqual(destinationOf("https://worldwide.espacenet.com/patent/search?q=pembrolizumab"), { name: "Espacenet", host: "worldwide.espacenet.com" });
  assert.deepEqual(destinationOf("https://example.org/page"), { name: "example.org", host: "example.org" });
});

// The evidence of the companies' ownership, sponsor and group notes (hosts in companies.json and
// ema_medicine_companies.json on 2026-09-28): newswires, registries and the companies' own sites.
test("evidence links of company notes name their destination", () => {
  const name = (url) => destinationOf(url).name;
  assert.equal(name("https://www.prnewswire.com/news-releases/theramex-acquires-commercial-rights-for-oral-contraceptive-zoely-300990650.html"), "PR Newswire");
  assert.equal(name("https://www.globenewswire.com/news-release/2018/09/25/1576003/0/en/x.html"), "GlobeNewswire");
  assert.equal(name("https://www.businesswire.com/news/home/20240101005001/en/"), "Business Wire");
  assert.equal(name("https://clinicaltrials.gov/study/NCT00679731"), "ClinicalTrials.gov");
  assert.equal(name("https://www.nasdaq.com/press-release/x"), "Nasdaq website");
  assert.equal(name("https://www.biospace.com/x"), "BioSpace");
  assert.equal(name("https://www.ansa.it/sito/notizie/x.html"), "ANSA website");
  assert.equal(name("https://johnsonandjohnson.gcs-web.com/news-releases/x"), "Johnson & Johnson website");
  assert.equal(name("https://ir.orchard-tx.com/news-releases/x"), "Orchard Therapeutics website");
  assert.equal(name("https://www.essonne.fr/fileadmin/x.pdf"), "Essonne department website");
  assert.equal(name("https://english.autoriteitnvs.nl/latest/news/2024/11/12/x"), "ANVS website");
  assert.equal(name("https://www.indiaratings.co.in/Uploads/x.pdf"), "India Ratings website");
  assert.equal(name("https://www.teva.de/x.html"), "Teva Germany website");
  // The tooltip names the host after the destination.
  assert.deepEqual(destinationOf("https://www.gsk.com/en-gb/media/x/"), { name: "GSK website", host: "www.gsk.com" });
});

// A medicine's modality source (M2 phase 2): its ChEMBL record, a curated row's evidence.
test("modality sources name their destination", () => {
  assert.equal(destinationOf("https://www.ebi.ac.uk/chembl/explore/compound/CHEMBL941").name, "ChEMBL website");
  assert.equal(destinationOf("https://pubmed.ncbi.nlm.nih.gov/38142486/").name, "PubMed");
});

// Links there are marked by main.js (markExternal()); the markup must already be safe. Since the
// legal review of 2026-09-30 the footer's links are built from labels.js (next test), so index.html
// may hold none.
test("index.html links to other websites only over https, in a new tab, without opener or referrer", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  // Same-site links (the wordmark's "/", phase 4c review; the dashboard's tabs and the Overview's
  // links to them, "?tab=…", F · Spacious, phase 2) stay in the tab.
  const anchors = (html.match(/<a\s[^>]*>/g) ?? []).filter((anchor) => !/href="[/?]/.test(anchor));
  for (const anchor of anchors) {
    assert.match(anchor, /href="https:\/\//, anchor);
    assert.match(anchor, /target="_blank"/, anchor);
    assert.match(anchor, /rel="noopener noreferrer"/, anchor);
  }
});

// A mailto: link (the operator's email, owner decision 2026-09-30) is no other website: main.js
// appendParts() opens it in place, without the new-tab note or icon.
test("only https links count as other websites; an email link does not", () => {
  assert.equal(isWebLink("https://www.ema.europa.eu/en"), true);
  assert.equal(isWebLink("mailto:viktor@vrognas.com"), false);
  assert.equal(isWebLink("http://example.org/"), false);
});

// The footer's and About's links (main.js renderFooter(): new tab, noopener noreferrer,
// markExternal()): https only, each destination named (doi.org by the article it opens); besides
// them only the operator's email, as a mailto: link, in the footer and About's contact.
test("the footer's and About's links are https and name their destination, or the operator's email", () => {
  const credits = { date: "2026-09-29", mesh: "MeSH 2026", chembl: "ChEMBL_37", explained: true, innStems: true };
  const { footer, about } = UI;
  const parts = [...footer.sources(credits), ...footer.licence, ...about.sources(credits).flat(), ...about.contact];
  const urls = parts.filter((part) => typeof part !== "string").map((part) => part.url);
  assert.ok(urls.length >= 15);
  const emails = urls.filter((url) => !isWebLink(url));
  assert.deepEqual(emails, ["mailto:viktor@vrognas.com", "mailto:viktor@vrognas.com"]);
  for (const url of urls.filter(isWebLink)) {
    assert.match(url, /^https:\/\//, url);
    assert.notEqual(destinationOf(url).name, destinationOf(url).host, url);
  }
});
