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
  documents_source <- download_epar_documents(
    file.path(downloads_directory, "ema-documents")
  )
  orphan_source <- download_orphan_designations(
    file.path(downloads_directory, "ema-orphans")
  )
  register_source <- download_union_register(
    file.path(downloads_directory, "union-register")
  )
  documents <- read_epar_documents(documents_source$path)
  orphan_designations <- read_ema_orphan_designations(orphan_source$path)

  tables <- build_ema_tables(
    clean_ema_medicines(ema$data),
    mesh = load_mesh_descriptors(mesh_source),
    atc_class_rows = jsonlite::fromJSON(atc_class_path),
    snapshot_date = snapshot_date,
    epar_documents = documents$data,
    orphan_designations = orphan_designations$data,
    union_register = read_union_register(register_source$path)
  )
  tables$ema_medicines |>
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
      chembl_source_entry(chembl_release, atc_class_path),
      epar_documents_source_entry(documents_source, documents$meta$timestamp),
      ema_orphan_source_entry(
        orphan_source,
        orphan_designations$meta$timestamp
      ),
      union_register_source_entry(register_source)
    )
  )
  write_ema_outputs(tables, meta, output_directory)
  report_pipeline_summary(tables, snapshot_date)
  invisible(tables)
}

build_ema_tables <- function(clean_medicines,
                             mesh,
                             atc_class_rows,
                             snapshot_date,
                             epar_documents,
                             orphan_designations,
                             union_register) {
  substances <- build_substances_table(clean_medicines)
  therapeutic_areas <- build_lookup_table(
    clean_medicines,
    "therapeutic_area_mesh"
  )
  active_substances <- build_lookup_table(clean_medicines, "active_substance")
  # Checked first: every other table joins on the product number.
  medicines <- build_medicines_table(clean_medicines) |>
    check_unique_product_numbers() |>
    add_authorization_intervals() |>
    add_substance_set_keys(substances)
  term_matches <- match_mesh_terms(
    therapeutic_areas$therapeutic_area_mesh,
    mesh
  )
  list(
    ema_medicines = medicines,
    ema_medicine_therapeutic_areas = therapeutic_areas,
    ema_medicine_active_substances = active_substances,
    ema_medicine_atc_codes = build_atc_codes_table(clean_medicines),
    ema_medicine_substances = substances,
    atc_classes = build_atc_classes(atc_class_rows),
    ema_therapeutic_area_branches = build_area_branches_table(
      term_matches,
      mesh
    ),
    ema_authorized_series = build_authorized_series(medicines, snapshot_date),
    ema_medicine_documents = build_documents_table(epar_documents, medicines),
    mesh_entry_terms = build_mesh_entry_terms(
      find_relevant_descriptors(term_matches$mesh_descriptor_ui, mesh),
      mesh
    ),
    mesh_descriptor_areas = build_mesh_descriptor_areas(term_matches, mesh),
    ema_search_index = build_search_index(
      medicines,
      substances,
      active_substances
    ),
    ema_medicine_protection = build_protection_table(medicines, snapshot_date),
    ema_medicine_orphan_exclusivity = build_orphan_exclusivity_table(
      medicines,
      orphan_designations,
      union_register
    ),
    ema_medicine_register_status = build_register_status_table(
      medicines,
      union_register
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

report_protection_summary <- function(protection) {
  count_of <- function(column, value) sum(protection[[column]] == value)
  cli::cli_alert_info(sprintf(
    paste(
      "Protection estimates: %d protected, %d ended, %d unclear",
      "(%d follow a reference, %d reference not found)."
    ),
    count_of("status", "protected"),
    count_of("status", "ended"),
    count_of("status", "unclear"),
    count_of("basis", "follows_reference"),
    count_of("basis", "reference_not_found")
  ))
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
  report_documents_coverage(tables$ema_medicine_documents, tables$ema_medicines)
  report_protection_summary(tables$ema_medicine_protection)
  report_orphan_coverage(
    tables$ema_medicine_orphan_exclusivity,
    tables$ema_medicines,
    snapshot_date
  )
  report_register_status(
    tables$ema_medicine_register_status,
    tables$ema_medicines
  )
}
