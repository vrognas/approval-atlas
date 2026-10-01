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

related <- function(first, second) {
  gold_trial_names_related(gold_trial_names(first), gold_trial_names(second))
}

test_that("trial labels are related by a trial name they share", {
  expect_false(related("RAINBOW", "REVEL"))
  expect_false(related("RAINBOW", "RELAY"))
  expect_false(related("KEYNOTE-189", "KEYNOTE-407"))
  expect_false(related("Study 1540", "Study 1620"))
  expect_false(related("MARIPOSA-2", "MARIPOSA (NSC3003)"))
  expect_false(related("DESTINY-Lung01", "DESTINY-Lung02"))
  expect_true(related("BO28984, ALEX", "ALEX (BO28984)"))
  expect_true(related("BO40336; ALINA", "ALINA (BO40336)"))
  expect_true(related(
    "CodeBreaK 100 phase 2 part A", "Study 20170543 (CodeBreaK 100)"
  ))
  expect_true(related(
    "Multicentre, randomised, open label phase 3 study of ALIMTA",
    "Phase 3 study, ALIMTA vs docetaxel (name not given)"
  ))
  expect_true(related("CROWN (Study B7461006)", "CROWN (B7461006)"))
  expect_true(related("GEOMETRY mono-1", "GEOMETRY mono-1 (Cohorts 4 and 6)"))
  # Spellings of one name: separators, glued numbers, leading zeros.
  expect_true(related("KEYNOTE 024", "KEYNOTE-024"))
  expect_true(related("IMpower 110", "IMpower110 (GO29431)"))
  expect_true(related("KEYNOTE-24", "KEYNOTE-024"))
  # A description names no trial: the endpoint alone decides.
  expect_true(related("pembrolizumab adjuvant study", "KEYNOTE-091"))
  expect_true(related(NULL, "REVEL"))
  # Phase numbers and generic words name no trial.
  expect_equal(gold_trial_names("Phase III STUDY of ALIMTA"), "alimta")
  expect_equal(gold_trial_names("KEYNOTE-024"), "keynote 24")
  expect_equal(gold_trial_names("ALEX (BO28984)"), c("alex", "bo 28984"))
  expect_equal(gold_trial_names("DESTINY-Lung02"), "destiny lung 2")
})

test_that("a registry number only links labels, never separates them", {
  # Two labels with the same name and different numbers in brackets.
  expect_true(related("ALINA (BO40336)", "ALINA (NCT03456076)"))
  expect_true(related("ALEX (BO28984)", "ALEX (NCT02075840)"))
  expect_true(related("ALEX", "ALEX (BO28984)"))
  for (labels in list(
    c("ALINA (BO40336)", "ALINA (NCT03456076)"),
    c("ALEX (BO28984)", "ALEX (NCT02075840)")
  )) {
    gold_rows <- list(synthetic_row(
      medicine = "Alecensa", trial = labels[1], endpoint = "PFS",
      value = "0.47", ci_low = "0.34", ci_high = "0.65"
    ))
    wrong <- modifyList(gold_rows[[1]], list(trial = labels[2], value = "0.9"))
    score <- score_against_gold(list(wrong), gold_rows)
    expect_equal(score$numeric_errors, 1L, info = labels[2])
    expect_equal(score$missed_rows, 0L, info = labels[2])
  }
})

test_that("a trial never pairs with its numbered sibling", {
  # A bare MARIPOSA row left over when the model's MARIPOSA-2 row failed
  # verification paired with the gold's MARIPOSA-2 row.
  expect_false(related("MARIPOSA", "MARIPOSA-2"))
  expect_false(related("DESTINY", "DESTINY-Lung02"))
  expect_false(related("FLAURA", "FLAURA2"))
  expect_false(related("KEYNOTE", "KEYNOTE-024"))
  # Words after a name that hold no number are no other trial.
  expect_true(related("IMpower110 ITT", "IMpower110"))
  gold_rows <- list(synthetic_row(
    medicine = "Rybrevant", trial = "MARIPOSA-2", endpoint = "PFS",
    value = "0.48", ci_low = "0.36", ci_high = "0.64"
  ))
  for (trial in c("MARIPOSA", "MARIPOSA (NSC3003)")) {
    sibling <- modifyList(gold_rows[[1]], list(
      trial = trial, value = "0.70", ci_low = "0.58", ci_high = "0.85"
    ))
    score <- score_against_gold(list(sibling), gold_rows)
    expect_equal(score$numeric_errors, 0L, info = trial)
    expect_equal(score$missed_rows, 1L, info = trial)
    expect_equal(score$extra_rows, 1L, info = trial)
  }
  destiny <- list(synthetic_row(
    medicine = "Enhertu", trial = "DESTINY-Lung02", endpoint = "ORR",
    value = "49.0", ci_low = "39.0", ci_high = "59.1"
  ))
  bare <- modifyList(destiny[[1]], list(trial = "DESTINY", value = "54.9"))
  expect_equal(score_against_gold(list(bare), destiny)$numeric_errors, 0L)
})

test_that("an endpoint alone does not pair two named trials (RAINBOW, REVEL)", {
  # Cyramza's gastric-cancer RAINBOW PFS was paired with an NSCLC gold row by
  # its endpoint alone (gold evaluation of 2026-10-01): a numeric error that
  # was none.
  gold_rows <- list(synthetic_row(
    medicine = "Cyramza", trial = "REVEL", endpoint = "PFS",
    value = "0.762", ci_low = "0.677", ci_high = "0.859"
  ))
  rainbow <- modifyList(gold_rows[[1]], list(
    trial = "RAINBOW", value = "0.635", ci_low = "0.536", ci_high = "0.752"
  ))
  score <- score_against_gold(list(rainbow), gold_rows)
  expect_equal(score$numeric_errors, 0L)
  expect_equal(score$missed_rows, 1L)
  expect_equal(score$extra_rows, 1L)
  relay <- modifyList(gold_rows[[1]], list(trial = "RELAY", value = "0.591"))
  expect_equal(
    score_against_gold(list(rainbow), list(relay))$numeric_errors, 0L
  )
})

test_that("trials folded to one key still pair only with themselves", {
  # Enhertu's SmPC reports DESTINY-Lung01, -Lung02 and -Lung04 (NSCLC), all
  # keyed "destiny".
  gold_rows <- list(synthetic_row(
    medicine = "Enhertu", trial = "DESTINY-Lung02", endpoint = "ORR",
    value = "49.0", ci_low = "39.0", ci_high = "59.1"
  ))
  lung01 <- modifyList(gold_rows[[1]], list(
    trial = "DESTINY-Lung01", value = "54.9", ci_low = "44.2", ci_high = "65.4"
  ))
  score <- score_against_gold(list(lung01), gold_rows)
  expect_equal(score$numeric_errors, 0L)
  expect_equal(score$missed_rows, 1L)
  expect_equal(score$extra_rows, 1L)
})

test_that("a trial alone does not pair two different known endpoints", {
  # Retsevmo's LIBRETTO-431 OS row was paired with the gold's PFS row of that
  # trial (the extracted PFS row had failed verification).
  gold_rows <- list(synthetic_row(
    medicine = "Retsevmo", trial = "LIBRETTO-431", endpoint = "PFS",
    value = "0.465", ci_low = "0.309", ci_high = "0.699"
  ))
  os <- modifyList(gold_rows[[1]], list(
    endpoint = "Overall survival", value = "1.259", ci_low = "0.777",
    ci_high = "2.040"
  ))
  score <- score_against_gold(list(os), gold_rows)
  expect_equal(score$numeric_errors, 0L)
  expect_equal(score$missed_rows, 1L)
  expect_equal(score$extra_rows, 1L)
})

test_that("a trial alone does not pair an endpoint its label does not name", {
  # With its OS row kept apart, Retsevmo's LIBRETTO-431 "time to worsening"
  # row was the next to pair with the gold's PFS row.
  gold_rows <- list(synthetic_row(
    medicine = "Retsevmo", trial = "LIBRETTO-431", endpoint = "PFS",
    value = "0.465", ci_low = "0.309", ci_high = "0.699"
  ))
  extracted <- function(endpoint) {
    list(modifyList(gold_rows[[1]], list(endpoint = endpoint, value = "0.34")))
  }
  for (endpoint in c(
    "Time to worsening of patient-reported NSCLC symptoms",
    "CNS progression-free survival",
    "Time to intracranial progression",
    "Second PFS after start of first subsequent therapy",
    "Second progression-free survival",
    "PFS2",
    "PFS-2",
    "PFS after first subsequent therapy"
  )) {
    score <- score_against_gold(extracted(endpoint), gold_rows)
    expect_equal(score$numeric_errors, 0L, info = endpoint)
    expect_equal(score$missed_rows, 1L, info = endpoint)
  }
  bicr <- score_against_gold(
    extracted("Progression free survival by BICR"), gold_rows
  )
  expect_equal(bicr$numeric_errors, 1L)
})

test_that("an analysis or population named in the endpoint keeps it one", {
  # "second" and "CNS" make another endpoint only as "second progression" or
  # "CNS progression": a second interim analysis, or patients with CNS
  # metastases, are the same endpoint, so a wrong value is an error.
  gold_rows <- list(
    synthetic_row(
      medicine = "Keytruda", trial = "KEYNOTE-024", endpoint = "PFS",
      value = "0.50", ci_low = "0.37", ci_high = "0.68"
    ),
    synthetic_row(
      medicine = "Keytruda", trial = "KEYNOTE-024", endpoint = "OS",
      value = "0.60", ci_low = "0.41", ci_high = "0.89"
    )
  )
  wrong <- function(endpoint, row = 1) {
    list(modifyList(gold_rows[[row]], list(endpoint = endpoint, value = "0.9")))
  }
  cases <- list(
    list("PFS at second interim analysis", 1),
    list("PFS by BICR at second interim analysis", 1),
    list("Progression-free survival, second interim analysis", 1),
    list("PFS in patients with baseline CNS metastases", 1),
    list("Overall survival at second interim analysis", 2),
    list("OS in patients with CNS metastases at baseline", 2)
  )
  for (case in cases) {
    score <- score_against_gold(wrong(case[[1]], case[[2]]), gold_rows)
    expect_equal(score$numeric_errors, 1L, info = case[[1]])
    expect_equal(score$extra_rows, 0L, info = case[[1]])
  }
})

test_that("labels name the known endpoints they spell out", {
  expect_equal(
    gold_endpoint_mentions("Confirmed objective response rate"), "ORR"
  )
  expect_equal(gold_endpoint_mentions("Confirmed ORR, laBCC"), "ORR")
  expect_equal(gold_endpoint_mentions("Duration of response (months)"), "DOR")
  expect_equal(
    gold_endpoint_mentions("PFS at second interim analysis"), "PFS"
  )
  expect_equal(
    gold_endpoint_mentions("PFS in patients with baseline CNS metastases"),
    "PFS"
  )
  expect_length(gold_endpoint_mentions("Time to CNS progression"), 0)
  expect_length(gold_endpoint_mentions("Intracranial ORR"), 0)
  expect_length(gold_endpoint_mentions("CNS DFS (time to CNS recurrence)"), 0)
  expect_length(gold_endpoint_mentions("PFS-2"), 0)
  expect_length(gold_endpoint_mentions("Time to first subsequent therapy"), 0)
  expect_length(gold_endpoint_mentions(NULL), 0)
})

test_that("a unit in parentheses is not read as an endpoint abbreviation", {
  # Retsevmo's "Duration of response (months)" was keyed "MONTHS".
  expect_equal(gold_endpoint("Duration of response (months)"), "DOR")
  expect_equal(gold_endpoint("Objective response rate (CR + PR)"), "ORR")
  expect_equal(gold_endpoint("OS (final analysis)"), "OS")
  expect_equal(gold_endpoint("Time to CNS progression (TTP)"), "TTP")
})

test_that("a known endpoint named outside the parentheses wins", {
  # Tecentriq's subgroup row was keyed "TC" by its parenthesised word.
  expect_equal(gold_endpoint(paste(
    "Overall survival by tumour PD-L1 Tumour Cell (TC) expression status,",
    "PD-L1 < 1% group"
  )), "OS")
  expect_equal(gold_endpoint("Objective response rate (ORR: CR+ PR), laBCC"),
               "ORR")
  expect_equal(gold_endpoint("Progression free survival by BICR"), "PFS")
  expect_equal(gold_endpoint("PFS at second interim analysis"), "PFS")
  # Two endpoints named, or one with a qualifier: not read as one.
  expect_equal(gold_endpoint("CNS progression-free survival"),
               "CNS PROGRESSION FREE SURVIVAL")
  expect_equal(gold_endpoint("PFS and OS"), "PFS AND OS")
})

test_that("an endpoint label naming the gold's endpoint still pairs by trial", {
  rows <- gold()
  extracted <- purrr::map(rows, as_extracted)
  orr <- gold_index(rows, "Rybrevant", "CHRYSALIS", "ORR")
  extracted[[orr]]$endpoint <- "Objective response rate by investigator"
  extracted[[orr]]$value <- "40"
  score <- score_against_gold(extracted, rows)
  expect_equal(score$numeric_errors, 1L)
  expect_equal(score$missed_rows, 0L)
  expect_equal(score$extra_rows, 0L)
})

test_that("rows of another condition are not scored against the gold", {
  # Retsevmo's thyroid-cancer LIBRETTO-001 response rate was paired with the
  # gold's NSCLC row of the same trial and endpoint.
  gold_rows <- list(synthetic_row(
    medicine = "Retsevmo", trial = "LIBRETTO-001", endpoint = "ORR",
    value = "61.5", ci_low = "55.2", ci_high = "67.6"
  ))
  thyroid <- modifyList(gold_rows[[1]], list(
    indication = "advanced RET mutant medullary thyroid cancer (MTC)",
    value = "77.6", ci_low = "70.2", ci_high = "84.0"
  ))
  expect_equal(score_against_gold(list(thyroid), gold_rows)$numeric_errors, 1L)
  nsclc <- function(row) {
    score_against_gold(list(row), gold_rows, condition = gold_condition)
  }
  score <- nsclc(thyroid)
  expect_equal(score$numeric_errors, 0L)
  expect_equal(score$missed_rows, 1L)
  expect_equal(score$extra_rows, 0L)
  expect_equal(score$outside_rows, 1L)
  expect_match(score$outside_keys, "^retsevmo\\|libretto-001\\|ORR")
  # An NSCLC indication (EMA's lossy spelling too), or none, is scored.
  lung <- modifyList(thyroid, list(
    indication = "advanced RET fusion positive non?small cell lung cancer"
  ))
  expect_equal(nsclc(lung)$numeric_errors, 1L)
  expect_equal(nsclc(lung)$outside_rows, 0L)
  unstated <- thyroid
  unstated$indication <- NULL
  expect_equal(nsclc(unstated)$numeric_errors, 1L)
})

test_that("only a row naming another condition is left out of the score", {
  gold_rows <- list(synthetic_row(
    medicine = "Keytruda", trial = "KEYNOTE-024", endpoint = "PFS",
    value = "0.50", ci_low = "0.37", ci_high = "0.68"
  ))
  with_indication <- function(indication) {
    row <- modifyList(gold_rows[[1]], list(value = "0.9"))
    row$indication <- indication
    score_against_gold(list(row), gold_rows, condition = gold_condition)
  }
  # An indication copied without its condition is still scored.
  for (indication in c(
    "first-line treatment of metastatic disease in adults whose tumours
    express PD-L1 with a >= 50% tumour proportion score",
    "monotherapy, PD-L1 TPS >= 50%",
    "metastatic non-squamous non-small cell lung carcinoma",
    "NSCLC, or small cell lung cancer after platinum"
  )) {
    score <- with_indication(indication)
    expect_equal(score$outside_rows, 0L, info = indication)
    expect_equal(score$numeric_errors, 1L, info = indication)
  }
  for (indication in c(
    "unresectable or metastatic melanoma",
    "extensive-stage small cell lung cancer (ES-SCLC)",
    "metastatic colorectal cancer (mCRC)",
    "advanced or unresectable hepatocellular carcinoma",
    "recurrent or metastatic cervical cancer",
    "HER2-low breast cancer",
    "advanced RET fusion positive solid tumours",
    "locally advanced or metastatic urothelial carcinoma",
    "malignant pleural mesothelioma",
    "adjuvant treatment of adult patients with CSCC at high risk of recurrence"
  )) {
    score <- with_indication(indication)
    expect_equal(score$outside_rows, 1L, info = indication)
    expect_equal(score$numeric_errors, 0L, info = indication)
  }
})

test_that("rows of another condition in a gold trial are listed for a check", {
  # LIBRETTO-001 is a basket trial: its thyroid-cancer rows are left out
  # rightly, but a mislabelled indication would hide a wrong number there.
  gold_rows <- list(synthetic_row(
    medicine = "Retsevmo", trial = "LIBRETTO-001", endpoint = "ORR",
    value = "61.5", ci_low = "55.2", ci_high = "67.6"
  ))
  thyroid <- modifyList(gold_rows[[1]], list(
    indication = "advanced RET mutant medullary thyroid cancer (MTC)",
    value = "77.6", ci_low = "70.2", ci_high = "84.0"
  ))
  other_trial <- modifyList(thyroid, list(trial = "LIBRETTO-531"))
  score <- score_against_gold(
    list(thyroid, other_trial), gold_rows, condition = gold_condition
  )
  expect_equal(score$outside_rows, 2L)
  expect_length(score$outside_gold_trial_keys, 1)
  expect_match(score$outside_gold_trial_keys, "^retsevmo\\|libretto-001\\|")
  result <- list(
    model = "claude-sonnet-5-5", score = score, failed = list(),
    dropped_rows = character(),
    calls = dplyr::tibble(
      medicine = "Retsevmo", status = "ok", reason = NA_character_,
      rows_dropped = 0L
    )
  )
  details <- gold_report_details(result)
  heading <- grep("in a gold trial", details, fixed = TRUE)
  expect_length(heading, 1)
  expect_match(details[heading + 1], "libretto-001")
})

test_that("pitfalls look only at the rows that are scored", {
  # Lumykras also has a colorectal-cancer indication: its DOR rows there are
  # not the NSCLC row the range pitfall is about.
  rows <- gold()
  extracted <- purrr::map(rows, as_extracted)
  extracted <- purrr::map(extracted, function(row) {
    row$indication <- "advanced non-small cell lung cancer (NSCLC)"
    row
  })
  dor <- gold_index(rows, "Lumykras", "CodeBreaK", "DoR")
  colorectal <- modifyList(extracted[[dor]], list(
    trial = "CodeBreaK 300", ci_is_range = FALSE,
    indication = "metastatic colorectal cancer (mCRC) with KRAS G12C mutation"
  ))
  with_colorectal <- c(extracted, list(colorectal))
  expect_false(
    score_against_gold(with_colorectal, rows)$pitfalls[["lumykras_range"]]
  )
  scored <- score_against_gold(
    with_colorectal, rows, condition = gold_condition
  )
  expect_true(scored$pitfalls[["lumykras_range"]])
  expect_equal(scored$outside_rows, 1L)
})

test_that("ALEX rows without arm values leave the pitfall not testable", {
  # The verifier blanks arms it cannot verify: a row without arms is no swap.
  rows <- gold()
  extracted <- purrr::map(rows, as_extracted)
  alex <- gold_index(rows, "Alecensa", "ALEX")
  for (index in alex) {
    extracted[[index]]$arm_treatment <- NULL
    extracted[[index]]$arm_control <- NULL
  }
  score <- score_against_gold(extracted, rows)
  expect_true(is.na(score$pitfalls[["alex_column_order"]]))
  expect_match(score$pitfall_notes, "no arm values", all = FALSE)
  expect_match(score$pitfall_notes, "not testable", all = FALSE)
  expect_false(any(grepl(
    "alex", score_against_gold(rows, rows)$pitfall_notes, fixed = TRUE
  )))
  # The ALEX rows found with arms are tested, in the gold's order.
  with_arms <- extracted
  with_arms[[alex[1]]] <- as_extracted(rows[[alex[1]]])
  score <- score_against_gold(with_arms, rows)
  expect_true(score$pitfalls[["alex_column_order"]])
  expect_match(score$pitfall_notes, "1 of the 2 ALEX rows", all = FALSE)
  swapped <- with_arms
  swapped[[alex[1]]][c("arm_treatment", "arm_control")] <-
    rows[[alex[1]]][c("arm_control", "arm_treatment")]
  expect_false(
    score_against_gold(swapped, rows)$pitfalls[["alex_column_order"]]
  )
  # No ALEX row at all: not testable either, and the note says so.
  score <- score_against_gold(extracted[-alex], rows)
  expect_true(is.na(score$pitfalls[["alex_column_order"]]))
  expect_match(score$pitfall_notes, "no ALEX row was extracted", all = FALSE)
})

test_that("a true row of another analysis is an extra row, no numeric error", {
  # Tecentriq IMpower130 on 2026-10-01: its primary OS row failed verification,
  # and the exploratory one with longer follow-up was paired with the gold's
  # primary row as a numeric error.
  rows <- gold()
  os <- gold_index(rows, "Tecentriq", "IMpower130", "OS")
  extracted <- purrr::map(rows, as_extracted)
  extracted[[os]] <- modifyList(extracted[[os]], list(
    analysis_role = "exploratory",
    analysis = paste(
      "Exploratory analysis with longer follow up (median: 24.1 months)"
    ),
    value = "0.82", ci_low = "0.67", ci_high = "1.01"
  ))
  score <- score_against_gold(extracted, rows)
  expect_equal(score$numeric_errors, 0L)
  expect_equal(score$missed_rows, 1L)
  expect_equal(score$extra_rows, 1L)
  # Said to be the primary analysis, the same numbers are a numeric error.
  extracted[[os]]$analysis_role <- "primary"
  expect_equal(score_against_gold(extracted, rows)$numeric_errors, 1L)
  # Another analysis printing the gold's numbers still pairs with it.
  same <- purrr::map(rows, as_extracted)
  same[[os]]$analysis_role <- "later"
  score <- score_against_gold(same, rows)
  expect_equal(score$numeric_errors, 0L)
  expect_equal(score$missed_rows, 0L)
})

test_that("rows of differently dated analyses pair only on the same numbers", {
  # Tevimbra BGB-A317-307 on 2026-10-01: the interim analysis's T+nPC row
  # (0.45, CI 0.32 to 0.64) was paired with the gold's final T+PC row (0.45,
  # 0.33 to 0.62) by their equal values.
  final <- synthetic_row(
    trial = "BGB-A317-307", endpoint = "PFS", value = "0.45",
    ci_low = "0.33", ci_high = "0.62",
    analysis = "final analysis, data cut-off 30-Sep-2020"
  )
  interim <- modifyList(final, list(
    analysis = paste(
      "interim analysis (data cut-off 06-Dec-2019), T+nPC arm versus PC arm"
    ),
    ci_low = "0.32", ci_high = "0.64"
  ))
  score <- score_against_gold(list(interim), list(final))
  expect_equal(score$numeric_errors, 0L)
  expect_equal(score$missed_rows, 1L)
  expect_equal(score$extra_rows, 1L)
  both <- score_against_gold(list(interim, final), list(final))
  expect_equal(both$numeric_errors, 0L)
  expect_equal(both$missed_rows, 0L)
  # Undated, the interim row is a numeric error of the gold's row.
  undated <- modifyList(interim, list(analysis = "interim analysis"))
  expect_equal(
    score_against_gold(list(undated), list(final))$numeric_errors, 1L
  )
})

test_that("analysis texts are read for the dates they state", {
  expect_equal(
    gold_analysis_dates("final analysis, data cut-off 30-Sep-2020"),
    "2020-09-30"
  )
  expect_equal(
    gold_analysis_dates("primary analysis, data cutoff Jun 14, 2021"),
    "2021-06-14"
  )
  expect_equal(
    gold_analysis_dates("updated pre-specified EFS, DCO 10 May 2024"),
    "2024-05-10"
  )
  expect_equal(
    gold_analysis_dates("primary analysis (17 January 2020), interim"),
    "2020-01-17"
  )
  expect_equal(gold_analysis_dates("median follow-up 21 months"), character())
  expect_equal(gold_analysis_dates(NULL), character())
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

test_that("a pitfall not testable keeps a model from passing, said so", {
  result <- acceptable()
  result$score$pitfalls <- c(a = TRUE, alex_column_order = NA)
  expect_false(gold_model_passes(result))
  expect_equal(
    gold_acceptance_problems(result),
    "pitfall not testable: alex_column_order"
  )
  expect_equal(gold_pitfall_text(NA), "not testable")
  expect_equal(gold_pitfall_text(TRUE), "pass")
  expect_equal(gold_pitfall_text(FALSE), "FAIL")
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
  calls$polled <- character()
  list(
    calls = calls,
    create = function(requests) {
      calls$requests <- c(calls$requests, list(requests))
      calls$created <- calls$created + 1L
      paste0("msgbatch_", calls$created)
    },
    status = function(batch_id) {
      calls$polled <- c(calls$polled, batch_id)
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

run_gold <- function(inputs,
                     api,
                     models = "claude-sonnet-5-5",
                     efforts = "high") {
  run_gold_evaluation(
    models = models,
    selection_path = inputs$selection_path,
    text_directory = inputs$text_directory,
    gold_path = inputs$gold_path,
    output_directory = inputs$output_directory,
    efforts = efforts,
    medicines_path = inputs$medicines_path,
    batch_api = api
  )
}

request_efforts <- function(api) {
  purrr::map_chr(
    api$calls$requests, \(requests) requests[[1]]$params$output_config$effort
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
  expect_equal(request$params$max_tokens, 128000L)
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

# A saved result whose score an older scorer wrote.
write_stale_score <- function(path) {
  saved <- jsonlite::fromJSON(path, simplifyVector = FALSE)
  saved$score$numeric_errors <- 99L
  saved$score$extra_rows <- 99L
  jsonlite::write_json(
    saved, path,
    auto_unbox = TRUE, pretty = TRUE, null = "null", na = "null", digits = NA
  )
}

test_that("a saved result is scored again offline, from its kept rows", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  original <- run_gold(
    inputs, fake_batch_api(list(fake_result(fake_message("Alecensa"))))
  )[["claude-sonnet-5-5"]]
  path <- file.path(inputs$output_directory, "gold-eval-claude-sonnet-5-5.json")
  write_stale_score(path)
  result <- rescore_saved_gold_result(path, inputs$gold_path)
  expect_equal(result$score$numeric_errors, 0L)
  expect_equal(result$score$extra_rows, 0L)
  expect_equal(result$score$missed_rows, original$score$missed_rows)
  expect_equal(result$score$pitfalls, original$score$pitfalls)
  expect_equal(result$rows_kept, 4L)
  expect_equal(result$calls$status, "ok")
  expect_true(gold_model_passes(result) == gold_model_passes(original))
})

test_that("a rerun scores a saved result again, so a report has one scorer", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  answer <- list(fake_result(fake_message("Alecensa")))
  run_gold(inputs, fake_batch_api(answer))
  write_stale_score(
    file.path(inputs$output_directory, "gold-eval-claude-sonnet-5-5.json")
  )
  api <- fake_batch_api(answer)
  result <- suppressMessages(run_gold(inputs, api))[["claude-sonnet-5-5"]]
  expect_equal(api$calls$created, 0L)
  expect_equal(result$score$numeric_errors, 0L)
  expect_equal(result$score$extra_rows, 0L)
  # The file holds the score the report shows, not the older one.
  saved <- read_gold_result_file(
    file.path(inputs$output_directory, "gold-eval-claude-sonnet-5-5.json")
  )
  expect_equal(saved$score$numeric_errors, 0L)
  expect_equal(saved$score$extra_rows, 0L)
  expect_equal(saved$score$pitfalls, result$score$pitfalls)
  expect_equal(saved$rows_kept, result$rows_kept)
  expect_equal(saved$rows, result$rows)
})

test_that("scoring a saved result offline leaves its file as it was", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  run_gold(inputs, fake_batch_api(list(fake_result(fake_message("Alecensa")))))
  path <- file.path(inputs$output_directory, "gold-eval-claude-sonnet-5-5.json")
  write_stale_score(path)
  before <- readLines(path)
  rescore_saved_gold_result(path, inputs$gold_path)
  expect_equal(readLines(path), before)
})

# Alecensa's fake answer with ALEX OS's treatment arm one its quotes do not
# hold (the verifier blanks its arms) and ALINA's value changed (it fails).
alecensa_answer <- function() {
  message <- fake_message("Alecensa")
  answer <- jsonlite::fromJSON(
    message$content[[1]]$text, simplifyVector = FALSE
  )
  answer$rows[[3]]$arm_treatment <- "99.9"
  answer$rows[[1]]$value <- "0.99"
  message$content[[1]]$text <- jsonlite::toJSON(
    answer, auto_unbox = TRUE, null = "null"
  )
  message
}

test_that("an answer keeps its raw rows; unverified arms are blanked", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  api <- fake_batch_api(list(fake_result(alecensa_answer())))
  result <- run_gold(inputs, api)[["claude-sonnet-5-5"]]
  expect_length(result$raw_rows, 4)
  expect_equal(result$raw_rows[[3]]$row$arm_treatment, "99.9")
  expect_equal(result$rows_kept, 3L)
  expect_equal(result$rows_failed, 1L)
  expect_equal(result$failed[[1]]$row$value, "0.99")
  alex_os <- Filter(\(row) row$row_order == 3L, result$rows)[[1]]
  expect_null(alex_os$arm_treatment)
  expect_null(alex_os$arm_control)
  expect_true("arms_not_verified" %in% unlist(alex_os$flags))
})

gold_result_file <- function(inputs) {
  file.path(inputs$output_directory, "gold-eval-claude-sonnet-5-5.json")
}

write_saved_result <- function(saved, path) {
  jsonlite::write_json(
    saved, path,
    auto_unbox = TRUE, pretty = TRUE, null = "null", na = "null", digits = NA
  )
}

# The saved result as an older verifier wrote it: ALEX OS failed on its arm.
write_older_verifier <- function(path) {
  saved <- jsonlite::fromJSON(path, simplifyVector = FALSE)
  os <- which(purrr::map_int(saved$rows, "row_order") == 3L)
  saved$failed <- c(saved$failed, list(list(
    medicine = "Alecensa", trial = "ALEX (BO28984)", endpoint = "OS",
    errors = "arm_treatment = '99.9' not in the quotes",
    row = saved$raw_rows[[3]]$row
  )))
  saved$rows <- saved$rows[-os]
  saved$rows_kept <- 2L
  saved$rows_failed <- 2L
  write_saved_result(saved, path)
}

reverify_saved <- function(inputs) {
  reverify_saved_gold_result(
    gold_result_file(inputs), inputs$gold_path, inputs$selection_path,
    inputs$text_directory, inputs$medicines_path
  )
}

test_that("a saved result is verified again offline, from its raw rows", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  run_gold(inputs, fake_batch_api(list(fake_result(alecensa_answer()))))
  path <- gold_result_file(inputs)
  write_older_verifier(path)
  before <- readLines(path)
  result <- reverify_saved(inputs)
  expect_equal(result$rows_kept, 3L)
  expect_equal(result$rows_failed, 1L)
  expect_equal(result$calls$rows_kept, 3L)
  expect_equal(result$calls$rows_failed, 1L)
  expect_equal(result$failed_not_reverified, 0L)
  expect_equal(purrr::map_int(result$rows, "row_order"), c(2L, 3L, 4L))
  alex_os <- result$rows[[2]]
  expect_null(alex_os$arm_treatment)
  expect_true("arms_not_verified" %in% unlist(alex_os$flags))
  # The file is left as it was.
  expect_equal(readLines(path), before)
})

test_that("a result saved without raw rows keeps its failed rows as listed", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  run_gold(inputs, fake_batch_api(list(fake_result(alecensa_answer()))))
  path <- gold_result_file(inputs)
  saved <- jsonlite::fromJSON(path, simplifyVector = FALSE)
  saved$raw_rows <- NULL
  saved$failed <- purrr::map(saved$failed, \(item) item[names(item) != "row"])
  write_saved_result(saved, path)
  result <- reverify_saved(inputs)
  expect_equal(result$rows_kept, 3L)
  expect_equal(result$rows_failed, 1L)
  expect_equal(result$failed_not_reverified, 1L)
  expect_equal(result$failed[[1]]$trial, "ALINA (BO40336)")
  expect_match(
    gold_report_details(result), "saved without their row", all = FALSE
  )
})

test_that("a rerun verifies a saved result again before scoring it", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  answer <- list(fake_result(alecensa_answer()))
  run_gold(inputs, fake_batch_api(answer))
  write_older_verifier(gold_result_file(inputs))
  api <- fake_batch_api(answer)
  result <- suppressMessages(run_gold(inputs, api))[["claude-sonnet-5-5"]]
  expect_equal(api$calls$created, 0L)
  expect_equal(result$rows_kept, 3L)
  saved <- read_gold_result_file(gold_result_file(inputs))
  expect_equal(saved$rows_kept, 3L)
  expect_equal(saved$rows, result$rows)
})

test_that("a pitfall not testable is saved and read back as NA", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  result <- run_gold(
    inputs, fake_batch_api(list(fake_result(fake_message("Alecensa"))))
  )[["claude-sonnet-5-5"]]
  result$score$pitfalls[["alex_column_order"]] <- NA
  write_gold_result(result, inputs$output_directory)
  saved <- read_gold_result_file(gold_result_file(inputs))
  expect_true(is.na(saved$score$pitfalls[["alex_column_order"]]))
  expect_equal(names(saved$score$pitfalls), names(result$score$pitfalls))
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

test_that("each effort of a model is a variant with its own batch", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  api <- fake_batch_api(list(fake_result(fake_message("Alecensa"))))
  out <- inputs$output_directory
  seen <- new.env()
  status <- api$status
  api$status <- function(batch_id) {
    pending <- file.path(out, "gold-pending-claude-sonnet-5-5-medium.json")
    if (file.exists(pending)) {
      seen$pending <- jsonlite::fromJSON(pending, simplifyVector = FALSE)
    }
    status(batch_id)
  }
  results <- run_gold(inputs, api, efforts = c("medium", "high"))
  expect_equal(api$calls$created, 2L)
  expect_equal(request_efforts(api), c("medium", "high"))
  expect_equal(seen$pending$effort, "medium")
  expect_equal(seen$pending$model, "claude-sonnet-5-5")
  expect_named(results, c("claude-sonnet-5-5-medium", "claude-sonnet-5-5"))
  expect_equal(results[["claude-sonnet-5-5-medium"]]$effort, "medium")
  expect_equal(results[["claude-sonnet-5-5"]]$effort, "high")
  medium <- file.path(out, "gold-eval-claude-sonnet-5-5-medium.json")
  expect_equal(read_gold_result_file(medium)$effort, "medium")
  # The high variant keeps the names of the runs before effort levels.
  high <- file.path(out, "gold-eval-claude-sonnet-5-5.json")
  expect_equal(read_gold_result_file(high)$effort, "high")
  expect_length(list.files(out, pattern = "^gold-pending"), 0)
  report <- readLines(file.path(out, "gold-eval-report.md"))
  expect_true(any(grepl(
    "| | claude-sonnet-5-5 (medium) | claude-sonnet-5-5 (high) |",
    report,
    fixed = TRUE
  )))
  expect_true(any(report == "### claude-sonnet-5-5 (medium)"))
})

test_that("models and efforts make every pair, model by model", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  api <- fake_batch_api(list(fake_result(fake_message("Alecensa"))))
  results <- run_gold(
    inputs, api,
    models = c("claude-sonnet-5-5", "claude-opus-5-5"),
    efforts = c("low", "high")
  )
  models <- purrr::map_chr(api$calls$requests, \(r) r[[1]]$params$model)
  expect_equal(models, rep(c("claude-sonnet-5-5", "claude-opus-5-5"), each = 2))
  expect_equal(request_efforts(api), rep(c("low", "high"), 2))
  expect_named(results, c(
    "claude-sonnet-5-5-low", "claude-sonnet-5-5",
    "claude-opus-5-5-low", "claude-opus-5-5"
  ))
})

test_that("a pending batch made before effort levels is collected as high", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  dir.create(inputs$output_directory)
  # As the batches left pending on 2026-10-01: no effort recorded.
  pending_path <- file.path(
    inputs$output_directory, "gold-pending-claude-sonnet-5-5.json"
  )
  jsonlite::write_json(
    list(
      batch_id = "msgbatch_old", model = "claude-sonnet-5-5",
      custom_ids = list("EMEA-H-C-004164"),
      created = "2026-10-01T00:20:16+0200"
    ),
    pending_path,
    auto_unbox = TRUE
  )
  api <- fake_batch_api(list(fake_result(fake_message("Alecensa"))))
  results <- suppressMessages(
    run_gold(inputs, api, efforts = c("medium", "high"))
  )
  # Only the medium variant is new; the high one collects the old batch.
  expect_equal(api$calls$created, 1L)
  expect_equal(request_efforts(api), "medium")
  expect_setequal(api$calls$polled, c("msgbatch_old", "msgbatch_1"))
  expect_equal(results[["claude-sonnet-5-5"]]$effort, "high")
  expect_equal(results[["claude-sonnet-5-5"]]$rows_kept, 4L)
  expect_false(file.exists(pending_path))
  expect_true(file.exists(
    file.path(inputs$output_directory, "gold-eval-claude-sonnet-5-5.json")
  ))
})

test_that("a pending batch of another effort is not collected silently", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  dir.create(inputs$output_directory)
  jsonlite::write_json(
    list(
      batch_id = "msgbatch_old", model = "claude-sonnet-5-5", effort = "low",
      custom_ids = list("EMEA-H-C-004164")
    ),
    file.path(inputs$output_directory, "gold-pending-claude-sonnet-5-5.json"),
    auto_unbox = TRUE
  )
  api <- fake_batch_api(list())
  expect_error(run_gold(inputs, api), "low")
  expect_equal(api$calls$created, 0L)
  expect_length(api$calls$polled, 0)
})

test_that("a saved result is reused per variant, only at its own effort", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  answer <- list(fake_result(fake_message("Alecensa")))
  run_gold(inputs, fake_batch_api(answer))
  api <- fake_batch_api(answer)
  expect_message(
    run_gold(inputs, api, efforts = c("medium", "high")),
    "saved result of claude-sonnet-5-5 (high)",
    fixed = TRUE
  )
  expect_equal(api$calls$created, 1L)
  expect_equal(request_efforts(api), "medium")
  again <- fake_batch_api(answer)
  suppressMessages(run_gold(inputs, again, efforts = c("medium", "high")))
  expect_equal(again$calls$created, 0L)
  # A result whose recorded effort is another is asked again.
  medium <- file.path(
    inputs$output_directory, "gold-eval-claude-sonnet-5-5-medium.json"
  )
  saved <- jsonlite::fromJSON(medium, simplifyVector = FALSE)
  saved$effort <- "low"
  jsonlite::write_json(saved, medium, auto_unbox = TRUE, null = "null")
  other <- fake_batch_api(answer)
  suppressMessages(run_gold(inputs, other, efforts = "medium"))
  expect_equal(other$calls$created, 1L)
  expect_equal(read_gold_result_file(medium)$effort, "medium")
})

test_that("a saved result without an effort is the high variant's", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  answer <- list(fake_result(fake_message("Alecensa")))
  run_gold(inputs, fake_batch_api(answer))
  path <- file.path(inputs$output_directory, "gold-eval-claude-sonnet-5-5.json")
  saved <- jsonlite::fromJSON(path, simplifyVector = FALSE)
  saved$effort <- NULL
  jsonlite::write_json(saved, path, auto_unbox = TRUE, null = "null")
  expect_equal(read_gold_result_file(path)$effort, "high")
  api <- fake_batch_api(answer)
  result <- suppressMessages(run_gold(inputs, api))[["claude-sonnet-5-5"]]
  expect_equal(api$calls$created, 0L)
  expect_equal(result$effort, "high")
  expect_equal(read_gold_result_file(path)$effort, "high")
})

test_that("an unknown effort stops the run before any request", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  api <- fake_batch_api(list(fake_result(fake_message("Alecensa"))))
  expect_error(
    run_gold(inputs, api, efforts = c("high", "turbo")),
    "turbo"
  )
  expect_error(run_gold(inputs, api, efforts = character()), "effort")
  expect_equal(api$calls$created, 0L)
  expect_false(dir.exists(inputs$output_directory))
})

test_that("the efforts come from APPROVAL_ATLAS_GOLD_EFFORTS", {
  expect_equal(gold_efforts_from_env(""), "high")
  expect_equal(gold_efforts_from_env(" , "), "high")
  expect_equal(gold_efforts_from_env("medium, high"), c("medium", "high"))
  expect_equal(gold_efforts_from_env("max,max"), "max")
  expect_equal(
    gold_efforts_from_env("low,medium,high,xhigh,max"),
    c("low", "medium", "high", "xhigh", "max")
  )
  expect_error(gold_efforts_from_env("medium,turbo"), "turbo")
  expect_error(gold_efforts_from_env("High"), "High")
  withr::local_envvar(APPROVAL_ATLAS_GOLD_EFFORTS = "low,high")
  expect_equal(gold_efforts_from_env(), c("low", "high"))
})

test_that("the report shows output tokens per answered call and cut-offs", {
  directory <- withr::local_tempdir()
  inputs <- gold_run_inputs(directory)
  api <- fake_batch_api(list(fake_result(fake_message(
    "Alecensa",
    output_tokens = 12345
  ))))
  result <- run_gold(inputs, api)[["claude-sonnet-5-5"]]
  expect_equal(result$calls$output_tokens, 12345)
  report_path <- file.path(inputs$output_directory, "gold-eval-report.md")
  report <- readLines(report_path)
  expect_true(any(report == "| Output tokens per answered call | 12,345 |"))
  expect_true(any(report == "| Truncated calls | 0 of 1 |"))
  message <- fake_message("Alecensa", output_tokens = 128000)
  message$stop_reason <- "max_tokens"
  unlink(file.path(inputs$output_directory, "gold-eval-claude-sonnet-5-5.json"))
  run_gold(inputs, fake_batch_api(list(fake_result(message))))
  report <- readLines(report_path)
  expect_true(any(report == "| Output tokens per answered call | n/a |"))
  expect_true(any(report == "| Truncated calls | 1 of 1 |"))
})

test_that("a saved result without per-call tokens still reports", {
  result <- list(
    model = "claude-sonnet-5-5", effort = "high",
    calls = dplyr::tibble(
      medicine = "Alecensa", status = "ok", reason = NA_character_,
      rows_kept = 1L, rows_failed = 0L, rows_dropped = 0L
    ),
    rows_kept = 1L, rows_failed = 0L,
    usage = list(input_tokens = 10, output_tokens = 20), cost = 0.1,
    score = list(
      numeric_errors = 0L, missed_rows = 0L, gold_rows = 1L, extra_rows = 0L,
      outside_rows = 0L, lead_agreement = 1, pitfalls = c(a = TRUE)
    )
  )
  table <- gold_report_table(list(result))
  expect_true(any(table == "| Output tokens per answered call | n/a |"))
})
