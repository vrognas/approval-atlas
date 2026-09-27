# ATC codes from section 5.1 of EMA product information (SmPC) PDFs, for
# products whose EMA code is incomplete or missing. EMA rate-limits after
# 9-46 requests at 1-2 s, so the PDFs are fetched slowly, a few per run, and
# every result is kept: the checks file is both provenance and resume state.

smpc_default_budget <- 8L

smpc_request_spacing_seconds <- 20

# A document that could not be read or was missing is tried again after this
# many days, in case the failure was passing.
smpc_retry_days <- 180

smpc_retry_statuses <- c("no_text", "not_found")

# Bumped when extract_smpc_atc_codes() learns to read more; a product whose
# last check, by an older reader, found no complete code is checked again.
# Version 2: "ATC" and "code" on two lines, "(ATC) code", a letter O for a
# zero ("VO4CX"). Checks without a version were made by version 1.
smpc_reader_version <- 2L

smpc_reread_statuses <- c("no_code", "incomplete")

smpc_budget_from_env <- function(value =
                                   Sys.getenv("APPROVAL_ATLAS_SMPC_BUDGET")) {
  if (identical(value, "")) {
    return(smpc_default_budget)
  }
  if (!grepl("^[0-9]+$", value)) {
    cli::cli_abort(
      "{.envvar APPROVAL_ATLAS_SMPC_BUDGET} must be a whole number of
      documents, not {.val {value}}."
    )
  }
  as.integer(value)
}

empty_smpc_checks <- function() {
  dplyr::tibble(
    ema_product_number = character(),
    document_url = character(),
    document_last_updated_date = as.Date(character()),
    checked_date = as.Date(character()),
    reader_version = integer(),
    smpc_status = character(),
    atc_code = character(),
    source = character()
  )
}

# "ATC code", "ATC Code", "ATC-code", "ATC codes", "ATC" and "code" on two
# lines, "(ATC) code", but not "BATCH".
atc_label_pattern <- "(?<![A-Za-z])ATC\\)?[\\s-]*(?i:codes?)\\b\\s*:?"

# A code may wrap onto the next line or carry a stray space ("L04AC 13"), and
# may have a letter O where a digit belongs ("VO4CX").
atc_code_text_pattern <- paste0(
  "[A-Z]\\s?[0-9O]\\s?[0-9O]",
  "(?:\\s?[A-Z](?:\\s?[A-Z](?:\\s?[0-9O]\\s?[0-9O])?)?)?"
)

atc_digit_positions <- c(2L, 3L, 6L, 7L)

# A letter O becomes a zero in a digit position only.
zero_for_letter_o <- function(codes) {
  for (position in atc_digit_positions) {
    is_letter_o <- substr(codes, position, position) == "O"
    substr(codes[is_letter_o], position, position) <- "0"
  }
  codes
}

atc_code_list_pattern <- paste0(
  "^\\s*", atc_code_text_pattern,
  "(?:\\s*(?:,|;|/|&|\\band\\b|\\bor\\b)\\s*", atc_code_text_pattern, ")*"
)

not_assigned_pattern <- stringr::regex(
  "^\\s*not\\s+(yet\\s+)?(assigned|allocated|available)",
  ignore_case = TRUE
)

# Returns the status and the distinct valid codes after every "ATC code"
# label: one PI holds one SmPC per strength or form.
extract_smpc_atc_codes <- function(text) {
  if (is.na(text) || !grepl("[[:alnum:]]", text)) {
    return(list(status = "no_text", codes = character()))
  }
  label_ends <- stringr::str_locate_all(text, atc_label_pattern)[[1]][, "end"]
  if (length(label_ends) == 0) {
    return(list(status = "no_code", codes = character()))
  }
  windows <- substring(text, label_ends + 1, label_ends + 120)
  code_lists <- stringr::str_extract(windows, atc_code_list_pattern)
  codes <- unlist(stringr::str_extract_all(
    code_lists[!is.na(code_lists)],
    atc_code_text_pattern
  ))
  codes <- unique(zero_for_letter_o(stringr::str_remove_all(codes, "\\s")))
  codes <- codes[!is.na(atc_code_level(codes))]
  status <- dplyr::case_when(
    any(atc_code_level(codes) == 5L) ~ "code_found",
    length(codes) > 0 ~ "incomplete",
    any(stringr::str_detect(windows, not_assigned_pattern)) ~ "not_assigned",
    .default = "no_code"
  )
  list(status = status, codes = codes)
}

read_pdf_text <- function(path) {
  paste(pdftools::pdf_text(path), collapse = "\n")
}

read_smpc_checks <- function(path) {
  if (!file.exists(path)) {
    return(empty_smpc_checks())
  }
  rows <- jsonlite::fromJSON(path)
  if (length(rows) == 0) {
    return(empty_smpc_checks())
  }
  rows <- dplyr::as_tibble(rows)
  if (!"reader_version" %in% names(rows)) {
    rows$reader_version <- 1L
  }
  # jsonlite reads an all-null column as logical.
  rows |>
    dplyr::transmute(
      ema_product_number = as.character(.data$ema_product_number),
      document_url = as.character(.data$document_url),
      document_last_updated_date = as.Date(
        as.character(.data$document_last_updated_date)
      ),
      checked_date = as.Date(as.character(.data$checked_date)),
      reader_version = as.integer(.data$reader_version),
      smpc_status = as.character(.data$smpc_status),
      atc_code = as.character(.data$atc_code),
      source = as.character(.data$source)
    )
}

# The newest check of each product, from the cache and the committed file
# (which seeds an empty cache on CI).
merge_smpc_checks <- function(...) {
  dplyr::bind_rows(empty_smpc_checks(), ...) |>
    dplyr::distinct() |>
    dplyr::arrange(
      .data$ema_product_number,
      dplyr::desc(.data$checked_date),
      dplyr::desc(.data$reader_version),
      dplyr::desc(.data$document_last_updated_date)
    ) |>
    dplyr::mutate(
      check_key = paste(
        .data$checked_date,
        .data$reader_version,
        .data$document_url,
        .data$document_last_updated_date
      )
    ) |>
    dplyr::filter(
      .data$check_key == dplyr::first(.data$check_key),
      .by = "ema_product_number"
    ) |>
    dplyr::select(-"check_key") |>
    dplyr::arrange(.data$ema_product_number, .data$atc_code)
}

# Products whose EMA code is incomplete, malformed or missing and whose
# product information was not checked yet, changed since, could not be read
# more than `smpc_retry_days` ago, or gave no complete code to an older
# reader: Authorised first, then the newest documents.
plan_smpc_checks <- function(atc_codes,
                             medicines,
                             documents,
                             checks,
                             budget,
                             today = Sys.Date()) {
  needs_code <- !medicines$ema_product_number %in%
    atc_codes$ema_product_number |
    medicines$ema_product_number %in%
      atc_codes$ema_product_number[atc_codes$atc_incomplete]
  product_information <- documents |>
    dplyr::filter(.data$document_type == "product-information") |>
    dplyr::distinct(.data$ema_product_number, .keep_all = TRUE) |>
    dplyr::select(
      "ema_product_number",
      document_url = "url",
      document_last_updated_date = "last_updated_date"
    )
  last_checks <- checks |>
    dplyr::distinct(.data$ema_product_number, .keep_all = TRUE) |>
    dplyr::select(
      "ema_product_number",
      checked_url = "document_url",
      checked_document_date = "document_last_updated_date",
      "checked_date",
      checked_reader_version = "reader_version",
      checked_status = "smpc_status"
    )
  medicines[needs_code, c("ema_product_number", "medicine_status")] |>
    dplyr::inner_join(
      product_information,
      by = "ema_product_number",
      relationship = "one-to-one"
    ) |>
    dplyr::left_join(
      last_checks,
      by = "ema_product_number",
      relationship = "one-to-one"
    ) |>
    dplyr::filter(
      is.na(.data$checked_url) |
        .data$checked_url != .data$document_url |
        dplyr::coalesce(
          .data$document_last_updated_date > .data$checked_document_date,
          !is.na(.data$document_last_updated_date)
        ) |
        (.data$checked_status %in% smpc_retry_statuses &
           .data$checked_date < today - smpc_retry_days) |
        (.data$checked_status %in% smpc_reread_statuses &
           .data$checked_reader_version < smpc_reader_version)
    ) |>
    dplyr::arrange(
      dplyr::desc(.data$medicine_status == "Authorised"),
      dplyr::desc(.data$document_last_updated_date),
      .data$ema_product_number
    ) |>
    dplyr::select(
      "ema_product_number",
      "medicine_status",
      "document_url",
      "document_last_updated_date"
    ) |>
    utils::head(budget)
}

smpc_check_rows <- function(plan_row, status, codes, today) {
  dplyr::tibble(
    ema_product_number = plan_row$ema_product_number,
    document_url = plan_row$document_url,
    document_last_updated_date = plan_row$document_last_updated_date,
    checked_date = today,
    reader_version = smpc_reader_version,
    smpc_status = status,
    atc_code = if (length(codes) == 0) NA_character_ else codes,
    source = "ema_smpc"
  )
}

# Mocked in tests.
wait_seconds <- function(seconds) {
  Sys.sleep(seconds)
}

# PDF readers accept the "%PDF-" header anywhere in the first 1024 bytes.
is_pdf_file <- function(path) {
  header <- readBin(path, "raw", 1024)
  length(grepRaw("%PDF-", header, fixed = TRUE)) > 0
}

check_product_information <- function(plan_row, today) {
  pdf_path <- tempfile(fileext = ".pdf")
  on.exit(unlink(pdf_path), add = TRUE)
  response <- ema_request(plan_row$document_url) |>
    httr2::req_error(is_error = function(response) FALSE) |>
    httr2::req_perform(path = pdf_path)
  status <- httr2::resp_status(response)
  if (status %in% c(404L, 410L)) {
    return(list(rows = smpc_check_rows(plan_row, "not_found", NULL, today)))
  }
  if (status != 200L) {
    return(list(problem = paste("EMA returned HTTP", status)))
  }
  # A firewall challenge or error page served with status 200 stops the step
  # like a 429: recorded as "no_text", it would replace the product's earlier
  # result until the retry.
  if (!is_pdf_file(pdf_path)) {
    return(list(problem = "EMA returned a non-PDF response"))
  }
  extraction <- tryCatch(
    extract_smpc_atc_codes(read_pdf_text(pdf_path)),
    error = function(error) {
      cli::cli_warn(
        "No text read from {.url {plan_row$document_url}}:
        {conditionMessage(error)}"
      )
      list(status = "no_text", codes = character())
    }
  )
  list(
    rows = smpc_check_rows(plan_row, extraction$status, extraction$codes, today)
  )
}

replace_product_checks <- function(checks, product_rows) {
  checks |>
    dplyr::filter(
      !.data$ema_product_number %in% product_rows$ema_product_number
    ) |>
    dplyr::bind_rows(product_rows) |>
    dplyr::arrange(.data$ema_product_number, .data$atc_code)
}

# A 429 (or any other failure) ends the step with a warning, never the
# build: the finished checks are saved after each PDF, and the rest waits
# for a later run.
fetch_smpc_checks <- function(plan,
                              checks,
                              checks_path,
                              spacing_seconds = smpc_request_spacing_seconds,
                              today = Sys.Date()) {
  requests <- 0L
  stop_reason <- NA_character_
  dir.create(dirname(checks_path), recursive = TRUE, showWarnings = FALSE)
  for (row in seq_len(nrow(plan))) {
    plan_row <- plan[row, ]
    wait_seconds(spacing_seconds)
    cli::cli_inform("Reading the ATC code in {.url {plan_row$document_url}}.")
    requests <- requests + 1L
    outcome <- tryCatch(
      check_product_information(plan_row, today),
      httr2_failure = function(error) list(problem = conditionMessage(error))
    )
    if (is.null(outcome$rows)) {
      stop_reason <- outcome$problem
      cli::cli_warn(c(
        "Stopped reading product information after {requests} request{?s}:
        {stop_reason}.",
        i = "{nrow(plan) - row + 1} document{?s} left for a later run."
      ))
      break
    }
    checks <- replace_product_checks(checks, outcome$rows)
    write_json_table(checks, checks_path)
  }
  list(checks = checks, requests = requests, stop_reason = stop_reason)
}

update_smpc_checks <- function(atc_codes,
                               medicines,
                               documents,
                               cache_directory,
                               committed_path,
                               budget) {
  checks_path <- file.path(cache_directory, "checks.json")
  checks <- merge_smpc_checks(
    read_smpc_checks(checks_path),
    read_smpc_checks(committed_path)
  )
  plan <- plan_smpc_checks(atc_codes, medicines, documents, checks, budget)
  run <- fetch_smpc_checks(plan, checks, checks_path)
  c(run, list(budget = budget))
}

build_smpc_atc_table <- function(checks, medicines) {
  checks |>
    dplyr::semi_join(medicines, by = "ema_product_number") |>
    dplyr::arrange(.data$ema_product_number, .data$atc_code)
}

smpc_source_entry <- function(checks) {
  latest <- if (nrow(checks) == 0) {
    NA_character_
  } else {
    format(max(checks$checked_date))
  }
  list(
    name = paste(
      "European Medicines Agency (EMA) product information",
      "(SmPC section 5.1, ATC code)"
    ),
    url = "https://www.ema.europa.eu/en/medicines",
    version = sprintf(
      "%d product information documents checked",
      dplyr::n_distinct(checks$ema_product_number)
    ),
    retrieved = latest,
    licence = "© European Medicines Agency; reuse with acknowledgement",
    attribution = ema_attribution
  )
}
