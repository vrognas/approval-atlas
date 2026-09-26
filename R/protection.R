# EU regulatory data protection ("8 + 2 + 1"), estimated from EMA dates only:
# counted from the first EU authorisation of the same active substances.
# Earlier national authorisations, pre-2005 rules, paediatric rewards and
# derogations are ignored; the possible extra year is shown as a range.
data_exclusivity_years <- 8L
market_protection_years_min <- 10L
market_protection_years_max <- 11L

# A day missing in the target month rolls into the next one
# (29 Feb 2016 + 10 years = 1 Mar 2026).
add_months <- function(dates, months) {
  parts <- as.POSIXlt(dates)
  total_months <- (parts$year + 1900L) * 12L + parts$mon + months
  first_of_month <- as.Date(
    sprintf("%04d-%02d-01", total_months %/% 12L, total_months %% 12L + 1L),
    format = "%Y-%m-%d"
  )
  first_of_month + (parts$mday - 1L)
}

protection_status <- function(end_min, end_max, snapshot_date) {
  dplyr::case_when(
    end_min > snapshot_date ~ "protected",
    end_max < snapshot_date ~ "ended",
    .default = "unclear"
  )
}

build_protection_table <- function(medicines, snapshot_date) {
  dated <- medicines |>
    dplyr::filter(!is.na(.data$marketing_authorisation_date)) |>
    dplyr::mutate(
      # A medicine without substances forms a set of its own.
      set_key = dplyr::coalesce(
        .data$substance_set_key,
        .data$ema_product_number
      ),
      is_follower = .data$generic | .data$biosimilar
    )
  first_products <- dated |>
    dplyr::filter(!.data$is_follower) |>
    dplyr::arrange(
      .data$set_key,
      .data$marketing_authorisation_date,
      .data$ema_product_number
    ) |>
    dplyr::distinct(.data$set_key, .keep_all = TRUE) |>
    dplyr::transmute(
      .data$set_key,
      reference_product_number = .data$ema_product_number,
      reference_name = .data$name_of_medicine,
      counted_from = .data$marketing_authorisation_date
    )
  dated |>
    dplyr::left_join(
      first_products,
      by = "set_key",
      relationship = "many-to-one"
    ) |>
    dplyr::mutate(
      basis = dplyr::case_when(
        !.data$is_follower ~ "own",
        !is.na(.data$reference_product_number) ~ "follows_reference",
        .default = "reference_not_found"
      ),
      data_exclusivity_end = add_months(
        .data$counted_from,
        12L * data_exclusivity_years
      ),
      market_protection_end_min = add_months(
        .data$counted_from,
        12L * market_protection_years_min
      ),
      market_protection_end_max = add_months(
        .data$counted_from,
        12L * market_protection_years_max
      ),
      status = protection_status(
        .data$market_protection_end_min,
        .data$market_protection_end_max,
        snapshot_date
      ),
      source = "estimate_from_ema_dates"
    ) |>
    dplyr::select(
      "ema_product_number",
      "basis",
      "reference_product_number",
      "reference_name",
      "counted_from",
      "data_exclusivity_end",
      "market_protection_end_min",
      "market_protection_end_max",
      "status",
      "source"
    ) |>
    dplyr::arrange(.data$ema_product_number)
}
