// Exact safety validation — no sampling, no fudge factors.
//
// • Flights are synchronised straight-line moves sharing one time-scaling s(t),
//   so the distance between drones i and j is |A + s·B| for fixed vectors A, B.
//   Its minimum over s ∈ [0,1] has a closed form, so every pair is checked
//   exactly.
// • Holds are rigid (static or spinning about a vertical axis), so spacing is
//   constant and altitude is constant.
// • Straight segments reach their altitude/radius extremes at the endpoints,
//   which are formation or pad positions — so those are checked there.
// • Speeds and accelerations follow from the min-jerk peaks (motion.ts).

import type { Compiled, CompiledScene } from './compile'
import { moveExtents, profileInverse, profilePeaks, spinAngle, spinPeaks } from './motion'
import type { ShowDoc } from './types'
import { DEG } from './math'

export type FixAction =
  | { kind: 'fit-spacing'; sceneId: string; target: number }
  | { kind: 'set-spin'; sceneId: string; value: number }
  | { kind: 'move'; sceneId: string; delta: [number, number, number] }
  | { kind: 'grid-spacing'; value: number }
  /** The formation is bigger than the airspace: use fewer drones (park the rest) or a filled style. */
  | { kind: 'fit-airspace'; sceneId: string }

export interface Issue {
  id: string
  severity: 'error' | 'warning'
  kind: 'spacing' | 'near-miss' | 'altitude' | 'geofence' | 'speed' | 'accel' | 'spin' | 'flight-time' | 'pads'
  title: string
  detail: string
  /** Show time to jump to. */
  time: number
  sceneId?: string
  /** Drone indices involved (0-based). */
  drones: number[]
  fix?: { label: string; action: FixAction }
}

export interface SafetyStats {
  minDistance: number
  minDistanceTime: number
  peakSpeedH: number
  peakClimb: number
  peakDescent: number
  peakAccel: number
  maxAltitude: number
  maxRadius: number
  duration: number
}

export interface Validation {
  issues: Issue[]
  stats: SafetyStats
}

const EPS = 1e-6

/** The spacing that guarantees collision-free optimal transitions (√2·min, rounded up). */
export function comfortableSpacing(minSpacing: number): number {
  return Math.ceil(minSpacing * Math.SQRT2 * 1.03 * 10) / 10
}

export function closestPair(pts: Float32Array): { i: number; j: number; d: number; below: (limit: number) => number } {
  const n = pts.length / 3
  let bi = -1, bj = -1, best = Infinity
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3]!, y = pts[i * 3 + 1]!, z = pts[i * 3 + 2]!
    for (let j = i + 1; j < n; j++) {
      const dx = x - pts[j * 3]!, dy = y - pts[j * 3 + 1]!, dz = z - pts[j * 3 + 2]!
      const d = dx * dx + dy * dy + dz * dz
      if (d < best) { best = d; bi = i; bj = j }
    }
  }
  return {
    i: bi, j: bj, d: Math.sqrt(best),
    below(limit: number) {
      const l2 = limit * limit
      let count = 0
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const dx = pts[i * 3]! - pts[j * 3]!, dy = pts[i * 3 + 1]! - pts[j * 3 + 1]!, dz = pts[i * 3 + 2]! - pts[j * 3 + 2]!
          if (dx * dx + dy * dy + dz * dz < l2 - EPS) count++
        }
      return count
    },
  }
}

/** Exact closest approach of all pairs during a synchronised straight-line move. */
export function flightClosestApproach(from: Float32Array, to: Float32Array, limit: number): { d: number; s: number; i: number; j: number; pairsBelow: number } {
  const n = from.length / 3
  let best = Infinity, bs = 0, bi = -1, bj = -1, below = 0
  const l2 = limit * limit
  for (let i = 0; i < n; i++) {
    const ax = from[i * 3]!, ay = from[i * 3 + 1]!, az = from[i * 3 + 2]!
    const ex = to[i * 3]! - ax, ey = to[i * 3 + 1]! - ay, ez = to[i * 3 + 2]! - az
    for (let j = i + 1; j < n; j++) {
      const Ax = ax - from[j * 3]!, Ay = ay - from[j * 3 + 1]!, Az = az - from[j * 3 + 2]!
      const Bx = ex - (to[j * 3]! - from[j * 3]!), By = ey - (to[j * 3 + 1]! - from[j * 3 + 1]!), Bz = ez - (to[j * 3 + 2]! - from[j * 3 + 2]!)
      const bb = Bx * Bx + By * By + Bz * Bz
      let s = bb > 1e-12 ? -(Ax * Bx + Ay * By + Az * Bz) / bb : 0
      if (s < 0) s = 0
      else if (s > 1) s = 1
      const x = Ax + s * Bx, y = Ay + s * By, z = Az + s * Bz
      const d = x * x + y * y + z * z
      if (d < l2 - EPS) below++
      if (d < best) { best = d; bs = s; bi = i; bj = j }
    }
  }
  return { d: Math.sqrt(best), s: bs, i: bi, j: bj, pairsBelow: below }
}

function fmt(v: number, digits = 1): string {
  return v.toFixed(digits)
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

/** Largest spin rate (deg/s, same sign) that respects speed and acceleration limits. */
export function maxSafeSpin(spinDeg: number, hold: number, radius: number, maxSpeed: number, maxAccel: number): number {
  const sign = Math.sign(spinDeg) || 1
  let lo = 0, hi = Math.abs(spinDeg)
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2
    const p = spinPeaks(mid * DEG, hold, radius)
    if (p.speed <= maxSpeed && p.accel <= maxAccel) lo = mid
    else hi = mid
  }
  return sign * Math.floor(lo * 10) / 10
}

export function validate(doc: ShowDoc, c: Compiled): Validation {
  const L = doc.limits
  const issues: Issue[] = []
  const stats: SafetyStats = {
    minDistance: Infinity, minDistanceTime: 0, peakSpeedH: 0, peakClimb: 0, peakDescent: 0, peakAccel: 0,
    maxAltitude: 0, maxRadius: 0, duration: c.duration,
  }
  const sceneName = (i: number) => doc.scenes[i]?.name ?? `Scene ${i + 1}`
  const comfy = comfortableSpacing(L.minSpacing)

  // --- Pads ---
  if (c.n > 1 && doc.site.gridSpacing + EPS < L.minSpacing) {
    issues.push({
      id: 'pads', severity: 'error', kind: 'pads',
      title: `Takeoff pads ${fmt(doc.site.gridSpacing)} m apart`,
      detail: `Pads must be at least ${fmt(L.minSpacing)} m apart (minimum drone spacing).`,
      time: 0, drones: [0, 1],
      fix: { label: `Set pad spacing to ${fmt(comfy)} m`, action: { kind: 'grid-spacing', value: comfy } },
    })
  }
  if (c.n > 1 && doc.site.gridSpacing < stats.minDistance) {
    stats.minDistance = doc.site.gridSpacing
    stats.minDistanceTime = 0
  }

  // --- Holds ---
  for (const cs of c.scenes) {
    const scene = doc.scenes[cs.index]!
    const ts = c.sceneTimes[cs.index]!
    const droneOfPoint = new Int32Array(c.n)
    for (let i = 0; i < c.n; i++) droneOfPoint[cs.slot[i]!] = i

    if (c.n > 1) {
      const cp = closestPair(cs.points)
      if (cp.d < stats.minDistance) { stats.minDistance = cp.d; stats.minDistanceTime = ts.holdStart }
      if (cp.d + EPS < L.minSpacing) {
        const count = cp.below(L.minSpacing)
        issues.push({
          id: `spacing:${cs.id}`, severity: 'error', kind: 'spacing', sceneId: cs.id,
          title: `“${scene.name}” is too dense`,
          detail: `${count} pair${count === 1 ? '' : 's'} of drones closer than ${fmt(L.minSpacing)} m (closest ${fmt(cp.d, 2)} m).`,
          time: ts.holdStart, drones: [droneOfPoint[cp.i]!, droneOfPoint[cp.j]!],
          fix: { label: 'Enlarge to safe spacing', action: { kind: 'fit-spacing', sceneId: cs.id, target: comfy } },
        })
      }
    }

    // Altitude (spin keeps altitude constant).
    let minY = Infinity, maxY = -Infinity, lowK = 0, highK = 0
    for (let k = 0; k < c.n; k++) {
      const y = cs.points[k * 3 + 1]!
      if (y < minY) { minY = y; lowK = k }
      if (y > maxY) { maxY = y; highK = k }
    }
    stats.maxAltitude = Math.max(stats.maxAltitude, maxY)
    // Moving can't help a formation taller than the airspace — it needs fewer drones.
    const tooTall = maxY - minY > L.maxAltitude - L.minAltitude - 2
    const shrink = { label: 'Shrink to fit (park spare drones)', action: { kind: 'fit-airspace' as const, sceneId: cs.id } }
    if (minY + EPS < L.minAltitude) {
      const dy = Math.ceil((L.minAltitude - minY) * 2) / 2
      issues.push({
        id: `alt-low:${cs.id}`, severity: 'error', kind: 'altitude', sceneId: cs.id,
        title: `“${scene.name}” is too low`,
        detail: `Lowest drone at ${fmt(minY)} m; formations must stay above ${fmt(L.minAltitude)} m.`,
        time: ts.holdStart, drones: [droneOfPoint[lowK]!],
        fix: tooTall ? shrink : { label: `Raise ${fmt(dy)} m`, action: { kind: 'move', sceneId: cs.id, delta: [0, dy, 0] } },
      })
    }
    if (maxY - EPS > L.maxAltitude) {
      const dy = Math.ceil((maxY - L.maxAltitude) * 2) / 2
      issues.push({
        id: `alt-high:${cs.id}`, severity: 'error', kind: 'altitude', sceneId: cs.id,
        title: `“${scene.name}” is too high`,
        detail: `Highest drone at ${fmt(maxY)} m; the ceiling is ${fmt(L.maxAltitude)} m.`,
        time: ts.holdStart, drones: [droneOfPoint[highK]!],
        fix: tooTall ? shrink : { label: `Lower ${fmt(dy)} m`, action: { kind: 'move', sceneId: cs.id, delta: [0, -dy, 0] } },
      })
    }

    // Geofence radius, exact over the whole spin.
    const { r, k: farK } = maxRadius(cs)
    stats.maxRadius = Math.max(stats.maxRadius, r)
    if (r - EPS > L.maxRadius) {
      // If the formation itself fits inside the circle, move it toward the centre; otherwise shrink it.
      const ch = Math.hypot(cs.center[0], cs.center[2])
      const excess = Math.ceil((r - L.maxRadius + 1) * 2) / 2
      const canMove = cs.spinRadius < L.maxRadius - 2 && ch > excess
      issues.push({
        id: `fence:${cs.id}`, severity: 'error', kind: 'geofence', sceneId: cs.id,
        title: `“${scene.name}” leaves the flight area`,
        detail: `A drone reaches ${fmt(r)} m from the centre; the limit is ${fmt(L.maxRadius)} m.`,
        time: ts.holdStart, drones: [droneOfPoint[farK]!],
        fix: canMove
          ? { label: `Move ${fmt(excess)} m toward the centre`, action: { kind: 'move', sceneId: cs.id, delta: [(-cs.center[0] / ch) * excess, 0, (-cs.center[2] / ch) * excess] } }
          : shrink,
      })
    }

    // Spin dynamics.
    if (cs.omega !== 0) {
      const p = spinPeaks(cs.omega, cs.hold, cs.spinRadius)
      stats.peakSpeedH = Math.max(stats.peakSpeedH, p.speed)
      stats.peakAccel = Math.max(stats.peakAccel, p.accel)
      if (p.speed - EPS > L.maxSpeedH || p.accel - EPS > L.maxAccel) {
        const safe = maxSafeSpin(scene.spin, cs.hold, cs.spinRadius, L.maxSpeedH, L.maxAccel)
        const what = p.speed - EPS > L.maxSpeedH ? `outer drones reach ${fmt(p.speed)} m/s (limit ${fmt(L.maxSpeedH)})` : `outer drones accelerate at ${fmt(p.accel)} m/s² (limit ${fmt(L.maxAccel)})`
        issues.push({
          id: `spin:${cs.id}`, severity: 'error', kind: 'spin', sceneId: cs.id,
          title: `“${scene.name}” spins too fast`,
          detail: `At ${fmt(scene.spin)}°/s ${what}.`,
          time: ts.holdStart + Math.min(cs.hold / 2, 3), drones: [],
          fix: { label: `Slow to ${fmt(safe)}°/s`, action: { kind: 'set-spin', sceneId: cs.id, value: safe } },
        })
      }
    }
  }

  // --- Flights, takeoff, landing ---
  for (const seg of c.segments) {
    if (seg.kind === 'hold') continue
    const T = seg.t1 - seg.t0
    const n = c.n
    // Dynamics: exact peaks of the shared S-curve.
    const ext = moveExtents(seg.from, seg.to)
    const wi = Math.max(0, ext.drone)
    if (T > 0) {
      const pk = profilePeaks(ext, seg.profile)
      const vh = pk.h, vu = pk.up, vd = pk.down, a = pk.acc
      stats.peakSpeedH = Math.max(stats.peakSpeedH, vh)
      stats.peakClimb = Math.max(stats.peakClimb, vu)
      stats.peakDescent = Math.max(stats.peakDescent, vd)
      stats.peakAccel = Math.max(stats.peakAccel, a)
      const label = seg.kind === 'flight' ? (seg.into >= 0 ? `Flight into “${sceneName(seg.into)}”` : 'Return flight') : seg.kind === 'takeoff' ? 'Takeoff' : 'Landing'
      const over = (v: number, lim: number) => v - 1e-3 > lim
      if (over(vh, L.maxSpeedH) || over(vu, L.maxSpeedUp) || over(vd, L.maxSpeedDown)) {
        issues.push({
          id: `speed:${seg.t0}`, severity: 'error', kind: 'speed', sceneId: seg.kind === 'flight' && seg.into >= 0 ? doc.scenes[seg.into]!.id : undefined,
          title: `${label} is too fast`,
          detail: `Peak speeds ${fmt(vh)} m/s horizontal, ${fmt(vu)} up, ${fmt(vd)} down.`,
          time: seg.t0 + T / 2, drones: [wi],
        })
      }
      if (over(a, L.maxAccel)) {
        issues.push({
          id: `accel:${seg.t0}`, severity: 'error', kind: 'accel',
          title: `${label} accelerates too hard`,
          detail: `Peak ${fmt(a)} m/s² (limit ${fmt(L.maxAccel)}).`,
          time: seg.t0 + seg.profile.r / 2, drones: [wi],
        })
      }
    } else if (ext.d > 1e-6) {
      issues.push({ id: `teleport:${seg.t0}`, severity: 'error', kind: 'speed', title: 'Instant move', detail: 'A move has zero duration.', time: seg.t0, drones: [wi] })
    }

    // Spacing: takeoff/landing are vertical and synchronised, so spacing equals pad spacing.
    if (seg.kind !== 'flight' || n < 2) continue
    const ca = flightClosestApproach(seg.from, seg.to, L.minSpacing)
    const at = seg.t0 + profileInverse(seg.profile, ca.s)
    if (ca.d < stats.minDistance) { stats.minDistance = ca.d; stats.minDistanceTime = at }
    if (ca.d + EPS < L.minSpacing) {
      const into = seg.into >= 0 ? c.scenes[seg.into]! : null
      const fromIdx = seg.into >= 0 ? seg.into - 1 : c.scenes.length - 1
      const from = fromIdx >= 0 ? c.scenes[fromIdx]! : null
      // Suggest enlarging whichever end is densest below the guarantee threshold.
      const candidates = [from, into].filter((s): s is CompiledScene => !!s && s.spacing + EPS < comfy)
      candidates.sort((a, b) => a.spacing - b.spacing)
      const target = candidates[0]
      const label = seg.into >= 0 ? `Flight into “${sceneName(seg.into)}”` : 'Return flight'
      issues.push({
        id: `miss:${seg.t0}`, severity: 'error', kind: 'near-miss', sceneId: into?.id ?? from?.id,
        title: `${label}: drones pass too close`,
        detail: `${ca.pairsBelow} pair${ca.pairsBelow === 1 ? '' : 's'} come closer than ${fmt(L.minSpacing)} m (closest ${fmt(ca.d, 2)} m at ${formatTime(at)}). Formations spaced ≥ ${fmt(comfy)} m always fly clear.`,
        time: at, drones: [ca.i, ca.j],
        fix: target ? { label: `Enlarge “${doc.scenes[target.index]!.name}”`, action: { kind: 'fit-spacing', sceneId: target.id, target: comfy } } : undefined,
      })
    }
  }

  // --- Battery ---
  if (c.duration - EPS > L.maxFlightTime) {
    issues.push({
      id: 'battery', severity: 'error', kind: 'flight-time',
      title: 'Show is longer than the battery allows',
      detail: `Total flight time ${formatTime(c.duration)}; budget ${formatTime(L.maxFlightTime)}.`,
      time: L.maxFlightTime, drones: [],
    })
  }

  if (!Number.isFinite(stats.minDistance)) stats.minDistance = 0
  issues.sort((a, b) => (a.severity === b.severity ? a.time - b.time : a.severity === 'error' ? -1 : 1))
  return { issues, stats }
}

/**
 * Exact maximum horizontal distance from the origin reached by any drone of a
 * hold. A point p (relative to the spin centre c) rotated by θ has
 * |c + R(θ)p|² = |c|² + |p|² + 2(P·cosθ + Q·sinθ), maximised in closed form
 * over the swept interval [0, Θ].
 */
function maxRadius(cs: CompiledScene): { r: number; k: number } {
  const n = cs.points.length / 3
  const [cx, , cz] = cs.center
  const total = cs.omega === 0 ? 0 : spinAngle(cs.omega, cs.hold, cs.hold)
  const lo = Math.min(0, total), hi = Math.max(0, total)
  const c2 = cx * cx + cz * cz
  let best = 0, bk = 0
  for (let k = 0; k < n; k++) {
    const x = cs.points[k * 3]! - cx, z = cs.points[k * 3 + 2]! - cz
    const P = cx * x + cz * z, Q = cx * z - cz * x
    const M = Math.hypot(P, Q)
    let m = Math.max(P, P * Math.cos(total) + Q * Math.sin(total))
    if (M > 0 && hi > lo) {
      const phi = Math.atan2(Q, P)
      // Is phi + 2πj inside [lo, hi] for some integer j?
      const j = Math.ceil((lo - phi) / (Math.PI * 2))
      if (phi + j * Math.PI * 2 <= hi) m = M
    }
    const r = Math.sqrt(Math.max(0, c2 + x * x + z * z + 2 * m))
    if (r > best) { best = r; bk = k }
  }
  return { r: best, k: bk }
}
