lumykras_pages <- function() {
  text <- paste(readLines(
    testthat::test_path("fixtures", "efficacy", "lumykras-pi.layout.txt"),
    encoding = "UTF-8", warn = FALSE
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

test_that("two SmPC copies: only the first is read", {
  pages <- c(
    "Start\n5.1 Pharmacodynamic properties\nFirst copy efficacy",
    "more data\n5.2 Pharmacokinetic properties\nEnd first SmPC",
    "Repeat for second strength:\n5.1 Pharmacodynamic properties",
    "Second copy efficacy\n5.2 Pharmacokinetic properties"
  )
  section <- slice_smpc_efficacy(pages)
  expect_match(section$text, "First copy efficacy", fixed = TRUE)
  expect_no_match(section$text, "Second copy efficacy", fixed = TRUE)
})

test_that("no 5.2: ends at the next 5.1 (two copies)", {
  pages <- c(
    "Start\n5.1 Pharmacodynamic properties\nFirst copy efficacy",
    "more data\n5.1 Pharmacodynamic properties\nSecond copy",
    "Second copy efficacy"
  )
  section <- slice_smpc_efficacy(pages)
  expect_match(section$text, "First copy efficacy", fixed = TRUE)
  expect_no_match(section$text, "Second copy", fixed = TRUE)
  # First page starts at "5.1"
  expect_match(section$pages[[1]], "5\\.1 Pharmacodynamic properties",
    perl = TRUE
  )
})

test_that("no 5.2: stops before next 5.1", {
  pages <- c(
    "Start\n5.1 Pharmacodynamic properties\nFirst section",
    "content\n5.1 Pharmacodynamic properties\nSecond"
  )
  section <- slice_smpc_efficacy(pages)
  expect_no_match(section$text, "5.1 Pharmacodynamic properties\nSecond",
    fixed = TRUE
  )
})

test_that("heading at top of page (no preceding newline)", {
  pages <- c(
    "Header\f5.1 Pharmacodynamic properties\nEfficacy data",
    "more data\f5.2 Pharmacokinetic properties"
  )
  section <- slice_smpc_efficacy(pages)
  expect_match(section$text, "Efficacy data", fixed = TRUE)
  expect_no_match(section$text, "5.2\\s+Pharmacokinetic properties",
    perl = TRUE
  )
})

test_that("non-breaking spaces between 5.1 and heading", {
  # Using   for non-breaking space
  pages <- c(
    "Start\n5.1  Pharmacodynamic properties\nEfficacy data",
    "more\n5.2  Pharmacokinetic properties"
  )
  section <- slice_smpc_efficacy(pages)
  expect_match(section$text, "Efficacy data", fixed = TRUE)
  expect_no_match(section$text, "5.2", fixed = TRUE)
})
