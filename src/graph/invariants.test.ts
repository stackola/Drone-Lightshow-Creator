import { describe, it, expect } from 'vitest'
import { checkInvariants } from './invariants'
import {
  makeLinearDemoGraph,
  makeLaunchNode,
  makeFormationNode,
  makeFlowEdge,
} from './helpers.test-utils'

describe('G-01: checkInvariants', () => {
  it('returns empty for valid demo graph', () => {
    const graph = makeLinearDemoGraph()
    expect(checkInvariants(graph)).toEqual([])
  })

  it('detects duplicate node IDs', () => {
    const graph = {
      nodes: [
        makeLaunchNode({ id: 'dup' }),
        makeFormationNode({ id: 'dup' }),
      ],
      edges: [],
    }
    const violations = checkInvariants(graph)
    expect(violations.some((v) => v.includes('Duplicate node ID'))).toBe(true)
  })

  it('detects duplicate edge IDs', () => {
    const graph = {
      nodes: [
        makeLaunchNode({ id: 'a' }),
        makeFormationNode({ id: 'b' }),
        makeFormationNode({ id: 'c' }),
      ],
      edges: [
        makeFlowEdge('dup-edge', 'a', 'b'),
        makeFlowEdge('dup-edge', 'a', 'c'),
      ],
    }
    const violations = checkInvariants(graph)
    expect(violations.some((v) => v.includes('Duplicate edge ID'))).toBe(true)
  })

  it('detects edges referencing non-existent source', () => {
    const graph = {
      nodes: [makeFormationNode({ id: 'b' })],
      edges: [makeFlowEdge('e1', 'ghost', 'b')],
    }
    const violations = checkInvariants(graph)
    expect(violations.some((v) => v.includes('non-existent source'))).toBe(true)
  })

  it('detects edges referencing non-existent target', () => {
    const graph = {
      nodes: [makeLaunchNode({ id: 'a' })],
      edges: [makeFlowEdge('e1', 'a', 'ghost')],
    }
    const violations = checkInvariants(graph)
    expect(violations.some((v) => v.includes('non-existent target'))).toBe(true)
  })

  it('detects derived state in node data', () => {
    const graph = {
      nodes: [{
        id: 'n1',
        type: 'formation' as const,
        position: { x: 0, y: 0 },
        parentId: null,
        data: {
          formationId: null,
          startTime: 0,
          duration: 5,
          transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
          keyframes: [],
          colorProgramId: null,
          idleConfigs: [],
          resolvedTiming: { start: 0, end: 5 }, // VIOLATION — derived state
        } as any,
      }],
      edges: [],
    }
    const violations = checkInvariants(graph)
    expect(violations.some((v) => v.includes('resolvedTiming'))).toBe(true)
  })

  it('mutating position.x does NOT cause invariant violation', () => {
    const graph = makeLinearDemoGraph()
    // Deliberately set position.x to a wrong value
    graph.nodes[0]!.position.x = 99999
    // Invariants should still pass — position is layout only
    expect(checkInvariants(graph)).toEqual([])
  })

  it('adding a node does not change existing IDs', () => {
    const graph = makeLinearDemoGraph()
    const originalIds = graph.nodes.map((n) => n.id)
    // Add a new node
    graph.nodes.push(makeFormationNode({ id: 'new-node-999' }))
    // Original IDs unchanged
    const currentIds = graph.nodes.slice(0, originalIds.length).map((n) => n.id)
    expect(currentIds).toEqual(originalIds)
    expect(checkInvariants(graph)).toEqual([])
  })
})
