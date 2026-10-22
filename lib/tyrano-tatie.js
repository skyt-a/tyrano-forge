"use strict";

const fs = require("fs");
const path = require("path");
const { projectPath, scenarioPath } = require("./project-paths");

const TATIE_PACKAGE_ROOT = path.dirname(require.resolve("tyrano-tatie/package.json"));
const TATIE_PLUGIN_SOURCE = path.join(
  TATIE_PACKAGE_ROOT,
  "packages",
  "tyrano-plugin",
  "plugin",
  "tatie",
);
const TATIE_PLUGIN_REL = "data/others/plugin/tatie";
const TATIE_SETTINGS_REL = `${TATIE_PLUGIN_REL}/settings.js`;
const TATIE_PLUGIN_FILES = ["init.ks", "main.js", "settings.js", "tatie.builder.js", "LICENSE"];
const TATIE_LOAD_LINE = '[plugin name="tatie"]';

function copyMissingFile(source, target) {
  if (fs.existsSync(target)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
}

function pluginScenarioFiles(projectRoot) {
  return [
    scenarioPath(projectRoot, "system/plugin.ks"),
    scenarioPath(projectRoot, "system/plugin_third.ks"),
  ];
}

function hasTatieLoadLine(text) {
  return /\[plugin\b[^\]]*\bname\s*=\s*(?:"tatie"|'tatie'|tatie)(?:\s|\])/i.test(String(text || ""));
}

function ensureTatieLoadLine(projectRoot, options = {}) {
  const files = pluginScenarioFiles(projectRoot);
  for (const file of files) {
    if (fs.existsSync(file) && hasTatieLoadLine(fs.readFileSync(file, "utf8"))) {
      return { changed: false, file };
    }
  }

  const file = files[0];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const lines = current.replace(/\r\n/g, "\n").split("\n");
  const returnIndex = lines.findIndex((line) => /^\s*\[return(?:\s|\])/i.test(line));
  if (returnIndex >= 0) {
    lines.splice(returnIndex, 0, TATIE_LOAD_LINE);
  } else {
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(TATIE_LOAD_LINE, "[return]");
  }
  const text = `${lines.join(eol)}${eol}`;
  const relativePath = path.relative(projectRoot, file).replace(/\\/g, "/");
  let write = null;
  if (typeof options.writeText === "function") {
    write = options.writeText(relativePath, text);
  } else {
    fs.writeFileSync(file, text, "utf8");
  }
  return { changed: true, file, relativePath, write };
}

function getTyranoTatieStatus(projectRoot) {
  const targetRoot = projectPath(projectRoot, TATIE_PLUGIN_REL);
  const missingFiles = TATIE_PLUGIN_FILES.filter((name) => !fs.existsSync(projectPath(projectRoot, `${TATIE_PLUGIN_REL}/${name}`)));
  const enabled = pluginScenarioFiles(projectRoot).some((file) =>
    fs.existsSync(file) && hasTatieLoadLine(fs.readFileSync(file, "utf8")));
  const packageJson = JSON.parse(fs.readFileSync(path.join(TATIE_PACKAGE_ROOT, "package.json"), "utf8"));
  return {
    installed: missingFiles.length === 0,
    enabled,
    packageVersion: packageJson.version || "",
    pluginPath: targetRoot,
    settingsPath: projectPath(projectRoot, TATIE_SETTINGS_REL),
    missingFiles,
  };
}

function installTyranoTatie(projectRoot, options = {}) {
  if (!fs.existsSync(TATIE_PLUGIN_SOURCE)) {
    throw new Error("tyrano-tatie package does not contain the Tyrano plugin");
  }
  const targetRoot = projectPath(projectRoot, TATIE_PLUGIN_REL);
  const createdFiles = [];
  for (const name of TATIE_PLUGIN_FILES) {
    const source = name === "LICENSE" ? path.join(TATIE_PACKAGE_ROOT, "LICENSE") : path.join(TATIE_PLUGIN_SOURCE, name);
    if (!fs.existsSync(source)) {
      throw new Error(`tyrano-tatie plugin file is missing: ${name}`);
    }
    const target = projectPath(projectRoot, `${TATIE_PLUGIN_REL}/${name}`);
    if (copyMissingFile(source, target)) createdFiles.push(`${TATIE_PLUGIN_REL}/${name}`);
  }
  const load = ensureTatieLoadLine(projectRoot, options);
  return {
    createdFiles,
    enabledFile: load.file,
    enabledChanged: load.changed,
    backupFile: load.write?.backupFile || "",
    status: getTyranoTatieStatus(projectRoot),
  };
}

module.exports = {
  TATIE_PLUGIN_REL,
  TATIE_SETTINGS_REL,
  TATIE_LOAD_LINE,
  getTyranoTatieStatus,
  installTyranoTatie,
};
