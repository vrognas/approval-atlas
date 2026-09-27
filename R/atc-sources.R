empty_atc_sources <- function() {
  list(
    smpc_checks = empty_smpc_checks(),
    retired_codes = empty_retired_atc_codes(),
    whocc_classes = empty_whocc_classes(),
    name_corrections = empty_atc_name_corrections(),
    curated_codes = empty_curated_atc_codes()
  )
}

# Downloads and reads everything the ATC tables need besides ChEMBL: the
# WHOCC update lists and alterations, the SmPC checks (fetching up to
# `smpc_budget` product information PDFs), WHOCC index pages for codes no
# other source names, the WHO names that replace ChEMBL's, and the curated
# codes.
prepare_atc_sources <- function(clean_medicines,
                                epar_documents,
                                atc_class_rows,
                                downloads_directory,
                                output_directory,
                                smpc_budget) {
  whocc_directory <- file.path(downloads_directory, "whocc")
  whocc <- read_whocc_sources(whocc_directory)
  medicines <- build_medicines_table(clean_medicines) |>
    check_unique_product_numbers()
  documents <- build_documents_table(epar_documents, medicines)
  ema_codes <- build_atc_codes_table(clean_medicines)
  smpc_run <- update_smpc_checks(
    ema_codes,
    medicines,
    documents,
    file.path(downloads_directory, "ema-smpc"),
    file.path(output_directory, "ema_medicine_smpc_atc.json"),
    smpc_budget
  )
  index_directory <- file.path(whocc_directory, "index")
  chembl_classes <- build_chembl_atc_classes(atc_class_rows)
  curated_codes <- curated_atc_codes()
  index_requests <- look_up_unnamed_atc_codes(
    build_atc_codes_table(
      clean_medicines,
      smpc_run$checks,
      whocc$retired_codes,
      curated_codes
    ),
    smpc_run$checks,
    c(
      chembl_classes$atc_code,
      whocc$final_classes$atc_code,
      whocc$temporary_classes$atc_code,
      whocc$retired_codes$atc_code
    ),
    index_directory
  )
  list(
    smpc_checks = smpc_run$checks,
    retired_codes = whocc$retired_codes,
    whocc_classes = dplyr::bind_rows(
      whocc$final_classes,
      read_whocc_index_classes(index_directory),
      whocc$temporary_classes
    ),
    name_corrections = whocc$name_corrections,
    curated_codes = curated_codes,
    renamed_codes = renamed_atc_codes(chembl_classes, whocc$name_corrections),
    smpc_run = smpc_run,
    still_to_check = plan_smpc_checks(
      ema_codes,
      medicines,
      documents,
      smpc_run$checks,
      budget = nrow(medicines)
    ),
    index_requests = index_requests,
    source_entries = atc_source_entries(
      whocc,
      index_directory,
      smpc_run$checks
    )
  )
}

# Looks up in the WHOCC index the codes in use (and their prefixes) that no
# other source names; returns the number of requests made.
look_up_unnamed_atc_codes <- function(atc_codes,
                                      smpc_checks,
                                      named_codes,
                                      index_directory) {
  unnamed_codes <- setdiff(
    atc_prefix_set(atc_codes_in_use(atc_codes, smpc_checks)),
    c(named_codes, read_whocc_index_classes(index_directory)$atc_code)
  )
  update_whocc_index_cache(unnamed_codes, index_directory)
}

# The codes whose ChEMBL name a WHO name replaces, with both names.
renamed_atc_codes <- function(chembl_classes, name_corrections) {
  chembl_classes |>
    dplyr::select("atc_code", chembl_name = "name") |>
    dplyr::inner_join(
      name_corrections,
      by = "atc_code",
      relationship = "one-to-one"
    ) |>
    dplyr::filter(.data$chembl_name != .data$name) |>
    dplyr::select("atc_code", "chembl_name", "name", "source")
}

updates_source_entry <- function(updates) {
  if (is.null(updates)) {
    return(NULL)
  }
  whocc_source_entry(
    paste0(
      "WHOCC new ATC codes and alterations (ATC/DDD Index ",
      updates$year,
      ")"
    ),
    updates,
    paste("ATC/DDD Index", updates$year)
  )
}

# meta.json entries for the ATC sources; a WHOCC list this run went without
# has none.
atc_source_entries <- function(whocc, index_directory, smpc_checks) {
  temporary <- whocc$temporary_source
  alterations <- whocc$alterations_source
  purrr::compact(list(
    updates_source_entry(whocc$updates_source),
    updates_source_entry(whocc$previous_updates_source),
    if (!is.null(temporary)) {
      whocc_source_entry(
        "WHOCC temporary ATC codes (next ATC/DDD Index)",
        temporary,
        temporary$last_modified
      )
    },
    if (!is.null(alterations)) {
      whocc_source_entry(
        "WHOCC cumulative ATC alterations",
        alterations,
        paste(
          "ATC alterations to",
          max(whocc$retired_codes$changed_year, na.rm = TRUE)
        )
      )
    },
    whocc_index_source_entry(index_directory),
    smpc_source_entry(smpc_checks)
  ))
}

count_label <- function(counts, labels) {
  paste(
    purrr::map_chr(names(labels), function(value) {
      paste(sum(counts == value), labels[[value]])
    }),
    collapse = ", "
  )
}

report_atc_summary <- function(tables, atc_sources) {
  report_smpc_checks(tables$ema_medicine_smpc_atc, atc_sources$smpc_run)
  verdicts <- judge_smpc_atc_codes(
    tables$ema_medicine_atc_codes,
    tables$ema_medicine_smpc_atc,
    atc_sources$retired_codes
  )
  report_smpc_verdicts(
    verdicts,
    tables$ema_medicine_atc_codes,
    atc_sources$still_to_check
  )
  report_curated_atc_codes(judge_curated_atc_codes(
    tables$ema_medicine_atc_codes,
    atc_sources$curated_codes
  ))
  report_incomplete_atc_codes(
    tables$ema_medicine_atc_codes,
    tables$ema_medicines
  )
  report_retired_codes_in_use(tables$ema_medicine_atc_codes)
  report_renamed_atc_codes(atc_sources$renamed_codes)
  report_unnamed_atc_codes(tables, atc_sources$index_requests)
  invisible(verdicts)
}

report_smpc_checks <- function(smpc_checks, run) {
  checks <- dplyr::distinct(
    smpc_checks,
    .data$ema_product_number,
    .data$smpc_status
  )
  cli::cli_alert_info(paste0(
    sprintf(
      paste(
        "SmPC ATC checks: %d request%s this run (budget %d);",
        "%d products checked: "
      ),
      run$requests,
      if (run$requests == 1) "" else "s",
      run$budget,
      nrow(checks)
    ),
    count_label(checks$smpc_status, c(
      code_found = "code found",
      incomplete = "incomplete code",
      not_assigned = "not yet assigned",
      no_code = "no code",
      no_text = "no text",
      not_found = "not found"
    )),
    "."
  ))
  if (!is.na(run$stop_reason)) {
    cli::cli_alert_warning("SmPC checks stopped early: {run$stop_reason}.")
  }
}

report_smpc_verdicts <- function(verdicts, atc_codes, still_to_check) {
  report_smpc_verdict_counts(verdicts, atc_codes, still_to_check)
  report_smpc_code_list(
    verdicts,
    "conflict",
    "SmPC ATC codes used although EMA's code does not fit"
  )
  report_smpc_code_list(
    verdicts,
    "prefix_mismatch",
    "SmPC ATC codes rejected (EMA's code does not fit)"
  )
  report_smpc_code_list(
    verdicts,
    "ambiguous",
    "SmPC ATC codes not used (several for one EMA code, or one for several)"
  )
}

report_smpc_verdict_counts <- function(verdicts, atc_codes, still_to_check) {
  from_ema <- atc_codes$source == "ema"
  from_smpc <- atc_codes$atc_code_source == "ema_smpc"
  is_completed <- from_ema & from_smpc & !atc_codes$atc_code_conflict
  is_replaced <- from_ema & from_smpc & atc_codes$atc_code_conflict
  smpc_only <- atc_codes$source == "ema_smpc"
  products <- function(rows) {
    dplyr::n_distinct(atc_codes$ema_product_number[rows])
  }
  cli::cli_alert_info(paste0(
    sprintf(
      paste(
        "ATC codes from product information: %d EMA codes completed",
        "(%d products), %d replaced by a code that does not fit it",
        "(%d products), %d codes for %d products without an EMA code;",
        "SmPC codes: "
      ),
      sum(is_completed),
      products(is_completed),
      sum(is_replaced),
      products(is_replaced),
      sum(smpc_only),
      products(smpc_only)
    ),
    count_label(verdicts$verdict, c(
      imputed = "used",
      conflict = "used although EMA's code does not fit",
      ambiguous = "not used (ambiguous)",
      prefix_mismatch = "rejected (prefix mismatch)",
      not_deeper = "not deeper than EMA's",
      ema_complete = "EMA code already complete",
      no_ema_code = "used for products without an EMA code",
      curated = "replaced by a curated code"
    )),
    sprintf(
      "; %d Authorised products still to check.",
      sum(still_to_check$medicine_status == "Authorised")
    )
  ))
}

report_smpc_code_list <- function(verdicts, listed_verdict, heading) {
  listed <- verdicts |>
    dplyr::filter(.data$verdict == listed_verdict) |>
    dplyr::mutate(
      label = paste0(
        .data$ema_product_number, ": EMA ", .data$ema_codes,
        ", SmPC ", .data$smpc_code
      )
    )
  if (nrow(listed) > 0) {
    cli::cli_alert_warning(
      "{heading}:
      {.val {offender_values(listed$label, max_shown = nrow(listed))}}"
    )
  }
}

report_curated_atc_codes <- function(curated_verdicts) {
  verdict <- curated_verdicts$verdict
  is_used <- verdict %in% c("used", "conflict")
  cli::cli_alert_info(paste0(
    sprintf(
      "Curated ATC codes: %d used (%d although EMA's code does not fit)",
      sum(is_used),
      sum(verdict == "conflict")
    ),
    ", not used: ",
    count_label(verdict, c(
      smpc = "SmPC code used",
      ema_complete = "EMA code complete",
      rejected = "rejected",
      not_in_data = "not in the EMA data"
    )),
    "."
  ))
  labels <- sprintf(
    "%s %s",
    curated_verdicts$ema_product_number,
    curated_verdicts$atc_code
  )
  used_labels <- labels[is_used]
  if (length(used_labels) > 0) {
    cli::cli_alert_info(
      "Curated ATC codes used:
      {.val {offender_values(used_labels, max_shown = length(used_labels))}}"
    )
  }
  not_used <- curated_verdicts[!is_used, ]
  not_used_labels <- sprintf(
    "%s (%s; in use: %s)",
    labels[!is_used],
    not_used$verdict,
    dplyr::coalesce(not_used$in_use, "none")
  )
  if (length(not_used_labels) > 0) {
    cli::cli_alert_warning(
      "Curated ATC codes not used:
      {.val {offender_values(not_used_labels, max_shown = nrow(not_used))}}"
    )
  }
}

# Authorised products whose codes are not all at their final level, or
# which have none.
report_incomplete_atc_codes <- function(atc_codes, medicines) {
  codes <- atc_codes |>
    dplyr::summarise(
      is_complete = all(.data$atc_final_level),
      in_use = paste(unique(.data$atc_code), collapse = ", "),
      .by = "ema_product_number"
    )
  incomplete <- medicines |>
    dplyr::filter(.data$medicine_status == "Authorised") |>
    dplyr::left_join(codes, by = "ema_product_number") |>
    dplyr::filter(!.data$is_complete %in% TRUE)
  labels <- sprintf(
    "%s (%s): %s",
    incomplete$name_of_medicine,
    incomplete$ema_product_number,
    dplyr::coalesce(incomplete$in_use, "none")
  )
  if (length(labels) > 0) {
    cli::cli_alert_info(
      "{length(labels)} Authorised product{?s} without a complete ATC code:
      {.val {offender_values(labels, max_shown = length(labels))}}"
    )
  }
}

report_retired_codes_in_use <- function(atc_codes) {
  retired_in_use <- atc_codes[!is.na(atc_codes$current_atc_code), ]
  cli::cli_alert_info(sprintf(
    "Retired ATC codes in use: %d codes on %d products mapped to current ones.",
    dplyr::n_distinct(retired_in_use$atc_code),
    dplyr::n_distinct(retired_in_use$ema_product_number)
  ))
}

report_renamed_atc_codes <- function(renamed_codes) {
  labels <- sprintf(
    "%s: %s -> %s (%s)",
    renamed_codes$atc_code,
    renamed_codes$chembl_name,
    renamed_codes$name,
    renamed_codes$source
  )
  if (length(labels) > 0) {
    cli::cli_alert_info(
      "ATC names from the WHOCC instead of ChEMBL: {length(labels)} codes:
      {.val {offender_values(labels, max_shown = length(labels))}}"
    )
  }
}

report_unnamed_atc_codes <- function(tables, index_requests) {
  atc_codes <- tables$ema_medicine_atc_codes
  unnamed <- setdiff(
    atc_prefix_set(atc_codes_in_use(atc_codes, tables$ema_medicine_smpc_atc)),
    tables$atc_classes$atc_code
  )
  if (length(unnamed) > 0) {
    cli::cli_alert_warning(
      "{length(unnamed)} ATC code{?s} without a name
      ({index_requests} WHOCC index request{?s} this run):
      {.val {offender_values(unnamed, max_shown = 30)}}"
    )
  }
}
