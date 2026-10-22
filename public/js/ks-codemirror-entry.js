import { basicSetup } from "codemirror";
import { EditorSelection, Prec, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { setDiagnostics } from "@codemirror/lint";
import { tags } from "@lezer/highlight";

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

const tyranoScript = StreamLanguage.define({
  name: "tyranoscript",
  startState() {
    return {
      inBlockComment: false,
      inScript: false,
      inTag: false,
      expectTagName: false,
      pendingScript: false,
    };
  },
  copyState(state) {
    return { ...state };
  },
  token(stream, state) {
    if (state.inBlockComment) {
      if (stream.skipTo("*/")) {
        stream.match("*/");
        state.inBlockComment = false;
      } else {
        stream.skipToEnd();
      }
      return "comment";
    }

    if (state.inScript && !state.inTag) {
      if (stream.sol() && /^\s*\[endscript(?:\s|\])/.test(stream.string)) {
        state.inScript = false;
      } else {
        stream.skipToEnd();
        return "variableName";
      }
    }

    if (stream.eatSpace()) return null;

    if (!state.inTag && stream.match("/*")) {
      state.inBlockComment = true;
      return "comment";
    }

    if (!state.inTag && stream.sol()) {
      if (stream.peek() === ";") {
        stream.skipToEnd();
        return "comment";
      }
      if (stream.peek() === "*") {
        stream.skipToEnd();
        return "labelName";
      }
      if (stream.peek() === "#") {
        stream.skipToEnd();
        return "heading";
      }
    }

    if (!state.inTag && stream.peek() === "[") {
      stream.next();
      state.inTag = true;
      state.expectTagName = true;
      state.pendingScript = false;
      return "bracket";
    }

    if (state.inTag) {
      if (stream.peek() === "]") {
        stream.next();
        state.inTag = false;
        state.expectTagName = false;
        if (state.pendingScript) state.inScript = true;
        return "bracket";
      }
      if (stream.peek() === "=" || stream.peek() === ",") {
        stream.next();
        return "operator";
      }
      const quote = stream.peek();
      if (quote === "\"" || quote === "'" || quote === "`") {
        stream.next();
        let escaped = false;
        while (!stream.eol()) {
          const char = stream.next();
          if (!escaped && char === quote) break;
          escaped = !escaped && char === "\\";
          if (char !== "\\") escaped = false;
        }
        return "string";
      }
      if (stream.match(/^-?\d+(?:\.\d+)?/)) return "number";
      if (stream.match(/^(?:true|false|null|undefined)\b/i)) return "bool";
      if (stream.match(/^[^\s=,\]]+/)) {
        const word = stream.current();
        if (state.expectTagName) {
          state.expectTagName = false;
          state.pendingScript = word.toLowerCase() === "iscript";
          if (word.toLowerCase() === "endscript") state.inScript = false;
          return "keyword";
        }
        return "propertyName";
      }
      stream.next();
      return null;
    }

    while (!stream.eol()) {
      if (stream.peek() === "[") break;
      if (stream.match("/*", false)) break;
      stream.next();
    }
    return "content";
  },
  tokenTable: {
    content: tags.content,
    heading: tags.heading,
    labelName: tags.labelName,
    bracket: tags.punctuation,
    propertyName: tags.propertyName,
    variableName: tags.variableName,
    bool: tags.bool,
  },
});

const ksHighlightStyle = HighlightStyle.define([
  { tag: tags.content, color: "var(--text)" },
  { tag: tags.comment, color: "var(--text-faint)", fontStyle: "italic" },
  { tag: tags.labelName, color: "var(--c-story)", fontWeight: "700" },
  { tag: tags.heading, color: "var(--c-chara)", fontWeight: "700" },
  { tag: tags.keyword, color: "var(--c-direction)", fontWeight: "650" },
  { tag: tags.propertyName, color: "var(--text-dim)" },
  { tag: tags.string, color: "var(--c-screen)" },
  { tag: tags.number, color: "var(--c-media)" },
  { tag: tags.bool, color: "var(--c-story)" },
  { tag: tags.operator, color: "var(--text-faint)" },
  { tag: tags.punctuation, color: "var(--text-faint)" },
  { tag: tags.variableName, color: "var(--c-script)" },
]);

const ksTheme = EditorView.theme({
  "&": {
    height: "100%",
    minHeight: "0",
    color: "var(--text)",
    backgroundColor: "var(--field)",
    fontSize: "12.5px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    lineHeight: "20px",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "12px 16px",
    caretColor: "var(--text)",
  },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "rgba(125, 165, 255, 0.3) !important",
  },
  ".cm-activeLine": { backgroundColor: "var(--sel-bg)" },
  ".cm-gutters": {
    color: "var(--text-faint)",
    backgroundColor: "var(--bg-raised)",
    borderRight: "1px solid var(--line)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "48px",
    padding: "0 12px 0 8px",
  },
  ".cm-activeLineGutter": {
    color: "var(--accent)",
    backgroundColor: "var(--sel-bg)",
    fontWeight: "700",
  },
  ".cm-lintRange-error": { backgroundImage: "none", backgroundColor: "rgba(224, 101, 90, 0.12)" },
  ".cm-lintRange-warning": { backgroundImage: "none", backgroundColor: "rgba(229, 192, 91, 0.1)" },
  ".cm-tooltip": {
    color: "var(--text)",
    backgroundColor: "var(--bg-raised)",
    border: "1px solid var(--line)",
  },
  ".cm-panels": {
    color: "var(--text)",
    backgroundColor: "var(--bg-raised)",
  },
});

function create(host, callbacks = {}) {
  if (!host) throw new Error("KS CodeMirror host is required");
  if (host._ksCodeMirror) return host._ksCodeMirror;

  let programmaticDepth = 0;
  let controller = null;

  const view = new EditorView({
    doc: String(callbacks.doc || ""),
    extensions: [
      basicSetup,
      tyranoScript,
      syntaxHighlighting(ksHighlightStyle),
      ksTheme,
      EditorView.contentAttributes.of({
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
        translate: "no",
      }),
      Prec.high(keymap.of([{
        key: "Mod-f",
        run: () => {
          callbacks.onOpenFind?.();
          return true;
        },
      }])),
      EditorView.updateListener.of((update) => {
        if (!controller) return;
        if (update.docChanged) {
          controller.revision += 1;
          if (programmaticDepth === 0) controller.dirty = true;
        }
        if (update.docChanged && programmaticDepth === 0) callbacks.onChange?.(update, controller);
        if (update.selectionSet || update.docChanged) callbacks.onSelection?.(update, controller);
        if (update.viewportChanged || update.geometryChanged) callbacks.onViewport?.(update, controller);
        if (update.focusChanged) callbacks.onFocusChange?.(update.view.hasFocus, update, controller);
      }),
    ],
    parent: host,
  });

  const text = () => view.state.doc.toString();
  const selection = () => view.state.selection.main;

  const dispatchProgrammatic = (spec) => {
    programmaticDepth += 1;
    try {
      view.dispatch({ ...spec, annotations: Transaction.addToHistory.of(false) });
    } finally {
      programmaticDepth -= 1;
    }
  };

  controller = {
    host,
    view,
    revision: 0,
    dirty: false,
    syncedFile: "",
    syncedHash: "",
    get value() { return text(); },
    get selectionStart() { return selection().from; },
    get selectionEnd() { return selection().to; },
    get hasFocus() { return view.hasFocus; },
    get composing() { return view.composing || view.compositionStarted; },
    get scrollTop() { return view.scrollDOM.scrollTop; },
    set scrollTop(value) { view.scrollDOM.scrollTop = Math.max(0, Number(value) || 0); },
    get scrollLeft() { return view.scrollDOM.scrollLeft; },
    set scrollLeft(value) { view.scrollDOM.scrollLeft = Math.max(0, Number(value) || 0); },
    get clientHeight() { return view.scrollDOM.clientHeight; },
    setValue(value, options = {}) {
      const next = String(value ?? "");
      const current = text();
      if (next === current) return false;
      const previousSelection = selection();
      const previousScrollTop = view.scrollDOM.scrollTop;
      const anchor = clamp(previousSelection.anchor, 0, next.length);
      const head = clamp(previousSelection.head, 0, next.length);
      dispatchProgrammatic({
        changes: { from: 0, to: current.length, insert: next },
        selection: EditorSelection.range(anchor, head),
      });
      if (options.preserveScroll !== false) view.scrollDOM.scrollTop = previousScrollTop;
      return true;
    },
    replaceRange(replacement, from, to, selectionMode = "end") {
      const currentLength = view.state.doc.length;
      const start = clamp(from, 0, currentLength);
      const end = clamp(to, start, currentLength);
      const inserted = String(replacement ?? "");
      let anchor = start + inserted.length;
      let head = anchor;
      if (selectionMode === "select") {
        anchor = start;
        head = start + inserted.length;
      } else if (selectionMode === "start") {
        anchor = head = start;
      } else if (selectionMode === "preserve") {
        const old = selection();
        const delta = inserted.length - (end - start);
        anchor = old.anchor > end ? old.anchor + delta : old.anchor;
        head = old.head > end ? old.head + delta : old.head;
      }
      view.dispatch({
        changes: { from: start, to: end, insert: inserted },
        selection: EditorSelection.range(anchor, head),
        userEvent: "input.type",
      });
    },
    setSelection(from, to = from, options = {}) {
      const length = view.state.doc.length;
      const anchor = clamp(from, 0, length);
      const head = clamp(to, 0, length);
      const effects = options.scroll
        ? EditorView.scrollIntoView(EditorSelection.range(anchor, head), { y: options.y || "nearest" })
        : undefined;
      dispatchProgrammatic({ selection: EditorSelection.range(anchor, head), effects });
    },
    focus(options = {}) {
      view.focus();
      if (options.scroll === false || options.preventScroll) return;
      view.dispatch({ effects: EditorView.scrollIntoView(selection(), { y: "nearest" }) });
    },
    blur() { view.contentDOM.blur(); },
    scrollToPosition(position, y = "center") {
      const pos = clamp(position, 0, view.state.doc.length);
      dispatchProgrammatic({
        selection: EditorSelection.cursor(pos),
        effects: EditorView.scrollIntoView(pos, { y }),
      });
    },
    coordsAtPos(position) {
      return view.coordsAtPos(clamp(position, 0, view.state.doc.length));
    },
    posAtCoords(coords) {
      return view.posAtCoords(coords);
    },
    lineAt(position) {
      return view.state.doc.lineAt(clamp(position, 0, view.state.doc.length));
    },
    line(number) {
      return view.state.doc.line(clamp(number, 1, view.state.doc.lines));
    },
    slice(from, to) {
      const length = view.state.doc.length;
      return view.state.doc.sliceString(clamp(from, 0, length), clamp(to, 0, length));
    },
    markSynced(file, hash) {
      controller.syncedFile = String(file || "");
      controller.syncedHash = String(hash || "");
      controller.dirty = false;
    },
    setDiagnostics(items = []) {
      const diagnostics = items.map((item) => {
        const line = view.state.doc.line(clamp(Number(item.line || 0) + 1, 1, view.state.doc.lines));
        return {
          from: line.from,
          to: Math.max(line.from, line.to),
          severity: item.severity === "error" ? "error" : "warning",
          message: String(item.message || ""),
        };
      });
      view.dispatch(setDiagnostics(view.state, diagnostics));
    },
    requestMeasure() { view.requestMeasure(); },
    destroy() { view.destroy(); },
  };

  Object.defineProperties(host, {
    value: {
      configurable: true,
      get: () => controller.value,
      set: (value) => controller.setValue(value),
    },
    selectionStart: { configurable: true, get: () => controller.selectionStart },
    selectionEnd: { configurable: true, get: () => controller.selectionEnd },
    scrollTop: {
      configurable: true,
      get: () => controller.scrollTop,
      set: (value) => { controller.scrollTop = value; },
    },
    scrollLeft: {
      configurable: true,
      get: () => controller.scrollLeft,
      set: (value) => { controller.scrollLeft = value; },
    },
  });
  host.focus = (options = {}) => controller.focus(options);
  host.blur = () => controller.blur();
  host.setSelectionRange = (from, to = from) => controller.setSelection(from, to);
  host.setRangeText = (replacement, from, to, selectionMode = "preserve") =>
    controller.replaceRange(replacement, from, to, selectionMode);
  host._ksCodeMirror = controller;

  view.scrollDOM.addEventListener("scroll", () => callbacks.onScroll?.(controller), { passive: true });
  return controller;
}

window.KsCodeEditor = { create };
