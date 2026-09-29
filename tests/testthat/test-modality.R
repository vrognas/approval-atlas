# The decision for one text of a medicine, from the rules alone.
classify_text <- function(text,
                          codes = character(),
                          basis = "inn",
                          atc_names = NULL,
                          advanced_therapy = FALSE,
                          group_text = NA_character_,
                          chembl = NULL) {
  decide_modality(modality_proposals(
    text, basis, codes, atc_names %||% stats::setNames(character(), NULL),
    advanced_therapy, group_text, chembl
  ))
}

chembl_row <- function(type,
                       structure = "MOL",
                       id = "CHEMBL1",
                       parent = id,
                       parent_type = NA_character_,
                       protein_length = NA_real_) {
  list(
    molecule_chembl_id = id,
    molecule_type = type,
    structure_type = structure,
    parent_chembl_id = parent,
    parent_molecule_type = parent_type,
    biocomponent_max_protein_length = protein_length,
    chembl_release = "ChEMBL_37"
  )
}

modality_of <- function(decision) {
  paste0(decision$modality_group, "/", first_or(decision$modality, "-"))
}

test_that("the taxonomy lists 8 groups and 30 modalities in tree order", {
  taxonomy <- modality_taxonomy()
  expect_identical(nrow(taxonomy), 38L)
  expect_identical(sum(taxonomy$kind == "group"), 8L)
  expect_identical(taxonomy$key[1:3], c("small_molecule", "protein", "peptide"))
  expect_identical(taxonomy$order, seq_len(38))
  expect_true(all(is.na(taxonomy$group_key[taxonomy$kind == "group"])))
  expect_identical(
    taxonomy$group_key[taxonomy$key == "sirna"],
    "nucleic_acid"
  )
  expect_true(all(grepl("^[a-z_]+$", taxonomy$key)))
  expect_false(anyDuplicated(taxonomy$key) > 0)
})

test_that("is_valid_modality accepts groups, their modalities and none", {
  expect_identical(
    is_valid_modality(
      c("antibody", "antibody", "small_molecule", NA, "antibody", "unknown",
        NA, "small_molecule"),
      c("adc", NA, "small_molecule", NA, "sirna", NA, "adc", "adc")
    ),
    c(TRUE, TRUE, TRUE, TRUE, FALSE, FALSE, FALSE, FALSE)
  )
})

test_that("antibody stems name the format, payload or chelator", {
  expect_identical(modality_of(classify_text("adalimumab")),
                   "antibody/monoclonal_antibody")
  expect_identical(classify_text("adalimumab")$rule, "stem:-mab")
  expect_identical(modality_of(classify_text("sipavibart")),
                   "antibody/monoclonal_antibody")
  expect_identical(modality_of(classify_text("denecimig")),
                   "antibody/bispecific_antibody")
  expect_identical(modality_of(classify_text("examplement")),
                   "antibody/antibody_fragment")
  vedotin <- classify_text("enfortumab vedotin")
  expect_identical(modality_of(vedotin), "antibody/adc")
  expect_identical(vedotin$rule, "stem:-mab + payload vedotin")
  expect_identical(modality_of(classify_text("moxetumomab pasudotox")),
                   "antibody/adc")
  expect_identical(modality_of(classify_text("trastuzumab duocarmazine")),
                   "antibody/adc")
  # The skipped words before the conjugate: "pegol", Greek letters.
  expect_identical(modality_of(classify_text("examplumab pegol tesirine")),
                   "antibody/adc")
  chelator <- classify_text("ibritumomab tiuxetan")
  expect_identical(modality_of(chelator), "antibody/-")
  expect_identical(chelator$rule, "stem:-mab + chelator tiuxetan")
  # An antibody stem wins over the Greek-letter word (dinutuximab beta).
  expect_identical(modality_of(classify_text("dinutuximab beta")),
                   "antibody/monoclonal_antibody")
})

test_that("nucleic acid stems and EMA's mRNA text", {
  expect_identical(modality_of(classify_text("inclisiran")),
                   "nucleic_acid/sirna")
  expect_identical(classify_text("inclisiran")$rule, "stem:-siran")
  expect_identical(modality_of(classify_text("nusinersen")),
                   "nucleic_acid/antisense")
  expect_identical(modality_of(classify_text("zapomeran")),
                   "nucleic_acid/mrna")
  # mRNA over vaccine (Comirnaty's text; its ATC J07BN01).
  comirnaty <- classify_text("covid-19 mrna vaccine", codes = "J07BN01")
  expect_identical(modality_of(comirnaty), "nucleic_acid/mrna")
  expect_identical(comirnaty$rule, "text:mrna")
  expect_identical(comirnaty$source, "ema_text")
  expect_identical(comirnaty$conflicts[[1]]$group, "vaccine")
  # "-apt-" is never read alone: these are no aptamers.
  for (key in c("tolvaptan", "daptomycin", "mercaptamine", "mercaptopurine")) {
    expect_identical(classify_text(key)$modality_group, NA_character_)
  }
})

test_that("cell and gene therapy stems follow the INN schemes", {
  expect_identical(modality_of(classify_text("axicabtagene ciloleucel")),
                   "cell_gene/car_t")
  expect_identical(modality_of(classify_text("betibeglogene autotemcel")),
                   "cell_gene/gene_modified_cells")
  expect_identical(modality_of(classify_text("onasemnogene abeparvovec")),
                   "cell_gene/gene_therapy")
  expect_identical(modality_of(classify_text("tabelecleucel")),
                   "cell_gene/other_cell_therapy")
  expect_identical(modality_of(classify_text("exampleturev")),
                   "cell_gene/-")
  # Roctavian: gene therapy over the coagulation factor class B02BD.
  roctavian <- classify_text(
    "valoctocogene roxaparvovec",
    codes = "B02BD15",
    advanced_therapy = TRUE
  )
  expect_identical(modality_of(roctavian), "cell_gene/gene_therapy")
  expect_identical(roctavian$conflicts[[1]]$rule, "atc:B02BD15")
  # Hemgenix, Upstaza: gene therapy over the enzyme and factor stems.
  expect_identical(
    modality_of(classify_text("etranacogene dezaparvovec", "B02BD16",
                              advanced_therapy = TRUE)),
    "cell_gene/gene_therapy"
  )
  expect_identical(
    modality_of(classify_text("eladocagene exuparvovec", "N07XX18",
                              advanced_therapy = TRUE)),
    "cell_gene/gene_therapy"
  )
  # Libmeldy: EMA's ATMP flag decides the group, the text the modality.
  libmeldy <- classify_text(
    "autologous cd34+ cells encoding arsa gene",
    codes = "A16AB21",
    advanced_therapy = TRUE
  )
  expect_identical(modality_of(libmeldy), "cell_gene/gene_modified_cells")
  expect_identical(libmeldy$source, "ema_atmp")
  expect_identical(libmeldy$leaf_rule, "text:cells")
  expect_identical(libmeldy$leaf_source, "ema_text")
})

test_that("cell texts name the kind of cell product", {
  expect_identical(
    cell_text_leaf(c(
      "autologous t cells with a chimeric antigen receptor",
      "allogeneic t cells genetically modified",
      "spheroids of human autologous matrix-associated chondrocytes",
      "allogeneic cultured keratinocytes"
    )),
    c("car_t", "gene_modified_cells", "tissue_engineered",
      "other_cell_therapy")
  )
  expect_identical(
    modality_of(classify_text("allogeneic cultured keratinocytes cells")),
    "cell_gene/other_cell_therapy"
  )
  # Tumour lysates are not cell products.
  expect_identical(
    classify_text("autologous tumour cell lysate")$modality_group,
    NA_character_
  )
  expect_identical(
    modality_of(classify_text(
      "adenovirus-mediated herpes simplex virus-thymidine kinase gene"
    )),
    "cell_gene/gene_therapy"
  )
})

test_that("protein stems: enzymes, factors, hormones, fusions", {
  expect_identical(modality_of(classify_text("imiglucerase")), "protein/enzyme")
  # "-ase" is not read in descriptions or with "kinase" or "inhibitor".
  expect_identical(
    classify_text("alpha1-proteinase inhibitor")$modality,
    "other_protein"
  )
  expect_identical(modality_of(classify_text("octocog alfa")),
                   "protein/coagulation_factor")
  # Function over fusion: efmoroctocog alfa stays a coagulation factor.
  expect_identical(modality_of(classify_text("efmoroctocog alfa")),
                   "protein/coagulation_factor")
  expect_identical(classify_text("insulin glargine")$rule,
                   "inn_group:insulin")
  expect_identical(modality_of(classify_text("peginterferon alfa-2a")),
                   "protein/hormone_cytokine")
  expect_identical(classify_text("filgrastim")$rule, "stem:-stim")
  expect_identical(classify_text("follitropin alfa")$rule, "stem:-tropin")
  expect_identical(classify_text("aldesleukin")$rule, "stem:-kin")
  expect_identical(classify_text("becaplermin")$rule, "stem:-ermin")
  expect_identical(classify_text("epoetin alfa")$rule, "stem:-poetin")
  # som-: somapacitan is a growth hormone although ChEMBL says small
  # molecule; somatostatin is not.
  somapacitan <- classify_text(
    "somapacitan",
    chembl = chembl_row("Small molecule")
  )
  expect_identical(modality_of(somapacitan), "protein/hormone_cytokine")
  expect_identical(somapacitan$rule, "stem:som-")
  expect_identical(classify_text("somatostatin")$modality_group, NA_character_)
  # Not "-tropine".
  expect_identical(classify_text("atropine")$modality_group, NA_character_)
  expect_identical(modality_of(classify_text("etanercept")),
                   "protein/fusion_protein")
  expect_identical(modality_of(classify_text("tebentafusp")),
                   "protein/fusion_protein")
  expect_identical(modality_of(classify_text("lerodalcibep")),
                   "protein/other_protein")
  # A Greek-letter second word: a protein, no modality named.
  conestat <- classify_text("conestat alfa")
  expect_identical(modality_of(conestat), "protein/-")
  expect_identical(conestat$rule, "inn:greek second word (alfa)")
})

test_that("checked stems lose to ChEMBL small molecules", {
  expect_identical(modality_of(classify_text("semaglutide")), "protein/peptide")
  expect_identical(modality_of(classify_text("degarelix")), "protein/peptide")
  expect_identical(classify_text("terlipressin")$rule, "stem:-pressin")
  for (key in c("anamorelin", "macimorelin")) {
    decision <- classify_text(key, chembl = chembl_row("Small molecule"))
    expect_identical(modality_of(decision), "small_molecule/small_molecule")
    expect_identical(decision$conflicts[[1]]$rule, "stem:-relin")
  }
  # Paltusotine, relugolix: peptide ATC classes lose to ChEMBL too.
  expect_identical(
    modality_of(classify_text("paltusotine", "H01CB08",
                              chembl = chembl_row("Small molecule"))),
    "small_molecule/small_molecule"
  )
  expect_identical(
    modality_of(classify_text("relugolix", "L02BX04",
                              chembl = chembl_row("Small molecule"))),
    "small_molecule/small_molecule"
  )
  expect_identical(modality_of(classify_text("bivalirudin")), "protein/-")
  expect_identical(modality_of(classify_text("anakinra")), "protein/-")
  # "-cogin" is checked (R9): ATC B01AD names the enzyme.
  drotrecogin <- classify_text("drotrecogin alfa (activated)", "B01AD10")
  expect_identical(modality_of(drotrecogin), "protein/enzyme")
  expect_identical(drotrecogin$leaf_rule, "atc:B01AD10")
  expect_identical(drotrecogin$leaf_source, "atc")
  # Not "-tide": defibrotide, and vaccine peptides "-motide".
  expect_identical(classify_text("defibrotide")$modality_group, NA_character_)
  expect_identical(modality_of(classify_text("examplemotide")),
                   "vaccine/inactivated_vaccine")
})

test_that("a large partner makes a -tide a fusion protein (R11)", {
  dulaglutide <- classify_text(
    "dulaglutide",
    chembl = chembl_row("Protein", structure = "SEQ", protein_length = 275)
  )
  expect_identical(modality_of(dulaglutide), "protein/fusion_protein")
  expect_identical(dulaglutide$rule, "stem:-tide + large partner")
  expect_identical(
    modality_of(classify_text("exampleglutide")),
    "protein/peptide"
  )
  expect_identical(
    modality_of(classify_text("exampleglutide albumin")),
    "protein/fusion_protein"
  )
})

test_that("ChEMBL types map to groups, with the guards", {
  expect_identical(
    modality_of(classify_text(
      "imatinib",
      chembl = chembl_row("Small molecule")
    )),
    "small_molecule/small_molecule"
  )
  imatinib <- classify_text("imatinib", chembl = chembl_row(
    "Small molecule",
    id = "CHEMBL941"
  ))
  expect_identical(imatinib$rule, "chembl:Small molecule")
  expect_identical(imatinib$evidence, "CHEMBL941 ChEMBL_37")
  expect_identical(
    modality_of(classify_text(
      "x",
      chembl = chembl_row("Antibody drug conjugate")
    )),
    "antibody/adc"
  )
  expect_identical(
    modality_of(classify_text("x", chembl = chembl_row("Enzyme"))),
    "protein/enzyme"
  )
  expect_identical(
    modality_of(classify_text("x", chembl = chembl_row("Oligonucleotide"))),
    "nucleic_acid/-"
  )
  expect_identical(
    modality_of(classify_text("x", chembl = chembl_row("Unknown"))),
    "NA/-"
  )
  # R6: a Protein record with a structure and no peptide stem proposes
  # nothing (atosiban); with a peptide stem it does (octreotide).
  expect_identical(
    classify_text("atosiban", chembl = chembl_row("Protein"))$modality_group,
    NA_character_
  )
  expect_identical(
    modality_of(classify_text("x", chembl = chembl_row("Protein", "SEQ"))),
    "protein/-"
  )
  expect_identical(
    modality_of(classify_text("octreotide", chembl = chembl_row("Protein"))),
    "protein/peptide"
  )
  # R7: an Oligosaccharide without a heparin stem is a small molecule, and
  # its rule says so.
  sugammadex <- classify_text("sugammadex sodium", chembl = chembl_row(
    "Oligosaccharide"
  ))
  expect_identical(modality_of(sugammadex), "small_molecule/small_molecule")
  expect_identical(
    sugammadex$rule,
    "chembl:Oligosaccharide (no heparin stem: small molecule)"
  )
  expect_identical(
    modality_of(classify_text("fondaparinux sodium", chembl = chembl_row(
      "Oligosaccharide"
    ))),
    "other/polysaccharide"
  )
  # R8: a small molecule without a structure is applied (and listed).
  expect_identical(
    modality_of(classify_text("gadoteric acid", chembl = chembl_row(
      "Small molecule", "NONE"
    ))),
    "small_molecule/small_molecule"
  )
  # A salt ChEMBL types Unknown takes its parent's type.
  salt <- classify_text("x", chembl = chembl_row(
    "Unknown", id = "CHEMBL2", parent = "CHEMBL1",
    parent_type = "Small molecule"
  ))
  expect_identical(modality_of(salt), "small_molecule/small_molecule")
  expect_identical(salt$rule, "chembl:Small molecule (parent)")
})

test_that("radiopharmaceuticals win over the carrier, the leaf by use", {
  # Lutathera: a radionuclide over the peptide stem.
  lutathera <- classify_text("lutetium (177lu) oxodotreotide", "V10XX04")
  expect_identical(
    modality_of(lutathera),
    "radiopharmaceutical/therapeutic_radiopharmaceutical"
  )
  expect_identical(lutathera$rule, "inn:radionuclide (177lu)")
  expect_identical(lutathera$source, "inn_stem")
  expect_identical(lutathera$leaf_rule, "atc:V10")
  expect_identical(lutathera$leaf_source, "atc")
  # Zevalin: V10 over the antibody.
  zevalin <- classify_text("ibritumomab tiuxetan", "V10XX02")
  expect_identical(
    modality_of(zevalin),
    "radiopharmaceutical/therapeutic_radiopharmaceutical"
  )
  expect_identical(zevalin$rule, "atc:V10XX02")
  expect_identical(zevalin$evidence, "V10XX02")
  expect_identical(zevalin$leaf_rule, NA_character_)
  # Lymphoseek: V09 over "-cept".
  expect_identical(
    modality_of(classify_text("tilmanocept", "V09IA09")),
    "radiopharmaceutical/diagnostic_radiopharmaceutical"
  )
  # Theryttrex: a precursor with EMA's shallow V09 is told by its nuclide.
  theryttrex <- classify_text("yttrium [90y] chloride", "V09")
  expect_identical(
    modality_of(theryttrex),
    "radiopharmaceutical/therapeutic_radiopharmaceutical"
  )
  expect_identical(theryttrex$rule, "inn:radionuclide (90y)")
  expect_identical(theryttrex$leaf_rule, NA_character_)
  expect_identical(
    classify_text("gallium (68ga) chloride")$modality,
    "diagnostic_radiopharmaceutical"
  )
  expect_identical(
    classify_text("radium ra223 dichloride", "V10XX03")$modality,
    "therapeutic_radiopharmaceutical"
  )
  # Without a code, the pharmacotherapeutic group tells the use.
  by_text <- classify_text(
    "copper (64cu) chloride",
    codes = "V09X",
    group_text = "Diagnostic radiopharmaceuticals, other"
  )
  expect_identical(by_text$modality, "diagnostic_radiopharmaceutical")
  expect_identical(
    radiopharmaceutical_leaf(
      NA_character_, character(), "Therapeutic radiopharmaceuticals"
    ),
    list(
      leaf = "therapeutic_radiopharmaceutical",
      source = "ema_text",
      rule = "pg:therapeutic radiopharmaceuticals"
    )
  )
  expect_identical(
    radiopharmaceutical_leaf("florbetapir (18f)", c("V09", "V10"), NA)$leaf,
    NA_character_
  )
  expect_identical(nuclide_of("radium ra223 dichloride"), "223ra")
  expect_identical(nuclide_of("germanium (68ge) chloride"), "68ge")
  # An unknown nuclide of a precursor falls back to the code.
  expect_identical(
    radiopharmaceutical_leaf("iron (59fe) chloride", character(), NA)$leaf,
    NA_character_
  )
  expect_identical(
    modality_of(classify_text(NA_character_, "V09HA03", basis = "none")),
    "radiopharmaceutical/diagnostic_radiopharmaceutical"
  )
})

test_that("vaccines by EMA text and the WHO class", {
  expect_identical(
    vaccine_leaf("ebola zaire vaccine (rvsv∆g-zebov-gp, live)"),
    list(leaf = "vector_vaccine", term = "rvsv")
  )
  expect_identical(
    vaccine_leaf("measles, mumps and rubella vaccine (live)")$leaf,
    "live_vaccine"
  )
  expect_identical(
    vaccine_leaf("hepatitis b (rdna) vaccine (adsorbed)")$leaf,
    "inactivated_vaccine"
  )
  expect_identical(vaccine_leaf("a vaccine")$leaf, NA_character_)
  text_vaccine <- classify_text("measles, mumps and rubella vaccine (live)")
  expect_identical(modality_of(text_vaccine), "vaccine/live_vaccine")
  expect_identical(text_vaccine$rule, "text:vaccine live")
  # Emerflu: the class alone, no kind named.
  emerflu <- classify_text(NA_character_, "J07BB", basis = "none")
  expect_identical(modality_of(emerflu), "vaccine/-")
  expect_identical(emerflu$rule, "atc:J07BB")
  heplisav <- classify_text(
    NA_character_,
    "J07BC01",
    basis = "none",
    atc_names = c(J07BC01 = "hepatitis B, purified antigen")
  )
  expect_identical(modality_of(heplisav), "vaccine/inactivated_vaccine")
  expect_identical(
    modality_of(classify_text("examplevatein")),
    "vaccine/inactivated_vaccine"
  )
  expect_identical(
    modality_of(classify_text(NA_character_, basis = "none",
                              group_text = "Vaccines, other")),
    "vaccine/-"
  )
})

test_that("definitional and weak ATC classes, EMA texts", {
  expect_identical(
    modality_of(classify_text("human normal immunoglobulin")),
    "antibody/polyclonal_immunoglobulin"
  )
  expect_identical(
    modality_of(classify_text(NA_character_, "J06BA02", basis = "none")),
    "antibody/polyclonal_immunoglobulin"
  )
  expect_identical(
    modality_of(classify_text("arachis hypogaea extract", "V01AA08")),
    "other/allergen"
  )
  expect_identical(
    modality_of(classify_text("birch bark extract")),
    "other/plant_extract"
  )
  expect_identical(
    modality_of(classify_text(
      "concentrate of proteolytic enzymes enriched in bromelain"
    )),
    "protein/enzyme"
  )
  expect_identical(
    modality_of(classify_text("human fibrinogen / human thrombin")),
    "protein/coagulation_factor"
  )
  expect_identical(
    modality_of(classify_text("human antithrombin")),
    "protein/other_protein"
  )
  expect_identical(classify_text("botulinum toxin type b")$rule, "text:toxin")
  expect_identical(
    modality_of(classify_text("parathyroid hormone")),
    "protein/hormone_cytokine"
  )
  expect_identical(
    modality_of(classify_text("anti-melanoma mab fragments")),
    "antibody/antibody_fragment"
  )
  expect_identical(
    modality_of(classify_text("human igg1 monoclonal antibody against il-1")),
    "antibody/monoclonal_antibody"
  )
  expect_identical(
    modality_of(classify_text("colestilan", "C10AC")),
    "other/polymer"
  )
  expect_identical(
    modality_of(classify_text("pancreas powder", "A09AA02")),
    "protein/enzyme"
  )
  expect_identical(
    modality_of(classify_text("x", c("B02BD02", "B02BD06"))),
    "protein/coagulation_factor"
  )
  expect_identical(classify_text("x", c("B02BD02", "B02BD06"))$rule,
                   "atc:B02BD02,B02BD06")
  # Weak classes (T8).
  expect_identical(
    modality_of(classify_text(NA_character_, "L03AA02", basis = "none")),
    "protein/hormone_cytokine"
  )
  expect_identical(
    modality_of(classify_text(NA_character_, "L01FA01", basis = "none")),
    "antibody/-"
  )
  expect_identical(
    modality_of(classify_text(NA_character_, "L01XL01", basis = "none")),
    "cell_gene/-"
  )
  expect_identical(
    modality_of(classify_text(NA_character_, "B01AB05", basis = "none")),
    "other/polysaccharide"
  )
  # Never L04AC as a whole: its members are of several modalities.
  expect_identical(
    classify_text(NA_character_, "L04AC03", basis = "none")$modality_group,
    NA_character_
  )
  expect_identical(
    modality_of(classify_text(NA_character_, basis = "none",
                              group_text = "Immune sera and immunoglobulins")),
    "antibody/-"
  )
  expect_identical(
    modality_of(classify_text(NA_character_, basis = "none",
                              group_text = "Diagnostic radiopharmaceuticals")),
    "radiopharmaceutical/diagnostic_radiopharmaceutical"
  )
  # Polymers and heparins by stem.
  expect_identical(modality_of(classify_text("sevelamer")), "other/polymer")
  expect_identical(classify_text("enoxaparin sodium")$rule, "stem:-parin")
})

test_that("decide_modality takes the leaf from the highest proposal", {
  proposals <- list(
    modality_proposal(6, "protein", NA, "chembl:Protein", "chembl"),
    modality_proposal(8, "protein", "hormone_cytokine", "atc:A10AE06", "atc"),
    modality_proposal(8, "antibody", NA, "pg:immunoglobulins", "ema_text")
  )
  decision <- decide_modality(proposals)
  expect_identical(modality_of(decision), "protein/hormone_cytokine")
  expect_identical(decision$leaf_source, "atc")
  expect_identical(decision$leaf_rule, "atc:A10AE06")
  expect_length(decision$conflicts, 1)
  expect_identical(decide_modality(list())$modality_group, NA_character_)
})

test_that("words, stems and small helpers", {
  expect_identical(modality_words("a,  b; c"), c("a", "b", "c"))
  expect_identical(modality_words(""), character())
  expect_false(is_inn_like("a b c d e", modality_words("a b c d e")))
  expect_false(is_inn_like("x vaccine", c("x", "vaccine")))
  expect_identical(word_stem(c("a", "semaglutide"), "(tide)$"), "tide")
  expect_identical(word_stem(character(), "(tide)$"), NA_character_)
  expect_identical(first_or(character(), "x"), "x")
  expect_identical(first_or(c(NA, "y"), "x"), "x")
  expect_identical(first_or(c("y", "z"), "x"), "y")
  expect_identical(
    split_atc_name("Dasabuvir, ombitasvir, paritaprevir and ritonavir"),
    c("dasabuvir", "ombitasvir", "paritaprevir", "ritonavir")
  )
  expect_true(is_skipped_second_word("beta-1a"))
  expect_false(is_skipped_second_word("vedotin"))
})

# ---- Classification of real medicines ----

classify_fixture <- function(curated = curated_modalities(),
                             matches = read_chembl_matches(
                               fixture_chembl_matches_path()
                             )) {
  build_modality_tables(read_fixture_modality_tables(), matches, curated)
}

no_curated_modalities <- function() curated_modalities()[0, ]

modality_by_product <- function(rows) {
  values <- rows |>
    dplyr::mutate(value = paste0(
      .data$modality_group, "/", dplyr::coalesce(.data$modality, "-")
    )) |>
    dplyr::summarise(
      value = paste(.data$value, collapse = "; "),
      .by = "ema_product_number"
    )
  stats::setNames(values$value, values$ema_product_number)
}

test_that("real medicines get the modality their evidence names", {
  run <- classify_fixture()
  rows <- run$tables$ema_medicine_modalities
  expect_named(rows, modality_row_columns)
  values <- modality_by_product(rows)
  expected <- c(
    "EMEA/H/C/004123" = "radiopharmaceutical/therapeutic_radiopharmaceutical",
    "EMEA/H/C/005483" = "radiopharmaceutical/therapeutic_radiopharmaceutical",
    "EMEA/H/C/000547" = "radiopharmaceutical/therapeutic_radiopharmaceutical",
    "EMEA/H/C/001045" = "radiopharmaceutical/diagnostic_radiopharmaceutical",
    "EMEA/H/C/000653" = "radiopharmaceutical/diagnostic_radiopharmaceutical",
    "EMEA/H/C/002085" = "radiopharmaceutical/diagnostic_radiopharmaceutical",
    "EMEA/H/C/000445" = "radiopharmaceutical/therapeutic_radiopharmaceutical",
    "EMEA/H/C/005735" = "nucleic_acid/mrna",
    "EMEA/H/C/004749" = "cell_gene/gene_therapy",
    "EMEA/H/C/004827" = "cell_gene/gene_therapy",
    "EMEA/H/C/005321" = "cell_gene/gene_modified_cells",
    "EMEA/H/C/005352" = "cell_gene/gene_therapy",
    "EMEA/H/C/003847" = "small_molecule/small_molecule",
    "EMEA/H/C/004660" = "small_molecule/small_molecule",
    "EMEA/H/C/006636" = "small_molecule/small_molecule",
    "EMEA/H/C/005353" = "small_molecule/small_molecule",
    "EMEA/H/C/005030" = "protein/hormone_cytokine",
    "EMEA/H/C/003918" = "antibody/monoclonal_antibody",
    "EMEA/H/C/002647" = "protein/hormone_cytokine; protein/peptide",
    "EMEA/H/C/002825" = "protein/fusion_protein",
    "EMEA/H/C/000253" = "protein/peptide",
    "EMEA/H/C/000885" = "small_molecule/small_molecule",
    "EMEA/H/C/000859" = "vaccine/-",
    "EMEA/H/C/002299" = "vaccine/inactivated_vaccine",
    "EMEA/H/C/005035" = "other/plant_extract"
  )
  expect_identical(values[names(expected)], expected)
  # Ogivri, without substance data: its namesake's key.
  ogivri <- rows[rows$ema_product_number == "EMEA/H/C/004346", ]
  expect_identical(ogivri$substance_basis, "namesake")
  expect_identical(ogivri$substance_key, "trastuzumab")
  expect_identical(ogivri$modality, "monoclonal_antibody")
  expect_identical(ogivri$evidence, "EMEA/H/C/004916")
  # Kyndrisa: the WHO name of its one code.
  kyndrisa <- rows[rows$ema_product_number == "EMEA/H/C/003846", ]
  expect_identical(kyndrisa$substance_key, "drisapersen")
  expect_identical(kyndrisa$substance_basis, "atc_name")
  expect_identical(kyndrisa$modality, "antisense")
  expect_identical(kyndrisa$evidence, "M09AX04")
  cokiera <- rows[rows$ema_product_number == "EMEA/H/C/004235", ]
  expect_identical(
    cokiera$substance_key,
    c("dasabuvir", "ombitasvir", "paritaprevir", "ritonavir")
  )
  expect_identical(unique(cokiera$modality), "small_molecule")
  # Emerflu: the product's class only, no substance.
  emerflu <- rows[rows$ema_product_number == "EMEA/H/C/000859", ]
  expect_identical(emerflu$substance_basis, "none")
  expect_identical(emerflu$substance_key, NA_character_)
  expect_identical(emerflu$evidence, "J07BB")
  # Rows sorted by product, then key (none last).
  expect_identical(
    rows[, c("ema_product_number", "substance_key")],
    dplyr::arrange(
      rows[, c("ema_product_number", "substance_key")],
      .data$ema_product_number,
      .data$substance_key
    )
  )
  expect_identical(run$tables$modalities, modality_taxonomy())
})

test_that("curated rows decide and name their evidence", {
  rows <- classify_fixture()$tables$ema_medicine_modalities
  scintimun <- rows[rows$ema_product_number == "EMEA/H/C/000653", ]
  expect_identical(scintimun$source, "curated")
  expect_identical(scintimun$rule, "curated")
  expect_match(scintimun$evidence, "scintimun-epar-product-information")
  tractocile <- rows[rows$ema_product_number == "EMEA/H/C/000253", ]
  expect_identical(tractocile$source, "curated")
  # Without curated rows: Scintimun 000653 follows its namesake's V09 code
  # (R4), Tractocile's atosiban stays open (R6), Trulicity is a fusion
  # protein by ChEMBL's chain length (R11).
  rules_only <- classify_fixture(curated = no_curated_modalities())
  rows <- rules_only$tables$ema_medicine_modalities
  scintimun <- rows[rows$ema_product_number == "EMEA/H/C/000653", ]
  expect_identical(scintimun$modality, "diagnostic_radiopharmaceutical")
  expect_identical(scintimun$source, "atc")
  expect_identical(
    scintimun$rule,
    "atc:V09HA03 (same substance as EMEA/H/C/001045)"
  )
  expect_identical(scintimun$evidence, "V09HA03")
  expect_identical(
    rows$modality_group[rows$ema_product_number == "EMEA/H/C/000253"],
    NA_character_
  )
  trulicity <- rows[rows$ema_product_number == "EMEA/H/C/002825", ]
  expect_identical(trulicity$modality, "fusion_protein")
  expect_identical(trulicity$rule, "stem:-tide + large partner")
  # Filsuvez: ChEMBL's "Small molecule" (no structure) for the extract.
  expect_identical(
    rows$modality[rows$ema_product_number == "EMEA/H/C/005035"],
    "small_molecule"
  )
  # A reviewed ChEMBL variant applies (Zemdri: plazomicin).
  zemdri <- rows[rows$ema_product_number == "EMEA/H/C/004457", ]
  expect_identical(zemdri$modality, "small_molecule")
  expect_identical(zemdri$evidence, "CHEMBL1650559 ChEMBL_37")
})

test_that("an ambiguous ChEMBL match applies only when reviewed", {
  matches <- read_chembl_matches(fixture_chembl_matches_path())
  bridion <- matches$substance_key == "sugammadex"
  matches$ambiguity[bridion] <- "different_molecule_types"
  rows <- classify_fixture(no_curated_modalities(), matches)$tables$
    ema_medicine_modalities
  expect_identical(
    rows$modality_group[rows$ema_product_number == "EMEA/H/C/000885"],
    NA_character_
  )
  matches$reviewed[bridion] <- TRUE
  rows <- classify_fixture(no_curated_modalities(), matches)$tables$
    ema_medicine_modalities
  expect_identical(
    rows$modality[rows$ema_product_number == "EMEA/H/C/000885"],
    "small_molecule"
  )
})

test_that("EMA's INN-field slip is read as the active substance", {
  clean <- dplyr::tibble(
    ema_product_number = "EMEA/H/C/006797",
    name_of_medicine = "Vysribli (previously Denosumab Intas)",
    international_non_proprietary_name_common_name = "Vysribli",
    active_substance = "denosumab"
  )
  substances <- build_substances_table(clean)
  medicines <- dplyr::tibble(
    ema_product_number = "EMEA/H/C/006797",
    name_of_medicine = clean$name_of_medicine,
    medicine_status = "Authorised",
    advanced_therapy = FALSE,
    biosimilar = TRUE,
    pharmacotherapeutic_group_human = NA_character_
  )
  inputs <- modality_inputs(
    medicines, substances,
    dplyr::tibble(ema_product_number = character(),
                  active_substance = character()),
    dplyr::tibble(ema_product_number = character(), atc_code = character(),
                  current_atc_code = character()),
    dplyr::tibble(atc_code = character(), name = character())
  )
  expect_identical(inputs$substance_key, "denosumab")
  expect_identical(inputs$substance_basis, "inn")
})

test_that("medicines without INN keys use EMA's active substance text", {
  tables <- read_fixture_modality_tables()
  tables$ema_medicine_substances <- tables$ema_medicine_substances[0, ]
  tables$ema_medicine_active_substances <- dplyr::tibble(
    ema_product_number = "EMEA/H/C/000885",
    active_substance = "Sugammadex  Sodium"
  )
  inputs <- modality_inputs(
    tables$ema_medicines, tables$ema_medicine_substances,
    tables$ema_medicine_active_substances, tables$ema_medicine_atc_codes,
    tables$atc_classes
  )
  bridion <- inputs[inputs$ema_product_number == "EMEA/H/C/000885", ]
  expect_identical(bridion$substance_key, "sugammadex sodium")
  expect_identical(bridion$substance_basis, "active_substance")
})

modality_medicines <- function(advanced_therapy = FALSE, biosimilar = FALSE) {
  dplyr::tibble(
    ema_product_number = "P1",
    name_of_medicine = "Example",
    medicine_status = "Authorised",
    advanced_therapy = advanced_therapy,
    biosimilar = biosimilar
  )
}

modality_row <- function(group, modality) {
  dplyr::tibble(
    ema_product_number = "P1",
    substance_key = "x",
    modality_group = group,
    modality = modality
  )
}

test_that("check_modalities stops the build on impossible rows", {
  expect_invisible(check_modalities(
    modality_row("antibody", "adc"),
    modality_medicines()
  ))
  expect_error(
    check_modalities(modality_row("antibody", "sirna"), modality_medicines()),
    "outside its group"
  )
  expect_error(
    check_modalities(modality_row("unknown", NA), modality_medicines()),
    "unknown key"
  )
  expect_error(
    check_modalities(
      modality_row("protein", "enzyme"),
      modality_medicines(advanced_therapy = TRUE)
    ),
    "Advanced therapies"
  )
  expect_error(
    check_modalities(
      modality_row(NA, NA),
      modality_medicines(advanced_therapy = TRUE)
    ),
    "Advanced therapies"
  )
  expect_error(
    check_modalities(
      modality_row("small_molecule", "small_molecule"),
      modality_medicines(biosimilar = TRUE)
    ),
    "Biosimilars"
  )
})

test_that("the run summary lists counts, gaps, conflicts and reviews", {
  run <- classify_fixture()
  medicines <- read_fixture_modality_tables()$ema_medicines
  messages <- testthat::capture_messages(
    report_modality_summary(run, medicines)
  )
  summary <- paste(messages, collapse = "\n")
  expect_match(summary, "medicines \\(Authorised\\): small_molecule 9 \\(6\\)")
  expect_match(summary, "radiopharmaceutical 7 \\(3\\)")
  expect_match(summary, "not more specific 1 \\(0\\)")
  expect_match(summary, "Group only")
  expect_match(summary, "Emerflu")
  expect_match(summary, "Keys from a namesake or the WHO ATC name")
  expect_match(summary, "Modality conflicts")
  expect_match(summary, "not antibody/monoclonal_antibody by stem:-mab")
  expect_match(summary, "Curated modalities: [0-9]+ used")
  expect_match(summary, "the rules already agree with")
  expect_match(summary, "matching no medicine")
  # Tractocile, Kyprolis: ChEMBL "Protein" with a structure and no peptide
  # stem.
  expect_match(summary, "not used \\(review\\) \\(2\\)")
  # Elucirem: a small molecule without a structure.
  expect_match(summary, "without a structure, applied \\(review\\)")
  # Xultophy counts once as protein, and once in each of its modalities.
  expect_identical(
    modality_counts(run$classified$rows, medicines)[[2]],
    paste(
      "protein 4 (4) [peptide 2 (2), hormone_cytokine 2 (2),",
      "fusion_protein 1 (1)]"
    )
  )
})

test_that("the summary lists unclassified medicines, Authorised first", {
  run <- classify_fixture(curated = no_curated_modalities())
  medicines <- read_fixture_modality_tables()$ema_medicines
  messages <- paste(
    testthat::capture_messages(report_modality_summary(run, medicines)),
    collapse = "\n"
  )
  expect_match(messages, "Medicines with a substance not classified \\(2\\)")
  expect_match(messages, "Tractocile \\(EMEA/H/C/000253, Authorised\\)")
  expect_match(messages, "Curated modalities: 0 used")
  matches <- read_chembl_matches(fixture_chembl_matches_path())
  matches$ambiguity[matches$substance_key == "sugammadex"] <-
    "different_molecule_types"
  matches$variant_candidates[matches$substance_key == "trastuzumab"] <-
    list(data.frame(variant = "x"))
  matches$molecule_chembl_id[matches$substance_key == "trastuzumab"] <- NA
  run <- classify_fixture(no_curated_modalities(), matches)
  messages <- paste(
    testthat::capture_messages(report_modality_summary(run, medicines)),
    collapse = "\n"
  )
  expect_match(messages, "different molecule types, not applied")
  expect_match(messages, "variant candidates \\(review\\) \\(1\\)")
  matches <- matches[matches$substance_key != "anamorelin", ]
  run <- classify_fixture(no_curated_modalities(), matches)
  messages <- paste(
    testthat::capture_messages(report_modality_summary(run, medicines)),
    collapse = "\n"
  )
  expect_match(messages, "Keys missing from the ChEMBL matches file")
})

test_that("meta.json credits the INN stems, ChEMBL and the curated rows", {
  matches <- read_chembl_matches(fixture_chembl_matches_path())
  entries <- modality_source_entries(matches, curated_modalities())
  expect_length(entries, 3)
  expect_identical(
    entries[[1]]$name,
    "WHO INN stems"
  )
  expect_match(entries[[1]]$licence, "CC BY-NC-SA 3.0 IGO", fixed = TRUE)
  expect_match(entries[[1]]$licence, "all rights reserved", fixed = TRUE)
  expect_identical(entries[[2]]$version, "ChEMBL_37")
  expect_identical(entries[[2]]$retrieved, "2026-09-28")
  expect_match(entries[[2]]$attribution, "Mendez D. et al.", fixed = TRUE)
  expect_match(entries[[2]]$attribution, "ChEMBL_37", fixed = TRUE)
  expect_identical(entries[[3]]$version, "Checked 2026-09-29")
  without_chembl <- modality_source_entries(
    empty_chembl_matches(),
    curated_modalities()
  )
  expect_length(without_chembl, 2)
})
