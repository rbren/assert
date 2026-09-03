import { useState } from 'react'
import Markdown from 'react-markdown'

export const VERDICT_LABEL = {
  true: 'True',
  partly_true: 'Partly true',
  mostly_false: 'Mostly false',
  false: 'False',
  uncertain: 'Uncertain',
  unverifiable: 'Unverifiable',
}

export const CATEGORIES = [
  'docs',
  'tests',
  'quality',
  'code health',
  'security',
  'logic',
  'api',
]

export const PRIORITIES = ['high', 'medium', 'low']

export const EFFORT_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

/** The status a row is filtered and sorted by: a run's verdict, or its state. */
export function statusKey(a) {
  const run = a.latest_run
  if (!run) return 'queued'
  if (run.status === 'investigating') return 'investigating'
  if (run.status === 'error') return 'error'
  return run.verdict || 'uncertain'
}

export const STATUS_LABEL = {
  queued: 'Queued',
  investigating: 'Investigating',
  error: 'Error',
  ...VERDICT_LABEL,
}

// Worst-first: what needs attention sorts above what is settled.
const STATUS_ORDER = [
  'investigating',
  'queued',
  'error',
  'false',
  'mostly_false',
  'partly_true',
  'uncertain',
  'unverifiable',
  'true',
]

export function statusRank(a) {
  const i = STATUS_ORDER.indexOf(statusKey(a))
  return i === -1 ? STATUS_ORDER.length : i
}

export function priorityRank(a) {
  const i = PRIORITIES.indexOf(a.priority)
  return i === -1 ? 1 : i
}

export function Md({ children, className }) {
  if (!children) return null
  return (
    <div className={`md ${className || ''}`}>
      <Markdown>{children}</Markdown>
    </div>
  )
}

export function Verdict({ run }) {
  const key = statusKey({ latest_run: run })
  if (key === 'investigating')
    return (
      <span className="badge pending">
        <span className="spinner" /> Investigating
      </span>
    )
  if (key === 'queued') return <span className="badge pending">Queued</span>
  return <span className={`badge ${key}`}>{STATUS_LABEL[key] || key}</span>
}

export function Priority({ value }) {
  return <span className={`badge priority-${value}`}>{value}</span>
}

export function Category({ value }) {
  return <span className="chip">{value}</span>
}

export function CommitRef({ sha }) {
  if (!sha) return null
  return <span className="mono muted">@ {sha.slice(0, 10)}</span>
}

/** "current" / "3 commits behind" — how stale a run's evidence is. */
export function Freshness({ run }) {
  if (!run || run.commits_behind == null) return null
  const n = run.commits_behind
  return (
    <span className={`chip ${n === 0 ? 'fresh' : 'stale'}`}>
      {n === 0 ? 'current' : `${n} commit${n === 1 ? '' : 's'} behind`}
    </span>
  )
}

/** File content with a line-number gutter starting at `startLine`. */
function NumberedCode({ content, startLine }) {
  const lines = (content || '').split('\n')
  const first = startLine || 1
  return (
    <pre>
      <div className="code-lines">
        <div className="gutter">
          {lines.map((_, i) => (
            <div key={i}>{first + i}</div>
          ))}
        </div>
        <div>
          {lines.map((l, i) => (
            <div key={i}>{l || '\u00a0'}</div>
          ))}
        </div>
      </div>
    </pre>
  )
}

export function EvidenceItem({ item }) {
  const [open, setOpen] = useState(false)
  const isCommand = item.kind === 'command'
  const ref = isCommand
    ? `$ ${item.command}`
    : `${item.path}${
        item.start_line
          ? `:${item.start_line}${
              item.end_line && item.end_line !== item.start_line
                ? `-${item.end_line}`
                : ''
            }`
          : ''
      }`
  return (
    <div className="evidence">
      <button
        className="evidence-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="evidence-caption">{item.caption || ref}</span>
        {isCommand && item.exit_code !== null && (
          <span className={`mono ${item.exit_code === 0 ? 'exit-0' : 'exit-n'}`}>
            exit {item.exit_code}
          </span>
        )}
      </button>
      {open && (
        <div className="evidence-body">
          <div className="mono evidence-ref">{ref}</div>
          {isCommand ? (
            <>
              {item.stdout ? <pre>{item.stdout}</pre> : null}
              {item.stderr ? <pre className="stderr">{item.stderr}</pre> : null}
              {!item.stdout && !item.stderr && (
                <pre className="muted">(no output)</pre>
              )}
            </>
          ) : item.content ? (
            <NumberedCode content={item.content} startLine={item.start_line} />
          ) : (
            <pre className="muted">(file could not be read at this commit)</pre>
          )}
        </div>
      )}
    </div>
  )
}

function Fix({ fix, onApply, busy }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="fix">
      <div className="fix-head">
        <button className="fix-toggle" onClick={() => setOpen((v) => !v)}>
          <span className="caret">{open ? '▾' : '▸'}</span>
          <span className="fix-title">{fix.title || `Fix ${fix.position + 1}`}</span>
        </button>
        <span className={`chip effort-${fix.effort}`}>
          {EFFORT_LABEL[fix.effort] || fix.effort}
        </span>
        {fix.confidence != null && (
          <span className="chip">{fix.confidence}% confident</span>
        )}
        <button
          className="secondary"
          onClick={() => onApply(fix.id)}
          disabled={busy}
          title="Send an agent to apply this fix"
        >
          Apply
        </button>
      </div>
      {open && (
        <div className="fix-body">
          <Md>{fix.plan}</Md>
          {fix.notes && (
            <div className="fix-notes">
              <div className="muted">Trade-offs</div>
              <Md>{fix.notes}</Md>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function RemediationDetail({ remediation, onDiscard }) {
  const r = remediation
  if (!r) return null
  return (
    <div className="remediation">
      <div className="remediation-head">
        <h3>Attempted fix</h3>
        {r.branch && <span className="mono muted">{r.branch}</span>}
        {r.status === 'working' && (
          <span className="badge pending">
            <span className="spinner" /> Working
          </span>
        )}
        {r.status === 'done' && <span className="badge true">Applied</span>}
        {r.status === 'error' && <span className="badge false">Failed</span>}
        {r.status !== 'working' && (
          <button className="danger-link" onClick={() => onDiscard(r.id)}>
            Discard
          </button>
        )}
      </div>
      {r.error && <p className="error">{r.error}</p>}
      <Md>{r.summary}</Md>
      {r.diff && (
        <details className="diff">
          <summary>Diff</summary>
          <pre>{r.diff}</pre>
        </details>
      )}
    </div>
  )
}

export function RunDetail({ run, onApplyFix, applying }) {
  if (!run) return <p className="empty">No verification run yet.</p>
  if (run.status === 'investigating')
    return (
      <p className="muted">
        <span className="spinner" /> An agent is investigating the codebase at{' '}
        <span className="mono">{(run.commit_sha || '').slice(0, 10)}</span>. This
        usually takes a minute or two.
      </p>
    )
  if (run.status === 'error')
    return <p className="error">{run.error || 'The verification run failed.'}</p>

  return (
    <>
      <Md>{run.summary}</Md>
      {run.caveats && (
        <div className="suggestion caveats">
          <div className="muted">Caveats</div>
          <Md>{run.caveats}</Md>
        </div>
      )}

      <h2>Evidence</h2>
      {run.evidence.length === 0 ? (
        <p className="empty">The agent recorded no evidence.</p>
      ) : (
        run.evidence.map((e) => <EvidenceItem key={e.id} item={e} />)
      )}

      {run.fixes?.length > 0 && (
        <>
          <h2>Possible fixes</h2>
          {run.fixes.map((f) => (
            <Fix key={f.id} fix={f} onApply={onApplyFix} busy={applying} />
          ))}
        </>
      )}
    </>
  )
}
