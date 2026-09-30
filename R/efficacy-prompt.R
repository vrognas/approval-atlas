# The request asking Claude for a medicine's pivotal efficacy results from its
# SmPC section 5.1, and the parsing of its answer. Structured output keeps the
# answer to the row schema; the verifier (efficacy-verify.R) then checks every
# row against the text.
#
# The schema has no union types (the API allows at most 16 and answers 400
# "Schema is too complex" beyond that): a field the text does not state is ""
# (text and numbers, which are strings as printed) or "not_stated" (enums), and
# parse_efficacy_response() turns those back into NULL / NA.

text_field <- function() {
  list(type = "string")
}

string_enum <- function(...) {
  list(type = "string", enum = list(...))
}

# Fields whose "" means "the text does not state it".
efficacy_text_fields <- c(
  "indication", "population", "regimen", "comparator",
  "comparator_column_label", "assessment", "analysis", "value", "ci_low",
  "ci_high", "p_value", "significance_stated", "arm_treatment", "arm_control",
  "arm_measure"
)

efficacy_row_properties <- function() {
  list(
    indication = text_field(),
    trial = text_field(),
    population = text_field(),
    population_match = string_enum(
      "whole_trial_matches", "subgroup_matches", "whole_trial_broader",
      "other", "not_stated"
    ),
    regimen = text_field(),
    comparator = text_field(),
    comparator_column_label = text_field(),
    n_treatment = text_field(),
    n_control = text_field(),
    endpoint = text_field(),
    assessment = text_field(),
    is_primary = string_enum("yes", "no", "not_stated"),
    analysis_role = string_enum(
      "primary", "later", "exploratory", "not_stated"
    ),
    analysis = text_field(),
    effect_type = string_enum(
      "hr", "hr_noninferiority", "rate_difference", "single_arm_rate",
      "single_arm_median"
    ),
    value = text_field(),
    ci_low = text_field(),
    ci_high = text_field(),
    ci_level = text_field(),
    ci_is_range = list(type = "boolean"),
    p_value = text_field(),
    significance_stated = text_field(),
    arm_treatment = text_field(),
    arm_control = text_field(),
    arm_measure = text_field(),
    quotes = list(type = "array", items = list(type = "string"), minItems = 1L)
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
    'For every field the text does not state, use "" (an empty string) for',
    "text and number fields and not_stated for the enum fields, for example",
    "is_primary not_stated when the text never names the primary endpoint.",
    "Never estimate.",
    "For each trial supporting an indication, give one row per endpoint and",
    "analysis the text reports: the primary endpoint first, then overall",
    "survival, then other secondary endpoints. When the text gives both the",
    "whole-trial result and a subgroup that matches the EU indication, give",
    "both rows and set population_match on each.",
    "population_match: whole_trial_matches when the whole trial population is",
    "the EU indication; subgroup_matches when this row is a subgroup that",
    "matches the EU indication; whole_trial_broader when the whole trial is",
    "broader than the indication; other; not_stated when the text does not let",
    "you tell.",
    "When a trial reports several analyses (interim, final, updated), give",
    "each and set analysis_role: primary for the pre-specified primary",
    "analysis; later for a later or updated analysis of the same endpoint;",
    "exploratory; not_stated.",
    "effect_type is one of hr, hr_noninferiority, rate_difference,",
    "single_arm_rate, single_arm_median. A result whose effect fits none of",
    "these (odds ratio, mean difference, landmark rate ...) is left out.",
    "Numbers exactly as printed, including their decimals, 'NR' or 'NE'.",
    "n_treatment, n_control and ci_level are numbers as printed, for example",
    "'1 274' or '97.38', or empty when not stated. Give ci_level as printed",
    "(95, 97.38 ...); set ci_is_range when the text says the bracketed",
    "numbers are a range, not a confidence interval. Copy significance_stated",
    "only from the text's own words; a confidence interval excluding 1 is not",
    "a statement of significance.",
    "In tables, check which column is the medicine and which the comparator",
    "from the column headers; copy the comparator's header into",
    "comparator_column_label. comparator_column_label and the arm values",
    "(arm_treatment, arm_control) must appear inside a quote, the label in",
    "the same quote as arm_control.",
    "Each row needs 1 to 3 verbatim quotes of at most 50 words that together",
    "contain every number you give, the arm sizes (n_treatment, n_control)",
    "included, the value with its confidence interval in one quote.",
    "Copy population, regimen and comparator verbatim from the text, as",
    "printed; never summarise or reword them.",
    "indication: the EU indication the row supports, copied exactly from the",
    'indications given, never paraphrased; "" when no given indication',
    "applies. Give no rows when section 5.1 reports no efficacy trial."
  )
}

# The system prompt is below the minimum prefix the API caches, so it carries
# no cache_control marker: claiming a cache here would be wrong.
efficacy_request_params <- function(medicine_name,
                                    indication_text,
                                    section_text,
                                    model,
                                    effort = "high",
                                    max_tokens = 16000L) {
  content <- paste0(
    "Medicine: ", medicine_name, "\n\n",
    "EU indications (section 4.1):\n", indication_text, "\n\n",
    "Section 5.1:\n", section_text
  )
  list(
    model = model,
    max_tokens = max_tokens,
    system = list(list(type = "text", text = efficacy_system_prompt())),
    output_config = list(
      effort = effort,
      format = list(type = "json_schema", schema = efficacy_row_schema())
    ),
    messages = list(list(role = "user", content = content))
  )
}

efficacy_response_failure <- function(status, reason) {
  list(status = status, rows = list(), reason = reason, dropped = list())
}

# NULL when empty, NA when what is printed is not a number.
parse_efficacy_count <- function(text) {
  if (identical(text, "")) {
    return(NULL)
  }
  digits <- gsub("[    ,]", "", text)
  if (!grepl("^[0-9]+$", digits)) {
    return(NA_integer_)
  }
  suppressWarnings(as.integer(digits))
}

parse_efficacy_ci_level <- function(text) {
  if (identical(text, "")) {
    return(NULL)
  }
  if (!grepl("^[0-9]+(\\.[0-9]+)?$", text)) {
    return(NA_real_)
  }
  as.numeric(text)
}

parse_efficacy_is_primary <- function(text) {
  switch(text,
    yes = TRUE,
    no = FALSE,
    not_stated = NA,
    NULL
  )
}

# One answered row back to its downstream form: "" and not_stated become NULL
# and NA, counts and the confidence level become numbers. A row that cannot be
# turned back is dropped with its reason, never guessed.
normalise_efficacy_row <- function(row) {
  dropped <- function(reason) list(row = NULL, reason = reason)
  string_fields <- c(
    efficacy_text_fields, "n_treatment", "n_control", "ci_level", "is_primary"
  )
  if (!is.list(row)) {
    return(dropped("the row is not an object"))
  }
  not_string <- purrr::discard(string_fields, function(field) {
    is.character(row[[field]]) && length(row[[field]]) == 1L
  })
  if (length(not_string) > 0) {
    return(dropped(paste("not a string:", paste(not_string, collapse = ", "))))
  }
  # Only spaces is as good as "": nothing stated.
  empty <- efficacy_text_fields[
    purrr::map_lgl(efficacy_text_fields, \(field) trimws(row[[field]]) == "")
  ]
  numbers <- list(
    n_treatment = parse_efficacy_count(row$n_treatment),
    n_control = parse_efficacy_count(row$n_control),
    ci_level = parse_efficacy_ci_level(row$ci_level)
  )
  is_primary <- parse_efficacy_is_primary(row$is_primary)
  unreadable <- c(
    names(numbers)[purrr::map_lgl(numbers, function(number) {
      !is.null(number) && is.na(number)
    })],
    if (is.null(is_primary)) "is_primary"
  )
  if (length(unreadable) > 0) {
    return(dropped(paste("cannot read:", paste(unreadable, collapse = ", "))))
  }
  row[empty] <- list(NULL)
  row[names(numbers)] <- numbers
  row["is_primary"] <- list(is_primary)
  list(row = row, reason = NA_character_)
}

refusal_reason <- function(message) {
  category <- message$stop_details$category
  if (is.character(category) && length(category) == 1L) {
    return(paste0("refusal: ", category))
  }
  "refusal"
}

parse_efficacy_response <- function(message) {
  if (identical(message$stop_reason, "refusal")) {
    return(efficacy_response_failure("refusal", refusal_reason(message)))
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
  normalised <- purrr::map(answer$rows, normalise_efficacy_row)
  kept <- purrr::map_lgl(normalised, function(result) !is.null(result$row))
  dropped <- purrr::map2(
    which(!kept),
    normalised[!kept],
    function(index, result) list(index = index, reason = result$reason)
  )
  reason <- if (length(dropped) > 0) {
    paste0(
      length(dropped), " of ", length(kept), " rows dropped: ",
      paste0(
        "row ", purrr::map_int(dropped, "index"), " (",
        purrr::map_chr(dropped, "reason"), ")",
        collapse = "; "
      )
    )
  } else {
    NA_character_
  }
  list(
    status = "ok",
    rows = purrr::map(normalised[kept], "row"),
    reason = reason,
    dropped = dropped
  )
}
