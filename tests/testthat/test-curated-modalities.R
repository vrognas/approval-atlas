test_that("curated modalities are well formed", {
  curated <- curated_modalities()
  expect_invisible(check_curated_modalities(curated))
  expect_named(curated, c(
    "substance_key", "ema_product_number", "modality_group", "modality",
    "evidence_url", "quote", "checked_date", "reviewed", "note"
  ))
  expect_true(all(curated$reviewed))
  # Quotes are at most 20 words.
  word_counts <- lengths(strsplit(curated$quote, "\\s+"))
  expect_true(all(word_counts <= 20), info = paste(
    curated$substance_key[word_counts > 20],
    collapse = ", "
  ))
  expect_true(all(startsWith(curated$evidence_url, "https://")))
  # The owner's decisions (modality-spec.md section 13).
  decided <- stats::setNames(curated$modality, curated$substance_key)
  expect_identical(
    unname(decided[c(
      "sugammadex", "porfimer sodium", "ciclosporin", "romiplostim",
      "efgartigimod alfa", "lerodalcibep", "atosiban", "bulevirtide"
    )]),
    c("small_molecule", "small_molecule", "small_molecule", "fusion_protein",
      "other_protein", "fusion_protein", "peptide", "peptide")
  )
  # "live" is Rotashield's alone, not every future "rotavirus vaccine".
  rotashield <- curated[curated$substance_key == "rotavirus vaccine", ]
  expect_identical(rotashield$ema_product_number, "EMEA/H/C/000192")
  expect_match(rotashield$quote, "oral, live", fixed = TRUE)
})

test_that("malformed curated rows stop the build", {
  curated <- curated_modalities()
  bad_leaf <- curated
  bad_leaf$modality[1] <- "sirna"
  expect_error(check_curated_modalities(bad_leaf), "blinatumomab")
  bad_url <- curated
  bad_url$evidence_url[2] <- "http://example.org"
  expect_error(check_curated_modalities(bad_url), "emicizumab")
  no_date <- curated
  no_date$checked_date[3] <- NA
  expect_error(check_curated_modalities(no_date), "amivantamab")
  no_quote <- curated
  no_quote$quote[4] <- NA
  expect_error(check_curated_modalities(no_quote), "faricimab")
  # Unreviewed rows need no quote yet.
  no_quote$reviewed[4] <- FALSE
  expect_invisible(check_curated_modalities(no_quote))
  upper_case <- curated
  upper_case$substance_key[5] <- "Mosunetuzumab"
  expect_error(check_curated_modalities(upper_case), "Mosunetuzumab")
  no_group <- curated
  no_group$modality_group[6] <- NA
  expect_error(check_curated_modalities(no_group), "glofitamab")
  # A row added without a date or a review status is caught, never
  # filled in (and so never applied unchecked).
  unchecked <- dplyr::tibble(
    substance_key = "examplimab",
    ema_product_number = NA_character_,
    modality_group = "antibody",
    modality = "bispecific_antibody",
    evidence_url = "https://www.ema.europa.eu/",
    quote = "Examplimab is a bispecific antibody."
  )
  expect_error(
    check_curated_modalities(dplyr::bind_rows(
      curated,
      dplyr::mutate(unchecked, reviewed = TRUE)
    )),
    "examplimab"
  )
  expect_error(
    check_curated_modalities(dplyr::bind_rows(
      curated,
      dplyr::mutate(unchecked, checked_date = as.Date("2026-09-29"))
    )),
    "examplimab"
  )
  twice <- dplyr::bind_rows(curated, curated[7, ])
  expect_error(check_curated_modalities(twice), "more than once")
  product_row <- curated[curated$substance_key == "besilesomab", ]
  expect_error(
    check_curated_modalities(dplyr::bind_rows(curated, product_row)),
    "besilesomab \\(EMEA/H/C/000653\\)"
  )
  expect_error(
    build_modality_tables(
      read_fixture_modality_tables(),
      empty_chembl_matches(),
      bad_leaf
    ),
    "blinatumomab"
  )
})
