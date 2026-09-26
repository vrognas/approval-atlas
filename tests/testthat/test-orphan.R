# Real products (EMA medicines data, 2026-09-26) matching the fixture slices.
orphan_medicines <- function() {
  dplyr::tibble(
    ema_product_number = paste0(
      "EMEA/H/C/",
      c("000636", "002455", "002640", "003933", "004090", "005523",
        "005936", "006174", "006539")
    ),
    name_of_medicine = c(
      "Myozyme", "Adcetris", "Cometriq", "Fintepla", "Kymriah", "Tavneos",
      "Tibsovo", "Tidhesco", "Vijoice"
    ),
    medicine_status = c(
      "Authorised", "Authorised", "Authorised", "Authorised", "Authorised",
      "Revoked", "Authorised", "Application withdrawn", "Authorised"
    ),
    orphan_medicine = c(
      FALSE, FALSE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE
    ),
    marketing_authorisation_date = as.Date(c(
      "2006-03-28", "2012-10-25", "2014-03-21", "2020-12-18", "2018-08-23",
      "2022-01-11", "2023-05-04", NA, "2026-07-15"
    )),
    medicine_url = epar_page(c(
      "myozyme", "adcetris", "cometriq", "fintepla", "kymriah", "tavneos",
      "tibsovo", "tidhesco", "vijoice"
    ))
  )
}

fixture_orphan_table <- function(medicines = orphan_medicines()) {
  build_orphan_exclusivity_table(
    medicines,
    read_ema_orphan_designations(fixture_ema_orphan_path())$data,
    read_union_register(fixture_union_register_path())
  )
}

orphan_rows <- function(exclusivity, product_number) {
  exclusivity[exclusivity$ema_product_number == product_number, ]
}

write_register <- function(rows) {
  path <- tempfile(fileext = ".json")
  jsonlite::write_json(
    list(data = rows),
    path,
    auto_unbox = TRUE,
    null = "null"
  )
  path
}

is_register_row <- function(rows, page) {
  vapply(
    rows,
    function(row) grepl(paste0("/", page, "\\.htm$"), row$URI),
    logical(1)
  )
}

fixture_register_rows <- function() {
  jsonlite::fromJSON(
    fixture_union_register_path(),
    simplifyVector = FALSE
  )$data
}

test_that("the orphan source URLs are the EMA and Union Register files", {
  expect_identical(
    ema_orphan_designations_url,
    paste0(
      "https://www.ema.europa.eu/en/documents/report/",
      "medicines-output-orphan_designations-json-report_en.json"
    )
  )
  expect_identical(
    union_register_url,
    paste0(
      "https://ec.europa.eu/health/documents/community-register/ods/",
      "ods_products.json"
    )
  )
})

test_that("the orphan downloads use their host's spacing and cache folder", {
  downloads_directory <- tempfile()
  requested <- new.env()
  requested$realms <- character()
  testthat::local_mocked_bindings(
    req_perform = function(req, path = NULL, ...) {
      requested$realms <- c(requested$realms, req$policies$throttle_realm)
      writeLines("{}", path)
      httr2::response(status_code = 200)
    },
    .package = "httr2"
  )
  orphan_source <- suppressMessages(download_orphan_designations(
    file.path(downloads_directory, "ema-orphans")
  ))
  register_source <- suppressMessages(download_union_register(
    file.path(downloads_directory, "union-register")
  ))
  expect_identical(requested$realms, c("ema.europa.eu", "ec.europa.eu"))
  expect_identical(
    orphan_source$path,
    file.path(
      downloads_directory, "ema-orphans", "orphan_designations.json"
    )
  )
  expect_identical(
    register_source$path,
    file.path(downloads_directory, "union-register", "ods_products.json")
  )
})

test_that("ec_request allows one request per second to the EC host", {
  requested <- new.env()
  testthat::local_mocked_bindings(
    throttled_request = function(url, spacing_seconds, realm) {
      requested$spacing_seconds <- spacing_seconds
      requested$realm <- realm
    }
  )
  ec_request(union_register_url)
  expect_identical(requested$spacing_seconds, 1)
  expect_identical(requested$realm, "ec.europa.eu")
})

test_that("read_ema_orphan_designations keeps meta and the fields in use", {
  designations <- read_ema_orphan_designations(
    fixture_ema_orphan_path()
  )
  expect_identical(designations$meta$timestamp, "2026-09-26T18:10:39Z")
  expect_identical(nrow(designations$data), 13L)
  expect_named(designations$data, ema_orphan_designation_fields)
})

test_that("read_ema_orphan_designations aborts on a missing field", {
  designations <- jsonlite::fromJSON(fixture_ema_orphan_path())
  designations$data$eu_designation_number <- NULL
  path <- tempfile(fileext = ".json")
  jsonlite::write_json(designations, path, auto_unbox = TRUE)
  expect_error(read_ema_orphan_designations(path), "eu_designation_number")
})

test_that("read_union_register splits products, designations and links", {
  register <- read_union_register(fixture_union_register_path())
  expect_named(register, c("products", "designations", "links"))
  expect_identical(nrow(register$products), 12L)
  adcetris <- register$products[grepl("/h794\\.htm$", register$products$uri), ]
  expect_identical(adcetris$ema_link, epar_page("adcetris"))
  expect_identical(adcetris$authorisation_date, as.Date("2012-10-25"))
  hodgkin <- register$designations[
    register$designations$eu_designation_number %in% "EU/3/08/596",
  ]
  expect_identical(hodgkin$designation_status, "Withdrawn")
  expect_identical(hodgkin$condition, "Treatment of Hodgkin lymphoma")
  adcetris_links <- register$links[register$links$product_uri == adcetris$uri, ]
  expect_identical(nrow(adcetris_links), 3L)
  expect_identical(adcetris_links$extension_months, c(24L, 24L, NA))
  expect_identical(
    adcetris_links$end_date,
    as.Date(c("2024-06-20", "2024-06-20", "2024-06-20"))
  )
  tavneos_links <- register$links[
    grepl("/h1605\\.htm$", register$links$product_uri),
  ]
  expect_identical(tavneos_links$link_date, as.Date(c(NA, NA)))
})

test_that("read_union_register aborts when a pinned field disappears", {
  rows <- fixture_register_rows()
  rows[[2]]$EMALink <- NULL
  error <- expect_error(
    read_union_register(write_register(rows)),
    class = "rlang_error"
  )
  expect_match(conditionMessage(error), "Union Register")
  expect_match(conditionMessage(error), "EMALink")

  rows <- fixture_register_rows()
  is_adcetris <- is_register_row(rows, "h794")
  rows[is_adcetris][[1]]$AssociatedOrphanDesignations[[1]]$LinkDate <- NULL
  expect_error(read_union_register(write_register(rows)), "LinkDate")
})

test_that("read_union_register aborts on a changed value format", {
  rows <- fixture_register_rows()
  is_adcetris <- is_register_row(rows, "h794")
  changed <- rows
  changed[is_adcetris][[1]]$EMALink <- list("a", "b")
  expect_error(read_union_register(write_register(changed)), "EMALink")

  changed <- rows
  changed[is_adcetris][[1]]$AuthorisationDate <- "25/10/2012"
  expect_error(read_union_register(write_register(changed)), "25/10/2012")

  changed <- rows
  changed[is_adcetris][[1]]$AssociatedOrphanDesignations[[1]]$ExtensionLength <-
    "two years"
  expect_error(read_union_register(write_register(changed)), "two years")

  changed <- rows
  is_designation <- vapply(
    rows,
    function(row) identical(row$Type, "Orphan designation"),
    logical(1)
  )
  changed[is_designation][[2]]$Indication <- "Treatment of x"
  expect_error(read_union_register(write_register(changed)), "Indication")
})

test_that("a designation without English text has no condition", {
  rows <- fixture_register_rows()
  is_hodgkin <- is_register_row(rows, "o596")
  rows[is_hodgkin][[1]]$Indication <- list()
  register <- read_union_register(write_register(rows))
  hodgkin <- register$designations[
    register$designations$eu_designation_number %in% "EU/3/08/596",
  ]
  expect_identical(hodgkin$condition, NA_character_)
})

test_that("a designation's condition text is squished", {
  # The register has stray whitespace, e.g. "...due to ocular burns\r".
  rows <- fixture_register_rows()
  is_hodgkin <- is_register_row(rows, "o596")
  rows[is_hodgkin][[1]]$Indication <- list(
    list(LanguageCode = "EN", Text = "Treatment of Hodgkin\r\nlymphoma \r")
  )
  register <- read_union_register(write_register(rows))
  hodgkin <- register$designations[
    register$designations$eu_designation_number %in% "EU/3/08/596",
  ]
  expect_identical(hodgkin$condition, "Treatment of Hodgkin lymphoma")
})

test_that("read_union_register aborts without product or designation rows", {
  rows <- fixture_register_rows()
  is_designation <- vapply(
    rows,
    function(row) identical(row$Type, "Orphan designation"),
    logical(1)
  )
  expect_error(
    read_union_register(write_register(rows[!is_designation])),
    "Orphan designation"
  )
  expect_error(read_union_register(write_register(list())), "no data rows")
})

test_that("build_orphan_exclusivity_table has one row per designation link", {
  exclusivity <- fixture_orphan_table()
  expect_named(
    exclusivity,
    c(
      "ema_product_number", "eu_designation_number", "condition",
      "link_date", "extension_months", "exclusivity_end", "end_source",
      "designation_status", "source"
    )
  )
  expect_identical(unique(exclusivity$source), "union_register")
  expect_identical(
    dplyr::count(exclusivity, .data$ema_product_number)$n,
    c(1L, 3L, 1L, 2L, 3L, 2L, 2L)
  )
  expect_identical(
    unique(exclusivity$ema_product_number),
    paste0(
      "EMEA/H/C/",
      c("000636", "002455", "002640", "003933", "004090", "005523", "005936")
    )
  )
})

test_that("an active designation's end is computed from the link date", {
  fintepla <- orphan_rows(fixture_orphan_table(), "EMEA/H/C/003933")
  expect_identical(
    fintepla$eu_designation_number,
    c("EU/3/13/1219", "EU/3/17/1836")
  )
  expect_identical(fintepla$link_date, as.Date(c("2020-12-21", "2023-01-31")))
  expect_identical(
    fintepla$exclusivity_end,
    as.Date(c("2030-12-21", "2033-01-31"))
  )
  expect_identical(fintepla$end_source, c("computed", "computed"))
  expect_identical(fintepla$designation_status, c("Active", "Active"))
  expect_identical(fintepla$condition[1], "Treatment of Dravet syndrome")
})

test_that("a register end date wins over the computed end", {
  adcetris <- orphan_rows(fixture_orphan_table(), "EMEA/H/C/002455")
  expect_identical(adcetris$extension_months, c(24L, 24L, NA))
  expect_identical(adcetris$exclusivity_end, as.Date(rep("2024-06-20", 3)))
  expect_identical(adcetris$end_source, rep("register", 3))
  tavneos <- orphan_rows(fixture_orphan_table(), "EMEA/H/C/005523")
  expect_identical(tavneos$link_date, as.Date(c(NA, NA)))
  expect_identical(
    tavneos$exclusivity_end,
    as.Date(c("2022-01-19", "2022-01-19"))
  )
})

test_that("the register link adds designations EMA does not relate", {
  kymriah <- orphan_rows(fixture_orphan_table(), "EMEA/H/C/004090")
  expect_identical(
    kymriah$eu_designation_number,
    c("EU/3/14/1266", "EU/3/16/1745", "EU/3/21/2464")
  )
  cometriq <- orphan_rows(fixture_orphan_table(), "EMEA/H/C/002640")
  expect_identical(cometriq$eu_designation_number, "EU/3/08/610")
  expect_identical(cometriq$exclusivity_end, as.Date("2024-03-26"))
})

test_that("a designation of another application is not attached", {
  exclusivity <- fixture_orphan_table()
  expect_false("EMEA/H/C/006174" %in% exclusivity$ema_product_number)
  expect_false("EMEA/H/C/006539" %in% exclusivity$ema_product_number)
})

test_that("the designation path needs the same MA date or page", {
  medicines <- orphan_medicines()
  is_tibsovo <- medicines$ema_product_number == "EMEA/H/C/005936"
  medicines$medicine_url[is_tibsovo] <- epar_page("tibsovo-renamed")
  expect_identical(
    nrow(orphan_rows(fixture_orphan_table(medicines), "EMEA/H/C/005936")),
    2L
  )
  medicines$marketing_authorisation_date[is_tibsovo] <- as.Date("2023-05-06")
  expect_identical(
    nrow(orphan_rows(fixture_orphan_table(medicines), "EMEA/H/C/005936")),
    0L
  )
})

test_that("the computed end adds the extension months", {
  register <- list(
    products = dplyr::tibble(
      uri = "p1",
      ema_link = epar_page("trecondi"),
      authorisation_date = as.Date("2019-06-20")
    ),
    designations = dplyr::tibble(
      uri = "d1",
      eu_designation_number = "EU/3/04/186",
      designation_status = "Active",
      condition = paste(
        "Conditioning treatment prior to haematopoietic progenitor cell",
        "transplantation"
      )
    ),
    links = dplyr::tibble(
      product_uri = "p1",
      designation_uri = "d1",
      link_date = as.Date("2019-06-24"),
      extension_months = 24L,
      end_date = as.Date(NA)
    )
  )
  medicines <- dplyr::tibble(
    ema_product_number = "EMEA/H/C/004751",
    name_of_medicine = "Trecondi",
    medicine_status = "Authorised",
    orphan_medicine = FALSE,
    marketing_authorisation_date = as.Date("2019-06-20"),
    medicine_url = epar_page("trecondi")
  )
  exclusivity <- build_orphan_exclusivity_table(
    medicines,
    dplyr::tibble(
      related_ema_product_number = character(),
      eu_designation_number = character(),
      intended_use = character(),
      status = character()
    ),
    register
  )
  expect_identical(exclusivity$exclusivity_end, as.Date("2031-06-24"))
  expect_identical(exclusivity$end_source, "computed")
})

test_that("an inactive designation without a register end date has no end", {
  register <- list(
    products = dplyr::tibble(
      uri = "p1",
      ema_link = epar_page("trecondi"),
      authorisation_date = as.Date("2019-06-20")
    ),
    designations = dplyr::tibble(
      uri = "d1",
      eu_designation_number = "EU/3/04/186",
      designation_status = "Withdrawn",
      condition = "Conditioning treatment"
    ),
    links = dplyr::tibble(
      product_uri = "p1",
      designation_uri = "d1",
      link_date = as.Date("2019-06-24"),
      extension_months = NA_integer_,
      end_date = as.Date(NA)
    )
  )
  medicines <- dplyr::tibble(
    ema_product_number = "EMEA/H/C/004751",
    name_of_medicine = "Trecondi",
    medicine_status = "Authorised",
    orphan_medicine = FALSE,
    marketing_authorisation_date = as.Date("2019-06-20"),
    medicine_url = epar_page("trecondi")
  )
  exclusivity <- build_orphan_exclusivity_table(
    medicines,
    dplyr::tibble(
      related_ema_product_number = character(),
      eu_designation_number = character(),
      intended_use = character(),
      status = character()
    ),
    register
  )
  expect_identical(exclusivity$exclusivity_end, as.Date(NA))
  expect_identical(exclusivity$end_source, NA_character_)
  expect_identical(exclusivity$designation_status, "Withdrawn")
})

test_that("normalise_ema_link ignores case, scheme and a trailing slash", {
  expect_identical(
    normalise_ema_link(c(
      " http://www.ema.europa.eu/en/medicines/human/EPAR/Adcetris/ ",
      NA
    )),
    c("https://www.ema.europa.eu/en/medicines/human/epar/adcetris", NA)
  )
})

test_that("report_orphan_coverage counts linked Authorised orphan medicines", {
  medicines <- orphan_medicines()
  messages <- testthat::capture_messages(report_orphan_coverage(
    fixture_orphan_table(medicines),
    medicines,
    as.Date("2026-09-26")
  ))
  expect_match(
    messages,
    paste(
      "Orphan exclusivity: 4 of 5 Authorised orphan medicines linked to the",
      "Union Register; 3 with an exclusivity end after 2026-09-26"
    ),
    all = FALSE
  )
  expect_match(
    messages,
    "1 Authorised orphan medicine not linked:.*Vijoice",
    all = FALSE
  )
})

test_that("the orphan source entries credit EMA and the Union Register", {
  ema_entry <- ema_orphan_source_entry(
    list(
      url = ema_orphan_designations_url,
      last_modified = "Sat, 26 Sep 2026 16:10:39 GMT",
      retrieved = "2026-09-26T16:45:21Z"
    ),
    "2026-09-26T18:10:39Z"
  )
  expect_identical(ema_entry$version, "2026-09-26T18:10:39Z")
  expect_identical(ema_entry$retrieved, "2026-09-26")
  expect_identical(ema_entry$attribution, ema_attribution)

  register_entry <- union_register_source_entry(list(
    url = union_register_url,
    last_modified = "Fri, 25 Sep 2026 15:36:55 GMT",
    retrieved = "2026-09-26T15:31:22Z"
  ))
  expect_named(
    register_entry,
    c(
      "name", "url", "version", "retrieved", "licence", "attribution",
      "last_modified"
    )
  )
  expect_identical(register_entry$version, "Fri, 25 Sep 2026 15:36:55 GMT")
  expect_identical(register_entry$retrieved, "2026-09-26")
  expect_match(register_entry$licence, "CC BY 4.0", fixed = TRUE)
  expect_identical(
    register_entry$attribution,
    paste(
      "© European Union, Union Register of medicinal products, CC BY 4.0;",
      "changes made"
    )
  )
})
