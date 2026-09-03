import { useEffect, useState } from 'react'

/* The app reaches its backend two ways. Served from its own domain it calls
 * /api on the same origin; mounted as an Agent Canvas extension it has no
 * origin of its own and goes through the host's authenticated request adapter.
 * Everything below is written against `transport`, which the Canvas entrypoint
 * swaps out at activation. */
export async function fetchTransport(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
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

let transport = fetchTransport

export function setApiTransport(next) {
  transport = next || fetchTransport
  // The canvas URL below is read once per transport: a different transport is
  // a different backend, so the cached answer no longer applies.
  canvasUrlPromise = null
}

const req = (path, options) => transport(path, options)

export const api = {
  listProjects: () => req('/projects'),
  createProject: (repoUrl) => req('/projects', { method: 'POST', body: { repo_url: repoUrl } }),
  getProject: (id) => req(`/projects/${id}`),
  refreshProject: (id) => req(`/projects/${id}/refresh`, { method: 'POST' }),
  deleteProject: (id) => req(`/projects/${id}`, { method: 'DELETE' }),

  createAssertion: (projectId, text, priority) =>
    req(`/projects/${projectId}/assertions`, {
      method: 'POST',
      body: { text, priority },
    }),
  getAssertion: (id) => req(`/assertions/${id}`),
  listRuns: (id) => req(`/assertions/${id}/runs`),
  updateAssertion: (id, patch) => req(`/assertions/${id}`, { method: 'PATCH', body: patch }),
  reverify: (id) => req(`/assertions/${id}/verify`, { method: 'POST' }),
  deleteAssertion: (id) => req(`/assertions/${id}`, { method: 'DELETE' }),

  remediate: (id, fixId) =>
    req(`/assertions/${id}/remediate`, {
      method: 'POST',
      body: { fix_id: fixId ?? null },
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
