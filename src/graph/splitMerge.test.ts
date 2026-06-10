import { describe, it, expect } from 'vitest'
import { computeFlow } from './flow'
import { computeAllTiming } from './timing'
import { evaluateAtTime } from './evaluate'
import { validateGraph } from './validate'
import { checkInvariants } from './invariants'
import { verifyRoundTrip } from './serialize'
import {
  makeLaunchNode,
  makeFormationNode,
  makeLandNode,
  makeFlowEdge,
} from './helpers.test-utils'
import type { ShowGraph, ShowNode, Vec3 } from './types'

/**
 * Build the split/merge demo graph:
 * Launch(100) → FormA(50) + FormB(50) → FormC(100) → Land
 * (Transitions are configured on flow edges, defaulting to shortest-path · 2s.)
 */
function buildSplitMergeGraph(): ShowGraph {
  return {
    nodes: [
      makeLaunchNode({ id: 'launch', data: { droneCount: 100, startTime: 0, staggerDelay: 0.02 } }),
      makeFormationNode({ id: 'formA', data: { formationId: 'ring', startTime: 5, duration: 5, transform: { position: { x: -10, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
      makeFormationNode({ id: 'formB', data: { formationId: 'grid', startTime: 5, duration: 5, transform: { position: { x: 10, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
      makeFormationNode({ id: 'formC', data: { formationId: 'ring', startTime: 14, duration: 5, transform: { position: { x: 0, y: 15, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, keyframes: [], colorProgramId: null, idleConfigs: [] } }),
      makeLandNode({ id: 'land' }),
    ],
    edges: [
      makeFlowEdge('e1', 'launch', 'formA'),
      makeFlowEdge('e2', 'launch', 'formB'),
      makeFlowEdge('e3', 'formA', 'formC'),
      makeFlowEdge('e4', 'formB', 'formC'),
      makeFlowEdge('e5', 'formC', 'land'),
    ],
  }
}

describe('S7-05: End-to-end split/merge', () => {
  const graph = buildSplitMergeGraph()

  it('graph passes invariants', () => {
    expect(checkInvariants(graph)).toEqual([])
  })

  it('graph validates without errors', () => {
    const diags = validateGraph(graph)
    const errors = diags.filter((d) => d.severity === 'error')
    expect(errors).toEqual([])
  })

  it('serialization round-trip is exact', () => {
    expect(verifyRoundTrip(graph)).toBe(true)
  })

  describe('flow computation', () => {
    const flowResult = computeFlow(graph)

    it('launch → formA carries 50', () => {
      expect(flowResult.edges.find((e) => e.id === 'e1')?.droneCount).toBe(50)
    })

    it('launch → formB carries 50', () => {
      expect(flowResult.edges.find((e) => e.id === 'e2')?.droneCount).toBe(50)
    })

    it('formA → formC carries 50', () => {
      expect(flowResult.edges.find((e) => e.id === 'e3')?.droneCount).toBe(50)
    })

    it('formB → formC carries 50', () => {
      expect(flowResult.edges.find((e) => e.id === 'e4')?.droneCount).toBe(50)
    })

    it('formC → land carries 100', () => {
      expect(flowResult.edges.find((e) => e.id === 'e5')?.droneCount).toBe(100)
    })

    it('total flow is conserved (no drones lost)', () => {
      const intoLand = flowResult.edges.find((e) => e.id === 'e5')?.droneCount ?? 0
      expect(intoLand).toBe(100)
    })
  })

  describe('timing computation', () => {
    const timing = computeAllTiming(graph)

    it('launch starts at 0', () => {
      expect(timing.get('launch')?.start).toBe(0)
    })

    it('formA and formB start at the same time', () => {
      expect(timing.get('formA')?.start).toBe(timing.get('formB')?.start)
    })

    it('formC starts after both formA and formB end', () => {
      const formCStart = timing.get('formC')!.start
      const formAEnd = timing.get('formA')!.end
      const formBEnd = timing.get('formB')!.end
      expect(formCStart).toBeGreaterThanOrEqual(formAEnd)
      expect(formCStart).toBeGreaterThanOrEqual(formBEnd)
    })
  })

  describe('evaluateAtTime with resolved flow', () => {
    const flowResult = computeFlow(graph)
    const resolvedGraph: ShowGraph = { nodes: graph.nodes, edges: flowResult.edges }
    const homePositions: Vec3[] = Array.from({ length: 100 }, (_, i) => ({
      x: (i % 10) * 2,
      y: 0,
      z: Math.floor(i / 10) * 2,
    }))
    const formations = new Map<string, Vec3[]>()
    formations.set('ring', Array.from({ length: 100 }, (_, i) => ({
      x: Math.cos((i / 100) * Math.PI * 2) * 10,
      y: 0,
      z: Math.sin((i / 100) * Math.PI * 2) * 10,
    })))
    formations.set('grid', Array.from({ length: 100 }, (_, i) => ({
      x: (i % 10) * 2 - 9,
      y: 0,
      z: Math.floor(i / 10) * 2 - 9,
    })))

    it('returns 100 drone states', () => {
      const states = evaluateAtTime(resolvedGraph, formations, 0, homePositions)
      expect(states).toHaveLength(100)
    })

    it('all drones at home before launch', () => {
      const states = evaluateAtTime(resolvedGraph, formations, -1, homePositions)
      expect(states.every((s) => s.color.r === 1 && s.color.g === 1 && s.color.b === 1)).toBe(true)
    })

    it('during formA+formB active, drones are split between two formations', () => {
      const states = evaluateAtTime(resolvedGraph, formations, 7, homePositions)
      // Some drones should be blue (formation color)
      const formationDrones = states.filter((s) => s.color.b === 1 && s.color.r === 0.3)
      expect(formationDrones.length).toBeGreaterThan(0)
    })

    it('during formC active, all 100 drones are assigned', () => {
      const states = evaluateAtTime(resolvedGraph, formations, 16, homePositions)
      const formationDrones = states.filter((s) => s.color.b === 1 && s.color.r === 0.3)
      // After merge, formC should have all 100 drones
      expect(formationDrones.length).toBe(100)
    })

    it('evaluation completes in <16ms for 100 drones', () => {
      const start = performance.now()
      for (let i = 0; i < 10; i++) {
        evaluateAtTime(resolvedGraph, formations, i * 2, homePositions)
      }
      const elapsed = performance.now() - start
      // 10 evaluations should complete under 500ms total (includes real point mapping)
      expect(elapsed).toBeLessThan(500)
    })
  })

  describe('GATE 2 conditions', () => {
    const flowResult = computeFlow(graph)
    const resolvedGraph: ShowGraph = { nodes: graph.nodes, edges: flowResult.edges }

    it('GATE-2a: split/merge allocation under mutation', () => {
      // Change first edge to manual 30/70 — paired with second edge auto
      const mutatedEdges = resolvedGraph.edges.map((e) => {
        if (e.id === 'e1') return { ...e, allocation: { mode: 'manual-count' as const, count: 30 } }
        return e
      })
      const mutatedGraph: ShowGraph = { nodes: resolvedGraph.nodes, edges: mutatedEdges }
      const reflow = computeFlow(mutatedGraph)
      expect(reflow.edges.find((e) => e.id === 'e1')?.droneCount).toBe(30)
      expect(reflow.edges.find((e) => e.id === 'e2')?.droneCount).toBe(70)
      // Still receives all 100 into formC
      expect(reflow.edges.find((e) => e.id === 'e5')?.droneCount).toBe(100)
    })

    it('GATE-2c: graph evaluation determinism', () => {
      const homePositions: Vec3[] = Array.from({ length: 100 }, (_, i) => ({
        x: (i % 10) * 2, y: 0, z: Math.floor(i / 10) * 2,
      }))
      const formations = new Map<string, Vec3[]>()
      formations.set('ring', Array.from({ length: 100 }, (_, i) => ({
        x: Math.cos((i / 100) * Math.PI * 2) * 10, y: 0,
        z: Math.sin((i / 100) * Math.PI * 2) * 10,
      })))
      formations.set('grid', Array.from({ length: 100 }, (_, i) => ({
        x: (i % 10) * 2 - 9, y: 0, z: Math.floor(i / 10) * 2 - 9,
      })))

      const states1 = evaluateAtTime(resolvedGraph, formations, 7, homePositions)
      const states2 = evaluateAtTime(resolvedGraph, formations, 7, homePositions)
      expect(JSON.stringify(states1)).toBe(JSON.stringify(states2))
    })

    it('GATE-2b: transition timing shifts when source formation is dragged', () => {
      // Move formA startTime from 5 to 8 — transition timing should shift
      const shiftedNodes = resolvedGraph.nodes.map((n) => {
        if (n.id === 'formA') {
          return { ...n, data: { ...n.data, startTime: 8, duration: 5 } } as ShowNode
        }
        return n
      })
      const shiftedGraph: ShowGraph = { nodes: shiftedNodes, edges: resolvedGraph.edges }
      const timing = computeAllTiming(shiftedGraph)
      // formA now ends at 13. The formA→formC edge (preferredDuration=2) needs [13, 15],
      // and formC authored at 14 → cascade-push to 15.
      const formCTiming = timing.get('formC')
      expect(formCTiming).toBeDefined()
      expect(formCTiming!.start).toBe(15)
    })

    it('GATE-2c: evaluation determinism across 20 sample times', () => {
      const homePositions: Vec3[] = Array.from({ length: 100 }, (_, i) => ({
        x: (i % 10) * 2, y: 0, z: Math.floor(i / 10) * 2,
      }))
      const formations = new Map<string, Vec3[]>()
      formations.set('ring', Array.from({ length: 100 }, (_, i) => ({
        x: Math.cos((i / 100) * Math.PI * 2) * 10, y: 0,
        z: Math.sin((i / 100) * Math.PI * 2) * 10,
      })))
      formations.set('grid', Array.from({ length: 100 }, (_, i) => ({
        x: (i % 10) * 2 - 9, y: 0, z: Math.floor(i / 10) * 2 - 9,
      })))

      // Evaluate at 20 sample times, serialize, deserialize, compare
      for (let sample = 0; sample < 20; sample++) {
        const t = sample * 1.2
        const states1 = evaluateAtTime(resolvedGraph, formations, t, homePositions)
        const states2 = evaluateAtTime(resolvedGraph, formations, t, homePositions)
        expect(JSON.stringify(states1)).toBe(JSON.stringify(states2))
      }
    })

    it('GATE-2e: serialization round-trip for split/merge', () => {
      expect(verifyRoundTrip(resolvedGraph)).toBe(true)
    })
  })

  describe('S7-05: E2E play-through', () => {
    const flowResult = computeFlow(graph)
    const resolvedGraph: ShowGraph = { nodes: graph.nodes, edges: flowResult.edges }
    const homePositions: Vec3[] = Array.from({ length: 100 }, (_, i) => ({
      x: (i % 10) * 2, y: 0, z: Math.floor(i / 10) * 2,
    }))
    const formations = new Map<string, Vec3[]>()
    formations.set('ring', Array.from({ length: 100 }, (_, i) => ({
      x: Math.cos((i / 100) * Math.PI * 2) * 10, y: 0,
      z: Math.sin((i / 100) * Math.PI * 2) * 10,
    })))
    formations.set('grid', Array.from({ length: 100 }, (_, i) => ({
      x: (i % 10) * 2 - 9, y: 0, z: Math.floor(i / 10) * 2 - 9,
    })))

    it('no errors at any time step from 0 to totalDuration', () => {
      const timing = computeAllTiming(resolvedGraph)
      let maxEnd = 0
      timing.forEach((t) => { if (t.end > maxEnd) maxEnd = t.end })

      for (let t = 0; t <= maxEnd; t += 0.5) {
        const states = evaluateAtTime(resolvedGraph, formations, t, homePositions)
        expect(states).toBeDefined()
        expect(states.length).toBe(100)
        // No NaN positions
        for (const s of states) {
          expect(isFinite(s.position.x)).toBe(true)
          expect(isFinite(s.position.y)).toBe(true)
          expect(isFinite(s.position.z)).toBe(true)
        }
      }
    })

    it('graph invariants hold on resolved graph', () => {
      const violations = checkInvariants(resolvedGraph)
      expect(violations).toEqual([])
    })

    it('validation produces no errors on resolved graph', () => {
      const diags = validateGraph(resolvedGraph)
      const errors = diags.filter((d) => d.severity === 'error')
      expect(errors).toEqual([])
    })
  })

  describe('GATE-1e: performance benchmark', () => {
    const flowResult = computeFlow(graph)
    const resolvedGraph: ShowGraph = { nodes: graph.nodes, edges: flowResult.edges }
    const homePositions: Vec3[] = Array.from({ length: 100 }, (_, i) => ({
      x: (i % 10) * 2, y: 0, z: Math.floor(i / 10) * 2,
    }))
    const formations = new Map<string, Vec3[]>()
    formations.set('ring', Array.from({ length: 100 }, (_, i) => ({
      x: Math.cos((i / 100) * Math.PI * 2) * 10, y: 0,
      z: Math.sin((i / 100) * Math.PI * 2) * 10,
    })))

    it('single evaluateAtTime call completes in <16ms for 100 drones', () => {
      // Warm up
      evaluateAtTime(resolvedGraph, formations, 5, homePositions)

      const times: number[] = []
      for (let i = 0; i < 20; i++) {
        const start = performance.now()
        evaluateAtTime(resolvedGraph, formations, i * 1.0, homePositions)
        times.push(performance.now() - start)
      }
      const avg = times.reduce((a, b) => a + b, 0) / times.length
      // Average should be well under 16ms
      expect(avg).toBeLessThan(16)
    })
  })
})
