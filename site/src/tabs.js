// APG tabs, automatic activation (views render from in-memory data, no latency).
// Markup is static in index.html: role=tablist > button[role=tab][aria-controls], section[role=tabpanel].
export function initTabs(tablist, onSelect) {
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  tablist.addEventListener("click", (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) onSelect(tab.dataset.view);
  });
  tablist.addEventListener("keydown", (event) => {
    const index = tabs.indexOf(document.activeElement);
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (index < 0 || next === undefined) return;
    event.preventDefault();
    const tab = tabs[(next + tabs.length) % tabs.length];
    tab.focus();
    onSelect(tab.dataset.view);
  });
  // Called from the render loop: state.view is the only source of truth.
  return function renderTabs(view) {
    for (const tab of tabs) {
      const selected = tab.dataset.view === view;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
    }
  };
}
