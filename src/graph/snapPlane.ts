// ============================================================================
// Bundle 2: Snap Plane — Rotateable Construction Plane
// ============================================================================
// Pure math for projecting / quantising points onto an oriented plane.
// Plane is defined by a position (origin) and Euler XYZ rotation (degrees).
// In plane-local space the snap surface is the XY plane; we project onto z=0
// then quantize x and y to a grid before transforming back.
// ============================================================================

import type { Vec3 } from './types'

export interface SnapPlane {
  position: Vec3
  rotationDeg: Vec3
}

function rotateX(p: Vec3, rad: number): Vec3 {
  const c = Math.cos(rad), s = Math.sin(rad)
  return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c }
}

function rotateY(p: Vec3, rad: number): Vec3 {
  const c = Math.cos(rad), s = Math.sin(rad)
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c }
}

function rotateZ(p: Vec3, rad: number): Vec3 {
  const c = Math.cos(rad), s = Math.sin(rad)
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z }
}

const DEG = Math.PI / 180

/** World → plane-local (translate then inverse XYZ Euler). */
export function toLocal(p: Vec3, plane: SnapPlane): Vec3 {
  const tx = p.x - plane.position.x
  const ty = p.y - plane.position.y
  const tz = p.z - plane.position.z
  // Inverse of R = Rx * Ry * Rz is Rz⁻¹ * Ry⁻¹ * Rx⁻¹.
  let q: Vec3 = { x: tx, y: ty, z: tz }
  q = rotateZ(q, -plane.rotationDeg.z * DEG)
  q = rotateY(q, -plane.rotationDeg.y * DEG)
  q = rotateX(q, -plane.rotationDeg.x * DEG)
  return q
}

/** Plane-local → world (forward XYZ Euler then translate). */
export function fromLocal(pl: Vec3, plane: SnapPlane): Vec3 {
  let q: Vec3 = { x: pl.x, y: pl.y, z: pl.z }
  q = rotateX(q, plane.rotationDeg.x * DEG)
  q = rotateY(q, plane.rotationDeg.y * DEG)
  q = rotateZ(q, plane.rotationDeg.z * DEG)
  return { x: q.x + plane.position.x, y: q.y + plane.position.y, z: q.z + plane.position.z }
}

/** Project a world point onto the plane and snap to its grid. */
export function snapToPlane(p: Vec3, plane: SnapPlane, cellSize: number): Vec3 {
  const local = toLocal(p, plane)
  const snapped: Vec3 = {
    x: Math.round(local.x / cellSize) * cellSize,
    y: Math.round(local.y / cellSize) * cellSize,
    z: 0,
  }
  return fromLocal(snapped, plane)
}
