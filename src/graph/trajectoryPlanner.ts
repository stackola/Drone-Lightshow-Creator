// ============================================================================
// Trajectory Planner — pre-plan per-drone curves at edit time
// ============================================================================
// Replaces per-frame interpolation + reactive nudging with planning that runs
// once per transition. The evaluator samples planned curves; collisions are
// resolved at plan time (later steps), never visible at runtime.
//
// This file lands the skeleton: PlanInput, Trajectory, planTransition. Conflict
// resolution layers in later. Strategies that don't yet implement planCurves
// fall back to wrapping their interpolate() for parity during the migration.
// ============================================================================

import type { Vec3 } from './types'
import type { TransitionConstraints, TransitionDef, PointMapping } from '../registries/transitions'
import { getTransition } from '../registries/transitions'

/** A per-drone position-of-time curve. t is normalized: [0, 1] over the transition window. */
export type DroneCurve = (t: number) => Vec3

export interface ConflictReport {
  droneA: number
  droneB: number
  /** Closest approach distance found during the sweep. */
  minDist: number
  /** Normalized time of closest approach. */
  tOfClosest: number
}

export interface PlanReport {
  /** Minimum pairwise distance observed across the swept curves. Infinity for ≤1 drone. */
  minSpacing: number
  /** Pairs that came within motionSpacing during the sweep. Empty after conflict resolution lands. */
  conflicts: ConflictReport[]
}

export interface Trajectory {
  /** Sample a drone's position at normalized t ∈ [0, 1]. */
  sample(droneIndex: number, t: number): Vec3
  /** Per-drone count this trajectory plans. */
  count: number
  /** Plan-time diagnostics (spacing, conflicts). Surfaced to the physics validator. */
  report: PlanReport
}

export interface PlanInput {
  /** Drone-order canonical start positions. trajectory.sample(i, 0) = from[i]. */
  from: Vec3[]
  /** Drone-order canonical end positions. trajectory.sample(i, 1) = to[i]. */
  to: Vec3[]
  strategyId: string
  parameters: Record<string, unknown>
  /** Absolute transition window length in seconds — strategies that need it (e.g. ant-walk). */
  duration: number
  constraints: TransitionConstraints
}

/**
 * Plan a transition. Pure, deterministic — same input → same Trajectory. The
 * caller (evaluator + bake) shares one cache keyed on PlanInput hash.
 *
 * Drone identity is positional: caller arranges from[i]/to[i] so that index i is
 * the same drone throughout. The planner doesn't know drone ids; the evaluator
 * maps di ↔ i at the call boundary.
 */
export function planTransition(input: PlanInput): Trajectory {
  const { from, to, strategyId, parameters, duration, constraints } = input
  const n = Math.min(from.length, to.length)

  if (n === 0) {
    return { sample: () => ({ x: 0, y: 0, z: 0 }), count: 0, report: { minSpacing: Infinity, conflicts: [] } }
  }

  const strategy = getTransition(strategyId)
  const rawCurves = strategy?.planCurves
    ? strategy.planCurves(from, to, parameters, duration, constraints)
    : fallbackInterpolateCurves(strategy, from, to, parameters, duration, n)

  // Conflict resolution: pair-sweep at K sample points, deflect lower-mobility
  // drone perpendicular to its chord with a sine-bump envelope. Iterates until
  // no pair is within motionSpacing or maxPasses is hit. Whatever can't be
  // resolved goes into report.conflicts (the validator reads this).
  const motionSpacing = constraints.motionSpacing > 0 ? constraints.motionSpacing : 0.5
  const { curves, report } = applyDeflections(rawCurves, from, to, motionSpacing)

  return {
    sample: (droneIndex, t) => {
      const c = curves[droneIndex]
      if (!c) return { x: 0, y: 0, z: 0 }
      return c(Math.max(0, Math.min(1, t)))
    },
    count: curves.length,
    report,
  }
}

// ── Deflection layer ────────────────────────────────────────────────────────

/** Number of points along each curve we sample for collision detection.
 *  32 (was 16) reduces missed conflicts near transition endpoints where
 *  the validator's 5-sample sparse check can still find collisions. */
const PAIR_SWEEP_SAMPLES = 32
/** Maximum deflection passes; cascades (A→B→C) need a few. */
const MAX_DEFLECT_PASSES = 6
/** Multiplicative safety margin above motionSpacing for the deflection target.
 *  1.5 absorbs envelope shape attenuation between sweep samples and accounts
 *  for the validator's coarser 5-sample check finding slightly different
 *  conflict times than my 32-sample sweep. */
const DEFLECT_MARGIN = 1.5

/**
 * Apply iterative pair-deflection to eliminate close-pass conflicts.
 *
 * For each pair (i, j) of `DroneCurve`s, sample K points to find the closest
 * approach. If under `motionSpacing`, wrap the lower-mobility drone's curve with
 * a sine-bump envelope perpendicular to its chord — peaks at conflict time, zero
 * at endpoints (so the formation handoff stays exact). Iterates because one
 * deflection can introduce a new pair conflict; converges in 1–3 passes typical.
 *
 * Priority: drone with the longer chord stays straight (committed motion); the
 * drone with the shorter chord deflects. Tiebreak by stable index.
 *
 * Residual conflicts after MAX_DEFLECT_PASSES land in `report.conflicts` — they
 * indicate the transition needs more duration or a different mapping, surfaced
 * to the author via the physics validator.
 */
function applyDeflections(
  initialCurves: DroneCurve[],
  from: Vec3[],
  to: Vec3[],
  motionSpacing: number,
): { curves: DroneCurve[]; report: PlanReport } {
  const N = initialCurves.length
  if (N < 2 || motionSpacing <= 0) {
    return { curves: initialCurves, report: { minSpacing: Infinity, conflicts: [] } }
  }

  // Precompute chord lengths once — they don't change with deflection (envelope is
  // perpendicular to chord, so chord length stays the same). Used for mobility
  // priority: longer-chord drone stays straight.
  const chordLen = new Array<number>(N)
  for (let i = 0; i < N; i++) {
    const a = from[i]!, b = to[i]!
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
    chordLen[i] = Math.sqrt(dx * dx + dy * dy + dz * dz)
  }

  const TARGET = motionSpacing * DEFLECT_MARGIN
  let curves = initialCurves
  let lastConflicts: ConflictReport[] = []
  let lastMinSpacing = Infinity

  for (let pass = 0; pass < MAX_DEFLECT_PASSES; pass++) {
    const conflicts = sweepPairs(curves, motionSpacing)
    lastConflicts = conflicts
    lastMinSpacing = conflicts.length > 0
      ? Math.min(...conflicts.map((c) => c.minDist))
      : Infinity
    if (conflicts.length === 0) break

    // Apply all deflections from this pass in parallel. Each conflict picks a
    // single SHARED axis for the pair (direction from B to A in 3D, or a
    // deterministic fallback when drones are coincident). Drone A moves +axis,
    // drone B moves -axis, each by half-amp. Symmetric and order-free.
    //
    // The envelope is zero at t=0 and t=1, so the formation handoff stays exact
    // regardless of axis direction — we don't need to keep axis perpendicular
    // to each drone's chord, just to ensure the deflection separates them.
    const nextCurves = curves.slice()
    const alreadyDeflected = new Set<number>()
    for (const c of conflicts) {
      const { droneA, droneB, tOfClosest, minDist } = c
      const usedA = alreadyDeflected.has(droneA)
      const usedB = alreadyDeflected.has(droneB)
      if (usedA && usedB) continue
      alreadyDeflected.add(droneA)
      alreadyDeflected.add(droneB)

      // Pair-stable deflection axis: hashed on the (droneA, droneB) pair index,
      // independent of current positions. This is critical because if passes
      // recompute the axis from pA-pB each iteration, drones flip sides after
      // each deflection and successive passes cancel each other out instead of
      // accumulating. With a fixed axis, every pass moves the pair further apart
      // along the same direction → monotonic convergence.
      //
      // Biased toward Y (vertical lanes are the natural separator in drone shows
      // where ground-plane density is the constraint).
      const hashPhase = ((droneA * 7 + droneB * 13) % 6) * (Math.PI / 3)
      const axX = Math.cos(hashPhase) * 0.3
      const axY = 1
      const axZ = Math.sin(hashPhase) * 0.3
      const axLen = Math.sqrt(axX * axX + axY * axY + axZ * axZ)
      const ux = axX / axLen, uy = axY / axLen, uz = axZ / axLen
      // (pA/pB positions still computed for tOfClosest; axis no longer derived from them)

      // Amplitude = TARGET, ignoring the sample's minDist. The sampled min is
      // an upper bound on the true min between samples — for symmetric crossings,
      // the true closest approach is exactly 0 at a t halfway between two samples,
      // even when each sample reads a distance > 0. Sizing amp to clear the *worst*
      // case (minDist = 0) prevents the validator from re-detecting the conflict
      // at a t my sweep skipped.
      void minDist
      const amp = TARGET
      const halfAmp = amp / 2

      const t0 = Math.max(1e-3, Math.min(1 - 1e-3, tOfClosest))
      const rise = Math.PI / (2 * t0)
      const fall = Math.PI / (2 * (1 - t0))

      // Drone A moves +axis, drone B moves -axis (away from each other).
      const sides: { idx: number; sign: number }[] = []
      if (!usedA) sides.push({ idx: droneA, sign: +1 })
      if (!usedB) sides.push({ idx: droneB, sign: -1 })

      for (const side of sides) {
        const signedAmp = halfAmp * side.sign
        const baseCurve = curves[side.idx]!
        const ampX = ux * signedAmp, ampY = uy * signedAmp, ampZ = uz * signedAmp
        nextCurves[side.idx] = (t: number): Vec3 => {
          const base = baseCurve(t)
          const shape = t < t0
            ? Math.sin(t * rise)
            : Math.sin((1 - t) * fall)
          return {
            x: base.x + ampX * shape,
            y: base.y + ampY * shape,
            z: base.z + ampZ * shape,
          }
        }
      }
    }
    curves = nextCurves
  }

  return {
    curves,
    report: { minSpacing: lastMinSpacing, conflicts: lastConflicts },
  }
}

/**
 * Sweep all unique drone pairs at PAIR_SWEEP_SAMPLES points along each curve.
 * Returns a `ConflictReport` for each pair whose minimum approach < motionSpacing.
 *
 * O(N² × K) per pass. For N ≤ 200 (typical demo density), K=16 → 320k ops.
 * Spatial-hash broad-phase would help beyond that; current densities don't need it.
 */
function sweepPairs(curves: DroneCurve[], motionSpacing: number): ConflictReport[] {
  const N = curves.length
  if (N < 2) return []
  const K = PAIR_SWEEP_SAMPLES
  // Pre-sample every curve at the K control points.
  const samples: Vec3[][] = new Array(N)
  for (let i = 0; i < N; i++) {
    const c = curves[i]!
    const row: Vec3[] = new Array(K)
    for (let s = 0; s < K; s++) row[s] = c(s / (K - 1))
    samples[i] = row
  }

  const conflicts: ConflictReport[] = []
  const thresholdSq = motionSpacing * motionSpacing
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      let minSq = Infinity
      let bestS = 0
      const si = samples[i]!, sj = samples[j]!
      for (let s = 0; s < K; s++) {
        const a = si[s]!, b = sj[s]!
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 < minSq) { minSq = d2; bestS = s }
      }
      if (minSq < thresholdSq) {
        conflicts.push({
          droneA: i,
          droneB: j,
          minDist: Math.sqrt(minSq),
          tOfClosest: bestS / (K - 1),
        })
      }
    }
  }
  return conflicts
}

/**
 * Bridge for strategies that haven't been ported to planCurves yet. Wraps the
 * legacy interpolate() into per-drone closures by capturing from/to/params and
 * calling interpolate(mapping, from, to, t, params) on each sample.
 *
 * This is slower than per-drone curves (interpolate is called N times per t),
 * but keeps the old strategies working until Step 3 ports them. Deleted then.
 */
function fallbackInterpolateCurves(
  strategy: TransitionDef | undefined,
  from: Vec3[],
  to: Vec3[],
  parameters: Record<string, unknown>,
  duration: number,
  n: number,
): DroneCurve[] {
  if (!strategy) {
    // No strategy registered — straight-line lerp without easing.
    const curves: DroneCurve[] = []
    for (let i = 0; i < n; i++) {
      const a = from[i]!
      const b = to[i]!
      curves.push((t) => ({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
      }))
    }
    return curves
  }

  // Identity mapping — drone identity is positional, and the caller has already
  // canonical-assigned drone i → target i via resolveTargetPositions. Running
  // Hungarian here would (a) cost O(N³) per frame and (b) re-permute against the
  // formation handoff (same bug Step 0/2 fixed). Strategies that need their own
  // mapping should implement planCurves.
  const mapping: PointMapping[] = []
  for (let i = 0; i < n; i++) mapping.push({ sourceIndex: i, targetIndex: i })
  const paramsWithDuration = { ...parameters, _totalDuration: duration }

  // Memo shared across all N curves: the evaluator samples every drone at the same t
  // within a frame, so cache interpolate's full N-result keyed on t. Drops cost from
  // O(N²) to O(N) per frame across the fallback path. Removed when all strategies
  // ship planCurves (Step 3) and this bridge is deleted.
  const memo: { t: number; positions: Vec3[] } = { t: Number.NaN, positions: [] }

  const curves: DroneCurve[] = []
  for (let i = 0; i < n; i++) {
    const droneIdx = i
    curves.push((t) => {
      if (memo.t !== t) {
        memo.positions = strategy.interpolate(mapping, from, to, t, paramsWithDuration)
        memo.t = t
      }
      return memo.positions[droneIdx] ?? from[droneIdx]!
    })
  }
  return curves
}
