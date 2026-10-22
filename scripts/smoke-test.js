"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertProjectRoot,
  listScenarios,
  parseScenarioFile,
  buildCharacterCatalog,
  scanAssets,
  collectDiagnostics,
  makeSafeCharaDefine,
  makePreviewBootstrap,
  makePreviewLineScenario,
  listBackups,
  loadTatieSettings,
  saveTatieFrame,
} = require("../lib/project");
const {
  getTyranoTatieStatus,
  installTyranoTatie,
} = require("../lib/tyrano-tatie");
const {
  parseLine,
  updateTagLine,
  makeComponentLine,
  applyLineEdit,
  insertLines,
  insertLinesWithTextBlockSplit,
  deleteLine,
  moveLine,
  duplicateLine,
} = require("../lib/ks-parser");
const { searchScenarios } = require("../lib/project");

const EDITOR_ROOT = path.resolve(__dirname, "..");
const BACKUP_ROOT = path.join(EDITOR_ROOT, ".backups");
const DEFAULT_PROJECTS_ROOT_CANDIDATES = [
  path.join(os.homedir(), "TyranoBuilder", "myproject"),
  path.join(os.homedir(), "Documents", "TyranoBuilder", "myproject"),
  path.join(os.homedir(), "TyranoStudio", "myproject"),
];
const SCAN_IGNORE = new Set([
  "node_modules", ".git", ".backups", "export", "tmp", "dlc",
  "__MACOSX", ".Trash",
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isTyranoProject(dir) {
  return fs.existsSync(path.join(dir, "index.html")) &&
    fs.existsSync(path.join(dir, "data", "scenario"));
}

function discoverProject(root, maxDepth = 4) {
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.shift();
    if (isTyranoProject(dir)) return dir;
    if (depth >= maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      continue;
    }
    entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !entry.name.startsWith(".") && !SCAN_IGNORE.has(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"))
      .forEach((entry) => stack.push({ dir: path.join(dir, entry.name), depth: depth + 1 }));
  }
  return "";
}

function resolveProjectRoot() {
  if (process.env.TYRANOFORGE_PROJECT) {
    return assertProjectRoot(process.env.TYRANOFORGE_PROJECT);
  }
  const roots = [
    process.env.TYRANOFORGE_PROJECTS_ROOT || "",
    ...DEFAULT_PROJECTS_ROOT_CANDIDATES,
  ].filter(Boolean);
  for (const root of roots) {
    const project = discoverProject(root);
    if (project) return assertProjectRoot(project);
  }
  throw new Error("Tyrano project not found. Set TYRANOFORGE_PROJECT to run smoke tests.");
}

function main() {
  const projectRoot = resolveProjectRoot();
  const scenarios = listScenarios(projectRoot);
  assert(scenarios.length > 0, "no scenario files found");

  const preferred = scenarios.find((item) => item.storage === "_preview.ks") || scenarios[0];
  const scenario = parseScenarioFile(projectRoot, preferred.storage);
  assert(scenario.text.length > 0, `${preferred.storage} is empty`);
  assert(scenario.parsed.entries.length === scenario.parsed.lineCount, "parsed entry count does not match line count");

  const firstLine = scenario.text.replace(/\r\n/g, "\n").split("\n")[0] || "";
  const edited = applyLineEdit(scenario.text, 0, firstLine);
  assert(edited.length >= scenario.text.length - firstLine.length, "line edit returned an invalid scenario body");

  const inserted = insertLines(scenario.text, 0, "; smoke-test-marker", "after");
  assert(inserted.includes("; smoke-test-marker"), "insertLines did not insert content");

  const textBlock = "[tb_start_text mode=1 ]\n#案内人\nこんにちは[p]\n続き[p]\n[_tb_end_text]\n";
  const split = insertLinesWithTextBlockSplit(textBlock, 2, '[playse storage="bell.ogg"]', "after");
  const splitLines = split.text.replace(/\r\n/g, "\n").split("\n");
  assert(split.splitTextBlock === true, "text block insertion was not split");
  assert(split.line === 4, "split insertion line is incorrect");
  assert(splitLines[3] === "[_tb_end_text]", "split did not close the first text block");
  assert(splitLines[4] === '[playse storage="bell.ogg"]', "split did not insert content outside the text block");
  assert(splitLines[5] === "[tb_start_text mode=1 ]", "split did not reopen the text block");

  const inline = insertLinesWithTextBlockSplit(textBlock, 2, "[cm]", "after");
  assert(inline.splitTextBlock === false, "inline text tag should not split text block");

  const sample = "a\nb\nc\n";
  assert(deleteLine(sample, 1).text === "a\nc\n", "deleteLine failed");
  assert(moveLine(sample, 0, 1).text === "b\na\nc\n", "moveLine down failed");
  assert(moveLine(sample, 0, -1).text === sample, "moveLine boundary should be a no-op");
  assert(duplicateLine(sample, 2).text === "a\nb\nc\nc\n", "duplicateLine failed");

  const firstWord = (scenario.text.match(/[぀-ヿ一-鿿]{2}/) || ["の"])[0];
  const search = searchScenarios(projectRoot, firstWord, 50);
  assert(Array.isArray(search.matches), "searchScenarios did not return matches");

  const charaLine = makeComponentLine("chara", {
    name: "smoke",
    appearance: "default",
    variant: "normal",
    position: "center",
  });
  assert(parseLine(charaLine, 0).tags[0]?.name === "tatie", "chara component did not create tatie");

  const bgEntry = scenario.parsed.entries.find((entry) => entry.tags[0]?.name === "bg");
  if (bgEntry) {
    const updated = updateTagLine(bgEntry.raw, { time: "777" });
    assert(updated.includes('time="777"'), "updateTagLine did not update bg time");
  }

  const catalog = buildCharacterCatalog(projectRoot);
  assert(catalog && typeof catalog === "object", "character catalog failed");

  const tatieFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tyranoforge-tatie-"));
  try {
    fs.mkdirSync(path.join(tatieFixtureRoot, "data", "scenario", "system"), { recursive: true });
    fs.writeFileSync(path.join(tatieFixtureRoot, "index.html"), "<!doctype html>\n", "utf8");
    fs.writeFileSync(path.join(tatieFixtureRoot, "data", "scenario", "system", "plugin.ks"), "[return]\n", "utf8");
    const installed = installTyranoTatie(tatieFixtureRoot);
    assert(installed.status.installed, "tyrano-tatie plugin was not installed");
    assert(installed.status.enabled, "tyrano-tatie plugin was not enabled");
    const pluginScenario = fs.readFileSync(
      path.join(tatieFixtureRoot, "data", "scenario", "system", "plugin.ks"),
      "utf8",
    );
    assert(
      pluginScenario.indexOf('[plugin name="tatie"]') < pluginScenario.indexOf("[return]"),
      "tyrano-tatie must load before plugin.ks returns",
    );
    const installedAgain = installTyranoTatie(tatieFixtureRoot);
    assert(installedAgain.createdFiles.length === 0, "tyrano-tatie install must be idempotent");
    assert(installedAgain.enabledChanged === false, "tyrano-tatie load line must not be duplicated");

    const status = getTyranoTatieStatus(tatieFixtureRoot);
    fs.writeFileSync(
      status.settingsPath,
      `window.TYRANO_TATIE_SETTINGS = ${JSON.stringify({
        schemaVersion: 2,
        defaultCharacter: "smoke",
        characters: {
          smoke: {
            defaultAppearance: "default",
            appearances: {
              default: {
                variants: {
                  normal: {
                    storage: "smoke.png",
                    frame: {
                      width: 100,
                      height: 200,
                      positions: { center: { left: 0, top: 0 } },
                    },
                  },
                },
              },
            },
          },
        },
      }, null, 2)};\n`,
      "utf8",
    );
    assert(loadTatieSettings(tatieFixtureRoot)?.defaultCharacter === "smoke", "tyrano-tatie settings were not loaded");
    saveTatieFrame(tatieFixtureRoot, path.join(tatieFixtureRoot, ".backups"), {
      name: "smoke",
      appearance: "default",
      variant: "normal",
      position: "center",
      left: 12,
      top: 34,
    });
    const savedTatie = loadTatieSettings(tatieFixtureRoot);
    const savedPosition = savedTatie.characters.smoke.appearances.default.variants.normal.frame.positions.center;
    assert(savedPosition.left === 12 && savedPosition.top === 34, "tyrano-tatie frame was not saved");
  } finally {
    fs.rmSync(tatieFixtureRoot, { recursive: true, force: true });
  }

  const assets = scanAssets(projectRoot);
  assert(Array.isArray(assets.bgimage), "background asset scan failed");
  assert(Array.isArray(assets.fgimage), "foreground asset scan failed");

  const safeChara = makeSafeCharaDefine(projectRoot);
  assert(typeof safeChara.text === "string", "safe chara define was not generated");
  assert(Array.isArray(safeChara.substitutions), "safe chara substitutions missing");

  const bootstrap = makePreviewBootstrap(preferred.storage, "", "http://127.0.0.1:8791");
  assert(bootstrap.includes("/api/editor-system/chara_define.ks"), "preview bootstrap does not use safe chara define");
  assert(bootstrap.includes(preferred.storage), "preview bootstrap does not jump to selected file");

  // 行途中プレビューの背景復元は、開始行の背景より先にロードを完了させる。
  // wait=false だと両方の preload が競合し、直前の背景が後から上書きする。
  const previewFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tyranoforge-preview-"));
  try {
    fs.mkdirSync(path.join(previewFixtureRoot, "data", "scenario"), { recursive: true });
    fs.writeFileSync(path.join(previewFixtureRoot, "index.html"), "<!doctype html>\n", "utf8");
    fs.writeFileSync(
      path.join(previewFixtureRoot, "data", "scenario", "background.ks"),
      '[bg storage="before.jpg" time="1000"]\n; scene break\n[bg storage="selected.jpg" time="1000"]\n[s]\n',
      "utf8",
    );
    const linePreview = makePreviewLineScenario(previewFixtureRoot, "background.ks", 2);
    const restoredBackground = linePreview
      .split("\n")
      .find((line) => line.includes('storage="before.jpg"')) || "";
    assert(restoredBackground.includes('wait="true"'), "preview background restore must wait for preload");
    assert(
      linePreview.indexOf('storage="before.jpg"') < linePreview.indexOf('storage="selected.jpg"'),
      "preview background restore must run before the selected background",
    );
  } finally {
    fs.rmSync(previewFixtureRoot, { recursive: true, force: true });
  }

  const diagnostics = collectDiagnostics(projectRoot);
  assert(Number.isFinite(diagnostics.summary.errors), "diagnostic summary missing error count");
  assert(Number.isFinite(diagnostics.summary.warnings), "diagnostic summary missing warning count");

  const backups = listBackups(projectRoot, BACKUP_ROOT, `data/scenario/${preferred.storage}`, 5);

  console.log(JSON.stringify({
    ok: true,
    projectRoot,
    scenarioCount: scenarios.length,
    checkedScenario: preferred.storage,
    characterCount: Object.keys(catalog.characters || {}).length,
    bgimageCount: assets.bgimage.length,
    fgimageCount: assets.fgimage.length,
    diagnosticSummary: diagnostics.summary,
    safeCharaSubstitutions: safeChara.substitutions.length,
    recentBackups: backups.length,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
