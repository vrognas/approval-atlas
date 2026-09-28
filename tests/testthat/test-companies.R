# Holder names from the EMA medicines data and the Union Register
# (2026-09-27), including the risky cases of the 2026-09-28 experiment.

test_that("spelling and legal-entity variants fold to one company key", {
  folds <- list(
    c(
      "Merck Sharp & Dohme B.V.", "Merck Sharp and Dohme B.V",
      "Merck Sharp Dohme Ltd.", "Merck Sharp & Dohme Limited"
    ),
    c("AstraZeneca AB", "Astra Zeneca AB", "AstraZeneca"),
    c(
      "medac Gesellschaft für klinische Spezialpräparate mbH",
      "Medac Gesellschaft fuer klinische Spezialpraeparate mbH"
    ),
    c("Janssen-Cilag International NV", "Janssen Cilag International NV"),
    c("Roche Registration GmbH", "Roche Registration Limited"),
    c("Pfizer Europe MA EEIG", "Pfizer Limited", "Pfizer Ltd."),
    c(
      "Takeda Pharmaceuticals International AG Ireland Branch",
      "Takeda Pharmaceuticals International AG"
    ),
    c(
      "Menarini International Operations Luxembourg S.A. (MIOL)",
      "Menarini International Operations Luxembourg S.A."
    ),
    c("Bial - Portela Cª, S.A.", "BIAL - Portela & Ca, S.A."),
    c("N.V. Organon", "Organon N.V."),
    c("Krka, d.d., Novo mesto", "KRKA d.d.", "Krka"),
    c("Grünenthal GmbH", "Gruenenthal GmbH", "Grunenthal GmbH"),
    c("Sanofi B.V.", "Sanofi Belgium")
  )
  for (names in folds) {
    expect_length(unique(company_match_key(names)), 1)
  }
})

test_that("company keys keep unrelated companies apart", {
  apart <- list(
    c(
      "Merck Sharp & Dohme B.V.", "Merck Europe B.V.",
      "Merck Serono Europe Limited", "Organon N.V."
    ),
    c("Bausch Health Ireland Limited", "Bausch + Lomb Ireland Limited"),
    c(
      "Fresenius Kabi Deutschland GmbH",
      "Vifor Fresenius Medical Care Renal Pharma France"
    ),
    c("BeiGene Ireland Ltd", "Celgene Europe Ltd.", "Cangene Europe Limited"),
    c("Averoa", "Verona Pharma Ireland Limited"),
    c("Biogaran", "BioMarin International Limited"),
    c("Adienne S.r.l. S.U.", "Advicenne S.A."),
    c("Pharming Group N.V.", "Pharmion Ltd."),
    c("Biotest Pharma GmbH", "Biovest Europe Ltd"),
    c("BioNTech Manufacturing GmbH", "XBiotech Germany GmbH"),
    c("Sanofi Pasteur MSD, SNC", "Sanofi Pasteur", "Sanofi B.V."),
    c(
      "Sanofi Pharma Bristol-Myers Squibb",
      "Bristol-Myers Squibb / Pfizer EEIG",
      "Bristol-Myers Squibb Pharma EEIG"
    ),
    c("Novartis Europharm Limited", "Sandoz GmbH", "Hexal AG"),
    c("Abbott Laboratories Ltd.", "AbbVie Limited"),
    c("Baxter Holding B.V.", "Baxalta Innovations GmbH")
  )
  for (names in apart) {
    expect_length(unique(company_match_key(names)), length(names))
  }
})

test_that("generic words stay, so short names keep their brand", {
  expect_identical(
    company_slug(c(
      "Pharma Mar S.A.", "GE Healthcare AS", "Generics (UK) Limited",
      "Merck Sharp & Dohme B.V.", "Grünenthal GmbH",
      "Kamada BioPharma Limited at Fieldfisher LLP",
      "Genta Development Ltd. c/o Ross Craig", "Europe Ltd", NA
    )),
    c(
      "pharma-mar", "ge-healthcare", "generics", "merck-sharp-dohme",
      "gruenenthal", "kamada-biopharma", "genta-development", "europe", NA
    )
  )
  expect_identical(company_match_key("Grünenthal GmbH"), "grunenthal")
})

test_that("curated aliases fold misspellings and renames to one company", {
  aliases <- curated_company_aliases()
  folds <- list(
    # Union Register misspellings (Defitelio, Sixmo).
    c("Gentium S.r.l.", "Gentium S.r.I."),
    c(
      "L. Molteni & C. dei Fratelli Alitti Società di Esercizio S.p.A.",
      "L. Molteni & C. dei F.lli Alitti Società di .Esercizio .S.p.A"
    ),
    c("Krka", "KRKA d d., Novo mesto", "Krka, d.d., Novo mesto"),
    c(
      "INFAI, Institut für biomedizinische Analytik NMR-Imaging GmbH",
      "INFAI GmbH"
    ),
    c("Laboratoires CTRS - Boulogne Billancourt", "Theravia", "THERAVIA"),
    c(
      "Mitsubishi Tanabe Pharma GmbH", "Mitsubishi Tanabe Pharma Europe Ltd",
      "Tanabe Pharma GmbH"
    ),
    c("Aventis Pasteur MSD", "Pasteur Mà¨rieux MSD", "Sanofi Pasteur MSD, SNC")
  )
  for (names in folds) {
    expect_length(unique(aliased_company_key(names, aliases)), 1)
  }
})

test_that("a register holder name that is an address is recognised", {
  expect_identical(
    is_register_address(c(
      "Strawinskylaan 3051, 1077ZX Amsterdam, Nederland",
      "KRKA d d., Novo mesto",
      "Bayer AG",
      NA
    )),
    c(TRUE, FALSE, FALSE, FALSE)
  )
})

# Real products linked in the register fixture, with EMA holders as EMA
# lists them (Myozyme's before the Genzyme rename) and one without.
holder_medicines <- function() {
  dplyr::tibble(
    ema_product_number = paste0(
      "EMEA/H/C/", c("000210", "000636", "002329", "002776", "000697")
    ),
    name_of_medicine = c(
      "Pritor", "Myozyme", "Atosiban SUN",
      "Lumeblue (previously Methylthioninium chloride Cosmo)", "Suboxone"
    ),
    marketing_authorisation_date = as.Date(c(
      "1998-12-11", "2006-03-28", "2013-07-31", "2020-08-19", "2006-09-26"
    )),
    medicine_url = epar_page(c(
      "pritor", "myozyme", "atosiban-sun", "lumeblue", "suboxone"
    )),
    marketing_authorisation_developer_applicant_holder = c(
      "Bayer AG", "Genzyme Europe B.V.",
      "Sun Pharmaceutical Industries Europe B.V.", NA,
      "Indivior Europe Limited"
    )
  )
}

holder_row <- function(holders, product_number) {
  holders[holders$ema_product_number == product_number, ]
}

test_that("build_medicine_holders lets the register decide a changed holder", {
  holders <- build_medicine_holders(holder_medicines(), fixture_register())
  expect_named(
    holders,
    c(
      "ema_product_number", "holder_ema", "holder_register", "holder_used",
      "holder_basis", "country", "register_name_is_address"
    )
  )
  pritor <- holder_row(holders, "EMEA/H/C/000210")
  expect_identical(pritor$holder_register, NA_character_)
  expect_identical(pritor$holder_used, "Bayer AG")
  expect_identical(pritor$holder_basis, "ema")
  expect_identical(pritor$country, "DE")
  myozyme <- holder_row(holders, "EMEA/H/C/000636")
  expect_identical(myozyme$holder_ema, "Genzyme Europe B.V.")
  expect_identical(myozyme$holder_register, "Sanofi B.V.")
  expect_identical(myozyme$holder_used, "Sanofi B.V.")
  expect_identical(myozyme$holder_basis, "register")
  expect_identical(myozyme$country, "NL")
  # Not linked (MA dates two days apart): EMA's holder, no country.
  atosiban <- holder_row(holders, "EMEA/H/C/002329")
  expect_identical(atosiban$holder_basis, "ema")
  expect_identical(atosiban$country, NA_character_)
  # No EMA holder: the register's.
  lumeblue <- holder_row(holders, "EMEA/H/C/002776")
  expect_identical(lumeblue$holder_used, "Cosmo Technologies Ltd")
  expect_identical(lumeblue$holder_basis, "register")
})

test_that("a register name of the same company does not replace EMA's", {
  register <- fixture_register()
  is_pritor <- grepl("/h089\\.htm$", register$products$uri)
  medicines <- holder_medicines()
  is_pritor_medicine <- medicines$ema_product_number == "EMEA/H/C/000210"
  # Defitelio: the register misspells EMA's holder.
  medicines$marketing_authorisation_developer_applicant_holder[
    is_pritor_medicine
  ] <- "Gentium S.r.l."
  register$products$holder_name[is_pritor] <- "Gentium S.r.I."
  pritor <- holder_row(
    build_medicine_holders(medicines, register),
    "EMEA/H/C/000210"
  )
  expect_identical(pritor$holder_register, NA_character_)
  expect_identical(pritor$holder_used, "Gentium S.r.l.")
  expect_identical(pritor$holder_basis, "ema")
  # Sixmo: abbreviated and garbled in the register.
  medicines$marketing_authorisation_developer_applicant_holder[
    is_pritor_medicine
  ] <- "L. Molteni & C. dei Fratelli Alitti Società di Esercizio S.p.A."
  register$products$holder_name[is_pritor] <-
    "L. Molteni & C. dei F.lli Alitti Società di .Esercizio .S.p.A"
  pritor <- holder_row(
    build_medicine_holders(medicines, register),
    "EMEA/H/C/000210"
  )
  expect_identical(
    pritor$holder_used,
    "L. Molteni & C. dei Fratelli Alitti Società di Esercizio S.p.A."
  )
  # Another entity of the same company (Takeda's Irish branch) either.
  medicines$marketing_authorisation_developer_applicant_holder[
    is_pritor_medicine
  ] <- "Takeda Pharmaceuticals International AG"
  register$products$holder_name[is_pritor] <-
    "Takeda Pharmaceuticals International AG Ireland Branch"
  pritor <- holder_row(
    build_medicine_holders(medicines, register),
    "EMEA/H/C/000210"
  )
  expect_identical(pritor$holder_register, NA_character_)
  expect_identical(pritor$country, "DE")
})

test_that("a register holder name that is an address is not used", {
  register <- fixture_register()
  is_pritor <- grepl("/h089\\.htm$", register$products$uri)
  register$products$holder_name[is_pritor] <-
    "Kaiser-Wilhelm-Allee 1, 51373 Leverkusen, Deutschland"
  holders <- build_medicine_holders(holder_medicines(), register)
  pritor <- holder_row(holders, "EMEA/H/C/000210")
  expect_identical(pritor$holder_used, "Bayer AG")
  expect_identical(pritor$holder_basis, "ema")
  expect_true(pritor$register_name_is_address)
  expect_identical(sum(holders$register_name_is_address), 1L)
})

# ---- Company and group tables ----

test_holders <- function() {
  dplyr::tibble(
    ema_product_number = sprintf("EMEA/H/C/%06d", 1:14),
    holder_ema = c(
      "Merck Sharp & Dohme B.V.", "Merck Sharp and Dohme B.V",
      "Organon N.V.", "Sandoz GmbH", "Hexal AG", "Tour Hekla",
      "Recordati Rare Diseases", "FGK Representative Service GmbH",
      "FGK Representative Service GmbH", "Swedish Orphan Biovitrum AB (publ)",
      "Bristol-Myers Squibb / Pfizer EEIG", NA, "Pfizer Europe MA EEIG",
      "Bristol-Myers Squibb Pharma EEIG"
    ),
    holder_register = c(
      NA, NA, NA, NA, NA, "Recordati Rare Diseases", rep(NA, 8)
    ),
    holder_basis = c(rep("ema", 5), "register", rep("ema", 5), NA, "ema",
                     "ema"),
    country = c("NL", "NL", "NL", "AT", "DE", "FR", "FR", "DE", "DE", "SE",
                "IE", NA, "BE", "IE"),
    register_name_is_address = FALSE
  ) |>
    dplyr::mutate(
      holder_used = dplyr::coalesce(.data$holder_register, .data$holder_ema),
      .after = "holder_register"
    )
}

test_curated <- function(sponsors = curated_medicine_sponsors()) {
  list(
    groups = dplyr::tribble(
      ~group_key, ~name, ~monogram, ~lei, ~gleif_legal_name,
      ~gleif_ultimate_parent_lei, ~gleif_ultimate_parent, ~partners,
      "g.msd", "MSD (Merck & Co.)", "MSD", "4YV9Y5M8S0BRK1RP0397",
      "MERCK & CO., INC.", NA, NA, NA,
      "g.novartis", "Novartis", "NVS", "5493007HIVTX6SY6XD66", "NOVARTIS AG",
      NA, NA, NA,
      "g.sandoz", "Sandoz", "SDZ", NA, NA, NA, NA, NA,
      "g.pfizer", "Pfizer", "PFE", NA, NA, NA, NA, NA,
      "g.bristol-myers-squibb", "Bristol Myers Squibb", "BMS", NA, NA, NA,
      NA, NA,
      "g.bristol-myers-squibb-pfizer",
      "Bristol Myers Squibb and Pfizer (joint venture)", "BPF", NA, NA, NA,
      NA, "g.bristol-myers-squibb;g.pfizer",
      "g.recordati", "Recordati", "REC", NA, NA, NA, NA, NA
    ) |>
      dplyr::mutate(
        joint_venture = !is.na(.data$partners),
        .before = "partners"
      ) |>
      dplyr::mutate(other_partners = NA_character_, .after = "partners"),
    members = dplyr::tribble(
      ~group_key, ~holder, ~note, ~evidence_url,
      "g.msd", "Merck Sharp & Dohme B.V.", NA, NA,
      "g.sandoz", "Sandoz GmbH", NA, NA,
      "g.sandoz", "Hexal AG", NA, NA,
      "g.recordati", "Recordati Rare Diseases", NA, NA,
      "g.bristol-myers-squibb-pfizer", "Bristol-Myers Squibb / Pfizer EEIG",
      NA, NA,
      "g.pfizer", "Pfizer Europe MA EEIG", NA, NA,
      "g.bristol-myers-squibb", "Bristol-Myers Squibb Pharma EEIG", NA, NA,
      "g.novartis", "Novartis Europharm Limited", NA, NA
    ),
    aliases = dplyr::tribble(
      ~holder, ~company_holder, ~note,
      "Tour Hekla", "Recordati Rare Diseases", "An address line"
    ),
    representatives = dplyr::tibble(holder = "FGK Representative Service GmbH"),
    sponsors = sponsors,
    as_of = as.Date("2026-09-28")
  )
}

test_run <- function(holders = test_holders(),
                     gleif_matches = empty_gleif_matches(),
                     curated = test_curated()) {
  build_company_tables(
    holders,
    gleif_matches,
    as.Date("2026-09-27"),
    curated
  )
}

company_row <- function(companies, key) {
  companies[companies$key == key, ]
}

test_that("build_company_tables writes one row per medicine and company", {
  run <- test_run()
  medicines <- run$tables$ema_medicine_companies
  expect_named(
    medicines,
    c(
      "ema_product_number", "holder_ema", "holder_register", "holder_used",
      "holder_basis", "company_key", "group_key", "country", "source"
    )
  )
  expect_identical(nrow(medicines), 14L)
  expect_named(
    run$tables$companies,
    c(
      "key", "kind", "name", "group_key", "monogram", "joint_venture",
      "partners", "other_partners", "representative", "lei",
      "gleif_legal_name", "gleif_ultimate_parent", "gleif_ultimate_parent_lei",
      "member_holders", "original_holders", "sources", "as_of"
    )
  )
  expect_identical(
    medicines$company_key[1:3],
    c("c.merck-sharp-dohme", "c.merck-sharp-dohme", "c.organon")
  )
  expect_identical(
    medicines$group_key[1:5],
    c("g.msd", "g.msd", "g.organon", "g.sandoz", "g.sandoz")
  )
  expect_identical(
    medicines$source[1:3],
    c("curated", "curated", "holder_name")
  )
  # A medicine without any holder has no company.
  expect_identical(medicines$company_key[[12]], NA_character_)
})

test_that("companies take the spelling of most medicines and keep EMA's", {
  run <- test_run()
  companies <- run$tables$companies
  msd <- company_row(companies, "c.merck-sharp-dohme")
  expect_identical(msd$name, "Merck Sharp & Dohme B.V.")
  expect_identical(
    msd$member_holders[[1]],
    c("Merck Sharp & Dohme B.V.", "Merck Sharp and Dohme B.V")
  )
  expect_identical(msd$as_of, as.Date("2026-09-27"))
  # The alias folds Tour Hekla into Recordati Rare Diseases.
  recordati <- company_row(companies, "c.recordati-rare-diseases")
  expect_identical(
    recordati$member_holders[[1]],
    c("Recordati Rare Diseases", "Tour Hekla")
  )
  expect_identical(
    run$tables$ema_medicine_companies$company_key[6:7],
    c("c.recordati-rare-diseases", "c.recordati-rare-diseases")
  )
  expect_true("union_register" %in% recordati$sources[[1]])
})

test_that("EMA names of another company are original holders, not members", {
  holders <- dplyr::bind_rows(
    test_holders(),
    dplyr::tibble(
      ema_product_number = c("EMEA/H/C/000015", "EMEA/H/C/000016"),
      # Ioa: the register names MSD; Infinia: an address tail.
      holder_ema = c(
        "Organon N.V.",
        "Kamada BioPharma Limited at Fieldfisher LLP"
      ),
      holder_register = c("Merck Sharp & Dohme Limited", NA),
      holder_used = c(
        "Merck Sharp & Dohme Limited",
        "Kamada BioPharma Limited at Fieldfisher LLP"
      ),
      holder_basis = c("register", "ema"),
      country = c("GB", NA),
      register_name_is_address = FALSE
    )
  )
  companies <- test_run(holders)$tables$companies
  msd <- company_row(companies, "c.merck-sharp-dohme")
  expect_identical(
    msd$member_holders[[1]],
    c(
      "Merck Sharp & Dohme B.V.", "Merck Sharp & Dohme Limited",
      "Merck Sharp and Dohme B.V"
    )
  )
  expect_identical(msd$original_holders[[1]], "Organon N.V.")
  expect_identical(
    company_row(companies, "g.msd")$original_holders[[1]],
    "Organon N.V."
  )
  organon <- company_row(companies, "c.organon")
  expect_identical(organon$member_holders[[1]], "Organon N.V.")
  expect_identical(organon$original_holders[[1]], character())
  kamada <- company_row(companies, "c.kamada-biopharma")
  expect_identical(kamada$name, "Kamada BioPharma Limited")
  expect_identical(
    kamada$member_holders[[1]],
    "Kamada BioPharma Limited at Fieldfisher LLP"
  )
})

test_that("a curated alias never names a company, its target does", {
  garbled <- "Zaklady FarmaFarmaceutyczne Polpharma S.Aceutyczne Polpharma S.A."
  register_name <- "Zakłady Farmaceutyczne POLPHARMA S.A."
  holders <- dplyr::bind_rows(
    test_holders(),
    dplyr::tibble(
      ema_product_number = c("EMEA/H/C/000015", "EMEA/H/C/000016"),
      holder_ema = garbled,
      holder_register = register_name,
      holder_used = register_name,
      holder_basis = "register",
      country = "PL",
      register_name_is_address = FALSE
    )
  )
  curated <- test_curated()
  curated$aliases <- dplyr::add_row(
    curated$aliases,
    holder = garbled,
    company_holder = register_name
  )
  companies <- test_run(holders, curated = curated)$tables$companies
  polpharma <- company_row(companies, "c.zaklady-farmaceutyczne-polpharma")
  expect_identical(polpharma$name, register_name)
  expect_identical(
    polpharma$member_holders[[1]],
    sort(c(garbled, register_name))
  )
  # No medicine uses the target's spelling: it names the company anyway.
  garbled_only <- holders
  garbled_only$holder_register[15:16] <- NA
  garbled_only$holder_used[15:16] <- garbled
  garbled_only$holder_basis[15:16] <- "ema"
  companies <- test_run(garbled_only, curated = curated)$tables$companies
  polpharma <- company_row(companies, "c.zaklady-farmaceutyczne-polpharma")
  expect_identical(polpharma$name, register_name)
  expect_identical(polpharma$member_holders[[1]], garbled)
})

test_that("groups are curated, joint ventures or the company's own", {
  companies <- test_run()$tables$companies
  groups <- companies[companies$kind == "group", ]
  expect_setequal(
    groups$key,
    c(
      "g.msd", "g.organon", "g.sandoz", "g.recordati",
      "g.fgk-representative-service", "g.swedish-orphan-biovitrum",
      "g.bristol-myers-squibb-pfizer", "g.pfizer", "g.bristol-myers-squibb"
    )
  )
  msd <- company_row(companies, "g.msd")
  expect_identical(msd$name, "MSD (Merck & Co.)")
  expect_identical(msd$monogram, "MSD")
  expect_identical(msd$lei, "4YV9Y5M8S0BRK1RP0397")
  expect_identical(msd$as_of, as.Date("2026-09-28"))
  expect_identical(msd$group_key, NA_character_)
  joint_venture <- company_row(companies, "g.bristol-myers-squibb-pfizer")
  expect_true(joint_venture$joint_venture)
  expect_identical(
    joint_venture$partners[[1]],
    c("g.bristol-myers-squibb", "g.pfizer")
  )
  own <- company_row(companies, "g.swedish-orphan-biovitrum")
  expect_identical(own$name, "Swedish Orphan Biovitrum AB (publ)")
  # Not "SOB" (blocked).
  expect_identical(own$monogram, "SW")
  expect_identical(own$as_of, as.Date("2026-09-27"))
  expect_identical(anyDuplicated(groups$monogram), 0L)
  sandoz <- company_row(companies, "g.sandoz")
  expect_identical(
    sandoz$member_holders[[1]],
    c("Hexal AG", "Sandoz GmbH")
  )
})

test_that("regulatory representatives are flagged, not guessed", {
  run <- test_run()
  companies <- run$tables$companies
  fgk <- company_row(companies, "c.fgk-representative-service")
  expect_true(fgk$representative)
  expect_true(
    company_row(companies, "g.fgk-representative-service")$representative
  )
  expect_false(company_row(companies, "c.merck-sharp-dohme")$representative)
  messages <- testthat::capture_messages(
    report_company_summary(run, dplyr::tibble(
      ema_product_number = test_holders()$ema_product_number,
      medicine_status = "Authorised"
    ))
  )
  expect_match(
    messages,
    "0 medicines resolved to a sponsor, 2 held via a regulatory",
    all = FALSE
  )
})

test_sponsor <- function(reviewed = TRUE,
                         holder = "FGK Representative Service GmbH") {
  dplyr::tibble(
    ema_product_number = "EMEA/H/C/000008",
    holder = holder,
    sponsor = "Recordati Rare Diseases",
    sponsor_group_key = "g.recordati",
    evidence_url = "https://www.ema.europa.eu/en/documents/assessment-report/x",
    evidence_quote = "The applicant is part of the Recordati group.",
    checked_date = as.Date("2026-09-28"),
    reviewed = reviewed
  )
}

test_that("a reviewed sponsor row moves the medicine to the sponsor", {
  run <- test_run(curated = test_curated(test_sponsor()))
  medicine <- run$tables$ema_medicine_companies[8, ]
  expect_identical(medicine$holder_basis, "curated_sponsor")
  expect_identical(medicine$holder_used, "FGK Representative Service GmbH")
  expect_identical(medicine$company_key, "c.recordati-rare-diseases")
  expect_identical(medicine$group_key, "g.recordati")
  recordati <- company_row(run$tables$companies, "c.recordati-rare-diseases")
  expect_identical(
    recordati$original_holders[[1]],
    "FGK Representative Service GmbH"
  )
  # The other FGK medicine stays with the representative.
  expect_identical(
    run$tables$ema_medicine_companies$company_key[[9]],
    "c.fgk-representative-service"
  )
})

test_that("unreviewed and stale sponsor rows are not applied", {
  unreviewed <- test_run(curated = test_curated(test_sponsor(FALSE)))
  expect_identical(
    unreviewed$tables$ema_medicine_companies$holder_basis[[8]],
    "ema"
  )
  stale <- test_run(
    curated = test_curated(test_sponsor(holder = "CATS Consultants GmbH"))
  )
  expect_identical(
    stale$tables$ema_medicine_companies$holder_basis[[8]],
    "ema"
  )
  expect_identical(stale$sponsors_stale$ema_product_number, "EMEA/H/C/000008")
})

test_that("malformed sponsor rows stop the build", {
  long_quote <- test_sponsor()
  long_quote$evidence_quote <- paste(rep("word", 21), collapse = " ")
  expect_error(test_run(curated = test_curated(long_quote)), "EMEA/H/C/000008")
  plain_http <- test_sponsor()
  plain_http$evidence_url <- "http://example.org"
  expect_error(test_run(curated = test_curated(plain_http)), "https")
  extra_column <- dplyr::mutate(test_sponsor(), note = "x")
  expect_error(
    test_run(curated = test_curated(extra_column)),
    "other columns"
  )
})

gleif_row <- function(holder, lei, method = "exact", confidence = 0.99,
                      ultimate_parent_lei = NA_character_,
                      ultimate_parent_exception = NA_character_,
                      registration_status = "ISSUED",
                      reviewed = FALSE) {
  dplyr::tibble(
    holder = holder,
    country_hint = NA_character_,
    method = method,
    confidence = confidence,
    lei = lei,
    legal_name = toupper(holder),
    matched_name = toupper(holder),
    lei_country = NA_character_,
    entity_status = "ACTIVE",
    registration_status = registration_status,
    ultimate_parent_lei = ultimate_parent_lei,
    ultimate_parent_name = if (is.na(ultimate_parent_lei)) NA else "PARENT",
    ultimate_parent_registration_status = if (is.na(ultimate_parent_lei)) {
      NA
    } else {
      "ISSUED"
    },
    ultimate_parent_exception = ultimate_parent_exception,
    why = NA_character_,
    reviewed = reviewed,
    retrieved = "2026-09-28",
    source = "gleif"
  )
}

test_that("confident GLEIF matches that agree with the groups are applied", {
  matches <- dplyr::bind_rows(
    # MSD B.V. -> Merck & Co.: the curated group's LEI.
    gleif_row(
      "Merck Sharp & Dohme B.V.", "549300YUY8VFXLXSSB43",
      ultimate_parent_lei = "4YV9Y5M8S0BRK1RP0397"
    ),
    # Sandoz GmbH's lapsed LEI still names Novartis AG: another group's.
    gleif_row(
      "Sandoz GmbH", "529900KYQPVVZTT2RC96",
      ultimate_parent_lei = "5493007HIVTX6SY6XD66",
      registration_status = "LAPSED"
    ),
    # Its own top entity, no curated group.
    gleif_row(
      "Swedish Orphan Biovitrum AB (publ)", "549300124Y3MQI87PT35",
      ultimate_parent_exception = "NON_CONSOLIDATING"
    ),
    # Below the threshold: for review only.
    gleif_row(
      "Organon N.V.", "549300AMCKY57OK2CO56",
      method = "core", confidence = 0.56
    ),
    # A company without a curated group whose parent is a group's LEI.
    gleif_row(
      "Hexal AG", "HEXALLEI000000000000",
      ultimate_parent_lei = "5493007HIVTX6SY6XD66"
    )
  )
  run <- test_run(gleif_matches = matches)
  companies <- run$tables$companies
  msd <- company_row(companies, "c.merck-sharp-dohme")
  expect_identical(msd$lei, "549300YUY8VFXLXSSB43")
  expect_identical(msd$gleif_ultimate_parent_lei, "4YV9Y5M8S0BRK1RP0397")
  expect_true("gleif" %in% msd$sources[[1]])
  expect_identical(company_row(companies, "c.sandoz")$lei, NA_character_)
  sobi <- company_row(companies, "c.swedish-orphan-biovitrum")
  expect_identical(sobi$gleif_ultimate_parent_lei, "549300124Y3MQI87PT35")
  expect_identical(
    sobi$gleif_ultimate_parent,
    "SWEDISH ORPHAN BIOVITRUM AB (PUBL)"
  )
  # The own group carries its company's GLEIF data.
  expect_identical(
    company_row(companies, "g.swedish-orphan-biovitrum")$lei,
    "549300124Y3MQI87PT35"
  )
  expect_identical(company_row(companies, "c.organon")$lei, NA_character_)
  expect_identical(
    run$gleif$contradicts,
    c(FALSE, TRUE, FALSE, FALSE, TRUE)
  )
  messages <- testthat::capture_messages(report_company_summary(
    run,
    dplyr::tibble(
      ema_product_number = test_holders()$ema_product_number,
      medicine_status = "Authorised"
    )
  ))
  expect_match(
    messages,
    "GLEIF: 2 matches applied, 2 contradict the curated groups, 1 for review",
    all = FALSE
  )
  expect_match(messages, "Sandoz GmbH", all = FALSE)
})

test_that("a GLEIF parent that is a curated group's LEI assigns the group", {
  holders <- test_holders()
  holders$holder_ema[[5]] <- "Novartis Pharma GmbH"
  holders$holder_used[[5]] <- "Novartis Pharma GmbH"
  matches <- gleif_row(
    "Novartis Pharma GmbH", "529900LEI00000000000",
    ultimate_parent_lei = "5493007HIVTX6SY6XD66"
  )
  run <- test_run(holders, matches)
  medicine <- run$tables$ema_medicine_companies[5, ]
  expect_identical(medicine$group_key, "g.novartis")
  expect_identical(medicine$source, "gleif")
  lapsed <- matches
  lapsed$registration_status <- "LAPSED"
  expect_identical(
    test_run(holders, lapsed)$tables$ema_medicine_companies$group_key[[5]],
    "g.novartis-pharma"
  )
})

test_that("inconsistent curated data stops the build", {
  in_two_groups <- test_curated()
  in_two_groups$members <- dplyr::add_row(
    in_two_groups$members,
    group_key = "g.recordati",
    holder = "Sandoz GmbH"
  )
  expect_error(test_run(curated = in_two_groups), "two groups")

  duplicated_monogram <- test_curated()
  duplicated_monogram$groups$monogram[[2]] <- "MSD"
  expect_error(test_run(curated = duplicated_monogram), "monograms")

  unknown_partner <- test_curated()
  unknown_partner$groups$partners[[6]] <- "g.nobody"
  expect_error(test_run(curated = unknown_partner), "g.nobody")

  chained <- test_curated()
  chained$aliases <- dplyr::add_row(
    chained$aliases,
    holder = "Recordati Ireland Ltd",
    company_holder = "Tour Hekla"
  )
  expect_error(test_run(curated = chained), "aliases point to aliases")

  bad_key <- test_curated()
  bad_key$groups$group_key[[1]] <- "g.MSD"
  bad_key$members$group_key[[1]] <- "g.MSD"
  expect_error(test_run(curated = bad_key), "g.<slug>")

  duplicated_key <- test_curated()
  duplicated_key$groups$group_key[[2]] <- "g.msd"
  expect_error(test_run(curated = duplicated_key), "not unique")

  unknown_group <- test_curated()
  unknown_group$members$group_key[[1]] <- "g.nobody"
  expect_error(test_run(curated = unknown_group), "g.nobody")

  lone_venture <- test_curated()
  lone_venture$groups$partners[[6]] <- "g.pfizer"
  expect_error(test_run(curated = lone_venture), "both partners")
  named_partner <- lone_venture
  named_partner$groups$other_partners[[6]] <- "Fresenius Medical Care"
  joint_venture <- company_row(
    test_run(curated = named_partner)$tables$companies,
    "g.bristol-myers-squibb-pfizer"
  )
  expect_identical(joint_venture$partners[[1]], "g.pfizer")
  expect_identical(
    joint_venture$other_partners[[1]],
    "Fresenius Medical Care"
  )
})

test_that("check_company_tables lists the offenders", {
  tables <- test_run()$tables
  unmapped <- tables
  unmapped$ema_medicine_companies$group_key[[1]] <- NA
  expect_error(check_company_tables(unmapped), "EMEA/H/C/000001")

  duplicated_key <- tables
  duplicated_key$companies$key[[2]] <- duplicated_key$companies$key[[1]]
  expect_error(check_company_tables(duplicated_key), "not unique")

  empty_group <- tables
  empty_group$companies <- dplyr::bind_rows(
    empty_group$companies,
    dplyr::mutate(
      empty_group$companies[empty_group$companies$key == "g.msd", ],
      key = "g.empty",
      monogram = "EMP"
    )
  )
  expect_error(check_company_tables(empty_group), "g.empty")

  key_like <- tables
  key_like$companies$member_holders[[1]] <- "g.pfizer"
  expect_error(check_company_tables(key_like), "look like keys")

  unsafe <- tables
  unsafe$companies$key[[1]] <- "c.Bad Key"
  expect_error(check_company_tables(unsafe), "id-safe")

  is_group <- tables$companies$kind == "group"
  same_monogram <- tables
  same_monogram$companies$monogram[which(is_group)[1:2]] <- "MSD"
  expect_error(check_company_tables(same_monogram), "monograms")

  unknown_group <- tables
  # Hexal's group keeps Sandoz GmbH.
  unknown_group$companies$group_key[
    unknown_group$companies$key == "c.hexal"
  ] <- "g.nobody"
  expect_error(check_company_tables(unknown_group), "g.nobody")

  unknown_company <- tables
  unknown_company$ema_medicine_companies$company_key[[1]] <- "c.nobody"
  expect_error(check_company_tables(unknown_company), "c.nobody")

  shared_holder <- tables
  is_company <- which(shared_holder$companies$kind == "company")
  shared_holder$companies$member_holders[[is_company[[2]]]] <-
    shared_holder$companies$member_holders[[is_company[[1]]]]
  expect_error(check_company_tables(shared_holder), "in two companies")
})

test_that("an own group's key may not take a curated group's", {
  curated <- test_curated()
  curated$groups$group_key[curated$groups$group_key == "g.sandoz"] <-
    "g.organon"
  curated$members$group_key[curated$members$group_key == "g.sandoz"] <-
    "g.organon"
  expect_error(test_run(curated = curated), "Organon N.V.")
  # A new holder name of a curated group, not yet a member.
  holders <- test_holders()
  holders$holder_ema[[3]] <- "MSD Ireland Limited"
  holders$holder_used[[3]] <- "MSD Ireland Limited"
  expect_error(
    test_run(holders),
    "MSD Ireland Limited \\(g.msd\\): EMEA/H/C/000003"
  )
  expect_error(test_run(holders), "curated_group_members")
})

test_that("derive_monograms uses initials, then letters, never a taken one", {
  expect_identical(
    derive_monograms(
      c(
        "Swedish Orphan Biovitrum AB (publ)", "Santen Oy", "Sanofi B.V.",
        "Sandoz GmbH"
      ),
      taken = "SAN"
    ),
    c("SW", "SA", "SN", "SD")
  )
  # Words and codes that read as something else, and generic words.
  expect_identical(
    derive_monograms(
      c(
        "Univar Solutions BV", "Eurocept International B. V.",
        "Theratechnologies Europe Limited", "LABORATORIOS LORIEN, S.L",
        "BioPartners GmbH", "Pharma Mar S.A."
      ),
      taken = c("TH", "BI")
    ),
    c("UNI", "EUR", "TE", "LO", "BO", "MA")
  )
  expect_true(all(
    c("NOV", "PFI") %in% reserved_monograms(c("Novartis", "Pfizer"))
  ))
  expect_identical(first_free_monogram("Z", c("Z", "ZA")), "ZB")
  every_two <- paste0("Q", c(LETTERS, 0:9))
  expect_identical(
    derive_monograms("Qq", c("Q", "QQ", every_two)),
    "QAA"
  )
  # A name without letters or digits.
  expect_identical(derive_monograms("(-)", character()), "X")
  every_three <- paste0(
    "Q",
    as.vector(outer(c(LETTERS, 0:9), c(LETTERS, 0:9), paste0))
  )
  expect_error(
    first_free_monogram("Q", c(every_two, every_three)),
    "No free monogram"
  )
})

test_that("the curated company data is consistent", {
  curated <- curated_company_data()
  expect_silent(check_curated_companies(curated))
  expect_identical(anyDuplicated(curated$groups$monogram), 0L)
  expect_true(all(grepl(monogram_pattern, curated$groups$monogram)))
  expect_identical(nrow(curated$sponsors), 0L)
  memberships <- curated_memberships(curated, curated$sponsors)
  group_of <- function(holder) {
    memberships$group_key[
      memberships$company_match ==
        aliased_company_key(holder, curated$aliases)
    ]
  }
  # Risky pairs stay in different groups.
  expect_identical(group_of("Merck Sharp & Dohme B.V."), "g.msd")
  expect_identical(group_of("Merck Europe B.V."), "g.merck-kgaa")
  expect_identical(group_of("Organon N.V."), "g.organon")
  expect_identical(group_of("Sandoz GmbH"), "g.sandoz")
  expect_identical(group_of("Novartis Europharm Limited"), "g.novartis")
  expect_identical(group_of("Celgene Europe BV"), "g.bristol-myers-squibb")
  expect_identical(
    group_of("Bristol-Myers Squibb / Pfizer EEIG"),
    "g.bristol-myers-squibb-pfizer"
  )
  expect_identical(group_of("Kite Pharma EU B.V."), "g.gilead")
  expect_identical(group_of("Upjohn EESV"), "g.viatris")
  expect_identical(
    group_of("Biosimilar Collaborations Ireland Limited"),
    "g.biocon"
  )
  expect_identical(
    group_of("Vifor Fresenius Medical Care Renal Pharma France"),
    "g.vifor-fresenius-medical-care"
  )
  expect_identical(group_of("Fresenius Kabi Deutschland GmbH"), "g.fresenius")
  # Novartis's influenza vaccines went to CSL, its other vaccines to GSK.
  expect_identical(
    group_of("Novartis Vaccines and Diagnostics S.r.l."),
    "g.csl"
  )
  expect_identical(group_of("Chiron S.p.A."), "g.gsk")
  expect_identical(group_of("Gentium S.r.I."), "g.jazz")
  expect_identical(group_of("Mabxience Research SL"), "g.fresenius")
  expect_identical(group_of("Galpharm Healthcare Ltd."), "g.perrigo")
  expect_identical(group_of("Cassiopea S.p.A."), "g.cosmo")
  expect_identical(group_of("Aventis Pasteur MSD"), "g.sanofi-pasteur-msd")
  groups <- curated$groups
  expect_true(all(groups$joint_venture == (
    !is.na(groups$partners) | !is.na(groups$other_partners)
  )))
  is_vifor_venture <- groups$group_key == "g.vifor-fresenius-medical-care"
  expect_identical(
    groups$other_partners[is_vifor_venture],
    "Fresenius Medical Care"
  )
  representative_keys <- aliased_company_key(
    curated$representatives$holder,
    curated$aliases
  )
  expect_true(all(company_match_key(c(
    "TMC Pharma (EU) Limited", "Integral Pharma Solutions EU Limited",
    "Sciencepharma Sp. z o.o"
  )) %in% representative_keys))
})

test_that("company_source_entries credit the register, GLEIF and curation", {
  register_source <- list(
    url = union_register_url,
    last_modified = "Fri, 25 Sep 2026 15:36:55 GMT",
    retrieved = "2026-09-26T15:31:22Z"
  )
  entries <- company_source_entries(
    register_source,
    gleif_row("Bayer AG", "549300J4U55H3WP1XT59")
  )
  expect_length(entries, 3)
  expect_match(entries[[1]]$attribution, "addresses are not", fixed = TRUE)
  expect_identical(entries[[2]]$retrieved, "2026-09-28")
  expect_match(entries[[2]]$licence, "CC0", fixed = TRUE)
  # The oldest response any match rests on.
  older <- dplyr::bind_rows(
    gleif_row("Bayer AG", "549300J4U55H3WP1XT59"),
    dplyr::mutate(
      gleif_row("Pfizer Limited", "PFIZERLEI0000000000"),
      retrieved = "2026-08-30"
    )
  )
  expect_identical(
    company_source_entries(register_source, older)[[2]]$retrieved,
    "2026-08-30"
  )
  expect_match(entries[[3]]$version, "2026-09-28", fixed = TRUE)
  expect_length(
    company_source_entries(register_source, empty_gleif_matches()),
    2
  )
})

test_that("report_company_summary warns about stale curated rows", {
  curated <- test_curated()
  curated$members <- dplyr::add_row(
    curated$members,
    group_key = "g.msd",
    holder = "Schering-Plough Europe"
  )
  holders <- test_holders()
  holders$register_name_is_address[[1]] <- TRUE
  run <- test_run(holders, curated = curated)
  messages <- testthat::capture_messages(report_company_summary(
    run,
    dplyr::tibble(
      ema_product_number = holders$ema_product_number,
      medicine_status = c(rep("Authorised", 6), rep("Withdrawn", 8))
    )
  ))
  expect_match(
    messages,
    paste0(
      "Companies: 10 companies in 9 groups \\(6 curated\\); curated groups ",
      "hold 9 of 13 medicines with a holder \\(5 of 6 Authorised\\)"
    ),
    all = FALSE
  )
  expect_match(messages, "Schering-Plough Europe", all = FALSE)
  expect_match(messages, "1 Union Register holder name", all = FALSE)
})
