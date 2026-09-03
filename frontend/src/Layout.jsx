import { Link, Outlet } from 'react-router-dom'

/* `embedded` is the Canvas extension: Canvas already wraps a contributed page
 * in a <main>, and a second one would put two main landmarks on the page. */
export default function Layout({ embedded = false }) {
  const Body = embedded ? 'div' : 'main'
  return (
    <>
      <header className="top">
        <div className="wrap">
          <Link to="/" className="brand" aria-label="assert, home">
            <span className="brand-mark" aria-hidden="true" />
            assert
          </Link>
          <span className="tagline">say it, then find out</span>
        </div>
      </header>
      <Body className="wrap">
        <Outlet />
      </Body>
    </>
  )
}
