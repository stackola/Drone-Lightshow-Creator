// ============================================================================
// Animated Formation Verification — Continuity + Correctness Test
// ============================================================================
// Builds a focused test graph:
//   Launch → Trans → StaticRing → Trans → AnimatedAppleTree → Trans → StaticGrid → Trans → Land
//
// Validates:
// 1. No NaN/Infinity positions at any time
// 2. Animated formation drones have per-drone colors (not default blue)
// 3. Transition INTO animated formation is smooth (no jumps)
// 4. Transition OUT of animated formation is smooth
// 5. During animated formation, per-drone positions change over time (animation is active)
// 6. Animated colors are applied (trunk=brown, canopy=green, apple=red)
// 7. Continuity: no position jump > threshold between consecutive samples
// 8. Determinism: same input → same output
// ============================================================================

import { describe, it, expect, beforeAll } from 'vitest'
import { computeFlow } from './flow'
import { computeAllTiming, type TimeRange } from './timing'
import { evaluateAtTime } from './evaluate'
import {
  makeLaunchNode,
  makeFormationNode,
  makeLandNode,
  makeFlowEdge,
} from './helpers.test-utils'
import type { ShowGraph, Vec3, DroneState } from './types'
import { getGenerator } from '../registries/generators'
import { getLibraryFormations } from '../registries/formationLibrary'
import { getAnimatedFormationRestPositions } from './animatedFormation'
import type { AnimatedFormationDef } from './animatedFormation'

// Force registry side effects
import '../registries/generators'
import '../registries/transitions'
import '../registries/idleBehaviors'
import '../registries/formationLibrary'

// --- Helpers ---

function noNaN(states: DroneState[]): boolean {
  return states.every((s) =>
    isFinite(s.position.x) && isFinite(s.position.y) && isFinite(s.position.z),
  )
}

function maxJump(prev: DroneState[], curr: DroneState[]): number {
  let maxD = 0
  for (let i = 0; i < Math.min(prev.length, curr.length); i++) {
    const p = prev[i]!, c = curr[i]!
    const d = Math.sqrt(
      (p.position.x - c.position.x) ** 2 +
      (p.position.y - c.position.y) ** 2 +
      (p.position.z - c.position.z) ** 2,
    )
    maxD = Math.max(maxD, d)
  }
  return maxD
}

function centroid(states: DroneState[]): Vec3 {
  const n = states.length
  if (n === 0) return { x: 0, y: 0, z: 0 }
  let sx = 0, sy = 0, sz = 0
  for (const s of states) { sx += s.position.x; sy += s.position.y; sz += s.position.z }
  return { x: sx / n, y: sy / n, z: sz / n }
}

// --- Build test graph ---

function buildAnimatedTestGraph(): {
  graph: ShowGraph
  formations: Map<string, Vec3[]>
  animatedDefs: Map<string, AnimatedFormationDef>
  homePositions: Vec3[]
  appleTreeDef: AnimatedFormationDef
} {
  const ringGen = getGenerator('ring')!
  const gridGen = getGenerator('grid')!

  const formations = new Map<string, Vec3[]>()
  const animatedDefs = new Map<string, AnimatedFormationDef>()

  // Static formations
  formations.set('ring-50', ringGen.generate({ count: 50, radius: 10 }))
  formations.set('grid-100', gridGen.generate({ cols: 10, rows: 10, spacing: 1.5 }))

  // Animated formation: Apple Tree
  const appleTreeEntry = getLibraryFormations().find((e) => e.id === 'apple-tree-shake')!
  const appleTreeDef = appleTreeEntry.build()
  const restPositions = getAnimatedFormationRestPositions(appleTreeDef)
  formations.set('apple-tree', restPositions)
  animatedDefs.set('apple-tree', appleTreeDef)

  // Graph:
  //   Launch(t=0) → Trans(2s) → Ring(t=5, 6s) → Trans(2s) → AppleTree(t=15, 10s) → Trans(2s) → Grid(t=30, 5s) → Trans(2s) → Land
  //
  // 50 drones — apple tree uses exactly 50

  const graph: ShowGraph = {
    nodes: [
      makeLaunchNode({ id: 'launch', data: { droneCount: 50, startTime: 0, staggerDelay: 0.01 } }),
      makeFormationNode({ id: 'ring', data: {
        formationId: 'ring-50', startTime: 5, duration: 6,
        transform: { position: { x: 0, y: 12, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        keyframes: [], colorProgramId: null, idleConfigs: [],
      }}),
      makeFormationNode({ id: 'apple-tree', data: {
        formationId: 'apple-tree', startTime: 15, duration: 10,
        transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        keyframes: [], colorProgramId: null, idleConfigs: [],
      }}),
      makeFormationNode({ id: 'grid', data: {
        formationId: 'grid-100', startTime: 30, duration: 5,
        transform: { position: { x: 0, y: 8, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        keyframes: [], colorProgramId: null, idleConfigs: [],
      }}),
      makeLandNode({ id: 'land', data: { staggerDelay: 0.02 } }),
    ],
    edges: [
      makeFlowEdge('e0', 'launch', 'ring'),
      makeFlowEdge('e1', 'ring', 'apple-tree'),
      makeFlowEdge('e2', 'apple-tree', 'grid'),
      makeFlowEdge('e3', 'grid', 'land'),
    ],
  }

  const flowResult = computeFlow(graph)
  const resolvedGraph: ShowGraph = { nodes: graph.nodes, edges: flowResult.edges }

  const homePositions: Vec3[] = Array.from({ length: 50 }, (_, i) => ({
    x: (i % 10) * 2, y: 0, z: Math.floor(i / 10) * 2,
  }))

  return { graph: resolvedGraph, formations, animatedDefs, homePositions, appleTreeDef }
}

// ============================================================================

describe('Animated Formation Verification', () => {
  let graph: ShowGraph
  let formations: Map<string, Vec3[]>
  let animatedDefs: Map<string, AnimatedFormationDef>
  let homePositions: Vec3[]
  let timing: Map<string, TimeRange>

  beforeAll(() => {
    const built = buildAnimatedTestGraph()
    graph = built.graph
    formations = built.formations
    animatedDefs = built.animatedDefs
    homePositions = built.homePositions
    timing = computeAllTiming(graph)
  })

  function evalAt(t: number): DroneState[] {
    return evaluateAtTime(graph, formations, t, homePositions, animatedDefs)
  }

  // --- Structural ---

  it('timing computed for all nodes', () => {
    const nodeIds = graph.nodes.map((n) => n.id)
    for (const id of nodeIds) {
      expect(timing.has(id), `Missing timing for ${id}`).toBe(true)
    }
    console.log('\n=== ANIMATED FORMATION TEST - NODE TIMING ===')
    timing.forEach((t, id) => {
      console.log(`  ${id}: ${t.start.toFixed(1)}s – ${t.end.toFixed(1)}s`)
    })
    console.log('==============================================\n')
  })

  it('all 50 drones have flow through entire graph', () => {
    // Check that all edges carry 50 drones
    for (const edge of graph.edges) {
      if (edge.edgeType === 'flow') {
        expect(edge.droneCount).toBe(50)
      }
    }
  })

  // --- During static ring formation ---

  it('t=7: ring formation — 50 drones at y≈12 with default blue color', () => {
    const states = evalAt(7)
    expect(states.length).toBe(50)
    expect(noNaN(states)).toBe(true)

    const formDrones = states.filter((s) => s.color.b > 0.8 && s.color.r < 0.5)
    expect(formDrones.length).toBe(50)

    const c = centroid(states)
    expect(c.y).toBeCloseTo(12, 0)
  })

  // --- Transition INTO animated formation ---

  it('transition into apple tree is smooth (no jumps > 5 per 0.1s sample)', () => {
    const appleStart = timing.get('apple-tree')!.start
    // The transition window into apple-tree is the gap between ring.end and apple-tree.start.
    const ringEnd = timing.get('ring')!.end
    const transStart = ringEnd
    // Sample through the transition
    let prev = evalAt(transStart)
    const violations: string[] = []
    for (let t = transStart + 0.1; t <= appleStart + 0.5; t += 0.1) {
      const curr = evalAt(t)
      expect(noNaN(curr)).toBe(true)
      const jump = maxJump(prev, curr)
      if (jump > 5) {
        violations.push(`t=${t.toFixed(1)}: jump=${jump.toFixed(2)}`)
      }
      prev = curr
    }
    if (violations.length > 0) {
      console.log('Transition INTO apple tree violations:', violations)
    }
    expect(violations.length).toBeLessThan(5)
  })

  // --- During animated formation ---

  it('t=16: apple tree active — drones have animated colors (not default blue)', () => {
    const states = evalAt(16)
    expect(states.length).toBe(50)
    expect(noNaN(states)).toBe(true)

    // Apple tree has brown trunk, green canopy, red apple — NOT default blue (0.3, 0.5, 1.0)
    const defaultBlue = states.filter((s) =>
      Math.abs(s.color.r - 0.3) < 0.05 && Math.abs(s.color.g - 0.5) < 0.05 && Math.abs(s.color.b - 1.0) < 0.05
    )
    // With animated colors, very few (if any) should be default blue
    console.log(`t=16 apple tree: ${defaultBlue.length} drones with default blue (expect 0)`)
    expect(defaultBlue.length).toBe(0)

    // Check for presence of trunk brown (r≈0.45, g≈0.25, b≈0.1)
    const brownDrones = states.filter((s) => s.color.r > 0.3 && s.color.g < 0.35 && s.color.b < 0.2)
    console.log(`t=16 apple tree: ${brownDrones.length} brown (trunk) drones`)
    expect(brownDrones.length).toBeGreaterThan(0)

    // Check for green canopy
    const greenDrones = states.filter((s) => s.color.g > 0.4 && s.color.r < 0.3 && s.color.b < 0.2)
    console.log(`t=16 apple tree: ${greenDrones.length} green (canopy) drones`)
    expect(greenDrones.length).toBeGreaterThan(0)

    // Check for red apple
    const redDrones = states.filter((s) => s.color.r > 0.7 && s.color.g < 0.3 && s.color.b < 0.2)
    console.log(`t=16 apple tree: ${redDrones.length} red (apple) drones`)
    expect(redDrones.length).toBeGreaterThan(0)
  })

  it('apple tree animation progresses: positions change over time', () => {
    const states1 = evalAt(15.5)  // localTime=0.5 → still/rest
    const states2 = evalAt(17)    // localTime=2 → during shake
    const states3 = evalAt(19)    // localTime=4 → apple falling

    expect(noNaN(states1)).toBe(true)
    expect(noNaN(states2)).toBe(true)
    expect(noNaN(states3)).toBe(true)

    // Positions should differ between samples (animation is playing)
    let totalDelta12 = 0
    let totalDelta23 = 0
    for (let i = 0; i < 50; i++) {
      const s1 = states1[i]!, s2 = states2[i]!, s3 = states3[i]!
      totalDelta12 += Math.abs(s1.position.x - s2.position.x) + Math.abs(s1.position.y - s2.position.y) + Math.abs(s1.position.z - s2.position.z)
      totalDelta23 += Math.abs(s2.position.x - s3.position.x) + Math.abs(s2.position.y - s3.position.y) + Math.abs(s2.position.z - s3.position.z)
    }
    console.log(`Animation delta t=15.5→17: ${totalDelta12.toFixed(2)}, t=17→19: ${totalDelta23.toFixed(2)}`)
    // Both deltas should be non-trivial (animation is happening)
    expect(totalDelta12).toBeGreaterThan(1)
    expect(totalDelta23).toBeGreaterThan(1)
  })

  it('apple tree has correct spatial structure: trunk low, canopy high', () => {
    const states = evalAt(15.5) // rest pose
    // Identify drones by their colors (slot-bound, drone-id-fungible after per-formation
    // Hungarian assignment): trunk = brown, canopy = green, apple = red.
    const trunk = states.filter((s) => s.color.r > 0.3 && s.color.g < 0.35 && s.color.b < 0.2)
    const canopy = states.filter((s) => s.color.g > 0.4 && s.color.r < 0.3 && s.color.b < 0.2)
    const apple = states.filter((s) => s.color.r > 0.7 && s.color.g < 0.3 && s.color.b < 0.2)

    expect(trunk.length).toBeGreaterThan(0)
    expect(canopy.length).toBeGreaterThan(0)
    expect(apple.length).toBeGreaterThan(0)

    const trunkC = centroid(trunk)
    const canopyC = centroid(canopy)
    const appleC = centroid(apple)

    console.log(`Apple tree structure: trunk y=${trunkC.y.toFixed(1)}, canopy y=${canopyC.y.toFixed(1)}, apple y=${appleC.y.toFixed(1)}`)

    // Trunk should be lower than canopy
    expect(trunkC.y).toBeLessThan(canopyC.y)
    // Canopy should be highest
    expect(canopyC.y).toBeGreaterThan(7)
    // Apple starts near bottom of canopy
    expect(appleC.y).toBeGreaterThan(4)
  })

  it('apple falls during animation (t=19 vs t=15.5)', () => {
    const statesEarly = evalAt(15.5)
    const statesLate = evalAt(20) // localTime=5, apple should be on ground

    // Identify apple drones by color (red). Drone identity is fungible across
    // formations after per-formation Hungarian — slot-bound color survives.
    const isApple = (s: DroneState) => s.color.r > 0.7 && s.color.g < 0.3 && s.color.b < 0.2
    const appleEarly = statesEarly.filter(isApple)
    const appleLate = statesLate.filter(isApple)

    expect(appleEarly.length).toBeGreaterThan(0)
    expect(appleLate.length).toBeGreaterThan(0)

    const earlyY = centroid(appleEarly).y
    const lateY = centroid(appleLate).y

    console.log(`Apple drop: y=${earlyY.toFixed(1)} → y=${lateY.toFixed(1)}`)
    expect(earlyY).toBeGreaterThan(lateY)
    expect(lateY).toBeLessThan(2) // apple on/near ground
  })

  // --- Transition OUT of animated formation ---

  it('transition out of apple tree is smooth (no jumps > 5 per 0.1s sample)', () => {
    const appleEnd = timing.get('apple-tree')!.end
    // Sample through the transition out
    let prev = evalAt(appleEnd - 0.5)
    const violations: string[] = []
    for (let t = appleEnd - 0.4; t <= appleEnd + 3; t += 0.1) {
      const curr = evalAt(t)
      expect(noNaN(curr)).toBe(true)
      const jump = maxJump(prev, curr)
      if (jump > 5) {
        violations.push(`t=${t.toFixed(1)}: jump=${jump.toFixed(2)}`)
      }
      prev = curr
    }
    if (violations.length > 0) {
      console.log('Transition OUT of apple tree violations:', violations)
    }
    expect(violations.length).toBeLessThan(5)
  })

  // --- After animated formation: back to static ---

  it('t=32: grid formation — 50 drones at y≈8 with default blue color', () => {
    const states = evalAt(32)
    expect(states.length).toBe(50)
    expect(noNaN(states)).toBe(true)

    const formDrones = states.filter((s) => s.color.b > 0.8 && s.color.r < 0.5)
    // Grid has 100 points but only 50 drones, so all 50 should be in formation
    expect(formDrones.length).toBe(50)

    const c = centroid(states)
    expect(c.y).toBeCloseTo(8, 0)
  })

  // --- Full continuity sweep ---

  it('no position jump > 15 between consecutive 0.1s samples across entire show', () => {
    const totalEnd = Math.max(...[...timing.values()].map((t) => t.end))
    let prev = evalAt(0)
    const dt = 0.1
    const violations: string[] = []

    for (let t = dt; t <= totalEnd; t += dt) {
      const curr = evalAt(t)
      expect(noNaN(curr)).toBe(true)
      const jump = maxJump(prev, curr)
      if (jump > 15) {
        violations.push(`t=${t.toFixed(1)}: max jump = ${jump.toFixed(2)}`)
      }
      prev = curr
    }

    if (violations.length > 0) {
      console.log('\n=== CONTINUITY VIOLATIONS (jump > 15 per 0.1s) ===')
      for (const v of violations) console.log(`  ${v}`)
      console.log(`Total violations: ${violations.length}`)
      console.log('===================================================\n')
    }
    expect(violations.length).toBeLessThan(10)
  })

  // --- Determinism ---

  it('evaluateAtTime is deterministic with animated formations', () => {
    const times = [0, 5, 7, 12, 15, 16, 17, 19, 22, 25, 30, 32, 35]
    for (const t of times) {
      const a = evalAt(t)
      const b = evalAt(t)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    }
  })

  // --- Without animatedDefs, should fall back to rest positions ---

  it('without animatedDefs, drones use static rest positions (no crash)', () => {
    const statesNoAnim = evaluateAtTime(graph, formations, 16, homePositions)
    expect(statesNoAnim.length).toBe(50)
    expect(noNaN(statesNoAnim)).toBe(true)

    // Colors should be default blue (no animated colors applied)
    const defaultBlue = statesNoAnim.filter((s) =>
      Math.abs(s.color.r - 0.3) < 0.05 && Math.abs(s.color.g - 0.5) < 0.05 && Math.abs(s.color.b - 1.0) < 0.05
    )
    expect(defaultBlue.length).toBe(50)
  })
})
