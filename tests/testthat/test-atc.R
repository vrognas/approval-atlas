json_response <- function(body) {
  httr2::response(
    status_code = 200,
    headers = list(`Content-Type` = "application/json"),
    body = charToRaw(
      jsonlite::toJSON(body, auto_unbox = TRUE, null = "null", na = "null")
    )
  )
}

# Stands in for httr2::req_perform(): serves ChEMBL's status and the fixture
# ATC rows split over two pages, and records every requested URL.
fake_chembl_server <- function(version = "ChEMBL_37", total_count = 5) {
  server <- new.env()
  server$urls <- character()
  server$user_agents <- character()
  server$perform <- function(req, path = NULL, ...) {
    server$urls <- c(server$urls, req$url)
    server$user_agents <- c(server$user_agents, req$options$useragent)
    if (grepl("status.json", req$url, fixed = TRUE)) {
      writeLines(
        jsonlite::toJSON(
          list(chembl_db_version = version, chembl_release_date = "2026-05-01"),
          auto_unbox = TRUE
        ),
        path
      )
      return(httr2::response(status_code = 200))
    }
    rows <- jsonlite::fromJSON(fixture_atc_class_path())
    is_first_page <- grepl("offset=0", req$url, fixed = TRUE)
    json_response(list(
      atc = if (is_first_page) rows[1:3, ] else rows[4:5, ],
      page_meta = list(
        limit = 1000,
        offset = if (is_first_page) 0 else 1000,
        total_count = total_count,
        `next` = if (is_first_page) {
          "/chembl/api/data/atc_class.json?limit=1000&offset=1000"
        }
      )
    ))
  }
  server
}

test_that("fetch_chembl_release downloads status.json, returns the release", {
  cache_directory <- file.path(tempfile(), "chembl")
  server <- fake_chembl_server()
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  expect_message(
    release <- fetch_chembl_release(cache_directory),
    "Checking the ChEMBL release"
  )
  expect_identical(release, "ChEMBL_37")
  expect_identical(server$urls, paste0(chembl_api_url, "status.json"))
  expect_match(server$user_agents, "approval-atlas", fixed = TRUE)
  expect_true(file.exists(file.path(cache_directory, "status.json")))
})

test_that("fetch_chembl_release reuses status.json for 24 hours", {
  cache_directory <- file.path(tempfile(), "chembl")
  dir.create(cache_directory, recursive = TRUE)
  writeLines(
    '{"chembl_db_version": "ChEMBL_36"}',
    file.path(cache_directory, "status.json")
  )
  testthat::local_mocked_bindings(
    req_perform = function(...) stop("network must not be used"),
    .package = "httr2"
  )
  expect_identical(fetch_chembl_release(cache_directory), "ChEMBL_36")
})

test_that("fetch_chembl_release refreshes a stale status.json", {
  cache_directory <- file.path(tempfile(), "chembl")
  dir.create(cache_directory, recursive = TRUE)
  status_path <- file.path(cache_directory, "status.json")
  writeLines('{"chembl_db_version": "ChEMBL_36"}', status_path)
  Sys.setFileTime(status_path, Sys.time() - 48 * 60 * 60)
  server <- fake_chembl_server(version = "ChEMBL_38")
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  expect_identical(
    suppressMessages(fetch_chembl_release(cache_directory)),
    "ChEMBL_38"
  )
})

test_that("fetch_chembl_release aborts on a release unfit for a folder", {
  cache_directory <- file.path(tempfile(), "chembl")
  dir.create(cache_directory, recursive = TRUE)
  status_path <- file.path(cache_directory, "status.json")
  writeLines('{"chembl_db_version": "../elsewhere"}', status_path)
  expect_error(fetch_chembl_release(cache_directory), "elsewhere")
  writeLines('{"status": "UP"}', status_path)
  expect_error(fetch_chembl_release(cache_directory), "chembl_db_version")
})

test_that("download_chembl_atc_classes pages through atc_class once", {
  cache_directory <- file.path(tempfile(), "chembl")
  server <- fake_chembl_server()
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  expect_message(
    path <- download_chembl_atc_classes("ChEMBL_37", cache_directory),
    "Downloading ChEMBL_37 ATC classes"
  )
  expect_identical(
    path,
    file.path(cache_directory, "ChEMBL_37", "atc_class.json")
  )
  expect_identical(
    server$urls,
    paste0(
      chembl_api_url,
      "atc_class.json?limit=1000&offset=",
      c("0", "1000")
    )
  )
  expect_identical(
    dplyr::as_tibble(jsonlite::fromJSON(path)),
    dplyr::as_tibble(jsonlite::fromJSON(fixture_atc_class_path()))
  )
  expect_identical(list.files(dirname(path)), "atc_class.json")
})

test_that("download_chembl_atc_classes reuses the file for the same release", {
  cache_directory <- file.path(tempfile(), "chembl")
  dir.create(file.path(cache_directory, "ChEMBL_37"), recursive = TRUE)
  file.copy(
    fixture_atc_class_path(),
    file.path(cache_directory, "ChEMBL_37", "atc_class.json")
  )
  testthat::local_mocked_bindings(
    req_perform = function(...) stop("network must not be used"),
    .package = "httr2"
  )
  expect_message(
    download_chembl_atc_classes("ChEMBL_37", cache_directory),
    "Using cached ChEMBL_37 ATC classes"
  )
})

test_that("download_chembl_atc_classes aborts when rows go missing", {
  cache_directory <- file.path(tempfile(), "chembl")
  server <- fake_chembl_server(total_count = 6)
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  expect_error(
    suppressMessages(download_chembl_atc_classes("ChEMBL_37", cache_directory)),
    "6"
  )
  expect_false(file.exists(
    file.path(cache_directory, "ChEMBL_37", "atc_class.json")
  ))
})

test_that("build_atc_classes lists each level once with verbatim names", {
  classes <- build_atc_classes(jsonlite::fromJSON(fixture_atc_class_path()))
  expect_named(classes, c("atc_code", "level", "name", "source"))
  expect_identical(nrow(classes), 24L)
  expect_identical(
    classes$atc_code,
    sort(classes$atc_code, method = "radix")
  )
  expect_identical(anyDuplicated(classes$atc_code), 0L)
  row_for <- function(code) classes[classes$atc_code == code, ]
  expect_identical(
    row_for("A"),
    dplyr::tibble(
      atc_code = "A",
      level = 1L,
      name = "ALIMENTARY TRACT AND METABOLISM",
      source = "chembl_atc_class"
    )
  )
  expect_identical(row_for("A10")$level, 2L)
  expect_identical(row_for("L01F")$level, 3L)
  expect_identical(
    row_for("L01FA")$name,
    "CD20 (Clusters of Differentiation 20) inhibitors"
  )
  expect_identical(row_for("L01FA01")$level, 5L)
  expect_identical(row_for("L01FA01")$name, "rituximab")
  expect_identical(row_for("N07BC51")$name, "buprenorphine, combinations")
})

test_that("build_atc_classes aborts when a code has two names", {
  rows <- jsonlite::fromJSON(fixture_atc_class_path())
  rows$level2_description[rows$level2 == "L04"] <- "IMMUNOSUPPRESSANTS (NEW)"
  rows <- rbind(rows, rows[rows$level2 == "L04", ])
  rows$level2_description[nrow(rows)] <- "IMMUNOSUPPRESSANTS"
  rows$level5[nrow(rows)] <- "L04AG99"
  error <- expect_error(build_atc_classes(rows), class = "rlang_error")
  expect_match(conditionMessage(error), "L04")
})

test_that("atc_code_level recognises the five ATC levels", {
  expect_identical(
    atc_code_level(c("L", "L01", "L01F", "L01FA", "L01FA01")),
    1:5
  )
})

test_that("atc_code_level returns NA for invalid codes", {
  expect_identical(
    atc_code_level(c("LX1XX02", "VO4D", "l01", "L01FA011", "", NA)),
    rep(NA_integer_, 6)
  )
})

test_that("build_atc_codes_table flags incomplete codes and sets the source", {
  clean_medicines <- dplyr::tibble(
    ema_product_number = c("A", "B", "C", "D", "E"),
    atc_code_human = c(
      "L01XE",
      "A10AB04;A10AD04",
      "Not yet assigned",
      "LX1XX02",
      NA
    )
  )
  expect_identical(
    build_atc_codes_table(clean_medicines),
    dplyr::tibble(
      ema_product_number = c("A", "B", "B", "D"),
      atc_code_human = c("L01XE", "A10AB04", "A10AD04", "LX1XX02"),
      atc_level = c(4L, 5L, 5L, NA),
      atc_incomplete = c(TRUE, FALSE, FALSE, TRUE),
      source = "ema"
    )
  )
})

test_that("build_atc_codes_table keeps the M1 rows on real EMA records", {
  clean_medicines <- clean_ema_medicines(read_fixture_ema()$data)
  atc_codes <- build_atc_codes_table(clean_medicines)
  expect_identical(
    atc_codes[c("ema_product_number", "atc_code_human")],
    build_lookup_table(clean_medicines, "atc_code_human", "Not yet assigned")
  )
  bimzelx <- atc_codes[atc_codes$ema_product_number == "EMEA/H/C/005316", ]
  expect_identical(bimzelx$atc_level, 4L)
  expect_true(bimzelx$atc_incomplete)
})
