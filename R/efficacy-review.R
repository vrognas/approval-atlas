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
  } else {
    sprintf(
      " (%s%% CI %s, %s)",
      dplyr::coalesce(format(row$ci_level), "?"), row$ci_low, row$ci_high
    )
  }
  paste0(dplyr::coalesce(row$value, "(no value)"), interval)
}

efficacy_review_entry <- function(row) {
  flags <- unlist(row$flags)
  c(
    sprintf(
      "### %s · %s · %s", row$ema_product_number,
      dplyr::coalesce(row$trial, "?"), dplyr::coalesce(row$endpoint, "?")
    ),
    "",
    paste0("- Value: ", efficacy_review_value(row)),
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
    paste0("> ", unlist(row$quotes)),
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
