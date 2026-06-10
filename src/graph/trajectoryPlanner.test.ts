import { describe, it, expect } from 'vitest'
import { planTransition } from './trajectoryPlanner'
import { DEFAULT_TRANSITION_CONSTRAINTS } from '../registries/transitions'
import type { Vec3 } from './types'

const C = DEFAULT_TRANSITION_CONSTRAINTS

function v(x: number, y: number, z: number): Vec3 {
  return { x, y, z }
}

function dist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

describe('planTransition — skeleton (shortest-path, no conflict resolution yet)', () => {
  it('returns an empty-safe Trajectory for n=0', () => {
    const traj = planTransition({
      from: [], to: [], strategyId: 'shortest-path', parameters: {}, duration: 1, constraints: C,
    })
    expect(traj.count).toBe(0)
    expect(traj.report.minSpacing).toBe(Infinity)
  })

  it('produces straight-line curves: sample(i, 0) = from[i], sample(i, 1) = to[i]', () => {
    const from = [v(0, 0, 0), v(2, 0, 0), v(4, 0, 0)]
    const to = [v(0, 5, 0), v(2, 5, 0), v(4, 5, 0)]
    const traj = planTransition({ from, to, strategyId: 'shortest-path', parameters: {}, duration: 2, constraints: C })

    for (let i = 0; i < 3; i++) {
      // sample(i, 0) must equal from[i] (planner uses Hungarian; mapping is identity here)
      expect(dist(traj.sample(i, 0), from[i]!)).toBeLessThan(1e-9)
      expect(dist(traj.sample(i, 1), to[i]!)).toBeLessThan(1e-9)
    }
  })

  it('clamps t outside [0,1]', () => {
    const from = [v(0, 0, 0)]
    const to = [v(10, 0, 0)]
    const traj = planTransition({ from, to, strategyId: 'shortest-path', parameters: {}, duration: 1, constraints: C })
    expect(dist(traj.sample(0, -0.5), from[0]!)).toBeLessThan(1e-9)
    expect(dist(traj.sample(0, 1.5), to[0]!)).toBeLessThan(1e-9)
  })

  it('preserves positional drone identity: curves[i] takes drone i from from[i] to to[i]', () => {
    // The caller (evaluator) has already canonical-assigned drone i → target i via
    // resolveTargetPositions. The planner does NOT remap (running Hungarian here
    // would re-permute and break the correspondence with evaluateFormation's
    // index-within-aggregate placement, re-introducing handoff jumps).
    const from = [v(0, 0, 0), v(10, 0, 0)]
    const to = [v(10, 0, 0), v(0, 0, 0)]
    const traj = planTransition({ from, to, strategyId: 'shortest-path', parameters: {}, duration: 1, constraints: C })

    // No swap: drone 0 ends at to[0]=(10,0,0); drone 1 ends at to[1]=(0,0,0).
    expect(dist(traj.sample(0, 1), to[0]!)).toBeLessThan(1e-9)
    expect(dist(traj.sample(1, 1), to[1]!)).toBeLessThan(1e-9)
  })

  it('Y-lane returns to zero at endpoints so formation handoff is exact', () => {
    // Multi-drone case: Y-lane peaks mid-transit but must die to zero at t=0 and t=1
    // so the planner's endpoints equal from[i]/to[i] exactly.
    const from = [v(0, 0, 0), v(0, 0, 0), v(0, 0, 0)]
    const to = [v(10, 0, 0), v(10, 0, 5), v(10, 0, 10)]
    const traj = planTransition({ from, to, strategyId: 'shortest-path', parameters: {}, duration: 1, constraints: C })
    for (let i = 0; i < 3; i++) {
      expect(dist(traj.sample(i, 0), from[i]!)).toBeLessThan(1e-9)
      expect(dist(traj.sample(i, 1), to[i]!)).toBeLessThan(1e-9)
    }
  })

  it('smoothstep easing: peak velocity ≤ 1.5 × avg (single drone has no Y-lane)', () => {
    // Smoothstep peaks at 1.5 × avg, the budget easedDuration assumes. Single-drone
    // case so Y-lane doesn't add motion (still hashes position but we only care
    // about chord-velocity here).
    const from = [v(0, 0, 0)]
    const to = [v(10, 0, 0)]
    const duration = 1
    const traj = planTransition({ from, to, strategyId: 'shortest-path', parameters: { laneSpread: 0 }, duration, constraints: C })
    // Sample dense points and compute max finite-difference velocity.
    const N = 200
    let peak = 0
    let prev = traj.sample(0, 0)
    for (let s = 1; s <= N; s++) {
      const t = s / N
      const cur = traj.sample(0, t)
      const v = dist(cur, prev) / (duration / N)
      if (v > peak) peak = v
      prev = cur
    }
    const avg = 10 / duration
    // Smoothstep peak is 1.5 × avg = 15. Allow 5% margin for finite-difference error.
    expect(peak).toBeLessThan(avg * 1.5 * 1.05)
    expect(peak).toBeGreaterThan(avg * 1.5 * 0.95)
  })

  it('staggered shortest-path delays late-index drones', () => {
    // staggerAmount=0.5 means last drone starts halfway through.
    const from = [v(0, 0, 0), v(0, 0, 0), v(0, 0, 0)]
    const to = [v(10, 0, 0), v(10, 0, 0), v(10, 0, 0)]
    const traj = planTransition({
      from, to, strategyId: 'shortest-path',
      parameters: { staggerAmount: 0.5 },
      duration: 1, constraints: C,
    })
    // At t=0.25, drone 0 should have moved; drone 2 (last) shouldn't have yet.
    const p0 = traj.sample(0, 0.25)
    const p2 = traj.sample(2, 0.25)
    expect(p0.x).toBeGreaterThan(p2.x)
    // At t=1, everyone arrives.
    expect(traj.sample(0, 1).x).toBeCloseTo(10, 6)
    expect(traj.sample(2, 1).x).toBeCloseTo(10, 6)
  })

  it('two drones swapping positions stay separated by Y-lane deflection', () => {
    // Identity mapping → XZ paths cross at (0,0,0). The Y-lane deflection (hashed on
    // source/target position) pushes one drone above and the other below the chord
    // mid-transit, so they don't collide. Endpoints are still exact.
    const from = [v(-5, 0, 0), v(5, 0, 0)]
    const to = [v(5, 0, 0), v(-5, 0, 0)]
    const traj = planTransition({ from, to, strategyId: 'shortest-path', parameters: {}, duration: 1, constraints: C })
    const d0 = traj.sample(0, 0.5)
    const d1 = traj.sample(1, 0.5)
    expect(dist(d0, d1)).toBeGreaterThan(0.1)
    // Handoff: both drones reach their canonical endpoint exactly.
    expect(dist(traj.sample(0, 1), to[0]!)).toBeLessThan(1e-9)
    expect(dist(traj.sample(1, 1), to[1]!)).toBeLessThan(1e-9)
  })
})

describe('Deflection layer — Step 4', () => {
  it('two head-on crossing drones get separated by deflection (minDist ≥ motionSpacing)', () => {
    // Without the deflection layer these two cross paths at (0,0,0) with d=0.
    // After deflection, the validator should see at least motionSpacing apart.
    const from = [v(-5, 5, 0), v(5, 5, 0)]
    const to = [v(5, 5, 0), v(-5, 5, 0)]
    const traj = planTransition({ from, to, strategyId: 'shortest-path', parameters: {}, duration: 1, constraints: C })
    let minD = Infinity
    for (let s = 0; s <= 50; s++) {
      const t = s / 50
      const d = dist(traj.sample(0, t), traj.sample(1, t))
      if (d < minD) minD = d
    }
    expect(minD).toBeGreaterThanOrEqual(C.motionSpacing * 0.95)
  })

  it('parallel non-conflicting drones stay straight (no spurious deflection)', () => {
    // Two parallel chords, well-separated. Should pass through cleanly.
    const from = [v(-5, 5, 0), v(-5, 5, 10)]
    const to = [v(5, 5, 0), v(5, 5, 10)]
    const traj = planTransition({ from, to, strategyId: 'shortest-path', parameters: {}, duration: 1, constraints: C })
    // Drone 0 should travel along its chord (no Y deflection beyond Y-lane).
    const mid = traj.sample(0, 0.5)
    // Center should be near (0, 5, 0) — within Y-lane spread.
    expect(Math.abs(mid.x)).toBeLessThan(0.5)
    expect(Math.abs(mid.z)).toBeLessThan(0.5)
  })

  it('endpoints stay exact after deflection (handoff to formation evaluator)', () => {
    // Even with conflicts deflected, t=0 must equal from[i] and t=1 must equal to[i].
    const from = [v(-5, 5, 0), v(5, 5, 0)]
    const to = [v(5, 5, 0), v(-5, 5, 0)]
    const traj = planTransition({ from, to, strategyId: 'shortest-path', parameters: {}, duration: 1, constraints: C })
    for (let i = 0; i < 2; i++) {
      expect(dist(traj.sample(i, 0), from[i]!)).toBeLessThan(1e-6)
      expect(dist(traj.sample(i, 1), to[i]!)).toBeLessThan(1e-6)
    }
  })

  it('both drones deflect symmetrically (opposite directions, each by half-amp)', () => {
    // Two drones with paths that cross at (0,5,0) — Y-lane disabled (laneSpread=0)
    // so the deflection layer is the only thing separating them. They should be
    // pushed apart along the deterministic fallback axis (biased toward Y).
    const from = [v(-5, 5, 0), v(5, 5, 0)]
    const to = [v(5, 5, 0), v(-5, 5, 0)]
    const traj = planTransition({
      from, to,
      strategyId: 'shortest-path',
      parameters: { laneSpread: 0 },
      duration: 1, constraints: C,
    })
    const mid0 = traj.sample(0, 0.5)
    const mid1 = traj.sample(1, 0.5)
    // Both should be deflected off the chord. Sum of |Y| displacements > 0.1.
    expect(Math.abs(mid0.y - 5) + Math.abs(mid1.y - 5)).toBeGreaterThan(0.1)
    // Mid-transit they should be separated by ≥ motionSpacing.
    expect(dist(mid0, mid1)).toBeGreaterThanOrEqual(C.motionSpacing * 0.9)
  })

  it('report.conflicts is empty for resolvable cases', () => {
    const from = [v(-5, 5, 0), v(5, 5, 0)]
    const to = [v(5, 5, 0), v(-5, 5, 0)]
    const traj = planTransition({ from, to, strategyId: 'shortest-path', parameters: {}, duration: 1, constraints: C })
    expect(traj.report.conflicts.length).toBe(0)
  })

  it('report.conflicts reports residue for unresolvable cases (same target)', () => {
    // Two drones to identical target — no perpendicular deflection can clear them
    // because endpoints coincide.
    const from = [v(-5, 5, 0), v(5, 5, 0)]
    const to = [v(0, 5, 0), v(0, 5, 0)] // both targets at origin
    const traj = planTransition({ from, to, strategyId: 'shortest-path', parameters: {}, duration: 1, constraints: C })
    // At t=1, both drones are at (0,5,0) — distance 0. The planner can't resolve this.
    expect(traj.report.conflicts.length).toBeGreaterThan(0)
  })

  it('unregistered strategyId — falls back to straight-line lerp', () => {
    const from = [v(0, 0, 0)]
    const to = [v(10, 0, 0)]
    const traj = planTransition({ from, to, strategyId: 'does-not-exist', parameters: {}, duration: 1, constraints: C })
    expect(traj.count).toBe(1)
    expect(dist(traj.sample(0, 1), to[0]!)).toBeLessThan(1e-9)
  })
})
