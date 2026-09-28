# Only "Active" is a marketing authorisation in force. The register is BETA,
# so a status missing here stops the build instead of being guessed.
register_status_is_authorised <- c(
  "Active" = TRUE,
  "Annulled" = FALSE,
  "Expired / Sunset clause" = FALSE,
  "Not renewed" = FALSE,
  "Refused" = FALSE,
  "Revoked" = FALSE,
  "Suspended" = FALSE,
  "Withdrawn" = FALSE
)

is_register_authorised <- function(register_status) {
  unknown <- setdiff(register_status, names(register_status_is_authorised))
  if (length(unknown) > 0) {
    abort_register_format("unknown product statuses", unknown)
  }
  unname(register_status_is_authorised[register_status])
}

# EMA renames keep the old name in brackets; the register has only the
# current one. No transliteration: iconv's output differs by platform.
normalise_medicine_name <- function(name) {
  name |>
    stringr::str_remove(
      stringr::regex("\\s*\\(previously.*$", ignore_case = TRUE)
    ) |>
    stringr::str_remove_all("<[^>]+>") |>
    stringr::str_to_lower() |>
    stringr::str_remove_all("[^\\p{L}\\p{N}]") |>
    dplyr::na_if("")
}

register_candidates <- function(medicine_keys, register_products, key) {
  dplyr::inner_join(
    dplyr::select(medicine_keys, "ema_product_number", dplyr::all_of(key)),
    dplyr::select(register_products, "uri", dplyr::all_of(key)),
    by = key,
    na_matches = "never",
    relationship = "many-to-many"
  ) |>
    dplyr::select("ema_product_number", "uri")
}

# The centrally authorised register product of each EMA product, found by
# EMA page or name with MA dates at most a day apart; a product with several
# candidates has none.
link_register_products <- function(medicines, register) {
  register_products <- register$products |>
    dplyr::filter(.data$category == "Centrally authorised") |>
    dplyr::mutate(
      link_key = normalise_ema_link(.data$ema_link),
      name_key = normalise_medicine_name(.data$name)
    )
  medicine_keys <- medicines |>
    dplyr::transmute(
      .data$ema_product_number,
      .data$marketing_authorisation_date,
      link_key = normalise_ema_link(.data$medicine_url),
      name_key = normalise_medicine_name(.data$name_of_medicine)
    )
  by_link <- register_candidates(medicine_keys, register_products, "link_key")
  by_name <- register_candidates(medicine_keys, register_products, "name_key")

  dplyr::full_join(
    dplyr::mutate(by_link, matched_by_link = TRUE),
    dplyr::mutate(by_name, matched_by_name = TRUE),
    by = c("ema_product_number", "uri"),
    relationship = "one-to-one"
  ) |>
    dplyr::inner_join(
      dplyr::select(
        medicine_keys,
        "ema_product_number",
        "marketing_authorisation_date"
      ),
      by = "ema_product_number",
      relationship = "many-to-one"
    ) |>
    dplyr::inner_join(
      dplyr::select(register_products, "uri", "authorisation_date"),
      by = "uri",
      relationship = "many-to-one"
    ) |>
    dplyr::filter(is_same_authorisation_date(
      .data$authorisation_date,
      .data$marketing_authorisation_date
    )) |>
    dplyr::filter(dplyr::n() == 1, .by = "ema_product_number") |>
    # A withdrawn application can share the authorised medicine's name and
    # date; the register's own EMA link decides.
    dplyr::filter(
      dplyr::n() == 1 | .data$matched_by_link %in% TRUE,
      .by = "uri"
    ) |>
    dplyr::select(
      "ema_product_number",
      "uri",
      "matched_by_link",
      "matched_by_name"
    )
}

build_register_status_table <- function(medicines, register) {
  register_products <- register$products |>
    dplyr::filter(.data$category == "Centrally authorised") |>
    dplyr::mutate(register_authorised = is_register_authorised(.data$status))
  link_register_products(medicines, register) |>
    dplyr::inner_join(
      dplyr::select(medicines, "ema_product_number", "medicine_status"),
      by = "ema_product_number",
      relationship = "one-to-one"
    ) |>
    dplyr::inner_join(
      register_products,
      by = "uri",
      relationship = "many-to-one"
    ) |>
    dplyr::transmute(
      .data$ema_product_number,
      .data$eu_number,
      register_status = .data$status,
      register_last_decision_date = .data$last_decision_date,
      register_url = stringr::str_replace(.data$uri, "^http:", "https:"),
      match_method = dplyr::case_when(
        .data$matched_by_link %in% TRUE & .data$matched_by_name %in% TRUE ~
          "link_and_name",
        .data$matched_by_link %in% TRUE ~ "link",
        .default = "name"
      ),
      agrees_with_ema = (.data$medicine_status == "Authorised") ==
        .data$register_authorised,
      source = "union_register"
    ) |>
    dplyr::arrange(.data$ema_product_number)
}

report_register_status <- function(register_status, medicines) {
  authorised <- medicines[medicines$medicine_status == "Authorised", ]
  is_linked <- authorised$ema_product_number %in%
    register_status$ema_product_number
  cli::cli_alert_info(sprintf(
    "Union Register status: %d EMA products linked (%d of %d Authorised).",
    nrow(register_status),
    sum(is_linked),
    nrow(authorised)
  ))
  not_active <- register_status |>
    dplyr::filter(!.data$agrees_with_ema) |>
    dplyr::inner_join(
      dplyr::select(authorised, "ema_product_number", "name_of_medicine"),
      by = "ema_product_number",
      relationship = "one-to-one"
    ) |>
    dplyr::mutate(
      label = paste0(.data$name_of_medicine, " (", .data$register_status, ")")
    )
  if (nrow(not_active) > 0) {
    cli::cli_alert_warning(
      "Union Register: {nrow(not_active)} Authorised medicine{?s} not active:
      {.val {offender_values(not_active$label, max_shown = nrow(not_active))}}"
    )
  }
  unmatched <- authorised$name_of_medicine[!is_linked]
  if (length(unmatched) > 0) {
    cli::cli_alert_warning(
      "Union Register: {length(unmatched)} Authorised medicine{?s} not linked:
      {.val {offender_values(unmatched, max_shown = 20)}}"
    )
  }
  invisible(register_status)
}
