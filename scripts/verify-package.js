"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert/strict");
const { spawnSync, execFileSync } = require("child_process");
const asar = require("@electron/asar");

const platform = process.argv[2] || process.platform;
const arch = platform === "darwin" ? "arm64" : "x64";
const root = path.join(__dirname, "..");
const manifest = path.join(root, "dist", `packaged-${platform}-${arch}.json`);
const folder = process.env.TYRANOFORGE_PACKAGE_FOLDER || (fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, "utf8")).folder : path.join(root, "dist", `TyranoForge-${platform}-${arch}`));
const resources = platform === "darwin" ? path.join(folder, "TyranoForge.app", "Contents", "Resources") : path.join(folder, "resources");
const binary = platform === "darwin" ? path.join(folder, "TyranoForge.app", "Contents", "MacOS", "TyranoForge") : path.join(folder, "TyranoForge.exe");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tyranoforge-package-"));
try {
  const files = asar.listPackage(path.join(resources, "app.asar")).map(file => file.replace(/\\/g, "/"));
  for (const expected of ["/lib/http-security.js", "/lib/startup-project.js", "/public/js/ks-codemirror.LICENSE.txt", "/node_modules/tyrano-tatie/LICENSE"]) assert(files.includes(expected), expected);
  assert(!files.includes("/editor_config.json"));
  assert(!files.some(file => file.startsWith("/.git/")));
  if (process.platform !== platform) throw new Error("Launch verification must run on the target OS");
  if (platform === "darwin") {
    execFileSync("codesign", ["--verify", "--deep", "--strict", path.join(folder, "TyranoForge.app")]);
  }
  const project = path.join(temp, "project");
  fs.cpSync(path.join(root, "examples", "blue-hour"), project, { recursive: true });
  fs.writeFileSync(path.join(project, "index.html"), "<!doctype html><title>Package fixture</title>");
  const resultFile = path.join(temp, "smoke-result.json");
  const result = spawnSync(binary, ["--smoke"], {
    env: { ...process.env, TYRANOFORGE_PROJECT: project, TYRANOFORGE_SMOKE_RESULT_FILE: resultFile, TYRANOFORGE_SMOKE_EXPORT: "1", TYRANOFORGE_SMOKE_DATA_DIR: path.join(temp, "app-data") },
    encoding: "utf8", timeout: 120000,
  });
  if (result.error) {
    const phase = fs.existsSync(resultFile) ? fs.readFileSync(resultFile, "utf8") : "no app checkpoint";
    throw new Error(`${result.error.message}; checkpoint: ${phase}; stderr: ${result.stderr}; stdout: ${result.stdout}`);
  }
  if (result.status !== 0) throw new Error(`Packaged app failed (${result.status}): ${result.stderr || result.stdout}`);
  assert(fs.existsSync(resultFile), "Packaged app did not finish its launch check");
  const report = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert(report.ready, "Packaged editor did not load its project");
  assert(report.exportReady, "Packaged app did not export a game ZIP");
  console.log(`PASS: ${platform} ${arch} packaged app launches and loads the editor; notices and access controls included`);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
