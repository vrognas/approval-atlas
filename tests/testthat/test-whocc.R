test_that("whocc_request throttles the WHOCC site in its own realm", {
  request <- whocc_request(whocc_index_url("L04AL"))
  expect_identical(request$policies$throttle_realm, "atcddd.fhi.no")
  expect_identical(
    request$url,
    "https://atcddd.fhi.no/atc_ddd_index/?code=L04AL&showdescription=no"
  )
  expect_identical(
    whocc_updates_url(2026),
    paste0(
      "https://atcddd.fhi.no/filearchive/documents/",
      "atc_ddd_new_and_alterations_2026_final.xlsx"
    )
  )
})

test_that("read_whocc_updates reads new codes of the yearly list", {
  classes <- read_whocc_updates(
    fixture_whocc_updates_path(),
    whocc_updates_url(2026),
    "current"
  )
  expect_named(
    classes,
    c("atc_code", "level", "name", "status", "source", "source_url")
  )
  expect_identical(nrow(classes), 99L)
  expect_identical(anyDuplicated(classes$atc_code), 0L)
  row_for <- function(code) classes[classes$atc_code == code, ]
  expect_identical(
    row_for("L04AL"),
    dplyr::tibble(
      atc_code = "L04AL",
      level = 4L,
      name = "Neonatal fragment crystallizable receptor (FcRn) inhibitors",
      status = "current",
      source = "whocc_updates",
      source_url = whocc_updates_url(2026)
    )
  )
  # The sheet has a zero-width space after this name.
  expect_identical(
    row_for("L01EP")$name,
    paste(
      "Cellular-mesenchymal-epithelial transition factor (c-MET) kinase",
      "inhibitors"
    )
  )
  expect_identical(row_for("A02BC12")$name, "zastaprazan")
  expect_identical(row_for("A02BC12")$level, 5L)
})

test_that("read_whocc_updates reads the temporary list", {
  classes <- read_whocc_updates(
    fixture_whocc_temporary_path(),
    whocc_temporary_url,
    "temporary"
  )
  expect_identical(nrow(classes), 78L)
  expect_identical(unique(classes$status), "temporary")
  expect_identical(
    classes$name[classes$atc_code == "M05BD"],
    "C-type natriuretic peptide (CNP) analogues"
  )
  expect_identical(
    classes$name[classes$atc_code == "A10AE08"],
    "insulin efsitora alfa"
  )
})

test_that("read_whocc_sheet aborts when a sheet or its header is missing", {
  expect_error(
    read_whocc_sheet(fixture_whocc_updates_path(), "^New ATC 6th levels$"),
    "Sheets"
  )
  expect_error(
    read_whocc_sheet(fixture_whocc_temporary_path(), "^Heading$"),
    "no ATC code column"
  )
})

test_that("check_atc_code_format lists invalid codes", {
  expect_error(
    check_atc_code_format(c("L04AL", "L04 AL", "x"), "A test list"),
    "L04 AL"
  )
  expect_identical(check_atc_code_format("L04AL", "A test list"), "L04AL")
})

test_that("read_whocc_alterations reads codes, names, years and notes", {
  alterations <- read_whocc_alterations(fixture_whocc_alterations_path())
  expect_named(
    alterations,
    c(
      "previous_code", "substance_name", "previous_name", "new_code",
      "changed_year", "keeps_previous"
    )
  )
  expect_identical(nrow(alterations), 23L)
  row_for <- function(code) alterations[alterations$previous_code == code, ]
  expect_identical(
    row_for("L01XE01"),
    dplyr::tibble(
      previous_code = "L01XE01",
      substance_name = "imatinib",
      previous_name = NA_character_,
      new_code = "L01EA01",
      changed_year = 2021L,
      keeps_previous = FALSE
    )
  )
  expect_identical(
    row_for("A12AA12")$previous_name,
    "calcium acetate anhydrous"
  )
  expect_identical(row_for("A12AA12")$substance_name, "calcium acetate")
  expect_identical(row_for("J07BX07")$new_code, NA_character_)
  expect_identical(row_for("B03AC01")$new_code, "B03AC")
  expect_identical(row_for("N01AX01")$new_code, "N05AD08")
  expect_identical(row_for("A01AD02")$keeps_previous, TRUE)
  expect_identical(row_for("G03AC03")$keeps_previous, TRUE)
  expect_identical(row_for("R03CA02")$keeps_previous, TRUE)
  expect_identical(unique(row_for("C07FB02")$keeps_previous), TRUE)
  expect_identical(row_for("B03AC01")$keeps_previous, FALSE)
  expect_identical(row_for("B02BD09")$keeps_previous, FALSE)
})

test_that("read_whocc_alterations aborts on a page without alterations", {
  path <- tempfile(fileext = ".html")
  writeLines("<html><body><div id=\"content\"></div></body></html>", path)
  expect_error(read_whocc_alterations(path), "no alteration rows")
})

test_that("build_retired_atc_codes resolves whole moves and keeps splits", {
  retired <- build_retired_atc_codes(
    read_whocc_alterations(fixture_whocc_alterations_path())
  )
  expect_named(
    retired,
    c(
      "atc_code", "level", "name", "replaced_by", "changed_year", "source",
      "source_url", "replacement_source"
    )
  )
  row_for <- function(code) retired[retired$atc_code == code, ]
  expect_identical(
    row_for("L01XX28"),
    dplyr::tibble(
      atc_code = "L01XX28",
      level = 5L,
      name = "imatinib",
      replaced_by = "L01EA01",
      changed_year = 2007L,
      source = "whocc_alterations",
      source_url = whocc_alterations_url,
      replacement_source = "whocc_alterations"
    )
  )
  expect_identical(row_for("L01XE01")$replaced_by, "L01EA01")
  expect_identical(row_for("L01XC04")$replaced_by, "L04AA34")
  expect_identical(row_for("J07BX07")$replaced_by, NA_character_)
  expect_identical(row_for("J07BX07")$changed_year, 2026L)
  expect_identical(row_for("B03AC01")$replaced_by, "B03AC")
  expect_identical(row_for("A12AA12")$name, "calcium acetate anhydrous")
  expect_identical(row_for("L01XE")$name, "Protein kinase inhibitors")
  expect_identical(row_for("L01XE")$source, "whocc_index_archived")
  expect_identical(row_for("L01XE")$replacement_source, "curated")
  expect_identical(row_for("L01XC")$replaced_by, "L01F")
  kept_in_use <- c(
    "A01AD02", "C07FB02", "G03AC03", "N02AA59", "R03AK07", "R03CA02"
  )
  expect_false(any(kept_in_use %in% retired$atc_code))
  expect_identical(anyDuplicated(retired$atc_code), 0L)
})

test_that("the curated retired level-4 names are the archived WHO names", {
  expect_identical(
    curated_retired_atc_levels[c("atc_code", "name")],
    dplyr::tibble(
      atc_code = c("L01XC", "L01XE"),
      name = c("Monoclonal antibodies", "Protein kinase inhibitors")
    )
  )
  expect_match(
    curated_retired_atc_levels$source_url,
    "^https://web\\.archive\\.org/web/2020"
  )
})

test_that("read_whocc_index_page reads the path and the table", {
  page <- read_whocc_index_page(fixture_whocc_index_path("L04AL"))
  expect_identical(page$index_version, "2026-01-20")
  expect_identical(
    page$classes,
    dplyr::tibble(
      atc_code = c(
        "L", "L04", "L04A", "L04AL", "L04AL01", "L04AL02", "L04AL03"
      ),
      name = c(
        "ANTINEOPLASTIC AND IMMUNOMODULATING AGENTS",
        "IMMUNOSUPPRESSANTS",
        "IMMUNOSUPPRESSANTS",
        "Neonatal fragment crystallizable receptor (FcRn) inhibitors",
        "efgartigimod alfa",
        "rozanolixizumab",
        "nipocalimab"
      )
    )
  )
})

test_that("read_whocc_index_page has no row for retired or unknown codes", {
  retired <- read_whocc_index_page(fixture_whocc_index_path("L01XE"))
  expect_identical(retired$classes$atc_code, c("L", "L01", "L01X"))
  unknown <- read_whocc_index_page(
    read_fixture_bytes(fixture_whocc_index_path("L04AC28"))
  )
  expect_identical(nrow(unknown$classes), 0L)
  expect_identical(unknown$index_version, "2026-01-20")
})

test_that("read_whocc_index_page aborts on a page without its content", {
  expect_error(
    read_whocc_index_page("<html><body><p>Maintenance</p></body></html>"),
    "no content or date"
  )
})

test_that("whocc_index_page_code asks for a level-5 code's parent", {
  expect_identical(
    whocc_index_page_code(c("L04AL02", "B03AC", "L")),
    c("L04AL", "B03AC", "L")
  )
})

# Stands in for fetch_whocc_index_page(): serves the fixture pages and
# records the pages asked for.
fake_whocc_index <- function() {
  index <- new.env()
  index$pages <- character()
  index$fetch <- function(page) {
    index$pages <- c(index$pages, page)
    path <- fixture_whocc_index_path(page)
    if (!file.exists(path)) {
      path <- fixture_whocc_index_path("L04AC28")
    }
    read_fixture_bytes(path)
  }
  index
}

test_that("update_whocc_index_cache fetches each missing page once", {
  cache_directory <- file.path(tempfile(), "index")
  index <- fake_whocc_index()
  testthat::local_mocked_bindings(fetch_whocc_index_page = index$fetch)
  requests <- suppressMessages(update_whocc_index_cache(
    c("L04AL01", "L04AL02", "L04AL", "L04AC28"),
    cache_directory,
    today = as.Date("2026-09-27")
  ))
  expect_identical(requests, 2L)
  expect_identical(index$pages, c("L04AL", "L04AC"))
  classes <- read_whocc_index_classes(cache_directory)
  expect_identical(
    classes[classes$atc_code == "L04AL02", ],
    dplyr::tibble(
      atc_code = "L04AL02",
      level = 5L,
      name = "rozanolixizumab",
      status = "current",
      source = "whocc_index",
      source_url = whocc_index_url("L04AL02")
    )
  )
  expect_false("L04AC28" %in% classes$atc_code)

  again <- suppressMessages(update_whocc_index_cache(
    c("L04AL02", "L04AC28"),
    cache_directory,
    today = as.Date("2026-12-31")
  ))
  expect_identical(again, 0L)
  expect_length(index$pages, 2)
})

test_that("update_whocc_index_cache refetches last year's pages monthly", {
  cache_directory <- file.path(tempfile(), "index")
  index <- fake_whocc_index()
  testthat::local_mocked_bindings(fetch_whocc_index_page = index$fetch)
  suppressMessages(update_whocc_index_cache(
    "L04AL02",
    cache_directory,
    today = as.Date("2027-01-05")
  ))
  expect_identical(
    suppressMessages(update_whocc_index_cache(
      "L04AL02",
      cache_directory,
      today = as.Date("2027-01-25")
    )),
    0L
  )
  expect_identical(
    suppressMessages(update_whocc_index_cache(
      "L04AL02",
      cache_directory,
      today = as.Date("2027-02-10")
    )),
    1L
  )
})

test_that("update_whocc_index_cache stops at the page limit or a failure", {
  cache_directory <- file.path(tempfile(), "index")
  index <- fake_whocc_index()
  testthat::local_mocked_bindings(fetch_whocc_index_page = index$fetch)
  expect_identical(
    suppressMessages(update_whocc_index_cache(
      c("A", "B", "C"),
      cache_directory,
      max_pages = 2L
    )),
    2L
  )
  expect_identical(index$pages, c("A", "B"))

  testthat::local_mocked_bindings(fetch_whocc_index_page = function(page) NULL)
  expect_identical(
    suppressMessages(update_whocc_index_cache(c("D", "E"), cache_directory)),
    1L
  )
  expect_setequal(
    list.files(cache_directory),
    c("A.json", "B.json")
  )
})

test_that("fetch_whocc_index_page returns the body or warns and gives NULL", {
  status <- 200
  testthat::local_mocked_bindings(
    req_perform = function(req, ...) {
      httr2::response(
        status_code = status,
        body = read_fixture_bytes(fixture_whocc_index_path("L04AL"))
      )
    },
    .package = "httr2"
  )
  expect_identical(
    fetch_whocc_index_page("L04AL"),
    read_fixture_bytes(fixture_whocc_index_path("L04AL"))
  )
  status <- 429
  expect_warning(
    expect_null(fetch_whocc_index_page("L04AL")),
    "HTTP 429"
  )
})

httr2_failure <- function(message = "Timeout was reached") {
  structure(
    class = c("httr2_failure", "httr2_error", "error", "condition"),
    list(message = message, call = NULL)
  )
}

test_that("update_whocc_index_cache stops with a warning on network failure", {
  cache_directory <- file.path(tempfile(), "index")
  testthat::local_mocked_bindings(
    req_perform = function(...) stop(httr2_failure()),
    .package = "httr2"
  )
  expect_warning(
    requests <- suppressMessages(update_whocc_index_cache(
      c("L04AL02", "L04AC28"),
      cache_directory
    )),
    "Timeout was reached"
  )
  expect_identical(requests, 1L)
  expect_length(list.files(cache_directory), 0)
})

test_that("read_whocc_index_classes prefers the newest index version", {
  cache_directory <- file.path(tempfile(), "index")
  dir.create(cache_directory, recursive = TRUE)
  write_page <- function(page, version, name) {
    jsonlite::write_json(
      list(
        page = page,
        url = whocc_index_url(page),
        index_version = version,
        retrieved = "2026-09-27",
        classes = dplyr::tibble(atc_code = "L04AL", name = name)
      ),
      file.path(cache_directory, paste0(page, ".json")),
      auto_unbox = TRUE
    )
  }
  write_page("L04A", "2025-01-20", "Old name")
  write_page("L04AL", "2026-01-20", "New name")
  expect_identical(
    read_whocc_index_classes(cache_directory)$name,
    "New name"
  )
})

# Stands in for httr2::req_perform(): 404 for the given URLs, else a file.
fake_whocc_server <- function(missing_urls = character()) {
  server <- new.env()
  server$urls <- character()
  server$perform <- function(req, path = NULL, ...) {
    server$urls <- c(server$urls, req$url)
    if (req$url %in% missing_urls) {
      stop(structure(
        class = c("httr2_http_404", "httr2_http", "error", "condition"),
        list(message = "HTTP 404 Not Found.", call = NULL)
      ))
    }
    file.copy(fixture_whocc_updates_path(), path, overwrite = TRUE)
    httr2::response(
      status_code = 200,
      headers = list(`Last-Modified` = "Tue, 20 Jan 2026 08:00:00 GMT")
    )
  }
  server
}

test_that("download_whocc_updates falls back to last year's list", {
  cache_directory <- file.path(tempfile(), "whocc")
  server <- fake_whocc_server(missing_urls = whocc_updates_url(2027))
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  messages <- testthat::capture_messages(
    source <- download_whocc_updates(cache_directory, year = 2027L)
  )
  expect_match(
    messages,
    "No WHOCC ATC/DDD updates for 2027 yet; using 2026",
    all = FALSE
  )
  expect_identical(server$urls, whocc_updates_url(c(2027, 2026)))
  expect_identical(source$year, 2026L)
  expect_identical(source$url, whocc_updates_url(2026))
  expect_true(file.exists(source$path))
})

test_that("the WHOCC lists are checked daily, the alterations monthly", {
  cache_directory <- file.path(tempfile(), "whocc")
  seed_whocc_downloads(cache_directory)
  alterations_sidecar <- file.path(
    cache_directory,
    "alterations",
    "source.json"
  )
  Sys.setFileTime(alterations_sidecar, Sys.time() - 29 * 24 * 60 * 60)
  forbid_network()
  expect_message(
    download_whocc_alterations(cache_directory),
    "Using cached WHOCC ATC alterations"
  )
  expect_message(
    download_whocc_temporary(cache_directory),
    "Using cached WHOCC temporary ATC codes"
  )
  expect_identical(
    suppressMessages(download_whocc_updates(cache_directory))$year,
    current_year()
  )

  Sys.setFileTime(alterations_sidecar, Sys.time() - 31 * 24 * 60 * 60)
  server <- fake_whocc_server()
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  suppressMessages(download_whocc_alterations(cache_directory))
  expect_identical(server$urls, whocc_alterations_url)
})

test_that("an unreachable WHOCC site falls back to the cached copies", {
  cache_directory <- file.path(tempfile(), "whocc")
  seed_whocc_downloads(cache_directory)
  sidecars <- list.files(
    cache_directory,
    "source.json",
    recursive = TRUE,
    full.names = TRUE
  )
  Sys.setFileTime(sidecars, Sys.time() - 40 * 24 * 60 * 60)
  testthat::local_mocked_bindings(
    req_perform = function(...) {
      stop(structure(
        class = c("httr2_http_500", "httr2_http", "httr2_error", "error",
                  "condition"),
        list(message = "HTTP 500 Internal Server Error.", call = NULL)
      ))
    },
    .package = "httr2"
  )
  expect_warning(
    temporary <- suppressMessages(download_whocc_temporary(cache_directory)),
    "HTTP 500.*copy retrieved 2026-09-27T16:53:55Z"
  )
  expect_identical(temporary$url, whocc_temporary_url)
  expect_identical(
    temporary$path,
    file.path(cache_directory, "temporary", "temporary_atc_and_ddd.xlsx")
  )
  expect_warning(
    updates <- suppressMessages(download_whocc_updates(cache_directory)),
    "WHOCC ATC/DDD updates"
  )
  expect_identical(updates$year, current_year())
  expect_true(file.exists(updates$path))
  expect_warning(
    alterations <- suppressMessages(
      download_whocc_alterations(cache_directory)
    ),
    "WHOCC ATC alterations"
  )
  expect_identical(alterations$url, whocc_alterations_url)
})

test_that("an unreachable WHOCC site without cached copies gives no source", {
  cache_directory <- file.path(tempfile(), "whocc")
  testthat::local_mocked_bindings(
    req_perform = function(...) stop(httr2_failure()),
    .package = "httr2"
  )
  expect_warning(
    expect_null(suppressMessages(download_whocc_alterations(cache_directory))),
    "Timeout was reached.*no cached copy"
  )
  expect_warning(
    expect_null(suppressMessages(download_whocc_updates(cache_directory))),
    "no cached copy"
  )
  expect_warning(
    expect_null(suppressMessages(download_whocc_temporary(cache_directory))),
    "no cached copy"
  )
})

test_that("read_whocc_sources reads the cached lists", {
  cache_directory <- file.path(tempfile(), "whocc")
  seed_whocc_downloads(cache_directory)
  forbid_network()
  sources <- suppressMessages(read_whocc_sources(cache_directory))
  expect_identical(sources$updates_source$year, current_year())
  expect_identical(nrow(sources$final_classes), 99L)
  expect_identical(unique(sources$final_classes$status), "current")
  expect_identical(nrow(sources$temporary_classes), 78L)
  expect_identical(unique(sources$temporary_classes$status), "temporary")
  expect_identical(
    sources$retired_codes$replaced_by[
      sources$retired_codes$atc_code == "L01XX28"
    ],
    "L01EA01"
  )
})

test_that("read_whocc_sources keeps only the curated codes without WHOCC", {
  testthat::local_mocked_bindings(
    req_perform = function(...) stop(httr2_failure()),
    .package = "httr2"
  )
  warnings <- testthat::capture_warnings(
    sources <- suppressMessages(read_whocc_sources(tempfile()))
  )
  expect_length(warnings, 3)
  expect_null(sources$updates_source)
  expect_null(sources$temporary_source)
  expect_null(sources$alterations_source)
  expect_identical(sources$final_classes, empty_whocc_classes())
  expect_identical(sources$temporary_classes, empty_whocc_classes())
  expect_identical(sources$retired_codes$atc_code, c("L01XC", "L01XE"))
})

test_that("a WHOCC list that fails to parse still stops the build", {
  cache_directory <- file.path(tempfile(), "whocc")
  seed_whocc_downloads(cache_directory)
  writeLines(
    "<html><body></body></html>",
    file.path(cache_directory, "alterations", "atc_alterations.html")
  )
  forbid_network()
  expect_error(
    suppressMessages(read_whocc_sources(cache_directory)),
    "no alteration rows"
  )
})

test_that("whocc_index_source_entry counts cached pages", {
  cache_directory <- file.path(tempfile(), "index")
  empty <- whocc_index_source_entry(cache_directory)
  expect_identical(empty$pages, 0L)
  expect_identical(empty$version, NA_character_)
  testthat::local_mocked_bindings(
    fetch_whocc_index_page = fake_whocc_index()$fetch
  )
  suppressMessages(update_whocc_index_cache(
    "L04AL02",
    cache_directory,
    today = as.Date("2026-09-27")
  ))
  entry <- whocc_index_source_entry(cache_directory)
  expect_identical(entry$pages, 1L)
  expect_identical(entry$version, "2026-01-20")
  expect_identical(entry$retrieved, "2026-09-27")
  expect_match(entry$licence, "no commercial distribution", fixed = TRUE)
  expect_match(entry$attribution, "L01XC and L01XE", fixed = TRUE)
})

test_that("read_whocc_alterations aborts on a row without a year", {
  path <- tempfile(fileext = ".html")
  writeLines(
    paste0(
      "<html><body><div class=\"listtable\"><table>",
      "<tr><td>L01XE01</td><td>imatinib</td><td>L01EA01</td><td>n/a</td></tr>",
      "</table></div></body></html>"
    ),
    path
  )
  expect_error(read_whocc_alterations(path), "without a year")
})
