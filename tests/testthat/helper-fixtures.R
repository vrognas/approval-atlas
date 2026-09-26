fixture_ema_path <- function() {
  testthat::test_path("fixtures", "ema-sample.json")
}

read_fixture_ema <- function() {
  jsonlite::fromJSON(fixture_ema_path())
}
