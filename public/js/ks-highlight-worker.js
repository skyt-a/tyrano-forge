"use strict";

// ks-highlight.js の診断パーサを Worker でもそのまま使う。CodeMirror側が
// 構文色を担当するので、WorkerはHTMLや全行描画キャッシュを生成しない。
self.escapeHtml = function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

// TAG_CATEGORY もメイン画面と一致させ、Worker 化の前後で色分類を変えない。
// Worker 自身の URL を基準にしておけば、ポートや配信プレフィックスにも依存しない。
importScripts("schema.js", "ks-highlight.js");

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "highlight") return;
  try {
    const result = ksDiagnoseDocument(String(data.text ?? ""));
    self.postMessage({
      type: "highlight-result",
      generation: data.generation,
      diagnostics: result.diagnostics,
      tooLarge: result.tooLarge,
    });
  } catch (error) {
    self.postMessage({
      type: "highlight-error",
      generation: data.generation,
      error: error && error.message ? error.message : String(error),
    });
  }
});
