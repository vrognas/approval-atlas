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

empty_whocc_classes <- function() {
  dplyr::tibble(
    atc_code = character(),
    level = integer(),
    name = character(),
    status = character(),
    source = character(),
    source_url = character()
  )
}

# ChEMBL's table, plus names from WHOCC sources for codes the data uses that
# ChEMBL lacks (`whocc_classes` in order of precedence, then the retired
# codes' old names); WHO names in `name_corrections` replace any other name
# they differ from. Every code gets its WHO status: retired codes name the
# code that replaced them, and `status_source` where that comes from (a
# row's `source` names only where its name comes from).
build_atc_classes <- function(atc_class_rows,
                              whocc_classes = empty_whocc_classes(),
                              retired_codes = empty_retired_atc_codes(),
                              used_codes = character(),
                              name_corrections =
                                empty_atc_name_corrections()) {
  chembl_classes <- build_chembl_atc_classes(atc_class_rows)
  used_prefixes <- atc_prefix_set(used_codes)
  retired_names <- retired_codes |>
    dplyr::transmute(
      .data$atc_code,
      .data$level,
      .data$name,
      status = "retired",
      .data$source,
      .data$source_url
    )
  added_classes <- dplyr::bind_rows(whocc_classes, retired_names) |>
    dplyr::filter(
      .data$atc_code %in% used_prefixes,
      !.data$atc_code %in% chembl_classes$atc_code,
      !is.na(.data$name)
    ) |>
    dplyr::distinct(.data$atc_code, .keep_all = TRUE)
  classes <- dplyr::bind_rows(chembl_classes, added_classes)
  classes |>
    dplyr::rows_update(
      dplyr::anti_join(name_corrections, classes, by = c("atc_code", "name")),
      by = "atc_code",
      unmatched = "ignore"
    ) |>
    dplyr::left_join(
      dplyr::select(
        retired_codes,
        "atc_code",
        "replaced_by",
        "changed_year",
        status_source = "replacement_source"
      ),
      by = "atc_code",
      relationship = "one-to-one"
    ) |>
    dplyr::mutate(
      status = dplyr::case_when(
        !is.na(.data$changed_year) ~ "retired",
        .default = dplyr::coalesce(.data$status, "current")
      )
    ) |>
    dplyr::select(
      "atc_code",
      "level",
      "name",
      "source",
      "status",
      "replaced_by",
      "changed_year",
      "status_source",
      "source_url"
    ) |>
    dplyr::arrange(.data$atc_code)
}

build_chembl_atc_classes <- function(atc_class_rows) {
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

atc_prefix_lengths <- c(1L, 3L, 4L, 5L, 7L)

# The valid prefixes of one code, level 1 first. A malformed code keeps its
# valid start only ("LX1XX02" -> "L").
atc_code_prefixes <- function(code) {
  if (is.na(code)) {
    return(character())
  }
  candidates <- substring(
    code,
    1,
    atc_prefix_lengths[atc_prefix_lengths <= nchar(code)]
  )
  is_valid <- dplyr::coalesce(
    atc_code_level(candidates) == seq_along(candidates),
    FALSE
  )
  candidates[cumprod(is_valid) == 1]
}

# Every valid prefix of any of the codes.
atc_prefix_set <- function(codes) {
  as.character(unique(unlist(purrr::map(codes, atc_code_prefixes))))
}

longest_atc_prefix <- function(codes) {
  purrr::map_chr(codes, function(code) {
    prefixes <- atc_code_prefixes(code)
    if (length(prefixes) == 0) NA_character_ else prefixes[length(prefixes)]
  })
}

# The code that holds a retired code's products now; NA for codes in use
# (and for deleted ones).
current_atc_codes <- function(codes, retired_codes) {
  retired_codes$replaced_by[match(codes, retired_codes$atc_code)]
}

# An SmPC code fits EMA's code when it is under EMA's (valid) prefix, or when
# WHO moved codes from under that prefix to it: EMA's L01XE and the SmPC's
# L01EA01 (L01XE01 moved to L01EA01 in 2021).
is_consistent_atc_code <- function(smpc_codes, ema_codes, retired_codes) {
  ema_prefixes <- longest_atc_prefix(ema_codes)
  current_smpc_codes <- dplyr::coalesce(
    current_atc_codes(smpc_codes, retired_codes),
    smpc_codes
  )
  current_prefixes <- dplyr::coalesce(
    current_atc_codes(ema_prefixes, retired_codes),
    ema_prefixes
  )
  moved_from_prefix <- purrr::map2_lgl(
    current_smpc_codes,
    ema_prefixes,
    function(code, prefix) {
      targets <- retired_codes$replaced_by[
        startsWith(retired_codes$atc_code, dplyr::coalesce(prefix, ""))
      ]
      targets <- targets[!is.na(targets)]
      any(startsWith(code, targets))
    }
  )
  is.na(ema_prefixes) |
    startsWith(smpc_codes, dplyr::coalesce(ema_prefixes, "")) |
    startsWith(current_smpc_codes, dplyr::coalesce(ema_prefixes, "")) |
    startsWith(current_smpc_codes, dplyr::coalesce(current_prefixes, "")) |
    moved_from_prefix
}

# Every SmPC code of a product paired with each of its EMA codes; an SmPC
# code completes an EMA code when EMA's is incomplete (never a level-5 code),
# the SmPC code fits it and goes deeper. It is used only when no other SmPC
# code completes the same EMA code: the site keeps one row per EMA code.
# An incomplete EMA code nothing completes is replaced by a deeper SmPC code
# that fits none of the product's EMA codes (a conflict, user decision
# 2026-09-27), when that is its only such code and the code replaces no
# other EMA code.
pair_smpc_atc_codes <- function(ema_codes, smpc_checks, retired_codes) {
  smpc_codes <- smpc_checks |>
    dplyr::filter(!is.na(.data$atc_code)) |>
    dplyr::select(
      "ema_product_number",
      smpc_code = "atc_code",
      "document_url",
      "document_last_updated_date"
    )
  smpc_codes |>
    dplyr::inner_join(
      dplyr::select(
        ema_codes,
        "ema_product_number",
        "atc_code_human",
        "atc_incomplete"
      ),
      by = "ema_product_number",
      relationship = "many-to-many"
    ) |>
    dplyr::mutate(
      is_consistent = is_consistent_atc_code(
        .data$smpc_code,
        .data$atc_code_human,
        retired_codes
      ),
      is_deeper = atc_code_level(.data$smpc_code) >
        dplyr::coalesce(
          atc_code_level(longest_atc_prefix(.data$atc_code_human)),
          0L
        ),
      completes = .data$atc_incomplete & .data$is_consistent & .data$is_deeper
    ) |>
    dplyr::mutate(
      completions = sum(.data$completes),
      .by = c("ema_product_number", "atc_code_human")
    ) |>
    dplyr::mutate(
      conflicts = .data$atc_incomplete & .data$is_deeper &
        .data$completions == 0 & !any(.data$is_consistent),
      replaced_codes = sum(.data$conflicts),
      .by = c("ema_product_number", "smpc_code")
    ) |>
    dplyr::mutate(
      is_used = (.data$completes & .data$completions == 1) |
        (.data$conflicts & sum(.data$conflicts) == 1 &
           .data$replaced_codes == 1),
      is_conflict = .data$is_used & .data$conflicts,
      .by = c("ema_product_number", "atc_code_human")
    )
}

# "{product} {EMA code}" of each EMA code a curated code replaced.
curated_ema_code_keys <- function(ema_codes) {
  is_curated <- ema_codes$atc_code_source == "curated"
  paste(
    ema_codes$ema_product_number[is_curated],
    ema_codes$atc_code_human[is_curated]
  )
}

# One verdict per product and SmPC code: "imputed", "conflict" (replaces an
# EMA code it does not fit), "ambiguous" (competes with another SmPC code
# for an EMA code, or would replace several), "prefix_mismatch" (fits none
# of EMA's codes and is not used), "not_deeper" (fits, but EMA's code is as
# deep), "ema_complete" (all EMA codes are level 5), "no_ema_code" (used
# as it is) or "curated" (a curated code replaced it, as it was not at its
# final level; with or without an EMA code). `atc_codes` may hold the rows
# of products without an EMA code.
judge_smpc_atc_codes <- function(atc_codes, smpc_checks, retired_codes) {
  ema_codes <- atc_codes[atc_codes$source == "ema", ]
  smpc_only <- atc_codes$source == "ema_smpc"
  kept_smpc_codes <- paste(
    atc_codes$ema_product_number[smpc_only],
    atc_codes$atc_code[smpc_only]
  )
  curated_products <- atc_codes$ema_product_number[
    atc_codes$source == "curated"
  ]
  curated_ema_codes <- curated_ema_code_keys(ema_codes)
  paired <- pair_smpc_atc_codes(ema_codes, smpc_checks, retired_codes) |>
    dplyr::mutate(
      is_replaced = .data$is_used &
        paste(.data$ema_product_number, .data$atc_code_human) %in%
          curated_ema_codes
    ) |>
    dplyr::summarise(
      verdict = dplyr::case_when(
        any(.data$is_replaced) ~ "curated",
        any(.data$is_conflict) ~ "conflict",
        any(.data$is_used) ~ "imputed",
        any(.data$completes | .data$conflicts) ~ "ambiguous",
        !any(.data$atc_incomplete) ~ "ema_complete",
        any(.data$is_consistent) ~ "not_deeper",
        .default = "prefix_mismatch"
      ),
      ema_codes = paste(unique(.data$atc_code_human), collapse = ", "),
      .by = c("ema_product_number", "smpc_code")
    )
  without_ema_code <- smpc_checks |>
    dplyr::filter(
      !is.na(.data$atc_code),
      !.data$ema_product_number %in% ema_codes$ema_product_number
    ) |>
    dplyr::transmute(
      .data$ema_product_number,
      smpc_code = .data$atc_code,
      verdict = dplyr::if_else(
        .data$ema_product_number %in% curated_products &
          !paste(.data$ema_product_number, .data$atc_code) %in%
            kept_smpc_codes,
        "curated",
        "no_ema_code"
      ),
      ema_codes = NA_character_
    )
  dplyr::bind_rows(paired, without_ema_code) |>
    dplyr::arrange(.data$ema_product_number, .data$smpc_code)
}

# Level-4 codes WHO no longer subdivides: the WHOCC alterations list moved
# their level-5 codes up to them (B03AC in 2014: "ATC 5th levels deleted, all
# products classified on the 4th level").
final_atc_levels <- function(retired_codes) {
  is_moved_up <- dplyr::coalesce(
    retired_codes$level == 5L &
      retired_codes$replaced_by == substr(retired_codes$atc_code, 1, 5),
    FALSE
  )
  unique(retired_codes$replaced_by[is_moved_up])
}

# A code is at its final level at level 5, or at a level-4 code WHO no
# longer subdivides.
is_final_atc_level <- function(codes, retired_codes) {
  dplyr::coalesce(atc_code_level(codes) == 5L, FALSE) |
    codes %in% final_atc_levels(retired_codes)
}

# One row per EMA code as published (atc_code_human, atc_level,
# atc_incomplete, source "ema") and one per SmPC or curated code of a
# product without an EMA code, with the code the site uses (atc_code),
# whether that code is complete (atc_final_level) and the current code of a
# retired one.
build_atc_codes_table <- function(clean_medicines,
                                  smpc_checks = empty_smpc_checks(),
                                  retired_codes = empty_retired_atc_codes(),
                                  curated_codes = empty_curated_atc_codes()) {
  ema_codes <- build_lookup_table(
    clean_medicines,
    "atc_code_human",
    placeholder_values = "Not yet assigned"
  ) |>
    dplyr::mutate(
      atc_level = atc_code_level(.data$atc_code_human),
      atc_incomplete = is.na(.data$atc_level) | .data$atc_level < 5L,
      source = "ema"
    )
  dplyr::bind_rows(
    complete_ema_atc_codes(
      ema_codes,
      smpc_checks,
      retired_codes,
      curated_codes
    ),
    unassigned_atc_codes(
      clean_medicines,
      ema_codes,
      smpc_checks,
      curated_codes,
      retired_codes
    )
  ) |>
    dplyr::mutate(
      atc_final_level = is_final_atc_level(.data$atc_code, retired_codes),
      current_atc_code = current_atc_codes(.data$atc_code, retired_codes),
      current_atc_code_source = dplyr::if_else(
        is.na(.data$current_atc_code),
        NA_character_,
        retired_codes$replacement_source[
          match(.data$atc_code, retired_codes$atc_code)
        ]
      )
    ) |>
    dplyr::relocate(
      "atc_code_source",
      "atc_code_conflict",
      "atc_final_level",
      .after = "atc_code"
    ) |>
    dplyr::arrange(
      .data$ema_product_number,
      .data$atc_code_human,
      .data$atc_code
    )
}

# The curated codes in the shape of SmPC checks: the evidence page stands in
# for the product information, the date it was checked for its date.
curated_codes_as_checks <- function(curated_codes) {
  dplyr::transmute(
    curated_codes,
    .data$ema_product_number,
    .data$atc_code,
    document_url = .data$evidence_url,
    document_last_updated_date = .data$checked_date
  )
}

# The candidate codes (SmPC checks, or curated codes in their shape) that
# replace an EMA code, one row per EMA code.
used_atc_codes <- function(ema_codes, candidates, retired_codes, code_source) {
  pair_smpc_atc_codes(ema_codes, candidates, retired_codes) |>
    dplyr::filter(.data$is_used) |>
    dplyr::transmute(
      .data$ema_product_number,
      .data$atc_code_human,
      atc_code = .data$smpc_code,
      atc_code_source = code_source,
      atc_code_conflict = .data$is_conflict,
      atc_code_document_url = .data$document_url,
      atc_code_document_date = .data$document_last_updated_date
    )
}

# EMA's codes with the code the site uses: EMA's; when EMA's is incomplete,
# the one the SmPC gives ("ema_smpc"; EMA's when several SmPC codes complete
# it); when that is not at its final level either, a curated one ("curated",
# judged against EMA's code under the same rules; never in place of an SmPC
# code at its final level); `atc_code_conflict` when the code used does not
# fit EMA's.
complete_ema_atc_codes <- function(ema_codes,
                                   smpc_checks,
                                   retired_codes,
                                   curated_codes) {
  from_smpc <- used_atc_codes(ema_codes, smpc_checks, retired_codes, "ema_smpc")
  completed_by_smpc <- from_smpc[
    is_final_atc_level(from_smpc$atc_code, retired_codes),
  ]
  still_incomplete <- ema_codes |>
    dplyr::mutate(
      atc_incomplete = .data$atc_incomplete &
        !paste(.data$ema_product_number, .data$atc_code_human) %in%
          paste(
            completed_by_smpc$ema_product_number,
            completed_by_smpc$atc_code_human
          )
    )
  from_curated <- used_atc_codes(
    still_incomplete,
    curated_codes_as_checks(curated_codes),
    retired_codes,
    "curated"
  )
  used <- dplyr::bind_rows(
    dplyr::anti_join(
      from_smpc,
      from_curated,
      by = c("ema_product_number", "atc_code_human")
    ),
    from_curated
  )
  ema_codes |>
    dplyr::left_join(
      used,
      by = c("ema_product_number", "atc_code_human"),
      relationship = "one-to-one"
    ) |>
    dplyr::mutate(
      atc_code_source = dplyr::coalesce(.data$atc_code_source, "ema"),
      atc_code_conflict = dplyr::coalesce(.data$atc_code_conflict, FALSE),
      atc_code = dplyr::coalesce(.data$atc_code, .data$atc_code_human)
    )
}

# One row per SmPC code of a product in EMA's data without an EMA code
# (missing or "Not yet assigned"), every level, or per curated code when its
# SmPC gives none. When none of its SmPC codes is at its final level, a
# curated code replaces an SmPC code as it would an incomplete EMA code. The
# source of such a row is its atc_code_source; atc_level and atc_incomplete
# describe EMA's published code, so they stay NA and FALSE: atc_final_level
# tells whether the code is complete.
unassigned_atc_codes <- function(clean_medicines,
                                 ema_codes,
                                 smpc_checks,
                                 curated_codes,
                                 retired_codes) {
  unassigned <- setdiff(
    clean_medicines$ema_product_number,
    ema_codes$ema_product_number
  )
  smpc_codes <- smpc_checks |>
    dplyr::filter(
      !is.na(.data$atc_code),
      .data$ema_product_number %in% unassigned
    )
  curated <- curated_codes_as_checks(curated_codes) |>
    dplyr::filter(.data$ema_product_number %in% unassigned)
  completed_by_smpc <- smpc_codes$ema_product_number[
    is_final_atc_level(smpc_codes$atc_code, retired_codes)
  ]
  from_curated <- used_atc_codes(
    dplyr::transmute(
      smpc_codes,
      .data$ema_product_number,
      atc_code_human = .data$atc_code,
      atc_incomplete = !.data$ema_product_number %in% completed_by_smpc
    ),
    curated,
    retired_codes,
    "curated"
  )
  dplyr::bind_rows(
    ema_smpc = dplyr::anti_join(
      smpc_codes,
      from_curated,
      by = c("ema_product_number", atc_code = "atc_code_human")
    ),
    curated = dplyr::filter(
      curated,
      !.data$ema_product_number %in% smpc_codes$ema_product_number
    ),
    .id = "atc_code_source"
  ) |>
    dplyr::transmute(
      .data$ema_product_number,
      .data$atc_code,
      .data$atc_code_source,
      atc_code_conflict = FALSE,
      atc_code_document_url = .data$document_url,
      atc_code_document_date = .data$document_last_updated_date
    ) |>
    dplyr::bind_rows(dplyr::select(from_curated, -"atc_code_human")) |>
    dplyr::distinct() |>
    dplyr::transmute(
      .data$ema_product_number,
      atc_code_human = NA_character_,
      atc_level = NA_integer_,
      atc_incomplete = FALSE,
      source = .data$atc_code_source,
      .data$atc_code,
      .data$atc_code_source,
      .data$atc_code_conflict,
      .data$atc_code_document_url,
      .data$atc_code_document_date
    )
}

# One verdict per curated code: "used", "conflict" (used although it does
# not fit EMA's code), "smpc" (the product's code comes from its SmPC, at its
# final level), "ema_complete" (EMA's code is complete), "rejected" (not
# deeper than EMA's code, or than an SmPC code in EMA's role, does not fit
# and cannot replace it, or ambiguous) or "not_in_data"; `in_use` lists the
# codes the product uses.
judge_curated_atc_codes <- function(atc_codes, curated_codes) {
  products <- atc_codes |>
    dplyr::summarise(
      is_incomplete = any(.data$source == "ema" & .data$atc_incomplete) |
        !any(.data$source == "ema"),
      from_smpc = any(
        .data$atc_code_source == "ema_smpc" & .data$atc_final_level
      ),
      in_use = paste(unique(.data$atc_code), collapse = ", "),
      .by = "ema_product_number"
    )
  used <- atc_codes |>
    dplyr::filter(.data$atc_code_source == "curated") |>
    dplyr::summarise(
      is_conflict = any(.data$atc_code_conflict),
      .by = c("ema_product_number", "atc_code")
    )
  curated_codes |>
    dplyr::select("ema_product_number", "atc_code") |>
    dplyr::left_join(used, by = c("ema_product_number", "atc_code")) |>
    dplyr::left_join(products, by = "ema_product_number") |>
    dplyr::transmute(
      .data$ema_product_number,
      .data$atc_code,
      verdict = dplyr::case_when(
        .data$is_conflict ~ "conflict",
        !is.na(.data$is_conflict) ~ "used",
        is.na(.data$from_smpc) ~ "not_in_data",
        .data$from_smpc ~ "smpc",
        !.data$is_incomplete ~ "ema_complete",
        .default = "rejected"
      ),
      .data$in_use
    )
}

atc_codes_in_use <- function(atc_codes, smpc_checks) {
  codes <- c(
    atc_codes$atc_code_human,
    atc_codes$atc_code,
    atc_codes$current_atc_code,
    smpc_checks$atc_code
  )
  sort(unique(codes[!is.na(codes)]), method = "radix")
}
