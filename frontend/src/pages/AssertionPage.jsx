import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api'
import {
  CATEGORIES,
  Category,
  CommitRef,
  Freshness,
  Md,
  PRIORITIES,
  Priority,
  RemediationDetail,
  RunDetail,
  Verdict,
} from '../components.jsx'

const POLL_MS = 4000

function EditForm({ assertion, onSave, onCancel, busy }) {
  const [text, setText] = useState(assertion.text)
  const [title, setTitle] = useState(assertion.title)
  const [emoji, setEmoji] = useState(assertion.emoji)
  const [category, setCategory] = useState(assertion.category)
  const [priority, setPriority] = useState(assertion.priority)

  const textChanged = text.trim() !== assertion.text

  return (
    <form
      className="edit-form"
      onSubmit={(e) => {
        e.preventDefault()
        onSave({ text: text.trim(), title, emoji, category, priority })
      }}
    >
      <div className="row">
        <input
          className="emoji-input"
          value={emoji}
          maxLength={8}
          aria-label="Emoji"
          onChange={(e) => setEmoji(e.target.value)}
        />
        <input
          value={title}
          maxLength={80}
          placeholder="Two-word title"
          aria-label="Title"
          onChange={(e) => setTitle(e.target.value)}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <textarea
        rows={4}
        value={text}
        aria-label="Assertion"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted">
          {textChanged
            ? 'Changing the text starts a fresh investigation.'
            : 'Markdown is supported.'}
        </span>
        <div className="row">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !text.trim()}>
            Save
          </button>
        </div>
      </div>
    </form>
  )
}

export default function AssertionPage() {
  const { assertionId } = useParams()
  const [assertion, setAssertion] = useState(null)
  const [runs, setRuns] = useState([])
  const [remediations, setRemediations] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const navigate = useNavigate()
  const timer = useRef(null)

  const load = useCallback(async () => {
    try {
      const [a, r, m] = await Promise.all([
        api.getAssertion(assertionId),
        api.listRuns(assertionId),
        api.listRemediations(assertionId),
      ])
      setAssertion(a)
      setRuns(r)
      setRemediations(m)
    } catch (e) {
      setError(e.message)
    }
  }, [assertionId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!assertion) return
    const pending =
      !assertion.latest_run ||
      assertion.latest_run.status === 'investigating' ||
      assertion.latest_remediation?.status === 'working'
    if (!pending) return
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
  const history = runs.filter((r) => r.id !== run?.id)
  const latestRemediation = assertion.latest_remediation

  return (
    <>
      <p className="muted">
        <Link to={`/projects/${assertion.project_id}`}>← back to project</Link>
      </p>

      {editing ? (
        <EditForm
          assertion={assertion}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={(patch) =>
            act(async () => {
              await api.updateAssertion(assertionId, patch)
              setEditing(false)
            })
          }
        />
      ) : (
        <>
          <div
            className="row"
            style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}
          >
            <h1 className="assertion-heading">
              <span className="row-emoji">{assertion.emoji}</span>
              {assertion.title || 'Assertion'}
            </h1>
            <Verdict run={run} />
          </div>
          <div className="row" style={{ gap: 8, marginTop: 4 }}>
            <Category value={assertion.category} />
            <Priority value={assertion.priority} />
            <Freshness run={run} />
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

          <Md className="assertion-body">{assertion.text}</Md>

          {assertion.raw_text !== assertion.text && (
            <p className="muted as-typed">As typed: “{assertion.raw_text}”</p>
          )}

          <div className="row" style={{ margin: '16px 0' }}>
            <button
              disabled={busy || run?.status === 'investigating'}
              onClick={() => act(() => api.reverify(assertionId))}
            >
              Re-investigate at current HEAD
            </button>
            <button disabled={busy} onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="danger" disabled={busy} onClick={remove}>
              Delete
            </button>
          </div>
        </>
      )}
      {error && <div className="error">{error}</div>}

      <RunDetail
        run={run}
        applying={busy || latestRemediation?.status === 'working'}
        onApplyFix={(fixId) => act(() => api.remediate(assertionId, fixId))}
      />

      {remediations.map((r) => (
        <RemediationDetail
          key={r.id}
          remediation={r}
          onDiscard={(id) => act(() => api.discardRemediation(id))}
        />
      ))}

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
              <Md className="muted">{r.summary}</Md>
            </div>
          ))}
        </>
      )}
    </>
  )
}
