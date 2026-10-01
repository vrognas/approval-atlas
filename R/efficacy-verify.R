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
    \(size) grepl(arm_size_pattern(size), section, perl = TRUE)
  ))
}

# The arm-size notations the SmPCs print: "n=", "n =", "N = ", "(N=143)", a
# table header's "(n = 74)" and a column's "N 247" (Alecensa's Symbol-font "="
# is a private-use glyph, so its "n = 67" reads "n 67"). The letter stands on
# its own and the count whole: "N 2470" and "n = 107/247" are not 247.
arm_size_pattern <- function(size) {
  paste0(
    "(?<![A-Za-z0-9])[nN](?:\\s*=\\s*|\\s+)", escape_regex(size),
    "(?![0-9]|[.,][0-9])"
  )
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

# Words (letters and digits together: "ratioa", "Gastric02"), numbers and
# every other character on its own: a quote read across layout lines is
# compared token by token, whitespace aside.
layout_tokens <- function(text) {
  pattern <- "[\\p{L}\\p{N}]+(?:\\.[\\p{N}]+)*|[^\\s\\p{L}\\p{N}]"
  regmatches(text, gregexpr(pattern, text, perl = TRUE))
}

# A section's lines that hold text, normalised as the section, each as its
# tokens.
section_line_tokens <- function(section_text) {
  lines <- strsplit(strip_page_number_lines(section_text), "\n", fixed = TRUE)
  lines <- normalise_spacing(unlist(lines))
  layout_tokens(lines[nzchar(lines)])
}

# The tokens of a quote that are values (numbers, NR, NE, NA), all but a CI
# level ("95" in "(95% CI)", a label a wrapped row can print on another line).
quote_value_positions <- function(tokens) {
  values <- grepl("^([0-9]+(\\.[0-9]+)?|NR|NE|NA)$", tokens)
  after <- function(offset) c(tokens[-seq_len(offset)], rep("", offset))
  ci_level <- after(1) == "%" &
    grepl("^(ci|confidence)", tolower(after(2)))
  values & !ci_level
}

# Whether the quote's tokens can be read off the window's lines: from each
# line a run of consecutive tokens, in the line's order, the runs interleaved
# as the quote reads them; a value only from the line `row` (NA: the quote
# holds none).
quote_reads_window <- function(tokens, values, lines, row) {
  memo <- new.env(hash = TRUE)
  read_from <- function(index, positions) {
    if (index > length(tokens)) {
      return(TRUE)
    }
    key <- paste(c(index, positions), collapse = ",")
    known <- get0(key, envir = memo, inherits = FALSE)
    if (!is.null(known)) {
      return(known)
    }
    found <- FALSE
    for (line in seq_along(lines)) {
      if (values[index] && !identical(line, row)) next
      # A line's run goes on from where it stopped, or starts anywhere.
      next_token <- positions[line]
      starts <- if (next_token > 0) {
        next_token[identical(lines[[line]][next_token], tokens[index])]
      } else {
        which(lines[[line]] == tokens[index])
      }
      for (start in starts) {
        moved <- positions
        moved[line] <- start + 1L
        if (read_from(index + 1L, moved)) {
          found <- TRUE
          break
        }
      }
      if (found) break
    }
    assign(key, found, envir = memo)
    found
  }
  read_from(1L, integer(length(lines)))
}

# Whether the line holds `values` in this order.
holds_in_order <- function(line, values) {
  position <- 0L
  for (value in values) {
    later <- which(line == value & seq_along(line) > position)
    if (length(later) == 0) {
      return(FALSE)
    }
    position <- later[1]
  }
  TRUE
}

# A quote the model read off a table in reading order ("Stratified hazard
# ratio‡ (95% CI) 0.79 (0.64, 0.98)", where the layout text prints the
# footnote mark on the line above): its tokens stand in at most three
# consecutive lines of `line_tokens` (section_line_tokens()), as runs of
# consecutive tokens of each line in its order, and its values all in one
# run of one line, so no other number stands between them and no value comes
# from another row. The other lines add only words and marks: a row label
# wrapped onto the next line, a footnote mark printed above, column headers.
quote_in_layout_lines <- function(quote, line_tokens) {
  tokens <- layout_tokens(quote)[[1]]
  if (length(tokens) == 0) {
    return(FALSE)
  }
  values <- quote_value_positions(tokens)
  rows <- if (any(values)) {
    which(purrr::map_lgl(line_tokens, holds_in_order, values = tokens[values]))
  } else {
    seq_along(line_tokens)
  }
  for (row in rows) {
    for (first in max(1L, row - 2L):row) {
      window <- first:min(length(line_tokens), first + 2L)
      lines <- line_tokens[window]
      if (!all(tokens %in% unlist(lines))) next
      row_in_window <- if (any(values)) row - first + 1L else NA_integer_
      if (quote_reads_window(tokens, values, lines, row_in_window)) {
        return(TRUE)
      }
    }
  }
  FALSE
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
# comparator first). A label in a quote with the treatment arm's values and
# not the control's is a swap (`swap`, which rejects the row); a label in no
# quote with the control's values is only unverified (`unverified`).
comparator_label_check <- function(row, quotes) {
  label <- row[["comparator_column_label"]]
  control <- row[["arm_control"]]
  treatment <- row[["arm_treatment"]]
  if (is_absent(label) || is_absent(control)) {
    return(list())
  }
  with_label <- quotes[purrr::map_lgl(quotes, contains_folded, text = label)]
  holds <- function(value) {
    purrr::map_lgl(with_label, \(quote) quote_holds_number(value, quote))
  }
  if (any(holds(control))) {
    return(list())
  }
  if (!is_absent(treatment) && any(holds(treatment))) {
    return(list(swap = sprintf(
      paste(
        "comparator_column_label '%s' not in a quote with arm_control '%s'",
        "but with arm_treatment '%s' (arms swapped)"
      ),
      label, control, treatment
    )))
  }
  list(unverified = sprintf(
    "comparator_column_label '%s' not in a quote with arm_control '%s'",
    label, control
  ))
}

# What the row says about each arm (the values, their measure and the
# comparator's column label): blanked together when they do not verify.
efficacy_arm_fields <- c(
  "arm_treatment", "arm_control", "arm_measure", "comparator_column_label"
)
efficacy_arm_number_fields <- c("arm_treatment", "arm_control")

# The arm values in the quotes and the comparator's label with the control's
# values: `swap` (an error), `unverified` (what did not verify) and
# `warnings` (values reassembled from split table cells).
check_arms <- function(row, quotes, quotes_text) {
  checks <- purrr::map(efficacy_arm_number_fields, function(field) {
    check_number_field(field, row[[field]], quotes_text)
  })
  label <- comparator_label_check(row, quotes)
  list(
    swap = label$swap,
    unverified = c(unlist(purrr::map(checks, "error")), label$unverified),
    warnings = unlist(purrr::map(checks, "warning")) %||% character()
  )
}

# The fields verify_efficacy_row() blanked (`blanked`) as not stated (NULL, as
# the parser gives a field the model left empty), so an arm that did not
# verify is never shown.
without_unverified_arms <- function(row, blanked) {
  row[blanked] <- list(NULL)
  row
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

# Each quote intact in a section text, else read off at most three of its
# layout lines (quote_in_layout_lines()).
quotes_found <- function(quotes, sections, section_text) {
  found <- purrr::map_lgl(quotes, quote_in_a_section, sections = sections)
  if (all(found)) {
    return(found)
  }
  line_tokens <- purrr::map(section_text, section_line_tokens)
  found[!found] <- purrr::map_lgl(quotes[!found], function(quote) {
    any(purrr::map_lgl(line_tokens, quote_in_layout_lines, quote = quote))
  })
  found
}

# `section_text` is one or more renderings of the same section (layout and
# flow text): a quote passes when it occurs intact in any of them, or read
# across at most three of its layout lines (quote_in_layout_lines()).
# `indication_text` is the medicine's section 4.1, for the indication check
# (none without it). When everything else verifies but the arms do not (arm
# values not in the quotes, or the comparator's label in no quote with the
# control's values), the row is kept without them: `blanked` names the arm
# fields to blank (without_unverified_arms()), and the flag
# arms_not_verified hides it until reviewed. A label quoted with the treatment
# arm's values is a swap and rejects the row.
verify_efficacy_row <- function(row, section_text, indication_text = NULL) {
  sections <- purrr::map_chr(section_text, normalise_efficacy_text)
  all_sections <- paste(sections, collapse = " ")
  row <- normalise_number_fields(row)
  quotes <- purrr::map_chr(row[["quotes"]], normalise_efficacy_text)
  quotes <- quotes[nzchar(quotes)]
  found <- quotes_found(quotes, sections, section_text)
  errors <- sprintf("quote not in the text: %s", substr(quotes[!found], 1, 80))
  if (length(quotes) == 0) {
    errors <- "no quote: every row needs at least one verbatim quote"
  }
  if (is_absent(row[["value"]])) {
    errors <- c(errors, "no value: every row needs its effect value")
  }
  warnings <- character()
  quotes_text <- paste(quotes, collapse = " || ")
  for (field in setdiff(efficacy_number_fields, efficacy_arm_number_fields)) {
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
  arms <- check_arms(row, quotes, quotes_text)
  errors <- c(errors, arms$swap)
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
  blanked <- character()
  if (length(arms$unverified) > 0 && length(errors) == 0) {
    blanked <- efficacy_arm_fields[!purrr::map_lgl(
      efficacy_arm_fields, \(field) is_absent(row[[field]])
    )]
    row <- without_unverified_arms(row, blanked)
  } else {
    errors <- c(errors, arms$unverified)
    warnings <- c(warnings, arms$warnings)
  }
  status <- dplyr::case_when(
    length(errors) > 0 ~ "failed",
    length(warnings) > 0 ~ "reassembled",
    .default = "exact"
  )
  flags <- verification_flags(row, quotes, sections, indication_text)
  list(
    status = status,
    errors = errors,
    warnings = warnings,
    flags = c(flags, if (length(blanked) > 0) "arms_not_verified"),
    blanked = blanked
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
