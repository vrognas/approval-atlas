// Lookup search box: APG editable combobox with a grouped listbox (list autocomplete, manual
// selection). DOM focus stays on the input (aria-activedescendant). Text is set via textContent only.
// Markup is static in index.html: input[role=combobox], [role=listbox], a polite status element.
import { UI } from "./labels.js";
import { collapseGroups, keepShownOrder, submitChoice } from "./search.js";

const DEBOUNCE_MS = 120;
// How long Enter waits at most for the search's background data (bug hunt 2026-10-01): about the
// gap between the search and that data on slow conference Wi-Fi (1.5-2.5 s at 1.6 Mbps).
const ENTER_WAIT_MS = 3000;
const COPY = UI.lookup;
// Laws of UX, second pass (2026-09-30): on phones (as style.css's 44px options) each group shows a
// few options and a "Show 5 more" option expanding it in place (collapseGroups()); desktop unchanged.
const PHONE = window.matchMedia("(max-width: 720px)");

// suggestionsFor(query) -> { groups: [{ key, label, name, options: [{ label, meta, value, pick }] }],
// note, query }: a group without a label (the indication-text search) is named by name and has no
// heading; an option's pick names the group it opens as (a "did you mean" medicine: "medicines");
// note: a line above the options (a retried query, or no matches), announced with the count; query:
// the query the groups are for (the retried one), which Enter compares labels with. No options and
// no note: closed. onPick(groupKey, value) for a chosen option (or, on Enter without one, the
// suggestion the text names or the only one: submitChoice()); onSubmit(text) for Enter otherwise.
// recent (2026-09-29): { group(), clear() } for the viewer's recently viewed, listed while the field
// is focused and empty: group() gives the group (recent.js recentGroup(), null when empty), whose
// options open as picked suggestions but the last, Clear (action "clear": clear(), focus kept).
// pending(): a Promise settled once the background data suggestions come from has arrived, null
// when none is loading; navigations(): a count of the history entries pushed or popped (bug hunt
// 2026-10-01, lookup.md #2: Enter in the first seconds on slow Wi-Fi ran a text search for
// "psoriasis", as the conditions had not arrived).
export function createSearchBox(input, listbox, status, {
  suggestionsFor, onPick, onSubmit, recent = null, pending = () => null, navigations = () => 0,
}) {
  let options = [];
  let active = -1;
  let timer = 0;
  // The group keys the list shows, in order, and the query they are for: data arriving under the
  // open list keeps them in place (keepShownOrder()).
  let listed = null;
  // Each Enter, pick, keystroke, Escape and setText: an Enter waiting for data is dropped by any.
  let submits = 0;
  // The groups a "Show … more" expanded (phones), until the text changes.
  let expanded = new Set();
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

  // keepOrder: background data arrived under the open list; the groups shown keep their places.
  function renderList({ keepOrder = false } = {}) {
    requested = true;
    const recentGroup = input.value.trim() === "" ? recent?.group() ?? null : null;
    const result = recentGroup ? { groups: [recentGroup], note: null } : suggestionsFor(input.value);
    const query = result.query ?? input.value;
    let groups = result.groups.filter((group) => group.options.length > 0);
    if (keepOrder && !recentGroup && listed?.query === query) groups = keepShownOrder(listed.keys, groups, query);
    listed = { query, keys: groups.map((group) => group.key) };
    // Phones: a few options per group, then "Show 5 more …" (an action option expanding it in place;
    // it names what it adds, as more can match than a group holds: MAX_SUGGESTIONS).
    let hidden = 0;
    if (PHONE.matches && !recentGroup) {
      groups = collapseGroups(groups, query, { expanded }).map((group) => {
        hidden += group.hidden;
        if (!group.hidden) return group;
        return { ...group, options: [...group.options, { label: COPY.showMore(group.hidden, group.key), value: group.key, added: group.hidden, action: "expand" }] };
      });
    }
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
        // group: the group it opens as (a "did you mean" medicine: "medicines"); listGroup: the one it is listed in.
        const index = options.push({ ...option, group: option.pick ?? group.key, listGroup: group.key, counted: group.key !== "text" && !option.action }) - 1;
        const item = list.appendChild(document.createElement("li"));
        item.id = `lookup-opt-${index}`;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", "false");
        // An action (Clear) is named in full ("Clear recently viewed") and looks like one; "Show … more"
        // (phones) reads as a link at the end of its group.
        if (option.name) item.setAttribute("aria-label", option.name);
        if (option.action) item.className = option.action === "expand" ? "option-expand" : `option-action option-${option.action}`;
        item.appendChild(document.createElement("span")).textContent = option.label;
        if (option.meta) {
          const meta = item.appendChild(document.createElement("span"));
          meta.className = "option-meta";
          meta.textContent = option.meta;
        }
      }
      return list;
    }));
    active = -1;
    input.removeAttribute("aria-activedescendant");
    const open = options.length > 0 || note !== null;
    listbox.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
    // Those a "Show … more" holds count too: the same number as on desktop.
    const count = options.filter((option) => option.counted).length + hidden;
    if (recentGroup) status.textContent = COPY.recent.status(count);
    else status.textContent = input.value.trim().length < 2 ? "" : COPY.status(result.note, count) || COPY.noMatches;
  }

  function setActive(index) {
    if (!options.length) return;
    active = (index + options.length) % options.length;
    for (const [position, item] of [...listbox.querySelectorAll('[role="option"]')].entries()) item.setAttribute("aria-selected", String(position === active));
    input.setAttribute("aria-activedescendant", `lookup-opt-${active}`);
    document.getElementById(`lookup-opt-${active}`).scrollIntoView({ block: "nearest" });
  }

  // "Show 5 more" (phones): its group shown whole in place, the list open, focus kept in the field,
  // the first option it added active (aria-activedescendant) and what it added announced.
  function expand(option) {
    const inGroup = (other) => other.listGroup === option.value && !other.action;
    const shown = options.filter(inGroup).length;
    expanded.add(option.value);
    renderList();
    const first = options.findIndex(inGroup);
    if (first >= 0) setActive(first + shown);
    status.textContent = COPY.expanded(option.added, option.value);
  }

  function pick(index) {
    const option = options[index];
    if (option.action === "expand") {
      expand(option);
      return;
    }
    submits += 1;
    close();
    if (option.action === "clear") {
      recent.clear();
      status.textContent = COPY.recent.cleared;
      return;
    }
    onPick(option.group, option.value);
  }

  // Enter without a picked option: the suggestion the text names (or the only one) opens as if
  // picked; else a text search. A retried query ("Ozempic 1 mg" shown for "ozempic") is the one
  // labels are compared with. While background data is loading (bug hunt 2026-10-01) only a named
  // suggestion opens ("humira"); else Enter waits (the list shown, "Loading…" announced), trying
  // again as each dataset arrives (refresh(): "psoriasis" opens with the conditions), and chooses
  // as usual once all have, or ENTER_WAIT_MS passed; dropped when the text changed, another Enter,
  // pick or Escape came, or a navigation happened (a link, Back) meanwhile.
  let waiting = null; // { serial, text, view }
  function choose(text, onlyNamed) {
    const result = suggestionsFor(text);
    const choice = submitChoice(result.groups, result.query, { onlyNamed });
    if (!choice && onlyNamed) return false;
    close();
    if (choice) onPick(choice.group, choice.value);
    else onSubmit(text.trim());
    return true;
  }
  function submit() {
    const text = input.value;
    const serial = ++submits;
    const loading = pending();
    if (choose(text, loading !== null)) return;
    waiting = { serial, text, view: navigations() };
    renderList();
    status.textContent = COPY.loading;
    const cap = new Promise((resolve) => setTimeout(resolve, ENTER_WAIT_MS));
    Promise.race([loading, cap]).then(() => resume(true));
  }
  // final: every dataset in, or the time is up: the usual choice.
  function resume(final) {
    if (!waiting) return;
    const { serial, text, view } = waiting;
    if (serial !== submits || input.value !== text || navigations() !== view) waiting = null;
    else if (choose(text, !final && pending() !== null)) waiting = null;
  }

  input.addEventListener("input", () => {
    expanded = new Set();
    submits += 1;
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
      else if (input.value.trim().length >= 2) submit();
    } else if (event.key === "Escape") {
      submits += 1;
      if (isOpen) close();
      else input.value = "";
    } else {
      return;
    }
    event.preventDefault();
  });
  // A tap or click on an option (owner report 2026-10-01: tapping "Iqirvo" on a phone did not open
  // it). On a touch screen the input loses focus before the click even with pointerdown prevented,
  // and closing on that blur hid the list, so the click landed on the page below; and data arriving
  // between press and release rebuilt the list, so the click went to the listbox, not the option.
  // So: the list stays while an option is pressed (no close on blur, no rebuild), and the click is
  // handled on the listbox, finding the option under the pointer when its own target is gone.
  let pressing = false;
  const optionAt = (event) => {
    const target = event.target instanceof Element ? event.target.closest('[role="option"]') : null;
    if (target && listbox.contains(target)) return target;
    const under = document.elementFromPoint(event.clientX, event.clientY)?.closest('[role="option"]');
    return under && listbox.contains(under) ? under : null;
  };
  listbox.addEventListener("pointerdown", (event) => {
    if (!optionAt(event)) return;
    event.preventDefault(); // keep focus on the input (mouse)
    pressing = true;
  });
  listbox.addEventListener("click", (event) => {
    pressing = false;
    const item = optionAt(event);
    if (item) pick(Number(item.id.replace("lookup-opt-", "")));
  });
  // A press that ends without a click (a scroll of the list, a drag away): the list closes if the
  // field lost focus meanwhile, as a blur would have closed it.
  document.addEventListener("pointercancel", () => {
    if (!pressing) return;
    pressing = false;
    if (document.activeElement !== input) close();
  }, true);
  document.addEventListener("pointerdown", (event) => {
    if (!listbox.contains(event.target)) pressing = false;
  }, true);
  input.addEventListener("blur", () => {
    if (!pressing) close();
  });
  // Focused and empty: the viewer's recently viewed (none: nothing opens).
  input.addEventListener("focus", () => {
    if (input.value.trim() === "") renderList();
  });

  return {
    // New background data (conditions, drug classes) arrived: refresh an open list in place, or
    // show one for a query that had no matches yet. An open list keeps the groups and the active
    // option it shows where they are, new groups after them (keepShownOrder(); bug hunt 2026-10-01).
    refresh() {
      // An empty field shows the recently viewed list, which background data does not change: not
      // rebuilt (review 2026-09-29: it reset the active option and repeated the announcement).
      if (input.value.trim() === "") return;
      if (pressing) return; // rebuilt under a press, the click would miss its option
      resume(false); // an Enter waiting for this data (it closes the list when it opens a choice)
      if (!listbox.hidden) {
        const current = options[active];
        renderList({ keepOrder: true });
        const same = current ? options.findIndex((option) => option.listGroup === current.listGroup && option.value === current.value && option.action === current.action) : -1;
        if (same >= 0) setActive(same);
      } else if (requested && input.value.trim().length >= 2) renderList();
    },
    setText(text) {
      submits += 1;
      input.value = text;
      close();
    },
  };
}
