import { useState } from 'react'
import { SiteDialog } from './SiteDialog'
import { AlertTriangle } from 'lucide-react'
import { getState, useStore } from '@/state/store'
import { Modal, NumberField, Segmented } from './components/controls'
import { DEMOS } from '@/app/demos'
import { newShow } from '@/core/defaults'
import { attachGeneratedMusic, exportCsv } from '@/state/persist'
import { buildDemoAsync } from '@/engine/client'
import { formatTime } from '@/core/validate'
import { Suspense, lazy } from 'react'

// AI dialogs load the Claude SDK, so they are fetched only when first opened.
const AiSettingsDialog = lazy(() => import('./ai/AiSettings').then((m) => ({ default: m.AiSettingsDialog })))
const DirectorDialog = lazy(() => import('./ai/DirectorDialog').then((m) => ({ default: m.DirectorDialog })))
const DescribeDialog = lazy(() => import('./ai/DescribeDialog').then((m) => ({ default: m.DescribeDialog })))
const PictureDialog = lazy(() => import('./ai/PictureDialog').then((m) => ({ default: m.PictureDialog })))
const PitchDialog = lazy(() => import('./ai/PitchDialog').then((m) => ({ default: m.PitchDialog })))
const Model3DDialog = lazy(() => import('./ai/Model3DDialog').then((m) => ({ default: m.Model3DDialog })))
const WindDialog = lazy(() => import('./WindDialog').then((m) => ({ default: m.WindDialog })))

export function Dialogs() {
  const dialog = useStore((s) => s.dialog)
  const close = () => getState().set({ dialog: null })
  if (dialog === 'new') return <NewShowDialog onClose={close} />
  if (dialog === 'export') return <ExportDialog onClose={close} />
  if (dialog === 'shortcuts') return <ShortcutsDialog onClose={close} />
  if (dialog === 'site') return <SiteDialog onClose={close} />
  const ai =
    dialog === 'ai-settings' ? <AiSettingsDialog onClose={close} />
    : dialog === 'director' ? <DirectorDialog onClose={close} />
    : dialog === 'describe' ? <DescribeDialog onClose={close} />
    : dialog === 'picture' ? <PictureDialog onClose={close} />
    : dialog === 'pitch' ? <PitchDialog onClose={close} />
    : dialog === 'model3d' ? <Model3DDialog onClose={close} />
    : dialog === 'wind' ? <WindDialog onClose={close} />
    : null
  if (ai) return <Suspense fallback={null}>{ai}</Suspense>
  return null
}

function NewShowDialog({ onClose }: { onClose: () => void }) {
  const [choice, setChoice] = useState<string>('blank')
  const [drones, setDrones] = useState(200)
  const [building, setBuilding] = useState(false)
  const create = async () => {
    const s = getState()
    const demo = DEMOS.find((d) => d.id === choice)
    let doc
    try {
      if (demo?.heavy) {
        setBuilding(true)
        doc = await buildDemoAsync(demo.id)
      } else doc = demo ? demo.build() : newShow(drones, 'Untitled show')
    } catch (err) {
      setBuilding(false)
      s.toast(`Could not build the demo: ${err instanceof Error ? err.message : String(err)}`, 'err')
      return
    }
    s.replaceDoc(doc, 'New show')
    s.set({ audio: null, selection: { kind: 'show' }, time: 0, focus: null })
    if (doc.audio?.generated) void attachGeneratedMusic()
    s.toast(demo ? `Opened demo “${demo.title}” — Undo to go back` : 'New show — Undo to go back')
    onClose()
  }
  return (
    <Modal
      title="New show"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={building} onClick={() => void create()}>
            {building ? <><span className="spinner" /> Planning the show…</> : 'Create'}
          </button>
        </>
      }
    >
      <div className="choice-grid">
        <button className={`choice${choice === 'blank' ? ' on' : ''}`} onClick={() => setChoice('blank')}>
          <b>Blank show</b>
          <span>Start from an empty timeline.</span>
        </button>
        {DEMOS.map((d) => (
          <button key={d.id} className={`choice${choice === d.id ? ' on' : ''}`} onClick={() => setChoice(d.id)}>
            <b>{d.title}</b>
            <span>{d.drones} drones · {d.blurb}</span>
          </button>
        ))}
      </div>
      {choice === 'blank' && (
        <div className="row" style={{ marginTop: 14 }}>
          <label>Drones</label>
          <div style={{ width: 140 }}><NumberField value={drones} step={10} min={1} max={2000} onChange={(v) => setDrones(Math.round(v))} /></div>
        </div>
      )}
      <p className="hint" style={{ marginTop: 12 }}>The current show is replaced. You can undo this.</p>
    </Modal>
  )
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const [rate, setRate] = useState<'5' | '10' | '20'>('10')
  const compiled = useStore((s) => s.compiled)
  const issues = useStore((s) => s.validation?.issues.length ?? 0)
  return (
    <Modal
      title="Export trajectories"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!compiled} onClick={() => { exportCsv(Number(rate)); onClose() }}>Download ZIP</button></>}
    >
      {issues > 0 && (
        <div className="issue" style={{ marginBottom: 12 }}>
          <AlertTriangle size={14} />
          <div><div className="ititle">This show has {issues} safety issue{issues > 1 ? 's' : ''}.</div><div className="idetail">Fix them before flying. You can still export for review.</div></div>
        </div>
      )}
      <p style={{ marginTop: 0 }}>One CSV per drone with time, position and colour — {compiled ? `${compiled.n} files, ${formatTime(compiled.duration)}` : '…'}. Generated by the same engine as the preview, so it matches exactly.</p>
      <div className="row"><label>Sample rate</label><Segmented value={rate} options={[{ value: '5', label: '5 Hz' }, { value: '10', label: '10 Hz' }, { value: '20', label: '20 Hz' }]} onChange={setRate} /></div>
      <p className="hint">Columns: <code>time_s, east_m, north_m, up_m, red, green, blue</code>. ENU metres from the centre of the takeoff grid; the audience is to the south. Hardware-specific formats are planned.</p>
    </Modal>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['← / →', 'Back / forward 1 s (Shift: 5 s)'],
  ['↑ / ↓', 'Previous / next scene'],
  ['Home / End', 'Start / end of show'],
  ['A', 'Add a formation'],
  ['C', 'Add a light cue at the playhead'],
  ['Ctrl D', 'Duplicate scene or cue'],
  ['Delete', 'Delete scene or cue'],
  ['Ctrl Z / Ctrl Shift Z', 'Undo / redo'],
  ['1 / 2 / 3', 'Audience / orbit / top view'],
  ['Q / W / E / R', 'Select / move / rotate / scale the selected formation in the view (Alt: no snapping)'],
  ['Alt ← → ↑ ↓', 'Nudge the formation across / up and down (Shift: 5 m)'],
  ['Alt PgUp / PgDn', 'Nudge the formation away from / toward the audience'],
  ['F', 'Frame the selected formation'],
  ['K', 'Auto-key: moving, turning or resizing a formation sets a keyframe at the playhead'],
  ['Click a drone', 'Select the formation it belongs to'],
  ['P', 'Present fullscreen'],
  ['Ctrl S', 'Save project'],
  ['Ctrl K', 'Ask the AI copilot'],
  ['Drag a label', 'Scrub any number (Shift ×10, Alt ×0.1)'],
  ['Alt while dragging', 'Bypass beat snapping on the timeline'],
]

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <div className="shortcut-list">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <div>{v}</div>
            <div><span className="kbd">{k}</span></div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
