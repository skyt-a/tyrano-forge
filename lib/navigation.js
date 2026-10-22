"use strict";

function allowedNavigation(value, isMainFrame, serverInfo) {
  if (!isMainFrame && value === "about:blank") return true;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return isMainFrame
      ? url.origin === serverInfo.editorOrigin && ["/", "/index.html"].includes(url.pathname)
      : url.origin === serverInfo.previewOrigin && url.pathname.startsWith("/project/");
  } catch { return false; }
}

function externalWebUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

module.exports = { allowedNavigation, externalWebUrl };
