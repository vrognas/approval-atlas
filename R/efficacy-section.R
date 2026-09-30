# Section 5.1 ("Pharmacodynamic properties", with "Clinical efficacy and
# safety") of the first SmPC in a product information PDF, which holds one
# SmPC per strength or form: later copies repeat it.

smpc_section_start <- "(?m)^\\s*5\\.1\\s+Pharmacodynamic properties"
smpc_section_end <- "(?m)^\\s*5\\.2\\s+Pharmacokinetic properties"

slice_smpc_efficacy <- function(page_texts) {
  joined <- paste(page_texts, collapse = "\f")
  start <- regexpr(smpc_section_start, joined, perl = TRUE)
  if (start < 0) {
    return(list(text = NA_character_, pages = character()))
  }
  rest <- substring(joined, start)
  end <- regexpr(smpc_section_end, rest, perl = TRUE)
  section <- if (end > 0) substring(rest, 1, end - 1) else rest
  pages <- strsplit(section, "\f", fixed = TRUE)[[1]]
  list(text = paste(pages, collapse = "\n"), pages = pages)
}
