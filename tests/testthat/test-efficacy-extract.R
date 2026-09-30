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
    effect_type = "hr"
  )
  flags <- efficacy_flags(row, list(status = "reassembled", warnings = "x"))
  expect_setequal(flags, c(
    "reassembled", "ci_level", "is_primary_unknown", "population_differs",
    "not_reached", "comparator_label_missing"
  ))
})

test_that("a clean row has no flags; single-arm HRs and ranges are flagged", {
  row <- list(
    ci_level = 95, is_primary = TRUE, population_match = "whole_trial_matches",
    ci_is_range = FALSE, value = "0.47", arm_treatment = "34.8",
    arm_control = "10.9", comparator = "crizotinib",
    comparator_column_label = "Crizotinib", effect_type = "hr"
  )
  exact <- list(status = "exact", warnings = character())
  expect_equal(efficacy_flags(row, exact), character())
  row$comparator <- NULL
  row$ci_is_range <- TRUE
  expect_equal(efficacy_flags(row, exact), c("ci_is_range", "single_arm_hr"))
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
  expect_equal(run$rows$row_order, c(1L, 3L))
  expect_equal(run$rows$page, c(3L, 3L))
  expect_equal(run$rows$verification, c("exact", "exact"))
  expect_equal(run$rows$flags, list(character(), "not_reached"))
  expect_equal(run$rows$n_treatment, c(152L, 152L))
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
  expect_equal(sent[[1]]$params$max_tokens, 32000L)
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
    write_pending_batch = function(path, batch_id, model, plan) {
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
