// ============================================================================
// Audience placement geometry — resolves "where in 3D does this screen point
// land" from the single audience viewpoint. Depth is NEVER guessed: it comes
// from a surface (the active build plane, or a camera-facing ghost plane at a
// user-controlled depth). One mental model: screen point + surface = world.
// ============================================================================

import * as THREE from 'three'
import type { Camera } from 'three'
import { usePlanesStore } from '../../../stores/planesStore'
import { useAudienceEditStore } from '../../../stores/audienceEditStore'
import { worldToPlaneSurface, planeSurfaceToWorld, type BuildPlane } from '../../../graph/buildPlane'
import type { Vec3 } from '../../../graph/types'

const _euler = new THREE.Euler()
const _quat = new THREE.Quaternion()
const _normal = new THREE.Vector3()

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

export interface PlacementSurface {
  threePlane: THREE.Plane
  /** Present when placing onto a real build plane (for surface-snap + binding). */
  buildPlane?: BuildPlane
}

/**
 * The surface to raycast against right now. 'plane' surface → the active build
 * plane (depth from the plane). 'free' surface → a ghost plane perpendicular to
 * the camera at the configured depth (depth from one scalar the user controls).
 */
export function resolvePlacementSurface(camera: Camera): PlacementSurface {
  const { surface, placementDepth } = useAudienceEditStore.getState()
  const active = usePlanesStore.getState().getActivePlane()
  if (surface === 'plane' && active) {
    const origin = new THREE.Vector3(active.position.x, active.position.y, active.position.z)
    return { threePlane: new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal(active), origin), buildPlane: active }
  }
  // Ghost plane: camera-facing, at `placementDepth` along the view direction.
  const camDir = new THREE.Vector3()
  camera.getWorldDirection(camDir)
  const point = new THREE.Vector3().copy(camera.position).addScaledVector(camDir, placementDepth)
  return { threePlane: new THREE.Plane().setFromNormalAndCoplanarPoint(camDir.clone().negate(), point) }
}

/** Screen (NDC) ray → world hit on the resolved surface, projected onto any curve. */
export function screenToPlacementPoint(
  ndc: THREE.Vector2,
  camera: Camera,
  raycaster: THREE.Raycaster,
): { point: Vec3; binding?: { planeId: string; u: number; v: number } } | null {
  const surface = resolvePlacementSurface(camera)
  raycaster.setFromCamera(ndc, camera)
  const hit = new THREE.Vector3()
  if (!raycaster.ray.intersectPlane(surface.threePlane, hit)) return null
  if (surface.buildPlane) {
    const { u, v } = worldToPlaneSurface({ x: hit.x, y: hit.y, z: hit.z }, surface.buildPlane)
    const onSurface = planeSurfaceToWorld({ u, v }, surface.buildPlane)
    return { point: onSurface, binding: { planeId: surface.buildPlane.id, u, v } }
  }
  return { point: { x: hit.x, y: hit.y, z: hit.z } }
}
