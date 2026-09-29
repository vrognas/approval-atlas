# Copies EMA's data does not flag, checked by hand (2026-09-29) against the
# EPAR page named, whose overview says what the medicine is and names its
# reference medicine. Mostly hybrid medicines (Article 10(3) applications:
# copies that differ from their reference in strength, form, route, use or
# the way the active substance is made), which EMA's data has no flag for;
# also a generic and a biosimilar whose EMA flag is false. Without a row
# here each would count as a medicine of its own. Checked: the EPAR pages of
# every product counted from another company's medicine
# (other_company_reference, 56 on 2026-09-28), of Riulvy, Colchicine Agepha
# Pharma and Cuprior, and of Buvidal, Okedi and Camcevi. The quote is
# verbatim (at most 20 words) and names the copy type; `reference_name` is
# the reference medicine as the page names it. A reference authorised only
# nationally has no product number: the copy then has no reference found, as
# a generic of a national medicine.
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
    "EMEA/H/C/003756", "hybrid", NA, "Methotrexat Lederle injection",
    epar("jylamvo"),
    "Jylamvo is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/004005", "hybrid", NA,
    "Trientine Dihydrochloride 300 mg capsules", epar("cuprior"),
    "Cuprior contains the active substance trientine. It is a hybrid
    medicine.",
    NA,
    "EMEA/H/C/004071", "hybrid", NA, "Dectancyl", epar("neofordex"),
    "Neofordex contains the active substance dexamethasone. It is a
    ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/004109", "hybrid", "EMEA/H/C/000564", "Alimta",
    epar("armisarte"),
    "Armisarte is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/004335", "hybrid", NA, "Sufenta Forte", epar("dzuveo"),
    "It is a ‘hybrid medicine’. This means that it is similar to a
    ‘reference medicine’ (called Sufenta Forte)",
    NA,
    "EMEA/H/C/004407", "hybrid", "EMEA/H/C/000697", "Suboxone",
    epar("zubsolv"),
    "Zubsolv is a ‘hybrid medicine’.",
    NA,
    "EMEA/H/C/004416", "hybrid", NA, "Hydrocortisone Tablets Auden Mckenzie",
    epar("alkindi"),
    "Alkindi is a ‘hybrid medicine’.",
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
    "EMEA/H/C/005105", "hybrid", NA, "Hydrocortone tablets", epar("efmody"),
    "Efmody contains the active substance hydrocortisone and is a
    ‘hybrid medicine’.",
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
