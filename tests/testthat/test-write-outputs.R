test_that("write_json_table writes rows with nulls, ISO dates, plain types", {
  data <- dplyr::tibble(
    ema_product_number = c("EMEA/H/C/000001", "EMEA/H/C/000002"),
    name_of_medicine = c("Taï", NA),
    marketing_authorisation_date = as.Date(c("2023-09-22", NA)),
    generic = c(TRUE, FALSE),
    revision_number = c(12L, NA)
  )
  path <- tempfile(fileext = ".json")
  write_json_table(data, path)

  rows <- jsonlite::fromJSON(path, simplifyVector = FALSE)
  expect_length(rows, 2)
  expect_identical(names(rows[[2]]), names(data))
  expect_identical(rows[[1]]$name_of_medicine, "Taï")
  expect_identical(rows[[1]]$marketing_authorisation_date, "2023-09-22")
  expect_identical(rows[[1]]$generic, TRUE)
  expect_identical(rows[[1]]$revision_number, 12L)
  expect_null(rows[[2]]$name_of_medicine)
  expect_null(rows[[2]]$marketing_authorisation_date)
  expect_null(rows[[2]]$revision_number)

  text <- readLines(path, encoding = "UTF-8", warn = FALSE)
  expect_match(text, "\"name_of_medicine\":null", fixed = TRUE)
  expect_no_match(text, "\"\"", fixed = TRUE)
})

test_that("write_json_table round-trips through jsonlite", {
  data <- dplyr::tibble(
    ema_product_number = c("A", "B"),
    active_substance = c("x", "y")
  )
  path <- tempfile(fileext = ".json")
  write_json_table(data, path)
  expect_identical(
    dplyr::as_tibble(jsonlite::fromJSON(path)),
    data
  )
})

test_that("write_json_table writes an empty table as an empty array", {
  path <- tempfile(fileext = ".json")
  write_json_table(dplyr::tibble(ema_product_number = character()), path)
  expect_identical(readLines(path, warn = FALSE), "[]")
})

test_that("build_meta records source, timestamp, row counts and attribution", {
  meta <- build_meta(
    source_url = "https://example.org/medicines.json",
    source_timestamp = "2026-09-26T06:02:29Z",
    tables = list(
      ema_medicines = dplyr::tibble(x = 1:3),
      ema_medicine_atc_codes = dplyr::tibble(x = 1:2)
    )
  )
  expect_named(
    meta,
    c("source_url", "source_timestamp", "row_counts", "attribution")
  )
  expect_identical(meta$source_timestamp, "2026-09-26T06:02:29Z")
  expect_identical(
    meta$row_counts,
    list(ema_medicines = 3L, ema_medicine_atc_codes = 2L)
  )
  expect_identical(
    meta$attribution,
    paste0(
      "Source: European Medicines Agency (EMA), ",
      "https://www.ema.europa.eu/en/medicines/download-medicine-data. ",
      "© EMA. Filtered to human medicines and reshaped; ",
      "not affiliated with or endorsed by EMA."
    )
  )
})

test_that("write_meta_json writes a JSON object with unboxed scalars", {
  meta <- build_meta(
    source_url = "https://example.org/medicines.json",
    source_timestamp = "2026-09-26T06:02:29Z",
    tables = list(ema_medicines = dplyr::tibble(x = 1:3))
  )
  path <- tempfile(fileext = ".json")
  write_meta_json(meta, path)
  written <- jsonlite::fromJSON(path, simplifyVector = FALSE)
  expect_identical(written$source_url, "https://example.org/medicines.json")
  expect_identical(written$source_timestamp, "2026-09-26T06:02:29Z")
  expect_identical(written$row_counts, list(ema_medicines = 3L))
  expect_identical(written$attribution, meta$attribution)
})
