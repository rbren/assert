import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api'
import {
  CATEGORIES,
  Category,
  Freshness,
  PRIORITIES,
  Priority,
  STATUS_LABEL,
  Verdict,
  priorityRank,
  statusKey,
  statusRank,
} from '../components.jsx'

const POLL_MS = 4000

const SORTS = {
  status: { label: 'Status', key: statusRank },
  priority: { label: 'Priority', key: priorityRank },
  age: { label: 'Staleness', key: (a) => -(a.latest_run?.commits_behind ?? -1) },
  category: { label: 'Category', key: (a) => a.category || '' },
  title: { label: 'Title', key: (a) => (a.title || a.text).toLowerCase() },
  newest: { label: 'Newest', key: (a) => -a.id },
}

function AssertionRow({ a, onReinvestigate, onFix, busy }) {
  const run = a.latest_run
  const status = statusKey(a)
  const canFix = run?.status === 'done' && run.verdict !== 'true' && run.fixes?.length > 0
  const fixing = a.latest_remediation?.status === 'working'
  return (
    <tr>
      <td className="cell-title">
        <Link to={`/assertions/${a.id}`}>
          <span className="row-emoji">{a.emoji}</span>
          <span className="row-title">{a.title || a.text.slice(0, 40)}</span>
        </Link>
        <div className="row-sub">{a.text.slice(0, 110)}</div>
      </td>
      <td>
        <Category value={a.category} />
      </td>
      <td>
        <Priority value={a.priority} />
      </td>
      <td>
        <Verdict run={run} />
      </td>
      <td>
        <Freshness run={run} />
      </td>
      <td className="cell-actions">
        <button
          className="icon"
          title="Re-investigate at current HEAD"
          disabled={busy || run?.status === 'investigating'}
          onClick={() => onReinvestigate(a.id)}
        >
          ↻
        </button>
        <button
          className="icon"
          title={
            fixing
              ? 'A fix is already in progress'
              : canFix
                ? 'Send an agent to apply the top fix'
                : 'No fixes available'
          }
          disabled={busy || fixing || !canFix}
          onClick={() => onFix(a.id)}
        >
          🔧
        </button>
      </td>
    </tr>
  )
}

export default function ProjectPage() {
  const { projectId } = useParams()
  const [project, setProject] = useState(null)
  const [text, setText] = useState('')
  const [priority, setPriority] = useState('medium')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [sortBy, setSortBy] = useState('status')
  const [statusFilter, setStatusFilter] = useState('all')
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

  // Poll while anything is still in motion (cloning, a run, or a fix).
  useEffect(() => {
    const pending =
      project &&
      (project.clone_status === 'cloning' ||
        project.assertions.some(
          (a) =>
            !a.latest_run ||
            a.latest_run.status === 'investigating' ||
            a.latest_remediation?.status === 'working',
        ))
    if (!pending) return
    timer.current = setTimeout(load, POLL_MS)
    return () => clearTimeout(timer.current)
  }, [project, load])

  const visible = useMemo(() => {
    if (!project) return []
    const rows = project.assertions.filter(
      (a) =>
        (statusFilter === 'all' || statusKey(a) === statusFilter) &&
        (categoryFilter === 'all' || a.category === categoryFilter) &&
        (priorityFilter === 'all' || a.priority === priorityFilter),
    )
    const keyOf = SORTS[sortBy].key
    // Status is the tiebreaker for every other sort, so equal rows still
    // surface the ones needing attention first.
    return rows.sort((x, y) => {
      const kx = keyOf(x)
      const ky = keyOf(y)
      if (kx < ky) return -1
      if (kx > ky) return 1
      return statusRank(x) - statusRank(y) || y.id - x.id
    })
  }, [project, sortBy, statusFilter, categoryFilter, priorityFilter])

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
    if (!confirm(`Delete ${project.name} and all its assertions?`)) return
    await api.deleteProject(projectId)
    navigate('/')
  }

  if (!project) return <p className="empty">{error || 'Loading…'}</p>

  const ready = project.clone_status === 'ready'
  const statuses = [...new Set(project.assertions.map(statusKey))]

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{project.name}</h1>
        <div className="row">
          <button onClick={() => act(() => api.refreshProject(projectId))}>
            Refresh checkout
          </button>
          <button className="danger" onClick={remove}>
            Delete
          </button>
        </div>
      </div>
      <div className="mono muted">
        {ready
          ? `${project.default_branch} @ ${(project.head_commit || '').slice(0, 10)}`
          : project.clone_status === 'error'
            ? `clone failed: ${project.clone_error}`
            : 'cloning…'}
      </div>

      <h2>New assertion</h2>
      <form onSubmit={submit}>
        <textarea
          rows={2}
          value={text}
          placeholder="e.g. Every public function in the API layer has a type-annotated return value."
          disabled={!ready || busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) submit(e)
          }}
        />
        <div className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
          <div className="row">
            <label className="muted" htmlFor="new-priority">
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
            <span className="muted">Enter to submit, Shift+Enter for a new line.</span>
          </div>
          <button className="primary" disabled={!ready || busy || !text.trim()}>
            {busy ? 'Submitting…' : 'Assert'}
          </button>
        </div>
      </form>
      {error && <div className="error">{error}</div>}

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 28 }}>
        <h2 style={{ margin: 0 }}>
          Assertions{' '}
          <span className="muted">
            ({visible.length}
            {visible.length !== project.assertions.length
              ? ` of ${project.assertions.length}`
              : ''}
            )
          </span>
        </h2>
        <div className="row filters">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s] || s}
              </option>
            ))}
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
          >
            <option value="all">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {Object.entries(SORTS).map(([k, v]) => (
              <option key={k} value={k}>
                Sort: {v.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {project.assertions.length === 0 ? (
        <p className="empty">No assertions yet.</p>
      ) : visible.length === 0 ? (
        <p className="empty">No assertions match these filters.</p>
      ) : (
        <table className="assertions">
          <thead>
            <tr>
              <th>Assertion</th>
              <th>Category</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Evidence</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => (
              <AssertionRow
                key={a.id}
                a={a}
                busy={busy}
                onReinvestigate={(id) => act(() => api.reverify(id))}
                onFix={(id) => act(() => api.remediate(id))}
              />
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
