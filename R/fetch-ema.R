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
  cli::cli_inform("Downloading EMA data from {.url {url}}.")
  download_to_file(throttled_request(url), destination)
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
