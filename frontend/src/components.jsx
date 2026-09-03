import { useState } from 'react'
import Markdown from 'react-markdown'

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

export const EFFORT_LABEL = { easy: 'A focused edit', medium: 'Several files', hard: 'Broad change' }

/* The scale runs refuted → holds. `at` is where a verdict sits on it, 0–1.
 * `uncertain` and `unverifiable` are deliberately off the scale: no position
 * on a truth axis is an honest place to put "nobody can tell". */
export const STANDING = {
  false: { name: 'Refuted', at: 0.04, blurb: 'The agent found a counterexample.' },
  mostly_false: { name: 'Mostly false', at: 0.26, blurb: 'A narrow part holds; the claim as written does not.' },
  partly_true: { name: 'Partly true', at: 0.62, blurb: 'The substance holds, with exceptions worth naming.' },
  true: { name: 'Holds', at: 0.97, blurb: 'Holds as stated, with no material exceptions.' },
  uncertain: { name: 'No position', at: null, blurb: 'The evidence came back mixed.' },
  unverifiable: { name: 'Off the scale', at: null, blurb: 'This cannot be settled from the code alone.' },
  checking: { name: 'Checking', at: null, blurb: 'An agent is reading the code right now.' },
  queued: { name: 'Queued', at: null, blurb: 'Waiting for an agent.' },
  error: { name: 'No verdict', at: null, blurb: 'The run stopped before reaching a verdict.' },
}

export const ORDER = [
  'checking',
  'queued',
  'error',
  'false',
  'mostly_false',
  'partly_true',
  'uncertain',
  'unverifiable',
  'true',
]

export function statusOf(a) {
  return a.status || 'queued'
}

export function statusRank(a) {
  const i = ORDER.indexOf(statusOf(a))
  return i === -1 ? ORDER.length : i
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

/** `backticked` spans only, for places a block-level renderer would break the
 *  line: table rows, fix titles, anywhere the text must stay inline. */
export function Inline({ children }) {
  const parts = String(children || '').split('`')
  return parts.map((part, i) =>
    i % 2 ? <code key={i}>{part}</code> : <span key={i}>{part}</span>,
  )
}

/** Where one claim stands, as a tick on the shared scale. */
export function Standing({ status, big }) {
  const s = STANDING[status] || STANDING.error
  const searching = status === 'checking'
  const hollow = !searching && s.at === null
  return (
    <span className={`standing ${big ? 'big' : ''}`} title={s.blurb}>
      <span className="standing-track">
        <span
          className={`standing-mark ${hollow ? 'hollow' : ''} ${searching ? 'searching' : ''}`}
          style={
            searching
              ? undefined
              : { left: `${(s.at === null ? 0.5 : s.at) * 100}%` }
          }
        />
      </span>
      <span className={`standing-name n-${status}`}>{s.name}</span>
    </span>
  )
}

/** The distribution of a set of claims across the scale. Segments filter.
 *
 * Without `onSelect` it renders as inert spans — it appears inside a link on
 * the repository list, where a nested button would be invalid. */
export function StandingAxis({ counts, total, selected, onSelect, ends = true }) {
  if (!total) return null
  const Seg = onSelect ? 'button' : 'span'
  return (
    <div className={`axis ${selected ? 'filtered' : ''}`}>
      <div className="axis-scale">
        {ORDER.filter((k) => counts[k]).map((k) => {
          const n = counts[k]
          const share = (n / total) * 100
          const label = STANDING[k].name.toLowerCase()
          return (
            <Seg
              key={k}
              className={`axis-seg s-${k} ${selected === k ? 'on' : ''}`}
              style={{ flexGrow: n }}
              onClick={onSelect ? () => onSelect(selected === k ? null : k) : undefined}
              aria-pressed={onSelect ? selected === k : undefined}
              title={onSelect ? `Show only the ${label} (${n})` : `${n} ${label}`}
            >
              {share > 7 ? n : ''}
            </Seg>
          )
        })}
      </div>
      {ends && (
        <div className="axis-ends">
          <span>refuted</span>
          <span>holds</span>
        </div>
      )}
    </div>
  )
}

export function AxisLegend({ counts }) {
  const present = ORDER.filter((k) => counts[k])
  if (!present.length) return null
  return (
    <div className="axis-legend">
      {present.map((k) => (
        <span key={k} className="legend-item">
          <span className={`legend-swatch s-${k}`} />
          {counts[k]} {STANDING[k].name.toLowerCase()}
        </span>
      ))}
    </div>
  )
}

export function tally(assertions) {
  const counts = {}
  for (const a of assertions) {
    const k = statusOf(a)
    counts[k] = (counts[k] || 0) + 1
  }
  return counts
}

export function Chip({ children, className }) {
  return <span className={`chip ${className || ''}`}>{children}</span>
}

/** How far the checkout has moved since the evidence was gathered. */
export function Freshness({ run }) {
  if (!run || run.commits_behind == null) return null
  const n = run.commits_behind
  if (n === 0) return <Chip>checked at head</Chip>
  return (
    <Chip className="stale">
      {n} commit{n === 1 ? '' : 's'} since
    </Chip>
  )
}

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

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function Exhibit({ item, letter }) {
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
    <div className="exhibit" data-open={open}>
      <button className="exhibit-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="exhibit-letter">{letter}</span>
        <span className="exhibit-caption">{item.caption || ref}</span>
        <span className="exhibit-kind">
          {isCommand ? (
            item.exit_code === null ? (
              'command'
            ) : (
              <span className={item.exit_code === 0 ? 'exit-0' : 'exit-n'}>
                exit {item.exit_code}
              </span>
            )
          ) : (
            'source'
          )}
        </span>
      </button>
      {open && (
        <div className="exhibit-body">
          <div className="exhibit-ref">{ref}</div>
          {isCommand ? (
            <>
              {item.stdout ? <pre>{item.stdout}</pre> : null}
              {item.stderr ? <pre className="stderr">{item.stderr}</pre> : null}
              {!item.stdout && !item.stderr && (
                <pre className="blank">The command printed nothing.</pre>
              )}
            </>
          ) : item.content ? (
            <NumberedCode content={item.content} startLine={item.start_line} />
          ) : (
            <pre className="blank">This file is not in the checkout at that commit.</pre>
          )}
        </div>
      )}
    </div>
  )
}

export function ExhibitList({ evidence }) {
  if (!evidence?.length) return <p className="empty">The agent filed no exhibits.</p>
  return evidence.map((e, i) => (
    <Exhibit key={e.id} item={e} letter={LETTERS[i] || String(i + 1)} />
  ))
}

function Fix({ fix, onApply, busy }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="fix">
      <div className="fix-head">
        <button className="fix-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <Inline>{fix.title || 'Untitled fix'}</Inline>
        </button>
        <Chip className={fix.effort}>{EFFORT_LABEL[fix.effort] || fix.effort}</Chip>
        {fix.confidence != null && <Chip>{fix.confidence}% likely to land</Chip>}
        <button className="quiet" onClick={() => onApply(fix.id)} disabled={busy}>
          Apply this fix
        </button>
      </div>
      {open && (
        <div className="fix-body">
          <Md className="small">{fix.plan}</Md>
          {fix.notes && (
            <div className="fix-notes">
              <div className="label">What it leaves undone</div>
              <Md className="small">{fix.notes}</Md>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function FixList({ fixes, onApply, busy }) {
  return fixes.map((f) => <Fix key={f.id} fix={f} onApply={onApply} busy={busy} />)
}

export function Attempt({ remediation: r, onDiscard }) {
  if (!r) return null
  return (
    <div className="attempt">
      <div className="attempt-head">
        <h3>Attempted fix</h3>
        {r.status === 'working' && (
          <span className="mono muted">
            <span className="spinner" /> an agent is writing the change
          </span>
        )}
        {r.status === 'done' && <span className="standing-name n-true">Applied</span>}
        {r.status === 'error' && <span className="standing-name n-false">Stopped</span>}
        {r.branch && <Chip>{r.branch}</Chip>}
        <span style={{ flex: 1 }} />
        {r.status !== 'working' && (
          <button className="link" onClick={() => onDiscard(r.id)}>
            Discard the branch
          </button>
        )}
      </div>
      {r.error && <div className="error">{r.error}</div>}
      <Md className="small">{r.summary}</Md>
      {r.diff && (
        <details className="diff">
          <summary>Read the diff</summary>
          <pre>{r.diff}</pre>
        </details>
      )}
    </div>
  )
}

export function SectionHead({ title, note }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      <span className="rule" />
      {note && <span className="section-note">{note}</span>}
    </div>
  )
}
