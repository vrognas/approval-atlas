test_that("download_ema_json reuses a fresh cached file without the network", {
  destination <- file.path(tempfile(), "medicines.json")
  dir.create(dirname(destination))
  writeLines("cached", destination)
  testthat::local_mocked_bindings(
    req_perform = function(...) stop("network must not be used"),
    .package = "httr2"
  )
  expect_message(
    result <- download_ema_json(destination = destination),
    "Using cached EMA data"
  )
  expect_identical(result, destination)
  expect_identical(readLines(destination), "cached")
})

test_that("download_ema_json downloads into a new cache directory", {
  destination <- file.path(tempfile(), "ema", "medicines.json")
  requested <- new.env()
  testthat::local_mocked_bindings(
    req_perform = function(req, path = NULL, ...) {
      requested$url <- req$url
      requested$user_agent <- req$options$useragent
      requested$path <- path
      file.copy(fixture_ema_path(), path)
      httr2::response(status_code = 200)
    },
    .package = "httr2"
  )
  expect_message(
    result <- download_ema_json(
      url = "https://example.org/medicines.json",
      destination = destination
    ),
    "Downloading EMA data"
  )
  expect_identical(result, destination)
  expect_identical(requested$url, "https://example.org/medicines.json")
  expect_match(requested$user_agent, "approval-atlas", fixed = TRUE)
  expect_identical(
    normalizePath(dirname(requested$path)),
    normalizePath(dirname(destination))
  )
  expect_identical(
    tools::md5sum(destination)[[1]],
    tools::md5sum(fixture_ema_path())[[1]]
  )
  expect_identical(list.files(dirname(destination)), "medicines.json")
})

test_that("download_ema_json replaces a stale cached file", {
  destination <- file.path(tempfile(), "medicines.json")
  dir.create(dirname(destination))
  writeLines("stale", destination)
  Sys.setFileTime(destination, Sys.time() - 48 * 60 * 60)
  testthat::local_mocked_bindings(
    req_perform = function(req, path = NULL, ...) {
      writeLines("fresh", path)
      httr2::response(status_code = 200)
    },
    .package = "httr2"
  )
  expect_message(
    download_ema_json(destination = destination, max_age_hours = 24),
    "Downloading EMA data"
  )
  expect_identical(readLines(destination), "fresh")
  expect_identical(list.files(dirname(destination)), "medicines.json")
})

test_that("a failed download keeps the cached file and leaves no temp file", {
  destination <- file.path(tempfile(), "medicines.json")
  dir.create(dirname(destination))
  writeLines("stale", destination)
  Sys.setFileTime(destination, Sys.time() - 48 * 60 * 60)
  testthat::local_mocked_bindings(
    req_perform = function(req, path = NULL, ...) {
      writeLines("<html>error page</html>", path)
      stop("HTTP 500 Internal Server Error.")
    },
    .package = "httr2"
  )
  expect_error(
    suppressMessages(download_ema_json(destination = destination)),
    "HTTP 500"
  )
  expect_identical(readLines(destination), "stale")
  expect_identical(list.files(dirname(destination)), "medicines.json")
})

test_that("an HTTP error response aborts the download", {
  destination <- file.path(tempfile(), "medicines.json")
  httr2::local_mocked_responses(function(req) {
    httr2::response(status_code = 503)
  })
  expect_error(
    suppressMessages(download_ema_json(destination = destination)),
    class = "httr2_http_503"
  )
  expect_false(file.exists(destination))
})

test_that("a failed rename aborts and leaves no temp file", {
  destination <- file.path(tempfile(), "medicines.json")
  # A non-empty directory at the destination makes file.rename() fail.
  dir.create(destination, recursive = TRUE)
  writeLines("occupied", file.path(destination, "occupant"))
  testthat::local_mocked_bindings(
    req_perform = function(req, path = NULL, ...) {
      writeLines("fresh", path)
      httr2::response(status_code = 200)
    },
    .package = "httr2"
  )
  expect_error(
    suppressWarnings(suppressMessages(
      download_ema_json(destination = destination, max_age_hours = 0)
    )),
    "Could not move the download",
    class = "rlang_error"
  )
  expect_identical(list.files(dirname(destination)), "medicines.json")
})

test_that("read_ema_json returns meta and a tibble of character columns", {
  ema <- read_ema_json(fixture_ema_path())
  expect_named(ema, c("meta", "data"))
  expect_identical(ema$meta$total_records, 21L)
  expect_identical(ema$meta$timestamp, "2026-09-26T06:02:29Z")
  expect_s3_class(ema$data, "tbl_df")
  expect_identical(nrow(ema$data), 21L)
  expect_true(all(vapply(ema$data, is.character, logical(1))))
})

test_that("ema_request allows one request per 2 s across all EMA files", {
  requested <- new.env()
  testthat::local_mocked_bindings(
    throttled_request = function(url, spacing_seconds, realm) {
      requested$spacing_seconds <- spacing_seconds
      requested$realm <- realm
    }
  )
  ema_request(ema_medicines_url)
  expect_identical(requested$spacing_seconds, 2)
  expect_identical(requested$realm, "ema.europa.eu")
})

test_that("download_ema_json uses the EMA request", {
  destination <- file.path(tempfile(), "medicines.json")
  requested <- new.env()
  testthat::local_mocked_bindings(
    req_perform = function(req, path = NULL, ...) {
      requested$realm <- req$policies$throttle_realm
      writeLines("{}", path)
      httr2::response(status_code = 200)
    },
    .package = "httr2"
  )
  suppressMessages(download_ema_json(destination = destination))
  expect_identical(requested$realm, "ema.europa.eu")
})
