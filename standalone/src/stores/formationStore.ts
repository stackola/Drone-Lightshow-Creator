// Formation Store — the entire app state
// A single animated formation: N drones with position + color keyframes over time.

import { create } from 'zustand'

export interface PositionKeyframe {
  frame: number  // at 24 FPS
  x: number      // meters, ENU: East
  y: number      // meters, ENU: North
  z: number      // meters, ENU: Up (altitude)
}

export interface ColorKeyframe {
  frame: number
  r: number  // 0-255
  g: number  // 0-255
  b: number  // 0-255
  w: number  // 0-255, separate white LED (additive with RGB)
}

export interface Drone {
  id: number
  positionKeyframes: PositionKeyframe[]
  colorKeyframes: ColorKeyframe[]
}

export interface PhysicsLimits {
  maxHorizontalVelocity: number  // m/s (default 3.5)
  maxVerticalVelocityUp: number  // m/s (default 3.5)
  maxVerticalVelocityDown: number // m/s (default 3.5)
  maxAcceleration: number         // m/s² (default 1.5)
  minDroneDistance: number         // meters (default 1.5)
}

export interface ValidationViolation {
  drone: number
  frame: number
  type: 'horizontal_velocity' | 'vertical_velocity_up' | 'vertical_velocity_down' | 'acceleration' | 'min_distance'
  value: number
  limit: number
  otherDrone?: number
}

export interface FormationState {
  name: string
  drones: Drone[]
  fps: 24
  physicsLimits: PhysicsLimits
  violations: ValidationViolation[]

  // Computed
  totalFrames: number
  durationSeconds: number

  // Actions
  setFormation: (name: string, drones: Drone[]) => void
  modifyDrones: (modifications: { droneIndex: number; positionKeyframes?: PositionKeyframe[]; colorKeyframes?: ColorKeyframe[] }[]) => void
  transformAll: (transform: { scaleXYZ?: number; rotateZDegrees?: number; translateX?: number; translateY?: number; translateZ?: number }) => void
  setPhysicsLimits: (limits: Partial<PhysicsLimits>) => void
  clear: () => void
}

const DEFAULT_PHYSICS: PhysicsLimits = {
  maxHorizontalVelocity: 3.5,
  maxVerticalVelocityUp: 3.5,
  maxVerticalVelocityDown: 3.5,
  maxAcceleration: 1.5,
  minDroneDistance: 1.5,
}

function computeTotalFrames(drones: Drone[]): number {
  let max = 0
  for (const d of drones) {
    for (const kf of d.positionKeyframes) if (kf.frame > max) max = kf.frame
    for (const kf of d.colorKeyframes) if (kf.frame > max) max = kf.frame
  }
  return max
}

export const useFormationStore = create<FormationState>()((set, get) => ({
  name: '',
  drones: [],
  fps: 24,
  physicsLimits: { ...DEFAULT_PHYSICS },
  violations: [],
  totalFrames: 0,
  durationSeconds: 0,

  setFormation(name, drones) {
    const totalFrames = computeTotalFrames(drones)
    set({
      name,
      drones,
      totalFrames,
      durationSeconds: totalFrames / 24,
      violations: [], // will be filled by validation
    })
  },

  modifyDrones(modifications) {
    const drones = [...get().drones]
    for (const mod of modifications) {
      if (mod.droneIndex >= 0 && mod.droneIndex < drones.length) {
        const d = { ...drones[mod.droneIndex]! }
        if (mod.positionKeyframes) d.positionKeyframes = mod.positionKeyframes
        if (mod.colorKeyframes) d.colorKeyframes = mod.colorKeyframes
        drones[mod.droneIndex] = d
      }
    }
    const totalFrames = computeTotalFrames(drones)
    set({ drones, totalFrames, durationSeconds: totalFrames / 24 })
  },

  transformAll(t) {
    const drones = get().drones.map((d) => {
      const posKfs = d.positionKeyframes.map((kf) => {
        let { x, y, z } = kf
        if (t.scaleXYZ != null) { x *= t.scaleXYZ; y *= t.scaleXYZ; z *= t.scaleXYZ }
        if (t.rotateZDegrees != null) {
          const rad = (t.rotateZDegrees * Math.PI) / 180
          const nx = x * Math.cos(rad) - y * Math.sin(rad)
          const ny = x * Math.sin(rad) + y * Math.cos(rad)
          x = nx; y = ny
        }
        if (t.translateX != null) x += t.translateX
        if (t.translateY != null) y += t.translateY
        if (t.translateZ != null) z += t.translateZ
        return { ...kf, x, y, z }
      })
      return { ...d, positionKeyframes: posKfs }
    })
    set({ drones })
  },

  setPhysicsLimits(limits) {
    set({ physicsLimits: { ...get().physicsLimits, ...limits } })
  },

  clear() {
    set({ name: '', drones: [], totalFrames: 0, durationSeconds: 0, violations: [] })
  },
}))
