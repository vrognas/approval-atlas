end_column <- paste0(
  "withdrawal_expiry_revocation_lapse_of_",
  "marketing_authorisation_date"
)
suspension_column <- "suspension_of_marketing_authorisation_date"

interval_medicines <- function() {
  medicines <- dplyr::tibble(
    ema_product_number = sprintf("P%02d", 1:10),
    medicine_status = c(
      "Authorised", "Withdrawn", "Withdrawn", "Suspended", "Withdrawn",
      "Authorised", "Application withdrawn", "Refused", "Expired", "Lapsed"
    ),
    marketing_authorisation_date = as.Date(c(
      "2020-01-15", "2001-05-01", "2001-05-01", "2010-03-01", "1999-01-01",
      NA, "2018-06-27", NA, "2005-01-01", NA
    )),
    end_date = as.Date(c(
      NA, "2010-01-01", "2012-01-01", NA, NA,
      NA, NA, NA, "2010-01-01", NA
    )),
    suspension_date = as.Date(c(
      NA, NA, "2011-06-30", "2015-02-01", NA,
      NA, NA, NA, NA, NA
    )),
    medicine_type = "Other",
    after_type = "x"
  )
  names(medicines)[names(medicines) == "end_date"] <- end_column
  names(medicines)[names(medicines) == "suspension_date"] <- suspension_column
  medicines
}

test_that("add_authorization_intervals adds the three columns after the type", {
  medicines <- add_authorization_intervals(interval_medicines())
  expect_identical(
    names(medicines),
    c(
      names(interval_medicines())[1:6],
      "authorized_from", "authorized_until", "series_exclusion",
      "after_type"
    )
  )
})

test_that("authorized_from is the marketing authorisation date", {
  medicines <- add_authorization_intervals(interval_medicines())
  expect_identical(
    medicines$authorized_from,
    medicines$marketing_authorisation_date
  )
})

test_that("authorized_until is the earliest end or suspension date", {
  medicines <- add_authorization_intervals(interval_medicines())
  expect_identical(
    medicines$authorized_until,
    as.Date(c(
      NA, "2010-01-01", "2011-06-30", "2015-02-01", NA,
      NA, NA, NA, "2010-01-01", NA
    ))
  )
})

test_that("series_exclusion applies the documented precedence", {
  medicines <- add_authorization_intervals(interval_medicines())
  expect_identical(
    medicines$series_exclusion,
    c(
      NA, NA, NA, NA, "ended_without_end_date",
      "no_approval_date", "never_authorized", "never_authorized", NA,
      "no_approval_date"
    )
  )
})

test_that("every never-authorized and ended status is recognized", {
  medicines <- dplyr::tibble(
    medicine_status = c(
      "Application withdrawn", "Refused", "Opinion",
      "Opinion under re-examination", "Withdrawn from rolling review",
      "Withdrawn", "Expired", "Lapsed", "Revoked", "Suspended"
    ),
    marketing_authorisation_date = as.Date("2020-01-01"),
    end_date = as.Date(NA),
    suspension_date = as.Date(NA),
    medicine_type = "Other"
  )
  names(medicines)[names(medicines) == "end_date"] <- end_column
  names(medicines)[names(medicines) == "suspension_date"] <- suspension_column
  expect_identical(
    add_authorization_intervals(medicines)$series_exclusion,
    c(rep("never_authorized", 5), rep("ended_without_end_date", 5))
  )
})

test_that("snapshot_date_from_timestamp keeps only the date part", {
  expect_identical(
    snapshot_date_from_timestamp("2026-09-26T06:02:29Z"),
    as.Date("2026-09-26")
  )
})

test_that("snapshot_date_from_timestamp aborts on an unreadable timestamp", {
  expect_error(snapshot_date_from_timestamp("26/09/2026 06:02"), "26/09/2026")
  expect_error(snapshot_date_from_timestamp(NULL), "timestamp")
})

test_that("series_dates runs from 1995-01-31 by month-end to the snapshot", {
  dates <- series_dates(as.Date("2026-09-26"))
  expect_length(dates, 381)
  expect_identical(
    dates[1:3],
    as.Date(c("1995-01-31", "1995-02-28", "1995-03-31"))
  )
  expect_true(as.Date("1996-02-29") %in% dates)
  expect_identical(
    utils::tail(dates, 2),
    as.Date(c("2026-08-31", "2026-09-26"))
  )
})

test_that("series_dates does not repeat a snapshot that is a month-end", {
  dates <- series_dates(as.Date("2026-09-30"))
  expect_identical(
    utils::tail(dates, 2),
    as.Date(c("2026-08-31", "2026-09-30"))
  )
  expect_identical(anyDuplicated(dates), 0L)
})

test_that("is_counted_in_series includes the start day and excludes the end", {
  medicines <- dplyr::tibble(
    authorized_from = as.Date(
      c("2020-01-01", "2019-01-01", "2019-01-01", "2019-01-01", "2019-01-01")
    ),
    authorized_until = as.Date(c(NA, "2020-01-01", "2020-01-02", NA, NA)),
    series_exclusion = c(NA, NA, NA, "ended_without_end_date", NA)
  )
  expect_identical(
    is_counted_in_series(medicines, as.Date("2020-01-01")),
    c(TRUE, FALSE, TRUE, FALSE, TRUE)
  )
  expect_identical(
    is_counted_in_series(medicines, as.Date("2019-12-31")),
    c(FALSE, TRUE, TRUE, FALSE, TRUE)
  )
})

test_that("is_authorized_now needs status Authorised and an approval date", {
  medicines <- dplyr::tibble(
    medicine_status = c("Authorised", "Authorised", "Withdrawn"),
    authorized_from = as.Date(c("2020-01-01", NA, "2020-01-01"))
  )
  expect_identical(is_authorized_now(medicines), c(TRUE, FALSE, FALSE))
})

test_that("build_authorized_series counts products and substance sets", {
  medicines <- dplyr::tibble(
    authorized_from = as.Date(
      c("1995-10-20", "1996-01-10", "1996-02-10", "1995-12-01")
    ),
    authorized_until = as.Date(c(NA, "1996-02-15", NA, NA)),
    series_exclusion = c(NA, NA, NA, "ended_without_end_date"),
    substance_set_key = c("a|b", "c", "a|b", "d")
  )
  series <- build_authorized_series(medicines, as.Date("1996-03-05"))
  expect_named(
    series,
    c("date", "authorized_products", "authorized_substances")
  )
  expect_identical(
    series$date,
    as.Date(c(
      "1995-01-31", "1995-02-28", "1995-03-31", "1995-04-30", "1995-05-31",
      "1995-06-30", "1995-07-31", "1995-08-31", "1995-09-30", "1995-10-31",
      "1995-11-30", "1995-12-31", "1996-01-31", "1996-02-29", "1996-03-05"
    ))
  )
  expect_identical(
    series$authorized_products,
    c(rep(0L, 9), 1L, 1L, 1L, 2L, 2L, 2L)
  )
  expect_identical(
    series$authorized_substances,
    c(rep(0L, 9), 1L, 1L, 1L, 2L, 1L, 1L)
  )
})

test_that("build_authorized_series ignores products without a substance key", {
  medicines <- dplyr::tibble(
    authorized_from = as.Date(c("1995-01-01", "1995-01-01")),
    authorized_until = as.Date(c(NA, NA)),
    series_exclusion = c(NA_character_, NA_character_),
    substance_set_key = c(NA, "a")
  )
  series <- build_authorized_series(medicines, as.Date("1995-02-10"))
  expect_identical(series$date, as.Date(c("1995-01-31", "1995-02-10")))
  expect_identical(series$authorized_products, c(2L, 2L))
  expect_identical(series$authorized_substances, c(1L, 1L))
})
