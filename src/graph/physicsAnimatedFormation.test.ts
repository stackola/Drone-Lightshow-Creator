// S6-11: Physics validation tests for animated formations
import { describe, it, expect } from 'vitest'
import { validateShowPhysics } from './physicsValidator'
import { validateAnimatedFormation } from './animatedFormation'
import type { AnimatedFormationDef } from './animatedFormation'
import type { ShowGraph, Vec3 } from './types'
import type { Constraints } from '../stores/projectStore'
import { makeLaunchNode, makeFormationNode, makeLandNode, makeFlowEdge } from './helpers.test-utils'
import '../registries/init'
import '../registries/transitions'

const defaultConstraints: Constraints = {
  maxVelocity: 8,
  maxAcceleration: 4,
  minDroneDistance: 1.5,
  altitudeMin: 0,
  altitudeMax: 120,
  geofenceRadius: 200,
  maxFlightTime: 1200,
  windSpeed: 0,
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

describe('validateAnimatedFormation', () => {
  it('returns no issues for valid formation', () => {
    const def: AnimatedFormationDef = {
      duration: 4,
      droneCount: 5,
      tracks: Array.from({ length: 5 }, () => ({
        positionKeyframes: [{ time: 0, value: { x: 0, y: 0, z: 0 }, easing: 'linear' as const }],
        colorKeyframes: [],
      })),
      playback: { mode: 'clamp', speed: 1, trimIn: 0, trimOut: 0 },
    }
    expect(validateAnimatedFormation(def)).toEqual([])
  })

  it('flags trimIn + trimOut >= duration', () => {
    const def: AnimatedFormationDef = {
      duration: 4,
      droneCount: 5,
      tracks: Array.from({ length: 5 }, () => ({
        positionKeyframes: [{ time: 0, value: { x: 0, y: 0, z: 0 }, easing: 'linear' as const }],
        colorKeyframes: [],
      })),
      playback: { mode: 'clamp', speed: 1, trimIn: 2, trimOut: 3 },
    }
    const issues = validateAnimatedFormation(def)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0]).toContain('trimIn')
  })

  it('flags negative speed', () => {
    const def: AnimatedFormationDef = {
      duration: 4,
      droneCount: 5,
      tracks: Array.from({ length: 5 }, () => ({
        positionKeyframes: [{ time: 0, value: { x: 0, y: 0, z: 0 }, easing: 'linear' as const }],
        colorKeyframes: [],
      })),
      playback: { mode: 'clamp', speed: -1, trimIn: 0, trimOut: 0 },
    }
    const issues = validateAnimatedFormation(def)
    expect(issues.some((i) => i.includes('speed'))).toBe(true)
  })

  it('flags track count mismatch', () => {
    const def: AnimatedFormationDef = {
      duration: 4,
      droneCount: 10,
      tracks: Array.from({ length: 5 }, () => ({
        positionKeyframes: [{ time: 0, value: { x: 0, y: 0, z: 0 }, easing: 'linear' as const }],
        colorKeyframes: [],
      })),
      playback: { mode: 'clamp', speed: 1, trimIn: 0, trimOut: 0 },
    }
    const issues = validateAnimatedFormation(def)
    expect(issues.some((i) => i.includes('track count'))).toBe(true)
  })
})

describe('Physics validator — formation spacing', () => {
  it('detects formations with drones too close together', () => {
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch', data: { droneCount: 4, startTime: 0, staggerDelay: 0.02 } }),
        makeFormationNode({ id: 'form', data: {
          formationId: 'tight',
          startTime: 5, duration: 5,
          transform: { position: { x: 0, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
          keyframes: [], colorProgramId: null, idleConfigs: [],
        }}),
        makeLandNode({ id: 'land' }),
      ],
      edges: [
        makeFlowEdge('e1', 'launch', 'form'),
        makeFlowEdge('e2', 'form', 'land'),
      ],
    }

    // Points with 0.5m spacing — below the 1.5m limit
    const tightPoints: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
      { x: 0, y: 0, z: 0.5 },
      { x: 0.5, y: 0, z: 0.5 },
    ]
    const formations = new Map<string, Vec3[]>([['tight', tightPoints]])

    const violations = validateShowPhysics(graph, defaultConstraints, formations)
    const spacingViolation = violations.find((v) => v.id.startsWith('spacing-'))
    expect(spacingViolation).toBeDefined()
    expect(spacingViolation!.message).toContain('spacing')
  })

  it('passes for formations with adequate spacing', () => {
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch', data: { droneCount: 4, startTime: 0, staggerDelay: 0.02 } }),
        makeFormationNode({ id: 'form', data: {
          formationId: 'wide',
          startTime: 5, duration: 5,
          transform: { position: { x: 0, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
          keyframes: [], colorProgramId: null, idleConfigs: [],
        }}),
        makeLandNode({ id: 'land' }),
      ],
      edges: [
        makeFlowEdge('e1', 'launch', 'form'),
        makeFlowEdge('e2', 'form', 'land'),
      ],
    }

    const widePoints: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 6, y: 0, z: 0 },
      { x: 0, y: 0, z: 6 },
      { x: 6, y: 0, z: 6 },
    ]
    const formations = new Map<string, Vec3[]>([['wide', widePoints]])

    const violations = validateShowPhysics(graph, defaultConstraints, formations)
    const spacingViolation = violations.find((v) => v.id.startsWith('spacing-'))
    expect(spacingViolation).toBeUndefined()
  })
})

describe('Physics validator — altitude bounds', () => {
  it('flags formations above altitude max', () => {
    const graph: ShowGraph = {
      nodes: [
        makeFormationNode({ id: 'form', data: {
          formationId: 'high',
          startTime: 0, duration: 5,
          transform: { position: { x: 0, y: 130, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
          keyframes: [], colorProgramId: null, idleConfigs: [],
        }}),
      ],
      edges: [],
    }
    const pts: Vec3[] = [{ x: 0, y: 0, z: 0 }]
    const formations = new Map<string, Vec3[]>([['high', pts]])

    const violations = validateShowPhysics(graph, defaultConstraints, formations)
    expect(violations.some((v) => v.id.startsWith('alt-high'))).toBe(true)
  })
})

describe('Physics validator — flight time', () => {
  it('flags shows that exceed battery limit', () => {
    const shortBattery: Constraints = { ...defaultConstraints, maxFlightTime: 10 }
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch', data: { droneCount: 10, startTime: 0, staggerDelay: 0.02 } }),
        makeFormationNode({ id: 'form', data: {
          formationId: null, startTime: 5, duration: 20,
          transform: { position: { x: 0, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
          keyframes: [], colorProgramId: null, idleConfigs: [],
        }}),
      ],
      edges: [
        makeFlowEdge('e1', 'launch', 'form'),
      ],
    }
    const violations = validateShowPhysics(graph, shortBattery, new Map())
    expect(violations.some((v) => v.id === 'flight-time')).toBe(true)
  })
})
