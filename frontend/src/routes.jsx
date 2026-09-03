import { Route, Routes } from 'react-router-dom'

import Layout from './Layout.jsx'
import AssertionPage from './pages/AssertionPage.jsx'
import ProjectList from './pages/ProjectList.jsx'
import ProjectPage from './pages/ProjectPage.jsx'
import { ROUTES } from './urls.js'

/* The route table, free of any router: the standalone site puts a
 * BrowserRouter around it, the Canvas extension a router driven by the host. */
export default function AppRoutes({ embedded = false }) {
  return (
    <Routes>
      <Route element={<Layout embedded={embedded} />}>
        <Route path={ROUTES.home} element={<ProjectList />} />
        <Route path={ROUTES.project} element={<ProjectPage />} />
        <Route path={ROUTES.assertion} element={<AssertionPage />} />
      </Route>
    </Routes>
  )
}
