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
//   peak ds/dt   = h
//   peak d²s/dt² = 1.5·h / r          (smoothstep' peaks at 1.5)
// so a drone travelling D metres peaks at D·h m/s and 1.5·D·h/r m/s².

import type { Limits } from './types'

export const RAMP_ACC = 1.5

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

/** Fastest profile that keeps every drone within every limit. */
export function fastestProfile(e: MoveExtents, limits: Limits): Profile {
  if (e.d <= 1e-9) return ZERO_PROFILE
  const div = (v: number, d: number) => (d > 1e-9 ? v / d : Infinity)
  const hv = Math.min(div(limits.maxSpeedH, e.h), div(limits.maxSpeedUp, e.up), div(limits.maxSpeedDown, e.down))
  const ha = Math.sqrt(limits.maxAccel / (RAMP_ACC * e.d))
  const h = Math.min(hv, ha)
  const r = Math.min((RAMP_ACC * h * e.d) / limits.maxAccel, 1 / h)
  return { T: 1 / h + r, r, h }
}

/** Same shape, stretched uniformly to duration T (≥ p.T keeps every limit). */
export function stretchProfile(p: Profile, T: number): Profile {
  if (p.T <= 0) return T > 0 ? { T, r: T / 2, h: 2 / T } : ZERO_PROFILE
  const k = T / p.T
  return { T, r: p.r * k, h: p.h / k }
}

/** Peak speeds/acceleration of a move under a profile (exact). */
export function profilePeaks(e: MoveExtents, p: Profile): { h: number; up: number; down: number; acc: number } {
  if (p.T <= 0) return { h: 0, up: 0, down: 0, acc: 0 }
  const acc = p.r > 0 ? (RAMP_ACC * p.h * e.d) / p.r : 0
  return { h: e.h * p.h, up: e.up * p.h, down: e.down * p.h, acc }
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
