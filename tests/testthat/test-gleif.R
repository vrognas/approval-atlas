# Real GLEIF API responses (2026-09-28), trimmed to the fields in use.
fixture_gleif_body <- function(path = fixture_gleif_records_path()) {
  jsonlite::fromJSON(path, simplifyVector = FALSE)
}

fixture_gleif_records <- function() {
  parse_gleif_records(fixture_gleif_body())
}

test_that("gleif_records_url encodes spaces as %20 and separates names", {
  expect_identical(
    gleif_records_url(
      names = c("Merck Sharp & Dohme B.V.", "Krka, d.d., Novo mesto"),
      country = "NL"
    ),
    paste0(
      "https://api.gleif.org/api/v1/lei-records?",
      "filter%5Bentity.names%5D=Merck%20Sharp%20%26%20Dohme%20B.V.,",
      "Krka%20d.d.%20Novo%20mesto",
      "&filter%5Bentity.legalAddress.country%5D=NL",
      "&page%5Bsize%5D=200&include=ultimate-parent"
    )
  )
  expect_identical(
    gleif_records_url(names = "Roche", top_entities = TRUE),
    paste0(
      "https://api.gleif.org/api/v1/lei-records?",
      "filter%5Bentity.names%5D=Roche",
      "&filter%5BultimateChildCount%5D=%3E%3D1",
      "&page%5Bsize%5D=200&include=ultimate-parent"
    )
  )
  expect_match(
    gleif_records_url(leis = c("4YV9Y5M8S0BRK1RP0397", "PY6ZZQWO2IZFZC3IOL08")),
    "filter%5Blei%5D=4YV9Y5M8S0BRK1RP0397,PY6ZZQWO2IZFZC3IOL08&",
    fixed = TRUE
  )
  expect_identical(gleif_query_value("Bristol-Myers Squibb / Pfizer EEIG"),
                   "Bristol-Myers%20Squibb%20%2F%20Pfizer%20EEIG")
})

test_that("parse_gleif_records reads names, statuses and the parent", {
  records <- fixture_gleif_records()
  expect_named(
    records,
    c(
      "lei", "legal_name", "other_names", "country", "entity_status",
      "registration_status", "ultimate_parent_lei",
      "ultimate_parent_exception"
    )
  )
  expect_identical(nrow(records), 6L)
  msd <- records[records$lei == "549300YUY8VFXLXSSB43", ]
  expect_identical(msd$legal_name, "MERCK SHARP & DOHME B.V.")
  expect_identical(msd$ultimate_parent_lei, "4YV9Y5M8S0BRK1RP0397")
  expect_identical(msd$ultimate_parent_exception, NA_character_)
  sobi <- records[records$lei == "549300124Y3MQI87PT35", ]
  expect_identical(sobi$ultimate_parent_lei, NA_character_)
  expect_identical(sobi$ultimate_parent_exception, "NON_CONSOLIDATING")
  sanofi <- records[records$lei == "549300IXIBIGWEEWNK29", ]
  expect_true("GENZYME EUROPE B.V." %in% sanofi$other_names[[1]])
  sandoz <- records[records$lei == "529900KYQPVVZTT2RC96", ]
  expect_identical(sandoz$registration_status, "LAPSED")
  expect_identical(
    parse_gleif_records(list(data = list())),
    empty_gleif_records()
  )
})

test_that("gleif_normalise_name reads legal forms as one token", {
  expect_identical(
    gleif_normalise_name(c(
      "Merck Sharp & Dohme B.V.", "MERCK SHARP AND DOHME BV",
      "Bayer AG", "Bayer Aktiengesellschaft",
      "Medac Gesellschaft für klinische Spezialpräparate m.b.H."
    )),
    c(
      "merck sharp dohme bv", "merck sharp dohme bv", "bayer ag", "bayer ag",
      "medac gesellschaft fuer klinische spezialpraeparate mbh"
    )
  )
  expect_identical(
    gleif_core_name(c("Orion Corporation", "Orion Oyj", "AB", NA)),
    c("orion", "orion", NA, NA)
  )
  expect_identical(
    gleif_query_core(c(
      "Novartis Europharm Limited", "Krka, d.d., Novo mesto",
      "Orchard Therapeutics (Netherlands) B.V.", "Ltd"
    )),
    c("Novartis Europharm", "Krka", "Orchard Therapeutics", "Ltd")
  )
  expect_identical(
    gleif_brand_stem(c(
      "Les Laboratoires Servier", "Novartis Europharm Limited", "A.B."
    )),
    c("Servier", "Novartis", NA)
  )
})

test_that("score_gleif_candidates prefers the exact name in the country", {
  names <- gleif_record_names(fixture_gleif_records())
  # The pension fund is not a candidate.
  expect_false(any(grepl("PENSION", names$name)))
  exact <- score_gleif_candidates("Merck Sharp & Dohme B.V.", "NL", names)
  expect_identical(exact$lei, "549300YUY8VFXLXSSB43")
  expect_identical(exact$method, "exact")
  expect_identical(exact$confidence, 0.99)
  expect_identical(exact$why, NA_character_)
  former <- score_gleif_candidates("Genzyme Europe B.V.", "NL", names)
  expect_identical(former$lei, "549300IXIBIGWEEWNK29")
  expect_identical(former$method, "exact")
  expect_identical(former$why, "matched a former or other name")
  abroad <- score_gleif_candidates("Sandoz GmbH", "DE", names)
  expect_identical(abroad$confidence, 0.6)
  expect_identical(abroad$why, "registered in AT")
  core <- score_gleif_candidates("AstraZeneca", NA_character_, names)
  expect_identical(core$method, "core")
  expect_identical(core$confidence, 0.86)
  expect_identical(core$why, "holder country unknown")
  within <- score_gleif_candidates("Swedish Orphan", "SE", names)
  expect_identical(within$method, "holder_name_within")
  sibling <- score_gleif_candidates(
    "Merck Sharp & Dohme Animal Health B.V.",
    "NL",
    names
  )
  expect_identical(sibling$method, "sibling")
  expect_identical(sibling$confidence, 0.58)
  expect_null(score_gleif_candidates("Pfizer Limited", "GB", names))
  expect_null(score_gleif_candidates("Ltd", "GB", names))
})

mock_gleif_response <- function(body_path) {
  httr2::response(
    status_code = 200,
    headers = list(`Content-Type` = "application/vnd.api+json"),
    body = read_fixture_bytes(body_path)
  )
}

test_that("gleif_get caches each URL and keeps to its budget", {
  requested <- new.env()
  requested$urls <- character()
  requested$realms <- character()
  testthat::local_mocked_bindings(
    req_perform = function(req, ...) {
      requested$urls <- c(requested$urls, req$url)
      requested$realms <- c(requested$realms, req$policies$throttle_realm)
      mock_gleif_response(fixture_gleif_records_path())
    },
    .package = "httr2"
  )
  cache_directory <- tempfile()
  state <- gleif_state(budget = 1L, today = as.Date("2026-09-28"))
  url <- gleif_records_url(names = "Sandoz GmbH")
  body <- gleif_get(url, cache_directory, state)
  expect_identical(length(body$data), 6L)
  again <- gleif_get(url, cache_directory, state)
  expect_identical(again, body)
  expect_identical(requested$urls, url)
  expect_identical(requested$realms, "api.gleif.org")
  expect_true(file.exists(
    file.path(cache_directory, "responses", "0001.json")
  ))
  index <- jsonlite::fromJSON(file.path(cache_directory, "index.json"))
  expect_identical(
    index[[url]],
    list(file = "responses/0001.json", retrieved = "2026-09-28")
  )
  expect_identical(state$retrieved, as.Date(c("2026-09-28", "2026-09-28")))
  expect_error(
    gleif_get(gleif_records_url(names = "Bayer AG"), cache_directory, state),
    "budget"
  )
})

test_that("gleif_get fetches old responses again and dates the ones used", {
  requested <- new.env()
  requested$count <- 0L
  testthat::local_mocked_bindings(
    req_perform = function(req, ...) {
      requested$count <- requested$count + 1L
      mock_gleif_response(fixture_gleif_records_path())
    },
    .package = "httr2"
  )
  cache_directory <- tempfile()
  dir.create(file.path(cache_directory, "responses"), recursive = TRUE)
  old_url <- gleif_records_url(names = "Sandoz GmbH")
  recent_url <- gleif_records_url(names = "Bayer AG")
  legacy_url <- gleif_records_url(names = "Pfizer Limited")
  for (file in c("0001.json", "0002.json", "0003.json")) {
    file.copy(
      fixture_gleif_records_path(),
      file.path(cache_directory, "responses", file)
    )
  }
  # An entry written before fetch dates were kept: its file's date.
  Sys.setFileTime(
    file.path(cache_directory, "responses", "0003.json"),
    as.POSIXct("2026-09-20 12:00:00", tz = "UTC")
  )
  index <- stats::setNames(
    list(
      list(file = "responses/0001.json", retrieved = "2026-08-01"),
      list(file = "responses/0002.json", retrieved = "2026-09-10"),
      "responses/0003.json"
    ),
    c(old_url, recent_url, legacy_url)
  )
  jsonlite::write_json(
    index,
    file.path(cache_directory, "index.json"),
    auto_unbox = TRUE
  )
  state <- gleif_state(budget = 5L, today = as.Date("2026-09-28"))
  gleif_get(old_url, cache_directory, state)
  gleif_get(recent_url, cache_directory, state)
  gleif_get(legacy_url, cache_directory, state)
  expect_identical(requested$count, 1L)
  expect_identical(
    state$retrieved,
    as.Date(c("2026-09-28", "2026-09-10", "2026-09-20"))
  )
  written <- jsonlite::fromJSON(file.path(cache_directory, "index.json"))
  expect_identical(
    written[[old_url]],
    list(file = "responses/0001.json", retrieved = "2026-09-28")
  )
  # An entry whose file is gone is fetched again.
  missing_url <- gleif_records_url(names = "Roche Registration GmbH")
  index_path <- file.path(cache_directory, "index.json")
  index <- jsonlite::fromJSON(index_path, simplifyVector = FALSE)
  index[[missing_url]] <- list(
    file = "responses/0009.json",
    retrieved = "2026-09-27"
  )
  jsonlite::write_json(index, index_path, auto_unbox = TRUE)
  gleif_get(missing_url, cache_directory, state)
  expect_identical(requested$count, 2L)
  expect_true(file.exists(
    file.path(cache_directory, "responses", "0009.json")
  ))
  # Inf: never fetched again.
  keep <- gleif_state(
    budget = 0L,
    max_age_days = Inf,
    today = as.Date("2027-09-28")
  )
  expect_silent(gleif_get(recent_url, cache_directory, keep))
})

test_that("a 429 from GLEIF stops the run without a retry", {
  requested <- new.env()
  requested$count <- 0L
  testthat::local_mocked_bindings(
    req_perform = function(req, ...) {
      requested$count <- requested$count + 1L
      stop(httr2::http_error_full(429))
    },
    .package = "httr2"
  )
  state <- gleif_state(budget = 5L)
  expect_error(gleif_get(
    gleif_records_url(names = "Bayer AG"),
    tempfile(),
    state
  ))
  expect_identical(requested$count, 1L)
})

test_that("gleif_request asks for JSON:API at GLEIF's spacing", {
  request <- gleif_request(gleif_records_url(names = "Bayer AG"))
  expect_identical(request$headers$Accept, "application/vnd.api+json")
  expect_identical(request$policies$throttle_realm, "api.gleif.org")
})

gleif_targets <- function() {
  dplyr::tibble(
    company_key = c("c.merck-sharp-dohme", "c.genzyme", "c.unknown"),
    holder = c(
      "Merck Sharp & Dohme B.V.", "Genzyme Europe B.V.", "Unknown Pharma GmbH"
    ),
    medicines = c(3L, 1L, 2L),
    authorised = c(2L, 0L, 1L),
    country_hint = c("NL", "NL", "DE")
  )
}

# Name searches answer with the records fixture, LEI searches with the
# parents fixture, and brand-word searches with nothing.
mock_gleif_api <- function(env = parent.frame()) {
  requested <- new.env()
  requested$urls <- character()
  testthat::local_mocked_bindings(
    req_perform = function(req, ...) {
      requested$urls <- c(requested$urls, req$url)
      if (grepl("filter%5Blei%5D", req$url, fixed = TRUE)) {
        return(mock_gleif_response(fixture_gleif_parents_path()))
      }
      if (grepl("ultimateChildCount", req$url, fixed = TRUE)) {
        empty <- tempfile(fileext = ".json")
        writeLines('{"data": [], "included": []}', empty)
        return(mock_gleif_response(empty))
      }
      mock_gleif_response(fixture_gleif_records_path())
    },
    .package = "httr2",
    .env = env
  )
  requested
}

test_that("search_gleif runs the name, core, stem and parent searches", {
  requested <- mock_gleif_api()
  state <- gleif_state(budget = 10L)
  search <- search_gleif(gleif_targets(), tempfile(), state)
  expect_identical(state$requests, 4L)
  expect_match(requested$urls[[1]], "Merck%20Sharp", fixed = TRUE)
  # The unmatched holder: its name without legal form in its country.
  expect_match(requested$urls[[2]], "=Unknown%20Pharma&", fixed = TRUE)
  expect_match(requested$urls[[2]], "legalAddress.country%5D=DE", fixed = TRUE)
  expect_match(requested$urls[[3]], "ultimateChildCount", fixed = TRUE)
  expect_match(requested$urls[[4]], "4YV9Y5M8S0BRK1RP0397", fixed = TRUE)
  expect_identical(
    search$matches$holder,
    c("Merck Sharp & Dohme B.V.", "Genzyme Europe B.V.")
  )
  rows <- gleif_match_rows(gleif_targets(), search, as.Date("2026-09-28"))
  expect_named(rows, names(gleif_match_columns))
  msd <- rows[rows$holder == "Merck Sharp & Dohme B.V.", ]
  expect_identical(msd$ultimate_parent_name, "MERCK & CO., INC.")
  expect_identical(msd$ultimate_parent_registration_status, "ISSUED")
  expect_identical(msd$country_hint, "NL")
  expect_identical(msd$lei_country, "NL")
  expect_false(msd$reviewed)
  expect_identical(msd$retrieved, "2026-09-28")
  expect_identical(msd$source, "gleif")
})

test_that("stem hints are listed for review, never as name matches", {
  top_records <- fixture_gleif_records()
  targets <- dplyr::mutate(
    gleif_targets(),
    holder = c("Merck Sharp & Dohme B.V.", "Genzyme Europe B.V.", "Sandoz AG"),
    stem = c("Merck", "Genzyme", "Sandoz")
  )
  unmatched <- dplyr::mutate(targets[1, ], holder = "Zyx AG", stem = "Zyx")
  hints <- gleif_stem_hints(dplyr::bind_rows(targets, unmatched), top_records)
  expect_identical(hints$holder, targets$holder)
  # Genzyme: a former name of Sanofi B.V.
  expect_identical(hints$matched_name[[2]], "GENZYME B.V.")
  expect_identical(unique(hints$method), "stem_top_entity")
  expect_identical(unique(hints$confidence), 0.3)
  expect_match(hints$why[[3]], "brand word \"Sandoz\"", fixed = TRUE)
  expect_identical(
    gleif_stem_hints(targets, empty_gleif_records()),
    empty_gleif_candidates()
  )
})

test_that("run_gleif_matching writes the matches file from cached data", {
  requested <- mock_gleif_api()
  ema_cache <- tempfile(fileext = ".json")
  file.copy(fixture_ema_path(), ema_cache)
  output_path <- file.path(tempfile(), "gleif-holder-matches.json")
  messages <- testthat::capture_messages(rows <- run_gleif_matching(
    ema_cache = ema_cache,
    register_path = fixture_union_register_path(),
    cache_directory = tempfile(),
    output_path = output_path,
    today = as.Date("2026-09-28")
  ))
  expect_true(file.exists(output_path))
  written <- read_gleif_matches(output_path)
  expect_identical(written$holder, rows$holder)
  expect_true("Merck Sharp & Dohme B.V." %in% written$holder)
  expect_identical(unique(written$retrieved), "2026-09-28")
  expect_match(messages, "GLEIF: [0-9]+ requests", all = FALSE)

  # A rerun keeps a review.
  reviewed <- written
  reviewed$reviewed[reviewed$holder == "Merck Sharp & Dohme B.V."] <- TRUE
  write_json_table(reviewed, output_path)
  suppressMessages(run_gleif_matching(
    ema_cache = ema_cache,
    register_path = fixture_union_register_path(),
    cache_directory = tempfile(),
    output_path = output_path,
    today = as.Date("2026-09-29")
  ))
  rerun <- read_gleif_matches(output_path)
  expect_identical(
    rerun$reviewed[rerun$holder == "Merck Sharp & Dohme B.V."],
    TRUE
  )
  expect_identical(sum(rerun$reviewed), 1L)
})

test_that("carry_gleif_reviews keeps reviews a rerun did not find again", {
  previous <- dplyr::tibble(
    holder = c("Bayer AG", "Old Holder GmbH", "Pfizer Limited"),
    lei = c("LEI1", "LEI2", "LEI3"),
    reviewed = c(TRUE, TRUE, FALSE)
  )
  rows <- dplyr::tibble(
    holder = c("Bayer AG", "Pfizer Limited"),
    lei = c("LEI1", "LEI3"),
    reviewed = FALSE
  )
  expect_message(
    carried <- carry_gleif_reviews(rows, previous),
    "Old Holder GmbH"
  )
  expect_identical(carried$holder, previous$holder)
  expect_identical(carried$reviewed, c(TRUE, TRUE, FALSE))
  expect_identical(
    carry_gleif_reviews(rows, dplyr::filter(previous, !.data$reviewed)),
    rows
  )
})

# Records built from a real GLEIF record's fields, with long invented names.
long_name_records <- function(legal_name, other_name, registration_status) {
  records <- fixture_gleif_records()[1, ]
  records$lei <- "LONGNAME000000000000"
  records$legal_name <- legal_name
  records$other_names <- list(other_name)
  records$country <- "NL"
  records$entity_status <- "ACTIVE"
  records$registration_status <- registration_status
  records
}

auto_row <- function(holder, country, records) {
  best <- score_gleif_candidates(holder, country, gleif_record_names(records))
  dplyr::mutate(
    best,
    country_hint = country,
    legal_name = records$legal_name,
    lei_country = records$country,
    entity_status = records$entity_status,
    registration_status = records$registration_status
  )
}

test_that("shared words never make a match applicable without review", {
  words <- "Alpha Beta Gamma Delta Epsilon Zeta Eta"
  # A former name of a lapsed record, seven words: 0.96, not applied.
  stale <- auto_row(
    paste(words, "B.V."),
    "NL",
    long_name_records("OMEGA B.V.", paste(words, "B.V."), "LAPSED")
  )
  expect_identical(stale$method, "exact")
  expect_gte(stale$confidence, gleif_auto_confidence)
  expect_false(is_auto_gleif_match(stale))
  # The holder's eleven words within a longer name: 0.96, not applied.
  eleven <- paste(words, "Theta Iota Kappa Lambda")
  within <- auto_row(
    paste(eleven, "B.V."),
    "NL",
    long_name_records(paste(eleven, "Mu B.V."), NA_character_, "ISSUED")
  )
  expect_identical(within$method, "holder_name_within")
  expect_gte(within$confidence, gleif_auto_confidence)
  expect_false(is_auto_gleif_match(within))
  # The same name without legal form, but no holder country: not applied.
  core <- auto_row(
    eleven,
    NA_character_,
    long_name_records(paste(eleven, "B.V."), NA_character_, "ISSUED")
  )
  expect_identical(core$method, "core")
  expect_gte(core$confidence, gleif_auto_confidence)
  expect_false(is_auto_gleif_match(core))
  # In the holder's country, and the exact name: applied.
  expect_true(is_auto_gleif_match(dplyr::mutate(core, country_hint = "NL")))
  exact <- auto_row(
    paste(words, "B.V."),
    "NL",
    long_name_records(paste(words, "B.V."), NA_character_, "ISSUED")
  )
  expect_true(is_auto_gleif_match(exact))
  expect_false(is_auto_gleif_match(
    dplyr::mutate(exact, entity_status = "INACTIVE")
  ))
})

test_that("without records or matches nothing is matched", {
  expect_identical(
    best_gleif_matches(gleif_targets(), empty_gleif_records()),
    empty_gleif_candidates()
  )
  expect_identical(matched_confidence(gleif_targets(), NULL), c(0, 0, 0))
})

test_that("read_gleif_matches needs the file and its columns", {
  expect_error(read_gleif_matches(tempfile()), "match-gleif.R")
  empty <- tempfile(fileext = ".json")
  writeLines("[]", empty)
  expect_identical(read_gleif_matches(empty), empty_gleif_matches())
  partial <- tempfile(fileext = ".json")
  writeLines('[{"holder": "Bayer AG"}]', partial)
  expect_error(read_gleif_matches(partial), "lacks columns")
  matches <- read_gleif_matches(fixture_gleif_matches_path())
  expect_named(matches, names(gleif_match_columns))
})
