import { describe, it, expect } from 'vitest'
import { computeFlow } from './flow'
import {
  makeLaunchNode,
  makeFormationNode,
  makeLandNode,
  makeIdleNode,
  makeFlowEdge,
} from './helpers.test-utils'
import type { ShowGraph, FormationNodeData } from './types'

describe('S0-05: computeFlow', () => {
  it('single pass-through: launch(100) → formation → land', () => {
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch' }),
        makeFormationNode({ id: 'form' }),
        makeLandNode({ id: 'land' }),
      ],
      edges: [
        makeFlowEdge('e1', 'launch', 'form'),
        makeFlowEdge('e2', 'form', 'land'),
      ],
    }
    const result = computeFlow(graph)
    const e1 = result.edges.find((e) => e.id === 'e1')
    const e2 = result.edges.find((e) => e.id === 'e2')
    expect(e1?.droneCount).toBe(100)
    expect(e2?.droneCount).toBe(100)
  })

  it('even split: launch(100) → 2 formations (auto)', () => {
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch' }),
        makeFormationNode({ id: 'f1' }),
        makeFormationNode({ id: 'f2' }),
      ],
      edges: [
        makeFlowEdge('e1', 'launch', 'f1'),
        makeFlowEdge('e2', 'launch', 'f2'),
      ],
    }
    const result = computeFlow(graph)
    const e1 = result.edges.find((e) => e.id === 'e1')
    const e2 = result.edges.find((e) => e.id === 'e2')
    expect(e1?.droneCount).toBe(50)
    expect(e2?.droneCount).toBe(50)
  })

  it('manual-count override: launch(100) → 30 manual + auto remainder', () => {
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch' }),
        makeFormationNode({ id: 'f1' }),
        makeFormationNode({ id: 'f2' }),
      ],
      edges: [
        makeFlowEdge('e1', 'launch', 'f1', { mode: 'manual-count', count: 30 }),
        makeFlowEdge('e2', 'launch', 'f2'),
      ],
    }
    const result = computeFlow(graph)
    const e1 = result.edges.find((e) => e.id === 'e1')
    const e2 = result.edges.find((e) => e.id === 'e2')
    expect(e1?.droneCount).toBe(30)
    expect(e2?.droneCount).toBe(70)
  })

  it('manual-percent: launch(100) → 40% manual + auto remainder', () => {
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch' }),
        makeFormationNode({ id: 'f1' }),
        makeFormationNode({ id: 'f2' }),
      ],
      edges: [
        makeFlowEdge('e1', 'launch', 'f1', { mode: 'manual-percent', percent: 40 }),
        makeFlowEdge('e2', 'launch', 'f2'),
      ],
    }
    const result = computeFlow(graph)
    const e1 = result.edges.find((e) => e.id === 'e1')
    const e2 = result.edges.find((e) => e.id === 'e2')
    expect(e1?.droneCount).toBe(40)
    expect(e2?.droneCount).toBe(60)
  })

  it('merge: 2 formations → shared formation (additive)', () => {
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'l1', data: { droneCount: 50, startTime: 0, staggerDelay: 0.02 } }),
        makeLaunchNode({ id: 'l2', data: { droneCount: 50, startTime: 0, staggerDelay: 0.02 } }),
        makeFormationNode({ id: 'f1' }),
        makeFormationNode({ id: 'f2' }),
        makeFormationNode({ id: 'merged' }),
      ],
      edges: [
        makeFlowEdge('e1', 'l1', 'f1'),
        makeFlowEdge('e2', 'l2', 'f2'),
        makeFlowEdge('e3', 'f1', 'merged'),
        makeFlowEdge('e4', 'f2', 'merged'),
      ],
    }
    const result = computeFlow(graph)
    const e3 = result.edges.find((e) => e.id === 'e3')
    const e4 = result.edges.find((e) => e.id === 'e4')
    expect(e3?.droneCount).toBe(50)
    expect(e4?.droneCount).toBe(50)
  })

  it('over-allocation generates error diagnostic', () => {
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch', data: { droneCount: 50, startTime: 0, staggerDelay: 0.02 } }),
        makeFormationNode({ id: 'f1' }),
        makeFormationNode({ id: 'f2' }),
      ],
      edges: [
        makeFlowEdge('e1', 'launch', 'f1', { mode: 'manual-count', count: 30 }),
        makeFlowEdge('e2', 'launch', 'f2', { mode: 'manual-count', count: 30 }),
      ],
    }
    const result = computeFlow(graph)
    const errors = result.diagnostics.filter((d) => d.severity === 'error')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors.some((e) => e.message.includes('exceeds'))).toBe(true)
  })

  it('complex diamond: launch → 2 formations → merge formation → land', () => {
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch' }),
        makeFormationNode({ id: 'f1' }),
        makeFormationNode({ id: 'f2' }),
        makeFormationNode({ id: 'merged' }),
        makeLandNode({ id: 'land' }),
      ],
      edges: [
        makeFlowEdge('e1', 'launch', 'f1'),
        makeFlowEdge('e2', 'launch', 'f2'),
        makeFlowEdge('e3', 'f1', 'merged'),
        makeFlowEdge('e4', 'f2', 'merged'),
        makeFlowEdge('e5', 'merged', 'land'),
      ],
    }
    const result = computeFlow(graph)
    expect(result.edges.find((e) => e.id === 'e1')?.droneCount).toBe(50)
    expect(result.edges.find((e) => e.id === 'e2')?.droneCount).toBe(50)
    expect(result.edges.find((e) => e.id === 'e3')?.droneCount).toBe(50)
    expect(result.edges.find((e) => e.id === 'e4')?.droneCount).toBe(50)
    expect(result.edges.find((e) => e.id === 'e5')?.droneCount).toBe(100)
  })

  it('attached idle does NOT reduce outgoing flow (idle absorbs leftovers during eval)', () => {
    const formData: FormationNodeData = {
      formationId: 'ring-1',
      startTime: 3,
      duration: 5,
      transform: { position: { x: 0, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [],
      colorProgramId: null,
      idleConfigs: [
        { id: 'idle-1', behavior: 'hover', radius: 5, speed: 1, altitude: 10, colorProgramId: null },
      ],
    }
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch' }),
        makeFormationNode({ id: 'form', data: formData }),
        makeLandNode({ id: 'land' }),
      ],
      edges: [
        makeFlowEdge('e1', 'launch', 'form'),
        makeFlowEdge('e2', 'form', 'land'),
      ],
    }
    const result = computeFlow(graph)
    expect(result.edges.find((e) => e.id === 'e1')?.droneCount).toBe(100)
    // All 100 pass through — idle absorbs leftovers at evaluation time
    expect(result.edges.find((e) => e.id === 'e2')?.droneCount).toBe(100)
  })

  it('standalone idle is independent sink', () => {
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch' }),
        makeFormationNode({ id: 'form' }),
        makeIdleNode({ id: 'idle' }),
      ],
      edges: [
        makeFlowEdge('e1', 'launch', 'form'),
        makeFlowEdge('e2', 'form', 'idle'),
      ],
    }
    const result = computeFlow(graph)
    expect(result.edges.find((e) => e.id === 'e1')?.droneCount).toBe(100)
    expect(result.edges.find((e) => e.id === 'e2')?.droneCount).toBe(100)
  })

  it('three-way auto split divides evenly', () => {
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch', data: { droneCount: 99, startTime: 0, staggerDelay: 0.02 } }),
        makeFormationNode({ id: 'f1' }),
        makeFormationNode({ id: 'f2' }),
        makeFormationNode({ id: 'f3' }),
      ],
      edges: [
        makeFlowEdge('e1', 'launch', 'f1'),
        makeFlowEdge('e2', 'launch', 'f2'),
        makeFlowEdge('e3', 'launch', 'f3'),
      ],
    }
    const result = computeFlow(graph)
    const counts = ['e1', 'e2', 'e3'].map((id) => result.edges.find((e) => e.id === id)?.droneCount ?? 0)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(99)
    expect(counts.every((c) => c === 33)).toBe(true)
  })
})
