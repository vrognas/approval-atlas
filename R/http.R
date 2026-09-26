approval_atlas_user_agent <-
  "approval-atlas (https://github.com/vrognas/approval-atlas)"

throttled_request <- function(url, spacing_seconds = 1, realm = NULL) {
  # capacity = 1 allows no bursts: every request waits for the previous one's
  # spacing, which the default token bucket (capacity = rate) would not.
  httr2::request(url) |>
    httr2::req_user_agent(approval_atlas_user_agent) |>
    httr2::req_throttle(
      capacity = 1,
      fill_time_s = spacing_seconds,
      realm = realm
    ) |>
    httr2::req_timeout(120) |>
    httr2::req_retry(
      max_tries = 3,
      retry_on_failure = TRUE,
      is_transient = is_server_error
    )
}

# 429 is deliberately not transient: retrying a rate-limited host makes the
# limit worse, so the pipeline stops instead.
is_server_error <- function(response) {
  httr2::resp_status(response) >= 500
}

download_to_file <- function(request, destination) {
  dir.create(dirname(destination), recursive = TRUE, showWarnings = FALSE)
  # Download beside the destination and rename, so a failed request (whose
  # error body req_perform() also writes to `path`) never overwrites it.
  temporary_path <- tempfile(tmpdir = dirname(destination))
  on.exit(unlink(temporary_path), add = TRUE)
  response <- httr2::req_perform(request, path = temporary_path)
  if (httr2::resp_status(response) == 304) {
    return(response)
  }
  if (!file.rename(temporary_path, destination)) {
    cli::cli_abort("Could not move the download to {.path {destination}}.")
  }
  response
}
