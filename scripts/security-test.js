"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { assertProjectRoot, projectPath, scenarioPath, loadTatieSettings, listScenarios, scanAssets, makeSafeCharaDefine } = require("../lib/project");
const { installTyranoTatie, getTyranoTatieStatus } = require("../lib/tyrano-tatie");
const { buildExport } = require("../lib/studio");
const { allowedNavigation, externalWebUrl } = require("../lib/navigation");

function request(value, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(value, options, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: { get: name => res.headers[name] ?? null },
          text: async () => body.toString("utf8"), arrayBuffer: async () => body });
      });
    });
    req.on("error", reject);
    req.end(options.body);
  });
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tyranoforge-security-"));
  const project = path.join(root, "project");
  fs.mkdirSync(path.join(project, "data", "scenario", "system"), { recursive: true });
  fs.mkdirSync(path.join(root, "editor-data"));
  fs.writeFileSync(path.join(project, "index.html"), "<html><head></head><body>Preview</body></html>");
  const scenario = path.join(project, "data", "scenario", "test.ks");
  fs.writeFileSync(scenario, "original\n[s]\n");
  process.env.TYRANOFORGE_PROJECT = project;
  process.env.TYRANOFORGE_DATA_DIR = path.join(root, "editor-data");
  const { startServer } = require("../server");
  let info;
  let checks = 0;
  function check(actual, expected, message) { assert.equal(actual, expected, message); checks++; }
  try {
    info = await startServer({ port: 0 });
    const base = info.editorOrigin;
    const previewHost = new URL(info.previewOrigin).host;
    const htmlResponse = await request(base);
    const html = await htmlResponse.text();
    const token = html.match(/name="tyranoforge-session" content="([a-f0-9]+)"/)?.[1];
    assert(token, "editor session was not bootstrapped");
    check(htmlResponse.headers.get("x-frame-options"), "DENY", "editor must not be framed");
    assert(htmlResponse.headers.get("content-security-policy").includes("script-src 'self'"));
    const headers = { "X-TyranoForge-Session": token, Origin: base, "Content-Type": "application/json" };
    const saved = { file: "test.ks", text: "authorized edit\n[s]\n", compact: true };
    const cases = [
      ["missing token", "/api/scenario?file=test.ks", {}, 403],
      ["wrong token", "/api/scenario?file=test.ks", { headers: { ...headers, "X-TyranoForge-Session": "wrong" } }, 403],
      ["host prefix spoof", "/api/scenario?file=test.ks", { headers: { ...headers, Host: `127.0.0.1.attacker.example:${info.port}` } }, 403],
      ["DNS rebinding host", "/api/scenario?file=test.ks", { headers: { ...headers, Host: "attacker.example" } }, 403],
      ["foreign origin", "/api/scenario/save", { method: "POST", headers: { ...headers, Origin: "https://untrusted.example" }, body: JSON.stringify(saved) }, 403],
      ["null origin", "/api/scenario/save", { method: "POST", headers: { ...headers, Origin: "null" }, body: JSON.stringify(saved) }, 403],
      ["missing write origin", "/api/scenario/save", { method: "POST", headers: { "X-TyranoForge-Session": token }, body: JSON.stringify(saved) }, 403],
      ["foreign preflight", "/api/scenario/save", { method: "OPTIONS", headers: { Origin: "https://untrusted.example", "Access-Control-Request-Method": "POST" } }, 403],
      ["cross-site navigation", "/", { headers: { "Sec-Fetch-Site": "cross-site" } }, 403],
      ["preview writes even with editor token", "/api/scenario/save", { method: "POST", headers: { ...headers, Host: previewHost, Origin: info.previewOrigin }, body: JSON.stringify(saved) }, 403],
      ["preview reads editor API", "/api/scenario?file=test.ks", { headers: { Host: previewHost, "X-TyranoForge-Session": token } }, 403],
      ["preview reads editor token", "/", { headers: { Host: previewHost } }, 403],
      ["preview reads editor scripts", "/js/core.js", { headers: { Host: previewHost } }, 403],
      ["editor executes project content", "/project/index.html", { headers }, 403],
      ["hidden project data", "/project/data/.private", { headers: { Host: previewHost } }, 403],
      ["Git metadata", "/project/.git/config", { headers: { Host: previewHost } }, 403],
      ["wrong API method", "/api/scenario?file=test.ks", { method: "POST", headers, body: "{}" }, 405],
      ["authorized read", "/api/scenario?file=test.ks", { headers }, 200],
      ["preview runtime read", "/project/data/scenario/test.ks", { headers: { Host: previewHost } }, 200],
      ["editor asset read", "/project/data/scenario/test.ks", { headers: { Host: previewHost, Origin: base, "Sec-Fetch-Site": "cross-site" } }, 200],
      ["preview bootstrap", "/api/preview-bootstrap.ks?file=test.ks", { headers: { Host: previewHost } }, 200],
    ];
    for (const [name, url, options, expected] of cases) {
      const res = await request(base + url, options);
      check(res.status, expected, name);
      check(res.headers.get("access-control-allow-origin"), null, `${name}: no ambient CORS`);
      await res.arrayBuffer();
    }
    check(fs.readFileSync(scenario, "utf8"), "original\n[s]\n", "rejected requests must not write");
    const write = await request(base + "/api/scenario/save", { method: "POST", headers, body: JSON.stringify(saved) });
    check(write.status, 200, "authorized save");
    check(fs.readFileSync(scenario, "utf8"), saved.text, "authorized save reaches disk");

    const outside = path.join(root, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "secret.ks"), "not project data");
    fs.symlinkSync(outside, path.join(project, "data", "scenario", "external"), "junction");
    fs.symlinkSync(outside, path.join(project, "data", "external"), "junction");
    assert.throws(() => scenarioPath(project, "external/secret.ks"), /symlink/); checks++;
    assert.throws(() => projectPath(project, "data/external/new-file.txt"), /symlink/); checks++;
    assert.throws(() => projectPath(project, "../outside/secret.ks"), /escapes/); checks++;

    const settings = path.join(project, "data", "others", "plugin", "tatie", "settings.js");
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(settings, 'window.TYRANO_TATIE_SETTINGS = {"characters":{}};');
    check(Object.keys(loadTatieSettings(project).characters).length, 0, "data settings still load");
    fs.writeFileSync(settings, 'window.TYRANO_TATIE_SETTINGS = (() => { throw new Error("must never execute"); })();');
    assert.throws(() => loadTatieSettings(project), SyntaxError); checks++;

    const linkedProject = path.join(root, "linked-project");
    fs.mkdirSync(path.join(linkedProject, "data"), { recursive: true });
    fs.writeFileSync(path.join(linkedProject, "index.html"), "<title>Linked fixture</title>");
    fs.symlinkSync(outside, path.join(linkedProject, "data", "scenario"), "junction");
    assert.throws(() => assertProjectRoot(linkedProject), /symlink/); checks++;
    assert.throws(() => scenarioPath(linkedProject, "secret.ks"), /symlink/); checks++;
    assert.throws(() => listScenarios(linkedProject), /symlink/); checks++;
    fs.symlinkSync(outside, path.join(project, "data", "bgimage"), "junction");
    assert.throws(() => scanAssets(project), /symlink/); checks++;
    fs.symlinkSync(path.join(outside, "secret.ks"), path.join(project, "data", "scenario", "system", "chara_define.ks"));
    assert.throws(() => makeSafeCharaDefine(project), /symlink/); checks++;
    fs.rmSync(path.dirname(settings), { recursive: true });
    fs.symlinkSync(outside, path.dirname(settings), "junction");
    assert.throws(() => installTyranoTatie(project), /symlink/); checks++;
    assert.throws(() => getTyranoTatieStatus(project), /symlink/); checks++;
    await assert.rejects(buildExport(project, path.join(root, "exports"), { target: "browser", zip: false }), /symlink/); checks++;

    check(allowedNavigation(base + "/", true, info), true, "editor navigation");
    check(allowedNavigation(info.previewOrigin + "/project/index.html", false, info), true, "preview navigation");
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "http://localhost.attacker.example/", "http://127.0.0.1@attacker.example/", base + "/project/index.html"]) {
      check(allowedNavigation(url, true, info), false, "navigation denied: " + url);
    }
    check(externalWebUrl("file:///tmp/test"), false, "external schemes denied");
    check(externalWebUrl("https://example.com"), true, "external HTTPS allowed");

    // Absolute-form HTTP request targets must not bypass Host validation.
    const absoluteStatus = await new Promise((resolve, reject) => {
      http.get({ hostname: "127.0.0.1", port: info.port, path: "http://attacker.example/", headers: { Host: new URL(base).host } }, res => { res.resume(); resolve(res.statusCode); }).on("error", reject);
    });
    check(absoluteStatus, 403, "absolute URL origin");
    await new Promise(resolve => info.server.close(resolve));
    info = await startServer({ port: 0 });
    const rotated = await request(info.editorOrigin + "/api/scenario?file=test.ks", { headers: { "X-TyranoForge-Session": token } });
    check(rotated.status, 403, "old session rejected after restart");
    console.log(`PASS: ${checks} access control, filesystem, settings, and navigation checks`);
  } finally {
    if (info?.server.listening) await new Promise(resolve => info.server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
