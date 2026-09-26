chembl_api_url <- "https://www.ebi.ac.uk/chembl/api/data/"

fetch_chembl_release <- function(cache_directory = ".cache/downloads/chembl",
                                 max_age_hours = 24) {
  status_path <- file.path(cache_directory, "status.json")
  if (!is_recent_file(status_path, max_age_hours)) {
    cli::cli_inform("Checking the ChEMBL release.")
    download_to_file(
      throttled_request(paste0(chembl_api_url, "status.json")),
      status_path
    )
  }
  release <- jsonlite::fromJSON(status_path)$chembl_db_version
  # The release names a cache folder, so accept only the documented form.
  is_valid <- is.character(release) && length(release) == 1 &&
    grepl("^chembl_[0-9]+$", release, ignore.case = TRUE)
  if (!is_valid) {
    cli::cli_abort(
      "ChEMBL status has no valid {.field chembl_db_version}:
      {.val {format(release %||% 'missing')}}."
    )
  }
  release
}

download_chembl_atc_classes <- function(release,
                                        cache_directory =
                                          ".cache/downloads/chembl") {
  path <- file.path(cache_directory, release, "atc_class.json")
  if (file.exists(path)) {
    cli::cli_inform("Using cached {release} ATC classes in {.path {path}}.")
    return(path)
  }
  cli::cli_inform("Downloading {release} ATC classes from ChEMBL.")
  pages <- list()
  offset <- 0L
  repeat {
    page <- throttled_request(paste0(chembl_api_url, "atc_class.json")) |>
      httr2::req_url_query(limit = 1000L, offset = offset) |>
      httr2::req_perform() |>
      httr2::resp_body_string() |>
      jsonlite::fromJSON()
    pages <- c(pages, list(dplyr::as_tibble(page$atc)))
    if (is.null(page$page_meta$`next`)) {
      break
    }
    offset <- offset + 1000L
  }
  atc_class_rows <- purrr::list_rbind(pages)
  if (!isTRUE(nrow(atc_class_rows) == page$page_meta$total_count)) {
    cli::cli_abort(
      "ChEMBL reports {page$page_meta$total_count} ATC classes but
      {nrow(atc_class_rows)} were downloaded."
    )
  }
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  write_json_table(atc_class_rows, path)
  path
}

build_atc_classes <- function(atc_class_rows) {
  # ChEMBL repeats levels 1-4 on every level-5 row; names stay verbatim
  # because the WHO Collaborating Centre forbids modifying them.
  group_levels <- purrr::map(1:4, function(level) {
    code_column <- paste0("level", level)
    name_column <- paste0("level", level, "_description")
    dplyr::tibble(
      atc_code = atc_class_rows[[code_column]],
      level = level,
      name = atc_class_rows[[name_column]]
    )
  })
  substance_level <- dplyr::tibble(
    atc_code = atc_class_rows$level5,
    level = 5L,
    name = atc_class_rows$who_name
  )
  classes <- purrr::list_rbind(c(group_levels, list(substance_level))) |>
    dplyr::distinct() |>
    dplyr::mutate(source = "chembl_atc_class") |>
    dplyr::arrange(.data$atc_code)
  duplicated_codes <- classes$atc_code[duplicated(classes$atc_code)]
  if (length(duplicated_codes) > 0) {
    cli::cli_abort(c(
      "{length(unique(duplicated_codes))} ATC code{?s} ha{?s/ve} more than one
      name in ChEMBL.",
      x = "{.val {offender_values(duplicated_codes)}}"
    ))
  }
  classes
}

atc_code_level <- function(code) {
  dplyr::case_when(
    stringr::str_detect(code, "^[A-Z]$") ~ 1L,
    stringr::str_detect(code, "^[A-Z][0-9]{2}$") ~ 2L,
    stringr::str_detect(code, "^[A-Z][0-9]{2}[A-Z]$") ~ 3L,
    stringr::str_detect(code, "^[A-Z][0-9]{2}[A-Z]{2}$") ~ 4L,
    stringr::str_detect(code, "^[A-Z][0-9]{2}[A-Z]{2}[0-9]{2}$") ~ 5L,
    .default = NA_integer_
  )
}

build_atc_codes_table <- function(clean_medicines) {
  build_lookup_table(
    clean_medicines,
    "atc_code_human",
    placeholder_values = "Not yet assigned"
  ) |>
    dplyr::mutate(
      atc_level = atc_code_level(.data$atc_code_human),
      atc_incomplete = is.na(.data$atc_level) | .data$atc_level < 5L,
      source = "ema"
    )
}
