// Lookup search box: APG editable combobox with a grouped listbox (list autocomplete, manual
// selection). DOM focus stays on the input (aria-activedescendant). Text is set via textContent only.
// Markup is static in index.html: input[role=combobox], [role=listbox], a polite status element.
import { UI } from "./labels.js";

const DEBOUNCE_MS = 120;
const COPY = UI.lookup;

// suggestionsFor(query) -> [{ key, label, options: [{ label, meta, value }] }]; empty = closed.
// onPick(groupKey, value) for a chosen option; onSubmit(text) for Enter without a pick.
export function createSearchBox(input, listbox, status, { suggestionsFor, onPick, onSubmit }) {
  let options = [];
  let active = -1;
  let timer = 0;

  function close() {
    clearTimeout(timer); // a pending keystroke render would reopen the list
    listbox.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function renderList() {
    const groups = suggestionsFor(input.value).filter((group) => group.options.length > 0);
    options = [];
    listbox.replaceChildren(...groups.map((group) => {
      const list = document.createElement("ul");
      list.setAttribute("role", "group");
      list.setAttribute("aria-labelledby", `lookup-group-${group.key}`);
      const heading = list.appendChild(document.createElement("li"));
      heading.setAttribute("role", "presentation");
      heading.id = `lookup-group-${group.key}`;
      heading.className = "group-label";
      heading.textContent = group.label;
      for (const option of group.options) {
        const index = options.push({ group: group.key, ...option }) - 1;
        const item = list.appendChild(document.createElement("li"));
        item.id = `lookup-opt-${index}`;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", "false");
        item.appendChild(document.createElement("span")).textContent = option.label;
        const meta = item.appendChild(document.createElement("span"));
        meta.className = "option-meta";
        meta.textContent = option.meta;
        item.addEventListener("pointerdown", (event) => event.preventDefault()); // keep focus on the input
        item.addEventListener("click", () => pick(index));
      }
      return list;
    }));
    active = -1;
    input.removeAttribute("aria-activedescendant");
    const open = options.length > 0;
    listbox.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
    status.textContent = input.value.trim().length < 2 ? "" : open ? COPY.matches(options.length) : COPY.noMatches;
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
        close();
        onSubmit(input.value.trim());
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
    // New background data (conditions) arrived: refresh an open list in place.
    refresh() {
      if (!listbox.hidden) renderList();
    },
    setText(text) {
      input.value = text;
      close();
    },
  };
}
