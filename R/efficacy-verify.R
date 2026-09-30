# Checks one extracted efficacy row against the text of its SmPC section 5.1
# (ported from the 2026-09-30 pilot, .remember/efficacy/verify.py): the
# model's quotes must occur in the text and hold every number, so a number
# the text does not state cannot pass.

efficacy_number_fields <- c(
  "value", "ci_low", "ci_high", "p_value", "arm_treatment", "arm_control"
)

strip_page_number_lines <- function(text) {
  text <- gsub("\f", "\n", text, fixed = TRUE)
  gsub("(?m)^[ \t]*[0-9]{1,3}[ \t]*$", " ", text, perl = TRUE)
}

normalise_efficacy_text <- function(text) {
  normalise_spacing(strip_page_number_lines(text))
}

# For a field's own text, whose "12" on a line of its own is the value, not a
# page number.
normalise_spacing <- function(text) {
  # No-break, thin and narrow no-break spaces.
  text <- gsub("[\u00a0\u2009\u202f]", " ", text, perl = TRUE)
  # Private-use glyphs (Wingdings bullets inside table rows) carry no text.
  text <- gsub("[\ue000-\uf8ff]", " ", text, perl = TRUE)
  trimws(gsub("\\s+", " ", text, perl = TRUE))
}

number_tokens <- function(value) {
  tokens <- gregexpr("[0-9]+(?:\\.[0-9]+)?|NR|NE|NA", value, perl = TRUE)
  regmatches(value, tokens)[[1]]
}

escape_regex <- function(text) {
  gsub("([.\\\\+*?^$(){}|\\[\\]])", "\\\\\\1", text, perl = TRUE)
}

is_absent <- function(value) {
  is.null(value) || length(value) == 0 || is.na(value) ||
    (is.character(value) && !nzchar(trimws(value)))
}

# A number must not be a prefix or suffix of a longer one ("0.03" in "0.031"),
# but may end a sentence ("p-value of 0.0106."). Three digits must not be the
# last group of a thousands number ("234" in "1,234"); a comma between two
# numbers ("[0.34,0.65]") still separates them.
bounded_number <- function(escaped) {
  thousands <- if (grepl("^[0-9]{3}$", escaped)) "(?<![0-9],)" else ""
  paste0(
    "(?<![0-9])(?<![0-9]\\.)", thousands, escaped, "(?![0-9]|\\.[0-9])"
  )
}

contains_bounded <- function(value, text) {
  grepl(bounded_number(escape_regex(value)), text, perl = TRUE)
}

normalise_number_fields <- function(row) {
  for (field in efficacy_number_fields) {
    if (!is_absent(row[[field]])) {
      row[[field]] <- normalise_spacing(as.character(row[[field]]))
    }
  }
  row
}

check_number_field <- function(field, value, quotes_text) {
  if (is_absent(value)) {
    return(list(error = NULL, warning = NULL))
  }
  if (contains_bounded(value, quotes_text)) {
    return(list(error = NULL, warning = NULL))
  }
  tokens <- number_tokens(value)
  all_present <- purrr::map_lgl(tokens, contains_bounded, text = quotes_text)
  if (length(tokens) > 0 && all(all_present)) {
    return(list(
      error = NULL,
      warning = sprintf(
        "%s = '%s' reassembled from split table cells", field, value
      )
    ))
  }
  list(
    error = sprintf("%s = '%s' not in the quotes", field, value),
    warning = NULL
  )
}

# The value and its CI must stand together in one quote, so a value cannot
# borrow the interval of another row.
value_bound_to_ci <- function(row, quotes) {
  value <- row[["value"]]
  ci_low <- row[["ci_low"]]
  ci_high <- row[["ci_high"]]
  if (is_absent(value) || is_absent(ci_low) || is_absent(ci_high)) {
    return(TRUE)
  }
  pattern <- paste0(
    bounded_number(escape_regex(value)), ".{0,40}?",
    bounded_number(escape_regex(ci_low)), "[^0-9]{1,6}",
    bounded_number(escape_regex(ci_high))
  )
  any(grepl(pattern, quotes, perl = TRUE))
}

arm_size_found <- function(n, section) {
  if (is_absent(n)) {
    return(TRUE)
  }
  # Thousands printed with a space ("1 274") or a comma ("1,274").
  any(purrr::map_lgl(
    arm_size_spellings(n),
    \(size) grepl(paste0("[nN]\\s?=\\s?", size, "\\b"), section, perl = TRUE)
  ))
}

# The same count as printed with or without a thousands separator.
arm_size_spellings <- function(n) {
  separated <- purrr::map_chr(
    c(" ", ","),
    \(mark) format(n, big.mark = mark, scientific = FALSE)
  )
  unique(c(as.character(n), separated))
}

# The arm sizes the section states as "n=" text but the row's quotes do not
# hold: true, but not shown to the reader in the row's own evidence.
arm_sizes_outside_quotes <- function(row, quotes_text) {
  sizes <- purrr::keep(
    list(row[["n_treatment"]], row[["n_control"]]),
    \(n) !is_absent(n)
  )
  any(purrr::map_lgl(sizes, function(n) {
    !any(purrr::map_lgl(
      arm_size_spellings(n), contains_bounded,
      text = quotes_text
    ))
  }))
}

# A name part must stand as a whole word ("KEYNOTE-02" is not in
# "KEYNOTE-024").
contains_word <- function(part, text) {
  grepl(
    paste0("(?<![a-z0-9])", escape_regex(tolower(part)), "(?![a-z0-9])"),
    tolower(text),
    perl = TRUE
  )
}

# The name before any comma or bracket (its "+" parts each), and every
# one-word part inside brackets (the registry number in "ALEX (BO28984)").
# Bracketed phrases are left out: the pilot's gold rows describe the trial
# there ("(name not given)", "(sotorasib vs docetaxel)").
trial_name_parts <- function(trial) {
  before_bracket <- strsplit(trial, " (", fixed = TRUE)[[1]][1]
  name <- trimws(strsplit(before_bracket, ",", fixed = TRUE)[[1]][1])
  parts <- strsplit(name, "\\s*\\+\\s*", perl = TRUE)[[1]]
  bracketed <- regmatches(trial, gregexpr("\\(([^()]*)\\)", trial))[[1]]
  bracketed <- gsub("^\\(|\\)$", "", bracketed)
  bracket_parts <- trimws(unlist(strsplit(bracketed, ",", fixed = TRUE)))
  bracket_parts <- bracket_parts[!grepl("\\s", bracket_parts)]
  parts <- trimws(c(parts, bracket_parts))
  parts[nzchar(parts)]
}

trial_parts_missing <- function(trial, section) {
  if (is_absent(trial)) {
    return(character())
  }
  parts <- trial_name_parts(trial)
  parts[!purrr::map_lgl(parts, contains_word, text = section)]
}

quote_in_a_section <- function(quote, sections) {
  any(purrr::map_lgl(sections, \(section) grepl(quote, section, fixed = TRUE)))
}

# A number field held by one quote: intact, or as all its numbers (a value
# reassembled from split table cells).
quote_holds_number <- function(value, quote) {
  if (contains_bounded(value, quote)) {
    return(TRUE)
  }
  tokens <- number_tokens(value)
  length(tokens) > 0 &&
    all(purrr::map_lgl(tokens, contains_bounded, text = quote))
}

contains_folded <- function(text, within) {
  grepl(tolower(normalise_spacing(text)), tolower(within), fixed = TRUE)
}

# The comparator's column label and the control arm's values stand in one
# quote, so arms read from the wrong column cannot pass (ALEX prints the
# comparator first).
comparator_label_error <- function(row, quotes) {
  label <- row[["comparator_column_label"]]
  control <- row[["arm_control"]]
  if (is_absent(label) || is_absent(control)) {
    return(NULL)
  }
  together <- purrr::map_lgl(quotes, function(quote) {
    contains_folded(label, quote) && quote_holds_number(control, quote)
  })
  if (any(together)) {
    return(NULL)
  }
  sprintf(
    "comparator_column_label '%s' not in a quote with arm_control '%s'",
    label, control
  )
}

# Displayed text the section does not hold (case and spacing aside): the
# pilot's rows paraphrase, so a human decides.
efficacy_text_fields_checked <- c(
  "population", "regimen", "comparator", "comparator_column_label",
  "endpoint", "assessment"
)

text_not_in_source <- function(row, sections) {
  texts <- purrr::keep(
    purrr::map(efficacy_text_fields_checked, \(field) row[[field]]),
    \(text) !is_absent(text)
  )
  any(purrr::map_lgl(texts, function(text) {
    !any(purrr::map_lgl(sections, \(section) contains_folded(text, section)))
  }))
}

indication_not_in_source <- function(indication, indication_text) {
  if (is_absent(indication) || is_absent(indication_text)) {
    return(FALSE)
  }
  !contains_folded(indication, normalise_efficacy_text(indication_text))
}

# "95%" or "95 %" printed somewhere the row came from.
ci_level_not_in_source <- function(ci_level, texts) {
  if (is_absent(ci_level)) {
    return(FALSE)
  }
  level <- escape_regex(format(ci_level, scientific = FALSE, trim = TRUE))
  !any(grepl(paste0(bounded_number(level), " ?%"), texts, perl = TRUE))
}

# Reasons to show the row to a human first (efficacy_flags() adds them).
verification_flags <- function(row, quotes, sections, indication_text) {
  quotes_text <- paste(quotes, collapse = " || ")
  checks <- c(
    text_not_in_source = text_not_in_source(row, sections),
    indication_not_in_source = indication_not_in_source(
      row[["indication"]], indication_text
    ),
    ci_level_not_in_source = ci_level_not_in_source(
      row[["ci_level"]], c(quotes, sections)
    ),
    n_not_in_quotes = arm_sizes_outside_quotes(row, quotes_text)
  )
  names(checks)[checks]
}

# `section_text` is one or more renderings of the same section (layout and
# flow text): a quote passes when it occurs intact in any of them.
# `indication_text` is the medicine's section 4.1, for the indication check
# (none without it).
verify_efficacy_row <- function(row, section_text, indication_text = NULL) {
  sections <- purrr::map_chr(section_text, normalise_efficacy_text)
  all_sections <- paste(sections, collapse = " ")
  row <- normalise_number_fields(row)
  quotes <- purrr::map_chr(row[["quotes"]], normalise_efficacy_text)
  quotes <- quotes[nzchar(quotes)]
  found <- purrr::map_lgl(quotes, quote_in_a_section, sections = sections)
  errors <- sprintf("quote not in the text: %s", substr(quotes[!found], 1, 80))
  if (length(quotes) == 0) {
    errors <- "no quote: every row needs at least one verbatim quote"
  }
  if (is_absent(row[["value"]])) {
    errors <- c(errors, "no value: every row needs its effect value")
  }
  warnings <- character()
  quotes_text <- paste(quotes, collapse = " || ")
  for (field in efficacy_number_fields) {
    check <- check_number_field(field, row[[field]], quotes_text)
    errors <- c(errors, check$error)
    warnings <- c(warnings, check$warning)
  }
  if (!value_bound_to_ci(row, quotes)) {
    errors <- c(errors, sprintf(
      "value and CI not in one quote: %s (%s, %s)",
      row[["value"]], row[["ci_low"]], row[["ci_high"]]
    ))
  }
  errors <- c(errors, comparator_label_error(row, quotes))
  for (field in c("n_treatment", "n_control")) {
    if (!arm_size_found(row[[field]], all_sections)) {
      errors <- c(
        errors,
        sprintf("%s = %s not found as n=", field, row[[field]])
      )
    }
  }
  missing_parts <- trial_parts_missing(row[["trial"]], all_sections)
  if (length(missing_parts) > 0) {
    errors <- c(errors, sprintf(
      "trial name not in the section: %s (%s)",
      row[["trial"]], paste(missing_parts, collapse = ", ")
    ))
  }
  status <- dplyr::case_when(
    length(errors) > 0 ~ "failed",
    length(warnings) > 0 ~ "reassembled",
    .default = "exact"
  )
  list(
    status = status,
    errors = errors,
    warnings = warnings,
    flags = verification_flags(row, quotes, sections, indication_text)
  )
}

efficacy_quote_page <- function(quote, page_texts) {
  quote <- normalise_efficacy_text(quote)
  pages <- purrr::map_chr(page_texts, normalise_efficacy_text)
  if (!nzchar(quote) || length(pages) == 0) {
    return(NA_integer_)
  }
  start <- substr(quote, 1, 60)
  starts_here <- purrr::map_lgl(pages, \(page) grepl(start, page, fixed = TRUE))
  on_page <- which(starts_here)
  if (length(on_page) > 0) {
    return(on_page[1])
  }
  for (page in seq_len(length(pages) - 1)) {
    if (grepl(quote, paste(pages[page], pages[page + 1]), fixed = TRUE)) {
      return(page)
    }
  }
  NA_integer_
}
