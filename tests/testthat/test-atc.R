json_response <- function(body) {
  httr2::response(
    status_code = 200,
    headers = list(`Content-Type` = "application/json"),
    body = charToRaw(
      jsonlite::toJSON(body, auto_unbox = TRUE, null = "null", na = "null")
    )
  )
}

# Stands in for httr2::req_perform(): serves ChEMBL's status and the fixture
# ATC rows split over two pages, and records every requested URL.
fake_chembl_server <- function(version = "ChEMBL_37", total_count = 5) {
  server <- new.env()
  server$urls <- character()
  server$user_agents <- character()
  server$perform <- function(req, path = NULL, ...) {
    server$urls <- c(server$urls, req$url)
    server$user_agents <- c(server$user_agents, req$options$useragent)
    if (grepl("status.json", req$url, fixed = TRUE)) {
      writeLines(
        jsonlite::toJSON(
          list(chembl_db_version = version, chembl_release_date = "2026-05-01"),
          auto_unbox = TRUE
        ),
        path
      )
      return(httr2::response(status_code = 200))
    }
    rows <- jsonlite::fromJSON(fixture_atc_class_path())
    is_first_page <- grepl("offset=0", req$url, fixed = TRUE)
    json_response(list(
      atc = if (is_first_page) rows[1:3, ] else rows[4:5, ],
      page_meta = list(
        limit = 1000,
        offset = if (is_first_page) 0 else 1000,
        total_count = total_count,
        `next` = if (is_first_page) {
          "/chembl/api/data/atc_class.json?limit=1000&offset=1000"
        }
      )
    ))
  }
  server
}

test_that("fetch_chembl_release downloads status.json, returns the release", {
  cache_directory <- file.path(tempfile(), "chembl")
  server <- fake_chembl_server()
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  expect_message(
    release <- fetch_chembl_release(cache_directory),
    "Checking the ChEMBL release"
  )
  expect_identical(release, "ChEMBL_37")
  expect_identical(server$urls, paste0(chembl_api_url, "status.json"))
  expect_match(server$user_agents, "approval-atlas", fixed = TRUE)
  expect_true(file.exists(file.path(cache_directory, "status.json")))
})

test_that("fetch_chembl_release reuses status.json for 24 hours", {
  cache_directory <- file.path(tempfile(), "chembl")
  dir.create(cache_directory, recursive = TRUE)
  writeLines(
    '{"chembl_db_version": "ChEMBL_36"}',
    file.path(cache_directory, "status.json")
  )
  testthat::local_mocked_bindings(
    req_perform = function(...) stop("network must not be used"),
    .package = "httr2"
  )
  expect_identical(fetch_chembl_release(cache_directory), "ChEMBL_36")
})

test_that("fetch_chembl_release refreshes a stale status.json", {
  cache_directory <- file.path(tempfile(), "chembl")
  dir.create(cache_directory, recursive = TRUE)
  status_path <- file.path(cache_directory, "status.json")
  writeLines('{"chembl_db_version": "ChEMBL_36"}', status_path)
  Sys.setFileTime(status_path, Sys.time() - 48 * 60 * 60)
  server <- fake_chembl_server(version = "ChEMBL_38")
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  expect_identical(
    suppressMessages(fetch_chembl_release(cache_directory)),
    "ChEMBL_38"
  )
})

test_that("fetch_chembl_release aborts on a release unfit for a folder", {
  cache_directory <- file.path(tempfile(), "chembl")
  dir.create(cache_directory, recursive = TRUE)
  status_path <- file.path(cache_directory, "status.json")
  writeLines('{"chembl_db_version": "../elsewhere"}', status_path)
  expect_error(fetch_chembl_release(cache_directory), "elsewhere")
  writeLines('{"status": "UP"}', status_path)
  expect_error(fetch_chembl_release(cache_directory), "chembl_db_version")
})

test_that("download_chembl_atc_classes pages through atc_class once", {
  cache_directory <- file.path(tempfile(), "chembl")
  server <- fake_chembl_server()
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  expect_message(
    path <- download_chembl_atc_classes("ChEMBL_37", cache_directory),
    "Downloading ChEMBL_37 ATC classes"
  )
  expect_identical(
    path,
    file.path(cache_directory, "ChEMBL_37", "atc_class.json")
  )
  expect_identical(
    server$urls,
    paste0(
      chembl_api_url,
      "atc_class.json?limit=1000&offset=",
      c("0", "1000")
    )
  )
  expect_identical(
    dplyr::as_tibble(jsonlite::fromJSON(path)),
    dplyr::as_tibble(jsonlite::fromJSON(fixture_atc_class_path()))
  )
  expect_identical(list.files(dirname(path)), "atc_class.json")
})

test_that("download_chembl_atc_classes reuses the file for the same release", {
  cache_directory <- file.path(tempfile(), "chembl")
  dir.create(file.path(cache_directory, "ChEMBL_37"), recursive = TRUE)
  file.copy(
    fixture_atc_class_path(),
    file.path(cache_directory, "ChEMBL_37", "atc_class.json")
  )
  testthat::local_mocked_bindings(
    req_perform = function(...) stop("network must not be used"),
    .package = "httr2"
  )
  expect_message(
    download_chembl_atc_classes("ChEMBL_37", cache_directory),
    "Using cached ChEMBL_37 ATC classes"
  )
})

test_that("download_chembl_atc_classes aborts when rows go missing", {
  cache_directory <- file.path(tempfile(), "chembl")
  server <- fake_chembl_server(total_count = 6)
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  expect_error(
    suppressMessages(download_chembl_atc_classes("ChEMBL_37", cache_directory)),
    "6"
  )
  expect_false(file.exists(
    file.path(cache_directory, "ChEMBL_37", "atc_class.json")
  ))
})

test_that("build_atc_classes lists each level once with verbatim names", {
  classes <- build_atc_classes(jsonlite::fromJSON(fixture_atc_class_path()))
  expect_named(
    classes,
    c(
      "atc_code", "level", "name", "source", "status", "replaced_by",
      "changed_year", "status_source", "source_url"
    )
  )
  expect_identical(nrow(classes), 24L)
  expect_identical(
    classes$atc_code,
    sort(classes$atc_code, method = "radix")
  )
  expect_identical(anyDuplicated(classes$atc_code), 0L)
  row_for <- function(code) classes[classes$atc_code == code, ]
  expect_identical(
    row_for("A"),
    dplyr::tibble(
      atc_code = "A",
      level = 1L,
      name = "ALIMENTARY TRACT AND METABOLISM",
      source = "chembl_atc_class",
      status = "current",
      replaced_by = NA_character_,
      changed_year = NA_integer_,
      status_source = NA_character_,
      source_url = NA_character_
    )
  )
  expect_identical(row_for("A10")$level, 2L)
  expect_identical(row_for("L01F")$level, 3L)
  expect_identical(
    row_for("L01FA")$name,
    "CD20 (Clusters of Differentiation 20) inhibitors"
  )
  expect_identical(row_for("L01FA01")$level, 5L)
  expect_identical(row_for("L01FA01")$name, "rituximab")
  expect_identical(row_for("N07BC51")$name, "buprenorphine, combinations")
})

test_that("build_atc_classes aborts when a code has two names", {
  rows <- jsonlite::fromJSON(fixture_atc_class_path())
  rows$level2_description[rows$level2 == "L04"] <- "IMMUNOSUPPRESSANTS (NEW)"
  rows <- rbind(rows, rows[rows$level2 == "L04", ])
  rows$level2_description[nrow(rows)] <- "IMMUNOSUPPRESSANTS"
  rows$level5[nrow(rows)] <- "L04AG99"
  error <- expect_error(build_atc_classes(rows), class = "rlang_error")
  expect_match(conditionMessage(error), "L04")
})

test_that("atc_code_level recognises the five ATC levels", {
  expect_identical(
    atc_code_level(c("L", "L01", "L01F", "L01FA", "L01FA01")),
    1:5
  )
})

test_that("atc_code_level returns NA for invalid codes", {
  expect_identical(
    atc_code_level(c("LX1XX02", "VO4D", "l01", "L01FA011", "", NA)),
    rep(NA_integer_, 6)
  )
})

test_that("build_atc_codes_table flags incomplete codes and sets the source", {
  clean_medicines <- dplyr::tibble(
    ema_product_number = c("A", "B", "C", "D", "E"),
    atc_code_human = c(
      "L01XE",
      "A10AB04;A10AD04",
      "Not yet assigned",
      "LX1XX02",
      NA
    )
  )
  expect_identical(
    build_atc_codes_table(clean_medicines),
    dplyr::tibble(
      ema_product_number = c("A", "B", "B", "D"),
      atc_code_human = c("L01XE", "A10AB04", "A10AD04", "LX1XX02"),
      atc_level = c(4L, 5L, 5L, NA),
      atc_incomplete = c(TRUE, FALSE, FALSE, TRUE),
      source = "ema",
      atc_code = c("L01XE", "A10AB04", "A10AD04", "LX1XX02"),
      atc_code_source = "ema",
      atc_code_conflict = FALSE,
      atc_code_document_url = NA_character_,
      atc_code_document_date = as.Date(NA),
      current_atc_code = NA_character_,
      current_atc_code_source = NA_character_
    )
  )
})

test_that("build_atc_codes_table keeps the M1 rows on real EMA records", {
  clean_medicines <- clean_ema_medicines(read_fixture_ema()$data)
  atc_codes <- build_atc_codes_table(clean_medicines)
  expect_identical(
    atc_codes[c("ema_product_number", "atc_code_human")],
    build_lookup_table(clean_medicines, "atc_code_human", "Not yet assigned")
  )
  bimzelx <- atc_codes[atc_codes$ema_product_number == "EMEA/H/C/005316", ]
  expect_identical(bimzelx$atc_level, 4L)
  expect_true(bimzelx$atc_incomplete)
})

fixture_retired_codes <- function() {
  build_retired_atc_codes(
    read_whocc_alterations(fixture_whocc_alterations_path())
  )
}

smpc_check <- function(product, codes, status = "code_found") {
  dplyr::tibble(
    ema_product_number = product,
    document_url = paste0(
      "https://www.ema.europa.eu/en/documents/product-information/",
      tolower(product), "-epar-product-information_en.pdf"
    ),
    document_last_updated_date = as.Date("2025-08-19"),
    checked_date = as.Date("2026-09-27"),
    smpc_status = status,
    atc_code = codes,
    source = "ema_smpc"
  )
}

test_that("atc_code_prefixes lists the valid prefixes from level 1", {
  expect_identical(
    atc_code_prefixes("L01FA01"),
    c("L", "L01", "L01F", "L01FA", "L01FA01")
  )
  expect_identical(atc_code_prefixes("L04AC"), c("L", "L04", "L04A", "L04AC"))
  expect_identical(atc_code_prefixes("LX1XX02"), "L")
  expect_identical(atc_code_prefixes("VO4D"), "V")
  expect_identical(atc_code_prefixes("1XX"), character())
  expect_identical(atc_code_prefixes(NA_character_), character())
  expect_identical(
    longest_atc_prefix(c("L01XE", "LX1XX02", "1XX")),
    c("L01XE", "L", NA)
  )
})

test_that("current_atc_codes follows moves and leaves codes in use alone", {
  retired <- fixture_retired_codes()
  expect_identical(
    current_atc_codes(
      c("L01XX28", "L01XE01", "L01XE", "J07BX07", "L01EA01", NA),
      retired
    ),
    c("L01EA01", "L01EA01", "L01E", NA, NA, NA)
  )
})

test_that("is_consistent_atc_code accepts codes under EMA's prefix or moved", {
  retired <- fixture_retired_codes()
  expect_identical(
    is_consistent_atc_code(
      smpc_codes = c(
        "L01XL12", "L01EA01", "L04AA34", "L01XL12", "L01XX02", "A10AB04",
        "L01XE01", "N03AX26"
      ),
      ema_codes = c(
        "L01XL", "L01XE", "L01XC", "L04AC", "LX1XX02", "LX1XX02", "L01E",
        "1XX"
      ),
      retired
    ),
    c(TRUE, TRUE, TRUE, FALSE, TRUE, FALSE, TRUE, TRUE)
  )
})

imputation_medicines <- function() {
  dplyr::tibble(
    ema_product_number = c("A", "B", "C", "D", "E", "F", "G", "H", "I"),
    atc_code_human = c(
      "L01XL", "L01XE", "L01XE", "A10AB04", "L04AC", "L01XE01", "J07BX",
      NA, "L01XX"
    )
  )
}

imputation_checks <- function() {
  dplyr::bind_rows(
    smpc_check("A", "L01XL12"),
    smpc_check("B", "L01EA01"),
    smpc_check("D", "A10AB05"),
    smpc_check("E", "L01XL12"),
    smpc_check("F", "L01EA01"),
    smpc_check("G", c("J07BX03", "J07BX04")),
    smpc_check("H", "N03AX26"),
    smpc_check("I", "L01XX", status = "incomplete")
  )
}

test_that("build_atc_codes_table completes incomplete EMA codes from SmPCs", {
  atc_codes <- build_atc_codes_table(
    imputation_medicines(),
    imputation_checks(),
    fixture_retired_codes()
  )
  expect_named(
    atc_codes,
    c(
      "ema_product_number", "atc_code_human", "atc_level", "atc_incomplete",
      "source", "atc_code", "atc_code_source", "atc_code_conflict",
      "atc_code_document_url", "atc_code_document_date", "current_atc_code",
      "current_atc_code_source"
    )
  )
  # One row per EMA code: G's two SmPC codes both complete J07BX, so
  # neither is used. H has no EMA code: its SmPC code gets a row of its own.
  expect_identical(
    atc_codes$ema_product_number,
    c("A", "B", "C", "D", "E", "F", "G", "H", "I")
  )
  expect_identical(
    atc_codes$atc_code,
    c(
      "L01XL12", "L01EA01", "L01XE", "A10AB04", "L01XL12", "L01XE01", "J07BX",
      "N03AX26", "L01XX"
    )
  )
  expect_identical(
    atc_codes$atc_code_source,
    c(
      "ema_smpc", "ema_smpc", "ema", "ema", "ema_smpc", "ema", "ema",
      "ema_smpc", "ema"
    )
  )
  # E's SmPC code does not fit EMA's L04AC, but goes deeper: used, marked.
  expect_identical(
    atc_codes$atc_code_conflict,
    c(FALSE, FALSE, FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE)
  )
  expect_identical(
    atc_codes$atc_code_human,
    c(
      "L01XL", "L01XE", "L01XE", "A10AB04", "L04AC", "L01XE01", "J07BX", NA,
      "L01XX"
    )
  )
  aucatzyl_like <- atc_codes[atc_codes$ema_product_number == "A", ]
  expect_identical(
    aucatzyl_like$atc_code_document_url,
    smpc_check("A", "L01XL12")$document_url
  )
  expect_identical(aucatzyl_like$atc_code_document_date, as.Date("2025-08-19"))
  expect_true(all(is.na(
    atc_codes$atc_code_document_url[atc_codes$atc_code_source == "ema"]
  )))
  expect_identical(
    atc_codes$current_atc_code,
    c(NA, NA, "L01E", NA, NA, "L01EA01", NA, NA, NA)
  )
  expect_identical(
    atc_codes$current_atc_code_source,
    c(NA, NA, "curated", NA, NA, "whocc_alterations", NA, NA, NA)
  )
  expect_identical(
    atc_codes$source,
    c(rep("ema", 7), "ema_smpc", "ema")
  )
})

test_that("judge_smpc_atc_codes gives one verdict per product and SmPC code", {
  expected <- dplyr::tibble(
    ema_product_number = c("A", "B", "D", "E", "F", "G", "G", "H", "I"),
    smpc_code = c(
      "L01XL12", "L01EA01", "A10AB05", "L01XL12", "L01EA01", "J07BX03",
      "J07BX04", "N03AX26", "L01XX"
    ),
    verdict = c(
      "imputed", "imputed", "ema_complete", "conflict",
      "ema_complete", "ambiguous", "ambiguous", "no_ema_code", "not_deeper"
    ),
    ema_codes = c(
      "L01XL", "L01XE", "A10AB04", "L04AC", "L01XE01", "J07BX", "J07BX",
      NA, "L01XX"
    )
  )
  expect_identical(
    judge_smpc_atc_codes(
      build_atc_codes_table(imputation_medicines()),
      imputation_checks(),
      fixture_retired_codes()
    ),
    expected
  )
  # The published table, with the rows of products without an EMA code.
  expect_identical(
    judge_smpc_atc_codes(
      build_atc_codes_table(
        imputation_medicines(),
        imputation_checks(),
        fixture_retired_codes()
      ),
      imputation_checks(),
      fixture_retired_codes()
    ),
    expected
  )
})

test_that("an SmPC code completes only EMA's incomplete codes it fits", {
  clean_medicines <- dplyr::tibble(
    ema_product_number = "A",
    atc_code_human = "A10AB04;A10AE"
  )
  atc_codes <- build_atc_codes_table(
    clean_medicines,
    smpc_check("A", c("A10AB04", "A10AE56")),
    fixture_retired_codes()
  )
  expect_identical(atc_codes$atc_code_human, c("A10AB04", "A10AE"))
  expect_identical(atc_codes$atc_code, c("A10AB04", "A10AE56"))
  expect_identical(atc_codes$atc_code_source, c("ema", "ema_smpc"))
  expect_identical(atc_codes$atc_code_conflict, c(FALSE, FALSE))
  # A10AB04 fits EMA's other code, so it never replaces A10AE.
  alone <- build_atc_codes_table(
    clean_medicines,
    smpc_check("A", "A10AB04"),
    fixture_retired_codes()
  )
  expect_identical(alone$atc_code, c("A10AB04", "A10AE"))
  expect_identical(alone$atc_code_conflict, c(FALSE, FALSE))
})

test_that("a deeper SmPC code that does not fit EMA's is used and marked", {
  # EMA's codes and the SmPC codes of Kerendia, Yttriga and Pombiliti.
  clean_medicines <- dplyr::tibble(
    ema_product_number = c(
      "EMEA/H/C/000596", "EMEA/H/C/005200", "EMEA/H/C/005703"
    ),
    atc_code_human = c("V09", "C09", "A16AB")
  )
  checks <- dplyr::bind_rows(
    smpc_check("EMEA/H/C/000596", "V10X", status = "incomplete"),
    smpc_check("EMEA/H/C/005200", "C03DA05"),
    smpc_check("EMEA/H/C/005703", "A16A", status = "incomplete")
  )
  atc_codes <- build_atc_codes_table(
    clean_medicines,
    checks,
    fixture_retired_codes()
  )
  expect_identical(atc_codes$atc_code, c("V10X", "C03DA05", "A16AB"))
  expect_identical(
    atc_codes$atc_code_source,
    c("ema_smpc", "ema_smpc", "ema")
  )
  expect_identical(atc_codes$atc_code_conflict, c(TRUE, TRUE, FALSE))
  expect_identical(atc_codes$atc_incomplete, c(TRUE, TRUE, TRUE))
  expect_identical(
    atc_codes$atc_code_document_url[2],
    checks$document_url[2]
  )
  expect_identical(
    judge_smpc_atc_codes(atc_codes, checks, fixture_retired_codes())$verdict,
    c("conflict", "conflict", "prefix_mismatch")
  )
})

test_that("a conflicting SmPC code is used only when it is the only one", {
  clean_medicines <- dplyr::tibble(
    ema_product_number = c("A", "B", "C", "D"),
    atc_code_human = c("C09;C10", "C09", "C09;C10", "L01XX")
  )
  checks <- dplyr::bind_rows(
    smpc_check("A", c("C03DA05", "C10AA01")),
    smpc_check("B", c("C01CX09", "C03DA05")),
    smpc_check("C", "C03DA05"),
    smpc_check("D", c("L01XX52", "L04AX04"))
  )
  atc_codes <- build_atc_codes_table(
    clean_medicines,
    checks,
    fixture_retired_codes()
  )
  # A: C10AA01 completes C10, so C03DA05 replaces C09. B: two candidates
  # for C09. C: one SmPC code for two EMA codes. D: a code that fits.
  expect_identical(
    atc_codes$atc_code,
    c("C03DA05", "C10AA01", "C09", "C09", "C10", "L01XX52")
  )
  expect_identical(
    atc_codes$atc_code_conflict,
    c(TRUE, FALSE, FALSE, FALSE, FALSE, FALSE)
  )
  expect_identical(
    judge_smpc_atc_codes(atc_codes, checks, fixture_retired_codes())$verdict,
    c(
      "conflict", "imputed", "ambiguous", "ambiguous", "ambiguous", "imputed",
      "prefix_mismatch"
    )
  )
})

test_that("products without an EMA code get their SmPC codes", {
  # Entyvio: no EMA code; Mylotarg: "Not yet assigned"; a product whose
  # SmPC gives two codes and one whose SmPC gives a retired code; Boey:
  # "not yet assigned" in its SmPC; a product no longer in EMA's data.
  clean_medicines <- dplyr::tibble(
    ema_product_number = c(
      "EMEA/H/C/001038", "EMEA/H/C/002782", "EMEA/H/C/004204",
      "EMEA/H/C/004243", "EMEA/H/C/005907", "EMEA/H/C/006420"
    ),
    atc_code_human = c(NA, NA, "Not yet assigned", NA, "L01XL", NA)
  )
  checks <- dplyr::bind_rows(
    smpc_check("EMEA/H/C/001038", "L01XE10"),
    smpc_check("EMEA/H/C/002782", "L04AG05"),
    smpc_check("EMEA/H/C/004204", "L01FX02"),
    smpc_check("EMEA/H/C/004243", c("A10AE54", "A10BJ03")),
    smpc_check("EMEA/H/C/005907", "L01XL12"),
    smpc_check("EMEA/H/C/006420", NA_character_, status = "not_assigned"),
    smpc_check("EMEA/H/C/999999", "A10AB04")
  )
  atc_codes <- build_atc_codes_table(
    clean_medicines,
    checks,
    fixture_retired_codes()
  )
  expect_identical(
    atc_codes[atc_codes$source == "ema_smpc", ],
    dplyr::tibble(
      ema_product_number = paste0(
        "EMEA/H/C/",
        c("001038", "002782", "004204", "004243", "004243")
      ),
      atc_code_human = NA_character_,
      atc_level = NA_integer_,
      atc_incomplete = FALSE,
      source = "ema_smpc",
      atc_code = c("L01XE10", "L04AG05", "L01FX02", "A10AE54", "A10BJ03"),
      atc_code_source = "ema_smpc",
      atc_code_conflict = FALSE,
      atc_code_document_url = checks$document_url[1:5],
      atc_code_document_date = as.Date("2025-08-19"),
      current_atc_code = c("L01EG02", NA, NA, NA, NA),
      current_atc_code_source = c("whocc_alterations", NA, NA, NA, NA)
    )
  )
  expect_identical(
    atc_codes$ema_product_number[atc_codes$source == "ema"],
    "EMEA/H/C/005907"
  )
})

test_that("an incomplete SmPC code of a product without an EMA code is used", {
  # Entyvio's SmPC code (L04AG05) cut to level 4. atc_level and
  # atc_incomplete describe EMA's published code, so they stay NA and FALSE:
  # the level of atc_code itself tells that it is incomplete.
  clean_medicines <- dplyr::tibble(
    ema_product_number = "EMEA/H/C/002782",
    atc_code_human = NA_character_
  )
  checks <- smpc_check("EMEA/H/C/002782", "L04AG", status = "incomplete")
  atc_codes <- build_atc_codes_table(
    clean_medicines,
    checks,
    fixture_retired_codes()
  )
  expect_identical(atc_codes$atc_code, "L04AG")
  expect_identical(atc_codes$atc_code_human, NA_character_)
  expect_identical(atc_codes$atc_level, NA_integer_)
  expect_false(atc_codes$atc_incomplete)
  expect_identical(atc_codes$source, "ema_smpc")
  expect_identical(atc_code_level(atc_codes$atc_code), 4L)
  expect_identical(
    judge_smpc_atc_codes(atc_codes, checks, fixture_retired_codes())$verdict,
    "no_ema_code"
  )
})

test_that("atc_codes_in_use collects every published, used and SmPC code", {
  atc_codes <- build_atc_codes_table(
    imputation_medicines(),
    imputation_checks(),
    fixture_retired_codes()
  )
  expect_identical(
    atc_codes_in_use(atc_codes, imputation_checks()),
    c(
      "A10AB04", "A10AB05", "J07BX", "J07BX03", "J07BX04", "L01E", "L01EA01",
      "L01XE", "L01XE01", "L01XL", "L01XL12", "L01XX", "L04AC", "N03AX26"
    )
  )
})

test_that("build_atc_classes adds WHOCC names for used codes ChEMBL lacks", {
  whocc_classes <- dplyr::tibble(
    atc_code = c("L04AL", "L04AL02", "L04AG03", "L04AL", "M05BD", "L04AL03"),
    level = c(4L, 5L, 5L, 4L, 4L, 5L),
    name = c(
      "Neonatal fragment crystallizable receptor (FcRn) inhibitors",
      "rozanolixizumab",
      "natalizumab (index)",
      "FcRn inhibitors (temporary)",
      "C-type natriuretic peptide (CNP) analogues",
      NA
    ),
    status = c("current", "current", "current", "temporary", "temporary",
               "current"),
    source = c(
      "whocc_updates", "whocc_index", "whocc_index", "whocc_updates",
      "whocc_updates", "whocc_index"
    ),
    source_url = c(
      whocc_updates_url(2026), whocc_index_url("L04AL02"),
      whocc_index_url("L04AG03"), whocc_temporary_url, whocc_temporary_url,
      whocc_index_url("L04AL03")
    )
  )
  classes <- build_atc_classes(
    jsonlite::fromJSON(fixture_atc_class_path()),
    whocc_classes,
    fixture_retired_codes(),
    used_codes = c("L04AL02", "L04AL03", "M05BD", "L01XE01", "L04AG03")
  )
  row_for <- function(code) classes[classes$atc_code == code, ]
  expect_identical(
    row_for("L04AL"),
    dplyr::tibble(
      atc_code = "L04AL",
      level = 4L,
      name = "Neonatal fragment crystallizable receptor (FcRn) inhibitors",
      source = "whocc_updates",
      status = "current",
      replaced_by = NA_character_,
      changed_year = NA_integer_,
      status_source = NA_character_,
      source_url = whocc_updates_url(2026)
    )
  )
  expect_identical(row_for("L04AL02")$source, "whocc_index")
  expect_identical(row_for("M05BD")$status, "temporary")
  expect_identical(row_for("L04AG03")$name, "natalizumab")
  expect_identical(nrow(row_for("L04AL03")), 0L)
  expect_identical(
    row_for("L01XE"),
    dplyr::tibble(
      atc_code = "L01XE",
      level = 4L,
      name = "Protein kinase inhibitors",
      source = "whocc_index_archived",
      status = "retired",
      replaced_by = "L01E",
      changed_year = 2021L,
      status_source = "curated",
      source_url = curated_retired_atc_levels$source_url[2]
    )
  )
  expect_identical(row_for("L01XE01")$name, "imatinib")
  expect_identical(row_for("L01XE01")$replaced_by, "L01EA01")
  expect_identical(row_for("L01XE01")$source, "whocc_alterations")
  # L01XC is retired too, but no product uses it.
  expect_false("L01XC" %in% classes$atc_code)
  expect_identical(anyDuplicated(classes$atc_code), 0L)
  expect_identical(
    classes$atc_code,
    sort(classes$atc_code, method = "radix")
  )
})

test_that("build_atc_classes marks retired ChEMBL codes", {
  rows <- jsonlite::fromJSON(fixture_atc_class_path())
  retired <- dplyr::tibble(
    atc_code = "L04AG03",
    level = 5L,
    name = "natalizumab",
    replaced_by = "L04AG99",
    changed_year = 2030L,
    source = "whocc_alterations",
    source_url = whocc_alterations_url,
    replacement_source = "whocc_alterations"
  )
  classes <- build_atc_classes(rows, retired_codes = retired)
  natalizumab <- classes[classes$atc_code == "L04AG03", ]
  expect_identical(natalizumab$source, "chembl_atc_class")
  expect_identical(natalizumab$status, "retired")
  expect_identical(natalizumab$replaced_by, "L04AG99")
  expect_identical(natalizumab$changed_year, 2030L)
  # ChEMBL names the code; the WHOCC alterations list retires it.
  expect_identical(natalizumab$status_source, "whocc_alterations")
})

test_that("build_atc_classes prefers WHO names over ChEMBL's", {
  rows <- jsonlite::fromJSON(fixture_atc_class_renamed_path())
  corrections <- build_atc_name_corrections(read_whocc_name_alterations(
    fixture_whocc_updates_path(),
    whocc_updates_url(2026)
  ))
  # A WHO name ChEMBL already has leaves ChEMBL's row as it is.
  same_name <- dplyr::tibble(
    atc_code = "L01FG01",
    name = "bevacizumab",
    source = "whocc_updates",
    source_url = whocc_updates_url(2025)
  )
  classes <- build_atc_classes(
    rows,
    name_corrections = dplyr::bind_rows(corrections, same_name)
  )
  expect_identical(
    classes$atc_code,
    build_chembl_atc_classes(rows)$atc_code
  )
  row_for <- function(code) classes[classes$atc_code == code, ]
  expect_identical(
    row_for("J07BX01"),
    dplyr::tibble(
      atc_code = "J07BX01",
      level = 5L,
      name = "smallpox and mpox vaccines",
      source = "whocc_updates",
      status = "current",
      replaced_by = NA_character_,
      changed_year = NA_integer_,
      status_source = NA_character_,
      source_url = whocc_updates_url(2026)
    )
  )
  expect_identical(
    row_for("V09IX15")$name,
    "copper (64Cu) oxodotreotide"
  )
  expect_identical(
    row_for("J07CA09")$name,
    paste0(
      "diphtheria-haemophilus influenzae B-pertussis-poliomyelitis-tetanus-",
      "hepatitis B"
    )
  )
  expect_identical(row_for("J07CA09")$source, "whocc_index")
  expect_identical(row_for("J07CA09")$source_url, whocc_index_url("J07CA09"))
  expect_identical(row_for("L01FG")$level, 4L)
  expect_identical(
    row_for("L01FG")$name,
    "VEGF/VEGFR (Vascular Endothelial Growth Factor / -Receptor) inhibitors"
  )
  expect_identical(row_for("L01FG01")$source, "chembl_atc_class")
  expect_identical(row_for("L01FG01")$source_url, NA_character_)
  expect_identical(row_for("L01FG01")$name, "bevacizumab")
  expect_identical(
    renamed_atc_codes(build_chembl_atc_classes(rows), corrections),
    dplyr::tibble(
      atc_code = c("J07BX01", "J07CA09", "L01FG", "V09IX15"),
      chembl_name = c(
        "smallpox and monkeypox vaccines",
        paste0(
          "diphtheria-hemophilus influenzae B-pertussis-poliomyelitis-",
          "tetanus-hepatitis B"
        ),
        "VEGF/VEGFR (Vascular Endothelial Growth Factor) inhibitors",
        "copper (64Cu) dotatate"
      ),
      name = c(
        "smallpox and mpox vaccines", row_for("J07CA09")$name,
        row_for("L01FG")$name, "copper (64Cu) oxodotreotide"
      ),
      source = c("whocc_updates", "whocc_index", "whocc_index", "whocc_updates")
    )
  )
})

test_that("empty_atc_sources gives no SmPC codes, moves or WHOCC names", {
  sources <- empty_atc_sources()
  expect_identical(sources$smpc_checks, empty_smpc_checks())
  expect_identical(nrow(sources$retired_codes), 0L)
  expect_identical(sources$whocc_classes, empty_whocc_classes())
  expect_identical(sources$name_corrections, empty_atc_name_corrections())
})

test_that("report_atc_summary reports checks, verdicts and rejections", {
  checks <- imputation_checks()
  retired <- fixture_retired_codes()
  atc_codes <- build_atc_codes_table(imputation_medicines(), checks, retired)
  tables <- list(
    ema_medicine_smpc_atc = checks,
    ema_medicine_atc_codes = atc_codes,
    atc_classes = build_atc_classes(
      jsonlite::fromJSON(fixture_atc_class_path()),
      retired_codes = retired,
      used_codes = atc_codes_in_use(atc_codes, checks)
    )
  )
  atc_sources <- list(
    smpc_run = list(
      requests = 3L,
      budget = 25L,
      stop_reason = "EMA returned HTTP 429"
    ),
    retired_codes = retired,
    still_to_check = dplyr::tibble(
      medicine_status = c("Authorised", "Refused")
    ),
    index_requests = 2L,
    renamed_codes = renamed_atc_codes(
      build_chembl_atc_classes(
        jsonlite::fromJSON(fixture_atc_class_renamed_path())
      ),
      build_atc_name_corrections(empty_atc_name_corrections())
    )
  )
  messages <- testthat::capture_messages(
    verdicts <- report_atc_summary(tables, atc_sources)
  )
  expect_identical(nrow(verdicts), 9L)
  expect_match(
    messages,
    paste(
      "SmPC ATC checks: 3 requests this run \\(budget 25\\); 8 products",
      "checked: 7 code found, 1 incomplete code, 0 not yet assigned"
    ),
    all = FALSE
  )
  expect_match(messages, "stopped early: EMA returned HTTP 429", all = FALSE)
  expect_match(
    messages,
    paste(
      "2 EMA codes completed \\(2 products\\), 1 replaced by a code that",
      "does not fit it \\(1 products\\), 1 codes for 1 products without an",
      "EMA code; SmPC codes: 2 used, 1 used although EMA's code does not",
      "fit, 2 not used \\(ambiguous\\),",
      "0 rejected \\(prefix mismatch\\), 1 not deeper than EMA's,",
      "2 EMA code already complete, 1 used for products without an EMA code"
    ),
    all = FALSE
  )
  expect_match(messages, "1 Authorised products still to check", all = FALSE)
  expect_match(
    messages,
    "used although EMA's code does not fit:.*E: EMA L04AC, SmPC L01XL12",
    all = FALSE
  )
  expect_no_match(messages, "rejected \\(EMA's code does not fit\\)")
  expect_match(
    messages,
    "not used \\(several for one EMA code.*G: EMA J07BX, SmPC J07BX03",
    all = FALSE
  )
  expect_match(
    messages,
    paste0(
      "ATC names from the WHOCC instead of ChEMBL: 4 codes.*",
      "J07BX01: smallpox and monkeypox vaccines -> smallpox and mpox vaccines"
    ),
    all = FALSE
  )
  expect_match(
    messages,
    "Retired ATC codes in use: 2 codes on 2 products",
    all = FALSE
  )
  expect_match(messages, "2 WHOCC index requests this run", all = FALSE)
})
