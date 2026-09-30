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
    rate_difference: `${efficacy.effectDifference} ${row.value} ${efficacy.percentagePoints}`,
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
    const unit = measure.replace(/^median/i, "").replace(/\(.*$/, "").trim();
    return `${UI.efficacy.effectMedian} ${row.arm_treatment} ${UI.efficacy.vs} ${row.arm_control}${unit ? ` ${unit}` : ""}`;
  }
  const pair = `${row.arm_treatment} ${UI.efficacy.vs} ${row.arm_control}`;
  return measure ? `${pair} (${measure})` : pair;
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
  return [...byIndication.entries()]
    .map(([indication, members]) => {
      const sorted = [...members].sort((a, b) => order(a) - order(b));
      const lead = sorted.find((row) => row.lead === true) ?? sorted[0];
      return { indication, lead, more: sorted.filter((row) => row !== lead) };
    })
    .sort((a, b) => Math.min(order(a.lead), ...a.more.map(order)) - Math.min(order(b.lead), ...b.more.map(order)));
}

export function teaserText(groups, contextIndication = null) {
  if (!groups?.length) return null;
  const context = present(contextIndication) ? String(contextIndication).toLowerCase() : null;
  const group = (context && groups.find((item) => item.indication?.toLowerCase().includes(context))) || groups[0];
  const { lead } = group;
  const endpoint = UI.efficacy.endpointNames[lead.endpoint] ?? lead.endpoint ?? "";
  const effect = formatEffect(lead);
  return SINGLE_ARM.has(lead.effect_type)
    ? UI.efficacy.teaserSingleArm(lead.trial, endpoint, effect)
    : UI.efficacy.teaser(lead.trial, endpoint, effect, lead.comparator);
}
