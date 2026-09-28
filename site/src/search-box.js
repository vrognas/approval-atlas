// Lookup search box: APG editable combobox with a grouped listbox (list autocomplete, manual
// selection). DOM focus stays on the input (aria-activedescendant). Text is set via textContent only.
// Markup is static in index.html: input[role=combobox], [role=listbox], a polite status element.
import { UI } from "./labels.js";
import { submitChoice } from "./search.js";

const DEBOUNCE_MS = 120;
const COPY = UI.lookup;

// suggestionsFor(query) -> { groups: [{ key, label, name, options: [{ label, meta, value, pick }] }],
// note, query }: a group without a label (the indication-text search) is named by name and has no
// heading; an option's pick names the group it opens as (a "did you mean" medicine: "medicines");
// note: a line above the options (a retried query, or no matches), announced with the count; query:
// the query the groups are for (the retried one), which Enter compares labels with. No options and
// no note: closed. onPick(groupKey, value) for a chosen option (or, on Enter without one, the
// suggestion the text names or the only one: submitChoice()); onSubmit(text) for Enter otherwise.
export function createSearchBox(input, listbox, status, { suggestionsFor, onPick, onSubmit }) {
  let options = [];
  let active = -1;
  let timer = 0;
  // Suggestions were asked for (typing, arrow keys) and not dismissed since: data arriving later
  // may fill a list that had no matches yet (e.g. an ATC code typed before the classes loaded).
  let requested = false;

  function close() {
    clearTimeout(timer); // a pending keystroke render would reopen the list
    requested = false;
    listbox.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function renderList() {
    requested = true;
    const result = suggestionsFor(input.value);
    const groups = result.groups.filter((group) => group.options.length > 0);
    options = [];
    // The note is announced through the status element, so it is hidden from the listbox's tree
    // (a listbox holds only options and groups).
    const note = result.note ? document.createElement("div") : null;
    if (note) {
      note.className = "listbox-note";
      note.setAttribute("aria-hidden", "true");
      note.textContent = result.note;
    }
    listbox.replaceChildren(...[note].filter(Boolean), ...groups.map((group) => {
      const list = document.createElement("ul");
      list.setAttribute("role", "group");
      if (group.label) {
        list.setAttribute("aria-labelledby", `lookup-group-${group.key}`);
        const heading = list.appendChild(document.createElement("li"));
        heading.setAttribute("role", "presentation");
        heading.id = `lookup-group-${group.key}`;
        heading.className = "group-label";
        heading.textContent = group.label;
      } else {
        list.setAttribute("aria-label", group.name);
        list.className = `group-${group.key}`;
      }
      for (const option of group.options) {
        const index = options.push({ ...option, group: option.pick ?? group.key, counted: group.key !== "text" }) - 1;
        const item = list.appendChild(document.createElement("li"));
        item.id = `lookup-opt-${index}`;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", "false");
        item.appendChild(document.createElement("span")).textContent = option.label;
        if (option.meta) {
          const meta = item.appendChild(document.createElement("span"));
          meta.className = "option-meta";
          meta.textContent = option.meta;
        }
        item.addEventListener("pointerdown", (event) => event.preventDefault()); // keep focus on the input
        item.addEventListener("click", () => pick(index));
      }
      return list;
    }));
    active = -1;
    input.removeAttribute("aria-activedescendant");
    const open = options.length > 0 || note !== null;
    listbox.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
    const count = options.filter((option) => option.counted).length;
    status.textContent = input.value.trim().length < 2 ? "" : COPY.status(result.note, count) || COPY.noMatches;
  }

  function setActive(index) {
    if (!options.length) return;
    active = (index + options.length) % options.length;
    for (const [position, item] of [...listbox.querySelectorAll('[role="option"]')].entries()) item.setAttribute("aria-selected", String(position === active));
    input.setAttribute("aria-activedescendant", `lookup-opt-${active}`);
    document.getElementById(`lookup-opt-${active}`).scrollIntoView({ block: "nearest" });
  }

  function pick(index) {
    const option = options[index];
    close();
    onPick(option.group, option.value);
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(renderList, DEBOUNCE_MS);
  });
  input.addEventListener("keydown", (event) => {
    const isOpen = !listbox.hidden;
    if (event.key === "ArrowDown") {
      if (!isOpen) renderList();
      setActive(active + 1);
    } else if (event.key === "ArrowUp") {
      if (!isOpen) renderList();
      setActive(active < 0 ? options.length - 1 : active - 1);
    } else if (event.key === "Enter") {
      clearTimeout(timer);
      if (isOpen && active >= 0) pick(active);
      else if (input.value.trim().length >= 2) {
        // The suggestion the text names (or the only one) opens as if picked; else a text search.
        // A retried query ("Ozempic 1 mg" shown for "ozempic") is the one labels are compared with.
        const result = suggestionsFor(input.value);
        const choice = submitChoice(result.groups, result.query);
        close();
        if (choice) onPick(choice.group, choice.value);
        else onSubmit(input.value.trim());
      }
    } else if (event.key === "Escape") {
      if (isOpen) close();
      else input.value = "";
    } else {
      return;
    }
    event.preventDefault();
  });
  input.addEventListener("blur", close);

  return {
    // New background data (conditions, drug classes) arrived: refresh an open list in place, or
    // show one for a query that had no matches yet.
    refresh() {
      if (!listbox.hidden || (requested && input.value.trim().length >= 2)) renderList();
    },
    setText(text) {
      input.value = text;
      close();
    },
  };
}
