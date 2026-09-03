import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api'
import {
  AxisLegend,
  CATEGORIES,
  Chip,
  Freshness,
  Inline,
  ORDER,
  PRIORITIES,
  STANDING,
  Standing,
  StandingAxis,
  priorityRank,
  statusOf,
  statusRank,
  tally,
} from '../components.jsx'
import { assertionPath, findProject } from '../urls.js'

const POLL_MS = 4000

const SUGGESTIONS = [
  'Test coverage is > 80%',
  'There are no critical or high CVEs',
  'All tests are run in CI/CD',
  'Deployment process is automated and conforms to semver',
  'AGENTS.md exists, conforms to best practices, and is up to date',
]

/* The table's columns. Each one is its own sort, and the three data columns
 * are their own filter too — the header is the only control there is. */
export const COLUMNS = {
  claim: { label: 'Claim', key: (a) => -a.id },
  category: { label: 'Category', key: (a) => a.category || '', value: (a) => a.category },
  severity: { label: 'Severity', key: priorityRank, value: (a) => a.priority },
  status: { label: 'Status', key: statusRank, value: statusOf },
}

export const NO_FILTERS = { category: null, severity: null, status: null }

export function arrangeClaims(assertions, sort, filters) {
  const rows = assertions.filter((a) =>
    Object.entries(filters).every(([col, want]) => !want || COLUMNS[col].value(a) === want),
  )
  const keyOf = COLUMNS[sort.col].key
  const flip = sort.dir === 'desc' ? -1 : 1
  // Status, then severity, break every other tie — so sorting by status leads
  // each verdict group with its highest-severity claims.
  return rows.sort((x, y) => {
    const kx = keyOf(x)
    const ky = keyOf(y)
    if (kx < ky) return -flip
    if (kx > ky) return flip
    return statusRank(x) - statusRank(y) || priorityRank(x) - priorityRank(y) || y.id - x.id
  })
}

/* A funnel, not a caret: a bare arrow in a table header reads as sort
 * direction, which is the one thing this control is not. */
function Funnel() {
  return (
    <svg className="funnel" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <path d="M0.5 1.5h13L8.4 7.6v4.6l-2.8 1.5V7.6z" fill="currentColor" />
    </svg>
  )
}

/** A header cell: click the word to sort by it, the funnel to filter on it. */
function ColumnHead({ col, sort, onSort, options, filter, onFilter, allLabel }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  const { label } = COLUMNS[col]
  const sorted = sort.col === col
  const active = options?.find((o) => o.value === filter)

  useEffect(() => {
    if (!open) return
    const away = (e) => {
      if (!box.current?.contains(e.target)) setOpen(false)
    }
    const esc = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div
      className={`col-head ${sorted ? 'sorted' : ''} ${filter ? 'filtered' : ''}`}
      ref={box}
    >
      <button
        className="col-sort"
        onClick={() => onSort(col)}
        aria-sort={sorted ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        title={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        <span className="col-arrow" aria-hidden="true">
          {sorted ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
      {options && (
        <>
          <button
            className="col-filter"
            aria-expanded={open}
            aria-label={
              active
                ? `${label} filtered to ${active.label} — change it`
                : `Filter by ${label.toLowerCase()}`
            }
            onClick={() => setOpen((v) => !v)}
            title={
              active
                ? `Showing only ${active.label} — click to change`
                : `Filter by ${label.toLowerCase()}`
            }
          >
            <Funnel />
            <span className="col-filter-word">{active ? active.label : 'filter'}</span>
          </button>
          {open && (
            <div className="col-menu">
              <button
                className={filter ? '' : 'on'}
                onClick={() => {
                  onFilter(null)
                  setOpen(false)
                }}
              >
                <span className="col-menu-label">{allLabel}</span>
              </button>
              {options.map((o) => (
                <button
                  key={o.value}
                  className={filter === o.value ? 'on' : ''}
                  onClick={() => {
                    onFilter(o.value)
                    setOpen(false)
                  }}
                >
                  <span className="col-menu-label">{o.label}</span>
                  {o.count != null && <span className="col-menu-count">{o.count}</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ClaimRow({ a, project, onRecheck, onFix, busy }) {
  const run = a.latest_run
  const status = statusOf(a)
  const canFix = run?.status === 'done' && run.verdict !== 'true' && run.fixes?.length > 0
  const fixing = a.latest_remediation?.status === 'working'
  return (
    <div className="claim-row">
      <div className="claim-emoji" aria-hidden="true">
        {a.emoji}
      </div>
      <div>
        <Link to={assertionPath(project, a)}>
          {a.title && <div className="claim-title">{a.title}</div>}
          <div className="claim-text">
            <Inline>{a.text}</Inline>
          </div>
        </Link>
        <div className="claim-tags">
          <Freshness run={run} />
          {fixing && (
            <Chip>
              <span className="spinner" /> fixing
            </Chip>
          )}
          {a.latest_remediation?.pr_url && (
            <a
              className="chip pr-chip"
              href={a.latest_remediation.pr_url}
              target="_blank"
              rel="noreferrer"
            >
              ⑂ PR #{a.latest_remediation.pr_number}
            </a>
          )}
        </div>
      </div>
      <div className="claim-cell">
        <Chip>{a.category}</Chip>
      </div>
      <div className="claim-cell">
        <Chip className={a.priority}>{a.priority}</Chip>
      </div>
      <div className="claim-cell">
        <Standing status={status} />
      </div>
      <div className="claim-actions">
        <button
          className="quiet"
          disabled={busy || status === 'checking'}
          onClick={() => onRecheck(a.id)}
        >
          Check again
        </button>
        {canFix && (
          <button className="quiet" disabled={busy || fixing} onClick={() => onFix(a.id)}>
            Fix it
          </button>
        )}
      </div>
    </div>
  )
}

export default function ProjectPage() {
  const { org, repo } = useParams()
  const [project, setProject] = useState(null)
  const [text, setText] = useState('')
  const [priority, setPriority] = useState('medium')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [sort, setSort] = useState({ col: 'status', dir: 'asc' })
  const [filters, setFilters] = useState(NO_FILTERS)

  const navigate = useNavigate()
  const timer = useRef(null)

  const load = useCallback(
    () =>
      api
        .listProjects()
        .then((projects) => {
          const found = findProject(projects, org, repo)
          if (!found) throw new Error('Project not found')
          return api.getProject(found.id)
        })
        .then(setProject)
        .catch((e) => setError(e.message)),
    [org, repo],
  )

  useEffect(() => {
    load()
  }, [load])

  // Poll while anything is still in motion: a clone, a check, or a fix.
  useEffect(() => {
    const pending =
      project &&
      (project.clone_status === 'cloning' ||
        project.assertions.some(
          (a) =>
            statusOf(a) === 'checking' ||
            statusOf(a) === 'queued' ||
            a.latest_remediation?.status === 'working',
        ))
    if (!pending) return
    timer.current = setTimeout(load, POLL_MS)
    return () => clearTimeout(timer.current)
  }, [project, load])

  const counts = useMemo(() => tally(project?.assertions || []), [project])

  const visible = useMemo(
    () => (project ? arrangeClaims(project.assertions, sort, filters) : []),
    [project, sort, filters],
  )

  const setFilter = useCallback(
    (col, value) => setFilters((f) => ({ ...f, [col]: value })),
    [],
  )

  const toggleSort = useCallback(
    (col) =>
      setSort((s) => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' })),
    [],
  )

  async function submit(e) {
    e.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await api.createAssertion(project.id, text.trim(), priority)
      setText('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function act(fn) {
    setBusy(true)
    setError('')
    try {
      await fn()
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm(`Delete ${project.name} and every claim about it?`)) return
    await api.deleteProject(project.id)
    navigate('/')
  }

  if (!project) return <p className="empty">{error || 'Loading…'}</p>

  const ready = project.clone_status === 'ready'
  const total = project.assertions.length
  const filtered = visible.length !== total

  return (
    <>
      <section className="project-head">
        <Link to="/" className="crumb">
          ← all repositories
        </Link>
        <div className="row spread wrap-row">
          <h1>{project.name}</h1>
          <div className="row">
            <button
              className="quiet"
              disabled={busy}
              onClick={() => act(() => api.refreshProject(project.id))}
            >
              Pull latest commits
            </button>
            <button className="quiet danger" onClick={remove}>
              Delete repository
            </button>
          </div>
        </div>
        <div className="mono muted" style={{ marginTop: 6 }}>
          {ready
            ? `${project.default_branch} @ ${(project.head_commit || '').slice(0, 10)}`
            : project.clone_status === 'error'
              ? `clone failed — ${project.clone_error}`
              : 'cloning…'}
        </div>
      </section>

      {total > 0 && (
        <section className="standing-panel">
          <div className="row spread wrap-row" style={{ marginBottom: 12 }}>
            <span className="label">Where {total} claim{total === 1 ? '' : 's'} stand</span>
            {filters.status && (
              <button className="link" onClick={() => setFilter('status', null)}>
                Clear the {STANDING[filters.status].name.toLowerCase()} filter
              </button>
            )}
          </div>
          <StandingAxis
            counts={counts}
            total={total}
            selected={filters.status}
            onSelect={(k) => setFilter('status', k)}
          />
          <AxisLegend counts={counts} />
        </section>
      )}

      <section className="compose">
        <form onSubmit={submit}>
          <label className="label" htmlFor="claim" style={{ display: 'block', marginBottom: 8 }}>
            Make a claim about this code
          </label>
          <textarea
            id="claim"
            rows={2}
            value={text}
            placeholder="Every public function in the API layer declares a return type."
            disabled={!ready || busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) submit(e)
            }}
          />
          <div className="compose-foot">
            <div className="row">
              <label className="label" htmlFor="new-priority">
                Priority
              </label>
              <select
                id="new-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <button className="primary" disabled={!ready || busy || !text.trim()}>
              {busy ? 'Sending…' : 'Check this claim'}
            </button>
          </div>
        </form>
        <details className="suggestions">
          <summary>Suggested assertions</summary>
          <ul>
            {SUGGESTIONS.map((s) => (
              <li key={s}>
                <button type="button" disabled={!ready || busy} onClick={() => setText(s)}>
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </details>
        {!ready && project.clone_status === 'cloning' && (
          <p className="mono muted" style={{ marginTop: 10 }}>
            <span className="spinner" /> Waiting for the clone to finish.
          </p>
        )}
        {error && <div className="error">{error}</div>}
      </section>

      <div className="toolbar">
        <span className="toolbar-count">
          {filtered ? `${visible.length} of ${total} claims` : `${total} claim${total === 1 ? '' : 's'}`}
        </span>
        {filtered && (
          <button className="link" onClick={() => setFilters(NO_FILTERS)}>
            Clear every filter
          </button>
        )}
      </div>

      {total === 0 ? (
        <p className="empty">
          No claims yet. Write what you believe is true about this repository and an
          agent will go and check it.
        </p>
      ) : (
        <div className="ledger">
          <div className="ledger-head">
            <span />
            <ColumnHead col="claim" sort={sort} onSort={toggleSort} />
            <ColumnHead
              col="category"
              sort={sort}
              onSort={toggleSort}
              filter={filters.category}
              onFilter={(v) => setFilter('category', v)}
              allLabel="Every category"
              options={CATEGORIES.map((c) => ({ value: c, label: c }))}
            />
            <ColumnHead
              col="severity"
              sort={sort}
              onSort={toggleSort}
              filter={filters.severity}
              onFilter={(v) => setFilter('severity', v)}
              allLabel="Every severity"
              options={PRIORITIES.map((p) => ({ value: p, label: p }))}
            />
            <ColumnHead
              col="status"
              sort={sort}
              onSort={toggleSort}
              filter={filters.status}
              onFilter={(v) => setFilter('status', v)}
              allLabel="Every status"
              options={ORDER.filter((k) => counts[k]).map((k) => ({
                value: k,
                label: STANDING[k].name.toLowerCase(),
                count: counts[k],
              }))}
            />
            <span />
          </div>
          {visible.length === 0 ? (
            <p className="empty">Nothing matches these filters.</p>
          ) : (
            visible.map((a) => (
              <ClaimRow
                key={a.id}
                a={a}
                project={project}
                busy={busy}
                onRecheck={(id) => act(() => api.reverify(id))}
                onFix={(id) => act(() => api.remediate(id))}
              />
            ))
          )}
        </div>
      )}
    </>
  )
}
