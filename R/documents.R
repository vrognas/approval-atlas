epar_documents_url <- paste0(
  "https://www.ema.europa.eu/en/documents/report/",
  "documents-output-epar_documents_json-report_en.json"
)

epar_document_fields <- c(
  "name",
  "type",
  "ema_product_number",
  "first_published_date",
  "last_updated_date",
  "document_url"
)

epar_document_types <- c(
  "product-information",
  "assessment-report",
  "scientific-discussion",
  "variation-report",
  "scientific-discussion-variation",
  "overview",
  "rmp-summary",
  "procedural-steps-after"
)

# English PDFs only; "-0"/"-1" suffixes are EMA's copies of re-uploaded files.
english_pdf_pattern <-
  "^https://www\\.ema\\.europa\\.eu/en/documents/.+_en\\.pdf(-[0-9]+)?$"

download_epar_documents <- function(cache_directory =
                                      ".cache/downloads/ema-documents",
                                    max_age_hours =
                                      daily_source_max_age_hours) {
  download_cached_source(
    epar_documents_url,
    file.path(cache_directory, "epar_documents.json"),
    request = ema_request(epar_documents_url),
    label = "EMA EPAR documents index",
    max_age_hours = max_age_hours
  )
}

read_epar_documents <- function(path) {
  documents <- jsonlite::fromJSON(path)
  documents$data |>
    check_source_fields(epar_document_fields, "The EMA EPAR documents index") |>
    check_record_count(documents$meta)
  list(
    meta = documents$meta,
    data = dplyr::as_tibble(documents$data[epar_document_fields])
  )
}

parse_document_date <- function(x) {
  # EMA timestamps are Amsterdam local time labelled "Z", so only the date
  # part is right.
  is_present <- !is.na(x) & x != ""
  dates <- as.Date(substr(x, 1, 10), format = "%Y-%m-%d")
  is_invalid <- is_present & (
    is.na(dates) |
      !grepl("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$", x)
  )
  if (any(is_invalid)) {
    cli::cli_abort(c(
      "{sum(is_invalid)} invalid document date{?s} (expected
      YYYY-MM-DDThh:mm:ssZ).",
      x = "{.val {offender_values(x[is_invalid])}}"
    ))
  }
  dplyr::if_else(is_present, dates, as.Date(NA))
}

# The medicine part of a document file name, which is the slug of the
# medicine's EMA page ("aflunov-epar-medicine-overview_en.pdf" -> "aflunov").
document_url_slug <- function(document_url) {
  document_url |>
    basename() |>
    stringr::str_remove("_en\\.pdf(-[0-9]+)?$") |>
    stringr::str_remove(paste0(
      "-(epar|h-c|h-ch|pam|vr|psusa|procedural-steps|product-information)",
      "(-.*)?$"
    ))
}

select_epar_documents <- function(documents) {
  documents |>
    dplyr::transmute(
      ema_product_number = stringr::str_squish(.data$ema_product_number),
      document_type = .data$type,
      title = stringr::str_squish(.data$name),
      url = .data$document_url,
      first_published_date = parse_document_date(.data$first_published_date),
      last_updated_date = parse_document_date(.data$last_updated_date)
    ) |>
    dplyr::filter(
      startsWith(.data$ema_product_number, "EMEA/H/C/"),
      .data$document_type %in% epar_document_types,
      grepl(english_pdf_pattern, .data$url)
    )
}

build_documents_table <- function(documents, medicines) {
  candidates <- select_epar_documents(documents)
  by_number <- candidates |>
    dplyr::semi_join(medicines, by = "ema_product_number") |>
    dplyr::mutate(link_method = "product_number")
  # Some documents are filed under an earlier withdrawn or refused
  # application of the same medicine; its page slug still matches.
  authorised_slugs <- medicines |>
    dplyr::filter(
      .data$medicine_status == "Authorised",
      !is.na(.data$medicine_url)
    ) |>
    dplyr::transmute(
      .data$ema_product_number,
      slug = basename(.data$medicine_url)
    )
  by_slug <- candidates |>
    dplyr::mutate(slug = document_url_slug(.data$url)) |>
    dplyr::select(-"ema_product_number") |>
    dplyr::inner_join(
      authorised_slugs,
      by = "slug",
      relationship = "many-to-many"
    ) |>
    # A medicine with documents of its own takes only its missing product
    # information by slug: other slug matches (renewal or referral reports)
    # can belong to a sibling application.
    dplyr::filter(
      !.data$ema_product_number %in% by_number$ema_product_number |
        .data$document_type == "product-information"
    ) |>
    dplyr::anti_join(
      by_number,
      by = c("ema_product_number", "document_type")
    ) |>
    dplyr::mutate(link_method = "url_slug")
  dplyr::bind_rows(by_number, by_slug) |>
    dplyr::mutate(source = "ema_epar_documents") |>
    dplyr::select(
      "ema_product_number",
      "document_type",
      "title",
      "url",
      "first_published_date",
      "last_updated_date",
      "link_method",
      "source"
    ) |>
    dplyr::arrange(
      .data$ema_product_number,
      .data$document_type,
      dplyr::desc(.data$last_updated_date),
      .data$url
    )
}

# The rows the medicine card's buttons and the tables' PI / EPAR links can
# show (site/src/documents.js primaryDocuments()), so a phone gets them from a
# small file instead of the whole documents index: per medicine and type, the
# newest current (not "(archive)") product information, standard EPAR and
# overview, and the newest refusal report (an assessment report whose own
# title names a refusal: a refused medicine's EPAR). The frontend still picks
# by the medicine's status. Ties on the date go by title, then URL, as the
# frontend sorts the documents index.
build_primary_documents_table <- function(documents) {
  documents |>
    dplyr::filter(
      .data$document_type %in% primary_document_types,
      startsWith(.data$url, "https://"),
      !grepl("\\(archive\\)\\s*$", .data$title, ignore.case = TRUE)
    ) |>
    dplyr::mutate(
      own_title = .data$document_type == "assessment-report" &
        !grepl(
          "EPAR - Public assessment report\\s*$",
          .data$title,
          ignore.case = TRUE
        ),
      refusal_report = .data$own_title &
        grepl("refusal", .data$title, ignore.case = TRUE)
    ) |>
    dplyr::filter(!.data$own_title | .data$refusal_report) |>
    dplyr::arrange(
      .data$ema_product_number,
      .data$document_type,
      .data$refusal_report,
      dplyr::desc(.data$last_updated_date),
      .data$title,
      .data$url,
      .locale = "en"
    ) |>
    dplyr::slice_head(
      n = 1,
      by = c("ema_product_number", "document_type", "refusal_report")
    ) |>
    dplyr::select(
      "ema_product_number",
      "document_type",
      "refusal_report",
      "url",
      "last_updated_date"
    )
}

primary_document_types <- c(
  "product-information",
  "assessment-report",
  "overview"
)

report_documents_coverage <- function(documents, medicines) {
  authorised <- medicines[medicines$medicine_status == "Authorised", ]
  has_type <- function(types) {
    authorised$ema_product_number %in%
      documents$ema_product_number[documents$document_type %in% types]
  }
  has_product_information <- has_type("product-information")
  has_assessment <- has_type(c("assessment-report", "scientific-discussion"))
  slug_linked <- dplyr::n_distinct(
    documents$ema_product_number[documents$link_method == "url_slug"]
  )
  cli::cli_alert_info(sprintf(
    paste(
      "Documents: %d of %d Authorised medicines have product information;",
      "%d of %d have an assessment report or scientific discussion;",
      "%d linked by URL slug."
    ),
    sum(has_product_information),
    nrow(authorised),
    sum(has_assessment),
    nrow(authorised),
    slug_linked
  ))
  missing <- authorised$name_of_medicine[!has_product_information]
  if (length(missing) > 0) {
    cli::cli_alert_warning(
      "{length(missing)} Authorised medicine{?s} without product information:
      {.val {offender_values(missing, max_shown = 20)}}"
    )
  }
  invisible(documents)
}

epar_documents_source_entry <- function(source, source_timestamp) {
  list(
    name = "European Medicines Agency (EMA) EPAR documents index",
    url = source$url,
    version = source_timestamp,
    retrieved = substr(source$retrieved, 1, 10),
    licence = "© European Medicines Agency; reuse with acknowledgement",
    attribution = ema_attribution,
    last_modified = source$last_modified
  )
}
