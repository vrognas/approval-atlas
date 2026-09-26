import * as d3 from "d3";
import {
  MEDICINE_TYPES,
  areaTermsFor,
  buildAreaIndex,
  buildSubstanceIndex,
  countApprovalsByYear,
  distinctSorted,
  filterMedicines,
  newestFirst,
} from "./approvals.js";
import { renderChart, renderLegend } from "./chart.js";
import { renderTable } from "./table.js";

const DATA_FILES = [
  "meta.json",
  "ema_medicines.json",
  "ema_medicine_therapeutic_areas.json",
  "ema_medicine_active_substances.json",
];

function isDated(medicine) {
  return medicine.marketing_authorisation_date !== null;
}

function showMissingData() {
  d3.select("#message")
    .attr("hidden", null)
    .call((message) => message.append("span").text("No data found. Run "))
    .call((message) => message.append("code").text("Rscript scripts/run-pipeline.R"))
    .call((message) => message.append("span").text(" first."));
}

function renderStatusFilter(statuses) {
  const labels = d3.select("#status-filter").selectAll("label").data(statuses).join("label");
  labels.append("input").attr("type", "checkbox").attr("value", (status) => status).property("checked", true);
  labels.append("span").text((status) => ` ${status}`);
}

function start([meta, medicines, areaRows, substanceRows]) {
  const areaIndex = buildAreaIndex(areaRows);
  const substanceIndex = buildSubstanceIndex(substanceRows);
  const datedMedicines = medicines.filter(isDated);
  const checkboxStatuses = distinctSorted(datedMedicines.map((medicine) => medicine.medicine_status));
  // Statuses with no dated medicine get no checkbox, so no filter can exclude them;
  // they still count towards the "without an approval date" note.
  const alwaysIncludedStatuses = distinctSorted(medicines.map((medicine) => medicine.medicine_status))
    .filter((status) => !checkboxStatuses.includes(status));

  d3.select("#data-date").text(`EMA data as of ${meta.source_timestamp.slice(0, 10)}`);
  d3.select("#attribution").text(meta.attribution);
  renderStatusFilter(checkboxStatuses);
  d3.select("#area-options")
    .selectAll("option")
    .data(areaTermsFor(areaRows, datedMedicines))
    .join("option")
    .attr("value", (term) => term);
  renderLegend(document.querySelector("#legend"));
  d3.select("#app").attr("hidden", null);

  const chart = document.querySelector("#chart");
  let yearRows = [];

  function update() {
    const checked = d3.selectAll("#status-filter input:checked").nodes().map((input) => input.value);
    const filters = {
      statuses: new Set([...checked, ...alwaysIncludedStatuses]),
      therapeuticArea: document.querySelector("#area-input").value.trim(),
    };
    const matching = filterMedicines(medicines, filters, areaIndex);
    const dated = matching.filter(isDated);
    const undatedCount = matching.length - dated.length;

    yearRows = countApprovalsByYear(dated, MEDICINE_TYPES);
    renderChart(chart, yearRows);
    d3.select("#undated-note").text(
      `${d3.format(",")(undatedCount)} ${undatedCount === 1 ? "medicine" : "medicines"} without an approval date ${undatedCount === 1 ? "is" : "are"} not shown.`,
    );
    renderTable(document.querySelector("#medicines-table"), newestFirst(dated), substanceIndex);
  }

  d3.select("#status-filter").on("change", update);
  d3.select("#area-input").on("input", update);
  new ResizeObserver(() => renderChart(chart, yearRows)).observe(chart);
  update();
}

Promise.all(DATA_FILES.map((file) => d3.json(`/data/${file}`))).then(start, showMissingData);
