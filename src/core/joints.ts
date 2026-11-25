// Moving parts: joints that move some of a formation's drones on their own
// while it is held — a bird's wings flapping, a pendulum swinging, a
// windmill's blades turning.
//
// A joint moves the drones of its parts as one rigid piece about a pivot:
//
//   swing  angle  θ(t) = A · E(t) · sin(2π(t/T + φ))     (A radians either way)
//   slide  offset d(t) = A · E(t) · sin(2π(t/T + φ))     (A metres along the axis)
//   turn   angle  θ(t) = the spin S-curve at A rad/s      (ramps up and down like spin)
//
// E eases in over the first ramp of the hold and out over the last (a quintic
// smoothstep, so position, velocity and acceleration are continuous with the
// flights before and after): every swing and slide starts and ends at rest.
//
// Joints can hang off other joints (a forearm off an upper arm, a model's
// wing off a shape that swings as a whole). Every joint is defined in the
// formation's rest pose, so a point's motion is the composition of its
// joints from the innermost out. Points sharing the same chain of joints
// move rigidly together; all of this happens before the formation's own
// spin, motion and keyframes, which move everything as a whole.
//
// Safety: within a rigid piece distances never change. Between pieces (and
// between a piece and the still drones) the validator uses a proven speed
// bound — see pointSpeedBounds — with sampled checks (sampled.ts).

import type { JointKind, JointMotion, Layer, LayerJoint, ModelJoint, Scene, Vec3 } from './types'
import { DEG } from './math'
import { spinAngle } from './motion'
import { crossGroupSeparation, type PairFinding } from './sampled'

export interface CJoint {
  kind: JointKind
  /** Pivot in world coordinates, in the formation's rest pose. */
  pivot: Vec3
  /** Unit axis in world coordinates (rest pose). */
  axis: Vec3
  /** swing: radians either way; turn: rad/s; slide: metres either way. */
  amount: number
  period: number
  phase: number
  /** Index of the joint this one hangs off, or -1. */
  parent: number
  /** For messages: the joint's name, or the shape's. */
  label: string
}

export interface Anim {
  joints: CJoint[]
  /** Per chain: joint indices from the innermost joint out to the root. */
  chains: number[][]
  /** Per point: its chain, or -1 for drones that don't move on their own. */
  chainOf: Int16Array
}

export const JOINT_KINDS: { kind: JointKind; label: string; hint: string; unit: string }[] = [
  { kind: 'swing', label: 'Swing', hint: 'Back and forth about the pivot (wings, tails, legs, pendulums)', unit: '°' },
  { kind: 'turn', label: 'Turn', hint: 'Round and round about the pivot (wheels, windmills, propellers)', unit: '°/s' },
  { kind: 'slide', label: 'Slide', hint: 'Back and forth along the axis (pistons, bouncing)', unit: 'm' },
]

export const MAX_JOINTS = 16
/** Deepest chain of joints followed (guards against loops in hand-edited files). */
const MAX_DEPTH = 6

export function defaultJointMotion(kind: JointKind = 'swing'): JointMotion {
  switch (kind) {
    case 'turn': return { kind, axis: [0, 0, 1], amount: 20, period: 6, phase: 0 }
    case 'slide': return { kind, axis: [0, 1, 0], amount: 1, period: 6, phase: 0 }
    default: return { kind: 'swing', axis: [0, 0, 1], amount: 20, period: 6, phase: 0 }
  }
}

/** True when a joint actually moves something. */
export function jointMoves(j: JointMotion | undefined): boolean {
  return !!j && j.amount !== 0 && Number.isFinite(j.amount) && Math.hypot(...j.axis) > 1e-9
}

/** True when a scene has moving parts (a moving shape, or a model with moving joints). */
export function hasMovingParts(scene: Scene): boolean {
  return scene.layers.some((l) => jointMoves(l.joint) || (l.shape.kind === 'model' && (l.shape.joints ?? []).some((j) => jointMoves(j) && l.shape.kind === 'model' && l.shape.parts.some((p) => p.joint === j.id))))
}

// --- Timing ------------------------------------------------------------------------------

/**
 * Seconds the motion takes to ease in (and out): half a cycle (at least 1 s,
 * at most a third of the hold). Easing in that way is gentler than the
 * motion itself (peak slope 3.75/T against the swing's 2π/T).
 */
export function jointRamp(hold: number, period: number): number {
  return Math.max(0, Math.min(hold / 3, Math.max(1, period / 2)))
}

/** Quintic smoothstep: 0 → 1 with zero slope and curvature at both ends. */
function q(u: number): number {
  return u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (10 + u * (-15 + 6 * u))
}

function envelope(hold: number, r: number, t: number): number {
  if (r <= 0) return 0
  return q(t / r) * q((hold - t) / r)
}

/** A joint's value at hold time t: angle (rad) for swing and turn, offset (m) for slide. */
export function jointValue(j: CJoint, hold: number, t: number, f = 1): number {
  if (hold <= 0) return 0
  t = Math.max(0, Math.min(hold, t))
  if (j.kind === 'turn') return spinAngle(j.amount * f, hold, t)
  const T = Math.max(0.5, j.period)
  return j.amount * f * envelope(hold, jointRamp(hold, T), t) * Math.sin(2 * Math.PI * (t / T + j.phase))
}

const dq = (u: number) => (u <= 0 || u >= 1 ? 0 : 30 * u * u * (1 - u) * (1 - u))

/**
 * Upper bound on |dθ/dt| (rad/s) or |dd/dt| (m/s) over the hold: the exact
 * derivative's largest value on a fine grid, plus the most it can rise
 * between grid points (step/2 × a bound on the second derivative).
 */
export function jointRateBound(j: CJoint, hold: number, f = 1): number {
  const A = Math.abs(j.amount * f)
  if (j.kind === 'turn' || A === 0 || hold <= 0) return A
  const T = Math.max(0.5, j.period)
  const r = jointRamp(hold, T)
  if (r <= 0) return 0
  const w = (2 * Math.PI) / T
  const steps = 2000
  const h = hold / steps
  let best = 0
  for (let k = 0; k <= steps; k++) {
    const t = k * h
    const a = q(t / r), b = q((hold - t) / r)
    const E = a * b, dE = (dq(t / r) * b - a * dq((hold - t) / r)) / r
    const ph = 2 * Math.PI * (t / T + j.phase)
    best = Math.max(best, Math.abs(dE * Math.sin(ph) + E * w * Math.cos(ph)))
  }
  // |E| ≤ 1, |E'| ≤ 2·1.875/r, |E''| ≤ 2·5.78/r² + 2·(1.875/r)²  ⇒  |θ''|/A ≤ |E''| + 2|E'|ω + ω².
  const d2 = (2 * 5.78) / (r * r) + 2 * (1.875 / r) ** 2 + 2 * ((2 * 1.875) / r) * w + w * w
  return A * (best + (d2 * h) / 2)
}

/** Largest angle (rad, ≤ π) or offset (m) a joint reaches. */
function jointReach(j: CJoint, f: number): number {
  return j.kind === 'turn' ? Math.PI : j.kind === 'swing' ? Math.min(Math.PI, Math.abs(j.amount * f)) : Math.abs(j.amount * f)
}

// --- Compiling ---------------------------------------------------------------------------

function mulM(m: number[] | null, v: Vec3): Vec3 {
  if (!m) return [v[0], v[1], v[2]]
  return [m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2], m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2], m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2]]
}

function unit(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** Layer-local (before the layer's rotation and offset) → world, for points and directions. */
export interface LayerFrame {
  layerRot: number[] | null
  offset: Vec3
  sceneRot: number[] | null
  position: Vec3
}

function toWorld(fr: LayerFrame, p: Vec3): Vec3 {
  const a = mulM(fr.layerRot, p)
  const b = mulM(fr.sceneRot, [a[0] + fr.offset[0], a[1] + fr.offset[1], a[2] + fr.offset[2]])
  return [b[0] + fr.position[0], b[1] + fr.position[1], b[2] + fr.position[2]]
}

function dirToWorld(fr: LayerFrame, d: Vec3): Vec3 {
  return unit(mulM(fr.sceneRot, mulM(fr.layerRot, unit(d))))
}

function compiledJoint(m: JointMotion, pivot: Vec3, axis: Vec3, parent: number, label: string): CJoint {
  return {
    kind: m.kind, pivot, axis, parent, label,
    amount: m.kind === 'slide' ? m.amount : m.amount * DEG,
    period: Math.max(0.5, m.period || 0.5),
    phase: Number.isFinite(m.phase) ? m.phase : 0,
  }
}

/** Collects joints and chains while a scene's geometry is built. */
export class AnimBuilder {
  joints: CJoint[] = []
  private chainIds = new Map<string, number>()
  chains: number[][] = []
  chainOf: Int16Array

  constructor(n: number) {
    this.chainOf = new Int16Array(n).fill(-1)
  }

  /**
   * One layer's points (local, before its rotation and offset), from `o` on.
   * `parts`/`frame`: a 3D model's part per point and its model → local mapping.
   */
  addLayer(layer: Layer, local: Float32Array, o: number, fr: LayerFrame, size: number, parts?: Uint16Array, frame?: { center: Vec3; extent: number }): void {
    const c = local.length / 3
    let layerJoint = -1
    if (jointMoves(layer.joint)) {
      const j = layer.joint as LayerJoint
      // Anchor: a fraction of the shape's own extent.
      const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity]
      for (let k = 0; k < c; k++) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a]!, local[k * 3 + a]!); hi[a] = Math.max(hi[a]!, local[k * 3 + a]!) }
      const anchor = j.anchor ?? [0, 0, 0]
      const p: Vec3 = [0, 1, 2].map((a) => (lo[a]! + hi[a]!) / 2 + ((anchor[a] ?? 0) * (hi[a]! - lo[a]!)) / 2) as Vec3
      layerJoint = this.joints.length
      this.joints.push(compiledJoint(j, toWorld(fr, p), dirToWorld(fr, j.axis), -1, 'shape'))
    }
    // A model's own joints, hanging off the shape's joint (if any).
    const modelJoint = new Map<string, number>()
    if (layer.shape.kind === 'model' && parts && frame && layer.shape.joints?.length) {
      const defs = layer.shape.joints.slice(0, MAX_JOINTS)
      const byId = new Map(defs.map((d) => [d.id, d]))
      const used = new Set(layer.shape.parts.map((p) => p.joint).filter((x): x is string => !!x))
      const resolve = (id: string, depth: number): number => {
        const known = modelJoint.get(id)
        if (known !== undefined) return known
        const d = byId.get(id)
        if (!d || depth > MAX_DEPTH) return layerJoint
        const parent = d.parent && d.parent !== id ? resolve(d.parent, depth + 1) : layerJoint
        if (!jointMoves(d)) { modelJoint.set(id, parent); return parent }
        const s = size / (frame.extent || 1)
        const pivot = toWorld(fr, [(d.pivot[0] - frame.center[0]) * s, (d.pivot[1] - frame.center[1]) * s, (d.pivot[2] - frame.center[2]) * s])
        const idx = this.joints.length
        this.joints.push(compiledJoint(d, pivot, dirToWorld(fr, d.axis), parent, d.name || 'part'))
        modelJoint.set(id, idx)
        return idx
      }
      for (const id of used) resolve(id, 0)
    }
    if (layerJoint < 0 && !modelJoint.size) return
    for (let k = 0; k < c; k++) {
      let inner = layerJoint
      if (parts && modelJoint.size && layer.shape.kind === 'model') {
        const id = layer.shape.parts[parts[k]!]?.joint
        if (id && modelJoint.has(id)) inner = modelJoint.get(id)!
      }
      if (inner < 0) continue
      this.chainOf[o + k] = this.chainFor(inner)
    }
  }

  private chainFor(inner: number): number {
    const chain: number[] = []
    for (let j = inner, d = 0; j >= 0 && d <= MAX_DEPTH * 2; j = this.joints[j]!.parent, d++) chain.push(j)
    const key = chain.join(',')
    let id = this.chainIds.get(key)
    if (id === undefined) {
      id = this.chains.length
      this.chains.push(chain)
      this.chainIds.set(key, id)
    }
    return id
  }

  build(): Anim | null {
    if (!this.chains.length) return null
    return { joints: this.joints, chains: this.chains, chainOf: this.chainOf }
  }
}

// --- Posing ------------------------------------------------------------------------------

/** Rigid transform p ↦ R·p + t, packed [R (row-major 9), t (3)]. */
type Rigid = Float64Array

function jointTransform(j: CJoint, v: number, out: Rigid, o: number): void {
  const [ax, ay, az] = j.axis
  if (j.kind === 'slide') {
    out[o] = 1; out[o + 1] = 0; out[o + 2] = 0
    out[o + 3] = 0; out[o + 4] = 1; out[o + 5] = 0
    out[o + 6] = 0; out[o + 7] = 0; out[o + 8] = 1
    out[o + 9] = ax * v; out[o + 10] = ay * v; out[o + 11] = az * v
    return
  }
  // Rodrigues: rotation by v about the unit axis, through the pivot.
  const c = Math.cos(v), s = Math.sin(v), C = 1 - c
  const R = [
    c + ax * ax * C, ax * ay * C - az * s, ax * az * C + ay * s,
    ay * ax * C + az * s, c + ay * ay * C, ay * az * C - ax * s,
    az * ax * C - ay * s, az * ay * C + ax * s, c + az * az * C,
  ]
  for (let i = 0; i < 9; i++) out[o + i] = R[i]!
  const [px, py, pz] = j.pivot
  out[o + 9] = px - (R[0]! * px + R[1]! * py + R[2]! * pz)
  out[o + 10] = py - (R[3]! * px + R[4]! * py + R[5]! * pz)
  out[o + 11] = pz - (R[6]! * px + R[7]! * py + R[8]! * pz)
}

/** b ∘ a (apply a first), into out at o. */
function compose(b: Rigid, bo: number, a: Rigid, ao: number, out: Rigid, o: number): void {
  const r = new Array<number>(12)
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 3; k++) r[i * 3 + k] = b[bo + i * 3]! * a[ao + k]! + b[bo + i * 3 + 1]! * a[ao + 3 + k]! + b[bo + i * 3 + 2]! * a[ao + 6 + k]!
    r[9 + i] = b[bo + i * 3]! * a[ao + 9]! + b[bo + i * 3 + 1]! * a[ao + 10]! + b[bo + i * 3 + 2]! * a[ao + 11]! + b[bo + 9 + i]!
  }
  for (let i = 0; i < 12; i++) out[o + i] = r[i]!
}

/** Each chain's rigid transform at hold time t (motion amounts × f). */
export function chainPoses(anim: Anim, hold: number, t: number, f = 1): Rigid {
  const J = new Float64Array(anim.joints.length * 12)
  anim.joints.forEach((j, i) => jointTransform(j, jointValue(j, hold, t, f), J, i * 12))
  const out = new Float64Array(anim.chains.length * 12)
  anim.chains.forEach((chain, c) => {
    const o = c * 12
    for (let i = 0; i < 12; i++) out[o + i] = J[chain[0]! * 12 + i]!
    for (let m = 1; m < chain.length; m++) compose(J, chain[m]! * 12, out, o, out, o)
  })
  return out
}

/** Apply chain c's pose to a point, into out[oo..]. */
export function applyChain(P: Rigid, c: number, x: number, y: number, z: number, out: Float32Array | number[], oo: number): void {
  const o = c * 12
  out[oo] = P[o]! * x + P[o + 1]! * y + P[o + 2]! * z + P[o + 9]!
  out[oo + 1] = P[o + 3]! * x + P[o + 4]! * y + P[o + 5]! * z + P[o + 10]!
  out[oo + 2] = P[o + 6]! * x + P[o + 7]! * y + P[o + 8]! * z + P[o + 11]!
}

/** Rest positions of every point with its parts posed at hold time t. */
export function articulate(anim: Anim, rest: Float32Array, hold: number, t: number, out: Float32Array, f = 1): Float32Array {
  const P = chainPoses(anim, hold, t, f)
  const n = rest.length / 3
  for (let k = 0; k < n; k++) {
    const c = anim.chainOf[k]!
    if (c < 0) { out[k * 3] = rest[k * 3]!; out[k * 3 + 1] = rest[k * 3 + 1]!; out[k * 3 + 2] = rest[k * 3 + 2]!; continue }
    applyChain(P, c, rest[k * 3]!, rest[k * 3 + 1]!, rest[k * 3 + 2]!, out, k * 3)
  }
  return out
}

// --- Bounds ------------------------------------------------------------------------------

/**
 * Per point: an upper bound on its speed from its moving parts alone, and on
 * how far they can carry it from its rest position. For a chain of joints
 * j₁ (innermost) … jₘ, the point's distance from jᵢ's pivot after the inner
 * joints is at most Dᵢ = |p − Pᵢ| + Σ(displacements of the inner joints), and
 * jᵢ moves it at most rateᵢ·Dᵢ (rotations; slides: rateᵢ). Outer joints only
 * rotate that velocity, so the bounds add up.
 */
export function pointBounds(anim: Anim, rest: Float32Array, hold: number, f = 1): { speed: Float32Array; reach: Float32Array; vMax: number } {
  const n = rest.length / 3
  const speed = new Float32Array(n), reach = new Float32Array(n)
  const rate = anim.joints.map((j) => jointRateBound(j, hold, f))
  const span = anim.joints.map((j) => jointReach(j, f))
  let vMax = 0
  for (let k = 0; k < n; k++) {
    const c = anim.chainOf[k]!
    if (c < 0) continue
    let disp = 0, v = 0
    for (const ji of anim.chains[c]!) {
      const j = anim.joints[ji]!
      if (j.kind === 'slide') { v += rate[ji]!; disp += span[ji]!; continue }
      const D = Math.hypot(rest[k * 3]! - j.pivot[0], rest[k * 3 + 1]! - j.pivot[1], rest[k * 3 + 2]! - j.pivot[2]) + disp
      v += rate[ji]! * D
      disp += 2 * D * Math.sin(span[ji]! / 2)
    }
    speed[k] = v
    reach[k] = disp
    vMax = Math.max(vMax, v)
  }
  return { speed, reach, vMax }
}

/**
 * Closest approach between drones of different moving pieces (and the still
 * drones) over the hold, from the parts' motion alone — proven down to
 * `spacing` (see sampled.ts). Null when nothing moves. Still drones too far
 * from anything that moves to ever meet it are left out.
 */
export function partsSeparation(anim: Anim, rest: Float32Array, hold: number, spacing: number, f = 1): PairFinding | null {
  const n = rest.length / 3
  const { reach, vMax } = pointBounds(anim, rest, hold, f)
  if (vMax <= 0 || hold <= 0) return null
  const groupOf = new Int32Array(n)
  for (let k = 0; k < n; k++) groupOf[k] = anim.chainOf[k]! + 1
  // Still drones only matter within (reach + spacing) of a moving drone's rest position.
  let maxReach = 0
  for (let k = 0; k < n; k++) if (anim.chainOf[k]! >= 0) maxReach = Math.max(maxReach, reach[k]!)
  const cell = maxReach + spacing * 1.5 + 1e-6
  const grid = new Map<string, number[]>()
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`
  for (let k = 0; k < n; k++) {
    if (anim.chainOf[k]! < 0) continue
    const g = key(Math.floor(rest[k * 3]! / cell), Math.floor(rest[k * 3 + 1]! / cell), Math.floor(rest[k * 3 + 2]! / cell))
    const l = grid.get(g)
    if (l) l.push(k)
    else grid.set(g, [k])
  }
  for (let k = 0; k < n; k++) {
    if (anim.chainOf[k]! >= 0) continue
    const cx = Math.floor(rest[k * 3]! / cell), cy = Math.floor(rest[k * 3 + 1]! / cell), cz = Math.floor(rest[k * 3 + 2]! / cell)
    let near = false
    for (let dx = -1; dx <= 1 && !near; dx++)
      for (let dy = -1; dy <= 1 && !near; dy++)
        for (let dz = -1; dz <= 1 && !near; dz++)
          for (const m of grid.get(key(cx + dx, cy + dy, cz + dz)) ?? []) {
            const d = Math.hypot(rest[k * 3]! - rest[m * 3]!, rest[k * 3 + 1]! - rest[m * 3 + 1]!, rest[k * 3 + 2]! - rest[m * 3 + 2]!)
            if (d < reach[m]! + spacing * 1.5) { near = true; break }
          }
    if (!near) groupOf[k] = -1
  }
  const P = new Float32Array(n * 3)
  return crossGroupSeparation((t, out) => { articulate(anim, rest, hold, t, P, f); out.set(P) }, n, groupOf, 0, hold, spacing, vMax)
}

// --- Previews ------------------------------------------------------------------------------

/**
 * A 3D model's drones at rest and at both ends of its motion (the first
 * swinging or sliding joint's beat, or a quarter turn), in model space
 * scaled by `size`. Null when nothing moves.
 */
export function modelPoses(spec: Extract<Layer['shape'], { kind: 'model' }>, n: number, generate: (spec: Layer['shape'], n: number) => { points: Float32Array; parts?: Uint16Array; frame?: { center: Vec3; extent: number } }): { label: string; points: Float32Array }[] | null {
  const g = generate(spec, n)
  const b = new AnimBuilder(n)
  const layer: Layer = { id: 'm', shape: spec, weight: 1, offset: [0, 0, 0], rotation: [0, 0, 0], effect: { kind: 'solid', color: '#ffffff', brightness: 1 } }
  b.addLayer(layer, g.points, 0, { layerRot: null, offset: [0, 0, 0], sceneRot: null, position: [0, 0, 0] }, spec.size, g.parts, g.frame)
  const anim = b.build()
  if (!anim) return null
  const lead = anim.joints.find((j) => j.kind !== 'turn') ?? anim.joints[0]!
  const T = lead.kind === 'turn' ? Math.PI / 2 / Math.max(1e-6, Math.abs(lead.amount)) : lead.period
  const hold = Math.max(8 * T, 30)
  // Mid-hold the motion is at full strength: the swing peaks a quarter beat after sin(...) = 0.
  const peak = lead.kind === 'turn' ? hold / 2 : hold / 2 - (((hold / 2 / T + lead.phase) % 1) - 0.25) * T
  const at = (t: number) => articulate(anim, g.points, hold, t, new Float32Array(g.points.length))
  if (lead.kind === 'turn') return [{ label: 'At rest', points: g.points }, { label: 'Turning', points: at(hold / 2) }]
  return [{ label: 'At rest', points: g.points }, { label: 'One end of the motion', points: at(peak) }, { label: 'The other end', points: at(peak + T / 2) }]
}

// --- Editing helpers -----------------------------------------------------------------------

/** Scale every moving part's motion (swing angles, turn rates, slide distances) by f. */
export function scaleJoints(scene: Scene, f: number): Scene {
  const k = Math.max(0, Math.min(1, f))
  const round = (m: JointMotion) => (m.kind === 'slide' ? Math.floor(m.amount * k * 10) / 10 : Math.trunc(m.amount * k * 10) / 10)
  let changed = false
  const layers = scene.layers.map((l) => {
    let out = l
    if (l.joint && jointMoves(l.joint)) { out = { ...out, joint: { ...l.joint, amount: round(l.joint) } }; changed = true }
    if (l.shape.kind === 'model' && l.shape.joints?.length) {
      out = { ...out, shape: { ...l.shape, joints: l.shape.joints.map((j) => (jointMoves(j) ? { ...j, amount: round(j) } : j)) } }
      changed = true
    }
    return out
  })
  return changed ? { ...scene, layers } : scene
}

/** Moving parts k× slower: swings and slides take k× longer per beat, turns turn k× slower. */
export function slowAnim(anim: Anim, k: number): Anim {
  if (k === 1) return anim
  return { ...anim, joints: anim.joints.map((j) => (j.kind === 'turn' ? { ...j, amount: j.amount / k } : { ...j, period: j.period * k })) }
}

/** The same for a scene's joints (periods rounded up to 0.5 s). */
export function slowJoints(scene: Scene, k: number): Scene {
  if (!(k > 1)) return scene
  const slow = <J extends JointMotion>(j: J): J => {
    if (!jointMoves(j)) return j
    if (j.kind === 'turn') return { ...j, amount: Math.trunc((j.amount / k) * 10) / 10 }
    return { ...j, period: Math.ceil(j.period * k * 2) / 2 }
  }
  return {
    ...scene,
    layers: scene.layers.map((l) => {
      let out = l.joint ? { ...l, joint: slow(l.joint) } : l
      if (l.shape.kind === 'model' && l.shape.joints?.length) out = { ...out, shape: { ...l.shape, joints: l.shape.joints.map(slow) } }
      return out
    }),
  }
}

/** Short description of a joint's motion for people and the AI. */
export function describeJoint(j: JointMotion): string {
  const ph = j.phase ? `, phase ${Math.round(j.phase * 100) / 100}` : ''
  switch (j.kind) {
    case 'turn': return `turns ${j.amount}°/s`
    case 'slide': return `slides ±${j.amount} m every ${j.period} s${ph}`
    default: return `swings ±${j.amount}° every ${j.period} s${ph}`
  }
}

/** Ids of a model's joints that some part moves with. */
export function usedJoints(joints: ModelJoint[] | undefined, parts: { joint?: string }[]): Set<string> {
  const ids = new Set(parts.map((p) => p.joint).filter((x): x is string => !!x))
  // A parent moves its children's parts too.
  for (const j of joints ?? []) if (ids.has(j.id) && j.parent) ids.add(j.parent)
  return ids
}
