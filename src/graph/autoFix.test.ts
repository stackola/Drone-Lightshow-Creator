import { describe, it, expect } from 'vitest'
import { getFixOptionsForViolation, computeFixAllPatches } from './autoFix'
import type { PhysicsViolation } from './physicsValidator'
import type { ShowGraph } from './types'
import type { Constraints } from '../stores/projectStore'
import {
  makeLaunchNode,
  makeFormationNode,
  makeLandNode,
  makeFlowEdge,
} from './helpers.test-utils'

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

const emptyFormations = new Map<string, { x: number; y: number; z: number }[]>()

function makeGraph(): ShowGraph {
  return {
    nodes: [
      makeLaunchNode({ id: 'launch' }),
      makeFormationNode({
        id: 'form-1',
        data: {
          formationId: 'ring-1',
          startTime: 5,
          duration: 5,
          transform: { position: { x: 0, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
          keyframes: [],
          colorProgramId: null,
          idleConfigs: [],
        },
      }),
      makeLandNode({ id: 'land' }),
    ],
    edges: [
      // Edge ID "e1" carries the transition between launch and form-1.
      makeFlowEdge('e1', 'launch', 'form-1'),
      makeFlowEdge('e2', 'form-1', 'land'),
    ],
  }
}

describe('getFixOptionsForViolation', () => {
  it('returns options for transition-too-short', () => {
    const violation: PhysicsViolation = {
      id: 'v1',
      type: 'transition-too-short',
      severity: 'error',
      nodeId: 'form-1',
      edgeId: 'e1',
      message: 'Transition too short',
      detail: 'Needs 1s more',
      fix: { type: 'extend-transition', nodeId: 'form-1', edgeId: 'e1', delta: 1, description: 'Extend by 1s' },
    }
    const graph = makeGraph()
    const options = getFixOptionsForViolation(violation, graph, defaultConstraints, emptyFormations)
    expect(options.length).toBeGreaterThanOrEqual(1)
    expect(options.some((o) => o.id === 'extend-transition')).toBe(true)
    expect(options.some((o) => o.id === 'change-strategy')).toBe(true)
  })

  it('returns options for keyframe-too-fast', () => {
    const violation: PhysicsViolation = {
      id: 'v2',
      type: 'keyframe-too-fast',
      severity: 'warning',
      nodeId: 'form-1',
      message: 'Keyframe too fast',
      detail: 'Exceeds velocity limit',
      fix: null,
    }
    const graph = makeGraph()
    const options = getFixOptionsForViolation(violation, graph, defaultConstraints, emptyFormations)
    expect(options.length).toBeGreaterThanOrEqual(1)
    expect(options.some((o) => o.id === 'extend-formation')).toBe(true)
    expect(options.some((o) => o.id === 'reduce-keyframes')).toBe(true)
  })

  it('returns default option for unknown types with fix', () => {
    const violation: PhysicsViolation = {
      id: 'v3',
      type: 'transition-too-short', // will fall into default if type were unknown
      severity: 'warning',
      nodeId: 'form-1',
      message: 'Some issue',
      detail: '',
      fix: { type: 'extend-transition', nodeId: 'form-1', edgeId: 'e1', delta: 0.5, description: 'Extend by 0.5s' },
    }
    // Force into default branch by using an unrecognized type
    const fakeViolation = { ...violation, type: 'some-unknown-type' } as unknown as PhysicsViolation
    const graph = makeGraph()
    const options = getFixOptionsForViolation(fakeViolation, graph, defaultConstraints, emptyFormations)
    expect(options.length).toBe(1)
    expect(options[0]!.id).toBe('extend-duration')
  })

  it('returns empty for unknown types without fix', () => {
    const fakeViolation = {
      id: 'v4',
      type: 'some-unknown-type',
      severity: 'warning',
      nodeId: 'form-1',
      message: 'No fix available',
      detail: '',
      fix: null,
    } as unknown as PhysicsViolation
    const graph = makeGraph()
    const options = getFixOptionsForViolation(fakeViolation, graph, defaultConstraints, emptyFormations)
    expect(options).toEqual([])
  })
})

describe('computeFixAllPatches', () => {
  it('sorts by timing order and returns patches', () => {
    const violations: PhysicsViolation[] = [
      {
        id: 'v1',
        type: 'transition-too-short',
        severity: 'error',
        nodeId: 'form-1',
        edgeId: 'e1',
        message: 'Too short',
        detail: '',
        fix: { type: 'extend-transition', nodeId: 'form-1', edgeId: 'e1', delta: 1, description: 'Extend' },
      },
    ]
    const graph = makeGraph()
    const patches = computeFixAllPatches(violations, graph, defaultConstraints, emptyFormations)
    // Should produce at least one patch addressed at the edge.
    expect(patches.length).toBeGreaterThanOrEqual(1)
    expect(patches[0]!.edgeId).toBe('e1')
  })
})
