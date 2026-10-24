# Security

TyranoForge is a local editor. Version 0.1.x is the supported development version.

Report vulnerabilities privately through [GitHub's vulnerability reporting form](https://github.com/skyt-a/tyrano-forge/security/advisories/new).

## Access boundaries

- The HTTP server binds to IPv4 loopback only. Host headers must match the actual port and one of the two expected hostnames.
- The editor uses `127.0.0.1`. All editor API reads and writes require a random 256-bit token issued for that server instance. The token is embedded in the editor document and sent in a request header, never in URLs or logs.
- Writes also require the editor's exact Origin. Foreign or null origins, unexpected referrers, and cross-site Fetch Metadata are rejected before a route can read a request body or change state. No permissive CORS preflight is provided.
- The preview uses `localhost`, a separate origin and renderer process. It exposes only GET requests for game runtime files and a small set of preview endpoints. It cannot obtain the editor document/token or call editor APIs, including when an editor token is supplied.
- Project code is never served on the editor origin. The editor CSP restricts scripts to bundled files, prevents framing, and limits frame/media/image destinations to the preview origin.
- Electron uses context isolation, sandboxing, and disabled Node integration. Navigation stays within the expected editor/preview URLs. New app windows and non-web external protocols are denied. Permission requests are denied.
- Filesystem access rejects traversal and existing symlinks that leave the selected project. Hidden files and editor/Git metadata are not served as runtime files. Tyrano Tatie settings are parsed as JSON data and never evaluated by Node.js.

These controls protect the editor from other web origins and preview scripts. Programs already running with the same OS user's privileges can access that user's files and are outside this boundary. A game preview executes the project's JavaScript; only open projects and plugins you trust.

## Runtimes

Development, `npm start`, and CI use the host Node.js. Supported versions are 22.23.4 and later 22.x, 24.22.1 and later 24.x, and 26.12.1 and later 26.x. Those releases fix CVE-2026-111497, an out-of-bounds write in the Brotli decoder used by `node:zlib` and Node's `fetch()`. CI installs Node.js 22.23.4.

The packaged editor and desktop game exports ship Electron 43.8.3, which bundles Node.js 24.22.0. As of 2026-10-24 the newest stable Electron releases (43.8.3, 44.9.3, and 45.0.0) still bundle Node.js 24.22.0. Node.js 24.22.1 is present only in Electron 46 pre-releases. Keep the `electron` dependency on 43.8.3 until a stable release lists Node.js 24.22.1 or newer, then bump that dependency and the fallback version in `lib/studio.js` together.

The editor HTTP server reads request bodies as raw bytes. Application code does not call `node:zlib` or Node's `fetch()`. Renderer `fetch()` uses Chromium's network stack. This repository does not include PHP.

## Verification

`npm run check` includes HTTP regression tests for rejected hosts/origins, missing and expired tokens, preview API isolation, traversal/symlinks, data-only settings parsing, and navigation validation. Tests use temporary synthetic projects.

`npm run docs:screenshots` additionally exercises the production window policy in Electron: authorized saves/uploads/icon previews, a rejected browser-origin write, a rejected preview-origin write/read of editor resources, renderer isolation, asset loading, and navigation. It requires a locally installed TyranoBuilder skeleton and generates screenshots exclusively from the original Blue Hour demo.
