# Modalities checked by hand (T0; .remember/modality/verification.md,
# 2026-09-29), for substances the rules classify wrongly or not at all:
# antibody formats old "-mab" names hide (bispecifics, fragments), ChEMBL
# records typed against the evidence, spelling slips of EMA's INN field and
# texts no rule reads. Each row quotes its evidence verbatim (at most 20
# words): EMA product information (section 2 or 5.1), an EPAR assessment
# report or scientific discussion, a ChEMBL record, or PubMed where EMA has
# no document yet. Policy rows follow the owner's decisions of 2026-09-29
# (modality-spec.md section 13): designed amino-acid chains are peptides,
# natural-product peptides and peptidomimetics small molecules (Q3);
# sugammadex and porfimer small molecules (Q4); romiplostim a fusion
# protein (Q5); efgartigimod alfa an other protein, lerodalcibep a fusion
# protein (Q8). Only `reviewed` rows apply; `ema_product_number` NA = every
# medicine with the key.
curated_modalities <- function() {
  document <- function(type, slug) {
    paste0(
      "https://www.ema.europa.eu/en/documents/", type, "/", slug, "_en.pdf"
    )
  }
  product_information <- function(name) {
    document(
      "product-information",
      paste0(name, "-epar-product-information")
    )
  }
  assessment_report <- function(name) {
    document(
      "assessment-report",
      paste0(name, "-epar-public-assessment-report")
    )
  }
  scientific_discussion <- function(name) {
    document(
      "scientific-discussion",
      paste0(name, "-epar-scientific-discussion")
    )
  }
  chembl_record <- function(id) {
    paste0("https://www.ebi.ac.uk/chembl/explore/compound/", id)
  }
  evidence_rows <- dplyr::tribble(
    ~substance_key, ~modality_group, ~modality, ~evidence_url, ~quote,
    "blinatumomab", "antibody", "bispecific_antibody",
    product_information("blincyto"),
    paste(
      "Blinatumomab is a bispecific T-cell engager molecule that binds",
      "specifically to CD19"
    ),
    "emicizumab", "antibody", "bispecific_antibody",
    product_information("hemlibra"),
    paste(
      "Emicizumab is a humanized monoclonal modified immunoglobulin G4 (IgG4)",
      "antibody with a bispecific antibody structure."
    ),
    "amivantamab", "antibody", "bispecific_antibody",
    product_information("rybrevant"),
    paste(
      "Amivantamab is a fully-human Immunoglobulin G1 (IgG1)-based bispecific",
      "antibody"
    ),
    "faricimab", "antibody", "bispecific_antibody",
    product_information("vabysmo"),
    "Faricimab is a humanised bispecific immunoglobulin G1 (IgG1) antibody",
    "mosunetuzumab", "antibody", "bispecific_antibody",
    product_information("lunsumio"),
    paste(
      "Mosunetuzumab is an anti-CD20/CD3 T-cell engaging bispecific antibody",
      "targeting CD20-expressing B-cells."
    ),
    "glofitamab", "antibody", "bispecific_antibody",
    product_information("columvi"),
    paste(
      "Glofitamab is a humanised anti-CD20/anti-CD3 bispecific monoclonal",
      "antibody"
    ),
    "epcoritamab", "antibody", "bispecific_antibody",
    product_information("tepkinly"),
    paste(
      "Epcoritamab is a humanised immunoglobulin G1 (IgG1)-bispecific",
      "antibody against CD3 and CD20 antigens"
    ),
    "teclistamab", "antibody", "bispecific_antibody",
    product_information("tecvayli"),
    paste(
      "Teclistamab is a humanised immunoglobulin G4-proline, alanine, alanine",
      "(IgG4-PAA) bispecific antibody"
    ),
    "talquetamab", "antibody", "bispecific_antibody",
    product_information("talvey"),
    paste(
      "Talquetamab is a immunoglobulin G4 proline, alanine, alanine (IgG4",
      "PAA) bispecific antibody"
    ),
    "elranatamab", "antibody", "bispecific_antibody",
    product_information("elrexfio"),
    paste(
      "Elranatamab is an IgG2 kappa bispecific antibody derived from two",
      "monoclonal antibodies (mAbs)."
    ),
    "tarlatamab", "antibody", "bispecific_antibody",
    product_information("imdylltra"),
    paste(
      "Tarlatamab is a bispecific delta-like ligand 3 (DLL3)-directed CD3",
      "T-cell engager"
    ),
    "catumaxomab", "antibody", "bispecific_antibody",
    product_information("korjuny"),
    paste(
      "specifically directed against the epithelial cell adhesion molecule",
      "(EpCAM) and the CD3 antigen"
    ),
    "zanidatamab", "antibody", "bispecific_antibody",
    product_information("ziihera"),
    "Zanidatamab is a humanised (IgG1) bispecific antibody",
    "linvoseltamab", "antibody", "bispecific_antibody",
    product_information("lynozyfic"),
    paste(
      "Linvoseltamab is a recombinant human immunoglobulin (Ig)G4-based",
      "bispecific antibody"
    ),
    "odronextamab", "antibody", "bispecific_antibody",
    product_information("ordspono"),
    paste(
      "Odronextamab is a recombinant human immunoglobulin (Ig)G4-based",
      "bispecific antibody that binds to CD20 and CD3."
    ),
    "gefurulimab", "antibody", "bispecific_antibody",
    "https://pubmed.ncbi.nlm.nih.gov/38142486/",
    paste(
      "Characterization of the bispecific VHH antibody gefurulimab (ALXN1720)",
      "targeting complement component 5"
    ),
    "ranibizumab", "antibody", "antibody_fragment",
    product_information("lucentis"),
    paste(
      "Ranibizumab is a humanised monoclonal antibody fragment produced in",
      "Escherichia coli cells"
    ),
    "brolucizumab", "antibody", "antibody_fragment",
    product_information("beovu"),
    paste(
      "Brolucizumab is a humanised monoclonal single-chain Fv (scFv) antibody",
      "fragment"
    ),
    "certolizumab pegol", "antibody", "antibody_fragment",
    product_information("cimzia"),
    paste(
      "Certolizumab pegol is a recombinant, humanised antibody Fab′ fragment",
      "against tumour necrosis factor alpha (TNFα)"
    ),
    "caplacizumab", "antibody", "antibody_fragment",
    product_information("cablivi"),
    paste(
      "Caplacizumab is a humanised bivalent Nanobody produced in Escherichia",
      "coli"
    ),
    "idarucizumab", "antibody", "antibody_fragment",
    product_information("praxbind"),
    paste(
      "It is a humanised monoclonal antibody fragment (Fab) that binds to",
      "dabigatran"
    ),
    "efungumab", "antibody", "antibody_fragment",
    document(
      "assessment-report",
      "mycograb-epar-refusal-public-assessment-report"
    ),
    paste(
      "a human-derived single chain variable antibody fragment which binds to",
      "the yeast antigen heat shock"
    ),
    "tisagenlecleucel", "cell_gene", "car_t",
    assessment_report("kymriah"),
    paste(
      "a patient’s own T cells with a transgene encoding a chimeric antigen",
      "receptor (CAR)"
    ),
    "dulaglutide", "protein", "fusion_protein",
    assessment_report("trulicity"),
    paste(
      "covalently linked to a modified human immunoglobulin G4 (IgG4) heavy",
      "chain fragment (Fc)"
    ),
    "albiglutide", "protein", "fusion_protein",
    assessment_report("eperzan"),
    paste(
      "genetic fusion of two tandem copies of modified human GLP 1 … to human",
      "albumin"
    ),
    "defibrotide", "nucleic_acid", "other_oligonucleotide",
    assessment_report("defitelio"),
    paste(
      "Defibrotide is a mixture of oligonucleotides obtained from porcine",
      "intestinal mucosa"
    ),
    "imetelstat", "nucleic_acid", "other_oligonucleotide",
    assessment_report("rytelo"),
    paste(
      "Imetelstat is a 13-nucleotide (13-mer) oligonucleotide with a",
      "covalently bound lipid tail"
    ),
    "pegaptanib", "nucleic_acid", "aptamer",
    scientific_discussion("macugen"),
    paste(
      "Pegaptanib is a pegylated modified oligonucleotide that binds with",
      "high specificity and affinity"
    ),
    "drotrecogin alfa (activated)", "protein", "enzyme",
    scientific_discussion("xigris"),
    paste(
      "The activated protein C is a protease belonging to the serine",
      "proteases family"
    ),
    "pentosan polysulfate sodium", "other", "polysaccharide",
    assessment_report("elmiron"),
    paste(
      "semi-synthetically produced heparin-like macromolecular carbohydrate",
      "derivative"
    ),
    "colestilan", "other", "polymer",
    assessment_report("bindren"),
    "Colestilan is a cross-linked polymeric anion exchange resin",
    "colesevelam", "other", "polymer",
    scientific_discussion("cholestagel"),
    paste(
      "Colesevelam is a novel non-absorbed, lipid-lowering polymer that binds",
      "bile acids in the intestine"
    ),
    "polihexanide", "other", "polymer",
    assessment_report("akantior"),
    paste(
      "Polihexanide is a polymeric active substance in the hydrochloride salt",
      "form."
    ),
    "icotrokinra hydrochloride", "protein", "peptide",
    assessment_report("icotyde"),
    "icotrokinra comprises 13 amino acids of which 9 are non-natural",
    "troriluzole", "small_molecule", "small_molecule",
    "https://www.ebi.ac.uk/chembl/api/data/molecule/CHEMBL4297586.json",
    "ChEMBL record: full_mwt 419.39; active_chembl_id CHEMBL744 (riluzole)",
    "yttrium [90y] chloride", "radiopharmaceutical",
    "therapeutic_radiopharmaceutical",
    scientific_discussion("ytracis"),
    paste(
      "a more optimal isotope for systemic radiotherapy … the high-energy",
      "beta emitter Yttrium-90"
    ),
    "serelaxin", "protein", "hormone_cytokine",
    assessment_report("reasanz"),
    paste(
      "identical in amino acid sequence and structure to the mature,",
      "naturally occurring human relaxin-H2"
    ),
    "mycobacterium tuberculosis derived antigens (rdesat-6 / rcfp-10)",
    "protein", "other_protein",
    product_information("siiltibcy"),
    paste(
      "SIILTIBCY contains two recombinant Mycobacterium tuberculosis specific",
      "antigens, rdESAT-6 and rCFP-10"
    ),
    "pancreas powder", "protein", "enzyme",
    paste0(assessment_report("enzepi"), "-0"),
    paste(
      "a pancreatic enzyme product (PEP) containing pancreas powder,",
      "extracted from porcine pancreatic glands"
    ),
    "voxilaprevi", "small_molecule", "small_molecule",
    chembl_record("CHEMBL3707372"),
    "ChEMBL: VOXILAPREVIR, Small molecule",
    "l-acetylleucine", "small_molecule", "small_molecule",
    chembl_record("CHEMBL56021"),
    "ChEMBL: LEVACETYLLEUCINE, Small molecule; ATC N07XX27 levacetylleucine",
    "potassium hydrogen carbonate", "small_molecule", "small_molecule",
    chembl_record("CHEMBL2106975"),
    "ChEMBL: POTASSIUM BICARBONATE, Small molecule",
    "dantrolene sodium, hemiheptahydrate", "small_molecule", "small_molecule",
    chembl_record("CHEMBL928"),
    "ChEMBL: DANTROLENE SODIUM, Small molecule",
    "zinc", "small_molecule", "small_molecule",
    chembl_record("CHEMBL3184986"),
    "ATC A16AX05 zinc acetate; ChEMBL ZINC ACETATE, Small molecule"
  ) |>
    dplyr::mutate(
      ema_product_number = NA_character_,
      checked_date = as.Date("2026-09-29"),
      reviewed = TRUE,
      note = NA_character_
    )
  product_rows <- dplyr::tribble(
    ~substance_key, ~ema_product_number, ~modality_group, ~modality,
    ~evidence_url, ~quote, ~note,
    "besilesomab", "EMEA/H/C/000653", "radiopharmaceutical",
    "diagnostic_radiopharmaceutical",
    product_information("scintimun"),
    paste(
      "The recommended activity of technetium (99mTc) besilesomab should be",
      "between 400 MBq and 800 MBq."
    ),
    "Scintimun's withdrawn application (no ATC code): as its namesake 001045"
  ) |>
    dplyr::mutate(checked_date = as.Date("2026-09-29"), reviewed = TRUE)
  policy_rows <- dplyr::tribble(
    ~substance_key, ~modality_group, ~modality, ~evidence_url, ~quote, ~note,
    "sugammadex", "small_molecule", "small_molecule",
    assessment_report("bridion"),
    paste(
      "Sugammadex sodium is a modified γ-cyclodextrin, which contains 8",
      "recurring glucose units"
    ),
    "Q4: a defined cyclodextrin, not a polysaccharide",
    "porfimer sodium", "small_molecule", "small_molecule",
    chembl_record("CHEMBL1201481"),
    "ChEMBL: PORFIMER SODIUM, Small molecule",
    "Q4: a porphyrin oligomer mixture, not a polymer",
    "carfilzomib", "small_molecule", "small_molecule",
    assessment_report("kyprolis"),
    "Carfilzomib is a tetrapeptide epoxyketone proteasome inhibitor",
    "Q3: peptidomimetic; ChEMBL types it Protein",
    "dalbavancin", "small_molecule", "small_molecule",
    assessment_report("xydalba"),
    paste(
      "Dalbavancin is a second generation semi-synthetic lipoglycopeptide",
      "antibiotic"
    ),
    "Q3: natural-product glycopeptide",
    "telavancin", "small_molecule", "small_molecule",
    chembl_record("CHEMBL507870"),
    "ChEMBL: TELAVANCIN, Protein, full_mwt 1755.66",
    "Q3: natural-product lipoglycopeptide",
    "romidepsin", "small_molecule", "small_molecule",
    chembl_record("CHEMBL343448"),
    "ChEMBL: ROMIDEPSIN, Protein, full_mwt 540.71",
    "Q3: natural-product depsipeptide",
    "ciclosporin", "small_molecule", "small_molecule",
    chembl_record("CHEMBL160"),
    "ChEMBL: CYCLOSPORINE, Protein, full_mwt 1202.63",
    "Q3: natural-product cyclic peptide",
    "voclosporin", "small_molecule", "small_molecule",
    chembl_record("CHEMBL5314379"),
    "ChEMBL: VOCLOSPORIN, Protein, full_mwt 1214.65",
    "Q3: ciclosporin analogue",
    "colistimethate sodium", "small_molecule", "small_molecule",
    product_information("colobreathe"),
    paste(
      "Colistimethate sodium (CMS) is a cyclic polypeptide antibacterial",
      "active substance"
    ),
    "Q3: natural-product polypeptide antibiotic",
    "romiplostim", "protein", "fusion_protein",
    assessment_report("nplate"),
    paste(
      "Romiplostim is a recombinant non-glycosylated Fc-peptide fusion",
      "protein (peptibody)"
    ),
    "Q5: not a natural signaling protein",
    "bulevirtide", "protein", "peptide",
    assessment_report("hepcludex"),
    paste(
      "Bulevirtide is a 47-amino acid long, N-terminally myristoylated,",
      "HBV-L-protein derived lipopeptide"
    ),
    "Q2: peptide without a 40-amino-acid limit",
    "lixisenatide", "protein", "peptide",
    "https://www.ebi.ac.uk/chembl/api/data/molecule/CHEMBL2108336.json",
    "ChEMBL sequence HGEGTFTSDLSKQMEEEAVRLFIEWLKNGGPSSGAPPSKKKKKK (44 aa)",
    "Q2: peptide without a 40-amino-acid limit"
  ) |>
    dplyr::mutate(
      ema_product_number = NA_character_,
      checked_date = as.Date("2026-09-29"),
      reviewed = TRUE
    )
  # No defaults for checked_date or reviewed: a block without them reaches
  # check_curated_modalities() as missing values, which stop the build.
  dplyr::bind_rows(
    evidence_rows,
    product_rows,
    policy_rows,
    curated_modality_fills()
  ) |>
    dplyr::select(
      "substance_key", "ema_product_number", "modality_group", "modality",
      "evidence_url", "quote", "checked_date", "reviewed", "note"
    )
}

# Values the rules leave open or get wrong, each quoted from the EMA
# document named (read 2026-09-29, at least 20 s apart; Rotashield, whose
# EPAR EMA removed, from the PubMed abstract of the ACIP recommendations
# on the same vaccine, RRV-TV): verification.md 4.3 and 4.4, lerodalcibep
# (Q8) and birch bark extract (ChEMBL types the extract "Small molecule"
# through its WHO name, betulae cortex).
curated_modality_fills <- function() {
  documents <- "https://www.ema.europa.eu/en/documents/"
  epar <- function(type, name) {
    paste0(documents, type, "/", name, "-epar-", type, "_en.pdf")
  }
  product_information <- function(name) epar("product-information", name)
  assessment_report <- function(name) {
    paste0(
      documents, "assessment-report/", name,
      "-epar-public-assessment-report_en.pdf"
    )
  }
  scientific_discussion <- function(name) epar("scientific-discussion", name)
  withdrawal_report <- function(name) {
    paste0(
      documents, "withdrawal-report/withdrawal-assessment-report-", name,
      "_en.pdf"
    )
  }
  withdrawal_questions <- function(name) {
    paste0(
      documents, "medicine-qa/questions-and-answers-withdrawal-marketing-",
      "application-", name, "_en.pdf"
    )
  }
  dplyr::tribble(
    ~substance_key, ~modality_group, ~modality, ~evidence_url, ~quote,
    "anakinra", "protein", "hormone_cytokine",
    product_information("kineret"),
    paste(
      "Human interleukin-1 receptor antagonist (r-metHuIL-1ra) produced in",
      "Escherichia coli cells by recombinant DNA technology."
    ),
    "metreleptin", "protein", "hormone_cytokine",
    product_information("myalepta"),
    "Metreleptin is a recombinant human leptin analogue",
    "pegvisomant", "protein", "hormone_cytokine",
    scientific_discussion("somavert"),
    "a pegylated recombinant analogue of the human growth hormone (GH)",
    "angiotensin ii", "protein", "peptide",
    assessment_report("giapreza"),
    "Angiotensin II, an endogenous octapeptide",
    "atosiban", "protein", "peptide",
    scientific_discussion("tractocile"),
    paste(
      "It contains atosiban, a synthetic peptide acting as an oxytocin",
      "antagonist."
    ),
    "bivalirudin", "protein", "peptide",
    scientific_discussion("angiox"),
    paste(
      "bivalirudin is a trifluoracetate salt of a synthetic 20 amino acid",
      "peptide"
    ),
    "difelikefalin", "protein", "peptide",
    assessment_report("kapruvia"),
    paste(
      "hydrophilic, synthetic D-amino acid peptide with high polar surface",
      "area and charge at physiological pH"
    ),
    "icatibant", "protein", "peptide",
    product_information("firazyr"),
    paste(
      "It is a synthetic decapeptide with a structure similar to bradykinin,",
      "but with 5 non-proteinogenic amino acids."
    ),
    "pegcetacoplan", "protein", "peptide",
    product_information("aspaveli"),
    paste(
      "a symmetrical molecule comprised of two identical pentadecapeptides",
      "covalently bound to the ends of a linear 40-kDa PEG molecule"
    ),
    "zilucoplan", "protein", "peptide",
    product_information("zilbrysq"),
    paste(
      "Zilucoplan is a 15 amino acid, synthetic macrocyclic peptide that",
      "inhibits the effects of the complement protein C5"
    ),
    "andexanet alfa", "protein", "other_protein",
    assessment_report("ondexxya"),
    paste(
      "Andexanet alfa is a modified human factor Xa (FXa) protein with 359",
      "amino acid residues lacking enzymatic activity"
    ),
    "conestat alfa", "protein", "other_protein",
    product_information("ruconest"),
    paste(
      "Conestat alfa is a recombinant analogue of the human C1 esterase",
      "inhibitor (rhC1-INH)"
    ),
    "desirudin", "protein", "other_protein",
    product_information("revasc"),
    paste(
      "Desirudin consists in a single chain polypeptide of 65 amino acid",
      "residues and 3 disulphide bridges."
    ),
    "lepirudin", "protein", "other_protein",
    scientific_discussion("refludan"),
    paste(
      "Lepirudin is a hirudin analogue produced in yeast cells transfected",
      "with an expression vector containing the hirudin gene."
    ),
    "efgartigimod alfa", "protein", "other_protein",
    product_information("vyvgart"),
    paste(
      "Efgartigimod alfa is a human recombinant immunoglobulin G1",
      "(IgG1)-derived Fc fragment"
    ),
    "entolimod", "protein", "other_protein",
    withdrawal_report("entolimod-tmc"),
    paste(
      "Entolimod is a recombinant biologic drug derived from the Salmonella",
      "typhimurium protein, FliC flagellin."
    ),
    "abicipar pegol", "protein", "other_protein",
    withdrawal_report("rayoqta"),
    paste(
      "a covalent conjugate of a designed ankyrin repeat protein (DARPin)",
      "produced in E. coli"
    ),
    "lerodalcibep", "protein", "fusion_protein",
    paste0(
      documents,
      "smop-initial/chmp-summary-positive-opinion-lyrokaul_en.pdf"
    ),
    paste(
      "Lerodalcibep is a fusion protein that binds proprotein convertase",
      "subtilisin/kexin type 9 (PCSK9)."
    ),
    "ocriplasmin", "protein", "enzyme",
    product_information("jetrea"),
    paste(
      "Ocriplasmin is a truncated form of human plasmin produced by",
      "recombinant DNA technology"
    ),
    "avacincaptad pegol", "nucleic_acid", "aptamer",
    withdrawal_report("izelvay"),
    paste(
      "Avacincaptad pegol is a chemically synthesised ribonucleic acid",
      "aptamer conjugated with polyethylene glycol (PEG)."
    ),
    "abetimus", "nucleic_acid", "other_oligonucleotide",
    withdrawal_questions("riquent"),
    paste(
      "Abetimus is a small piece of double-stranded DNA that has been",
      "designed to reduce circulating levels of these antibodies."
    ),
    "rotavirus vaccine", "vaccine", "live_vaccine",
    "https://pubmed.ncbi.nlm.nih.gov/10219046/",
    "an oral, live, tetravalent, rhesus-based rotavirus vaccine (RRV-TV)",
    "gbp510", "vaccine", "inactivated_vaccine",
    paste0(
      documents,
      "variation-report/skycovion-epar-withdrawal-assessment-report_en.pdf"
    ),
    paste(
      "the active substance RBD nanoparticle/Recombinant COVID-19 subunit",
      "nanoparticle"
    ),
    "oestrogens conjugated", "small_molecule", "small_molecule",
    assessment_report("duavive"),
    paste(
      "Conjugated Oestrogens is a mixture of different estrogenic substances",
      "isolated from pregnant mare’s urine."
    ),
    "amino acids", "small_molecule", "small_molecule",
    product_information("maapliv"),
    "Each 500 mL of solution contains 26.375 g of amino acids.",
    "palmitoyl-oleoyl phosphatidylglycerol", "small_molecule",
    "small_molecule",
    withdrawal_report("surfaxin"),
    "containing a target of 30 mg/ml phospholipids (DPPC, and POPG)",
    "1-13c-caprylic acid", "small_molecule", "small_molecule",
    withdrawal_questions("gastromotal"),
    paste(
      "is a natural chemical called caprylic acid that has been labelled",
      "with carbon-13 (13C)"
    ),
    "birch bark extract", "other", "plant_extract",
    product_information("filsuvez"),
    paste(
      "1 g of gel contains 100 mg of extract (as dry extract, refined) from",
      "Betula pendula Roth"
    )
  ) |>
    dplyr::mutate(
      # Rotashield only: another medicine named "rotavirus vaccine" (an
      # inactivated one, say) must not inherit "live".
      ema_product_number = dplyr::if_else(
        .data$substance_key == "rotavirus vaccine",
        "EMEA/H/C/000192",
        NA_character_
      ),
      checked_date = as.Date("2026-09-29"),
      reviewed = TRUE,
      note = dplyr::case_when(
        .data$substance_key == "rotavirus vaccine" ~ paste(
          "EMA removed Rotashield's EPAR; its medicine page",
          "(https://www.ema.europa.eu/en/medicines/human/EPAR/rotashield)",
          "names one rhesus and three reassortant rotavirus serotypes, i.e.",
          "RRV-TV, which the ACIP 1999 recommendations (MMWR 48(RR-2))",
          "call oral and live"
        ),
        .data$substance_key == "amino acids" ~
          "15 free amino acids and taurine (Maapliv), small molecules",
        .data$substance_key == "efgartigimod alfa" ~
          "Q8: an Fc fragment without a binding site, not an antibody fragment",
        .data$substance_key == "lerodalcibep" ~
          "Q8: an adnectin (-bep scaffold) fused to albumin",
        .default = NA_character_
      )
    )
}

# Build stops on a malformed row: a key that is not a lower-case substance
# key, an unknown group or a modality outside its group, no https evidence
# URL, no checked date, no review status (TRUE or FALSE), a reviewed row
# without a quote, or a key (and product) listed twice.
check_curated_modalities <- function(curated) {
  labels <- paste0(
    curated$substance_key,
    ifelse(
      is.na(curated$ema_product_number),
      "",
      paste0(" (", curated$ema_product_number, ")")
    )
  )
  malformed <- !is_substance_key(curated$substance_key) |
    is.na(curated$modality_group) |
    !is_valid_modality(curated$modality_group, curated$modality) |
    !startsWith(curated$evidence_url, "https://") %in% TRUE |
    is.na(curated$checked_date) |
    is.na(curated$reviewed) |
    (curated$reviewed %in% TRUE & is.na(curated$quote))
  if (any(malformed)) {
    cli::cli_abort(c(
      "Curated modalities need a lower-case substance key, a known group and
      modality, an https evidence URL, a checked date, a review status and,
      when reviewed, a quote.",
      x = "{.val {offender_values(labels[malformed])}}"
    ))
  }
  repeated <- duplicated(labels)
  if (any(repeated)) {
    cli::cli_abort(c(
      "Curated modalities list a key (and product) more than once.",
      x = "{.val {offender_values(labels[repeated])}}"
    ))
  }
  invisible(curated)
}
