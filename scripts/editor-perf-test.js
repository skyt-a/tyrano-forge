"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { listScenarios } = require("../lib/project");
const { config } = require("../server");

const EDITOR_ROOT = path.resolve(__dirname, "..");
const DEFAULT_LIMITS = {
  coldOpenMs: 750,
  highlightReadyMs: 1500,
  jumpP95Ms: 75,
  jumpFrameP95Ms: 110,
  jumpBackP95Ms: 100,
  inputP95Ms: 30,
  inputFrameP95Ms: 55,
  pasteP95Ms: 50,
  pasteFrameP95Ms: 80,
  scrollP95Ms: 50,
  scrollFrameP95Ms: 55,
  driftRatio: 2,
  domNodes: 160,
  scrollDeltaPx: 1,
  autosaveMs: 6000,
  autosaveBytes: 64 * 1024,
  heapGrowthBytes: 128 * 1024 * 1024,
};

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function limitsFromEnv() {
  return {
    coldOpenMs: envNumber("EDITOR_PERF_MAX_COLD_MS", DEFAULT_LIMITS.coldOpenMs),
    highlightReadyMs: envNumber("EDITOR_PERF_MAX_HIGHLIGHT_MS", DEFAULT_LIMITS.highlightReadyMs),
    jumpP95Ms: envNumber("EDITOR_PERF_MAX_JUMP_P95_MS", DEFAULT_LIMITS.jumpP95Ms),
    jumpFrameP95Ms: envNumber("EDITOR_PERF_MAX_JUMP_FRAME_P95_MS", DEFAULT_LIMITS.jumpFrameP95Ms),
    jumpBackP95Ms: envNumber("EDITOR_PERF_MAX_JUMP_BACK_P95_MS", DEFAULT_LIMITS.jumpBackP95Ms),
    inputP95Ms: envNumber("EDITOR_PERF_MAX_INPUT_P95_MS", DEFAULT_LIMITS.inputP95Ms),
    inputFrameP95Ms: envNumber("EDITOR_PERF_MAX_INPUT_FRAME_P95_MS", DEFAULT_LIMITS.inputFrameP95Ms),
    pasteP95Ms: envNumber("EDITOR_PERF_MAX_PASTE_P95_MS", DEFAULT_LIMITS.pasteP95Ms),
    pasteFrameP95Ms: envNumber("EDITOR_PERF_MAX_PASTE_FRAME_P95_MS", DEFAULT_LIMITS.pasteFrameP95Ms),
    scrollP95Ms: envNumber("EDITOR_PERF_MAX_SCROLL_P95_MS", DEFAULT_LIMITS.scrollP95Ms),
    scrollFrameP95Ms: envNumber("EDITOR_PERF_MAX_SCROLL_FRAME_P95_MS", DEFAULT_LIMITS.scrollFrameP95Ms),
    driftRatio: envNumber("EDITOR_PERF_MAX_DRIFT_RATIO", DEFAULT_LIMITS.driftRatio),
    domNodes: envNumber("EDITOR_PERF_MAX_DOM_NODES", DEFAULT_LIMITS.domNodes),
    scrollDeltaPx: envNumber("EDITOR_PERF_MAX_SCROLL_DELTA_PX", DEFAULT_LIMITS.scrollDeltaPx),
    autosaveMs: envNumber("EDITOR_PERF_MAX_AUTOSAVE_MS", DEFAULT_LIMITS.autosaveMs),
    autosaveBytes: envNumber("EDITOR_PERF_MAX_AUTOSAVE_BYTES", DEFAULT_LIMITS.autosaveBytes),
    heapGrowthBytes: envNumber("EDITOR_PERF_MAX_HEAP_GROWTH_BYTES", DEFAULT_LIMITS.heapGrowthBytes),
  };
}

function ensurePreviewCopy(source, target) {
  if (!fs.existsSync(source) || fs.existsSync(target)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, dereference: true });
  return true;
}

function copyIfPresent(source, target) {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
}

function selectScenario(projectRoot) {
  const scenarios = listScenarios(projectRoot);
  if (!scenarios.length) throw new Error(`No KS files found under ${projectRoot}`);
  const requested = String(process.env.EDITOR_PERF_FILE || "");
  if (requested) {
    const exact = scenarios.find((item) => item.storage === requested);
    if (!exact) throw new Error(`EDITOR_PERF_FILE was not found: ${requested}`);
    return exact;
  }
  return scenarios.reduce((largest, item) =>
    item.lineCount > largest.lineCount ||
    (item.lineCount === largest.lineCount && item.size > largest.size)
      ? item
      : largest,
  );
}

function makeFixture(tempRoot, projectRoot, scenario) {
  const fixtureRoot = path.join(tempRoot, "project");
  const dataRoot = path.join(tempRoot, "editor-data");
  const userDataRoot = path.join(tempRoot, "electron-user-data");
  const fixtureScenario = path.join(fixtureRoot, "data", "scenario", scenario.storage);
  fs.mkdirSync(path.dirname(fixtureScenario), { recursive: true });
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(userDataRoot, { recursive: true });

  const sourceIndex = path.join(projectRoot, "index.html");
  if (!copyIfPresent(sourceIndex, path.join(fixtureRoot, "index.html"))) {
    fs.writeFileSync(path.join(fixtureRoot, "index.html"), "<!doctype html><title>KS performance fixture</title>\n");
  }
  fs.copyFileSync(path.join(projectRoot, "data", "scenario", scenario.storage), fixtureScenario);

  // Copy runtime/assets into the isolated fixture. External symlinks are not
  // exposed by the server, and autosave must never touch the source project.
  const previewLinks = [];
  previewLinks.push(ensurePreviewCopy(path.join(projectRoot, "tyrano"), path.join(fixtureRoot, "tyrano")));
  for (const dir of ["system", "others", "bgimage", "fgimage", "image", "bgm", "sound", "video"]) {
    previewLinks.push(ensurePreviewCopy(
      path.join(projectRoot, "data", dir),
      path.join(fixtureRoot, "data", dir),
    ));
  }
  if (!scenario.storage.startsWith("system/")) {
    previewLinks.push(ensurePreviewCopy(
      path.join(projectRoot, "data", "scenario", "system"),
      path.join(fixtureRoot, "data", "scenario", "system"),
    ));
  }
  for (const name of ["builder_config.json", "builder_config_deploy.json", "studio_config.json", "chara.builder.json"]) {
    copyIfPresent(path.join(projectRoot, name), path.join(fixtureRoot, name));
  }

  return {
    fixtureRoot,
    dataRoot,
    userDataRoot,
    previewCapable: previewLinks.some(Boolean) && fs.existsSync(path.join(fixtureRoot, "tyrano")),
  };
}

// Serialized into a temporary Electron entry point. Keeping it here makes the
// benchmark a single self-contained script and avoids changing production startup.
function electronHarness() {
  "use strict";

  const { app, BrowserWindow, clipboard, ipcMain } = require("electron");
  const fs = require("fs");
  const path = require("path");

  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
  app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
  app.commandLine.appendSwitch("enable-precise-memory-info");
  app.commandLine.appendSwitch("site-per-process");
  app.setPath("userData", process.env.EDITOR_PERF_USER_DATA);
  process.env.TYRANOFORGE_DATA_DIR = process.env.EDITOR_PERF_DATA_ROOT;

  const { startServer } = require(process.env.EDITOR_PERF_SERVER);
  const options = JSON.parse(process.env.EDITOR_PERF_OPTIONS || "{}");
  let windowRef = null;
  let serverInfo = null;
  let finished = false;
  let clipboardSnapshot = null;

  function captureClipboard() {
    restoreClipboard();
    const formats = clipboard.availableFormats();
    clipboardSnapshot = formats.map((format) => ({ format, data: clipboard.readBuffer(format) }));
  }

  function restoreClipboard() {
    if (!clipboardSnapshot) return false;
    const snapshot = clipboardSnapshot;
    clipboardSnapshot = null;
    clipboard.clear();
    snapshot.forEach((item) => clipboard.writeBuffer(item.format, item.data));
    return true;
  }

  function finish(code) {
    if (finished) return;
    finished = true;
    try {
      restoreClipboard();
    } catch (error) {}
    try {
      if (windowRef && !windowRef.isDestroyed()) windowRef.destroy();
    } catch (error) {}
    try {
      serverInfo?.server?.close();
    } catch (error) {}
    app.exit(code);
  }

  const watchdog = setTimeout(() => {
    console.error("EDITOR_PERF_ERROR benchmark timed out");
    finish(1);
  }, 150000);

  app.whenReady().then(async () => {
    try {
      serverInfo = await startServer({ port: 0 });
      const preloadPath = path.join(process.env.EDITOR_PERF_USER_DATA, "perf-preload.js");
      fs.writeFileSync(preloadPath, [
        '"use strict";',
        'const { contextBridge, ipcRenderer } = require("electron");',
        'contextBridge.exposeInMainWorld("editorPerf", {',
        '  paste: (text) => ipcRenderer.invoke("editor-perf-paste", text),',
        '  cut: () => ipcRenderer.invoke("editor-perf-cut"),',
        '  restoreClipboard: () => ipcRenderer.invoke("editor-perf-restore-clipboard")',
        '});',
      ].join("\n"));
      ipcMain.handle("editor-perf-paste", (event, value) => {
        captureClipboard();
        clipboard.clear();
        clipboard.writeText(String(value || ""));
        event.sender.paste();
        return true;
      });
      ipcMain.handle("editor-perf-cut", (event) => {
        captureClipboard();
        event.sender.cut();
        return true;
      });
      ipcMain.handle("editor-perf-restore-clipboard", () => restoreClipboard());
      windowRef = new BrowserWindow({
        width: 1680,
        height: 1020,
        show: true,
        backgroundColor: "#0e1014",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          spellcheck: false,
          backgroundThrottling: false,
          preload: preloadPath,
        },
      });
      windowRef.webContents.on("console-message", (_event, ...args) => {
        const details = args.length === 1 && args[0] && typeof args[0] === "object" ? args[0] : null;
        const level = details ? details.level : args[0];
        const message = details ? details.message : args[1];
        if (Number(level) >= 2 && !String(message || "").includes("Security Warning")) {
          const line = details ? details.lineNumber : args[2];
          const sourceId = details ? details.sourceId : args[3];
          const location = sourceId ? ` (${sourceId}:${line || 0})` : "";
          console.error("EDITOR_PERF_RENDERER " + String(message || "") + location);
        }
      });
      await windowRef.loadURL(`http://127.0.0.1:${serverInfo.port}/`);
      windowRef.focus();
      windowRef.webContents.focus();

      const source = String.raw`
        (async () => {
          const OPTIONS = __EDITOR_PERF_OPTIONS__;
          const limits = OPTIONS.limits;
          const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
          const paintedFrame = async () => {
            await frame();
            await frame();
          };
          const waitUntil = async (predicate, timeoutMs, label) => {
            const started = performance.now();
            while (!predicate()) {
              if (performance.now() - started > timeoutMs) throw new Error("Timed out waiting for " + label);
              await new Promise((resolve) => setTimeout(resolve, 25));
            }
            return performance.now() - started;
          };
          const waitForWorkerStart = async () => {
            const started = performance.now();
            while (!rawHighlightWorkerBusy) {
              if (performance.now() - started > 1500) return false;
              await new Promise((resolve) => setTimeout(resolve, 1));
            }
            return true;
          };
          const percentile = (values, p) => {
            if (!values.length) return 0;
            const sorted = [...values].sort((a, b) => a - b);
            return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
          };
          const summary = (values) => ({
            min: Math.min(...values),
            p50: percentile(values, 0.50),
            p95: percentile(values, 0.95),
            max: Math.max(...values),
          });
          const ratio = (last, first) => percentile(last, 0.50) / Math.max(1, percentile(first, 0.50));
          const failures = [];
          const check = (condition, message) => {
            if (!condition) failures.push(message);
          };
          const cancelEditTimers = () => {
            clearTimeout(state.rawSaveTimer);
            state.rawSaveTimer = null;
            if (typeof rawReparseTimer !== "undefined") {
              clearTimeout(rawReparseTimer);
              rawReparseTimer = 0;
            }
          };
          const cancelRawAutosaveOnly = () => {
            clearTimeout(state.rawSaveTimer);
            state.rawSaveTimer = null;
          };
          const launchWorkerOverlapStress = async (editor) => {
            clearTimeout(rawReparseTimer);
            rawReparseTimer = 0;
            const generation = (rawHighlightGeneration += 1);
            startRawHighlightWorkerJob({
              generation,
              text: editor.value + "\n" + editor.value,
              file: state.currentFile || "",
            });
            return waitForWorkerStart();
          };
          const insertLikeUser = (editor, text, inputType = "insertText") => {
            const from = editor.selectionStart;
            const to = editor.selectionEnd;
            const revision = editor._ksCodeMirror.revision;
            document.execCommand("insertText", false, text);
            if (editor._ksCodeMirror.revision !== revision) return;
            editor.setRangeText(text, from, to, "end");
          };
          const deleteLikeUser = (editor, inputType = "deleteByCut") => {
            const from = editor.selectionStart;
            const to = editor.selectionEnd;
            const revision = editor._ksCodeMirror.revision;
            document.execCommand("delete", false);
            if (editor._ksCodeMirror.revision !== revision) return;
            editor.setRangeText("", from, to, "end");
          };
          const clipboardEditLikeUser = async (editor, method, value, fallback) => {
            if (!window.editorPerf || typeof window.editorPerf[method] !== "function") {
              fallback();
              return { at: performance.now(), native: false };
            }
            const revision = editor._ksCodeMirror.revision;
            let observedAt = null;
            try {
              await window.editorPerf[method](value);
              const started = performance.now();
              while (editor._ksCodeMirror.revision === revision && performance.now() - started < 250) {
                await new Promise((resolve) => setTimeout(resolve, 4));
              }
              if (editor._ksCodeMirror.revision !== revision) observedAt = performance.now();
            } finally {
              await window.editorPerf.restoreClipboard();
            }
            if (observedAt != null) return { at: observedAt, native: true };
            fallback();
            return { at: performance.now(), native: false };
          };

          await waitUntil(
            () => typeof state !== "undefined" && state.project && state.scenario &&
              state.scenarios.length && document.body.dataset.view === "editor",
            20000,
            "editor boot",
          );
          if (state.currentFile !== OPTIONS.storage) {
            await loadScenario(OPTIONS.storage, { line: 0, quiet: true });
          }

          const initialLineCount = state.scenario.parsed.entries.length;
          const middleLine = Math.max(0, Math.floor(initialLineCount / 2));
          document.activeElement?.blur?.();
          const coldStarted = performance.now();
          activateView("code");
          const coldOpenMs = performance.now() - coldStarted;
          const editor = document.querySelector("#rawEditor");
          if (!editor) throw new Error("#rawEditor was not created");
          const original = state.scenario.text;
          if (editor.value !== original) {
            check(false, "KS view did not synchronize the current scenario text");
            editor.value = original;
            renderRawHighlight();
          }
          let originalLineCount = 1;
          for (let offset = original.indexOf("\n"); offset !== -1; offset = original.indexOf("\n", offset + 1)) {
            originalLineCount += 1;
          }
          // Initial worker is intentionally still busy here. Repeated timeline↔KS
          // navigation must reuse the identical in-flight job instead of invalidating it.
          const generationBeforeBusyJumps = rawHighlightGeneration;
          for (let index = 0; index < 24; index += 1) {
            activateView("editor");
            activateView("code");
          }
          const busyJumpGenerationDelta = rawHighlightGeneration - generationBeforeBusyJumps;
          check(busyJumpGenerationDelta <= 1, "busy KS jumps restarted highlight worker " + busyJumpGenerationDelta + " times");
          let highlightReadyMs;
          try {
            highlightReadyMs = await waitUntil(
              () => rawHighlightedText === editor.value && !rawHighlightWorkerBusy,
              10000,
              "initial KS highlight",
            );
          } catch (error) {
            throw new Error(error.message + " | worker=" + JSON.stringify({
              generation: typeof rawHighlightGeneration === "undefined" ? null : rawHighlightGeneration,
              busy: typeof rawHighlightWorkerBusy === "undefined" ? null : rawHighlightWorkerBusy,
              failed: typeof rawHighlightWorkerFailed === "undefined" ? null : rawHighlightWorkerFailed,
              activeGeneration: typeof rawHighlightWorkerActive === "undefined" ? null : rawHighlightWorkerActive?.generation,
              pendingGeneration: typeof rawHighlightWorkerPending === "undefined" ? null : rawHighlightWorkerPending?.generation,
              highlighted: rawHighlightedText === editor.value,
              codeMirrorLines: editor._ksCodeMirror?.view.state.doc.lines,
              expectedLines: originalLineCount,
              originalLength: original.length,
              firstNewline: original.indexOf("\n"),
              splitLines: original.split("\n").length,
            }));
          }
          renderRawWindow();
          check(coldOpenMs <= limits.coldOpenMs, "cold KS open " + coldOpenMs.toFixed(1) + "ms > " + limits.coldOpenMs + "ms");
          check(highlightReadyMs <= limits.highlightReadyMs, "highlight ready " + highlightReadyMs.toFixed(1) + "ms > " + limits.highlightReadyMs + "ms");
          const idleFrames = [];
          let idleFrameStarted = performance.now();
          for (let index = 0; index < 12; index += 1) {
            await paintedFrame();
            const now = performance.now();
            idleFrames.push(now - idleFrameStarted);
            idleFrameStarted = now;
          }
          const idleFrame = summary(idleFrames);
          const dirtyFrameSamples = [];
          const frameProbe = document.createElement("span");
          frameProbe.style.cssText = "position:fixed;left:-9999px;top:0";
          document.body.appendChild(frameProbe);
          for (let index = 0; index < 12; index += 1) {
            const started = performance.now();
            frameProbe.textContent = String(index);
            await paintedFrame();
            dirtyFrameSamples.push(performance.now() - started);
          }
          frameProbe.remove();
          const dirtyFrame = summary(dirtyFrameSamples);

          async function restoreEditor() {
            cancelEditTimers();
            editor.value = original;
            const middle = rawLineOffset(editor, middleLine);
            editor._ksCodeMirror.scrollToPosition(middle, "center");
            renderRawHighlight();
            await waitUntil(
              () => rawHighlightedText === original && !rawHighlightWorkerBusy,
              10000,
              "restored KS highlight",
            );
            renderRawWindow();
          }

          // CodeMirrorのcontenteditableをIMEの単一描画面として使い、変換中は
          // 診断・保存だけを保留し、確定transactionを欠落させないことを検証する。
          const imeText = "変換確認";
          const imeAt = rawLineOffset(editor, middleLine);
          activateView("editor");
          // 前のKSセッションで終了通知を失った状態でも、ビュー再入場で解除する。
          rawEditorComposing = true;
          rawCompositionDirty = true;
          selectTimelineLine(middleLine, { scroll: true });
          await jumpTimelineSelectionToRaw();
          await paintedFrame();
          check(rawEditorHasFocus(editor), "timeline-to-KS jump did not focus CodeMirror");
          check(!rawEditorComposing && !rawCompositionDirty,
            "timeline-to-KS jump retained stale IME state");
          check(middleLine >= rawWinFirst && middleLine < rawWinLast,
            "timeline-to-KS jump retained stale visible-line cache");
          editor._ksCodeMirror.setSelection(imeAt, imeAt, { scroll: true, y: "center" });
          const content = editor._ksCodeMirror.view.contentDOM;
          content.dispatchEvent(new KeyboardEvent("keydown", {
            bubbles: true,
            key: "Process",
            isComposing: true,
          }));
          content.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
          const imeStarted = {
            composing: rawEditorComposing,
            contentEditable: content.contentEditable === "true",
            autosavePaused: !state.rawSaveTimer,
          };
          editor.setRangeText(imeText, imeAt, imeAt, "end");
          const imeDuring = {
            textPresent: editor._ksCodeMirror.slice(imeAt, imeAt + imeText.length) === imeText,
            autosavePaused: !state.rawSaveTimer,
          };
          content.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: imeText }));
          await paintedFrame();
          const activeLine = editor._ksCodeMirror.lineAt(editor.selectionStart);
          const imeComposition = {
            started: imeStarted,
            during: imeDuring,
            committed: {
              focused: rawEditorHasFocus(editor),
              composing: rawEditorComposing,
              documentUpdated: activeLine.text.includes(imeText),
              autosaveScheduled: Boolean(state.rawSaveTimer),
            },
          };
          check(imeStarted.composing && imeStarted.contentEditable,
            "IME composition did not stay in CodeMirror's native editing surface");
          check(imeStarted.autosavePaused && imeDuring.autosavePaused,
            "IME composition scheduled autosave before conversion was committed");
          check(imeDuring.textPresent, "IME composition text was not retained in the editor");
          check(!imeComposition.committed.composing && imeComposition.committed.focused &&
            imeComposition.committed.documentUpdated,
          "IME committed text was not kept in CodeMirror: " +
            JSON.stringify(imeComposition.committed));
          check(imeComposition.committed.autosaveScheduled,
            "IME committed text did not schedule autosave");
          await restoreEditor();

          async function runAccumulationStress() {
            await restoreEditor();
            editor.focus();
            const at = rawLineOffset(editor, middleLine);
            editor._ksCodeMirror.setSelection(at, at, { scroll: true, y: "center" });
            const revisionBefore = editor._ksCodeMirror.revision;
            const heapBefore = performance.memory ? performance.memory.usedJSHeapSize : 0;
            const first = [];
            const last = [];
            let maxDomLines = 0;
            const iterations = 2000;
            for (let index = 0; index < iterations; index += 1) {
              const started = performance.now();
              editor.setRangeText("x", at, at, "end");
              editor.setRangeText("", at, at + 1, "end");
              const elapsed = performance.now() - started;
              if (index < 100) first.push(elapsed);
              if (index >= iterations - 100) last.push(elapsed);
              cancelEditTimers();
              if ((index + 1) % 100 === 0) {
                await paintedFrame();
                maxDomLines = Math.max(maxDomLines, document.querySelectorAll("#rawEditor .cm-line").length);
              }
            }
            const heapAfter = performance.memory ? performance.memory.usedJSHeapSize : 0;
            const result = {
              iterations,
              transactions: editor._ksCodeMirror.revision - revisionBefore,
              first: summary(first),
              last: summary(last),
              drift: ratio(last, first),
              maxDomLines,
              heapGrowth: Math.max(0, heapAfter - heapBefore),
              restored: editor.value === original && editor.selectionStart === at,
            };
            check(result.transactions === iterations * 2,
              "long-run transaction count was " + result.transactions + "/" + (iterations * 2));
            check(result.last.p95 <= limits.inputP95Ms,
              "long-run input p95 " + result.last.p95.toFixed(1) + "ms > " + limits.inputP95Ms + "ms");
            check(result.drift <= limits.driftRatio,
              "long-run input drift " + result.drift.toFixed(2) + "x > " + limits.driftRatio + "x");
            check(result.maxDomLines <= limits.domNodes,
              "long-run virtual DOM grew to " + result.maxDomLines + " > " + limits.domNodes);
            check(result.heapGrowth <= limits.heapGrowthBytes,
              "long-run heap grew " + result.heapGrowth + " bytes > " + limits.heapGrowthBytes);
            check(result.restored, "long-run edits did not preserve document/caret state");
            return result;
          }

          const accumulation = await runAccumulationStress();
          await restoreEditor();

          async function runPhase(name, counts) {
            await restoreEditor();
            const lineLimit = Math.max(1, state.scenario.parsed.entries.length - 1);
            const jump = [];
            const jumpFrame = [];
            const jumpBack = [];
            const input = [];
            const inputFrame = [];
            const pasteInsert = [];
            const pasteInsertFrame = [];
            const pasteDelete = [];
            const scroll = [];
            const scrollFrame = [];
            const nodeCounts = [];
            let idleWorkerBursts = 0;
            let workerOverlapInputs = 0;
            let documentMismatches = 0;
            let nativeClipboardEdits = 0;
            let clipboardEditMismatches = 0;
            const heapBefore = performance.memory ? performance.memory.usedJSHeapSize : 0;

            for (let index = 0; index < counts.jump; index += 1) {
              activateView("editor");
              selectTimelineLine((index * 137 + middleLine) % lineLimit, { scroll: true });
              let started = performance.now();
              await jumpTimelineSelectionToRaw();
              jump.push(performance.now() - started);
              await paintedFrame();
              jumpFrame.push(performance.now() - started);
              started = performance.now();
              await jumpRawSelectionToTimeline();
              jumpBack.push(performance.now() - started);
              await paintedFrame();
            }

            activateView("code");
            const middle = rawLineOffset(editor, middleLine);
            editor.focus();
            editor._ksCodeMirror.setSelection(middle, middle, { scroll: true, y: "center" });
            renderRawWindow();
            for (let index = 0; index < counts.input; index += 1) {
              if (rawHighlightWorkerBusy) workerOverlapInputs += 1;
              const at = editor.selectionStart;
              const started = performance.now();
              insertLikeUser(editor, "x");
              input.push(performance.now() - started);
              await paintedFrame();
              inputFrame.push(performance.now() - started);
              if (editor.selectionStart !== at + 1 || editor._ksCodeMirror.slice(at, at + 1) !== "x") {
                documentMismatches += 1;
              }
              if ((index + 1) % 24 === 0 && index + 1 < counts.input) {
                cancelRawAutosaveOnly();
                if (await launchWorkerOverlapStress(editor)) idleWorkerBursts += 1;
              } else {
                cancelEditTimers();
              }
            }

            await restoreEditor();
            const pasteText = Array.from({ length: 20 }, (_, index) => "; perf paste " + index).join("\n") + "\n";
            const pasteAt = rawLineOffset(editor, middleLine);
            for (let index = 0; index < counts.paste; index += 1) {
              editor.setSelectionRange(pasteAt, pasteAt);
              const beforePasteLength = editor._ksCodeMirror.view.state.doc.length;
              let started = performance.now();
              const pasteResult = await clipboardEditLikeUser(
                editor,
                "paste",
                pasteText,
                () => insertLikeUser(editor, pasteText, "insertFromPaste"),
              );
              pasteInsert.push(pasteResult.at - started);
              if (pasteResult.native) nativeClipboardEdits += 1;
              if (
                editor._ksCodeMirror.view.state.doc.length !== beforePasteLength + pasteText.length ||
                editor.selectionStart !== pasteAt + pasteText.length ||
                editor._ksCodeMirror.slice(pasteAt, pasteAt + pasteText.length) !== pasteText
              ) clipboardEditMismatches += 1;
              await paintedFrame();
              pasteInsertFrame.push(performance.now() - started);
              cancelEditTimers();

              const pasteEnd = editor.selectionStart;
              editor.setSelectionRange(pasteAt, pasteEnd);
              started = performance.now();
              const cutAt = await clipboardEditLikeUser(
                editor,
                "cut",
                undefined,
                () => deleteLikeUser(editor),
              );
              pasteDelete.push(cutAt.at - started);
              if (cutAt.native) nativeClipboardEdits += 1;
              if (editor._ksCodeMirror.view.state.doc.length !== beforePasteLength || editor.selectionStart !== pasteAt) {
                clipboardEditMismatches += 1;
              }
              await paintedFrame();
              nodeCounts.push(document.querySelectorAll("#rawEditor .cm-line").length);
              if ((index + 1) % 10 === 0 && index + 1 < counts.paste) {
                cancelRawAutosaveOnly();
                if (await launchWorkerOverlapStress(editor)) idleWorkerBursts += 1;
              } else {
                cancelEditTimers();
              }
            }

            await restoreEditor();
            const scrollDOM = editor._ksCodeMirror.view.scrollDOM;
            const maxScroll = Math.max(1, scrollDOM.scrollHeight - scrollDOM.clientHeight);
            for (let index = 0; index < counts.scroll; index += 1) {
              const top = (((index * 15485863) % 100000) / 100000) * maxScroll;
              const started = performance.now();
              editor.scrollTop = top;
              editor.dispatchEvent(new Event("scroll"));
              scroll.push(performance.now() - started);
              await paintedFrame();
              scrollFrame.push(performance.now() - started);
              nodeCounts.push(document.querySelectorAll("#rawEditor .cm-line").length);
            }
            renderRawWindow();

            const codeChildren = document.querySelectorAll("#rawEditor .cm-line").length;
            const gutterChildren = document.querySelectorAll("#rawEditor .cm-gutterElement").length;
            const jumpDrift = ratio(jump.slice(-10), jump.slice(0, 10));
            const inputDrift = ratio(input.slice(-10), input.slice(0, 10));
            const pasteDrift = ratio(pasteInsert.slice(-10), pasteInsert.slice(0, 10));
            const result = {
              jump: summary(jump),
              jumpFrame: summary(jumpFrame),
              jumpBack: summary(jumpBack),
              input: summary(input),
              inputFrame: summary(inputFrame),
              pasteInsert: summary(pasteInsert),
              pasteInsertFrame: summary(pasteInsertFrame),
              pasteDelete: summary(pasteDelete),
              scroll: summary(scroll),
              scrollFrame: summary(scrollFrame),
              drift: { jump: jumpDrift, input: inputDrift, paste: pasteDrift },
              dom: {
                codeChildren,
                gutterChildren,
                minDuringPaste: Math.min(...nodeCounts),
                maxDuringPaste: Math.max(...nodeCounts),
              },
              viewport: { first: rawWinFirst, last: rawWinLast, total: editor._ksCodeMirror.view.state.doc.lines },
              heap: {
                before: heapBefore,
                after: performance.memory ? performance.memory.usedJSHeapSize : 0,
              },
              restored: editor.value === original && rawHighlightedText === original,
              idleWorkerBursts,
              workerOverlapInputs,
              documentMismatches,
              nativeClipboardEdits,
              clipboardEditMismatches,
            };

            check(result.jump.p95 <= limits.jumpP95Ms, name + " jump p95 " + result.jump.p95.toFixed(1) + "ms > " + limits.jumpP95Ms + "ms");
            const compositorBaseline = Math.max(idleFrame.p95, dirtyFrame.p95);
            const jumpPaintLimit = Math.max(limits.jumpFrameP95Ms, compositorBaseline + 60);
            const inputPaintLimit = Math.max(limits.inputFrameP95Ms, compositorBaseline + 35);
            const pastePaintLimit = Math.max(limits.pasteFrameP95Ms, compositorBaseline + 50);
            const scrollPaintLimit = Math.max(limits.scrollFrameP95Ms, compositorBaseline + 35);
            check(result.jumpFrame.p95 <= jumpPaintLimit, name + " jump paint p95 " + result.jumpFrame.p95.toFixed(1) + "ms > " + jumpPaintLimit.toFixed(1) + "ms");
            check(result.jumpBack.p95 <= limits.jumpBackP95Ms, name + " jump-back p95 " + result.jumpBack.p95.toFixed(1) + "ms > " + limits.jumpBackP95Ms + "ms");
            check(result.input.p95 <= limits.inputP95Ms, name + " input p95 " + result.input.p95.toFixed(1) + "ms > " + limits.inputP95Ms + "ms");
            check(result.inputFrame.p95 <= inputPaintLimit, name + " input paint p95 " + result.inputFrame.p95.toFixed(1) + "ms > " + inputPaintLimit.toFixed(1) + "ms");
            check(result.pasteInsert.p95 <= limits.pasteP95Ms, name + " paste p95 " + result.pasteInsert.p95.toFixed(1) + "ms > " + limits.pasteP95Ms + "ms");
            check(result.pasteInsertFrame.p95 <= pastePaintLimit, name + " paste paint p95 " + result.pasteInsertFrame.p95.toFixed(1) + "ms > " + pastePaintLimit.toFixed(1) + "ms");
            check(result.scroll.p95 <= limits.scrollP95Ms, name + " scroll p95 " + result.scroll.p95.toFixed(1) + "ms > " + limits.scrollP95Ms + "ms");
            check(result.scrollFrame.p95 <= scrollPaintLimit, name + " scroll paint p95 " + result.scrollFrame.p95.toFixed(1) + "ms > " + scrollPaintLimit.toFixed(1) + "ms");
            check(jumpDrift <= limits.driftRatio, name + " jump drift " + jumpDrift.toFixed(2) + "x > " + limits.driftRatio + "x");
            check(inputDrift <= limits.driftRatio, name + " input drift " + inputDrift.toFixed(2) + "x > " + limits.driftRatio + "x");
            check(pasteDrift <= limits.driftRatio, name + " paste drift " + pasteDrift.toFixed(2) + "x > " + limits.driftRatio + "x");
            check(result.dom.codeChildren <= limits.domNodes, name + " code DOM " + result.dom.codeChildren + " > " + limits.domNodes);
            check(result.dom.gutterChildren <= limits.domNodes, name + " gutter DOM " + result.dom.gutterChildren + " > " + limits.domNodes);
            check(result.dom.maxDuringPaste <= limits.domNodes, name + " virtual DOM grew to " + result.dom.maxDuringPaste + " > " + limits.domNodes);
            check(result.documentMismatches === 0, name + " CodeMirror document/caret mismatched " + result.documentMismatches + " times");
            check(result.nativeClipboardEdits === counts.paste * 2, name + " used " + result.nativeClipboardEdits + "/" + (counts.paste * 2) + " native clipboard edits");
            check(result.clipboardEditMismatches === 0, name + " clipboard edits mismatched " + result.clipboardEditMismatches + " times");
            check(result.idleWorkerBursts > 0, name + " did not exercise idle worker bursts");
            check(result.workerOverlapInputs > 0, name + " did not overlap input with worker parsing");
            const heapGrowth = Math.max(0, result.heap.after - result.heap.before);
            check(heapGrowth <= limits.heapGrowthBytes, name + " heap grew " + heapGrowth + " bytes > " + limits.heapGrowthBytes);
            check(result.restored, name + " did not restore the original KS text/cache");
            return result;
          }

          const withoutPreview = await runPhase("without-preview", {
            jump: 48,
            input: 72,
            paste: 24,
            scroll: 96,
          });

          async function startMeasuredPreview() {
            if (!OPTIONS.previewCapable || OPTIONS.skipPreview) {
              return { ready: false, skipped: true, reason: OPTIONS.skipPreview ? "disabled" : "runtime unavailable" };
            }
            activateView("editor");
            const line = Math.min(10, Math.max(0, state.scenario.parsed.entries.length - 1));
            let readyResolve;
            let readyReject;
            const readyPromise = new Promise((resolve, reject) => {
              readyResolve = resolve;
              readyReject = reject;
            });
            const readyTimer = setTimeout(() => readyReject(new Error("preview status message timed out")), 20000);
            const onPreviewMessage = (event) => {
              if (event.data?.source !== "tyranoforge-preview") return;
              clearTimeout(readyTimer);
              window.removeEventListener("message", onPreviewMessage);
              readyResolve(event.data);
            };
            window.addEventListener("message", onPreviewMessage);
            startPreview("", line);
            try {
              const waitStarted = performance.now();
              const status = await readyPromise;
              const waitMs = performance.now() - waitStarted;
              const bridge = await requestLivePreview({ type: "layout-snapshot" });
              if (!bridge.ok) throw new Error(bridge.error || "preview bridge was not ready");
              // Let the 500ms preview snapshot loop run at least once before measuring.
              await new Promise((resolve) => setTimeout(resolve, 600));
              return { ready: true, skipped: false, waitMs, line, scenario: status.currentScenario || "" };
            } catch (error) {
              clearTimeout(readyTimer);
              window.removeEventListener("message", onPreviewMessage);
              stopPreview();
              return { ready: false, skipped: false, reason: error.message };
            }
          }

          const preview = await startMeasuredPreview();
          let withPreview = null;
          if (preview.ready) {
            withPreview = await runPhase("with-preview", {
              jump: 24,
              input: 48,
              paste: 12,
              scroll: 48,
            });
          } else if (OPTIONS.requirePreview) {
            check(false, "preview was required but did not start: " + preview.reason);
          }

          await restoreEditor();
          activateView("code");
          editor.focus();
          const saveAt = rawLineOffset(editor, middleLine);
          editor.setSelectionRange(saveAt, saveAt);
          insertLikeUser(editor, "x");
          cancelEditTimers();

          const nativeFetch = window.fetch;
          let responseBytesPromise = Promise.resolve(0);
          window.fetch = async (...args) => {
            const response = await nativeFetch(...args);
            const url = String(args[0] || "");
            if (url.includes("/api/scenario/save")) {
              responseBytesPromise = response.clone().arrayBuffer().then((buffer) => buffer.byteLength);
            }
            return response;
          };
          const autosaveStarted = performance.now();
          try {
            await runRawAutoSave();
          } finally {
            window.fetch = nativeFetch;
          }
          const autosaveMs = performance.now() - autosaveStarted;
          const autosaveBytes = await responseBytesPromise;
          const autosave = {
            ms: autosaveMs,
            responseBytes: autosaveBytes,
            previewActive: Boolean(preview.ready),
          };
          check(autosaveMs <= limits.autosaveMs, "autosave " + autosaveMs.toFixed(1) + "ms > " + limits.autosaveMs + "ms");
          check(autosaveBytes > 0, "autosave response size was not captured");
          check(autosaveBytes <= limits.autosaveBytes, "autosave response " + autosaveBytes + " bytes > " + limits.autosaveBytes);
          if (state.previewStarted) stopPreview();
          cancelEditTimers();

          return {
            ok: failures.length === 0,
            failures,
            source: {
              projectRoot: OPTIONS.sourceProject,
              storage: OPTIONS.sourceStorage,
              fixtureStorage: OPTIONS.storage,
              bytes: OPTIONS.sourceBytes,
              lineCount: originalLineCount,
            },
            cold: { openMs: coldOpenMs, highlightReadyMs, busyJumpGenerationDelta, idleFrame, dirtyFrame },
            imeComposition,
            accumulation,
            withoutPreview,
            preview,
            withPreview,
            autosave,
            limits,
          };
        })()
      `;
      const result = await windowRef.webContents.executeJavaScript(
        source.replace("__EDITOR_PERF_OPTIONS__", JSON.stringify(options)),
        true,
      );
      console.log("EDITOR_PERF_RESULT " + JSON.stringify(result));
      clearTimeout(watchdog);
      finish(result.ok ? 0 : 1);
    } catch (error) {
      clearTimeout(watchdog);
      console.error("EDITOR_PERF_ERROR " + (error && error.stack ? error.stack : error));
      finish(1);
    }
  });

  app.on("window-all-closed", () => finish(finished ? 0 : 1));
}

function formatMetric(metric) {
  return `p50 ${metric.p50.toFixed(1)}ms / p95 ${metric.p95.toFixed(1)}ms / max ${metric.max.toFixed(1)}ms`;
}

function printSummary(result) {
  const source = result.source;
  console.log(`KS editor performance: ${source.storage} (${source.lineCount.toLocaleString()} lines, ${source.bytes.toLocaleString()} bytes)`);
  console.log(`  cold open ${result.cold.openMs.toFixed(1)}ms; highlight ready ${result.cold.highlightReadyMs.toFixed(1)}ms`);
  console.log(
    `  frame baseline idle ${formatMetric(result.cold.idleFrame)} / dirty ${formatMetric(result.cold.dirtyFrame)}; ` +
    `busy-jump worker restarts ${result.cold.busyJumpGenerationDelta}`,
  );
  console.log(
    `  IME composition ${result.imeComposition.during.textPresent ? "retained" : "missing"}; ` +
    `document commit ${result.imeComposition.committed.documentUpdated ? "OK" : "failed"}`,
  );
  console.log(
    `  long-run ${result.accumulation.iterations.toLocaleString()} edit cycles; ` +
    `last ${formatMetric(result.accumulation.last)}; drift ${result.accumulation.drift.toFixed(2)}x; ` +
    `DOM max ${result.accumulation.maxDomLines}`,
  );
  console.log(`  jump ${formatMetric(result.withoutPreview.jump)}`);
  console.log(`  input ${formatMetric(result.withoutPreview.input)}`);
  console.log(`  input paint ${formatMetric(result.withoutPreview.inputFrame)}`);
  console.log(`  paste ${formatMetric(result.withoutPreview.pasteInsert)}`);
  console.log(`  paste paint ${formatMetric(result.withoutPreview.pasteInsertFrame)}`);
  console.log(`  scroll ${formatMetric(result.withoutPreview.scroll)}`);
  console.log(
    `  drift jump ${result.withoutPreview.drift.jump.toFixed(2)}x / ` +
    `input ${result.withoutPreview.drift.input.toFixed(2)}x / ` +
    `paste ${result.withoutPreview.drift.paste.toFixed(2)}x`,
  );
  console.log(
    `  DOM code/gutter ${result.withoutPreview.dom.codeChildren}/${result.withoutPreview.dom.gutterChildren}; ` +
    `viewport ${result.withoutPreview.viewport.first}-${result.withoutPreview.viewport.last}; ` +
    `worker overlap ${result.withoutPreview.workerOverlapInputs}; ` +
    `native clipboard ${result.withoutPreview.nativeClipboardEdits}`,
  );
  if (result.withPreview) {
    console.log(`  preview-on jump ${formatMetric(result.withPreview.jump)}`);
    console.log(`  preview-on input ${formatMetric(result.withPreview.input)}`);
  } else {
    console.log(`  preview-on skipped: ${result.preview.reason || "not available"}`);
  }
  console.log(
    `  autosave ${result.autosave.ms.toFixed(1)}ms; response ` +
    `${result.autosave.responseBytes.toLocaleString()} bytes; preview=${result.autosave.previewActive}`,
  );
  if (result.failures.length) {
    result.failures.forEach((failure) => console.error(`  FAIL: ${failure}`));
  } else {
    console.log("  PASS: latency, accumulation, DOM, and scroll synchronization limits satisfied");
  }
}

function relevantElectronStderr(value) {
  return String(value || "")
    .split(/\r?\n/)
    .filter((line) => line && !/process_mac\.cc.*task_policy_set/.test(line))
    .join("\n");
}

function main() {
  const projectRoot = config.projectRoot;
  const scenario = selectScenario(projectRoot);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tyranoforge-editor-perf-"));
  const keepTemp = process.env.EDITOR_PERF_KEEP_TEMP === "1";
  try {
    const fixture = makeFixture(tempRoot, projectRoot, scenario);
    const harnessFile = path.join(tempRoot, "electron-harness.js");
    fs.writeFileSync(
      harnessFile,
      `"use strict";\n(${electronHarness.toString()})();\n`,
      "utf8",
    );
    const options = {
      sourceProject: projectRoot,
      sourceStorage: scenario.storage,
      sourceBytes: scenario.size,
      storage: scenario.storage,
      previewCapable: fixture.previewCapable,
      skipPreview: process.env.EDITOR_PERF_SKIP_PREVIEW === "1",
      requirePreview:
        fixture.previewCapable &&
        process.env.EDITOR_PERF_SKIP_PREVIEW !== "1" &&
        process.env.EDITOR_PERF_REQUIRE_PREVIEW !== "0",
      limits: limitsFromEnv(),
    };
    const electronBinary = require("electron");
    const child = spawnSync(electronBinary, [harnessFile], {
      cwd: EDITOR_ROOT,
      env: {
        ...process.env,
        TYRANOFORGE_PROJECT: fixture.fixtureRoot,
        EDITOR_PERF_DATA_ROOT: fixture.dataRoot,
        EDITOR_PERF_USER_DATA: fixture.userDataRoot,
        EDITOR_PERF_SERVER: path.join(EDITOR_ROOT, "server.js"),
        EDITOR_PERF_OPTIONS: JSON.stringify(options),
      },
      encoding: "utf8",
      timeout: 155000,
      maxBuffer: 20 * 1024 * 1024,
    });
    const stdout = String(child.stdout || "");
    const stderr = relevantElectronStderr(child.stderr);
    const resultLine = stdout.split(/\r?\n/).find((line) => line.startsWith("EDITOR_PERF_RESULT "));
    if (!resultLine) {
      if (stdout.trim()) process.stdout.write(stdout);
      if (stderr.trim()) process.stderr.write(stderr + "\n");
      if (child.error) throw child.error;
      throw new Error(`Electron performance harness failed with exit ${child.status}`);
    }
    const result = JSON.parse(resultLine.slice("EDITOR_PERF_RESULT ".length));
    printSummary(result);
    if (stderr.trim()) process.stderr.write(stderr + "\n");
    if (child.status !== 0 || !result.ok) process.exitCode = 1;
  } finally {
    if (keepTemp) {
      console.log(`Performance fixture kept at ${tempRoot}`);
    } else {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
