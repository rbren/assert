// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { activate } from './extension.jsx'
import { PAGE_ROOT } from './router.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const PROJECT = {
  id: 7,
  name: 'acme/tools',
  clone_status: 'ready',
  default_branch: 'main',
  head_commit: '1234567890abcdef',
  assertion_count: 0,
  standing: {},
}

const DETAIL = { ...PROJECT, assertions: [] }

/** A host double: what Canvas hands `activate`, and nothing more. */
function hostDouble(request) {
  const mounts = new Map()
  const unregister = vi.fn(() => mounts.clear())
  return {
    apiVersion: '1',
    extension: { name: 'assert', version: '0.1.0', resolvedRef: null },
    backend: { id: 'local-test', kind: 'local', orgId: null },
    registerPage: vi.fn((id, mount) => {
      mounts.set(id, mount)
      return unregister
    }),
    navigate: vi.fn(),
    agentServer: { request },
    mounts,
    unregister,
  }
}

const backend = (routes) =>
  vi.fn(async ({ path, method = 'GET' }) => {
    const answer = routes[`${method} ${path}`] ?? routes[path]
    if (answer === undefined) throw Object.assign(new Error('not stubbed'), { status: 404 })
    return typeof answer === 'function' ? answer() : answer
  })

async function mount(host, path = '') {
  const container = document.createElement('div')
  document.body.append(container)
  let dispose
  await act(async () => {
    dispose = await host.mounts.get('claims')({ container, path, navigate: host.navigate })
  })
  return {
    container,
    dispose: async () => {
      await act(async () => dispose())
      container.remove()
    },
  }
}

let disposeActivation

afterEach(() => {
  disposeActivation?.()
  disposeActivation = undefined
  document.body.replaceChildren()
})

describe('activation', () => {
  it('registers the declared page once and unregisters on disposal', () => {
    const host = hostDouble(backend({}))

    disposeActivation = activate(host)

    expect(host.registerPage).toHaveBeenCalledTimes(1)
    expect(host.registerPage.mock.calls[0][0]).toBe('claims')

    disposeActivation()
    disposeActivation = undefined
    expect(host.unregister).toHaveBeenCalledTimes(1)
  })

  it('refuses a host that does not speak API 1', () => {
    const host = { ...hostDouble(backend({})), apiVersion: '2' }

    expect(() => activate(host)).toThrow(/host API 1/)
    expect(host.registerPage).not.toHaveBeenCalled()
  })
})

describe('the mounted page', () => {
  it('renders the repositories the backend returns', async () => {
    const request = backend({ '/api/assert/projects': [PROJECT] })
    const host = hostDouble(request)
    disposeActivation = activate(host)

    const { container } = await mount(host)

    expect(container.textContent).toContain('acme/tools')
    expect(request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/api/assert/projects',
      body: undefined,
    })
  })

  it('renders the nested route Canvas hands it', async () => {
    const request = backend({
      '/api/assert/projects': [PROJECT],
      '/api/assert/projects/7': DETAIL,
    })
    const host = hostDouble(request)
    disposeActivation = activate(host)

    const { container } = await mount(host, 'projects/acme/tools')

    expect(container.textContent).toContain('Make a claim about this code')
    expect(container.textContent).toContain('main @ 1234567890')
  })

  it('links into Canvas URLs and navigates through the host', async () => {
    const request = backend({ '/api/assert/projects': [PROJECT] })
    const host = hostDouble(request)
    disposeActivation = activate(host)

    const { container } = await mount(host)
    const link = container.querySelector('a.project-row')

    expect(link.getAttribute('href')).toBe(`${PAGE_ROOT}/projects/acme/tools`)

    await act(async () => {
      link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(host.navigate).toHaveBeenCalledWith(`${PAGE_ROOT}/projects/acme/tools`)
  })

  it('shows the backend’s own words when a request fails', async () => {
    const request = vi.fn(async () => {
      throw Object.assign(new Error('HTTP request failed (503)'), {
        status: 503,
        response: { detail: 'the checkout is locked' },
      })
    })
    const host = hostDouble(request)
    disposeActivation = activate(host)

    const { container } = await mount(host)

    expect(container.textContent).toContain('the checkout is locked')
  })

  it('survives a response that is not the shape the API promises', async () => {
    const request = backend({ '/api/assert/projects': 'not json at all' })
    const host = hostDouble(request)
    disposeActivation = activate(host)

    const { container } = await mount(host)

    expect(container.querySelector('.error')).not.toBeNull()
  })
})

describe('disposal', () => {
  it('removes the page and stops polling', async () => {
    // Fake timers: the page polls every four seconds, and the point of the
    // test is that the poll after disposal never happens.
    vi.useFakeTimers()
    const checking = { id: 3, title: 'a claim', text: 'a claim', status: 'checking', priority: 'medium', category: 'docs' }
    const request = backend({
      '/api/assert/projects': [PROJECT],
      '/api/assert/projects/7': { ...DETAIL, assertions: [checking] },
    })
    const host = hostDouble(request)
    disposeActivation = activate(host)

    const { container, dispose } = await mount(host, 'projects/acme/tools')
    expect(container.childElementCount).toBe(1)

    await dispose()
    expect(container.childElementCount).toBe(0)

    const settled = request.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(30000)
    })
    expect(request.mock.calls.length).toBe(settled)
    vi.useRealTimers()
  })

  it('leaves no stylesheet behind', async () => {
    const host = hostDouble(backend({ '/api/assert/projects': [] }))
    disposeActivation = activate(host)

    const { dispose } = await mount(host)
    await dispose()

    expect(document.getElementById('assert-canvas-style')).toBeNull()
  })
})

describe('the built bundle', () => {
  // The suite runs with frontend/ as its root; the package sits beside it.
  const root = join(process.cwd(), '..', 'extensions', 'assert')
  const manifest = JSON.parse(readFileSync(join(root, 'canvas-extension.json'), 'utf8'))
  const bundle = readFileSync(join(root, manifest.entrypoint), 'utf8')

  it('is one self-contained browser ESM file', () => {
    expect(bundle).toMatch(/export\s*\{[^}]*activate/)
    expect(bundle).not.toMatch(/(^|[;\s])import\s*[^;]*from\s*["'][^."']/)
    expect(bundle).not.toMatch(/require\(|__dirname|module\.exports/)
  })

  it('registers every page the manifest declares', () => {
    for (const page of manifest.contributes.pages) {
      expect(bundle).toContain(`registerPage("${page.id}"`)
    }
  })

  it('carries the stylesheet and its scope, and no backend secrets', () => {
    expect(bundle).toContain('.assert-ext')
    expect(bundle).not.toMatch(/X-Session-API-Key|htpasswd|127\.0\.0\.1:18400/)
  })
})
