import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { api } from '../api'

export default function ProjectList() {
  const [projects, setProjects] = useState([])
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    api.listProjects().then(setProjects).catch((e) => setError(e.message))
  }, [])

  async function submit(e) {
    e.preventDefault()
    if (!url.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const p = await api.createProject(url.trim())
      navigate(`/projects/${p.id}`)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <>
      <h1>Projects</h1>
      <p className="muted">Paste a GitHub repository URL and press Enter.</p>
      <form onSubmit={submit} style={{ margin: '16px 0 8px' }}>
        <input
          type="text"
          value={url}
          autoFocus
          placeholder="https://github.com/owner/repo"
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy}
        />
      </form>
      {error && <div className="error">{error}</div>}

      <h2>Your projects</h2>
      {projects.length === 0 ? (
        <p className="empty">Nothing here yet.</p>
      ) : (
        projects.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{p.name}</strong>
              <span className="muted">
                {p.assertion_count} assertion{p.assertion_count === 1 ? '' : 's'}
              </span>
            </div>
            <div className="mono muted">
              {p.clone_status === 'ready'
                ? `${p.default_branch} @ ${(p.head_commit || '').slice(0, 10)}`
                : p.clone_status === 'error'
                  ? `clone failed: ${p.clone_error}`
                  : 'cloning…'}
            </div>
          </Link>
        ))
      )}
    </>
  )
}
