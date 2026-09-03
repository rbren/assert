# assert

Make a claim about a codebase. An agent goes and checks it, then hands back a
verdict backed by evidence you can reproduce at a specific commit.

Live at <https://assert.apps.canvas.rbren.io> (basic auth).

## How it works

1. **Paste a GitHub URL.** The backend clones the repo into
   `data/checkouts/<owner>-<repo>` and records its HEAD.
2. **Type an assertion** — "there is a README", "the widget factory takes a
   user ID", "all variables are typed".
3. **Tidy pass.** A cheap LLM call copy-edits the wording: typos, punctuation,
   phrasing. It is explicitly forbidden from changing the meaning or scope of
   the claim, and the original text is kept so you can see what you typed.
4. **Investigation.** An agent is dispatched into the checkout, pinned to the
   commit recorded at dispatch time. It hunts for counterexamples, not just
   confirmations, and writes a structured JSON report.
5. **Ingest.** The backend parses the report into a `Run` plus a list of
   `Evidence` rows and renders them.

## What gets stored

Every run records the **commit SHA** the evidence was gathered at, so the
result is reproducible rather than a vibe. Evidence is structured, not a blob
of prose:

- `kind="command"` — the command, its exit code, stdout and stderr.
- `kind="file"` — a path plus a line range. The excerpt is snapshotted at
  ingest time from the checkout at that commit, so the UI can render it with
  correct line numbers even after the checkout moves on.

Each item carries a `caption` explaining its role in the argument, and the run
carries a `summary` explaining why the evidence settles the question.

The agent also proposes a **suggested assertion** — the original claim
restated with whatever nuance it discovered folded in — plus separate
`caveats`. One click adopts the suggestion and re-verifies against it.

## Layout

```
backend/assert_app/    FastAPI + SQLAlchemy (SQLite)
  config.py            paths, ports, model ids
  models.py            Project → Assertion → Run → Evidence
  repos.py             clone / fetch / read file ranges out of a checkout
  agent_client.py      agent-server: one-shot chat + conversation dispatch
  prompts.py           the tidy-up and investigation prompts
  verification.py      tidy → dispatch → ingest report
  routes.py            REST API under /api
  app.py               app factory + background poller for in-flight runs
frontend/src/          React (Vite), react-router
nginx/                 deployed site config
systemd/               assert-backend.service
data/                  SQLite db, checkouts, agent reports (gitignored)
```

## Running locally

```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -e .
OH_SESSION_API_KEYS_0=<agent-server key> \
  .venv/bin/uvicorn assert_app.app:app --port 18400

cd frontend && npm install && npm run dev   # proxies /api → :18400
```

## Deployment

The backend runs as `assert-backend.service` on `127.0.0.1:18400`; nginx serves
`frontend/dist` statically and proxies `/api/` to it, all behind basic auth
(`/etc/nginx/.htpasswd`). After changing the frontend:

```bash
cd frontend && npm run build          # nginx serves dist/ directly
systemctl restart assert-backend      # after backend changes
```
