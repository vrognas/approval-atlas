# EU regulatory data protection ("8 + 2 + 1"), estimated from EMA dates only:
# counted from the first EU central authorisation of the same active
# substances. Earlier national authorisations, pre-2005 rules, paediatric
# rewards and derogations are ignored; the possible extra year is shown as a
# range. EMA's data flags only generics and biosimilars as copies: hybrids,
# informed-consent copies and biosimilars EMA does not flag count as medicines
# of their own, so hybrids of nationally authorised medicines may show
# protection they do not have (Colchicine Agepha Pharma, Cuprior).
data_exclusivity_years <- 8L
market_protection_years_min <- 10L
market_protection_years_max <- 11L

# Brands of one application are authorised days apart (Humira a week after
# Trudexa, Plavix a day after Iscover): within this window after the first
# approval of a substance set, among the products of the first one's company
# group, an authorised product is the reference, then the first application
# (the lower product number). Protection runs from the first authorisation
# (global marketing authorisation), so it is counted from the window's start,
# not from the reference's own date.
reference_window_days <- 30L

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

# Per product: its substance set as EMA spells it, and with every key
# replaced by one key of its equivalents.
protection_set_keys <- function(substances, equivalents) {
  spelt <- build_substance_set_keys(substances)
  equivalent <- substances |>
    dplyr::mutate(
      substance_key = equivalent_substance_keys(
        .data$substance_key,
        equivalents
      )
    ) |>
    build_substance_set_keys()
  dplyr::inner_join(
    dplyr::rename(spelt, set_key = "substance_set_key"),
    dplyr::rename(equivalent, equivalent_set_key = "substance_set_key"),
    by = "ema_product_number",
    relationship = "one-to-one"
  )
}

# The reference product of each group of `by`: see reference_window_days.
first_products <- function(originators, by) {
  originators |>
    dplyr::arrange(
      .data$marketing_authorisation_date,
      !.data$is_authorised,
      .data$ema_product_number
    ) |>
    # Rows are in date order: the first is the first approval.
    dplyr::mutate(
      window_start = dplyr::first(.data$marketing_authorisation_date),
      window_group_key = dplyr::first(.data$group_key),
      .by = dplyr::all_of(by)
    ) |>
    dplyr::filter(
      .data$marketing_authorisation_date <=
        .data$window_start + reference_window_days,
      # Unknown groups count as one.
      .data$group_key == .data$window_group_key |
        is.na(.data$group_key) & is.na(.data$window_group_key)
    ) |>
    dplyr::arrange(!.data$is_authorised, .data$ema_product_number) |>
    dplyr::distinct(dplyr::across(dplyr::all_of(by)), .keep_all = TRUE) |>
    dplyr::transmute(
      dplyr::across(dplyr::all_of(by)),
      reference_product_number = .data$ema_product_number,
      reference_name = .data$name_of_medicine,
      counted_from = .data$window_start,
      reference_group_key = .data$group_key
    )
}

# A generic or biosimilar follows the first product of its substances as
# spelt, else of their equivalents (Dasatinib Accord Healthcare: Sprycel,
# "dasatinib (anhydrous)"); any other medicine counts from the first product
# of the equivalent substances, whoever holds it.
match_references <- function(dated, originators) {
  by_spelling <- dated |>
    dplyr::filter(.data$is_follower) |>
    dplyr::select("ema_product_number", "set_key") |>
    dplyr::inner_join(
      first_products(originators, "set_key"),
      by = "set_key",
      relationship = "many-to-one"
    )
  by_substance <- dated |>
    dplyr::anti_join(by_spelling, by = "ema_product_number") |>
    dplyr::select("ema_product_number", "equivalent_set_key") |>
    dplyr::inner_join(
      first_products(originators, "equivalent_set_key"),
      by = "equivalent_set_key",
      relationship = "many-to-one"
    )
  dplyr::bind_rows(by_spelling, by_substance) |>
    dplyr::select(
      "ema_product_number",
      "reference_product_number",
      "reference_name",
      "counted_from",
      "reference_group_key"
    )
}

# Each company group's first product of each equivalent substance set.
own_company_firsts <- function(originators) {
  originators |>
    dplyr::filter(!is.na(.data$group_key)) |>
    first_products(c("equivalent_set_key", "group_key")) |>
    dplyr::select(
      "equivalent_set_key",
      "group_key",
      own_reference_product_number = "reference_product_number",
      own_counted_from = "counted_from"
    )
}

prepare_dated_medicines <- function(medicines, set_keys, medicine_groups) {
  medicines |>
    dplyr::filter(!is.na(.data$marketing_authorisation_date)) |>
    dplyr::select(
      "ema_product_number",
      "name_of_medicine",
      "medicine_status",
      "generic",
      "biosimilar",
      "marketing_authorisation_date"
    ) |>
    dplyr::left_join(
      set_keys,
      by = "ema_product_number",
      relationship = "one-to-one"
    ) |>
    dplyr::left_join(
      dplyr::select(medicine_groups, "ema_product_number", "group_key"),
      by = "ema_product_number",
      relationship = "one-to-one"
    ) |>
    dplyr::mutate(
      # A medicine without substances forms a set of its own.
      set_key = dplyr::coalesce(.data$set_key, .data$ema_product_number),
      equivalent_set_key = dplyr::coalesce(
        .data$equivalent_set_key,
        .data$set_key
      ),
      is_follower = .data$generic | .data$biosimilar,
      is_authorised = .data$medicine_status %in% "Authorised"
    )
}

add_estimate_dates <- function(data) {
  dplyr::mutate(
    data,
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
    )
  )
}

# Counted from another company group's first product, an estimate can be
# wrong: an independent application (MenQuadfi after Menveo) has its own
# protection, a licensee's shares it. Where the company's own first product
# came later, the market protection range runs from the earlier estimate's
# minimum to the later one's maximum, so the status is unclear where the two
# estimates' statuses differ (Qdenga's counted from Dengvaxia's) and kept
# where they agree (Spikevax: protected either way). When both have ended,
# it stays an ordinary estimate.
apply_other_company_rule <- function(data, snapshot_date) {
  data |>
    dplyr::mutate(
      own_market_protection_end_max = add_months(
        .data$own_counted_from,
        12L * market_protection_years_max
      ),
      other_company = !.data$is_follower &
        (.data$reference_group_key != .data$group_key) %in% TRUE &
        (.data$own_counted_from > .data$counted_from) %in% TRUE &
        .data$own_market_protection_end_max >= snapshot_date,
      market_protection_end_max = dplyr::if_else(
        .data$other_company,
        .data$own_market_protection_end_max,
        .data$market_protection_end_max
      ),
      basis = dplyr::case_when(
        .data$other_company ~ "other_company_reference",
        !.data$is_follower ~ "own",
        !is.na(.data$reference_product_number) ~ "follows_reference",
        .default = "reference_not_found"
      ),
      own_reference_product_number = dplyr::if_else(
        .data$other_company,
        .data$own_reference_product_number,
        NA_character_
      ),
      own_counted_from = dplyr::if_else(
        .data$other_company,
        .data$own_counted_from,
        as.Date(NA)
      )
    )
}

build_protection_table <- function(medicines,
                                   snapshot_date,
                                   set_keys,
                                   medicine_groups) {
  dated <- prepare_dated_medicines(medicines, set_keys, medicine_groups)
  originators <- dplyr::filter(dated, !.data$is_follower)
  dated |>
    dplyr::left_join(
      match_references(dated, originators),
      by = "ema_product_number",
      relationship = "one-to-one"
    ) |>
    dplyr::left_join(
      own_company_firsts(originators),
      by = c("equivalent_set_key", "group_key"),
      relationship = "many-to-one"
    ) |>
    add_estimate_dates() |>
    apply_other_company_rule(snapshot_date) |>
    dplyr::mutate(
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
      "own_reference_product_number",
      "own_counted_from",
      "data_exclusivity_end",
      "market_protection_end_min",
      "market_protection_end_max",
      "status",
      "source"
    ) |>
    dplyr::arrange(.data$ema_product_number)
}

# Built after the company tables, whose groups it reads.
build_protection_tables <- function(tables,
                                    snapshot_date,
                                    equivalents =
                                      curated_substance_equivalents()) {
  equivalents <- build_substance_equivalents(
    equivalents,
    tables$ema_medicine_substances
  )
  set_keys <- protection_set_keys(tables$ema_medicine_substances, equivalents)
  list(
    ema_medicine_protection = build_protection_table(
      tables$ema_medicines,
      snapshot_date,
      set_keys,
      tables$ema_medicine_companies
    ),
    ema_substance_equivalents = equivalents
  )
}
