# approval-atlas

Static site exploring approved medicines across jurisdictions. Milestone 1 (EMA end to end) is done; **Milestone 2 is in progress** (phases below, each stops for review).

## Scope
- M2 phases: (1) U.S. labels, filters + URL state, MeSH branches, ATC names, "Authorized now" view, authorized-over-time series — **current**; (2) ChEMBL enrichment: modality, mechanism, ATC cleanup; (3) regulatory events from EMA "procedural steps" PDFs + Lifecycle view; (4) MAH country (Union Register) + map tab.
- Do NOT start without being asked: FDA (Drugs@FDA / openFDA, Purple Book), cross-jurisdiction matching (INN/UNII), approval-lag views, other regulators, sponsor-name normalisation / `parent_company` (MAH data is structured so it can be added later), hosting.
- No backend, no database. Everything precomputed; filters run in the browser.

## Architecture decisions (with why)
- **Frontend: Vite + D3**, not Observable Framework. Framework is in maintenance mode (Observable, 2026-03-02: "not developing new features … recommend that users migrate to Notebook Kit"). Vanilla JS modules, no UI framework.
- **R pipeline is independent of the frontend**: writes files into `site/public/data/`; the frontend only reads them.
- **JSON, not Parquet**: small data; JSON needs no JS library. Revisit when events or FDA data make files large.
- **EMA column names kept verbatim** (British spelling). Columns we derive use U.S. spelling (`authorized_from`).
- **Approval date = `marketing_authorisation_date`.** `european_commission_decision_date` is the latest EC decision of any kind — never an approval date.
- **"Authorized now" tile vs over-time series**: tile = status `Authorised` with an approval date; series = dates (`authorized_from` ≤ d < `authorized_until`). Excluded from the series (`series_exclusion`): never-authorized statuses; ended status without an end date (88 on 2026-09-26 — prefer unknown to a guess); no approval date. The build fails if the tile ≠ the series' last point (snapshot date) and lists the rows.
- **Series computed twice on purpose**: R writes the unfiltered series; the browser recomputes it from per-product intervals so filters apply; a node test asserts they match.
- **Distinct active substances** = distinct normalised INN sets (`international_non_proprietary_name_common_name`, split on `;` and on ` / ` outside parentheses — e.g. "(rdESAT-6 / rCFP-10)" is one antigen — lower-case). Salts not merged.
- **Therapeutic-area broad category** = every top-level MeSH tree branch of the matched descriptor (NLM XML; exact heading → entry term → curated → unmatched). A medicine counts in every branch it touches.
- **ATC**: EMA codes kept as published (`atc_incomplete` when not a valid level-5 code: levels 1–4, or malformed like `LX1XX02`, `VO4D` with `atc_level` null). Level names from ChEMBL's ATC table (WHOCC names, shown verbatim — a declared exception to the U.S.-spelling rule). ChEMBL cleanup of outdated/blank codes comes in phase 2.
- **Internal R package at repo root** (DESCRIPTION + one-line NAMESPACE, never built). `devtools::check()` is deliberately not a gate.
- **Hosting: none yet** (repo private; GitHub Free cannot serve Pages from private repos — verified 422). See "Hosting later".
- **No data commit-back**: `site/public/data/` is gitignored and regenerated each run.

## Conventions
- **U.S. spelling in the UI.** Raw EMA values stay unchanged in data files; `site/src/labels.js` is the single map from raw values and UI copy to display text. A test rejects "authoris…" in UI text.
- **Provenance**: every enriched value (ATC, therapeutic-area branch; later modality, events, MAH country) has a `source` column.
- **Caching**: external downloads live in `.cache/` (gitignored); per-source files in `.cache/downloads/<source>/`, refetched only when the source changes (MeSH: Last-Modified; ChEMBL: release). EMA medicines JSON: 24 h. Requests are throttled per host (`R/http.R`: `req_throttle(capacity = 1, …)`, no retry on 429).
- **Licensing**: code MIT. Data files: compilation CC BY-SA 4.0 (ChEMBL-derived values adapted from CC BY-SA 3.0); third-party values keep their own terms (see README). Credit every source in the footer and README.

## Data contract (`site/public/data/`)
JSON arrays of row objects; dates `"YYYY-MM-DD"` or `null`; flags `true/false`; missing `null` (never `""`); ids/codes strings; rows sorted (by `ema_product_number`, lookups then by value) so identical input gives identical output.
- `ema_medicines.json` — one row per Human medicine; EMA columns minus `category`, the 3 vet-only columns and the 3 split fields; derived: `medicine_type` (Advanced therapy > Biosimilar > Generic > Other), `authorized_from`, `authorized_until`, `series_exclusion`, `substance_set_key`.
- `ema_medicine_therapeutic_areas.json` — `ema_product_number`, `therapeutic_area_mesh`.
- `ema_therapeutic_area_branches.json` — `therapeutic_area_mesh`, `mesh_descriptor_ui`, `mesh_descriptor_name`, `branch`, `branch_name`, `source`.
- `ema_medicine_active_substances.json` — `ema_product_number`, `active_substance` (EMA field).
- `ema_medicine_substances.json` — `ema_product_number`, `substance`, `substance_key` (from the INN field).
- `ema_medicine_atc_codes.json` — `ema_product_number`, `atc_code_human`, `atc_level`, `atc_incomplete`, `source` ("Not yet assigned" dropped).
- `atc_classes.json` — `atc_code`, `level`, `name` (verbatim), `source`.
- `ema_authorized_series.json` — `date` (month-ends from 1995-01-31, then the snapshot date), `authorized_products`, `authorized_substances`.
- `meta.json` — `source_url`, `source_timestamp` (EMA verbatim), `snapshot_date`, `row_counts`, `attribution`, `sources` (name, url, version, retrieved, licence, attribution), `licence`.

## EMA source facts (profiled 2026-09-26)
- Medicines JSON regenerated twice daily (06:00 / 18:00 Amsterdam); no ETag; If-Modified-Since works. `meta.timestamp` is Amsterdam local time labelled `Z` → use only its date part.
- EMA rate-limits: HTTP 429 after roughly 9–46 requests at 1–2 s spacing. Any per-product EMA fetching must be slow, budgeted and resumable.
- 39 columns, all strings, missing = `""`. 10 Yes/No flags. 11 `dd/mm/yyyy` date fields.
- Text: entities `&nbsp;` `&lt;` `&gt;` only (plus truncated `&nbsp`), literal U+00A0; no HTML tags. 122 indications have lossy `?` for ≥/≤ upstream.
- `;` fields: items contain commas (MeSH) — never split on comma. ATC: placeholders, L2–L4 codes, 2 malformed (`LX1XX02`, `VO4D`).
- Date gaps: 85 Withdrawn + Expired/Lapsed/Suspended rows without an end date; 6 Authorised without MA date; Xevudy end date < MA date; Enzepi's suspension date is really a withdrawal date.
- Reuse terms (EMA legal notice): acknowledge EMA as the source in every copy; no EMA logo; don't imply endorsement.
- IRIS-era procedure numbers (`VR/…`) have no II/IA/IB/X prefix.

## Other sources
- MeSH: `https://nlmpubs.nlm.nih.gov/projects/mesh/MESH_FILES/xmlmesh/desc{YYYY}.gz` (ASCII discontinued 2026; year detected from the listing; new year ~December). NLM terms: acknowledge NLM, no endorsement, state the MeSH version.
- ChEMBL API `https://www.ebi.ac.uk/chembl/api/data/` (release from `status.json`; CHEMBL_37 on 2026-05-01). CC BY-SA 3.0; cite Mendez et al. 2019 (per ChEMBL's REQUIRED.ATTRIBUTION); keep ChEMBL IDs and show the release.
- WHO ATC names (via ChEMBL): © WHOCC — no commercial distribution, no modification → verbatim, excluded from our licence.

## R conventions
- tidyverse / r-lib; always `package::function()`; no `library()`.
- `purrr::map()` + `purrr::list_rbind()`, never `map_dfr()`. `dplyr::case_when()` with `.default =`.
- `\(x)` only for one-liners, never in pipes; `function()` for anything multi-line.
- Descriptive unabbreviated names; small single-purpose functions; comments only for the "why".
- Loud failures via `cli::cli_abort()` listing offenders. Dependencies via renv (`snapshot.type = "explicit"`, `snapshot.dev = TRUE`; lockfile repo = dated Posit Package Manager snapshot; on CI `setup-r` overrides it with P3M `latest` Linux binaries — versions stay pinned by `renv.lock`).
- Tests: testthat 3e, fixtures of real records in `tests/testthat/fixtures/`; no network in tests. Coverage ≥ 80% overall, 100% for `R/validate-ema.R`.

## Commands
```sh
Rscript scripts/run-pipeline.R                       # fetch (cached) → validate → write site/public/data
Rscript -e "testthat::test_local()"
Rscript -e "covr::package_coverage()"
Rscript -e "pkgload::load_all(quiet = TRUE); lintr::lint_package()"
npm ci && npm run dev                                 # http://localhost:5173 (needs pipeline output first)
npm test && npm run build                             # output: site/dist
```
Node: CI uses 24 (switch to 26 once LTS, 2026-10-28). First MeSH download is ~17 MB (313 MB unpacked on disk; parse peaks ~1.9 GB RAM).

## CI (`.github/workflows/pipeline.yml`)
Daily 06:37 UTC + manual + push to main: lint → R tests → pipeline on live data → npm test → build. One run at a time (`concurrency: pipeline`), 120 min timeout. `.cache/downloads` persists between runs via actions/cache (rolling key `downloads-v1-…`, saved even on failure; bump `v1` to force a refetch). No deploy, no secrets, `contents: read`. Failures email whoever last edited the cron line (enable GitHub Settings → Notifications → Actions → "Only notify for failed workflows").

## Hosting later (when the repo goes public)
Target: `approval-atlas.vrognas.com` on GitHub Pages (site served from `/`). DNS is Netlify DNS (NS1).
1. Verify `vrognas.com` in GitHub account Settings → Pages (TXT `_github-pages-challenge-vrognas` in Netlify DNS).
2. `gh api -X POST repos/vrognas/approval-atlas/pages -f build_type=workflow`; set custom domain in Settings → Pages (no CNAME file needed with Actions).
3. Netlify DNS: CNAME `approval-atlas` → `vrognas.github.io` — must be a CNAME, not A records (apex CAA only allows Netlify's Let's Encrypt account; `vrognas.github.io` publishes its own CAA).
4. Enforce HTTPS once the certificate is issued.
5. Add upload-pages-artifact@v5 + deploy-pages@v5 job (`pages: write`, `id-token: write`, `environment: github-pages`); consider committing data back so the schedule stays active (60-day rule).
