# assert — repo notes

App that verifies assertions about a codebase. See `README.md` for the design.

## ⚠️ Always deploy after making changes

Every change MUST be deployed before you finish — the site serves only what
is built/restarted on this host:

1. Frontend edits: `cd frontend && npm run build` (nginx serves
   `frontend/dist` directly; there is no dev server in production). The same
   command rebuilds the Canvas extension bundle.
2. Canvas extension edits: reinstall it on the agent server, which copies the
   package rather than reading it live — a rebuild alone changes nothing in
   Canvas:

   ```sh
   curl -sS -X POST http://127.0.0.1:18000/api/canvas-extensions/install \
     -H "X-Session-API-Key: $(grep -oP 'OH_SESSION_API_KEYS_0=\K.*' /etc/assert/env)" \
     -H 'content-type: application/json' \
     -d '{"source":"/root/git/assert/extensions/assert","force":true}'
   ```

   A forced reinstall keeps the enabled state; a first install lands disabled.
3. Backend edits: `systemctl restart assert-backend`.
4. Verify both fronts are serving: `curl -I` the site, open
   `https://canvas.rbren.io/extensions/assert/claims`, and check
   `journalctl -u assert-backend -f` for errors.

## Where things run on this host

- Backend: `assert-backend.service` → `127.0.0.1:18400`
  (`systemctl restart assert-backend` after backend edits; logs via
  `journalctl -u assert-backend -f`).
- Frontend: static build at `frontend/dist`, served directly by nginx.
  **Run `npm run build` after any frontend edit** — there is no dev server in
  production.
- Site: `assert.apps.canvas.rbren.io`, config at
  `/etc/nginx/sites-available/assert.apps.canvas.rbren.io` (mirrored in
  `nginx/`). Basic auth via the shared `/etc/nginx/.htpasswd`.
- Canvas: the same app runs as the `assert` Canvas extension at
  `https://canvas.rbren.io/extensions/assert/claims`, installed on the agent
  server from `/root/git/assert/extensions/assert`. Its API prefix
  `/api/assert/` is proxied to the backend by
  `/etc/nginx/snippets/assert-api.conf`, included from the canvas.rbren.io
  server block and mirrored in `nginx/canvas-assert-api.conf`.
- Secrets: `/etc/assert/env` holds `OH_SESSION_API_KEYS_0`, the agent-server
  session key. Not in git.

## Agent-server integration

Both LLM paths go through the local agent-server at `127.0.0.1:18000`:

- **Tidy pass**: `POST /v1/chat/completions` (OpenAI-compatible). The model id
  must be one from `GET /v1/models` — `openhands_fable` / `openhands_opus`,
  not a raw provider model name.
- **Investigation**: `POST /api/conversations`. The active agent profile on
  this host has an **empty tool list**, so `agent_client.TOOLS` is injected
  explicitly. The LLM key is fetched with `X-Expose-Secrets: encrypted` and
  round-tripped via `secrets_encrypted: true`, so the plaintext key never
  enters this process.

## Frontend conventions

- One app, two shells. `src/routes.jsx` is the route table; `main.jsx` wraps it
  in a `BrowserRouter` for the standalone site and `src/canvas/` wraps it in a
  router driven by Canvas. Pages and components know about neither: they call
  `api`, whose transport the Canvas entrypoint swaps for the host's
  authenticated request adapter. Anything the extension needs that the site
  does not belongs in `src/canvas/`, not in a branch inside a page.
- Verdicts: internal status values (`false`, CSS `n-false`/`s-false`) stay
  lowercase code identifiers; only the user-facing labels change (e.g. the old
  "Refuted" label is now "False").
- The `Standing` component renders the verdict word alone; the distribution
  across a set of claims is the separate `StandingAxis`.
- The claim table is header-driven: its columns (claim, category, severity,
  status) each sort on click and the three data columns filter from their own
  header menu. There are no standalone filter/sort dropdowns — add a column,
  not a control. The pure sort/filter is `arrangeClaims` in `ProjectPage.jsx`,
  tested in `ProjectPage.test.js`.
- In that header, sort is the column name plus an arrow, and filter is a
  separate outlined button under it wearing a funnel and naming what the
  column is filtered to ("filter" when it is not). A bare caret is not
  allowed there: next to a sort arrow it reads as sort direction.
- Exhibit stance (`for`/`against`) deliberately borrows no colour from the
  verdict ramp — it is told by its sign and weight, since an exhibit's side is
  not the run's verdict. Runs ingested before stances exist carry `""` and
  render no marker.

## Gotchas

- Runs are ingested from `data/reports/run-<id>.json`, written by the agent.
  Both the request handlers and a background poller in `app.py` call
  `verification.sync_run`, so a finished run lands even with no client open.
- File evidence is snapshotted into the DB at ingest time. Line numbers come
  from the agent and are read against the checkout at `run.commit_sha`; if the
  checkout has since moved, a stale excerpt is still what gets stored — that's
  intentional, the alternative is losing the evidence entirely.
- `data/` (checkouts, SQLite db, reports) is gitignored.
