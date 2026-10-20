# The product information PDFs of an extractor run (fetched slowly and cached
# as page texts), a request per section 5.1, and each answer's rows verified
# against the text they came from. Submitting and collecting the batch is in
# efficacy-batch-run.R.

# Ruling R8: the whole output the models allow (claude-sonnet-5-5 and
# claude-opus-5-5: 128000 tokens, thinking included), as a batch has no HTTP
# timeout to fear. At 32000 the gold evaluation of 2026-10-01 cut off 5 of 18
# answers (Keytruda, Opdivo, Tecentriq, Imfinzi, Tevimbra); its token use puts
# Keytruda's section 5.1 at about 150000, so the longest sections may still
# be cut off (.remember/efficacy/fix-truncation-scorer.md).
efficacy_batch_max_tokens <- 128000L

efficacy_custom_id <- function(product_number) {
  gsub("/", "-", product_number, fixed = TRUE)
}

# Product, document date and a short hash of the URL: a document replaced on
# the same day under another URL is read again.
efficacy_cache_file <- function(plan_row, cache_directory) {
  url_hash <- substr(
    digest::digest(plan_row$document_url, algo = "sha1", serialize = FALSE),
    1, 8
  )
  file.path(cache_directory, paste0(
    efficacy_custom_id(plan_row$ema_product_number), "-",
    format(plan_row$document_last_updated_date), "-", url_hash, ".rds"
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

# The PDF's page texts from the cache, NULL when they are not there.
cached_efficacy_pages <- function(plan_row,
                                  cache_directory = efficacy_text_cache) {
  cache_file <- efficacy_cache_file(plan_row, cache_directory)
  if (file.exists(cache_file)) readRDS(cache_file)
}

# The PDF's page texts: `pages`, else `status` (not_found, or failed with a
# `reason`), else `stop` when EMA's answer should end the fetching (a 429, a
# firewall page) for this run.
fetch_efficacy_pages <- function(plan_row,
                                 cache_directory = efficacy_text_cache) {
  cached <- cached_efficacy_pages(plan_row, cache_directory)
  if (!is.null(cached)) {
    return(list(pages = cached))
  }
  cache_file <- efficacy_cache_file(plan_row, cache_directory)
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
                                       model = NA_character_,
                                       effort = NA_character_) {
  typed_table(list(list(
    ema_product_number = plan_row$ema_product_number,
    document_url = plan_row$document_url,
    document_last_updated_date = plan_row$document_last_updated_date,
    status = status,
    reason = reason,
    rows_kept = rows_kept,
    rows_failed = rows_failed,
    extractor_model = model,
    extractor_effort = effort,
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
prepare_efficacy_requests <- function(plan, model, effort, today) {
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
      effort = effort,
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


efficacy_row_page <- function(row, section) {
  quotes <- as.character(unlist(row[["quotes"]]))
  longest <- quotes[which.max(nchar(quotes))]
  section$first_page + efficacy_quote_page(longest, section$pages) - 1L
}

# One answered row: verified against the section (without the arm fields
# that did not verify and the quotes it dropped, verified_efficacy_row()), or
# listed as failed.
check_answer_row <- function(row, order, submission, model, today) {
  plan_row <- submission$plan_row
  verification <- verify_efficacy_row(
    row, submission$section$text, plan_row$therapeutic_indication
  )
  if (verification$status == "failed") {
    return(list(failed = failed_efficacy_row(
      plan_row$ema_product_number, row, verification$errors
    )))
  }
  row <- verified_efficacy_row(row, verification)
  record <- c(row, list(
    ema_product_number = plan_row$ema_product_number,
    row_order = order,
    page = efficacy_row_page(row, submission$section),
    source_url = plan_row$document_url,
    source_date = plan_row$document_last_updated_date,
    verification = verification$status,
    extractor_model = model,
    extracted_at = today
  ))
  record$flags <- efficacy_flags(record, verification)
  record$row_key <- efficacy_row_key(record)
  list(record = record)
}

efficacy_outcome <- function(submission, result, model, effort, today) {
  plan_row <- submission$plan_row
  failed <- function(reason) {
    list(extraction = efficacy_extraction_record(
      plan_row, "failed", today,
      reason = reason, model = model, effort = effort
    ))
  }
  if (is.null(result)) {
    return(failed("no result in the batch"))
  }
  if (result$type == "errored") {
    return(failed(paste0("errored: ", result$error)))
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
      rows_failed = nrow(failed_rows), model = model, effort = effort
    ),
    rows = rows,
    failed_rows = failed_rows
  )
}

efficacy_repeat_error <- "repeats an earlier row (the same row key)"

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
