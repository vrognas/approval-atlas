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

build_meta <- function(source_url, source_timestamp, tables) {
  list(
    source_url = source_url,
    source_timestamp = source_timestamp,
    row_counts = lapply(tables, nrow),
    attribution = ema_attribution
  )
}

write_meta_json <- function(meta, path) {
  jsonlite::write_json(meta, path, auto_unbox = TRUE, pretty = TRUE)
}
