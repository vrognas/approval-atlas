ema_orphan_designations_url <- paste0(
  "https://www.ema.europa.eu/en/documents/report/",
  "medicines-output-orphan_designations-json-report_en.json"
)

union_register_url <- paste0(
  "https://ec.europa.eu/health/documents/community-register/ods/",
  "ods_products.json"
)

ema_orphan_designation_fields <- c(
  "related_ema_product_number",
  "eu_designation_number",
  "intended_use",
  "status"
)

# The Union Register JSON is labelled BETA: pin every field in use and stop
# when one changes.
union_register_fields <- c(
  "URI",
  "Type",
  "Category",
  "Name",
  "EUNumber",
  "Status",
  "Indication",
  "EMALink",
  "AuthorisationDate",
  "LastDecisionDate",
  "AssociatedOrphanDesignations",
  "MAH"
)

union_register_link_fields <- c("URI", "LinkDate", "ExtensionLength", "EndDate")

# The holder of a Human product; its address is read only for the country.
union_register_holder_fields <- c("Name", "Address")

orphan_exclusivity_months <- 120L

ec_request <- function(url) {
  throttled_request(url, spacing_seconds = 1, realm = "ec.europa.eu")
}

download_orphan_designations <- function(cache_directory =
                                           ".cache/downloads/ema-orphans",
                                         max_age_hours =
                                           daily_source_max_age_hours) {
  download_cached_source(
    ema_orphan_designations_url,
    file.path(cache_directory, "orphan_designations.json"),
    request = ema_request(ema_orphan_designations_url),
    label = "EMA orphan designations",
    max_age_hours = max_age_hours
  )
}

download_union_register <- function(cache_directory =
                                      ".cache/downloads/union-register",
                                    max_age_hours =
                                      daily_source_max_age_hours) {
  download_cached_source(
    union_register_url,
    file.path(cache_directory, "ods_products.json"),
    request = ec_request(union_register_url),
    label = "Union Register products",
    max_age_hours = max_age_hours
  )
}

read_ema_orphan_designations <- function(path) {
  designations <- jsonlite::fromJSON(path)
  designations$data |>
    check_source_fields(
      ema_orphan_designation_fields,
      "The EMA orphan designations file"
    ) |>
    check_record_count(designations$meta)
  list(
    meta = designations$meta,
    data = dplyr::as_tibble(designations$data[ema_orphan_designation_fields])
  )
}

abort_register_format <- function(problem, offenders) {
  cli::cli_abort(c(
    "The Union Register (BETA) format has changed: {problem}.",
    x = "{.val {offender_values(offenders)}}"
  ))
}

check_union_register_fields <- function(rows) {
  if (length(rows) == 0) {
    cli::cli_abort("The Union Register file has no data rows.")
  }
  missing_fields <- unique(unlist(purrr::map(rows, function(row) {
    setdiff(union_register_fields, names(row))
  })))
  links <- unlist(
    purrr::map(rows, "AssociatedOrphanDesignations"),
    recursive = FALSE
  )
  missing_link_fields <- unique(unlist(purrr::map(links, function(link) {
    setdiff(union_register_link_fields, names(link))
  })))
  holders <- purrr::compact(purrr::map(rows, function(row) {
    if (identical(row$Type, "Human")) row$MAH
  }))
  missing_holder_fields <- unique(unlist(purrr::map(holders, function(holder) {
    setdiff(union_register_holder_fields, names(holder))
  })))
  missing <- c(missing_fields, missing_link_fields, missing_holder_fields)
  if (length(missing) > 0) {
    abort_register_format("missing fields", missing)
  }
  invisible(rows)
}

is_text_or_null <- function(value) {
  is.null(value) || (is.character(value) && length(value) == 1)
}

register_text <- function(values, field) {
  is_text <- vapply(values, is_text_or_null, logical(1))
  if (!all(is_text)) {
    abort_register_format("a field is no longer text", field)
  }
  vapply(
    values,
    function(value) if (is.null(value)) NA_character_ else value,
    character(1)
  )
}

register_english_text <- function(values, field) {
  english <- purrr::map(values, function(translations) {
    is_translation_list <- is.list(translations) && all(vapply(
      translations,
      function(item) is.list(item) && !is.null(item$LanguageCode),
      logical(1)
    ))
    if (!is_translation_list) {
      abort_register_format("a field is no longer a translation list", field)
    }
    texts <- purrr::keep(translations, function(item) {
      identical(item$LanguageCode, "EN")
    })
    if (length(texts) == 0) NULL else texts[[1]]$Text
  })
  register_text(english, field)
}

register_date <- function(x) {
  dates <- as.Date(x, format = "%Y-%m-%d")
  is_invalid <- !is.na(x) & (is.na(dates) | !grepl("^\\d{4}-\\d{2}-\\d{2}$", x))
  if (any(is_invalid)) {
    abort_register_format("dates are not YYYY-MM-DD", x[is_invalid])
  }
  dates
}

register_months <- function(x) {
  is_invalid <- !is.na(x) & !grepl("^[0-9]+$", x)
  if (any(is_invalid)) {
    abort_register_format(
      "extension lengths are not whole months",
      x[is_invalid]
    )
  }
  as.integer(x)
}

# Country names as the register's holder addresses end (local language,
# English, and the spellings seen), lower case.
register_country_codes <- c(
  "österreich" = "AT", "austria" = "AT",
  "belgië" = "BE", "belgie" = "BE", "belgique" = "BE",
  "belgique/belgië" = "BE", "belgium" = "BE",
  "българия" = "BG", "bulgaria" = "BG",
  "schweiz" = "CH", "suisse" = "CH", "switzerland" = "CH",
  "κύπρος" = "CY", "cyprus" = "CY",
  "česká republika" = "CZ", "czech republic" = "CZ", "czechia" = "CZ",
  "deutschland" = "DE", "germany" = "DE",
  "danmark" = "DK", "denmark" = "DK",
  "eesti" = "EE", "estonia" = "EE",
  "españa" = "ES", "espaňa" = "ES", "spain" = "ES",
  "suomi" = "FI", "finland" = "FI",
  "france" = "FR",
  "united kingdom" = "GB", "united kindom" = "GB",
  "ελλάδα" = "GR", "greece" = "GR",
  "hrvatska" = "HR", "croatia" = "HR",
  "magyarország" = "HU", "hungary" = "HU",
  "ireland" = "IE",
  "ísland" = "IS", "íceland" = "IS", "iceland" = "IS",
  "italia" = "IT", "italy" = "IT",
  "liechtenstein" = "LI",
  "lietuva" = "LT", "lithuania" = "LT",
  "luxembourg" = "LU",
  "latvija" = "LV", "latvia" = "LV",
  "malta" = "MT",
  "nederland" = "NL", "netherlands" = "NL",
  "norge" = "NO", "norway" = "NO",
  "polska" = "PL", "poland" = "PL",
  "portugal" = "PT",
  "românia" = "RO", "romania" = "RO",
  "sverige" = "SE", "sweden" = "SE",
  "slovenija" = "SI", "slovenia" = "SI",
  "slovensko" = "SK", "slovakia" = "SK"
)

# The ISO code of the country an address ends with ("..., Nederland",
# "... Cambridge CB21 6GT United Kingdom"); NA when the last part names no
# known country.
register_country <- function(address) {
  last_part <- address |>
    stringr::str_extract("[^,]*$") |>
    stringr::str_remove("\\.$") |>
    stringr::str_squish() |>
    stringr::str_to_lower()
  names_longest_first <- names(register_country_codes)[
    order(-nchar(names(register_country_codes)))
  ]
  purrr::map_chr(last_part, function(part) {
    if (is.na(part)) {
      return(NA_character_)
    }
    ends_with_name <- part == names_longest_first |
      endsWith(part, paste0(" ", names_longest_first))
    if (!any(ends_with_name)) {
      return(NA_character_)
    }
    unname(register_country_codes[names_longest_first[ends_with_name][1]])
  })
}

rows_field <- function(rows, field) {
  purrr::map(rows, function(row) row[[field]])
}

read_union_register_links <- function(products) {
  purrr::map(products, function(product) {
    links <- product$AssociatedOrphanDesignations
    dplyr::tibble(
      product_uri = rep(product$URI, length(links)),
      designation_uri = register_text(rows_field(links, "URI"), "URI"),
      link_date = register_date(
        register_text(rows_field(links, "LinkDate"), "LinkDate")
      ),
      extension_months = register_months(
        register_text(rows_field(links, "ExtensionLength"), "ExtensionLength")
      ),
      end_date = register_date(
        register_text(rows_field(links, "EndDate"), "EndDate")
      )
    )
  }) |>
    purrr::list_rbind()
}

read_union_register <- function(path) {
  rows <- jsonlite::fromJSON(path, simplifyVector = FALSE)$data
  check_union_register_fields(rows)
  types <- register_text(rows_field(rows, "Type"), "Type")
  products <- rows[types %in% "Human"]
  designations <- rows[types %in% "Orphan designation"]
  if (length(products) == 0 || length(designations) == 0) {
    abort_register_format(
      "no Human or no Orphan designation rows",
      unique(types)
    )
  }
  list(
    products = dplyr::tibble(
      uri = register_text(rows_field(products, "URI"), "URI"),
      ema_link = register_text(rows_field(products, "EMALink"), "EMALink"),
      authorisation_date = register_date(register_text(
        rows_field(products, "AuthorisationDate"),
        "AuthorisationDate"
      )),
      name = register_english_text(rows_field(products, "Name"), "Name"),
      eu_number = register_text(rows_field(products, "EUNumber"), "EUNumber"),
      status = register_text(rows_field(products, "Status"), "Status"),
      category = register_text(rows_field(products, "Category"), "Category"),
      last_decision_date = register_date(register_text(
        rows_field(products, "LastDecisionDate"),
        "LastDecisionDate"
      )),
      holder_name = stringr::str_squish(register_text(
        purrr::map(products, function(product) product$MAH$Name),
        "MAH Name"
      )),
      holder_country = register_country(register_text(
        purrr::map(products, function(product) product$MAH$Address),
        "MAH Address"
      ))
    ),
    designations = dplyr::tibble(
      uri = register_text(rows_field(designations, "URI"), "URI"),
      eu_designation_number = register_text(
        rows_field(designations, "EUNumber"),
        "EUNumber"
      ),
      designation_status = register_text(
        rows_field(designations, "Status"),
        "Status"
      ),
      condition = stringr::str_squish(register_english_text(
        rows_field(designations, "Indication"),
        "Indication"
      ))
    ),
    links = read_union_register_links(products)
  )
}

# The register records the same decision as EMA up to a day apart (older
# EMA dates look shifted by a time zone).
is_same_authorisation_date <- function(register_date, ema_date) {
  (abs(as.numeric(register_date - ema_date)) <= 1) %in% TRUE
}

normalise_ema_link <- function(url) {
  url |>
    stringr::str_squish() |>
    stringr::str_to_lower() |>
    stringr::str_replace("^http:", "https:") |>
    stringr::str_remove("/+$")
}

ema_designation_links <- function(orphan_designations) {
  orphan_designations |>
    dplyr::select("related_ema_product_number", "eu_designation_number") |>
    tidyr::separate_longer_delim("related_ema_product_number", delim = ";") |>
    dplyr::transmute(
      ema_product_number = stringr::str_squish(
        .data$related_ema_product_number
      ),
      # Drops stray characters ("EU/3/11/878)") and IRIS-era ids the
      # register does not use.
      eu_designation_number = stringr::str_extract(
        .data$eu_designation_number,
        "EU/3/[0-9]{2}/[0-9]+"
      )
    ) |>
    dplyr::filter(
      !is.na(.data$ema_product_number),
      .data$ema_product_number != "",
      !is.na(.data$eu_designation_number)
    ) |>
    dplyr::distinct()
}

build_orphan_exclusivity_table <- function(medicines,
                                           orphan_designations,
                                           register) {
  register_links <- register$links |>
    dplyr::inner_join(
      register$designations,
      by = c(designation_uri = "uri"),
      relationship = "many-to-one"
    ) |>
    dplyr::inner_join(
      register$products,
      by = c(product_uri = "uri"),
      relationship = "many-to-one"
    ) |>
    dplyr::mutate(register_link = normalise_ema_link(.data$ema_link))
  medicine_keys <- medicines |>
    dplyr::transmute(
      .data$ema_product_number,
      .data$marketing_authorisation_date,
      .data$medicine_status,
      medicine_link = normalise_ema_link(.data$medicine_url)
    )

  # EMA may relate a designation to earlier failed applications too; keep a
  # link only when the register product is this medicine.
  by_designation <- ema_designation_links(orphan_designations) |>
    dplyr::inner_join(
      medicine_keys,
      by = "ema_product_number",
      relationship = "many-to-one"
    ) |>
    dplyr::inner_join(
      register_links,
      by = "eu_designation_number",
      relationship = "many-to-many"
    ) |>
    dplyr::filter(
      is_same_authorisation_date(
        .data$authorisation_date,
        .data$marketing_authorisation_date
      ) |
        (.data$medicine_status == "Authorised" &
           .data$medicine_link == .data$register_link) %in% TRUE
    )
  # Fallback for links EMA does not relate: the register product whose EMA
  # page is this medicine's page.
  by_register_link <- medicine_keys |>
    dplyr::filter(!is.na(.data$medicine_link)) |>
    dplyr::inner_join(
      register_links,
      by = c(medicine_link = "register_link"),
      relationship = "many-to-many"
    )

  dplyr::bind_rows(by_designation, by_register_link) |>
    dplyr::distinct(
      .data$ema_product_number,
      .data$eu_designation_number,
      .keep_all = TRUE
    ) |>
    dplyr::mutate(
      # The register fills EndDate only once exclusivity has ended, so an
      # active designation's end is estimated. An inactive one without an
      # EndDate ended on an unknown date: the 10-year estimate would be wrong.
      computable = .data$designation_status == "Active" &
        !is.na(.data$link_date),
      exclusivity_end = dplyr::case_when(
        !is.na(.data$end_date) ~ .data$end_date,
        .data$computable ~ add_months(
          .data$link_date,
          orphan_exclusivity_months +
            dplyr::coalesce(.data$extension_months, 0L)
        ),
        .default = as.Date(NA)
      ),
      end_source = dplyr::case_when(
        !is.na(.data$end_date) ~ "register",
        .data$computable ~ "computed",
        .default = NA_character_
      ),
      source = "union_register"
    ) |>
    dplyr::select(
      "ema_product_number",
      "eu_designation_number",
      "condition",
      "link_date",
      "extension_months",
      "exclusivity_end",
      "end_source",
      "designation_status",
      "source"
    ) |>
    dplyr::arrange(.data$ema_product_number, .data$eu_designation_number)
}

report_orphan_coverage <- function(orphan_exclusivity,
                                   medicines,
                                   snapshot_date) {
  orphans <- medicines[
    medicines$medicine_status == "Authorised" & medicines$orphan_medicine,
  ]
  is_linked <- orphans$ema_product_number %in%
    orphan_exclusivity$ema_product_number
  running <- orphan_exclusivity$ema_product_number[
    (orphan_exclusivity$exclusivity_end > snapshot_date) %in% TRUE
  ]
  cli::cli_alert_info(sprintf(
    paste(
      "Orphan exclusivity: %d of %d Authorised orphan medicines linked to the",
      "Union Register; %d with an exclusivity end after %s."
    ),
    sum(is_linked),
    nrow(orphans),
    sum(orphans$ema_product_number %in% running),
    format(snapshot_date)
  ))
  unlinked <- orphans$name_of_medicine[!is_linked]
  if (length(unlinked) > 0) {
    cli::cli_alert_warning(
      "{length(unlinked)} Authorised orphan medicine{?s} not linked:
      {.val {offender_values(unlinked)}}"
    )
  }
  invisible(orphan_exclusivity)
}

ema_orphan_source_entry <- function(source, source_timestamp) {
  list(
    name = "European Medicines Agency (EMA) orphan designations",
    url = source$url,
    version = source_timestamp,
    retrieved = substr(source$retrieved, 1, 10),
    licence = "© European Medicines Agency; reuse with acknowledgement",
    attribution = ema_attribution,
    last_modified = source$last_modified
  )
}

union_register_source_entry <- function(source) {
  list(
    name = "Union Register of medicinal products (European Commission)",
    url = source$url,
    version = source$last_modified,
    retrieved = substr(source$retrieved, 1, 10),
    licence = "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)",
    attribution = paste(
      "© European Union, Union Register of medicinal products, CC BY 4.0;",
      "changes made"
    ),
    last_modified = source$last_modified
  )
}
