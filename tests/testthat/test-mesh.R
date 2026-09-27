mesh_listing_html <- function(years) {
  links <- paste0(
    '<a href="desc', years, '.gz">desc', years, ".gz</a> ",
    '<a href="desc', years, '.xml">desc', years, ".xml</a> ",
    '<a href="supp', as.integer(years) + 1, '.gz">supp</a>'
  )
  paste0("<html><body><pre>", paste(links, collapse = "\n"), "</pre></body>")
}

# Stands in for httr2::req_perform(): serves the directory listing and the
# descriptor file, and records every request it receives.
fake_mesh_server <- function(years = "2026",
                             descriptor_status = 200,
                             last_modified = "Wed, 12 Aug 2026 18:05:02 GMT") {
  server <- new.env()
  server$requests <- list()
  server$perform <- function(req, path = NULL, ...) {
    server$requests <- c(server$requests, list(req))
    if (endsWith(req$url, "/xmlmesh/")) {
      return(httr2::response(
        status_code = 200,
        headers = list(`Content-Type` = "text/html; charset=UTF-8"),
        body = charToRaw(mesh_listing_html(years))
      ))
    }
    if (descriptor_status == 304) {
      return(httr2::response(status_code = 304))
    }
    file.copy(fixture_mesh_path(), path)
    httr2::response(
      status_code = 200,
      headers = if (is.null(last_modified)) {
        list()
      } else {
        list(`Last-Modified` = last_modified)
      }
    )
  }
  server
}

seed_mesh_cache <- function(year = "2026",
                            last_modified = "Wed, 12 Aug 2026 18:05:02 GMT",
                            age_hours = 0) {
  cache_directory <- file.path(tempfile(), "mesh")
  dir.create(cache_directory, recursive = TRUE)
  file.copy(
    fixture_mesh_path(),
    file.path(cache_directory, paste0("desc", year, ".xml"))
  )
  sidecar_path <- file.path(cache_directory, "source.json")
  jsonlite::write_json(
    list(
      year = year,
      url = paste0(mesh_listing_url, "desc", year, ".gz"),
      last_modified = last_modified
    ),
    sidecar_path,
    auto_unbox = TRUE
  )
  Sys.setFileTime(sidecar_path, Sys.time() - age_hours * 60 * 60)
  cache_directory
}

test_that("find_latest_mesh_year picks the highest descriptor year", {
  expect_identical(
    find_latest_mesh_year(mesh_listing_html(c("2025", "2026"))),
    "2026"
  )
})

test_that("find_latest_mesh_year aborts when no descriptor file is listed", {
  expect_error(
    find_latest_mesh_year("<html>supp2026.gz qual2026.xml</html>"),
    "desc"
  )
})

test_that("download_mesh_descriptors downloads the latest year", {
  cache_directory <- file.path(tempfile(), "mesh")
  server <- fake_mesh_server(years = c("2025", "2026"))
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  expect_message(
    mesh_source <- download_mesh_descriptors(cache_directory),
    "Downloading MeSH 2026"
  )
  expect_identical(mesh_source$year, "2026")
  expect_identical(mesh_source$url, paste0(mesh_listing_url, "desc2026.gz"))
  expect_identical(
    mesh_source$path,
    file.path(cache_directory, "desc2026.xml")
  )
  expect_identical(mesh_source$last_modified, "Wed, 12 Aug 2026 18:05:02 GMT")
  expect_identical(
    tools::md5sum(mesh_source$path)[[1]],
    tools::md5sum(fixture_mesh_path())[[1]]
  )
  expect_length(server$requests, 2)
  expect_identical(server$requests[[1]]$url, mesh_listing_url)
  expect_match(
    server$requests[[2]]$options$useragent,
    "approval-atlas",
    fixed = TRUE
  )
  expect_null(server$requests[[2]]$headers[["If-Modified-Since"]])
  sidecar <- jsonlite::fromJSON(file.path(cache_directory, "source.json"))
  expect_identical(sidecar$year, "2026")
  expect_identical(sidecar$last_modified, "Wed, 12 Aug 2026 18:05:02 GMT")
  expect_setequal(
    list.files(cache_directory),
    c("desc2026.xml", "source.json")
  )
})

test_that("download_mesh_descriptors skips the network within 24 hours", {
  cache_directory <- seed_mesh_cache(age_hours = 2)
  testthat::local_mocked_bindings(
    req_perform = function(...) stop("network must not be used"),
    .package = "httr2"
  )
  expect_message(
    mesh_source <- download_mesh_descriptors(cache_directory),
    "Using cached MeSH 2026"
  )
  expect_identical(mesh_source$year, "2026")
  expect_identical(
    mesh_source$path,
    file.path(cache_directory, "desc2026.xml")
  )
  expect_identical(mesh_source$last_modified, "Wed, 12 Aug 2026 18:05:02 GMT")
})

test_that("a stale check revalidates with If-Modified-Since and keeps a 304", {
  cache_directory <- seed_mesh_cache(age_hours = 30)
  writeLines("<cached/>", file.path(cache_directory, "desc2026.xml"))
  server <- fake_mesh_server(descriptor_status = 304)
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  messages <- testthat::capture_messages(
    mesh_source <- download_mesh_descriptors(cache_directory)
  )
  expect_match(messages, "Checking MeSH 2026 for changes", all = FALSE)
  expect_match(messages, "MeSH 2026 unchanged since", all = FALSE)
  expect_identical(
    server$requests[[2]]$headers[["If-Modified-Since"]],
    "Wed, 12 Aug 2026 18:05:02 GMT"
  )
  expect_identical(
    readLines(file.path(cache_directory, "desc2026.xml")),
    "<cached/>"
  )
  expect_identical(mesh_source$last_modified, "Wed, 12 Aug 2026 18:05:02 GMT")
  expect_true(is_recent_file(file.path(cache_directory, "source.json"), 1))
})

test_that("a stale check downloads a changed file and records Last-Modified", {
  cache_directory <- seed_mesh_cache(age_hours = 30)
  server <- fake_mesh_server(last_modified = "Mon, 05 Oct 2026 10:00:00 GMT")
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  mesh_source <- suppressMessages(download_mesh_descriptors(cache_directory))
  expect_identical(mesh_source$last_modified, "Mon, 05 Oct 2026 10:00:00 GMT")
  sidecar <- jsonlite::fromJSON(file.path(cache_directory, "source.json"))
  expect_identical(sidecar$last_modified, "Mon, 05 Oct 2026 10:00:00 GMT")
})

test_that("a new MeSH year is downloaded without a conditional header", {
  cache_directory <- seed_mesh_cache(year = "2026", age_hours = 30)
  server <- fake_mesh_server(years = c("2026", "2027"))
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  mesh_source <- suppressMessages(download_mesh_descriptors(cache_directory))
  expect_identical(mesh_source$year, "2027")
  expect_identical(
    server$requests[[2]]$url,
    paste0(mesh_listing_url, "desc2027.gz")
  )
  expect_null(server$requests[[2]]$headers[["If-Modified-Since"]])
  expect_true(file.exists(file.path(cache_directory, "desc2027.xml")))
})

test_that("a missing Last-Modified header is stored as null", {
  cache_directory <- file.path(tempfile(), "mesh")
  server <- fake_mesh_server(last_modified = NULL)
  testthat::local_mocked_bindings(
    req_perform = server$perform,
    .package = "httr2"
  )
  mesh_source <- suppressMessages(download_mesh_descriptors(cache_directory))
  expect_identical(mesh_source$last_modified, NA_character_)
  sidecar_text <- readLines(file.path(cache_directory, "source.json"))
  expect_match(sidecar_text, "\"last_modified\":null", fixed = TRUE)
})

test_that("read_mesh_descriptors reads names, tree numbers and all terms", {
  mesh <- read_mesh_descriptors(fixture_mesh_path())
  expect_named(mesh, c("descriptors", "tree_numbers", "terms"))
  expect_identical(
    mesh$descriptors,
    dplyr::tibble(
      descriptor_ui = c("D009369", "D009422", "D001523", "D000544", "D009542"),
      descriptor_name = c(
        "Neoplasms",
        "Nervous System Diseases",
        "Mental Disorders",
        "Alzheimer Disease",
        "Niemann-Pick Diseases"
      )
    )
  )
  expect_identical(
    mesh$tree_numbers$tree_number[mesh$tree_numbers$descriptor_ui == "D000544"],
    c("C10.228.140.380.100", "C10.574.945.249", "F03.615.400.100")
  )
  expect_identical(nrow(mesh$tree_numbers), 7L)
  expect_identical(
    mesh$terms$term[mesh$terms$descriptor_ui == "D009369"],
    c("Neoplasms", "Tumors", "Cancer")
  )
  expect_identical(nrow(mesh$terms), 12L)
  # A related descriptor's name inside SeeRelatedList is not a term or name.
  expect_false("Amyloid beta-Peptides" %in% c(
    mesh$descriptors$descriptor_name,
    mesh$terms$term
  ))
})

test_that("read_mesh_descriptors aborts when the file has no records", {
  path <- tempfile(fileext = ".xml")
  writeLines("<DescriptorRecordSet LanguageCode=\"eng\"/>", path)
  expect_error(read_mesh_descriptors(path), "no descriptor records")
})

test_that("read_mesh_descriptors aborts when a record lacks its name", {
  path <- tempfile(fileext = ".xml")
  writeLines(
    c(
      "<DescriptorRecordSet>",
      "<DescriptorRecord><DescriptorUI>D1</DescriptorUI></DescriptorRecord>",
      "</DescriptorRecordSet>"
    ),
    path
  )
  expect_error(read_mesh_descriptors(path), "D1")
})

test_that("load_mesh_descriptors parses once per Last-Modified value", {
  cache_directory <- seed_mesh_cache()
  mesh_source <- list(
    year = "2026",
    path = file.path(cache_directory, "desc2026.xml"),
    last_modified = "Wed, 12 Aug 2026 18:05:02 GMT"
  )
  expect_message(mesh <- load_mesh_descriptors(mesh_source), "Parsing MeSH")
  expect_true(file.exists(file.path(cache_directory, "descriptors-2026.rds")))
  expect_identical(mesh, read_mesh_descriptors(fixture_mesh_path()))

  testthat::local_mocked_bindings(
    read_mesh_descriptors = function(...) stop("must reuse the parsed cache")
  )
  expect_no_message(cached <- load_mesh_descriptors(mesh_source))
  expect_identical(cached, mesh)
})

test_that("load_mesh_descriptors re-parses when Last-Modified changes", {
  cache_directory <- seed_mesh_cache()
  mesh_source <- list(
    year = "2026",
    path = file.path(cache_directory, "desc2026.xml"),
    last_modified = "Wed, 12 Aug 2026 18:05:02 GMT"
  )
  suppressMessages(load_mesh_descriptors(mesh_source))
  mesh_source$last_modified <- "Mon, 05 Oct 2026 10:00:00 GMT"
  expect_message(load_mesh_descriptors(mesh_source), "Parsing MeSH")
  mesh_source$last_modified <- NA_character_
  expect_message(load_mesh_descriptors(mesh_source), "Parsing MeSH")
})

test_that("match_mesh_terms tries heading, entry, any case, curated", {
  mesh <- read_mesh_descriptors(fixture_mesh_path())
  asmd <- "Acid sphingomyelinase deficiency (ASMD) type A/B or type B"
  matches <- match_mesh_terms(
    c("Neoplasms", "Cancer", "tumors", asmd, "Psoriasis", "Cancer"),
    mesh
  )
  expect_identical(
    matches,
    dplyr::tibble(
      therapeutic_area_mesh = c(
        asmd, "Cancer", "Neoplasms", "Psoriasis", "tumors"
      ),
      mesh_descriptor_ui = c("D009542", "D009369", "D009369", NA, "D009369"),
      source = c(
        "curated", "entry_term", "mesh_heading", "unmatched", "entry_term"
      )
    )
  )
})

test_that("the curated ASMD term is the exact EMA string", {
  expect_identical(
    curated_mesh_terms,
    c("Acid sphingomyelinase deficiency (ASMD) type A/B or type B" = "D009542")
  )
})

test_that("match_mesh_terms prefers a descriptor name over an entry term", {
  mesh <- list(
    descriptors = dplyr::tibble(
      descriptor_ui = c("D1", "D2"),
      descriptor_name = c("Anemia", "Blood Disorders")
    ),
    tree_numbers = dplyr::tibble(
      descriptor_ui = character(),
      tree_number = character()
    ),
    terms = dplyr::tibble(
      descriptor_ui = c("D1", "D2"),
      term = c("Anemia", "Anemia")
    )
  )
  matches <- match_mesh_terms("Anemia", mesh)
  expect_identical(matches$mesh_descriptor_ui, "D1")
  expect_identical(matches$source, "mesh_heading")
})

test_that("match_mesh_terms aborts when a term matches two descriptors", {
  mesh <- list(
    descriptors = dplyr::tibble(
      descriptor_ui = c("D1", "D2"),
      descriptor_name = c("Anemia", "Blood Disorders")
    ),
    tree_numbers = dplyr::tibble(
      descriptor_ui = character(),
      tree_number = character()
    ),
    terms = dplyr::tibble(
      descriptor_ui = c("D1", "D2", "D2"),
      term = c("Shared Term", "Shared Term", "Blood Disorders")
    )
  )
  error <- expect_error(
    match_mesh_terms(c("Shared Term", "Blood Disorders"), mesh),
    class = "rlang_error"
  )
  expect_match(conditionMessage(error), "Shared Term")
  expect_match(conditionMessage(error), "D1")
  expect_match(conditionMessage(error), "D2")
})

test_that("build_area_branches_table lists every top-level branch per term", {
  mesh <- read_mesh_descriptors(fixture_mesh_path())
  asmd <- "Acid sphingomyelinase deficiency (ASMD) type A/B or type B"
  matches <- match_mesh_terms(
    c("Alzheimer Disease", "Cancer", asmd, "Psoriasis"),
    mesh
  )
  expect_identical(
    build_area_branches_table(matches, mesh),
    dplyr::tibble(
      therapeutic_area_mesh = c(
        asmd, "Alzheimer Disease", "Alzheimer Disease", "Cancer", "Psoriasis"
      ),
      mesh_descriptor_ui = c("D009542", "D000544", "D000544", "D009369", NA),
      mesh_descriptor_name = c(
        "Niemann-Pick Diseases",
        "Alzheimer Disease",
        "Alzheimer Disease",
        "Neoplasms",
        NA
      ),
      branch = c("C10", "C10", "F03", "C04", NA),
      branch_name = c(
        "Nervous System Diseases",
        "Nervous System Diseases",
        "Mental Disorders",
        "Neoplasms",
        NA
      ),
      source = c(
        "curated", "mesh_heading", "mesh_heading", "entry_term", "unmatched"
      )
    )
  )
})

test_that("build_area_branches_table leaves a recordless branch unnamed", {
  mesh <- read_mesh_descriptors(fixture_mesh_path())
  mesh$tree_numbers <- dplyr::add_row(
    mesh$tree_numbers,
    descriptor_ui = "D009542",
    tree_number = "C16.320.565"
  )
  branches <- build_area_branches_table(
    match_mesh_terms("Niemann-Pick Diseases", mesh),
    mesh
  )
  expect_identical(branches$branch, c("C10", "C16"))
  expect_identical(branches$branch_name, c("Nervous System Diseases", NA))
})

test_that("build_area_branches_table aborts on a descriptor missing in MeSH", {
  mesh <- read_mesh_descriptors(fixture_mesh_path())
  matches <- dplyr::tibble(
    therapeutic_area_mesh = "Retired Term",
    mesh_descriptor_ui = "D999999",
    source = "curated"
  )
  error <- expect_error(
    build_area_branches_table(matches, mesh),
    class = "rlang_error"
  )
  expect_match(conditionMessage(error), "D999999")
  expect_match(conditionMessage(error), "Retired Term")
})

# Records of the fixture terms' level-2 and level-3 ancestors in MeSH 2026,
# added in memory: in the XML they would change the ancestor tests below.
add_subtree_records <- function(mesh) {
  nodes <- dplyr::tibble(
    descriptor_ui = c(
      "D002493", "D019636", "D019965", "D001927", "D024801", "D003704"
    ),
    descriptor_name = c(
      "Central Nervous System Diseases",
      "Neurodegenerative Diseases",
      "Neurocognitive Disorders",
      "Brain Diseases",
      "Tauopathies",
      "Dementia"
    ),
    tree_number = c(
      "C10.228", "C10.574", "F03.615", "C10.228.140", "C10.574.945",
      "F03.615.400"
    )
  )
  mesh$descriptors <- dplyr::bind_rows(
    mesh$descriptors,
    dplyr::select(nodes, "descriptor_ui", "descriptor_name")
  )
  mesh$tree_numbers <- dplyr::bind_rows(
    mesh$tree_numbers,
    dplyr::select(nodes, "descriptor_ui", "tree_number")
  )
  mesh
}

test_that("build_area_subtree_table lists level-2 and level-3 nodes per term", {
  mesh <- add_subtree_records(read_mesh_descriptors(fixture_mesh_path()))
  asmd <- "Acid sphingomyelinase deficiency (ASMD) type A/B or type B"
  cns <- "Central Nervous System Diseases"
  matches <- match_mesh_terms(
    c("Alzheimer Disease", "Cancer", asmd, cns, "Psoriasis"),
    mesh
  )
  expect_identical(
    build_area_subtree_table(matches, mesh),
    dplyr::tibble(
      therapeutic_area_mesh = c(
        rep(asmd, 2), rep("Alzheimer Disease", 6), cns
      ),
      branch = c("C10", "C10", "C10", "C10", "C10", "C10", "F03", "F03", "C10"),
      node = c(
        "C10.228", "C10.228.140",
        "C10.228", "C10.228.140", "C10.574", "C10.574.945", "F03.615",
        "F03.615.400",
        "C10.228"
      ),
      level = c(2L, 3L, 2L, 3L, 2L, 3L, 2L, 3L, 2L),
      parent = c(
        "C10", "C10.228",
        "C10", "C10.228", "C10", "C10.574", "F03", "F03.615",
        "C10"
      ),
      node_name = c(
        cns, "Brain Diseases",
        cns, "Brain Diseases", "Neurodegenerative Diseases", "Tauopathies",
        "Neurocognitive Disorders", "Dementia",
        cns
      ),
      source = c(rep("curated", 2), rep("mesh_heading", 7))
    )
  )
})

test_that("build_area_subtree_table lists a node once per term", {
  mesh <- add_subtree_records(read_mesh_descriptors(fixture_mesh_path()))
  mesh$tree_numbers <- dplyr::add_row(
    mesh$tree_numbers,
    descriptor_ui = "D000544",
    tree_number = "C10.228.140.999"
  )
  subtree <- build_area_subtree_table(
    match_mesh_terms("Alzheimer Disease", mesh),
    mesh
  )
  expect_identical(anyDuplicated(subtree), 0L)
  expect_identical(nrow(subtree), 6L)
})

test_that("build_area_subtree_table leaves recordless nodes unnamed", {
  mesh <- read_mesh_descriptors(fixture_mesh_path())
  subtree <- build_area_subtree_table(
    match_mesh_terms("Alzheimer Disease", mesh),
    mesh
  )
  expect_identical(
    subtree$node,
    c(
      "C10.228", "C10.228.140", "C10.574", "C10.574.945", "F03.615",
      "F03.615.400"
    )
  )
  expect_identical(subtree$node_name, rep(NA_character_, 6))
})

test_that("build_area_subtree_table is empty for root and unmatched terms", {
  mesh <- read_mesh_descriptors(fixture_mesh_path())
  subtree <- build_area_subtree_table(
    match_mesh_terms(c("Cancer", "Neoplasms", "Psoriasis"), mesh),
    mesh
  )
  expect_identical(nrow(subtree), 0L)
  expect_named(
    subtree,
    c(
      "therapeutic_area_mesh", "branch", "node", "level", "parent",
      "node_name", "source"
    )
  )
  expect_type(subtree$level, "integer")
})

test_that("fold_search_text lower-cases and folds ae, oe and dashes", {
  expect_identical(
    fold_search_text(c(
      "Haemophilia A",
      "Oedema",
      "Non-Hodgkin  Lymphoma",
      "Guillain–Barré Syndrome",
      "  COVID‐19 ",
      "Alzheimer's Disease",
      NA
    )),
    c(
      "hemophilia a",
      "edema",
      "non hodgkin lymphoma",
      "guillain barré syndrome",
      "covid 19",
      "alzheimer's disease",
      NA
    )
  )
})

test_that("fold_search_text replaces ae and oe in one left-to-right pass", {
  expect_identical(fold_search_text(c("oae", "AEOE")), c("oe", "ee"))
})

# The browser's foldSearchText is tested against the same file.
test_that("fold_search_text folds every case of the shared fixture", {
  cases <- jsonlite::fromJSON(fixture_fold_cases_path())
  expect_gt(nrow(cases), 15)
  expect_identical(fold_search_text(cases$input), cases$expected)
})

asmd_term <- "Acid sphingomyelinase deficiency (ASMD) type A/B or type B"

fixture_term_matches <- function(mesh) {
  match_mesh_terms(c("Alzheimer Disease", asmd_term, "Psoriasis"), mesh)
}

test_that("tree_number_prefixes lists a tree number and its ancestors", {
  expect_identical(
    tree_number_prefixes("C10.228.140"),
    c("C10", "C10.228", "C10.228.140")
  )
})

test_that("find_relevant_descriptors adds every ancestor descriptor", {
  mesh <- read_mesh_descriptors(fixture_mesh_path())
  expect_identical(
    find_relevant_descriptors(c("D000544", "D009542", NA), mesh),
    c("D000544", "D001523", "D009422", "D009542")
  )
})

test_that("build_mesh_entry_terms folds every term of relevant descriptors", {
  mesh <- read_mesh_descriptors(fixture_mesh_path())
  expect_identical(
    build_mesh_entry_terms(c("D000544", "D001523", "D009422", "D009542"), mesh),
    dplyr::tibble(
      entry_term = c(
        "acid sphingomyelinase deficiency",
        "alzheimer disease",
        "alzheimer's disease",
        "dementia, senile",
        "mental disorders",
        "nervous system diseases",
        "neurologic disorders",
        "niemann pick diseases",
        "psychiatric illness"
      ),
      mesh_descriptor_ui = c(
        "D009542", "D000544", "D000544", "D000544", "D001523", "D009422",
        "D009422", "D009542", "D001523"
      )
    )
  )
})

test_that("build_mesh_entry_terms keeps one term per descriptor word set", {
  mesh <- list(
    descriptors = dplyr::tibble(
      descriptor_ui = c("D1", "D2"),
      descriptor_name = c("Breast Neoplasms", "Mammary Neoplasms")
    ),
    tree_numbers = dplyr::tibble(
      descriptor_ui = character(),
      tree_number = character()
    ),
    terms = dplyr::tibble(
      descriptor_ui = c("D1", "D1", "D1", "D2"),
      term = c(
        "Breast Neoplasms", "Neoplasms, Breast", "Breast Cancer",
        "Breast Cancer"
      )
    )
  )
  expect_identical(
    build_mesh_entry_terms(c("D1", "D2"), mesh),
    dplyr::tibble(
      entry_term = c(
        "breast cancer", "breast cancer", "breast neoplasms",
        "mammary neoplasms"
      ),
      mesh_descriptor_ui = c("D1", "D2", "D1", "D2")
    )
  )
})

test_that("build_mesh_descriptor_areas lists EMA terms in each subtree", {
  mesh <- read_mesh_descriptors(fixture_mesh_path())
  expect_identical(
    build_mesh_descriptor_areas(fixture_term_matches(mesh), mesh),
    dplyr::tibble(
      mesh_descriptor_ui = c(
        "D000544", "D001523", "D009422", "D009422", "D009542"
      ),
      mesh_descriptor_name = c(
        "Alzheimer Disease",
        "Mental Disorders",
        "Nervous System Diseases",
        "Nervous System Diseases",
        "Niemann-Pick Diseases"
      ),
      therapeutic_area_mesh = c(
        "Alzheimer Disease",
        "Alzheimer Disease",
        asmd_term,
        "Alzheimer Disease",
        asmd_term
      )
    )
  )
})

test_that("the MeSH lookup tables are empty when no EMA term matches", {
  mesh <- read_mesh_descriptors(fixture_mesh_path())
  matches <- match_mesh_terms("Psoriasis", mesh)
  areas <- build_mesh_descriptor_areas(matches, mesh)
  expect_identical(nrow(areas), 0L)
  expect_named(
    areas,
    c("mesh_descriptor_ui", "mesh_descriptor_name", "therapeutic_area_mesh")
  )
  entry_terms <- build_mesh_entry_terms(
    find_relevant_descriptors(matches$mesh_descriptor_ui, mesh),
    mesh
  )
  expect_identical(nrow(entry_terms), 0L)
  expect_named(entry_terms, c("entry_term", "mesh_descriptor_ui"))
})

test_that("a matched descriptor without tree numbers still covers its term", {
  mesh <- read_mesh_descriptors(fixture_mesh_path())
  mesh$tree_numbers <- mesh$tree_numbers[
    mesh$tree_numbers$descriptor_ui != "D009542",
  ]
  areas <- build_mesh_descriptor_areas(fixture_term_matches(mesh), mesh)
  expect_identical(
    areas$therapeutic_area_mesh[areas$mesh_descriptor_ui == "D009542"],
    asmd_term
  )
  expect_identical(
    areas$therapeutic_area_mesh[areas$mesh_descriptor_ui == "D009422"],
    "Alzheimer Disease"
  )
})
