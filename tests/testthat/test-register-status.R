# Real products (EMA medicines data, 2026-09-26) matching the register fixture.
register_medicines <- function() {
  dplyr::tibble(
    ema_product_number = paste0(
      "EMEA/H/C/",
      c("000210", "000636", "000697", "002329", "002776", "005282", "005523",
        "005661")
    ),
    name_of_medicine = c(
      "Pritor", "Myozyme", "Suboxone", "Atosiban SUN",
      "Lumeblue (previously Methylthioninium chloride Cosmo)",
      "Fingolimod Mylan", "Tavneos", "Fingolimod Mylan"
    ),
    medicine_status = c(
      "Authorised", "Authorised", "Withdrawn", "Authorised", "Authorised",
      "Application withdrawn", "Revoked", "Authorised"
    ),
    marketing_authorisation_date = as.Date(c(
      "1998-12-11", "2006-03-28", "2006-09-26", "2013-07-31", "2020-08-19",
      "2021-08-18", "2022-01-11", "2021-08-18"
    )),
    medicine_url = epar_page(c(
      "pritor", "myozyme", "suboxone", "atosiban-sun", "lumeblue",
      "fingolimod-mylan-0", "tavneos", "fingolimod-mylan"
    ))
  )
}

fixture_register_status <- function(medicines = register_medicines(),
                                    register = fixture_register()) {
  build_register_status_table(medicines, register)
}

fixture_register <- function() {
  read_union_register(fixture_union_register_path())
}

register_row <- function(register_status, product_number) {
  register_status[register_status$ema_product_number == product_number, ]
}

register_page <- function(page) {
  paste0(
    "https://ec.europa.eu/health/documents/community-register/html/",
    page,
    ".htm"
  )
}

test_that("read_union_register keeps the register fields of products", {
  products <- fixture_register()$products
  expect_named(
    products,
    c(
      "uri", "ema_link", "authorisation_date", "name", "eu_number", "status",
      "category", "last_decision_date"
    )
  )
  pritor <- products[grepl("/h089\\.htm$", products$uri), ]
  expect_identical(pritor$name, "Pritor")
  expect_identical(pritor$eu_number, "EU/1/98/089")
  expect_identical(pritor$status, "Withdrawn")
  expect_identical(pritor$category, "Centrally authorised")
  expect_identical(pritor$last_decision_date, as.Date("2026-05-04"))
})

test_that("read_union_register aborts when a register status field goes", {
  rows <- jsonlite::fromJSON(
    fixture_union_register_path(),
    simplifyVector = FALSE
  )$data
  rows[[2]]$LastDecisionDate <- NULL
  path <- tempfile(fileext = ".json")
  jsonlite::write_json(
    list(data = rows),
    path,
    auto_unbox = TRUE,
    null = "null"
  )
  expect_error(read_union_register(path), "LastDecisionDate")
})

test_that("build_register_status_table has one row per linked product", {
  register_status <- fixture_register_status()
  expect_named(
    register_status,
    c(
      "ema_product_number", "eu_number", "register_status",
      "register_last_decision_date", "register_url", "match_method",
      "agrees_with_ema", "source"
    )
  )
  expect_identical(
    register_status$ema_product_number,
    paste0(
      "EMEA/H/C/",
      c("000210", "000636", "000697", "002776", "005523", "005661")
    )
  )
  expect_identical(unique(register_status$source), "union_register")
  pritor <- register_row(register_status, "EMEA/H/C/000210")
  expect_identical(pritor$eu_number, "EU/1/98/089")
  expect_identical(pritor$register_status, "Withdrawn")
  expect_identical(pritor$register_last_decision_date, as.Date("2026-05-04"))
  expect_identical(pritor$register_url, register_page("h089"))
})

test_that("agrees_with_ema is TRUE when both say authorised or both say not", {
  register_status <- fixture_register_status()
  agrees <- stats::setNames(
    register_status$agrees_with_ema,
    register_status$ema_product_number
  )
  expect_identical(
    agrees,
    c(
      "EMEA/H/C/000210" = FALSE, # EMA Authorised, register Withdrawn
      "EMEA/H/C/000636" = TRUE, # both authorised
      "EMEA/H/C/000697" = FALSE, # EMA Withdrawn, register Active
      "EMEA/H/C/002776" = FALSE, # EMA Authorised, register Withdrawn
      "EMEA/H/C/005523" = TRUE, # both Revoked
      "EMEA/H/C/005661" = TRUE
    )
  )
})

test_that("only the register status Active counts as authorised", {
  expect_identical(
    is_register_authorised(c(
      "Active", "Annulled", "Expired / Sunset clause", "Not renewed",
      "Refused", "Revoked", "Suspended", "Withdrawn"
    )),
    c(TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE)
  )
  expect_error(
    is_register_authorised(c("Active", "Transferred")),
    "Transferred"
  )
})

test_that("an unknown register status stops the build", {
  register <- fixture_register()
  register$products$status[1] <- "Transferred"
  expect_error(fixture_register_status(register = register), "Transferred")
})

test_that("a link needs MA dates at most one day apart", {
  register_status <- fixture_register_status()
  # Myozyme: EMA 2006-03-28, register 2006-03-29.
  expect_true("EMEA/H/C/000636" %in% register_status$ema_product_number)
  # Atosiban SUN: EMA 2013-07-31, register 2013-08-02.
  expect_false("EMEA/H/C/002329" %in% register_status$ema_product_number)

  medicines <- register_medicines()
  is_myozyme <- medicines$ema_product_number == "EMEA/H/C/000636"
  medicines$marketing_authorisation_date[is_myozyme] <- as.Date("2006-03-27")
  expect_false(
    "EMEA/H/C/000636" %in%
      fixture_register_status(medicines)$ema_product_number
  )
  medicines$marketing_authorisation_date[is_myozyme] <- NA
  expect_false(
    "EMEA/H/C/000636" %in%
      fixture_register_status(medicines)$ema_product_number
  )
})

test_that("match_method records whether the link, the name or both match", {
  register_status <- fixture_register_status()
  expect_identical(
    register_row(register_status, "EMEA/H/C/000210")$match_method,
    "link_and_name"
  )
  # The register links Lumeblue to its old EMA page.
  expect_identical(
    register_row(register_status, "EMEA/H/C/002776")$match_method,
    "name"
  )
  medicines <- register_medicines()
  medicines$name_of_medicine[1] <- "Pritor 40 mg"
  expect_identical(
    register_row(
      fixture_register_status(medicines),
      "EMEA/H/C/000210"
    )$match_method,
    "link"
  )
})

test_that("a product with several candidates on its MA date has no row", {
  register <- fixture_register()
  pritor <- register$products[grepl("/h089\\.htm$", register$products$uri), ]
  pritor$uri <- "http://ec.europa.eu/health/documents/community-register/x"
  pritor$ema_link <- NA_character_
  register$products <- dplyr::bind_rows(register$products, pritor)
  expect_false(
    "EMEA/H/C/000210" %in%
      fixture_register_status(register = register)$ema_product_number
  )
})

test_that("a register product claimed by two EMA products keeps the link", {
  register_status <- fixture_register_status()
  fingolimod <- register_status[
    register_status$register_url == register_page("h1573"),
  ]
  expect_identical(fingolimod$ema_product_number, "EMEA/H/C/005661")

  medicines <- register_medicines()
  medicines <- medicines[medicines$ema_product_number != "EMEA/H/C/005661", ]
  expect_identical(
    register_row(
      fixture_register_status(medicines),
      "EMEA/H/C/005282"
    )$match_method,
    "name"
  )
})

test_that("only centrally authorised register products are linked", {
  register <- fixture_register()
  is_pritor <- grepl("/h089\\.htm$", register$products$uri)
  register$products$category[is_pritor] <- "Nationally authorised"
  expect_false(
    "EMEA/H/C/000210" %in%
      fixture_register_status(register = register)$ema_product_number
  )
})

test_that("normalise_medicine_name keeps only lower-case letters and digits", {
  expect_identical(
    normalise_medicine_name(c(
      "Lumeblue (previously Methylthioninium chloride Cosmo)",
      "Lutetium (<sup>177</sup>Lu) chloride Billev",
      "Treprostinil SciPharm Sàrl",
      "CureVac’s COVID-19 vaccine",
      "(-)",
      NA
    )),
    c(
      "lumeblue",
      "lutetium177luchloridebillev",
      "treprostinilscipharmsàrl",
      "curevacscovid19vaccine",
      NA,
      NA
    )
  )
})

test_that("report_register_status logs links, inactive and unmatched", {
  medicines <- register_medicines()
  messages <- testthat::capture_messages(report_register_status(
    fixture_register_status(medicines),
    medicines
  ))
  expect_match(
    messages,
    "Union Register status: 6 EMA products linked \\(4 of 5 Authorised\\)",
    all = FALSE
  )
  expect_match(
    messages,
    paste0(
      "Union Register: 2 Authorised medicines not active:.*",
      "Pritor \\(Withdrawn\\).*Lumeblue"
    ),
    all = FALSE
  )
  expect_match(
    messages,
    "Union Register: 1 Authorised medicine not linked:.*Atosiban SUN",
    all = FALSE
  )
})

test_that("report_register_status skips empty lists", {
  medicines <- register_medicines()[2, ]
  messages <- testthat::capture_messages(report_register_status(
    fixture_register_status(medicines),
    medicines
  ))
  expect_length(messages, 1)
})
