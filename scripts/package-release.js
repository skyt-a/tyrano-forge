"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { execFileSync } = require("child_process");
const esbuild = require("esbuild");

async function main() {
  const platform = process.argv[2] || process.platform;
  const arch = process.argv[3] || (platform === "darwin" ? "arm64" : "x64");
  if (!((platform === "darwin" && arch === "arm64") || (platform === "win32" && arch === "x64"))) {
    throw new Error("Supported release targets: darwin arm64, win32 x64");
  }
  const root = path.join(__dirname, "..");
  const dist = path.join(root, "dist");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  esbuild.buildSync({ entryPoints: [path.join(root, "public/js/ks-codemirror-entry.js")], bundle: true,
    format: "iife", globalName: "KsCodeMirrorBundle", outfile: path.join(root, "public/js/ks-codemirror.js"), minify: true });
  const buildOut = platform === "darwin" ? fs.mkdtempSync(path.join(os.tmpdir(), "tyranoforge-build-")) : dist;
  const { packager } = await import("@electron/packager");
  const [folder] = await packager({
    dir: root, name: "TyranoForge", platform, arch, out: buildOut, overwrite: true,
    appBundleId: "com.tyranoforge.app", appVersion: pkg.version,
    osxSign: platform === "darwin" ? {
      identity: "-", identityValidation: false, continueOnError: false,
      preAutoEntitlements: false, preEmbedProvisioningProfile: false,
      optionsForFile: () => ({ entitlements: ["com.apple.security.cs.allow-jit", "com.apple.security.cs.disable-library-validation"] }),
    } : undefined,
    win32metadata: { CompanyName: "TyranoForge contributors", ProductName: "TyranoForge" },
    ignore: [/^\/\.backups/, /^\/export/, /^\/dist/, /^\/ios/, /^\/\.codex/, /^\/\.claude/,
      /^\/node_modules\/\.(ignored|pnpm)/, /^\/editor_config\.json$/, /^\/pnpm-lock\.yaml$/,
      /^\/\.env(?:\.|$)/, /^\/docs/, /^\/examples/, /^\/scripts/, /^\/\.github/],
  });
  if (platform === "darwin") {
    const app = path.join(folder, "TyranoForge.app");
    execFileSync("xattr", ["-cr", app]);
    execFileSync("codesign", ["--verify", "--deep", "--strict", app]);
  }
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, `packaged-${platform}-${arch}.json`), JSON.stringify({ folder }));
  const archive = path.join(dist, platform === "darwin" ? "TyranoForge-macOS-arm64.zip" : "TyranoForge-Windows-x64.zip");
  fs.rmSync(archive, { force: true });
  if (platform === "darwin") {
    execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", path.join(folder, "TyranoForge.app"), archive]);
  } else if (process.platform === "win32") {
    const quote = value => "'" + value.replace(/'/g, "''") + "'";
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Compress-Archive -LiteralPath ${quote(folder)} -DestinationPath ${quote(archive)} -CompressionLevel Optimal`]);
  } else {
    execFileSync("zip", ["-q", "-r", archive, path.basename(folder)], { cwd: dist });
  }
  const hash = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
  fs.writeFileSync(archive + ".sha256", `${hash}  ${path.basename(archive)}\n`);
  console.log(`Release archive: ${path.basename(archive)} (${(fs.statSync(archive).size / 1024 / 1024).toFixed(1)} MB)`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
