copy_fixture_to_cache <- function() {
  cache_path <- file.path(tempfile(), "medicines.json")
  dir.create(dirname(cache_path))
  file.copy(fixture_ema_path(), cache_path)
  cache_path
}

write_modified_fixture <- function(modify) {
  ema <- read_fixture_ema()
  ema <- modify(ema)
  cache_path <- file.path(tempfile(), "medicines.json")
  dir.create(dirname(cache_path))
  jsonlite::write_json(ema, cache_path, auto_unbox = TRUE, dataframe = "rows")
  cache_path
}

output_stems <- c(
  "ema_medicines",
  "ema_medicine_therapeutic_areas",
  "ema_medicine_active_substances",
  "ema_medicine_atc_codes"
)

test_that("run_ema_pipeline writes four tables and meta.json from the cache", {
  output_directory <- file.path(tempfile(), "data")
  tables <- suppressMessages(run_ema_pipeline(
    output_directory = output_directory,
    cache_path = copy_fixture_to_cache()
  ))
  expect_named(tables, output_stems)
  expect_setequal(
    list.files(output_directory),
    c(paste0(output_stems, ".json"), "meta.json")
  )
  expect_identical(nrow(tables$ema_medicines), 19L)

  meta <- jsonlite::fromJSON(file.path(output_directory, "meta.json"))
  expect_identical(meta$source_url, ema_medicines_url)
  expect_identical(meta$source_timestamp, "2026-09-26T06:02:29Z")
  expect_identical(
    meta$row_counts,
    lapply(tables, nrow)
  )
})

test_that("run_ema_pipeline returns the tables invisibly", {
  expect_invisible(suppressMessages(run_ema_pipeline(
    output_directory = file.path(tempfile(), "data"),
    cache_path = copy_fixture_to_cache()
  )))
})

test_that("run_ema_pipeline reports each written file with its row count", {
  output_directory <- file.path(tempfile(), "data")
  messages <- testthat::capture_messages(run_ema_pipeline(
    output_directory = output_directory,
    cache_path = copy_fixture_to_cache()
  ))
  expect_match(messages, "Using cached EMA data", all = FALSE)
  expect_match(messages, "ema_medicines\\.json.*: 19 rows", all = FALSE)
  expect_match(messages, "meta\\.json.*EMA data as of", all = FALSE)
})

test_that("run_ema_pipeline output follows the data contract", {
  output_directory <- file.path(tempfile(), "data")
  suppressMessages(run_ema_pipeline(
    output_directory = output_directory,
    cache_path = copy_fixture_to_cache()
  ))
  read_output <- function(stem) {
    jsonlite::fromJSON(file.path(output_directory, paste0(stem, ".json")))
  }
  medicines <- read_output("ema_medicines")
  expect_false(any(unlist(medicines) == "", na.rm = TRUE))
  expect_type(medicines$generic, "logical")
  expect_type(medicines$revision_number, "integer")
  expect_true(all(
    grepl("^\\d{4}-\\d{2}-\\d{2}$", medicines$marketing_authorisation_date) |
      is.na(medicines$marketing_authorisation_date)
  ))
  for (stem in output_stems[-1]) {
    lookup <- read_output(stem)
    expect_in(lookup$ema_product_number, medicines$ema_product_number)
    expect_false(any(unlist(lookup) == ""))
  }
  raw_text <- unlist(lapply(
    list.files(output_directory, full.names = TRUE),
    readLines,
    warn = FALSE,
    encoding = "UTF-8"
  ))
  expect_no_match(raw_text, ":\"\"", fixed = TRUE)
})

test_that("run_ema_pipeline aborts before writing when source checks fail", {
  cache_path <- write_modified_fixture(function(ema) {
    ema$meta$total_records <- 999
    ema
  })
  output_directory <- file.path(tempfile(), "data")
  expect_error(
    suppressMessages(run_ema_pipeline(
      output_directory = output_directory,
      cache_path = cache_path
    )),
    "999"
  )
  expect_false(dir.exists(output_directory))
})

test_that("run_ema_pipeline aborts before writing when table checks fail", {
  cache_path <- write_modified_fixture(function(ema) {
    ema$data$ema_product_number[2] <- ema$data$ema_product_number[1]
    ema
  })
  output_directory <- file.path(tempfile(), "data")
  expect_error(
    suppressMessages(run_ema_pipeline(
      output_directory = output_directory,
      cache_path = cache_path
    )),
    "ema_product_number"
  )
  expect_false(dir.exists(output_directory))
})
