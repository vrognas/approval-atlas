fixture_ema_path <- function() {
  testthat::test_path("fixtures", "ema-sample.json")
}

read_fixture_ema <- function() {
  jsonlite::fromJSON(fixture_ema_path())
}

fixture_mesh_path <- function() {
  testthat::test_path("fixtures", "mesh-desc-sample.xml")
}

fixture_atc_class_path <- function() {
  testthat::test_path("fixtures", "chembl-atc-class-sample.json")
}

fixture_epar_documents_path <- function() {
  testthat::test_path("fixtures", "epar-documents-sample.json")
}

fixture_ema_orphan_path <- function() {
  testthat::test_path("fixtures", "ema-orphan-designations-sample.json")
}

fixture_union_register_path <- function() {
  testthat::test_path("fixtures", "ods-products-sample.json")
}

fixture_whocc_updates_path <- function(year = 2026) {
  testthat::test_path(
    "fixtures",
    paste0("whocc-new-and-alterations-", year, ".xlsx")
  )
}

# Real ChEMBL_37 rows of codes the WHO index names differently.
fixture_atc_class_renamed_path <- function() {
  testthat::test_path("fixtures", "chembl-atc-class-renamed.json")
}

fixture_whocc_temporary_path <- function() {
  testthat::test_path("fixtures", "whocc-temporary-atc.xlsx")
}

fixture_whocc_alterations_path <- function() {
  testthat::test_path("fixtures", "whocc-alterations-sample.html")
}

fixture_whocc_index_path <- function(code) {
  testthat::test_path("fixtures", paste0("whocc-index-", code, ".html"))
}

read_fixture_bytes <- function(path) {
  readBin(path, "raw", file.size(path))
}

seed_cached_source <- function(destination, fixture_path, source) {
  dir.create(dirname(destination), recursive = TRUE)
  file.copy(fixture_path, destination)
  write_source_sidecar(source, file.path(dirname(destination), "source.json"))
}

# Fresh WHOCC caches. The yearly lists are looked up by the current year, so
# their sidecars name this year and the year before.
seed_whocc_downloads <- function(whocc_directory) {
  seed_cached_source(
    file.path(whocc_directory, "updates", "atc_ddd_new_and_alterations.xlsx"),
    fixture_whocc_updates_path(),
    list(
      url = whocc_updates_url(current_year()),
      etag = NA_character_,
      last_modified = NA_character_,
      retrieved = "2026-09-27T16:50:12Z"
    )
  )
  seed_cached_source(
    file.path(
      whocc_directory,
      "updates-previous",
      "atc_ddd_new_and_alterations.xlsx"
    ),
    fixture_whocc_updates_path(2025),
    list(
      url = whocc_updates_url(current_year() - 1L),
      etag = "\"91f0-645fb2e841422-gzip\"",
      last_modified = "Mon, 15 Dec 2025 10:36:19 GMT",
      retrieved = "2026-09-27T21:17:56Z"
    )
  )
  seed_cached_source(
    file.path(whocc_directory, "temporary", "temporary_atc_and_ddd.xlsx"),
    fixture_whocc_temporary_path(),
    list(
      url = whocc_temporary_url,
      etag = "\"9092-65939810b823c\"",
      last_modified = "Mon, 17 Aug 2026 07:56:13 GMT",
      retrieved = "2026-09-27T16:53:55Z"
    )
  )
  seed_cached_source(
    file.path(whocc_directory, "alterations", "atc_alterations.html"),
    fixture_whocc_alterations_path(),
    list(
      url = whocc_alterations_url,
      etag = NA_character_,
      last_modified = NA_character_,
      retrieved = "2026-09-27T16:47:54Z"
    )
  )
}

forbid_network <- function(env = parent.frame()) {
  testthat::local_mocked_bindings(
    req_perform = function(...) stop("network must not be used"),
    .package = "httr2",
    .env = env
  )
}

fixture_fold_cases_path <- function() {
  testthat::test_path("fixtures", "fold-cases.json")
}

epar_page <- function(slug) {
  paste0("https://www.ema.europa.eu/en/medicines/human/EPAR/", slug)
}
