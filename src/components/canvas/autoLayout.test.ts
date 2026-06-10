import { describe, it, expect } from 'vitest'
import { autoLayout } from './autoLayout'
import { makeLaunchNode, makeFormationNode, makeFlowEdge } from '../../graph/helpers.test-utils'
import type { ShowGraph } from '../../graph/types'

describe('autoLayout', () => {
  it('lanes a simple flat chain by start time', () => {
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'L', data: { droneCount: 10, startTime: 0, staggerDelay: 0.05 } }),
        makeFormationNode({ id: 'A', data: { formationId: 'ring', startTime: 5, duration: 5, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
      ],
      edges: [makeFlowEdge('e0', 'L', 'A')],
    }
    const positions = autoLayout(graph, 50)
    const a = positions.find((p) => p.id === 'A')
    expect(a).toBeDefined()
    // A starts at t=5, so x = padding + 5 * 50 = 80 + 250 = 330
    expect(a!.position.x).toBe(330)
  })

  it('A-15: skips nodes that have a parentId (inside a group)', () => {
    const graph: ShowGraph = {
      nodes: [
        makeLaunchNode({ id: 'L', data: { droneCount: 10, startTime: 0, staggerDelay: 0.05 } }),
        // Formation node nested inside a group — auto-layout should leave it
        // alone so React Flow's relative-to-parent positioning is preserved.
        makeFormationNode({
          id: 'A',
          parentId: 'group-1',
          data: { formationId: 'ring', startTime: 5, duration: 5, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] },
        }),
      ],
      edges: [makeFlowEdge('e0', 'L', 'A')],
    }
    const positions = autoLayout(graph, 50)
    // L (no parent) should be re-positioned; A (inside group) should not.
    expect(positions.find((p) => p.id === 'L')).toBeDefined()
    expect(positions.find((p) => p.id === 'A')).toBeUndefined()
  })
})
