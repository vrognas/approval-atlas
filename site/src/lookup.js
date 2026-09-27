// Lookup result panel: medicine card, substance card, condition / free-text results, each led by
// a kicker, an answer headline and (medicine, substance) an answer strip.
// Data beyond the first-load search index is loaded on demand and the panel re-renders when it
// arrives ("Loading…" until then). All text goes in via text nodes: EMA text contains "<" and ">".
import { statusDate } from "./approvals.js";
import { atcHue, atcSegments, typeBadges } from "./badges.js";
import { groupDocuments, primaryDocuments } from "./documents.js";
import { NOT_STATED, UI, atcLevelOneLabel, formatDate, statusDateLine, statusKind, statusLabel, statusSentence, statusesByFrequency } from "./labels.js";
import { espacenetUrl, protectionSummary } from "./protection.js";
import { buildConditions, conditionPhrases, foldSearchText, suggest, textMatches } from "./search.js";
import { renderTimeline } from "./timeline.js";
import { DEFAULT_LOOKUP, DEFAULT_STATE, encodeUrl, lookupView } from "./url.js";

const FAILED = Symbol("failed");
const ATC_PREFIX_LENGTHS = [1, 3, 4, 5, 7];

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row[key])) groups.set(row[key], []);
    groups.get(row[key]).push(row);
  }
  return groups;
}

const PDF_URL = /\.pdf(-\d+)?$/i;

// Third-party URLs: https only, new tab, no opener or referrer.
function externalLink(text, url) {
  if (!url?.startsWith("https://")) return text;
  return el("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, text, PDF_URL.test(url) ? el("span", { class: "pdf" }, UI.card.pdf) : null);
}

// Headline parts (labels.js UI.headline) -> text, with toned words in spans.
export function headlineNodes(parts) {
  return parts.map((part) => (typeof part === "string" ? part : el("span", { class: `tone-${part.tone}` }, part.text)));
}

// data-focus-key: re-renders (data arriving, status toggle) give focus back to the same control.
const title = (content) => el("h2", { tabindex: "-1", "data-focus-key": "title" }, content);
const kicker = (kind) => el("p", { class: "kicker" }, UI.kicker[kind]);

// Dot and label in the status colour; pill: on its light fill (answer strip).
const statusBadge = (status, pill = false) => el("span", { class: `status status-${statusKind(status)}${pill ? " pill" : ""}` }, statusLabel(status));

function typeBadgeList(row) {
  const badges = typeBadges(row);
  return badges.length ? el("span", { class: "badges" }, badges.map((badge) => el("span", { class: `badge hue-${badge.hue}` }, badge.label))) : null;
}

// Segmented ATC badge (display only in this phase): one segment per level, in the group's hue.
function atcBadge(code) {
  return el("span", { class: `atc-badge hue-${atcHue(code)}` },
    atcSegments(code).map((segment) => el("span", { class: segment.level ? `atc-seg level-${segment.level}` : "atc-seg" }, segment.text)));
}

// Answer strip: [label, value, wide] items (null items are left out); the wide one spans a row on phones.
function strip(items) {
  return el("dl", { class: "strip", "aria-label": UI.card.strip.label }, items.filter(Boolean).map(([label, value, wide]) =>
    el("div", { class: wide ? "strip-wide" : null }, el("dt", null, label), el("dd", null, value))));
}

// SmPC / EPAR as a full-width secondary button: document name, then "PDF · updated {date}".
function documentButton({ key, row }) {
  if (!row.url?.startsWith("https://")) return null;
  return el("a", { class: "doc-button", href: row.url, target: "_blank", rel: "noopener noreferrer" },
    el("span", { class: "doc-button-title" }, UI.documents[key]),
    el("span", { class: "doc-button-meta" }, UI.card.documentMeta(PDF_URL.test(row.url), formatDate(row.last_updated_date))));
}

const byDate = (direction) => (a, b) => {
  const [left, right] = [a.marketing_authorisation_date, b.marketing_authorisation_date];
  if (left === right) return a.name_of_medicine.localeCompare(b.name_of_medicine);
  if (left === null) return 1;
  if (right === null) return -1;
  return direction * left.localeCompare(right);
};
const familyOf = (row) => (row.substance_keys?.length ? [...new Set(row.substance_keys)].sort().join("|") : null);

export function createLookup(panel, { index, loadFile, navigate, snapshotDate }) {
  const DATASETS = {
    medicines: [["ema_medicines.json"], (rows) => new Map(rows.map((row) => [row.ema_product_number, row]))],
    atc: [["ema_medicine_atc_codes.json", "atc_classes.json"], (rows, classes) => ({
      byProduct: groupBy(rows, "ema_product_number"),
      names: new Map(classes.map((row) => [row.atc_code, row.name])),
    })],
    areas: [["ema_medicine_therapeutic_areas.json"], (rows) => groupBy(rows, "ema_product_number")],
    conditions: [["mesh_descriptor_areas.json", "ema_medicine_therapeutic_areas.json", "ema_therapeutic_area_branches.json"],
      (descriptorAreaRows, areaRows, branchRows) => buildConditions(index, { descriptorAreaRows, areaRows, branchRows })],
    documents: [["ema_medicine_documents.json"], (rows) => groupBy(rows, "ema_product_number")],
    protection: [["ema_medicine_protection.json", "ema_medicine_orphan_exclusivity.json"], (rows, orphanRows) => ({
      byProduct: new Map(rows.map((row) => [row.ema_product_number, row])),
      orphan: groupBy(orphanRows, "ema_product_number"),
    })],
    register: [["ema_medicine_register_status.json"], (rows) => new Map(rows.map((row) => [row.ema_product_number, row]))],
  };
  const values = new Map();
  const listeners = [];
  let lastState = null;
  let renderedKey = null;
  let showAll = false;
  let showAllKey = null; // the lookup view the "Show all statuses" choice belongs to
  let focusNext = false;
  let timeline = null;
  const resizeObserver = new ResizeObserver(() => {
    if (timeline && timeline.container.clientWidth !== timeline.width) drawTimeline();
  });

  // Value, FAILED, or undefined while loading (the first call starts the load).
  function need(name) {
    if (values.has(name)) return values.get(name);
    values.set(name, undefined);
    const [files, build] = DATASETS[name];
    Promise.all(files.map(loadFile)).then((rows) => build(...rows), () => FAILED).then((value) => {
      values.set(name, value);
      for (const listener of listeners) listener(name);
      if (lastState) render(lastState, true);
    });
    return undefined;
  }
  const ready = (value) => value !== undefined && value !== FAILED;
  const pending = (value) => el("p", { class: "muted" }, value === FAILED ? UI.lookup.notAvailable : UI.lookup.loading);

  function internalLink(text, patch) {
    const href = `?${encodeUrl({ ...DEFAULT_STATE, ...DEFAULT_LOOKUP, ...patch })}`;
    return el("a", {
      href,
      onclick: (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(patch);
      },
    }, text);
  }

  const fact = (label, content) => (content === null || (Array.isArray(content) && content.length === 0) ? null : [el("dt", null, label), el("dd", null, content)]);

  function atcList(number, atc) {
    if (!ready(atc)) return pending(atc);
    const rows = atc.byProduct.get(number) ?? [];
    if (!rows.length) return null;
    return el("ul", { class: "plain atc-list" }, rows.map((row) => el("li", null,
      atcBadge(row.atc_code_human),
      row.atc_incomplete ? [" ", el("span", { class: "chip" }, UI.table.incomplete)] : null,
      el("ul", { class: "atc-levels" }, ATC_PREFIX_LENGTHS
        .filter((length) => length <= row.atc_code_human.length && atc.names.has(row.atc_code_human.slice(0, length)))
        .map((length) => {
          const prefix = row.atc_code_human.slice(0, length);
          return el("li", null, length === 1 ? atcLevelOneLabel(prefix, atc.names.get(prefix)) : `${prefix} ${atc.names.get(prefix)}`);
        })),
    )));
  }

  function areaLinks(number, areas, conditions) {
    if (!ready(areas)) return pending(areas);
    const terms = (areas.get(number) ?? []).map((row) => row.therapeutic_area_mesh);
    return terms.map((term, position) => {
      const ui = ready(conditions) ? conditions.termUi.get(term) : null;
      return [ui ? internalLink(term, { cond: ui }) : term, position < terms.length - 1 ? "; " : ""];
    });
  }

  // The documents list below the SmPC / EPAR buttons. groups: groupDocuments() output; rest: the
  // groups without the button rows (primaryDocuments()).
  function documentsSection(documents, groups, rest, medicine) {
    const items = rest.flatMap((group) => (group.key === "variations"
      ? el("li", null, el("details", { "data-key": "variations" },
        el("summary", null, UI.documents.variations(group.rows.length)),
        el("ul", { class: "plain doc-sublist" }, group.rows.map((row) => el("li", null,
          externalLink(row.title, row.url), " ", el("span", { class: "muted" }, formatDate(row.last_updated_date)))))))
      : group.rows.map((row) => el("li", null,
        externalLink(row.ownTitle ? row.title : row.archive ? UI.documents.archive(UI.documents[group.key]) : UI.documents[group.key], row.url), row.last_updated_date ? [" ", el("span", { class: "muted" }, UI.card.updated(formatDate(row.last_updated_date)))] : null))));
    if (medicine?.medicine_url) items.push(el("li", null, externalLink(UI.card.medicinePage, medicine.medicine_url)));
    return el("section", { class: "card-section" },
      el("h3", null, UI.card.documents),
      ready(documents) ? null : pending(documents),
      ready(documents) && groups.length === 0 ? el("p", { class: "muted" }, UI.card.noDocuments) : null,
      items.length ? el("ul", { class: "plain doc-list" }, items) : null);
  }

  function protectionSection(row) {
    const protection = need("protection");
    const heading = (status) => el("h3", null, UI.protection.title, status ? [" ", el("span", { class: "chip" }, status)] : null);
    if (!ready(protection)) return el("section", { class: "card-section" }, heading(null), pending(protection));
    const names = row.substances ? row.substances.split("; ") : [];
    const summary = protectionSummary(
      protection.byProduct.get(row.ema_product_number),
      protection.orphan.get(row.ema_product_number) ?? [],
      names.length ? names.join(" + ") : UI.protection.thisSubstance,
      snapshotDate,
    );
    if (!summary) return null;
    return el("section", { class: "card-section protection" },
      heading(summary.status),
      summary.lines.map((line) => el("p", null, line)),
      summary.orphan.map((line) => el("p", null, line)),
      el("p", null, UI.protection.patents, " ", externalLink(UI.protection.espacenet, espacenetUrl(names[0] ?? row.name_of_medicine))),
      el("details", { "data-key": "caveats" },
        el("summary", null, UI.protection.caveatsTitle),
        el("ul", null, UI.protection.caveats.map((caveat) => el("li", null, caveat)))));
  }

  function notFound(kind, value) {
    return el("article", { class: "card" },
      kicker(kind),
      title(UI.card.notFoundTitle),
      el("p", null, UI.card.notFound(UI.card.kinds[kind], value)));
  }

  function medicineCard(number) {
    const row = index.byNumber.get(number);
    if (!row) return notFound("medicine", number);
    const medicines = need("medicines");
    const medicine = ready(medicines) ? medicines.get(number) : null;
    const [atc, areas, conditions, documents] = [need("atc"), need("areas"), need("conditions"), need("documents")];
    const authorized = statusKind(row.medicine_status) === "authorized";
    // Orphan shows as a type badge; the other flags as neutral chips.
    const flags = Object.entries(UI.card.flags).filter(([flag]) => flag !== "orphan_medicine" && (medicine ?? row)[flag] === true);
    const substances = (row.substances ? row.substances.split("; ") : []).map((name) => {
      const key = row.substance_keys.find((candidate) => candidate === name.toLowerCase());
      return key ? internalLink(name, { sub: key }) : name;
    });
    const register = need("register");
    const registerRow = ready(register) ? register.get(number) : null;
    const registerDiffers = registerRow?.agrees_with_ema === false;
    const groups = ready(documents) ? groupDocuments(documents.get(number) ?? []) : [];
    const { primary, rest } = primaryDocuments(groups);
    const sentence = medicine ? statusSentence(row.medicine_status, statusDate(medicine), medicine.opinion_status) : null;
    // Order for a talk or poster: the answer, status and the SmPC / EPAR buttons on the first phone screen.
    return el("article", { class: "card" },
      kicker("medicine"),
      title(headlineNodes(UI.headline.medicine(row.name_of_medicine, authorized))),
      sentence ? el("p", { class: "dek" }, sentence) : null,
      strip([
        [UI.card.strip.holder, ready(medicines) ? medicine?.marketing_authorisation_developer_applicant_holder ?? NOT_STATED : pending(medicines), true],
        // Never-approved medicines (refused, withdrawn applications) have no approval cell.
        authorized || row.marketing_authorisation_date
          ? [authorized ? UI.card.strip.since : UI.card.strip.approved, formatDate(row.marketing_authorisation_date) ?? NOT_STATED]
          : null,
        [UI.card.strip.status, statusBadge(row.medicine_status, true)],
      ]),
      registerDiffers
        ? el("p", null, el("span", { class: "chip warning" },
          externalLink(UI.register.chip(registerRow.register_status, registerRow.register_last_decision_date), registerRow.register_url)))
        : null,
      registerDiffers ? el("p", { class: "muted" }, UI.register.note) : null,
      primary.length ? el("div", { class: "doc-buttons" }, primary.map(documentButton)) : null,
      documentsSection(documents, groups, rest, medicine),
      el("dl", { class: "facts card-section" },
        fact(UI.card.substances, substances.map((link, position) => [link, position < substances.length - 1 ? "; " : ""])),
        // The type's name as text only when it has no badge (Other).
        fact(UI.card.type, [
          typeBadges({ medicine_type: row.medicine_type }).length ? null : [row.medicine_type, " "],
          typeBadgeList(medicine ?? row),
          flags.map(([, label]) => [" ", el("span", { class: "chip" }, label)]),
        ]),
        fact(UI.card.atc, atcList(number, atc)),
        fact(UI.card.areas, areaLinks(number, areas, conditions)),
      ),
      medicine?.therapeutic_indication
        ? el("details", { class: "indication card-section", "data-key": "indication" }, el("summary", null, UI.card.indication), el("p", null, medicine.therapeutic_indication))
        : null,
      protectionSection(row));
  }

  // rows: search-index rows (+ snippet) -> rows linking to the medicine card: name, substances,
  // status dot and date line with type badges, holder.
  function resultList(entries, medicines, withHolder) {
    if (!entries.length) return el("p", { class: "muted" }, UI.condition.none);
    return el("ul", { class: "plain result-list" }, entries.map(({ row, snippet }) => {
      const medicine = ready(medicines) ? medicines.get(row.ema_product_number) : null;
      const dates = statusDateLine(row.medicine_status, row.marketing_authorisation_date, medicine?.authorized_until ?? null);
      const holder = withHolder ? medicine?.marketing_authorisation_developer_applicant_holder : null;
      return el("li", null,
        el("p", { class: "result-name" }, internalLink(row.name_of_medicine, { med: row.ema_product_number })),
        row.substances ? el("p", { class: "result-substances" }, row.substances) : null,
        el("p", { class: "result-meta" }, statusBadge(row.medicine_status), dates ? el("span", { class: "result-date" }, dates) : null, typeBadgeList(row)),
        holder ? el("p", { class: "result-holder" }, holder) : null,
        snippet ? el("p", { class: "snippet" }, snippet.before, el("mark", null, snippet.match), snippet.after) : null);
    }));
  }

  // A surface block holding the timeline; none without rows.
  function timelineBlock(rows, medicines) {
    if (!rows.length) return null;
    const container = el("div", { class: "timeline chart" });
    const items = rows.map((row) => ({
      id: row.ema_product_number,
      name: row.name_of_medicine,
      date: row.marketing_authorisation_date,
      type: row.medicine_type,
      family: familyOf(row),
      status: row.medicine_status,
      holder: ready(medicines) ? medicines.get(row.ema_product_number)?.marketing_authorisation_developer_applicant_holder ?? null : null,
    }));
    timeline = { container, items, width: null };
    return el("div", { class: "card-section" }, container);
  }

  function drawTimeline() {
    timeline.width = timeline.container.clientWidth;
    renderTimeline(timeline.container, timeline.items, { link: (item) => internalLink(item.name, { med: item.id }) });
  }

  function substanceCard(key) {
    const substance = index.substances.get(key);
    if (!substance) return notFound("substance", key);
    const medicines = need("medicines");
    const rows = [...substance.products].sort(byDate(1));
    const first = rows[0]?.marketing_authorisation_date ? rows[0] : null;
    const authorized = rows.filter((row) => statusKind(row.medicine_status) === "authorized").length;
    const holders = ready(medicines)
      ? [...new Set(rows.map((row) => medicines.get(row.ema_product_number)?.marketing_authorisation_developer_applicant_holder ?? NOT_STATED))]
      : null;
    return el("article", { class: "card" },
      kicker("substance"),
      title(headlineNodes(UI.headline.substance(substance.name, authorized))),
      el("p", { class: "dek" }, UI.substance.firstApproval(first?.marketing_authorisation_date, first?.name_of_medicine)),
      strip([
        [UI.card.strip.holder, holders === null ? pending(medicines) : holders.length === 1 ? holders[0] : UI.substance.holders(holders.length), true],
        first ? [authorized ? UI.card.strip.since : UI.card.strip.approved, formatDate(first.marketing_authorisation_date)] : null,
        // None authorized now: the statuses themselves (e.g. Withdrawn), which say more than "0 authorized".
        [UI.card.strip.status, authorized > 0
          ? el("span", { class: "status pill status-authorized" }, UI.substance.authorized(authorized))
          : el("span", { class: "badges" }, statusesByFrequency(rows.map((row) => row.medicine_status)).map((status) => statusBadge(status, true)))],
      ]),
      timelineBlock(rows, medicines),
      el("h3", null, UI.substance.products(rows.length)),
      resultList(rows.map((row) => ({ row })), medicines, true));
  }

  function conditionResults(ui, query) {
    const conditions = need("conditions");
    const medicines = need("medicines");
    let heading;
    let dek = null;
    let tagged = null;
    let phrases;
    let related = [];
    if (ui) {
      if (!ready(conditions)) return el("article", { class: "card" }, pending(conditions));
      const descriptor = conditions.descriptors.get(ui);
      if (!descriptor) return notFound("condition", ui);
      heading = headlineNodes(UI.headline.condition(descriptor.name, descriptor.authorized));
      dek = descriptor.narrower ? UI.condition.narrower(descriptor.narrower) : null;
      tagged = [...descriptor.products].map((number) => index.byNumber.get(number)).filter(Boolean);
      phrases = conditionPhrases(descriptor);
    } else {
      heading = UI.condition.textHeading(query);
      phrases = [foldSearchText(query)];
      if (ready(conditions)) related = suggest(index, conditions, query).conditions;
    }
    const shown = (row) => showAll || row.medicine_status === "Authorised";
    const taggedShown = (tagged ?? []).filter(shown).sort(byDate(-1));
    const mentioned = ready(medicines)
      ? textMatches([...medicines.values()], phrases, new Set((tagged ?? []).map((row) => row.ema_product_number)))
        .map(({ product, snippet }) => ({ row: index.byNumber.get(product.ema_product_number), snippet }))
        .filter(({ row }) => row && shown(row))
        .sort((a, b) => byDate(-1)(a.row, b.row))
      : null;
    const toggle = el("label", { class: "toggle-all" },
      el("input", { type: "checkbox", checked: showAll, "data-focus-key": "show-all", onchange: (event) => {
        showAll = event.currentTarget.checked;
        render(lastState, true);
      } }),
      " ", UI.condition.showAll);
    return el("article", { class: "card" },
      kicker(ui ? "condition" : "text"),
      title(heading),
      dek ? el("p", { class: "dek" }, dek) : null,
      related.length ? el("p", { class: "related" }, `${UI.condition.relatedConditions}: `,
        related.map((condition) => [internalLink(condition.name, { cond: condition.ui }), " "])) : null,
      toggle,
      timelineBlock([...taggedShown, ...(mentioned ?? []).map(({ row }) => row)], medicines),
      tagged ? [el("h3", null, `${UI.condition.tagged} (${taggedShown.length})`), resultList(taggedShown.map((row) => ({ row })), medicines, false)] : null,
      el("h3", null, mentioned ? `${tagged ? UI.condition.alsoMentioned : UI.condition.mentioned} (${mentioned.length})` : tagged ? UI.condition.alsoMentioned : UI.condition.mentioned),
      mentioned ? resultList(mentioned, medicines, false) : pending(medicines));
  }

  // Re-renders only when the lookup view changed, a dataset arrived (force) or the status toggle changed.
  function render(state, force = false) {
    lastState = state;
    const view = lookupView(state);
    const key = JSON.stringify(view);
    const sameView = key === renderedKey;
    if (!force && sameView) return;
    renderedKey = key;
    // A new view retries data that failed to load (not forced re-renders: that would loop).
    if (!force) for (const [name, value] of values) if (value === FAILED) values.delete(name);
    // A new search, substance or condition starts at Authorized only; opening a medicine card
    // and coming back keeps the choice.
    if (view.kind !== null && view.kind !== "medicine" && key !== showAllKey) {
      showAll = false;
      showAllKey = key;
    }
    // Same view re-rendered: keep open disclosures and the focused control.
    const open = new Set(sameView ? [...panel.querySelectorAll("details[open][data-key]")].map((details) => details.dataset.key) : []);
    const focusKey = sameView && panel.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
    timeline = null;
    resizeObserver.disconnect();
    panel.hidden = view.kind === null;
    if (view.kind === null) {
      panel.replaceChildren();
      return;
    }
    const content = view.kind === "medicine" ? medicineCard(view.value)
      : view.kind === "substance" ? substanceCard(view.value)
        : conditionResults(view.kind === "condition" ? view.value : null, view.value);
    panel.replaceChildren(content);
    for (const details of panel.querySelectorAll("details[data-key]")) if (open.has(details.dataset.key)) details.open = true;
    if (timeline) {
      drawTimeline();
      resizeObserver.observe(timeline.container);
    }
    if (focusNext) {
      focusNext = false;
      const heading = panel.querySelector("h2");
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: "nearest" });
    } else if (focusKey) {
      panel.querySelector(`[data-focus-key="${focusKey}"]`)?.focus({ preventScroll: true });
    }
  }

  return {
    render,
    need,
    conditions: () => (ready(values.get("conditions")) ? values.get("conditions") : null),
    link: internalLink,
    onData: (listener) => listeners.push(listener),
    focusOnNextRender: () => {
      focusNext = true;
    },
  };
}
