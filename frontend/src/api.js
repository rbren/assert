import { useEffect, useState } from 'react'

async function req(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = (await res.json()).detail || detail
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail)
  }
  return res.status === 204 ? null : res.json()
}

export const api = {
  listProjects: () => req('/projects'),
  createProject: (repoUrl) =>
    req('/projects', { method: 'POST', body: JSON.stringify({ repo_url: repoUrl }) }),
  getProject: (id) => req(`/projects/${id}`),
  refreshProject: (id) => req(`/projects/${id}/refresh`, { method: 'POST' }),
  deleteProject: (id) => req(`/projects/${id}`, { method: 'DELETE' }),

  createAssertion: (projectId, text, priority) =>
    req(`/projects/${projectId}/assertions`, {
      method: 'POST',
      body: JSON.stringify({ text, priority }),
    }),
  getAssertion: (id) => req(`/assertions/${id}`),
  listRuns: (id) => req(`/assertions/${id}/runs`),
  updateAssertion: (id, patch) =>
    req(`/assertions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  reverify: (id) => req(`/assertions/${id}/verify`, { method: 'POST' }),
  deleteAssertion: (id) => req(`/assertions/${id}`, { method: 'DELETE' }),

  remediate: (id, fixId) =>
    req(`/assertions/${id}/remediate`, {
      method: 'POST',
      body: JSON.stringify({ fix_id: fixId ?? null }),
    }),
  listRemediations: (id) => req(`/assertions/${id}/remediations`),
  discardRemediation: (id) => req(`/remediations/${id}`, { method: 'DELETE' }),

  health: () => req('/health'),
}

// Transcripts live on the agent-canvas host, not on assert's own domain, so
// the base URL comes from the backend rather than being relative. Fetched
// once and shared; components read it through useCanvasUrl().
let canvasUrlPromise = null

export function loadCanvasUrl() {
  if (!canvasUrlPromise) {
    canvasUrlPromise = api.health().then((h) => h?.canvas_url || '')
  }
  return canvasUrlPromise
}

export function useCanvasUrl() {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let live = true
    loadCanvasUrl().then((u) => live && setUrl(u))
    return () => {
      live = false
    }
  }, [])
  return url
}

export function transcriptUrl(base, conversationId) {
  return base && conversationId ? `${base}/conversations/${conversationId}` : null
}
