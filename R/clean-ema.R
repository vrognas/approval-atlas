ema_flag_columns <- c(
  "patient_safety",
  "accelerated_assessment",
  "additional_monitoring",
  "advanced_therapy",
  "biosimilar",
  "conditional_approval",
  "exceptional_circumstances",
  "generic",
  "orphan_medicine",
  "prime_priority_medicine"
)

ema_date_columns <- c(
  "european_commission_decision_date",
  "start_of_rolling_review_date",
  "start_of_evaluation_date",
  "opinion_adopted_date",
  "withdrawal_of_application_date",
  "marketing_authorisation_date",
  "refusal_of_marketing_authorisation_date",
  "withdrawal_expiry_revocation_lapse_of_marketing_authorisation_date",
  "suspension_of_marketing_authorisation_date",
  "first_published_date",
  "last_updated_date"
)

ema_veterinary_columns <- c(
  "species_veterinary",
  "atcvet_code_veterinary",
  "pharmacotherapeutic_group_veterinary"
)

known_html_entities <- c("&nbsp;", "&lt;", "&gt;")

parse_ema_date <- function(x) {
  parsed <- as.Date(x, format = "%d/%m/%Y")
  is_present <- !is.na(x) & x != ""
  # Round-tripping rejects partial matches such as "1/2/2020" or trailing text.
  is_invalid <- is_present &
    (is.na(parsed) | format(parsed, "%d/%m/%Y") != x)
  if (any(is_invalid)) {
    cli::cli_abort(c(
      "{sum(is_invalid)} invalid EMA date{?s} (expected dd/mm/yyyy).",
      x = "{.val {offender_values(x[is_invalid])}}"
    ))
  }
  parsed
}

yes_no_to_logical <- function(x) {
  is_invalid <- is.na(x) | !x %in% c("Yes", "No")
  if (any(is_invalid)) {
    cli::cli_abort(c(
      "{sum(is_invalid)} invalid Yes/No value{?s}.",
      x = "{.val {offender_values(x[is_invalid])}}"
    ))
  }
  x == "Yes"
}

decode_html_entities <- function(x) {
  found_entities <- unlist(
    stringr::str_extract_all(x[!is.na(x)], "&#?[A-Za-z0-9]+;")
  )
  unknown_entities <- setdiff(found_entities, known_html_entities)
  if (length(unknown_entities) > 0) {
    cli::cli_abort(c(
      "{length(unknown_entities)} unknown HTML entit{?y/ies} in EMA text.",
      x = "{.val {offender_values(unknown_entities)}}"
    ))
  }
  # EMA truncates some "&nbsp;" to "&nbsp", so the semicolon is optional.
  x |>
    stringr::str_replace_all("&nbsp;?", " ") |>
    stringr::str_replace_all("&lt;", "<") |>
    stringr::str_replace_all("&gt;", ">")
}

clean_text <- function(x) {
  # str_squish() also normalises U+00A0, unlike base trimws().
  x |>
    decode_html_entities() |>
    stringr::str_squish() |>
    dplyr::na_if("")
}

parse_revision_number <- function(x) {
  is_present <- !is.na(x) & x != ""
  is_invalid <- is_present & !stringr::str_detect(x, "^[0-9]+$")
  if (any(is_invalid)) {
    cli::cli_abort(c(
      "{sum(is_invalid)} invalid revision number{?s}.",
      x = "{.val {offender_values(x[is_invalid])}}"
    ))
  }
  as.integer(dplyr::if_else(is_present, x, NA_character_))
}

clean_ema_medicines <- function(data) {
  data |>
    dplyr::filter(.data$category == "Human") |>
    dplyr::select(-dplyr::all_of(c("category", ema_veterinary_columns))) |>
    dplyr::mutate(
      dplyr::across(dplyr::all_of(ema_flag_columns), yes_no_to_logical),
      dplyr::across(dplyr::all_of(ema_date_columns), parse_ema_date),
      revision_number = parse_revision_number(.data$revision_number)
    ) |>
    dplyr::mutate(dplyr::across(dplyr::where(is.character), clean_text))
}
