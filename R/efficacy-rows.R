# What makes an extracted efficacy row the same row on a rerun (its key), what
# makes it need a human (its flags), and which human reviews survive a rerun.

# Ruling R11: assessment, effect type, indication and comparator too, so two
# true rows differing only there do not collide.
efficacy_key_fields <- c(
  "ema_product_number", "trial", "endpoint", "population", "analysis",
  "value", "ci_low", "ci_high", "assessment", "effect_type", "indication",
  "comparator"
)

field_text <- function(value) {
  value <- unlist(value)
  value <- value[!is.na(value)]
  paste(as.character(value), collapse = "\u001e")
}

hash_parts <- function(parts) {
  digest::digest(
    paste(parts, collapse = "\u001f"),
    algo = "sha1",
    serialize = FALSE
  )
}

efficacy_row_key <- function(row) {
  hash_parts(purrr::map_chr(
    efficacy_key_fields,
    \(field) field_text(row[[field]])
  ))
}

# A hash of every field the model gave (quotes included): a reviewed_ok row
# stays reviewed only while nothing a human saw has changed (ruling R10).
efficacy_content_hashes <- function(rows) {
  fields <- names(efficacy_field_types)
  purrr::map_chr(seq_len(nrow(rows)), function(index) {
    hash_parts(purrr::map_chr(fields, function(field) {
      if (!field %in% names(rows)) "" else field_text(rows[[field]][[index]])
    }))
  })
}

mentions_not_reached <- function(text) {
  !is_absent(text) && grepl("\\b(NR|NE)\\b", text, perl = TRUE)
}

# Every reason a verified row needs a human before it is shown.
efficacy_flags <- function(row, verification) {
  ci_level <- row[["ci_level"]]
  effect_type <- row[["effect_type"]]
  single_arm_hr <- is_absent(row[["comparator"]]) &&
    !is_absent(effect_type) && startsWith(effect_type, "hr")
  checks <- c(
    reassembled = length(verification$warnings) > 0,
    ci_level = !is_absent(ci_level) && ci_level != 95,
    is_primary_unknown = is_absent(row[["is_primary"]]),
    population_differs = !is_absent(row[["population_match"]]) &&
      row[["population_match"]] %in% c("whole_trial_broader", "other"),
    ci_is_range = isTRUE(row[["ci_is_range"]]),
    not_reached = any(purrr::map_lgl(
      c("value", "arm_treatment", "arm_control"),
      \(field) mentions_not_reached(row[[field]])
    )),
    single_arm_hr = single_arm_hr,
    comparator_label_missing = !is_absent(row[["comparator"]]) &&
      is_absent(row[["comparator_column_label"]]),
    # A row given its page (extracted rows) whose quote was not placed.
    page_unknown = "page" %in% names(row) && is_absent(row[["page"]])
  )
  # The verifier's own: text, indication, CI level or arm sizes not found
  # where the row says they come from.
  c(names(checks)[checks], verification$flags)
}

efficacy_human_reviews <- c("reviewed_ok", "reviewed_rejected")

# A new row keeps reviewed_rejected on the same key, and reviewed_ok only
# when every model field is also unchanged; else it is flagged or auto_ok.
# The old rows of `replaced_products` give way to the new ones, except their
# rejected rows, kept as tombstones (never shown) so the same row found again
# comes back rejected; the other products' rows are kept.
merge_efficacy_reviews <- function(new_rows,
                                   old_rows,
                                   replaced_products =
                                     unique(new_rows$ema_product_number)) {
  old_hashes <- efficacy_content_hashes(old_rows)
  reviews <- old_rows |>
    dplyr::mutate(human_hash = old_hashes) |>
    dplyr::filter(.data$review %in% efficacy_human_reviews) |>
    dplyr::distinct(.data$row_key, .keep_all = TRUE) |>
    dplyr::select("row_key", human_review = "review", "human_hash")
  reviewed <- new_rows |>
    dplyr::select(-dplyr::any_of("review")) |>
    dplyr::mutate(content_hash = efficacy_content_hashes(new_rows)) |>
    dplyr::left_join(reviews, by = "row_key") |>
    dplyr::mutate(review = dplyr::case_when(
      .data$human_review == "reviewed_rejected" ~ "reviewed_rejected",
      .data$human_review == "reviewed_ok" &
        .data$human_hash == .data$content_hash ~ "reviewed_ok",
      lengths(.data$flags) > 0 ~ "flagged",
      .default = "auto_ok"
    )) |>
    dplyr::select(-"human_review", -"human_hash", -"content_hash")
  kept <- dplyr::filter(
    old_rows,
    !.data$ema_product_number %in% replaced_products |
      (.data$review == "reviewed_rejected" &
         !.data$row_key %in% new_rows$row_key)
  )
  dplyr::bind_rows(kept, reviewed)
}
