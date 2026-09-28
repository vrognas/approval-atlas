# Curated company data (user decisions 2026-09-28). A group is the operating
# company people know (not a family holding, private-equity vehicle or state
# agency: GLEIF's literal ultimate parent is kept as provenance), as of
# `curated_companies_as_of`: current owner only. Joint ventures are their own
# group, with the partner groups listed. Holders are named as EMA or the
# Union Register spell them; every holder that folds to the same company
# (company_match_key()) follows. Notes are UI copy: U.S. spelling, no
# em-dashes; evidence quotes stay verbatim.
curated_companies_as_of <- as.Date("2026-09-28")

curated_company_data <- function() {
  list(
    groups = curated_company_groups(),
    members = curated_group_members(),
    aliases = curated_company_aliases(),
    representatives = curated_representatives(),
    sponsors = curated_medicine_sponsors(),
    medicine_groups = curated_medicine_groups(),
    medicine_notes = curated_medicine_notes(),
    as_of = curated_companies_as_of
  )
}

# lei: the operating company's LEI; gleif_ultimate_parent(_lei): GLEIF's
# ultimate parent where it differs (a holding). Partners: group keys,
# separated by ";".
curated_company_groups <- function() {
  dplyr::tribble(
    ~group_key, ~name, ~monogram, ~lei, ~gleif_legal_name,
    ~gleif_ultimate_parent_lei, ~gleif_ultimate_parent, ~partners,
    "g.novartis", "Novartis", "NVS", "5493007HIVTX6SY6XD66", "NOVARTIS AG",
    NA, NA, NA,
    "g.sandoz", "Sandoz", "SDZ", NA, NA, NA, NA, NA,
    "g.pfizer", "Pfizer", "PFE", "765LHXWGK1KXCLTFYQ30", "PFIZER INC.",
    NA, NA, NA,
    "g.intas", "Intas (Accord Healthcare)", "INT", "335800BL323XQZHTQA07",
    "INTAS PHARMACEUTICALS LIMITED", NA, NA, NA,
    "g.msd", "MSD (Merck & Co.)", "MSD", "4YV9Y5M8S0BRK1RP0397",
    "MERCK & CO., INC.", NA, NA, NA,
    "g.teva", "Teva", "TEVA", "549300BAFGM4RC74ZJ94",
    "TEVA PHARMACEUTICAL INDUSTRIES LIMITED", NA, NA, NA,
    "g.johnson-johnson", "Johnson & Johnson", "JNJ", "549300G0CFPGEF6X2043",
    "Johnson & Johnson", NA, NA, NA,
    "g.astrazeneca", "AstraZeneca", "AZ", "PY6ZZQWO2IZFZC3IOL08",
    "ASTRAZENECA PLC", NA, NA, NA,
    "g.roche", "Roche", "RO", "549300U41AUUVOAAOB37", "Roche Holding AG",
    NA, NA, NA,
    "g.sanofi", "Sanofi", "SNY", "549300E9PC51EN656011", "SANOFI",
    NA, NA, NA,
    "g.eli-lilly", "Eli Lilly", "LLY", "FRDRIPF3EKNDJ2CQJL29",
    "ELI LILLY AND COMPANY", NA, NA, NA,
    "g.viatris", "Viatris", "VTRS", "254900ZZTSW7NL773X71", "VIATRIS INC.",
    NA, NA, NA,
    "g.bristol-myers-squibb", "Bristol Myers Squibb", "BMS",
    "HLYYNH7UQUORYSJQCN42", "BRISTOL-MYERS SQUIBB COMPANY", NA, NA, NA,
    "g.novo-nordisk", "Novo Nordisk", "NN", "549300DAQ1CVT6CXN342",
    "NOVO NORDISK A/S", NA, NA, NA,
    "g.krka", "Krka", "KRK", "549300H9RLRTRTLRUZ73",
    "KRKA, tovarna zdravil, d.d., Novo mesto", NA, NA, NA,
    "g.gilead", "Gilead", "GILD", "549300WTZWR07K8MNV44",
    "GILEAD SCIENCES, INC.", NA, NA, NA,
    "g.bayer", "Bayer", "BAY", "549300J4U55H3WP1XT59",
    "Bayer Aktiengesellschaft", NA, NA, NA,
    "g.gsk", "GSK", "GSK", "5493000HZTVUYLO1D793", "GSK PLC", NA, NA, NA,
    "g.boehringer-ingelheim", "Boehringer Ingelheim", "BI",
    "529900UYZPE4QQMRRE87", "Boehringer Ingelheim International GmbH",
    "529900P5FAANZASUYL28", "C.H. Boehringer Sohn AG & Co. KG", NA,
    "g.amgen", "Amgen", "AMGN", "62QBXGPJ34PQ72Z12S66", "AMGEN INC.",
    NA, NA, NA,
    "g.abbvie", "AbbVie", "ABBV", "FR5LCKFTG8054YNNRU85", "ABBVIE INC.",
    NA, NA, NA,
    "g.gedeon-richter", "Gedeon Richter", "GR", NA, NA, NA, NA, NA,
    "g.stada", "STADA", "STA", "529900FMTTLMH0P0DL10",
    "STADA Arzneimittel Aktiengesellschaft", "3912004KLYMNXGEH1855",
    "Nidda German Topco GmbH", NA,
    "g.zentiva", "Zentiva", "ZEN", NA, NA, NA, NA, NA,
    "g.celltrion", "Celltrion", "CEL", NA, NA, NA, NA, NA,
    "g.ucb", "UCB", "UCB", "2138008J191VLSGY5A09", "U C B", NA, NA, NA,
    "g.servier", "Servier", "SRV", "969500Y8PG1HQ9Y6NA31",
    "LES LABORATOIRES SERVIER", NA, NA, NA,
    "g.sun-pharma", "Sun Pharma", "SUN", "335800KJ7GE29LB4SS73",
    "SUN PHARMACEUTICAL INDUSTRIES LIMITED", NA, NA, NA,
    "g.chiesi", "Chiesi", "CHI", "8156009817CA59AD8106",
    "CHIESI FARMACEUTICI S.P.A.", "815600A07AD23F71D845", "VALLINE S.R.L.",
    NA,
    "g.takeda", "Takeda", "TAK", "549300ZLMVP4X0OGR454",
    "Takeda Pharmaceutical Company Limited", NA, NA, NA,
    "g.biocon", "Biocon Biologics", "BCB", NA, NA, NA, NA, NA,
    "g.astellas", "Astellas", "AST", "529900IB708DY2HBBB35",
    "Astellas Pharma Inc.", NA, NA, NA,
    "g.fresenius", "Fresenius", "FRE", "XDFJ0CYCOO1FXRFTQS51",
    "Fresenius SE & Co. KGaA", NA, NA, NA,
    "g.samsung-bioepis", "Samsung Bioepis", "SB", NA, NA, NA, NA, NA,
    "g.merck-kgaa", "Merck KGaA", "MKG", NA, NA, NA, NA, NA,
    "g.organon", "Organon", "OGN", "549300AMCKY57OK2CO56", "ORGANON & CO.",
    NA, NA, NA,
    "g.sobi", "Sobi", "SOBI", "549300124Y3MQI87PT35",
    "Swedish Orphan Biovitrum AB (publ)", NA, NA, NA,
    "g.csl", "CSL", "CSL", "529900ECSECK5ZDQTE14", "CSL LIMITED",
    NA, NA, NA,
    "g.recordati", "Recordati", "REC", "815600FBF92FD3531704",
    paste(
      "RECORDATI INDUSTRIA CHIMICA E FARMACEUTICA S.P.A. IN BREVE",
      "RECORDATI S.P.A."
    ),
    NA, NA, NA,
    "g.pierre-fabre", "Pierre Fabre", "PF", "969500ROQWSNEW8T9489",
    "PIERRE FABRE MEDICAMENT", "969500N6YMBRQ1GZKJ27",
    "PIERRE FABRE PARTICIPATIONS", NA,
    "g.medac", "medac", "MDC", "529900CYHUGUOZJN0I17",
    "Medac Gesellschaft für klinische Spezialpräparate m.b.H.",
    NA, NA, NA,
    "g.biogen", "Biogen", "BIIB", "W8J5WZB5IY3K0NDQT671", "BIOGEN INC.",
    NA, NA, NA,
    "g.otsuka", "Otsuka", "OTS", NA, NA, NA, NA, NA,
    "g.advanz", "Advanz Pharma", "ADV", NA, NA, NA, NA, NA,
    "g.biomarin", "BioMarin", "BMRN", "NSLL8ITTRR0J5HEMR848",
    "BIOMARIN PHARMACEUTICAL INC.", NA, NA, NA,
    "g.neuraxpharm", "Neuraxpharm", "NXP", "959800C6U9VUWDQL8408",
    "NEURAXPHARM PHARMACEUTICALS S.L.(SOCIEDAD UNIPERSONAL)", NA, NA, NA,
    "g.daiichi-sankyo", "Daiichi Sankyo", "DS", "353800XGIU2IHQGC9504",
    "Daiichi Sankyo Co., Ltd.", NA, NA, NA,
    "g.orion", "Orion", "ORN", "74370029VAHCXDR7B745", "Orion Oyj",
    NA, NA, NA,
    "g.cheplapharm", "Cheplapharm", "CHP", "529900ONXKBELT7EW052",
    "Cheplapharm Arzneimittel GmbH", "529900GBPA5Q6JIBEO60",
    "Braun Invest Holding GmbH", NA,
    "g.ipsen", "Ipsen", "IPS", "549300M6SGDPB4Z94P11", "IPSEN", NA, NA, NA,
    "g.esteve", "Esteve", "EST", "95980020140005174448",
    "ESTEVE PHARMACEUTICALS S.A.", "959800YD5H9DYP7YT664",
    "ESTEVE HEALTHCARE S.L.", NA,
    "g.incyte", "Incyte", "INCY", NA, NA, NA, NA, NA,
    "g.curium", "Curium", "CUR", NA, NA, NA, NA, NA,
    "g.menarini", "Menarini", "MEN", "8156002DC6B01873B624",
    "A. MENARINI - INDUSTRIE FARMACEUTICHE RIUNITE - S.R.L.", NA, NA, NA,
    "g.kyowa-kirin", "Kyowa Kirin", "KK", NA, NA, NA, NA, NA,
    "g.abbott", "Abbott", "ABT", "HQD377W2YR662HK5JX27",
    "ABBOTT LABORATORIES", NA, NA, NA,
    "g.vertex", "Vertex", "VRTX", NA, NA, NA, NA, NA,
    "g.almirall", "Almirall", "ALM", "95980020140005007996", "ALMIRALL S.A.",
    NA, NA, NA,
    "g.lundbeck", "Lundbeck", "LUN", "5493006R4KC2OI5D3470",
    "H. LUNDBECK A/S", "254900JH964PYU6MC463", "LUNDBECKFONDEN", NA,
    "g.leo-pharma", "LEO Pharma", "LEO", "52990077KVK7QCK2NG31",
    "LEO Pharma A/S", NA, NA, NA,
    "g.grunenthal", "Grünenthal", "GRT", "529900SH895E31PGLA72",
    "Grünenthal GmbH", NA, NA, NA,
    "g.theramex", "Theramex", "TMX", NA, NA, NA, NA, NA,
    "g.eisai", "Eisai", "EIS", NA, NA, NA, NA, NA,
    "g.jazz", "Jazz Pharmaceuticals", "JAZZ", "635400GAUMJCLEZRRV50",
    "Jazz Pharmaceuticals Public Limited Company", NA, NA, NA,
    "g.dr-reddys", "Dr. Reddy's", "RDY", NA, NA, NA, NA, NA,
    "g.perrigo", "Perrigo", "PRGO", NA, NA, NA, NA, NA,
    "g.glenmark", "Glenmark", "GMK", "335800WKECZXIIT9GK20",
    "GLENMARK PHARMACEUTICALS LIMITED", NA, NA, NA,
    "g.merz", "Merz", "MRZ", NA, NA, NA, NA, NA,
    "g.acino", "Acino", "ACI", NA, NA, NA, NA, NA,
    "g.dompe", "Dompé", "DOM", "81560052D172F2DBC326",
    "DOMPE' FARMACEUTICI - S.P.A.", "815600E2AFF2628FE804",
    "DOMPE' HOLDINGS SRL", NA,
    "g.bracco", "Bracco", "BRC", "529900P0D461YTTYPQ07",
    "BRACCO IMAGING S.P.A.", "549300IPJJS0DK6UEY77", "BRACCO S.P.A.", NA,
    "g.cosmo", "Cosmo Pharmaceuticals", "COS", "724500OX0EBQRYTVV639",
    "COSMO Pharmaceuticals N.V.", NA, NA, NA,
    "g.pharming", "Pharming", "PHAR", "724500DCJ9MPG74JEH91",
    "Pharming Group N.V.", NA, NA, NA,
    "g.haleon", "Haleon", "HLN", "549300PSB3WWEODCUP19", "HALEON PLC",
    NA, NA, NA,
    "g.zydus", "Zydus Lifesciences", "ZYD", NA, NA, NA, NA, NA,
    # The current owners of medicines whose later holder only the Union
    # Register names (Optimark, Thorinane): curated_medicine_groups().
    "g.guerbet", "Guerbet", "GBT", "969500WV1U1WQ059L135", "GUERBET",
    NA, NA, NA,
    "g.techdow", "Techdow", "TDW", NA, NA, NA, NA, NA,
    # Live joint ventures only (user decision 2026-09-28): each still holds
    # an authorised medicine (Eliquis, Vaxelis, Velphoro). The medicines of
    # dissolved ones (Sanofi Pasteur MSD, the Sanofi and Bristol-Myers
    # Squibb alliance) go to the partner that took them, per medicine
    # (curated_medicine_groups()).
    "g.bristol-myers-squibb-pfizer",
    "Bristol Myers Squibb and Pfizer (joint venture)", "BPF", NA, NA, NA, NA,
    "g.bristol-myers-squibb;g.pfizer",
    "g.mcm-vaccine", "MCM Vaccine (joint venture)", "MCM", NA, NA, NA, NA,
    "g.msd;g.sanofi",
    "g.vifor-fresenius-medical-care",
    "Vifor Fresenius Medical Care Renal Pharma (joint venture)", "VFM", NA,
    NA, NA, NA, "g.csl"
  ) |>
    dplyr::mutate(
      other_partners = unname(curated_other_partners[.data$group_key]),
      joint_venture = !is.na(.data$partners) | !is.na(.data$other_partners),
      .before = "partners"
    ) |>
    dplyr::relocate("other_partners", .after = "partners")
}

# Joint-venture partners that are no group in the data, by name.
curated_other_partners <- c(
  "g.vifor-fresenius-medical-care" = "Fresenius Medical Care"
)

# Holders in a group; for ownership changes a note and its evidence.
curated_group_members <- function() {
  wikipedia <- function(title) paste0("https://en.wikipedia.org/wiki/", title)
  dplyr::tribble(
    ~group_key, ~holder, ~note, ~evidence_url,
    "g.novartis", "Novartis Europharm Limited", NA, NA,
    "g.novartis", "Novartis", NA, NA,
    "g.novartis", "Novartis Ophthalmics Europe Ltd.", NA, NA,
    # Lumark: withdrawn in 2026 at the request of I.D.B. Holland B.V. (the
    # Union Register's holder), of the same IDB Group, which Advanced
    # Accelerator Applications bought in 2016 (https://www.globenewswire.com/
    # news-release/2016/01/07/800133/0/en/Advanced-Accelerator-Applications-
    # Acquires-the-IDB-Group.html) and Novartis with AAA in 2018. The
    # evidence shows the current owner: "IDB (part of Novartis Netherlands)".
    "g.novartis", "I.D.B. Radiopharmacy B.V.",
    paste(
      "IDB is part of Novartis Netherlands (Dutch nuclear safety authority,",
      "2024)"
    ),
    paste0(
      "https://english.autoriteitnvs.nl/latest/news/2024/11/12/",
      "permission-for-idb-to-use-new-production-location-pending-licence"
    ),
    "g.sandoz", "Sandoz GmbH", "Spun off from Novartis in 2023",
    wikipedia("Sandoz"),
    "g.sandoz", "Sandoz Pharmaceuticals d.d.",
    "Spun off from Novartis in 2023", wikipedia("Sandoz"),
    "g.sandoz", "Hexal AG", "Acquired by Sandoz in 2005",
    wikipedia("Sandoz"),
    "g.sandoz", "1 A Pharma GmbH", "A Sandoz brand",
    "https://www.sandoz.com/de-de/unsere-marken/1-pharma/",
    "g.pfizer", "Pfizer Europe MA EEIG", NA, NA,
    "g.pfizer", "Pfizer Ireland Pharmaceuticals", NA, NA,
    "g.pfizer", "Wyeth Europa Ltd", "Wyeth acquired by Pfizer in 2009",
    wikipedia("Wyeth"),
    "g.pfizer", "Wyeth Lederle Vaccines S.A.",
    "Wyeth acquired by Pfizer in 2009", wikipedia("Wyeth"),
    "g.pfizer", "Pharmacia Europe EEIG", "Pharmacia merged into Pfizer in 2003",
    wikipedia("Pfizer"),
    "g.pfizer", "Pharmacia - Pfizer EEIG",
    "Pharmacia and Pfizer's joint EEIG; Pharmacia merged into Pfizer in 2003",
    wikipedia("Pfizer"),
    "g.pfizer", "Hospira UK Limited", "Hospira acquired by Pfizer in 2015",
    wikipedia("Hospira"),
    "g.pfizer", "Arena Pharmaceutical Enterprises Limited",
    "Arena acquired by Pfizer in 2022",
    paste0(
      "https://www.pfizer.com/news/press-release/press-release-detail/",
      "pfizer-completes-acquisition-arena-pharmaceuticals"
    ),
    "g.intas", "Accord Healthcare S.L.U.",
    paste(
      "Intas Pharmaceuticals' company (GLEIF: the ultimate parent of",
      "Accord Healthcare Limited)"
    ),
    "https://search.gleif.org/#/record/213800S19K36OUQLB824",
    "g.intas", "Intas Third Party Sales 2005 S.L.", NA, NA,
    "g.msd", "Merck Sharp & Dohme B.V.", NA, NA,
    "g.msd", "Schering-Plough Europe",
    "Schering-Plough merged with Merck & Co. in 2009",
    wikipedia("Schering-Plough"),
    "g.msd", "SP Europe", "Schering-Plough merged with Merck & Co. in 2009",
    wikipedia("Schering-Plough"),
    "g.teva", "Teva B.V.", NA, NA,
    "g.teva", "Teva Pharma B.V.", NA, NA,
    "g.teva", "Teva Generics B.V", NA, NA,
    "g.teva", "ratiopharm GmbH", "ratiopharm acquired by Teva in 2010",
    wikipedia("Ratiopharm"),
    "g.teva", "AbZ-Pharma GmbH", "A Teva brand in Germany (with ratiopharm)",
    "https://www.teva.de/teva-weltweit/teva-in-deutschland.html",
    "g.teva", "Actavis Group PTC ehf",
    "Actavis generics business acquired by Teva in 2016",
    wikipedia("Allergan"),
    "g.teva", "Norton Healthcare Ltd.",
    "IVAX's UK company; Teva acquired IVAX in 2006",
    paste0(
      "https://ir.tevapharm.com/news-and-events/press-releases/",
      "press-release-details/2006/Teva-Completes-Acquisition-of-Ivax/",
      "default.aspx"
    ),
    "g.johnson-johnson", "Janssen-Cilag International NV", NA, NA,
    "g.johnson-johnson", "Centocor B.V.",
    "Centocor (now Janssen Biotech) acquired by J&J in 1999",
    wikipedia("Janssen_Biotech"),
    "g.johnson-johnson", "Omrix Biopharmaceuticals N. V.",
    "Omrix acquired by J&J in 2008",
    paste0(
      "https://johnsonandjohnson.gcs-web.com/news-releases/",
      "news-release-details/johnson-johnson-completes-acquisition-omrix-",
      "biopharmaceuticals/"
    ),
    "g.astrazeneca", "AstraZeneca AB", NA, NA,
    "g.astrazeneca", "Alexion Europe SAS",
    "Alexion acquired by AstraZeneca in 2021",
    wikipedia("Alexion_Pharmaceuticals"),
    "g.astrazeneca", "MedImmune LLC",
    "MedImmune acquired by AstraZeneca in 2007", wikipedia("MedImmune"),
    "g.roche", "Roche Registration GmbH", NA, NA,
    "g.sanofi", "Sanofi Winthrop Industrie", NA, NA,
    "g.sanofi", "Sanofi B.V.", NA, NA,
    "g.sanofi", "sanofi-aventis groupe", NA, NA,
    "g.sanofi", "Aventis Pharma S.A.", "Aventis acquired by Sanofi in 2004",
    wikipedia("Aventis"),
    "g.sanofi", "Genzyme Europe B.V.", "Genzyme acquired by Sanofi in 2011",
    wikipedia("Genzyme"),
    "g.sanofi", "Sanofi Pasteur", NA, NA,
    "g.sanofi", "Ablynx NV", "Ablynx acquired by Sanofi in 2018",
    wikipedia("Ablynx"),
    "g.eli-lilly", "Eli Lilly Nederland B.V.", NA, NA,
    "g.viatris", "Viatris Limited", NA, NA,
    "g.viatris", "Viatris Healthcare Limited", NA, NA,
    "g.viatris", "Mylan Pharmaceuticals Limited",
    "Mylan combined with Upjohn into Viatris in 2020", wikipedia("Viatris"),
    "g.viatris", "Mylan S.A.S.",
    "Mylan combined with Upjohn into Viatris in 2020", wikipedia("Viatris"),
    "g.viatris", "Mylan IRE Healthcare Limited",
    "Mylan combined with Upjohn into Viatris in 2020", wikipedia("Viatris"),
    "g.viatris", "Mylan dura GmbH",
    "Mylan combined with Upjohn into Viatris in 2020", wikipedia("Viatris"),
    "g.viatris", "Meda AB", "Meda acquired by Mylan in 2016",
    wikipedia("Viatris"),
    "g.viatris", "Generics (UK) Limited",
    "Merck KGaA's generics business acquired by Mylan in 2007",
    paste0(
      "https://investor.mylan.com/news-releases/news-release-details/",
      "mylan-completes-acquisition-generics-business-merck-kgaa"
    ),
    "g.viatris", "Upjohn EESV",
    "Pfizer's Upjohn combined with Mylan into Viatris in 2020",
    wikipedia("Viatris"),
    "g.bristol-myers-squibb", "Bristol-Myers Squibb Pharma EEIG", NA, NA,
    "g.bristol-myers-squibb", "Celgene Europe BV",
    "Celgene acquired by Bristol Myers Squibb in 2019", wikipedia("Celgene"),
    "g.bristol-myers-squibb", "Pharmion Ltd.",
    "Pharmion acquired by Celgene in 2008 (Bristol Myers Squibb since 2019)",
    wikipedia("Celgene"),
    "g.novo-nordisk", "Novo Nordisk A/S", NA, NA,
    "g.krka", "Krka, d.d., Novo mesto", NA, NA,
    "g.krka", "Tad Pharma GmbH", "Acquired by Krka in 2007",
    paste0(
      "https://www.krka.biz/about-us/international-presence/",
      "krka-around-the-world/tad-pharma/"
    ),
    "g.gilead", "Gilead Sciences Ireland UC", NA, NA,
    "g.gilead", "Kite Pharma EU B.V.", "Kite acquired by Gilead in 2017",
    wikipedia("Kite_Pharma"),
    "g.gilead", "Immunomedics GmbH",
    "Immunomedics acquired by Gilead in 2020", wikipedia("Immunomedics"),
    "g.bayer", "Bayer AG", NA, NA,
    "g.bayer", "Bayer Schering Pharma AG", NA, NA,
    "g.gsk", "GlaxoSmithKline Trading Services Limited", NA, NA,
    "g.gsk", "GlaxoSmithKline Biologicals S.A.", NA, NA,
    "g.gsk", "Glaxo Group Ltd.", NA, NA,
    "g.gsk", "SmithKline Beecham Plc", NA, NA,
    "g.gsk", "Beecham Group plc", NA, NA,
    "g.gsk", "GSK Vaccines S.r.l.", NA, NA,
    "g.gsk", "GlaxoSmithKline Vaccines S.r.l.", NA, NA,
    "g.gsk", "Chiron S.p.A.",
    "Chiron acquired by Novartis in 2006; its vaccines went to GSK in 2015",
    wikipedia("Chiron_Corporation"),
    "g.gsk", "ViiV Healthcare B.V.",
    paste(
      "Majority-owned by GSK (78.3%), with Shionogi (21.7%) since Pfizer",
      "left in March 2026"
    ),
    "https://www.shionogi.com/global/en/news/2026/04/20260401_12.html",
    "g.gsk", "TESARO Bio Netherlands B.V.", "Tesaro acquired by GSK in 2019",
    wikipedia("Tesaro"),
    "g.boehringer-ingelheim", "Boehringer Ingelheim International GmbH",
    NA, NA,
    "g.boehringer-ingelheim", "Dr. Karl Thomae GmbH",
    "Acquired by Boehringer Ingelheim in 1928",
    paste0(
      "https://www.boehringer-ingelheim.com/about-us/history/",
      "1885-1948-innovative-beginnings"
    ),
    "g.amgen", "Amgen Europe B.V.", NA, NA,
    "g.amgen", "Amgen Technology (Ireland) UC", NA, NA,
    "g.amgen", "ChemoCentryx Ltd", "ChemoCentryx acquired by Amgen in 2022",
    paste0(
      "https://www.amgen.com/newsroom/press-releases/2022/10/",
      "amgen-successfully-completes-acquisition-of-chemocentryx"
    ),
    "g.abbvie", "AbbVie Deutschland GmbH & Co. KG", NA, NA,
    "g.abbvie", "Allergan Pharmaceuticals International Limited",
    "Allergan acquired by AbbVie in 2020", wikipedia("Allergan"),
    "g.abbvie", "Warner Chilcott UK Ltd.",
    paste(
      "Warner Chilcott acquired by Actavis (renamed Allergan) in 2013;",
      "AbbVie since 2020"
    ),
    wikipedia("Allergan"),
    "g.gedeon-richter", "Gedeon Richter Plc.", NA, NA,
    "g.stada", "STADA Arzneimittel AG", NA, NA,
    "g.zentiva", "Zentiva k.s.", NA, NA,
    "g.celltrion", "Celltrion Healthcare Hungary Kft.", NA, NA,
    "g.ucb", "UCB Pharma S.A.", NA, NA,
    "g.servier", "Les Laboratoires Servier", NA, NA,
    "g.servier", "Servier (Ireland) Industries Ltd", NA, NA,
    "g.sun-pharma", "Sun Pharmaceutical Industries Europe B.V.", NA, NA,
    "g.chiesi", "Chiesi Farmaceutici S.p.A.", NA, NA,
    "g.chiesi", "Amryt Pharmaceuticals DAC",
    "Amryt acquired by Chiesi in 2023",
    paste0(
      "https://www.nasdaq.com/press-release/",
      "chiesi-farmaceutici-s.p.a.-completes-acquisition-of-amryt-pharma-plc-",
      "2023-04-12"
    ),
    "g.chiesi", "Amryt AG", "Amryt acquired by Chiesi in 2023",
    paste0(
      "https://www.nasdaq.com/press-release/",
      "chiesi-farmaceutici-s.p.a.-completes-acquisition-of-amryt-pharma-plc-",
      "2023-04-12"
    ),
    "g.takeda", "Takeda Pharma A/S", NA, NA,
    "g.takeda", "Takeda Pharmaceuticals International AG", NA, NA,
    "g.takeda", "Takeda GmbH", NA, NA,
    "g.takeda", "Takeda Global Research and Development Centre (Europe)",
    NA, NA,
    "g.takeda", "Baxalta Innovations GmbH",
    "Baxalta acquired by Shire in 2016, Shire by Takeda in 2019",
    wikipedia("Shire_(pharmaceutical_company)"),
    "g.takeda", "Shire Pharmaceutical Contracts Limited",
    "Shire acquired by Takeda in 2019",
    wikipedia("Shire_(pharmaceutical_company)"),
    "g.takeda", "NPS Pharma Holdings Limited",
    "NPS acquired by Shire in 2015 (Takeda since 2019)",
    wikipedia("Shire_(pharmaceutical_company)"),
    "g.takeda", "TiGenix N.V.", "TiGenix acquired by Takeda in 2018",
    wikipedia("TiGenix"),
    "g.takeda", "Dyax s.a.", "Dyax acquired by Shire (Takeda since 2019)",
    wikipedia("Shire_(pharmaceutical_company)"),
    "g.biocon", "Biocon Biologics Ireland Limited", NA, NA,
    "g.biocon", "Biosimilar Collaborations Ireland Limited",
    "Viatris's biosimilars business acquired by Biocon Biologics in 2022",
    wikipedia("Viatris"),
    "g.astellas", "Astellas Pharma Europe B.V.", NA, NA,
    "g.fresenius", "Fresenius Kabi Deutschland GmbH", NA, NA,
    "g.fresenius", "Mabxience Research SL",
    "Fresenius Kabi has held 55% of mAbxience since 2022 (Insud Pharma 45%)",
    paste0(
      "https://mabxience.com/fresenius-kabi-completes-majority-stake-",
      "acquisition-of-mabxience-holding-s-l-significantly-enhancing-",
      "presence-in-high-growth-biopharmaceuticals-market/"
    ),
    "g.samsung-bioepis", "Samsung Bioepis NL B.V.", NA, NA,
    "g.merck-kgaa", "Merck Europe B.V.", NA, NA,
    "g.merck-kgaa", "Merck Serono Europe Limited",
    "Serono acquired by Merck KGaA in 2007", wikipedia("Merck_Serono"),
    "g.merck-kgaa", "Serono Europe Limited",
    "Serono acquired by Merck KGaA in 2007", wikipedia("Merck_Serono"),
    "g.organon", "Organon N.V.",
    "Spun off from Merck & Co. (MSD) in 2021", wikipedia("Organon_%26_Co."),
    "g.sobi", "Swedish Orphan Biovitrum AB (publ)", NA, NA,
    "g.csl", "CSL Behring GmbH", NA, NA,
    "g.csl", "Seqirus Netherlands B.V.",
    "CSL's influenza vaccines business (Novartis's, bought in 2014-2015)",
    wikipedia("Seqirus"),
    "g.csl", "Vifor France", "Vifor acquired by CSL in 2022",
    wikipedia("Vifor_Pharma"),
    "g.csl", "Novartis Vaccines and Diagnostics S.r.l.",
    paste(
      "Novartis influenza vaccines acquired by CSL (Seqirus) in 2015; all",
      "this holder's medicines are influenza vaccines (its other vaccines,",
      "and the entity, went to GSK)"
    ),
    paste0(
      "https://www.novartis.com/news/media-releases/novartis-completes-",
      "divestiture-influenza-vaccines-business-csl-limited-usd-275-million"
    ),
    "g.recordati", "Recordati Rare Diseases", NA, NA,
    "g.recordati", "Recordati Ireland Ltd", NA, NA,
    "g.recordati", "Recordati Industria Chimica e Farmaceutica S.p.A.", NA,
    NA,
    "g.pierre-fabre", "Pierre Fabre Medicament", NA, NA,
    "g.medac", "medac Gesellschaft für klinische Spezialpräparate mbH",
    NA, NA,
    "g.biogen", "Biogen Netherlands B.V.", NA, NA,
    "g.biogen", "Biogen Idec Ltd", NA, NA,
    "g.otsuka", "Otsuka Pharmaceutical Netherlands B.V.", NA, NA,
    "g.otsuka", "Otsuka Novel Products GmbH", NA, NA,
    "g.otsuka", "Taiho Pharma Netherlands B.V.",
    "Taiho is an Otsuka Holdings company", wikipedia("Taiho_Pharmaceutical"),
    # A sponsor behind a regulatory representative (Nuedexta), not a
    # holder: curated_medicine_sponsors().
    "g.otsuka", "Avanir Pharmaceuticals", "Avanir acquired by Otsuka in 2015",
    paste0(
      "https://www.sec.gov/Archives/edgar/data/0000858803/",
      "000119312515008807/d850708dex99a5g.htm"
    ),
    "g.advanz", "Advanz Pharma Limited", NA, NA,
    "g.advanz", "Amdipharm Limited",
    "Amdipharm Mercury acquired by Concordia in 2015, renamed Advanz Pharma",
    wikipedia("Advanz_Pharma"),
    "g.biomarin", "BioMarin International Limited", NA, NA,
    "g.neuraxpharm", "Neuraxpharm Pharmaceuticals S.L.", NA, NA,
    "g.daiichi-sankyo", "Daiichi Sankyo Europe GmbH", NA, NA,
    "g.orion", "Orion Corporation", NA, NA,
    "g.cheplapharm", "CHEPLAPHARM Arzneimittel GmbH", NA, NA,
    "g.cheplapharm", "CHEPLAPHARM Registration GmbH", NA, NA,
    "g.ipsen", "Ipsen Pharma", NA, NA,
    "g.esteve", "Esteve Pharmaceuticals, S.A.", NA, NA,
    "g.incyte", "Incyte Biosciences Distribution B.V.", NA, NA,
    "g.curium", "Curium Pet France", NA, NA,
    "g.curium", "Curium Romania S.R.L.", NA, NA,
    "g.curium", "CIS bio international",
    paste(
      "Part of Curium, formed from IBA Molecular and Mallinckrodt Nuclear",
      "Medicine in 2017"
    ),
    paste0(
      "https://www.essonne.fr/fileadmin/5-cadre_vie_environnement/",
      "Environnement/risques_majeurs/risques_nucleaire/",
      "CLI-Pr%C3%A9sentation_CURIUM_CLI_291118.pdf"
    ),
    "g.menarini", "Menarini International Operations Luxembourg S.A.", NA,
    NA,
    "g.menarini", "A. Menarini International Licensing S.A.", NA, NA,
    "g.menarini", "A. Menarini Industrie Farmaceutiche Riunite s.r.l.", NA,
    NA,
    "g.menarini", "Berlin-Chemie AG", "Acquired by Menarini in 1992",
    "https://www.berlin-chemie.de/en/about-us/company-history.html",
    "g.menarini", "Stemline Therapeutics B.V.",
    "Stemline acquired by Menarini in 2020",
    paste0(
      "https://www.menarini.com/en-us/news/news-detail/",
      "menarini-group-completes-acquisition-of-stemline-therapeutics.html"
    ),
    "g.kyowa-kirin", "Kyowa Kirin Holdings B.V.", NA, NA,
    "g.kyowa-kirin", "Orchard Therapeutics (Netherlands) B.V.",
    "Orchard acquired by Kyowa Kirin in 2024",
    paste0(
      "https://ir.orchard-tx.com/news-releases/news-release-details/",
      "kyowa-kirin-successfully-completes-acquisition-orchard/"
    ),
    "g.abbott", "Abbott Laboratories Ltd.", NA, NA,
    "g.abbott", "Abbott S.r.l.", NA, NA,
    "g.vertex", "Vertex Pharmaceuticals (Ireland) Limited", NA, NA,
    "g.almirall", "Almirall, S.A.", NA, NA,
    "g.lundbeck", "H. Lundbeck A/S", NA, NA,
    "g.leo-pharma", "LEO Pharma A/S", NA, NA,
    "g.leo-pharma", "LEO Laboratories Ltd.", NA, NA,
    "g.grunenthal", "Grünenthal GmbH", NA, NA,
    "g.theramex", "Theramex Ireland Limited", NA, NA,
    "g.eisai", "Eisai GmbH", NA, NA,
    "g.jazz", "Jazz Pharmaceuticals Ireland Limited", NA, NA,
    "g.jazz", "Gentium S.r.l.", "Gentium acquired by Jazz in 2014",
    paste0(
      "https://investor.jazzpharma.com/news-releases/news-release-details/",
      "jazz-pharmaceuticals-plc-completes-tender-offer-gentium-spa"
    ),
    "g.dr-reddys", "Reddy Holding GmbH",
    "A wholly owned subsidiary of Dr. Reddy's (with betapharm)",
    paste0(
      "https://www.indiaratings.co.in/Uploads/Others/Consolidated%20Subs/",
      "List%20of%20Subsidiaries.pdf"
    ),
    "g.dr-reddys", "betapharm Arzneimittel GmbH",
    "Acquired by Dr. Reddy's in 2006",
    paste0(
      "https://www.biospace.com/dr-reddy-s-laboratories-ltd-completes-",
      "acquisition-of-b-betapharm-b-for-480-million-euro"
    ),
    "g.perrigo", "Laboratoire HRA Pharma",
    "HRA Pharma acquired by Perrigo in 2022",
    paste0(
      "https://investor.perrigo.com/",
      "2022-05-02-PERRIGO-COMPLETES-THE-ACQUISITION-OF-HRA-PHARMA"
    ),
    "g.perrigo", "Galpharm Healthcare Ltd.", "Acquired by Perrigo in 2008",
    paste0(
      "https://investor.perrigo.com/",
      "2008-01-09-Perrigo-Acquires-UK-OTC-Store-Brand-Supplier"
    ),
    "g.glenmark", "Glenmark Arzneimittel GmbH", NA, NA,
    "g.glenmark", "Glenmark Pharmaceuticals s.r.o.", NA, NA,
    "g.merz", "Merz Pharmaceuticals GmbH", NA, NA,
    "g.merz", "Merz Therapeutics GmbH", NA, NA,
    "g.acino", "Acino AG", NA, NA,
    "g.acino", "Acino Pharma GmbH", NA, NA,
    "g.dompe", "Dompe' Farmaceutici S.p.A.", NA, NA,
    "g.dompe", "Dompé Biotec S.p.A.", NA, NA,
    "g.bracco", "Bracco Imaging S.p.A.", NA, NA,
    "g.bracco", "Bracco International B.V.", NA, NA,
    "g.cosmo", "Cosmo Technologies Ltd", NA, NA,
    "g.cosmo", "Cassiopea S.p.A.",
    "A Cosmo Pharmaceuticals company (GLEIF: its ultimate parent)",
    "https://search.gleif.org/#/record/8156002F30A40D4B5408",
    "g.pharming", "Pharming Group N.V.", NA, NA,
    "g.pharming", "Pharming Technologies B.V.", NA, NA,
    "g.haleon", "Haleon Ireland Dungarvan Limited", NA, NA,
    "g.guerbet", "Guerbet", NA, NA,
    "g.techdow", "Techdow Pharma Netherlands B.V.", NA, NA,
    # A sponsor behind regulatory representatives (Zokinvy, Nulibry), not a
    # holder: curated_medicine_sponsors().
    "g.zydus", "Sentynl Therapeutics",
    "Acquired by the Zydus Group in 2017; wholly owned by Zydus Lifesciences",
    paste0(
      "https://sentynl.com/news/sentynl-therapeutics-announces-global-",
      "acquisition-of-zokinvy-lonafarnib-for-treatment-of-hutchinson-",
      "gilford-progeria-syndrome-from-eiger-biopharmaceuticals/"
    ),
    "g.bristol-myers-squibb-pfizer", "Bristol-Myers Squibb / Pfizer EEIG",
    NA, NA,
    "g.mcm-vaccine", "MCM Vaccine B.V.", NA, NA,
    "g.vifor-fresenius-medical-care",
    "Vifor Fresenius Medical Care Renal Pharma France",
    "Joint company of Vifor (CSL since 2022) and Fresenius Medical Care",
    wikipedia("Vifor_Pharma")
  )
}

# Holders that are spellings or renames of another holder's company, beyond
# what the rules fold.
curated_company_aliases <- function() {
  dplyr::tribble(
    ~holder, ~company_holder, ~note,
    "Chemical Works of Gedeon Richter Plc. (Gedeon Richter Plc.)",
    "Gedeon Richter Plc.", "Long form of the name",
    "Tour Hekla", "Recordati Rare Diseases",
    "An address line (the register names Recordati Rare Diseases)",
    "Zaklady FarmaFarmaceutyczne Polpharma S.Aceutyczne Polpharma S.A.",
    "Zakłady Farmaceutyczne POLPHARMA S.A.", "Garbled in EMA's data",
    "Pasteur Mà¨rieux MSD", "Sanofi Pasteur MSD, SNC",
    "Garbled in EMA's data (Pasteur Mérieux MSD, an earlier name)",
    "Aventis Pasteur MSD", "Sanofi Pasteur MSD, SNC",
    "Renamed Sanofi Pasteur MSD in 2005",
    "INFAI, Institut für biomedizinische Analytik NMR-Imaging GmbH",
    "INFAI GmbH", "INFAI abbreviates the long name",
    "Laboratoires CTRS - Boulogne Billancourt", "Theravia",
    "Laboratoires CTRS renamed Theravia after merging with Addmedica",
    "Mitsubishi Tanabe Pharma GmbH", "Tanabe Pharma GmbH",
    paste(
      "Mitsubishi Tanabe Pharma and its companies renamed Tanabe Pharma on",
      "1 December 2025"
    ),
    "L. Molteni & C. dei F.lli Alitti Società di .Esercizio .S.p.A",
    "L. Molteni & C. dei Fratelli Alitti Società di Esercizio S.p.A.",
    "Abbreviated and garbled in the Union Register",
    "Gentium S.r.I.", "Gentium S.r.l.", "Misspelt in the Union Register",
    "Steba Biotech B.A.", "STEBA Biotech S.A", "Misspelt in the Union Register",
    "Alimentarics B.V.", "Alimenterics B.V.", "Misspelt in one source",
    "Novartis Ophtalmics Europe Ltd", "Novartis Ophthalmics Europe Ltd.",
    "Misspelt in the Union Register",
    "Archie Samiel s.r.o.", "Archie Samuel s.r.o.", "Misspelt in EMA's data",
    "Laboratoires BIOGARAN", "Biogaran", "Long form of the name",
    "A.C.O.M. -ADVANCED CENTER ONCOLOGY MACERATA -S.R.L.",
    "A.C.O.M. - Advanced Center Oncology", "Long form of the name",
    "Rilonacept FGK Representative Service GmbH",
    "FGK Representative Service GmbH", "Product name prefixed",
    "Takeda Europe R&D Centre Ltd",
    "Takeda Global Research and Development Centre (Europe)", "Renamed",
    "BeiGene Ireland Ltd", "BeOne Medicines Ireland Limited",
    "BeiGene renamed BeOne Medicines in 2025",
    "Ascendis Pharma Bone Diseases A/S",
    "Ascendis Pharma Endocrinology Division A/S", "Two entities, one company",
    "JensonR+ Limited", "Jenson Pharmaceutical Services Limited",
    "Renamed",
    # EMA's names of products the Union Register no longer lists as Active,
    # where EMA's field decides (user decision 2026-09-28).
    "Medac", "medac Gesellschaft für klinische Spezialpräparate mbH",
    "Short form of the name",
    "Takeda Europe R Centre Ltd.",
    "Takeda Global Research and Development Centre (Europe)",
    "Garbled in EMA's data (Takeda Europe R&D Centre)",
    "Mitsubishi Pharma Europe Ltd", "Tanabe Pharma GmbH",
    paste(
      "Mitsubishi Pharma merged with Tanabe in 2007 (Mitsubishi Tanabe",
      "Pharma, renamed Tanabe Pharma on 1 December 2025)"
    )
  ) |>
    dplyr::bind_rows(curated_sponsor_renames())
}

# Sponsors renamed since (user decision 2026-09-28): the current name shows,
# the name in curated_medicine_sponsors() is an alias. Evidence as for
# sponsors: an https URL, a verbatim quote of at most 20 words and the date
# checked.
curated_sponsor_renames <- function() {
  prnewswire <- "https://www.prnewswire.com/news-releases/"
  sec <- "https://www.sec.gov/Archives/edgar/data/"
  dplyr::tribble(
    ~holder, ~company_holder, ~note, ~evidence_url, ~evidence_quote,
    "AcelRx Pharmaceuticals", "Talphera", "Renamed Talphera in January 2024",
    paste0(
      prnewswire,
      "acelrx-announces-rebranding-with-name-change-to-talphera-inc-",
      "302029288.html"
    ),
    paste(
      "today announced the rebranding of the Company, with a name change to",
      "Talphera, Inc."
    ),
    "Sesen Bio", "Carisma Therapeutics",
    "Merged with Carisma Therapeutics in March 2023, taking its name",
    paste0(
      prnewswire,
      "carisma-therapeutics-closes-merger-with-sesen-bio-301765135.html"
    ),
    paste(
      "The combined company will operate under the name Carisma Therapeutics",
      "Inc."
    ),
    "Discovery Laboratories", "Windtree Therapeutics",
    "Renamed Windtree Therapeutics in April 2016",
    paste0(
      prnewswire,
      "discovery-labs-changes-name-to-windtree-therapeutics-inc-nasdaq-wint-",
      "300252562.html"
    ),
    paste(
      "today announced that it has changed its corporate name to Windtree",
      "Therapeutics, Inc."
    ),
    "Cempra Pharmaceuticals", "Melinta Therapeutics",
    "Merged with Melinta Therapeutics in November 2017, taking its name",
    paste0(sec, "0001461993/000156459018005947/mlnt-10k_20171231.htm"),
    paste(
      "Immediately after the merger, Cempra, Inc. was renamed Melinta",
      "Therapeutics, Inc."
    ),
    "Cleveland BioLabs", "Statera Biopharma",
    paste(
      "Merged with Cytocom in July 2021 and renamed Statera Biopharma in",
      "September 2021"
    ),
    paste0(sec, "1318641/000143774921022790/ex_286725.htm"),
    paste(
      "On September 1, 2021, the newly merged company changed its name to",
      "Statera BioPharma, Inc."
    ),
    "Advaxis, Inc.", "Ayala Pharmaceuticals",
    "Merged with Ayala Pharmaceuticals in January 2023, taking its name",
    paste0(sec, "1100397/000149315223002462/form8-k.htm"),
    paste(
      "changed its name on January 19, 2023 from Advaxis, Inc. to Ayala",
      "Pharmaceuticals, Inc."
    ),
    "Coherus BioSciences", "Coherus Oncology",
    "Renamed Coherus Oncology in May 2025",
    paste0(sec, "1512762/000155837025008294/chrs-20250529x8k.htm"),
    paste(
      "changed its corporate name from Coherus BioSciences, Inc. to Coherus",
      "Oncology, Inc."
    )
  ) |>
    dplyr::mutate(checked_date = as.Date("2026-09-28"))
}

# Regulatory service firms that hold marketing authorisations for other
# sponsors: their medicines are "held via a regulatory representative"
# until curated_medicine_sponsors() names the sponsor.
curated_representatives <- function() {
  dplyr::tribble(
    ~holder,
    "FGK Representative Service GmbH",
    "Regulatory Pharma Net S.r.l.",
    "Norpharm Regulatory Services Ltd",
    "DLRC Pharma Services Ltd",
    "Guidehouse Germany GmbH",
    "CATS Consultants GmbH",
    "ERA Consulting GmbH",
    "Triskel EU Services Ltd",
    "YES Pharmaceutical Development Services GmbH",
    "Pharm Research Associates (UK) Limited",
    "Jenson Pharmaceutical Services Limited",
    "TMC Pharma Services Ltd",
    "Integral Pharma Solutions EU Limited",
    "Sciencepharma Sp. z o.o"
  )
}

# The sponsor behind a medicine held by a regulatory representative, looked
# up by hand in the medicine's EPAR documents or product information (or a
# company press release): a note, the evidence URL, a quote of at most 20
# words and the date checked. Only rows a second, independent check confirmed
# (reviewed) are applied. sponsor_group_key: a curated group, or NA for the
# sponsor's own group. `holder` is the holder used when the row was checked
# (the Union Register's where it decides). The sponsor is named as it was
# then (AcelRx); a renamed one shows its current name (Talphera) through
# curated_sponsor_renames(), and its note names both. User decision
# 2026-09-28 ("I confirm the
# medicine sponsor list"): the proposed sponsors of the review list; the
# unresolved ones (Memantine FGK, Sildenafil FGK, Mevlyq, Ivabradine
# JensonR, Ablavar) stay held via a regulatory representative, and the
# holders that are no representative (Kamada and Genta with an address
# tail; Clopidogrel Krka, whose holder the Union Register decides) need no
# row.
curated_medicine_sponsors <- function() {
  sec <- "https://www.sec.gov/Archives/edgar/data/"
  ema_documents <- "https://www.ema.europa.eu/en/documents/"
  withdrawal_letter <- function(medicine) {
    paste0(
      ema_documents, "withdrawal-letter/withdrawal-letter-", medicine,
      "_en.pdf"
    )
  }
  fgk <- "FGK Representative Service GmbH"
  akroswiss <- "Akroswiss AG"
  sentynl <- "Sentynl Therapeutics"
  henlius <- "Shanghai Henlius Biotech"
  henlius_url <- paste0(
    "https://www.organon.com/news/european-commission-ec-approves-henlius-",
    "and-organons-bildyos-denosumab-and-bilprevda-denosumab-biosimilars-to-",
    "prolia-denosumab-and-xgeva-denosumab-respectively/"
  )
  henlius_quote <- paste(
    "European Commission (EC) Approves Henlius and Organon's BILDYOS",
    "(denosumab) and BILPREVDA (denosumab)"
  )
  midazolam_note <- function(use) {
    paste0(
      "One of Akroswiss's two midazolam nasal sprays (", use, "), applied for ",
      "through Regulatory Pharma Net"
    )
  }
  henlius_note <- paste(
    "Henlius's denosumab biosimilar (HLX14); Organon markets it as a",
    "licensee"
  )
  dplyr::tribble(
    ~ema_product_number, ~holder, ~sponsor, ~sponsor_group_key, ~note,
    ~evidence_url, ~evidence_quote,
    "EMEA/H/C/002784", fgk, "AcelRx Pharmaceuticals", NA,
    paste(
      "The rights to Zalviso reverted from its licensee Grünenthal to AcelRx",
      "(renamed Talphera in 2024) in 2021; the authorization then moved to",
      "FGK"
    ),
    paste0(sec, "1427925/000143774921026589/acrx20210930_10q.htm"),
    paste(
      "The rights to market and sell Zalviso in the Zalviso Territory",
      "reverted back to the Company on May 12, 2021."
    ),
    "EMEA/H/C/002830", fgk, "Corcept Therapeutics", NA,
    "Corcept's mifepristone (Korlym in the U.S.), filed in the EU as Corluxin",
    paste0(sec, "1088856/000110262413001359/corcepttherapeutics.htm"),
    paste(
      "approval to promote Korlym for endogenous Cushing's syndrome in the",
      "European Union under the brand name Corluxin"
    ),
    "EMEA/H/C/004473", fgk, "Advaxis, Inc.", NA,
    paste(
      "FGK applied as the European legal representative of Advaxis (renamed",
      "Ayala Pharmaceuticals on merging with it in 2023)"
    ),
    withdrawal_letter("raligize"),
    "who is the European Legal Representative of Advaxis Inc.",
    "EMEA/H/C/005551", fgk, "Mirum Pharmaceuticals", NA,
    paste(
      "Maralixibat for PFIC2, applied for by FGK on behalf of Mirum, which",
      "holds its later Livmarli authorization itself"
    ),
    withdrawal_letter("livmarli"),
    paste(
      "(maralixibat chloride) on behalf of Mirum Pharmaceuticals Inc. has",
      "taken the decision to withdraw"
    ),
    "EMEA/H/C/005574", fgk, "Bio-Thera Solutions", NA,
    paste(
      "Bio-Thera's bevacizumab biosimilar (BAT1706); Sandoz markets it in",
      "Europe as a licensee"
    ),
    paste0(
      "https://www.prnewswire.com/news-releases/european-medicines-agency-",
      "ema-approves-bio-thera-solutions-bat1706-avzivi-bevacizumab-a-",
      "biosimilar-referencing-avastin-302209711.html"
    ),
    paste(
      "European Medicines Agency (EMA) Approves Bio-Thera Solutions' BAT1706",
      "(Avzivi, bevacizumab), a biosimilar referencing Avastin"
    ),
    "EMEA/H/C/006385", fgk, "Vyluma, Inc.", NA,
    paste(
      "Vyluma's low-dose atropine (NVK002), named by its study code in EMA's",
      "refusal report"
    ),
    paste0(
      ema_documents,
      "assessment-report/atropine-sulfate-fgk-epar-refusal-public-",
      "assessment-report_en.pdf"
    ),
    paste(
      "Design of the phase 3 Study CP-NVK002-0001 including primary and",
      "secondary efficacy"
    ),
    "EMEA/H/C/006537", "Rilonacept FGK Representative Service GmbH",
    "Kiniksa Pharmaceuticals", NA,
    "Kiniksa's rilonacept (Arcalyst), licensed from Regeneron",
    paste0(sec, "1730430/000110465925086689/tm2525025d1_ex99-1.htm"),
    paste(
      "The European Commission granted Orphan Drug designation to ARCALYST",
      "for the treatment of idiopathic pericarditis in 2021"
    ),
    "EMEA/H/C/005587", "YES Pharmaceutical Development Services GmbH",
    "Siam Bioscience Co., Ltd.", NA,
    paste(
      "A pegfilgrastim biosimilar whose active substance Siam Bioscience",
      "developed and makes; YES applied for it"
    ),
    paste0(
      ema_documents,
      "withdrawal-report/withdrawal-assessment-report-lutholaz_en.pdf"
    ),
    paste(
      "Siam Bioscience Co. Ltd., Banmai, Nonthaburi, Thailand is the",
      "manufacturer of the drug substance."
    ),
    "EMEA/H/C/004413", "ERA Consulting GmbH", "Coherus BioSciences", NA,
    paste(
      "The pegfilgrastim biosimilar of Coherus BioSciences (renamed Coherus",
      "Oncology in 2025), held for it by ERA Consulting"
    ),
    paste0(
      "https://www.globenewswire.com/news-release/2018/09/25/1576003/0/en/",
      "Coherus-BioSciences-Receives-European-Commission-Approval-for-",
      "UDENYCA-Pegfilgrastim-Biosimilar.html"
    ),
    paste(
      "Coherus BioSciences, Inc. (Nasdaq: CHRS), today announced the European",
      "Commission (EC) has granted marketing authorization to UDENYCA"
    ),
    "EMEA/H/C/004889", "Guidehouse Germany GmbH", "Lexicon Pharmaceuticals",
    NA,
    paste(
      "Sotagliflozin; Lexicon regained the rights from Sanofi in 2019, and",
      "the authorization moved to Guidehouse"
    ),
    paste0(sec, "1062822/000106282219000024/pressrelease09-10x2019.htm"),
    paste(
      "Lexicon will regain all rights to Zynquista and assume full",
      "responsibility for the worldwide development and commercialization of",
      "Zynquista"
    ),
    "EMEA/H/C/006317", "CATS Consultants GmbH", "Advenchen Laboratories, LLC",
    NA,
    paste(
      "Catequentinib (anlotinib, AL3818), Advenchen's, applied for through",
      "CATS Consultants"
    ),
    "https://advenchen.com/?page_id=17",
    paste(
      "Catequentinib Hydrochloride (AL3818) EMA Market Authorization",
      "Application (MAA) has been successfully submitted."
    ),
    "EMEA/H/C/005657", "Regulatory Pharma Net S.r.l.", akroswiss, NA,
    midazolam_note("premedication"),
    paste0(
      "https://www.ansa.it/sito/notizie/economia/business_wire/news/",
      "2021-05-17_117165026.html"
    ),
    paste(
      "The development of these Midazolam medicines comes in two independent",
      "indications"
    ),
    "EMEA/H/C/005658", "Regulatory Pharma Net S.r.l.", akroswiss, NA,
    midazolam_note("seizure rescue"),
    paste0(
      ema_documents,
      "withdrawal-report/withdrawal-assessment-report-tuzodi_en.pdf"
    ),
    paste(
      "developed by a private pharmaceutical company, fully dedicated to the",
      "development and commercialisation of innovative nasal applications"
    ),
    "EMEA/H/C/004179", "Triskel EU Services Ltd", "Cempra Pharmaceuticals",
    NA,
    paste(
      "Cempra (renamed Melinta Therapeutics on merging with it in 2017)",
      "applied through Triskel EU Services"
    ),
    withdrawal_letter("solithromycin-triskel-eu-services"),
    paste(
      "Cempra Pharmaceuticals Inc., which Triskel EU Services Ltd represents",
      "as the Applicant, has taken the decision to withdraw"
    ),
    "EMEA/H/C/005730", "DLRC Pharma Services Ltd", "Sesen Bio", NA,
    paste(
      "Sesen Bio (renamed Carisma Therapeutics on merging with it in 2023)",
      "applied through DLRC Pharma Services"
    ),
    withdrawal_letter("oportuzumab-monatox-dlrc-pharma-services"),
    paste(
      "Sesen Bio is halting further regulatory activities relating to",
      "oportuzumab monatox in Europe"
    ),
    "EMEA/H/C/000625", "Pharm Research Associates (UK) Limited",
    "Discovery Laboratories", NA,
    paste(
      "Lucinactant; PRA International applied on behalf of Discovery",
      "Laboratories (renamed Windtree Therapeutics in 2016)"
    ),
    withdrawal_letter("surfaxin"),
    paste(
      "the applicant, PRA International, on behalf of the US sponsor,",
      "Discovery Laboratories, Inc."
    ),
    "EMEA/H/C/002560", "Jenson Pharmaceutical Services Limited",
    "Avanir Pharmaceuticals", "g.otsuka",
    paste(
      "Avanir's dextromethorphan with quinidine, held for it by Jenson",
      "Pharmaceutical Services; Avanir is Otsuka's since 2015"
    ),
    paste0(
      "https://www.prnewswire.com/news-releases/avanir-pharmaceuticals-",
      "announces-european-approval-of-nuedexta-212960871.html"
    ),
    paste(
      "Avanir Pharmaceuticals, Inc. (NASDAQ: AVNR) today announced that the",
      "European Commission has approved NUEDEXTA"
    ),
    "EMEA/H/C/004656", "TMC Pharma Services Ltd", "Cleveland BioLabs", NA,
    paste(
      "Entolimod of Cleveland BioLabs (renamed Statera Biopharma in 2021,",
      "after merging with Cytocom), applied for through TMC Pharma Services"
    ),
    paste0(sec, "1318641/000131864118000015/pressrelease.htm"),
    paste(
      "regarding the company's Marketing Authorization Application (MAA) for",
      "entolimod"
    ),
    "EMEA/H/C/005271", "Integral Pharma Solutions EU Limited", sentynl,
    "g.zydus",
    paste(
      "Lonafarnib, authorized for Eiger; Sentynl, a Zydus company, bought it",
      "in 2024"
    ),
    paste0(
      "https://sentynl.com/news/sentynl-therapeutics-announces-global-",
      "acquisition-of-zokinvy-lonafarnib-for-treatment-of-hutchinson-",
      "gilford-progeria-syndrome-from-eiger-biopharmaceuticals/"
    ),
    paste(
      "Sentynl Therapeutics Announces Global Acquisition of Zokinvy",
      "(Lonafarnib) for Treatment of Hutchinson-Gilford Progeria Syndrome",
      "from Eiger BioPharmaceuticals"
    ),
    "EMEA/H/C/005378", "TMC Pharma (EU) Limited", sentynl, "g.zydus",
    paste(
      "Fosdenopterin, developed by BridgeBio; Sentynl, a Zydus company,",
      "acquired its global rights in March 2022"
    ),
    paste0(
      "https://sentynl.com/news/bridgebio-pharma-and-sentynl-therapeutics-",
      "receive-marketing-authorization-in-the-eu-for-nulibry-fosdenopterin-",
      "for-the-treatment-of-mocd-type-a/"
    ),
    "In March 2022, Sentynl acquired the global rights to NULIBRY",
    "EMEA/H/C/006434", "Sciencepharma Sp. z o.o", henlius, NA, henlius_note,
    henlius_url, henlius_quote,
    "EMEA/H/C/006435", "Sciencepharma Sp. z o.o", henlius, NA, henlius_note,
    henlius_url, henlius_quote
  ) |>
    dplyr::mutate(
      sponsor_group_key = as.character(.data$sponsor_group_key),
      checked_date = as.Date("2026-09-28"),
      reviewed = TRUE
    )
}

# Medicines whose business went to another owner than their holder's
# (user decision 2026-09-28): a split business (Abbott's pharmaceuticals
# to AbbVie, Viatris's biosimilars to Biocon, MSD's women's health and
# established brands to Organon), a dissolved joint venture (each partner
# took its own products) or a later holder EMA's field does not show, named
# by the Union Register, which no longer lists the product as Active
# (Panretin, Optimark, Thorinane; Ioa's business went on to Theramex). The
# medicine goes to that owner's group (a curated group); its holder stays
# as published. `holder` is the holder used when the row was checked (EMA's,
# or the Union Register's where it decides; never a sponsor): a row whose
# holder no longer holds the medicine is not applied (listed as stale).
# Evidence as for sponsors: an https URL, a verbatim quote of at most 20
# words and the date checked.
curated_medicine_groups <- function() {
  sec <- "https://www.sec.gov/Archives/edgar/data/"
  ema_documents <- "https://www.ema.europa.eu/en/documents/"
  viatris_10k <- paste0(
    sec, "1792044/000179204423000008/vtrs-20221231.htm"
  )
  viatris_quote <- paste(
    "Viatris contributed its biosimilars portfolio, composed of the Biocon",
    "collaboration programs, biosimilars to Humira®, Enbrel®, and Eylea®"
  )
  organon_10k <- paste0(sec, "1821825/000182182522000002/ogn-20211231.htm")
  organon_desloratadine <- paste(
    "several products that treat seasonal allergic rhinitis, including:",
    "Singulair (montelukast sodium), Nasonex® (mometasone), and Clarinex®",
    "(desloratadine)"
  )
  desloratadine_note <- paste(
    "Desloratadine, as Aerius; MSD's established brands went to Organon in",
    "2021 (Aerius, Azomyr and Neoclarityn are Organon's)"
  )
  alliance_8k <- paste0(sec, "14272/000119312512413254/d419788dex991.htm")
  alliance_quote <- paste(
    "Bristol-Myers Squibb will return to Sanofi its rights to Plavix and",
    "Avapro/Avalide in all markets worldwide"
  )
  alliance_note <- function(medicine, sanofi_medicines) {
    paste0(
      medicine, " of Sanofi and Bristol-Myers Squibb's alliance, whose ",
      "rights in the EU returned to Sanofi from 1 January 2013 (",
      sanofi_medicines, ")"
    )
  }
  dplyr::tribble(
    ~ema_product_number, ~holder, ~group_key, ~note, ~evidence_url,
    ~evidence_quote,
    "EMEA/H/C/000482", "Abbott Laboratories Ltd.", "g.abbvie",
    paste(
      "Trudexa is adalimumab, a second brand of Humira; Abbott's",
      "proprietary pharmaceuticals, Humira included, became AbbVie on",
      "1 January 2013 (the holder stayed with Abbott)"
    ),
    paste0(sec, "0000001800/000110465911057748/a11-27657_2ex99d1.htm"),
    paste(
      "portfolio of market-leading brands, including Humira, Lupron,",
      "Synagis, Kaletra, Creon and Synthroid"
    ),
    "EMEA/H/C/002019", "Abbott Laboratories Ltd.", "g.abbvie",
    paste(
      "Ozespa is briakinumab (ABT-874), from Abbott's proprietary",
      "pharmaceuticals, which became AbbVie in 2013: its psoriasis trials",
      "name AbbVie as sponsor"
    ),
    "https://clinicaltrials.gov/study/NCT00679731",
    "AbbVie (prior sponsor, Abbott)",
    "EMEA/H/C/000624", "Elan Pharma International Ltd.", "g.biogen",
    paste(
      "Biogen bought Elan's share of natalizumab (Tysabri) in 2013; the",
      "Elan entity went to Perrigo"
    ),
    paste0(
      sec, "0000875045/000087504513000014/cloveracquisitioncompletio.htm"
    ),
    paste(
      "has completed its purchase of Elan Corporation's interest in",
      "TYSABRI® (natalizumab)"
    ),
    "EMEA/H/C/000874", "Sanofi Pharma Bristol-Myers Squibb", "g.sanofi",
    alliance_note(
      "Clopidogrel with acetylsalicylic acid (the Plavix franchise)",
      "the authorized DuoPlavin is Sanofi's"
    ),
    alliance_8k, alliance_quote,
    # Bristol-Myers Squibb's own copies of the alliance's medicines.
    "EMEA/H/C/000784", "Bristol-Myers Squibb Pharma EEIG", "g.sanofi",
    alliance_note(
      "Irbesartan with hydrochlorothiazide (Avalide), a copy of CoAprovel",
      "CoAprovel and Karvezide are Sanofi's"
    ),
    alliance_8k, alliance_quote,
    "EMEA/H/C/000786", "Bristol-Myers Squibb Pharma EEIG", "g.sanofi",
    alliance_note(
      "Irbesartan (Avapro), a copy of Aprovel",
      "Aprovel and Karvea are Sanofi's"
    ),
    alliance_8k, alliance_quote,
    "EMEA/H/C/000875", "Bristol Myers Squibb Pharma EEIG", "g.sanofi",
    alliance_note(
      "Clopidogrel with acetylsalicylic acid, a copy of DuoPlavin",
      paste(
        "the authorized DuoCover, now Clopidogrel/Acetylsalicylic acid",
        "Zentiva, is Sanofi's"
      )
    ),
    alliance_8k, alliance_quote,
    "EMEA/H/C/000974", "Bristol-Myers Squibb Pharma EEIG", "g.sanofi",
    alliance_note(
      "Clopidogrel (Plavix), a copy of Plavix",
      "Plavix and Iscover are Sanofi's"
    ),
    alliance_8k, alliance_quote,
    "EMEA/H/C/000231", "Sanofi Pasteur MSD, SNC", "g.msd",
    paste(
      "Merck's vaccine (Comvax in the U.S.): Merck made its active",
      "substances; Sanofi Pasteur MSD, the joint venture, ended on",
      "31 December 2016"
    ),
    paste0(
      ema_documents,
      "product-information/procomvax-epar-product-information_en.pdf"
    ),
    paste(
      "made of the antigenic components used in producing Merck PRP-OMPC",
      "Vaccine and Merck Hepatitis B (Recombinant) Vaccine"
    ),
    "EMEA/H/C/000298", "Sanofi Pasteur MSD, SNC", "g.sanofi",
    paste(
      "Sanofi Pasteur made the vaccine and released its batches (Merck",
      "supplied the hepatitis B antigen); Sanofi Pasteur MSD, the joint",
      "venture, ended on 31 December 2016"
    ),
    paste0(
      ema_documents,
      "product-information/hexavac-epar-product-information_en.pdf"
    ),
    "Manufactured by: Sanofi Pasteur SA, F-69280 Marcy l’Etoile",
    "EMEA/H/C/004262", "Mylan S.A.S", "g.biocon",
    paste(
      "Pegfilgrastim, a Mylan and Biocon biosimilar; Viatris's",
      "biosimilars went to Biocon Biologics in 2022 (the authorized Fulphila",
      "is Biocon's)"
    ),
    viatris_10k, viatris_quote,
    "EMEA/H/C/004346", "Mylan S.A.S.", "g.biocon",
    paste(
      "Trastuzumab, a Mylan and Biocon biosimilar; Viatris's biosimilars",
      "went to Biocon Biologics in 2022 (the authorized Ogivri is Biocon's)"
    ),
    viatris_10k, viatris_quote,
    "EMEA/H/C/005611", "Mylan IRE Healthcare Limited", "g.biocon",
    paste(
      "Bevacizumab, a Mylan and Biocon biosimilar authorized with Abevmy",
      "on 21 April 2021; Viatris's biosimilars went to Biocon Biologics in",
      "2022 (Abevmy is Biocon's)"
    ),
    viatris_10k, viatris_quote,
    "EMEA/H/C/001042", "Merck Sharp & Dohme B.V.", "g.organon",
    paste(
      "Follitropin beta, as Puregon; MSD's women's health business went to",
      "Organon in 2021 (Puregon is Organon's)"
    ),
    organon_10k, "Follistim (follitropin beta injection)",
    "EMEA/H/C/000311", "Schering-Plough Europe", "g.organon",
    desloratadine_note, organon_10k, organon_desloratadine,
    "EMEA/H/C/000312", "Schering-Plough Europe", "g.organon",
    desloratadine_note, organon_10k, organon_desloratadine,
    "EMEA/H/C/001217", "Schering-Plough Europe", "g.organon",
    paste(
      "Mometasone furoate with formoterol (Dulera in the U.S.); MSD's",
      "established brands went to Organon in 2021"
    ),
    organon_10k,
    paste(
      "which is also marketed as Zenhale™ in certain markets outside the",
      "United States"
    ),
    "EMEA/H/C/001108", "Wyeth Consumer Healthcare", "g.haleon",
    # The evidence shows the current owner (GSK introducing Haleon, its
    # consumer health business, before the July 2022 demerger).
    paste(
      "Ibuprofen with diphenhydramine (Advil): Pfizer's consumer health",
      "portfolio joined GSK's in 2019, and that business became Haleon in",
      "2022, with Advil among its global brands"
    ),
    paste0(
      "https://www.gsk.com/en-gb/media/press-releases/",
      "gsk-introduces-haleon-to-investors/"
    ),
    paste(
      "The portfolio comprises global power brands such as Sensodyne,",
      "Panadol, Advil, Voltaren, Theraflu, Otrivin, and Centrum"
    ),
    # Ioa: MSD held it when it was withdrawn in 2014 (EMA's field names
    # Organon N.V.; the Union Register, MSD).
    "EMEA/H/C/002068", "Organon N.V.", "g.theramex",
    paste(
      "Nomegestrol acetate with estradiol, as Zoely; MSD, Ioa's holder when",
      "it was withdrawn in 2014, sold its further rights to Zoely to Theramex",
      "in 2020, keeping the U.S. and Canada (the authorized Zoely is",
      "Theramex's)"
    ),
    paste0(
      "https://www.prnewswire.com/news-releases/theramex-acquires-commercial-",
      "rights-for-oral-contraceptive-zoely-300990650.html"
    ),
    paste(
      "entered into a definitive agreement to acquire further rights to",
      "Zoely®, a patented oral contraceptive, from MSD"
    ),
    # Later holders that only the Union Register names (not Active there,
    # so EMA's older holder is used), confirmed by EMA's medicine page.
    "EMEA/H/C/000279", "Eisai GmbH", "g.advanz",
    paste(
      "Alitretinoin gel; Amdipharm (Advanz Pharma) held it when it was",
      "withdrawn in 2021 (EMA's holder field still names Eisai)"
    ),
    "https://www.ema.europa.eu/en/medicines/human/EPAR/panretin",
    paste(
      "at the request of the marketing authorisation holder, Amdipharm",
      "Limited, which notified the European Commission"
    ),
    "EMEA/H/C/000745", "Mallinckrodt Deutschland GmbH", "g.guerbet",
    paste(
      "Gadoversetamide; Guerbet held Optimark when it expired in 2017 (EMA's",
      "holder field still names Mallinckrodt)"
    ),
    "https://www.ema.europa.eu/en/medicines/human/EPAR/optimark",
    paste(
      "expired on 25 July 2017 following the decision of the marketing",
      "authorisation holder, Guerbet, not to apply for a renewal"
    ),
    "EMEA/H/C/003795", "Pharmathen S.A.", "g.techdow",
    paste(
      "Enoxaparin, a duplicate of Techdow's Inhixa; Techdow Pharma",
      "Netherlands held it when it lapsed in 2019 (EMA's holder field still",
      "names Pharmathen)"
    ),
    "https://www.ema.europa.eu/en/medicines/human/EPAR/thorinane",
    paste(
      "the marketing authorisation holder, Techdow Pharma Netherlands B.V.,",
      "had not marketed Thorinane in the EU since its initial marketing",
      "authorisation"
    )
  ) |>
    dplyr::mutate(checked_date = as.Date("2026-09-28"))
}

# Notes about a medicine's later ownership that do not move it (user
# decision 2026-09-28): the medicine stays in its company's group (`source`
# unchanged) and the note and evidence URL fill its `group_note` and
# `group_evidence_url`. A medicine has at most one group note, so a per-
# medicine group row and a note for the same medicine stop the build.
curated_medicine_notes <- function() {
  dplyr::tribble(
    ~ema_product_number, ~note, ~evidence_url,
    # Udenyca stays with Coherus (user decision 2026-09-28): only its U.S.
    # business was sold; the EU medicine is withdrawn.
    "EMEA/H/C/004413",
    paste(
      "Coherus sold its U.S. Udenyca business to Intas in April 2025: Accord",
      "BioPharma, Intas's U.S. specialty division, now owns it"
    ),
    paste0(
      "https://www.globenewswire.com/news-release/2025/04/14/3060846/33333/",
      "en/Coherus-Completes-Strategic-Transformation-with-Successful-",
      "Divestiture-of-UDENYCA-Franchise.html"
    )
  ) |>
    dplyr::mutate(checked_date = as.Date("2026-09-28"))
}
