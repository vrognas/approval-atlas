gold <- function() {
  jsonlite::fromJSON(
    testthat::test_path("fixtures", "efficacy", "gold-rows-sample.json"),
    simplifyVector = FALSE
  )
}

gold_index <- function(rows, medicine, trial_start, endpoint = NULL) {
  which(purrr::map_lgl(rows, function(row) {
    row$medicine == medicine &&
      startsWith(row$trial, trial_start) &&
      (is.null(endpoint) || row$endpoint == endpoint)
  }))
}

# A gold row as the extractor schema states it: its own words for the effect
# and the analysis, the role and population match the pilot never recorded.
as_extracted <- function(row, role = "primary") {
  list(
    medicine = row$medicine,
    trial = row$trial,
    endpoint = row$endpoint,
    indication = row$setting,
    is_primary = row$is_primary,
    analysis_role = role,
    population_match = "whole_trial_matches",
    effect_type = switch(row$effect_type,
      HR = "hr",
      "rate (single arm)" = "single_arm_rate",
      "median (single arm)" = "single_arm_median"
    ),
    value = row$value,
    ci_low = row$ci_low,
    ci_high = row$ci_high,
    arm_treatment = row$arm_treatment,
    arm_control = row$arm_control,
    significance_stated = NULL,
    ci_is_range = if (identical(row$endpoint, "DoR")) TRUE else FALSE
  )
}

# A gold row of a made-up trial (Alecensa's first row as the template).
synthetic_row <- function(...) {
  modifyList(gold()[[1]], list(...))
}

test_that("identical rows score no errors and full lead agreement", {
  rows <- gold()
  score <- score_against_gold(rows, rows)
  expect_equal(score$numeric_errors, 0L)
  expect_equal(score$missed_rows, 0L)
  expect_equal(score$extra_rows, 0L)
  expect_equal(score$lead_agreement, 1)
  expect_equal(score$gold_rows, length(rows))
  expect_true(all(score$pitfalls))
})

test_that("a changed CI bound counts as a numeric error", {
  rows <- gold()
  changed <- rows
  changed[[1]]$ci_high <- "0.99"
  expect_equal(score_against_gold(changed, rows)$numeric_errors, 1L)
})

test_that("the ALEX arm swap is a failed pitfall", {
  rows <- gold()
  alex <- which(purrr::map_lgl(rows, \(row) startsWith(row$trial, "ALEX")))[1]
  swapped <- rows
  swapped[[alex]][c("arm_treatment", "arm_control")] <-
    rows[[alex]][c("arm_control", "arm_treatment")]
  score <- score_against_gold(swapped, rows)
  expect_false(score$pitfalls[["alex_column_order"]])
  expect_true(score_against_gold(rows, rows)$pitfalls[["alex_column_order"]])
})

test_that("a changed value on an endpoint's only row is one numeric error", {
  rows <- gold()
  changed <- rows
  changed[[1]]$value <- "0.42"
  score <- score_against_gold(changed, rows)
  expect_equal(score$numeric_errors, 1L)
  expect_equal(score$missed_rows, 0L)
  expect_equal(score$extra_rows, 0L)
})

test_that("a changed value and CI on one row is still one numeric error", {
  rows <- gold()
  changed <- rows
  changed[[1]][c("value", "ci_low", "ci_high")] <- list("0.1", "0.0", "0.2")
  expect_equal(score_against_gold(changed, rows)$numeric_errors, 1L)
})

test_that("a right value with a wrong CI is a numeric error", {
  # Deliberate: the verifier cannot tell which of the printed numbers is wrong.
  rows <- gold()
  changed <- rows
  changed[[1]]$ci_low <- "0.01"
  expect_equal(score_against_gold(changed, rows)$numeric_errors, 1L)
})

test_that("missing and extra rows are counted", {
  rows <- gold()
  expect_equal(score_against_gold(rows[-1], rows)$missed_rows, 1L)
  extra <- c(rows, list(modifyList(rows[[1]], list(trial = "NEWTRIAL"))))
  score <- score_against_gold(extra, rows)
  expect_equal(score$extra_rows, 1L)
  expect_equal(score$missed_rows, 0L)
})

test_that("rows of the two IMpower110 analyses pair by their values", {
  rows <- gold()
  reversed <- rev(rows)
  score <- score_against_gold(reversed, rows)
  expect_equal(score$numeric_errors, 0L)
  expect_equal(score$missed_rows, 0L)
})

test_that("only SmPC gold rows are scored", {
  rows <- gold()
  epar <- modifyList(rows[[1]], list(source_doc = "EPAR", trial = "EPARONLY"))
  expect_equal(score_against_gold(rows, c(rows, list(epar)))$missed_rows, 0L)
  expect_equal(score_against_gold(c(rows, list(epar)), rows)$extra_rows, 0L)
})

test_that("extractor-schema rows match gold rows in the pilot's words", {
  rows <- gold()
  extracted <- purrr::map(rows, as_extracted)
  score <- score_against_gold(extracted, rows)
  expect_equal(score$numeric_errors, 0L)
  expect_equal(score$missed_rows, 0L)
  expect_equal(score$extra_rows, 0L)
})

test_that("a long endpoint name and a bare trial name still match", {
  rows <- gold()
  extracted <- purrr::map(rows, as_extracted)
  alex <- gold_index(rows, "Alecensa", "ALEX", "PFS")
  extracted[[alex]]$endpoint <- "Progression-free survival (PFS)"
  extracted[[alex]]$trial <- "ALEX"
  expect_equal(score_against_gold(extracted, rows)$missed_rows, 0L)
})

test_that("effect types, endpoints and trial names map between the schemas", {
  expect_equal(gold_effect_type("HR"), "hr")
  expect_equal(gold_effect_type("hr"), "hr")
  expect_equal(gold_effect_type("HR non-inferiority"), "hr_noninferiority")
  expect_equal(gold_effect_type("rate (single arm)"), "single_arm_rate")
  expect_equal(gold_effect_type("median (single arm)"), "single_arm_median")
  expect_equal(gold_effect_type("rate difference (percentage points)"),
               "rate_difference")
  expect_true(is.na(gold_effect_type("pre-specified threshold")))
  expect_equal(gold_endpoint("overall survival"), "OS")
  expect_equal(gold_endpoint("Duration of response (DoR)"), "DOR")
  expect_equal(gold_endpoint("PFS"), "PFS")
})

test_that("trial names fold to a first word and a following number", {
  expect_equal(gold_trial_key("ALEX (BO28984)"), "alex")
  expect_equal(gold_trial_key("KEYNOTE 024"), "keynote-024")
  expect_equal(gold_trial_key("KEYNOTE-024"), "keynote-024")
  expect_equal(gold_trial_key("keynote_024 (MK-3475-024)"), "keynote-024")
  expect_equal(gold_trial_key("CheckMate 227"), "checkmate-227")
  expect_equal(gold_trial_key("CodeBreaK 100 phase 2 part A"), "codebreak-100")
  expect_equal(gold_trial_key("BGB-A317-304"), "bgb-a317-304")
  expect_equal(gold_trial_key("MARIPOSA-2"), "mariposa-2")
  expect_equal(gold_trial_key("IMpower110 (GO29431)"), "impower110")
  expect_equal(gold_trial_key(NULL), "")
})

test_that("a trial label variant does not hide a wrong number", {
  rows <- gold()
  extracted <- purrr::map(rows, as_extracted)
  pfs <- gold_index(rows, "Keytruda", "KEYNOTE-024", "PFS")
  extracted[[pfs]]$trial <- "KEYNOTE 024"
  expect_equal(score_against_gold(extracted, rows)$numeric_errors, 0L)
  extracted[[pfs]]$value <- "0.99"
  score <- score_against_gold(extracted, rows)
  expect_equal(score$numeric_errors, 1L)
  expect_equal(score$missed_rows, 0L)
  expect_equal(score$extra_rows, 0L)
})

test_that("an unrecognised trial label with the endpoint still pairs", {
  rows <- gold()
  extracted <- purrr::map(rows, as_extracted)
  pfs <- gold_index(rows, "Keytruda", "KEYNOTE-091", "DFS")
  extracted[[pfs]]$trial <- "pembrolizumab adjuvant study"
  extracted[[pfs]]$value <- "0.99"
  score <- score_against_gold(extracted, rows)
  expect_equal(score$numeric_errors, 1L)
  expect_equal(score$missed_rows, 0L)
  expect_equal(score$extra_rows, 0L)
})

test_that("a row with neither trial nor endpoint in common stays unpaired", {
  rows <- gold()
  extracted <- purrr::map(rows, as_extracted)
  pfs <- gold_index(rows, "Keytruda", "KEYNOTE-091", "DFS")
  extracted[[pfs]]$trial <- "another study"
  extracted[[pfs]]$endpoint <- "ORR"
  score <- score_against_gold(extracted, rows)
  expect_equal(score$missed_rows, 1L)
  expect_equal(score$extra_rows, 1L)
  expect_equal(score$numeric_errors, 0L)
})

test_that("a lead row that disagrees with the gold lowers lead agreement", {
  rows <- gold()
  extracted <- purrr::map(rows, as_extracted, role = "later")
  # KEYNOTE-024's OS (not primary) is marked the only primary: it leads.
  pfs <- gold_index(rows, "Keytruda", "KEYNOTE-024", "PFS")
  os <- gold_index(rows, "Keytruda", "KEYNOTE-024", "OS")
  extracted[[pfs]]$is_primary <- FALSE
  extracted[[os]]$is_primary <- TRUE
  score <- score_against_gold(extracted, rows)
  expect_lt(score$lead_agreement, 1)
  expect_gt(score$lead_agreement, 0.9)
})

test_that("lead agreement is zero without extracted rows", {
  expect_equal(score_against_gold(list(), gold())$lead_agreement, 0)
})

test_that("a trial in two settings has a lead in each, gold against gold", {
  rows <- list(
    synthetic_row(
      trial = "STUDYX", setting = "1L", endpoint = "OS", value = "0.50",
      is_primary = TRUE
    ),
    synthetic_row(
      trial = "STUDYX", setting = "2L", endpoint = "OS", value = "0.70",
      is_primary = TRUE
    )
  )
  expect_equal(score_against_gold(rows, rows)$lead_agreement, 1)
  # The second setting is not extracted: its gold lead is a disagreement.
  expect_equal(score_against_gold(rows[1], rows)$lead_agreement, 0.5)
})

test_that("a medicine dropped altogether counts against lead agreement", {
  rows <- gold()
  keytruda <- purrr::map_lgl(rows, \(row) row$medicine == "Keytruda")
  score <- score_against_gold(rows[!keytruda], rows)
  expect_lt(score$lead_agreement, 0.95)
})

test_that("the IMpower110 pitfall needs the 0.59 row marked primary", {
  rows <- gold()
  extracted <- purrr::map(rows, as_extracted)
  expect_true(
    score_against_gold(extracted, rows)$pitfalls[["impower110_primary"]]
  )
  interim <- gold_index(rows, "Tecentriq", "IMpower110")[1]
  extracted[[interim]]$analysis_role <- "later"
  expect_false(
    score_against_gold(extracted, rows)$pitfalls[["impower110_primary"]]
  )
})

test_that("significance is claimed only by un-negated wording", {
  expect_true(claims_significance("statistically significant"))
  expect_true(claims_significance("demonstrated a significant improvement"))
  expect_false(claims_significance("Non-significant"))
  expect_false(claims_significance("not statistically significant"))
  expect_false(claims_significance(""))
  expect_false(claims_significance("statistical significance was not reached"))
  expect_false(claims_significance("did not achieve statistical significance"))
  expect_false(claims_significance(paste(
    "This was not statistically significant (tested at a prespecified",
    "significance level of 0.0142)."
  )))
  expect_false(claims_significance(paste(
    "The p-value is compared to a 2-sided significance level of 0.0142.",
    "Thus the OS results are not significant as of the data cut-off."
  )))
})

mariposa2_os_row <- function(rows, significance) {
  row <- as_extracted(rows[[gold_index(rows, "Rybrevant", "MARIPOSA-2")]])
  row$endpoint <- "OS"
  row$significance_stated <- significance
  row
}

test_that("the MARIPOSA-2 pitfall fails on a claim of significance only", {
  rows <- gold()
  pitfalls <- function(significance) {
    extracted <- c(
      purrr::map(rows, as_extracted),
      list(mariposa2_os_row(rows, significance))
    )
    score_against_gold(extracted, rows)$pitfalls[["mariposa2_significance"]]
  }
  expect_true(pitfalls("not statistically significant (prespecified 0.0142)"))
  expect_false(pitfalls("statistically significant"))
  expect_true(pitfalls("Non-significant"))
  expect_true(pitfalls(paste(
    "This was not statistically significant (tested at a prespecified",
    "significance level of 0.0142)."
  )))
})

test_that("a MARIPOSA 2 label variant is still the MARIPOSA-2 trial", {
  rows <- gold()
  row <- mariposa2_os_row(rows, "statistically significant")
  row$trial <- "MARIPOSA 2"
  extracted <- c(purrr::map(rows, as_extracted), list(row))
  expect_false(
    score_against_gold(extracted, rows)$pitfalls[["mariposa2_significance"]]
  )
})

test_that("the MARIPOSA-2 pitfall without an OS row is noted, not hidden", {
  rows <- gold()
  extracted <- purrr::map(rows, as_extracted)
  score <- score_against_gold(extracted, rows)
  # The gold has no MARIPOSA-2 OS row either: absent is right, and said so.
  expect_true(score$pitfalls[["mariposa2_significance"]])
  expect_match(score$pitfall_notes, "MARIPOSA-2", all = FALSE)
  # A gold that expects the row makes its absence a failure.
  expected <- c(rows, list(modifyList(
    rows[[gold_index(rows, "Rybrevant", "MARIPOSA-2")]], list(endpoint = "OS")
  )))
  expect_false(
    score_against_gold(extracted, expected)$pitfalls[["mariposa2_significance"]]
  )
})

test_that("the Lumykras pitfall needs the DoR row flagged as a range", {
  rows <- gold()
  extracted <- purrr::map(rows, as_extracted)
  expect_true(score_against_gold(extracted, rows)$pitfalls[["lumykras_range"]])
  dor <- gold_index(rows, "Lumykras", "CodeBreaK", "DoR")
  extracted[[dor]]$ci_is_range <- FALSE
  expect_false(score_against_gold(extracted, rows)$pitfalls[["lumykras_range"]])
  expect_false(
    score_against_gold(extracted[-dor], rows)$pitfalls[["lumykras_range"]]
  )
})

test_that("a range printed like a CI is no numeric error, its value is", {
  rows <- gold()
  dor <- gold_index(rows, "Lumykras", "CodeBreaK", "DoR")
  expect_null(rows[[dor]]$ci_low)
  extracted <- purrr::map(rows, as_extracted)
  # What the prompt asks for: the bracketed range in ci_low / ci_high.
  extracted[[dor]][c("ci_low", "ci_high")] <- list("2.8", "11.1")
  score <- score_against_gold(extracted, rows)
  expect_equal(score$numeric_errors, 0L)
  expect_true(score$pitfalls[["lumykras_range"]])
  extracted[[dor]]$value <- "12.0"
  expect_equal(score_against_gold(extracted, rows)$numeric_errors, 1L)
  # Not flagged as a range, the same numbers are an invented interval.
  extracted[[dor]]$value <- "11.1"
  extracted[[dor]]$ci_is_range <- FALSE
  expect_equal(score_against_gold(extracted, rows)$numeric_errors, 1L)
})

acceptable <- function() {
  list(
    score = list(
      numeric_errors = 0L, lead_agreement = 0.95, gold_rows = 100L,
      missed_rows = 5L, pitfalls = c(a = TRUE, b = TRUE)
    ),
    calls = dplyr::tibble(
      medicine = c("A", "B"), status = "ok", rows_dropped = 0L
    )
  )
}

test_that("a model passes with no numeric error, leads and pitfalls", {
  good <- acceptable()
  expect_true(gold_model_passes(good))
  expect_length(gold_acceptance_problems(good), 0)
  bad <- function(...) modifyList(good, list(score = list(...)))
  expect_false(gold_model_passes(bad(numeric_errors = 1L)))
  expect_false(gold_model_passes(bad(lead_agreement = 0.9)))
  expect_false(gold_model_passes(bad(pitfalls = c(a = TRUE, b = FALSE))))
  expect_false(gold_model_passes(bad(pitfalls = c(a = TRUE, b = NA))))
})

test_that("a model that misses more than 5% of the gold rows fails", {
  good <- acceptable()
  good$score$missed_rows <- 6L
  expect_false(gold_model_passes(good))
  expect_match(gold_acceptance_problems(good), "missed", all = FALSE)
})

test_that("a call that did not answer, or rows dropped, fail the model", {
  good <- acceptable()
  good$calls$status[2] <- "truncated"
  expect_false(gold_model_passes(good))
  expect_match(gold_acceptance_problems(good), "B", all = FALSE)
  dropped <- acceptable()
  dropped$calls$rows_dropped[1] <- 1L
  expect_false(gold_model_passes(dropped))
  expect_match(gold_acceptance_problems(dropped), "dropped", all = FALSE)
})

test_that("cost follows the model's price per million tokens", {
  expect_equal(gold_cost("claude-sonnet-5-5", 1e6, 1e6, batch = FALSE), 12)
  expect_equal(gold_cost("claude-opus-5-5", 500000, 100000, batch = FALSE), 4)
  expect_true(is.na(gold_cost("claude-other", 1, 1)))
})

test_that("the batch price is half the list price", {
  expect_equal(gold_cost("claude-sonnet-5-5", 1e6, 1e6), 6)
  expect_equal(gold_cost("claude-opus-5-5", 500000, 100000), 2)
})

# A fake API answer holding the gold rows of one medicine in the row schema.
fake_message <- function(medicine, input_tokens = 1000, output_tokens = 500) {
  rows <- Filter(function(row) row$medicine == medicine, gold()) |>
    purrr::map(function(row) {
      text <- function(value) if (is.null(value)) "" else as.character(value)
      list(
        indication = "NSCLC", trial = row$trial, population = row$population,
        population_match = "not_stated", regimen = "", comparator = "",
        comparator_column_label = "", n_treatment = "", n_control = "",
        endpoint = row$endpoint, assessment = "",
        is_primary = if (isTRUE(row$is_primary)) "yes" else "not_stated",
        analysis_role = "not_stated", analysis = text(row$analysis),
        effect_type = "hr", value = text(row$value),
        ci_low = text(row$ci_low), ci_high = text(row$ci_high),
        ci_level = "", ci_is_range = FALSE, p_value = "",
        significance_stated = "", arm_treatment = text(row$arm_treatment),
        arm_control = text(row$arm_control), arm_measure = "",
        quotes = as.list(unlist(row$verbatim_quotes))
      )
    })
  list(
    stop_reason = "end_turn",
    content = list(list(
      type = "text",
      text = jsonlite::toJSON(
        list(rows = rows), auto_unbox = TRUE, null = "null"
      )
    )),
    usage = list(input_tokens = input_tokens, output_tokens = output_tokens)
  )
}

fake_result <- function(message,
                        type = "succeeded",
                        custom_id = "EMEA-H-C-004164") {
  list(
    custom_id = custom_id, type = type, message = message,
    error = if (type == "errored") "overloaded_error" else NA_character_
  )
}

# The batch functions of the driver, recording what they are asked.
fake_batch_api <- function(results, calls = new.env()) {
  calls$requests <- list()
  calls$created <- 0L
  calls$collected <- character()
  list(
    calls = calls,
    create = function(requests) {
      calls$requests <- c(calls$requests, list(requests))
      calls$created <- calls$created + 1L
      paste0("msgbatch_", calls$created)
    },
    status = function(batch_id) {
      list(status = "ended", results_url = "https://api.anthropic.com/results")
    },
    results = function(results_url) {
      calls$collected <- c(calls$collected, results_url)
      results
    }
  )
}

# The pilot's whole product information, as page texts split by form feeds: a
# page before section 5.1, section 5.1 and a page after it.
write_pilot_text <- function(text_directory, medicine = "alecensa") {
  dir.create(text_directory, showWarnings = FALSE)
  section <- paste(readLines(
    testthat::test_path("fixtures", "efficacy", "alecensa-pi-5.1.layout.txt"),
    warn = FALSE, encoding = "UTF-8"
  ), collapse = "\n")
  writeLines(
    paste0(
      "Summary of product characteristics\n4.1 Therapeutic indications\f",
      section, "\n\f5.2 Pharmacokinetic properties\nAbsorption\f"
    ),
    file.path(text_directory, paste0(medicine, "-pi.layout.txt")),
    useBytes = TRUE
  )
}

gold_run_inputs <- function(directory) {
  fixtures <- testthat::test_path("fixtures", "efficacy")
  selection <- file.path(directory, "selection.json")
  jsonlite::write_json(
    list(list(
      ema_product_number = "EMEA/H/C/004164", medicine = "Alecensa"
    )),
    selection, auto_unbox = TRUE
  )
  medicines <- file.path(directory, "ema_medicines.json")
  jsonlite::write_json(
    list(list(
      ema_product_number = "EMEA/H/C/004164",
      therapeutic_indication = "Alecensa indications"
    )),
    medicines, auto_unbox = TRUE
  )
  text_directory <- file.path(directory, "text")
  write_pilot_text(text_directory)
  list(
    selection_path = selection,
    text_directory = text_directory,
    gold_path = file.path(fixtures, "gold-rows-sample.json"),
    medicines_path = medicines,
    output_directory = file.path(directory, "out")
  )
}

run_gold <- function(inputs, api, models = "claude-sonnet-5-5") {
  run_gold_evaluation(
    models = models,
    selection_path = inputs$selection_path,
    text_directory = inputs$text_directory,
    gold_path = inputs$gold_path,
    output_directory = inputs$output_directory,
    medicines_path = inputs$medicines_path,
    batch_api = api
  )
}

test_that("a gold evaluation batches each model and writes its files", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  api <- fake_batch_api(list(fake_result(fake_message("Alecensa"))))
  results <- run_gold(inputs, api)
  requests <- api$calls$requests
  expect_length(requests, 1)
  expect_length(requests[[1]], 1)
  request <- requests[[1]][[1]]
  expect_equal(request$custom_id, "EMEA-H-C-004164")
  expect_equal(request$params$model, "claude-sonnet-5-5")
  expect_equal(request$params$max_tokens, efficacy_batch_max_tokens)
  content <- request$params$messages[[1]]$content
  expect_match(content, "Alecensa indications")
  # The section production sends: sliced from the page texts.
  expect_match(content, "Section 5.1:\n5.1 +Pharmacodynamic properties")
  expect_false(grepl("Absorption", content, fixed = TRUE))
  expect_false(grepl("4.1 Therapeutic indications", content, fixed = TRUE))
  result <- results[["claude-sonnet-5-5"]]
  expect_equal(result$rows_kept, 4L)
  expect_equal(result$usage$input_tokens, 1000)
  expect_equal(result$cost, (1000 * 2 + 500 * 10) / 1e6 / 2)
  expect_equal(result$score$numeric_errors, 0L)
  expect_true(file.exists(
    file.path(inputs$output_directory, "gold-eval-claude-sonnet-5-5.json")
  ))
  expect_false(file.exists(file.path(
    inputs$output_directory, "gold-pending-claude-sonnet-5-5.json"
  )))
  report <- readLines(file.path(inputs$output_directory, "gold-eval-report.md"))
  expect_true(any(grepl("claude-sonnet-5-5", report, fixed = TRUE)))
  expect_true(any(grepl("Numeric errors", report, fixed = TRUE)))
  expect_true(any(grepl("batch price", report, fixed = TRUE)))
})

test_that("each model gets its own batch", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  api <- fake_batch_api(list(fake_result(fake_message("Alecensa"))))
  results <- run_gold(
    inputs, api, models = c("claude-sonnet-5-5", "claude-opus-5-5")
  )
  expect_equal(api$calls$created, 2L)
  expect_named(results, c("claude-sonnet-5-5", "claude-opus-5-5"))
  models <- purrr::map_chr(api$calls$requests, \(r) r[[1]]$params$model)
  expect_equal(models, c("claude-sonnet-5-5", "claude-opus-5-5"))
})

test_that("a gold evaluation stops before any call on a missing input", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  api <- fake_batch_api(list())
  inputs$selection_path <- file.path(directory, "missing.json")
  expect_error(run_gold(inputs, api), "missing.json")
  expect_equal(api$calls$created, 0L)
})

test_that("a gold evaluation stops on a missing page text", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  api <- fake_batch_api(list())
  inputs$text_directory <- directory
  expect_error(run_gold(inputs, api), "alecensa-pi.layout.txt")
  expect_equal(api$calls$created, 0L)
})

test_that("a product information without section 5.1 stops the run", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  writeLines(
    "nothing here\fnor here",
    file.path(inputs$text_directory, "alecensa-pi.layout.txt")
  )
  api <- fake_batch_api(list())
  expect_error(run_gold(inputs, api), "Alecensa")
  expect_equal(api$calls$created, 0L)
})

test_that("a pending batch is saved before it is collected", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  api <- fake_batch_api(list())
  pending_path <- file.path(
    inputs$output_directory, "gold-pending-claude-sonnet-5-5.json"
  )
  seen <- new.env()
  status <- api$status
  api$status <- function(batch_id) {
    seen$pending <- jsonlite::fromJSON(pending_path, simplifyVector = FALSE)
    status(batch_id)
  }
  suppressWarnings(run_gold(inputs, api))
  expect_equal(seen$pending$batch_id, "msgbatch_1")
  expect_equal(seen$pending$model, "claude-sonnet-5-5")
  expect_equal(unlist(seen$pending$custom_ids), "EMEA-H-C-004164")
})

test_that("a rerun collects the pending batch instead of paying again", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  answer <- list(fake_result(fake_message("Alecensa")))
  first <- fake_batch_api(answer)
  # The results cannot be read this time: the pending file stays.
  first$results <- function(results_url) stop("connection reset")
  expect_warning(results <- run_gold(inputs, first), "connection reset")
  expect_length(results, 0)
  pending_path <- file.path(
    inputs$output_directory, "gold-pending-claude-sonnet-5-5.json"
  )
  expect_true(file.exists(pending_path))
  expect_false(file.exists(
    file.path(inputs$output_directory, "gold-eval-report.md")
  ))
  second <- fake_batch_api(answer)
  results <- run_gold(inputs, second)
  expect_equal(second$calls$created, 0L)
  expect_equal(results[["claude-sonnet-5-5"]]$rows_kept, 4L)
  expect_false(file.exists(pending_path))
})

test_that("a rerun reads a model's saved result instead of paying again", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  answer <- list(fake_result(fake_message("Alecensa")))
  first <- run_gold(inputs, fake_batch_api(answer))
  report_path <- file.path(inputs$output_directory, "gold-eval-report.md")
  report <- readLines(report_path)
  unlink(report_path)
  second_api <- fake_batch_api(answer)
  expect_message(
    second <- run_gold(inputs, second_api),
    "saved result of claude-sonnet-5-5"
  )
  expect_equal(second_api$calls$created, 0L)
  expect_length(second_api$calls$collected, 0)
  saved <- second[["claude-sonnet-5-5"]]
  original <- first[["claude-sonnet-5-5"]]
  expect_equal(saved$rows_kept, original$rows_kept)
  expect_equal(saved$score$numeric_errors, original$score$numeric_errors)
  expect_equal(saved$score$pitfalls, original$score$pitfalls)
  expect_equal(saved$calls$status, original$calls$status)
  # The same report from the saved result as from the run that made it.
  expect_equal(readLines(report_path), report)
})

test_that("a saved result of other medicines is not reused", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  answer <- list(fake_result(fake_message("Alecensa")))
  run_gold(inputs, fake_batch_api(answer))
  path <- file.path(inputs$output_directory, "gold-eval-claude-sonnet-5-5.json")
  saved <- jsonlite::fromJSON(path, simplifyVector = FALSE)
  saved$calls[[1]]$medicine <- "Other"
  jsonlite::write_json(saved, path, auto_unbox = TRUE, null = "null")
  api <- fake_batch_api(answer)
  run_gold(inputs, api)
  expect_equal(api$calls$created, 1L)
})

test_that("the report is written for the models collected so far", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  answer <- list(fake_result(fake_message("Alecensa")))
  api <- fake_batch_api(answer)
  # The second model's batch cannot be read: its pending file stays, and the
  # first model's report is written anyway.
  results_of <- api$results
  api$results <- function(results_url) {
    if (length(api$calls$collected) >= 1) stop("connection reset")
    results_of(results_url)
  }
  expect_warning(
    results <- run_gold(
      inputs, api, models = c("claude-sonnet-5-5", "claude-opus-5-5")
    ),
    "connection reset"
  )
  expect_named(results, "claude-sonnet-5-5")
  report <- readLines(file.path(inputs$output_directory, "gold-eval-report.md"))
  expect_true(any(grepl("claude-sonnet-5-5", report, fixed = TRUE)))
  expect_true(file.exists(file.path(
    inputs$output_directory, "gold-pending-claude-opus-5-5.json"
  )))
})

test_that("a pending batch for other medicines is not reused silently", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  dir.create(inputs$output_directory)
  jsonlite::write_json(
    list(
      batch_id = "msgbatch_old", model = "claude-sonnet-5-5",
      custom_ids = list("EMEA-H-C-000001")
    ),
    file.path(inputs$output_directory, "gold-pending-claude-sonnet-5-5.json"),
    auto_unbox = TRUE
  )
  api <- fake_batch_api(list())
  expect_error(run_gold(inputs, api), "gold-pending-claude-sonnet-5-5")
  expect_equal(api$calls$created, 0L)
})

test_that("a model's result is written as soon as its batch is collected", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  api <- fake_batch_api(list(fake_result(fake_message("Alecensa"))))
  results <- api$results
  api$results <- function(results_url) {
    if (length(api$calls$collected) == 1) {
      stop("second batch unreadable")
    }
    results(results_url)
  }
  expect_warning(
    run <- run_gold(
      inputs, api, models = c("claude-sonnet-5-5", "claude-opus-5-5")
    ),
    "second batch unreadable"
  )
  expect_named(run, "claude-sonnet-5-5")
  expect_true(file.exists(
    file.path(inputs$output_directory, "gold-eval-claude-sonnet-5-5.json")
  ))
  expect_true(file.exists(file.path(
    inputs$output_directory, "gold-pending-claude-opus-5-5.json"
  )))
})

test_that("an errored batch request fails the model, not the run", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  api <- fake_batch_api(list(fake_result(NULL, type = "errored")))
  results <- run_gold(inputs, api)
  result <- results[["claude-sonnet-5-5"]]
  expect_equal(result$calls$status, "errored")
  expect_equal(result$rows_kept, 0L)
  expect_gt(result$score$missed_rows, 0L)
  expect_false(gold_model_passes(result))
  report <- paste(readLines(
    file.path(inputs$output_directory, "gold-eval-report.md")
  ), collapse = "\n")
  expect_match(report, "Alecensa: errored")
})

test_that("a batch without the medicine's result fails the model", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  api <- fake_batch_api(list())
  result <- run_gold(inputs, api)[["claude-sonnet-5-5"]]
  expect_equal(result$calls$status, "no_result")
  expect_false(gold_model_passes(result))
})

test_that("a truncated answer fails the model", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  message <- fake_message("Alecensa")
  message$stop_reason <- "max_tokens"
  api <- fake_batch_api(list(fake_result(message)))
  result <- run_gold(inputs, api)[["claude-sonnet-5-5"]]
  expect_equal(result$calls$status, "truncated")
  expect_equal(result$usage$output_tokens, 500)
  expect_false(gold_model_passes(result))
  expect_match(
    gold_acceptance_problems(result), "Alecensa: truncated", all = FALSE
  )
})

test_that("rows dropped at parsing fail the model and are listed", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  message <- fake_message("Alecensa")
  answer <- jsonlite::fromJSON(
    message$content[[1]]$text, simplifyVector = FALSE
  )
  answer$rows[[1]]$ci_level <- "ninety five"
  message$content[[1]]$text <- jsonlite::toJSON(
    answer, auto_unbox = TRUE, null = "null"
  )
  api <- fake_batch_api(list(fake_result(message)))
  result <- run_gold(inputs, api)[["claude-sonnet-5-5"]]
  expect_equal(result$calls$rows_dropped, 1L)
  expect_false(gold_model_passes(result))
  report <- paste(readLines(
    file.path(inputs$output_directory, "gold-eval-report.md")
  ), collapse = "\n")
  expect_match(report, "Rows dropped at parsing")
  expect_match(report, "cannot read: ci_level")
})

test_that("an authentication failure creating the batch stops the run", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  api <- fake_batch_api(list())
  api$create <- function(requests) {
    cli::cli_abort("no", class = "claude_api_http_401")
  }
  expect_error(run_gold(inputs, api), class = "claude_api_http_401")
})
