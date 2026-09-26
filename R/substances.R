# Three combinations use " / " instead of ";", but Siiltibcy's single name
# "(rdESAT-6 / rCFP-10)" does too, so a slash inside parentheses never splits.
substance_delimiter <- stringr::regex(";| / (?![^(]*\\))")

build_substances_table <- function(clean_medicines) {
  clean_medicines |>
    dplyr::select(
      "ema_product_number",
      substance = "international_non_proprietary_name_common_name"
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
