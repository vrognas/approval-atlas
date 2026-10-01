# Phase A0 (a few dollars): run each model on the pilot's 18 NSCLC SmPC 5.1
# sections and score the rows against the hand-verified gold rows. Needs
# ANTHROPIC_API_KEY and the pilot's files in .remember/efficacy (run it in the
# repository that holds them: the whole product information texts
# text/<medicine>-pi.layout.txt, selection.json, nsclc-rows.json) and a
# pipeline run's ema_medicines.json. Writes .remember/efficacy/gold-eval-*.json
# and gold-eval-report.md; nothing is written outside .remember/efficacy.
#
# One Message Batch per model and effort level (a variant), as the real
# extractor runs (half the price, no request timeout; it can take up to 24
# hours, usually much less). The batch id is saved in
# .remember/efficacy/gold-pending-<variant>.json when it is created: if the
# run is stopped or gives up waiting, run the script again and it collects
# that batch instead of submitting (and paying for) a new one. A variant's
# saved result, gold-eval-<variant>.json, is read back, not asked again.
# <variant> is the model at effort high (the names of the runs before effort
# levels, so their pending batches are still collected), else
# <model>-<effort>. APPROVAL_ATLAS_GOLD_MODELS (comma list) overrides the
# models, APPROVAL_ATLAS_GOLD_EFFORTS (comma list of low, medium, high, xhigh,
# max; default high) the effort levels: every model is asked at every effort.
pkgload::load_all(quiet = TRUE)
models <- strsplit(
  Sys.getenv("APPROVAL_ATLAS_GOLD_MODELS", "claude-sonnet-5-5,claude-opus-5-5"),
  ",",
  fixed = TRUE
)[[1]]
models <- trimws(models[nzchar(trimws(models))])
# Stops on an unknown effort before any request.
efforts <- gold_efforts_from_env()
selection_path <- ".remember/efficacy/selection.json"
text_directory <- ".remember/efficacy/text"
gold_path <- ".remember/efficacy/nsclc-rows.json"
medicines_path <- "site/public/data/ema_medicines.json"
# Fails before any request when something is missing.
check_gold_inputs(c(selection_path, gold_path, medicines_path, text_directory))
invisible(claude_api_key())
run_gold_evaluation(
  models = models,
  efforts = efforts,
  selection_path = selection_path,
  text_directory = text_directory,
  gold_path = gold_path,
  output_directory = ".remember/efficacy",
  medicines_path = medicines_path
)
