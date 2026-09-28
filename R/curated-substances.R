# Substance keys that name the same active substance: EMA's INN field spells
# some with their salt, hydrate or ester and others without (Sprycel is
# "dasatinib (anhydrous)", its generic "dasatinib"). Checked by hand
# (2026-09-28) against the EPAR page named, where EMA gives the product's
# active substance beside its INN, says a generic, hybrid or biosimilar
# contains the same active substance as its reference medicine, or that it is
# the same as another medicine (informed consent). Only pairs with such
# evidence, never a rule that strips salt words: different esters and
# prodrugs are different active substances (fluticasone furoate and
# propionate, tenofovir disoproxil and alafenamide). Left out for want of
# such evidence: sevelamer carbonate (Renvela) and sevelamer hydrochloride.
# One row per pair; the note says what the page shows.
curated_substance_equivalents <- function() {
  epar <- function(slug) {
    paste0("https://www.ema.europa.eu/en/medicines/human/EPAR/", slug)
  }
  dplyr::tribble(
    ~substance_key, ~equivalent_key, ~evidence_url, ~note,
    "abiraterone", "abiraterone acetate", epar("abiraterone-mylan"),
    "Abiraterone Mylan (abiraterone acetate): generic of Zytiga (abiraterone)",
    "aclidinium", "aclidinium bromide", epar("brimica-genuair"),
    "Brimica Genuair: INN aclidinium, active substance aclidinium bromide",
    "aliskiren", "aliskiren hemifumarate", epar("rasilamlo"),
    "Rasilamlo: INN aliskiren hemifumarate, active substance aliskiren",
    "alogliptin", "alogliptin benzoate", epar("vipidia"),
    "Vipidia: INN alogliptin benzoate, active substance alogliptin",
    "amlodipine", "amlodipine besilate", epar("exforge"),
    "Exforge: INN amlodipine, active substance amlodipine (as besilate)",
    "atazanavir", "atazanavir sulfate", epar("atazanavir-viatris"),
    "Atazanavir Viatris (atazanavir, as sulfate): generic of Reyataz",
    "atropine", "atropine sulfate", epar("atropine-sulfate-fgk"),
    "Atropine sulfate FGK: INN atropine, active substance atropine sulfate",
    "bosentan", "bosentan monohydrate", epar("stayveer"),
    "Stayveer (bosentan monohydrate) is the same as Tracleer (bosentan)",
    "brimonidine", "brimonidine tartrate", epar("mirvaso"),
    "Mirvaso: INN brimonidine, active substance brimonidine tartrate",
    "caffeine", "caffeine citrate", epar("peyona"),
    "Peyona: INN caffeine, active substance caffeine citrate",
    "dasatinib", "dasatinib (anhydrous)", epar("dasatinib-accord-healthcare"),
    "Dasatinib Accord Healthcare (dasatinib): generic of Sprycel",
    "doxorubicin", "doxorubicin hydrochloride",
    epar("caelyx-pegylated-liposomal"),
    "Caelyx: INN doxorubicin, active substance doxorubicin hydrochloride",
    "formoterol", "formoterol fumarate dihydrate", epar("duoresp-spiromax"),
    "DuoResp Spiromax: INN formoterol, active substance its fumarate dihydrate",
    "glycopyrronium", "glycopyrronium bromide", epar("zimbus-breezhaler"),
    "Zimbus Breezhaler: INN glycopyrronium, active substance its bromide",
    "human insulin (rdna)", "insulin human", epar("actrapid"),
    "Actrapid: INN human insulin (rDNA), active substance insulin human",
    "human insulin (rdna)", "insulin human (rdna)", epar("inpremzia"),
    "Inpremzia (insulin human (rDNA)): biosimilar of Actrapid (human insulin)",
    "insulin human", "insulin human (rdna)", epar("actraphane"),
    "Actraphane: INN insulin human (rDNA), active substance insulin human",
    "ioflupane (123i)", "ioflupane (123l)", epar("celsunax"),
    "Celsunax (ioflupane (123I)): generic of DaTSCAN, spelt ioflupane (123l)",
    "maralixibat", "maralixibat chloride", epar("livmarli-0"),
    "Livmarli (withdrawn application, INN maralixibat): maralixibat chloride",
    "memantine", "memantine hydrochloride", epar("memantine-merz"),
    "Memantine Merz (memantine hydrochloride) is the same as Axura (memantine)",
    "mercaptamine", "mercaptamine bitartrate", epar("procysbi"),
    "Procysbi: INN mercaptamine, active substance mercaptamine bitartrate",
    "metformin", "metformin hydrochloride",
    epar("vildagliptin-metformin-hydrochloride-accord"),
    "Vildagliptin / Metformin hydrochloride Accord: generic of Eucreas",
    "mometasone", "mometasone furoate", epar("atectura-breezhaler"),
    "Atectura Breezhaler: INN mometasone, active substance mometasone furoate",
    "nomegestrol", "nomegestrol acetate", epar("zoely"),
    "Zoely: INN nomegestrol, active substance nomegestrol acetate",
    "raltegravir", "raltegravir potassium", epar("raltegravir-viatris"),
    "Raltegravir Viatris (raltegravir potassium): a generic of Isentress",
    "ruxolitinib", "ruxolitinib hemifumarate", epar("ruxolitinib-viatris"),
    "Ruxolitinib Viatris (ruxolitinib hemifumarate): generic of Jakavi",
    "salmeterol", "salmeterol xinafoate", epar("seffalair-spiromax"),
    "Seffalair Spiromax: INN salmeterol, active substance its xinafoate",
    "sevelamer", "sevelamer hydrochloride", epar("renagel"),
    "Renagel: INN sevelamer, active substance sevelamer hydrochloride",
    "sitagliptin", "sitagliptin fumarate", epar("sitagliptin-sun"),
    "Sitagliptin SUN (sitagliptin fumarate): generic of Januvia (sitagliptin)",
    "sitagliptin", "sitagliptin hydrochloride monohydrate",
    epar("sitagliptin-metformin-hydrochloride-mylan"),
    "Sitagliptin / Metformin hydrochloride Mylan: generic of Janumet",
    "trientine", "trientine dihydrochloride", epar("cuprior"),
    "Cuprior (trientine): hybrid of Trientine Dihydrochloride 300 mg capsules",
    "ulipristal", "ulipristal acetate", epar("esmya"),
    "Esmya: INN ulipristal, active substance ulipristal acetate",
    "umeclidinium", "umeclidinium bromide", epar("rolufta-ellipta"),
    "Rolufta Ellipta: INN umeclidinium, active substance umeclidinium bromide"
  ) |>
    dplyr::mutate(checked_date = as.Date("2026-09-28"), .before = "note")
}
