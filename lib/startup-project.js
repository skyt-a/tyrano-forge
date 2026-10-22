"use strict";

const fs = require("fs");
const path = require("path");
const { assertProjectRoot } = require("./project-paths");

async function prepareStartupProject({ loadServer, dataRoot, chooseDirectory, showInvalidProject, env = process.env }) {
  try {
    return loadServer();
  } catch (error) {
    if (error.code !== "PROJECT_NOT_FOUND") throw error;
  }
  while (true) {
    const selected = await chooseDirectory();
    if (!selected) return null;
    let root;
    try { root = assertProjectRoot(selected); } catch {
      await showInvalidProject();
      continue;
    }
    const file = path.join(dataRoot, "editor_config.json");
    let stored = {};
    try { stored = JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch {}
    const roots = Array.isArray(stored.projectsRoots) ? stored.projectsRoots : [];
    stored.projectsRoots = [...new Set([...roots, path.dirname(root)])];
    stored.lastProject = root;
    fs.mkdirSync(dataRoot, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(stored, null, 2) + "\n");
    env.TYRANOFORGE_PROJECT = root;
    return loadServer();
  }
}

module.exports = { prepareStartupProject };
