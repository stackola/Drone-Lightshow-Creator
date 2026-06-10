// ============================================================================
// Keyframe Transform Interpolation
// ============================================================================
// Given a base Transform3D, a sorted array of TransformKeyframes, and a local
// time (seconds into the formation's duration), returns the interpolated
// Transform3D at that instant.
//
// Design:
// - base transform acts as the implicit keyframe at localTime=0
// - keyframe.time values are offsets from formation start (0..duration)
// - Between two keyframes we lerp position, rotation, and scale
// - Easing is applied per-segment using the DESTINATION keyframe's easing
// - Before first keyframe → lerp from base; after last → hold last value
// ============================================================================

import type { Transform3D, TransformKeyframe, Vec3 } from './types'
import { applyEasing } from './easing'
import { v3lerp, v3lerpAngle } from './vec3'

// --- Transform lerp ---
// ARCHITECTURAL INVARIANT: Rotation convention is Euler XYZ intrinsic order.
// Rotation interpolation uses shortest-arc angle wrapping to avoid
// discontinuities at angle boundaries (e.g., 350° → 10° goes via 0°, not 180°).

function lerpTransform(a: Transform3D, b: Transform3D, t: number): Transform3D {
  return {
    position: v3lerp(a.position, b.position, t),
    rotation: v3lerpAngle(a.rotation, b.rotation, t),
    scale: v3lerp(a.scale, b.scale, t),
  }
}

/**
 * Interpolate a formation's transform at a given local time using keyframes.
 *
 * @param base - The formation's base transform (acts as keyframe at t=0)
 * @param keyframes - Sorted array of keyframes (time offsets from formation start)
 * @param localTime - Time in seconds since formation start (0 .. duration)
 * @returns Interpolated Transform3D
 */
export function interpolateTransform(
  base: Transform3D,
  keyframes: TransformKeyframe[],
  localTime: number,
): Transform3D {
  if (keyframes.length === 0) return base

  // Before first keyframe → lerp from base to first keyframe
  const first = keyframes[0]!
  if (localTime <= first.time) {
    if (first.time <= 0) return first.transform
    const segT = localTime / first.time
    const eased = applyEasing(Math.max(0, Math.min(1, segT)), first.easing, undefined, first.bezierConfig)
    return lerpTransform(base, first.transform, eased)
  }

  // After last keyframe → hold last value
  const last = keyframes[keyframes.length - 1]!
  if (localTime >= last.time) {
    return last.transform
  }

  // Between two keyframes → find the segment
  for (let i = 0; i < keyframes.length - 1; i++) {
    const kA = keyframes[i]!
    const kB = keyframes[i + 1]!
    if (localTime >= kA.time && localTime <= kB.time) {
      const segDuration = kB.time - kA.time
      const segT = segDuration > 0 ? (localTime - kA.time) / segDuration : 1
      const eased = applyEasing(Math.max(0, Math.min(1, segT)), kB.easing, undefined, kB.bezierConfig)
      return lerpTransform(kA.transform, kB.transform, eased)
    }
  }

  // Fallback (shouldn't reach here)
  return last.transform
}

/**
 * Apply an interpolated transform to a local-space point.
 * Applies scale (relative to origin — formation points are expected in local space),
 * then rotation (Euler XYZ intrinsic), then translation.
 *
 * For centroid-relative scaling, use applyTransformWithPivot.
 */
export function applyTransform(point: Vec3, transform: Transform3D): Vec3 {
  // Scale (relative to local origin — correct for centered formations)
  let x = point.x * transform.scale.x
  let y = point.y * transform.scale.y
  let z = point.z * transform.scale.z

  // Rotation (Euler XYZ in radians)
  const rx = transform.rotation.x
  const ry = transform.rotation.y
  const rz = transform.rotation.z

  // Rotate around X
  if (rx !== 0) {
    const cosX = Math.cos(rx)
    const sinX = Math.sin(rx)
    const y1 = y * cosX - z * sinX
    const z1 = y * sinX + z * cosX
    y = y1
    z = z1
  }

  // Rotate around Y
  if (ry !== 0) {
    const cosY = Math.cos(ry)
    const sinY = Math.sin(ry)
    const x1 = x * cosY + z * sinY
    const z1 = -x * sinY + z * cosY
    x = x1
    z = z1
  }

  // Rotate around Z
  if (rz !== 0) {
    const cosZ = Math.cos(rz)
    const sinZ = Math.sin(rz)
    const x1 = x * cosZ - y * sinZ
    const y1 = x * sinZ + y * cosZ
    x = x1
    y = y1
  }

  // Translate
  return {
    x: x + transform.position.x,
    y: y + transform.position.y,
    z: z + transform.position.z,
  }
}

/**
 * Apply transform with scale relative to a pivot point (e.g., formation centroid).
 * Use this when formation points are NOT centered at origin.
 */
export function applyTransformWithPivot(point: Vec3, transform: Transform3D, pivot: Vec3): Vec3 {
  // Offset from pivot, scale, then restore
  let x = (point.x - pivot.x) * transform.scale.x
  let y = (point.y - pivot.y) * transform.scale.y
  let z = (point.z - pivot.z) * transform.scale.z

  // Rotation (Euler XYZ intrinsic)
  const rx = transform.rotation.x
  const ry = transform.rotation.y
  const rz = transform.rotation.z

  if (rx !== 0) {
    const c = Math.cos(rx), s = Math.sin(rx)
    const y1 = y * c - z * s, z1 = y * s + z * c
    y = y1; z = z1
  }
  if (ry !== 0) {
    const c = Math.cos(ry), s = Math.sin(ry)
    const x1 = x * c + z * s, z1 = -x * s + z * c
    x = x1; z = z1
  }
  if (rz !== 0) {
    const c = Math.cos(rz), s = Math.sin(rz)
    const x1 = x * c - y * s, y1 = x * s + y * c
    x = x1; y = y1
  }

  return {
    x: x + transform.position.x,
    y: y + transform.position.y,
    z: z + transform.position.z,
  }
}
