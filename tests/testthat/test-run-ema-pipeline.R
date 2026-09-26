copy_fixture_to_cache <- function() {
  cache_path <- file.path(tempfile(), "medicines.json")
  dir.create(dirname(cache_path))
  file.copy(fixture_ema_path(), cache_path)
  cache_path
}

write_modified_fixture <- function(modify) {
  ema <- read_fixture_ema()
  ema <- modify(ema)
  cache_path <- file.path(tempfile(), "medicines.json")
  dir.create(dirname(cache_path))
  jsonlite::write_json(ema, cache_path, auto_unbox = TRUE, dataframe = "rows")
  cache_path
}

# Fresh MeSH and ChEMBL caches, so the pipeline never needs the network.
seed_downloads_directory <- function() {
  downloads_directory <- file.path(tempfile(), "downloads")
  mesh_directory <- file.path(downloads_directory, "mesh")
  dir.create(mesh_directory, recursive = TRUE)
  file.copy(fixture_mesh_path(), file.path(mesh_directory, "desc2026.xml"))
  jsonlite::write_json(
    list(
      year = "2026",
      url = paste0(mesh_listing_url, "desc2026.gz"),
      last_modified = "Wed, 12 Aug 2026 18:05:02 GMT"
    ),
    file.path(mesh_directory, "source.json"),
    auto_unbox = TRUE
  )
  release_directory <- file.path(downloads_directory, "chembl", "ChEMBL_37")
  dir.create(release_directory, recursive = TRUE)
  writeLines(
    '{"chembl_db_version": "ChEMBL_37"}',
    file.path(downloads_directory, "chembl", "status.json")
  )
  file.copy(
    fixture_atc_class_path(),
    file.path(release_directory, "atc_class.json")
  )
  seed_cached_source(
    file.path(downloads_directory, "ema-documents", "epar_documents.json"),
    fixture_epar_documents_path(),
    list(
      url = epar_documents_url,
      etag = "\"1790394761\"",
      last_modified = "Sat, 26 Sep 2026 03:52:41 GMT",
      retrieved = "2026-09-26T15:30:56Z"
    )
  )
  seed_cached_source(
    file.path(
      downloads_directory, "ema-orphans", "orphan_designations.json"
    ),
    fixture_ema_orphan_path(),
    list(
      url = ema_orphan_designations_url,
      etag = NA_character_,
      last_modified = "Sat, 26 Sep 2026 16:10:39 GMT",
      retrieved = "2026-09-26T16:45:21Z"
    )
  )
  seed_cached_source(
    file.path(downloads_directory, "union-register", "ods_products.json"),
    fixture_union_register_path(),
    list(
      url = union_register_url,
      etag = "\"ff8867-65c507c733087\"",
      last_modified = "Fri, 25 Sep 2026 15:36:55 GMT",
      retrieved = "2026-09-26T15:31:22Z"
    )
  )
  downloads_directory
}

seed_cached_source <- function(destination, fixture_path, source) {
  dir.create(dirname(destination), recursive = TRUE)
  file.copy(fixture_path, destination)
  write_source_sidecar(source, file.path(dirname(destination), "source.json"))
}

forbid_network <- function(env = parent.frame()) {
  testthat::local_mocked_bindings(
    req_perform = function(...) stop("network must not be used"),
    .package = "httr2",
    .env = env
  )
}

run_fixture_pipeline <- function(output_directory,
                                 cache_path = copy_fixture_to_cache()) {
  run_ema_pipeline(
    output_directory = output_directory,
    cache_path = cache_path,
    downloads_directory = seed_downloads_directory()
  )
}

output_stems <- c(
  "ema_medicines",
  "ema_medicine_therapeutic_areas",
  "ema_medicine_active_substances",
  "ema_medicine_atc_codes",
  "ema_medicine_substances",
  "atc_classes",
  "ema_therapeutic_area_branches",
  "ema_authorized_series",
  "ema_medicine_documents",
  "mesh_entry_terms",
  "mesh_descriptor_areas",
  "ema_search_index",
  "ema_medicine_protection",
  "ema_medicine_orphan_exclusivity",
  "ema_medicine_register_status"
)

test_that("run_ema_pipeline writes every table and meta.json from caches", {
  forbid_network()
  output_directory <- file.path(tempfile(), "data")
  tables <- suppressMessages(run_fixture_pipeline(output_directory))
  expect_named(tables, output_stems)
  expect_setequal(
    list.files(output_directory),
    c(paste0(output_stems, ".json"), "meta.json")
  )
  expect_identical(nrow(tables$ema_medicines), 19L)

  meta <- jsonlite::fromJSON(
    file.path(output_directory, "meta.json"),
    simplifyVector = FALSE
  )
  expect_identical(meta$source_url, ema_medicines_url)
  expect_identical(meta$source_timestamp, "2026-09-26T06:02:29Z")
  expect_identical(meta$row_counts, lapply(tables, nrow))
  expect_identical(meta$snapshot_date, "2026-09-26")
  expect_identical(
    vapply(meta$sources, function(source) source$version, character(1)),
    c(
      "2026-09-26T06:02:29Z", "MeSH 2026", "ChEMBL_37",
      "2026-09-26T05:49:47Z", "2026-09-26T18:10:39Z",
      "Fri, 25 Sep 2026 15:36:55 GMT"
    )
  )
  expect_identical(
    meta$sources[[2]]$last_modified,
    "Wed, 12 Aug 2026 18:05:02 GMT"
  )
  expect_identical(
    vapply(meta$sources[4:6], function(source) source$url, character(1)),
    c(epar_documents_url, ema_orphan_designations_url, union_register_url)
  )
  expect_identical(meta$sources[[6]]$retrieved, "2026-09-26")
  expect_match(meta$sources[[6]]$attribution, "Union Register", fixed = TRUE)
  expect_identical(meta$licence, data_licence)
})

test_that("run_ema_pipeline builds the lookup tables from cached sources", {
  forbid_network()
  tables <- suppressMessages(
    run_fixture_pipeline(file.path(tempfile(), "data"))
  )
  documents <- tables$ema_medicine_documents
  expect_setequal(
    unique(documents$ema_product_number),
    paste0("EMEA/H/C/", c("000112", "000697", "003933", "004090"))
  )
  expect_identical(nrow(tables$ema_search_index), 19L)
  expect_identical(nrow(tables$ema_medicine_protection), 14L)
  tyruko <- tables$ema_medicine_protection[
    tables$ema_medicine_protection$ema_product_number == "EMEA/H/C/005752",
  ]
  expect_identical(tyruko$basis, "reference_not_found")
  expect_identical(
    unique(tables$ema_medicine_orphan_exclusivity$ema_product_number),
    c("EMEA/H/C/003933", "EMEA/H/C/004090")
  )
  expect_identical(nrow(tables$ema_medicine_orphan_exclusivity), 5L)
  register_status <- tables$ema_medicine_register_status
  expect_identical(
    register_status$ema_product_number,
    paste0("EMEA/H/C/", c("000697", "003933", "004090", "005282"))
  )
  expect_identical(
    register_status$agrees_with_ema,
    c(FALSE, TRUE, TRUE, FALSE)
  )
  # The fixture MeSH has none of the fixture EMA terms.
  expect_identical(nrow(tables$mesh_entry_terms), 0L)
  expect_identical(nrow(tables$mesh_descriptor_areas), 0L)
})

test_that("run_ema_pipeline returns the tables invisibly", {
  forbid_network()
  expect_invisible(suppressMessages(run_fixture_pipeline(
    file.path(tempfile(), "data")
  )))
})

test_that("run_ema_pipeline reports files, MeSH matches and the series", {
  forbid_network()
  messages <- testthat::capture_messages(run_fixture_pipeline(
    file.path(tempfile(), "data")
  ))
  expect_match(messages, "Using cached EMA data", all = FALSE)
  expect_match(messages, "Using cached MeSH 2026", all = FALSE)
  expect_match(messages, "Using cached ChEMBL_37 ATC classes", all = FALSE)
  expect_match(messages, "ema_medicines\\.json.*: 19 rows", all = FALSE)
  expect_match(messages, "meta\\.json.*EMA data as of", all = FALSE)
  expect_match(
    messages,
    "MeSH terms: 0 heading, 0 entry term, 0 curated, 25 unmatched",
    all = FALSE
  )
  expect_match(messages, "Unmatched MeSH terms:.*Psoriasis", all = FALSE)
  expect_match(
    messages,
    "Authorized on 2026-09-26: series 12 products .* tile 12",
    all = FALSE
  )
  expect_match(messages, "Using cached EMA EPAR documents index", all = FALSE)
  expect_match(messages, "Using cached EMA orphan designations", all = FALSE)
  expect_match(messages, "Using cached Union Register products", all = FALSE)
  expect_match(
    messages,
    "Documents: 3 of 14 Authorised medicines have product information",
    all = FALSE
  )
  expect_match(
    messages,
    "Protection estimates: 6 protected, 4 ended, 4 unclear",
    all = FALSE
  )
  expect_match(
    messages,
    "Orphan exclusivity: 2 of 2 Authorised orphan medicines linked",
    all = FALSE
  )
  expect_match(
    messages,
    "Union Register status: 4 EMA products linked \\(2 of 14 Authorised\\)",
    all = FALSE
  )
})

test_that("run_ema_pipeline adds the authorization and substance columns", {
  forbid_network()
  tables <- suppressMessages(
    run_fixture_pipeline(file.path(tempfile(), "data"))
  )
  medicines <- tables$ema_medicines
  expect_identical(
    utils::tail(names(medicines), 5),
    c(
      "medicine_type", "authorized_from", "authorized_until",
      "series_exclusion", "substance_set_key"
    )
  )
  expect_length(medicines, 33 + 4)
  suboxone <- medicines[medicines$ema_product_number == "EMEA/H/C/000697", ]
  expect_identical(suboxone$authorized_until, as.Date("2026-09-11"))
  expect_identical(suboxone$substance_set_key, "buprenorphine|naloxone")
  series <- tables$ema_authorized_series
  expect_identical(utils::tail(series$date, 1), as.Date("2026-09-26"))
  expect_identical(utils::tail(series$authorized_products, 1), 12L)
  expect_identical(
    unique(tables$ema_medicine_atc_codes$source),
    "ema"
  )
  expect_true(all(
    tables$ema_therapeutic_area_branches$source %in%
      c("mesh_heading", "entry_term", "curated", "unmatched")
  ))
})

test_that("run_ema_pipeline output follows the data contract", {
  forbid_network()
  output_directory <- file.path(tempfile(), "data")
  suppressMessages(run_fixture_pipeline(output_directory))
  read_output <- function(stem) {
    jsonlite::fromJSON(file.path(output_directory, paste0(stem, ".json")))
  }
  medicines <- read_output("ema_medicines")
  expect_false(any(unlist(medicines) == "", na.rm = TRUE))
  expect_type(medicines$generic, "logical")
  expect_type(medicines$revision_number, "integer")
  for (date_column in c("marketing_authorisation_date", "authorized_from")) {
    expect_true(all(
      grepl("^\\d{4}-\\d{2}-\\d{2}$", medicines[[date_column]]) |
        is.na(medicines[[date_column]])
    ))
  }
  product_lookups <- c(
    "ema_medicine_therapeutic_areas",
    "ema_medicine_active_substances",
    "ema_medicine_atc_codes",
    "ema_medicine_substances",
    "ema_medicine_documents",
    "ema_search_index",
    "ema_medicine_protection",
    "ema_medicine_orphan_exclusivity",
    "ema_medicine_register_status"
  )
  for (stem in product_lookups) {
    lookup <- read_output(stem)
    expect_in(lookup$ema_product_number, medicines$ema_product_number)
    expect_false(any(unlist(lookup) == "", na.rm = TRUE))
  }
  expect_type(read_output("ema_medicine_atc_codes")$atc_incomplete, "logical")
  expect_type(read_output("atc_classes")$level, "integer")
  expect_type(
    read_output("ema_authorized_series")$authorized_products,
    "integer"
  )
  raw_text <- unlist(lapply(
    list.files(output_directory, full.names = TRUE),
    readLines,
    warn = FALSE,
    encoding = "UTF-8"
  ))
  expect_no_match(raw_text, ":\"\"", fixed = TRUE)
})

test_that("run_ema_pipeline aborts before writing when source checks fail", {
  forbid_network()
  cache_path <- write_modified_fixture(function(ema) {
    ema$meta$total_records <- 999
    ema
  })
  output_directory <- file.path(tempfile(), "data")
  expect_error(
    suppressMessages(run_fixture_pipeline(output_directory, cache_path)),
    "999"
  )
  expect_false(dir.exists(output_directory))
})

test_that("run_ema_pipeline aborts before writing when table checks fail", {
  forbid_network()
  cache_path <- write_modified_fixture(function(ema) {
    ema$data$ema_product_number[2] <- ema$data$ema_product_number[1]
    ema
  })
  output_directory <- file.path(tempfile(), "data")
  expect_error(
    suppressMessages(run_fixture_pipeline(output_directory, cache_path)),
    "ema_product_number"
  )
  expect_false(dir.exists(output_directory))
})

test_that("run_ema_pipeline aborts before writing if tile and series differ", {
  forbid_network()
  cache_path <- write_modified_fixture(function(ema) {
    is_tyruko <- ema$data$ema_product_number == "EMEA/H/C/005752"
    ema$data$withdrawal_expiry_revocation_lapse_of_marketing_authorisation_date[
      is_tyruko
    ] <- "01/01/2025"
    ema
  })
  output_directory <- file.path(tempfile(), "data")
  expect_error(
    suppressMessages(run_fixture_pipeline(output_directory, cache_path)),
    "EMEA/H/C/005752 Tyruko"
  )
  expect_false(dir.exists(output_directory))
})
