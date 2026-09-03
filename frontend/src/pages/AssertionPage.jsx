import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api'
import { CommitRef, RunDetail, Verdict } from '../components.jsx'

const POLL_MS = 4000

export default function AssertionPage() {
  const { assertionId } = useParams()
  const [assertion, setAssertion] = useState(null)
  const [runs, setRuns] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const timer = useRef(null)

  const load = useCallback(async () => {
    try {
      const [a, r] = await Promise.all([
        api.getAssertion(assertionId),
        api.listRuns(assertionId),
      ])
      setAssertion(a)
      setRuns(r)
    } catch (e) {
      setError(e.message)
    }
  }, [assertionId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const run = assertion?.latest_run
    if (assertion && run && run.status !== 'investigating') return
    if (!assertion) return
    timer.current = setTimeout(load, POLL_MS)
    return () => clearTimeout(timer.current)
  }, [assertion, load])

  async function act(fn) {
    setBusy(true)
    setError('')
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm('Delete this assertion?')) return
    const projectId = assertion.project_id
    await api.deleteAssertion(assertionId)
    navigate(`/projects/${projectId}`)
  }

  if (!assertion) return <p className="empty">{error || 'Loading…'}</p>

  const run = assertion.latest_run
  const suggestion = run?.status === 'done' ? run.suggested_text : ''
  const canAdopt = suggestion && suggestion !== assertion.text
  const history = runs.filter((r) => r.id !== run?.id)

  return (
    <>
      <p className="muted">
        <Link to={`/projects/${assertion.project_id}`}>← back to project</Link>
      </p>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h1 style={{ fontSize: 19, fontWeight: 500 }}>{assertion.text}</h1>
        <Verdict run={run} />
      </div>
      <div className="row muted" style={{ gap: 8 }}>
        <CommitRef sha={run?.commit_sha} />
        {run?.conversation_id && (
          <a
            className="mono"
            href={`/conversations/${run.conversation_id}`}
            target="_blank"
            rel="noreferrer"
          >
            agent transcript ↗
          </a>
        )}
      </div>
      {assertion.raw_text !== assertion.text && (
        <p className="muted" style={{ marginTop: 8 }}>
          As typed: “{assertion.raw_text}”
        </p>
      )}

      <div className="row" style={{ margin: '16px 0' }}>
        <button
          disabled={busy || run?.status === 'investigating'}
          onClick={() => act(() => api.reverify(assertionId))}
        >
          Re-verify at current HEAD
        </button>
        {canAdopt && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => act(() => api.updateAssertion(assertionId, suggestion))}
          >
            Adopt suggested assertion
          </button>
        )}
        <button className="danger" disabled={busy} onClick={remove}>
          Delete
        </button>
      </div>
      {error && <div className="error">{error}</div>}

      <RunDetail run={run} />

      {history.length > 0 && (
        <>
          <h2>Earlier runs</h2>
          {history.map((r) => (
            <div key={r.id} className="card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted">
                  {new Date(r.created_at + 'Z').toLocaleString()}{' '}
                  <CommitRef sha={r.commit_sha} />
                </span>
                <Verdict run={r} />
              </div>
              {r.summary && <div className="muted">{r.summary}</div>}
            </div>
          ))}
        </>
      )}
    </>
  )
}
