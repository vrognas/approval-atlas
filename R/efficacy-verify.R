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
  text <- strip_page_number_lines(text)
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
# but may end a sentence ("p-value of 0.0106.").
bounded_number <- function(escaped) {
  paste0("(?<![0-9])(?<![0-9]\\.)", escaped, "(?![0-9]|\\.[0-9])")
}

contains_bounded <- function(value, text) {
  grepl(bounded_number(escape_regex(value)), text, perl = TRUE)
}

normalise_number_fields <- function(row) {
  for (field in efficacy_number_fields) {
    if (!is_absent(row[[field]])) {
      row[[field]] <- normalise_efficacy_text(as.character(row[[field]]))
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
  separated <- purrr::map_chr(
    c(" ", ","),
    \(mark) format(n, big.mark = mark, scientific = FALSE)
  )
  sizes <- unique(c(as.character(n), separated))
  any(purrr::map_lgl(
    sizes,
    \(size) grepl(paste0("[nN]\\s?=\\s?", size, "\\b"), section, perl = TRUE)
  ))
}

trial_names_found <- function(trial, section) {
  if (is_absent(trial)) {
    return(TRUE)
  }
  before_bracket <- strsplit(trial, " (", fixed = TRUE)[[1]][1]
  name <- trimws(strsplit(before_bracket, ",", fixed = TRUE)[[1]][1])
  parts <- trimws(strsplit(name, "\\s*\\+\\s*", perl = TRUE)[[1]])
  all(purrr::map_lgl(
    parts,
    \(part) grepl(tolower(part), tolower(section), fixed = TRUE)
  ))
}

quote_in_a_section <- function(quote, sections) {
  any(purrr::map_lgl(sections, \(section) grepl(quote, section, fixed = TRUE)))
}

# `section_text` is one or more renderings of the same section (layout and
# flow text): a quote passes when it occurs intact in any of them.
verify_efficacy_row <- function(row, section_text) {
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
  for (field in c("n_treatment", "n_control")) {
    if (!arm_size_found(row[[field]], all_sections)) {
      errors <- c(
        errors,
        sprintf("%s = %s not found as n=", field, row[[field]])
      )
    }
  }
  if (!trial_names_found(row[["trial"]], all_sections)) {
    errors <- c(
      errors,
      sprintf("trial name not in the section: %s", row[["trial"]])
    )
  }
  status <- dplyr::case_when(
    length(errors) > 0 ~ "failed",
    length(warnings) > 0 ~ "reassembled",
    .default = "exact"
  )
  list(status = status, errors = errors, warnings = warnings)
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
