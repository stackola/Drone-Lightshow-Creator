// Exact safety validation — no fudge factors.
//
// • Every flight leg is a synchronised straight-line move sharing one
//   time-scaling s(t), so the distance between drones i and j is |A + s·B| for
//   fixed vectors A, B. Its minimum over s ∈ [0,1] has a closed form, so every
//   pair is checked exactly, on every leg (detours have up to three).
// • Holds are spin plus breathe (uniform scale ≥ 1 about the centre), bob
//   (vertical shift) or sway (turn back and forth). None of these brings two
//   drones closer than in the base formation, so held spacing is the base
//   spacing. Altitude and radius extremes are bounded over the whole pose range.
// • Straight legs reach their altitude/radius extremes at their endpoints, so
//   formation, pad and detour waypoints are checked there.
// • Flight speed, acceleration and jerk come from the exact S-curve peaks;
//   hold motion peaks are measured on the closed-form trajectory.

import { choreoExtents, type Compiled, type CompiledScene, type Segment } from './compile'
import { choreoPairs, choreoPeaks, sampledPeaks, scalePeaks, wrapPos, type Choreo, type PairResult, type UPeaks } from './transitions'
import { NO_MOTION, holdPeaks, holdRange, isMoving, moveExtents, profileInverse, profilePeaks, type HoldRange, type MotionPeaks } from './motion'
import type { HoldMotion, Limits, ShowDoc } from './types'
import { DEG } from './math'

export type FixAction =
  | { kind: 'fit-spacing'; sceneId: string; target: number }
  | { kind: 'set-spin'; sceneId: string; value: number }
  | { kind: 'move'; sceneId: string; delta: [number, number, number] }
  | { kind: 'grid-spacing'; value: number }
  /** The formation is bigger than the airspace: use fewer drones (park the rest) or a filled style. */
  | { kind: 'fit-airspace'; sceneId: string }
  /** Scale down spin and hold motion together. */
  | { kind: 'calm-hold'; sceneId: string; factor: number }
  /** Change a flight's transition style (sceneId null = the return flight). */
  | { kind: 'flight-style'; sceneId: string | null; style: 'direct' }

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
  peakJerk: number
  maxAltitude: number
  maxRadius: number
  duration: number
}

export interface Validation {
  issues: Issue[]
  stats: SafetyStats
}

const EPS = 1e-6

// Choreographies are cached by the compiler, so their (expensive) checks are cached per object.
const choreoChecks = new WeakMap<Choreo, { pk: UPeaks; ext: { minY: number; maxY: number; maxR: number }; pairs: (minSpacing: number) => PairResult }>()
function checkChoreo(ch: Choreo, n: number) {
  let c = choreoChecks.get(ch)
  if (!c) {
    const pk = choreoPeaks(ch)
    const memo = new Map<number, PairResult>()
    c = {
      pk, ext: choreoExtents(ch, n),
      pairs: (ms: number) => {
        let r = memo.get(ms)
        if (!r) { r = choreoPairs(ch, n, ms, pk.acc, Math.hypot(pk.h, Math.max(pk.up, pk.down))); memo.set(ms, r) }
        return r
      },
    }
    choreoChecks.set(ch, c)
  }
  return c
}

export { comfortableSpacing, closestPair, flightClosestApproach } from './separation'
import { comfortableSpacing, closestPair, flightClosestApproach } from './separation'

function fmt(v: number, digits = 1): string {
  return v.toFixed(digits)
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

type Rel = [number, number, number]

function withinLimits(p: MotionPeaks, L: Limits): boolean {
  return p.speedH <= L.maxSpeedH && p.up <= L.maxSpeedUp && p.down <= L.maxSpeedDown && p.accel <= L.maxAccel && p.jerk <= L.maxJerk
}

/** Largest factor f ∈ [0, 1] such that spin × f and motion amount × f respect every limit. */
export function safeHoldFactor(rels: Rel[], omega: number, hold: number, motion: HoldMotion | undefined, L: Limits): number {
  const at = (f: number) => holdPeaks(rels, omega * f, hold, motion ? { ...motion, amount: motion.amount * f } : NO_MOTION)
  if (withinLimits(at(1), L)) return 1
  let lo = 0, hi = 1
  for (let k = 0; k < 22; k++) {
    const mid = (lo + hi) / 2
    if (withinLimits(at(mid), L)) lo = mid
    else hi = mid
  }
  return Math.floor(lo * 100) / 100
}

/** Largest motion amount in [0, cap] that respects every limit with the given spin (0 if the spin alone is too fast). */
export function maxSafeMotionAmount(rels: Rel[], omega: number, hold: number, motion: HoldMotion, L: Limits, cap: number): number {
  const ok = (a: number) => withinLimits(holdPeaks(rels, omega, hold, { ...motion, amount: a }), L)
  if (!ok(0)) return 0
  if (ok(cap)) return cap
  let lo = 0, hi = cap
  for (let k = 0; k < 22; k++) {
    const mid = (lo + hi) / 2
    if (ok(mid)) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * Largest spin rate (deg/s, same sign, at most `cap`) for a drone `radius` from
 * the axis that respects every limit.
 */
export function maxSafeSpin(spinDeg: number, hold: number, radius: number, L: Limits, motion?: HoldMotion, cap = Math.abs(spinDeg)): number {
  const sign = Math.sign(spinDeg) || 1
  const rels: Rel[] = [[radius, 0, 0]]
  let lo = 0, hi = cap
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2
    if (withinLimits(holdPeaks(rels, sign * mid * DEG, hold, motion), L)) lo = mid
    else hi = mid
  }
  return sign * Math.floor(lo * 10) / 10
}

/**
 * The points of a formation that move fastest under spin, breathe, bob and
 * sway: farthest from the centre, farthest from the vertical axis, highest
 * and lowest (relative to the centre).
 */
export function extremeRels(cs: Pick<CompiledScene, 'points' | 'center'>): Rel[] {
  const [cx, cy, cz] = cs.center
  const n = cs.points.length / 3
  const best = [-1, -1, -1, -1], val = [-Infinity, -Infinity, -Infinity, -Infinity]
  for (let k = 0; k < n; k++) {
    const x = cs.points[k * 3]! - cx, y = cs.points[k * 3 + 1]! - cy, z = cs.points[k * 3 + 2]! - cz
    const v = [x * x + y * y + z * z, x * x + z * z, y, -y]
    for (let m = 0; m < 4; m++) if (v[m]! > val[m]!) { val[m] = v[m]!; best[m] = k }
  }
  const ks = [...new Set(best.filter((k) => k >= 0))]
  return ks.map((k) => [cs.points[k * 3]! - cx, cs.points[k * 3 + 1]! - cy, cs.points[k * 3 + 2]! - cz])
}

const NO_RANGE: HoldRange = { scaleMax: 1, dyMin: 0, dyMax: 0, angleLo: 0, angleHi: 0 }

function scaleMotion(m: HoldMotion, k: number): HoldMotion {
  return { ...m, amount: m.amount * k }
}

/** Largest factor in [0, 1] (to 1%) for which `ok` holds; ok(0) is assumed. */
function calmFactor(ok: (k: number) => boolean): number {
  let lo = 0, hi = 1
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2
    if (ok(mid)) lo = mid
    else hi = mid
  }
  return Math.floor(lo * 100) / 100
}

/** Lowest and highest altitude any drone of a hold reaches over the pose range. */
function verticalExtent(cs: CompiledScene, range: HoldRange): { minY: number; maxY: number; lowK: number; highK: number } {
  const cy = cs.center[1]
  let minY = Infinity, maxY = -Infinity, lowK = 0, highK = 0
  for (let k = 0; k < cs.points.length / 3; k++) {
    const rel = cs.points[k * 3 + 1]! - cy
    const lowY = cy + rel * (rel < 0 ? range.scaleMax : 1) + range.dyMin
    const highY = cy + rel * (rel > 0 ? range.scaleMax : 1) + range.dyMax
    if (lowY < minY) { minY = lowY; lowK = k }
    if (highY > maxY) { maxY = highY; highK = k }
  }
  return { minY, maxY, lowK, highK }
}

function segmentLabel(seg: Segment, sceneName: (i: number) => string): string {
  if (seg.kind === 'flight') return seg.into >= 0 ? `Flight into “${sceneName(seg.into)}”` : 'Return flight'
  return seg.kind === 'takeoff' ? 'Takeoff' : seg.kind === 'land' ? 'Landing' : 'Hold'
}

export function validate(doc: ShowDoc, c: Compiled): Validation {
  const L = doc.limits
  const issues: Issue[] = []
  const stats: SafetyStats = {
    minDistance: Infinity, minDistanceTime: 0, peakSpeedH: 0, peakClimb: 0, peakDescent: 0, peakAccel: 0, peakJerk: 0,
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

    // Altitude: spin and sway keep it; breathe scales heights about the centre, bob shifts them.
    const range = holdRange(cs.omega, cs.hold, cs.motion)
    const { minY, maxY, lowK, highK } = verticalExtent(cs, range)
    stats.maxAltitude = Math.max(stats.maxAltitude, maxY)
    const room = L.maxAltitude - L.minAltitude - 2
    // Moving can't help a formation taller than the airspace. If the formation
    // itself is too tall it needs fewer drones; if only its motion makes it too
    // tall, the motion needs calming.
    const base = verticalExtent(cs, NO_RANGE)
    const baseTooTall = base.maxY - base.minY > room
    const tooTall = maxY - minY > room
    let shrink: Issue['fix'] = { label: 'Shrink to fit (park spare drones)', action: { kind: 'fit-airspace' as const, sceneId: cs.id } }
    if (tooTall && !baseTooTall && cs.motion.kind !== 'none') {
      const f = calmFactor((k) => { const e = verticalExtent(cs, holdRange(cs.omega, cs.hold, scaleMotion(cs.motion, k))); return e.maxY - e.minY <= room })
      shrink = { label: `Calm motion to ${Math.round(f * 100)}%`, action: { kind: 'calm-hold', sceneId: cs.id, factor: f } }
    }
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

    // Geofence radius, exact over the whole range of turn and scale.
    const { r, k: farK } = maxRadius(cs, range)
    stats.maxRadius = Math.max(stats.maxRadius, r)
    if (r - EPS > L.maxRadius) {
      // If the formation itself fits inside the circle, move it toward the centre; otherwise shrink it.
      const ch = Math.hypot(cs.center[0], cs.center[2])
      const excess = Math.ceil((r - L.maxRadius + 1) * 2) / 2
      const canMove = cs.spinRadius * range.scaleMax < L.maxRadius - 2 && ch > excess
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

    // Spin and hold-motion dynamics, measured on the fastest-moving points.
    if (cs.omega !== 0 || isMoving(cs.motion)) {
      const rels = extremeRels(cs)
      const p = holdPeaks(rels, cs.omega, cs.hold, cs.motion)
      stats.peakSpeedH = Math.max(stats.peakSpeedH, p.speedH)
      stats.peakClimb = Math.max(stats.peakClimb, p.up)
      stats.peakDescent = Math.max(stats.peakDescent, p.down)
      stats.peakAccel = Math.max(stats.peakAccel, p.accel)
      stats.peakJerk = Math.max(stats.peakJerk, p.jerk)
      const over = (v: number, lim: number) => v - 1e-3 * Math.max(1, lim) > lim
      const what =
        over(p.speedH, L.maxSpeedH) ? `drones reach ${fmt(p.speedH)} m/s (limit ${fmt(L.maxSpeedH)})`
          : over(p.up, L.maxSpeedUp) ? `drones climb at ${fmt(p.up)} m/s (limit ${fmt(L.maxSpeedUp)})`
            : over(p.down, L.maxSpeedDown) ? `drones descend at ${fmt(p.down)} m/s (limit ${fmt(L.maxSpeedDown)})`
              : over(p.accel, L.maxAccel) ? `drones accelerate at ${fmt(p.accel)} m/s² (limit ${fmt(L.maxAccel)})`
                : over(p.jerk, L.maxJerk) ? `acceleration changes at ${fmt(p.jerk)} m/s³ (jerk limit ${fmt(L.maxJerk)})`
                  : null
      if (what) {
        const moving = isMoving(cs.motion)
        const factor = safeHoldFactor(rels, cs.omega, cs.hold, cs.motion, L)
        const motionName = moving ? cs.motion.kind === 'breathe' ? 'breathing' : cs.motion.kind === 'bob' ? 'bobbing' : 'swaying' : ''
        const fix: Issue['fix'] = moving
          ? { label: `Calm ${scene.spin ? 'spin and motion' : 'motion'} to ${Math.round(factor * 100)}%`, action: { kind: 'calm-hold', sceneId: cs.id, factor } }
          : { label: `Slow to ${fmt(Math.trunc(scene.spin * factor * 10) / 10)}°/s`, action: { kind: 'set-spin', sceneId: cs.id, value: Math.trunc(scene.spin * factor * 10) / 10 } }
        issues.push({
          id: `spin:${cs.id}`, severity: 'error', kind: 'spin', sceneId: cs.id,
          title: moving ? `“${scene.name}” moves too fast while held` : `“${scene.name}” spins too fast`,
          detail: moving ? `While ${scene.spin ? `spinning at ${fmt(scene.spin)}°/s and ` : ''}${motionName}, ${what}.` : `At ${fmt(scene.spin)}°/s ${what}.`,
          time: ts.holdStart + Math.min(cs.hold / 2, 3), drones: [],
          fix,
        })
      }
    }
  }

  // --- Flights, takeoff, landing ---
  for (const seg of c.segments) {
    if (seg.kind === 'hold') continue
    const n = c.n
    const label = segmentLabel(seg, sceneName)
    const into = seg.kind === 'flight' && seg.into >= 0 ? c.scenes[seg.into]! : null
    const fromIdx = seg.kind === 'flight' ? (seg.into >= 0 ? seg.into - 1 : c.scenes.length - 1) : -1
    const from = fromIdx >= 0 ? c.scenes[fromIdx]! : null
    const sceneId = into?.id
    // Suggest enlarging whichever end is densest below the guarantee threshold.
    const denser = [from, into].filter((x): x is CompiledScene => !!x && x.spacing + EPS < comfy).sort((a, b) => a.spacing - b.spacing)[0]
    const enlarge = denser ? { label: `Enlarge “${doc.scenes[denser.index]!.name}”`, action: { kind: 'fit-spacing' as const, sceneId: denser.id, target: comfy } } : undefined

    // Dynamics: exact peaks of each leg's S-curve — or of the transition's own paths.
    const worst = { vh: 0, vu: 0, vd: 0, a: 0, j: 0, aAt: seg.t0, jAt: seg.t0, drone: 0 }
    const style = seg.kind === 'flight' ? seg.style : undefined
    const T = seg.t1 - seg.t0
    const toDirect = seg.kind === 'flight' && style ? { label: 'Fly direct instead', action: { kind: 'flight-style' as const, sceneId: seg.into >= 0 ? doc.scenes[seg.into]!.id : null, style: 'direct' as const } } : undefined
    if (seg.kind === 'flight' && style && T > 0) {
      const sp = style.kind === 'choreo'
        ? (() => { const cc = checkChoreo(style.choreo, n); return { ...scalePeaks(cc.pk, T), ...cc.ext, minYDrone: 0, maxYDrone: 0, maxRDrone: 0 } })()
        : (() => { const s0 = sampledPeaks(n, (u, out) => wrapPos(seg.legs, style.wrap, seg.t0, T, seg.t0 + u * T, out), 480); return { ...s0, ...scalePeaks(s0, T) } })()
      worst.vh = sp.h; worst.vu = sp.up; worst.vd = sp.down; worst.a = sp.acc; worst.j = sp.jerk; worst.drone = sp.drone
      worst.aAt = worst.jAt = seg.t0 + T / 2
      stats.maxAltitude = Math.max(stats.maxAltitude, sp.maxY)
      stats.maxRadius = Math.max(stats.maxRadius, sp.maxR)
      const what = segmentLabel(seg, sceneName)
      if (sp.minY + EPS < seg.floor) issues.push({ id: `style-low:${seg.t0}`, severity: 'error', kind: 'altitude', sceneId, title: `${what} dips below the floor`, detail: `A drone reaches ${fmt(sp.minY)} m during the ${seg.transition.used} transition (floor ${fmt(seg.floor)} m).`, time: seg.t0 + T / 2, drones: [sp.minYDrone], fix: toDirect })
      if (sp.maxY - EPS > L.maxAltitude) issues.push({ id: `style-high:${seg.t0}`, severity: 'error', kind: 'altitude', sceneId, title: `${what} climbs above the ceiling`, detail: `A drone reaches ${fmt(sp.maxY)} m during the ${seg.transition.used} transition (ceiling ${fmt(L.maxAltitude)} m).`, time: seg.t0 + T / 2, drones: [sp.maxYDrone], fix: toDirect })
      if (sp.maxR - EPS > L.maxRadius) issues.push({ id: `style-fence:${seg.t0}`, severity: 'error', kind: 'geofence', sceneId, title: `${what} leaves the flight area`, detail: `A drone reaches ${fmt(sp.maxR)} m from the centre during the ${seg.transition.used} transition (limit ${fmt(L.maxRadius)} m).`, time: seg.t0 + T / 2, drones: [sp.maxRDrone], fix: toDirect })
    }
    for (const leg of style ? [] : seg.legs) {
      const ext = moveExtents(leg.from, leg.to)
      const T = leg.t1 - leg.t0
      if (T > 0) {
        const pk = profilePeaks(ext, leg.profile)
        if (pk.h + pk.up + pk.down > worst.vh + worst.vu + worst.vd) worst.drone = Math.max(0, ext.drone)
        worst.vh = Math.max(worst.vh, pk.h)
        worst.vu = Math.max(worst.vu, pk.up)
        worst.vd = Math.max(worst.vd, pk.down)
        if (pk.acc > worst.a) { worst.a = pk.acc; worst.aAt = leg.t0 + leg.profile.r / 2 }
        if (pk.jerk > worst.j) { worst.j = pk.jerk; worst.jAt = leg.t0 }
      } else if (ext.d > 1e-6) {
        issues.push({ id: `teleport:${leg.t0}`, severity: 'error', kind: 'speed', sceneId, title: 'Instant move', detail: `${label} has a zero-duration move.`, time: leg.t0, drones: [Math.max(0, ext.drone)] })
      }
    }
    stats.peakSpeedH = Math.max(stats.peakSpeedH, worst.vh)
    stats.peakClimb = Math.max(stats.peakClimb, worst.vu)
    stats.peakDescent = Math.max(stats.peakDescent, worst.vd)
    stats.peakAccel = Math.max(stats.peakAccel, worst.a)
    stats.peakJerk = Math.max(stats.peakJerk, worst.j)
    const over = (v: number, lim: number) => v - 1e-3 > lim
    const mid = (seg.t0 + seg.t1) / 2
    if (over(worst.vh, L.maxSpeedH) || over(worst.vu, L.maxSpeedUp) || over(worst.vd, L.maxSpeedDown)) {
      issues.push({
        id: `speed:${seg.t0}`, severity: 'error', kind: 'speed', sceneId,
        title: `${label} is too fast`,
        detail: `Peak speeds ${fmt(worst.vh)} m/s horizontal, ${fmt(worst.vu)} up, ${fmt(worst.vd)} down.`,
        time: mid, drones: [worst.drone],
      })
    }
    if (over(worst.a, L.maxAccel)) {
      issues.push({
        id: `accel:${seg.t0}`, severity: 'error', kind: 'accel', sceneId,
        title: `${label} accelerates too hard`,
        detail: `Peak ${fmt(worst.a)} m/s² (limit ${fmt(L.maxAccel)}).`,
        time: worst.aAt, drones: [worst.drone],
      })
    }
    if (over(worst.j, L.maxJerk)) {
      issues.push({
        id: `jerk:${seg.t0}`, severity: 'error', kind: 'accel', sceneId,
        title: `${label} changes speed too abruptly`,
        detail: `Peak jerk ${fmt(worst.j)} m/s³ (limit ${fmt(L.maxJerk)}).`,
        time: worst.jAt, drones: [worst.drone],
      })
    }

    // Detour waypoints: legs are straight, so their extremes are at the endpoints.
    for (let li = 0; li + 1 < seg.legs.length; li++) {
      const leg = seg.legs[li]!
      const p = leg.to
      let lo = Infinity, hi = -Infinity, far = 0, farI = 0, loI = 0, hiI = 0
      for (let i = 0; i < n; i++) {
        const y = p[i * 3 + 1]!, r = Math.hypot(p[i * 3]!, p[i * 3 + 2]!)
        if (y < lo) { lo = y; loI = i }
        if (y > hi) { hi = y; hiI = i }
        if (r > far) { far = r; farI = i }
      }
      stats.maxAltitude = Math.max(stats.maxAltitude, hi)
      stats.maxRadius = Math.max(stats.maxRadius, far)
      const where = leg.kind === 'spread' ? 'while spreading out' : 'while closing in'
      if (lo + EPS < L.minAltitude && seg.kind === 'flight' && fromIdx >= 0 && into) {
        issues.push({ id: `detour-low:${seg.t0}`, severity: 'error', kind: 'altitude', sceneId, title: `${label} dips too low ${where}`, detail: `A drone reaches ${fmt(lo)} m (floor ${fmt(L.minAltitude)} m) on the collision-avoiding detour.`, time: leg.t1, drones: [loI], fix: enlarge })
      }
      if (hi - EPS > L.maxAltitude) {
        issues.push({ id: `detour-high:${seg.t0}`, severity: 'error', kind: 'altitude', sceneId, title: `${label} climbs too high ${where}`, detail: `A drone reaches ${fmt(hi)} m (ceiling ${fmt(L.maxAltitude)} m) on the collision-avoiding detour.`, time: leg.t1, drones: [hiI], fix: enlarge })
      }
      if (far - EPS > L.maxRadius) {
        issues.push({ id: `detour-fence:${seg.t0}`, severity: 'error', kind: 'geofence', sceneId, title: `${label} leaves the flight area ${where}`, detail: `A drone reaches ${fmt(far)} m from the centre (limit ${fmt(L.maxRadius)} m) on the collision-avoiding detour.`, time: leg.t1, drones: [farI], fix: enlarge })
      }
    }

    // Spacing: takeoff/landing are vertical and synchronised, so spacing equals pad spacing.
    // Swirl and burst only rotate and enlarge the flying formation, so the plain legs' exact check bounds them;
    // choreographed transitions are checked on a fine grid with a proven margin.
    if (seg.kind !== 'flight' || n < 2) continue
    let ca = { d: Infinity, s: 0, i: 0, j: 0, pairsBelow: 0 }, at = seg.t0
    if (seg.style?.kind === 'choreo') {
      const r = checkChoreo(seg.style.choreo, n).pairs(L.minSpacing)
      ca = { d: r.d, s: r.u, i: r.i, j: r.j, pairsBelow: r.pairsBelow }
      at = seg.t0 + r.u * T
    }
    for (const leg of seg.style?.kind === 'choreo' ? [] : seg.legs) {
      const r = flightClosestApproach(leg.from, leg.to, L.minSpacing)
      if (r.d < ca.d) { ca = r; at = leg.t0 + profileInverse(leg.profile, r.s) }
    }
    if (ca.d < stats.minDistance) { stats.minDistance = ca.d; stats.minDistanceTime = at }
    if (ca.d + EPS < L.minSpacing) {
      issues.push({
        id: `miss:${seg.t0}`, severity: 'error', kind: 'near-miss', sceneId: into?.id ?? from?.id,
        title: `${label}: drones pass too close`,
        detail: `${ca.pairsBelow} pair${ca.pairsBelow === 1 ? '' : 's'} come closer than ${fmt(L.minSpacing)} m (closest ${fmt(ca.d, 2)} m at ${formatTime(at)}). Formations spaced ≥ ${fmt(comfy)} m always fly clear.`,
        time: at, drones: [ca.i, ca.j],
        fix: seg.style ? toDirect : enlarge,
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
 * Maximum horizontal distance from the origin reached by any drone of a hold.
 * A point p (relative to the centre c) turned by θ and scaled by σ has
 * |c + σR(θ)p|² = |c|² + σ²|p|² + 2σ(P·cosθ + Q·sinθ). The bracket is
 * maximised in closed form over the turned interval [θlo, θhi], and the whole
 * expression is convex in σ, so its maximum is at σ = 1 or σ = σmax.
 */
function maxRadius(cs: CompiledScene, range: HoldRange): { r: number; k: number } {
  const n = cs.points.length / 3
  const [cx, , cz] = cs.center
  const lo = range.angleLo, hi = range.angleHi
  const c2 = cx * cx + cz * cz
  let best = 0, bk = 0
  for (let k = 0; k < n; k++) {
    const x = cs.points[k * 3]! - cx, z = cs.points[k * 3 + 2]! - cz
    const P = cx * x + cz * z, Q = cx * z - cz * x
    const M = Math.hypot(P, Q)
    let m = Math.max(P * Math.cos(lo) + Q * Math.sin(lo), P * Math.cos(hi) + Q * Math.sin(hi))
    if (M > 0 && hi > lo) {
      const phi = Math.atan2(Q, P)
      // Is phi + 2πj inside [lo, hi] for some integer j?
      const j = Math.ceil((lo - phi) / (Math.PI * 2))
      if (phi + j * Math.PI * 2 <= hi) m = M
    }
    const p2 = x * x + z * z
    const at = (sg: number) => Math.sqrt(Math.max(0, c2 + sg * sg * p2 + 2 * sg * m))
    const r = Math.max(at(1), at(range.scaleMax))
    if (r > best) { best = r; bk = k }
  }
  return { r: best, k: bk }
}
