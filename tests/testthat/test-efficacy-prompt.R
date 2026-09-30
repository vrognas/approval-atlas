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

sample_answer <- function() {
  jsonlite::fromJSON(
    sample_message()$content[[1]]$text,
    simplifyVector = FALSE
  )
}

message_with_answer <- function(answer) {
  list(
    stop_reason = "end_turn",
    content = list(list(
      type = "text",
      text = as.character(jsonlite::toJSON(answer, auto_unbox = TRUE))
    ))
  )
}

# The sample's first row with some fields replaced, as a whole response.
answer_with <- function(...) {
  row <- sample_answer()$rows[[1]]
  changes <- list(...)
  row[names(changes)] <- changes
  message_with_answer(list(rows = list(row)))
}

count_union_types <- function(node) {
  if (!is.list(node)) {
    return(0L)
  }
  own <- if (length(node$type) > 1L) 1L else 0L
  own + sum(vapply(node, count_union_types, integer(1)))
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

test_that("the schema has no union types (the API allows 16)", {
  schema <- efficacy_row_schema()
  expect_equal(count_union_types(schema), 0L)
  expect_lte(count_union_types(schema), 16L)
})

test_that("absent text is an empty string and numbers are strings", {
  properties <- efficacy_row_schema()$properties$rows$items$properties
  expect_equal(properties$comparator$type, "string")
  expect_equal(properties$n_control$type, "string")
  expect_equal(properties$n_treatment$type, "string")
  expect_equal(properties$ci_level$type, "string")
  expect_equal(properties$trial$type, "string")
  expect_equal(properties$ci_is_range$type, "boolean")
  expect_equal(properties$quotes$type, "array")
  expect_equal(properties$quotes$minItems, 1L)
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
  expect_equal(
    unlist(properties$is_primary$enum),
    c("yes", "no", "not_stated")
  )
})

test_that("required lists and enums survive JSON as arrays", {
  json <- as.character(
    jsonlite::toJSON(efficacy_row_schema(), auto_unbox = TRUE)
  )
  expect_match(json, "\"required\":[\"rows\"]", fixed = TRUE)
  expect_match(json, "\"enum\":[\"yes\",\"no\",\"not_stated\"]", fixed = TRUE)
  expect_match(json, "\"minItems\":1", fixed = TRUE)
  expect_match(json, "\"additionalProperties\":false", fixed = TRUE)
  parsed <- jsonlite::fromJSON(json, simplifyVector = FALSE)
  row <- parsed$properties$rows$items
  expect_type(row$required, "list")
  expect_length(row$required, length(row$properties))
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

test_that("the system prompt is one text block without a cache marker", {
  system <- sample_params()$system
  expect_length(system, 1)
  expect_equal(system[[1]]$type, "text")
  expect_equal(system[[1]]$text, efficacy_system_prompt())
  expect_null(system[[1]]$cache_control)
})

test_that("the effort and the token limit can be changed", {
  expect_equal(sample_params(effort = "medium")$output_config$effort, "medium")
  expect_equal(sample_params()$max_tokens, 16000L)
  expect_equal(sample_params(max_tokens = 32000L)$max_tokens, 32000L)
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
  expect_match(
    prompt,
    "Copy population, regimen and comparator verbatim from the text",
    fixed = TRUE
  )
  expect_match(prompt, "the arm sizes (n_treatment, n_control)", fixed = TRUE)
  expect_match(prompt, "the same quote as arm_control", fixed = TRUE)
})

test_that("text that is only spaces is not stated", {
  row <- parse_efficacy_response(answer_with(
    population = "   ", comparator = "\n", value = " 0.24 "
  ))$rows[[1]]
  expect_null(row$population)
  expect_null(row$comparator)
  expect_equal(row$value, " 0.24 ")
})

test_that("the system prompt defines every enum value and the empty cases", {
  prompt <- efficacy_system_prompt()
  has <- function(phrase) expect_match(prompt, phrase, fixed = TRUE)
  has("whole_trial_matches when the whole trial population is the EU")
  has("subgroup_matches when this row is a subgroup that matches the EU")
  has("whole_trial_broader when the whole trial is broader than the")
  has("not_stated when the text does not let you tell")
  has("primary for the pre-specified primary analysis")
  has("later for a later or updated analysis of the same endpoint")
  has("(odds ratio, mean difference, landmark rate")
  has("is left out")
  has("never paraphrased")
  has("\"\" when no given indication applies")
  has("and the arm values (arm_treatment, arm_control) must appear inside")
  has("For every field the text does not state, use \"\"")
  has("Never estimate.")
})

test_that("a successful response parses into rows", {
  parsed <- parse_efficacy_response(sample_message())
  expect_equal(parsed$status, "ok")
  expect_length(parsed$rows, 2)
  expect_length(parsed$dropped, 0)
  expect_true(is.na(parsed$reason))
  expect_equal(parsed$rows[[1]]$trial, "ALINA (BO40336)")
  expect_equal(parsed$rows[[2]]$comparator_column_label, "Crizotinib")
  expect_length(parsed$rows[[1]]$quotes, 3)
})

test_that("empty text becomes NULL and numbers and is_primary are typed", {
  row <- parse_efficacy_response(sample_message())$rows[[1]]
  expect_null(row$comparator_column_label)
  expect_null(row$significance_stated)
  expect_identical(row$n_treatment, 116L)
  expect_identical(row$n_control, 115L)
  expect_identical(row$ci_level, 95)
  expect_true(row$is_primary)
  expect_equal(row$value, "0.24")
})

test_that("the parsed rows keep exactly the schema's fields", {
  properties <- efficacy_row_schema()$properties$rows$items$properties
  rows <- parse_efficacy_response(sample_message())$rows
  for (row in rows) {
    expect_setequal(names(row), names(properties))
  }
})

test_that("n and the confidence level are read as printed", {
  parsed <- parse_efficacy_response(answer_with(
    n_treatment = "1 274",
    n_control = "1 102",
    ci_level = "97.38"
  ))
  expect_identical(parsed$rows[[1]]$n_treatment, 1274L)
  expect_identical(parsed$rows[[1]]$n_control, 1102L)
  expect_identical(parsed$rows[[1]]$ci_level, 97.38)
  thin <- parse_efficacy_response(answer_with(n_treatment = "1 274"))
  expect_identical(thin$rows[[1]]$n_treatment, 1274L)
  commas <- parse_efficacy_response(answer_with(n_treatment = "1,274"))
  expect_identical(commas$rows[[1]]$n_treatment, 1274L)
})

test_that("empty numbers are NULL", {
  row <- parse_efficacy_response(answer_with(
    n_control = "", ci_level = ""
  ))$rows[[1]]
  expect_null(row$n_control)
  expect_null(row$ci_level)
})

test_that("is_primary maps yes, no and not_stated", {
  is_primary <- function(value) {
    parsed <- parse_efficacy_response(answer_with(is_primary = value))
    parsed$rows[[1]]$is_primary
  }
  expect_true(is_primary("yes"))
  expect_false(is_primary("no"))
  expect_true(is.na(is_primary("not_stated")))
  expect_length(
    parse_efficacy_response(answer_with(is_primary = "maybe"))$rows, 0
  )
})

test_that("a row with an unreadable number is dropped with its reason", {
  answer <- sample_answer()
  answer$rows[[2]]$n_control <- "about 150"
  parsed <- parse_efficacy_response(message_with_answer(answer))
  expect_equal(parsed$status, "ok")
  expect_length(parsed$rows, 1)
  expect_equal(parsed$rows[[1]]$trial, "ALINA (BO40336)")
  expect_length(parsed$dropped, 1)
  expect_equal(parsed$dropped[[1]]$index, 2L)
  expect_match(parsed$dropped[[1]]$reason, "n_control", fixed = TRUE)
  expect_match(parsed$reason, "1 of 2 rows dropped: row 2", fixed = TRUE)
})

test_that("counts and levels that are not plain numbers are dropped", {
  rows_kept <- function(...) {
    length(parse_efficacy_response(answer_with(...))$rows)
  }
  expect_equal(rows_kept(ci_level = "95%"), 0L)
  expect_equal(rows_kept(n_treatment = "12.5"), 0L)
  expect_equal(rows_kept(n_treatment = "99999999999"), 0L)
})

test_that("a row with a field that is not a string is dropped", {
  parsed <- parse_efficacy_response(answer_with(n_treatment = 116L))
  expect_length(parsed$rows, 0)
  expect_match(
    parsed$dropped[[1]]$reason, "not a string: n_treatment",
    fixed = TRUE
  )
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
  expect_equal(refusal$reason, "refusal")
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

test_that("a refusal's category is kept in the reason", {
  refusal <- parse_efficacy_response(list(
    stop_reason = "refusal",
    stop_details = list(type = "refusal", category = "cyber"),
    content = list()
  ))
  expect_equal(refusal$status, "refusal")
  expect_equal(refusal$reason, "refusal: cyber")
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
