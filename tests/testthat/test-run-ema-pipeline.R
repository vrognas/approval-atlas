copy_fixture_to_cache <- function() {
  cache_path <- file.path(tempfile(), "medicines.json")
  dir.create(dirname(cache_path))
  file.copy(fixture_ema_path(), cache_path)
  cache_path
}

write_modified_fixture <- function(modify) {
  ema <- read_fixture_ema()
  ema <- modify(ema)
  cache_path <- file.path(tempfile(), "medicines.json")
  dir.create(dirname(cache_path))
  jsonlite::write_json(ema, cache_path, auto_unbox = TRUE, dataframe = "rows")
  cache_path
}

# Fresh MeSH and ChEMBL caches, so the pipeline never needs the network.
seed_downloads_directory <- function() {
  downloads_directory <- file.path(tempfile(), "downloads")
  mesh_directory <- file.path(downloads_directory, "mesh")
  dir.create(mesh_directory, recursive = TRUE)
  file.copy(fixture_mesh_path(), file.path(mesh_directory, "desc2026.xml"))
  jsonlite::write_json(
    list(
      year = "2026",
      url = paste0(mesh_listing_url, "desc2026.gz"),
      last_modified = "Wed, 12 Aug 2026 18:05:02 GMT"
    ),
    file.path(mesh_directory, "source.json"),
    auto_unbox = TRUE
  )
  release_directory <- file.path(downloads_directory, "chembl", "ChEMBL_37")
  dir.create(release_directory, recursive = TRUE)
  writeLines(
    '{"chembl_db_version": "ChEMBL_37"}',
    file.path(downloads_directory, "chembl", "status.json")
  )
  file.copy(
    fixture_atc_class_path(),
    file.path(release_directory, "atc_class.json")
  )
  seed_cached_source(
    file.path(downloads_directory, "ema-documents", "epar_documents.json"),
    fixture_epar_documents_path(),
    list(
      url = epar_documents_url,
      etag = "\"1790394761\"",
      last_modified = "Sat, 26 Sep 2026 03:52:41 GMT",
      retrieved = "2026-09-26T15:30:56Z"
    )
  )
  seed_cached_source(
    file.path(
      downloads_directory, "ema-orphans", "orphan_designations.json"
    ),
    fixture_ema_orphan_path(),
    list(
      url = ema_orphan_designations_url,
      etag = NA_character_,
      last_modified = "Sat, 26 Sep 2026 16:10:39 GMT",
      retrieved = "2026-09-26T16:45:21Z"
    )
  )
  seed_cached_source(
    file.path(downloads_directory, "union-register", "ods_products.json"),
    fixture_union_register_path(),
    list(
      url = union_register_url,
      etag = "\"ff8867-65c507c733087\"",
      last_modified = "Fri, 25 Sep 2026 15:36:55 GMT",
      retrieved = "2026-09-26T15:31:22Z"
    )
  )
  seed_whocc_downloads(file.path(downloads_directory, "whocc"))
  downloads_directory
}

# WHOCC index pages are answered with a real page for an unknown code, so
# every code the ATC sources do not name stays unnamed.
run_fixture_pipeline <- function(output_directory,
                                 cache_path = copy_fixture_to_cache(),
                                 downloads_directory =
                                   seed_downloads_directory(),
                                 smpc_budget = 0L,
                                 equivalents = no_equivalents(),
                                 copies = no_curated_copies(),
                                 pumas = no_curated_pumas(),
                                 efficacy_path = file.path(
                                   tempfile(), "efficacy-rows.json"
                                 )) {
  # Read before the curated tables are mocked to return them.
  force(equivalents)
  force(copies)
  force(pumas)
  testthat::local_mocked_bindings(
    fetch_whocc_index_page = function(page) {
      read_fixture_bytes(fixture_whocc_index_path("L04AC28"))
    },
    curated_substance_equivalents = function() equivalents,
    curated_copy_medicines = function() copies,
    curated_puma_medicines = function() pumas
  )
  run_ema_pipeline(
    output_directory = output_directory,
    cache_path = cache_path,
    downloads_directory = downloads_directory,
    smpc_budget = smpc_budget,
    gleif_path = fixture_gleif_matches_path(),
    chembl_path = fixture_chembl_matches_path(),
    explanations_path = fixture_atc_explanations_path(),
    efficacy_path = efficacy_path
  )
}

# The curated pairs' keys are not in the fixture EMA data.
no_equivalents <- function() {
  curated_substance_equivalents()[0, ]
}

# Nor are the curated copies and paediatric-use marketing authorisations.
no_curated_copies <- function() {
  curated_copy_medicines()[0, ]
}

no_curated_pumas <- function() {
  curated_puma_medicines()[0, ]
}

output_stems <- c(
  "ema_medicines",
  "ema_medicine_therapeutic_areas",
  "ema_medicine_active_substances",
  "ema_medicine_atc_codes",
  "ema_medicine_substances",
  "atc_classes",
  "ema_therapeutic_area_branches",
  "ema_therapeutic_area_subtree",
  "ema_authorized_series",
  "ema_medicine_documents",
  "ema_medicine_primary_documents",
  "mesh_entry_terms",
  "mesh_descriptor_areas",
  "mesh_descriptor_notes",
  "ema_search_index",
  "ema_medicine_orphan_exclusivity",
  "ema_medicine_register_status",
  "ema_medicine_smpc_atc",
  "ema_medicine_companies",
  "companies",
  "ema_medicine_protection",
  "ema_substance_equivalents",
  "ema_curated_copies",
  "ema_curated_pumas",
  "ema_medicine_modalities",
  "modalities",
  "atc_class_explanations",
  "ema_medicine_efficacy"
)

test_that("run_ema_pipeline writes every table and meta.json from caches", {
  forbid_network()
  output_directory <- file.path(tempfile(), "data")
  tables <- suppressMessages(run_fixture_pipeline(output_directory))
  expect_named(tables, output_stems)
  expect_setequal(
    list.files(output_directory),
    c(paste0(output_stems, ".json"), "meta.json")
  )
  expect_identical(nrow(tables$ema_medicines), 19L)

  meta <- jsonlite::fromJSON(
    file.path(output_directory, "meta.json"),
    simplifyVector = FALSE
  )
  expect_identical(meta$source_url, ema_medicines_url)
  expect_identical(meta$source_timestamp, "2026-09-26T06:02:29Z")
  expect_identical(meta$row_counts, lapply(tables, nrow))
  expect_identical(meta$snapshot_date, "2026-09-26")
  # Fluad 29 days, Boey 55, Mounjaro 56 and Tyruko 64.
  expect_identical(meta$opinion_to_decision, list(
    median_days = 56L,
    p90_days = 62L,
    medicines = 4L,
    opinions_from = "2021-09-26"
  ))
  expect_identical(
    vapply(meta$sources[1:6], function(source) source$version, character(1)),
    c(
      "2026-09-26T06:02:29Z", "MeSH 2026", "ChEMBL_37",
      "2026-09-26T05:49:47Z", "2026-09-26T18:10:39Z",
      "Fri, 25 Sep 2026 15:36:55 GMT"
    )
  )
  expect_identical(
    vapply(meta$sources[7:12], function(source) source$url, character(1)),
    c(
      whocc_updates_url(current_year()),
      whocc_updates_url(current_year() - 1L),
      whocc_temporary_url,
      whocc_alterations_url,
      "https://atcddd.fhi.no/atc_ddd_index/",
      "https://www.ema.europa.eu/en/medicines"
    )
  )
  expect_identical(
    meta$sources[[7]]$version,
    paste("ATC/DDD Index", current_year())
  )
  expect_identical(
    meta$sources[[8]]$version,
    paste("ATC/DDD Index", current_year() - 1L)
  )
  expect_identical(
    meta$sources[[9]]$version,
    "Mon, 17 Aug 2026 07:56:13 GMT"
  )
  expect_identical(meta$sources[[10]]$version, "ATC alterations to 2026")
  expect_identical(meta$sources[[11]]$version, "2026-01-20")
  expect_match(
    meta$sources[[11]]$attribution,
    "ATC/DDD Index 2026-01-20",
    fixed = TRUE
  )
  expect_identical(
    meta$sources[[12]]$version,
    "0 product information documents checked"
  )
  expect_null(meta$sources[[12]]$retrieved)
  expect_match(meta$sources[[10]]$licence, "no commercial", fixed = TRUE)
  expect_identical(
    meta$sources[[2]]$last_modified,
    "Wed, 12 Aug 2026 18:05:02 GMT"
  )
  expect_identical(
    vapply(meta$sources[4:6], function(source) source$url, character(1)),
    c(epar_documents_url, ema_orphan_designations_url, union_register_url)
  )
  expect_identical(meta$sources[[6]]$retrieved, "2026-09-26")
  expect_match(meta$sources[[6]]$attribution, "Union Register", fixed = TRUE)
  expect_identical(meta$licence, data_licence)
})

test_that("run_ema_pipeline builds the lookup tables from cached sources", {
  forbid_network()
  tables <- suppressMessages(
    run_fixture_pipeline(file.path(tempfile(), "data"))
  )
  documents <- tables$ema_medicine_documents
  expect_setequal(
    unique(documents$ema_product_number),
    paste0("EMEA/H/C/", c("000112", "000697", "003933", "004090"))
  )
  expect_identical(nrow(tables$ema_search_index), 19L)
  expect_identical(nrow(tables$ema_medicine_protection), 14L)
  tyruko <- tables$ema_medicine_protection[
    tables$ema_medicine_protection$ema_product_number == "EMEA/H/C/005752",
  ]
  expect_identical(tyruko$basis, "reference_not_found")
  expect_identical(
    unique(tables$ema_medicine_orphan_exclusivity$ema_product_number),
    c("EMEA/H/C/003933", "EMEA/H/C/004090")
  )
  expect_identical(nrow(tables$ema_medicine_orphan_exclusivity), 5L)
  register_status <- tables$ema_medicine_register_status
  expect_identical(
    register_status$ema_product_number,
    paste0("EMEA/H/C/", c("000697", "003933", "004090", "005282"))
  )
  expect_identical(
    register_status$agrees_with_ema,
    c(FALSE, TRUE, TRUE, FALSE)
  )
  # The fixture MeSH has none of the fixture EMA terms.
  expect_identical(nrow(tables$mesh_entry_terms), 0L)
  expect_identical(nrow(tables$mesh_descriptor_areas), 0L)
  expect_identical(nrow(tables$mesh_descriptor_notes), 0L)
  expect_identical(nrow(tables$ema_therapeutic_area_subtree), 0L)
})

test_that("run_ema_pipeline returns the tables invisibly", {
  forbid_network()
  expect_invisible(suppressMessages(run_fixture_pipeline(
    file.path(tempfile(), "data")
  )))
})

test_that("run_ema_pipeline reports files, MeSH matches and the series", {
  forbid_network()
  messages <- testthat::capture_messages(run_fixture_pipeline(
    file.path(tempfile(), "data")
  ))
  expect_match(messages, "Using cached EMA data", all = FALSE)
  expect_match(messages, "Using cached MeSH 2026", all = FALSE)
  expect_match(messages, "Using cached ChEMBL_37 ATC classes", all = FALSE)
  expect_match(messages, "ema_medicines\\.json.*: 19 rows", all = FALSE)
  expect_match(messages, "meta\\.json.*EMA data as of", all = FALSE)
  expect_match(
    messages,
    "MeSH terms: 0 heading, 0 entry term, 0 curated, 25 unmatched",
    all = FALSE
  )
  expect_match(messages, "Unmatched MeSH terms:.*Psoriasis", all = FALSE)
  expect_match(
    messages,
    "Authorized on 2026-09-26: series 12 products .* tile 12",
    all = FALSE
  )
  expect_match(messages, "Using cached EMA EPAR documents index", all = FALSE)
  expect_match(messages, "Using cached EMA orphan designations", all = FALSE)
  expect_match(messages, "Using cached Union Register products", all = FALSE)
  expect_match(
    messages,
    "Documents: 3 of 14 Authorised medicines have product information",
    all = FALSE
  )
  expect_match(
    messages,
    "Protection estimates: 6 protected, 4 ended, 4 unclear",
    all = FALSE
  )
  expect_match(
    messages,
    "Orphan exclusivity: 2 of 2 Authorised orphan medicines linked",
    all = FALSE
  )
  expect_match(
    messages,
    "Union Register status: 4 EMA products linked \\(2 of 14 Authorised\\)",
    all = FALSE
  )
  expect_match(messages, "Using cached WHOCC ATC alterations", all = FALSE)
  expect_match(
    messages,
    "SmPC ATC checks: 0 requests this run \\(budget 0\\); 0 products checked",
    all = FALSE
  )
  expect_match(
    messages,
    "0 EMA codes completed .*; 1 Authorised products still to check",
    all = FALSE
  )
  expect_match(messages, "ATC codes? without a name", all = FALSE)
})

test_that("run_ema_pipeline completes an incomplete code from the SmPC", {
  pdf_urls <- new.env()
  pdf_urls$requested <- character()
  testthat::local_mocked_bindings(
    req_perform = function(req, path = NULL, ...) {
      pdf_urls$requested <- c(pdf_urls$requested, req$url)
      writeLines("%PDF-1.7", path)
      httr2::response(status_code = 200)
    },
    .package = "httr2"
  )
  testthat::local_mocked_bindings(
    wait_seconds = function(seconds) NULL,
    # Worded as section 5.1 of the Fintepla SmPC.
    read_pdf_text = function(path) {
      paste(
        "Pharmacotherapeutic group: Antiepileptics, other antiepileptics,",
        "ATC code: N03AX26"
      )
    }
  )
  downloads_directory <- seed_downloads_directory()
  output_directory <- file.path(tempfile(), "data")
  # The completed code brings classes the explanations fixture lacks.
  expect_warning(
    messages <- testthat::capture_messages(
      tables <- run_fixture_pipeline(
        output_directory,
        downloads_directory = downloads_directory,
        smpc_budget = 5L
      )
    ),
    "no explanation.*N03A.*N03AX"
  )
  expect_length(pdf_urls$requested, 1)
  expect_match(pdf_urls$requested, "fintepla", fixed = TRUE)
  atc_codes <- tables$ema_medicine_atc_codes
  fintepla <- atc_codes[atc_codes$ema_product_number == "EMEA/H/C/003933", ]
  expect_identical(fintepla$atc_code_human, "N03")
  expect_true(fintepla$atc_incomplete)
  expect_identical(fintepla$atc_code, "N03AX26")
  expect_identical(fintepla$atc_code_source, "ema_smpc")
  expect_identical(fintepla$atc_code_document_url, pdf_urls$requested)
  expect_identical(fintepla$atc_code_document_date, as.Date("2026-04-09"))
  expect_identical(
    tables$ema_medicine_smpc_atc[c("ema_product_number", "atc_code")],
    dplyr::tibble(ema_product_number = "EMEA/H/C/003933", atc_code = "N03AX26")
  )
  expect_identical(
    read_smpc_checks(file.path(downloads_directory, "ema-smpc", "checks.json")),
    tables$ema_medicine_smpc_atc
  )
  expect_match(
    messages,
    paste(
      "SmPC ATC checks: 1 request this run \\(budget 5\\);",
      "1 products checked: 1 code found"
    ),
    all = FALSE
  )
  expect_match(
    messages,
    "1 EMA codes completed \\(1 products\\), .*; SmPC codes: 1 used,",
    all = FALSE
  )
  expect_false(fintepla$atc_code_conflict)
  meta <- jsonlite::fromJSON(file.path(output_directory, "meta.json"))
  expect_identical(
    meta$sources$version[12],
    "1 product information documents checked"
  )

  pdf_urls$requested <- character()
  unlink(file.path(downloads_directory, "ema-smpc"), recursive = TRUE)
  expect_warning(
    again <- suppressMessages(run_fixture_pipeline(
      output_directory,
      downloads_directory = downloads_directory,
      smpc_budget = 5L
    )),
    "no explanation"
  )
  expect_length(pdf_urls$requested, 0)
  expect_identical(again$ema_medicine_smpc_atc, tables$ema_medicine_smpc_atc)
})

test_that("run_ema_pipeline completes an incomplete code from curated codes", {
  forbid_network()
  # Bimzelx: EMA's L04AC; bimekizumab is L04AC21 in the ATC/DDD Index 2026.
  testthat::local_mocked_bindings(
    curated_atc_codes = function() {
      dplyr::tibble(
        ema_product_number = "EMEA/H/C/005316",
        atc_code = "L04AC21",
        evidence_source = "whocc_index",
        evidence_url = whocc_index_url("L04AC"),
        checked_date = as.Date("2026-09-27"),
        note = "Bimzelx: bimekizumab"
      )
    }
  )
  messages <- testthat::capture_messages(
    tables <- run_fixture_pipeline(file.path(tempfile(), "data"))
  )
  atc_codes <- tables$ema_medicine_atc_codes
  bimzelx <- atc_codes[atc_codes$ema_product_number == "EMEA/H/C/005316", ]
  expect_identical(bimzelx$atc_code_human, "L04AC")
  expect_identical(bimzelx$atc_code, "L04AC21")
  expect_identical(bimzelx$atc_code_source, "curated")
  expect_false(bimzelx$atc_code_conflict)
  expect_true(bimzelx$atc_final_level)
  expect_identical(bimzelx$atc_code_document_url, whocc_index_url("L04AC"))
  expect_match(
    messages,
    "Curated ATC codes: 1 used \\(0 although",
    all = FALSE
  )
  expect_match(
    messages,
    "Curated ATC codes used:.*EMEA/H/C/005316 L04AC21",
    all = FALSE
  )
})

test_that("run_ema_pipeline writes its outputs while WHOCC is unreachable", {
  testthat::local_mocked_bindings(
    req_perform = function(req, ...) {
      if (!startsWith(req$url, whocc_url)) {
        stop("network must not be used")
      }
      stop(structure(
        class = c("httr2_failure", "httr2_error", "error", "condition"),
        list(message = "Could not resolve host", call = NULL)
      ))
    },
    .package = "httr2"
  )
  downloads_directory <- seed_downloads_directory()
  unlink(file.path(downloads_directory, "whocc"), recursive = TRUE)
  output_directory <- file.path(tempfile(), "data")
  warnings <- testthat::capture_warnings(
    tables <- suppressMessages(run_fixture_pipeline(
      output_directory,
      downloads_directory = downloads_directory
    ))
  )
  expect_length(warnings, 4)
  expect_match(warnings, "Could not resolve host.*no cached copy")
  expect_setequal(
    list.files(output_directory),
    c(paste0(output_stems, ".json"), "meta.json")
  )
  expect_false(any(
    c("whocc_updates", "whocc_alterations") %in% tables$atc_classes$source
  ))
  meta <- jsonlite::fromJSON(file.path(output_directory, "meta.json"))
  # The ATC class explanations after the ATC sources, the three modality
  # entries after the others.
  expect_identical(nrow(meta$sources), 15L)
  expect_identical(
    meta$sources$url[7:10],
    c(
      "https://atcddd.fhi.no/atc_ddd_index/",
      "https://www.ema.europa.eu/en/medicines",
      paste0(
        "https://github.com/vrognas/approval-atlas/blob/main/",
        atc_explanations_path
      ),
      union_register_url
    )
  )
})

test_that("run_ema_pipeline builds the company tables and credits them", {
  forbid_network()
  output_directory <- file.path(tempfile(), "data")
  messages <- testthat::capture_messages(
    tables <- run_fixture_pipeline(output_directory)
  )
  medicines <- tables$ema_medicine_companies
  expect_identical(nrow(medicines), 19L)
  medicine <- function(product_number) {
    medicines[medicines$ema_product_number == product_number, ]
  }
  # Fintepla: UCB, linked to the register (holder in Belgium).
  expect_identical(medicine("EMEA/H/C/003933")$group_key, "g.ucb")
  expect_identical(medicine("EMEA/H/C/003933")$country, "BE")
  # Fingolimod Mylan: the register names Mylan Pharmaceuticals Limited.
  fingolimod <- medicine("EMEA/H/C/005282")
  expect_identical(fingolimod$holder_ema, "Mylan Ireland Limited")
  expect_identical(fingolimod$holder_used, "Mylan Pharmaceuticals Limited")
  expect_identical(fingolimod$holder_basis, "register")
  expect_identical(fingolimod$group_key, "g.viatris")
  expect_identical(medicine("EMEA/H/C/005752")$group_key, "g.sandoz")
  companies <- tables$companies
  msd <- companies[companies$key == "c.merck-sharp-dohme", ]
  expect_identical(msd$lei, "549300YUY8VFXLXSSB43")
  # Sandoz GmbH's LEI names Novartis AG: not applied.
  expect_identical(
    companies$lei[companies$key == "c.sandoz"],
    NA_character_
  )
  meta <- jsonlite::fromJSON(
    file.path(output_directory, "meta.json"),
    simplifyVector = FALSE
  )
  expect_identical(
    vapply(meta$sources[14:16], function(source) source$name, character(1)),
    c(
      paste(
        "Union Register of medicinal products (European Commission):",
        "marketing authorisation holders"
      ),
      "GLEIF Legal Entity Identifier (LEI) records",
      "Company groups (curated by approval-atlas)"
    )
  )
  expect_identical(meta$sources[[15]]$retrieved, "2026-09-28")
  expect_match(messages, "Companies: [0-9]+ companies in", all = FALSE)
  expect_match(messages, "GLEIF: [0-9]+ matches applied", all = FALSE)
})

test_that("run_ema_pipeline writes and credits the ATC class explanations", {
  forbid_network()
  output_directory <- file.path(tempfile(), "data")
  # The fixture holds an explanation for every class the fixture data uses.
  expect_no_warning(
    suppressMessages(tables <- run_fixture_pipeline(output_directory)),
    message = "ATC class"
  )
  written <- jsonlite::fromJSON(
    file.path(output_directory, "atc_class_explanations.json")
  )
  expect_named(
    written,
    c("atc_code", "level", "explanation", "checked_date", "source")
  )
  expect_identical(nrow(written), 46L)
  expect_identical(
    written$atc_code,
    atc_explained_classes_in_use(tables$ema_medicine_atc_codes)
  )
  expect_identical(unique(written$source), "approval_atlas")
  expect_type(written$level, "integer")
  meta <- jsonlite::fromJSON(
    file.path(output_directory, "meta.json"),
    simplifyVector = FALSE
  )
  expect_identical(meta$sources[[13]]$name, "ATC class explanations")
  expect_identical(meta$sources[[13]]$version, "Checked 2026-09-29")
  expect_match(meta$licence, "own plain-language summaries", fixed = TRUE)
})

efficacy_sample_path <- function() {
  testthat::test_path("fixtures", "efficacy", "efficacy-rows-sample.json")
}

test_that("run_ema_pipeline writes an empty efficacy table without rows", {
  forbid_network()
  output_directory <- file.path(tempfile(), "data")
  tables <- suppressMessages(run_fixture_pipeline(output_directory))
  expect_identical(nrow(tables$ema_medicine_efficacy), 0L)
  expect_identical(
    names(tables$ema_medicine_efficacy),
    names(build_efficacy_table(
      read_efficacy_rows(efficacy_sample_path()),
      dplyr::tibble(ema_product_number = "EMEA/H/C/004164")
    ))
  )
  expect_identical(
    readLines(file.path(output_directory, "ema_medicine_efficacy.json")),
    c("[", "]")
  )
  meta <- jsonlite::fromJSON(
    file.path(output_directory, "meta.json"),
    simplifyVector = FALSE
  )
  expect_false(any(grepl(
    "Pivotal results", purrr::map_chr(meta$sources, "name")
  )))
})

test_that("run_ema_pipeline writes and credits the pivotal results", {
  forbid_network()
  output_directory <- file.path(tempfile(), "data")
  # The sample's first medicine stands in for one of the fixture medicines.
  fixture_number <- read_fixture_ema()$data$ema_product_number[1]
  rows <- read_efficacy_rows(efficacy_sample_path())
  rows$ema_product_number[
    rows$ema_product_number == "EMEA/H/C/004164"
  ] <- fixture_number
  efficacy_path <- file.path(tempfile(), "efficacy-rows.json")
  dir.create(dirname(efficacy_path))
  write_json_table(rows, efficacy_path)
  messages <- testthat::capture_messages(
    tables <- run_fixture_pipeline(
      output_directory,
      efficacy_path = efficacy_path
    )
  )
  expect_setequal(
    tables$ema_medicine_efficacy$ema_product_number,
    fixture_number
  )
  expect_identical(nrow(tables$ema_medicine_efficacy), 2L)
  written <- jsonlite::fromJSON(
    file.path(output_directory, "ema_medicine_efficacy.json")
  )
  expect_identical(nrow(written), 2L)
  expect_identical(unique(written$source), "ema_smpc")
  expect_type(written$quotes, "list")
  expect_match(
    messages, "Pivotal results: 1 medicines, 2 rows shown",
    all = FALSE
  )
  meta <- jsonlite::fromJSON(
    file.path(output_directory, "meta.json"),
    simplifyVector = FALSE
  )
  expect_match(meta$sources[[14]]$name, "^Pivotal results")
  expect_identical(meta$row_counts$ema_medicine_efficacy, 2L)
})

test_that("run_ema_pipeline stops on a malformed efficacy row", {
  forbid_network()
  rows <- read_efficacy_rows(efficacy_sample_path())
  rows$review[1] <- "maybe"
  efficacy_path <- file.path(tempfile(), "efficacy-rows.json")
  dir.create(dirname(efficacy_path))
  write_json_table(rows, efficacy_path)
  expect_error(
    suppressMessages(run_fixture_pipeline(
      file.path(tempfile(), "data"),
      efficacy_path = efficacy_path
    )),
    "maybe"
  )
})

test_that("run_ema_pipeline classifies modalities and credits the sources", {
  forbid_network()
  output_directory <- file.path(tempfile(), "data")
  messages <- testthat::capture_messages(
    tables <- run_fixture_pipeline(output_directory)
  )
  modalities <- tables$ema_medicine_modalities
  expect_setequal(
    unique(modalities$ema_product_number),
    tables$ema_medicines$ema_product_number
  )
  modality <- function(product_number) {
    rows <- modalities[modalities$ema_product_number == product_number, ]
    paste0(rows$modality_group, "/", rows$modality)
  }
  # Kymriah: the curated CAR-T row (EMA's ATMP flag names the group).
  expect_identical(modality("EMEA/H/C/004090"), "cell_gene/car_t")
  # Mounjaro: tirzepatide, a peptide by its INN stem.
  expect_identical(modality("EMEA/H/C/005620"), "protein/peptide")
  # Suboxone: two small molecules by ChEMBL.
  expect_identical(
    modality("EMEA/H/C/000697"),
    rep("small_molecule/small_molecule", 2)
  )
  # Twinrix Adult: an inactivated vaccine by EMA's text.
  expect_identical(modality("EMEA/H/C/000112"), "vaccine/inactivated_vaccine")
  # Frehemgo: denecimig, "-mig".
  expect_identical(modality("EMEA/H/C/006344"), "antibody/bispecific_antibody")
  expect_identical(tables$modalities, modality_taxonomy())
  written <- jsonlite::fromJSON(
    file.path(output_directory, "ema_medicine_modalities.json")
  )
  expect_named(written, modality_row_columns)
  meta <- jsonlite::fromJSON(
    file.path(output_directory, "meta.json"),
    simplifyVector = FALSE
  )
  names <- vapply(meta$sources, function(source) source$name, character(1))
  expect_identical(
    utils::tail(names, 3),
    c(
      "WHO INN stems",
      "ChEMBL molecules",
      "Curated modalities"
    )
  )
  expect_identical(meta$row_counts$modalities, 38L)
  expect_match(messages, "Modalities, medicines \\(Authorised\\)", all = FALSE)
})

test_that("run_ema_pipeline adds the authorization and substance columns", {
  forbid_network()
  tables <- suppressMessages(
    run_fixture_pipeline(file.path(tempfile(), "data"))
  )
  medicines <- tables$ema_medicines
  expect_identical(
    utils::tail(names(medicines), 5),
    c(
      "medicine_type", "authorized_from", "authorized_until",
      "series_exclusion", "substance_set_key"
    )
  )
  expect_length(medicines, 33 + 4)
  suboxone <- medicines[medicines$ema_product_number == "EMEA/H/C/000697", ]
  expect_identical(suboxone$authorized_until, as.Date("2026-09-11"))
  expect_identical(suboxone$substance_set_key, "buprenorphine|naloxone")
  series <- tables$ema_authorized_series
  expect_identical(utils::tail(series$date, 1), as.Date("2026-09-26"))
  expect_identical(utils::tail(series$authorized_products, 1), 12L)
  expect_identical(
    unique(tables$ema_medicine_atc_codes$source),
    "ema"
  )
  expect_true(all(
    tables$ema_therapeutic_area_branches$source %in%
      c("mesh_heading", "entry_term", "curated", "unmatched")
  ))
  expect_true(all(
    tables$ema_therapeutic_area_subtree$source %in%
      c("mesh_heading", "entry_term", "curated")
  ))
})

test_that("run_ema_pipeline output follows the data contract", {
  forbid_network()
  output_directory <- file.path(tempfile(), "data")
  suppressMessages(run_fixture_pipeline(output_directory))
  read_output <- function(stem) {
    jsonlite::fromJSON(file.path(output_directory, paste0(stem, ".json")))
  }
  medicines <- read_output("ema_medicines")
  expect_false(any(unlist(medicines) == "", na.rm = TRUE))
  expect_type(medicines$generic, "logical")
  expect_type(medicines$revision_number, "integer")
  for (date_column in c("marketing_authorisation_date", "authorized_from")) {
    expect_true(all(
      grepl("^\\d{4}-\\d{2}-\\d{2}$", medicines[[date_column]]) |
        is.na(medicines[[date_column]])
    ))
  }
  product_lookups <- c(
    "ema_medicine_therapeutic_areas",
    "ema_medicine_active_substances",
    "ema_medicine_atc_codes",
    "ema_medicine_substances",
    "ema_medicine_documents",
    "ema_medicine_primary_documents",
    "ema_search_index",
    "ema_medicine_protection",
    "ema_medicine_orphan_exclusivity",
    "ema_medicine_register_status",
    "ema_medicine_smpc_atc"
  )
  for (stem in product_lookups) {
    lookup <- read_output(stem)
    expect_in(
      lookup$ema_product_number %||% character(),
      medicines$ema_product_number
    )
    expect_false(any(unlist(lookup) == "", na.rm = TRUE))
  }
  atc_codes <- read_output("ema_medicine_atc_codes")
  expect_type(atc_codes$atc_incomplete, "logical")
  expect_type(atc_codes$atc_code_conflict, "logical")
  expect_type(atc_codes$atc_final_level, "logical")
  expect_identical(atc_codes$atc_code, atc_codes$atc_code_human)
  expect_identical(unique(atc_codes$atc_code_source), "ema")
  atc_classes <- read_output("atc_classes")
  expect_type(atc_classes$level, "integer")
  expect_in(atc_classes$status, c("current", "retired", "temporary"))
  expect_type(
    read_output("ema_authorized_series")$authorized_products,
    "integer"
  )
  raw_text <- unlist(lapply(
    list.files(output_directory, full.names = TRUE),
    readLines,
    warn = FALSE,
    encoding = "UTF-8"
  ))
  expect_no_match(raw_text, ":\"\"", fixed = TRUE)
})

test_that("run_ema_pipeline aborts before writing when source checks fail", {
  forbid_network()
  cache_path <- write_modified_fixture(function(ema) {
    ema$meta$total_records <- 999
    ema
  })
  output_directory <- file.path(tempfile(), "data")
  expect_error(
    suppressMessages(run_fixture_pipeline(output_directory, cache_path)),
    "999"
  )
  expect_false(dir.exists(output_directory))
})

test_that("run_ema_pipeline aborts before writing when table checks fail", {
  forbid_network()
  cache_path <- write_modified_fixture(function(ema) {
    ema$data$ema_product_number[2] <- ema$data$ema_product_number[1]
    ema
  })
  output_directory <- file.path(tempfile(), "data")
  expect_error(
    suppressMessages(run_fixture_pipeline(output_directory, cache_path)),
    "ema_product_number"
  )
  expect_false(dir.exists(output_directory))
})

test_that("run_ema_pipeline aborts before writing if tile and series differ", {
  forbid_network()
  cache_path <- write_modified_fixture(function(ema) {
    is_tyruko <- ema$data$ema_product_number == "EMEA/H/C/005752"
    ema$data$withdrawal_expiry_revocation_lapse_of_marketing_authorisation_date[
      is_tyruko
    ] <- "01/01/2025"
    ema
  })
  output_directory <- file.path(tempfile(), "data")
  expect_error(
    suppressMessages(run_fixture_pipeline(output_directory, cache_path)),
    "EMEA/H/C/005752 Tyruko"
  )
  expect_false(dir.exists(output_directory))
})

test_that("run_ema_pipeline writes the substance equivalents it uses", {
  forbid_network()
  # Two fixture keys stand in for a curated pair of salt spellings.
  equivalents <- dplyr::tibble(
    substance_key = "natalizumab",
    equivalent_key = "tirzepatide",
    evidence_url = "https://www.ema.europa.eu/en/medicines/human/EPAR/tyruko",
    checked_date = as.Date("2026-09-28"),
    note = "Stand-in pair"
  )
  output_directory <- file.path(tempfile(), "data")
  tables <- suppressMessages(
    run_fixture_pipeline(output_directory, equivalents = equivalents)
  )
  written <- jsonlite::fromJSON(
    file.path(output_directory, "ema_substance_equivalents.json")
  )
  expect_identical(written$substance_key, c("natalizumab", "tirzepatide"))
  expect_identical(written$equivalent_key, c("tirzepatide", "natalizumab"))
  expect_identical(unique(written$checked_date), "2026-09-28")
  expect_identical(unique(written$basis), "curated")
  tyruko <- tables$ema_medicine_protection[
    tables$ema_medicine_protection$ema_product_number == "EMEA/H/C/005752",
  ]
  expect_identical(tyruko$basis, "follows_reference")
  expect_identical(tyruko$reference_name, "Mounjaro")
})

test_that("run_ema_pipeline applies, writes and credits the curated copies", {
  forbid_network()
  # Mounjaro stands in for a hybrid of Suboxone.
  copies <- dplyr::tibble(
    ema_product_number = "EMEA/H/C/005620",
    copy_type = "hybrid",
    reference_product_number = "EMEA/H/C/000697",
    reference_name = "Suboxone",
    evidence_url = "https://www.ema.europa.eu/en/medicines/human/EPAR/mounjaro",
    evidence_quote = "Stand-in is a ‘hybrid medicine’.",
    checked_date = as.Date("2026-09-29"),
    note = "Stand-in row"
  )
  output_directory <- file.path(tempfile(), "data")
  tables <- suppressMessages(run_fixture_pipeline(
    output_directory,
    copies = copies
  ))
  protection <- tables$ema_medicine_protection
  mounjaro <- protection[protection$ema_product_number == "EMEA/H/C/005620", ]
  expect_identical(mounjaro$basis, "follows_reference")
  expect_identical(mounjaro$copy_source, "curated")
  expect_identical(mounjaro$reference_name, "Suboxone")
  expect_identical(mounjaro$status, "ended")
  written <- jsonlite::fromJSON(
    file.path(output_directory, "ema_curated_copies.json")
  )
  expect_identical(written$ema_product_number, "EMEA/H/C/005620")
  expect_identical(written$copy_type, "hybrid")
  expect_identical(written$checked_date, "2026-09-29")
  expect_identical(written$source, "curated")
  meta <- jsonlite::fromJSON(
    file.path(output_directory, "meta.json"),
    simplifyVector = FALSE
  )
  # The curated copies come before the three modality entries.
  last_source <- meta$sources[[length(meta$sources) - 3]]
  expect_match(last_source$name, "curated by approval-atlas from EMA EPAR")
  expect_identical(last_source$version, "Checked 2026-09-29")
})

test_that("run_ema_pipeline applies, writes and credits the curated PUMAs", {
  forbid_network()
  # Tyruko, a biosimilar, stands in for a paediatric-use marketing
  # authorisation.
  pumas <- dplyr::tibble(
    ema_product_number = "EMEA/H/C/005752",
    evidence_url = paste0(
      "https://www.ema.europa.eu/en/documents/assessment-report/",
      "tyruko-epar-public-assessment-report_en.pdf"
    ),
    evidence_quote = "an application for a Paediatric Use marketing
    authorisation",
    checked_date = as.Date("2026-09-29"),
    note = "Stand-in row"
  )
  output_directory <- file.path(tempfile(), "data")
  tables <- suppressMessages(run_fixture_pipeline(
    output_directory,
    pumas = pumas
  ))
  protection <- tables$ema_medicine_protection
  tyruko <- protection[protection$ema_product_number == "EMEA/H/C/005752", ]
  expect_identical(tyruko$basis, "paediatric_use")
  expect_identical(tyruko$copy_source, NA_character_)
  expect_identical(tyruko$counted_from, as.Date("2023-09-22"))
  expect_identical(tyruko$status, "protected")
  written <- jsonlite::fromJSON(
    file.path(output_directory, "ema_curated_pumas.json")
  )
  expect_identical(written$ema_product_number, "EMEA/H/C/005752")
  expect_identical(written$checked_date, "2026-09-29")
  expect_identical(written$source, "curated")
  meta <- jsonlite::fromJSON(
    file.path(output_directory, "meta.json"),
    simplifyVector = FALSE
  )
  last_source <- meta$sources[[length(meta$sources) - 3]]
  expect_match(last_source$name, "paediatric-use marketing authorisations")
  expect_identical(last_source$version, "Checked 2026-09-29")
})

test_that("run_ema_pipeline reports protection status changes", {
  forbid_network()
  output_directory <- file.path(tempfile(), "data")
  first_run <- testthat::capture_messages(
    run_fixture_pipeline(output_directory)
  )
  expect_no_match(first_run, "before this run")
  expect_match(
    first_run,
    paste(
      "Protection estimates: 6 protected, 4 ended, 4 unclear \\(0 follow a",
      "reference, 4 reference not found, 0 counted from another company"
    ),
    all = FALSE
  )
  path <- file.path(output_directory, "ema_medicine_protection.json")
  previous <- jsonlite::fromJSON(path)
  previous$status[previous$ema_product_number == "EMEA/H/C/005620"] <- "ended"
  write_json_table(previous, path)
  second_run <- testthat::capture_messages(
    run_fixture_pipeline(output_directory)
  )
  expect_match(
    second_run,
    paste(
      "Protection status: 5 protected, 5 ended, 4 unclear before this run,",
      "6 protected, 4 ended, 4 unclear now; 1 changed"
    ),
    all = FALSE
  )
  expect_match(
    second_run,
    "Mounjaro \\(EMEA/H/C/005620\\): ended -> protected \\(own\\)",
    all = FALSE
  )
})
