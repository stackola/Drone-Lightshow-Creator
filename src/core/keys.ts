// Keyframes while a formation is held: it moves, turns and scales as a whole.
//
// Between keys the formation follows a minimum-jerk curve (10u³ − 15u⁴ + 6u⁵),
// so it eases out of each key and comes to rest at the next with zero speed
// and acceleration: smooth for the drones, and easy to check. A rest key
// (no move, no turn, size 1) is implied at the start of the hold, so the
// formation arrives exactly as designed; after the last key it stays put.
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

/** Keys sorted by time, inside [0, hold], with valid values; duplicates at one time keep the last. */
export function normalizeKeys(keys: HoldKey[] | undefined, hold: number): HoldKey[] {
  if (!keys?.length) return []
  const out: HoldKey[] = []
  for (const k of [...keys].sort((a, b) => a.t - b.t)) {
    const t = Math.max(0, Math.min(Math.max(0, hold), Number.isFinite(k.t) ? k.t : 0))
    const key: HoldKey = { t, move: k.move.map((v) => (Number.isFinite(v) ? v : 0)) as Vec3, rotate: k.rotate.map((v) => (Number.isFinite(v) ? v : 0)) as Vec3, scale: Number.isFinite(k.scale) && k.scale > 0 ? k.scale : 1 }
    if (out.length && Math.abs(out[out.length - 1]!.t - t) < 1e-6) out[out.length - 1] = key
    else out.push(key)
  }
  return out
}

export function hasKeys(keys: HoldKey[] | undefined): boolean {
  return !!keys?.some((k) => k.scale !== 1 || k.move.some((v) => v !== 0) || k.rotate.some((v) => v !== 0))
}

function lerpPose(a: KeyPose, b: KeyPose, s: number): KeyPose {
  return {
    move: [0, 1, 2].map((i) => a.move[i]! + (b.move[i]! - a.move[i]!) * s) as Vec3,
    rotate: [0, 1, 2].map((i) => a.rotate[i]! + (b.rotate[i]! - a.rotate[i]!) * s) as Vec3,
    scale: a.scale + (b.scale - a.scale) * s,
  }
}

/** The keyed pose at hold-local time tau (keys normalized). */
export function keyPose(keys: HoldKey[], tau: number): KeyPose {
  if (!keys.length) return REST_POSE
  let prev: KeyPose & { t: number } = { ...REST_POSE, t: 0 }
  for (const k of keys) {
    if (tau < k.t) {
      const span = k.t - prev.t
      return span > 1e-9 ? lerpPose(prev, k, ease((tau - prev.t) / span)) : k
    }
    prev = k
  }
  return prev
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
  return keys.map((k) => ({ t: k.t, move: k.move.map((v) => v * f) as Vec3, rotate: k.rotate.map((v) => v * f) as Vec3, scale: 1 + (k.scale - 1) * f }))
}
