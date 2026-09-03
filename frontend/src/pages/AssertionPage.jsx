import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api, transcriptUrl, useCanvasUrl } from '../api'
import {
  Attempt,
  CATEGORIES,
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
import { freshness, parseUTC, timeAgo } from '../freshness'

const POLL_MS = 4000

/* The claim grows to fit what you write, so the field never becomes a scrolling
 * porthole onto your own sentence. */
function useAutosize(ref, value) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [ref, value])
}

/* The claim's own words. Editing happens in place — the field *is* the display
 * text — but rewording is the one edit that throws away a verdict and starts a
 * fresh agent run, so it is the one edit that asks first. Everything cheap
 * around it saves silently on blur. */
function ClaimEditor({ value, busy, onCommit }) {
  const [draft, setDraft] = useState(value)
  const ref = useRef(null)
  useAutosize(ref, draft)
  useEffect(() => setDraft(value), [value])

  const changed = draft.trim() !== value && draft.trim() !== ''

  return (
    <div className={`claim-edit ${changed ? 'dirty' : ''}`}>
      <textarea
        ref={ref}
        className="claim-field"
        value={draft}
        rows={1}
        aria-label="Claim"
        spellCheck="false"
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setDraft(value)
        }}
      />
      {changed && (
        <div className="claim-confirm">
          <span className="mono muted">
            Rewording discards this verdict and checks the new wording.
          </span>
          <div className="row">
            <button type="button" className="link" onClick={() => setDraft(value)}>
              revert
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => onCommit(draft.trim())}
            >
              Reword &amp; re-check
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* Cheap metadata: no confirmation, no save button. It commits when you look
 * away, the way a spreadsheet cell does. */
function InlineField({ value, onCommit, className, maxLength, ariaLabel, placeholder }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      type="text"
      className={`inline-field ${className || ''}`}
      value={draft}
      maxLength={maxLength}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.target.blur()
        if (e.key === 'Escape') {
          setDraft(value)
          e.target.blur()
        }
      }}
    />
  )
}

export default function AssertionPage() {
  const { assertionId } = useParams()
  const canvas = useCanvasUrl()
  const [assertion, setAssertion] = useState(null)
  const [runs, setRuns] = useState([])
  const [attempts, setAttempts] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
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
  const fresh = freshness(run)
  const checkedAt = parseUTC(run?.finished_at || run?.created_at)
  const runTranscript = transcriptUrl(canvas, run?.conversation_id)

  return (
    <>
      <section className="claim-head">
        <Link to={`/projects/${assertion.project_id}`} className="crumb">
          ← back to the repository
        </Link>

        <div className="row" style={{ gap: 6, alignItems: 'baseline' }}>
          <InlineField
            value={assertion.emoji}
            className="emoji-field"
            maxLength={8}
            ariaLabel="Emoji"
            onCommit={(emoji) => act(() => api.updateAssertion(assertionId, { emoji }))}
          />
          <InlineField
            value={assertion.title}
            className="title-field"
            maxLength={80}
            ariaLabel="Title"
            placeholder="Untitled claim"
            onCommit={(title) => act(() => api.updateAssertion(assertionId, { title }))}
          />
        </div>

        <ClaimEditor
          value={assertion.text}
          busy={busy}
          onCommit={(text) => act(() => api.updateAssertion(assertionId, { text }))}
        />

        {assertion.raw_text !== assertion.text && (
          <p className="as-typed">As you typed it: “{assertion.raw_text}”</p>
        )}

        <div className="row wrap-row claim-meta">
          <select
            className="chip-select"
            value={assertion.category}
            aria-label="Category"
            onChange={(e) =>
              act(() => api.updateAssertion(assertionId, { category: e.target.value }))
            }
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            className={`chip-select p-${assertion.priority}`}
            value={assertion.priority}
            aria-label="Priority"
            onChange={(e) =>
              act(() => api.updateAssertion(assertionId, { priority: e.target.value }))
            }
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p} priority
              </option>
            ))}
          </select>

          {/* The recheck sits with the staleness reading rather than in a row of
              buttons: the indicator states the problem, and the fix for it is
              the next thing your eye lands on. */}
          <span className="freshness-group">
            <Freshness run={run} verbose />
            <button
              className="link recheck"
              disabled={busy || status === 'checking' || status === 'queued'}
              onClick={() => act(() => api.reverify(assertionId))}
            >
              {status === 'checking' || status === 'queued'
                ? 'checking…'
                : 're-check at head'}
            </button>
          </span>
        </div>
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
            <dd>
              {run?.commit_sha ? run.commit_sha.slice(0, 12) : '—'}
              {fresh && fresh.behind > 0 && (
                <span className={`behind-note fresh-${fresh.level}`}>
                  {fresh.behind} behind head
                </span>
              )}
            </dd>
            <dt>Checked</dt>
            <dd>
              {checkedAt ? (
                <>
                  {timeAgo(checkedAt)}
                  <span className="exact-date">{checkedAt.toLocaleString()}</span>
                </>
              ) : (
                '—'
              )}
            </dd>
            <dt>Exhibits</dt>
            <dd>{run?.evidence?.length ?? 0}</dd>
            {runTranscript && (
              <>
                <dt>Agent</dt>
                <dd>
                  <a
                    href={runTranscript}
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

      {settled && (run.fixes?.length > 0 || attempts.length > 0) && (
        <section className="section">
          <SectionHead
            title="Proposed fixes"
            note="an agent applies the one you pick and opens a pull request"
          />
          {run.fixes?.length > 0 && (
            <FixList
              fixes={run.fixes}
              busy={busy || fixing}
              onApply={(fixId) => act(() => api.remediate(assertionId, fixId))}
            />
          )}
          {attempts.length > 0 && (
            <div className="attempts">
              <div className="label attempts-label">
                {attempts.length === 1 ? 'Attempt' : 'Attempts'}
              </div>
              {attempts.map((r) => (
                <Attempt
                  key={r.id}
                  remediation={r}
                  onDiscard={(id) => act(() => api.discardRemediation(id))}
                />
              ))}
            </div>
          )}
        </section>
      )}

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

      {history.length > 0 && (
        <section className="section">
          <SectionHead title="Earlier checks" note={`${history.length} before this one`} />
          {history.map((r) => (
            <div key={r.id} className="history-row">
              <Standing status={r.status === 'done' ? r.verdict || 'uncertain' : 'error'} />
              <span className="mono">
                {timeAgo(parseUTC(r.finished_at || r.created_at))} @{' '}
                {(r.commit_sha || '').slice(0, 10)}
              </span>
            </div>
          ))}
        </section>
      )}

      {/* Deleting is rare and irreversible. It lives past the end of everything
          worth reading, as a line of text rather than a button competing with
          the actions you actually came here for. */}
      <footer className="claim-foot">
        <button className="link danger" disabled={busy} onClick={remove}>
          delete this claim and its evidence
        </button>
      </footer>
    </>
  )
}
