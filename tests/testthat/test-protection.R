snapshot <- as.Date("2026-09-26")

# Real products and dates; generic/biosimilar flags as EMA publishes them.
protection_medicines <- function() {
  dplyr::tibble(
    ema_product_number = paste0(
      "EMEA/H/C/",
      c("000603", "005752", "000980", "002788", "005961", "004049", "005620")
    ),
    name_of_medicine = c(
      "Tysabri", "Tyruko", "Samsca", "Jinarc", "Tolvaptan Accord",
      "Tenofovir disoproxil Viatris", "Mounjaro"
    ),
    medicine_status = "Authorised",
    generic = c(FALSE, FALSE, FALSE, FALSE, TRUE, TRUE, FALSE),
    biosimilar = c(FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE),
    marketing_authorisation_date = as.Date(c(
      "2006-06-27", "2023-09-22", "2009-08-03", "2015-05-27", NA,
      "2016-12-08", "2022-09-15"
    )),
    substance_set_key = c(
      "natalizumab", "natalizumab", "tolvaptan", "tolvaptan", "tolvaptan",
      "tenofovir disoproxil", "tirzepatide"
    )
  )
}

# The set keys as EMA spells them, with no equivalents: each set is its own.
set_keys_of <- function(medicines) {
  dplyr::transmute(
    medicines,
    .data$ema_product_number,
    set_key = .data$substance_set_key,
    equivalent_set_key = .data$substance_set_key
  )
}

no_groups <- function() {
  dplyr::tibble(ema_product_number = character(), group_key = character())
}

no_copies <- function() {
  dplyr::tibble(
    ema_product_number = character(),
    reference_product_number = character()
  )
}

no_pumas <- function() {
  dplyr::tibble(ema_product_number = character())
}

protection_of <- function(medicines,
                          set_keys = set_keys_of(medicines),
                          medicine_groups = no_groups(),
                          copies = no_copies(),
                          pumas = no_pumas()) {
  build_protection_table(
    medicines,
    snapshot,
    set_keys,
    medicine_groups,
    copies,
    pumas
  )
}

protection_row <- function(protection, product_number) {
  protection[protection$ema_product_number == product_number, ]
}

test_that("build_protection_table has one row per medicine with an MA date", {
  protection <- protection_of(protection_medicines())
  expect_named(
    protection,
    c(
      "ema_product_number", "basis", "copy_source", "reference_product_number",
      "reference_name", "counted_from", "own_reference_product_number",
      "own_counted_from", "data_exclusivity_end", "data_exclusivity_end_max",
      "market_protection_end_min", "market_protection_end_max", "status",
      "source"
    )
  )
  expect_identical(
    protection$ema_product_number,
    paste0(
      "EMEA/H/C/",
      c("000603", "000980", "002788", "004049", "005620", "005752")
    )
  )
  expect_identical(unique(protection$source), "estimate_from_ema_dates")
})

test_that("an originator counts from the first product of its substances", {
  protection <- protection_of(protection_medicines())
  mounjaro <- protection_row(protection, "EMEA/H/C/005620")
  expect_identical(mounjaro$basis, "own")
  expect_identical(mounjaro$copy_source, NA_character_)
  expect_identical(mounjaro$reference_product_number, "EMEA/H/C/005620")
  expect_identical(mounjaro$reference_name, "Mounjaro")
  expect_identical(mounjaro$counted_from, as.Date("2022-09-15"))
  expect_identical(mounjaro$data_exclusivity_end, as.Date("2030-09-15"))
  expect_identical(mounjaro$market_protection_end_min, as.Date("2032-09-15"))
  expect_identical(mounjaro$market_protection_end_max, as.Date("2033-09-15"))
  expect_identical(mounjaro$status, "protected")

  jinarc <- protection_row(protection, "EMEA/H/C/002788")
  expect_identical(jinarc$basis, "own")
  expect_identical(jinarc$reference_name, "Samsca")
  expect_identical(jinarc$counted_from, as.Date("2009-08-03"))
  expect_identical(jinarc$status, "ended")
})

test_that("a biosimilar follows its reference product's dates", {
  protection <- protection_of(protection_medicines())
  tyruko <- protection_row(protection, "EMEA/H/C/005752")
  expect_identical(tyruko$basis, "follows_reference")
  expect_identical(tyruko$copy_source, "ema_flag")
  expect_identical(tyruko$reference_product_number, "EMEA/H/C/000603")
  expect_identical(tyruko$reference_name, "Tysabri")
  expect_identical(tyruko$counted_from, as.Date("2006-06-27"))
  expect_identical(tyruko$market_protection_end_max, as.Date("2017-06-27"))
  expect_identical(tyruko$status, "ended")
})

test_that("a generic without a reference product has no dates", {
  protection <- protection_of(protection_medicines())
  tenofovir <- protection_row(protection, "EMEA/H/C/004049")
  expect_identical(tenofovir$basis, "reference_not_found")
  expect_identical(tenofovir$copy_source, "ema_flag")
  expect_identical(tenofovir$reference_product_number, NA_character_)
  expect_identical(tenofovir$reference_name, NA_character_)
  expect_identical(tenofovir$counted_from, as.Date(NA))
  expect_identical(tenofovir$data_exclusivity_end, as.Date(NA))
  expect_identical(tenofovir$status, "unclear")
})

test_that("the status is unclear between the minimum and maximum end", {
  medicines <- dplyr::tibble(
    ema_product_number = c("EMEA/H/C/000001", "EMEA/H/C/000002"),
    name_of_medicine = c("Leap", "Edge"),
    medicine_status = "Authorised",
    generic = FALSE,
    biosimilar = FALSE,
    marketing_authorisation_date = as.Date(c("2016-02-29", "2016-09-26")),
    substance_set_key = c("a", "b")
  )
  protection <- protection_of(medicines)
  expect_identical(
    protection$data_exclusivity_end,
    as.Date(c("2024-02-29", "2024-09-26"))
  )
  expect_identical(
    protection$market_protection_end_min,
    as.Date(c("2026-03-01", "2026-09-26"))
  )
  expect_identical(
    protection$market_protection_end_max,
    as.Date(c("2027-03-01", "2027-09-26"))
  )
  expect_identical(protection$status, c("unclear", "unclear"))
})

test_that("a medicine without substances is its own reference", {
  medicines <- dplyr::tibble(
    ema_product_number = c("EMEA/H/C/000001", "EMEA/H/C/000002"),
    name_of_medicine = c("First", "Second"),
    medicine_status = "Authorised",
    generic = c(FALSE, TRUE),
    biosimilar = FALSE,
    marketing_authorisation_date = as.Date(c("2020-01-01", "2021-01-01")),
    substance_set_key = NA_character_
  )
  protection <- protection_of(medicines)
  expect_identical(protection$basis, c("own", "reference_not_found"))
  expect_identical(protection$reference_name, c("First", NA))
  expect_identical(protection$counted_from, as.Date(c("2020-01-01", NA)))
})

# Plavix and Iscover (Sanofi) are one application's two brands, a day apart.
test_that("the lower product number is named, counted from the first date", {
  medicines <- dplyr::tibble(
    ema_product_number = c("EMEA/H/C/000175", "EMEA/H/C/000174"),
    name_of_medicine = c("Iscover", "Plavix"),
    medicine_status = "Authorised",
    generic = FALSE,
    biosimilar = FALSE,
    marketing_authorisation_date = as.Date(c("1998-07-14", "1998-07-15")),
    substance_set_key = "clopidogrel"
  )
  protection <- protection_of(medicines)
  expect_identical(protection$reference_name, c("Plavix", "Plavix"))
  expect_identical(
    protection$counted_from,
    as.Date(c("1998-07-14", "1998-07-14"))
  )
})

# Trudexa, withdrawn, was authorised a week before Humira; Amgevita is a
# biosimilar of Humira. Protection runs from Trudexa's date.
test_that("an authorised product within 30 days is the reference", {
  medicines <- dplyr::tibble(
    ema_product_number = paste0("EMEA/H/C/", c("000482", "000481", "004212")),
    name_of_medicine = c("Trudexa", "Humira", "Amgevita"),
    medicine_status = c("Withdrawn", "Authorised", "Authorised"),
    generic = FALSE,
    biosimilar = c(FALSE, FALSE, TRUE),
    marketing_authorisation_date = as.Date(c(
      "2003-09-01", "2003-09-08", "2017-03-21"
    )),
    substance_set_key = "adalimumab"
  )
  protection <- protection_of(medicines)
  expect_identical(protection$reference_name, rep("Humira", 3))
  expect_identical(protection$counted_from, rep(as.Date("2003-09-01"), 3))
  expect_identical(
    protection$basis,
    c("own", "own", "follows_reference")
  )
})

test_that("the first product stays the reference after 30 days", {
  medicines <- dplyr::tibble(
    ema_product_number = c("EMEA/H/C/000002", "EMEA/H/C/000001"),
    name_of_medicine = c("Early", "Later"),
    medicine_status = c("Withdrawn", "Authorised"),
    generic = FALSE,
    biosimilar = FALSE,
    marketing_authorisation_date = as.Date(c("2010-01-01", "2010-02-01")),
    substance_set_key = "a"
  )
  expect_identical(
    protection_of(medicines)$reference_name,
    c("Early", "Early")
  )
})

# Rolufta Ellipta (umeclidinium) and Incruse Ellipta (umeclidinium bromide)
# contain the same active substance, as EMA spells it in two ways.
test_that("equivalent substance sets share their first product", {
  medicines <- dplyr::tibble(
    ema_product_number = c("EMEA/H/C/002809", "EMEA/H/C/004654"),
    name_of_medicine = c(
      "Incruse Ellipta (previously Incruse)",
      "Rolufta Ellipta (previously Rolufta)"
    ),
    medicine_status = "Authorised",
    generic = FALSE,
    biosimilar = FALSE,
    marketing_authorisation_date = as.Date(c("2014-04-28", "2017-03-20")),
    substance_set_key = c("umeclidinium bromide", "umeclidinium")
  )
  set_keys <- dplyr::mutate(
    set_keys_of(medicines),
    equivalent_set_key = "umeclidinium"
  )
  protection <- protection_of(medicines, set_keys)
  rolufta <- protection_row(protection, "EMEA/H/C/004654")
  expect_identical(rolufta$basis, "own")
  expect_identical(rolufta$reference_product_number, "EMEA/H/C/002809")
  expect_identical(rolufta$counted_from, as.Date("2014-04-28"))
  expect_identical(rolufta$status, "ended")
})

# Dasatinib Accord Healthcare (dasatinib) is a generic of Sprycel (dasatinib
# (anhydrous)); Inpremzia (insulin human (rDNA)) a biosimilar of a Novo
# Nordisk insulin spelt as it is, though Sanofi's Insuman came first.
test_that("a follower prefers its own spelling, then an equivalent one", {
  medicines <- dplyr::tibble(
    ema_product_number = paste0(
      "EMEA/H/C/",
      c("000709", "006251", "000201", "000427", "005331")
    ),
    name_of_medicine = c(
      "Sprycel", "Dasatinib Accord Healthcare", "Insuman", "Actraphane",
      "Inpremzia"
    ),
    medicine_status = c(
      "Authorised", "Authorised", "Authorised", "Authorised", "Withdrawn"
    ),
    generic = c(FALSE, TRUE, FALSE, FALSE, FALSE),
    biosimilar = c(FALSE, FALSE, FALSE, FALSE, TRUE),
    marketing_authorisation_date = as.Date(c(
      "2006-11-20", "2024-07-26", "1997-02-21", "2002-10-07", "2022-04-25"
    )),
    substance_set_key = c(
      "dasatinib (anhydrous)", "dasatinib", "insulin human",
      "insulin human (rdna)", "insulin human (rdna)"
    )
  )
  set_keys <- dplyr::mutate(
    set_keys_of(medicines),
    equivalent_set_key = c(
      "dasatinib", "dasatinib", "insulin human", "insulin human",
      "insulin human"
    )
  )
  protection <- protection_of(medicines, set_keys)
  dasatinib <- protection_row(protection, "EMEA/H/C/006251")
  expect_identical(dasatinib$basis, "follows_reference")
  expect_identical(dasatinib$reference_name, "Sprycel")
  expect_identical(dasatinib$counted_from, as.Date("2006-11-20"))
  expect_identical(dasatinib$status, "ended")
  expect_identical(
    protection_row(protection, "EMEA/H/C/005331")$reference_name,
    "Actraphane"
  )
  expect_identical(
    protection_row(protection, "EMEA/H/C/000427")$reference_name,
    "Insuman"
  )
})

# Opzelura (Incyte) and Jakavi (Novartis) contain ruxolitinib; RotaTeq (MSD)
# and Rotarix (GSK) share EMA's name "rotavirus vaccine, live".
other_company_medicines <- function() {
  dplyr::tibble(
    ema_product_number = paste0(
      "EMEA/H/C/",
      c("002464", "005843", "000639", "000669")
    ),
    name_of_medicine = c("Jakavi", "Opzelura", "Rotarix", "RotaTeq"),
    medicine_status = "Authorised",
    generic = FALSE,
    biosimilar = FALSE,
    marketing_authorisation_date = as.Date(c(
      "2012-08-23", "2023-04-19", "2006-02-21", "2006-06-26"
    )),
    substance_set_key = c(
      "ruxolitinib", "ruxolitinib", "rotavirus vaccine, live",
      "rotavirus vaccine, live"
    )
  )
}

other_company_groups <- function() {
  dplyr::tibble(
    ema_product_number = paste0(
      "EMEA/H/C/",
      c("002464", "005843", "000639", "000669")
    ),
    group_key = c("g.novartis", "g.incyte", "g.gsk", "g.msd")
  )
}

test_that("another company's first product makes a differing status unclear", {
  medicines <- other_company_medicines()
  protection <- protection_of(
    medicines,
    medicine_groups = other_company_groups()
  )
  # Ended counted from Jakavi, protected counted from Opzelura itself: the
  # range covers both.
  opzelura <- protection_row(protection, "EMEA/H/C/005843")
  expect_identical(opzelura$basis, "other_company_reference")
  expect_identical(opzelura$status, "unclear")
  expect_identical(opzelura$reference_name, "Jakavi")
  expect_identical(opzelura$counted_from, as.Date("2012-08-23"))
  expect_identical(opzelura$own_reference_product_number, "EMEA/H/C/005843")
  expect_identical(opzelura$own_counted_from, as.Date("2023-04-19"))
  expect_identical(opzelura$data_exclusivity_end, as.Date("2020-08-23"))
  # Data exclusivity counted from Opzelura itself.
  expect_identical(opzelura$data_exclusivity_end_max, as.Date("2031-04-19"))
  expect_identical(opzelura$market_protection_end_min, as.Date("2022-08-23"))
  expect_identical(opzelura$market_protection_end_max, as.Date("2034-04-19"))
  jakavi <- protection_row(protection, "EMEA/H/C/002464")
  expect_identical(jakavi$basis, "own")
  expect_identical(jakavi$status, "ended")
  expect_identical(jakavi$own_reference_product_number, NA_character_)
  expect_identical(jakavi$own_counted_from, as.Date(NA))
  expect_identical(jakavi$data_exclusivity_end_max, as.Date(NA))
})

test_that("another company's first product is kept when both have ended", {
  protection <- protection_of(
    other_company_medicines(),
    medicine_groups = other_company_groups()
  )
  rotateq <- protection_row(protection, "EMEA/H/C/000669")
  expect_identical(rotateq$basis, "own")
  expect_identical(rotateq$reference_name, "Rotarix")
  expect_identical(rotateq$status, "ended")
})

# Qdenga (Takeda) and Dengvaxia (Sanofi): EMA's same generic vaccine name.
test_that("another company's product keeps a status both estimates give", {
  medicines <- dplyr::tibble(
    ema_product_number = c("EMEA/H/C/004171", "EMEA/H/C/005155"),
    name_of_medicine = c("Dengvaxia", "Qdenga"),
    medicine_status = c("Withdrawn", "Authorised"),
    generic = FALSE,
    biosimilar = FALSE,
    marketing_authorisation_date = as.Date(c("2018-12-12", "2022-12-05")),
    substance_set_key = "dengue tetravalent vaccine (live, attenuated)"
  )
  groups <- dplyr::tibble(
    ema_product_number = medicines$ema_product_number,
    group_key = c("g.sanofi", "g.takeda")
  )
  protection <- protection_of(medicines, medicine_groups = groups)
  # Protected counted from Dengvaxia and from Qdenga itself.
  qdenga <- protection_row(protection, "EMEA/H/C/005155")
  expect_identical(qdenga$basis, "other_company_reference")
  expect_identical(qdenga$status, "protected")
  expect_identical(qdenga$counted_from, as.Date("2018-12-12"))
  expect_identical(qdenga$own_counted_from, as.Date("2022-12-05"))
  expect_identical(qdenga$data_exclusivity_end, as.Date("2026-12-12"))
  expect_identical(qdenga$data_exclusivity_end_max, as.Date("2030-12-05"))
  expect_identical(qdenga$market_protection_end_min, as.Date("2028-12-12"))
  expect_identical(qdenga$market_protection_end_max, as.Date("2033-12-05"))
  expect_identical(
    protection_row(protection, "EMEA/H/C/004171")$status,
    "protected"
  )
})

# Ebixa (Lundbeck) was authorised two days before Axura (Merz), whose product
# number is lower: the window keeps to the first product's company group, so
# neither is counted from a later date than the first approval.
test_that("the first approval's company names the reference in the window", {
  medicines <- dplyr::tibble(
    ema_product_number = c("EMEA/H/C/000463", "EMEA/H/C/000378"),
    name_of_medicine = c("Ebixa", "Axura"),
    medicine_status = "Authorised",
    generic = FALSE,
    biosimilar = FALSE,
    marketing_authorisation_date = as.Date(c("2015-09-20", "2015-09-30")),
    substance_set_key = "memantine"
  )
  groups <- dplyr::tibble(
    ema_product_number = medicines$ema_product_number,
    group_key = c("g.lundbeck", "g.merz")
  )
  protection <- protection_of(medicines, medicine_groups = groups)
  ebixa <- protection_row(protection, "EMEA/H/C/000463")
  expect_identical(ebixa$basis, "own")
  expect_identical(ebixa$reference_name, "Ebixa")
  expect_identical(ebixa$counted_from, as.Date("2015-09-20"))
  expect_identical(ebixa$status, "ended")
  # Ended counted from Ebixa, unclear counted from Axura itself.
  axura <- protection_row(protection, "EMEA/H/C/000378")
  expect_identical(axura$basis, "other_company_reference")
  expect_identical(axura$reference_name, "Ebixa")
  expect_identical(axura$own_counted_from, as.Date("2015-09-30"))
  expect_identical(axura$market_protection_end_min, as.Date("2025-09-20"))
  expect_identical(axura$market_protection_end_max, as.Date("2026-09-30"))
  expect_identical(axura$status, "unclear")
})

test_that("another company's product of the same day gives the same dates", {
  medicines <- dplyr::tibble(
    ema_product_number = c("EMEA/H/C/000001", "EMEA/H/C/000002"),
    name_of_medicine = c("Brand", "Co-brand"),
    medicine_status = "Authorised",
    generic = FALSE,
    biosimilar = FALSE,
    marketing_authorisation_date = as.Date("2022-01-10"),
    substance_set_key = "a"
  )
  groups <- dplyr::tibble(
    ema_product_number = medicines$ema_product_number,
    group_key = c("g.one", "g.two")
  )
  protection <- protection_of(medicines, medicine_groups = groups)
  expect_identical(protection$basis, c("own", "own"))
  expect_identical(protection$status, c("protected", "protected"))
})

test_that("a company counts from its own first product of the substances", {
  medicines <- dplyr::bind_rows(
    other_company_medicines(),
    dplyr::tibble(
      ema_product_number = "EMEA/H/C/009999",
      name_of_medicine = "Earlier",
      medicine_status = "Withdrawn",
      generic = FALSE,
      biosimilar = FALSE,
      marketing_authorisation_date = as.Date("2013-01-10"),
      substance_set_key = "ruxolitinib"
    )
  )
  groups <- dplyr::bind_rows(
    other_company_groups(),
    dplyr::tibble(
      ema_product_number = "EMEA/H/C/009999",
      group_key = "g.incyte"
    )
  )
  protection <- protection_of(medicines, medicine_groups = groups)
  # Counted from its company's first product (2013), not from its own date
  # (2023), Opzelura's protection has ended as Jakavi's has.
  opzelura <- protection_row(protection, "EMEA/H/C/005843")
  expect_identical(opzelura$basis, "own")
  expect_identical(opzelura$reference_name, "Jakavi")
  expect_identical(opzelura$status, "ended")
})

test_that("an unknown company group keeps the first product's estimate", {
  groups <- other_company_groups()
  groups$group_key[2] <- NA_character_
  protection <- protection_of(
    other_company_medicines(),
    medicine_groups = groups
  )
  opzelura <- protection_row(protection, "EMEA/H/C/005843")
  expect_identical(opzelura$basis, "own")
  expect_identical(opzelura$status, "ended")
})

test_that("a follower of another company's product is not questioned", {
  medicines <- protection_medicines()
  groups <- dplyr::tibble(
    ema_product_number = medicines$ema_product_number,
    group_key = c(
      "g.biogen", "g.sandoz", "g.otsuka", "g.otsuka", "g.accord",
      "g.viatris", "g.eli-lilly"
    )
  )
  protection <- protection_of(medicines, medicine_groups = groups)
  expect_identical(
    protection_row(protection, "EMEA/H/C/005752")$basis,
    "follows_reference"
  )
  expect_false("other_company_reference" %in% protection$basis)
})

# Liraglutide STADA (STADA) is a hybrid of Victoza (Novo Nordisk), whose
# second liraglutide is Saxenda.
liraglutide_medicines <- function() {
  dplyr::tibble(
    ema_product_number = paste0(
      "EMEA/H/C/",
      c("001026", "003780", "006615")
    ),
    name_of_medicine = c("Victoza", "Saxenda", "Liraglutide STADA"),
    medicine_status = "Authorised",
    generic = FALSE,
    biosimilar = FALSE,
    marketing_authorisation_date = as.Date(c(
      "2009-06-30", "2015-03-23", "2026-07-15"
    )),
    substance_set_key = "liraglutide"
  )
}

liraglutide_groups <- function() {
  dplyr::tibble(
    ema_product_number = paste0(
      "EMEA/H/C/",
      c("001026", "003780", "006615")
    ),
    group_key = c("g.novo-nordisk", "g.novo-nordisk", "g.stada")
  )
}

copy_of <- function(product_number, reference_product_number) {
  dplyr::tibble(
    ema_product_number = product_number,
    reference_product_number = reference_product_number
  )
}

test_that("a curated hybrid follows its reference medicine", {
  without <- protection_of(
    liraglutide_medicines(),
    medicine_groups = liraglutide_groups()
  )
  expect_identical(
    protection_row(without, "EMEA/H/C/006615")$basis,
    "other_company_reference"
  )
  protection <- protection_of(
    liraglutide_medicines(),
    medicine_groups = liraglutide_groups(),
    copies = copy_of("EMEA/H/C/006615", "EMEA/H/C/001026")
  )
  stada <- protection_row(protection, "EMEA/H/C/006615")
  expect_identical(stada$basis, "follows_reference")
  expect_identical(stada$copy_source, "curated")
  expect_identical(stada$reference_product_number, "EMEA/H/C/001026")
  expect_identical(stada$reference_name, "Victoza")
  expect_identical(stada$counted_from, as.Date("2009-06-30"))
  expect_identical(stada$data_exclusivity_end, as.Date("2017-06-30"))
  expect_identical(stada$data_exclusivity_end_max, as.Date(NA))
  expect_identical(stada$market_protection_end_max, as.Date("2020-06-30"))
  expect_identical(stada$own_reference_product_number, NA_character_)
  expect_identical(stada$own_counted_from, as.Date(NA))
  expect_identical(stada$status, "ended")
})

test_that("a hybrid is counted from its reference's first approval", {
  protection <- protection_of(
    liraglutide_medicines(),
    medicine_groups = liraglutide_groups(),
    copies = copy_of("EMEA/H/C/006615", "EMEA/H/C/003780")
  )
  stada <- protection_row(protection, "EMEA/H/C/006615")
  expect_identical(stada$reference_name, "Saxenda")
  expect_identical(stada$counted_from, as.Date("2009-06-30"))
})

# Riulvy (tegomil fumarate), which EMA flags generic, is a hybrid of
# Tecfidera (dimethyl fumarate): another active substance.
test_that("a hybrid follows its reference across substances", {
  medicines <- dplyr::tibble(
    ema_product_number = c("EMEA/H/C/002601", "EMEA/H/C/006427"),
    name_of_medicine = c("Tecfidera", "Riulvy"),
    medicine_status = "Authorised",
    generic = c(FALSE, TRUE),
    biosimilar = FALSE,
    marketing_authorisation_date = as.Date(c("2014-01-30", "2025-07-28")),
    substance_set_key = c("dimethyl fumarate", "tegomil fumarate")
  )
  expect_identical(
    protection_row(protection_of(medicines), "EMEA/H/C/006427")$basis,
    "reference_not_found"
  )
  riulvy <- protection_row(
    protection_of(
      medicines,
      copies = copy_of("EMEA/H/C/006427", "EMEA/H/C/002601")
    ),
    "EMEA/H/C/006427"
  )
  expect_identical(riulvy$basis, "follows_reference")
  expect_identical(riulvy$reference_name, "Tecfidera")
  expect_identical(riulvy$counted_from, as.Date("2014-01-30"))
  expect_identical(riulvy$status, "ended")
})

# Xromi (Lipomed) is a hybrid of Hydrea, authorised nationally; Siklos
# (Theravia) was the first central hydroxycarbamide.
test_that("a hybrid of a nationally authorised medicine has no reference", {
  medicines <- dplyr::tibble(
    ema_product_number = c("EMEA/H/C/000689", "EMEA/H/C/004837"),
    name_of_medicine = c("Siklos", "Xromi"),
    medicine_status = "Authorised",
    generic = FALSE,
    biosimilar = FALSE,
    marketing_authorisation_date = as.Date(c("2007-06-29", "2019-07-01")),
    substance_set_key = "hydroxycarbamide"
  )
  groups <- dplyr::tibble(
    ema_product_number = medicines$ema_product_number,
    group_key = c("g.theravia", "g.lipomed")
  )
  protection <- protection_of(
    medicines,
    medicine_groups = groups,
    copies = copy_of("EMEA/H/C/004837", NA_character_)
  )
  xromi <- protection_row(protection, "EMEA/H/C/004837")
  expect_identical(xromi$basis, "reference_not_found")
  expect_identical(xromi$copy_source, "curated")
  expect_identical(xromi$reference_name, NA_character_)
  expect_identical(xromi$counted_from, as.Date(NA))
  expect_identical(xromi$own_counted_from, as.Date(NA))
  expect_identical(xromi$status, "unclear")
})

# Buvidal (Camurus) is a hybrid of Subutex, authorised nationally; Sixmo
# (Molteni), a buprenorphine implant, came half a year later.
test_that("a hybrid is no other medicine's first product", {
  medicines <- dplyr::tibble(
    ema_product_number = c("EMEA/H/C/004651", "EMEA/H/C/004743"),
    name_of_medicine = c("Buvidal", "Sixmo"),
    medicine_status = c("Authorised", "Withdrawn"),
    generic = FALSE,
    biosimilar = FALSE,
    marketing_authorisation_date = as.Date(c("2018-11-20", "2019-06-19")),
    substance_set_key = "buprenorphine"
  )
  groups <- dplyr::tibble(
    ema_product_number = medicines$ema_product_number,
    group_key = c(
      "g.camurus",
      "g.l-molteni-c-dei-fratelli-alitti-societa-di-esercizio"
    )
  )
  without <- protection_of(medicines, medicine_groups = groups)
  expect_identical(
    protection_row(without, "EMEA/H/C/004651")$status,
    "protected"
  )
  expect_identical(
    protection_row(without, "EMEA/H/C/004743")$basis,
    "other_company_reference"
  )
  protection <- protection_of(
    medicines,
    medicine_groups = groups,
    copies = copy_of("EMEA/H/C/004651", NA_character_)
  )
  expect_identical(
    protection_row(protection, "EMEA/H/C/004651")$basis,
    "reference_not_found"
  )
  sixmo <- protection_row(protection, "EMEA/H/C/004743")
  expect_identical(sixmo$basis, "own")
  expect_identical(sixmo$reference_name, "Sixmo")
  expect_identical(sixmo$counted_from, as.Date("2019-06-19"))
  expect_identical(sixmo$data_exclusivity_end_max, as.Date(NA))
  expect_identical(sixmo$market_protection_end_max, as.Date("2030-06-19"))
  expect_identical(sixmo$status, "protected")
})

# Sugammadex Adroiq (Extrovis) is a generic of Bridion (MSD) by its EPAR,
# though EMA's generic flag is false.
test_that("a curated generic follows its reference medicine", {
  medicines <- dplyr::tibble(
    ema_product_number = c("EMEA/H/C/000885", "EMEA/H/C/006046"),
    name_of_medicine = c("Bridion", "Sugammadex Adroiq"),
    medicine_status = "Authorised",
    generic = FALSE,
    biosimilar = FALSE,
    marketing_authorisation_date = as.Date(c("2008-07-25", "2023-05-26")),
    substance_set_key = "sugammadex"
  )
  groups <- dplyr::tibble(
    ema_product_number = medicines$ema_product_number,
    group_key = c("g.msd", "g.extrovis")
  )
  expect_identical(
    protection_row(
      protection_of(medicines, medicine_groups = groups),
      "EMEA/H/C/006046"
    )$status,
    "unclear"
  )
  adroiq <- protection_row(
    protection_of(
      medicines,
      medicine_groups = groups,
      copies = copy_of("EMEA/H/C/006046", "EMEA/H/C/000885")
    ),
    "EMEA/H/C/006046"
  )
  expect_identical(adroiq$basis, "follows_reference")
  expect_identical(adroiq$copy_source, "curated")
  expect_identical(adroiq$reference_name, "Bridion")
  expect_identical(adroiq$data_exclusivity_end_max, as.Date(NA))
  expect_identical(adroiq$market_protection_end_max, as.Date("2019-07-25"))
  expect_identical(adroiq$status, "ended")
})

# Alkindi (Immedica) is a paediatric-use marketing authorisation (PUMA) of
# hydrocortisone, first centrally approved as Plenadren (Takeda); Slenyto a
# PUMA of melatonin, whose company's Circadin came first.
puma_medicines <- function() {
  dplyr::tibble(
    ema_product_number = paste0(
      "EMEA/H/C/",
      c("002185", "004416", "000695", "004425")
    ),
    name_of_medicine = c("Plenadren", "Alkindi", "Circadin", "Slenyto"),
    medicine_status = "Authorised",
    generic = FALSE,
    biosimilar = FALSE,
    marketing_authorisation_date = as.Date(c(
      "2011-11-03", "2018-02-09", "2007-06-29", "2018-09-20"
    )),
    substance_set_key = c(
      "hydrocortisone", "hydrocortisone", "melatonin", "melatonin"
    )
  )
}

puma_groups <- function() {
  dplyr::tibble(
    ema_product_number = paste0(
      "EMEA/H/C/",
      c("002185", "004416", "000695", "004425")
    ),
    group_key = c(
      "g.takeda", "g.immedica-pharma", "g.rad-neurim-pharmaceuticals-eec",
      "g.rad-neurim-pharmaceuticals-eec"
    )
  )
}

puma_of <- function(product_numbers) {
  dplyr::tibble(ema_product_number = product_numbers)
}

test_that("a paediatric-use marketing authorisation counts from itself", {
  pumas <- puma_of(c("EMEA/H/C/004416", "EMEA/H/C/004425"))
  without <- protection_of(puma_medicines(), medicine_groups = puma_groups())
  expect_identical(
    protection_row(without, "EMEA/H/C/004416")$basis,
    "other_company_reference"
  )
  expect_identical(protection_row(without, "EMEA/H/C/004425")$status, "ended")
  protection <- protection_of(
    puma_medicines(),
    medicine_groups = puma_groups(),
    pumas = pumas
  )
  alkindi <- protection_row(protection, "EMEA/H/C/004416")
  expect_identical(alkindi$basis, "paediatric_use")
  expect_identical(alkindi$copy_source, NA_character_)
  expect_identical(alkindi$reference_product_number, "EMEA/H/C/004416")
  expect_identical(alkindi$reference_name, "Alkindi")
  expect_identical(alkindi$counted_from, as.Date("2018-02-09"))
  expect_identical(alkindi$own_reference_product_number, NA_character_)
  expect_identical(alkindi$own_counted_from, as.Date(NA))
  expect_identical(alkindi$data_exclusivity_end, as.Date("2026-02-09"))
  expect_identical(alkindi$data_exclusivity_end_max, as.Date(NA))
  expect_identical(alkindi$market_protection_end_min, as.Date("2028-02-09"))
  expect_identical(alkindi$market_protection_end_max, as.Date("2029-02-09"))
  expect_identical(alkindi$status, "protected")
  # Counted from Circadin, its company's first melatonin, it had ended.
  slenyto <- protection_row(protection, "EMEA/H/C/004425")
  expect_identical(slenyto$basis, "paediatric_use")
  expect_identical(slenyto$counted_from, as.Date("2018-09-20"))
  expect_identical(slenyto$status, "protected")
  # The other medicines of the substance keep their estimates.
  plenadren <- protection_row(protection, "EMEA/H/C/002185")
  expect_identical(plenadren$basis, "own")
  expect_identical(plenadren$counted_from, as.Date("2011-11-03"))
  expect_identical(
    protection_row(protection, "EMEA/H/C/000695")$reference_name,
    "Circadin"
  )
})

test_that("a paediatric-use marketing authorisation is no copy", {
  medicines <- dplyr::mutate(
    puma_medicines(),
    generic = .data$name_of_medicine == "Alkindi"
  )
  alkindi <- protection_row(
    protection_of(
      medicines,
      medicine_groups = puma_groups(),
      pumas = puma_of("EMEA/H/C/004416")
    ),
    "EMEA/H/C/004416"
  )
  expect_identical(alkindi$basis, "paediatric_use")
  expect_identical(alkindi$copy_source, NA_character_)
  expect_identical(alkindi$counted_from, as.Date("2018-02-09"))
})

test_that("a curated copy of a PUMA follows the PUMA's own approval", {
  medicines <- dplyr::bind_rows(
    puma_medicines(),
    dplyr::tibble(
      ema_product_number = "EMEA/H/C/009999",
      name_of_medicine = "Stand-in hybrid",
      medicine_status = "Authorised",
      generic = FALSE,
      biosimilar = FALSE,
      marketing_authorisation_date = as.Date("2026-01-15"),
      substance_set_key = "hydrocortisone"
    )
  )
  copy <- protection_row(
    protection_of(
      medicines,
      medicine_groups = puma_groups(),
      copies = copy_of("EMEA/H/C/009999", "EMEA/H/C/004416"),
      pumas = puma_of("EMEA/H/C/004416")
    ),
    "EMEA/H/C/009999"
  )
  expect_identical(copy$basis, "follows_reference")
  expect_identical(copy$reference_name, "Alkindi")
  expect_identical(copy$counted_from, as.Date("2018-02-09"))
  expect_identical(copy$status, "protected")
})

curated_copy_row <- function() {
  dplyr::tibble(
    ema_product_number = "EMEA/H/C/006615",
    copy_type = "hybrid",
    reference_product_number = "EMEA/H/C/001026",
    reference_name = "Victoza",
    evidence_url = paste0(
      "https://www.ema.europa.eu/en/medicines/human/EPAR/",
      "liraglutide-stada"
    ),
    evidence_quote = "Liraglutide STADA is a ‘hybrid medicine’.",
    checked_date = as.Date("2026-09-29"),
    note = NA_character_
  )
}

test_that("check_curated_copies accepts well-formed rows", {
  copies <- dplyr::bind_rows(
    curated_copy_row(),
    curated_copy_row() |>
      dplyr::mutate(
        ema_product_number = "EMEA/H/C/004837",
        reference_product_number = NA_character_,
        reference_name = "Hydrea"
      ),
    curated_copy_row() |>
      dplyr::mutate(
        ema_product_number = "EMEA/H/C/006046",
        copy_type = "generic",
        reference_product_number = "EMEA/H/C/000885",
        reference_name = "Bridion",
        evidence_quote = "Sugammadex Adroiq is a ‘generic medicine’."
      )
  )
  expect_identical(check_curated_copies(copies), copies)
})

test_that("check_curated_copies aborts on malformed rows", {
  expect_copy_error <- function(copies, offender) {
    error <- expect_error(
      check_curated_copies(copies),
      class = "rlang_error"
    )
    expect_match(conditionMessage(error), offender, fixed = TRUE)
  }
  row <- curated_copy_row()
  expect_copy_error(
    dplyr::mutate(row, ema_product_number = "H/C/6615"),
    "H/C/6615"
  )
  expect_copy_error(
    dplyr::mutate(row, reference_product_number = "EMEA/H/C/1026"),
    "EMEA/H/C/006615"
  )
  expect_copy_error(
    dplyr::mutate(row, reference_product_number = "EMEA/H/C/006615"),
    "EMEA/H/C/006615"
  )
  expect_copy_error(
    dplyr::mutate(row, reference_name = NA_character_),
    "EMEA/H/C/006615"
  )
  expect_copy_error(
    dplyr::mutate(row, evidence_url = "http://www.ema.europa.eu/"),
    "EMEA/H/C/006615"
  )
  expect_copy_error(
    dplyr::mutate(row, evidence_quote = paste(rep("word", 21), collapse = " ")),
    "EMEA/H/C/006615"
  )
  expect_copy_error(
    dplyr::mutate(row, evidence_quote = NA_character_),
    "EMEA/H/C/006615"
  )
  expect_copy_error(
    dplyr::mutate(row, checked_date = as.Date(NA)),
    "EMEA/H/C/006615"
  )
  # The quote must name the copy type.
  expect_copy_error(
    dplyr::mutate(row, copy_type = "generic"),
    "EMEA/H/C/006615"
  )
  expect_copy_error(
    dplyr::mutate(
      row,
      copy_type = "duplicate",
      evidence_quote = "Liraglutide STADA is a duplicate."
    ),
    "EMEA/H/C/006615"
  )
  expect_copy_error(
    dplyr::mutate(row, copy_type = NA_character_),
    "EMEA/H/C/006615"
  )
  expect_copy_error(dplyr::bind_rows(row, row), "more than once")
  chained <- dplyr::bind_rows(
    row,
    dplyr::mutate(
      row,
      ema_product_number = "EMEA/H/C/001026",
      reference_product_number = "EMEA/H/C/000001"
    )
  )
  expect_copy_error(chained, "EMEA/H/C/006615")
})

test_that("select_curated_copies leaves out rows not in the data", {
  copies <- dplyr::bind_rows(
    curated_copy_row(),
    curated_copy_row() |>
      dplyr::mutate(ema_product_number = "EMEA/H/C/009999"),
    curated_copy_row() |>
      dplyr::mutate(
        ema_product_number = "EMEA/H/C/003780",
        reference_product_number = "EMEA/H/C/009998"
      ),
    curated_copy_row() |>
      dplyr::mutate(
        ema_product_number = "EMEA/H/C/001026",
        reference_product_number = NA_character_,
        reference_name = "A national medicine"
      )
  )
  expect_warning(
    selected <- select_curated_copies(copies, liraglutide_medicines()),
    "EMEA/H/C/009999"
  )
  expect_identical(
    selected$ema_product_number,
    c("EMEA/H/C/001026", "EMEA/H/C/006615")
  )
  expect_identical(
    selected$reference_product_number,
    c(NA, "EMEA/H/C/001026")
  )
  expect_identical(
    names(selected),
    c(names(curated_copy_row()), "source")
  )
  expect_identical(unique(selected$source), "curated")
  expect_no_warning(select_curated_copies(
    curated_copy_row(),
    liraglutide_medicines()
  ))
})

test_that("the curated copies are well formed and say so", {
  copies <- curated_copy_medicines()
  expect_identical(check_curated_copies(copies), copies)
  expect_true(all(startsWith(
    copies$evidence_url,
    "https://www.ema.europa.eu/en/medicines/human/EPAR/"
  )))
  expect_identical(
    sort(unique(copies$copy_type)),
    c("biosimilar", "generic", "hybrid")
  )
  copy_of_product <- function(product_number) {
    copies[copies$ema_product_number == product_number, ]
  }
  # Buvidal, Camcevi and Okedi: hybrids of Subutex, Eligard and Risperdal,
  # authorised nationally.
  national <- paste0("EMEA/H/C/", c("004651", "005034", "005406"))
  expect_true(all(national %in% copies$ema_product_number))
  expect_true(all(is.na(
    copies$reference_product_number[copies$ema_product_number %in% national]
  )))
  expect_identical(copy_of_product("EMEA/H/C/006046")$copy_type, "generic")
  expect_identical(
    copy_of_product("EMEA/H/C/006046")$reference_product_number,
    "EMEA/H/C/000885"
  )
  expect_identical(copy_of_product("EMEA/H/C/006252")$copy_type, "biosimilar")
  expect_identical(
    copy_of_product("EMEA/H/C/006252")$reference_product_number,
    "EMEA/H/C/000278"
  )
  # From the EPAR scan of 2026-09-29: Ledaga, Nyxoid, Trepulmix and Ryjunea
  # (protected), and Nordimet (unclear), hybrids of medicines authorised
  # nationally.
  scanned <- paste0(
    "EMEA/H/C/",
    c("002826", "004325", "005207", "006324", "003983")
  )
  expect_identical(copy_of_product(scanned[1])$reference_name, "Caryolysine")
  expect_identical(copy_of_product(scanned[5])$reference_name, "Lantarel FS")
  expect_true(all(is.na(
    copies$reference_product_number[copies$ema_product_number %in% scanned]
  )))
  expect_true(all(scanned %in% copies$ema_product_number))
  expect_identical(nrow(copies), 41L)
})

puma_row <- function() {
  dplyr::tibble(
    ema_product_number = "EMEA/H/C/004416",
    evidence_url = paste0(
      "https://www.ema.europa.eu/en/documents/assessment-report/",
      "alkindi-epar-public-assessment-report_en.pdf"
    ),
    evidence_quote = paste(
      "an application for a Paediatric Use marketing authorisation in",
      "accordance with Article 30 of Regulation (EC) No 1901/2006"
    ),
    checked_date = as.Date("2026-09-29"),
    note = NA_character_
  )
}

test_that("check_curated_pumas accepts well-formed rows", {
  pumas <- dplyr::bind_rows(
    puma_row(),
    dplyr::mutate(
      puma_row(),
      ema_product_number = "EMEA/H/C/006044",
      evidence_quote = "an application for a paediatric-use marketing
      authorisation"
    )
  )
  expect_identical(check_curated_pumas(pumas, curated_copy_row()), pumas)
})

test_that("check_curated_pumas aborts on malformed rows", {
  expect_puma_error <- function(pumas, offender, copies = curated_copy_row()) {
    error <- expect_error(
      check_curated_pumas(pumas, copies),
      class = "rlang_error"
    )
    expect_match(conditionMessage(error), offender, fixed = TRUE)
  }
  row <- puma_row()
  expect_puma_error(
    dplyr::mutate(row, ema_product_number = "H/C/4416"),
    "H/C/4416"
  )
  expect_puma_error(
    dplyr::mutate(row, evidence_url = "http://www.ema.europa.eu/"),
    "EMEA/H/C/004416"
  )
  expect_puma_error(
    dplyr::mutate(row, evidence_quote = paste(rep("word", 21), collapse = " ")),
    "EMEA/H/C/004416"
  )
  # The quote must say it is a paediatric-use marketing authorisation.
  expect_puma_error(
    dplyr::mutate(row, evidence_quote = "Alkindi is a ‘hybrid medicine’."),
    "EMEA/H/C/004416"
  )
  expect_puma_error(
    dplyr::mutate(row, checked_date = as.Date(NA)),
    "EMEA/H/C/004416"
  )
  expect_puma_error(dplyr::bind_rows(row, row), "more than once")
  expect_puma_error(
    dplyr::mutate(row, ema_product_number = "EMEA/H/C/006615"),
    "also a curated copy"
  )
})

test_that("select_curated_pumas leaves out rows not in the data", {
  pumas <- dplyr::bind_rows(
    puma_row(),
    dplyr::mutate(puma_row(), ema_product_number = "EMEA/H/C/009999")
  )
  expect_warning(
    selected <- select_curated_pumas(pumas, puma_medicines()),
    "EMEA/H/C/009999"
  )
  expect_identical(selected$ema_product_number, "EMEA/H/C/004416")
  expect_identical(names(selected), c(names(puma_row()), "source"))
  expect_identical(selected$source, "curated")
  expect_no_warning(select_curated_pumas(puma_row(), puma_medicines()))
})

test_that("the curated PUMAs are well formed and no curated copies", {
  pumas <- curated_puma_medicines()
  expect_identical(
    check_curated_pumas(pumas, curated_copy_medicines()),
    pumas
  )
  expect_true(all(startsWith(
    pumas$evidence_url,
    "https://www.ema.europa.eu/en/documents/"
  )))
  # Alkindi, and the five the EPAR scan found calling themselves hybrids:
  # Kigabeq, Aqumeldi, Tuzulby, Neoatricon and Bopediat.
  hybrids <- paste0(
    "EMEA/H/C/",
    c("004416", "004534", "005731", "005975", "006044", "006617")
  )
  expect_true(all(hybrids %in% pumas$ema_product_number))
  expect_identical(nrow(pumas), 11L)
})

test_that("build_protection_tables applies and returns the curated copies", {
  medicines <- liraglutide_medicines()
  tables <- list(
    ema_medicines = medicines,
    ema_medicine_substances = dplyr::tibble(
      ema_product_number = medicines$ema_product_number,
      substance = "liraglutide",
      substance_key = "liraglutide"
    ),
    ema_medicine_companies = liraglutide_groups()
  )
  # Saxenda stands in for a PUMA.
  built <- build_protection_tables(
    tables,
    snapshot,
    equivalents = curated_substance_equivalents()[0, ],
    copies = curated_copy_row(),
    pumas = dplyr::mutate(puma_row(), ema_product_number = "EMEA/H/C/003780")
  )
  expect_named(
    built,
    c(
      "ema_medicine_protection", "ema_substance_equivalents",
      "ema_curated_copies", "ema_curated_pumas"
    )
  )
  stada <- protection_row(built$ema_medicine_protection, "EMEA/H/C/006615")
  expect_identical(stada$basis, "follows_reference")
  expect_identical(stada$copy_source, "curated")
  expect_identical(nrow(built$ema_substance_equivalents), 0L)
  expect_identical(built$ema_curated_copies$reference_name, "Victoza")
  saxenda <- protection_row(built$ema_medicine_protection, "EMEA/H/C/003780")
  expect_identical(saxenda$basis, "paediatric_use")
  expect_identical(saxenda$counted_from, as.Date("2015-03-23"))
  expect_identical(
    built$ema_curated_pumas$ema_product_number,
    "EMEA/H/C/003780"
  )
})

test_that("curated_pumas_source_entry dates the entry by the last check", {
  expect_null(curated_pumas_source_entry(puma_row()[0, ]))
  entry <- curated_pumas_source_entry(dplyr::bind_rows(
    puma_row(),
    dplyr::mutate(puma_row(), checked_date = as.Date("2026-09-30"))
  ))
  expect_match(entry$name, "paediatric-use marketing authorisations")
  expect_match(entry$name, "EMA public assessment reports", fixed = TRUE)
  expect_identical(entry$version, "Checked 2026-09-30")
  expect_identical(entry$retrieved, "2026-09-30")
  expect_match(entry$url, "R/curated-copies.R$")
  expect_match(entry$attribution, "European Medicines Agency", fixed = TRUE)
})

test_that("curated_copies_source_entry dates the entry by the last check", {
  expect_null(curated_copies_source_entry(curated_copy_row()[0, ]))
  entry <- curated_copies_source_entry(dplyr::bind_rows(
    curated_copy_row(),
    dplyr::mutate(curated_copy_row(), checked_date = as.Date("2026-09-30"))
  ))
  expect_match(entry$name, "EMA EPAR pages", fixed = TRUE)
  expect_identical(entry$version, "Checked 2026-09-30")
  expect_identical(entry$retrieved, "2026-09-30")
  expect_match(entry$url, "R/curated-copies.R$")
  expect_match(entry$attribution, "European Medicines Agency", fixed = TRUE)
})
test_that("add_months rolls a missing day into the next month", {
  expect_identical(
    add_months(as.Date(c("2016-02-29", "2020-01-31", NA)), c(120L, 12L, 1L)),
    as.Date(c("2026-03-01", "2021-01-31", NA))
  )
})

test_that("protection_set_keys joins keys as spelt and as equivalents", {
  substances <- dplyr::tibble(
    ema_product_number = c(
      "EMEA/H/C/004983", "EMEA/H/C/004983", "EMEA/H/C/004983",
      "EMEA/H/C/005311", "EMEA/H/C/005311", "EMEA/H/C/005311"
    ),
    substance_key = c(
      "budesonide", "formoterol", "glycopyrronium bromide",
      "budesonide", "formoterol fumarate dihydrate", "glycopyrronium"
    )
  )
  equivalents <- dplyr::tibble(
    substance_key = c("formoterol", "glycopyrronium"),
    equivalent_key = c(
      "formoterol fumarate dihydrate",
      "glycopyrronium bromide"
    )
  )
  expect_identical(
    protection_set_keys(substances, equivalents),
    dplyr::tibble(
      ema_product_number = c("EMEA/H/C/004983", "EMEA/H/C/005311"),
      set_key = c(
        "budesonide|formoterol|glycopyrronium bromide",
        "budesonide|formoterol fumarate dihydrate|glycopyrronium"
      ),
      equivalent_set_key = rep("budesonide|formoterol|glycopyrronium", 2)
    )
  )
})
