fixture_buvidal_page_path <- function() {
  testthat::test_path("fixtures", "epar-buvidal-sample.html")
}

read_fixture_text <- function(path) {
  paste(readLines(path, encoding = "UTF-8", warn = FALSE), collapse = "\n")
}

test_that("epar_scan_budget_from_env reads a whole number or the default", {
  expect_identical(epar_scan_budget_from_env(""), 30L)
  expect_identical(epar_scan_budget_from_env("5"), 5L)
  expect_error(epar_scan_budget_from_env("all"), "APPROVAL_ATLAS_EPAR_BUDGET")
  withr::with_envvar(
    c(APPROVAL_ATLAS_EPAR_BUDGET = "12"),
    expect_identical(epar_scan_budget_from_env(), 12L)
  )
})

test_that("find_copy_statements finds the overview's copy statement", {
  statements <- find_copy_statements(
    xml2::read_html(fixture_buvidal_page_path())
  )
  expect_length(statements, 1)
  expect_match(
    statements,
    "^Buvidal contains the active substance buprenorphine and is a"
  )
  expect_identical(copy_types_of(statements), "hybrid")
})

# Worded as the EPAR pages of Gencebok, Inpremzia and Sitagliptin SUN.
test_that("find_copy_statements reads every wording but the link", {
  page <- xml2::read_html(paste0(
    "<html><body>",
    "<p>Gencebok is a ‘hybrid’ medicine.</p>",
    "<p>Inpremzia is a biosimilar medicinal product.</p>",
    "<p>For more information, see Generic and hybrid medicines.</p>",
    "<p>This medicine is authorised for use in the European Union</p>",
    "</body></html>"
  ))
  statements <- find_copy_statements(page)
  expect_identical(
    statements,
    c(
      "Gencebok is a ‘hybrid’ medicine.",
      "Inpremzia is a biosimilar medicinal product."
    )
  )
  expect_identical(copy_types_of(statements), "biosimilar, hybrid")
  expect_identical(copy_types_of(character()), NA_character_)
})

scan_protection <- function() {
  dplyr::tibble(
    ema_product_number = paste0(
      "EMEA/H/C/",
      c("004651", "005406", "000885", "004743", "005034", "006046", "000278")
    ),
    basis = c("own", "own", "own", "own", "own", "own", "follows_reference"),
    status = c(
      "protected", "protected", "ended", "protected", "protected",
      "protected", "ended"
    )
  )
}

scan_medicines <- function() {
  dplyr::tibble(
    ema_product_number = scan_protection()$ema_product_number,
    name_of_medicine = c(
      "Buvidal", "Okedi", "Bridion", "Sixmo", "Camcevi",
      "Sugammadex Adroiq", "Herceptin"
    ),
    medicine_status = c(
      "Authorised", "Authorised", "Authorised", "Withdrawn", "Authorised",
      "Authorised", "Authorised"
    ),
    medicine_url = c(
      epar_page("buvidal"), epar_page("okedi"), epar_page("bridion"),
      epar_page("sixmo"), NA, epar_page("sugammadex-adroiq"),
      epar_page("herceptin")
    )
  )
}

scan_copies <- function() {
  dplyr::tibble(ema_product_number = "EMEA/H/C/006046")
}

test_that("plan_epar_copy_scan picks Authorised own, protected medicines", {
  plan <- plan_epar_copy_scan(
    scan_protection(),
    scan_medicines(),
    scan_copies(),
    empty_epar_copy_checks(),
    budget = 10
  )
  # Not Bridion (ended), Sixmo (withdrawn), Camcevi (no page), Sugammadex
  # Adroiq (curated) or Herceptin (a follower).
  expect_identical(
    plan,
    dplyr::tibble(
      ema_product_number = c("EMEA/H/C/004651", "EMEA/H/C/005406"),
      name_of_medicine = c("Buvidal", "Okedi"),
      url = c(epar_page("buvidal"), epar_page("okedi"))
    )
  )
  checked <- dplyr::tibble(ema_product_number = "EMEA/H/C/004651")
  expect_identical(
    plan_epar_copy_scan(
      scan_protection(), scan_medicines(), scan_copies(), checked,
      budget = 10
    )$name_of_medicine,
    "Okedi"
  )
  expect_identical(
    nrow(plan_epar_copy_scan(
      scan_protection(), scan_medicines(), scan_copies(),
      empty_epar_copy_checks(),
      budget = 1
    )),
    1L
  )
})

test_that("fetch_epar_page returns the status and a 200's body", {
  statuses <- c(200L, 404L)
  calls <- 0L
  httr2::local_mocked_responses(function(req) {
    calls <<- calls + 1L
    httr2::response(
      status_code = statuses[[calls]],
      headers = list(`Content-Type` = "text/html; charset=utf-8"),
      body = charToRaw("<html><p>Buvidal</p></html>")
    )
  })
  page <- fetch_epar_page(epar_page("buvidal"))
  expect_identical(page$status, 200L)
  expect_identical(page$body, "<html><p>Buvidal</p></html>")
  missing <- fetch_epar_page(epar_page("gone"))
  expect_identical(missing$status, 404L)
  expect_null(missing$body)
})

# Stands in for fetch_epar_page(): answers each URL from `pages` (a status
# and a body) and records the URLs.
mock_epar_pages <- function(pages, env = parent.frame()) {
  server <- new.env()
  server$urls <- character()
  testthat::local_mocked_bindings(
    fetch_epar_page = function(url) {
      server$urls <- c(server$urls, url)
      pages[[url]]
    },
    wait_seconds = function(seconds) NULL,
    .env = env
  )
  server
}

scan_plan <- function(slugs, names = slugs) {
  dplyr::tibble(
    ema_product_number = paste0("EMEA/H/C/00000", seq_along(slugs)),
    name_of_medicine = names,
    url = epar_page(slugs)
  )
}

test_that("scan_epar_copy_pages saves each page's result", {
  pages <- list(
    list(status = 200L, body = read_fixture_text(fixture_buvidal_page_path())),
    list(status = 404L, body = NULL)
  )
  names(pages) <- epar_page(c("buvidal", "gone"))
  server <- mock_epar_pages(pages)
  checks_path <- file.path(tempfile(), "ema-epar-copies", "checks.json")
  checks <- suppressMessages(scan_epar_copy_pages(
    scan_plan(c("buvidal", "gone"), c("Buvidal", "Gone")),
    empty_epar_copy_checks(),
    checks_path,
    today = as.Date("2026-09-29")
  ))
  expect_identical(server$urls, epar_page(c("buvidal", "gone")))
  expect_identical(checks$page_status, c("read", "not_found"))
  expect_identical(checks$copy_types, c("hybrid", NA))
  expect_match(checks$statement[[1]], "‘hybrid medicine’", fixed = TRUE)
  expect_identical(checks$statement[[2]], NA_character_)
  expect_identical(unique(checks$checked_date), as.Date("2026-09-29"))
  expect_identical(read_epar_copy_checks(checks_path), checks)
})

test_that("scan_epar_copy_pages stops on a 429, a failure or a bad page", {
  buvidal <- list(
    status = 200L,
    body = read_fixture_text(fixture_buvidal_page_path())
  )
  stops <- list(
    "HTTP 429" = list(status = 429L, body = NULL),
    "without the medicine's name" = list(
      status = 200L,
      body = "<html><p>Request blocked</p></html>"
    ),
    "without the medicine's name" = list(status = 200L, body = "")
  )
  for (index in seq_along(stops)) {
    pages <- list(buvidal, stops[[index]], buvidal)
    names(pages) <- epar_page(c("buvidal", "stop", "later"))
    server <- mock_epar_pages(pages)
    checks_path <- file.path(tempfile(), "checks.json")
    expect_warning(
      checks <- suppressMessages(scan_epar_copy_pages(
        scan_plan(c("buvidal", "stop", "later"), c("Buvidal", "Stop", "Later")),
        empty_epar_copy_checks(),
        checks_path
      )),
      names(stops)[[index]]
    )
    expect_identical(checks$name_of_medicine, "Buvidal")
    expect_identical(read_epar_copy_checks(checks_path), checks)
    expect_length(server$urls, 2)
  }
  testthat::local_mocked_bindings(
    fetch_epar_page = function(url) {
      stop(structure(
        class = c("httr2_failure", "error", "condition"),
        list(message = "Could not resolve host", call = NULL)
      ))
    },
    wait_seconds = function(seconds) NULL
  )
  expect_warning(
    checks <- suppressMessages(scan_epar_copy_pages(
      scan_plan("buvidal", "Buvidal"),
      empty_epar_copy_checks(),
      file.path(tempfile(), "checks.json")
    )),
    "Could not resolve host"
  )
  expect_identical(nrow(checks), 0L)
})

test_that("read_epar_copy_checks reads a missing or empty file as none", {
  expect_identical(
    read_epar_copy_checks(file.path(tempfile(), "checks.json")),
    empty_epar_copy_checks()
  )
  path <- tempfile(fileext = ".json")
  writeLines("[]", path)
  expect_identical(read_epar_copy_checks(path), empty_epar_copy_checks())
})

test_that("run_epar_copy_scan lists the pages that name a copy", {
  data_directory <- tempfile()
  dir.create(data_directory)
  write_json_table(
    scan_protection(),
    file.path(data_directory, "ema_medicine_protection.json")
  )
  write_json_table(
    scan_medicines(),
    file.path(data_directory, "ema_medicines.json")
  )
  pages <- list(
    list(status = 200L, body = read_fixture_text(fixture_buvidal_page_path())),
    list(status = 200L, body = "<html><p>Okedi is a medicine.</p></html>")
  )
  names(pages) <- epar_page(c("buvidal", "okedi"))
  mock_epar_pages(pages)
  cache_directory <- tempfile()
  messages <- testthat::capture_messages(
    candidates <- run_epar_copy_scan(
      data_directory,
      cache_directory,
      budget = 1,
      copies = scan_copies()
    )
  )
  expect_identical(candidates$name_of_medicine, "Buvidal")
  expect_match(messages, "EPAR pages checked: 1, 1 left; 1 call", all = FALSE)
  expect_match(
    messages,
    "Buvidal (EMEA/H/C/004651): hybrid",
    fixed = TRUE,
    all = FALSE
  )
  # A rerun resumes with the page left.
  messages <- testthat::capture_messages(
    candidates <- run_epar_copy_scan(
      data_directory,
      cache_directory,
      budget = 1,
      copies = scan_copies()
    )
  )
  expect_match(messages, "EPAR pages checked: 2, 0 left; 1 call", all = FALSE)
  expect_identical(
    read_epar_copy_checks(file.path(cache_directory, "checks.json"))$copy_types,
    c("hybrid", NA)
  )
  # Once curated, a medicine is no longer a candidate.
  expect_identical(
    nrow(epar_copy_candidates(
      read_epar_copy_checks(file.path(cache_directory, "checks.json")),
      dplyr::tibble(ema_product_number = "EMEA/H/C/004651")
    )),
    0L
  )
})
