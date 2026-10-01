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
  row <- list(
    quotes = "HR 0.61 (0.5, 0.7) p = 0.031", value = "0.61", p_value = "0.03"
  )
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
    expect_match(paste(result$errors, collapse = " "), "no quote")
  }
})
test_that("a quote that is not in the text fails", {
  row <- gold_rows("Alecensa")[[1]]
  row$quotes <- c(row$quotes, "Stratified HR 0.99 (0.10, 0.11)")
  result <- verify_efficacy_row(row, read_efficacy_section("Alecensa"))
  expect_equal(result$status, "failed")
  expect_match(paste(result$errors, collapse = " "), "quote not in the text")
})

test_that("one quote holding every number of the row is enough", {
  # What the prompt asks for first: a single quote. KEYNOTE-024's PFS row
  # without its context quote ("The primary efficacy outcome measure was
  # PFS ..."); MARIPOSA's gold row has only the one quote.
  text <- read_efficacy_section("Keytruda")
  pfs <- Filter(
    \(row) row$trial == "KEYNOTE-024" && row$endpoint == "PFS",
    gold_rows("Keytruda")
  )[[1]]
  pfs$quotes <- pfs$quotes[grepl("Hazard ratio", pfs$quotes, fixed = TRUE)]
  expect_length(pfs$quotes, 1)
  expect_false(verify_efficacy_row(pfs, text)$status == "failed")
  mariposa <- Filter(
    \(row) startsWith(row$trial, "MARIPOSA ("), gold_rows("Rybrevant")
  )[[1]]
  expect_length(mariposa$quotes, 1)
  result <- verify_efficacy_row(mariposa, read_efficacy_section("Rybrevant"))
  expect_false(result$status == "failed")
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
  row <- list(
    quotes = "HR 0.5 (0.4, 0.6)", value = "0.5", trial = "AAA + BBB, part 2"
  )
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
  row <- list(quotes = "HR 0.5 (0.4, 0.6)", value = "0.5", p_value = "0.031")
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
    row <- list(quotes = "HR 0.5", value = "0.5", trial = trial)
    expect_equal(verify_efficacy_row(row, "HR 0.5")$status, "exact")
  }
})

test_that("null and NA fields are not checked", {
  row <- list(
    quotes = "HR 0.5", value = "0.5", ci_low = NULL, ci_high = NA_character_,
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

test_that("an arm size printed with a thousands comma is found", {
  row <- list(
    quotes = "HR 0.5 (0.4, 0.6)", value = "0.5", ci_low = "0.4",
    ci_high = "0.6", n_treatment = 1274L
  )
  section <- "HR 0.5 (0.4, 0.6) (n = 1,274)"
  expect_equal(verify_efficacy_row(row, section)$status, "exact")
})

test_that("a row without a value fails (no value, no row)", {
  for (value in list(NULL, NA_character_, "", "  ")) {
    row <- list(quotes = "HR 0.5 (0.4, 0.6)", value = value)
    result <- verify_efficacy_row(row, "HR 0.5 (0.4, 0.6)")
    expect_equal(result$status, "failed")
    expect_match(paste(result$errors, collapse = " "), "no value")
  }
})

test_that("a short whole-number value is checked, not read as a page number", {
  row <- list(quotes = "ORR was 37 %", value = "12")
  result <- verify_efficacy_row(row, "ORR was 37 %")
  expect_equal(result$status, "failed")
  expect_match(result$errors, "value = '12' not in the quotes")
  row$value <- "37"
  expect_equal(verify_efficacy_row(row, "ORR was 37 %")$status, "exact")
})

# ALEX prints the comparator first: arms taken from the wrong column must fail.
test_that("the comparator's column label shares a quote with its arm", {
  section <- paste(
    "Median PFS was 34.8 months with Alecensa.",
    "Median PFS was 10.9 months with crizotinib."
  )
  row <- list(
    quotes = c(
      "Median PFS was 34.8 months with Alecensa.",
      "Median PFS was 10.9 months with crizotinib."
    ),
    value = "34.8", comparator = "crizotinib",
    comparator_column_label = "crizotinib",
    arm_treatment = "34.8", arm_control = "10.9"
  )
  expect_equal(verify_efficacy_row(row, section)$status, "exact")
  swapped <- row
  swapped$arm_treatment <- "10.9"
  swapped$arm_control <- "34.8"
  result <- verify_efficacy_row(swapped, section)
  expect_equal(result$status, "failed")
  expect_match(
    paste(result$errors, collapse = " "),
    "comparator_column_label 'crizotinib' not in a quote with arm_control"
  )
  invented <- row
  invented$comparator_column_label <- "Docetaxel"
  expect_equal(verify_efficacy_row(invented, section)$status, "failed")
})

test_that("a label without control values is only looked up in the text", {
  section <- "Crizotinib Alecensa HR 0.47 (0.34, 0.65)"
  row <- list(
    quotes = "HR 0.47 (0.34, 0.65)", value = "0.47", ci_low = "0.34",
    ci_high = "0.65", comparator = "crizotinib",
    comparator_column_label = "Crizotinib"
  )
  result <- verify_efficacy_row(row, section)
  expect_equal(result$status, "exact")
  expect_equal(result$flags, character())
  row$comparator_column_label <- "Docetaxel"
  result <- verify_efficacy_row(row, section)
  expect_equal(result$status, "exact")
  expect_equal(result$flags, "text_not_in_source")
})

test_that("text not in the section is flagged, not failed", {
  section <- paste(
    "In KEYNOTE-024, patients with PD-L1 TPS >= 50% received",
    "pembrolizumab or platinum chemotherapy. PFS as assessed by BICR:",
    "HR 0.50 (95% CI: 0.37, 0.68)."
  )
  row <- list(
    quotes = "HR 0.50 (95% CI: 0.37, 0.68).", value = "0.50",
    ci_low = "0.37", ci_high = "0.68", ci_level = 95,
    population = "PD-L1 TPS >= 50%", regimen = "Pembrolizumab",
    comparator = "platinum  chemotherapy", endpoint = "PFS",
    assessment = "bicr"
  )
  result <- verify_efficacy_row(row, section)
  expect_equal(result$status, "exact")
  expect_equal(result$flags, character())
  fields <- c("population", "regimen", "comparator", "endpoint", "assessment")
  for (field in fields) {
    changed <- row
    changed[[field]] <- "a paraphrase"
    result <- verify_efficacy_row(changed, section)
    expect_equal(result$status, "exact", info = field)
    expect_equal(result$flags, "text_not_in_source", info = field)
  }
})

test_that("an indication not in section 4.1 is flagged", {
  indications <- paste(
    "KEYTRUDA as monotherapy is indicated for the first-line treatment of",
    "metastatic non-small cell lung carcinoma in adults."
  )
  row <- list(
    quotes = "HR 0.5", value = "0.5",
    indication = "KEYTRUDA as monotherapy is indicated for the first-line
      treatment of metastatic non-small cell lung carcinoma in adults."
  )
  result <- verify_efficacy_row(row, "HR 0.5", indications)
  expect_equal(result$flags, character())
  row$indication <- "First-line NSCLC"
  result <- verify_efficacy_row(row, "HR 0.5", indications)
  expect_equal(result$status, "exact")
  expect_equal(result$flags, "indication_not_in_source")
  expect_equal(verify_efficacy_row(row, "HR 0.5")$flags, character())
})

test_that("a CI level the text never prints is flagged", {
  row <- list(
    quotes = "HR 0.5 (0.4, 0.6)", value = "0.5", ci_low = "0.4",
    ci_high = "0.6", ci_level = 97.38
  )
  result <- verify_efficacy_row(row, "HR 0.5 (0.4, 0.6)")
  expect_equal(result$status, "exact")
  expect_equal(result$flags, "ci_level_not_in_source")
  sections <- c(
    "97.38% CI: HR 0.5 (0.4, 0.6)", "HR 0.5 (0.4, 0.6); 97.38 % confidence"
  )
  for (section in sections) {
    expect_equal(verify_efficacy_row(row, section)$flags, character())
  }
  expect_equal(
    verify_efficacy_row(row, "HR 0.5 (0.4, 0.6); 197.38% CI")$flags,
    "ci_level_not_in_source"
  )
  row$ci_level <- NULL
  expect_equal(
    verify_efficacy_row(row, "HR 0.5 (0.4, 0.6)")$flags, character()
  )
})

test_that("an arm size found only outside the quotes is flagged", {
  section <- "Alecensa (n = 152) or crizotinib (n = 151). HR 0.47 (0.34, 0.65)"
  row <- list(
    quotes = "HR 0.47 (0.34, 0.65)", value = "0.47", ci_low = "0.34",
    ci_high = "0.65", n_treatment = 152L, n_control = 151L
  )
  result <- verify_efficacy_row(row, section)
  expect_equal(result$status, "exact")
  expect_equal(result$flags, "n_not_in_quotes")
  row$quotes <- c(
    "HR 0.47 (0.34, 0.65)", "Alecensa (n = 152) or crizotinib (n = 151)."
  )
  expect_equal(verify_efficacy_row(row, section)$flags, character())
})

test_that("trial names and registry numbers match whole words only", {
  row <- list(quotes = "HR 0.5", value = "0.5", trial = "KEYNOTE-02")
  expect_equal(
    verify_efficacy_row(row, "HR 0.5 in KEYNOTE-024")$status, "failed"
  )
  section <- "HR 0.5 in the ALEX trial (BO28984)"
  row$trial <- "ALEX (BO99999)"
  result <- verify_efficacy_row(row, section)
  expect_equal(result$status, "failed")
  expect_match(paste(result$errors, collapse = " "), "BO99999")
  row$trial <- "ALEX (BO28984)"
  expect_equal(verify_efficacy_row(row, section)$status, "exact")
  row$trial <- "ALE"
  expect_equal(verify_efficacy_row(row, section)$status, "failed")
  # A bracketed phrase describes the trial (the pilot's gold rows), not names.
  row$trial <- "ALEX (alectinib vs crizotinib)"
  expect_equal(verify_efficacy_row(row, section)$status, "exact")
})

test_that("a three-digit number is not found inside a thousands number", {
  row <- list(quotes = "a total of 1,234 patients", value = "234")
  expect_equal(
    verify_efficacy_row(row, "a total of 1,234 patients")$status, "failed"
  )
  quote <- "HR 0.47 [0.34,0.65]"
  row <- list(quotes = quote, value = "0.47", ci_low = "0.34", ci_high = "0.65")
  expect_equal(verify_efficacy_row(row, quote)$status, "exact")
  row <- list(quotes = "234 patients, 1,234 in all", value = "234")
  expect_equal(
    verify_efficacy_row(row, "234 patients, 1,234 in all")$status, "exact"
  )
})
