// ============================================================================
// Tests for Time Push — Shift Downstream Nodes
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { ShowGraph, ShowEdge, FormationNodeData, LaunchNodeData, LandNodeData, TransitionConfig } from './types'
import { computePushDelta, collectDownstreamNodes, getDownstreamTimedNodes, computeTimePushPatches, computeExtendFormationPatches } from './timePush'

function transition(strategyId: string, preferredDuration: number): TransitionConfig {
  return { strategyId, parameters: {}, preferredDuration, pushPolicy: 'auto', locked: false }
}

function makeLinearGraph(): ShowGraph {
  // Launch(t=0) → FormA(t=5,d=3) → FormB(t=10,d=4) → Land
  // Each flow edge carries a transition config (default shortest-path · 2s).
  return {
    nodes: [
      { id: 'launch', type: 'launch', position: { x: 0, y: 0 }, data: { droneCount: 10, startTime: 0, staggerDelay: 0.01 } as LaunchNodeData, parentId: null },
      { id: 'formA', type: 'formation', position: { x: 200, y: 0 }, data: { formationId: null, startTime: 5, duration: 3, transform: { position: { x: 0, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } as FormationNodeData, parentId: null },
      { id: 'formB', type: 'formation', position: { x: 400, y: 0 }, data: { formationId: null, startTime: 10, duration: 4, transform: { position: { x: 0, y: 15, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } as FormationNodeData, parentId: null },
      { id: 'land', type: 'land', position: { x: 600, y: 0 }, data: { staggerDelay: 0.02 } as LandNodeData, parentId: null },
    ],
    edges: [
      { id: 'e1', edgeType: 'flow', source: 'launch', sourcePort: 'flow-out', target: 'formA', targetPort: 'flow-in', droneCount: 10, allocation: { mode: 'auto' }, transition: transition('shortest-path', 2) } as ShowEdge,
      { id: 'e2', edgeType: 'flow', source: 'formA', sourcePort: 'flow-out', target: 'formB', targetPort: 'flow-in', droneCount: 10, allocation: { mode: 'auto' }, transition: transition('ant-walk', 2) } as ShowEdge,
      { id: 'e3', edgeType: 'flow', source: 'formB', sourcePort: 'flow-out', target: 'land', targetPort: 'flow-in', droneCount: 10, allocation: { mode: 'auto' }, transition: transition('shortest-path', 2) } as ShowEdge,
    ],
  }
}

describe('collectDownstreamNodes', () => {
  it('collects all nodes downstream of formA (excluding start)', () => {
    const graph = makeLinearGraph()
    const downstream = collectDownstreamNodes(graph, 'formA', false)
    expect(downstream).toContain('formB')
    expect(downstream).toContain('land')
    expect(downstream).not.toContain('formA')
    expect(downstream).not.toContain('launch')
  })

  it('collects including start when includeStart=true', () => {
    const graph = makeLinearGraph()
    const downstream = collectDownstreamNodes(graph, 'formA', true)
    expect(downstream).toContain('formA')
    expect(downstream).toContain('formB')
  })

  it('returns empty for terminal node', () => {
    const graph = makeLinearGraph()
    const downstream = collectDownstreamNodes(graph, 'land', false)
    expect(downstream).toHaveLength(0)
  })
})

describe('getDownstreamTimedNodes', () => {
  it('returns only timed nodes downstream of formA', () => {
    const graph = makeLinearGraph()
    const timed = getDownstreamTimedNodes(graph, 'formA')
    // formB is the only timed node downstream of formA (land has no startTime)
    expect(timed).toHaveLength(1)
    expect(timed[0]!.nodeId).toBe('formB')
    expect(timed[0]!.currentStartTime).toBe(10)
  })

  it('returns multiple nodes for earlier nodes', () => {
    const graph = makeLinearGraph()
    const timed = getDownstreamTimedNodes(graph, 'launch')
    // formA and formB are downstream
    const nodeIds = timed.map((t) => t.nodeId)
    expect(nodeIds).toContain('formA')
    expect(nodeIds).toContain('formB')
  })
})

describe('computePushDelta', () => {
  it('returns 0 when current duration is sufficient', () => {
    const graph = makeLinearGraph()
    // formA end = 5+3 = 8. formA→formB edge ends at formB.start=10 → current edge window = 2s.
    // Using formA as the "transition" node, computePushDelta compares its own range duration (3s)
    // against requiredDuration. 1.5 < 3 → no push needed.
    const delta = computePushDelta(graph, 'formA', 1.5)
    expect(delta).toBe(0)
  })

  it('returns positive delta when more time needed', () => {
    const graph = makeLinearGraph()
    // formA range = 3s, request 6s → delta = 3s
    const delta = computePushDelta(graph, 'formA', 6)
    expect(delta).toBeCloseTo(3, 1)
  })
})

describe('computeTimePushPatches', () => {
  it('returns empty for zero delta', () => {
    const graph = makeLinearGraph()
    const patches = computeTimePushPatches(graph, 'formA', 0)
    expect(patches).toHaveLength(0)
  })

  it('shifts downstream formation startTime by delta', () => {
    const graph = makeLinearGraph()
    const patches = computeTimePushPatches(graph, 'formA', 3)
    expect(patches.length).toBeGreaterThan(0)
    const formBPatch = patches.find((p) => p.nodeId === 'formB')
    expect(formBPatch).toBeDefined()
    expect(formBPatch!.patch.startTime).toBeCloseTo(13, 1) // 10 + 3
  })

  it('does not shift upstream nodes', () => {
    const graph = makeLinearGraph()
    const patches = computeTimePushPatches(graph, 'formB', 3)
    const formAPatch = patches.find((p) => p.nodeId === 'formA')
    expect(formAPatch).toBeUndefined()
  })
})

describe('computeExtendFormationPatches', () => {
  it('extends formation duration and pushes downstream', () => {
    const graph = makeLinearGraph()
    const patches = computeExtendFormationPatches(graph, 'formA', 2)

    // Should extend formA duration: 3 → 5
    const formAPatch = patches.find((p) => p.nodeId === 'formA')
    expect(formAPatch).toBeDefined()
    expect(formAPatch!.patch['duration']).toBeCloseTo(5, 1)

    // Should push formB startTime: 10 → 12
    const formBPatch = patches.find((p) => p.nodeId === 'formB')
    expect(formBPatch).toBeDefined()
    expect(formBPatch!.patch['startTime']).toBeCloseTo(12, 1)
  })

  it('returns empty for zero delta', () => {
    const graph = makeLinearGraph()
    expect(computeExtendFormationPatches(graph, 'formA', 0)).toHaveLength(0)
  })

  it('returns empty for non-formation node', () => {
    const graph = makeLinearGraph()
    expect(computeExtendFormationPatches(graph, 'launch', 2)).toHaveLength(0)
  })
})
