export const ROUTES = {
  home: '/',
  project: '/projects/:org/:repo',
  assertion: '/projects/:org/:repo/assertions/:slug',
}

export function assertionSlug(assertion) {
  const title = assertion.title || `assertion ${assertion.id}`
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || `assertion-${assertion.id}`
}

function projectParts(project) {
  const [org, repo] = project.name.split('/', 2)
  return { org, repo }
}

export function projectPath(project) {
  const { org, repo } = projectParts(project)
  return `/projects/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`
}

export function assertionPath(project, assertion) {
  return `${projectPath(project)}/assertions/${encodeURIComponent(assertionSlug(assertion))}`
}

export function findProject(projects, org, repo) {
  const name = `${org}/${repo}`.toLowerCase()
  return projects.find((project) => project.name.toLowerCase() === name)
}

export function findAssertion(assertions, slug) {
  return (
    assertions.find((assertion) => assertionSlug(assertion) === slug) ||
    assertions.find((assertion) => `assertion-${assertion.id}` === slug)
  )
}
