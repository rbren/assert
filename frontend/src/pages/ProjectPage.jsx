import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api'
import {
  AxisLegend,
  CATEGORIES,
  Chip,
  Freshness,
  Inline,
  PRIORITIES,
  STANDING,
  Standing,
  StandingAxis,
  priorityRank,
  statusOf,
  statusRank,
  tally,
} from '../components.jsx'

const POLL_MS = 4000

const SORTS = {
  standing: { label: 'Standing', key: statusRank },
  priority: { label: 'Priority', key: priorityRank },
  staleness: {
    label: 'Staleness',
    key: (a) => -(a.latest_run?.commits_behind ?? -1),
  },
  category: { label: 'Category', key: (a) => a.category || '' },
  newest: { label: 'Newest', key: (a) => -a.id },
}

function ClaimRow({ a, onRecheck, onFix, busy }) {
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
        <Link to={`/assertions/${a.id}`}>
          {a.title && <div className="claim-title">{a.title}</div>}
          <div className="claim-text">
            <Inline>{a.text}</Inline>
          </div>
        </Link>
        <div className="claim-tags">
          <Chip>{a.category}</Chip>
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
      <div className="claim-standing">
        <Chip className={a.priority}>{a.priority} priority</Chip>
        <Standing status={status} track={false} />
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
  const { projectId } = useParams()
  const [project, setProject] = useState(null)
  const [text, setText] = useState('')
  const [priority, setPriority] = useState('medium')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [sortBy, setSortBy] = useState('standing')
  const [standingFilter, setStandingFilter] = useState(null)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')

  const navigate = useNavigate()
  const timer = useRef(null)

  const load = useCallback(
    () => api.getProject(projectId).then(setProject).catch((e) => setError(e.message)),
    [projectId],
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

  const visible = useMemo(() => {
    if (!project) return []
    const rows = project.assertions.filter(
      (a) =>
        (!standingFilter || statusOf(a) === standingFilter) &&
        (categoryFilter === 'all' || a.category === categoryFilter) &&
        (priorityFilter === 'all' || a.priority === priorityFilter),
    )
    const keyOf = SORTS[sortBy].key
    // Standing, then priority, break every other tie — so sorting by standing
    // leads each verdict group with its highest-priority claims.
    return [...rows].sort((x, y) => {
      const kx = keyOf(x)
      const ky = keyOf(y)
      if (kx < ky) return -1
      if (kx > ky) return 1
      return (
        statusRank(x) - statusRank(y) ||
        priorityRank(x) - priorityRank(y) ||
        y.id - x.id
      )
    })
  }, [project, sortBy, standingFilter, categoryFilter, priorityFilter])

  async function submit(e) {
    e.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await api.createAssertion(projectId, text.trim(), priority)
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
    await api.deleteProject(projectId)
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
              onClick={() => act(() => api.refreshProject(projectId))}
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
            {standingFilter && (
              <button className="link" onClick={() => setStandingFilter(null)}>
                Clear the {STANDING[standingFilter].name.toLowerCase()} filter
              </button>
            )}
          </div>
          <StandingAxis
            counts={counts}
            total={total}
            selected={standingFilter}
            onSelect={setStandingFilter}
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
              <span className="mono muted">Enter to send · Shift+Enter for a new line</span>
            </div>
            <button className="primary" disabled={!ready || busy || !text.trim()}>
              {busy ? 'Sending…' : 'Check this claim'}
            </button>
          </div>
        </form>
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
        <div className="row wrap-row">
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="all">Every category</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
            <option value="all">Every priority</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p} priority
              </option>
            ))}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {Object.entries(SORTS).map(([k, v]) => (
              <option key={k} value={k}>
                Sort by {v.label.toLowerCase()}
              </option>
            ))}
          </select>
        </div>
      </div>

      {total === 0 ? (
        <p className="empty">
          No claims yet. Write what you believe is true about this repository and an
          agent will go and check it.
        </p>
      ) : visible.length === 0 ? (
        <p className="empty">Nothing matches these filters.</p>
      ) : (
        <div className="ledger">
          {visible.map((a) => (
            <ClaimRow
              key={a.id}
              a={a}
              busy={busy}
              onRecheck={(id) => act(() => api.reverify(id))}
              onFix={(id) => act(() => api.remediate(id))}
            />
          ))}
        </div>
      )}
    </>
  )
}
