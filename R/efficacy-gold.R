# Phase A0 of "Pivotal results": scoring what a model extracts from the pilot's
# SmPC section 5.1 texts against the hand-verified gold rows, and the driver
# (scripts/eval-efficacy-gold.R) that asks each model and writes a report. The
# owner runs the driver; tests use a fake `send_message` (no network).
#
# The gold rows use the pilot's schema, the extractor's rows the pipeline's.
# The scorer reads both through the same few columns:
# - medicine, trial (its first word, folded: "ALEX (BO28984)" = "ALEX") and
#   endpoint (an abbreviation: "Progression-free survival (PFS)" = "PFS")
#   name the group a row is compared within;
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
#   so it only appears in the key shown for missed and extra rows.
# Only the gold rows whose source_doc is "SmPC" are scored.

gold_smpc_sources <- c("", "SmPC")

# Price per million input and output tokens.
gold_prices <- list(
  "claude-sonnet-5-5" = c(input = 2, output = 10),
  "claude-opus-5-5" = c(input = 4, output = 20)
)

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
  gsub("[[:space:]% ]", "", gold_text(value))
}

gold_logical <- function(value) {
  if (length(value) == 0 || is.na(value[[1]])) {
    return(NA)
  }
  as.logical(value[[1]])
}

gold_trial_word <- function(trial) {
  sub("^([^[:space:](,;:]*).*$", "\\1", tolower(gold_text(trial)))
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
    gold_trial_word(row$trial),
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
  medicine <- tolower(text_column("medicine"))
  table <- dplyr::tibble(
    medicine = medicine,
    trial_text = text_column("trial"),
    trial = purrr::map_chr(rows, \(row) gold_trial_word(row$trial)),
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
    arm_treatment = purrr::map_chr(
      rows, \(row) gsub("[[:space:]]+", " ", gold_text(row$arm_treatment))
    ),
    arm_control = purrr::map_chr(
      rows, \(row) gsub("[[:space:]]+", " ", gold_text(row$arm_control))
    ),
    significance = tolower(text_column("significance_stated")),
    ci_is_range = purrr::map_lgl(
      rows, \(row) gold_logical(row$ci_is_range)
    ),
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

# How well an extracted row fits a gold row of its group: the value above all,
# then the confidence interval, the analysis role, the effect type.
gold_pair_scores <- function(extracted, gold, pairs) {
  e <- pairs$extracted
  g <- pairs$gold
  same_value <- extracted$value[e] == gold$value[g]
  same_interval <- extracted$ci_low[e] == gold$ci_low[g] &
    extracted$ci_high[e] == gold$ci_high[g]
  8 * same_value + 4 * same_interval +
    2 * same_known(extracted$role[e], gold$role[g]) +
    same_known(extracted$effect_type[e], gold$effect_type[g])
}

# Greedy best pairs within one group: the highest score first, then the
# order in the extracted rows, then in the gold rows. Returns the gold row of
# each extracted row (NA when none is left for it).
match_group_rows <- function(extracted, gold, extracted_rows, gold_rows) {
  pairs <- expand.grid(
    extracted = extracted_rows, gold = gold_rows, KEEP.OUT.ATTRS = FALSE
  )
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

# For each extracted row the gold row it stands for, or NA.
match_gold_rows <- function(extracted, gold) {
  matched <- rep(NA_integer_, nrow(extracted))
  for (group in intersect(extracted$group, gold$group)) {
    extracted_rows <- which(extracted$group == group)
    matched[extracted_rows] <- match_group_rows(
      extracted, gold, extracted_rows, which(gold$group == group)
    )
  }
  matched
}

# The share of (medicine, indication) groups whose lead row (Task 7's
# choose_lead_rows(), every row shown) is the gold's first row of that trial.
# Zero when nothing is extracted.
gold_lead_agreement <- function(extracted, gold, matched) {
  if (nrow(extracted) == 0) {
    return(0)
  }
  rows <- choose_lead_rows(dplyr::tibble(
    ema_product_number = extracted$medicine,
    row_key = as.character(seq_len(nrow(extracted))),
    row_order = extracted$order,
    indication = extracted$indication,
    trial = extracted$trial_text,
    is_primary = extracted$is_primary,
    analysis_role = extracted$role,
    population_match = rep(NA_character_, nrow(extracted)),
    review = rep("auto_ok", nrow(extracted))
  ))
  leads <- which(rows$lead)
  if (length(leads) == 0) {
    return(0)
  }
  first_of_trial <- function(lead) {
    which(
      gold$medicine == extracted$medicine[lead] &
        gold$trial == extracted$trial[lead]
    )[1]
  }
  agrees <- purrr::map_lgl(leads, function(lead) {
    identical(matched[lead], first_of_trial(lead))
  })
  mean(agrees)
}

# "not statistically significant", "non-significant" and "no significant ..."
# deny significance; any other "significan..." claims it.
claims_significance <- function(text) {
  text <- gsub(
    "(not|no|non)[ -]+(statistically[ -]+)?significan[a-z]*", "", text
  )
  grepl("significan", text)
}

# Each of the pilot's four pitfalls: TRUE when the extraction avoids it.
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
  mariposa2 <- extracted$trial == "mariposa-2" & extracted$endpoint == "OS"
  lumykras <- extracted$medicine == "lumykras" & extracted$endpoint == "DOR"
  c(
    alex_column_order = alex_ok,
    impower110_primary = impower110,
    mariposa2_significance =
      !any(mariposa2 & claims_significance(extracted$significance)),
    lumykras_range =
      any(lumykras) && all(extracted$ci_is_range[lumykras] %in% TRUE)
  )
}

# Scores the extracted rows against the gold rows (both lists of rows, see the
# top of the file). Numeric errors: a matched row whose value, ci_low or
# ci_high differ from the gold's as printed, once per row.
score_against_gold <- function(extracted, gold) {
  extracted <- gold_row_table(extracted)
  gold <- gold_row_table(gold)
  matched <- match_gold_rows(extracted, gold)
  paired <- which(!is.na(matched))
  wrong <- purrr::map_lgl(paired, function(row) {
    g <- matched[row]
    extracted$value[row] != gold$value[g] |
      extracted$ci_low[row] != gold$ci_low[g] |
      extracted$ci_high[row] != gold$ci_high[g]
  })
  list(
    numeric_errors = sum(wrong),
    missed_rows = length(setdiff(seq_len(nrow(gold)), matched)),
    extra_rows = sum(is.na(matched)),
    lead_agreement = gold_lead_agreement(extracted, gold, matched),
    pitfalls = gold_pitfalls(extracted, gold, matched),
    numeric_error_keys = extracted$key[paired[wrong]],
    missed_keys = gold$key[setdiff(seq_len(nrow(gold)), matched)],
    extra_keys = extracted$key[is.na(matched)]
  )
}

# Spec's acceptance rule for choosing a model.
gold_model_passes <- function(score) {
  score$numeric_errors == 0 &&
    score$lead_agreement >= 0.95 &&
    all(score$pitfalls)
}

# Dollars for the tokens; NA for a model without a known price.
gold_cost <- function(model, input_tokens, output_tokens) {
  price <- gold_prices[[model]]
  if (is.null(price)) {
    return(NA_real_)
  }
  (input_tokens * price[["input"]] + output_tokens * price[["output"]]) / 1e6
}

gold_stop_statuses <- c(401L, 403L, 429L)

# One medicine's answer: the verified rows, those that failed verification and
# how the call went. It asks with the production batch's token limit (ruling
# R8). A call that fails for a reason another try would not fix (key,
# permission, rate limit) stops the whole run.
gold_ask_model <- function(medicine, model, send_message) {
  params <- efficacy_request_params(
    medicine$medicine, medicine$indication, medicine$section, model,
    max_tokens = efficacy_batch_max_tokens
  )
  message <- tryCatch(
    send_message(params),
    error = function(error) {
      status <- purrr::map_lgl(
        paste0("claude_api_http_", gold_stop_statuses),
        \(class) inherits(error, class)
      )
      if (any(status)) {
        stop(error)
      }
      error
    }
  )
  record <- function(status, reason = NA_character_) {
    list(
      status = status, reason = reason, rows = list(), failed = list(),
      input_tokens = message$usage$input_tokens %||% 0,
      output_tokens = message$usage$output_tokens %||% 0
    )
  }
  if (inherits(message, "error")) {
    return(record("errored", conditionMessage(message)))
  }
  parsed <- parse_efficacy_response(message)
  answer <- record(parsed$status, parsed$reason)
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

# The pilot's medicines with their indication text and section 5.1 (layout).
read_gold_medicines <- function(selection_path,
                                text_directory,
                                medicines_path) {
  selection <- jsonlite::fromJSON(selection_path, simplifyVector = FALSE)
  medicines <- dplyr::as_tibble(jsonlite::fromJSON(medicines_path))
  text_path <- function(item) {
    file.path(
      text_directory, paste0(tolower(item$medicine), "-pi-5.1.layout.txt")
    )
  }
  check_gold_inputs(purrr::map_chr(selection, text_path))
  purrr::map(selection, function(item) {
    indication <- medicines$therapeutic_indication[
      medicines$ema_product_number == item$ema_product_number
    ]
    list(
      medicine = item$medicine,
      ema_product_number = item$ema_product_number,
      indication = dplyr::coalesce(indication[1], ""),
      section = gold_read_text(text_path(item))
    )
  })
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

gold_model_result <- function(model, medicines, gold, send_message) {
  cli::cli_inform("Asking {.val {model}} about {length(medicines)} medicines.")
  answers <- purrr::map(medicines, function(medicine) {
    cli::cli_inform("{model}: {medicine$medicine}")
    gold_ask_model(medicine, model, send_message)
  })
  rows <- purrr::list_flatten(purrr::map(answers, "rows"))
  tokens <- function(field) sum(purrr::map_dbl(answers, field))
  usage <- list(
    input_tokens = tokens("input_tokens"),
    output_tokens = tokens("output_tokens")
  )
  list(
    model = model,
    calls = dplyr::tibble(
      medicine = purrr::map_chr(medicines, "medicine"),
      status = purrr::map_chr(answers, "status"),
      reason = purrr::map_chr(answers, "reason"),
      rows_kept = purrr::map_int(answers, \(answer) length(answer$rows)),
      rows_failed = purrr::map_int(answers, \(answer) length(answer$failed))
    ),
    rows_kept = length(rows),
    rows_failed = sum(purrr::map_int(answers, \(a) length(a$failed))),
    failed = purrr::list_flatten(purrr::map(answers, "failed")),
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
      "Rows kept (verified)" = cell(\(r) as.character(r$rows_kept)),
      "Rows failed verification" = cell(\(r) as.character(r$rows_failed)),
      "Numeric errors" = cell(\(r) as.character(r$score$numeric_errors)),
      "Missed gold rows" = cell(\(r) as.character(r$score$missed_rows)),
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
      "Cost (USD)" = cell(\(r) gold_cost_text(r$cost)),
      "Meets the acceptance rule" = cell(
        \(r) gold_yes_no(gold_model_passes(r$score))
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
    listing("Calls that did not answer", paste0(
      calls$medicine, ": ", calls$status, " (", calls$reason, ")"
    )),
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
      "those that pass the verifier."
    ),
    "",
    "Acceptance (spec): no numeric error among the verified rows, lead",
    "agreement at least 0.95 and all four pitfalls avoided.",
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

# Asks each model for every pilot medicine's rows (one request each, no
# batch, so the answers are back in minutes), verifies them against the
# section text, scores the kept rows against the gold SmPC rows and writes
# gold-eval-<model>.json and gold-eval-report.md into `output_directory`.
run_gold_evaluation <- function(models,
                                selection_path,
                                text_directory,
                                gold_path,
                                output_directory,
                                medicines_path =
                                  "site/public/data/ema_medicines.json",
                                send_message = send_claude_message,
                                today = Sys.Date()) {
  check_gold_inputs(c(selection_path, gold_path, medicines_path))
  medicines <- read_gold_medicines(
    selection_path, text_directory, medicines_path
  )
  gold <- jsonlite::fromJSON(gold_path, simplifyVector = FALSE)
  dir.create(output_directory, recursive = TRUE, showWarnings = FALSE)
  results <- purrr::map(models, function(model) {
    result <- gold_model_result(model, medicines, gold, send_message)
    write_gold_result(result, output_directory)
    result
  })
  names(results) <- models
  report <- write_gold_report(results, output_directory, today)
  cli::cli_inform(paste0("Report: ", report))
  invisible(results)
}
