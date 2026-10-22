"use strict";

/* ============================================================
   Editor view — palette / timeline / inspector / preview dock
   ============================================================ */

/* ---------- save state indicator ---------- */

function setSaveState(text, kind = "idle") {
  const node = $("#saveState");
  if (!node) return;
  node.textContent = text;
  node.dataset.kind = kind;
}

/* ---------- component palette ---------- */

function paletteContext() {
  return {
    currentFile: () => state.currentFile,
    nextLabelName: () => {
      const labels = state.scenario?.parsed?.labels || [];
      let index = labels.length + 1;
      while (labels.some((label) => label.name === `label_${index}`)) index += 1;
      return `label_${index}`;
    },
    defaultCharaName: () => charaDefaults().name || "chara",
    selectedAssetFor: (kind) =>
      state.selectedAssetKind === kind && state.selectedAsset ? state.selectedAsset.storage : "",
  };
}

function charaDefaults() {
  const catalog = state.catalog?.characters || {};
  const names = Object.keys(catalog);
  const name = state.catalog?.defaultCharacter || names[0] || "";
  const chara = catalog[name] || {};
  const appearance = chara.defaultAppearance || Object.keys(chara.appearances || {})[0] || "default";
  const variant = Object.keys(chara.appearances?.[appearance]?.variants || {})[0] || "normal";
  return { name, appearance, variant };
}

function componentContent(component) {
  if (component.special === "chara_catalog") {
    const defaults = charaDefaults();
    return tagLine("tatie", {
      name: defaults.name,
      appearance: defaults.appearance,
      variant: defaults.variant,
      position: "center",
      mode: "show",
      time: 500,
      wait: "true",
      reflect: "false",
    });
  }
  return component.make(paletteContext());
}

function paletteItemById(id) {
  return PALETTE_COMPONENTS.find((component) => component.id === id) || null;
}

function renderPalette() {
  const root = $("#palette");
  if (!root) return;
  const query = ($("#paletteSearch")?.value || "").trim().toLowerCase();
  const list = root.querySelector(".palette-groups");
  list.innerHTML = "";
  const hasCatalog = Object.keys(state.catalog?.characters || {}).length > 0;
  CATEGORIES.forEach((category) => {
    const items = PALETTE_COMPONENTS.filter((component) => {
      if (component.catId !== category.id) return false;
      if (component.special === "chara_catalog" && !hasCatalog) return false;
      if (query) return component.label.toLowerCase().includes(query) || component.id.includes(query);
      return true;
    });
    if (!items.length) return;
    const collapsed = !query && Boolean(state.paletteCollapsed[category.id]);
    const section = document.createElement("section");
    section.className = `palette-group${collapsed ? " collapsed" : ""}`;
    const head = document.createElement("button");
    head.type = "button";
    head.className = `palette-group-head cat-${category.cat}`;
    head.innerHTML = `<span>${escapeHtml(category.label)}</span><span class="palette-caret">${collapsed ? "▸" : "▾"}</span>`;
    head.addEventListener("click", () => {
      state.paletteCollapsed[category.id] = !collapsed;
      saveUiPrefs();
      renderPalette();
    });
    section.appendChild(head);
    const body = document.createElement("div");
    body.className = "palette-items";
    items.forEach((component) => {
      const node = document.createElement("div");
      node.className = `palette-item cat-${category.cat}`;
      node.draggable = true;
      node.title = `${component.label}\nドラッグでタイムラインへ / ダブルクリックで選択行の下に挿入`;
      node.innerHTML = `<span class="palette-icon">${escapeHtml(component.icon)}</span><span class="palette-label">${escapeHtml(component.label)}</span>`;
      node.addEventListener("dragstart", (event) => {
        state.dragItem = component;
        event.dataTransfer.setData("text/plain", component.id);
        event.dataTransfer.effectAllowed = "copy";
        node.classList.add("dragging");
      });
      node.addEventListener("dragend", () => {
        state.dragItem = null;
        node.classList.remove("dragging");
        hideDropIndicator();
      });
      node.addEventListener("dblclick", () => {
        insertPaletteItem(component, state.selectedLine, "after").catch(showError);
      });
      body.appendChild(node);
    });
    section.appendChild(body);
    list.appendChild(section);
  });
}

/* ---------- scenario sidebar (常設ファイル一覧) ---------- */

function buildScenarioTree(scenarios) {
  const root = { name: "", path: "", folders: new Map(), files: [] };
  scenarios.forEach((item) => {
    const parts = String(item.storage).split("/");
    const fileName = parts.pop();
    let node = root;
    let acc = "";
    parts.forEach((part) => {
      acc = acc ? `${acc}/${part}` : part;
      if (!node.folders.has(part)) {
        node.folders.set(part, { name: part, path: acc, folders: new Map(), files: [] });
      }
      node = node.folders.get(part);
    });
    node.files.push({ ...item, fileName });
  });
  return root;
}

function countScenarioFiles(node) {
  let total = node.files.length;
  node.folders.forEach((child) => {
    total += countScenarioFiles(child);
  });
  return total;
}

function scenarioFileItemHtml(item, depth) {
  const active = item.storage === state.currentFile;
  const bits = [`${item.lineCount || 0}行`];
  if (item.labels) bits.push(`${item.labels}ラベル`);
  if (item.choices) bits.push(`${item.choices}分岐`);
  const diag = item.diagnostics
    ? `<span class="ss-item-diag" title="${item.diagnostics}件の診断">⚠ ${item.diagnostics}</span>`
    : "";
  const pad = 8 + depth * 13;
  return `
    <button class="ss-item${active ? " active" : ""}" data-file="${escapeAttr(item.storage)}" title="${escapeAttr(item.storage)}" style="padding-left:${pad}px">
      <span class="ss-item-name">${escapeHtml(item.fileName)}</span>
      <span class="ss-item-meta">${escapeHtml(bits.join(" · "))}</span>
      ${diag}
    </button>`;
}

// 再帰的にツリーの HTML 行を組み立てる（query 指定時は該当ファイルのみ／該当フォルダは強制展開）
function scenarioTreeRows(node, depth, query) {
  const rows = [];
  const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"));
  folders.forEach((folder) => {
    const childRows = scenarioTreeRows(folder, depth + 1, query);
    if (query && !childRows.length) return; // フィルタ中で中身が無いフォルダは隠す
    const collapsed = query ? false : Boolean(state.scenarioFolders[folder.path]);
    const pad = 8 + depth * 13;
    rows.push(`
      <button class="ss-folder${collapsed ? " collapsed" : ""}" data-folder="${escapeAttr(folder.path)}" title="${escapeAttr(folder.path)}" style="padding-left:${pad}px">
        <span class="ss-folder-caret">${collapsed ? "▸" : "▾"}</span>
        <svg class="ss-folder-icon" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
        <span class="ss-folder-name">${escapeHtml(folder.name)}</span>
        <span class="ss-folder-count">${countScenarioFiles(folder)}</span>
      </button>`);
    if (!collapsed) rows.push(...childRows);
  });
  node.files
    .filter((item) => !query || item.storage.toLowerCase().includes(query))
    .sort((a, b) => a.fileName.localeCompare(b.fileName, "ja"))
    .forEach((item) => rows.push(scenarioFileItemHtml(item, depth)));
  return rows;
}

// 直近に描画したサイドバーの内容キー。自動保存のたびに commitScenarioPayload
// から呼ばれるため、表示内容に影響する要素が変わっていなければ DOM を
// 作り直さない（毎保存の全再構築はタイピング中の累積負荷になる）。
let scenarioSidebarKey = "";

function renderScenarioSidebar() {
  const list = $("#scenarioList");
  if (!list) return;
  const scenarios = state.scenarios || [];
  const countEl = $("#scenarioCount");
  if (countEl) countEl.textContent = scenarios.length ? String(scenarios.length) : "";
  const query = (state.scenarioFilterQuery || "").trim().toLowerCase();
  const key = [
    state.currentFile,
    query,
    JSON.stringify(state.scenarioFolders),
    scenarios
      .map((item) => `${item.storage}:${item.lineCount}:${item.labels}:${item.choices}:${item.diagnostics}`)
      .join("|"),
  ].join("\u0000");
  if (key === scenarioSidebarKey && list.childElementCount) return;
  scenarioSidebarKey = key;
  const tree = buildScenarioTree(scenarios);
  const rows = scenarioTreeRows(tree, 0, query);
  if (!rows.length) {
    list.innerHTML = `<div class="ss-empty">${scenarios.length ? "該当するシナリオがありません" : "シナリオがありません"}</div>`;
    return;
  }
  list.innerHTML = rows.join("");
  const activeEl = list.querySelector(".ss-item.active");
  if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
}

function applyScenarioCollapsed() {
  const editor = $("#view-editor");
  if (editor) editor.classList.toggle("scenario-collapsed", state.scenarioCollapsed);
  const btn = $("#scenarioCollapseBtn");
  if (btn) btn.title = state.scenarioCollapsed ? "一覧をひらく" : "一覧をたたむ";
}

function setScenarioCollapsed(collapsed) {
  state.scenarioCollapsed = Boolean(collapsed);
  applyScenarioCollapsed();
  saveUiPrefs({ immediate: true });
  notifyPreviewResize();
}

function bindScenarioSidebar() {
  $("#scenarioList").addEventListener("click", (event) => {
    const folder = event.target.closest(".ss-folder");
    if (folder) {
      const path = folder.dataset.folder;
      if (state.scenarioFolders[path]) delete state.scenarioFolders[path];
      else state.scenarioFolders[path] = true;
      saveUiPrefs({ immediate: true });
      renderScenarioSidebar();
      return;
    }
    const item = event.target.closest(".ss-item");
    if (!item) return;
    const file = item.dataset.file;
    if (!file || file === state.currentFile) return;
    loadScenario(file, { line: 0 })
      .then(() => {
        activateView("editor");
        scrollSelectedLineIntoView();
      })
      .catch(showError);
  });
  $("#scenarioFilter").addEventListener("input", debounce((event) => {
    state.scenarioFilterQuery = event.target.value || "";
    renderScenarioSidebar();
  }, 120));
  $("#scenarioFilter").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.target.value = "";
      state.scenarioFilterQuery = "";
      renderScenarioSidebar();
    }
  });
  $("#scenarioNewBtn").addEventListener("click", openNewScenarioModal);
  $("#scenarioCollapseBtn").addEventListener("click", () => setScenarioCollapsed(true));
  $("#scenarioExpandBtn").addEventListener("click", () => setScenarioCollapsed(false));
}

/* ---------- undo / redo (⌘Z / ⌘⇧Z / ⌘Y) ---------- */

const HISTORY_LIMIT = 100;
// 全ファイル合計のスナップショット上限（概算バイト）。全文スナップショットを
// 無制限に貯めるとセッションが長引くほどメモリと GC 圧が増え続けるため、
// 超過したら古いものから捨てる。
const HISTORY_BYTE_BUDGET = 24 * 1024 * 1024;
const editHistory = new Map(); // storage -> { undo: [{text, line}], redo: [...] }
let historySuppress = false;
let lastHistoryPush = { file: "", kind: "", line: -1, at: 0 };

function historyFor(file) {
  if (!editHistory.has(file)) editHistory.set(file, { undo: [], redo: [] });
  return editHistory.get(file);
}

function historyTotalBytes() {
  let total = 0;
  editHistory.forEach((stack) => {
    stack.undo.forEach((entry) => { total += entry.text.length; });
    stack.redo.forEach((entry) => { total += entry.text.length; });
  });
  return total * 2; // UTF-16
}

function trimHistoryToBudget() {
  let total = historyTotalBytes();
  if (total <= HISTORY_BYTE_BUDGET) return;
  // 現在ファイル以外 → 現在ファイルの順で捨てる
  const files = [...editHistory.keys()].sort(
    (a, b) => (a === state.currentFile ? 1 : 0) - (b === state.currentFile ? 1 : 0),
  );
  // 第1段: redo（やり直し）から捨てる。undo より価値が低く、ここを削らないと
  // redo が予算を占有したとき undo ばかりが不当に消えていく。
  for (const file of files) {
    if (total <= HISTORY_BYTE_BUDGET) break;
    const stack = editHistory.get(file);
    while (total > HISTORY_BYTE_BUDGET && stack.redo.length) {
      total -= stack.redo.shift().text.length * 2;
    }
  }
  // 第2段: undo の最古から。現在ファイルは直近の1件だけは必ず残す。
  for (const file of files) {
    if (total <= HISTORY_BYTE_BUDGET) break;
    const stack = editHistory.get(file);
    const keep = file === state.currentFile ? 1 : 0;
    while (total > HISTORY_BYTE_BUDGET && stack.undo.length > keep) {
      total -= stack.undo.shift().text.length * 2;
    }
  }
  editHistory.forEach((stack, file) => {
    if (!stack.undo.length && !stack.redo.length) editHistory.delete(file);
  });
}

function clearEditHistory() {
  editHistory.clear();
  lastHistoryPush = { file: "", kind: "", line: -1, at: 0 };
}

function pushEditHistory(file, beforeText, meta = {}) {
  if (historySuppress) return;
  const stack = historyFor(file);
  const now = Date.now();
  // 同じ行への連続した自動保存（タイピング）は1つのアンドゥ単位にまとめる
  const coalesce =
    (meta.kind === "line" || meta.kind === "raw" || meta.kind === "block") &&
    lastHistoryPush.file === file &&
    lastHistoryPush.kind === meta.kind &&
    lastHistoryPush.line === (meta.line ?? -1) &&
    now - lastHistoryPush.at < 5000;
  if (!coalesce) {
    stack.undo.push({ text: beforeText, line: meta.line ?? state.selectedLine });
    if (stack.undo.length > HISTORY_LIMIT) stack.undo.shift();
  }
  // redo を空にしてから予算トリムする（どうせ捨てる redo のバイト数で
  // 他ファイルの undo を巻き添え削除しないため）
  stack.redo.length = 0;
  if (!coalesce) trimHistoryToBudget();
  lastHistoryPush = { file, kind: meta.kind || "", line: meta.line ?? -1, at: now };
}

async function applyHistoryText(file, entry) {
  historySuppress = true;
  try {
    state.inlineEditLine = -1;
    state.blockEdit = null;
    await saveRawChange({
      file,
      text: entry.text,
      baseHash: currentHash(),
      liveChange: buildRawLiveChange(state.scenario?.text || "", entry.text, entry.line),
    });
  } finally {
    historySuppress = false;
  }
  selectTimelineLine(clampScenarioLine(entry.line), { scroll: true });
}

async function undoEdit() {
  const file = state.currentFile;
  await flushPendingEdits();
  const stack = historyFor(file);
  if (!stack.undo.length) {
    setStatus("これ以上元に戻せません");
    return;
  }
  const entry = stack.undo.pop();
  stack.redo.push({ text: state.scenario?.text || "", line: state.selectedLine });
  lastHistoryPush = { file: "", kind: "", line: -1, at: 0 };
  await applyHistoryText(file, entry);
  setStatus(`元に戻しました（あと ${stack.undo.length} 回戻せます）`);
}

async function redoEdit() {
  const file = state.currentFile;
  await flushPendingEdits();
  const stack = historyFor(file);
  if (!stack.redo.length) {
    setStatus("やり直す変更はありません");
    return;
  }
  const entry = stack.redo.pop();
  stack.undo.push({ text: state.scenario?.text || "", line: state.selectedLine });
  lastHistoryPush = { file: "", kind: "", line: -1, at: 0 };
  await applyHistoryText(file, entry);
  setStatus(`やり直しました（あと ${stack.redo.length} 回やり直せます）`);
}

/* ---------- timeline ---------- */

const TIMELINE_ROW_STRIDE = 40;
const TIMELINE_OVERSCAN = 8;
const TIMELINE_EDIT_EXTRA = 118;
const TIMELINE_PADDING_TOP = 8;

const TIMELINE_CATEGORY_CLASSES = [
  "cat-story", "cat-direction", "cat-screen", "cat-chara",
  "cat-media", "cat-sound", "cat-message", "cat-system", "cat-script", "cat-plain",
];

function categoryForEntry(entry) {
  if (entry.kind === "comment" || entry.kind === "empty") return "cat-plain";
  if (entry.kind === "script") return "cat-script";
  if (entry.kind === "label" || entry.kind === "speaker" || entry.kind === "text") return "cat-story";
  const tag = entry.tags[0];
  if (!tag) return "cat-plain";
  const known = TAG_CATEGORY[tag.name];
  if (known) return `cat-${known}`;
  const name = tag.name;
  if (name.startsWith("chara") || name === "tatie") return "cat-chara";
  if (name.includes("bgm") || name.includes("se") || name === "movie") return "cat-sound";
  if (name === "bg" || name.includes("image")) return "cat-media";
  return "cat-plain";
}

function displayKind(entry) {
  if (entry.kind === "label") return "ラベル";
  if (entry.kind === "speaker") return "話者";
  if (entry.text) return "本文";
  if (entry.tags.length) {
    const tag = entry.tags[0].name;
    if (TAG_LABELS[tag]) return TAG_LABELS[tag];
    if (tag.includes("bgm") || tag.includes("se")) return "サウンド";
    return tag;
  }
  const map = { text: "本文", comment: "コメント", empty: "空行", script: "スクリプト" };
  return map[entry.kind] || entry.kind;
}

// 展開中のエディタ領域（単一行編集 or ブロック執筆モード）の情報。
// startIdx: timelineEntries 上の開始 index / count: 覆う行数 /
// height: エディタノードの高さ(px) / delta: 後続行のオフセット量(px)
function editSpanInfo() {
  const entries = state.timelineEntries || [];
  if (state.blockEdit) {
    const startIdx = entries.findIndex((entry) => entry.line === state.blockEdit.fromLine);
    if (startIdx < 0) return null;
    let count = 0;
    for (let i = startIdx; i < entries.length; i += 1) {
      if (entries[i].line > state.blockEdit.toLine) break;
      count += 1;
    }
    count = Math.max(1, count);
    const height = Math.min(Math.max(count * 21 + 130, 280), 560);
    return { startIdx, count, height, block: true };
  }
  if (state.inlineEditLine >= 0) {
    const startIdx = entries.findIndex((entry) => entry.line === state.inlineEditLine);
    if (startIdx < 0) return null;
    return { startIdx, count: 1, height: TIMELINE_ROW_STRIDE + TIMELINE_EDIT_EXTRA - 4, block: false };
  }
  return null;
}

function spanDelta(span) {
  if (!span) return 0;
  return span.height - span.count * TIMELINE_ROW_STRIDE + 4;
}

function timelineRowTop(index, span) {
  const base = index * TIMELINE_ROW_STRIDE;
  if (!span) return base;
  if (index > span.startIdx + span.count - 1) return base + spanDelta(span);
  return base;
}

function timelineRenderKeyOf(query, filter) {
  return [state.currentFile, currentHash(), query, filter].join("");
}

function updateTimelineActive() {
  $$(".timeline-row").forEach((row) => {
    const line = Number(row.dataset.line);
    row.classList.toggle("active", line === state.selectedLine);
    row.classList.toggle("multi", state.multiSelected.has(line));
  });
}

/* ---------- 複数行選択 ---------- */

function selectionLines() {
  if (state.multiSelected.size) {
    return [...state.multiSelected].sort((a, b) => a - b);
  }
  return [state.selectedLine];
}

function setRangeSelection(from, to) {
  state.multiSelected.clear();
  const [start, end] = from <= to ? [from, to] : [to, from];
  for (let line = start; line <= end; line += 1) {
    state.multiSelected.add(clampScenarioLine(line));
  }
}

function extendSelectionTo(line, options = {}) {
  const target = clampScenarioLine(line);
  if (
    !options.afterSaveFlush &&
    (hasPendingEditorSave() || state.scenarioNeedsReload || state.scenarioRefreshPromise)
  ) {
    const file = state.currentFile;
    const structureRevision = state.timelineStructureRevision;
    const requestId = (state.timelineSelectionRequestId += 1);
    ensureScenarioReadBarrier()
      .then(() => {
        if (requestId !== state.timelineSelectionRequestId || state.currentFile !== file) return;
        if (structureRevision !== state.timelineStructureRevision) {
          setStatus("保存で行構成が変わりました。対象をもう一度選択してください");
          return;
        }
        extendSelectionTo(target, { afterSaveFlush: true });
      })
      .catch(showError);
    return;
  }
  setRangeSelection(state.selAnchor, target);
  state.selectedLine = target;
  updateTimelineActive();
  updateStatusLocation();
  renderInspector();
}

async function deleteSelectedLines() {
  if (!state.scenario) return;
  const lines = selectionLines();
  if (!lines.length) return;
  const label = lines.length === 1
    ? `${lines[0] + 1}行目を削除しますか？\n${selectedEntry()?.summary || ""}`
    : `選択中の ${lines.length} 行を削除しますか？`;
  if (!window.confirm(label)) return;
  await flushPendingEdits();
  state.inlineEditLine = -1;
  const parts = String(state.scenario.text || "").replace(/\r\n/g, "\n").split("\n");
  const removing = new Set(lines);
  const next = parts.filter((_, index) => !removing.has(index));
  if (!next.length) next.push("");
  state.multiSelected.clear();
  await saveRawChange({
    file: state.currentFile,
    text: next.join("\n"),
    baseHash: currentHash(),
    liveChange: { kind: "raw", line: lines[0], changedText: "" },
  });
  selectTimelineLine(Math.min(lines[0], next.length - 1), { scroll: true });
  setStatus(`${lines.length}行を削除しました`);
}

/* ---------- 行のコピー / カット / 貼り付け ---------- */

function scenarioTextLines() {
  return String(state.scenario?.text || "").replace(/\r\n/g, "\n").split("\n");
}

// 選択中の行の元テキスト（.ks の該当行）を改行区切りで返す
function selectedRowsText() {
  const parts = scenarioTextLines();
  return selectionLines()
    .map((line) => parts[line] ?? "")
    .join("\n");
}

async function copySelectedRows(options = {}) {
  if (!state.scenario) return "";
  const text = selectedRowsText();
  state.rowClipboard = text; // 権限が無い環境でも確実に貼り付けできる内部クリップボード
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    // OS クリップボードへ書けなくても内部クリップボードで動作させる
  }
  if (!options.quiet) setStatus(`${selectionLines().length}行をコピーしました`);
  return text;
}

async function cutSelectedRows() {
  if (!state.scenario) return;
  const lines = selectionLines();
  if (!lines.length) return;
  await copySelectedRows({ quiet: true });
  await flushPendingEdits();
  state.inlineEditLine = -1;
  const parts = scenarioTextLines();
  const removing = new Set(lines);
  const next = parts.filter((_, index) => !removing.has(index));
  if (!next.length) next.push("");
  state.multiSelected.clear();
  await saveRawChange({
    file: state.currentFile,
    text: next.join("\n"),
    baseHash: currentHash(),
    liveChange: { kind: "raw", line: lines[0], changedText: "" },
  });
  selectTimelineLine(Math.min(lines[0], next.length - 1), { scroll: true });
  setStatus(`${lines.length}行を切り取りました`);
}

async function readClipboardRows() {
  let text = "";
  try {
    text = await navigator.clipboard.readText();
  } catch (error) {
    text = "";
  }
  // OS クリップボードが空／読めない場合はアプリ内クリップボードを使う
  if (!text) text = state.rowClipboard || "";
  return text;
}

async function pasteRows() {
  if (!state.scenario) return;
  let raw = await readClipboardRows();
  if (!raw) {
    setStatus("貼り付ける内容がありません");
    return;
  }
  raw = String(raw).replace(/\r\n/g, "\n");
  if (raw.endsWith("\n")) raw = raw.slice(0, -1); // 末尾の余分な改行1つは無視
  const insertLines = raw.split("\n");
  await flushPendingEdits();
  state.inlineEditLine = -1;
  const parts = scenarioTextLines();
  const lines = selectionLines();
  const at = Math.min(lines[lines.length - 1] + 1, parts.length); // 選択最終行の直後に挿入
  const next = [...parts.slice(0, at), ...insertLines, ...parts.slice(at)];
  state.multiSelected.clear();
  await saveRawChange({
    file: state.currentFile,
    text: next.join("\n"),
    baseHash: currentHash(),
    liveChange: {
      kind: "raw",
      line: at,
      changedText: insertLines.length <= 20 ? insertLines.join("\n") : "",
    },
  });
  // 貼り付けた行を選択状態にする（保存後の再描画で選択は先頭行になっている）
  const first = at;
  const last = at + insertLines.length - 1;
  if (last > first) {
    setRangeSelection(first, last);
    state.selectedLine = last;
    state.selAnchor = first;
    updateTimelineActive();
    updateStatusLocation();
    renderInspector();
  }
  scrollSelectedLineIntoView();
  setStatus(`${insertLines.length}行を貼り付けました`);
}

function updateTimelineRow(line) {
  const entry = state.scenario?.parsed?.entries?.find((item) => item.line === line);
  if (!entry) return;
  const index = (state.timelineEntries || []).findIndex((item) => item.line === line);
  if (index < 0) return;
  state.timelineEntries[index] = entry;
  const node = state.timelineNodes?.get(index);
  if (node) fillTimelineRow(node, entry);
}

function selectTimelineLine(line, options = {}) {
  const next = clampScenarioLine(line);
  if (
    !options.afterSaveFlush &&
    (hasPendingEditorSave() || state.scenarioNeedsReload || state.scenarioRefreshPromise)
  ) {
    const file = state.currentFile;
    const structureRevision = state.timelineStructureRevision;
    const requestId = (state.timelineSelectionRequestId += 1);
    ensureScenarioReadBarrier()
      .then(() => {
        if (requestId !== state.timelineSelectionRequestId || state.currentFile !== file) return;
        if (structureRevision !== state.timelineStructureRevision) {
          setStatus("保存で行構成が変わりました。対象をもう一度選択してください");
          return;
        }
        selectTimelineLine(next, { ...options, afterSaveFlush: true });
      })
      .catch(showError);
    return;
  }
  state.timelineSelectionRequestId += 1;
  if (next !== state.selectedLine) {
    if (state.inlineEditLine >= 0 && state.inlineEditLine !== next) {
      state.inlineEditLine = -1;
      if (state.timelineNeedsRender) renderTimeline(true);
      else renderTimelineWindow();
    }
    // 執筆モード中にブロック外へ移動したら閉じる
    if (state.blockEdit && (next < state.blockEdit.fromLine || next > state.blockEdit.toLine)) {
      state.blockEdit = null;
      renderTimeline(true);
    }
  }
  state.selectedLine = next;
  if (!options.keepMulti) {
    state.multiSelected.clear();
    state.selAnchor = next;
  }
  updateTimelineActive();
  updateStatusLocation();
  if (options.renderInspector !== false) renderInspector();
  if (state.view === "flow" && options.renderFlow !== false) renderFlow();
  if (options.scroll) scrollSelectedLineIntoView();
  if (options.remember !== false) rememberCurrentFile();
}

function rebuildTimelineRowNode(node, mode) {
  node.dataset.mode = mode;
  node.draggable = mode === "row";
  node.classList.toggle("editing", mode === "edit");
  node.classList.toggle("block-editing", mode === "block");
  if (mode === "edit") {
    node.innerHTML = `
      <div class="row-head">
        <div class="line-no"></div>
        <div class="kind-badge"></div>
        <div class="row-summary"></div>
        <button type="button" class="row-collapse" title="編集を閉じる (Esc)">閉じる</button>
      </div>
      <textarea id="lineEditor" spellcheck="false"></textarea>
      <div id="lineEditStatus" class="row-edit-status">入力が止まると自動保存してプレビューへ反映します</div>
    `;
    const editor = node.querySelector("#lineEditor");
    editor.addEventListener("input", scheduleLineAutoSave);
    editor.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeInlineEditor();
      }
    });
    node.querySelector(".row-collapse").addEventListener("click", (event) => {
      event.stopPropagation();
      closeInlineEditor();
    });
  } else if (mode === "block") {
    node.innerHTML = `
      <div class="row-head">
        <div class="line-no"></div>
        <div class="kind-badge">執筆モード</div>
        <div class="row-summary"></div>
        <button type="button" class="row-collapse" title="執筆モードを閉じる (Esc)">閉じる</button>
      </div>
      <textarea id="blockEditor" spellcheck="false" placeholder="# 話者名&#10;セリフや地の文[p]"></textarea>
      <div id="blockEditStatus" class="row-edit-status">テキストブロック全体を編集中 — 入力が止まると自動保存してプレビューへ反映します</div>
    `;
    const editor = node.querySelector("#blockEditor");
    editor.addEventListener("input", scheduleBlockAutoSave);
    editor.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeBlockEditor();
      }
    });
    node.querySelector(".row-collapse").addEventListener("click", (event) => {
      event.stopPropagation();
      closeBlockEditor();
    });
  } else {
    node.innerHTML = `
      <div class="line-no"></div>
      <div class="kind-badge"></div>
      <div class="timeline-bg-preview" aria-hidden="true">
        <img loading="lazy" decoding="async" fetchpriority="low" alt="">
      </div>
      <div class="row-summary"></div>
    `;
  }
}

function updateTimelineBackgroundPreview(node, entry) {
  const preview = node.querySelector(".timeline-bg-preview");
  const image = preview?.querySelector("img");
  if (!preview || !image) {
    node.classList.remove("has-bg-preview");
    return;
  }
  const bgTag = entry.tags.find((tag) => tag.name === "bg");
  const storage = String(bgTag?.pm?.storage || "").trim();
  node.classList.toggle("has-bg-preview", Boolean(bgTag));
  preview.title = storage ? `変更後の背景: ${storage}` : "変更後の背景は未指定です";
  if (!bgTag || !storage) {
    image.dataset.url = "";
    image.removeAttribute("src");
    preview.classList.toggle("missing", Boolean(bgTag));
    return;
  }
  const url = projectAssetUrl("bgimage", storage);
  if (image.dataset.url === url) return;
  image.dataset.url = url;
  preview.classList.remove("missing", "loaded");
  image.onload = () => {
    if (image.dataset.url !== url) return;
    preview.classList.remove("missing");
    preview.classList.add("loaded");
  };
  image.onerror = () => {
    if (image.dataset.url !== url) return;
    preview.classList.remove("loaded");
    preview.classList.add("missing");
  };
  image.src = url;
}

function fillTimelineRow(node, entry) {
  node.dataset.line = entry.line;
  node.classList.toggle("active", entry.line === state.selectedLine);
  node.classList.toggle("multi", state.multiSelected.has(entry.line));
  node.classList.remove(...TIMELINE_CATEGORY_CLASSES);
  node.classList.add(categoryForEntry(entry));
  if (node.dataset.mode === "block") {
    node.classList.remove("has-bg-preview");
    const block = state.blockEdit;
    node.classList.remove(...TIMELINE_CATEGORY_CLASSES);
    node.classList.add("cat-story");
    node.querySelector(".line-no").textContent = block ? `${block.fromLine + 1}〜${block.toLine + 1}` : "";
    const summary = node.querySelector(".row-summary");
    if (summary) summary.textContent = "";
    const editor = node.querySelector("#blockEditor");
    if (editor && document.activeElement !== editor && block && editor.dataset.blockKey !== blockEditKey(block)) {
      editor.value = blockEditContent(block);
      editor.dataset.original = editor.value;
      editor.dataset.blockKey = blockEditKey(block);
    }
    return;
  }
  node.querySelector(".line-no").textContent = entry.line + 1;
  node.querySelector(".kind-badge").textContent = displayKind(entry);
  if (node.dataset.mode === "edit") {
    node.classList.remove("has-bg-preview");
    const summary = node.querySelector(".row-summary");
    if (summary) summary.textContent = "";
    const editor = node.querySelector("#lineEditor");
    if (editor && document.activeElement !== editor && editor.value !== entry.raw) {
      editor.value = entry.raw;
      editor.dataset.original = entry.raw;
    }
    return;
  }
  updateTimelineBackgroundPreview(node, entry);
  node.querySelector(".row-summary").textContent = entry.summary || entry.raw;
}

function renderTimelineWindow() {
  const root = $("#timeline");
  const spacer = state.timelineSpacer;
  if (!root || !spacer || !root.contains(spacer)) return;
  const entries = state.timelineEntries || [];
  const nodes = state.timelineNodes;
  const span = editSpanInfo();
  const delta = spanDelta(span);
  // geometry の読みを書き込みより先にまとめる（スペーサの height 変更後に
  // scrollTop を読むと毎回強制同期レイアウトになる）
  const scrollTop = root.scrollTop;
  const clientHeight = root.clientHeight;
  spacer.style.height = `${entries.length * TIMELINE_ROW_STRIDE + (span ? delta : 0)}px`;
  let start = Math.floor(scrollTop / TIMELINE_ROW_STRIDE) - TIMELINE_OVERSCAN;
  if (span && start > span.startIdx) {
    start = Math.floor(Math.max(0, scrollTop - Math.max(0, delta)) / TIMELINE_ROW_STRIDE) - TIMELINE_OVERSCAN;
  }
  start = Math.max(0, start);
  const end = Math.min(
    entries.length,
    Math.ceil((scrollTop + clientHeight + Math.max(0, -delta)) / TIMELINE_ROW_STRIDE) + TIMELINE_OVERSCAN,
  );
  const insideSpan = (index) => span && index > span.startIdx && index < span.startIdx + span.count;
  for (const [index, node] of [...nodes]) {
    if (index < start || index >= end || insideSpan(index)) {
      node.remove();
      nodes.delete(index);
    }
  }
  for (let index = start; index < end; index += 1) {
    if (insideSpan(index)) continue; // スパン内部の行はエディタに畳み込まれている
    const mode = span && index === span.startIdx ? (span.block ? "block" : "edit") : "row";
    let node = nodes.get(index);
    if (!node) {
      node = document.createElement("div");
      node.className = "timeline-row";
      rebuildTimelineRowNode(node, mode);
      bindTimelineRowDrag(node);
      spacer.appendChild(node);
      nodes.set(index, node);
    }
    if (node.dataset.mode !== mode) {
      rebuildTimelineRowNode(node, mode);
    }
    node.style.top = `${timelineRowTop(index, span)}px`;
    node.style.height = mode !== "row" ? `${span.height}px` : "";
    fillTimelineRow(node, entries[index]);
  }
}

function renderTimeline(force = false) {
  if (!state.scenario) return;
  const query = ($("#timelineSearch")?.value || "").trim().toLowerCase();
  const filter = $("#eventFilter")?.value || "";
  const root = $("#timeline");
  if (!root) return;
  const key = timelineRenderKeyOf(query, filter);
  if (
    !force &&
    !state.timelineNeedsRender &&
    state.timelineRenderKey === key &&
    state.timelineSpacer &&
    root.contains(state.timelineSpacer)
  ) {
    updateTimelineActive();
    renderTimelineWindow();
    return;
  }
  // 全再構築でscrollHeightが一度0へ潰れても、同じファイル・絞り込みなら
  // 現在位置を復元する。
  const scrollKey = [state.currentFile, query, filter].join("\u0000");
  const savedScrollTop = state.timelineScrollKey === scrollKey ? root.scrollTop : 0;
  state.timelineScrollKey = scrollKey;
  const rebuiltDirtyTimeline = state.timelineNeedsRender;
  state.timelineRenderKey = key;
  state.timelineNeedsRender = false;
  if (rebuiltDirtyTimeline) state.timelineStructureRevision += 1;
  state.timelineEntries = state.scenario.parsed.entries.filter((entry) => {
    if (filter && entry.kind !== filter && !(filter === "tag" && entry.tags.length)) return false;
    if (!query) return true;
    const haystack = `${entry.raw} ${entry.summary}`.toLowerCase();
    return haystack.includes(query);
  });
  state.timelineNodes = new Map();
  root.innerHTML = "";
  const spacer = document.createElement("div");
  spacer.className = "timeline-spacer";
  root.appendChild(spacer);
  state.timelineSpacer = spacer;
  if (savedScrollTop > 0) {
    const span = editSpanInfo();
    spacer.style.height = `${state.timelineEntries.length * TIMELINE_ROW_STRIDE + (span ? spanDelta(span) : 0)}px`;
    root.scrollTop = savedScrollTop;
  }
  renderTimelineWindow();
}

function scrollSelectedLineIntoView() {
  const root = $("#timeline");
  const entries = state.timelineEntries || [];
  const index = entries.findIndex((entry) => entry.line === state.selectedLine);
  if (!root || index < 0) return;
  const top = timelineRowTop(index, editSpanInfo());
  root.scrollTop = Math.max(0, top - (root.clientHeight - TIMELINE_ROW_STRIDE) / 2);
  renderTimelineWindow();
}

function openInlineEditor(line, options = {}) {
  const entry = (state.scenario?.parsed?.entries || []).find((item) => item.line === line);
  if (!entry) return;
  if (
    state.inlineEditLine !== line &&
    !options.afterSaveFlush &&
    (hasPendingEditorSave() || state.scenarioNeedsReload || state.scenarioRefreshPromise)
  ) {
    const file = state.currentFile;
    ensureScenarioReadBarrier()
      .then(() => {
        if (state.currentFile === file) openInlineEditor(line, { ...options, afterSaveFlush: true });
      })
      .catch(showError);
    return;
  }
  if (state.blockEdit) {
    state.blockEdit = null;
    renderTimeline(true);
  }
  state.inlineEditLine = line;
  state.inlineEditLineCount = 1;
  selectTimelineLine(line, { renderInspector: options.renderInspector !== false });
  setInspectorTagEditingLocked(true);
  renderTimelineWindow();
  const editor = $("#lineEditor");
  if (editor) {
    if (editor.value !== entry.raw) {
      editor.value = entry.raw;
      editor.dataset.original = entry.raw;
    }
    editor.focus();
    const caret = editor.value.length;
    editor.setSelectionRange(caret, caret);
  }
}

function closeInlineEditor() {
  if (state.inlineEditLine < 0) return;
  const line = state.inlineEditLine;
  const pending = flushPendingEdits();
  Promise.resolve(pending)
    .then(() => {
      if (state.inlineEditLine === line) state.inlineEditLine = -1;
      // 複数行replacementではentries/data-lineの並び自体が変わるため、
      // 可視窓だけでなくtimeline indexを一度作り直す。
      if (state.timelineNeedsRender) renderTimeline(true);
      else renderTimelineWindow();
      renderInspector();
    })
    .catch(showError);
}

/* ---------- テキストブロック執筆モード ---------- */

// line を含む [tb_start_text]〜[_tb_end_text] の範囲（タグ行を含む）を返す
function textBlockRangeFor(line) {
  const entries = state.scenario?.parsed?.entries || [];
  let open = -1;
  for (const entry of entries) {
    const tag = entry.tags[0]?.name;
    if (tag === "tb_start_text") {
      open = entry.line;
    } else if (tag === "_tb_end_text") {
      if (open >= 0 && line >= open && line <= entry.line && entry.line - open >= 2) {
        return { start: open, end: entry.line };
      }
      open = -1;
    }
  }
  return null;
}

function scenarioLines() {
  return String(state.scenario?.text || "").replace(/\r\n/g, "\n").split("\n");
}

// ブロック内容（タグ行を除いた話者・本文行）
function blockEditContent(block) {
  return scenarioLines().slice(block.fromLine + 1, block.toLine).join("\n");
}

function blockEditKey(block) {
  return `${state.currentFile}:${block.fromLine}-${block.toLine}`;
}

function openBlockEditor(line, options = {}) {
  if (
    !options.afterSaveFlush &&
    (hasPendingEditorSave() || state.scenarioNeedsReload || state.scenarioRefreshPromise)
  ) {
    const file = state.currentFile;
    ensureScenarioReadBarrier()
      .then(() => {
        if (state.currentFile === file) openBlockEditor(line, { ...options, afterSaveFlush: true });
      })
      .catch(showError);
    return;
  }
  const range = textBlockRangeFor(line);
  if (!range) {
    openInlineEditor(line);
    return;
  }
  state.inlineEditLine = -1;
  // 検索・フィルタ中はブロックの行が抜け落ちるため解除する
  const search = $("#timelineSearch");
  const filter = $("#eventFilter");
  if ((search && search.value) || (filter && filter.value)) {
    if (search) search.value = "";
    if (filter) filter.value = "";
    state.timelineRenderKey = "";
    renderTimeline(true);
  }
  state.blockEdit = { fromLine: range.start, toLine: range.end };
  selectTimelineLine(clampScenarioLine(range.start + 1), {
    keepMulti: false,
    renderInspector: options.renderInspector !== false,
  });
  setInspectorTagEditingLocked(true);
  renderTimelineWindow();
  const editor = $("#blockEditor");
  if (editor) {
    editor.value = blockEditContent(state.blockEdit);
    editor.dataset.original = editor.value;
    editor.dataset.blockKey = blockEditKey(state.blockEdit);
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  }
  scrollSelectedLineIntoView();
  setStatus(`執筆モード: ${range.start + 1}〜${range.end + 1}行のテキストブロックを編集中`);
}

function closeBlockEditor() {
  if (!state.blockEdit) return;
  const pending = flushPendingEdits();
  Promise.resolve(pending)
    .then(() => ensureCurrentScenarioFresh({ flush: false }))
    .then(() => {
      state.blockEdit = null;
      renderTimeline(true);
      renderInspector();
    })
    .catch(showError);
}

function scheduleBlockAutoSave() {
  clearTimeout(state.blockSaveTimer);
  setSaveState("編集中…", "dirty");
  const status = $("#blockEditStatus");
  if (status) status.textContent = "入力が止まったら保存";
  state.blockSaveTimer = setTimeout(() => {
    state.blockSaveTimer = null;
    startPendingEditRunner("block", runBlockAutoSave);
  }, LINE_AUTO_SAVE_DELAY);
}

async function runBlockAutoSave() {
  const editor = $("#blockEditor");
  const block = state.blockEdit;
  if (!editor || !block || !state.scenario) return;
  if (editor.value === editor.dataset.original) {
    resolvePendingSaveErrorIfReverted("block");
    setSaveState("保存済み", "saved");
    return;
  }
  if (state.blockSaveInFlight) {
    state.blockSaveQueued = true;
    return;
  }
  const file = state.currentFile;
  const value = editor.value;
  const newLines = splitEditorLines(value);
  const lines = scenarioLines();
  const nextText = [
    ...lines.slice(0, block.fromLine + 1),
    ...newLines,
    ...lines.slice(block.toLine),
  ].join("\n");
  state.blockSaveInFlight = true;
  setSaveState("保存中…", "saving");
  try {
    await saveRawChange({
      file,
      text: nextText,
      baseHash: currentHash(),
      auto: true,
      compact: false,
      keepCurrentSelection: true,
      liveChange: {
        ...buildRawLiveChange(state.scenario.text, nextText, block.fromLine + 1),
        kind: "block",
      },
    });
  } finally {
    state.blockSaveInFlight = false;
  }
  // 行数の変化に合わせてブロック範囲を追従させる
  if (state.blockEdit && state.currentFile === file) {
    state.blockEdit.toLine = state.blockEdit.fromLine + newLines.length + 1;
    const currentEditor = $("#blockEditor");
    if (currentEditor) {
      if (currentEditor.value === value) {
        currentEditor.dataset.original = value;
        currentEditor.dataset.blockKey = blockEditKey(state.blockEdit);
        const status = $("#blockEditStatus");
        if (status) status.textContent = "保存済み";
        setSaveState("保存済み", "saved");
        if (state.timelineNeedsRender) {
          const restoreFocus = document.activeElement === currentEditor;
          const selectionStart = currentEditor.selectionStart;
          const selectionEnd = currentEditor.selectionEnd;
          renderTimeline(true);
          const rebuiltEditor = $("#blockEditor");
          if (rebuiltEditor) {
            rebuiltEditor.value = value;
            rebuiltEditor.dataset.original = value;
            rebuiltEditor.dataset.blockKey = blockEditKey(state.blockEdit);
            if (restoreFocus) {
              rebuiltEditor.focus();
              rebuiltEditor.setSelectionRange(
                Math.min(selectionStart, value.length),
                Math.min(selectionEnd, value.length),
              );
            }
          }
        }
      } else {
        state.blockSaveQueued = false;
        scheduleBlockAutoSave();
        return;
      }
    }
  }
  if (state.currentFile !== file || !state.blockEdit) {
    state.blockSaveQueued = false;
    return;
  }
  if (state.blockSaveQueued) {
    state.blockSaveQueued = false;
    scheduleBlockAutoSave();
  }
}

/* ---------- drag & drop insertion ---------- */

function timelineDropIndex(event) {
  const root = $("#timeline");
  const entries = state.timelineEntries || [];
  const rect = root.getBoundingClientRect();
  const span = editSpanInfo();
  let y = event.clientY - rect.top + root.scrollTop - TIMELINE_PADDING_TOP;
  if (span && y > (span.startIdx + span.count) * TIMELINE_ROW_STRIDE) {
    y -= spanDelta(span);
  }
  return Math.max(0, Math.min(Math.round(y / TIMELINE_ROW_STRIDE), entries.length));
}

function showDropIndicator(index) {
  const spacer = state.timelineSpacer;
  if (!spacer) return;
  if (!state.dropIndicator || !spacer.contains(state.dropIndicator)) {
    const node = document.createElement("div");
    node.className = "drop-indicator";
    spacer.appendChild(node);
    state.dropIndicator = node;
  }
  state.dropIndicator.style.top = `${timelineRowTop(index, editSpanInfo()) - 2}px`;
}

function hideDropIndicator() {
  if (state.dropIndicator) {
    state.dropIndicator.remove();
    state.dropIndicator = null;
  }
}

async function insertPaletteItem(component, line, mode) {
  if (!state.scenario) return;
  const content = componentContent(component);
  await insertContentAt(content, line, mode, component);
}

async function insertContentAt(content, line, mode, component = null) {
  await flushPendingEdits();
  const file = state.currentFile;
  const fallbackLine = mode === "before" ? line : line + 1;
  const result = await api("/api/scenario/insert", {
    method: "POST",
    scenarioFile: file,
    body: JSON.stringify({ file, line, mode, content, baseHash: currentHash() }),
  });
  const insertedLine = Number.isFinite(Number(result.line)) ? Number(result.line) : fallbackLine;
  const insertLine = insertedLine + (component?.selectOffset || 0);
  state.selectedLine = insertLine;
  await afterWrite(result, `${component ? component.label + " を" : ""}挿入しました`, {
    kind: "insert",
    line: insertLine,
    changedText: result.inserted || "",
  }, { file, line: insertLine });
  scrollSelectedLineIntoView();
  if (component?.editAfter) openInlineEditor(insertLine);
}

/* ---------- 既存行のドラッグ並べ替え ---------- */

function bindTimelineRowDrag(node) {
  node.addEventListener("dragstart", (event) => {
    if (node.dataset.mode !== "row" || !node.dataset.line) return;
    // 執筆モード・複数選択中は並べ替えを無効化して誤操作を防ぐ
    if (state.blockEdit || state.multiSelected.size > 1) {
      event.preventDefault();
      return;
    }
    state.dragRowLine = Number(node.dataset.line);
    event.dataTransfer.setData("application/x-tf-row", node.dataset.line);
    event.dataTransfer.effectAllowed = "move";
    node.classList.add("row-dragging");
  });
  node.addEventListener("dragend", () => {
    state.dragRowLine = null;
    node.classList.remove("row-dragging");
    hideDropIndicator();
  });
}

async function moveTimelineRow(fromLine, dropIndex) {
  if (!state.scenario) return;
  const entries = state.timelineEntries || [];
  // ドロップ位置（フィルタ後の行インデックス）を実ドキュメント行へ変換する
  const to = dropIndex >= entries.length
    ? (entries.length ? entries[entries.length - 1].line + 1 : fromLine)
    : entries[dropIndex].line;
  if (to === fromLine || to === fromLine + 1) return; // 元と同じ位置なら何もしない
  await flushPendingEdits();
  const file = state.currentFile;
  const result = await api("/api/scenario/lineop", {
    method: "POST",
    scenarioFile: file,
    body: JSON.stringify({ file, line: fromLine, op: "move", to, baseHash: currentHash() }),
  });
  const nextLine = Number.isFinite(result.line) ? result.line : fromLine;
  const message = result.splitTextBlock
    ? "行を移動し、テキストブロックを分割しました"
    : "行を移動しました";
  await afterWrite(result, message, {
    kind: "lineop",
    line: nextLine,
    changedText: "",
  }, { file, line: nextLine });
  scrollSelectedLineIntoView();
}

async function dropPaletteItem(event) {
  const component = state.dragItem || paletteItemById(event.dataTransfer.getData("text/plain"));
  hideDropIndicator();
  state.dragItem = null;
  if (!component || !state.scenario) return;
  const entries = state.timelineEntries || [];
  const index = timelineDropIndex(event);
  if (!entries.length) {
    await insertPaletteItem(component, state.selectedLine, "after");
  } else if (index >= entries.length) {
    await insertPaletteItem(component, entries[entries.length - 1].line, "after");
  } else {
    await insertPaletteItem(component, entries[index].line, "before");
  }
}

function bindTimelineDnd() {
  const root = $("#timeline");
  root.addEventListener("dragover", (event) => {
    const isRow = state.dragRowLine != null || event.dataTransfer.types.includes("application/x-tf-row");
    const isPalette = state.dragItem || event.dataTransfer.types.includes("text/plain");
    if (!isRow && !isPalette) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = isRow ? "move" : "copy";
    showDropIndicator(timelineDropIndex(event));
  });
  root.addEventListener("dragleave", (event) => {
    if (event.target === root) hideDropIndicator();
  });
  root.addEventListener("drop", (event) => {
    event.preventDefault();
    if (state.dragRowLine != null) {
      const fromLine = state.dragRowLine;
      const dropIndex = timelineDropIndex(event);
      state.dragRowLine = null;
      hideDropIndicator();
      moveTimelineRow(fromLine, dropIndex).catch(showError);
    } else {
      dropPaletteItem(event).catch(showError);
    }
  });
}

/* ---------- line save / operations ---------- */

function scheduleLineAutoSave() {
  clearTimeout(state.lineSaveTimer);
  setSaveState("編集中…", "dirty");
  const status = $("#lineEditStatus");
  if (status) status.textContent = "入力が止まったら保存";
  state.lineSaveTimer = setTimeout(() => {
    state.lineSaveTimer = null;
    startPendingEditRunner("line", runLineAutoSave);
  }, LINE_AUTO_SAVE_DELAY);
}

function rebuildInlineTimelineAfterSettled(file, line, replacement) {
  const currentEditor = $("#lineEditor");
  if (
    !state.timelineNeedsRender ||
    !currentEditor ||
    state.currentFile !== file ||
    state.inlineEditLine !== line ||
    currentEditor.value !== replacement
  ) return;
  const restoreFocus = document.activeElement === currentEditor;
  const selectionStart = currentEditor.selectionStart;
  const selectionEnd = currentEditor.selectionEnd;
  renderTimeline(true);
  const rebuiltEditor = $("#lineEditor");
  if (!rebuiltEditor) return;
  rebuiltEditor.value = replacement;
  rebuiltEditor.dataset.original = replacement;
  if (restoreFocus) {
    rebuiltEditor.focus();
    rebuiltEditor.setSelectionRange(
      Math.min(selectionStart, replacement.length),
      Math.min(selectionEnd, replacement.length),
    );
  }
}

async function runLineAutoSave() {
  const editor = $("#lineEditor");
  const status = $("#lineEditStatus");
  if (!editor || !state.scenario) return;
  if (editor.value === editor.dataset.original) {
    resolvePendingSaveErrorIfReverted("line");
    if (status) status.textContent = "変更なし";
    setSaveState("保存済み", "saved");
    return;
  }
  if (state.lineSaveInFlight) {
    state.lineSaveQueued = true;
    return;
  }
  const file = state.currentFile;
  const line = state.selectedLine;
  const replacement = editor.value;
  const count = state.inlineEditLineCount || 1;
  state.lineSaveInFlight = true;
  setSaveState("保存中…", "saving");
  if (status) status.textContent = "保存中";
  try {
    await saveLineChange({ file, line, replacement, baseHash: currentHash(), auto: true, count });
  } finally {
    state.lineSaveInFlight = false;
  }
  if (state.currentFile === file && state.inlineEditLine === line) {
    state.inlineEditLineCount = replacement.replace(/\r\n/g, "\n").split("\n").length;
  }
  const currentEditor = $("#lineEditor");
  if (currentEditor && state.currentFile === file && state.selectedLine === line) {
    if (currentEditor.value === replacement) {
      currentEditor.dataset.original = replacement;
      const currentStatus = $("#lineEditStatus");
      if (currentStatus) currentStatus.textContent = "保存済み";
      rebuildInlineTimelineAfterSettled(file, line, replacement);
    } else {
      state.lineSaveQueued = false;
      scheduleLineAutoSave();
      return;
    }
  }
  if (state.currentFile !== file || state.inlineEditLine !== line) {
    state.lineSaveQueued = false;
    return;
  }
  if (state.lineSaveQueued) {
    state.lineSaveQueued = false;
    scheduleLineAutoSave();
  }
}

async function saveSelectedLine(options = {}) {
  if (!options.auto) {
    clearTimeout(state.lineSaveTimer);
    state.lineSaveTimer = null;
  }
  const editor = $("#lineEditor");
  if (!editor) return;
  const replacement = editor.value;
  if (replacement === editor.dataset.original) {
    resolvePendingSaveErrorIfReverted("line");
    return;
  }
  const file = state.currentFile;
  const line = state.selectedLine;
  await saveLineChange({
    file,
    line,
    replacement,
    baseHash: currentHash(),
    auto: options.auto,
    count: state.inlineEditLineCount || 1,
  });
  if (state.currentFile === file && state.inlineEditLine === line) {
    state.inlineEditLineCount = replacement.replace(/\r\n/g, "\n").split("\n").length;
    rebuildInlineTimelineAfterSettled(file, line, replacement);
  }
}

async function saveLineChange({ file, line, replacement, baseHash, auto = false, count = 1 }) {
  const result = await api("/api/scenario/line", {
    method: "POST",
    scenarioFile: file,
    body: JSON.stringify({ file, line, replacement, baseHash, count }),
  });
  await afterWrite(result, auto ? "行を自動保存しました" : "行を保存しました", {
    kind: "line",
    line,
    changedText: replacement,
  }, { file, line, keepCurrentSelection: true });
  if (file === state.currentFile) {
    const editor = $("#lineEditor");
    if (editor && editor.value === replacement) editor.dataset.original = replacement;
  }
  setSaveState("保存済み", "saved");
}

function scheduleTagAutoSave() {
  clearTimeout(state.tagSaveTimer);
  setSaveState("編集中…", "dirty");
  const status = $("#tagEditStatus");
  if (status) status.textContent = "変更を反映中…";
  state.tagSaveTimer = setTimeout(() => {
    state.tagSaveTimer = null;
    startPendingEditRunner("tag", () => saveTagAttrs({ auto: true }));
  }, TAG_AUTO_SAVE_DELAY);
}

async function saveTagAttrs(options = {}) {
  if (!options.auto) {
    clearTimeout(state.tagSaveTimer);
    state.tagSaveTimer = null;
  }
  const file = state.currentFile;
  const line = state.selectedLine;
  const attrs = {};
  $$("[data-tag-attr]").forEach((field) => {
    attrs[field.dataset.tagAttr] = field.value;
  });
  if (!Object.keys(attrs).length || !state.scenario) return;
  if (state.tagSaveInFlight) {
    state.tagSaveQueued = true;
    return;
  }
  state.tagSaveInFlight = true;
  setSaveState("保存中…", "saving");
  const status = $("#tagEditStatus");
  if (status) status.textContent = "反映中…";
  try {
    const result = await api("/api/scenario/update-tag", {
      method: "POST",
      scenarioFile: file,
      body: JSON.stringify({ file, line, attrs, baseHash: currentHash() }),
    });
    await afterWrite(result, options.auto ? "パラメータを自動反映しました" : "パラメータを反映しました", {
      kind: "tag",
      line,
      changedText: result.replacement || "",
      forceImmediate: true,
    }, { file, line, keepCurrentSelection: true, preserveInspector: true });
    const currentStatus = $("#tagEditStatus");
    if (currentStatus) currentStatus.textContent = "反映済み";
    setSaveState("保存済み", "saved");
  } finally {
    state.tagSaveInFlight = false;
  }
  if (state.currentFile !== file || state.selectedLine !== line) {
    state.tagSaveQueued = false;
    return;
  }
  if (state.tagSaveQueued) {
    state.tagSaveQueued = false;
    scheduleTagAutoSave();
  }
}

const LINE_OP_LABELS = {
  up: "行を上へ移動しました",
  down: "行を下へ移動しました",
  duplicate: "行を複製しました",
  delete: "行を削除しました",
};

async function runLineOp(op) {
  if (!state.scenario) return;
  const file = state.currentFile;
  const line = state.selectedLine;
  if (op === "delete") {
    const entry = selectedEntry();
    const summary = entry ? (entry.summary || entry.raw || "(空行)") : "";
    if (!window.confirm(`${line + 1}行目を削除しますか？\n${summary}`)) return;
  }
  await flushPendingEdits();
  const result = await api("/api/scenario/lineop", {
    method: "POST",
    scenarioFile: file,
    body: JSON.stringify({ file, line, op, baseHash: currentHash() }),
  });
  const nextLine = Number.isFinite(result.line) ? result.line : line;
  await afterWrite(result, LINE_OP_LABELS[op] || "行を編集しました", {
    kind: "lineop",
    line: nextLine,
    changedText: "",
  }, { file, line: nextLine });
}

function scheduleRawAutoSave() {
  clearTimeout(state.rawSaveTimer);
  setSaveState("編集中…", "dirty");
  state.rawSaveTimer = setTimeout(() => {
    state.rawSaveTimer = null;
    startPendingEditRunner("raw", runRawAutoSave);
  }, RAW_AUTO_SAVE_DELAY);
}

function splitEditorLines(text) {
  return String(text || "").replace(/\r\n/g, "\n").split("\n");
}

function buildRawLiveChange(beforeText, afterText, preferredLine) {
  const beforeLines = splitEditorLines(beforeText);
  const afterLines = splitEditorLines(afterText);
  let first = 0;
  while (first < beforeLines.length && first < afterLines.length && beforeLines[first] === afterLines[first]) {
    first += 1;
  }
  if (first === beforeLines.length && first === afterLines.length) {
    return { kind: "raw", line: preferredLine, changedText: "" };
  }
  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;
  while (beforeEnd >= first && afterEnd >= first && beforeLines[beforeEnd] === afterLines[afterEnd]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  const changedLines = afterLines.slice(first, afterEnd + 1);
  const changedText = changedLines.length <= 20 ? changedLines.join("\n") : "";
  const line = Math.max(0, first);
  return {
    kind: "raw",
    line,
    changedText,
    forceImmediate: Math.abs(line - Number(preferredLine || 0)) <= 1,
  };
}

async function runRawAutoSave() {
  const editor = $("#rawEditor");
  if (!editor || !state.scenario) return;
  const file = state.currentFile;
  const originalText = state.scenario?.text || "";
  const text = editor.value;
  const sourceRevision = editor._ksCodeMirror?.revision;
  if (text === originalText) {
    resolvePendingSaveErrorIfReverted("raw", state.currentFile);
    setSaveState("保存済み", "saved");
    return;
  }
  if (state.rawSaveInFlight) {
    state.rawSaveQueued = true;
    return;
  }
  const liveChange = buildRawLiveChange(originalText, text, state.selectedLine);
  state.rawSaveInFlight = true;
  setSaveState("保存中…", "saving");
  try {
    await saveRawChange({
      file,
      text,
      baseHash: currentHash(),
      auto: true,
      compact: true,
      keepCurrentSelection: true,
      liveChange,
      sourceRevision,
    });
  } finally {
    state.rawSaveInFlight = false;
  }
  const currentEditor = $("#rawEditor");
  const changedDuringSave = currentEditor?._ksCodeMirror
    ? currentEditor._ksCodeMirror.revision !== sourceRevision
    : currentEditor?.value !== text;
  if (currentEditor && state.currentFile === file && changedDuringSave) {
    state.rawSaveQueued = false;
    scheduleRawAutoSave();
    return;
  }
  if (state.currentFile !== file) {
    state.rawSaveQueued = false;
    return;
  }
  if (state.rawSaveQueued) {
    state.rawSaveQueued = false;
    scheduleRawAutoSave();
  }
}

async function saveRaw(options = {}) {
  if (!options.auto) {
    clearTimeout(state.rawSaveTimer);
    state.rawSaveTimer = null;
  }
  // コードビュー以外では textarea を同期していない（表示時に同期する方式。
  // commitScenarioPayload 参照）ため、古い内容を保存しないようここでは
  // 未保存の編集タイマーだけを流す。
  if (state.view !== "code") {
    await flushPendingEdits();
    if (!options.auto) setStatus("保存しました");
    return;
  }
  const editor = $("#rawEditor");
  const text = editor ? editor.value : state.scenario?.text || "";
  const originalText = state.scenario?.text || "";
  if (state.scenario && text === originalText) {
    resolvePendingSaveErrorIfReverted("raw", state.currentFile);
    if (!options.auto) setStatus("変更はありません");
    return;
  }
  await saveRawChange({
    file: state.currentFile,
    text,
    baseHash: currentHash(),
    auto: options.auto,
    liveChange: buildRawLiveChange(originalText, text, state.selectedLine),
    sourceRevision: editor?._ksCodeMirror?.revision,
  });
}

async function saveRawChange({
  file,
  text,
  baseHash,
  auto = false,
  compact = null,
  keepCurrentSelection = false,
  liveChange = null,
  sourceRevision = null,
}) {
  const compactResponse = compact == null
    ? state.view === "code" || rawEditorHasFocus()
    : Boolean(compact);
  const result = await api("/api/scenario/save", {
    method: "POST",
    scenarioFile: file,
    // 自動保存中に数MBの parsed scenario を毎回返すと、JSON.parse とGCが
    // 入力・スクロールのフレームを止める。本文はクライアントが既に持って
    // いるため自動保存は hash/stat だけを受け取り、完全な解析結果は
    // タイムラインへ戻るときに一度だけ読み直す。
    body: JSON.stringify({ file, text, baseHash, compact: compactResponse }),
  });
  const change = liveChange || { kind: "raw", line: state.selectedLine, changedText: "" };
  await afterWrite(result, auto ? "自動保存しました" : "保存しました", change, {
    file,
    line: change.line,
    keepCurrentSelection,
    writtenText: text,
  });
  const currentEditor = $("#rawEditor");
  if (
    currentEditor?._ksCodeMirror &&
    state.currentFile === file &&
    sourceRevision === currentEditor._ksCodeMirror.revision
  ) {
    currentEditor._ksCodeMirror.markSynced(file, result.hash || currentHash());
  }
  setSaveState("保存済み", "saved");
}

function commitCompactScenarioWrite(result, file, text, liveChange = {}) {
  if (file !== state.currentFile || !state.scenario) return;
  const beforeText = state.scenario.text || "";
  if (text !== beforeText) {
    pushEditHistory(file, beforeText, {
      kind: liveChange.kind || "",
      line: Number.isFinite(Number(liveChange.line)) ? Number(liveChange.line) : state.selectedLine,
    });
  }
  state.scenario = {
    ...state.scenario,
    text,
    hash: result.hash || state.scenario.hash,
    stat: result.stat || state.scenario.stat,
  };
  state.scenarioNeedsReload = true;

  // サイドバーの行数・容量だけは安価に即時追従させる。labels/choices 等は
  // 完全解析の取り直しまで直前値を保つ。
  const index = state.scenarios.findIndex((item) => item.storage === file);
  if (index >= 0) {
    let lineCount = 1;
    for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) lineCount += 1;
    state.scenarios[index] = {
      ...state.scenarios[index],
      lineCount,
      size: result.stat?.size ?? state.scenarios[index].size,
      mtimeMs: result.stat?.mtimeMs ?? state.scenarios[index].mtimeMs,
    };
  }
  updateBreadcrumb();
  renderScenarioSidebar();
}

let afterWriteStatusRevision = 0;

async function afterWrite(result, message, liveChange = {}, context = {}) {
  const statusRevision = (afterWriteStatusRevision += 1);
  const file = context.file || state.currentFile;
  const responseRevision = Number(result?.__clientWriteRevision || 0);
  const latestFileRevision = Number(state.scenarioWriteRevisionByFile.get(file) || 0);
  if (responseRevision && responseRevision < latestFileRevision) {
    // 同一ファイルの新しいPOSTが既に始まっている。古いfull/compact応答で
    // client stateを巻き戻さず、最新応答か次のfresh GETへ任せる。
    if (file === state.currentFile) state.scenarioNeedsReload = true;
    setStatus(`${message}（新しい保存を同期中）`);
    return;
  }
  const keepLine = context.keepCurrentSelection
    ? state.selectedLine
    : Number.isFinite(context.line) ? context.line : state.selectedLine;
  if (file === state.currentFile) {
    const focusedId = document.activeElement?.id || "";
    const hasLineEditor = Boolean($("#lineEditor") && state.inlineEditLine >= 0);
    const hasBlockEditor = Boolean($("#blockEditor") && state.blockEdit);
    const hasInspectorEditor = Boolean(context.preserveInspector && $("#inspector [data-tag-attr]"));
    const preserveEditing =
      context.keepCurrentSelection &&
      (hasLineEditor || hasBlockEditor || hasInspectorEditor ||
        focusedId === "lineEditor" || rawEditorHasFocus() || focusedId === "blockEditor");
    if (result.compact) {
      commitCompactScenarioWrite(
        result,
        file,
        context.writtenText ?? state.scenario?.text ?? "",
        liveChange,
      );
    } else if (result.scenario) {
      const beforeText = state.scenario?.text || "";
      if (result.scenario.text !== beforeText) {
        pushEditHistory(file, beforeText, {
          kind: liveChange.kind || "",
          line: Number.isFinite(Number(liveChange.line)) ? Number(liveChange.line) : state.selectedLine,
        });
      }
      commitScenarioPayload(result.scenario, {
        line: keepLine,
        updateRawEditor: !rawEditorHasFocus(),
        renderTimeline: !preserveEditing,
        renderInspector: !preserveEditing,
        renderFlow: !preserveEditing,
      });
    } else {
      await loadScenario(file, {
        line: keepLine,
        quiet: true,
        remember: false,
        backgroundFreshness: true,
      });
    }
    if (!preserveEditing) scrollSelectedLineIntoView();
    if (state.autoPreview && state.previewStarted) {
      // disk/client commitをpreview runtimeの応答待ち（最大4.5秒）から分離する。
      // 未開始更新はpreview側でlatest-winsに統合され、保存・画面遷移を塞がない。
      applyLivePreviewUpdate(liveChange, file)
        .then((liveMessage) => {
          if (
            liveMessage &&
            statusRevision === afterWriteStatusRevision &&
            file === state.currentFile
          ) setStatus(`${message} / ${liveMessage}`);
        })
        .catch(showError);
    }
  } else {
    await refreshScenarioMeta();
  }
  setStatus(message);
}

/* ---------- inspector ---------- */

function selectedEntry() {
  if (!state.scenario) return null;
  return (
    state.scenario.parsed.entries.find((entry) => entry.line === state.selectedLine) ||
    state.scenario.parsed.entries[0]
  );
}

function updateStatusLocation() {
  const node = $("#statusLocation");
  if (node) node.textContent = state.currentFile ? `${state.currentFile} : ${state.selectedLine + 1}` : "";
}

function fieldInputHtml(field, value) {
  const key = escapeAttr(field.key);
  const current = value != null ? String(value) : "";
  if (field.type === "select") {
    const options = ["", ...(field.options || [])];
    return `<select data-tag-attr="${key}">${options
      .map((option) => `<option value="${escapeAttr(option)}"${option === current ? " selected" : ""}>${escapeHtml(option || "未指定")}</option>`)
      .join("")}</select>`;
  }
  if (field.type === "bool") {
    const options = ["", "true", "false"];
    return `<select data-tag-attr="${key}">${options
      .map((option) => `<option value="${escapeAttr(option)}"${option === current ? " selected" : ""}>${escapeHtml(option || "未指定")}</option>`)
      .join("")}</select>`;
  }
  if (field.type === "color") {
    const hex = /^0x[0-9a-fA-F]{6}$/.test(current) ? `#${current.slice(2)}` : "#000000";
    return `
      <div class="color-field">
        <input type="color" value="${hex}" data-color-for="${key}">
        <input data-tag-attr="${key}" value="${escapeAttr(current)}" placeholder="0x000000">
      </div>`;
  }
  if (["image", "sound", "movie"].includes(field.type)) {
    const dirMap = { image: field.dir || "image", sound: field.dir || "sound", movie: "video" };
    const dir = dirMap[field.type];
    const preview =
      field.type === "image" && current
        ? `<div class="field-thumb"><img src="${escapeAttr(projectAssetUrl(dir, current))}" alt=""></div>`
        : "";
    return `
      <div class="picker-field">
        <input data-tag-attr="${key}" data-asset-dir="${escapeAttr(dir)}" data-asset-type="${field.type}" value="${escapeAttr(current)}">
        <button type="button" class="btn ghost" data-asset-pick>選ぶ</button>
        <button type="button" class="btn ghost asset-reveal-btn" data-asset-reveal title="ファイルの場所を開く">
          <svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
        </button>
      </div>${preview}`;
  }
  if (field.type === "scenario") {
    return `<input data-tag-attr="${key}" list="scenarioNames" value="${escapeAttr(current)}">`;
  }
  if (field.type === "label") {
    return `<input data-tag-attr="${key}" list="labelNames" value="${escapeAttr(current)}">`;
  }
  return `<input data-tag-attr="${key}" value="${escapeAttr(current)}"${field.type === "num" ? ` inputmode="numeric"` : ""}>`;
}

function renderSchemaFields(tag, schema) {
  const pm = tag.pm || {};
  const covered = new Set();
  const rows = schema.fields.map((field) => {
    covered.add(field.key);
    const value = pm[field.key] != null ? pm[field.key] : "";
    return `
      <div class="field">
        <label>${escapeHtml(field.label)}${field.def ? `<span class="field-def">既定 ${escapeHtml(field.def)}</span>` : ""}</label>
        ${fieldInputHtml(field, value)}
      </div>`;
  });
  Object.entries(pm).forEach(([key, value]) => {
    if (covered.has(key)) return;
    rows.push(`
      <div class="field">
        <label>${escapeHtml(key)}</label>
        <input data-tag-attr="${escapeAttr(key)}" value="${escapeAttr(value)}">
      </div>`);
  });
  return rows.join("");
}

function renderTagCharaFields(values = {}) {
  const catalog = state.catalog?.characters || {};
  const names = Object.keys(catalog);
  const selectedName = values.name && (catalog[values.name] || !names.length) ? values.name : (names[0] || values.name || "");
  const chara = catalog[selectedName] || {};
  const appearances = Object.keys(chara.appearances || {});
  const selectedAppearance = values.appearance && appearances.includes(values.appearance)
    ? values.appearance
    : (chara.defaultAppearance || appearances[0] || values.appearance || "default");
  const variants = Object.keys(chara.appearances?.[selectedAppearance]?.variants || {});
  const selectedVariant = values.variant && variants.includes(values.variant)
    ? values.variant
    : (variants[0] || values.variant || "normal");
  const variantObj = chara.appearances?.[selectedAppearance]?.variants?.[selectedVariant] || {};
  const select = (key, label, options, selected) => `
    <div class="field">
      <label>${escapeHtml(label)}</label>
      <select data-tag-attr="${escapeAttr(key)}">${options
        .map((option) => `<option value="${escapeAttr(option)}"${option === selected ? " selected" : ""}>${escapeHtml(option)}</option>`)
        .join("")}</select>
    </div>`;
  return [
    select("name", "キャラ", names.length ? names : [selectedName], selectedName),
    select("appearance", "衣装", appearances.length ? appearances : [selectedAppearance], selectedAppearance),
    select("variant", "表情", variants.length ? variants : [selectedVariant], selectedVariant),
    select("position", "位置", ["center", "left", "right"], values.position || "center"),
    select("mode", "モード", ["show", "mod"], values.mode || "mod"),
    `<div class="field"><label>時間(ms)</label><input data-tag-attr="time" value="${escapeAttr(values.time || "500")}"></div>`,
    select("wait", "完了を待つ", ["true", "false"], values.wait || "true"),
    select("cross", "クロス", ["true", "false"], values.cross || "true"),
    select("reflect", "反転", ["false", "true"], values.reflect || "false"),
    `<div class="field-thumb chara-thumb">${variantObj.storage ? `<img src="${escapeAttr(projectAssetUrl("fgimage", variantObj.storage))}" alt="">` : `<span class="mini">画像なし</span>`}</div>`,
  ].join("");
}

function collectTagEditorAttrs() {
  const attrs = {};
  $$("[data-tag-attr]").forEach((field) => {
    attrs[field.dataset.tagAttr] = field.value;
  });
  return attrs;
}

function rerenderTagCharaFields(nextValues) {
  const root = $("#tagEditorFields");
  if (!root) return;
  root.innerHTML = renderTagCharaFields(nextValues);
  bindTagCharaFieldUpdates();
  const inspector = $("#inspector");
  if (inspector) {
    bindInspectorFieldExtras(inspector);
    bindInspectorAutoSave(inspector);
  }
}

function bindTagCharaFieldUpdates() {
  $('[data-tag-attr="name"]')?.addEventListener("change", () => {
    const values = collectTagEditorAttrs();
    const chara = state.catalog?.characters?.[values.name] || {};
    const appearance = chara.defaultAppearance || Object.keys(chara.appearances || {})[0] || "default";
    rerenderTagCharaFields({ ...values, appearance, variant: "" });
  });
  $('[data-tag-attr="appearance"]')?.addEventListener("change", () => {
    rerenderTagCharaFields({ ...collectTagEditorAttrs(), variant: "" });
  });
  $('[data-tag-attr="variant"]')?.addEventListener("change", () => {
    rerenderTagCharaFields(collectTagEditorAttrs());
  });
}

function revealAsset(dir, storage) {
  const value = String(storage || "").trim();
  if (!value) {
    setStatus("ファイルが指定されていません");
    return;
  }
  const root = state.project?.projectRoot;
  if (!root) {
    showError(new Error("プロジェクトが読み込まれていません"));
    return;
  }
  const target = `${root}/data/${dir}/${value}`;
  api("/api/reveal", { method: "POST", body: JSON.stringify({ path: target }) })
    .then(() => setStatus(`Finder で ${value} を表示しました`))
    .catch(showError);
}

function bindInspectorFieldExtras(root) {
  root.querySelectorAll("[data-color-for]").forEach((picker) => {
    picker.addEventListener("input", () => {
      const target = root.querySelector(`[data-tag-attr="${picker.dataset.colorFor}"]`);
      if (target) {
        target.value = `0x${picker.value.slice(1)}`;
        target.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  });
  root.querySelectorAll("[data-asset-reveal]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = button.closest(".picker-field")?.querySelector("[data-tag-attr]");
      if (input) revealAsset(input.dataset.assetDir, input.value);
    });
  });
  root.querySelectorAll("[data-asset-pick]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = button.closest(".picker-field")?.querySelector("[data-tag-attr]");
      if (!input) return;
      openAssetPicker({
        dir: input.dataset.assetDir,
        type: input.dataset.assetType,
        current: input.value,
        onPick: (storage) => {
          input.value = storage;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          const thumb = input.closest(".field")?.querySelector(".field-thumb img");
          if (thumb) thumb.src = projectAssetUrl(input.dataset.assetDir, storage);
        },
      });
    });
  });
}

function bindInspectorAutoSave(root) {
  root.querySelectorAll("[data-tag-attr]").forEach((field) => {
    field.addEventListener("input", scheduleTagAutoSave);
    field.addEventListener("change", scheduleTagAutoSave);
  });
}

// label / scenario 補完用 datalist はインスペクタの外（index.html）に常設し、
// 内容が変わったときだけ作り直す。選択行が変わるたびに全ラベル・全ファイル分の
// <option> を innerHTML で組み立て直すのはジャンプ・矢印キー移動の累積負荷になる。
let sharedDatalistKey = "";
function renderSharedDatalists() {
  const labelList = $("#labelNames");
  const scenarioList = $("#scenarioNames");
  if (!labelList || !scenarioList) return;
  const labels = state.scenario?.parsed?.labels || [];
  const key = `${state.currentFile}\u0000${labels.map((label) => label.name).join(",")}\u0000${(state.scenarios || []).length}`;
  if (key === sharedDatalistKey) return;
  sharedDatalistKey = key;
  labelList.innerHTML = labels
    .map((label) => `<option value="*${escapeAttr(label.name)}"></option>`)
    .join("");
  scenarioList.innerHTML = (state.scenarios || [])
    .map((item) => `<option value="${escapeAttr(item.storage)}"></option>`)
    .join("");
}

function setInspectorTagEditingLocked(locked) {
  const root = $("#inspector");
  if (!root) return;
  root.querySelectorAll("[data-tag-attr]").forEach((field) => {
    field.disabled = Boolean(locked);
  });
  const status = $("#tagEditStatus");
  if (status && locked) status.textContent = "行エディターを閉じるとパラメータを編集できます";
}

function renderInspector() {
  const root = $("#inspector");
  if (!root) return;
  renderSharedDatalists();
  if (state.multiSelected.size > 1) {
    const lines = selectionLines();
    root.innerHTML = `
      <div class="inspector-head cat-plain">
        <span class="inspector-kind">${lines.length}行を選択中</span>
        <span class="inspector-loc">${lines[0] + 1}〜${lines[lines.length - 1] + 1}行目</span>
      </div>
      <div class="mini">Shift+クリック / Shift+↑↓ で範囲選択、⌘クリックで個別に追加・解除できます。</div>
      <div class="button-row">
        <button id="multiCopyBtn" class="btn">コピー</button>
        <button id="multiCutBtn" class="btn">切り取り</button>
        <button id="multiDeleteBtn" class="btn danger">${lines.length} 行を削除</button>
      </div>
      <div class="mini">⌘C コピー / ⌘X 切り取り / ⌘V 貼り付け、Delete で削除できます。</div>
    `;
    $("#multiCopyBtn").addEventListener("click", () => copySelectedRows().catch(showError));
    $("#multiCutBtn").addEventListener("click", () => cutSelectedRows().catch(showError));
    $("#multiDeleteBtn").addEventListener("click", () => deleteSelectedLines().catch(showError));
    return;
  }
  const entry = selectedEntry();
  if (!entry) {
    root.innerHTML = `<div class="inspector-empty">行を選択してください</div>`;
    return;
  }
  const tag = entry.tags[0];
  const schema = tag ? TAG_SCHEMAS[tag.name] : null;
  const badge = displayKind(entry);
  const catClass = categoryForEntry(entry);
  let tagEditor = "";
  if (tag && schema?.special === "chara_catalog") {
    tagEditor = `
      <div class="inspector-section-title">パラメータ</div>
      <div id="tagEditorFields" class="form-grid">${renderTagCharaFields(tag.pm || {})}</div>
      <div id="tagEditStatus" class="mini inspector-hint">変更は自動反映されます</div>`;
  } else if (tag && schema) {
    tagEditor = `
      <div class="inspector-section-title">パラメータ</div>
      <div id="tagEditorFields" class="form-grid">${renderSchemaFields(tag, schema)}</div>
      <div id="tagEditStatus" class="mini inspector-hint">変更は自動反映されます</div>`;
  } else if (tag) {
    const attrs = Object.entries(tag.pm || {});
    tagEditor = `
      <div class="inspector-section-title">パラメータ: [${escapeHtml(tag.name)}]</div>
      <div class="form-grid">${attrs
        .map(([key, value]) => `
          <div class="field">
            <label>${escapeHtml(key)}</label>
            <input data-tag-attr="${escapeAttr(key)}" value="${escapeAttr(value)}">
          </div>`)
        .join("") || `<div class="mini">属性なし</div>`}</div>
      <div id="tagEditStatus" class="mini inspector-hint">変更は自動反映されます</div>`;
  } else {
    tagEditor = `<div class="mini inspector-hint">テキスト行はタイムラインでクリックすると直接編集できます。</div>`;
  }
  root.innerHTML = `
    <div class="inspector-head ${catClass}">
      <span class="inspector-kind">${escapeHtml(badge)}</span>
      <span class="inspector-loc">${entry.line + 1}行目</span>
    </div>
    <div class="inspector-summary">${escapeHtml(entry.summary || entry.raw || "(空行)")}</div>
    <div class="button-row">
      <button id="editInlineBtn" class="btn">行を編集</button>
      ${textBlockRangeFor(entry.line) ? `<button id="editBlockBtn" class="btn primary">✎ 執筆モード</button>` : ""}
      <button id="previewAroundBtn" class="btn">ここを再生</button>
      <button id="openRawLineBtn" class="btn ghost">KSで開く</button>
    </div>
    <div class="button-row line-ops">
      <button id="lineUpBtn" class="btn ghost" title="上へ移動">↑</button>
      <button id="lineDownBtn" class="btn ghost" title="下へ移動">↓</button>
      <button id="lineCopyBtn" class="btn ghost" title="コピー (⌘C)">コピー</button>
      <button id="linePasteBtn" class="btn ghost" title="この行の下に貼り付け (⌘V)">貼付</button>
      <button id="lineDupBtn" class="btn ghost" title="複製">複製</button>
      <button id="lineDeleteBtn" class="btn ghost danger" title="削除">削除</button>
    </div>
    <div class="mini inspector-hint">⌘C コピー / ⌘X 切り取り / ⌘V 貼り付け（選択行の下へ）</div>
    ${tagEditor}
  `;
  setInspectorTagEditingLocked(state.inlineEditLine >= 0 || Boolean(state.blockEdit));
  $("#editInlineBtn").addEventListener("click", () => openInlineEditor(entry.line, { renderInspector: false }));
  $("#editBlockBtn")?.addEventListener("click", () => openBlockEditor(entry.line, { renderInspector: false }));
  $("#previewAroundBtn").addEventListener("click", previewFromNearestLabel);
  $("#openRawLineBtn").addEventListener("click", jumpTimelineSelectionToRaw);
  $("#lineUpBtn").addEventListener("click", () => runLineOp("up").catch(showError));
  $("#lineDownBtn").addEventListener("click", () => runLineOp("down").catch(showError));
  $("#lineCopyBtn").addEventListener("click", () => copySelectedRows().catch(showError));
  $("#linePasteBtn").addEventListener("click", () => pasteRows().catch(showError));
  $("#lineDupBtn").addEventListener("click", () => runLineOp("duplicate").catch(showError));
  $("#lineDeleteBtn").addEventListener("click", () => runLineOp("delete").catch(showError));
  if (tag && schema?.special === "chara_catalog") bindTagCharaFieldUpdates();
  bindInspectorFieldExtras(root);
  bindInspectorAutoSave(root);
  updateStatusLocation();
  root.scrollTop = 0;
}

/* ---------- raw editor bridge ---------- */

function rawSelectionLine(editor = $("#rawEditor")) {
  if (!editor) return 0;
  if (editor._ksCodeMirror) {
    return editor._ksCodeMirror.lineAt(editor.selectionStart).number - 1;
  }
  const value = editor.value || "";
  const position = Math.max(0, Math.min(Number(editor.selectionStart || 0), value.length));
  return rawLineOfIndex(value, position);
}

function rawLineOffset(editor, line) {
  if (!editor) return 0;
  if (editor._ksCodeMirror) {
    return editor._ksCodeMirror.line(Math.max(0, Number(line) || 0) + 1).from;
  }
  return rawOffsetOfLine(editor.value || "", line);
}

// input と keyup が同じ打鍵で二重に呼ぶため、caret とテキスト長が前回と
// 同じなら再計算しない（行の再判定・DOM 更新をまるごと省く）
let rawLineStateCache = { file: "", caret: -1, length: -1, text: null };

function updateRawLineState() {
  const editor = $("#rawEditor");
  if (!editor) return;
  const caret = Number(editor.selectionStart || 0);
  const text = editor._ksCodeMirror ? editor._ksCodeMirror.view.state.doc : (editor.value || "");
  const length = text.length;
  if (
    rawLineStateCache.caret === caret &&
    rawLineStateCache.length === length &&
    rawLineStateCache.file === state.currentFile &&
    rawLineStateCache.text === text
  ) {
    return;
  }
  rawLineStateCache = { file: state.currentFile, caret, length, text };
  const line = rawSelectionLine(editor);
  const label = $("#rawLineState");
  if (label) label.textContent = `${line + 1}行目`;
  updateRawActiveLine(line);
  if (rawEditorHasFocus(editor)) {
    state.selectedLine = clampScenarioLine(line);
    updateStatusLocation();
  }
}

async function jumpRawSelectionToTimeline() {
  const file = state.currentFile;
  const line = rawSelectionLine();
  await flushPendingEdits();
  await ensureCurrentScenarioFresh({ line, flush: false });
  if (state.currentFile !== file) return;
  const selected = clampScenarioLine(line);
  const search = $("#timelineSearch");
  if (search) search.value = "";
  const filter = $("#eventFilter");
  if (filter) filter.value = "";
  state.timelineRenderKey = "";
  activateView("editor");
  selectTimelineLine(selected, { scroll: true });
}

async function jumpTimelineSelectionToRaw() {
  const line = clampScenarioLine(state.selectedLine);
  const activated = await activateView("code");
  if (!activated) return;
  window.requestAnimationFrame(() => {
    const editor = $("#rawEditor");
    if (!editor) return;
    const offset = rawLineOffset(editor, line);
    if (editor._ksCodeMirror) {
      editor._ksCodeMirror.focus({ preventScroll: true });
      editor._ksCodeMirror.scrollToPosition(offset, "center");
    } else {
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(offset, offset);
      editor.scrollTop = Math.max(0, line * KS_RAW_LINE_HEIGHT - editor.clientHeight * 0.45);
    }
    renderRawWindow();
    updateRawLineState();
  });
}

/* ---------- editor view binding ---------- */

function bindEditorView() {
  bindScenarioSidebar();
  $("#paletteSearch").addEventListener("input", debounce(renderPalette, 120));
  $("#timelineSearch").addEventListener("input", debounce(renderTimeline, 150));
  $("#eventFilter").addEventListener("change", () => renderTimeline());
  const timeline = $("#timeline");
  timeline.addEventListener("click", (event) => {
    const row = event.target.closest(".timeline-row");
    if (!row || !row.dataset.line) return;
    if (row.dataset.mode === "edit" || row.dataset.mode === "block") return;
    const line = Number(row.dataset.line);
    if (event.shiftKey) {
      // Shift+クリック: アンカーからの範囲選択
      setRangeSelection(state.selAnchor, line);
      selectTimelineLine(line, { keepMulti: true });
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      // ⌘クリック: 個別にトグル
      if (state.multiSelected.size === 0) state.multiSelected.add(state.selectedLine);
      if (state.multiSelected.has(line) && line !== state.selectedLine) {
        state.multiSelected.delete(line);
      } else {
        state.multiSelected.add(line);
      }
      selectTimelineLine(line, { keepMulti: true });
      return;
    }
    if (line === state.selectedLine && state.multiSelected.size === 0) {
      openInlineEditor(line);
      return;
    }
    selectTimelineLine(line);
  });
  timeline.addEventListener("dblclick", (event) => {
    const row = event.target.closest(".timeline-row");
    if (!row || !row.dataset.line || row.dataset.mode !== "row") return;
    const line = Number(row.dataset.line);
    // テキストブロック内ならブロック全体の執筆モード、それ以外は行編集
    if (textBlockRangeFor(line)) {
      openBlockEditor(line);
    } else {
      openInlineEditor(line);
    }
  });
  timeline.addEventListener("scroll", () => {
    if (state.timelineScrollRaf) return;
    state.timelineScrollRaf = requestAnimationFrame(() => {
      state.timelineScrollRaf = 0;
      renderTimelineWindow();
    });
  });
  if (window.ResizeObserver) {
    new ResizeObserver(() => renderTimelineWindow()).observe(timeline);
  }
  bindTimelineDnd();
  [$("#view-editor"), $("#view-code")].forEach((root) => {
    if (!root) return;
    ["pointerdown", "keydown", "input", "focusin"].forEach((eventName) => {
      root.addEventListener(eventName, () => {
        state.previewSyncPausedByEditor = true;
      }, true);
    });
  });
}

registerView("editor", () => {
  renderTimeline();
  renderInspector();
  scrollSelectedLineIntoView();
});
