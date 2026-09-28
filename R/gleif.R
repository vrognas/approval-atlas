# GLEIF (Legal Entity Identifier register, CC0) for company provenance: an
# on-demand script (scripts/match-gleif.R, run_gleif_matching()) matches
# the companies' holder names to LEI records and writes a committed file,
# which the daily pipeline reads (no GLEIF requests in CI). Only reviewed
# matches, or matches of confidence >= 0.95 by rule (is_auto_gleif_match():
# the exact name, or the same name without its legal form in the holder's
# country), that agree with the curated groups are applied; the rest are
# for review.
gleif_api_url <- "https://api.gleif.org/api/v1/"
gleif_matches_path <- "data-raw/gleif-holder-matches.json"
gleif_auto_confidence <- 0.95
gleif_review_confidence <- 0.5

gleif_match_columns <- c(
  holder = "character",
  country_hint = "character",
  method = "character",
  confidence = "numeric",
  lei = "character",
  legal_name = "character",
  matched_name = "character",
  lei_country = "character",
  entity_status = "character",
  registration_status = "character",
  ultimate_parent_lei = "character",
  ultimate_parent_name = "character",
  ultimate_parent_registration_status = "character",
  ultimate_parent_exception = "character",
  why = "character",
  reviewed = "logical",
  retrieved = "character",
  source = "character"
)

# Reporting exceptions that make an entity the top of its own group; the
# others (NON_PUBLIC, NO_LEI) leave the parent unknown.
gleif_self_top_reasons <- c(
  "NON_CONSOLIDATING",
  "NO_KNOWN_PERSON",
  "NATURAL_PERSONS"
)

# Name matches; "stem_top_entity" rows (a brand-stem search for group top
# entities) are hints for review only.
gleif_name_methods <- c("exact", "core", "holder_name_within", "sibling")

empty_gleif_matches <- function() {
  columns <- purrr::map(gleif_match_columns, function(type) vector(type))
  dplyr::as_tibble(columns)
}

read_gleif_matches <- function(path = gleif_matches_path) {
  if (!file.exists(path)) {
    cli::cli_abort(c(
      "The GLEIF matches file {.path {path}} is missing.",
      i = "Run {.code Rscript scripts/match-gleif.R} to create it."
    ))
  }
  rows <- jsonlite::fromJSON(path)
  if (length(rows) == 0) {
    return(empty_gleif_matches())
  }
  missing_columns <- setdiff(names(gleif_match_columns), names(rows))
  if (length(missing_columns) > 0) {
    cli::cli_abort(c(
      "The GLEIF matches file lacks columns.",
      x = "{.val {offender_values(missing_columns)}}"
    ))
  }
  # A column that is null in every row reads as logical.
  casts <- list(
    character = as.character,
    numeric = as.numeric,
    logical = as.logical
  )
  columns <- purrr::imap(gleif_match_columns, function(type, column) {
    casts[[type]](rows[[column]])
  })
  dplyr::as_tibble(columns)
}

# Per match: the company, its group's top entity, and whether it is
# applied: confident, and not contradicting the company's curated group
# (its top entity is another curated group's, or the group's LEI is known
# and neither it nor the group's GLEIF parent is the top entity).
judge_gleif_matches <- function(matches, company_keys, groups, memberships,
                                aliases) {
  group_leis <- dplyr::select(
    groups,
    "group_key",
    group_lei = "lei",
    group_parent_lei = "gleif_ultimate_parent_lei"
  )
  lei_groups <- dplyr::bind_rows(
    dplyr::select(groups, top_group_key = "group_key", top_lei = "lei"),
    dplyr::select(
      groups,
      top_group_key = "group_key",
      top_lei = "gleif_ultimate_parent_lei"
    )
  ) |>
    dplyr::filter(!is.na(.data$top_lei)) |>
    dplyr::distinct(.data$top_lei, .keep_all = TRUE)
  matches |>
    dplyr::mutate(
      is_auto = is_auto_gleif_match(matches),
      company_match = aliased_company_key(.data$holder, aliases),
      is_self_top = .data$ultimate_parent_exception %in%
        gleif_self_top_reasons,
      top_lei = dplyr::case_when(
        !is.na(.data$ultimate_parent_lei) ~ .data$ultimate_parent_lei,
        .data$is_self_top ~ .data$lei,
        .default = NA_character_
      ),
      top_name = dplyr::case_when(
        !is.na(.data$ultimate_parent_lei) ~ .data$ultimate_parent_name,
        .data$is_self_top ~ .data$legal_name,
        .default = NA_character_
      ),
      is_lapsed = .data$registration_status %in% "LAPSED" |
        (!is.na(.data$ultimate_parent_lei) &
           .data$ultimate_parent_registration_status %in% "LAPSED")
    ) |>
    dplyr::filter(.data$company_match %in% company_keys) |>
    dplyr::left_join(
      memberships,
      by = "company_match",
      relationship = "many-to-one"
    ) |>
    dplyr::left_join(
      group_leis,
      by = "group_key",
      relationship = "many-to-one"
    ) |>
    dplyr::left_join(
      lei_groups,
      by = "top_lei",
      relationship = "many-to-one"
    ) |>
    dplyr::mutate(
      agrees = is_same_lei(.data$top_lei, .data$group_lei) |
        is_same_lei(.data$top_lei, .data$group_parent_lei) |
        is_same_lei(.data$lei, .data$group_lei),
      contradicts = !is.na(.data$group_key) & !is.na(.data$top_lei) &
        !.data$agrees &
        (!is.na(.data$group_lei) | !is.na(.data$group_parent_lei) |
           !is.na(.data$top_group_key)),
      is_confident = !is.na(.data$lei) &
        .data$method %in% gleif_name_methods &
        (.data$reviewed %in% TRUE | .data$is_auto),
      applied = .data$is_confident & !.data$contradicts
    )
}

# Matches applied without review, by rule, not by score alone (shared
# words add to the score): the exact name of an active entity, but not a
# former name of a lapsed record, or the same name without legal form of an
# active entity in the holder's country; and confidence >= 0.95.
is_auto_gleif_match <- function(matches) {
  is_stale_other_name <- (matches$matched_name != matches$legal_name) %in%
    TRUE & matches$registration_status %in% "LAPSED"
  in_holder_country <- (matches$lei_country == matches$country_hint) %in% TRUE
  !is.na(matches$lei) &
    matches$entity_status %in% "ACTIVE" &
    matches$confidence >= gleif_auto_confidence &
    ((matches$method %in% "exact" & !is_stale_other_name) |
       (matches$method %in% "core" & in_holder_country))
}

is_same_lei <- function(a, b) {
  (a == b) %in% TRUE
}

# One applied match per company (the most confident), with the curated
# group whose LEI is its top entity when the company has no curated group.
# A lapsed registration's parent may be stale (Sandoz GmbH still names
# Novartis AG): its LEI is kept, its parent neither shown nor used.
applied_gleif_matches <- function(judged, groups) {
  group_by_lei <- dplyr::bind_rows(
    dplyr::select(groups, "group_key", top_lei = "lei"),
    dplyr::select(groups, "group_key", top_lei = "gleif_ultimate_parent_lei")
  ) |>
    dplyr::filter(!is.na(.data$top_lei)) |>
    dplyr::distinct(.data$top_lei, .keep_all = TRUE) |>
    dplyr::rename(gleif_group_key = "group_key")
  judged |>
    dplyr::filter(.data$applied) |>
    dplyr::arrange(
      .data$company_match,
      dplyr::desc(.data$confidence),
      .data$lei
    ) |>
    dplyr::distinct(.data$company_match, .keep_all = TRUE) |>
    dplyr::left_join(
      group_by_lei,
      by = "top_lei",
      relationship = "many-to-one"
    ) |>
    dplyr::mutate(
      gleif_group_key = dplyr::if_else(
        is.na(.data$group_key) & !.data$is_lapsed,
        .data$gleif_group_key,
        NA_character_
      ),
      top_lei = dplyr::if_else(.data$is_lapsed, NA_character_, .data$top_lei),
      top_name = dplyr::if_else(.data$is_lapsed, NA_character_, .data$top_name)
    ) |>
    dplyr::select(
      "company_match",
      "lei",
      gleif_legal_name = "legal_name",
      gleif_ultimate_parent_lei = "top_lei",
      gleif_ultimate_parent = "top_name",
      "gleif_group_key"
    )
}

# ---- On-demand matching (scripts/match-gleif.R) ----

# GLEIF allows 60 requests a minute; its own throttle realm. Cached
# responses older than `gleif_max_age_days` are fetched again.
gleif_spacing_seconds <- 1.2
gleif_default_budget <- 170L
gleif_max_age_days <- 30

# One matching run's request state: its budget, how old a cached response
# may be (Inf: never refetch), today, and the dates of the responses used.
gleif_state <- function(budget = gleif_default_budget,
                        max_age_days = gleif_max_age_days,
                        today = Sys.Date()) {
  state <- new.env()
  state$requests <- 0L
  state$budget <- budget
  state$max_age_days <- max_age_days
  state$today <- as.Date(today)
  state$retrieved <- as.Date(character())
  state
}

gleif_request <- function(url) {
  throttled_request(
    url,
    spacing_seconds = gleif_spacing_seconds,
    realm = "api.gleif.org"
  ) |>
    httr2::req_headers(Accept = "application/vnd.api+json")
}

# Spaces must be %20: with "+" the API silently finds nothing. Commas
# separate names, so a name's own commas become spaces.
gleif_query_value <- function(name) {
  name |>
    stringr::str_replace_all(",", " ") |>
    stringr::str_squish() |>
    utils::URLencode(reserved = TRUE)
}

# lei-records by names ("contains", any of them), or by LEIs; with the
# ultimate parent (or its reporting exception) in the same response.
gleif_records_url <- function(names = NULL,
                              leis = NULL,
                              country = NA_character_,
                              top_entities = FALSE) {
  filters <- c(
    if (!is.null(names)) {
      paste0(
        "filter%5Bentity.names%5D=",
        paste(vapply(names, gleif_query_value, character(1)), collapse = ",")
      )
    },
    if (!is.null(leis)) paste0("filter%5Blei%5D=", paste(leis, collapse = ",")),
    if (!is.na(country)) {
      paste0("filter%5Bentity.legalAddress.country%5D=", country)
    },
    if (top_entities) "filter%5BultimateChildCount%5D=%3E%3D1"
  )
  paste0(
    gleif_api_url,
    "lei-records?",
    paste(
      c(filters, "page%5Bsize%5D=200", "include=ultimate-parent"),
      collapse = "&"
    )
  )
}

# Responses are cached by URL (an index file names each response file and
# its fetch date), so an interrupted run resumes; a response older than
# `state$max_age_days` is fetched again, and at most `state$budget`
# requests go out. The dates of the responses used go to
# `state$retrieved`, so the matches carry the oldest, not the run date.
gleif_get <- function(url, cache_directory, state) {
  index_path <- file.path(cache_directory, "index.json")
  index <- read_gleif_index(index_path, cache_directory)
  cached <- index[[url]]
  if (is_fresh_gleif_response(cached, cache_directory, state)) {
    state$retrieved <- c(state$retrieved, as.Date(cached$retrieved))
    return(jsonlite::fromJSON(
      file.path(cache_directory, cached$file),
      simplifyVector = FALSE
    ))
  }
  if (state$requests >= state$budget) {
    cli::cli_abort(c(
      "The GLEIF request budget ({state$budget}) is used up.",
      i = "Run again to continue: cached responses are not requested again."
    ))
  }
  state$requests <- state$requests + 1L
  response <- httr2::req_perform(gleif_request(url))
  file_name <- cached$file %||%
    sprintf("responses/%04d.json", length(index) + 1L)
  dir.create(
    file.path(cache_directory, "responses"),
    recursive = TRUE,
    showWarnings = FALSE
  )
  writeBin(
    httr2::resp_body_raw(response),
    file.path(cache_directory, file_name)
  )
  index[[url]] <- list(file = file_name, retrieved = format(state$today))
  jsonlite::write_json(index, index_path, auto_unbox = TRUE, pretty = TRUE)
  state$retrieved <- c(state$retrieved, state$today)
  httr2::resp_body_json(response)
}

# URL -> list(file, retrieved). Entries written before fetch dates were
# kept are a file name only: dated by the file's modification time.
read_gleif_index <- function(index_path, cache_directory) {
  if (!file.exists(index_path)) {
    return(list())
  }
  index <- jsonlite::fromJSON(index_path, simplifyVector = FALSE)
  purrr::map(index, function(entry) {
    if (is.list(entry)) {
      return(entry)
    }
    modified <- file.mtime(file.path(cache_directory, entry))
    list(file = entry, retrieved = format(as.Date(modified)))
  })
}

is_fresh_gleif_response <- function(cached, cache_directory, state) {
  if (is.null(cached)) {
    return(FALSE)
  }
  if (!file.exists(file.path(cache_directory, cached$file))) {
    return(FALSE)
  }
  age_days <- as.numeric(state$today - as.Date(cached$retrieved))
  age_days <= state$max_age_days
}

empty_gleif_records <- function() {
  dplyr::tibble(
    lei = character(),
    legal_name = character(),
    other_names = list(),
    country = character(),
    entity_status = character(),
    registration_status = character(),
    ultimate_parent_lei = character(),
    ultimate_parent_exception = character()
  )
}

text_or_na <- function(value) {
  if (is.null(value)) NA_character_ else as.character(value)
}

# One row per lei-record: names, country, statuses and the ultimate parent
# (an LEI, or the reason GLEIF reports none).
parse_gleif_records <- function(body) {
  exceptions <- purrr::keep(body$included, function(item) {
    identical(item$type, "reporting-exceptions")
  })
  exception_reasons <- stats::setNames(
    purrr::map_chr(exceptions, function(item) {
      text_or_na(item$attributes$reason)
    }),
    purrr::map_chr(exceptions, "id")
  )
  if (length(body$data) == 0) {
    return(empty_gleif_records())
  }
  purrr::map(body$data, function(record) {
    entity <- record$attributes$entity
    parent <- record$relationships$`ultimate-parent`$data
    other_names <- c(
      purrr::map_chr(entity$otherNames, function(item) text_or_na(item$name)),
      purrr::map_chr(
        entity$transliteratedOtherNames,
        function(item) text_or_na(item$name)
      )
    )
    dplyr::tibble(
      lei = record$attributes$lei,
      legal_name = text_or_na(entity$legalName$name),
      other_names = list(other_names),
      country = text_or_na(entity$legalAddress$country),
      entity_status = text_or_na(entity$status),
      registration_status = text_or_na(record$attributes$registration$status),
      ultimate_parent_lei = if (identical(parent$type, "lei-records")) {
        parent$id
      } else {
        NA_character_
      },
      ultimate_parent_exception = if (
        identical(parent$type, "reporting-exceptions")
      ) {
        unname(exception_reasons[parent$id])
      } else {
        NA_character_
      }
    )
  }) |>
    purrr::list_rbind()
}

# Legal forms as GLEIF and EMA spell them, to one token each.
gleif_legal_form_variants <- c(
  "limited" = "ltd", "ltd" = "ltd",
  "unlimited company" = "uc", "uc" = "uc",
  "designated activity company" = "dac", "dac" = "dac",
  "public limited company" = "plc", "plc" = "plc",
  "besloten vennootschap" = "bv", "b v" = "bv", "bv" = "bv",
  "naamloze vennootschap" = "nv", "n v" = "nv", "nv" = "nv",
  "gesellschaft mit beschraenkter haftung" = "gmbh",
  "gesellschaft mit beschrankter haftung" = "gmbh", "gmbh" = "gmbh",
  "aktiengesellschaft" = "ag", "ag" = "ag",
  "societe anonyme" = "sa", "sociedad anonima" = "sa", "s a" = "sa",
  "sa" = "sa",
  "societe par actions simplifiee" = "sas", "s a s" = "sas", "sas" = "sas",
  "sociedad limitada unipersonal" = "slu", "s l u" = "slu", "slu" = "slu",
  "sociedad limitada" = "sl", "s l" = "sl", "sl" = "sl",
  "societa per azioni" = "spa", "s p a" = "spa", "spa" = "spa",
  "societa a responsabilita limitata" = "srl", "s r l" = "srl", "srl" = "srl",
  "aktiebolag" = "ab", "ab" = "ab",
  "aktieselskab" = "as", "a s" = "as", "as" = "as",
  "eeig" = "eeig", "eesv" = "eeig", "ewiv" = "eeig", "geie" = "eeig",
  "kft" = "kft", "d d" = "dd", "dd" = "dd", "s r o" = "sro", "sro" = "sro",
  "kg" = "kg", "company" = "co", "co" = "co", "publ" = "publ",
  "incorporated" = "inc", "inc" = "inc", "llc" = "llc", "ehf" = "ehf",
  "oyj" = "oy", "oy" = "oy", "snc" = "snc", "ets" = "ets", "onlus" = "ets",
  "corporation" = "corp", "corp" = "corp",
  "sociedad unipersonal" = "unip", "unipersonal" = "unip",
  "k s" = "ks", "ks" = "ks", "unipessoal lda" = "lda", "lda" = "lda",
  "spolka z ograniczona odpowiedzialnoscia" = "spzoo", "sp z o o" = "spzoo",
  "societas europaea" = "se", "se" = "se", "m b h" = "mbh", "mbh" = "mbh",
  "kgaa" = "kgaa", "s a r l" = "sarl", "sarl" = "sarl"
)

gleif_legal_form_tokens <- unique(unname(gleif_legal_form_variants))

# Folded name with each legal form as one token and "and" dropped, so
# "Merck Sharp & Dohme B.V." and "MERCK SHARP AND DOHME BV" compare equal.
gleif_normalise_name <- function(name) {
  variants <- names(gleif_legal_form_variants)
  variants <- variants[order(-nchar(variants))]
  normalised <- name |>
    fold_company_characters() |>
    stringr::str_replace_all("[&+]", " and ") |>
    stringr::str_replace_all("[^a-z0-9]+", " ") |>
    stringr::str_squish()
  for (variant in variants) {
    normalised <- stringr::str_replace_all(
      normalised,
      paste0("(^| )", variant, "(?= |$)"),
      paste0("\\1", gleif_legal_form_variants[[variant]])
    )
  }
  without_and(normalised)
}

# The normalised name without its legal-form tokens.
gleif_core_name <- function(name) {
  purrr::map_chr(gleif_normalise_name(name), function(normalised) {
    if (is.na(normalised)) {
      return(NA_character_)
    }
    words <- strsplit(normalised, " ", fixed = TRUE)[[1]]
    core <- paste(words[!words %in% gleif_legal_form_tokens], collapse = " ")
    if (core == "") NA_character_ else core
  })
}

# The name up to its legal form, for a search without it ("Novartis
# Europharm" for "Novartis Europharm Limited").
gleif_query_core <- function(name) {
  purrr::map_chr(name, function(one_name) {
    words <- one_name |>
      stringr::str_remove_all("\\([^()]*\\)") |>
      stringr::str_replace_all(",", " ") |>
      stringr::str_squish() |>
      strsplit(" ", fixed = TRUE)
    words <- words[[1]]
    is_form <- gleif_normalise_name(words) %in% gleif_legal_form_tokens
    kept_count <- if (any(is_form)) which(is_form)[1] - 1L else length(words)
    kept <- words[seq_len(kept_count)]
    if (length(kept) == 0) one_name else paste(kept, collapse = " ")
  })
}

# Records that are not operating entities: pension funds, share schemes,
# ADR and finance vehicles.
gleif_skipped_name_pattern <- paste0(
  "(?i)pension|participation|adrhedged|adrplus|velf.rdsfonden|jubilare|",
  "sterbekasse|pensionstreuhand|retirement|defined contribution|",
  "\\bfinance\\b|financial|feuerschutz|robotics|master tr"
)

gleif_place_tokens <- c(
  "europe", "european", "eu", "international", "ireland", "irish",
  "netherlands", "nederland", "nl", "deutschland", "germany", "german",
  "belgium", "belgie", "belgique", "france", "french", "italia", "italy",
  "espana", "spain", "uk", "gb", "hungary", "sweden", "denmark", "danmark",
  "austria", "osterreich", "portugal", "polska", "poland", "czech",
  "luxembourg", "malta", "cyprus", "global", "emea"
)

gleif_method_confidence <- c(
  exact = 0.99,
  core = 0.95,
  holder_name_within = 0.85,
  sibling = 0.55
)

# Every name of the records (legal name first), normalised, without records
# that are not operating entities.
gleif_record_names <- function(records) {
  records |>
    dplyr::mutate(
      name = purrr::map2(.data$legal_name, .data$other_names, c)
    ) |>
    dplyr::filter(!purrr::map_lgl(.data$name, function(names) {
      any(grepl(gleif_skipped_name_pattern, names, perl = TRUE))
    })) |>
    dplyr::select(-"other_names") |>
    tidyr::unnest_longer("name", indices_to = "name_index") |>
    dplyr::filter(!is.na(.data$name)) |>
    dplyr::mutate(
      normalised = gleif_normalise_name(.data$name),
      core = gleif_core_name(.data$name),
      words = strsplit(dplyr::coalesce(.data$core, ""), " ", fixed = TRUE),
      first_word = purrr::map_chr(.data$words, function(words) words[1])
    )
}

# The best candidate record for a holder among `record_names`
# (gleif_record_names()): the exact name (0.99), the same name without
# legal form (0.95), the holder's words within a longer name (0.85) or a
# shorter sibling name (0.55), always with the same first word; minus 0.4
# in another country, 0.1 without a holder country (not for the exact
# name), 0.1 when the entity is not active and 0.1 for a former or other
# name of a lapsed record; plus 0.01 per shared word, at most 0.99.
score_gleif_candidates <- function(holder, holder_country, record_names) {
  holder_normalised <- gleif_normalise_name(holder)
  holder_core <- gleif_core_name(holder)
  if (is.na(holder_core)) {
    return(NULL)
  }
  holder_words <- strsplit(holder_core, " ", fixed = TRUE)[[1]]
  scored <- record_names |>
    dplyr::filter(
      (.data$normalised == holder_normalised) %in% TRUE |
        (.data$first_word == holder_words[[1]]) %in% TRUE
    ) |>
    dplyr::mutate(
      is_exact = (.data$normalised == holder_normalised) %in% TRUE,
      same_first_word = (.data$first_word == holder_words[[1]]) %in% TRUE,
      is_within = purrr::map_lgl(.data$words, function(words) {
        all(holder_words %in% words) && length(holder_words) >= 2 &&
          length(holder_words) / length(words) >= 0.5 &&
          !any(setdiff(words, holder_words) %in% gleif_place_tokens)
      }),
      is_sibling = purrr::map_lgl(.data$words, function(words) {
        all(words %in% holder_words)
      }) & nchar(dplyr::coalesce(.data$core, "")) >= 6,
      method = dplyr::case_when(
        .data$is_exact ~ "exact",
        !.data$same_first_word ~ NA_character_,
        (.data$core == holder_core) %in% TRUE ~ "core",
        .data$is_within ~ "holder_name_within",
        .data$is_sibling ~ "sibling",
        .default = NA_character_
      )
    ) |>
    dplyr::filter(!is.na(.data$method))
  if (nrow(scored) == 0) {
    return(NULL)
  }
  score_gleif_methods(scored, holder_country, holder_words)
}

score_gleif_methods <- function(scored, holder_country, holder_words) {
  scored |>
    dplyr::mutate(
      in_other_country = !is.na(holder_country) &
        !(.data$country == holder_country) %in% TRUE,
      without_country = is.na(holder_country) & .data$method != "exact",
      is_inactive = !.data$entity_status %in% "ACTIVE",
      # A lapsed record found by a former name may be another entity's now.
      is_stale_other_name = .data$name_index > 1 &
        .data$registration_status %in% "LAPSED",
      shared_words = purrr::map_int(.data$words, function(words) {
        length(intersect(words, holder_words))
      }),
      confidence = pmin(
        0.99,
        round(
          unname(gleif_method_confidence[.data$method]) -
            0.4 * .data$in_other_country - 0.1 * .data$without_country -
            0.1 * .data$is_inactive - 0.1 * .data$is_stale_other_name +
            0.01 * .data$shared_words,
          2
        )
      ),
      why = purrr::pmap_chr(
        list(
          .data$in_other_country,
          .data$country,
          .data$without_country,
          .data$is_inactive,
          .data$name_index > 1,
          .data$is_stale_other_name
        ),
        gleif_match_reasons
      )
    ) |>
    dplyr::arrange(
      dplyr::desc(.data$confidence),
      .data$lei,
      .data$name_index
    ) |>
    dplyr::slice(1) |>
    dplyr::select(
      "lei",
      matched_name = "name",
      "method",
      "confidence",
      "why"
    )
}

gleif_match_reasons <- function(in_other_country, country, without_country,
                                is_inactive, via_other_name,
                                is_stale_other_name) {
  reasons <- c(
    if (in_other_country) paste("registered in", country),
    if (without_country) "holder country unknown",
    if (is_inactive) "entity not active",
    if (via_other_name) "matched a former or other name",
    if (is_stale_other_name) "of a lapsed record"
  )
  if (length(reasons) == 0) NA_character_ else paste(reasons, collapse = "; ")
}

# Words that start names but name no brand ("Les Laboratoires Servier").
gleif_stem_stop_words <- c(
  "les", "laboratoires", "laboratoire", "laboratorios", "laboratori", "the",
  "dr", "instituto", "istituto", "institut", "pharma", "pharmaceuticals",
  "pharmaceutical", "chemical", "works", "de", "la"
)

# The brand word of a holder name, for a search of group top entities.
gleif_brand_stem <- function(holder) {
  purrr::map_chr(gleif_query_core(holder), function(core) {
    words <- strsplit(core, " ", fixed = TRUE)[[1]]
    folded <- fold_company_characters(words)
    is_brand <- !folded %in% gleif_stem_stop_words &
      nchar(gsub("[^a-z0-9]", "", folded)) >= 3
    if (any(is_brand)) words[which(is_brand)[1]] else NA_character_
  })
}

# The companies to match: their display name, the country of most of their
# medicines' register holders, and their medicines.
gleif_match_targets <- function(company_run, medicines) {
  tables <- company_run$tables
  per_company <- tables$ema_medicine_companies |>
    dplyr::filter(!is.na(.data$company_key)) |>
    dplyr::left_join(
      dplyr::select(medicines, "ema_product_number", "medicine_status"),
      by = "ema_product_number",
      relationship = "one-to-one"
    )
  countries <- per_company |>
    dplyr::filter(!is.na(.data$country)) |>
    dplyr::count(.data$company_key, .data$country) |>
    dplyr::arrange(.data$company_key, dplyr::desc(.data$n), .data$country) |>
    dplyr::distinct(.data$company_key, .keep_all = TRUE) |>
    dplyr::select("company_key", country_hint = "country")
  tables$companies |>
    dplyr::filter(.data$kind == "company") |>
    dplyr::select(company_key = "key", holder = "name") |>
    dplyr::left_join(
      dplyr::summarise(
        per_company,
        medicines = dplyr::n(),
        authorised = sum(.data$medicine_status == "Authorised"),
        .by = "company_key"
      ),
      by = "company_key",
      relationship = "one-to-one"
    ) |>
    dplyr::left_join(
      countries,
      by = "company_key",
      relationship = "one-to-one"
    ) |>
    dplyr::arrange(.data$holder)
}

batches <- function(values, size) {
  split(values, ceiling(seq_along(values) / size))
}

gleif_fetch_records <- function(urls, cache_directory, state) {
  records <- purrr::map(unname(urls), function(url) {
    parse_gleif_records(gleif_get(url, cache_directory, state))
  })
  purrr::list_rbind(c(list(empty_gleif_records()), records))
}

# The best name match per target among all records fetched so far.
best_gleif_matches <- function(targets, records) {
  if (nrow(records) == 0) {
    return(empty_gleif_candidates())
  }
  record_names <- gleif_record_names(
    dplyr::distinct(records, .data$lei, .keep_all = TRUE)
  )
  matches <- purrr::map(seq_len(nrow(targets)), function(index) {
    best <- score_gleif_candidates(
      targets$holder[[index]],
      targets$country_hint[[index]],
      record_names
    )
    if (is.null(best)) {
      return(NULL)
    }
    dplyr::mutate(best, holder = targets$holder[[index]], .before = 1)
  })
  purrr::list_rbind(c(list(empty_gleif_candidates()), matches))
}

empty_gleif_candidates <- function() {
  dplyr::tibble(
    holder = character(),
    lei = character(),
    matched_name = character(),
    method = character(),
    confidence = numeric(),
    why = character()
  )
}

matched_confidence <- function(targets, matches) {
  if (is.null(matches) || nrow(matches) == 0) {
    return(rep(0, nrow(targets)))
  }
  dplyr::coalesce(
    matches$confidence[match(targets$holder, matches$holder)],
    0
  )
}

# Group top entities whose name starts with the target's brand word: a
# hint for review, never applied.
gleif_stem_hints <- function(targets, top_records) {
  if (nrow(top_records) == 0) {
    return(empty_gleif_candidates())
  }
  record_names <- top_records |>
    dplyr::distinct(.data$lei, .keep_all = TRUE) |>
    gleif_record_names() |>
    dplyr::mutate(word_count = lengths(.data$words))
  hints <- purrr::map(seq_len(nrow(targets)), function(index) {
    stem <- gleif_core_name(targets$stem[[index]])
    hint <- record_names |>
      dplyr::filter((.data$first_word == stem) %in% TRUE) |>
      dplyr::arrange(.data$word_count, .data$name_index, .data$lei) |>
      dplyr::slice(1)
    if (nrow(hint) == 0) {
      return(NULL)
    }
    dplyr::tibble(
      holder = targets$holder[[index]],
      lei = hint$lei,
      matched_name = hint$name,
      method = "stem_top_entity",
      confidence = 0.3,
      why = paste0(
        "group top entity found by the brand word \"",
        targets$stem[[index]],
        "\" (a hint, never applied)"
      )
    )
  })
  purrr::list_rbind(c(list(empty_gleif_candidates()), hints))
}

# Searches GLEIF for the targets: (1) their names; (2) for the rest, the
# name without legal form in the holder's country; (3) for the rest with
# an authorised or a second medicine, the brand word among group top
# entities (hints only); (4) the parents' own records.
search_gleif <- function(targets, cache_directory, state) {
  q1_urls <- purrr::map_chr(batches(targets$holder, 10), function(names) {
    gleif_records_url(names = names)
  })
  records <- gleif_fetch_records(q1_urls, cache_directory, state)
  matches <- best_gleif_matches(targets, records)

  misses <- targets[matched_confidence(targets, matches) < 0.8, ]
  q2_urls <- misses |>
    dplyr::mutate(core = gleif_query_core(.data$holder)) |>
    dplyr::distinct(.data$country_hint, .data$core) |>
    dplyr::arrange(.data$country_hint, .data$core) |>
    dplyr::group_by(.data$country_hint) |>
    dplyr::group_map(function(rows, key) {
      purrr::map_chr(batches(rows$core, 10), function(names) {
        gleif_records_url(names = names, country = key$country_hint)
      })
    }) |>
    unlist()
  records <- dplyr::bind_rows(
    records,
    gleif_fetch_records(q2_urls, cache_directory, state)
  )
  matches <- best_gleif_matches(targets, records)

  stem_targets <- targets |>
    dplyr::filter(
      matched_confidence(targets, matches) < 0.8,
      .data$medicines >= 2 | .data$authorised >= 1
    ) |>
    dplyr::mutate(stem = gleif_brand_stem(.data$holder)) |>
    dplyr::filter(!is.na(.data$stem))
  q3_urls <- purrr::map_chr(
    batches(sort(unique(stem_targets$stem)), 12),
    function(stems) gleif_records_url(names = stems, top_entities = TRUE)
  )
  top_records <- gleif_fetch_records(q3_urls, cache_directory, state)
  records <- dplyr::bind_rows(records, top_records)
  hints <- gleif_stem_hints(stem_targets, top_records)

  parent_leis <- setdiff(
    stats::na.omit(unique(records$ultimate_parent_lei)),
    records$lei
  )
  q4_urls <- purrr::map_chr(batches(sort(parent_leis), 100), function(leis) {
    gleif_records_url(leis = leis)
  })
  records <- dplyr::bind_rows(
    records,
    gleif_fetch_records(q4_urls, cache_directory, state)
  )
  list(
    records = dplyr::distinct(records, .data$lei, .keep_all = TRUE),
    matches = matches,
    hints = hints
  )
}

# One row per target: its best name match of at least
# `gleif_review_confidence`, else its brand-word hint.
gleif_match_rows <- function(targets, search, retrieved) {
  records <- search$records
  matches <- search$matches |>
    dplyr::filter(.data$confidence >= gleif_review_confidence)
  hints <- search$hints
  if (!is.null(hints)) {
    hints <- dplyr::filter(hints, !.data$holder %in% matches$holder)
  }
  parents <- dplyr::select(
    records,
    ultimate_parent_lei = "lei",
    ultimate_parent_name = "legal_name",
    ultimate_parent_registration_status = "registration_status"
  )
  dplyr::bind_rows(matches, hints) |>
    dplyr::left_join(
      dplyr::select(targets, "holder", "country_hint"),
      by = "holder",
      relationship = "many-to-one"
    ) |>
    dplyr::left_join(
      dplyr::select(
        records,
        "lei",
        "legal_name",
        lei_country = "country",
        "entity_status",
        "registration_status",
        "ultimate_parent_lei",
        "ultimate_parent_exception"
      ),
      by = "lei",
      relationship = "many-to-one"
    ) |>
    dplyr::left_join(
      parents,
      by = "ultimate_parent_lei",
      relationship = "many-to-one"
    ) |>
    dplyr::mutate(
      reviewed = FALSE,
      retrieved = format(retrieved),
      source = "gleif"
    ) |>
    dplyr::select(dplyr::all_of(names(gleif_match_columns))) |>
    dplyr::arrange(.data$holder)
}

# A rerun keeps the reviews in the file it replaces: a new row with a
# reviewed row's holder and LEI stays reviewed, and a reviewed row this run
# did not find again is kept, with a warning.
carry_gleif_reviews <- function(rows, previous) {
  reviewed <- dplyr::filter(previous, .data$reviewed %in% TRUE)
  if (nrow(reviewed) == 0) {
    return(rows)
  }
  reviewed_pairs <- paste(reviewed$holder, reviewed$lei)
  row_pairs <- paste(rows$holder, rows$lei)
  rows$reviewed[row_pairs %in% reviewed_pairs] <- TRUE
  kept <- reviewed[!reviewed_pairs %in% row_pairs, ]
  if (nrow(kept) > 0) {
    cli::cli_alert_warning(
      "Reviewed GLEIF matches this run did not find again, kept:
      {.val {offender_values(kept$holder, max_shown = 20)}}"
    )
  }
  dplyr::bind_rows(rows, kept) |>
    dplyr::arrange(.data$holder, .data$lei)
}

# Matches every company's holder name to GLEIF and writes the committed
# matches file (keeping its reviews). Needs the pipeline's cached EMA and
# Union Register files. `retrieved` is the oldest response used.
run_gleif_matching <- function(ema_cache = ".cache/ema/medicines.json",
                               register_path = file.path(
                                 ".cache/downloads/union-register",
                                 "ods_products.json"
                               ),
                               cache_directory = ".cache/downloads/gleif",
                               output_path = gleif_matches_path,
                               budget = gleif_default_budget,
                               max_age_days = gleif_max_age_days,
                               today = Sys.Date()) {
  ema <- read_ema_json(ema_cache)
  medicines <- build_medicines_table(clean_ema_medicines(ema$data))
  company_run <- build_company_tables(
    build_medicine_holders(medicines, read_union_register(register_path)),
    empty_gleif_matches(),
    snapshot_date_from_timestamp(ema$meta$timestamp)
  )
  targets <- gleif_match_targets(company_run, medicines)
  state <- gleif_state(budget, max_age_days, today)
  search <- search_gleif(targets, cache_directory, state)
  retrieved <- min(c(state$retrieved, state$today))
  rows <- gleif_match_rows(targets, search, retrieved)
  if (file.exists(output_path)) {
    rows <- carry_gleif_reviews(rows, read_gleif_matches(output_path))
  }
  dir.create(dirname(output_path), recursive = TRUE, showWarnings = FALSE)
  write_json_table(rows, output_path)
  cli::cli_alert_success(sprintf(
    paste(
      "GLEIF: %d requests; %d of %d companies matched (%d applicable",
      "without review, %d reviewed), %d brand-word hints; responses from %s;",
      "written to %s."
    ),
    state$requests,
    sum(rows$method %in% gleif_name_methods),
    nrow(targets),
    sum(is_auto_gleif_match(rows)),
    sum(rows$reviewed),
    sum(rows$method == "stem_top_entity"),
    format(retrieved),
    output_path
  ))
  invisible(rows)
}
