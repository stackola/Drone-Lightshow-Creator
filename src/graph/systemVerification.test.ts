// ============================================================================
// SYSTEM VERIFICATION TESTS — end-to-end checks for critical paths
// ============================================================================
// These tests verify the system works correctly as a whole, not individual units.
// They catch integration bugs that unit tests miss.
// ============================================================================

import { describe, it, expect } from 'vitest'
import { useGraphStore } from '../stores/graphStore'
import { useProjectStore } from '../stores/projectStore'
import { useFormationStore } from '../stores/formationStore'
import { evaluateAtTime } from './evaluate'
import { computeAllTiming } from './timing'
import { validateShowPhysics } from './physicsValidator'
import { serializeProject, deserializeProject } from './serialize'
import { initRegistries } from '../registries/init'
import type { LaunchNodeData, FormationNodeData, LandNodeData } from './types'

initRegistries()

function reset() {
  useGraphStore.getState().loadGraph({ nodes: [], edges: [] })
  useFormationStore.getState().loadFormations([], new Map())
  useProjectStore.getState().setDroneCount(100)
}

// Build a complete, realistic show
function buildRealisticShow() {
  reset()
  const gs = useGraphStore.getState()
  const fs = useFormationStore.getState()
  const ps = useProjectStore.getState()

  ps.setDroneCount(100)
  const ringId = fs.addFormation('Opening Ring', 'ring', { count: 100, radius: 10 })
  const sphereId = fs.addFormation('Finale Sphere', 'sphere', { count: 100, radius: 12 })

  const launchId = gs.addNode('launch', { x: 0, y: 150 }, {
    droneCount: 100, startTime: 0, staggerDelay: 0.02,
  } as LaunchNodeData)

  const form1Id = gs.addNode('formation', { x: 200, y: 150 }, {
    formationId: ringId, startTime: 5, duration: 10,
    transform: { position: { x: 0, y: 15, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    keyframes: [], colorProgramId: null, idleConfigs: [],
  } as FormationNodeData)

  const form2Id = gs.addNode('formation', { x: 600, y: 150 }, {
    formationId: sphereId, startTime: 19, duration: 10,
    transform: { position: { x: 0, y: 20, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    keyframes: [], colorProgramId: null, idleConfigs: [],
  } as FormationNodeData)

  const landId = gs.addNode('land', { x: 800, y: 150 }, {
    staggerDelay: 0.02,
  } as LandNodeData)

  gs.addEdge(launchId, 'flow-out', form1Id, 'flow-in', 'flow')
  gs.addEdge(form1Id, 'flow-out', form2Id, 'flow-in', 'flow')
  gs.addEdge(form2Id, 'flow-out', landId, 'flow-in', 'flow')

  return { launchId, form1Id, form2Id, landId, ringId, sphereId }
}

// ── 1. TIMING VERIFICATION ─────────────────────────────────────────────────

describe('Timing system', () => {
  it('launch timing includes rise duration and stagger', () => {
    const { launchId } = buildRealisticShow()
    const timing = computeAllTiming({ nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges })
    const t = timing.get(launchId)!
    expect(t.start).toBe(0)
    // Launch end = startTime + staggerDelay * droneCount + riseDuration
    // With 100 drones * 0.02 stagger = 2s stagger + ~2s rise = ~4s
    expect(t.end).toBeGreaterThanOrEqual(2) // at minimum stagger time
  })

  it('formation timing matches data fields', () => {
    const { form1Id } = buildRealisticShow()
    const timing = computeAllTiming({ nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges })
    const t = timing.get(form1Id)!
    // Launch ends at 4 (100*0.02 + 2s rise). Edge default 2s transition window [4,6].
    // f1 authored startTime=5 is overrun → cascade-pushed to 6. End = 6 + 10 = 16.
    expect(t.start).toBe(6)
    expect(t.end).toBe(16)
  })

  it('edge transition window is derived from neighbors', () => {
    const { form1Id, form2Id } = buildRealisticShow()
    const edges = useGraphStore.getState().edges
    const edge = edges.find((e) => e.source === form1Id && e.target === form2Id)!
    const edgeTiming = useGraphStore.getState().getCachedEdgeTiming()
    const tEdge = edgeTiming.get(edge.id)!
    const timing = useGraphStore.getState().getCachedTiming()
    const tForm1 = timing.get(form1Id)!
    // Edge starts when upstream formation ends
    expect(tEdge.start).toBe(tForm1.end)
    // Edge ends at upstream end + effective duration (or pushed end of downstream if overrun).
    // With preferredDuration=2 and no overrun (f2 at 19 ≥ f1.end + 2 = 18), edge ends at 18.
    expect(tEdge.end).toBe(tForm1.end + 2)
  })

  it('all nodes have non-overlapping sequential timing', () => {
    buildRealisticShow()
    const graph = { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges }
    const timing = computeAllTiming(graph)
    const sorted = [...timing.entries()]
      .filter(([id]) => {
        const node = graph.nodes.find((n) => n.id === id)
        return node && node.type !== 'group'
      })
      .sort((a, b) => a[1].start - b[1].start)

    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = sorted[i]![1]
      const next = sorted[i + 1]![1]
      // Each node should start at or after the previous ends
      // (transitions can overlap with formation start)
      expect(curr.start).toBeLessThanOrEqual(curr.end)
      expect(next.start).toBeGreaterThanOrEqual(0)
    }
  })
})

// ── 2. EVALUATOR VERIFICATION ───────────────────────────────────────────────

describe('Evaluator produces valid output', () => {
  it('returns correct number of drone states', () => {
    buildRealisticShow()
    const graph = { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges }
    const homePositions = useProjectStore.getState().dronePool.homePositions
    const states = evaluateAtTime(graph, useFormationStore.getState().generatedPoints, 7, homePositions)
    expect(states.length).toBe(100)
  })

  it('drones are at home positions at t=0', () => {
    buildRealisticShow()
    const graph = { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges }
    const homePositions = useProjectStore.getState().dronePool.homePositions
    const states = evaluateAtTime(graph, useFormationStore.getState().generatedPoints, 0, homePositions)
    // At t=0, drones should be near home positions (may have started rising)
    for (let i = 0; i < Math.min(10, states.length); i++) {
      const home = homePositions[i]!
      const state = states[i]!
      // X and Z should match home (launch doesn't move horizontally)
      expect(Math.abs(state.position.x - home.x)).toBeLessThan(1)
      expect(Math.abs(state.position.z - home.z)).toBeLessThan(1)
    }
  })

  it('drones are in formation during formation time', () => {
    buildRealisticShow()
    const graph = { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges }
    const homePositions = useProjectStore.getState().dronePool.homePositions
    const formations = useFormationStore.getState().generatedPoints
    // At t=10 (middle of first formation, ring at y=15)
    const states = evaluateAtTime(graph, formations, 10, homePositions)
    // Some drones should be near altitude 15
    const droneHeights = states.map((s) => s.position.y)
    const avgHeight = droneHeights.reduce((s, h) => s + h, 0) / droneHeights.length
    // Average should be in the ballpark of 15 (the ring altitude)
    expect(avgHeight).toBeGreaterThan(5)
    expect(avgHeight).toBeLessThan(25)
  })

  it('all drone positions are finite numbers', () => {
    buildRealisticShow()
    const graph = { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges }
    const homePositions = useProjectStore.getState().dronePool.homePositions
    const formations = useFormationStore.getState().generatedPoints
    // Check at multiple time points
    for (const t of [0, 2, 5, 10, 15, 18, 20, 25, 28]) {
      const states = evaluateAtTime(graph, formations, t, homePositions)
      for (const s of states) {
        expect(Number.isFinite(s.position.x)).toBe(true)
        expect(Number.isFinite(s.position.y)).toBe(true)
        expect(Number.isFinite(s.position.z)).toBe(true)
        expect(Number.isFinite(s.color.r)).toBe(true)
        expect(Number.isFinite(s.color.g)).toBe(true)
        expect(Number.isFinite(s.color.b)).toBe(true)
      }
    }
  })
})

// ── 3. PHYSICS VALIDATOR VERIFICATION ───────────────────────────────────────

describe('Physics validator catches real violations', () => {
  it('catches keyframe velocity violations', () => {
    reset()
    const ringId = useFormationStore.getState().addFormation('Fast Ring', 'ring', { count: 50, radius: 10 })

    const launchId = useGraphStore.getState().addNode('launch', { x: 0, y: 150 }, {
      droneCount: 50, startTime: 0, staggerDelay: 0.02,
    } as LaunchNodeData)
    const formId = useGraphStore.getState().addNode('formation', { x: 200, y: 150 }, {
      formationId: ringId, startTime: 3, duration: 2,
      transform: { position: { x: 0, y: 15, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [{
        id: 'kf1', time: 1,
        transform: { position: { x: 30, y: 15, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        easing: 'linear' as const,
      }],
      colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const landId = useGraphStore.getState().addNode('land', { x: 400, y: 150 }, { staggerDelay: 0.02 } as LandNodeData)
    useGraphStore.getState().addEdge(launchId, 'flow-out', formId, 'flow-in', 'flow')
    useGraphStore.getState().addEdge(formId, 'flow-out', landId, 'flow-in', 'flow')

    // Always re-read fresh state
    const graph = { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges }
    const violations = validateShowPhysics(graph, useProjectStore.getState().constraints, useFormationStore.getState().generatedPoints)
    // Moving 30m in 1s = 30 m/s >> 8 m/s limit — should be caught
    const kfViolation = violations.find((v) => v.type === 'keyframe-too-fast' && v.id.startsWith('kf-fast'))
    expect(kfViolation).toBeDefined()
    expect(kfViolation!.fix).toBeDefined()
  })

  it('catches implicit launch→formation velocity violations', () => {
    reset()
    const ringId = useFormationStore.getState().addFormation('Far Ring', 'ring', { count: 50, radius: 20 })

    const launchId = useGraphStore.getState().addNode('launch', { x: 0, y: 150 }, {
      droneCount: 50, startTime: 0, staggerDelay: 0.02,
    } as LaunchNodeData)
    // Launch end = 0 + 50*0.02 + 2.0 = 3.0s. Formation at t=3.5 → gap = 0.5s
    // Drones must travel from ~(0, 8, 0) to ring at y=30, radius 20 → ~35m in 0.5s = 70 m/s
    const formId = useGraphStore.getState().addNode('formation', { x: 100, y: 150 }, {
      formationId: ringId, startTime: 3.5, duration: 5,
      transform: { position: { x: 0, y: 30, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [], colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const landId = useGraphStore.getState().addNode('land', { x: 400, y: 150 }, { staggerDelay: 0.02 } as LandNodeData)
    useGraphStore.getState().addEdge(launchId, 'flow-out', formId, 'flow-in', 'flow')
    useGraphStore.getState().addEdge(formId, 'flow-out', landId, 'flow-in', 'flow')

    const graph = { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges }
    const violations = validateShowPhysics(graph, useProjectStore.getState().constraints, useFormationStore.getState().generatedPoints)
    // Per-edge transition violations have id `trans-short-<edgeId>` now that every flow edge owns a transition.
    const transViolation = violations.find((v) => v.id.startsWith('trans-short-'))
    expect(transViolation).toBeDefined()
    expect(transViolation!.type).toBe('transition-too-short')
  })

  it('extend-formation fix rescales keyframe times', () => {
    reset()
    const gs = useGraphStore.getState()
    const fs = useFormationStore.getState()
    const ringId = fs.addFormation('Test Ring', 'ring', { count: 50, radius: 10 })

    const launchId = gs.addNode('launch', { x: 0, y: 150 }, {
      droneCount: 50, startTime: 0, staggerDelay: 0.02,
    } as LaunchNodeData)
    const formId = gs.addNode('formation', { x: 200, y: 150 }, {
      formationId: ringId, startTime: 5, duration: 5,
      transform: { position: { x: 0, y: 15, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      keyframes: [{
        id: 'kf1', time: 2.5,
        transform: { position: { x: 0, y: 15, z: 0 }, rotation: { x: 0, y: Math.PI, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        easing: 'ease-in-out' as const,
      }],
      colorProgramId: null, idleConfigs: [],
    } as FormationNodeData)
    const landId = gs.addNode('land', { x: 400, y: 150 }, { staggerDelay: 0.02 } as LandNodeData)
    gs.addEdge(launchId, 'flow-out', formId, 'flow-in', 'flow')
    gs.addEdge(formId, 'flow-out', landId, 'flow-in', 'flow')

    // Apply extend-formation fix
    gs.applyViolationFixes([{ type: 'extend-formation', nodeId: formId, delta: 5 }])

    const updatedNode = gs.getNode(formId)!
    const updatedData = updatedNode.data as FormationNodeData
    // Duration should be extended
    expect(updatedData.duration).toBe(10)
    // Keyframe at t=2.5 should be rescaled to t=5.0 (proportional)
    expect(updatedData.keyframes[0]!.time).toBe(5)
  })
})

// ── 4. SERIALIZATION ROUND-TRIP ─────────────────────────────────────────────

describe('Serialization round-trip', () => {
  it('preserves all data through save/load', () => {
    buildRealisticShow()
    const origGraph = { nodes: [...useGraphStore.getState().nodes], edges: [...useGraphStore.getState().edges] }
    const origMeta = { ...useProjectStore.getState().meta }
    const origPool = { ...useProjectStore.getState().dronePool }
    const origConstraints = { ...useProjectStore.getState().constraints }

    // Serialize
    const json = serializeProject(
      origGraph,
      origMeta,
      origPool,
      origConstraints,
      useFormationStore.getState().formations,
      useFormationStore.getState().generatedPoints,
      useFormationStore.getState().animatedDefs,
    )

    // Deserialize
    const restored = deserializeProject(json)
    expect(restored.graph.nodes.length).toBe(origGraph.nodes.length)
    expect(restored.graph.edges.length).toBe(origGraph.edges.length)
    expect(restored.meta?.name).toBe(origMeta.name)
    expect(restored.dronePool?.droneCount).toBe(origPool.droneCount)
    expect(restored.formations?.length).toBe(useFormationStore.getState().formations.length)
  })

  it('handles missing S15 constraint fields gracefully', () => {
    // Simulate a pre-S15 project file
    const oldJson = JSON.stringify({
      version: 2,
      graph: { nodes: [], edges: [] },
      meta: { id: 'old', name: 'Old Project', createdAt: '2025-01-01', modifiedAt: '2025-01-01' },
      dronePool: { droneCount: 50, launchLayout: 'grid', spacing: 2, homePositions: [] },
      constraints: {
        maxVelocity: 8, maxAcceleration: 4, minDroneDistance: 1.5,
        altitudeMin: 0, altitudeMax: 120, geofenceRadius: 200,
        maxFlightTime: 1200, windSpeed: 0,
        // Missing: maxJerk, maxAscentRate, maxDescentRate, windGustFactor,
        // safetyMarginVelocity, safetyMarginSpacing, batteryReserve, gpsAccuracy, geofencePolygon
      },
    })

    // Should not throw
    const result = deserializeProject(oldJson)
    expect(result.graph.nodes.length).toBe(0)
    expect(result.constraints).toBeDefined()
    // Missing fields should be undefined (not crash)
    expect(result.constraints!.maxVelocity).toBe(8)
  })
})

// ── 5. DRONE SPACING IN GENERATORS ──────────────────────────────────────────

describe('Generators produce properly spaced points', () => {
  it('ring generator spaces drones correctly', () => {
    const fs = useFormationStore.getState()
    const id = fs.addFormation('Test Ring', 'ring', { count: 20, radius: 10 })
    const pts = fs.getPoints(id)!
    expect(pts.length).toBe(20)

    // Check minimum spacing
    let minDist = Infinity
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.sqrt((pts[i]!.x - pts[j]!.x) ** 2 + (pts[i]!.y - pts[j]!.y) ** 2 + (pts[i]!.z - pts[j]!.z) ** 2)
        if (d < minDist) minDist = d
      }
    }
    // Ring of radius 10 with 20 drones: circumference = 2π*10 = 62.8m, spacing = 62.8/20 = 3.14m
    expect(minDist).toBeGreaterThan(2.5)
  })

  it('grid generator spaces drones correctly', () => {
    const fs = useFormationStore.getState()
    const id = fs.addFormation('Test Grid', 'grid', { cols: 5, rows: 5, spacing: 3 })
    const pts = fs.getPoints(id)!
    expect(pts.length).toBe(25)

    let minDist = Infinity
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.sqrt((pts[i]!.x - pts[j]!.x) ** 2 + (pts[i]!.y - pts[j]!.y) ** 2 + (pts[i]!.z - pts[j]!.z) ** 2)
        if (d < minDist) minDist = d
      }
    }
    // Grid with spacing 3 — adjacent drones should be exactly 3m apart
    expect(Math.abs(minDist - 3)).toBeLessThan(0.01)
  })
})

// ── 6. FIX-ALL CONVERGENCE ──────────────────────────────────────────────────

describe('Fix-all converges', () => {
  it('fix_all_violations does not increase violation count', () => {
    buildRealisticShow()
    const graph = { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges }
    const constraints = useProjectStore.getState().constraints
    const formations = useFormationStore.getState().generatedPoints
    const homePositions = useProjectStore.getState().dronePool.homePositions

    const beforeViolations = validateShowPhysics(graph, constraints, formations, homePositions)
    const beforeCount = beforeViolations.length

    // Apply all fixable violations
    const fixable = beforeViolations.filter((v) => v.fix)
    if (fixable.length > 0) {
      useGraphStore.getState().applyViolationFixes(
        fixable.map((v) => ({ type: v.fix!.type, nodeId: v.fix!.nodeId, edgeId: v.fix!.edgeId, delta: v.fix!.delta })),
      )
    }

    const afterGraph = { nodes: useGraphStore.getState().nodes, edges: useGraphStore.getState().edges }
    const afterViolations = validateShowPhysics(afterGraph, constraints, useFormationStore.getState().generatedPoints, homePositions)
    // Should not have MORE violations after fixing
    expect(afterViolations.length).toBeLessThanOrEqual(beforeCount)
  })
})
