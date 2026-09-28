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

# Per medicine: EMA's holder, the Union Register's when it decides, and the
# one used; the country from the register's holder address. The register
# decides (user decision 2026-09-28) when it names another company (a
# transfer or rename EMA's field does not show yet; a spelling of the same
# company, even a misspelt one, is not) and lists the product as Active: a
# product no longer active can name an older holder (Ecokinase: Galenus
# Mannheim, before Roche). Without an EMA holder, the register's name is the
# only one (Zabdeno), whatever its status. The country is left out where
# the register names another company that does not decide.
build_medicine_holders <- function(medicines,
                                   register,
                                   aliases = curated_company_aliases()) {
  register_holders <- link_register_products(medicines, register) |>
    dplyr::inner_join(
      dplyr::select(
        register$products,
        "uri",
        "holder_name",
        "holder_country",
        register_status = "status"
      ),
      by = "uri",
      relationship = "many-to-one"
    ) |>
    dplyr::select(
      "ema_product_number",
      "holder_name",
      "holder_country",
      "register_status"
    ) |>
    dplyr::mutate(
      register_name_is_address = is_register_address(.data$holder_name),
      holder_name = dplyr::if_else(
        .data$register_name_is_address,
        NA_character_,
        .data$holder_name
      ),
      register_active = is_register_authorised(.data$register_status)
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
      register_names_other = !is.na(.data$holder_name) &
        !(aliased_company_key(.data$holder_name, aliases) ==
            aliased_company_key(.data$holder_ema, aliases)) %in% TRUE,
      register_decides = .data$register_names_other &
        (.data$register_active %in% TRUE | is.na(.data$holder_ema)),
      holder_register = dplyr::if_else(
        .data$register_decides,
        .data$holder_name,
        NA_character_
      ),
      holder_used = dplyr::coalesce(.data$holder_register, .data$holder_ema),
      holder_basis = dplyr::case_when(
        !is.na(.data$holder_register) ~ "register",
        !is.na(.data$holder_ema) ~ "ema",
        .default = NA_character_
      ),
      register_not_active = .data$register_names_other &
        !.data$register_decides,
      holder_country = dplyr::if_else(
        .data$register_not_active,
        NA_character_,
        .data$holder_country
      )
    ) |>
    dplyr::select(
      "ema_product_number",
      "holder_ema",
      "holder_register",
      "holder_used",
      "holder_basis",
      country = "holder_country",
      "register_name_is_address",
      "register_not_active"
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

# Per-medicine group rows whose holder still holds the medicine (checked
# against the holder used, the register's where it decides, as sponsor rows
# are: never against a sponsor) and that move it out of its company's group.
# The others are listed: stale (another holder) or redundant (the company's
# own group, e.g. once the holder became a member of the row's group).
judge_medicine_groups <- function(medicine_groups,
                                  assigned,
                                  companies,
                                  aliases) {
  judged <- medicine_groups |>
    dplyr::left_join(
      dplyr::select(
        assigned,
        "ema_product_number",
        "holder_used",
        "company_match"
      ),
      by = "ema_product_number",
      relationship = "one-to-one"
    ) |>
    dplyr::left_join(
      dplyr::select(
        companies,
        "company_match",
        company_group_key = "group_key"
      ),
      by = "company_match",
      relationship = "many-to-one"
    ) |>
    dplyr::mutate(
      holds = (aliased_company_key(.data$holder, aliases) ==
                 aliased_company_key(.data$holder_used, aliases)) %in% TRUE,
      redundant = .data$holds &
        (.data$group_key == .data$company_group_key) %in% TRUE
    )
  list(
    applied = dplyr::filter(judged, .data$holds, !.data$redundant),
    stale = dplyr::filter(judged, !.data$holds),
    redundant = dplyr::filter(judged, .data$redundant)
  )
}

# The company of each medicine: its holder's, or a reviewed sponsor's (with
# the sponsor row's note and evidence, and, for a sponsor renamed since, the
# rename's evidence: its note names the sponsor as it was then).
assign_medicine_companies <- function(medicine_holders, sponsors, aliases) {
  renames <- dplyr::filter(aliases, !is.na(.data$evidence_url))
  rename_evidence_urls <- stats::setNames(
    renames$evidence_url,
    company_match_key(renames$holder)
  )
  medicine_holders |>
    dplyr::left_join(
      dplyr::select(
        sponsors,
        "ema_product_number",
        "sponsor",
        sponsor_note = "note",
        sponsor_evidence_url = "evidence_url"
      ),
      by = "ema_product_number",
      relationship = "one-to-one"
    ) |>
    dplyr::mutate(
      holder_basis = dplyr::if_else(
        is.na(.data$sponsor),
        .data$holder_basis,
        "curated_sponsor"
      ),
      sponsor_rename_evidence_url = unname(
        rename_evidence_urls[company_match_key(.data$sponsor)]
      ),
      company_name = dplyr::coalesce(.data$sponsor, .data$holder_used),
      company_match = aliased_company_key(.data$company_name, aliases),
      # Whether EMA's and the used holder name name the medicine's company.
      ema_is_own = (aliased_company_key(.data$holder_ema, aliases) ==
                      .data$company_match) %in% TRUE,
      used_is_own = (aliased_company_key(.data$holder_used, aliases) ==
                       .data$company_match) %in% TRUE
    )
}

# The group of each medicine: its company's, or a per-medicine row's (the
# business went to another owner than the holder's, with the row's note and
# evidence); `source` says which.
assign_medicine_groups <- function(assigned, companies, medicine_groups) {
  assigned |>
    dplyr::left_join(
      dplyr::select(
        companies,
        "company_match",
        company_key = "key",
        company_group_key = "group_key",
        company_group_source = "group_source"
      ),
      by = "company_match",
      relationship = "many-to-one"
    ) |>
    dplyr::left_join(
      dplyr::select(
        medicine_groups,
        "ema_product_number",
        medicine_group_key = "group_key",
        group_note = "note",
        group_evidence_url = "evidence_url"
      ),
      by = "ema_product_number",
      relationship = "one-to-one"
    ) |>
    dplyr::mutate(
      group_key = dplyr::coalesce(
        .data$medicine_group_key,
        .data$company_group_key
      ),
      source = dplyr::if_else(
        is.na(.data$medicine_group_key),
        .data$company_group_source,
        "curated_medicine"
      )
    )
}

# A curated note about a medicine's later ownership fills its group note
# without moving it (`source` unchanged); check_curated_medicine_notes()
# keeps it apart from per-medicine group rows.
add_medicine_notes <- function(assigned, medicine_notes) {
  assigned |>
    dplyr::left_join(
      dplyr::select(
        medicine_notes,
        "ema_product_number",
        medicine_note = "note",
        medicine_note_url = "evidence_url"
      ),
      by = "ema_product_number",
      relationship = "one-to-one"
    ) |>
    dplyr::mutate(
      group_note = dplyr::coalesce(.data$group_note, .data$medicine_note),
      group_evidence_url = dplyr::coalesce(
        .data$group_evidence_url,
        .data$medicine_note_url
      )
    ) |>
    dplyr::select(-"medicine_note", -"medicine_note_url")
}

# A company none of whose medicines stays in its group (each moved by a
# per-medicine row: Sanofi Pharma Bristol-Myers Squibb's DuoPlavin) joins
# the group of most of them, so its own group is not left empty.
regroup_moved_companies <- function(companies, assigned) {
  moved <- assigned |>
    dplyr::filter(!is.na(.data$company_match)) |>
    dplyr::filter(
      !any(.data$group_key == .data$company_group_key),
      .by = "company_match"
    ) |>
    dplyr::count(.data$company_match, .data$group_key) |>
    dplyr::arrange(
      .data$company_match,
      dplyr::desc(.data$n),
      .data$group_key
    ) |>
    dplyr::distinct(.data$company_match, .keep_all = TRUE) |>
    dplyr::select("company_match", moved_group_key = "group_key")
  companies |>
    dplyr::left_join(
      moved,
      by = "company_match",
      relationship = "one-to-one"
    ) |>
    dplyr::mutate(
      group_source = dplyr::if_else(
        is.na(.data$moved_group_key),
        .data$group_source,
        "curated_medicine"
      ),
      group_key = dplyr::coalesce(.data$moved_group_key, .data$group_key)
    ) |>
    dplyr::select(-"moved_group_key")
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
      is_alias = company_match_key(.data$name) != .data$company_match |
        company_base_name(.data$name) %in% company_base_name(aliases$holder)
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
# Curated monograms can be a full ticker ("ABBV"; user decision 2026-09-28:
# "4-letter badges are ok"); derived ones stay at 3 characters.
monogram_pattern <- "^[A-Z0-9]{1,4}$"
derived_monogram_pattern <- "^[A-Z0-9]{1,3}$"

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
      "monograms are not 1-4 unique capitals or digits",
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
    c(
      curated$members$group_key,
      stats::na.omit(curated$sponsors$sponsor_group_key),
      curated$medicine_groups$group_key
    ),
    groups$group_key
  )
  if (length(unknown_groups) > 0) {
    abort_curated_companies("members of unknown groups", unknown_groups)
  }
  # An alias whose target has the same key only fixes a spelling (EMA's
  # "Umited"): it moves no name, so it is no link of a chain.
  alias_keys <- company_match_key(curated$aliases$holder)
  target_keys <- company_match_key(curated$aliases$company_holder)
  chained <- intersect(alias_keys[alias_keys != target_keys], target_keys)
  if (length(chained) > 0) {
    abort_curated_companies("aliases point to aliases", chained)
  }
  check_curated_members(curated$members)
  check_curated_aliases(curated$aliases)
  check_curated_sponsors(curated$sponsors)
  check_curated_medicine_groups(curated$medicine_groups)
  check_curated_medicine_notes(
    curated$medicine_notes,
    curated$medicine_groups
  )
  invisible(curated)
}

# A member's ownership note ships in companies.json with its evidence URL.
check_curated_members <- function(members) {
  has_note <- !is.na(members$note)
  is_invalid <- has_note != !is.na(members$evidence_url) |
    (has_note & !grepl("^https://", members$evidence_url))
  if (any(is_invalid)) {
    abort_curated_companies(
      "member notes need an https evidence URL, and evidence URLs a note",
      members$holder[is_invalid]
    )
  }
  invisible(members)
}

# Renames carry evidence (curated_sponsor_renames()); other aliases may not.
check_curated_aliases <- function(aliases) {
  check_table_columns(aliases, curated_company_aliases(), "alias")
  with_evidence <- !is.na(aliases$evidence_url) |
    !is.na(aliases$evidence_quote) |
    !is.na(aliases$checked_date)
  is_invalid <- with_evidence & !has_evidence(aliases)
  if (any(is_invalid)) {
    abort_curated_companies(
      paste(
        "alias evidence needs an https URL, a quote of at most 20 words and",
        "a checked date"
      ),
      aliases$holder[is_invalid]
    )
  }
  invisible(aliases)
}

check_curated_sponsors <- function(sponsors) {
  check_table_columns(sponsors, curated_medicine_sponsors(), "sponsor")
  is_invalid <- is.na(sponsors$ema_product_number) |
    duplicated(sponsors$ema_product_number) |
    is.na(sponsors$holder) |
    is.na(sponsors$sponsor) |
    is.na(sponsors$note) |
    !has_evidence(sponsors) |
    is.na(sponsors$reviewed)
  if (any(is_invalid)) {
    abort_curated_companies(
      paste(
        "sponsor rows need a unique product, holder, sponsor, note, https",
        "evidence, a quote of at most 20 words, a checked date and a review",
        "flag"
      ),
      sponsors$ema_product_number[is_invalid]
    )
  }
  invisible(sponsors)
}

check_curated_medicine_groups <- function(medicine_groups) {
  check_table_columns(
    medicine_groups,
    curated_medicine_groups(),
    "per-medicine group"
  )
  is_invalid <- is.na(medicine_groups$ema_product_number) |
    duplicated(medicine_groups$ema_product_number) |
    is.na(medicine_groups$holder) |
    is.na(medicine_groups$group_key) |
    is.na(medicine_groups$note) |
    !has_evidence(medicine_groups)
  if (any(is_invalid)) {
    abort_curated_companies(
      paste(
        "per-medicine group rows need a unique product, holder, group, note,",
        "https evidence, a quote of at most 20 words and a checked date"
      ),
      medicine_groups$ema_product_number[is_invalid]
    )
  }
  invisible(medicine_groups)
}

check_curated_medicine_notes <- function(medicine_notes, medicine_groups) {
  check_table_columns(medicine_notes, curated_medicine_notes(), "medicine note")
  is_invalid <- is.na(medicine_notes$ema_product_number) |
    duplicated(medicine_notes$ema_product_number) |
    is.na(medicine_notes$note) |
    !grepl("^https://", medicine_notes$evidence_url) |
    is.na(medicine_notes$checked_date)
  if (any(is_invalid)) {
    abort_curated_companies(
      paste(
        "medicine notes need a unique product, a note, an https evidence URL",
        "and a checked date"
      ),
      medicine_notes$ema_product_number[is_invalid]
    )
  }
  # Both fill the medicine's one group note.
  noted_twice <- intersect(
    medicine_notes$ema_product_number,
    medicine_groups$ema_product_number
  )
  if (length(noted_twice) > 0) {
    abort_curated_companies(
      "medicines with both a per-medicine group row and a note",
      noted_twice
    )
  }
  invisible(medicine_notes)
}

check_table_columns <- function(table, template, label) {
  expected <- names(template)
  if (!identical(names(table), expected)) {
    abort_curated_companies(
      paste("the", label, "table has other columns"),
      c(setdiff(names(table), expected), setdiff(expected, names(table)))
    )
  }
  invisible(table)
}

# An https evidence URL, a verbatim quote of at most 20 words and the date
# it was checked.
has_evidence <- function(rows) {
  quote_words <- lengths(
    strsplit(stringr::str_squish(rows$evidence_quote), " ")
  )
  grepl("^https://", rows$evidence_url) &
    !is.na(rows$evidence_quote) &
    quote_words <= 20 &
    !is.na(rows$checked_date)
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
  unique(candidate_list[grepl(derived_monogram_pattern, candidate_list)])
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
  medicine_groups <- judge_medicine_groups(
    curated$medicine_groups,
    assigned,
    companies,
    curated$aliases
  )
  assigned <- assign_medicine_groups(
    assigned,
    companies,
    medicine_groups$applied
  ) |>
    add_medicine_notes(curated$medicine_notes)
  companies <- regroup_moved_companies(companies, assigned)
  companies$sources <- company_sources(companies)
  groups <- build_group_rows(companies, assigned, curated, snapshot_date)
  medicine_companies <- assigned |>
    dplyr::select(
      "ema_product_number",
      "holder_ema",
      "holder_register",
      "holder_used",
      "holder_basis",
      "company_key",
      "group_key",
      "country",
      "source",
      "group_note",
      "group_evidence_url",
      "sponsor_note",
      "sponsor_evidence_url",
      "sponsor_rename_evidence_url"
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
    medicine_groups = medicine_groups$applied,
    medicine_groups_stale = medicine_groups$stale,
    medicine_groups_redundant = medicine_groups$redundant,
    medicine_notes_stale = setdiff(
      curated$medicine_notes$ema_product_number,
      medicine_holders$ema_product_number
    ),
    # All their companies moved to another group, or none is in the data.
    curated_groups_empty = setdiff(curated$groups$group_key, groups$key),
    gleif = judged_gleif,
    register_addresses = sum(medicine_holders$register_name_is_address),
    register_not_active = sum(medicine_holders$register_not_active %in% TRUE)
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
      companies$group_source %in% c("curated", "curated_medicine"),
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

company_source_order <- c("ema", "union_register", "curated", "gleif")

company_output_rows <- function(companies, snapshot_date) {
  companies |>
    dplyr::transmute(
      .data$key,
      kind = "company",
      .data$name,
      .data$group_key,
      monogram = NA_character_,
      monogram_source = NA_character_,
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
      ownership = list(empty_ownership()),
      .data$sources,
      as_of = snapshot_date
    )
}

empty_ownership <- function() {
  dplyr::tibble(
    holder = character(),
    note = character(),
    evidence_url = character()
  )
}

# Per group, the ownership changes behind it, by holder: each curated
# member with a note (an acquisition, rename or spin-off) whose company is in
# the group, and each alias with evidence (a renamed sponsor's old name:
# curated_sponsor_renames()) whose company is in the group, an own group too.
group_ownership <- function(companies, curated) {
  member_notes <- curated$members |>
    dplyr::filter(!is.na(.data$note)) |>
    dplyr::mutate(
      company_match = aliased_company_key(.data$holder, curated$aliases)
    ) |>
    dplyr::semi_join(
      companies,
      by = c("company_match", "group_key")
    )
  renames <- curated$aliases |>
    dplyr::filter(!is.na(.data$evidence_url)) |>
    dplyr::mutate(
      company_match = aliased_company_key(.data$holder, curated$aliases)
    ) |>
    dplyr::inner_join(
      dplyr::select(companies, "company_match", "group_key"),
      by = "company_match",
      relationship = "many-to-one"
    )
  note_columns <- c("group_key", "holder", "note", "evidence_url")
  notes <- dplyr::bind_rows(
    # A table without any note has logical NA columns.
    dplyr::mutate(
      dplyr::select(member_notes, dplyr::all_of(note_columns)),
      dplyr::across(dplyr::everything(), as.character)
    ),
    dplyr::select(renames, dplyr::all_of(note_columns))
  ) |>
    dplyr::distinct(.data$group_key, .data$holder, .keep_all = TRUE) |>
    dplyr::arrange(.data$group_key, .data$holder)
  dplyr::tibble(
    group_key = unique(notes$group_key),
    ownership = unname(split(
      dplyr::select(notes, "holder", "note", "evidence_url"),
      factor(notes$group_key, levels = unique(notes$group_key))
    ))
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

# Per group, from its medicines: the holder names of its member companies
# (`member_holders`) and EMA's names of its medicines that name another
# company (`original_holders`: a register or sponsor decided, or a
# per-medicine row moved the medicine here), its medicine count, sources
# and whether only representatives hold them.
group_members <- function(companies, assigned) {
  memberships <- companies |>
    dplyr::summarise(
      member_sources = list(unique(unlist(.data$sources))),
      representative = all(.data$representative),
      .by = "group_key"
    )
  assigned |>
    dplyr::filter(!is.na(.data$group_key)) |>
    dplyr::left_join(
      dplyr::select(companies, "company_match", member_group_key = "group_key"),
      by = "company_match",
      relationship = "many-to-one"
    ) |>
    dplyr::mutate(
      is_member = (.data$member_group_key == .data$group_key) %in% TRUE
    ) |>
    dplyr::summarise(
      member_holders = list(sort(unique(c(
        .data$holder_ema[.data$is_member & .data$ema_is_own],
        .data$holder_used[.data$is_member & .data$used_is_own]
      )))),
      ema_holders = list(unique(stats::na.omit(.data$holder_ema))),
      medicines = dplyr::n(),
      moved_in = any(.data$source == "curated_medicine"),
      .by = "group_key"
    ) |>
    dplyr::left_join(
      memberships,
      by = "group_key",
      relationship = "one-to-one"
    ) |>
    dplyr::mutate(
      original_holders = purrr::map2(
        .data$ema_holders,
        .data$member_holders,
        function(holders, members) sort(setdiff(holders, members))
      ),
      sources = purrr::map2(
        .data$member_sources,
        .data$moved_in,
        function(sources, moved_in) {
          present <- c("ema", sources, if (moved_in) "curated")
          intersect(company_source_order, present)
        }
      ),
      representative = .data$representative %in% TRUE
    ) |>
    dplyr::select(-"ema_holders", -"member_sources", -"moved_in")
}

# One row per group with medicines: the curated groups as curated, the rest
# named after their one company; each with its ownership changes.
build_group_rows <- function(companies, assigned, curated, snapshot_date) {
  members <- group_members(companies, assigned)
  curated_rows <- curated$groups |>
    dplyr::inner_join(members, by = "group_key", relationship = "one-to-one") |>
    dplyr::mutate(
      monogram_source = "curated",
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
      monogram_source = "derived",
      joint_venture = FALSE,
      partners = list(character()),
      other_partners = list(character()),
      as_of = snapshot_date
    )
  dplyr::bind_rows(curated_rows, own_rows) |>
    dplyr::left_join(
      group_ownership(companies, curated),
      by = "group_key",
      relationship = "one-to-one"
    ) |>
    dplyr::mutate(
      ownership = purrr::map(.data$ownership, function(rows) {
        if (is.null(rows)) empty_ownership() else rows
      }),
      # A curated group's LEI and legal name are GLEIF's too; ownership
      # notes are curated.
      sources = purrr::pmap(
        list(
          .data$sources,
          !is.na(.data$lei) | !is.na(.data$gleif_legal_name),
          purrr::map_int(.data$ownership, nrow) > 0
        ),
        function(sources, from_gleif, has_ownership) {
          present <- c(
            sources,
            if (has_ownership) "curated",
            if (from_gleif) "gleif"
          )
          intersect(company_source_order, present)
        }
      )
    ) |>
    dplyr::transmute(
      key = .data$group_key,
      kind = "group",
      .data$name,
      group_key = NA_character_,
      .data$monogram,
      .data$monogram_source,
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
      .data$ownership,
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
    abort_company_tables(
      "group monograms are not 1-4 unique capitals or digits",
      bad_monograms
    )
  }
  company_rows <- companies[companies$kind == "company", ]
  empty_groups <- setdiff(groups$key, medicines$group_key)
  if (length(empty_groups) > 0) {
    abort_company_tables("groups without members (medicines)", empty_groups)
  }
  missing_groups <- setdiff(
    c(
      company_rows$group_key,
      unlist(groups$partners),
      stats::na.omit(medicines$group_key)
    ),
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
  is_curated <- per_medicine$source %in%
    c("curated", "curated_medicine", "gleif")
  representative_companies <- companies$key[
    companies$kind == "company" & companies$representative
  ]
  # A curated sponsor can stand behind the register's holder (Zokinvy).
  register_decided <- sum(!is.na(per_medicine$holder_register))
  cli::cli_alert_info(sprintf(
    paste(
      "Companies: %d companies in %d groups (%d curated);",
      "curated groups hold %d of %d medicines with a holder",
      "(%d of %d Authorised); the Union Register decides the holder of %d",
      "%s."
    ),
    sum(companies$kind == "company"),
    nrow(groups),
    company_run$curated_groups,
    sum(is_curated),
    sum(!is.na(per_medicine$holder_used)),
    sum(is_curated & per_medicine$authorised),
    sum(!is.na(per_medicine$holder_used) & per_medicine$authorised),
    register_decided,
    ngettext(register_decided, "medicine", "medicines")
  ))
  if (company_run$register_not_active > 0) {
    cli::cli_alert_info(paste(
      "{company_run$register_not_active} Union Register holder{?s} of another",
      "company not used: the register does not list the product as Active."
    ))
  }
  report_medicine_groups(company_run, groups)
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
    company_run$sponsors_stale$ema_product_number,
    company_run$medicine_groups_stale$ema_product_number
  )
  if (length(stale) > 0) {
    cli::cli_alert_warning(
      "Curated company rows naming no current holder:
      {.val {offender_values(stale, max_shown = 20)}}"
    )
  }
  stale_notes <- company_run$medicine_notes_stale
  if (length(stale_notes) > 0) {
    cli::cli_alert_warning(
      "Curated medicine notes naming no medicine in the data:
      {.val {offender_values(stale_notes, max_shown = 20)}}"
    )
  }
  redundant <- company_run$medicine_groups_redundant$ema_product_number
  if (length(redundant) > 0) {
    cli::cli_alert_warning(
      "Per-medicine group rows naming the company's own group (not applied;
      drop them): {.val {offender_values(redundant, max_shown = 20)}}"
    )
  }
  empty_groups <- company_run$curated_groups_empty
  if (length(empty_groups) > 0) {
    cli::cli_alert_warning(
      "Curated groups without medicines (left out of companies.json):
      {.val {offender_values(empty_groups, max_shown = 20)}}"
    )
  }
  if (company_run$register_addresses > 0) {
    cli::cli_alert_warning(
      "{company_run$register_addresses} Union Register holder name{?s}
      {?is an address/are addresses}: EMA's holder used."
    )
  }
  report_live_joint_ventures(groups, per_medicine)
  invisible(company_run)
}

# The medicines a per-medicine row moved to another group than their
# holder's.
report_medicine_groups <- function(company_run, groups) {
  moved <- company_run$medicine_groups
  group_names <- stats::setNames(groups$name, groups$key)
  labels <- sprintf(
    "%s (%s) -> %s",
    moved$ema_product_number,
    moved$holder,
    unname(group_names[moved$group_key])
  )
  if (length(labels) == 0) {
    return(invisible(company_run))
  }
  cli::cli_alert_info(paste(
    "Per-medicine groups: {nrow(moved)} medicine{?s} moved to the current",
    "owner of {?its/their} business:",
    "{.val {offender_values(labels, max_shown = length(labels))}}"
  ))
  invisible(company_run)
}

# Joint ventures stay their own group only while they are live (user
# decision 2026-09-28): one holding no authorised medicine may have ended.
report_live_joint_ventures <- function(groups, per_medicine) {
  authorised_groups <- per_medicine$group_key[per_medicine$authorised %in% TRUE]
  ended <- groups$name[
    groups$joint_venture & !groups$key %in% authorised_groups
  ]
  if (length(ended) > 0) {
    cli::cli_alert_warning(paste(
      "Joint-venture groups without an authorised medicine (ended? map",
      "their medicines to the partners in {.fn curated_medicine_groups}):",
      "{.val {offender_values(ended, max_shown = length(ended))}}"
    ))
  }
  invisible(groups)
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
        ") curated by approval-atlas from company announcements and ",
        "filings, EMA documents, the Union Register and GLEIF"
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
