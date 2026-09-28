# Clean medicines whose INN field never repeats the medicine's name.
with_brand_names <- function(clean_medicines) {
  dplyr::mutate(
    clean_medicines,
    name_of_medicine = "Brand",
    active_substance = NA_character_
  )
}

test_that("build_substances_table splits on ';' and ' / ', squishes, sorts", {
  clean_medicines <- with_brand_names(dplyr::tibble(
    ema_product_number = c("B", "A", "C", "D"),
    international_non_proprietary_name_common_name = c(
      "tezacaftor / ivacaftor;elexacaftor",
      " Metformin  hydrochloride ; sitagliptin;;",
      NA,
      "sitagliptin;sitagliptin"
    )
  ))
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
  clean_medicines <- with_brand_names(dplyr::tibble(
    ema_product_number = c("A", "B", "C"),
    international_non_proprietary_name_common_name = c(
      "Mycobacterium tuberculosis derived antigens (rdESAT-6 / rCFP-10)",
      "A/VietNam/1194/2004",
      "extract 30 per cent (W/W) of Allium cepa"
    )
  ))
  expect_identical(
    build_substances_table(clean_medicines)$substance,
    clean_medicines$international_non_proprietary_name_common_name
  )
})

test_that("build_substances_table does not merge salts", {
  clean_medicines <- with_brand_names(dplyr::tibble(
    ema_product_number = c("A", "B"),
    international_non_proprietary_name_common_name = c(
      "metformin hydrochloride",
      "metformin"
    )
  ))
  expect_identical(
    build_substances_table(clean_medicines)$substance_key,
    c("metformin hydrochloride", "metformin")
  )
})

# Vysribli, a denosumab biosimilar: EMA's INN field repeats its name.
vysribli_medicines <- function() {
  dplyr::tibble(
    ema_product_number = c("EMEA/H/C/002321", "EMEA/H/C/006797"),
    name_of_medicine = c("Zytiga", "Vysribli (previously Denosumab Intas)"),
    international_non_proprietary_name_common_name = c(
      "abiraterone",
      "Vysribli"
    ),
    active_substance = c("abiraterone acetate", " denosumab ")
  )
}

test_that("build_substances_table reads the active substance for a named INN", {
  expect_identical(
    build_substances_table(vysribli_medicines()),
    dplyr::tibble(
      ema_product_number = c("EMEA/H/C/002321", "EMEA/H/C/006797"),
      substance = c("abiraterone", "denosumab"),
      substance_key = c("abiraterone", "denosumab")
    )
  )
})

test_that("the search index keys a named INN by its active substance", {
  clean_medicines <- vysribli_medicines()
  medicines <- dplyr::mutate(
    clean_medicines,
    medicine_status = "Authorised",
    marketing_authorisation_date = as.Date(c("2011-09-05", "2025-09-15")),
    medicine_type = c("Other", "Biosimilar"),
    orphan_medicine = FALSE
  )
  index <- build_search_index(
    medicines,
    build_substances_table(clean_medicines),
    build_lookup_table(clean_medicines, "active_substance")
  )
  vysribli <- index[index$ema_product_number == "EMEA/H/C/006797", ]
  expect_identical(vysribli$substances, "denosumab")
  expect_identical(vysribli$substance_keys, list("denosumab"))
})

test_that("inn_names_medicine ignores case and the name's parentheses", {
  expect_identical(
    inn_names_medicine(
      c("Vysribli", "garenoxacin mesylate", "abiraterone", NA),
      c(
        "Vysribli (previously Denosumab Intas)", "Garenoxacin mesylate",
        "Zytiga", "IXinity"
      )
    ),
    c(TRUE, TRUE, FALSE, FALSE)
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

# Real pairs: Dasatinib Accord Healthcare (dasatinib) is a generic of Sprycel
# (dasatinib (anhydrous)); Sitagliptin SUN (sitagliptin fumarate) and
# Sitagliptin / Metformin hydrochloride Mylan (sitagliptin hydrochloride
# monohydrate) are generics of Januvia and Janumet (sitagliptin).
equivalent_pairs <- function() {
  dplyr::tibble(
    substance_key = c("dasatinib", "sitagliptin", "sitagliptin"),
    equivalent_key = c(
      "dasatinib (anhydrous)",
      "sitagliptin fumarate",
      "sitagliptin hydrochloride monohydrate"
    ),
    evidence_url = paste0(
      "https://www.ema.europa.eu/en/medicines/human/EPAR/",
      c(
        "dasatinib-accord-healthcare",
        "sitagliptin-sun",
        "sitagliptin-metformin-hydrochloride-mylan"
      )
    ),
    checked_date = as.Date("2026-09-28"),
    note = c("Generic of Sprycel", "Generic of Januvia", "Generic of Janumet")
  )
}

substances_with_keys <- function(keys) {
  dplyr::tibble(
    ema_product_number = paste0("EMEA/H/C/", seq_along(keys)),
    substance = keys,
    substance_key = keys
  )
}

test_that("build_substance_equivalents writes both directions", {
  substances <- substances_with_keys(c(
    "sitagliptin fumarate", "dasatinib", "sitagliptin",
    "dasatinib (anhydrous)", "sitagliptin hydrochloride monohydrate"
  ))
  equivalents <- build_substance_equivalents(
    equivalent_pairs(),
    substances
  )
  expect_named(
    equivalents,
    c(
      "substance_key", "equivalent_key", "basis", "evidence_url",
      "checked_date", "source"
    )
  )
  expect_identical(
    equivalents$substance_key,
    c(
      "dasatinib", "dasatinib (anhydrous)", "sitagliptin", "sitagliptin",
      "sitagliptin fumarate", "sitagliptin hydrochloride monohydrate"
    )
  )
  expect_identical(
    equivalents$equivalent_key,
    c(
      "dasatinib (anhydrous)", "dasatinib", "sitagliptin fumarate",
      "sitagliptin hydrochloride monohydrate", "sitagliptin", "sitagliptin"
    )
  )
  expect_identical(unique(equivalents$basis), "curated")
  expect_identical(unique(equivalents$source), "curated")
  expect_identical(
    equivalents$evidence_url[equivalents$substance_key == "dasatinib"],
    equivalent_pairs()$evidence_url[1]
  )
  expect_identical(unique(equivalents$checked_date), as.Date("2026-09-28"))
})

test_that("build_substance_equivalents drops pairs not in the data", {
  substances <- substances_with_keys(c(
    "dasatinib", "dasatinib (anhydrous)", "sitagliptin"
  ))
  expect_warning(
    equivalents <- build_substance_equivalents(
      equivalent_pairs(),
      substances
    ),
    "sitagliptin fumarate"
  )
  expect_identical(
    equivalents$substance_key,
    c("dasatinib", "dasatinib (anhydrous)")
  )
})

test_that("check_substance_equivalents stops on malformed rows", {
  pairs <- equivalent_pairs()
  expect_identical(check_substance_equivalents(pairs), pairs)

  self_pair <- pairs
  self_pair$equivalent_key[1] <- "dasatinib"
  expect_error(check_substance_equivalents(self_pair), "dasatinib")

  reversed <- dplyr::bind_rows(
    pairs,
    dplyr::mutate(
      pairs[1, ],
      substance_key = "dasatinib (anhydrous)",
      equivalent_key = "dasatinib"
    )
  )
  expect_error(check_substance_equivalents(reversed), "more than once")

  insecure <- pairs
  insecure$evidence_url[2] <- "http://www.ema.europa.eu/"
  expect_error(check_substance_equivalents(insecure), "sitagliptin fumarate")

  undated <- pairs
  undated$checked_date[3] <- NA
  expect_error(
    check_substance_equivalents(undated),
    "sitagliptin hydrochloride monohydrate"
  )

  unfolded <- pairs
  unfolded$substance_key[1] <- "Dasatinib "
  expect_error(check_substance_equivalents(unfolded), "Dasatinib")
})

test_that("equivalent_substance_keys gives one key per equivalent group", {
  pairs <- dplyr::tibble(
    substance_key = c("sevelamer", "sevelamer carbonate", "metformin"),
    equivalent_key = c(
      "sevelamer hydrochloride",
      "sevelamer hydrochloride",
      "metformin hydrochloride"
    )
  )
  expect_identical(
    equivalent_substance_keys(
      c(
        "sevelamer carbonate", "sevelamer hydrochloride", "sevelamer",
        "metformin hydrochloride", "budesonide"
      ),
      pairs
    ),
    c("sevelamer", "sevelamer", "sevelamer", "metformin", "budesonide")
  )
  expect_identical(
    equivalent_substance_keys(c("a", "b"), pairs[0, ]),
    c("a", "b")
  )
})

test_that("the curated equivalents are well formed", {
  equivalents <- curated_substance_equivalents()
  expect_identical(check_substance_equivalents(equivalents), equivalents)
  expect_true(all(startsWith(
    equivalents$evidence_url,
    "https://www.ema.europa.eu/"
  )))
  expect_false(anyNA(equivalents$note))
})

# Different esters and prodrugs are different active substances in EU
# practice: fluticasone furoate got its own new-active-substance status.
test_that("the curated equivalents never pair different esters or prodrugs", {
  equivalents <- curated_substance_equivalents()
  groups <- equivalent_substance_keys(
    c(
      "fluticasone furoate", "fluticasone propionate",
      "tenofovir disoproxil", "tenofovir alafenamide"
    ),
    equivalents
  )
  expect_false(groups[1] == groups[2])
  expect_false(groups[3] == groups[4])
})
