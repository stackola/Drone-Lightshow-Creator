import { describe, it, expect, beforeEach } from 'vitest'
import { useGraphStore } from '../stores/graphStore'
import { wireNodeIntoFlow } from './autoWire'
import type { LaunchNodeData, FormationNodeData, LandNodeData } from './types'

function resetStore() {
  useGraphStore.setState({ nodes: [], edges: [] })
}

function addLaunch(startTime = 0): string {
  return useGraphStore.getState().addNode('launch', { x: 0, y: 0 }, {
    droneCount: 50, startTime, staggerDelay: 0.02,
  } as LaunchNodeData)
}

function addFormation(startTime: number): string {
  return useGraphStore.getState().addNode('formation', { x: startTime * 100, y: 0 }, {
    formationId: null, startTime, duration: 5,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    keyframes: [], colorProgramId: null, idleConfigs: [],
  } as FormationNodeData)
}

function addLand(startTime: number): string {
  return useGraphStore.getState().addNode('land', { x: startTime * 100, y: 0 }, {
    staggerDelay: 0.02, startTime,
  } as unknown as LandNodeData)
}

function flowEdges() {
  return useGraphStore.getState().edges.filter((e) => e.edgeType === 'flow')
}

describe('autoWire.wireNodeIntoFlow', () => {
  beforeEach(resetStore)

  it('wires a dropped formation to the preceding launch', () => {
    const launch = addLaunch(0)
    const f = addFormation(5)
    const edgeId = wireNodeIntoFlow(f)
    expect(edgeId).toBeTruthy()
    const edge = flowEdges().find((e) => e.id === edgeId)!
    expect(edge.source).toBe(launch)
    expect(edge.target).toBe(f)
    expect(edge.transition?.strategyId).toBe('shortest-path')
  })

  it('prefers the tail of the show over an already-connected predecessor', () => {
    const launch = addLaunch(0)
    const f1 = addFormation(5)
    useGraphStore.getState().addEdge(launch, 'flow-out', f1, 'flow-in', 'flow')
    const f2 = addFormation(15)
    const edgeId = wireNodeIntoFlow(f2)
    expect(edgeId).toBeTruthy()
    const edge = flowEdges().find((e) => e.id === edgeId)!
    // f1 is the tail (no outgoing flow edge) and precedes f2 → extend, don't fork.
    expect(edge.source).toBe(f1)
    expect(edge.target).toBe(f2)
  })

  it('is a no-op for a node already wired into the flow', () => {
    const launch = addLaunch(0)
    const f = addFormation(5)
    useGraphStore.getState().addEdge(launch, 'flow-out', f, 'flow-in', 'flow')
    const before = flowEdges().length
    expect(wireNodeIntoFlow(f)).toBeNull()
    expect(flowEdges().length).toBe(before)
  })

  it('returns null when no temporally preceding candidate exists', () => {
    addFormation(20) // only other node starts later
    const early = addFormation(1)
    // Sole earlier-or-equal candidate is the node itself; the later formation is filtered out.
    expect(wireNodeIntoFlow(early)).toBeNull()
  })

  it('wires a land node from the last formation', () => {
    const launch = addLaunch(0)
    const f = addFormation(5)
    useGraphStore.getState().addEdge(launch, 'flow-out', f, 'flow-in', 'flow')
    const land = addLand(20)
    const edgeId = wireNodeIntoFlow(land)
    expect(edgeId).toBeTruthy()
    const edge = flowEdges().find((e) => e.id === edgeId)!
    expect(edge.source).toBe(f)
    expect(edge.target).toBe(land)
  })

  it('wires a new launch to the orphaned head of the show', () => {
    const f = addFormation(5)
    const launch = addLaunch(0)
    const edgeId = wireNodeIntoFlow(launch)
    expect(edgeId).toBeTruthy()
    const edge = flowEdges().find((e) => e.id === edgeId)!
    expect(edge.source).toBe(launch)
    expect(edge.target).toBe(f)
  })

  it('launch wiring is a no-op when every flow-in node already has a predecessor', () => {
    const l1 = addLaunch(0)
    const f = addFormation(5)
    useGraphStore.getState().addEdge(l1, 'flow-out', f, 'flow-in', 'flow')
    const l2 = addLaunch(0)
    expect(wireNodeIntoFlow(l2)).toBeNull()
  })

  it('never wires from a land node (no flow-out port)', () => {
    const launch = addLaunch(0)
    const f1 = addFormation(5)
    const land = addLand(10)
    useGraphStore.getState().addEdge(launch, 'flow-out', f1, 'flow-in', 'flow')
    useGraphStore.getState().addEdge(f1, 'flow-out', land, 'flow-in', 'flow')
    const f2 = addFormation(30)
    const edgeId = wireNodeIntoFlow(f2)
    expect(edgeId).toBeTruthy()
    const edge = flowEdges().find((e) => e.id === edgeId)!
    expect(edge.source).not.toBe(land)
  })
})
