# approval-atlas
Cross-jurisdiction explorer of approved medicines: approval dates, sponsors, therapeutic areas and drug classes across EMA, FDA and other regulators, built from official public data.

**Status:** EMA (European Medicines Agency) human medicines only; Milestone 2 (enrichment, lifecycle events, MAH map) in progress. FDA and other regulators are planned.

## Run locally
Requires R (with [renv](https://rstudio.github.io/renv/)) and Node.js 24+.

```sh
Rscript -e "renv::restore()"       # once
Rscript scripts/run-pipeline.R      # download EMA, MeSH (~313 MB unpacked, first run) and ChEMBL ATC data, validate, write site/public/data/
npm ci
npm run dev                         # open the printed localhost URL
```

Tests: `Rscript -e "testthat::test_local()"` and `npm test`.

## Data sources and licences
| Source | Used for | Terms | Credit |
|---|---|---|---|
| [European Medicines Agency](https://www.ema.europa.eu/en/medicines/download-medicine-data) — medicines data | medicines, dates, status, holders, therapeutic areas (MeSH headings), ATC codes as published, EPAR document links, orphan designations | © EMA; reuse allowed if EMA is acknowledged as the source in every copy; no EMA logo ([legal notice](https://www.ema.europa.eu/en/about-us/legal-notice)) | Source: European Medicines Agency |
| [European Commission — Union Register of medicinal products](https://ec.europa.eu/health/documents/community-register/) | orphan market exclusivity and EU register status cross-check (phase 1b); MAH country (phase 4) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (Commission Decision 2011/833/EU) | © European Union, Union Register of medicinal products, CC BY 4.0; changes made |
| [MeSH](https://www.nlm.nih.gov/mesh/) (year shown in the site footer), U.S. National Library of Medicine | top-level tree branch of each therapeutic area | [NLM terms](https://www.nlm.nih.gov/databases/download/terms_and_conditions_mesh.html): acknowledge NLM, no endorsement, state the version | MeSH® courtesy of the U.S. National Library of Medicine |
| [ChEMBL](https://www.ebi.ac.uk/chembl) (release shown in the site footer), EMBL-EBI | ATC classification table (phase 2 adds modality, mechanism, ATC cleanup) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | ChEMBL data is from https://www.ebi.ac.uk/chembl; Mendez D. et al., *Nucleic Acids Res.* 2019;47(D1):D930–D940, doi:10.1093/nar/gky1075 |
| WHO ATC classification (via ChEMBL) | ATC level names | © WHO Collaborating Centre for Drug Statistics Methodology: no commercial distribution, no modification ([copyright](https://atcddd.fhi.no/copyright_disclaimer/)) | ATC classification © WHOCC, Oslo — names reproduced verbatim in the data and excluded from our data licence; level-1 names displayed in title case on the site |

- **Data files** (`site/public/data/`): a compilation licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). ChEMBL-derived values are adapted from ChEMBL (CC BY-SA 3.0) and modified (selected and mapped). Values from other sources are not relicensed and keep their own terms (table above).
- **Code**: MIT (see `LICENSE`). The MIT licence does not cover any data.
- **Regulatory-protection dates** are not legal advice: data exclusivity and market protection are estimates computed by this project from EU authorization dates; orphan market exclusivity ends at the Union Register's end date or, without one, its link date + 10 years + extension. **Patents and supplementary protection certificates are not included**: no open EU-wide source exists.
- This project is not affiliated with or endorsed by EMA, the European Commission, EMBL-EBI, WHO or NLM.
