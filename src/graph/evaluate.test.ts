import { describe, it, expect } from 'vitest'
import { evaluateAtTime } from './evaluate'
import { computeFlow } from './flow'
import {
  makeLaunchNode,
  makeFormationNode,
  makeFlowEdge,
} from './helpers.test-utils'
import type { ShowGraph, Vec3 } from './types'

describe('S0-08: evaluateAtTime', () => {
  const homePositions: Vec3[] = Array.from({ length: 10 }, (_, i) => ({
    x: i * 2,
    y: 0,
    z: 0,
  }))

  const formations = new Map<string, Vec3[]>()
  formations.set('ring-1', Array.from({ length: 10 }, (_, i) => ({
    x: Math.cos((i / 10) * Math.PI * 2) * 10,
    y: 10,
    z: Math.sin((i / 10) * Math.PI * 2) * 10,
  })))

  it('returns home positions when no nodes are active', () => {
    const graph: ShowGraph = {
      nodes: [
        makeFormationNode({ id: 'f1', data: { formationId: 'ring-1', startTime: 10, duration: 5, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
      ],
      edges: [],
    }
    const states = evaluateAtTime(graph, formations, 0, homePositions)
    expect(states).toHaveLength(10)
    // All at home positions
    expect(states[0]!.position).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('returns formation points when formation is active', () => {
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch', data: { droneCount: 10, startTime: 0, staggerDelay: 0.01 } }),
        makeFormationNode({ id: 'f1', data: { formationId: 'ring-1', startTime: 1, duration: 5, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
      ],
      edges: [
        makeFlowEdge('e1', 'launch', 'f1'),
      ],
    }
    // Compute flow to resolve edge droneCount (mirrors real store behavior)
    const flowResult = computeFlow(graph)
    const resolvedGraph: ShowGraph = { nodes: graph.nodes, edges: flowResult.edges }
    // Launch ends at 10*0.01 + 2 = 2.1; default 2s transition pushes f1 from authored startTime=1 to 4.1.
    // Formation active from 4.1 to 9.1. Evaluate at t=5 to land inside the (pushed) active window.
    const states = evaluateAtTime(resolvedGraph, formations, 5, homePositions)
    expect(states).toHaveLength(10)
    // Formation points should be at ring positions (y=10)
    const formationStates = states.filter((s) => s.color.b === 1 && s.color.r === 0.3)
    expect(formationStates.length).toBeGreaterThan(0)
  })

  it('returns correct drone count', () => {
    const graph: ShowGraph = { nodes: [], edges: [] }
    const states = evaluateAtTime(graph, formations, 0, homePositions)
    expect(states).toHaveLength(10)
    expect(states[0]!.droneId).toBe(0)
    expect(states[9]!.droneId).toBe(9)
  })

  it('populates owners[] with the formation node id for active drones', () => {
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch', data: { droneCount: 10, startTime: 0, staggerDelay: 0.01 } }),
        makeFormationNode({ id: 'f1', data: { formationId: 'ring-1', startTime: 1, duration: 5, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
      ],
      edges: [makeFlowEdge('e1', 'launch', 'f1')],
    }
    const flowResult = computeFlow(graph)
    const resolvedGraph: ShowGraph = { nodes: graph.nodes, edges: flowResult.edges }
    const owners: (string | null)[] = new Array(10).fill(null)
    evaluateAtTime(resolvedGraph, formations, 5, homePositions, undefined, { owners })
    // Inside the formation's (pushed) active window every drone is owned by f1.
    expect(owners.every((o) => o === 'f1')).toBe(true)
  })

  it('leaves owners null before any formation is active', () => {
    const graph: ShowGraph = {
      nodes: [makeFormationNode({ id: 'f1', data: { formationId: 'ring-1', startTime: 10, duration: 5, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } })],
      edges: [],
    }
    const owners: (string | null)[] = new Array(10).fill(null)
    evaluateAtTime(graph, formations, 0, homePositions, undefined, { owners })
    expect(owners.every((o) => o === null)).toBe(true)
  })
})
