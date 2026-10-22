"use strict";

const { allowedNavigation, externalWebUrl } = require("./navigation");
const editorWebPreferences = { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false };

function secureWindow(window, serverInfo, openExternal) {
  const contents = window.webContents;
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
  const restrictNavigation = event => {
    if (!allowedNavigation(event.url, event.isMainFrame, serverInfo)) event.preventDefault();
  };
  contents.on("will-frame-navigate", restrictNavigation);
  contents.on("will-redirect", restrictNavigation);
  contents.setWindowOpenHandler(({ url }) => {
    if (externalWebUrl(url) && ![serverInfo.editorOrigin, serverInfo.previewOrigin].includes(new URL(url).origin)) {
      Promise.resolve(openExternal(url)).catch(() => {});
    }
    return { action: "deny" };
  });
}

module.exports = { editorWebPreferences, secureWindow };
