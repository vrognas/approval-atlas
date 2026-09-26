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

fixture_fold_cases_path <- function() {
  testthat::test_path("fixtures", "fold-cases.json")
}

epar_page <- function(slug) {
  paste0("https://www.ema.europa.eu/en/medicines/human/EPAR/", slug)
}
