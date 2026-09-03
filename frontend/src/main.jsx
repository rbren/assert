import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'

import Layout from './Layout.jsx'
import ProjectList from './pages/ProjectList.jsx'
import ProjectPage from './pages/ProjectPage.jsx'
import AssertionPage from './pages/AssertionPage.jsx'
import './styles.css'

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <ProjectList /> },
      { path: '/projects/:projectId', element: <ProjectPage /> },
      { path: '/assertions/:assertionId', element: <AssertionPage /> },
    ],
  },
])

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
