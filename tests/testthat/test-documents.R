epar_url <- function(path) {
  paste0("https://www.ema.europa.eu/en/documents/", path)
}

medicine_url <- function(slug) {
  paste0("https://www.ema.europa.eu/en/medicines/human/EPAR/", slug)
}

# Real products whose documents are in the fixture; Aflunov's documents are
# filed under its withdrawn first application (000804).
document_medicines <- function() {
  dplyr::tibble(
    ema_product_number = paste0(
      "EMEA/H/C/",
      c("000112", "000697", "000804", "000854", "002094", "003933", "004090",
        "005679", "005752")
    ),
    name_of_medicine = c(
      "Twinrix Adult", "Suboxone", "Aflunov", "Alli", "Aflunov", "Fintepla",
      "Kymriah", "Agamree", "Tyruko"
    ),
    medicine_status = c(
      "Authorised", "Withdrawn", "Application withdrawn", "Withdrawn",
      "Authorised", "Authorised", "Authorised", "Authorised", "Authorised"
    ),
    medicine_url = medicine_url(c(
      "twinrix-adult", "suboxone", "aflunov-0", "alli", "aflunov", "fintepla",
      "kymriah", "agamree", "tyruko"
    ))
  )
}

fixture_documents_table <- function(medicines = document_medicines()) {
  build_documents_table(
    read_epar_documents(fixture_epar_documents_path())$data,
    medicines
  )
}

test_that("download_epar_documents fetches the EMA index with EMA spacing", {
  cache_directory <- file.path(tempfile(), "ema-documents")
  requested <- new.env()
  testthat::local_mocked_bindings(
    req_perform = function(req, path = NULL, ...) {
      requested$url <- req$url
      requested$realm <- req$policies$throttle_realm
      file.copy(fixture_epar_documents_path(), path)
      httr2::response(
        status_code = 200,
        headers = list(ETag = "\"1790394761\"")
      )
    },
    .package = "httr2"
  )
  expect_message(
    source <- download_epar_documents(cache_directory),
    "Downloading EMA EPAR documents index"
  )
  expect_identical(requested$url, epar_documents_url)
  expect_identical(requested$realm, "ema.europa.eu")
  expect_identical(
    source$path,
    file.path(cache_directory, "epar_documents.json")
  )
  expect_identical(source$etag, "\"1790394761\"")
})

test_that("epar_documents_url is the EMA EPAR documents JSON report", {
  expect_identical(
    epar_documents_url,
    paste0(
      "https://www.ema.europa.eu/en/documents/report/",
      "documents-output-epar_documents_json-report_en.json"
    )
  )
})

test_that("read_epar_documents keeps meta and the fields in use", {
  documents <- read_epar_documents(fixture_epar_documents_path())
  expect_identical(documents$meta$total_records, 72L)
  expect_identical(documents$meta$timestamp, "2026-09-26T05:49:47Z")
  expect_s3_class(documents$data, "tbl_df")
  expect_identical(nrow(documents$data), 72L)
  expect_named(documents$data, epar_document_fields)
})

test_that("read_epar_documents aborts on a count or field mismatch", {
  documents <- jsonlite::fromJSON(fixture_epar_documents_path())
  path <- tempfile(fileext = ".json")
  documents$meta$total_records <- 71L
  jsonlite::write_json(documents, path, auto_unbox = TRUE)
  expect_error(read_epar_documents(path), "71")

  documents$meta$total_records <- 72L
  documents$data$document_url <- NULL
  jsonlite::write_json(documents, path, auto_unbox = TRUE)
  expect_error(read_epar_documents(path), "document_url")
})

test_that("parse_document_date keeps the date part of EMA timestamps", {
  expect_identical(
    parse_document_date(c("2026-09-21T13:40:00Z", "", NA)),
    as.Date(c("2026-09-21", NA, NA))
  )
})

test_that("parse_document_date aborts on anything but an EMA timestamp", {
  error <- expect_error(
    parse_document_date(
      c("2026-09-21T13:40:00Z", "21/09/2026", "2026-02-30T00:00:00Z")
    ),
    class = "rlang_error"
  )
  expect_match(conditionMessage(error), "2 invalid document dates")
  expect_match(conditionMessage(error), "21/09/2026", fixed = TRUE)
})

test_that("document_url_slug is the medicine part of the file name", {
  expect_identical(
    document_url_slug(epar_url(c(
      "overview/aflunov-epar-medicine-overview_en.pdf",
      "product-information/arikayce-liposomal-product-information_en.pdf",
      paste0(
        "procedural-steps-after/arikayce-liposomal-procedural-steps-taken-",
        "scientific-information-after-authorisation_en.pdf"
      ),
      paste0(
        "variation-report/aflunov-h-c-2094-ii-0007-g-epar-assessment-",
        "report-variation_en.pdf"
      ),
      "variation-report/fintepla-pam-0000303483-epar-assessment-report_en.pdf",
      paste0(
        "variation-report/mounjaro-vr-0000281937-epar-assessment-report-",
        "variation_en.pdf"
      ),
      paste0(
        "variation-report/kymriah-h-c-004090-p46-012-epar-assessment-",
        "report_en.pdf-1"
      )
    ))),
    c(
      "aflunov", "arikayce-liposomal", "arikayce-liposomal", "aflunov",
      "fintepla", "mounjaro", "kymriah"
    )
  )
})

test_that("build_documents_table keeps English PDFs of the selected types", {
  documents <- fixture_documents_table()
  expect_named(
    documents,
    c(
      "ema_product_number", "document_type", "title", "url",
      "first_published_date", "last_updated_date", "link_method", "source"
    )
  )
  expect_setequal(
    unique(documents$document_type),
    c(
      "product-information", "assessment-report", "scientific-discussion",
      "variation-report", "overview", "rmp-summary",
      "procedural-steps-after"
    )
  )
  expect_true(all(grepl(
    "^https://www\\.ema\\.europa\\.eu/en/documents/.*_en\\.pdf(-[0-9]+)?$",
    documents$url
  )))
  expect_identical(unique(documents$source), "ema_epar_documents")
  expect_s3_class(documents$last_updated_date, "Date")
  expect_false(any(is.na(documents$title)))
  expect_false(any(documents$title != stringr::str_squish(documents$title)))
  kymriah_reports <- documents$url[
    documents$ema_product_number == "EMEA/H/C/004090" &
      grepl("p46-012-", documents$url)
  ]
  expect_length(kymriah_reports, 4)
})

test_that("build_documents_table links by the squished product number", {
  documents <- fixture_documents_table()
  expect_in(
    documents$ema_product_number,
    document_medicines()$ema_product_number
  )
  agamree <- documents[documents$ema_product_number == "EMEA/H/C/005679", ]
  expect_identical(agamree$document_type, "assessment-report")
  expect_identical(agamree$link_method, "product_number")
  alli <- documents[documents$ema_product_number == "EMEA/H/C/000854", ]
  expect_identical(alli$first_published_date, as.Date("2009-04-30"))
  expect_identical(alli$last_updated_date, as.Date(NA))
  expect_false("EMEA/H/C/005752" %in% documents$ema_product_number)
})

test_that("build_documents_table falls back to the URL slug when unlinked", {
  documents <- fixture_documents_table()
  product_documents <- function(product_number) {
    documents[documents$ema_product_number == product_number, ]
  }
  withdrawn_twin <- product_documents("EMEA/H/C/000804")
  authorised <- product_documents("EMEA/H/C/002094")
  expect_identical(nrow(authorised), 6L)
  expect_identical(unique(authorised$link_method), "url_slug")
  expect_identical(unique(withdrawn_twin$link_method), "product_number")
  expect_setequal(authorised$url, withdrawn_twin$url)
  expect_identical(
    unique(documents$link_method[
      documents$ema_product_number != "EMEA/H/C/002094"
    ]),
    "product_number"
  )
})

test_that("missing product information of a medicine is linked by slug", {
  # As with Aripiprazole Mylan Pharma (003803), whose current product
  # information is filed under its withdrawn twin application (003926).
  documents <- read_epar_documents(fixture_epar_documents_path())$data
  is_refiled <- documents$ema_product_number == "EMEA/H/C/003933" &
    documents$type %in% c("product-information", "overview")
  documents$ema_product_number[is_refiled] <- "EMEA/H/C/003000"
  fintepla <- build_documents_table(documents, document_medicines()) |>
    dplyr::filter(.data$ema_product_number == "EMEA/H/C/003933")
  is_product_information <- fintepla$document_type == "product-information"
  expect_identical(fintepla$link_method[is_product_information], "url_slug")
  expect_identical(
    unique(fintepla$link_method[!is_product_information]),
    "product_number"
  )
  # Other slug matches can belong to a sibling application: not linked.
  expect_false("overview" %in% fintepla$document_type)
})

test_that("only Authorised medicines get documents by URL slug", {
  medicines <- document_medicines()
  is_aflunov <- medicines$ema_product_number == "EMEA/H/C/002094"
  medicines$medicine_status[is_aflunov] <- "Withdrawn"
  documents <- fixture_documents_table(medicines)
  expect_false("EMEA/H/C/002094" %in% documents$ema_product_number)
})

test_that("build_documents_table sorts by product, type and newest first", {
  documents <- fixture_documents_table()
  expect_identical(
    documents,
    dplyr::arrange(
      documents,
      .data$ema_product_number,
      .data$document_type,
      dplyr::desc(.data$last_updated_date),
      .data$url
    )
  )
  fintepla_reports <- documents[
    documents$ema_product_number == "EMEA/H/C/003933" &
      documents$document_type == "variation-report",
  ]
  expect_identical(
    fintepla_reports$last_updated_date[1:2],
    as.Date(c("2026-09-23", "2026-09-21"))
  )
})

# Rows of the documents table as the pipeline built them on 2026-09-29:
# Mylotarg's first application (refused in 2008; EMA lists the authorized
# 004204's documents under it too), Ledaga's two overviews of the same day and
# title, and a Kinzalkomb referral report.
real_document_rows <- function() {
  dplyr::tibble(
    ema_product_number = paste0(
      "EMEA/H/C/",
      c("000415", "000705", "000705", "000705", "000705", "000705",
        "002826", "002826")
    ),
    document_type = c(
      "assessment-report", "assessment-report", "assessment-report",
      "overview", "product-information", "rmp-summary", "overview", "overview"
    ),
    title = c(
      "Kinzalkomb-H-C-415-A31-0084 : EPAR - Assessment Report - Article 31",
      "Mylotarg : EPAR - Public assessment report",
      "Mylotarg : EPAR - Refusal public assessment report",
      "Mylotarg : EPAR - Summary for the public",
      "Mylotarg : EPAR - Product Information",
      "Mylotarg : EPAR - Risk-management-plan summary",
      "Ledaga : EPAR - Summary for the public",
      "Ledaga : EPAR - Summary for the public"
    ),
    url = epar_url(c(
      paste0(
        "assessment-report/kinzalkomb-h-c-415-a31-0084-epar-assessment-report-",
        "article-31_en.pdf"
      ),
      "assessment-report/mylotarg-epar-public-assessment-report_en.pdf",
      "assessment-report/mylotarg-epar-refusal-public-assessment-report_en.pdf",
      "overview/mylotarg-epar-summary-public_en.pdf",
      "product-information/mylotarg-epar-product-information_en.pdf",
      "rmp-summary/mylotarg-epar-risk-management-plan-summary_en.pdf",
      "overview/ledaga-epar-summary-public_en.pdf-0",
      "overview/ledaga-epar-summary-public_en.pdf"
    )),
    first_published_date = as.Date(c(
      "2014-10-03", "2018-05-04", "2008-04-17", "2018-05-04", "2018-05-04",
      "2022-07-21", "2017-03-16", "2017-03-16"
    )),
    last_updated_date = as.Date(c(
      "2014-10-03", "2018-05-04", "2008-04-17", "2018-05-04", "2025-09-17",
      "2022-07-21", "2017-03-16", "2017-03-16"
    )),
    link_method = "product_number",
    source = "ema_epar_documents"
  )
}

test_that("primary documents keep the newest of each kind the card can show", {
  primary <- build_primary_documents_table(real_document_rows())
  expect_named(
    primary,
    c(
      "ema_product_number", "document_type", "refusal_report", "url",
      "last_updated_date"
    )
  )
  # Mylotarg: its product information, standard EPAR, refusal report and
  # overview (the frontend picks by status); no referral report or RMP summary.
  mylotarg <- primary[primary$ema_product_number == "EMEA/H/C/000705", ]
  expect_identical(
    mylotarg$document_type,
    c(
      "assessment-report", "assessment-report", "overview",
      "product-information"
    )
  )
  expect_identical(mylotarg$refusal_report, c(FALSE, TRUE, FALSE, FALSE))
  expect_identical(
    mylotarg$last_updated_date,
    as.Date(c("2018-05-04", "2008-04-17", "2018-05-04", "2025-09-17"))
  )
  expect_false("EMEA/H/C/000415" %in% primary$ema_product_number)
  # Ledaga: two overviews of the same day and title; the first by URL.
  ledaga <- primary[primary$ema_product_number == "EMEA/H/C/002826", ]
  expect_identical(
    ledaga$url,
    epar_url("overview/ledaga-epar-summary-public_en.pdf")
  )
})

test_that("primary documents skip archive files and non-https links", {
  rows <- real_document_rows()
  mylotarg_rows <- rows$ema_product_number == "EMEA/H/C/000705"
  newer <- rows[mylotarg_rows & rows$document_type == "product-information", ]
  newer$title <- paste(newer$title, "(archive)")
  newer$url <- sub("_en", "-archive_en", newer$url, fixed = TRUE)
  newer$last_updated_date <- as.Date("2026-06-06")
  insecure <- rows[mylotarg_rows & rows$document_type == "overview", ]
  insecure$url <- sub("https://", "http://", insecure$url, fixed = TRUE)
  insecure$last_updated_date <- as.Date("2026-01-01")
  primary <- build_primary_documents_table(
    dplyr::bind_rows(rows, newer, insecure)
  )
  mylotarg <- primary[primary$ema_product_number == "EMEA/H/C/000705", ]
  expect_identical(
    mylotarg$url[mylotarg$document_type == "product-information"],
    epar_url("product-information/mylotarg-epar-product-information_en.pdf")
  )
  expect_identical(
    mylotarg$url[mylotarg$document_type == "overview"],
    epar_url("overview/mylotarg-epar-summary-public_en.pdf")
  )
})

test_that("primary documents of the fixture pipeline are one row per kind", {
  primary <- build_primary_documents_table(fixture_documents_table())
  expect_identical(
    anyDuplicated(
      primary[c("ema_product_number", "document_type", "refusal_report")]
    ),
    0L
  )
  expect_setequal(primary$document_type, primary_document_types)
})

test_that("report_documents_coverage counts and warns without failing", {
  medicines <- document_medicines()
  documents <- fixture_documents_table(medicines)
  messages <- testthat::capture_messages(
    report_documents_coverage(documents, medicines)
  )
  expect_match(
    messages,
    "Documents: 4 of 6 Authorised medicines have product information",
    all = FALSE
  )
  expect_match(
    messages,
    "5 of 6 have an assessment report or scientific discussion",
    all = FALSE
  )
  expect_match(messages, "1 linked by URL slug", all = FALSE)
  expect_match(
    messages,
    "2 Authorised medicines without product information:.*Agamree.*Tyruko",
    all = FALSE
  )
})

test_that("epar_documents_source_entry credits EMA with the index version", {
  entry <- epar_documents_source_entry(
    list(
      url = epar_documents_url,
      last_modified = "Sat, 26 Sep 2026 03:52:41 GMT",
      retrieved = "2026-09-26T15:30:56Z"
    ),
    "2026-09-26T05:49:47Z"
  )
  expect_named(
    entry,
    c(
      "name", "url", "version", "retrieved", "licence", "attribution",
      "last_modified"
    )
  )
  expect_identical(
    entry$name,
    "European Medicines Agency (EMA) EPAR documents index"
  )
  expect_identical(entry$version, "2026-09-26T05:49:47Z")
  expect_identical(entry$retrieved, "2026-09-26")
  expect_identical(entry$attribution, ema_attribution)
})
