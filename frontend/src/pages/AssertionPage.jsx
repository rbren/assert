import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api'
import {
  Attempt,
  CATEGORIES,
  Chip,
  ExhibitList,
  FixList,
  Freshness,
  Md,
  PRIORITIES,
  SectionHead,
  STANDING,
  Standing,
  statusOf,
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
      <span className="label">Edit this claim</span>
      <div className="row" style={{ marginTop: 12 }}>
        <input
          type="text"
          className="emoji-input"
          value={emoji}
          maxLength={8}
          aria-label="Emoji"
          onChange={(e) => setEmoji(e.target.value)}
        />
        <input
          type="text"
          value={title}
          maxLength={80}
          placeholder="Short label"
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
              {p} priority
            </option>
          ))}
        </select>
      </div>
      <textarea
        rows={3}
        value={text}
        aria-label="Claim"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="compose-foot">
        <span className="mono muted">
          {textChanged
            ? 'Rewording the claim starts a fresh check.'
            : 'Your words are kept exactly as written.'}
        </span>
        <div className="row">
          <button type="button" className="quiet" onClick={onCancel} disabled={busy}>
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
  const [attempts, setAttempts] = useState([])
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
      setAttempts(m)
    } catch (e) {
      setError(e.message)
    }
  }, [assertionId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!assertion) return
    const status = statusOf(assertion)
    const pending =
      status === 'checking' ||
      status === 'queued' ||
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
    if (!confirm('Delete this claim and everything the agent found?')) return
    const projectId = assertion.project_id
    await api.deleteAssertion(assertionId)
    navigate(`/projects/${projectId}`)
  }

  if (!assertion) return <p className="empty">{error || 'Loading…'}</p>

  const run = assertion.latest_run
  const status = statusOf(assertion)
  const history = runs.filter((r) => r.id !== run?.id)
  const settled = run?.status === 'done'
  const fixing = assertion.latest_remediation?.status === 'working'

  return (
    <>
      <section className="claim-head">
        <Link to={`/projects/${assertion.project_id}`} className="crumb">
          ← back to the repository
        </Link>

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
            <div className="row" style={{ gap: 14, alignItems: 'baseline' }}>
              <span className="claim-emoji" aria-hidden="true">
                {assertion.emoji}
              </span>
              <h1>{assertion.title || 'Claim'}</h1>
            </div>
            <div className="claim-statement">
              <Md>{assertion.text}</Md>
            </div>
            {assertion.raw_text !== assertion.text && (
              <p className="as-typed">As you typed it: “{assertion.raw_text}”</p>
            )}
            <div className="row wrap-row" style={{ gap: 8, marginTop: 18 }}>
              <Chip>{assertion.category}</Chip>
              <Chip className={assertion.priority}>{assertion.priority} priority</Chip>
              <Freshness run={run} />
            </div>
            <div className="row wrap-row" style={{ marginTop: 20 }}>
              <button
                className="quiet"
                disabled={busy || status === 'checking'}
                onClick={() => act(() => api.reverify(assertionId))}
              >
                Check again at head
              </button>
              <button className="quiet" disabled={busy} onClick={() => setEditing(true)}>
                Edit
              </button>
              <button className="quiet danger" disabled={busy} onClick={remove}>
                Delete
              </button>
            </div>
          </>
        )}
        {error && <div className="error">{error}</div>}
      </section>

      <section className="verdict-panel">
        <div>
          {status === 'checking' && (
            <p className="md">
              An agent is reading the repository now. It looks for counterexamples
              first, so a verdict takes a minute or two.
            </p>
          )}
          {status === 'queued' && (
            <p className="md">This claim is waiting for an agent to pick it up.</p>
          )}
          {status === 'error' && (
            <p className="md">
              {run?.error || 'The run stopped before it reached a verdict.'} Nothing was
              decided — check again to retry.
            </p>
          )}
          {settled && <Md>{run.summary}</Md>}
          {settled && run.caveats && (
            <div className="caveats">
              <div className="label">Caveats</div>
              <Md className="small">{run.caveats}</Md>
            </div>
          )}
        </div>

        <aside className="verdict-aside">
          <span className="label">Where it stands</span>
          <div style={{ margin: '14px 0 10px' }}>
            <Standing status={status} big />
          </div>
          <p className="mono muted" style={{ fontSize: 12, margin: 0 }}>
            {STANDING[status].blurb}
          </p>
          <dl>
            <dt>Commit</dt>
            <dd>{run?.commit_sha ? run.commit_sha.slice(0, 12) : '—'}</dd>
            <dt>Checked</dt>
            <dd>
              {run?.created_at ? new Date(run.created_at + 'Z').toLocaleString() : '—'}
            </dd>
            <dt>Exhibits</dt>
            <dd>{run?.evidence?.length ?? 0}</dd>
            {run?.conversation_id && (
              <>
                <dt>Agent</dt>
                <dd>
                  <a
                    href={`/conversations/${run.conversation_id}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}
                  >
                    read the transcript ↗
                  </a>
                </dd>
              </>
            )}
          </dl>
        </aside>
      </section>

      {settled && (
        <section className="section">
          <SectionHead
            title="Exhibits"
            note={
              run.commit_sha
                ? `gathered at ${run.commit_sha.slice(0, 10)} — reproduce them yourself`
                : ''
            }
          />
          <ExhibitList evidence={run.evidence} />
        </section>
      )}

      {settled && run.fixes?.length > 0 && (
        <section className="section">
          <SectionHead
            title="Ways to make it true"
            note="an agent applies the one you pick, on its own branch"
          />
          <FixList
            fixes={run.fixes}
            busy={busy || fixing}
            onApply={(fixId) => act(() => api.remediate(assertionId, fixId))}
          />
        </section>
      )}

      {attempts.length > 0 && (
        <section className="section">
          <SectionHead title="Fix attempts" />
          {attempts.map((r) => (
            <Attempt
              key={r.id}
              remediation={r}
              onDiscard={(id) => act(() => api.discardRemediation(id))}
            />
          ))}
        </section>
      )}

      {history.length > 0 && (
        <section className="section">
          <SectionHead title="Earlier checks" note={`${history.length} before this one`} />
          {history.map((r) => (
            <div key={r.id} className="history-row">
              <Standing status={r.status === 'done' ? r.verdict || 'uncertain' : 'error'} />
              <span className="mono">
                {new Date(r.created_at + 'Z').toLocaleDateString()} @{' '}
                {(r.commit_sha || '').slice(0, 10)}
              </span>
            </div>
          ))}
        </section>
      )}
    </>
  )
}
