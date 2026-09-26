test_that("throttled_request identifies the project and sets a timeout", {
  request <- throttled_request("https://example.org/data.json")
  expect_identical(request$url, "https://example.org/data.json")
  expect_identical(
    request$options$useragent,
    "approval-atlas (https://github.com/vrognas/approval-atlas)"
  )
  expect_identical(request$options$timeout_ms, 120000)
})

test_that("throttled_request allows one request per spacing, per realm", {
  request <- throttled_request(
    "https://example.org/data.json",
    spacing_seconds = 2,
    realm = "approval-atlas-test-realm"
  )
  expect_identical(request$policies$throttle_realm, "approval-atlas-test-realm")
  status <- httr2::throttle_status()
  expect_identical(
    status$capacity[status$realm == "approval-atlas-test-realm"],
    1
  )
})

test_that("throttled_request throttles per host by default", {
  request <- throttled_request("https://host.example.org/a.json")
  expect_identical(request$policies$throttle_realm, "host.example.org")
})

test_that("throttled_request retries server errors but never 429", {
  request <- throttled_request("https://example.org/data.json")
  expect_identical(request$policies$retry_max_tries, 3)
  expect_true(request$policies$retry_on_failure)
  is_transient <- request$policies$retry_is_transient
  expect_true(is_transient(httr2::response(status_code = 500)))
  expect_true(is_transient(httr2::response(status_code = 503)))
  expect_false(is_transient(httr2::response(status_code = 429)))
  expect_false(is_transient(httr2::response(status_code = 404)))
  expect_false(is_transient(httr2::response(status_code = 200)))
})

test_that("download_to_file writes beside the destination and renames", {
  destination <- file.path(tempfile(), "sub", "file.json")
  requested <- new.env()
  testthat::local_mocked_bindings(
    req_perform = function(req, path = NULL, ...) {
      requested$path <- path
      writeLines("fresh", path)
      httr2::response(status_code = 200)
    },
    .package = "httr2"
  )
  response <- download_to_file(
    httr2::request("https://example.org/file.json"),
    destination
  )
  expect_identical(httr2::resp_status(response), 200L)
  expect_identical(readLines(destination), "fresh")
  expect_identical(
    normalizePath(dirname(requested$path)),
    normalizePath(dirname(destination))
  )
  expect_identical(list.files(dirname(destination)), "file.json")
})

test_that("download_to_file keeps the destination on 304 Not Modified", {
  destination <- file.path(tempfile(), "file.json")
  dir.create(dirname(destination))
  writeLines("cached", destination)
  httr2::local_mocked_responses(function(req) {
    httr2::response(status_code = 304)
  })
  response <- download_to_file(
    httr2::request("https://example.org/file.json"),
    destination
  )
  expect_identical(httr2::resp_status(response), 304L)
  expect_identical(readLines(destination), "cached")
  expect_identical(list.files(dirname(destination)), "file.json")
})

test_that("download_to_file keeps the destination when the request fails", {
  destination <- file.path(tempfile(), "file.json")
  dir.create(dirname(destination))
  writeLines("cached", destination)
  testthat::local_mocked_bindings(
    req_perform = function(req, path = NULL, ...) {
      writeLines("<html>error page</html>", path)
      stop("HTTP 500 Internal Server Error.")
    },
    .package = "httr2"
  )
  expect_error(
    download_to_file(httr2::request("https://example.org/f.json"), destination),
    "HTTP 500"
  )
  expect_identical(readLines(destination), "cached")
  expect_identical(list.files(dirname(destination)), "file.json")
})

test_that("download_to_file aborts when the rename fails", {
  destination <- file.path(tempfile(), "file.json")
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
    suppressWarnings(
      download_to_file(
        httr2::request("https://example.org/f.json"),
        destination
      )
    ),
    "Could not move the download"
  )
  expect_identical(list.files(dirname(destination)), "file.json")
})
