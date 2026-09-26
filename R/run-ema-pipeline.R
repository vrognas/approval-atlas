run_ema_pipeline <- function(output_directory = "site/public/data",
                             cache_path = ".cache/ema/medicines.json") {
  ema <- read_ema_json(download_ema_json(destination = cache_path))
  ema$data |>
    check_expected_columns() |>
    check_record_count(ema$meta) |>
    check_has_human_rows()

  tables <- build_ema_tables(clean_ema_medicines(ema$data))
  tables$ema_medicines |>
    check_unique_product_numbers() |>
    check_no_future_approval_dates() |>
    check_single_medicine_type_flag()

  meta <- build_meta(ema_medicines_url, ema$meta$timestamp, tables)
  write_ema_outputs(tables, meta, output_directory)
  invisible(tables)
}

build_ema_tables <- function(clean_medicines) {
  list(
    ema_medicines = build_medicines_table(clean_medicines),
    ema_medicine_therapeutic_areas = build_lookup_table(
      clean_medicines,
      "therapeutic_area_mesh"
    ),
    ema_medicine_active_substances = build_lookup_table(
      clean_medicines,
      "active_substance"
    ),
    ema_medicine_atc_codes = build_lookup_table(
      clean_medicines,
      "atc_code_human",
      placeholder_values = "Not yet assigned"
    )
  )
}

write_ema_outputs <- function(tables, meta, output_directory) {
  dir.create(output_directory, recursive = TRUE, showWarnings = FALSE)
  for (table_name in names(tables)) {
    path <- file.path(output_directory, paste0(table_name, ".json"))
    write_json_table(tables[[table_name]], path)
    cli::cli_alert_success(
      "{.file {path}}: {nrow(tables[[table_name]])} rows"
    )
  }
  write_meta_json(meta, file.path(output_directory, "meta.json"))
  cli::cli_alert_success(
    "{.file {file.path(output_directory, 'meta.json')}}: EMA data as of
    {meta$source_timestamp}"
  )
}
