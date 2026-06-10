import { describe, it, expect } from 'vitest'
import { validateGraph } from './validate'
import {
  makeLaunchNode,
  makeFormationNode,
  makeFlowEdge,
  makeLinearDemoGraph,
} from './helpers.test-utils'
import type { ShowGraph } from './types'

describe('S0-07: validateGraph', () => {
  it('valid linear graph returns no errors', () => {
    const graph = makeLinearDemoGraph()
    const diags = validateGraph(graph)
    const errors = diags.filter((d) => d.severity === 'error')
    expect(errors).toEqual([])
  })

  it('detects cycle', () => {
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
    const diags = validateGraph(graph)
    expect(diags.some((d) => d.severity === 'error' && d.message.includes('ycle'))).toBe(true)
  })

  it('detects orphan node (non-launch with no incoming)', () => {
    const graph: ShowGraph = {
      nodes: [
        makeFormationNode({ id: 'orphan' }),
      ],
      edges: [],
    }
    const diags = validateGraph(graph)
    expect(diags.some((d) => d.message.includes('no incoming'))).toBe(true)
  })

  it('does not flag launch as orphan', () => {
    const graph: ShowGraph = {
      nodes: [makeLaunchNode({ id: 'launch' })],
      edges: [],
    }
    const diags = validateGraph(graph)
    expect(diags.some((d) => d.message.includes('no incoming') && d.nodeIds.includes('launch'))).toBe(false)
  })

  it('detects dangling edge (missing source)', () => {
    const graph: ShowGraph = {
      nodes: [makeFormationNode({ id: 'b' })],
      edges: [makeFlowEdge('e1', 'ghost', 'b')],
    }
    const diags = validateGraph(graph)
    expect(diags.some((d) => d.severity === 'error' && d.message.includes('missing source'))).toBe(true)
  })

  it('detects flow over-allocation', () => {
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
    const diags = validateGraph(graph)
    expect(diags.some((d) => d.severity === 'error' && d.message.includes('exceeds'))).toBe(true)
  })
})
