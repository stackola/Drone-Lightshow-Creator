import React from 'react'
import ReactDOM from 'react-dom/client'
import { initRegistries } from './registries/init'
import { AppShell } from './shell/AppShell'
import './index.css'

// Registries must exist before the shell evaluates.
initRegistries()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>,
)
