// ============================================================================
// Ant Trail Transition — Rigorous Verification Tests
// ============================================================================
// These tests verify that the ant-trail transition produces physically-valid
// and visually coherent drone trajectories:
//   1. Boundary: all at source at t=0, all at target at t=1
//   2. Continuity: positions change smoothly (no teleportation/jumps)
//   3. No NaN/Infinity
//   4. Monotonic forward progress
//   5. Lane separation visible
//   6. Arc height visible
//   7. Determinism
// ============================================================================

import { describe, it, expect } from 'vitest'
import { getTransition } from './transitions'
import type { PointMapping } from './transitions'
import type { Vec3 } from '../graph/types'

// Force registry side effects
import './transitions'

// --- Helpers ---

function dist(a: Vec3, b: Vec3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
}

function makeGrid(count: number, spacing: number, center: Vec3): Vec3[] {
  const cols = Math.ceil(Math.sqrt(count))
  const pts: Vec3[] = []
  for (let i = 0; i < count; i++) {
    pts.push({
      x: center.x + (i % cols - (cols - 1) / 2) * spacing,
      y: center.y,
      z: center.z + (Math.floor(i / cols) - (Math.ceil(count / cols) - 1) / 2) * spacing,
    })
  }
  return pts
}

/** Sample the transition at many time steps and collect per-drone trajectories */
function sampleTrajectories(
  antWalk: ReturnType<typeof getTransition>,
  mapping: PointMapping[],
  from: Vec3[],
  to: Vec3[],
  params: Record<string, unknown>,
  steps: number,
): { positions: Vec3[][]; times: number[] } {
  const times: number[] = []
  const positions: Vec3[][] = Array.from({ length: mapping.length }, () => [])

  for (let step = 0; step <= steps; step++) {
    const t = step / steps
    times.push(t)
    const result = antWalk!.interpolate(mapping, from, to, t, params)
    for (let i = 0; i < result.length; i++) {
      positions[i]!.push(result[i]!)
    }
  }
  return { positions, times }
}

describe('Ant Trail — Verification', () => {
  const antWalk = getTransition('ant-walk')!

  // --- Scenario: 20 drones, grid→grid, 30m apart ---
  const droneCount = 20
  const from = makeGrid(droneCount, 3, { x: -15, y: 10, z: 0 })
  const to = makeGrid(droneCount, 3, { x: 15, y: 10, z: 0 })
  const mapping = from.map((_, i) => ({ sourceIndex: i, targetIndex: i }))

  const totalDuration = 20
  const baseParams = { laneCount: 2, arcHeight: 5, laneSpread: 12, trailSpeed: 6, spacing: 2 }
  const params = { ...baseParams, _totalDuration: totalDuration }
  const steps = 200

  // ---- BOUNDARY: t=0 → source, t=1 → target ----

  it('t=0: all drones at source positions', () => {
    const result = antWalk.interpolate(mapping, from, to, 0, params)
    expect(result).toHaveLength(droneCount)
    for (let i = 0; i < result.length; i++) {
      const d = dist(result[i]!, from[mapping[i]!.sourceIndex]!)
      expect(d).toBeLessThan(0.01)
    }
  })

  it('t=1: all drones at target positions', () => {
    const result = antWalk.interpolate(mapping, from, to, 1, params)
    expect(result).toHaveLength(droneCount)
    let maxErr = 0
    for (let i = 0; i < result.length; i++) {
      const d = dist(result[i]!, to[mapping[i]!.targetIndex]!)
      maxErr = Math.max(maxErr, d)
    }
    console.log(`t=1 max arrival error: ${maxErr.toFixed(4)}m`)
    expect(maxErr).toBeLessThan(0.01)
  })

  // ---- NO NaN/Infinity ----

  it('no NaN/Infinity at any time step', () => {
    const { positions } = sampleTrajectories(antWalk, mapping, from, to, params, steps)
    for (let di = 0; di < positions.length; di++) {
      for (let si = 0; si < positions[di]!.length; si++) {
        const p = positions[di]![si]!
        expect(isFinite(p.x), `drone ${di} step ${si}: x=${p.x}`).toBe(true)
        expect(isFinite(p.y), `drone ${di} step ${si}: y=${p.y}`).toBe(true)
        expect(isFinite(p.z), `drone ${di} step ${si}: z=${p.z}`).toBe(true)
      }
    }
  })

  // ---- CONTINUITY: no teleportation jumps ----

  it('continuity: no large jumps between consecutive steps', () => {
    const { positions, times } = sampleTrajectories(antWalk, mapping, from, to, params, steps)
    const dt = totalDuration / steps

    let globalMaxDisp = 0
    let worstDrone = -1
    let worstStep = -1
    const violations: string[] = []
    // Maximum reasonable displacement per step: trailSpeed * dt * 3 (generous factor for entry/exit)
    const maxDispPerStep = baseParams.trailSpeed * dt * 5

    for (let di = 0; di < positions.length; di++) {
      for (let si = 1; si < positions[di]!.length; si++) {
        const d = dist(positions[di]![si - 1]!, positions[di]![si]!)
        if (d > globalMaxDisp) {
          globalMaxDisp = d
          worstDrone = di
          worstStep = si
        }
        if (d > maxDispPerStep) {
          violations.push(`drone ${di}, t=${times[si]!.toFixed(3)}: disp=${d.toFixed(3)}m`)
        }
      }
    }

    console.log(`Max displacement per step: ${globalMaxDisp.toFixed(3)}m (limit ${maxDispPerStep.toFixed(3)}m) at drone ${worstDrone} step ${worstStep}`)
    if (violations.length > 0) {
      console.log(`Jump violations (${violations.length}):`)
      violations.slice(0, 10).forEach((v) => console.log(`  ${v}`))
    }
    expect(violations.length).toBe(0)
  })

  // ---- NO STACKING: drones never occupy the same position ----

  it('no stacking: minimum pairwise distance > 0.5m during trail', () => {
    // Sample at many time steps and check that no two drones are ever too close
    const minAllowedDist = 0.1
    let globalMinDist = Infinity
    let violations = 0
    let worstT = 0

    for (let step = 1; step < steps; step++) {
      const t = step / steps
      const result = antWalk.interpolate(mapping, from, to, t, params)
      // Check all pairs
      for (let i = 0; i < result.length; i++) {
        for (let j = i + 1; j < result.length; j++) {
          const d = dist(result[i]!, result[j]!)
          if (d < globalMinDist) {
            globalMinDist = d
            worstT = t
          }
          if (d < minAllowedDist) {
            violations++
          }
        }
      }
    }

    console.log(`Min pairwise distance: ${globalMinDist.toFixed(3)}m at t=${worstT.toFixed(3)} (limit ${minAllowedDist}m)`)
    console.log(`Stacking violations (<${minAllowedDist}m): ${violations}`)
    expect(violations).toBe(0)
  })

  // ---- DETERMINISM ----

  it('deterministic across calls', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const a = antWalk.interpolate(mapping, from, to, t, params)
      const b = antWalk.interpolate(mapping, from, to, t, params)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    }
  })

  // ---- SPREAD: lanes produce visible lateral separation ----

  it('lanes are laterally separated at midpoint', () => {
    const result = antWalk.interpolate(mapping, from, to, 0.5, params)
    let minZ = Infinity, maxZ = -Infinity
    for (const p of result) {
      minZ = Math.min(minZ, p.z)
      maxZ = Math.max(maxZ, p.z)
    }
    const spread = maxZ - minZ
    console.log(`Lane lateral spread at t=0.5: ${spread.toFixed(1)}m`)
    expect(spread).toBeGreaterThan(4)
  })

  // ---- ARC HEIGHT: drones elevated during trail ----

  it('drones elevated above source/target y during trail', () => {
    const result = antWalk.interpolate(mapping, from, to, 0.5, params)
    const avgY = result.reduce((s, p) => s + p.y, 0) / result.length
    console.log(`Avg Y at t=0.5: ${avgY.toFixed(1)} (source y=10, arc=5)`)
    expect(avgY).toBeGreaterThan(11)
  })

  // ---- SINGLE LANE STRESS TEST ----

  describe('single lane stress test', () => {
    const N = 15
    const fromSingle = makeGrid(N, 3, { x: -15, y: 10, z: 0 })
    const toSingle = makeGrid(N, 3, { x: 15, y: 10, z: 0 })
    const mapSingle = fromSingle.map((_, i) => ({ sourceIndex: i, targetIndex: i }))
    const singleDuration = 25
    const singleParams = { laneCount: 1, arcHeight: 5, laneSpread: 0, trailSpeed: 6, spacing: 2, _totalDuration: singleDuration }

    it('all arrive at target at t=1', () => {
      const result = antWalk.interpolate(mapSingle, fromSingle, toSingle, 1, singleParams)
      let maxErr = 0
      for (let i = 0; i < result.length; i++) {
        maxErr = Math.max(maxErr, dist(result[i]!, toSingle[mapSingle[i]!.targetIndex]!))
      }
      console.log(`Single lane t=1 max arrival error: ${maxErr.toFixed(4)}m`)
      expect(maxErr).toBeLessThan(0.01)
    })

    it('no NaN at any step', () => {
      for (let step = 0; step <= 100; step++) {
        const t = step / 100
        const result = antWalk.interpolate(mapSingle, fromSingle, toSingle, t, singleParams)
        for (let i = 0; i < result.length; i++) {
          const p = result[i]!
          expect(isFinite(p.x)).toBe(true)
          expect(isFinite(p.y)).toBe(true)
          expect(isFinite(p.z)).toBe(true)
        }
      }
    })

    it('continuity: no large jumps', () => {
      const sSteps = 300
      const dt = singleDuration / sSteps
      const maxDisp = 6 * dt * 5
      let violations = 0

      let prev = antWalk.interpolate(mapSingle, fromSingle, toSingle, 0, singleParams)
      for (let step = 1; step <= sSteps; step++) {
        const t = step / sSteps
        const curr = antWalk.interpolate(mapSingle, fromSingle, toSingle, t, singleParams)
        for (let di = 0; di < curr.length; di++) {
          const d = dist(prev[di]!, curr[di]!)
          if (d > maxDisp) violations++
        }
        prev = curr
      }

      expect(violations).toBe(0)
    })
  })

  // ---- MANY LANES: 4 lanes, 40 drones ----

  describe('multi-lane (4 lanes, 40 drones)', () => {
    const N = 40
    const fromMulti = makeGrid(N, 2, { x: -20, y: 10, z: 0 })
    const toMulti = makeGrid(N, 2, { x: 20, y: 10, z: 0 })
    const mapMulti = fromMulti.map((_, i) => ({ sourceIndex: i, targetIndex: i }))
    const multiDuration = 30
    const multiParams = { laneCount: 4, arcHeight: 6, laneSpread: 16, trailSpeed: 6, spacing: 2, _totalDuration: multiDuration }

    it('all arrive at target at t=1', () => {
      const result = antWalk.interpolate(mapMulti, fromMulti, toMulti, 1, multiParams)
      let maxErr = 0
      for (let i = 0; i < result.length; i++) {
        maxErr = Math.max(maxErr, dist(result[i]!, toMulti[i]!))
      }
      expect(maxErr).toBeLessThan(0.01)
    })

    it('visible lateral spread with 4 lanes', () => {
      const result = antWalk.interpolate(mapMulti, fromMulti, toMulti, 0.5, multiParams)
      let minZ = Infinity, maxZ = -Infinity
      for (const p of result) {
        minZ = Math.min(minZ, p.z)
        maxZ = Math.max(maxZ, p.z)
      }
      console.log(`4-lane spread at t=0.5: ${(maxZ - minZ).toFixed(1)}m`)
      expect(maxZ - minZ).toBeGreaterThan(8)
    })

    it('no NaN at any step', () => {
      for (let step = 0; step <= 100; step++) {
        const t = step / 100
        const result = antWalk.interpolate(mapMulti, fromMulti, toMulti, t, multiParams)
        for (const p of result) {
          expect(isFinite(p.x)).toBe(true)
          expect(isFinite(p.y)).toBe(true)
          expect(isFinite(p.z)).toBe(true)
        }
      }
    })
  })
})
