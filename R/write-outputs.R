ema_attribution <- paste(
  "Source: European Medicines Agency (EMA),",
  "https://www.ema.europa.eu/en/medicines/download-medicine-data. © EMA.",
  "Filtered to human medicines and reshaped;",
  "not affiliated with or endorsed by EMA."
)

write_json_table <- function(data, path) {
  jsonlite::write_json(
    data,
    path,
    dataframe = "rows",
    na = "null",
    digits = NA
  )
}

data_licence <- paste(
  "Data files: compilation licensed CC BY-SA 4.0",
  "(https://creativecommons.org/licenses/by-sa/4.0/); ChEMBL-derived values",
  "adapted from ChEMBL (CC BY-SA 3.0) and modified (selected and mapped).",
  "Values from other sources keep their own terms: EMA content © European",
  "Medicines Agency (reuse with acknowledgement); MeSH® courtesy of the U.S.",
  "National Library of Medicine; ATC classification codes from ChEMBL and ATC",
  "level names © WHO Collaborating Centre for Drug Statistics Methodology,",
  "reproduced verbatim and excluded from this licence."
)

file_date <- function(path) {
  format(as.Date(file.mtime(path)))
}

ema_source_entry <- function(source_timestamp, cache_path) {
  list(
    name = "European Medicines Agency (EMA) medicines data",
    url = ema_medicines_url,
    version = source_timestamp,
    retrieved = file_date(cache_path),
    licence = "© European Medicines Agency; reuse with acknowledgement",
    attribution = ema_attribution
  )
}

mesh_source_entry <- function(mesh_source) {
  list(
    name = "Medical Subject Headings (MeSH)",
    url = mesh_source$url,
    version = paste("MeSH", mesh_source$year),
    retrieved = file_date(mesh_source$path),
    licence = "NLM Terms and Conditions (free use; acknowledgement required)",
    attribution = paste(
      "MeSH® Courtesy of the U.S. National Library of Medicine;",
      "not endorsed by NLM."
    ),
    last_modified = mesh_source$last_modified
  )
}

chembl_source_entry <- function(release, atc_class_path) {
  list(
    name = "ChEMBL",
    url = paste0(chembl_api_url, "atc_class.json"),
    version = release,
    retrieved = file_date(atc_class_path),
    licence = "CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/)",
    attribution = paste0(
      "ChEMBL data is from https://www.ebi.ac.uk/chembl (", release, "); ",
      "used for ATC classification names. ATC level names © WHO ",
      "Collaborating Centre for Drug Statistics Methodology, reproduced ",
      "verbatim."
    )
  )
}

build_meta <- function(source_url,
                       source_timestamp,
                       tables,
                       snapshot_date,
                       sources) {
  list(
    source_url = source_url,
    source_timestamp = source_timestamp,
    row_counts = lapply(tables, nrow),
    attribution = ema_attribution,
    snapshot_date = format(snapshot_date),
    sources = sources,
    licence = data_licence
  )
}

write_meta_json <- function(meta, path) {
  jsonlite::write_json(
    meta,
    path,
    auto_unbox = TRUE,
    pretty = TRUE,
    na = "null"
  )
}
