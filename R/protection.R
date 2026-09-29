# EU regulatory data protection ("8 + 2 + 1"), estimated from EMA dates only:
# counted from the first EU central authorisation of the same active
# substances. Earlier national authorisations, pre-2005 rules, paediatric
# rewards and derogations are ignored; the possible extra year is shown as a
# range. EMA's data flags only generics and biosimilars as copies; hybrids
# are copies too, so the copies checked by hand (curated_copy_medicines():
# hybrids, and a generic and a biosimilar EMA does not flag) follow their
# reference medicine, or, when it was authorised nationally, have no
# reference found. Informed-consent copies and copies not on that list count
# as medicines of their own, so they may show protection they do not have.
# A paediatric-use marketing authorisation (curated_puma_medicines()) has
# protection of its own, so it counts from its own approval and is no copy.
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
# of the equivalent substances, whoever holds it. A paediatric-use marketing
# authorisation counts from its own approval. A curated copy follows the
# reference medicine its EPAR names, from the date that medicine counts
# from, whatever its substances (Riulvy, tegomil fumarate: Tecfidera).
match_references <- function(dated, originators, copies) {
  by_spelling <- dated |>
    dplyr::filter(.data$is_follower, !.data$is_curated_copy) |>
    dplyr::select("ema_product_number", "set_key") |>
    dplyr::inner_join(
      first_products(originators, "set_key"),
      by = "set_key",
      relationship = "many-to-one"
    )
  by_substance <- dated |>
    dplyr::filter(!.data$is_curated_copy, !.data$is_puma) |>
    dplyr::anti_join(by_spelling, by = "ema_product_number") |>
    dplyr::select("ema_product_number", "equivalent_set_key") |>
    dplyr::inner_join(
      first_products(originators, "equivalent_set_key"),
      by = "equivalent_set_key",
      relationship = "many-to-one"
    )
  own_approvals <- dated |>
    dplyr::filter(.data$is_puma) |>
    dplyr::transmute(
      .data$ema_product_number,
      reference_product_number = .data$ema_product_number,
      reference_name = .data$name_of_medicine,
      counted_from = .data$marketing_authorisation_date,
      reference_group_key = .data$group_key
    )
  references <- dplyr::bind_rows(by_spelling, by_substance, own_approvals)
  by_curated <- copies |>
    dplyr::filter(!is.na(.data$reference_product_number)) |>
    dplyr::select("ema_product_number", "reference_product_number") |>
    dplyr::inner_join(
      dplyr::select(
        references,
        reference_product_number = "ema_product_number",
        "counted_from"
      ),
      by = "reference_product_number",
      relationship = "many-to-one"
    ) |>
    dplyr::inner_join(
      dplyr::select(
        dated,
        reference_product_number = "ema_product_number",
        reference_name = "name_of_medicine",
        reference_group_key = "group_key"
      ),
      by = "reference_product_number",
      relationship = "many-to-one"
    )
  dplyr::bind_rows(references, by_curated) |>
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

prepare_dated_medicines <- function(medicines,
                                    set_keys,
                                    medicine_groups,
                                    copies,
                                    pumas) {
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
      is_curated_copy = .data$ema_product_number %in%
        copies$ema_product_number,
      is_puma = .data$ema_product_number %in% pumas$ema_product_number,
      is_follower = (.data$generic | .data$biosimilar | .data$is_curated_copy) &
        !.data$is_puma,
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
      data_exclusivity_end_max = dplyr::if_else(
        .data$other_company,
        add_months(.data$own_counted_from, 12L * data_exclusivity_years),
        as.Date(NA)
      ),
      basis = dplyr::case_when(
        .data$is_puma ~ "paediatric_use",
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
                                   medicine_groups,
                                   copies,
                                   pumas) {
  dated <- prepare_dated_medicines(
    medicines,
    set_keys,
    medicine_groups,
    copies,
    pumas
  )
  originators <- dplyr::filter(dated, !.data$is_follower)
  dated |>
    dplyr::left_join(
      match_references(dated, originators, copies),
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
      # Which source says the medicine is a copy.
      copy_source = dplyr::case_when(
        .data$is_curated_copy ~ "curated",
        .data$is_follower ~ "ema_flag",
        .default = NA_character_
      ),
      source = "estimate_from_ema_dates"
    ) |>
    dplyr::select(
      "ema_product_number",
      "basis",
      "copy_source",
      "reference_product_number",
      "reference_name",
      "counted_from",
      "own_reference_product_number",
      "own_counted_from",
      "data_exclusivity_end",
      "data_exclusivity_end_max",
      "market_protection_end_min",
      "market_protection_end_max",
      "status",
      "source"
    ) |>
    dplyr::arrange(.data$ema_product_number)
}

is_product_number <- function(values) {
  grepl("^EMEA/H/C/\\d{6}$", values)
}

copy_types <- c("hybrid", "generic", "biosimilar")

# The quote must say what the table says the medicine is.
quote_names_copy_type <- function(copies) {
  purrr::map2_lgl(
    copies$copy_type,
    copies$evidence_quote,
    function(copy_type, quote) {
      copy_type %in% copy_types &&
        grepl(copy_type, quote, ignore.case = TRUE)
    }
  )
}

# Product numbers, a copy type its EPAR quote names (has_evidence()), a
# reference name, one row per medicine, and a reference that is not itself a
# curated copy.
check_curated_copies <- function(copies) {
  references <- copies$reference_product_number
  malformed <- !is_product_number(copies$ema_product_number) |
    !(is.na(references) | is_product_number(references)) |
    (references == copies$ema_product_number) %in% TRUE |
    !grepl("[[:alnum:]]", copies$reference_name) |
    !has_evidence(copies) |
    !quote_names_copy_type(copies)
  if (any(malformed)) {
    cli::cli_abort(c(
      "Curated copies need EMA product numbers, a copy type (hybrid,
      generic or biosimilar), another medicine as reference with its name,
      an https evidence URL, a quote of at most 20 words naming the copy
      type and a checked date.",
      x = "{.val {offender_values(copies$ema_product_number[malformed])}}"
    ))
  }
  repeated <- duplicated(copies$ema_product_number)
  if (any(repeated)) {
    cli::cli_abort(c(
      "Curated copies list a medicine more than once.",
      x = "{.val {offender_values(copies$ema_product_number[repeated])}}"
    ))
  }
  chained <- references %in% copies$ema_product_number
  if (any(chained)) {
    cli::cli_abort(c(
      "Curated copies whose reference is itself a curated copy.",
      x = "{.val {offender_values(copies$ema_product_number[chained])}}"
    ))
  }
  copies
}

# The curated copies in the EMA data whose reference, if central, has an
# approval date (published as ema_curated_copies.json); others are only
# listed.
select_curated_copies <- function(copies, medicines) {
  dated <- medicines$ema_product_number[
    !is.na(medicines$marketing_authorisation_date)
  ]
  in_data <- copies$ema_product_number %in% medicines$ema_product_number &
    (is.na(copies$reference_product_number) |
       copies$reference_product_number %in% dated)
  if (!all(in_data)) {
    cli::cli_warn(c(
      "Curated copies or their references not in the EMA data (left out):",
      x = "{.val {offender_values(copies$ema_product_number[!in_data])}}"
    ))
  }
  copies[in_data, ] |>
    dplyr::mutate(source = "curated") |>
    dplyr::arrange(.data$ema_product_number)
}

# The quote must say the application was for a paediatric-use marketing
# authorisation.
quote_names_puma <- function(quotes) {
  grepl(
    "paediatric[- ]use\\s+marketing\\s+authorisation",
    quotes,
    ignore.case = TRUE
  )
}

# Product numbers, evidence (has_evidence()) whose quote names a
# paediatric-use marketing authorisation, one row per medicine, and none a
# curated copy: a PUMA has protection of its own.
check_curated_pumas <- function(pumas, copies) {
  malformed <- !is_product_number(pumas$ema_product_number) |
    !has_evidence(pumas) |
    !quote_names_puma(pumas$evidence_quote)
  if (any(malformed)) {
    cli::cli_abort(c(
      "Curated paediatric-use marketing authorisations need an EMA product
      number, an https evidence URL, a quote of at most 20 words naming a
      paediatric-use marketing authorisation and a checked date.",
      x = "{.val {offender_values(pumas$ema_product_number[malformed])}}"
    ))
  }
  repeated <- duplicated(pumas$ema_product_number)
  if (any(repeated)) {
    cli::cli_abort(c(
      "Curated paediatric-use marketing authorisations list a medicine more
      than once.",
      x = "{.val {offender_values(pumas$ema_product_number[repeated])}}"
    ))
  }
  copied <- pumas$ema_product_number %in% copies$ema_product_number
  if (any(copied)) {
    cli::cli_abort(c(
      "Paediatric-use marketing authorisations that are also a curated copy
      (a PUMA has protection of its own).",
      x = "{.val {offender_values(pumas$ema_product_number[copied])}}"
    ))
  }
  pumas
}

# The curated PUMAs in the EMA data (published as ema_curated_pumas.json).
select_curated_pumas <- function(pumas, medicines) {
  in_data <- pumas$ema_product_number %in% medicines$ema_product_number
  if (!all(in_data)) {
    cli::cli_warn(c(
      "Curated paediatric-use marketing authorisations not in the EMA data
      (left out):",
      x = "{.val {offender_values(pumas$ema_product_number[!in_data])}}"
    ))
  }
  pumas[in_data, ] |>
    dplyr::mutate(source = "curated") |>
    dplyr::arrange(.data$ema_product_number)
}

# Built after the company tables, whose groups it reads.
build_protection_tables <- function(tables,
                                    snapshot_date,
                                    equivalents =
                                      curated_substance_equivalents(),
                                    copies = curated_copy_medicines(),
                                    pumas = curated_puma_medicines()) {
  equivalents <- build_substance_equivalents(
    equivalents,
    tables$ema_medicine_substances
  )
  set_keys <- protection_set_keys(tables$ema_medicine_substances, equivalents)
  copies <- check_curated_copies(copies)
  pumas <- select_curated_pumas(
    check_curated_pumas(pumas, copies),
    tables$ema_medicines
  )
  copies <- select_curated_copies(copies, tables$ema_medicines)
  list(
    ema_medicine_protection = build_protection_table(
      tables$ema_medicines,
      snapshot_date,
      set_keys,
      tables$ema_medicine_companies,
      copies,
      pumas
    ),
    ema_substance_equivalents = equivalents,
    ema_curated_copies = copies,
    ema_curated_pumas = pumas
  )
}

# meta.json entry for the curated copies (none when no row is in the data).
curated_copies_source_entry <- function(copies) {
  if (nrow(copies) == 0) {
    return(NULL)
  }
  checked <- format(max(copies$checked_date))
  list(
    name = paste(
      "Hybrid, generic and biosimilar medicines EMA does not flag",
      "(curated by approval-atlas from EMA EPAR pages)"
    ),
    url = paste0(
      "https://github.com/vrognas/approval-atlas/blob/main/",
      "R/curated-copies.R"
    ),
    version = paste("Checked", checked),
    retrieved = checked,
    licence = "© European Medicines Agency; reuse with acknowledgement",
    attribution = paste(
      "Copy type and reference medicine checked by hand by approval-atlas",
      "against EMA EPAR pages, quoted verbatim;",
      ema_attribution
    )
  )
}

# meta.json entry for the curated PUMAs (none when no row is in the data).
curated_pumas_source_entry <- function(pumas) {
  if (nrow(pumas) == 0) {
    return(NULL)
  }
  checked <- format(max(pumas$checked_date))
  list(
    name = paste(
      "EMA paediatric-use marketing authorisations (PUMAs; curated by",
      "approval-atlas from EMA public assessment reports)"
    ),
    url = paste0(
      "https://github.com/vrognas/approval-atlas/blob/main/",
      "R/curated-copies.R"
    ),
    version = paste("Checked", checked),
    retrieved = checked,
    licence = "© European Medicines Agency; reuse with acknowledgement",
    attribution = paste(
      "Paediatric-use marketing authorisations checked by hand by",
      "approval-atlas against EMA public assessment reports, quoted verbatim;",
      ema_attribution
    )
  )
}
