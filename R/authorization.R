# Statuses of products that never held a marketing authorisation, whatever
# dates EMA lists for them (two "Application withdrawn" rows carry an MA date).
never_authorized_statuses <- c(
  "Application withdrawn",
  "Refused",
  "Opinion",
  "Opinion under re-examination",
  "Withdrawn from rolling review"
)

ended_statuses <- c("Withdrawn", "Expired", "Lapsed", "Revoked", "Suspended")

series_first_date <- as.Date("1995-01-31")

add_authorization_intervals <- function(medicines) {
  medicines |>
    dplyr::mutate(
      authorized_from = .data$marketing_authorisation_date,
      authorized_until = pmin(
        .data[[
          "withdrawal_expiry_revocation_lapse_of_marketing_authorisation_date"
        ]],
        .data$suspension_of_marketing_authorisation_date,
        na.rm = TRUE
      ),
      # Unknown dates are excluded rather than guessed: an ended product
      # without an end date would otherwise count as authorized forever.
      series_exclusion = dplyr::case_when(
        .data$medicine_status %in% never_authorized_statuses ~
          "never_authorized",
        is.na(.data$authorized_from) ~ "no_approval_date",
        .data$medicine_status %in% ended_statuses &
          is.na(.data$authorized_until) ~ "ended_without_end_date",
        .default = NA_character_
      ),
      .after = "medicine_type"
    )
}

snapshot_date_from_timestamp <- function(timestamp) {
  # EMA labels Amsterdam local time with "Z", so only the date part is right.
  snapshot_date <- as.Date(substr(timestamp, 1, 10), format = "%Y-%m-%d")
  if (length(snapshot_date) != 1 || is.na(snapshot_date)) {
    cli::cli_abort(
      "Cannot read a snapshot date from the EMA timestamp
      {.val {format(timestamp %||% 'missing')}}."
    )
  }
  snapshot_date
}

series_dates <- function(snapshot_date) {
  # A month-end falls before the snapshot exactly when the next day does not
  # fall after it; the snapshot itself is the last point.
  next_days <- seq(series_first_date + 1, snapshot_date, by = "month")
  c(next_days - 1, snapshot_date)
}

is_counted_in_series <- function(medicines, date) {
  is_counted <- is.na(medicines$series_exclusion) &
    medicines$authorized_from <= date &
    (is.na(medicines$authorized_until) | medicines$authorized_until > date)
  is_counted %in% TRUE
}

is_authorized_now <- function(medicines) {
  medicines$medicine_status == "Authorised" & !is.na(medicines$authorized_from)
}

# Days from the CHMP opinion to the EC decision granting the marketing
# authorisation (both EMA dates), for opinions of the five years before the
# snapshot, so the figures follow current practice. An opinion dated after
# the authorisation is a later one (e.g. an extension), not the one that led
# to it.
summarise_opinion_to_decision <- function(medicines, snapshot_date) {
  opinions_from <- seq(snapshot_date, length.out = 2, by = "-5 years")[[2]]
  days <- medicines |>
    dplyr::filter(
      !.data$medicine_status %in% never_authorized_statuses,
      .data$opinion_adopted_date >= opinions_from,
      .data$opinion_adopted_date <= .data$marketing_authorisation_date
    ) |>
    dplyr::mutate(
      days = as.integer(
        .data$marketing_authorisation_date - .data$opinion_adopted_date
      )
    ) |>
    dplyr::pull("days")
  quantiles <- round(stats::quantile(days, c(0.5, 0.9), names = FALSE))
  list(
    median_days = as.integer(quantiles[[1]]),
    p90_days = as.integer(quantiles[[2]]),
    medicines = length(days),
    opinions_from = format(opinions_from)
  )
}

build_authorized_series <- function(medicines, snapshot_date) {
  series <- purrr::map(series_dates(snapshot_date), function(date) {
    is_counted <- is_counted_in_series(medicines, date)
    substance_set_keys <- medicines$substance_set_key[is_counted]
    dplyr::tibble(
      date = date,
      authorized_products = sum(is_counted),
      authorized_substances = dplyr::n_distinct(
        substance_set_keys,
        na.rm = TRUE
      )
    )
  })
  purrr::list_rbind(series)
}
