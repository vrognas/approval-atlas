# Phase A0 of "Pivotal results": scoring what a model extracts from the pilot's
# SmPC section 5.1 texts against the hand-verified gold rows, and the driver
# (scripts/eval-efficacy-gold.R) that asks each model and writes a report. The
# driver uses the Message Batches API as the real extractor does (ruling R13:
# long sections would time out as single calls, and the batch is half the
# price); the owner runs it, tests inject the batch functions (no network).
#
# The gold rows use the pilot's schema, the extractor's rows the pipeline's.
# The scorer reads both through the same few columns:
# - medicine, trial (folded: "KEYNOTE 024" = "KEYNOTE-024", "ALEX (BO28984)" =
#   "ALEX", its first word and a following number) and endpoint (an
#   abbreviation: "Progression-free survival (PFS)" = "PFS") name the group a
#   row is compared within; rows whose trial labels name no trial in common
#   (gold_trial_names_related(): RAINBOW is not REVEL, KEYNOTE-189 not
#   KEYNOTE-407, MARIPOSA not MARIPOSA-2) never pair;
# - indication: the extractor's, for the gold's condition (NSCLC): a row whose
#   indication names another condition, and not NSCLC, is not scored
#   (gold_condition);
# - value, ci_low, ci_high are compared as printed (spaces and a percent sign
#   aside);
# - effect_type: gold "HR non-inferiority" = extractor hr_noninferiority,
#   "rate (single arm)" = single_arm_rate, "median (single arm)" =
#   single_arm_median, "rate difference ..." = rate_difference;
# - analysis role: the extractor's analysis_role; the gold rows have none, so
#   it is read from the start of their `analysis` text ("primary ...",
#   "pre-specified ..." = primary, "exploratory ...", "updated ..." = later,
#   "interim ..." of a primary endpoint = primary) and is unknown otherwise;
#   rows of two analyses (known roles that differ, or analysis texts dated
#   with no date in common) pair only when they print the same numbers, so a
#   true row of another analysis is an extra row, not a numeric error;
# - labels of the row (gold analysis of 2026-10-02): rows of another
#   assessment (investigator or independent, gold_assessment_class()), of a
#   sensitivity or subgroup analysis the other is not (gold_analysis_kind())
#   or of another population (the whole trial or a subgroup,
#   gold_population_class()) pair only when they print the same numbers too;
#   an extra row beside a missed gold row of its trial and endpoint is listed
#   for a check (near_missed_keys);
# - population: the extractor's population_match (its class, above), and in
#   the key shown for missed and extra rows;
# - ci_is_range: the extractor's; the gold rows state it in their arm_measure
#   ("median months (range)") or notes.
# Only the gold rows whose source_doc is "SmPC" are scored.

gold_smpc_sources <- c("", "SmPC")

# Price per million input and output tokens (list price; batches pay half).
gold_prices <- list(
  "claude-sonnet-5-5" = c(input = 2, output = 10),
  "claude-opus-5-5" = c(input = 4, output = 20)
)
gold_batch_factor <- 0.5

# Also as the SmPCs print them, which the verbatim prompt has the model copy
# (gold analysis of 2026-10-02: LIBRETTO-001's "Objective response" and
# Alimta's "Survival Time" were kept with the gold's numbers, never paired).
gold_endpoint_names <- c(
  "progression free survival" = "PFS",
  "overall survival" = "OS",
  "survival time" = "OS",
  "disease free survival" = "DFS",
  "event free survival" = "EFS",
  "objective response rate" = "ORR",
  "objective response" = "ORR",
  "overall response rate" = "ORR",
  "overall response" = "ORR",
  "duration of response" = "DOR",
  "duration of objective response" = "DOR",
  "duration of overall response" = "DOR",
  "pathological complete response" = "PCR",
  "pathologic complete response" = "PCR",
  "major pathological response" = "MPR",
  "major pathologic response" = "MPR"
)
gold_known_endpoints <- unique(unname(gold_endpoint_names))

# The gold's condition (`own`) and the other conditions the pilot's 18
# medicines are authorised for (`others`), as regular expressions. The gold
# rows are NSCLC rows, while the extractor answers for every indication of a
# medicine: a row whose indication names another condition, and not NSCLC, is
# outside the gold set (Retsevmo's thyroid-cancer LIBRETTO-001 response rate,
# Cyramza's gastric-cancer RAINBOW). A row whose indication names no
# condition is scored, so an NSCLC row whose indication lost its condition
# still counts. "small cell lung" is SCLC only: an indication naming NSCLC is
# scored whatever else it names. EMA's text has "?" for some hyphens
# ("non?small cell"). Some indications name the condition by abbreviation
# only (gold analysis of 2026-10-02: Tecentriq's "TNBC", Tevimbra's "OSCC"
# and "NPC").
gold_condition <- list(
  own = "non.?small.?cell.?lung|\\bnsclc\\b",
  others = paste(
    c(
      "melanoma", "renal.?cell", "urothelial", "bladder", "head.?and.?neck",
      "hodgkin", "lymphoma", "colorectal", "\\bm?crc\\b", "gastric",
      "o?esophag", "\\b[oe]scc\\b", "hepatocellular", "\\bhcc\\b", "biliary",
      "cholangio", "thyroid", "breast", "\\btnbc\\b", "cervical", "endometri",
      "ovarian", "mesothelioma", "nasopharyn", "\\bnpc\\b", "cutaneous",
      "cscc", "basal.?cell", "\\b(la|m)?bcc\\b", "merkel", "small.?cell.?lung",
      "\\bsclc\\b", "solid.?tumou?r", "msi.?h", "mismatch.?repair"
    ),
    collapse = "|"
  )
)

# Whether each indication is outside the gold's condition (`condition`, as
# gold_condition; NULL: none is).
gold_outside_condition <- function(indications, condition) {
  if (is.null(condition)) {
    return(rep(FALSE, length(indications)))
  }
  naming <- function(pattern) {
    grepl(pattern, indications, ignore.case = TRUE, perl = TRUE)
  }
  !naming(condition$own) & naming(condition$others)
}

gold_generic_trial_words <- c("study", "phase", "trial")

# NULL, NA and "" are all "".
gold_text <- function(value) {
  if (length(value) == 0 || is.na(value[[1]])) {
    return("")
  }
  trimws(as.character(value[[1]]))
}

# A number as printed: what sits around it (spaces, a percent sign) aside.
gold_number <- function(value) {
  gsub("[[:space:]% ]", "", gold_text(value))
}

gold_logical <- function(value) {
  if (length(value) == 0 || is.na(value[[1]])) {
    return(NA)
  }
  as.logical(value[[1]])
}

# The registry number in parentheses goes; the first word stays, with the
# numbers that follow it: "KEYNOTE 024" and "KEYNOTE-024" are "keynote-024",
# "CodeBreaK 100 phase 2 part A" is "codebreak-100", "BGB-A317-304" stays whole.
gold_trial_key <- function(trial) {
  text <- gsub("\\([^)]*\\)", " ", gold_text(trial))
  text <- gsub("^-|-$", "", gsub("[^a-z0-9]+", "-", tolower(text)))
  tokens <- strsplit(text, "-", fixed = TRUE)[[1]]
  if (length(tokens) == 0) {
    return("")
  }
  keep <- 1L
  while (keep < length(tokens) &&
           grepl("^[a-z]?[0-9]+$", tokens[keep + 1L])) {
    keep <- keep + 1L
  }
  paste(tokens[seq_len(keep)], collapse = "-")
}

# The trial names of a label, each as its words: lower-case, letters and
# digits apart, leading zeros dropped ("KEYNOTE-024" and "KEYNOTE 24" are
# "keynote 24", "IMpower110" is "impower 110"). A name is a run of words, kept
# together by spaces, hyphens or underscores, that name a trial: a word with a
# digit or with two capitals or more ("RAINBOW", "IMpower110", "CodeBreaK",
# "B7461006"), and a word hyphenated to one ("DESTINY-Lung02", "GEOMETRY
# mono-1"); never a phase ("phase 3", "Phase III") nor a generic word. Any
# other character ends a name, brackets too: "ALEX (BO28984)" names "alex"
# and "bo 28984". A description such as "pembrolizumab adjuvant study" names
# none.
gold_trial_names <- function(trial) {
  text <- gsub(
    "\\bphase[ -]*([0-9]+[a-z]?|[ivx]+)(/([0-9]+|[ivx]+))*\\b", " ",
    gold_text(trial),
    ignore.case = TRUE, perl = TRUE
  )
  segments <- strsplit(text, "[^A-Za-z0-9 _-]+")[[1]]
  unique(unlist(purrr::map(segments, gold_segment_trial_names)))
}

# The trial names of a stretch of a label without brackets or punctuation.
gold_segment_trial_names <- function(segment) {
  word_pattern <- gregexpr("[A-Za-z0-9]+", segment)
  words <- regmatches(segment, word_pattern)[[1]]
  if (length(words) == 0) {
    return(character())
  }
  separators <- regmatches(segment, word_pattern, invert = TRUE)[[1]]
  # A hyphen or underscore before a word joins it to the word before.
  joined <- c(FALSE, grepl("[-_]", separators[seq_along(words)][-1]))
  generic <- tolower(words) %in% gold_generic_trial_words
  named <- (grepl("[0-9]", words) | grepl("[A-Z].*[A-Z]", words)) & !generic
  joined_to_named <- (joined & c(FALSE, named[-length(words)])) |
    (c(joined[-1], FALSE) & c(named[-1], FALSE))
  kept <- !generic & (named | joined_to_named)
  pieces <- purrr::map(tolower(words[kept]), function(word) {
    parts <- regmatches(word, gregexpr("[a-z]+|[0-9]+", word))[[1]]
    sub("^0+(?=[0-9])", "", parts, perl = TRUE)
  })
  runs <- split(pieces, cumsum(!kept)[kept])
  unname(purrr::map_chr(runs, \(run) paste(unlist(run), collapse = " ")))
}

# Whether two trial names can be one trial: the same words, or one the other
# with words after it that hold no number ("IMpower110 ITT" is IMpower110);
# never with a number after it ("MARIPOSA" is not "MARIPOSA-2", nor
# "DESTINY" "DESTINY-Lung02").
gold_same_trial_name <- function(first, second) {
  first <- strsplit(first, " ", fixed = TRUE)[[1]]
  second <- strsplit(second, " ", fixed = TRUE)[[1]]
  if (length(first) > length(second)) {
    longer <- first
    first <- second
    second <- longer
  }
  shared <- seq_along(first)
  identical(second[shared], first) &&
    !any(grepl("^[0-9]+$", second[-shared]))
}

# Whether two labels name a trial in common (gold_same_trial_name()), so a
# number in brackets only links two labels, never separates them ("ALINA
# (BO40336)" is "ALINA (NCT03456076)" and "BO40336; ALINA").
gold_trial_names_shared <- function(first, second) {
  any(purrr::map_lgl(first, function(name) {
    any(purrr::map_lgl(second, \(other) gold_same_trial_name(name, other)))
  }))
}

# Whether two labels can name the same trial (gold_trial_names() of each): a
# name in common, or a label naming no trial, which can be any.
gold_trial_names_related <- function(first, second) {
  length(first) == 0 || length(second) == 0 ||
    gold_trial_names_shared(first, second)
}

# A known endpoint named outside the parentheses wins: the whole name
# ("Duration of response (months)" is DOR, not "MONTHS"), else the one known
# endpoint the words outside name (gold_endpoint_mentions(): "Overall
# survival by tumour PD-L1 Tumour Cell (TC) expression status" is OS, not
# "TC"); else an abbreviation in parentheses after a longer name ("Time to
# CNS progression (TTP)"); other parentheses are dropped ("OS (final
# analysis)").
gold_endpoint <- function(endpoint) {
  text <- tolower(gold_text(endpoint))
  outside <- trimws(gsub("\\([^)]*\\)", "", text))
  name <- gsub("-", " ", outside, fixed = TRUE)
  if (!is.na(gold_endpoint_names[name])) {
    return(unname(gold_endpoint_names[name]))
  }
  named <- gold_endpoint_mentions(outside)
  if (length(named) == 1) {
    return(named)
  }
  abbreviation <- regmatches(
    text, regexpr("(?<=\\()[a-z]{2,6}(?=\\))", text, perl = TRUE)
  )
  if (length(abbreviation) == 1 && grepl("^[^(]{8,}\\(", text)) {
    return(toupper(abbreviation))
  }
  toupper(name)
}

# Phrases (regular expressions over a label's lower-case words) that make a
# named endpoint another one: progression or response in the CNS ("CNS
# progression-free survival", "Time to intracranial progression"), a second
# progression ("Second PFS", "PFS2"), a subsequent therapy ("PFS after first
# subsequent therapy") and a time to an event ("Time to objective response"
# is not ORR; review of the gold analysis's fixes, 2026-10-02). A qualifier of
# the analysis or the population does not ("PFS at second interim analysis",
# "PFS in patients with baseline CNS metastases").
gold_endpoint_qualifiers <- c(
  paste0(
    "(cns|intracranial) (progression|response|objective|overall|duration|",
    "recurrence|pfs|orr|dor|dfs|efs)"
  ),
  "second (progression|pfs)",
  "pfs ?2",
  "subsequent (therapy|treatment|anticancer|line)",
  "time to"
)

# The known endpoints a label names as words, by name or abbreviation
# ("Confirmed objective response rate" and "Confirmed ORR, laBCC" name ORR).
# A label with a qualifier names none ("CNS progression-free survival",
# "Second PFS after start of first subsequent therapy"), nor does one of an
# endpoint the scorer does not know ("Time to worsening of patient-reported
# NSCLC symptoms"). Where two names share words, the one starting first is
# read, the longer one at the same word ("Duration of objective response" is
# DOR, not ORR; "Progression-free survival time" is PFS, not the "survival
# time" of OS: review of the gold analysis's fixes, 2026-10-02).
gold_endpoint_mentions <- function(endpoint) {
  text <- gsub("[^a-z0-9]+", " ", tolower(gold_text(endpoint)))
  words <- paste0(" ", text, " ")
  has <- function(phrase) grepl(paste0(" ", phrase, " "), words, fixed = TRUE)
  qualified <- purrr::map_lgl(gold_endpoint_qualifiers, function(phrase) {
    grepl(paste0(" ", phrase, " "), words, perl = TRUE)
  })
  if (any(qualified)) {
    return(character())
  }
  spans <- gold_name_spans(
    names(gold_endpoint_names), strsplit(trimws(text), " ", fixed = TRUE)[[1]]
  )
  overlapped <- purrr::map_lgl(seq_len(nrow(spans)), function(index) {
    first <- spans$first[index]
    last <- spans$last[index]
    any(spans$first <= last & spans$last >= first &
          (spans$first < first | (spans$first == first & spans$last > last)))
  })
  by_abbreviation <- purrr::map_lgl(tolower(gold_known_endpoints), has)
  unique(c(
    unname(gold_endpoint_names[spans$name[!overlapped]]),
    gold_known_endpoints[by_abbreviation]
  ))
}

# Where each name (its words one space apart) stands among `words`: a row per
# place, with the name and its first and last word, in the names' order.
gold_name_spans <- function(names, words) {
  purrr::map(names, function(name) {
    parts <- strsplit(name, " ", fixed = TRUE)[[1]]
    size <- length(parts)
    starts <- seq_len(max(0L, length(words) - size + 1L))
    starts <- starts[purrr::map_lgl(starts, function(start) {
      identical(words[seq(start, start + size - 1L)], parts)
    })]
    dplyr::tibble(
      name = rep(name, length(starts)), first = starts,
      last = starts + size - 1L
    )
  }) |>
    purrr::list_rbind()
}

gold_effect_type <- function(effect_type) {
  words <- tolower(gsub("[ _-]+", " ", gold_text(effect_type)))
  if (words == "hr") {
    "hr"
  } else if (words %in% c("hr non inferiority", "hr noninferiority")) {
    "hr_noninferiority"
  } else if (startsWith(words, "rate difference")) {
    "rate_difference"
  } else if (words %in% c("rate (single arm)", "single arm rate")) {
    "single_arm_rate"
  } else if (words %in% c("median (single arm)", "single arm median")) {
    "single_arm_median"
  } else {
    NA_character_
  }
}

gold_analysis_roles <- c("primary", "later", "exploratory")

gold_role <- function(row) {
  role <- gold_text(row$analysis_role)
  if (role %in% gold_analysis_roles) {
    return(role)
  }
  analysis <- tolower(gold_text(row$analysis))
  primary_endpoint <- isTRUE(gold_logical(row$is_primary))
  if (grepl("^(primary|pre-specified)", analysis)) {
    "primary"
  } else if (startsWith(analysis, "exploratory")) {
    "exploratory"
  } else if (grepl("^(updated|later)", analysis)) {
    "later"
  } else if (startsWith(analysis, "interim") && primary_endpoint) {
    "primary"
  } else {
    NA_character_
  }
}

# Whether the bracketed numbers are a range, not a CI: as the extractor says
# it, else as the gold rows do in their arm_measure or notes.
gold_ci_is_range <- function(row) {
  stated <- gold_logical(row$ci_is_range)
  if (!is.na(stated)) {
    return(stated)
  }
  grepl("(range)", tolower(gold_text(row$arm_measure)), fixed = TRUE) ||
    grepl("range, not a ci", tolower(gold_text(row$notes)), fixed = TRUE)
}

# The assessment a label names: "investigator" (investigator-assessed, INV),
# "independent" (a blinded or independent central review: BICR, IRC, ICR,
# BIRC, BIPR, IRF), else NA (gold_different_analyses(): AURA3's BICR
# sensitivity analysis is not its investigator-assessed primary analysis).
gold_assessment_class <- function(text) {
  text <- tolower(gold_text(text))
  independent <- paste0(
    "\\b(bicr|irc|icr|birc|bipr|irf)\\b|independent|central|blinded"
  )
  if (grepl("investigator|\\binv\\b", text, perl = TRUE)) {
    "investigator"
  } else if (grepl(independent, text, perl = TRUE)) {
    "independent"
  } else {
    NA_character_
  }
}

# A sensitivity or subgroup analysis an analysis text names, else NA.
gold_analysis_kind <- function(text) {
  text <- tolower(gold_text(text))
  if (grepl("sensitivity", text, fixed = TRUE)) {
    "sensitivity"
  } else if (grepl("subgroup", text, fixed = TRUE)) {
    "subgroup"
  } else {
    NA_character_
  }
}

# How a population text starts when it is the whole trial's (or a whole
# cohort's), and the words that name a part of one (a stage, a PD-L1 or TPS
# level, a prior treatment, "patients who ...").
gold_whole_population <- paste0(
  "^(itt|mitt|all randomi[sz]ed|overall|efficacy|independently reviewed|",
  "primary analysis population|responders|cohort)"
)
gold_subgroup_population <- paste0(
  "subgroup|\\bstage\\b|pd.?l1|\\btps\\b|>=|≥|patients who|\\bprior\\b"
)

# Whether a row's population is the whole trial's ("whole") or a subgroup's
# ("subgroup"), else NA (gold_different_analyses(): ADAURA's stage IB-IIIA row
# is not the gold's stage II-IIIA row). The extractor's population_match says
# so (subgroup_matches and other: a subgroup); the gold rows state none, so
# their population text is read: the whole trial's as it starts, a subgroup's
# as it names one, else unknown ("BICR-measurable population", "T+PC arm vs
# PC arm"), which pairs as before.
gold_population_class <- function(row) {
  match <- gold_text(row$population_match)
  if (match %in% c("subgroup_matches", "other")) {
    return("subgroup")
  }
  if (match %in% c("whole_trial_matches", "whole_trial_broader")) {
    return("whole")
  }
  if (match == "not_stated") {
    return(NA_character_)
  }
  text <- tolower(gold_text(row$population))
  if (grepl(gold_whole_population, text, perl = TRUE)) {
    "whole"
  } else if (grepl(gold_subgroup_population, text, perl = TRUE)) {
    "subgroup"
  } else {
    NA_character_
  }
}

# The number an arm value starts with ("NE [17.7; NE]" is NE, "11.1 [9.1;
# 13.1]" 11.1), "" when it starts with none.
gold_leading_number <- function(text) {
  text <- trimws(gold_text(text))
  found <- regmatches(
    text, regexpr("^(NR|NE|NC|NA|[0-9]+(\\.[0-9]+)?)", text, perl = TRUE)
  )
  if (length(found) == 0) "" else found
}

gold_first_word <- function(text) {
  sub("^([^[:space:]]*).*$", "\\1", tolower(gold_text(text)))
}

# The key of a row as the scoring names it (medicine, trial, endpoint, analysis
# role or the first word of the analysis text, population); shown for missed
# and extra rows. Matching itself pairs rows within (medicine, trial,
# endpoint) by value, then role, so a wrong value is one numeric error, not a
# missed row and an extra one.
gold_row_key <- function(row) {
  role <- gold_role(row)
  population <- gold_text(row$population_match)
  paste(
    tolower(gold_text(row$medicine)),
    gold_trial_key(row$trial),
    gold_endpoint(row$endpoint),
    if (is.na(role)) gold_first_word(row$analysis) else role,
    if (nzchar(population) && population != "not_stated") {
      population
    } else {
      gold_first_word(row$population)
    },
    sep = "|"
  )
}

gold_row_table <- function(rows) {
  rows <- Filter(
    function(row) gold_text(row$source_doc) %in% gold_smpc_sources,
    rows
  )
  text_column <- function(field) {
    purrr::map_chr(rows, \(row) gold_text(row[[field]]))
  }
  arm_column <- function(field) {
    purrr::map_chr(
      rows, \(row) gsub("[[:space:]]+", " ", gold_text(row[[field]]))
    )
  }
  table <- dplyr::tibble(
    medicine = tolower(text_column("medicine")),
    trial_text = text_column("trial"),
    trial = purrr::map_chr(rows, \(row) gold_trial_key(row$trial)),
    trial_names = purrr::map(rows, \(row) gold_trial_names(row$trial)),
    endpoint = purrr::map_chr(rows, \(row) gold_endpoint(row$endpoint)),
    endpoint_mentions = purrr::map(
      rows, \(row) gold_endpoint_mentions(row$endpoint)
    ),
    role = purrr::map_chr(rows, gold_role),
    analysis_dates = purrr::map(rows, \(row) gold_analysis_dates(row$analysis)),
    analysis_kind = purrr::map_chr(
      rows, \(row) gold_analysis_kind(row$analysis)
    ),
    assessment_class = purrr::map_chr(
      rows, \(row) gold_assessment_class(row$assessment)
    ),
    population_class = purrr::map_chr(rows, gold_population_class),
    population_match = dplyr::na_if(text_column("population_match"), ""),
    effect_type = purrr::map_chr(
      rows, \(row) gold_effect_type(row$effect_type)
    ),
    is_primary = purrr::map_lgl(rows, \(row) gold_logical(row$is_primary)),
    indication = purrr::map_chr(rows, function(row) {
      dplyr::coalesce(
        dplyr::na_if(gold_text(row$indication), ""), gold_text(row$setting)
      )
    }),
    stated_indication = text_column("indication"),
    value = purrr::map_chr(rows, \(row) gold_number(row$value)),
    ci_low = purrr::map_chr(rows, \(row) gold_number(row$ci_low)),
    ci_high = purrr::map_chr(rows, \(row) gold_number(row$ci_high)),
    arm_treatment = arm_column("arm_treatment"),
    arm_control = arm_column("arm_control"),
    significance = tolower(text_column("significance_stated")),
    ci_is_range = purrr::map_lgl(rows, gold_ci_is_range),
    # A kept row a human must check before the site shows it (gold rows have
    # no flags).
    flagged = purrr::map_lgl(rows, \(row) length(unlist(row$flags)) > 0),
    key = purrr::map_chr(rows, gold_row_key)
  )
  table$group <- paste(table$medicine, table$trial, table$endpoint, sep = "|")
  table$order <- stats::ave(
    seq_len(nrow(table)), table$medicine, FUN = seq_along
  )
  table
}

same_known <- function(first, second) {
  !is.na(first) & !is.na(second) & first == second
}

# The confidence interval is not compared where the gold has none and the
# extracted row says its bracketed numbers are a range (the prompt puts them
# in ci_low and ci_high): the value still is.
gold_ci_skipped <- function(is_range, gold_low, gold_high) {
  !nzchar(gold_low) & !nzchar(gold_high) & is_range %in% TRUE
}

# Whether extracted rows `e` print the confidence interval of gold rows `g`
# (not compared where gold_ci_skipped()).
gold_same_interval <- function(extracted, gold, e, g) {
  gold_ci_skipped(extracted$ci_is_range[e], gold$ci_low[g], gold$ci_high[g]) |
    (extracted$ci_low[e] == gold$ci_low[g] &
       extracted$ci_high[e] == gold$ci_high[g])
}

# Whether extracted rows `e` print the numbers of gold rows `g`: the value and
# the interval.
gold_same_numbers <- function(extracted, gold, e, g) {
  extracted$value[e] == gold$value[g] &
    gold_same_interval(extracted, gold, e, g)
}

# How well an extracted row fits a gold row: the trial and endpoint above all
# (constant within a group), then the value, the confidence interval, the
# analysis role and the effect type.
gold_pair_scores <- function(extracted, gold, pairs) {
  e <- pairs$extracted
  g <- pairs$gold
  32 * (extracted$trial[e] == gold$trial[g]) +
    16 * (extracted$endpoint[e] == gold$endpoint[g]) +
    8 * (extracted$value[e] == gold$value[g]) +
    4 * gold_same_interval(extracted, gold, e, g) +
    2 * same_known(extracted$role[e], gold$role[g]) +
    same_known(extracted$effect_type[e], gold$effect_type[g])
}

gold_month_numbers <- c(
  jan = 1, feb = 2, mar = 3, apr = 4, may = 5, jun = 6, jul = 7, aug = 8,
  sep = 9, oct = 10, nov = 11, dec = 12
)

# The dates an analysis text states (a data cut-off: "30-Sep-2020",
# "01 May 2023", "Jun 14, 2021"), as ISO dates.
gold_analysis_dates <- function(text) {
  text <- tolower(gold_text(text))
  month <- "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?"
  patterns <- c(
    day_first = paste0("\\b([0-9]{1,2})[ -]+", month, "[ ,-]+([0-9]{4})\\b"),
    month_first = paste0("\\b", month, "[ -]+([0-9]{1,2}),?[ -]+([0-9]{4})\\b")
  )
  dates <- purrr::imap(patterns, function(pattern, order) {
    found <- regmatches(text, gregexpr(pattern, text, perl = TRUE))[[1]]
    purrr::map_chr(found, function(date) {
      parts <- regmatches(date, regexec(pattern, date, perl = TRUE))[[1]]
      day <- if (order == "day_first") parts[2] else parts[3]
      name <- if (order == "day_first") parts[3] else parts[2]
      sprintf(
        "%s-%02d-%02d", parts[4], gold_month_numbers[[name]], as.integer(day)
      )
    })
  })
  unique(unlist(dates, use.names = FALSE)) %||% character()
}

# Whether extracted rows `e` and gold rows `g` state different analyses of
# their trial: both analysis roles known and different (an exploratory
# analysis with longer follow-up is not the primary analysis), or both
# analysis texts dated with no date in common (the interim analysis of
# 06-Dec-2019 is not the final one of 30-Sep-2020). Or, by their labels (gold
# analysis of 2026-10-02), different rows of the trial: a sensitivity or
# subgroup analysis the other is not (gold_analysis_kind()), or both
# assessments or both populations known and different
# (gold_assessment_class(), gold_population_class()).
gold_different_analyses <- function(extracted, gold, e, g) {
  known_and_different <- function(column) {
    first <- extracted[[column]][e]
    second <- gold[[column]][g]
    !is.na(first) & !is.na(second) & first != second
  }
  dates <- purrr::map2_lgl(
    extracted$analysis_dates[e], gold$analysis_dates[g],
    function(first, second) {
      length(first) > 0 && length(second) > 0 &&
        length(intersect(first, second)) == 0
    }
  )
  kinds <- dplyr::coalesce(extracted$analysis_kind[e], "") !=
    dplyr::coalesce(gold$analysis_kind[g], "")
  known_and_different("role") | dates | kinds |
    known_and_different("assessment_class") |
    known_and_different("population_class")
}

# Which pairs may pair at all: only rows whose trial labels can name the same
# trial (gold_trial_names_related()), even where they fold to one key
# (DESTINY-Lung01 is not DESTINY-Lung02), and that state the same analysis
# unless they print the same numbers (gold_different_analyses(): a true row of
# another analysis is an extra row, never a numeric error of the gold's). With
# `linked` (rows of a medicine left over from their own group, so a label the
# model spelled differently cannot hide a wrong number) also only the same
# endpoint, or the same trial key where one label names the other's endpoint
# (gold_endpoint_mentions(): "Confirmed objective response rate" is ORR; OS
# or "time to worsening of symptoms" is never PFS).
gold_pairable <- function(extracted, gold, pairs, linked) {
  e <- pairs$extracted
  g <- pairs$gold
  related <- purrr::map2_lgl(
    extracted$trial_names[e], gold$trial_names[g], gold_trial_names_related
  ) & (!gold_different_analyses(extracted, gold, e, g) |
         gold_same_numbers(extracted, gold, e, g))
  if (!linked) {
    return(related)
  }
  names_endpoint <- function(mentions, endpoints) {
    purrr::map2_lgl(mentions, endpoints, \(names, endpoint) endpoint %in% names)
  }
  same_endpoint <- extracted$endpoint[e] == gold$endpoint[g]
  one_names_other <-
    names_endpoint(extracted$endpoint_mentions[e], gold$endpoint[g]) |
    names_endpoint(gold$endpoint_mentions[g], extracted$endpoint[e])
  related & (same_endpoint |
               (extracted$trial[e] == gold$trial[g] & one_names_other))
}

# Greedy best pairs: the highest score first, then the order in the extracted
# rows, then in the gold rows, among the pairs gold_pairable() allows. Returns
# the gold row of each extracted row (NA when none is left for it).
match_group_rows <- function(extracted,
                             gold,
                             extracted_rows,
                             gold_rows,
                             linked = FALSE) {
  pairs <- expand.grid(
    extracted = extracted_rows, gold = gold_rows, KEEP.OUT.ATTRS = FALSE
  )
  pairs <- pairs[gold_pairable(extracted, gold, pairs, linked), ]
  pairs$score <- gold_pair_scores(extracted, gold, pairs)
  pairs <- pairs[order(-pairs$score, pairs$extracted, pairs$gold), ]
  matched <- stats::setNames(rep(NA_integer_, length(extracted_rows)),
                             extracted_rows)
  taken <- integer()
  for (index in seq_len(nrow(pairs))) {
    e <- as.character(pairs$extracted[index])
    g <- pairs$gold[index]
    if (is.na(matched[[e]]) && !g %in% taken) {
      matched[[e]] <- g
      taken <- c(taken, g)
    }
  }
  unname(matched)
}

# For each extracted row the gold row it stands for, or NA. First within
# (medicine, trial key, endpoint); then the rows still unpaired of a medicine
# pair across those (gold_pairable()), so a label the model spelled
# differently cannot hide a wrong number as a missed row plus an extra one.
# Both passes pair only rows whose trial labels can name the same trial.
match_gold_rows <- function(extracted, gold) {
  matched <- rep(NA_integer_, nrow(extracted))
  for (group in intersect(extracted$group, gold$group)) {
    extracted_rows <- which(extracted$group == group)
    matched[extracted_rows] <- match_group_rows(
      extracted, gold, extracted_rows, which(gold$group == group)
    )
  }
  for (medicine in intersect(extracted$medicine, gold$medicine)) {
    extracted_rows <- which(is.na(matched) & extracted$medicine == medicine)
    gold_rows <- setdiff(which(gold$medicine == medicine), matched)
    if (length(extracted_rows) > 0 && length(gold_rows) > 0) {
      matched[extracted_rows] <- match_group_rows(
        extracted, gold, extracted_rows, gold_rows, linked = TRUE
      )
    }
  }
  matched
}

# Whether each row of a table is its (medicine, indication)'s lead row
# (choose_lead_rows()): by default every row shown and the population match
# not ranked; with `production`, ranked as the site file ranks it; with
# `shown_only`, only rows without flags lead, as the site shows only those.
gold_lead_flags <- function(table, production = FALSE, shown_only = FALSE) {
  if (nrow(table) == 0) {
    return(logical())
  }
  rows <- nrow(table)
  choose_lead_rows(dplyr::tibble(
    ema_product_number = table$medicine,
    row_key = as.character(seq_len(rows)),
    row_order = table$order,
    indication = table$indication,
    trial = table$trial_text,
    is_primary = table$is_primary,
    analysis_role = table$role,
    population_match = if (production) {
      table$population_match
    } else {
      rep(NA_character_, rows)
    },
    review = if (shown_only) {
      dplyr::if_else(table$flagged, "flagged", "auto_ok")
    } else {
      rep("auto_ok", rows)
    }
  ))$lead
}

# The share of the gold's lead rows (one per medicine and setting) whose
# matched extracted row is a lead row of the extraction as well. A gold lead
# nothing matches is a disagreement, so dropping a medicine or a setting costs.
# `production` and `shown_only` choose the extraction's leads as
# gold_lead_flags() says (reported beside the rule's measure, gold analysis of
# 2026-10-02).
gold_lead_agreement <- function(extracted,
                                gold,
                                matched,
                                production = FALSE,
                                shown_only = FALSE) {
  gold_leads <- which(gold_lead_flags(gold))
  extracted_leads <- gold_lead_flags(extracted, production, shown_only)
  if (length(gold_leads) == 0) {
    return(0)
  }
  agrees <- purrr::map_lgl(gold_leads, function(lead) {
    found <- which(matched == lead)
    length(found) == 1 && extracted_leads[found]
  })
  mean(agrees)
}

# "not statistically significant", "non-significant" and "no significant ..."
# deny significance, as do "statistical significance was not reached" and "did
# not achieve significance"; "significance level" and "significance threshold"
# name the test's bar and claim nothing; any other "significan..." claims it.
claims_significance <- function(text) {
  text <- tolower(text)
  text <- gsub("significance[ -]+(level|threshold)", " ", text)
  text <- gsub(
    "(not|no|non|without)[ -]+(statistically[ -]+)?significan[a-z]*",
    " ", text
  )
  text <- gsub(
    "significan[a-z]*[ ,]+(was |were |is |are )?not[ ]+(reached|achieved|met)",
    " ", text
  )
  text <- gsub(
    paste0(
      "(did not|failed to|unable to)[ ]+(reach|achieve|meet)[a-z ]*",
      "significan[a-z]*"
    ),
    " ", text
  )
  grepl("significan", text)
}

# Each of the pilot's four pitfalls: TRUE when the extraction avoids it, NA
# when it could not be tested. The MARIPOSA-2 one needs an OS row to test:
# without one it passes only where the gold has none either (as the pilot's),
# and says so in `notes`. The ALEX one tests the ALEX rows found with arm
# values (the verifier blanks arms it cannot verify, and rejects a row whose
# comparator label sits with the treatment arm): each must have the gold's
# arms in the gold's order, compared by the number each starts with
# (gold_leading_number(): the gold prints "NE [17.7; NE]", a model "NE"), and
# `notes` says when they are swapped. Without such a row it is not testable
# (NA), and `notes` says why: a row without arms is not a swap.
gold_pitfalls <- function(extracted, gold, matched) {
  alex <- which(gold$trial == "alex")
  alex_found <- which(matched %in% alex)
  has_arms <- nzchar(extracted$arm_treatment[alex_found]) |
    nzchar(extracted$arm_control[alex_found])
  alex_with_arms <- alex_found[has_arms]
  alex_without_arms <- alex_found[!has_arms]
  arms_of <- function(table, index) {
    c(
      gold_leading_number(table$arm_treatment[index]),
      gold_leading_number(table$arm_control[index])
    )
  }
  alex_orders <- purrr::map_chr(alex_with_arms, function(found) {
    given <- arms_of(extracted, found)
    expected <- arms_of(gold, matched[found])
    if (identical(given, expected)) {
      "gold"
    } else if (identical(given, rev(expected))) {
      "swapped"
    } else {
      "other"
    }
  })
  alex_ok <- if (length(alex_with_arms) == 0) NA else all(alex_orders == "gold")
  impower110 <- any(
    extracted$medicine == "tecentriq" & extracted$trial == "impower110" &
      extracted$endpoint == "OS" & extracted$value == "0.59" &
      extracted$role %in% "primary"
  )
  mariposa2_os <- function(table) {
    table$medicine == "rybrevant" & table$trial == "mariposa-2" &
      table$endpoint == "OS"
  }
  mariposa2 <- mariposa2_os(extracted)
  note <- if (length(alex_found) == 0) {
    paste(
      "alex_column_order: not testable, no ALEX row was extracted",
      if (length(alex) > 0) "(the gold expects one)" else "(the gold has none)"
    )
  } else if (length(alex_without_arms) > 0) {
    sprintf(
      paste(
        "alex_column_order: %d of the %d ALEX rows found have no arm values",
        "(none extracted or none verified), so their column order could not",
        "be tested%s"
      ),
      length(alex_without_arms), length(alex_found),
      if (is.na(alex_ok)) "; not testable" else ""
    )
  } else {
    character()
  }
  if (any(alex_orders == "swapped")) {
    note <- c(note, sprintf(
      "alex_column_order: %d ALEX row(s) with the arms swapped",
      sum(alex_orders == "swapped")
    ))
  }
  if (any(alex_orders == "other")) {
    note <- c(note, sprintf(
      "alex_column_order: %d ALEX row(s) with other arm values than the gold's",
      sum(alex_orders == "other")
    ))
  }
  mariposa2_ok <- if (any(mariposa2)) {
    !any(claims_significance(extracted$significance[mariposa2]))
  } else {
    note <- c(note, paste(
      "mariposa2_significance: no MARIPOSA-2 OS row was extracted, so its",
      "significance statement could not be tested",
      if (any(mariposa2_os(gold))) "(the gold expects the row)" else
        "(the gold has none either)"
    ))
    !any(mariposa2_os(gold))
  }
  lumykras <- extracted$medicine == "lumykras" & extracted$endpoint == "DOR"
  list(
    pitfalls = c(
      alex_column_order = alex_ok,
      impower110_primary = impower110,
      mariposa2_significance = mariposa2_ok,
      lumykras_range =
        any(lumykras) && all(extracted$ci_is_range[lumykras] %in% TRUE)
    ),
    notes = note
  )
}

# Scores the extracted rows against the gold rows (both lists of rows, see the
# top of the file). Numeric errors: a matched row whose value, ci_low or
# ci_high differ from the gold's as printed, once per row. A right value with a
# wrong CI is an error too (the verifier cannot tell which number is wrong); a
# range the gold gives no CI for is not compared. With `condition` (as
# gold_condition, for the pilot's gold), a row whose indication names another
# condition and not the gold's is outside the gold set: never paired, nor
# looked at by the pitfalls or the lead agreement, counted in outside_rows,
# not as extra; a row whose indication names no condition is scored. Those of
# them that name a trial of the gold rows of their medicine are listed in
# outside_gold_trial_keys, as their indication alone kept them out (a basket
# trial such as LIBRETTO-001, or an NSCLC row given another indication). A
# flagged row is scored as any other, but the site hides it until reviewed:
# flagged_rows counts the scored ones, flagged_found_rows the gold rows found
# only by one (matching pairs one row with one gold row). Lead agreement is
# measured by the acceptance rule's measure (lead_agreement) and, reported
# only, by production's rule (lead_agreement_production) and over the rows the
# site would show (lead_agreement_shown, gold_lead_flags()). An extra row
# beside a missed gold row of its trial and endpoint (near_missed_keys, the
# rows counted in near_missed_rows) may be that row with a wrong number its
# labels kept apart (gold_different_analyses(); the labels are the model's
# own, nothing verifies them), so it is listed for a check and counts
# against acceptance until checked (gold_acceptance_problems()).
score_against_gold <- function(extracted, gold, condition = NULL) {
  extracted <- gold_row_table(extracted)
  gold <- gold_row_table(gold)
  outside <- gold_outside_condition(extracted$stated_indication, condition)
  others <- extracted[outside, ]
  extracted <- extracted[!outside, ]
  matched <- match_gold_rows(extracted, gold)
  extra <- is.na(matched)
  paired <- which(!extra)
  partner <- matched[paired]
  missed <- setdiff(seq_len(nrow(gold)), matched)
  wrong <- !gold_same_numbers(extracted, gold, paired, partner)
  pitfalls <- gold_pitfalls(extracted, gold, matched)
  lead <- function(...) gold_lead_agreement(extracted, gold, matched, ...)
  near <- gold_near_missed(extracted, gold, which(extra), missed)
  list(
    numeric_errors = sum(wrong),
    near_missed_rows = length(unique(near$extracted)),
    missed_rows = length(missed),
    extra_rows = sum(extra),
    outside_rows = nrow(others),
    gold_rows = nrow(gold),
    flagged_rows = sum(extracted$flagged),
    flagged_found_rows = sum(extracted$flagged[paired]),
    lead_agreement = lead(),
    lead_agreement_production = lead(production = TRUE),
    lead_agreement_shown = lead(production = TRUE, shown_only = TRUE),
    pitfalls = pitfalls$pitfalls,
    pitfall_notes = pitfalls$notes,
    flagged_found_keys = gold$key[partner[extracted$flagged[paired]]],
    numeric_error_keys = extracted$key[paired[wrong]],
    missed_keys = gold$key[missed],
    extra_keys = extracted$key[extra],
    near_missed_keys = gold_near_missed_keys(extracted, gold, near),
    outside_keys = others$key,
    outside_gold_trial_keys = others$key[gold_in_trials(others, gold)]
  )
}

# Each extra row (`extra`) beside a missed gold row (`missed`) of its
# medicine, endpoint and trial (gold_trial_names_related()): the pairs, as
# indices of `extracted` and `gold`.
gold_near_missed <- function(extracted, gold, extra, missed) {
  pairs <- expand.grid(
    extracted = extra, gold = missed, KEEP.OUT.ATTRS = FALSE
  )
  e <- pairs$extracted
  g <- pairs$gold
  near <- extracted$medicine[e] == gold$medicine[g] &
    extracted$endpoint[e] == gold$endpoint[g] &
    purrr::map2_lgl(
      extracted$trial_names[e], gold$trial_names[g], gold_trial_names_related
    )
  list(extracted = e[near], gold = g[near])
}

# The pairs of gold_near_missed() as "<its key> beside gold <the gold row's
# key>".
gold_near_missed_keys <- function(extracted, gold, near) {
  paste0(
    extracted$key[near$extracted], " beside gold ", gold$key[near$gold],
    recycle0 = TRUE
  )
}

# Whether each row of `rows` names a trial that a gold row of its medicine
# names (gold_trial_names_shared()).
gold_in_trials <- function(rows, gold) {
  purrr::map_lgl(seq_len(nrow(rows)), function(row) {
    trials <- gold$trial_names[gold$medicine == rows$medicine[row]]
    any(purrr::map_lgl(trials, function(trial_names) {
      gold_trial_names_shared(rows$trial_names[[row]], trial_names)
    }))
  })
}

# What keeps a model from being chosen (spec, and rulings R14): a numeric
# error, or an extra row beside a missed gold row (near_missed_rows: it may be
# that row with a wrong number its own labels kept apart, so it counts
# against the zero-error bar until checked by hand; review of the gold
# analysis's fixes, 2026-10-02), lead agreement under 0.95, a failed pitfall
# or one that could not be tested (its avoidance is not shown), more than 5%
# of the gold rows missed, a call that did not answer (truncated counts),
# rows dropped at parsing. Empty when it meets the rule.
gold_acceptance_problems <- function(result) {
  score <- result$score
  calls <- result$calls
  unanswered <- calls[calls$status != "ok", ]
  dropped <- calls[calls$rows_dropped > 0, ]
  failed_pitfalls <- names(score$pitfalls)[score$pitfalls %in% FALSE]
  untested_pitfalls <- names(score$pitfalls)[is.na(score$pitfalls)]
  near_missed <- score$near_missed_rows %||% 0L
  c(
    if (score$numeric_errors > 0) {
      sprintf("%d numeric error(s)", score$numeric_errors)
    },
    if (near_missed > 0) {
      sprintf(
        paste(
          "%d extra row(s) beside a missed gold row, not checked by hand",
          "(each may be the gold row with a wrong number)"
        ),
        near_missed
      )
    },
    if (score$lead_agreement < 0.95) {
      sprintf("lead agreement %.3f is below 0.95", score$lead_agreement)
    },
    if (length(failed_pitfalls) > 0) {
      paste0("pitfall failed: ", failed_pitfalls)
    },
    if (length(untested_pitfalls) > 0) {
      paste0("pitfall not testable: ", untested_pitfalls)
    },
    if (score$missed_rows > 0.05 * score$gold_rows) {
      sprintf(
        "%d of %d gold rows missed (more than 5%%)",
        score$missed_rows, score$gold_rows
      )
    },
    if (nrow(unanswered) > 0) {
      paste0(unanswered$medicine, ": ", unanswered$status)
    },
    if (nrow(dropped) > 0) {
      paste0(
        dropped$medicine, ": ", dropped$rows_dropped,
        " row(s) dropped at parsing"
      )
    }
  )
}

gold_model_passes <- function(result) {
  length(gold_acceptance_problems(result)) == 0
}

# Dollars for the tokens (a batch pays half the list price); NA for a model
# without a known price.
gold_cost <- function(model, input_tokens, output_tokens, batch = TRUE) {
  price <- gold_prices[[model]]
  if (is.null(price)) {
    return(NA_real_)
  }
  list_price <- (input_tokens * price[["input"]] +
                   output_tokens * price[["output"]]) / 1e6
  if (batch) list_price * gold_batch_factor else list_price
}

# One medicine's batch result as an answer: the rows as the model gave them
# (`raw_rows`, so a verifier fix needs no new batch), the verified rows, those
# that failed verification, those that could not be read, and how the call
# went.
gold_answer <- function(medicine, result) {
  answer <- list(
    status = "no_result", reason = "no result in the batch",
    raw_rows = list(), rows = list(), failed = list(), dropped = character(),
    input_tokens = result$message$usage$input_tokens %||% 0,
    output_tokens = result$message$usage$output_tokens %||% 0
  )
  if (is.null(result)) {
    return(answer)
  }
  if (result$type != "succeeded") {
    answer$status <- result$type
    answer$reason <- if (result$type == "errored") {
      paste0("errored: ", result$error)
    } else {
      result$type
    }
    return(answer)
  }
  parsed <- parse_efficacy_response(result$message)
  answer$status <- parsed$status
  answer$reason <- parsed$reason
  answer$dropped <- purrr::map_chr(parsed$dropped, function(row) {
    paste0("row ", row$index, ": ", row$reason)
  })
  answer$raw_rows <- purrr::imap(parsed$rows, function(row, order) {
    list(medicine = medicine$medicine, row_order = order, row = row)
  })
  verified <- gold_verified_rows(parsed$rows, medicine)
  answer$rows <- verified$rows
  answer$failed <- verified$failed
  answer
}

# What gold_verified_rows() adds to a kept row.
gold_kept_row_fields <- c(
  "medicine", "ema_product_number", "row_order", "verification", "flags"
)

# The flags production gives a kept row (efficacy_flags()), its page looked
# up in the section as one page, so the score can count the rows a human must
# check before the site shows them.
gold_row_flags <- function(row, verification, section) {
  page <- efficacy_row_page(row, list(first_page = 1L, pages = section))
  efficacy_flags(c(row, list(page = page)), verification)
}

# A medicine's answered rows (`orders`: their places in the answer) verified
# against its section and, as production does, its indication text (the
# indication_not_in_source flag): the kept rows as the verifier keeps them
# (verified_efficacy_row(): without the arm fields that did not verify and
# the quotes it dropped) and with production's flags (gold_row_flags()), and
# the failed rows, with their errors and the row as the model gave it
# (`row`).
gold_verified_rows <- function(rows, medicine, orders = seq_along(rows)) {
  checked <- purrr::map2(rows, orders, function(row, order) {
    list(
      row = row, order = order,
      verification = verify_efficacy_row(
        row, medicine$section, medicine$indication
      )
    )
  })
  passed <- purrr::map_lgl(
    checked, \(item) item$verification$status != "failed"
  )
  list(
    rows = purrr::map(checked[passed], function(item) {
      verification <- item$verification
      row <- verified_efficacy_row(item$row, verification)
      c(row, list(
        medicine = medicine$medicine,
        ema_product_number = medicine$ema_product_number,
        row_order = item$order, verification = verification$status,
        flags = as.list(gold_row_flags(row, verification, medicine$section))
      ))
    }),
    failed = purrr::map(checked[!passed], function(item) {
      list(
        medicine = medicine$medicine, trial = item$row$trial,
        endpoint = item$row$endpoint, errors = item$verification$errors,
        row = item$row
      )
    })
  )
}

gold_read_text <- function(path) {
  paste(readLines(path, encoding = "UTF-8", warn = FALSE), collapse = "\n")
}

# Section 5.1 as production sends it: sliced from the product information's
# page texts (the pilot's text files keep pdftotext's form feeds between pages).
gold_section <- function(path) {
  pages <- strsplit(gold_read_text(path), "\f", fixed = TRUE)[[1]]
  slice_smpc_efficacy(pages)$text
}

gold_text_path <- function(text_directory, medicine) {
  file.path(text_directory, paste0(tolower(medicine), "-pi.layout.txt"))
}

# The pilot's medicines with their indication text and section 5.1.
read_gold_medicines <- function(selection_path,
                                text_directory,
                                medicines_path) {
  selection <- jsonlite::fromJSON(selection_path, simplifyVector = FALSE)
  medicines <- dplyr::as_tibble(jsonlite::fromJSON(medicines_path))
  check_gold_inputs(purrr::map_chr(
    selection, \(item) gold_text_path(text_directory, item$medicine)
  ))
  result <- purrr::map(selection, function(item) {
    indication <- medicines$therapeutic_indication[
      medicines$ema_product_number == item$ema_product_number
    ]
    list(
      medicine = item$medicine,
      ema_product_number = item$ema_product_number,
      indication = dplyr::coalesce(indication[1], ""),
      section = gold_section(gold_text_path(text_directory, item$medicine))
    )
  })
  without_section <- purrr::map_chr(result, "medicine")[
    purrr::map_lgl(result, \(item) is.na(item$section))
  ]
  if (length(without_section) > 0) {
    cli::cli_abort(c(
      "No section 5.1 in the product information text of
      {.val {without_section}}.",
      i = "The text files are the pilot's whole product information
      ({.path <medicine>-pi.layout.txt}), split into pages on form feeds."
    ))
  }
  result
}

check_gold_inputs <- function(paths) {
  missing <- paths[!file.exists(paths)]
  if (length(missing) > 0) {
    cli::cli_abort(c(
      "Missing {.path {missing}}.",
      i = "Run this in the repository that holds the pilot's files in
      {.path .remember/efficacy} and a pipeline run's
      {.path site/public/data}."
    ))
  }
}

# A model asked at an effort level: what the evaluation scores, with its own
# batch and files. The legacy effort keeps the names of the runs made before
# effort levels (gold-eval-<model>.json), so a batch they left pending is
# collected, never asked again; another effort adds its name
# (gold-eval-<model>-<effort>.json).
gold_variant <- function(model, effort) {
  list(
    model = model,
    effort = effort,
    name = if (effort == efficacy_legacy_effort) {
      model
    } else {
      paste0(model, "-", effort)
    },
    label = paste0(model, " (", effort, ")")
  )
}

# Every model at every effort, model by model.
gold_variants <- function(models, efforts) {
  pairs <- expand.grid(
    effort = unique(efforts), model = unique(models),
    stringsAsFactors = FALSE, KEEP.OUT.ATTRS = FALSE
  )
  variants <- purrr::map2(pairs$model, pairs$effort, gold_variant)
  stats::setNames(variants, purrr::map_chr(variants, "name"))
}

# APPROVAL_ATLAS_GOLD_EFFORTS: a comma list, "high" when unset.
gold_efforts_from_env <- function(value =
                                    Sys.getenv("APPROVAL_ATLAS_GOLD_EFFORTS")) {
  efficacy_efforts_from_text(value, "APPROVAL_ATLAS_GOLD_EFFORTS")
}

gold_pending_path <- function(output_directory, variant) {
  file.path(output_directory, paste0("gold-pending-", variant$name, ".json"))
}

gold_result_path <- function(output_directory, variant) {
  file.path(output_directory, paste0("gold-eval-", variant$name, ".json"))
}

gold_custom_ids <- function(medicines) {
  purrr::map_chr(
    medicines, \(medicine) efficacy_custom_id(medicine$ema_product_number)
  )
}

# The id of the variant's batch: the one a run left pending (its id was saved
# before anything was polled, so a rerun never pays twice), else a new batch of
# one request per medicine at the variant's effort, saved at once.
gold_submit_batch <- function(variant,
                              medicines,
                              output_directory,
                              create_batch) {
  pending_path <- gold_pending_path(output_directory, variant)
  custom_ids <- gold_custom_ids(medicines)
  if (file.exists(pending_path)) {
    pending <- jsonlite::fromJSON(pending_path, simplifyVector = FALSE)
    pending_effort <- pending$effort %||% efficacy_legacy_effort
    if (!setequal(unlist(pending$custom_ids), custom_ids)) {
      cli::cli_abort(c(
        "{.path {pending_path}} is a batch of other medicines.",
        i = "Collect or delete it before running this evaluation again."
      ))
    }
    if (pending_effort != variant$effort) {
      cli::cli_abort(c(
        "{.path {pending_path}} is a batch at effort {.val {pending_effort}},
        not {.val {variant$effort}}.",
        i = "Collect or delete it before running this evaluation again."
      ))
    }
    cli::cli_inform(
      "Collecting batch {pending$batch_id} ({variant$label}) instead of
      submitting again."
    )
    return(pending$batch_id)
  }
  requests <- purrr::map(medicines, function(medicine) {
    list(
      custom_id = efficacy_custom_id(medicine$ema_product_number),
      params = efficacy_request_params(
        medicine$medicine, medicine$indication, medicine$section,
        variant$model,
        effort = variant$effort, max_tokens = efficacy_batch_max_tokens
      )
    )
  })
  batch_id <- create_batch(requests)
  jsonlite::write_json(
    list(
      batch_id = batch_id, model = variant$model, effort = variant$effort,
      custom_ids = as.list(custom_ids),
      created = format(current_time(), "%Y-%m-%dT%H:%M:%S%z")
    ),
    pending_path,
    auto_unbox = TRUE, pretty = TRUE
  )
  cli::cli_inform(
    "Submitted batch {batch_id} ({variant$label}, {length(requests)}
    request{?s})."
  )
  batch_id
}

dropped_lines <- function(medicine, dropped) {
  if (length(dropped) == 0) {
    return(character())
  }
  paste0(medicine, ": ", dropped)
}

gold_model_result <- function(variant, medicines, gold, results) {
  answers <- purrr::map2(
    medicines, gold_custom_ids(medicines),
    function(medicine, custom_id) {
      gold_answer(medicine, results[[custom_id]])
    }
  )
  names <- purrr::map_chr(medicines, "medicine")
  rows <- purrr::list_flatten(purrr::map(answers, "rows"))
  raw_rows <- purrr::list_flatten(purrr::map(answers, "raw_rows"))
  tokens <- function(field) sum(purrr::map_dbl(answers, field))
  usage <- list(
    input_tokens = tokens("input_tokens"),
    output_tokens = tokens("output_tokens")
  )
  model <- variant$model
  list(
    model = model,
    effort = variant$effort,
    calls = dplyr::tibble(
      medicine = names,
      status = purrr::map_chr(answers, "status"),
      reason = purrr::map_chr(answers, \(a) a$reason %||% NA_character_),
      rows_kept = purrr::map_int(answers, \(answer) length(answer$rows)),
      rows_failed = purrr::map_int(answers, \(answer) length(answer$failed)),
      rows_dropped = purrr::map_int(answers, \(answer) length(answer$dropped)),
      input_tokens = purrr::map_dbl(answers, "input_tokens"),
      output_tokens = purrr::map_dbl(answers, "output_tokens")
    ),
    rows_kept = length(rows),
    rows_failed = sum(purrr::map_int(answers, \(a) length(a$failed))),
    failed = purrr::list_flatten(purrr::map(answers, "failed")),
    dropped_rows = unlist(
      purrr::map2(names, purrr::map(answers, "dropped"), dropped_lines)
    ) %||% character(),
    usage = usage,
    cost = gold_cost(model, usage$input_tokens, usage$output_tokens),
    score = score_against_gold(rows, gold, condition = gold_condition),
    rows = rows,
    raw_rows = raw_rows
  )
}

# A result without an effort was asked at the legacy effort.
gold_result_variant <- function(result) {
  gold_variant(result$model, result$effort %||% efficacy_legacy_effort)
}

write_gold_result <- function(result, output_directory) {
  # A named logical vector would be written without its names.
  result$score$pitfalls <- as.list(result$score$pitfalls)
  path <- gold_result_path(output_directory, gold_result_variant(result))
  jsonlite::write_json(
    result, path,
    auto_unbox = TRUE, pretty = TRUE, null = "null", na = "null",
    digits = NA
  )
  path
}

# A gold-eval-<model>.json read back in the shape gold_model_result() returns;
# one written before effort levels was asked at the legacy effort.
read_gold_result_file <- function(path) {
  result <- jsonlite::fromJSON(path, simplifyVector = FALSE)
  result$effort <- result$effort %||% efficacy_legacy_effort
  result$calls <- dplyr::bind_rows(purrr::map(result$calls, function(call) {
    purrr::map(call, \(value) value %||% NA)
  }))
  # A pitfall that could not be tested is written as null.
  result$score$pitfalls <- purrr::map_lgl(
    result$score$pitfalls, \(value) as.logical(value %||% NA)
  )
  result$dropped_rows <- as.character(unlist(result$dropped_rows))
  result
}

# The result scored again by the current scorer, offline: the file keeps every
# row kept (verified), so a scorer fix needs no new batch, and a report never
# mixes the scores of two scorers.
rescore_gold_result <- function(result, gold) {
  result$score <- score_against_gold(
    result$rows, gold,
    condition = gold_condition
  )
  result
}

# A saved gold-eval-<model>.json scored again against the gold rows at
# `gold_path` (the pilot's nsclc-rows.json), without asking the model. The
# file stays as it is (it can be a kept copy); write_gold_result() writes the
# result.
rescore_saved_gold_result <- function(path, gold_path) {
  check_gold_inputs(c(path, gold_path))
  rescore_gold_result(
    read_gold_result_file(path),
    jsonlite::fromJSON(gold_path, simplifyVector = FALSE)
  )
}

# The result verified again by the current verifier against each medicine's
# section (`medicines`, as read_gold_medicines()), then scored again, offline:
# a verifier fix needs no new batch. A result saved with `raw_rows` (the rows
# as the model gave them) is verified again whole. One saved before keeps
# its kept rows whole, so those are verified again, but its failed rows only
# by trial, endpoint and errors: they stay failed as they were, counted in
# `failed_not_reverified`.
reverify_gold_result <- function(result, medicines, gold) {
  sections <- purrr::set_names(medicines, purrr::map_chr(medicines, "medicine"))
  missing <- setdiff(result$calls$medicine, names(sections))
  if (length(missing) > 0) {
    cli::cli_abort("No section 5.1 for {.val {missing}} to verify again.")
  }
  has_raw <- !is.null(result$raw_rows)
  old_failed <- if (has_raw) list() else result$failed
  verified <- purrr::map(result$calls$medicine, function(name) {
    medicine <- sections[[name]]
    of_medicine <- function(items) {
      Filter(function(item) identical(item$medicine, name), items)
    }
    if (has_raw) {
      raw <- of_medicine(result$raw_rows)
      rows <- purrr::map(raw, "row")
      orders <- purrr::map_int(raw, \(item) as.integer(item$row_order))
    } else {
      kept <- of_medicine(result$rows)
      rows <- purrr::map(kept, function(row) {
        row[setdiff(names(row), gold_kept_row_fields)]
      })
      orders <- purrr::map_int(kept, \(row) as.integer(row$row_order))
    }
    checked <- gold_verified_rows(rows, medicine, orders)
    checked$failed <- c(checked$failed, of_medicine(old_failed))
    checked
  })
  result$rows <- purrr::list_flatten(purrr::map(verified, "rows"))
  result$failed <- purrr::list_flatten(purrr::map(verified, "failed"))
  result$calls$rows_kept <- purrr::map_int(verified, \(v) length(v$rows))
  result$calls$rows_failed <- purrr::map_int(verified, \(v) length(v$failed))
  result$rows_kept <- length(result$rows)
  result$rows_failed <- length(result$failed)
  result$failed_not_reverified <- length(old_failed)
  rescore_gold_result(result, gold)
}

# A saved gold-eval-<model>.json verified and scored again offline
# (reverify_gold_result()) against the pilot's texts and gold rows, without
# asking the model. The file stays as it is (it can be a kept copy);
# write_gold_result() writes the result.
reverify_saved_gold_result <- function(path,
                                       gold_path,
                                       selection_path,
                                       text_directory,
                                       medicines_path) {
  check_gold_inputs(c(path, gold_path))
  reverify_gold_result(
    read_gold_result_file(path),
    read_gold_medicines(selection_path, text_directory, medicines_path),
    jsonlite::fromJSON(gold_path, simplifyVector = FALSE)
  )
}

# The saved result of a variant (gold_result_path()) when it scored exactly
# these medicines at the variant's effort and no batch of it is pending,
# verified and scored again (reverify_gold_result()) and written back, so the
# file and the report agree; else NULL (the variant runs).
read_saved_gold_result <- function(variant,
                                   medicines,
                                   output_directory,
                                   gold) {
  path <- gold_result_path(output_directory, variant)
  if (!file.exists(path) ||
        file.exists(gold_pending_path(output_directory, variant))) {
    return(NULL)
  }
  result <- read_gold_result_file(path)
  if (result$effort != variant$effort || !setequal(
    result$calls$medicine, purrr::map_chr(medicines, "medicine")
  )) {
    return(NULL)
  }
  cli::cli_inform(
    "Using the saved result of {variant$label} ({.path {path}}), verified and
    scored again and written back; delete it to ask again."
  )
  result <- reverify_gold_result(result, medicines, gold)
  write_gold_result(result, output_directory)
  result
}

gold_yes_no <- function(value) {
  ifelse(value, "pass", "FAIL")
}

gold_pitfall_text <- function(value) {
  if (is.na(value)) "not testable" else gold_yes_no(value)
}

gold_cost_text <- function(cost) {
  if (is.na(cost)) "n/a" else sprintf("%.2f", cost)
}

# Mean output tokens of the calls that answered, as the effort level spends
# them (a truncated call would only show the limit); "n/a" without such a
# call, or for a result saved before calls kept their tokens.
gold_output_tokens_per_answer <- function(result) {
  calls <- result$calls
  answered <- calls$status == "ok"
  if (!"output_tokens" %in% names(calls) || !any(answered)) {
    return("n/a")
  }
  format(round(mean(calls$output_tokens[answered])), big.mark = ",")
}

# "3 of 5"; "n/a" for a score made before the count was (`count` NULL).
gold_count_of <- function(count, total) {
  if (is.null(count)) "n/a" else sprintf("%d of %d", count, total)
}

# "0.700"; "n/a" for a score made before the share was (`share` NULL).
gold_share_text <- function(share) {
  if (is.null(share)) "n/a" else sprintf("%.3f", share)
}

gold_report_table <- function(results) {
  labels <- purrr::map_chr(results, \(r) gold_result_variant(r)$label)
  cell <- function(extract) purrr::map_chr(results, extract)
  pitfalls <- names(results[[1]]$score$pitfalls)
  rows <- c(
    list(
      "Calls that answered" = cell(function(r) {
        sprintf("%d of %d", sum(r$calls$status == "ok"), nrow(r$calls))
      }),
      "Truncated calls" = cell(function(r) {
        sprintf("%d of %d", sum(r$calls$status == "truncated"), nrow(r$calls))
      }),
      "Rows kept (verified)" = cell(\(r) as.character(r$rows_kept)),
      "Rows failed verification" = cell(\(r) as.character(r$rows_failed)),
      "Rows dropped at parsing" = cell(
        \(r) as.character(sum(r$calls$rows_dropped))
      ),
      "Numeric errors" = cell(\(r) as.character(r$score$numeric_errors)),
      "Extra rows beside a missed gold row (errors until checked)" = cell(
        function(r) {
          rows <- r$score$near_missed_rows
          if (is.null(rows)) "n/a" else as.character(rows)
        }
      ),
      "Missed gold rows" = cell(function(r) {
        sprintf("%d of %d", r$score$missed_rows, r$score$gold_rows)
      }),
      "Extra rows" = cell(\(r) as.character(r$score$extra_rows)),
      "Rows of other conditions (not scored)" = cell(
        \(r) as.character(r$score$outside_rows)
      ),
      "Scored rows flagged (hidden until reviewed)" = cell(function(r) {
        score <- r$score
        scored <- score$extra_rows + score$gold_rows - score$missed_rows
        gold_count_of(score$flagged_rows, scored)
      }),
      "Gold rows found only by a flagged row" = cell(function(r) {
        score <- r$score
        found <- score$gold_rows - score$missed_rows
        gold_count_of(score$flagged_found_rows, found)
      }),
      "Lead agreement" = cell(\(r) sprintf("%.3f", r$score$lead_agreement)),
      "Lead agreement, production's rule (reported)" = cell(
        \(r) gold_share_text(r$score$lead_agreement_production)
      ),
      "Lead agreement, shown rows only (reported)" = cell(
        \(r) gold_share_text(r$score$lead_agreement_shown)
      )
    ),
    purrr::set_names(
      purrr::map(pitfalls, function(pitfall) {
        cell(\(r) gold_pitfall_text(r$score$pitfalls[[pitfall]]))
      }),
      paste("Pitfall:", pitfalls)
    ),
    list(
      "Input tokens" = cell(\(r) format(r$usage$input_tokens, big.mark = ",")),
      "Output tokens" = cell(
        \(r) format(r$usage$output_tokens, big.mark = ",")
      ),
      "Output tokens per answered call" = cell(gold_output_tokens_per_answer),
      "Cost (USD, batch price)" = cell(\(r) gold_cost_text(r$cost)),
      "Meets the acceptance rule" = cell(
        \(r) gold_yes_no(gold_model_passes(r))
      )
    )
  )
  c(
    paste0("| | ", paste(labels, collapse = " | "), " |"),
    paste0("|---|", paste(rep("---|", length(labels)), collapse = "")),
    paste0(
      "| ", names(rows), " | ",
      purrr::map_chr(rows, paste, collapse = " | "), " |"
    )
  )
}

gold_report_details <- function(result) {
  listing <- function(title, items) {
    if (length(items) == 0) {
      return(character())
    }
    c(paste0("- ", title, ":"), paste0("  - ", items))
  }
  calls <- result$calls[result$calls$status != "ok", ]
  failed <- purrr::map_chr(result$failed, function(row) {
    paste0(
      row$medicine, " ", row$trial %||% "?", ", ", row$endpoint %||% "?",
      ": ", row$errors[[1]]
    )
  })
  c(
    paste0("### ", gold_result_variant(result)$label),
    "",
    listing("Not accepted because", gold_acceptance_problems(result)),
    listing("Calls that did not answer", paste0(
      calls$medicine, ": ", calls$status, " (", calls$reason, ")",
      recycle0 = TRUE
    )),
    listing("Rows dropped at parsing", result$dropped_rows),
    if ((result$failed_not_reverified %||% 0) > 0) {
      sprintf(
        paste(
          "- %d failed row(s) were saved without their row (a file written",
          "before raw rows were kept): listed as they failed, not verified",
          "again"
        ),
        result$failed_not_reverified
      )
    },
    listing("Pitfall notes", result$score$pitfall_notes),
    listing("Numeric errors", result$score$numeric_error_keys),
    listing("Missed gold rows", result$score$missed_keys),
    listing(
      "Gold rows found only by a flagged row (hidden until reviewed)",
      unlist(result$score$flagged_found_keys)
    ),
    listing("Extra rows", result$score$extra_keys),
    listing(
      paste(
        "Extra rows beside a missed gold row of their trial and endpoint",
        "(another population, assessment or analysis by their labels: check",
        "they are not the gold row with a wrong number)"
      ),
      unlist(result$score$near_missed_keys)
    ),
    listing(
      "Rows of other conditions (not scored)", result$score$outside_keys
    ),
    listing(
      "Rows of other conditions in a gold trial (check their indication)",
      result$score$outside_gold_trial_keys
    ),
    listing("Failed verification", failed),
    ""
  )
}

write_gold_report <- function(results, output_directory, today) {
  lines <- c(
    "# Gold-set evaluation of efficacy extraction",
    "",
    paste0(
      "Run ", format(today), ". Gold: the pilot's SmPC rows; rows kept are ",
      "those that pass the verifier; rows whose indication names another ",
      "condition than the gold's (NSCLC) are not scored. Message Batches API, ",
      "so costs are at the batch price (half the list price). Each column is ",
      "a model at an effort level (output_config.effort)."
    ),
    "",
    "Acceptance (spec, rulings R13 and R14): no numeric error among the",
    "verified rows, lead agreement at least 0.95, all four pitfalls avoided,",
    "at most 5% of the gold rows missed, every call answered (a truncated",
    "answer is not) and no row dropped at parsing.",
    "",
    gold_report_table(results),
    "",
    "## Details",
    "",
    unlist(purrr::map(results, gold_report_details), use.names = FALSE)
  )
  path <- file.path(output_directory, "gold-eval-report.md")
  writeLines(lines, path, useBytes = TRUE)
  path
}

# One variant's batch: read once it has ended, scored, written, and its
# pending file removed. NULL (the pending file stays for a rerun) when the
# batch could not be collected now.
gold_collect_model <- function(variant,
                               batch_id,
                               medicines,
                               gold,
                               output_directory,
                               batch_api,
                               poll_seconds) {
  pending_path <- gold_pending_path(output_directory, variant)
  results <- read_efficacy_batch_results(
    batch_id, poll_seconds, batch_api$status, batch_api$results,
    pending_name = basename(pending_path)
  )
  if (is.null(results)) {
    return(NULL)
  }
  result <- gold_model_result(variant, medicines, gold, results)
  write_gold_result(result, output_directory)
  unlink(pending_path)
  result
}

# Asks each model at each effort level (a variant, gold_variant()) for every
# pilot medicine's rows with one Message Batch per variant (production's path,
# at half the price; `batch_api` holds the functions that create a batch, read
# its state and read its results), verifies the rows against the section text,
# scores the kept rows against the gold SmPC rows and writes the variant's
# gold-eval-*.json (as its batch is collected) and gold-eval-report.md into
# `output_directory`. A batch's id is saved in the variant's gold-pending-*.json
# when it is created, so a run that is interrupted or gives up waiting
# collects the same batch when run again, at no new cost. An effort the API
# does not know stops the run before anything is read or asked.
run_gold_evaluation <- function(models,
                                selection_path,
                                text_directory,
                                gold_path,
                                output_directory,
                                efforts = efficacy_default_effort,
                                medicines_path =
                                  "site/public/data/ema_medicines.json",
                                batch_api = list(
                                  create = create_claude_batch,
                                  status = claude_batch_status,
                                  results = claude_batch_results
                                ),
                                poll_seconds = 60,
                                today = Sys.Date()) {
  check_efficacy_efforts(efforts, "`efforts`")
  check_gold_inputs(c(selection_path, gold_path, medicines_path))
  medicines <- read_gold_medicines(
    selection_path, text_directory, medicines_path
  )
  gold <- jsonlite::fromJSON(gold_path, simplifyVector = FALSE)
  dir.create(output_directory, recursive = TRUE, showWarnings = FALSE)
  variants <- gold_variants(models, efforts)
  # A variant already scored on these medicines (and not pending) is read
  # back, never asked again: a rerun after an interruption must not pay twice.
  saved <- purrr::map(variants, function(variant) {
    read_saved_gold_result(variant, medicines, output_directory, gold)
  })
  batch_ids <- purrr::map(variants, function(variant) {
    if (!is.null(saved[[variant$name]])) {
      return(NULL)
    }
    gold_submit_batch(variant, medicines, output_directory, batch_api$create)
  })
  results <- list()
  for (variant in variants) {
    result <- saved[[variant$name]] %||% gold_collect_model(
      variant, batch_ids[[variant$name]], medicines, gold, output_directory,
      batch_api, poll_seconds
    )
    if (is.null(result)) next
    results[[variant$name]] <- result
    # The report so far, so a variant still waiting (a batch can take hours)
    # does not hold back the others' results.
    report <- write_gold_report(results, output_directory, today)
    cli::cli_inform(paste0("Report: ", report))
  }
  unfinished <- purrr::map_chr(variants, "label")[
    !names(variants) %in% names(results)
  ]
  if (length(unfinished) > 0) {
    cli::cli_inform(c(
      "Not collected yet: {.val {unfinished}}.",
      i = "Run the evaluation again: it collects the saved batch, without
      submitting a new one."
    ))
  }
  invisible(results)
}
