run_ema_pipeline <- function(output_directory = "site/public/data",
                             cache_path = ".cache/ema/medicines.json",
                             downloads_directory = ".cache/downloads") {
  ema <- read_ema_json(download_ema_json(destination = cache_path))
  ema$data |>
    check_expected_columns() |>
    check_record_count(ema$meta) |>
    check_has_human_rows()
  snapshot_date <- snapshot_date_from_timestamp(ema$meta$timestamp)

  mesh_source <- download_mesh_descriptors(
    file.path(downloads_directory, "mesh")
  )
  chembl_directory <- file.path(downloads_directory, "chembl")
  chembl_release <- fetch_chembl_release(chembl_directory)
  atc_class_path <- download_chembl_atc_classes(
    chembl_release,
    chembl_directory
  )

  tables <- build_ema_tables(
    clean_ema_medicines(ema$data),
    mesh = load_mesh_descriptors(mesh_source),
    atc_class_rows = jsonlite::fromJSON(atc_class_path),
    snapshot_date = snapshot_date
  )
  tables$ema_medicines |>
    check_unique_product_numbers() |>
    check_no_future_approval_dates() |>
    check_single_medicine_type_flag() |>
    check_tile_matches_series(snapshot_date)

  meta <- build_meta(
    ema_medicines_url,
    ema$meta$timestamp,
    tables,
    snapshot_date = snapshot_date,
    sources = list(
      ema_source_entry(ema$meta$timestamp, cache_path),
      mesh_source_entry(mesh_source),
      chembl_source_entry(chembl_release, atc_class_path)
    )
  )
  write_ema_outputs(tables, meta, output_directory)
  report_pipeline_summary(tables, snapshot_date)
  invisible(tables)
}

build_ema_tables <- function(clean_medicines,
                             mesh,
                             atc_class_rows,
                             snapshot_date) {
  substances <- build_substances_table(clean_medicines)
  therapeutic_areas <- build_lookup_table(
    clean_medicines,
    "therapeutic_area_mesh"
  )
  medicines <- build_medicines_table(clean_medicines) |>
    add_authorization_intervals() |>
    add_substance_set_keys(substances)
  list(
    ema_medicines = medicines,
    ema_medicine_therapeutic_areas = therapeutic_areas,
    ema_medicine_active_substances = build_lookup_table(
      clean_medicines,
      "active_substance"
    ),
    ema_medicine_atc_codes = build_atc_codes_table(clean_medicines),
    ema_medicine_substances = substances,
    atc_classes = build_atc_classes(atc_class_rows),
    ema_therapeutic_area_branches = build_area_branches_table(
      match_mesh_terms(therapeutic_areas$therapeutic_area_mesh, mesh),
      mesh
    ),
    ema_authorized_series = build_authorized_series(medicines, snapshot_date)
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

report_pipeline_summary <- function(tables, snapshot_date) {
  term_sources <- dplyr::distinct(
    tables$ema_therapeutic_area_branches,
    .data$therapeutic_area_mesh,
    .data$source
  )
  match_counts <- vapply(
    c("mesh_heading", "entry_term", "curated", "unmatched"),
    function(source) sum(term_sources$source == source),
    integer(1)
  )
  cli::cli_alert_info(sprintf(
    "MeSH terms: %d heading, %d entry term, %d curated, %d unmatched.",
    match_counts[["mesh_heading"]],
    match_counts[["entry_term"]],
    match_counts[["curated"]],
    match_counts[["unmatched"]]
  ))
  unmatched <- term_sources$therapeutic_area_mesh[
    term_sources$source == "unmatched"
  ]
  if (length(unmatched) > 0) {
    unmatched <- cli::cli_vec(unmatched, list("vec-trunc" = length(unmatched)))
    cli::cli_alert_warning("Unmatched MeSH terms: {.val {unmatched}}")
  }
  last_point <- utils::tail(tables$ema_authorized_series, 1)
  cli::cli_alert_info(sprintf(
    "Authorized on %s: series %d products (%d substance sets), tile %d.",
    format(snapshot_date),
    last_point$authorized_products,
    last_point$authorized_substances,
    sum(is_authorized_now(tables$ema_medicines))
  ))
}
