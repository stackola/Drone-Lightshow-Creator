// Positions and colours of every drone at any show time.
// One function for preview, validation and export — no separate "bake" path.

import type { Compiled, CompiledScene, FlightSegment, Leg, Segment, Track, TrackSegment } from './compile'
import { GROUND_COLOR, LOOK, beatPhaseFn, pointColor, readLook } from './compile'
import { holdPose, profileS } from './motion'
import { choreoPos, choreoProgress, wrapPos } from './transitions'
import type { RGB } from './color'
import { TEXT_EFFECTS, blankLook, effectColor, type BeatPhase, type DroneLook } from './effects'
import { hash01 } from './math'

export function segmentAt(c: Compiled, t: number): number {
  const segs = c.segments
  if (t <= 0) return 0
  let lo = 0, hi = segs.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (segs[mid]!.t0 <= t) lo = mid
    else hi = mid - 1
  }
  // Prefer a segment with non-zero length when several start at t.
  while (lo > 0 && segs[lo]!.t1 - segs[lo]!.t0 === 0 && segs[lo - 1]!.t1 >= t) lo--
  return lo
}

/** Brightness multiplier while flying with "dim" enabled. */
export function dimFactor(tau: number): number {
  const s = Math.sin(Math.PI * tau)
  return 1 - 0.85 * s * s
}

const beatCache = new WeakMap<Compiled, BeatPhase>()
const tmp: RGB = [0, 0, 0]

export function evaluate(c: Compiled, t: number, pos: Float32Array, col: Float32Array | null): Segment {
  t = Math.max(0, Math.min(c.duration, t))
  const seg = c.segments[segmentAt(c, t)]!
  const n = c.n
  let beat = beatCache.get(c)
  if (!beat) {
    beat = beatPhaseFn(c.beats, c.downbeat, c.musicEnergy, c.accents)
    beatCache.set(c, beat)
  }
  switch (seg.kind) {
    case 'takeoff':
    case 'land': {
      const leg = seg.legs[0]!
      lerpInto(leg.from, leg.to, profileS(leg.profile, t - leg.t0), pos)
      if (col) fill(col, n, GROUND_COLOR)
      break
    }
    case 'flight':
      evalFlight(seg, t, n, pos, col)
      break
    case 'hold': {
      const cs = c.scenes[seg.scene]!
      evalHold(cs, cs.slot, t - seg.t0, t, n, pos, col, beat)
      break
    }
    case 'split': {
      const parent = c.scenes[seg.scene]!
      for (const tr of seg.tracks) evalTrack(tr, parent, t, pos, col, beat)
      break
    }
  }
  if (col && c.cues.length) applyCues(c, seg, t, pos, col, beat)
  return seg
}

/** Positions (and colours) of the drones of one flight at time t. */
function evalFlight(seg: FlightSegment, t: number, n: number, pos: Float32Array, col: Float32Array | null): void {
  const len = seg.t1 - seg.t0
  const tau = len > 0 ? (t - seg.t0) / len : 1
  if (seg.style?.kind === 'choreo') {
    // Every drone on its own path and schedule; colours change as each drone moves.
    const ch = seg.style.choreo
    for (let i = 0; i < n; i++) choreoPos(ch, i, tau, pos)
    if (col) {
      for (let i = 0; i < n; i++) {
        const m = choreoProgress(ch, i, tau)
        const k = seg.dim ? dimFactor(m) : 1
        for (let a = 0; a < 3; a++) col[i * 3 + a] = (seg.c0[i * 3 + a]! + (seg.c1[i * 3 + a]! - seg.c0[i * 3 + a]!) * m) * k
      }
    }
    return
  }
  if (seg.style?.kind === 'wrap') {
    wrapPos(seg.legs, seg.style.wrap, seg.t0, len, t, pos)
    if (col) {
      const m = tau * tau * (3 - 2 * tau)
      const k = seg.dim ? dimFactor(tau) : 1
      for (let i = 0; i < n * 3; i++) col[i] = (seg.c0[i]! + (seg.c1[i]! - seg.c0[i]!) * m) * k
    }
    return
  }
  const leg = legAt(seg.legs, t)
  const s = profileS(leg.profile, t - leg.t0)
  lerpInto(leg.from, leg.to, s, pos)
  if (col) {
    // Colours cross-fade over the whole flight, however many legs it has.
    const m = seg.legs.length === 1 ? s : tau * tau * (3 - 2 * tau)
    const k = seg.dim ? dimFactor(tau) : 1
    for (let i = 0; i < n * 3; i++) col[i] = (seg.c0[i]! + (seg.c1[i]! - seg.c0[i]!) * m) * k
  }
}

/**
 * A held formation at hold-local time tau, for the drones holding points
 * slot[0..n). The pose stops at the end of the formation's own hold (drones
 * waiting for a merge hold still); colours keep animating.
 */
function evalHold(cs: CompiledScene, slot: Int32Array, tau: number, t: number, n: number, pos: Float32Array, col: Float32Array | null, beat: BeatPhase): void {
  const pose = holdPose(cs.omega, cs.hold, cs.motion, Math.min(tau, cs.hold))
  const ca = Math.cos(pose.angle) * pose.scale, sa = Math.sin(pose.angle) * pose.scale
  const [cx, cy, cz] = cs.center
  const ys = pose.scale, oy = cy + pose.dy
  for (let i = 0; i < n; i++) {
    const k = slot[i]!
    const x = cs.points[k * 3]! - cx, y = cs.points[k * 3 + 1]! - cy, z = cs.points[k * 3 + 2]! - cz
    pos[i * 3] = cx + ca * x + sa * z
    pos[i * 3 + 1] = oy + ys * y
    pos[i * 3 + 2] = cz - sa * x + ca * z
    if (col) {
      pointColor(cs, k, tau, t, beat, tmp)
      col[i * 3] = tmp[0]; col[i * 3 + 1] = tmp[1]; col[i * 3 + 2] = tmp[2]
    }
  }
}

export function trackSegmentAt(tr: Track, t: number): TrackSegment {
  const segs = tr.segments
  let k = 0
  while (k + 1 < segs.length && segs[k]!.t1 <= t && segs[k + 1]!.t0 <= t) k++
  return segs[k]!
}

let trPos = new Float32Array(0), trCol = new Float32Array(0)

/** One group's drones at time t, written into the show-wide arrays. */
export function evalTrack(tr: Track, parent: CompiledScene, t: number, pos: Float32Array, col: Float32Array | null, beat: BeatPhase): void {
  const m = tr.drones.length
  if (trPos.length < m * 3) { trPos = new Float32Array(m * 3); trCol = new Float32Array(m * 3) }
  const sg = trackSegmentAt(tr, t)
  const c = col ? trCol : null
  if (sg.kind === 'flight') evalFlight(sg, Math.max(sg.t0, Math.min(sg.t1, t)), m, trPos, c)
  else {
    const cs = sg.scene < 0 ? parent : tr.steps[sg.scene]!
    evalHold(cs, sg.scene < 0 ? tr.parentSlot : cs.slot, sg.tau0 + (t - sg.t0), t, m, trPos, c, beat)
  }
  for (let j = 0; j < m; j++) {
    const i = tr.drones[j]! * 3
    pos[i] = trPos[j * 3]!; pos[i + 1] = trPos[j * 3 + 1]!; pos[i + 2] = trPos[j * 3 + 2]!
    if (col) { col[i] = trCol[j * 3]!; col[i + 1] = trCol[j * 3 + 1]!; col[i + 2] = trCol[j * 3 + 2]! }
  }
}

/** Envelope of a cue at time t: smoothstep fade in/out. */
export function cueEnvelope(q: { t0: number; t1: number; fadeIn: number; fadeOut: number }, t: number): number {
  if (t < q.t0 || t >= q.t1) return 0
  const ss = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
  const a = q.fadeIn > 0 ? ss((t - q.t0) / q.fadeIn) : 1
  const b = q.fadeOut > 0 ? ss((q.t1 - t) / q.fadeOut) : 1
  return Math.min(a, b)
}

const cueLook: DroneLook = blankLook()

/**
 * Light cues over the base colours. Position-based effects use the whole
 * stage, so sweeps run continuously across scenes. While a formation is held,
 * drones also carry its order (chases follow the shape, write-on follows the
 * pen) and text effects use the formation's own layout (letters, dot matrix).
 */
function applyCues(c: Compiled, seg: Segment, t: number, pos: Float32Array, col: Float32Array, beat: BeatPhase): void {
  const n = c.n
  const { cx, cy, r, minX, maxX, minY, maxY } = c.stage
  const cs = seg.kind === 'hold' ? c.scenes[seg.scene]! : null
  for (const q of c.cues) {
    if (q.t0 > t) break
    const w = cueEnvelope(q, t)
    if (w <= 0) continue
    const tau = t - q.t0
    const textFx = TEXT_EFFECTS.includes(q.effect.kind)
    for (let i = 0; i < n; i++) {
      if (cs && textFx) {
        readLook(cs.look, cs.slot[i]!, cueLook)
      } else {
        cueLook.u = (pos[i * 3]! - cx) / r
        cueLook.v = (pos[i * 3 + 1]! - cy) / r
        cueLook.order = cs ? cs.look[cs.slot[i]! * LOOK + 2]! : n > 1 ? i / (n - 1) : 0
        cueLook.rand = hash01(i, 4242)
        cueLook.glyphs = 0
        cueLook.rows = 0
        cueLook.uh = Math.max(Math.abs(maxX - cx), Math.abs(minX - cx)) / r
        cueLook.vh = Math.max(Math.abs(maxY - cy), Math.abs(minY - cy)) / r
      }
      effectColor(q.effect, cueLook, tau, t, beat, tmp)
      const o = i * 3
      switch (q.blend) {
        case 'replace':
          col[o] = col[o]! + (tmp[0] - col[o]!) * w
          col[o + 1] = col[o + 1]! + (tmp[1] - col[o + 1]!) * w
          col[o + 2] = col[o + 2]! + (tmp[2] - col[o + 2]!) * w
          break
        case 'multiply':
          col[o] = col[o]! * (1 + (tmp[0] - 1) * w)
          col[o + 1] = col[o + 1]! * (1 + (tmp[1] - 1) * w)
          col[o + 2] = col[o + 2]! * (1 + (tmp[2] - 1) * w)
          break
        case 'add':
          col[o] = Math.min(1, col[o]! + tmp[0] * w)
          col[o + 1] = Math.min(1, col[o + 1]! + tmp[1] * w)
          col[o + 2] = Math.min(1, col[o + 2]! + tmp[2] * w)
          break
      }
    }
  }
}

function legAt(legs: Leg[], t: number): Leg {
  for (let i = legs.length - 1; i > 0; i--) if (t >= legs[i]!.t0) return legs[i]!
  return legs[0]!
}

function lerpInto(a: Float32Array, b: Float32Array, s: number, out: Float32Array): void {
  for (let i = 0; i < a.length; i++) out[i] = a[i]! + (b[i]! - a[i]!) * s
}

function fill(col: Float32Array, n: number, c: RGB): void {
  for (let i = 0; i < n; i++) { col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2] }
}

/** The id of the formation drone `i` is flying into or holding at time t (group steps during a split). */
export function sceneIdOfDroneAt(c: Compiled, t: number, i: number): string | null {
  const seg = c.segments[segmentAt(c, t)]!
  if (seg.kind === 'hold') return c.scenes[seg.scene]!.id
  if (seg.kind === 'flight') return seg.into >= 0 ? c.scenes[seg.into]!.id : null
  if (seg.kind !== 'split') return null
  const parent = c.scenes[seg.scene]!
  for (const tr of seg.tracks) {
    if (!tr.drones.includes(i)) continue
    const sg = trackSegmentAt(tr, t)
    const k = sg.kind === 'flight' ? sg.into : sg.scene
    return k >= 0 ? tr.steps[k]!.id : parent.id
  }
  return parent.id
}

/** The formation drone `i` is in at time t, and whether it's holding it (not flying). */
export function droneStateAt(c: Compiled, t: number, i: number): { sceneId: string | null; holding: boolean } {
  const seg = c.segments[segmentAt(c, t)]!
  if (seg.kind === 'hold') return { sceneId: c.scenes[seg.scene]!.id, holding: true }
  if (seg.kind === 'split') {
    const parent = c.scenes[seg.scene]!
    for (const tr of seg.tracks) {
      if (!tr.drones.includes(i)) continue
      const sg = trackSegmentAt(tr, t)
      if (sg.kind === 'flight') return { sceneId: tr.steps[sg.into]!.id, holding: false }
      return { sceneId: sg.scene >= 0 ? tr.steps[sg.scene]!.id : parent.id, holding: true }
    }
  }
  return { sceneId: sceneIdOfDroneAt(c, t, i), holding: false }
}

/** Which scene (index) is on show at time t, for UI labels. During a split, the scene the groups came from. */
export function sceneAt(c: Compiled, t: number): { scene: number; phase: 'takeoff' | 'flight' | 'hold' | 'groups' | 'land' } {
  const seg = c.segments[segmentAt(c, t)]!
  if (seg.kind === 'hold') return { scene: seg.scene, phase: 'hold' }
  if (seg.kind === 'split') return { scene: seg.scene, phase: 'groups' }
  if (seg.kind === 'flight') return { scene: seg.into, phase: 'flight' }
  return { scene: -1, phase: seg.kind }
}
