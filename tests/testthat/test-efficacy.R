efficacy_fixture <- function() {
  read_efficacy_rows(
    testthat::test_path("fixtures", "efficacy", "efficacy-rows-sample.json")
  )
}

fixture_medicines <- function() {
  dplyr::tibble(
    ema_product_number = unique(efficacy_fixture()$ema_product_number)
  )
}

test_that("the matching subgroup's primary analysis leads each indication", {
  leads <- choose_lead_rows(efficacy_fixture()) |>
    dplyr::filter(.data$lead)
  expect_equal(anyDuplicated(leads[c("ema_product_number", "indication")]), 0L)
  alecensa <- leads |>
    dplyr::filter(.data$ema_product_number == "EMEA/H/C/004164")
  expect_equal(alecensa$population_match, "subgroup_matches")
  expect_equal(alecensa$review, "auto_ok")
  expect_identical(nrow(leads), 4L)
})

test_that("a rejected or flagged row never leads", {
  rows <- efficacy_fixture()
  rows$lead <- TRUE
  leads <- choose_lead_rows(rows)
  hidden <- leads$review %in% c("flagged", "reviewed_rejected")
  expect_false(any(leads$lead[hidden]))
})

test_that("lead rows prefer primary analysis, then the matching population", {
  rows <- efficacy_fixture() |>
    dplyr::filter(
      .data$ema_product_number == "EMEA/H/C/004164",
      .data$review != "reviewed_rejected"
    )
  later <- rows[1, ]
  later$analysis_role <- "later"
  later$row_order <- 0L
  # A later analysis with the lowest order still loses to a primary one.
  leads <- choose_lead_rows(dplyr::bind_rows(rows, later))
  expect_identical(sum(leads$lead), 1L)
  expect_identical(leads$analysis_role[leads$lead], "primary")
  # Without a primary analysis the better population match wins.
  rows$analysis_role <- "later"
  expect_identical(
    choose_lead_rows(rows)$population_match[choose_lead_rows(rows)$lead],
    "subgroup_matches"
  )
  # Then the order in the SmPC.
  rows$population_match <- "whole_trial_matches"
  rows$row_order <- c(2L, 1L)
  leads <- choose_lead_rows(rows)
  expect_identical(leads$row_order[leads$lead], 1L)
})

test_that("a primary endpoint narrows the choice, else the first trial does", {
  rows <- efficacy_fixture() |>
    dplyr::filter(
      .data$ema_product_number == "EMEA/H/C/004164",
      .data$review != "reviewed_rejected"
    )
  secondary <- rows[1, ]
  secondary$is_primary <- FALSE
  secondary$analysis_role <- "primary"
  secondary$row_order <- 0L
  secondary$trial <- "OTHER"
  leads <- choose_lead_rows(dplyr::bind_rows(rows, secondary))
  expect_identical(leads$trial[leads$lead], "ALINA (BO40336)")
  # No endpoint is named primary: the trial of the first row in the SmPC.
  both <- dplyr::bind_rows(rows, secondary)
  both$is_primary <- NA
  leads <- choose_lead_rows(both)
  expect_identical(leads$trial[leads$lead], "OTHER")
})

test_that("flagged and rejected rows are hidden; a shared trial shows twice", {
  table <- build_efficacy_table(efficacy_fixture(), fixture_medicines())
  expect_true(all(table$review %in% c("auto_ok", "reviewed_ok")))
  expect_identical(nrow(table), 5L)
  mariposa <- table |>
    dplyr::filter(startsWith(.data$trial, "MARIPOSA"), .data$endpoint == "PFS")
  expect_equal(nrow(mariposa), 2)
  expect_equal(length(unique(mariposa$value)), 1)
  expect_true(all(table$source == "ema_smpc"))
  expect_false(anyNA(table$lead))
  expect_identical(sum(table$lead), 4L)
})

test_that("the site table is sorted, lead first, and keeps the source", {
  table <- build_efficacy_table(efficacy_fixture(), fixture_medicines())
  expect_identical(
    table$ema_product_number,
    sort(table$ema_product_number, method = "radix")
  )
  alecensa <- table[table$ema_product_number == "EMEA/H/C/004164", ]
  expect_identical(alecensa$lead, c(TRUE, FALSE))
  expect_identical(alecensa$row_order, c(1L, 2L))
  expect_true(all(startsWith(table$source_url, "https://")))
  expect_type(table$quotes, "list")
  expect_false(any(c("verification", "flags") %in% names(table)))
})

test_that("rows of medicines no longer in the data are dropped", {
  medicines <- dplyr::tibble(ema_product_number = "EMEA/H/C/004164")
  table <- build_efficacy_table(efficacy_fixture(), medicines)
  expect_setequal(table$ema_product_number, "EMEA/H/C/004164")
})

test_that("malformed rows stop the build and name the offenders", {
  rows <- efficacy_fixture()
  rows$review[1] <- "maybe"
  expect_error(check_efficacy_rows(rows), "maybe")
  rows <- efficacy_fixture()
  rows$effect_type[2] <- "odds_ratio"
  rows$population_match[3] <- "partly"
  rows$analysis_role[4] <- "second"
  rows$ema_product_number[5] <- "EMEA/H/C/42"
  expect_error(check_efficacy_rows(rows), "odds_ratio")
  expect_error(check_efficacy_rows(rows), "partly")
  expect_error(check_efficacy_rows(rows), "second")
  expect_error(check_efficacy_rows(rows), "EMEA/H/C/42")
})

test_that("rows without quotes, https source, date or model stop the build", {
  rows <- efficacy_fixture()
  rows$quotes[[1]] <- character()
  rows$quotes[[2]] <- ""
  rows$source_url[3] <- "http://www.ema.europa.eu/x.pdf"
  rows$source_date[4] <- NA
  rows$extractor_model[5] <- NA
  expect_error(check_efficacy_rows(rows), "quote")
  expect_error(check_efficacy_rows(rows), "https")
  expect_error(check_efficacy_rows(rows), "source date")
  expect_error(check_efficacy_rows(rows), "extractor model")
})

test_that("a repeated row key stops the build, tombstones included", {
  rows <- efficacy_fixture()
  rows$row_key[2] <- rows$row_key[3]
  expect_error(check_efficacy_rows(rows), "repeated")
  expect_error(check_efficacy_rows(rows), rows$row_key[3])
})

test_that("unstated enums are allowed and tombstones pass the check", {
  rows <- efficacy_fixture()
  rows$population_match[1] <- NA
  rows$analysis_role[1] <- NA
  expect_identical(check_efficacy_rows(rows), rows)
  none <- efficacy_fixture()[0, ]
  expect_identical(check_efficacy_rows(none), none)
})

test_that("rows from an older product information are marked stale", {
  documents <- dplyr::tibble(
    ema_product_number = "EMEA/H/C/004164",
    document_type = "product-information",
    last_updated_date = as.Date("2027-01-01")
  )
  table <- build_efficacy_table(
    efficacy_fixture(), fixture_medicines(), documents
  )
  expect_true(all(table$stale[table$ema_product_number == "EMEA/H/C/004164"]))
  expect_false(any(table$stale[table$ema_product_number != "EMEA/H/C/004164"]))
  # The newest product information counts, and only that type.
  documents <- dplyr::tibble(
    ema_product_number = "EMEA/H/C/004164",
    document_type = c("product-information", "product-information", "overview"),
    last_updated_date = as.Date(c("2026-03-31", "2026-01-01", "2027-01-01"))
  )
  table <- build_efficacy_table(
    efficacy_fixture(), fixture_medicines(), documents
  )
  expect_false(any(table$stale))
  unknown <- build_efficacy_table(efficacy_fixture(), fixture_medicines())
  expect_false(any(unknown$stale))
})

test_that("no rows, an empty table with the columns and no source entry", {
  none <- efficacy_fixture()[0, ]
  expect_null(efficacy_source_entry(none))
  table <- build_efficacy_table(none, fixture_medicines())
  expect_identical(nrow(table), 0L)
  full <- build_efficacy_table(efficacy_fixture(), fixture_medicines())
  expect_identical(names(table), names(full))
  expect_identical(lapply(table, class), lapply(full, class))
})

test_that("the source entry counts only the rows the site shows", {
  rows <- efficacy_fixture()
  hidden <- !rows$review %in% efficacy_shown_reviews
  rows$extractor_model[hidden] <- "claude-opus-5-5"
  rows$extracted_at[hidden] <- as.Date("2026-10-15")
  table <- build_efficacy_table(rows, fixture_medicines())
  entry <- efficacy_source_entry(table)
  expect_identical(
    entry$version, "Extracted 2026-09-30; models claude-sonnet-5-5"
  )
  rows$review <- "flagged"
  expect_null(
    efficacy_source_entry(build_efficacy_table(rows, fixture_medicines()))
  )
})

test_that("a row without an extraction date stops the build", {
  rows <- efficacy_fixture()
  rows$extracted_at[2] <- NA
  expect_error(check_efficacy_rows(rows), "no extraction date")
})

test_that("the source entry names the extraction", {
  entry <- efficacy_source_entry(
    build_efficacy_table(efficacy_fixture(), fixture_medicines())
  )
  expect_identical(
    entry$name,
    paste(
      "Pivotal results (extracted from EMA product information SmPC",
      "section 5.1 with Claude)"
    )
  )
  expect_identical(entry$url, "https://www.ema.europa.eu/en/medicines")
  expect_identical(
    entry$version, "Extracted 2026-09-30; models claude-sonnet-5-5"
  )
  expect_identical(entry$retrieved, "2026-09-30")
  expect_match(entry$licence, "Quotes .* EMA; extraction CC BY-SA 4.0")
  expect_named(
    entry,
    c("name", "url", "version", "retrieved", "licence", "attribution")
  )
})

test_that("the summary counts medicines, rows, reviews and stale rows", {
  rows <- efficacy_fixture()
  table <- build_efficacy_table(rows, fixture_medicines())
  messages <- testthat::capture_messages(report_efficacy_summary(rows, table))
  expect_match(messages, "4 medicines", all = FALSE)
  expect_match(messages, "5 rows shown", all = FALSE)
  expect_match(messages, "1 flagged", all = FALSE)
  expect_match(messages, "1 rejected", all = FALSE)
  expect_match(messages, "0 stale", all = FALSE)
  expect_silent(report_efficacy_summary(rows[0, ], table[0, ]))
})
