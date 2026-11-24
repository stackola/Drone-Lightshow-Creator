import { useMemo, useState } from 'react'
import { Copy, Plus, Trash2, PlaneTakeoff, PlaneLanding, AlertTriangle, Type, ImageUp, Sparkles } from 'lucide-react'
import { getState, useStore } from '@/state/store'
import { addScene, deleteScene, duplicateScene, moveScene, seekToScene } from '@/state/actions'
import { seek } from '@/state/playback'
import { SHAPES, generateShape } from '@/core/shapes'
import { scenePointColors } from '@/core/compile'
import { newShape } from '@/core/defaults'
import { sceneAt } from '@/core/evaluate'
import { Thumb } from '@/ui/components/Thumb'
import { MenuButton } from '@/ui/components/controls'
import { imageShape } from '@/ui/content'
import { pickFile } from '@/state/persist'
import type { ShapeKind, ShapeSpec } from '@/core/types'

function fmt(t: number) {
  const m = Math.floor(t / 60)
  return `${m}:${(t - m * 60).toFixed(0).padStart(2, '0')}`
}

const tileCache = new Map<ShapeKind, Float32Array>()
function tilePoints(kind: ShapeKind): Float32Array {
  let p = tileCache.get(kind)
  if (!p) {
    const spec = newShape(kind)
    const view = spec.kind === 'image' ? ({ kind: 'heart', size: 1, fill: 'outline' } as ShapeSpec) : spec
    p = generateShape({ ...view, size: 10 } as ShapeSpec, spec.kind === 'text' ? 120 : 70).points
    // 3D shapes: tilt slightly so depth reads in a front view.
    tileCache.set(kind, p)
  }
  return p
}

export async function addImageScene() {
  const file = await pickFile('image/png,image/jpeg,image/svg+xml,image/webp,image/gif')
  if (!file) return
  try {
    const shape = await imageShape(file, 40)
    addScene('image', { shape, name: file.name.replace(/\.[^.]+$/, '') })
  } catch {
    getState().toast('Could not read that image.', 'err')
  }
}

export function ShapePicker({ onPick }: { onPick: (kind: ShapeKind | 'describe') => void }) {
  const groups: ('2D' | '3D' | 'Content')[] = ['2D', '3D', 'Content']
  return (
    <div>
      {groups.map((g) => (
        <div key={g}>
          <div className="menu-label">{g === 'Content' ? 'Text & images' : `${g} shapes`}</div>
          <div className="shape-grid">
            {SHAPES.filter((s) => s.group === g).map((s) => (
              <button key={s.kind} className="shape-tile" onClick={() => onPick(s.kind)} title={`Add ${s.label}`}>
                {s.kind === 'text' ? (
                  <Type size={26} style={{ margin: '7px 0' }} />
                ) : s.kind === 'image' ? (
                  <ImageUp size={26} style={{ margin: '7px 0' }} />
                ) : (
                  <Thumb points={tilePoints(s.kind)} width={52} height={40} />
                )}
                {s.label}
              </button>
            ))}
            {g === 'Content' && (
              <button className="shape-tile" onClick={() => onPick('describe')} title="Describe any picture and Claude draws it in drones">
                <Sparkles size={26} style={{ margin: '7px 0' }} className="ai-mark" />
                Describe…
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export function pickAndAdd(kind: ShapeKind | 'describe') {
  if (kind === 'describe') getState().set({ dialog: 'describe' })
  else if (kind === 'image') void addImageScene()
  else addScene(kind)
}

export function ScenesPanel() {
  const doc = useStore((s) => s.doc)
  const compiled = useStore((s) => s.compiled)
  const selection = useStore((s) => s.selection)
  const validation = useStore((s) => s.validation)
  const liveScene = useStore((s) => (s.compiled ? sceneAt(s.compiled, s.time).scene : -1))
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)

  const issuesBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of validation?.issues ?? []) if (i.sceneId) m.set(i.sceneId, (m.get(i.sceneId) ?? 0) + 1)
    return m
  }, [validation])

  const thumbs = useMemo(() => {
    const m = new Map<string, { points: Float32Array; colors: Float32Array }>()
    for (const cs of compiled?.scenes ?? []) m.set(cs.id, { points: cs.points, colors: scenePointColors(cs) })
    return m
  }, [compiled])

  const times = compiled?.sceneTimes
  const sel = (k: string) => selection.kind === k

  return (
    <aside className="panel left" aria-label="Scenes">
      <div className="panel-head">
        Scenes <span className="count">{doc.scenes.length}</span>
        <div className="spacer" />
        <MenuButton className="btn sm primary" title="Add a formation (A)" width={300} button={<><Plus size={13} /> Add</>}>
          {(close) => <ShapePicker onPick={(k) => { close(); pickAndAdd(k) }} />}
        </MenuButton>
      </div>
      <div className="scroll">
        <div className="slist">
          <div className={`srow fixed${sel('takeoff') ? ' sel' : ''}`} onClick={() => { getState().select({ kind: 'takeoff' }); seek(0) }}>
            <div className="ficon"><PlaneTakeoff size={15} /></div>
            <div className="sinfo">
              <div className="sname">Takeoff</div>
              <div className="ssub">{doc.droneCount} drones · {doc.site.takeoffAltitude} m</div>
            </div>
          </div>
          {doc.scenes.map((scene, i) => {
            const t = times?.find((x) => x.id === scene.id)
            const th = thumbs.get(scene.id)
            const issues = issuesBy.get(scene.id)
            const isSel = (selection.kind === 'scene' || selection.kind === 'flight') && selection.id === scene.id
            const cls = ['srow', isSel && 'sel', liveScene === i && 'live', dragId === scene.id && 'dragging', dropAt === i && 'drop-before', dropAt === i + 1 && i === doc.scenes.length - 1 && 'drop-after'].filter(Boolean).join(' ')
            return (
              <div
                key={scene.id}
                className={cls}
                draggable
                onDragStart={(e) => { setDragId(scene.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', scene.id) }}
                onDragEnd={() => { setDragId(null); setDropAt(null) }}
                onDragOver={(e) => {
                  if (!dragId) return
                  e.preventDefault()
                  const r = e.currentTarget.getBoundingClientRect()
                  setDropAt(e.clientY < r.top + r.height / 2 ? i : i + 1)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragId && dropAt !== null) moveScene(dragId, dropAt)
                  setDragId(null)
                  setDropAt(null)
                }}
                onClick={() => { getState().select({ kind: 'scene', id: scene.id }); seekToScene(scene.id) }}
                title={scene.name}
              >
                <Thumb className="sthumb" points={th?.points ?? null} colors={th?.colors ?? null} width={64} height={44} />
                <div className="sinfo">
                  <div className="sname">{scene.name}</div>
                  <div className="ssub">
                    {issues ? (
                      <span className="badge-err"><AlertTriangle size={11} /> {issues} issue{issues > 1 ? 's' : ''}</span>
                    ) : t ? (
                      `${fmt(t.holdStart)} · ${scene.hold.toFixed(scene.hold % 1 ? 1 : 0)} s${scene.spin ? ' · spin' : ''}`
                    ) : (
                      '…'
                    )}
                  </div>
                </div>
                <div className="sactions" onClick={(e) => e.stopPropagation()}>
                  <button className="btn ghost icon sm" title="Duplicate (Ctrl+D)" aria-label="Duplicate scene" onClick={() => duplicateScene(scene.id)}><Copy size={13} /></button>
                  <button className="btn ghost icon sm danger" title="Delete (Del)" aria-label="Delete scene" onClick={() => deleteScene(scene.id)}><Trash2 size={13} /></button>
                </div>
              </div>
            )
          })}
          {doc.scenes.length === 0 && (
            <div className="empty-state">
              <h3>Add your first formation</h3>
              <p>Pick a shape, type some text, or drop in a logo. It’s sized for safe spacing automatically.</p>
              <ShapePicker onPick={pickAndAdd} />
            </div>
          )}
          <div className={`srow fixed${sel('landing') ? ' sel' : ''}`} onClick={() => { getState().select({ kind: 'landing' }); if (compiled) seek(compiled.returnFlight.t0) }}>
            <div className="ficon"><PlaneLanding size={15} /></div>
            <div className="sinfo">
              <div className="sname">Return & land</div>
              <div className="ssub">{doc.site.landing === 'any' ? 'Nearest free pad' : 'Own pad'}{compiled ? ` · ends ${fmt(compiled.duration)}` : ''}</div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
