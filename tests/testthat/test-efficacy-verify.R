read_efficacy_fixture <- function(name) {
  path <- testthat::test_path("fixtures", "efficacy", name)
  paste(readLines(path, encoding = "UTF-8", warn = FALSE), collapse = "\n")
}

# The layout and the flow text of one section: a quote may be intact in either.
read_efficacy_section <- function(medicine) {
  purrr::map_chr(c("layout", "flow"), function(mode) {
    read_efficacy_fixture(paste0(tolower(medicine), "-pi-5.1.", mode, ".txt"))
  })
}

gold_rows <- function(medicine) {
  rows <- jsonlite::fromJSON(
    testthat::test_path("fixtures", "efficacy", "gold-rows-sample.json"),
    simplifyVector = FALSE
  )
  Filter(function(row) row$medicine == medicine, rows) |>
    purrr::map(function(row) {
      row$quotes <- unlist(row$verbatim_quotes)
      row
    })
}

test_that("every gold row of the pilot verifies against its section text", {
  medicines <- c("Alecensa", "Keytruda", "Tecentriq", "Rybrevant", "Lumykras")
  for (medicine in medicines) {
    text <- read_efficacy_section(medicine)
    for (row in gold_rows(medicine)) {
      result <- verify_efficacy_row(row, text)
      expect_false(
        result$status == "failed",
        info = paste(
          medicine, row$trial, row$endpoint,
          paste(result$errors, collapse = "; ")
        )
      )
    }
  }
})

shift_last_digit <- function(text) {
  digits <- gregexpr("[0-9]", text)[[1]]
  last <- digits[length(digits)]
  shifted <- (as.integer(substr(text, last, last)) + 1L) %% 10L
  substr(text, last, last) <- as.character(shifted)
  text
}

test_that("a shifted digit in a number field fails (mutation test)", {
  text <- read_efficacy_section("Keytruda")
  mutated <- 0L
  for (row in gold_rows("Keytruda")) {
    for (field in c("value", "ci_low", "ci_high", "p_value")) {
      original <- row[[field]]
      if (is.null(original) || !grepl("[0-9]", original)) next
      row[[field]] <- shift_last_digit(original)
      result <- verify_efficacy_row(row, text)
      expect_equal(result$status, "failed", info = paste(field, original))
      row[[field]] <- original
      mutated <- mutated + 1L
    }
  }
  expect_gt(mutated, 0L)
})

test_that("a number that only starts or ends a longer one fails", {
  row <- list(quotes = "HR 0.61 (0.5, 0.7) p = 0.031", value = "0.6")
  result <- verify_efficacy_row(row, "HR 0.61 (0.5, 0.7) p = 0.031")
  expect_equal(result$status, "failed")
  expect_match(result$errors, "value = '0.6' not in the quotes")
  row <- list(quotes = "HR 0.61 (0.5, 0.7) p = 0.031", p_value = "0.03")
  result <- verify_efficacy_row(row, "HR 0.61 (0.5, 0.7) p = 0.031")
  expect_equal(result$status, "failed")
  expect_match(result$errors, "p_value = '0.03' not in the quotes")
  row <- list(quotes = "median 10.5 months", arm_control = "10.5 months")
  row$arm_treatment <- "0.5"
  expect_equal(
    verify_efficacy_row(row, "median 10.5 months")$status, "failed"
  )
})

test_that("a number may end a sentence", {
  quote <- "the hazard ratio was 0.59 (0.40, 0.89), p-value of 0.0106."
  row <- list(quotes = quote, value = "0.59", ci_low = "0.40",
              ci_high = "0.89", p_value = "0.0106")
  expect_equal(verify_efficacy_row(row, quote)$status, "exact")
})

test_that("a row without a usable quote fails", {
  section <- "HR 0.5 (0.4, 0.6)"
  for (quotes in list(character(), "", c("", "  "), NULL)) {
    row <- list(quotes = quotes)
    result <- verify_efficacy_row(row, section)
    expect_equal(result$status, "failed")
    expect_match(result$errors, "no quote")
  }
})
test_that("a quote that is not in the text fails", {
  row <- gold_rows("Alecensa")[[1]]
  row$quotes <- c(row$quotes, "Stratified HR 0.99 (0.10, 0.11)")
  result <- verify_efficacy_row(row, read_efficacy_section("Alecensa"))
  expect_equal(result$status, "failed")
  expect_match(paste(result$errors, collapse = " "), "quote not in the text")
})

test_that("a quote found in only one of the texts passes", {
  row <- list(quotes = "Median OS 12.1 months", value = "12.1", trial = NULL)
  texts <- c("garbled Median OS 12 .1 months", "Median  OS 12.1\nmonths")
  result <- verify_efficacy_row(row, texts)
  expect_equal(result$status, "exact")
})

test_that("a trial name absent from the section fails (no memory names)", {
  row <- gold_rows("Alecensa")[[1]]
  row$trial <- "ALEX-2 (invented)"
  result <- verify_efficacy_row(row, read_efficacy_section("Alecensa"))
  expect_equal(result$status, "failed")
  expect_match(paste(result$errors, collapse = " "), "trial name")
})

test_that("a combined trial name needs every part in the section", {
  row <- list(quotes = "HR 0.5 (0.4, 0.6)", trial = "AAA + BBB, part 2")
  both <- verify_efficacy_row(row, "HR 0.5 (0.4, 0.6) trial AAA and BBB")
  expect_equal(both$status, "exact")
  result <- verify_efficacy_row(row, "HR 0.5 (0.4, 0.6) trial AAA only")
  expect_equal(result$status, "failed")
  expect_match(result$errors, "BBB")
})

test_that("an arm size must occur as n= in the section (thousands space too)", {
  section <- "HR 0.5 (0.4, 0.6) (n = 1 234) versus (N=56)"
  row <- list(
    quotes = "HR 0.5 (0.4, 0.6)", value = "0.5", ci_low = "0.4",
    ci_high = "0.6", n_treatment = 1234L, n_control = 56L
  )
  expect_equal(verify_efficacy_row(row, section)$status, "exact")
  row$n_control <- 57L
  result <- verify_efficacy_row(row, section)
  expect_equal(result$status, "failed")
  expect_match(result$errors, "n_control = 57")
})

test_that("a value and its CI must stand together in one quote", {
  row <- list(
    quotes = c("HR 0.5", "CI 0.4 to 0.6"),
    value = "0.5", ci_low = "0.4", ci_high = "0.6"
  )
  result <- verify_efficacy_row(row, "HR 0.5 and elsewhere CI 0.4 to 0.6")
  expect_equal(result$status, "failed")
  expect_match(result$errors, "value and CI not in one quote")
})

test_that("a number field missing from the quotes fails", {
  row <- list(quotes = "HR 0.5 (0.4, 0.6)", p_value = "0.031")
  result <- verify_efficacy_row(row, "HR 0.5 (0.4, 0.6)")
  expect_equal(result$status, "failed")
  expect_match(result$errors, "p_value = '0.031' not in the quotes")
})

test_that("an arm value rebuilt from split table cells is only a warning", {
  row <- gold_rows("Alecensa")[[1]]
  result <- verify_efficacy_row(row, read_efficacy_section("Alecensa"))
  expect_equal(result$status, "reassembled")
  expect_match(paste(result$warnings, collapse = " "), "reassembled")
})

test_that("a blank trial name is not checked", {
  for (trial in c("", "   ")) {
    row <- list(quotes = "HR 0.5", trial = trial)
    expect_equal(verify_efficacy_row(row, "HR 0.5")$status, "exact")
  }
})

test_that("null and NA fields are not checked", {
  row <- list(
    quotes = "HR 0.5", value = NA_character_, ci_low = NULL,
    trial = NA_character_, n_treatment = NA_integer_
  )
  expect_equal(verify_efficacy_row(row, "HR 0.5")$status, "exact")
})

test_that("normalising removes page numbers, private-use glyphs, odd spaces", {
  expect_equal(
    normalise_efficacy_text("overall\n  25  \nsurvival  rate"),
    "overall survival rate"
  )
  expect_equal(normalise_efficacy_text("a\u00a0b\u2009c\u202fd"), "a b c d")
  expect_equal(normalise_efficacy_text("HR\uf0b7 0.5"), "HR 0.5")
  expect_equal(normalise_efficacy_text("end\fpage two"), "end page two")
})

test_that("the page of a quote is found, also across a page break", {
  pages <- c(
    "first page text", "Median OS 12.1 months\nwas", "reported in the trial"
  )
  expect_equal(efficacy_quote_page("Median OS 12.1 months", pages), 2L)
  expect_equal(efficacy_quote_page("was reported in the trial", pages), 2L)
  expect_true(is.na(efficacy_quote_page("not there", pages)))
  expect_true(is.na(efficacy_quote_page("not there", "one page only")))
  expect_true(is.na(efficacy_quote_page("", pages)))
  expect_true(is.na(efficacy_quote_page("anything", character())))
})
