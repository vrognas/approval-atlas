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
