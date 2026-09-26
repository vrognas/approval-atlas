test_that("write_json_table writes rows with nulls, ISO dates, plain types", {
  data <- dplyr::tibble(
    ema_product_number = c("EMEA/H/C/000001", "EMEA/H/C/000002"),
    name_of_medicine = c("Taï", NA),
    marketing_authorisation_date = as.Date(c("2023-09-22", NA)),
    generic = c(TRUE, FALSE),
    revision_number = c(12L, NA)
  )
  path <- tempfile(fileext = ".json")
  write_json_table(data, path)

  rows <- jsonlite::fromJSON(path, simplifyVector = FALSE)
  expect_length(rows, 2)
  expect_identical(names(rows[[2]]), names(data))
  expect_identical(rows[[1]]$name_of_medicine, "Taï")
  expect_identical(rows[[1]]$marketing_authorisation_date, "2023-09-22")
  expect_identical(rows[[1]]$generic, TRUE)
  expect_identical(rows[[1]]$revision_number, 12L)
  expect_null(rows[[2]]$name_of_medicine)
  expect_null(rows[[2]]$marketing_authorisation_date)
  expect_null(rows[[2]]$revision_number)

  text <- readLines(path, encoding = "UTF-8", warn = FALSE)
  expect_match(text, "\"name_of_medicine\":null", fixed = TRUE)
  expect_no_match(text, "\"\"", fixed = TRUE)
})

test_that("write_json_table round-trips through jsonlite", {
  data <- dplyr::tibble(
    ema_product_number = c("A", "B"),
    active_substance = c("x", "y")
  )
  path <- tempfile(fileext = ".json")
  write_json_table(data, path)
  expect_identical(
    dplyr::as_tibble(jsonlite::fromJSON(path)),
    data
  )
})

test_that("write_json_table writes an empty table as an empty array", {
  path <- tempfile(fileext = ".json")
  write_json_table(dplyr::tibble(ema_product_number = character()), path)
  expect_identical(readLines(path, warn = FALSE), "[]")
})

example_sources <- function() {
  list(
    list(name = "EMA", version = "2026-09-26T06:02:29Z"),
    list(name = "MeSH", version = "MeSH 2026", last_modified = NA_character_)
  )
}

test_that("build_meta records source, timestamp, row counts and attribution", {
  meta <- build_meta(
    source_url = "https://example.org/medicines.json",
    source_timestamp = "2026-09-26T06:02:29Z",
    tables = list(
      ema_medicines = dplyr::tibble(x = 1:3),
      ema_medicine_atc_codes = dplyr::tibble(x = 1:2)
    ),
    snapshot_date = as.Date("2026-09-26"),
    sources = example_sources()
  )
  expect_named(
    meta,
    c(
      "source_url", "source_timestamp", "row_counts", "attribution",
      "snapshot_date", "sources", "licence"
    )
  )
  expect_identical(meta$source_timestamp, "2026-09-26T06:02:29Z")
  expect_identical(
    meta$row_counts,
    list(ema_medicines = 3L, ema_medicine_atc_codes = 2L)
  )
  expect_identical(
    meta$attribution,
    paste0(
      "Source: European Medicines Agency (EMA), ",
      "https://www.ema.europa.eu/en/medicines/download-medicine-data. ",
      "© EMA. Filtered to human medicines and reshaped; ",
      "not affiliated with or endorsed by EMA."
    )
  )
})

test_that("build_meta adds the snapshot date, sources and data licence", {
  meta <- build_meta(
    source_url = "https://example.org/medicines.json",
    source_timestamp = "2026-09-26T06:02:29Z",
    tables = list(ema_medicines = dplyr::tibble(x = 1:3)),
    snapshot_date = as.Date("2026-09-26"),
    sources = example_sources()
  )
  expect_identical(meta$snapshot_date, "2026-09-26")
  expect_identical(meta$sources, example_sources())
  expect_identical(
    meta$licence,
    paste(
      "Data files: compilation licensed CC BY-SA 4.0",
      "(https://creativecommons.org/licenses/by-sa/4.0/); ChEMBL-derived",
      "values adapted from ChEMBL (CC BY-SA 3.0) and modified (selected and",
      "mapped). Values from other sources keep their own terms: EMA content",
      "© European Medicines Agency (reuse with acknowledgement); MeSH®",
      "courtesy of the U.S. National Library of Medicine; ATC classification",
      "codes from ChEMBL and ATC level names © WHO Collaborating Centre for",
      "Drug Statistics Methodology, reproduced verbatim and excluded from",
      "this licence."
    )
  )
})

test_that("write_meta_json writes a JSON object with unboxed scalars", {
  meta <- build_meta(
    source_url = "https://example.org/medicines.json",
    source_timestamp = "2026-09-26T06:02:29Z",
    tables = list(ema_medicines = dplyr::tibble(x = 1:3)),
    snapshot_date = as.Date("2026-09-26"),
    sources = example_sources()
  )
  path <- tempfile(fileext = ".json")
  write_meta_json(meta, path)
  written <- jsonlite::fromJSON(path, simplifyVector = FALSE)
  expect_identical(written$source_url, "https://example.org/medicines.json")
  expect_identical(written$source_timestamp, "2026-09-26T06:02:29Z")
  expect_identical(written$row_counts, list(ema_medicines = 3L))
  expect_identical(written$attribution, meta$attribution)
  expect_identical(written$snapshot_date, "2026-09-26")
  expect_identical(written$sources[[1]], list(
    name = "EMA",
    version = "2026-09-26T06:02:29Z"
  ))
  expect_identical(written$licence, meta$licence)
  expect_match(
    readLines(path, encoding = "UTF-8"),
    "\"last_modified\": null",
    fixed = TRUE,
    all = FALSE
  )
})

test_that("ema_source_entry names EMA, its timestamp and the retrieval date", {
  cache_path <- tempfile(fileext = ".json")
  writeLines("{}", cache_path)
  Sys.setFileTime(cache_path, as.POSIXct("2026-09-25 12:00:00"))
  entry <- ema_source_entry("2026-09-26T06:02:29Z", cache_path)
  expect_named(
    entry,
    c("name", "url", "version", "retrieved", "licence", "attribution")
  )
  expect_identical(entry$url, ema_medicines_url)
  expect_identical(entry$version, "2026-09-26T06:02:29Z")
  expect_identical(entry$retrieved, "2026-09-25")
  expect_identical(entry$attribution, ema_attribution)
})

test_that("mesh_source_entry names the MeSH year and Last-Modified", {
  xml_path <- tempfile(fileext = ".xml")
  writeLines("<x/>", xml_path)
  Sys.setFileTime(xml_path, as.POSIXct("2026-09-20 12:00:00"))
  entry <- mesh_source_entry(list(
    year = "2026",
    url = "https://example.org/desc2026.gz",
    path = xml_path,
    last_modified = "Wed, 12 Aug 2026 18:05:02 GMT"
  ))
  expect_named(
    entry,
    c(
      "name", "url", "version", "retrieved", "licence", "attribution",
      "last_modified"
    )
  )
  expect_identical(entry$url, "https://example.org/desc2026.gz")
  expect_identical(entry$version, "MeSH 2026")
  expect_identical(entry$retrieved, "2026-09-20")
  expect_identical(entry$last_modified, "Wed, 12 Aug 2026 18:05:02 GMT")
  expect_match(
    entry$attribution,
    "Courtesy of the U.S. National Library of Medicine",
    fixed = TRUE
  )
})

test_that("chembl_source_entry names the release and its use", {
  atc_class_path <- tempfile(fileext = ".json")
  writeLines("[]", atc_class_path)
  Sys.setFileTime(atc_class_path, as.POSIXct("2026-09-21 12:00:00"))
  entry <- chembl_source_entry("ChEMBL_37", atc_class_path)
  expect_named(
    entry,
    c("name", "url", "version", "retrieved", "licence", "attribution")
  )
  expect_identical(entry$version, "ChEMBL_37")
  expect_identical(entry$retrieved, "2026-09-21")
  expect_match(entry$licence, "CC BY-SA 3.0", fixed = TRUE)
  expect_match(
    entry$attribution,
    "ChEMBL data is from https://www.ebi.ac.uk/chembl",
    fixed = TRUE
  )
  expect_match(entry$attribution, "ATC classification names", fixed = TRUE)
})
