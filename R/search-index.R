# Small first-load file for the browser search: one row per medicine.
build_search_index <- function(medicines, substances, active_substances) {
  substance_summary <- substances |>
    dplyr::summarise(
      substances = paste(.data$substance, collapse = "; "),
      substance_keys = list(unique(.data$substance_key)),
      .by = "ema_product_number"
    )
  active_substance_summary <- active_substances |>
    dplyr::summarise(
      active_substance = paste(.data$active_substance, collapse = "; "),
      .by = "ema_product_number"
    )
  medicines |>
    dplyr::select(
      "ema_product_number",
      "name_of_medicine",
      "medicine_status",
      "marketing_authorisation_date",
      "medicine_type",
      "orphan_medicine",
      "conditional_approval",
      "exceptional_circumstances",
      "additional_monitoring"
    ) |>
    dplyr::left_join(
      substance_summary,
      by = "ema_product_number",
      relationship = "one-to-one"
    ) |>
    dplyr::left_join(
      active_substance_summary,
      by = "ema_product_number",
      relationship = "one-to-one"
    ) |>
    dplyr::mutate(
      substance_keys = purrr::map(
        .data$substance_keys,
        function(keys) keys %||% character()
      )
    ) |>
    dplyr::select(
      "ema_product_number",
      "name_of_medicine",
      "substances",
      "substance_keys",
      "active_substance",
      "medicine_status",
      "marketing_authorisation_date",
      "medicine_type",
      "orphan_medicine",
      # For the medicine card's first screen, before ema_medicines.json loads.
      "conditional_approval",
      "exceptional_circumstances",
      "additional_monitoring"
    ) |>
    dplyr::arrange(.data$ema_product_number)
}
