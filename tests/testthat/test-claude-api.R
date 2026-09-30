results_fixture <- function() {
  path <- testthat::test_path(
    "fixtures", "efficacy", "batch-results-sample.jsonl"
  )
  readBin(path, "raw", n = file.size(path))
}

results_response <- function(lines) {
  httr2::response(status_code = 200, body = charToRaw(lines))
}

test_that("a missing API key stops with a hint, never the key", {
  withr::local_envvar(ANTHROPIC_API_KEY = "")
  expect_error(claude_api_key(), ".Renviron")
})

test_that("the API key is read from the environment", {
  withr::local_envvar(ANTHROPIC_API_KEY = "test-key")
  expect_equal(claude_api_key(), "test-key")
})

test_that("a request carries the version header and redacts the key", {
  request <- claude_request("messages", key = "test-key")
  expect_equal(request$url, "https://api.anthropic.com/v1/messages")
  expect_equal(request$headers$`anthropic-version`, "2023-06-01")
  expect_false(any(grepl("test-key", utils::capture.output(print(request)))))
})

test_that("a batch is created with its requests and the API version header", {
  withr::local_envvar(ANTHROPIC_API_KEY = "test-key")
  seen <- NULL
  httr2::local_mocked_responses(function(req) {
    seen <<- req
    httr2::response_json(
      body = list(id = "msgbatch_1", processing_status = "in_progress")
    )
  })
  id <- create_claude_batch(list(list(
    custom_id = "EMEA-H-C-004164",
    params = list(model = "claude-sonnet-5-5")
  )))
  expect_equal(id, "msgbatch_1")
  expect_equal(seen$headers$`anthropic-version`, "2023-06-01")
  expect_match(seen$url, "messages/batches$")
  sent <- seen$body$data
  expect_equal(sent$requests[[1]]$custom_id, "EMEA-H-C-004164")
  expect_equal(sent$requests[[1]]$params$model, "claude-sonnet-5-5")
})

test_that("a single message is posted and returned as a list", {
  withr::local_envvar(ANTHROPIC_API_KEY = "test-key")
  seen <- NULL
  httr2::local_mocked_responses(function(req) {
    seen <<- req
    httr2::response_json(body = list(id = "msg_1", type = "message"))
  })
  message <- send_claude_message(list(model = "claude-sonnet-5-5"))
  expect_equal(message$id, "msg_1")
  expect_match(seen$url, "/messages$")
})

test_that("an HTTP error names its status and message, never the key", {
  withr::local_envvar(ANTHROPIC_API_KEY = "test-key")
  httr2::local_mocked_responses(function(req) {
    httr2::response_json(
      status_code = 429,
      body = list(
        error = list(type = "rate_limit_error", message = "Slow down")
      )
    )
  })
  error <- expect_error(send_claude_message(list()), "429")
  expect_match(conditionMessage(error), "Slow down")
  expect_no_match(conditionMessage(error), "test-key")
})

test_that("an error body without JSON still stops with its status", {
  withr::local_envvar(ANTHROPIC_API_KEY = "test-key")
  httr2::local_mocked_responses(function(req) {
    httr2::response(status_code = 502, body = charToRaw("Bad gateway"))
  })
  expect_error(send_claude_message(list()), "502")
})

test_that("batch status gives the state and the results URL when ended", {
  withr::local_envvar(ANTHROPIC_API_KEY = "test-key")
  seen <- NULL
  httr2::local_mocked_responses(function(req) {
    seen <<- req
    httr2::response_json(body = list(
      id = "msgbatch_1",
      processing_status = "ended",
      results_url = paste0(
        "https://api.anthropic.com/v1/messages/batches/msgbatch_1/results"
      )
    ))
  })
  status <- claude_batch_status("msgbatch_1")
  expect_match(seen$url, "messages/batches/msgbatch_1$")
  expect_equal(status$status, "ended")
  expect_match(status$results_url, "/results$")
})

test_that("batch status has no results URL while in progress", {
  withr::local_envvar(ANTHROPIC_API_KEY = "test-key")
  httr2::local_mocked_responses(function(req) {
    httr2::response(
      status_code = 200,
      headers = list(`content-type` = "application/json"),
      body = charToRaw(paste0(
        '{"id":"msgbatch_1","processing_status":"in_progress",',
        '"results_url":null}'
      ))
    )
  })
  status <- claude_batch_status("msgbatch_1")
  expect_equal(status$status, "in_progress")
  expect_true(is.na(status$results_url))
})

test_that("batch results are read line by line, keyed by custom_id", {
  withr::local_envvar(ANTHROPIC_API_KEY = "test-key")
  seen <- NULL
  httr2::local_mocked_responses(function(req) {
    seen <<- req
    httr2::response(status_code = 200, body = results_fixture())
  })
  results <- claude_batch_results(
    "https://api.anthropic.com/v1/messages/batches/msgbatch_1/results"
  )
  expect_equal(seen$headers$`anthropic-version`, "2023-06-01")
  expect_setequal(
    purrr::map_chr(results, "type"),
    c("succeeded", "errored", "expired")
  )
  expect_setequal(
    purrr::map_chr(results, "custom_id"),
    c("EMEA-H-C-004164", "EMEA-H-C-005001", "EMEA-H-C-006002")
  )
  succeeded <- purrr::keep(results, function(result) {
    result$type == "succeeded"
  })[[1]]
  expect_equal(parse_efficacy_response(succeeded$message)$status, "ok")
  errored <- purrr::keep(results, function(result) {
    result$type == "errored"
  })[[1]]
  expect_equal(errored$error, "invalid_request_error")
  expect_null(errored$message)
})

test_that("an errored line with a flat or missing error type is read", {
  withr::local_envvar(ANTHROPIC_API_KEY = "test-key")
  lines <- paste(
    paste0(
      '{"custom_id":"a","result":{"type":"errored",',
      '"error":{"type":"overloaded_error"}}}'
    ),
    '{"custom_id":"b","result":{"type":"errored"}}',
    "",
    '{"custom_id":"c","result":{"type":"canceled"}}',
    sep = "\n"
  )
  httr2::local_mocked_responses(function(req) results_response(lines))
  results <- claude_batch_results("https://api.anthropic.com/v1/x/results")
  expect_equal(purrr::map_chr(results, "custom_id"), c("a", "b", "c"))
  expect_equal(results[[1]]$error, "overloaded_error")
  expect_equal(results[[2]]$error, "errored")
  expect_equal(results[[3]]$type, "canceled")
})

test_that("a failed results download stops with its status", {
  withr::local_envvar(ANTHROPIC_API_KEY = "test-key")
  httr2::local_mocked_responses(function(req) {
    httr2::response(status_code = 404, body = charToRaw("not found"))
  })
  expect_error(
    claude_batch_results("https://api.anthropic.com/v1/x/results"),
    "404"
  )
})
