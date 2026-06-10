// ============================================================================
// Build Planes — first-class persistent construction surfaces
// ============================================================================
// Pure math for projecting points onto an oriented, optionally CURVED plane and
// back. Generalises src/graph/snapPlane.ts (flat-only) to closed-form curved
// surfaces (cylinder / dome / wave).
//
// A BuildPlane has a rigid frame (position + Euler XYZ rotation, degrees). In
// plane-LOCAL space the flat surface is the XY plane (z=0), exactly like
// snapPlane. Surface params (u,v) are the local X,Y. A curvature lifts those
// (u,v) off z=0 into a 3D surface; every curve type is analytically invertible
// so projection (world→surface) and stamping (surface→world) share one path.
//
// No THREE here — Vec3 in / Vec3 out, unit-testable like snapPlane.test.ts.
// ============================================================================

import type { Vec3, FormationNode } from './types'

export type CurveType = 'flat' | 'cylinder' | 'dome' | 'wave'
/** Which in-plane local axis the bend runs along: 'x' = local-X (u), 'z' = local-Y (v). */
export type CurveAxis = 'x' | 'z'

export interface PlaneCurvature {
  type: CurveType
  /** cylinder/dome: curvature k = 1/radius. wave: amplitude. 0 ⇒ flat regardless of type. */
  amount: number
  axis: CurveAxis
  /** wave only: wavelength in world units (defaults to 8). */
  wavelength?: number
}

export interface BuildPlane {
  id: string
  name: string
  /** Origin in world space. */
  position: Vec3
  /** Euler XYZ rotation in degrees (reuses the snapPlane convention). */
  rotationDeg: Vec3
  /** Square extent in world units. */
  size: number
  /** Snap grid spacing in surface units. */
  cellSize: number
  curvature: PlaneCurvature
  /** When true, bound items' base-transform DnD is constrained to the surface. */
  locked: boolean
  visible: boolean
}

export const DEFAULT_CURVATURE: PlaneCurvature = { type: 'flat', amount: 0, axis: 'x' }
export const DEFAULT_WAVELENGTH = 8

/** Standard plane orientations consumed by the view-mode seam (default plane per view). */
export type PlaneKind = 'ground-xz' | 'vertical-xy' | 'vertical-zy'

/** Euler XYZ (degrees) that orients a plane's local XY surface to each world kind. */
export const PLANE_KIND_ROTATION: Record<PlaneKind, Vec3> = {
  'ground-xz': { x: -90, y: 0, z: 0 }, // surface lies flat on the ground, normal up
  'vertical-xy': { x: 0, y: 0, z: 0 }, // faces the audience (+z), front wall
  'vertical-zy': { x: 0, y: 90, z: 0 }, // faces +x, side wall
}
/** Below this |amount| we treat any curve as flat (avoids 1/0 and limit blow-ups). */
const FLAT_EPS = 1e-6

// --- Rigid frame (ported from snapPlane.ts) ---

const DEG = Math.PI / 180

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

/** World → plane-local (translate then inverse XYZ Euler). */
export function worldToPlaneLocal(p: Vec3, plane: { position: Vec3; rotationDeg: Vec3 }): Vec3 {
  let q: Vec3 = { x: p.x - plane.position.x, y: p.y - plane.position.y, z: p.z - plane.position.z }
  q = rotateZ(q, -plane.rotationDeg.z * DEG)
  q = rotateY(q, -plane.rotationDeg.y * DEG)
  q = rotateX(q, -plane.rotationDeg.x * DEG)
  return q
}

/** Plane-local → world (forward XYZ Euler then translate). */
export function planeLocalToWorld(local: Vec3, plane: { position: Vec3; rotationDeg: Vec3 }): Vec3 {
  let q: Vec3 = { x: local.x, y: local.y, z: local.z }
  q = rotateX(q, plane.rotationDeg.x * DEG)
  q = rotateY(q, plane.rotationDeg.y * DEG)
  q = rotateZ(q, plane.rotationDeg.z * DEG)
  return { x: q.x + plane.position.x, y: q.y + plane.position.y, z: q.z + plane.position.z }
}

// --- Curvature: (u,v) surface coords <-> local (x,y,z) ---

export interface SurfaceUV {
  u: number
  v: number
}

function curvatureOf(plane: { curvature?: PlaneCurvature }): PlaneCurvature {
  return plane.curvature ?? DEFAULT_CURVATURE
}

/** Map surface (u,v) → plane-LOCAL (x,y,z), lifting per curvature. */
function surfaceToLocal(uv: SurfaceUV, c: PlaneCurvature): Vec3 {
  const k = c.amount
  if (c.type === 'flat' || Math.abs(k) < FLAT_EPS) {
    return { x: uv.u, y: uv.v, z: 0 }
  }
  if (c.type === 'wave') {
    const lambda = c.wavelength && c.wavelength > FLAT_EPS ? c.wavelength : DEFAULT_WAVELENGTH
    const s = c.axis === 'x' ? uv.u : uv.v
    return { x: uv.u, y: uv.v, z: k * Math.sin((2 * Math.PI * s) / lambda) }
  }
  const R = 1 / k
  if (c.type === 'cylinder') {
    // Bend the s-axis into an arc; the other in-plane axis passes through.
    const s = c.axis === 'x' ? uv.u : uv.v
    const t = c.axis === 'x' ? uv.v : uv.u
    const theta = s * k
    const bent = R * Math.sin(theta)
    const lift = R * (1 - Math.cos(theta))
    return c.axis === 'x'
      ? { x: bent, y: t, z: lift }
      : { x: t, y: bent, z: lift }
  }
  // dome — radial sphere-cap (axis ignored)
  const rho = Math.hypot(uv.u, uv.v)
  if (rho < FLAT_EPS) return { x: 0, y: 0, z: 0 }
  const theta = rho * k
  const scale = (R * Math.sin(theta)) / rho
  return { x: uv.u * scale, y: uv.v * scale, z: R * (1 - Math.cos(theta)) }
}

/** Project plane-LOCAL (x,y,z) onto the surface → (u,v) + signed off-surface distance. */
function localToSurface(local: Vec3, c: PlaneCurvature): { u: number; v: number; dist: number } {
  const k = c.amount
  if (c.type === 'flat' || Math.abs(k) < FLAT_EPS) {
    return { u: local.x, v: local.y, dist: local.z }
  }
  if (c.type === 'wave') {
    const lambda = c.wavelength && c.wavelength > FLAT_EPS ? c.wavelength : DEFAULT_WAVELENGTH
    const s = c.axis === 'x' ? local.x : local.y
    const surfaceZ = k * Math.sin((2 * Math.PI * s) / lambda)
    return { u: local.x, v: local.y, dist: local.z - surfaceZ }
  }
  const R = 1 / k
  if (c.type === 'cylinder') {
    const bent = c.axis === 'x' ? local.x : local.y
    const t = c.axis === 'x' ? local.y : local.x
    const theta = Math.atan2(bent, R - local.z)
    const s = theta * R
    const rho = Math.hypot(bent, R - local.z)
    const dist = rho - Math.abs(R)
    return c.axis === 'x' ? { u: s, v: t, dist } : { u: t, v: s, dist }
  }
  // dome
  const rhoSurf = Math.hypot(local.x, local.y)
  const theta = Math.atan2(rhoSurf, R - local.z)
  const rho = theta * R
  const radial = Math.hypot(rhoSurf, R - local.z)
  const dist = radial - Math.abs(R)
  if (rhoSurf < FLAT_EPS) return { u: 0, v: 0, dist }
  const back = rho / rhoSurf
  return { u: local.x * back, v: local.y * back, dist }
}

// --- Public surface API (Vec3 / SurfaceUV) ---

/** Surface (u,v) → world point on the curved plane. */
export function planeSurfaceToWorld(uv: SurfaceUV, plane: BuildPlane): Vec3 {
  return planeLocalToWorld(surfaceToLocal(uv, curvatureOf(plane)), plane)
}

/**
 * Surface (u,v) → plane-LOCAL (curvature-lifted) coords. Useful for building a
 * tessellated mesh as a child of a group that already carries the rigid frame
 * matrix (rendering), so the mesh need only express the curvature.
 */
export function planeSurfaceToLocal(uv: SurfaceUV, plane: { curvature?: PlaneCurvature }): Vec3 {
  return surfaceToLocal(uv, curvatureOf(plane))
}

/** World point → nearest surface (u,v) + signed distance off the surface. */
export function worldToPlaneSurface(p: Vec3, plane: BuildPlane): { u: number; v: number; dist: number } {
  return localToSurface(worldToPlaneLocal(p, plane), curvatureOf(plane))
}

/** Project a world point onto the surface and snap (u,v) to the grid. */
export function snapToSurface(p: Vec3, plane: BuildPlane): Vec3 {
  const { u, v } = worldToPlaneSurface(p, plane)
  const cell = plane.cellSize > FLAT_EPS ? plane.cellSize : 1
  return planeSurfaceToWorld(
    { u: Math.round(u / cell) * cell, v: Math.round(v / cell) * cell },
    plane,
  )
}

// --- Binding reconciliation ---

/**
 * When a plane moves / rotates / curves, every formation bound to it must have
 * its world `transform.position` recomputed from its stored surface (u,v).
 * Returns the new positions; callers write them through a store action so undo +
 * the eval mutation-version stay correct. Unbound formations are skipped.
 */
export function reconcileBoundFormations(
  plane: BuildPlane,
  formationNodes: FormationNode[],
): Array<{ nodeId: string; position: Vec3 }> {
  const out: Array<{ nodeId: string; position: Vec3 }> = []
  for (const node of formationNodes) {
    const binding = node.data.planeBinding
    if (!binding || binding.planeId !== plane.id) continue
    out.push({ nodeId: node.id, position: planeSurfaceToWorld({ u: binding.u, v: binding.v }, plane) })
  }
  return out
}
