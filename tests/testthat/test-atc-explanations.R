# The committed input (data-raw/), from the package root.
committed_path <- function() {
  testthat::test_path("..", "..", atc_explanations_path)
}

# Not there when the tests run from an installed copy (covr).
skip_without_committed_file <- function() {
  testthat::skip_if_not(
    file.exists(committed_path()),
    "data-raw/ is not beside the tests"
  )
}

explanation_rows <- function(...) {
  rows <- dplyr::tribble(
    ~code, ~level, ~explanation, ~checked_date, ~source,
    ...
  )
  rows$level <- as.integer(rows$level)
  rows
}

valid_explanations <- function() {
  explanation_rows(
    "L", 1, "Medicines against cancer and ones that adjust the immune system.",
    "2026-09-29", "Approval Atlas (plain-language summary)",
    "L04AC", 4, "Block interleukins, signals that drive inflammation.",
    "2026-09-29", "Approval Atlas (plain-language summary)"
  )
}

no_class_names <- stats::setNames(character(), character())
no_active_substances <- dplyr::tibble(active_substance = character())

expect_explanations_error <- function(explanations,
                                      pattern,
                                      terms = character(),
                                      class_names = no_class_names) {
  expect_error(
    check_atc_explanations(explanations, terms, class_names),
    pattern
  )
}

test_that("read_atc_explanations reads the committed file, one row per line", {
  skip_without_committed_file()
  explanations <- read_atc_explanations(committed_path())
  expect_named(explanations, names(atc_explanation_columns))
  expect_identical(
    purrr::map_chr(explanations, class),
    c(
      code = "character", level = "integer", explanation = "character",
      checked_date = "character", source = "character"
    )
  )
  expect_identical(nrow(explanations), 543L)
  expect_identical(explanations$code, sort(explanations$code, method = "radix"))
  expect_identical(
    as.vector(table(explanations$level)),
    c(14L, 72L, 138L, 319L)
  )
  raw <- readBin(committed_path(), "raw", file.size(committed_path()))
  expect_false(as.raw(13L) %in% raw)
  lines <- readLines(committed_path(), encoding = "UTF-8")
  expect_length(lines, 543L + 2L)
  expect_identical(lines[[1]], "[")
  expect_identical(lines[[length(lines)]], "]")
})

test_that("the committed explanations pass every check", {
  skip_without_committed_file()
  explanations <- read_atc_explanations(committed_path())
  # Words WHO's names hold: allowed there (H01AC Somatropin and somatropin
  # agonists; names from atc_classes.json), as are the allowed words in
  # their classes.
  terms <- fold_explanation_words(c(
    "somatropin",
    atc_explanation_allowed_words()$word
  ))
  expect_silent(check_atc_explanations(
    explanations,
    terms,
    c(
      A16AA = "Amino acids and derivatives",
      C09C = "ANGIOTENSIN II RECEPTOR BLOCKERS (ARBs), PLAIN",
      C09CA = "Angiotensin II receptor blockers (ARBs), plain",
      C09DB = paste(
        "Angiotensin II receptor blockers (ARBs) and calcium",
        "channel blockers"
      ),
      H01AC = "Somatropin and somatropin agonists"
    )
  ))
  expect_identical(max(nchar(explanations$explanation)), 169L)
  expect_false(any(grepl("—", explanations$explanation, fixed = TRUE)))
})

test_that("every allowed word and class is needed by the committed texts", {
  skip_without_committed_file()
  explanations <- read_atc_explanations(committed_path())
  allowed <- atc_explanation_allowed_words()
  expect_named(allowed, c("word", "codes", "reason"))
  expect_false(anyNA(allowed$reason))
  expect_true(all(purrr::map_lgl(allowed$codes, function(codes) {
    length(codes) > 0 && all(atc_code_level(codes) %in% 1:4)
  })))
  for (row in seq_len(nrow(allowed))) {
    for (code in allowed$codes[[row]]) {
      fewer <- allowed
      fewer$codes[[row]] <- setdiff(fewer$codes[[row]], code)
      testthat::local_mocked_bindings(
        atc_explanation_allowed_words = function() fewer
      )
      naming <- atc_explanations_naming_terms(
        explanations,
        fold_explanation_words(allowed$word[[row]]),
        no_class_names
      )
      expect_true(
        any(startsWith(naming, code)),
        label = paste(allowed$word[[row]], "in", code)
      )
    }
  }
})

test_that("an allowed word stops the build outside its classes", {
  rows <- explanation_rows(
    "L02BB", 4, "Stop male hormones such as testosterone from acting.",
    "2026-09-29", "Approval Atlas (plain-language summary)",
    "G03B", 3, "Replace male hormones such as testosterone.",
    "2026-09-29", "Approval Atlas (plain-language summary)",
    "N04BC", 4, "Mimic dopamine at its receptors.",
    "2026-09-29", "Approval Atlas (plain-language summary)",
    "N06AB", 4, "Unlike dopamine boosters, raise serotonin.",
    "2026-09-29", "Approval Atlas (plain-language summary)"
  )
  terms <- fold_explanation_words(c("testosterone", "dopamine"))
  expect_identical(
    atc_explanations_naming_terms(rows, terms, no_class_names),
    c("G03B: testosterone", "N06AB: dopamine")
  )
  expect_explanations_error(rows, "G03B: testosterone", terms = terms)
})

test_that("fold_explanation_words keeps whole words only", {
  expect_identical(
    fold_explanation_words(c("Dasatinib (anhydrous)", "GLP-1 agonists", "")),
    c(" dasatinib anhydrous ", " glp 1 agonists ", "  ")
  )
})

test_that("atc_explanation_terms folds names, keys and substance texts", {
  medicines <- dplyr::tibble(name_of_medicine = c("Humira", "Insulin Human"))
  substances <- dplyr::tibble(substance_key = c("adalimumab", NA, "insulin"))
  # EMA's text where the key names a salt (Neoatricon: dopamine
  # hydrochloride).
  active_substances <- dplyr::tibble(
    active_substance = c("Dopamine", "adalimumab", NA)
  )
  expect_identical(
    atc_explanation_terms(medicines, substances, active_substances),
    c(" adalimumab ", " dopamine ", " humira ", " insulin ", " insulin human ")
  )
})


test_that("check_atc_explanations accepts valid rows", {
  expect_silent(check_atc_explanations(
    valid_explanations(),
    character(),
    no_class_names
  ))
})

test_that("check_atc_explanations stops on codes that are not levels 1-4", {
  rows <- valid_explanations()
  rows$code <- c("L04AC05", "LX1")
  expect_explanations_error(rows, "levels 1 to 4")
  expect_explanations_error(rows, "L04AC05")
})

test_that("check_atc_explanations stops on repeated codes", {
  rows <- valid_explanations()
  rows$code[[2]] <- "L"
  rows$level[[2]] <- 1L
  expect_explanations_error(rows, "more than once")
})

test_that("check_atc_explanations stops on a level that is not the code's", {
  rows <- valid_explanations()
  rows$level[[2]] <- 3L
  expect_explanations_error(rows, "not their code's.*L04AC")
})

test_that("check_atc_explanations stops on an empty text", {
  rows <- valid_explanations()
  rows$explanation[[1]] <- "  "
  expect_explanations_error(rows, "need a text")
  rows$explanation[[1]] <- NA_character_
  expect_explanations_error(rows, "need a text")
})

test_that("check_atc_explanations stops on texts over 20 words", {
  rows <- valid_explanations()
  rows$explanation[[2]] <- paste(rep("word", 21), collapse = " ")
  expect_explanations_error(rows, "at most 20.*L04AC")
  rows$explanation[[2]] <- paste(rep("word", 20), collapse = " ")
  expect_silent(check_atc_explanations(rows, character(), no_class_names))
})

test_that("check_atc_explanations stops on an em-dash", {
  rows <- valid_explanations()
  rows$explanation[[1]] <- "Cancer medicines — and immune ones."
  expect_explanations_error(rows, "em-dashes")
})

test_that("check_atc_explanations stops on a medicine or substance name", {
  rows <- valid_explanations()
  rows$explanation[[2]] <- "Block interleukins, as Bimzelx (bimekizumab) does."
  terms <- fold_explanation_words(c("Bimzelx", "bimekizumab", "Kymriah"))
  expect_explanations_error(
    rows,
    "L04AC: bimekizumab.*L04AC: bimzelx",
    terms = terms
  )
})

test_that("a name matches as a whole word, case-insensitively", {
  rows <- valid_explanations()
  rows$explanation[[2]] <- "Block INTERLEUKINS and more."
  expect_explanations_error(
    rows,
    "L04AC: interleukins",
    terms = fold_explanation_words("interleukins")
  )
  expect_silent(check_atc_explanations(
    rows,
    fold_explanation_words("interleukin"),
    no_class_names
  ))
})

test_that("a name in the class's WHO name or on the allow list is allowed", {
  rows <- valid_explanations()
  # Testosterone is allowed in L02B and its descendants.
  rows$code[[2]] <- "L02BB"
  rows$explanation[[2]] <- "Stop testosterone, unlike interleukin inhibitors."
  terms <- fold_explanation_words(c("interleukin inhibitors", "testosterone"))
  rows$explanation[[1]] <- "Interleukin inhibitors and other medicines."
  expect_explanations_error(rows, "L: interleukin inhibitors", terms = terms)
  expect_explanations_error(
    rows,
    "L02BB: interleukin inhibitors",
    terms = terms,
    class_names = c(L = "INTERLEUKIN INHIBITORS AND MORE")
  )
  expect_silent(check_atc_explanations(
    rows,
    terms,
    c(L = "INTERLEUKIN INHIBITORS AND MORE", L02BB = "Interleukin inhibitors")
  ))
})

test_that("check_atc_explanations stops on a bad date or no source", {
  rows <- valid_explanations()
  rows$checked_date[[1]] <- "2026-02-30"
  expect_explanations_error(rows, "checked date.*\"L\"")
  rows <- valid_explanations()
  rows$source[[2]] <- NA_character_
  expect_explanations_error(rows, "checked date.*L04AC")
})

test_that("read_atc_explanations stops on a missing file or column", {
  expect_error(read_atc_explanations(tempfile()), "is missing")
  path <- tempfile(fileext = ".json")
  writeLines('[{"code":"L","level":1,"explanation":"Text."}]', path)
  expect_error(read_atc_explanations(path), "checked_date")
})

atc_rows <- function(atc_code, current_atc_code = NA_character_) {
  dplyr::tibble(atc_code = atc_code, current_atc_code = current_atc_code)
}

test_that("the classes in use are the prefixes of the codes shown", {
  rows <- atc_rows(
    c("L01XC02", "L04AC", "LX1XX02", NA),
    c("L01FA01", NA, NA, NA)
  )
  expect_identical(
    atc_explained_classes_in_use(rows),
    c("L", "L01", "L01F", "L01FA", "L04", "L04A", "L04AC")
  )
})

test_that("build_atc_explanations_table keeps the classes in use", {
  classes <- dplyr::tibble(atc_code = c("L", "L04AC"), name = c("X", "Y"))
  expect_warning(
    table <- build_atc_explanations_table(
      valid_explanations(),
      atc_rows("L04AC05"),
      classes,
      dplyr::tibble(name_of_medicine = "Bimzelx"),
      dplyr::tibble(substance_key = "bimekizumab"),
      no_active_substances
    ),
    "no explanation.*L04.*L04A \\(no WHO name\\)"
  )
  expect_named(
    table,
    c("atc_code", "level", "explanation", "checked_date", "source")
  )
  expect_identical(table$atc_code, c("L", "L04AC"))
  expect_identical(unique(table$source), "approval_atlas")
  expect_identical(table$checked_date, c("2026-09-29", "2026-09-29"))
})

test_that("build_atc_explanations_table warns about classes not in use", {
  classes <- dplyr::tibble(atc_code = "L", name = "X")
  expect_warning(
    table <- build_atc_explanations_table(
      valid_explanations(),
      atc_rows("L"),
      classes,
      dplyr::tibble(name_of_medicine = character()),
      dplyr::tibble(substance_key = character()),
      no_active_substances
    ),
    "no longer uses.*L04AC"
  )
  expect_identical(table$atc_code, "L")
})

test_that("build_atc_explanations_table stops before it filters", {
  rows <- valid_explanations()
  rows$explanation[[2]] <- "Unlike Humira."
  expect_error(
    build_atc_explanations_table(
      rows,
      atc_rows("L"),
      dplyr::tibble(atc_code = "L", name = "X"),
      dplyr::tibble(name_of_medicine = "Humira"),
      dplyr::tibble(substance_key = character()),
      no_active_substances
    ),
    "L04AC: humira"
  )
})

test_that("atc_explanations_source_entry credits the texts as ours", {
  classes <- dplyr::tibble(atc_code = c("L", "L04AC"), name = c("X", "Y"))
  table <- suppressWarnings(build_atc_explanations_table(
    valid_explanations(),
    atc_rows(c("L", "L04AC")),
    classes,
    dplyr::tibble(name_of_medicine = character()),
    dplyr::tibble(substance_key = character()),
    no_active_substances
  ))
  entry <- atc_explanations_source_entry(table)
  expect_identical(entry$name, "ATC class explanations")
  expect_identical(entry$version, "Checked 2026-09-29")
  expect_identical(entry$retrieved, "2026-09-29")
  expect_match(entry$licence, "CC BY-SA 4.0", fixed = TRUE)
  expect_match(entry$attribution, "not WHO's", fixed = TRUE)
  expect_match(entry$url, atc_explanations_path, fixed = TRUE)
  expect_null(atc_explanations_source_entry(table[0, ]))
})

test_that("a substance text the keys lack stops the build", {
  rows <- valid_explanations()
  rows$explanation[[2]] <- "Unlike dopamine, block interleukins."
  expect_error(
    build_atc_explanations_table(
      rows,
      atc_rows(c("L", "L04AC")),
      dplyr::tibble(atc_code = c("L", "L04AC"), name = c("X", "Y")),
      dplyr::tibble(name_of_medicine = "Neoatricon"),
      dplyr::tibble(substance_key = "dopamine hydrochloride"),
      dplyr::tibble(active_substance = "Dopamine")
    ),
    "L04AC: dopamine"
  )
})
