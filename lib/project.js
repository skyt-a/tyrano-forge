"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { assertProjectRoot, projectPath, scenarioPath } = require("./project-paths");
const { parseScenario, parseTagContent, parseLine, renderTag, updateTagLine } = require("./ks-parser");
const { TATIE_SETTINGS_REL } = require("./tyrano-tatie");

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"]);
const AUDIO_EXT = new Set([".mp3", ".ogg", ".m4a", ".wav", ".aac", ".flac"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".m4v"]);

function toUnixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function relativeUnix(root, file) {
  return toUnixPath(path.relative(root, file));
}

function hashText(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function splitTextForEdit(text) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const trailingNewline = /\r?\n$/.test(text);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return { lines, eol, trailingNewline };
}

function joinEditedLines(parts) {
  return parts.lines.join(parts.eol) + (parts.trailingNewline ? parts.eol : "");
}

function walkFiles(root, predicate = () => true) {
  const result = [];
  if (!fs.existsSync(root)) return result;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const list = fs.readdirSync(current, { withFileTypes: true });
    for (const dirent of list) {
      const full = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        if (dirent.name === "node_modules" || dirent.name === ".git") continue;
        stack.push(full);
      } else if (dirent.isFile() && predicate(full)) {
        result.push(full);
      }
    }
  }
  result.sort((a, b) => relativeUnix(root, a).localeCompare(relativeUnix(root, b), "ja"));
  return result;
}

function listScenarios(projectRoot) {
  const root = projectPath(projectRoot, "data/scenario");
  return walkFiles(root, (file) => file.endsWith(".ks")).map((file) => {
    const text = readText(file);
    const parsed = parseScenario(text, relativeUnix(root, file));
    return {
      storage: relativeUnix(root, file),
      path: file,
      lineCount: parsed.lineCount,
      labels: parsed.labels.length,
      jumps: parsed.jumps.length,
      choices: parsed.choices.length,
      diagnostics: parsed.diagnostics.length,
      size: fs.statSync(file).size,
      mtimeMs: fs.statSync(file).mtimeMs,
    };
  });
}

function searchScenarios(projectRoot, query, limit = 300) {
  const q = String(query || "").toLowerCase();
  const matches = [];
  let truncated = false;
  if (!q) return { query: q, matches, truncated };
  const root = projectPath(projectRoot, "data/scenario");
  const files = walkFiles(root, (file) => file.endsWith(".ks"));
  for (const file of files) {
    const storage = relativeUnix(root, file);
    const lines = readText(file).replace(/\r\n/g, "\n").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].toLowerCase().includes(q)) continue;
      if (matches.length >= limit) {
        truncated = true;
        return { query: q, matches, truncated };
      }
      matches.push({ file: storage, line: index, text: lines[index].trim().slice(0, 160) });
    }
  }
  return { query: q, matches, truncated };
}

function parseScenarioFile(projectRoot, storage) {
  const file = scenarioPath(projectRoot, storage);
  const text = readText(file);
  return {
    storage: toUnixPath(storage),
    path: file,
    text,
    hash: hashText(text),
    stat: fs.statSync(file),
    parsed: parseScenario(text, toUnixPath(storage)),
  };
}

function backupAndWriteText(projectRoot, relativePath, text, backupRoot, previousHash = "") {
  const target = projectPath(projectRoot, relativePath);
  const currentText = fs.existsSync(target) ? readText(target) : "";
  if (previousHash && hashText(currentText) !== previousHash) {
    const err = new Error("file changed after it was loaded");
    err.code = "STALE_FILE";
    throw err;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(backupRoot, stamp, relativeUnix(projectRoot, target));
  fs.mkdirSync(path.dirname(backupFile), { recursive: true });
  if (fs.existsSync(target)) {
    fs.writeFileSync(backupFile, currentText, "utf8");
  }
  fs.writeFileSync(target, text, "utf8");
  return { backupFile, hash: hashText(text) };
}

function backupPath(backupRoot, backupId) {
  const cleaned = toUnixPath(backupId || "").replace(/^\/+/, "");
  return ensureInside(backupRoot, path.resolve(backupRoot, cleaned));
}

function listBackups(projectRoot, backupRoot, relativePath, limit = 80) {
  const target = projectPath(projectRoot, relativePath);
  const rel = relativeUnix(projectRoot, target);
  if (!fs.existsSync(backupRoot)) return [];
  const result = [];
  const stamps = fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .sort()
    .reverse();

  for (const stamp of stamps) {
    const candidate = path.join(backupRoot, stamp, rel);
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
    const stat = fs.statSync(candidate);
    result.push({
      id: relativeUnix(backupRoot, candidate),
      stamp,
      relativePath: rel,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      hash: hashText(readText(candidate)),
    });
    if (result.length >= limit) break;
  }
  return result;
}

function restoreBackup(projectRoot, backupRoot, relativePath, backupId, previousHash = "") {
  const source = backupPath(backupRoot, backupId);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error("backup file was not found");
  }
  const target = projectPath(projectRoot, relativePath);
  const rel = relativeUnix(projectRoot, target);
  const backupRel = relativeUnix(backupRoot, source);
  const text = readText(source);
  const write = backupAndWriteText(projectRoot, rel, text, backupRoot, previousHash);
  return {
    restoredFrom: backupRel,
    backupFile: write.backupFile,
    hash: write.hash,
  };
}

function cleanLabelName(value) {
  return String(value || "").trim().replace(/^\*/, "");
}

function validateLabelName(name) {
  if (!name) throw new Error("label name is required");
  if (/[\s\[\]\|]/.test(name)) {
    throw new Error("label name cannot contain spaces, brackets, or |");
  }
}

function renderLabelLine(newName, caption) {
  return `*${newName}${caption ? `|${caption}` : ""}`;
}

function pointsToScenario(storage, currentFile, targetFile) {
  const cleaned = toUnixPath(storage || "").replace(/^\/+/, "");
  if (!cleaned) return currentFile === targetFile;
  return path.posix.normalize(cleaned) === path.posix.normalize(targetFile);
}

function updateReferenceLine(line, currentFile, targetFile, oldName, newName) {
  if (oldName === newName) return line;
  const tagCount = parseLine(line, 0).tags.length;
  let result = line;
  for (let index = 0; index < tagCount; index += 1) {
    const tag = parseLine(result, 0).tags[index];
    if (!tag) break;
    const target = tag.pm.target || "";
    if (!target || cleanLabelName(target) !== oldName) continue;
    if (!pointsToScenario(tag.pm.storage || "", currentFile, targetFile)) continue;
    const nextTarget = String(target).startsWith("*") ? `*${newName}` : newName;
    result = updateTagLine(result, { target: nextTarget }, index);
  }
  return result;
}

function renameScenarioLabel(projectRoot, backupRoot, payload) {
  const targetFile = toUnixPath(payload.file || "");
  const lineNumber = Number(payload.line);
  const newName = cleanLabelName(payload.newName);
  const requestedOldName = cleanLabelName(payload.oldName);
  validateLabelName(newName);

  const targetData = parseScenarioFile(projectRoot, targetFile);
  const targetParts = splitTextForEdit(targetData.text);
  if (lineNumber < 0 || lineNumber >= targetParts.lines.length) {
    throw new Error(`line out of range: ${lineNumber + 1}`);
  }

  const selectedEntry = parseLine(targetParts.lines[lineNumber], lineNumber);
  if (selectedEntry.kind !== "label") {
    throw new Error("selected line is not a label");
  }
  const oldName = requestedOldName || selectedEntry.label;
  if (!oldName) throw new Error("old label name was not found");

  const caption = payload.caption !== undefined ? String(payload.caption || "") : selectedEntry.labelCaption;
  if (oldName === newName && caption === selectedEntry.labelCaption) {
    return {
      oldName,
      newName,
      targetFile,
      line: lineNumber,
      changedFiles: [],
    };
  }
  const duplicates = targetData.parsed.labels.filter((label) => label.name === newName && label.line !== lineNumber);
  if (duplicates.length) {
    throw new Error(`label already exists in ${targetFile}: ${newName}`);
  }

  const changedFiles = [];
  const scenarios = listScenarios(projectRoot);
  for (const scenario of scenarios) {
    const storage = scenario.storage;
    const data = storage === targetFile ? targetData : parseScenarioFile(projectRoot, storage);
    const parts = storage === targetFile ? targetParts : splitTextForEdit(data.text);
    let changed = false;

    if (storage === targetFile) {
      const nextLabelLine = renderLabelLine(newName, caption);
      if (parts.lines[lineNumber] !== nextLabelLine) {
        parts.lines[lineNumber] = nextLabelLine;
        changed = true;
      }
    }

    for (let index = 0; index < parts.lines.length; index += 1) {
      const currentLine = parts.lines[index];
      const nextLine = updateReferenceLine(currentLine, storage, targetFile, oldName, newName);
      if (nextLine !== currentLine) {
        parts.lines[index] = nextLine;
        changed = true;
      }
    }

    if (!changed) continue;
    const nextText = joinEditedLines(parts);
    const baseHash = storage === targetFile ? (payload.baseHash || targetData.hash) : "";
    const write = backupAndWriteText(projectRoot, `data/scenario/${storage}`, nextText, backupRoot, baseHash);
    changedFiles.push({ file: storage, hash: write.hash, backupFile: write.backupFile });
  }

  return {
    oldName,
    newName,
    targetFile,
    line: lineNumber,
    changedFiles,
  };
}

function loadBuilderConfigs(projectRoot) {
  const names = ["builder_config.json", "builder_config_deploy.json", "studio_config.json", "chara.builder.json"];
  const configs = {};
  for (const name of names) {
    const file = projectPath(projectRoot, name);
    if (!fs.existsSync(file)) continue;
    try {
      configs[name] = { ok: true, data: readJson(file), hash: hashText(readText(file)), path: file };
    } catch (error) {
      configs[name] = { ok: false, error: error.message, path: file };
    }
  }
  return configs;
}

function loadTatieSettingsWithMeta(projectRoot) {
  const file = projectPath(projectRoot, TATIE_SETTINGS_REL);
  if (!fs.existsSync(file)) {
    return {
      path: file,
      relativePath: TATIE_SETTINGS_REL,
      hash: "",
      settings: null,
      text: "",
    };
  }
  const code = readText(file);
  // Settings are data, not a Node.js program. Never execute project JavaScript
  // in the editor process (node:vm is not a security boundary).
  const assignment = code.trim().match(/^window\.TYRANO_TATIE_SETTINGS\s*=\s*([\s\S]*?)\s*;?$/);
  if (!assignment) throw new Error("Tyrano Tatie settings must be a JSON object assignment");
  const settings = JSON.parse(assignment[1]);
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("Tyrano Tatie settings must contain a JSON object");
  }
  return {
    path: file,
    relativePath: TATIE_SETTINGS_REL,
    hash: hashText(code),
    settings,
    text: code,
  };
}

function loadTatieSettings(projectRoot) {
  return loadTatieSettingsWithMeta(projectRoot).settings;
}

function asFiniteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a number`);
  }
  return number;
}

function saveTatieFrame(projectRoot, backupRoot, patch) {
  const loaded = loadTatieSettingsWithMeta(projectRoot);
  const settings = loaded.settings;
  if (!settings || !settings.characters) {
    throw new Error("tyrano-tatie settings were not found");
  }

  const name = String(patch.name || "");
  const variantKey = String(patch.variant || "");
  const positionKey = String(patch.position || "center");
  if (!name || !variantKey || !positionKey) {
    throw new Error("name, variant, and position are required");
  }

  const character = settings.characters[name];
  if (!character) {
    throw new Error(`character not found in tyrano-tatie settings: ${name}`);
  }

  const appearanceKey = String(patch.appearance || character.defaultAppearance || "default");
  const appearance = character.appearances && character.appearances[appearanceKey];
  if (!appearance || !appearance.variants) {
    throw new Error(`appearance not found in tyrano-tatie settings: ${name} / ${appearanceKey}`);
  }

  const variant = appearance.variants[variantKey];
  if (!variant) {
    throw new Error(`variant not found in tyrano-tatie settings: ${name} / ${appearanceKey} / ${variantKey}`);
  }

  variant.frame = variant.frame || {};
  variant.frame.positions = variant.frame.positions || {};

  const left = Math.round(asFiniteNumber(patch.left, "left"));
  const top = Math.round(asFiniteNumber(patch.top, "top"));
  variant.frame.positions[positionKey] = { left, top };

  if (patch.width !== undefined && patch.width !== "") {
    variant.frame.width = Math.max(1, Math.round(asFiniteNumber(patch.width, "width")));
  }
  if (patch.height !== undefined && patch.height !== "") {
    variant.frame.height = Math.max(1, Math.round(asFiniteNumber(patch.height, "height")));
  }

  const text = `window.TYRANO_TATIE_SETTINGS = ${JSON.stringify(settings, null, 4)};\n`;
  const write = backupAndWriteText(projectRoot, TATIE_SETTINGS_REL, text, backupRoot, patch.baseHash || loaded.hash);
  return {
    backupFile: write.backupFile,
    hash: write.hash,
    settingsHash: write.hash,
    relativePath: TATIE_SETTINGS_REL,
    frame: variant.frame,
    position: variant.frame.positions[positionKey],
  };
}

function parseCharaDefine(projectRoot) {
  const result = {};
  const files = [
    scenarioPath(projectRoot, "system/chara_define.ks"),
    scenarioPath(projectRoot, "system/original_chara_define.ks"),
  ];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const lines = readText(file).split(/\r?\n/);
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("[chara_new")) return;
      const tag = parseTagContent(trimmed.slice(1, -1), index);
      if (!tag.pm.name) return;
      result[tag.pm.name] = {
        name: tag.pm.name,
        jname: tag.pm.jname || tag.pm.name,
        storage: tag.pm.storage || "",
        source: relativeUnix(projectRoot, file),
      };
    });
  }
  return result;
}

function scanCharaFolders(projectRoot, mapChara = {}) {
  const result = {};
  const root = projectPath(projectRoot, "data/fgimage/chara");
  if (!fs.existsSync(root)) return result;

  const numberToNames = {};
  Object.entries(mapChara || {}).forEach(([name, number]) => {
    const key = String(number);
    if (!numberToNames[key]) numberToNames[key] = [];
    numberToNames[key].push(name);
  });

  for (const number of fs.readdirSync(root)) {
    const charaRoot = projectPath(projectRoot, `data/fgimage/chara/${number}`);
    if (!fs.statSync(charaRoot).isDirectory()) continue;
    const names = numberToNames[number] || [`chara/${number}`];
    const files = walkFiles(charaRoot, (file) => IMAGE_EXT.has(path.extname(file).toLowerCase()));
    const appearances = {};
    for (const file of files) {
      const rel = relativeUnix(charaRoot, file);
      const parts = rel.split("/");
      let appearance = "default";
      let variantFile = parts[0];
      if (parts.length > 1) {
        appearance = parts[0];
        variantFile = parts.slice(1).join("/");
      }
      const variant = path.basename(variantFile, path.extname(variantFile));
      if (!appearances[appearance]) appearances[appearance] = { label: appearance, folder: `chara/${number}/${appearance}`, variants: {} };
      appearances[appearance].variants[variant] = {
        storage: `chara/${number}/${rel}`,
        inferred: true,
      };
    }
    for (const name of names) {
      result[name] = { number, appearances };
    }
  }
  return result;
}

function buildCharacterCatalog(projectRoot) {
  const configs = loadBuilderConfigs(projectRoot);
  const mapChara = configs["builder_config.json"]?.data?.map_chara || {};
  const charaDefine = parseCharaDefine(projectRoot);
  let settings = null;
  let settingsHash = "";
  let settingsPath = "";
  let settingsError = "";
  try {
    const loaded = loadTatieSettingsWithMeta(projectRoot);
    settings = loaded.settings;
    settingsHash = loaded.hash;
    settingsPath = loaded.path;
  } catch (error) {
    settingsError = error.message;
    settings = { error: error.message, characters: {} };
  }
  const inferred = scanCharaFolders(projectRoot, mapChara);
  const names = new Set([
    ...Object.keys(mapChara || {}),
    ...Object.keys(charaDefine),
    ...Object.keys(settings?.characters || {}),
    ...Object.keys(inferred),
  ]);
  const characters = {};
  for (const name of names) {
    const setting = settings?.characters?.[name] || {};
    const inferredItem = inferred[name] || {};
    characters[name] = {
      name,
      number: mapChara[name] || inferredItem.number || "",
      define: charaDefine[name] || null,
      defaultAppearance: setting.defaultAppearance || "default",
      appearances: setting.appearances || inferredItem.appearances || {},
      hasTatieSettings: Boolean(settings?.characters?.[name]),
    };
  }
  return {
    defaultCharacter: settings?.defaultCharacter || Object.keys(characters)[0] || "",
    frameReference: settings?.frameReference || null,
    settingsHash,
    settingsPath,
    settingsError: settings?.error || settingsError || "",
    characters,
  };
}

function scanAssets(projectRoot, origin = "") {
  const categories = [
    { key: "bgimage", dir: "data/bgimage", exts: IMAGE_EXT },
    { key: "fgimage", dir: "data/fgimage", exts: IMAGE_EXT },
    { key: "image", dir: "data/image", exts: IMAGE_EXT },
    { key: "bgm", dir: "data/bgm", exts: AUDIO_EXT },
    { key: "sound", dir: "data/sound", exts: AUDIO_EXT },
    { key: "video", dir: "data/video", exts: VIDEO_EXT },
  ];
  const result = {};
  for (const category of categories) {
    const root = projectPath(projectRoot, category.dir);
    result[category.key] = walkFiles(root, (file) => category.exts.has(path.extname(file).toLowerCase())).map((file) => {
      const rel = relativeUnix(root, file);
      const stat = fs.statSync(file);
      return {
        storage: rel,
        url: `${origin}/project/${category.dir}/${encodeURIComponent(rel).replace(/%2F/g, "/")}`,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };
    });
  }
  return result;
}

function storageExists(projectRoot, folder, storage) {
  if (!storage || String(storage).startsWith("&") || String(storage).startsWith("%")) return true;
  const cleaned = toUnixPath(storage).replace(/^\/+/, "");
  return fs.existsSync(projectPath(projectRoot, `data/${folder}/${cleaned}`));
}

function fgStoragePath(projectRoot, storage) {
  const cleaned = toUnixPath(storage || "").replace(/^\/+/, "");
  return projectPath(projectRoot, `data/fgimage/${cleaned}`);
}

function findFallbackCharaStorage(projectRoot, storage) {
  const cleaned = toUnixPath(storage || "").replace(/^\/+/, "");
  if (!cleaned) return "transparent.png";
  if (fs.existsSync(fgStoragePath(projectRoot, cleaned))) return cleaned;

  const duplicateExt = cleaned.replace(/(\.(png|jpe?g|gif|webp|bmp|svg|ico))\1$/i, "$1");
  if (duplicateExt !== cleaned && fs.existsSync(fgStoragePath(projectRoot, duplicateExt))) {
    return duplicateExt;
  }

  const parts = cleaned.split("/");
  const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
  if (folder) {
    const fullFolder = fgStoragePath(projectRoot, folder);
    if (fs.existsSync(fullFolder) && fs.statSync(fullFolder).isDirectory()) {
      const candidates = walkFiles(fullFolder, (file) => IMAGE_EXT.has(path.extname(file).toLowerCase()));
      if (candidates.length) return toUnixPath(path.posix.join(folder, relativeUnix(fullFolder, candidates[0])));
    }
  }

  if (fs.existsSync(fgStoragePath(projectRoot, "transparent.png"))) return "transparent.png";
  if (fs.existsSync(fgStoragePath(projectRoot, "white.jpg"))) return "white.jpg";
  return cleaned;
}

function makeSafeCharaDefine(projectRoot) {
  const file = scenarioPath(projectRoot, "system/chara_define.ks");
  const text = fs.existsSync(file) ? readText(file) : "";
  const lines = text.split(/\r?\n/);
  const substitutions = [];
  const safeLines = lines.map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("[chara_new")) return line;
    const content = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed.replace(/^\[/, "").replace(/\]$/, "");
    const tag = parseTagContent(content, index);
    const storage = tag.pm.storage || "";
    if (!storage || storageExists(projectRoot, "fgimage", storage)) return line;

    const replacement = findFallbackCharaStorage(projectRoot, storage);
    substitutions.push({
      line: index,
      name: tag.pm.name || "",
      from: storage,
      to: replacement,
    });
    const attrs = tag.attrs.map((attr) => ({
      name: attr.name,
      value: attr.name === "storage" ? replacement : attr.value,
    }));
    return renderTag("chara_new", attrs);
  });

  return {
    text: safeLines.join("\n"),
    substitutions,
  };
}

function collectDiagnostics(projectRoot) {
  const scenarios = listScenarios(projectRoot);
  const byStorage = {};
  const diagnostics = [];
  for (const item of scenarios) {
    const parsed = parseScenarioFile(projectRoot, item.storage).parsed;
    byStorage[item.storage] = parsed;
    for (const diag of parsed.diagnostics) {
      diagnostics.push({ file: item.storage, ...diag });
    }
  }

  for (const [storage, parsed] of Object.entries(byStorage)) {
    for (const jump of parsed.jumps) {
      const targetStorage = jump.storage || storage;
      const target = String(jump.target || "").replace(/^\*/, "");
      if (jump.storage && !byStorage[targetStorage]) {
        diagnostics.push({ severity: "error", file: storage, line: jump.line, message: `jump target file not found: ${jump.storage}` });
      } else if (target && byStorage[targetStorage] && !byStorage[targetStorage].labelMap[target]) {
        diagnostics.push({ severity: "warning", file: storage, line: jump.line, message: `jump label not found: ${targetStorage} ${jump.target}` });
      }
    }
    for (const call of parsed.calls) {
      if (call.storage && !storageExists(projectRoot, "scenario", call.storage)) {
        diagnostics.push({ severity: "error", file: storage, line: call.line, message: `call file not found: ${call.storage}` });
      }
    }
    for (const entry of parsed.entries) {
      for (const tag of entry.tags) {
        if (tag.name === "bg" && tag.pm.storage && !storageExists(projectRoot, "bgimage", tag.pm.storage)) {
          diagnostics.push({ severity: "warning", file: storage, line: entry.line, message: `background not found: ${tag.pm.storage}` });
        }
        if ((tag.name === "playbgm") && tag.pm.storage && !storageExists(projectRoot, "bgm", tag.pm.storage)) {
          diagnostics.push({ severity: "warning", file: storage, line: entry.line, message: `bgm not found: ${tag.pm.storage}` });
        }
        if ((tag.name === "playse") && tag.pm.storage && !storageExists(projectRoot, "sound", tag.pm.storage)) {
          diagnostics.push({ severity: "warning", file: storage, line: entry.line, message: `sound not found: ${tag.pm.storage}` });
        }
        if ((tag.name === "chara_show" || tag.name === "chara_mod") && tag.pm.storage && !storageExists(projectRoot, "fgimage", tag.pm.storage)) {
          diagnostics.push({ severity: "warning", file: storage, line: entry.line, message: `fgimage not found: ${tag.pm.storage}` });
        }
      }
    }
  }

  const configs = loadBuilderConfigs(projectRoot);
  for (const [name, value] of Object.entries(configs)) {
    if (!value.ok) diagnostics.push({ severity: "error", file: name, line: 0, message: value.error });
  }

  return {
    scenarios: scenarios.length,
    diagnostics,
    summary: {
      errors: diagnostics.filter((item) => item.severity === "error").length,
      warnings: diagnostics.filter((item) => item.severity !== "error").length,
    },
  };
}

function makePreviewBootstrap(file, target = "", baseUrl = "", options = {}) {
  const attrs = { storage: file };
  const previewStartLine = Number(options.startLine || 0);
  const bootstrapOffset = options.linePreview ? 0 : previewStartLine;
  if (target) {
    attrs.target = target.startsWith("*") ? target : `*${target}`;
  } else if (options.linePreview && baseUrl) {
    attrs.storage = `${baseUrl}/api/preview-line.ks?file=${encodeURIComponent(file)}&start=${encodeURIComponent(String(previewStartLine))}&t=${Date.now()}`;
  }
  const charaDefineStorage = baseUrl ? `${baseUrl}/api/editor-system/chara_define.ks` : "system/chara_define.ks";
  return [
    "; generated by TyranoForge",
    renderTag("call", { storage: "system/tyrano.ks" }),
    renderTag("call", { storage: "system/builder.ks" }),
    renderTag("call", { storage: charaDefineStorage }),
    renderTag("call", { storage: "system/chara_layer_define.ks" }),
    renderTag("layopt", { layer: "2", visible: "true" }),
    renderTag("layopt", { layer: "message0", visible: "false" }),
    renderTag("call", { storage: "system/message_window.ks" }),
    renderTag("call", { storage: "system/plugin.ks" }),
    renderTag("call", { storage: "system/plugin_third.ks" }),
    renderTag("eval", { exp: `f._system_preview_ks='${file.replace(/'/g, "\\'")}';f._system_preview_line_offset=${bootstrapOffset};f._system_preview_booting=0;` }),
    renderTag("jump", attrs),
    renderTag("s"),
    "",
  ].join("\n");
}

function previewStartLineFor(projectRoot, storage, lineNumber) {
  const data = parseScenarioFile(projectRoot, storage);
  const lines = data.text.replace(/\r\n/g, "\n").split("\n");
  return Math.max(0, Math.min(Math.floor(Number(lineNumber) || 0), Math.max(0, lines.length - 1)));
}

function fastPreviewTag(name, pm = {}, overrides = {}) {
  const attrs = { ...pm, ...overrides };
  if ("time" in attrs) attrs.time = attrs.time || "1";
  return renderTag(name, attrs);
}

function collectPreviewSetupLines(lines, start) {
  let lastBackground = null;
  let lastFade = null;
  let lastMessageWindow = null;
  let lastBgm = null;
  let lastSpeakerLine = null;
  let openTextBlockLine = null;
  const charas = new Map();

  for (let index = 0; index < start; index += 1) {
    const entry = parseLine(lines[index] || "", index);
    if (entry.kind === "speaker") {
      lastSpeakerLine = lines[index];
      continue;
    }
    const tag = entry.tags[0];
    if (!tag) continue;

    if (tag.name === "tb_start_text") {
      openTextBlockLine = lines[index];
      continue;
    }
    if (tag.name === "_tb_end_text") {
      openTextBlockLine = null;
      continue;
    }
    if (tag.name === "bg") {
      // 背景画像は preload 完了後にレイヤーへ反映される。wait=false で復元を
      // 先へ進めると、開始行の [bg] と読み込み順が前後し、遅れて完了した
      // 「直前の背景」が新しい背景を上書きしてしまう。
      // 1ms の遷移完了まで待ち、開始行より前の状態復元を直列化する。
      lastBackground = fastPreviewTag("bg", tag.pm, { time: "1", wait: "true" });
      continue;
    }
    if (tag.name === "mask" || tag.name === "mask_off") {
      lastFade = fastPreviewTag(tag.name, tag.pm, { time: "1", wait: "false" });
      continue;
    }
    if (tag.name === "tb_show_message_window" || tag.name === "tb_hide_message_window") {
      lastMessageWindow = lines[index];
      continue;
    }
    if (tag.name === "playbgm") {
      lastBgm = fastPreviewTag("playbgm", tag.pm, { time: "1" });
      continue;
    }
    if (tag.name === "stopbgm") {
      lastBgm = null;
      continue;
    }
    if (tag.name === "chara_hide_all") {
      charas.clear();
      continue;
    }
    if (tag.name === "chara_hide") {
      if (tag.pm.name) charas.delete(tag.pm.name);
      continue;
    }
    if (tag.name === "tatie") {
      const key = tag.pm.name || `line:${index}`;
      charas.set(key, fastPreviewTag("tatie", tag.pm, { mode: "show", time: "1", wait: "false" }));
      continue;
    }
    if (tag.name === "chara_show" || tag.name === "chara_mod") {
      const key = tag.pm.name || `line:${index}`;
      const name = tag.name === "chara_mod" ? "chara_show" : tag.name;
      charas.set(key, fastPreviewTag(name, tag.pm, { time: "1", wait: "false" }));
    }
  }

  return [
    lastBackground,
    lastFade,
    lastMessageWindow,
    lastBgm,
    ...charas.values(),
    openTextBlockLine,
    lastSpeakerLine,
  ].filter(Boolean);
}

function makePreviewLineScenario(projectRoot, storage, startLine = 0) {
  const data = parseScenarioFile(projectRoot, storage);
  const lines = data.text.replace(/\r\n/g, "\n").split("\n");
  const start = Math.max(0, Math.min(Math.floor(Number(startLine) || 0), Math.max(0, lines.length - 1)));
  const setupLines = collectPreviewSetupLines(lines, start);
  // 先頭 eval + セットアップ + 終了 eval がプレフィックス。
  // _system_preview_booting=1 の間はエディタ側でタイムライン同期を行わない
  // （状態復元用の合成行に選択が引きずられるのを防ぐ）。
  const prefixCount = setupLines.length + 2;
  const offset = start - prefixCount;
  return [
    renderTag("eval", { exp: `f._system_preview_line_offset=${offset};f._system_preview_booting=1;` }),
    ...setupLines,
    renderTag("eval", { exp: "f._system_preview_booting=0;" }),
    ...lines.slice(start),
    "",
  ].join("\n");
}

module.exports = {
  IMAGE_EXT,
  AUDIO_EXT,
  VIDEO_EXT,
  toUnixPath,
  relativeUnix,
  hashText,
  assertProjectRoot,
  scenarioPath,
  projectPath,
  readText,
  readJson,
  walkFiles,
  listScenarios,
  searchScenarios,
  parseScenarioFile,
  backupAndWriteText,
  listBackups,
  restoreBackup,
  renameScenarioLabel,
  loadBuilderConfigs,
  loadTatieSettings,
  loadTatieSettingsWithMeta,
  saveTatieFrame,
  buildCharacterCatalog,
  scanAssets,
  storageExists,
  makeSafeCharaDefine,
  collectDiagnostics,
  makePreviewBootstrap,
  previewStartLineFor,
  makePreviewLineScenario,
};
