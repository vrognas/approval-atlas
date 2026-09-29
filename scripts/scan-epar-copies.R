# On demand, never in CI: reads the EPAR page of each Authorised medicine
# the protection estimate counts as its own and protected (at most
# APPROVAL_ATLAS_EPAR_BUDGET pages per run, default 30, 20 s apart; cached in
# .cache/downloads/ema-epar-copies so a rerun resumes) and lists the pages
# that call it a hybrid, generic or biosimilar medicine. Reads the data files
# a pipeline run wrote; changes nothing. Check each page by hand before
# adding a row to curated_copy_medicines() in R/curated-copies.R.
pkgload::load_all(quiet = TRUE)
run_epar_copy_scan()
