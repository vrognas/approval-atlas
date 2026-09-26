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

# Stands in for httr2::req_perform(): records requests and answers with the
# given status and headers.
fake_source_server <- function(status = 200,
                               headers = list(
                                 ETag = "\"42\"",
                                 `Last-Modified` =
                                   "Fri, 25 Sep 2026 15:36:55 GMT"
                               )) {
  server <- new.env()
  server$requests <- list()
  server$perform <- function(req, path = NULL, ...) {
    server$requests <- c(server$requests, list(req))
    if (status == 200) {
      writeLines("fresh", path)
    }
    httr2::response(status_code = status, headers = headers)
  }
  server
}

seed_source_cache <- function(url = "https://example.org/data.json",
                              etag = "\"41\"",
                              age_hours = 0) {
  destination <- file.path(tempfile(), "data.json")
  dir.create(dirname(destination))
  writeLines("cached", destination)
  sidecar_path <- file.path(dirname(destination), "source.json")
  jsonlite::write_json(
    list(
      url = url,
      etag = etag,
      last_modified = "Thu, 24 Sep 2026 10:00:00 GMT",
      retrieved = "2026-09-24T10:05:00Z"
    ),
    sidecar_path,
    auto_unbox = TRUE,
    na = "null"
  )
  Sys.setFileTime(sidecar_path, Sys.time() - age_hours * 60 * 60)
  destination
}

test_that("download_cached_source downloads and records the validators", {
  destination <- file.path(tempfile(), "sub", "data.json")
  server <- fake_source_server()
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  expect_message(
    source <- download_cached_source(
      "https://example.org/data.json",
      destination,
      label = "example data"
    ),
    "Downloading example data"
  )
  expect_identical(readLines(destination), "fresh")
  expect_length(server$requests, 1)
  expect_null(server$requests[[1]]$headers[["If-None-Match"]])
  expect_null(server$requests[[1]]$headers[["If-Modified-Since"]])
  expect_identical(source$url, "https://example.org/data.json")
  expect_identical(source$path, destination)
  expect_identical(source$etag, "\"42\"")
  expect_identical(source$last_modified, "Fri, 25 Sep 2026 15:36:55 GMT")
  expect_match(
    source$retrieved,
    "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$"
  )
  sidecar <- jsonlite::fromJSON(file.path(dirname(destination), "source.json"))
  expect_identical(sidecar$etag, "\"42\"")
  expect_identical(sidecar$retrieved, source$retrieved)
  expect_setequal(
    list.files(dirname(destination)),
    c("data.json", "source.json")
  )
})

test_that("download_cached_source skips the network within the maximum age", {
  destination <- seed_source_cache(age_hours = 2)
  testthat::local_mocked_bindings(
    req_perform = function(...) stop("network must not be used"),
    .package = "httr2"
  )
  expect_message(
    source <- download_cached_source(
      "https://example.org/data.json",
      destination,
      label = "example data"
    ),
    "Using cached example data"
  )
  expect_identical(readLines(destination), "cached")
  expect_identical(source$etag, "\"41\"")
  expect_identical(source$retrieved, "2026-09-24T10:05:00Z")
  expect_identical(source$path, destination)
})

test_that("a stale check sends both validators and keeps a 304", {
  destination <- seed_source_cache(age_hours = 30)
  sidecar_path <- file.path(dirname(destination), "source.json")
  server <- fake_source_server(status = 304, headers = list())
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  messages <- testthat::capture_messages(
    source <- download_cached_source(
      "https://example.org/data.json",
      destination,
      label = "example data"
    )
  )
  expect_match(messages, "Checking example data for changes", all = FALSE)
  expect_match(messages, "example data unchanged", all = FALSE)
  headers <- server$requests[[1]]$headers
  expect_identical(headers[["If-None-Match"]], "\"41\"")
  expect_identical(
    headers[["If-Modified-Since"]],
    "Thu, 24 Sep 2026 10:00:00 GMT"
  )
  expect_identical(readLines(destination), "cached")
  expect_identical(source$etag, "\"41\"")
  expect_identical(source$retrieved, "2026-09-24T10:05:00Z")
  expect_true(is_recent_file(sidecar_path, 1))
})

test_that("a stale check replaces the file when the source changed", {
  destination <- seed_source_cache(age_hours = 30)
  server <- fake_source_server()
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  source <- suppressMessages(download_cached_source(
    "https://example.org/data.json",
    destination
  ))
  expect_identical(readLines(destination), "fresh")
  expect_identical(source$etag, "\"42\"")
  expect_false(identical(source$retrieved, "2026-09-24T10:05:00Z"))
})

test_that("an unknown validator is not sent and is stored as null", {
  destination <- seed_source_cache(etag = NA_character_, age_hours = 30)
  server <- fake_source_server(
    headers = list(`Last-Modified` = "Sat, 26 Sep 2026 16:10:39 GMT")
  )
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  source <- suppressMessages(download_cached_source(
    "https://example.org/data.json",
    destination
  ))
  expect_null(server$requests[[1]]$headers[["If-None-Match"]])
  expect_identical(
    server$requests[[1]]$headers[["If-Modified-Since"]],
    "Thu, 24 Sep 2026 10:00:00 GMT"
  )
  expect_identical(source$etag, NA_character_)
  sidecar_text <- readLines(file.path(dirname(destination), "source.json"))
  expect_match(sidecar_text, "\"etag\":null", fixed = TRUE)
})

test_that("a cache from another URL is downloaded again unconditionally", {
  destination <- seed_source_cache(
    url = "https://example.org/old.json",
    age_hours = 2
  )
  server <- fake_source_server()
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  suppressMessages(download_cached_source(
    "https://example.org/data.json",
    destination
  ))
  expect_length(server$requests, 1)
  expect_null(server$requests[[1]]$headers[["If-None-Match"]])
  expect_identical(readLines(destination), "fresh")
})

test_that("download_cached_source uses the request it is given", {
  destination <- file.path(tempfile(), "data.json")
  server <- fake_source_server()
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  suppressMessages(download_cached_source(
    "https://example.org/data.json",
    destination,
    request = throttled_request(
      "https://example.org/data.json",
      realm = "approval-atlas-test-realm"
    )
  ))
  expect_identical(
    server$requests[[1]]$policies$throttle_realm,
    "approval-atlas-test-realm"
  )
})

test_that("the daily sources are checked again 21 hours later", {
  # CI restores the cached sidecars with their old modification times.
  server <- fake_source_server(status = 304)
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  daily_sources <- list(
    list(download_epar_documents, epar_documents_url, "epar_documents.json"),
    list(
      download_orphan_designations,
      ema_orphan_designations_url,
      "orphan_designations.json"
    ),
    list(download_union_register, union_register_url, "ods_products.json")
  )
  for (daily_source in daily_sources) {
    cached_path <- seed_source_cache(daily_source[[2]], age_hours = 21)
    file.rename(
      cached_path,
      file.path(dirname(cached_path), daily_source[[3]])
    )
    suppressMessages(daily_source[[1]](dirname(cached_path)))
  }
  expect_length(server$requests, 3)
})
