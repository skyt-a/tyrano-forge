"use strict";

/* ============================================================
   Preview dock — Tyrano runtime iframe / live update / layout edit
   ============================================================ */

function previewOrigin() {
  const url = new URL(window.location.origin);
  // Electron のエディタ本体 (127.0.0.1) と別 site にして、Tyrano の重い
  // runtime を site-per-process の別 renderer へ隔離する。
  url.hostname = url.hostname === "localhost" ? "127.0.0.1" : "localhost";
  return url.origin;
}

let previewBridgeReady = false;
let previewSessionCounter = 0;
let previewSessionId = "";

function previewUrl(target = "", line = null) {
  const params = new URLSearchParams({
    file: state.currentFile,
    target: target || "",
    editorOrigin: window.location.origin,
    previewSession: previewSessionId,
    t: String(Date.now()),
  });
  if (Number.isFinite(line)) params.set("line", String(line));
  return `${previewOrigin()}/project/__editor_preview.html?${params.toString()}`;
}

function previewWindow() {
  const frame = $("#previewFrame");
  try {
    return frame.contentWindow || null;
  } catch (error) {
    return null;
  }
}

function postPreviewMessage(message) {
  if (!previewBridgeReady) return false;
  const win = previewWindow();
  if (!win) return false;
  try {
    win.postMessage({ ...message, previewSession: previewSessionId }, previewOrigin());
    return true;
  } catch (error) {
    return false;
  }
}

function startPreview(target = "", line = null) {
  if (!state.currentFile) return;
  clearLiveScenarioUpdates("プレビューを切り替えました");
  previewSessionId = `preview-${Date.now()}-${(previewSessionCounter += 1)}`;
  previewBridgeReady = false;
  cancelPreviewVolumeFrame();
  clearPreviewResizeTimers();
  clearLivePreviewRequests();
  clearPreviewBootingHint();
  resetPreviewLayoutBridge();
  resumePreviewSyncFromPreview();
  state.previewBoxes = [];
  state.previewMetrics = null;
  state.previewStarted = true;
  state.previewBootingSince = 0;
  document.body.classList.add("preview-live");
  renderPreviewOverlay();
  $("#previewFrame").src = previewUrl(target, line);
  $("#previewState").textContent = Number.isFinite(line)
    ? `${state.currentFile}:${line + 1} から再生`
    : target
      ? `*${target} から再生`
      : "ファイル先頭から再生";
  if (!state.previewOpen) setPreviewOpen(true);
}

function startPreviewFromSelectedLine() {
  const entry = selectedEntry();
  const line = entry ? entry.line : state.selectedLine;
  startPreview("", Number.isFinite(line) ? line : 0);
}

function stopPreview() {
  const frame = $("#previewFrame");
  clearLiveScenarioUpdates("プレビューを停止しました");
  previewSessionId = "";
  previewBridgeReady = false;
  cancelPreviewVolumeFrame();
  clearPreviewResizeTimers();
  if (frame) frame.src = "about:blank";
  clearLivePreviewRequests("プレビューを停止しました");
  clearPreviewBootingHint();
  resetPreviewLayoutBridge();
  state.previewStarted = false;
  state.previewBootingSince = 0;
  state.previewBoxes = [];
  state.previewMetrics = null;
  document.body.classList.remove("preview-live");
  if (state.layoutEdit) setLayoutEdit(false);
  if (state.theater) setTheater(false);
  renderPreviewOverlay();
  $("#previewState").textContent = "停止しました";
  setStatus("プレビューを停止しました");
}

function nearestLabelNameForLine(line) {
  const labels = state.scenario?.parsed?.labels || [];
  const nearest = labels.filter((label) => label.line <= line).pop();
  return nearest ? nearest.name : "";
}

function previewFromNearestLabel() {
  const entry = selectedEntry();
  if (!entry) return;
  const nearest = nearestLabelNameForLine(entry.line);
  if (nearest) $("#labelSelect").value = nearest;
  startPreview("", entry.line);
}

function renderLabelSelect() {
  const select = $("#labelSelect");
  if (!select) return;
  select.innerHTML = `<option value="">ファイル先頭</option>`;
  const labels = state.scenario?.parsed?.labels || [];
  labels.forEach((label) => {
    const option = document.createElement("option");
    option.value = label.name;
    option.textContent = `*${label.name}${label.caption ? `  ${label.caption}` : ""}`;
    select.appendChild(option);
  });
}

/* ---------- live update bridge ---------- */

// ライブ反映の応答待ちは request ごとに window.message リスナーを増やさず、
// bindPreview の単一リスナーから requestId で振り分ける。
const livePreviewPending = new Map();

function settleLivePreviewRequest(data) {
  const pending = livePreviewPending.get(data.requestId);
  if (!pending) return false;
  livePreviewPending.delete(data.requestId);
  clearTimeout(pending.timer);
  pending.resolve(data);
  return true;
}

function clearLivePreviewRequests(error = "プレビューが切り替わりました") {
  livePreviewPending.forEach((pending) => {
    clearTimeout(pending.timer);
    pending.resolve({ ok: false, error });
  });
  livePreviewPending.clear();
}

function requestLivePreview(payload) {
  if (!previewWindow() || !state.previewStarted) {
    return Promise.resolve({ ok: false, error: "プレビュー未起動" });
  }
  const requestId = `live-${Date.now()}-${(state.liveRequestId += 1)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      livePreviewPending.delete(requestId);
      resolve({ ok: false, error: "プレビューから応答がありません" });
    }, 4500);
    livePreviewPending.set(requestId, { resolve, timer });
    if (!postPreviewMessage({ source: "tyranoforge-live-update", requestId, payload })) {
      clearTimeout(timer);
      livePreviewPending.delete(requestId);
      resolve({ ok: false, error: "プレビューへ送信できません" });
    }
  });
}

// ドラッグやペイン resize の高頻度通知は応答待ちに積まず、bridge 側で同期的に
// 処理する。配置の取得など結果が必要な処理だけ requestLivePreview を使う。
function sendPreviewCommand(payload) {
  if (!state.previewStarted) return false;
  return postPreviewMessage({ source: "tyranoforge-live-update", payload });
}

let liveScenarioUpdateActive = null;
const liveScenarioUpdatePending = new Map();
let liveScenarioUpdateGeneration = 0;
const LIVE_SCENARIO_PENDING_LIMIT = 24;

function liveScenarioUpdateKey(job) {
  return `${job.file}\u0000${job.change?.kind || ""}\u0000${Number(job.change?.line || 0)}`;
}

function clearLiveScenarioUpdates(reason = "プレビューが切り替わりました") {
  liveScenarioUpdateGeneration += 1;
  liveScenarioUpdatePending.forEach((job) => job.resolve(""));
  liveScenarioUpdatePending.clear();
}

async function performLivePreviewUpdate(job) {
  if (
    job.generation !== liveScenarioUpdateGeneration ||
    job.session !== previewSessionId ||
    !state.previewStarted
  ) return "";
  // 反映で進行位置が一時的にズレて報告されても編集中の行から飛ばされないよう、
  // しばらくプレビュー追従を保留する（syncFocusToPreview 参照）。
  state.previewFollowHoldUntil = Date.now() + 2500;
  const payload = {
    type: "scenario",
    file: job.file,
    change: job.change,
  };
  const response = await requestLivePreview(payload);
  if (
    job.generation !== liveScenarioUpdateGeneration ||
    job.session !== previewSessionId
  ) return "";
  if (!response.ok) return `反映待ち: ${response.error || "未反映"}`;
  const result = response.result || {};
  if (!result.patched) {
    return result.reason === "different-scenario" ? "別ファイル表示中（次回反映）" : "進行データ未更新";
  }
  if (result.immediate) return "プレビューへ即時反映";
  return "進行データを更新";
}

function startLiveScenarioUpdate(job) {
  liveScenarioUpdateActive = job;
  performLivePreviewUpdate(job)
    .then(job.resolve, job.reject)
    .finally(() => {
      if (liveScenarioUpdateActive === job) liveScenarioUpdateActive = null;
      const first = liveScenarioUpdatePending.entries().next();
      const next = first.done ? null : first.value[1];
      if (!first.done) liveScenarioUpdatePending.delete(first.value[0]);
      if (next && next.generation === liveScenarioUpdateGeneration) {
        startLiveScenarioUpdate(next);
      } else if (next) {
        next.resolve("");
      }
    });
}

function applyLivePreviewUpdate(change = {}, file = state.currentFile) {
  const job = {
    change,
    file,
    session: previewSessionId,
    generation: liveScenarioUpdateGeneration,
  };
  return new Promise((resolve, reject) => {
    Object.assign(job, { resolve, reject });
    if (!state.previewStarted || !job.session) {
      resolve("反映待ち: プレビュー未起動");
      return;
    }
    if (liveScenarioUpdateActive) {
      // 同じ行・種別だけlatest-winsにし、別行のBGM/立ち絵など独立差分は保持する。
      // 上限を設け、preview停止時も全jobを解放して長期メモリ列にしない。
      const key = liveScenarioUpdateKey(job);
      const previous = liveScenarioUpdatePending.get(key);
      if (previous) previous.resolve("新しい変更に統合");
      if (!previous && liveScenarioUpdatePending.size >= LIVE_SCENARIO_PENDING_LIMIT) {
        const oldest = liveScenarioUpdatePending.entries().next();
        if (!oldest.done) {
          oldest.value[1].resolve("反映待ち: 更新が集中したため次回再生で反映");
          liveScenarioUpdatePending.delete(oldest.value[0]);
        }
      }
      liveScenarioUpdatePending.set(key, job);
      return;
    }
    startLiveScenarioUpdate(job);
  });
}

/* ---------- master volume ---------- */

function clampVolume(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

// 実際にプレビューへ送る音量。ミュート中は 0。
function effectivePreviewVolume() {
  return state.previewMuted ? 0 : clampVolume(state.previewVolume, 1);
}

function updateVolumeUI() {
  const wrap = document.querySelector(".preview-volume");
  const slider = $("#previewVolume");
  const value = $("#previewVolumeValue");
  const percent = Math.round(clampVolume(state.previewVolume, 1) * 100);
  if (slider && document.activeElement !== slider) slider.value = String(percent);
  if (value) value.textContent = state.previewMuted ? "ミュート" : String(percent);
  if (wrap) wrap.classList.toggle("muted", state.previewMuted || percent === 0);
  const muteBtn = $("#previewMuteBtn");
  if (muteBtn) muteBtn.title = state.previewMuted ? "ミュート解除" : "ミュート";
}

// 現在の音量を実行中プレビューへ反映する。プレビュー未起動時は何もしない。
let previewVolumeFrame = 0;

function cancelPreviewVolumeFrame() {
  if (!previewVolumeFrame) return;
  cancelAnimationFrame(previewVolumeFrame);
  previewVolumeFrame = 0;
}

function sendPreviewVolume({ immediate = false } = {}) {
  if (!state.previewStarted) return;
  const send = () => {
    previewVolumeFrame = 0;
    sendPreviewCommand({ type: "volume", volume: effectivePreviewVolume() });
  };
  if (immediate) {
    cancelPreviewVolumeFrame();
    send();
    return;
  }
  if (!previewVolumeFrame) previewVolumeFrame = requestAnimationFrame(send);
}

function setPreviewVolume(percent, { persist = true } = {}) {
  state.previewVolume = clampVolume(Number(percent) / 100, 1);
  // 0 以外へ動かしたらミュートは自動解除
  if (state.previewMuted && state.previewVolume > 0) state.previewMuted = false;
  updateVolumeUI();
  sendPreviewVolume({ immediate: persist });
  if (persist) saveUiPrefs();
}

function togglePreviewMute() {
  state.previewMuted = !state.previewMuted;
  // 音量 0 のままミュート解除しても無音なので、その場合は既定値へ戻す
  if (!state.previewMuted && clampVolume(state.previewVolume, 1) === 0) state.previewVolume = 1;
  updateVolumeUI();
  sendPreviewVolume({ immediate: true });
  saveUiPrefs();
}

/* ---------- preview focus sync ---------- */

function normalizePreviewScenario(raw) {
  const rawValue = String(raw || "");
  try {
    const parsed = new URL(rawValue, window.location.origin);
    if (parsed.pathname === "/api/preview-line.ks" && parsed.searchParams.get("file")) {
      return parsed.searchParams.get("file");
    }
  } catch (error) {}
  const value = rawValue.split("?")[0];
  if (!value || value.includes("/api/preview-bootstrap")) return "";
  const marker = "/data/scenario/";
  const markerIndex = value.indexOf(marker);
  const normalized = markerIndex >= 0 ? value.slice(markerIndex + marker.length) : value.replace(/^.*\/data\/scenario\//, "");
  const exact = state.scenarios.find((item) => item.storage === normalized);
  if (exact) return exact.storage;
  const suffix = state.scenarios.find((item) => normalized.endsWith(`/${item.storage}`) || value.endsWith(`/${item.storage}`));
  return suffix ? suffix.storage : normalized;
}

function resumePreviewSyncFromPreview() {
  state.previewSyncPausedByEditor = false;
  state.lastPreviewSyncKey = "";
  const win = previewWindow();
  if (win && state.previewStarted) {
    // bridge 側の同一状態抑制中でも、明示的にプレビューへ戻った瞬間だけ
    // 現在位置を再通知させる。
    postPreviewMessage({ source: "tyranoforge-preview-snapshot-request" });
  }
}

function hasPendingScenarioEdit() {
  return Boolean(
    state.lineSaveTimer || state.rawSaveTimer || state.blockSaveTimer || state.tagSaveTimer ||
    state.lineSaveInFlight || state.rawSaveInFlight || state.blockSaveInFlight || state.tagSaveInFlight ||
    state.lineSaveQueued || state.rawSaveQueued || state.blockSaveQueued || state.tagSaveQueued,
  );
}

function isUserEditing() {
  if (hasPendingScenarioEdit()) return true;
  const element = document.activeElement;
  if (!element) return false;
  if (element.id === "labelSelect" || element.id === "previewFrame") return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

async function syncFocusToPreview(data) {
  // 状態復元（プレフィックス実行）中は合成行に選択を引きずられないよう同期しない
  if (Number(data.booting)) return;
  // KS本文などタイムライン以外のビュー、またはエディタを最後に操作した状態では
  // プレビューの500ms通知で選択・再描画・設定保存を再開しない。プレビューを
  // クリックしたときだけ resumePreviewSyncFromPreview で追従を再開する。
  if (
    !state.syncPreview ||
    state.view !== "editor" ||
    state.previewSyncPausedByEditor ||
    isUserEditing()
  ) return;
  // 自動反映の直後は、差し替え・再インデックスで一時的にズレた進行位置を
  // 報告してくることがある。編集直後の短時間は追従を止め、編集中の行から
  // 勝手に飛ばされないようにする。
  if (Date.now() < (state.previewFollowHoldUntil || 0)) return;
  const storage = normalizePreviewScenario(data.currentScenario);
  if (!storage || !state.scenarios.some((item) => item.storage === storage)) return;
  const line = Math.max(0, Math.floor(Number(data.currentLine || 0)));
  const syncKey = `${storage}:${line}`;
  if (state.lastPreviewSyncKey === syncKey) return;
  state.lastPreviewSyncKey = syncKey;
  if (state.currentFile !== storage) {
    await loadScenario(storage, { line, quiet: true });
    scrollSelectedLineIntoView();
  } else {
    selectTimelineLine(line, { scroll: true });
  }
}

/* ---------- 立ち絵配置編集 ---------- */

let previewLayoutSnapshotSequence = 0;
let previewLayoutSnapshotInFlight = null;
let previewLayoutSnapshotQueued = false;
let pendingPreviewPosition = null;
let previewPositionFrame = 0;

function resetPreviewLayoutBridge() {
  previewLayoutSnapshotSequence += 1;
  previewLayoutSnapshotQueued = false;
  pendingPreviewPosition = null;
  if (previewPositionFrame) cancelAnimationFrame(previewPositionFrame);
  previewPositionFrame = 0;
}

// cross-origin の iframe DOM は親 renderer から読まない。bridge に測定させ、
// structured clone 可能な数値と属性だけを受け取る。
async function performPreviewBoxRefresh() {
  const sequence = ++previewLayoutSnapshotSequence;
  if (!state.layoutEdit || !state.previewStarted) return;
  const response = await requestLivePreview({ type: "layout-snapshot" });
  if (
    sequence !== previewLayoutSnapshotSequence ||
    !state.layoutEdit ||
    state.dragBox
  ) return;
  const snapshot = response.ok ? response.result || {} : {};
  state.previewMetrics = snapshot.metrics || null;
  state.previewBoxes = [];
  if (!state.previewMetrics) {
    renderPreviewOverlay();
    return;
  }
  const stageRect = $("#previewStage").getBoundingClientRect();
  const frameRect = $("#previewFrame").getBoundingClientRect();
  const offsetX = frameRect.left - stageRect.left;
  const offsetY = frameRect.top - stageRect.top;
  state.previewBoxes = (snapshot.boxes || []).map((remote, index) => {
    const rect = remote.rect || {};
    return {
      id: remote.id || `${index}:${remote.appearance}:${remote.variant}:${remote.position}`,
      name: remote.name || "",
      appearance: remote.appearance || "default",
      variant: remote.variant || "normal",
      position: remote.position || "center",
      rect: {
        left: Number(rect.left || 0) + offsetX,
        top: Number(rect.top || 0) + offsetY,
        width: Number(rect.width || 0),
        height: Number(rect.height || 0),
      },
      game: { ...(remote.game || {}) },
      dirty: false,
    };
  });
  renderPreviewOverlay();
}

function refreshPreviewBoxes() {
  if (!state.layoutEdit || !state.previewStarted) return Promise.resolve();
  if (previewLayoutSnapshotInFlight) {
    previewLayoutSnapshotQueued = true;
    return previewLayoutSnapshotInFlight;
  }
  const request = performPreviewBoxRefresh();
  previewLayoutSnapshotInFlight = request;
  const finish = () => {
    if (previewLayoutSnapshotInFlight !== request) return;
    previewLayoutSnapshotInFlight = null;
    if (previewLayoutSnapshotQueued && state.layoutEdit && state.previewStarted) {
      previewLayoutSnapshotQueued = false;
      requestAnimationFrame(() => refreshPreviewBoxes());
    }
  };
  request.then(finish, finish);
  return request;
}

function applyBoxToPreview(box) {
  if (!box?.game) return;
  pendingPreviewPosition = {
    name: box.name || "",
    appearance: box.appearance,
    variant: box.variant,
    position: box.position,
    left: box.game.left,
    top: box.game.top,
  };
  // pointermove ごとに renderer 間メッセージを積まず、描画フレーム単位で最新値
  // だけを送る。
  if (previewPositionFrame) return;
  previewPositionFrame = requestAnimationFrame(() => {
    previewPositionFrame = 0;
    const position = pendingPreviewPosition;
    pendingPreviewPosition = null;
    if (position) sendPreviewCommand({ type: "layout-position", box: position });
  });
}

function schedulePreviewBoxRefresh() {
  if (!state.layoutEdit || state.dragBox) return;
  clearTimeout(state.layoutRefreshTimer);
  state.layoutRefreshTimer = setTimeout(refreshPreviewBoxes, 450);
}

function formatBoxLabel(box) {
  const name = box.name || "名前未取得";
  const game = box.game || {};
  return `${name} / ${box.variant} / ${box.position}  x:${game.left ?? "-"} y:${game.top ?? "-"}`;
}

function renderPreviewOverlay() {
  const stage = $("#previewStage");
  const root = $("#previewOverlay");
  if (!stage || !root) return;
  stage.classList.toggle("layout-editing", state.layoutEdit);
  const dirtyCount = state.previewBoxes.filter((box) => box.dirty).length;
  const fetchBtn = $("#layoutFetchBtn");
  const saveBtn = $("#layoutSaveBtn");
  if (fetchBtn) fetchBtn.classList.toggle("hidden", !state.layoutEdit);
  if (saveBtn) {
    saveBtn.classList.toggle("hidden", !state.layoutEdit);
    saveBtn.disabled = dirtyCount === 0;
  }
  if (!state.layoutEdit) {
    root.innerHTML = "";
    return;
  }
  if (!state.previewBoxes.length) {
    root.innerHTML = `<div class="preview-empty-note">表示中の立ち絵が見つかりません。プレビューを進めてから「取得」を押してください。</div>`;
    return;
  }
  root.innerHTML = "";
  state.previewBoxes.forEach((box, index) => {
    const node = document.createElement("div");
    node.className = `preview-chara-box${box.dirty ? " dirty" : ""}`;
    node.dataset.previewBox = String(index);
    node.style.left = `${box.rect.left}px`;
    node.style.top = `${box.rect.top}px`;
    node.style.width = `${box.rect.width}px`;
    node.style.height = `${box.rect.height}px`;
    node.innerHTML = `<div class="preview-chara-label">${escapeHtml(formatBoxLabel(box))}</div>`;
    node.addEventListener("pointerdown", startPreviewDrag);
    root.appendChild(node);
  });
}

function startPreviewDrag(event) {
  if (!state.layoutEdit) return;
  const index = Number(event.currentTarget.dataset.previewBox);
  const box = state.previewBoxes[index];
  if (!box) return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.setPointerCapture(event.pointerId);
  state.dragBox = {
    index,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startRect: { ...box.rect },
    startGame: { ...box.game },
    node: event.currentTarget,
  };
  event.currentTarget.addEventListener("pointermove", movePreviewDrag);
  event.currentTarget.addEventListener("pointerup", finishPreviewDrag);
  event.currentTarget.addEventListener("pointercancel", finishPreviewDrag);
}

function movePreviewDrag(event) {
  const drag = state.dragBox;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const box = state.previewBoxes[drag.index];
  if (!box) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  const metrics = state.previewMetrics || { scaleX: 1, scaleY: 1 };
  box.rect = {
    ...box.rect,
    left: Math.round(drag.startRect.left + dx),
    top: Math.round(drag.startRect.top + dy),
  };
  box.game = {
    ...box.game,
    left: Math.round(drag.startGame.left + dx / (metrics.scaleX || 1)),
    top: Math.round(drag.startGame.top + dy / (metrics.scaleY || 1)),
  };
  box.dirty = true;
  drag.node.classList.add("dirty");
  drag.node.style.left = `${box.rect.left}px`;
  drag.node.style.top = `${box.rect.top}px`;
  drag.node.querySelector(".preview-chara-label").textContent = formatBoxLabel(box);
  const saveBtn = $("#layoutSaveBtn");
  if (saveBtn) saveBtn.disabled = false;
  applyBoxToPreview(box);
}

function finishPreviewDrag(event) {
  const drag = state.dragBox;
  if (!drag || drag.pointerId !== event.pointerId) return;
  drag.node.removeEventListener("pointermove", movePreviewDrag);
  drag.node.removeEventListener("pointerup", finishPreviewDrag);
  drag.node.removeEventListener("pointercancel", finishPreviewDrag);
  state.dragBox = null;
  renderPreviewOverlay();
}

function setLayoutEdit(enabled) {
  state.layoutEdit = enabled;
  updateTransportButtons();
  if (enabled) {
    refreshPreviewBoxes();
  } else {
    resetPreviewLayoutBridge();
    state.previewBoxes = [];
    renderPreviewOverlay();
  }
}

async function savePreviewLayout() {
  const dirtyBoxes = state.previewBoxes.filter((box) => box.dirty);
  if (!dirtyBoxes.length) {
    setStatus("保存する配置変更はありません");
    return;
  }
  let settingsHash = state.catalog?.settingsHash || "";
  for (const box of dirtyBoxes) {
    if (!box.name) throw new Error("立ち絵の名前を取得できないため、配置を保存できません");
    const result = await api("/api/tatie/frame", {
      method: "POST",
      body: JSON.stringify({
        name: box.name,
        appearance: box.appearance,
        variant: box.variant,
        position: box.position,
        left: box.game.left,
        top: box.game.top,
        baseHash: settingsHash,
      }),
    });
    settingsHash = result.settingsHash || result.hash || settingsHash;
  }
  const characters = await api("/api/characters");
  state.catalog = characters.catalog;
  const liveFrames = dirtyBoxes.map((box) => ({
    name: box.name,
    appearance: box.appearance,
    variant: box.variant,
    position: box.position,
    left: box.game.left,
    top: box.game.top,
    width: box.game.width,
    height: box.game.height,
  }));
  const live = await requestLivePreview({ type: "chara-frame", frames: liveFrames });
  state.previewBoxes.forEach((box) => {
    box.dirty = false;
  });
  renderPreviewOverlay();
  toast(`立ち絵の配置を保存しました (${dirtyBoxes.length}件)${live.ok ? "" : " / プレビュー反映は次回"}`, "success");
}

/* ---------- dock controls ---------- */

// 連続で呼ばれたら（ペインのドラッグ・ResizeObserver）前回予約分を取り消して
// 張り直す。取り消さないと1回の呼び出しごとに4つのタイマーが積まれ、
// ドラッグ中は iframe 側の再フィット処理が大量に走って全体が重くなる。
let previewResizeTimers = [];

function clearPreviewResizeTimers() {
  previewResizeTimers.forEach(clearTimeout);
  previewResizeTimers = [];
}

function notifyPreviewResize() {
  clearPreviewResizeTimers();
  if (!state.previewStarted) {
    return;
  }
  previewResizeTimers = [0, 80, 240, 520].map((delay) =>
    setTimeout(() => {
      sendPreviewCommand({ type: "resize" });
      // overlay snapshotはresize burstの最後だけ。in-flightもactive+dirty 1件へ
      // 合流するため、4.5秒timeout requestをドラッグ中に積まない。
      if (state.layoutEdit && delay === 520) refreshPreviewBoxes();
    }, delay));
}

function setPreviewOpen(open) {
  state.previewOpen = open;
  document.body.classList.toggle("preview-collapsed", !open);
  const button = $("#previewCollapseBtn");
  if (button) {
    button.textContent = open ? "▾" : "▸";
    button.title = open ? "プレビューをたたむ" : "プレビューを開く";
  }
  saveUiPrefs();
  notifyPreviewResize();
  renderTimelineWindow();
}

function setTheater(on) {
  state.theater = on;
  document.body.classList.toggle("theater", on);
  const button = $("#theaterBtn");
  if (button) button.title = on ? "通常表示に戻す (Esc)" : "シアターモード";
  notifyPreviewResize();
  if (state.layoutEdit) setTimeout(refreshPreviewBoxes, 300);
}

function updateTransportButtons() {
  $("#syncBtn")?.classList.toggle("on", state.syncPreview);
  $("#autoBtn")?.classList.toggle("on", state.autoPreview);
  $("#layoutBtn")?.classList.toggle("on", state.layoutEdit);
  renderPreviewOverlay();
}

let previewBootingHintTimer = 0;

function setPreviewStateText(text) {
  const node = $("#previewState");
  if (node && node.textContent !== text) node.textContent = text;
}

function clearPreviewBootingHint() {
  if (previewBootingHintTimer) clearTimeout(previewBootingHintTimer);
  previewBootingHintTimer = 0;
}

function showPreviewBootingState() {
  if (!state.previewBootingSince) {
    state.previewBootingSince = Date.now();
    clearPreviewBootingHint();
    previewBootingHintTimer = setTimeout(() => {
      previewBootingHintTimer = 0;
      if (!state.previewBootingSince || !state.previewStarted) return;
      setPreviewStateText("準備中…進まない場合はプレビュー画面をクリック");
    }, 3100);
  }
  const stuck = Date.now() - state.previewBootingSince > 3000;
  setPreviewStateText(stuck
    ? "準備中…進まない場合はプレビュー画面をクリック"
    : "準備中…");
}

function bindPreview() {
  $("#playFileBtn").addEventListener("click", () => startPreview(""));
  $("#stopBtn").addEventListener("click", stopPreview);
  $("#playLabelBtn").addEventListener("click", () => startPreview($("#labelSelect").value));
  $("#syncBtn").addEventListener("click", () => {
    state.syncPreview = !state.syncPreview;
    if (state.syncPreview) resumePreviewSyncFromPreview();
    updateTransportButtons();
  });
  $("#autoBtn").addEventListener("click", () => {
    state.autoPreview = !state.autoPreview;
    updateTransportButtons();
  });
  $("#layoutBtn").addEventListener("click", () => setLayoutEdit(!state.layoutEdit));
  $("#layoutFetchBtn").addEventListener("click", refreshPreviewBoxes);
  $("#layoutSaveBtn").addEventListener("click", () => savePreviewLayout().catch(showError));
  $("#previewCollapseBtn").addEventListener("click", () => setPreviewOpen(!state.previewOpen));
  $("#theaterBtn").addEventListener("click", () => setTheater(!state.theater));
  $("#previewVolume").addEventListener("input", (event) => setPreviewVolume(event.target.value, { persist: false }));
  $("#previewVolume").addEventListener("change", (event) => setPreviewVolume(event.target.value));
  $("#previewMuteBtn").addEventListener("click", togglePreviewMute);
  $(".preview-placeholder")?.addEventListener("click", (event) => {
    event.preventDefault();
    startPreviewFromSelectedLine();
  });
  const frame = $("#previewFrame");
  updateVolumeUI();
  frame.addEventListener("pointerdown", resumePreviewSyncFromPreview);
  window.addEventListener("message", (event) => {
    // localhost の preview frame 以外から同名 message を注入させない。
    if (event.source !== previewWindow() || event.origin !== previewOrigin()) return;
    const data = event.data || {};
    if (!state.previewStarted || !previewSessionId || data.previewSession !== previewSessionId) return;
    const bridgeBecameReady = !previewBridgeReady;
    previewBridgeReady = true;
    if (bridgeBecameReady) {
      // iframe の load は src 属性が先に切り替わり、contentWindow がまだ旧
      // about:blank の瞬間にも発火し得る。実bridgeからorigin検証済みmessageを
      // 受けた時点をreadyとし、初回コマンドはここから送る。
      notifyPreviewResize();
      sendPreviewVolume({ immediate: true });
      if (state.layoutEdit) setTimeout(refreshPreviewBoxes, 650);
    }
    if (data.source === "tyranoforge-preview-ready") return;
    if (data.source === "tyranoforge-preview-interaction") {
      resumePreviewSyncFromPreview();
      return;
    }
    if (data.source === "tyranoforge-live-result") {
      settleLivePreviewRequest(data);
      return;
    }
    if (data.source === "tyranoforge-preview") {
      if (Number(data.booting)) {
        // 状態復元中。音声の自動再生がブロックされていると止まることがあるので案内する
        showPreviewBootingState();
      } else {
        clearPreviewBootingHint();
        state.previewBootingSince = 0;
        setPreviewStateText(`${data.currentScenario || ""}:${data.currentLine || 0}${data.currentBgm ? `  ♪${data.currentBgm}` : ""}`);
      }
      syncFocusToPreview(data).catch(showError);
      schedulePreviewBoxRefresh();
    }
    if (data.source === "tyranoforge-preview-error") {
      setPreviewStateText(`preview error: ${data.message}`);
    }
  });
  if (window.ResizeObserver) {
    new ResizeObserver(() => notifyPreviewResize()).observe($("#previewStage"));
  }
  updateTransportButtons();
}
