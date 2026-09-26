test_that("build_substances_table splits on ';' and ' / ', squishes, sorts", {
  clean_medicines <- dplyr::tibble(
    ema_product_number = c("B", "A", "C", "D"),
    international_non_proprietary_name_common_name = c(
      "tezacaftor / ivacaftor;elexacaftor",
      " Metformin  hydrochloride ; sitagliptin;;",
      NA,
      "sitagliptin;sitagliptin"
    )
  )
  expect_identical(
    build_substances_table(clean_medicines),
    dplyr::tibble(
      ema_product_number = c("A", "A", "B", "B", "B", "D"),
      substance = c(
        "Metformin hydrochloride",
        "sitagliptin",
        "elexacaftor",
        "ivacaftor",
        "tezacaftor",
        "sitagliptin"
      ),
      substance_key = c(
        "metformin hydrochloride",
        "sitagliptin",
        "elexacaftor",
        "ivacaftor",
        "tezacaftor",
        "sitagliptin"
      )
    )
  )
})

test_that("build_substances_table keeps slashes that belong to one name", {
  clean_medicines <- dplyr::tibble(
    ema_product_number = c("A", "B", "C"),
    international_non_proprietary_name_common_name = c(
      "Mycobacterium tuberculosis derived antigens (rdESAT-6 / rCFP-10)",
      "A/VietNam/1194/2004",
      "extract 30 per cent (W/W) of Allium cepa"
    )
  )
  expect_identical(
    build_substances_table(clean_medicines)$substance,
    clean_medicines$international_non_proprietary_name_common_name
  )
})

test_that("build_substances_table does not merge salts", {
  clean_medicines <- dplyr::tibble(
    ema_product_number = c("A", "B"),
    international_non_proprietary_name_common_name = c(
      "metformin hydrochloride",
      "metformin"
    )
  )
  expect_identical(
    build_substances_table(clean_medicines)$substance_key,
    c("metformin hydrochloride", "metformin")
  )
})

test_that("build_substances_table works on real EMA records", {
  clean_medicines <- clean_ema_medicines(read_fixture_ema()$data)
  substances <- build_substances_table(clean_medicines)
  substances_of <- function(product_number) {
    substances$substance[substances$ema_product_number == product_number]
  }
  expect_identical(
    substances_of("EMEA/H/C/000697"),
    c("buprenorphine", "naloxone")
  )
  expect_identical(substances_of("EMEA/H/C/002349"), character())
  expect_false(anyNA(substances))
  expect_false(any(unlist(substances) == ""))
  expect_identical(anyDuplicated(substances), 0L)
})

test_that("build_substance_set_keys joins sorted unique keys with '|'", {
  substances <- dplyr::tibble(
    ema_product_number = c("A", "A", "B"),
    substance = c("Zidovudine", "abacavir", "abacavir"),
    substance_key = c("zidovudine", "abacavir", "abacavir")
  )
  expect_identical(
    build_substance_set_keys(substances),
    dplyr::tibble(
      ema_product_number = c("A", "B"),
      substance_set_key = c("abacavir|zidovudine", "abacavir")
    )
  )
})

test_that("add_substance_set_keys appends the key, null without substances", {
  medicines <- dplyr::tibble(
    ema_product_number = c("A", "B", "C"),
    medicine_type = "Other"
  )
  substances <- dplyr::tibble(
    ema_product_number = c("A", "A", "C"),
    substance = c("b", "a", "c"),
    substance_key = c("b", "a", "c")
  )
  expect_identical(
    add_substance_set_keys(medicines, substances),
    dplyr::tibble(
      ema_product_number = c("A", "B", "C"),
      medicine_type = "Other",
      substance_set_key = c("a|b", NA, "c")
    )
  )
})
