whocc_url <- "https://atcddd.fhi.no"

whocc_alterations_url <- paste0(
  whocc_url,
  "/atc_ddd_alterations__cumulative/atc_alterations/"
)

whocc_temporary_url <- paste0(
  whocc_url,
  "/filearchive/documents/temporary_atc_and_ddd.xlsx"
)

whocc_updates_url <- function(year) {
  paste0(
    whocc_url,
    "/filearchive/documents/atc_ddd_new_and_alterations_",
    year,
    "_final.xlsx"
  )
}

whocc_index_url <- function(code) {
  paste0(whocc_url, "/atc_ddd_index/?code=", code, "&showdescription=no")
}

# The full index is sold, not published, so only single pages are fetched:
# at most this many per run, for codes no other source names.
whocc_index_max_pages <- 10L

# The alterations list changes about once a year and its page sends no
# validators, so it is fetched again at most monthly.
alterations_max_age_hours <- 30 * 24

# Retired level-4 codes EMA still uses. The cumulative alterations list has
# level-5 codes only, so these names were copied by hand (2026-09-27) from
# archived copies of the ATC/DDD Index 2020; the replacements follow the
# list: every L01XC code but L01XC04 (moved to L04AA34 in 2015) moved to
# L01F in 2022, and every L01XE code to L01E in 2021.
curated_retired_atc_levels <- dplyr::tibble(
  atc_code = c("L01XC", "L01XE"),
  name = c("Monoclonal antibodies", "Protein kinase inhibitors"),
  replaced_by = c("L01F", "L01E"),
  changed_year = c(2022L, 2021L),
  source_url = paste0(
    "https://web.archive.org/web/",
    c("20200627072941", "20200623144658"),
    "/https://www.whocc.no/atc_ddd_index/?code=",
    c("L01XC", "L01XE"),
    "&showdescription=no"
  )
)

# One realm for the WHOCC site, two seconds apart.
whocc_request <- function(url) {
  throttled_request(url, spacing_seconds = 2, realm = "atcddd.fhi.no")
}

current_year <- function(today = Sys.Date()) {
  as.integer(format(today, "%Y"))
}

# The WHOCC files only name and map ATC codes, so an unreachable WHOCC site
# (a network failure, 429, 5xx, or a file WHOCC has removed) must not stop
# the daily EMA build: the last cached copy is used, else none (NULL).
# `download` is evaluated here, inside the handler's reach.
download_or_use_cache <- function(download, destination, label) {
  tryCatch(
    download,
    httr2_error = function(error) {
      cached <- read_source_sidecar(
        file.path(dirname(destination), "source.json")
      )
      if (is.null(cached) || !file.exists(destination)) {
        cli::cli_warn(
          "{label} could not be downloaded ({conditionMessage(error)}) and
          there is no cached copy; this run goes without it."
        )
        return(NULL)
      }
      cli::cli_warn(
        "{label} could not be downloaded ({conditionMessage(error)}); using
        the copy retrieved {cached$retrieved}."
      )
      c(cached, path = destination)
    }
  )
}

whocc_updates_year <- function(url) {
  as.integer(stringr::str_match(url, "_(\\d{4})_final\\.xlsx$")[, 2])
}

download_whocc_updates <- function(cache_directory = ".cache/downloads/whocc",
                                   year = current_year(),
                                   max_age_hours =
                                     daily_source_max_age_hours) {
  destination <- file.path(
    cache_directory,
    "updates",
    "atc_ddd_new_and_alterations.xlsx"
  )
  download_year <- function(year) {
    url <- whocc_updates_url(year)
    download_cached_source(
      url,
      destination,
      request = whocc_request(url),
      label = paste("WHOCC ATC/DDD updates", year),
      max_age_hours = max_age_hours
    )
  }
  # The list for a new year is published some time in January.
  source <- download_or_use_cache(
    tryCatch(
      download_year(year),
      httr2_http_404 = function(error) {
        cli::cli_inform(
          "No WHOCC ATC/DDD updates for {year} yet; using {year - 1}."
        )
        download_year(year - 1L)
      }
    ),
    destination,
    "The WHOCC ATC/DDD updates"
  )
  if (is.null(source)) {
    return(NULL)
  }
  c(source, year = whocc_updates_year(source$url))
}

download_whocc_temporary <- function(cache_directory = ".cache/downloads/whocc",
                                     max_age_hours =
                                       daily_source_max_age_hours) {
  destination <- file.path(
    cache_directory,
    "temporary",
    "temporary_atc_and_ddd.xlsx"
  )
  download_or_use_cache(
    download_cached_source(
      whocc_temporary_url,
      destination,
      request = whocc_request(whocc_temporary_url),
      label = "WHOCC temporary ATC codes",
      max_age_hours = max_age_hours
    ),
    destination,
    "The WHOCC temporary ATC codes"
  )
}

download_whocc_alterations <- function(cache_directory =
                                         ".cache/downloads/whocc",
                                       max_age_hours =
                                         alterations_max_age_hours) {
  destination <- file.path(
    cache_directory,
    "alterations",
    "atc_alterations.html"
  )
  download_or_use_cache(
    download_cached_source(
      whocc_alterations_url,
      destination,
      request = whocc_request(whocc_alterations_url),
      label = "WHOCC ATC alterations",
      max_age_hours = max_age_hours
    ),
    destination,
    "The WHOCC ATC alterations"
  )
}

# The spreadsheets carry zero-width spaces and trailing blanks.
clean_whocc_text <- function(x) {
  x |>
    stringr::str_remove_all("[\\x{200B}\\x{FEFF}]") |>
    stringr::str_squish() |>
    dplyr::na_if("")
}

check_atc_code_format <- function(codes, source_name) {
  invalid <- codes[is.na(atc_code_level(codes))]
  if (length(invalid) > 0) {
    cli::cli_abort(c(
      "{source_name} has {length(invalid)} invalid ATC code{?s}; has its
      format changed?",
      x = "{.val {offender_values(invalid)}}"
    ))
  }
  invisible(codes)
}

read_whocc_sheet <- function(path, sheet_pattern) {
  sheets <- readxl::excel_sheets(path)
  sheet <- sheets[grepl(sheet_pattern, stringr::str_squish(sheets))]
  if (length(sheet) != 1) {
    cli::cli_abort(c(
      "{.file {basename(path)}} has {length(sheet)} sheet{?s} matching
      {.val {sheet_pattern}}; has the WHOCC format changed?",
      i = "Sheets: {.val {sheets}}"
    ))
  }
  cells <- readxl::read_excel(
    path,
    sheet = sheet,
    col_names = FALSE,
    col_types = "text",
    .name_repair = "unique_quiet"
  )
  header_row <- which(grepl("ATC code", cells[[1]], ignore.case = TRUE))[1]
  if (is.na(header_row) || ncol(cells) < 2) {
    cli::cli_abort(
      "Sheet {.val {sheet}} of {.file {basename(path)}} has no ATC code
      column; has the WHOCC format changed?"
    )
  }
  rows <- cells[-seq_len(header_row), ]
  classes <- dplyr::tibble(
    atc_code = clean_whocc_text(rows[[1]]),
    name = clean_whocc_text(rows[[2]])
  ) |>
    dplyr::filter(!is.na(.data$atc_code), !is.na(.data$name))
  check_atc_code_format(classes$atc_code, paste("Sheet", sheet))
  classes
}

# New codes from a yearly (final) or temporary WHOCC update list. The other
# sheets are not used: level alterations are in the cumulative list, and
# ChEMBL's names take precedence over name alterations.
read_whocc_updates <- function(path, url, status) {
  dplyr::bind_rows(
    read_whocc_sheet(path, "^New ATC 5th levels$"),
    read_whocc_sheet(path, "^New (ATC )?(3rd and 4th|4th and 3rd) levels$")
  ) |>
    dplyr::transmute(
      .data$atc_code,
      level = atc_code_level(.data$atc_code),
      .data$name,
      status = status,
      source = "whocc_updates",
      source_url = url
    )
}

# Notes that keep the previous code in use for other products: a split, or a
# move of some products only. "4th level only" (every B03AC product moved up
# a level) is a move of all products.
partial_move_pattern <- stringr::regex(
  "\\bsplit\\b|(?<!level )\\bonly\\b|previously classified in",
  ignore_case = TRUE
)

# Parsed without network access: the page is untrusted input.
whocc_html_options <- c("RECOVER", "NOERROR", "NOBLANKS", "NONET")

read_whocc_alterations <- function(path) {
  document <- xml2::read_html(
    path,
    encoding = "ISO-8859-1",
    options = whocc_html_options
  )
  rows <- xml2::xml_find_all(
    document,
    "//div[@class='listtable']//tr[count(td) = 4]"
  )
  if (length(rows) == 0) {
    cli::cli_abort(
      "The WHOCC ATC alterations page has no alteration rows; has its format
      changed?"
    )
  }
  notes <- purrr::map_chr(rows, function(row) {
    titles <- xml2::xml_attr(xml2::xml_find_all(row, ".//sup/a"), "title")
    paste(stringr::str_squish(titles), collapse = "\n")
  })
  # Footnote markers ("27)") are part of the cell text.
  xml2::xml_remove(xml2::xml_find_all(rows, ".//sup"))
  cell_text <- function(position) {
    xml2::xml_find_first(rows, paste0("./td[", position, "]")) |>
      xml2::xml_text() |>
      stringr::str_squish()
  }
  new_text <- cell_text(3)
  alterations <- dplyr::tibble(
    previous_code = cell_text(1),
    substance_name = dplyr::na_if(cell_text(2), ""),
    previous_name = stringr::str_match(
      notes,
      "(?m)Previous ATC level name: (.+?)\\.?$"
    )[, 2],
    new_code = stringr::str_extract(new_text, "^[A-Z][0-9]{2}[A-Z0-9]*"),
    is_deleted = grepl("^deleted", new_text, ignore.case = TRUE),
    changed_year = as.integer(stringr::str_extract(cell_text(4), "^\\d{4}$")),
    keeps_previous = stringr::str_detect(notes, partial_move_pattern)
  )
  check_atc_code_format(
    c(
      alterations$previous_code,
      alterations$new_code[!alterations$is_deleted]
    ),
    "The WHOCC ATC alterations list"
  )
  if (anyNA(alterations$changed_year)) {
    cli::cli_abort(
      "The WHOCC ATC alterations list has rows without a year; has its format
      changed?"
    )
  }
  dplyr::select(alterations, -"is_deleted")
}

follow_replacements <- function(code, next_code) {
  visited <- character()
  while (!is.na(code) && code %in% names(next_code) && !code %in% visited) {
    visited <- c(visited, code)
    code <- next_code[[code]]
  }
  code
}

# Codes WHO moved as a whole (one new code, or deleted), each with its old
# name and the code that holds its products now, through chains of moves
# (L01XX28 -> L01XE01 -> L01EA01); NA when deleted. Split codes stay in use,
# so they are not retired. The curated level-4 codes follow.
build_retired_atc_codes <- function(alterations,
                                    curated_levels =
                                      curated_retired_atc_levels) {
  from_alterations <- if (nrow(alterations) > 0) {
    retired_codes_from_alterations(alterations)
  }
  curated <- curated_levels |>
    dplyr::mutate(
      source = "whocc_index_archived",
      replacement_source = "curated"
    )
  dplyr::bind_rows(empty_retired_atc_codes(), from_alterations, curated) |>
    dplyr::mutate(level = atc_code_level(.data$atc_code)) |>
    dplyr::distinct(.data$atc_code, .keep_all = TRUE) |>
    dplyr::arrange(.data$atc_code)
}

retired_codes_from_alterations <- function(alterations) {
  moves <- alterations |>
    dplyr::summarise(
      new_code = dplyr::first(.data$new_code),
      is_move = !any(.data$keeps_previous) &
        dplyr::n_distinct(.data$new_code) == 1 &
        !any(.data$new_code %in% .data$previous_code),
      name = dplyr::coalesce(
        dplyr::first(.data$previous_name),
        dplyr::first(.data$substance_name)
      ),
      changed_year = min(.data$changed_year),
      .by = "previous_code"
    ) |>
    dplyr::filter(.data$is_move)
  next_code <- stats::setNames(moves$new_code, moves$previous_code)
  moves |>
    dplyr::transmute(
      atc_code = .data$previous_code,
      .data$name,
      replaced_by = purrr::map_chr(
        .data$new_code,
        follow_replacements,
        next_code
      ),
      .data$changed_year,
      source = "whocc_alterations",
      source_url = whocc_alterations_url,
      replacement_source = "whocc_alterations"
    )
}

empty_retired_atc_codes <- function() {
  dplyr::tibble(
    atc_code = character(),
    level = integer(),
    name = character(),
    replaced_by = character(),
    changed_year = integer(),
    source = character(),
    source_url = character(),
    replacement_source = character()
  )
}

empty_whocc_alterations <- function() {
  dplyr::tibble(
    previous_code = character(),
    substance_name = character(),
    previous_name = character(),
    new_code = character(),
    changed_year = integer(),
    keeps_previous = logical()
  )
}

read_whocc_updates_source <- function(source, status) {
  if (is.null(source)) {
    return(empty_whocc_classes())
  }
  read_whocc_updates(source$path, source$url, status)
}

# The WHOCC lists, downloaded or cached. A list that is neither adds no
# names or moves; the curated retired codes apply regardless.
read_whocc_sources <- function(whocc_directory) {
  updates_source <- download_whocc_updates(whocc_directory)
  temporary_source <- download_whocc_temporary(whocc_directory)
  alterations_source <- download_whocc_alterations(whocc_directory)
  alterations <- if (is.null(alterations_source)) {
    empty_whocc_alterations()
  } else {
    read_whocc_alterations(alterations_source$path)
  }
  list(
    updates_source = updates_source,
    temporary_source = temporary_source,
    alterations_source = alterations_source,
    final_classes = read_whocc_updates_source(updates_source, "current"),
    temporary_classes = read_whocc_updates_source(
      temporary_source,
      "temporary"
    ),
    retired_codes = build_retired_atc_codes(alterations)
  )
}

read_whocc_index_page <- function(html) {
  document <- xml2::read_html(
    html,
    encoding = "ISO-8859-1",
    options = whocc_html_options
  )
  content <- xml2::xml_find_first(document, "//div[@id='content']")
  index_version <- stringr::str_extract(
    xml2::xml_text(xml2::xml_find_first(document, "//div[@id='last_updated']")),
    "\\d{4}-\\d{2}-\\d{2}"
  )
  if (inherits(content, "xml_missing") || is.na(index_version)) {
    cli::cli_abort(
      "A WHOCC ATC/DDD Index page has no content or date; has its format
      changed?"
    )
  }
  # The path above the table names every ancestor; the table lists the code
  # itself or its children. A retired or unknown code is in neither.
  path_links <- xml2::xml_find_all(content, ".//b/a[contains(@href, 'code=')]")
  table_rows <- xml2::xml_find_all(content, ".//tr[td[2]/a]")
  classes <- dplyr::bind_rows(
    dplyr::tibble(
      atc_code = stringr::str_match(
        xml2::xml_attr(path_links, "href"),
        "code=([A-Z0-9]+)"
      )[, 2],
      name = xml2::xml_text(path_links)
    ),
    dplyr::tibble(
      atc_code = xml2::xml_text(xml2::xml_find_first(table_rows, "./td[1]")),
      name = xml2::xml_text(xml2::xml_find_first(table_rows, "./td[2]/a"))
    )
  ) |>
    dplyr::mutate(
      atc_code = stringr::str_squish(.data$atc_code),
      name = stringr::str_squish(.data$name)
    ) |>
    dplyr::distinct()
  check_atc_code_format(classes$atc_code, "A WHOCC ATC/DDD Index page")
  list(index_version = index_version, classes = classes)
}

# The page of a level-5 code's level-4 parent names all its siblings too.
whocc_index_page_code <- function(code) {
  dplyr::if_else(atc_code_level(code) == 5L, substr(code, 1, 5), code)
}

index_page_path <- function(cache_directory, page) {
  file.path(cache_directory, paste0(page, ".json"))
}

read_whocc_index_cache <- function(cache_directory) {
  paths <- list.files(cache_directory, "\\.json$", full.names = TRUE)
  pages <- purrr::map(paths, function(path) {
    cached <- jsonlite::fromJSON(path)
    classes <- if (length(cached$classes) == 0) {
      dplyr::tibble(atc_code = character(), name = character())
    } else {
      dplyr::as_tibble(cached$classes)
    }
    dplyr::tibble(
      page = cached$page,
      index_version = cached$index_version,
      retrieved = cached$retrieved,
      classes = list(classes)
    )
  })
  purrr::list_rbind(c(
    list(dplyr::tibble(
      page = character(),
      index_version = character(),
      retrieved = character(),
      classes = list()
    )),
    pages
  ))
}

# A page is kept for the index year it shows; an older one is checked again
# at most monthly, as the new index appears some time in January.
is_fresh_index_page <- function(index_version, retrieved, today = Sys.Date()) {
  substr(index_version, 1, 4) == format(today, "%Y") |
    as.Date(retrieved) > today - 30
}

warn_whocc_index_failure <- function(page, problem) {
  cli::cli_warn(
    "The WHOCC ATC/DDD Index request for {page} failed ({problem}); unnamed
    ATC codes stay unnamed until a later run."
  )
}

# The page's body, or NULL (with a warning) when the index cannot be read:
# the lookups only name codes, so a failure ends them, never the build.
fetch_whocc_index_page <- function(page) {
  response <- tryCatch(
    whocc_request(whocc_index_url(page)) |>
      httr2::req_error(is_error = function(response) FALSE) |>
      httr2::req_perform(),
    httr2_failure = function(error) {
      warn_whocc_index_failure(page, conditionMessage(error))
      NULL
    }
  )
  if (is.null(response)) {
    return(NULL)
  }
  status <- httr2::resp_status(response)
  if (status != 200) {
    warn_whocc_index_failure(page, paste("HTTP", status))
    return(NULL)
  }
  httr2::resp_body_raw(response)
}

# Fetches the index pages that could name `unnamed_codes` and are not cached
# yet (at most `max_pages`), and returns the number of requests made.
update_whocc_index_cache <- function(unnamed_codes,
                                     cache_directory,
                                     max_pages = whocc_index_max_pages,
                                     today = Sys.Date()) {
  cached <- read_whocc_index_cache(cache_directory)
  fresh_pages <- cached$page[
    is_fresh_index_page(cached$index_version, cached$retrieved, today) %in%
      TRUE
  ]
  pages <- unique(whocc_index_page_code(unnamed_codes))
  to_fetch <- utils::head(setdiff(pages, fresh_pages), max_pages)
  requests <- 0L
  dir.create(cache_directory, recursive = TRUE, showWarnings = FALSE)
  for (page in to_fetch) {
    cli::cli_inform("Looking up {page} in the WHOCC ATC/DDD Index.")
    html <- fetch_whocc_index_page(page)
    requests <- requests + 1L
    if (is.null(html)) {
      break
    }
    parsed <- read_whocc_index_page(html)
    jsonlite::write_json(
      list(
        page = page,
        url = whocc_index_url(page),
        index_version = parsed$index_version,
        retrieved = format(today),
        classes = parsed$classes
      ),
      index_page_path(cache_directory, page),
      auto_unbox = TRUE,
      pretty = TRUE
    )
  }
  requests
}

# Names from cached index pages, the newest index version first.
read_whocc_index_classes <- function(cache_directory) {
  cached <- read_whocc_index_cache(cache_directory) |>
    dplyr::arrange(dplyr::desc(.data$index_version), .data$page)
  purrr::list_rbind(c(
    list(dplyr::tibble(atc_code = character(), name = character())),
    cached$classes
  )) |>
    dplyr::distinct(.data$atc_code, .keep_all = TRUE) |>
    dplyr::transmute(
      .data$atc_code,
      level = atc_code_level(.data$atc_code),
      .data$name,
      status = "current",
      source = "whocc_index",
      source_url = whocc_index_url(.data$atc_code)
    )
}

whocc_licence <- paste(
  "© WHO Collaborating Centre for Drug Statistics Methodology, Oslo;",
  "reference to the WHOCC required, no commercial distribution, no changes"
)

whocc_attribution <- paste(
  "ATC codes and names © WHO Collaborating Centre for Drug Statistics",
  "Methodology, Oslo, Norway (https://atcddd.fhi.no), reproduced verbatim;",
  "not endorsed by the WHOCC."
)

whocc_source_entry <- function(name, source, version) {
  list(
    name = name,
    url = source$url,
    version = version,
    retrieved = substr(source$retrieved, 1, 10),
    licence = whocc_licence,
    attribution = whocc_attribution,
    last_modified = source$last_modified
  )
}

whocc_index_source_entry <- function(cache_directory) {
  cached <- read_whocc_index_cache(cache_directory)
  latest <- function(values) {
    if (length(values) == 0) NA_character_ else max(values)
  }
  list(
    name = "WHOCC ATC/DDD Index (single pages; archived copies)",
    url = paste0(whocc_url, "/atc_ddd_index/"),
    version = latest(cached$index_version),
    retrieved = latest(cached$retrieved),
    licence = whocc_licence,
    attribution = paste(
      whocc_attribution,
      "Names of the retired level-4 codes L01XC and L01XE from archived",
      "copies of the ATC/DDD Index 2020 (Internet Archive)."
    ),
    pages = nrow(cached)
  )
}
