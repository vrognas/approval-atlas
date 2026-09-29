// "Download CSV" (#18): the medicines table's rows as a spreadsheet file. Pure: no DOM (main.js
// saves the text through a Blob link).
import { atcCode } from "./atc.js";
import { UI, statusOpinionLabel } from "./labels.js";

// CSV injection (OWASP): a spreadsheet runs a cell starting with = + - @, a tab or a carriage
// return as a formula; an apostrophe in front keeps it text.
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

// One field (RFC 4180): quoted, with doubled quotes, when it holds a comma, quote or line break;
// null and undefined empty.
export function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = FORMULA_START.test(String(value)) ? `'${value}` : String(value);
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const csvLine = (cells) => cells.map(csvCell).join(",");
const joined = (values) => [...new Set(values)].join("; ");

// EMA's active substances, else (that field empty: 71 medicines on 2026-09-28, Avonex among them)
// EMA's INN / common name field.
function substances(product, substancesOf) {
  const active = substancesOf(product);
  return active.length ? active : [product.international_non_proprietary_name_common_name].filter(Boolean);
}

// products: buildProducts() rows, in the table's order. substancesOf(product): EMA's active
// substances; groupNameOf(product): its company group's name, or null; dataDate: the data's date
// (meta.json). A UTF-8 byte order mark first, so Excel reads the text as UTF-8; CRLF line ends.
// Status as the site says it (U.S. spelling, a negative opinion named); dates ISO; the ATC codes
// the site uses (atcCode(): WHO's current code for a retired one).
export function medicinesCsv(products, { substancesOf, groupNameOf, dataDate }) {
  const rows = products.map((product) => [
    product.ema_product_number,
    product.name_of_medicine,
    joined(substances(product, substancesOf)),
    statusOpinionLabel(product.medicine_status, product.opinion_status),
    product.marketing_authorisation_date,
    product.medicine_type,
    product.orphan_medicine ? UI.csv.yes : UI.csv.no,
    groupNameOf(product),
    product.holder_ema,
    joined(product.atc.map(atcCode).filter((code) => code !== null)),
    joined(product.areas),
  ]);
  return `﻿${[[UI.csv.source(dataDate)], UI.csv.headers, ...rows].map(csvLine).join("\r\n")}\r\n`;
}

export const csvFileName = (date) => `approval-atlas-${date}.csv`;
