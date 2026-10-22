# TyranoForge

TyranoScript / TyranoBuilder プロジェクトのためのビジュアルノベルエディターです。独自形式は持たず、`data/scenario/*.ks`・`builder_config*.json`・`data/system/Config.tjs` をそのまま読み書きするため、**TyranoBuilder と同じプロジェクトを行き来しながら**使えます。

> 本ソフトウェアは非公式のコミュニティツールであり、TyranoScript / TyranoBuilder の開発元（STUDIOシケモクMK）とは無関係です。TyranoBuilder 本体・素材は同梱していません（新規プロジェクトのスケルトンはローカルにインストール済みの TyranoBuilder から参照します）。

![TyranoForge のシナリオエディタ](docs/screenshots/editor.png)

<sub>シナリオエディタ — コンポーネントパレット / タイムライン / プレビュー＋インスペクター。右上のプレビューは実際の Tyrano ランタイムで描画されます。（画面はオリジナルのデモ「Blue Hour」）</sub>

## 起動

Node.js 22.12 以上が必要です。

```bash
git clone https://github.com/skyt-a/tyrano-forge.git
cd tyrano-forge
npm ci
npm run app        # Electron アプリとして起動（推奨）
npm start          # サーバーのみ起動してブラウザで開く方式
```

ブラウザ方式では、起動時に表示される `http://127.0.0.1:ポート番号/` を開いてください。TyranoBuilder または既存の Tyrano プロジェクトが必要です。

プロジェクトの探索先は既定で `~/TyranoBuilder/myproject` などを自動検出します。変更する場合は `editor_config.json` の `projectsRoots`、または環境変数 `TYRANOFORGE_PROJECTS_ROOT` / `TYRANOFORGE_PROJECT` を指定してください。

### macOS アプリ (.app) の作成

```bash
npm run dist
# → dist/TyranoForge-darwin-arm64/TyranoForge.app
```

パッケージ版では、バックアップ (`.backups/`)・書き出し (`export/`)・エディタ設定 (`editor_config.json`) は
`~/Library/Application Support/TyranoForge/` に保存されます（リポジトリから起動した場合はリポジトリ直下）。
アプリ終了時には未保存の自動保存キューをフラッシュしてから閉じます。

初回は前回開いていたプロジェクト（`editor_config.json` の `lastProject`）を開きます。プロジェクトは画面左上のプロジェクト名クリック、またはプロジェクト一覧ビュー（⌘8）からいつでも切り替えられます。

```bash
TYRANOFORGE_PROJECT="/path/to/project" npm start   # 明示指定
npm run check                                       # 構文・スモーク・アクセス制御の検証
npm run diagnostics                                 # 参照診断のみ
```

## 画面構成

左端のアクティビティレール（アイコン）でビューを切り替えます。

| ⌘キー | ビュー | 内容 |
|---|---|---|
| ⌘1 | エディタ | コンポーネントパレット / タイムライン / プレビュー＋インスペクター |
| ⌘2 | 素材 | 背景・立ち絵・UI画像・BGM・SE・動画のブラウズ、試聴（シークバー付き）、挿入。Finder からの D&D 追加対応 |
| ⌘3 | フロー | ラベル / ジャンプ / コール / 選択肢の一覧編集（ラベル改名は参照も一括更新） |
| ⌘4 | KS本文 | 生テキスト編集（自動保存・タイムラインと相互ジャンプ） |
| ⌘5 | 診断 | 未定義ラベル・欠落アセットなどのプロジェクト診断 |
| ⌘6 | 設定 | ゲームタイトル・解像度・文字速度など（Config.tjs / builder_config） |
| ⌘7 | ビルド | ブラウザ / Windows / Mac / Linux / iOS / Android 向け書き出し |
| ⌘8 | プロジェクト | プロジェクト一覧（フォルダ分け対応）と新規作成 |

- **⌘P** — シナリオのクイックオープン（Tab で全文検索モードに切替）
- **⌘S** — フォーカス中の対象を保存
- レール下部: 再読込 / 保存履歴（バックアップ復元）/ テーマ切替（ダーク・ライト）

<table>
  <tr>
    <td width="33%" valign="top"><img src="docs/screenshots/assets.png" alt="素材ビュー"><br><sub><b>素材（⌘2）</b> — 背景・立ち絵・BGM・SE などをブラウズして挿入</sub></td>
    <td width="33%" valign="top"><img src="docs/screenshots/flow.png" alt="分岐・フロービュー"><br><sub><b>分岐・フロー（⌘3）</b> — ラベル / ジャンプ / 選択肢を一覧編集（改名は参照も一括更新）</sub></td>
    <td width="33%" valign="top"><img src="docs/screenshots/diagnostics.png" alt="診断ビュー"><br><sub><b>診断（⌘5）</b> — 未定義ラベル・欠落アセットなどを検出</sub></td>
  </tr>
</table>

## エディタ

- **パレット**: TyranoBuilder と同じカテゴリ構成（ストーリー / 演出 / 画面効果 / キャラクター / 背景・画像 / メッセージ / メディア / システム / スクリプト）で全コンポーネントを収録。タイムラインへドラッグ＆ドロップで挿入、ダブルクリックで選択行の下に挿入。検索ボックスで絞り込み。
- **タイムライン**: タグ種別ごとに色分け。選択行をもう一度クリックするとその場で展開して直接編集（入力が止まると自動保存 → プレビューへライブ反映）。数千行のファイルでも仮想スクロールで軽快。
- **インスペクター**: タグごとの専用フォーム（数値 / 選択肢 / 色 / 画像・音声ピッカー / ラベル参照補完）。立ち絵はキャラクターカタログと連動。行の移動・複製・削除もここから。
- **プレビュー**: 右上ドックに常駐。▶ で先頭 / ラベル / 選択行から再生、シアターモードで拡大表示。「配置」で立ち絵をドラッグしてカタログへ保存。

![KS 本文の編集](docs/screenshots/ks-editor.png)

<sub>KS 本文 — CodeMirror 6 によるタグ補完・構文表示・検索・タイムラインとの相互移動。</sub>

## プロジェクト管理

- `~/TyranoBuilder/myproject` 以下を再帰的にスキャンし、**サブフォルダに整理したプロジェクトも認識**します（一覧はフォルダごとにグループ表示）。
- 新規プロジェクトは TyranoBuilder のスケルトンから作成（不足しがちな `system/*.ks` はスタブを自動補完）。作成後そのまま TyranoBuilder でも開けます。
- スキャンルートは `editor_config.json` の `projectsRoots` で変更できます。

## ビルド（書き出し）

`export/` 以下に出力します（ZIP 同時作成・asar アーカイブ化オプションあり）。ゲームに必要なファイル（index.html / data / tyrano）だけをコピーし、`.git` や作業フォルダ、プレビュー用ファイル、`builder_config.json` は含めません。

![ゲーム書き出し](docs/screenshots/build.png)

<sub>書き出し先（ブラウザ / Windows / Mac / Linux / iOS / Android）を選び、アプリアイコンの自動変換・ZIP 同時作成・asar アーカイブ化を切り替えて実行。</sub>

- **ブラウザ**: そのまま Web サーバーに置ける構成
- **Windows / Mac / Linux**: **そのまま実行できる .exe / .app** を生成（TyranoBuilder と同じ electron-packager 方式。Mac 以外は初回のみ Electron 本体のダウンロードにネットワークが必要。未署名のため配布先の Mac では右クリック→開く）
- **iOS / Android**: Cordova / Capacitor 用の `www/` 構成
- **アプリアイコン**: PNG を指定するだけで Mac 用 `.icns` / Windows 用 `.ico` に自動変換して埋め込みます

## ライセンス・互換性

- 本体は [MIT License](LICENSE)。TyranoBuilder のバイナリや素材は含みません。
- **ランタイムプラグイン互換**: プレビューと書き出しは実際の Tyrano ランタイムをそのまま使うため、`[plugin name=...]` で読み込む既存プラグイン（テーマ、`data/others/plugin/` 以下）はそのまま動作します。TyranoBuilder 専用の「ビルダー拡張コンポーネント」の専用編集 UI は未対応ですが、タグとしてタイムラインに表示・編集され、内容は失われません。

## 主なショートカット

- **⌘P** クイックオープン / **⌘S** 保存 / **⌘1〜8** ビュー切替
- タイムライン: **↑↓** 行移動 / **Shift+↑↓・Shift+クリック** 範囲選択 / **⌘クリック** 個別選択 / **Delete・Backspace** 選択行を削除
- プレビュー: タイトルバーの **▶** で再生、**■** で停止。前回開いていたシナリオファイルは次回起動時に自動で復元されます

## 方針

- `.ks` の未知タグ・コメント・空行はそのまま保持。行単位編集は該当行のみ書き換え。
- すべての保存で `.backups/` へ自動バックアップ（「保存履歴」から復元可能）。
- プレビューは実際の Tyrano ランタイムを iframe で起動し、編集は再読み込みなしで反映。

## ローカルサーバーとプレビュー

サーバーは IPv4 ループバックにだけ待ち受けます。編集画面は `127.0.0.1`、ゲームのプレビューと素材表示は同じポートの `localhost` に分けています。編集 API には起動ごとのセッショントークンを要求し、書き込み時は Origin も検証します。プレビューから編集 API、編集画面、セッショントークンにはアクセスできません。

Host・Origin・ブラウザの Fetch Metadata を検証し、任意のオリジンに対する CORS 許可は行いません。プロジェクト外へ向かうシンボリックリンクを通した読み書きも拒否します。共有素材を使う場合はプロジェクト内へコピーしてください。Tyrano Tatie の `settings.js` は、`window.TYRANO_TATIE_SETTINGS = {...};` の JSON データとして読み込み、エディタの Node.js プロセスでは実行しません。

同じ OS ユーザー権限で動くプログラムからの隔離を目的としたものではありません。プレビューではゲームやプラグインの JavaScript が動くため、信頼できるプロジェクトを開いてください。設計と確認手順は [SECURITY.md](SECURITY.md) に記載しています。

## デモとスクリーンショット

[Blue Hour](examples/blue-hour) の SVG 背景・シナリオと、この README の6枚のスクリーンショットは本リポジトリで制作したものです。TyranoBuilder のストック背景や制作中の作品は使用していません。デモ用の `review.ks` には、診断表示の例として意図的な未定義ラベルがあります。

```sh
node scripts/create-demo.js /path/to/blue-hour
TYRANOFORGE_PROJECT=/path/to/blue-hour npm run app
npm run docs:screenshots
```

デモの実行とスクリーンショットの再生成には、ローカルにインストール済みの TyranoBuilder スケルトンを使います。ランタイムやスケルトンのファイルはこのリポジトリには含めません。

## 開発

```sh
npm ci
npm run check             # 自前の一時データで構文・スモーク・アクセス制御を検証
npm run security          # 不正 Host/Origin、セッション、プレビュー分離などを検証
npm run docs:screenshots  # 実ブラウザでのアクセス制御・編集・プレビュー検証と撮影
```

本体・デモ素材は [MIT License](LICENSE)。同梱するエディタの依存ライブラリについては [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。
