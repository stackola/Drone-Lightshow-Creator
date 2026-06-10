// ============================================================================
// Shared Vec3 Math Utilities
// ============================================================================
// Canonical Vec3 operations. All files import from here.
// ============================================================================

import type { Vec3 } from './types'

export function v3add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z } }
export function v3sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z } }
export function v3scale(v: Vec3, s: number): Vec3 { return { x: v.x * s, y: v.y * s, z: v.z * s } }

export function v3lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }
}

export function v3dist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

export function v3distSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

export function v3len(v: Vec3): number { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) }

export function v3normalize(v: Vec3): Vec3 {
  const l = v3len(v)
  return l > 0 ? v3scale(v, 1 / l) : { x: 0, y: 0, z: 1 }
}

export function v3cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

export function v3dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z }

/** Wrap angle delta to [-PI, PI] for shortest-path rotation interpolation */
function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}

/** Lerp rotation angles via shortest arc (handles wrapping) */
export function v3lerpAngle(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + wrapAngle(b.x - a.x) * t,
    y: a.y + wrapAngle(b.y - a.y) * t,
    z: a.z + wrapAngle(b.z - a.z) * t,
  }
}

export function centroid(pts: Vec3[]): Vec3 {
  if (pts.length === 0) return { x: 0, y: 0, z: 0 }
  let sx = 0, sy = 0, sz = 0
  for (const p of pts) { sx += p.x; sy += p.y; sz += p.z }
  return { x: sx / pts.length, y: sy / pts.length, z: sz / pts.length }
}
