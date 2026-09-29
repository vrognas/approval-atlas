// Collapsible facet sections (owner decision 2026-09-29 (2)): the sidebar shows just the section
// titles ("Medicine type", "Modality", "ATC class", …), each heading a disclosure button
// (aria-expanded, aria-controls its body, a chevron). Collapsed by default; each viewer's open
// sections are kept in localStorage (every access wrapped: the page works without it). A collapsed
// section with an active filter shows a summary after its title (facets.js sectionSummary()), so no
// filter is hidden. A section opens by itself before something focuses its control (reveal(): a
// sentence token, the table's ATC fallback). A phone sheet of one section shows it open with its
// heading hidden, the sheet's title naming it (solo()); the "All filters" sheet shows the headings
// as the sidebar does.

// The sections (index.html #facet-{key}), in page order.
export const FACET_SECTIONS = ["type", "modality", "atc", "area", "mah", "status"];
const STORAGE_KEY = "approval-atlas:facets-open";

// Pure: the sections the viewer left open (none stored, unreadable or blocked: none).
export function readOpenSections(storage) {
  try {
    const stored = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(stored) ? FACET_SECTIONS.filter((key) => stored.includes(key)) : []);
  } catch {
    return new Set();
  }
}

export function storeOpenSections(storage, open) {
  try {
    if (open.size) storage?.setItem(STORAGE_KEY, JSON.stringify(FACET_SECTIONS.filter((key) => open.has(key))));
    else storage?.removeItem(STORAGE_KEY);
  } catch {
    // Blocked storage: the sections stay as they are for this visit only.
  }
}

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function createFacetSections() {
  const storage = browserStorage();
  const open = readOpenSections(storage);
  const summaries = new Map();
  let solo = null;
  const parts = new Map(FACET_SECTIONS.map((key) => {
    const section = document.getElementById(`facet-${key}`);
    const heading = section.querySelector(":scope > .facet-title");
    return [key, {
      heading,
      toggle: heading.querySelector(".facet-toggle"),
      summary: heading.querySelector(".facet-summary"),
      body: section.querySelector(":scope > .facet-body"),
    }];
  }));

  function update(key) {
    const { heading, toggle, summary, body } = parts.get(key);
    const shown = open.has(key) || solo === key;
    heading.hidden = solo === key;
    toggle.setAttribute("aria-expanded", shown ? "true" : "false");
    body.hidden = !shown;
    // Read with the title as "ATC class, L04AC Interleukin Inhibitors" (a hidden comma between).
    const text = shown ? null : summaries.get(key) ?? null;
    summary.hidden = text === null;
    if (text !== null && summary.dataset.text !== text) {
      const comma = document.createElement("span");
      comma.className = "visually-hidden";
      comma.textContent = ", ";
      summary.replaceChildren(comma, text);
      summary.dataset.text = text;
    }
  }

  function setOpen(key, value) {
    if (open.has(key) === value) return;
    if (value) open.add(key);
    else open.delete(key);
    storeOpenSections(storage, open);
    update(key);
  }

  // A native button: Enter and Space toggle it, and focus stays on it.
  for (const [key, { toggle }] of parts) {
    toggle.addEventListener("click", () => setOpen(key, !open.has(key)));
    update(key);
  }

  return {
    // Opens a section (and keeps it open for the viewer), before focus moves into it.
    reveal: (key) => setOpen(key, true),
    // key: the one section a phone sheet shows, open and without its heading; null: none.
    solo(key) {
      const before = solo;
      solo = key;
      for (const changed of new Set([before, key])) if (changed) update(changed);
    },
    // texts: section key -> summary text (sectionSummary()) or null, after every render.
    summarize(texts) {
      for (const key of FACET_SECTIONS) {
        summaries.set(key, texts[key] ?? null);
        update(key);
      }
    },
  };
}
