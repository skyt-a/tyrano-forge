"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { editorWebPreferences, secureWindow } = require("../lib/window-security");
const { prepareStartupProject } = require("../lib/startup-project");

const SMOKE = process.argv.includes("--smoke");
const SMOKE_PREVIEW = (process.argv.find((arg) => arg.startsWith("--smoke-preview=")) || "").split("=")[1] || "";
const smokeDataRoot = SMOKE ? (process.env.TYRANOFORGE_SMOKE_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "tyranoforge-smoke-"))) : "";
if (SMOKE) {
  fs.mkdirSync(smokeDataRoot, { recursive: true });
  app.setPath("userData", smokeDataRoot);
}
function smokeCheckpoint(phase) {
  if (SMOKE && process.env.TYRANOFORGE_SMOKE_RESULT_FILE) {
    fs.writeFileSync(process.env.TYRANOFORGE_SMOKE_RESULT_FILE, JSON.stringify({ ready: false, phase }));
  }
}
smokeCheckpoint("starting");

// パッケージ版では書き込みデータ (backups / export / 設定) を userData へ
const DATA_ROOT = smokeDataRoot || (app.isPackaged
  ? app.getPath("userData")
  : path.join(__dirname, ".."));
process.env.TYRANOFORGE_DATA_DIR = DATA_ROOT;

// TyranoBuilder 本体と同様、プレビューの音声自動再生制限を無効化する。
// これが有効だと Tyrano ランタイムが AudioContext のサスペンドで停止することがある。
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
// preview は localhost、エディタは 127.0.0.1 で読み込み、異なる site の iframe
// を必ず別 renderer process (OOPIF) に置く。
app.commandLine.appendSwitch("site-per-process");

let mainWindow = null;
let serverInfo = null;

if (!SMOKE) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    });
  }
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about", label: "TyranoForge について" },
        { type: "separator" },
        { role: "hide", label: "隠す" },
        { role: "hideOthers", label: "ほかを隠す" },
        { role: "unhide", label: "すべて表示" },
        { type: "separator" },
        { role: "quit", label: "TyranoForge を終了" },
      ],
    },
    {
      label: "ファイル",
      submenu: [
        {
          label: "書き出しフォルダを開く",
          click: () => {
            shell.openPath(path.join(DATA_ROOT, "export")).catch(() => {});
          },
        },
        { type: "separator" },
        { role: "close", label: "ウィンドウを閉じる" },
      ],
    },
    {
      label: "編集",
      submenu: [
        { role: "undo", label: "取り消す" },
        { role: "redo", label: "やり直す" },
        { type: "separator" },
        { role: "cut", label: "カット" },
        { role: "copy", label: "コピー" },
        { role: "paste", label: "ペースト" },
        { role: "selectAll", label: "すべてを選択" },
      ],
    },
    {
      label: "表示",
      submenu: [
        { role: "reload", label: "再読み込み" },
        { role: "forceReload", label: "強制再読み込み" },
        { type: "separator" },
        { role: "resetZoom", label: "実際のサイズ" },
        { role: "zoomIn", label: "拡大" },
        { role: "zoomOut", label: "縮小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "フルスクリーン" },
        { role: "toggleDevTools", label: "開発者ツール" },
      ],
    },
    {
      label: "ウィンドウ",
      submenu: [
        { role: "minimize", label: "しまう" },
        { role: "zoom", label: "拡大/縮小" },
        { type: "separator" },
        { role: "front", label: "すべてを手前に移動" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 1020,
    minWidth: 1120,
    minHeight: 720,
    title: "TyranoForge",
    backgroundColor: "#0e1014",
    show: false,
    webPreferences: editorWebPreferences,
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  // 終了前に未保存の自動保存キューをフラッシュする
  let allowClose = false;
  let closeInProgress = false;
  mainWindow.on("close", (event) => {
    if (allowClose) return;
    event.preventDefault();
    if (closeInProgress) return;
    closeInProgress = true;
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("保存が8秒以内に完了しませんでした")), 8000);
    });
    Promise.race([
      mainWindow.webContents.executeJavaScript(
        'typeof flushPendingEdits === "function" ? Promise.resolve(flushPendingEdits()).then(() => true) : true',
        true,
      ),
      timeout,
    ]).then(() => {
      allowClose = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    }).catch(async (error) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try {
        const choice = await dialog.showMessageBox(mainWindow, {
          type: "warning",
          title: "未保存の編集があります",
          message: "KSの保存に失敗したため、終了を中止しました。",
          detail: `${error?.message || error}\n\n編集に戻って再保存するか、内容を破棄して終了してください。`,
          buttons: ["編集に戻る", "保存せず終了"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (choice.response === 1) {
          allowClose = true;
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
          return;
        }
      } catch (dialogError) {
        console.error("Failed to show unsaved-edit warning:", dialogError);
      }
      closeInProgress = false;
    });
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  secureWindow(mainWindow, serverInfo, url => shell.openExternal(url));

  smokeCheckpoint("loading-editor");
  mainWindow.loadURL(`http://127.0.0.1:${serverInfo.port}/`);

  if (SMOKE) {
    mainWindow.webContents.once("did-finish-load", async () => {
      try {
        // フロントの起動完了（プロジェクト読み込み済み）を待って検証
        const result = await mainWindow.webContents.executeJavaScript(`
          new Promise((resolve) => {
            const started = Date.now();
            const timer = setInterval(() => {
              const ready = typeof state !== "undefined" && state.project && state.scenarios.length > 0;
              if (ready || Date.now() - started > 15000) {
                clearInterval(timer);
                resolve({
                  ready: Boolean(ready),
                  project: state?.project?.projectRoot || "",
                  scenarios: state?.scenarios?.length || 0,
                  view: document.body.dataset.view || "",
                });
              }
            }, 200);
          })
        `);
        if (result.ready && process.env.TYRANOFORGE_SMOKE_EXPORT === "1") {
          smokeCheckpoint("exporting-game-zip");
          const exported = await mainWindow.webContents.executeJavaScript('api("/api/build", {method:"POST", body:JSON.stringify({target:"browser", zip:true})})');
          result.exportReady = Boolean(exported.ok && exported.zipPath && fs.statSync(exported.zipPath).size > 0);
        }
        console.log("SMOKE_RESULT " + JSON.stringify(result));
        if (process.env.TYRANOFORGE_SMOKE_RESULT_FILE) {
          fs.writeFileSync(process.env.TYRANOFORGE_SMOKE_RESULT_FILE, JSON.stringify(result));
        }
        if (!SMOKE_PREVIEW) {
          app.exit(result.ready ? 0 : 1);
          return;
        }
        // --smoke-preview=file.ks:line — 指定行からのプレビュー起動を検証
        const [previewFile, previewLine] = SMOKE_PREVIEW.split(":");
        const previewResult = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const file = ${JSON.stringify(String(previewFile || ""))};
            const line = ${Number(previewLine) || 0};
            if (state.currentFile !== file) await loadScenario(file, { line });
            selectTimelineLine(line);
            const frame = document.querySelector("#previewFrame");
            const expectedOrigin = previewOrigin();
            const started = Date.now();
            const playback = await new Promise((resolve) => {
              let latest = {};
              function finish(arrived) {
                clearTimeout(timer);
                window.removeEventListener("message", onMessage);
                resolve({
                  arrived: Boolean(arrived),
                  effectiveLine: Number(latest.currentLine ?? -1),
                  scenario: String(latest.currentScenario || ""),
                  previewOrigin: expectedOrigin,
                  previewUrl: frame.src,
                  elapsedMs: Date.now() - started,
                });
              }
              function onMessage(event) {
                if (event.source !== frame.contentWindow || event.origin !== expectedOrigin) return;
                const data = event.data || {};
                if (data.source !== "tyranoforge-preview") return;
                latest = data;
                const storage = normalizePreviewScenario(data.currentScenario);
                const arrived = !Number(data.booting) && storage === file && Number(data.currentLine) >= line;
                if (arrived) finish(true);
              }
              window.addEventListener("message", onMessage);
              const timer = setTimeout(() => finish(false), 25000);
              startPreview("", line);
            });
            const layout = await requestLivePreview({ type: "layout-snapshot" });
            const noMatchBox = {
              name: "__tyranoforge_smoke_no_match__",
              appearance: "__tyranoforge_smoke_no_match__",
              variant: "__tyranoforge_smoke_no_match__",
              position: "center",
              left: 0,
              top: 0,
            };
            const placement = await requestLivePreview({
              type: "layout-position",
              box: noMatchBox,
            });
            const resized = await requestLivePreview({ type: "resize" });
            let commandReplies = 0;
            function countCommandReply(event) {
              if (event.source !== frame.contentWindow || event.origin !== expectedOrigin) return;
              const data = event.data || {};
              if (data.source === "tyranoforge-live-result" && !data.requestId) commandReplies += 1;
            }
            window.addEventListener("message", countCommandReply);
            const placementCommandSent = sendPreviewCommand({ type: "layout-position", box: noMatchBox });
            const resizeCommandSent = sendPreviewCommand({ type: "resize" });
            // 同じ WindowProxy への postMessage は順序を保つ。後続 request の応答を
            // barrier にして、requestId なし command が処理済みかつ無応答と確認する。
            const commandBarrier = await requestLivePreview({ type: "layout-snapshot" });
            await new Promise((resolve) => setTimeout(resolve, 50));
            window.removeEventListener("message", countCommandReply);
            return {
              ...playback,
              layoutBridge: Boolean(layout.ok && layout.result?.metrics),
              layoutBoxes: layout.ok ? Number(layout.result?.boxes?.length || 0) : -1,
              placementBridge: Boolean(placement.ok && placement.result?.updated === 0),
              resizeBridge: Boolean(resized.ok && resized.result?.resized),
              commandNoReply: Boolean(
                placementCommandSent &&
                resizeCommandSent &&
                commandBarrier.ok &&
                commandReplies === 0
              ),
            };
          })()
        `);
        const editorFrame = mainWindow.webContents.mainFrame;
        const previewFrame = editorFrame.framesInSubtree.find((frame) => {
          try {
            const frameUrl = new URL(frame.url);
            return frameUrl.hostname === "localhost" && frameUrl.pathname === "/project/__editor_preview.html";
          } catch (error) {
            return false;
          }
        });
        previewResult.editorProcessId = editorFrame.processId;
        previewResult.editorOsProcessId = editorFrame.osProcessId;
        previewResult.previewProcessId = previewFrame?.processId || -1;
        previewResult.previewOsProcessId = previewFrame?.osProcessId || -1;
        previewResult.isolated = Boolean(
          previewFrame &&
          previewFrame.processId !== editorFrame.processId &&
          previewFrame.osProcessId !== editorFrame.osProcessId
        );
        console.log("SMOKE_PREVIEW_RESULT " + JSON.stringify(previewResult));
        app.exit(
          result.ready &&
          previewResult.arrived &&
          previewResult.layoutBridge &&
          previewResult.placementBridge &&
          previewResult.resizeBridge &&
          previewResult.commandNoReply &&
          previewResult.isolated
            ? 0
            : 1,
        );
      } catch (error) {
        console.error("SMOKE_ERROR", error.message || error);
        app.exit(1);
      }
    });
  }
}

app.whenReady().then(async () => {
  smokeCheckpoint("app-ready");
  try {
    const loadServer = () => require(path.join(__dirname, "..", "server.js"));
    const serverModule = SMOKE ? loadServer() : await prepareStartupProject({
      loadServer,
      dataRoot: DATA_ROOT,
      chooseDirectory: async () => {
        const result = await dialog.showOpenDialog({
          title: "編集するプロジェクトを選択",
          message: "TyranoBuilder / TyranoScript のプロジェクトフォルダーを選んでください。",
          buttonLabel: "このプロジェクトを開く",
          properties: ["openDirectory"],
        });
        return result.canceled ? null : result.filePaths[0];
      },
      showInvalidProject: () => dialog.showMessageBox({
        type: "info", title: "プロジェクトを確認してください",
        message: "TyranoBuilder / TyranoScript のプロジェクトフォルダーを選んでください。",
        buttons: ["選び直す"],
      }),
    });
    if (!serverModule) { app.quit(); return; }
    serverInfo = await serverModule.startServer({ port: 0 });
  } catch (error) {
    console.error("server start failed:", error.message || error);
    app.exit(1);
    return;
  }
  smokeCheckpoint("server-ready");
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverInfo) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("quit", () => {
  // Chromium may still hold its files during quit on Windows. The parent
  // package verifier cleans its temporary directory after the process exits.
  if (smokeDataRoot) {
    try { fs.rmSync(smokeDataRoot, { recursive: true, force: true }); } catch {}
  }
});
