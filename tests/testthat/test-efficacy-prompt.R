sample_message <- function() {
  jsonlite::fromJSON(
    testthat::test_path("fixtures", "efficacy", "message-response-sample.json"),
    simplifyVector = FALSE
  )
}

sample_params <- function(...) {
  efficacy_request_params(
    "Alecensa",
    "Alecensa as monotherapy is indicated …",
    "5.1 Pharmacodynamic properties …",
    "claude-sonnet-5-5",
    ...
  )
}

test_that("the schema requires every row field and allows no others", {
  schema <- efficacy_row_schema()
  row <- schema$properties$rows$items
  expect_false(row$additionalProperties)
  expect_setequal(unlist(row$required), names(row$properties))
  expect_true(all(
    c(
      "trial", "value", "ci_low", "ci_high", "quotes", "population_match",
      "analysis_role"
    ) %in% names(row$properties)
  ))
})

test_that("the schema makes a field nullable only where the text may not say", {
  properties <- efficacy_row_schema()$properties$rows$items$properties
  expect_equal(properties$comparator$type, list("string", "null"))
  expect_equal(properties$n_control$type, list("integer", "null"))
  expect_equal(properties$is_primary$type, list("boolean", "null"))
  expect_equal(properties$ci_level$type, list("number", "null"))
  expect_equal(properties$trial$type, "string")
  expect_equal(properties$ci_is_range$type, "boolean")
  expect_equal(properties$quotes$type, "array")
})

test_that("the schema lists the allowed enum values", {
  properties <- efficacy_row_schema()$properties$rows$items$properties
  expect_equal(
    unlist(properties$population_match$enum),
    c(
      "whole_trial_matches", "subgroup_matches", "whole_trial_broader",
      "other", "not_stated"
    )
  )
  expect_equal(
    unlist(properties$analysis_role$enum),
    c("primary", "later", "exploratory", "not_stated")
  )
  expect_equal(
    unlist(properties$effect_type$enum),
    c(
      "hr", "hr_noninferiority", "rate_difference", "single_arm_rate",
      "single_arm_median"
    )
  )
})

test_that("the schema serialises to JSON a structured output accepts", {
  json <- jsonlite::toJSON(efficacy_row_schema(), auto_unbox = TRUE)
  parsed <- jsonlite::fromJSON(json, simplifyVector = FALSE)
  row <- parsed$properties$rows$items
  expect_equal(row$properties$comparator$type, list("string", "null"))
  expect_false(row$additionalProperties)
})

test_that("request params carry model, effort, structured output, section", {
  params <- sample_params()
  expect_equal(params$model, "claude-sonnet-5-5")
  expect_equal(params$max_tokens, 16000L)
  expect_equal(params$output_config$effort, "high")
  expect_equal(params$output_config$format$type, "json_schema")
  expect_equal(params$output_config$format$schema, efficacy_row_schema())
  expect_null(params$thinking)
  content <- params$messages[[1]]$content
  expect_equal(params$messages[[1]]$role, "user")
  expect_match(content, "5.1 Pharmacodynamic properties", fixed = TRUE)
  expect_match(content, "Alecensa as monotherapy is indicated", fixed = TRUE)
  expect_match(content, "Medicine: Alecensa", fixed = TRUE)
})

test_that("the system prompt is a cached text block", {
  system <- sample_params()$system
  expect_length(system, 1)
  expect_equal(system[[1]]$type, "text")
  expect_equal(system[[1]]$text, efficacy_system_prompt())
  expect_equal(system[[1]]$cache_control$type, "ephemeral")
})

test_that("the effort can be changed", {
  expect_equal(sample_params(effort = "medium")$output_config$effort, "medium")
})

test_that("the system prompt states the rules the verifier relies on", {
  prompt <- efficacy_system_prompt()
  expect_length(prompt, 1)
  expect_match(prompt, "never add trial names", fixed = TRUE)
  expect_match(prompt, "comparator_column_label", fixed = TRUE)
  expect_match(prompt, "1 to 3 verbatim quotes of at", fixed = TRUE)
  expect_match(prompt, "most 50 words", fixed = TRUE)
  expect_match(prompt, "ci_is_range", fixed = TRUE)
  expect_match(prompt, "not a statement of significance", fixed = TRUE)
})

test_that("a successful response parses into rows", {
  parsed <- parse_efficacy_response(sample_message())
  expect_equal(parsed$status, "ok")
  expect_length(parsed$rows, 2)
  expect_equal(parsed$rows[[1]]$trial, "ALINA (BO40336)")
  expect_equal(parsed$rows[[2]]$comparator_column_label, "Crizotinib")
  expect_null(parsed$rows[[1]]$significance_stated)
  expect_length(parsed$rows[[1]]$quotes, 3)
})

test_that("the parsed rows have exactly the schema's fields", {
  properties <- efficacy_row_schema()$properties$rows$items$properties
  rows <- parse_efficacy_response(sample_message())$rows
  for (row in rows) {
    expect_setequal(names(row), names(properties))
  }
})

test_that("a response with no rows is ok", {
  message <- list(
    stop_reason = "end_turn",
    content = list(list(type = "text", text = "{\"rows\": []}"))
  )
  parsed <- parse_efficacy_response(message)
  expect_equal(parsed$status, "ok")
  expect_length(parsed$rows, 0)
})

test_that("the text block is found among other content blocks", {
  message <- list(
    stop_reason = "end_turn",
    content = list(
      list(type = "thinking", thinking = "..."),
      list(type = "text", text = "{\"rows\": []}")
    )
  )
  expect_equal(parse_efficacy_response(message)$status, "ok")
})

test_that("refusals, truncation and bad JSON are reported, not parsed", {
  refusal <- parse_efficacy_response(
    list(stop_reason = "refusal", content = list())
  )
  expect_equal(refusal$status, "refusal")
  expect_length(refusal$rows, 0)
  truncated <- parse_efficacy_response(
    list(stop_reason = "max_tokens", content = list())
  )
  expect_equal(truncated$status, "truncated")
  bad <- list(
    stop_reason = "end_turn",
    content = list(list(type = "text", text = "{not json"))
  )
  expect_equal(parse_efficacy_response(bad)$status, "invalid")
})

test_that("an answer that is not the row schema is invalid", {
  invalid <- function(text) {
    parse_efficacy_response(list(
      stop_reason = "end_turn",
      content = list(list(type = "text", text = text))
    ))$status
  }
  expect_equal(invalid("{\"other\": []}"), "invalid")
  expect_equal(invalid("{\"rows\": \"none\"}"), "invalid")
  expect_equal(invalid("[1, 2]"), "invalid")
  expect_equal(invalid("null"), "invalid")
  expect_equal(invalid(""), "invalid")
})

test_that("a response without a text block is invalid", {
  no_text <- list(stop_reason = "end_turn", content = list())
  expect_equal(parse_efficacy_response(no_text)$status, "invalid")
  expect_equal(parse_efficacy_response(list())$status, "invalid")
})
