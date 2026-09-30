# One Claude Message Batch per extractor run. A batch is billed once it
# exists, so its id and plan are saved (pending-batch.json) before it is
# polled: a run that is interrupted, or gives up waiting, leaves the file and
# the next run collects that batch instead of planning (and paying) again.

efficacy_pending_path <- ".cache/downloads/ema-efficacy/pending-batch.json"

# Minutes without a successful read of the batch state before a run stops
# waiting (the pending file stays for the next run).
efficacy_poll_give_up_minutes <- 30

# Mocked in tests.
current_time <- function() {
  Sys.time()
}

# Written beside the file and renamed over it, so a failed write never leaves
# a half file that later runs cannot read.
write_pending_batch <- function(path, batch_id, model, plan) {
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  partial <- paste0(path, ".tmp")
  on.exit(unlink(partial), add = TRUE)
  jsonlite::write_json(
    list(
      batch_id = batch_id,
      model = model,
      created = format(current_time(), "%Y-%m-%dT%H:%M:%S%z"),
      plan = plan
    ),
    partial,
    auto_unbox = TRUE,
    pretty = TRUE,
    na = "null",
    dataframe = "rows"
  )
  if (!file.rename(partial, path)) {
    cli::cli_abort("Could not replace {.path {path}}.")
  }
  invisible(path)
}

read_pending_batch <- function(path) {
  pending <- jsonlite::fromJSON(path)
  pending$plan <- dplyr::as_tibble(pending$plan) |>
    dplyr::mutate(
      therapeutic_indication = as.character(.data$therapeutic_indication),
      document_last_updated_date = as.Date(
        as.character(.data$document_last_updated_date)
      )
    )
  pending
}

# A 4xx other than 429 means the API refused the batch; anything else (a
# timeout, a 5xx) may have created it.
batch_submission_warning <- function(error, count) {
  refused <- inherits(error, "claude_api_error") &&
    !is.null(error$status) && error$status < 500 && error$status != 429
  hint <- if (refused) {
    "{count} product{?s} left for a later run."
  } else {
    "The batch may exist and be billed: check the Anthropic Console
    (https://console.anthropic.com) before running again;
    {count} product{?s} left for a later run."
  }
  cli::cli_warn(c(
    "Claude API: {conditionMessage(error)}",
    i = hint
  ))
}

submit_efficacy_batch <- function(submissions, model, pending_path) {
  requests <- purrr::map(submissions, "request")
  batch_id <- tryCatch(
    create_claude_batch(requests),
    error = function(error) {
      batch_submission_warning(error, length(requests))
      NULL
    }
  )
  if (is.null(batch_id)) {
    return(NULL)
  }
  # Shown before anything else can fail: the batch is billed from now on.
  cli::cli_inform(
    "Submitted batch {batch_id} with {length(requests)} request{?s}."
  )
  plan <- dplyr::bind_rows(purrr::map(submissions, "plan_row"))
  tryCatch(
    write_pending_batch(pending_path, batch_id, model, plan),
    error = function(error) {
      cli::cli_warn(c(
        "Could not save batch {batch_id} in {.path {pending_path}}:
        {conditionMessage(error)}",
        i = "It is collected in this run if it ends in time. If this run
        stops first, the batch is still billed: its id is {batch_id}; check
        the Anthropic Console (https://console.anthropic.com) and collect it
        by that id before running again, or its products are paid for
        twice."
      ))
    }
  )
  batch_id
}

retry_after_seconds <- function(error) {
  seconds <- suppressWarnings(as.numeric(error$retry_after %||% NA))
  if (length(seconds) != 1 || is.na(seconds)) 0 else seconds
}

minutes_since <- function(time) {
  as.numeric(difftime(current_time(), time, units = "mins"))
}

# The results URL once the batch has ended (NA when it ended without one);
# NULL when its state could not be read for efficacy_poll_give_up_minutes.
# `batch_status` and `pending_name` let another run (the gold evaluation) use
# its own state reader and pending file.
wait_for_efficacy_batch <- function(batch_id,
                                    poll_seconds,
                                    batch_status = claude_batch_status,
                                    pending_name = "pending-batch.json") {
  started <- current_time()
  last_read <- started
  repeat {
    state <- tryCatch(
      batch_status(batch_id),
      error = function(error) error
    )
    wait <- poll_seconds
    if (inherits(state, "error")) {
      if (minutes_since(last_read) >= efficacy_poll_give_up_minutes) {
        cli::cli_warn(c(
          "Stopped waiting for batch {batch_id}:
          {conditionMessage(state)}",
          i = "It stays in {.path {pending_name}}; the next run collects it."
        ))
        return(NULL)
      }
      cli::cli_inform(escape_cli_braces(paste0(
        "Batch ", batch_id, ": ", conditionMessage(state)
      )))
      wait <- max(poll_seconds, retry_after_seconds(state))
    } else {
      last_read <- current_time()
      if (identical(state$status, "ended")) {
        return(state$results_url)
      }
      cli::cli_inform(escape_cli_braces(sprintf(
        "Batch %s: %s after %d minute(s).",
        batch_id, state$status, as.integer(round(minutes_since(started)))
      )))
    }
    wait_seconds(wait)
  }
}

# The batch's results by custom_id; NULL (the pending file stays) when they
# could not be read.
read_efficacy_batch_results <- function(batch_id,
                                        poll_seconds,
                                        batch_status = claude_batch_status,
                                        batch_results = claude_batch_results,
                                        pending_name = "pending-batch.json") {
  results_url <- wait_for_efficacy_batch(
    batch_id, poll_seconds, batch_status, pending_name
  )
  if (is.null(results_url)) {
    return(NULL)
  }
  if (is.na(results_url)) {
    cli::cli_warn("Batch {batch_id} ended without results.")
    return(list())
  }
  results <- tryCatch(
    batch_results(results_url),
    error = function(error) {
      cli::cli_warn(c(
        "Could not read the results of batch {batch_id}:
        {conditionMessage(error)}",
        i = "It stays in {.path {pending_name}}; the next run collects it."
      ))
      NULL
    }
  )
  if (is.null(results)) {
    return(NULL)
  }
  stats::setNames(results, purrr::map_chr(results, "custom_id"))
}

# Outcomes of the submitted products, and whether the batch is still pending.
collect_efficacy_batch <- function(batch_id,
                                   submissions,
                                   model,
                                   poll_seconds,
                                   today) {
  results <- read_efficacy_batch_results(batch_id, poll_seconds)
  if (is.null(results)) {
    return(list(outcomes = list(), pending = TRUE))
  }
  outcomes <- purrr::map(submissions, function(submission) {
    efficacy_outcome(submission, results[[submission$custom_id]], model, today)
  })
  list(outcomes = outcomes, pending = FALSE)
}

combine_efficacy_run <- function(records, collected) {
  outcomes <- collected$outcomes
  list(
    rows = dplyr::bind_rows(
      empty_efficacy_rows(),
      purrr::map(outcomes, "rows")
    ),
    extractions = dplyr::bind_rows(
      empty_efficacy_extractions(),
      records,
      purrr::map(outcomes, "extraction")
    ),
    failed_rows = dplyr::bind_rows(
      empty_failed_efficacy_rows(),
      purrr::map(outcomes, "failed_rows")
    ),
    pending = collected$pending
  )
}

extract_efficacy_batch <- function(plan,
                                   model,
                                   poll_seconds = 60,
                                   today = Sys.Date(),
                                   pending_path = efficacy_pending_path) {
  nothing <- list(outcomes = list(), pending = FALSE)
  if (nrow(plan) == 0) {
    return(combine_efficacy_run(list(), nothing))
  }
  # Before the slow fetching, not after it.
  claude_api_key()
  prepared <- prepare_efficacy_requests(plan, model, today)
  submissions <- prepared$submissions
  batch_id <- if (length(submissions) > 0) {
    submit_efficacy_batch(submissions, model, pending_path)
  }
  collected <- if (is.null(batch_id)) {
    nothing
  } else {
    collect_efficacy_batch(batch_id, submissions, model, poll_seconds, today)
  }
  combine_efficacy_run(prepared$records, collected)
}

# The sections of a pending batch's products, from the text cache only (never
# EMA: a fetch could fail or bring a changed text). The batch is paid for, so
# a product whose section cannot be read again stops the run before its
# results are collected, the pending file kept.
pending_submissions <- function(pending) {
  plan <- pending$plan
  submissions <- purrr::map(seq_len(nrow(plan)), function(index) {
    plan_row <- plan[index, ]
    pages <- cached_efficacy_pages(plan_row)
    section <- if (!is.null(pages)) slice_smpc_efficacy(pages)
    if (is.null(section) || is.na(section$text)) {
      return(NULL)
    }
    list(
      plan_row = plan_row,
      section = section,
      custom_id = efficacy_custom_id(plan_row$ema_product_number)
    )
  })
  missing <- plan$ema_product_number[purrr::map_lgl(submissions, is.null)]
  if (length(missing) > 0) {
    cli::cli_abort(c(
      "Batch {pending$batch_id}: no cached section 5.1 for {.val {missing}}
      in {.path {efficacy_text_cache}}; its results are not collected.",
      i = "The pending file stays. Restore the cached texts and run again;
      its results stay in the Anthropic Console (https://console.anthropic.com)
      for 29 days."
    ))
  }
  submissions
}

resume_efficacy_batch <- function(pending, poll_seconds, today = Sys.Date()) {
  claude_api_key()
  cli::cli_inform(
    "Collecting batch {pending$batch_id} ({pending$model}, created
    {pending$created}) before planning anything new."
  )
  submissions <- pending_submissions(pending)
  collected <- collect_efficacy_batch(
    pending$batch_id, submissions, pending$model, poll_seconds, today
  )
  combine_efficacy_run(list(), collected)
}
