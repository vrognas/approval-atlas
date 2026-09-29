# Plain-language explanations of the ATC classes at levels 1 to 4 the data
# uses (owner decisions 2026-09-29): approval-atlas's own texts, written and
# reviewed by hand, a committed input (data-raw/atc-class-explanations.json),
# published as atc_class_explanations.json for the classes the data uses.
# Owner rule: each text is generic to its WHO class, never naming or
# describing the medicines in it now, so a class never needs rechecking when
# a medicine joins. WHO's class names stay WHO's (atc_classes.json); these
# texts are ours, part of the CC BY-SA 4.0 compilation.
atc_explanations_path <- "data-raw/atc-class-explanations.json"
atc_explanation_max_words <- 20L

atc_explanation_columns <- c(
  code = "character",
  level = "integer",
  explanation = "character",
  checked_date = "character",
  source = "character"
)

# Words the texts may use although they are medicine names, substance keys
# or active-substance texts of the data and not in the class's WHO name:
# what the class acts on or is defined by. Each is allowed only in the
# classes named in `codes` and their descendants (a text naming it in
# another class stops the build: testosterone in G03B, the androgens, would
# name a medicine there), with its reason; derived by running the check on
# the texts of 2026-09-29.
atc_explanation_allowed_words <- function() {
  words <- dplyr::tribble(
    ~word, ~codes, ~reason,
    "amino acids", "A16AX", paste(
      "A16AX (Various alimentary tract and metabolism products) holds what",
      "is neither amino acids nor enzymes: the WHO name of its sibling A16AA",
      "(Amino acids and derivatives)."
    ),
    "angiotensin ii", "C09A", paste(
      "The hormone ACE inhibitors (C09A, C09AA) stop the body from making:",
      "what the class acts on."
    ),
    "dopamine", c("C01CA", "N04", "N05A", "N06BA"), paste(
      "The messenger and receptor type the class acts on: adrenergic and",
      "dopaminergic agents (C01CA), anti-Parkinson drugs (N04), antipsychotics",
      "(N05A) and centrally acting sympathomimetics (N06BA)."
    ),
    "levodopa", "N04BA", paste(
      "The dopa of N04BA's WHO name (Dopa and dopa derivatives), by its INN:",
      "the class is defined by it."
    ),
    "parathyroid hormone", "H05B", paste(
      "The hormone anti-parathyroid agents (H05B, H05BX) lower: what the",
      "class acts on."
    ),
    "testosterone", c("L02AE", "L02B"), paste(
      "The male hormone GnRH analogues (L02AE) stop the body from making and",
      "hormone antagonists and anti-androgens (L02B, L02BB) block: what the",
      "class acts on."
    )
  )
  words$codes <- as.list(words$codes)
  words
}

read_atc_explanations <- function(path = atc_explanations_path) {
  if (!file.exists(path)) {
    cli::cli_abort("The ATC class explanations file {.path {path}} is missing.")
  }
  rows <- jsonlite::fromJSON(path)
  missing_columns <- setdiff(names(atc_explanation_columns), names(rows))
  if (length(missing_columns) > 0) {
    cli::cli_abort(c(
      "The ATC class explanations file lacks columns.",
      x = "{.val {offender_values(missing_columns)}}"
    ))
  }
  casts <- list(character = as.character, integer = as.integer)
  columns <- purrr::imap(atc_explanation_columns, function(type, column) {
    casts[[type]](rows[[column]])
  })
  dplyr::as_tibble(columns)
}

# Lower-case words separated by single spaces, with a space at each end, so a
# fixed match is a whole-word match ("dasatinib (anhydrous)" ->
# " dasatinib anhydrous ").
fold_explanation_words <- function(text) {
  words <- stringr::str_replace_all(
    stringr::str_to_lower(text),
    "[^\\p{L}\\p{N}]+",
    " "
  )
  paste0(" ", stringr::str_squish(words), " ")
}

# The data's medicine names, substance keys and EMA's active-substance texts
# (salts and spellings the keys lack: Neoatricon's key is "dopamine
# hydrochloride", its text "Dopamine") a text must not name, folded.
atc_explanation_terms <- function(medicines, substances, active_substances) {
  terms <- fold_explanation_words(stats::na.omit(c(
    medicines$name_of_medicine,
    substances$substance_key,
    active_substances$active_substance
  )))
  sort(unique(terms[terms != "  "]), method = "radix")
}

# "N04BA: levodopa" for each text naming a term (folded) that is neither in
# its class's WHO name (class_names: code -> name) nor an allowed word in
# that class (atc_explanation_allowed_words(): its codes and their
# descendants).
atc_explanations_naming_terms <- function(explanations, terms, class_names) {
  texts <- fold_explanation_words(explanations$explanation)
  who_names <- fold_explanation_words(dplyr::coalesce(
    unname(class_names[explanations$code]),
    ""
  ))
  allowed <- atc_explanation_allowed_words()
  allowed_terms <- fold_explanation_words(allowed$word)
  offenders <- purrr::map(terms, function(term) {
    allowed_codes <- as.character(unlist(allowed$codes[allowed_terms == term]))
    allowed_here <- purrr::map_lgl(explanations$code, function(code) {
      any(startsWith(code, allowed_codes))
    })
    named <- stringi::stri_detect_fixed(texts, term) &
      !stringi::stri_detect_fixed(who_names, term) &
      !allowed_here
    if (!any(named)) {
      return(character())
    }
    paste0(explanations$code[named], ": ", stringr::str_squish(term))
  })
  sort(purrr::list_c(offenders, ptype = character()), method = "radix")
}

# Stops the build on a malformed file: codes that are not ATC classes at
# levels 1 to 4, repeated codes, a level that is not the code's, texts that
# are empty, longer than 20 words, hold an em-dash or name a medicine or
# substance of the data (terms: atc_explanation_terms()), a checked date that
# is no date, or no source.
check_atc_explanations <- function(explanations, terms, class_names) {
  codes <- explanations$code
  level <- atc_code_level(codes)
  malformed <- !level %in% 1:4
  if (any(malformed)) {
    cli::cli_abort(c(
      "ATC class explanations need an ATC class at levels 1 to 4.",
      x = "{.val {offender_values(codes[malformed])}}"
    ))
  }
  repeated <- duplicated(codes)
  if (any(repeated)) {
    cli::cli_abort(c(
      "ATC class explanations list a code more than once.",
      x = "{.val {offender_values(codes[repeated])}}"
    ))
  }
  wrong_level <- !(explanations$level == level) %in% TRUE
  if (any(wrong_level)) {
    cli::cli_abort(c(
      "ATC class explanations give a level that is not their code's.",
      x = "{.val {offender_values(codes[wrong_level])}}"
    ))
  }
  text <- stringr::str_squish(dplyr::coalesce(explanations$explanation, ""))
  empty <- text == ""
  if (any(empty)) {
    cli::cli_abort(c(
      "ATC class explanations need a text.",
      x = "{.val {offender_values(codes[empty])}}"
    ))
  }
  long <- lengths(strsplit(text, " ", fixed = TRUE)) >
    atc_explanation_max_words
  if (any(long)) {
    cli::cli_abort(c(
      "ATC class explanations must be at most {atc_explanation_max_words}
      words.",
      x = "{.val {offender_values(codes[long])}}"
    ))
  }
  dashed <- grepl("—", text, fixed = TRUE)
  if (any(dashed)) {
    cli::cli_abort(c(
      "ATC class explanations must not use em-dashes.",
      x = "{.val {offender_values(codes[dashed])}}"
    ))
  }
  naming <- atc_explanations_naming_terms(explanations, terms, class_names)
  if (length(naming) > 0) {
    cli::cli_abort(c(
      "ATC class explanations must not name a medicine or substance of the
      data (unless it is in the class's WHO name or an allowed word:
      {.fn atc_explanation_allowed_words} in that class).",
      x = "{.val {offender_values(naming)}}"
    ))
  }
  undated <- !grepl("^\\d{4}-\\d{2}-\\d{2}$", explanations$checked_date) |
    is.na(as.Date(explanations$checked_date, optional = TRUE))
  unsourced <- is.na(explanations$source) | explanations$source == ""
  if (any(undated | unsourced)) {
    cli::cli_abort(c(
      "ATC class explanations need a checked date (YYYY-MM-DD) and a
      source.",
      x = "{.val {offender_values(codes[undated | unsourced])}}"
    ))
  }
  invisible(explanations)
}

# The classes at levels 1 to 4 the site shows: every prefix of the code each
# ATC row is shown by (current_atc_code, else atc_code; as the frontend's
# atcCode()), of valid codes only.
atc_explained_classes_in_use <- function(atc_codes) {
  codes <- dplyr::coalesce(atc_codes$current_atc_code, atc_codes$atc_code)
  codes <- unique(codes[!is.na(atc_code_level(codes))])
  prefixes <- unlist(purrr::map(codes, atc_code_prefixes))
  sort(unique(prefixes[nchar(prefixes) < 7]), method = "radix")
}

# The explanations of the classes the data uses (atc_class_explanations.json),
# after check_atc_explanations(). Warns about classes the data uses without
# an explanation (a class WHO does not name says so) and explanations of
# classes it no longer uses (both left out).
build_atc_explanations_table <- function(explanations,
                                         atc_codes,
                                         atc_classes,
                                         medicines,
                                         substances,
                                         active_substances) {
  class_names <- stats::setNames(atc_classes$name, atc_classes$atc_code)
  check_atc_explanations(
    explanations,
    atc_explanation_terms(medicines, substances, active_substances),
    class_names
  )
  used <- atc_explained_classes_in_use(atc_codes)
  unexplained <- setdiff(used, explanations$code)
  if (length(unexplained) > 0) {
    unexplained <- paste0(
      unexplained,
      ifelse(unexplained %in% atc_classes$atc_code, "", " (no WHO name)")
    )
    cli::cli_warn(c(
      "ATC classes the data uses have no explanation (their tips show none):",
      x = "{.val {offender_values(unexplained, length(unexplained))}}"
    ))
  }
  unused <- setdiff(explanations$code, used)
  if (length(unused) > 0) {
    cli::cli_warn(c(
      "ATC class explanations of classes the data no longer uses (left out):",
      x = "{.val {offender_values(unused, length(unused))}}"
    ))
  }
  explanations |>
    dplyr::filter(.data$code %in% used) |>
    dplyr::transmute(
      atc_code = .data$code,
      .data$level,
      .data$explanation,
      .data$checked_date,
      source = "approval_atlas"
    ) |>
    dplyr::arrange(.data$atc_code)
}

# meta.json entry (none when no explanation is in the data).
atc_explanations_source_entry <- function(explanations) {
  if (nrow(explanations) == 0) {
    return(NULL)
  }
  checked <- max(explanations$checked_date)
  list(
    name = "ATC class explanations",
    url = paste0(
      "https://github.com/vrognas/approval-atlas/blob/main/",
      atc_explanations_path
    ),
    version = paste("Checked", checked),
    retrieved = checked,
    licence = paste(
      "CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/);",
      "approval-atlas's own texts"
    ),
    attribution = paste(
      "Plain-language explanations of the ATC classes, written and checked",
      "by hand by approval-atlas: its own summaries, not WHO's. ATC codes and",
      "class names © WHO Collaborating Centre for Drug Statistics",
      "Methodology."
    )
  )
}
