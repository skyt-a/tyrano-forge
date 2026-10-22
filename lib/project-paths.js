"use strict";

const fs = require("fs");
const path = require("path");
const toUnixPath = value => String(value || "").replace(/\\/g, "/");

function assertProjectRoot(projectRoot) {
  const root = path.resolve(projectRoot);
  if (!fs.existsSync(path.join(root, "index.html")) || !fs.existsSync(path.join(root, "data", "scenario"))) {
    throw new Error(`Tyrano project not found: ${root}`);
  }
  const resolved = fs.realpathSync(root);
  projectPath(resolved, "index.html");
  projectPath(resolved, "data/scenario");
  return resolved;
}

function ensureInside(root, target) {
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("path escapes project root");
  }
  // Resolve existing parents too, so writing a new file through an external
  // directory symlink cannot escape the selected project.
  let existing = target;
  while (!fs.existsSync(existing)) {
    try {
      if (fs.lstatSync(existing).isSymbolicLink()) throw new Error("broken project symlink");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error("project path not found");
    existing = parent;
  }
  const realRelative = path.relative(fs.realpathSync(root), fs.realpathSync(existing));
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error("symlink escapes project root");
  }
  return target;
}

function scenarioPath(projectRoot, storage) {
  const cleaned = toUnixPath(storage || "").replace(/^\/+/, "");
  if (!cleaned.endsWith(".ks")) {
    throw new Error("scenario file must end with .ks");
  }
  const root = projectPath(projectRoot, "data/scenario");
  return ensureInside(root, path.resolve(root, cleaned));
}

function projectPath(projectRoot, relPath) {
  const cleaned = toUnixPath(relPath || "").replace(/^\/+/, "");
  return ensureInside(projectRoot, path.resolve(projectRoot, cleaned));
}

module.exports = { assertProjectRoot, projectPath, scenarioPath };
