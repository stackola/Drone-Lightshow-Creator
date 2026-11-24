import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Copy, Maximize, Plus, Trash2, Wrench, CheckCircle2, ImageUp, Crosshair } from 'lucide-react'
import type { Draft } from 'immer'
import { getState, useStore } from '@/state/store'
import { useShallow } from 'zustand/react/shallow'
import {
  addLayer, applyFix, changeLayerKind, deleteCue, deleteScene, duplicateCue, duplicateScene, fitSceneToSpacing, fixAll,
  focusIssue, removeLayer, setDroneCount, setLayerCount, setLayerShape, updateCue, updateScene,
} from '@/state/actions'
import { SHAPES, SHAPE_BY_KIND, sizeLabel } from '@/core/shapes'
import { allocate } from '@/core/compile'
import { comfortableSpacing, maxSafeSpin, formatTime, type Issue } from '@/core/validate'
import { fitScene, rasterizeText, unitSpacing, placeAboveFloor } from '@/core/defaults'
import type { Layer, LightCue, Scene, ShapeKind, ShapeSpec, TextFont, Vec3 } from '@/core/types'
import { NumberField, Row, Segmented, Toggle, MenuButton } from '@/ui/components/controls'
import { EffectEditor } from './EffectEditor'
import { ShapePicker } from './ScenesPanel'
import { imageShape } from '@/ui/content'
import { pickFile } from '@/state/persist'

export function Inspector() {
  const sel = useStore((s) => s.selection)
  let body: JSX.Element
  if (sel.kind === 'scene' || sel.kind === 'flight') body = <SceneInspector id={sel.id} focusFlight={sel.kind === 'flight'} />
  else if (sel.kind === 'cue') body = <CueInspector id={sel.id} />
  else if (sel.kind === 'takeoff') body = <TakeoffInspector />
  else if (sel.kind === 'landing') body = <LandingInspector />
  else body = <ShowInspector />
  return (
    <aside className="panel right" aria-label="Inspector">
      <div className="scroll">{body}</div>
    </aside>
  )
}

// --- Shared bits -----------------------------------------------------------------

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="section">
      <div className="section-title">
        {title}
        <span className="spacer" />
        {right}
      </div>
      {children}
    </section>
  )
}

export function IssueCard({ issue }: { issue: Issue }) {
  return (
    <div className="issue">
      <AlertTriangle size={14} />
      <div style={{ minWidth: 0 }}>
        <div className="ititle">{issue.title}</div>
        <div className="idetail">{issue.detail}</div>
        <div className="iactions">
          {issue.fix && (
            <button className="btn sm primary" onClick={() => applyFix(issue.fix!.action)}>
              <Wrench size={12} /> {issue.fix.label}
            </button>
          )}
          <button className="btn sm" onClick={() => focusIssue(issue)}>
            <Crosshair size={12} /> Show at {formatTime(issue.time)}
          </button>
        </div>
      </div>
    </div>
  )
}

function Vec3Field({ value, onChange, labels, step = 0.5 }: { value: Vec3; onChange: (v: Vec3) => void; labels: [string, string, string]; step?: number }) {
  return (
    <div className="grid3">
      {[0, 1, 2].map((i) => (
        <NumberField key={i} label={labels[i]} value={value[i]!} step={step} onChange={(v) => { const n = [...value] as Vec3; n[i] = v; onChange(n) }} />
      ))}
    </div>
  )
}

// --- Scene -----------------------------------------------------------------------

function SceneInspector({ id, focusFlight }: { id: string; focusFlight: boolean }) {
  const scene = useStore((s) => s.doc.scenes.find((x) => x.id === id))
  const index = useStore((s) => s.doc.scenes.findIndex((x) => x.id === id))
  const times = useStore((s) => s.compiled?.sceneTimes.find((x) => x.id === id))
  const cs = useStore((s) => s.compiled?.scenes.find((x) => x.id === id))
  const issues = useStore(useShallow((s) => s.validation?.issues.filter((i) => i.sceneId === id) ?? []))
  const limits = useStore((s) => s.doc.limits)
  const n = useStore((s) => s.doc.droneCount)
  if (!scene) return <ShowInspector />
  const counts = allocate(n, scene.layers.map((l) => l.weight))
  const up = (recipe: (s: Draft<Scene>) => void, label: string, key?: string) => updateScene(id, recipe, label, key)
  const manual = scene.flight.duration !== null
  const flightDur = times ? times.holdStart - times.flightStart : 0
  const safeSpin = cs ? maxSafeSpin(scene.spin || 1, scene.hold, cs.spinRadius, limits.maxSpeedH, limits.maxAccel) : 0

  return (
    <>
      <div className="insp-kind">Scene {index + 1}</div>
      <div className="insp-head">
        <input className="name-input" value={scene.name} aria-label="Scene name" onChange={(e) => up((s) => { s.name = e.target.value }, 'Rename scene', `name:${id}`)} />
        <button className="btn ghost icon sm" title="Duplicate (Ctrl+D)" aria-label="Duplicate scene" onClick={() => duplicateScene(id)}><Copy size={14} /></button>
        <button className="btn ghost icon sm danger" title="Delete (Del)" aria-label="Delete scene" onClick={() => deleteScene(id)}><Trash2 size={14} /></button>
      </div>

      {issues.length > 0 && (
        <Section title={`${issues.length} safety issue${issues.length > 1 ? 's' : ''}`}>
          {issues.map((i) => <IssueCard key={i.id} issue={i} />)}
        </Section>
      )}

      <Section title="Timing">
        <Row label="Hold">
          <NumberField value={scene.hold} step={0.5} unit="s" min={0} max={3600} onChange={(v) => up((s) => { s.hold = v }, 'Hold duration', `hold:${id}`)} />
        </Row>
        <Row label="Flight in" title="How long drones take to fly into this formation">
          <Segmented
            value={manual ? 'manual' : 'auto'}
            options={[{ value: 'auto', label: 'Auto' }, { value: 'manual', label: 'Set' }]}
            onChange={(v) => up((s) => { s.flight.duration = v === 'auto' ? null : Math.round(flightDur * 10) / 10 }, 'Flight timing')}
          />
          {manual ? (
            <NumberField value={scene.flight.duration ?? flightDur} step={0.5} unit="s" min={0} onChange={(v) => up((s) => { s.flight.duration = v }, 'Flight duration', `flight:${id}`)} />
          ) : (
            <span className="hint" style={{ fontVariantNumeric: 'tabular-nums' }}>{flightDur.toFixed(1)} s</span>
          )}
        </Row>
        {times && (
          <div className="hint" style={{ margin: '4px 0 6px 100px', color: times.extended ? 'var(--warn)' : focusFlight ? 'var(--accent-2)' : undefined }}>
            {times.extended ? `Extended to ${flightDur.toFixed(1)} s — faster would break speed limits.` : `Fastest safe flight: ${times.minFlight.toFixed(1)} s`}
          </div>
        )}
        <Row label="">
          <Toggle checked={scene.flight.dim} onChange={(v) => up((s) => { s.flight.dim = v }, 'Dim during flight')} label="Dim lights while flying in" />
        </Row>
      </Section>

      <Section
        title={scene.layers.length > 1 ? `Shapes · ${scene.layers.length}` : 'Shape'}
        right={
          <MenuButton className="btn ghost sm" title="Add another shape to this scene" width={300} align="right" button={<><Plus size={12} /> Shape</>}>
            {(close) => (
              <>
                <button className="menu-item" onClick={() => { close(); addLayer(id, 'spare') }}>
                  <span className="effect-chip" style={{ background: '#05070d' }} /> Park spare drones (lights off)
                </button>
                <div className="menu-sep" />
                <ShapePicker onPick={(k) => { close(); if (k !== 'image') addLayer(id, k) }} />
              </>
            )}
          </MenuButton>
        }
      >
        {scene.layers.map((layer, li) => (
          <LayerCard key={layer.id} scene={scene} layer={layer} count={counts[li]!} counts={counts} multi={scene.layers.length > 1} />
        ))}
      </Section>

      <Section title="Placement">
        <Row stack label="Centre (m) — across, altitude, depth">
          <Vec3Field value={scene.position} labels={['X', 'Alt', 'Z']} onChange={(v) => up((s) => { s.position = v }, 'Move scene', `pos:${id}`)} />
        </Row>
        <Row stack label="Rotation (°)">
          <Vec3Field value={scene.rotation} labels={['Tilt', 'Turn', 'Roll']} step={5} onChange={(v) => up((s) => { s.rotation = v }, 'Rotate scene', `rot:${id}`)} />
        </Row>
        <Row label="Spin" title="Turns the formation about its vertical axis while it is held. Eases in and out.">
          <NumberField value={scene.spin} step={1} unit="°/s" min={-720} max={720} onChange={(v) => up((s) => { s.spin = v }, 'Spin', `spin:${id}`)} />
        </Row>
        {cs && cs.spinRadius > 0 && (
          <div className="hint" style={{ margin: '4px 0 0 100px' }}>Safe up to {Math.abs(safeSpin).toFixed(1)}°/s for this size</div>
        )}
      </Section>
    </>
  )
}

function LayerCard({ scene, layer, count, counts, multi }: { scene: Scene; layer: Layer; count: number; counts: number[]; multi: boolean }) {
  const [open, setOpen] = useState(false)
  const hasBeats = useStore((s) => !!s.doc.audio?.beats.length)
  const limits = useStore((s) => s.doc.limits)
  const def = SHAPE_BY_KIND[layer.shape.kind]
  const shape = layer.shape
  const target = comfortableSpacing(limits.minSpacing)
  const unit = useMemo(() => unitSpacing({ ...shape, size: 1 } as ShapeSpec, count), [JSON.stringify({ ...shape, size: 0 }), count]) // eslint-disable-line react-hooks/exhaustive-deps
  const spacing = unit * shape.size
  const upLayer = (recipe: (l: Draft<Layer>) => void, label: string, key?: string) =>
    updateScene(scene.id, (s) => { const l = s.layers.find((x) => x.id === layer.id); if (l) recipe(l) }, label, key)
  const upShape = (patch: Record<string, unknown>, label: string, key?: string) => upLayer((l) => { Object.assign(l.shape, patch) }, label, key)
  const spacingOk = !Number.isFinite(spacing) || spacing + 1e-6 >= limits.minSpacing
  const k = `${scene.id}:${layer.id}`

  const setText = (text: string, font: TextFont) => {
    const st = getState()
    const sc = st.doc.scenes.find((x) => x.id === scene.id)
    if (!sc) return
    const next: Scene = { ...sc, layers: sc.layers.map((l) => (l.id === layer.id ? { ...l, shape: { ...(l.shape as Extract<ShapeSpec, { kind: 'text' }>), text, font, mask: rasterizeText(text || ' ', font) } } : l)) }
    const fitted = placeAboveFloor(fitScene(next, st.doc.droneCount, target, 'grow'), st.doc)
    st.update((d) => {
      const i = d.scenes.findIndex((x) => x.id === scene.id)
      if (i >= 0) d.scenes[i] = fitted as Draft<Scene>
    }, 'Edit text', `text:${layer.id}`)
  }

  return (
    <div className="layer-card">
      <div className="layer-head">
        <select className="select" style={{ flex: 1 }} value={shape.kind} aria-label="Shape" onChange={(e) => changeLayerKind(scene.id, layer.id, e.target.value as ShapeKind)}>
          {SHAPES.filter((s) => s.kind !== 'image' || shape.kind === 'image').map((s) => <option key={s.kind} value={s.kind}>{s.label}</option>)}
        </select>
        {multi ? (
          <div style={{ width: 92 }}>
            <NumberField value={count} step={1} min={0} max={counts.reduce((a, b) => a + b, 0)} unit="drones" title="Drones in this shape" onChange={(v) => setLayerCount(scene.id, layer.id, v, counts)} />
          </div>
        ) : (
          <span className="hint" style={{ padding: '0 4px' }}>{count} drones</span>
        )}
        {multi && <button className="btn ghost icon sm danger" aria-label="Remove shape" title="Remove shape" onClick={() => removeLayer(scene.id, layer.id)}><Trash2 size={13} /></button>}
      </div>
      <div className="layer-body">
        {shape.kind === 'text' && (
          <>
            <textarea className="textarea" rows={Math.min(4, shape.text.split('\n').length + 1)} value={shape.text} aria-label="Text" onChange={(e) => setText(e.target.value, shape.font)} />
            <div style={{ margin: '6px 0' }}>
              <Segmented full value={shape.font} options={[{ value: 'sans', label: 'Sans' }, { value: 'serif', label: 'Serif' }, { value: 'pixel', label: 'Pixel' }]} onChange={(f) => setText(shape.text, f)} />
            </div>
          </>
        )}
        {shape.kind === 'image' && (
          <Row label="Image">
            <span className="hint" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{shape.name}</span>
            <button className="btn sm" onClick={async () => {
              const f = await pickFile('image/*')
              if (!f) return
              try { setLayerShape(scene.id, layer.id, await imageShape(f, shape.size), 'Replace image') } catch { getState().toast('Could not read that image.', 'err') }
            }}><ImageUp size={12} /> Replace</button>
          </Row>
        )}
        <Row label={sizeLabel(shape.kind)}>
          <NumberField value={shape.size} step={0.5} unit="m" min={0.5} max={2000} onChange={(v) => upShape({ size: v }, 'Resize', `size:${k}`)} />
          <button className="btn sm" title={`Set the size for ${target.toFixed(1)} m spacing — the smallest that keeps every flight collision-free`} onClick={() => fitSceneToSpacing(scene.id, 'exact')}>
            <Maximize size={12} /> Fit
          </button>
        </Row>
        {Number.isFinite(spacing) && (
          <div className={`hint ${spacingOk ? (spacing + 1e-6 >= target ? 'ok' : '') : 'err'}`} style={{ margin: '2px 0 4px 100px' }}>
            {spacingOk ? `Drones ${spacing.toFixed(1)} m apart` : `Drones only ${spacing.toFixed(2)} m apart — needs ${limits.minSpacing} m`}
            {spacingOk && spacing + 1e-6 < target ? ` · below ${target.toFixed(1)} m, flights are checked pair by pair` : ''}
          </div>
        )}
        {def.hasFill && 'fill' in shape && (
          <Row label="Style">
            <Segmented full value={shape.fill} options={[{ value: 'filled', label: 'Filled' }, { value: 'outline', label: 'Outline' }]} onChange={(v) => { setLayerShape(scene.id, layer.id, { ...shape, fill: v } as ShapeSpec, 'Change style') }} />
          </Row>
        )}
        {def.params.map((p) => (
          <Row key={p.key} label={p.label}>
            <NumberField value={Number((shape as unknown as Record<string, number>)[p.key])} step={p.step} min={p.min} max={p.max} precision={p.integer ? 0 : undefined} onChange={(v) => upShape({ [p.key]: p.integer ? Math.round(v) : v }, `Edit ${p.label.toLowerCase()}`, `${p.key}:${k}`)} />
          </Row>
        ))}
        <button className="subhead" style={{ background: 'none', border: 0, width: '100%', cursor: 'pointer', padding: 0 }} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Offset & rotation
        </button>
        {open && (
          <>
            <Row stack label="Offset from scene centre (m)">
              <Vec3Field value={layer.offset} labels={['X', 'Y', 'Z']} onChange={(v) => upLayer((l) => { l.offset = v }, 'Move shape', `off:${k}`)} />
            </Row>
            <Row stack label="Rotation (°)">
              <Vec3Field value={layer.rotation} labels={['X', 'Y', 'Z']} step={5} onChange={(v) => upLayer((l) => { l.rotation = v }, 'Rotate shape', `lrot:${k}`)} />
            </Row>
          </>
        )}
        <div className="subhead">Light</div>
        <EffectEditor effect={layer.effect} allowImage={shape.kind === 'image'} keyPrefix={`fx:${k}`} hasBeats={hasBeats} onChange={(e, label, key) => upLayer((l) => { l.effect = e }, label, key)} />
      </div>
    </div>
  )
}

// --- Light cue ----------------------------------------------------------------------

function CueInspector({ id }: { id: string }) {
  const cue = useStore((s) => s.doc.cues.find((q) => q.id === id))
  const hasBeats = useStore((s) => !!s.doc.audio?.beats.length)
  if (!cue) return <ShowInspector />
  const up = (recipe: (q: Draft<LightCue>) => void, label: string, key?: string) => updateCue(id, recipe, label, key)
  return (
    <>
      <div className="insp-kind">Light cue</div>
      <div className="insp-head">
        <div className="name-input" style={{ border: 0 }}>Cue at {formatTime(cue.start)}</div>
        <button className="btn ghost icon sm" title="Duplicate" aria-label="Duplicate cue" onClick={() => duplicateCue(id)}><Copy size={14} /></button>
        <button className="btn ghost icon sm danger" title="Delete (Del)" aria-label="Delete cue" onClick={() => deleteCue(id)}><Trash2 size={14} /></button>
      </div>
      <Section title="Effect">
        <EffectEditor effect={cue.effect} allowImage={false} keyPrefix={`cue:${id}`} hasBeats={hasBeats} onChange={(e, label, key) => up((q) => { q.effect = e }, label, key)} />
        <Row label="Blend">
          <Segmented full value={cue.blend} options={[{ value: 'replace', label: 'Replace', title: 'Cover the formation’s colours' }, { value: 'multiply', label: 'Tint', title: 'Multiply: darken and tint' }, { value: 'add', label: 'Add', title: 'Add light on top (flashes, sweeps)' }]} onChange={(v) => up((q) => { q.blend = v }, 'Blend mode')} />
        </Row>
        <div className="hint" style={{ marginTop: 6 }}>Cues play over every drone — during formations and flights — and look at where each drone is right now.</div>
      </Section>
      <Section title="Timing">
        <Row label="Start"><NumberField value={cue.start} step={0.1} unit="s" min={0} onChange={(v) => up((q) => { q.start = v }, 'Move cue', `cs:${id}`)} /></Row>
        <Row label="Length"><NumberField value={cue.duration} step={0.1} unit="s" min={0.05} onChange={(v) => up((q) => { q.duration = v }, 'Cue length', `cd:${id}`)} /></Row>
        <Row label="Fade in"><NumberField value={cue.fadeIn} step={0.1} unit="s" min={0} onChange={(v) => up((q) => { q.fadeIn = v }, 'Fade in', `cfi:${id}`)} /></Row>
        <Row label="Fade out"><NumberField value={cue.fadeOut} step={0.1} unit="s" min={0} onChange={(v) => up((q) => { q.fadeOut = v }, 'Fade out', `cfo:${id}`)} /></Row>
      </Section>
    </>
  )
}

// --- Takeoff / landing / show ---------------------------------------------------------

function TakeoffInspector() {
  const site = useStore((s) => s.doc.site)
  const n = useStore((s) => s.doc.droneCount)
  const t = useStore((s) => s.compiled?.takeoff)
  const up = useStore((s) => s.update)
  const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / Math.max(1, cols))
  return (
    <>
      <div className="insp-kind">Takeoff</div>
      <div className="insp-head"><div className="name-input" style={{ border: 0 }}>Launch grid</div></div>
      <Section title="Fleet">
        <Row label="Drones"><NumberField value={n} step={10} min={1} max={2000} onChange={(v) => setDroneCount(v)} /></Row>
        <div className="hint" style={{ margin: '4px 0 0 100px' }}>Every formation re-samples to the new count. Use “Fix all” if any become too dense.</div>
      </Section>
      <Section title="Pads">
        <Row label="Pad spacing"><NumberField value={site.gridSpacing} step={0.5} unit="m" min={0.5} max={50} onChange={(v) => up((d) => { d.site.gridSpacing = v }, 'Pad spacing', 'pads')} /></Row>
        <Row label="Climb to"><NumberField value={site.takeoffAltitude} step={1} unit="m" min={1} max={100} onChange={(v) => up((d) => { d.site.takeoffAltitude = v }, 'Takeoff altitude', 'toalt')} /></Row>
        <div className="hint" style={{ margin: '4px 0 0 100px' }}>
          {cols} × {rows} pads, {((cols - 1) * site.gridSpacing).toFixed(0)} × {((rows - 1) * site.gridSpacing).toFixed(0)} m. All drones climb together{t ? ` in ${(t.t1 - t.t0).toFixed(1)} s` : ''}.
        </div>
      </Section>
    </>
  )
}

function LandingInspector() {
  const site = useStore((s) => s.doc.site)
  const rf = useStore((s) => s.compiled?.returnFlight)
  const up = useStore((s) => s.update)
  const manual = site.returnFlight.duration !== null
  const dur = rf ? rf.t1 - rf.t0 : 0
  const issues = useStore(useShallow((s) => s.validation?.issues.filter((i) => i.title.startsWith('Return flight')) ?? []))
  return (
    <>
      <div className="insp-kind">Landing</div>
      <div className="insp-head"><div className="name-input" style={{ border: 0 }}>Return & land</div></div>
      {issues.length > 0 && <Section title="Safety">{issues.map((i) => <IssueCard key={i.id} issue={i} />)}</Section>}
      <Section title="Return flight">
        <Row label="Duration">
          <Segmented value={manual ? 'manual' : 'auto'} options={[{ value: 'auto', label: 'Auto' }, { value: 'manual', label: 'Set' }]} onChange={(v) => up((d) => { d.site.returnFlight.duration = v === 'auto' ? null : Math.round(dur * 10) / 10 }, 'Return timing')} />
          {manual ? <NumberField value={site.returnFlight.duration ?? dur} step={0.5} unit="s" min={0} onChange={(v) => up((d) => { d.site.returnFlight.duration = v }, 'Return duration', 'rfd')} /> : <span className="hint">{dur.toFixed(1)} s</span>}
        </Row>
        {rf && <div className="hint" style={{ margin: '4px 0 6px 100px' }}>Fastest safe: {rf.minDuration.toFixed(1)} s</div>}
        <Row label=""><Toggle checked={site.returnFlight.dim} onChange={(v) => up((d) => { d.site.returnFlight.dim = v }, 'Dim return flight')} label="Dim lights while returning" /></Row>
      </Section>
      <Section title="Pads">
        <Segmented full value={site.landing} options={[{ value: 'any', label: 'Nearest free pad' }, { value: 'home', label: 'Own pad' }]} onChange={(v) => up((d) => { d.site.landing = v }, 'Landing mode')} />
        <div className="hint" style={{ marginTop: 6 }}>
          {site.landing === 'any' ? 'Shortest, collision-free return: each drone takes the nearest free pad (assigned optimally).' : 'Every drone returns to the pad it took off from. Paths may cross — the safety check will tell you.'}
        </div>
      </Section>
    </>
  )
}

function ShowInspector() {
  const doc = useStore((s) => s.doc)
  const validation = useStore((s) => s.validation)
  const up = useStore((s) => s.update)
  const L = doc.limits
  const lim = (key: keyof typeof L, label: string, step: number, unit: string, min = 0, scale = 1) => (
    <Row label={label}>
      <NumberField value={L[key] / scale} step={step} unit={unit} min={min} onChange={(v) => up((d) => { d.limits[key] = v * scale }, `Edit ${label.toLowerCase()}`, `lim:${key}`)} />
    </Row>
  )
  const fixable = validation?.issues.filter((i) => i.fix).length ?? 0
  return (
    <>
      <div className="insp-kind">Show</div>
      <div className="insp-head">
        <input className="name-input" value={doc.name} aria-label="Show name" onChange={(e) => up((d) => { d.name = e.target.value }, 'Rename show', 'showname')} />
      </div>
      <Section title="Safety">
        {validation && validation.issues.length === 0 ? (
          <div className="okbox"><CheckCircle2 size={15} /> Every check passes.</div>
        ) : (
          <>
            {fixable > 0 && <button className="btn sm primary" style={{ marginBottom: 4 }} onClick={fixAll}><Wrench size={12} /> Fix {fixable} automatically</button>}
            {validation?.issues.map((i) => <IssueCard key={i.id} issue={i} />)}
          </>
        )}
        {validation && (
          <div className="stats" style={{ marginTop: 10 }}>
            <div>Closest approach</div><div className={validation.stats.minDistance < L.minSpacing ? 'bad' : ''}>{validation.stats.minDistance.toFixed(2)} m</div>
            <div>Peak speed</div><div>{validation.stats.peakSpeedH.toFixed(1)} m/s</div>
            <div>Peak climb / descent</div><div>{validation.stats.peakClimb.toFixed(1)} / {validation.stats.peakDescent.toFixed(1)} m/s</div>
            <div>Peak acceleration</div><div>{validation.stats.peakAccel.toFixed(1)} m/s²</div>
            <div>Highest drone</div><div>{validation.stats.maxAltitude.toFixed(0)} m</div>
            <div>Furthest from centre</div><div>{validation.stats.maxRadius.toFixed(0)} m</div>
            <div>Flight time</div><div className={validation.stats.duration > L.maxFlightTime ? 'bad' : ''}>{formatTime(validation.stats.duration)}</div>
          </div>
        )}
      </Section>
      <Section title="Fleet & site">
        <Row label="Drones"><NumberField value={doc.droneCount} step={10} min={1} max={2000} onChange={(v) => setDroneCount(v)} /></Row>
        <Row label="Audience at"><NumberField value={doc.site.audienceDistance} step={10} unit="m" min={10} onChange={(v) => up((d) => { d.site.audienceDistance = v }, 'Audience distance', 'aud')} /></Row>
      </Section>
      <Section title="Drone limits">
        {lim('minSpacing', 'Min spacing', 0.1, 'm', 0.3)}
        {lim('maxSpeedH', 'Max speed', 0.5, 'm/s', 0.5)}
        {lim('maxSpeedUp', 'Max climb', 0.5, 'm/s', 0.5)}
        {lim('maxSpeedDown', 'Max descent', 0.5, 'm/s', 0.5)}
        {lim('maxAccel', 'Max accel', 0.5, 'm/s²', 0.5)}
        {lim('maxFlightTime', 'Battery', 0.5, 'min', 1, 60)}
      </Section>
      <Section title="Airspace">
        {lim('minAltitude', 'Floor', 1, 'm')}
        {lim('maxAltitude', 'Ceiling', 5, 'm', 5)}
        {lim('maxRadius', 'Radius', 5, 'm', 10)}
      </Section>
    </>
  )
}
