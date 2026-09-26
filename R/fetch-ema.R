ema_medicines_url <- paste0(
  "https://www.ema.europa.eu/en/documents/report/",
  "medicines-output-medicines_json-report_en.json"
)

download_ema_json <- function(url = ema_medicines_url,
                              destination = ".cache/ema/medicines.json",
                              max_age_hours = 24) {
  if (is_recent_file(destination, max_age_hours)) {
    cli::cli_inform("Using cached EMA data in {.path {destination}}.")
    return(destination)
  }
  dir.create(dirname(destination), recursive = TRUE, showWarnings = FALSE)
  # Download beside the cache and rename, so a failed request (whose error
  # body req_perform() also writes to `path`) never overwrites the cache.
  temporary_path <- tempfile(tmpdir = dirname(destination))
  on.exit(unlink(temporary_path), add = TRUE)
  cli::cli_inform("Downloading EMA data from {.url {url}}.")
  httr2::request(url) |>
    httr2::req_user_agent(
      "approval-atlas (https://github.com/vrognas/approval-atlas)"
    ) |>
    httr2::req_timeout(120) |>
    httr2::req_retry(max_tries = 4, retry_on_failure = TRUE) |>
    httr2::req_perform(path = temporary_path)
  if (!file.rename(temporary_path, destination)) {
    cli::cli_abort("Could not move the download to {.path {destination}}.")
  }
  destination
}

is_recent_file <- function(path, max_age_hours) {
  file.exists(path) &&
    difftime(Sys.time(), file.mtime(path), units = "hours") < max_age_hours
}

read_ema_json <- function(path) {
  ema <- jsonlite::fromJSON(path)
  list(meta = ema$meta, data = dplyr::as_tibble(ema$data))
}
