import { Suspense, lazy, useEffect, useState } from 'react'

const CopilotPanel = lazy(() => import('./ai/CopilotPanel').then((m) => ({ default: m.CopilotPanel })))
import { findSceneTime } from '@/core/compile'
import { findScene } from '@/core/groups'
import { MIN_KEY_TIME } from '@/core/keys'
import { Users, Orbit, Map as MapIcon, AlertTriangle, Wind, MousePointer2, Move3d, Rotate3d, Scaling, Focus, Diamond } from 'lucide-react'
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
import { getState, useStore, type CameraMode, type Tool } from '@/state/store'
import { useShallow } from 'zustand/react/shallow'
import { useCopilot } from '@/ai/copilotStore'

const useCopilotRunning = () => useCopilot((s) => s.running)
import { seek, togglePlay } from '@/state/playback'
import { addCue, addScene, deleteCue, deleteScene, duplicateCue, duplicateScene, frameScene, nudgeScene, selectedSceneId, stepScene, autoKeyTau, nudgeKey } from '@/state/actions'
import { loadMusic, openProjectFile, saveProject } from '@/state/persist'
import { imageShape } from './content'
import { sceneAt } from '@/core/evaluate'
import { useSim } from '@/state/sim'

function StageOverlay() {
  const camera = useStore((s) => s.camera)
  const now = useStore(useShallow((s) => {
    if (!s.compiled) return null
    const at = sceneAt(s.compiled, s.time)
    const name = at.scene >= 0 ? s.doc.scenes[at.scene]?.name : null
    if (at.phase === 'takeoff') return { verb: 'Taking off', name: null }
    if (at.phase === 'land') return { verb: 'Landing', name: null }
    if (at.phase === 'flight') return { verb: name ? 'Flying to' : 'Returning to pads', name }
    if (at.phase === 'groups') return { verb: 'Groups of', name }
    return { verb: 'Showing', name }
  }))
  const computing = useStore((s) => s.computing)
  const error = useStore((s) => s.engineError)
  const focus = useStore((s) => s.focus)
  const compiled = useStore((s) => s.compiled)
  const sim = useSim(useShallow((s) => ({ view: s.view, wind: s.wind, result: s.result, forCompiled: s.forCompiled })))
  const simOn = sim.view && !!sim.result?.frames && sim.forCompiled === compiled
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
        <ToolBar />
        {computing && <div className="glass computing"><span className="spinner" /> Planning flights…</div>}
        {error && <div className="glass computing" style={{ color: 'var(--err)' }}><AlertTriangle size={13} /> {error}</div>}
      </div>
      <div className="stage-overlay ov-tr">
        {now && (
          <div className="glass now-label">
            {now.verb} {now.name && <b>{now.name}</b>}
          </div>
        )}
        {simOn && (
          <div className="glass now-label sim-badge">
            <Wind size={13} /> Simulated in {sim.result!.wind.speed} m/s wind
            <button className="btn ghost sm" onClick={() => getState().set({ dialog: 'wind' })}>Results</button>
            <button className="btn ghost sm" onClick={() => useSim.setState({ view: false })}>Show plan</button>
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

const TOOLS: { value: Tool; label: React.ReactNode; title: string }[] = [
  { value: 'select', label: <MousePointer2 size={13} />, title: 'Select — click drones to pick a formation (Q)' },
  { value: 'move', label: <Move3d size={13} />, title: 'Move (W) — drag the arrows; Alt for free movement' },
  { value: 'rotate', label: <Rotate3d size={13} />, title: 'Rotate (E) — snaps to 5°; Alt for free rotation' },
  { value: 'scale', label: <Scaling size={13} />, title: 'Scale (R) — never below the safe spacing' },
]

/** Viewport tools for the selected formation. */
function ToolBar() {
  const tool = useStore((s) => s.tool)
  const id = useStore((s) => (s.selection.kind === 'scene' || s.selection.kind === 'flight' ? s.selection.id : null))
  if (!id) return null
  return (
    <div className="glass toolbar" style={{ padding: 3, display: 'flex', gap: 3 }}>
      <Segmented<Tool> value={tool} onChange={(t) => getState().set({ tool: t })} options={TOOLS} />
      <button className="btn ghost sm icon" title="Frame the formation (F)" aria-label="Frame the formation" onClick={() => frameScene(id)}><Focus size={13} /></button>
      <AutoKeyToggle id={id} />
    </div>
  )
}

/** Auto-key (K): with the playhead inside the selected formation's hold, the gizmo sets keyframes. */
function AutoKeyToggle({ id }: { id: string }) {
  const on = useStore((s) => s.autoKey)
  const status = useStore((s) => {
    if (!s.autoKey || !s.compiled) return null
    const t = findSceneTime(s.compiled, id)
    const ref = findScene(s.doc, id)
    if (!t || !ref) return null
    const tau = s.time - t.holdStart
    return tau >= MIN_KEY_TIME - 1e-6 && tau <= ref.scene.hold + 1e-6 ? `Keying “${ref.scene.name}” at ${tau.toFixed(1)} s` : 'Move the playhead into this hold to key it'
  })
  return (
    <>
      <button
        className={`btn ghost sm icon autokey${on ? ' on' : ''}`}
        aria-pressed={on}
        aria-label="Auto-key"
        title="Auto-key (K): with the playhead inside the formation’s hold, moving, turning or resizing it sets a keyframe there instead of moving the formation"
        onClick={() => getState().set({ autoKey: !on })}
      >
        <Diamond size={13} />
      </button>
      {status && <span className="autokey-status">{status}</span>}
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
      // Alt + arrows / PageUp / PageDown nudge the selected formation (Shift: 5 m).
      const target = selectedSceneId()
      if (e.altKey && target) {
        const step = e.shiftKey ? 5 : 1
        const d: Record<string, [number, number, number]> = {
          ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0], ArrowUp: [0, step, 0], ArrowDown: [0, -step, 0],
          PageUp: [0, 0, -step], PageDown: [0, 0, step],
        }
        const delta = d[e.key]
        if (delta) {
          e.preventDefault()
          // Auto-key with the playhead in the hold: nudge the keyframe there instead of the formation.
          const tau = autoKeyTau(target)
          if (tau !== null) nudgeKey(target, tau, delta)
          else nudgeScene(target, delta)
          return
        }
      }
      switch (e.key) {
        case 'q': case 'Q': s.set({ tool: 'select' }); break
        case 'w': case 'W': s.set({ tool: 'move' }); break
        case 'e': case 'E': s.set({ tool: 'rotate' }); break
        case 'r': case 'R': s.set({ tool: 'scale' }); break
        case 'f': case 'F': if (target) frameScene(target); break
        case 'k': case 'K': s.set({ autoKey: !s.autoKey }); break
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

