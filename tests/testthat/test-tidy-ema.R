test_that("derive_medicine_type applies the fixed precedence", {
  expect_identical(
    derive_medicine_type(
      advanced_therapy = c(TRUE, FALSE, FALSE, FALSE, TRUE),
      biosimilar = c(FALSE, TRUE, FALSE, FALSE, TRUE),
      generic = c(FALSE, FALSE, TRUE, FALSE, TRUE)
    ),
    c("Advanced therapy", "Biosimilar", "Generic", "Other", "Advanced therapy")
  )
})

test_that("build_medicines_table drops split fields, appends medicine_type", {
  clean_medicines <- clean_ema_medicines(read_fixture_ema()$data)
  medicines <- build_medicines_table(clean_medicines)
  expected_source_columns <- setdiff(
    names(read_fixture_ema()$data),
    c(
      "category",
      "species_veterinary",
      "atcvet_code_veterinary",
      "pharmacotherapeutic_group_veterinary",
      "active_substance",
      "therapeutic_area_mesh",
      "atc_code_human"
    )
  )
  expect_length(expected_source_columns, 32)
  expect_identical(
    names(medicines),
    c(expected_source_columns, "medicine_type")
  )
  expect_identical(nrow(medicines), nrow(clean_medicines))
})

test_that("build_medicines_table sorts by product number and derives types", {
  medicines <- build_medicines_table(
    clean_ema_medicines(read_fixture_ema()$data)
  )
  expect_identical(
    medicines$ema_product_number,
    sort(medicines$ema_product_number, method = "radix")
  )
  type_of <- function(product_number) {
    medicines$medicine_type[medicines$ema_product_number == product_number]
  }
  expect_identical(type_of("EMEA/H/C/004090"), "Advanced therapy")
  expect_identical(type_of("EMEA/H/C/005752"), "Biosimilar")
  expect_identical(type_of("EMEA/H/C/005961"), "Generic")
  expect_identical(type_of("EMEA/H/C/002846"), "Other")
})

test_that("build_lookup_table splits, squishes, drops placeholders and sorts", {
  clean_medicines <- dplyr::tibble(
    ema_product_number = c("B", "A", "C", "D", "E"),
    atc_code_human = c("x;y", " y ; x;y", NA, "Not yet assigned", "z;;")
  )
  lookup <- build_lookup_table(
    clean_medicines,
    "atc_code_human",
    placeholder_values = "Not yet assigned"
  )
  expect_identical(
    lookup,
    dplyr::tibble(
      ema_product_number = c("A", "A", "B", "B", "E"),
      atc_code_human = c("x", "y", "x", "y", "z")
    )
  )
})

test_that("build_lookup_table keeps commas inside terms", {
  clean_medicines <- clean_ema_medicines(read_fixture_ema()$data)
  areas <- build_lookup_table(clean_medicines, "therapeutic_area_mesh")
  tyruko <- areas$therapeutic_area_mesh[
    areas$ema_product_number == "EMEA/H/C/005752"
  ]
  expect_identical(
    tyruko,
    c("Multiple Sclerosis", "Multiple Sclerosis, Relapsing-Remitting")
  )
})

test_that("build_lookup_table handles real active substance quirks", {
  clean_medicines <- clean_ema_medicines(read_fixture_ema()$data)
  substances <- build_lookup_table(clean_medicines, "active_substance")
  substances_of <- function(product_number) {
    substances$active_substance[
      substances$ema_product_number == product_number
    ]
  }
  expect_identical(substances_of("EMEA/H/C/002349"), "trenonacog alfa")
  expect_length(substances_of("EMEA/H/C/006538"), 6)
  expect_false(any(grepl("^\\s|\\s$", substances$active_substance)))
})

test_that("build_lookup_table drops the ATC placeholder and splits two codes", {
  clean_medicines <- clean_ema_medicines(read_fixture_ema()$data)
  atc_codes <- build_lookup_table(
    clean_medicines,
    "atc_code_human",
    placeholder_values = "Not yet assigned"
  )
  expect_false("Not yet assigned" %in% atc_codes$atc_code_human)
  expect_false("EMEA/H/C/006420" %in% atc_codes$ema_product_number)
  expect_identical(
    atc_codes$atc_code_human[atc_codes$ema_product_number == "EMEA/H/C/000088"],
    c("A10AB04", "A10AD04")
  )
})

test_that("lookup tables only reference medicines and contain no empty text", {
  clean_medicines <- clean_ema_medicines(read_fixture_ema()$data)
  medicines <- build_medicines_table(clean_medicines)
  lookups <- list(
    build_lookup_table(clean_medicines, "therapeutic_area_mesh"),
    build_lookup_table(clean_medicines, "active_substance"),
    build_lookup_table(clean_medicines, "atc_code_human", "Not yet assigned")
  )
  for (lookup in lookups) {
    expect_in(lookup$ema_product_number, medicines$ema_product_number)
    expect_false(anyNA(lookup))
    expect_false(any(unlist(lookup) == ""))
    expect_identical(anyDuplicated(lookup), 0L)
  }
  expect_false(any(unlist(medicines) == "", na.rm = TRUE))
})
