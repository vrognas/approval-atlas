# The on-demand extractor of pivotal efficacy results
# (scripts/extract-efficacy.R): which products to extract, the two committed
# files it keeps in data-raw, the flags that send a row to a human and the
# reviews that survive a rerun. The fetching and the Claude batch are in
# efficacy-batch.R. Never run by the daily pipeline or CI.

efficacy_default_model <- "claude-sonnet-5-5"

efficacy_default_budget <- 25L

efficacy_rows_path <- "data-raw/efficacy-rows.json"

efficacy_extractions_path <- "data-raw/efficacy-extractions.json"

efficacy_text_cache <- ".cache/downloads/ema-efficacy"

efficacy_budget_from_env <- function(value =
                                       Sys.getenv(
                                         "APPROVAL_ATLAS_EFFICACY_BUDGET"
                                       )) {
  if (identical(value, "")) {
    return(efficacy_default_budget)
  }
  if (!grepl("^[0-9]+$", value)) {
    cli::cli_abort(
      "{.envvar APPROVAL_ATLAS_EFFICACY_BUDGET} must be a whole number of
      products, not {.val {value}}."
    )
  }
  as.integer(value)
}

# A comma list of product numbers, or NULL when unset.
efficacy_only_from_env <- function(value =
                                     Sys.getenv(
                                       "APPROVAL_ATLAS_EFFICACY_ONLY"
                                     )) {
  numbers <- trimws(strsplit(value, ",", fixed = TRUE)[[1]])
  numbers <- unique(numbers[nzchar(numbers)])
  if (length(numbers) == 0) {
    return(NULL)
  }
  malformed <- numbers[!grepl("^EMEA/H/C/[0-9]{6}$", numbers)]
  if (length(malformed) > 0) {
    cli::cli_abort(c(
      "{.envvar APPROVAL_ATLAS_EFFICACY_ONLY} must list EMA product numbers
      (EMEA/H/C/000000), separated by commas.",
      x = "{.val {malformed}}"
    ))
  }
  numbers
}

# The model's row fields, in the order of efficacy_row_properties().
efficacy_field_types <- c(
  indication = "character", trial = "character", population = "character",
  population_match = "character", regimen = "character",
  comparator = "character", comparator_column_label = "character",
  n_treatment = "integer", n_control = "integer", endpoint = "character",
  assessment = "character", is_primary = "logical",
  analysis_role = "character", analysis = "character",
  effect_type = "character", value = "character", ci_low = "character",
  ci_high = "character", ci_level = "double", ci_is_range = "logical",
  p_value = "character", significance_stated = "character",
  arm_treatment = "character", arm_control = "character",
  arm_measure = "character", quotes = "list"
)

efficacy_row_types <- c(
  ema_product_number = "character", row_key = "character",
  row_order = "integer", efficacy_field_types, page = "integer",
  source_url = "character", source_date = "Date",
  verification = "character", flags = "list", review = "character",
  extractor_model = "character", extracted_at = "Date"
)

efficacy_extraction_types <- c(
  ema_product_number = "character", document_url = "character",
  document_last_updated_date = "Date", status = "character",
  reason = "character", rows_kept = "integer", rows_failed = "integer",
  extractor_model = "character", extracted_at = "Date"
)

empty_typed_column <- function(type) {
  switch(type,
    character = character(),
    integer = integer(),
    double = double(),
    logical = logical(),
    Date = as.Date(character()),
    list = list()
  )
}

# NULL, an empty value and JSON null all become NA of the column's type.
typed_value <- function(value, type) {
  if (type == "list") {
    return(list(as.character(unlist(value))))
  }
  if (length(value) == 0 || all(is.na(value))) {
    value <- NA
  }
  switch(type,
    character = as.character(value),
    integer = as.integer(value),
    double = as.numeric(value),
    logical = as.logical(value),
    Date = as.Date(as.character(value))
  )
}

# Records (named lists, as parsed rows or JSON objects) to a tibble with one
# column per type, missing fields as NA; other fields are left out.
typed_table <- function(records, types) {
  columns <- purrr::imap(types, function(type, name) {
    if (length(records) == 0) {
      return(empty_typed_column(type))
    }
    values <- purrr::map(records, \(record) typed_value(record[[name]], type))
    do.call(c, values)
  })
  dplyr::as_tibble(columns)
}

efficacy_row_table <- function(records) {
  typed_table(records, efficacy_row_types)
}

empty_efficacy_rows <- function() {
  efficacy_row_table(list())
}

empty_efficacy_extractions <- function() {
  typed_table(list(), efficacy_extraction_types)
}

read_json_records <- function(path, types) {
  if (!file.exists(path)) {
    return(typed_table(list(), types))
  }
  typed_table(jsonlite::fromJSON(path, simplifyVector = FALSE), types)
}

read_efficacy_rows <- function(path = efficacy_rows_path) {
  read_json_records(path, efficacy_row_types)
}

read_efficacy_extractions <- function(path = efficacy_extractions_path) {
  read_json_records(path, efficacy_extraction_types)
}

# Authorised medicines with product information that were never extracted,
# whose product information changed since, or whose extraction failed; with
# `only`, exactly the listed products (extracted or not, so they can be
# extracted again, e.g. with another model). Newest documents first.
plan_efficacy_extractions <- function(medicines,
                                      documents,
                                      extractions,
                                      budget,
                                      only = efficacy_only_from_env()) {
  product_information <- documents |>
    dplyr::filter(.data$document_type == "product-information") |>
    dplyr::arrange(
      .data$ema_product_number,
      dplyr::desc(.data$last_updated_date)
    ) |>
    dplyr::distinct(.data$ema_product_number, .keep_all = TRUE) |>
    dplyr::select(
      "ema_product_number",
      document_url = "url",
      document_last_updated_date = "last_updated_date"
    )
  last_extractions <- extractions |>
    dplyr::distinct(.data$ema_product_number, .keep_all = TRUE) |>
    dplyr::select(
      "ema_product_number",
      extracted_url = "document_url",
      extracted_document_date = "document_last_updated_date",
      extracted_status = "status"
    )
  candidates <- medicines |>
    dplyr::filter(.data$medicine_status == "Authorised") |>
    dplyr::select(
      "ema_product_number", "name_of_medicine", "therapeutic_indication"
    ) |>
    dplyr::inner_join(
      product_information,
      by = "ema_product_number",
      relationship = "one-to-one"
    ) |>
    dplyr::left_join(
      last_extractions,
      by = "ema_product_number",
      relationship = "one-to-one"
    )
  planned <- if (is.null(only)) {
    dplyr::filter(
      candidates,
      is.na(.data$extracted_url) |
        .data$extracted_url != .data$document_url |
        dplyr::coalesce(
          .data$document_last_updated_date > .data$extracted_document_date,
          !is.na(.data$document_last_updated_date)
        ) |
        dplyr::coalesce(.data$extracted_status == "failed", FALSE)
    )
  } else {
    warn_unplanned_products(setdiff(only, candidates$ema_product_number))
    dplyr::filter(candidates, .data$ema_product_number %in% only)
  }
  planned |>
    dplyr::arrange(
      dplyr::desc(.data$document_last_updated_date),
      .data$ema_product_number
    ) |>
    dplyr::select(
      "ema_product_number", "name_of_medicine", "therapeutic_indication",
      "document_url", "document_last_updated_date"
    ) |>
    utils::head(budget)
}

warn_unplanned_products <- function(unplanned) {
  if (length(unplanned) > 0) {
    cli::cli_warn(c(
      "Not extracted: {.val {unplanned}}.",
      i = "Only authorised medicines with product information are extracted."
    ))
  }
}

efficacy_key_fields <- c(
  "ema_product_number", "trial", "endpoint", "population", "analysis",
  "value", "ci_low", "ci_high"
)

# The same product, trial, endpoint, population, analysis and numbers give
# the same key, so a human review survives a rerun that finds them again.
efficacy_row_key <- function(row) {
  parts <- purrr::map_chr(efficacy_key_fields, function(field) {
    value <- row[[field]]
    if (is_absent(value)) "" else as.character(value)
  })
  digest::digest(
    paste(parts, collapse = "\u001f"),
    algo = "sha1",
    serialize = FALSE
  )
}

mentions_not_reached <- function(text) {
  !is_absent(text) && grepl("\\b(NR|NE)\\b", text, perl = TRUE)
}

# Every reason a verified row needs a human before it is shown.
efficacy_flags <- function(row, verification) {
  ci_level <- row[["ci_level"]]
  effect_type <- row[["effect_type"]]
  single_arm_hr <- is_absent(row[["comparator"]]) &&
    !is_absent(effect_type) && startsWith(effect_type, "hr")
  checks <- c(
    reassembled = length(verification$warnings) > 0,
    ci_level = !is_absent(ci_level) && ci_level != 95,
    is_primary_unknown = is_absent(row[["is_primary"]]),
    population_differs = !is_absent(row[["population_match"]]) &&
      row[["population_match"]] %in% c("whole_trial_broader", "other"),
    ci_is_range = isTRUE(row[["ci_is_range"]]),
    not_reached = any(purrr::map_lgl(
      c("value", "arm_treatment", "arm_control"),
      \(field) mentions_not_reached(row[[field]])
    )),
    single_arm_hr = single_arm_hr,
    comparator_label_missing = !is_absent(row[["comparator"]]) &&
      is_absent(row[["comparator_column_label"]])
  )
  names(checks)[checks]
}

efficacy_human_reviews <- c("reviewed_ok", "reviewed_rejected")

# New rows keep a human review of the same row (same key); else they are
# flagged or auto_ok. The old rows of `replaced_products` give way to the new
# ones; the other products' rows are kept.
merge_efficacy_reviews <- function(new_rows,
                                   old_rows,
                                   replaced_products =
                                     unique(new_rows$ema_product_number)) {
  reviews <- old_rows |>
    dplyr::filter(.data$review %in% efficacy_human_reviews) |>
    dplyr::distinct(.data$row_key, .keep_all = TRUE) |>
    dplyr::select("row_key", human_review = "review")
  reviewed <- new_rows |>
    dplyr::select(-dplyr::any_of("review")) |>
    dplyr::left_join(reviews, by = "row_key") |>
    dplyr::mutate(
      review = dplyr::coalesce(
        .data$human_review,
        dplyr::if_else(lengths(.data$flags) > 0, "flagged", "auto_ok")
      )
    ) |>
    dplyr::select(-"human_review")
  old_rows |>
    dplyr::filter(!.data$ema_product_number %in% replaced_products) |>
    dplyr::bind_rows(reviewed)
}

# New answers (rows, or none) replace a product's rows; after a failure, a
# missing PDF or no section 5.1, its earlier rows stay, marked stale by the
# pipeline once the product information changed.
efficacy_replacing_statuses <- c("ok", "no_rows")

efficacy_pipeline_hint <- c(
  i = "Run {.code Rscript scripts/run-pipeline.R} first."
)

run_efficacy_extraction <- function(budget = efficacy_budget_from_env(),
                                    model = efficacy_default_model,
                                    poll_seconds = 60,
                                    medicines_path =
                                      "site/public/data/ema_medicines.json",
                                    documents_path = file.path(
                                      ".cache/downloads/ema-documents",
                                      "epar_documents.json"
                                    ),
                                    rows_path = efficacy_rows_path,
                                    extractions_path =
                                      efficacy_extractions_path,
                                    today = Sys.Date()) {
  inputs <- c(medicines_path, documents_path)
  missing <- inputs[!file.exists(inputs)]
  if (length(missing) > 0) {
    cli::cli_abort(c("Missing {.path {missing}}.", efficacy_pipeline_hint))
  }
  medicines <- dplyr::as_tibble(jsonlite::fromJSON(medicines_path))
  documents <- select_epar_documents(read_epar_documents(documents_path)$data)
  old_rows <- read_efficacy_rows(rows_path)
  old_extractions <- read_efficacy_extractions(extractions_path)
  plan <- plan_efficacy_extractions(medicines, documents, old_extractions,
                                    budget)
  if (nrow(plan) == 0) {
    cli::cli_inform("No product to extract.")
    return(invisible(list(
      extracted = empty_efficacy_extractions(),
      failed = empty_failed_efficacy_rows(),
      rows = old_rows
    )))
  }
  cli::cli_inform("{nrow(plan)} product{?s} to extract with {.val {model}}.")
  run <- extract_efficacy_batch(plan, model, poll_seconds, today)
  replaced <- run$extractions$ema_product_number[
    run$extractions$status %in% efficacy_replacing_statuses
  ]
  rows <- merge_efficacy_reviews(run$rows, old_rows, replaced) |>
    dplyr::select(dplyr::all_of(names(efficacy_row_types))) |>
    dplyr::arrange(.data$ema_product_number, .data$row_order)
  extractions <- old_extractions |>
    dplyr::filter(
      !.data$ema_product_number %in% run$extractions$ema_product_number
    ) |>
    dplyr::bind_rows(run$extractions) |>
    dplyr::arrange(.data$ema_product_number)
  for (path in c(rows_path, extractions_path)) {
    dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  }
  write_json_table(rows, rows_path)
  write_json_table(extractions, extractions_path)
  report_efficacy_run(run, rows)
  invisible(list(
    extracted = run$extractions,
    failed = run$failed_rows,
    rows = rows
  ))
}

report_efficacy_run <- function(run, rows) {
  statuses <- run$extractions$status
  count <- function(status) sum(statuses == status)
  new_rows <- dplyr::semi_join(rows, run$rows, by = "row_key")
  cli::cli_inform(c(
    sprintf(
      paste(
        "Extracted %d product(s): %d ok, %d without rows, %d without",
        "section 5.1, %d not found, %d failed."
      ),
      length(statuses), count("ok"), count("no_rows"), count("no_section"),
      count("not_found"), count("failed")
    ),
    i = sprintf(
      "%d row(s) kept, %d flagged for review; %d failed verification.",
      nrow(new_rows), sum(new_rows$review == "flagged"),
      nrow(run$failed_rows)
    )
  ))
  failed <- run$extractions[statuses == "failed", ]
  if (nrow(failed) > 0) {
    cli::cli_inform(c(
      "Failed (planned again on the next run):",
      stats::setNames(
        escape_cli_braces(paste0(
          failed$ema_product_number, ": ", failed$reason
        )),
        "x"
      )
    ))
  }
  if (nrow(run$failed_rows) > 0) {
    first_errors <- purrr::map_chr(run$failed_rows$errors, 1)
    cli::cli_inform(c(
      "Rows failing verification (not written):",
      stats::setNames(
        escape_cli_braces(paste0(
          run$failed_rows$ema_product_number, " ",
          dplyr::coalesce(run$failed_rows$trial, "?"), ", ",
          dplyr::coalesce(run$failed_rows$endpoint, "?"), ": ",
          first_errors
        )),
        "x"
      )
    ))
  }
}
