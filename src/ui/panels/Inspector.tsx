import { safeSpacing } from '@/core/site'
import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Copy, Maximize, Plus, Trash2, Wrench, CheckCircle2, ImageUp, Crosshair, Sparkles, Wind, Split, CornerLeftUp, MapPin } from 'lucide-react'
import type { Draft } from 'immer'
import { getState, useStore } from '@/state/store'
import { useShallow } from 'zustand/react/shallow'
import {
  addLayer, addSpare, applyFix, changeLayerKind, deleteCue, deleteScene, duplicateCue, duplicateScene, fitSceneToSpacing, fixAll,
  focusIssue, removeLayer, resizeLedPanel, setDroneCount, setLayerCount, setLayerShape, setSpareRole, updateCue, updateScene,
  splitScene, unsplitScene, addGroupStep, updateGroup, deleteGroup, seekToScene, SPLIT_MODES,
} from '@/state/actions'
import { SHAPES, SHAPE_BY_KIND, gridRows, sizeLabel } from '@/core/shapes'
import { allocate, findCompiledScene, findSceneTime } from '@/core/compile'
import { ACCURACY_PRESETS, accuracyOf } from '@/core/site'
import { findScene, groupSizes, sceneDroneCount, replaceSceneIn } from '@/core/groups'
import { comfortableSpacing, extremeRels, maxSafeMotionAmount, maxSafeSpin, formatTime, type Issue } from '@/core/validate'
import { MOTION_KINDS, SPARE_ROLES, defaultMotion, motionAmountUnit } from '@/core/idle'
import { motionCycles } from '@/core/motion'
import { fitScene, fitToAirspace, rasterizeText, unitSpacing } from '@/core/defaults'
import type { Group, HoldKey, HoldMotion, Layer, LightCue, Scene, ShapeKind, ShapeSpec, ShowDoc, TextFont, Vec3 } from '@/core/types'
import { keyPose, normalizeKeys } from '@/core/keys'
import { seek } from '@/state/playback'
import { NumberField, Row, Segmented, Toggle, MenuButton, Vec3Field } from '@/ui/components/controls'
import { LayerMotion, ModelJoints } from './MotionEditor'
import { EffectEditor } from './EffectEditor'
import { TransitionEditor } from './TransitionEditor'
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
  return <div className="scroll" aria-label="Inspector">{body}</div>
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

// --- Scene -----------------------------------------------------------------------

function SceneInspector({ id, focusFlight }: { id: string; focusFlight: boolean }) {
  const ref = useStore(useShallow((s) => { const r = findScene(s.doc, id); return r ? { scene: r.scene, parent: r.parent, group: r.group, index: r.index } : null }))
  const scene = ref?.scene
  const index = ref?.index ?? -1
  const times = useStore((s) => (s.compiled ? findSceneTime(s.compiled, id) : undefined))
  const cs = useStore((s) => (s.compiled ? findCompiledScene(s.compiled, id) : undefined))
  const issues = useStore(useShallow((s) => s.validation?.issues.filter((i) => i.sceneId === id) ?? []))
  const limits = useStore((s) => s.doc.limits)
  const n = useStore((s) => sceneDroneCount(s.doc, id))
  if (!scene) return <ShowInspector />
  const counts = allocate(n, scene.layers.map((l) => l.weight))
  const up = (recipe: (s: Draft<Scene>) => void, label: string, key?: string) => updateScene(id, recipe, label, key)
  const manual = scene.flight.duration !== null
  const flightDur = times ? times.holdStart - times.flightStart : 0
  const safeSpin = cs ? maxSafeSpin(scene.spin || 1, scene.hold, cs.spinRadius, limits, undefined, 720) : 0

  return (
    <>
      {ref?.group ? (
        <div className="insp-kind">
          <button className="link-btn" title="Back to the scene this group splits from" onClick={() => { getState().select({ kind: 'scene', id: ref.parent!.id }); seekToScene(ref.parent!.id) }}><CornerLeftUp size={11} /> {ref.parent!.name}</button>
          {' · '}{ref.group.name} · step {index + 1} · {n} drones
        </div>
      ) : (
        <div className="insp-kind">Scene {index + 1}</div>
      )}
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
        {times?.detour && (
          <div className="hint detour-note" style={{ margin: '0 0 6px 100px' }}>
            Collision-free detour: a straight flight would bring drones too close, so they spread out, cross, then close in.
          </div>
        )}
        <TransitionEditor
          style={scene.flight.style}
          info={times?.transition}
          keyPrefix={`tr:${id}`}
          onChange={(st, label, key) => up((s) => { if (st) s.flight.style = st; else delete s.flight.style }, label, key)}
        />
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
                <div className="menu-label">Use spare drones</div>
                {SPARE_ROLES.map((r) => (
                  <button key={r.role} className="menu-item" title={r.hint} onClick={() => { close(); addSpare(id, r.role) }}>
                    <span className={`role-chip role-${r.role}`} /> {r.label}
                  </button>
                ))}
                <div className="menu-sep" />
                <ShapePicker scenePresets={false} onPick={(k) => { close(); if (k === 'describe') getState().set({ dialog: 'describe' }); else if (k !== 'image' && k !== 'led' && k !== 'bird') addLayer(id, k) }} />
              </>
            )}
          </MenuButton>
        }
      >
        {scene.layers.map((layer, li) => (
          <LayerCard key={layer.id} scene={scene} layer={layer} count={counts[li]!} counts={counts} multi={scene.layers.length > 1} />
        ))}
      </Section>

      {!ref?.group && <GroupsSection scene={scene} />}

      <Section title="Placement">
        <Row stack label="Centre (m) — across, altitude, depth">
          <Vec3Field value={scene.position} labels={['X', 'Alt', 'Z']} onChange={(v) => up((s) => { s.position = v }, 'Move scene', `pos:${id}`)} />
        </Row>
        <Row stack label="Rotation (°)">
          <Vec3Field value={scene.rotation} labels={['Tilt', 'Turn', 'Roll']} step={5} onChange={(v) => up((s) => { s.rotation = v }, 'Rotate scene', `rot:${id}`)} />
        </Row>
      </Section>

      <Section title="Motion while held">
        <Row label="Spin" title="Turns the formation about its vertical axis while it is held. Eases in and out.">
          <NumberField value={scene.spin} step={1} unit="°/s" min={-720} max={720} onChange={(v) => up((s) => { s.spin = v }, 'Spin', `spin:${id}`)} />
        </Row>
        {cs && cs.spinRadius > 0 && (
          <div className="hint" style={{ margin: '4px 0 6px 100px' }}>Safe up to {Math.abs(safeSpin).toFixed(1)}°/s for this size</div>
        )}
        <HoldMotionEditor scene={scene} />
        <KeyframeEditor scene={scene} />
      </Section>
    </>
  )
}

/**
 * Splits and merges: after this scene's hold, its shapes can break away as
 * groups that fly their own formations at their own pace; the next scene
 * brings everyone back together.
 */
function GroupsSection({ scene }: { scene: Scene }) {
  const n = useStore((s) => s.doc.droneCount)
  const times = useStore((s) => (s.compiled ? findSceneTime(s.compiled, scene.id) : undefined))
  const groups = scene.groups ?? []
  const sizes = groupSizes(scene, n)
  const shapes = scene.layers.filter((l) => !l.role).length
  if (!groups.length) {
    return (
      <Section title="Groups">
        <p className="hint" style={{ margin: '0 0 8px' }}>
          After this formation, its drones can split into groups that each fly their own formations at their own pace. The next scene brings everyone back together.
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SPLIT_MODES.filter((m) => m.mode !== 'shapes' || shapes > 1).map((m) => (
            <button key={m.mode} className="btn sm" title={m.hint} onClick={() => splitScene(scene.id, m.mode)}><Split size={13} /> {m.label}</button>
          ))}
        </div>
      </Section>
    )
  }
  return (
    <Section
      title={`Groups · ${groups.length}`}
      right={<button className="btn ghost sm" title="Remove the groups: everyone stays together" onClick={() => unsplitScene(scene.id)}>Merge back</button>}
    >
      {times && times.splitEnd > times.holdEnd && (
        <p className="hint" style={{ margin: '0 0 8px' }}>Groups fly on their own from {formatTime(times.holdEnd)} to {formatTime(times.splitEnd)}; then the next scene merges everyone.</p>
      )}
      {groups.map((g, gi) => <GroupCard key={g.id} scene={scene} group={g} drones={sizes[gi] ?? 0} />)}
    </Section>
  )
}

function partLabel(p: NonNullable<Group['part']>): string {
  if (p.of === 2) return p.axis === 'x' ? ['Left half', 'Right half'][p.index]! : ['Lower half', 'Upper half'][p.index]!
  if (p.of === 3 && p.axis === 'x') return ['Left third', 'Middle third', 'Right third'][p.index]!
  return `Part ${p.index + 1} of ${p.of}`
}

function GroupCard({ scene, group, drones }: { scene: Scene; group: Group; drones: number }) {
  const thumbs = useStore((s) => s.compiled)
  const layerNames = group.layers.map((id) => { const l = scene.layers.find((x) => x.id === id); return l ? SHAPE_BY_KIND[l.shape.kind].label : '' }).filter(Boolean)
  return (
    <div className="layer-card group-card">
      <div className="layer-head">
        <input className="name-input sm" value={group.name} aria-label="Group name" onChange={(e) => updateGroup(group.id, (g) => { g.name = e.target.value }, 'Rename group', `gname:${group.id}`)} />
        <span className="hint" style={{ padding: '0 4px', whiteSpace: 'nowrap' }}>{drones} drones</span>
        <button className="btn ghost icon sm danger" aria-label="Remove group" title="Remove group (its drones stay in the formation)" onClick={() => deleteGroup(group.id)}><Trash2 size={13} /></button>
      </div>
      <div className="layer-body">
        <div className="hint" style={{ marginBottom: 6 }}>{group.part ? `${partLabel(group.part)} of the ` : 'The '}{layerNames.join(' + ').toLowerCase() || 'shape'} drones</div>
        <Row label="Sets off" title="Seconds after the formation's hold before this group starts moving">
          <NumberField value={group.delay} step={0.5} unit="s later" min={0} max={600} onChange={(v) => updateGroup(group.id, (g) => { g.delay = v }, 'Group delay', `gdelay:${group.id}`)} />
        </Row>
        <ol className="step-list">
          {group.steps.map((st) => {
            const t = thumbs ? findSceneTime(thumbs, st.id) : undefined
            return (
              <li key={st.id}>
                <button className="step-btn" onClick={() => { getState().select({ kind: 'scene', id: st.id }); seekToScene(st.id) }}>
                  <span>{st.name}</span>
                  <span className="hint">{t ? `${formatTime(t.holdStart)} · ${st.hold} s` : ''}</span>
                </button>
              </li>
            )
          })}
        </ol>
        <MenuButton className="btn ghost sm" title="Add a formation to this group" width={300} button={<><Plus size={12} /> Formation</>}>
          {(close) => <ShapePicker scenePresets={false} onPick={(k) => { close(); if (k !== 'describe' && k !== 'image' && k !== 'led' && k !== 'bird') addGroupStep(group.id, k) }} />}
        </MenuButton>
      </div>
    </div>
  )
}

/**
 * Keyframes while held: the whole formation moves, turns and scales, easing
 * into each key and resting there. Values are relative to the formation as
 * placed; the next flight starts wherever the keys leave it.
 */
function KeyframeEditor({ scene }: { scene: Scene }) {
  const times = useStore((s) => (s.compiled ? findSceneTime(s.compiled, scene.id) : undefined))
  const time = useStore((s) => s.time)
  const keys = [...(scene.keys ?? [])].sort((a, b) => a.t - b.t)
  const setKeys = (next: HoldKey[], label: string, key?: string) => updateScene(scene.id, (s) => { if (next.length) s.keys = next; else delete s.keys }, label, key)
  // At the playhead once it's well into this hold; otherwise at the end of the hold, so the motion has all of it.
  const inHold = !!times && time >= times.holdStart + 1 && time <= times.holdEnd + 1e-6
  const addKey = () => {
    const t = inHold ? Math.round((time - times!.holdStart) * 10) / 10 : Math.round(scene.hold * 10) / 10
    // Start from the pose at that moment, so adding a key changes nothing until it's edited.
    const p = keyPose(normalizeKeys(keys, scene.hold), t)
    setKeys([...keys.filter((k) => Math.abs(k.t - t) > 1e-6), { t, move: [...p.move].map((v) => Math.round(v * 10) / 10) as Vec3, rotate: [...p.rotate].map((v) => Math.round(v * 10) / 10) as Vec3, scale: Math.round(p.scale * 100) / 100 }].sort((a, b) => a.t - b.t), 'Add keyframe')
  }
  const upKey = (i: number, patch: Partial<HoldKey>, label: string) => setKeys(keys.map((k, j) => (j === i ? { ...k, ...patch } : k)), label, `key:${scene.id}:${i}:${Object.keys(patch)[0]}`)
  return (
    <div className="keyframes">
      <div className="keyframes-head">
        <span>Keyframes</span>
        <button className="btn ghost sm" title={inHold ? 'Add a keyframe at the playhead' : 'Add a keyframe at the end of the hold (move the playhead into the hold to place one there)'} onClick={addKey}><Plus size={12} /> Key {inHold ? 'at playhead' : 'at end of hold'}</button>
      </div>
      {!keys.length && <p className="hint" style={{ margin: '2px 0 0' }}>Move, turn or resize the whole formation while it’s held. It eases into each key and rests there, or flows through it on a smooth curve; the next flight starts from the last key.</p>}
      {keys.map((k, i) => (
        <div key={i} className="key-card">
          <div className="key-row">
            <button className="key-diamond" title="Go to this key" aria-label={`Go to key ${i + 1}`} onClick={() => times && seek(times.holdStart + k.t)}>◆</button>
            <NumberField value={k.t} step={0.5} unit="s" min={0} max={scene.hold} title="Seconds into the hold" onChange={(v) => upKey(i, { t: v }, 'Keyframe time')} />
            <NumberField value={Math.round(k.scale * 100)} step={5} unit="%" min={10} max={500} title="Size (100% = as designed)" onChange={(v) => upKey(i, { scale: v / 100 }, 'Keyframe size')} />
            <button className="btn ghost icon sm danger" aria-label="Delete keyframe" title="Delete keyframe" onClick={() => setKeys(keys.filter((_, j) => j !== i), 'Delete keyframe')}><Trash2 size={12} /></button>
          </div>
          <Vec3Field value={k.move} labels={['X', 'Up', 'Z']} onChange={(v) => upKey(i, { move: v }, 'Keyframe move')} />
          <Vec3Field value={k.rotate} labels={['Tilt', 'Turn', 'Roll']} step={5} onChange={(v) => upKey(i, { rotate: v }, 'Keyframe turn')} />
          {i < keys.length - 1 ? (
            <Toggle checked={!!k.through} onChange={(v) => upKey(i, { through: v }, v ? 'Flow through keyframe' : 'Stop at keyframe')} label="Flow through (don’t stop here)" />
          ) : (
            <span className="hint">Last key: the formation rests here.</span>
          )}
        </div>
      ))}
    </div>
  )
}

/** Idle motion of a held formation: breathe, bob or sway, with a safe default amount. */
function HoldMotionEditor({ scene }: { scene: Scene }) {
  const cs = useStore((s) => (s.compiled ? findCompiledScene(s.compiled, scene.id) : undefined))
  const limits = useStore((s) => s.doc.limits)
  const motion = scene.motion ?? defaultMotion('none')
  const u = motionAmountUnit(motion.kind)
  const rels = useMemo(() => (cs ? extremeRels(cs) : []), [cs])
  const safe = useMemo(
    () => (cs && motion.kind !== 'none' ? maxSafeMotionAmount(rels, cs.omega, scene.hold, motion, limits, u.max / u.scale) : Infinity),
    [cs, rels, motion.kind, motion.period, scene.hold, limits], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const up = (recipe: (s: Draft<Scene>) => void, label: string, key?: string) => updateScene(scene.id, recipe, label, key)
  const pick = (kind: HoldMotion['kind']) => {
    if (kind === 'none') return up((s) => { delete s.motion }, 'Still while held')
    const d = defaultMotion(kind)
    // Start gentle: at most 70% of what this formation can safely do.
    const u2 = motionAmountUnit(kind)
    const room = cs ? maxSafeMotionAmount(rels, cs.omega, scene.hold, d, limits, u2.max / u2.scale) : d.amount
    const step = kind === 'breathe' ? 0.01 : kind === 'bob' ? 0.5 : 1
    const amount = Math.max(step, Math.floor(Math.min(d.amount, room * 0.7) / step) * step)
    up((s) => { s.motion = { ...d, amount } }, `${MOTION_KINDS.find((m) => m.kind === kind)!.label} while held`)
  }
  return (
    <>
      <Row label="Idle motion" title={MOTION_KINDS.find((m) => m.kind === motion.kind)?.hint}>
        <Segmented full value={motion.kind} options={MOTION_KINDS.map((m) => ({ value: m.kind, label: m.label, title: m.hint }))} onChange={pick} />
      </Row>
      {motion.kind !== 'none' && (
        <>
          <Row label={motion.kind === 'breathe' ? 'Grows by' : motion.kind === 'bob' ? 'Height' : 'Angle'}>
            <NumberField
              value={Math.round(motion.amount * u.scale * 100) / 100} step={u.step} unit={u.unit} min={0} max={u.max}
              onChange={(v) => up((s) => { if (s.motion) s.motion.amount = v / u.scale }, 'Motion amount', `mamt:${scene.id}`)}
            />
          </Row>
          <Row label="Period" title="Seconds for one full cycle">
            <NumberField value={motion.period} step={0.5} unit="s" min={0.5} max={120} onChange={(v) => up((s) => { if (s.motion) s.motion.period = v }, 'Motion period', `mper:${scene.id}`)} />
          </Row>
          <div className="hint" style={{ margin: '2px 0 2px 100px' }}>
            {(() => { const c = motionCycles(scene.hold, motion.period); return `${c.cycles} cycle${c.cycles === 1 ? '' : 's'} of ${c.period.toFixed(1)} s in this hold` })()}
          </div>
          {Number.isFinite(safe) && (
            <div className={`hint ${motion.amount > safe + 1e-9 ? 'err' : ''}`} style={{ margin: '2px 0 4px 100px' }}>
              Safe up to {(Math.floor(safe * u.scale * 10) / 10).toFixed(motion.kind === 'breathe' ? 0 : 1)}{u.unit} at this period{scene.spin ? ' and spin' : ''}
            </div>
          )}
        </>
      )}
    </>
  )
}

function LayerCard({ scene, layer, count, counts, multi }: { scene: Scene; layer: Layer; count: number; counts: number[]; multi: boolean }) {
  const [open, setOpen] = useState(false)
  const hasBeats = useStore((s) => !!s.doc.audio?.beats.length)
  const limits = useStore((s) => s.doc.limits)
  const def = SHAPE_BY_KIND[layer.shape.kind]
  const shape = layer.shape
  const target = comfortableSpacing(safeSpacing(limits))
  const unit = useMemo(() => unitSpacing({ ...shape, size: 1 } as ShapeSpec, count), [JSON.stringify({ ...shape, size: 0 }), count]) // eslint-disable-line react-hooks/exhaustive-deps
  const spacing = unit * shape.size
  const upLayer = (recipe: (l: Draft<Layer>) => void, label: string, key?: string) =>
    updateScene(scene.id, (s) => { const l = s.layers.find((x) => x.id === layer.id); if (l) recipe(l) }, label, key)
  const upShape = (patch: Record<string, unknown>, label: string, key?: string) => upLayer((l) => { Object.assign(l.shape, patch) }, label, key)
  const spacingOk = !Number.isFinite(spacing) || spacing + 1e-6 >= safeSpacing(limits)
  const k = `${scene.id}:${layer.id}`

  const setText = (text: string, font: TextFont) => {
    const st = getState()
    const sc = findScene(st.doc, scene.id)?.scene
    if (!sc) return
    const n = sceneDroneCount(st.doc, scene.id)
    const sub: ShowDoc = { ...st.doc, droneCount: n }
    const next: Scene = { ...sc, layers: sc.layers.map((l) => (l.id === layer.id ? { ...l, shape: { ...(l.shape as Extract<ShapeSpec, { kind: 'text' }>), text, font, mask: rasterizeText(text || ' ', font) } } : l)) }
    const fitted = fitToAirspace(fitScene(next, n, target, 'grow'), sub)
    st.update((d) => { replaceSceneIn(d as ShowDoc, scene.id, fitted) }, 'Edit text', `text:${layer.id}`)
  }

  return (
    <div className="layer-card">
      <div className="layer-head">
        <select className="select" style={{ flex: 1 }} value={shape.kind} aria-label="Shape" onChange={(e) => changeLayerKind(scene.id, layer.id, e.target.value as ShapeKind)}>
          {SHAPES.filter((s) => (s.kind !== 'image' && s.kind !== 'model') || shape.kind === s.kind).map((s) => <option key={s.kind} value={s.kind}>{s.label}</option>)}
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
        {layer.role && (
          <div style={{ margin: '0 0 6px' }}>
            <div className="hint" style={{ marginBottom: 4 }}>Spare drones · {SPARE_ROLES.find((r) => r.role === layer.role)?.hint}</div>
            <Segmented full value={layer.role} options={SPARE_ROLES.map((r) => ({ value: r.role, label: r.label, title: r.hint }))} onChange={(r) => setSpareRole(scene.id, layer.id, r)} />
          </div>
        )}
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
        {shape.kind === 'model' && (
          <Row label="3D model">
            <span className="hint" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{shape.name} · {shape.parts.length} parts</span>
            <button className="btn sm ai" title="Claude looks at it from four angles and fixes it — or tell it what to change" onClick={() => getState().set({ dialog: 'model3d', aiTarget: { sceneId: scene.id, layerId: layer.id } })}>
              <Sparkles size={12} /> Improve
            </button>
          </Row>
        )}
        {shape.kind === 'model' && (
          <div style={{ margin: '2px 0 6px 100px' }} title="Drones only on the side the audience sees: twice as dense there. Leave off for models that spin.">
            <Toggle checked={!!shape.relief} onChange={(v) => upLayer((l) => { if (l.shape.kind === 'model') { if (v) l.shape.relief = true; else delete l.shape.relief } }, v ? 'Relief: front side only' : 'Drones all round')} label="Front side only (relief)" />
          </div>
        )}
        <Row label={sizeLabel(shape.kind)}>
          <NumberField value={shape.size} step={0.5} unit="m" min={0.5} max={2000} onChange={(v) => upShape({ size: v }, 'Resize', `size:${k}`)} />
          <button className="btn sm" title={`Set the size for ${target.toFixed(1)} m spacing — the smallest that keeps every flight collision-free`} onClick={() => fitSceneToSpacing(scene.id, 'exact')}>
            <Maximize size={12} /> Fit
          </button>
        </Row>
        {Number.isFinite(spacing) && (
          <div className={`hint ${spacingOk ? (spacing + 1e-6 >= target ? 'ok' : '') : 'err'}`} style={{ margin: '2px 0 4px 100px' }}>
            {spacingOk ? `Drones ${spacing.toFixed(1)} m apart` : `Drones only ${spacing.toFixed(2)} m apart — needs ${safeSpacing(limits).toFixed(1)} m`}
            {spacingOk && spacing + 1e-6 < target ? ` · below ${target.toFixed(1)} m, flights are checked pair by pair` : ''}
          </div>
        )}
        {shape.kind === 'grid' && layer.effect.kind === 'matrix' && (
          <Row label="LED panel" title="Columns × rows of drones. One drone per dot: rows = 7 for 5×7 letters, 5 for 3×5.">
            <NumberField value={Math.max(1, Math.round(count / gridRows(count, shape.aspect)))} step={1} min={1} max={400} unit="cols" precision={0} onChange={(v) => resizeLedPanel(scene.id, layer.id, v, gridRows(count, shape.aspect))} />
            <NumberField value={gridRows(count, shape.aspect)} step={1} min={1} max={60} unit="rows" precision={0} onChange={(v) => resizeLedPanel(scene.id, layer.id, Math.round(count / gridRows(count, shape.aspect)), v)} />
          </Row>
        )}
        {def.hasFill && 'fill' in shape && (
          <Row label="Style">
            <Segmented full value={shape.fill ?? 'filled'} options={[{ value: 'filled', label: 'Filled' }, { value: 'outline', label: 'Outline' }]} onChange={(v) => { setLayerShape(scene.id, layer.id, { ...shape, fill: v } as ShapeSpec, 'Change style') }} />
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
        {shape.kind === 'model' && <ModelJoints scene={scene} layer={layer} />}
        {!layer.role && <LayerMotion scene={scene} layer={layer} />}
        <div className="subhead">Light</div>
        <EffectEditor effect={layer.effect} allowImage={shape.kind === 'image' || shape.kind === 'model'} keyPrefix={`fx:${k}`} hasBeats={hasBeats} onChange={(e, label, key) => upLayer((l) => { l.effect = e }, label, key)} />
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
        <TransitionEditor
          style={site.returnFlight.style}
          info={rf?.transition}
          keyPrefix="tr:return"
          onChange={(st, label, key) => up((d) => { if (st) d.site.returnFlight.style = st; else delete d.site.returnFlight.style }, label, key)}
        />
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
  const lim = (key: Exclude<keyof typeof L, 'accuracy'>, label: string, step: number, unit: string, min = 0, scale = 1) => (
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
            <div>Peak jerk</div><div>{validation.stats.peakJerk.toFixed(1)} m/s³</div>
            <div>Highest drone</div><div>{validation.stats.maxAltitude.toFixed(0)} m</div>
            <div>Furthest from centre</div><div>{validation.stats.maxRadius.toFixed(0)} m</div>
            <div>Flight time</div><div className={validation.stats.duration > L.maxFlightTime ? 'bad' : ''}>{formatTime(validation.stats.duration)}</div>
          </div>
        )}
        <button className="btn sm" style={{ marginTop: 10 }} onClick={() => getState().set({ dialog: 'wind' })} title="Fly the show through a physical simulation with wind, gusts and turbulence">
          <Wind size={12} /> Wind test…
        </button>
      </Section>
      <Section title="Fleet & site">
        <Row label="Drones"><NumberField value={doc.droneCount} step={10} min={1} max={2000} onChange={(v) => setDroneCount(v)} /></Row>
        <Row label="Audience at"><NumberField value={doc.site.audienceDistance} step={10} unit="m" min={10} onChange={(v) => up((d) => { d.site.audienceDistance = v }, 'Audience distance', 'aud')} /></Row>
        <div className="site-summary">
          <div>
            <MapPin size={12} />{' '}
            {doc.site.geo ? `${doc.site.geo.lat.toFixed(5)}, ${doc.site.geo.lon.toFixed(5)} · audience faces ${Math.round(doc.site.geo.heading)}°` : 'Not placed on a map yet'}
          </div>
          <div className="hint">
            {(doc.site.zones?.length ?? 0) === 0 ? 'No keep-out zones' : `${doc.site.zones!.length} keep-out zone${doc.site.zones!.length > 1 ? 's' : ''}`}
            {doc.site.area ? ' · flight area set' : ''}
          </div>
          <button className="btn sm" onClick={() => getState().set({ dialog: 'site' })}><MapPin size={12} /> {doc.site.geo ? 'Edit site…' : 'Place on a map…'}</button>
        </div>
      </Section>
      <Section title="Position accuracy">
        <Segmented
          full
          value={ACCURACY_PRESETS.find((p) => p.h === accuracyOf(L).h && p.v === accuracyOf(L).v)?.label ?? 'Custom'}
          options={[...ACCURACY_PRESETS.map((p) => ({ value: p.label, label: p.label, title: p.hint })), ...(ACCURACY_PRESETS.some((p) => p.h === accuracyOf(L).h && p.v === accuracyOf(L).v) ? [] : [{ value: 'Custom', label: 'Custom' }])]}
          onChange={(v) => { const p = ACCURACY_PRESETS.find((x) => x.label === v); if (p) up((d) => { if (p.h || p.v) d.limits.accuracy = { h: p.h, v: p.v }; else delete d.limits.accuracy }, 'Position accuracy') }}
        />
        <Row label="Across / up" title="How far a real drone may be from its planned position, across and up/down">
          <NumberField value={accuracyOf(L).h} step={0.05} unit="m" min={0} max={20} onChange={(v) => up((d) => { d.limits.accuracy = { h: v, v: accuracyOf(d.limits).v } }, 'Position accuracy', 'acc-h')} />
          <NumberField value={accuracyOf(L).v} step={0.05} unit="m" min={0} max={20} onChange={(v) => up((d) => { d.limits.accuracy = { h: accuracyOf(d.limits).h, v } }, 'Position accuracy', 'acc-v')} />
        </Row>
        <p className="hint" style={{ margin: '4px 0 0' }}>
          {accuracyOf(L).h || accuracyOf(L).v
            ? `Every clearance allows for it: drones are kept ${safeSpacing(L).toFixed(2)} m apart (${L.minSpacing} m + twice the accuracy), and further from the floor, ceiling, fence and zones.`
            : 'Checks assume drones fly exactly on their planned paths. Set your positioning system’s accuracy so every clearance allows for it.'}
        </p>
      </Section>
      <Section title="Drone limits">
        {lim('minSpacing', 'Min spacing', 0.1, 'm', 0.3)}
        {lim('maxSpeedH', 'Max speed', 0.5, 'm/s', 0.5)}
        {lim('maxSpeedUp', 'Max climb', 0.5, 'm/s', 0.5)}
        {lim('maxSpeedDown', 'Max descent', 0.5, 'm/s', 0.5)}
        {lim('maxAccel', 'Max accel', 0.5, 'm/s²', 0.5)}
        {lim('maxJerk', 'Max jerk', 0.5, 'm/s³', 0.5)}
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
