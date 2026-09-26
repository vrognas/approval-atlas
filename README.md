# approval-atlas
Cross-jurisdiction explorer of approved medicines: approval dates, sponsors, therapeutic areas and drug classes across EMA, FDA and other regulators, built from official public data.

**Status:** Milestone 1 — EMA (European Medicines Agency) human medicines only. FDA and other regulators are planned.

## Run locally
Requires R (with [renv](https://rstudio.github.io/renv/)) and Node.js 24+.

```sh
Rscript -e "renv::restore()"       # once
Rscript scripts/run-pipeline.R      # download EMA data, validate, write site/public/data/
npm ci
npm run dev                         # open the printed localhost URL
```

Tests: `Rscript -e "testthat::test_local()"` and `npm test`.

## Data source and licence
- Data: European Medicines Agency (EMA), medicines data file — <https://www.ema.europa.eu/en/medicines/download-medicine-data>. © EMA. Filtered to human medicines and reshaped. Reuse requires acknowledging EMA as the source ([EMA legal notice](https://www.ema.europa.eu/en/about-us/legal-notice)). This project is not affiliated with or endorsed by EMA.
- Code: MIT (see `LICENSE`). The MIT licence does not cover EMA data.
