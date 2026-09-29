import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { buildProducts, countTiles, isAuthorizedNow, newestFirst } from "./approvals.js";
import { buildAreaTree } from "./areas.js";
import { atcExactCounts, atcPrefixCounts } from "./atc.js";
import { buildCompanies } from "./companies.js";
import { FACET_VALUES, facetCounts, keyCounts, yearHistogram } from "./facets.js";
import { filterProducts, makePredicates } from "./filters.js";
import { buildModalityTree } from "./modalities.js";
import { topGroups } from "./overview-previews.js";
import { DEFAULT_STATE } from "./url.js";

const dataDir = new URL("../public/data/", import.meta.url);
const read = (file) => JSON.parse(readFileSync(new URL(file, dataDir), "utf8"));

// Doherty Threshold (F · Spacious, phase 2): a filter change re-renders under 400 ms. The DOM part
// is measured in the browser (AGENTS.md, "Tabs"); this measures the data part every tab shares
// (main.js renderDashboard(): the chips' and headline's counts, the popovers' facet counts, the
// medicines shown), on the real data, with most of the budget left for the DOM.
const DATA_BUDGET_MS = 150;

test(
  "a filter change's shared data work stays well within the 400 ms render budget on the real data",
  { skip: existsSync(new URL("ema_medicines.json", dataDir)) ? false : "site/public/data not found: run the pipeline first" },
  (t) => {
    const areaTree = buildAreaTree(read("ema_therapeutic_area_branches.json"), read("ema_therapeutic_area_subtree.json"));
    const companies = buildCompanies(read("companies.json"), read("ema_medicine_companies.json"));
    const modalityTaxonomy = existsSync(new URL("modalities.json", dataDir)) ? read("modalities.json") : null;
    const modalityTree = modalityTaxonomy ? buildModalityTree(modalityTaxonomy) : null;
    const atcClasses = read("atc_classes.json");
    const products = buildProducts(read("ema_medicines.json"), {
      areaRows: read("ema_medicine_therapeutic_areas.json"),
      branchRows: read("ema_therapeutic_area_branches.json"),
      atcRows: read("ema_medicine_atc_codes.json"),
      companyRows: read("ema_medicine_companies.json"),
      areaTree,
      modalityRows: modalityTree ? read("ema_medicine_modalities.json") : [],
      modalityTree,
    });
    const years = [Math.min(...products.map((p) => p.year ?? Infinity)), Math.max(...products.map((p) => p.year ?? -Infinity))];
    const change = (state) => {
      const predicates = makePredicates(state, atcClasses);
      for (const dimension of ["type", "status"]) facetCounts(products, predicates, dimension, FACET_VALUES[dimension]);
      yearHistogram(products, predicates, years);
      const withoutAtc = filterProducts(products, predicates, "atc");
      atcPrefixCounts(withoutAtc);
      atcExactCounts(withoutAtc);
      keyCounts(filterProducts(products, predicates, "area"), (product) => product.areaKeys);
      keyCounts(filterProducts(products, predicates, "mah"), companies.countKeys);
      keyCounts(filterProducts(products, predicates, "mod"), (product) => product.modalityKeys);
      const filtered = filterProducts(products, predicates, "date");
      filterProducts(products, predicates, "status");
      filtered.filter(isAuthorizedNow);
      countTiles(filtered);
      topGroups(filtered);
      return newestFirst(filtered);
    };
    const states = [
      { ...structuredClone(DEFAULT_STATE) },
      { ...structuredClone(DEFAULT_STATE), type: ["Biosimilar"] },
      { ...structuredClone(DEFAULT_STATE), status: [] },
      { ...structuredClone(DEFAULT_STATE), atc: ["L"], area: ["C04"] },
    ];
    change(states[0]); // warm up
    const times = states.map((state) => {
      const start = performance.now();
      change(state);
      return performance.now() - start;
    });
    t.diagnostic(`data work per filter change: ${times.map((time) => time.toFixed(1)).join(", ")} ms`);
    assert.ok(Math.max(...times) < DATA_BUDGET_MS, `data work per filter change: ${times.map((time) => time.toFixed(1)).join(", ")} ms`);
  },
);
