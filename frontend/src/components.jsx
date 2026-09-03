const VERDICT_LABEL = {
  true: 'True',
  false: 'False',
  partly_true: 'Partly true',
  unverifiable: 'Unverifiable',
}

export function Verdict({ run }) {
  if (!run) return <span className="badge pending">Queued</span>
  if (run.status === 'investigating')
    return (
      <span className="badge pending">
        <span className="spinner" /> Investigating
      </span>
    )
  if (run.status === 'error') return <span className="badge false">Error</span>
  return (
    <span className={`badge ${run.verdict}`}>
      {VERDICT_LABEL[run.verdict] || run.verdict}
    </span>
  )
}

export function CommitRef({ sha }) {
  if (!sha) return null
  return <span className="mono muted">@ {sha.slice(0, 10)}</span>
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
  const isCommand = item.kind === 'command'
  return (
    <div className="evidence">
      <div className="evidence-head">
        <span className="mono">
          {isCommand ? `$ ${item.command}` : item.path}
          {!isCommand && item.start_line
            ? `:${item.start_line}${item.end_line && item.end_line !== item.start_line ? `-${item.end_line}` : ''}`
            : ''}
        </span>
        {isCommand && item.exit_code !== null && (
          <span className={`mono ${item.exit_code === 0 ? 'exit-0' : 'exit-n'}`}>
            exit {item.exit_code}
          </span>
        )}
      </div>
      {item.caption && <div className="evidence-caption">{item.caption}</div>}
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
  )
}

export function RunDetail({ run }) {
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
      {run.summary && <p>{run.summary}</p>}
      {run.suggested_text && (
        <div className="suggestion">
          <div className="muted">Suggested assertion</div>
          <div>{run.suggested_text}</div>
        </div>
      )}
      {run.caveats && (
        <div className="suggestion caveats">
          <div className="muted">Caveats</div>
          <div>{run.caveats}</div>
        </div>
      )}
      <h2>Evidence</h2>
      {run.evidence.length === 0 ? (
        <p className="empty">The agent recorded no evidence.</p>
      ) : (
        run.evidence.map((e) => <EvidenceItem key={e.id} item={e} />)
      )}
    </>
  )
}
