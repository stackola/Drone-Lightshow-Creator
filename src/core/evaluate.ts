// Positions and colours of every drone at any show time.
// One function for preview, validation and export — no separate "bake" path.

import type { Compiled, Leg, Segment } from './compile'
import { GROUND_COLOR, beatPhaseFn, pointColor } from './compile'
import { holdPose, profileS } from './motion'
import type { RGB } from './color'
import { effectColor, type BeatPhase, type DroneLook } from './effects'
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
    beat = beatPhaseFn(c.beats, c.downbeat)
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
    case 'flight': {
      const len = seg.t1 - seg.t0
      const tau = len > 0 ? (t - seg.t0) / len : 1
      const leg = legAt(seg.legs, t)
      const s = profileS(leg.profile, t - leg.t0)
      lerpInto(leg.from, leg.to, s, pos)
      if (col) {
        // Colours cross-fade over the whole flight, however many legs it has.
        const m = seg.legs.length === 1 ? s : tau * tau * (3 - 2 * tau)
        const k = seg.dim ? dimFactor(tau) : 1
        for (let i = 0; i < n * 3; i++) col[i] = (seg.c0[i]! + (seg.c1[i]! - seg.c0[i]!) * m) * k
      }
      break
    }
    case 'hold': {
      const cs = c.scenes[seg.scene]!
      const tau = t - seg.t0
      const pose = holdPose(cs.omega, cs.hold, cs.motion, tau)
      const ca = Math.cos(pose.angle) * pose.scale, sa = Math.sin(pose.angle) * pose.scale
      const [cx, cy, cz] = cs.center
      const ys = pose.scale, oy = cy + pose.dy
      for (let i = 0; i < n; i++) {
        const k = cs.slot[i]!
        const x = cs.points[k * 3]! - cx, y = cs.points[k * 3 + 1]! - cy, z = cs.points[k * 3 + 2]! - cz
        pos[i * 3] = cx + ca * x + sa * z
        pos[i * 3 + 1] = oy + ys * y
        pos[i * 3 + 2] = cz - sa * x + ca * z
        if (col) {
          pointColor(cs, k, tau, t, beat, tmp)
          col[i * 3] = tmp[0]; col[i * 3 + 1] = tmp[1]; col[i * 3 + 2] = tmp[2]
        }
      }
      break
    }
  }
  if (col && c.cues.length) applyCues(c, t, pos, col, beat)
  return seg
}

/** Envelope of a cue at time t: smoothstep fade in/out. */
export function cueEnvelope(q: { t0: number; t1: number; fadeIn: number; fadeOut: number }, t: number): number {
  if (t < q.t0 || t >= q.t1) return 0
  const ss = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
  const a = q.fadeIn > 0 ? ss((t - q.t0) / q.fadeIn) : 1
  const b = q.fadeOut > 0 ? ss((q.t1 - t) / q.fadeOut) : 1
  return Math.min(a, b)
}

const cueLook: DroneLook = { u: 0, v: 0, order: 0, rand: 0, image: null }

function applyCues(c: Compiled, t: number, pos: Float32Array, col: Float32Array, beat: BeatPhase): void {
  const n = c.n
  const { cx, cy, r } = c.stage
  for (const q of c.cues) {
    if (q.t0 > t) break
    const w = cueEnvelope(q, t)
    if (w <= 0) continue
    const tau = t - q.t0
    for (let i = 0; i < n; i++) {
      cueLook.u = (pos[i * 3]! - cx) / r
      cueLook.v = (pos[i * 3 + 1]! - cy) / r
      cueLook.order = n > 1 ? i / (n - 1) : 0
      cueLook.rand = hash01(i, 4242)
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

/** Which scene (index) is on show at time t, for UI labels. */
export function sceneAt(c: Compiled, t: number): { scene: number; phase: 'takeoff' | 'flight' | 'hold' | 'land' } {
  const seg = c.segments[segmentAt(c, t)]!
  if (seg.kind === 'hold') return { scene: seg.scene, phase: 'hold' }
  if (seg.kind === 'flight') return { scene: seg.into, phase: 'flight' }
  return { scene: -1, phase: seg.kind }
}
