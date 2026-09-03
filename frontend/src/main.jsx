import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'

import Layout from './Layout.jsx'
import ProjectList from './pages/ProjectList.jsx'
import ProjectPage from './pages/ProjectPage.jsx'
import AssertionPage from './pages/AssertionPage.jsx'
import { ROUTES } from './urls.js'
import './styles.css'

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: ROUTES.home, element: <ProjectList /> },
      { path: ROUTES.project, element: <ProjectPage /> },
      { path: ROUTES.assertion, element: <AssertionPage /> },
    ],
  },
])

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
