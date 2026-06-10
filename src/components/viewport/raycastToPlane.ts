// ============================================================================
// raycastToPlane — shared screen-point → build-plane-surface raycast used by
// the drop controller and the 3D viewport context menu. Intersects the
// plane's flat rigid frame, then projects onto the (possibly curved) surface.
// ============================================================================

import * as THREE from 'three'
import { worldToPlaneSurface, planeSurfaceToWorld, type BuildPlane } from '../../graph/buildPlane'
import type { Vec3 } from '../../graph/types'

export interface PlaneHit {
  /** Point on the plane's (curved) surface in world space. */
  world: Vec3
  /** Surface coordinates — authoring intent for planeBinding. */
  u: number
  v: number
}

const _ndc = new THREE.Vector2()
const _normal = new THREE.Vector3()
const _origin = new THREE.Vector3()
const _hit = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _euler = new THREE.Euler()
const _plane = new THREE.Plane()

/** World-space outward normal of a plane's flat rigid frame. */
function planeNormal(plane: BuildPlane): THREE.Vector3 {
  _euler.set(
    (plane.rotationDeg.x * Math.PI) / 180,
    (plane.rotationDeg.y * Math.PI) / 180,
    (plane.rotationDeg.z * Math.PI) / 180,
    'XYZ',
  )
  _quat.setFromEuler(_euler)
  return _normal.set(0, 0, 1).applyQuaternion(_quat).normalize()
}

/**
 * Cast a ray from a client-space point through the camera onto a build
 * plane's surface. Returns null when the ray misses the plane's rigid frame.
 */
export function raycastClientToPlane(
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  domElement: HTMLCanvasElement,
  raycaster: THREE.Raycaster,
  plane: BuildPlane,
): PlaneHit | null {
  const rect = domElement.getBoundingClientRect()
  _ndc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  raycaster.setFromCamera(_ndc, camera)

  _origin.set(plane.position.x, plane.position.y, plane.position.z)
  _plane.setFromNormalAndCoplanarPoint(planeNormal(plane), _origin)
  if (!raycaster.ray.intersectPlane(_plane, _hit)) return null

  const { u, v } = worldToPlaneSurface({ x: _hit.x, y: _hit.y, z: _hit.z }, plane)
  const world = planeSurfaceToWorld({ u, v }, plane)
  return { world, u, v }
}
