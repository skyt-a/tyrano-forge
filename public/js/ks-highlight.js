"use strict";

/* ============================================================
   KS syntax highlight + live diagnostics (raw code view)
   lib/ks-parser.js と同じ規則でクライアント側でも走査する
   ============================================================ */

const KS_HIGHLIGHT_MAX_LINES = 20000;
const KS_RAW_LINE_HEIGHT = 20; // app.css の #rawEditor line-height と一致させる

/* lib/ks-parser.js の findClosingBracket と同一ロジック */
function ksFindClosingBracket(line, start) {
  let quote = "";
  let escaped = false;
  let depth = 0;
  for (let i = start; i < line.length; i += 1) {
    const ch = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "[") {
      depth += 1;
      continue;
    }
    if (ch === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/* タグ内側（[ ] を除いた部分）をトークナイズして HTML と先頭タグ名を返す */
function ksTagInnerHtml(inner, lineNumber, diagnostics) {
  const len = inner.length;
  const out = [];
  let i = 0;
  while (i < len && /\s/.test(inner[i])) i += 1;
  out.push(escapeHtml(inner.slice(0, i)));
  const nameStart = i;
  while (i < len && !/\s/.test(inner[i])) i += 1;
  const name = inner.slice(nameStart, i);
  const category = typeof TAG_CATEGORY !== "undefined" ? TAG_CATEGORY[name] : "";
  out.push(`<span class="ks-tagname${category ? ` ks-cat-${category}` : ""}">${escapeHtml(name)}</span>`);

  while (i < len) {
    let ws = i;
    while (i < len && /\s/.test(inner[i])) i += 1;
    out.push(escapeHtml(inner.slice(ws, i)));
    if (i >= len) break;

    const attrStart = i;
    while (i < len && !/\s|=/.test(inner[i])) i += 1;
    if (i === attrStart) {
      out.push(`<span class="ks-op">${escapeHtml(inner[i])}</span>`);
      i += 1;
      continue;
    }
    const attrName = inner.slice(attrStart, i);
    out.push(`<span class="ks-attr">${escapeHtml(attrName)}</span>`);

    ws = i;
    while (i < len && /\s/.test(inner[i])) i += 1;
    if (inner[i] !== "=") {
      out.push(escapeHtml(inner.slice(ws, i)));
      continue;
    }
    out.push(`${escapeHtml(inner.slice(ws, i))}<span class="ks-op">=</span>`);
    i += 1;
    ws = i;
    while (i < len && /\s/.test(inner[i])) i += 1;
    out.push(escapeHtml(inner.slice(ws, i)));

    const quote = inner[i];
    if (quote === "\"" || quote === "'" || quote === "`") {
      const valueStart = i;
      i += 1;
      let escaped = false;
      let closed = false;
      while (i < len) {
        const ch = inner[i];
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === quote) {
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      out.push(`<span class="ks-value${closed ? "" : " ks-error-token"}">${escapeHtml(inner.slice(valueStart, i))}</span>`);
      if (!closed && diagnostics) {
        diagnostics.push({
          severity: "error",
          line: lineNumber,
          message: `属性 ${attrName} の引用符（${quote}）が閉じていません`,
        });
      }
    } else {
      const valueStart = i;
      while (i < len && !/\s/.test(inner[i])) i += 1;
      out.push(`<span class="ks-value">${escapeHtml(inner.slice(valueStart, i))}</span>`);
    }
  }
  return { html: out.join(""), name };
}

/* parseScenario と同じ順序でタグの状態遷移を反映する */
function ksApplyTagEffects(name, index, ctx, diagnostics) {
  if (name === "iscript") ctx.inScript = true;
  if (name === "endscript") ctx.inScript = false;
  if (!ctx.inScript) {
    if (name === "if") ctx.ifDepth += 1;
    if (name === "endif") {
      ctx.ifDepth -= 1;
      if (ctx.ifDepth < 0) {
        diagnostics.push({ severity: "error", line: index, message: "対応する [if] のない [endif] です" });
        ctx.ifDepth = 0;
      }
    }
  }
  if (name === "tb_start_text") ctx.tbOpenLine = index;
  if (name === "_tb_end_text") ctx.tbOpenLine = -1;
}

function ksLineHtml(line, index, ctx, diagnostics) {
  const trimmed = line.trim();
  if (ctx.inComment) {
    if (trimmed === "*/") ctx.inComment = false;
    return `<span class="ks-comment">${escapeHtml(line)}</span>`;
  }
  if (ctx.inScript && !/^(?:\[\s*endscript\s*\]|@\s*endscript\b)/.test(trimmed)) {
    return `<span class="ks-script">${escapeHtml(line)}</span>`;
  }
  if (!trimmed) return escapeHtml(line);
  if (trimmed.startsWith(";") || trimmed === "*/") {
    return `<span class="ks-comment">${escapeHtml(line)}</span>`;
  }
  if (trimmed === "/*") {
    ctx.inComment = true;
    return `<span class="ks-comment">${escapeHtml(line)}</span>`;
  }
  if (trimmed.startsWith("#")) {
    return `<span class="ks-speaker">${escapeHtml(line)}</span>`;
  }
  if (trimmed.startsWith("*")) {
    const labelText = trimmed.slice(1);
    const separator = labelText.indexOf("|");
    const name = (separator >= 0 ? labelText.slice(0, separator) : labelText).trim();
    if (name) {
      if (ctx.labels.has(name)) {
        diagnostics.push({ severity: "warning", line: index, message: `ラベル名が重複しています: *${name}` });
      }
      ctx.labels.add(name);
    }
    return `<span class="ks-label">${escapeHtml(line)}</span>`;
  }
  if (trimmed.startsWith("@")) {
    const at = line.indexOf("@");
    const inner = ksTagInnerHtml(line.slice(at + 1), index, diagnostics);
    ksApplyTagEffects(inner.name, index, ctx, diagnostics);
    return `${escapeHtml(line.slice(0, at))}<span class="ks-bracket">@</span>${inner.html}`;
  }

  // 本文 + インラインタグ
  const out = [];
  let textStart = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== "[") continue;
    const close = ksFindClosingBracket(line, i);
    if (close === -1) {
      diagnostics.push({ severity: "error", line: index, message: "閉じ ] がありません" });
      if (i > textStart) out.push(`<span class="ks-text">${escapeHtml(line.slice(textStart, i))}</span>`);
      out.push(`<span class="ks-error-token">${escapeHtml(line.slice(i))}</span>`);
      textStart = line.length;
      break;
    }
    if (i > textStart) out.push(`<span class="ks-text">${escapeHtml(line.slice(textStart, i))}</span>`);
    const inner = ksTagInnerHtml(line.slice(i + 1, close), index, diagnostics);
    ksApplyTagEffects(inner.name, index, ctx, diagnostics);
    out.push(`<span class="ks-bracket">[</span>${inner.html}<span class="ks-bracket">]</span>`);
    i = close;
    textStart = close + 1;
  }
  if (textStart < line.length) {
    out.push(`<span class="ks-text">${escapeHtml(line.slice(textStart))}</span>`);
  }
  return out.join("");
}

function ksHighlightDocument(text) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  rawHoverLines = lines;
  const htmlLines = [];
  const diagnostics = [];
  // 各行の開始時点のコメント/スクリプト状態。可視範囲だけを再ハイライトする際、
  // その行の正しい文脈から再開するために使う。
  const ctxByLine = [];
  const tooLarge = lines.length > KS_HIGHLIGHT_MAX_LINES;
  const ctx = { inComment: false, inScript: false, ifDepth: 0, labels: new Set(), tbOpenLine: -1 };
  for (let index = 0; index < lines.length; index += 1) {
    ctxByLine.push({ inComment: ctx.inComment, inScript: ctx.inScript });
    htmlLines.push(tooLarge ? escapeHtml(lines[index]) : ksLineHtml(lines[index], index, ctx, diagnostics));
  }
  if (!tooLarge) {
    const last = lines.length - 1;
    if (ctx.inComment) diagnostics.push({ severity: "error", line: last, message: "/* ブロックコメントが閉じていません" });
    if (ctx.inScript) diagnostics.push({ severity: "error", line: last, message: "[iscript] が [endscript] で閉じていません" });
    if (ctx.ifDepth > 0) diagnostics.push({ severity: "error", line: last, message: "[if] と [endif] の対応が取れていません" });
    if (ctx.tbOpenLine >= 0) diagnostics.push({ severity: "warning", line: ctx.tbOpenLine, message: "[tb_start_text] が閉じていません" });
  }
  return { htmlLines, diagnostics, tooLarge, ctxByLine, lines };
}

// CodeMirrorは構文色を増分解析するため、Worker側ではHTMLを生成せず診断だけを
// 走査する。旧overlay用の文字列配列を毎回作らないので、長文でもGC負荷が残らない。
function ksDiagnoseTagInner(inner, lineNumber, diagnostics) {
  let index = 0;
  while (index < inner.length && /\s/.test(inner[index])) index += 1;
  const nameStart = index;
  while (index < inner.length && !/\s/.test(inner[index])) index += 1;
  const name = inner.slice(nameStart, index);
  while (index < inner.length) {
    while (index < inner.length && /\s/.test(inner[index])) index += 1;
    const attrStart = index;
    while (index < inner.length && !/\s|=/.test(inner[index])) index += 1;
    if (index === attrStart) {
      index += 1;
      continue;
    }
    const attrName = inner.slice(attrStart, index);
    while (index < inner.length && /\s/.test(inner[index])) index += 1;
    if (inner[index] !== "=") continue;
    index += 1;
    while (index < inner.length && /\s/.test(inner[index])) index += 1;
    const quote = inner[index];
    if (quote !== "\"" && quote !== "'" && quote !== "`") {
      while (index < inner.length && !/\s/.test(inner[index])) index += 1;
      continue;
    }
    index += 1;
    let escaped = false;
    let closed = false;
    while (index < inner.length) {
      const character = inner[index];
      index += 1;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        closed = true;
        break;
      }
    }
    if (!closed) {
      diagnostics.push({
        severity: "error",
        line: lineNumber,
        message: `属性 ${attrName} の引用符（${quote}）が閉じていません`,
      });
    }
  }
  return name;
}

function ksDiagnoseLine(line, index, ctx, diagnostics) {
  const trimmed = line.trim();
  if (ctx.inComment) {
    if (trimmed === "*/") ctx.inComment = false;
    return;
  }
  if (ctx.inScript && !/^(?:\[\s*endscript\s*\]|@\s*endscript\b)/.test(trimmed)) return;
  if (!trimmed || trimmed.startsWith(";") || trimmed === "*/" || trimmed.startsWith("#")) return;
  if (trimmed === "/*") {
    ctx.inComment = true;
    return;
  }
  if (trimmed.startsWith("*")) {
    const labelText = trimmed.slice(1);
    const separator = labelText.indexOf("|");
    const name = (separator >= 0 ? labelText.slice(0, separator) : labelText).trim();
    if (!name) return;
    if (ctx.labels.has(name)) {
      diagnostics.push({ severity: "warning", line: index, message: `ラベル名が重複しています: *${name}` });
    }
    ctx.labels.add(name);
    return;
  }
  if (trimmed.startsWith("@")) {
    const name = ksDiagnoseTagInner(line.slice(line.indexOf("@") + 1), index, diagnostics);
    ksApplyTagEffects(name, index, ctx, diagnostics);
    return;
  }
  for (let offset = 0; offset < line.length; offset += 1) {
    if (line[offset] !== "[") continue;
    const close = ksFindClosingBracket(line, offset);
    if (close === -1) {
      diagnostics.push({ severity: "error", line: index, message: "閉じ ] がありません" });
      return;
    }
    const name = ksDiagnoseTagInner(line.slice(offset + 1, close), index, diagnostics);
    ksApplyTagEffects(name, index, ctx, diagnostics);
    offset = close;
  }
}

function ksDiagnoseDocument(text) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const tooLarge = lines.length > KS_HIGHLIGHT_MAX_LINES;
  const diagnostics = [];
  if (tooLarge) return { diagnostics, tooLarge };
  const ctx = { inComment: false, inScript: false, ifDepth: 0, labels: new Set(), tbOpenLine: -1 };
  for (let index = 0; index < lines.length; index += 1) {
    ksDiagnoseLine(lines[index], index, ctx, diagnostics);
  }
  const last = lines.length - 1;
  if (ctx.inComment) diagnostics.push({ severity: "error", line: last, message: "/* ブロックコメントが閉じていません" });
  if (ctx.inScript) diagnostics.push({ severity: "error", line: last, message: "[iscript] が [endscript] で閉じていません" });
  if (ctx.ifDepth > 0) diagnostics.push({ severity: "error", line: last, message: "[if] と [endif] の対応が取れていません" });
  if (ctx.tbOpenLine >= 0) diagnostics.push({ severity: "warning", line: ctx.tbOpenLine, message: "[tb_start_text] が閉じていません" });
  return { diagnostics, tooLarge };
}

/* ---------- rendering ---------- */

let rawHighlightRaf = 0;
let rawWindowRaf = 0;
let rawDiagnostics = [];
let rawActiveLine = -1;
// 全行のハイライト済み HTML はキャッシュし、DOM には可視範囲だけを描く
// （数千行のファイルで毎入力ごとに全 DOM を作り直すのを避ける仮想化）。
let rawHtmlLines = [];
let rawCtxByLine = [];
let rawReparseTimer = 0;
let rawHighlightGeneration = 0;
let rawHighlightWorker = null;
let rawHighlightWorkerBusy = false;
let rawHighlightWorkerActive = null;
let rawHighlightWorkerPending = null;
let rawHighlightWorkerFailed = false;
let rawHighlightWorkerFailureCount = 0;
let rawHighlightWorkerDisabled = false;
let rawHighlightCacheFile = "";
let rawHighlightedRevision = -1;
// CodeMirrorのIME composition中は保存・診断更新だけを確定まで保留する。
let rawEditorComposing = false;
let rawCompositionDirty = false;
let rawCompositionCommitPending = false;
let rawCompositionFlushRaf = 0;
// textarea の現在値に対応する行頭文字 offset。カーソル行・補完位置・ジャンプが
// 同じ入力値に対して何度も先頭走査しないよう、全呼び出しで共有する。
let rawLineIndexText = null;
const rawLineStartOffsets = [0];
// 直近スクロール時に確定した可視行範囲。入力時はこれを使い回し、
// editor.scrollTop 等の geometry を読まない（テキスト変更直後の geometry 読みは
// 巨大 textarea の同期レイアウトを強制し、打鍵が重くなるため）。
let rawWinFirst = 0;
let rawWinLast = 0;
let rawDiagClassByLine = new Map();
let rawMsgByLine = new Map();
const RAW_WINDOW_BUFFER = 16; // 可視範囲の上下に余分に描く行数
const RAW_REPARSE_DELAY = 220; // 入力停止後に全文を再解析するまでの待ち(ms)

function ksSeverityRank(severity) {
  return severity === "error" ? 2 : 1;
}

function scheduleRawHighlight() {
  // value の変更を即座に世代へ反映し、実行中 Worker の古い結果をこの時点から
  // 適用不可にする。rAF 自体は1件にまとめ、実行時点の最新版だけを送る。
  rawHighlightGeneration += 1;
  if (rawHighlightRaf) return;
  rawHighlightRaf = requestAnimationFrame(() => {
    rawHighlightRaf = 0;
    renderRawHighlight({ generation: rawHighlightGeneration });
  });
}

// 直近に全文ハイライトを完了したテキスト。ビュー切り替えのたびに全文を
// 解析し直さないための同一性チェックに使う（内容一致なら再解析不要）。
let rawHighlightedText = null;

function rawDocumentLineCount(value) {
  return rawLineStartsFor(value).length;
}

// 新しいファイルを開いた直後も Worker の完了を待たず可視窓を描けるよう、
// 行数ぶんの疎なキャッシュだけを先に用意する。全文 split / token 化はしない。
function ensureRawHighlightCache(value) {
  const file = state.currentFile || "";
  if (rawHighlightCacheFile === file && rawHtmlLines.length && rawCtxByLine.length) return;
  const total = rawDocumentLineCount(value);
  rawHighlightCacheFile = file;
  rawHighlightedText = null;
  rawHtmlLines = new Array(total);
  rawCtxByLine = new Array(total);
  rawHoverLines = new Array(total);
  rawDiagnostics = [];
  rawDiagClassByLine = new Map();
  rawMsgByLine = new Map();
  rawDiagBarKey = null;
  renderRawDiagBar(false);
}

function applyRawHighlightResult(job, result) {
  const editor = $("#rawEditor");
  const documentChanged = editor?._ksCodeMirror
    ? editor._ksCodeMirror.revision !== job.revision
    : editor?.value !== job.text;
  if (
    !editor ||
    job.generation !== rawHighlightGeneration ||
    job.file !== state.currentFile ||
    documentChanged
  ) {
    return;
  }
  if (editor._ksCodeMirror) {
    rawHighlightCacheFile = job.file;
    rawHighlightedText = job.text;
    rawHighlightedRevision = job.revision;
    rawDiagnostics = result.diagnostics || [];
    rawDiagClassByLine = new Map();
    rawMsgByLine = new Map();
    const severity = new Map();
    rawDiagnostics.forEach((item) => {
      const previous = severity.get(item.line);
      if (!previous || ksSeverityRank(item.severity) > ksSeverityRank(previous)) {
        severity.set(item.line, item.severity);
      }
      rawMsgByLine.set(item.line, [...(rawMsgByLine.get(item.line) || []), item.message]);
    });
    severity.forEach((sev, line) => rawDiagClassByLine.set(line, sev === "error" ? " diag-e" : " diag-w"));
    editor._ksCodeMirror.setDiagnostics(rawDiagnostics);
    renderRawDiagBar(Boolean(result.tooLarge));
    return;
  }
  rawHighlightCacheFile = job.file;
  rawHighlightedText = job.text;
  rawHighlightedRevision = -1;
  rawHtmlLines = result.htmlLines || [];
  rawCtxByLine = result.ctxByLine || [];
  rawHoverLines = result.lines || [];
  rawDiagnostics = result.diagnostics || [];
  rawDiagClassByLine = new Map();
  rawMsgByLine = new Map();
  const severity = new Map();
  rawDiagnostics.forEach((item) => {
    const previous = severity.get(item.line);
    if (!previous || ksSeverityRank(item.severity) > ksSeverityRank(previous)) {
      severity.set(item.line, item.severity);
    }
    rawMsgByLine.set(item.line, [...(rawMsgByLine.get(item.line) || []), item.message]);
  });
  severity.forEach((sev, line) => rawDiagClassByLine.set(line, sev === "error" ? " diag-e" : " diag-w"));
  renderRawDiagBar(Boolean(result.tooLarge));
  // geometry は読まずキャッシュ済みの可視範囲で描画する（改行追加など行数が
  // 変わったときの全解析でも textarea の同期レイアウトを強制しないため）。
  // 可視範囲そのものはスクロール／リサイズ／ビュー表示時に更新される。
  paintRawWindow();
}

function runRawHighlightSyncFallback(job) {
  if (job.generation !== rawHighlightGeneration) return;
  const editor = $("#rawEditor");
  const documentChanged = editor?._ksCodeMirror
    ? editor._ksCodeMirror.revision !== job.revision
    : editor?.value !== job.text;
  if (!editor || documentChanged || state.currentFile !== job.file) return;
  // Worker を生成できない、または実行時エラーになった環境だけの退避経路。
  // 通常動作では全文解析をメインスレッドへ戻さない。
  applyRawHighlightResult(job, ksHighlightDocument(job.text));
}

function failRawHighlightWorker(error, failedJob = null) {
  if (rawHighlightWorkerFailed) return;
  rawHighlightWorkerFailed = true;
  rawHighlightWorkerFailureCount += 1;
  if (error) console.warn("KS highlight Worker failed", error);
  const active = rawHighlightWorkerActive;
  const pending = rawHighlightWorkerPending;
  try {
    rawHighlightWorker?.terminate();
  } catch (terminateError) {}
  rawHighlightWorker = null;
  rawHighlightWorkerBusy = false;
  rawHighlightWorkerActive = null;
  rawHighlightWorkerPending = null;
  const latest = pending?.generation === rawHighlightGeneration
    ? pending
    : active?.generation === rawHighlightGeneration
      ? active
      : failedJob;
  // 障害1回につき同期fallbackは最大1回。以後の打鍵ごとに全文解析へ戻さない。
  if (latest?.generation === rawHighlightGeneration) {
    try {
      runRawHighlightSyncFallback(latest);
    } catch (fallbackError) {
      // Worker と同じ全文parserが決定的に失敗した場合は再試行ループへ戻さず、
      // 可視範囲だけの軽量表示へ確実に退避する。
      console.warn("KS highlight fallback failed", fallbackError);
      rawHighlightWorkerDisabled = true;
      rawHighlightWorkerPending = null;
      renderRawDiagBar(true);
      renderRawHighlightWindow();
      return;
    }
  }
  if (rawHighlightWorkerFailureCount < 2) {
    // 一過性のworker crashは1回だけ再生成を許す。
    setTimeout(() => {
      rawHighlightWorkerFailed = false;
      const retry = rawHighlightWorkerPending;
      rawHighlightWorkerPending = null;
      if (retry && retry.generation === rawHighlightGeneration) {
        startRawHighlightWorkerJob(retry);
      }
    }, 0);
  } else {
    rawHighlightWorkerDisabled = true;
    renderRawDiagBar(true);
  }
}

function startRawHighlightWorkerJob(job) {
  if (rawHighlightWorkerDisabled) {
    // 可視窓の軽量同期highlightだけを維持し、全文同期parseは行わない。
    renderRawHighlightWindow();
    return;
  }
  if (rawHighlightWorkerFailed) {
    rawHighlightWorkerPending = job;
    return;
  }
  if (!rawHighlightWorker) {
    try {
      rawHighlightWorker = new Worker("/js/ks-highlight-worker.js");
      rawHighlightWorker.addEventListener("message", (event) => {
        const data = event.data || {};
        if (data.type === "highlight-error") {
          failRawHighlightWorker(new Error(data.error || "KS highlight Worker error"));
          return;
        }
        if (data.type !== "highlight-result") return;
        const finished = rawHighlightWorkerActive;
        rawHighlightWorkerBusy = false;
        rawHighlightWorkerActive = null;
        rawHighlightWorkerFailureCount = 0;
        rawHighlightWorkerFailed = false;
        if (finished && data.generation === finished.generation) {
          applyRawHighlightResult(finished, data);
        }
        const next = rawHighlightWorkerPending;
        rawHighlightWorkerPending = null;
        if (next && next.generation === rawHighlightGeneration) startRawHighlightWorkerJob(next);
      });
      rawHighlightWorker.addEventListener("error", (event) => {
        event.preventDefault();
        failRawHighlightWorker(event.error || new Error(event.message || "KS highlight Worker error"));
      });
      rawHighlightWorker.addEventListener("messageerror", () => {
        failRawHighlightWorker(new Error("KS highlight Worker message could not be decoded"));
      });
    } catch (error) {
      // Worker constructor が同期失敗した場合は active がまだ設定されていないため、
      // 初回jobを明示してfallback対象から落ちないようにする。
      failRawHighlightWorker(error, job);
      return;
    }
  }
  if (rawHighlightWorkerBusy) {
    // 解析中に要求が来てもキューを増やさず、未開始枠を最新1件で上書きする。
    rawHighlightWorkerPending = job;
    return;
  }
  rawHighlightWorkerBusy = true;
  rawHighlightWorkerActive = job;
  try {
    rawHighlightWorker.postMessage({
      type: "highlight",
      generation: job.generation,
      text: job.text,
    });
  } catch (error) {
    failRawHighlightWorker(error);
  }
}

// 全文解析は Worker へ送り、結果が返るまで現在の可視窓キャッシュを維持する。
function renderRawHighlight(options = {}) {
  const editor = $("#rawEditor");
  if (!editor) return;
  if (rawReparseTimer) {
    clearTimeout(rawReparseTimer);
    rawReparseTimer = 0;
  }
  const value = editor.value;
  if (!editor._ksCodeMirror) ensureRawHighlightCache(value);
  const file = state.currentFile || "";
  let generation;
  if (Number.isFinite(options.generation)) {
    generation = options.generation;
  } else {
    // view往復中、同一file/textのworker jobが既に最新版として走っているなら
    // generationを進めない。結果を毎回stale破棄→再parse/cloneする劣化を防ぐ。
    const sameLatestJob = [rawHighlightWorkerActive, rawHighlightWorkerPending].some((job) =>
      job &&
      job.generation === rawHighlightGeneration &&
      job.file === file &&
      job.text === value
    );
    if (sameLatestJob) {
      renderRawHighlightWindow();
      return;
    }
    generation = (rawHighlightGeneration += 1);
  }
  startRawHighlightWorkerJob({
    generation,
    text: value,
    file,
    revision: editor._ksCodeMirror?.revision,
  });
}

function scheduleRawWindow() {
  if (rawWindowRaf) return;
  rawWindowRaf = requestAnimationFrame(() => {
    rawWindowRaf = 0;
    renderRawWindow();
  });
}

// 挿入・削除で行番号がずれたとき、行番号をキーに持つ Map（診断マーカー）を
// 追従させる。at 以降のキーを delta ぶんずらし、削除された範囲は捨てる。
function shiftLineKeyedMap(map, at, delta) {
  if (!map.size) return map;
  const next = new Map();
  map.forEach((entry, line) => {
    if (line < at) next.set(line, entry);
    else if (delta > 0 || line >= at - delta) next.set(line + delta, entry);
  });
  return next;
}

function rawLineOffsetUpperBound(target) {
  let low = 0;
  let high = rawLineStartOffsets.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (rawLineStartOffsets[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function rebuildRawLineStarts(value) {
  rawLineStartOffsets.length = 1;
  rawLineStartOffsets[0] = 0;
  for (let index = value.indexOf("\n"); index !== -1; index = value.indexOf("\n", index + 1)) {
    rawLineStartOffsets.push(index + 1);
  }
  rawLineIndexText = value;
  return rawLineStartOffsets;
}

// value が変わったときだけ改行位置を1回走査する。同じ入力イベント内の
// 行判定・可視窓切り出し・補完位置計算はすべてこの配列を使い回す。
// 配列自体も再利用するため、毎打鍵で行数ぶんの Array を新規確保しない。
function rawLineStartsFor(input) {
  const value = String(input ?? "");
  return rawLineIndexText === value ? rawLineStartOffsets : rebuildRawLineStarts(value);
}

// caret 位置はキャッシュ済み行頭配列を二分探索する（同一 value なら O(log 行数)）。
function rawLineOfIndex(value, position) {
  rawLineStartsFor(value);
  const target = Math.max(0, Math.min(Number(position) || 0, String(value ?? "").length));
  return Math.max(0, rawLineOffsetUpperBound(target) - 1);
}

// 行番号から先頭文字 index への変換は、キャッシュ構築後は O(1)。
function rawOffsetOfLine(value, line) {
  rawLineStartsFor(value);
  const index = Math.max(0, Math.floor(Number(line) || 0));
  return index < rawLineStartOffsets.length ? rawLineStartOffsets[index] : String(value ?? "").length;
}

// 入力ごとの高速パス: 可視範囲の行だけをキャッシュ済みの開始文脈から
// 再ハイライトして即描画する（全文解析は入力停止後にまとめて行う）。
// カーソル＝編集位置は常に可視なので、可視範囲の開始行より前の文脈
// (rawCtxByLine[first]) は編集の影響を受けず、可視行は正しく色付けできる。
function renderRawHighlightWindow() {
  const editor = $("#rawEditor");
  if (!editor) return;
  if (editor._ksCodeMirror) return;
  // \r 混じり（Windows 由来の貼り付け等）はまれなのでその時だけ正規化コピー
  let value = editor.value;
  if (value.indexOf("\r") >= 0) value = value.replace(/\r\n/g, "\n");
  ensureRawHighlightCache(value);
  // 行数は共有の行頭 offset キャッシュから得る。同じ input イベント内の
  // 行判定・窓切り出しもこのキャッシュを使うため、全文走査は1回だけで済む。
  const total = rawDocumentLineCount(value);

  const delta = total - rawHtmlLines.length;
  if (delta !== 0) {
    // 行数が変わった（Enter・貼り付け・行削除）。以前はここで全文を同期
    // 再解析していて、大きいファイルだと改行のたびに固まった。編集は
    // カーソル位置で起きているので、キャッシュ（各行の HTML / 開始文脈 /
    // 診断マーカー）を編集行から delta ぶんスライドさせるだけにして、
    // 正確な全文再解析は scheduleRawReparse（入力停止後 220ms）に任せる。
    const lines = value.split("\n");
    const caretLine = rawLineOfIndex(value, Math.max(0, Number(editor.selectionStart || 0)));
    let at = delta > 0 ? Math.max(0, caretLine - delta) : caretLine;
    at = Math.max(0, Math.min(at, Math.min(rawHtmlLines.length, lines.length)));
    if (delta > 0) {
      const ctxFill = rawCtxByLine[at] || { inComment: false, inScript: false };
      // 旧可視窓の外に挿入された行も、色なしのプレーンテキストで即時表示して
      // おく（アイドル再解析で正しい色に置き換わる）
      const htmlFill = [];
      const ctxFills = [];
      for (let k = 0; k < delta; k += 1) {
        htmlFill.push(escapeHtml(lines[at + k] ?? ""));
        ctxFills.push(ctxFill);
      }
      // splice(at, 0, ...fill) は要素数が多いと引数上限に当たるため concat で組む
      rawHtmlLines = rawHtmlLines.slice(0, at).concat(htmlFill, rawHtmlLines.slice(at));
      rawCtxByLine = rawCtxByLine.slice(0, at).concat(ctxFills, rawCtxByLine.slice(at));
    } else {
      rawHtmlLines.splice(at, -delta);
      rawCtxByLine.splice(at, -delta);
    }
    rawDiagClassByLine = shiftLineKeyedMap(rawDiagClassByLine, at, delta);
    rawMsgByLine = shiftLineKeyedMap(rawMsgByLine, at, delta);
    rawHoverLines = lines;
    rehighlightRawWindow(total, (index) => lines[index]);
    return;
  }

  // 行数が変わらない打鍵: 可視窓の部分文字列だけを切り出して再ハイライトする。
  // 直近スクロールで確定した可視範囲を使い、geometry は読まない
  // （テキスト変更直後に scrollTop 等を読むと巨大 textarea の同期レイアウトを
  // 強制し、打鍵ごとに数百 ms 固まる原因になる）。
  const first = Math.max(0, Math.min(rawWinFirst, total));
  const last = Math.max(first, Math.min(rawWinLast, total));
  let windowLines = null;
  if (last > first) {
    const startOffset = rawOffsetOfLine(value, first);
    const endOffset = last >= total ? value.length : rawOffsetOfLine(value, last) - 1;
    windowLines = value.slice(startOffset, Math.max(startOffset, endOffset)).split("\n");
    // ホバー解決が参照する行キャッシュも可視範囲だけ追従させる
    if (rawHoverLines.length === total) {
      for (let i = 0; i < windowLines.length; i += 1) rawHoverLines[first + i] = windowLines[i];
    }
  }
  rehighlightRawWindow(total, (index) => (windowLines ? windowLines[index - first] : ""));
}

// 可視窓 [rawWinFirst, rawWinLast) を lineAt(index) のテキストで再ハイライトして描画
function rehighlightRawWindow(total, lineAt) {
  const first = Math.max(0, Math.min(rawWinFirst, total));
  const last = Math.max(first, Math.min(rawWinLast, total));
  const start = rawCtxByLine[first] || { inComment: false, inScript: false };
  const ctx = { inComment: start.inComment, inScript: start.inScript, ifDepth: 0, labels: new Set(), tbOpenLine: -1 };
  const scratch = [];
  for (let index = first; index < last; index += 1) {
    rawCtxByLine[index] = { inComment: ctx.inComment, inScript: ctx.inScript };
    rawHtmlLines[index] = ksLineHtml(lineAt(index) ?? "", index, ctx, scratch);
  }
  paintRawWindow();
}

function scheduleRawReparse() {
  // 入力イベント内で世代を進めるため、実行中 Worker がこの直後に完了しても
  // 編集前の結果は適用されない。タイマーは従来どおり入力停止まで張り直す。
  rawHighlightGeneration += 1;
  clearTimeout(rawReparseTimer);
  rawReparseTimer = setTimeout(() => {
    rawReparseTimer = 0;
    renderRawHighlight({ generation: rawHighlightGeneration });
  }, RAW_REPARSE_DELAY);
}

// ---- 可視窓の描画（ノード再利用） ----
// 以前は毎回 innerHTML を組み立て直していたが、スクロール・打鍵のたびに
// 窓全体（約80行×2カラム）の DOM を作り直すのは重い。行ノードをプールして
// 使い回し、内容が実際に変わった行だけを書き換える。スクロールで窓が
// ずれた分は端のノードを反対側へ移して再利用する（フロー配置を保つので
// 横スクロール幅の計算 = width:max-content もそのまま機能する）。
let rawCodeTopSpacer = null;
let rawCodeBottomSpacer = null;
let rawGutterTopSpacer = null;
let rawGutterBottomSpacer = null;
let rawCodeNodes = [];
let rawGutterNodes = [];
let rawPaintFirst = 0;

function makeRawSpacer(parent) {
  const node = document.createElement("div");
  node.className = "ks-spacer";
  parent.appendChild(node);
  return node;
}

function ensureRawPaintScaffold(code, gutter) {
  if (rawCodeTopSpacer && code.contains(rawCodeTopSpacer) && gutter.contains(rawGutterTopSpacer)) return;
  code.innerHTML = "";
  gutter.innerHTML = "";
  rawCodeTopSpacer = makeRawSpacer(code);
  rawCodeBottomSpacer = makeRawSpacer(code);
  rawGutterTopSpacer = makeRawSpacer(gutter);
  rawGutterBottomSpacer = makeRawSpacer(gutter);
  rawCodeNodes = [];
  rawGutterNodes = [];
  rawPaintFirst = 0;
}

// キャッシュした可視範囲(rawWinFirst..rawWinLast)だけを描画する。geometry は
// 読まない。上下にスペーサ div で全体の高さ（＝スクロール量）を保つ。
function paintRawWindow() {
  const code = $("#rawHighlightCode");
  const gutter = $("#rawGutterInner");
  if (!code || !gutter) return;
  ensureRawPaintScaffold(code, gutter);
  const total = rawHtmlLines.length;
  const lineHeight = KS_RAW_LINE_HEIGHT;
  const first = Math.max(0, Math.min(rawWinFirst, total));
  const last = Math.max(first, Math.min(rawWinLast, total));
  const count = last - first;

  while (rawCodeNodes.length > count) {
    rawCodeNodes.pop().remove();
    rawGutterNodes.pop().remove();
  }
  // 窓のシフト分だけ端のノードを反対側へ回し、重なっている行の内容を温存する
  const delta = first - rawPaintFirst;
  if (delta !== 0 && rawCodeNodes.length) {
    if (delta > 0 && delta < rawCodeNodes.length) {
      for (let k = 0; k < delta; k += 1) {
        const line = rawCodeNodes.shift();
        line._html = null;
        code.insertBefore(line, rawCodeBottomSpacer);
        rawCodeNodes.push(line);
        const num = rawGutterNodes.shift();
        num._key = null;
        gutter.insertBefore(num, rawGutterBottomSpacer);
        rawGutterNodes.push(num);
      }
    } else if (delta < 0 && -delta < rawCodeNodes.length) {
      for (let k = 0; k < -delta; k += 1) {
        const line = rawCodeNodes.pop();
        line._html = null;
        code.insertBefore(line, rawCodeNodes[0]);
        rawCodeNodes.unshift(line);
        const num = rawGutterNodes.pop();
        num._key = null;
        gutter.insertBefore(num, rawGutterNodes[0]);
        rawGutterNodes.unshift(num);
      }
    } else {
      rawCodeNodes.forEach((node) => { node._html = null; });
      rawGutterNodes.forEach((node) => { node._key = null; });
    }
  }
  while (rawCodeNodes.length < count) {
    const line = document.createElement("div");
    code.insertBefore(line, rawCodeBottomSpacer);
    rawCodeNodes.push(line);
    const num = document.createElement("div");
    gutter.insertBefore(num, rawGutterBottomSpacer);
    rawGutterNodes.push(num);
  }

  // highlight/gutter側に全17万px級のscroll layerを作らない。可視nodeだけを
  // 保持し、document上の位置はapplyRawScrollのtransformで合わせる。
  const topPad = "0px";
  const bottomPad = "0px";
  if (rawCodeTopSpacer.style.height !== topPad) {
    rawCodeTopSpacer.style.height = topPad;
    rawGutterTopSpacer.style.height = topPad;
  }
  if (rawCodeBottomSpacer.style.height !== bottomPad) {
    rawCodeBottomSpacer.style.height = bottomPad;
    rawGutterBottomSpacer.style.height = bottomPad;
  }

  for (let i = 0; i < count; i += 1) {
    const index = first + i;
    const html = rawHtmlLines[index] || "\u00a0";
    const diag = rawDiagClassByLine.get(index) || "";
    const active = index === rawActiveLine ? " active" : "";
    const cls = `ks-line${diag}${active}`;
    const line = rawCodeNodes[i];
    if (line._html !== html || line._cls !== cls) {
      if (line._cls !== cls) {
        line.className = cls;
        line._cls = cls;
      }
      if (line._html !== html) {
        line.innerHTML = html;
        line._html = html;
      }
    }
    const title = rawMsgByLine.has(index) ? rawMsgByLine.get(index).join("\n") : "";
    const key = `${index}\u0000${diag}${active}\u0000${title}`;
    const num = rawGutterNodes[i];
    if (num._key !== key) {
      num.className = `gutter-line${diag}${active}`;
      if (title) num.title = title;
      else num.removeAttribute("title");
      num.textContent = String(index + 1);
      num._key = key;
    }
  }
  rawPaintFirst = first;
}

// スクロール / 全描画時: 可視範囲を確定 → スクロール位置同期 → 描画。
// geometry の読み（scrollTop / clientHeight）を先頭でまとめて 1 回だけ行い、
// DOM 書き込み後に読み直さない（read→write→read の並びはスクロールイベント
// ごとに強制同期レイアウトを起こす）。
function renderRawWindow() {
  const editor = $("#rawEditor");
  if (!editor) return;
  if (editor._ksCodeMirror) {
    const cm = editor._ksCodeMirror;
    const viewport = cm.view.viewport;
    rawWinFirst = cm.view.state.doc.lineAt(viewport.from).number - 1;
    rawWinLast = cm.view.state.doc.lineAt(viewport.to).number;
    hideRawHoverCard();
    return;
  }
  const scrollTop = editor.scrollTop;
  const scrollLeft = editor.scrollLeft;
  const clientHeight = editor.clientHeight;
  const total = rawHtmlLines.length;
  rawWinFirst = Math.max(0, Math.floor(scrollTop / KS_RAW_LINE_HEIGHT) - RAW_WINDOW_BUFFER);
  rawWinLast = Math.min(
    total,
    Math.ceil((scrollTop + clientHeight) / KS_RAW_LINE_HEIGHT) + RAW_WINDOW_BUFFER,
  );
  applyRawScroll(scrollTop, scrollLeft);
  if (rawHighlightWorkerDisabled) {
    // workerを恒久停止した環境でも、スクロール先の可視行だけは即時描画する。
    const value = editor.value || "";
    const startOffset = rawOffsetOfLine(value, rawWinFirst);
    const endOffset = rawWinLast >= total ? value.length : rawOffsetOfLine(value, rawWinLast) - 1;
    const lines = value.slice(startOffset, Math.max(startOffset, endOffset)).split("\n");
    rehighlightRawWindow(total, (index) => lines[index - rawWinFirst] || "");
  } else {
    paintRawWindow();
  }
}
// 診断内容が前回と同じならバーを作り直さない（アイドル再解析は入力のたびに
// 走るので、変化がないのに最大100個のボタンを組み立て直さない）
let rawDiagBarKey = null;

function renderRawDiagBar(tooLarge = false) {
  const bar = $("#rawDiagBar");
  const stateNode = $("#rawDiagState");
  if (!bar) return;
  const key = `${tooLarge}|${rawDiagnostics
    .map((item) => `${item.severity}:${item.line}:${item.message}`)
    .join("")}`;
  if (key === rawDiagBarKey) return;
  rawDiagBarKey = key;
  const errors = rawDiagnostics.filter((item) => item.severity === "error").length;
  const warnings = rawDiagnostics.length - errors;
  if (stateNode) {
    if (tooLarge) {
      stateNode.textContent = "ファイルが大きいためハイライトを省略";
      stateNode.className = "mini";
    } else if (!rawDiagnostics.length) {
      stateNode.textContent = "問題なし";
      stateNode.className = "mini raw-diag-ok";
    } else {
      stateNode.textContent = `エラー ${errors} / 警告 ${warnings}`;
      stateNode.className = `mini ${errors ? "diag-error" : "diag-warning"}`;
    }
  }
  if (!rawDiagnostics.length) {
    bar.classList.add("hidden");
    bar.innerHTML = "";
    return;
  }
  bar.classList.remove("hidden");
  const list = [...rawDiagnostics].sort((a, b) => a.line - b.line).slice(0, 100);
  bar.innerHTML = list
    .map((item) => `
      <button type="button" class="code-diag-item" data-diag-line="${item.line}">
        <span class="diag-${item.severity}">${item.severity === "error" ? "✕" : "⚠"}</span>
        <span class="code-diag-line mono">${item.line + 1}行</span>
        <span class="code-diag-msg">${escapeHtml(item.message)}</span>
      </button>`)
    .join("") + (rawDiagnostics.length > list.length ? `<div class="mini">先頭 ${list.length} 件のみ表示</div>` : "");
}

// スクロール同期の書き込み部。geometry は呼び出し側で読んだ値を受け取る
function applyRawScroll(scrollTop, scrollLeft) {
  hideRawHoverCard();
  if (rawComplete.open) positionRawCompleteBox();
  const highlight = $("#rawHighlight");
  const code = $("#rawHighlightCode");
  const gutter = $("#rawGutterInner");
  if (!highlight) return;
  const visibleOffset = rawWinFirst * KS_RAW_LINE_HEIGHT - scrollTop;
  highlight.scrollTop = 0;
  highlight.scrollLeft = 0;
  highlight.dataset.scrollTop = String(scrollTop);
  highlight.dataset.scrollLeft = String(scrollLeft);
  if (code) code.style.transform = `translate(${-scrollLeft}px, ${visibleOffset}px)`;
  if (gutter) gutter.style.transform = `translateY(${visibleOffset}px)`;
}


function updateRawActiveLine(line) {
  if (line === rawActiveLine) return;
  rawActiveLine = line;
  if ($("#rawEditor")?._ksCodeMirror) return;
  // 仮想化により children[line] とは一致しないため、可視範囲を描き直して
  // アクティブ行のハイライトを反映する（geometry は読まない）。
  paintRawWindow();
}

function jumpRawToLine(line) {
  const editor = $("#rawEditor");
  if (!editor) return;
  const offset = rawLineOffset(editor, line);
  if (editor._ksCodeMirror) {
    editor._ksCodeMirror.focus({ preventScroll: true });
    editor._ksCodeMirror.scrollToPosition(offset, "center");
    updateRawLineState();
    return;
  }
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(offset, offset);
  editor.scrollTop = Math.max(0, line * KS_RAW_LINE_HEIGHT - editor.clientHeight * 0.45);
  renderRawWindow();
  updateRawLineState();
  renderRawHighlightWindow();
}

/* ============================================================
   画像タグのホバープレビュー
   [bg] [tb_image_show] [image] [button] などの image フィールドを
   持つタグにマウスを乗せると、その画像をフロート表示する
   ============================================================ */

let rawHoverLines = [];
let rawHoverCard = null;
let rawHoverKey = "";
let rawHoverRaf = 0;
let rawHoverMeasureCtx = null;

/* parseTagContent 相当（タグ名と属性マップだけ返す簡易版） */
function ksParseTagPm(inner) {
  const src = String(inner || "").trim();
  const len = src.length;
  let i = 0;
  let name = "";
  while (i < len && /\s/.test(src[i])) i += 1;
  while (i < len && !/\s/.test(src[i])) {
    name += src[i];
    i += 1;
  }
  const pm = {};
  while (i < len) {
    while (i < len && /\s/.test(src[i])) i += 1;
    if (i >= len) break;
    let attr = "";
    while (i < len && !/\s|=/.test(src[i])) {
      attr += src[i];
      i += 1;
    }
    if (!attr) {
      i += 1;
      continue;
    }
    while (i < len && /\s/.test(src[i])) i += 1;
    if (src[i] !== "=") {
      pm[attr] = "";
      continue;
    }
    i += 1;
    while (i < len && /\s/.test(src[i])) i += 1;
    let value = "";
    const quote = src[i];
    if (quote === "\"" || quote === "'" || quote === "`") {
      i += 1;
      let escaped = false;
      while (i < len) {
        const ch = src[i];
        if (escaped) {
          value += ch;
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === quote) {
          i += 1;
          break;
        } else {
          value += ch;
        }
        i += 1;
      }
    } else {
      while (i < len && !/\s/.test(src[i])) {
        value += src[i];
        i += 1;
      }
    }
    pm[attr] = value;
  }
  return { name, pm };
}

/* 行内のタグ範囲（文字 index）を列挙する */
function ksTagSpansForHover(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith("@")) {
    const at = line.indexOf("@");
    return [{ start: at, end: line.length, inner: line.slice(at + 1) }];
  }
  if (trimmed.startsWith(";") || trimmed.startsWith("*") || trimmed.startsWith("#")) return [];
  const spans = [];
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== "[") continue;
    const close = ksFindClosingBracket(line, i);
    if (close === -1) break;
    spans.push({ start: i, end: close + 1, inner: line.slice(i + 1, close) });
    i = close;
  }
  return spans;
}

/* Tyrano Tatie のキャラカタログから立ち絵画像を解決する */
function ksCharaImage(pm) {
  const catalog = state.catalog?.characters || {};
  const chara = catalog[pm.name];
  if (!chara) return null;
  const appearances = chara.appearances || {};
  const appearance = appearances[pm.appearance]
    ? pm.appearance
    : chara.defaultAppearance || Object.keys(appearances)[0] || "";
  const variants = appearances[appearance]?.variants || {};
  const variant = variants[pm.variant] ? pm.variant : Object.keys(variants)[0] || "";
  const storage = variants[variant]?.storage;
  if (!storage) return null;
  return {
    url: projectResourceUrl(`/project/data/fgimage/${encodePath(storage)}`),
    label: `${pm.name} ${appearance}/${variant}`,
  };
}

/* タグ名と属性から表示すべき画像 URL を返す（画像タグ以外は null） */
function ksImageForTag(name, pm) {
  if (name === "tatie") return ksCharaImage(pm);
  const schema = typeof TAG_SCHEMAS !== "undefined" ? TAG_SCHEMAS[name] : null;
  if (!schema) return null;
  for (const field of schema.fields || []) {
    if (field.type !== "image") continue;
    const value = pm[field.key];
    if (value) {
      return { url: projectResourceUrl(`/project/data/${field.dir || "image"}/${encodePath(value)}`), label: value };
    }
  }
  return null;
}

function ensureRawHoverCard() {
  if (rawHoverCard) return rawHoverCard;
  rawHoverCard = document.createElement("div");
  rawHoverCard.className = "ks-hover-card hidden";
  rawHoverCard.innerHTML = `<img alt=""><div class="ks-hover-name mono"></div>`;
  rawHoverCard.querySelector("img").addEventListener("error", hideRawHoverCard);
  document.body.appendChild(rawHoverCard);
  return rawHoverCard;
}

function hideRawHoverCard() {
  rawHoverKey = "";
  if (rawHoverCard) rawHoverCard.classList.add("hidden");
}

function positionRawHoverCard(event) {
  if (!rawHoverCard) return;
  const width = rawHoverCard.offsetWidth || 240;
  const height = rawHoverCard.offsetHeight || 160;
  let left = event.clientX + 16;
  let top = event.clientY + 18;
  if (left + width > window.innerWidth - 8) left = event.clientX - width - 12;
  if (top + height > window.innerHeight - 8) top = event.clientY - height - 12;
  rawHoverCard.style.left = `${Math.max(8, left)}px`;
  rawHoverCard.style.top = `${Math.max(8, top)}px`;
}

// エディタのフォントは CSS で固定なので、getComputedStyle は初回だけ読んで
// キャッシュする（マウス移動フレームごとの computed style 解決を避ける）
let rawMeasureFont = "";
function rawEditorMeasureFont(editor) {
  if (!rawMeasureFont) {
    const style = getComputedStyle(editor);
    rawMeasureFont = `${style.fontSize} ${style.fontFamily}`;
  }
  return rawMeasureFont;
}

function resolveRawHover(event) {
  const editor = $("#rawEditor");
  if (!editor) return hideRawHoverCard();
  if (editor._ksCodeMirror) {
    const position = editor._ksCodeMirror.posAtCoords({ x: event.clientX, y: event.clientY });
    if (position == null) return hideRawHoverCard();
    const lineInfo = editor._ksCodeMirror.lineAt(position);
    const column = position - lineInfo.from;
    const line = lineInfo.text;
    const hit = ksTagSpansForHover(line).find((span) => column >= span.start && column <= span.end);
    if (!hit) return hideRawHoverCard();
    const key = `${lineInfo.number - 1}:${hit.start}:${hit.inner}`;
    if (key === rawHoverKey) {
      positionRawHoverCard(event);
      return;
    }
    const { name, pm } = ksParseTagPm(hit.inner);
    const image = ksImageForTag(name, pm);
    if (!image) return hideRawHoverCard();
    rawHoverKey = key;
    const card = ensureRawHoverCard();
    const img = card.querySelector("img");
    card.querySelector(".ks-hover-name").textContent = image.label;
    if (img.getAttribute("src") !== image.url) img.src = image.url;
    card.classList.remove("hidden");
    positionRawHoverCard(event);
    return;
  }
  const rect = editor.getBoundingClientRect();
  const lineIndex = Math.floor((event.clientY - rect.top + editor.scrollTop - 12) / KS_RAW_LINE_HEIGHT);
  const line = rawHoverLines[lineIndex];
  if (line == null) return hideRawHoverCard();

  const x = event.clientX - rect.left + editor.scrollLeft - 16;
  if (!rawHoverMeasureCtx) rawHoverMeasureCtx = document.createElement("canvas").getContext("2d");
  rawHoverMeasureCtx.font = rawEditorMeasureFont(editor);

  let hit = null;
  for (const span of ksTagSpansForHover(line)) {
    const startPx = rawHoverMeasureCtx.measureText(line.slice(0, span.start)).width;
    if (x < startPx) break;
    const endPx = rawHoverMeasureCtx.measureText(line.slice(0, span.end)).width;
    if (x <= endPx) {
      hit = span;
      break;
    }
  }
  if (!hit) return hideRawHoverCard();

  const key = `${lineIndex}:${hit.start}:${hit.inner}`;
  if (key === rawHoverKey) {
    positionRawHoverCard(event);
    return;
  }
  const { name, pm } = ksParseTagPm(hit.inner);
  const image = ksImageForTag(name, pm);
  if (!image) return hideRawHoverCard();

  rawHoverKey = key;
  const card = ensureRawHoverCard();
  const img = card.querySelector("img");
  card.querySelector(".ks-hover-name").textContent = image.label;
  if (img.getAttribute("src") !== image.url) img.src = image.url;
  card.classList.remove("hidden");
  positionRawHoverCard(event);
  if (!img.complete) {
    img.addEventListener("load", () => positionRawHoverCard(event), { once: true });
  }
}

function handleRawHoverMove(event) {
  if (rawHoverRaf) return;
  rawHoverRaf = requestAnimationFrame(() => {
    rawHoverRaf = 0;
    resolveRawHover(event);
  });
}

/* ============================================================
   補完（タグ名 / 属性名 / 属性値）
   [ や @ に続けて入力するとタグ名を、タグ内では属性名を、
   属性値は select・bool・素材・ラベル・シナリオ・キャラカタログから補完する
   ============================================================ */

let rawComplete = { open: false, items: [], index: 0, ctx: null };
let rawCompleteBox = null;
let rawCompleteSuppress = false;
let rawTagNameCandidates = null;

const KS_TATIE_FIELDS = [
  { key: "name", label: "キャラ" },
  { key: "appearance", label: "衣装" },
  { key: "variant", label: "表情" },
  { key: "position", label: "位置" },
  { key: "mode", label: "モード" },
  { key: "time", label: "時間(ms)" },
  { key: "wait", label: "完了を待つ" },
  { key: "cross", label: "クロス" },
  { key: "reflect", label: "反転" },
];

function ksTagNameCandidates() {
  if (rawTagNameCandidates) return rawTagNameCandidates;
  const names = new Set([
    ...(typeof TAG_SCHEMAS !== "undefined" ? Object.keys(TAG_SCHEMAS) : []),
    ...(typeof TAG_LABELS !== "undefined" ? Object.keys(TAG_LABELS) : []),
  ]);
  names.delete("text"); // タイムライン表示用の疑似エントリでタグではない
  rawTagNameCandidates = [...names].sort().map((name) => ({
    value: name,
    desc: (typeof TAG_SCHEMAS !== "undefined" && TAG_SCHEMAS[name]?.label) ||
      (typeof TAG_LABELS !== "undefined" && TAG_LABELS[name]) || "",
  }));
  return rawTagNameCandidates;
}

/* カーソル位置の補完コンテキストを解析する */
function rawCompletionContext() {
  const editor = $("#rawEditor");
  if (!editor) return null;
  const caret = editor.selectionStart;
  if (caret !== editor.selectionEnd) return null;
  const cmLine = editor._ksCodeMirror?.lineAt(caret);
  const lineStart = cmLine ? cmLine.from : editor.value.lastIndexOf("\n", caret - 1) + 1;
  const before = cmLine ? cmLine.text.slice(0, caret - cmLine.from) : editor.value.slice(lineStart, caret);
  const trimmed = before.trimStart();
  if (trimmed.startsWith(";") || trimmed.startsWith("*") || trimmed.startsWith("#")) return null;

  let innerStart = -1;
  if (trimmed.startsWith("@")) {
    innerStart = before.indexOf("@") + 1;
  } else {
    let quote = "";
    let escaped = false;
    for (let i = 0; i < before.length; i += 1) {
      const ch = before[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (quote) {
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === "\"" || ch === "'" || ch === "`") {
        quote = ch;
        continue;
      }
      if (ch === "[") innerStart = i + 1;
      else if (ch === "]") innerStart = -1;
    }
  }
  if (innerStart < 0) return null;
  const inner = before.slice(innerStart);

  if (/^\S*$/.test(inner)) {
    return { mode: "tag", prefix: inner, replaceStart: caret - inner.length, inner };
  }
  const tagName = inner.match(/^(\S+)/)[1];

  // 最後のトークン（クォート外の空白区切り）
  let tokenStart = 0;
  let quote = "";
  let escaped = false;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) tokenStart = i + 1;
  }
  const token = inner.slice(tokenStart);
  const eq = token.indexOf("=");
  if (eq < 0) {
    return { mode: "attr", tagName, prefix: token, replaceStart: caret - token.length, inner };
  }
  const key = token.slice(0, eq);
  let valueText = token.slice(eq + 1);
  let quoteChar = "";
  if (valueText[0] === "\"" || valueText[0] === "'" || valueText[0] === "`") {
    quoteChar = valueText[0];
    valueText = valueText.slice(1);
  }
  return {
    mode: "value",
    tagName,
    key,
    prefix: valueText,
    quote: quoteChar,
    replaceStart: caret - valueText.length,
    inner,
  };
}

function rawAttrFields(tagName) {
  if (tagName === "tatie") return KS_TATIE_FIELDS;
  const schema = typeof TAG_SCHEMAS !== "undefined" ? TAG_SCHEMAS[tagName] : null;
  return schema?.fields || [];
}

function rawValueCandidates(ctx) {
  const { tagName, key } = ctx;
  const { pm } = ksParseTagPm(ctx.inner);
  if (tagName === "tatie") {
    const catalog = state.catalog?.characters || {};
    if (key === "name") return Object.keys(catalog);
    if (key === "appearance" || key === "variant") {
      const chara = catalog[pm.name] || catalog[Object.keys(catalog)[0]];
      if (!chara) return null;
      const appearances = chara.appearances || {};
      if (key === "appearance") return Object.keys(appearances);
      const appearance = appearances[pm.appearance]
        ? pm.appearance
        : chara.defaultAppearance || Object.keys(appearances)[0];
      return Object.keys(appearances[appearance]?.variants || {});
    }
    if (key === "position") return ["center", "left", "right"];
    if (key === "mode") return ["show", "mod"];
    if (["wait", "cross", "reflect"].includes(key)) return ["true", "false"];
    return null;
  }
  const field = rawAttrFields(tagName).find((item) => item.key === key);
  if (!field) return null;
  if (field.type === "select") return field.options || [];
  if (field.type === "bool") return ["true", "false"];
  if (field.type === "image" || field.type === "sound") {
    const kind = field.dir || (field.type === "image" ? "image" : "sound");
    return (state.assets?.[kind] || []).map((asset) => asset.storage);
  }
  if (field.type === "movie") return (state.assets?.video || []).map((asset) => asset.storage);
  if (field.type === "label") {
    return (state.scenario?.parsed?.labels || []).map((label) => ({
      value: `*${label.name}`,
      desc: label.caption || "",
    }));
  }
  if (field.type === "scenario") return (state.scenarios || []).map((item) => item.storage);
  return null;
}

function rawCompletionItems(ctx) {
  if (ctx.mode === "tag") {
    return ksTagNameCandidates().map((item) => ({ ...item, insert: item.value, kind: "tag" }));
  }
  if (ctx.mode === "attr") {
    const typedBefore = ctx.inner.slice(0, ctx.inner.length - ctx.prefix.length);
    const { pm } = ksParseTagPm(typedBefore);
    return rawAttrFields(ctx.tagName)
      .filter((field) => !(field.key in pm))
      .map((field) => ({
        value: field.key,
        desc: field.label || "",
        insert: `${field.key}=""`,
        caretOffset: field.key.length + 2,
        kind: "attr",
      }));
  }
  const values = rawValueCandidates(ctx) || [];
  return values.map((item) =>
    typeof item === "string"
      ? { value: item, desc: "", insert: item, kind: "value" }
      : { ...item, insert: item.value, kind: "value" });
}

function ensureRawCompleteBox() {
  if (rawCompleteBox) return rawCompleteBox;
  rawCompleteBox = document.createElement("div");
  rawCompleteBox.className = "code-complete hidden";
  rawCompleteBox.addEventListener("mousedown", (event) => event.preventDefault());
  rawCompleteBox.addEventListener("click", (event) => {
    const item = event.target.closest("[data-cc-index]");
    if (item) applyRawCompletion(rawComplete.items[Number(item.dataset.ccIndex)]);
  });
  document.body.appendChild(rawCompleteBox);
  return rawCompleteBox;
}

function closeRawCompletion() {
  rawComplete = { open: false, items: [], index: 0, ctx: null };
  if (rawCompleteBox) rawCompleteBox.classList.add("hidden");
}

function positionRawCompleteBox() {
  const editor = $("#rawEditor");
  const box = rawCompleteBox;
  if (!editor || !box) return;
  const rect = editor.getBoundingClientRect();
  const caret = editor.selectionStart;
  if (editor._ksCodeMirror) {
    const coords = editor._ksCodeMirror.coordsAtPos(caret);
    if (!coords) return;
    const width = box.offsetWidth || 260;
    const height = box.offsetHeight || 200;
    let left = coords.left;
    let top = coords.bottom + 4;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    if (top + height > window.innerHeight - 8) top = coords.top - height - 4;
    box.style.left = `${Math.max(8, left)}px`;
    box.style.top = `${Math.max(8, top)}px`;
    return;
  }
  const value = editor.value;
  const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
  const lineIndex = rawLineOfIndex(value, caret);
  if (!rawHoverMeasureCtx) rawHoverMeasureCtx = document.createElement("canvas").getContext("2d");
  rawHoverMeasureCtx.font = rawEditorMeasureFont(editor);
  const px = rawHoverMeasureCtx.measureText(value.slice(lineStart, caret)).width;
  const width = box.offsetWidth || 260;
  const height = box.offsetHeight || 200;
  let left = rect.left + 16 + px - editor.scrollLeft;
  let top = rect.top + 12 + (lineIndex + 1) * KS_RAW_LINE_HEIGHT - editor.scrollTop + 2;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  if (top + height > window.innerHeight - 8) {
    top = rect.top + 12 + lineIndex * KS_RAW_LINE_HEIGHT - editor.scrollTop - height - 4;
  }
  box.style.left = `${Math.max(8, left)}px`;
  box.style.top = `${Math.max(8, top)}px`;
}

function renderRawCompletion() {
  const box = ensureRawCompleteBox();
  box.innerHTML = rawComplete.items
    .map((item, index) => `
      <button type="button" class="code-complete-item${index === rawComplete.index ? " active" : ""}" data-cc-index="${index}">
        <span class="cc-name">${escapeHtml(item.value)}</span>
        ${item.desc ? `<span class="cc-desc">${escapeHtml(item.desc)}</span>` : ""}
      </button>`)
    .join("");
  box.classList.remove("hidden");
  positionRawCompleteBox();
  box.querySelector(".code-complete-item.active")?.scrollIntoView({ block: "nearest" });
}

function updateRawCompletion() {
  if (rawCompleteSuppress) return closeRawCompletion();
  const editor = $("#rawEditor");
  if (!editor || !rawEditorHasFocus(editor)) return closeRawCompletion();
  const ctx = rawCompletionContext();
  if (!ctx) return closeRawCompletion();
  const prefix = ctx.prefix.toLowerCase();
  let items = rawCompletionItems(ctx).filter((item) => item.value.toLowerCase().includes(prefix));
  items.sort((a, b) => {
    const aStarts = a.value.toLowerCase().startsWith(prefix) ? 0 : 1;
    const bStarts = b.value.toLowerCase().startsWith(prefix) ? 0 : 1;
    return aStarts - bStarts || a.value.localeCompare(b.value);
  });
  // 完全一致のみ1件なら出さない（入力済み）
  if (items.length === 1 && items[0].value === ctx.prefix) items = [];
  if (!items.length) return closeRawCompletion();
  rawComplete = { open: true, items: items.slice(0, 60), index: 0, ctx };
  renderRawCompletion();
}

function applyRawCompletion(item) {
  const editor = $("#rawEditor");
  const ctx = rawComplete.ctx;
  if (!editor || !ctx || !item) return;
  const caret = editor.selectionStart;
  const continueCompletion = item.kind === "attr";
  // transaction中にonChangeから古い候補UIを再入させない。
  rawCompleteSuppress = true;
  editor.setRangeText(item.insert, ctx.replaceStart, caret, "end");
  let next = ctx.replaceStart + (item.caretOffset != null ? item.caretOffset : item.insert.length);
  // 値の確定時、直後に閉じクォートがあればその外へ抜ける
  const nextCharacter = editor._ksCodeMirror
    ? editor._ksCodeMirror.slice(next, next + 1)
    : editor.value[next];
  if (item.kind === "value" && ctx.quote && nextCharacter === ctx.quote) next += 1;
  editor.setSelectionRange(next, next);
  closeRawCompletion();
  rawCompleteSuppress = false;
  // 属性確定時は移動したクォート内で値補完を続ける。
  if (continueCompletion) requestAnimationFrame(updateRawCompletion);
}

function handleRawEditorKeydown(event) {
  // IME の変換確定 Enter / 候補移動キーをKS補完が奪わない。
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    rawEditorComposing ||
    rawCompositionCommitPending
  ) return;
  if (rawComplete.open) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      rawComplete.index = (rawComplete.index + delta + rawComplete.items.length) % rawComplete.items.length;
      renderRawCompletion();
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      applyRawCompletion(rawComplete.items[rawComplete.index]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeRawCompletion();
      return;
    }
    return;
  }
  if (event.ctrlKey && (event.code === "Space" || event.key === " ")) {
    event.preventDefault();
    updateRawCompletion();
  }
}
