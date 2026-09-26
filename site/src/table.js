import * as d3 from "d3";

const HEADERS = [
  "Medicine",
  "Active substance(s)",
  "Marketing authorisation holder",
  "Approval date",
  "Status",
  "Type",
  "Indication",
];

function hasIndication(medicine) {
  return medicine.therapeutic_indication !== null;
}

function indicationRowId(medicine) {
  return `indication-${medicine.ema_product_number}`;
}

function toggleIndication(event, medicine) {
  const expanded = this.getAttribute("aria-expanded") !== "true";
  d3.select(this).attr("aria-expanded", expanded).text(expanded ? "Hide" : "Show");
  d3.select(document.getElementById(indicationRowId(medicine))).attr("hidden", expanded ? null : "");
}

// All text goes through .text(): decoded indications contain literal "<" and ">".
export function renderTable(table, medicines, substanceIndex) {
  const root = d3.select(table);
  root.selectChildren().remove();

  const noun = medicines.length === 1 ? "medicine" : "medicines";
  root.append("caption").text(`${d3.format(",")(medicines.length)} ${noun}, newest approval first`);
  root.append("thead").append("tr")
    .selectAll("th")
    .data(HEADERS)
    .join("th")
    .attr("scope", "col")
    .text((header) => header);

  // One tbody per medicine keeps its full-width indication row directly beneath it.
  const groups = root.selectAll("tbody").data(medicines).join("tbody");
  const rows = groups.append("tr");

  rows.append("td").attr("class", "breakable").each(function renderName(medicine) {
    const cell = d3.select(this);
    // URLs come from third-party data; only link https so a javascript: URL can never become a link.
    if (!medicine.medicine_url?.startsWith("https://")) {
      cell.text(medicine.name_of_medicine);
      return;
    }
    cell.append("a")
      .attr("href", medicine.medicine_url)
      .attr("rel", "noopener noreferrer")
      .attr("target", "_blank")
      .text(medicine.name_of_medicine);
  });
  rows.append("td")
    .attr("class", "breakable")
    .text((medicine) => (substanceIndex.get(medicine.ema_product_number) ?? []).join("; "));
  rows.append("td").text((medicine) => medicine.marketing_authorisation_developer_applicant_holder);
  rows.append("td").attr("class", "date").text((medicine) => medicine.marketing_authorisation_date);
  rows.append("td").text((medicine) => medicine.medicine_status);
  rows.append("td").text((medicine) => medicine.medicine_type);
  rows.append("td")
    .filter(hasIndication)
    .append("button")
    .attr("type", "button")
    .attr("class", "toggle")
    .attr("aria-expanded", "false")
    .attr("aria-controls", indicationRowId)
    .text("Show")
    .on("click", toggleIndication);

  groups.filter(hasIndication)
    .append("tr")
    .attr("class", "indication")
    .attr("id", indicationRowId)
    .attr("hidden", "")
    .append("td")
    .attr("colspan", HEADERS.length)
    .text((medicine) => medicine.therapeutic_indication);
}
