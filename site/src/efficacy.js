// Pivotal results on the medicine card (pure): rows of ema_medicine_efficacy.json, grouped and
// formatted. Values are printed as the product information gives them; nothing here says
// whether a result is significant. All copy is in labels.js.
import { UI } from "./labels.js";

const present = (value) => value !== null && value !== undefined && value !== "";
const SINGLE_ARM = new Set(["single_arm_rate", "single_arm_median"]);

function interval(row) {
  if (!present(row.ci_low) || !present(row.ci_high)) return null;
  const bounds = `${row.ci_low}–${row.ci_high}`;
  return row.ci_is_range ? `${UI.efficacy.range} ${bounds}` : `${UI.efficacy.ci(row.ci_level ?? null)} ${bounds}`;
}

export function formatEffect(row) {
  const { efficacy } = UI;
  const lead = {
    hr: `${efficacy.effectHr} ${row.value}`,
    hr_noninferiority: `${efficacy.effectHr} ${row.value}`,
    rate_difference: `${efficacy.effectDifference} ${row.value}${/(%|pp)$/i.test(String(row.value).trim()) ? "" : ` ${efficacy.percentagePoints}`}`,
    single_arm_rate: `${efficacy.effectResponseRate} ${row.value}`,
    single_arm_median: `${efficacy.effectMedian} ${row.value}`,
  }[row.effect_type] ?? String(row.value ?? "");
  const range = interval(row);
  const text = range ? `${lead} (${range})` : lead;
  return row.effect_type === "hr_noninferiority" ? `${text}, ${efficacy.effectNonInferiority}` : text;
}

export function formatArms(row) {
  if (!present(row.arm_treatment) || !present(row.arm_control)) return null;
  const measure = present(row.arm_measure) ? String(row.arm_measure) : "";
  if (/^median/i.test(measure)) {
    const unit = measure.replace(/^median[\s,:;-]*/i, "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
    return `${UI.efficacy.effectMedian} ${row.arm_treatment} ${UI.efficacy.vs} ${row.arm_control}${unit ? ` ${unit}` : ""}`;
  }
  const pair = `${row.arm_treatment} ${UI.efficacy.vs} ${row.arm_control}`;
  return measure ? `${pair} (${measure})` : pair;
}

// The More details section's lines (lookup.js efficacySection()); null where the row states nothing.
const POPULATION_NOTES = { subgroup_matches: "subgroup", whole_trial_broader: "broader", other: "otherPopulation" };
export function populationNote(row) {
  const key = POPULATION_NOTES[row.population_match];
  return key ? UI.efficacy[key] : null;
}

// "{regimen} (n = 279) vs {comparator} (n = 277)"; a single-arm trial (no comparator) says so.
export function regimenLine(row) {
  const { efficacy } = UI;
  const regimen = present(row.regimen) ? efficacy.armSize(row.regimen, row.n_treatment ?? null) : null;
  const comparator = present(row.comparator) ? efficacy.armSize(row.comparator, row.n_control ?? null) : null;
  if (!regimen && !comparator) return null;
  return efficacy.regimen(regimen, comparator);
}

// The endpoint's name (a known abbreviation spelled out, the abbreviation after it), who assessed
// it, and "primary endpoint" only when the source names it one (is_primary true).
export function endpointLine(row) {
  const { endpointNames } = UI.efficacy;
  const endpoint = present(row.endpoint) ? String(row.endpoint) : null;
  const name = endpoint && Object.hasOwn(endpointNames, endpoint) ? `${endpointNames[endpoint]} (${endpoint})` : endpoint;
  const assessment = present(row.assessment) ? String(row.assessment) : null;
  if (!name && !assessment && row.is_primary !== true) return null;
  return UI.efficacy.endpoint(name, assessment, row.is_primary === true);
}

export function analysisLine(row) {
  const role = UI.efficacy.roles[row.analysis_role] ?? null;
  return UI.efficacy.analysisLine(role, UI.efficacy.analysis(present(row.analysis) ? row.analysis : null));
}

// The product information at the result's page (#page= opens it there in browsers' PDF viewers).
export function efficacySourceUrl(row) {
  if (!String(row.source_url ?? "").startsWith("https://")) return null;
  return Number.isInteger(row.page) && row.page > 0 ? `${row.source_url}#page=${row.page}` : row.source_url;
}

// One group per distinct indication (null is one), ordered by the lowest row_order in it; in a
// group the lead row first, else the lowest row_order, then the rest by row_order.
export function groupEfficacy(rows) {
  const byIndication = new Map();
  for (const row of rows ?? []) {
    const key = row.indication ?? null;
    if (!byIndication.has(key)) byIndication.set(key, []);
    byIndication.get(key).push(row);
  }
  const order = (row) => row.row_order ?? Infinity;
  const earliest = (group) => Math.min(order(group.lead), ...group.more.map(order));
  const compare = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
  return [...byIndication.entries()]
    .map(([indication, members]) => {
      const sorted = [...members].sort((a, b) => order(a) - order(b));
      const lead = sorted.find((row) => row.lead === true) ?? sorted[0];
      return { indication, lead, more: sorted.filter((row) => row !== lead) };
    })
    .sort((a, b) => compare(earliest(a), earliest(b)));
}

export function teaserText(groups, contextIndication = null) {
  if (!groups?.length) return null;
  const context = present(contextIndication) ? String(contextIndication).toLowerCase() : null;
  const group = (context && groups.find((item) => item.indication?.toLowerCase().includes(context))) || groups[0];
  const { lead } = group;
  const { endpointNames } = UI.efficacy;
  const named = Object.hasOwn(endpointNames, lead.endpoint) ? endpointNames[lead.endpoint] : (lead.endpoint ?? "");
  const effect = formatEffect(lead);
  // "response rate 37.1 ..." already names the endpoint: do not say it twice.
  const endpoint = named && effect.toLowerCase().startsWith(String(named).toLowerCase()) ? "" : named;
  return SINGLE_ARM.has(lead.effect_type)
    ? UI.efficacy.teaserSingleArm(lead.trial, endpoint, effect)
    : UI.efficacy.teaser(lead.trial, endpoint, effect, lead.comparator);
}
