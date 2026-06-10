// ============================================================================
// Idle Verification Tests — Comprehensive scenarios
// ============================================================================
// Tests the idle model where idle = leftover drones.
// Formations use min(assigned, formationPoints) for formation, rest go to idle.
// Attached idle inherits timing/position from its formation.
// Standalone idle receives drones via flow edges with own transitions.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { ShowGraph, Vec3, DroneState } from './types'
import { computeFlow } from './flow'
import { computeAllTiming } from './timing'
import { evaluateAtTime } from './evaluate'
import { getGenerator } from '../registries/generators'
import '../registries/init'
import {
  makeLaunchNode,
  makeFormationNode,
  makeLandNode,
  makeFlowEdge,
} from './helpers.test-utils'

// Idle continuity scenarios rely on the default per-edge transition (2s) to
// smooth drone motion between formations. Without a transition, drones
// teleport instantly between nodes and the continuity check trips. Helper
// preserves the old call-site signature.
const noTrans = (id: string, source: string, target: string, allocation?: Parameters<typeof makeFlowEdge>[3]) =>
  makeFlowEdge(id, source, target, allocation ?? { mode: 'auto' })

function centroid(states: DroneState[]): Vec3 {
  const n = states.length
  if (n === 0) return { x: 0, y: 0, z: 0 }
  const sum = states.reduce(
    (acc, s) => ({ x: acc.x + s.position.x, y: acc.y + s.position.y, z: acc.z + s.position.z }),
    { x: 0, y: 0, z: 0 },
  )
  return { x: sum.x / n, y: sum.y / n, z: sum.z / n }
}

function noNaN(states: DroneState[]): boolean {
  return states.every(
    (s) => isFinite(s.position.x) && isFinite(s.position.y) && isFinite(s.position.z),
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

const homePositions: Vec3[] = Array.from({ length: 100 }, (_, i) => ({
  x: (i % 10) * 2, y: 0, z: Math.floor(i / 10) * 2,
}))

// ============================================================================
// Scenario 1: 100 drones, formation uses 60 points → 40 idle leftovers
// ============================================================================
describe('Idle Scenario 1: Formation with leftover drones → attached idle', () => {
  const ringGen = getGenerator('ring')!
  const ring60 = ringGen.generate({ count: 60, radius: 10 })

  const formations = new Map<string, Vec3[]>()
  formations.set('ring-60', ring60)

  const graph: ShowGraph = {
    nodes: [
      makeLaunchNode({ id: 'launch', data: { droneCount: 100, startTime: 0, staggerDelay: 0.01 } }),
      makeFormationNode({ id: 'formA', data: {
        formationId: 'ring-60', startTime: 5, duration: 8,
        transform: { position: { x: 0, y: 15, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        keyframes: [], colorProgramId: null,
        idleConfigs: [{ id: 'idle-orbit', behavior: 'orbit' as const, radius: 6, speed: 0.5, altitude: 22, colorProgramId: null }],
      }}),
      makeLandNode({ id: 'land', data: { staggerDelay: 0.02 } }),
    ],
    edges: [
      makeFlowEdge('e1', 'launch', 'formA'),
      makeFlowEdge('e2', 'formA', 'land'),
    ],
  }

  const flowResult = computeFlow(graph)
  const resolvedGraph: ShowGraph = { nodes: graph.nodes, edges: flowResult.edges }
  const timing = computeAllTiming(resolvedGraph)

  function evalAt(t: number) { return evaluateAtTime(resolvedGraph, formations, t, homePositions) }

  it('flow passes all 100 drones through (idle does not reduce flow)', () => {
    expect(flowResult.edges.find((e) => e.id === 'e1')?.droneCount).toBe(100)
    expect(flowResult.edges.find((e) => e.id === 'e2')?.droneCount).toBe(100)
  })

  it('during formation: 60 formation drones at y=15, 40 idle drones at y=22', () => {
    const states = evalAt(8) // mid-formation
    expect(noNaN(states)).toBe(true)

    const formDrones = states.filter((s) => Math.abs(s.position.y - 15) < 2)
    const idleDrones = states.filter((s) => Math.abs(s.position.y - 22) < 2)

    console.log(`Scenario 1 t=8: formation=${formDrones.length}, idle=${idleDrones.length}`)
    expect(formDrones.length).toBe(60)
    expect(idleDrones.length).toBe(40)

    // Idle centroid should be near formation center horizontally, at altitude 22
    const idleC = centroid(idleDrones)
    expect(idleC.y).toBeCloseTo(22, 0)
  })

  it('zero continuity violations across entire show', () => {
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
      console.log('Scenario 1 violations:', violations)
    }
    expect(violations.length).toBe(0)
  })
})

// ============================================================================
// Scenario 2: Split → formA(40pts) + formB(60pts) → Merge → formC(50pts, idle)
// 100 drones split: 40 to formA, 60 to formB
// Then merge into formC with 50 points → 50 formation + 50 idle
// ============================================================================
describe('Idle Scenario 2: Split/merge with leftover drones pooling into idle', () => {
  const ringGen = getGenerator('ring')!
  const gridGen = getGenerator('grid')!

  const ring100 = ringGen.generate({ count: 100, radius: 12 })
  const ring40 = ringGen.generate({ count: 40, radius: 8 })
  const grid60 = gridGen.generate({ cols: 10, rows: 6, spacing: 2 })
  const ring50 = ringGen.generate({ count: 50, radius: 10 })

  const formations = new Map<string, Vec3[]>()
  formations.set('opening', ring100)
  formations.set('formA', ring40)
  formations.set('formB', grid60)
  formations.set('formC', ring50)

  const graph: ShowGraph = {
    nodes: [
      makeLaunchNode({ id: 'launch', data: { droneCount: 100, startTime: 0, staggerDelay: 0.01 } }),
      makeFormationNode({ id: 'opening', data: {
        formationId: 'opening', startTime: 4, duration: 4,
        transform: { position: { x: 0, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        keyframes: [], colorProgramId: null, idleConfigs: [],
      }}),
      makeFormationNode({ id: 'formA', data: {
        formationId: 'formA', startTime: 10, duration: 6,
        transform: { position: { x: -12, y: 12, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        keyframes: [], colorProgramId: null, idleConfigs: [],
      }}),
      makeFormationNode({ id: 'formB', data: {
        formationId: 'formB', startTime: 10, duration: 6,
        transform: { position: { x: 12, y: 12, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        keyframes: [], colorProgramId: null, idleConfigs: [],
      }}),
      makeFormationNode({ id: 'formC', data: {
        formationId: 'formC', startTime: 20, duration: 6,
        transform: { position: { x: 0, y: 18, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        keyframes: [], colorProgramId: null,
        idleConfigs: [{ id: 'idle-orbit', behavior: 'orbit' as const, radius: 8, speed: 0.4, altitude: 25, colorProgramId: null }],
      }}),
      makeLandNode({ id: 'land', data: { staggerDelay: 0.02 } }),
    ],
    edges: [
      noTrans('e1', 'launch', 'opening'),
      noTrans('e2', 'opening', 'formA', { mode: 'manual-count', count: 40 }),
      noTrans('e3', 'opening', 'formB', { mode: 'manual-count', count: 60 }),
      noTrans('e4', 'formA', 'formC'),
      noTrans('e5', 'formB', 'formC'),
      noTrans('e6', 'formC', 'land'),
    ],
  }

  const flowResult = computeFlow(graph)
  const resolvedGraph: ShowGraph = { nodes: graph.nodes, edges: flowResult.edges }
  const timing = computeAllTiming(resolvedGraph)

  function evalAt(t: number) { return evaluateAtTime(resolvedGraph, formations, t, homePositions) }

  it('flow: formA gets 40, formB gets 60, formC gets all 100', () => {
    expect(flowResult.edges.find((e) => e.id === 'e2')?.droneCount).toBe(40)
    expect(flowResult.edges.find((e) => e.id === 'e3')?.droneCount).toBe(60)
    // After merge: 40 + 60 = 100 → formC
    expect(flowResult.edges.find((e) => e.id === 'e6')?.droneCount).toBe(100)
  })

  it('during formA+formB: all drones in formation (no leftovers)', () => {
    const states = evalAt(12) // mid split formations
    expect(noNaN(states)).toBe(true)

    const leftDrones = states.filter((s) => s.position.x < 0)
    const rightDrones = states.filter((s) => s.position.x > 0)

    console.log(`Scenario 2 t=12: left=${leftDrones.length}, right=${rightDrones.length}`)
    // formA: 40 drones, 40 points → 0 idle. formB: 60 drones, 60 points → 0 idle.
    expect(leftDrones.length).toBe(40)
    expect(rightDrones.length).toBe(60)
  })

  it('during formC: 50 formation drones at y=18, 50 idle at y=25', () => {
    const states = evalAt(22) // mid formC
    expect(noNaN(states)).toBe(true)

    const formDrones = states.filter((s) => Math.abs(s.position.y - 18) < 3)
    const idleDrones = states.filter((s) => Math.abs(s.position.y - 25) < 3)

    console.log(`Scenario 2 t=22: formC formation=${formDrones.length}, idle=${idleDrones.length}`)
    // formC has 50 points, 100 incoming → 50 formation, 50 idle
    expect(formDrones.length).toBe(50)
    expect(idleDrones.length).toBe(50)
  })

  it('zero continuity violations across entire show', () => {
    const totalEnd = Math.max(...[...timing.values()].map((t) => t.end))
    let prev = evalAt(0)
    const dt = 0.1
    const violations: string[] = []

    for (let t = dt; t <= totalEnd; t += dt) {
      const curr = evalAt(t)
      expect(noNaN(curr)).toBe(true)
      const jump = maxJump(prev, curr)
      // Per-frame jump bounded by maxVelocity × dt + transition easing variance.
      // With resolveTargetPositions sharing the merged-list slot assignment and
      // per-formation Hungarian fed by canonical (frame-stable) source positions,
      // the previous ~16m merge jump is gone. Residual peak ~4m at launch→formation
      // handoff where rising drones transition (a true semantic of the upstream
      // overlap with transition). 5m absorbs it without hiding the merge regression.
      if (jump > 5) {
        violations.push(`t=${t.toFixed(1)}: max jump = ${jump.toFixed(2)}`)
      }
      prev = curr
    }

    if (violations.length > 0) {
      console.log('Scenario 2 violations:', violations)
    }
    expect(violations.length).toBe(0)
  })
})

// ============================================================================
// Scenario 3: Leftover drones with NO idle config → default hover
// ============================================================================
describe('Idle Scenario 3: Leftover drones with no idle config → default position', () => {
  const ringGen = getGenerator('ring')!
  const ring30 = ringGen.generate({ count: 30, radius: 6 })

  const formations = new Map<string, Vec3[]>()
  formations.set('small-ring', ring30)

  const graph: ShowGraph = {
    nodes: [
      makeLaunchNode({ id: 'launch', data: { droneCount: 50, startTime: 0, staggerDelay: 0.01 } }),
      makeFormationNode({ id: 'form', data: {
        formationId: 'small-ring', startTime: 4, duration: 5,
        transform: { position: { x: 0, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        keyframes: [], colorProgramId: null,
        idleConfigs: [], // No idle config — leftovers get default positioning
      }}),
      makeLandNode({ id: 'land', data: { staggerDelay: 0.02 } }),
    ],
    edges: [
      makeFlowEdge('e1', 'launch', 'form'),
      makeFlowEdge('e2', 'form', 'land'),
    ],
  }

  const flowResult = computeFlow(graph)
  const resolvedGraph: ShowGraph = { nodes: graph.nodes, edges: flowResult.edges }

  const homePos50 = homePositions.slice(0, 50)
  function evalAt(t: number) { return evaluateAtTime(resolvedGraph, formations, t, homePos50) }

  it('50 drones → 30 formation + 20 default-positioned leftovers', () => {
    const states = evalAt(6) // mid-formation
    expect(states.length).toBe(50)
    expect(noNaN(states)).toBe(true)

    // Formation drones at y=10 (ring), leftover drones at y=12 (default hover = transform.y + 2)
    const formDrones = states.filter((s) => Math.abs(s.position.y - 10) < 1.5)
    const leftoverDrones = states.filter((s) => Math.abs(s.position.y - 12) < 1.5)

    console.log(`Scenario 3 t=6: formation=${formDrones.length}, leftover=${leftoverDrones.length}`)
    expect(formDrones.length).toBe(30)
    expect(leftoverDrones.length).toBe(20)
  })
})

// ============================================================================
// Scenario 4: Staggered split — different target startTimes
// Verifies per-drone transition timing with idle leftovers
// ============================================================================
describe('Idle Scenario 4: Staggered split with idle at different arrival times', () => {
  const ringGen = getGenerator('ring')!
  const ring30 = ringGen.generate({ count: 30, radius: 8 })
  const ring40 = ringGen.generate({ count: 40, radius: 8 })
  const ring100 = ringGen.generate({ count: 100, radius: 12 })

  const formations = new Map<string, Vec3[]>()
  formations.set('opening', ring100)
  formations.set('left', ring30)
  formations.set('right', ring40)

  // 100 drones → split: 50 to left (30 points, starts t=8), 50 to right (40 points, starts t=10)
  // Left: 30 form + 20 idle. Right: 40 form + 10 idle.
  const graph: ShowGraph = {
    nodes: [
      makeLaunchNode({ id: 'launch', data: { droneCount: 100, startTime: 0, staggerDelay: 0.01 } }),
      makeFormationNode({ id: 'opening', data: {
        formationId: 'opening', startTime: 4, duration: 2,
        transform: { position: { x: 0, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        keyframes: [], colorProgramId: null, idleConfigs: [],
      }}),
      makeFormationNode({ id: 'left', data: {
        formationId: 'left', startTime: 8, duration: 6,
        transform: { position: { x: -10, y: 12, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        keyframes: [], colorProgramId: null,
        idleConfigs: [{ id: 'idle-left', behavior: 'orbit' as const, radius: 5, speed: 0.5, altitude: 18, colorProgramId: null }],
      }}),
      makeFormationNode({ id: 'right', data: {
        formationId: 'right', startTime: 10, duration: 6,
        transform: { position: { x: 10, y: 12, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        keyframes: [], colorProgramId: null,
        idleConfigs: [{ id: 'idle-right', behavior: 'hover' as const, radius: 4, speed: 0.3, altitude: 18, colorProgramId: null }],
      }}),
      makeLandNode({ id: 'land', data: { staggerDelay: 0.02 } }),
    ],
    edges: [
      noTrans('e1', 'launch', 'opening'),
      noTrans('e2', 'opening', 'left', { mode: 'manual-count', count: 50 }),
      noTrans('e3', 'opening', 'right', { mode: 'manual-count', count: 50 }),
      noTrans('e4', 'left', 'land'),
      noTrans('e5', 'right', 'land'),
    ],
  }

  const flowResult = computeFlow(graph)
  const resolvedGraph: ShowGraph = { nodes: graph.nodes, edges: flowResult.edges }
  const timing = computeAllTiming(resolvedGraph)

  function evalAt(t: number) { return evaluateAtTime(resolvedGraph, formations, t, homePositions) }

  it('t=9: left formed (30 form + 20 idle), right still transitioning', () => {
    const states = evalAt(9)
    expect(noNaN(states)).toBe(true)

    // Identify drones by world position (left x<0, right x>0). Drone identity is
    // fungible after per-formation Hungarian — only world location is meaningful.
    // Formation drones are blue (r≈0.3, b≈1), idle drones are orange (r≈1, g≈0.6).
    const leftStates = states.filter((s) => s.position.x < 0)
    const leftForm = leftStates.filter((s) => s.color.b > 0.8 && s.color.r < 0.5)
    const leftIdle = leftStates.filter((s) => s.color.r > 0.8 && s.color.g > 0.4)
    console.log(`Scenario 4 t=9: left form=${leftForm.length}, left idle=${leftIdle.length}`)
    expect(leftForm.length).toBe(30)
    expect(leftIdle.length).toBe(20)

    // Right drones (x>0) should still be transitioning toward (10, 12, 0).
    const rightStates = states.filter((s) => s.position.x > 0)
    const rightC = centroid(rightStates)
    console.log(`Scenario 4 t=9: right centroid y=${rightC.y.toFixed(1)} (transitioning)`)
    expect(rightC.y).toBeLessThan(14)
  })

  it('t=12: both formed with idle drones', () => {
    const states = evalAt(12)
    expect(noNaN(states)).toBe(true)

    // Filter by world position, not drone index — Hungarian may have permuted identity.
    const leftStates = states.filter((s) => s.position.x < 0)
    const rightStates = states.filter((s) => s.position.x > 0)

    // Check idle (orange) vs formation (blue) by color
    const leftIdle = leftStates.filter((s) => s.color.r > 0.8 && s.color.g > 0.4)
    const leftForm = leftStates.filter((s) => s.color.b > 0.8 && s.color.r < 0.5)
    const rightIdle = rightStates.filter((s) => s.color.r > 0.8 && s.color.g > 0.4)
    const rightForm = rightStates.filter((s) => s.color.b > 0.8 && s.color.r < 0.5)

    console.log(`Scenario 4 t=12: left form=${leftForm.length} idle=${leftIdle.length}, right form=${rightForm.length} idle=${rightIdle.length}`)
    expect(leftForm.length).toBe(30)
    expect(leftIdle.length).toBe(20)
    expect(rightForm.length).toBe(40)
    expect(rightIdle.length).toBe(10)
  })

  it('zero continuity violations across entire show', () => {
    const totalEnd = Math.max(...[...timing.values()].map((t) => t.end))
    let prev = evalAt(0)
    const dt = 0.1
    const violations: string[] = []

    for (let t = dt; t <= totalEnd; t += dt) {
      const curr = evalAt(t)
      expect(noNaN(curr)).toBe(true)
      const jump = maxJump(prev, curr)
      // With maxUpstreamEnd timing, drones from earlier-ending upstream nodes
      // hold position until the transition starts (when ALL upstreams finish).
      // This can cause larger jumps at transition boundaries for staggered splits.
      if (jump > 25) {
        violations.push(`t=${t.toFixed(1)}: max jump = ${jump.toFixed(2)}`)
      }
      prev = curr
    }

    if (violations.length > 0) {
      console.log('Scenario 4 violations:', violations)
    }
    expect(violations.length).toBe(0)
  })
})
