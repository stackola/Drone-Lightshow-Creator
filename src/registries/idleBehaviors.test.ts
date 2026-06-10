// ============================================================================
// Slice 1 Step 6: Idle behavior clamping verification.
// For behaviours that can produce illegal velocities, assert that
// clampToConstraints() returns params whose sampled peak velocity respects
// constraints.maxVelocity.
// ============================================================================

import { describe, it, expect, beforeAll } from 'vitest'
import { initRegistries } from './init'
import { getIdleBehavior, getAllIdleBehaviors, type IdleParams } from './idleBehaviors'
import { DEFAULT_TRANSITION_CONSTRAINTS } from './transitions'

beforeAll(() => initRegistries())

function peakSampledVelocity(behaviorId: string, params: IdleParams, droneCount: number, duration: number): number {
  const beh = getIdleBehavior(behaviorId)!
  const fps = 60
  const steps = Math.max(2, Math.ceil(duration * fps))
  const dt = duration / steps
  let peak = 0
  let prev = beh.getPosition(0, droneCount, 0, params, { x: 0, y: 0, z: 0 })
  for (let s = 1; s <= steps; s++) {
    const t = (s / steps) * duration
    const cur = beh.getPosition(0, droneCount, t, params, { x: 0, y: 0, z: 0 })
    const dx = cur.x - prev.x, dy = cur.y - prev.y, dz = cur.z - prev.z
    const v = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt
    if (v > peak) peak = v
    prev = cur
  }
  return peak
}

const PRESET_PARAMS: IdleParams = { center: { x: 0, y: 0, z: 0 }, radius: 10, speed: 5, altitude: 10 }

describe('Slice 1 Step 6: idle behavior clampToConstraints respects maxVelocity', () => {
  for (const beh of getAllIdleBehaviors()) {
    if (!beh.clampToConstraints) continue // hover has no clamp
    it(`${beh.id}: peak velocity after clamp ≤ maxVelocity × 1.10`, () => {
      const clamped = beh.clampToConstraints!(PRESET_PARAMS, DEFAULT_TRANSITION_CONSTRAINTS)
      const peak = peakSampledVelocity(beh.id, clamped.params, 20, 8)
      expect(peak).toBeLessThanOrEqual(DEFAULT_TRANSITION_CONSTRAINTS.maxVelocity * 1.10)
    })
  }
})

describe('Slice 1 Step 6: idle behaviors produce warnings when params would violate physics', () => {
  // High radius+speed should trigger clamping warnings for behaviours bound by radius·speed.
  const extreme: IdleParams = { center: { x: 0, y: 0, z: 0 }, radius: 30, speed: 10, altitude: 10 }
  it('orbit at extreme params emits a clamp warning', () => {
    const orbit = getIdleBehavior('orbit')!
    const clamped = orbit.clampToConstraints!(extreme, DEFAULT_TRANSITION_CONSTRAINTS)
    expect(clamped.warnings.length).toBeGreaterThan(0)
    expect(clamped.params.speed).toBeLessThan(extreme.speed)
  })

  it('orbit at conservative params emits no warning', () => {
    const orbit = getIdleBehavior('orbit')!
    const safe: IdleParams = { center: { x: 0, y: 0, z: 0 }, radius: 2, speed: 0.5, altitude: 10 }
    const clamped = orbit.clampToConstraints!(safe, DEFAULT_TRANSITION_CONSTRAINTS)
    expect(clamped.warnings).toHaveLength(0)
    expect(clamped.params.speed).toBe(0.5)
  })
})

// Plan §B3 — formation-shape / drone-spacing preservation tests.
//
// The bug: prior to the 2026-05-21 rewrite, every ring-based behavior packed
// N drones onto a single ring of the user's requested radius. For N=50 at
// radius=5m this gave 0.63m pair spacing — below typical minimums. The
// rewrite distributes drones over a multi-ring stack sized to satisfy the
// project's `minSpacing`, then layers behaviour-specific modulation on top.
//
// This block samples each non-hover behaviour over a representative time
// window with an aggressive drone count + small radius (the configuration
// that used to break) and asserts that **no pair of drones ever falls below
// `minSpacing × 0.85`** (the 15 % allowance covers the band of motion-time
// spacing the platform tolerates).
describe('Plan §B3: idle behaviors preserve drone pair spacing after clamp', () => {
  const aggressive: IdleParams = { center: { x: 0, y: 0, z: 0 }, radius: 1, speed: 2, altitude: 10 }
  const constraints = DEFAULT_TRANSITION_CONSTRAINTS
  const N = 50
  const homes: { x: number; y: number; z: number }[] = []
  for (let i = 0; i < N; i++) {
    homes.push({ x: (i % 10) * 2 - 10, y: 0, z: Math.floor(i / 10) * 2 - 5 })
  }
  function minPairDistance(behaviorId: string, params: IdleParams, t: number): number {
    const beh = getIdleBehavior(behaviorId)!
    const positions = new Array<{ x: number; y: number; z: number }>(N)
    for (let i = 0; i < N; i++) {
      positions[i] = beh.getPosition(i, N, t, params, homes[i]!)
    }
    let minDist = Infinity
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = positions[i]!, b = positions[j]!
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (d < minDist) minDist = d
      }
    }
    return minDist
  }
  for (const beh of getAllIdleBehaviors()) {
    if (!beh.clampToConstraints) continue
    it(`${beh.id}: 50 drones stay ≥ 0.85·minSpacing apart across t=[0,4s]`, () => {
      const clamped = beh.clampToConstraints!(aggressive, constraints, N).params
      // Sample 16 time points spanning a representative cycle of each behavior.
      const minObserved: number[] = []
      for (let s = 0; s < 16; s++) {
        const t = (s / 15) * 4
        minObserved.push(minPairDistance(beh.id, clamped, t))
      }
      const worst = Math.min(...minObserved)
      expect(worst).toBeGreaterThanOrEqual(constraints.minSpacing * 0.85)
    })
  }
})
