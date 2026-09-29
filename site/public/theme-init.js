// Before the first paint (a classic script in index.html's <head>: same origin, as the CSP allows
// no inline script; a module would run after the first paint): the viewer's chosen theme, so a page
// set to Light or Dark never shows the device's scheme first, nor does the browser's toolbar. As
// src/theme.js does afterwards (it reads the same key): data-theme on <html>, the chosen scheme's
// theme-color on every theme-color tag (each keeps its own in data-device-content, for Auto) and
// the color-scheme tag. Auto (nothing stored) leaves the page as it is; storage can be missing or
// blocked. The service worker answers this file from its cache at once (sw.js).
try {
  const theme = window.localStorage.getItem("approval-atlas:theme");
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
    const tags = [...document.querySelectorAll('meta[name="theme-color"]')];
    const color = tags.find((tag) => tag.media.includes(`prefers-color-scheme: ${theme}`))?.content;
    for (const tag of tags) {
      tag.dataset.deviceContent = tag.content;
      if (color) tag.content = color;
    }
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme);
  }
} catch {
  // Blocked storage: Auto.
}
