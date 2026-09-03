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
}
