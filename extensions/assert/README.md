# assert — Agent Canvas extension

assert as a page inside Agent Canvas: the same React app the standalone site
serves, mounted at `/extensions/assert/claims` and talking to the same FastAPI
backend.

Manifest schema 1, host API 1, one routed page (`claims`). Routed pages are the
only contribution the current ABI implements.

## Build

The bundle is built from the app's own sources one level up, in `frontend/`
(where the build-only dependencies live — installing an extension copies this
package directory verbatim, so a `node_modules/` in here would be copied into
the agent-server install):

```sh
cd ../../frontend
npm install
npm run build             # the site's dist/ and this extension.js
npm run build:extension   # just this extension.js
npm test                  # includes the extension's lifecycle tests
```

`extension.js` is committed, because the Agent Server installs an extension by
copying files from a path or a git ref and never runs a build.

## How it reaches the backend

Canvas extensions are frontend-only: there is no hook for extension-owned
server code, and host API 1 hands out no origin or session key of its own. So
the backend is reached at the *Canvas* origin under `/api/assert/`, which nginx
proxies to `127.0.0.1:18400` (`nginx/canvas-assert-api.conf` in this repo).
Every call goes through `host.agentServer.request` with a root-relative path,
so Canvas attaches its own authentication and the extension carries no
credentials.

## Install

Installation leaves an extension **disabled**; enable it from
Customize → Extensions after reviewing it.

```jsonc
// POST /api/canvas-extensions/install   (agent server, X-Session-API-Key)
{ "source": "/root/git/assert/extensions/assert" }
```

The path is resolved **on the Agent Server machine**; add `"force": true` to
reinstall. It lands in `~/.openhands/canvas-extensions/installed/assert` and is
served at `/api/canvas-extensions/installed/assert/bundle`.

## Known limitations

- Deep links are `/extensions/assert/claims/projects/<org>/<repo>/...`; the
  standalone site's `/projects/...` URLs do not carry over.
- Canvas re-mounts the page on every route change below the page path, so
  moving between claims re-fetches rather than re-rendering in place.
- The host's `navigate` takes a path and nothing else, so the app's
  canonicalising redirects push a history entry instead of replacing one.
- The skill's validator warns that the entrypoint "may depend on Node-specific
  runtime globals": the string it matches is `{node:...}` inside minified
  React. The bundle has no Node imports, `require`, or `process` use.
