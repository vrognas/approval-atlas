// The colour theme (owner request 2026-09-28): Auto (the default: the device's scheme), Light or
// Dark, from the header's theme button, kept per viewer in localStorage (every access wrapped; the
// page works without it). A chosen theme is data-theme on <html>, which style.css's dark tokens
// follow; the color-scheme and theme-color meta tags follow it too. public/theme-init.js sets all
// three before the first paint (this module runs after it, and keeps them in step).
import { UI } from "./labels.js";

export const THEME_STORAGE_KEY = "approval-atlas:theme";
const CHOSEN = ["light", "dark"];
const SVG = "http://www.w3.org/2000/svg";

// Pure: the viewer's stored theme; Auto when nothing (or anything else) is stored, or storage is
// missing or blocked. public/theme-init.js reads it the same way.
export function readTheme(storage) {
  try {
    const theme = storage?.getItem(THEME_STORAGE_KEY);
    return CHOSEN.includes(theme) ? theme : "auto";
  } catch {
    return "auto";
  }
}

export function storeTheme(storage, theme) {
  try {
    if (CHOSEN.includes(theme)) storage?.setItem(THEME_STORAGE_KEY, theme);
    else storage?.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Blocked storage: the theme lasts for this visit only.
  }
}

// Pure: the theme after a press. From Auto the scheme the device is not showing, so the first press
// always changes the page; then the device's own; then Auto again.
export function nextTheme(theme, deviceDark) {
  const device = deviceDark ? "dark" : "light";
  const other = deviceDark ? "light" : "dark";
  if (theme === "auto") return other;
  return theme === other ? device : "auto";
}

// Pure: the content of each theme-color meta tag (metas: index.html's, { media, content }, one per
// device scheme): its own under Auto, else the chosen scheme's tag's, whatever the device's.
export function themeColors(metas, theme) {
  const chosen = metas.find((meta) => meta.media.includes(`prefers-color-scheme: ${theme}`));
  return metas.map((meta) => (chosen ? chosen.content : meta.content));
}

// Pure: the color-scheme meta tag's content.
export const colorSchemeContent = (theme) => (CHOSEN.includes(theme) ? theme : "light dark");

// Icons (16px grid, stroked in the text colour): a sun, a crescent moon, and a half-filled circle
// for Auto (either scheme).
const ICONS = {
  light: { stroked: ["M8 5.25a2.75 2.75 0 1 0 0 5.5a2.75 2.75 0 1 0 0-5.5z", "M8 1.25v1.5", "M8 13.25v1.5", "M1.25 8h1.5", "M13.25 8h1.5", "M3.23 3.23l1.06 1.06", "M11.71 11.71l1.06 1.06", "M3.23 12.77l1.06-1.06", "M11.71 4.29l1.06-1.06"] },
  dark: { stroked: ["M14 8.53A6 6 0 1 1 7.47 2a4.67 4.67 0 0 0 6.53 6.53z"] },
  auto: { stroked: ["M8 2a6 6 0 1 0 0 12a6 6 0 1 0 0-12z"], filled: ["M8 2a6 6 0 0 0 0 12z"] },
};

function themeIcon(theme) {
  const svg = document.createElementNS(SVG, "svg");
  for (const [name, value] of Object.entries({ class: "theme-icon", viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false" })) {
    svg.setAttribute(name, value);
  }
  const path = (d, className = null) => {
    const element = document.createElementNS(SVG, "path");
    element.setAttribute("d", d);
    if (className) element.setAttribute("class", className);
    return element;
  };
  const { stroked, filled = [] } = ICONS[theme];
  svg.append(...stroked.map((d) => path(d)), ...filled.map((d) => path(d, "theme-icon-fill")));
  return svg;
}

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

// button: index.html #theme-toggle. Applies the stored theme at once (as theme-init.js has before
// the first paint) and draws the button. onChange(): after a press.
export function createThemeToggle(button, { onChange = () => {} } = {}) {
  const root = document.documentElement;
  const storage = browserStorage();
  const device = window.matchMedia("(prefers-color-scheme: dark)");
  const colorScheme = document.querySelector('meta[name="color-scheme"]');
  const themeColorTags = [...document.querySelectorAll('meta[name="theme-color"]')];
  // The tags as index.html has them, for Auto (theme-init.js keeps their colours in
  // data-device-content when it has set a chosen theme's).
  const metas = themeColorTags.map((tag) => ({ media: tag.media, content: tag.dataset.deviceContent ?? tag.content }));
  let theme = readTheme(storage);

  function apply() {
    if (CHOSEN.includes(theme)) root.dataset.theme = theme;
    else delete root.dataset.theme;
    colorScheme?.setAttribute("content", colorSchemeContent(theme));
    themeColors(metas, theme).forEach((content, index) => themeColorTags[index].setAttribute("content", content));
    button.replaceChildren(themeIcon(theme));
    button.setAttribute("aria-label", UI.theme.button(theme));
    button.title = UI.theme.hint(theme, nextTheme(theme, device.matches));
  }

  button.addEventListener("click", () => {
    theme = nextTheme(theme, device.matches);
    storeTheme(storage, theme);
    apply();
    onChange();
  });
  // The next theme depends on the device's scheme (the tooltip says it).
  device.addEventListener("change", apply);
  apply();
}
