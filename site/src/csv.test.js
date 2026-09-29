import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { buildProducts, buildSubstanceIndex, newestFirst } from "./approvals.js";
import { csvCell, csvFileName, medicinesCsv } from "./csv.js";

// RFC 4180: records of fields, quoted fields with doubled quotes; the BOM stripped first.
function parseCsv(text) {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  for (let index = text.startsWith("﻿") ? 1 : 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\r" && text[index + 1] === "\n") {
      record.push(field);
      records.push(record);
      [record, field] = [[], ""];
      index += 1;
    } else field += char;
  }
  if (field || record.length) records.push([...record, field]);
  return records;
}

test("csvCell: plain text as is, text with commas, quotes or line breaks quoted, none empty", () => {
  assert.equal(csvCell("Wegovy"), "Wegovy");
  assert.equal(csvCell("Neoplasms; Psoriasis"), "Neoplasms; Psoriasis");
  assert.equal(csvCell("Arthritis, Psoriatic"), '"Arthritis, Psoriatic"');
  assert.equal(csvCell('the "A" form'), '"the ""A"" form"');
  assert.equal(csvCell("line one\nline two"), '"line one\nline two"');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

// CSV injection (OWASP): a spreadsheet runs a cell starting with = + - @ (or a tab or carriage
// return) as a formula; an apostrophe in front makes it text.
test("csvCell: a cell a spreadsheet would read as a formula starts with an apostrophe", () => {
  assert.equal(csvCell("=HYPERLINK(\"https://x\")"), "\"'=HYPERLINK(\"\"https://x\"\")\"");
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell("-2"), "'-2");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("\tcmd"), "'\tcmd");
  assert.equal(csvCell("=1,2"), "\"'=1,2\"");
  assert.equal(csvCell("a=b"), "a=b");
  assert.equal(csvCell("(+)-tramadol"), "(+)-tramadol");
});

const product = (fields) => ({
  ema_product_number: "EMEA/H/C/000001",
  name_of_medicine: "Example",
  medicine_status: "Authorised",
  opinion_status: null,
  marketing_authorisation_date: "2018-02-08",
  medicine_type: "Other",
  orphan_medicine: false,
  holder_ema: "Example Pharma GmbH",
  group_key: null,
  atc: [],
  areas: [],
  ...fields,
});

const options = {
  substancesOf: (row) => ({ "EMEA/H/C/004174": ["semaglutide"], "EMEA/H/C/000002": ["emtricitabine", "tenofovir disoproxil"] })[row.ema_product_number] ?? [],
  groupNameOf: (row) => ({ "g.novo-nordisk": "Novo Nordisk" })[row.group_key] ?? null,
  dataDate: "2026-09-28",
};

test("medicinesCsv: UTF-8 BOM, EMA acknowledged with the data's date, headers, one line per medicine", () => {
  const text = medicinesCsv([product({})], options);
  assert.ok(text.startsWith("﻿# Source: European Medicines Agency (EMA)"));
  assert.ok(text.endsWith("\r\n"));
  const lines = text.slice(1).split("\r\n");
  // One cell a tool can skip as a comment ("#"): never quoted, so no comma or quote in it. Review of
  // step 4: the ATC codes (WHO's current code for a retired one, curated and SmPC codes) credit the
  // WHOCC, as its terms require and the file travels without the site's footer.
  assert.match(
    lines[0],
    /^# Source: European Medicines Agency \(EMA\) medicines data as of 2026-09-28[^",]*ATC codes © WHO Collaborating Centre for Drug Statistics Methodology \(https:\/\/atcddd\.fhi\.no\); not for commercial distribution\.[^",]*Not affiliated with or endorsed by EMA\.$/,
  );
  assert.deepEqual(parseCsv(text)[1], [
    "EMA product number", "Medicine", "Active substances", "Status", "Approval date", "Medicine type", "Orphan",
    "Company group", "Holder (EMA)", "ATC codes", "Therapeutic areas",
  ]);
  assert.equal(lines.length, 4); // source, headers, one medicine, the empty end
});

test("medicinesCsv: a medicine's values; ATC codes (the codes the site uses, never WHO's names) and areas joined", () => {
  const rows = parseCsv(medicinesCsv([
    product({
      ema_product_number: "EMEA/H/C/004174",
      name_of_medicine: "Wegovy",
      marketing_authorisation_date: "2022-01-06",
      holder_ema: "Novo Nordisk A/S",
      group_key: "g.novo-nordisk",
      atc: [{ atc_code_human: "A10BJ06", atc_code: "A10BJ06", current_atc_code: null }],
      areas: ["Obesity", "Overweight"],
    }),
    product({
      ema_product_number: "EMEA/H/C/000002",
      name_of_medicine: "Combo",
      medicine_status: "Withdrawn",
      medicine_type: "Generic",
      orphan_medicine: true,
      holder_ema: "Firm, Ltd",
      atc: [
        { atc_code_human: "L01XC02", atc_code: "L01XC02", current_atc_code: "L01FA01" },
        { atc_code_human: "L01XC", atc_code: "L01FA01", current_atc_code: null },
      ],
      areas: ["Arthritis, Psoriatic", "Psoriasis"],
    }),
    product({ medicine_status: "Opinion", opinion_status: "Negative", marketing_authorisation_date: null, holder_ema: null }),
    // EMA's active substance field empty (71 medicines on 2026-09-28, Avonex among them): its INN field.
    product({ ema_product_number: "EMEA/H/C/000102", international_non_proprietary_name_common_name: "interferon beta-1a" }),
  ], options));
  assert.deepEqual(rows[2], ["EMEA/H/C/004174", "Wegovy", "semaglutide", "Authorized", "2022-01-06", "Other", "No", "Novo Nordisk", "Novo Nordisk A/S", "A10BJ06", "Obesity; Overweight"]);
  assert.deepEqual(rows[3], ["EMEA/H/C/000002", "Combo", "emtricitabine; tenofovir disoproxil", "Withdrawn", "2018-02-08", "Generic", "Yes", "", "Firm, Ltd", "L01FA01", "Arthritis, Psoriatic; Psoriasis"]);
  assert.deepEqual(rows[4], ["EMEA/H/C/000001", "Example", "", "Opinion (negative)", "", "Other", "No", "", "", "", ""]);
  assert.equal(rows[5][2], "interferon beta-1a");
});

test("csvFileName: named by the data's date", () => {
  assert.equal(csvFileName("2026-09-28"), "approval-atlas-2026-09-28.csv");
});

const dataDir = new URL("../public/data/", import.meta.url);
const read = (file) => JSON.parse(readFileSync(new URL(file, dataDir), "utf8"));

test(
  "medicinesCsv on the real data: every medicine one record of 11 fields, none a formula",
  { skip: existsSync(new URL("ema_medicines.json", dataDir)) ? false : "site/public/data not found: run the pipeline first" },
  () => {
    const medicines = read("ema_medicines.json");
    const products = buildProducts(medicines, {
      areaRows: read("ema_medicine_therapeutic_areas.json"),
      branchRows: read("ema_therapeutic_area_branches.json"),
      subtreeRows: read("ema_therapeutic_area_subtree.json"),
      atcRows: read("ema_medicine_atc_codes.json"),
    });
    const substances = buildSubstanceIndex(read("ema_medicine_active_substances.json"));
    const records = parseCsv(medicinesCsv(newestFirst(products), {
      substancesOf: (row) => substances.get(row.ema_product_number) ?? [],
      groupNameOf: () => null,
      dataDate: read("meta.json").snapshot_date,
    }));
    assert.equal(records.length, medicines.length + 2);
    assert.deepEqual(records.slice(1).filter((record) => record.length !== 11), []);
    assert.deepEqual(records.flat().filter((cell) => /^[=+\-@\t\r]/.test(cell)), []);
    assert.equal(new Set(records.slice(2).map((record) => record[0])).size, medicines.length);
  },
);
