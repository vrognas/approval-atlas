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
