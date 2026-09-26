test_that("offender_values truncates long vectors and keeps a count", {
  values <- sprintf("value_%02d", 1:25)
  error <- expect_error(
    cli::cli_abort("{length(values)} bad: {.val {offender_values(values)}}"),
    class = "rlang_error"
  )
  message <- conditionMessage(error)
  expect_match(message, "25 bad")
  expect_match(message, "value_01", fixed = TRUE)
  expect_match(message, "value_25", fixed = TRUE)
  expect_no_match(message, "value_15", fixed = TRUE)
})

test_that("expected_ema_columns lists the 39 EMA columns in source order", {
  data <- read_fixture_ema()$data
  expect_identical(expected_ema_columns, names(data))
  expect_length(expected_ema_columns, 39)
})

test_that("check_expected_columns returns real EMA data invisibly", {
  data <- read_fixture_ema()$data
  expect_invisible(check_expected_columns(data))
  expect_identical(check_expected_columns(data), data)
})

test_that("check_expected_columns reports missing columns", {
  data <- read_fixture_ema()$data
  data$category <- NULL
  error <- expect_error(check_expected_columns(data), class = "rlang_error")
  expect_match(conditionMessage(error), "Missing.*category")
  expect_no_match(conditionMessage(error), "Unexpected")
})

test_that("check_expected_columns reports unexpected columns", {
  data <- read_fixture_ema()$data
  data$surprise_column <- "x"
  error <- expect_error(check_expected_columns(data), class = "rlang_error")
  expect_match(conditionMessage(error), "Unexpected.*surprise_column")
  expect_no_match(conditionMessage(error), "Missing")
})

test_that("check_expected_columns reports missing and unexpected together", {
  data <- read_fixture_ema()$data
  names(data)[names(data) == "generic"] <- "generic_medicine"
  error <- expect_error(check_expected_columns(data), class = "rlang_error")
  expect_match(conditionMessage(error), "Missing.*\"generic\"")
  expect_match(conditionMessage(error), "Unexpected.*generic_medicine")
})

test_that("check_record_count passes when counts match", {
  ema <- read_fixture_ema()
  expect_invisible(check_record_count(ema$data, ema$meta))
  expect_identical(check_record_count(ema$data, ema$meta), ema$data)
})

test_that("check_record_count aborts when counts differ", {
  ema <- read_fixture_ema()
  ema$meta$total_records <- ema$meta$total_records + 1
  error <- expect_error(
    check_record_count(ema$data, ema$meta),
    class = "rlang_error"
  )
  expect_match(conditionMessage(error), "22")
  expect_match(conditionMessage(error), "21")
})

test_that("check_record_count aborts when meta has no total", {
  ema <- read_fixture_ema()
  ema$meta$total_records <- NULL
  expect_error(check_record_count(ema$data, ema$meta), class = "rlang_error")
})

test_that("check_has_human_rows passes with human rows", {
  data <- read_fixture_ema()$data
  expect_invisible(check_has_human_rows(data))
  expect_identical(check_has_human_rows(data), data)
})

test_that("check_has_human_rows aborts without human rows", {
  data <- read_fixture_ema()$data
  veterinary <- data[data$category == "Veterinary", ]
  error <- expect_error(check_has_human_rows(veterinary), class = "rlang_error")
  expect_match(conditionMessage(error), "Veterinary")
})

test_that("check_unique_product_numbers passes unique numbers", {
  medicines <- dplyr::tibble(ema_product_number = c("A", "B"))
  expect_invisible(check_unique_product_numbers(medicines))
  expect_identical(check_unique_product_numbers(medicines), medicines)
})

test_that("check_unique_product_numbers aborts on duplicates", {
  medicines <- dplyr::tibble(ema_product_number = c("A", "B", "B"))
  error <- expect_error(
    check_unique_product_numbers(medicines),
    class = "rlang_error"
  )
  expect_match(conditionMessage(error), "\"B\"")
})

test_that("check_unique_product_numbers aborts on missing or empty numbers", {
  missing_number <- dplyr::tibble(ema_product_number = c("A", NA))
  empty_number <- dplyr::tibble(ema_product_number = c("A", ""))
  error <- expect_error(
    check_unique_product_numbers(missing_number),
    class = "rlang_error"
  )
  expect_match(conditionMessage(error), "1 row")
  expect_error(
    check_unique_product_numbers(empty_number),
    class = "rlang_error"
  )
})

test_that("check_no_future_approval_dates allows today plus one day", {
  medicines <- dplyr::tibble(
    ema_product_number = c("A", "B", "C"),
    marketing_authorisation_date = as.Date(c("2026-01-01", "2026-09-27", NA))
  )
  today <- as.Date("2026-09-26")
  expect_invisible(check_no_future_approval_dates(medicines, today = today))
  expect_identical(
    check_no_future_approval_dates(medicines, today = today),
    medicines
  )
})

test_that("check_no_future_approval_dates aborts on dates in the future", {
  medicines <- dplyr::tibble(
    ema_product_number = c("A", "B"),
    marketing_authorisation_date = as.Date(c("2026-01-01", "2026-09-28"))
  )
  error <- expect_error(
    check_no_future_approval_dates(medicines, today = as.Date("2026-09-26")),
    class = "rlang_error"
  )
  expect_match(conditionMessage(error), "\"B\"")
})

test_that("check_no_future_approval_dates defaults to the current date", {
  medicines <- dplyr::tibble(
    ema_product_number = "A",
    marketing_authorisation_date = Sys.Date() + 30
  )
  expect_error(check_no_future_approval_dates(medicines), class = "rlang_error")
})

test_that("check_single_medicine_type_flag allows at most one flag", {
  medicines <- dplyr::tibble(
    ema_product_number = c("A", "B", "C", "D"),
    advanced_therapy = c(TRUE, FALSE, FALSE, FALSE),
    biosimilar = c(FALSE, TRUE, FALSE, FALSE),
    generic = c(FALSE, FALSE, TRUE, FALSE)
  )
  expect_invisible(check_single_medicine_type_flag(medicines))
  expect_identical(check_single_medicine_type_flag(medicines), medicines)
})

test_that("check_single_medicine_type_flag aborts when flags co-occur", {
  medicines <- dplyr::tibble(
    ema_product_number = c("A", "B"),
    advanced_therapy = c(TRUE, FALSE),
    biosimilar = c(FALSE, TRUE),
    generic = c(TRUE, TRUE)
  )
  error <- expect_error(
    check_single_medicine_type_flag(medicines),
    class = "rlang_error"
  )
  expect_match(conditionMessage(error), "\"A\"")
  expect_match(conditionMessage(error), "\"B\"")
})

series_check_medicines <- function() {
  dplyr::tibble(
    ema_product_number = sprintf("EMEA/H/C/00000%d", 1:4),
    name_of_medicine = c("Alpha", "Beta {odd}", "Gamma", "Delta"),
    medicine_status = c("Authorised", "Withdrawn", "Authorised", "Withdrawn"),
    authorized_from = as.Date(
      c("2020-01-01", "2001-01-01", "2026-01-01", "2005-01-01")
    ),
    authorized_until = as.Date(c(NA, "2010-01-01", NA, "2012-01-01")),
    series_exclusion = NA_character_
  )
}

test_that("check_tile_matches_series passes when the counts agree", {
  medicines <- series_check_medicines()
  expect_invisible(check_tile_matches_series(medicines, as.Date("2026-09-26")))
  expect_identical(
    check_tile_matches_series(medicines, as.Date("2026-09-26")),
    medicines
  )
})

test_that("check_tile_matches_series lists rows counted by only one side", {
  medicines <- series_check_medicines()
  medicines$series_exclusion[1] <- "ended_without_end_date"
  medicines$authorized_until[2] <- NA
  medicines$authorized_until[4] <- NA
  error <- expect_error(
    check_tile_matches_series(medicines, as.Date("2026-09-26")),
    class = "rlang_error"
  )
  # cli wraps long lines, so compare with whitespace collapsed.
  message <- stringr::str_squish(conditionMessage(error))
  expect_match(message, "tile counts 2 ", fixed = TRUE)
  expect_match(message, "series counts 3 ", fixed = TRUE)
  expect_match(message, "2026-09-26", fixed = TRUE)
  expect_match(
    message,
    paste(
      "EMEA/H/C/000001 Alpha: Authorised; authorized 2020-01-01 to NA;",
      "series_exclusion ended_without_end_date; in the tile only"
    ),
    fixed = TRUE
  )
  expect_match(
    message,
    paste(
      "EMEA/H/C/000002 Beta {odd}: Withdrawn; authorized 2001-01-01 to NA;",
      "series_exclusion NA; in the series only"
    ),
    fixed = TRUE
  )
  expect_match(message, "EMEA/H/C/000004 Delta", fixed = TRUE)
  expect_no_match(message, "Gamma", fixed = TRUE)
})
