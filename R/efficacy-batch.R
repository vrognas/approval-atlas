# One extractor run's work: the product information PDFs (fetched slowly and
# cached as page texts), one Claude Message Batch with a request per section
# 5.1, and each answer's rows verified against the text they came from.

# Ruling R8: long sections with many rows would be truncated at 16000; a
# batch has no HTTP timeout to fear.
efficacy_batch_max_tokens <- 32000L

# Consecutive failed reads of the batch state before the run gives up.
efficacy_poll_error_limit <- 5L

efficacy_custom_id <- function(product_number) {
  gsub("/", "-", product_number, fixed = TRUE)
}

efficacy_cache_file <- function(plan_row, cache_directory) {
  file.path(cache_directory, paste0(
    efficacy_custom_id(plan_row$ema_product_number), "-",
    format(plan_row$document_last_updated_date), ".rds"
  ))
}

# Mocked in tests.
download_efficacy_pdf <- function(url, path) {
  ema_request(url) |>
    httr2::req_error(is_error = function(response) FALSE) |>
    httr2::req_perform(path = path) |>
    httr2::resp_status()
}

# Mocked in tests.
read_pdf_pages <- function(path) {
  pdftools::pdf_text(path)
}

# The PDF's page texts: `pages`, else `status` (not_found, or failed with a
# `reason`), else `stop` when EMA's answer should end the fetching (a 429, a
# firewall page) for this run.
fetch_efficacy_pages <- function(plan_row,
                                 cache_directory = efficacy_text_cache) {
  cache_file <- efficacy_cache_file(plan_row, cache_directory)
  if (file.exists(cache_file)) {
    return(list(pages = readRDS(cache_file)))
  }
  wait_seconds(smpc_request_spacing_seconds)
  cli::cli_inform("Reading {.url {plan_row$document_url}}.")
  pdf_path <- tempfile(fileext = ".pdf")
  on.exit(unlink(pdf_path), add = TRUE)
  status <- tryCatch(
    download_efficacy_pdf(plan_row$document_url, pdf_path),
    httr2_failure = function(error) conditionMessage(error)
  )
  if (is.character(status)) {
    return(list(stop = status))
  }
  if (status %in% c(404L, 410L)) {
    return(list(status = "not_found"))
  }
  if (status != 200L) {
    return(list(stop = paste("EMA returned HTTP", status)))
  }
  if (!is_pdf_file(pdf_path)) {
    return(list(stop = "EMA returned a non-PDF response"))
  }
  pages <- tryCatch(read_pdf_pages(pdf_path), error = function(error) NULL)
  if (is.null(pages)) {
    return(list(status = "failed", reason = "no text read from the PDF"))
  }
  dir.create(cache_directory, recursive = TRUE, showWarnings = FALSE)
  saveRDS(pages, cache_file)
  list(pages = pages)
}

efficacy_extraction_record <- function(plan_row,
                                       status,
                                       today,
                                       reason = NA_character_,
                                       rows_kept = 0L,
                                       rows_failed = 0L,
                                       model = NA_character_) {
  typed_table(list(list(
    ema_product_number = plan_row$ema_product_number,
    document_url = plan_row$document_url,
    document_last_updated_date = plan_row$document_last_updated_date,
    status = status,
    reason = reason,
    rows_kept = rows_kept,
    rows_failed = rows_failed,
    extractor_model = model,
    extracted_at = today
  )), efficacy_extraction_types)
}

empty_failed_efficacy_rows <- function() {
  dplyr::tibble(
    ema_product_number = character(),
    trial = character(),
    endpoint = character(),
    errors = list()
  )
}

failed_efficacy_row <- function(product_number, row, errors) {
  dplyr::tibble(
    ema_product_number = product_number,
    trial = typed_value(row[["trial"]], "character"),
    endpoint = typed_value(row[["endpoint"]], "character"),
    errors = list(errors)
  )
}

# Fetches and slices every planned product until EMA says stop: products
# without section 5.1 or a PDF are recorded at once, the others get a request.
prepare_efficacy_requests <- function(plan, model, today) {
  records <- list()
  submissions <- list()
  for (index in seq_len(nrow(plan))) {
    plan_row <- plan[index, ]
    fetched <- fetch_efficacy_pages(plan_row)
    if (!is.null(fetched$stop)) {
      cli::cli_warn(c(
        "Stopped reading product information: {fetched$stop}.",
        i = "{nrow(plan) - index + 1} product{?s} left for a later run."
      ))
      break
    }
    if (!is.null(fetched$status)) {
      records <- c(records, list(efficacy_extraction_record(
        plan_row, fetched$status, today,
        reason = fetched$reason %||% NA_character_
      )))
      next
    }
    section <- slice_smpc_efficacy(fetched$pages)
    if (is.na(section$text)) {
      records <- c(records, list(
        efficacy_extraction_record(plan_row, "no_section", today)
      ))
      next
    }
    custom_id <- efficacy_custom_id(plan_row$ema_product_number)
    params <- efficacy_request_params(
      plan_row$name_of_medicine,
      dplyr::coalesce(plan_row$therapeutic_indication, ""),
      section$text,
      model,
      max_tokens = efficacy_batch_max_tokens
    )
    submissions <- c(submissions, list(list(
      plan_row = plan_row,
      section = section,
      custom_id = custom_id,
      request = list(custom_id = custom_id, params = params)
    )))
  }
  list(records = records, submissions = submissions)
}

# The results URL once the batch has ended; NULL (with a warning) when its
# state cannot be read: its products are then planned again.
wait_for_efficacy_batch <- function(batch_id, poll_seconds) {
  started <- Sys.time()
  errors <- 0L
  repeat {
    state <- tryCatch(
      claude_batch_status(batch_id),
      claude_api_error = function(error) error,
      httr2_failure = function(error) error
    )
    if (inherits(state, "error")) {
      errors <- errors + 1L
      if (errors >= efficacy_poll_error_limit) {
        cli::cli_warn(c(
          "Gave up reading batch {batch_id}: {conditionMessage(state)}",
          i = "It may still finish (and be billed); its products are
          planned again on the next run."
        ))
        return(NULL)
      }
      cli::cli_inform("Batch {batch_id}: {conditionMessage(state)}")
    } else {
      errors <- 0L
      if (identical(state$status, "ended")) {
        return(ended_batch_results_url(batch_id, state$results_url))
      }
      waited <- difftime(Sys.time(), started, units = "mins")
      cli::cli_inform(escape_cli_braces(sprintf(
        "Batch %s: %s after %d minute(s).",
        batch_id, state$status, as.integer(round(waited))
      )))
    }
    wait_seconds(poll_seconds)
  }
}

ended_batch_results_url <- function(batch_id, results_url) {
  if (is.na(results_url)) {
    cli::cli_warn(c(
      "Batch {batch_id} ended without results.",
      i = "Its products are planned again on the next run."
    ))
    return(NULL)
  }
  results_url
}

# The batch's results by custom_id; NULL (with a warning) when the Claude API
# did not take the batch or its results could not be read.
run_efficacy_batch <- function(requests, poll_seconds) {
  failed <- function(error) {
    cli::cli_warn(c(
      "Claude API: {conditionMessage(error)}",
      i = "{length(requests)} product{?s} left for a later run."
    ))
    NULL
  }
  batch_id <- tryCatch(
    create_claude_batch(requests),
    claude_api_error = failed,
    httr2_failure = failed
  )
  if (is.null(batch_id)) {
    return(NULL)
  }
  cli::cli_inform(
    "Submitted batch {batch_id} with {length(requests)} request{?s}."
  )
  results_url <- wait_for_efficacy_batch(batch_id, poll_seconds)
  if (is.null(results_url)) {
    return(NULL)
  }
  results <- tryCatch(
    claude_batch_results(results_url),
    claude_api_error = failed,
    httr2_failure = failed
  )
  if (is.null(results)) {
    return(NULL)
  }
  stats::setNames(results, purrr::map_chr(results, "custom_id"))
}

efficacy_row_page <- function(row, section) {
  quotes <- as.character(unlist(row[["quotes"]]))
  longest <- quotes[which.max(nchar(quotes))]
  section$first_page + efficacy_quote_page(longest, section$pages) - 1L
}

# One answered row: verified against the section, or listed as failed.
check_answer_row <- function(row, order, submission, model, today) {
  plan_row <- submission$plan_row
  verification <- verify_efficacy_row(row, submission$section$text)
  if (verification$status == "failed") {
    return(list(failed = failed_efficacy_row(
      plan_row$ema_product_number, row, verification$errors
    )))
  }
  record <- c(row, list(
    ema_product_number = plan_row$ema_product_number,
    row_order = order,
    page = efficacy_row_page(row, submission$section),
    source_url = plan_row$document_url,
    source_date = plan_row$document_last_updated_date,
    verification = verification$status,
    flags = efficacy_flags(row, verification),
    extractor_model = model,
    extracted_at = today
  ))
  record$row_key <- efficacy_row_key(record)
  list(record = record)
}

efficacy_outcome <- function(submission, result, model, today) {
  plan_row <- submission$plan_row
  failed <- function(reason) {
    list(extraction = efficacy_extraction_record(
      plan_row, "failed", today,
      reason = reason, model = model
    ))
  }
  if (is.null(result)) {
    return(failed("no result in the batch"))
  }
  if (result$type == "errored") {
    return(failed(result$error))
  }
  if (result$type != "succeeded") {
    return(failed(result$type))
  }
  parsed <- parse_efficacy_response(result$message)
  if (parsed$status != "ok") {
    return(failed(parsed$reason))
  }
  checked <- purrr::imap(parsed$rows, function(row, order) {
    check_answer_row(row, order, submission, model, today)
  })
  rows <- efficacy_row_table(purrr::compact(purrr::map(checked, "record")))
  repeated <- duplicated(rows$row_key)
  failed_rows <- dplyr::bind_rows(
    empty_failed_efficacy_rows(),
    purrr::map(checked, "failed") |> purrr::compact() |> purrr::list_rbind(),
    failed_efficacy_rows_repeated(rows[repeated, ]),
    failed_efficacy_rows_dropped(plan_row$ema_product_number, parsed$dropped)
  )
  rows <- rows[!repeated, ]
  answered <- length(parsed$rows) + length(parsed$dropped)
  if (answered > 0 && nrow(rows) == 0) {
    status <- "failed"
    reason <- "no row passed verification"
  } else {
    status <- if (answered == 0) "no_rows" else "ok"
    reason <- parsed$reason
  }
  list(
    extraction = efficacy_extraction_record(
      plan_row, status, today,
      reason = reason, rows_kept = nrow(rows),
      rows_failed = nrow(failed_rows), model = model
    ),
    rows = rows,
    failed_rows = failed_rows
  )
}

efficacy_repeat_error <- paste(
  "repeats an earlier row (same trial, endpoint, population, analysis",
  "and numbers)"
)

failed_efficacy_rows_repeated <- function(rows) {
  dplyr::tibble(
    ema_product_number = rows$ema_product_number,
    trial = rows$trial,
    endpoint = rows$endpoint,
    errors = as.list(rep(efficacy_repeat_error, nrow(rows)))
  )
}

failed_efficacy_rows_dropped <- function(product_number, dropped) {
  dplyr::tibble(
    ema_product_number = rep(product_number, length(dropped)),
    trial = NA_character_,
    endpoint = NA_character_,
    errors = purrr::map(dropped, \(row) paste("unreadable:", row$reason))
  )
}

extract_efficacy_batch <- function(plan,
                                   model,
                                   poll_seconds = 60,
                                   today = Sys.Date()) {
  empty <- list(
    rows = empty_efficacy_rows(),
    extractions = empty_efficacy_extractions(),
    failed_rows = empty_failed_efficacy_rows()
  )
  if (nrow(plan) == 0) {
    return(empty)
  }
  # Before the slow fetching, not after it.
  claude_api_key()
  prepared <- prepare_efficacy_requests(plan, model, today)
  submissions <- prepared$submissions
  results <- if (length(submissions) > 0) {
    run_efficacy_batch(purrr::map(submissions, "request"), poll_seconds)
  }
  outcomes <- if (is.null(results)) {
    list()
  } else {
    purrr::map(submissions, function(submission) {
      efficacy_outcome(submission, results[[submission$custom_id]], model,
                       today)
    })
  }
  list(
    rows = dplyr::bind_rows(empty$rows, purrr::map(outcomes, "rows")),
    extractions = dplyr::bind_rows(
      empty$extractions,
      prepared$records,
      purrr::map(outcomes, "extraction")
    ),
    failed_rows = dplyr::bind_rows(
      empty$failed_rows,
      purrr::map(outcomes, "failed_rows")
    )
  )
}
