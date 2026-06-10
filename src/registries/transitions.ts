// ============================================================================
// G-04: Transition Responsibility Spec
// ============================================================================
// A transition is a graph-level operator, not just motion interpolation.
// It owns:
//   1. Point mapping: Given N source + M target points, decide which source
//      drone goes to which target slot.
//   2. Entering/exiting drone handling: If M > N (merge), decide where entering
//      drones appear. If N > M (split), decide where exiting drones go.
//   3. Motion interpolation: Given a mapping and t ∈ [0,1], produce intermediate
//      positions for each drone.
//
// A transition does NOT own:
//   - Timing (derived from the graph)
//   - Drone count allocation (the flow model's job)
//
// Physics-aware transitions can optionally implement computeMinDuration()
// to report the minimum time they need given physical constraints.
// ============================================================================

import type { Vec3 } from '../graph/types'
import { v3distSq } from '../graph/vec3'
import { createRegistry } from './createRegistry'
import {
  interpolateAntTrail,
  computeAntTrailMinDuration,
  parseAntTrailParams,
} from '../graph/antTrail'

export interface PointMapping {
  sourceIndex: number
  targetIndex: number
}

/** Physical constraints passed from project settings to transitions.
 *  Derived from project Constraints via toTransitionConstraints(). */
export interface TransitionConstraints {
  maxVelocity: number       // m/s (default 8)
  maxAcceleration: number   // m/s² (default 4)
  /** At-rest minimum spacing — includes safety/GPS margins. Used by computeMinDuration
   *  to size transitions conservatively (slower motion = larger margins). */
  minSpacing: number
  /** Motion-time minimum spacing — typically ½ minSpacing, floored at 0.5m. Industry
   *  norm is that drones may pass closer during transit than they sit at rest. Used by
   *  the evaluator's per-frame collision resolution pass. */
  motionSpacing: number
}

export const DEFAULT_TRANSITION_CONSTRAINTS: TransitionConstraints = {
  maxVelocity: 8,
  maxAcceleration: 4,
  minSpacing: 1.0,
  motionSpacing: 0.5,
}

/** Convert project-level Constraints to TransitionConstraints.
 *  Single canonical mapping — eliminates ad-hoc mapping in consumers. */
export function toTransitionConstraints(c: {
  maxVelocity: number; maxAcceleration: number; minDroneDistance: number;
  windSpeed?: number; windGustFactor?: number; safetyMarginVelocity?: number;
  safetyMarginSpacing?: number; gpsAccuracy?: number;
}): TransitionConstraints {
  // S15-03/04/05/07: Apply wind, GPS, safety margins to effective constraints
  const windEffect = (c.windSpeed ?? 0) * (c.windGustFactor ?? 1)
  const velMargin = c.safetyMarginVelocity ?? 0
  const spaceMargin = c.safetyMarginSpacing ?? 0
  const gpsMargin = 2 * (c.gpsAccuracy ?? 0)

  const minSpacing = c.minDroneDistance + spaceMargin + gpsMargin
  return {
    maxVelocity: Math.max(0.5, c.maxVelocity * (1 - velMargin) - windEffect),
    maxAcceleration: c.maxAcceleration * (1 - velMargin),
    minSpacing,
    motionSpacing: Math.max(0.5, c.minDroneDistance * 0.5),
  }
}

export interface TransitionDef {
  id: string
  name: string
  mapPoints(from: Vec3[], to: Vec3[], entering: Vec3[], exiting: Vec3[]): PointMapping[]
  interpolate(mapping: PointMapping[], from: Vec3[], to: Vec3[], t: number, params: Record<string, unknown>): Vec3[]
  /** Compute the minimum physical duration this transition needs. Return 0 for "no minimum". */
  computeMinDuration(mapping: PointMapping[], from: Vec3[], to: Vec3[], params: Record<string, unknown>, constraints: TransitionConstraints): number
  /**
   * Plan per-drone curves once at edit time. The trajectory planner samples these
   * during playback — no per-frame interpolate() calls. Strategies own the curve
   * shape (linear, spiral, two-phase scatter, etc.); the planner owns collision
   * resolution on top via deflection/time-stagger/mapping-swap.
   *
   * Returned array length should equal min(from.length, to.length). Curve t ∈ [0, 1].
   *
   * Optional during the migration — strategies without planCurves fall back to a
   * wrapper around interpolate(). Once all strategies implement planCurves,
   * interpolate is removed.
   */
  planCurves?(from: Vec3[], to: Vec3[], params: Record<string, unknown>, duration: number, constraints: TransitionConstraints): import('../graph/trajectoryPlanner').DroneCurve[]
}

/**
 * Trapezoidal velocity-profile minimum duration for a straight-line move of length `maxDist`.
 * Used by linear-interpolation strategies (shortest-path).
 */
export function trapezoidalDuration(maxDist: number, constraints: TransitionConstraints): number {
  if (maxDist <= 0 || constraints.maxVelocity <= 0) return 0
  const v = constraints.maxVelocity
  const a = constraints.maxAcceleration > 0 ? constraints.maxAcceleration : Infinity
  const dCritical = (v * v) / a
  const tMin = maxDist <= dCritical
    ? 2 * Math.sqrt(maxDist / a)
    : v / a + maxDist / v
  return Math.ceil(tMin * 10) / 10
}

/**
 * Minimum duration for a cubic ease-in-out move of length `maxDist`.
 * Cubic ease-in-out s(t)=3t²−2t³ has peak velocity 1.5×avg and peak accel 6D/T² at endpoints.
 * Used by strategies whose `interpolate` applies ease-in-out (stagger, spiral, morph, color-sweep, etc).
 */
export function easedDuration(maxDist: number, constraints: TransitionConstraints): number {
  if (maxDist <= 0 || constraints.maxVelocity <= 0) return 0
  const v = constraints.maxVelocity
  const a = constraints.maxAcceleration
  const Tv = 1.5 * maxDist / v
  const Ta = a > 0 ? Math.sqrt(6 * maxDist / a) : 0
  return Math.ceil(Math.max(Tv, Ta) * 10) / 10
}

// --- Registry ---

const registry = createRegistry<TransitionDef>('transitions')

export const registerTransition = registry.register
export const getTransition = registry.get
export const getAllTransitions = registry.getAll

// --- Built-in: shortest-path ---

/**
 * Hungarian algorithm (Kuhn-Munkres) for optimal minimum-cost assignment.
 * O(n^3) time, O(n^2) space. Returns optimal 1:1 mapping that minimizes total distance.
 * Falls back to greedy for n > 200 (preview perf budget).
 */
export function hungarianMapping(from: Vec3[], to: Vec3[]): PointMapping[] {
  const n = Math.min(from.length, to.length)
  if (n === 0) return []
  if (n > 200) return greedyNearestMapping(from, to) // Perf guard for preview

  // Build cost matrix (squared distances)
  const cost: number[][] = []
  for (let i = 0; i < n; i++) {
    cost[i] = []
    for (let j = 0; j < n; j++) {
      cost[i]![j] = v3distSq(from[i]!, to[j]!)
    }
  }

  // Hungarian algorithm (assignment problem)
  // Using typed arrays with helper accessors for type safety
  const u = new Float64Array(n + 1) as unknown as number[]
  const v = new Float64Array(n + 1) as unknown as number[]
  const p = new Int32Array(n + 1) as unknown as number[]
  const way = new Int32Array(n + 1) as unknown as number[]

  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Float64Array(n + 1).fill(Infinity) as unknown as number[]
    const used = new Uint8Array(n + 1) as unknown as number[]

    do {
      used[j0] = 1
      const i0 = p[j0]!
      let delta = Infinity
      let j1 = 0

      for (let j = 1; j <= n; j++) {
        if (used[j]) continue
        const cur = cost[i0! - 1]![j - 1]! - u[i0!]! - v[j]!
        if (cur < minv[j]!) {
          minv[j] = cur
          way[j] = j0
        }
        if (minv[j]! < delta) {
          delta = minv[j]!
          j1 = j
        }
      }

      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          u[p[j]!] = u[p[j]!]! + delta
          v[j] = v[j]! - delta
        } else {
          minv[j] = minv[j]! - delta
        }
      }

      j0 = j1
    } while (p[j0] !== 0)

    do {
      const j1 = way[j0]!
      p[j0] = p[j1]!
      j0 = j1
    } while (j0)
  }

  const mappings: PointMapping[] = []
  for (let j = 1; j <= n; j++) {
    if (p[j]! > 0) {
      mappings.push({ sourceIndex: p[j]! - 1, targetIndex: j - 1 })
    }
  }
  return mappings
}

/** Greedy nearest-neighbor mapping — fallback for large counts and ant-walk. */
function greedyNearestMapping(from: Vec3[], to: Vec3[]): PointMapping[] {
  const mappings: PointMapping[] = []
  const usedTargets = new Set<number>()
  const usedSources = new Set<number>()
  const pairCount = Math.min(from.length, to.length)

  for (let i = 0; i < pairCount; i++) {
    let bestSource = -1
    let bestTarget = -1
    let bestDist = Infinity

    for (let si = 0; si < from.length; si++) {
      if (usedSources.has(si)) continue
      const src = from[si]!
      for (let ti = 0; ti < to.length; ti++) {
        if (usedTargets.has(ti)) continue
        const tgt = to[ti]!
        const d = v3distSq(src, tgt)
        if (d < bestDist) {
          bestDist = d
          bestSource = si
          bestTarget = ti
        }
      }
    }

    if (bestSource >= 0 && bestTarget >= 0) {
      mappings.push({ sourceIndex: bestSource, targetIndex: bestTarget })
      usedSources.add(bestSource)
      usedTargets.add(bestTarget)
    }
  }

  return mappings
}

const shortestPathTransition: TransitionDef = {
  id: 'shortest-path',
  name: 'Shortest Path',

  mapPoints(from: Vec3[], to: Vec3[], _entering: Vec3[], _exiting: Vec3[]): PointMapping[] {
    return hungarianMapping(from, to)
  },

  interpolate(mapping: PointMapping[], from: Vec3[], to: Vec3[], t: number, params: Record<string, unknown>): Vec3[] {
    const result: Vec3[] = []
    const staggerAmount = params['staggerAmount'] != null ? Number(params['staggerAmount']) : 0
    // Per-drone vertical "lane" prevents XZ-crossing paths from colliding by separating
    // them in Y. Each drone gets a unique altitude offset (peaks mid-transit, zero at
    // endpoints), spread by laneSpread metres across the population. With Hungarian mapping
    // and 50cm default spread, two drones swapping positions stay ≥1m apart vertically at
    // the crossing point — invisible at viewing distance, mathematically safe.
    // 2m default lane spread gives ±1m vertical separation peak — invisible at typical
    // viewing distances but enough Y-separation that XZ-crossing paths don't collide.
    const laneSpread = params['laneSpread'] != null ? Number(params['laneSpread']) : 2
    const N = mapping.length

    for (let i = 0; i < mapping.length; i++) {
      const m = mapping[i]!
      const src = from[m.sourceIndex]
      const tgt = to[m.targetIndex]
      if (!src || !tgt) continue

      let localT: number
      if (staggerAmount > 0) {
        const delay = (i / Math.max(1, mapping.length - 1)) * staggerAmount
        localT = Math.max(0, Math.min(1, (t - delay) / (1 - staggerAmount)))
      } else {
        localT = Math.max(0, Math.min(1, t))
      }

      // Lane offset: each drone gets a unique vertical channel. Sinusoidal so it returns
      // to 0 at both endpoints. Scaled by chord distance — a stationary drone (zero chord)
      // gets zero lane offset, so same-formation→same-formation transitions don't introduce
      // spurious vertical motion that itself causes collisions.
      const chordDx = tgt.x - src.x, chordDy = tgt.y - src.y, chordDz = tgt.z - src.z
      const chord = Math.sqrt(chordDx * chordDx + chordDy * chordDy + chordDz * chordDz)
      const chordScale = Math.min(1, chord / 2) // ramp from 0 to 1 over 0→2m of chord
      const laneIndex = N > 1 ? (i / (N - 1)) - 0.5 : 0 // -0.5 to +0.5
      const laneY = Math.sin(localT * Math.PI) * laneIndex * laneSpread * chordScale

      result.push({
        x: src.x + (tgt.x - src.x) * localT,
        y: src.y + (tgt.y - src.y) * localT + laneY,
        z: src.z + (tgt.z - src.z) * localT,
      })
    }

    return result
  },

  computeMinDuration(mapping: PointMapping[], from: Vec3[], to: Vec3[], _params: Record<string, unknown>, constraints: TransitionConstraints): number {
    let maxDist = 0
    for (const m of mapping) {
      const src = from[m.sourceIndex]
      const tgt = to[m.targetIndex]
      if (!src || !tgt) continue
      const d = Math.sqrt(v3distSq(src, tgt))
      maxDist = Math.max(maxDist, d)
    }
    return trapezoidalDuration(maxDist, constraints)
  },

  planCurves(from, to, params, _duration, _constraints) {
    // Straight-line eased lerp + per-drone Y-lane deflection, drone identity preserved
    // positionally: curves[i] takes drone i from from[i] to to[i].
    //
    // The Y-lane assigns each drone a unique vertical channel peaking mid-transit, so
    // two drones with XZ-crossing chords stay safely separated in Y at the crossing.
    // This is a PLANNED deflection (baked into the trajectory at edit time, smooth and
    // deterministic) — not the per-frame reactive nudge that caused the wobble. The
    // lane is scaled by chord length so stationary drones (zero chord) get zero Y
    // offset, and dies to zero at both endpoints so handoff to the formation evaluator
    // is exact.
    //
    // A future step will replace this with a swept-collision-driven deflection that
    // only kicks in for pairs that actually conflict, instead of a uniform-by-index
    // offset. Until then, the Y-lane keeps shows watchable without re-introducing the
    // wobble.
    const N = Math.min(from.length, to.length)
    const staggerAmount = params['staggerAmount'] != null ? Number(params['staggerAmount']) : 0
    const laneSpread = params['laneSpread'] != null ? Number(params['laneSpread']) : 2

    const curves: import('../graph/trajectoryPlanner').DroneCurve[] = []
    for (let i = 0; i < N; i++) {
      const src = from[i]
      const tgt = to[i]
      if (!src || !tgt) {
        const here = src ?? tgt ?? { x: 0, y: 0, z: 0 }
        curves.push(() => ({ ...here }))
        continue
      }
      const ax = src.x, ay = src.y, az = src.z
      const bx = tgt.x, by = tgt.y, bz = tgt.z
      const delay = staggerAmount > 0 ? (i / Math.max(1, N - 1)) * staggerAmount : 0
      const moveFrac = 1 - staggerAmount
      const chordDx = bx - ax, chordDy = by - ay, chordDz = bz - az
      const chord = Math.sqrt(chordDx * chordDx + chordDy * chordDy + chordDz * chordDz)
      const chordScale = Math.min(1, chord / 2)
      // Position-hashed lane index. Using within-edge index would give two drones in
      // different incoming edges (a merge) the same Y-offset, and if their XZ paths
      // crossed simultaneously they'd still collide. Hashing position decorrelates
      // the deflection across edges. Deterministic, drone-identity-stable.
      const hash = Math.sin(ax * 7.3 + az * 11.7 + bx * 3.1 + bz * 5.9) * 0.5
      const laneAmp = hash * laneSpread * chordScale
      curves.push((t) => {
        const localT = moveFrac > 0
          ? Math.max(0, Math.min(1, (t - delay) / moveFrac))
          : Math.max(0, Math.min(1, t))
        // Smoothstep (3t² − 2t³). Peak velocity 1.5 × avg, matching the assumption
        // `easedDuration` makes when sizing minRequired.
        const eased = localT * localT * (3 - 2 * localT)
        const laneY = Math.sin(localT * Math.PI) * laneAmp
        return {
          x: ax + chordDx * eased,
          y: ay + chordDy * eased + laneY,
          z: az + chordDz * eased,
        }
      })
    }
    return curves
  },
}

// --- Built-in: ant-walk (path-constrained flow system) ---
//
// Drones temporarily organize into ordered queues on one or more lane curves.
// Three phases: Entry (merge into lanes), Trail (constant-speed convoy), Exit (peel off).
//
// Core invariants:
//   - During trail phase: constant speed, constant spacing, no overtaking
//   - All drones in a lane follow the same cubic bezier path
//   - Position = f(lane, queue_slot, distance_along_curve)
//   - Deterministic: same inputs → same output
//
// Parameters:
//   laneCount    — number of parallel trail lanes (1–8, default 2)
//   trailSpeed   — constant speed along trail in m/s (default 6)
//   spacing      — target distance between consecutive drones in a lane (m, default 2)
//   arcHeight    — vertical arc of the trail path (default 5)
//   laneSpread   — lateral distance between outermost lanes (default 8)
//   entryPhase   — fraction of total time for entry merge (0.05–0.4, default 0.2)
//   exitPhase    — fraction of total time for exit split (0.05–0.4, default 0.2)
//   zigzag       — lateral sway amplitude during trail (0–3, default 0)

const antWalkTransition: TransitionDef = {
  id: 'ant-walk',
  name: 'Ant Trail',

  mapPoints(from: Vec3[], to: Vec3[], _entering: Vec3[], _exiting: Vec3[]): PointMapping[] {
    return greedyNearestMapping(from, to)
  },

  interpolate(mapping: PointMapping[], from: Vec3[], to: Vec3[], t: number, params: Record<string, unknown>): Vec3[] {
    const p = parseAntTrailParams(params)
    const totalDuration = Math.max(0.1, Number(params['_totalDuration']) || 10)
    return interpolateAntTrail(mapping, from, to, t, p, totalDuration)
  },

  computeMinDuration(mapping: PointMapping[], from: Vec3[], to: Vec3[], params: Record<string, unknown>, constraints: TransitionConstraints): number {
    const p = parseAntTrailParams(params)
    return computeAntTrailMinDuration(mapping, from, to, p, constraints.maxVelocity)
  },

  planCurves(from, to, params, duration) {
    // interpolateAntTrail computes all N positions at once (queue, lane-curve, etc).
    // Memoize per-t so each frame's N curve samples share one underlying call.
    const p = parseAntTrailParams(params)
    const totalDuration = Math.max(0.1, duration)
    const N = Math.min(from.length, to.length)
    const mapping: PointMapping[] = []
    for (let i = 0; i < N; i++) mapping.push({ sourceIndex: i, targetIndex: i })
    const memo: { t: number; positions: Vec3[] } = { t: Number.NaN, positions: [] }
    const curves: import('../graph/trajectoryPlanner').DroneCurve[] = []
    for (let i = 0; i < N; i++) {
      const droneIdx = i
      curves.push((t) => {
        if (memo.t !== t) {
          memo.positions = interpolateAntTrail(mapping, from, to, t, p, totalDuration)
          memo.t = t
        }
        return memo.positions[droneIdx] ?? from[droneIdx]!
      })
    }
    return curves
  },
}

// Register built-in
registerTransition(shortestPathTransition)
registerTransition(antWalkTransition)
