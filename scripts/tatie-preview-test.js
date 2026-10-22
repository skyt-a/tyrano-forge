"use strict";

const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert/strict");
const { createDemoProject } = require("./create-demo");
const { TATIE_SETTINGS_REL } = require("../lib/tyrano-tatie");
const { editorWebPreferences, secureWindow } = require("../lib/window-security");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tyranoforge-tatie-preview-"));
app.setPath("userData", path.join(temp, "browser-data"));
app.commandLine.appendSwitch("site-per-process");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let window, info;

async function waitFor(expression, description) {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await pause(100);
  }
  throw new Error(description);
}

app.whenReady().then(async () => {
  let code = 0;
  try {
    const project = createDemoProject(path.join(temp, "projects", "Tatie Preview"));
    const data = path.join(temp, "editor-data");
    fs.mkdirSync(data);
    for (const [variant, color] of [["normal", "#eba95b"], ["alt", "#74adca"]]) {
      fs.writeFileSync(path.join(project, "data", "fgimage", `guide-${variant}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="160"><rect x="10" y="60" width="60" height="90" rx="12" fill="${color}"/><circle cx="40" cy="36" r="26" fill="${color}"/></svg>`);
    }
    const settings = { schemaVersion: 2, defaultCharacter: "guide", characters: {
      guide: { defaultAppearance: "default", appearances: { default: { variants: Object.fromEntries(["normal", "alt"].map(variant => [variant, {
        storage: `guide-${variant}.svg`, frame: { width: 80, height: 160, positions: { center: { left: 100, top: 80 } } },
      }])) } } },
    } };
    fs.writeFileSync(path.join(project, TATIE_SETTINGS_REL), `window.TYRANO_TATIE_SETTINGS = ${JSON.stringify(settings)};\n`);
    fs.writeFileSync(path.join(project, "data", "scenario", "system", "chara_define.ks"), '[chara_new name="guide" jname="Guide" storage="guide-normal.svg"]\n[return]\n');
    fs.writeFileSync(path.join(project, "data", "scenario", "scene1.ks"), '[bg storage="harbor.svg" time="1"]\n[tatie name="guide" appearance="default" variant="normal" position="center" mode="show" time="1" wait="true"]\n[s]\n');
    process.env.TYRANOFORGE_PROJECT = project;
    process.env.TYRANOFORGE_PROJECTS_ROOT = path.dirname(project);
    process.env.TYRANOFORGE_DATA_DIR = data;
    const { startServer } = require("../server");
    info = await startServer({ port: 0 });
    window = new BrowserWindow({ width: 1400, height: 900, show: true, webPreferences: { ...editorWebPreferences, backgroundThrottling: false } });
    secureWindow(window, info, () => {});
    await window.loadURL(info.editorOrigin);
    await waitFor('typeof state !== "undefined" && Boolean(state.project && state.scenario)', "Editor failed to initialize");
    await window.webContents.executeJavaScript('loadScenario("scene1.ks").then(() => startPreview())');
    await waitFor('previewBridgeReady && state.previewStarted && !state.previewBootingSince', "Preview bridge did not initialize");
    const frame = window.webContents.mainFrame.framesInSubtree.find(frame => frame.url.startsWith(info.previewOrigin + "/project/"));
    assert(frame);
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (await frame.executeJavaScript('Boolean(window.TyranoTatie && TYRANO.kag.stat.charas.guide?.tatie_variant === "normal" && document.querySelector(".tyrano_chara[data-tatie-variant]"))')) { ready = true; break; }
      await pause(100);
    }
    assert(ready, "Tatie character did not appear");
    const snapshot = () => window.webContents.executeJavaScript('requestLivePreview({type:"layout-snapshot"})');
    let response = await snapshot();
    assert(response.ok);
    assert.equal(response.result.boxes.length, 1);
    assert.equal(response.result.boxes[0].name, "guide");
    await frame.executeJavaScript('document.querySelector(".tyrano_chara[data-tatie-variant]").classList.remove("guide")');
    response = await snapshot();
    assert.equal(response.result.boxes[0].name, "guide", "Tatie runtime fallback did not identify the character");
    await frame.executeJavaScript('document.querySelector(".tyrano_chara[data-tatie-variant]").classList.add("guide")');
    await window.webContents.executeJavaScript(`(async () => {
      state.layoutEdit = true;
      await refreshPreviewBoxes();
      const box = state.previewBoxes.find(box => box.name === "guide");
      if (!box) throw new Error("Layout box missing");
      box.game.left = 137; box.game.top = 96; box.dirty = true;
      await savePreviewLayout();
    })()`);
    const { loadTatieSettings } = require("../lib/project");
    const position = loadTatieSettings(project).characters.guide.appearances.default.variants.normal.frame.positions.center;
    assert.deepEqual(position, { left: 137, top: 96 });
    const css = await frame.executeJavaScript('(() => { const style = getComputedStyle(document.querySelector(".tyrano_chara[data-tatie-variant]")); return {left:parseFloat(style.left),top:parseFloat(style.top)}; })()');
    assert.deepEqual(css, position);
    await frame.executeJavaScript('new Promise(resolve => { const ok = TyranoTatie.render(TYRANO.kag, {name:"guide",appearance:"default",variant:"alt",position:"center",time:"1",mode:"mod"}, {onStart(){},onComplete(){resolve(true)}}); if (!ok) resolve(false); })');
    response = await snapshot();
    assert.equal(response.result.boxes[0].name, "guide");
    assert.equal(response.result.boxes[0].variant, "alt");
    console.log("PASS: Tatie v0.2.0 preview, runtime identification, layout save/live update, and variant switch");
  } catch (error) {
    console.error(error);
    code = 1;
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    if (info?.server.listening) await new Promise(resolve => info.server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
    app.exit(code);
  }
});
