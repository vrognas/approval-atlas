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
  # The Symbol font's "=" (Alecensa's "n = 67") is read both ways.
  expect_equal(
    symbol_font_renderings("n \uf03d 67, n\uf03d35"),
    c("n \uf03d 67, n\uf03d35", "n = 67, n=35")
  )
  expect_equal(symbol_font_renderings("n = 67"), "n = 67")
  section <- "Responders n \uf03d 67, HR 0.5 (0.4, 0.6)"
  row <- list(
    value = "0.5", ci_low = "0.4", ci_high = "0.6", n_treatment = 67L,
    quotes = "Responders n 67, HR 0.5 (0.4, 0.6)"
  )
  expect_equal(verify_efficacy_row(row, section)$status, "exact")
  row$quotes <- "Responders n = 67, HR 0.5 (0.4, 0.6)"
  expect_equal(verify_efficacy_row(row, section)$status, "exact")
  expect_equal(efficacy_quote_page(row$quotes, c("x", section)), 2L)
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

test_that("the page of a table row quoted in reading order is found", {
  quote <- "Stratified hazard ratio‡ (95% CI) 0.79 (0.64, 0.98)"
  row <- "  Stratified hazard ratio (95% CI)        0.79 (0.64, 0.98)"
  mark <- "                        ‡"
  pages <- c("first page text", paste("Table 3", mark, row, sep = "\n"))
  expect_equal(efficacy_quote_page(quote, pages), 2L)
  # Its footnote mark at the foot of the page before.
  pages <- c(paste("first page text", mark, sep = "\n"), row, "third")
  expect_equal(efficacy_quote_page(quote, pages), 1L)
  expect_true(is.na(efficacy_quote_page(quote, c("first", row))))
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
  expect_match(paste(result$errors, collapse = " "), "arms swapped")
  # A label in no quote is unverified, not a swap: the arms are blanked.
  invented <- row
  invented$comparator_column_label <- "Docetaxel"
  result <- verify_efficacy_row(invented, section)
  expect_equal(result$status, "exact")
  expect_setequal(
    result$blanked,
    c("arm_treatment", "arm_control", "comparator_column_label")
  )
  expect_true("arms_not_verified" %in% result$flags)
})

# A label ties the control arm's values to their column; with none it says
# nothing checkable (the treatment's header passed as the comparator's), so
# it is dropped, never shown, and hides nothing.
test_that("a label without control values is dropped, not flagged", {
  section <- "Crizotinib Alecensa HR 0.47 (0.34, 0.65)"
  row <- list(
    quotes = "HR 0.47 (0.34, 0.65)", value = "0.47", ci_low = "0.34",
    ci_high = "0.65", comparator = "crizotinib",
    comparator_column_label = "Alecensa"
  )
  result <- verify_efficacy_row(row, section)
  expect_equal(result$status, "exact")
  expect_equal(result$blanked, "comparator_column_label")
  expect_equal(result$flags, character())
  kept <- without_unverified_arms(row, result$blanked)
  expect_null(kept$comparator_column_label)
  row$comparator_column_label <- "Docetaxel"
  result <- verify_efficacy_row(row, section)
  expect_equal(result$blanked, "comparator_column_label")
  expect_equal(result$flags, character())
})

# Arm sizes say which arm is which, as arm values do (review of the prompt
# change, 2026-10-01: LAURA's swapped "n=73" vs "n=143" was shown).
test_that("the label shares a quote with the control arm's size", {
  section <- paste(
    "Patients received Drugamab (N=100) or placebo (N=98).",
    "HR 0.60 (0.45, 0.80)."
  )
  hr <- "HR 0.60 (0.45, 0.80)."
  row <- list(
    quotes = c(hr, "Drugamab (N=100) or placebo (N=98)."),
    value = "0.60", ci_low = "0.45", ci_high = "0.80", comparator = "placebo",
    comparator_column_label = "placebo", n_treatment = 100L, n_control = 98L
  )
  result <- verify_efficacy_row(row, section)
  expect_equal(result$status, "exact")
  expect_equal(result$blanked, character())
  expect_equal(result$flags, character())
  # The label quoted with the treatment arm's size, not the control's: a swap.
  swapped <- row
  swapped$quotes <- c(hr, "Drugamab (N=100)", "placebo (N=98)")
  swapped$n_treatment <- 98L
  swapped$n_control <- 100L
  result <- verify_efficacy_row(swapped, section)
  expect_equal(result$status, "failed")
  expect_match(result$errors, "not in a quote with n_control", all = FALSE)
  expect_match(result$errors, "arms swapped", all = FALSE)
  # The label in no quote with the control's size: the sizes cannot be tied
  # to their arms, so they are blanked with the label, which then ties
  # nothing, and nothing hides the row (owner decision 2026-10-01).
  apart <- row
  apart$quotes <- c(hr, "Drugamab (N=100)", "(N=98)")
  result <- verify_efficacy_row(apart, section)
  expect_equal(result$status, "exact")
  expect_setequal(
    result$blanked, c("n_treatment", "n_control", "comparator_column_label")
  )
  expect_equal(result$flags, character())
})

# Owner decision 2026-10-01: a row whose value and CI verify but whose arm
# sizes no label ties to their arms is shown without the sizes, not hidden.
test_that("arm sizes no label ties to their arms are blanked, not flagged", {
  hr <- "HR 0.60 (0.45, 0.80)."
  sizes <- "Drugamab (N=100) or the control arm (N=98)."
  medians <- "Median PFS was 5.2 months with Drugamab and 3.8 with placebo."
  section <- paste("Patients were randomised to", sizes, hr, medians)
  row <- list(
    quotes = c(hr, sizes), value = "0.60", ci_low = "0.45", ci_high = "0.80",
    comparator = "placebo", n_treatment = 100L, n_control = 98L
  )
  result <- verify_efficacy_row(row, section)
  expect_equal(result$status, "exact")
  expect_setequal(result$blanked, c("n_treatment", "n_control"))
  expect_equal(result$flags, character())
  kept <- without_unverified_arms(row, result$blanked)
  expect_null(kept$n_treatment)
  expect_null(kept$n_control)
  expect_equal(kept$value, "0.60")
  # The treatment arm's size alone, on a row of two arms.
  one <- row
  one$n_control <- NULL
  expect_equal(verify_efficacy_row(one, section)$blanked, "n_treatment")
  # The label quoted with the control's size ties both: kept.
  labelled <- c(row, list(comparator_column_label = "control arm"))
  result <- verify_efficacy_row(labelled, section)
  expect_equal(result$blanked, character())
  expect_equal(result$flags, character())
  # The label ties the arm values, not the sizes: only the sizes go.
  arms <- c(row, list(
    comparator_column_label = "placebo", arm_treatment = "5.2",
    arm_control = "3.8"
  ))
  arms$quotes <- c(hr, sizes, medians)
  result <- verify_efficacy_row(arms, section)
  expect_setequal(result$blanked, c("n_treatment", "n_control"))
  expect_equal(result$flags, character())
  # Arm values without a label keep the sizes: efficacy_flags() hides the
  # row (comparator_label_missing) and a human sees them.
  arms$comparator_column_label <- NULL
  expect_equal(verify_efficacy_row(arms, section)$blanked, character())
  # A single-arm row's size names its one arm.
  single <- list(
    quotes = c(hr, sizes), value = "0.60", ci_low = "0.45", ci_high = "0.80",
    effect_type = "single_arm_rate", n_treatment = 100L
  )
  expect_equal(verify_efficacy_row(single, section)$blanked, character())
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

# A single-arm row's: a row of two arms keeps its sizes only with the label
# in a quote with the control's size, so never outside the quotes.
test_that("an arm size found only outside the quotes is flagged", {
  section <- "Alecensa (n = 152) in one arm. ORR 47 (34, 65)"
  row <- list(
    quotes = "ORR 47 (34, 65)", value = "47", ci_low = "34", ci_high = "65",
    effect_type = "single_arm_rate", n_treatment = 152L
  )
  result <- verify_efficacy_row(row, section)
  expect_equal(result$status, "exact")
  expect_equal(result$flags, "n_not_in_quotes")
  row$quotes <- c("ORR 47 (34, 65)", "Alecensa (n = 152) in one arm.")
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

read_excerpt <- function(name) {
  read_efficacy_fixture(paste0("excerpt-", name, ".layout.txt"))
}

# The arm sizes the 2026-10-01 gold evaluation rejected, in the notations
# their SmPCs print (verbatim excerpts of the pilot's section texts).
# Whether the section text states arm size `n` in an n notation.
size_found <- function(n, text) {
  arm_size_found(n, efficacy_section_texts(text))
}

test_that("arm sizes are found in the notations the SmPCs print", {
  found <- size_found
  # Alecensa NP28761 and NP28673: "n = 67" with a Symbol-font "=", a
  # private-use glyph normalising reads as "=".
  alecensa <- read_efficacy_section("Alecensa")[1]
  for (n in c(67L, 35L, 87L, 62L, 122L, 138L)) {
    expect_true(found(n, alecensa), info = n)
  }
  # Retsevmo LIBRETTO-001: a column header "N" over its count ("N 247").
  retsevmo <- read_excerpt("retsevmo-libretto-001")
  expect_true(found(69L, retsevmo))
  expect_true(found(247L, retsevmo))
  # Tagrisso LAURA "(N=143)", Tevimbra "(N = 120)", a header's "(n = 74)".
  expect_true(found(143L, read_excerpt("tagrisso-laura")))
  expect_true(found(120L, read_excerpt("tevimbra-307")))
  expect_true(found(74L, "Pemetrexed + Platinum (n = 74)"))
  expect_true(found(74L, "N=74"))
})

test_that("an arm size stands whole, after n or N on its own", {
  found <- size_found
  expect_false(found(247L, "N 2470"))
  expect_false(found(247L, "N 247.5"))
  expect_false(found(247L, "N = 1,247"))
  expect_false(found(247L, "N = 2470"))
  expect_false(found(247L, "43.3% (n = 107/247)"))
  expect_false(found(247L, "an = 247"))
  expect_false(found(247L, "N2 = 247"))
  expect_true(found(247L, "(n = 247)"))
  expect_true(found(1274L, "N = 1,274"))
  # A column's bare "N 247": a line of its own, the count its only value.
  expect_true(found(247L, " N                  247\n % (95% CI)  61.5"))
  expect_true(found(1274L, " N   1,274"))
  expect_false(found(247L, "N 2470"))
  expect_false(found(247L, "N 247, median"))
  expect_false(found(247L, "N 247 69"))
  expect_false(found(247L, "an 247"))
})

# Review of the verifier tolerance (2026-10-01): a bare "n 189" reads as an
# arm size wherever a table prints events or responders as "n".
test_that("an event or responder count is not an arm size", {
  found <- size_found
  # BGB-A317-305 Table 9: "Disease progression or death, n" over "189 (69.0)",
  # the events; the arm is "(n = 274)".
  tevimbra <- read_excerpt("tevimbra-305")
  expect_false(found(189L, tevimbra))
  expect_true(found(274L, tevimbra))
  expect_true(found(272L, tevimbra))
  # Other tables of the pilot's sections (Tabrecta, Lorviqua, Enhertu, Opdivo).
  expect_false(found(44L, "Number of responders, n 44"))
  expect_false(found(37L, "Partial response, n 37 (52.9)"))
  expect_false(found(12L, "Complete Response n 12 (4.8)"))
  expect_false(found(164L, "Partial Response n 164 (65.6)"))
  expect_false(found(161L, "N 161/588"))
  row <- list(
    trial = "BGB-A317-305", value = "0.68", ci_low = "0.56", ci_high = "0.83",
    n_treatment = 189L, n_control = 272L,
    quotes = c(
      "Hazard ratioc (95% CI) 0.68 (0.56, 0.83)",
      "Disease progression or death, n 189 (69.0) 216 (79.4) (%)"
    )
  )
  result <- verify_efficacy_row(row, tevimbra)
  expect_equal(result$status, "failed")
  expect_match(result$errors, "n_treatment = 189 not found", all = FALSE)
  row$n_treatment <- 274L
  expect_false(verify_efficacy_row(row, tevimbra)$status == "failed")
})

test_that("counts the SmPCs do not print as arm sizes stay rejected", {
  found <- size_found
  # Tagrisso AURAex and AURA2: "In the 411 pre-treated ... patients".
  expect_false(found(411L, read_excerpt("tagrisso-aura")))
  expect_false(found(50L, read_excerpt("tagrisso-aura")))
  # Imfinzi PACIFIC: only a forest plot's "Events/N" denominators, "103/212".
  expect_false(found(212L, read_excerpt("imfinzi-pacific")))
  # Lumykras CodeBreaK 100 DOR: "Number of responders 46" (N = 124).
  lumykras <- read_efficacy_section("Lumykras")[1]
  expect_false(found(46L, lumykras))
  expect_true(found(124L, lumykras))
})

quote_source <- function(quote, text) {
  quote_sources(
    normalise_efficacy_text(quote), normalise_efficacy_text(text), text
  )
}

quote_found <- function(quote, text) !is.na(quote_source(quote, text))

# Quotes the model read off tables in reading order, which the layout text
# prints across lines (the 2026-10-01 gold evaluation rejected them).
test_that("a table row quoted in reading order is found in its layout lines", {
  tecentriq <- read_efficacy_section("Tecentriq")[1]
  # IMpower130 OS: the footnote mark sits on the line above the row.
  expect_true(quote_found(
    "Stratified hazard ratio‡ (95% CI) 0.79 (0.64, 0.98)", tecentriq
  ))
  # MATTERHORN EFS: the footnote letter "c" on the line above.
  expect_true(quote_found(
    "HR (95% CI)c 0.71 (0.58, 0.86)", read_excerpt("imfinzi-matterhorn")
  ))
  # LAURA: the arms' names, a row label, then their sizes, on three lines.
  expect_true(quote_found(
    "TAGRISSO Placebo (N=143) (N=73)", read_excerpt("tagrisso-laura")
  ))
  # BGB-A317-307: the row label's "CI)" wrapped onto the next line.
  expect_true(quote_found(
    paste(
      "Stratified hazard ratioa (95% CI) 0.45 (0.33, 0.62)",
      "0.43 (0.31, 0.60) -"
    ),
    read_excerpt("tevimbra-307")
  ))
  # Runs of spaces between cells and spaces around "," do not matter.
  expect_true(quote_found(
    "Stratified hazard ratio (95 % CI) 0.79 (0.64,0.98)", tecentriq
  ))
})

test_that("a quote whose numbers come from two rows still fails", {
  tecentriq <- read_efficacy_section("Tecentriq")[1]
  # IMpower130 OS: the HR row's label and value with the medians' CI row.
  expect_false(quote_found(
    "Stratified hazard ratio (95% CI) 0.79 (16.0, 21.2)", tecentriq
  ))
  # The treatment arm's median with its CI from the next row, skipping the
  # control arm's median.
  expect_false(quote_found(
    "Median time to events (months) 18.6 (16.0, 21.2)", tecentriq
  ))
  tevimbra <- read_excerpt("tevimbra-307")
  # One row's cells out of their order, or a value with another column's CI.
  expect_false(quote_found(
    "Stratified hazard ratioa (95% CI) 0.43 (0.31, 0.60) 0.45 (0.33, 0.62)",
    tevimbra
  ))
  expect_false(quote_found(
    "Stratified hazard ratioa (95% CI) 0.43 (0.33, 0.62)", tevimbra
  ))
  # LAURA: the header and the PFS hazard ratio, five lines apart.
  expect_false(quote_found(
    paste(
      "TAGRISSO Placebo (N=143) (N=73)",
      "HR (95% CI); P-value 0.16 (0.10, 0.24); P<0.001"
    ),
    read_excerpt("tagrisso-laura")
  ))
})

# Review of the verifier tolerance (2026-10-01): a quote read across layout
# lines must not take what changes a number from another line.
test_that("a sign or a CI bound is not taken from another line", {
  tevimbra <- read_excerpt("tevimbra-305")
  hazard_ratio <- function(value, ci_low) {
    verify_efficacy_row(list(
      trial = "BGB-A317-305", value = value, ci_low = ci_low,
      ci_high = "0.86",
      quotes = sprintf("Hazard ratioc (95%% CI) %s (%s, 0.86)", value, ci_low)
    ), tevimbra)
  }
  # The "-" of "p-valuec,d", the line below the row.
  expect_equal(hazard_ratio("0.71", "-0.58")$status, "failed")
  expect_equal(hazard_ratio("-0.71", "0.58")$status, "failed")
  expect_equal(hazard_ratio("0.71", "0.58")$status, "exact")
  expect_false(quote_found(
    "Hazard ratioc (95% CI) 0.71 (-0.58, 0.86)", tevimbra
  ))
  expect_false(quote_found(
    "Hazard ratioc (95% CI) -0.71 (0.58, 0.86)", tevimbra
  ))
  # LAURA's OS hazard ratio with the "NC" of the median OS row above it: the
  # interval printed is (0.42, 1.56).
  laura <- read_excerpt("tagrisso-laura")
  os_interval <- function(ci_high) {
    verify_efficacy_row(list(
      trial = "LAURA", value = "0.81", ci_low = "0.42", ci_high = ci_high,
      quotes = sprintf("HR (95%% CI); P-value 0.81 (0.42, %s)", ci_high)
    ), laura)
  }
  expect_equal(os_interval("NC")$status, "failed")
  expect_equal(os_interval("1.56")$status, "exact")
})

test_that("a value takes no CI from another column of its row", {
  tevimbra <- read_excerpt("tevimbra-307")
  row <- list(
    trial = "BGB-A317-307", value = "0.45", ci_low = "0.31", ci_high = "0.60",
    n_treatment = 120L, n_control = 121L,
    quotes = paste(
      "Stratified hazard ratioa (95% CI) 0.45 (0.33, 0.62)",
      "0.43 (0.31, 0.60) -"
    )
  )
  # T+PC's 0.45 with T+nPC's interval, the next column.
  result <- verify_efficacy_row(row, tevimbra)
  expect_equal(result$status, "failed")
  expect_match(result$errors, "value and CI not in one quote", all = FALSE)
  row[c("ci_low", "ci_high")] <- list("0.33", "0.62")
  expect_equal(verify_efficacy_row(row, tevimbra)$status, "exact")
  # A CI level between value and CI is no other number.
  binding <- function(quote, value, ci_low, ci_high) {
    value_ci_binding(
      list(value = value, ci_low = ci_low, ci_high = ci_high), quote
    )
  }
  expect_equal(
    binding("HR = 0.82 (95% CI: 0.67, 1.01)", "0.82", "0.67", "1.01"),
    "adjacent"
  )
  expect_equal(
    binding("HR 0.78 [95 % CI] [0.56; 1.08]", "0.78", "0.56", "1.08"),
    "adjacent"
  )
  expect_equal(
    binding("0.73 (95.9% CI: 0.5, 0.9)", "0.73", "0.5", "0.9"), "adjacent"
  )
  expect_equal(
    binding("0.45 (0.33, 0.62) 0.43 (0.31, 0.60)", "0.45", "0.31", "0.60"),
    "none"
  )
  expect_equal(
    binding("HR 0.5 at 12 months (0.4, 0.6)", "0.5", "0.4", "0.6"), "none"
  )
})

# Tables of the 2026-10-01 evaluation that print a row's values, then their
# intervals in the same column order (Libtayo, Keytruda KEYNOTE-158,
# Alecensa NP28673 and ALINA, Lorviqua): kept, flagged for a human.
test_that("a CI paired with its value by column order is flagged", {
  binding <- function(quote, value, ci_low, ci_high) {
    value_ci_binding(
      list(value = value, ci_low = ci_low, ci_high = ci_high), quote
    )
  }
  libtayo <- paste(
    "ORR 50.8% 44.9% 46.4% 95% CI for ORR (37.5, 64.1) (33.6, 56.6)",
    "(33.0, 60.3)"
  )
  expect_equal(binding(libtayo, "44.9", "33.6", "56.6"), "column")
  expect_equal(binding(libtayo, "46.4", "33.0", "60.3"), "column")
  expect_equal(binding(libtayo, "44.9", "37.5", "64.1"), "none")
  expect_equal(binding(libtayo, "50.8", "33.6", "56.6"), "none")
  keynote <- paste(
    "ORR % (95% CI) 52% 40% 63% 45% (40.6, 62.9) (28.0, 52.9) (43.7, 78.9)",
    "(24.4, 67.8)"
  )
  expect_equal(binding(keynote, "40%", "28.0", "52.9"), "column")
  expect_equal(binding(keynote, "45%", "43.7", "78.9"), "none")
  # A count and its percentage in each cell.
  alecensa <- paste(
    "Responders n (%) 62 (50.8 %) 35 (52.2 %) [95 % CI] [41.6 %, 60.0 %]",
    "[39.7 %, 64.6 %]"
  )
  expect_equal(binding(alecensa, "50.8", "41.6", "60.0"), "column")
  expect_equal(binding(alecensa, "52.2", "39.7", "64.6"), "column")
  expect_equal(binding(alecensa, "52.2", "41.6", "60.0"), "none")
  # Words between the values and the intervals: a wrapped label.
  expect_equal(binding(
    paste(
      "Objective response rate 27 (32.1%) 12 (22.2%) (ORR: CR+ PR) (95% CI)",
      "(22.4, 43.2) (12.0, 35.6)"
    ),
    "22.2", "12.0", "35.6"
  ), "column")
  # NR among the values, NE in an interval; equal values in two columns.
  libtayo_dor <- paste(
    "Medianc (months) NR 41.9 41.3 (95% CI) (20.7, NE) (20.5, 54.6)",
    "(40.8, 46.3)"
  )
  expect_equal(binding(libtayo_dor, "NR", "20.7", "NE"), "column")
  expect_equal(binding(libtayo_dor, "41.3", "40.8", "46.3"), "column")
  # One interval short: the columns do not match.
  expect_equal(binding(
    "Medianc (months) NR 41.9 41.3 (95% CI) (20.7, NE) (20.5, 54.6)",
    "NR", "20.7", "NE"
  ), "none")
  expect_equal(binding(
    "Stratified HR 0.24 0.24 (95 % CI)* (0.13, 0.45) (0.13, 0.43)",
    "0.24", "0.13", "0.43"
  ), "column")
  # Not as many values as intervals, or an interval among the values.
  expect_equal(binding(
    "ORR 50.8% 44.9% (37.5, 64.1) (33.6, 56.6) (33.0, 60.3)",
    "44.9", "33.6", "56.6"
  ), "none")
  expect_equal(binding(
    "Stratified hazard ratioa (95% CI) 0.45 (0.33, 0.62) 0.43 (0.31, 0.60) -",
    "0.45", "0.31", "0.60"
  ), "none")
  section <- paste(
    "Study 1540 Group 2", libtayo, "(N=59) (N=78) (N=56)"
  )
  row <- list(
    trial = "Study 1540", value = "44.9", ci_low = "33.6", ci_high = "56.6",
    n_treatment = 78L, quotes = libtayo
  )
  result <- verify_efficacy_row(row, section)
  expect_equal(result$status, "exact")
  expect_true("ci_paired_by_column" %in% result$flags)
  row$quotes <- "HR 44.9 (33.6, 56.6)"
  section <- paste(section, row$quotes)
  expect_false(
    "ci_paired_by_column" %in% verify_efficacy_row(row, section)$flags
  )
})

test_that("a row label is not taken from a line below the row", {
  laura <- read_excerpt("tagrisso-laura")
  # The PFS hazard ratio under "Overall Survival", the heading below it.
  quote <- "Overall Survival HR (95% CI); P-value 0.16 (0.10, 0.24); P<0.001"
  expect_false(quote_found(quote, laura))
  row <- list(
    trial = "LAURA", endpoint = "Overall Survival", value = "0.16",
    ci_low = "0.10", ci_high = "0.24", n_treatment = 143L, n_control = 73L,
    quotes = c(quote, "TAGRISSO Placebo (N=143) (N=73)")
  )
  expect_equal(verify_efficacy_row(row, laura)$status, "failed")
})

test_that("a quote read across layout lines is flagged for a human", {
  tevimbra <- read_excerpt("tevimbra-307")
  # The median OS row's label with the OS hazard ratio row's numbers, the
  # line below: only a human can tell the label is not the row's.
  row <- list(
    trial = "BGB-A317-307", endpoint = "Median OS", value = "0.68",
    ci_low = "0.45", ci_high = "1.01",
    quotes = "Median OS (months) (95% CI) 0.68 (0.45, 1.01)"
  )
  expect_equal(
    quote_source(row$quotes, tevimbra), "layout"
  )
  result <- verify_efficacy_row(row, tevimbra)
  expect_equal(result$status, "exact")
  expect_true("quote_across_lines" %in% result$flags)
  # The row as printed: intact in the text, not flagged.
  row$quotes <- "Stratified hazard ratio (95% CI) 0.68 (0.45, 1.01)"
  expect_equal(quote_source(row$quotes, tevimbra), "verbatim")
  expect_false(
    "quote_across_lines" %in% verify_efficacy_row(row, tevimbra)$flags
  )
})

test_that("a quote stitched across more than three lines still fails", {
  # MARIPOSA OS as the model quoted it (its first 80 characters, the rest as
  # the table prints it): the header with the OS rows, skipping the PFS rows.
  quote <- paste(
    "Rybrevant + lazertinib Osimertinib (N=429) (N=429) Overall survival",
    "(OS) Number of events 173 (40%) 217 (51%) Median, months (95% CI)",
    "NE (42.9, NE) 36.7 (33.4, 41.0) Hazard Ratio (95% CI); p-value",
    "0.75 (0.61, 0.92); p=0.0048"
  )
  rybrevant <- read_efficacy_section("Rybrevant")[1]
  expect_false(quote_found(quote, rybrevant))
  # Its hazard ratio row alone is verbatim.
  expect_true(quote_found(
    "Hazard Ratio (95% CI); p-value 0.75 (0.61, 0.92); p=0.0048", rybrevant
  ))
})

test_that("a row read across layout lines verifies, the CI rule on top", {
  text <- read_excerpt("imfinzi-matterhorn")
  row <- list(
    trial = "MATTERHORN", quotes = "HR (95% CI)c 0.71 (0.58, 0.86)",
    value = "0.71", ci_low = "0.58", ci_high = "0.86", n_treatment = 474L,
    n_control = 474L
  )
  result <- verify_efficacy_row(row, text)
  expect_equal(result$status, "exact")
  expect_equal(result$errors, character())
  row$ci_low <- "0.63"
  expect_equal(verify_efficacy_row(row, text)$status, "failed")
  # Value and CI apart in two quotes, each found: the CI rule rejects it.
  row$ci_low <- "0.58"
  row$quotes <- c("HR (95% CI)c 0.71", "(0.58, 0.86)")
  result <- verify_efficacy_row(row, text)
  expect_equal(result$status, "failed")
  expect_match(result$errors, "value and CI not in one quote", all = FALSE)
})

# Tecentriq IMpower130's OS row as the 2026-10-01 evaluation answered it: the
# medians as arm values, which its HR quote does not hold.
impower130_os <- function(...) {
  row <- list(
    trial = "IMpower130", quotes = c(
      "Stratified hazard ratio‡ (95% CI) 0.79 (0.64, 0.98)",
      "Co-primary endpoints OS n=451 n=228"
    ),
    value = "0.79", ci_low = "0.64", ci_high = "0.98", n_treatment = 451L,
    n_control = 228L, comparator = "nab-paclitaxel and carboplatin",
    comparator_column_label = "Nab-paclitaxel + Carboplatin",
    arm_treatment = "18.6", arm_control = "13.9",
    arm_measure = "median months"
  )
  overrides <- list(...)
  row[names(overrides)] <- overrides
  row
}

test_that("arms that do not verify are blanked and flagged, not rejected", {
  text <- read_efficacy_section("Tecentriq")
  result <- verify_efficacy_row(impower130_os(), text)
  expect_equal(result$status, "exact")
  expect_setequal(result$blanked, efficacy_arm_fields)
  expect_true("arms_not_verified" %in% result$flags)
  kept <- without_unverified_arms(impower130_os(), result$blanked)
  for (field in efficacy_arm_fields) {
    expect_null(kept[[field]], info = field)
  }
  expect_true(all(efficacy_arm_fields %in% names(kept)))
  expect_equal(kept$value, "0.79")
  expect_equal(kept$ci_low, "0.64")
  expect_equal(kept$trial, "IMpower130")
  # The arms quoted too, and no label: nothing is blanked.
  medians <- "Median time to events (months) 18.6 13.9"
  verified <- impower130_os(quotes = c(impower130_os()$quotes, medians))
  verified$comparator_column_label <- NULL
  result <- verify_efficacy_row(verified, text)
  expect_equal(result$blanked, character())
  expect_false("arms_not_verified" %in% result$flags)
})

test_that("arms are not what rejects a row whose value fails", {
  text <- read_efficacy_section("Tecentriq")
  result <- verify_efficacy_row(impower130_os(value = "0.80"), text)
  expect_equal(result$status, "failed")
  expect_equal(result$blanked, character())
  expect_match(result$errors, "value = '0.80'", all = FALSE)
  expect_match(result$errors, "arm_treatment = '18.6'", all = FALSE)
})

test_that("a swap is rejected even when everything else verifies", {
  section <- paste(
    "In ALEX, HR 0.47 (0.34, 0.65). Alecensa median NR.",
    "Crizotinib median 11.1 months."
  )
  row <- list(
    quotes = c("HR 0.47 (0.34, 0.65).", "Crizotinib median 11.1 months."),
    value = "0.47", ci_low = "0.34", ci_high = "0.65",
    comparator = "crizotinib", comparator_column_label = "Crizotinib",
    arm_treatment = "11.1", arm_control = "NR"
  )
  result <- verify_efficacy_row(row, section)
  expect_equal(result$status, "failed")
  expect_match(result$errors, "arms swapped", all = FALSE)
  expect_equal(result$blanked, character())
})

test_that("an arm value reassembled from cells is no warning once blanked", {
  section <- "HR 0.5 (0.4, 0.6) Median 7.0 5.5 95% CI (6.2, 7.3) (4.4, 5.9)"
  row <- list(
    quotes = c("HR 0.5 (0.4, 0.6)", "Median 7.0 5.5 95% CI (6.2, 7.3)"),
    value = "0.5", ci_low = "0.4", ci_high = "0.6",
    arm_treatment = "7.0 (6.2, 7.3)", arm_control = "5.5 (4.4, 5.9)"
  )
  result <- verify_efficacy_row(row, section)
  expect_equal(result$status, "exact")
  expect_equal(result$warnings, character())
  expect_setequal(result$blanked, c("arm_treatment", "arm_control"))
})
