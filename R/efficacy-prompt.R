# The request asking Claude for a medicine's pivotal efficacy results from its
# SmPC section 5.1, and the parsing of its answer. Structured output keeps the
# answer to the row schema; the verifier (efficacy-verify.R) then checks every
# row against the text.

nullable <- function(type) {
  list(type = list(type, "null"))
}

string_enum <- function(...) {
  list(type = "string", enum = list(...))
}

efficacy_row_properties <- function() {
  list(
    indication = nullable("string"),
    trial = list(type = "string"),
    population = nullable("string"),
    population_match = string_enum(
      "whole_trial_matches", "subgroup_matches", "whole_trial_broader",
      "other", "not_stated"
    ),
    regimen = nullable("string"),
    comparator = nullable("string"),
    comparator_column_label = nullable("string"),
    n_treatment = nullable("integer"),
    n_control = nullable("integer"),
    endpoint = list(type = "string"),
    assessment = nullable("string"),
    is_primary = nullable("boolean"),
    analysis_role = string_enum(
      "primary", "later", "exploratory", "not_stated"
    ),
    analysis = nullable("string"),
    effect_type = string_enum(
      "hr", "hr_noninferiority", "rate_difference", "single_arm_rate",
      "single_arm_median"
    ),
    value = nullable("string"),
    ci_low = nullable("string"),
    ci_high = nullable("string"),
    ci_level = nullable("number"),
    ci_is_range = list(type = "boolean"),
    p_value = nullable("string"),
    significance_stated = nullable("string"),
    arm_treatment = nullable("string"),
    arm_control = nullable("string"),
    arm_measure = nullable("string"),
    quotes = list(type = "array", items = list(type = "string"))
  )
}

efficacy_row_schema <- function() {
  properties <- efficacy_row_properties()
  list(
    type = "object",
    properties = list(rows = list(
      type = "array",
      items = list(
        type = "object",
        properties = properties,
        required = as.list(names(properties)),
        additionalProperties = FALSE
      )
    )),
    required = list("rows"),
    additionalProperties = FALSE
  )
}

efficacy_system_prompt <- function() {
  paste(
    "You extract the results of pivotal efficacy trials from section 5.1 of",
    "an EU Summary of Product Characteristics (SmPC). Report only what the",
    "text states; never add trial names, numbers or populations from memory.",
    "Use null for anything the text does not state (for example is_primary",
    "when the text never names the primary endpoint).",
    "For each trial supporting an indication, give one row per endpoint and",
    "analysis the text reports: the primary endpoint first, then overall",
    "survival, then other secondary endpoints. When the text gives both the",
    "whole-trial result and a subgroup that matches the EU indication, give",
    "both rows and set population_match on each. When a trial reports several",
    "analyses (interim, final, updated), give each and set analysis_role.",
    "Numbers exactly as printed, including their decimals, 'NR' or 'NE'.",
    "Give ci_level as printed (95, 97.38 ...); set ci_is_range when the text",
    "says the bracketed numbers are a range, not a confidence interval. Copy",
    "significance_stated only from the text's own words; a confidence",
    "interval excluding 1 is not a statement of significance.",
    "In tables, check which column is the medicine and which the comparator",
    "from the column headers; copy the comparator's header into",
    "comparator_column_label. Each row needs 1 to 3 verbatim quotes of at",
    "most 50 words that together contain every number you give, the value",
    "with its confidence interval in one quote. indication: the EU",
    "indication the row supports, copied from the indications given. Give no",
    "rows when section 5.1 reports no efficacy trial."
  )
}

efficacy_request_params <- function(medicine_name,
                                    indication_text,
                                    section_text,
                                    model,
                                    effort = "high") {
  content <- paste0(
    "Medicine: ", medicine_name, "\n\n",
    "EU indications (section 4.1):\n", indication_text, "\n\n",
    "Section 5.1:\n", section_text
  )
  list(
    model = model,
    max_tokens = 16000L,
    system = list(list(
      type = "text",
      text = efficacy_system_prompt(),
      cache_control = list(type = "ephemeral")
    )),
    output_config = list(
      effort = effort,
      format = list(type = "json_schema", schema = efficacy_row_schema())
    ),
    messages = list(list(role = "user", content = content))
  )
}

efficacy_response_failure <- function(status, reason) {
  list(status = status, rows = list(), reason = reason)
}

parse_efficacy_response <- function(message) {
  if (identical(message$stop_reason, "refusal")) {
    return(efficacy_response_failure("refusal", "refusal"))
  }
  if (identical(message$stop_reason, "max_tokens")) {
    return(efficacy_response_failure("truncated", "max_tokens"))
  }
  texts <- purrr::keep(
    message$content,
    function(block) identical(block$type, "text")
  )
  if (length(texts) == 0) {
    return(efficacy_response_failure("invalid", "no text block"))
  }
  answer <- tryCatch(
    jsonlite::fromJSON(texts[[1]]$text, simplifyVector = FALSE),
    error = function(error) NULL
  )
  if (!is.list(answer) || !is.list(answer$rows)) {
    return(efficacy_response_failure("invalid", "not the row schema"))
  }
  list(status = "ok", rows = answer$rows, reason = NA_character_)
}
