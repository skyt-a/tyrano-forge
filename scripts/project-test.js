"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert/strict");
const { buildCharacterCatalog } = require("../lib/project");
const { buildExport } = require("../lib/studio");
const { installTyranoTatie, TATIE_SETTINGS_REL } = require("../lib/tyrano-tatie");

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tyranoforge-project-"));
  try {
    const project = path.join(temp, "project");
    const scenario = path.join(project, "data", "scenario");
    fs.mkdirSync(path.join(scenario, "system"), { recursive: true });
    fs.mkdirSync(path.join(project, "data", "fgimage"), { recursive: true });
    fs.writeFileSync(path.join(project, "index.html"), "<!doctype html><title>Project fixture</title>");
    fs.writeFileSync(path.join(project, "data", "fgimage", "guide.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="160"/>');
    fs.writeFileSync(path.join(scenario, "system", "chara_define.ks"), '[chara_new name="standard" storage="guide.svg"]\n');
    // Historical filenames are fixture input, never a special case in the editor.
    fs.writeFileSync(path.join(scenario, "system", "original_chara_define.ks"), '[chara_new name="legacy" storage="guide.svg"]\n');
    fs.writeFileSync(path.join(scenario, "___notebook_scene.ks"), "; ordinary user scenario\n[s]\n");
    fs.writeFileSync(path.join(scenario, "main.ks"), "[s]\n");
    installTyranoTatie(project);
    fs.writeFileSync(path.join(project, TATIE_SETTINGS_REL), `window.TYRANO_TATIE_SETTINGS = ${JSON.stringify({
      schemaVersion: 2, defaultCharacter: "guide", characters: {
        guide: { defaultAppearance: "default", appearances: { default: { variants: {
          normal: { storage: "guide.svg", frame: { width: 80, height: 160, positions: { center: { left: 10, top: 20 } } } },
        } } } },
      },
    })};\n`);
    const catalog = buildCharacterCatalog(project);
    assert.deepEqual(Object.keys(catalog.characters).sort(), ["guide", "standard"]);
    assert(catalog.characters.guide.hasTatieSettings);

    process.env.TYRANOFORGE_PROJECT = project;
    process.env.TYRANOFORGE_DATA_DIR = temp;
    const { readLayoutCharaName } = require("../server");
    const element = (classes = [], appearance = "default", variant = "normal") => ({
      classList: { contains: name => classes.includes(name) },
      getAttribute: key => ({ "data-tatie-appearance": appearance, "data-tatie-variant": variant })[key] || "",
    });
    const guide = { is_show: "true", tatie_appearance: "default", tatie_variant: "normal" };
    assert.equal(readLayoutCharaName(element(["guide"]), { guide, other: { ...guide } }), "guide");
    assert.equal(readLayoutCharaName(element(), { guide }), "guide");
    assert.equal(readLayoutCharaName(element(), { guide, other: { ...guide } }), "");
    assert.equal(readLayoutCharaName(element([], "coat"), { guide }), "");
    assert.equal(readLayoutCharaName(element(), { guide: { ...guide, is_show: "false" } }), "");
    assert.equal(readLayoutCharaName(element(), { legacy: { original_chara_appearance: "default", original_chara_variant: "normal" } }), "");
    assert.equal(readLayoutCharaName(element(["standard"]), { standard: { is_show: "true" } }), "standard");

    const exported = await buildExport(project, path.join(temp, "exports"), { target: "browser", zip: false });
    for (const file of ["main.ks", "___notebook_scene.ks", "system/original_chara_define.ks"]) {
      assert.equal(fs.readFileSync(path.join(exported.outDir, "data", "scenario", file), "utf8"), fs.readFileSync(path.join(scenario, file), "utf8"));
    }
    console.log("PASS: standard/Tatie catalogs, public Tatie runtime state, unambiguous layout selection, and ordinary scenario export");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
