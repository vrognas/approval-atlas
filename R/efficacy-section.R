# Section 5.1 ("Pharmacodynamic properties", with "Clinical efficacy and
# safety") of the first SmPC in a product information PDF, which holds one
# SmPC per strength or form: later copies repeat it.

smpc_section_start <-
  "(?m)(?:^|\\f)\\s*\\K5\\.1[\\s ]+Pharmacodynamic properties"
smpc_section_end <-
  "(?m)(?:^|\\f)\\s*\\K5\\.2[\\s ]+Pharmacokinetic properties"

slice_smpc_efficacy <- function(page_texts) {
  joined <- paste(page_texts, collapse = "\f")
  start_match <- regexpr(smpc_section_start, joined, perl = TRUE)
  if (start_match < 0) {
    return(list(
      text = NA_character_, pages = character(), first_page = NA_integer_
    ))
  }
  start <- start_match[[1]]
  # Pages are joined by form feeds: those before the heading count the pages
  # before the one it starts on.
  before <- substr(joined, 1, start - 1)
  first_page <- sum(gregexpr("\f", before, fixed = TRUE)[[1]] > 0) + 1L
  start_len <- attr(start_match, "match.length")[[1]]
  rest <- substring(joined, start)
  # Find next 5.1 after the first match
  search_from <- start_len + 1L
  next_match <- regexpr(smpc_section_start,
    substring(rest, search_from),
    perl = TRUE
  )
  # Find 5.2 to mark end of section
  section_end <- regexpr(smpc_section_end, rest, perl = TRUE)
  # Determine endpoint: 5.2 if found and before next 5.1, else next 5.1,
  # else end of text
  end_pos <- if (attr(section_end, "match.length") > 0) {
    if (next_match < 0) {
      section_end
    } else {
      min(section_end, next_match + search_from - 1L)
    }
  } else if (next_match > 0) {
    next_match + search_from - 1L
  } else {
    nchar(rest) + 1L
  }
  section <- substring(rest, 1, end_pos - 1)
  pages <- strsplit(section, "\f", fixed = TRUE)[[1]]
  list(
    text = paste(pages, collapse = "\n"),
    pages = pages,
    first_page = first_page
  )
}
