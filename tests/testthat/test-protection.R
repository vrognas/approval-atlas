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

protection_of <- function(medicines,
                          set_keys = set_keys_of(medicines),
                          medicine_groups = no_groups()) {
  build_protection_table(medicines, snapshot, set_keys, medicine_groups)
}

protection_row <- function(protection, product_number) {
  protection[protection$ema_product_number == product_number, ]
}

test_that("build_protection_table has one row per medicine with an MA date", {
  protection <- protection_of(protection_medicines())
  expect_named(
    protection,
    c(
      "ema_product_number", "basis", "reference_product_number",
      "reference_name", "counted_from", "own_reference_product_number",
      "own_counted_from", "data_exclusivity_end",
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
  expect_identical(opzelura$market_protection_end_min, as.Date("2022-08-23"))
  expect_identical(opzelura$market_protection_end_max, as.Date("2034-04-19"))
  jakavi <- protection_row(protection, "EMEA/H/C/002464")
  expect_identical(jakavi$basis, "own")
  expect_identical(jakavi$status, "ended")
  expect_identical(jakavi$own_reference_product_number, NA_character_)
  expect_identical(jakavi$own_counted_from, as.Date(NA))
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
