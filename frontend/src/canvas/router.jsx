import { useMemo } from 'react'
import { Router, createPath, parsePath } from 'react-router-dom'

/* Canvas mounts a contributed page at /extensions/<extension>/<page path> and
 * owns the URL above that; the app owns only the remainder below it. */
export const PAGE_ROOT = '/extensions/assert/claims'

/** An app path ("/projects/acme/tools") as a Canvas URL. */
export function canvasPath(to) {
  const path = typeof to === 'string' ? to : createPath(to)
  const suffix = path === '/' ? '' : path.startsWith('/') ? path : `/${path}`
  return `${PAGE_ROOT}${suffix}`
}

/** The remainder Canvas hands the mount ("projects/acme/tools") as a location. */
export function appLocation(remainder) {
  const parsed = parsePath(`/${remainder || ''}`)
  return {
    pathname: parsed.pathname || '/',
    search: parsed.search || '',
    hash: parsed.hash || '',
    state: null,
    key: 'default',
  }
}

/* react-router driven by the host instead of by the browser: the location
 * comes from the route remainder, and every navigation goes back out through
 * Canvas, which re-mounts the page at the new remainder. Links still carry a
 * real href, so opening one in a new tab lands on the same Canvas page. */
export default function CanvasRouter({ path, navigate, children }) {
  const location = useMemo(() => appLocation(path), [path])
  const navigator = useMemo(
    () => ({
      createHref: canvasPath,
      encodeLocation: (to) => {
        const parsed = parsePath(typeof to === 'string' ? to : createPath(to))
        return {
          pathname: parsed.pathname || '/',
          search: parsed.search || '',
          hash: parsed.hash || '',
        }
      },
      // Canvas's navigate takes a path and nothing else, so a replace becomes a
      // push: the app's canonicalising redirects leave a history entry behind.
      push: (to) => navigate(canvasPath(to)),
      replace: (to) => navigate(canvasPath(to)),
      go: (delta) => window.history.go(delta),
    }),
    [navigate],
  )

  return (
    <Router location={location} navigator={navigator}>
      {children}
    </Router>
  )
}
