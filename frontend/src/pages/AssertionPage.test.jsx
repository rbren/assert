// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setApiTransport } from '../api.js'
import AssertionPage from './AssertionPage.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const PROJECT = {
  id: 7,
  name: 'acme/tools',
  clone_status: 'ready',
  default_branch: 'main',
  head_commit: '1234567890abcdef',
}

const ASSERTION = {
  id: 12,
  emoji: '🧪',
  title: 'api-contract',
  text: 'Every public endpoint returns a documented error response.',
  raw_text: 'every endpoint has errors documented',
  category: 'api',
  priority: 'medium',
  status: 'true',
}

async function render(children) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(children))
  return { container, unmount: async () => act(async () => root.unmount()) }
}

afterEach(() => {
  setApiTransport(null)
  document.body.replaceChildren()
})

describe('the assertion page', () => {
  it('shows the current assertion prose without its previous raw wording', async () => {
    setApiTransport(
      vi.fn(async (path) => {
        if (path === '/projects') return [PROJECT]
        if (path === '/projects/7') return { ...PROJECT, assertions: [ASSERTION] }
        if (path === '/assertions/12') return ASSERTION
        if (path === '/assertions/12/runs' || path === '/assertions/12/remediations') return []
        if (path === '/health') return { canvas_url: '' }
        throw new Error(`Unexpected request: ${path}`)
      }),
    )

    const { container, unmount } = await render(
      <MemoryRouter initialEntries={['/projects/acme/tools/assertions/api-contract']}>
        <Routes>
          <Route
            path="/projects/:org/:repo/assertions/:slug"
            element={<AssertionPage />}
          />
        </Routes>
      </MemoryRouter>,
    )

    const editor = container.querySelector('textarea[aria-label="Assertion text"]')
    expect(editor).not.toBeNull()
    expect(editor.value).toBe(ASSERTION.text)
    expect(container.textContent).not.toContain('As you typed it')
    expect(container.textContent).not.toContain(ASSERTION.raw_text)

    await unmount()
  })
})
