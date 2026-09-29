# Modality (M2 phase 2): what kind of medicine each active substance is,
# as a two-level taxonomy (group > modality). Every value names its source
# and rule; what no source states stays "not classified", never guessed.
# Sources by tier (highest first; .remember/modality/modality-spec.md):
# T0 curated rows (R/curated-modalities.R); T1 a radionuclide in the name;
# T2 ATC V09/V10; T3 definitive WHO INN stems, INN group names, EMA's ATMP
# flag (group only) and "mRNA" in EMA's text; T4 checked INN stems (they
# lose to ChEMBL "Small molecule"); T5 ATC classes WHO defines by product
# type and EMA text naming a vaccine or immunoglobulin; T6 ChEMBL molecule
# types (data-raw/chembl-substance-matches.json); T7 EMA substance-text
# hints; T8 ATC classes by use and the pharmacotherapeutic group text.

modality_groups <- list(
  small_molecule = character(),
  protein = c(
    "peptide", "hormone_cytokine", "enzyme", "coagulation_factor",
    "fusion_protein", "other_protein"
  ),
  antibody = c(
    "monoclonal_antibody", "adc", "bispecific_antibody", "antibody_fragment",
    "polyclonal_immunoglobulin"
  ),
  nucleic_acid = c(
    "mrna", "sirna", "antisense", "aptamer", "other_oligonucleotide"
  ),
  cell_gene = c(
    "car_t", "gene_modified_cells", "gene_therapy", "other_cell_therapy",
    "tissue_engineered"
  ),
  vaccine = c("live_vaccine", "inactivated_vaccine", "vector_vaccine"),
  radiopharmaceutical = c(
    "diagnostic_radiopharmaceutical", "therapeutic_radiopharmaceutical"
  ),
  other = c("allergen", "polysaccharide", "plant_extract", "polymer")
)

# One row per node in tree order; small_molecule is a group without leaves
# whose rows carry modality "small_molecule".
modality_taxonomy <- function() {
  rows <- purrr::imap(modality_groups, function(leaves, group) {
    dplyr::tibble(
      key = c(group, leaves),
      kind = c("group", rep("modality", length(leaves))),
      group_key = c(NA_character_, rep(group, length(leaves)))
    )
  })
  purrr::list_rbind(rows) |>
    dplyr::mutate(order = seq_len(dplyr::n()))
}

# The (group, modality) pairs a row may carry; modality NA = group only.
is_valid_modality <- function(group, modality) {
  purrr::map2_lgl(group, modality, function(one_group, one_modality) {
    if (is.na(one_group)) {
      return(is.na(one_modality))
    }
    leaves <- modality_groups[[one_group]]
    if (is.null(leaves)) {
      return(FALSE)
    }
    is.na(one_modality) || one_modality %in% leaves ||
      (one_group == "small_molecule" && one_modality == "small_molecule")
  })
}

# ---- Inputs: the texts classified per medicine ----

# Per medicine, the first that yields something: its INN keys; EMA's
# active-substance texts; the keys of a medicine with the same name
# (Ogivri: a withdrawn application without substance data); the WHO names
# of its one level-5 ATC code (Kyndrisa: drisapersen); else nothing (the
# product-level sources only). Keys are lower-case like substance keys.
modality_inputs <- function(medicines, substances, active_substances,
                            atc_codes, atc_classes) {
  inn_rows <- substances |>
    dplyr::distinct(.data$ema_product_number, .data$substance_key) |>
    dplyr::mutate(substance_basis = "inn", basis_evidence = NA_character_)
  active_rows <- active_substances |>
    dplyr::filter(!.data$ema_product_number %in% inn_rows$ema_product_number) |>
    dplyr::transmute(
      .data$ema_product_number,
      substance_key = stringr::str_squish(
        stringr::str_to_lower(.data$active_substance)
      ),
      substance_basis = "active_substance",
      basis_evidence = NA_character_
    ) |>
    dplyr::filter(!is.na(.data$substance_key), .data$substance_key != "") |>
    dplyr::distinct()
  keyed <- dplyr::bind_rows(inn_rows, active_rows)
  keyed <- dplyr::bind_rows(keyed, namesake_inputs(medicines, keyed))
  keyed <- dplyr::bind_rows(
    keyed,
    atc_name_inputs(medicines, keyed, atc_codes, atc_classes)
  )
  unkeyed <- medicines |>
    dplyr::filter(!.data$ema_product_number %in% keyed$ema_product_number) |>
    dplyr::transmute(
      .data$ema_product_number,
      substance_key = NA_character_,
      substance_basis = "none",
      basis_evidence = NA_character_
    )
  dplyr::bind_rows(keyed, unkeyed) |>
    dplyr::arrange(.data$ema_product_number, .data$substance_key)
}

# The keys of the medicines with the same name, for medicines without any.
namesake_inputs <- function(medicines, keyed) {
  names <- dplyr::transmute(
    medicines,
    .data$ema_product_number,
    folded_name = normalise_medicine_name(.data$name_of_medicine)
  )
  donors <- keyed |>
    dplyr::inner_join(names, by = "ema_product_number") |>
    dplyr::select(
      "folded_name",
      "substance_key",
      donor = "ema_product_number"
    )
  names |>
    dplyr::filter(
      !.data$ema_product_number %in% keyed$ema_product_number,
      !is.na(.data$folded_name)
    ) |>
    dplyr::inner_join(
      donors,
      by = "folded_name",
      relationship = "many-to-many"
    ) |>
    dplyr::summarise(
      basis_evidence = paste(sort(unique(.data$donor)), collapse = ", "),
      .by = c("ema_product_number", "substance_key")
    ) |>
    dplyr::mutate(substance_basis = "namesake", .before = "basis_evidence")
}

# One code per product: EMA's (or the SmPC's or curated) as the site uses it.
product_atc_codes <- function(atc_codes) {
  atc_codes |>
    dplyr::transmute(
      .data$ema_product_number,
      code = dplyr::coalesce(.data$current_atc_code, .data$atc_code)
    ) |>
    dplyr::filter(!is.na(.data$code)) |>
    dplyr::distinct() |>
    dplyr::arrange(.data$ema_product_number, .data$code)
}

# The WHO level-5 name(s) of the single code of a medicine without keys,
# split on ", " and " and " ("dasabuvir, ombitasvir, paritaprevir and
# ritonavir"). Not for vaccines: their names name the disease and the kind
# ("influenza, inactivated, split virus or surface antigen"), which the
# vaccine class itself tells (T5).
atc_name_inputs <- function(medicines, keyed, atc_codes, atc_classes) {
  single_codes <- product_atc_codes(atc_codes) |>
    dplyr::filter(dplyr::n() == 1, .by = "ema_product_number") |>
    dplyr::filter(nchar(.data$code) == 7, !startsWith(.data$code, "J07"))
  medicines |>
    dplyr::filter(!.data$ema_product_number %in% keyed$ema_product_number) |>
    dplyr::select("ema_product_number") |>
    dplyr::inner_join(single_codes, by = "ema_product_number") |>
    dplyr::inner_join(
      dplyr::select(atc_classes, code = "atc_code", "name"),
      by = "code"
    ) |>
    dplyr::mutate(
      substance_key = purrr::map(.data$name, split_atc_name),
      substance_basis = "atc_name",
      basis_evidence = .data$code
    ) |>
    tidyr::unnest_longer("substance_key") |>
    dplyr::transmute(
      .data$ema_product_number,
      substance_key = as.character(.data$substance_key),
      .data$substance_basis,
      .data$basis_evidence
    ) |>
    dplyr::distinct()
}

split_atc_name <- function(name) {
  parts <- strsplit(stringr::str_to_lower(name), ", | and ")[[1]]
  parts <- stringr::str_squish(parts)
  unique(parts[parts != ""])
}

# ---- Proposals ----

modality_proposal <- function(tier, group, leaf, rule, source,
                              evidence = NA_character_,
                              leaf_source = NA_character_,
                              leaf_rule = NA_character_) {
  list(
    tier = tier,
    group = group,
    leaf = if (is.na(leaf)) NA_character_ else leaf,
    rule = rule,
    source = source,
    evidence = evidence,
    leaf_source = leaf_source,
    leaf_rule = leaf_rule
  )
}

# INN words, without trailing commas and semicolons.
modality_words <- function(text) {
  words <- strsplit(text, "\\s+")[[1]]
  words <- sub("[,;]+$", "", words)
  words[words != ""]
}

# Stems are read on INN-like keys only: EMA's descriptions ("autologous
# CD34+ cells encoding ARSA gene") go to the text rules, else "-ase"
# catches "kinase" and "-cel" catches descriptions.
is_inn_like <- function(text, words) {
  length(words) <= 4 && !grepl("\\bvaccines?\\b", text, perl = TRUE)
}

# The stem (the pattern's first group) of the first word that ends in it.
word_stem <- function(words, pattern) {
  hits <- stringr::str_match(words, pattern)[, 2]
  hits <- hits[!is.na(hits)]
  if (length(hits) == 0) NA_character_ else hits[[1]]
}

greek_word_pattern <- paste0(
  "^(alfa|beta|gamma|delta|epsilon|zeta|eta|theta|kappa|lambda|omega)",
  "(-\\d.*)?$"
)

# Words skipped when reading an INN's second (conjugate or chelator) word.
is_skipped_second_word <- function(word) {
  word %in% c("pegol", "sodium", "(activated)", "(rdna)") |
    grepl(greek_word_pattern, word)
}

radionuclide_pattern <- "[(\\[]\\d{1,3}m?[a-z]{1,2}[)\\]]|\\bra ?223\\b"

# Precursors (a radionuclide as its chloride) and generators: their EMA
# codes are often too shallow to tell use, so the nuclide decides (Ytracis:
# yttrium-90, EMA "V09").
radionuclide_precursor_pattern <- paste0(
  "^[a-z]+ [(\\[]\\d{1,3}m?[a-z]{1,2}[)\\]] (di)?chloride$|\\bgenerator\\b"
)

therapeutic_nuclides <- c("90y", "177lu", "223ra", "153sm")
diagnostic_nuclides <- c(
  "18f", "68ga", "68ge", "64cu", "99mtc", "111in", "123i", "89zr"
)

nuclide_of <- function(text) {
  nuclide <- stringr::str_match(text, "[(\\[](\\d{1,3}m?[a-z]{1,2})[)\\]]")[, 2]
  if (is.na(nuclide) && grepl("\\bra ?223\\b", text)) "223ra" else nuclide
}

# Diagnostic or therapeutic: for a precursor with a code shallower than
# level 3 (or none) by its nuclide, else by ATC V09 / V10, else by the
# pharmacotherapeutic group text.
radiopharmaceutical_leaf <- function(text, codes, pharmacotherapeutic_group) {
  is_shallow <- length(codes) == 0 || all(nchar(codes) < 4)
  if (!is.na(text) && is_shallow &&
        grepl(radionuclide_precursor_pattern, text, perl = TRUE)) {
    nuclide <- nuclide_of(text)
    leaf <- dplyr::case_when(
      nuclide %in% therapeutic_nuclides ~ "therapeutic_radiopharmaceutical",
      nuclide %in% diagnostic_nuclides ~ "diagnostic_radiopharmaceutical",
      .default = NA_character_
    )
    if (!is.na(leaf)) {
      return(list(leaf = leaf, source = "inn_stem", rule = paste0(
        "inn:radionuclide (", nuclide, ")"
      )))
    }
  }
  is_diagnostic <- any(startsWith(codes, "V09"))
  is_therapeutic <- any(startsWith(codes, "V10"))
  if (is_diagnostic != is_therapeutic) {
    return(list(
      leaf = if (is_diagnostic) {
        "diagnostic_radiopharmaceutical"
      } else {
        "therapeutic_radiopharmaceutical"
      },
      source = "atc",
      rule = if (is_diagnostic) "atc:V09" else "atc:V10"
    ))
  }
  group_text <- stringr::str_to_lower(dplyr::coalesce(
    pharmacotherapeutic_group,
    ""
  ))
  says_diagnostic <- grepl("diagnostic radiopharm", group_text)
  says_therapeutic <- grepl("therapeutic radiopharm", group_text)
  if (says_diagnostic != says_therapeutic) {
    kind <- if (says_diagnostic) "diagnostic" else "therapeutic"
    return(list(
      leaf = paste0(kind, "_radiopharmaceutical"),
      source = "ema_text",
      rule = paste0("pg:", kind, " radiopharmaceuticals")
    ))
  }
  list(leaf = NA_character_, source = NA_character_, rule = NA_character_)
}

radiopharmaceutical_proposal <- function(tier, rule, source, evidence, text,
                                         codes, pharmacotherapeutic_group,
                                         own_leaf_source) {
  leaf <- radiopharmaceutical_leaf(text, codes, pharmacotherapeutic_group)
  is_own <- identical(leaf$source, own_leaf_source)
  modality_proposal(
    tier, "radiopharmaceutical", leaf$leaf, rule, source,
    evidence = evidence,
    leaf_source = if (is_own) NA_character_ else leaf$source,
    leaf_rule = if (is_own) NA_character_ else leaf$rule
  )
}

vaccine_leaf_patterns <- c(
  vector_vaccine = "ad26\\.|chadox1|mva-bn|rvsv",
  live_vaccine = "\\blive\\b",
  inactivated_vaccine = paste0(
    "inactivated|recombinant|rdna|conjugate|toxoid|acellular|split virion|",
    "surface antigen|polysaccharide|component|adsorbed|absorbed|",
    "purified antigen|whole cell|subunit"
  )
)

# The vaccine kind a text names (vector first: Ervebo is "live" too), and
# the words that name it.
vaccine_leaf <- function(text) {
  for (leaf in names(vaccine_leaf_patterns)) {
    term <- stringr::str_extract(text, vaccine_leaf_patterns[[leaf]])
    if (!is.na(term)) {
      return(list(leaf = leaf, term = term))
    }
  }
  list(leaf = NA_character_, term = NA_character_)
}

# ChEMBL molecule_type -> group and leaf (tier T6).
chembl_modalities <- list(
  "Small molecule" = c("small_molecule", "small_molecule"),
  "Protein" = c("protein", NA),
  "Antibody" = c("antibody", NA),
  "Antibody drug conjugate" = c("antibody", "adc"),
  "Enzyme" = c("protein", "enzyme"),
  "Oligonucleotide" = c("nucleic_acid", NA),
  "Oligosaccharide" = c("other", "polysaccharide"),
  "Cell" = c("cell_gene", NA),
  "Gene" = c("cell_gene", NA),
  "Vaccine component" = c("vaccine", NA)
)

# A salt's modality is its parent's when ChEMBL types the salt "Unknown".
chembl_molecule_type <- function(chembl) {
  type <- chembl$molecule_type
  is_salt <- !is.na(chembl$parent_chembl_id) &&
    chembl$parent_chembl_id != chembl$molecule_chembl_id
  if (type %in% "Unknown" && is_salt && !is.na(chembl$parent_molecule_type)) {
    return(list(type = chembl$parent_molecule_type, via_parent = TRUE))
  }
  list(type = type, via_parent = FALSE)
}

# The ChEMBL proposal, with the guards: a "Protein" record with a chemical
# structure (MOL or BOTH) and no INN peptide stem proposes nothing (ChEMBL's
# Protein/Small split of peptide-like molecules is arbitrary: R6); an
# "Oligosaccharide" without a heparin stem is a small molecule (sugammadex,
# a defined cyclodextrin: R7), and its rule says so, as ChEMBL's type alone
# would name a polysaccharide.
chembl_proposal <- function(chembl, has_peptide_stem, has_heparin_stem) {
  if (is.null(chembl)) {
    return(NULL)
  }
  typed <- chembl_molecule_type(chembl)
  mapped <- chembl_modalities[[typed$type %||% "Unknown"]]
  if (is.null(mapped)) {
    return(NULL)
  }
  if (typed$type == "Protein" && !has_peptide_stem &&
        chembl$structure_type %in% c("MOL", "BOTH")) {
    return(NULL)
  }
  rule <- paste0("chembl:", typed$type, if (typed$via_parent) " (parent)")
  if (typed$type == "Oligosaccharide" && !has_heparin_stem) {
    mapped <- c("small_molecule", "small_molecule")
    rule <- paste(rule, "(no heparin stem: small molecule)")
  }
  modality_proposal(
    6, mapped[[1]], mapped[[2]], rule, "chembl",
    evidence = paste(chembl$molecule_chembl_id, chembl$chembl_release)
  )
}

# Weak ATC classes (T8): classes by use; never L04AB, L04AC, L04AJ or
# B03XA as a whole, whose members are of several modalities.
weak_atc_classes <- list(
  list("^(L01F|L04AG|J06BC|J06BD)", "antibody", NA),
  list("^L01XL", "cell_gene", NA),
  list("^A10A", "protein", "hormone_cytokine"),
  list(
    "^(L03AA|L03AB|L03AC|H01AC|B03XA01$|B03XA02$|B03XA03$)",
    "protein",
    "hormone_cytokine"
  ),
  list("^(A16AB|B01AD|M09AB|D03BA)", "protein", "enzyme"),
  list(
    "^(H01BA|H01BB|H01CA|H01CB|H01CC|L02AE|L02BX02$|H04AA|H05BA)",
    "protein",
    "peptide"
  ),
  list("^B01AB", "other", "polysaccharide")
)

# ATC classes WHO defines by product type (T5).
definitional_atc_classes <- list(
  list(
    "^(J06A|J06BA|J06BB|L04AA03$|L04AA04$)",
    "antibody",
    "polyclonal_immunoglobulin"
  ),
  list("^V01", "other", "allergen"),
  list("^(B02BD|B02BC06$|B02BC10$)", "protein", "coagulation_factor"),
  list("^C10AC", "other", "polymer"),
  list("^A09AA", "protein", "enzyme")
)

atc_class_proposals <- function(classes, tier, codes) {
  purrr::compact(purrr::map(classes, function(class) {
    matching <- codes[grepl(class[[1]], codes)]
    if (length(matching) == 0) {
      return(NULL)
    }
    modality_proposal(
      tier, class[[2]], class[[3]],
      paste0("atc:", paste(matching, collapse = ",")),
      "atc",
      evidence = matching[[1]]
    )
  }))
}

# What the rules read of one text of a medicine: whether there is one, its
# words, whether it is INN-like (stems are read on those only) and its
# first two words.
modality_reading <- function(text, basis) {
  has_text <- basis != "none" && !is.na(text)
  text <- if (has_text) text else ""
  words <- modality_words(text)
  list(
    has_text = has_text,
    text = text,
    words = words,
    inn_like = has_text && is_inn_like(text, words),
    first = first_or(words[1], ""),
    second = first_or(words[2], "")
  )
}

# The stem (the pattern's first group) of the first word of an INN-like
# text that ends in it.
inn_stem_of <- function(reading, pattern) {
  if (reading$inn_like) word_stem(reading$words, pattern) else NA_character_
}

# "-parin", "-parinux": the heparin rule (T3) and ChEMBL's guard R7.
heparin_stem_pattern <- "(parin|parinux)$"

heparin_stem_of <- function(reading) {
  inn_stem_of(reading, heparin_stem_pattern)
}

# The peptide stems: the checked rule (T4) and ChEMBL's guard R6. Never
# defibrotide, nor a vaccine peptide ("-motide").
peptide_stem_of <- function(reading) {
  if (grepl("\\bdefibrotide\\b", reading$text) ||
        !is.na(inn_stem_of(reading, "(motide)$"))) {
    return(NA_character_)
  }
  inn_stem_of(reading, "(tide|relin|relix|pressin|tocin)$")
}

# The proposals given, without the NULLs of rules that did not apply.
proposals_of <- function(...) {
  purrr::compact(list(...))
}

# A stem proposal when a word ends in the pattern's stem; the rule names
# the stem found unless `rule` is given.
stem_rule_proposal <- function(reading, pattern, group, leaf, rule = NULL,
                               tier = 3) {
  stem <- inn_stem_of(reading, pattern)
  if (is.na(stem)) {
    return(NULL)
  }
  modality_proposal(
    tier, group, leaf, rule %||% paste0("stem:-", stem), "inn_stem"
  )
}

# Every proposal for one text of one medicine, tier by tier, highest first.
# decide_modality() sorts by tier and keeps the list order within a tier,
# so the order inside each tier's helper decides ties (in T3: the cell
# schemes, EMA's ATMP flag, mRNA, the antibody stems, the function stems
# before "-cept", …). `codes` are the medicine's ATC codes, `atc_names`
# their WHO names, `chembl` the applied ChEMBL match of the text (or NULL).
modality_proposals <- function(text, basis, codes, atc_names,
                               advanced_therapy, pharmacotherapeutic_group,
                               chembl = NULL) {
  reading <- modality_reading(text, basis)
  c(
    radiopharmaceutical_proposals(reading, codes, pharmacotherapeutic_group),
    inn_scheme_proposals(reading, advanced_therapy),
    checked_stem_proposals(reading, chembl),
    definitional_proposals(reading, codes, atc_names),
    proposals_of(chembl_proposal(
      chembl,
      has_peptide_stem = !is.na(peptide_stem_of(reading)),
      has_heparin_stem = !is.na(heparin_stem_of(reading))
    )),
    if (reading$has_text) {
      text_hint_proposals(reading$text, codes, advanced_therapy)
    },
    atc_class_proposals(weak_atc_classes, 8, codes),
    group_text_proposals(pharmacotherapeutic_group)
  )
}

# T1 a radionuclide in the name, T2 ATC V09/V10.
radiopharmaceutical_proposals <- function(reading, codes,
                                          pharmacotherapeutic_group) {
  text <- if (reading$has_text) reading$text else NA_character_
  radio_codes <- codes[grepl("^V09|^V10", codes)]
  proposals_of(
    if (reading$has_text &&
          stringr::str_detect(reading$text, radionuclide_pattern)) {
      radiopharmaceutical_proposal(
        1, paste0("inn:radionuclide (", nuclide_of(text), ")"), "inn_stem",
        NA_character_, text, codes, pharmacotherapeutic_group, "inn_stem"
      )
    },
    if (length(radio_codes) > 0) {
      radiopharmaceutical_proposal(
        2, paste0("atc:", paste(radio_codes, collapse = ",")), "atc",
        radio_codes[[1]], text, codes, pharmacotherapeutic_group, "atc"
      )
    }
  )
}

# T3: definitive WHO INN stems and schemes, EMA's ATMP flag and "mRNA" in
# EMA's text, in this order.
inn_scheme_proposals <- function(reading, advanced_therapy) {
  c(
    proposals_of(
      cell_scheme_proposal(reading),
      if (isTRUE(advanced_therapy)) {
        modality_proposal(
          3, "cell_gene", NA, "ema_atmp:advanced_therapy", "ema_atmp"
        )
      }
    ),
    nucleic_acid_stem_proposals(reading),
    proposals_of(antibody_scheme_proposal(reading)),
    protein_stem_proposals(reading),
    other_stem_proposals(reading),
    proposals_of(greek_word_proposal(reading))
  )
}

# The INN schemes of cell and gene therapies (word 1 and word 2).
cell_scheme_proposal <- function(reading) {
  if (!reading$has_text) {
    return(NULL)
  }
  first <- reading$first
  second <- reading$second
  scheme <- function(leaf, rule) {
    modality_proposal(3, "cell_gene", leaf, rule, "inn_stem")
  }
  if (grepl("cabtagene$", first) && grepl("cel$", second)) {
    return(scheme("car_t", "stem:-cabtagene + -cel"))
  }
  if (grepl("gene$", first) && grepl("cel$", second)) {
    return(scheme("gene_modified_cells", "stem:-gene + -cel"))
  }
  if (grepl("gene$", first) && grepl("(vec|plasmid|bac)$", second)) {
    return(scheme("gene_therapy", "stem:-gene + -vec"))
  }
  if (length(reading$words) == 1 && grepl("cel$", first)) {
    return(scheme("other_cell_therapy", "stem:-cel"))
  }
  NULL
}

# "-meran" (else "mrna" in EMA's text), "-siran", "-rsen".
nucleic_acid_stem_proposals <- function(reading) {
  mrna_text <- if (reading$has_text && grepl("\\bmrna\\b", reading$text)) {
    modality_proposal(3, "nucleic_acid", "mrna", "text:mrna", "ema_text")
  }
  proposals_of(
    stem_rule_proposal(reading, "(meran)$", "nucleic_acid", "mrna") %||%
      mrna_text,
    stem_rule_proposal(reading, "(siran)$", "nucleic_acid", "sirna"),
    stem_rule_proposal(reading, "(rsen)$", "nucleic_acid", "antisense")
  )
}

antibody_scheme_proposal <- function(reading) {
  stem <- if (reading$inn_like) {
    stringr::str_match(reading$first, "(mab|tug|bart|ment|mig)$")[, 2]
  } else {
    NA_character_
  }
  if (is.na(stem)) NULL else antibody_stem_proposal(stem, reading$words)
}

# "-bep", "-cog" (not "-cogin"), "-ase" (not in descriptions or with
# "kinase", "inhibitor", "gene"), the hormone stems and INN groups, then
# "-cept"/"-fusp": the function wins over "fusion" (efmoroctocog alfa
# stays a coagulation factor).
protein_stem_proposals <- function(reading) {
  is_factor <- is.na(inn_stem_of(reading, "(cogin)$"))
  is_enzyme_name <- length(reading$words) <= 3 &&
    !grepl("\\b(kinase|inhibitor|gene)\\b", reading$text)
  hormone_rule <- hormone_stem_rule(reading)
  proposals_of(
    stem_rule_proposal(reading, "(bep)$", "protein", "other_protein"),
    if (is_factor) {
      stem_rule_proposal(reading, "(cog)$", "protein", "coagulation_factor")
    },
    if (is_enzyme_name) {
      stem_rule_proposal(reading, "(ase)$", "protein", "enzyme")
    },
    if (!is.na(hormone_rule)) {
      modality_proposal(
        3, "protein", "hormone_cytokine", hormone_rule, "inn_stem"
      )
    },
    stem_rule_proposal(reading, "(cept|fusp)$", "protein", "fusion_protein")
  )
}

# Heparins, polymers, vaccine antigens, oncolytic viruses (group only).
other_stem_proposals <- function(reading) {
  proposals_of(
    stem_rule_proposal(
      reading, heparin_stem_pattern, "other", "polysaccharide"
    ),
    stem_rule_proposal(reading, "(mer)$", "other", "polymer"),
    stem_rule_proposal(
      reading, "(motide|vatein)$", "vaccine", "inactivated_vaccine"
    ),
    stem_rule_proposal(
      reading, "(turev|rev)$", "cell_gene", NA,
      rule = "stem:-rev"
    )
  )
}

# A Greek letter after word 1: WHO's naming of glycosylated proteins
# (group only; an antibody stem, earlier in T3, wins: dinutuximab beta).
greek_word_proposal <- function(reading) {
  others <- reading$words[-1]
  greek <- if (reading$inn_like && length(others) > 0) {
    first_or(others[grepl(greek_word_pattern, others)], NA_character_)
  } else {
    NA_character_
  }
  if (is.na(greek)) {
    return(NULL)
  }
  modality_proposal(
    3, "protein", NA, paste0("inn:greek second word (", greek, ")"),
    "inn_stem"
  )
}

# T4: checked stems, which lose to a ChEMBL "Small molecule".
checked_stem_proposals <- function(reading, chembl) {
  peptide_stem <- peptide_stem_of(reading)
  proposals_of(
    if (!is.na(peptide_stem)) {
      peptide_stem_proposal(peptide_stem, reading$text, chembl)
    },
    stem_rule_proposal(
      reading, "(irudin|kinra|cogin)$", "protein", NA,
      tier = 4
    )
  )
}

# T5: EMA text naming a vaccine or an immunoglobulin, then the ATC classes
# WHO defines by product type (a vaccine's kind from its WHO names).
definitional_proposals <- function(reading, codes, atc_names) {
  text <- reading$text
  vaccine_codes <- codes[startsWith(codes, "J07")]
  c(
    proposals_of(
      if (reading$has_text && grepl("\\bvaccines?\\b", text)) {
        vaccine_text_proposal(text)
      },
      if (reading$has_text && grepl("immunoglobulin", text) &&
            !grepl("monoclonal", text)) {
        modality_proposal(
          5, "antibody", "polyclonal_immunoglobulin", "text:immunoglobulin",
          "ema_text"
        )
      },
      if (length(vaccine_codes) > 0) {
        vaccine_class_proposal(vaccine_codes, atc_names)
      }
    ),
    atc_class_proposals(definitional_atc_classes, 5, codes)
  )
}

vaccine_text_proposal <- function(text) {
  named <- vaccine_leaf(text)
  modality_proposal(
    5, "vaccine", named$leaf,
    paste0("text:vaccine", if (!is.na(named$term)) paste0(" ", named$term)),
    "ema_text"
  )
}

vaccine_class_proposal <- function(vaccine_codes, atc_names) {
  names <- dplyr::coalesce(unname(atc_names[vaccine_codes]), "")
  named <- vaccine_leaf(stringr::str_to_lower(paste(names, collapse = " ")))
  modality_proposal(
    5, "vaccine", named$leaf,
    paste0("atc:", paste(vaccine_codes, collapse = ",")), "atc",
    evidence = vaccine_codes[[1]]
  )
}

# The first value, or `default` when there is none or it is missing.
first_or <- function(value, default) {
  if (length(value) == 0 || is.na(value[[1]])) default else value[[1]]
}

# "-mab" (and the new "-tug", "-bart", "-ment", "-mig") on word 1; a second
# word names a payload (an ADC) or a chelator (a radiolabel: no leaf).
antibody_stem_proposal <- function(stem, words) {
  others <- words[-1]
  second <- first_or(others[!is_skipped_second_word(others)], "")
  leaf <- "monoclonal_antibody"
  rule <- paste0("stem:-", stem)
  if (stem == "mig") {
    leaf <- "bispecific_antibody"
  } else if (stem == "ment") {
    leaf <- "antibody_fragment"
  } else if (grepl("^(tiuxetan|pendetide|tetraxetan|merpentan)$", second)) {
    leaf <- NA_character_
    rule <- paste(rule, "+ chelator", second)
  } else if (grepl(
    "(dotin|tansine|tecan|micin|tesirine|duocarmazine|tox)$",
    second
  )) {
    leaf <- "adc"
    rule <- paste(rule, "+ payload", second)
  }
  modality_proposal(3, "antibody", leaf, rule, "inn_stem")
}

# INN groups without a stem (insulins, interferons), then the stems of
# hormones, cytokines and growth factors ("-tropin" but not "-tropine").
hormone_stem_rule <- function(reading) {
  group <- if (reading$has_text) {
    stringr::str_match(
      reading$text,
      "\\b(insulin|interferon|peginterferon|ropeginterferon)\\b"
    )[, 2]
  } else {
    NA_character_
  }
  if (!is.na(group)) {
    return(paste0("inn_group:", group))
  }
  stem <- inn_stem_of(reading, "(poetin|stim|ermin|kin|tropin)$")
  if (!is.na(stem)) {
    return(paste0("stem:-", stem))
  }
  som_pattern <- "(somatropin|^som\\w*(?:pacitan|trogon))$"
  if (!is.na(inn_stem_of(reading, som_pattern))) {
    return("stem:som-")
  }
  NA_character_
}

# "-tide" and the other peptide stems (T4), unless a large partner shows a
# fusion protein: a ChEMBL protein component over 100 amino acids, or "Fc"
# or "albumin" in EMA's text (R11: dulaglutide, albiglutide).
peptide_stem_proposal <- function(stem, text, chembl) {
  protein_length <- if (is.null(chembl)) {
    NA_real_
  } else {
    chembl$biocomponent_max_protein_length
  }
  has_large_partner <- (protein_length > 100) %in% TRUE ||
    grepl("\\bfc\\b|albumin", text)
  if (has_large_partner) {
    return(modality_proposal(
      4, "protein", "fusion_protein",
      paste0("stem:-", stem, " + large partner"), "inn_stem"
    ))
  }
  modality_proposal(4, "protein", "peptide", paste0("stem:-", stem), "inn_stem")
}

cell_text_leaf <- function(text) {
  dplyr::case_when(
    grepl("chimeric antigen receptor", text) ~ "car_t",
    grepl("genetically modified|transduced|encod(es|ing)|\\bgene\\b", text) ~
      "gene_modified_cells",
    grepl("chondrocytes|cartilage|corneal|spheroids", text) ~
      "tissue_engineered",
    .default = "other_cell_therapy"
  )
}

# EMA's substance texts: descriptions of extracts, enzymes, plasma
# proteins, antibodies and cells (T7), in this order.
text_hint_proposals <- function(text, codes, advanced_therapy) {
  c(
    proposals_of(extract_text_proposal(text, codes)),
    protein_text_proposals(text),
    proposals_of(
      antibody_text_proposal(text),
      cell_text_proposal(text, advanced_therapy),
      if (grepl("\\bgene\\b", text) &&
            grepl("adenovirus|vector|virus-mediated", text)) {
        modality_proposal(
          7, "cell_gene", "gene_therapy", "text:gene + vector", "ema_text"
        )
      }
    )
  )
}

# An extract: an allergen under ATC V01, else a plant extract.
extract_text_proposal <- function(text, codes) {
  if (!grepl("\\bextract\\b", text)) {
    return(NULL)
  }
  if (any(startsWith(codes, "V01"))) {
    return(modality_proposal(
      7, "other", "allergen", "text:extract + atc V01", "ema_text"
    ))
  }
  modality_proposal(7, "other", "plant_extract", "text:extract", "ema_text")
}

# Enzymes, coagulation factors, other plasma proteins and toxins, hormones.
protein_text_proposals <- function(text) {
  is_coagulation <- grepl(
    "\\bfibrinogen|\\bthrombin\\b|coagulation factor|von willebrand",
    text
  ) && !grepl("antithrombin", text)
  other_protein <- stringr::str_extract(
    text,
    paste0(
      "albumin|antitrypsin|proteinase inhibitor|c1.?(esterase )?inhibitor|",
      "antithrombin|toxin"
    )
  )
  hint <- function(leaf, rule) {
    modality_proposal(7, "protein", leaf, rule, "ema_text")
  }
  proposals_of(
    if (grepl("\\benzymes\\b", text)) hint("enzyme", "text:enzymes"),
    if (is_coagulation) hint("coagulation_factor", "text:coagulation"),
    if (!is.na(other_protein)) {
      hint("other_protein", paste0("text:", other_protein))
    },
    if (grepl("\\bhormone\\b", text)) hint("hormone_cytokine", "text:hormone")
  )
}

antibody_text_proposal <- function(text) {
  if (!grepl("\\bmonoclonal antibody\\b|\\bmab\\b", text)) {
    return(NULL)
  }
  leaf <- if (grepl("fragment", text)) {
    "antibody_fragment"
  } else {
    "monoclonal_antibody"
  }
  modality_proposal(
    7, "antibody", leaf, "text:monoclonal antibody", "ema_text"
  )
}

# A description of cells (not a lysate or inactivated cells), or cells of a
# medicine EMA flags as an advanced therapy; the kind from the text.
cell_text_proposal <- function(text, advanced_therapy) {
  describes_cells <- !grepl("lysates?|\\(inactivated\\)", text) &&
    grepl(paste0(
      "^(autologous|allogeneic|ex vivo|human heterologous|characterised|",
      "matrix-applied|spheroids)"
    ), text) &&
    grepl("cells?\\b|chondrocytes|lymphocytes", text)
  if (!describes_cells &&
        !(isTRUE(advanced_therapy) && grepl("cells?\\b|chondrocytes", text))) {
    return(NULL)
  }
  modality_proposal(
    7, "cell_gene", cell_text_leaf(text), "text:cells", "ema_text"
  )
}

group_text_proposals <- function(pharmacotherapeutic_group) {
  text <- stringr::str_to_lower(dplyr::coalesce(pharmacotherapeutic_group, ""))
  proposals <- list()
  if (grepl("immune sera and immunoglobulins|specific immunoglobulins", text)) {
    proposals <- c(proposals, list(modality_proposal(
      8, "antibody", NA, "pg:immunoglobulins", "ema_text"
    )))
  }
  if (grepl("\\bvaccines?\\b", text)) {
    proposals <- c(proposals, list(modality_proposal(
      8, "vaccine", NA, "pg:vaccines", "ema_text"
    )))
  }
  if (grepl("radiopharmaceuticals", text)) {
    leaf <- radiopharmaceutical_leaf(NA_character_, character(), text)
    proposals <- c(proposals, list(modality_proposal(
      8, "radiopharmaceutical", leaf$leaf, "pg:radiopharmaceuticals",
      "ema_text"
    )))
  }
  proposals
}

# ---- Decision ----

empty_modality_decision <- function() {
  list(
    modality_group = NA_character_,
    modality = NA_character_,
    source = NA_character_,
    rule = NA_character_,
    evidence = NA_character_,
    leaf_source = NA_character_,
    leaf_rule = NA_character_,
    top_tier = NA_real_,
    conflicts = list()
  )
}

# The highest tier's group (a checked stem loses to a ChEMBL "Small
# molecule"); the leaf of the highest proposal in that group that names
# one. Proposals of other groups are conflicts, listed, never shown.
decide_modality <- function(proposals) {
  if (length(proposals) == 0) {
    return(empty_modality_decision())
  }
  tiers <- purrr::map_dbl(proposals, "tier")
  proposals <- proposals[order(tiers)]
  top <- proposals[[1]]
  small_molecule <- purrr::detect(proposals, function(proposal) {
    proposal$source == "chembl" && proposal$group == "small_molecule"
  })
  if (top$tier == 4 && !is.null(small_molecule)) {
    top <- small_molecule
  }
  leaf_from <- if (!is.na(top$leaf)) {
    top
  } else {
    purrr::detect(proposals, function(proposal) {
      proposal$group == top$group && !is.na(proposal$leaf)
    })
  }
  from_other <- !is.null(leaf_from) && !identical(leaf_from, top)
  list(
    modality_group = top$group,
    modality = if (is.null(leaf_from)) NA_character_ else leaf_from$leaf,
    source = top$source,
    rule = top$rule,
    evidence = top$evidence,
    leaf_source = if (from_other) leaf_from$source else top$leaf_source,
    leaf_rule = if (from_other) leaf_from$rule else top$leaf_rule,
    top_tier = top$tier,
    conflicts = purrr::keep(proposals, function(proposal) {
      proposal$group != top$group
    })
  )
}

# ---- Classification of every medicine ----

# The applied ChEMBL match per key: an unambiguous match, or a reviewed one.
applied_chembl_matches <- function(chembl_matches) {
  chembl_matches |>
    dplyr::filter(
      !is.na(.data$molecule_chembl_id),
      !is.na(.data$molecule_type),
      .data$reviewed %in% TRUE |
        !.data$ambiguity %in% "different_molecule_types"
    )
}

# Proposals for every input row, with the product-level facts they need.
input_proposals <- function(inputs, medicines, atc_codes, atc_classes,
                            chembl_matches) {
  codes_by_product <- product_atc_codes(atc_codes) |>
    dplyr::summarise(codes = list(.data$code), .by = "ema_product_number")
  atc_names <- stats::setNames(atc_classes$name, atc_classes$atc_code)
  applied <- applied_chembl_matches(chembl_matches)
  chembl_rows <- split(applied, applied$substance_key)
  facts <- inputs |>
    dplyr::left_join(
      dplyr::select(
        medicines, "ema_product_number", "advanced_therapy",
        "pharmacotherapeutic_group_human"
      ),
      by = "ema_product_number",
      relationship = "many-to-one"
    ) |>
    dplyr::left_join(
      codes_by_product,
      by = "ema_product_number",
      relationship = "many-to-one"
    )
  purrr::pmap(
    list(
      facts$substance_key, facts$substance_basis, facts$codes,
      facts$advanced_therapy, facts$pharmacotherapeutic_group_human
    ),
    function(text, basis, codes, advanced_therapy, group_text) {
      codes <- codes %||% character()
      chembl <- if (is.na(text)) NULL else chembl_rows[[text]]
      if (!is.null(chembl)) {
        chembl <- as.list(chembl[1, ])
      }
      modality_proposals(
        text, basis, codes, atc_names[codes], advanced_therapy, group_text,
        chembl
      )
    }
  )
}

is_radionuclide_decision <- function(proposal) {
  proposal$group == "radiopharmaceutical" && proposal$tier <= 2
}

# A radionuclide or V09/V10 decision applies to every medicine with that
# key (R4): Scintimun EMEA/H/C/000653, without ATC code, follows 001045.
propagate_radiopharmaceuticals <- function(inputs, proposals) {
  top <- purrr::map(proposals, function(one) {
    radio <- purrr::keep(one, is_radionuclide_decision)
    if (length(radio) == 0) NULL else radio[[1]]
  })
  donors <- !purrr::map_lgl(top, is.null) & !is.na(inputs$substance_key)
  if (!any(donors)) {
    return(proposals)
  }
  for (key in unique(inputs$substance_key[donors])) {
    donor_rows <- which(donors & inputs$substance_key %in% key)
    receivers <- which(!donors & inputs$substance_key %in% key)
    leaves <- unique(purrr::map_chr(top[donor_rows], "leaf"))
    for (row in receivers) {
      donor <- top[[donor_rows[[1]]]]
      proposals[[row]] <- c(proposals[[row]], list(modality_proposal(
        2, "radiopharmaceutical",
        if (length(leaves) == 1) leaves else NA_character_,
        paste0(
          donor$rule, " (same substance as ",
          paste(inputs$ema_product_number[donor_rows], collapse = ", "), ")"
        ),
        donor$source,
        evidence = donor$evidence
      )))
    }
  }
  proposals
}

# Reviewed curated rows (T0): a product-specific row before a key-wide one.
curated_modality_proposal <- function(curated, key, product) {
  if (is.na(key)) {
    return(NULL)
  }
  rows <- curated[curated$substance_key == key &
                    (is.na(curated$ema_product_number) |
                       curated$ema_product_number == product), ]
  if (nrow(rows) == 0) {
    return(NULL)
  }
  row <- rows[order(is.na(rows$ema_product_number)), ][1, ]
  modality_proposal(
    0, row$modality_group, row$modality, "curated", "curated",
    evidence = row$evidence_url
  )
}

# One row per medicine and classified text (ema_medicine_modalities.json),
# plus the decisions without curated rows and every conflict, for checks
# and the run summary.
classify_modalities <- function(inputs, medicines, atc_codes, atc_classes,
                                chembl_matches, curated) {
  applied_curated <- dplyr::filter(curated, .data$reviewed %in% TRUE)
  proposals <- input_proposals(
    inputs, medicines, atc_codes, atc_classes, chembl_matches
  ) |>
    propagate_radiopharmaceuticals(inputs = inputs)
  by_rules <- purrr::map(proposals, decide_modality)
  decisions <- purrr::pmap(
    list(proposals, inputs$substance_key, inputs$ema_product_number),
    function(one, key, product) {
      curated_row <- curated_modality_proposal(applied_curated, key, product)
      decide_modality(c(purrr::compact(list(curated_row)), one))
    }
  )
  rows <- inputs |>
    dplyr::mutate(
      modality_group = purrr::map_chr(decisions, "modality_group"),
      modality = purrr::map_chr(decisions, "modality"),
      source = purrr::map_chr(decisions, "source"),
      rule = purrr::map_chr(decisions, "rule"),
      evidence = dplyr::coalesce(
        purrr::map_chr(decisions, "evidence"),
        dplyr::if_else(
          .data$substance_basis %in% c("namesake", "atc_name") &
            !is.na(purrr::map_chr(decisions, "modality_group")),
          .data$basis_evidence,
          NA_character_
        )
      ),
      leaf_source = purrr::map_chr(decisions, "leaf_source"),
      leaf_rule = purrr::map_chr(decisions, "leaf_rule")
    )
  list(
    rows = rows,
    by_rules = dplyr::mutate(
      inputs,
      modality_group = purrr::map_chr(by_rules, "modality_group"),
      modality = purrr::map_chr(by_rules, "modality")
    ),
    decisions = decisions,
    proposals = proposals
  )
}

modality_row_columns <- c(
  "ema_product_number", "substance_key", "substance_basis",
  "modality_group", "modality", "source", "rule", "evidence",
  "leaf_source", "leaf_rule"
)

# The modality tables of a pipeline run, checked; the details go to the run
# summary.
build_modality_tables <- function(tables, chembl_matches,
                                  curated = curated_modalities()) {
  check_curated_modalities(curated)
  inputs <- modality_inputs(
    tables$ema_medicines,
    tables$ema_medicine_substances,
    tables$ema_medicine_active_substances,
    tables$ema_medicine_atc_codes,
    tables$atc_classes
  )
  classified <- classify_modalities(
    inputs,
    tables$ema_medicines,
    tables$ema_medicine_atc_codes,
    tables$atc_classes,
    chembl_matches,
    curated
  )
  rows <- classified$rows |>
    dplyr::select(dplyr::all_of(modality_row_columns)) |>
    dplyr::arrange(.data$ema_product_number, .data$substance_key)
  check_modalities(rows, tables$ema_medicines)
  list(
    tables = list(
      ema_medicine_modalities = rows,
      modalities = modality_taxonomy()
    ),
    classified = classified,
    inputs = inputs,
    chembl_matches = chembl_matches,
    curated = curated
  )
}

# ---- Checks ----

modality_labels <- function(rows, medicines) {
  names <- medicines$name_of_medicine[
    match(rows$ema_product_number, medicines$ema_product_number)
  ]
  sprintf(
    "%s (%s): %s = %s/%s",
    names,
    rows$ema_product_number,
    dplyr::coalesce(rows$substance_key, "(no substance)"),
    dplyr::coalesce(rows$modality_group, "not classified"),
    dplyr::coalesce(rows$modality, "-")
  )
}

# Build stops: a leaf outside its group or an unknown key, an advanced
# therapy outside cell and gene therapy, a biosimilar classed small
# molecule.
check_modalities <- function(rows, medicines) {
  flags <- medicines[
    match(rows$ema_product_number, medicines$ema_product_number),
  ]
  problems <- list(
    "Modality rows with an unknown key or a modality outside its group." =
      !is_valid_modality(rows$modality_group, rows$modality),
    "Advanced therapies outside cell and gene therapy." =
      flags$advanced_therapy %in% TRUE & !rows$modality_group %in% "cell_gene",
    "Biosimilars classed as small molecules." =
      flags$biosimilar %in% TRUE & rows$modality_group %in% "small_molecule"
  )
  for (problem in names(problems)) {
    offenders <- problems[[problem]]
    if (any(offenders)) {
      abort_modality_problem(
        problem,
        modality_labels(rows[offenders, ], medicines)
      )
    }
  }
  invisible(rows)
}

abort_modality_problem <- function(problem, labels) {
  cli::cli_abort(c(problem, x = "{.val {offender_values(labels)}}"))
}

# ---- Run summary and credits ----

# "Group: all (Authorised)" per group, then per modality within it; a
# medicine counts once per group and once per modality it has.
modality_counts <- function(rows, medicines) {
  authorised <- medicines$ema_product_number[
    medicines$medicine_status == "Authorised"
  ]
  count_label <- function(products) {
    sprintf(
      "%d (%d)",
      dplyr::n_distinct(products),
      dplyr::n_distinct(products[products %in% authorised])
    )
  }
  groups <- c(names(modality_groups), NA)
  purrr::map_chr(groups, function(group) {
    in_group <- rows[rows$modality_group %in% group, ]
    label <- paste(dplyr::coalesce(group, "not classified"), count_label(
      in_group$ema_product_number
    ))
    leaves <- c(modality_groups[[first_or(group, "none")]], NA)
    leaf_labels <- purrr::map_chr(leaves, function(leaf) {
      products <- in_group$ema_product_number[in_group$modality %in% leaf]
      if (length(products) == 0) {
        return(NA_character_)
      }
      paste(dplyr::coalesce(leaf, "not more specific"), count_label(products))
    })
    leaf_labels <- leaf_labels[!is.na(leaf_labels)]
    if (is.na(group) || group == "small_molecule" || length(leaf_labels) == 0) {
      return(label)
    }
    paste0(label, " [", paste(leaf_labels, collapse = ", "), "]")
  })
}

medicine_labels <- function(products, medicines) {
  found <- medicines[match(products, medicines$ema_product_number), ]
  sprintf(
    "%s (%s, %s)",
    found$name_of_medicine,
    found$ema_product_number,
    found$medicine_status
  )
}

# Keys of rows whose ChEMBL match a guard held back (R6) or applied for
# review (R8), from the proposals.
chembl_review_keys <- function(run) {
  rows <- run$classified$rows
  matches <- applied_chembl_matches(run$chembl_matches)
  matched <- matches[match(rows$substance_key, matches$substance_key), ]
  has_chembl_proposal <- purrr::map_lgl(
    run$classified$proposals,
    function(proposals) {
      any(purrr::map_chr(proposals, "source") == "chembl")
    }
  )
  held_back <- matched$molecule_type %in% "Protein" &
    matched$structure_type %in% c("MOL", "BOTH") & !has_chembl_proposal
  no_structure <- rows$source %in% "chembl" &
    rows$modality_group %in% "small_molecule" &
    matched$structure_type %in% "NONE"
  list(
    held_back = sort(unique(rows$substance_key[held_back])),
    no_structure = sort(unique(rows$substance_key[no_structure]))
  )
}

# Conflicts: proposals of another group than the one decided.
modality_conflicts <- function(run) {
  rows <- run$classified$rows
  conflicts <- purrr::map2(
    run$classified$decisions,
    seq_len(nrow(rows)),
    function(decision, index) {
      if (length(decision$conflicts) == 0) {
        return(NULL)
      }
      dplyr::tibble(
        key = dplyr::coalesce(
          rows$substance_key[[index]],
          paste("(no substance)", rows$ema_product_number[[index]])
        ),
        decided = paste0(
          decision$modality_group, "/", first_or(decision$modality, "-"),
          " by ", decision$rule
        ),
        lost = purrr::map_chr(decision$conflicts, function(proposal) {
          paste0(
            proposal$group, "/", first_or(proposal$leaf, "-"), " by ",
            proposal$rule
          )
        })
      )
    }
  )
  dplyr::distinct(purrr::list_rbind(c(
    list(dplyr::tibble(
      key = character(), decided = character(), lost = character()
    )),
    conflicts
  )))
}

# Curated rows: used (and whether the rules alone would agree, a candidate
# to drop), or matching no medicine.
curated_modality_verdicts <- function(run) {
  rows <- run$classified$rows
  by_rules <- run$classified$by_rules
  curated <- dplyr::filter(run$curated, .data$reviewed %in% TRUE)
  purrr::map_chr(seq_len(nrow(curated)), function(index) {
    matching <- rows$substance_key %in% curated$substance_key[[index]] &
      (is.na(curated$ema_product_number[[index]]) |
         rows$ema_product_number %in% curated$ema_product_number[[index]])
    if (!any(matching)) {
      return("no_data")
    }
    agrees <- by_rules$modality_group[matching] %in%
      curated$modality_group[[index]] &
      by_rules$modality[matching] %in% curated$modality[[index]]
    if (all(agrees)) "agrees" else "used"
  })
}

list_modality_items <- function(heading, items) {
  if (length(items) > 0) {
    cli::cli_alert_info(
      "{heading} ({length(items)}):
      {.val {offender_values(items, max_shown = length(items))}}"
    )
  }
}

# The run summary: counts, gaps, review lists, curated rows.
report_modality_summary <- function(run, medicines) {
  rows <- run$classified$rows
  report_modality_counts(rows, medicines)
  report_modality_gaps(rows, medicines)
  report_modality_reviews(run)
  report_curated_modalities(run)
  invisible(run)
}

report_modality_counts <- function(rows, medicines) {
  cli::cli_alert_info(paste0(
    "Modalities, medicines (Authorised): ",
    paste(modality_counts(rows, medicines), collapse = "; "),
    "."
  ))
}

# Medicines not classified (Authorised first), group only, and those whose
# key came from a namesake or the WHO ATC name.
report_modality_gaps <- function(rows, medicines) {
  unclassified <- unique(rows$ema_product_number[is.na(rows$modality_group)])
  status <- medicines$medicine_status[
    match(unclassified, medicines$ema_product_number)
  ]
  unclassified <- unclassified[order(status != "Authorised", unclassified)]
  list_modality_items(
    "Medicines with a substance not classified",
    medicine_labels(unclassified, medicines)
  )
  group_only <- rows[!is.na(rows$modality_group) & is.na(rows$modality), ]
  list_modality_items(
    "Group only (no source names the modality)",
    paste0(
      medicine_labels(group_only$ema_product_number, medicines), ": ",
      dplyr::coalesce(group_only$substance_key, "(no substance)"), " = ",
      group_only$modality_group, " by ", group_only$rule
    )
  )
  borrowed <- rows[rows$substance_basis %in% c("namesake", "atc_name"), ]
  list_modality_items(
    "Keys from a namesake or the WHO ATC name",
    paste0(
      medicine_labels(borrowed$ema_product_number, medicines), ": ",
      borrowed$substance_key, " (", borrowed$substance_basis, " ",
      borrowed$evidence, ")"
    )
  )
}

# Conflicts, then the ChEMBL rows to review.
report_modality_reviews <- function(run) {
  conflicts <- modality_conflicts(run)
  list_modality_items(
    "Modality conflicts (lower-ranked proposals of another group)",
    paste0(conflicts$key, ": ", conflicts$decided, "; not ", conflicts$lost)
  )
  review <- chembl_review_keys(run)
  list_modality_items(
    paste(
      "ChEMBL \"Protein\" with a chemical structure and no peptide stem,",
      "not used (review)"
    ),
    review$held_back
  )
  list_modality_items(
    "ChEMBL \"Small molecule\" without a structure, applied (review)",
    review$no_structure
  )
  report_chembl_match_reviews(run)
}

# Ambiguous and unmatched ChEMBL rows, and keys the matches file lacks.
report_chembl_match_reviews <- function(run) {
  matches <- run$chembl_matches
  list_modality_items(
    "ChEMBL matches of different molecule types, not applied (review)",
    matches$substance_key[
      matches$ambiguity %in% "different_molecule_types" &
        !matches$reviewed %in% TRUE
    ]
  )
  list_modality_items(
    "Unmatched keys with ChEMBL variant candidates (review)",
    matches$substance_key[
      lengths(matches$variant_candidates) > 0 &
        is.na(matches$molecule_chembl_id)
    ]
  )
  keys <- sort(unique(stats::na.omit(run$classified$rows$substance_key)))
  list_modality_items(
    paste(
      "Keys missing from the ChEMBL matches file (rerun",
      "scripts/match-chembl-modality.R)"
    ),
    setdiff(keys, matches$substance_key)
  )
}

report_curated_modalities <- function(run) {
  verdicts <- curated_modality_verdicts(run)
  curated <- dplyr::filter(run$curated, .data$reviewed %in% TRUE)
  cli::cli_alert_info(sprintf(
    paste(
      "Curated modalities: %d used, %d the rules already agree with",
      "(candidates to drop), %d matching no medicine; %d not reviewed."
    ),
    sum(verdicts == "used"),
    sum(verdicts == "agrees"),
    sum(verdicts == "no_data"),
    sum(!run$curated$reviewed %in% TRUE)
  ))
  list_modality_items(
    "Curated modalities the rules already agree with",
    curated$substance_key[verdicts == "agrees"]
  )
  list_modality_items(
    "Curated modalities matching no medicine",
    curated$substance_key[verdicts == "no_data"]
  )
}

modality_rules_checked_date <- as.Date("2026-09-29")

# meta.json entries: the WHO INN stems the rules use, the ChEMBL molecule
# types (release and oldest response of the matches file) and the curated
# rows (their latest check).
modality_source_entries <- function(chembl_matches, curated) {
  releases <- unique(stats::na.omit(chembl_matches$chembl_release))
  retrieved <- stats::na.omit(chembl_matches$retrieved)
  purrr::compact(list(
    list(
      name = "WHO INN stems",
      url = "https://www.who.int/publications/i/item/9789240099388",
      version = paste(
        "Stem book 2024; INN for biological and biotechnological substances",
        "(a review) 2022; INN monoclonal antibody nomenclature scheme 2021",
        "(INN 21.531); stem book addendum 2026 (INN 26.638)"
      ),
      retrieved = format(modality_rules_checked_date),
      licence = paste(
        "Stem book 2024: CC BY-NC-SA 3.0 IGO",
        "(https://creativecommons.org/licenses/by-nc-sa/3.0/igo/); addendum",
        "2026: all rights reserved (stems used as facts, text not reproduced)"
      ),
      attribution = paste(
        "Modality rules read WHO INN stems as facts, in approval-atlas's own",
        "words: Use of stems in the selection of International",
        "Nonproprietary Names (INN) for pharmaceutical substances 2024",
        "(Geneva: World Health Organization; CC BY-NC-SA 3.0 IGO) and the",
        "WHO INN documents named; WHO does not endorse this site."
      )
    ),
    if (length(releases) > 0) {
      list(
        name = "ChEMBL molecules",
        url = paste0(chembl_api_url, "molecule.json"),
        version = paste(releases, collapse = ", "),
        retrieved = if (length(retrieved) > 0) min(retrieved) else NA,
        licence = paste(
          "CC BY-SA 3.0",
          "(https://creativecommons.org/licenses/by-sa/3.0/)"
        ),
        attribution = paste0(
          "ChEMBL data is from https://www.ebi.ac.uk/chembl (",
          paste(releases, collapse = ", "),
          "), molecule types matched to substance names by approval-atlas ",
          "(data-raw/chembl-substance-matches.json). Mendez D. et al., ",
          "ChEMBL: towards direct deposition of bioassay data, Nucleic ",
          "Acids Res. 2019;47(D1):D930-D940, doi:10.1093/nar/gky1075."
        )
      )
    },
    list(
      name = "Curated modalities",
      url = paste0(
        "https://github.com/vrognas/approval-atlas/blob/main/",
        "R/curated-modalities.R"
      ),
      version = paste("Checked", format(max(curated$checked_date))),
      retrieved = format(max(curated$checked_date)),
      licence = "Part of the data compilation (CC BY-SA 4.0)",
      attribution = paste(
        "Modalities checked by hand by approval-atlas against EMA product",
        "information and assessment reports, ChEMBL records and PubMed, each",
        "with a verbatim quote; EMA content © European Medicines Agency."
      )
    )
  ))
}
