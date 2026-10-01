# On demand, not in CI: extracts the pivotal efficacy results of authorised
# medicines from their SmPC section 5.1 with the Claude API (Message Batches),
# verifies every row against the PDF text and writes data-raw/efficacy-rows.json
# and data-raw/efficacy-extractions.json, which the daily pipeline reads.
# Needs ANTHROPIC_API_KEY (.Renviron) and a pipeline run's cached files.
# PDFs are fetched 20 s apart; APPROVAL_ATLAS_EFFICACY_BUDGET products per run
# (default 25); reruns resume. APPROVAL_ATLAS_EFFICACY_MODEL overrides the
# model, APPROVAL_ATLAS_EFFICACY_EFFORT the effort level (low, medium, high,
# xhigh or max; default high). A product whose extraction failed for good is
# extracted again with another model or effort.
# APPROVAL_ATLAS_EFFICACY_ONLY (product numbers, comma-separated) extracts
# exactly those, even when already extracted: unset it afterwards, or every
# run extracts (and bills) them again.
pkgload::load_all(quiet = TRUE)
run_efficacy_extraction(
  model = Sys.getenv("APPROVAL_ATLAS_EFFICACY_MODEL", efficacy_default_model),
  effort = efficacy_effort_from_env()
)
