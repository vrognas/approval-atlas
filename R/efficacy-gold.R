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
# - population: the extractor's population_match; the gold rows state none,
#   so it only appears in the key shown for missed and extra rows;
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

gold_endpoint_names <- c(
  "progression free survival" = "PFS",
  "overall survival" = "OS",
  "disease free survival" = "DFS",
  "event free survival" = "EFS",
  "objective response rate" = "ORR",
  "overall response rate" = "ORR",
  "duration of response" = "DOR",
  "pathological complete response" = "PCR",
  "major pathological response" = "MPR"
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
# ("non?small cell").
gold_condition <- list(
  own = "non.?small.?cell.?lung|\\bnsclc\\b",
  others = paste(
    c(
      "melanoma", "renal.?cell", "urothelial", "bladder", "head.?and.?neck",
      "hodgkin", "lymphoma", "colorectal", "\\bm?crc\\b", "gastric",
      "o?esophag", "hepatocellular", "\\bhcc\\b", "biliary", "cholangio",
      "thyroid", "breast", "cervical", "endometri", "ovarian", "mesothelioma",
      "nasopharyn", "cutaneous", "cscc", "basal.?cell", "\\b(la|m)?bcc\\b",
      "merkel", "small.?cell.?lung", "\\bsclc\\b", "solid.?tumou?r", "msi.?h",
      "mismatch.?repair"
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
# progression ("Second PFS", "PFS2") and a subsequent therapy ("PFS after
# first subsequent therapy"). A qualifier of the analysis or the population
# does not ("PFS at second interim analysis", "PFS in patients with baseline
# CNS metastases").
gold_endpoint_qualifiers <- c(
  paste0(
    "(cns|intracranial) (progression|response|objective|overall|duration|",
    "recurrence|pfs|orr|dor|dfs|efs)"
  ),
  "second (progression|pfs)",
  "pfs ?2",
  "subsequent (therapy|treatment|anticancer|line)"
)

# The known endpoints a label names as words, by name or abbreviation
# ("Confirmed objective response rate" and "Confirmed ORR, laBCC" name ORR).
# A label with a qualifier names none ("CNS progression-free survival",
# "Second PFS after start of first subsequent therapy"), nor does one of an
# endpoint the scorer does not know ("Time to worsening of patient-reported
# NSCLC symptoms").
gold_endpoint_mentions <- function(endpoint) {
  words <- paste0(
    " ", gsub("[^a-z0-9]+", " ", tolower(gold_text(endpoint))), " "
  )
  has <- function(phrase) grepl(paste0(" ", phrase, " "), words, fixed = TRUE)
  qualified <- purrr::map_lgl(gold_endpoint_qualifiers, function(phrase) {
    grepl(paste0(" ", phrase, " "), words, perl = TRUE)
  })
  if (any(qualified)) {
    return(character())
  }
  by_name <- purrr::map_lgl(names(gold_endpoint_names), has)
  by_abbreviation <- purrr::map_lgl(tolower(gold_known_endpoints), has)
  unique(c(
    unname(gold_endpoint_names[by_name]),
    gold_known_endpoints[by_abbreviation]
  ))
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

# How well an extracted row fits a gold row: the trial and endpoint above all
# (constant within a group), then the value, the confidence interval, the
# analysis role and the effect type.
gold_pair_scores <- function(extracted, gold, pairs) {
  e <- pairs$extracted
  g <- pairs$gold
  same_interval <- gold_ci_skipped(
    extracted$ci_is_range[e], gold$ci_low[g], gold$ci_high[g]
  ) | (extracted$ci_low[e] == gold$ci_low[g] &
         extracted$ci_high[e] == gold$ci_high[g])
  32 * (extracted$trial[e] == gold$trial[g]) +
    16 * (extracted$endpoint[e] == gold$endpoint[g]) +
    8 * (extracted$value[e] == gold$value[g]) + 4 * same_interval +
    2 * same_known(extracted$role[e], gold$role[g]) +
    same_known(extracted$effect_type[e], gold$effect_type[g])
}

# Which pairs may pair at all: only rows whose trial labels can name the same
# trial (gold_trial_names_related()), even where they fold to one key
# (DESTINY-Lung01 is not DESTINY-Lung02). With `linked` (rows of a medicine
# left over from their own group, so a label the model spelled differently
# cannot hide a wrong number) also only the same endpoint, or the same trial
# key where one label names the other's endpoint (gold_endpoint_mentions():
# "Confirmed objective response rate" is ORR; OS or "time to worsening of
# symptoms" is never PFS).
gold_pairable <- function(extracted, gold, pairs, linked) {
  e <- pairs$extracted
  g <- pairs$gold
  related <- purrr::map2_lgl(
    extracted$trial_names[e], gold$trial_names[g], gold_trial_names_related
  )
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

# Whether each row of a table is its (medicine, indication)'s lead row, as the
# site file would show it (choose_lead_rows(), every row shown).
gold_lead_flags <- function(table) {
  if (nrow(table) == 0) {
    return(logical())
  }
  choose_lead_rows(dplyr::tibble(
    ema_product_number = table$medicine,
    row_key = as.character(seq_len(nrow(table))),
    row_order = table$order,
    indication = table$indication,
    trial = table$trial_text,
    is_primary = table$is_primary,
    analysis_role = table$role,
    population_match = rep(NA_character_, nrow(table)),
    review = rep("auto_ok", nrow(table))
  ))$lead
}

# The share of the gold's lead rows (one per medicine and setting) whose
# matched extracted row is a lead row of the extraction as well. A gold lead
# nothing matches is a disagreement, so dropping a medicine or a setting costs.
gold_lead_agreement <- function(extracted, gold, matched) {
  gold_leads <- which(gold_lead_flags(gold))
  extracted_leads <- gold_lead_flags(extracted)
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

# Each of the pilot's four pitfalls: TRUE when the extraction avoids it. The
# MARIPOSA-2 one needs an OS row to test: without one it passes only where the
# gold has none either (as the pilot's), and says so in `notes`. ALEX rows
# without arm values fail (the gold has them), and `notes` says why: their
# column order could not be tested, which is not a swap.
gold_pitfalls <- function(extracted, gold, matched) {
  alex <- which(gold$trial == "alex")
  alex_ok <- length(alex) > 0 && all(purrr::map_lgl(alex, function(row) {
    found <- which(matched == row)
    length(found) == 1 &&
      extracted$arm_treatment[found] == gold$arm_treatment[row] &&
      extracted$arm_control[found] == gold$arm_control[row]
  }))
  alex_found <- which(matched %in% alex)
  alex_without_arms <- alex_found[
    !nzchar(extracted$arm_treatment[alex_found]) &
      !nzchar(extracted$arm_control[alex_found])
  ]
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
  note <- if (length(alex_without_arms) > 0) {
    sprintf(
      paste(
        "alex_column_order: %d of the %d ALEX rows found were extracted",
        "without arm values, so their column order could not be tested"
      ),
      length(alex_without_arms), length(alex_found)
    )
  } else {
    character()
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
# trial such as LIBRETTO-001, or an NSCLC row given another indication).
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
  wrong <- extracted$value[paired] != gold$value[partner] |
    (!gold_ci_skipped(
      extracted$ci_is_range[paired], gold$ci_low[partner], gold$ci_high[partner]
    ) & (extracted$ci_low[paired] != gold$ci_low[partner] |
           extracted$ci_high[paired] != gold$ci_high[partner]))
  pitfalls <- gold_pitfalls(extracted, gold, matched)
  list(
    numeric_errors = sum(wrong),
    missed_rows = length(setdiff(seq_len(nrow(gold)), matched)),
    extra_rows = sum(extra),
    outside_rows = nrow(others),
    gold_rows = nrow(gold),
    lead_agreement = gold_lead_agreement(extracted, gold, matched),
    pitfalls = pitfalls$pitfalls,
    pitfall_notes = pitfalls$notes,
    numeric_error_keys = extracted$key[paired[wrong]],
    missed_keys = gold$key[setdiff(seq_len(nrow(gold)), matched)],
    extra_keys = extracted$key[extra],
    outside_keys = others$key,
    outside_gold_trial_keys = others$key[gold_in_trials(others, gold)]
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
# error, lead agreement under 0.95, a failed pitfall, more than 5% of the gold
# rows missed, a call that did not answer (truncated counts), rows dropped at
# parsing. Empty when it meets the rule.
gold_acceptance_problems <- function(result) {
  score <- result$score
  calls <- result$calls
  unanswered <- calls[calls$status != "ok", ]
  dropped <- calls[calls$rows_dropped > 0, ]
  failed_pitfalls <- names(score$pitfalls)[!score$pitfalls %in% TRUE]
  c(
    if (score$numeric_errors > 0) {
      sprintf("%d numeric error(s)", score$numeric_errors)
    },
    if (score$lead_agreement < 0.95) {
      sprintf("lead agreement %.3f is below 0.95", score$lead_agreement)
    },
    if (length(failed_pitfalls) > 0) {
      paste0("pitfall failed: ", failed_pitfalls)
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

# One medicine's batch result as an answer: the verified rows, those that
# failed verification, those that could not be read, and how the call went.
gold_answer <- function(medicine, result) {
  answer <- list(
    status = "no_result", reason = "no result in the batch",
    rows = list(), failed = list(), dropped = character(),
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
  checked <- purrr::imap(parsed$rows, function(row, order) {
    verification <- verify_efficacy_row(row, medicine$section)
    row <- c(row, list(
      medicine = medicine$medicine,
      ema_product_number = medicine$ema_product_number,
      row_order = order, verification = verification$status
    ))
    list(row = row, verification = verification)
  })
  passed <- purrr::map_lgl(
    checked, \(item) item$verification$status != "failed"
  )
  answer$rows <- purrr::map(checked[passed], "row")
  answer$failed <- purrr::map(checked[!passed], function(item) {
    list(
      medicine = item$row$medicine, trial = item$row$trial,
      endpoint = item$row$endpoint, errors = item$verification$errors
    )
  })
  answer
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
    rows = rows
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
  result$score$pitfalls <- unlist(result$score$pitfalls)
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

# The saved result of a variant (gold_result_path()) when it scored exactly
# these medicines at the variant's effort and no batch of it is pending, scored
# again against `gold` and written back, so the file and the report agree;
# else NULL (the variant runs).
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
    "Using the saved result of {variant$label} ({.path {path}}), scored again
    and written back; delete it to ask again."
  )
  result <- rescore_gold_result(result, gold)
  write_gold_result(result, output_directory)
  result
}

gold_yes_no <- function(value) {
  ifelse(value, "pass", "FAIL")
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
      "Missed gold rows" = cell(function(r) {
        sprintf("%d of %d", r$score$missed_rows, r$score$gold_rows)
      }),
      "Extra rows" = cell(\(r) as.character(r$score$extra_rows)),
      "Rows of other conditions (not scored)" = cell(
        \(r) as.character(r$score$outside_rows)
      ),
      "Lead agreement" = cell(\(r) sprintf("%.3f", r$score$lead_agreement))
    ),
    purrr::set_names(
      purrr::map(pitfalls, function(pitfall) {
        cell(\(r) gold_yes_no(r$score$pitfalls[[pitfall]]))
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
      calls$medicine, ": ", calls$status, " (", calls$reason, ")"
    )),
    listing("Rows dropped at parsing", result$dropped_rows),
    listing("Pitfall notes", result$score$pitfall_notes),
    listing("Numeric errors", result$score$numeric_error_keys),
    listing("Missed gold rows", result$score$missed_keys),
    listing("Extra rows", result$score$extra_keys),
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
