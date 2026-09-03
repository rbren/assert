import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { api } from '../api'
import { SectionHead, StandingAxis } from '../components.jsx'
import { projectPath } from '../urls.js'

export default function ProjectList() {
  const [projects, setProjects] = useState(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e) => {
        setProjects([])
        setError(e.message)
      })
  }, [])

  async function submit(e) {
    e.preventDefault()
    if (!url.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const p = await api.createProject(url.trim())
      navigate(projectPath(p))
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <>
      <section className="hero">
        <h1>
          Say what you believe about a codebase. Find out if it’s&nbsp;<em>true</em>.
        </h1>
        <p className="hero-sub">
          An agent goes and reads the repository, hunts for counterexamples, and comes
          back with a verdict — plus the commands and source it stands on, pinned to
          the commit it read.
        </p>

        <form className="hero-form" onSubmit={submit}>
          <label className="label" htmlFor="repo">
            Start with a repository
          </label>
          <div className="hero-field">
            <input
              id="repo"
              type="text"
              value={url}
              autoFocus
              placeholder="github.com/owner/repo"
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
            />
            <button className="primary" disabled={busy || !url.trim()}>
              {busy ? 'Cloning…' : 'Clone it'}
            </button>
          </div>
          <p className="hero-hint">A full URL, or just owner/repo.</p>
        </form>
        {error && <div className="error">{error}</div>}
      </section>

      <section className="section">
        <SectionHead
          title="Repositories"
          note={projects?.length ? `${projects.length} under watch` : ''}
        />
        {projects === null ? (
          <p className="empty">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="empty">
            Nothing here yet. Clone a repository above and make your first claim.
          </p>
        ) : (
          projects.map((p) => (
            <Link key={p.id} to={projectPath(p)} className="project-row">
              <div>
                <div className="project-name">{p.name}</div>
                <div className="project-meta">
                  {p.clone_status === 'ready'
                    ? `${p.default_branch} @ ${(p.head_commit || '').slice(0, 10)}`
                    : p.clone_status === 'error'
                      ? `clone failed — ${p.clone_error}`
                      : 'cloning…'}
                </div>
              </div>
              <StandingAxis counts={p.standing} total={p.assertion_count} ends={false} />
              <div className="project-count">
                <strong>{p.assertion_count}</strong>
                claim{p.assertion_count === 1 ? '' : 's'}
              </div>
            </Link>
          ))
        )}
      </section>
    </>
  )
}
