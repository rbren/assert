import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api'
import { Verdict } from '../components.jsx'

const POLL_MS = 4000

export default function ProjectPage() {
  const { projectId } = useParams()
  const [project, setProject] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const timer = useRef(null)

  const load = useCallback(
    () => api.getProject(projectId).then(setProject).catch((e) => setError(e.message)),
    [projectId],
  )

  useEffect(() => {
    load()
  }, [load])

  // Poll while anything is still in motion (cloning, or a run in flight).
  useEffect(() => {
    const pending =
      project &&
      (project.clone_status === 'cloning' ||
        project.assertions.some(
          (a) => !a.latest_run || a.latest_run.status === 'investigating',
        ))
    if (!pending) return
    timer.current = setTimeout(load, POLL_MS)
    return () => clearTimeout(timer.current)
  }, [project, load])

  async function submit(e) {
    e.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await api.createAssertion(projectId, text.trim())
      setText('')
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

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{project.name}</h1>
        <div className="row">
          <button onClick={() => api.refreshProject(projectId).then(load)}>
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
          <span className="muted">Enter to submit, Shift+Enter for a new line.</span>
          <button className="primary" disabled={!ready || busy || !text.trim()}>
            {busy ? 'Submitting…' : 'Assert'}
          </button>
        </div>
      </form>
      {error && <div className="error">{error}</div>}

      <h2>Assertions</h2>
      {project.assertions.length === 0 ? (
        <p className="empty">No assertions yet.</p>
      ) : (
        project.assertions.map((a) => (
          <Link key={a.id} to={`/assertions/${a.id}`} className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span className="assertion-text">{a.text}</span>
              <Verdict run={a.latest_run} />
            </div>
            {a.latest_run?.summary && (
              <div className="muted">{a.latest_run.summary.slice(0, 180)}…</div>
            )}
          </Link>
        ))
      )}
    </>
  )
}
