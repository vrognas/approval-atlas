# approval-atlas

Static site exploring approved medicines across jurisdictions. Current scope: **Milestone 1 — EMA end to end.**

## Scope
- M1: EMA medicines JSON → R pipeline → tidy JSON → one Vite + D3 page (approvals per year stacked by medicine type, status + therapeutic-area filters, table of rows).
- Do NOT start later milestones without being asked: FDA (Drugs@FDA / openFDA, Purple Book), cross-jurisdiction matching (INN/UNII), approval-lag views, map view, other regulators, sponsor-name normalisation, hosting.
- No backend, no database. Everything precomputed.

## Architecture decisions (with why)
- **Frontend: Vite + D3**, not Observable Framework. Framework is in maintenance mode (Observable, 2026-03-02: "not developing new features … recommend that users migrate to Notebook Kit"; 1 dependency-only release in 12 months). Vite 8 is very active.
- **R pipeline is independent of the frontend**: writes files into `site/public/data/`; the frontend only reads them.
- **JSON, not Parquet**: at ~2.4k rows formats differ by <100 KB gz; JSON needs no JS library. Revisit at the FDA milestone.
- **EMA column names kept verbatim** (traceability; "holder" field also holds applicants, "INN" field holds common names). Only derived column: `medicine_type`. Harmonised names belong to a later cross-jurisdiction layer.
- **Approval date = `marketing_authorisation_date`.** `european_commission_decision_date` is the latest EC decision of any kind (usually a variation) — never an approval date.
- **Internal R package at repo root** (DESCRIPTION + one-line NAMESPACE, never built): DESCRIPTION is renv's explicit snapshot manifest; `test_local()` / covr work. `devtools::check()` is deliberately not a gate (would require Rd docs).
- **Hosting: none yet** (repo private; GitHub Free cannot serve Pages from private repos — verified 422). Site is viewed locally. See "Hosting later".
- **No data commit-back**: `site/public/data/` is gitignored and regenerated. Revisit when public (the 60-day schedule auto-disable applies to public repos only).

## Data contract (`site/public/data/`)
JSON arrays of row objects; dates `"YYYY-MM-DD"` or `null`; flags `true/false`; missing `null` (never `""`); ids/codes strings; rows sorted by `ema_product_number` (lookups then by value) so identical input gives identical output.
- `ema_medicines.json` — one row per Human medicine; EMA columns minus `category`, the 3 vet-only columns and the 3 split fields; plus `medicine_type` (Advanced therapy > Biosimilar > Generic > Other; flags never co-occur, checked).
- `ema_medicine_therapeutic_areas.json` — `ema_product_number`, `therapeutic_area_mesh`.
- `ema_medicine_active_substances.json` — `ema_product_number`, `active_substance`.
- `ema_medicine_atc_codes.json` — `ema_product_number`, `atc_code_human` ("Not yet assigned" dropped).
- `meta.json` — `source_url`, `source_timestamp` (EMA verbatim), `row_counts`, `attribution`.
Chart population: medicines with a `marketing_authorisation_date`, any status; undated ones are counted in a note.

## EMA source facts (profiled 2026-09-26)
- URL: `https://www.ema.europa.eu/en/documents/report/medicines-output-medicines_json-report_en.json`; regenerated twice daily (06:00 / 18:00 Amsterdam). No ETag; `Last-Modified` + If-Modified-Since work; CDN max-age 300 s.
- 39 columns, all strings, missing = `""`. 10 Yes/No flags (exactly Yes/No). 11 `dd/mm/yyyy` date fields.
- `meta.timestamp` is Amsterdam local time labelled `Z` → use only its date part.
- Text: entities `&nbsp;` `&lt;` `&gt;` only (plus truncated `&nbsp` without `;`), literal U+00A0; no HTML tags. `stringr::str_squish()` handles U+00A0 (base `trimws()` does not). 122 indications have lossy `?` for ≥/≤ upstream — unrecoverable.
- `;` fields: items contain commas (MeSH) — never split on comma. ATC has placeholders ("Not yet assigned") and L2–L4 codes.
- Quirks kept as-is: 6 "Authorised" without MA date, 2 "Application withdrawn" with one; sponsor names are dirty (712 raw → 661 normalised).
- Reuse terms (EMA legal notice): EMA must be acknowledged as the source in every copy; EMA logo prohibited; don't imply endorsement. Code is MIT; data is © EMA (not MIT).

## R conventions
- tidyverse / r-lib; always `package::function()`; no `library()`.
- `purrr::map()` + `purrr::list_rbind()`, never `map_dfr()`. `dplyr::case_when()` with `.default =`.
- `\(x)` only for one-liners, never in pipes; `function()` for anything multi-line.
- Descriptive unabbreviated names; small single-purpose functions; comments only for the "why".
- Loud failures via `cli::cli_abort()` listing offenders. Dependencies via renv (`snapshot.type = "explicit"`, `snapshot.dev = TRUE`; lockfile repo = dated Posit Package Manager snapshot; on CI `setup-r` overrides it with P3M `latest` Linux binaries — versions stay pinned by `renv.lock`).
- Tests: testthat 3e, fixture of real records in `tests/testthat/fixtures/`; no network in tests. Coverage ≥ 80% overall, 100% for `R/validate-ema.R`.

## Commands
```sh
Rscript scripts/run-pipeline.R                       # fetch (24 h cache in .cache/; delete to force) → validate → write site/public/data
Rscript -e "testthat::test_local()"
Rscript -e "covr::package_coverage()"
Rscript -e "pkgload::load_all(quiet = TRUE); lintr::lint_package()"
npm ci && npm run dev                                 # http://localhost:5173 (needs pipeline output first)
npm test && npm run build                             # output: site/dist
```
Node: CI uses 24 (switch to 26 once LTS, 2026-10-28).

## CI (`.github/workflows/pipeline.yml`)
Daily 06:37 UTC + manual + push to main: lint → R tests → pipeline on live EMA data → npm test → build. No deploy, no secrets, `contents: read`. Failures email whoever last edited the cron line (enable GitHub Settings → Notifications → Actions → "Only notify for failed workflows").

## Hosting later (when the repo goes public)
Target: `approval-atlas.vrognas.com` on GitHub Pages (site served from `/`). DNS is Netlify DNS (NS1).
1. Verify `vrognas.com` in GitHub account Settings → Pages (TXT `_github-pages-challenge-vrognas` in Netlify DNS).
2. `gh api -X POST repos/vrognas/approval-atlas/pages -f build_type=workflow`; set custom domain in Settings → Pages (no CNAME file needed with Actions).
3. Netlify DNS: CNAME `approval-atlas` → `vrognas.github.io` — must be a CNAME, not A records (apex CAA only allows Netlify's Let's Encrypt account; `vrognas.github.io` publishes its own CAA).
4. Enforce HTTPS once the certificate is issued.
5. Add upload-pages-artifact@v5 + deploy-pages@v5 job (`pages: write`, `id-token: write`, `environment: github-pages`); consider committing data back so the schedule stays active (60-day rule).
