# assert — repo notes

App that verifies assertions about a codebase. See `README.md` for the design.

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

- Verdicts: internal status values (`false`, CSS `n-false`/`s-false`) stay
  lowercase code identifiers; only the user-facing labels change (e.g. the old
  "Refuted" label is now "False").
- The `Standing` component renders the verdict word plus an optional slider
  track; pass `track={false}` for compact list rows.

## Gotchas

- Runs are ingested from `data/reports/run-<id>.json`, written by the agent.
  Both the request handlers and a background poller in `app.py` call
  `verification.sync_run`, so a finished run lands even with no client open.
- File evidence is snapshotted into the DB at ingest time. Line numbers come
  from the agent and are read against the checkout at `run.commit_sha`; if the
  checkout has since moved, a stale excerpt is still what gets stored — that's
  intentional, the alternative is losing the evidence entirely.
- `data/` (checkouts, SQLite db, reports) is gitignored.
