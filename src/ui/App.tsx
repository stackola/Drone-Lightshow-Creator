import { useEffect, useState } from 'react'
import { Users, Orbit, Map as MapIcon, AlertTriangle } from 'lucide-react'
import { TopBar } from './TopBar'
import { ScenesPanel } from './panels/ScenesPanel'
import { Inspector } from './panels/Inspector'
import { Timeline } from './timeline/Timeline'
import { Viewport } from './viewport/Viewport'
import { Present } from './Present'
import { Dialogs } from './Dialogs'
import { Segmented } from './components/controls'
import { getState, useStore, type CameraMode } from '@/state/store'
import { useShallow } from 'zustand/react/shallow'
import { seek, togglePlay } from '@/state/playback'
import { addCue, addScene, deleteCue, deleteScene, duplicateCue, duplicateScene, stepScene } from '@/state/actions'
import { loadMusic, openProjectFile, saveProject } from '@/state/persist'
import { imageShape } from './content'
import { sceneAt } from '@/core/evaluate'

function StageOverlay() {
  const camera = useStore((s) => s.camera)
  const now = useStore(useShallow((s) => {
    if (!s.compiled) return null
    const at = sceneAt(s.compiled, s.time)
    const name = at.scene >= 0 ? s.doc.scenes[at.scene]?.name : null
    if (at.phase === 'takeoff') return { verb: 'Taking off', name: null }
    if (at.phase === 'land') return { verb: 'Landing', name: null }
    if (at.phase === 'flight') return { verb: name ? 'Flying to' : 'Returning to pads', name }
    return { verb: 'Showing', name }
  }))
  const computing = useStore((s) => s.computing)
  const error = useStore((s) => s.engineError)
  const focus = useStore((s) => s.focus)
  return (
    <>
      <div className="stage-overlay ov-tl">
        <div className="glass" style={{ padding: 3 }}>
          <Segmented<CameraMode>
            value={camera}
            onChange={(c) => getState().setCamera(c)}
            options={[
              { value: 'audience', label: <><Users size={13} /> Audience</>, title: 'View from the audience (1)' },
              { value: 'orbit', label: <><Orbit size={13} /> Orbit</>, title: 'Free camera — drag to orbit, scroll to zoom (2)' },
              { value: 'top', label: <><MapIcon size={13} /> Top</>, title: 'Top-down site view (3)' },
            ]}
          />
        </div>
        {computing && <div className="glass computing"><span className="spinner" /> Planning flights…</div>}
        {error && <div className="glass computing" style={{ color: 'var(--err)' }}><AlertTriangle size={13} /> {error}</div>}
      </div>
      <div className="stage-overlay ov-tr">
        {now && (
          <div className="glass now-label">
            {now.verb} {now.name && <b>{now.name}</b>}
          </div>
        )}
      </div>
      {focus && (
        <div className="stage-overlay ov-bl">
          <div className="glass now-label" style={{ color: '#ffb4b4' }}>
            <AlertTriangle size={13} /> {focus.title}
            <button className="btn ghost sm" onClick={() => getState().set({ focus: null })}>Dismiss</button>
          </div>
        </div>
      )}
    </>
  )
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

export function App() {
  const [presenting, setPresenting] = useState(false)
  const toasts = useStore((s) => s.toasts)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (presenting) return
      const s = getState()
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        if (isTyping(e)) return
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') { if (isTyping(e)) return; e.preventDefault(); s.redo(); return }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); return }
      if (isTyping(e) || s.dialog) return
      const sel = s.selection
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        if (sel.kind === 'scene' || sel.kind === 'flight') duplicateScene(sel.id)
        else if (sel.kind === 'cue') duplicateCue(sel.id)
        return
      }
      if (mod) return
      switch (e.key) {
        case ' ': e.preventDefault(); togglePlay(); break
        case 'ArrowLeft': e.preventDefault(); seek(s.time - (e.shiftKey ? 5 : 1)); break
        case 'ArrowRight': e.preventDefault(); seek(s.time + (e.shiftKey ? 5 : 1)); break
        case 'ArrowUp': e.preventDefault(); stepScene(-1); break
        case 'ArrowDown': e.preventDefault(); stepScene(1); break
        case 'Home': seek(0); break
        case 'End': seek(s.compiled?.duration ?? 0); break
        case 'Delete': case 'Backspace':
          if (sel.kind === 'scene' || sel.kind === 'flight') deleteScene(sel.id)
          else if (sel.kind === 'cue') deleteCue(sel.id)
          break
        case '1': s.setCamera('audience'); break
        case '2': s.setCamera('orbit'); break
        case '3': s.setCamera('top'); break
        case 'p': case 'P': setPresenting(true); break
        case 'c': case 'C': addCue(s.time, 5); break
        case 'a': case 'A': addScene('circle'); break
        case '?': s.set({ dialog: 'shortcuts' }); break
        case 'Escape': s.set({ focus: null }); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [presenting])

  // Drop files anywhere: music, project files, images.
  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault() }
    const drop = async (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      e.preventDefault()
      const name = file.name.toLowerCase()
      if (file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/.test(name)) await loadMusic(await file.arrayBuffer(), file.type || 'audio/mpeg', file.name)
      else if (name.endsWith('.json')) await openProjectFile(file)
      else if (file.type.startsWith('image/')) {
        try { addScene('image', { shape: await imageShape(file, 40), name: file.name.replace(/\.[^.]+$/, '') }) } catch { getState().toast('Could not read that image.', 'err') }
      } else getState().toast('Drop music, an image, or a .droneshow.json project.', 'err')
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop) }
  }, [])

  return (
    <>
      <div className="app">
        <TopBar onPresent={() => setPresenting(true)} />
        <ScenesPanel />
        <main className="stage" aria-label="3D preview">
          {!presenting && <Viewport />}
          <StageOverlay />
        </main>
        <Inspector />
        <Timeline />
      </div>
      {presenting && <Present onExit={() => setPresenting(false)} />}
      <Dialogs />
      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : ''}`}>{t.kind === 'err' && <AlertTriangle size={14} color="var(--err)" />}{t.text}</div>
        ))}
      </div>
    </>
  )
}

