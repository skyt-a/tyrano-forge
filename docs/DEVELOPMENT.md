# 開発

Node.js 22.23.4、24.22.1、または 26.12.1 以降が必要です。これらは 2026年10月21日のセキュリティリリース（CVE-2026-111497 を含む）以降の版です。

```sh
git clone https://github.com/skyt-a/tyrano-forge.git
cd tyrano-forge
npm ci
npm run app
```

アプリは既存の TyranoBuilder / TyranoScript プロジェクトを読み書きします。新規プロジェクトの作成には、インストール済みの TyranoBuilder スケルトンを使います。

## プロジェクトの指定

```sh
TYRANOFORGE_PROJECT=/path/to/project npm run app
TYRANOFORGE_PROJECTS_ROOT=/path/to/projects npm run app
npm start
```

`npm start` はサーバーだけを起動します。表示された `http://127.0.0.1:ポート番号/` をブラウザで開いてください。

プロジェクトは既定で `~/TyranoBuilder/myproject` などから探索します。アプリで見つからない場合は、起動時にフォルダーを選べます。選んだ場所は次回以降も使います。探索先を複数設定する場合は、`editor_config.json` の `projectsRoots` にパスの配列を指定します。

パッケージ版の設定・バックアップ・書き出しは OS のアプリデータ領域、ソースから起動した場合はリポジトリ内に保存します。

## 検証

```sh
npm run check             # 一時的な自作データで構文・スモーク・アクセス制御・初回起動・プロジェクト互換性を検証
npm run security
npm run startup
npm run verify:tatie      # インストール済み TyranoBuilder を使って tatie の表示・配置保存を検証
npm run project           # 標準/tatie のキャラクターと汎用ファイルの保持を検証
npm run diagnostics       # 選択中のプロジェクトを診断
npm run perf:editor       # 一時コピーでエディタの性能・IME・自動保存を検証
```

アクセス制御の設計は [SECURITY.md](../SECURITY.md) を参照してください。

## 配布用ビルド

```sh
npm run dist:mac          # dist/TyranoForge-macOS-arm64.zip
npm run dist:win          # dist/TyranoForge-Windows-x64.zip
npm run verify:package    # 現在の OS 上で配布アプリの起動を検証
```

配布先の OS 上で `scripts/verify-package.js` を実行し、起動とプロジェクト読込を確認します。Windows のビルド・検証は GitHub Actions の **Windows build** から実行できます。ワークフローの成果物には ZIP と SHA-256 を含めます。

現在のビルドは Developer ID による署名・Apple 公証や Windows コード署名を行いません。各 OS の起動時確認が表示される場合があります。

## スクリーンショットの再生成

```sh
node scripts/create-demo.js /path/to/blue-hour
TYRANOFORGE_PROJECT=/path/to/blue-hour npm run app
npm run docs:screenshots
```

[Blue Hour](../examples/blue-hour) の背景とシナリオを使って、6枚のスクリーンショットを生成します。既存の制作中プロジェクトの本文・画像は使いません。`review.ks` の未定義ラベルは診断表示の例です。実行にはローカルの TyranoBuilder スケルトンが必要ですが、ランタイムや素材をリポジトリには追加しません。

`docs:screenshots` は Electron 上で保存・アップロード・プレビュー・アクセス制御も検証します。

## 立ち絵の依存ライブラリ

`skyt-a/tyrano-tatie` の v0.2.0 を固定した実行時依存にしています。新規プロジェクトへの導入、既存プロジェクトへの追加、立ち絵の表示・切り替え・配置編集に使います。標準の `chara_new` / `chara_show` も扱います。
