lumykras_pages <- function() {
  text <- paste(readLines(
    testthat::test_path("fixtures", "efficacy", "lumykras-pi.layout.txt"),
    encoding = "UTF-8"
  ), collapse = "\n")
  strsplit(text, "\f", fixed = TRUE)[[1]]
}

test_that("section 5.1 is sliced from its start to 5.2 of the first SmPC", {
  section <- slice_smpc_efficacy(lumykras_pages())
  expect_match(section$text, "CodeBreaK 100", fixed = TRUE)
  expect_no_match(section$text, "5.2\\s+Pharmacokinetic properties",
    perl = TRUE
  )
  expect_gt(length(section$pages), 0)
})

test_that("a PI without section 5.1 gives no section", {
  expect_true(is.na(slice_smpc_efficacy(
    c("ANNEX I", "no sections here")
  )$text))
})

test_that("the section text equals its pages joined", {
  section <- slice_smpc_efficacy(lumykras_pages())
  expect_equal(
    normalise_efficacy_text(section$text),
    normalise_efficacy_text(paste(section$pages, collapse = "\n"))
  )
})
