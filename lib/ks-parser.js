"use strict";

const IMPORTANT_TAGS = new Set([
  "bg",
  "mask",
  "mask_off",
  "playbgm",
  "stopbgm",
  "playse",
  "stopse",
  "chara_new",
  "chara_show",
  "chara_mod",
  "chara_hide",
  "chara_hide_all",
  "tatie",
  "jump",
  "call",
  "return",
  "button",
  "clickable",
  "glink",
  "if",
  "elsif",
  "else",
  "endif",
  "eval",
  "iscript",
  "endscript",
  "macro",
  "endmacro",
  "tb_start_text",
  "_tb_end_text",
  "tb_show_message_window",
  "tb_hide_message_window",
  "layopt",
  "cm",
  "wait",
  "s",
]);

const VISUAL_STATE_TAGS = new Set([
  "bg",
  "mask",
  "mask_off",
  "chara_show",
  "chara_mod",
  "chara_hide",
  "chara_hide_all",
  "tatie",
  "playbgm",
  "stopbgm",
]);

const TEXT_BLOCK_INLINE_TAGS = new Set([
  "l",
  "r",
  "p",
  "cm",
  "font",
  "resetfont",
  "ruby",
  "endruby",
  "tb_start_text",
  "_tb_end_text",
]);

function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function splitLinesPreserve(text) {
  const eol = detectEol(text);
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return { lines, eol, trailingNewline: /\r?\n$/.test(text) };
}

function attrsToMap(attrs) {
  const map = {};
  for (const attr of attrs) {
    map[attr.name] = attr.value;
  }
  return map;
}

function parseTagContent(source, lineNumber = 0) {
  const src = String(source || "").trim();
  let i = 0;
  const len = src.length;
  const result = {
    name: "",
    attrs: [],
    pm: {},
    raw: src,
    line: lineNumber,
    errors: [],
  };

  while (i < len && /\s/.test(src[i])) i += 1;
  while (i < len && !/\s/.test(src[i])) {
    result.name += src[i];
    i += 1;
  }

  while (i < len) {
    while (i < len && /\s/.test(src[i])) i += 1;
    if (i >= len) break;

    let attrName = "";
    while (i < len && !/\s|=/.test(src[i])) {
      attrName += src[i];
      i += 1;
    }
    if (!attrName) {
      i += 1;
      continue;
    }

    while (i < len && /\s/.test(src[i])) i += 1;
    if (src[i] !== "=") {
      result.attrs.push({ name: attrName, value: "", quote: null, raw: attrName });
      continue;
    }
    i += 1;
    while (i < len && /\s/.test(src[i])) i += 1;

    let quote = null;
    let value = "";
    if (src[i] === "\"" || src[i] === "'" || src[i] === "`") {
      quote = src[i];
      i += 1;
      let escaped = false;
      let closed = false;
      while (i < len) {
        const ch = src[i];
        if (escaped) {
          value += ch;
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === quote) {
          i += 1;
          closed = true;
          break;
        } else {
          value += ch;
        }
        i += 1;
      }
      if (!closed) {
        result.errors.push(`line ${lineNumber + 1}: attribute ${attrName} has an unclosed quote`);
      }
    } else {
      while (i < len && !/\s/.test(src[i])) {
        value += src[i];
        i += 1;
      }
    }
    result.attrs.push({ name: attrName, value, quote, raw: `${attrName}=${value}` });
  }

  result.pm = attrsToMap(result.attrs);
  return result;
}

function findClosingBracket(line, start) {
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

function parseLine(raw, lineNumber = 0, inBlockComment = false, inScript = false) {
  const line = String(raw || "").replace(/\r$/, "");
  const trimmed = line.trim();
  const entry = {
    line: lineNumber,
    raw: line,
    kind: "empty",
    tags: [],
    text: "",
    speaker: "",
    label: "",
    labelCaption: "",
    diagnostics: [],
    inBlockComment,
  };

  if (inBlockComment) {
    entry.kind = "comment";
    return entry;
  }
  if (inScript && !/^(?:\[\s*endscript\s*\]|@\s*endscript\b)/.test(trimmed)) {
    entry.kind = "script";
    return entry;
  }
  if (!trimmed) {
    return entry;
  }
  if (trimmed.startsWith(";")) {
    entry.kind = "comment";
    return entry;
  }
  if (trimmed === "/*" || trimmed === "*/") {
    entry.kind = "comment";
    return entry;
  }
  if (trimmed.startsWith("#")) {
    entry.kind = "speaker";
    const speaker = trimmed.slice(1).trim();
    const [name, face] = speaker.split(":");
    entry.speaker = (name || "").trim();
    entry.face = (face || "").trim();
    return entry;
  }
  if (trimmed.startsWith("*")) {
    entry.kind = "label";
    const labelText = trimmed.slice(1);
    const separator = labelText.indexOf("|");
    entry.label = (separator >= 0 ? labelText.slice(0, separator) : labelText).trim();
    entry.labelCaption = separator >= 0 ? labelText.slice(separator + 1).trim() : "";
    return entry;
  }
  if (trimmed.startsWith("@")) {
    const tag = parseTagContent(trimmed.slice(1), lineNumber);
    entry.kind = "tag";
    entry.tags.push(tag);
    entry.diagnostics.push(...tag.errors);
    return entry;
  }

  let textBuffer = "";
  let hasTag = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch !== "[") {
      textBuffer += ch;
      continue;
    }
    const close = findClosingBracket(line, i);
    if (close === -1) {
      entry.diagnostics.push(`line ${lineNumber + 1}: missing closing ]`);
      textBuffer += line.slice(i);
      break;
    }
    const tagContent = line.slice(i + 1, close);
    const tag = parseTagContent(tagContent, lineNumber);
    entry.tags.push(tag);
    entry.diagnostics.push(...tag.errors);
    hasTag = true;
    i = close;
  }

  entry.text = textBuffer.trim();
  if (hasTag && entry.text) {
    entry.kind = "mixed";
  } else if (hasTag) {
    entry.kind = "tag";
  } else {
    entry.kind = "text";
    entry.text = trimmed.startsWith("_") ? trimmed.slice(1) : trimmed;
  }
  return entry;
}

function classifyTag(tag) {
  const name = tag.name;
  if (name === "bg") return "background";
  if (name === "tatie" || name === "chara_show" || name === "chara_mod") return "character";
  if (name === "chara_hide" || name === "chara_hide_all") return "character_hide";
  if (name === "mask" || name === "mask_off") return "fade";
  if (name === "playbgm" || name === "stopbgm" || name === "playse" || name === "stopse") return "audio";
  if (name === "jump" || name === "call" || name === "return") return "flow";
  if (name === "glink" || name === "button" || name === "clickable") return "choice";
  if (name === "if" || name === "elsif" || name === "else" || name === "endif") return "branch";
  if (name === "iscript" || name === "endscript" || name === "eval") return "script";
  if (name === "tb_start_text" || name === "_tb_end_text") return "text_block";
  return IMPORTANT_TAGS.has(name) ? "tag" : "unknown";
}

function describeEntry(entry) {
  if (entry.kind === "label") return `*${entry.label}`;
  if (entry.kind === "speaker") return entry.speaker ? `# ${entry.speaker}` : "#";
  if (entry.kind === "text") return entry.text.slice(0, 80);
  if (entry.text) return entry.text.slice(0, 80);
  if (entry.tags.length) {
    const tag = entry.tags[0];
    const category = classifyTag(tag);
    if (category === "background") return `背景: ${tag.pm.storage || ""}`;
    if (category === "character") return `立ち絵: ${tag.pm.name || ""} ${tag.pm.appearance || ""}/${tag.pm.variant || ""}`;
    if (category === "audio") return `${tag.name}: ${tag.pm.storage || tag.pm.target || ""}`;
    if (category === "flow") return `${tag.name}: ${tag.pm.storage || ""}${tag.pm.target || ""}`;
    if (category === "choice") return `${tag.name}: ${tag.pm.text || tag.pm.target || ""}`;
    return `[${tag.name}]`;
  }
  return "";
}

function parseScenario(text, filename = "") {
  const { lines, eol, trailingNewline } = splitLinesPreserve(text);
  const entries = [];
  const labels = [];
  const labelMap = {};
  const jumps = [];
  const calls = [];
  const choices = [];
  const events = [];
  const textBlocks = [];
  const diagnostics = [];
  let inBlockComment = false;
  let inScript = false;
  let ifDepth = 0;
  let currentTextBlock = null;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    const entry = parseLine(raw, index, inBlockComment, inScript);
    entry.summary = describeEntry(entry);
    entries.push(entry);

    if (!inBlockComment && trimmed === "/*") {
      inBlockComment = true;
      continue;
    }
    if (inBlockComment && trimmed === "*/") {
      inBlockComment = false;
      continue;
    }
    if (entry.kind === "comment" || entry.kind === "empty" || entry.kind === "script") {
      continue;
    }

    for (const message of entry.diagnostics) {
      diagnostics.push({ severity: "error", line: index, message });
    }

    if (entry.kind === "label") {
      const label = {
        name: entry.label,
        caption: entry.labelCaption,
        line: index,
        file: filename,
      };
      labels.push(label);
      if (labelMap[label.name]) {
        diagnostics.push({ severity: "warning", line: index, message: `duplicate label: ${label.name}` });
      }
      labelMap[label.name] = label;
      events.push({ type: "label", line: index, label: entry.label, caption: entry.labelCaption });
      continue;
    }

    if (entry.kind === "speaker") {
      if (currentTextBlock) {
        currentTextBlock.items.push({ type: "speaker", line: index, name: entry.speaker });
      }
      events.push({ type: "speaker", line: index, name: entry.speaker });
      continue;
    }

    if (entry.kind === "text") {
      if (currentTextBlock) {
        currentTextBlock.items.push({ type: "text", line: index, text: entry.text });
      }
      events.push({ type: "text", line: index, text: entry.text });
    }

    for (const tag of entry.tags) {
      const category = classifyTag(tag);
      if (tag.name === "iscript") inScript = true;
      if (tag.name === "endscript") inScript = false;
      if (!inScript) {
        if (tag.name === "if") ifDepth += 1;
        if (tag.name === "endif") ifDepth -= 1;
        if (ifDepth < 0) {
          diagnostics.push({ severity: "error", line: index, message: "endif without matching if" });
          ifDepth = 0;
        }
      }
      if (tag.name === "tb_start_text") {
        currentTextBlock = { startLine: index, endLine: null, items: [] };
      }
      if (tag.name === "_tb_end_text" && currentTextBlock) {
        currentTextBlock.endLine = index;
        textBlocks.push(currentTextBlock);
        currentTextBlock = null;
      }
      if (tag.name === "jump") {
        jumps.push({ line: index, storage: tag.pm.storage || "", target: tag.pm.target || "", cond: tag.pm.cond || "" });
      }
      if (tag.name === "call") {
        calls.push({ line: index, storage: tag.pm.storage || "", target: tag.pm.target || "" });
      }
      if (tag.name === "glink" || tag.name === "button" || tag.name === "clickable") {
        choices.push({ line: index, tag: tag.name, storage: tag.pm.storage || "", target: tag.pm.target || "", text: tag.pm.text || "" });
      }
      events.push({ type: category, line: index, tag: tag.name, pm: tag.pm, important: IMPORTANT_TAGS.has(tag.name) });
    }
  }

  if (inBlockComment) diagnostics.push({ severity: "error", line: lines.length - 1, message: "block comment is not closed" });
  if (inScript) diagnostics.push({ severity: "error", line: lines.length - 1, message: "iscript block is not closed" });
  if (ifDepth !== 0) diagnostics.push({ severity: "error", line: lines.length - 1, message: "if/endif depth is not balanced" });
  if (currentTextBlock) diagnostics.push({ severity: "warning", line: currentTextBlock.startLine, message: "tb_start_text block is not closed" });

  return {
    filename,
    eol,
    trailingNewline,
    lineCount: lines.length,
    entries,
    labels,
    labelMap,
    jumps,
    calls,
    choices,
    events,
    textBlocks,
    diagnostics,
  };
}

function quoteValue(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function normalizeAttrArray(attrs) {
  if (Array.isArray(attrs)) {
    return attrs.map((attr) => ({ name: attr.name, value: attr.value ?? "" }));
  }
  return Object.entries(attrs || {}).map(([name, value]) => ({ name, value: value ?? "" }));
}

function renderTagPieces(name, attrs = {}) {
  const attrArray = normalizeAttrArray(attrs).filter((attr) => attr.name && attr.value !== undefined && attr.value !== null);
  const pieces = [name];
  for (const attr of attrArray) {
    pieces.push(`${attr.name}="${quoteValue(attr.value)}"`);
  }
  return pieces;
}

function renderTag(name, attrs = {}) {
  return `[${renderTagPieces(name, attrs).join("  ")}  ]`;
}

function renderAtTag(name, attrs = {}) {
  return `@${renderTagPieces(name, attrs).join("  ")}`;
}

function tagSpansInLine(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith("@")) {
    return [{ start: line.indexOf("@"), end: line.length, at: true }];
  }
  const spans = [];
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== "[") continue;
    const close = findClosingBracket(line, i);
    if (close === -1) break;
    spans.push({ start: i, end: close + 1, at: false });
    i = close;
  }
  return spans;
}

function updateTagLine(rawLine, changes, tagIndex = 0) {
  const entry = parseLine(rawLine, 0);
  const tag = entry.tags[tagIndex];
  if (!tag) {
    throw new Error("selected line does not contain a Tyrano tag");
  }
  const attrs = [...tag.attrs];
  const known = new Set(attrs.map((attr) => attr.name));
  for (const [key, value] of Object.entries(changes || {})) {
    const existing = attrs.find((attr) => attr.name === key);
    if (existing) {
      existing.value = value;
    } else if (!known.has(key)) {
      attrs.push({ name: key, value });
      known.add(key);
    }
  }
  const span = tagSpansInLine(entry.raw)[tagIndex];
  if (!span) {
    return renderTag(tag.name, attrs);
  }
  const rendered = span.at ? renderAtTag(tag.name, attrs) : renderTag(tag.name, attrs);
  return entry.raw.slice(0, span.start) + rendered + entry.raw.slice(span.end);
}

function makeComponentLine(type, payload = {}) {
  switch (type) {
    case "background":
      return renderTag("bg", {
        time: payload.time || "1000",
        method: payload.method || "crossfade",
        storage: payload.storage || "black.jpg",
      });
    case "chara":
      return renderTag("tatie", {
        name: payload.name || "",
        appearance: payload.appearance || "default",
        variant: payload.variant || "normal",
        position: payload.position || "center",
        mode: payload.mode || "show",
        time: payload.time || "500",
        wait: payload.wait || "true",
        reflect: payload.reflect || "false",
      });
    case "hide_all":
      return renderTag("chara_hide_all", { time: payload.time || "300", wait: payload.wait || "false" });
    case "mask":
      return renderTag("mask", { time: payload.time || "1000", effect: payload.effect || "fadeIn", color: payload.color || "0x000000" });
    case "mask_off":
      return renderTag("mask_off", { time: payload.time || "1000", effect: payload.effect || "fadeOut" });
    case "playbgm":
      return renderTag("playbgm", { volume: payload.volume || "100", time: payload.time || "1000", loop: payload.loop || "true", storage: payload.storage || "" });
    case "stopbgm":
      return renderTag("stopbgm", { time: payload.time || "1000" });
    case "playse":
      return renderTag("playse", { volume: payload.volume || "100", time: payload.time || "1000", buf: payload.buf || "0", storage: payload.storage || "" });
    case "label":
      return `*${payload.name || "new_label"}${payload.caption ? `|${payload.caption}` : ""}`;
    case "jump":
      return renderTag("jump", { storage: payload.storage || "", target: payload.target || "" });
    case "call":
      return renderTag("call", { storage: payload.storage || "", target: payload.target || "" });
    case "glink":
      return renderTag("glink", {
        color: payload.color || "black",
        storage: payload.storage || "",
        target: payload.target || "",
        text: payload.text || "選択肢",
        x: payload.x || "160",
        y: payload.y || "200",
        width: payload.width || "700",
        autopos: payload.autopos || "true",
      });
    case "text_block":
      return [
        renderTag("tb_start_text", { mode: payload.mode || "1" }),
        `#${payload.speaker ? ` ${payload.speaker}` : ""}`,
        `${payload.text || "本文を入力"}[p]`,
        renderTag("_tb_end_text"),
      ].join("\n");
    default:
      return payload.raw || "";
  }
}

function joinPreservedLines(parts) {
  return parts.lines.join(parts.eol) + (parts.trailingNewline ? parts.eol : "");
}

function assertLineInRange(parts, lineNumber) {
  if (lineNumber < 0 || lineNumber >= parts.lines.length) {
    throw new Error(`line out of range: ${lineNumber + 1}`);
  }
}

function deleteLine(text, lineNumber) {
  const parts = splitLinesPreserve(text);
  assertLineInRange(parts, lineNumber);
  parts.lines.splice(lineNumber, 1);
  if (!parts.lines.length) parts.lines.push("");
  return {
    text: joinPreservedLines(parts),
    line: Math.min(lineNumber, parts.lines.length - 1),
  };
}

function moveLine(text, lineNumber, offset) {
  const parts = splitLinesPreserve(text);
  assertLineInRange(parts, lineNumber);
  const target = lineNumber + offset;
  if (target < 0 || target >= parts.lines.length) {
    return { text: joinPreservedLines(parts), line: lineNumber };
  }
  const [moved] = parts.lines.splice(lineNumber, 1);
  parts.lines.splice(target, 0, moved);
  return { text: joinPreservedLines(parts), line: target };
}

// from 行を取り出し、元配列でのインデックス `to` の直前へ挿入する
// （タイムラインのドラッグ並べ替え用。to は 0〜行数 の挿入位置）
function moveLineTo(text, from, to) {
  const parts = splitLinesPreserve(text);
  assertLineInRange(parts, from);
  const dest = Math.max(0, Math.min(Number(to), parts.lines.length));
  const [moved] = parts.lines.splice(from, 1);
  const insertAt = from < dest ? dest - 1 : dest;
  parts.lines.splice(insertAt, 0, moved);
  return { text: joinPreservedLines(parts), line: insertAt };
}

// moveLineTo と同じ並べ替えだが、移動先が [tb_start_text]〜[_tb_end_text] の
// 内側で、動かす行がテキストブロックに置けないタグ（bg・立ち絵など）の場合は
// insertLinesWithTextBlockSplit と同じ規則でブロックを分割する
function moveLineToWithTextBlockSplit(text, from, to) {
  const parts = splitLinesPreserve(text);
  assertLineInRange(parts, from);
  const movedContent = parts.lines[from];
  const dest = Math.max(0, Math.min(Number(to), parts.lines.length));
  // 移動元を取り除いた中間テキスト（eol / 末尾改行は維持）
  const remaining = {
    lines: parts.lines.slice(),
    eol: parts.eol,
    trailingNewline: parts.trailingNewline,
  };
  remaining.lines.splice(from, 1);
  const remainingText = joinPreservedLines(remaining);
  // 取り除きによるインデックスずれを補正した挿入位置
  const insertAt = from < dest ? dest - 1 : dest;
  const result = insertLinesWithTextBlockSplit(remainingText, insertAt, movedContent, "before");
  return { text: result.text, line: result.line, splitTextBlock: Boolean(result.splitTextBlock) };
}

function duplicateLine(text, lineNumber) {
  const parts = splitLinesPreserve(text);
  assertLineInRange(parts, lineNumber);
  parts.lines.splice(lineNumber + 1, 0, parts.lines[lineNumber]);
  return { text: joinPreservedLines(parts), line: lineNumber + 1 };
}

// count: インライン編集が現在占有している既存行数。1行を複数行へ展開した
// 後の再保存でも、前回展開分を重複させずまとめて置換する。
function applyLineEdit(text, lineNumber, replacement, count = 1) {
  const parts = splitLinesPreserve(text);
  if (lineNumber < 0 || lineNumber >= parts.lines.length) {
    throw new Error(`line out of range: ${lineNumber + 1}`);
  }
  const removeCount = Math.max(1, Math.min(Number(count) || 1, parts.lines.length - lineNumber));
  const replacementLines = String(replacement ?? "").replace(/\r\n/g, "\n").split("\n");
  parts.lines.splice(lineNumber, removeCount, ...replacementLines);
  return parts.lines.join(parts.eol) + (parts.trailingNewline ? parts.eol : "");
}

function insertLines(text, lineNumber, content, mode = "after") {
  const parts = splitLinesPreserve(text);
  const insertAt = mode === "before" ? lineNumber : lineNumber + 1;
  const normalized = String(content ?? "").replace(/\r\n/g, "\n");
  const replacementLines = normalized.split("\n");
  parts.lines.splice(Math.max(0, Math.min(insertAt, parts.lines.length)), 0, ...replacementLines);
  return parts.lines.join(parts.eol) + (parts.trailingNewline ? parts.eol : "");
}

function normalizedReplacementLines(content) {
  return String(content ?? "").replace(/\r\n/g, "\n").split("\n");
}

function contentRequiresTextBlockSplit(content) {
  return normalizedReplacementLines(content).some((line, index) => {
    const entry = parseLine(line, index);
    if (entry.kind === "label") return true;
    return entry.tags.some((tag) => !TEXT_BLOCK_INLINE_TAGS.has(tag.name));
  });
}

function hasTextBlockPayload(lines) {
  return lines.some((line, index) => {
    const entry = parseLine(line, index);
    if (entry.kind === "empty" || entry.kind === "comment" || entry.kind === "speaker") {
      return false;
    }
    return true;
  });
}

function insertLinesWithTextBlockSplit(text, lineNumber, content, mode = "after") {
  const parts = splitLinesPreserve(text);
  const requestedAt = mode === "before" ? lineNumber : lineNumber + 1;
  const insertAt = Math.max(0, Math.min(requestedAt, parts.lines.length));
  const replacementLines = normalizedReplacementLines(content);

  function insertAtLine(targetLine, splitTextBlock = false) {
    const target = Math.max(0, Math.min(targetLine, parts.lines.length));
    parts.lines.splice(target, 0, ...replacementLines);
    return {
      text: joinPreservedLines(parts),
      line: target,
      splitTextBlock,
    };
  }

  if (!contentRequiresTextBlockSplit(content)) {
    return insertAtLine(insertAt);
  }

  const parsed = parseScenario(text);
  const block = parsed.textBlocks.find(
    (item) => item.startLine < insertAt && insertAt <= item.endLine,
  );
  if (!block) return insertAtLine(insertAt);

  const beforeInsertion = parts.lines.slice(block.startLine + 1, insertAt);
  const afterInsertion = parts.lines.slice(insertAt, block.endLine);
  if (!hasTextBlockPayload(beforeInsertion)) {
    return insertAtLine(block.startLine);
  }
  if (!hasTextBlockPayload(afterInsertion)) {
    return insertAtLine(block.endLine + 1);
  }

  const endMarker = parts.lines[block.endLine] || renderTag("_tb_end_text");
  const startMarker = parts.lines[block.startLine] || renderTag("tb_start_text", { mode: "1" });
  parts.lines.splice(insertAt, 0, endMarker, ...replacementLines, startMarker);
  return {
    text: joinPreservedLines(parts),
    line: insertAt + 1,
    splitTextBlock: true,
  };
}

module.exports = {
  IMPORTANT_TAGS,
  VISUAL_STATE_TAGS,
  detectEol,
  splitLinesPreserve,
  parseTagContent,
  parseLine,
  parseScenario,
  classifyTag,
  renderTag,
  renderAtTag,
  tagSpansInLine,
  updateTagLine,
  makeComponentLine,
  applyLineEdit,
  insertLines,
  insertLinesWithTextBlockSplit,
  deleteLine,
  moveLine,
  moveLineTo,
  moveLineToWithTextBlockSplit,
  duplicateLine,
};
