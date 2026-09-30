# For the owner, after an extractor run: every flagged row and a 10% sample of
# the auto_ok rows (taken in turns across products, seeded by the date so a
# rerun the same day gives the same sample), printed and written to
# .remember/efficacy/review-{date}.md (gitignored). Record each decision by
# setting `review` to reviewed_ok or reviewed_rejected in
# data-raw/efficacy-rows.json; the next extractor run keeps it while the row's
# numbers stay the same.
pkgload::load_all(quiet = TRUE)
today <- Sys.Date()
rows <- read_efficacy_rows()
set.seed(as.integer(format(today, "%Y%m%d")))
lines <- efficacy_review_markdown(
  dplyr::filter(rows, .data$review == "flagged"),
  sample_efficacy_review(rows),
  today
)
path <- file.path(".remember", "efficacy", paste0("review-", today, ".md"))
dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
writeLines(enc2utf8(lines), path, useBytes = TRUE)
cat(lines, sep = "\n")
cli::cli_inform("Written to {.path {path}}.")
