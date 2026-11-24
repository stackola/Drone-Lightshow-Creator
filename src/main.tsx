import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import { App } from './ui/App'
import { setTextRasterizer } from './core/defaults'
import { canvasTextMask } from './ui/content'
import { getState } from './state/store'
import { loadAutosave, restoreMusic, startAutosave } from './state/persist'
import { startEngine } from './engine/client'
import { demoById } from './app/demos'

setTextRasterizer(canvasTextMask)

const saved = loadAutosave()
getState().loadDoc(saved ?? demoById('hello')!.build())

startEngine()
startAutosave()
void restoreMusic()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
