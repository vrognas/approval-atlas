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

# The Symbol font's "=" is a private-use glyph (Alecensa's "n = 67"), which
# normalising drops ("n 67", as the model quotes it): a text holding it is
# also read with "=" in its place, as another rendering.
symbol_font_renderings <- function(section_text) {
  unique(c(section_text, gsub("\uf03d", "=", section_text, fixed = TRUE)))
}

# A section as the checks read it: its renderings (`texts`, the Symbol "="
# both ways), each normalised (`sections`), all joined (`joined`), and its
# layout lines (`lines`, section_lines()).
efficacy_section_texts <- function(section_text) {
  texts <- symbol_font_renderings(section_text)
  sections <- purrr::map_chr(texts, normalise_efficacy_text)
  list(
    texts = texts,
    sections = sections,
    joined = paste(sections, collapse = " "),
    lines = section_lines(texts)
  )
}

# For a field's own text, whose "12" on a line of its own is the value, not a
# page number.
normalise_spacing <- function(text) {
  # No-break, thin and narrow no-break spaces.
  text <- gsub("[\u00a0\u2009\u202f]", " ", text, perl = TRUE)
  # Private-use glyphs (Wingdings bullets inside table rows) carry no text;
  # for the Symbol font's "=" see symbol_font_renderings().
  text <- gsub("[\ue000-\uf8ff]", " ", text, perl = TRUE)
  trimws(gsub("\\s+", " ", text, perl = TRUE))
}

number_tokens <- function(value) {
  tokens <- gregexpr("[0-9]+(?:\\.[0-9]+)?|NR|NE|NA|NC", value, perl = TRUE)
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

# How the value and its CI stand together in one quote, so a value cannot
# borrow the interval of another row, or of another column of its row
# ("0.45 (0.33, 0.62) 0.43 (0.31, 0.60)" is not 0.45 (0.31, 0.60)):
# "adjacent", with no other number between them but a CI level
# ("0.82 (95% CI: 0.67, 1.01)"; also when the row has no CI); "column", a
# table printing its values, then their intervals in the same column order
# (value_ci_in_columns()); else "none". An interval in a run of intervals
# pairs by column only: in "52% 40% 63% 45% (40.6, 62.9) (28.0, 52.9) ...",
# 45 stands right before the first interval, which is 52's.
value_ci_binding <- function(row, quotes) {
  value <- row[["value"]]
  ci_low <- row[["ci_low"]]
  ci_high <- row[["ci_high"]]
  if (is_absent(value) || is_absent(ci_low) || is_absent(ci_high)) {
    return("adjacent")
  }
  bindings <- purrr::map_chr(
    quotes, quote_value_ci_binding,
    value = value, ci_low = ci_low, ci_high = ci_high
  )
  c(intersect(c("adjacent", "column"), bindings), "none")[1]
}

quote_value_ci_binding <- function(quote, value, ci_low, ci_high) {
  ci_level <- "[0-9]{2}(?:\\.[0-9]+)?\\s?%[\\s-]?(?i:ci\\b|confidence)"
  gap <- paste0("(?:[^0-9]|(?<![0-9.])", ci_level, "){0,40}?")
  pattern <- paste0(
    bounded_number(escape_regex(value)), gap,
    bounded_number(escape_regex(ci_low)), "[^0-9]{1,6}",
    bounded_number(escape_regex(ci_high))
  )
  table <- quote_table_parts(quote)
  ci <- c(number_tokens(ci_low), number_tokens(ci_high))
  in_run <- purrr::map_lgl(seq_along(table$intervals), function(index) {
    bounds <- table$intervals[[index]][c("low", "high")]
    identical(table$tokens[bounds], ci) &&
      sum(table$runs == table$runs[index]) > 1
  })
  if (!any(in_run) && grepl(pattern, quote, perl = TRUE)) {
    return("adjacent")
  }
  if (value_ci_in_columns(table, value, ci)) "column" else "none"
}

# A quote's tokens (layout_tokens()), its values (quote_value_positions()),
# its intervals (quote_intervals()) and the run each interval belongs to
# (intervals with only marks between them share one).
quote_table_parts <- function(quote) {
  tokens <- layout_tokens(quote)[[1]]
  values <- quote_value_positions(tokens)
  intervals <- quote_intervals(tokens, values)
  marks_only <- function(from, to) {
    between <- tokens[seq_along(tokens) > from & seq_along(tokens) < to]
    !any(grepl("[\\p{L}\\p{N}]", between, perl = TRUE))
  }
  runs <- integer(length(intervals))
  for (index in seq_along(intervals)) {
    same_run <- index > 1 && marks_only(
      intervals[[index - 1]][["end"]], intervals[[index]][["start"]]
    )
    runs[index] <- if (same_run) runs[index - 1] else index
  }
  list(tokens = tokens, values = values, intervals = intervals, runs = runs)
}

interval_separators <- c(",", ";", "-", "\u2013", "to")

# The intervals among a quote's tokens ("(", or "[", a value, an optional
# "%", a separator, a value, an optional "%", ")" or "]"), each as the
# positions of its brackets and bounds, in quote order.
quote_intervals <- function(tokens, values) {
  last <- length(tokens)
  starts <- which(tokens %in% c("(", "["))
  intervals <- purrr::map(starts, function(start) {
    at <- start + 1L
    if (at > last || !values[at]) {
      return(NULL)
    }
    low <- at
    at <- at + 1L + (at + 1L <= last && tokens[at + 1L] == "%")
    if (at > last || !tokens[at] %in% interval_separators) {
      return(NULL)
    }
    high <- at + 1L
    if (high > last || !values[high]) {
      return(NULL)
    }
    end <- high + 1L + (high + 1L <= last && tokens[high + 1L] == "%")
    if (end > last || !tokens[end] %in% c(")", "]")) {
      return(NULL)
    }
    c(start = start, end = end, low = low, high = high)
  })
  purrr::compact(intervals)
}

# The values of a table row printed before a run of its intervals, as the
# positions of the run's cells' values: going back from the run over words
# and marks (a wrapped label, "(95% CI)"), then over values with only marks
# between them, until a word. Empty when an interval stands among them.
column_values_before <- function(tokens, values, intervals, run_start) {
  word <- grepl("[\\p{L}\\p{N}]", tokens, perl = TRUE) & !values
  at <- run_start - 1L
  while (at >= 1L && !values[at]) at <- at - 1L
  cells <- integer()
  while (at >= 1L && !word[at]) {
    if (values[at]) cells <- c(at, cells)
    at <- at - 1L
  }
  inside <- purrr::map_lgl(intervals, function(interval) {
    length(cells) > 0 && interval[["start"]] > min(cells) &&
      interval[["end"]] < max(cells)
  })
  if (any(inside)) integer() else cells
}

# Whether a table row prints the value as its j-th cell's and the CI as the
# j-th of the intervals in a run right after the cells (Libtayo's "ORR 50.8%
# 44.9% 46.4% 95% CI for ORR (37.5, 64.1) (33.6, 56.6) (33.0, 60.3)", 44.9
# with (33.6, 56.6)): as many cells as intervals, each cell one value or two
# (a count and its percentage, "62 (50.8 %)"), and no interval among them.
# `table`: quote_table_parts(); `ci`: the CI's two value tokens.
value_ci_in_columns <- function(table, value, ci) {
  value_token <- number_tokens(value)
  if (length(value_token) != 1 || length(ci) != 2) {
    return(FALSE)
  }
  tokens <- table$tokens
  intervals <- table$intervals
  for (index in seq_along(intervals)) {
    if (!identical(tokens[intervals[[index]][c("low", "high")]], ci)) next
    run <- which(table$runs == table$runs[index])
    cells <- column_values_before(
      tokens, table$values, intervals, intervals[[run[1]]][["start"]]
    )
    per_cell <- length(cells) / length(run)
    if (!per_cell %in% c(1, 2)) next
    places <- which(tokens[cells] == value_token)
    if (any(ceiling(places / per_cell) == match(index, run))) {
      return(TRUE)
    }
  }
  FALSE
}

# `section`: efficacy_section_texts(); a column's bare "N 247" is looked up
# in its layout lines.
arm_size_found <- function(n, section) {
  if (is_absent(n)) {
    return(TRUE)
  }
  # Thousands printed with a space ("1 274") or a comma ("1,274").
  any(purrr::map_lgl(arm_size_spellings(n), function(size) {
    grepl(arm_size_pattern(size), section$joined, perl = TRUE) ||
      any(section$lines %in% paste(c("N", "n"), size))
  }))
}

# The arm-size notations the SmPCs print: "n=", "n =", "N = ", "(N=143)", a
# table header's "(n = 74)" (Alecensa's Symbol-font "=" included,
# symbol_font_renderings()). The letter stands on its own and the count whole:
# "N = 2470" and "n = 107/247" are not 247. Without "=" only a line that is
# "N" and the count (arm_size_found(): Retsevmo's column "N 247"), as tables
# print events and responders as "n 189", "Number of responders, n 44".
arm_size_pattern <- function(size) {
  paste0(
    "(?<![A-Za-z0-9])[nN]\\s*=\\s*", escape_regex(size),
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

# A section's lines that hold text (of each of its texts), normalised as the
# section.
section_lines <- function(section_text) {
  lines <- strsplit(strip_page_number_lines(section_text), "\n", fixed = TRUE)
  lines <- normalise_spacing(unlist(lines))
  lines[nzchar(lines)]
}

# A section's lines that hold text, each as its tokens.
section_line_tokens <- function(section_text) {
  layout_tokens(section_lines(section_text))
}

# The tokens of a quote that are values (numbers, NR, NE, NA, NC), all but a
# CI level ("95" in "(95% CI)", a label a wrapped row can print on another
# line).
quote_value_positions <- function(tokens) {
  values <- grepl("^([0-9]+(\\.[0-9]+)?|NR|NE|NA|NC)$", tokens)
  after <- function(offset) c(tokens[-seq_len(offset)], rep("", offset))
  ci_level <- after(1) == "%" &
    grepl("^(ci|confidence)", tolower(after(2)))
  values & !ci_level
}

# Signs and comparisons that change the value they stand before.
value_signs <- c(
  "-", "\u2212", "\u2013", "<", ">", "\u2264", "\u2265", "=", "\u00b1", "%"
)

# The tokens of a quote only the row's own line may give: its values, every
# token between the first value and the last (a "-" or an "NC" from another
# line would change the interval), and a sign right before the first value
# ("-0.71").
row_token_positions <- function(tokens, values) {
  if (!any(values)) {
    return(values)
  }
  position <- seq_along(tokens)
  first <- min(which(values))
  between <- position >= first & position <= max(which(values))
  between | (position == first - 1L & tokens %in% value_signs)
}

# Whether the quote's tokens can be read off the window's lines: from each
# line a run of consecutive tokens, in the line's order, the runs interleaved
# as the quote reads them; the row's own tokens (row_token_positions()) only
# from the line `row` (NA: the quote holds no value), and nothing from a line
# below it before its first token (a heading below is another row's label).
quote_reads_window <- function(tokens, values, lines, row) {
  from_row <- row_token_positions(tokens, values)
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
      if (from_row[index] && !identical(line, row)) next
      if (!is.na(row) && line > row && positions[row] == 0L) next
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
# from another row; what lies between its first and last value, and a sign
# before the first, come from that line too. The other lines add only words
# and marks: a row label wrapped onto the next line, a footnote mark printed
# above, column headers; a line below the row adds nothing before the row's
# own words. A row label can still come from the line above (a quote read
# so is flagged, verify_efficacy_row()).
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

# An arm size as a quote prints it, with or without a thousands separator.
quote_holds_size <- function(n, quote) {
  any(purrr::map_lgl(arm_size_spellings(n), contains_bounded, text = quote))
}

# Each value of the control arm with its treatment arm's counterpart: the
# sizes say which arm is which, as the arm values do.
efficacy_arm_pairs <- list(
  values = list(control = "arm_control", treatment = "arm_treatment",
                holds = quote_holds_number),
  sizes = list(control = "n_control", treatment = "n_treatment",
               holds = quote_holds_size)
)

# The comparator's column label and a control arm's value (`pair`) in one of
# the quotes holding the label (`with_label`).
label_tie <- function(row, pair, label, with_label) {
  control <- row[[pair$control]]
  treatment <- row[[pair$treatment]]
  if (is_absent(control)) {
    return(list())
  }
  holds <- function(value) {
    purrr::map_lgl(with_label, \(quote) pair$holds(value, quote))
  }
  if (any(holds(control))) {
    return(list())
  }
  apart <- sprintf(
    "comparator_column_label '%s' not in a quote with %s '%s'",
    label, pair$control, control
  )
  if (!is_absent(treatment) && any(holds(treatment))) {
    return(list(swap = sprintf(
      "%s but with %s '%s' (arms swapped)", apart, pair$treatment, treatment
    )))
  }
  list(unverified = apart)
}

# The comparator's column label and each value of the control arm (its value,
# its size) stand in one quote, so arms read from the wrong column cannot
# pass (ALEX prints the comparator first). A label in a quote with the
# treatment arm's value and not the control's is a swap (`swap`, which
# rejects the row), for the arm values as for the sizes; a label in no quote
# with the control's value is only unverified (`unverified`). A quote holding
# both columns passes either way, so this ties no size to its arm: the sizes
# need their columns (unverified_sizes()).
comparator_label_check <- function(row, quotes) {
  label <- row[["comparator_column_label"]]
  if (is_absent(label)) {
    return(list())
  }
  with_label <- quotes[purrr::map_lgl(quotes, contains_folded, text = label)]
  checks <- purrr::map(efficacy_arm_pairs, function(pair) {
    label_tie(row, pair, label, with_label)
  })
  list(
    swap = unlist(purrr::map(checks, "swap")),
    unverified = checks$values$unverified
  )
}

# A section's lines as printed, their spacing kept so a cell's columns can be
# read off the line (one space for each no-break space or private-use glyph),
# without page-number lines and blank lines.
efficacy_layout_lines <- function(texts) {
  lines <- unlist(strsplit(strip_page_number_lines(texts), "\n", fixed = TRUE))
  lines <- gsub("[\u00a0\u2009\u202f\ue000-\uf8ff]", " ", lines, perl = TRUE)
  lines[grepl("\\S", lines, perl = TRUE)]
}

# The columns where `text` fills a whole cell of a layout line (case aside,
# its words one space apart): a line's edge or two spaces on each side, as a
# table's cells stand apart. "chemotherapy" is no cell of "Tislelizumab +
# chemotherapy".
cell_places <- function(text, line) {
  words <- strsplit(normalise_spacing(text), " ", fixed = TRUE)[[1]]
  pattern <- paste0("(?i)", paste(escape_regex(words), collapse = "\\s"))
  found <- gregexpr(pattern, line, perl = TRUE)[[1]]
  if (found[1] == -1) {
    return(list(first = integer(), last = integer()))
  }
  first <- as.integer(found)
  last <- first + attr(found, "match.length") - 1L
  before <- substring(line, 1L, first - 1L)
  after <- substring(line, last + 1L)
  whole <- grepl("(^\\s*|\\s\\s)$", before, perl = TRUE) &
    grepl("^(\\s*$|\\s\\s)", after, perl = TRUE)
  list(first = first[whole], last = last[whole])
}

# The ways a label's words wrap over one to three lines of a header.
label_splits <- function(words) {
  part <- function(from, to) paste(words[from:to], collapse = " ")
  count <- length(words)
  splits <- list(part(1L, count))
  for (end in seq_len(count - 1L)) {
    splits <- c(splits, list(c(part(1L, end), part(end + 1L, count))))
    for (second in seq_len(count - 1L)[seq_len(count - 1L) > end]) {
      splits <- c(splits, list(c(
        part(1L, end), part(end + 1L, second), part(second + 1L, count)
      )))
    }
  }
  splits
}

# Where `parts` stand as cells on consecutive lines from `top`, each part
# under the one above (overlapping its columns): the lines and the columns
# they span.
wrapped_cell_places <- function(parts, lines, top) {
  bottom <- top + length(parts) - 1L
  if (bottom > length(lines)) {
    return(list())
  }
  starts <- cell_places(parts[1], lines[top])
  purrr::compact(purrr::map2(starts$first, starts$last, function(first, last) {
    span <- c(first, last)
    for (index in seq_along(parts)[-1]) {
      below <- cell_places(parts[index], lines[top + index - 1L])
      under <- below$first <= last & below$last >= first
      if (!any(under)) {
        return(NULL)
      }
      first <- below$first[under][1]
      last <- below$last[under][1]
      span <- range(span, first, last)
    }
    list(top = top, bottom = bottom, first = span[1], last = span[2])
  }))
}

# Where a column label stands as a table header: a whole cell on one line,
# or its words wrapped over two or three lines (cell_places()).
label_places <- function(label, lines) {
  words <- strsplit(normalise_spacing(label), " ", fixed = TRUE)[[1]]
  lower <- tolower(lines)
  places <- purrr::map(label_splits(words), function(parts) {
    tops <- which(grepl(tolower(parts[1]), lower, fixed = TRUE))
    purrr::map(tops, \(top) wrapped_cell_places(parts, lines, top))
  })
  purrr::list_flatten(purrr::list_flatten(places))
}

# The arm sizes a layout line prints in n notation ("(N=143)", "n = 1 274"),
# each with its columns and count.
size_notations <- function(line) {
  pattern <- paste0(
    "(?<![A-Za-z0-9])[nN]\\s*=\\s*",
    "([0-9]{1,3}(?:[ ,][0-9]{3})+|[0-9]+)(?![0-9]|[.,][0-9])"
  )
  found <- gregexpr(pattern, line, perl = TRUE)[[1]]
  if (found[1] == -1) {
    return(list(first = integer(), last = integer(), count = integer()))
  }
  first <- as.integer(found)
  last <- first + attr(found, "match.length") - 1L
  text <- regmatches(line, list(found))[[1]]
  count <- as.integer(gsub("[^0-9]", "", sub("^[^=]*=", "", text)))
  list(first = first, last = last, count = count)
}

efficacy_count <- function(value) {
  if (is_absent(value)) NA_integer_ else suppressWarnings(as.integer(value))
}

# The arm sizes in n notation on the lines `indices`: line, columns, count.
size_notations_on <- function(notations, indices) {
  purrr::map(indices, function(index) {
    sizes <- notations[[index]] %||% size_notations("")
    dplyr::tibble(
      line = rep(index, length(sizes$first)), first = sizes$first,
      last = sizes$last, count = sizes$count
    )
  }) |>
    purrr::list_rbind()
}

# Whether a size stands under a place of the label: on one of the three lines
# below it, overlapping its columns.
under_place <- function(place, line, first, last) {
  line > place$bottom & line <= place$bottom + 3L &
    first <= place$last & last >= place$first
}

# The arm sizes a two-arm table places under their arms' column headers
# (`lines`: efficacy_layout_lines()). n_control: in n notation under the
# comparator's column label (a header cell, label_places(); the size at most
# three lines below), with no other size under that place of the label, nor
# under another place of it next to the control's size, either of which
# would leave the label's column unclear ("chemotherapy" over "Drugamab +"'s
# and "Placebo +"'s sizes, a flow text's one column). n_treatment, with it:
# the header's only other size in n notation (from two lines above the label
# to three below the control's size), on the control's size line or next to
# it, so the other column's. The size fields placed: n_control alone where
# n_treatment is not (a third arm's size nearby leaves the treatment's
# column unknown). A treatment arm's size beside a third arm's that is not
# in n notation is not caught.
sizes_in_label_columns <- function(row, lines) {
  label <- row[["comparator_column_label"]]
  control <- efficacy_count(row[["n_control"]])
  treatment <- efficacy_count(row[["n_treatment"]])
  if (is_absent(label) || is.na(control)) {
    return(character())
  }
  places <- label_places(label, lines)
  # The arm sizes of the lines a place's checks read (place_sizes()).
  reach <- unique(unlist(purrr::map(places, function(place) {
    max(1L, place$top - 2L):min(length(lines), place$bottom + 6L)
  })))
  notations <- vector("list", length(lines))
  notations[reach] <- purrr::map(lines[reach], size_notations)
  placed <- unlist(purrr::map(
    places, place_sizes,
    places = places, notations = notations, control = control,
    treatment = treatment
  ))
  intersect(c("n_treatment", "n_control"), placed)
}

# The size fields one place of the label places (sizes_in_label_columns();
# `notations`: size_notations() of each line it reads).
place_sizes <- function(place, places, notations, control, treatment) {
  last_line <- length(notations)
  below <- place$bottom + seq_len(3L)
  below <- below[below <= last_line]
  if (length(below) == 0) {
    return(character())
  }
  sizes <- size_notations_on(notations, below)
  controls <- which(
    sizes$count == control &
      under_place(place, sizes$line, sizes$first, sizes$last)
  )
  placed <- character()
  for (index in controls) {
    size <- sizes[index, ]
    nearby <- max(1L, size$line - 1L):min(last_line, size$line + 1L)
    around <- dplyr::bind_rows(sizes, size_notations_on(notations, nearby))
    around <- dplyr::distinct(around)
    others <- around[!(around$line == size$line &
                         around$first == size$first), ]
    under_any <- purrr::map(
      places, under_place, others$line, others$first, others$last
    )
    unclear <- under_place(place, others$line, others$first, others$last) |
      (others$line %in% nearby &
         purrr::reduce(under_any, `|`, .init = logical(nrow(others))))
    if (any(unclear)) next
    placed <- "n_control"
    window <- max(1L, place$top - 2L):min(last_line, size$line + 3L)
    beside <- others[others$line %in% nearby, ]
    if (!is.na(treatment) && treatment %in% beside$count &&
          nrow(size_notations_on(notations, window)) == 2L) {
      return(c("n_treatment", "n_control"))
    }
  }
  placed
}

# Owner decision 2026-10-01 ("blank the sizes and show the row"): the arm
# sizes the verifier cannot tie to their arms are blanked, unflagged, so a row
# whose value and CI verify is shown without them, never with a size that may
# be another arm's or another count: a size the section does not print in an
# n notation (arm_size_found()), and, on a two-arm effect, a size a table
# does not place under its arm's column header (sizes_in_label_columns()). A
# two-arm row with arm values and no label keeps its printed sizes:
# comparator_label_missing hides it for a human, who sees them. A single-arm
# effect's size names its one arm (a row of two arms with one is flagged,
# single_arm_with_control).
unverified_sizes <- function(row, section) {
  given <- efficacy_size_fields[
    !purrr::map_lgl(efficacy_size_fields, \(field) is_absent(row[[field]]))
  ]
  if (length(given) == 0) {
    return(character())
  }
  printed <- given[purrr::map_lgl(given, function(field) {
    arm_size_found(row[[field]], section)
  })]
  unlabelled_arms <- is_absent(row[["comparator_column_label"]]) &&
    any_given(row, efficacy_arm_number_fields)
  if (!two_arm_effect(row) || unlabelled_arms) {
    return(setdiff(given, printed))
  }
  placed <- sizes_in_label_columns(row, efficacy_layout_lines(section$texts))
  setdiff(given, intersect(printed, placed))
}

# What the row says about each arm (the values, their sizes and measure and
# the comparator's column label): blanked together when they do not verify.
efficacy_arm_fields <- c(
  "arm_treatment", "arm_control", "n_treatment", "n_control", "arm_measure",
  "comparator_column_label"
)
efficacy_arm_number_fields <- c("arm_treatment", "arm_control")
efficacy_size_fields <- c("n_treatment", "n_control")
# The values per arm, and those of the control arm, which the comparator's
# column label ties to their column.
efficacy_arm_value_fields <- c(
  "arm_treatment", "arm_control", "n_treatment", "n_control"
)
efficacy_control_fields <- c("arm_control", "n_control")

# A label with no control arm's value to tie says nothing checkable (the
# treatment's header could pass as the comparator's): dropped, unflagged.
untied_label <- function(row) {
  !is_absent(row[["comparator_column_label"]]) &&
    !any_given(row, efficacy_control_fields)
}

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
# verify, or a label with nothing to tie, is never shown.
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

# Where each quote was found: "verbatim" (intact in a section text),
# "layout" (read off at most three of its layout lines,
# quote_in_layout_lines()) or NA (not found).
quote_sources <- function(quotes, sections, section_text) {
  verbatim <- purrr::map_lgl(quotes, quote_in_a_section, sections = sections)
  sources <- dplyr::if_else(verbatim, "verbatim", NA_character_)
  if (all(verbatim)) {
    return(sources)
  }
  line_tokens <- purrr::map(section_text, section_line_tokens)
  in_layout <- purrr::map_lgl(quotes[!verbatim], function(quote) {
    any(purrr::map_lgl(line_tokens, quote_in_layout_lines, quote = quote))
  })
  sources[!verbatim][in_layout] <- "layout"
  sources
}

# `section_text` is one or more renderings of the same section (layout and
# flow text; the Symbol font's "=" is read both ways,
# symbol_font_renderings()): a quote passes when it occurs intact in any of
# them, or read across at most three of its layout lines
# (quote_in_layout_lines()), which flags the row quote_across_lines: the quote
# is not the text as printed, so a human checks its label is the row's. A CI
# paired with its value by column order (value_ci_binding()) flags it
# ci_paired_by_column. `indication_text` is the medicine's section 4.1, for
# the indication check (none without it). When everything else verifies but
# the arm values do not (not in the quotes, or the comparator's label in no
# quote with the control's value), the row is kept without its arms:
# `blanked` names the arm fields to blank (without_unverified_arms()), and
# the flag arms_not_verified hides it until reviewed. A label quoted with the
# treatment arm's value or size is a swap and rejects the row. Arm sizes
# nothing ties to their arms (unverified_sizes()) and then a label with no
# control arm's value to tie (untied_label()) are in `blanked` too,
# unflagged. A single-arm effect on a row of two arms (a comparator or a
# control arm's value, as the model gave them) is flagged
# single_arm_with_control: the card would show one arm's result as the
# medicine's.
verify_efficacy_row <- function(row, section_text, indication_text = NULL) {
  section <- efficacy_section_texts(section_text)
  sections <- section$sections
  all_sections <- section$joined
  row <- normalise_number_fields(row)
  second_arm <- single_arm_effect(row) && two_arm_row(row)
  quotes <- purrr::map_chr(row[["quotes"]], normalise_efficacy_text)
  quotes <- quotes[nzchar(quotes)]
  sources <- quote_sources(quotes, sections, section$texts)
  found <- !is.na(sources)
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
  binding <- value_ci_binding(row, quotes)
  if (binding == "none") {
    errors <- c(errors, sprintf(
      "value and CI not in one quote: %s (%s, %s)",
      row[["value"]], row[["ci_low"]], row[["ci_high"]]
    ))
  }
  arms <- check_arms(row, quotes, quotes_text)
  errors <- c(errors, arms$swap)
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
  dropped <- if (length(errors) == 0) {
    unverified_sizes(row, section)
  } else {
    character()
  }
  row <- without_unverified_arms(row, dropped)
  if (length(errors) == 0 && untied_label(row)) {
    dropped <- c(dropped, "comparator_column_label")
    row <- without_unverified_arms(row, "comparator_column_label")
  }
  status <- dplyr::case_when(
    length(errors) > 0 ~ "failed",
    length(warnings) > 0 ~ "reassembled",
    .default = "exact"
  )
  flags <- c(
    verification_flags(row, quotes, sections, indication_text),
    if (any(sources %in% "layout")) "quote_across_lines",
    if (binding == "column") "ci_paired_by_column",
    if (length(blanked) > 0) "arms_not_verified",
    if (second_arm) "single_arm_with_control"
  )
  list(
    status = status,
    errors = errors,
    warnings = warnings,
    flags = flags,
    blanked = c(blanked, dropped)
  )
}

# The page of `page_texts` a quote starts on, also across a page break; a
# table row quoted in reading order by its layout lines (quote_layout_page());
# the Symbol font's "=" read both ways (symbol_font_renderings()).
efficacy_quote_page <- function(quote, page_texts) {
  page <- quote_page_in(quote, page_texts)
  decoded <- gsub("\uf03d", "=", page_texts, fixed = TRUE)
  if (is.na(page) && !identical(decoded, page_texts)) {
    page <- quote_page_in(quote, decoded)
  }
  page
}

quote_page_in <- function(quote, page_texts) {
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
  quote_layout_page(quote, page_texts)
}

# A table row quoted in reading order (quote_in_layout_lines()): the first
# page whose layout lines read it, else the first of two pages that do
# together; NA when none does.
quote_layout_page <- function(quote, page_texts) {
  lines <- purrr::map(page_texts, section_line_tokens)
  for (page in seq_along(lines)) {
    if (quote_in_layout_lines(quote, lines[[page]])) {
      return(page)
    }
  }
  for (page in seq_len(length(lines) - 1)) {
    if (quote_in_layout_lines(quote, c(lines[[page]], lines[[page + 1]]))) {
      return(page)
    }
  }
  NA_integer_
}
