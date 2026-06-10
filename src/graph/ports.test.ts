import { describe, it, expect } from 'vitest'
import { getPortDef, isValidConnection, NODE_PORT_DEFS } from './ports'
import { makeLaunchNode, makeFormationNode, makeLandNode, makeIdleNode, makeFlowEdge } from './helpers.test-utils'
import type { ShowGraph } from './types'

describe('S0-03: ports', () => {
  it('getPortDef returns correct port for launch flow-out', () => {
    const port = getPortDef('launch', 'flow-out')
    expect(port).toBeDefined()
    expect(port!.direction).toBe('output')
    expect(port!.edgeType).toBe('flow')
  })

  it('getPortDef returns undefined for non-existent port', () => {
    expect(getPortDef('launch', 'doesnt-exist')).toBeUndefined()
  })

  it('all node types have port definitions', () => {
    const types = ['launch', 'formation', 'idle', 'land', 'group'] as const
    for (const t of types) {
      expect(NODE_PORT_DEFS[t]).toBeDefined()
    }
  })

  describe('isValidConnection', () => {
    it('allows valid launch → formation connection', () => {
      const graph: ShowGraph = {
        nodes: [makeLaunchNode({ id: 'a' }), makeFormationNode({ id: 'b' })],
        edges: [],
      }
      const result = isValidConnection(graph, 'a', 'flow-out', 'b', 'flow-in')
      expect(result.valid).toBe(true)
    })

    it('rejects self-loop', () => {
      const graph: ShowGraph = {
        nodes: [makeFormationNode({ id: 'a' })],
        edges: [],
      }
      const result = isValidConnection(graph, 'a', 'flow-out', 'a', 'flow-in')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('Self-loop')
    })

    it('rejects wrong direction (input → input)', () => {
      const graph: ShowGraph = {
        nodes: [makeFormationNode({ id: 'a' }), makeFormationNode({ id: 'b' })],
        edges: [],
      }
      const result = isValidConnection(graph, 'a', 'flow-in', 'b', 'flow-in')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('not an output')
    })

    it('rejects edge type mismatch (flow → attachment)', () => {
      const graph: ShowGraph = {
        nodes: [makeLaunchNode({ id: 'a' }), makeFormationNode({ id: 'b' })],
        edges: [],
      }
      const result = isValidConnection(graph, 'a', 'flow-out', 'b', 'idle-attach')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('Edge type mismatch')
    })

    it('rejects node type not in accepts list', () => {
      const graph: ShowGraph = {
        nodes: [makeLaunchNode({ id: 'a' }), makeLandNode({ id: 'b' })],
        edges: [],
      }
      // Launch flow-out accepts: formation, idle — NOT land
      const result = isValidConnection(graph, 'a', 'flow-out', 'b', 'flow-in')
      expect(result.valid).toBe(false)
    })

    it('rejects exceeded max connections on idle flow-in (max 1)', () => {
      const graph: ShowGraph = {
        nodes: [
          makeFormationNode({ id: 'a' }),
          makeFormationNode({ id: 'b' }),
          makeIdleNode({ id: 'idle1' }),
        ],
        edges: [
          makeFlowEdge('e1', 'a', 'idle1'),
        ],
      }
      const result = isValidConnection(graph, 'b', 'flow-out', 'idle1', 'flow-in')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('max connections')
    })

    it('allows formation → formation connection (direct, no transition node)', () => {
      const graph: ShowGraph = {
        nodes: [makeFormationNode({ id: 'a' }), makeFormationNode({ id: 'b' })],
        edges: [],
      }
      const result = isValidConnection(graph, 'a', 'flow-out', 'b', 'flow-in')
      expect(result.valid).toBe(true)
    })

    it('allows formation → land connection (direct)', () => {
      const graph: ShowGraph = {
        nodes: [makeFormationNode({ id: 'a' }), makeLandNode({ id: 'b' })],
        edges: [],
      }
      const result = isValidConnection(graph, 'a', 'flow-out', 'b', 'flow-in')
      expect(result.valid).toBe(true)
    })

    it('rejects when source node does not exist', () => {
      const graph: ShowGraph = {
        nodes: [makeFormationNode({ id: 'b' })],
        edges: [],
      }
      const result = isValidConnection(graph, 'ghost', 'flow-out', 'b', 'flow-in')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('not found')
    })
  })
})
