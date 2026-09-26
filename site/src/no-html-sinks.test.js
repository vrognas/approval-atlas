import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// Text-only DOM writes (textContent, d3 .text()) mean third-party data is never parsed as HTML.
const HTML_SINKS = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\.html\(/;

test("the HTML-sink pattern catches each forbidden API", () => {
  for (const line of ["el.innerHTML = x", "el.outerHTML = x", "el.insertAdjacentHTML('beforeend', x)", "document.write(x)", "d3.select(el).html(x)"]) {
    assert.match(line, HTML_SINKS);
  }
  assert.doesNotMatch("d3.select(el).text(x)", HTML_SINKS);
});

test("site/src never writes HTML strings into the DOM", () => {
  const folder = new URL("./", import.meta.url);
  const sources = readdirSync(folder, { recursive: true }).filter((file) => file.endsWith(".js") && !file.endsWith(".test.js"));
  assert.ok(sources.length > 10);
  const offenders = sources.flatMap((file) =>
    readFileSync(new URL(file.replaceAll("\\", "/"), folder), "utf8")
      .split("\n")
      .flatMap((line, index) => (HTML_SINKS.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [])),
  );
  assert.deepEqual(offenders, []);
});
