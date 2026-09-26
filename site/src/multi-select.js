// Searchable multi-select: APG "editable combobox with list autocomplete" that adds one value
// per pick, plus a list of removable chips. DOM focus stays on the input (aria-activedescendant).
// Labels are data: set via textContent only.
import { UI } from "./labels.js";

const MAX_OPTIONS = 50;
const COPY = UI.multiSelect;
let uid = 0;

// options: [{ value, label }]; onChange(values) fires on user edits only.
export function createMultiSelect(root, { label, options, selected = [], onChange }) {
  const id = `ms${++uid}`;
  let all = options;
  let chosen = [...selected];
  let matches = [];
  let active = -1;

  root.classList.add("multi-select");
  const labelElement = root.appendChild(document.createElement("label"));
  labelElement.id = `${id}-label`;
  labelElement.htmlFor = `${id}-input`;
  labelElement.textContent = label;
  const chips = root.appendChild(document.createElement("ul"));
  chips.className = "chips";
  chips.setAttribute("aria-label", COPY.selected(label));
  const input = root.appendChild(document.createElement("input"));
  Object.assign(input, { id: `${id}-input`, type: "text", autocomplete: "off", spellcheck: false });
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", `${id}-listbox`);
  const listbox = root.appendChild(document.createElement("ul"));
  Object.assign(listbox, { id: `${id}-listbox`, hidden: true });
  listbox.setAttribute("role", "listbox");
  listbox.setAttribute("aria-labelledby", labelElement.id);
  const status = root.appendChild(document.createElement("p"));
  status.className = "visually-hidden";
  status.setAttribute("aria-live", "polite");

  const labelOf = (value) => all.find((option) => option.value === value)?.label ?? value;

  function renderChips() {
    chips.hidden = chosen.length === 0;
    input.placeholder = chosen.length ? COPY.search : COPY.placeholder;
    chips.replaceChildren(...chosen.map((value) => {
      const item = document.createElement("li");
      const text = item.appendChild(document.createElement("span"));
      text.textContent = labelOf(value);
      const remove = item.appendChild(document.createElement("button"));
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", COPY.remove(text.textContent));
      remove.addEventListener("click", () => {
        toggle(value);
        input.focus();
      });
      return item;
    }));
  }

  function renderList() {
    const query = input.value.trim().toLowerCase();
    const pool = all.filter((option) => !chosen.includes(option.value) && option.label.toLowerCase().includes(query));
    matches = pool.slice(0, MAX_OPTIONS);
    listbox.replaceChildren(...matches.map((option, index) => {
      const item = document.createElement("li");
      item.id = `${id}-opt-${index}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(index === active));
      item.textContent = option.label;
      item.addEventListener("pointerdown", (event) => event.preventDefault()); // keep focus on the input
      item.addEventListener("click", () => toggle(option.value));
      return item;
    }));
    status.textContent = pool.length === 0 ? COPY.noMatches : COPY.matches(pool.length, MAX_OPTIONS);
  }

  function setActive(index) {
    active = matches.length ? (index + matches.length) % matches.length : -1;
    for (const [position, item] of [...listbox.children].entries()) item.setAttribute("aria-selected", String(position === active));
    if (active < 0) {
      input.removeAttribute("aria-activedescendant");
      return;
    }
    input.setAttribute("aria-activedescendant", `${id}-opt-${active}`);
    listbox.children[active].scrollIntoView({ block: "nearest" });
  }

  function open() {
    active = -1;
    renderList();
    listbox.hidden = false;
    input.setAttribute("aria-expanded", "true");
    input.removeAttribute("aria-activedescendant");
  }

  function close() {
    listbox.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function toggle(value) {
    const adding = !chosen.includes(value);
    chosen = adding ? [...chosen, value] : chosen.filter((item) => item !== value);
    input.value = "";
    close();
    renderChips();
    status.textContent = (adding ? COPY.added : COPY.removed)(labelOf(value), chosen.length);
    onChange([...chosen]);
  }

  input.addEventListener("input", open);
  input.addEventListener("click", () => {
    if (listbox.hidden) open();
  });
  input.addEventListener("keydown", (event) => {
    const isOpen = !listbox.hidden;
    if (event.key === "ArrowDown") {
      if (!isOpen) open();
      if (!event.altKey) setActive(active + 1);
    } else if (event.key === "ArrowUp") {
      if (!isOpen) open();
      setActive(active < 0 ? matches.length - 1 : active - 1);
    } else if (event.key === "Enter" && isOpen && active >= 0) {
      toggle(matches[active].value);
    } else if (event.key === "Escape") {
      if (isOpen) close();
      else input.value = "";
    } else if (event.key === "Backspace" && input.value === "" && chosen.length) {
      toggle(chosen.at(-1));
    } else {
      return;
    }
    event.preventDefault();
  });
  input.addEventListener("blur", close);

  renderChips();
  return {
    // Called by the render loop when data or URL state changes; never fires onChange.
    update(nextOptions, nextSelected) {
      all = nextOptions;
      chosen = [...nextSelected];
      renderChips();
      if (!listbox.hidden) renderList();
    },
  };
}
