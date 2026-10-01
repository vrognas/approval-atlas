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

read_excerpt <- function(name) {
  read_efficacy_fixture(paste0("excerpt-", name, ".layout.txt"))
}

# The arm sizes the 2026-10-01 gold evaluation rejected, in the notations
# their SmPCs print (verbatim excerpts of the pilot's section texts).
test_that("arm sizes are found in the notations the SmPCs print", {
  found <- function(n, text) {
    arm_size_found(n, normalise_efficacy_text(text))
  }
  # Alecensa NP28761 and NP28673: "n = 67" with a Symbol-font "=", a
  # private-use glyph the text drops ("n 67").
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
  found <- function(n, text) arm_size_found(n, text)
  expect_false(found(247L, "N 2470"))
  expect_false(found(247L, "N 247.5"))
  expect_false(found(247L, "N = 1,247"))
  expect_false(found(247L, "43.3% (n = 107/247)"))
  expect_false(found(247L, "an 247"))
  expect_false(found(247L, "N2 247"))
  expect_true(found(247L, "N 247, median"))
  expect_true(found(1274L, "N 1,274"))
})

test_that("counts the SmPCs do not print as arm sizes stay rejected", {
  found <- function(n, text) {
    arm_size_found(n, normalise_efficacy_text(text))
  }
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

quote_found <- function(quote, text) {
  quotes_found(
    normalise_efficacy_text(quote), normalise_efficacy_text(text), text
  )
}

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
