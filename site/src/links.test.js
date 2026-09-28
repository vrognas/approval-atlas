import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { destinationOf } from "./links.js";

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

// Links there are marked by main.js (markExternal()); the markup must already be safe.
test("index.html links to other websites only over https, in a new tab, without opener or referrer", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  // Same-site links (the wordmark's "/", phase 4c review) stay in the tab.
  const anchors = (html.match(/<a\s[^>]*>/g) ?? []).filter((anchor) => !/href="\//.test(anchor));
  assert.ok(anchors.length >= 3);
  for (const anchor of anchors) {
    assert.match(anchor, /href="https:\/\//, anchor);
    assert.match(anchor, /target="_blank"/, anchor);
    assert.match(anchor, /rel="noopener noreferrer"/, anchor);
  }
});
