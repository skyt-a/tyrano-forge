"use strict";

const fs = require("fs");
const path = require("path");
const { createProject, updateConfigTjs } = require("../lib/studio");

function createDemoProject(destination) {
  const dest = path.resolve(destination);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  createProject({
    projectsRoot: path.dirname(dest), name: path.basename(dest), title: "Blue Hour",
    skeleton: process.env.TYRANOFORGE_SKELETON || "",
  });
  const example = path.join(__dirname, "..", "examples", "blue-hour");
  // Remove the skeleton's stock game art before adding our own demo images.
  for (const dir of ["bgimage", "fgimage", "image", "bgm", "sound", "video"]) {
    fs.rmSync(path.join(dest, "data", dir), { recursive: true, force: true });
    fs.mkdirSync(path.join(dest, "data", dir), { recursive: true });
  }
  for (const dir of ["bgimage", "scenario"]) {
    fs.cpSync(path.join(example, "data", dir), path.join(dest, "data", dir), { recursive: true });
  }
  fs.writeFileSync(path.join(dest, "data", "scenario", "title_screen.ks"),
    '[bg storage="blue-hour.svg" time="0"]\n[glink text="物語をはじめる" storage="scene1.ks" x="90" y="560" size="24"]\n[s]\n');
  fs.writeFileSync(path.join(dest, "data", "scenario", "config.ks"), "; Blue Hour demo configuration entry\n[return]\n");
  fs.writeFileSync(path.join(dest, "data", "scenario", "replay.ks"), "; Blue Hour demo replay entry\n[return]\n");
  const configFile = path.join(dest, "data", "system", "Config.tjs");
  fs.writeFileSync(configFile, updateConfigTjs(fs.readFileSync(configFile, "utf8"), {
    "System.title": "Blue Hour", projectID: "tyranoforge-blue-hour", scWidth: 1280, scHeight: 720,
  }));
  return dest;
}

if (require.main === module) {
  if (!process.argv[2]) throw new Error("Usage: node scripts/create-demo.js /path/to/demo-output");
  console.log(createDemoProject(process.argv[2]));
}
module.exports = { createDemoProject };
