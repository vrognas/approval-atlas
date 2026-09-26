// Lookup result panel: medicine card, substance card, condition / free-text results.
// Data beyond the first-load search index is loaded on demand and the panel re-renders when it
// arrives ("Loading…" until then). All text goes in via text nodes: EMA text contains "<" and ">".
import { groupDocuments } from "./documents.js";
import { NOT_STATED, UI, atcLevelOneLabel, statusLabel } from "./labels.js";
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

// Third-party URLs: https only, new tab, no opener or referrer.
function externalLink(text, url) {
  if (!url?.startsWith("https://")) return text;
  const isPdf = /\.pdf(-\d+)?$/i.test(url);
  return el("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, text, isPdf ? el("span", { class: "pdf" }, UI.card.pdf) : null);
}

// data-focus-key: re-renders (data arriving, status toggle) give focus back to the same control.
const title = (text) => el("h2", { tabindex: "-1", "data-focus-key": "title" }, text);

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

  function statusText(row, medicine) {
    const label = statusLabel(row.medicine_status);
    const ended = row.medicine_status !== "Authorised" && medicine?.authorized_until;
    return ended ? UI.card.statusEnded(label, medicine.authorized_until) : label;
  }

  const fact = (label, content) => (content === null || (Array.isArray(content) && content.length === 0) ? null : [el("dt", null, label), el("dd", null, content)]);

  function atcList(number, atc) {
    if (!ready(atc)) return pending(atc);
    const rows = atc.byProduct.get(number) ?? [];
    if (!rows.length) return null;
    return el("ul", { class: "plain" }, rows.map((row) => el("li", null,
      el("code", null, row.atc_code_human),
      row.atc_incomplete ? el("span", { class: "chip" }, UI.table.incomplete) : null,
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

  function documentsSection(number, medicine) {
    const documents = need("documents");
    const groups = ready(documents) ? groupDocuments(documents.get(number) ?? []) : [];
    const items = groups.flatMap((group) => (group.key === "variations"
      ? el("li", null, el("details", { "data-key": "variations" },
        el("summary", null, UI.documents.variations(group.rows.length)),
        el("ul", { class: "plain doc-sublist" }, group.rows.map((row) => el("li", null,
          externalLink(row.title, row.url), " ", el("span", { class: "muted" }, row.last_updated_date))))))
      : group.rows.map((row) => el("li", null,
        externalLink(row.ownTitle ? row.title : row.archive ? UI.documents.archive(UI.documents[group.key]) : UI.documents[group.key], row.url), " ", el("span", { class: "muted" }, UI.card.updated(row.last_updated_date))))));
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
      title(UI.card.notFoundTitle),
      el("p", null, UI.card.notFound(UI.card.kinds[kind], value)));
  }

  function medicineCard(number) {
    const row = index.byNumber.get(number);
    if (!row) return notFound("medicine", number);
    const medicines = need("medicines");
    const medicine = ready(medicines) ? medicines.get(number) : null;
    const [atc, areas, conditions] = [need("atc"), need("areas"), need("conditions")];
    const flags = Object.entries(UI.card.flags).filter(([flag]) => (medicine ?? row)[flag] === true);
    const substances = (row.substances ? row.substances.split("; ") : []).map((name) => {
      const key = row.substance_keys.find((candidate) => candidate === name.toLowerCase());
      return key ? internalLink(name, { sub: key }) : name;
    });
    const register = need("register");
    const registerRow = ready(register) ? register.get(number) : null;
    const registerDiffers = registerRow?.agrees_with_ema === false;
    // Order for a talk or poster: status and the SmPC / EPAR links on the first phone screen.
    return el("article", { class: "card" },
      title(row.name_of_medicine),
      el("p", { class: "card-status" },
        el("span", { class: "badge" }, statusText(row, medicine)),
        registerDiffers
          ? [" ", el("span", { class: "chip warning" },
            externalLink(UI.register.chip(registerRow.register_status, registerRow.register_last_decision_date), registerRow.register_url))]
          : null,
        " ", UI.card.approved(row.marketing_authorisation_date)),
      registerDiffers ? el("p", { class: "muted" }, UI.register.note) : null,
      el("dl", { class: "facts" },
        fact(UI.card.holder, ready(medicines) ? medicine?.marketing_authorisation_developer_applicant_holder ?? NOT_STATED : pending(medicines))),
      documentsSection(number, medicine),
      el("dl", { class: "facts" },
        fact(UI.card.substances, substances.map((link, position) => [link, position < substances.length - 1 ? "; " : ""])),
        fact(UI.card.type, [row.medicine_type, flags.map(([, label]) => [" ", el("span", { class: "chip" }, label)])]),
        fact(UI.card.atc, atcList(number, atc)),
        fact(UI.card.areas, areaLinks(number, areas, conditions)),
      ),
      medicine?.therapeutic_indication
        ? el("details", { class: "indication", "data-key": "indication" }, el("summary", null, UI.card.indication), el("p", null, medicine.therapeutic_indication))
        : null,
      protectionSection(row));
  }

  // rows: search-index rows (+ snippet) -> list items linking to the medicine card.
  function resultList(entries, medicines, withHolder) {
    if (!entries.length) return el("p", { class: "muted" }, UI.condition.none);
    return el("ul", { class: "plain result-list" }, entries.map(({ row, snippet }) => {
      const medicine = ready(medicines) ? medicines.get(row.ema_product_number) : null;
      const meta = [statusText(row, medicine), row.marketing_authorisation_date ?? UI.card.noDate, row.medicine_type, withHolder ? medicine?.marketing_authorisation_developer_applicant_holder : null];
      return el("li", null,
        el("p", { class: "result-name" }, internalLink(row.name_of_medicine, { med: row.ema_product_number }), row.substances ? el("span", { class: "muted" }, ` ${row.substances}`) : null),
        el("p", { class: "result-meta" }, meta.filter(Boolean).join(" · ")),
        snippet ? el("p", { class: "snippet" }, snippet.before, el("mark", null, snippet.match), snippet.after) : null);
    }));
  }

  function timelineBlock(rows, medicines) {
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
    return container;
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
    return el("article", { class: "card" },
      title(substance.name),
      el("p", null, UI.substance.firstApproval(first?.marketing_authorisation_date, first?.name_of_medicine)),
      timelineBlock(rows, medicines),
      el("h3", null, UI.substance.products(rows.length)),
      resultList(rows.map((row) => ({ row })), medicines, true));
  }

  function conditionResults(ui, query) {
    const conditions = need("conditions");
    const medicines = need("medicines");
    let heading;
    let tagged = null;
    let phrases;
    let related = [];
    if (ui) {
      if (!ready(conditions)) return el("article", { class: "card" }, pending(conditions));
      const descriptor = conditions.descriptors.get(ui);
      if (!descriptor) return notFound("condition", ui);
      heading = UI.condition.heading(descriptor.name, descriptor.narrower);
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
      title(heading),
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
    onData: (listener) => listeners.push(listener),
    focusOnNextRender: () => {
      focusNext = true;
    },
  };
}
