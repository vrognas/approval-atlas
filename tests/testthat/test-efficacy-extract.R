medicines_sample <- function() {
  dplyr::tibble(
    ema_product_number = c(
      "EMEA/H/C/004164", "EMEA/H/C/005522", "EMEA/H/C/000001"
    ),
    name_of_medicine = c("Alecensa", "Lumykras", "Oldone"),
    medicine_status = c("Authorised", "Authorised", "Withdrawn"),
    therapeutic_indication = c("ALK-positive NSCLC …", "KRAS G12C NSCLC …", "…")
  )
}

documents_sample <- function(alecensa_date = as.Date("2026-03-31")) {
  dplyr::tibble(
    ema_product_number = c(
      "EMEA/H/C/004164", "EMEA/H/C/005522", "EMEA/H/C/000001"
    ),
    document_type = "product-information",
    url = paste0("https://www.ema.europa.eu/pi-", 1:3, ".pdf"),
    last_updated_date = c(
      alecensa_date, as.Date("2026-01-10"), as.Date("2010-01-01")
    )
  )
}

plan_sample <- function(extractions = empty_efficacy_extractions(),
                        budget = 10,
                        documents = documents_sample(),
                        only = NULL) {
  plan_efficacy_extractions(
    medicines_sample(), documents, extractions, budget,
    only = only
  )
}

alecensa_extraction <- function(status,
                                reason = NA_character_,
                                model = "claude-sonnet-5-5") {
  dplyr::tibble(
    ema_product_number = "EMEA/H/C/004164",
    document_url = "https://www.ema.europa.eu/pi-1.pdf",
    document_last_updated_date = as.Date("2026-03-31"),
    status = status,
    reason = reason,
    extractor_model = model
  )
}

test_that("the plan takes authorised medicines not extracted or changed", {
  extractions <- alecensa_extraction("ok")
  plan <- plan_sample(extractions)
  expect_equal(plan$ema_product_number, "EMEA/H/C/005522")
  changed <- plan_sample(
    extractions,
    documents = documents_sample(as.Date("2026-09-01"))
  )
  expect_setequal(
    changed$ema_product_number,
    c("EMEA/H/C/004164", "EMEA/H/C/005522")
  )
  expect_named(plan, c(
    "ema_product_number", "name_of_medicine", "therapeutic_indication",
    "document_url", "document_last_updated_date"
  ))
})

test_that("a changed PI URL is planned again; newest documents first", {
  extractions <- alecensa_extraction("ok")
  extractions$document_url <- "https://www.ema.europa.eu/old.pdf"
  expect_equal(
    plan_sample(extractions)$ema_product_number,
    c("EMEA/H/C/004164", "EMEA/H/C/005522")
  )
})

test_that("a transient failure is planned again; the budget caps the plan", {
  for (reason in c(
    "errored: overloaded_error", "errored: api_error", "errored: errored",
    "errored", "expired", "canceled", "no result in the batch"
  )) {
    plan <- plan_sample(alecensa_extraction("failed", reason), budget = 1)
    expect_equal(plan$ema_product_number, "EMEA/H/C/004164", info = reason)
  }
})

test_that("a lasting failure waits for a new PI, another model or ONLY", {
  for (reason in c(
    "max_tokens", "refusal", "not the row schema",
    "no row passed verification", "no text read from the PDF",
    "errored: invalid_request_error", "errored: authentication_error",
    "errored: api_errors_elsewhere"
  )) {
    failed <- alecensa_extraction("failed", reason)
    expect_equal(
      plan_sample(failed)$ema_product_number,
      "EMEA/H/C/005522",
      info = reason
    )
    expect_equal(
      plan_efficacy_extractions(
        medicines_sample(), documents_sample(), failed, 10,
        only = NULL, model = "claude-opus-5-5"
      )$ema_product_number,
      c("EMEA/H/C/004164", "EMEA/H/C/005522")
    )
    expect_equal(
      plan_sample(failed, only = "EMEA/H/C/004164")$ema_product_number,
      "EMEA/H/C/004164"
    )
    expect_equal(
      plan_sample(
        failed,
        documents = documents_sample(as.Date("2026-09-01"))
      )$ema_product_number,
      c("EMEA/H/C/004164", "EMEA/H/C/005522")
    )
  }
})

test_that("a lasting failure is planned again at another effort", {
  plan_at <- function(extractions, effort) {
    plan_efficacy_extractions(
      medicines_sample(), documents_sample(), extractions, 10,
      only = NULL, effort = effort
    )$ema_product_number
  }
  both <- c("EMEA/H/C/004164", "EMEA/H/C/005522")
  # Recorded before the effort was a setting: every request was at high.
  failed <- alecensa_extraction("failed", "max_tokens")
  expect_equal(plan_at(failed, "high"), "EMEA/H/C/005522")
  expect_equal(plan_at(failed, "medium"), both)
  failed$extractor_effort <- "medium"
  expect_equal(plan_at(failed, "medium"), "EMEA/H/C/005522")
  expect_equal(plan_at(failed, "high"), both)
  # As for the model: a product extracted without failing is not redone,
  # nor one that failed before any request.
  expect_equal(plan_at(alecensa_extraction("ok"), "low"), "EMEA/H/C/005522")
  no_text <- alecensa_extraction(
    "failed", "no text read from the PDF",
    model = NA_character_
  )
  expect_equal(plan_at(no_text, "low"), "EMEA/H/C/005522")
})

test_that("the effort comes from APPROVAL_ATLAS_EFFICACY_EFFORT", {
  expect_equal(efficacy_effort_from_env(""), "high")
  expect_equal(efficacy_effort_from_env(" medium "), "medium")
  expect_error(efficacy_effort_from_env("turbo"), "turbo")
  expect_error(efficacy_effort_from_env("medium,high"), "one effort")
  withr::local_envvar(APPROVAL_ATLAS_EFFICACY_EFFORT = "xhigh")
  expect_equal(efficacy_effort_from_env(), "xhigh")
})

test_that("the newest product information of a product is planned", {
  documents <- dplyr::bind_rows(
    documents_sample(),
    dplyr::tibble(
      ema_product_number = "EMEA/H/C/005522",
      document_type = "product-information",
      url = "https://www.ema.europa.eu/pi-new.pdf",
      last_updated_date = as.Date("2026-05-01")
    )
  )
  plan <- plan_sample(documents = documents)
  expect_equal(
    plan$document_url[plan$ema_product_number == "EMEA/H/C/005522"],
    "https://www.ema.europa.eu/pi-new.pdf"
  )
})

test_that("APPROVAL_ATLAS_EFFICACY_ONLY plans exactly the listed products", {
  plan <- plan_sample(only = "EMEA/H/C/004164")
  expect_equal(plan$ema_product_number, "EMEA/H/C/004164")
  again <- plan_sample(alecensa_extraction("ok"), only = "EMEA/H/C/004164")
  expect_equal(again$ema_product_number, "EMEA/H/C/004164")
  expect_warning(
    plan_sample(only = c("EMEA/H/C/004164", "EMEA/H/C/000001")),
    "000001"
  )
  withr::local_envvar(APPROVAL_ATLAS_EFFICACY_ONLY = "")
  expect_null(efficacy_only_from_env())
  withr::local_envvar(
    APPROVAL_ATLAS_EFFICACY_ONLY = "EMEA/H/C/004164, EMEA/H/C/005522"
  )
  expect_equal(
    efficacy_only_from_env(),
    c("EMEA/H/C/004164", "EMEA/H/C/005522")
  )
  expect_error(efficacy_only_from_env("Alecensa"), "Alecensa")
})

test_that("the budget comes from APPROVAL_ATLAS_EFFICACY_BUDGET", {
  expect_equal(efficacy_budget_from_env(""), 25L)
  expect_equal(efficacy_budget_from_env("3"), 3L)
  expect_error(efficacy_budget_from_env("many"), "whole number")
})

test_that("flags name every reason a row needs a human", {
  row <- list(
    ci_level = 97.38, is_primary = NULL,
    population_match = "whole_trial_broader", ci_is_range = FALSE,
    value = "0.63", arm_treatment = "NR (44.4, NR)", arm_control = "20.8",
    comparator = "chemotherapy", comparator_column_label = NULL,
    effect_type = "hr", endpoint = "OS"
  )
  flags <- efficacy_flags(row, list(status = "reassembled", warnings = "x"))
  expect_setequal(flags, c(
    "reassembled", "ci_level", "is_primary_unknown", "population_differs",
    "not_reached", "comparator_label_missing"
  ))
})

test_that("arm values and arm sizes need the comparator's column label", {
  exact <- list(status = "exact", warnings = character())
  # KEYNOTE-024 (Keytruda): the HR alone, from a table or a sentence.
  row <- list(
    ci_level = 95, is_primary = TRUE, population_match = "whole_trial_matches",
    ci_is_range = FALSE, value = "0.50", comparator = "chemotherapy",
    comparator_column_label = NULL, effect_type = "hr", endpoint = "PFS"
  )
  expect_equal(efficacy_flags(row, exact), character())
  # REGARD (Cyramza): medians from a sentence, which prints no column label.
  with_arms <- c(row, list(arm_treatment = "5.2", arm_control = "3.8"))
  expect_equal(efficacy_flags(with_arms, exact), "comparator_label_missing")
  only_control <- c(row, list(arm_control = "3.8"))
  expect_equal(efficacy_flags(only_control, exact), "comparator_label_missing")
  # Any label clears this flag, the arm's name in a sentence too: the
  # verifier only checks it is quoted with the control's values
  # (comparator_label_check()).
  with_arms$comparator_column_label <- "placebo"
  expect_equal(efficacy_flags(with_arms, exact), character())
  # LAURA (Tagrisso): the arm sizes say which arm is which, as arm values do
  # (here swapped, with the label left empty).
  sizes <- c(row, list(n_treatment = 73L, n_control = 143L))
  expect_equal(efficacy_flags(sizes, exact), "comparator_label_missing")
  expect_equal(
    efficacy_flags(c(row, list(n_treatment = 143L)), exact),
    "comparator_label_missing"
  )
  sizes$comparator_column_label <- "Placebo"
  expect_equal(efficacy_flags(sizes, exact), character())
  # A single-arm trial's size names its one arm.
  single <- list(
    ci_level = 95, is_primary = TRUE, population_match = "whole_trial_matches",
    ci_is_range = FALSE, value = "45.0", effect_type = "single_arm_rate",
    endpoint = "ORR", n_treatment = 89L
  )
  expect_equal(efficacy_flags(single, exact), character())
  # Arms blanked as not verified: arms_not_verified alone hides the row.
  blanked <- without_unverified_arms(
    c(row, list(arm_treatment = "5.2", arm_control = "3.8")),
    c("arm_treatment", "arm_control")
  )
  expect_equal(
    efficacy_flags(blanked, list(flags = "arms_not_verified")),
    "arms_not_verified"
  )
})

# Review of the prompt change (2026-10-01): a two-arm rate difference whose
# comparator was left "" and its arms swapped was shown as single-arm.
test_that("a control arm's values need the label, a comparator or none", {
  exact <- list(status = "exact", warnings = character())
  row <- list(
    ci_level = 95, is_primary = TRUE, population_match = "whole_trial_matches",
    ci_is_range = FALSE, value = "15", effect_type = "rate_difference",
    endpoint = "ORR", arm_treatment = "30", arm_control = "45"
  )
  expect_setequal(
    efficacy_flags(row, exact),
    c("comparator_missing", "comparator_label_missing")
  )
  # The effect called single-arm, the control's value given all the same.
  single <- c(
    row[setdiff(names(row), c("effect_type", "arm_treatment"))],
    list(effect_type = "single_arm_median", n_control = 98L)
  )
  expect_equal(efficacy_flags(single, exact), "comparator_label_missing")
})

test_that("a two-arm effect without a comparator is flagged", {
  exact <- list(status = "exact", warnings = character())
  row <- list(
    ci_level = 95, is_primary = TRUE, population_match = "whole_trial_matches",
    ci_is_range = FALSE, value = "0.60", endpoint = "PFS"
  )
  for (effect in c("hr", "hr_noninferiority", "rate_difference")) {
    expect_equal(
      efficacy_flags(c(row, list(effect_type = effect)), exact),
      "comparator_missing",
      info = effect
    )
    named <- c(row, list(effect_type = effect, comparator = "placebo"))
    expect_equal(efficacy_flags(named, exact), character(), info = effect)
  }
  for (effect in c("single_arm_rate", "single_arm_median")) {
    expect_equal(
      efficacy_flags(c(row, list(effect_type = effect)), exact),
      character(),
      info = effect
    )
  }
})

test_that("a row without an endpoint is flagged", {
  exact <- list(status = "exact", warnings = character())
  row <- list(
    ci_level = 95, is_primary = TRUE, population_match = "whole_trial_matches",
    ci_is_range = FALSE, value = "0.16", comparator = "Placebo",
    effect_type = "hr", endpoint = "Progression-Free Survival"
  )
  expect_equal(efficacy_flags(row, exact), character())
  row$endpoint <- NULL
  expect_equal(efficacy_flags(row, exact), "endpoint_missing")
})

test_that("a clean row has no flags; a missing comparator and ranges are", {
  row <- list(
    ci_level = 95, is_primary = TRUE, population_match = "whole_trial_matches",
    ci_is_range = FALSE, value = "0.47", arm_treatment = "34.8",
    arm_control = "10.9", comparator = "crizotinib",
    comparator_column_label = "Crizotinib", effect_type = "hr",
    endpoint = "PFS"
  )
  exact <- list(status = "exact", warnings = character())
  expect_equal(efficacy_flags(row, exact), character())
  row$comparator <- NULL
  row$ci_is_range <- TRUE
  expect_equal(
    efficacy_flags(row, exact),
    c("ci_is_range", "comparator_missing")
  )
  row$page <- NA_integer_
  expect_true("page_unknown" %in% efficacy_flags(row, exact))
  row$page <- 12L
  expect_false("page_unknown" %in% efficacy_flags(row, exact))
})

test_that("a row key follows the numbers and the product", {
  row <- list(
    ema_product_number = "EMEA/H/C/004164", trial = "ALEX",
    endpoint = "PFS", population = NULL, analysis = "primary",
    value = "0.47", ci_low = "0.34", ci_high = "0.65", quotes = list("x")
  )
  key <- efficacy_row_key(row)
  expect_match(key, "^[0-9a-f]{40}$")
  row$quotes <- list("another quote")
  expect_equal(efficacy_row_key(row), key)
  row$value <- "0.48"
  expect_false(efficacy_row_key(row) == key)
  for (field in c("assessment", "effect_type", "indication", "comparator")) {
    changed <- row
    changed[[field]] <- "other"
    expect_false(
      efficacy_row_key(changed) == efficacy_row_key(row),
      info = field
    )
  }
})

test_that("a human review survives the same numbers, not changed ones", {
  old <- dplyr::tibble(
    ema_product_number = "EMEA/H/C/004164",
    row_key = c("a", "b"),
    review = c("reviewed_ok", "reviewed_rejected")
  )
  new <- dplyr::tibble(
    ema_product_number = "EMEA/H/C/004164",
    row_key = c("a", "c"),
    flags = list(character(), "ci_level")
  )
  merged <- merge_efficacy_reviews(new, old)
  reviews <- stats::setNames(merged$review, merged$row_key)
  expect_equal(reviews[c("a", "c")], c(a = "reviewed_ok", c = "flagged"))
})

test_that("reviewed_ok needs every model field unchanged, a rejection not", {
  old <- dplyr::tibble(
    ema_product_number = "EMEA/H/C/004164",
    row_key = c("a", "b"),
    quotes = list("HR 0.47 (0.34, 0.65)", "HR 0.5"),
    review = c("reviewed_ok", "reviewed_rejected")
  )
  new <- dplyr::tibble(
    ema_product_number = "EMEA/H/C/004164",
    row_key = c("a", "b"),
    quotes = list("HR 0.47 (0.34, 0.65) in another sentence", "HR 0.5 again"),
    flags = list(character(), character())
  )
  expect_equal(
    merge_efficacy_reviews(new, old)$review,
    c("auto_ok", "reviewed_rejected")
  )
  same <- merge_efficacy_reviews(
    dplyr::mutate(old, flags = list("x", "y")),
    old
  )
  expect_equal(same$review, c("reviewed_ok", "reviewed_rejected"))
})

test_that("rejected rows of a re-extracted product stay as tombstones", {
  old <- dplyr::tibble(
    ema_product_number = "EMEA/H/C/004164",
    row_key = c("a", "b"),
    review = c("auto_ok", "reviewed_rejected")
  )
  new <- dplyr::tibble(
    ema_product_number = "EMEA/H/C/004164",
    row_key = "c",
    flags = list(character())
  )
  merged <- merge_efficacy_reviews(new, old)
  expect_equal(merged$row_key, c("b", "c"))
  expect_equal(merged$review, c("reviewed_rejected", "auto_ok"))
  back <- merge_efficacy_reviews(
    dplyr::mutate(new, row_key = "b"),
    merged
  )
  expect_equal(back$row_key, "b")
  expect_equal(back$review, "reviewed_rejected")
})

test_that("other products' rows are kept; an unflagged row is auto_ok", {
  old <- dplyr::tibble(
    ema_product_number = c("EMEA/H/C/004164", "EMEA/H/C/005522"),
    row_key = c("a", "z"),
    review = c("flagged", "auto_ok")
  )
  new <- dplyr::tibble(
    ema_product_number = "EMEA/H/C/004164",
    row_key = "a",
    flags = list(character())
  )
  merged <- merge_efficacy_reviews(new, old)
  expect_equal(merged$row_key, c("z", "a"))
  expect_equal(merged$review, c("auto_ok", "auto_ok"))
  none <- merge_efficacy_reviews(
    new[0, ], old,
    replaced_products = "EMEA/H/C/005522"
  )
  expect_equal(none$row_key, "a")
})

# One row as the model answers it: every schema field, "" when not stated.
answer_row <- function(...) {
  row <- purrr::map(efficacy_row_properties(), function(property) "")
  row$population_match <- "whole_trial_matches"
  row$is_primary <- "yes"
  row$analysis_role <- "primary"
  row$effect_type <- "hr"
  row$ci_is_range <- FALSE
  overrides <- list(...)
  row[names(overrides)] <- overrides
  row
}

batch_answer <- function(custom_id, rows) {
  text <- jsonlite::toJSON(list(rows = rows), auto_unbox = TRUE)
  list(list(
    custom_id = custom_id,
    type = "succeeded",
    message = list(
      stop_reason = "end_turn",
      content = list(list(type = "text", text = as.character(text)))
    ),
    error = NA_character_
  ))
}

local_batch <- function(pages, results, env = parent.frame()) {
  local_mocked_bindings(
    fetch_efficacy_pages = function(plan_row) list(pages = pages),
    create_claude_batch = function(requests) "msgbatch_1",
    claude_batch_status = function(batch_id) {
      list(status = "ended", results_url = "https://x/results")
    },
    claude_batch_results = function(results_url) results,
    wait_seconds = function(seconds) invisible(NULL),
    .env = env
  )
  withr::local_envvar(ANTHROPIC_API_KEY = "test-key", .local_envir = env)
}

extract_first <- function(pending_path = tempfile(fileext = ".json")) {
  suppressMessages(extract_efficacy_batch(
    plan_sample(budget = 1), "claude-sonnet-5-5",
    poll_seconds = 0, today = as.Date("2026-09-30"),
    pending_path = pending_path
  ))
}

test_that("a 5.1 without trial results is recorded no_rows, with no rows", {
  local_batch(
    c(paste(
      "5.1 Pharmacodynamic properties\nMechanism only.",
      "5.2 Pharmacokinetic properties",
      sep = "\n"
    )),
    batch_answer("EMEA-H-C-004164", list())
  )
  run <- extract_first()
  expect_equal(run$extractions$status, "no_rows")
  expect_equal(nrow(run$rows), 0)
})

test_that("an errored or refused request is recorded failed with its reason", {
  pages <- c(paste(
    "5.1 Pharmacodynamic properties\nTrial X n=10",
    "5.2 Pharmacokinetic properties",
    sep = "\n"
  ))
  local_batch(pages, list(list(
    custom_id = "EMEA-H-C-004164", type = "errored", message = NULL,
    error = "overloaded_error"
  )))
  run <- extract_first()
  expect_equal(run$extractions$status, "failed")
  expect_equal(run$extractions$reason, "errored: overloaded_error")
  local_batch(pages, list(list(
    custom_id = "EMEA-H-C-004164", type = "succeeded",
    message = list(stop_reason = "max_tokens", content = list()),
    error = NA_character_
  )))
  expect_equal(extract_first()$extractions$reason, "max_tokens")
  local_batch(pages, list(list(
    custom_id = "EMEA-H-C-004164", type = "expired", message = NULL,
    error = NA_character_
  )))
  expect_equal(extract_first()$extractions$reason, "expired")
  local_batch(pages, list())
  expect_equal(
    extract_first()$extractions$reason,
    "no result in the batch"
  )
})

alex_pages <- function() {
  c(
    "ANNEX I\nSUMMARY OF PRODUCT CHARACTERISTICS",
    paste(
      "4.9 Overdose\nNone.\n5.1 Pharmacodynamic properties",
      "Clinical efficacy\nThe ALEX trial randomised patients to alectinib",
      "(n = 152) or crizotinib (n = 151)."
    ),
    paste(
      "Table 5 Efficacy results from ALEX",
      "Hazard ratio 0.47 (95% CI: 0.34, 0.65), p < 0.0001.",
      "Median PFS NR (17.7, NR) versus 11.1 months.",
      "5.2 Pharmacokinetic properties\nAbsorption.",
      sep = "\n"
    )
  )
}

alex_row <- function(...) {
  row <- answer_row(
    trial = "ALEX", endpoint = "PFS", regimen = "alectinib",
    comparator = "crizotinib", comparator_column_label = "Crizotinib",
    n_treatment = "152", n_control = "151", value = "0.47", ci_low = "0.34",
    ci_high = "0.65", ci_level = "95", analysis = "primary analysis",
    quotes = list(
      "Hazard ratio 0.47 (95% CI: 0.34, 0.65), p < 0.0001.",
      "(n = 152) or crizotinib (n = 151)."
    )
  )
  overrides <- list(...)
  row[names(overrides)] <- overrides
  row
}

test_that("verified rows keep page, key, flags; failing ones are listed", {
  local_batch(alex_pages(), batch_answer("EMEA-H-C-004164", list(
    alex_row(),
    alex_row(endpoint = "OS", value = "0.67"),
    alex_row(
      value = "0.47", analysis = "later",
      arm_treatment = "NR (17.7, NR)",
      quotes = list(
        "Hazard ratio 0.47 (95% CI: 0.34, 0.65), p < 0.0001.",
        "Median PFS NR (17.7, NR) versus 11.1 months.",
        "(n = 152) or crizotinib (n = 151)."
      )
    )
  )))
  run <- extract_first()
  expect_equal(run$extractions$status, "ok")
  expect_equal(run$extractions$rows_kept, 2L)
  expect_equal(run$extractions$rows_failed, 1L)
  expect_equal(run$extractions$extractor_model, "claude-sonnet-5-5")
  expect_equal(run$extractions$extractor_effort, "high")
  expect_equal(run$rows$row_order, c(1L, 3L))
  expect_equal(run$rows$page, c(3L, 3L))
  expect_equal(run$rows$verification, c("exact", "exact"))
  # The sizes are printed in a sentence, where no column places them, so they
  # are blanked with the label, which leaves the third row's arm value
  # unlabelled (owner decision 2026-10-01).
  expect_equal(
    run$rows$flags,
    list(character(), c("not_reached", "comparator_label_missing"))
  )
  expect_equal(run$rows$n_treatment, c(NA_integer_, NA_integer_))
  expect_equal(run$rows$comparator_column_label, c(NA_character_, NA))
  expect_equal(run$rows$ci_level, c(95, 95))
  expect_equal(
    run$rows$source_url,
    rep("https://www.ema.europa.eu/pi-1.pdf", 2)
  )
  expect_equal(run$rows$source_date, rep(as.Date("2026-03-31"), 2))
  expect_equal(run$rows$extracted_at, rep(as.Date("2026-09-30"), 2))
  expect_true(is.list(run$rows$quotes))
  expect_match(run$rows$row_key, "^[0-9a-f]{40}$")
  expect_equal(run$failed_rows$endpoint, "OS")
  expect_match(run$failed_rows$errors[[1]][1], "0.67")
})

test_that("a row whose arms do not verify is kept without them, flagged", {
  local_batch(alex_pages(), batch_answer("EMEA-H-C-004164", list(
    alex_row(
      arm_treatment = "34.8", arm_control = "10.9",
      arm_measure = "median months"
    )
  )))
  run <- extract_first()
  expect_equal(run$extractions$rows_kept, 1L)
  expect_equal(run$extractions$rows_failed, 0L)
  expect_equal(run$rows$value, "0.47")
  expect_true(is.na(run$rows$arm_treatment))
  expect_true(is.na(run$rows$arm_control))
  expect_true(is.na(run$rows$arm_measure))
  expect_true(is.na(run$rows$comparator_column_label))
  expect_true("arms_not_verified" %in% run$rows$flags[[1]])
})

# A verbatim excerpt of a pilot section (tests/testthat/fixtures/efficacy)
# as the page texts of a product information: section 5.1, then 5.2.
read_fixture_text <- function(name) {
  path <- testthat::test_path("fixtures", "efficacy", name)
  paste(readLines(path, encoding = "UTF-8", warn = FALSE), collapse = "\n")
}

excerpt_pages <- function(name) {
  text <- read_fixture_text(paste0("excerpt-", name, ".layout.txt"))
  c(
    paste("5.1 Pharmacodynamic properties", text, sep = "\n"),
    "5.2 Pharmacokinetic properties"
  )
}

# One answered row checked as production checks it (check_answer_row()), then
# taken to the site file: the failed row, or the record with its merged row
# (`rows`, its review) and the rows the site file shows of it (`site`).
row_to_site <- function(pages, ...) {
  row <- normalise_efficacy_row(answer_row(...))$row
  plan_row <- list(
    ema_product_number = "EMEA/H/C/005919",
    therapeutic_indication = NA_character_,
    document_url = "https://www.ema.europa.eu/pi.pdf",
    document_last_updated_date = as.Date("2026-09-01")
  )
  submission <- list(plan_row = plan_row, section = slice_smpc_efficacy(pages))
  checked <- check_answer_row(
    row, 1L, submission, "claude-sonnet-5-5", as.Date("2026-10-01")
  )
  if (!is.null(checked$failed)) {
    return(checked)
  }
  rows <- merge_efficacy_reviews(
    efficacy_row_table(list(checked$record)), empty_efficacy_rows()
  )
  medicines <- dplyr::tibble(ema_product_number = plan_row$ema_product_number)
  c(checked, list(rows = rows, site = build_efficacy_table(rows, medicines)))
}

# Review of the verifier tolerance (2026-10-01): whole rows that borrowed a
# number, an interval, an arm size or a label from elsewhere in a table.
test_that("a row that borrows from another line or column never ships", {
  tevimbra_307 <- excerpt_pages("tevimbra-307")
  # T+PC's 0.45 with T+nPC's interval, the next column of the row.
  borrowed_ci <- row_to_site(
    tevimbra_307,
    trial = "BGB-A317-307", endpoint = "PFS", comparator = "paclitaxel",
    comparator_column_label = "Paclitaxel", n_treatment = "120",
    n_control = "121", value = "0.45", ci_low = "0.31", ci_high = "0.60",
    ci_level = "95", quotes = list(paste(
      "Stratified hazard ratioa (95% CI) 0.45 (0.33, 0.62)",
      "0.43 (0.31, 0.60) -"
    ))
  )
  expect_match(
    borrowed_ci$failed$errors[[1]], "value and CI not in one quote",
    all = FALSE
  )
  tevimbra_305 <- excerpt_pages("tevimbra-305")
  # The events count "n 189" as the arm size (the arm is n = 274).
  events <- row_to_site(
    tevimbra_305,
    trial = "BGB-A317-305", endpoint = "PFS", n_treatment = "189",
    n_control = "272", value = "0.68", ci_low = "0.56", ci_high = "0.83",
    ci_level = "95", quotes = list(
      "Hazard ratioc (95% CI) 0.68 (0.56, 0.83)",
      "Disease progression or death, n 189 (69.0) 216 (79.4) (%)"
    )
  )
  # Blanked, never shown (owner decision 2026-10-01: the row is kept).
  expect_null(events$failed)
  expect_null(events$record$n_treatment)
  expect_false(189L %in% events$site$n_treatment)
  # A sign from the line below.
  sign <- row_to_site(
    tevimbra_305,
    trial = "BGB-A317-305", endpoint = "OS", value = "0.71",
    ci_low = "-0.58", ci_high = "0.86", ci_level = "95",
    quotes = list("Hazard ratioc (95% CI) 0.71 (-0.58, 0.86)")
  )
  expect_false(is.null(sign$failed))
  # LAURA's PFS hazard ratio labelled with the "Overall Survival" below it.
  laura <- row_to_site(
    excerpt_pages("tagrisso-laura"),
    trial = "LAURA", endpoint = "Overall Survival", n_treatment = "143",
    n_control = "73", value = "0.16", ci_low = "0.10", ci_high = "0.24",
    ci_level = "95", quotes = list(
      "Overall Survival HR (95% CI); P-value 0.16 (0.10, 0.24); P<0.001",
      "TAGRISSO Placebo (N=143) (N=73)"
    )
  )
  expect_match(laura$failed$errors[[1]], "quote not in the text", all = FALSE)
  # BGB-A317-307's median OS label above its hazard ratio row's numbers: kept,
  # but hidden until a human has looked.
  median_os <- row_to_site(
    tevimbra_307,
    trial = "BGB-A317-307", endpoint = "Median OS", n_treatment = "120",
    n_control = "121", value = "0.68", ci_low = "0.45", ci_high = "1.01",
    ci_level = "95",
    quotes = list("Median OS (months) (95% CI) 0.68 (0.45, 1.01)")
  )
  expect_true("quote_across_lines" %in% median_os$record$flags)
  expect_equal(median_os$rows$review, "flagged")
  expect_equal(nrow(median_os$site), 0L)
})

# Review of the prompt change (2026-10-01): whole rows that reached the site
# with arm sizes, a label, a comparator or an endpoint nothing verified.
laura_hr_quote <- "HR (95% CI); P-value 0.16 (0.10, 0.24); P<0.001"

laura_row_to_site <- function(...) {
  row <- list(
    trial = "LAURA", endpoint = "Progression-Free Survival",
    regimen = "TAGRISSO", comparator = "Placebo", value = "0.16",
    ci_low = "0.10", ci_high = "0.24", ci_level = "95",
    quotes = list(laura_hr_quote)
  )
  overrides <- list(...)
  row[names(overrides)] <- overrides
  do.call(row_to_site, c(list(excerpt_pages("tagrisso-laura")), row))
}

# Owner decision 2026-10-01: sizes the section's layout does not place under
# their arms' column headers are blanked and the row shown without them, as
# its value and CI verify; never hidden for them, never shown with them.
test_that("arm sizes ship only under their arms' column headers", {
  # The label printed but left empty, the arm sizes swapped.
  swapped <- laura_row_to_site(
    n_treatment = "73", n_control = "143",
    quotes = list(laura_hr_quote, "(N=143) (N=73)")
  )
  expect_equal(swapped$record$flags, character())
  expect_null(swapped$record$n_treatment)
  expect_null(swapped$record$n_control)
  expect_equal(nrow(swapped$site), 1L)
  expect_true(is.na(swapped$site$n_treatment))
  expect_true(is.na(swapped$site$n_control))
  expect_equal(swapped$site$value, "0.16")
  # The label given, quoted apart from the sizes: LAURA's table prints
  # "Placebo" over "(N=73)" and "TAGRISSO" over "(N=143)", so they ship.
  apart <- laura_row_to_site(
    comparator_column_label = "Placebo", n_treatment = "143",
    n_control = "73", quotes = list(laura_hr_quote, "(N=143) (N=73)")
  )
  expect_equal(apart$record$flags, character())
  expect_equal(apart$site$n_treatment, 143L)
  expect_equal(apart$site$n_control, 73L)
  expect_equal(apart$site$comparator_column_label, "Placebo")
  # Review of the size fix-up (2026-10-01): the sizes swapped in a quote of
  # the header, which holds both columns, shipped. Now blanked with the label,
  # which then ties nothing; the row ships without them.
  header <- "TAGRISSO Placebo Efficacy Parameter (N=143) (N=73)"
  in_header <- laura_row_to_site(
    comparator_column_label = "Placebo", n_treatment = "73",
    n_control = "143", quotes = list(laura_hr_quote, header)
  )
  expect_equal(in_header$record$flags, character())
  expect_equal(nrow(in_header$site), 1L)
  expect_true(is.na(in_header$site$n_treatment))
  expect_true(is.na(in_header$site$n_control))
  expect_true(is.na(in_header$site$comparator_column_label))
  # Sizes the section prints in no n notation ("103/212" in a forest plot,
  # PACIFIC): blanked, the row shipped (owner decision 2026-10-01).
  unprinted <- laura_row_to_site(
    n_treatment = "212", n_control = "91",
    quotes = list(laura_hr_quote, "(N=143) (N=73)")
  )
  expect_null(unprinted$failed)
  expect_equal(nrow(unprinted$site), 1L)
  expect_true(is.na(unprinted$site$n_treatment))
  expect_true(is.na(unprinted$site$n_control))
  # Arm values without a label stay hidden, their sizes kept for the human.
  medians <- "Median PFS, months (95% CI) 39.1 (31.5, NC) 5.6 (3.7, 7.4)"
  unlabelled <- laura_row_to_site(
    n_treatment = "143", n_control = "73", arm_treatment = "39.1",
    arm_control = "5.6",
    quotes = list(laura_hr_quote, medians, "(N=143) (N=73)")
  )
  expect_equal(unlabelled$record$flags, "comparator_label_missing")
  expect_equal(unlabelled$record$n_control, 73L)
  expect_equal(nrow(unlabelled$site), 0L)
  # The column headers quoted with the sizes below them.
  headed <- laura_row_to_site(
    comparator_column_label = "Placebo", n_treatment = "143",
    n_control = "73", quotes = list(
      laura_hr_quote, "TAGRISSO Placebo Efficacy Parameter (N=143) (N=73)"
    )
  )
  expect_equal(headed$record$flags, character())
  expect_equal(headed$site$n_control, 73L)
  expect_equal(headed$site$comparator_column_label, "Placebo")
})

# Review of the size fix-up (2026-10-01): blanking the sizes of a single-arm
# effect deleted the only sign of its second arm, so placebo's median shipped
# as the medicine's ("TAGRISSO vs Placebo", or "TAGRISSO, single-arm").
test_that("a single-arm effect from a trial of two arms never ships", {
  medians <- "Median PFS, months (95% CI) 39.1 (31.5, NC) 5.6 (3.7, 7.4)"
  sizes <- "(N=143) (N=73)"
  placebo_median <- function(...) {
    laura_row_to_site(
      effect_type = "single_arm_median", value = "5.6", ci_low = "3.7",
      ci_high = "7.4", ...
    )
  }
  cases <- list(
    named = placebo_median(
      n_treatment = "143", n_control = "73", quotes = list(medians, sizes)
    ),
    unnamed = placebo_median(
      comparator = "", n_treatment = "143", n_control = "73",
      quotes = list(medians, sizes)
    ),
    # Found without sizes before the fix-up too.
    bare = placebo_median(quotes = list(medians))
  )
  for (name in names(cases)) {
    case <- cases[[name]]
    expect_null(case$failed, info = name)
    expect_true(
      "single_arm_with_control" %in% case$record$flags, info = name
    )
    expect_equal(case$rows$review, "flagged", info = name)
    expect_equal(nrow(case$site), 0L, info = name)
  }
  # The sizes stay for the human.
  expect_equal(cases$named$record$n_control, 73L)
  # A single-arm rate given two sizes and no comparator.
  rate <- laura_row_to_site(
    effect_type = "single_arm_rate", comparator = "", n_treatment = "143",
    n_control = "73", quotes = list(laura_hr_quote, sizes)
  )
  expect_true("single_arm_with_control" %in% rate$record$flags)
  expect_equal(nrow(rate$site), 0L)
})

test_that("a label with nothing to tie never ships", {
  # The treatment's header given as the comparator's, no arm values.
  wrong <- laura_row_to_site(comparator_column_label = "TAGRISSO")
  expect_equal(wrong$record$flags, character())
  expect_null(wrong$record$comparator_column_label)
  expect_equal(nrow(wrong$site), 1L)
  expect_true(is.na(wrong$site$comparator_column_label))
})

test_that("a row without its endpoint or its comparator never ships", {
  no_endpoint <- laura_row_to_site(endpoint = "")
  expect_true("endpoint_missing" %in% no_endpoint$record$flags)
  expect_equal(nrow(no_endpoint$site), 0L)
  pages <- c(paste(
    "5.1 Pharmacodynamic properties",
    "Table 2 Efficacy results from TRIAL-9",
    "                     Drugamab          Placebo",
    "                     (N=100)           (N=98)",
    "ORR, %               45                30",
    "Difference in ORR 15 (95% CI: 2, 28)",
    sep = "\n"
  ), "5.2 Pharmacokinetic properties")
  rate_row <- function(...) {
    row_to_site(
      pages,
      trial = "TRIAL-9", endpoint = "ORR", regimen = "Drugamab",
      effect_type = "rate_difference", value = "15", ci_low = "2",
      ci_high = "28", ci_level = "95", n_treatment = "100", n_control = "98",
      ...
    )
  }
  # A rate difference with comparator "", its arms swapped: it would read
  # "single-arm" beside "30 vs 45".
  swapped <- rate_row(
    arm_treatment = "30", arm_control = "45", arm_measure = "ORR, %",
    quotes = list(
      "Difference in ORR 15 (95% CI: 2, 28)", "ORR, % 45 30", "(N=100) (N=98)"
    )
  )
  expect_true(all(
    c("comparator_missing", "comparator_label_missing") %in%
      swapped$record$flags
  ))
  expect_equal(nrow(swapped$site), 0L)
  # The same without arm values.
  bare <- rate_row(
    quotes = list("Difference in ORR 15 (95% CI: 2, 28)", "(N=100) (N=98)")
  )
  expect_true("comparator_missing" %in% bare$record$flags)
  expect_equal(nrow(bare$site), 0L)
})

test_that("a row quoted in reading order gets its page, flagged for review", {
  text <- read_fixture_text("tecentriq-pi-5.1.layout.txt")
  pages <- strsplit(text, "\f", fixed = TRUE)[[1]]
  # IMpower130 OS as the 2026-10-01 evaluation answered it: its hazard ratio
  # row with the footnote mark printed on the line above, and the arm sizes.
  impower130 <- row_to_site(
    pages,
    trial = "IMpower130", endpoint = "OS", n_treatment = "451",
    n_control = "228", value = "0.79", ci_low = "0.64", ci_high = "0.98",
    ci_level = "95", quotes = list(
      "Stratified hazard ratio‡ (95% CI) 0.79 (0.64, 0.98)",
      "Co-primary endpoints OS n=451 n=228"
    )
  )
  expected_page <- grep("hazard ratio \\(95% CI\\) +0\\.79", pages)
  expect_length(expected_page, 1)
  expect_equal(impower130$record$page, expected_page)
  expect_false("page_unknown" %in% impower130$record$flags)
  expect_true("quote_across_lines" %in% impower130$record$flags)
  expect_equal(nrow(impower130$site), 0L)
  # Once a human has looked, it is shown with its page.
  reviewed <- impower130$rows
  reviewed$review <- "reviewed_ok"
  site <- build_efficacy_table(
    reviewed, dplyr::tibble(ema_product_number = "EMEA/H/C/005919")
  )
  expect_equal(nrow(site), 1L)
  expect_equal(site$page, expected_page)
})

test_that("an indication not in the medicine's section 4.1 is flagged", {
  local_batch(alex_pages(), batch_answer("EMEA-H-C-004164", list(
    alex_row(indication = "ALK-positive NSCLC"),
    alex_row(indication = "ALK-positive lung cancer", analysis = "later")
  )))
  run <- extract_first()
  expect_equal(run$rows$flags, list(character(), "indication_not_in_source"))
})

test_that("a repeated row and parser-dropped rows count as failed", {
  local_batch(alex_pages(), batch_answer("EMEA-H-C-004164", list(
    alex_row(),
    alex_row(),
    alex_row(n_treatment = "about 150")
  )))
  run <- extract_first()
  expect_equal(run$extractions$rows_kept, 1L)
  expect_equal(run$extractions$rows_failed, 2L)
  expect_match(run$extractions$reason, "1 of 3 rows dropped")
  expect_equal(nrow(run$failed_rows), 2L)
})

test_that("every row failing verification makes the product failed", {
  local_batch(alex_pages(), batch_answer(
    "EMEA-H-C-004164",
    list(alex_row(value = "0.99"))
  ))
  run <- extract_first()
  expect_equal(run$extractions$status, "failed")
  expect_equal(run$extractions$reason, "no row passed verification")
  expect_equal(nrow(run$rows), 0)
})

test_that("no section 5.1 and a missing PDF are recorded without a request", {
  outcomes <- list(
    "EMEA/H/C/004164" = list(pages = c("ANNEX I", "no sections")),
    "EMEA/H/C/005522" = list(status = "not_found")
  )
  local_mocked_bindings(
    fetch_efficacy_pages = function(plan_row) {
      outcomes[[plan_row$ema_product_number]]
    },
    create_claude_batch = function(requests) stop("no batch expected")
  )
  withr::local_envvar(ANTHROPIC_API_KEY = "test-key")
  run <- extract_efficacy_batch(plan_sample(), "claude-sonnet-5-5", 0)
  expect_equal(run$extractions$status, c("no_section", "not_found"))
  expect_equal(run$extractions$extractor_model, c(NA_character_, NA))
  expect_equal(run$extractions$extractor_effort, c(NA_character_, NA))
})

test_that("a fetch stop keeps what was fetched and leaves the rest", {
  local_mocked_bindings(
    fetch_efficacy_pages = function(plan_row) {
      if (plan_row$ema_product_number == "EMEA/H/C/004164") {
        return(list(pages = "no section"))
      }
      list(stop = "EMA returned HTTP 429")
    }
  )
  withr::local_envvar(ANTHROPIC_API_KEY = "test-key")
  expect_warning(
    run <- extract_efficacy_batch(plan_sample(), "claude-sonnet-5-5", 0),
    "HTTP 429"
  )
  expect_equal(run$extractions$ema_product_number, "EMEA/H/C/004164")
})

test_that("a Claude API error on submission records nothing sent", {
  local_mocked_bindings(
    fetch_efficacy_pages = function(plan_row) list(pages = alex_pages()),
    create_claude_batch = function(requests) {
      rlang::abort(
        "HTTP 429",
        class = c("claude_api_http_429", "claude_api_error")
      )
    }
  )
  withr::local_envvar(ANTHROPIC_API_KEY = "test-key")
  pending_path <- withr::local_tempfile(fileext = ".json")
  expect_warning(
    run <- extract_efficacy_batch(
      plan_sample(), "claude-sonnet-5-5", 0,
      pending_path = pending_path
    ),
    "left for a later run"
  )
  expect_equal(nrow(run$extractions), 0)
  expect_false(file.exists(pending_path))
})

test_that("a submission timeout warns that the batch may exist", {
  local_mocked_bindings(
    fetch_efficacy_pages = function(plan_row) list(pages = alex_pages()),
    create_claude_batch = function(requests) {
      rlang::abort("Timeout was reached", class = "httr2_failure")
    }
  )
  withr::local_envvar(ANTHROPIC_API_KEY = "test-key")
  expect_warning(
    extract_efficacy_batch(
      plan_sample(), "claude-sonnet-5-5", 0,
      pending_path = withr::local_tempfile(fileext = ".json")
    ),
    "Anthropic Console"
  )
})

test_that("the batch id and plan are saved before the batch is polled", {
  pending_path <- withr::local_tempfile(fileext = ".json")
  saved <- NULL
  local_batch(alex_pages(), batch_answer("EMEA-H-C-004164", list(alex_row())))
  local_mocked_bindings(
    claude_batch_status = function(batch_id) {
      saved <<- read_pending_batch(pending_path)
      list(status = "ended", results_url = "https://x/results")
    }
  )
  run <- extract_first(pending_path)
  expect_equal(saved$batch_id, "msgbatch_1")
  expect_equal(saved$model, "claude-sonnet-5-5")
  expect_equal(saved$plan$ema_product_number, "EMEA/H/C/004164")
  expect_equal(saved$plan$document_last_updated_date, as.Date("2026-03-31"))
  expect_false(run$pending)
})

test_that("the batch is polled until it ends; the request holds the section", {
  sent <- NULL
  states <- c("in_progress", "in_progress", "ended")
  polls <- 0L
  local_mocked_bindings(
    fetch_efficacy_pages = function(plan_row) list(pages = alex_pages()),
    create_claude_batch = function(requests) {
      sent <<- requests
      "msgbatch_1"
    },
    claude_batch_status = function(batch_id) {
      polls <<- polls + 1L
      list(status = states[[polls]], results_url = "https://x/results")
    },
    claude_batch_results = function(results_url) {
      batch_answer("EMEA-H-C-004164", list(alex_row()))
    },
    wait_seconds = function(seconds) invisible(NULL)
  )
  withr::local_envvar(ANTHROPIC_API_KEY = "test-key")
  run <- suppressMessages(extract_first())
  expect_equal(polls, 3L)
  expect_equal(sent[[1]]$custom_id, "EMEA-H-C-004164")
  # The models' output limit: a batch has no HTTP timeout (Keytruda and
  # Opdivo were cut off at 32000 in the gold evaluation of 2026-10-01).
  expect_equal(sent[[1]]$params$max_tokens, 128000L)
  expect_match(
    sent[[1]]$params$messages[[1]]$content,
    "Hazard ratio 0.47",
    fixed = TRUE
  )
  expect_no_match(
    sent[[1]]$params$messages[[1]]$content,
    "Absorption",
    fixed = TRUE
  )
  expect_equal(run$extractions$status, "ok")
})

test_that("polling stops after 30 minutes without a state; the batch stays", {
  clock <- as.POSIXct("2026-09-30 22:00:00", tz = "UTC")
  local_mocked_bindings(
    fetch_efficacy_pages = function(plan_row) list(pages = alex_pages()),
    create_claude_batch = function(requests) "msgbatch_1",
    claude_batch_status = function(batch_id) stop("connection reset"),
    wait_seconds = function(seconds) {
      clock <<- clock + 11 * 60
      invisible(NULL)
    },
    current_time = function() clock
  )
  withr::local_envvar(ANTHROPIC_API_KEY = "test-key")
  pending_path <- withr::local_tempfile(fileext = ".json")
  expect_warning(
    run <- extract_first(pending_path),
    "msgbatch_1"
  )
  expect_equal(nrow(run$extractions), 0)
  expect_true(run$pending)
  expect_true(file.exists(pending_path))
})

test_that("a 429 while polling waits as long as retry-after asks", {
  waits <- c()
  polls <- 0L
  local_batch(alex_pages(), batch_answer("EMEA-H-C-004164", list(alex_row())))
  local_mocked_bindings(
    claude_batch_status = function(batch_id) {
      polls <<- polls + 1L
      if (polls == 1L) {
        rlang::abort(
          "HTTP 429",
          class = c("claude_api_http_429", "claude_api_error"),
          retry_after = "120"
        )
      }
      list(status = "ended", results_url = "https://x/results")
    },
    wait_seconds = function(seconds) {
      waits <<- c(waits, seconds)
      invisible(NULL)
    }
  )
  run <- extract_first()
  expect_equal(waits, 120)
  expect_equal(run$extractions$status, "ok")
})

test_that("the extractor needs the API key before fetching anything", {
  withr::local_envvar(ANTHROPIC_API_KEY = "")
  expect_error(
    extract_efficacy_batch(plan_sample(), "claude-sonnet-5-5", 0),
    "ANTHROPIC_API_KEY"
  )
})

fetch_quietly <- function(cache) {
  suppressMessages(fetch_efficacy_pages(plan_sample()[1, ], cache))
}

local_download <- function(status, body = "%PDF-1.7\n", env = parent.frame()) {
  local_mocked_bindings(
    download_efficacy_pdf = function(url, path) {
      writeBin(charToRaw(body), path)
      status
    },
    read_pdf_pages = function(path) c("page one", "page two"),
    wait_seconds = function(seconds) invisible(NULL),
    .env = env
  )
}

test_that("PDF pages are read once and cached", {
  cache <- withr::local_tempdir()
  local_download(200L)
  expect_equal(
    fetch_quietly(cache)$pages,
    c("page one", "page two")
  )
  expect_match(
    list.files(cache),
    "^EMEA-H-C-004164-2026-03-31-[0-9a-f]{8}[.]rds$"
  )
  local_mocked_bindings(
    download_efficacy_pdf = function(url, path) stop("no download expected")
  )
  expect_equal(
    fetch_quietly(cache)$pages,
    c("page one", "page two")
  )
})

test_that("a missing PDF is not_found; other answers stop the fetching", {
  cache <- withr::local_tempdir()
  local_download(404L)
  expect_equal(fetch_quietly(cache)$status, "not_found")
  local_download(429L)
  expect_equal(
    fetch_quietly(cache)$stop,
    "EMA returned HTTP 429"
  )
  local_download(200L, body = "<html>challenge</html>")
  expect_match(fetch_quietly(cache)$stop, "non-PDF")
  local_download(200L)
  local_mocked_bindings(read_pdf_pages = function(path) stop("damaged"))
  expect_equal(fetch_quietly(cache)$status, "failed")
  expect_length(list.files(cache), 0)
})

test_that("the files round-trip with list columns and dates", {
  path <- withr::local_tempfile(fileext = ".json")
  rows <- efficacy_row_table(list(list(
    ema_product_number = "EMEA/H/C/004164", row_key = "a", row_order = 1L,
    trial = "ALEX", n_treatment = 152L, ci_level = 97.38, is_primary = NA,
    ci_is_range = FALSE, quotes = list("one", "two"), page = 3L,
    source_date = as.Date("2026-03-31"), flags = character(),
    review = "auto_ok", extracted_at = as.Date("2026-09-30")
  )))
  write_json_table(rows, path)
  expect_equal(read_efficacy_rows(path), rows)
  expect_equal(nrow(read_efficacy_rows(tempfile())), 0)
  expect_equal(nrow(read_efficacy_extractions(tempfile())), 0)
})

test_that("the row columns follow the prompt's schema", {
  expect_equal(
    names(efficacy_field_types),
    names(efficacy_row_properties())
  )
})

write_run_inputs <- function(directory) {
  medicines <- dplyr::tibble(
    ema_product_number = c("EMEA/H/C/003933", "EMEA/H/C/000697"),
    name_of_medicine = c("Fintepla", "Suboxone"),
    medicine_status = c("Authorised", "Authorised"),
    therapeutic_indication = c("Dravet syndrome …", "Opioid dependence …")
  )
  write_json_table(medicines, file.path(directory, "ema_medicines.json"))
  old_rows <- efficacy_row_table(list(
    list(
      ema_product_number = "EMEA/H/C/000697", row_key = "kept", row_order = 1L,
      quotes = list("q"), flags = character(), review = "reviewed_ok"
    )
  ))
  write_json_table(old_rows, file.path(directory, "rows.json"))
  old_extractions <- dplyr::tibble(
    ema_product_number = "EMEA/H/C/000697",
    document_url = paste0(
      "https://www.ema.europa.eu/en/documents/product-information/",
      "suboxone-epar-product-information_en.pdf"
    ),
    document_last_updated_date = as.Date("2026-09-25"),
    status = "ok"
  )
  write_json_table(old_extractions, file.path(directory, "extractions.json"))
}

run_in <- function(directory, ...) {
  run_efficacy_extraction(
    budget = 5, model = "claude-sonnet-5-5", poll_seconds = 0,
    medicines_path = file.path(directory, "ema_medicines.json"),
    documents_path = fixture_epar_documents_path(),
    rows_path = file.path(directory, "rows.json"),
    extractions_path = file.path(directory, "extractions.json"),
    pending_path = file.path(directory, "pending-batch.json"),
    today = as.Date("2026-09-30"),
    ...
  )
}

test_that("a run extracts the planned products and keeps the others' rows", {
  directory <- withr::local_tempdir()
  write_run_inputs(directory)
  local_batch(
    c(paste(
      "5.1 Pharmacodynamic properties\nMechanism only.",
      "5.2 Pharmacokinetic properties",
      sep = "\n"
    )),
    batch_answer("EMEA-H-C-003933", list())
  )
  withr::local_envvar(APPROVAL_ATLAS_EFFICACY_ONLY = "")
  run <- suppressMessages(run_in(directory))
  expect_equal(run$extracted$ema_product_number, "EMEA/H/C/003933")
  extractions <- read_efficacy_extractions(
    file.path(directory, "extractions.json")
  )
  expect_equal(extractions$status, c("ok", "no_rows"))
  rows <- read_efficacy_rows(file.path(directory, "rows.json"))
  expect_equal(rows$row_key, "kept")
  expect_equal(rows$review, "reviewed_ok")
})

test_that("a run needs a pipeline run's files", {
  directory <- withr::local_tempdir()
  expect_error(
    run_efficacy_extraction(
      medicines_path = file.path(directory, "none.json"),
      documents_path = file.path(directory, "none-either.json")
    ),
    "run-pipeline.R"
  )
})

test_that("a second run finds nothing to extract; failures are reported", {
  directory <- withr::local_tempdir()
  write_run_inputs(directory)
  withr::local_envvar(APPROVAL_ATLAS_EFFICACY_ONLY = "")
  local_batch(alex_pages(), batch_answer(
    "EMEA-H-C-003933",
    list(alex_row(value = "0.99"))
  ))
  messages <- testthat::capture_messages(run <- run_in(directory))
  expect_equal(run$extracted$status, "failed")
  expect_match(messages, "no row passed verification", all = FALSE)
  expect_match(messages, "ALEX, PFS: value = '0.99'", all = FALSE)
  expect_match(
    messages, "Failed, not retried until the product information",
    all = FALSE
  )
  # A lasting failure is not retried by itself, only when asked for.
  expect_message(run <- run_in(directory), "No product to extract")
  expect_equal(nrow(run$extracted), 0)
  local_batch(alex_pages(), batch_answer("EMEA-H-C-003933", list()))
  withr::local_envvar(APPROVAL_ATLAS_EFFICACY_ONLY = "EMEA/H/C/003933")
  expect_equal(
    suppressMessages(run_in(directory))$extracted$status,
    "no_rows"
  )
})

test_that("the run summary says which failures are retried", {
  extractions <- dplyr::bind_rows(
    efficacy_extraction_record(
      plan_sample(budget = 1), "failed", as.Date("2026-09-30"),
      reason = "errored: overloaded_error"
    ),
    efficacy_extraction_record(
      plan_sample(budget = 2)[2, ], "failed", as.Date("2026-09-30"),
      reason = "errored: invalid_request_error"
    )
  )
  run <- list(
    rows = empty_efficacy_rows(), extractions = extractions,
    failed_rows = empty_failed_efficacy_rows()
  )
  messages <- paste(
    testthat::capture_messages(report_efficacy_run(run, run$rows)),
    collapse = ""
  )
  expect_match(
    messages,
    "Failed, retried on the next run[^\n]*\n[^\n]*overloaded_error"
  )
  expect_match(
    messages,
    "Failed, not retried until[^\n]*\n[^\n]*invalid_request_error"
  )
})

test_that("a pending batch is collected before anything is planned", {
  directory <- withr::local_tempdir()
  write_run_inputs(directory)
  pending_path <- file.path(directory, "pending-batch.json")
  plan <- plan_efficacy_extractions(
    jsonlite::fromJSON(file.path(directory, "ema_medicines.json")),
    select_epar_documents(
      read_epar_documents(fixture_epar_documents_path())$data
    ),
    empty_efficacy_extractions(), 1,
    only = "EMEA/H/C/003933"
  )
  write_pending_batch(pending_path, "msgbatch_9", "claude-opus-5-5", plan)
  local_batch(
    alex_pages(),
    batch_answer("EMEA-H-C-003933", list(alex_row()))
  )
  local_mocked_bindings(
    create_claude_batch = function(requests) stop("no new batch expected"),
    fetch_efficacy_pages = function(plan_row) stop("no fetch expected"),
    cached_efficacy_pages = function(plan_row) alex_pages()
  )
  run <- suppressMessages(run_in(directory))
  expect_equal(run$extracted$ema_product_number, "EMEA/H/C/003933")
  expect_equal(run$extracted$status, "ok")
  expect_equal(run$extracted$extractor_model, "claude-opus-5-5")
  rows <- read_efficacy_rows(file.path(directory, "rows.json"))
  expect_equal(nrow(rows), 2L)
  expect_false(file.exists(pending_path))
})

pending_run_directory <- function(env = parent.frame()) {
  directory <- withr::local_tempdir(.local_envir = env)
  write_run_inputs(directory)
  plan <- plan_efficacy_extractions(
    jsonlite::fromJSON(file.path(directory, "ema_medicines.json")),
    select_epar_documents(
      read_epar_documents(fixture_epar_documents_path())$data
    ),
    empty_efficacy_extractions(), 2,
    only = c("EMEA/H/C/003933", "EMEA/H/C/000697")
  )
  write_pending_batch(
    file.path(directory, "pending-batch.json"), "msgbatch_9",
    "claude-opus-5-5", plan
  )
  directory
}

test_that("a resumed batch without its texts stops before collecting", {
  directory <- pending_run_directory()
  pending_path <- file.path(directory, "pending-batch.json")
  local_batch(alex_pages(), list())
  local_mocked_bindings(
    fetch_efficacy_pages = function(plan_row) stop("no fetch expected"),
    claude_batch_status = function(batch_id) stop("no collecting expected"),
    cached_efficacy_pages = function(plan_row) {
      if (plan_row$ema_product_number == "EMEA/H/C/003933") alex_pages()
    }
  )
  expect_error(
    suppressMessages(run_in(directory)),
    "EMEA/H/C/000697"
  )
  expect_true(file.exists(pending_path))
  expect_equal(read_pending_batch(pending_path)$batch_id, "msgbatch_9")
})

test_that("cached page texts are read without fetching", {
  cache <- withr::local_tempdir()
  plan_row <- plan_sample(budget = 1)
  expect_null(cached_efficacy_pages(plan_row, cache))
  saveRDS(c("page one"), efficacy_cache_file(plan_row, cache))
  expect_equal(cached_efficacy_pages(plan_row, cache), "page one")
})

test_that("the batch id is shown before it is saved; a failed save warns", {
  pending_path <- withr::local_tempfile(fileext = ".json")
  local_batch(alex_pages(), batch_answer("EMEA-H-C-004164", list(alex_row())))
  local_mocked_bindings(
    write_pending_batch = function(path, batch_id, model, plan, effort) {
      stop("disk full")
    }
  )
  messages <- character()
  warnings <- character()
  run <- withCallingHandlers(
    extract_efficacy_batch(
      plan_sample(budget = 1), "claude-sonnet-5-5",
      poll_seconds = 0, today = as.Date("2026-09-30"),
      pending_path = pending_path
    ),
    message = function(condition) {
      messages <<- c(messages, conditionMessage(condition))
      invokeRestart("muffleMessage")
    },
    warning = function(condition) {
      warnings <<- c(warnings, conditionMessage(condition))
      invokeRestart("muffleWarning")
    }
  )
  expect_match(messages[1], "msgbatch_1")
  expect_match(paste(warnings, collapse = " "), "msgbatch_1")
  expect_match(paste(warnings, collapse = " "), "Anthropic Console")
  expect_match(paste(warnings, collapse = " "), "disk full")
  # The batch is still collected in this run.
  expect_equal(run$extractions$status, "ok")
})

test_that("the pending file is replaced whole or not at all", {
  path <- withr::local_tempfile(fileext = ".json")
  plan <- plan_sample(budget = 1)
  write_pending_batch(path, "msgbatch_1", "claude-sonnet-5-5", plan)
  expect_false(file.exists(paste0(path, ".tmp")))
  local_mocked_bindings(
    write_json = function(x, path, ...) {
      writeLines("{\"batch_id\": \"msgbatch_2\", \"mod", path)
      stop("disk full")
    },
    .package = "jsonlite"
  )
  expect_error(
    write_pending_batch(path, "msgbatch_2", "claude-sonnet-5-5", plan),
    "disk full"
  )
  expect_equal(read_pending_batch(path)$batch_id, "msgbatch_1")
  expect_false(file.exists(paste0(path, ".tmp")))
})

test_that("a batch still pending after a run keeps its file", {
  directory <- withr::local_tempdir()
  write_run_inputs(directory)
  local_batch(alex_pages(), list())
  local_mocked_bindings(
    claude_batch_results = function(results_url) stop("results unavailable")
  )
  withr::local_envvar(APPROVAL_ATLAS_EFFICACY_ONLY = "")
  expect_warning(
    run <- suppressMessages(run_in(directory)),
    "results unavailable"
  )
  expect_equal(nrow(run$extracted), 0)
  expect_true(file.exists(file.path(directory, "pending-batch.json")))
})

test_that("the effort goes into the request, the record and the pending file", {
  pending_path <- withr::local_tempfile(fileext = ".json")
  sent <- NULL
  saved <- NULL
  local_batch(alex_pages(), batch_answer("EMEA-H-C-004164", list(alex_row())))
  local_mocked_bindings(
    create_claude_batch = function(requests) {
      sent <<- requests
      "msgbatch_1"
    },
    claude_batch_status = function(batch_id) {
      saved <<- read_pending_batch(pending_path)
      list(status = "ended", results_url = "https://x/results")
    }
  )
  run <- suppressMessages(extract_efficacy_batch(
    plan_sample(budget = 1), "claude-sonnet-5-5",
    poll_seconds = 0, today = as.Date("2026-09-30"),
    pending_path = pending_path, effort = "medium"
  ))
  expect_equal(sent[[1]]$params$output_config$effort, "medium")
  expect_equal(saved$effort, "medium")
  expect_equal(run$extractions$extractor_model, "claude-sonnet-5-5")
  expect_equal(run$extractions$extractor_effort, "medium")
})

test_that("a run at another effort extracts a lasting failure again", {
  directory <- withr::local_tempdir()
  write_run_inputs(directory)
  withr::local_envvar(APPROVAL_ATLAS_EFFICACY_ONLY = "")
  local_batch(alex_pages(), batch_answer(
    "EMEA-H-C-003933",
    list(alex_row(value = "0.99"))
  ))
  suppressMessages(run_in(directory))
  expect_message(run_in(directory), "No product to extract")
  local_batch(alex_pages(), batch_answer("EMEA-H-C-003933", list()))
  expect_message(
    run <- run_in(directory, effort = "max"),
    "at effort \"max\""
  )
  expect_equal(run$extracted$status, "no_rows")
  expect_equal(run$extracted$extractor_effort, "max")
  extractions <- read_efficacy_extractions(
    file.path(directory, "extractions.json")
  )
  expect_equal(
    extractions$extractor_effort[
      extractions$ema_product_number == "EMEA/H/C/003933"
    ],
    "max"
  )
})

test_that("an unknown effort stops the extractor before anything", {
  directory <- withr::local_tempdir()
  write_run_inputs(directory)
  local_mocked_bindings(
    fetch_efficacy_pages = function(plan_row) stop("no fetch expected"),
    create_claude_batch = function(requests) stop("no batch expected")
  )
  expect_error(run_in(directory, effort = "turbo"), "turbo")
  expect_error(run_in(directory, effort = c("low", "high")), "one effort")
  expect_false(file.exists(file.path(directory, "pending-batch.json")))
})

test_that("a resumed batch keeps its effort; one saved without it is high", {
  for (effort in c("low", NA)) {
    directory <- pending_run_directory()
    pending_path <- file.path(directory, "pending-batch.json")
    pending <- read_pending_batch(pending_path)
    write_pending_batch(
      pending_path, pending$batch_id, pending$model, pending$plan[1, ],
      effort = dplyr::coalesce(effort, "low")
    )
    if (is.na(effort)) {
      # As written before the effort was saved.
      lines <- readLines(pending_path)
      writeLines(lines[!grepl("\"effort\"", lines)], pending_path)
      expect_equal(read_pending_batch(pending_path)$effort, "high")
    }
    local_batch(
      alex_pages(),
      batch_answer("EMEA-H-C-003933", list(alex_row()))
    )
    local_mocked_bindings(
      create_claude_batch = function(requests) stop("no new batch expected"),
      fetch_efficacy_pages = function(plan_row) stop("no fetch expected"),
      cached_efficacy_pages = function(plan_row) alex_pages()
    )
    run <- suppressMessages(run_in(directory, effort = "medium"))
    expect_equal(run$extracted$extractor_model, "claude-opus-5-5")
    expect_equal(
      run$extracted$extractor_effort,
      dplyr::coalesce(effort, "high")
    )
  }
})

# Gold analysis of 2026-10-02 (.remember/efficacy/gold-analysis-20261002.md):
# the verifier's fixes that keep "never guess", whole rows through
# check_answer_row() to the site file.
fixture_pages <- function(name) {
  strsplit(read_fixture_text(name), "\f", fixed = TRUE)[[1]]
}

alex_irc_row <- function(...) {
  row <- list(
    trial = "BO28984 (ALEX)", endpoint = "PFS (IRC)", regimen = "Alecensa",
    comparator = "crizotinib", comparator_column_label = "Crizotinib",
    is_primary = "no", value = "0.50", ci_low = "0.36", ci_high = "0.70",
    ci_level = "95", arm_treatment = "25.7", arm_control = "10.4",
    quotes = list(
      "HR 0.50 [95 % CI] [0.36; 0.70]", "Median (months) 10.4 25.7"
    )
  )
  overrides <- list(...)
  row[names(overrides)] <- overrides
  pages <- fixture_pages("alecensa-pi-5.1.layout.txt")
  do.call(row_to_site, c(list(pages), row))
}

test_that("arm values a table places under their columns ship", {
  # Opus high hid 91 rows as arms_not_verified: the label in the header's
  # quote, the medians in their own.
  irc <- alex_irc_row()
  expect_null(irc$failed)
  expect_equal(irc$record$flags, character())
  expect_equal(irc$record$arm_control, "10.4")
  expect_equal(nrow(irc$site), 1L)
  expect_equal(irc$site$arm_treatment, "25.7")
  expect_equal(irc$site$arm_control, "10.4")
  expect_equal(irc$site$comparator_column_label, "Crizotinib")
  # Swapped, the row never ships: the table puts 10.4 under Crizotinib.
  swapped <- alex_irc_row(arm_treatment = "10.4", arm_control = "25.7")
  expect_match(swapped$failed$errors[[1]], "arms swapped", all = FALSE)
})

test_that("a stitched header quote is dropped with every arm field", {
  # IMpower150 OS, Opus high: the value, CI and p-value verified, the header
  # quote stitched to a row lines below failed the row.
  impower150 <- row_to_site(
    fixture_pages("tecentriq-pi-5.1.layout.txt"),
    trial = "IMpower150", endpoint = "OS", regimen = "Arm B",
    comparator = "Arm C", comparator_column_label = "Arm C",
    n_treatment = "400", n_control = "400", is_primary = "no",
    value = "0.76", ci_low = "0.63", ci_high = "0.93", ci_level = "95",
    p_value = "0.006", arm_treatment = "19.8", arm_control = "14.9",
    arm_measure = "Median time to events (months)",
    quotes = list(
      "Stratified hazard ratio‡^ (95% CI) 0.85 (0.71, 1.03) 0.76 (0.63, 0.93)",
      "Arm B Arm C OS interim analysis* n = 402 n = 400 n = 400",
      "p-value 0.0983 0.006"
    )
  )
  expect_null(impower150$failed)
  expect_true("quote_dropped" %in% impower150$record$flags)
  for (field in efficacy_arm_fields) {
    expect_null(impower150$record[[field]], info = field)
  }
  expect_false(any(grepl("Arm B Arm C", unlist(impower150$record$quotes))))
  expect_equal(impower150$rows$review, "flagged")
  expect_equal(nrow(impower150$site), 0L)
})

test_that("a word broken at a line-end hyphen is found, and its text", {
  # CA20977T, Opus high: "platinum-based" printed "platinum-" / "based".
  page <- paste(
    "5.1 Pharmacodynamic properties",
    "Randomised trial (CA20977T)",
    paste(
      "A total of 461 patients were randomised to receive either nivolumab",
      "in combination with platinum-"
    ),
    paste(
      "based chemotherapy followed by nivolumab monotherapy (n = 229) or",
      "platinum-based chemotherapy"
    ),
    "followed by placebo (n = 232). EFS: HR = 0.58 (97.36% CI: 0.42, 0.81).",
    sep = "\n"
  )
  ca20977t <- row_to_site(
    c(page, "5.2 Pharmacokinetic properties"),
    trial = "CA20977T", endpoint = "EFS",
    regimen = "nivolumab in combination with platinum-based chemotherapy",
    comparator = "platinum-based chemotherapy", value = "0.58",
    ci_low = "0.42", ci_high = "0.81", ci_level = "95",
    quotes = list(
      "EFS: HR = 0.58 (97.36% CI: 0.42, 0.81)",
      paste(
        "nivolumab in combination with platinum-based chemotherapy followed",
        "by nivolumab monotherapy (n = 229)"
      )
    )
  )
  expect_null(ca20977t$failed)
  expect_false("quote_dropped" %in% ca20977t$record$flags)
  expect_false("text_not_in_source" %in% ca20977t$record$flags)
})

test_that("a comparator wrapped over a table header is no paraphrase", {
  keytruda <- row_to_site(
    fixture_pages("keytruda-pi-5.1.layout.txt"),
    trial = "KEYNOTE-189", endpoint = "OS",
    comparator = "Placebo + Pemetrexed + Platinum Chemotherapy",
    value = "0.56", ci_low = "0.46", ci_high = "0.69", ci_level = "95",
    quotes = list("Hazard ratio† (95% CI) 0.56 (0.46, 0.69)")
  )
  expect_null(keytruda$failed)
  expect_equal(keytruda$record$flags, character())
  expect_equal(nrow(keytruda$site), 1L)
})

test_that("a CI printed under its value ships unflagged, another's never", {
  pages <- fixture_pages("alecensa-pi-5.1.layout.txt")
  dor <- function(value, ci_low, ci_high) {
    row_to_site(
      pages,
      trial = "NP28673", endpoint = "DOR (IRC)", is_primary = "no",
      effect_type = "single_arm_median", value = value, ci_low = ci_low,
      ci_high = ci_high, ci_level = "95", quotes = list(
        "Median (months) 15.2 14.9 [95 % CI] [11.2, 24.9] [6.9, NE]"
      )
    )
  }
  kept <- dor("15.2", "11.2", "24.9")
  expect_equal(kept$record$flags, character())
  expect_equal(nrow(kept$site), 1L)
  expect_false(is.null(dor("15.2", "6.9", "NE")$failed))
})

test_that("a rate with its count before the CI ships", {
  aura <- row_to_site(
    excerpt_pages("tagrisso-aura"),
    trial = "AURAex and AURA2", endpoint = "CNS ORR",
    effect_type = "single_arm_rate", is_primary = "no", value = "54%",
    ci_low = "39.3", ci_high = "68.2", ci_level = "95",
    quotes = list("A CNS ORR of 54% (27/50 patients; 95% CI: 39.3, 68.2)")
  )
  expect_null(aura$failed)
  expect_equal(nrow(aura$site), 1L)
  miscounted <- row_to_site(
    c(
      paste(
        "5.1 Pharmacodynamic properties",
        "CNS ORR of 54% (26/50; 95% CI: 39.3, 68.2)",
        sep = "\n"
      ),
      "5.2 Pharmacokinetic properties"
    ),
    effect_type = "single_arm_rate", value = "54%", ci_low = "39.3",
    ci_high = "68.2", quotes = list("54% (26/50; 95% CI: 39.3, 68.2)")
  )
  expect_match(
    miscounted$failed$errors[[1]], "value and CI not in one quote",
    all = FALSE
  )
})

# Review of the gold analysis's fixes (2026-10-02): the column tie took arm
# values from any line under the label, another endpoint's, another table's
# or another trial's, and shipped them. Each is hidden again, as at 3482af1.
keynote_024_pfs_row <- function(...) {
  row <- list(
    trial = "KEYNOTE-024", endpoint = "PFS", regimen = "Pembrolizumab",
    comparator = "Chemotherapy", comparator_column_label = "Chemotherapy",
    value = "0.50", ci_low = "0.37", ci_high = "0.68", ci_level = "95",
    arm_measure = "Median in months", arm_treatment = "10.3",
    arm_control = "6.0",
    quotes = list(
      "Hazard ratio* (95% CI) 0.50 (0.37, 0.68)",
      "Median in months (95% CI) 10.3 (6.7, NA) 6.0 (4.2, 6.2)"
    )
  )
  overrides <- list(...)
  row[names(overrides)] <- overrides
  pages <- fixture_pages("keytruda-pi-5.1.layout.txt")
  do.call(row_to_site, c(list(pages), row))
}

expect_arms_hidden <- function(checked, info = NULL) {
  expect_null(checked$failed, info = info)
  expect_true("arms_not_verified" %in% checked$record$flags, info = info)
  for (field in efficacy_arm_fields) {
    expect_null(checked$record[[field]], info = paste(info, field))
  }
  expect_equal(checked$rows$review, "flagged", info = info)
  expect_equal(nrow(checked$site), 0L, info = info)
}

test_that("arm values of another endpoint, table or trial never tie", {
  # Its own medians, in its own block of Table 14, ship.
  own <- keynote_024_pfs_row()
  expect_equal(own$record$flags, character())
  expect_equal(own$site$arm_treatment, "10.3")
  expect_equal(own$site$arm_control, "6.0")
  # Its own OS medians, the block below.
  expect_arms_hidden(keynote_024_pfs_row(
    arm_treatment = "30.0", arm_control = "14.2",
    quotes = list(
      "Hazard ratio* (95% CI) 0.50 (0.37, 0.68)",
      "Median in months (95% CI) 30.0 14.2"
    )
  ), "KEYNOTE-024 OS medians")
  # KEYNOTE-042's PFS medians, another trial's table under the same label.
  expect_arms_hidden(keynote_024_pfs_row(
    arm_treatment = "6.5", arm_control = "6.4",
    quotes = list(
      "Hazard ratio* (95% CI) 0.50 (0.37, 0.68)",
      "Median in months (95% CI) 6.5 (5.9, 8.5) 6.4 (6.2, 7.2)"
    )
  ), "KEYNOTE-042 PFS medians")
  # ALEX's PFS (IRC) hazard ratio with the ORR responders of Table 5.
  expect_arms_hidden(alex_irc_row(
    arm_treatment = "126 (82.9 %)", arm_control = "114 (75.5 %)",
    arm_measure = "Median (months)",
    quotes = list(
      "HR 0.50 [95 % CI] [0.36; 0.70]",
      "Responders n (%) 114 (75.5 %) 126 (82.9 %)"
    )
  ), "ALEX ORR responders")
  # ALEX's OS hazard ratio with the duration of response medians below it,
  # under their own heading with their own sizes.
  expect_arms_hidden(alex_irc_row(
    endpoint = "Overall survival", is_primary = "no", value = "0.78",
    ci_low = "0.56", ci_high = "1.08", arm_treatment = "42.3",
    arm_control = "11.1",
    quotes = list(
      "HR 0.78 [95 % CI] [0.56; 1.08]", "Median (months) 11.1 42.3"
    )
  ), "ALEX DOR medians")
})

# Review of the gold analysis's fixes: the tie trusted the model's label, so
# the treatment's header given as the comparator's, with arms and sizes read
# by column position, shipped every value on the wrong arm.
test_that("a label that does not name the comparator ties nothing", {
  header <- "Crizotinib Alecensa n = 151 n = 152"
  mislabelled <- alex_irc_row(
    comparator_column_label = "Alecensa", arm_treatment = "10.4",
    arm_control = "25.7", n_treatment = "151", n_control = "152",
    quotes = list(
      "HR 0.50 [95 % CI] [0.36; 0.70]", header, "Median (months) 10.4 25.7"
    )
  )
  expect_arms_hidden(mislabelled, "the treatment's header")
  # Labelled right, the same quotes ship arms and sizes on their arms.
  right <- alex_irc_row(
    n_treatment = "152", n_control = "151",
    quotes = list(
      "HR 0.50 [95 % CI] [0.36; 0.70]", header, "Median (months) 10.4 25.7"
    )
  )
  expect_equal(right$record$flags, character())
  expect_equal(right$site$arm_treatment, "25.7")
  expect_equal(right$site$n_treatment, 152L)
  expect_equal(right$site$n_control, 151L)
  # Sizes alone under a mislabel: the row ships without them.
  sizes <- alex_irc_row(
    comparator_column_label = "Alecensa", arm_treatment = "",
    arm_control = "", n_treatment = "151", n_control = "152",
    quotes = list("HR 0.50 [95 % CI] [0.36; 0.70]", header)
  )
  expect_equal(sizes$record$flags, character())
  expect_equal(nrow(sizes$site), 1L)
  expect_true(is.na(sizes$site$n_treatment))
  expect_true(is.na(sizes$site$n_control))
  expect_true(is.na(sizes$site$comparator_column_label))
})

# Review of the gold analysis's fixes: a CI the layout prints in the cell of
# another value was paired with the value above it.
test_that("an interval in another value's cell is not the value's CI", {
  pages <- fixture_pages("keytruda-pi-5.1.layout.txt")
  keynote_001 <- function(...) {
    row_to_site(
      pages,
      trial = "KEYNOTE-001", regimen = "Pembrolizumab", ci_level = "95",
      ...
    )
  }
  borrowed <- keynote_001(
    endpoint = "% ongoing at 24 months", effect_type = "single_arm_rate",
    value = "75", ci_low = "2.8", ci_high = "8.3",
    quotes = list(paste(
      "% ongoing at 24 months¶ 75% 71% PFS Median in months (95% CI) 4.9",
      "(2.8, 8.3)"
    ))
  )
  expect_match(
    borrowed$failed$errors[[1]], "value and CI not in one quote",
    all = FALSE
  )
  own <- keynote_001(
    endpoint = "PFS", effect_type = "single_arm_median", value = "4.9",
    ci_low = "2.8", ci_high = "8.3",
    quotes = list("Median in months (95% CI) 4.9 (2.8, 8.3)")
  )
  expect_null(own$failed)
  expect_equal(nrow(own$site), 1L)
})
