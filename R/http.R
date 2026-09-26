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

read_source_sidecar <- function(sidecar_path) {
  if (!file.exists(sidecar_path)) {
    return(NULL)
  }
  sidecar <- jsonlite::fromJSON(sidecar_path)
  list(
    url = sidecar$url %||% NA_character_,
    etag = sidecar$etag %||% NA_character_,
    last_modified = sidecar$last_modified %||% NA_character_,
    retrieved = sidecar$retrieved %||% NA_character_
  )
}

write_source_sidecar <- function(source, sidecar_path) {
  jsonlite::write_json(
    source[c("url", "etag", "last_modified", "retrieved")],
    sidecar_path,
    auto_unbox = TRUE,
    na = "null"
  )
}

add_validators <- function(request, cached) {
  if (!is.na(cached$etag)) {
    request <- httr2::req_headers(request, `If-None-Match` = cached$etag)
  }
  if (!is.na(cached$last_modified)) {
    request <- httr2::req_headers(
      request,
      `If-Modified-Since` = cached$last_modified
    )
  }
  request
}

# For sources updated daily: just under a day, because CI restores the
# sidecars with their old modification times and a daily run that starts
# earlier than the one before must still check.
daily_source_max_age_hours <- 20

# Conditional GET at most once per `max_age_hours`: the sidecar's modification
# time records the last check, its fields the validators of the cached copy.
download_cached_source <- function(url,
                                   destination,
                                   request = throttled_request(url),
                                   label = basename(destination),
                                   max_age_hours = 24) {
  sidecar_path <- file.path(dirname(destination), "source.json")
  cached <- read_source_sidecar(sidecar_path)
  has_cache <- !is.null(cached) && identical(cached$url, url) &&
    file.exists(destination)
  if (has_cache && is_recent_file(sidecar_path, max_age_hours)) {
    cli::cli_inform("Using cached {label} in {.path {destination}}.")
    return(c(cached, path = destination))
  }
  if (has_cache) {
    cli::cli_inform("Checking {label} for changes.")
    request <- add_validators(request, cached)
  } else {
    cli::cli_inform("Downloading {label} from {.url {url}}.")
  }
  response <- download_to_file(request, destination)
  if (httr2::resp_status(response) == 304) {
    cli::cli_inform("{label} unchanged since {cached$retrieved}.")
    source <- cached
  } else {
    source <- list(
      url = url,
      etag = httr2::resp_header(response, "ETag", default = NA_character_),
      last_modified = httr2::resp_header(
        response,
        "Last-Modified",
        default = NA_character_
      ),
      retrieved = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
    )
  }
  write_source_sidecar(source, sidecar_path)
  c(source, path = destination)
}
