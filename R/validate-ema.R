expected_ema_columns <- c(
  "category",
  "name_of_medicine",
  "ema_product_number",
  "medicine_status",
  "opinion_status",
  "latest_procedure_affecting_product_information",
  "international_non_proprietary_name_common_name",
  "active_substance",
  "therapeutic_area_mesh",
  "species_veterinary",
  "patient_safety",
  "atc_code_human",
  "atcvet_code_veterinary",
  "pharmacotherapeutic_group_human",
  "pharmacotherapeutic_group_veterinary",
  "therapeutic_indication",
  "accelerated_assessment",
  "additional_monitoring",
  "advanced_therapy",
  "biosimilar",
  "conditional_approval",
  "exceptional_circumstances",
  "generic",
  "orphan_medicine",
  "prime_priority_medicine",
  "marketing_authorisation_developer_applicant_holder",
  "european_commission_decision_date",
  "start_of_rolling_review_date",
  "start_of_evaluation_date",
  "opinion_adopted_date",
  "withdrawal_of_application_date",
  "marketing_authorisation_date",
  "refusal_of_marketing_authorisation_date",
  "withdrawal_expiry_revocation_lapse_of_marketing_authorisation_date",
  "suspension_of_marketing_authorisation_date",
  "revision_number",
  "first_published_date",
  "last_updated_date",
  "medicine_url"
)

offender_values <- function(values, max_shown = 10) {
  cli::cli_vec(unique(values), list("vec-trunc" = max_shown))
}

check_expected_columns <- function(data) {
  missing_columns <- setdiff(expected_ema_columns, names(data))
  unexpected_columns <- setdiff(names(data), expected_ema_columns)
  if (length(missing_columns) > 0 || length(unexpected_columns) > 0) {
    cli::cli_abort(c(
      "EMA data does not have the expected columns.",
      x = if (length(missing_columns) > 0) {
        "Missing: {.val {offender_values(missing_columns)}}"
      },
      x = if (length(unexpected_columns) > 0) {
        "Unexpected: {.val {offender_values(unexpected_columns)}}"
      }
    ))
  }
  invisible(data)
}

check_source_fields <- function(data, fields, source_name) {
  missing_fields <- setdiff(fields, names(data))
  if (length(missing_fields) > 0) {
    cli::cli_abort(c(
      "{source_name} is missing {length(missing_fields)} expected
      field{?s}; has its format changed?",
      x = "{.val {offender_values(missing_fields)}}"
    ))
  }
  invisible(data)
}

check_record_count <- function(data, meta) {
  if (!isTRUE(nrow(data) == meta$total_records)) {
    cli::cli_abort(
      "EMA meta reports {meta$total_records} records but the data has
      {nrow(data)} rows."
    )
  }
  invisible(data)
}

check_has_human_rows <- function(data) {
  if (!any(data$category == "Human", na.rm = TRUE)) {
    cli::cli_abort(c(
      "EMA data has no human medicines.",
      i = "Categories found: {.val {offender_values(data$category)}}"
    ))
  }
  invisible(data)
}

check_unique_product_numbers <- function(medicines) {
  product_numbers <- medicines$ema_product_number
  is_missing <- is.na(product_numbers) | product_numbers == ""
  duplicated_numbers <- product_numbers[
    duplicated(product_numbers) & !is_missing
  ]
  if (any(is_missing) || length(duplicated_numbers) > 0) {
    cli::cli_abort(c(
      "{.field ema_product_number} must be present and unique.",
      x = "{sum(is_missing)} row{?s} without a product number.",
      x = "{length(unique(duplicated_numbers))} duplicated product number{?s}
      {.val {offender_values(duplicated_numbers)}}"
    ))
  }
  invisible(medicines)
}

check_no_future_approval_dates <- function(medicines, today = Sys.Date()) {
  # One day of tolerance: EMA publishes on Amsterdam time.
  is_future <- medicines$marketing_authorisation_date > today + 1
  offenders <- medicines$ema_product_number[is_future %in% TRUE]
  if (length(offenders) > 0) {
    cli::cli_abort(c(
      "{length(offenders)} medicine{?s} ha{?s/ve} a marketing authorisation
      date after {today}.",
      x = "{.val {offender_values(offenders)}}"
    ))
  }
  invisible(medicines)
}

# Name fixed by the M1 spec.
# nolint next: object_length_linter.
check_single_medicine_type_flag <- function(medicines) {
  flag_count <- medicines$advanced_therapy + medicines$biosimilar +
    medicines$generic
  offenders <- medicines$ema_product_number[flag_count > 1]
  if (length(offenders) > 0) {
    cli::cli_abort(c(
      "{length(offenders)} medicine{?s} ha{?s/ve} more than one of
      {.field advanced_therapy}, {.field biosimilar} and {.field generic}.",
      x = "{.val {offender_values(offenders)}}"
    ))
  }
  invisible(medicines)
}

escape_cli_braces <- function(x) {
  x |>
    stringr::str_replace_all(stringr::fixed("{"), "{{") |>
    stringr::str_replace_all(stringr::fixed("}"), "}}")
}

check_tile_matches_series <- function(medicines, snapshot_date) {
  in_tile <- is_authorized_now(medicines)
  in_series <- is_counted_in_series(medicines, snapshot_date)
  if (sum(in_tile) != sum(in_series)) {
    is_offender <- in_tile != in_series
    offenders <- medicines[is_offender, ]
    descriptions <- paste0(
      offenders$ema_product_number, " ", offenders$name_of_medicine, ": ",
      offenders$medicine_status, "; authorized ",
      format(offenders$authorized_from), " to ",
      format(offenders$authorized_until), "; series_exclusion ",
      offenders$series_exclusion, "; in the ",
      dplyr::if_else(in_tile[is_offender], "tile", "series"), " only"
    )
    cli::cli_abort(c(
      "The \"Authorized now\" tile counts {sum(in_tile)} medicine{?s} but the
      authorized series counts {sum(in_series)} on {snapshot_date}.",
      stats::setNames(
        escape_cli_braces(descriptions),
        rep("x", length(descriptions))
      )
    ))
  }
  invisible(medicines)
}
