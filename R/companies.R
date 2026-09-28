# Holder names folded to companies (spelling and legal-entity variants of one
# company) and companies to groups (the current owner). Rules at the "k2"
# tier of the 2026-09-28 experiment: legal forms, punctuation, "and",
# diacritics, and place and role words. Generic words ("pharma",
# "healthcare") stay: stripping them broke names ("Pharma Mar" -> "mar").

# Trailing legal forms, as they read after folding (punctuation is a space).
company_legal_forms <- c(
  "gmbh and co kg", "gmbh co kg", "gmbh kg", "co kg", "kg", "gmbh", "mbh",
  "ag", "se", "b v", "bv", "n v", "nv", "s a s", "sas", "s a r l", "sarl",
  "s a", "sa", "s p a", "spa", "s r l", "srl", "s l u", "slu", "s l", "sl",
  "a s", "as", "ab", "publ", "oyj", "oy", "aps", "asa", "ehf", "kft", "zrt",
  "s r o", "sro", "d o o", "doo", "d d", "dd", "k s", "ks", "eeig", "eesv",
  "snc", "uc", "unlimited company", "designated activity company", "dac",
  "unipessoal lda", "lda", "sp z o o", "spolka akcyjna", "bvba", "sprl",
  "limited", "ltd", "umited", "llmited", "plc", "inc", "llc", "llp",
  "corporation", "corp", "company", "co", "ca", "companhia", "s u", "ets",
  "irl"
)

# Legal forms some names start with ("N.V. Organon").
company_leading_legal_forms <- "n v"

# Place and role words, dropped wherever they stand: they name a subsidiary
# of the same company ("Roche Registration", "Pfizer Europe MA",
# "Takeda ... Ireland Branch").
company_place_words <- c(
  "ireland", "irl", "ire", "nederland", "netherlands", "nl", "deutschland",
  "germany", "france", "uk", "u k", "united kingdom", "europe", "europa",
  "eu", "emea", "international", "internacional", "luxembourg", "belgium",
  "denmark", "spain", "portugal", "austria", "hungary", "sweden", "malta",
  "cyprus", "romania", "ceska republika", "novo mesto", "dungarvan",
  "boulogne billancourt", "jena", "ireland branch", "branch",
  "zweigniederlassung"
)

company_role_words <- c(
  "registration", "holdings", "holding", "group", "groupe",
  "trading services", "distribution", "services", "ma", "operations",
  "licensing", "manufacturing", "global"
)

# German umlauts spelled out, as EMA does in some names ("fuer",
# "Spezialpraeparate"); compatibility forms ("C\u00aa") as letters. stringi's
# Latin-ASCII transliteration is the same on every platform, unlike iconv's.
fold_company_characters <- function(name) {
  name |>
    stringi::stri_trans_nfkc() |>
    stringr::str_replace_all(c(
      "\u00e4" = "ae", "\u00f6" = "oe", "\u00fc" = "ue",
      "\u00c4" = "Ae", "\u00d6" = "Oe", "\u00dc" = "Ue", "\u00df" = "ss"
    )) |>
    stringi::stri_trans_general("Latin-ASCII") |>
    stringr::str_to_lower()
}

# Lower-case ASCII words: "&" and "+" read as "and", address tails ("c/o
# ...", "... at Fieldfisher LLP") and parenthesised parts ("(MIOL)",
# "(Netherlands)") dropped, punctuation a space.
company_base_name <- function(name) {
  name |>
    fold_company_characters() |>
    stringr::str_replace_all("[&+]", " and ") |>
    stringr::str_remove("\\b(c/o|at)\\b .*$") |>
    stringr::str_remove_all("\\([^()]*\\)") |>
    stringr::str_replace_all("[^a-z0-9]+", " ") |>
    stringr::str_squish()
}

# Removes `words` (longest first, repeatedly) at the end of each name, at its
# start, or anywhere; never a whole name.
strip_company_words <- function(name,
                                words,
                                position = c("end", "start", "anywhere")) {
  alternatives <- paste(words[order(-nchar(words))], collapse = "|")
  pattern <- switch(
    match.arg(position),
    end = paste0(" (?:", alternatives, ")$"),
    start = paste0("^(?:", alternatives, ") "),
    anywhere = paste0("(^| )(?:", alternatives, ")(?= |$)")
  )
  repeat {
    stripped <- stringr::str_squish(
      stringr::str_replace_all(name, pattern, " ")
    )
    stripped <- dplyr::if_else(stripped == "", name, stripped)
    if (identical(stripped, name)) {
      return(name)
    }
    name <- stripped
  }
}

# A folded name without its legal form ("merck sharp and dohme").
holder_base_words <- function(name) {
  name |>
    company_base_name() |>
    strip_company_words(company_legal_forms) |>
    strip_company_words(company_leading_legal_forms, position = "start")
}

# The words of a holder name that identify its company.
company_words <- function(name) {
  name |>
    holder_base_words() |>
    strip_company_words(
      c(company_place_words, company_role_words),
      position = "anywhere"
    ) |>
    strip_company_words(company_legal_forms) |>
    without_and()
}

# Names are squished, so words are separated by one space.
without_and <- function(words) {
  words |>
    stringr::str_remove_all("(^| )and(?= |$)") |>
    stringr::str_squish() |>
    dplyr::na_if("")
}

# Words to a key: "ue"/"ae"/"oe" read as the vowel ("fuer" and "fur"
# alike), spaces dropped ("Astra Zeneca" and "AstraZeneca" alike).
words_key <- function(words) {
  words |>
    stringr::str_replace_all(c("ue" = "u", "ae" = "a", "oe" = "o")) |>
    stringr::str_remove_all(" ")
}

# Id-safe slug of a holder name ("merck-sharp-dohme").
company_slug <- function(name) {
  stringr::str_replace_all(company_words(name), " ", "-")
}

# Two names with the same key are one company. The key is a function of
# the slug, so different keys never share a slug.
company_match_key <- function(name) {
  words_key(company_words(name))
}

# A register holder "name" that is an address ("Strawinskylaan 3051, 1077ZX
# Amsterdam, Nederland"): parts ending with a country.
is_register_address <- function(name) {
  grepl(",", name, fixed = TRUE) & !is.na(register_country(name))
}

# Per medicine: EMA's holder, the Union Register's when it names another
# company (a transfer or rename EMA's field does not show yet; a spelling
# of the same company, even a misspelt one, is not), and the one used; the
# country from the register's holder address.
build_medicine_holders <- function(medicines,
                                   register,
                                   aliases = curated_company_aliases()) {
  register_holders <- link_register_products(medicines, register) |>
    dplyr::inner_join(
      dplyr::select(register$products, "uri", "holder_name", "holder_country"),
      by = "uri",
      relationship = "many-to-one"
    ) |>
    dplyr::select("ema_product_number", "holder_name", "holder_country") |>
    dplyr::mutate(
      register_name_is_address = is_register_address(.data$holder_name),
      holder_name = dplyr::if_else(
        .data$register_name_is_address,
        NA_character_,
        .data$holder_name
      )
    )
  medicines |>
    dplyr::select(
      "ema_product_number",
      holder_ema = "marketing_authorisation_developer_applicant_holder"
    ) |>
    dplyr::left_join(
      register_holders,
      by = "ema_product_number",
      relationship = "one-to-one"
    ) |>
    dplyr::mutate(
      holder_register = dplyr::if_else(
        (aliased_company_key(.data$holder_name, aliases) ==
           aliased_company_key(.data$holder_ema, aliases)) %in% TRUE,
        NA_character_,
        .data$holder_name
      ),
      holder_used = dplyr::coalesce(.data$holder_register, .data$holder_ema),
      holder_basis = dplyr::case_when(
        !is.na(.data$holder_register) ~ "register",
        !is.na(.data$holder_ema) ~ "ema",
        .default = NA_character_
      )
    ) |>
    dplyr::select(
      "ema_product_number",
      "holder_ema",
      "holder_register",
      "holder_used",
      "holder_basis",
      country = "holder_country",
      "register_name_is_address"
    ) |>
    dplyr::mutate(
      register_name_is_address = .data$register_name_is_address %in% TRUE
    )
}

# Company keys of many names, computed once per distinct name; curated
# aliases map a key to another company's.
aliased_company_key <- function(name, aliases) {
  distinct_names <- unique(name)
  keys <- company_match_key(distinct_names)
  alias_keys <- stats::setNames(
    company_match_key(aliases$company_holder),
    company_match_key(aliases$holder)
  )
  keys <- dplyr::coalesce(unname(alias_keys[keys]), keys)
  keys[match(name, distinct_names)]
}

# Reviewed sponsor rows whose representative still holds the medicine;
# the others are listed as stale.
judge_medicine_sponsors <- function(sponsors, medicine_holders, aliases) {
  judged <- sponsors |>
    dplyr::filter(.data$reviewed) |>
    dplyr::left_join(
      dplyr::select(medicine_holders, "ema_product_number", "holder_used"),
      by = "ema_product_number",
      relationship = "one-to-one"
    ) |>
    dplyr::mutate(
      sponsor_holder_key = aliased_company_key(.data$holder, aliases),
      used_holder_key = aliased_company_key(.data$holder_used, aliases),
      applies = (.data$sponsor_holder_key == .data$used_holder_key) %in% TRUE
    )
  list(
    applied = dplyr::filter(judged, .data$applies),
    stale = dplyr::filter(judged, !.data$applies)
  )
}

# The company of each medicine: its holder's, or a reviewed sponsor's.
assign_medicine_companies <- function(medicine_holders, sponsors, aliases) {
  medicine_holders |>
    dplyr::left_join(
      dplyr::select(sponsors, "ema_product_number", "sponsor"),
      by = "ema_product_number",
      relationship = "one-to-one"
    ) |>
    dplyr::mutate(
      holder_basis = dplyr::if_else(
        is.na(.data$sponsor),
        .data$holder_basis,
        "curated_sponsor"
      ),
      company_name = dplyr::coalesce(.data$sponsor, .data$holder_used),
      company_match = aliased_company_key(.data$company_name, aliases)
    )
}

# A holder name without an address tail ("Kamada BioPharma Limited at
# Fieldfisher LLP"), as company_base_name() drops it from keys.
without_address_tail <- function(name) {
  stringr::str_remove(
    name,
    stringr::regex("\\s+(c/o|at)\\s.*$", ignore_case = TRUE)
  )
}

# One row per company: its display name (not a curated alias, which is a
# misspelling or an old name, while the alias's target or another spelling
# is at hand; then the spelling of most medicines, EMA's, the first
# alphabetically; without an address tail), key and holder names:
# `member_holders` fold or alias to the company, `original_holders` are
# EMA's names of its medicines that name another company (the register or a
# curated sponsor decided).
build_company_rows <- function(assigned, aliases, representatives) {
  alias_targets <- dplyr::tibble(
    ema_product_number = NA_character_,
    company_match = company_match_key(aliases$company_holder),
    name = aliases$company_holder,
    from_ema = FALSE
  )
  spellings <- dplyr::bind_rows(
    dplyr::transmute(
      assigned,
      .data$ema_product_number,
      .data$company_match,
      name = .data$company_name,
      from_ema = (.data$company_name == .data$holder_ema) %in% TRUE
    ),
    dplyr::transmute(
      assigned,
      .data$ema_product_number,
      .data$company_match,
      name = .data$holder_ema,
      from_ema = TRUE
    ),
    dplyr::filter(
      alias_targets,
      .data$company_match %in% assigned$company_match
    )
  ) |>
    dplyr::filter(!is.na(.data$company_match), !is.na(.data$name)) |>
    dplyr::filter(
      aliased_company_key(.data$name, aliases) == .data$company_match
    ) |>
    dplyr::summarise(
      spelling_medicines = dplyr::n_distinct(
        .data$ema_product_number,
        na.rm = TRUE
      ),
      from_ema = any(.data$from_ema),
      .by = c("company_match", "name")
    ) |>
    dplyr::mutate(
      is_alias = company_match_key(.data$name) != .data$company_match
    ) |>
    dplyr::arrange(
      .data$company_match,
      .data$is_alias,
      dplyr::desc(.data$spelling_medicines),
      dplyr::desc(.data$from_ema),
      .data$name
    ) |>
    dplyr::distinct(.data$company_match, .keep_all = TRUE) |>
    dplyr::transmute(
      .data$company_match,
      name = without_address_tail(.data$name)
    )
  representative_keys <- aliased_company_key(representatives$holder, aliases)

  assigned |>
    dplyr::filter(!is.na(.data$company_match)) |>
    dplyr::mutate(
      ema_is_own = (aliased_company_key(.data$holder_ema, aliases) ==
                      .data$company_match) %in% TRUE,
      used_is_own = (aliased_company_key(.data$holder_used, aliases) ==
                       .data$company_match) %in% TRUE
    ) |>
    dplyr::summarise(
      medicines = dplyr::n(),
      member_holders = list(sort(unique(c(
        .data$holder_ema[.data$ema_is_own],
        .data$holder_used[.data$used_is_own]
      )))),
      original_holders = list(sort(unique(stats::na.omit(
        .data$holder_ema[!.data$ema_is_own]
      )))),
      from_register = any(.data$holder_basis == "register"),
      from_sponsor = any(.data$holder_basis == "curated_sponsor"),
      .by = "company_match"
    ) |>
    dplyr::inner_join(
      spellings,
      by = "company_match",
      relationship = "one-to-one"
    ) |>
    dplyr::mutate(
      key = paste0("c.", company_slug(.data$name)),
      slug = company_slug(.data$name),
      representative = .data$company_match %in% representative_keys &
        !.data$from_sponsor
    )
}

abort_curated_companies <- function(problem, offenders) {
  cli::cli_abort(c(
    "Curated company data: {problem}.",
    x = "{.val {offender_values(offenders)}}"
  ))
}

company_key_pattern <- "^[cg]\\.[a-z0-9]+(-[a-z0-9]+)*$"
monogram_pattern <- "^[A-Z0-9]{1,3}$"

check_curated_companies <- function(curated) {
  groups <- curated$groups
  duplicated_keys <- groups$group_key[duplicated(groups$group_key)]
  if (length(duplicated_keys) > 0) {
    abort_curated_companies("group keys are not unique", duplicated_keys)
  }
  bad_keys <- groups$group_key[
    !grepl(company_key_pattern, groups$group_key) |
      !startsWith(groups$group_key, "g.")
  ]
  if (length(bad_keys) > 0) {
    abort_curated_companies("group keys are not g.<slug>", bad_keys)
  }
  bad_monograms <- groups$monogram[
    !grepl(monogram_pattern, groups$monogram) |
      duplicated(groups$monogram)
  ]
  if (length(bad_monograms) > 0) {
    abort_curated_companies(
      "monograms are not 1-3 unique capitals or digits",
      bad_monograms
    )
  }
  partners <- split_partners(groups$partners)
  unknown_partners <- setdiff(unlist(partners), groups$group_key)
  if (length(unknown_partners) > 0) {
    abort_curated_companies("unknown partner groups", unknown_partners)
  }
  partner_counts <- lengths(partners) +
    lengths(split_partners(groups$other_partners))
  lone_ventures <- groups$group_key[groups$joint_venture & partner_counts < 2]
  if (length(lone_ventures) > 0) {
    abort_curated_companies(
      "joint ventures need both partners (a group or another name)",
      lone_ventures
    )
  }
  unknown_groups <- setdiff(
    c(curated$members$group_key, stats::na.omit(
      curated$sponsors$sponsor_group_key
    )),
    groups$group_key
  )
  if (length(unknown_groups) > 0) {
    abort_curated_companies("members of unknown groups", unknown_groups)
  }
  chained <- intersect(
    company_match_key(curated$aliases$holder),
    company_match_key(curated$aliases$company_holder)
  )
  if (length(chained) > 0) {
    abort_curated_companies("aliases point to aliases", chained)
  }
  check_curated_sponsors(curated$sponsors)
  invisible(curated)
}

check_curated_sponsors <- function(sponsors) {
  expected <- names(curated_medicine_sponsors())
  if (!identical(names(sponsors), expected)) {
    abort_curated_companies(
      "the sponsor table has other columns",
      c(setdiff(names(sponsors), expected), setdiff(expected, names(sponsors)))
    )
  }
  quote_words <- lengths(
    strsplit(stringr::str_squish(sponsors$evidence_quote), " ")
  )
  is_invalid <- is.na(sponsors$ema_product_number) |
    duplicated(sponsors$ema_product_number) |
    is.na(sponsors$holder) |
    is.na(sponsors$sponsor) |
    !grepl("^https://", sponsors$evidence_url) |
    is.na(sponsors$evidence_quote) |
    quote_words > 20 |
    is.na(sponsors$checked_date) |
    is.na(sponsors$reviewed)
  if (any(is_invalid)) {
    abort_curated_companies(
      paste(
        "sponsor rows need a unique product, holder, sponsor, https evidence,",
        "a quote of at most 20 words, a checked date and a review flag"
      ),
      sponsors$ema_product_number[is_invalid]
    )
  }
  invisible(sponsors)
}

split_partners <- function(partners) {
  purrr::map(partners, function(value) {
    if (is.na(value)) character() else strsplit(value, ";", fixed = TRUE)[[1]]
  })
}

# Company key -> curated group key, from the members and applied sponsors;
# a company in two groups stops the build.
curated_memberships <- function(curated, applied_sponsors) {
  memberships <- dplyr::bind_rows(
    dplyr::transmute(
      curated$members,
      company_match = aliased_company_key(.data$holder, curated$aliases),
      .data$group_key
    ),
    applied_sponsors |>
      dplyr::filter(!is.na(.data$sponsor_group_key)) |>
      dplyr::transmute(
        company_match = aliased_company_key(.data$sponsor, curated$aliases),
        group_key = .data$sponsor_group_key
      )
  ) |>
    dplyr::distinct()
  in_two_groups <- memberships$company_match[
    duplicated(memberships$company_match)
  ]
  if (length(in_two_groups) > 0) {
    abort_curated_companies("companies in two groups", in_two_groups)
  }
  memberships
}

# Monograms for groups without a curated one: initials, then the first
# letters, then any free combination starting with the first letter;
# `taken` monograms and the blocklist are never used.
derive_monograms <- function(names, taken) {
  taken <- c(taken, monogram_blocklist)
  monograms <- character(length(names))
  for (index in seq_along(names)) {
    candidate_list <- monogram_candidates(names[[index]])
    free <- setdiff(candidate_list, taken)
    monograms[[index]] <- if (length(free) > 0) {
      free[[1]]
    } else {
      first_free_monogram(substr(candidate_list[[1]], 1, 1), taken)
    }
    taken <- c(taken, monograms[[index]])
  }
  monograms
}

# Words that name no brand ("Laboratorios Lorien": "LO", not "LAB").
monogram_skipped_words <- c(
  "the", "les", "laboratoires", "laboratoire", "laboratorios", "laboratori",
  "laboratories", "pharma", "bio"
)

monogram_candidates <- function(name) {
  words <- company_words(name) |>
    dplyr::coalesce("") |>
    strsplit(" ", fixed = TRUE) |>
    unlist()
  words <- words[words != ""]
  branded <- words[!words %in% monogram_skipped_words]
  words <- toupper(if (length(branded) > 0) branded else words)
  if (length(words) == 0) {
    words <- "X"
  }
  letters_in_order <- strsplit(paste(words, collapse = ""), "")[[1]]
  first <- letters_in_order[[1]]
  rest <- letters_in_order[-1]
  initials <- paste(substr(words[seq_len(min(3, length(words)))], 1, 1),
                    collapse = "")
  candidate_list <- c(
    if (length(words) >= 2) initials,
    substr(words[[1]], 1, 2),
    substr(words[[1]], 1, 3),
    paste0(first, rest),
    if (length(rest) >= 2) {
      pairs <- utils::combn(rest, 2)
      paste0(first, pairs[1, ], pairs[2, ])
    }
  )
  unique(candidate_list[grepl(monogram_pattern, candidate_list)])
}

first_free_monogram <- function(first, taken) {
  characters <- c(LETTERS, 0:9)
  for (length_after in 1:2) {
    endings <- if (length_after == 1) {
      characters
    } else {
      as.vector(outer(characters, characters, paste0))
    }
    free <- setdiff(paste0(first, endings), taken)
    if (length(free) > 0) {
      return(free[[1]])
    }
  }
  cli::cli_abort("No free monogram starting with {.val {first}}.")
}

# The company tables: one row per medicine (ema_medicine_companies) and one
# per company and group (companies), plus what the run summary reports.
build_company_tables <- function(medicine_holders,
                                 gleif_matches,
                                 snapshot_date,
                                 curated = curated_company_data()) {
  check_curated_companies(curated)
  sponsors <- judge_medicine_sponsors(
    curated$sponsors,
    medicine_holders,
    curated$aliases
  )
  assigned <- assign_medicine_companies(
    medicine_holders,
    sponsors$applied,
    curated$aliases
  )
  companies <- build_company_rows(
    assigned,
    curated$aliases,
    curated$representatives
  )
  memberships <- curated_memberships(curated, sponsors$applied)
  judged_gleif <- judge_gleif_matches(
    gleif_matches,
    companies$company_match,
    curated$groups,
    memberships,
    curated$aliases
  )
  companies <- companies |>
    dplyr::left_join(
      memberships,
      by = "company_match",
      relationship = "one-to-one"
    ) |>
    dplyr::left_join(
      applied_gleif_matches(judged_gleif, curated$groups),
      by = "company_match",
      relationship = "one-to-one"
    ) |>
    dplyr::mutate(
      group_source = dplyr::case_when(
        !is.na(.data$group_key) ~ "curated",
        !is.na(.data$gleif_group_key) & !.data$representative ~ "gleif",
        .default = "holder_name"
      ),
      group_key = dplyr::case_when(
        .data$group_source == "curated" ~ .data$group_key,
        .data$group_source == "gleif" ~ .data$gleif_group_key,
        .default = paste0("g.", .data$slug)
      )
    )
  check_own_group_keys(companies, assigned, curated$groups)
  companies$sources <- company_sources(companies)
  groups <- build_group_rows(companies, curated, snapshot_date)
  medicine_companies <- assigned |>
    dplyr::left_join(
      dplyr::select(
        companies,
        "company_match",
        company_key = "key",
        "group_key",
        source = "group_source"
      ),
      by = "company_match",
      relationship = "many-to-one"
    ) |>
    dplyr::select(
      "ema_product_number",
      "holder_ema",
      "holder_register",
      "holder_used",
      "holder_basis",
      "company_key",
      "group_key",
      "country",
      "source"
    ) |>
    dplyr::arrange(.data$ema_product_number)
  tables <- list(
    ema_medicine_companies = medicine_companies,
    companies = dplyr::bind_rows(
      company_output_rows(companies, snapshot_date),
      groups
    ) |>
      dplyr::arrange(.data$key)
  )
  check_company_tables(tables)
  list(
    tables = tables,
    curated_groups = sum(groups$key %in% curated$groups$group_key),
    curated_stale = stale_curated_rows(curated, companies$company_match),
    sponsors_stale = sponsors$stale,
    gleif = judged_gleif,
    register_addresses = sum(medicine_holders$register_name_is_address)
  )
}

# A company that is not a curated group's member but whose own group key
# would be one ("Celltrion, Inc." -> g.celltrion): a new holder name for a
# curated group, or another company; either way a person decides.
check_own_group_keys <- function(companies, assigned, groups) {
  clashing <- companies |>
    dplyr::filter(
      .data$group_source == "holder_name",
      .data$group_key %in% groups$group_key
    )
  if (nrow(clashing) == 0) {
    return(invisible(companies))
  }
  labels <- purrr::map_chr(seq_len(nrow(clashing)), function(index) {
    products <- assigned$ema_product_number[
      assigned$company_match %in% clashing$company_match[[index]]
    ]
    paste0(
      clashing$name[[index]], " (", clashing$group_key[[index]], "): ",
      paste(sort(products), collapse = ", ")
    )
  })
  abort_own_group_keys(labels)
}

abort_own_group_keys <- function(offenders) {
  cli::cli_abort(c(
    "Holders that are not curated members would take a curated group's key.",
    x = "{.val {offender_values(offenders)}}",
    i = paste(
      "Add each to {.fn curated_group_members} (the same company group) or",
      "to {.fn curated_company_aliases} (a spelling of a member), or give the",
      "curated group another key."
    )
  ))
}

company_sources <- function(companies) {
  purrr::pmap(
    list(
      companies$from_register,
      companies$from_sponsor,
      companies$group_source == "curated",
      !is.na(companies$lei)
    ),
    function(from_register, from_sponsor, curated_group, has_lei) {
      c(
        "ema",
        if (from_register) "union_register",
        if (from_sponsor || curated_group) "curated",
        if (has_lei) "gleif"
      )
    }
  )
}

company_output_rows <- function(companies, snapshot_date) {
  companies |>
    dplyr::transmute(
      .data$key,
      kind = "company",
      .data$name,
      .data$group_key,
      monogram = NA_character_,
      joint_venture = FALSE,
      partners = list(character()),
      other_partners = list(character()),
      .data$representative,
      .data$lei,
      .data$gleif_legal_name,
      .data$gleif_ultimate_parent,
      .data$gleif_ultimate_parent_lei,
      .data$member_holders,
      .data$original_holders,
      .data$sources,
      as_of = snapshot_date
    )
}

# Derived monograms avoid words and codes that read as something else
# ("US", "EU", "THE", "SOB") and the first letters of curated groups' names
# ("NOV" next to Novartis's "NVS").
monogram_blocklist <- c(
  "EU", "EC", "EMA", "UN", "US", "USA", "UK", "GB", "WHO",
  "THE", "AND", "LAB", "BIO", "SOB", "ASS", "SEX"
)

reserved_monograms <- function(curated_names) {
  letters_only <- toupper(gsub("[^A-Za-z]", "", fold_company_characters(
    curated_names
  )))
  c(monogram_blocklist, substr(letters_only, 1, 3))
}

# One row per group with members: the curated groups as curated, the rest
# named after their one company.
build_group_rows <- function(companies, curated, snapshot_date) {
  members <- companies |>
    dplyr::summarise(
      member_holders = list(sort(unique(as.character(
        unlist(.data$member_holders)
      )))),
      original_holders = list(sort(as.character(setdiff(
        unlist(.data$original_holders),
        unlist(.data$member_holders)
      )))),
      medicines = sum(.data$medicines),
      companies = dplyr::n(),
      sources = list(unique(unlist(.data$sources))),
      representative = all(.data$representative),
      .by = "group_key"
    )
  curated_rows <- curated$groups |>
    dplyr::inner_join(members, by = "group_key", relationship = "one-to-one") |>
    dplyr::mutate(
      partners = split_partners(.data$partners),
      other_partners = split_partners(.data$other_partners),
      as_of = curated$as_of
    )
  own_rows <- companies |>
    dplyr::filter(.data$group_source == "holder_name") |>
    dplyr::select(
      "group_key",
      "name",
      "lei",
      "gleif_legal_name",
      "gleif_ultimate_parent_lei",
      "gleif_ultimate_parent"
    ) |>
    dplyr::inner_join(members, by = "group_key", relationship = "one-to-one") |>
    dplyr::arrange(dplyr::desc(.data$medicines), .data$group_key) |>
    dplyr::mutate(
      monogram = derive_monograms(
        .data$name,
        c(curated$groups$monogram, reserved_monograms(curated$groups$name))
      ),
      joint_venture = FALSE,
      partners = list(character()),
      other_partners = list(character()),
      as_of = snapshot_date
    )
  dplyr::bind_rows(curated_rows, own_rows) |>
    dplyr::transmute(
      key = .data$group_key,
      kind = "group",
      .data$name,
      group_key = NA_character_,
      .data$monogram,
      .data$joint_venture,
      .data$partners,
      .data$other_partners,
      .data$representative,
      .data$lei,
      .data$gleif_legal_name,
      .data$gleif_ultimate_parent,
      .data$gleif_ultimate_parent_lei,
      .data$member_holders,
      .data$original_holders,
      .data$sources,
      .data$as_of
    )
}

abort_company_tables <- function(problem, offenders) {
  cli::cli_abort(c(
    "Company tables: {problem}.",
    x = "{.val {offender_values(offenders)}}"
  ))
}

check_company_tables <- function(tables) {
  medicines <- tables$ema_medicine_companies
  companies <- tables$companies
  unmapped <- medicines$ema_product_number[
    !is.na(medicines$holder_used) &
      (is.na(medicines$company_key) | is.na(medicines$group_key))
  ]
  if (length(unmapped) > 0) {
    abort_company_tables("medicines without a company or group", unmapped)
  }
  duplicated_keys <- companies$key[duplicated(companies$key)]
  if (length(duplicated_keys) > 0) {
    abort_company_tables("keys are not unique", duplicated_keys)
  }
  unsafe_keys <- companies$key[!grepl(company_key_pattern, companies$key)]
  if (length(unsafe_keys) > 0) {
    abort_company_tables("keys are not id-safe slugs", unsafe_keys)
  }
  groups <- companies[companies$kind == "group", ]
  bad_monograms <- groups$monogram[
    !grepl(monogram_pattern, groups$monogram) | duplicated(groups$monogram)
  ]
  if (length(bad_monograms) > 0) {
    abort_company_tables("group monograms are not unique", bad_monograms)
  }
  company_rows <- companies[companies$kind == "company", ]
  empty_groups <- setdiff(groups$key, company_rows$group_key)
  if (length(empty_groups) > 0) {
    abort_company_tables("groups without members", empty_groups)
  }
  missing_groups <- setdiff(
    c(company_rows$group_key, unlist(groups$partners)),
    groups$key
  )
  if (length(missing_groups) > 0) {
    abort_company_tables("unknown groups", missing_groups)
  }
  missing_companies <- setdiff(medicines$company_key, c(company_rows$key, NA))
  if (length(missing_companies) > 0) {
    abort_company_tables("unknown companies", missing_companies)
  }
  # Holder names and keys share the frontend's holder filter.
  key_like_holders <- grep(
    "^[cg]\\.",
    unlist(companies$member_holders),
    value = TRUE
  )
  if (length(key_like_holders) > 0) {
    abort_company_tables("holder names look like keys", key_like_holders)
  }
  # ... and each holder name names one company.
  company_holders <- unlist(company_rows$member_holders)
  shared_holders <- company_holders[duplicated(company_holders)]
  if (length(shared_holders) > 0) {
    abort_company_tables("holder names in two companies", shared_holders)
  }
  invisible(tables)
}

# Curated group members and aliases naming no current company (the data
# changed). The representatives are a list of firms, current or not.
stale_curated_rows <- function(curated, company_keys) {
  holders <- c(curated$members$holder, curated$aliases$holder)
  holders[!aliased_company_key(holders, curated$aliases) %in% company_keys]
}

report_company_summary <- function(company_run, medicines) {
  tables <- company_run$tables
  companies <- tables$companies
  groups <- companies[companies$kind == "group", ]
  per_medicine <- tables$ema_medicine_companies |>
    dplyr::left_join(
      dplyr::select(medicines, "ema_product_number", "medicine_status"),
      by = "ema_product_number",
      relationship = "one-to-one"
    ) |>
    dplyr::mutate(authorised = .data$medicine_status == "Authorised")
  is_curated <- per_medicine$source %in% c("curated", "gleif")
  representative_companies <- companies$key[
    companies$kind == "company" & companies$representative
  ]
  cli::cli_alert_info(sprintf(
    paste(
      "Companies: %d companies in %d groups (%d curated);",
      "curated groups hold %d of %d medicines with a holder",
      "(%d of %d Authorised); %d holders decided by the Union Register."
    ),
    sum(companies$kind == "company"),
    nrow(groups),
    company_run$curated_groups,
    sum(is_curated),
    sum(!is.na(per_medicine$holder_used)),
    sum(is_curated & per_medicine$authorised),
    sum(!is.na(per_medicine$holder_used) & per_medicine$authorised),
    sum(per_medicine$holder_basis %in% "register")
  ))
  cli::cli_alert_info(sprintf(
    paste(
      "Representatives: %d medicines resolved to a sponsor,",
      "%d held via a regulatory representative."
    ),
    sum(per_medicine$holder_basis %in% "curated_sponsor"),
    sum(per_medicine$company_key %in% representative_companies)
  ))
  gleif <- company_run$gleif
  cli::cli_alert_info(sprintf(
    paste(
      "GLEIF: %d matches applied, %d contradict the curated groups,",
      "%d for review."
    ),
    sum(gleif$applied),
    sum(gleif$is_confident & gleif$contradicts),
    sum(!gleif$is_confident)
  ))
  contradicting <- gleif$holder[gleif$is_confident & gleif$contradicts]
  if (length(contradicting) > 0) {
    cli::cli_alert_warning(
      "GLEIF matches not applied (their parent is another group):
      {.val {offender_values(contradicting, max_shown = 20)}}"
    )
  }
  stale <- c(
    company_run$curated_stale,
    company_run$sponsors_stale$ema_product_number
  )
  if (length(stale) > 0) {
    cli::cli_alert_warning(
      "Curated company rows naming no current holder:
      {.val {offender_values(stale, max_shown = 20)}}"
    )
  }
  if (company_run$register_addresses > 0) {
    cli::cli_alert_warning(
      "{company_run$register_addresses} Union Register holder name{?s}
      {?is an address/are addresses}: EMA's holder used."
    )
  }
  invisible(company_run)
}

# meta.json entries for the company data: the register's holders, the
# GLEIF matches (none before the first run) and the curated groups.
company_source_entries <- function(register_source, gleif_matches) {
  purrr::compact(list(
    list(
      name = paste(
        "Union Register of medicinal products (European Commission):",
        "marketing authorisation holders"
      ),
      url = register_source$url,
      version = register_source$last_modified,
      retrieved = substr(register_source$retrieved, 1, 10),
      licence = "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)",
      attribution = paste(
        "© European Union, Union Register of medicinal products, CC BY 4.0;",
        "holder names and the country of their address (addresses are not",
        "stored); changes made"
      )
    ),
    gleif_source_entry(gleif_matches),
    list(
      name = "Company groups (curated by approval-atlas)",
      url = paste0(
        "https://github.com/vrognas/approval-atlas/blob/main/",
        "R/curated-companies.R"
      ),
      version = paste("As of", format(curated_companies_as_of)),
      retrieved = format(curated_companies_as_of),
      licence = paste(
        "CC BY-SA 4.0",
        "(https://creativecommons.org/licenses/by-sa/4.0/)"
      ),
      attribution = paste0(
        "Company groups (current owner as of ",
        format(curated_companies_as_of),
        ") curated by approval-atlas from company announcements, the Union ",
        "Register and GLEIF"
      )
    )
  ))
}

gleif_source_entry <- function(gleif_matches) {
  if (nrow(gleif_matches) == 0) {
    return(NULL)
  }
  # The oldest response any match rests on.
  retrieved <- min(gleif_matches$retrieved)
  list(
    name = "GLEIF Legal Entity Identifier (LEI) records",
    url = paste0(gleif_api_url, "lei-records"),
    version = paste("LEI records as of", retrieved),
    retrieved = retrieved,
    licence = "CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/)",
    attribution = paste(
      "Contains LEI data from the Global Legal Entity Identifier Foundation",
      "(GLEIF), CC0, matched to holder names by approval-atlas; GLEIF does",
      "not provide or endorse this site."
    )
  )
}
