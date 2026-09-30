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
