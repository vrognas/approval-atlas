ema_split_columns <- c(
  "active_substance",
  "therapeutic_area_mesh",
  "atc_code_human"
)

derive_medicine_type <- function(advanced_therapy, biosimilar, generic) {
  dplyr::case_when(
    advanced_therapy ~ "Advanced therapy",
    biosimilar ~ "Biosimilar",
    generic ~ "Generic",
    .default = "Other"
  )
}

build_medicines_table <- function(clean_medicines) {
  clean_medicines |>
    dplyr::select(-dplyr::all_of(ema_split_columns)) |>
    dplyr::mutate(
      medicine_type = derive_medicine_type(
        .data$advanced_therapy,
        .data$biosimilar,
        .data$generic
      )
    ) |>
    dplyr::arrange(.data$ema_product_number)
}

build_lookup_table <- function(clean_medicines,
                               column,
                               placeholder_values = character()) {
  clean_medicines |>
    dplyr::select(dplyr::all_of(c("ema_product_number", column))) |>
    tidyr::separate_longer_delim(dplyr::all_of(column), delim = ";") |>
    dplyr::mutate(dplyr::across(dplyr::all_of(column), stringr::str_squish)) |>
    dplyr::filter(
      !is.na(.data[[column]]),
      .data[[column]] != "",
      !.data[[column]] %in% placeholder_values
    ) |>
    dplyr::distinct() |>
    dplyr::arrange(.data$ema_product_number, .data[[column]])
}
