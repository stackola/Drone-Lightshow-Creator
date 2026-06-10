import { describe, it, expect } from 'vitest'
import { computeAllTiming, computeTiming, getTotalDuration } from './timing'
import {
  makeLaunchNode,
  makeFormationNode,
  makeLandNode,
  makeFlowEdge,
  makeGroupNode,
} from './helpers.test-utils'
import type { ShowGraph } from './types'

describe('S0-06: timing', () => {
  it('linear chain timing: launch → formation → formation → land (transition on edge)', () => {
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch', data: { droneCount: 100, startTime: 0, staggerDelay: 0.02 } }),
        makeFormationNode({ id: 'f1', data: { formationId: null, startTime: 3, duration: 5, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
        makeFormationNode({ id: 'f2', data: { formationId: null, startTime: 10, duration: 5, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
        makeLandNode({ id: 'land' }),
      ],
      edges: [
        makeFlowEdge('e1', 'launch', 'f1'),
        makeFlowEdge('e2', 'f1', 'f2'),
        makeFlowEdge('e3', 'f2', 'land'),
      ],
    }
    const result = computeTiming(graph)

    // Launch: start=0, end=0 + 100*0.02 + 2.0 = 4.0 (riseDuration=max(1.5, 8/4)=2.0)
    expect(result.ranges.get('launch')).toEqual({ start: 0, end: 4 })
    // Edge launch→f1 has default 2s transition → window [4,6]. f1 authored at 3 is overrun, cascade-pushed to 6, end=11.
    expect(result.ranges.get('f1')).toEqual({ start: 6, end: 11 })
    // Edge f1→f2 transition: window [11, 13]. f2 authored at 10 → pushed to 13, end=18.
    expect(result.edgeRanges.get('e2')).toEqual({ start: 11, end: 13 })
    // Formation2: pushed to start=13, end=18
    expect(result.ranges.get('f2')).toEqual({ start: 13, end: 18 })
    // Edge f2→land window [18, 20]. Land starts at 20, end=20 + max(3, 0.02*100) = 23.
    expect(result.ranges.get('land')).toEqual({ start: 20, end: 23 })
  })

  it('parallel branches cascade-push when transition preferredDuration overruns a branch', () => {
    // launch ends at 4. Edge launch→f1 preferredDuration=2 → window [4, 6]. f1 authored at startTime=5 is overrun by 1s
    // and gets cascade-pushed to 6 (end 9). f2 authored at 7 is not overrun.
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch', data: { droneCount: 100, startTime: 0, staggerDelay: 0.02 } }),
        makeFormationNode({ id: 'f1', data: { formationId: null, startTime: 5, duration: 3, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
        makeFormationNode({ id: 'f2', data: { formationId: null, startTime: 7, duration: 4, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
      ],
      edges: [
        makeFlowEdge('e1', 'launch', 'f1'),
        makeFlowEdge('e2', 'launch', 'f2'),
      ],
    }
    const result = computeTiming(graph)
    expect(result.ranges.get('f1')).toEqual({ start: 6, end: 9 })
    expect(result.ranges.get('f2')).toEqual({ start: 7, end: 11 })
  })

  it('zero-preferredDuration transition collapses to start=end (downstream untouched)', () => {
    // With preferredDuration=0 and no constraints (no minRequired), transition is degenerate;
    // downstream formations honour their authored startTime.
    const transition = { strategyId: 'shortest-path' as const, parameters: {}, preferredDuration: 0, pushPolicy: 'auto' as const, locked: false }
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch', data: { droneCount: 100, startTime: 0, staggerDelay: 0.02 } }),
        makeFormationNode({ id: 'f1', data: { formationId: null, startTime: 6, duration: 3, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
        makeFormationNode({ id: 'f2', data: { formationId: null, startTime: 8, duration: 4, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
      ],
      edges: [
        makeFlowEdge('e1', 'launch', 'f1', { mode: 'auto' }, 'flow-out', 'flow-in', transition),
        makeFlowEdge('e2', 'launch', 'f2', { mode: 'auto' }, 'flow-out', 'flow-in', transition),
      ],
    }
    const result = computeTiming(graph)
    expect(result.edgeRanges.get('e1')).toEqual({ start: 4, end: 4 })
    expect(result.ranges.get('f1')).toEqual({ start: 6, end: 9 })
    expect(result.ranges.get('f2')).toEqual({ start: 8, end: 12 })
  })

  it('land after merge takes max of all upstream ends', () => {
    const graph: ShowGraph = {
      nodes: [
        makeFormationNode({ id: 'f1', data: { formationId: null, startTime: 3, duration: 5, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
        makeFormationNode({ id: 'f2', data: { formationId: null, startTime: 7, duration: 6, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
        makeLandNode({ id: 'land' }),
      ],
      edges: [
        makeFlowEdge('e1', 'f1', 'land'),
        makeFlowEdge('e2', 'f2', 'land'),
      ],
    }
    const timing = computeAllTiming(graph)
    // With default 2s transition on each edge, f1.end=8 + 2 = 10, f2.end=13 + 2 = 15. Land starts at 15.
    expect(timing.get('land')).toEqual({ start: 15, end: 18 })
  })

  it('group timing derived from children', () => {
    const graph: ShowGraph = {
      nodes: [
        makeFormationNode({ id: 'f1', parentId: 'g1', data: { formationId: null, startTime: 5, duration: 3, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
        makeFormationNode({ id: 'f2', parentId: 'g1', data: { formationId: null, startTime: 10, duration: 4, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
        makeGroupNode({ id: 'g1' }),
      ],
      edges: [],
    }
    const timing = computeAllTiming(graph)
    expect(timing.get('g1')).toEqual({ start: 5, end: 14 })
  })

  it('Slice 1 Step 5: emits cascade-push warning when downstream overrun', () => {
    const transition = { strategyId: 'shortest-path' as const, parameters: {}, preferredDuration: 5, pushPolicy: 'auto' as const, locked: false }
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch', data: { droneCount: 100, startTime: 0, staggerDelay: 0.02 } }),
        makeFormationNode({ id: 'f1', data: { formationId: null, startTime: 5, duration: 3, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
      ],
      edges: [makeFlowEdge('e1', 'launch', 'f1', { mode: 'auto' }, 'flow-out', 'flow-in', transition)],
    }
    const result = computeTiming(graph)
    // Edge needs 5s starting from launch.end=4 → [4,9]. f1 authored at 5 must push by 4s.
    expect(result.edgeRanges.get('e1')).toEqual({ start: 4, end: 9 })
    expect(result.ranges.get('f1')).toEqual({ start: 9, end: 12 })
    expect(result.warnings.some((w) => w.kind === 'cascade-push' && w.nodeId === 'f1')).toBe(true)
    expect(result.pushDeltas.get('f1')).toBeCloseTo(4)
  })

  it('Slice 1 Step 5: staggerLock blocks cascade-push and emits min-not-met warning', () => {
    const transition = { strategyId: 'shortest-path' as const, parameters: {}, preferredDuration: 5, pushPolicy: 'auto' as const, locked: false }
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch', data: { droneCount: 100, startTime: 0, staggerDelay: 0.02 } }),
        makeFormationNode({ id: 'f1', data: { formationId: null, startTime: 5, duration: 3, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [], staggerLock: true } }),
      ],
      edges: [makeFlowEdge('e1', 'launch', 'f1', { mode: 'auto' }, 'flow-out', 'flow-in', transition)],
    }
    const result = computeTiming(graph)
    expect(result.ranges.get('f1')).toEqual({ start: 5, end: 8 })
    expect(result.warnings.some((w) => w.kind === 'min-not-met' && w.nodeId === 'f1')).toBe(true)
    expect(result.pushDeltas.has('f1')).toBe(false)
  })

  it('Slice 1 Step 5: warn-only mode never pushes', () => {
    const transition = { strategyId: 'shortest-path' as const, parameters: {}, preferredDuration: 5, pushPolicy: 'auto' as const, locked: false }
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'launch', data: { droneCount: 100, startTime: 0, staggerDelay: 0.02 } }),
        makeFormationNode({ id: 'f1', data: { formationId: null, startTime: 5, duration: 3, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
      ],
      edges: [makeFlowEdge('e1', 'launch', 'f1', { mode: 'auto' }, 'flow-out', 'flow-in', transition)],
    }
    const result = computeTiming(graph, { mode: 'warn-only' })
    expect(result.ranges.get('f1')).toEqual({ start: 5, end: 8 })
    expect(result.warnings.some((w) => w.kind === 'min-not-met')).toBe(true)
  })

  it('getTotalDuration returns max end time', () => {
    const graph: ShowGraph = {
      nodes: [
        makeFormationNode({ id: 'f1', data: { formationId: null, startTime: 0, duration: 10, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
        makeFormationNode({ id: 'f2', data: { formationId: null, startTime: 5, duration: 20, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
      ],
      edges: [],
    }
    expect(getTotalDuration(graph)).toBe(25)
  })
})
