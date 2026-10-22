"use strict";

// Run with: npm run docs:screenshots
// Requires an installed TyranoBuilder skeleton; no runtime files are published.
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const assert = require("assert/strict");
const { createDemoProject } = require("./create-demo");
const { editorWebPreferences, secureWindow } = require("../lib/window-security");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tyranoforge-docs-"));
const projects = path.join(temp, "projects");
const data = path.join(temp, "editor-data");
const output = path.resolve(process.env.TYRANOFORGE_SCREENSHOTS_DIR || path.join(__dirname, "..", "docs", "screenshots"));
fs.mkdirSync(data, { recursive: true });
app.setPath("userData", path.join(temp, "electron-data"));
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("site-per-process");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let info, window, foreignWindow, foreignServer;

async function waitFor(expression, message, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await pause(100);
  }
  throw new Error(message);
}

app.whenReady().then(async () => {
  try {
    const project = createDemoProject(path.join(projects, "Blue Hour"));
    process.env.TYRANOFORGE_PROJECT = project;
    process.env.TYRANOFORGE_PROJECTS_ROOT = projects;
    process.env.TYRANOFORGE_DATA_DIR = data;
    const { startServer } = require("../server");
    info = await startServer({ port: 0 });
    window = new BrowserWindow({ width: 1680, height: 1050, show: true, webPreferences: { ...editorWebPreferences, backgroundThrottling: false } });
    const external = [];
    secureWindow(window, info, url => external.push(url));
    await window.loadURL(info.editorOrigin);
    await waitFor('typeof state !== "undefined" && Boolean(state.project && state.scenario)', "Editor did not initialize");
    await window.webContents.executeJavaScript('loadScenario("scene1.ks").then(() => activateView("editor"))');

    // Exercise actual browser requests, including the raw upload and blob icon paths.
    const savedText = fs.readFileSync(path.join(project, "data", "scenario", "scene1.ks"), "utf8");
    await window.webContents.executeJavaScript(`api("/api/scenario/save", {method:"POST", body:JSON.stringify({file:"scene1.ks", text:${JSON.stringify(savedText + "; browser-save-check\n")}, compact:true})})`);
    assert(fs.readFileSync(path.join(project, "data", "scenario", "scene1.ks"), "utf8").includes("browser-save-check"));
    await window.webContents.executeJavaScript(`api("/api/scenario/save", {method:"POST", body:JSON.stringify({file:"scene1.ks", text:${JSON.stringify(savedText)}, compact:true})})`);
    const uploadStatus = await window.webContents.executeJavaScript('fetch("/api/asset/upload?kind=bgimage&name=upload-check.png", {method:"POST", headers:sessionHeaders(), body:Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII="), c => c.charCodeAt(0))}).then(r => r.status)');
    assert.equal(uploadStatus, 200);
    fs.unlinkSync(path.join(project, "data", "bgimage", "upload-check.png"));
    await window.webContents.executeJavaScript(`(async () => {
      const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII="), c => c.charCodeAt(0));
      const response = await fetch("/api/build/icon?name=test.png", {method:"POST", headers:sessionHeaders(), body:bytes});
      if (!response.ok) throw new Error("Icon upload failed");
      await activateView("build");
    })()`);
    await waitFor('Boolean(document.querySelector("#buildIconPreview")?.naturalWidth)', "Authenticated icon preview failed");
    await window.webContents.executeJavaScript('api("/api/build/icon?clear=1", {method:"POST"})');

    // A web page on another origin cannot write, even with a simple POST.
    foreignServer = http.createServer((_req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<title>Access regression</title>"); });
    await new Promise(resolve => foreignServer.listen(0, "127.0.0.1", resolve));
    foreignWindow = new BrowserWindow({ show: false, webPreferences: editorWebPreferences });
    await foreignWindow.loadURL(`http://127.0.0.1:${foreignServer.address().port}`);
    await foreignWindow.webContents.executeJavaScript(`fetch(${JSON.stringify(info.editorOrigin + "/api/scenario/save")}, {method:"POST", headers:{"Content-Type":"text/plain"}, body:JSON.stringify({file:"scene1.ks",text:"unexpected browser write"})}).then(() => false, () => true)`);
    assert.equal(fs.readFileSync(path.join(project, "data", "scenario", "scene1.ks"), "utf8"), savedText);
    foreignWindow.destroy(); foreignWindow = null;
    await new Promise(resolve => foreignServer.close(resolve)); foreignServer = null;

    await window.webContents.executeJavaScript('loadAll().then(() => loadScenario("scene1.ks")).then(() => activateView("editor")).then(() => startPreview())');
    await waitFor('previewBridgeReady && state.previewStarted && !state.previewBootingSince', "Preview did not initialize");
    await pause(1500);
    const frame = window.webContents.mainFrame.framesInSubtree.find(frame => frame.url.startsWith(info.previewOrigin + "/project/"));
    assert(frame, "Preview frame missing");
    const denied = await frame.executeJavaScript('fetch("/api/scenario/save", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({file:"scene1.ks",text:"unexpected preview write"})}).then(r => r.status)');
    assert.equal(denied, 403);
    assert.equal(fs.readFileSync(path.join(project, "data", "scenario", "scene1.ks"), "utf8"), savedText);
    assert.equal(await frame.executeJavaScript('typeof require'), "undefined");
    assert.equal(await frame.executeJavaScript(`fetch(${JSON.stringify(info.editorOrigin + "/")}).then(() => false, () => true)`), true);
    const prefs = window.webContents.getLastWebPreferences();
    assert(prefs.sandbox && prefs.contextIsolation && !prefs.nodeIntegration);
    assert.notEqual(frame.processId, window.webContents.mainFrame.processId);

    fs.mkdirSync(output, { recursive: true });
    async function capture(name, view) {
      await window.webContents.executeJavaScript(`activateView(${JSON.stringify(view)})`);
      if (view === "assets") await waitFor('document.querySelectorAll("#assetGrid img").length === 3 && [...document.querySelectorAll("#assetGrid img")].every(img => img.complete && img.naturalWidth > 0)', "Demo thumbnails failed");
      await pause(550);
      fs.writeFileSync(path.join(output, name + ".png"), (await window.webContents.capturePage()).toPNG());
    }
    await capture("editor", "editor");
    await capture("assets", "assets");
    await capture("flow", "flow");
    await capture("ks-editor", "code");
    await capture("diagnostics", "diagnostics");
    await capture("build", "build");

    // Test the production navigation handler without opening an external browser.
    await window.webContents.executeJavaScript('window.location.href = "https://example.com/untrusted"');
    await pause(250);
    assert.equal(window.webContents.getURL(), info.editorOrigin + "/");
    await window.webContents.executeJavaScript('window.open("javascript:alert(1)"); window.open("http://localhost.attacker.example/")');
    await pause(250);
    assert.deepEqual(external, ["http://localhost.attacker.example/"]);
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    console.log("PASS: browser save, upload, icon, cross-origin rejection, preview isolation, thumbnails, and navigation");
    console.log("Created six screenshots from the Blue Hour demo.");
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});

app.on("quit", () => {
  if (info?.server.listening) info.server.close();
  if (foreignServer?.listening) foreignServer.close();
  fs.rmSync(temp, { recursive: true, force: true });
});
