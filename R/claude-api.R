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

abort_claude_http <- function(status, detail) {
  cli::cli_abort("Claude API returned HTTP {status}: {detail}")
}

claude_json <- function(response) {
  status <- httr2::resp_status(response)
  if (status >= 400) {
    body <- tryCatch(
      httr2::resp_body_json(response),
      error = function(error) list()
    )
    abort_claude_http(status, body$error$message %||% "no message")
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
  batch$id
}

claude_batch_status <- function(batch_id) {
  batch <- claude_request(paste0("messages/batches/", batch_id)) |>
    httr2::req_perform() |>
    claude_json()
  list(
    status = batch$processing_status,
    results_url = batch$results_url %||% NA_character_
  )
}

# The error type sits at result$error$error$type in some responses and at
# result$error$type in others.
claude_result_error <- function(result) {
  result$error$error$type %||% result$error$type %||% "errored"
}

claude_batch_results <- function(results_url) {
  response <- claude_request_to(results_url, claude_api_key()) |>
    httr2::req_perform()
  status <- httr2::resp_status(response)
  if (status >= 400) {
    cli::cli_abort("Claude API returned HTTP {status} for the batch results.")
  }
  lines <- strsplit(httr2::resp_body_string(response), "\n", fixed = TRUE)[[1]]
  lines <- lines[nzchar(trimws(lines))]
  purrr::map(lines, function(line) {
    item <- jsonlite::fromJSON(line, simplifyVector = FALSE)
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
  })
}
