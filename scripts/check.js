"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tyranoforge-check-"));
try {
  fs.cpSync(path.join(__dirname, "..", "examples", "blue-hour"), root, { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>Test fixture</title>");
  const env = { ...process.env, TYRANOFORGE_PROJECT: root, TYRANOFORGE_DATA_DIR: root };
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  for (const script of ["syntax", "smoke", "security"]) {
    execFileSync(npm, ["run", script], { cwd: path.join(__dirname, ".."), env, stdio: "inherit" });
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
