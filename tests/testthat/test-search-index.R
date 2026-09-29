fixture_search_index <- function() {
  clean_medicines <- clean_ema_medicines(read_fixture_ema()$data)
  build_search_index(
    build_medicines_table(clean_medicines),
    build_substances_table(clean_medicines),
    build_lookup_table(clean_medicines, "active_substance")
  )
}

test_that("build_search_index has one row per medicine in contract order", {
  index <- fixture_search_index()
  expect_named(
    index,
    c(
      "ema_product_number", "name_of_medicine", "substances",
      "substance_keys", "active_substance", "medicine_status",
      "marketing_authorisation_date", "medicine_type", "orphan_medicine",
      "conditional_approval", "exceptional_circumstances",
      "additional_monitoring"
    )
  )
  expect_identical(nrow(index), 19L)
  expect_identical(index$ema_product_number, sort(index$ema_product_number))
  expect_s3_class(index$marketing_authorisation_date, "Date")
  expect_type(index$orphan_medicine, "logical")
})

test_that("build_search_index carries EMA's approval and monitoring flags", {
  index <- fixture_search_index()
  flagged <- index$ema_product_number[index$additional_monitoring]
  expect_identical(
    flagged,
    c(
      "EMEA/H/C/003933", "EMEA/H/C/004090", "EMEA/H/C/005752",
      "EMEA/H/C/006080", "EMEA/H/C/006420"
    )
  )
  expect_false(any(index$conditional_approval))
  expect_false(any(index$exceptional_circumstances))
})

test_that("build_search_index joins substances and keeps their keys", {
  index <- fixture_search_index()
  suboxone <- index[index$ema_product_number == "EMEA/H/C/000697", ]
  expect_identical(suboxone$substances, "buprenorphine; naloxone")
  expect_identical(
    suboxone$substance_keys,
    list(c("buprenorphine", "naloxone"))
  )
  expect_identical(suboxone$active_substance, "buprenorphine; naloxone")
  tacquell <- index[index$ema_product_number == "EMEA/H/C/006563", ]
  expect_identical(
    tacquell$substance_keys[[1]],
    paste(
      "autologous melanoma-derived tumor infiltrating lymphocytes,",
      "ex vivo-expanded"
    )
  )
  twinrix <- index[index$ema_product_number == "EMEA/H/C/000112", ]
  expect_identical(
    twinrix$active_substance,
    "hepatitis A virus (inactivated); hepatitis B surface antigen"
  )
})

test_that("a medicine without an INN has no substances and no keys", {
  index <- fixture_search_index()
  ixinity <- index[index$ema_product_number == "EMEA/H/C/002349", ]
  expect_identical(ixinity$substances, NA_character_)
  expect_identical(ixinity$substance_keys, list(character()))
  expect_identical(ixinity$active_substance, "trenonacog alfa")
})

test_that("build_search_index lists a substance key once per medicine", {
  medicines <- dplyr::tibble(
    ema_product_number = "EMEA/H/C/000001",
    name_of_medicine = "Example",
    medicine_status = "Authorised",
    marketing_authorisation_date = as.Date("2020-01-01"),
    medicine_type = "Other",
    orphan_medicine = FALSE,
    conditional_approval = TRUE,
    exceptional_circumstances = FALSE,
    additional_monitoring = TRUE
  )
  substances <- dplyr::tibble(
    ema_product_number = "EMEA/H/C/000001",
    substance = c("Insulin", "insulin"),
    substance_key = c("insulin", "insulin")
  )
  index <- build_search_index(
    medicines,
    substances,
    dplyr::tibble(
      ema_product_number = character(),
      active_substance = character()
    )
  )
  expect_identical(index$substances, "Insulin; insulin")
  expect_identical(index$substance_keys, list("insulin"))
  expect_identical(index$active_substance, NA_character_)
  expect_identical(index$conditional_approval, TRUE)
  expect_identical(index$exceptional_circumstances, FALSE)
  expect_identical(index$additional_monitoring, TRUE)
})

test_that("the search index writes substance keys as JSON arrays", {
  path <- tempfile(fileext = ".json")
  write_json_table(fixture_search_index(), path)
  rows <- jsonlite::fromJSON(path, simplifyVector = FALSE)
  by_number <- stats::setNames(
    rows,
    vapply(rows, function(row) row$ema_product_number, character(1))
  )
  expect_identical(by_number[["EMEA/H/C/002349"]]$substance_keys, list())
  expect_identical(
    by_number[["EMEA/H/C/005752"]]$substance_keys,
    list("natalizumab")
  )
  expect_null(by_number[["EMEA/H/C/002349"]]$substances)
  expect_identical(by_number[["EMEA/H/C/005752"]]$additional_monitoring, TRUE)
  expect_identical(by_number[["EMEA/H/C/005752"]]$conditional_approval, FALSE)
  expect_identical(
    by_number[["EMEA/H/C/005752"]]$exceptional_circumstances,
    FALSE
  )
})
