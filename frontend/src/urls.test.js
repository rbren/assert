import { describe, expect, it } from 'vitest'
import { matchRoutes } from 'react-router-dom'

import { ROUTES, assertionPath, assertionSlug, findAssertion, findProject, projectPath } from './urls.js'

const project = { id: 7, name: 'acme/assert' }

const routes = [
  {
    path: ROUTES.home,
    children: [
      { path: ROUTES.home },
      { path: ROUTES.project },
      { path: ROUTES.assertion },
    ],
  },
]

describe('canonical project and assertion URLs', () => {
  it('uses the repository owner and name for project links', () => {
    expect(projectPath(project)).toBe('/projects/acme/assert')
  })

  it('converts a two-word title to a DNS-format assertion slug', () => {
    const assertion = { id: 12, title: 'Code Review' }
    expect(assertionSlug(assertion)).toBe('code-review')
    expect(assertionPath(project, assertion)).toBe('/projects/acme/assert/assertions/code-review')
  })

  it('keeps pending and punctuation-only titles routable', () => {
    expect(assertionSlug({ id: 12, title: '' })).toBe('assertion-12')
    expect(assertionSlug({ id: 12, title: '💡' })).toBe('assertion-12')
  })

  it('finds a project from a direct navigation route without case sensitivity', () => {
    const found = findProject([project], 'Acme', 'ASSERT')
    expect(found).toBe(project)
  })

  it('redirects a pending assertion path after its title is generated', () => {
    const assertion = { id: 12, title: 'Code Review' }
    expect(findAssertion([assertion], 'assertion-12')).toBe(assertion)
  })
})

describe('canonical browser routes', () => {
  it('matches direct project navigation', () => {
    const matches = matchRoutes(routes, '/projects/acme/assert')
    expect(matches.at(-1).params).toMatchObject({ org: 'acme', repo: 'assert' })
  })

  it('matches direct assertion navigation', () => {
    const matches = matchRoutes(routes, '/projects/acme/assert/assertions/code-review')
    expect(matches.at(-1).params).toMatchObject({
      org: 'acme',
      repo: 'assert',
      slug: 'code-review',
    })
  })
})
