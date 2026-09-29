# Copies EMA's data does not flag, checked by hand (2026-09-29) against the
# EPAR page named, whose overview says what the medicine is and names its
# reference medicine. Mostly hybrid medicines (Article 10(3) applications:
# copies that differ from their reference in strength, form, route, use or
# the way the active substance is made), which EMA's data has no flag for;
# also a generic and a biosimilar whose EMA flag is false. Without a row
# here each would count as a medicine of its own. Checked: the EPAR pages of
# every product counted from another company's medicine
# (other_company_reference, 56 on 2026-09-28), of Riulvy, Colchicine Agepha
# Pharma and Cuprior, of Buvidal, Okedi and Camcevi, and of every Authorised
# product counted as its own and protected or unclear (464 and 44,
# scripts/scan-epar-copies.R, 2026-09-29; the 44 unclear ones found Nordimet).
# The quote is verbatim (at most 20 words) and names the copy
# type; `reference_name` is the reference medicine as the page names it. A
# reference authorised only nationally has no product number: the copy then
# has no reference found, as a generic of a national medicine. A
# paediatric-use marketing authorisation is never listed here, even where its
# EPAR page calls it a hybrid (curated_puma_medicines()).
curated_copy_medicines <- function() {
  epar <- function(slug) {
    paste0("https://www.ema.europa.eu/en/medicines/human/EPAR/", slug)
  }
  dplyr::tribble(
    ~ema_product_number, ~copy_type, ~reference_product_number,
    ~reference_name, ~evidence_url, ~evidence_quote, ~note,
    "EMEA/H/C/002776", "hybrid", NA, "Metilénkék Pharmamagist",
    epar("lumeblue"),
    "Methylthioninium chloride Cosmo is a ‘hybrid medicine’.",
    "Lumeblue was called Methylthioninium chloride Cosmo; its reference is
    authorised in Hungary.",
    "EMEA/H/C/002826", "hybrid", NA, "Caryolysine", epar("ledaga"),
    "Ledaga is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/003756", "hybrid", NA, "Methotrexat Lederle injection",
    epar("jylamvo"),
    "Jylamvo is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/003983", "hybrid", NA, "Lantarel FS", epar("nordimet"),
    "Nordimet is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/004005", "hybrid", NA,
    "Trientine Dihydrochloride 300 mg capsules", epar("cuprior"),
    "Cuprior contains the active substance trientine. It is a hybrid
    medicine.",
    NA,
    "EMEA/H/C/004061", "hybrid", NA, "Xenbilox",
    epar("chenodeoxycholic-acid-leadiant"),
    "Chenodeoxycholic acid Leadiant is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/004071", "hybrid", NA, "Dectancyl", epar("neofordex"),
    "Neofordex contains the active substance dexamethasone. It is a
    ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/004109", "hybrid", "EMEA/H/C/000564", "Alimta",
    epar("armisarte"),
    "Armisarte is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/004325", "hybrid", NA, "Naloxon HCl B. Braun", epar("nyxoid"),
    "Nyxoid is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/004335", "hybrid", NA, "Sufenta Forte", epar("dzuveo"),
    "It is a ‘hybrid medicine’. This means that it is similar to a
    ‘reference medicine’ (called Sufenta Forte)",
    NA,
    "EMEA/H/C/004379", "hybrid", NA, "Daonil", epar("amglidia"),
    "Amglidia is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/004407", "hybrid", "EMEA/H/C/000697", "Suboxone",
    epar("zubsolv"),
    "Zubsolv is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/004651", "hybrid", NA, "Subutex", epar("buvidal"),
    "Buvidal contains the active substance buprenorphine and is a
    ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/004837", "hybrid", NA, "Hydrea", epar("xromi"),
    "Xromi contains the active substance hydroxycarbamide and is a
    ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/005034", "hybrid", NA, "Eligard", epar("camcevi"),
    "Camcevi is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/005055", "hybrid", NA, "Imurek", epar("jayempi"),
    "Jayempi is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/005105", "hybrid", NA, "Hydrocortone tablets", epar("efmody"),
    "Efmody contains the active substance hydrocortisone and is a
    ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/005173", "hybrid", NA, "Alkeran 50 mg/10 ml", epar("phelinun"),
    "Phelinun is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/005207", "hybrid", NA, "Remodulin", epar("trepulmix"),
    "Trepulmix is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/005220", "hybrid", NA, "Téatrois", epar("emcitate"),
    "Emcitate contains the active substance tiratricol and is a hybrid
    medicine.",
    NA,
    "EMEA/H/C/005320", "hybrid", NA, "Adriamycin",
    epar("zolsketil-pegylated-liposomal"),
    "Zolsketil pegylated liposomal contains the active substance doxorubicin
    and is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/005391", "hybrid", NA, "GlucaGen", epar("ogluo"),
    "Ogluo is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/005406", "hybrid", NA, "Risperdal", epar("okedi"),
    "Okedi is a type of medicine called a ‘hybrid medicine’.",
    "The reference is Risperdal tablets.",
    "EMEA/H/C/005435", "hybrid", "EMEA/H/C/001014", "Peyona",
    epar("gencebok"),
    "Gencebok is a ‘hybrid’ medicine.",
    NA,
    "EMEA/H/C/005535", "hybrid", NA, "Aldactone", epar("qaialdo"),
    "Qaialdo is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/005653", "hybrid", NA, "Entocort", epar("kinpeygo"),
    "Kinpeygo is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/005695", "hybrid", "EMEA/H/C/000435", "Zavesca",
    epar("opfolda"),
    "Opfolda is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/005715", "hybrid", "EMEA/H/C/000823", "Thalidomide BMS",
    epar("thalidomide-lipomed"),
    "Thalidomide Lipomed is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/005793", "hybrid", "EMEA/H/C/000425", "Forsteo",
    epar("teriparatide-sun"),
    "Teriparatide Sun is a ‘hybrid medicine’",
    NA,
    "EMEA/H/C/005896", "hybrid", "EMEA/H/C/000273", "Rapamune",
    epar("hyftor"),
    "Hyftor is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/005933", "hybrid", NA, "Xalatan", epar("catiolanze"),
    "Catiolanze is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/006009", "hybrid", NA, "Dantrium IV", epar("agilus"),
    "Agilus contains the active substance dantrolene and is a
    ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/006046", "generic", "EMEA/H/C/000885", "Bridion",
    epar("sugammadex-adroiq"),
    "Sugammadex Adroiq is a ‘generic medicine’.",
    NA,
    "EMEA/H/C/006188", "hybrid", NA, "Subutex",
    epar("buprenorphine-neuraxpharm"),
    "Buprenorphine Neuraxpharm contains the active substance buprenorphine
    and is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/006252", "biosimilar", "EMEA/H/C/000278", "Herceptin",
    epar("tuznue"),
    "Tuznue contains the active substance trastuzumab and is a biological
    medicine. It is a ‘biosimilar medicine’.",
    NA,
    "EMEA/H/C/006322", "hybrid", NA, "Sandostatin", epar("oczyesa"),
    "Oczyesa contains the active substance octreotide and is a
    ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/006324", "hybrid", NA, "Atropin-POS", epar("ryjunea"),
    "Ryjunea contains the active substance atropine sulfate and is a
    ‘hybrid’ medicine.",
    NA,
    "EMEA/H/C/006427", "hybrid", "EMEA/H/C/002601", "Tecfidera",
    epar("riulvy"),
    "Riulvy is a ‘hybrid medicine’.",
    "Another active substance: tegomil fumarate, Tecfidera's is dimethyl
    fumarate; both become monomethyl fumarate in the body.",
    "EMEA/H/C/006615", "hybrid", "EMEA/H/C/001026", "Victoza",
    epar("liraglutide-stada"),
    "Liraglutide STADA contains the active substance liraglutide and is a
    hybrid medicine.",
    NA,
    "EMEA/H/C/006620", "hybrid", "EMEA/H/C/003780", "Saxenda",
    epar("ablymico"),
    "Ablymico contains the active substance liraglutide and is a hybrid
    medicine.",
    NA,
    "EMEA/H/C/006653", "hybrid", NA, "Colchicine Tiofarma",
    epar("colchicine-agepha-pharma"),
    "Colchicine Agepha Pharma contains the active substance colchicine and
    is a hybrid medicine.",
    NA
  ) |>
    dplyr::mutate(
      reference_product_number = as.character(.data$reference_product_number),
      dplyr::across(c("evidence_quote", "note"), stringr::str_squish),
      checked_date = as.Date("2026-09-29"),
      .before = "note"
    ) |>
    dplyr::arrange(.data$ema_product_number)
}

# Paediatric-use marketing authorisations (PUMAs, Regulation (EC) No
# 1901/2006), checked by hand (2026-09-29) against each one's EMA public
# assessment report, which says the application was for one; EMA publishes
# no list of them. A PUMA has 8 + 2 years of data and market protection of
# its own (EMA's PUMA page), even where its application refers to a reference
# medicine as a hybrid, so the estimate counts it from its own approval and
# never as a copy (Alkindi, from 9 Feb 2018, not as a hybrid, nor from
# Plenadren's 2011; Slenyto not from Circadin's 2007). Checked: every
# medicine the EPAR copy scan found calling itself a hybrid (Amglidia and
# Ryjunea are no PUMAs), every curated copy by its indication (a PUMA is for
# children only; Gencebok, for preterm infants, is none), and Buccolam,
# Hemangiol, Sialanar, Slenyto, Pedmarqsi and Verkazia (none), older
# substances in medicines for children.
curated_puma_medicines <- function() {
  report <- function(slug, folder = "assessment-report") {
    paste0(
      "https://www.ema.europa.eu/en/documents/", folder, "/", slug,
      "-epar-public-assessment-report_en.pdf"
    )
  }
  quote <- function(use) {
    paste(
      "an application for a", use, "in accordance with Article 30 of",
      "Regulation (EC) No 1901/2006"
    )
  }
  hybrid_page <- "Its EPAR page calls it a hybrid medicine."
  dplyr::tribble(
    ~ema_product_number, ~evidence_url, ~evidence_quote, ~note,
    "EMEA/H/C/002267", report("buccolam"),
    quote("Paediatric Use Marketing Authorisation"), NA,
    "EMEA/H/C/002621", report("hemangiol"),
    quote("Paediatric Use Marketing Authorisation"), NA,
    "EMEA/H/C/003883", report("sialanar"),
    quote("Paediatric Use Marketing Authorisation"), NA,
    "EMEA/H/C/004416", report("alkindi"),
    quote("Paediatric Use marketing authorisation"), hybrid_page,
    "EMEA/H/C/004425", report("slenyto"),
    quote("Paediatric Use marketing authorisation"), NA,
    "EMEA/H/C/004534", report("kigabeq"),
    quote("Paediatric Use marketing authorisation"), hybrid_page,
    "EMEA/H/C/005130", report("pedmarqsi"),
    quote("Paediatric Use marketing authorisation"), NA,
    "EMEA/H/C/005731", report("aqumeldi"),
    quote("Paediatric Use marketing authorisation"), hybrid_page,
    "EMEA/H/C/005975", report("tuzulby", folder = "variation-report"),
    quote("Paediatric Use marketing authorisation"), hybrid_page,
    "EMEA/H/C/006044", report("neoatricon"),
    quote("paediatric use marketing authorisation"), hybrid_page,
    "EMEA/H/C/006617", report("bopediat"),
    quote("Paediatric Use marketing authorisation"), hybrid_page
  ) |>
    dplyr::mutate(
      note = as.character(.data$note),
      checked_date = as.Date("2026-09-29"),
      .before = "note"
    ) |>
    dplyr::arrange(.data$ema_product_number)
}
