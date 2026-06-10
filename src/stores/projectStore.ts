// ============================================================================
// Project Store — Project Metadata, Drone Pool, Constraints
// ============================================================================

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Vec3 } from '../graph/types'

export interface ProjectMeta {
  id: string
  name: string
  createdAt: string
  modifiedAt: string
}

export type LaunchLayout = 'grid' | 'line' | 'circle'

export interface DronePool {
  droneCount: number
  launchLayout: LaunchLayout
  spacing: number
  homePositions: Vec3[]
}

export interface Constraints {
  maxVelocity: number
  maxAcceleration: number
  minDroneDistance: number
  altitudeMin: number
  altitudeMax: number
  geofenceRadius: number
  maxFlightTime: number   // seconds — battery life limit
  windSpeed: number       // m/s — increases effective min distance
  // S15 additions
  maxJerk: number              // m/s^3 — rate of acceleration change
  maxAscentRate: number        // m/s — vertical ascent speed limit
  maxDescentRate: number       // m/s — vertical descent speed limit
  windGustFactor: number       // multiplier for peak gusts vs sustained
  safetyMarginVelocity: number // % headroom on velocity (0–1)
  safetyMarginSpacing: number  // additional meters on min distance
  batteryReserve: number       // % reserve to maintain (0–1)
  gpsAccuracy: number          // meters (1–3 standard, 0.02 RTK)
  geofencePolygon: Vec3[]      // 3D polygon boundary points (empty = use radius)
}

export interface ProjectStoreState {
  meta: ProjectMeta
  dronePool: DronePool
  constraints: Constraints

  setDroneCount: (n: number) => void
  setLaunchLayout: (layout: LaunchLayout) => void
  setSpacing: (spacing: number) => void
  updateMeta: (patch: Partial<ProjectMeta>) => void
  updateConstraints: (patch: Partial<Constraints>) => void
  loadProject: (meta: ProjectMeta, pool: DronePool, constraints: Constraints) => void
}

function generateHomePositions(count: number, layout: LaunchLayout, spacing: number): Vec3[] {
  const positions: Vec3[] = []

  switch (layout) {
    case 'grid': {
      const cols = Math.ceil(Math.sqrt(count))
      for (let i = 0; i < count; i++) {
        const col = i % cols
        const row = Math.floor(i / cols)
        positions.push({
          x: (col - (cols - 1) / 2) * spacing,
          y: 0,
          z: (row - (Math.ceil(count / cols) - 1) / 2) * spacing,
        })
      }
      break
    }
    case 'line': {
      for (let i = 0; i < count; i++) {
        positions.push({
          x: (i - (count - 1) / 2) * spacing,
          y: 0,
          z: 0,
        })
      }
      break
    }
    case 'circle': {
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2
        const radius = (count * spacing) / (Math.PI * 2)
        positions.push({
          x: Math.cos(angle) * radius,
          y: 0,
          z: Math.sin(angle) * radius,
        })
      }
      break
    }
  }

  return positions
}

const defaultMeta: ProjectMeta = {
  id: 'project-1',
  name: 'Untitled Show',
  createdAt: new Date().toISOString(),
  modifiedAt: new Date().toISOString(),
}

const defaultConstraints: Constraints = {
  maxVelocity: 8,
  maxAcceleration: 4,
  minDroneDistance: 1.5,
  altitudeMin: 0,
  altitudeMax: 120,
  geofenceRadius: 200,
  maxFlightTime: 1200, // 20 minutes
  windSpeed: 0,
  // S15 defaults
  maxJerk: 20,
  maxAscentRate: 4,
  maxDescentRate: 3,
  windGustFactor: 1.5,
  safetyMarginVelocity: 0.1,
  safetyMarginSpacing: 0.5,
  batteryReserve: 0.15,
  gpsAccuracy: 1.5,
  geofencePolygon: [],
}

export const useProjectStore = create<ProjectStoreState>()(
  immer((set) => ({
    meta: { ...defaultMeta },
    dronePool: {
      droneCount: 100,
      launchLayout: 'grid' as LaunchLayout,
      spacing: 2,
      homePositions: generateHomePositions(100, 'grid', 2),
    },
    constraints: { ...defaultConstraints },

    setDroneCount(n) {
      const clamped = Math.max(1, Math.min(10000, Math.round(n)))
      set((state) => {
        state.dronePool.droneCount = clamped
        state.dronePool.homePositions = generateHomePositions(
          n,
          state.dronePool.launchLayout,
          state.dronePool.spacing,
        )
      })
    },

    setLaunchLayout(layout) {
      set((state) => {
        state.dronePool.launchLayout = layout
        state.dronePool.homePositions = generateHomePositions(
          state.dronePool.droneCount,
          layout,
          state.dronePool.spacing,
        )
      })
    },

    setSpacing(spacing) {
      const clamped = Math.max(0.1, spacing)
      set((state) => {
        state.dronePool.spacing = clamped
        state.dronePool.homePositions = generateHomePositions(
          state.dronePool.droneCount,
          state.dronePool.launchLayout,
          spacing,
        )
      })
    },

    updateMeta(patch) {
      set((state) => {
        Object.assign(state.meta, patch)
        state.meta.modifiedAt = new Date().toISOString()
      })
    },

    updateConstraints(patch) {
      set((state) => {
        Object.assign(state.constraints, patch)
        // Enforce positive values
        if (state.constraints.maxVelocity <= 0) state.constraints.maxVelocity = 1
        if (state.constraints.maxAcceleration <= 0) state.constraints.maxAcceleration = 1
        if (state.constraints.minDroneDistance <= 0) state.constraints.minDroneDistance = 0.1
        if (state.constraints.altitudeMax <= state.constraints.altitudeMin) {
          state.constraints.altitudeMax = state.constraints.altitudeMin + 1
        }
        if (state.constraints.geofenceRadius <= 0) state.constraints.geofenceRadius = 1
      })
    },

    loadProject(meta, pool, constraints) {
      set((state) => {
        state.meta = meta
        state.dronePool = pool
        // Merge with defaults to handle projects saved before S15
        // (missing maxJerk, batteryReserve, etc.)
        state.constraints = { ...defaultConstraints, ...constraints }
      })
    },
  })),
)

// Mutation version — see graphStore.ts for context.
let _projectMutationVersion = 0
useProjectStore.subscribe(() => { _projectMutationVersion += 1 })
export function getProjectMutationVersion(): number {
  return _projectMutationVersion
}

// Export the generator for use in tests and other modules
export { generateHomePositions }
