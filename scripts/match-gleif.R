# On demand, not in CI: matches every company's holder name to GLEIF LEI
# records (about 150 requests, 1.2 s apart; cached in .cache/downloads/gleif
# so a rerun resumes) and writes data-raw/gleif-holder-matches.json, which
# the daily pipeline reads. Needs the EMA and Union Register files cached by
# a pipeline run. Review the matches below 0.95 before marking them
# reviewed.
pkgload::load_all(quiet = TRUE)
run_gleif_matching()
