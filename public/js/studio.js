"use strict";

/* ============================================================
   Home (projects) / Settings / Build / boot
   ============================================================ */

/* ---------- home view ---------- */

async function renderHome() {
  const root = $("#homeView");
  const data = await api("/api/projects");
  state.projects = data.projects;
  state.projectsRoots = data.roots;
  const groups = new Map();
  state.projects.forEach((project) => {
    const key = project.folder || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(project);
  });
  const sections = [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "ja"))
    .map(([folder, projects]) => `
      <div class="home-group">
        ${folder ? `<div class="home-group-title"><span class="folder-glyph">▣</span>${escapeHtml(folder)}</div>` : ""}
        <div class="home-grid">
          ${projects.map((project) => {
            const active = state.project && project.path === state.project.projectRoot;
            return `
              <button class="project-card${active ? " active" : ""}" data-project-path="${escapeAttr(project.path)}">
                <div class="project-card-name">${escapeHtml(project.name)}</div>
                <div class="project-card-title">${escapeHtml(project.title || "")}</div>
                <div class="project-card-meta">${active ? "編集中" : ""}</div>
              </button>`;
          }).join("")}
        </div>
      </div>`)
    .join("");
  root.innerHTML = `
    <div class="home-hero">
      <div>
        <h2>プロジェクト</h2>
        <div class="mini">${escapeHtml(state.projectsRoots.join(" / "))} を検索（サブフォルダ対応）</div>
      </div>
      <button id="newProjectBtn" class="btn primary">＋ 新規プロジェクト</button>
    </div>
    ${sections || `<div class="qo-empty">プロジェクトが見つかりません</div>`}
  `;
  $$("#homeView .project-card").forEach((card) => {
    card.addEventListener("click", () => {
      const projectPath = card.dataset.projectPath;
      if (state.project && projectPath === state.project.projectRoot) {
        activateView("editor");
        return;
      }
      openProject(projectPath).catch(showError);
    });
  });
  $("#newProjectBtn").addEventListener("click", openNewProjectModal);
}

registerView("home", renderHome);

/* ---------- new project modal ---------- */

function openNewProjectModal() {
  const modal = $("#newProjectModal");
  modal.classList.remove("hidden");
  const folders = [...new Set(state.projects.map((project) => project.folder).filter(Boolean))];
  $("#npFolderList").innerHTML = folders.map((folder) => `<option value="${escapeAttr(folder)}"></option>`).join("");
  $("#npName").value = "";
  $("#npTitle").value = "";
  $("#npFolder").value = "";
  setTimeout(() => $("#npName").focus(), 0);
}

function closeNewProjectModal() {
  $("#newProjectModal").classList.add("hidden");
}

async function submitNewProject() {
  const name = $("#npName").value.trim();
  const title = $("#npTitle").value.trim();
  const folder = $("#npFolder").value.trim();
  if (!name) {
    toast("プロジェクト名を入力してください", "warn");
    return;
  }
  await flushPendingEdits();
  setStatus("プロジェクトを作成中…");
  const result = await api("/api/project/create", {
    method: "POST",
    body: JSON.stringify({ name, title, folder }),
  });
  resetScenarioCoordinationForProject();
  closeNewProjectModal();
  state.currentFile = "";
  state.scenario = null;
  state.previewStarted = false;
  const frame = $("#previewFrame");
  if (frame) frame.removeAttribute("src");
  await loadAll({ resetFile: true });
  activateView("editor");
  toast(`プロジェクト「${name}」を作成しました`, "success");
}

function bindNewProjectModal() {
  $("#npCancel").addEventListener("click", closeNewProjectModal);
  $("#npCreate").addEventListener("click", () => submitNewProject().catch(showError));
  $("#newProjectModal").addEventListener("mousedown", (event) => {
    if (event.target.id === "newProjectModal") closeNewProjectModal();
  });
}

/* ---------- new scenario ---------- */

function openNewScenarioModal() {
  $("#newScenarioModal").classList.remove("hidden");
  $("#nsName").value = "";
  setTimeout(() => $("#nsName").focus(), 0);
}

function closeNewScenarioModal() {
  $("#newScenarioModal").classList.add("hidden");
}

function bindNewScenarioModal() {
  $("#nsCancel").addEventListener("click", closeNewScenarioModal);
  $("#nsCreate").addEventListener("click", () => createNewScenario().catch(showError));
  $("#nsName").addEventListener("keydown", (event) => {
    if (event.key === "Enter") createNewScenario().catch(showError);
    if (event.key === "Escape") closeNewScenarioModal();
  });
  $("#newScenarioModal").addEventListener("mousedown", (event) => {
    if (event.target.id === "newScenarioModal") closeNewScenarioModal();
  });
}

async function createNewScenario() {
  let name = ($("#nsName").value || "").trim();
  if (!name) {
    toast("ファイル名を入力してください", "warn");
    return;
  }
  if (!name.endsWith(".ks")) name += ".ks";
  closeNewScenarioModal();
  if (state.scenarios.some((item) => item.storage === name)) {
    toast("同名のシナリオが既に存在します", "warn");
    return;
  }
  await flushPendingEdits();
  const template = `; ${name}\n\n*start\n\n[tb_start_text mode=1 ]\n#\nテキストを入力[p]\n[_tb_end_text]\n\n[s]\n`;
  await api("/api/scenario/save", {
    method: "POST",
    scenarioFile: name,
    body: JSON.stringify({ file: name, text: template, baseHash: "" }),
  });
  await refreshScenarioMeta();
  await loadScenario(name, { line: 0 });
  activateView("editor");
  toast(`${name} を作成しました`, "success");
}

/* ---------- settings view ---------- */

const SETTING_GROUPS = [
  {
    title: "基本",
    fields: [
      { key: "System.title", label: "ゲームタイトル", type: "text" },
      { key: "game_version", label: "バージョン", type: "text" },
      { key: "projectID", label: "プロジェクトID", type: "text" },
    ],
  },
  {
    title: "画面",
    fields: [
      { key: "scWidth", label: "画面の幅 (px)", type: "num" },
      { key: "scHeight", label: "画面の高さ (px)", type: "num" },
      { key: "ScreenRatio", label: "拡大方式", type: "select", options: ["fix", "variable"] },
      { key: "ScreenCentering", label: "画面の中央寄せ", type: "bool" },
    ],
  },
  {
    title: "テキスト",
    fields: [
      { key: "chSpeed", label: "文字速度 (ms/文字)", type: "num" },
      { key: "defaultFontSize", label: "フォントサイズ", type: "num" },
      { key: "defaultLineSpacing", label: "行間", type: "num" },
      { key: "userFace", label: "フォント名", type: "text" },
      { key: "defaultChColor", label: "文字色", type: "color" },
      { key: "alreadyReadTextColor", label: "既読テキスト色", type: "color" },
      { key: "unReadTextSkip", label: "未読スキップを許可", type: "bool" },
    ],
  },
  {
    title: "オート・スキップ",
    fields: [
      { key: "autoSpeed", label: "オート送り速度 (ms)", type: "num" },
      { key: "autoClickStop", label: "クリックでオート解除", type: "bool" },
      { key: "skipSpeed", label: "スキップ速度", type: "num" },
      { key: "skipEffectIgnore", label: "スキップ時に演出を省略", type: "bool" },
    ],
  },
  {
    title: "サウンド",
    fields: [
      { key: "defaultBgmVolume", label: "BGM 音量 (%)", type: "num" },
      { key: "defaultSeVolume", label: "SE 音量 (%)", type: "num" },
      { key: "defaultMovieVolume", label: "ムービー音量 (%)", type: "num" },
      { key: "mediaFormatDefault", label: "音声フォーマット", type: "select", options: ["ogg", "m4a", "mp3"] },
    ],
  },
  {
    title: "セーブ・バックログ",
    fields: [
      { key: "configSaveSlotNum", label: "セーブスロット数", type: "num" },
      { key: "configThumbnail", label: "セーブサムネイル", type: "bool" },
      { key: "configSaveOverwrite", label: "上書き時に確認しない", type: "bool" },
      { key: "maxBackLogNum", label: "バックログ最大行数", type: "num" },
      { key: "autoRecordLabel", label: "ラベル自動記録", type: "bool" },
    ],
  },
];

function settingFieldHtml(field, value) {
  const key = escapeAttr(field.key);
  const current = value != null ? String(value) : "";
  if (field.type === "select") {
    return `<select data-setting="${key}">${field.options
      .map((option) => `<option value="${escapeAttr(option)}"${option === current ? " selected" : ""}>${escapeHtml(option)}</option>`)
      .join("")}</select>`;
  }
  if (field.type === "bool") {
    return `<select data-setting="${key}">${["true", "false"]
      .map((option) => `<option value="${option}"${option === current ? " selected" : ""}>${option === "true" ? "有効" : "無効"}</option>`)
      .join("")}</select>`;
  }
  if (field.type === "color") {
    const hex = /^0x[0-9a-fA-F]{6}$/.test(current) ? `#${current.slice(2)}` : "#ffffff";
    return `
      <div class="color-field">
        <input type="color" value="${hex}" data-setting-color="${key}">
        <input data-setting="${key}" value="${escapeAttr(current)}">
      </div>`;
  }
  return `<input data-setting="${key}" value="${escapeAttr(current)}"${field.type === "num" ? ` inputmode="numeric"` : ""}>`;
}

async function renderSettings() {
  const root = $("#settingsView");
  root.innerHTML = `<div class="view-loading">設定を読み込み中…</div>`;
  const data = await api("/api/settings");
  state.settings = data;
  const entries = data.configTjs.entries || {};
  const groups = SETTING_GROUPS.map((group) => `
    <section class="card settings-card">
      <h3>${escapeHtml(group.title)}</h3>
      <div class="settings-grid">
        ${group.fields.map((field) => `
          <div class="field">
            <label>${escapeHtml(field.label)}<span class="field-def mono">${escapeHtml(field.key)}</span></label>
            ${settingFieldHtml(field, entries[field.key]?.value)}
          </div>`).join("")}
      </div>
    </section>`).join("");
  const builderNames = Object.keys(data.builderConfigs || {});
  const tyranoTatie = data.tyranoTatie || {};
  const tatieReady = Boolean(tyranoTatie.installed && tyranoTatie.enabled);
  const tatieStatus = tatieReady
    ? "導入済み・有効"
    : tyranoTatie.installed
      ? "プラグインの読み込み設定が必要"
      : "未導入";
  root.innerHTML = `
    <div class="settings-head">
      <div>
        <h2>プロジェクト設定</h2>
        <div class="mini">data/system/Config.tjs へ保存されます（保存前に自動バックアップ）</div>
      </div>
      <button id="saveSettingsBtn" class="btn primary">設定を保存</button>
    </div>
    ${data.configTjs.error ? `<div class="card"><div class="diag-error">Config.tjs を読み込めません: ${escapeHtml(data.configTjs.error)}</div></div>` : groups}
    <section class="card">
      <h3>Tyrano Tatie</h3>
      <div class="mini">立ち絵カタログと <span class="mono">[tatie]</span> タグをプロジェクトへ導入します。</div>
      <div class="button-row">
        <span class="mini ${tatieReady ? "raw-diag-ok" : "diag-warning"}">${escapeHtml(tatieStatus)}</span>
        ${tatieReady ? "" : `<button id="installTyranoTatieBtn" class="btn">プロジェクトへ導入</button>`}
      </div>
    </section>
    <section class="card">
      <h3>Config.tjs（生テキスト）</h3>
      <textarea id="configTjsEditor" class="code-editor" spellcheck="false" rows="14">${escapeHtml(data.configTjs.text || "")}</textarea>
      <div class="button-row"><button id="saveConfigTjsRawBtn" class="btn">生テキストで保存</button></div>
    </section>
    <section class="card">
      <h3>Builder 設定ファイル</h3>
      <div class="builder-config-row">
        <select id="builderConfigSelect">${builderNames.map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join("")}</select>
        <button id="builderConfigFormat" class="btn ghost">整形</button>
        <button id="saveBuilderConfigBtn" class="btn">保存</button>
      </div>
      <textarea id="builderConfigEditor" class="code-editor" spellcheck="false" rows="14"></textarea>
    </section>
  `;
  root.querySelectorAll("[data-setting-color]").forEach((picker) => {
    picker.addEventListener("input", () => {
      const target = root.querySelector(`[data-setting="${picker.dataset.settingColor}"]`);
      if (target) target.value = `0x${picker.value.slice(1)}`;
    });
  });
  $("#saveSettingsBtn").addEventListener("click", () => saveSettingsForm().catch(showError));
  $("#saveConfigTjsRawBtn").addEventListener("click", () => saveConfigTjsRaw().catch(showError));
  $("#installTyranoTatieBtn")?.addEventListener("click", () => installTyranoTatieForProject().catch(showError));
  const loadBuilderConfig = () => {
    const name = $("#builderConfigSelect").value;
    const entry = data.builderConfigs[name];
    $("#builderConfigEditor").value = entry?.ok ? JSON.stringify(entry.data, null, 2) : entry?.error || "";
  };
  $("#builderConfigSelect").addEventListener("change", loadBuilderConfig);
  $("#builderConfigFormat").addEventListener("click", () => {
    try {
      $("#builderConfigEditor").value = JSON.stringify(JSON.parse($("#builderConfigEditor").value), null, 2);
    } catch (error) {
      showError(error);
    }
  });
  $("#saveBuilderConfigBtn").addEventListener("click", () => saveBuilderConfigRaw().catch(showError));
  if (builderNames.length) loadBuilderConfig();
}

async function installTyranoTatieForProject() {
  const result = await api("/api/tyrano-tatie/install", {
    method: "POST",
    body: "{}",
  });
  await loadAll();
  await renderSettings();
  const created = result.createdFiles?.length || 0;
  toast(`Tyrano Tatie を導入しました${created ? ` (${created}ファイル)` : ""}`, "success");
}

async function saveSettingsForm() {
  const entries = state.settings?.configTjs?.entries || {};
  const updates = {};
  $$("#settingsView [data-setting]").forEach((field) => {
    const key = field.dataset.setting;
    const value = field.value;
    const current = entries[key]?.value;
    if (current == null || String(current) !== value) updates[key] = value;
  });
  if (!Object.keys(updates).length) {
    toast("変更はありません", "info");
    return;
  }
  const result = await api("/api/settings/save", {
    method: "POST",
    body: JSON.stringify({ updates }),
  });
  state.settings.configTjs.entries = result.entries;
  state.settings.configTjs.text = result.text;
  const editor = $("#configTjsEditor");
  if (editor) editor.value = result.text;
  toast(`設定を保存しました（${Object.keys(updates).length}項目)`, "success");
}

async function saveConfigTjsRaw() {
  const editor = $("#configTjsEditor");
  if (!editor) return;
  const result = await api("/api/settings/save", {
    method: "POST",
    body: JSON.stringify({ text: editor.value }),
  });
  state.settings.configTjs.entries = result.entries;
  state.settings.configTjs.text = result.text;
  toast("Config.tjs を保存しました", "success");
  renderSettings().catch(showError);
}

async function saveBuilderConfigRaw() {
  const select = $("#builderConfigSelect");
  const editor = $("#builderConfigEditor");
  if (!select || !editor) return;
  const name = select.value;
  const data = JSON.parse(editor.value);
  const entry = state.settings?.builderConfigs?.[name];
  await api("/api/config/save", {
    method: "POST",
    body: JSON.stringify({ name, data, baseHash: entry?.hash || "" }),
  });
  toast(`${name} を保存しました`, "success");
}

registerView("settings", renderSettings);

/* ---------- build view ---------- */

const BUILD_TARGETS = [
  { id: "browser", label: "ブラウザゲーム", desc: "Web サーバーに置くだけで動く構成で書き出します", icon: "🌐" },
  { id: "win", label: "Windows", desc: "そのまま実行できる .exe を書き出します（初回のみ要ネットワーク）", icon: "🪟" },
  { id: "mac", label: "Mac", desc: "そのまま実行できる .app を書き出します", icon: "🍎" },
  { id: "linux", label: "Linux", desc: "そのまま実行できるアプリを書き出します（初回のみ要ネットワーク）", icon: "🐧" },
  { id: "ios", label: "iOS", desc: "Cordova / Capacitor 用の www 構成", icon: "📱" },
  { id: "android", label: "Android", desc: "Cordova / Capacitor 用の www 構成", icon: "🤖" },
];

let buildTarget = "browser";

async function refreshBuildIcon() {
  try {
    const data = await api("/api/build/icon");
    state.buildIcon = data.icon;
  } catch (error) {
    state.buildIcon = null;
  }
}

function buildIconHtml() {
  const icon = state.buildIcon;
  const preview = icon
    ? icon.ext === ".png"
      ? `<img id="buildIconPreview" alt="">`
      : `<span class="mono">${escapeHtml(icon.ext)}</span>`
    : `<span class="mini">なし</span>`;
  return `
    <div class="build-icon-row">
      <div class="build-icon-preview">${preview}</div>
      <div class="build-icon-meta">
        <div class="mini">アプリアイコン（PNG 推奨・1024×1024。Mac は .icns、Windows は .ico に自動変換）</div>
        <div class="button-row">
          <label class="btn ghost">アイコンを選ぶ<input type="file" id="buildIconFile" accept=".png,.icns,.ico" hidden></label>
          ${icon ? `<button id="buildIconClear" class="btn ghost">クリア</button>` : ""}
        </div>
      </div>
    </div>`;
}

let buildIconObjectUrl = "";
async function loadBuildIconPreview() {
  const image = $("#buildIconPreview");
  if (!image) return;
  const response = await fetch("/api/build/icon/preview", { headers: sessionHeaders() });
  if (!response.ok || !image.isConnected) return;
  const blob = await response.blob();
  if (!image.isConnected) return;
  if (buildIconObjectUrl) URL.revokeObjectURL(buildIconObjectUrl);
  buildIconObjectUrl = URL.createObjectURL(blob);
  image.src = buildIconObjectUrl;
}

function renderBuild() {
  const root = $("#buildView");
  const result = state.buildResult;
  root.innerHTML = `
    <div class="settings-head">
      <div>
        <h2>ゲームの書き出し</h2>
        <div class="mini">プレビュー用ファイルとエディタ設定を除いた配布用ファイル一式を出力します</div>
      </div>
    </div>
    <section class="card">
      <div class="build-targets">
        ${BUILD_TARGETS.map((target) => `
          <button class="build-target${target.id === buildTarget ? " active" : ""}" data-build-target="${target.id}">
            <span class="build-icon">${target.icon}</span>
            <span class="build-label">${escapeHtml(target.label)}</span>
            <span class="build-desc">${escapeHtml(target.desc)}</span>
          </button>`).join("")}
      </div>
      ${buildIconHtml()}
      <div class="build-actions">
        <div class="build-options">
          <label class="check-label"><input type="checkbox" id="buildZip" checked> ZIP も作成する</label>
          <label class="check-label" title="ゲームファイルを asar アーカイブにまとめてソースを見えにくくします（デスクトップ向けのみ）"><input type="checkbox" id="buildAsar"> ファイルを隠す (asar)</label>
        </div>
        <button id="runBuildBtn" class="btn primary large"${state.buildRunning ? " disabled" : ""}>${state.buildRunning ? "書き出し中…" : "書き出しを実行"}</button>
      </div>
    </section>
    ${result ? `
      <section class="card build-result">
        <h3>書き出し結果 — ${escapeHtml(result.title)} (${escapeHtml(result.target)})</h3>
        <ul class="build-steps">${result.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ul>
        <div class="mini mono">${escapeHtml(result.outDir)} (${escapeHtml(formatBytes(result.fileSize))})</div>
        <div class="button-row">
          <button id="revealBuildBtn" class="btn">フォルダーを開く</button>
          ${result.zipPath ? `<button id="revealZipBtn" class="btn ghost">ZIP を表示</button>` : ""}
        </div>
      </section>` : ""}
  `;
  $$("#buildView [data-build-target]").forEach((button) => {
    button.addEventListener("click", () => {
      buildTarget = button.dataset.buildTarget;
      renderBuild();
    });
  });
  loadBuildIconPreview().catch(showError);
  $("#runBuildBtn").addEventListener("click", () => runBuild().catch(showError));
  $("#buildIconFile")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const response = await fetch(`/api/build/icon?name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: sessionHeaders(),
        body: file,
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || "アップロードに失敗しました");
      state.buildIcon = data.icon;
      toast("アイコンを設定しました", "success");
      renderBuild();
    } catch (error) {
      showError(error);
    }
  });
  $("#buildIconClear")?.addEventListener("click", async () => {
    await api("/api/build/icon?clear=1", { method: "POST" });
    state.buildIcon = null;
    renderBuild();
  });
  $("#revealBuildBtn")?.addEventListener("click", () => {
    api("/api/reveal", { method: "POST", body: JSON.stringify({ path: state.buildResult.outDir }) }).catch(showError);
  });
  $("#revealZipBtn")?.addEventListener("click", () => {
    api("/api/reveal", { method: "POST", body: JSON.stringify({ path: state.buildResult.zipPath }) }).catch(showError);
  });
}

async function runBuild() {
  if (state.buildRunning) return;
  state.buildRunning = true;
  const zip = $("#buildZip").checked;
  const asar = $("#buildAsar").checked;
  renderBuild();
  setStatus(`${buildTarget} 向けに書き出し中…（ファイル数によっては数分かかります）`);
  try {
    const result = await api("/api/build", {
      method: "POST",
      body: JSON.stringify({ target: buildTarget, zip, asar }),
    });
    state.buildResult = result;
    toast("書き出しが完了しました", "success");
  } finally {
    state.buildRunning = false;
    renderBuild();
  }
  setStatus("書き出し完了");
}

registerView("build", async () => {
  await refreshBuildIcon();
  renderBuild();
});

/* ---------- boot ---------- */

function applyUiPrefs(prefs) {
  prefs = prefs || {};
  state.theme = prefs.theme === "light" ? "light" : "dark";
  state.previewOpen = prefs.previewOpen !== false;
  state.previewVolume = clampVolume(prefs.previewVolume, 1);
  state.previewMuted = Boolean(prefs.previewMuted);
  state.paletteCollapsed = prefs.paletteCollapsed || {};
  state.scenarioCollapsed = Boolean(prefs.scenarioCollapsed);
  state.scenarioFolders = prefs.scenarioFolders || {};
  state.paneSizes = prefs.paneSizes || {};
  state.lastFiles = prefs.lastFiles || {};
  applyTheme();
  applyPaneSizes();
  applyScenarioCollapsed();
  document.body.classList.toggle("preview-collapsed", !state.previewOpen);
  const chevron = $("#previewCollapseBtn");
  if (chevron) chevron.textContent = state.previewOpen ? "▾" : "▸";
  updateVolumeUI();
}

function initUiPrefs() {
  applyUiPrefs(loadUiPrefs());
}

// サーバーに保存済みの UI 設定でクライアント状態を上書きする（起動ごとにポートが変わる
// パッケージ版でも、テーマ・ペイン幅・フォルダ開閉が再起動をまたいで保持されるようにする）
function hydrateUiPrefsFromServer(prefs) {
  if (!prefs || typeof prefs !== "object") return;
  applyUiPrefs(prefs);
  // サーバー値を localStorage キャッシュへ同期（POST は発生させない）
  localStorage.setItem(UI_PREF_KEY, JSON.stringify(collectUiPrefs()));
}

function bindShell() {
  $$(".rail-nav button").forEach((button) => {
    button.addEventListener("click", () => activateView(button.dataset.view));
  });
  $("#themeBtn").addEventListener("click", toggleTheme);
  $("#saveBtn").addEventListener("click", () => {
    flushPendingEdits()
      .then(() => trackPendingEditTask(saveRaw()))
      .catch(showError);
  });
  $("#reloadBtn").addEventListener("click", () => flushPendingEdits()
    .then(() => loadAll())
    .then(() => {
      activateView(state.view);
      toast("再読込しました", "success");
    })
    .catch(showError));
  $("#newScenarioBtn").addEventListener("click", openNewScenarioModal);
}

async function boot() {
  if (!/Mac/.test(navigator.platform)) {
    document.querySelectorAll("[title]").forEach(element => {
      element.title = element.title.replace(/⌘/g, "Ctrl+");
    });
  }
  initUiPrefs();
  bindShell();
  bindGlobalKeys();
  bindQuickOpen();
  bindProjectMenu();
  bindEditorView();
  bindPreview();
  bindAssetsView();
  bindAssetPicker();
  bindCodeView();
  bindHistory();
  bindNewProjectModal();
  bindNewScenarioModal();
  bindAssetUpload();
  bindMediaBar();
  bindVideoPreview();
  initSplitters();
  await loadAll();
  activateView("editor");
  setSaveState("保存済み", "saved");
}

boot().catch((error) => {
  console.error(error);
  setStatus(`起動エラー: ${error.message}`);
  toast(`起動エラー: ${error.message}`, "error", 10000);
});
