# On demand, never in CI or the daily pipeline (scripts/scan-epar-copies.R):
# reads the EPAR page of every Authorised medicine the protection estimate
# counts as its own and protected, and lists the pages that call it a
# hybrid, generic or biosimilar medicine, for review by hand before a row
# joins curated_copy_medicines(). Nothing here changes the data. EMA
# rate-limits, so pages are read at least 20 s apart, a budget per run, and
# every result is saved at once, so a rerun resumes.

epar_scan_default_budget <- 30L

epar_scan_spacing_seconds <- 20

# "is a ‘hybrid medicine’", "a ‘hybrid’ medicine", "a biosimilar medicinal
# product", but not the "Generic and hybrid medicines" link.
copy_statement_pattern <- stringr::regex(
  "\\b(hybrid|generic|biosimilar)\\W{0,2}\\s+medicin(e|al product)\\b",
  ignore_case = TRUE
)

epar_scan_budget_from_env <- function(value = NULL) {
  value <- value %||% Sys.getenv("APPROVAL_ATLAS_EPAR_BUDGET")
  if (identical(value, "")) {
    return(epar_scan_default_budget)
  }
  if (!grepl("^[0-9]+$", value)) {
    cli::cli_abort(
      "{.envvar APPROVAL_ATLAS_EPAR_BUDGET} must be a whole number of pages,
      not {.val {value}}."
    )
  }
  as.integer(value)
}

empty_epar_copy_checks <- function() {
  dplyr::tibble(
    ema_product_number = character(),
    name_of_medicine = character(),
    url = character(),
    checked_date = as.Date(character()),
    page_status = character(),
    copy_types = character(),
    statement = character()
  )
}

read_epar_copy_checks <- function(path) {
  if (!file.exists(path)) {
    return(empty_epar_copy_checks())
  }
  rows <- jsonlite::fromJSON(path)
  if (length(rows) == 0) {
    return(empty_epar_copy_checks())
  }
  # jsonlite reads an all-null column as logical.
  dplyr::as_tibble(rows) |>
    dplyr::mutate(
      dplyr::across(-"checked_date", as.character),
      checked_date = as.Date(as.character(.data$checked_date))
    )
}

# The page's paragraphs that say what kind of copy the medicine is.
find_copy_statements <- function(page) {
  paragraphs <- page |>
    xml2::xml_find_all("//p|//li|//dd") |>
    xml2::xml_text() |>
    stringr::str_squish()
  unique(paragraphs[stringr::str_detect(paragraphs, copy_statement_pattern)])
}

copy_types_of <- function(statements) {
  words <- stringr::str_match_all(statements, copy_statement_pattern)
  types <- sort(unique(tolower(unlist(purrr::map(words, function(match) {
    match[, 2]
  })))))
  if (length(types) == 0) NA_character_ else paste(types, collapse = ", ")
}

# Authorised medicines counted as their own and protected, not yet curated
# or checked, by product number.
plan_epar_copy_scan <- function(protection, medicines, copies, checks, budget) {
  protection |>
    dplyr::filter(.data$basis == "own", .data$status == "protected") |>
    dplyr::select("ema_product_number") |>
    dplyr::inner_join(
      dplyr::select(
        medicines,
        "ema_product_number",
        "name_of_medicine",
        "medicine_status",
        url = "medicine_url"
      ),
      by = "ema_product_number",
      relationship = "one-to-one"
    ) |>
    dplyr::filter(
      .data$medicine_status == "Authorised",
      startsWith(.data$url, "https://"),
      !.data$ema_product_number %in% copies$ema_product_number,
      !.data$ema_product_number %in% checks$ema_product_number
    ) |>
    dplyr::select("ema_product_number", "name_of_medicine", "url") |>
    dplyr::arrange(.data$ema_product_number) |>
    utils::head(budget)
}

# Mocked in tests.
fetch_epar_page <- function(url) {
  response <- ema_request(url) |>
    httr2::req_error(is_error = function(response) FALSE) |>
    httr2::req_perform()
  status <- httr2::resp_status(response)
  list(
    status = status,
    body = if (status == 200L) httr2::resp_body_string(response) else NULL
  )
}

epar_check_row <- function(plan_row, page_status, statements, today) {
  dplyr::tibble(
    ema_product_number = plan_row$ema_product_number,
    name_of_medicine = plan_row$name_of_medicine,
    url = plan_row$url,
    checked_date = today,
    page_status = page_status,
    copy_types = copy_types_of(statements),
    statement = if (length(statements) == 0) {
      NA_character_
    } else {
      stringr::str_trunc(statements[[1]], 300)
    }
  )
}

# A page that is not HTML or lacks the medicine's name (a firewall challenge
# served with status 200) stops the scan like a 429.
check_epar_page <- function(plan_row, today) {
  page <- fetch_epar_page(plan_row$url)
  if (page$status %in% c(404L, 410L)) {
    return(list(row = epar_check_row(plan_row, "not_found", NULL, today)))
  }
  if (page$status != 200L) {
    return(list(problem = paste("EMA returned HTTP", page$status)))
  }
  document <- tryCatch(
    xml2::read_html(page$body),
    error = function(error) NULL
  )
  name <- sub(" \\(.*$", "", plan_row$name_of_medicine)
  if (is.null(document) ||
        !grepl(name, xml2::xml_text(document), fixed = TRUE)) {
    return(list(problem = "EMA returned a page without the medicine's name"))
  }
  statements <- find_copy_statements(document)
  list(row = epar_check_row(plan_row, "read", statements, today))
}

scan_epar_copy_pages <- function(plan,
                                 checks,
                                 checks_path,
                                 spacing_seconds = epar_scan_spacing_seconds,
                                 today = Sys.Date()) {
  dir.create(dirname(checks_path), recursive = TRUE, showWarnings = FALSE)
  for (row in seq_len(nrow(plan))) {
    plan_row <- plan[row, ]
    wait_seconds(spacing_seconds)
    cli::cli_inform("Reading {.url {plan_row$url}}.")
    outcome <- tryCatch(
      check_epar_page(plan_row, today),
      httr2_failure = function(error) list(problem = conditionMessage(error))
    )
    if (is.null(outcome$row)) {
      cli::cli_warn(c(
        "Stopped reading EPAR pages: {outcome$problem}.",
        i = "{nrow(plan) - row + 1} page{?s} left for a later run."
      ))
      break
    }
    checks <- dplyr::bind_rows(checks, outcome$row) |>
      dplyr::arrange(.data$ema_product_number)
    write_json_table(checks, checks_path)
  }
  checks
}

# The checked pages that call a medicine not yet curated a copy.
epar_copy_candidates <- function(checks, copies) {
  checks |>
    dplyr::filter(
      !is.na(.data$copy_types),
      !.data$ema_product_number %in% copies$ema_product_number
    )
}

report_epar_copy_candidates <- function(candidates, checked, left) {
  cli::cli_alert_info(paste(
    "EPAR pages checked: {checked}, {left} left; {nrow(candidates)} call the",
    "medicine a hybrid, generic or biosimilar (check each by hand before",
    "adding it to {.fn curated_copy_medicines})."
  ))
  if (nrow(candidates) > 0) {
    cli::cli_verbatim(sprintf(
      "  %s (%s): %s\n    %s\n    %s",
      candidates$name_of_medicine,
      candidates$ema_product_number,
      candidates$copy_types,
      candidates$statement,
      candidates$url
    ))
  }
  invisible(candidates)
}

run_epar_copy_scan <- function(data_directory = "site/public/data",
                               cache_directory =
                                 ".cache/downloads/ema-epar-copies",
                               budget = epar_scan_budget_from_env(),
                               copies = curated_copy_medicines()) {
  protection <- jsonlite::fromJSON(
    file.path(data_directory, "ema_medicine_protection.json")
  )
  medicines <- jsonlite::fromJSON(
    file.path(data_directory, "ema_medicines.json")
  )
  checks_path <- file.path(cache_directory, "checks.json")
  checks <- read_epar_copy_checks(checks_path)
  plan <- plan_epar_copy_scan(protection, medicines, copies, checks, budget)
  checks <- scan_epar_copy_pages(plan, checks, checks_path)
  left <- nrow(plan_epar_copy_scan(
    protection,
    medicines,
    copies,
    checks,
    budget = nrow(protection)
  ))
  report_epar_copy_candidates(
    epar_copy_candidates(checks, copies),
    checked = nrow(checks),
    left = left
  )
}
