# The daily pipeline step for "Pivotal results": validates the committed
# extracted rows (data-raw/efficacy-rows.json, written by the on-demand
# extractor), chooses each indication's lead row and writes the site table.
# Only reviews in efficacy_shown_reviews reach the site; flagged rows wait for
# a human and reviewed_rejected rows are tombstones that stop the same row
# coming back.

efficacy_shown_reviews <- c("auto_ok", "reviewed_ok")

efficacy_reviews <- c(efficacy_shown_reviews, "flagged", "reviewed_rejected")

efficacy_effect_types <- c(
  "hr", "hr_noninferiority", "rate_difference", "single_arm_rate",
  "single_arm_median"
)

# An unstated value is NA, so NA is allowed for these two.
efficacy_population_matches <- c(
  "whole_trial_matches", "subgroup_matches", "whole_trial_broader", "other"
)

efficacy_analysis_roles <- c("primary", "later", "exploratory")

# Why a row is malformed: one message per problem, NA where it is fine.
efficacy_row_problems <- function(rows) {
  unknown <- function(values, allowed, what, allow_missing) {
    bad <- !values %in% allowed & (!is.na(values) | !allow_missing)
    ifelse(bad, sprintf("unknown %s \"%s\"", what, values), NA_character_)
  }
  no_quotes <- purrr::map_lgl(rows$quotes, function(quotes) {
    quotes <- quotes[!is.na(quotes)]
    length(quotes) == 0 || all(!nzchar(trimws(quotes)))
  })
  problems <- list(
    unknown(rows$review, efficacy_reviews, "review", FALSE),
    unknown(rows$effect_type, efficacy_effect_types, "effect type", FALSE),
    unknown(
      rows$population_match, efficacy_population_matches,
      "population match", TRUE
    ),
    unknown(rows$analysis_role, efficacy_analysis_roles, "analysis role", TRUE),
    ifelse(
      grepl("^EMEA/H/C/[0-9]{6}$", rows$ema_product_number),
      NA_character_,
      sprintf("not an EMA product number \"%s\"", rows$ema_product_number)
    ),
    ifelse(no_quotes, "no quote", NA_character_),
    ifelse(
      startsWith(dplyr::coalesce(rows$source_url, ""), "https://"),
      NA_character_,
      "source URL is not https"
    ),
    ifelse(is.na(rows$source_date), "no source date", NA_character_),
    ifelse(
      is.na(rows$extractor_model) | !nzchar(rows$extractor_model),
      "no extractor model",
      NA_character_
    ),
    ifelse(is.na(rows$row_key), "no row key", NA_character_)
  )
  purrr::pmap_chr(problems, function(...) {
    found <- c(...)
    found <- found[!is.na(found)]
    if (length(found) == 0) NA_character_ else paste(found, collapse = "; ")
  })
}

# Stops the build on a malformed row or a repeated row key, listing offenders.
check_efficacy_rows <- function(rows) {
  problems <- efficacy_row_problems(rows)
  labelled <- function(index) {
    sprintf(
      "%s (row %d of %s)",
      dplyr::coalesce(rows$row_key[index], "no key"),
      rows$row_order[index],
      rows$ema_product_number[index]
    )
  }
  malformed <- which(!is.na(problems))
  repeated <- unique(rows$row_key[
    !is.na(rows$row_key) & duplicated(rows$row_key)
  ])
  if (length(malformed) == 0 && length(repeated) == 0) {
    return(rows)
  }
  offenders <- c(
    paste0(labelled(malformed), ": ", problems[malformed]),
    sprintf("row key repeated: %s", repeated)
  )
  cli::cli_abort(c(
    "{length(offenders)} malformed pivotal result row{?s} in
    {.path {efficacy_rows_path}}.",
    stats::setNames(escape_cli_braces(offenders), rep("x", length(offenders)))
  ))
}

efficacy_match_rank <- function(population_match) {
  dplyr::case_when(
    population_match %in% "subgroup_matches" ~ 1L,
    population_match %in% "whole_trial_matches" ~ 2L,
    population_match %in% "whole_trial_broader" ~ 3L,
    .default = 4L
  )
}

# Adds `lead`: the one shown row per product and indication the card leads
# with. Among the rows of a primary endpoint (else of the first trial in the
# SmPC): the pre-specified primary analysis, then the row whose population
# matches the indication best (the subgroup that matches over the whole trial
# that matches over one that is broader), then the order in the SmPC. Rows not
# shown never lead.
choose_lead_rows <- function(rows) {
  rows <- dplyr::mutate(rows, row_index = dplyr::row_number())
  leaders <- rows |>
    dplyr::filter(.data$review %in% efficacy_shown_reviews) |>
    dplyr::mutate(
      has_primary = any(.data$is_primary %in% TRUE),
      first_trial = .data$trial[order(.data$row_order)[1]],
      .by = c("ema_product_number", "indication")
    ) |>
    dplyr::filter(
      (.data$has_primary & .data$is_primary %in% TRUE) |
        (!.data$has_primary & .data$trial %in% .data$first_trial)
    ) |>
    dplyr::arrange(
      .data$ema_product_number,
      .data$indication,
      !.data$analysis_role %in% "primary",
      efficacy_match_rank(.data$population_match),
      .data$row_order,
      .data$row_key,
      .locale = "C"
    ) |>
    dplyr::slice_head(n = 1, by = c("ema_product_number", "indication"))
  rows |>
    dplyr::mutate(lead = .data$row_index %in% leaders$row_index) |>
    dplyr::select(-"row_index")
}

# Medicines list the same trial under the same name (MARIPOSA in Rybrevant and
# Lazcluze): its name without the registry number in parentheses, folded.
efficacy_trial_key <- function(trial) {
  trial |>
    stringr::str_remove_all("\\([^)]*\\)") |>
    stringr::str_to_lower() |>
    stringr::str_replace_all("[^a-z0-9]+", "-") |>
    stringr::str_remove_all("^-|-$")
}

efficacy_site_columns <- c(
  "ema_product_number", "row_key", "row_order", "indication", "trial",
  "trial_key", "population", "population_match", "regimen", "comparator",
  "comparator_column_label", "n_treatment", "n_control", "endpoint",
  "assessment", "is_primary", "analysis_role", "analysis", "effect_type",
  "value", "ci_low", "ci_high", "ci_level", "ci_is_range", "p_value",
  "significance_stated", "arm_treatment", "arm_control", "arm_measure", "lead",
  "quotes", "source_url", "source_date", "page", "review", "stale",
  "extractor_model", "extracted_at", "source"
)

# The date of each medicine's current product information, to mark the rows
# extracted from an older one. No documents: nothing is stale.
product_information_dates <- function(documents) {
  if (is.null(documents)) {
    return(dplyr::tibble(
      ema_product_number = character(),
      current_date = as.Date(character())
    ))
  }
  documents |>
    dplyr::filter(.data$document_type == "product-information") |>
    dplyr::summarise(
      current_date = suppressWarnings(
        max(.data$last_updated_date, na.rm = TRUE)
      ),
      .by = "ema_product_number"
    ) |>
    dplyr::filter(is.finite(.data$current_date))
}

# The site file: the shown rows of medicines still in the data, the lead row
# of each indication first. `stale`: extracted from a product information
# older than the medicine's current one (the rows stay until it is extracted
# again).
build_efficacy_table <- function(rows, medicines, documents = NULL) {
  rows |>
    dplyr::filter(
      .data$review %in% efficacy_shown_reviews,
      .data$ema_product_number %in% medicines$ema_product_number
    ) |>
    choose_lead_rows() |>
    dplyr::left_join(
      product_information_dates(documents),
      by = "ema_product_number",
      relationship = "many-to-one"
    ) |>
    dplyr::mutate(
      stale = dplyr::coalesce(.data$source_date < .data$current_date, FALSE),
      trial_key = efficacy_trial_key(.data$trial),
      source = rep("ema_smpc", dplyr::n())
    ) |>
    dplyr::arrange(
      .data$ema_product_number,
      .data$indication,
      dplyr::desc(.data$lead),
      .data$row_order,
      .data$row_key,
      .locale = "C"
    ) |>
    dplyr::select(dplyr::all_of(efficacy_site_columns))
}

efficacy_source_entry <- function(rows) {
  if (nrow(rows) == 0) {
    return(NULL)
  }
  extracted <- max(rows$extracted_at, na.rm = TRUE)
  models <- sort(unique(stats::na.omit(rows$extractor_model)))
  list(
    name = paste(
      "Pivotal results (extracted from EMA product information SmPC",
      "section 5.1 with Claude)"
    ),
    url = "https://www.ema.europa.eu/en/medicines",
    version = paste0(
      "Extracted ", extracted, "; models ", paste(models, collapse = ", ")
    ),
    retrieved = format(extracted),
    licence = "Quotes © EMA; extraction CC BY-SA 4.0 (compilation)",
    attribution = paste(
      "Quoted from section 5.1 of EMA product information (© European",
      "Medicines Agency); numbers extracted automatically with Claude and",
      "checked against the quoted text. Results come from different trials,",
      "populations and comparators, not a head-to-head comparison."
    )
  )
}

report_efficacy_summary <- function(rows, table) {
  if (nrow(rows) == 0) {
    return(invisible())
  }
  cli::cli_alert_info(sprintf(
    paste(
      "Pivotal results: %d medicines, %d rows shown, %d flagged awaiting",
      "review, %d rejected, %d stale (product information changed since)."
    ),
    dplyr::n_distinct(table$ema_product_number),
    nrow(table),
    sum(rows$review == "flagged"),
    sum(rows$review == "reviewed_rejected"),
    sum(table$stale)
  ))
  invisible()
}
