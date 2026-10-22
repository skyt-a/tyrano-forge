"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const {
  assertProjectRoot,
  relativeUnix,
  projectPath,
  scenarioPath,
  readText,
  listScenarios,
  searchScenarios,
  parseScenarioFile,
  backupAndWriteText,
  loadBuilderConfigs,
  buildCharacterCatalog,
  scanAssets,
  collectDiagnostics,
  makeSafeCharaDefine,
  makePreviewBootstrap,
  previewStartLineFor,
  makePreviewLineScenario,
  saveTatieFrame,
  renameScenarioLabel,
  listBackups,
  restoreBackup,
} = require("./lib/project");
const {
  getTyranoTatieStatus,
  installTyranoTatie,
} = require("./lib/tyrano-tatie");
const {
  parseScenario,
  updateTagLine,
  makeComponentLine,
  applyLineEdit,
  insertLinesWithTextBlockSplit,
  deleteLine,
  moveLine,
  moveLineToWithTextBlockSplit,
  duplicateLine,
} = require("./lib/ks-parser");
const {
  parseConfigTjs,
  updateConfigTjs,
  readConfigTjs,
  createProject,
  buildExport,
} = require("./lib/studio");
const { execFile } = require("child_process");

const os = require("os");
const { createAccessControl } = require("./lib/http-security");

const APP_NAME = "TyranoForge";
const EDITOR_ROOT = __dirname;
const PUBLIC_ROOT = path.join(EDITOR_ROOT, "public");
// パッケージ版 (Electron) では userData 等の書き込み可能な場所に切り替える
const DATA_ROOT =
  process.env.TYRANOFORGE_DATA_DIR ||
  EDITOR_ROOT;
const BACKUP_ROOT = path.join(DATA_ROOT, ".backups");
const EXPORT_ROOT = path.join(DATA_ROOT, "export");
const ICONS_ROOT = path.join(DATA_ROOT, "icons");
const EDITOR_CONFIG_FILE = path.join(DATA_ROOT, "editor_config.json");

// 環境に依存しない既定のプロジェクト探索先
const DEFAULT_PROJECTS_ROOT_CANDIDATES = [
  path.join(os.homedir(), "TyranoBuilder", "myproject"),
  path.join(os.homedir(), "Documents", "TyranoBuilder", "myproject"),
  path.join(os.homedir(), "TyranoStudio", "myproject"),
];

function loadEditorConfig() {
  try {
    return JSON.parse(fs.readFileSync(EDITOR_CONFIG_FILE, "utf8")) || {};
  } catch (error) {
    return {};
  }
}

function saveEditorConfig(next) {
  const current = loadEditorConfig();
  const merged = { ...current, ...next };
  fs.writeFileSync(EDITOR_CONFIG_FILE, JSON.stringify(merged, null, 2) + "\n");
  return merged;
}

function lastFileForProject(projectRoot = config.projectRoot) {
  const stored = loadEditorConfig();
  const lastFiles = stored.lastFiles || {};
  const remembered = lastFiles[projectRoot] || {};
  return {
    file: String(remembered.file || ""),
    line: Math.max(0, Math.floor(Number(remembered.line || 0))),
  };
}

function saveLastFileForProject(projectRoot, file, line = 0) {
  const stored = loadEditorConfig();
  const lastFiles = stored.lastFiles || {};
  lastFiles[projectRoot] = {
    file: String(file || ""),
    line: Math.max(0, Math.floor(Number(line || 0))),
  };
  saveEditorConfig({ lastFiles });
  return lastFiles[projectRoot];
}

function isTyranoProject(dir) {
  try {
    return (
      fs.existsSync(path.join(dir, "index.html")) &&
      fs.existsSync(path.join(dir, "data", "scenario"))
    );
  } catch (error) {
    return false;
  }
}

const SCAN_IGNORE = new Set([
  "node_modules", ".git", ".backups", "export", "tmp", "dlc",
  "__MACOSX", ".Trash",
]);

function scanProjectsUnder(root, maxDepth = 4) {
  const results = [];
  const walk = (dir, depth, relDir) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || SCAN_IGNORE.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (isTyranoProject(full)) {
        results.push({
          path: full,
          name: entry.name,
          folder: relDir,
          title: readProjectTitle(full),
          mtimeMs: safeMtime(full),
        });
      } else {
        walk(full, depth + 1, relDir ? `${relDir}/${entry.name}` : entry.name);
      }
    }
  };
  walk(root, 0, "");
  return results;
}

function safeMtime(dir) {
  try {
    return fs.statSync(dir).mtimeMs;
  } catch (error) {
    return 0;
  }
}

function readProjectTitle(root) {
  try {
    const builderConfig = JSON.parse(
      fs.readFileSync(path.join(root, "builder_config.json"), "utf8"),
    );
    const title =
      builderConfig?.options?.projectname ||
      builderConfig?.projectname ||
      builderConfig?.title ||
      "";
    if (title) return String(title);
  } catch (error) {}
  try {
    const tjs = fs.readFileSync(
      path.join(root, "data", "system", "Config.tjs"),
      "utf8",
    );
    const entry = parseConfigTjs(tjs)["System.title"];
    if (entry && entry.value.trim()) return entry.value.trim();
  } catch (error) {}
  try {
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const match = html.match(/<title>([^<]*)<\/title>/i);
    if (match && match[1].trim()) return match[1].trim();
  } catch (error) {}
  return "";
}

function projectsRoots() {
  const stored = loadEditorConfig();
  const envRoot = process.env.TYRANOFORGE_PROJECTS_ROOT || "";
  const roots =
    Array.isArray(stored.projectsRoots) && stored.projectsRoots.length
      ? stored.projectsRoots
      : envRoot
        ? [envRoot]
        : DEFAULT_PROJECTS_ROOT_CANDIDATES;
  return roots.filter((root) => {
    try {
      return fs.statSync(root).isDirectory();
    } catch (error) {
      return false;
    }
  });
}

function listAllProjects() {
  const roots = projectsRoots();
  const seen = new Set();
  const projects = [];
  roots.forEach((root) => {
    scanProjectsUnder(root).forEach((project) => {
      if (seen.has(project.path)) return;
      seen.add(project.path);
      projects.push({ ...project, root });
    });
  });
  projects.sort((a, b) =>
    `${a.folder}/${a.name}`.localeCompare(`${b.folder}/${b.name}`, "ja"),
  );
  return { roots, projects };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const stored = loadEditorConfig();
  const result = {
    port: Number(process.env.PORT || 8000),
    projectRoot:
      process.env.TYRANOFORGE_PROJECT ||
      stored.lastProject ||
      "",
    check: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--port") result.port = Number(args[++i]);
    if (arg === "--project") result.projectRoot = args[++i];
    if (arg === "--check") result.check = true;
  }
  try {
    result.projectRoot = assertProjectRoot(result.projectRoot);
  } catch (error) {
    // 前回のプロジェクトが無効なら、スキャンして最初に見つかったものを開く
    const { projects } = listAllProjects();
    if (!projects.length) {
      const missing = new Error(
        `Tyrano プロジェクトが見つかりません。--project か TYRANOFORGE_PROJECTS_ROOT を指定してください`,
      );
      missing.code = "PROJECT_NOT_FOUND";
      throw missing;
    }
    result.projectRoot = assertProjectRoot(projects[0].path);
  }
  return result;
}

const config = parseArgs();

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value, null, 2), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
}

function sendError(res, status, error) {
  sendJson(res, status, {
    ok: false,
    error: error && error.message ? error.message : String(error),
    code: error && error.code ? error.code : "",
  });
}

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".ks": "text/plain; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
  };
  return map[ext] || "application/octet-stream";
}

function safeStatic(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  const target = path.resolve(root, decoded.replace(/^\/+/, ""));
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel))
    throw new Error("path escapes static root");
  return target;
}

function serveFile(res, file, cache = false, rangeHeader = "") {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    send(res, 404, "Not found", {
      "Content-Type": "text/plain; charset=utf-8",
    });
    return;
  }
  const size = fs.statSync(file).size;
  const baseHeaders = {
    "Content-Type": mimeFor(file),
    "Cache-Control": cache ? "public, max-age=3600" : "no-store",
    "Accept-Ranges": "bytes",
  };
  // 音声・動画のシークに必要な HTTP Range 対応
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader || ""));
  if (match && (match[1] || match[2])) {
    let start = match[1] === "" ? NaN : Number(match[1]);
    let end = match[2] === "" ? size - 1 : Number(match[2]);
    if (Number.isNaN(start)) {
      // suffix range: bytes=-N (末尾N bytes)
      start = Math.max(0, size - Number(match[2]));
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    if (start >= 0 && start <= end) {
      const buffer = Buffer.alloc(end - start + 1);
      const fd = fs.openSync(file, "r");
      try {
        fs.readSync(fd, buffer, 0, buffer.length, start);
      } finally {
        fs.closeSync(fd);
      }
      send(res, 206, buffer, {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(buffer.length),
      });
      return;
    }
    send(res, 416, "", { "Content-Range": `bytes */${size}` });
    return;
  }
  send(res, 200, fs.readFileSync(file), baseHeaders);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function readRawBody(req, maxBytes = 800 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("ファイルが大きすぎます (800MBまで)"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const ASSET_UPLOAD_KINDS = {
  bgimage: [".png", ".jpg", ".jpeg", ".webp", ".gif"],
  fgimage: [".png", ".jpg", ".jpeg", ".webp", ".gif"],
  image: [".png", ".jpg", ".jpeg", ".webp", ".gif"],
  bgm: [".ogg", ".mp3", ".m4a", ".wav"],
  sound: [".ogg", ".mp3", ".m4a", ".wav"],
  video: [".mp4", ".webm", ".ogv"],
};

function sanitizeAssetSegment(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function entryForClient(entry) {
  return {
    line: entry.line,
    kind: entry.kind,
    raw: entry.raw,
    text: entry.text,
    speaker: entry.speaker,
    label: entry.label,
    labelCaption: entry.labelCaption,
    summary: entry.summary,
    tags: entry.tags.map((tag) => ({
      name: tag.name,
      pm: tag.pm,
      attrs: tag.attrs,
      raw: tag.raw,
    })),
  };
}

function scenarioPayloadFromText(storage, text, hash, stat) {
  const parsed = parseScenario(text, storage);
  return {
    ok: true,
    storage,
    hash,
    stat: {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    },
    text,
    parsed: {
      filename: parsed.filename,
      lineCount: parsed.lineCount,
      labels: parsed.labels,
      jumps: parsed.jumps,
      calls: parsed.calls,
      choices: parsed.choices,
      events: parsed.events,
      textBlocks: parsed.textBlocks,
      diagnostics: parsed.diagnostics,
      entries: parsed.entries.map(entryForClient),
    },
  };
}

function makeScenarioPayload(storage) {
  const data = parseScenarioFile(config.projectRoot, storage);
  return scenarioPayloadFromText(data.storage, data.text, data.hash, data.stat);
}

function makeWrittenScenarioPayload(storage, text, hash) {
  const file = projectPath(config.projectRoot, `data/scenario/${storage}`);
  return scenarioPayloadFromText(storage, text, hash, fs.statSync(file));
}

function previewHtml(req, url) {
  const indexPath = projectPath(config.projectRoot, "index.html");
  const source = readText(indexPath);
  const host = req.headers.host || `127.0.0.1:${config.port}`;
  const file = url.searchParams.get("file") || "_preview.ks";
  const target = url.searchParams.get("target") || "";
  const line = url.searchParams.get("line") || "";
  const first = `http://${host}/api/preview-bootstrap.ks?file=${encodeURIComponent(file)}&target=${encodeURIComponent(target)}&line=${encodeURIComponent(line)}&t=${Date.now()}`;
  const hidden = `<input type="hidden" id="first_scenario_file" value="${first}">`;
  const bridge = `<script src="/preview-bridge.js"></script>`;
  return source
    .replace(
      "<!--  First シナリオファイル",
      `${hidden}\n        <!--  First シナリオファイル`,
    )
    .replace("</body>", `${bridge}\n    </body>`);
}

function readLayoutCharaName(element, charas = {}) {
  const names = Object.keys(charas);
  for (const name of names) {
    if (element.classList.contains(name)) return name;
  }
  const appearance = element.getAttribute("data-tatie-appearance") || "";
  const variant = element.getAttribute("data-tatie-variant") || "";
  // Tatie's public runtime state is a fallback when a character class is absent.
  // A shared appearance/variant is not enough to identify two visible characters.
  const matches = names.filter(name => {
    const chara = charas[name] || {};
    return String(chara.is_show) !== "false" && Boolean(chara.tatie_variant) &&
      (!appearance || chara.tatie_appearance === appearance) &&
      (!variant || chara.tatie_variant === variant);
  });
  return matches.length === 1 ? matches[0] : "";
}

function previewBridgeScript() {
  return `
(function () {
  var editorOrigin = "";
  var previewSession = "";
  try {
    var requestedEditorOrigin = new URLSearchParams(location.search).get("editorOrigin");
    previewSession = new URLSearchParams(location.search).get("previewSession") || "";
    var requested = requestedEditorOrigin ? new URL(requestedEditorOrigin) : null;
    var current = new URL(location.href);
    var oppositeLoopbackHosts = requested && (
      (requested.hostname === "127.0.0.1" && current.hostname === "localhost") ||
      (requested.hostname === "localhost" && current.hostname === "127.0.0.1")
    );
    if (
      requested &&
      oppositeLoopbackHosts &&
      requested.protocol === current.protocol &&
      requested.port === current.port
    ) {
      editorOrigin = requested.origin;
    }
  } catch (e) {}

  function postToEditor(message) {
    if (!editorOrigin || !previewSession) return;
    try {
      message.previewSession = previewSession;
      parent.postMessage(message, editorOrigin);
    } catch (e) {}
  }

  function isEditorMessage(event) {
    var data = event.data || {};
    return Boolean(
      editorOrigin &&
      previewSession &&
      event.source === parent &&
      event.origin === editorOrigin &&
      data.previewSession === previewSession
    );
  }

  function normalizeScenario(raw) {
    var rawValue = String(raw || "");
    try {
      var parsedUrl = new URL(rawValue, location.href);
      if (parsedUrl.pathname === "/api/preview-line.ks" && parsedUrl.searchParams.get("file")) {
        return parsedUrl.searchParams.get("file");
      }
    } catch (e) {}
    var value = rawValue.split("?")[0];
    if (!value || value.indexOf("/api/preview-bootstrap") >= 0) return "";
    var marker = "/data/scenario/";
    var markerIndex = value.indexOf(marker);
    if (markerIndex >= 0) return value.slice(markerIndex + marker.length);
    return value.replace(/^.*\\/data\\/scenario\\//, "");
  }

  function clonePm(pm) {
    var result = {};
    pm = pm || {};
    Object.keys(pm).forEach(function (key) {
      result[key] = pm[key];
    });
    return result;
  }

  function parseScenarioText(kag, text) {
    var parser = kag.parser;
    var oldFlagScript = parser.flag_script;
    var oldDeepIf = parser.deep_if;
    try {
      parser.flag_script = false;
      parser.deep_if = 0;
      return parser.parseScenario(String(text || "").replace(/\\r\\n/g, "\\n"));
    } finally {
      parser.flag_script = oldFlagScript;
      parser.deep_if = oldDeepIf;
    }
  }

  function equivalentOrderIndex(oldArray, newArray, oldIndex, currentLine) {
    var oldTag = oldArray && oldArray[oldIndex] ? oldArray[oldIndex] : null;
    if (oldTag) {
      var ordinal = 0;
      for (var i = 0; i <= oldIndex; i += 1) {
        if (oldArray[i] && oldArray[i].line === oldTag.line && oldArray[i].name === oldTag.name) ordinal += 1;
      }
      var seen = 0;
      var fallback = -1;
      for (var j = 0; j < newArray.length; j += 1) {
        if (newArray[j].line === oldTag.line && newArray[j].name === oldTag.name) {
          fallback = j;
          seen += 1;
          if (seen === ordinal) return j;
        }
      }
      if (fallback >= 0) return fallback;
    }
    var candidate = -1;
    for (var k = 0; k < newArray.length; k += 1) {
      if (Number(newArray[k].line) <= Number(currentLine || 0)) candidate = k;
      else break;
    }
    return candidate;
  }

  function patchCurrentScenario(payload) {
    var kag = TYRANO.kag;
    var f = (kag.stat && kag.stat.f) || {};
    var currentScenario = f._system_preview_ks || normalizeScenario(kag.stat.current_scenario);
    if (!currentScenario || currentScenario !== payload.file) {
      return {
        patched: false,
        immediate: false,
        reason: "different-scenario",
        currentScenario: currentScenario
      };
    }
    var currentLine = Number(kag.stat.current_line || 0) + Number(f._system_preview_line_offset || 0);
    // 実行中ランタイムのarray_tag/current_order_index/current_lineには触れない。
    // 編集内容は保存済みファイルから次のナビゲーションで反映し、ここでは
    // 現在行の視覚・音響差分だけを非破壊で即時反映する。
    return {
      patched: true,
      currentScenario: currentScenario,
      currentLine: currentLine
    };
  }

  function fragmentTags(text, baseLine) {
    var kag = TYRANO.kag;
    var parsed = parseScenarioText(kag, text || "");
    return (parsed.array_s || []).map(function (tag) {
      tag.line = Number(baseLine || 0) + Number(tag.line || 0);
      return tag;
    });
  }

  // 即時実行してよい視覚・音響系タグ。text / chara_ptext は含めない：
  // ftag 経由で text を実行すると完了経路がメイン進行 (order index /
  // is_stop) を動かして位置が壊れるため、テキストは repaintCurrentText で
  // メッセージレイヤへ直接描画する。
  function isLiveExecutable(name) {
    var allow = {
      bg: true,
      bg2: true,
      mask: true,
      mask_off: true,
      layopt: true,
      chara_show: true,
      chara_mod: true,
      chara_hide: true,
      chara_hide_all: true,
      tatie: true,
      playbgm: true,
      stopbgm: true,
      playse: true,
      stopse: true
    };
    return Boolean(allow[name]);
  }

  // 進行に一切触れずに現在のメッセージ欄のテキストだけ描き替える
  function repaintCurrentText(tags) {
    var texts = tags.filter(function (tag) { return tag.name === "text"; });
    if (!texts.length) return false;
    try {
      var kag = TYRANO.kag;
      var val = texts.map(function (tag) { return String(tag.pm.val || ""); }).join("");
      var inner = kag.getMessageInnerLayer();
      if (!inner || !inner.length) return false;
      try { kag.ftag.hideNextImg(); } catch (e) {}
      var escaped = $("<span>").text(val).html().replace(/\\n/g, "<br>");
      inner.html(escaped);
      kag.stat.current_message_str = val;
      return true;
    } catch (e) {
      return false;
    }
  }

  function runTags(tags) {
    return new Promise(function (resolve) {
      var kag = TYRANO.kag;
      var queue = tags
        .filter(function (tag) { return isLiveExecutable(tag.name); })
        .map(function (tag) {
          return { tag: tag.name, pm: clonePm(tag.pm || {}) };
        });
      if (!queue.length) {
        resolve({ executed: 0 });
        return;
      }
      // text は repaintCurrentText で直接描画済みのため、ここでは消去しない
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        resolve({ executed: queue.length, timeout: true });
      }, 3500);
      try {
        kag.ftag.startTags(queue, function () {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ executed: queue.length, timeout: false });
        });
      } catch (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ executed: 0, error: error.message || String(error) });
      }
    });
  }

  function shouldRunImmediate(change, currentLine) {
    if (!change || !change.changedText) return false;
    var line = Number(change.line || 0);
    return Math.abs(line - Number(currentLine || 0)) <= 1 || change.forceImmediate === true;
  }

  async function applyScenarioUpdate(payload) {
    if (!window.TYRANO || !TYRANO.kag) throw new Error("preview is not ready");
    var patch = patchCurrentScenario(payload);
    var result = {
      patched: patch.patched,
      immediate: false,
      executed: 0,
      reason: patch.reason || "",
      currentScenario: patch.currentScenario || "",
      currentLine: patch.currentLine
    };
    if (!patch.patched) return result;
    var change = payload.change || {};
    if (shouldRunImmediate(change, patch.currentLine)) {
      // 即時反映は「現在停止中の内容の再描画」として扱う。
      // text 系タグの実行はメイン進行 (current_order_index / is_stop) まで
      // 動かしてしまうため、実行前の進行位置を控えておき、静定後に
      // snapshot ループ側で復元する (restoreProgressIfIdle)。
      var kagRef = TYRANO.kag;
      var saved = {
        orderIndex: kagRef.ftag.current_order_index,
        currentLine: kagRef.stat.current_line,
        wasStop: Boolean(kagRef.stat.is_stop),
      };
      var tags = fragmentTags(change.changedText || "", change.line || 0);
      var repainted = repaintCurrentText(tags);
      var run = await runTags(tags);
      if (run.executed > 0) {
        progressRestore = {
          until: Date.now() + 6000,
          orderIndex: saved.orderIndex,
          currentLine: saved.currentLine,
          wasStop: saved.wasStop,
        };
      }
      result.immediate = repainted || (run.executed || 0) > 0;
      result.executed = run.executed || 0;
      result.timeout = Boolean(run.timeout);
      result.error = run.error || "";
    }
    return result;
  }

  // 即時反映後の進行位置・停止状態リカバリ (applyScenarioUpdate 参照)。
  // text タグの非同期完了がメイン進行を動かすことがあるため、
  // 「保存位置 + 停止状態」が安定するまで再適用し続ける。
  // ユーザーが実際に進めた場合（停止状態から orderIndex が進んだ場合）は
  // 追従をやめる。
  var progressRestore = null;
  function restoreProgressIfIdle() {
    if (!progressRestore) return;
    try {
      var kag = window.TYRANO && TYRANO.kag;
      if (!kag || Date.now() > progressRestore.until) {
        progressRestore = null;
        return;
      }
      // 安定: 保存位置で停止できていれば完了
      if (
        kag.ftag.current_order_index === progressRestore.orderIndex &&
        (!progressRestore.wasStop || kag.stat.is_stop)
      ) {
        progressRestore.stable = (progressRestore.stable || 0) + 1;
        if (progressRestore.stable >= 2) progressRestore = null;
        return;
      }
      progressRestore.stable = 0;
      // ユーザー操作による前進（停止確認済みの後に進んだ）は尊重して終了
      if (progressRestore.userAdvanced) {
        progressRestore = null;
        return;
      }
      // 演出・トランジション・タグ実行中は待つ
      if (kag.stat.is_wait || kag.stat.is_trans || kag.stat.is_wait_anim || kag.stat.is_strong_stop) return;
      if (kag.ftag.isExeTag) return;
      kag.ftag.current_order_index = progressRestore.orderIndex;
      kag.stat.current_line = progressRestore.currentLine;
      if (progressRestore.wasStop && !kag.stat.is_stop) kag.stat.is_stop = true;
    } catch (e) {
      progressRestore = null;
    }
  }

  // 復元待ち中の本物のクリックは「ユーザーの前進」として記録
  document.addEventListener(
    "click",
    function () {
      if (progressRestore) progressRestore.userAdvanced = true;
      // iframe 内の操作イベントは親 document へ bubble しないため、エディタ側へ
      // 明示的に通知してプレビュー追従を再開させる。
      postToEditor({ source: "tyranoforge-preview-interaction" });
    },
    true,
  );

  function previewLayoutMetrics() {
    var base = document.querySelector("#tyrano_base") || document.querySelector(".tyrano_base") || document.body;
    if (!base) return null;
    var rect = base.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    var style = window.getComputedStyle(base);
    var kag = window.TYRANO && TYRANO.kag;
    var gameWidth = parseFloat(base.style.width) || parseFloat(style.width) || Number(kag && kag.config && kag.config.scWidth) || 1280;
    var gameHeight = parseFloat(base.style.height) || parseFloat(style.height) || Number(kag && kag.config && kag.config.scHeight) || 720;
    return {
      baseLeft: rect.left,
      baseTop: rect.top,
      baseWidth: rect.width,
      baseHeight: rect.height,
      gameWidth: gameWidth,
      gameHeight: gameHeight,
      scaleX: rect.width / gameWidth || 1,
      scaleY: rect.height / gameHeight || 1
    };
  }

  ${readLayoutCharaName.toString()}

  function collectLayoutSnapshot() {
    var metrics = previewLayoutMetrics();
    if (!metrics) return { metrics: null, boxes: [] };
    var kag = window.TYRANO && TYRANO.kag;
    var charas = (kag && kag.stat && kag.stat.charas) || {};
    var nodes = Array.prototype.slice.call(
      document.querySelectorAll(".tyrano_chara[data-tatie-variant]")
    );
    var boxes = [];
    nodes.forEach(function (element, index) {
      var style = window.getComputedStyle(element);
      var rect = element.getBoundingClientRect();
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0 ||
        rect.width <= 0 ||
        rect.height <= 0
      ) return;
      var appearance = element.getAttribute("data-tatie-appearance") || "default";
      var variant = element.getAttribute("data-tatie-variant") || "normal";
      var position = element.getAttribute("data-tatie-position") || "center";
      boxes.push({
        id: [index, appearance, variant, position].join(":"),
        name: readLayoutCharaName(element, charas),
        appearance: appearance,
        variant: variant,
        position: position,
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        },
        game: {
          left: Math.round((rect.left - metrics.baseLeft) / metrics.scaleX),
          top: Math.round((rect.top - metrics.baseTop) / metrics.scaleY),
          width: Math.round(rect.width / metrics.scaleX),
          height: Math.round(rect.height / metrics.scaleY)
        }
      });
    });
    return { metrics: metrics, boxes: boxes };
  }

  function applyLayoutPosition(payload) {
    var box = (payload && payload.box) || {};
    var kag = window.TYRANO && TYRANO.kag;
    var charas = (kag && kag.stat && kag.stat.charas) || {};
    var nodes = document.querySelectorAll(".tyrano_chara[data-tatie-variant]");
    for (var i = 0; i < nodes.length; i += 1) {
      var element = nodes[i];
      if ((element.getAttribute("data-tatie-appearance") || "default") !== String(box.appearance || "default")) continue;
      if ((element.getAttribute("data-tatie-variant") || "normal") !== String(box.variant || "normal")) continue;
      if ((element.getAttribute("data-tatie-position") || "center") !== String(box.position || "center")) continue;
      var name = readLayoutCharaName(element, charas);
      if (box.name && name && name !== box.name) continue;
      element.style.left = Math.round(Number(box.left || 0)) + "px";
      element.style.top = Math.round(Number(box.top || 0)) + "px";
      return { updated: 1 };
    }
    return { updated: 0 };
  }

  function resizePreviewRuntime() {
    var kag = window.TYRANO && TYRANO.kag;
    var width = Number(kag && kag.config && kag.config.scWidth) || 1280;
    var height = Number(kag && kag.config && kag.config.scHeight) || 720;
    window.dispatchEvent(new Event("resize"));
    if (window.TYRANO && TYRANO.base && typeof TYRANO.base._fitBaseSize === "function") {
      TYRANO.base._fitBaseSize(width, height, 0);
    }
    if (kag && kag.layer && typeof kag.layer.refMessageLayer === "function") {
      kag.layer.refMessageLayer();
    }
    return { resized: true, width: width, height: height };
  }

  function updateCharaFrames(payload) {
    if (!window.TYRANO || !TYRANO.kag) throw new Error("preview is not ready");
    var settings = window.TYRANO_TATIE_SETTINGS;
    if (!settings || !settings.characters) throw new Error("tyrano-tatie settings are not loaded");
    var frames = payload.frames || [];
    var updated = 0;
    frames.forEach(function (frameUpdate) {
      var character = settings.characters[frameUpdate.name];
      var appearance = character && character.appearances && character.appearances[frameUpdate.appearance];
      var variant = appearance && appearance.variants && appearance.variants[frameUpdate.variant];
      if (!variant) return;
      variant.frame = variant.frame || {};
      variant.frame.positions = variant.frame.positions || {};
      variant.frame.positions[frameUpdate.position] = {
        left: Math.round(Number(frameUpdate.left || 0)),
        top: Math.round(Number(frameUpdate.top || 0))
      };
      if (frameUpdate.width) variant.frame.width = Math.round(Number(frameUpdate.width));
      if (frameUpdate.height) variant.frame.height = Math.round(Number(frameUpdate.height));
      if (window.TyranoTatie && window.TyranoTatie.updateCss) {
        window.TyranoTatie.updateCss(TYRANO.kag, frameUpdate.name, frameUpdate.appearance, frameUpdate.variant, frameUpdate.position);
      }
      updated += 1;
    });
    return { updated: updated };
  }

  // エディタ側から指定されたプレビュー全体のマスター音量 (0..1)。
  // Howler のグローバルゲイン (masterGain) に載せるため BGM/SE/ボイスを
  // まとめて増減でき、Tyrano の内部音量やセーブデータには一切触れない。
  // 保持しておき、Howler 読み込み前に届いた場合やエンジン再生成後も
  // snapshot ループで再適用する。
  function applyMasterVolume(payload) {
    var vol = Number(payload && payload.volume);
    if (!isFinite(vol)) vol = 1;
    vol = Math.max(0, Math.min(1, vol));
    window.__tyranoforgeMasterVolume = vol;
    return { applied: reassertMasterVolume(), volume: vol };
  }

  function reassertMasterVolume() {
    var target = window.__tyranoforgeMasterVolume;
    if (typeof target !== "number") return false;
    try {
      if (window.Howler && typeof window.Howler.volume === "function") {
        if (window.Howler.volume() !== target) window.Howler.volume(target);
        return true;
      }
    } catch (e) {}
    return false;
  }

  window.addEventListener("message", async function (event) {
    if (!isEditorMessage(event)) return;
    var data = event.data || {};
    if (data.source === "tyranoforge-preview-snapshot-request") {
      lastSnapshotKey = "";
      snapshot();
      return;
    }
    if (data.source !== "tyranoforge-live-update") return;
    try {
      var payload = data.payload || {};
      var result;
      if (payload.type === "chara-frame") result = updateCharaFrames(payload);
      else if (payload.type === "volume") result = applyMasterVolume(payload);
      else if (payload.type === "layout-snapshot") result = collectLayoutSnapshot();
      else if (payload.type === "layout-position") result = applyLayoutPosition(payload);
      else if (payload.type === "resize") result = resizePreviewRuntime();
      else result = await applyScenarioUpdate(payload);
      // 高頻度の drag/resize command は requestId を付けず、renderer 間の
      // 無用な応答を返さない。
      if (data.requestId) {
        postToEditor({
          source: "tyranoforge-live-result",
          requestId: data.requestId,
          ok: true,
          result: result
        });
      }
    } catch (error) {
      if (data.requestId) {
        postToEditor({
          source: "tyranoforge-live-result",
          requestId: data.requestId,
          ok: false,
          error: error.message || String(error)
        });
      }
    }
  });

  // 親側は iframe の load ではなく、この origin/session 検証済み handshake
  // を受けてから音量・resize 等の初期コマンドを送る。
  postToEditor({ source: "tyranoforge-preview-ready" });

  // 「ここから再生」中は kag.stat.current_scenario がプレビュー用 URL
  // (/api/preview-line.ks?file=...&start=...&t=...) になる。Config.tjs の
  // autoRecordLabel が有効だと [label] 通過時にエンジンが
  // "sf.record.trail_<シナリオ名>_<ラベル名>++" という文字列を eval するため、
  // URL 中の ? = & % が識別子に混入して SyntaxError
  // (Warning: SyntaxError: Invalid or unexpected token) になる。
  // [label] 処理の間だけ実ファイル名へ差し替えて回避する。
  function installLabelScenarioPatch() {
    var kag = window.TYRANO && TYRANO.kag;
    var master = kag && kag.ftag && kag.ftag.master_tag;
    var label = master && master.label;
    if (!label || typeof label.start !== "function") return false;
    if (label._tyranoforgePatched) return true;
    var originalStart = label.start;
    label.start = function (pm) {
      var stat = (this.kag && this.kag.stat) || {};
      var raw = String(stat.current_scenario || "");
      var real = ((stat.f || {})._system_preview_ks) || normalizeScenario(raw);
      if (raw.indexOf("/api/preview-") < 0 || !real) {
        return originalStart.call(this, pm);
      }
      stat.current_scenario = real;
      try {
        return originalStart.call(this, pm);
      } finally {
        // 同期チェーン内の jump/call がシナリオを切り替えた場合は触らない
        if (stat.current_scenario === real) stat.current_scenario = raw;
      }
    };
    label._tyranoforgePatched = true;
    return true;
  }
  var labelPatchTimer = setInterval(function () {
    if (installLabelScenarioPatch()) clearInterval(labelPatchTimer);
  }, 60);

  // Tyrano はユーザークリックまで音声再生を保留し、playbgm/playse で停止する
  // (kag.tag_audio.js: ready_audio が false だと waitClick で weaklyStop)。
  // TyranoBuilder は NW.js 判定で ready_audio を立てて回避しているため、
  // エディタのプレビューでも同等の初期化を行う。シナリオが先に waitClick へ
  // 入ってしまった場合も click.bgm ネームスペースの trigger で解除する
  // （namespace 付き trigger は該当ハンドラのみ発火するので安全）。
  var audioReadied = false;
  function ensureAudioReady() {
    if (audioReadied) return;
    try {
      if (!window.TYRANO || !TYRANO.kag || !TYRANO.kag.tmp) return;
      if (!TYRANO.kag.tmp.ready_audio) {
        if (TYRANO.kag.readyAudio) TYRANO.kag.readyAudio();
        TYRANO.kag.tmp.ready_audio = true;
      }
      var ctx = TYRANO.kag.tmp.audio_context;
      if (ctx && ctx.state === "suspended" && ctx.resume) ctx.resume().catch(function () {});
      if (window.$) $(".tyrano_base").trigger("click.bgm");
      audioReadied = true;
    } catch (e) {}
  }
  ensureAudioReady();
  var audioReadyTimer = setInterval(function () {
    if (audioReadied) {
      clearInterval(audioReadyTimer);
      return;
    }
    ensureAudioReady();
  }, 60);

  var lastSnapshotKey = "";
  function snapshot() {
    ensureAudioReady();
    reassertMasterVolume();
    restoreProgressIfIdle();
    try {
      if (!window.TYRANO || !TYRANO.kag) return;
      var stat = TYRANO.kag.stat || {};
      var f = stat.f || {};
      // preview-line実行中だけ擬似ファイルのoffsetを適用する。選択肢やjumpで
      // 別シナリオへ移った後は実際のscenario/lineをそのまま報告する。
      var inPreviewLine = String(stat.current_scenario || "").indexOf("preview-line") >= 0;
      var lineOffset = inPreviewLine ? Number(f._system_preview_line_offset || 0) : 0;
      // 即時反映の復元待ち中は、実行中タグの一時的な行番号ではなく
      // 復元先の行番号を報告する（タイムラインの飛びを防ぐ）
      var reportLine = progressRestore
        ? Number(progressRestore.currentLine || 0)
        : Number(stat.current_line || 0);
      var currentScenario = inPreviewLine ? (f._system_preview_ks || stat.current_scenario) : stat.current_scenario;
      var currentLine = Math.max(0, reportLine + lineOffset);
      var booting = Number(f._system_preview_booting || 0);
      var currentBgm = stat.current_bgm || "";
      var snapshotKey = [currentScenario || "", currentLine, booting, currentBgm].join("\\u0001");
      if (snapshotKey === lastSnapshotKey) return;
      lastSnapshotKey = snapshotKey;
      postToEditor({
        source: "tyranoforge-preview",
        currentScenario: currentScenario,
        currentLine: currentLine,
        booting: booting,
        currentBgm: currentBgm
      });
    } catch (e) {}
  }
  setInterval(snapshot, 500);
  window.addEventListener("error", function (event) {
    postToEditor({
      source: "tyranoforge-preview-error",
      message: event.message,
      filename: event.filename,
      line: event.lineno
    });
  });
})();
`;
}

async function routeApi(req, res, url, access) {
  const baseUrl = `http://${req.headers.host || `127.0.0.1:${config.port}`}`;

  if (url.pathname === "/api/projects") {
    const { roots, projects } = listAllProjects();
    sendJson(res, 200, {
      ok: true,
      roots,
      projects,
      current: config.projectRoot,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/project/open") {
    const body = await readBody(req);
    const requested = String(body.path || "");
    const { projects } = listAllProjects();
    const known = projects.some((project) => project.path === requested);
    const root = assertProjectRoot(requested);
    if (!known && !isTyranoProject(root)) {
      throw new Error("Tyranoプロジェクトではありません");
    }
    config.projectRoot = root;
    saveEditorConfig({ lastProject: root });
    sendJson(res, 200, { ok: true, projectRoot: root });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/project/create") {
    const body = await readBody(req);
    const roots = projectsRoots();
    if (!roots.length) throw new Error("プロジェクトのルートフォルダがありません");
    const created = createProject({
      projectsRoot: roots[0],
      folder: String(body.folder || "").replace(/^[/.]+|\.\./g, ""),
      name: String(body.name || "").trim(),
      title: String(body.title || "").trim(),
      skeleton: loadEditorConfig().skeleton || path.resolve(config.projectRoot, "../../system/tyrano"),
    });
    config.projectRoot = assertProjectRoot(created.path);
    saveEditorConfig({ lastProject: created.path });
    sendJson(res, 200, { ok: true, ...created });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/asset/upload") {
    const kind = url.searchParams.get("kind") || "";
    const allowedExts = ASSET_UPLOAD_KINDS[kind];
    if (!allowedExts) throw new Error(`未対応の素材種別: ${kind}`);
    const folder = sanitizeAssetSegment(url.searchParams.get("folder") || "");
    const name = sanitizeAssetSegment(url.searchParams.get("name") || "");
    if (!name || name.includes("/")) throw new Error("ファイル名が不正です");
    const ext = path.extname(name).toLowerCase();
    if (!allowedExts.includes(ext)) {
      throw new Error(`この種別で使える拡張子: ${allowedExts.join(" ")}`);
    }
    const overwrite = url.searchParams.get("overwrite") === "1";
    const buffer = await readRawBody(req);
    if (!buffer.length) throw new Error("ファイルが空です");
    const relative = ["data", kind, folder, name].filter(Boolean).join("/");
    const target = projectPath(config.projectRoot, relative);
    if (fs.existsSync(target) && !overwrite) {
      sendJson(res, 409, { ok: false, code: "EXISTS", error: `同名のファイルが既にあります: ${relative}` });
      return;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buffer);
    const storage = [folder, name].filter(Boolean).join("/");
    sendJson(res, 200, { ok: true, kind, storage, size: buffer.length });
    return;
  }

  if (url.pathname === "/api/build/icon") {
    if (req.method === "POST" && url.searchParams.get("clear") === "1") {
      const stored = loadEditorConfig();
      const icons = stored.buildIcons || {};
      delete icons[config.projectRoot];
      saveEditorConfig({ buildIcons: icons });
      sendJson(res, 200, { ok: true, icon: null });
      return;
    }
    if (req.method === "POST") {
      const original = sanitizeAssetSegment(url.searchParams.get("name") || "icon.png");
      const ext = path.extname(original).toLowerCase();
      if (![".png", ".icns", ".ico"].includes(ext)) {
        throw new Error("アイコンは .png / .icns / .ico を指定してください");
      }
      const buffer = await readRawBody(req, 40 * 1024 * 1024);
      if (!buffer.length) throw new Error("ファイルが空です");
      fs.mkdirSync(ICONS_ROOT, { recursive: true });
      const file = path.join(
        ICONS_ROOT,
        `${path.basename(config.projectRoot).replace(/[^\w.-]/g, "_")}${ext}`,
      );
      fs.writeFileSync(file, buffer);
      const stored = loadEditorConfig();
      const icons = stored.buildIcons || {};
      icons[config.projectRoot] = file;
      saveEditorConfig({ buildIcons: icons });
      sendJson(res, 200, { ok: true, icon: { path: file, ext } });
      return;
    }
    const icons = loadEditorConfig().buildIcons || {};
    const file = icons[config.projectRoot] || "";
    const exists = file && fs.existsSync(file);
    sendJson(res, 200, {
      ok: true,
      icon: exists ? { path: file, ext: path.extname(file).toLowerCase() } : null,
    });
    return;
  }

  if (url.pathname === "/api/build/icon/preview") {
    const icons = loadEditorConfig().buildIcons || {};
    const file = icons[config.projectRoot] || "";
    if (!file || !fs.existsSync(file) || path.extname(file).toLowerCase() !== ".png") {
      send(res, 404, "no preview", { "Content-Type": "text/plain" });
      return;
    }
    send(res, 200, fs.readFileSync(file), {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    });
    return;
  }

  if (url.pathname === "/api/settings") {
    let configTjs = null;
    try {
      const data = readConfigTjs(config.projectRoot);
      configTjs = { text: data.text, entries: data.entries };
    } catch (error) {
      configTjs = { text: "", entries: {}, error: error.message };
    }
    sendJson(res, 200, {
      ok: true,
      configTjs,
      builderConfigs: loadBuilderConfigs(config.projectRoot),
      tyranoTatie: getTyranoTatieStatus(config.projectRoot),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tyrano-tatie/install") {
    const result = installTyranoTatie(config.projectRoot, {
      writeText: (relativePath, text) =>
        backupAndWriteText(config.projectRoot, relativePath, text, BACKUP_ROOT),
    });
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings/save") {
    const body = await readBody(req);
    const file = "data/system/Config.tjs";
    const current = readConfigTjs(config.projectRoot);
    const nextText =
      body.text != null
        ? String(body.text)
        : updateConfigTjs(current.text, body.updates || {});
    const write = backupAndWriteText(
      config.projectRoot,
      file,
      nextText,
      BACKUP_ROOT,
      body.baseHash || "",
    );
    sendJson(res, 200, {
      ok: true,
      hash: write.hash,
      backupFile: write.backupFile,
      entries: parseConfigTjs(nextText),
      text: nextText,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/build") {
    const body = await readBody(req);
    const icons = loadEditorConfig().buildIcons || {};
    const iconFile = icons[config.projectRoot] || "";
    const result = await buildExport(config.projectRoot, EXPORT_ROOT, {
      target: body.target || "browser",
      zip: body.zip !== false,
      asar: body.asar === true,
      icon: iconFile && fs.existsSync(iconFile) ? iconFile : "",
    });
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reveal") {
    const body = await readBody(req);
    const target = path.resolve(String(body.path || ""));
    const allowedRoots = [
      EXPORT_ROOT,
      ...projectsRoots(),
      config.projectRoot,
    ];
    const allowed = allowedRoots.some((root) => {
      const rel = path.relative(root, target);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    });
    if (!allowed) throw new Error("この場所は表示できません");
    if (process.platform === "win32") execFile("explorer.exe", [`/select,${target}`], () => {});
    else if (process.platform === "darwin") execFile("open", ["-R", target], () => {});
    else execFile("xdg-open", [fs.statSync(target).isDirectory() ? target : path.dirname(target)], () => {});
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/project") {
    const previewSafety = makeSafeCharaDefine(config.projectRoot);
    sendJson(res, 200, {
      ok: true,
      projectRoot: config.projectRoot,
      editorRoot: EDITOR_ROOT,
      backupRoot: BACKUP_ROOT,
      builderConfigs: loadBuilderConfigs(config.projectRoot),
      previewSafety: {
        charaDefineSubstitutions: previewSafety.substitutions,
      },
      lastFile: lastFileForProject(),
      uiPrefs: loadEditorConfig().uiPrefs || null,
    });
    return;
  }

  // エディタUIの表示設定（テーマ／各ペイン幅／フォルダ開閉など）をディスクに保存する。
  // localStorage はオリジン単位で分離されるため（パッケージ版は起動ごとにポートが変わる）、
  // 再起動をまたいで保持するにはサーバー側へ永続化する必要がある。
  if (req.method === "POST" && url.pathname === "/api/ui-prefs") {
    const body = await readBody(req);
    const prefs = body && typeof body === "object" && !Array.isArray(body) ? body : {};
    saveEditorConfig({ uiPrefs: prefs });
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/project/last-file") {
    const body = await readBody(req);
    const file = String(body.file || "");
    if (file) scenarioPath(config.projectRoot, file);
    const remembered = saveLastFileForProject(config.projectRoot, file, body.line);
    sendJson(res, 200, { ok: true, lastFile: remembered });
    return;
  }

  if (url.pathname === "/api/scenarios") {
    sendJson(res, 200, {
      ok: true,
      scenarios: listScenarios(config.projectRoot),
    });
    return;
  }

  if (url.pathname === "/api/scenario") {
    const file = url.searchParams.get("file") || "_preview.ks";
    sendJson(res, 200, makeScenarioPayload(file));
    return;
  }

  if (url.pathname === "/api/search") {
    const query = url.searchParams.get("q") || "";
    sendJson(res, 200, { ok: true, ...searchScenarios(config.projectRoot, query) });
    return;
  }

  if (url.pathname === "/api/assets") {
    sendJson(res, 200, { ok: true, assets: scanAssets(config.projectRoot, access.previewOrigin) });
    return;
  }

  if (url.pathname === "/api/characters") {
    sendJson(res, 200, {
      ok: true,
      catalog: buildCharacterCatalog(config.projectRoot),
    });
    return;
  }

  if (url.pathname === "/api/diagnostics") {
    sendJson(res, 200, { ok: true, ...collectDiagnostics(config.projectRoot) });
    return;
  }

  if (url.pathname === "/api/backups") {
    const file = url.searchParams.get("file") || "";
    const relativePath =
      url.searchParams.get("path") || (file ? `data/scenario/${file}` : "");
    if (!relativePath) throw new Error("file or path is required");
    sendJson(res, 200, {
      ok: true,
      relativePath,
      backups: listBackups(config.projectRoot, BACKUP_ROOT, relativePath),
    });
    return;
  }

  if (url.pathname === "/api/preview-safety") {
    const safe = makeSafeCharaDefine(config.projectRoot);
    sendJson(res, 200, {
      ok: true,
      charaDefineSubstitutions: safe.substitutions,
    });
    return;
  }

  if (url.pathname === "/api/editor-system/chara_define.ks") {
    const safe = makeSafeCharaDefine(config.projectRoot);
    send(res, 200, safe.text, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    return;
  }

  if (url.pathname === "/api/preview-bootstrap.ks") {
    const file = url.searchParams.get("file") || "_preview.ks";
    const target = url.searchParams.get("target") || "";
    const rawLine = url.searchParams.get("line");
    const requestedLine =
      rawLine === null || rawLine === "" ? NaN : Number(rawLine);
    const linePreview = !target && Number.isFinite(requestedLine);
    const startLine = linePreview
      ? previewStartLineFor(config.projectRoot, file, requestedLine)
      : 0;
    send(
      res,
      200,
      makePreviewBootstrap(file, target, baseUrl, { linePreview, startLine }),
      {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        },
    );
    return;
  }

  if (url.pathname === "/api/preview-line.ks") {
    const file = url.searchParams.get("file") || "_preview.ks";
    const start = Number(url.searchParams.get("start") || 0);
    send(res, 200, makePreviewLineScenario(config.projectRoot, file, start), {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/scenario/save") {
    const body = await readBody(req);
    const storage = body.file || "";
    scenarioPath(config.projectRoot, storage);
    const relativePath = `data/scenario/${storage}`;
    const text = String(body.text || "");
    const write = backupAndWriteText(
      config.projectRoot,
      relativePath,
      text,
      BACKUP_ROOT,
      body.baseHash || "",
    );
    if (body.compact) {
      // KS本文の自動保存ではクライアントが本文を既に保持している。8千行級で
      // 数MBになる entries/events/textBlocks を保存のたびにparse→JSON化→
      // rendererで再parseする必要はないため、完全payloadは画面遷移時に一度だけ
      // GETし直す。ここはファイルI/O結果だけを返す。
      const stat = fs.statSync(projectPath(config.projectRoot, relativePath));
      sendJson(res, 200, {
        ok: true,
        compact: true,
        hash: write.hash,
        backupFile: write.backupFile,
        stat: { size: stat.size, mtimeMs: stat.mtimeMs },
      });
      return;
    }
    const scenario = makeWrittenScenarioPayload(storage, text, write.hash);
    sendJson(res, 200, {
      ok: true,
      hash: write.hash,
      backupFile: write.backupFile,
      diagnostics: scenario.parsed.diagnostics,
      scenario,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/scenario/line") {
    const body = await readBody(req);
    const data = parseScenarioFile(config.projectRoot, body.file);
    const line = Number(body.line);
    const nextText = applyLineEdit(
      data.text,
      line,
      String(body.replacement || ""),
      Number(body.count) || 1,
    );
    const write = backupAndWriteText(
      config.projectRoot,
      `data/scenario/${body.file}`,
      nextText,
      BACKUP_ROOT,
      body.baseHash || data.hash,
    );
    const scenario = makeWrittenScenarioPayload(
      data.storage,
      nextText,
      write.hash,
    );
    sendJson(res, 200, {
      ok: true,
      hash: write.hash,
      backupFile: write.backupFile,
      scenario,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/scenario/lineop") {
    const body = await readBody(req);
    const data = parseScenarioFile(config.projectRoot, body.file);
    const line = Number(body.line);
    const op = String(body.op || "");
    let edit;
    if (op === "delete") edit = deleteLine(data.text, line);
    else if (op === "up") edit = moveLine(data.text, line, -1);
    else if (op === "down") edit = moveLine(data.text, line, 1);
    else if (op === "move") edit = moveLineToWithTextBlockSplit(data.text, line, Number(body.to));
    else if (op === "duplicate") edit = duplicateLine(data.text, line);
    else throw new Error(`unsupported line operation: ${op}`);

    if (edit.text === data.text) {
      sendJson(res, 200, {
        ok: true,
        hash: data.hash,
        backupFile: "",
        line: edit.line,
        scenario: makeWrittenScenarioPayload(data.storage, data.text, data.hash),
      });
      return;
    }
    const write = backupAndWriteText(
      config.projectRoot,
      `data/scenario/${body.file}`,
      edit.text,
      BACKUP_ROOT,
      body.baseHash || data.hash,
    );
    const scenario = makeWrittenScenarioPayload(
      data.storage,
      edit.text,
      write.hash,
    );
    sendJson(res, 200, {
      ok: true,
      hash: write.hash,
      backupFile: write.backupFile,
      line: edit.line,
      splitTextBlock: Boolean(edit.splitTextBlock),
      scenario,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/scenario/update-tag") {
    const body = await readBody(req);
    const data = parseScenarioFile(config.projectRoot, body.file);
    const line = Number(body.line);
    const currentLine =
      data.text.replace(/\r\n/g, "\n").split("\n")[line] || "";
    const replacement = updateTagLine(currentLine, body.attrs || {});
    const nextText = applyLineEdit(data.text, line, replacement);
    const write = backupAndWriteText(
      config.projectRoot,
      `data/scenario/${body.file}`,
      nextText,
      BACKUP_ROOT,
      body.baseHash || data.hash,
    );
    const scenario = makeWrittenScenarioPayload(
      data.storage,
      nextText,
      write.hash,
    );
    sendJson(res, 200, {
      ok: true,
      hash: write.hash,
      backupFile: write.backupFile,
      replacement,
      scenario,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/scenario/insert") {
    const body = await readBody(req);
    const data = parseScenarioFile(config.projectRoot, body.file);
    const content =
      body.content != null
        ? String(body.content)
        : makeComponentLine(body.type, body.payload || {});
    const insertion = insertLinesWithTextBlockSplit(
      data.text,
      Number(body.line),
      content,
      body.mode || "after",
    );
    const nextText = insertion.text;
    const write = backupAndWriteText(
      config.projectRoot,
      `data/scenario/${body.file}`,
      nextText,
      BACKUP_ROOT,
      body.baseHash || data.hash,
    );
    const scenario = makeWrittenScenarioPayload(
      data.storage,
      nextText,
      write.hash,
    );
    sendJson(res, 200, {
      ok: true,
      hash: write.hash,
      backupFile: write.backupFile,
      inserted: content,
      line: insertion.line,
      splitTextBlock: insertion.splitTextBlock,
      scenario,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/label/rename") {
    const body = await readBody(req);
    const result = renameScenarioLabel(config.projectRoot, BACKUP_ROOT, body);
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/backup/restore") {
    const body = await readBody(req);
    const file = body.file || "";
    const relativePath = body.path || (file ? `data/scenario/${file}` : "");
    if (!relativePath) throw new Error("file or path is required");
    const result = restoreBackup(
      config.projectRoot,
      BACKUP_ROOT,
      relativePath,
      body.backupId || "",
      body.baseHash || "",
    );
    sendJson(res, 200, { ok: true, relativePath, ...result });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tatie/frame") {
    const body = await readBody(req);
    const write = saveTatieFrame(config.projectRoot, BACKUP_ROOT, body);
    sendJson(res, 200, { ok: true, ...write });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/config/save") {
    const body = await readBody(req);
    const name = body.name || "";
    if (
      ![
        "builder_config.json",
        "builder_config_deploy.json",
        "studio_config.json",
        "chara.builder.json",
      ].includes(name)
    ) {
      throw new Error("unsupported config file");
    }
    const jsonText = JSON.stringify(body.data || {}, null, 2) + "\n";
    JSON.parse(jsonText);
    const write = backupAndWriteText(
      config.projectRoot,
      name,
      jsonText,
      BACKUP_ROOT,
      body.baseHash || "",
    );
    sendJson(res, 200, {
      ok: true,
      hash: write.hash,
      backupFile: write.backupFile,
    });
    return;
  }

  sendError(res, 404, "API route not found");
}

async function handle(req, res, access) {
  try {
    const { role, url } = access.validate(req);
    access.setHeaders(res, role);

    if (url.pathname.startsWith("/api/")) {
      await routeApi(req, res, url, access);
      return;
    }
    if (url.pathname === "/preview-bridge.js") {
      send(res, 200, previewBridgeScript(), {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      });
      return;
    }
    if (url.pathname === "/project/__editor_preview.html") {
      send(res, 200, previewHtml(req, url), {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      return;
    }
    if (url.pathname.startsWith("/project/")) {
      const relative = decodeURIComponent(url.pathname.slice("/project/".length));
      // Only runtime files belong on the preview origin. Never serve project
      // metadata, Git history, editor backups, or arbitrary hidden files.
      if (!(relative === "index.html" || relative.startsWith("data/") || relative.startsWith("tyrano/")) ||
          relative.split("/").some((segment) => segment.startsWith("."))) {
        sendError(res, 403, "Project file is unavailable");
        return;
      }
      const file = projectPath(config.projectRoot, relative);
      serveFile(res, file, false, req.headers.range);
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      send(res, 200, access.editorHtml(readText(path.join(PUBLIC_ROOT, "index.html"))), {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      return;
    }
    const file = safeStatic(PUBLIC_ROOT, url.pathname);
    serveFile(res, file, false, req.headers.range);
  } catch (error) {
    sendError(res, error.httpStatus || (error.code === "STALE_FILE" ? 409 : 500), error);
  }
}

function startServer(options = {}) {
  const port = options.port != null ? Number(options.port) : config.port;
  let access;
  const server = http.createServer((req, res) => handle(req, res, access));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      access = createAccessControl(server.address().port);
      resolve({
        server,
        port: server.address().port,
        projectRoot: config.projectRoot,
        editorOrigin: access.editorOrigin,
        previewOrigin: access.previewOrigin,
      });
    });
  });
}

if (require.main === module) {
  if (config.check) {
    const diagnostics = collectDiagnostics(config.projectRoot);
    console.log(
      JSON.stringify(
        {
          projectRoot: config.projectRoot,
          scenarios: diagnostics.scenarios,
          summary: diagnostics.summary,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  startServer()
    .then(({ port }) => {
      console.log(`${APP_NAME}: http://127.0.0.1:${port}`);
      console.log(`Project: ${config.projectRoot}`);
    })
    .catch((error) => {
      console.error(error.message || error);
      process.exit(1);
    });
}

module.exports = { startServer, config, previewBridgeScript, readLayoutCharaName };
