// Link icons, and the marking of links to other websites: every one (https only, a new tab, no
// opener or referrer) shows an arrow-out-of-a-box icon and names its destination, after the link
// text for screen readers and as its tooltip (UI.external). Icons are inline SVG (aria-hidden).
import { UI } from "./labels.js";

const SVG = "http://www.w3.org/2000/svg";

// Pure: "https://www.ema.europa.eu/..." -> { name: "EMA website", host: "www.ema.europa.eu" }; a
// host without a name is named by itself.
export function destinationOf(url) {
  const { host } = new URL(url);
  return { name: UI.external.destinations[host] ?? host, host };
}

function icon(className, paths) {
  const svg = document.createElementNS(SVG, "svg");
  for (const [name, value] of Object.entries({ class: className, viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false" })) {
    svg.setAttribute(name, value);
  }
  for (const d of paths) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

// An arrow out of a box: the link leaves this site.
const externalIcon = () => icon("link-icon", ["M9.5 2.5h4v4", "M13.5 2.5 7.5 8.5", "M11.5 9.5v4h-9v-9h4"]);

// A chevron: the link opens a page of this site (a condition page).
export const openIcon = () => icon("link-icon", ["M6 3.5 10.5 8 6 12.5"]);

// anchor: an <a> to another website. Adds the icon (at the end of iconParent, the anchor itself
// by default), the destination for screen readers (after its aria-label, else as visually hidden
// text) and as its tooltip.
export function markExternal(anchor, iconParent = anchor) {
  const { name, host } = destinationOf(anchor.href);
  const newTab = UI.external.newTab(name);
  iconParent.append(externalIcon());
  const label = anchor.getAttribute("aria-label");
  if (label) {
    anchor.setAttribute("aria-label", `${label} ${newTab}`);
  } else {
    const hidden = document.createElement("span");
    hidden.className = "visually-hidden";
    hidden.textContent = ` ${newTab}`;
    anchor.append(hidden);
  }
  anchor.title = UI.external.title(name, host);
  anchor.classList.add("external");
  return anchor;
}
