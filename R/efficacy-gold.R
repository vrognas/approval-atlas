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
#   row is compared within;
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

# An abbreviation in parentheses after a longer name wins ("Duration of
# response (DoR)"); other parentheses are dropped ("OS (final analysis)").
gold_endpoint <- function(endpoint) {
  text <- tolower(gold_text(endpoint))
  abbreviation <- regmatches(
    text, regexpr("(?<=\\()[a-z]{2,6}(?=\\))", text, perl = TRUE)
  )
  if (length(abbreviation) == 1 && grepl("^[^(]{8,}\\(", text)) {
    return(toupper(abbreviation))
  }
  text <- trimws(gsub("\\([^)]*\\)", "", text))
  text <- gsub("-", " ", text, fixed = TRUE)
  toupper(dplyr::coalesce(unname(gold_endpoint_names[text]), text))
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
    endpoint = purrr::map_chr(rows, \(row) gold_endpoint(row$endpoint)),
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

# Greedy best pairs: the highest score first, then the order in the extracted
# rows, then in the gold rows. With `linked` only rows of the same trial or
# the same endpoint can pair. Returns the gold row of each extracted row (NA
# when none is left for it).
match_group_rows <- function(extracted,
                             gold,
                             extracted_rows,
                             gold_rows,
                             linked = FALSE) {
  pairs <- expand.grid(
    extracted = extracted_rows, gold = gold_rows, KEEP.OUT.ATTRS = FALSE
  )
  if (linked) {
    pairs <- pairs[
      extracted$trial[pairs$extracted] == gold$trial[pairs$gold] |
        extracted$endpoint[pairs$extracted] == gold$endpoint[pairs$gold],
    ]
  }
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
# (medicine, trial, endpoint); then the rows still unpaired of a medicine pair
# by trial or endpoint alone, so a label the model spelled differently cannot
# hide a wrong number as a missed row plus an extra one.
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
# gold has none either (as the pilot's), and says so in `notes`.
gold_pitfalls <- function(extracted, gold, matched) {
  alex <- which(gold$trial == "alex")
  alex_ok <- length(alex) > 0 && all(purrr::map_lgl(alex, function(row) {
    found <- which(matched == row)
    length(found) == 1 &&
      extracted$arm_treatment[found] == gold$arm_treatment[row] &&
      extracted$arm_control[found] == gold$arm_control[row]
  }))
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
  note <- character()
  mariposa2_ok <- if (any(mariposa2)) {
    !any(claims_significance(extracted$significance[mariposa2]))
  } else {
    note <- paste(
      "mariposa2_significance: no MARIPOSA-2 OS row was extracted, so its",
      "significance statement could not be tested",
      if (any(mariposa2_os(gold))) "(the gold expects the row)" else
        "(the gold has none either)"
    )
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
# range the gold gives no CI for is not compared.
score_against_gold <- function(extracted, gold) {
  extracted <- gold_row_table(extracted)
  gold <- gold_row_table(gold)
  matched <- match_gold_rows(extracted, gold)
  paired <- which(!is.na(matched))
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
    extra_rows = sum(is.na(matched)),
    gold_rows = nrow(gold),
    lead_agreement = gold_lead_agreement(extracted, gold, matched),
    pitfalls = pitfalls$pitfalls,
    pitfall_notes = pitfalls$notes,
    numeric_error_keys = extracted$key[paired[wrong]],
    missed_keys = gold$key[setdiff(seq_len(nrow(gold)), matched)],
    extra_keys = extracted$key[is.na(matched)]
  )
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

gold_pending_path <- function(output_directory, model) {
  file.path(output_directory, paste0("gold-pending-", model, ".json"))
}

gold_custom_ids <- function(medicines) {
  purrr::map_chr(
    medicines, \(medicine) efficacy_custom_id(medicine$ema_product_number)
  )
}

# The id of the model's batch: the one a run left pending (its id was saved
# before anything was polled, so a rerun never pays twice), else a new batch of
# one request per medicine, saved at once.
gold_submit_batch <- function(model,
                              medicines,
                              output_directory,
                              create_batch) {
  pending_path <- gold_pending_path(output_directory, model)
  custom_ids <- gold_custom_ids(medicines)
  if (file.exists(pending_path)) {
    pending <- jsonlite::fromJSON(pending_path, simplifyVector = FALSE)
    if (!setequal(unlist(pending$custom_ids), custom_ids)) {
      cli::cli_abort(c(
        "{.path {pending_path}} is a batch of other medicines.",
        i = "Collect or delete it before running this evaluation again."
      ))
    }
    cli::cli_inform(
      "Collecting batch {pending$batch_id} ({model}) instead of submitting
      again."
    )
    return(pending$batch_id)
  }
  requests <- purrr::map(medicines, function(medicine) {
    list(
      custom_id = efficacy_custom_id(medicine$ema_product_number),
      params = efficacy_request_params(
        medicine$medicine, medicine$indication, medicine$section, model,
        max_tokens = efficacy_batch_max_tokens
      )
    )
  })
  batch_id <- create_batch(requests)
  jsonlite::write_json(
    list(
      batch_id = batch_id, model = model, custom_ids = as.list(custom_ids),
      created = format(current_time(), "%Y-%m-%dT%H:%M:%S%z")
    ),
    pending_path,
    auto_unbox = TRUE, pretty = TRUE
  )
  cli::cli_inform(
    "Submitted batch {batch_id} ({model}, {length(requests)} request{?s})."
  )
  batch_id
}

dropped_lines <- function(medicine, dropped) {
  if (length(dropped) == 0) {
    return(character())
  }
  paste0(medicine, ": ", dropped)
}

gold_model_result <- function(model, medicines, gold, results) {
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
  list(
    model = model,
    calls = dplyr::tibble(
      medicine = names,
      status = purrr::map_chr(answers, "status"),
      reason = purrr::map_chr(answers, \(a) a$reason %||% NA_character_),
      rows_kept = purrr::map_int(answers, \(answer) length(answer$rows)),
      rows_failed = purrr::map_int(answers, \(answer) length(answer$failed)),
      rows_dropped = purrr::map_int(answers, \(answer) length(answer$dropped))
    ),
    rows_kept = length(rows),
    rows_failed = sum(purrr::map_int(answers, \(a) length(a$failed))),
    failed = purrr::list_flatten(purrr::map(answers, "failed")),
    dropped_rows = unlist(
      purrr::map2(names, purrr::map(answers, "dropped"), dropped_lines)
    ) %||% character(),
    usage = usage,
    cost = gold_cost(model, usage$input_tokens, usage$output_tokens),
    score = score_against_gold(rows, gold),
    rows = rows
  )
}

write_gold_result <- function(result, output_directory) {
  # A named logical vector would be written without its names.
  result$score$pitfalls <- as.list(result$score$pitfalls)
  path <- file.path(
    output_directory, paste0("gold-eval-", result$model, ".json")
  )
  jsonlite::write_json(
    result, path,
    auto_unbox = TRUE, pretty = TRUE, null = "null", na = "null",
    digits = NA
  )
  path
}

# The saved result of a model (gold-eval-<model>.json) when it scored exactly
# these medicines and no batch of it is pending; else NULL (the model runs).
# Read back in the shape gold_model_result() returns, for the report.
read_saved_gold_result <- function(model, medicines, output_directory) {
  path <- file.path(output_directory, paste0("gold-eval-", model, ".json"))
  if (!file.exists(path) ||
        file.exists(gold_pending_path(output_directory, model))) {
    return(NULL)
  }
  result <- jsonlite::fromJSON(path, simplifyVector = FALSE)
  calls <- dplyr::bind_rows(purrr::map(result$calls, function(call) {
    purrr::map(call, \(value) value %||% NA)
  }))
  if (!setequal(calls$medicine, purrr::map_chr(medicines, "medicine"))) {
    return(NULL)
  }
  cli::cli_inform(
    "Using the saved result of {model} ({.path {path}}); delete it to ask
    that model again."
  )
  result$calls <- calls
  result$score$pitfalls <- unlist(result$score$pitfalls)
  result$dropped_rows <- as.character(unlist(result$dropped_rows))
  result
}

gold_yes_no <- function(value) {
  ifelse(value, "pass", "FAIL")
}

gold_cost_text <- function(cost) {
  if (is.na(cost)) "n/a" else sprintf("%.2f", cost)
}

gold_report_table <- function(results) {
  models <- purrr::map_chr(results, "model")
  cell <- function(extract) purrr::map_chr(results, extract)
  pitfalls <- names(results[[1]]$score$pitfalls)
  rows <- c(
    list(
      "Calls that answered" = cell(function(r) {
        sprintf("%d of %d", sum(r$calls$status == "ok"), nrow(r$calls))
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
      "Cost (USD, batch price)" = cell(\(r) gold_cost_text(r$cost)),
      "Meets the acceptance rule" = cell(
        \(r) gold_yes_no(gold_model_passes(r))
      )
    )
  )
  c(
    paste0("| | ", paste(models, collapse = " | "), " |"),
    paste0("|---|", paste(rep("---|", length(models)), collapse = "")),
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
    paste0("### ", result$model),
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
      "those that pass the verifier. Message Batches API, so costs are at the ",
      "batch price (half the list price)."
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

# One model's batch: read once it has ended, scored, written, and its pending
# file removed. NULL (the pending file stays for a rerun) when the batch could
# not be collected now.
gold_collect_model <- function(model,
                               batch_id,
                               medicines,
                               gold,
                               output_directory,
                               batch_api,
                               poll_seconds) {
  pending_path <- gold_pending_path(output_directory, model)
  results <- read_efficacy_batch_results(
    batch_id, poll_seconds, batch_api$status, batch_api$results,
    pending_name = basename(pending_path)
  )
  if (is.null(results)) {
    return(NULL)
  }
  result <- gold_model_result(model, medicines, gold, results)
  write_gold_result(result, output_directory)
  unlink(pending_path)
  result
}

# Asks each model for every pilot medicine's rows with one Message Batch per
# model (production's path, at half the price; `batch_api` holds the functions
# that create a batch, read its state and read its results), verifies the rows
# against the section text, scores the kept rows against the gold SmPC rows and
# writes gold-eval-<model>.json (as each model's batch is collected) and
# gold-eval-report.md into `output_directory`. A batch's id is saved in
# gold-pending-<model>.json when it is created, so a run that is interrupted
# or gives up waiting collects the same batch when run again, at no new cost.
run_gold_evaluation <- function(models,
                                selection_path,
                                text_directory,
                                gold_path,
                                output_directory,
                                medicines_path =
                                  "site/public/data/ema_medicines.json",
                                batch_api = list(
                                  create = create_claude_batch,
                                  status = claude_batch_status,
                                  results = claude_batch_results
                                ),
                                poll_seconds = 60,
                                today = Sys.Date()) {
  check_gold_inputs(c(selection_path, gold_path, medicines_path))
  medicines <- read_gold_medicines(
    selection_path, text_directory, medicines_path
  )
  gold <- jsonlite::fromJSON(gold_path, simplifyVector = FALSE)
  dir.create(output_directory, recursive = TRUE, showWarnings = FALSE)
  # A model already scored on these medicines (and not pending) is read back,
  # never asked again: a rerun after an interruption must not pay twice.
  saved <- purrr::map(models, function(model) {
    read_saved_gold_result(model, medicines, output_directory)
  })
  names(saved) <- models
  batch_ids <- purrr::map(models, function(model) {
    if (!is.null(saved[[model]])) {
      return(NULL)
    }
    gold_submit_batch(model, medicines, output_directory, batch_api$create)
  })
  names(batch_ids) <- models
  results <- list()
  for (model in models) {
    result <- saved[[model]] %||% gold_collect_model(
      model, batch_ids[[model]], medicines, gold, output_directory, batch_api,
      poll_seconds
    )
    if (is.null(result)) next
    results[[model]] <- result
    # The report so far, so a model still waiting (a batch can take hours)
    # does not hold back the others' results.
    report <- write_gold_report(results, output_directory, today)
    cli::cli_inform(paste0("Report: ", report))
  }
  unfinished <- setdiff(models, names(results))
  if (length(unfinished) > 0) {
    cli::cli_inform(c(
      "Not collected yet: {.val {unfinished}}.",
      i = "Run the evaluation again: it collects the saved batch, without
      submitting a new one."
    ))
  }
  invisible(results)
}
