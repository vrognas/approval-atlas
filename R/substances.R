# Three combinations use " / " instead of ";", but Siiltibcy's single name
# "(rdESAT-6 / rCFP-10)" does too, so a slash inside parentheses never splits.
substance_delimiter <- stringr::regex(";| / (?![^(]*\\))")

# EMA sometimes repeats the medicine's name in the INN field (Vysribli, a
# denosumab biosimilar); its name may add "(previously …)".
inn_names_medicine <- function(inn, name) {
  name <- stringr::str_remove_all(name, "\\([^)]*\\)")
  fold <- function(text) stringr::str_squish(stringr::str_to_lower(text))
  (fold(inn) == fold(name)) %in% TRUE
}

# From the INN field, or the active substance field where the INN field names
# the medicine, so every table keyed by substance agrees.
build_substances_table <- function(clean_medicines) {
  clean_medicines |>
    dplyr::transmute(
      .data$ema_product_number,
      substance = dplyr::if_else(
        inn_names_medicine(
          .data$international_non_proprietary_name_common_name,
          .data$name_of_medicine
        ),
        .data$active_substance,
        .data$international_non_proprietary_name_common_name
      )
    ) |>
    tidyr::separate_longer_delim("substance", delim = substance_delimiter) |>
    dplyr::mutate(substance = stringr::str_squish(.data$substance)) |>
    dplyr::filter(!is.na(.data$substance), .data$substance != "") |>
    dplyr::mutate(substance_key = stringr::str_to_lower(.data$substance)) |>
    dplyr::distinct() |>
    dplyr::arrange(.data$ema_product_number, .data$substance)
}

build_substance_set_keys <- function(substances) {
  substances |>
    dplyr::summarise(
      substance_set_key = paste(
        sort(unique(.data$substance_key), method = "radix"),
        collapse = "|"
      ),
      .by = "ema_product_number"
    ) |>
    dplyr::arrange(.data$ema_product_number)
}

add_substance_set_keys <- function(medicines, substances) {
  dplyr::left_join(
    medicines,
    build_substance_set_keys(substances),
    by = "ema_product_number",
    relationship = "many-to-one"
  )
}

# As build_substances_table() writes them: lower-case, squished.
is_substance_key <- function(keys) {
  (keys == stringr::str_squish(stringr::str_to_lower(keys))) %in% TRUE
}

pair_labels <- function(equivalents) {
  paste(equivalents$substance_key, "=", equivalents$equivalent_key)
}

check_substance_equivalents <- function(equivalents) {
  malformed <- !is_substance_key(equivalents$substance_key) |
    !is_substance_key(equivalents$equivalent_key) |
    equivalents$substance_key == equivalents$equivalent_key |
    !startsWith(equivalents$evidence_url, "https://") %in% TRUE |
    is.na(equivalents$checked_date)
  if (any(malformed)) {
    cli::cli_abort(c(
      "Curated substance equivalents need two lower-case substance keys, an
      https evidence URL and a checked date.",
      x = "{.val {offender_values(pair_labels(equivalents)[malformed])}}"
    ))
  }
  pair_ids <- paste(
    pmin(equivalents$substance_key, equivalents$equivalent_key),
    pmax(equivalents$substance_key, equivalents$equivalent_key)
  )
  repeated <- duplicated(pair_ids)
  if (any(repeated)) {
    cli::cli_abort(c(
      "Curated substance equivalents list a pair more than once.",
      x = "{.val {offender_values(pair_labels(equivalents)[repeated])}}"
    ))
  }
  equivalents
}

# Both directions of each curated pair whose keys are both in the data; a
# pair EMA no longer spells so (a corrected INN field) is only listed.
build_substance_equivalents <- function(equivalents, substances) {
  check_substance_equivalents(equivalents)
  in_data <- equivalents$substance_key %in% substances$substance_key &
    equivalents$equivalent_key %in% substances$substance_key
  if (!all(in_data)) {
    cli::cli_warn(c(
      "Curated substance equivalents not in the EMA data (left out):",
      x = "{.val {offender_values(pair_labels(equivalents)[!in_data])}}"
    ))
  }
  kept <- equivalents[in_data, ]
  dplyr::bind_rows(
    kept,
    dplyr::rename(
      kept,
      substance_key = "equivalent_key",
      equivalent_key = "substance_key"
    )
  ) |>
    dplyr::transmute(
      .data$substance_key,
      .data$equivalent_key,
      basis = "curated",
      .data$evidence_url,
      .data$checked_date,
      source = "curated"
    ) |>
    dplyr::arrange(.data$substance_key, .data$equivalent_key)
}

# The same active substance is transitive: every key of a group of
# equivalents becomes the group's first key (in C-locale order).
equivalent_substance_keys <- function(keys, equivalents) {
  group_keys <- sort(
    unique(c(keys, equivalents$substance_key, equivalents$equivalent_key)),
    method = "radix"
  )
  group <- seq_along(group_keys)
  from <- match(equivalents$substance_key, group_keys)
  to <- match(equivalents$equivalent_key, group_keys)
  for (pair in seq_along(from)) {
    joined <- range(group[c(from[pair], to[pair])])
    group[group == joined[2]] <- joined[1]
  }
  group_keys[group[match(keys, group_keys)]]
}
