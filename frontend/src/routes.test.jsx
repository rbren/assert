// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setApiTransport } from './api.js'
import AppRoutes from './routes.jsx'

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

describe('the standalone shell', () => {
  it('renders the app under a browser router, on its own paths', async () => {
    setApiTransport(vi.fn(async () => [PROJECT]))
    window.history.pushState({}, '', '/')

    const { container, unmount } = await render(
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>,
    )

    expect(container.querySelector('a.project-row').getAttribute('href')).toBe(
      '/projects/acme/tools',
    )
    // Owning the whole document, the standalone app carries the main landmark.
    expect(container.querySelector('main.wrap')).not.toBeNull()

    await unmount()
  })

  it('hands the page body to Canvas when embedded', async () => {
    setApiTransport(vi.fn(async () => []))

    const { container, unmount } = await render(
      <BrowserRouter>
        <AppRoutes embedded />
      </BrowserRouter>,
    )

    expect(container.querySelector('main')).toBeNull()
    expect(container.querySelector('div.wrap')).not.toBeNull()

    await unmount()
  })
})
