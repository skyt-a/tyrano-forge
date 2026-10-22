"use strict";

/* ============================================================
   TyranoForge — core (state / api / shell)
   ============================================================ */

const state = {
  // project
  project: null,
  projects: [],
  projectsRoots: [],
  scenarios: [],
  scenario: null,
  // 自動保存の軽量応答を反映したあと、サーバー側の完全な解析結果をまだ
  // 取り直していない状態。KS本文の編集中は巨大な parsed payload を毎回
  // 往復させず、タイムラインへ戻る直前に一度だけ同期する。
  scenarioNeedsReload: false,
  scenarioLoadRequestId: 0,
  scenarioLoadController: null,
  scenarioRefreshPromise: null,
  // GET開始後に別の保存が走った場合、古い解析結果をcommitせず再取得する。
  scenarioWriteRevision: 0,
  scenarioWriteRevisionByFile: new Map(),
  scenarioSuccessfulWriteRevisionByFile: new Map(),
  scenarioWriteActiveByFile: new Map(),
  // 軽量保存後の内部refreshより、ユーザーが明示したファイル遷移を優先する。
  scenarioNavigationIntentId: 0,
  scenarioNavigationPromise: null,
  currentFile: "",
  selectedLine: 0,
  // assets
  selectedAssetKind: "bgimage",
  selectedAsset: null,
  assetFolder: null,
  assetGridItems: [],
  assetGridNodes: null,
  assetGridSpacer: null,
  assetGridScrollRaf: 0,
  assets: {},
  catalog: null,
  diagnostics: null,
  // preview
  previewMessages: [],
  syncPreview: true,
  autoPreview: true,
  layoutEdit: false,
  previewBoxes: [],
  previewMetrics: null,
  dragBox: null,
  layoutRefreshTimer: null,
  liveRequestId: 0,
  lastPreviewSyncKey: "",
  previewSyncPausedByEditor: false,
  previewStarted: false,
  previewBootingSince: 0,
  theater: false,
  previewOpen: true,
  previewVolume: 1, // プレビューのマスター音量 (0..1)
  previewMuted: false,
  // edits
  historyBackups: [],
  lineSaveTimer: null,
  rawSaveTimer: null,
  lineSaveInFlight: false,
  lineSaveQueued: false,
  rawSaveInFlight: false,
  rawSaveQueued: false,
  // timeline
  timelineRenderKey: "",
  timelineScrollKey: "",
  timelineEntries: [],
  timelineNodes: null,
  timelineSpacer: null,
  timelineScrollRaf: 0,
  timelineSelectionRequestId: 0,
  timelineNeedsRender: false,
  timelineStructureRevision: 0,
  inlineEditLine: -1,
  blockEdit: null, // {fromLine, toLine} = [tb_start_text]〜[_tb_end_text] の行範囲（執筆モード）
  blockSaveTimer: null,
  blockSaveInFlight: false,
  blockSaveQueued: false,
  tagSaveTimer: null,
  tagSaveInFlight: false,
  tagSaveQueued: false,
  pendingScenarioWrites: new Set(),
  pendingEditTasks: new Set(),
  editTaskSerialPromise: null,
  deferredEditKinds: new Set(),
  pendingSaveError: null,
  selAnchor: 0,
  multiSelected: new Set(),
  rowClipboard: "",
  lastFiles: {},
  lastFileSaveTimer: null,
  dragItem: null,
  dragRowLine: null,
  dropIndicator: null,
  paletteCollapsed: {},
  scenarioCollapsed: false,
  scenarioFolders: {},
  scenarioFilterQuery: "",
  // shell
  view: "editor",
  viewActivationId: 0,
  codeSyncPromise: null,
  viewTransitionPromise: null,
  viewTransitionSourceView: "",
  theme: "dark",
  paneSizes: {},
  uiPrefsSaveTimer: null,
  quickOpenMode: "files",
  quickOpenResults: [],
  quickOpenIndex: 0,
  globalSearch: { query: "", matches: [], truncated: false },
  // pickers
  assetPicker: null, // {kind, dir, input, onPick}
  audioPlayer: null,
  playingUrl: "",
  playingName: "",
  // settings/build
  settings: null,
  buildRunning: false,
  buildResult: null,
  buildIcon: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const LINE_AUTO_SAVE_DELAY = 1600;
const RAW_AUTO_SAVE_DELAY = 2400;
const TAG_AUTO_SAVE_DELAY = 350;

function rawEditorHasFocus(editor = $("#rawEditor")) {
  if (!editor) return false;
  if (editor._ksCodeMirror) return Boolean(editor._ksCodeMirror.hasFocus);
  return document.activeElement === editor || editor.contains(document.activeElement);
}

function sessionHeaders(headers = {}) {
  return { ...headers, "X-TyranoForge-Session": document.querySelector('meta[name="tyranoforge-session"]')?.content || "" };
}

function projectResourceUrl(relative) {
  return new URL(relative, previewOrigin()).href;
}

function api(path, options = {}) {
  const { scenarioFile = "", ...requestOptions } = options;
  const method = String(options.method || "GET").toUpperCase();
  const scenarioWritePath = String(path).split("?")[0];
  const isScenarioWrite = method !== "GET" && (
    scenarioWritePath.startsWith("/api/scenario/") ||
    scenarioWritePath === "/api/label/rename" ||
    scenarioWritePath === "/api/backup/restore"
  );
  let writeRevision = 0;
  let writeFile = "";
  let writeKey = "";
  if (isScenarioWrite) {
    // 数MBのraw KS request bodyをmetadata取得のためだけにJSON.parseしない。
    // 呼び出し側がfetchへ渡さないscenarioFileを明示する。
    writeFile = String(scenarioFile || "");
    writeKey = `${writeFile}\u0000${scenarioWritePath}`;
    if (writeFile && state.scenarioWriteActiveByFile.has(writeFile)) {
      const busy = new Error("直前の保存を完了してから、もう一度実行してください");
      busy.__nonDirtyScenarioConflict = true;
      return Promise.reject(busy);
    }
    if (
      state.pendingSaveError &&
      state.pendingSaveError.file === writeFile &&
      state.pendingSaveError.writeKey &&
      state.pendingSaveError.writeKey !== writeKey
    ) {
      // 最初に失敗したdirty editorを復旧対象として保持する。別keyのtaskへ
      // metadataを付け替えると、本来の欄を再保存できなくなる。
      return Promise.reject(state.pendingSaveError.error);
    }
    writeRevision = (state.scenarioWriteRevision += 1);
    if (writeFile) state.scenarioWriteRevisionByFile.set(writeFile, writeRevision);
  }
  const execute = async () => {
    try {
      const response = await fetch(path, {
        ...requestOptions,
        headers: sessionHeaders({ "Content-Type": "application/json", ...(requestOptions.headers || {}) }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      if (isScenarioWrite && data && typeof data === "object") {
        // server payloadには混ぜず、同一ファイルの応答順逆転を検出するclient印。
        Object.defineProperty(data, "__clientWriteRevision", {
          value: writeRevision,
          enumerable: false,
        });
      }
      if (isScenarioWrite && writeFile) {
        state.scenarioSuccessfulWriteRevisionByFile.set(
          writeFile,
          Math.max(
            Number(state.scenarioSuccessfulWriteRevisionByFile.get(writeFile) || 0),
            writeRevision,
          ),
        );
      }
      if (
        isScenarioWrite &&
        state.pendingSaveError &&
        writeFile &&
        state.pendingSaveError.file === writeFile &&
        state.pendingSaveError.writeKey === writeKey &&
        Number(state.pendingSaveError.writeRevision || 0) <= writeRevision
      ) {
        state.pendingSaveError = null;
        if (!state.scenarioNeedsReload && !state.scenarioRefreshPromise) {
          document.body.classList.remove("scenario-refreshing");
        }
        queueMicrotask(resumeDeferredEditTasks);
      }
      return data;
    } catch (error) {
      if (isScenarioWrite && error && typeof error === "object") {
        error.__clientWriteRevision = writeRevision;
        error.__clientWriteFile = writeFile;
        error.__clientWritePath = scenarioWritePath;
        error.__clientWriteKey = writeKey;
      }
      throw error;
    }
  };
  let request;
  if (isScenarioWrite) {
    request = execute();
    if (writeFile) state.scenarioWriteActiveByFile.set(writeFile, request);
    state.pendingScenarioWrites.add(request);
    const release = () => {
      state.pendingScenarioWrites.delete(request);
      if (writeFile && state.scenarioWriteActiveByFile.get(writeFile) === request) {
        state.scenarioWriteActiveByFile.delete(writeFile);
      }
      if (!state.pendingSaveError && state.deferredEditKinds.size) {
        setTimeout(resumeDeferredEditTasks, 0);
      }
    };
    request.then(release, release);
  } else {
    request = execute();
  }
  return request;
}

function debounce(fn, ms = 150) {
  let id = null;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}

function trackPendingEditTask(task) {
  const promise = Promise.resolve(task);
  state.pendingEditTasks.add(promise);
  promise.then(
    () => state.pendingEditTasks.delete(promise),
    (error) => {
      state.pendingEditTasks.delete(promise);
      if (error?.__nonDirtyScenarioConflict) return;
      if (state.pendingSaveError) return;
      const writeKey = String(error?.__clientWriteKey || "");
      const writeRevision = Number(error?.__clientWriteRevision || state.scenarioWriteRevision || 0);
      const writeFile = String(error?.__clientWriteFile || "");
      const newerSuccess = writeFile
        ? Number(state.scenarioSuccessfulWriteRevisionByFile.get(writeFile) || 0)
        : 0;
      if (newerSuccess >= writeRevision && writeRevision > 0) return;
      state.pendingSaveError = {
        error,
        file: writeFile || String(state.currentFile || ""),
        writeKey,
        writeRevision,
      };
      // 失敗済みtaskがSetから消えたあともpendingSaveErrorで遷移を止める。
      // 現在のdirty editor自体は操作可能にして、修正・再保存できるようにする。
    },
  );
  return promise;
}

function pendingEditRunnerFor(kind) {
  if (kind === "line") return () => runLineAutoSave();
  if (kind === "raw") return () => runRawAutoSave();
  if (kind === "block") return () => runBlockAutoSave();
  if (kind === "tag") return () => saveTagAttrs({ auto: true });
  return null;
}

function startPendingEditRunner(kind, runner, { report = true } = {}) {
  if (kind) state.deferredEditKinds.delete(kind);
  const previous = state.editTaskSerialPromise;
  const task = (async () => {
    if (previous) {
      try {
        await previous;
      } catch (error) {
        // API gateが最初のpendingSaveErrorを返し、別keyの実行を止める。
      }
    }
    // 明示insert/restore等のrequest中にautosave timerが発火しても、busyで
    // timerを消費せず、responseのcaller continuation（afterWrite）まで1task待つ。
    const file = state.currentFile;
    const activeWrite = state.scenarioWriteActiveByFile.get(file);
    if (activeWrite) {
      try {
        await activeWrite;
      } catch (error) {}
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return runner();
  })();
  state.editTaskSerialPromise = task;
  const clear = () => {
    if (state.editTaskSerialPromise === task) state.editTaskSerialPromise = null;
  };
  task.then(clear, clear);
  const tracked = trackPendingEditTask(task);
  tracked.catch((error) => {
    if (
      kind &&
      (state.pendingSaveError?.error === error || error?.__nonDirtyScenarioConflict)
    ) state.deferredEditKinds.add(kind);
    if (report) showError(error);
  });
  return tracked;
}

function resumeDeferredEditTasks() {
  if (state.pendingSaveError || state.scenarioNeedsReload || !state.deferredEditKinds.size) return;
  const kinds = [...state.deferredEditKinds];
  state.deferredEditKinds.clear();
  kinds.forEach((kind) => {
    const runner = pendingEditRunnerFor(kind);
    if (runner) startPendingEditRunner(kind, runner);
  });
}

function resolvePendingSaveErrorIfReverted(kind, file = state.currentFile) {
  const endpoint = kind === "line"
    ? "/api/scenario/line"
    : kind === "tag"
      ? "/api/scenario/update-tag"
      : (kind === "raw" || kind === "block")
        ? "/api/scenario/save"
        : "";
  const pending = state.pendingSaveError;
  if (!pending || !endpoint) return false;
  if (pending.file !== file || pending.writeKey !== `${file}\u0000${endpoint}`) return false;
  state.pendingSaveError = null;
  state.deferredEditKinds.delete(kind);
  state.scenarioNeedsReload = true;
  setTimeout(() => ensureScenarioReadBarrier().catch(showError), 0);
  return true;
}

function hasPendingEditorSave() {
  return Boolean(
    state.lineSaveTimer || state.rawSaveTimer || state.blockSaveTimer || state.tagSaveTimer ||
    state.lineSaveInFlight || state.rawSaveInFlight || state.blockSaveInFlight || state.tagSaveInFlight ||
    state.lineSaveQueued || state.rawSaveQueued || state.blockSaveQueued || state.tagSaveQueued ||
    state.pendingEditTasks.size || state.pendingScenarioWrites.size || state.pendingSaveError
    || state.deferredEditKinds.size
  );
}

function ensureScenarioReadBarrier() {
  if (state.scenarioRefreshPromise) return state.scenarioRefreshPromise;
  if (!state.scenarioNeedsReload && !hasPendingEditorSave()) {
    return Promise.resolve(state.scenario);
  }
  const navigationIntentAtStart = state.scenarioNavigationIntentId;
  const refresh = (async () => {
    await flushPendingEdits();
    if (navigationIntentAtStart !== state.scenarioNavigationIntentId) {
      return waitForLatestScenarioNavigation();
    }
    const scenario = await ensureCurrentScenarioFresh({ flush: false });
    // refresh GET中に明示ナビゲーションが始まった場合も、その遷移完了を待つ。
    if (navigationIntentAtStart !== state.scenarioNavigationIntentId) {
      return waitForLatestScenarioNavigation();
    }
    return scenario;
  })();
  state.scenarioRefreshPromise = refresh;
  document.body.classList.add("scenario-refreshing");
  const release = (succeeded) => {
    if (state.scenarioRefreshPromise !== refresh) return;
    state.scenarioRefreshPromise = null;
    // 保存/GET失敗後に旧parsed timelineを再び操作可能にしない。コードビューは
    // このclassの対象外なので本文は残り、再保存・再試行ができる。
    if (succeeded || state.pendingSaveError) {
      document.body.classList.remove("scenario-refreshing");
    }
  };
  refresh.then(() => release(true), () => release(false));
  return refresh;
}

async function waitForLatestScenarioNavigation() {
  for (let round = 0; round < 12; round += 1) {
    const intent = state.scenarioNavigationIntentId;
    const pending = state.scenarioNavigationPromise;
    if (!pending) return state.scenario;
    await pending;
    if (intent === state.scenarioNavigationIntentId && !state.scenarioNavigationPromise) {
      return state.scenario;
    }
  }
  throw new Error("シナリオの切り替え要求が連続しているため、同期を完了できませんでした");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function encodePath(path) {
  return String(path || "").split("/").map(encodeURIComponent).join("/");
}

function projectAssetUrl(dir, storage) {
  const cleanDir = String(dir || "").replace(/^\/+|\/+$/g, "");
  const cleanStorage = String(storage || "").replace(/^\/+/, "");
  const asset = (state.assets[cleanDir] || []).find((item) => item.storage === cleanStorage);
  const cacheKey = asset ? `?v=${encodeURIComponent(`${Math.floor(asset.mtimeMs || 0)}-${asset.size || 0}`)}` : "";
  return projectResourceUrl(`/project/data/${encodePath(cleanDir)}/${encodePath(cleanStorage)}${cacheKey}`);
}

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function currentHash() {
  return state.scenario ? state.scenario.hash : "";
}

function setStatus(message) {
  const node = $("#statusMessage");
  if (node) node.textContent = message;
}

function showError(error) {
  console.error(error);
  toast(String(error && error.message ? error.message : error), "error");
}

/* ---------- toast ---------- */

function toast(message, kind = "info", ms = 3600) {
  const root = $("#toasts");
  if (!root) return;
  const node = document.createElement("div");
  node.className = `toast toast-${kind}`;
  node.textContent = message;
  root.appendChild(node);
  requestAnimationFrame(() => node.classList.add("show"));
  setTimeout(() => {
    node.classList.remove("show");
    setTimeout(() => node.remove(), 300);
  }, ms);
}

/* ---------- ui prefs / theme ---------- */

const UI_PREF_KEY = "tyranoforge-ui";

function loadUiPrefs() {
  try {
    const raw = localStorage.getItem(UI_PREF_KEY);
    return JSON.parse(raw) || {};
  } catch (error) {
    return {};
  }
}

function collectUiPrefs() {
  return {
    theme: state.theme,
    previewOpen: state.previewOpen,
    previewVolume: state.previewVolume,
    previewMuted: state.previewMuted,
    paletteCollapsed: state.paletteCollapsed,
    scenarioCollapsed: state.scenarioCollapsed,
    scenarioFolders: state.scenarioFolders,
    paneSizes: state.paneSizes,
    view: state.view,
    lastFiles: state.lastFiles,
  };
}

// UI 設定を localStorage（即時描画用キャッシュ）とサーバー（再起動をまたぐ永続化）へ保存する。
// パッケージ版は起動ごとにポートが変わり localStorage のオリジンが変わるため、サーバー保存が実際の永続層になる。
function saveUiPrefs(options = {}) {
  const prefs = collectUiPrefs();
  localStorage.setItem(UI_PREF_KEY, JSON.stringify(prefs));
  persistUiPrefsToServer(prefs, options.immediate);
}

function persistUiPrefsToServer(prefs, immediate = false) {
  if (state.uiPrefsSaveTimer) {
    clearTimeout(state.uiPrefsSaveTimer);
    state.uiPrefsSaveTimer = null;
  }
  const run = () => {
    state.uiPrefsSaveTimer = null;
    api("/api/ui-prefs", { method: "POST", body: JSON.stringify(prefs) })
      .catch((error) => console.warn("failed to persist ui prefs", error));
  };
  // ペースト幅ドラッグ等は高頻度で呼ばれるためデバウンス。フォルダ開閉のような単発操作は即時保存。
  if (immediate) run();
  else state.uiPrefsSaveTimer = setTimeout(run, 500);
}

function rememberCurrentFile(options = {}) {
  if (!state.project?.projectRoot || !state.currentFile) return;
  const remembered = {
    file: state.currentFile,
    line: Math.max(0, Math.floor(Number(state.selectedLine || 0))),
  };
  const previous = state.lastFiles[state.project.projectRoot];
  if (!options.immediate && previous &&
      previous.file === remembered.file && previous.line === remembered.line) {
    return;
  }
  state.lastFiles[state.project.projectRoot] = remembered;

  const persist = () => {
    state.lastFileSaveTimer = null;
    // localStorage 書き込み（saveUiPrefs）は同期 I/O なのでここでまとめて
    // デバウンスする。行選択のたびに書くと矢印キー移動・プレビュー追従・
    // タイムラインジャンプがその分ずつ重くなる。
    saveUiPrefs();
    api("/api/project/last-file", {
      method: "POST",
      body: JSON.stringify(remembered),
    }).catch((error) => console.warn("failed to save last file", error));
  };

  if (state.lastFileSaveTimer) {
    clearTimeout(state.lastFileSaveTimer);
    state.lastFileSaveTimer = null;
  }
  if (options.immediate) {
    persist();
  } else {
    state.lastFileSaveTimer = setTimeout(persist, 400);
  }
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  const button = $("#themeBtn");
  if (button) button.title = state.theme === "light" ? "ダークモードへ" : "ライトモードへ";
  document.body.classList.toggle("theme-light", state.theme === "light");
}

function toggleTheme() {
  state.theme = state.theme === "light" ? "dark" : "light";
  applyTheme();
  saveUiPrefs();
}

/* ---------- pane sizes / splitters ---------- */

const PANE_VARS = {
  scenario: "--scenario-width",
  palette: "--palette-width",
  dock: "--dock-width",
  preview: "--dock-preview-height",
};

function applyPaneSizes() {
  const rootStyle = document.documentElement.style;
  Object.entries(PANE_VARS).forEach(([key, cssVar]) => {
    const value = Number(state.paneSizes[key]);
    if (Number.isFinite(value) && value > 0) {
      rootStyle.setProperty(cssVar, `${Math.round(value)}px`);
    } else {
      rootStyle.removeProperty(cssVar);
    }
  });
}

function setPaneSize(key, value, options = {}) {
  if (value === null) {
    delete state.paneSizes[key];
  } else {
    state.paneSizes[key] = Math.round(value);
  }
  // ドラッグ中（persist: false）は localStorage への同期書き込みを skip し、
  // 離したときにまとめて保存する
  if (options.persist !== false) saveUiPrefs();
  applyPaneSizes();
}

function clampPane(value, min, max) {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

function bindSplitter(selector, key, compute) {
  const node = $(selector);
  if (!node) return;
  node.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    try {
      node.setPointerCapture(event.pointerId);
    } catch (error) {}
    node.classList.add("active");
    document.body.classList.add("resizing-pane");
    // pointermove はフレームレートを超えて発火するため rAF で1フレーム1回に
    // 間引く。保存（localStorage / サーバー）は離したときにまとめて行う。
    let moveRaf = 0;
    let lastMove = null;
    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      lastMove = moveEvent;
      if (moveRaf) return;
      moveRaf = requestAnimationFrame(() => {
        moveRaf = 0;
        if (lastMove) setPaneSize(key, compute(lastMove), { persist: false });
      });
    };
    const onUp = (upEvent) => {
      if (upEvent.pointerId !== event.pointerId) return;
      if (moveRaf) {
        cancelAnimationFrame(moveRaf);
        moveRaf = 0;
      }
      if (lastMove) setPaneSize(key, compute(lastMove));
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerup", onUp);
      node.removeEventListener("pointercancel", onUp);
      node.classList.remove("active");
      document.body.classList.remove("resizing-pane");
      notifyPreviewResize();
    };
    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerup", onUp);
    node.addEventListener("pointercancel", onUp);
  });
  node.addEventListener("dblclick", () => {
    setPaneSize(key, null);
    notifyPreviewResize();
  });
}

function initSplitters() {
  bindSplitter("#splitScenario", "scenario", (event) => {
    const rect = $("#view-editor").getBoundingClientRect();
    return clampPane(event.clientX - rect.left, 150, 380);
  });
  bindSplitter("#splitPalette", "palette", (event) => {
    // シナリオサイドバーが左にあるので、パレット自身の左端を基準に幅を測る
    const rect = $("#palette").getBoundingClientRect();
    return clampPane(event.clientX - rect.left, 168, 360);
  });
  bindSplitter("#splitDock", "dock", (event) => {
    const rect = $("#view-editor").getBoundingClientRect();
    return clampPane(rect.right - event.clientX, 300, rect.width - 500);
  });
  bindSplitter("#splitDockPreview", "preview", (event) => {
    const rect = $(".dock").getBoundingClientRect();
    return clampPane(event.clientY - rect.top, 120, rect.height - 200);
  });
}

/* ---------- view switching (activity rail) ---------- */

const VIEW_RENDERERS = {};

function registerView(name, renderer) {
  VIEW_RENDERERS[name] = renderer;
}

function applyViewShell(name) {
  if (state.view === "code" && name !== "code") {
    const rawEditor = $("#rawEditor");
    if (rawEditorHasFocus(rawEditor)) rawEditor.blur();
    if (typeof closeRawCompletion === "function") closeRawCompletion();
    if (typeof closeRawFind === "function") closeRawFind({ focusEditor: false });
  }
  state.view = name;
  $$(".rail-nav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });
  $$(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `view-${name}`);
  });
  document.body.dataset.view = name;
}

function activateView(name, options = {}) {
  if (!$(`#view-${name}`)) return Promise.resolve(false);
  const previousView = state.view;
  const rollbackView = state.viewTransitionSourceView || previousView;
  const activationId = (state.viewActivationId += 1);
  const hadPendingSave = hasPendingEditorSave();
  const render = VIEW_RENDERERS[name] && options.render !== false
    ? () => VIEW_RENDERERS[name]()
    : null;
  const needsParsedScenario = name === "editor" || name === "flow";
  const needsParsedBarrier = needsParsedScenario && (
    state.scenarioNeedsReload || hadPendingSave || state.scenarioRefreshPromise
  );
  // timelineの保存待ち中にcode textareaを旧stateから同期すると、その後のraw
  // 保存でline/tag編集を巻き戻す。逆方向も必ず保存完了後に表示・focusする。
  const needsCodeBarrier = name === "code" && Boolean(
    hadPendingSave || state.codeSyncPromise || document.body.classList.contains("scenario-code-syncing")
  );
  const needsExitSaveBarrier = name !== previousView && hadPendingSave;
  const needsExistingTransition = Boolean(state.viewTransitionPromise);

  if (name !== "code") document.body.classList.remove("scenario-code-syncing");
  applyViewShell(name);

  if (needsParsedBarrier || needsCodeBarrier || needsExitSaveBarrier || needsExistingTransition) {
    if (needsCodeBarrier) document.body.classList.add("scenario-code-syncing");
    document.body.classList.add("scenario-view-syncing");
    let barrier;
    if (needsParsedBarrier) {
      barrier = ensureScenarioReadBarrier();
    } else if (state.codeSyncPromise) {
      barrier = state.codeSyncPromise;
    } else if (needsCodeBarrier) {
      const sync = Promise.resolve(flushPendingEdits());
      state.codeSyncPromise = sync;
      sync.then(
        () => {
          if (state.codeSyncPromise === sync) state.codeSyncPromise = null;
        },
        () => {
          if (state.codeSyncPromise === sync) state.codeSyncPromise = null;
        },
      );
      barrier = sync;
    } else {
      barrier = state.viewTransitionPromise || flushPendingEdits();
    }
    const barrierPromise = Promise.resolve(barrier);
    if (!state.viewTransitionPromise) state.viewTransitionSourceView = rollbackView;
    state.viewTransitionPromise = barrierPromise;
    barrierPromise.then(
      () => {
        if (state.viewTransitionPromise === barrierPromise) {
          state.viewTransitionPromise = null;
          state.viewTransitionSourceView = "";
        }
      },
      () => {
        if (state.viewTransitionPromise === barrierPromise) {
          state.viewTransitionPromise = null;
          state.viewTransitionSourceView = "";
        }
      },
    );
    const transition = barrierPromise
      .then(() => {
        if (activationId !== state.viewActivationId || state.view !== name) return false;
        return Promise.resolve(render ? render() : null).then(() => {
          saveUiPrefs();
          return true;
        });
      })
      .catch((error) => {
        if (activationId === state.viewActivationId && state.view === name) {
          // DOMは切替前のまま保持されている。失敗時にrendererを再実行すると、
          // dirty textareaを古いstate.scenario.textで上書きするためshellだけ戻す。
          applyViewShell(rollbackView);
        }
        showError(error);
        return false;
      })
      .finally(() => {
        if (activationId === state.viewActivationId) {
          document.body.classList.remove("scenario-code-syncing");
          document.body.classList.remove("scenario-view-syncing");
        }
      });
    return transition;
  }

  // freshness待ちがない通常経路はrendererを同期呼出しし、直後のfocus/jumpが
  // 最新DOMを参照できる既存契約を保つ。
  if (name === "code") document.body.classList.remove("scenario-code-syncing");
  document.body.classList.remove("scenario-view-syncing");
  let renderResult;
  try {
    renderResult = render ? render() : null;
    saveUiPrefs();
  } catch (error) {
    showError(error);
    return Promise.resolve(false);
  }
  return Promise.resolve(renderResult)
    .then(() => true)
    .catch((error) => {
      showError(error);
      return false;
    });
}

/* ---------- quick open (⌘P) ---------- */

function openQuickOpen(mode = "files") {
  state.quickOpenMode = mode;
  state.quickOpenIndex = 0;
  state.quickOpenResults = [];
  const overlay = $("#quickOpen");
  overlay.classList.remove("hidden");
  const input = $("#quickOpenInput");
  input.value = "";
  input.placeholder = mode === "files" ? "シナリオを検索…" : "全シナリオを全文検索…（2文字以上）";
  $$("#quickOpenTabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  // ファイルモードは入力なしでも現在のプロジェクトの一覧を即表示する
  refreshQuickOpenResults().catch(showError);
  setTimeout(() => input.focus(), 0);
}

function closeQuickOpen() {
  $("#quickOpen").classList.add("hidden");
}

function quickOpenItems() {
  return state.quickOpenResults;
}

async function refreshQuickOpenResults() {
  const query = $("#quickOpenInput").value.trim();
  if (state.quickOpenMode === "files") {
    const lower = query.toLowerCase();
    state.quickOpenResults = state.scenarios
      .filter((item) => !lower || item.storage.toLowerCase().includes(lower))
      .slice(0, 80)
      .map((item) => ({
        kind: "file",
        title: item.storage,
        meta: `${item.lineCount}行 / ${item.labels} labels / ${item.choices} choices`,
        file: item.storage,
        line: 0,
      }));
  } else {
    if (query.length < 2) {
      state.quickOpenResults = [];
    } else {
      const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
      if ($("#quickOpenInput").value.trim() !== query) return;
      state.quickOpenResults = (data.matches || []).slice(0, 120).map((match) => ({
        kind: "match",
        title: `${match.file}:${match.line + 1}`,
        meta: match.text,
        file: match.file,
        line: match.line,
      }));
    }
  }
  state.quickOpenIndex = 0;
  renderQuickOpenResults();
}

function renderQuickOpenResults() {
  const root = $("#quickOpenResults");
  const items = quickOpenItems();
  if (!items.length) {
    root.innerHTML = `<div class="qo-empty">${state.quickOpenMode === "files" ? "シナリオがありません" : "検索語を入力してください"}</div>`;
    return;
  }
  root.innerHTML = items
    .map(
      (item, index) => `
      <button class="qo-item${index === state.quickOpenIndex ? " active" : ""}" data-index="${index}">
        <span class="qo-title">${escapeHtml(item.title)}</span>
        <span class="qo-meta">${escapeHtml(item.meta || "")}</span>
      </button>`,
    )
    .join("");
  const active = root.querySelector(".qo-item.active");
  if (active) active.scrollIntoView({ block: "nearest" });
}

async function commitQuickOpen(index = state.quickOpenIndex) {
  const item = quickOpenItems()[index];
  if (!item) return;
  closeQuickOpen();
  if (item.file !== state.currentFile) {
    await loadScenario(item.file, { line: item.line });
  } else {
    selectTimelineLine(item.line, { scroll: true });
  }
  activateView("editor");
  scrollSelectedLineIntoView();
  setStatus(`${item.file}:${item.line + 1} を開きました`);
}

function bindQuickOpen() {
  $("#quickOpen").addEventListener("mousedown", (event) => {
    if (event.target.id === "quickOpen") closeQuickOpen();
  });
  $$("#quickOpenTabs button").forEach((button) => {
    button.addEventListener("click", () => {
      openQuickOpen(button.dataset.mode);
    });
  });
  $("#quickOpenInput").addEventListener("input", debounce(() => {
    refreshQuickOpenResults().catch(showError);
  }, 160));
  $("#quickOpenInput").addEventListener("keydown", (event) => {
    const items = quickOpenItems();
    if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) {
      event.preventDefault();
      state.quickOpenIndex = Math.min(items.length - 1, state.quickOpenIndex + 1);
      renderQuickOpenResults();
    } else if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) {
      event.preventDefault();
      state.quickOpenIndex = Math.max(0, state.quickOpenIndex - 1);
      renderQuickOpenResults();
    } else if (event.key === "Enter") {
      event.preventDefault();
      commitQuickOpen().catch(showError);
    } else if (event.key === "Escape") {
      closeQuickOpen();
    } else if (event.key === "Tab") {
      event.preventDefault();
      openQuickOpen(state.quickOpenMode === "files" ? "search" : "files");
    }
  });
  $("#quickOpenResults").addEventListener("click", (event) => {
    const item = event.target.closest(".qo-item");
    if (item) commitQuickOpen(Number(item.dataset.index)).catch(showError);
  });
}

/* ---------- scenario data ---------- */

function activeViewName() {
  return state.view;
}

function clampScenarioLine(line) {
  const max = Math.max(0, (state.scenario?.parsed?.entries?.length || 1) - 1);
  return Math.max(0, Math.min(Math.floor(Number(line) || 0), max));
}

function updateCurrentScenarioMeta() {
  const scenario = state.scenario;
  if (!scenario) return;
  const parsed = scenario.parsed || {};
  const index = state.scenarios.findIndex((item) => item.storage === scenario.storage);
  const next = {
    ...(index >= 0 ? state.scenarios[index] : {}),
    storage: scenario.storage,
    lineCount: parsed.lineCount || 0,
    labels: (parsed.labels || []).length,
    jumps: (parsed.jumps || []).length,
    choices: (parsed.choices || []).length,
    diagnostics: (parsed.diagnostics || []).length,
    size: scenario.stat?.size || 0,
    mtimeMs: scenario.stat?.mtimeMs || 0,
  };
  if (index >= 0) {
    state.scenarios[index] = next;
  } else {
    state.scenarios.push(next);
    state.scenarios.sort((a, b) => a.storage.localeCompare(b.storage, "ja"));
  }
}

function commitScenarioPayload(scenario, options = {}) {
  if (!scenario || !scenario.parsed) return;
  const previousScenario = state.scenario;
  if (
    previousScenario &&
    (previousScenario.storage || state.currentFile) === (scenario.storage || state.currentFile) &&
    previousScenario.text !== scenario.text
  ) {
    state.timelineStructureRevision += 1;
  }
  state.scenarioNeedsReload = false;
  state.currentFile = scenario.storage || state.currentFile;
  state.scenario = scenario;
  state.selectedLine = clampScenarioLine(Number.isFinite(options.line) ? options.line : state.selectedLine);
  updateCurrentScenarioMeta();
  updateBreadcrumb();
  renderScenarioSidebar();
  // KS本文はコードビュー表示中だけ同期する。非表示中のCodeMirrorへ全文
  // transactionを送らず、表示時に一度だけ最新documentへ差し替える。
  // 非表示中の変更はコードビュー表示時（registerView("code")）に同期される。
  if (
    options.updateRawEditor !== false &&
    state.view === "code" &&
    !rawEditorHasFocus()
  ) {
    const raw = $("#rawEditor");
    // 同一documentの再transactionは選択・undo履歴を乱すため行わない。
    if (raw && raw.value !== state.scenario.text) {
      raw.value = state.scenario.text;
      raw._ksCodeMirror?.markSynced(state.currentFile, currentHash());
      scheduleRawHighlight();
    }
  }
  renderLabelSelect();
  if (options.renderTimeline !== false) {
    renderTimeline(true);
    state.timelineNeedsRender = false;
  } else {
    state.timelineNeedsRender = true;
    updateTimelineActive();
    updateTimelineRow(state.selectedLine);
  }
  if (options.renderInspector !== false) renderInspector();
  if (state.view === "flow" && options.renderFlow !== false) renderFlow();
  if (state.deferredEditKinds.size) queueMicrotask(resumeDeferredEditTasks);
}

async function flushPendingEdits() {
  // 保存中にさらに入力された場合、各run*AutoSaveは queued を立てて次のtimerを
  // 予約する。1回だけPromise.allするとその2巡目を取りこぼすため、timer・task・
  // writeが全て空になるまで排水する。
  for (let round = 0; round < 12; round += 1) {
    let startedRunner = false;
    const start = (kind, timerKey, queuedKey, inFlightKey, runner) => {
      if (startedRunner) return;
      if (state[timerKey]) {
        clearTimeout(state[timerKey]);
        state[timerKey] = null;
        startPendingEditRunner(kind, runner, { report: false });
        startedRunner = true;
      } else if (state[queuedKey] && !state[inFlightKey]) {
        state[queuedKey] = false;
        startPendingEditRunner(kind, runner, { report: false });
        startedRunner = true;
      }
    };
    start("line", "lineSaveTimer", "lineSaveQueued", "lineSaveInFlight", runLineAutoSave);
    start("raw", "rawSaveTimer", "rawSaveQueued", "rawSaveInFlight", runRawAutoSave);
    start("block", "blockSaveTimer", "blockSaveQueued", "blockSaveInFlight", runBlockAutoSave);
    start("tag", "tagSaveTimer", "tagSaveQueued", "tagSaveInFlight", () => saveTagAttrs({ auto: true }));
    if (!startedRunner && !state.pendingSaveError && state.deferredEditKinds.size) {
      const kind = state.deferredEditKinds.values().next().value;
      const runner = pendingEditRunnerFor(kind);
      state.deferredEditKinds.delete(kind);
      if (runner) {
        startPendingEditRunner(kind, runner, { report: false });
        startedRunner = true;
      }
    }

    const waiting = new Set([...state.pendingEditTasks, ...state.pendingScenarioWrites]);
    if (!waiting.size) {
      if (state.pendingSaveError) throw state.pendingSaveError.error;
      return [];
    }
    // 全要求をsettleさせて排水しつつ、保存失敗は必ず呼び出し元へ返す。
    // 失敗を成功扱いすると、未保存本文が次のGETで上書きされ得る。
    const settled = await Promise.allSettled([...waiting]);
    const failure = settled.find(
      (item) => item.status === "rejected" && !item.reason?.__nonDirtyScenarioConflict,
    );
    if (failure) throw failure.reason;
    if (
      !state.lineSaveTimer && !state.rawSaveTimer && !state.blockSaveTimer && !state.tagSaveTimer &&
      !state.pendingEditTasks.size && !state.pendingScenarioWrites.size &&
      !state.lineSaveQueued && !state.rawSaveQueued && !state.blockSaveQueued && !state.tagSaveQueued &&
      !state.deferredEditKinds.size
    ) {
      if (state.pendingSaveError) throw state.pendingSaveError.error;
      return [];
    }
  }
  throw new Error("保存要求が連続しているため、同期を完了できませんでした");
}

function loadScenario(storage, options = {}) {
  const backgroundFreshness = options.backgroundFreshness === true;
  // 内部freshnessは、すでに始まっているユーザー明示遷移を追い越さない。
  if (backgroundFreshness && state.scenarioNavigationPromise) {
    return state.scenarioNavigationPromise.then(() => state.scenario);
  }
  const navigationIntentId = backgroundFreshness
    ? state.scenarioNavigationIntentId
    : (state.scenarioNavigationIntentId += 1);
  const requestId = (state.scenarioLoadRequestId += 1);
  const task = performScenarioLoad(storage, options, {
    backgroundFreshness,
    navigationIntentId,
    requestId,
  });
  if (backgroundFreshness) return task;
  let tracked;
  tracked = task.finally(() => {
    if (state.scenarioNavigationPromise === tracked) state.scenarioNavigationPromise = null;
  });
  state.scenarioNavigationPromise = tracked;
  return tracked;
}

function scenarioLoadIsCurrent(context) {
  return Boolean(
    context.requestId === state.scenarioLoadRequestId &&
    (!context.backgroundFreshness || context.navigationIntentId === state.scenarioNavigationIntentId)
  );
}

async function performScenarioLoad(storage, options, context) {
  // プレビュー追従・サイドバー・クイックオープンが短時間に競合しても、
  // 最後に要求されたファイル以外を遅いレスポンスで上書きしない。
  const switching = storage !== state.currentFile;
  if (switching || options.flush) {
    await flushPendingEdits();
    if (!scenarioLoadIsCurrent(context)) return null;
  }
  if (switching) {
    state.multiSelected.clear();
    state.inlineEditLine = -1;
    state.blockEdit = null;
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!scenarioLoadIsCurrent(context)) return null;
    if (state.scenarioLoadController) state.scenarioLoadController.abort();
    const controller = new AbortController();
    state.scenarioLoadController = controller;
    const writeRevisionAtRequest = state.scenarioWriteRevision;
    let scenario;
    try {
      scenario = await api(`/api/scenario?file=${encodeURIComponent(storage)}`, {
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") return null;
      throw error;
    } finally {
      if (state.scenarioLoadController === controller) state.scenarioLoadController = null;
    }
    if (!scenarioLoadIsCurrent(context)) return null;
    if (writeRevisionAtRequest !== state.scenarioWriteRevision) {
      // GET H1 のあと保存 H2 が始まったら、H1をcommitせずwrite settle後に
      // 同じrequest/intent内でGETをやり直す。
      if (storage === state.currentFile) state.scenarioNeedsReload = true;
      const writes = [...state.pendingScenarioWrites];
      if (writes.length) {
        const settled = await Promise.allSettled(writes);
        const failure = settled.find((item) => item.status === "rejected");
        if (failure) throw failure.reason;
      }
      continue;
    }
    commitScenarioPayload(scenario, {
      line: Number.isFinite(options.line) ? options.line : 0,
    });
    document.body.classList.remove("scenario-refreshing");
    if (options.remember !== false) rememberCurrentFile({ immediate: options.immediateRemember !== false });
    if (!options.quiet) setStatus(`${storage} を読み込みました`);
    return scenario;
  }
  if (storage === state.currentFile) state.scenarioNeedsReload = true;
  throw new Error(`${storage} は保存と読み込みが競合したため、同期を完了できませんでした`);
}

async function ensureCurrentScenarioFresh(options = {}) {
  if (!state.scenarioNeedsReload || !state.currentFile) return state.scenario;
  const file = state.currentFile;
  const line = Number.isFinite(options.line) ? options.line : state.selectedLine;
  return loadScenario(file, {
    line,
    quiet: true,
    flush: options.flush !== false,
    remember: false,
    backgroundFreshness: true,
  });
}

async function refreshScenarioMeta() {
  const scenarios = await api("/api/scenarios");
  state.scenarios = scenarios.scenarios;
}

function updateBreadcrumb() {
  const project = $("#crumbProject .crumb-label");
  const scenario = $("#crumbScenario .crumb-label");
  if (project && state.project) {
    project.textContent = state.project.projectRoot.split("/").pop();
  }
  if (scenario) scenario.textContent = state.currentFile || "—";
}

async function loadAll(options = {}) {
  setStatus("プロジェクトを読み込み中…");
  const [project, scenarios, assets, characters, projects] = await Promise.all([
    api("/api/project"),
    api("/api/scenarios"),
    api("/api/assets"),
    api("/api/characters"),
    api("/api/projects"),
  ]);
  state.project = project;
  // サーバーに保存された UI 設定があれば適用（フォルダ開閉・テーマ・ペイン幅などを再起動後も復元）
  hydrateUiPrefsFromServer(project.uiPrefs);
  state.scenarios = scenarios.scenarios;
  state.assets = assets.assets;
  state.catalog = characters.catalog;
  state.projects = projects.projects;
  state.projectsRoots = projects.roots;
  if (options.resetFile || !state.currentFile) {
    // 前回このプロジェクトで開いていたファイルがあれば復元する
    const serverRemembered = project.lastFile?.file ? project.lastFile : null;
    const remembered = serverRemembered || state.lastFiles[project.projectRoot];
    const rememberedMeta = remembered && state.scenarios.find((item) => item.storage === remembered.file);
    const preferred =
      rememberedMeta ||
      state.scenarios.find((item) => item.storage === "first.ks") ||
      state.scenarios.find((item) => item.storage === "scene1.ks") ||
      state.scenarios[0];
    state.currentFile = preferred ? preferred.storage : "";
    state.selectedLine = rememberedMeta ? Number(remembered.line) || 0 : 0;
  }
  updateBreadcrumb();
  renderPalette();
  renderScenarioSidebar();
  if (state.currentFile) {
    await loadScenario(state.currentFile, { quiet: true, line: state.selectedLine });
  }
  setStatus("読み込み完了");
}

/* ---------- project switching ---------- */

async function openProject(projectPath) {
  await flushPendingEdits();
  setStatus("プロジェクトを切り替え中…");
  await api("/api/project/open", {
    method: "POST",
    body: JSON.stringify({ path: projectPath }),
  });
  resetScenarioCoordinationForProject();
  state.currentFile = "";
  state.selectedLine = 0;
  state.scenario = null;
  state.selectedAsset = null;
  state.assetFolder = null;
  state.inlineEditLine = -1;
  state.blockEdit = null;
  state.previewStarted = false;
  state.buildResult = null;
  state.buildIcon = null;
  state.settings = null;
  state.multiSelected.clear();
  state.quickOpenResults = [];
  state.globalSearch = { query: "", matches: [], truncated: false };
  clearEditHistory();
  stopPreview();
  $("#previewState").textContent = "未起動";
  await loadAll({ resetFile: true });
  closeProjectMenu();
  activateView("editor");
  toast(`${projectPath.split("/").pop()} を開きました`, "success");
}

function resetScenarioCoordinationForProject() {
  state.scenarioLoadRequestId += 1;
  state.scenarioNavigationIntentId += 1;
  state.scenarioLoadController?.abort();
  state.scenarioLoadController = null;
  state.scenarioNavigationPromise = null;
  state.scenarioRefreshPromise = null;
  state.codeSyncPromise = null;
  state.viewTransitionPromise = null;
  state.viewTransitionSourceView = "";
  state.scenarioNeedsReload = false;
  state.pendingSaveError = null;
  state.scenarioWriteRevisionByFile.clear();
  state.scenarioSuccessfulWriteRevisionByFile.clear();
  state.scenarioWriteActiveByFile.clear();
  state.editTaskSerialPromise = null;
  state.deferredEditKinds.clear();
  document.body.classList.remove("scenario-refreshing", "scenario-code-syncing", "scenario-view-syncing");
  window.dispatchEvent(new CustomEvent("tyranoforge-project-changed"));
}

/* ---------- project menu (titlebar dropdown) ---------- */

function projectTree() {
  const groups = new Map();
  state.projects.forEach((project) => {
    const key = project.folder || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(project);
  });
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "ja"));
}

function renderProjectMenu() {
  const root = $("#projectMenuList");
  const query = ($("#projectMenuSearch").value || "").trim().toLowerCase();
  const groups = projectTree();
  root.innerHTML = "";
  groups.forEach(([folder, projects]) => {
    const filtered = projects.filter(
      (project) =>
        !query ||
        project.name.toLowerCase().includes(query) ||
        (project.title || "").toLowerCase().includes(query),
    );
    if (!filtered.length) return;
    if (folder) {
      const head = document.createElement("div");
      head.className = "pm-folder";
      head.innerHTML = `<span class="pm-folder-icon">▸</span>${escapeHtml(folder)}`;
      root.appendChild(head);
    }
    filtered.forEach((project) => {
      const button = document.createElement("button");
      const active = state.project && project.path === state.project.projectRoot;
      button.className = `pm-item${active ? " active" : ""}${folder ? " nested" : ""}`;
      button.innerHTML = `
        <span class="pm-name">${escapeHtml(project.name)}</span>
        <span class="pm-title">${escapeHtml(project.title || "")}</span>
      `;
      button.addEventListener("click", () => {
        if (!active) openProject(project.path).catch(showError);
        else closeProjectMenu();
      });
      root.appendChild(button);
    });
  });
  if (!root.children.length) {
    root.innerHTML = `<div class="qo-empty">プロジェクトが見つかりません</div>`;
  }
}

function openProjectMenu() {
  api("/api/projects")
    .then((data) => {
      state.projects = data.projects;
      state.projectsRoots = data.roots;
      renderProjectMenu();
    })
    .catch(showError);
  $("#projectMenu").classList.remove("hidden");
  $("#projectMenuSearch").value = "";
  renderProjectMenu();
  setTimeout(() => $("#projectMenuSearch").focus(), 0);
}

function closeProjectMenu() {
  $("#projectMenu").classList.add("hidden");
}

function bindProjectMenu() {
  $("#crumbProject").addEventListener("click", () => {
    if ($("#projectMenu").classList.contains("hidden")) openProjectMenu();
    else closeProjectMenu();
  });
  $("#crumbScenario").addEventListener("click", () => openQuickOpen("files"));
  $("#projectMenuSearch").addEventListener("input", debounce(renderProjectMenu, 120));
  $("#projectMenuSearch").addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeProjectMenu();
  });
  $("#projectMenuHome").addEventListener("click", () => {
    closeProjectMenu();
    activateView("home");
  });
  $("#projectMenuNew").addEventListener("click", () => {
    closeProjectMenu();
    openNewProjectModal();
  });
  document.addEventListener("mousedown", (event) => {
    const menu = $("#projectMenu");
    if (menu.classList.contains("hidden")) return;
    if (!menu.contains(event.target) && !$("#crumbProject").contains(event.target)) {
      closeProjectMenu();
    }
  });
}

/* ---------- global keyboard ---------- */

function bindGlobalKeys() {
  document.addEventListener("keydown", (event) => {
    // 日本語IMEの候補確定・移動中はアプリのショートカットとして扱わない。
    if (
      event.isComposing ||
      event.keyCode === 229 ||
      (rawEditorHasFocus() &&
        typeof rawEditorComposing !== "undefined" &&
        (rawEditorComposing || rawCompositionCommitPending))
    ) return;
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === "f" && state.view === "code") {
      event.preventDefault();
      openRawFind();
      return;
    }
    if (meta && event.key.toLowerCase() === "p") {
      event.preventDefault();
      openQuickOpen(event.shiftKey ? "search" : "files");
      return;
    }
    if (
      meta &&
      event.key.toLowerCase() === "s" &&
      document.body.classList.contains("scenario-code-syncing")
    ) {
      event.preventDefault();
      setStatus("KS本文を同期しています…");
      return;
    }
    if (meta && event.key.toLowerCase() === "s") {
      event.preventDefault();
      const focusedId = document.activeElement?.id || "";
      if (focusedId === "lineEditor") startPendingEditRunner("line", () => saveSelectedLine());
      else if (focusedId === "blockEditor") flushPendingEdits().catch(showError);
      else if (document.activeElement?.matches?.("[data-tag-attr]")) {
        startPendingEditRunner("tag", () => saveTagAttrs());
      }
      else if (focusedId === "configTjsEditor") saveConfigTjsRaw().catch(showError);
      else if (focusedId === "builderConfigEditor") saveBuilderConfigRaw().catch(showError);
      else if (state.view === "code") startPendingEditRunner("raw", () => saveRaw());
      else saveRaw().catch(showError);
      return;
    }
    // 軽量raw保存後のparsed再取得中（またはその失敗後）は、旧data-lineを
    // キーボード操作で変更させない。rail/view切替とEscapeは引き続き使える。
    const isViewShortcut = meta && event.key >= "0" && event.key <= "9";
    const activeTagDuringRefresh = document.activeElement?.tagName || "";
    if (
      state.view === "editor" &&
      document.body.classList.contains("scenario-refreshing") &&
      !isViewShortcut &&
      event.key !== "Escape" &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(activeTagDuringRefresh)
    ) {
      event.preventDefault();
      setStatus("保存内容を同期しています…");
      return;
    }
    // ⌘Z / ⌘⇧Z / ⌘Y — ファイルへ適用済みの変更のアンドゥ・リドゥ。
    // 入力欄フォーカス中はフィールド自身のネイティブ undo に任せる。
    if (meta && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
      const activeTag = document.activeElement?.tagName || "";
      if (["INPUT", "TEXTAREA", "SELECT"].includes(activeTag)) return;
      if (state.view !== "editor" || !state.scenario) return;
      event.preventDefault();
      const isRedo = event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey);
      (isRedo ? redoEdit() : undoEdit()).catch(showError);
      return;
    }
    if (meta && event.key >= "1" && event.key <= "8") {
      const views = ["editor", "assets", "flow", "code", "diagnostics", "settings", "build", "home"];
      const view = views[Number(event.key) - 1];
      if (view) {
        event.preventDefault();
        activateView(view);
      }
      return;
    }
    if (event.key === "Escape") {
      if (!$("#quickOpen").classList.contains("hidden")) return closeQuickOpen();
      if (!$("#projectMenu").classList.contains("hidden")) return closeProjectMenu();
      if (state.theater) return setTheater(false);
      if (state.blockEdit) return closeBlockEditor();
      return;
    }
    const tagName = document.activeElement?.tagName || "";
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tagName)) return;
    if (state.view !== "editor" || !state.scenario) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelectedLines().catch(showError);
      return;
    }
    // ⌘C / ⌘X / ⌘V — タイムライン行のコピー・カット・貼り付け
    if (meta && event.key.toLowerCase() === "c") {
      // 行内テキストを範囲選択している場合はブラウザ既定のコピーに任せる
      const selectionText = window.getSelection ? String(window.getSelection()).trim() : "";
      if (selectionText) return;
      event.preventDefault();
      copySelectedRows().catch(showError);
      return;
    }
    if (meta && event.key.toLowerCase() === "x") {
      event.preventDefault();
      cutSelectedRows().catch(showError);
      return;
    }
    if (meta && event.key.toLowerCase() === "v") {
      event.preventDefault();
      pasteRows().catch(showError);
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const nextLine = state.selectedLine + (event.key === "ArrowDown" ? 1 : -1);
    if (event.shiftKey) {
      // Shift+↑↓ で選択範囲を拡張
      extendSelectionTo(nextLine);
      scrollSelectedLineIntoView();
      return;
    }
    selectTimelineLine(nextLine, { scroll: true });
  });
}
