// Moving parts: a shape that swings, turns or slides on its own, and the
// joints of a 3D model (which parts move, about which pivot).

import { Plus, Trash2 } from 'lucide-react'
import type { Draft } from 'immer'
import { updateScene } from '@/state/actions'
import { JOINT_KINDS, MAX_JOINTS, defaultJointMotion, describeJoint } from '@/core/joints'
import { newId } from '@/core/defaults'
import type { JointKind, JointMotion, Layer, ModelJoint, Scene, Vec3 } from '@/core/types'
import { NumberField, Row, Segmented, Toggle, Vec3Field } from '@/ui/components/controls'

type Model = Extract<Layer['shape'], { kind: 'model' }>

const AXES: { label: string; hint: string; axis: Vec3 }[] = [
  { label: 'Facing', hint: 'Turns in the picture the audience sees, like a clock hand or a flapping wing seen from the front', axis: [0, 0, 1] },
  { label: 'Upright', hint: 'Turns about a vertical line, like a door or a turntable', axis: [0, 1, 0] },
  { label: 'Across', hint: 'Turns about a horizontal line across the picture, like a nod', axis: [1, 0, 0] },
]
const SLIDES: { label: string; hint: string; axis: Vec3 }[] = [
  { label: 'Up', hint: 'Up and down', axis: [0, 1, 0] },
  { label: 'Across', hint: 'Left and right', axis: [1, 0, 0] },
  { label: 'Toward', hint: 'Toward and away from the audience', axis: [0, 0, 1] },
]

const ANCHORS: { label: string; anchor: Vec3 }[] = [
  { label: 'Centre', anchor: [0, 0, 0] },
  { label: 'Left', anchor: [-1, 0, 0] },
  { label: 'Right', anchor: [1, 0, 0] },
  { label: 'Top', anchor: [0, 1, 0] },
  { label: 'Bottom', anchor: [0, -1, 0] },
]

const same = (a: Vec3, b: Vec3) => a.every((v, i) => Math.abs(v - b[i]!) < 1e-6)
const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]]

/** Kind, axis, amount, beat and phase of a joint. */
function JointFields<J extends JointMotion>({ value, onChange, k }: { value: J; onChange: (patch: Partial<JointMotion>, label: string, key?: string) => void; k: string }) {
  const presets = value.kind === 'slide' ? SLIDES : AXES
  const preset = presets.find((p) => same(p.axis, value.axis) || same(neg(p.axis), value.axis))
  const reversed = !!preset && same(neg(preset.axis), value.axis)
  const unit = JOINT_KINDS.find((x) => x.kind === value.kind)!.unit
  return (
    <>
      <Row label="Motion">
        <Segmented full value={value.kind} options={JOINT_KINDS.map((x) => ({ value: x.kind, label: x.label, title: x.hint }))} onChange={(kind: JointKind) => {
          const d = defaultJointMotion(kind)
          onChange({ kind, amount: d.amount, axis: kind === 'slide' ? d.axis : value.kind === 'slide' ? [0, 0, 1] : value.axis }, 'Change motion')
        }} />
      </Row>
      <Row label={value.kind === 'slide' ? 'Direction' : 'Hinge'}>
        <Segmented full value={preset?.label ?? 'Custom'} options={[...presets.map((p) => ({ value: p.label, label: p.label, title: p.hint })), ...(preset ? [] : [{ value: 'Custom', label: 'Custom' }])]} onChange={(l) => {
          const p = presets.find((x) => x.label === l)
          if (p) onChange({ axis: reversed ? neg(p.axis) : p.axis }, 'Change hinge')
        }} />
      </Row>
      {!preset && <Vec3Field value={value.axis} labels={['X', 'Y', 'Z']} step={0.1} onChange={(v) => onChange({ axis: v }, 'Change hinge', `jaxis:${k}`)} />}
      <Row label={value.kind === 'turn' ? 'Speed' : value.kind === 'slide' ? 'Distance' : 'Swing'} title={value.kind === 'swing' ? 'Degrees either way' : value.kind === 'slide' ? 'Metres either way' : 'Degrees per second'}>
        <NumberField value={value.amount} step={value.kind === 'slide' ? 0.5 : 1} unit={unit} min={value.kind === 'swing' ? 0 : value.kind === 'slide' ? 0 : -360} max={value.kind === 'swing' ? 180 : value.kind === 'slide' ? 100 : 360} onChange={(v) => onChange({ amount: v }, 'Motion amount', `jamt:${k}`)} />
        <Toggle checked={reversed} onChange={(v) => preset && onChange({ axis: v ? neg(preset.axis) : preset.axis }, 'Reverse motion')} label="Reverse" />
      </Row>
      {value.kind !== 'turn' && (
        <Row label="Beat" title="Seconds for one full back-and-forth, and where in it this part starts (0.5 = the opposite way)">
          <NumberField value={value.period} step={0.5} unit="s" min={0.5} max={120} onChange={(v) => onChange({ period: v }, 'Motion beat', `jper:${k}`)} />
          <NumberField value={value.phase} step={0.05} min={-1} max={1} label="Phase" onChange={(v) => onChange({ phase: v }, 'Motion phase', `jph:${k}`)} />
        </Row>
      )}
    </>
  )
}

/** The whole shape moving on its own while held. */
export function LayerMotion({ scene, layer }: { scene: Scene; layer: Layer }) {
  const j = layer.joint
  const k = `${scene.id}:${layer.id}`
  const up = (recipe: (l: Draft<Layer>) => void, label: string, key?: string) =>
    updateScene(scene.id, (s) => { const l = s.layers.find((x) => x.id === layer.id); if (l) recipe(l) }, label, key)
  const anchor = j ? ANCHORS.find((a) => same(a.anchor, j.anchor)) : undefined
  return (
    <>
      <div className="subhead">Moves on its own</div>
      <Toggle checked={!!j} label={j ? describeJoint(j) : 'Still (moves only with the formation)'} onChange={(on) => up((l) => {
        if (on) l.joint = { ...defaultJointMotion('swing'), anchor: [0, 0, 0] }
        else delete l.joint
      }, on ? 'Shape moves on its own' : 'Shape still')} />
      {j && (
        <div className="joint-card">
          <Row label="Pivot" title="Where it turns about, on the shape’s own edges">
            <Segmented full value={anchor?.label ?? 'Custom'} options={[...ANCHORS.map((a) => ({ value: a.label, label: a.label })), ...(anchor ? [] : [{ value: 'Custom', label: 'Custom' }])]} onChange={(l) => {
              const a = ANCHORS.find((x) => x.label === l)
              if (a) up((ly) => { if (ly.joint) ly.joint.anchor = a.anchor }, 'Move pivot')
            }} />
          </Row>
          {!anchor && <Vec3Field value={j.anchor} labels={['X', 'Y', 'Z']} step={0.1} onChange={(v) => up((l) => { if (l.joint) l.joint.anchor = v }, 'Move pivot', `janc:${k}`)} />}
          <JointFields value={j} k={k} onChange={(patch, label, key) => up((l) => { if (l.joint) Object.assign(l.joint, patch) }, label, key)} />
        </div>
      )}
    </>
  )
}

/** A 3D model's joints: which parts each one moves, its pivot, and its motion. */
export function ModelJoints({ scene, layer }: { scene: Scene; layer: Layer }) {
  const shape = layer.shape as Model
  const joints = shape.joints ?? []
  const up = (recipe: (m: Draft<Model>) => void, label: string, key?: string) =>
    updateScene(scene.id, (s) => { const l = s.layers.find((x) => x.id === layer.id); if (l && l.shape.kind === 'model') recipe(l.shape as Draft<Model>) }, label, key)
  const add = () => up((m) => {
    const id = newId('joint')
    m.joints = [...(m.joints ?? []), { id, name: `Part ${(m.joints?.length ?? 0) + 1}`, pivot: [0, 0, 0], ...defaultJointMotion('swing') }]
  }, 'Add moving part')
  return (
    <>
      <div className="subhead">
        Moving parts
        <button className="btn ghost sm" style={{ marginLeft: 'auto' }} disabled={joints.length >= MAX_JOINTS} onClick={add}><Plus size={12} /> Add</button>
      </div>
      {!joints.length && <p className="hint" style={{ margin: '0 0 4px' }}>Give parts of the model their own motion: wings that flap, a tail that wags, wheels that turn. Pick the parts, put the pivot at the joint, and choose the motion.</p>}
      {joints.map((j, i) => {
        const k = `${scene.id}:${layer.id}:${j.id}`
        const upJ = (recipe: (x: Draft<ModelJoint>) => void, label: string, key?: string) => up((m) => { const x = m.joints?.find((y) => y.id === j.id); if (x) recipe(x) }, label, key)
        return (
          <div key={j.id} className="joint-card">
            <div className="joint-head">
              <input className="input" value={j.name} aria-label="Part name" onChange={(e) => upJ((x) => { x.name = e.target.value }, 'Rename part', `jname:${k}`)} />
              <button className="btn ghost icon sm danger" aria-label="Remove moving part" title="Remove moving part" onClick={() => up((m) => {
                m.joints = (m.joints ?? []).filter((x) => x.id !== j.id).map((x) => (x.parent === j.id ? { ...x, parent: j.parent } : x))
                for (const p of m.parts) if (p.joint === j.id) delete p.joint
              }, 'Remove moving part')}><Trash2 size={12} /></button>
            </div>
            <div className="part-chips" role="group" aria-label="Parts that move">
              {shape.parts.map((p, pi) => (
                <button key={pi} className={`part-chip${p.joint === j.id ? ' on' : ''}`} title={p.joint && p.joint !== j.id ? `Moves with ${joints.find((x) => x.id === p.joint)?.name ?? 'another part'}` : `${p.type} ${pi + 1}`}
                  aria-pressed={p.joint === j.id}
                  onClick={() => up((m) => { const q = m.parts[pi]; if (!q) return; if (q.joint === j.id) delete q.joint; else q.joint = j.id }, 'Choose moving parts')}>
                  <span className="dot" style={{ background: p.color }} />{p.type} {pi + 1}
                </button>
              ))}
            </div>
            <Row stack label="Pivot (model units)" title="Where the part is hinged, in the same coordinates as its parts">
              <Vec3Field value={j.pivot} labels={['X', 'Y', 'Z']} step={0.05} onChange={(v) => upJ((x) => { x.pivot = v }, 'Move pivot', `jpiv:${k}`)} />
            </Row>
            {joints.length > 1 && (
              <Row label="Attached to" title="Moves along with another part, like a forearm with the upper arm">
                <select className="select" style={{ flex: 1 }} value={j.parent ?? ''} aria-label="Attached to" onChange={(e) => upJ((x) => { if (e.target.value) x.parent = e.target.value; else delete x.parent }, 'Attach part')}>
                  <option value="">The body (nothing)</option>
                  {joints.filter((x, xi) => xi !== i && x.parent !== j.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Row>
            )}
            <JointFields value={j} k={k} onChange={(patch, label, key) => upJ((x) => { Object.assign(x, patch) }, label, key)} />
          </div>
        )
      })}
    </>
  )
}
