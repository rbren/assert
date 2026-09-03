/* assert as an Agent Canvas extension.
 *
 * The app itself is unchanged — same components, same routes, same backend.
 * Three things differ from the standalone site, and they all live here:
 *
 *   1. Origin. An extension runs inside Canvas and has none of its own, so the
 *      API calls go through the host's authenticated request adapter to a
 *      prefix the Canvas host proxies to the assert backend.
 *   2. Routing. Canvas owns the URL down to the page path and hands us the
 *      remainder; see ./router.jsx.
 *   3. Lifecycle. Canvas mounts and unmounts us repeatedly (enable/disable,
 *      route changes, backend switches), so styles are reference-counted and
 *      every mount returns a disposer.
 */
import ReactDOM from 'react-dom/client'

import { setApiTransport } from '../api.js'
import AppRoutes from '../routes.jsx'
import CanvasRouter from './router.jsx'

const HOST_API_VERSION = '1'

/* The backend is reached at the Canvas origin: nginx proxies this prefix to
 * assert's FastAPI on 127.0.0.1:18400 (nginx/canvas-assert-api.conf). Host API
 * 1 hands out no origin of its own, and a URL guessed from window.location
 * would break the moment Canvas talks to a different backend. */
const API_PREFIX = '/api/assert'

const ROOT_CLASS = 'assert-ext'
const STYLE_ID = 'assert-canvas-style'

// The app stylesheet, scoped under .assert-ext by build-extension.mjs. Absent
// when the source is loaded directly (tests), which need no styling.
const EXTENSION_CSS = typeof __ASSERT_CSS__ === 'string' ? __ASSERT_CSS__ : ''

/* One <style> shared by every mount and reference counted, because Canvas can
 * mount the page again in the same tick it unmounts the old one. */
let styleUsers = 0

function attachStyles() {
  if (styleUsers === 0 && EXTENSION_CSS) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = EXTENSION_CSS
    document.head.append(style)
  }
  styleUsers += 1

  let released = false
  return () => {
    if (released) return
    released = true
    styleUsers -= 1
    if (styleUsers === 0) document.getElementById(STYLE_ID)?.remove()
  }
}

/* The host client throws an HttpError carrying the parsed body; the app shows
 * `message` to the reader, so FastAPI's `detail` is what it should say. */
function backendError(err) {
  const detail = err?.response?.detail
  if (typeof detail === 'string' && detail) return new Error(detail)
  if (typeof err?.status === 'number') return new Error(`The assert backend answered ${err.status}.`)
  return err instanceof Error ? err : new Error('The assert backend could not be reached.')
}

export function canvasTransport(host) {
  return async (path, { method = 'GET', body } = {}) => {
    let payload
    try {
      payload = await host.agentServer.request({ method, path: `${API_PREFIX}${path}`, body })
    } catch (err) {
      throw backendError(err)
    }
    /* The host client parses JSON and hands back the raw text of anything
     * else. A 204 is empty text; text with anything in it means something
     * between Canvas and the backend answered instead of it, and the pages
     * would rather hear that than try to read a proxy's error page. */
    if (typeof payload === 'string') {
      if (payload === '') return null
      throw new Error('The assert backend answered with something that was not JSON.')
    }
    return payload === undefined ? null : payload
  }
}

export function mountPage({ container, path, navigate }) {
  const releaseStyles = attachStyles()
  const holder = document.createElement('div')
  holder.className = ROOT_CLASS
  container.append(holder)

  const root = ReactDOM.createRoot(holder)
  root.render(
    <CanvasRouter path={path} navigate={navigate}>
      <AppRoutes embedded />
    </CanvasRouter>,
  )

  return () => {
    root.unmount()
    holder.remove()
    releaseStyles()
  }
}

export function activate(host) {
  if (host.apiVersion !== HOST_API_VERSION) {
    throw new Error(
      `assert needs Canvas host API ${HOST_API_VERSION}, and this host offers ${host.apiVersion}.`,
    )
  }

  setApiTransport(canvasTransport(host))
  // "claims" is the page id declared in canvas-extension.json; Canvas admits
  // no other. Written out rather than aliased so it survives minification and
  // stays greppable in the built bundle.
  const unregister = host.registerPage('claims', mountPage)

  return () => {
    unregister()
    setApiTransport(null)
  }
}
