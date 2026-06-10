// ============================================================================
// Tests for Show-Wide Physics Validator
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { ShowGraph, ShowEdge, FormationNodeData, LaunchNodeData, LandNodeData, TransitionConfig, Vec3 } from './types'
import type { Constraints } from '../stores/projectStore'
import { validateShowPhysics } from './physicsValidator'
import { computeTiming } from './timing'

// Ensure transitions are registered
import '../registries/transitions'
import { toTransitionConstraints } from '../registries/transitions'

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

function makeGrid(count: number, spacing: number, center: Vec3): Vec3[] {
  const cols = Math.ceil(Math.sqrt(count))
  const pts: Vec3[] = []
  for (let i = 0; i < count; i++) {
    pts.push({
      x: center.x + (i % cols - (cols - 1) / 2) * spacing,
      y: center.y,
      z: center.z + (Math.floor(i / cols) - (Math.ceil(count / cols) - 1) / 2) * spacing,
    })
  }
  return pts
}

function makeTransition(strategyId: string, preferredDuration: number, parameters: Record<string, unknown> = {}): TransitionConfig {
  return { strategyId, parameters, preferredDuration, pushPolicy: 'auto', locked: false }
}

function makeSimpleGraph(
  fromCenter: Vec3,
  toCenter: Vec3,
  droneCount: number,
  transitionDuration: number,
  strategyId: string,
): { graph: ShowGraph; formations: Map<string, Vec3[]> } {
  const fromPts = makeGrid(droneCount, 2, fromCenter)
  const toPts = makeGrid(droneCount, 2, toCenter)

  // formA starts at 2, runs 3 seconds → ends at 5. Transition gets `transitionDuration`.
  // formB starts at 5 + transitionDuration.
  const formAEnd = 5
  const formBStart = formAEnd + transitionDuration

  const launchToA: TransitionConfig = makeTransition('shortest-path', 2)
  const aToB: TransitionConfig = makeTransition(strategyId, transitionDuration, { laneCount: 2, arcHeight: 5, laneSpread: 8 })

  const graph: ShowGraph = {
    nodes: [
      {
        id: 'launch', type: 'launch', position: { x: 0, y: 0 },
        data: { droneCount, startTime: 0, staggerDelay: 0.01 } as LaunchNodeData,
        parentId: null,
      },
      {
        id: 'formA', type: 'formation', position: { x: 200, y: 0 },
        data: {
          formationId: 'fA', startTime: 2, duration: 3,
          transform: { position: fromCenter, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
          keyframes: [], colorProgramId: null, idleConfigs: [],
        } as FormationNodeData,
        parentId: null,
      },
      {
        id: 'formB', type: 'formation', position: { x: 400, y: 0 },
        data: {
          formationId: 'fB', startTime: formBStart, duration: 3,
          transform: { position: toCenter, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
          keyframes: [], colorProgramId: null, idleConfigs: [],
        } as FormationNodeData,
        parentId: null,
      },
      {
        id: 'land', type: 'land', position: { x: 500, y: 0 },
        data: { staggerDelay: 0.02 } as LandNodeData,
        parentId: null,
      },
    ],
    edges: [
      { id: 'e1', edgeType: 'flow', source: 'launch', sourcePort: 'flow-out', target: 'formA', targetPort: 'flow-in', droneCount, allocation: { mode: 'auto' }, transition: launchToA } as ShowEdge,
      { id: 'e2', edgeType: 'flow', source: 'formA', sourcePort: 'flow-out', target: 'formB', targetPort: 'flow-in', droneCount, allocation: { mode: 'auto' }, transition: aToB } as ShowEdge,
      { id: 'e3', edgeType: 'flow', source: 'formB', sourcePort: 'flow-out', target: 'land', targetPort: 'flow-in', droneCount, allocation: { mode: 'auto' }, transition: makeTransition('shortest-path', 2) } as ShowEdge,
    ],
  }

  const formations = new Map<string, Vec3[]>()
  formations.set('fA', fromPts)
  formations.set('fB', toPts)

  return { graph, formations }
}

describe('Physics Validator', () => {
  it('returns no violations for a well-spaced graph', () => {
    // Formations close together, plenty of transition time
    const { graph, formations } = makeSimpleGraph(
      { x: 0, y: 10, z: 0 },
      { x: 5, y: 10, z: 0 },
      10,
      10, // 10 seconds for a 5m transition — very generous
      'shortest-path',
    )

    const violations = validateShowPhysics(graph, defaultConstraints, formations)
    // Should have no violations on the formA→formB edge
    const e2Violations = violations.filter((v) => v.edgeId === 'e2')
    expect(e2Violations).toHaveLength(0)
  })

  it('engine auto-extends ant-walk with tight preferredDuration', () => {
    // Slice 1: under the new "smart auto-fit" model, the engine extends transition
    // durations to whatever physics demands. The test now asserts the engine emitted
    // a `duration-extended` warning rather than a validator violation.
    const { graph, formations } = makeSimpleGraph(
      { x: -30, y: 10, z: 0 },
      { x: 30, y: 10, z: 0 },
      20,
      1,
      'ant-walk',
    )
    const transConstraints = toTransitionConstraints(defaultConstraints)
    const result = computeTiming(graph, { formations, constraints: transConstraints, mode: 'cascade-push' })
    // Warning is attributed to the downstream node of the overloaded edge.
    const extension = result.warnings.find((w) => w.kind === 'duration-extended' && w.nodeId === 'formB')
    expect(extension).toBeDefined()
    expect((extension?.delta ?? 0)).toBeGreaterThan(0)
    // Validator sees zero transition-too-short violations because the engine extended.
    const violations = validateShowPhysics(graph, defaultConstraints, formations)
    const tooShort = violations.filter((v) => v.id.startsWith('trans-short-') && v.edgeId === 'e2')
    expect(tooShort).toHaveLength(0)
  })

  it('engine auto-extends shortest-path with tight preferredDuration', () => {
    const { graph, formations } = makeSimpleGraph(
      { x: -50, y: 10, z: 0 },
      { x: 50, y: 10, z: 0 },
      10,
      1,
      'shortest-path',
    )
    const transConstraints = toTransitionConstraints(defaultConstraints)
    const result = computeTiming(graph, { formations, constraints: transConstraints, mode: 'cascade-push' })
    const extension = result.warnings.find((w) => w.kind === 'duration-extended' && w.nodeId === 'formB')
    expect(extension).toBeDefined()
    expect((extension?.delta ?? 0)).toBeGreaterThan(0)
  })

  it('detects keyframe-too-fast', () => {
    // Formation with a keyframe that moves 100m in 1 second
    const graph: ShowGraph = {
      nodes: [
        {
          id: 'launch', type: 'launch', position: { x: 0, y: 0 },
          data: { droneCount: 10, startTime: 0, staggerDelay: 0.01 } as LaunchNodeData,
          parentId: null,
        },
        {
          id: 'formA', type: 'formation', position: { x: 200, y: 0 },
          data: {
            formationId: 'fA', startTime: 2, duration: 5,
            transform: {
              position: { x: 0, y: 10, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
            },
            keyframes: [
              {
                time: 1,
                transform: {
                  position: { x: 100, y: 10, z: 0 },
                  rotation: { x: 0, y: 0, z: 0 },
                  scale: { x: 1, y: 1, z: 1 },
                },
                easing: 'linear' as const,
              },
            ],
            colorProgramId: null,
            idleConfigs: [],
          } as FormationNodeData,
          parentId: null,
        },
      ],
      edges: [
        { id: 'e1', edgeType: 'flow', source: 'launch', sourcePort: 'flow-out', target: 'formA', targetPort: 'flow-in', droneCount: 10, allocation: { mode: 'auto' }, transition: makeTransition('shortest-path', 2) } as ShowEdge,
      ],
    }

    const formations = new Map<string, Vec3[]>()
    formations.set('fA', makeGrid(10, 2, { x: 0, y: 0, z: 0 }))

    const violations = validateShowPhysics(graph, defaultConstraints, formations)
    const kfViolations = violations.filter((v) => v.type === 'keyframe-too-fast')
    expect(kfViolations.length).toBeGreaterThan(0)
    expect(kfViolations[0]!.fix).not.toBeNull()
    expect(kfViolations[0]!.fix!.type).toBe('extend-formation')
  })

  it('violation fix has positive delta', () => {
    const { graph, formations } = makeSimpleGraph(
      { x: -30, y: 10, z: 0 },
      { x: 30, y: 10, z: 0 },
      20,
      1,
      'ant-walk',
    )

    const violations = validateShowPhysics(graph, defaultConstraints, formations)
    for (const v of violations) {
      if (v.fix) {
        expect(v.fix.delta).toBeGreaterThan(0)
      }
    }
  })

  it('returns empty for graph with no nodes', () => {
    const graph: ShowGraph = { nodes: [], edges: [] }
    const violations = validateShowPhysics(graph, defaultConstraints, new Map())
    expect(violations).toHaveLength(0)
  })
})
