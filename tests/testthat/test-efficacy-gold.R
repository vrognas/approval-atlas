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

test_that("identical rows score no errors and full lead agreement", {
  rows <- gold()
  score <- score_against_gold(rows, rows)
  expect_equal(score$numeric_errors, 0L)
  expect_equal(score$missed_rows, 0L)
  expect_equal(score$extra_rows, 0L)
  expect_equal(score$lead_agreement, 1)
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

test_that("effect types and endpoints map between the two schemas", {
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
  expect_equal(gold_trial_word("ALEX (BO28984)"), "alex")
  expect_equal(gold_trial_word("CodeBreaK 100 phase 2"), "codebreak")
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

test_that("the MARIPOSA-2 pitfall fails on a claim of significance only", {
  rows <- gold()
  row <- as_extracted(rows[[gold_index(rows, "Rybrevant", "MARIPOSA-2")]])
  row$endpoint <- "OS"
  row$significance_stated <- paste(
    "not statistically significant (prespecified 0.0142)"
  )
  pitfalls <- function(rows_with) {
    score_against_gold(c(purrr::map(rows, as_extracted), list(rows_with)), rows)
  }
  expect_true(pitfalls(row)$pitfalls[["mariposa2_significance"]])
  row$significance_stated <- "statistically significant"
  expect_false(pitfalls(row)$pitfalls[["mariposa2_significance"]])
  row$significance_stated <- "Non-significant"
  expect_true(pitfalls(row)$pitfalls[["mariposa2_significance"]])
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

test_that("a model passes with no numeric error, leads and pitfalls", {
  good <- list(
    numeric_errors = 0L, lead_agreement = 0.95,
    pitfalls = c(a = TRUE, b = TRUE)
  )
  expect_true(gold_model_passes(good))
  expect_false(gold_model_passes(modifyList(good, list(numeric_errors = 1L))))
  expect_false(gold_model_passes(modifyList(good, list(lead_agreement = 0.9))))
  expect_false(
    gold_model_passes(modifyList(good, list(pitfalls = c(a = TRUE, b = FALSE))))
  )
})

test_that("cost follows the model's price per million tokens", {
  expect_equal(gold_cost("claude-sonnet-5-5", 1e6, 1e6), 12)
  expect_equal(gold_cost("claude-opus-5-5", 500000, 100000), 4)
  expect_true(is.na(gold_cost("claude-other", 1, 1)))
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
  list(
    selection_path = selection,
    text_directory = fixtures,
    gold_path = file.path(fixtures, "gold-rows-sample.json"),
    medicines_path = medicines,
    output_directory = file.path(directory, "out")
  )
}

test_that("a gold evaluation scores each model and writes its files", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  calls <- new.env()
  calls$params <- list()
  send <- function(params) {
    calls$params <- c(calls$params, list(params))
    fake_message("Alecensa")
  }
  results <- run_gold_evaluation(
    models = "claude-sonnet-5-5",
    selection_path = inputs$selection_path,
    text_directory = inputs$text_directory,
    gold_path = inputs$gold_path,
    output_directory = inputs$output_directory,
    medicines_path = inputs$medicines_path,
    send_message = send
  )
  expect_length(calls$params, 1)
  expect_equal(calls$params[[1]]$model, "claude-sonnet-5-5")
  expect_equal(calls$params[[1]]$max_tokens, efficacy_batch_max_tokens)
  expect_match(
    calls$params[[1]]$messages[[1]]$content, "Alecensa indications"
  )
  expect_equal(results[["claude-sonnet-5-5"]]$rows_kept, 4L)
  result <- results[["claude-sonnet-5-5"]]
  expect_equal(result$usage$input_tokens, 1000)
  expect_equal(result$cost, (1000 * 2 + 500 * 10) / 1e6)
  expect_equal(result$score$numeric_errors, 0L)
  expect_true(file.exists(
    file.path(inputs$output_directory, "gold-eval-claude-sonnet-5-5.json")
  ))
  report <- readLines(file.path(inputs$output_directory, "gold-eval-report.md"))
  expect_true(any(grepl("claude-sonnet-5-5", report, fixed = TRUE)))
  expect_true(any(grepl("Numeric errors", report, fixed = TRUE)))
})

test_that("a gold evaluation stops before any call on a missing input", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  send <- function(params) stop("must not be called")
  expect_error(
    run_gold_evaluation(
      models = "claude-sonnet-5-5",
      selection_path = file.path(directory, "missing.json"),
      text_directory = inputs$text_directory,
      gold_path = inputs$gold_path,
      output_directory = inputs$output_directory,
      medicines_path = inputs$medicines_path,
      send_message = send
    ),
    "missing.json"
  )
})

test_that("a gold evaluation stops on a missing section text", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  send <- function(params) stop("must not be called")
  expect_error(
    run_gold_evaluation(
      models = "claude-sonnet-5-5",
      selection_path = inputs$selection_path,
      text_directory = directory,
      gold_path = inputs$gold_path,
      output_directory = inputs$output_directory,
      medicines_path = inputs$medicines_path,
      send_message = send
    ),
    "alecensa-pi-5.1.layout.txt"
  )
})

test_that("a failed call is recorded and the run goes on", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  send <- function(params) {
    cli::cli_abort("boom", class = "claude_api_http_500")
  }
  results <- run_gold_evaluation(
    models = "claude-sonnet-5-5",
    selection_path = inputs$selection_path,
    text_directory = inputs$text_directory,
    gold_path = inputs$gold_path,
    output_directory = inputs$output_directory,
    medicines_path = inputs$medicines_path,
    send_message = send
  )
  result <- results[["claude-sonnet-5-5"]]
  expect_equal(result$calls$status, "errored")
  expect_equal(result$rows_kept, 0L)
  expect_gt(result$score$missed_rows, 0L)
})

test_that("an authentication failure stops the run", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  send <- function(params) {
    cli::cli_abort("no", class = "claude_api_http_401")
  }
  expect_error(
    run_gold_evaluation(
      models = "claude-sonnet-5-5",
      selection_path = inputs$selection_path,
      text_directory = inputs$text_directory,
      gold_path = inputs$gold_path,
      output_directory = inputs$output_directory,
      medicines_path = inputs$medicines_path,
      send_message = send
    ),
    class = "claude_api_http_401"
  )
})
