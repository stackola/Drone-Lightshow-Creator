// Physics validator — matches Blender lightshow_creator plugin constraints exactly
// Checks: horizontal velocity, vertical velocity (up/down), acceleration, min drone spacing

import type { Drone, PhysicsLimits, ValidationViolation } from '../stores/formationStore'

const FPS = 24

export function validate(drones: Drone[], limits: PhysicsLimits): ValidationViolation[] {
  const violations: ValidationViolation[] = []

  for (const drone of drones) {
    const kfs = drone.positionKeyframes
    if (kfs.length < 2) continue

    for (let i = 1; i < kfs.length; i++) {
      const prev = kfs[i - 1]!
      const curr = kfs[i]!
      const dt = (curr.frame - prev.frame) / FPS
      if (dt <= 0) continue

      const dx = curr.x - prev.x
      const dy = curr.y - prev.y
      const dz = curr.z - prev.z

      // Horizontal velocity (XY plane in ENU = ground plane)
      const hVel = Math.sqrt(dx * dx + dy * dy) / dt
      if (hVel > limits.maxHorizontalVelocity) {
        violations.push({ drone: drone.id, frame: curr.frame, type: 'horizontal_velocity', value: +hVel.toFixed(2), limit: limits.maxHorizontalVelocity })
      }

      // Vertical velocity
      const vVel = dz / dt
      if (vVel > 0 && vVel > limits.maxVerticalVelocityUp) {
        violations.push({ drone: drone.id, frame: curr.frame, type: 'vertical_velocity_up', value: +vVel.toFixed(2), limit: limits.maxVerticalVelocityUp })
      }
      if (vVel < 0 && Math.abs(vVel) > limits.maxVerticalVelocityDown) {
        violations.push({ drone: drone.id, frame: curr.frame, type: 'vertical_velocity_down', value: +Math.abs(vVel).toFixed(2), limit: limits.maxVerticalVelocityDown })
      }
    }

    // Acceleration
    if (kfs.length >= 3) {
      for (let i = 1; i < kfs.length - 1; i++) {
        const k0 = kfs[i - 1]!, k1 = kfs[i]!, k2 = kfs[i + 1]!
        const dt1 = (k1.frame - k0.frame) / FPS
        const dt2 = (k2.frame - k1.frame) / FPS
        if (dt1 <= 0 || dt2 <= 0) continue

        const d1 = Math.sqrt((k1.x - k0.x) ** 2 + (k1.y - k0.y) ** 2 + (k1.z - k0.z) ** 2)
        const d2 = Math.sqrt((k2.x - k1.x) ** 2 + (k2.y - k1.y) ** 2 + (k2.z - k1.z) ** 2)
        const v1 = d1 / dt1
        const v2 = d2 / dt2
        const accel = Math.abs(v2 - v1) / ((dt1 + dt2) / 2)

        if (accel > limits.maxAcceleration) {
          violations.push({ drone: drone.id, frame: k1.frame, type: 'acceleration', value: +accel.toFixed(2), limit: limits.maxAcceleration })
        }
      }
    }
  }

  // Min drone distance — check at each unique frame
  const frames = new Set<number>()
  for (const d of drones) for (const kf of d.positionKeyframes) frames.add(kf.frame)

  for (const frame of frames) {
    const positions: { id: number; x: number; y: number; z: number }[] = []
    for (const d of drones) {
      const pos = interpolateAt(d.positionKeyframes, frame)
      if (pos) positions.push({ id: d.id, ...pos })
    }

    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]!, b = positions[j]!
        const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
        if (dist < limits.minDroneDistance) {
          violations.push({ drone: a.id, frame, type: 'min_distance', value: +dist.toFixed(2), limit: limits.minDroneDistance, otherDrone: b.id })
        }
      }
    }
  }

  return violations
}

function interpolateAt(kfs: { frame: number; x: number; y: number; z: number }[], frame: number): { x: number; y: number; z: number } | null {
  if (kfs.length === 0) return null
  if (frame <= kfs[0]!.frame) return kfs[0]!
  if (frame >= kfs[kfs.length - 1]!.frame) return kfs[kfs.length - 1]!

  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]!, b = kfs[i + 1]!
    if (frame >= a.frame && frame <= b.frame) {
      const t = (frame - a.frame) / (b.frame - a.frame)
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }
    }
  }
  return kfs[kfs.length - 1]!
}

// Public interpolation for 3D preview
export function interpolateDroneAt(kfs: { frame: number; x: number; y: number; z: number }[], frame: number) {
  return interpolateAt(kfs, frame)
}

export function interpolateColorAt(kfs: { frame: number; r: number; g: number; b: number; w: number }[], frame: number): { r: number; g: number; b: number; w: number } {
  if (kfs.length === 0) return { r: 255, g: 255, b: 255, w: 0 }
  if (frame <= kfs[0]!.frame) return kfs[0]!
  if (frame >= kfs[kfs.length - 1]!.frame) return kfs[kfs.length - 1]!

  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]!, b = kfs[i + 1]!
    if (frame >= a.frame && frame <= b.frame) {
      const t = (frame - a.frame) / (b.frame - a.frame)
      return {
        r: Math.round(a.r + (b.r - a.r) * t),
        g: Math.round(a.g + (b.g - a.g) * t),
        b: Math.round(a.b + (b.b - a.b) * t),
        w: Math.round(a.w + (b.w - a.w) * t),
      }
    }
  }
  return kfs[kfs.length - 1]!
}
