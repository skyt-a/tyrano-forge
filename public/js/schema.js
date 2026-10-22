"use strict";

/* ============================================================
   TyranoBuilder 互換のコンポーネント定義
   （カテゴリ / パレット項目 / タグ属性スキーマ）
   ============================================================ */

const CATEGORIES = [
  { id: "scenario", label: "ストーリー", cat: "story" },
  { id: "text", label: "演出", cat: "direction" },
  { id: "screen_effect", label: "画面効果", cat: "screen" },
  { id: "character", label: "キャラクター", cat: "chara" },
  { id: "image", label: "背景・画像", cat: "media" },
  { id: "effect", label: "メッセージ", cat: "message" },
  { id: "media", label: "メディア", cat: "sound" },
  { id: "eval", label: "システム", cat: "system" },
  { id: "script", label: "スクリプト", cat: "script" },
];

// select 用の定番選択肢
const FADE_METHODS = ["fadeIn", "fadeOut", "crossfade", "none"];
const BG_METHODS = ["crossfade", "fadeIn", "fadeOut", "slideDown", "slideUp", "none"];
const BOOL = ["true", "false"];
const SE_BUFS = ["0", "1", "2", "3", "4", "5"];

/*
  fields の type:
   text / num / bool / select / color /
   image (dir 指定の画像ピッカー) / sound (dir 指定の音声ピッカー) /
   movie / scenario (シナリオファイル) / label (ラベル参照)
*/
const TAG_SCHEMAS = {
  bg: {
    label: "背景変更",
    fields: [
      { key: "storage", label: "背景画像", type: "image", dir: "bgimage" },
      { key: "time", label: "時間(ms)", type: "num", def: "1000" },
      { key: "method", label: "方式", type: "select", options: BG_METHODS },
      { key: "cross", label: "クロス", type: "bool" },
      { key: "wait", label: "完了を待つ", type: "bool" },
    ],
  },
  tb_image_show: {
    label: "イメージ表示",
    fields: [
      { key: "storage", label: "画像", type: "image", dir: "fgimage" },
      { key: "x", label: "X", type: "num", def: "0" },
      { key: "y", label: "Y", type: "num", def: "0" },
      { key: "width", label: "幅", type: "num" },
      { key: "height", label: "高さ", type: "num" },
      { key: "time", label: "時間(ms)", type: "num", def: "500" },
      { key: "layer", label: "レイヤ", type: "text", def: "1" },
    ],
  },
  tb_image_hide: {
    label: "イメージ消去",
    fields: [
      { key: "x", label: "X", type: "num" },
      { key: "y", label: "Y", type: "num" },
      { key: "time", label: "時間(ms)", type: "num", def: "500" },
    ],
  },
  image: {
    label: "イメージ表示",
    fields: [
      { key: "storage", label: "画像", type: "image", dir: "fgimage" },
      { key: "layer", label: "レイヤ", type: "text", def: "1" },
      { key: "x", label: "X", type: "num", def: "0" },
      { key: "y", label: "Y", type: "num", def: "0" },
      { key: "visible", label: "表示", type: "bool", def: "true" },
    ],
  },
  freeimage: {
    label: "イメージ消去",
    fields: [
      { key: "layer", label: "レイヤ", type: "text", def: "1" },
      { key: "time", label: "時間(ms)", type: "num" },
    ],
  },
  clickable: {
    label: "クリッカブルマップ",
    fields: [
      { key: "storage", label: "画像", type: "image", dir: "image" },
      { key: "map", label: "マップ", type: "text" },
    ],
  },
  button: {
    label: "画像ボタン",
    fields: [
      { key: "graphic", label: "画像", type: "image", dir: "image" },
      { key: "x", label: "X", type: "num", def: "0" },
      { key: "y", label: "Y", type: "num", def: "0" },
      { key: "target", label: "ラベル", type: "label" },
      { key: "storage", label: "ファイル", type: "scenario" },
    ],
  },
  mask: {
    label: "暗転",
    fields: [
      { key: "time", label: "時間(ms)", type: "num", def: "1000" },
      { key: "effect", label: "方式", type: "select", options: FADE_METHODS },
      { key: "color", label: "色", type: "color", def: "0x000000" },
    ],
  },
  mask_off: {
    label: "暗転を解除",
    fields: [
      { key: "time", label: "時間(ms)", type: "num", def: "1000" },
      { key: "effect", label: "方式", type: "select", options: FADE_METHODS },
    ],
  },
  layermode: {
    label: "イメージ合成",
    fields: [
      { key: "storage", label: "画像", type: "image", dir: "image" },
      { key: "x", label: "X", type: "num", def: "0" },
      { key: "y", label: "Y", type: "num", def: "0" },
      { key: "opacity", label: "不透明度", type: "num", def: "255" },
      { key: "time", label: "時間(ms)", type: "num", def: "1000" },
      { key: "multiply", label: "乗算", type: "bool" },
    ],
  },
  layermode_movie: {
    label: "ムービー合成",
    fields: [
      { key: "video", label: "動画", type: "movie" },
      { key: "time", label: "時間(ms)", type: "num", def: "1000" },
    ],
  },
  free_layermode: {
    label: "合成を解除",
    fields: [{ key: "time", label: "時間(ms)", type: "num", def: "1000" }],
  },
  quake: {
    label: "クエイク",
    fields: [
      { key: "time", label: "時間(ms)", type: "num", def: "600" },
      { key: "hmax", label: "横振幅", type: "num", def: "0" },
      { key: "vmax", label: "縦振幅", type: "num", def: "30" },
      { key: "count", label: "回数", type: "num" },
    ],
  },
  wait: {
    label: "ウェイト",
    fields: [{ key: "time", label: "時間(ms)", type: "num", def: "1000" }],
  },
  tb_ptext_show: {
    label: "テキスト配置",
    fields: [
      { key: "text", label: "テキスト", type: "text" },
      { key: "x", label: "X", type: "num", def: "0" },
      { key: "y", label: "Y", type: "num", def: "0" },
      { key: "size", label: "サイズ", type: "num", def: "26" },
      { key: "color", label: "色", type: "color", def: "0xffffff" },
      { key: "time", label: "時間(ms)", type: "num", def: "500" },
    ],
  },
  tb_ptext_hide: {
    label: "テキスト消去",
    fields: [
      { key: "x", label: "X", type: "num" },
      { key: "y", label: "Y", type: "num" },
      { key: "time", label: "時間(ms)", type: "num", def: "500" },
    ],
  },
  chara_show: {
    label: "キャラクター登場",
    fields: [
      { key: "name", label: "名前", type: "text" },
      { key: "storage", label: "画像", type: "image", dir: "fgimage" },
      { key: "left", label: "左", type: "num" },
      { key: "top", label: "上", type: "num" },
      { key: "width", label: "幅", type: "num" },
      { key: "time", label: "時間(ms)", type: "num", def: "500" },
      { key: "wait", label: "完了を待つ", type: "bool", def: "true" },
      { key: "reflect", label: "反転", type: "bool", def: "false" },
    ],
  },
  chara_hide: {
    label: "キャラクター退場",
    fields: [
      { key: "name", label: "名前", type: "text" },
      { key: "time", label: "時間(ms)", type: "num", def: "500" },
      { key: "wait", label: "完了を待つ", type: "bool", def: "false" },
    ],
  },
  chara_mod: {
    label: "キャラクター変更",
    fields: [
      { key: "name", label: "名前", type: "text" },
      { key: "storage", label: "画像", type: "image", dir: "fgimage" },
      { key: "time", label: "時間(ms)", type: "num", def: "300" },
      { key: "wait", label: "完了を待つ", type: "bool", def: "true" },
    ],
  },
  chara_move: {
    label: "キャラクター移動",
    fields: [
      { key: "name", label: "名前", type: "text" },
      { key: "left", label: "左", type: "num" },
      { key: "top", label: "上", type: "num" },
      { key: "time", label: "時間(ms)", type: "num", def: "600" },
      { key: "wait", label: "完了を待つ", type: "bool", def: "true" },
      { key: "anim", label: "アニメ", type: "bool", def: "true" },
    ],
  },
  chara_hide_all: {
    label: "全員を退場",
    fields: [
      { key: "time", label: "時間(ms)", type: "num", def: "300" },
      { key: "wait", label: "完了を待つ", type: "bool", def: "false" },
    ],
  },
  chara_part: {
    label: "キャラクター差分",
    fields: [
      { key: "name", label: "名前", type: "text" },
      { key: "part", label: "パーツ", type: "text" },
      { key: "id", label: "差分ID", type: "text" },
      { key: "time", label: "時間(ms)", type: "num", def: "300" },
    ],
  },
  tatie: {
    label: "立ち絵表示・切替",
    special: "chara_catalog",
    fields: [],
  },
  playbgm: {
    label: "BGM再生",
    fields: [
      { key: "storage", label: "BGM", type: "sound", dir: "bgm" },
      { key: "volume", label: "音量(%)", type: "num", def: "100" },
      { key: "time", label: "フェード(ms)", type: "num", def: "1000" },
      { key: "loop", label: "ループ", type: "bool", def: "true" },
      { key: "fadein", label: "フェードイン", type: "bool" },
    ],
  },
  stopbgm: {
    label: "BGM停止",
    fields: [
      { key: "time", label: "フェード(ms)", type: "num", def: "1000" },
      { key: "fadeout", label: "フェードアウト", type: "bool", def: "true" },
    ],
  },
  fadeoutbgm: {
    label: "BGMフェードアウト",
    fields: [{ key: "time", label: "時間(ms)", type: "num", def: "1000" }],
  },
  playse: {
    label: "効果音再生",
    fields: [
      { key: "storage", label: "SE", type: "sound", dir: "sound" },
      { key: "volume", label: "音量(%)", type: "num", def: "100" },
      { key: "buf", label: "チャンネル", type: "select", options: SE_BUFS },
      { key: "loop", label: "ループ", type: "bool", def: "false" },
      { key: "time", label: "フェード(ms)", type: "num" },
    ],
  },
  stopse: {
    label: "効果音停止",
    fields: [
      { key: "buf", label: "チャンネル", type: "select", options: SE_BUFS },
      { key: "time", label: "フェード(ms)", type: "num", def: "500" },
    ],
  },
  wbgm: { label: "BGM待ち", fields: [] },
  wse: { label: "効果音待ち", fields: [] },
  movie: {
    label: "ムービー再生",
    fields: [
      { key: "storage", label: "動画", type: "movie" },
      { key: "skip", label: "スキップ可", type: "bool", def: "true" },
    ],
  },
  bgmovie: {
    label: "背景ムービー再生",
    fields: [
      { key: "storage", label: "動画", type: "movie" },
      { key: "loop", label: "ループ", type: "bool", def: "true" },
      { key: "mute", label: "ミュート", type: "bool", def: "false" },
    ],
  },
  stop_bgmovie: { label: "背景ムービー停止", fields: [] },
  jump: {
    label: "ジャンプ",
    fields: [
      { key: "storage", label: "ファイル", type: "scenario" },
      { key: "target", label: "ラベル", type: "label" },
      { key: "cond", label: "条件式", type: "text" },
    ],
  },
  call: {
    label: "コール",
    fields: [
      { key: "storage", label: "ファイル", type: "scenario" },
      { key: "target", label: "ラベル", type: "label" },
    ],
  },
  return: { label: "コールリターン", fields: [] },
  s: { label: "ゲーム停止", fields: [] },
  cm: { label: "改ページ", fields: [] },
  l: { label: "クリック待ち", fields: [] },
  p: { label: "改ページ待ち", fields: [] },
  er: { label: "メッセージ消去", fields: [] },
  glink: {
    label: "分岐ボタン",
    fields: [
      { key: "text", label: "表示テキスト", type: "text" },
      { key: "storage", label: "ファイル", type: "scenario" },
      { key: "target", label: "ラベル", type: "label" },
      { key: "x", label: "X", type: "num", def: "160" },
      { key: "y", label: "Y", type: "num", def: "200" },
      { key: "width", label: "幅", type: "num", def: "700" },
      { key: "size", label: "文字サイズ", type: "num" },
      { key: "color", label: "カラー", type: "text" },
      { key: "autopos", label: "自動配置", type: "bool", def: "true" },
    ],
  },
  tb_show_message_window: { label: "メッセージ枠表示", fields: [] },
  tb_hide_message_window: { label: "メッセージ枠消去", fields: [] },
  hidemessage: { label: "背景を表示", fields: [] },
  delay: {
    label: "テキスト速度",
    fields: [{ key: "speed", label: "速度(ms/文字)", type: "num", def: "30" }],
  },
  textspeed: {
    label: "テキスト速度",
    fields: [{ key: "val", label: "速度(ms/文字)", type: "num", def: "30" }],
  },
  font: {
    label: "フォント",
    fields: [
      { key: "size", label: "サイズ", type: "num" },
      { key: "color", label: "色", type: "color" },
      { key: "face", label: "フォント名", type: "text" },
      { key: "bold", label: "太字", type: "bool" },
      { key: "italic", label: "斜体", type: "bool" },
    ],
  },
  resetfont: { label: "フォントリセット", fields: [] },
  tb_fuki_start: {
    label: "ふきだし開始",
    fields: [{ key: "name", label: "キャラ名", type: "text" }],
  },
  tb_fuki_stop: { label: "ふきだし終了", fields: [] },
  tb_eval: {
    label: "変数設定",
    fields: [
      { key: "name", label: "変数名", type: "text" },
      { key: "val", label: "値", type: "text" },
      { key: "exp", label: "式(上級)", type: "text" },
    ],
  },
  eval: {
    label: "変数設定",
    fields: [{ key: "exp", label: "式", type: "text" }],
  },
  edit: {
    label: "テキスト入力",
    fields: [
      { key: "name", label: "変数名", type: "text" },
      { key: "initial", label: "初期値", type: "text" },
      { key: "x", label: "X", type: "num" },
      { key: "y", label: "Y", type: "num" },
      { key: "width", label: "幅", type: "num", def: "400" },
    ],
  },
  commit: { label: "入力コミット", fields: [] },
  save_img: {
    label: "セーブキャプチャ",
    fields: [{ key: "storage", label: "画像", type: "image", dir: "image" }],
  },
  tb_cg: {
    label: "CG開放",
    fields: [{ key: "storage", label: "CG画像", type: "image", dir: "image" }],
  },
  tb_replay_start: {
    label: "回想スタート",
    fields: [{ key: "name", label: "回想名", type: "text" }],
  },
  tb_replay: { label: "回想エンド", fields: [] },
  tb_keyconfig: { label: "キーコンフィグ", fields: [] },
  cursor: {
    label: "カーソル変更",
    fields: [{ key: "storage", label: "画像", type: "image", dir: "image" }],
  },
  tb_start_text: {
    label: "テキスト開始",
    fields: [{ key: "mode", label: "モード", type: "select", options: ["1", "2", "3", "4"] }],
  },
  _tb_end_text: { label: "テキスト終了", fields: [] },
  layopt: {
    label: "レイヤ設定",
    fields: [
      { key: "layer", label: "レイヤ", type: "text", def: "message0" },
      { key: "visible", label: "表示", type: "bool", def: "true" },
      { key: "opacity", label: "不透明度", type: "num" },
    ],
  },
  if: { label: "条件分岐", fields: [{ key: "exp", label: "式", type: "text" }] },
  elsif: { label: "条件分岐(elsif)", fields: [{ key: "exp", label: "式", type: "text" }] },
  else: { label: "条件分岐(else)", fields: [] },
  endif: { label: "分岐終了", fields: [] },
};

/* パレット項目。make は挿入する ks 行を返す */
function tagLine(name, attrs = {}) {
  const parts = Object.entries(attrs)
    .filter(([, value]) => value !== "" && value != null)
    .map(([key, value]) => `${key}="${value}"`);
  return `[${name}${parts.length ? " " + parts.join(" ") : ""}]`;
}

const PALETTE_COMPONENTS = [
  // ストーリー
  {
    id: "tb_start_text", catId: "scenario", label: "テキスト", icon: "T",
    make: () => "[tb_start_text mode=1 ]\n#\nテキストを入力[p]\n[_tb_end_text]",
    selectOffset: 2, editAfter: true,
  },
  { id: "cm", catId: "scenario", label: "改ページ", icon: "改", make: () => "[cm]" },
  {
    id: "label", catId: "scenario", label: "ラベル", icon: "＊",
    make: (ctx) => `*${ctx.nextLabelName()}`,
  },
  {
    id: "glink", catId: "scenario", label: "分岐ボタン", icon: "分",
    make: (ctx) => tagLine("glink", { color: "black", storage: ctx.currentFile(), target: "*ラベル名", text: "選択肢", x: 160, y: 200, width: 700, autopos: "true" }),
  },
  { id: "jump", catId: "scenario", label: "ジャンプ", icon: "→", make: (ctx) => tagLine("jump", { storage: ctx.currentFile(), target: "" }) },
  { id: "call", catId: "scenario", label: "コール", icon: "呼", make: (ctx) => tagLine("call", { storage: ctx.currentFile(), target: "" }) },
  { id: "return", catId: "scenario", label: "コールリターン", icon: "戻", make: () => "[return]" },
  { id: "s", catId: "scenario", label: "ゲーム停止", icon: "■", make: () => "[s]" },

  // 演出
  { id: "wait", catId: "text", label: "ウェイト", icon: "待", make: () => tagLine("wait", { time: 1000 }) },
  { id: "quake", catId: "text", label: "クエイク", icon: "揺", make: () => tagLine("quake", { time: 600, hmax: 0, vmax: 30 }) },
  { id: "tb_ptext_show", catId: "text", label: "テキスト配置", icon: "配", make: () => tagLine("tb_ptext_show", { text: "テキスト", x: 100, y: 100, size: 26, color: "0xffffff", time: 500 }) },
  { id: "tb_ptext_hide", catId: "text", label: "テキスト消去", icon: "消", make: () => tagLine("tb_ptext_hide", { time: 500 }) },
  { id: "l", catId: "text", label: "クリック待ち", icon: "▼", make: () => "[l]" },

  // 画面効果
  { id: "mask", catId: "screen_effect", label: "暗転", icon: "暗", make: () => tagLine("mask", { time: 1000, effect: "fadeIn", color: "0x000000" }) },
  { id: "mask_off", catId: "screen_effect", label: "暗転を解除", icon: "明", make: () => tagLine("mask_off", { time: 1000, effect: "fadeOut" }) },
  { id: "layermode", catId: "screen_effect", label: "イメージ合成", icon: "合", make: () => tagLine("layermode", { storage: "", x: 0, y: 0, opacity: 255, time: 1000 }) },
  { id: "layermode_movie", catId: "screen_effect", label: "ムービー合成", icon: "動", make: () => tagLine("layermode_movie", { video: "", time: 1000 }) },
  { id: "free_layermode", catId: "screen_effect", label: "合成を解除", icon: "解", make: () => tagLine("free_layermode", { time: 1000 }) },

  // キャラクター
  { id: "tatie", catId: "character", label: "立ち絵表示・切替", icon: "立", special: "chara_catalog" },
  { id: "chara_show", catId: "character", label: "キャラクター登場", icon: "登", make: () => tagLine("chara_show", { name: "", time: 500, wait: "true" }) },
  { id: "chara_mod", catId: "character", label: "キャラクター変更", icon: "変", make: () => tagLine("chara_mod", { name: "", time: 300 }) },
  { id: "chara_move", catId: "character", label: "キャラクター移動", icon: "移", make: () => tagLine("chara_move", { name: "", left: 0, top: 0, time: 600 }) },
  { id: "chara_hide", catId: "character", label: "キャラクター退場", icon: "退", make: (ctx) => tagLine("chara_hide", { name: ctx.defaultCharaName(), time: 300, wait: "false" }) },
  { id: "chara_hide_all", catId: "character", label: "全員を退場", icon: "全", make: () => tagLine("chara_hide_all", { time: 300, wait: "false" }) },
  { id: "chara_part", catId: "character", label: "キャラクター差分", icon: "差", make: () => tagLine("chara_part", { name: "", part: "", id: "" }) },

  // 背景・画像
  { id: "bg", catId: "image", label: "背景変更", icon: "背", make: (ctx) => tagLine("bg", { time: 1000, method: "crossfade", storage: ctx.selectedAssetFor("bgimage") || "black.jpg" }) },
  { id: "tb_image_show", catId: "image", label: "イメージ表示", icon: "画", make: () => tagLine("tb_image_show", { storage: "", x: 0, y: 0, time: 500, layer: 1 }) },
  { id: "tb_image_hide", catId: "image", label: "イメージ消去", icon: "消", make: () => tagLine("tb_image_hide", { time: 500 }) },
  { id: "clickable", catId: "image", label: "クリッカブルマップ", icon: "図", make: () => tagLine("clickable", { storage: "", map: "" }) },
  { id: "button", catId: "image", label: "画像ボタン", icon: "釦", make: (ctx) => tagLine("button", { graphic: "", x: 0, y: 0, target: "", storage: ctx.currentFile() }) },

  // メッセージ
  { id: "tb_show_message_window", catId: "effect", label: "メッセージ枠表示", icon: "枠", make: () => "[tb_show_message_window]" },
  { id: "tb_hide_message_window", catId: "effect", label: "メッセージ枠消去", icon: "枠", make: () => "[tb_hide_message_window]" },
  { id: "hidemessage", catId: "effect", label: "背景を表示", icon: "背", make: () => "[hidemessage]" },
  { id: "delay", catId: "effect", label: "テキスト速度", icon: "速", make: () => tagLine("delay", { speed: 30 }) },
  { id: "font", catId: "effect", label: "フォント", icon: "F", make: () => tagLine("font", { size: 24 }) },
  { id: "resetfont", catId: "effect", label: "フォントリセット", icon: "R", make: () => "[resetfont]" },
  { id: "tb_fuki_start", catId: "effect", label: "ふきだし開始", icon: "吹", make: () => tagLine("tb_fuki_start", { name: "" }) },
  { id: "tb_fuki_stop", catId: "effect", label: "ふきだし終了", icon: "吹", make: () => "[tb_fuki_stop]" },

  // メディア
  { id: "playbgm", catId: "media", label: "BGM再生", icon: "♪", make: (ctx) => tagLine("playbgm", { volume: 100, time: 1000, loop: "true", storage: ctx.selectedAssetFor("bgm") }) },
  { id: "stopbgm", catId: "media", label: "BGM停止", icon: "止", make: () => tagLine("stopbgm", { time: 1000, fadeout: "true" }) },
  { id: "playse", catId: "media", label: "効果音再生", icon: "SE", make: (ctx) => tagLine("playse", { volume: 100, buf: 0, storage: ctx.selectedAssetFor("sound") }) },
  { id: "stopse", catId: "media", label: "効果音停止", icon: "止", make: () => tagLine("stopse", { time: 500, buf: 0 }) },
  { id: "wbgm", catId: "media", label: "BGM待ち", icon: "待", make: () => "[wbgm]" },
  { id: "wse", catId: "media", label: "効果音待ち", icon: "待", make: () => "[wse]" },
  { id: "movie", catId: "media", label: "ムービー再生", icon: "映", make: () => tagLine("movie", { storage: "", skip: "true" }) },
  { id: "bgmovie", catId: "media", label: "背景ムービー", icon: "背", make: () => tagLine("bgmovie", { storage: "", loop: "true" }) },
  { id: "stop_bgmovie", catId: "media", label: "背景ムービー停止", icon: "止", make: () => "[stop_bgmovie]" },

  // システム
  { id: "tb_eval", catId: "eval", label: "変数設定", icon: "変", make: () => tagLine("eval", { exp: "f.flag = 1" }) },
  { id: "edit", catId: "eval", label: "テキスト入力", icon: "入", make: () => tagLine("edit", { name: "f.name", initial: "", x: 100, y: 100, width: 400 }) },
  { id: "commit", catId: "eval", label: "入力コミット", icon: "済", make: () => "[commit]" },
  { id: "save_img", catId: "eval", label: "セーブキャプチャ", icon: "撮", make: () => tagLine("save_img", { storage: "" }) },
  { id: "tb_cg", catId: "eval", label: "CG開放", icon: "CG", make: () => tagLine("tb_cg", { storage: "" }) },
  { id: "tb_replay_start", catId: "eval", label: "回想スタート", icon: "回", make: () => tagLine("tb_replay_start", { name: "" }) },
  { id: "tb_replay", catId: "eval", label: "回想エンド", icon: "了", make: () => "[tb_replay]" },
  { id: "tb_keyconfig", catId: "eval", label: "キーコンフィグ", icon: "鍵", make: () => "[tb_keyconfig]" },
  { id: "cursor", catId: "eval", label: "カーソル変更", icon: "指", make: () => tagLine("cursor", { storage: "" }) },

  // スクリプト
  {
    id: "iscript", catId: "script", label: "JavaScript", icon: "JS",
    make: () => "[iscript]\n// JavaScript を記述\n[endscript]", selectOffset: 1, editAfter: true,
  },
  {
    id: "tyrano_code", catId: "script", label: "ティラノスクリプト", icon: "TS",
    make: () => "; ティラノスクリプトを記述", editAfter: true,
  },
];

/* タイムライン表示用: タグ → カテゴリ色 */
const TAG_CATEGORY = {};
PALETTE_COMPONENTS.forEach((component) => {
  const category = CATEGORIES.find((cat) => cat.id === component.catId);
  if (category) TAG_CATEGORY[component.id] = category.cat;
});
Object.assign(TAG_CATEGORY, {
  text: "story", p: "story", ct: "story", er: "message",
  tb_start_text: "story", _tb_end_text: "story", tb_start_tyrano_code: "script", _tb_end_tyrano_code: "script",
  if: "system", elsif: "system", else: "system", endif: "system",
  iscript: "script", endscript: "script",
  image: "media", freeimage: "media",
  fadeoutbgm: "sound", fadeinbgm: "sound",
  textspeed: "message", layopt: "message", position: "message", ptext: "message", mtext: "message",
  tatie: "chara", chara_ptext: "chara", chara_config: "chara", chara_new: "chara", chara_face: "chara",
  wait_camera: "screen", camera: "screen", reset_camera: "screen", trans: "screen", wt: "screen",
  tb_show_message_window: "message", tb_hide_message_window: "message", hidemessage: "message",
});

const TAG_LABELS = {};
Object.entries(TAG_SCHEMAS).forEach(([name, schema]) => {
  TAG_LABELS[name] = schema.label;
});
Object.assign(TAG_LABELS, {
  text: "本文", p: "改ページ", ct: "改ページ", er: "消去",
  tb_start_text: "テキスト開始", _tb_end_text: "テキスト終了",
  tb_start_tyrano_code: "コード開始", _tb_end_tyrano_code: "コード終了",
  iscript: "スクリプト", endscript: "スクリプト終",
  image: "画像", freeimage: "画像消去", fadeoutbgm: "BGM停止", fadeinbgm: "BGM再生",
  chara_ptext: "話者表示", position: "メッセージ枠", ptext: "テキスト配置",
});
