test_that("parse_ema_date parses dd/mm/yyyy; empty or NA is missing", {
  expect_identical(
    parse_ema_date(c("22/09/2023", "", NA, "29/02/2024")),
    as.Date(c("2023-09-22", NA, NA, "2024-02-29"))
  )
  expect_identical(parse_ema_date(character()), as.Date(character()))
})

test_that("parse_ema_date aborts on values that do not round-trip", {
  error <- expect_error(
    parse_ema_date(c("22/09/2023", "2023-09-22", "1/2/2020", "31/02/2023")),
    class = "rlang_error"
  )
  message <- conditionMessage(error)
  expect_match(message, "3 invalid")
  expect_match(message, "2023-09-22", fixed = TRUE)
  expect_match(message, "1/2/2020", fixed = TRUE)
  expect_match(message, "31/02/2023", fixed = TRUE)
})

test_that("yes_no_to_logical maps Yes and No", {
  expect_identical(
    yes_no_to_logical(c("Yes", "No", "No")),
    c(TRUE, FALSE, FALSE)
  )
})

test_that("yes_no_to_logical aborts on anything else", {
  error <- expect_error(
    yes_no_to_logical(c("Yes", "", "yes", NA)),
    class = "rlang_error"
  )
  expect_match(conditionMessage(error), "3 invalid")
  expect_match(conditionMessage(error), "\"yes\"")
})

test_that("decode_html_entities decodes nbsp, truncated nbsp, lt and gt", {
  expect_identical(
    decode_html_entities(
      c("a&nbsp;b", "bimekizumab&nbsp", "&lt;18&gt;", "Merck Sharp & Dohme", NA)
    ),
    c("a b", "bimekizumab ", "<18>", "Merck Sharp & Dohme", NA)
  )
})

test_that("decode_html_entities aborts on unknown entities", {
  error <- expect_error(
    decode_html_entities(c("a&amp;b", "&#39;", "&nbsp;")),
    class = "rlang_error"
  )
  expect_match(conditionMessage(error), "&amp;", fixed = TRUE)
  expect_match(conditionMessage(error), "&#39;", fixed = TRUE)
})

test_that("clean_text decodes, squishes and turns empty strings into NA", {
  expect_identical(
    clean_text(c("  a  b ", "", "&nbsp;", "x&nbsp;&lt;y", NA)),
    c("a b", NA, NA, "x <y", NA)
  )
})

test_that("parse_revision_number converts whole numbers and empty to NA", {
  expect_identical(
    parse_revision_number(c("1", "", "13", NA)),
    c(1L, NA, 13L, NA)
  )
})

test_that("parse_revision_number aborts on non-integer values", {
  error <- expect_error(
    parse_revision_number(c("1", "1.5", "two")),
    class = "rlang_error"
  )
  expect_match(conditionMessage(error), "1.5", fixed = TRUE)
  expect_match(conditionMessage(error), "two", fixed = TRUE)
})

test_that("clean_ema_medicines keeps human rows, drops category/vet columns", {
  data <- read_fixture_ema()$data
  medicines <- clean_ema_medicines(data)
  expect_identical(nrow(medicines), sum(data$category == "Human"))
  expect_false(any(
    c(
      "category",
      "species_veterinary",
      "atcvet_code_veterinary",
      "pharmacotherapeutic_group_veterinary"
    ) %in% names(medicines)
  ))
  expect_identical(
    names(medicines),
    setdiff(
      names(data),
      c(
        "category",
        "species_veterinary",
        "atcvet_code_veterinary",
        "pharmacotherapeutic_group_veterinary"
      )
    )
  )
})

test_that("clean_ema_medicines converts flags, dates and revision number", {
  medicines <- clean_ema_medicines(read_fixture_ema()$data)
  tyruko <- medicines[medicines$ema_product_number == "EMEA/H/C/005752", ]
  expect_type(medicines$biosimilar, "logical")
  expect_true(tyruko$biosimilar)
  expect_false(tyruko$generic)
  expect_s3_class(medicines$marketing_authorisation_date, "Date")
  expect_identical(tyruko$marketing_authorisation_date, as.Date("2023-09-22"))
  expect_type(medicines$revision_number, "integer")
  refused <- medicines[medicines$ema_product_number == "EMEA/H/C/006563", ]
  expect_identical(refused$revision_number, NA_integer_)
})

test_that("clean_ema_medicines cleans every text column", {
  medicines <- clean_ema_medicines(read_fixture_ema()$data)
  text_columns <- names(medicines)[vapply(medicines, is.character, logical(1))]
  text_values <- unlist(medicines[text_columns])
  expect_false(any(text_values == "", na.rm = TRUE))
  expect_false(any(grepl(" |&nbsp|&lt;|&gt;", text_values)))
  expect_false(any(grepl("^\\s|\\s$", text_values)))
  bimzelx <- medicines[medicines$ema_product_number == "EMEA/H/C/005316", ]
  expect_identical(bimzelx$pharmacotherapeutic_group_human, "bimekizumab")
  refused <- medicines[medicines$ema_product_number == "EMEA/H/C/006563", ]
  expect_identical(refused$opinion_status, "Negative")
})

test_that("clean_ema_medicines keeps legitimate ampersands", {
  medicines <- clean_ema_medicines(read_fixture_ema()$data)
  msd <- medicines[medicines$ema_product_number == "EMEA/H/C/002846", ]
  expect_match(
    msd$marketing_authorisation_developer_applicant_holder,
    " & ",
    fixed = TRUE
  )
})
