# The Claude API over plain HTTP (there is no official R SDK). Used only by the
# on-demand efficacy extractor, never by the daily pipeline or CI.

claude_api_base <- "https://api.anthropic.com/v1/"

claude_api_key <- function() {
  key <- Sys.getenv("ANTHROPIC_API_KEY")
  if (identical(key, "")) {
    cli::cli_abort(c(
      "{.envvar ANTHROPIC_API_KEY} is not set.",
      i = "Add it to {.file .Renviron} (gitignored) and restart R."
    ))
  }
  key
}

claude_request_to <- function(url, key) {
  httr2::request(url) |>
    httr2::req_headers(
      `x-api-key` = key,
      `anthropic-version` = "2023-06-01",
      .redact = "x-api-key"
    ) |>
    httr2::req_user_agent(approval_atlas_user_agent) |>
    httr2::req_timeout(600) |>
    httr2::req_error(is_error = function(response) FALSE)
}

claude_request <- function(path, key = claude_api_key()) {
  claude_request_to(paste0(claude_api_base, path), key)
}

# The API's own message when the body is its error object; else the start of
# the body (a proxy or gateway may answer with plain text or {"error": "..."}).
claude_error_detail <- function(response) {
  text <- tryCatch(httr2::resp_body_string(response), error = function(e) "")
  body <- tryCatch(
    jsonlite::fromJSON(text, simplifyVector = FALSE),
    error = function(error) NULL
  )
  message <- if (is.list(body) && is.list(body$error)) body$error$message
  if (is.character(message) && length(message) == 1 && nzchar(message)) {
    return(message)
  }
  text <- trimws(text)
  if (!nzchar(text)) {
    return("no message")
  }
  substr(text, 1, 300)
}

abort_claude_http <- function(response, what = "Claude API") {
  status <- httr2::resp_status(response)
  retry_after <- httr2::resp_header(response, "retry-after")
  cli::cli_abort(
    "{what} returned HTTP {status}: {claude_error_detail(response)}",
    class = c(paste0("claude_api_http_", status), "claude_api_error"),
    status = status,
    retry_after = retry_after
  )
}

claude_json <- function(response) {
  if (httr2::resp_status(response) >= 400) {
    abort_claude_http(response)
  }
  httr2::resp_body_json(response)
}

send_claude_message <- function(params) {
  claude_request("messages") |>
    httr2::req_body_json(params, auto_unbox = TRUE, null = "null") |>
    httr2::req_perform() |>
    claude_json()
}

create_claude_batch <- function(requests) {
  batch <- claude_request("messages/batches") |>
    httr2::req_body_json(
      list(requests = requests),
      auto_unbox = TRUE,
      null = "null"
    ) |>
    httr2::req_perform() |>
    claude_json()
  if (!is_text(batch$id)) {
    cli::cli_abort("Claude API created a batch but returned no {.field id}.")
  }
  batch$id
}

is_text <- function(value) {
  is.character(value) && length(value) == 1 && !is.na(value) && nzchar(value)
}

claude_batch_states <- c("in_progress", "canceling", "ended")

claude_batch_status <- function(batch_id) {
  batch <- claude_request(paste0("messages/batches/", batch_id)) |>
    httr2::req_perform() |>
    claude_json()
  state <- batch$processing_status
  if (!(is_text(state) && state %in% claude_batch_states)) {
    cli::cli_abort(c(
      "Batch {batch_id} has an unknown {.field processing_status}.",
      i = "Expected one of {.val {claude_batch_states}}."
    ))
  }
  list(
    status = state,
    results_url = batch$results_url %||% NA_character_
  )
}

# The error type sits at result$error$error$type in some responses and at
# result$error$type in others.
claude_result_error <- function(result) {
  result$error$error$type %||% result$error$type %||% "errored"
}

check_claude_results_url <- function(results_url) {
  parsed <- httr2::url_parse(results_url)
  on_api <- identical(parsed$scheme, "https") &&
    identical(parsed$hostname, "api.anthropic.com")
  if (!on_api) {
    cli::cli_abort(c(
      "The batch results URL is not on {.url https://api.anthropic.com}.",
      i = "The API key is sent to the Claude API only."
    ))
  }
}

parse_claude_result_line <- function(line, line_number) {
  item <- tryCatch(
    jsonlite::fromJSON(line, simplifyVector = FALSE),
    error = function(error) NULL
  )
  if (!is.list(item)) {
    cli::cli_abort("Batch results line {line_number} is not a JSON object.")
  }
  if (!is_text(item$custom_id) || !is_text(item$result$type)) {
    cli::cli_abort(c(
      "Batch results line {line_number} is incomplete.",
      i = "It needs a {.field custom_id} and a {.field result$type}."
    ))
  }
  list(
    custom_id = item$custom_id,
    type = item$result$type,
    message = item$result$message,
    error = if (identical(item$result$type, "errored")) {
      claude_result_error(item$result)
    } else {
      NA_character_
    }
  )
}

claude_batch_results <- function(results_url) {
  check_claude_results_url(results_url)
  response <- claude_request_to(results_url, claude_api_key()) |>
    httr2::req_perform()
  if (httr2::resp_status(response) >= 400) {
    abort_claude_http(response, "Claude API (batch results)")
  }
  lines <- strsplit(httr2::resp_body_string(response), "\r?\n")[[1]]
  numbers <- which(nzchar(trimws(lines)))
  results <- purrr::map2(
    lines[numbers],
    numbers,
    parse_claude_result_line
  )
  ids <- purrr::map_chr(results, "custom_id")
  repeated <- unique(ids[duplicated(ids)])
  if (length(repeated) > 0) {
    cli::cli_abort(
      "Batch results repeat {.val {repeated}} as {.field custom_id}."
    )
  }
  results
}
