# approval-atlas
Cross-jurisdiction explorer of approved medicines: approval dates, sponsors, therapeutic areas and drug classes across EMA, FDA and other regulators, built from official public data.

**Status:** EMA (European Medicines Agency) human medicines only; Milestone 2 (enrichment, lifecycle events, MAH map) in progress. FDA and other regulators are planned.

**Site:** https://approval-atlas.vrognas.com

## Run locally
Requires Node.js 24+. R (with [renv](https://rstudio.github.io/renv/)) is needed only to regenerate the data: CI refreshes `site/public/data/` daily and commits changes.

```sh
npm ci
npm run dev                         # open the printed localhost URL

# Optional: regenerate the data (don't commit it by hand; `git restore site/public/data`)
Rscript -e "renv::restore()"       # once
Rscript scripts/run-pipeline.R      # download EMA, MeSH (~313 MB unpacked, first run), ChEMBL and WHOCC ATC data, validate, write site/public/data/
```

Each run also reads up to 8 EMA product information PDFs (20 s apart) to complete incomplete or missing ATC codes; set `APPROVAL_ATLAS_SMPC_BUDGET` to change that number (`0` reads none). The results are kept in `.cache/downloads/ema-smpc/checks.json` and `site/public/data/ema_medicine_smpc_atc.json`, so a document is read again only when EMA updates it (or when an improved reader could find a code an older one missed: `smpc_reader_version` in `R/smpc-atc.R`). PDF text needs `pdftools` (on Linux: `libpoppler-cpp-dev`). Codes still incomplete after that can come from a hand-checked table, `curated_atc_codes()` in `R/curated-atc-codes.R`, each with its evidence.

Tests: `Rscript -e "testthat::test_local()"` and `npm test`.

## Security and privacy
Report vulnerabilities as described in [SECURITY.md](SECURITY.md). Self-assessment against the Minimum Viable Secure Product checklist: [docs/mvsp.md](docs/mvsp.md). The site sets no cookies and has no analytics; see "About this site" in its footer.

## Data sources and licences
| Source | Used for | Terms | Credit |
|---|---|---|---|
| [European Medicines Agency](https://www.ema.europa.eu/en/medicines/download-medicine-data) — medicines data | medicines, dates, status, holders, therapeutic areas (MeSH headings), ATC codes as published, EPAR document links, orphan designations; ATC codes read from section 5.1 of the product information (SmPC) where EMA's published code is incomplete or missing | © EMA; reuse allowed if EMA is acknowledged as the source in every copy; no EMA logo ([legal notice](https://www.ema.europa.eu/en/about-us/legal-notice)) | Source: European Medicines Agency |
| [European Commission — Union Register of medicinal products](https://ec.europa.eu/health/documents/community-register/) | orphan market exclusivity and EU register status cross-check (phase 1b); the marketing authorisation holder where it differs from EMA's (transfers, renames) and the holder's country (from its address, which is not stored) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (Commission Decision 2011/833/EU) | © European Union, Union Register of medicinal products, CC BY 4.0; changes made |
| [GLEIF](https://www.gleif.org/) Legal Entity Identifier records ([API](https://api.gleif.org/api/v1/lei-records)), matched to holder names on demand (`scripts/match-gleif.R`; results in `data-raw/gleif-holder-matches.json`; the date of the oldest LEI response used in `meta.json`) | LEI, legal name and ultimate parent of holders (provenance; a company group is the operating company, curated in `R/curated-companies.R`) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) ([terms](https://www.gleif.org/en/meta/lei-data-terms-of-use)) | Contains LEI data from GLEIF (CC0); GLEIF does not provide or endorse this site |
| Company groups, curated by this project (`R/curated-companies.R`) | the current owner of each holder (as of the date in `meta.json`): acquisitions, spin-offs and joint ventures, each ownership change with a note | Part of the data compilation (CC BY-SA 4.0) | Company groups curated by approval-atlas from company announcements, the Union Register and GLEIF |
| [MeSH](https://www.nlm.nih.gov/mesh/) (year shown in the site footer), U.S. National Library of Medicine | top-level tree branch and sub-areas (tree levels 2 and 3) of each therapeutic area | [NLM terms](https://www.nlm.nih.gov/databases/download/terms_and_conditions_mesh.html): acknowledge NLM, no endorsement, state the version | MeSH® courtesy of the U.S. National Library of Medicine |
| [ChEMBL](https://www.ebi.ac.uk/chembl) (release shown in the site footer), EMBL-EBI | ATC classification table (phase 2 adds modality, mechanism, ATC cleanup) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | ChEMBL data is from https://www.ebi.ac.uk/chembl; Mendez D. et al., *Nucleic Acids Res.* 2019;47(D1):D930–D940, doi:10.1093/nar/gky1075 |
| WHO ATC classification, WHO Collaborating Centre for Drug Statistics Methodology (WHOCC), Oslo: via ChEMBL; the [ATC/DDD Index](https://atcddd.fhi.no/atc_ddd_index/) (yearly and temporary update lists, [cumulative ATC alterations](https://atcddd.fhi.no/atc_ddd_alterations__cumulative/atc_alterations/), single index pages for codes ChEMBL lacks); archived copies of the 2020 index ([Internet Archive](https://web.archive.org/)) for the retired groups L01XC and L01XE | ATC level names (WHO's where ChEMBL's differ: the yearly lists' renamed codes and a few names checked by hand against the index; else ChEMBL's, then other WHOCC sources); status of each code (current, retired, temporary) and the code that replaced a retired one; ATC codes checked by hand against the index and the temporary list for medicines whose EMA code is incomplete | © WHOCC: use requires reference to the WHOCC; no commercial distribution, no modification ([copyright](https://atcddd.fhi.no/copyright_disclaimer/)) | ATC classification © WHOCC, Oslo — codes and names reproduced verbatim in the data and excluded from our data licence; names displayed in Title Case on the site |

- **Data files** (`site/public/data/`): a compilation licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). ChEMBL-derived values are adapted from ChEMBL (CC BY-SA 3.0) and modified (selected and mapped). Values from other sources are not relicensed and keep their own terms (table above).
- **Code**: MIT (see `LICENSE`). The MIT licence does not cover any data.
- **Fonts**: Geist and Geist Mono © 2024 The Geist Project Authors, [SIL Open Font License 1.1](https://openfontlicense.org), bundled from `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` (licence text in each package's `LICENSE`).
- **Test fixtures** (`tests/testthat/fixtures/`, except `fold-cases.json`) are excerpts of EMA data (Source: European Medicines Agency), the Union Register (© European Union, CC BY 4.0), MeSH 2026 (courtesy of the U.S. National Library of Medicine), ChEMBL ([CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/); ATC names © WHOCC, verbatim), the WHOCC ATC/DDD Index site (`whocc-*`: update lists, alterations and index pages, © WHOCC, verbatim) and GLEIF LEI records (`gleif-*`, CC0); they keep those terms and are not MIT-licensed.
- **Company groups** name the current owner of each holder as of the date shown; they are not an ownership history. EMA's holder name stays with every medicine. Holders that are regulatory service firms (representatives) are shown as such until the sponsor behind a medicine has been checked by hand.
- **Regulatory-protection dates** are not legal advice: data exclusivity and market protection are estimates computed by this project from EU authorization dates; orphan market exclusivity ends at the Union Register's end date or, without one, its link date + 10 years + extension. **Patents and supplementary protection certificates are not included**: no open EU-wide source exists.
- This project is not affiliated with or endorsed by EMA, the European Commission, EMBL-EBI, WHO, NLM or GLEIF.
