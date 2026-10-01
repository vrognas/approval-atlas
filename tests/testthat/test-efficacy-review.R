review_rows <- function() {
  products <- rep(c("EMEA/H/C/004164", "EMEA/H/C/005522"), each = 10)
  efficacy_row_table(purrr::map(seq_along(products), function(index) {
    list(
      ema_product_number = products[[index]],
      row_key = sprintf("key-%02d", index),
      row_order = index,
      trial = "ALEX", endpoint = "PFS", value = "0.47", ci_low = "0.34",
      ci_high = "0.65", ci_level = 95, quotes = list("HR 0.47 (0.34, 0.65)"),
      page = 12L, source_url = "https://www.ema.europa.eu/pi.pdf",
      flags = if (index == 1) "ci_level" else character(),
      review = if (index == 1) "flagged" else "auto_ok"
    )
  }))
}

test_that("the sample takes 10% of auto_ok rows, spread over products", {
  withr::local_seed(20260930)
  sample <- sample_efficacy_review(review_rows())
  expect_equal(nrow(sample), 2L)
  expect_true(all(sample$review == "auto_ok"))
  expect_setequal(
    sample$ema_product_number,
    c("EMEA/H/C/004164", "EMEA/H/C/005522")
  )
  expect_equal(nrow(sample_efficacy_review(review_rows()[1, ])), 0L)
})

test_that("the review page lists rows with flags, source and quotes", {
  rows <- review_rows()
  lines <- efficacy_review_markdown(
    rows[rows$review == "flagged", ], rows[2, ],
    as.Date("2026-09-30")
  )
  text <- paste(lines, collapse = "\n")
  expect_match(text, "# Efficacy review 2026-09-30", fixed = TRUE)
  expect_match(text, "Flagged rows (1)", fixed = TRUE)
  expect_match(text, "Sample of auto_ok rows (1)", fixed = TRUE)
  expect_match(text, "0.47 (95% CI 0.34, 0.65)", fixed = TRUE)
  expect_match(text, "Flags: ci_level", fixed = TRUE)
  expect_match(text, "https://www.ema.europa.eu/pi.pdf, page 12", fixed = TRUE)
  expect_match(text, "> HR 0.47 (0.34, 0.65)", fixed = TRUE)
  expect_match(text, "key-01", fixed = TRUE)
})

test_that("the review page shows every field the card shows", {
  row <- efficacy_row_table(list(list(
    ema_product_number = "EMEA/H/C/004164", row_key = "key-01",
    row_order = 1L, indication = "ALK-positive advanced NSCLC",
    trial = "ALEX (BO28984)", population = "ALK-positive NSCLC",
    population_match = "whole_trial_matches", regimen = "alectinib",
    comparator = "crizotinib", comparator_column_label = "Crizotinib",
    n_treatment = 152L, n_control = 151L, endpoint = "PFS",
    assessment = "investigator", is_primary = TRUE,
    analysis_role = "primary", analysis = "data cut-off 9 February 2017",
    effect_type = "hr_noninferiority", value = "0.47", ci_low = "0.34",
    ci_high = "0.65", ci_level = 95, arm_treatment = "NE [17.7; NE]",
    arm_control = "11.1 [9.1; 13.1]", arm_measure = "median months (95% CI)",
    quotes = list("HR 0.47 (0.34, 0.65)"), flags = character(),
    review = "auto_ok"
  )))
  text <- paste(
    efficacy_review_markdown(row[0, ], row, as.Date("2026-09-30")),
    collapse = "\n"
  )
  expected <- c(
    "- Indication: ALK-positive advanced NSCLC",
    "- Trial: ALEX (BO28984)",
    "- Population: ALK-positive NSCLC (whole_trial_matches)",
    "- Regimen: alectinib (n = 152) vs crizotinib (n = 151)",
    "- Comparator column label: Crizotinib",
    paste(
      "- Arms: NE [17.7; NE] vs 11.1 [9.1; 13.1]",
      "(median months (95% CI))"
    ),
    "- Endpoint: PFS",
    "- Assessment: investigator",
    "- Primary endpoint: yes",
    "- Analysis: primary: data cut-off 9 February 2017",
    "- CI level: 95",
    "- Effect: HR 0.47 (95% CI 0.34, 0.65), non-inferiority"
  )
  for (line in expected) {
    expect_match(text, line, fixed = TRUE)
  }
})

test_that("the review page says what a row does not state", {
  row <- review_rows()[2, ]
  row$effect_type <- "single_arm_rate"
  row$ci_is_range <- TRUE
  text <- paste(
    efficacy_review_markdown(row[0, ], row, as.Date("2026-09-30")),
    collapse = "\n"
  )
  expect_match(text, "- Indication: not stated", fixed = TRUE)
  expect_match(text, "- Regimen: not stated (single-arm)", fixed = TRUE)
  expect_match(text, "- Arms: not stated", fixed = TRUE)
  expect_match(text, "- Primary endpoint: not stated", fixed = TRUE)
  expect_match(text, "- Effect: response rate 0.47 (range 0.34, 0.65)",
               fixed = TRUE)
})

# Owner decision 2026-10-01: the extractor blanks arm sizes no comparator
# column label ties to their arms, and the rows file does not record it, so
# the reviewer is told why a row of two arms has no n.
test_that("the review page says when a row of two arms has no sizes", {
  row <- review_rows()[2, ]
  row$regimen <- "alectinib"
  row$comparator <- "crizotinib"
  note <- paste(
    "- Arm sizes: not shown (kept only with the comparator's column label",
    "in a quote with the control arm's size)"
  )
  page <- function(row) {
    paste(
      efficacy_review_markdown(row[0, ], row, as.Date("2026-10-01")),
      collapse = "\n"
    )
  }
  text <- page(row)
  expect_match(text, "- Regimen: alectinib vs crizotinib", fixed = TRUE)
  expect_match(text, note, fixed = TRUE)
  row$n_treatment <- 152L
  row$n_control <- 151L
  expect_no_match(page(row), "- Arm sizes", fixed = TRUE)
  single <- review_rows()[2, ]
  single$effect_type <- "single_arm_rate"
  expect_no_match(page(single), "- Arm sizes", fixed = TRUE)
})

test_that("the review page leaves out an unknown CI level; quotes every line", {
  row <- review_rows()[2, ]
  row$ci_level <- NA_real_
  row$quotes <- list(c("first line\nsecond line", "another quote"))
  text <- paste(
    efficacy_review_markdown(row[0, ], row, as.Date("2026-09-30")),
    collapse = "\n"
  )
  expect_match(text, "0.47 (CI 0.34, 0.65)", fixed = TRUE)
  expect_no_match(text, "NA%", fixed = TRUE)
  expect_match(
    text, "> first line\n> second line\n>\n> another quote",
    fixed = TRUE
  )
})
