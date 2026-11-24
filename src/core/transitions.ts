// Choreographed transitions: the flight between formations as part of the show.
//
// Two families, with different safety arguments:
//
// • Wrapped (swirl, burst): the ordinary flight — synchronised straight legs,
//   checked exactly in closed form — is transformed as a whole at every
//   instant: turned about a vertical axis through its centroid and scaled up
//   about it (scale ≥ 1). Rotation preserves every distance and scaling up only
//   grows them, so these are exactly as safe as the plain flight. Only speeds
//   and the airspace need checking, which we do by dense sampling.
//
// • Choreographed (cascade, rain, ant walk): every drone follows its own smooth
//   path on its own schedule — straight S-curve moves (position, velocity and
//   acceleration continuous, starting and ending at rest) and, for the ant
//   walk, a lockstep ride along a shared elliptical arch. Pairs are checked on a fine time grid: between grid
//   points each drone's path is within a/8·Δt² of its chord, so the closest
//   approach of the chords minus that margin is a proven lower bound. Dynamics
//   come from exact derivatives of the pieces.
//
// Everything is built in normalised time u ∈ [0, 1], so the geometry does not
// depend on the flight's duration: speeds scale with 1/T, accelerations with
// 1/T², jerk with 1/T³, which gives the fastest safe duration in closed form.

import type { CascadeOrder, Limits, TransitionKind, Vec3 } from './types'
import type { Leg } from './compile'
import { fastestProfile, moveExtents, profileS } from './motion'
import { assignMinSquared } from './assign'
import { comfortableSpacing } from './separation'

// --- Compiled representation -----------------------------------------------------

/** Floats per piece: [type, u0, u1, then 18 floats]. */
export const PIECE = 21

export interface Choreo {
  /** Pieces: type 2 = straight S-curve move [a, b, ramp]; type 1 = ride along the arch [lane, τ0, τ1, ramp]. */
  pieces: Float32Array
  /** First piece and piece count per drone. */
  first: Int32Array
  count: Uint8Array
  /** When each drone starts and stops moving (u), for colour cross-fades. */
  win: Float32Array
  /** The ant walk's arch (see arc()), or null. */
  path: Float32Array | null
  /** Direction of lane offsets. */
  axis: Vec3
}

export interface Wrap {
  /** Whole turns about the vertical axis (sign = direction). */
  turns: number
  /** Peak scale (≥ 1) at mid-flight. */
  expand: number
  /** Centroid of each leg's start and end (3 floats per leg). */
  cFrom: Float32Array
  cTo: Float32Array
}

export type FlightStyle = { kind: 'wrap'; wrap: Wrap } | { kind: 'choreo'; choreo: Choreo }

export interface TransitionInfo {
  requested: TransitionKind
  used: TransitionKind
  /** Share of the requested strength actually used (1 = as asked). */
  strength: number
  /** Why it was softened or replaced, for the editor. */
  note: string | null
}

export const PLAIN: TransitionInfo = { requested: 'direct', used: 'direct', strength: 1, note: null }

export const TRANSITIONS: { kind: TransitionKind; label: string; hint: string }[] = [
  { kind: 'direct', label: 'Direct', hint: 'Everyone flies straight to their new place, together' },
  { kind: 'cascade', label: 'Cascade', hint: 'Drones set off in a ripple across the formation' },
  { kind: 'swirl', label: 'Swirl', hint: 'The flying formation turns about its axis on the way' },
  { kind: 'burst', label: 'Burst', hint: 'The formation explodes outward mid-flight, then reforms' },
  { kind: 'ant', label: 'Ant walk', hint: 'Drones file out in lanes, march along an arch and file into place' },
  { kind: 'rain', label: 'Rain', hint: 'Drones drip down onto a low carpet, then rise into the new shape' },
]

// --- Small maths ---------------------------------------------------------------------

/** Minimum-jerk 0→1: zero velocity and acceleration at both ends. */
export function minjerk(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  return x * x * x * (10 + x * (-15 + 6 * x))
}

/** 0 at both ends (with zero slope and curvature), 1 at the middle. */
export function bump(u: number): number {
  if (u <= 0 || u >= 1) return 0
  const v = u * (1 - u)
  return 64 * v * v * v
}

// The ant walk's arch: half an ellipse from E to F (over or under the formations),
// parameterised by τ ∈ [0, 1]. Path array: [cx, Ey, Fy, a, b, sign, sx, z].
//   x = cx − sx·a·cos(πτ),  y = Ey + (Fy − Ey)·τ + sign·b·sin(πτ),  z = const.
// With a ≈ b the speed along it is nearly constant, so marching rows keep their spacing.
function arc(P: Float32Array, t: number, ax: number): number {
  if (ax === 0) return P[0]! - P[6]! * P[3]! * Math.cos(Math.PI * t)
  if (ax === 1) return P[1]! + (P[2]! - P[1]!) * t + P[5]! * P[4]! * Math.sin(Math.PI * t)
  return P[7]!
}
function arc1(P: Float32Array, t: number, ax: number): number {
  if (ax === 0) return P[6]! * P[3]! * Math.PI * Math.sin(Math.PI * t)
  if (ax === 1) return P[2]! - P[1]! + P[5]! * P[4]! * Math.PI * Math.cos(Math.PI * t)
  return 0
}
function arc2(P: Float32Array, t: number, ax: number): number {
  const k = Math.PI * Math.PI
  if (ax === 0) return P[6]! * P[3]! * k * Math.cos(Math.PI * t)
  if (ax === 1) return -P[5]! * P[4]! * k * Math.sin(Math.PI * t)
  return 0
}
function arc3(P: Float32Array, t: number, ax: number): number {
  const k = Math.PI * Math.PI * Math.PI
  if (ax === 0) return -P[6]! * P[3]! * k * Math.sin(Math.PI * t)
  if (ax === 1) return -P[5]! * P[4]! * k * Math.cos(Math.PI * t)
  return 0
}

// --- Piece construction ----------------------------------------------------------------

type V3 = [number, number, number]

/**
 * S-curve progress 0→1 (the same shape as flights: smoothstep velocity ramps
 * of width r at each end, cruise in between) and its first three derivatives.
 */
function scurve(r: number, x: number, out: number[]): number[] {
  const h = 1 / (1 - r)
  if (x <= 0) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0; return out }
  if (x >= 1) { out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0; return out }
  if (x < r) {
    const y = x / r
    out[0] = h * r * (y * y * y - (y * y * y * y) / 2)
    out[1] = h * y * y * (3 - 2 * y)
    out[2] = (h * 6 * y * (1 - y)) / r
    out[3] = (h * (6 - 12 * y)) / (r * r)
  } else if (x > 1 - r) {
    const y = (1 - x) / r
    out[0] = 1 - h * r * (y * y * y - (y * y * y * y) / 2)
    out[1] = h * y * y * (3 - 2 * y)
    out[2] = (-h * 6 * y * (1 - y)) / r
    out[3] = (h * (6 - 12 * y)) / (r * r)
  } else {
    out[0] = h * (r / 2 + (x - r)); out[1] = h; out[2] = 0; out[3] = 0
  }
  return out
}

class PieceBuilder {
  data: number[] = []
  count = 0
  /** Straight move a→b over design times [s0, s1] with an S-curve of ramp fraction r. */
  line(s0: number, s1: number, a: V3, b: V3, r: number) {
    this.data.push(2, s0, s1, ...a, ...b, Math.max(0.02, Math.min(0.5, r)), ...new Array(11).fill(0))
    this.count++
  }
  /** Ride along the arch from τ0 to τ1 (S-curve progress), offset sideways by `lane`. */
  ride(s0: number, s1: number, lane: number, tau0: number, tau1: number, r: number) {
    this.data.push(1, s0, s1, lane, tau0, tau1, Math.max(0.02, Math.min(0.5, r)), ...new Array(14).fill(0))
    this.count++
  }
}

/** Assemble per-drone piece lists (design times) into a normalised Choreo. */
function assemble(per: PieceBuilder[], path: Float32Array | null, axis: Vec3): Choreo {
  const n = per.length
  let start = Infinity, end = -Infinity
  for (const b of per) for (let k = 0; k < b.count; k++) {
    start = Math.min(start, b.data[k * PIECE + 1]!)
    end = Math.max(end, b.data[k * PIECE + 2]!)
  }
  if (!Number.isFinite(start)) { start = 0; end = 1 }
  const span = Math.max(1e-9, end - start)
  const total = per.reduce((a, b) => a + b.count, 0)
  const pieces = new Float32Array(total * PIECE)
  const first = new Int32Array(n), count = new Uint8Array(n), win = new Float32Array(n * 2)
  let o = 0
  per.forEach((b, i) => {
    first[i] = o
    count[i] = b.count
    for (let k = 0; k < b.count; k++) {
      const src = k * PIECE
      for (let f = 0; f < PIECE; f++) pieces[(o + k) * PIECE + f] = b.data[src + f]!
      pieces[(o + k) * PIECE + 1] = (b.data[src + 1]! - start) / span
      pieces[(o + k) * PIECE + 2] = (b.data[src + 2]! - start) / span
    }
    win[i * 2] = b.count ? pieces[o * PIECE + 1]! : 0
    win[i * 2 + 1] = b.count ? pieces[(o + b.count - 1) * PIECE + 2]! : 0
    o += b.count
  })
  return { pieces, first, count, win, path, axis }
}

// --- Evaluation --------------------------------------------------------------------------

const sc = [0, 0, 0, 0]

function pieceAt(ch: Choreo, o: number, x: number, out: Float32Array, oi: number) {
  const P = ch.pieces
  if (P[o] === 2) {
    const k = scurve(P[o + 9]!, x, sc)[0]!
    for (let a = 0; a < 3; a++) out[oi + a] = P[o + 3 + a]! + (P[o + 6 + a]! - P[o + 3 + a]!) * k
  } else {
    const tau = P[o + 4]! + (P[o + 5]! - P[o + 4]!) * scurve(P[o + 6]!, x, sc)[0]!
    const lane = P[o + 3]!
    for (let a = 0; a < 3; a++) out[oi + a] = arc(ch.path!, tau, a) + lane * ch.axis[a]!
  }
}

/** Position of drone i at normalised time u. */
export function choreoPos(ch: Choreo, i: number, u: number, out: Float32Array, oi = i * 3): void {
  const f = ch.first[i]!, c = ch.count[i]!
  for (let k = 0; k < c; k++) {
    const o = (f + k) * PIECE
    const u0 = ch.pieces[o + 1]!, u1 = ch.pieces[o + 2]!
    if (u < u0) return pieceAt(ch, o, 0, out, oi)
    if (u <= u1) return pieceAt(ch, o, u1 > u0 ? (u - u0) / (u1 - u0) : 1, out, oi)
  }
  pieceAt(ch, (f + c - 1) * PIECE, 1, out, oi)
}

/** How far drone i is through its own move (0..1), smoothed — for colours. */
export function choreoProgress(ch: Choreo, i: number, u: number): number {
  const a = ch.win[i * 2]!, b = ch.win[i * 2 + 1]!
  if (b <= a) return u >= b ? 1 : 0
  const x = Math.max(0, Math.min(1, (u - a) / (b - a)))
  return x * x * (3 - 2 * x)
}

/** Base flight (legs) transformed by the wrap at time t. */
export function wrapPos(legs: Leg[], wrap: Wrap, t0: number, T: number, t: number, out: Float32Array): void {
  let li = 0
  for (let k = legs.length - 1; k > 0; k--) if (t >= legs[k]!.t0) { li = k; break }
  const leg = legs[li]!
  const s = profileS(leg.profile, t - leg.t0)
  const cx = wrap.cFrom[li * 3]! + (wrap.cTo[li * 3]! - wrap.cFrom[li * 3]!) * s
  const cy = wrap.cFrom[li * 3 + 1]! + (wrap.cTo[li * 3 + 1]! - wrap.cFrom[li * 3 + 1]!) * s
  const cz = wrap.cFrom[li * 3 + 2]! + (wrap.cTo[li * 3 + 2]! - wrap.cFrom[li * 3 + 2]!) * s
  const u = T > 0 ? Math.max(0, Math.min(1, (t - t0) / T)) : 1
  const th = 2 * Math.PI * wrap.turns * minjerk(u)
  const k = 1 + (wrap.expand - 1) * bump(u)
  const c = Math.cos(th) * k, sn = Math.sin(th) * k
  const a = leg.from, b = leg.to
  for (let i = 0; i < a.length; i += 3) {
    const x = a[i]! + (b[i]! - a[i]!) * s - cx
    const y = a[i + 1]! + (b[i + 1]! - a[i + 1]!) * s - cy
    const z = a[i + 2]! + (b[i + 2]! - a[i + 2]!) * s - cz
    out[i] = cx + c * x + sn * z
    out[i + 1] = cy + k * y
    out[i + 2] = cz - sn * x + c * z
  }
}

// --- Peaks ----------------------------------------------------------------------------------

export interface UPeaks {
  /** Peak horizontal speed, climb, descent, acceleration and jerk per unit of normalised time. */
  h: number
  up: number
  down: number
  acc: number
  jerk: number
  /** Drone with the largest speed. */
  drone: number
}

function emptyPeaks(): UPeaks {
  return { h: 0, up: 0, down: 0, acc: 0, jerk: 0, drone: 0 }
}

/** Exact-derivative peaks of a choreography (sampled densely within each piece). */
export function choreoPeaks(ch: Choreo): UPeaks {
  const pk = emptyPeaks()
  const P = ch.pieces
  const n = ch.first.length
  const v = [0, 0, 0], a = [0, 0, 0], j = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < ch.count[i]!; k++) {
      const o = (ch.first[i]! + k) * PIECE
      const hu = P[o + 2]! - P[o + 1]!
      if (hu <= 1e-12) continue
      for (let s = 0; s <= 64; s++) {
        const x = s / 64
        if (P[o] === 2) {
          scurve(P[o + 9]!, x, sc)
          for (let ax = 0; ax < 3; ax++) {
            const d = P[o + 6 + ax]! - P[o + 3 + ax]!
            v[ax] = (d * sc[1]!) / hu
            a[ax] = (d * sc[2]!) / (hu * hu)
            j[ax] = (d * sc[3]!) / (hu * hu * hu)
          }
        } else {
          // Chain rule through τ(u): v = C′τ′, a = C″τ′² + C′τ″, j = C‴τ′³ + 3C″τ′τ″ + C′τ‴.
          scurve(P[o + 6]!, x, sc)
          const dt = P[o + 5]! - P[o + 4]!
          const tau = P[o + 4]! + dt * sc[0]!
          const t1 = (dt * sc[1]!) / hu, t2 = (dt * sc[2]!) / (hu * hu), t3 = (dt * sc[3]!) / (hu * hu * hu)
          for (let ax = 0; ax < 3; ax++) {
            const c1 = arc1(ch.path!, tau, ax), c2 = arc2(ch.path!, tau, ax), c3 = arc3(ch.path!, tau, ax)
            v[ax] = c1 * t1
            a[ax] = c2 * t1 * t1 + c1 * t2
            j[ax] = c3 * t1 * t1 * t1 + 3 * c2 * t1 * t2 + c1 * t3
          }
        }
        const hs = Math.hypot(v[0]!, v[2]!)
        if (hs > pk.h) { pk.h = hs; pk.drone = i }
        pk.up = Math.max(pk.up, v[1]!)
        pk.down = Math.max(pk.down, -v[1]!)
        pk.acc = Math.max(pk.acc, Math.hypot(a[0]!, a[1]!, a[2]!))
        pk.jerk = Math.max(pk.jerk, Math.hypot(j[0]!, j[1]!, j[2]!))
      }
    }
  }
  return pk
}

/** Shortest duration (s) for which normalised peaks respect every limit. */
export function minDurationFor(pk: UPeaks, L: Limits): number {
  return Math.max(
    pk.h / L.maxSpeedH, pk.up / L.maxSpeedUp, pk.down / L.maxSpeedDown,
    Math.sqrt(pk.acc / L.maxAccel), L.maxJerk > 0 ? Math.cbrt(pk.jerk / L.maxJerk) : 0,
  )
}

/** Real peaks at duration T. */
export function scalePeaks(pk: UPeaks, T: number): UPeaks {
  if (T <= 0) return pk
  return { h: pk.h / T, up: pk.up / T, down: pk.down / T, acc: pk.acc / (T * T), jerk: pk.jerk / (T * T * T), drone: pk.drone }
}

/**
 * Peaks and airspace extremes of any trajectory given as positions over
 * normalised time (finite differences on a dense grid; the trajectories are
 * smooth, so this is accurate to well under 1%).
 */
export function sampledPeaks(n: number, pos: (u: number, out: Float32Array) => void, steps = 600): UPeaks & { minY: number; maxY: number; maxR: number; minYDrone: number; maxYDrone: number; maxRDrone: number } {
  const pk = { ...emptyPeaks(), minY: Infinity, maxY: -Infinity, maxR: 0, minYDrone: 0, maxYDrone: 0, maxRDrone: 0 }
  const du = 1 / steps
  const F = [0, 1, 2, 3].map(() => new Float32Array(n * 3))
  const at = (k: number, out: Float32Array) => pos(Math.max(0, Math.min(1, k * du)), out)
  at(-1, F[0]!); at(0, F[1]!); at(1, F[2]!); at(2, F[3]!)
  for (let k = 0; k <= steps; k++) {
    const [p0, p1, p2, p3] = F as [Float32Array, Float32Array, Float32Array, Float32Array]
    for (let i = 0; i < n; i++) {
      const o = i * 3
      const y = p1[o + 1]!, r = Math.hypot(p1[o]!, p1[o + 2]!)
      if (y < pk.minY) { pk.minY = y; pk.minYDrone = i }
      if (y > pk.maxY) { pk.maxY = y; pk.maxYDrone = i }
      if (r > pk.maxR) { pk.maxR = r; pk.maxRDrone = i }
      const vx = (p2[o]! - p0[o]!) / (2 * du), vy = (p2[o + 1]! - p0[o + 1]!) / (2 * du), vz = (p2[o + 2]! - p0[o + 2]!) / (2 * du)
      const ax = (p2[o]! - 2 * p1[o]! + p0[o]!) / (du * du), ay = (p2[o + 1]! - 2 * p1[o + 1]! + p0[o + 1]!) / (du * du), az = (p2[o + 2]! - 2 * p1[o + 2]! + p0[o + 2]!) / (du * du)
      const jx = (p3[o]! - 3 * p2[o]! + 3 * p1[o]! - p0[o]!) / (du * du * du)
      const jy = (p3[o + 1]! - 3 * p2[o + 1]! + 3 * p1[o + 1]! - p0[o + 1]!) / (du * du * du)
      const jz = (p3[o + 2]! - 3 * p2[o + 2]! + 3 * p1[o + 2]! - p0[o + 2]!) / (du * du * du)
      const hs = Math.hypot(vx, vz)
      if (hs > pk.h) { pk.h = hs; pk.drone = i }
      pk.up = Math.max(pk.up, vy)
      pk.down = Math.max(pk.down, -vy)
      pk.acc = Math.max(pk.acc, Math.hypot(ax, ay, az))
      if (k < steps) pk.jerk = Math.max(pk.jerk, Math.hypot(jx, jy, jz))
    }
    // Roll the window.
    const first = F.shift()!
    at(k + 3, first)
    F.push(first)
  }
  return pk
}

// --- Pair check ----------------------------------------------------------------------------

export interface PairResult {
  /** Proven lower bound of the closest approach (m). */
  d: number
  u: number
  i: number
  j: number
  pairsBelow: number
}

/**
 * Closest approach of any two drones over a choreography. On each interval of
 * the time grid the relative motion of the chords is linear, so their closest
 * approach is exact; true paths stay within a·Δu²/8 of their chords, which is
 * subtracted (twice, once per drone).
 */
export function choreoPairs(ch: Choreo, n: number, minSpacing: number, accU: number, speedU: number): PairResult {
  const res: PairResult = { d: Infinity, u: 0, i: 0, j: 1, pairsBelow: 0 }
  if (n < 2) return res
  const steps = Math.min(5000, Math.max(200, Math.ceil(speedU / 0.35)))
  const du = 1 / steps
  const margin = 2 * (accU * du * du) / 8
  let A = new Float32Array(n * 3), B = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) choreoPos(ch, i, 0, A)
  const bits = Math.max(10, Math.ceil(Math.log2(n * 4)))
  const size = 1 << bits, mask = size - 1
  const head = new Int32Array(size), next = new Int32Array(n)
  const cx = new Int32Array(n), cy = new Int32Array(n), cz = new Int32Array(n)
  const hash = (x: number, y: number, z: number) => (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask
  const below = new Set<number>()
  for (let k = 1; k <= steps; k++) {
    for (let i = 0; i < n; i++) choreoPos(ch, i, k * du, B)
    let step = 0
    for (let i = 0; i < n * 3; i += 3) step = Math.max(step, Math.hypot(B[i]! - A[i]!, B[i + 1]! - A[i + 1]!, B[i + 2]! - A[i + 2]!))
    const h = minSpacing + 2 * step + margin + 0.5
    head.fill(-1)
    for (let i = 0; i < n; i++) {
      const x = Math.floor(A[i * 3]! / h), y = Math.floor(A[i * 3 + 1]! / h), z = Math.floor(A[i * 3 + 2]! / h)
      cx[i] = x; cy[i] = y; cz[i] = z
      const key = hash(x, y, z)
      next[i] = head[key]!
      head[key] = i
    }
    for (let i = 0; i < n; i++) {
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
        for (let j = head[hash(cx[i]! + ox, cy[i]! + oy, cz[i]! + oz)]!; j >= 0; j = next[j]!) {
          if (j <= i) continue
          // Relative chord: r(s) = r0 + s·(r1 − r0), s ∈ [0, 1].
          const r0x = A[i * 3]! - A[j * 3]!, r0y = A[i * 3 + 1]! - A[j * 3 + 1]!, r0z = A[i * 3 + 2]! - A[j * 3 + 2]!
          const dx = B[i * 3]! - B[j * 3]! - r0x, dy = B[i * 3 + 1]! - B[j * 3 + 1]! - r0y, dz = B[i * 3 + 2]! - B[j * 3 + 2]! - r0z
          const dd = dx * dx + dy * dy + dz * dz
          const s = dd > 1e-12 ? Math.max(0, Math.min(1, -(r0x * dx + r0y * dy + r0z * dz) / dd)) : 0
          const d = Math.hypot(r0x + s * dx, r0y + s * dy, r0z + s * dz) - margin
          if (d < res.d) { res.d = d; res.u = (k - 1 + s) * du; res.i = i; res.j = j }
          if (d < minSpacing) below.add(i * n + j)
        }
      }
    }
    const t = A; A = B; B = t
  }
  res.pairsBelow = below.size
  return res
}

// --- Builders --------------------------------------------------------------------------------

function centroidOf(p: Float32Array): V3 {
  const n = p.length / 3
  let x = 0, y = 0, z = 0
  for (let i = 0; i < p.length; i += 3) { x += p[i]!; y += p[i + 1]!; z += p[i + 2]! }
  return [x / n, y / n, z / n]
}

function bbox(p: Float32Array): { lo: V3; hi: V3 } {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a]!, p[i + a]!); hi[a] = Math.max(hi[a]!, p[i + a]!) }
  return { lo, hi }
}

function pt(p: Float32Array, i: number): V3 {
  return [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!]
}

/** Centroids of every leg's ends, for wrapped transitions. */
export function legCentroids(legs: Leg[]): { cFrom: Float32Array; cTo: Float32Array } {
  const cFrom = new Float32Array(legs.length * 3), cTo = new Float32Array(legs.length * 3)
  legs.forEach((l, k) => { cFrom.set(centroidOf(l.from), k * 3); cTo.set(centroidOf(l.to), k * 3) })
  return { cFrom, cTo }
}

/** Fastest shared S-curve for a whole synchronised move (every drone on the same timing — collision-free with optimal assignment). */
function fastestShared(from: Float32Array, to: Float32Array, L: Limits): { T: number; r: number } {
  const p = fastestProfile(moveExtents(from, to), L)
  return p.T > 0 ? { T: p.T, r: p.r / p.T } : { T: 0.2, r: 0.25 }
}

/**
 * Cascade: every drone flies the plain flight's straight path on the plain
 * flight's exact timing (one shared S-curve), only delayed by its rank in the
 * ripple — so at small stagger it stays close to the synchronised flight that
 * optimal assignment makes safe. The ripple adds stagger × duration.
 */
export function buildCascade(A: Float32Array, B: Float32Array, order: CascadeOrder, stagger: number, L: Limits): Choreo {
  const n = A.length / 3
  const c = centroidOf(B)
  const key = (i: number) => {
    const [x, y, z] = pt(B, i)
    switch (order) {
      case 'left': return x
      case 'right': return -x
      case 'top': return -y
      case 'bottom': return y
      case 'center': return Math.hypot(x - c[0], y - c[1], z - c[2])
      case 'edge': return -Math.hypot(x - c[0], y - c[1], z - c[2])
    }
  }
  let lo = Infinity, hi = -Infinity
  const keys = Array.from({ length: n }, (_, i) => { const k = key(i); lo = Math.min(lo, k); hi = Math.max(hi, k); return k })
  const shared = fastestShared(A, B, L)
  const D = Math.max(0, Math.min(0.9, stagger))
  const per = keys.map((k, i) => {
    const b = new PieceBuilder()
    const s0 = (hi > lo ? (k - lo) / (hi - lo) : 0) * D * shared.T
    b.line(s0, s0 + shared.T, pt(A, i), pt(B, i), shared.r)
    return b
  })
  return assemble(per, null, [0, 0, 1])
}

/**
 * Rain: drones drop to a level carpet just below both formations (lowest
 * first), then rise into the new shape (highest targets first, so climbing
 * drones never pass ones already in place). Each phase is one shared S-curve
 * with start times rippled by height; stagger 0 falls and rises in sync,
 * which optimal assignment makes safe.
 */
export function buildRain(A: Float32Array, Bset: Float32Array, limits: Limits, floor: number, stagger: number): { choreo: Choreo; slot: Int32Array } {
  const n = A.length / 3
  const g = comfortableSpacing(limits.minSpacing)
  const ba = bbox(A), bb = bbox(Bset)
  const y = Math.max(floor + 3, Math.min(ba.lo[1], bb.lo[1]) - 5)
  const cx = (ba.lo[0] + ba.hi[0] + bb.lo[0] + bb.hi[0]) / 4, cz = (ba.lo[2] + ba.hi[2] + bb.lo[2] + bb.hi[2]) / 4
  // Carpet: a level grid, wide across the audience's view, shallow in depth.
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 2.5)))
  const rows = Math.ceil(n / cols)
  const carpet = new Float32Array(n * 3)
  for (let k = 0; k < n; k++) {
    const r = Math.floor(k / cols), c = k % cols
    const inRow = r === rows - 1 ? n - r * cols : cols
    carpet[k * 3] = cx + (c - (inRow - 1) / 2) * g
    carpet[k * 3 + 1] = y
    carpet[k * 3 + 2] = cz + (r - (rows - 1) / 2) * g
  }
  const toCarpet = assignMinSquared(A, carpet)
  const C = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) C.set(pt(carpet, toCarpet[i]!), i * 3)
  const slot = assignMinSquared(C, Bset)
  const Bd = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) Bd.set(pt(Bset, slot[i]!), i * 3)
  const D = Math.max(0, Math.min(0.9, stagger))
  const f1 = fastestShared(A, C, limits), f2 = fastestShared(C, Bd, limits)
  const ya = [ba.lo[1], ba.hi[1]], yb = [bb.lo[1], bb.hi[1]]
  const rise0 = f1.T * (1 + D) + 0.4
  const per = Array.from({ length: n }, (_, i) => {
    const b = new PieceBuilder()
    const r1 = ya[1]! > ya[0]! ? (A[i * 3 + 1]! - ya[0]!) / (ya[1]! - ya[0]!) : 0 // lowest drops first
    const r2 = yb[1]! > yb[0]! ? (yb[1]! - Bd[i * 3 + 1]!) / (yb[1]! - yb[0]!) : 0 // highest rises first
    const s1 = r1 * D * f1.T, s2 = rise0 + r2 * D * f2.T
    b.line(s1, s1 + f1.T, pt(A, i), pt(C, i), f1.r)
    b.line(s2, s2 + f2.T, pt(C, i), pt(Bd, i), f2.r)
    return b
  })
  return { choreo: assemble(per, null, [0, 0, 1]), slot }
}

/**
 * Ant walk, as a conveyor:
 *  1. everyone flies together into a queue up the right leg of an arch beside
 *     the old formation (a synchronised move — safe by optimal assignment);
 *  2. the whole column marches up, over the formations and down the far leg
 *     in lockstep: lanes run in separate planes in front of and behind the
 *     formations, and along each lane drones stay at least a spacing apart;
 *  3. everyone flies together from the queue into the new formation.
 * Safe by construction; the validator checks it anyway. Returns null if the
 * arch can't fit the airspace.
 */
export function buildAnt(A: Float32Array, Bset: Float32Array, limits: Limits, floor: number, lanesWanted: number, gapScale: number): { choreo: Choreo; slot: Int32Array } | null {
  const n = A.length / 3
  const g = comfortableSpacing(limits.minSpacing) * 1.15 * gapScale
  const ba = bbox(A), bb = bbox(Bset)
  const zc = (ba.lo[2] + ba.hi[2] + bb.lo[2] + bb.hi[2]) / 4
  const m = 6 + g
  const xE = ba.hi[0] + m
  // Land on whichever side of the new formation gives the wider arch.
  const xF = Math.abs(bb.lo[0] - m - xE) >= Math.abs(bb.hi[0] + m - xE) ? bb.lo[0] - m : bb.hi[0] + m
  const a = Math.max(Math.abs(xF - xE) / 2, 6)
  const cx = (xE + xF) / 2, sx = xF >= xE ? 1 : -1
  // Legs start beside the formations at mid-height: less climbing and descending (descent is the slowest axis).
  const y0 = Math.max(Math.max(floor, limits.minAltitude) + 3, Math.min((ba.lo[1] + ba.hi[1]) / 2, (bb.lo[1] + bb.hi[1]) / 2) - 10)
  const top = Math.max(ba.hi[1], bb.hi[1]) + 8, room = limits.maxAltitude - 3
  if (top > room) return null
  const b = Math.min(Math.max(a, top - y0), room - y0)
  const path = Float32Array.from([cx, y0, y0, a, b, 1, sx, zc])
  let minS = Infinity
  for (let k = 0; k <= 400; k++) minS = Math.min(minS, Math.hypot(arc1(path, k / 400, 0), arc1(path, k / 400, 1)))
  const dtau = (1.03 * g) / minS
  // Lanes: as few as possible (the longest, most ant-like column) while each lane's queue fits on a leg.
  const maxQ = 0.46
  let K = Math.max(1, Math.min(n, lanesWanted > 0 ? Math.round(lanesWanted) : 1))
  while ((Math.ceil(n / K) - 1) * dtau > maxQ && K < Math.min(n, 40)) K++
  const M = Math.ceil(n / K)
  if ((M - 1) * dtau > maxQ) return null
  const travel = 1 - (M - 1) * dtau
  // Lane planes at ±g, ±2g, … from the formations' plane.
  const offsets: number[] = []
  for (let k = 1; offsets.length < K; k++) { offsets.push(-k * g); if (offsets.length < K) offsets.push(k * g) }
  offsets.sort((p, q) => p - q)
  // Queue slots: row k (0 = front of the column), lanes centred for a partial last row.
  const slots: { lane: number; tau: number }[] = []
  for (let k = 0; k < M; k++) {
    const count = Math.min(K, n - k * K)
    const first = Math.floor((K - count) / 2)
    for (let l = 0; l < count; l++) slots.push({ lane: offsets[first + l]!, tau: (M - 1 - k) * dtau })
  }
  const at = (lane: number, tau: number): V3 => [arc(path, tau, 0), arc(path, tau, 1), zc + lane]
  const Q = new Float32Array(n * 3)
  slots.forEach((q, k) => Q.set(at(q.lane, q.tau), k * 3))
  const toQueue = assignMinSquared(A, Q)
  const Qd = new Float32Array(n * 3), R = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const q = slots[toQueue[i]!]!
    Qd.set(at(q.lane, q.tau), i * 3)
    R.set(at(q.lane, q.tau + travel), i * 3)
  }
  const slot = assignMinSquared(R, Bset)
  const Bd = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) Bd.set(pt(Bset, slot[i]!), i * 3)
  // Timing (seconds at the limits): in, march, out.
  const f1 = fastestShared(A, Qd, limits), f3 = fastestShared(R, Bd, limits)
  const probe = new PieceBuilder()
  probe.ride(0, 1, 0, 0, travel, 0.25)
  const marchPk = choreoPeaks(assemble([probe], path, [0, 0, 1]))
  const march = Math.max(1, minDurationFor(marchPk, limits))
  const pause = 0.5
  const t1 = f1.T + pause, t2 = t1 + march + pause
  const per = Array.from({ length: n }, (_, i) => {
    const q = slots[toQueue[i]!]!
    const pb = new PieceBuilder()
    pb.line(0, f1.T, pt(A, i), pt(Qd, i), f1.r)
    pb.ride(t1, t1 + march, q.lane, q.tau, q.tau + travel, 0.25)
    pb.line(t2, t2 + f3.T, pt(R, i), pt(Bd, i), f3.r)
    return pb
  })
  return { choreo: assemble(per, path, [0, 0, 1]), slot }
}
