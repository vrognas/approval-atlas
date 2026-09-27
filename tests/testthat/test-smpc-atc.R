# Section 5.1 of the Aucatzyl product information (EMEA/H/C/005907), as
# pdftools reads it: the code wraps onto the next line.
aucatzyl_text <- paste0(
  "5.1   Pharmacodynamic properties\n\n",
  "Pharmacotherapeutic group: Antineoplastic agents, Antineoplastic cell and ",
  "gene therapy, ATC code:\nL01XL12.\n\nMechanism of action\n\n",
  "Obecabtagene autoleucel is an autologous CD19-directed T-cell therapy."
)

# Its labelling: "BATCH" contains "ATC".
aucatzyl_label_text <- paste0(
  "12.   MARKETING AUTHORISATION NUMBER(S)\n\nEU/1/25/1951/001\n\n\n",
  "13.   BATCH NUMBER, DONATION AND PRODUCT CODES\n\nAph ID:\nCOI ID:\n"
)

test_that("smpc_budget_from_env reads a whole number or uses the default", {
  expect_identical(smpc_budget_from_env(""), 8L)
  expect_identical(smpc_budget_from_env("25"), 25L)
  expect_identical(smpc_budget_from_env("0"), 0L)
  expect_error(smpc_budget_from_env("-1"), "APPROVAL_ATLAS_SMPC_BUDGET")
  expect_error(smpc_budget_from_env("all"), "all")
})

test_that("extract_smpc_atc_codes reads a code wrapped onto the next line", {
  expect_identical(
    extract_smpc_atc_codes(paste(aucatzyl_text, aucatzyl_label_text)),
    list(status = "code_found", codes = "L01XL12")
  )
})

test_that("extract_smpc_atc_codes ignores BATCH and text without a code", {
  expect_identical(
    extract_smpc_atc_codes(aucatzyl_label_text),
    list(status = "no_code", codes = character())
  )
  expect_identical(
    extract_smpc_atc_codes("Pharmacotherapeutic group: vaccines, ATC code: "),
    list(status = "no_code", codes = character())
  )
})

test_that("extract_smpc_atc_codes recognises not yet assigned codes", {
  expect_identical(
    extract_smpc_atc_codes(
      "Pharmacotherapeutic group: not yet assigned, ATC code: not yet assigned."
    ),
    list(status = "not_assigned", codes = character())
  )
  expect_identical(
    extract_smpc_atc_codes("ATC Code: Not assigned\n"),
    list(status = "not_assigned", codes = character())
  )
})

test_that("extract_smpc_atc_codes marks codes above level 5 incomplete", {
  expect_identical(
    extract_smpc_atc_codes(
      "Pharmacotherapeutic group: Other antineoplastic agents, ATC code: L01XX"
    ),
    list(status = "incomplete", codes = "L01XX")
  )
})

test_that("extract_smpc_atc_codes keeps distinct codes of every SmPC", {
  repeated <- paste(
    "Tablets 10 mg ... ATC code: C09DB01\n",
    "Tablets 20 mg ... ATC code: C09DB01\n"
  )
  expect_identical(
    extract_smpc_atc_codes(repeated),
    list(status = "code_found", codes = "C09DB01")
  )
  expect_identical(
    extract_smpc_atc_codes("ATC codes: A10AE54 and A10BJ03.")$codes,
    c("A10AE54", "A10BJ03")
  )
  expect_identical(
    extract_smpc_atc_codes("ATC code: L04AC\n13\n\nMechanism")$codes,
    "L04AC13"
  )
  expect_identical(
    extract_smpc_atc_codes("ATC-code: L04AC 13.")$codes,
    "L04AC13"
  )
})

# Section 5.1 of five product information PDFs as pdftools reads them
# (fetched 2026-09-27): "ATC" and "code" on two lines.
line_broken_labels <- c(
  "EMEA/H/C/006554" = paste0(
    "Pharmacotherapeutic group: Other haematological agents, drugs used in ",
    "hereditary angioedema, ATC\ncode: B06AC09.\n\nMechanism of action"
  ),
  "EMEA/H/C/004829" = paste0(
    "Pharmacotherapeutic group: Antibacterials for systemic use, other ",
    "beta-lactam antibacterials. ATC\ncode: J01DI04\n\nMechanism of action"
  ),
  "EMEA/H/C/005102" = paste0(
    "Pharmacotherapeutic group: Other antineoplastic agents, antineoplastic ",
    "cell and gene therapy, ATC\ncode: L01XL06.\n\nMechanism of action"
  ),
  "EMEA/H/C/004648" = paste0(
    "Pharmacotherapeutic group: analgesics, calcitonin gene-related peptide ",
    "(CGRP) antagonists, ATC\ncode: N02CD02\n\nMechanism of action"
  ),
  "EMEA/H/C/005287" = paste0(
    "Pharmacotherapeutic group: analgesics, calcitonin gene-related peptide ",
    "(CGRP) antagonists, ATC\ncode: N02CD05.\n\nMechanism of action"
  )
)

test_that("extract_smpc_atc_codes reads a label broken across two lines", {
  expect_identical(
    purrr::map_chr(line_broken_labels, function(text) {
      extract_smpc_atc_codes(paste(text, aucatzyl_label_text))$codes
    }),
    c(
      "EMEA/H/C/006554" = "B06AC09",
      "EMEA/H/C/004829" = "J01DI04",
      "EMEA/H/C/005102" = "L01XL06",
      "EMEA/H/C/004648" = "N02CD02",
      "EMEA/H/C/005287" = "N02CD05"
    )
  )
  expect_identical(
    extract_smpc_atc_codes(line_broken_labels[[1]])$status,
    "code_found"
  )
})

test_that("extract_smpc_atc_codes reads (ATC) code", {
  # Tryngolza (EMEA/H/C/006477), section 5.1.
  tryngolza_text <- paste0(
    "Pharmacotherapeutic group: lipid modifying agents, other lipid ",
    "modifying agents, anatomical\ntherapeutic chemical (ATC) code: not yet ",
    "assigned\n\nMechanism of action"
  )
  expect_identical(
    extract_smpc_atc_codes(tryngolza_text),
    list(status = "not_assigned", codes = character())
  )
  expect_identical(
    extract_smpc_atc_codes("(ATC) code: L01XL06")$codes,
    "L01XL06"
  )
})

test_that("extract_smpc_atc_codes reads a letter O in a digit as a zero", {
  # Helicobacter Test INFAI (EMEA/H/C/000140): a page number follows.
  helicobacter_text <- paste0(
    "Pharmacotherapeutic group: Other diagnostic agents, ATC code: VO4CX\n\n",
    "                                                     3\n\n",
    "For the amount of 75 mg 13C-urea"
  )
  expect_identical(
    extract_smpc_atc_codes(helicobacter_text),
    list(status = "incomplete", codes = "V04CX")
  )
  expect_identical(
    extract_smpc_atc_codes("ATC code: A1OBJO6")$codes,
    "A10BJ06"
  )
  expect_identical(
    zero_for_letter_o(c("VO4CX", "OO1", "V")),
    c("V04CX", "O01", "V")
  )
})

test_that("extract_smpc_atc_codes reports a document without text", {
  expect_identical(
    extract_smpc_atc_codes(" \n\f "),
    list(status = "no_text", codes = character())
  )
  expect_identical(extract_smpc_atc_codes(NA_character_)$status, "no_text")
})

test_that("read_pdf_text reads every page of a PDF", {
  path <- tempfile(fileext = ".pdf")
  grDevices::pdf(path)
  graphics::plot.new()
  graphics::text(0.5, 0.5, "ATC code: L01XL12")
  graphics::plot.new()
  graphics::text(0.5, 0.5, "Package leaflet")
  grDevices::dev.off()
  text <- read_pdf_text(path)
  expect_match(text, "ATC code: L01XL12", fixed = TRUE)
  expect_match(text, "Package leaflet", fixed = TRUE)
  expect_identical(extract_smpc_atc_codes(text)$codes, "L01XL12")
})

pi_url <- function(slug) {
  paste0(
    "https://www.ema.europa.eu/en/documents/product-information/",
    slug,
    "-epar-product-information_en.pdf"
  )
}

example_check <- function(product = "EMEA/H/C/005907",
                          slug = "aucatzyl",
                          document_date = "2025-08-19",
                          checked_date = "2026-09-27",
                          status = "code_found",
                          codes = "L01XL12",
                          reader_version = smpc_reader_version) {
  dplyr::tibble(
    ema_product_number = product,
    document_url = pi_url(slug),
    document_last_updated_date = as.Date(document_date),
    checked_date = as.Date(checked_date),
    reader_version = reader_version,
    smpc_status = status,
    atc_code = codes,
    source = "ema_smpc"
  )
}

test_that("read_smpc_checks reads written checks and handles missing files", {
  expect_identical(
    read_smpc_checks(file.path(tempfile(), "none.json")),
    empty_smpc_checks()
  )
  path <- tempfile(fileext = ".json")
  checks <- dplyr::bind_rows(
    example_check(),
    example_check("EMEA/H/C/006420", "boey", status = "not_assigned",
                  codes = NA_character_)
  )
  write_json_table(checks, path)
  expect_identical(read_smpc_checks(path), checks)
  write_json_table(checks[2, ], path)
  expect_identical(read_smpc_checks(path), checks[2, ])
  write_json_table(empty_smpc_checks(), path)
  expect_identical(read_smpc_checks(path), empty_smpc_checks())
})

test_that("read_smpc_checks dates checks without a reader version to 1", {
  path <- tempfile(fileext = ".json")
  write_json_table(dplyr::select(example_check(), -"reader_version"), path)
  expect_identical(
    read_smpc_checks(path),
    example_check(reader_version = 1L)
  )
})

test_that("merge_smpc_checks keeps each product's newest check", {
  old <- example_check(checked_date = "2026-09-01", status = "not_assigned",
                       codes = NA_character_)
  new <- example_check(
    document_date = "2026-09-20",
    checked_date = "2026-09-27"
  )
  other <- example_check("EMEA/H/C/003933", "fintepla", codes = "N03AX26")
  expect_identical(
    merge_smpc_checks(dplyr::bind_rows(old, other), dplyr::bind_rows(new, old)),
    dplyr::bind_rows(other, new)
  )
  expect_identical(merge_smpc_checks(), empty_smpc_checks())
})

test_that("merge_smpc_checks prefers the newer reader on the same day", {
  old <- example_check(status = "no_code", codes = NA_character_,
                       reader_version = 1L)
  new <- example_check()
  expect_identical(merge_smpc_checks(old, new), new)
})

plan_medicines <- function() {
  dplyr::tibble(
    ema_product_number = paste0("EMEA/H/C/00000", 1:6),
    medicine_status = c(
      "Authorised", "Withdrawn", "Authorised", "Authorised", "Authorised",
      "Authorised"
    )
  )
}

plan_atc_codes <- function() {
  dplyr::tibble(
    ema_product_number = paste0("EMEA/H/C/00000", c(1, 2, 3, 4, 4)),
    atc_code_human = c("L01XL", "L04AC", "A10AB04", "J07BX", "J07BX03"),
    atc_incomplete = c(TRUE, TRUE, FALSE, TRUE, FALSE)
  )
}

plan_documents <- function() {
  dplyr::tibble(
    ema_product_number = paste0("EMEA/H/C/00000", c(1, 2, 3, 4, 5, 5, 6)),
    document_type = c(
      rep("product-information", 5), "assessment-report", "overview"
    ),
    url = c(pi_url(c("one", "two", "three", "four", "five")), "a.pdf", "b"),
    last_updated_date = as.Date(c(
      "2025-01-01", "2026-05-01", "2026-01-01", "2024-01-01", "2026-02-01",
      "2026-03-01", "2026-03-01"
    ))
  )
}

test_that("plan_smpc_checks orders products needing a code, within budget", {
  plan <- plan_smpc_checks(
    plan_atc_codes(),
    plan_medicines(),
    plan_documents(),
    empty_smpc_checks(),
    budget = 10
  )
  # 3 has a complete code; 6 has no product information.
  expect_identical(
    plan,
    dplyr::tibble(
      ema_product_number = paste0("EMEA/H/C/00000", c(5, 1, 4, 2)),
      medicine_status = c(rep("Authorised", 3), "Withdrawn"),
      document_url = pi_url(c("five", "one", "four", "two")),
      document_last_updated_date = as.Date(c(
        "2026-02-01", "2025-01-01", "2024-01-01", "2026-05-01"
      ))
    )
  )
  expect_identical(
    plan_smpc_checks(
      plan_atc_codes(), plan_medicines(), plan_documents(),
      empty_smpc_checks(), budget = 2
    )$ema_product_number,
    paste0("EMEA/H/C/00000", c(5, 1))
  )
  expect_identical(
    nrow(plan_smpc_checks(
      plan_atc_codes(), plan_medicines(), plan_documents(),
      empty_smpc_checks(), budget = 0
    )),
    0L
  )
})

test_that("plan_smpc_checks skips product information already checked", {
  checks <- dplyr::bind_rows(
    example_check("EMEA/H/C/000005", "five", document_date = "2026-02-01"),
    example_check("EMEA/H/C/000001", "one", document_date = "2024-06-01"),
    example_check("EMEA/H/C/000004", "four-old", document_date = "2024-01-01"),
    example_check("EMEA/H/C/000002", "two", document_date = NA)
  )
  plan <- plan_smpc_checks(
    plan_atc_codes(),
    plan_medicines(),
    plan_documents(),
    checks,
    budget = 10
  )
  # 1's document changed since; 4 has a new document URL; 2 was checked
  # before its document had a date.
  expect_identical(
    plan$ema_product_number,
    paste0("EMEA/H/C/00000", c(1, 4, 2))
  )
})

test_that("plan_smpc_checks retries unread or missing PIs after 180 days", {
  unread <- function(product, slug, document_date, checked_date, status) {
    example_check(
      product,
      slug,
      document_date = document_date,
      checked_date = checked_date,
      status = status,
      codes = NA_character_
    )
  }
  checks <- dplyr::bind_rows(
    unread("EMEA/H/C/000005", "five", "2026-02-01", "2026-03-01", "no_text"),
    unread("EMEA/H/C/000001", "one", "2025-01-01", "2026-04-01", "not_found"),
    unread("EMEA/H/C/000004", "four", "2024-01-01", "2025-01-01", "no_code"),
    unread("EMEA/H/C/000002", "two", "2026-05-01", "2025-01-01", "not_found")
  )
  plan <- plan_smpc_checks(
    plan_atc_codes(),
    plan_medicines(),
    plan_documents(),
    checks,
    budget = 10,
    today = as.Date("2026-09-27")
  )
  # 1 was missing 179 days ago; 4 has no ATC statement, which a retry
  # would not change.
  expect_identical(
    plan$ema_product_number,
    paste0("EMEA/H/C/00000", c(5, 2))
  )
})

test_that("plan_smpc_checks rereads what an older reader found incomplete", {
  checked <- function(product, slug, document_date, status, codes,
                      reader_version) {
    example_check(
      product,
      slug,
      document_date = document_date,
      status = status,
      codes = codes,
      reader_version = reader_version
    )
  }
  checks <- dplyr::bind_rows(
    checked("EMEA/H/C/000005", "five", "2026-02-01", "no_code", NA, 1L),
    checked("EMEA/H/C/000001", "one", "2025-01-01", "incomplete", "L01XL", 1L),
    checked("EMEA/H/C/000004", "four", "2024-01-01", "not_assigned", NA, 1L),
    checked("EMEA/H/C/000002", "two", "2026-05-01", "no_code", NA, 2L)
  )
  plan <- plan_smpc_checks(
    plan_atc_codes(),
    plan_medicines(),
    plan_documents(),
    checks,
    budget = 10
  )
  # 4 said "not yet assigned"; 2 was read by the current reader.
  expect_identical(
    plan$ema_product_number,
    paste0("EMEA/H/C/00000", c(5, 1))
  )
})

# Stands in for httr2::req_perform(): answers product information URLs with
# the given statuses in turn and records the requests. `is_pdf = FALSE`
# serves an HTML page with status 200, as a firewall challenge would.
fake_ema_pdf_server <- function(statuses = 200, is_pdf = TRUE) {
  server <- new.env()
  server$requests <- list()
  server$perform <- function(req, path = NULL, ...) {
    server$requests <- c(server$requests, list(req))
    status <- statuses[min(length(server$requests), length(statuses))]
    body <- if (status == 200 && is_pdf) "%PDF-1.7" else "<html>error</html>"
    writeLines(body, path)
    httr2::response(status_code = status)
  }
  server
}

pdf_texts <- c(
  one = aucatzyl_text,
  two = "ATC code: not yet assigned",
  five = "ATC code: L01XL"
)

mock_smpc_reading <- function(server, env = parent.frame()) {
  waits <- new.env()
  waits$seconds <- numeric()
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2",
    .env = env
  )
  testthat::local_mocked_bindings(
    wait_seconds = function(seconds) waits$seconds <- c(waits$seconds, seconds),
    read_pdf_text = function(path) {
      slug <- stringr::str_match(
        server$requests[[length(server$requests)]]$url,
        "product-information/(.+)-epar"
      )[, 2]
      pdf_texts[[slug]]
    },
    .env = env
  )
  waits
}

test_that("fetch_smpc_checks reads each PDF and saves after every one", {
  server <- fake_ema_pdf_server()
  waits <- mock_smpc_reading(server)
  plan <- plan_smpc_checks(
    plan_atc_codes(), plan_medicines(), plan_documents(),
    empty_smpc_checks(), budget = 2
  )
  checks_path <- file.path(tempfile(), "ema-smpc", "checks.json")
  run <- suppressMessages(fetch_smpc_checks(
    plan,
    example_check("EMEA/H/C/000009", "nine"),
    checks_path,
    today = as.Date("2026-09-27")
  ))
  expect_identical(run$requests, 2L)
  expect_identical(run$stop_reason, NA_character_)
  expect_identical(waits$seconds, c(20, 20))
  expect_identical(
    vapply(server$requests, function(req) req$url, character(1)),
    pi_url(c("five", "one"))
  )
  expect_identical(
    server$requests[[1]]$policies$throttle_realm,
    "ema.europa.eu"
  )
  expect_identical(
    run$checks[c("ema_product_number", "smpc_status", "atc_code")],
    dplyr::tibble(
      ema_product_number = paste0("EMEA/H/C/00000", c(1, 5, 9)),
      smpc_status = c("code_found", "incomplete", "code_found"),
      atc_code = c("L01XL12", "L01XL", "L01XL12")
    )
  )
  expect_identical(unique(run$checks$source), "ema_smpc")
  expect_identical(unique(run$checks$reader_version), smpc_reader_version)
  expect_identical(
    run$checks$checked_date[1:2],
    as.Date(c("2026-09-27", "2026-09-27"))
  )
  expect_identical(read_smpc_checks(checks_path), run$checks)
})

test_that("fetch_smpc_checks stops cleanly on HTTP 429 and keeps results", {
  server <- fake_ema_pdf_server(statuses = c(200, 429, 200))
  waits <- mock_smpc_reading(server)
  plan <- plan_smpc_checks(
    plan_atc_codes(), plan_medicines(), plan_documents(),
    empty_smpc_checks(), budget = 3
  )
  checks_path <- file.path(tempfile(), "checks.json")
  expect_warning(
    run <- suppressMessages(fetch_smpc_checks(
      plan,
      empty_smpc_checks(),
      checks_path
    )),
    "HTTP 429"
  )
  expect_identical(run$requests, 2L)
  expect_identical(run$stop_reason, "EMA returned HTTP 429")
  expect_length(server$requests, 2)
  expect_identical(run$checks$ema_product_number, "EMEA/H/C/000005")
  expect_identical(read_smpc_checks(checks_path), run$checks)
})

test_that("fetch_smpc_checks stops on a page that is not a PDF", {
  server <- fake_ema_pdf_server(is_pdf = FALSE)
  mock_smpc_reading(server)
  plan <- plan_smpc_checks(
    plan_atc_codes(), plan_medicines(), plan_documents(),
    empty_smpc_checks(), budget = 2
  )
  # The code found in the product information before it was updated.
  earlier <- example_check(
    "EMEA/H/C/000005",
    "five",
    document_date = "2025-06-01",
    codes = "L01XL12"
  )
  checks_path <- file.path(tempfile(), "checks.json")
  expect_warning(
    run <- suppressMessages(fetch_smpc_checks(plan, earlier, checks_path)),
    "non-PDF response"
  )
  expect_identical(run$requests, 1L)
  expect_identical(run$stop_reason, "EMA returned a non-PDF response")
  expect_identical(run$checks, earlier)
  expect_false(file.exists(checks_path))
})

test_that("fetch_smpc_checks records a missing PDF as not found", {
  server <- fake_ema_pdf_server(statuses = 404)
  mock_smpc_reading(server)
  plan <- plan_smpc_checks(
    plan_atc_codes(), plan_medicines(), plan_documents(),
    empty_smpc_checks(), budget = 1
  )
  run <- suppressMessages(fetch_smpc_checks(
    plan,
    empty_smpc_checks(),
    file.path(tempfile(), "checks.json")
  ))
  expect_identical(run$checks$smpc_status, "not_found")
  expect_identical(run$checks$atc_code, NA_character_)
})

test_that("fetch_smpc_checks stops on a network failure", {
  testthat::local_mocked_bindings(
    req_perform = function(...) {
      stop(structure(
        class = c("httr2_failure", "httr2_error", "error", "condition"),
        list(message = "Timeout was reached", call = NULL)
      ))
    },
    .package = "httr2"
  )
  testthat::local_mocked_bindings(wait_seconds = function(seconds) NULL)
  plan <- plan_smpc_checks(
    plan_atc_codes(), plan_medicines(), plan_documents(),
    empty_smpc_checks(), budget = 2
  )
  expect_warning(
    run <- suppressMessages(fetch_smpc_checks(
      plan,
      empty_smpc_checks(),
      file.path(tempfile(), "checks.json")
    )),
    "Timeout"
  )
  expect_identical(run$requests, 1L)
  expect_identical(nrow(run$checks), 0L)
})

test_that("fetch_smpc_checks records an unreadable PDF as without text", {
  server <- fake_ema_pdf_server()
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  testthat::local_mocked_bindings(
    wait_seconds = function(seconds) NULL,
    read_pdf_text = function(path) stop("PDF parsing failure")
  )
  plan <- plan_smpc_checks(
    plan_atc_codes(), plan_medicines(), plan_documents(),
    empty_smpc_checks(), budget = 1
  )
  expect_warning(
    run <- suppressMessages(fetch_smpc_checks(
      plan,
      empty_smpc_checks(),
      file.path(tempfile(), "checks.json")
    )),
    "PDF parsing failure"
  )
  expect_identical(run$checks$smpc_status, "no_text")
})

test_that("update_smpc_checks resumes from the committed checks", {
  server <- fake_ema_pdf_server()
  mock_smpc_reading(server)
  committed_path <- tempfile(fileext = ".json")
  write_json_table(
    example_check("EMEA/H/C/000005", "five", document_date = "2026-02-01"),
    committed_path
  )
  cache_directory <- file.path(tempfile(), "ema-smpc")
  run <- suppressMessages(update_smpc_checks(
    plan_atc_codes(),
    plan_medicines(),
    plan_documents(),
    cache_directory,
    committed_path,
    budget = 1L
  ))
  expect_identical(run$budget, 1L)
  expect_identical(run$requests, 1L)
  expect_identical(server$requests[[1]]$url, pi_url("one"))
  expect_identical(
    read_smpc_checks(
      file.path(cache_directory, "checks.json")
    )$ema_product_number,
    paste0("EMEA/H/C/00000", c(1, 5))
  )
  unlink(committed_path)
  again <- suppressMessages(update_smpc_checks(
    plan_atc_codes(),
    plan_medicines(),
    plan_documents(),
    cache_directory,
    committed_path,
    budget = 0
  ))
  expect_identical(again$requests, 0L)
  expect_identical(nrow(again$checks), 2L)
})

test_that("build_smpc_atc_table keeps checks of known products", {
  checks <- dplyr::bind_rows(
    example_check("EMEA/H/C/000002", "two"),
    example_check("EMEA/H/C/000099", "gone")
  )
  expect_identical(
    build_smpc_atc_table(checks, plan_medicines()),
    checks[1, ]
  )
})

test_that("smpc_source_entry counts products and the latest check", {
  checks <- dplyr::bind_rows(
    example_check(checked_date = "2026-09-20", codes = c("A10AB04", "A10AE04")),
    example_check("EMEA/H/C/000002", "two", checked_date = "2026-09-27")
  )
  entry <- smpc_source_entry(checks)
  expect_identical(entry$version, "2 product information documents checked")
  expect_identical(entry$retrieved, "2026-09-27")
  expect_identical(entry$attribution, ema_attribution)
  expect_identical(
    smpc_source_entry(empty_smpc_checks())$retrieved,
    NA_character_
  )
})

test_that("wait_seconds pauses", {
  expect_null(wait_seconds(0))
})
