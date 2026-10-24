"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const { projectPath } = require("./project-paths");
const { installTyranoTatie } = require("./tyrano-tatie");

/* ============================================================
   Config.tjs (";key=value" 形式) の読み書き
   ============================================================ */

function parseConfigTjs(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const entries = {};
  lines.forEach((line, index) => {
    const match = line.match(/^;([^=]+)=(.*)$/);
    if (!match) return;
    const key = match[1].trim();
    if (!(key in entries)) {
      entries[key] = { value: match[2], line: index };
    }
  });
  return entries;
}

function updateConfigTjs(text, updates) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const pending = { ...updates };
  const next = lines.map((line) => {
    const match = line.match(/^;([^=]+)=(.*)$/);
    if (!match) return line;
    const key = match[1].trim();
    if (!(key in pending)) return line;
    const value = pending[key];
    delete pending[key];
    return `;${key}=${value}`;
  });
  const additions = Object.entries(pending).map(([key, value]) => `;${key}=${value}`);
  if (additions.length) {
    let lastConfigLine = -1;
    next.forEach((line, index) => {
      if (/^;[^=]+=/.test(line)) lastConfigLine = index;
    });
    next.splice(lastConfigLine + 1, 0, ...additions);
  }
  return next.join("\n");
}

function readConfigTjs(projectRoot) {
  const file = projectPath(projectRoot, "data/system/Config.tjs");
  const text = fs.readFileSync(file, "utf8");
  return { file, text, entries: parseConfigTjs(text) };
}

/* ============================================================
   新規プロジェクト作成（TyranoBuilder のスケルトンからコピー）
   ============================================================ */

const SKELETON_CANDIDATES = [
  path.join(os.homedir(), "TyranoBuilder", "system", "tyrano"),
  path.join(os.homedir(), "Documents", "TyranoBuilder", "system", "tyrano"),
  ...[process.env["ProgramFiles(x86)"], process.env.ProgramFiles].filter(Boolean).flatMap(root => [
    path.join(root, "Steam", "steamapps", "common", "TyranoBuilder", "system", "tyrano"),
    path.join(root, "Steam", "steamapps", "common", "TyranoBuilder", "resources", "app", "system", "tyrano"),
  ]),
  path.join(os.homedir(), "Downloads", "tyranobuilder_v306c_mac_pro", "TyranoBuilder.app", "Contents", "Resources", "app", "system", "tyrano"),
  path.join(os.homedir(), "TyranoBuilder", "TyranoBuilder.app", "Contents", "Resources", "app", "system", "tyrano"),
  path.join(os.homedir(), "Applications", "TyranoBuilder.app", "Contents", "Resources", "app", "system", "tyrano"),
  path.join("/Applications", "TyranoBuilder.app", "Contents", "Resources", "app", "system", "tyrano"),
];

function skeletonScore(candidate) {
  // より新しい（必須ファイルが揃っている）スケルトンを優先する
  let score = 0;
  if (fs.existsSync(path.join(candidate, "data", "scenario", "system", "chara_layer_define.ks"))) score += 2;
  if (fs.existsSync(path.join(candidate, "data", "scenario", "system", "plugin.ks"))) score += 1;
  return score;
}

function findSkeleton(configured) {
  const candidates = (configured ? [configured, ...SKELETON_CANDIDATES] : SKELETON_CANDIDATES).filter(
    (candidate) =>
      fs.existsSync(path.join(candidate, "index.html")) &&
      fs.existsSync(path.join(candidate, "data", "scenario")),
  );
  if (!candidates.length) return "";
  candidates.sort((a, b) => skeletonScore(b) - skeletonScore(a));
  return candidates[0];
}

// Tyrano ランタイムや first.ks から参照される system ファイル。
// 実プロジェクトでは空ファイルでも動作する（呼び出し先の EOF で復帰する）ため、
// 不足していれば空のスタブを補完する。
const REQUIRED_SYSTEM_FILES = {
  "data/scenario/system/chara_layer_define.ks": ";キャラクターレイヤーの定義が記述される場所\n",
  "data/scenario/system/chara_define.ks": ";キャラクターの定義が記述される場所\n",
  "data/scenario/system/plugin.ks": "\n[return]\n",
  "data/scenario/system/plugin_third.ks": "",
  "data/scenario/system/message.ks": "",
  "data/scenario/system/novel_booster.ks": "",
  "data/scenario/system/master_cg.ks": "",
  "data/scenario/system/message_window.ks": "",
};

function fillRequiredSystemFiles(projectRoot) {
  const created = [];
  Object.entries(REQUIRED_SYSTEM_FILES).forEach(([relative, content]) => {
    const target = path.join(projectRoot, ...relative.split("/"));
    if (fs.existsSync(target)) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    created.push(relative);
  });
  return created;
}

// TyranoBuilder が新規プロジェクト作成時に template/ks から生成するファイルの
// 標準レンダリング結果（live2d なし / タイトル画面あり / メニューあり）。
// スケルトン素の first.ks は開発用ファイルを参照しているため必ず上書きする。
const NEW_PROJECT_FIRST_KS = `
;メニューボタン非表示
;[hidemenubutton]

;ゲームに必要なライブラリ読み込み
[call storage="system/tyrano.ks"]
[call storage="system/builder.ks"]
[call storage="system/chara_define.ks"]
[call storage="system/chara_layer_define.ks"]

[layopt layer=2 visible=true]
[layopt layer="message0" visible=false]
[call storage="system/message_window.ks"]

;プラグインの設定
[call storage="system/plugin.ks"]
[call storage="system/plugin_third.ks"]

;タイトル画面表示
[jump storage="title_screen.ks"]

;--------------------------

[s]
`;

const NEW_PROJECT_TITLE_KS = `
;==============================
; タイトル画面
;==============================

[hidemenubutton]

[tb_clear_images]

[tb_keyconfig flag=0]

;標準のメッセージレイヤを非表示
[tb_hide_message_window]

;タイトル表示
[bg storage ="title.jpg"]

*title

;タイトル各種ボタン
[glink color="black" text="はじめから" x=600 y=370 size=24 target="*start"]
[glink color="black" text="つづきから" x=600 y=470 size=24 target="*load"]

[s]

;-------ボタンが押されたときの処理

*start

[showmenubutton]

[cm]
[tb_keyconfig flag=1]

@jump storage="scene1.ks"
[s]

;--------ロードが押された時の処理
*load

[cm]
[showload]
[jump target=*title]

[s]
`;

function writeNewProjectScenarios(projectRoot) {
  const scenarioDir = path.join(projectRoot, "data", "scenario");
  fs.writeFileSync(path.join(scenarioDir, "first.ks"), NEW_PROJECT_FIRST_KS);
  fs.writeFileSync(path.join(scenarioDir, "title_screen.ks"), NEW_PROJECT_TITLE_KS);
  const scene1 = path.join(scenarioDir, "scene1.ks");
  if (!fs.existsSync(scene1)) {
    fs.writeFileSync(
      scene1,
      `[tb_start_text mode=1 ]\n#\nテキストを入力[p]\n[_tb_end_text]\n\n[s]\n`,
    );
  }
}

function copyRecursive(src, dest, filter = () => true) {
  const stat = statForCopy(src);
  if (!stat) return; // ソケット等の特殊ファイルや壊れたリンクはスキップ
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      const from = path.join(src, entry);
      if (!filter(from, entry)) continue;
      copyRecursive(from, path.join(dest, entry), filter);
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function createProject({ projectsRoot, folder, name, skeleton, title }) {
  if (!name || name === "." || name === ".." || /[\\/:*?"<>|]/.test(name)) {
    throw new Error("プロジェクト名に使えない文字が含まれています");
  }
  const skeletonRoot = findSkeleton(skeleton);
  if (!skeletonRoot) {
    throw new Error("TyranoBuilder のプロジェクトスケルトンが見つかりません");
  }
  const dest = projectPath(projectsRoot, folder ? `${folder}/${name}` : name);
  if (fs.existsSync(dest)) {
    throw new Error(`同名のプロジェクトが既に存在します: ${dest}`);
  }
  copyRecursive(skeletonRoot, dest, (from, entry) => entry !== ".DS_Store");
  fillRequiredSystemFiles(dest);
  writeNewProjectScenarios(dest);
  const tyranoTatie = installTyranoTatie(dest);

  // タイトルと projectID を反映
  try {
    const configFile = path.join(dest, "data", "system", "Config.tjs");
    const text = fs.readFileSync(configFile, "utf8");
    const updated = updateConfigTjs(text, {
      "System.title": title || name,
      projectID: name,
    });
    fs.writeFileSync(configFile, updated);
  } catch (error) {}

  // builder_config.json が無ければ最小構成で作成
  const builderConfig = path.join(dest, "builder_config.json");
  if (!fs.existsSync(builderConfig)) {
    fs.writeFileSync(
      builderConfig,
      JSON.stringify(
        {
          version: "0.1",
          map_chara: {},
          map_fuki: {},
          map_fav: {},
          map_font: {},
          map_var: {},
          map_watch: {},
          map_param_pin: {},
          map_theme: {},
          map_cg: {},
          map_replay: {},
          map_lang: {},
          live2d_version: "3",
          preview_sync: false,
        },
        null,
        2,
      ) + "\n",
    );
  }
  return { path: dest, skeleton: skeletonRoot, tyranoTatie };
}

/* ============================================================
   書き出し（ビルド）
   ============================================================ */

// ゲームの実行に必要なルート直下のエントリのみ書き出す（ホワイトリスト方式）。
// .git / node_modules / 作業フォルダ等をコピーしないため、巨大な開発リポジトリでも安全。
const EXPORT_ROOT_WHITELIST = [
  "index.html",
  "data",
  "tyrano",
  "credits.html",
  "readme.txt",
  "favicon.ico",
  "icon.png",
];

const EXPORT_EXCLUDE_FILES = new Set([
  ".DS_Store",
  ".git",
  ".gitignore",
  ".backups",
  "builder_config.json",
]);

const EXPORT_EXCLUDE_SCENARIOS = /^(_preview|_native_preview|_web_preview|_vscode_preview|_native_first|_web_first)/;

function shouldExportFile(entry, relDir) {
  if (EXPORT_EXCLUDE_FILES.has(entry)) return false;
  if (entry.startsWith("._")) return false;
  if (relDir === "data/scenario" && EXPORT_EXCLUDE_SCENARIOS.test(entry)) return false;
  return true;
}

// ソケット・FIFO・デバイス・壊れたシンボリックリンクはコピー対象外
// (.git/fsmonitor--daemon.ipc のようなファイルで copyfile が -102 になるため)
function statForCopy(src) {
  let lst;
  try {
    lst = fs.lstatSync(src);
  } catch (error) {
    return null;
  }
  if (lst.isSocket() || lst.isFIFO() || lst.isCharacterDevice() || lst.isBlockDevice()) return null;
  if (lst.isSymbolicLink()) {
    try {
      return fs.statSync(src); // リンク先を実体としてコピー
    } catch (error) {
      return null; // 壊れたリンク
    }
  }
  return lst;
}

function copyGameFiles(projectRoot, dest) {
  let count = 0;
  const visitedDirs = new Set();
  const walk = (src, target, relDir) => {
    projectPath(projectRoot, path.relative(projectRoot, src));
    const stat = statForCopy(src);
    if (!stat) return;
    if (stat.isDirectory()) {
      let real;
      try {
        real = fs.realpathSync(src);
      } catch (error) {
        return;
      }
      if (visitedDirs.has(real)) return; // シンボリックリンクのループ防止
      visitedDirs.add(real);
      fs.mkdirSync(target, { recursive: true });
      for (const entry of fs.readdirSync(src)) {
        if (!shouldExportFile(entry, relDir)) continue;
        walk(
          path.join(src, entry),
          path.join(target, entry),
          relDir ? `${relDir}/${entry}` : entry,
        );
      }
      return;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(src, target);
    count += 1;
  };
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of EXPORT_ROOT_WHITELIST) {
    const src = path.join(projectRoot, entry);
    if (!fs.existsSync(src)) continue;
    walk(src, path.join(dest, entry), entry);
  }
  return count;
}

function dirSize(dir) {
  let total = 0;
  const walk = (target) => {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target)) walk(path.join(target, entry));
    } else {
      total += stat.size;
    }
  };
  try {
    walk(dir);
  } catch (error) {}
  return total;
}

function zipDirectory(dir) {
  const zipPath = `${dir}.zip`;
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
  if (process.platform === "win32") {
    const quote = value => "'" + value.replace(/'/g, "''") + "'";
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `Compress-Archive -LiteralPath ${quote(dir)} -DestinationPath ${quote(zipPath)} -CompressionLevel Optimal`]);
  } else if (process.platform === "darwin") {
    execFileSync("ditto", ["-c", "-k", "--keepParent", dir, zipPath]);
  } else {
    execFileSync("zip", ["-q", "-r", zipPath, path.basename(dir)], { cwd: path.dirname(dir) });
  }
  return zipPath;
}

const GAME_ELECTRON_VERSION = (() => {
  try {
    return process.versions.electron || require("electron/package.json").version;
  } catch (error) {
    // Electron 43.8.3 は Node.js 24.22.0 を同梱する（CVE-2026-111497 修正前）。SECURITY.md を参照。
    return "43.8.3";
  }
})();

/* ---------- アイコン変換 (PNG → icns / ico) ---------- */

function resizePngWithSips(srcPng, size, destPng) {
  if (process.versions.electron) {
    const { nativeImage } = require("electron");
    const image = nativeImage.createFromPath(srcPng);
    if (image.isEmpty()) throw new Error("アイコン画像を読み込めません");
    fs.writeFileSync(destPng, image.resize({ width: size, height: size, quality: "best" }).toPNG());
  } else if (process.platform === "darwin") {
    execFileSync("sips", ["-z", String(size), String(size), "-s", "format", "png", srcPng, "--out", destPng], { stdio: "ignore" });
  } else {
    throw new Error("アイコン変換は TyranoForge アプリから実行してください");
  }
  return destPng;
}

// icns は PNG をそのまま格納できる (ic07=128 / ic08=256 / ic09=512 / ic10=1024)
function writeIcnsFromPngs(entries, destIcns) {
  const chunks = entries.map(({ type, file }) => {
    const data = fs.readFileSync(file);
    const header = Buffer.alloc(8);
    header.write(type, 0, "ascii");
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(body.length + 8, 4);
  fs.writeFileSync(destIcns, Buffer.concat([head, body]));
  return destIcns;
}

// ICO も Vista 以降は PNG をそのまま格納できる
function writeIcoFromPngs(files, destIco) {
  const images = files.map((file) => ({ data: fs.readFileSync(file), size: 0 }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  images.forEach(({ data }, index) => {
    const entry = Buffer.alloc(16);
    const size = [256, 128, 64, 48, 32][index] || 256;
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  });
  fs.writeFileSync(destIco, Buffer.concat([header, ...entries, ...images.map((i) => i.data)]));
  return destIco;
}

// 指定アイコン (png / icns / ico) をターゲットに合った形式に変換して返す
function prepareIconFor(target, iconPath, workDir) {
  if (!iconPath || !fs.existsSync(iconPath)) return "";
  const ext = path.extname(iconPath).toLowerCase();
  try {
    if (target === "mac") {
      if (ext === ".icns") return iconPath;
      if (ext !== ".png") return "";
      fs.mkdirSync(workDir, { recursive: true });
      const sizes = [
        { type: "ic07", size: 128 },
        { type: "ic08", size: 256 },
        { type: "ic09", size: 512 },
      ];
      const entries = sizes.map(({ type, size }) => ({
        type,
        file: resizePngWithSips(iconPath, size, path.join(workDir, `icon_${size}.png`)),
      }));
      return writeIcnsFromPngs(entries, path.join(workDir, "app_icon.icns"));
    }
    if (target === "win") {
      if (ext === ".ico") return iconPath;
      if (ext !== ".png") return "";
      fs.mkdirSync(workDir, { recursive: true });
      const files = [256, 128, 64, 48, 32].map((size) =>
        resizePngWithSips(iconPath, size, path.join(workDir, `icon_${size}.png`)),
      );
      return writeIcoFromPngs(files, path.join(workDir, "app_icon.ico"));
    }
    if (target === "linux" && ext === ".png") return iconPath;
  } catch (error) {
    return ""; // 変換失敗時はアイコンなしで続行
  }
  return "";
}

async function packageDesktopApp({ gameDir, outDir, target, title, asar, icon }) {
  let packagerFn;
  try {
    const mod = require("@electron/packager");
    packagerFn = mod.packager || mod.default || mod;
  } catch (error) {
    return { packaged: false, reason: "@electron/packager が見つかりません" };
  }
  const platform = { win: "win32", mac: "darwin", linux: "linux" }[target];
  const arch = target === "mac" && process.arch === "arm64" ? "arm64" : "x64";
  const iconWork = path.join(outDir, ".icon_work");
  const preparedIcon = prepareIconFor(target, icon, iconWork);
  try {
    const paths = await packagerFn({
      dir: gameDir,
      out: outDir,
      platform,
      arch,
      name: title,
      electronVersion: GAME_ELECTRON_VERSION,
      overwrite: true,
      prune: false,
      asar: asar === true,
      quiet: true,
      ...(preparedIcon ? { icon: preparedIcon } : {}),
      appBundleId: `com.tyrano.${title.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "game"}`,
    });
    fs.rmSync(iconWork, { recursive: true, force: true });
    return {
      packaged: true,
      appPath: Array.isArray(paths) ? paths[0] : String(paths),
      arch,
      iconApplied: Boolean(preparedIcon),
    };
  } catch (error) {
    fs.rmSync(iconWork, { recursive: true, force: true });
    return { packaged: false, reason: error.message || String(error) };
  }
}

function electronMainJs(width, height, title) {
  return `"use strict";
const { app, BrowserWindow } = require("electron");

function createWindow() {
  const win = new BrowserWindow({
    width: ${width},
    height: ${height},
    useContentSize: true,
    title: ${JSON.stringify(title)},
    webPreferences: { contextIsolation: true },
  });
  win.setMenuBarVisibility(false);
  win.loadFile("index.html");
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
`;
}

async function buildExport(projectRoot, exportRoot, options = {}) {
  const target = options.target || "browser";
  const wantZip = options.zip !== false;
  const steps = [];
  const projectName = path.basename(projectRoot);
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const outDir = path.join(exportRoot, `${projectName}_${target}_${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  let gameDir = outDir;
  let configEntries = {};
  try {
    configEntries = readConfigTjs(projectRoot).entries;
  } catch (error) {}
  const title = configEntries["System.title"]?.value || projectName;
  const width = Number(configEntries.scWidth?.value) || 1280;
  const height = Number(configEntries.scHeight?.value) || 720;

  if (target === "browser") {
    const count = copyGameFiles(projectRoot, outDir);
    steps.push(`ゲームファイルをコピーしました (${count}ファイル)`);
    steps.push("index.html をブラウザで開くか、Webサーバーに配置すると動作します");
  } else if (target === "win" || target === "mac" || target === "linux") {
    gameDir = path.join(outDir, "app_src");
    const count = copyGameFiles(projectRoot, gameDir);
    steps.push(`ゲームファイルをコピーしました (${count}ファイル)`);
    fs.writeFileSync(path.join(gameDir, "main.js"), electronMainJs(width, height, title));
    fs.writeFileSync(
      path.join(gameDir, "package.json"),
      JSON.stringify(
        {
          name: projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-") || "tyrano-game",
          productName: title,
          version: String(configEntries.game_version?.value || "1.0.0"),
          main: "main.js",
        },
        null,
        2,
      ) + "\n",
    );
    steps.push("Electron アプリ構成 (main.js / package.json) を生成しました");

    // そのまま実行できるアプリにパッケージ化（TyranoBuilder と同じ electron-packager 系）
    const result = await packageDesktopApp({ gameDir, outDir, target, title, asar: options.asar, icon: options.icon });
    if (result.packaged) {
      fs.rmSync(gameDir, { recursive: true, force: true });
      const appLabel = target === "mac" ? `${title}.app` : target === "win" ? `${title}.exe` : title;
      steps.push(`実行可能なアプリを生成しました: ${path.basename(result.appPath)}/${appLabel}`);
      if (options.icon) {
        steps.push(result.iconApplied ? "アプリアイコンを適用しました" : "アイコンの変換に失敗したため既定アイコンになっています");
      }
      if (target === "mac") {
        steps.push("未署名のため、他の Mac では右クリック→開くで起動してください");
      }
      fs.writeFileSync(
        path.join(outDir, "README.txt"),
        [
          `${title} — ${target.toUpperCase()} 向け実行ファイル`,
          "",
          `${path.basename(result.appPath)}/ の中の ${appLabel} をそのまま実行・配布できます。`,
          target === "mac" ? "未署名アプリのため、配布先では 右クリック → 開く で初回起動してください。" : "",
        ].filter(Boolean).join("\n"),
      );
    } else {
      // パッケージ化失敗時（オフライン等）はソース一式と手順を残す
      const platformName = { win: "win32", mac: "darwin", linux: "linux" }[target];
      steps.push(`アプリのパッケージ化に失敗したため、ソース一式を出力しました（${result.reason}）`);
      fs.writeFileSync(
        path.join(outDir, "README.txt"),
        [
          `${title} — ${target.toUpperCase()} 向け Electron アプリのソース一式`,
          "",
          `パッケージ化に失敗しました: ${result.reason}`,
          "（Windows/Linux 向けは初回のみ Electron 本体のダウンロードにネットワークが必要です）",
          "",
          "手動でパッケージ化する場合:",
          `  npx @electron/packager app_src "${title}" --platform=${platformName} --arch=x64 --out=. --overwrite`,
        ].join("\n"),
      );
    }
  } else if (target === "ios" || target === "android") {
    gameDir = path.join(outDir, "www");
    const count = copyGameFiles(projectRoot, gameDir);
    steps.push(`ゲームファイルを www/ にコピーしました (${count}ファイル)`);
    fs.writeFileSync(
      path.join(outDir, "README.txt"),
      [
        `${title} — ${target === "ios" ? "iOS" : "Android"} 向け書き出し`,
        "",
        "www/ フォルダを Cordova / Capacitor プロジェクトに組み込んでビルドしてください。",
        "例 (Capacitor):",
        "  npm init @capacitor/app",
        "  (webDir を www に設定)",
        `  npx cap add ${target}`,
        `  npx cap open ${target}`,
      ].join("\n"),
    );
    steps.push("README.txt にアプリ化手順を記載しています");
  } else {
    throw new Error(`未対応の書き出しターゲット: ${target}`);
  }

  let zipPath = "";
  if (wantZip) {
    zipPath = zipDirectory(outDir);
    steps.push(`ZIP を作成しました: ${path.basename(zipPath)}`);
  }

  return {
    target,
    outDir,
    zipPath,
    steps,
    fileSize: dirSize(outDir),
    title,
  };
}

module.exports = {
  parseConfigTjs,
  updateConfigTjs,
  readConfigTjs,
  findSkeleton,
  fillRequiredSystemFiles,
  createProject,
  buildExport,
};
