fixture_chembl_bodies <- function() {
  jsonlite::fromJSON(
    testthat::test_path("fixtures", "chembl-molecules-sample.json"),
    simplifyVector = FALSE
  )
}

json_body_response <- function(body) {
  httr2::response(
    status_code = 200,
    headers = list(`Content-Type` = "application/json"),
    body = charToRaw(enc2utf8(as.character(
      jsonlite::toJSON(body, auto_unbox = TRUE, null = "null", digits = NA)
    )))
  )
}

no_molecules <- function() list(molecules = list())

# Imatinib mesylate: the imatinib record as a salt of CHEMBL941.
salt_body <- function(bodies) {
  salt <- bodies$imatinib
  salt$molecules[[1]]$molecule_chembl_id <- "CHEMBL1642"
  salt$molecules[[1]]$pref_name <- "IMATINIB MESYLATE"
  salt$molecules[[1]]$molecule_type <- "Unknown"
  salt$molecules[[1]]$molecule_hierarchy$molecule_chembl_id <- "CHEMBL1642"
  salt
}

# Answers ChEMBL requests from the fixture records by filter and value.
mock_chembl_api <- function(env = parent.frame()) {
  bodies <- fixture_chembl_bodies()
  requested <- new.env()
  requested$urls <- character()
  requested$realms <- character()
  answers <- list(
    "pref_name__iexact=imatinib&" = bodies$imatinib,
    "molecule_synonym__iexact=beclometasone&" = bodies$beclometasone_synonym,
    "pref_name__iexact=dulaglutide&" = bodies$dulaglutide,
    "pref_name__iexact=imatinib%20mesylate&" = salt_body(bodies),
    "pref_name__iexact=examplevir%20sodium&" = NULL,
    "pref_name__iexact=examplevir&" = bodies$atosiban,
    "molecule_chembl_id__in=CHEMBL941&" = bodies$imatinib,
    "pref_name__istartswith=examplumab%20&" = bodies$dulaglutide,
    "pref_name__iexact=potassium%20bicarbonate&" = bodies$imatinib
  )
  testthat::local_mocked_bindings(
    req_perform = function(req, ...) {
      requested$urls <- c(requested$urls, req$url)
      requested$realms <- c(requested$realms, req$policies$throttle_realm)
      for (pattern in names(answers)) {
        if (grepl(pattern, req$url, fixed = TRUE)) {
          return(json_body_response(answers[[pattern]] %||% no_molecules()))
        }
      }
      json_body_response(no_molecules())
    },
    .package = "httr2",
    .env = env
  )
  requested
}

test_that("chembl_molecule_url encodes the value and names the fields", {
  url <- chembl_molecule_url("pref_name__iexact", "lutetium (177lu) chloride")
  expect_identical(
    url,
    paste0(
      "https://www.ebi.ac.uk/chembl/api/data/molecule.json?pref_name__iexact=",
      "lutetium%20%28177lu%29%20chloride&limit=50&only=molecule_chembl_id,",
      "pref_name,molecule_type,structure_type,max_phase,biotherapeutic,",
      "molecule_hierarchy,atc_classifications,molecule_synonyms"
    )
  )
  expect_match(
    chembl_molecule_url("molecule_chembl_id__in", "CHEMBL1,CHEMBL2",
                        chembl_parent_fields),
    "__in=CHEMBL1%2CCHEMBL2&limit=50&only=molecule_chembl_id,pref_name,",
    fixed = TRUE
  )
})

test_that("chembl_get caches responses by URL and keeps to its budget", {
  requested <- mock_chembl_api()
  cache_directory <- tempfile()
  state <- chembl_state(cache_directory, budget = 1L, today = "2026-09-29")
  url <- chembl_molecule_url("pref_name__iexact", "imatinib")
  body <- chembl_get(url, state)
  expect_identical(body$molecules[[1]]$molecule_chembl_id, "CHEMBL941")
  again <- chembl_get(url, state)
  expect_identical(again, body)
  expect_identical(requested$urls, url)
  expect_identical(requested$realms, "chembl")
  index <- jsonlite::fromJSON(file.path(cache_directory, "index.json"))
  expect_identical(
    index[[url]],
    list(file = "responses/00001.json", retrieved = "2026-09-29")
  )
  expect_identical(state$retrieved, as.Date(c("2026-09-29", "2026-09-29")))
  expect_error(
    chembl_get(chembl_molecule_url("pref_name__iexact", "x"), state),
    "budget"
  )
  # A new run reads the index written before.
  rerun <- chembl_state(cache_directory, budget = 0L)
  expect_identical(chembl_get(url, rerun), body)
})

test_that("a 429 from ChEMBL stops the run without a retry", {
  requested <- new.env()
  requested$count <- 0L
  testthat::local_mocked_bindings(
    req_perform = function(req, ...) {
      requested$count <- requested$count + 1L
      stop(structure(
        class = c("httr2_http_429", "httr2_http", "httr2_error", "error",
                  "condition"),
        list(message = "HTTP 429 Too Many Requests.", call = NULL)
      ))
    },
    .package = "httr2"
  )
  state <- chembl_state(tempfile())
  expect_error(
    chembl_get(chembl_molecule_url("pref_name__iexact", "x"), state),
    class = "httr2_http_429"
  )
  expect_identical(requested$count, 1L)
  expect_identical(
    chembl_request("https://example.org")$headers$Accept,
    "application/json"
  )
})

test_that("candidates are picked by synonym type, parent, phase and ID", {
  bodies <- fixture_chembl_bodies()
  ordered <- order_chembl_candidates(
    bodies$beclometasone_synonym$molecules,
    "beclometasone",
    by_synonym = TRUE
  )
  # Both INN synonyms and parents: phase 4 before phase 2.
  expect_identical(
    purrr::map_chr(ordered, function(one) one$molecule$molecule_chembl_id),
    c("CHEMBL1200500", "CHEMBL1586")
  )
  expect_identical(ordered[[1]]$syn_types, c("ATC", "INN"))
  fields <- chembl_match_fields(ordered)
  expect_identical(fields$ambiguity, "same_molecule_type")
  expect_identical(fields$max_phase, 4)
  expect_identical(
    fields$chembl_atc,
    c("A07EA07", "D07AC15", "R01AD01", "R03BA01")
  )
  expect_length(fields$candidates, 2)
  expect_identical(chembl_best_rank(character()), 99)
  expect_identical(chembl_best_rank(c("OTHER", "UNKNOWN_TYPE")), 5)
  # Different parents and types.
  mixed <- c(bodies$imatinib$molecules, bodies$dulaglutide$molecules)
  expect_identical(
    chembl_ambiguity(order_chembl_candidates(mixed, "x", FALSE)),
    "different_molecule_types"
  )
  one_parent <- order_chembl_candidates(
    c(bodies$imatinib$molecules, salt_body(bodies)$molecules),
    "imatinib",
    FALSE
  )
  expect_identical(chembl_ambiguity(one_parent), "same_parent")
  # Parent before salt.
  expect_identical(
    one_parent[[1]]$molecule$molecule_chembl_id,
    "CHEMBL941"
  )
})

test_that("a biotherapeutic's longest protein chain is read", {
  bodies <- fixture_chembl_bodies()
  expect_gt(chembl_max_protein_length(bodies$dulaglutide$molecules[[1]]), 100)
  expect_identical(
    chembl_max_protein_length(bodies$imatinib$molecules[[1]]),
    NA_real_
  )
  no_protein <- list(biotherapeutic = list(biocomponents = list(
    list(component_type = "DNA", sequence = "ACGT"),
    list(component_type = "Protein", sequence = NULL)
  )))
  expect_identical(chembl_max_protein_length(no_protein), NA_real_)
  expect_identical(chembl_text(NULL), NA_character_)
})

test_that("unmatched keys get a reason and variants", {
  expect_identical(
    chembl_unmatched_reason("rabies vaccine", character(), FALSE),
    "vaccine (description, not an INN)"
  )
  expect_identical(
    chembl_unmatched_reason("x", "J07BB02", FALSE),
    "vaccine (description, not an INN)"
  )
  expect_identical(
    chembl_unmatched_reason("x", character(), TRUE),
    "advanced therapy without a ChEMBL name"
  )
  expect_identical(
    chembl_unmatched_reason("autologous t cells", character(), FALSE),
    "cell or gene therapy (description)"
  )
  expect_identical(
    chembl_unmatched_reason("human normal immunoglobulin", character(), FALSE),
    "plasma-derived or human protein (description)"
  )
  expect_identical(
    chembl_unmatched_reason("1-13c-caprylic acid", character(), FALSE),
    "radionuclide notation"
  )
  expect_identical(
    chembl_unmatched_reason("plazomicin (sulfate)", character(), FALSE),
    "qualifier in parentheses"
  )
  expect_identical(
    chembl_unmatched_reason("a and b", character(), FALSE),
    "mixture or combination description"
  )
  expect_identical(
    chembl_unmatched_reason("birch pollen allergen", character(), FALSE),
    "extract or allergen"
  )
  expect_identical(
    chembl_unmatched_reason("voxilaprevi", character(), FALSE),
    "no exact ChEMBL pref_name or synonym"
  )
  expect_identical(
    chembl_variants("plazomicin (sulfate)"),
    "plazomicin"
  )
  expect_identical(
    chembl_variants("oestrogens conjugated"),
    "estrogens conjugated"
  )
  expect_identical(
    chembl_variants("aluminium sulphate hydrate"),
    c("aluminum sulfate hydrate", "aluminium")
  )
  expect_identical(
    chembl_variants("copper (64cu) oxodotreotide"),
    c(
      "copper oxodotreotide cu-64", "copper cu-64 oxodotreotide",
      "oxodotreotide cu-64", "copper oxodotreotide cu 64",
      "copper cu 64 oxodotreotide", "oxodotreotide cu 64"
    )
  )
  expect_identical(
    chembl_variants("gallium (68ga) chloride")[1],
    "gallium chloride ga-68"
  )
  expect_identical(chembl_variants("zinc acetate dihydrate"), character())
  expect_identical(chembl_variants("iodine (131x) omburtamab"), character())
})

test_that("leftover_active_substance needs every medicine to agree", {
  inn_keys <- dplyr::tibble(
    ema_product_number = c("P1", "P2", "P3", "P3"),
    substance_key = c("ledispavir", "ledispavir", "a", "b")
  )
  actives <- dplyr::tibble(
    ema_product_number = c("P1", "P2", "P3"),
    active_key = c("ledipasvir", "ledipasvir", "a")
  )
  expect_identical(
    leftover_active_substance("ledispavir", c("P1", "P2"), inn_keys, actives),
    "ledipasvir"
  )
  expect_identical(
    leftover_active_substance("b", "P3", inn_keys, actives),
    NA_character_
  )
})

site_tables_for_matching <- function() {
  list(
    ema_medicines = dplyr::tibble(
      ema_product_number = paste0("P", 1:11),
      name_of_medicine = c("Glivec", "Clenil", "Trulicity", "Glivecc", "Exa",
                           "Vac", "Imat", "Becl", "Exam", "Ab", "Sib"),
      medicine_status = "Authorised",
      advanced_therapy = FALSE,
      biosimilar = FALSE,
      pharmacotherapeutic_group_human = NA_character_
    ),
    ema_medicine_substances = dplyr::tibble(
      ema_product_number = paste0("P", 1:11),
      substance_key = c(
        "imatinib", "beclometasone", "dulaglutide", "imatinibb",
        "examplevir sodium", "rabies vaccine", "imatinib (mesylate)",
        "beclometasone (dipropionate)", "examplumab", "ab-12",
        "potassium hydrogen carbonate"
      ),
      substance = .data$substance_key
    ),
    # Imatinib: an exact match, so its other active substance is not tried.
    ema_medicine_active_substances = dplyr::tibble(
      ema_product_number = c("P1", "P4", "P5"),
      active_substance = c(
        "Imatinib mesylate", "Imatinib mesylate", "examplevir sodium"
      )
    ),
    ema_medicine_atc_codes = dplyr::tibble(
      ema_product_number = c("P1", "P5", "P6"),
      atc_code_human = c("L01EA01", "J05AX99", "J07BG01"),
      atc_code = c("L01EA01", "J05AX99", "J07BG01"),
      current_atc_code = NA_character_
    ),
    atc_classes = dplyr::tibble(
      atc_code = c("L01EA01", "J05AX99", "J07BG01"),
      level = 5L,
      name = c("imatinib", "examplevir", "rabies, inactivated, whole virus")
    )
  )
}

write_site_tables <- function(tables) {
  directory <- tempfile()
  dir.create(directory)
  for (name in names(tables)) {
    jsonlite::write_json(
      tables[[name]],
      file.path(directory, paste0(name, ".json")),
      na = "null"
    )
  }
  directory
}

test_that("run_chembl_matching writes the matches file from cached data", {
  requested <- mock_chembl_api()
  data_directory <- write_site_tables(site_tables_for_matching())
  output_path <- file.path(tempfile(), "chembl-substance-matches.json")
  cache_root <- tempfile()
  messages <- testthat::capture_messages(rows <- run_chembl_matching(
    data_directory = data_directory,
    cache_root = cache_root,
    output_path = output_path,
    release = "ChEMBL_37",
    today = as.Date("2026-09-29")
  ))
  expect_match(messages, "ChEMBL \\(ChEMBL_37\\): [0-9]+ requests", all = FALSE)
  written <- read_chembl_matches(output_path)
  expect_named(written, names(chembl_match_columns))
  expect_identical(
    written$substance_key,
    c(
      "ab-12", "beclometasone", "beclometasone (dipropionate)", "dulaglutide",
      "examplevir sodium", "examplumab", "imatinib", "imatinib (mesylate)",
      "imatinibb", "potassium hydrogen carbonate", "rabies vaccine"
    )
  )
  by_key <- split(written, written$substance_key)
  expect_identical(by_key$imatinib$match_method, "pref_name")
  expect_identical(by_key$imatinib$molecule_chembl_id, "CHEMBL941")
  expect_identical(by_key$beclometasone$match_method, "synonym")
  expect_identical(
    by_key$beclometasone$matched_syn_types[[1]],
    c("ATC", "INN")
  )
  # The misspelt key: its medicine's other active substance, a salt of
  # imatinib, with its parent's name and type.
  expect_identical(by_key$imatinibb$match_method, "active_substance")
  expect_identical(by_key$imatinibb$query, "imatinib mesylate")
  expect_identical(by_key$imatinibb$parent_chembl_id, "CHEMBL941")
  expect_identical(by_key$imatinibb$parent_pref_name, "IMATINIB")
  expect_identical(by_key$imatinibb$parent_molecule_type, "Small molecule")
  # No exact name: the WHO name of the medicine's one code.
  expect_identical(by_key$`examplevir sodium`$match_method, "atc_name")
  expect_identical(by_key$`examplevir sodium`$query, "examplevir")
  expect_identical(by_key$dulaglutide$biocomponent_max_protein_length > 100,
                   TRUE)
  expect_identical(
    by_key$`rabies vaccine`$unmatched_reason,
    "vaccine (description, not an INN)"
  )
  expect_identical(
    by_key$`potassium hydrogen carbonate`$query,
    "potassium bicarbonate"
  )
  expect_identical(
    by_key$`potassium hydrogen carbonate`$match_method,
    "spelling"
  )
  # Unmatched keys: variant candidates for review, never applied.
  variants <- function(key) by_key[[key]]$variant_candidates[[1]]
  expect_identical(by_key$`imatinib (mesylate)`$molecule_chembl_id,
                   NA_character_)
  expect_identical(variants("imatinib (mesylate)")$method, "pref_name")
  expect_identical(variants("imatinib (mesylate)")$variant, "imatinib")
  expect_identical(
    variants("beclometasone (dipropionate)")$method,
    c("synonym", "synonym")
  )
  expect_identical(
    variants("examplumab")$method,
    "pref_name_startswith"
  )
  expect_identical(variants("examplumab")$variant, "examplumab \u2026")
  expect_length(by_key$`ab-12`$variant_candidates[[1]], 0)
  expect_identical(unique(written$retrieved), "2026-09-29")
  expect_identical(unique(written$chembl_release), "ChEMBL_37")
  expect_false(any(written$reviewed))

  # A rerun needs no request and keeps a review; a reviewed key that now
  # matches another molecule keeps its reviewed row.
  reviewed <- written
  reviewed$reviewed[reviewed$substance_key == "imatinib"] <- TRUE
  reviewed$molecule_chembl_id[reviewed$substance_key == "rabies vaccine"] <-
    "CHEMBL9"
  reviewed$reviewed[reviewed$substance_key == "rabies vaccine"] <- TRUE
  write_json_table(reviewed, output_path)
  count_before <- length(requested$urls)
  suppressMessages(run_chembl_matching(
    data_directory = data_directory,
    cache_root = cache_root,
    output_path = output_path,
    release = "ChEMBL_37",
    budget = 0L,
    today = as.Date("2026-10-01")
  ))
  expect_identical(length(requested$urls), count_before)
  rerun <- read_chembl_matches(output_path)
  expect_identical(
    rerun$reviewed,
    c(rep(FALSE, 6), TRUE, rep(FALSE, 3), TRUE)
  )
  expect_identical(
    rerun$molecule_chembl_id[rerun$substance_key == "rabies vaccine"],
    "CHEMBL9"
  )
  expect_identical(unique(rerun$retrieved), "2026-09-29")
})

test_that("read_chembl_matches needs the file and its columns", {
  expect_error(read_chembl_matches(tempfile()), "is missing")
  path <- tempfile(fileext = ".json")
  writeLines("[]", path)
  expect_identical(read_chembl_matches(path), empty_chembl_matches())
  writeLines('[{"substance_key": "x"}]', path)
  expect_error(read_chembl_matches(path), "lacks columns")
})

test_that("read_chembl_matches warns on another release, fills reviews", {
  matches <- read_chembl_matches(fixture_chembl_matches_path())
  expect_warning(
    read_chembl_matches(fixture_chembl_matches_path(), "ChEMBL_38"),
    "ChEMBL_37"
  )
  expect_silent(read_chembl_matches(fixture_chembl_matches_path(), "ChEMBL_37"))
  reviewed <- matches[matches$substance_key == "plazomicin (sulfate)", ]
  expect_identical(reviewed$molecule_type, "Small molecule")
  expect_identical(reviewed$pref_name, "PLAZOMICIN")
  expect_identical(
    applied_chembl_matches(matches)$substance_key,
    setdiff(
      matches$substance_key[!is.na(matches$molecule_chembl_id)],
      matches$substance_key[
        matches$ambiguity %in% "different_molecule_types" &
          !matches$reviewed
      ]
    )
  )
})

test_that("carry_chembl_reviews keeps the file's reviews", {
  previous <- dplyr::tibble(
    substance_key = c("a", "b", "c"),
    molecule_chembl_id = c("CHEMBL1", "CHEMBL2", "CHEMBL3"),
    reviewed = c(TRUE, TRUE, FALSE)
  )
  rows <- dplyr::tibble(
    substance_key = c("a", "b", "c"),
    molecule_chembl_id = c("CHEMBL1", NA, "CHEMBL3"),
    reviewed = FALSE
  )
  expect_message(carried <- carry_chembl_reviews(rows, previous), "b")
  expect_identical(carried$reviewed, c(TRUE, TRUE, FALSE))
  expect_identical(carried$molecule_chembl_id, c("CHEMBL1", "CHEMBL2",
                                                 "CHEMBL3"))
  expect_identical(
    carry_chembl_reviews(rows, previous[3, ]),
    rows
  )
})
