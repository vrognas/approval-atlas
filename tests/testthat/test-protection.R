snapshot <- as.Date("2026-09-26")

# Real products and dates; generic/biosimilar flags as EMA publishes them.
protection_medicines <- function() {
  dplyr::tibble(
    ema_product_number = paste0(
      "EMEA/H/C/",
      c("000603", "005752", "000980", "002788", "005961", "004049", "005620")
    ),
    name_of_medicine = c(
      "Tysabri", "Tyruko", "Samsca", "Jinarc", "Tolvaptan Accord",
      "Tenofovir disoproxil Viatris", "Mounjaro"
    ),
    generic = c(FALSE, FALSE, FALSE, FALSE, TRUE, TRUE, FALSE),
    biosimilar = c(FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE),
    marketing_authorisation_date = as.Date(c(
      "2006-06-27", "2023-09-22", "2009-08-03", "2015-05-27", NA,
      "2016-12-08", "2022-09-15"
    )),
    substance_set_key = c(
      "natalizumab", "natalizumab", "tolvaptan", "tolvaptan", "tolvaptan",
      "tenofovir disoproxil", "tirzepatide"
    )
  )
}

protection_row <- function(protection, product_number) {
  protection[protection$ema_product_number == product_number, ]
}

test_that("build_protection_table has one row per medicine with an MA date", {
  protection <- build_protection_table(protection_medicines(), snapshot)
  expect_named(
    protection,
    c(
      "ema_product_number", "basis", "reference_product_number",
      "reference_name", "counted_from", "data_exclusivity_end",
      "market_protection_end_min", "market_protection_end_max", "status",
      "source"
    )
  )
  expect_identical(
    protection$ema_product_number,
    paste0(
      "EMEA/H/C/",
      c("000603", "000980", "002788", "004049", "005620", "005752")
    )
  )
  expect_identical(unique(protection$source), "estimate_from_ema_dates")
})

test_that("an originator counts from the first product of its substances", {
  protection <- build_protection_table(protection_medicines(), snapshot)
  mounjaro <- protection_row(protection, "EMEA/H/C/005620")
  expect_identical(mounjaro$basis, "own")
  expect_identical(mounjaro$reference_product_number, "EMEA/H/C/005620")
  expect_identical(mounjaro$reference_name, "Mounjaro")
  expect_identical(mounjaro$counted_from, as.Date("2022-09-15"))
  expect_identical(mounjaro$data_exclusivity_end, as.Date("2030-09-15"))
  expect_identical(mounjaro$market_protection_end_min, as.Date("2032-09-15"))
  expect_identical(mounjaro$market_protection_end_max, as.Date("2033-09-15"))
  expect_identical(mounjaro$status, "protected")

  jinarc <- protection_row(protection, "EMEA/H/C/002788")
  expect_identical(jinarc$basis, "own")
  expect_identical(jinarc$reference_name, "Samsca")
  expect_identical(jinarc$counted_from, as.Date("2009-08-03"))
  expect_identical(jinarc$status, "ended")
})

test_that("a biosimilar follows its reference product's dates", {
  protection <- build_protection_table(protection_medicines(), snapshot)
  tyruko <- protection_row(protection, "EMEA/H/C/005752")
  expect_identical(tyruko$basis, "follows_reference")
  expect_identical(tyruko$reference_product_number, "EMEA/H/C/000603")
  expect_identical(tyruko$reference_name, "Tysabri")
  expect_identical(tyruko$counted_from, as.Date("2006-06-27"))
  expect_identical(tyruko$market_protection_end_max, as.Date("2017-06-27"))
  expect_identical(tyruko$status, "ended")
})

test_that("a generic without a reference product has no dates", {
  protection <- build_protection_table(protection_medicines(), snapshot)
  tenofovir <- protection_row(protection, "EMEA/H/C/004049")
  expect_identical(tenofovir$basis, "reference_not_found")
  expect_identical(tenofovir$reference_product_number, NA_character_)
  expect_identical(tenofovir$reference_name, NA_character_)
  expect_identical(tenofovir$counted_from, as.Date(NA))
  expect_identical(tenofovir$data_exclusivity_end, as.Date(NA))
  expect_identical(tenofovir$status, "unclear")
})

test_that("the status is unclear between the minimum and maximum end", {
  medicines <- dplyr::tibble(
    ema_product_number = c("EMEA/H/C/000001", "EMEA/H/C/000002"),
    name_of_medicine = c("Leap", "Edge"),
    generic = FALSE,
    biosimilar = FALSE,
    marketing_authorisation_date = as.Date(c("2016-02-29", "2016-09-26")),
    substance_set_key = c("a", "b")
  )
  protection <- build_protection_table(medicines, snapshot)
  expect_identical(
    protection$data_exclusivity_end,
    as.Date(c("2024-02-29", "2024-09-26"))
  )
  expect_identical(
    protection$market_protection_end_min,
    as.Date(c("2026-03-01", "2026-09-26"))
  )
  expect_identical(
    protection$market_protection_end_max,
    as.Date(c("2027-03-01", "2027-09-26"))
  )
  expect_identical(protection$status, c("unclear", "unclear"))
})

test_that("a medicine without substances is its own reference", {
  medicines <- dplyr::tibble(
    ema_product_number = c("EMEA/H/C/000001", "EMEA/H/C/000002"),
    name_of_medicine = c("First", "Second"),
    generic = c(FALSE, TRUE),
    biosimilar = FALSE,
    marketing_authorisation_date = as.Date(c("2020-01-01", "2021-01-01")),
    substance_set_key = NA_character_
  )
  protection <- build_protection_table(medicines, snapshot)
  expect_identical(protection$basis, c("own", "reference_not_found"))
  expect_identical(protection$reference_name, c("First", NA))
  expect_identical(protection$counted_from, as.Date(c("2020-01-01", NA)))
})

test_that("the lower product number wins a tie for the first product", {
  medicines <- dplyr::tibble(
    ema_product_number = c("EMEA/H/C/000002", "EMEA/H/C/000001"),
    name_of_medicine = c("Second", "First"),
    generic = FALSE,
    biosimilar = FALSE,
    marketing_authorisation_date = as.Date("2020-01-01"),
    substance_set_key = "a"
  )
  protection <- build_protection_table(medicines, snapshot)
  expect_identical(protection$reference_name, c("First", "First"))
})

test_that("add_months rolls a missing day into the next month", {
  expect_identical(
    add_months(as.Date(c("2016-02-29", "2020-01-31", NA)), c(120L, 12L, 1L)),
    as.Date(c("2026-03-01", "2021-01-31", NA))
  )
})
