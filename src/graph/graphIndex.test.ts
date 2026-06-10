import { describe, it, expect } from 'vitest'
import { buildGraphIndex } from './graphIndex'
import {
  makeLaunchNode, makeFormationNode, makeIdleNode, makeLandNode,
  makeFlowEdge, makeAttachmentEdge,
} from './helpers.test-utils'
import type { ShowGraph } from './types'

describe('buildGraphIndex', () => {
  it('indexes nodes + edges by id and exposes the original graph', () => {
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'L' }),
        makeFormationNode({ id: 'A' }),
      ],
      edges: [makeFlowEdge('e0', 'L', 'A')],
    }
    const idx = buildGraphIndex(graph)
    expect(idx.graph).toBe(graph)
    expect(idx.nodeById.get('L')?.type).toBe('launch')
    expect(idx.nodeById.get('A')?.type).toBe('formation')
    expect(idx.edgeById.get('e0')).toBeDefined()
    expect(idx.edgeById.size).toBe(1)
  })

  it('initialises empty arrays for nodes with no edges', () => {
    const graph: ShowGraph = {
      nodes: [makeLaunchNode({ id: 'orphan' })],
      edges: [],
    }
    const idx = buildGraphIndex(graph)
    expect(idx.outEdges.get('orphan')).toEqual([])
    expect(idx.inEdges.get('orphan')).toEqual([])
    expect(idx.flowAdjacency.get('orphan')).toEqual([])
    expect(idx.flowReverseAdjacency.get('orphan')).toEqual([])
  })

  it('separates flow edges from attachment edges in flow* lookups', () => {
    const graph: ShowGraph = {
      nodes: [
        makeFormationNode({ id: 'F' }),
        makeIdleNode({ id: 'I' }),
        makeFormationNode({ id: 'F2' }),
      ],
      edges: [
        makeFlowEdge('flow-edge', 'F', 'F2'),
        makeAttachmentEdge('attach-edge', 'F', 'I'),
      ],
    }
    const idx = buildGraphIndex(graph)
    // Generic outEdges includes both edge types.
    expect(idx.outEdges.get('F')?.length).toBe(2)
    // flowOutEdges only counts flow.
    expect(idx.flowOutEdges.get('F')?.length).toBe(1)
    expect(idx.flowOutEdges.get('F')?.[0]?.id).toBe('flow-edge')
    // Attachment edges never make it into flowAdjacency.
    expect(idx.flowAdjacency.get('F')).toEqual(['F2'])
    expect(idx.flowReverseAdjacency.get('I')).toEqual([])
  })

  it('fan-out: one source flowing to two targets', () => {
    const graph: ShowGraph = {
      nodes: [
        makeFormationNode({ id: 'src' }),
        makeFormationNode({ id: 'a' }),
        makeFormationNode({ id: 'b' }),
      ],
      edges: [
        makeFlowEdge('e1', 'src', 'a'),
        makeFlowEdge('e2', 'src', 'b'),
      ],
    }
    const idx = buildGraphIndex(graph)
    expect(idx.flowAdjacency.get('src')).toEqual(['a', 'b'])
    expect(idx.flowReverseAdjacency.get('a')).toEqual(['src'])
    expect(idx.flowReverseAdjacency.get('b')).toEqual(['src'])
  })

  it('fan-in: two sources flowing into one target', () => {
    const graph: ShowGraph = {
      nodes: [
        makeFormationNode({ id: 'a' }),
        makeFormationNode({ id: 'b' }),
        makeFormationNode({ id: 'sink' }),
      ],
      edges: [
        makeFlowEdge('e1', 'a', 'sink'),
        makeFlowEdge('e2', 'b', 'sink'),
      ],
    }
    const idx = buildGraphIndex(graph)
    expect(idx.flowReverseAdjacency.get('sink')).toEqual(['a', 'b'])
    expect(idx.flowInEdges.get('sink')?.length).toBe(2)
  })

  it('linear chain Launch → Formation → Formation → Land', () => {
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'L' }),
        makeFormationNode({ id: 'F1' }),
        makeFormationNode({ id: 'F2' }),
        makeLandNode({ id: 'Land' }),
      ],
      edges: [
        makeFlowEdge('e1', 'L', 'F1'),
        makeFlowEdge('e2', 'F1', 'F2'),
        makeFlowEdge('e3', 'F2', 'Land'),
      ],
    }
    const idx = buildGraphIndex(graph)
    expect(idx.flowAdjacency.get('L')).toEqual(['F1'])
    expect(idx.flowAdjacency.get('F1')).toEqual(['F2'])
    expect(idx.flowAdjacency.get('F2')).toEqual(['Land'])
    expect(idx.flowAdjacency.get('Land')).toEqual([])
  })
})
