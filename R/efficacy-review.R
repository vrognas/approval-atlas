# The owner's review of extracted efficacy rows
# (scripts/efficacy-review-sample.R): every flagged row, and a sample of the
# rows that passed without flags. Decisions go into data-raw/efficacy-rows.json
# as `review` reviewed_ok or reviewed_rejected.

efficacy_review_share <- 0.1

# A share of the auto_ok rows, taken in turns across products (one row of
# each product in a random order, then a second, ...), so the sample covers
# as many products as it can. Uses the session's random seed.
sample_efficacy_review <- function(rows, share = efficacy_review_share) {
  auto_ok <- dplyr::filter(rows, .data$review == "auto_ok")
  size <- ceiling(share * nrow(auto_ok))
  shuffled <- auto_ok[sample.int(nrow(auto_ok)), ]
  products <- sample(unique(shuffled$ema_product_number))
  shuffled |>
    dplyr::mutate(
      turn = dplyr::row_number(),
      .by = "ema_product_number"
    ) |>
    dplyr::mutate(
      product_order = match(.data$ema_product_number, products)
    ) |>
    dplyr::arrange(.data$turn, .data$product_order) |>
    utils::head(size) |>
    dplyr::select(-"turn", -"product_order") |>
    dplyr::arrange(.data$ema_product_number, .data$row_order)
}

efficacy_review_value <- function(row) {
  interval <- if (is.na(row$ci_low) || is.na(row$ci_high)) {
    ""
  } else if (isTRUE(row$ci_is_range)) {
    sprintf(" (range %s, %s)", row$ci_low, row$ci_high)
  } else {
    level <- if (is.na(row$ci_level)) "" else paste0(row$ci_level, "% ")
    sprintf(" (%sCI %s, %s)", level, row$ci_low, row$ci_high)
  }
  paste0(dplyr::coalesce(row$value, "(no value)"), interval)
}

efficacy_review_effect_words <- c(
  hr = "HR", hr_noninferiority = "HR", rate_difference = "difference",
  single_arm_rate = "response rate", single_arm_median = "median"
)

# The effect as the card words it (efficacy.js formatEffect()), in plain text.
efficacy_review_effect <- function(row) {
  words <- efficacy_review_effect_words[row$effect_type]
  effect <- paste(
    c(if (!is.na(words)) words, efficacy_review_value(row)),
    collapse = " "
  )
  if (row$effect_type %in% "hr_noninferiority") {
    effect <- paste0(effect, ", non-inferiority")
  }
  effect
}

review_text <- function(value) {
  if (length(value) == 0 || is.na(value)) "not stated" else as.character(value)
}

efficacy_review_arm <- function(text, n) {
  if (is.na(text)) {
    return(NULL)
  }
  if (is.na(n)) text else sprintf("%s (n = %s)", text, n)
}

efficacy_review_regimen <- function(row) {
  regimen <- efficacy_review_arm(row$regimen, row$n_treatment)
  comparator <- efficacy_review_arm(row$comparator, row$n_control)
  paste(
    review_text(regimen),
    if (is.null(comparator)) "(single-arm)" else paste("vs", comparator)
  )
}

# Owner decision 2026-10-01: the extractor blanks a two-arm effect's arm sizes
# no table places under their arms' column headers (unverified_sizes()), and
# the rows file does not record it, so a two-arm effect without both sizes
# says when they are kept.
efficacy_review_sizes <- function(row) {
  missing <- efficacy_size_fields[
    purrr::map_lgl(efficacy_size_fields, \(field) is_absent(row[[field]]))
  ]
  if (!two_arm_effect(row) || length(missing) == 0) {
    return(NULL)
  }
  shown <- if (length(missing) == 2) {
    "not shown"
  } else if (missing == "n_treatment") {
    "the treatment arm's not shown"
  } else {
    "the control arm's not shown"
  }
  paste(
    "- Arm sizes:", shown, "(kept only where a table header prints the",
    "comparator's column label over the control arm's n and the treatment",
    "arm's n beside it)"
  )
}

efficacy_review_arms <- function(row) {
  if (is.na(row$arm_treatment) && is.na(row$arm_control)) {
    return("not stated")
  }
  arms <- paste(
    review_text(row$arm_treatment), "vs", review_text(row$arm_control)
  )
  if (is.na(row$arm_measure)) {
    return(arms)
  }
  sprintf("%s (%s)", arms, row$arm_measure)
}

efficacy_review_primary <- function(is_primary) {
  if (is.na(is_primary)) "not stated" else if (is_primary) "yes" else "no"
}

# Every field the medicine card shows, so the reviewer judges what readers
# will see.
efficacy_review_fields <- function(row) {
  population <- review_text(row$population)
  if (!is.na(row$population_match)) {
    population <- sprintf("%s (%s)", population, row$population_match)
  }
  analysis <- paste(
    c(
      if (!is.na(row$analysis_role)) paste0(row$analysis_role, ":"),
      review_text(row$analysis)
    ),
    collapse = " "
  )
  c(
    paste0("- Indication: ", review_text(row$indication)),
    paste0("- Trial: ", review_text(row$trial)),
    paste0("- Population: ", population),
    paste0("- Regimen: ", efficacy_review_regimen(row)),
    efficacy_review_sizes(row),
    paste0(
      "- Comparator column label: ", review_text(row$comparator_column_label)
    ),
    paste0("- Arms: ", efficacy_review_arms(row)),
    paste0("- Endpoint: ", review_text(row$endpoint)),
    paste0("- Assessment: ", review_text(row$assessment)),
    paste0("- Primary endpoint: ", efficacy_review_primary(row$is_primary)),
    paste0("- Analysis: ", analysis),
    paste0("- CI level: ", review_text(row$ci_level)),
    paste0("- Effect: ", efficacy_review_effect(row))
  )
}

# Every line of every quote in the block quote; quotes apart by a ">" line.
efficacy_review_quotes <- function(quotes) {
  blocks <- purrr::map(quotes, function(quote) {
    c(paste0("> ", strsplit(quote, "\r?\n")[[1]]), ">")
  })
  utils::head(unlist(blocks), -1)
}

efficacy_review_entry <- function(row) {
  flags <- unlist(row$flags)
  c(
    sprintf(
      "### %s · %s · %s", row$ema_product_number,
      dplyr::coalesce(row$trial, "?"), dplyr::coalesce(row$endpoint, "?")
    ),
    "",
    efficacy_review_fields(row),
    paste0(
      "- Flags: ",
      if (length(flags) == 0) "none" else paste(flags, collapse = ", ")
    ),
    sprintf(
      "- Source: %s, page %s", row$source_url,
      dplyr::coalesce(as.character(row$page), "?")
    ),
    paste0("- Row key: `", row$row_key, "`"),
    "",
    efficacy_review_quotes(unlist(row$quotes)),
    ""
  )
}

efficacy_review_section <- function(title, rows) {
  entries <- purrr::map(seq_len(nrow(rows)), function(index) {
    efficacy_review_entry(rows[index, ])
  })
  c(sprintf("## %s (%d)", title, nrow(rows)), "", unlist(entries))
}

efficacy_review_markdown <- function(flagged, sample, date) {
  c(
    paste("# Efficacy review", format(date)),
    "",
    paste(
      "Check each row against its PDF page. Record the decision by setting",
      "`review` to `reviewed_ok` or `reviewed_rejected` on the row with that",
      "`row_key` in `data-raw/efficacy-rows.json`."
    ),
    "",
    efficacy_review_section("Flagged rows", flagged),
    efficacy_review_section("Sample of auto_ok rows", sample)
  )
}
