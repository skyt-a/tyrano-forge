"use strict";

const crypto = require("crypto");

const PREVIEW_APIS = new Set([
  "/api/preview-bootstrap.ks",
  "/api/preview-line.ks",
  "/api/editor-system/chara_define.ks",
]);
const WRITE_APIS = new Set([
  "/api/project/open", "/api/project/create", "/api/asset/upload",
  "/api/tyrano-tatie/install", "/api/settings/save", "/api/build",
  "/api/reveal", "/api/ui-prefs", "/api/project/last-file",
  "/api/scenario/save", "/api/scenario/line", "/api/scenario/lineop",
  "/api/scenario/update-tag", "/api/scenario/insert", "/api/label/rename",
  "/api/backup/restore", "/api/tatie/frame", "/api/config/save",
]);

function deny(status, message) {
  const error = new Error(message);
  error.httpStatus = status;
  throw error;
}

function originOf(value) {
  try { return new URL(value).origin; } catch { return ""; }
}

function createAccessControl(port) {
  const token = crypto.randomBytes(32).toString("hex");
  const editorOrigin = `http://127.0.0.1:${port}`;
  const previewOrigin = `http://localhost:${port}`;
  const editorHost = new URL(editorOrigin).host;
  const previewHost = new URL(previewOrigin).host;

  function validate(req) {
    const host = String(req.headers.host || "").toLowerCase();
    const role = host === editorHost ? "editor" : host === previewHost ? "preview" : "";
    if (!role) deny(403, "Unrecognized local host");
    const expectedOrigin = originOf(role === "editor" ? editorOrigin : previewOrigin);
    const url = new URL(req.url, expectedOrigin);
    if (url.origin !== expectedOrigin) deny(403, "Invalid request URL");
    const origin = req.headers.origin;
    const referer = originOf(req.headers.referer || "");
    const fromEditor = origin === originOf(editorOrigin) || referer === originOf(editorOrigin);
    const previewRead = role === "preview" && req.method === "GET";
    if (origin && origin !== expectedOrigin && !(previewRead && origin === originOf(editorOrigin))) {
      deny(403, "Untrusted request origin");
    }
    if (req.headers["sec-fetch-site"] === "cross-site" && !(previewRead && fromEditor)) {
      deny(403, "Cross-site request denied");
    }
    if (referer && referer !== expectedOrigin && !(previewRead && fromEditor)) {
      deny(403, "Untrusted request referrer");
    }
    if (req.method === "OPTIONS") deny(403, "Cross-origin API access is disabled");
    if (!["GET", "POST"].includes(req.method)) deny(405, "Method not allowed");

    const pathname = url.pathname;
    if (role === "preview") {
      if (req.method !== "GET") deny(403, "Preview is read-only");
      if (!(pathname.startsWith("/project/") || pathname === "/preview-bridge.js" || PREVIEW_APIS.has(pathname))) {
        deny(403, "Editor resources are unavailable to the preview");
      }
    } else {
      if (pathname.startsWith("/project/") || pathname === "/preview-bridge.js" || PREVIEW_APIS.has(pathname)) {
        deny(403, "Project content must use the preview origin");
      }
      if (pathname.startsWith("/api/")) {
        if (req.method === "POST" && origin !== expectedOrigin) {
          deny(403, "Editor origin required for writes");
        }
        const supplied = Buffer.from(String(req.headers["x-tyranoforge-session"] || ""));
        const expected = Buffer.from(token);
        if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
          deny(403, "Editor session required; reload the editor");
        }
        const allowed = pathname === "/api/build/icon" ? ["GET", "POST"] : [WRITE_APIS.has(pathname) ? "POST" : "GET"];
        if (!allowed.includes(req.method)) deny(405, "Method not allowed");
      } else if (req.method !== "GET") {
        deny(405, "Method not allowed");
      }
    }
    return { role, url };
  }

  function setHeaders(res, role) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin");
    if (role === "editor") {
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      res.setHeader("Content-Security-Policy", [
        "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
        `img-src 'self' ${previewOrigin} data: blob:`, `media-src 'self' ${previewOrigin} blob:`,
        `frame-src ${previewOrigin}`, "connect-src 'self'", "worker-src 'self'",
        "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
      ].join("; "));
    } else {
      res.setHeader("Content-Security-Policy", `frame-ancestors ${editorOrigin}`);
    }
  }

  function editorHtml(source) {
    return source.replace("<head>", `<head>\n    <meta name="tyranoforge-session" content="${token}">`);
  }

  return { validate, setHeaders, editorHtml, editorOrigin, previewOrigin };
}

module.exports = { createAccessControl };
