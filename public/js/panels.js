"use strict";

/* ============================================================
   Assets / Flow / Diagnostics / Code / History / Asset picker
   ============================================================ */

/* ---------- assets view ---------- */

const ASSET_KINDS = [
  { id: "bgimage", label: "背景" },
  { id: "fgimage", label: "立ち絵" },
  { id: "image", label: "UI画像" },
  { id: "bgm", label: "BGM" },
  { id: "sound", label: "SE" },
  { id: "video", label: "動画" },
];

function assetKindFlags(kind = state.selectedAssetKind) {
  return {
    isImage: ["bgimage", "fgimage", "image"].includes(kind),
    isAudio: ["bgm", "sound"].includes(kind),
    isVideo: kind === "video",
  };
}

const ASSET_UPLOAD_EXTS = {
  bgimage: [".png", ".jpg", ".jpeg", ".webp", ".gif"],
  fgimage: [".png", ".jpg", ".jpeg", ".webp", ".gif"],
  image: [".png", ".jpg", ".jpeg", ".webp", ".gif"],
  bgm: [".ogg", ".mp3", ".m4a", ".wav"],
  sound: [".ogg", ".mp3", ".m4a", ".wav"],
  video: [".mp4", ".webm", ".ogv"],
};

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function stopAssetAudio() {
  if (state.audioPlayer) {
    state.audioPlayer.pause();
    state.audioPlayer = null;
  }
  state.playingUrl = "";
  updateMediaBar();
}

function toggleAssetAudio(asset) {
  if (state.playingUrl === asset.url) {
    stopAssetAudio();
    return;
  }
  stopAssetAudio();
  const player = new Audio(asset.url);
  state.audioPlayer = player;
  state.playingUrl = asset.url;
  state.playingName = asset.storage;
  player.addEventListener("ended", () => {
    if (state.audioPlayer !== player) return;
    stopAssetAudio();
    refreshAssetPlayButtons();
  });
  player.addEventListener("timeupdate", () => {
    if (state.audioPlayer !== player) return;
    updateMediaBar();
  });
  player.addEventListener("loadedmetadata", updateMediaBar);
  player.play().catch((error) => {
    if (error && error.name === "AbortError") return;
    stopAssetAudio();
    refreshAssetPlayButtons();
    showError(error);
  });
  updateMediaBar();
}

/* ---------- 再生バー（BGM / SE シーク付き） ---------- */

function updateMediaBar() {
  const bar = $("#mediaBar");
  if (!bar) return;
  const player = state.audioPlayer;
  if (!player) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");
  $("#mediaName").textContent = state.playingName || "";
  $("#mediaName").title = state.playingName || "";
  const playBtn = $("#mediaPlayBtn");
  playBtn.textContent = player.paused ? "▶" : "⏸";
  const seek = $("#mediaSeek");
  const duration = Number.isFinite(player.duration) ? player.duration : 0;
  if (!seek.matches(":active") && duration > 0) {
    seek.value = String(Math.round((player.currentTime / duration) * 1000));
  }
  $("#mediaTime").textContent = `${formatDuration(player.currentTime)} / ${formatDuration(duration)}`;
}

function bindMediaBar() {
  $("#mediaPlayBtn").addEventListener("click", () => {
    const player = state.audioPlayer;
    if (!player) return;
    if (player.paused) player.play().catch(() => {});
    else player.pause();
    updateMediaBar();
    refreshAssetPlayButtons();
  });
  $("#mediaSeek").addEventListener("input", () => {
    const player = state.audioPlayer;
    if (!player || !Number.isFinite(player.duration)) return;
    player.currentTime = (Number($("#mediaSeek").value) / 1000) * player.duration;
    updateMediaBar();
  });
  $("#mediaStopBtn").addEventListener("click", () => {
    stopAssetAudio();
    refreshAssetPlayButtons();
  });
}

/* ---------- 動画プレビュー ---------- */

function openVideoPreview(asset) {
  stopAssetAudio();
  refreshAssetPlayButtons();
  const modal = $("#videoModal");
  $("#videoModalTitle").textContent = asset.storage;
  const video = $("#videoPlayer");
  video.src = asset.url;
  modal.classList.remove("hidden");
  video.play().catch(() => {});
}

function closeVideoPreview() {
  const video = $("#videoPlayer");
  video.pause();
  video.removeAttribute("src");
  video.load();
  $("#videoModal").classList.add("hidden");
}

function bindVideoPreview() {
  $("#videoModalClose").addEventListener("click", closeVideoPreview);
  $("#videoModal").addEventListener("mousedown", (event) => {
    if (event.target.id === "videoModal") closeVideoPreview();
  });
}

function refreshAssetPlayButtons() {
  $$("#assetGrid .asset-play").forEach((button) => {
    const playing = button.dataset.url === state.playingUrl && state.playingUrl !== "";
    button.textContent = playing ? "■ 停止" : "▶ 試聴";
    button.classList.toggle("on", playing);
  });
}

function folderOf(storage) {
  const value = String(storage || "");
  const index = value.lastIndexOf("/");
  return index >= 0 ? value.slice(0, index) : "";
}

function folderRowsFor(assets) {
  const folders = new Map();
  folders.set("", { path: "", directCount: 0 });
  assets.forEach((asset) => {
    const folder = folderOf(asset.storage);
    const parts = folder ? folder.split("/") : [];
    for (let index = 0; index <= parts.length; index += 1) {
      const path = parts.slice(0, index).join("/");
      if (!folders.has(path)) folders.set(path, { path, directCount: 0 });
    }
    folders.get(folder).directCount += 1;
  });
  const rows = [{ path: null, depth: 0, label: "すべて", count: assets.length }];
  [...folders.values()]
    .sort((a, b) => a.path.localeCompare(b.path, "ja"))
    .forEach((folder) => {
      rows.push({
        path: folder.path,
        depth: folder.path ? folder.path.split("/").length : 0,
        label: folder.path === "" ? "直下" : folder.path.split("/").pop(),
        count: folder.directCount,
      });
    });
  return rows;
}

function renderAssetFolders() {
  const root = $("#assetFolders");
  const assets = state.assets[state.selectedAssetKind] || [];
  const fragment = document.createDocumentFragment();
  root.innerHTML = "";
  folderRowsFor(assets).forEach((folder) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `folder-item${folder.path === state.assetFolder ? " active" : ""}`;
    button.style.paddingLeft = `${10 + folder.depth * 14}px`;
    button.innerHTML = `
      <span class="folder-name" title="${escapeAttr(folder.path || folder.label)}">${escapeHtml(folder.label)}</span>
      <span class="folder-count">${folder.count}</span>
    `;
    button.addEventListener("click", () => {
      state.assetFolder = folder.path;
      renderAssets();
    });
    fragment.appendChild(button);
  });
  root.appendChild(fragment);
}

function fillAssetItem(node, asset, index) {
  const { isImage, isVideo } = assetKindFlags();
  node.dataset.index = index;
  node.classList.toggle("active", asset === state.selectedAsset);
  if (isImage) {
    const img = node.querySelector(".asset-thumb img");
    if (img.dataset.url !== asset.url) {
      img.dataset.url = asset.url;
      img.src = asset.url;
    }
  }
  const name = node.querySelector(".asset-name");
  name.textContent = asset.storage.split("/").pop();
  name.title = asset.storage;
  const play = node.querySelector(".asset-play");
  if (play) {
    play.dataset.url = asset.url;
    if (isVideo) {
      play.textContent = "▶ 再生";
    } else {
      const playing = state.playingUrl === asset.url;
      play.textContent = playing ? "■ 停止" : "▶ 試聴";
      play.classList.toggle("on", playing);
    }
  }
}

function renderAssetGridWindow() {
  const root = $("#assetGrid");
  const spacer = state.assetGridSpacer;
  if (!root || !spacer || !root.contains(spacer)) return;
  const items = state.assetGridItems || [];
  const { isImage, isAudio, isVideo } = assetKindFlags();
  const gap = 10;
  // geometry の読みをスペーサの書き込みより先にまとめる（強制レイアウト回避）
  const available = root.clientWidth - 24;
  const scrollTop = root.scrollTop;
  const clientHeight = root.clientHeight;
  if (available <= 0) return;
  const cols = Math.max(1, Math.floor((available + gap) / (156 + gap)));
  const cellWidth = Math.floor((available - gap * (cols - 1)) / cols);
  const itemHeight = isAudio || isVideo ? 184 : 148;
  const strideY = itemHeight + gap;
  const rowCount = Math.ceil(items.length / cols);
  spacer.style.height = `${Math.max(0, rowCount * strideY - gap)}px`;
  const firstRow = Math.max(0, Math.floor(scrollTop / strideY) - 2);
  const lastRow = Math.min(rowCount, Math.ceil((scrollTop + clientHeight) / strideY) + 2);
  const start = firstRow * cols;
  const end = Math.min(items.length, lastRow * cols);
  const nodes = state.assetGridNodes;
  for (const [index, node] of [...nodes]) {
    if (index < start || index >= end) {
      node.remove();
      nodes.delete(index);
    }
  }
  for (let index = start; index < end; index += 1) {
    let node = nodes.get(index);
    if (!node) {
      node = document.createElement("div");
      node.className = "asset-item";
      node.innerHTML = `
        <div class="asset-thumb">${isImage ? `<img alt="" loading="lazy">` : `<span>${escapeHtml(state.selectedAssetKind.toUpperCase())}</span>`}</div>
        <div class="asset-name"></div>
        ${isAudio || isVideo ? `<button type="button" class="btn ghost asset-play"></button>` : ""}
      `;
      spacer.appendChild(node);
      nodes.set(index, node);
    }
    node.style.top = `${Math.floor(index / cols) * strideY}px`;
    node.style.left = `${(index % cols) * (cellWidth + gap)}px`;
    node.style.width = `${cellWidth}px`;
    node.style.height = `${itemHeight}px`;
    fillAssetItem(node, items[index], index);
  }
}

function renderAssets() {
  const kind = state.selectedAssetKind;
  const query = ($("#assetSearch")?.value || "").trim().toLowerCase();
  const root = $("#assetGrid");
  if (!root) return;
  $$("#assetKinds button").forEach((button) => {
    button.classList.toggle("active", button.dataset.assetKind === kind);
  });
  renderAssetFolders();
  state.assetGridItems = (state.assets[kind] || []).filter((asset) => {
    const folderMatches = state.assetFolder === null || folderOf(asset.storage) === state.assetFolder;
    return folderMatches && (!query || asset.storage.toLowerCase().includes(query));
  });
  state.assetGridNodes = new Map();
  root.innerHTML = "";
  const spacer = document.createElement("div");
  spacer.className = "asset-spacer";
  root.appendChild(spacer);
  state.assetGridSpacer = spacer;
  renderAssetGridWindow();
}

async function useSelectedAsset() {
  if (!state.selectedAsset) {
    toast("素材が選択されていません", "warn");
    return;
  }
  const storage = state.selectedAsset.storage;
  const kindToContent = {
    bgimage: () => tagLine("bg", { time: 1000, method: "crossfade", storage }),
    bgm: () => tagLine("playbgm", { volume: 100, time: 1000, loop: "true", storage }),
    sound: () => tagLine("playse", { volume: 100, buf: 0, storage }),
    video: () => tagLine("movie", { storage, skip: "true" }),
  };
  const make = kindToContent[state.selectedAssetKind];
  if (!make) {
    toast("この素材種別は直接挿入に未対応です", "warn");
    return;
  }
  await insertContentAt(make(), state.selectedLine, "after");
  activateView("editor");
  toast(`${storage} を挿入しました`, "success");
}

function bindAssetsView() {
  const kindsRoot = $("#assetKinds");
  kindsRoot.innerHTML = ASSET_KINDS.map(
    (kind) => `<button data-asset-kind="${kind.id}"${kind.id === state.selectedAssetKind ? ' class="active"' : ""}>${kind.label}</button>`,
  ).join("");
  kindsRoot.addEventListener("click", (event) => {
    const button = event.target.closest("[data-asset-kind]");
    if (!button) return;
    state.selectedAssetKind = button.dataset.assetKind;
    state.selectedAsset = null;
    state.assetFolder = null;
    stopAssetAudio();
    renderAssets();
  });
  $("#assetSearch").addEventListener("input", debounce(renderAssets, 150));
  $("#useAssetBtn").addEventListener("click", () => useSelectedAsset().catch(showError));
  const grid = $("#assetGrid");
  grid.addEventListener("click", (event) => {
    const item = event.target.closest(".asset-item");
    if (!item) return;
    const asset = state.assetGridItems[Number(item.dataset.index)];
    if (!asset) return;
    if (event.target.closest(".asset-play")) {
      if (state.selectedAssetKind === "video") {
        openVideoPreview(asset);
      } else {
        toggleAssetAudio(asset);
        refreshAssetPlayButtons();
      }
      return;
    }
    state.selectedAsset = asset;
    state.assetGridNodes?.forEach((node, index) => {
      node.classList.toggle("active", state.assetGridItems[index] === asset);
    });
  });
  grid.addEventListener("dblclick", (event) => {
    const item = event.target.closest(".asset-item");
    if (!item) return;
    const asset = state.assetGridItems[Number(item.dataset.index)];
    if (!asset) return;
    state.selectedAsset = asset;
    useSelectedAsset().catch(showError);
  });
  grid.addEventListener("scroll", () => {
    if (state.assetGridScrollRaf) return;
    state.assetGridScrollRaf = requestAnimationFrame(() => {
      state.assetGridScrollRaf = 0;
      renderAssetGridWindow();
    });
  });
  if (window.ResizeObserver) {
    new ResizeObserver(() => renderAssetGridWindow()).observe(grid);
  }
}

registerView("assets", renderAssets);

/* ---------- 素材アップロード（Finder からのドラッグ＆ドロップ） ---------- */

let uploadEntries = [];

function bindAssetUpload() {
  const grid = $("#assetGrid");
  ["dragover", "dragenter"].forEach((name) => {
    grid.addEventListener(name, (event) => {
      const types = [...(event.dataTransfer?.types || [])];
      if (!types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      grid.classList.add("drop-target");
    });
  });
  grid.addEventListener("dragleave", (event) => {
    if (event.target === grid) grid.classList.remove("drop-target");
  });
  grid.addEventListener("drop", (event) => {
    grid.classList.remove("drop-target");
    const files = [...(event.dataTransfer?.files || [])];
    if (!files.length) return;
    event.preventDefault();
    openUploadModal(files);
  });
  $("#uploadCancel").addEventListener("click", closeUploadModal);
  $("#uploadModal").addEventListener("mousedown", (event) => {
    if (event.target.id === "uploadModal") closeUploadModal();
  });
  $("#uploadRun").addEventListener("click", () => runUpload().catch(showError));
}

function openUploadModal(files) {
  const kind = state.selectedAssetKind;
  const exts = ASSET_UPLOAD_EXTS[kind] || [];
  uploadEntries = files.map((file) => {
    const ext = `.${file.name.split(".").pop()}`.toLowerCase();
    return {
      file,
      name: file.name,
      valid: exts.includes(ext),
      status: exts.includes(ext) ? "" : `未対応の拡張子（${exts.join(" ")}）`,
      done: false,
    };
  });
  const kindLabel = ASSET_KINDS.find((item) => item.id === kind)?.label || kind;
  const folderLabel = state.assetFolder ? state.assetFolder : "直下";
  $("#uploadDest").textContent = `${kindLabel} / ${folderLabel} に追加します（名前は編集できます）`;
  renderUploadRows();
  $("#uploadModal").classList.remove("hidden");
}

function closeUploadModal() {
  $("#uploadModal").classList.add("hidden");
  uploadEntries = [];
}

function renderUploadRows() {
  const root = $("#uploadRows");
  root.innerHTML = uploadEntries.map((entry, index) => `
    <div class="upload-row${entry.valid ? "" : " invalid"}">
      <input data-upload-index="${index}" value="${escapeAttr(entry.name)}"${entry.done || !entry.valid ? " disabled" : ""}>
      <span class="upload-size mini">${escapeHtml(formatBytes(entry.file.size))}</span>
      <span class="upload-status mini${entry.status && !entry.done ? " diag-error" : ""}">${entry.done ? "✓ 追加済み" : escapeHtml(entry.status)}</span>
    </div>
  `).join("");
  root.querySelectorAll("[data-upload-index]").forEach((input) => {
    input.addEventListener("input", () => {
      uploadEntries[Number(input.dataset.uploadIndex)].name = input.value;
    });
  });
}

async function runUpload() {
  const kind = state.selectedAssetKind;
  const folder = state.assetFolder || "";
  const overwrite = $("#uploadOverwrite").checked ? "1" : "0";
  let succeeded = 0;
  for (const entry of uploadEntries) {
    if (!entry.valid || entry.done) continue;
    const name = entry.name.trim();
    if (!name) {
      entry.status = "名前が空です";
      continue;
    }
    entry.status = "アップロード中…";
    renderUploadRows();
    try {
      const params = new URLSearchParams({ kind, folder, name, overwrite });
      const response = await fetch(`/api/asset/upload?${params}`, {
        method: "POST",
        headers: sessionHeaders(),
        body: entry.file,
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) {
        entry.status = data.code === "EXISTS" ? "同名ファイルあり（上書きを許可するか名前を変更）" : (data.error || "失敗");
      } else {
        entry.done = true;
        entry.status = "";
        succeeded += 1;
      }
    } catch (error) {
      entry.status = error.message || "失敗";
    }
    renderUploadRows();
  }
  if (succeeded) {
    const assets = await api("/api/assets");
    state.assets = assets.assets;
    renderAssets();
    toast(`${succeeded}件の素材を追加しました`, "success");
  }
  if (uploadEntries.every((entry) => entry.done || !entry.valid)) {
    closeUploadModal();
  }
}

/* ---------- 汎用素材ピッカー ---------- */

const PICKER_DIR_TO_KIND = {
  bgimage: "bgimage",
  fgimage: "fgimage",
  image: "image",
  bgm: "bgm",
  sound: "sound",
  video: "video",
};

function openAssetPicker({ dir, type, current, onPick }) {
  const kind = PICKER_DIR_TO_KIND[dir] || (type === "sound" ? "sound" : type === "movie" ? "video" : "image");
  state.assetPicker = { kind, dir, current: current || "", onPick, folder: current ? folderOf(current) : null };
  $("#assetPickerTitle").textContent = `${ASSET_KINDS.find((item) => item.id === kind)?.label || kind} を選択`;
  $("#assetPickerSearch").value = "";
  $("#assetPickerModal").classList.remove("hidden");
  renderAssetPicker();
  setTimeout(() => $("#assetPickerSearch").focus(), 0);
}

function closeAssetPicker() {
  stopAssetAudio();
  state.assetPicker = null;
  $("#assetPickerModal").classList.add("hidden");
}

function renderAssetPicker() {
  const picker = state.assetPicker;
  if (!picker) return;
  const assets = state.assets[picker.kind] || [];
  const query = ($("#assetPickerSearch").value || "").trim().toLowerCase();
  const folders = $("#assetPickerFolders");
  folders.innerHTML = "";
  folderRowsFor(assets).forEach((folder) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `folder-item${folder.path === picker.folder ? " active" : ""}`;
    button.style.paddingLeft = `${10 + folder.depth * 14}px`;
    button.innerHTML = `<span class="folder-name">${escapeHtml(folder.label)}</span><span class="folder-count">${folder.count}</span>`;
    button.addEventListener("click", () => {
      picker.folder = folder.path;
      renderAssetPicker();
    });
    folders.appendChild(button);
  });
  const grid = $("#assetPickerGrid");
  const { isImage, isAudio } = assetKindFlags(picker.kind);
  const list = assets.filter((asset) => {
    const folderMatches = picker.folder === null || folderOf(asset.storage) === picker.folder;
    return folderMatches && (!query || asset.storage.toLowerCase().includes(query));
  });
  grid.innerHTML = "";
  if (!list.length) {
    grid.innerHTML = `<div class="qo-empty">該当する素材がありません</div>`;
    return;
  }
  const fragment = document.createDocumentFragment();
  list.slice(0, 400).forEach((asset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `picker-item${asset.storage === picker.current ? " active" : ""}`;
    button.innerHTML = `
      <div class="asset-thumb">${isImage ? `<img src="${escapeAttr(asset.url)}" loading="lazy" alt="">` : `<span>${escapeHtml(picker.kind.toUpperCase())}</span>`}</div>
      <div class="asset-name" title="${escapeAttr(asset.storage)}">${escapeHtml(asset.storage.split("/").pop())}</div>
      ${isAudio ? `<span class="btn ghost asset-play" data-url="${escapeAttr(asset.url)}">▶ 試聴</span>` : ""}
    `;
    button.addEventListener("click", (event) => {
      if (event.target.closest(".asset-play")) {
        toggleAssetAudio(asset);
        $$("#assetPickerGrid .asset-play").forEach((play) => {
          const playing = play.dataset.url === state.playingUrl && state.playingUrl !== "";
          play.textContent = playing ? "■ 停止" : "▶ 試聴";
        });
        return;
      }
      const onPick = picker.onPick;
      closeAssetPicker();
      onPick(asset.storage);
    });
    fragment.appendChild(button);
  });
  grid.appendChild(fragment);
  if (list.length > 400) {
    const note = document.createElement("div");
    note.className = "mini";
    note.textContent = `他 ${list.length - 400} 件は検索で絞り込んでください`;
    grid.appendChild(note);
  }
}

function bindAssetPicker() {
  $("#assetPickerClose").addEventListener("click", closeAssetPicker);
  $("#assetPickerModal").addEventListener("mousedown", (event) => {
    if (event.target.id === "assetPickerModal") closeAssetPicker();
  });
  $("#assetPickerSearch").addEventListener("input", debounce(renderAssetPicker, 150));
}

/* ---------- flow view ---------- */

function renderFlow() {
  const root = $("#flowView");
  if (!root || !state.scenario) return;
  const parsed = state.scenario.parsed;
  const flowItems = [
    ...parsed.jumps.map((item) => ({ ...item, type: "jump" })),
    ...parsed.calls.map((item) => ({ ...item, type: "call" })),
  ].sort((a, b) => a.line - b.line);
  const labelRow = (label) => `
    <tr data-label-line="${label.line}" data-label-name="${escapeAttr(label.name)}">
      <td><button class="line-link" data-flow-focus="${label.line}">${label.line + 1}</button></td>
      <td class="mono">*${escapeHtml(label.name)}</td>
      <td><input data-label-field="newName" value="${escapeAttr(label.name)}"></td>
      <td><input data-label-field="caption" value="${escapeAttr(label.caption || "")}" placeholder="表示名"></td>
      <td><button class="btn primary" data-label-save="${label.line}">保存</button></td>
    </tr>`;
  const flowRow = (item) => `
    <tr data-flow-line="${item.line}">
      <td><button class="line-link" data-flow-focus="${item.line}">${item.line + 1}</button></td>
      <td>${escapeHtml(item.type)}</td>
      <td><input data-flow-field="storage" value="${escapeAttr(item.storage || "")}" placeholder="${escapeAttr(state.currentFile)}"></td>
      <td><input data-flow-field="target" value="${escapeAttr(item.target || "")}" list="flowLabelNames" placeholder="*label"></td>
      <td><button class="btn primary" data-flow-save="${item.line}">保存</button></td>
    </tr>`;
  const choiceRow = (item) => `
    <tr data-flow-line="${item.line}">
      <td><button class="line-link" data-flow-focus="${item.line}">${item.line + 1}</button></td>
      <td>${escapeHtml(item.tag)}</td>
      <td><input data-flow-field="text" value="${escapeAttr(item.text || "")}" placeholder="表示テキスト"></td>
      <td><input data-flow-field="storage" value="${escapeAttr(item.storage || state.currentFile)}"></td>
      <td><input data-flow-field="target" value="${escapeAttr(item.target || "")}" list="flowLabelNames"></td>
      <td><button class="btn primary" data-flow-save="${item.line}">保存</button></td>
    </tr>`;
  root.innerHTML = `
    <datalist id="flowLabelNames">${parsed.labels.map((label) => `<option value="*${escapeAttr(label.name)}"></option>`).join("")}</datalist>
    <section class="card">
      <h3>ラベル <span class="count">${parsed.labels.length}</span></h3>
      <table class="table">
        <thead><tr><th>行</th><th>現在</th><th>新しい名前</th><th>表示名</th><th></th></tr></thead>
        <tbody>${parsed.labels.map(labelRow).join("") || `<tr><td colspan="5" class="mini">なし</td></tr>`}</tbody>
      </table>
    </section>
    <section class="card">
      <h3>ジャンプ / コール <span class="count">${flowItems.length}</span></h3>
      <table class="table">
        <thead><tr><th>行</th><th>種類</th><th>storage</th><th>target</th><th></th></tr></thead>
        <tbody>${flowItems.map(flowRow).join("") || `<tr><td colspan="5" class="mini">なし</td></tr>`}</tbody>
      </table>
    </section>
    <section class="card">
      <h3>選択肢 <span class="count">${parsed.choices.length}</span></h3>
      <table class="table">
        <thead><tr><th>行</th><th>種類</th><th>表示</th><th>storage</th><th>target</th><th></th></tr></thead>
        <tbody>${parsed.choices.map(choiceRow).join("") || `<tr><td colspan="6" class="mini">なし</td></tr>`}</tbody>
      </table>
    </section>
  `;
  $$("#flowView [data-flow-focus]").forEach((node) => {
    node.addEventListener("click", () => {
      activateView("editor");
      selectTimelineLine(Number(node.dataset.flowFocus), { scroll: true });
    });
  });
  $$("#flowView [data-flow-save]").forEach((node) => {
    node.addEventListener("click", () => saveFlowRow(node).catch(showError));
  });
  $$("#flowView [data-label-save]").forEach((node) => {
    node.addEventListener("click", () => saveLabelRow(node).catch(showError));
  });
}

async function saveLabelRow(button) {
  const row = button.closest("[data-label-line]");
  const line = Number(row.dataset.labelLine);
  const oldName = row.dataset.labelName || "";
  const newName = row.querySelector('[data-label-field="newName"]').value.trim().replace(/^\*/, "");
  const caption = row.querySelector('[data-label-field="caption"]').value;
  if (!newName) {
    toast("ラベル名が空です", "warn");
    return;
  }
  await flushPendingEdits();
  const file = state.currentFile;
  const navigationIntentAtStart = state.scenarioNavigationIntentId;
  const result = await api("/api/label/rename", {
    method: "POST",
    scenarioFile: file,
    body: JSON.stringify({ file, line, oldName, newName, caption, baseHash: currentHash() }),
  });
  await refreshScenarioMeta();
  if (navigationIntentAtStart === state.scenarioNavigationIntentId && state.currentFile === file) {
    state.selectedLine = line;
    await loadScenario(file, {
      line,
      quiet: true,
      remember: false,
      backgroundFreshness: true,
    });
    if (state.autoPreview && state.previewStarted) {
      applyLivePreviewUpdate({ kind: "label", line, changedText: "" }, file).catch(showError);
    }
    renderFlow();
  }
  const count = result.changedFiles ? result.changedFiles.length : 0;
  toast(`ラベルと参照を保存しました (${count}ファイル)`, "success");
}

async function saveFlowRow(button) {
  await flushPendingEdits();
  const row = button.closest("[data-flow-line]");
  const line = Number(row.dataset.flowLine);
  const attrs = {};
  row.querySelectorAll("[data-flow-field]").forEach((field) => {
    attrs[field.dataset.flowField] = field.value;
  });
  const result = await api("/api/scenario/update-tag", {
    method: "POST",
    scenarioFile: state.currentFile,
    body: JSON.stringify({ file: state.currentFile, line, attrs, baseHash: currentHash() }),
  });
  state.selectedLine = line;
  await afterWrite(result, "分岐を保存しました", { kind: "flow", line, changedText: result.replacement || "" });
  renderFlow();
}

registerView("flow", renderFlow);

/* ---------- diagnostics view ---------- */

async function renderDiagnostics() {
  const root = $("#diagnosticsView");
  root.innerHTML = `<div class="view-loading">診断中…</div>`;
  state.diagnostics = await api("/api/diagnostics");
  const summary = state.diagnostics.summary;
  $("#statusDiag").textContent = `診断: E${summary.errors} / W${summary.warnings}`;
  const list = state.diagnostics.diagnostics.slice(0, 400);
  const isScenarioFile = (file) => state.scenarios.some((item) => item.storage === file);
  root.innerHTML = `
    <section class="card">
      <h3>プロジェクト診断
        <span class="diag-badges">
          <span class="badge error">エラー ${summary.errors}</span>
          <span class="badge warn">警告 ${summary.warnings}</span>
        </span>
      </h3>
      <table class="table">
        <thead><tr><th>種別</th><th>ファイル</th><th>行</th><th>内容</th></tr></thead>
        <tbody>
          ${list.map((item, index) => `
            <tr${isScenarioFile(item.file) ? ` class="diag-row" data-diag-index="${index}"` : ""}>
              <td class="diag-${item.severity}">${escapeHtml(item.severity)}</td>
              <td>${escapeHtml(item.file || "")}</td>
              <td>${Number.isFinite(item.line) ? item.line + 1 : ""}</td>
              <td>${escapeHtml(item.message)}</td>
            </tr>`).join("") || `<tr><td colspan="4" class="mini">問題は見つかりませんでした 🎉</td></tr>`}
        </tbody>
      </table>
      ${state.diagnostics.diagnostics.length > list.length ? `<div class="mini">先頭 ${list.length} 件のみ表示</div>` : ""}
    </section>
  `;
  $$("#diagnosticsView .diag-row").forEach((row) => {
    row.addEventListener("click", async () => {
      const item = list[Number(row.dataset.diagIndex)];
      if (!item) return;
      if (item.file !== state.currentFile) {
        await loadScenario(item.file, { line: Number(item.line) || 0 });
      } else {
        selectTimelineLine(Number(item.line) || 0);
      }
      activateView("editor");
      scrollSelectedLineIntoView();
    });
  });
}

registerView("diagnostics", renderDiagnostics);

/* ---------- code (raw KS) view ---------- */

let rawFindMatches = [];
let rawFindIndex = -1;

function rawFindIsOpen() {
  return !$("#rawFind")?.classList.contains("hidden");
}

function renderRawFindState() {
  const stateLabel = $("#rawFindState");
  const hasQuery = Boolean($("#rawFindInput")?.value);
  const hasMatches = rawFindMatches.length > 0;
  if (stateLabel) {
    stateLabel.textContent = hasMatches ? `${rawFindIndex + 1} / ${rawFindMatches.length}件` : "0件";
    stateLabel.classList.toggle("is-empty", hasQuery && !hasMatches);
  }
  $("#rawFindPrev").disabled = !hasMatches;
  $("#rawFindNext").disabled = !hasMatches;
}

function selectRawFindMatch(index, { focusEditor = false } = {}) {
  const editor = $("#rawEditor");
  const query = $("#rawFindInput")?.value || "";
  if (!editor || !query || !rawFindMatches.length) return;
  rawFindIndex = (index + rawFindMatches.length) % rawFindMatches.length;
  const start = rawFindMatches[rawFindIndex];
  if (focusEditor) editor.focus({ preventScroll: true });
  if (editor._ksCodeMirror) {
    editor._ksCodeMirror.setSelection(start, start + query.length, { scroll: true, y: "center" });
  } else {
    const line = rawLineOfIndex(editor.value, start);
    editor.setSelectionRange(start, start + query.length);
    editor.scrollTop = Math.max(0, line * KS_RAW_LINE_HEIGHT - editor.clientHeight * 0.45);
  }
  renderRawWindow();
  updateRawLineState();
  renderRawHighlightWindow();
  renderRawFindState();
}

function updateRawFindMatches() {
  const editor = $("#rawEditor");
  const query = $("#rawFindInput")?.value || "";
  rawFindMatches = [];
  rawFindIndex = -1;
  if (!editor || !query) {
    renderRawFindState();
    return;
  }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(escaped, "giu");
  for (const match of editor.value.matchAll(matcher)) rawFindMatches.push(match.index);
  if (!rawFindMatches.length) {
    renderRawFindState();
    return;
  }
  const caret = editor.selectionStart;
  const next = rawFindMatches.findIndex((match) => match >= caret);
  selectRawFindMatch(next < 0 ? 0 : next);
}

function moveRawFindMatch(delta) {
  if (!rawFindMatches.length) return;
  selectRawFindMatch(rawFindIndex + delta);
}

function openRawFind() {
  if (state.view !== "code") return;
  const panel = $("#rawFind");
  const input = $("#rawFindInput");
  const editor = $("#rawEditor");
  if (!panel || !input || !editor) return;
  const wasOpen = rawFindIsOpen();
  if (!wasOpen) {
    const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
    if (selected && !selected.includes("\n") && selected.length <= 200) input.value = selected;
    panel.classList.remove("hidden");
    updateRawFindMatches();
  }
  input.focus();
  input.select();
}

function closeRawFind({ focusEditor = true } = {}) {
  $("#rawFind")?.classList.add("hidden");
  if (focusEditor) $("#rawEditor")?.focus({ preventScroll: true });
}

function beginRawEditorComposition(editor) {
  if (!rawEditorComposing) {
    rawCompositionDirty = false;
    rawCompositionCommitPending = false;
    if (rawCompositionFlushRaf) {
      cancelAnimationFrame(rawCompositionFlushRaf);
      rawCompositionFlushRaf = 0;
    }
    clearTimeout(state.rawSaveTimer);
    state.rawSaveTimer = null;
    closeRawCompletion();
  }
  rawEditorComposing = true;
  setSaveState("変換中…", "dirty");
}

function resetRawEditorComposition() {
  if (rawCompositionFlushRaf) cancelAnimationFrame(rawCompositionFlushRaf);
  rawCompositionFlushRaf = 0;
  rawEditorComposing = false;
  rawCompositionDirty = false;
  rawCompositionCommitPending = false;
}

function runRawEditorInputPipeline(editor) {
  updateRawLineState();
  // 構文色と可視DOMはCodeMirrorがtransaction単位で更新する。ここでは
  // 診断Workerと保存だけをdebounceし、入力フレームへ全文処理を持ち込まない。
  scheduleRawReparse();
  scheduleRawAutoSave();
  updateRawCompletion();
}

function flushRawEditorComposition(editor) {
  if (rawCompositionFlushRaf) {
    cancelAnimationFrame(rawCompositionFlushRaf);
    rawCompositionFlushRaf = 0;
  }
  rawCompositionCommitPending = false;
  rawCompositionDirty = false;
  runRawEditorInputPipeline(editor);
}

function finishRawEditorComposition(editor, { immediate = false } = {}) {
  if (!rawEditorComposing && !rawCompositionDirty && !rawCompositionCommitPending) return;
  rawEditorComposing = false;
  rawCompositionCommitPending = true;
  if (rawCompositionFlushRaf) cancelAnimationFrame(rawCompositionFlushRaf);
  if (immediate) {
    flushRawEditorComposition(editor);
    return;
  }
  // CodeMirrorがcompositionend後の最終transactionを適用する次フレームで、
  // 診断・保存を一度だけ再開する。
  rawCompositionFlushRaf = requestAnimationFrame(() => {
    rawCompositionFlushRaf = 0;
    if (rawCompositionCommitPending) flushRawEditorComposition(editor);
  });
}

function handleRawCodeMirrorChange(editor, controller) {
  if (controller.composing || rawEditorComposing) {
    beginRawEditorComposition(editor);
    rawCompositionDirty = true;
    return;
  }
  if (rawCompositionDirty || rawCompositionCommitPending) {
    flushRawEditorComposition(editor);
    return;
  }
  runRawEditorInputPipeline(editor);
}

function bindCodeView() {
  const editor = $("#rawEditor");
  if (!window.KsCodeEditor) throw new Error("CodeMirrorの読み込みに失敗しました");
  const controller = window.KsCodeEditor.create(editor, {
    doc: "",
    onOpenFind: () => openRawFind(),
    onChange: (_update, cm) => handleRawCodeMirrorChange(editor, cm),
    onSelection: () => updateRawLineState(),
    onViewport: () => renderRawWindow(),
    onScroll: () => renderRawWindow(),
    onFocusChange: (focused) => {
      if (focused) return;
      if (rawEditorComposing || rawCompositionCommitPending || rawCompositionDirty) {
        finishRawEditorComposition(editor, { immediate: true });
      }
      closeRawCompletion();
    },
  });
  editor.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229 || event.key === "Process") {
      beginRawEditorComposition(editor);
    }
  });
  editor.addEventListener("beforeinput", (event) => {
    if (
      event.isComposing ||
      event.inputType === "insertCompositionText" ||
      event.inputType === "deleteCompositionText"
    ) {
      beginRawEditorComposition(editor);
    }
  });
  editor.addEventListener("compositionstart", () => beginRawEditorComposition(editor));
  editor.addEventListener("compositionend", () => finishRawEditorComposition(editor));
  editor.addEventListener("click", () => {
    updateRawLineState();
    closeRawCompletion();
  });
  editor.addEventListener("keydown", handleRawEditorKeydown);
  window.addEventListener("blur", () => {
    if (rawEditorHasFocus(editor) && (rawEditorComposing || rawCompositionCommitPending || rawCompositionDirty)) {
      finishRawEditorComposition(editor, { immediate: true });
    }
  });
  editor.addEventListener("mousemove", handleRawHoverMove);
  editor.addEventListener("mouseleave", hideRawHoverCard);
  $("#rawJumpTimelineBtn").addEventListener("click", () => jumpRawSelectionToTimeline().catch(showError));
  $("#rawFindInput").addEventListener("input", () => updateRawFindMatches());
  $("#rawFindInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      moveRawFindMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeRawFind();
    }
  });
  $("#rawFindPrev").addEventListener("click", () => moveRawFindMatch(-1));
  $("#rawFindNext").addEventListener("click", () => moveRawFindMatch(1));
  $("#rawFindClose").addEventListener("click", () => closeRawFind());
  $("#rawDiagBar").addEventListener("click", (event) => {
    const item = event.target.closest("[data-diag-line]");
    if (item) jumpRawToLine(Number(item.dataset.diagLine));
  });
  // ビューポートの高さが変わると可視範囲が変わるため、仮想化の窓を描き直す
  window.addEventListener("resize", () => {
    if (document.body.dataset.view === "code") {
      controller.requestMeasure();
      scheduleRawWindow();
    }
  });
}

registerView("code", () => {
  const editor = $("#rawEditor");
  resetRawEditorComposition();
  const controller = editor?._ksCodeMirror;
  const scenarioHash = currentHash();
  const needsScenarioSync = controller
    ? controller.syncedFile !== state.currentFile ||
      (!controller.dirty && controller.syncedHash !== scenarioHash)
    : editor?.value !== state.scenario?.text;
  if (editor && state.scenario && !rawEditorHasFocus(editor) && needsScenarioSync) {
    // 非表示中に更新されたシナリオは、コードビューへ入る時だけCodeMirrorの
    // document transactionで同期する。同一テキストならundo履歴を維持する。
    editor.value = state.scenario.text;
    controller?.markSynced(state.currentFile, scenarioHash);
  }
  $("#rawFileName").textContent = state.currentFile;
  const needsFullHighlight = controller
    ? rawHighlightCacheFile !== state.currentFile || rawHighlightedRevision !== controller.revision
    : !editor || editor.value !== rawHighlightedText;
  if (needsFullHighlight) renderRawHighlight();
  editor?._ksCodeMirror?.requestMeasure();
  renderRawWindow();
  updateRawLineState();
});

/* ---------- history modal ---------- */

function openHistory() {
  $("#historyModal").classList.remove("hidden");
  loadHistory().catch(showError);
}

function closeHistory() {
  $("#historyModal").classList.add("hidden");
}

async function loadHistory() {
  if (!state.currentFile) return;
  $("#historySubtitle").textContent = state.currentFile;
  $("#historyList").innerHTML = `<div class="mini">履歴を読み込み中…</div>`;
  const data = await api(`/api/backups?file=${encodeURIComponent(state.currentFile)}`);
  state.historyBackups = data.backups || [];
  const root = $("#historyList");
  if (!state.historyBackups.length) {
    root.innerHTML = `<div class="mini">このファイルの保存履歴はまだありません</div>`;
    return;
  }
  root.innerHTML = state.historyBackups.map((item, index) => `
    <div class="history-item">
      <div>
        <div class="history-name">${escapeHtml(item.stamp)}</div>
        <div class="history-meta">${escapeHtml(formatBytes(item.size))} / ${escapeHtml(item.id)}</div>
      </div>
      <button class="btn" data-restore-backup="${index}">復元</button>
    </div>
  `).join("");
  $$("#historyList [data-restore-backup]").forEach((button) => {
    button.addEventListener("click", () => restoreHistoryItem(Number(button.dataset.restoreBackup)).catch(showError));
  });
}

async function restoreHistoryItem(index) {
  const item = state.historyBackups[index];
  if (!item) return;
  await flushPendingEdits();
  const file = state.currentFile;
  if (!window.confirm(`${file} をこの履歴に戻します。現在の内容も履歴に残してから復元します。`)) return;
  state.inlineEditLine = -1;
  state.blockEdit = null;
  const result = await api("/api/backup/restore", {
    method: "POST",
    scenarioFile: file,
    body: JSON.stringify({ file, backupId: item.id, baseHash: currentHash() }),
  });
  await afterWrite(result, "履歴から復元しました", {
    kind: "restore",
    line: state.selectedLine,
    changedText: "",
  }, { file, line: state.selectedLine, keepCurrentSelection: true });
  if (state.currentFile === file) await loadHistory();
}

function bindHistory() {
  $("#historyBtn").addEventListener("click", openHistory);
  $("#historyClose").addEventListener("click", closeHistory);
  $("#historyModal").addEventListener("mousedown", (event) => {
    if (event.target.id === "historyModal") closeHistory();
  });
}
