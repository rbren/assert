import { Link, Outlet } from 'react-router-dom'

export default function Layout() {
  return (
    <>
      <header className="top">
        <div className="wrap">
          <Link to="/" className="brand">
            assert<span className="brand-dot">.</span>
          </Link>
          <span className="tagline">claims about a codebase, checked against evidence</span>
        </div>
      </header>
      <main className="wrap">
        <Outlet />
      </main>
    </>
  )
}
