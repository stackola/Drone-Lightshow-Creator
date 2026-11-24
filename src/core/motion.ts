// Motion profiles.
//
// All drones in a move share one time-scaling s(t) ∈ [0, 1] and fly straight
// lines: p_i(t) = a_i + (b_i − a_i)·s(t). That shared scaling is what makes
// optimal assignment collision-free (see assign.ts) and lets the validator
// compute closest approaches exactly.
//
// s(t) is an S-curve: velocity ramps up with smoothstep over `r` seconds,
// cruises at h = 1/(T − r), and ramps down over `r` seconds. Acceleration is
// continuous and starts/ends at zero. Its peaks are exact:
//   peak ds/dt    = h
//   peak d²s/dt²  = 1.5·h / r          (smoothstep' peaks at 1.5)
//   peak d³s/dt³  = 6·h / r²           (smoothstep'' peaks at 6, at the ends of each ramp)
// so a drone travelling D metres peaks at D·h m/s, 1.5·D·h/r m/s² and 6·D·h/r² m/s³.

import type { HoldMotion, Limits } from './types'

export const RAMP_ACC = 1.5
export const RAMP_JERK = 6

export interface Profile {
  /** Duration (s). */
  T: number
  /** Ramp time at each end (s), 0 ≤ r ≤ T/2. */
  r: number
  /** Cruise rate of s (1/s): h = 1/(T − r). */
  h: number
}

export const ZERO_PROFILE: Profile = { T: 0, r: 0, h: 0 }

/** ∫₀ˣ smoothstep = x³ − x⁴/2 */
function F(x: number): number {
  const x3 = x * x * x
  return x3 - (x3 * x) / 2
}

function smoothstep(x: number): number {
  return x * x * (3 - 2 * x)
}

/** Normalised progress s(t). */
export function profileS(p: Profile, t: number): number {
  if (p.T <= 0) return 1
  if (t <= 0) return 0
  if (t >= p.T) return 1
  const { r, h, T } = p
  if (r > 0 && t < r) return h * r * F(t / r)
  if (r > 0 && t > T - r) return 1 - h * r * F((T - t) / r)
  return h * (r / 2 + (t - r))
}

/** ds/dt */
export function profileVel(p: Profile, t: number): number {
  if (p.T <= 0 || t <= 0 || t >= p.T) return 0
  const { r, h, T } = p
  if (r > 0 && t < r) return h * smoothstep(t / r)
  if (r > 0 && t > T - r) return h * smoothstep((T - t) / r)
  return h
}

/** d²s/dt² */
export function profileAcc(p: Profile, t: number): number {
  if (p.T <= 0 || t <= 0 || t >= p.T || p.r <= 0) return 0
  const { r, h, T } = p
  const ds = (x: number) => 6 * x * (1 - x)
  if (t < r) return (h * ds(t / r)) / r
  if (t > T - r) return (-h * ds((T - t) / r)) / r
  return 0
}

/** Time at which s(t) = s (s is monotone). */
export function profileInverse(p: Profile, s: number): number {
  if (s <= 0 || p.T <= 0) return 0
  if (s >= 1) return p.T
  let lo = 0, hi = p.T
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (profileS(p, mid) < s) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export interface MoveExtents {
  /** Largest horizontal travel of any drone (m). */
  h: number
  /** Largest climb (m). */
  up: number
  /** Largest descent (m). */
  down: number
  /** Largest total travel (m). */
  d: number
  /** Drone with the largest total travel. */
  drone: number
}

export function moveExtents(from: Float32Array, to: Float32Array): MoveExtents {
  const e: MoveExtents = { h: 0, up: 0, down: 0, d: 0, drone: -1 }
  const n = from.length / 3
  for (let i = 0; i < n; i++) {
    const dx = to[i * 3]! - from[i * 3]!, dy = to[i * 3 + 1]! - from[i * 3 + 1]!, dz = to[i * 3 + 2]! - from[i * 3 + 2]!
    const h = Math.hypot(dx, dz), d = Math.hypot(dx, dy, dz)
    if (h > e.h) e.h = h
    if (dy > e.up) e.up = dy
    if (-dy > e.down) e.down = -dy
    if (d > e.d) { e.d = d; e.drone = i }
  }
  return e
}

/**
 * Fastest profile that keeps every drone within every limit (speed per axis,
 * acceleration, jerk). For a cruise rate h the shortest admissible ramp is
 * r(h) = max(1.5·h·D/a, √(6·h·D/j)); the duration T(h) = 1/h + r(h) is minimised
 * over h subject to the speed limits and r ≤ 1/h.
 */
export function fastestProfile(e: MoveExtents, limits: Limits): Profile {
  if (e.d <= 1e-9) return ZERO_PROFILE
  const div = (v: number, d: number) => (d > 1e-9 ? v / d : Infinity)
  const jerk = limits.maxJerk > 0 ? limits.maxJerk : Infinity
  const hv = Math.min(div(limits.maxSpeedH, e.h), div(limits.maxSpeedUp, e.up), div(limits.maxSpeedDown, e.down))
  const hAcc = Math.sqrt(limits.maxAccel / (RAMP_ACC * e.d))
  const hJerk = Number.isFinite(jerk) ? Math.cbrt(jerk / (RAMP_JERK * e.d)) : Infinity
  const hMax = Math.min(hv, hAcc, hJerk)
  const ramp = (h: number) => Math.min(1 / h, Math.max((RAMP_ACC * h * e.d) / limits.maxAccel, Number.isFinite(jerk) ? Math.sqrt((RAMP_JERK * h * e.d) / jerk) : 0))
  const dur = (h: number) => 1 / h + ramp(h)
  // T(h) is unimodal: coarse log scan, then golden-section refinement.
  let best = hMax, bestT = dur(hMax)
  for (let k = 1; k <= 60; k++) {
    const h = hMax * Math.pow(10, (-3 * k) / 60)
    const T = dur(h)
    if (T < bestT) { bestT = T; best = h }
  }
  let lo = Math.max(hMax * 1e-3, best / 1.13), hi = Math.min(hMax, best * 1.13)
  const g = (Math.sqrt(5) - 1) / 2
  for (let k = 0; k < 40; k++) {
    const a = hi - g * (hi - lo), b = lo + g * (hi - lo)
    if (dur(a) < dur(b)) hi = b
    else lo = a
  }
  const h = dur((lo + hi) / 2) < bestT ? (lo + hi) / 2 : best
  const r = ramp(h)
  return { T: 1 / h + r, r, h }
}

/** Same shape, stretched uniformly to duration T (≥ p.T keeps every limit). */
export function stretchProfile(p: Profile, T: number): Profile {
  if (p.T <= 0) return T > 0 ? { T, r: T / 2, h: 2 / T } : ZERO_PROFILE
  const k = T / p.T
  return { T, r: p.r * k, h: p.h / k }
}

/** Peak speeds, acceleration and jerk of a move under a profile (exact). */
export function profilePeaks(e: MoveExtents, p: Profile): { h: number; up: number; down: number; acc: number; jerk: number } {
  if (p.T <= 0) return { h: 0, up: 0, down: 0, acc: 0, jerk: 0 }
  const acc = p.r > 0 ? (RAMP_ACC * p.h * e.d) / p.r : 0
  const jerk = p.r > 0 ? (RAMP_JERK * p.h * e.d) / (p.r * p.r) : 0
  return { h: e.h * p.h, up: e.up * p.h, down: e.down * p.h, acc, jerk }
}

// --- Spin while holding --------------------------------------------------------
// The formation turns about a vertical axis with the same S-curve shape: the
// angular rate ramps up over `spinRamp(hold)` seconds, cruises at ω, ramps down.

export function spinRamp(hold: number): number {
  return Math.min(3, hold / 2)
}

function spinProfile(hold: number): Profile {
  const r = spinRamp(hold)
  return { T: hold, r, h: 1 }
}

/** Angle (radians) after `t` seconds of a hold lasting `hold` at cruise rate `omega` rad/s. */
export function spinAngle(omega: number, hold: number, t: number): number {
  if (omega === 0 || hold <= 0) return 0
  const p = spinProfile(hold)
  t = Math.max(0, Math.min(hold, t))
  // Same closed form as profileS with h = 1 (unnormalised).
  const { r } = p
  if (r > 0 && t < r) return omega * r * F(t / r)
  const total = omega * (hold - r)
  if (r > 0 && t > hold - r) return total - omega * r * F((hold - t) / r)
  return omega * (r / 2 + (t - r))
}

/** Peak linear speed and acceleration of a point at radius r spinning at omega (rad/s). */
export function spinPeaks(omega: number, hold: number, radius: number): { speed: number; accel: number } {
  const R = spinRamp(hold)
  if (omega === 0 || R <= 0 || radius === 0) return { speed: 0, accel: 0 }
  const w = Math.abs(omega)
  const p = spinProfile(hold)
  let accel = 0
  // Tangential (ω'·r) and centripetal (ω²·r) acceleration over the ramp; the
  // cruise phase is pure centripetal, the ramp end covers it.
  for (let i = 0; i <= 400; i++) {
    const t = (i / 400) * R
    const f = profileVel(p, t) // ∈ [0,1]
    const df = profileAcc(p, t)
    accel = Math.max(accel, Math.hypot(w * df * radius, (w * f) ** 2 * radius))
  }
  return { speed: w * radius, accel }
}

// --- Hold motions -----------------------------------------------------------------
// A held formation can spin, breathe (scale up and back), bob (rise and fall)
// and sway (turn back and forth). All motions ease in and out with an envelope
// that is zero, with zero slope and curvature, at both ends of the hold, so the
// formation arrives and leaves at rest in its base pose (only spin leaves it
// turned) and acceleration stays continuous across the hand-over to a flight.

export const NO_MOTION: HoldMotion = { kind: 'none', amount: 0, period: 4 }

/** Smootherstep: zero slope and zero curvature at both ends, so motion starts and stops without a jolt. */
function smooth(x: number): number {
  return x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (6 * x - 15) + 10)
}

/**
 * 0 at both ends of the hold, 1 in the middle; velocity and acceleration are
 * zero at both ends. The ramp lasts at least one period (so easing in adds
 * little speed on top of the motion itself), at most a quarter of the hold.
 */
export function holdEnvelope(hold: number, t: number, period = 2): number {
  const R = Math.min(Math.max(2, period), hold / 4)
  if (R <= 0) return 0
  return smooth(t / R) * smooth((hold - t) / R)
}

export interface HoldPose {
  /** Rotation about the vertical axis (rad). */
  angle: number
  /** Uniform scale about the formation centre (≥ 1). */
  scale: number
  /** Vertical offset (m). */
  dy: number
}

export function holdPose(omega: number, hold: number, motion: HoldMotion | undefined, t: number): HoldPose {
  let angle = spinAngle(omega, hold, t)
  let scale = 1, dy = 0
  if (motion && motion.kind !== 'none' && motion.amount > 0 && hold > 0) {
    const P = Math.max(0.5, motion.period)
    const env = holdEnvelope(hold, t, P)
    const w = (2 * Math.PI) / P
    if (motion.kind === 'breathe') scale = 1 + motion.amount * env * (1 - Math.cos(w * t)) / 2
    else if (motion.kind === 'bob') dy = motion.amount * env * Math.sin(w * t)
    else if (motion.kind === 'sway') angle += (motion.amount * Math.PI / 180) * env * Math.sin(w * t)
  }
  return { angle, scale, dy }
}

/** Position of a point (given relative to the centre) at hold time t. */
export function holdPoint(rel: [number, number, number], center: [number, number, number], pose: HoldPose): [number, number, number] {
  const x = rel[0] * pose.scale, y = rel[1] * pose.scale, z = rel[2] * pose.scale
  const c = Math.cos(pose.angle), s = Math.sin(pose.angle)
  return [center[0] + c * x + s * z, center[1] + y + pose.dy, center[2] - s * x + c * z]
}

export interface MotionPeaks {
  speedH: number
  up: number
  down: number
  accel: number
  jerk: number
}

/**
 * Peak speed, acceleration and jerk of points moving through a hold, measured
 * on the actual trajectory (central differences on the closed-form pose, fine
 * enough to be accurate to well under 1%). Pass the points that move most:
 * the farthest from the centre and the farthest from the spin axis.
 */
export function holdPeaks(rels: [number, number, number][], omega: number, hold: number, motion: HoldMotion | undefined): MotionPeaks {
  const out: MotionPeaks = { speedH: 0, up: 0, down: 0, accel: 0, jerk: 0 }
  const moving = omega !== 0 || (motion && motion.kind !== 'none' && motion.amount > 0)
  if (!moving || hold <= 0 || !rels.length) return out
  const steps = Math.min(6000, Math.max(400, Math.ceil(hold / 0.01)))
  const dt = hold / steps
  const c: [number, number, number] = [0, 0, 0]
  for (const rel of rels) {
    const P: [number, number, number][] = []
    for (let k = -2; k <= steps + 2; k++) {
      const t = Math.max(0, Math.min(hold, k * dt))
      P.push(holdPoint(rel, c, holdPose(omega, hold, motion, t)))
    }
    for (let k = 2; k < P.length - 2; k++) {
      const v = [0, 1, 2].map((i) => (P[k + 1]![i]! - P[k - 1]![i]!) / (2 * dt))
      const a = [0, 1, 2].map((i) => (P[k + 1]![i]! - 2 * P[k]![i]! + P[k - 1]![i]!) / (dt * dt))
      const j = [0, 1, 2].map((i) => (P[k + 2]![i]! - 2 * P[k + 1]![i]! + 2 * P[k - 1]![i]! - P[k - 2]![i]!) / (2 * dt * dt * dt))
      out.speedH = Math.max(out.speedH, Math.hypot(v[0]!, v[2]!))
      out.up = Math.max(out.up, v[1]!)
      out.down = Math.max(out.down, -v[1]!)
      out.accel = Math.max(out.accel, Math.hypot(a[0]!, a[1]!, a[2]!))
      out.jerk = Math.max(out.jerk, Math.hypot(j[0]!, j[1]!, j[2]!))
    }
  }
  return out
}

export interface HoldRange {
  /** Largest scale reached (≥ 1). */
  scaleMax: number
  dyMin: number
  dyMax: number
  /** Range of the turn angle (spin + sway), radians. */
  angleLo: number
  angleHi: number
}

/** Extremes of the hold pose over the whole hold (fine sampling of smooth scalar functions). */
export function holdRange(omega: number, hold: number, motion: HoldMotion | undefined): HoldRange {
  const out: HoldRange = { scaleMax: 1, dyMin: 0, dyMax: 0, angleLo: 0, angleHi: 0 }
  const moving = omega !== 0 || (motion && motion.kind !== 'none' && motion.amount > 0)
  if (!moving || hold <= 0) return out
  const steps = Math.min(20000, Math.max(200, Math.ceil(hold / 0.005)))
  for (let k = 0; k <= steps; k++) {
    const p = holdPose(omega, hold, motion, (k / steps) * hold)
    if (p.scale > out.scaleMax) out.scaleMax = p.scale
    if (p.dy < out.dyMin) out.dyMin = p.dy
    if (p.dy > out.dyMax) out.dyMax = p.dy
    if (p.angle < out.angleLo) out.angleLo = p.angle
    if (p.angle > out.angleHi) out.angleHi = p.angle
  }
  return out
}

export function isMoving(motion: HoldMotion | undefined): boolean {
  return !!motion && motion.kind !== 'none' && motion.amount > 0
}
