import { Suspense, lazy, useEffect, useState } from 'react'

const CopilotPanel = lazy(() => import('./ai/CopilotPanel').then((m) => ({ default: m.CopilotPanel })))
import { Users, Orbit, Map as MapIcon, AlertTriangle } from 'lucide-react'
import { TopBar } from './TopBar'
import { ScenesPanel } from './panels/ScenesPanel'
import { Inspector } from './panels/Inspector'
import { openCopilot } from './ai/openCopilot'
import { Sparkles, SlidersHorizontal } from 'lucide-react'
import { Timeline } from './timeline/Timeline'
import { Viewport } from './viewport/Viewport'
import { Present } from './Present'
import { Dialogs } from './Dialogs'
import { Segmented } from './components/controls'
import { getState, useStore, type CameraMode } from '@/state/store'
import { useShallow } from 'zustand/react/shallow'
import { useCopilot } from '@/ai/copilotStore'

const useCopilotRunning = () => useCopilot((s) => s.running)
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

const HINT_KEY = 'dsd.hint.dismissed'

/** One-time orientation for first-time users. */
function FirstRunHint() {
  const [open, setOpen] = useState(() => {
    try { return !localStorage.getItem(HINT_KEY) } catch { return false }
  })
  if (!open) return null
  const close = () => {
    setOpen(false)
    try { localStorage.setItem(HINT_KEY, '1') } catch { /* ignore */ }
  }
  return (
    <div className="stage-overlay ov-bl">
      <div className="glass" style={{ padding: '10px 12px', maxWidth: 380, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>This is a demo show</div>
        <div className="hint" style={{ color: 'var(--muted)' }}>
          Press <span className="kbd">Space</span> to play. Click a scene to edit it, drag block edges on the timeline to retime,
          drop in a song to sync to the beat. The safety check runs as you edit. <b>File → New show</b> starts fresh.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn sm" onClick={close}>Got it</button>
        </div>
      </div>
    </div>
  )
}

function RightPanel() {
  const tab = useStore((s) => s.rightTab)
  const running = useCopilotRunning()
  return (
    <aside className="panel right">
      <div className="right-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'inspector'} className={tab === 'inspector' ? 'on' : ''} onClick={() => getState().set({ rightTab: 'inspector' })}>
          <SlidersHorizontal size={13} /> Inspector
        </button>
        <button role="tab" aria-selected={tab === 'copilot'} className={`ai-tab ${tab === 'copilot' ? 'on' : ''}`} onClick={() => getState().set({ rightTab: 'copilot' })} title="Edit the show by conversation (Ctrl+K)">
          <Sparkles size={13} className="ai-mark" /> Copilot {running && <span className="spinner" style={{ width: 10, height: 10 }} />}
        </button>
      </div>
      <div className="right-body">
        {tab === 'copilot' ? (
          <Suspense fallback={<div className="computing" style={{ padding: 12 }}><span className="spinner" /> Loading copilot…</div>}>
            <CopilotPanel />
          </Suspense>
        ) : (
          <Inspector />
        )}
      </div>
    </aside>
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
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openCopilot(); return }
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
          <FirstRunHint />
        </main>
        <RightPanel />
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

