// Keyframes while a formation is held: it moves, turns and scales as a whole.
//
// The pose follows quintic Hermite curves, matching position, velocity and
// acceleration at every key (so acceleration is continuous and jerk finite).
// At a key it stops at, velocity and acceleration are zero and the segment is
// exactly the minimum-jerk curve 10u³ − 15u⁴ + 6u⁵. At a key it flows
// through, velocity and acceleration come from its neighbours (central
// differences), so the formation sweeps through in one smooth curve. A rest
// key (no move, no turn, size 1) is implied at the start of the hold, so the
// formation arrives exactly as designed; the last key always stops, and the
// formation stays there until the hold ends.
//
// Every keyframed pose is an affine map of the formation (translation, rotation,
// uniform scale), so distances between drones only change with the scale: the
// smallest spacing is the base spacing times the smallest key scale.

import type { HoldKey, Vec3 } from './types'
import { rotationMatrix } from './math'

export interface KeyPose {
  move: Vec3
  rotate: Vec3
  scale: number
}

export const REST_POSE: KeyPose = { move: [0, 0, 0], rotate: [0, 0, 0], scale: 1 }

/** Minimum-jerk easing on [0, 1]. */
export function ease(u: number): number {
  const x = Math.max(0, Math.min(1, u))
  return x * x * x * (10 + x * (-15 + 6 * x))
}

/** Earliest key time: the formation arrives as designed, so a key needs a moment to get anywhere. */
export const MIN_KEY_TIME = 0.1

/**
 * Keys sorted by time, inside [MIN_KEY_TIME, hold], with valid values;
 * duplicates at one time keep the last; the last key always stops.
 */
export function normalizeKeys(keys: HoldKey[] | undefined, hold: number): HoldKey[] {
  if (!keys?.length) return []
  const out: HoldKey[] = []
  const lo = Math.min(MIN_KEY_TIME, Math.max(0, hold))
  for (const k of [...keys].sort((a, b) => a.t - b.t)) {
    const t = Math.max(lo, Math.min(Math.max(0, hold), Number.isFinite(k.t) ? k.t : 0))
    const key: HoldKey = { t, move: k.move.map((v) => (Number.isFinite(v) ? v : 0)) as Vec3, rotate: k.rotate.map((v) => (Number.isFinite(v) ? v : 0)) as Vec3, scale: Number.isFinite(k.scale) && k.scale > 0 ? k.scale : 1, ...(k.through ? { through: true } : {}) }
    if (out.length && Math.abs(out[out.length - 1]!.t - t) < 1e-6) out[out.length - 1] = key
    else out.push(key)
  }
  if (out.length) { const last = out[out.length - 1]!; if (last.through) out[out.length - 1] = { ...last, through: false } }
  return out
}

export function hasKeys(keys: HoldKey[] | undefined): boolean {
  return !!keys?.some((k) => k.scale !== 1 || k.move.some((v) => v !== 0) || k.rotate.some((v) => v !== 0))
}

/** The pose as 7 numbers: move x, y, z, rotate x, y, z, scale. */
const vec7 = (k: { move: Vec3; rotate: Vec3; scale: number }): number[] => [...k.move, ...k.rotate, k.scale]
const pose7 = (v: number[]): KeyPose => ({ move: [v[0]!, v[1]!, v[2]!], rotate: [v[3]!, v[4]!, v[5]!], scale: v[6]! })

interface Knot { t: number; p: number[]; v: number[]; a: number[] }

/** Curve knots: the implied rest key at 0, then the keys, with velocity and acceleration per component. */
const knotCache = new WeakMap<HoldKey[], Knot[]>()
function knots(keys: HoldKey[]): Knot[] {
  let ks = knotCache.get(keys)
  if (ks) return ks
  const pts = [{ t: 0, p: vec7(REST_POSE), through: false }, ...keys.map((k) => ({ t: k.t, p: vec7(k), through: !!k.through }))]
  ks = pts.map((k, i) => {
    const zero = [0, 0, 0, 0, 0, 0, 0]
    const prev = pts[i - 1], next = pts[i + 1]
    if (!k.through || !prev || !next || next.t - prev.t < 1e-9) return { t: k.t, p: k.p, v: zero, a: zero }
    const span = next.t - prev.t, h0 = Math.max(1e-9, k.t - prev.t), h1 = Math.max(1e-9, next.t - k.t)
    return {
      t: k.t, p: k.p,
      v: k.p.map((_, c) => (next.p[c]! - prev.p[c]!) / span),
      a: k.p.map((_, c) => (2 * ((next.p[c]! - k.p[c]!) / h1 - (k.p[c]! - prev.p[c]!) / h0)) / span),
    }
  })
  knotCache.set(keys, ks)
  return ks
}

/** Quintic Hermite between two knots (position, velocity, acceleration matched at both ends). */
function hermite(a: Knot, b: Knot, tau: number): number[] {
  const h = b.t - a.t
  const s = Math.max(0, Math.min(1, (tau - a.t) / h)), s2 = s * s, s3 = s2 * s, s4 = s3 * s, s5 = s4 * s
  const H0 = 1 - 10 * s3 + 15 * s4 - 6 * s5, H5 = 10 * s3 - 15 * s4 + 6 * s5
  const H1 = s - 6 * s3 + 8 * s4 - 3 * s5, H4 = -4 * s3 + 7 * s4 - 3 * s5
  const H2 = 0.5 * s2 - 1.5 * s3 + 1.5 * s4 - 0.5 * s5, H3 = 0.5 * s3 - s4 + 0.5 * s5
  return a.p.map((_, c) => H0 * a.p[c]! + H1 * h * a.v[c]! + H2 * h * h * a.a[c]! + H3 * h * h * b.a[c]! + H4 * h * b.v[c]! + H5 * b.p[c]!)
}

/** The keyed pose at hold-local time tau (keys normalized). */
export function keyPose(keys: HoldKey[], tau: number): KeyPose {
  if (!keys.length) return REST_POSE
  const ks = knots(keys)
  if (tau <= 0) return REST_POSE
  for (let i = 1; i < ks.length; i++) {
    if (tau < ks[i]!.t) return ks[i]!.t - ks[i - 1]!.t > 1e-9 ? pose7(hermite(ks[i - 1]!, ks[i]!, tau)) : pose7(ks[i]!.p)
  }
  return pose7(ks[ks.length - 1]!.p)
}

/**
 * Smallest size the keyframed formation reaches over [0, hold] (never above
 * 1): exact at the keys when every key stops (minimum-jerk segments are
 * monotone); with keys flowed through, sampled and lowered by the steepest
 * size change × half the sample step, which bounds the dips between samples.
 */
export function minScale(keys: HoldKey[], hold: number): { scale: number; t: number } {
  if (!keys.length) return { scale: 1, t: 0 }
  if (!keys.some((k) => k.through)) {
    const k = keys.reduce((a, b) => (b.scale < a.scale ? b : a), keys[0]!)
    return k.scale < 1 ? { scale: k.scale, t: k.t } : { scale: 1, t: 0 }
  }
  const end = Math.max(hold, keys[keys.length - 1]!.t)
  const steps = 2000, dt = end / steps
  let lo = 1, at = 0, prev = 1, slope = 0
  for (let i = 0; i <= steps; i++) {
    const s = keyPose(keys, i * dt).scale
    if (s < lo) { lo = s; at = i * dt }
    if (i) slope = Math.max(slope, Math.abs(s - prev) / dt)
    prev = s
  }
  return { scale: Math.min(1, lo - slope * 1.2 * dt / 2), t: at }
}

/** 3×3 matrix (row-major) of a keyed pose: scale × rotation. */
export function keyMatrix(p: KeyPose): number[] {
  const R = rotationMatrix(p.rotate)
  return R.map((v) => v * p.scale)
}

/** A point given relative to the formation centre, moved by a keyed pose (written to out). */
export function applyKey(p: KeyPose, M: number[], center: Vec3, rx: number, ry: number, rz: number, out: Float32Array | number[], o = 0): void {
  out[o] = center[0] + p.move[0] + M[0]! * rx + M[1]! * ry + M[2]! * rz
  out[o + 1] = center[1] + p.move[1] + M[3]! * rx + M[4]! * ry + M[5]! * rz
  out[o + 2] = center[2] + p.move[2] + M[6]! * rx + M[7]! * ry + M[8]! * rz
}

/** Smallest scale the keys reach (the spacing factor); never above 1. */
export function minKeyScale(keys: HoldKey[]): number {
  return Math.min(1, ...keys.map((k) => k.scale))
}

/** Keys calmed toward rest by a factor (0 = no keyed motion, 1 = as set). */
export function scaleKeys(keys: HoldKey[], f: number): HoldKey[] {
  return keys.map((k) => ({ t: k.t, move: k.move.map((v) => v * f) as Vec3, rotate: k.rotate.map((v) => v * f) as Vec3, scale: 1 + (k.scale - 1) * f, ...(k.through ? { through: true } : {}) }))
}
