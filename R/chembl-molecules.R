# ChEMBL molecule types for modality (tier T6): an on-demand script
# (scripts/match-chembl-modality.R, run_chembl_matching()) matches every
# substance key the pipeline classifies to a ChEMBL molecule by exact name
# and writes a committed file, which the daily pipeline reads
# (read_chembl_matches()): CI makes no per-molecule ChEMBL requests.
chembl_matches_path <- "data-raw/chembl-substance-matches.json"

chembl_match_columns <- c(
  substance_key = "character",
  query = "character",
  match_method = "character",
  matched_syn_types = "list",
  molecule_chembl_id = "character",
  pref_name = "character",
  molecule_type = "character",
  structure_type = "character",
  max_phase = "numeric",
  parent_chembl_id = "character",
  parent_pref_name = "character",
  parent_molecule_type = "character",
  biotherapeutic_description = "character",
  biocomponent_max_protein_length = "numeric",
  chembl_atc = "list",
  ambiguity = "character",
  candidates = "list",
  unmatched_reason = "character",
  variant_candidates = "list",
  reviewed = "logical",
  chembl_release = "character",
  retrieved = "character",
  source = "character"
)

chembl_molecule_fields <- c(
  "molecule_chembl_id", "pref_name", "molecule_type", "structure_type",
  "max_phase", "biotherapeutic", "molecule_hierarchy", "atc_classifications",
  "molecule_synonyms"
)

chembl_parent_fields <- c(
  "molecule_chembl_id", "pref_name", "molecule_type", "atc_classifications",
  "max_phase"
)

chembl_spacing_seconds <- 1.1
chembl_default_budget <- 2000L

empty_chembl_matches <- function() {
  columns <- purrr::map(chembl_match_columns, function(type) vector(type))
  dplyr::as_tibble(columns)
}

read_chembl_matches <- function(path = chembl_matches_path, release = NULL) {
  if (!file.exists(path)) {
    cli::cli_abort(c(
      "The ChEMBL matches file {.path {path}} is missing.",
      i = "Run {.code Rscript scripts/match-chembl-modality.R} to create it."
    ))
  }
  rows <- jsonlite::fromJSON(path)
  if (length(rows) == 0) {
    return(empty_chembl_matches())
  }
  missing_columns <- setdiff(names(chembl_match_columns), names(rows))
  if (length(missing_columns) > 0) {
    cli::cli_abort(c(
      "The ChEMBL matches file lacks columns.",
      x = "{.val {offender_values(missing_columns)}}"
    ))
  }
  # A column that is null in every row reads as logical.
  casts <- list(
    character = as.character,
    numeric = as.numeric,
    logical = as.logical,
    list = as.list
  )
  columns <- purrr::imap(chembl_match_columns, function(type, column) {
    casts[[type]](rows[[column]])
  })
  matches <- fill_reviewed_chembl_types(dplyr::as_tibble(columns))
  file_releases <- unique(stats::na.omit(matches$chembl_release))
  if (!is.null(release) && !all(file_releases == release)) {
    cli::cli_warn(c(
      "The ChEMBL matches are from {.val {file_releases}}, ChEMBL is at
      {.val {release}}.",
      i = "Rerun {.code Rscript scripts/match-chembl-modality.R}."
    ))
  }
  matches
}

# A reviewed row whose ChEMBL ID was filled by hand from its variant
# candidates takes that candidate's molecule type.
fill_reviewed_chembl_types <- function(matches) {
  needs_type <- which(
    matches$reviewed %in% TRUE & !is.na(matches$molecule_chembl_id) &
      is.na(matches$molecule_type)
  )
  for (row in needs_type) {
    candidates <- as.data.frame(matches$variant_candidates[[row]])
    found <- candidates[
      candidates$molecule_chembl_id %in% matches$molecule_chembl_id[[row]],
    ]
    if (nrow(found) > 0) {
      matches$molecule_type[[row]] <- found$molecule_type[[1]]
      matches$pref_name[[row]] <- found$pref_name[[1]]
    }
  }
  matches
}

# ---- On-demand matching (scripts/match-chembl-modality.R) ----

chembl_molecule_url <- function(filter,
                                value,
                                fields = chembl_molecule_fields) {
  paste0(
    chembl_api_url,
    "molecule.json?",
    filter,
    "=",
    utils::URLencode(value, reserved = TRUE),
    "&limit=50&only=",
    paste(fields, collapse = ",")
  )
}

chembl_request <- function(url) {
  throttled_request(
    url,
    spacing_seconds = chembl_spacing_seconds,
    realm = "chembl"
  ) |>
    httr2::req_headers(Accept = "application/json")
}

# One run's request state: its budget, today, the cache index (URL -> file
# and fetch date) and the dates of the responses used.
chembl_state <- function(cache_directory,
                         budget = chembl_default_budget,
                         today = Sys.Date()) {
  state <- new.env()
  state$cache_directory <- cache_directory
  state$index_path <- file.path(cache_directory, "index.json")
  state$index <- if (file.exists(state$index_path)) {
    jsonlite::fromJSON(state$index_path, simplifyVector = FALSE)
  } else {
    list()
  }
  state$requests <- 0L
  state$budget <- budget
  state$today <- as.Date(today)
  state$retrieved <- as.Date(character())
  state
}

# Responses are cached by URL in the release's folder, never refetched: a
# new release starts a new folder. At most `state$budget` requests; a 429
# stops the run (no retry), the cache kept.
chembl_get <- function(url, state) {
  cached <- state$index[[url]]
  cached_path <- if (is.null(cached)) {
    NA_character_
  } else {
    file.path(state$cache_directory, cached$file)
  }
  if (!is.na(cached_path) && file.exists(cached_path)) {
    state$retrieved <- c(state$retrieved, as.Date(cached$retrieved))
    return(jsonlite::fromJSON(cached_path, simplifyVector = FALSE))
  }
  if (state$requests >= state$budget) {
    cli::cli_abort(c(
      "The ChEMBL request budget ({state$budget}) is used up.",
      i = "Run again to continue: cached responses are not requested again."
    ))
  }
  state$requests <- state$requests + 1L
  response <- httr2::req_perform(chembl_request(url))
  file_name <- sprintf("responses/%05d.json", length(state$index) + 1L)
  dir.create(
    file.path(state$cache_directory, "responses"),
    recursive = TRUE,
    showWarnings = FALSE
  )
  writeBin(
    httr2::resp_body_raw(response),
    file.path(state$cache_directory, file_name)
  )
  state$index[[url]] <- list(file = file_name, retrieved = format(state$today))
  jsonlite::write_json(
    state$index,
    state$index_path,
    auto_unbox = TRUE,
    pretty = TRUE
  )
  state$retrieved <- c(state$retrieved, state$today)
  httr2::resp_body_json(response)
}

chembl_text <- function(value) {
  if (is.null(value)) NA_character_ else as.character(value)
}

chembl_syn_ranks <- c(
  INN = 0, EMA = 1, BAN = 2, USAN = 2, JAN = 2, USP = 2, FDA = 3, ATC = 3,
  BNF = 3, MERCK_INDEX = 4, OTHER = 5, TRADE_NAME = 6, RESEARCH_CODE = 7
)

# The synonym types under which a molecule carries `query`.
chembl_syn_types <- function(molecule, query) {
  synonyms <- molecule$molecule_synonyms %||% list()
  types <- purrr::map_chr(synonyms, function(synonym) {
    name <- chembl_text(synonym$molecule_synonym)
    if ((stringr::str_to_lower(name) == query) %in% TRUE) {
      chembl_text(synonym$syn_type)
    } else {
      NA_character_
    }
  })
  sort(unique(types[!is.na(types)]))
}

chembl_best_rank <- function(types) {
  ranks <- unname(chembl_syn_ranks[types])
  ranks[is.na(ranks)] <- 8
  min(c(99, ranks))
}

# Candidates in pick order: synonym type (INN first), parent before salt,
# higher max_phase, lower ChEMBL ID.
order_chembl_candidates <- function(molecules, query, by_synonym) {
  candidates <- purrr::map(molecules, function(molecule) {
    id <- chembl_text(molecule$molecule_chembl_id)
    parent <- chembl_text(molecule$molecule_hierarchy$parent_chembl_id)
    list(
      molecule = molecule,
      syn_types = if (by_synonym) chembl_syn_types(molecule, query) else
        character(),
      parent = dplyr::coalesce(parent, id),
      is_parent = dplyr::coalesce(parent, id) == id,
      max_phase = as.numeric(chembl_text(molecule$max_phase)),
      id_number = as.numeric(sub("^CHEMBL", "", id))
    )
  })
  ranks <- purrr::map_dbl(candidates, function(one) {
    chembl_best_rank(one$syn_types)
  })
  phases <- dplyr::coalesce(purrr::map_dbl(candidates, "max_phase"), -1)
  candidates[order(
    ranks,
    !purrr::map_lgl(candidates, "is_parent"),
    -phases,
    purrr::map_dbl(candidates, "id_number")
  )]
}

chembl_atc_codes <- function(molecule) {
  sort(as.character(unlist(molecule$atc_classifications)))
}

# The longest protein chain of a biotherapeutic (R11: a large partner).
chembl_max_protein_length <- function(molecule) {
  components <- molecule$biotherapeutic$biocomponents %||% list()
  lengths <- purrr::map_dbl(components, function(component) {
    sequence <- chembl_text(component$sequence)
    if (identical(chembl_text(component$component_type), "Protein") &&
          !is.na(sequence)) {
      nchar(sequence)
    } else {
      0
    }
  })
  longest <- max(c(0, lengths))
  if (longest == 0) NA_real_ else longest
}

chembl_ambiguity <- function(candidates) {
  if (length(candidates) < 2) {
    return(NA_character_)
  }
  types <- purrr::map_chr(candidates, function(one) {
    chembl_text(one$molecule$molecule_type)
  })
  if (dplyr::n_distinct(purrr::map_chr(candidates, "parent")) == 1) {
    "same_parent"
  } else if (dplyr::n_distinct(types) == 1) {
    "same_molecule_type"
  } else {
    "different_molecule_types"
  }
}

chembl_candidate_table <- function(candidates) {
  if (length(candidates) < 2) {
    return(list())
  }
  purrr::map(candidates, function(one) {
    list(
      molecule_chembl_id = chembl_text(one$molecule$molecule_chembl_id),
      pref_name = chembl_text(one$molecule$pref_name),
      molecule_type = chembl_text(one$molecule$molecule_type),
      max_phase = one$max_phase,
      parent_chembl_id = one$parent,
      matched_syn_types = one$syn_types,
      chembl_atc = chembl_atc_codes(one$molecule)
    )
  })
}

# The matched fields of the best candidate.
chembl_match_fields <- function(candidates) {
  best <- candidates[[1]]
  molecule <- best$molecule
  list(
    matched_syn_types = best$syn_types,
    molecule_chembl_id = chembl_text(molecule$molecule_chembl_id),
    pref_name = chembl_text(molecule$pref_name),
    molecule_type = chembl_text(molecule$molecule_type),
    structure_type = chembl_text(molecule$structure_type),
    max_phase = best$max_phase,
    parent_chembl_id = best$parent,
    biotherapeutic_description = chembl_text(
      molecule$biotherapeutic$description
    ),
    biocomponent_max_protein_length = chembl_max_protein_length(molecule),
    chembl_atc = chembl_atc_codes(molecule),
    ambiguity = chembl_ambiguity(candidates),
    candidates = chembl_candidate_table(candidates)
  )
}

# Exact name, then exact synonym; NULL when neither finds a molecule.
chembl_exact_search <- function(query, state) {
  by_name <- chembl_get(chembl_molecule_url("pref_name__iexact", query), state)
  if (length(by_name$molecules) > 0) {
    return(order_chembl_candidates(by_name$molecules, query, FALSE))
  }
  by_synonym <- chembl_get(
    chembl_molecule_url("molecule_synonyms__molecule_synonym__iexact", query),
    state
  )
  if (length(by_synonym$molecules) > 0) {
    return(order_chembl_candidates(by_synonym$molecules, query, TRUE))
  }
  NULL
}

# Why a key found no molecule (descriptions are not INNs).
chembl_unmatched_reason <- function(key, atc_codes, advanced_therapy) {
  dplyr::case_when(
    grepl("vaccine", key) | any(startsWith(atc_codes, "J07")) ~
      "vaccine (description, not an INN)",
    advanced_therapy ~ "advanced therapy without a ChEMBL name",
    grepl(paste0(
      "\\b(autologous|allogeneic|cells?|transduced|lentivir|t-cell|",
      "t cells?)\\b"
    ), key) ~ "cell or gene therapy (description)",
    grepl(paste0(
      "\\b(immunoglobulin|plasma|human normal|fibrinogen|thrombin|albumin|",
      "antithrombin|c1 inhibitor|factor)\\b"
    ), key) ~ "plasma-derived or human protein (description)",
    grepl("\\[\\d+|\\(\\d+[a-z]+\\)|\\b\\d+[a-z]{1,2}\\b", key) ~
      "radionuclide notation",
    grepl("\\(|\\)", key) ~ "qualifier in parentheses",
    grepl(" and | \\+ |,", key) ~ "mixture or combination description",
    grepl("extract|allergen|pollen|mite", key) ~ "extract or allergen",
    .default = "no exact ChEMBL pref_name or synonym"
  )
}

chembl_salt_words <- c(
  "hydrochloride", "dihydrochloride", "hydrobromide", "sodium", "disodium",
  "trisodium", "potassium", "dipotassium", "calcium", "magnesium", "zinc",
  "mesilate", "mesylate", "dimesilate", "maleate", "fumarate", "hemifumarate",
  "tartrate", "bitartrate", "citrate", "succinate", "acetate", "diacetate",
  "besilate", "tosilate", "tosylate", "bromide", "chloride", "iodide",
  "sulfate", "sulphate", "hydrogen", "phosphate", "dihydrogen",
  "monohydrate", "dihydrate", "trihydrate", "sesquihydrate", "hemihydrate",
  "hydrate", "anhydrous", "hyclate", "lactate", "gluconate", "malate",
  "oxalate", "nitrate", "carbonate", "stearate", "palmitate", "decanoate",
  "enanthate", "embonate", "pamoate", "meglumine", "lysine", "arginine",
  "tromethamine", "trometamol", "ethanolate", "propionate", "valerate",
  "dipropionate", "furoate", "xinafoate"
)

chembl_element_names <- c(
  "gallium", "germanium", "yttrium", "lutetium", "samarium", "copper",
  "iodine", "radium", "iron", "zinc", "potassium", "sodium", "calcium",
  "magnesium", "lithium", "technetium", "indium", "zirconium", "actinium",
  "lead"
)

chembl_element_symbols <- c(
  f = "f", c = "c", sm = "sm", y = "y", lu = "lu", ga = "ga", tc = "tc",
  ra = "ra", cu = "cu", i = "i", l = "i", "in" = "in", zr = "zr", ac = "ac",
  pb = "pb"
)

# Spelling, qualifier, salt and isotope variants of an unmatched key (at
# most 8); their hits are candidates for review, never applied.
chembl_variants <- function(key) {
  spelled <- key |>
    stringr::str_replace_all("ae", "e") |>
    stringr::str_replace_all("sulph", "sulf") |>
    stringr::str_replace_all("aluminium", "aluminum") |>
    stringr::str_replace_all("caesium", "cesium") |>
    stringr::str_replace_all("oe", "e")
  without_qualifier <- key |>
    stringr::str_remove_all("\\s*[\\[(][^\\])]*[\\])]") |>
    stringr::str_squish()
  variants <- c(spelled, without_qualifier)
  isotope <- stringr::str_match(key, "[\\[(](\\d{1,3})([a-z]{1,2})[\\])]")
  if (!is.na(isotope[1, 1])) {
    symbol <- chembl_element_symbols[isotope[1, 3]]
    if (!is.na(symbol)) {
      words <- strsplit(without_qualifier, " ", fixed = TRUE)[[1]]
      for (tag in paste0(symbol, c("-", " "), isotope[1, 2])) {
        variants <- c(
          variants,
          paste(without_qualifier, tag),
          paste(c(words[1], tag, words[-1]), collapse = " "),
          if (length(words) > 1) paste(c(words[-1], tag), collapse = " ")
        )
      }
    }
    variants <- unique(setdiff(variants, key))
    return(utils::head(variants[grepl("[0-9]", variants)], 8))
  }
  words <- strsplit(gsub(",", "", without_qualifier), " ", fixed = TRUE)[[1]]
  if (words[1] %in% chembl_element_names) {
    return(utils::head(unique(setdiff(variants, c(key, ""))), 8))
  }
  stripped <- paste(
    words[seq_along(words) == 1 | !words %in% chembl_salt_words],
    collapse = " "
  )
  variants <- c(
    variants,
    stripped,
    stripped |>
      stringr::str_replace_all("ae", "e") |>
      stringr::str_replace_all("sulph", "sulf")
  )
  utils::head(unique(setdiff(variants, c(key, ""))), 8)
}

chembl_variant_rows <- function(molecules, variant, method) {
  purrr::map(molecules, function(molecule) {
    list(
      variant = variant,
      method = method,
      molecule_chembl_id = chembl_text(molecule$molecule_chembl_id),
      pref_name = chembl_text(molecule$pref_name),
      molecule_type = chembl_text(molecule$molecule_type),
      max_phase = as.numeric(chembl_text(molecule$max_phase)),
      atc = chembl_atc_codes(molecule),
      parent_chembl_id = chembl_text(
        molecule$molecule_hierarchy$parent_chembl_id
      ),
      matched_syn_types = if (method == "synonym") {
        chembl_syn_types(molecule, variant)
      } else {
        character()
      }
    )
  })
}

# The molecules the variants of an unmatched key find (the first variant
# with any), else those whose name starts with the key.
chembl_variant_candidates <- function(key, state) {
  for (variant in chembl_variants(key)) {
    body <- chembl_get(chembl_molecule_url("pref_name__iexact", variant), state)
    method <- "pref_name"
    if (length(body$molecules) == 0) {
      body <- chembl_get(
        chembl_molecule_url(
          "molecule_synonyms__molecule_synonym__iexact",
          variant
        ),
        state
      )
      method <- "synonym"
    }
    if (length(body$molecules) > 0) {
      return(chembl_variant_rows(body$molecules, variant, method))
    }
  }
  if (grepl("^[a-z]{6,}$", key)) {
    body <- chembl_get(
      chembl_molecule_url("pref_name__istartswith", paste0(key, " ")),
      state
    )
    return(chembl_variant_rows(
      body$molecules,
      paste(key, "…"),
      "pref_name_startswith"
    ))
  }
  list()
}

empty_chembl_match_row <- function(key, release) {
  list(
    substance_key = key,
    query = key,
    match_method = NA_character_,
    matched_syn_types = character(),
    molecule_chembl_id = NA_character_,
    pref_name = NA_character_,
    molecule_type = NA_character_,
    structure_type = NA_character_,
    max_phase = NA_real_,
    parent_chembl_id = NA_character_,
    parent_pref_name = NA_character_,
    parent_molecule_type = NA_character_,
    biotherapeutic_description = NA_character_,
    biocomponent_max_protein_length = NA_real_,
    chembl_atc = character(),
    ambiguity = NA_character_,
    candidates = list(),
    unmatched_reason = NA_character_,
    variant_candidates = list(),
    reviewed = FALSE,
    chembl_release = release,
    retrieved = NA_character_,
    source = "chembl"
  )
}

# One key: its exact name, then its alternates in order, the first that
# finds a molecule; unmatched keys get a reason and variant candidates.
match_chembl_key <- function(target, state, release) {
  row <- empty_chembl_match_row(target$substance_key, release)
  candidates <- chembl_exact_search(target$substance_key, state)
  method <- NA_character_
  if (!is.null(candidates)) {
    method <- if (length(candidates[[1]]$syn_types) > 0) "synonym" else
      "pref_name"
  }
  for (alternate in target$alternates) {
    if (!is.null(candidates)) {
      break
    }
    candidates <- chembl_exact_search(alternate$query, state)
    if (!is.null(candidates)) {
      method <- alternate$method
      row$query <- alternate$query
    }
  }
  if (is.null(candidates)) {
    row$unmatched_reason <- chembl_unmatched_reason(
      target$substance_key,
      target$atc_codes,
      target$advanced_therapy
    )
    if (!startsWith(row$unmatched_reason, "vaccine")) {
      row$variant_candidates <- chembl_variant_candidates(
        target$substance_key,
        state
      )
    }
    return(row)
  }
  row$match_method <- method
  utils::modifyList(row, chembl_match_fields(candidates), keep.null = TRUE)
}

# Names and types of the parents of salt matches, 50 IDs per request.
chembl_parents <- function(parent_ids, state) {
  batches <- split(parent_ids, ceiling(seq_along(parent_ids) / 50))
  parents <- purrr::map(unname(batches), function(ids) {
    body <- chembl_get(
      chembl_molecule_url(
        "molecule_chembl_id__in",
        paste(ids, collapse = ","),
        chembl_parent_fields
      ),
      state
    )
    purrr::map(body$molecules, function(molecule) {
      dplyr::tibble(
        parent_chembl_id = chembl_text(molecule$molecule_chembl_id),
        parent_pref_name = chembl_text(molecule$pref_name),
        parent_molecule_type = chembl_text(molecule$molecule_type)
      )
    }) |>
      purrr::list_rbind()
  })
  purrr::list_rbind(c(
    list(dplyr::tibble(
      parent_chembl_id = character(),
      parent_pref_name = character(),
      parent_molecule_type = character()
    )),
    parents
  ))
}

# The one EMA active substance a key's medicines list besides their other
# keys, when every medicine of the key agrees (a misspelt INN field).
leftover_active_substance <- function(key, products, inn_keys, actives) {
  found <- character()
  for (product in products) {
    keys_of_product <- inn_keys$substance_key[
      inn_keys$ema_product_number == product
    ]
    actives_of_product <- actives$active_key[
      actives$ema_product_number == product
    ]
    unpaired <- setdiff(keys_of_product, actives_of_product)
    leftovers <- setdiff(actives_of_product, keys_of_product)
    if (!identical(unpaired, key) || length(leftovers) != 1) {
      return(NA_character_)
    }
    found <- union(found, leftovers)
  }
  if (length(found) == 1) found else NA_character_
}

# The texts tried for a key without an exact match, in order.
chembl_alternates <- function(key, products, inn_keys, actives, equivalents,
                              single_code_names) {
  equivalent_keys <- sort(unique(c(
    equivalents$equivalent_key[equivalents$substance_key == key],
    equivalents$substance_key[equivalents$equivalent_key == key]
  )))
  code_names <- unique(single_code_names$name[
    single_code_names$ema_product_number %in% products
  ])
  all_single <- all(products %in% single_code_names$ema_product_number)
  alternates <- c(
    active_substance = leftover_active_substance(
      key, products, inn_keys, actives
    ),
    stats::setNames(equivalent_keys, rep("equivalent_key", length(
      equivalent_keys
    ))),
    comma_tail = if (grepl(", ", key)) sub(",.*$", "", key) else NA,
    spelling = if (grepl("hydrogen carbonate", key)) {
      sub("hydrogen carbonate", "bicarbonate", key)
    } else {
      NA
    },
    atc_name = if (all_single && length(code_names) == 1) code_names else NA
  )
  alternates <- alternates[!is.na(alternates) & alternates != key]
  purrr::imap(unname(alternates), function(query, index) {
    list(method = names(alternates)[[index]], query = query)
  })
}

# Every key the pipeline classifies (modality_inputs() on the written data
# files), with the facts its alternates and unmatched reason need.
chembl_match_targets <- function(tables,
                                 equivalents =
                                   curated_substance_equivalents()) {
  inputs <- modality_inputs(
    tables$ema_medicines,
    tables$ema_medicine_substances,
    tables$ema_medicine_active_substances,
    tables$ema_medicine_atc_codes,
    tables$atc_classes
  ) |>
    dplyr::filter(!is.na(.data$substance_key))
  inn_keys <- dplyr::distinct(
    tables$ema_medicine_substances,
    .data$ema_product_number,
    .data$substance_key
  )
  actives <- tables$ema_medicine_active_substances |>
    dplyr::transmute(
      .data$ema_product_number,
      active_key = stringr::str_squish(
        stringr::str_to_lower(.data$active_substance)
      )
    )
  codes <- tables$ema_medicine_atc_codes |>
    dplyr::select("ema_product_number", "current_atc_code", "atc_code",
                  "atc_code_human") |>
    tidyr::pivot_longer(-"ema_product_number", values_to = "code") |>
    dplyr::filter(!is.na(.data$code)) |>
    dplyr::distinct(.data$ema_product_number, .data$code)
  # The WHO name of a medicine's one level-5 code, for its one key.
  single_key_products <- inputs |>
    dplyr::filter(dplyr::n() == 1, .by = "ema_product_number") |>
    dplyr::pull("ema_product_number")
  single_code_names <- product_atc_codes(tables$ema_medicine_atc_codes) |>
    dplyr::filter(dplyr::n() == 1, .by = "ema_product_number") |>
    dplyr::filter(
      nchar(.data$code) == 7,
      !startsWith(.data$code, "J07"),
      .data$ema_product_number %in% single_key_products
    ) |>
    dplyr::inner_join(
      dplyr::select(tables$atc_classes, code = "atc_code", "name"),
      by = "code"
    ) |>
    dplyr::mutate(name = stringr::str_to_lower(.data$name))
  atmp <- tables$ema_medicines$ema_product_number[
    tables$ema_medicines$advanced_therapy %in% TRUE
  ]
  inputs |>
    dplyr::summarise(
      products = list(sort(unique(.data$ema_product_number))),
      .by = "substance_key"
    ) |>
    dplyr::arrange(.data$substance_key) |>
    dplyr::mutate(
      atc_codes = purrr::map(.data$products, function(products) {
        unique(codes$code[codes$ema_product_number %in% products])
      }),
      advanced_therapy = purrr::map_lgl(.data$products, function(products) {
        any(products %in% atmp)
      }),
      alternates = purrr::map2(
        .data$substance_key,
        .data$products,
        function(key, products) {
          chembl_alternates(
            key, products, inn_keys, actives, equivalents, single_code_names
          )
        }
      )
    )
}

# A rerun keeps the reviews in the file it replaces: a new row with a
# reviewed row's key and ChEMBL ID stays reviewed, and a reviewed row whose
# key now matches another molecule (or none) is kept, with a warning.
carry_chembl_reviews <- function(rows, previous) {
  reviewed <- dplyr::filter(previous, .data$reviewed %in% TRUE)
  if (nrow(reviewed) == 0) {
    return(rows)
  }
  same <- paste(rows$substance_key, rows$molecule_chembl_id) %in%
    paste(reviewed$substance_key, reviewed$molecule_chembl_id)
  rows$reviewed[same] <- TRUE
  kept <- reviewed[!reviewed$substance_key %in% rows$substance_key[same], ]
  if (nrow(kept) > 0) {
    cli::cli_alert_warning(
      "Reviewed ChEMBL matches this run did not find again, kept:
      {.val {offender_values(kept$substance_key, max_shown = 20)}}"
    )
  }
  rows |>
    dplyr::filter(!.data$substance_key %in% kept$substance_key) |>
    dplyr::bind_rows(kept) |>
    dplyr::arrange(.data$substance_key)
}

read_site_tables <- function(data_directory, names) {
  stats::setNames(
    purrr::map(names, function(name) {
      dplyr::as_tibble(jsonlite::fromJSON(
        file.path(data_directory, paste0(name, ".json"))
      ))
    }),
    names
  )
}

# Records (candidates) as a table, so their fields are written as scalars
# and their code and synonym-type lists as arrays; none: an empty array.
chembl_records_table <- function(records) {
  if (length(records) == 0) {
    return(list())
  }
  array_fields <- c("matched_syn_types", "chembl_atc", "atc")
  purrr::map(records, function(record) {
    is_array <- names(record) %in% array_fields
    record[is_array] <- purrr::map(record[is_array], list)
    dplyr::as_tibble(record)
  }) |>
    purrr::list_rbind()
}

chembl_rows_table <- function(rows) {
  columns <- purrr::imap(chembl_match_columns, function(type, column) {
    values <- purrr::map(rows, column)
    if (column %in% c("candidates", "variant_candidates")) {
      return(purrr::map(values, chembl_records_table))
    }
    if (type == "list") values else unlist(values)
  })
  dplyr::as_tibble(columns)
}

# Matches every key the last pipeline run classifies (read from its data
# files) to ChEMBL and writes the committed matches file, keeping its
# reviews. `retrieved` is the oldest response used.
run_chembl_matching <- function(data_directory = "site/public/data",
                                cache_root =
                                  ".cache/downloads/chembl-molecules",
                                output_path = chembl_matches_path,
                                release = fetch_chembl_release(),
                                budget = chembl_default_budget,
                                today = Sys.Date()) {
  tables <- read_site_tables(data_directory, c(
    "ema_medicines", "ema_medicine_substances",
    "ema_medicine_active_substances", "ema_medicine_atc_codes", "atc_classes"
  ))
  targets <- chembl_match_targets(tables)
  state <- chembl_state(file.path(cache_root, release), budget, today)
  rows <- purrr::map(seq_len(nrow(targets)), function(index) {
    match_chembl_key(as.list(targets[index, ]) |>
                       purrr::map_if(is.list, function(x) x[[1]]),
                     state, release)
  })
  matches <- chembl_rows_table(rows)
  is_salt <- !is.na(matches$parent_chembl_id) &
    matches$parent_chembl_id != matches$molecule_chembl_id
  parents <- chembl_parents(
    sort(unique(matches$parent_chembl_id[is_salt])),
    state
  )
  matches <- matches |>
    dplyr::select(-"parent_pref_name", -"parent_molecule_type") |>
    dplyr::left_join(
      dplyr::filter(parents, .data$parent_chembl_id %in%
                      matches$parent_chembl_id[is_salt]),
      by = "parent_chembl_id",
      relationship = "many-to-one"
    ) |>
    dplyr::mutate(
      parent_pref_name = dplyr::if_else(
        is_salt, .data$parent_pref_name, NA_character_
      ),
      parent_molecule_type = dplyr::if_else(
        is_salt, .data$parent_molecule_type, NA_character_
      ),
      retrieved = format(min(c(state$retrieved, state$today)))
    ) |>
    dplyr::select(dplyr::all_of(names(chembl_match_columns)))
  if (file.exists(output_path)) {
    matches <- carry_chembl_reviews(matches, read_chembl_matches(output_path))
  }
  dir.create(dirname(output_path), recursive = TRUE, showWarnings = FALSE)
  write_json_table(matches, output_path)
  cli::cli_alert_success(sprintf(
    paste(
      "ChEMBL (%s): %d requests; %d of %d keys matched (%d via an",
      "alternate name), %d ambiguous, %d with variant candidates; written",
      "to %s."
    ),
    release,
    state$requests,
    sum(!is.na(matches$molecule_chembl_id)),
    nrow(matches),
    sum(!matches$match_method %in% c(NA, "pref_name", "synonym")),
    sum(!is.na(matches$ambiguity)),
    sum(lengths(matches$variant_candidates) > 0),
    output_path
  ))
  invisible(matches)
}
