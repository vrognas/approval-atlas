# On demand, not in CI: matches every substance key the last pipeline run
# classifies (read from site/public/data) to a ChEMBL molecule by exact
# name or synonym (1.1 s apart; cached in .cache/downloads/chembl-molecules/
# <release>, so a rerun resumes and a new release refetches) and writes
# data-raw/chembl-substance-matches.json, which the daily pipeline reads for
# modality. Review ambiguous rows and variant candidates before marking
# them reviewed.
pkgload::load_all(quiet = TRUE)
run_chembl_matching()
