mesh_listing_url <-
  "https://nlmpubs.nlm.nih.gov/projects/mesh/MESH_FILES/xmlmesh/"

# EMA free text that is not a MeSH string; MeSH lists "Acid Sphingomyelinase
# Deficiency" as an entry term of Niemann-Pick Diseases.
curated_mesh_terms <- c(
  "Acid sphingomyelinase deficiency (ASMD) type A/B or type B" = "D009542"
)

find_latest_mesh_year <- function(listing_html) {
  years <- stringr::str_match_all(listing_html, "desc(\\d{4})\\.gz")[[1]][, 2]
  if (length(years) == 0) {
    cli::cli_abort("The MeSH directory listing has no desc{{YYYY}}.gz file.")
  }
  max(years)
}

mesh_source_for_year <- function(year,
                                 cache_directory,
                                 last_modified = NA_character_) {
  list(
    year = year,
    url = paste0(mesh_listing_url, "desc", year, ".gz"),
    path = file.path(cache_directory, paste0("desc", year, ".xml")),
    last_modified = last_modified
  )
}

read_mesh_sidecar <- function(sidecar_path, cache_directory) {
  if (!file.exists(sidecar_path)) {
    return(NULL)
  }
  sidecar <- jsonlite::fromJSON(sidecar_path)
  mesh_source_for_year(
    sidecar$year,
    cache_directory,
    sidecar$last_modified %||% NA_character_
  )
}

write_mesh_sidecar <- function(mesh_source, sidecar_path) {
  jsonlite::write_json(
    mesh_source[c("year", "url", "last_modified")],
    sidecar_path,
    auto_unbox = TRUE,
    na = "null"
  )
}

fetch_latest_mesh_year <- function() {
  throttled_request(mesh_listing_url) |>
    httr2::req_perform() |>
    httr2::resp_body_string() |>
    find_latest_mesh_year()
}

download_mesh_descriptors <- function(cache_directory = ".cache/downloads/mesh",
                                      max_age_hours = 24) {
  sidecar_path <- file.path(cache_directory, "source.json")
  cached <- read_mesh_sidecar(sidecar_path, cache_directory)
  if (!is.null(cached) &&
        is_recent_file(sidecar_path, max_age_hours) &&
        file.exists(cached$path)) {
    cli::cli_inform("Using cached MeSH {cached$year} in {.path {cached$path}}.")
    return(cached)
  }

  mesh_source <- mesh_source_for_year(fetch_latest_mesh_year(), cache_directory)
  request <- throttled_request(mesh_source$url)
  can_revalidate <- !is.null(cached) &&
    identical(cached$year, mesh_source$year) &&
    !is.na(cached$last_modified) &&
    file.exists(mesh_source$path)
  if (can_revalidate) {
    cli::cli_inform("Checking MeSH {mesh_source$year} for changes.")
    request <- httr2::req_headers(
      request,
      `If-Modified-Since` = cached$last_modified
    )
  } else {
    cli::cli_inform(
      "Downloading MeSH {mesh_source$year} descriptors from
      {.url {mesh_source$url}} (about 313 MB once unpacked)."
    )
  }
  response <- download_to_file(request, mesh_source$path)
  if (httr2::resp_status(response) == 304) {
    cli::cli_inform(
      "MeSH {mesh_source$year} unchanged since {cached$last_modified}."
    )
    mesh_source$last_modified <- cached$last_modified
  } else {
    mesh_source$last_modified <- httr2::resp_header(
      response,
      "Last-Modified",
      default = NA_character_
    )
  }
  write_mesh_sidecar(mesh_source, sidecar_path)
  mesh_source
}

read_record_values <- function(records, descriptor_ui, xpath, column) {
  nodes <- xml2::xml_find_all(records, xpath, flatten = FALSE)
  values <- dplyr::tibble(
    descriptor_ui = rep(descriptor_ui, lengths(nodes)),
    value = as.character(unlist(lapply(nodes, xml2::xml_text)))
  )
  names(values)[2] <- column
  values
}

read_mesh_descriptors <- function(xml_path) {
  document <- xml2::read_xml(
    xml_path,
    options = c("NOBLANKS", "HUGE", "NONET")
  )
  records <- xml2::xml_find_all(
    document,
    "/DescriptorRecordSet/DescriptorRecord"
  )
  if (length(records) == 0) {
    cli::cli_abort("{.path {xml_path}} has no descriptor records.")
  }
  descriptors <- dplyr::tibble(
    descriptor_ui = xml2::xml_text(
      xml2::xml_find_first(records, "DescriptorUI")
    ),
    descriptor_name = xml2::xml_text(
      xml2::xml_find_first(records, "DescriptorName/String")
    )
  )
  is_incomplete <- is.na(descriptors$descriptor_ui) |
    is.na(descriptors$descriptor_name)
  if (any(is_incomplete)) {
    cli::cli_abort(c(
      "{sum(is_incomplete)} MeSH record{?s} without a descriptor UI or name;
      has the MeSH XML format changed?",
      x = "{.val {offender_values(descriptors$descriptor_ui[is_incomplete])}}"
    ))
  }
  list(
    descriptors = descriptors,
    tree_numbers = read_record_values(
      records,
      descriptors$descriptor_ui,
      "TreeNumberList/TreeNumber",
      "tree_number"
    ),
    terms = read_record_values(
      records,
      descriptors$descriptor_ui,
      "ConceptList/Concept/TermList/Term/String",
      "term"
    )
  )
}

load_mesh_descriptors <- function(mesh_source) {
  # Parsing the 313 MB file takes ~15 s and ~1.9 GB, so keep the result until
  # NLM publishes a new version.
  parsed_path <- file.path(
    dirname(mesh_source$path),
    paste0("descriptors-", mesh_source$year, ".rds")
  )
  if (!is.na(mesh_source$last_modified) && file.exists(parsed_path)) {
    parsed <- readRDS(parsed_path)
    if (identical(parsed$last_modified, mesh_source$last_modified)) {
      return(parsed$mesh)
    }
  }
  cli::cli_inform("Parsing MeSH {mesh_source$year} descriptors.")
  mesh <- read_mesh_descriptors(mesh_source$path)
  saveRDS(
    list(last_modified = mesh_source$last_modified, mesh = mesh),
    parsed_path
  )
  mesh
}

mesh_match_steps <- function(mesh) {
  terms <- dplyr::distinct(mesh$terms, .data$term, .data$descriptor_ui)
  list(
    list(
      source = "mesh_heading",
      key = identity,
      lookup = dplyr::select(
        mesh$descriptors,
        key = "descriptor_name",
        "descriptor_ui"
      )
    ),
    list(
      source = "entry_term",
      key = identity,
      lookup = dplyr::select(terms, key = "term", "descriptor_ui")
    ),
    list(
      source = "entry_term",
      key = stringr::str_to_lower,
      lookup = dplyr::distinct(
        terms,
        key = stringr::str_to_lower(.data$term),
        .data$descriptor_ui
      )
    ),
    list(
      source = "curated",
      key = identity,
      lookup = dplyr::tibble(
        key = names(curated_mesh_terms),
        descriptor_ui = unname(curated_mesh_terms)
      )
    )
  )
}

match_mesh_terms <- function(terms, mesh) {
  remaining <- unique(terms)
  matches <- list()
  for (step in mesh_match_steps(mesh)) {
    step_matches <- dplyr::tibble(
      therapeutic_area_mesh = remaining,
      key = step$key(remaining)
    ) |>
      dplyr::inner_join(
        step$lookup,
        by = "key",
        relationship = "many-to-many"
      ) |>
      dplyr::transmute(
        .data$therapeutic_area_mesh,
        mesh_descriptor_ui = .data$descriptor_ui,
        source = step$source
      )
    matches <- c(matches, list(step_matches))
    remaining <- setdiff(remaining, step_matches$therapeutic_area_mesh)
  }
  matches <- purrr::list_rbind(matches)
  check_one_descriptor_per_term(matches)
  dplyr::bind_rows(
    matches,
    dplyr::tibble(
      therapeutic_area_mesh = remaining,
      mesh_descriptor_ui = NA_character_,
      source = "unmatched"
    )
  ) |>
    dplyr::arrange(.data$therapeutic_area_mesh)
}

check_one_descriptor_per_term <- function(matches) {
  ambiguous <- matches |>
    dplyr::summarise(
      offender = paste0(
        dplyr::first(.data$therapeutic_area_mesh),
        " (",
        paste(.data$mesh_descriptor_ui, collapse = ", "),
        ")"
      ),
      n = dplyr::n(),
      .by = "therapeutic_area_mesh"
    ) |>
    dplyr::filter(.data$n > 1)
  if (nrow(ambiguous) > 0) {
    cli::cli_abort(c(
      "{nrow(ambiguous)} therapeutic area term{?s} match{?es/} more than one
      MeSH descriptor.",
      x = "{.val {offender_values(ambiguous$offender)}}"
    ))
  }
  invisible(matches)
}

build_area_branches_table <- function(term_matches, mesh) {
  descriptor_names <- dplyr::select(
    mesh$descriptors,
    mesh_descriptor_ui = "descriptor_ui",
    mesh_descriptor_name = "descriptor_name"
  )
  descriptor_branches <- mesh$tree_numbers |>
    dplyr::transmute(
      mesh_descriptor_ui = .data$descriptor_ui,
      branch = stringr::str_extract(.data$tree_number, "^[^.]+")
    ) |>
    dplyr::distinct()
  branch_names <- mesh$tree_numbers |>
    dplyr::filter(!grepl(".", .data$tree_number, fixed = TRUE)) |>
    dplyr::inner_join(mesh$descriptors, by = "descriptor_ui") |>
    dplyr::select(branch = "tree_number", branch_name = "descriptor_name")

  branches <- term_matches |>
    dplyr::left_join(
      descriptor_names,
      by = "mesh_descriptor_ui",
      na_matches = "never",
      relationship = "many-to-one"
    )
  unknown <- branches |>
    dplyr::filter(
      !is.na(.data$mesh_descriptor_ui),
      is.na(.data$mesh_descriptor_name)
    ) |>
    dplyr::mutate(
      offender = paste0(
        .data$therapeutic_area_mesh, " (", .data$mesh_descriptor_ui, ")"
      )
    )
  if (nrow(unknown) > 0) {
    cli::cli_abort(c(
      "{nrow(unknown)} matched MeSH descriptor{?s} not found in MeSH.",
      x = "{.val {offender_values(unknown$offender)}}"
    ))
  }
  branches |>
    dplyr::left_join(
      descriptor_branches,
      by = "mesh_descriptor_ui",
      na_matches = "never",
      relationship = "many-to-many"
    ) |>
    dplyr::left_join(
      branch_names,
      by = "branch",
      relationship = "many-to-one"
    ) |>
    dplyr::select(
      "therapeutic_area_mesh",
      "mesh_descriptor_ui",
      "mesh_descriptor_name",
      "branch",
      "branch_name",
      "source"
    ) |>
    dplyr::arrange(.data$therapeutic_area_mesh, .data$branch)
}
