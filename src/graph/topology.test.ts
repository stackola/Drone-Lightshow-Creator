import { describe, it, expect } from 'vitest'
import { topologicalSort, detectCycles, getUpstreamNodes, getDownstreamNodes } from './topology'
import {
  makeLaunchNode,
  makeFormationNode,
  makeLandNode,
  makeFlowEdge,
} from './helpers.test-utils'
import type { ShowGraph } from './types'

describe('S0-04: topology', () => {
  describe('topologicalSort', () => {
    it('sorts a linear chain correctly', () => {
      const graph: ShowGraph = {
        nodes: [
          makeLaunchNode({ id: 'a' }),
          makeFormationNode({ id: 'b' }),
          makeLandNode({ id: 'c' }),
        ],
        edges: [
          makeFlowEdge('e1', 'a', 'b'),
          makeFlowEdge('e2', 'b', 'c'),
        ],
      }
      const order = topologicalSort(graph)
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'))
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'))
    })

    it('sorts a diamond (split+merge) correctly', () => {
      const graph: ShowGraph = {
        nodes: [
          makeLaunchNode({ id: 'a' }),
          makeFormationNode({ id: 'b' }),
          makeFormationNode({ id: 'c' }),
          makeLandNode({ id: 'd' }),
        ],
        edges: [
          makeFlowEdge('e1', 'a', 'b'),
          makeFlowEdge('e2', 'a', 'c'),
          makeFlowEdge('e3', 'b', 'd'),
          makeFlowEdge('e4', 'c', 'd'),
        ],
      }
      const order = topologicalSort(graph)
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'))
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'))
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'))
      expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'))
    })

    it('throws on cycle', () => {
      const graph: ShowGraph = {
        nodes: [
          makeFormationNode({ id: 'a' }),
          makeFormationNode({ id: 'b' }),
        ],
        edges: [
          makeFlowEdge('e1', 'a', 'b'),
          makeFlowEdge('e2', 'b', 'a'),
        ],
      }
      expect(() => topologicalSort(graph)).toThrow('cycle')
    })

    it('handles disconnected subgraphs', () => {
      const graph: ShowGraph = {
        nodes: [
          makeLaunchNode({ id: 'a' }),
          makeFormationNode({ id: 'b' }),
          makeLaunchNode({ id: 'c' }),
          makeFormationNode({ id: 'd' }),
        ],
        edges: [
          makeFlowEdge('e1', 'a', 'b'),
          makeFlowEdge('e2', 'c', 'd'),
        ],
      }
      const order = topologicalSort(graph)
      expect(order).toHaveLength(4)
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'))
      expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'))
    })

    it('handles single node', () => {
      const graph: ShowGraph = {
        nodes: [makeLaunchNode({ id: 'a' })],
        edges: [],
      }
      expect(topologicalSort(graph)).toEqual(['a'])
    })

    it('handles empty graph', () => {
      const graph: ShowGraph = { nodes: [], edges: [] }
      expect(topologicalSort(graph)).toEqual([])
    })

    it('ignores group nodes', () => {
      const graph: ShowGraph = {
        nodes: [
          makeLaunchNode({ id: 'a' }),
          makeFormationNode({ id: 'b' }),
          { id: 'g', type: 'group', position: { x: 0, y: 0 }, parentId: null, data: { label: 'G', color: '#fff', collapsed: false, showInternalEdges: true } },
        ],
        edges: [makeFlowEdge('e1', 'a', 'b')],
      }
      const order = topologicalSort(graph)
      expect(order).not.toContain('g')
      expect(order).toContain('a')
      expect(order).toContain('b')
    })

    it('handles complex multi-branch topology', () => {
      const graph: ShowGraph = {
        nodes: [
          makeLaunchNode({ id: 'launch' }),
          makeFormationNode({ id: 'f1' }),
          makeFormationNode({ id: 'f2' }),
          makeFormationNode({ id: 'f3' }),
          makeFormationNode({ id: 'f4' }),
          makeLandNode({ id: 'land' }),
        ],
        edges: [
          makeFlowEdge('e1', 'launch', 'f1'),
          makeFlowEdge('e2', 'f1', 'f2'),
          makeFlowEdge('e3', 'f1', 'f3'),
          makeFlowEdge('e4', 'f2', 'f4'),
          makeFlowEdge('e5', 'f3', 'f4'),
          makeFlowEdge('e6', 'f4', 'land'),
        ],
      }
      const order = topologicalSort(graph)
      expect(order).toHaveLength(6)
      expect(order.indexOf('launch')).toBeLessThan(order.indexOf('f1'))
      expect(order.indexOf('f1')).toBeLessThan(order.indexOf('f2'))
      expect(order.indexOf('f1')).toBeLessThan(order.indexOf('f3'))
      expect(order.indexOf('f2')).toBeLessThan(order.indexOf('f4'))
      expect(order.indexOf('f3')).toBeLessThan(order.indexOf('f4'))
    })
  })

  describe('detectCycles', () => {
    it('returns null for acyclic graph', () => {
      const graph: ShowGraph = {
        nodes: [makeLaunchNode({ id: 'a' }), makeFormationNode({ id: 'b' })],
        edges: [makeFlowEdge('e1', 'a', 'b')],
      }
      expect(detectCycles(graph)).toBeNull()
    })

    it('detects simple 2-node cycle', () => {
      const graph: ShowGraph = {
        nodes: [makeFormationNode({ id: 'a' }), makeFormationNode({ id: 'b' })],
        edges: [
          makeFlowEdge('e1', 'a', 'b'),
          makeFlowEdge('e2', 'b', 'a'),
        ],
      }
      const cycles = detectCycles(graph)
      expect(cycles).not.toBeNull()
      expect(cycles!.length).toBeGreaterThanOrEqual(1)
    })

    it('detects 3-node cycle', () => {
      const graph: ShowGraph = {
        nodes: [
          makeFormationNode({ id: 'a' }),
          makeFormationNode({ id: 'b' }),
          makeFormationNode({ id: 'c' }),
        ],
        edges: [
          makeFlowEdge('e1', 'a', 'b'),
          makeFlowEdge('e2', 'b', 'c'),
          makeFlowEdge('e3', 'c', 'a'),
        ],
      }
      const cycles = detectCycles(graph)
      expect(cycles).not.toBeNull()
    })
  })

  describe('getUpstreamNodes', () => {
    it('returns all ancestors', () => {
      const graph: ShowGraph = {
        nodes: [
          makeLaunchNode({ id: 'a' }),
          makeFormationNode({ id: 'b' }),
          makeLandNode({ id: 'c' }),
        ],
        edges: [
          makeFlowEdge('e1', 'a', 'b'),
          makeFlowEdge('e2', 'b', 'c'),
        ],
      }
      expect(getUpstreamNodes(graph, 'c').sort()).toEqual(['a', 'b'])
      expect(getUpstreamNodes(graph, 'b')).toEqual(['a'])
      expect(getUpstreamNodes(graph, 'a')).toEqual([])
    })
  })

  describe('getDownstreamNodes', () => {
    it('returns all descendants', () => {
      const graph: ShowGraph = {
        nodes: [
          makeLaunchNode({ id: 'a' }),
          makeFormationNode({ id: 'b' }),
          makeLandNode({ id: 'c' }),
        ],
        edges: [
          makeFlowEdge('e1', 'a', 'b'),
          makeFlowEdge('e2', 'b', 'c'),
        ],
      }
      expect(getDownstreamNodes(graph, 'a').sort()).toEqual(['b', 'c'])
      expect(getDownstreamNodes(graph, 'b')).toEqual(['c'])
      expect(getDownstreamNodes(graph, 'c')).toEqual([])
    })
  })
})
