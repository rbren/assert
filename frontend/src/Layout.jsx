import { Link, Outlet } from 'react-router-dom'

export default function Layout() {
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
      <main className="wrap">
        <Outlet />
      </main>
    </>
  )
}
