"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { prepareStartupProject } = require("../lib/startup-project");

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tyranoforge-startup-"));
  try {
    const project = path.join(temp, "project");
    const dataRoot = path.join(temp, "user-data");
    fs.mkdirSync(path.join(project, "data", "scenario"), { recursive: true });
    fs.mkdirSync(dataRoot);
    fs.writeFileSync(path.join(project, "index.html"), "<title>Startup fixture</title>");
    const missing = () => { const error = new Error("No project"); error.code = "PROJECT_NOT_FOUND"; throw error; };
    const server = { startServer() {} };
    const unexpectedDialog = () => { throw new Error("Unexpected dialog"); };
    assert.equal(await prepareStartupProject({ loadServer: () => server, dataRoot, chooseDirectory: unexpectedDialog }), server);
    assert.equal(await prepareStartupProject({ loadServer: missing, dataRoot, chooseDirectory: async () => null }), null);
    assert(!fs.existsSync(path.join(dataRoot, "editor_config.json")));
    fs.writeFileSync(path.join(dataRoot, "editor_config.json"), JSON.stringify({ uiPrefs: { theme: "light" }, projectsRoots: ["existing-root"] }));
    const env = {};
    let invalid = 0, selections = 0, loads = 0;
    assert.equal(await prepareStartupProject({
      loadServer: () => { loads++; if (!env.TYRANOFORGE_PROJECT) return missing(); return server; },
      dataRoot, env,
      chooseDirectory: async () => selections++ === 0 ? temp : project,
      showInvalidProject: async () => { invalid++; },
    }), server);
    assert.equal(loads, 2);
    assert.equal(invalid, 1);
    assert.equal(env.TYRANOFORGE_PROJECT, fs.realpathSync(project));
    const stored = JSON.parse(fs.readFileSync(path.join(dataRoot, "editor_config.json"), "utf8"));
    assert.equal(stored.lastProject, env.TYRANOFORGE_PROJECT);
    assert.equal(stored.uiPrefs.theme, "light");
    assert.deepEqual(stored.projectsRoots, ["existing-root", path.dirname(fs.realpathSync(project))]);
    await assert.rejects(prepareStartupProject({ loadServer: () => { throw new Error("Startup failure"); }, dataRoot, chooseDirectory: unexpectedDialog }), /Startup failure/);
    console.log("PASS: startup project discovery, selection, retry, cancel, and persisted preferences");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
