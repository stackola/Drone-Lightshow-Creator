// ============================================================================
// Show-Wide Physics Validator
// ============================================================================
// Scans the entire show graph for physics violations:
//   1. Transition too short — strategy needs more time than available
//   2. Keyframe velocity — formation transform moves too fast between keyframes
//   3. Shortest-path velocity — straight-line transition exceeds maxVelocity
//
// Returns a list of violations with severity, description, affected nodes,
// and a suggested auto-fix (e.g. "push downstream by X seconds").
//
// This is a pure function — no side effects, no store dependencies.
// ============================================================================

import type { ShowGraph, ShowEdge, FormationNodeData, IdleNodeData, Vec3 } from './types'
import type { Constraints } from '../stores/projectStore'
import { computeTiming, type TimeRange } from './timing'
import { getTransition, toTransitionConstraints, type TransitionConstraints } from '../registries/transitions'
import { getIdleBehavior } from '../registries/idleBehaviors'
import { interpolateTransform, applyTransform } from './interpolateTransform'
import { evaluateAtTime } from './evaluate'

// ── Named constants (replaces inline magic numbers, plan §S10) ──────────────

/** Tolerance for "current duration vs minRequired" comparison.
 *  We only flag when the gap exceeds this — so a 0.99 s tolerance isn't a
 *  violation against a 1.0 s requirement. Smaller = stricter. */
const DURATION_VIOLATION_TOLERANCE_S = 0.05

/** Sample timestep when scanning idle behaviors for velocity peaks. 50 ms ≈
 *  20 Hz, fine enough to catch the peaks but cheap to compute. */
const IDLE_VELOCITY_SAMPLE_DT_S = 0.05

/** Number of interior time samples when probing transitions for collisions.
 *  More samples = slower validator, fewer false negatives. */
const TRANSITION_MID_SAMPLES = 5

/** Range of the interior fractions (avoid t=0 and t=1 where strategies are
 *  guaranteed to land on source / target points). */
const TRANSITION_FRAC_MIN = 0.1
const TRANSITION_FRAC_MAX = 0.9

/** Floor for division-by-near-zero distances when computing required-duration
 *  ratios. Prevents NaN / Infinity in degenerate stationary cases. */
const MIN_DIST_FLOOR_M = 0.01

// ── Violation Types ──────────────────────────────────────────────────────────

export type ViolationType =
  | 'transition-too-short'
  | 'keyframe-too-fast'

export type FixType =
  | 'push-downstream'
  | 'extend-formation'
  | 'extend-transition'

export interface ViolationFix {
  type: FixType
  nodeId: string
  /** Set for `extend-transition` fixes — identifies the edge whose transition.preferredDuration grows. */
  edgeId?: string
  delta: number           // seconds to add
  description: string
}

export interface PhysicsViolation {
  id: string              // unique violation id
  type: ViolationType
  severity: 'error' | 'warning'
  nodeId: string          // the node with the violation (for edges, the downstream target)
  /** Set when the violation originates from a flow edge's transition. */
  edgeId?: string
  message: string
  detail: string          // longer explanation
  fix: ViolationFix | null
}

// ── Validator ────────────────────────────────────────────────────────────────

export function validateShowPhysics(
  graph: ShowGraph,
  constraints: Constraints,
  formations: Map<string, Vec3[]>,
  homePositions: Vec3[] = [],
): PhysicsViolation[] {
  const violations: PhysicsViolation[] = []
  // S15-03/04/05/07: Apply wind, GPS, safety margins to effective constraints
  const transConstraints = toTransitionConstraints(constraints)
  // Slice 1: use the cascade-push-aware timing solver so currentDuration reflects the
  // engine's effective duration (preferredDuration extended by minRequired if needed).
  // Without this, the validator would report transition-too-short for transitions the
  // engine has already auto-extended.
  const timingResult = computeTiming(graph, { formations, homePositions, constraints: transConstraints, mode: 'cascade-push' })
  const timing = timingResult.ranges
  const edgeTiming = timingResult.edgeRanges

  // 1. Check each flow edge's transition window
  checkEdgeTransitions(graph, timing, edgeTiming, formations, transConstraints, homePositions, violations)

  // 2. Check formation keyframe velocities (S15-03: wind-adjusted effective velocity)
  const windEffect = (constraints.windSpeed ?? 0) * (constraints.windGustFactor ?? 1)
  const velMargin = constraints.safetyMarginVelocity ?? 0
  const effectiveConstraints = {
    ...constraints,
    maxVelocity: Math.max(0.5, constraints.maxVelocity * (1 - velMargin) - windEffect),
  }
  checkKeyframeVelocities(graph, timing, formations, effectiveConstraints, violations)

  // 3. Check minimum spacing within formations
  // Use raw minDroneDistance for static formation checks — GPS/safety margins
  // are for transition dynamics, not formation layout (generators already respect spacing)
  checkFormationSpacing(graph, formations, constraints, violations)

  // 4. Check altitude bounds on formations
  checkAltitudeBounds(graph, formations, constraints, violations)

  // 5. Check geofence radius on formations
  checkGeofenceBounds(graph, formations, constraints, violations)

  // 6. Check idle behavior velocities
  checkIdleVelocities(graph, timing, constraints, violations)

  // 7. Check total show duration against battery life
  checkFlightTime(timing, constraints, violations)

  // S15-01: Check keyframe jerk (rate of acceleration change)
  checkKeyframeJerk(graph, timing, formations, constraints, violations)

  // S15-02: Check ascent/descent rates
  checkAscentDescentRates(graph, timing, formations, constraints, violations)

  // S11-11/S15-11: Continuous collision detection during transitions (per-edge)
  checkTransitionCollisions(graph, edgeTiming, formations, constraints, homePositions, violations)

  return violations
}

// ── S15-01: Jerk Constraint ─────────────────────────────────────────────────

function checkKeyframeJerk(
  graph: ShowGraph,
  timing: Map<string, TimeRange>,
  formations: Map<string, Vec3[]>,
  constraints: Constraints,
  violations: PhysicsViolation[],
): void {
  const maxJerk = constraints.maxJerk ?? 20
  if (maxJerk <= 0) return

  for (const node of graph.nodes) {
    if (node.type !== 'formation') continue
    const data = node.data as FormationNodeData
    if (data.keyframes.length < 2) continue

    const points = data.formationId ? formations.get(data.formationId) : null
    if (!points || points.length === 0) continue

    // Sample acceleration at 3 time points and check rate of change
    const kfs = [{ time: 0, transform: data.transform }, ...data.keyframes]
    for (let i = 2; i < kfs.length; i++) {
      const kf0 = kfs[i - 2]!, kf1 = kfs[i - 1]!, kf2 = kfs[i]!
      const dt01 = kf1.time - kf0.time
      const dt12 = kf2.time - kf1.time
      if (dt01 <= 0 || dt12 <= 0) continue

      const pt = points[0]!
      const p0 = applyTransform(pt, interpolateTransform(data.transform, data.keyframes, kf0.time))
      const p1 = applyTransform(pt, interpolateTransform(data.transform, data.keyframes, kf1.time))
      const p2 = applyTransform(pt, interpolateTransform(data.transform, data.keyframes, kf2.time))

      const v01 = Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2 + (p1.z - p0.z) ** 2) / dt01
      const v12 = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2 + (p2.z - p1.z) ** 2) / dt12
      const a01 = v01 / dt01
      const a12 = v12 / dt12
      const jerk = Math.abs(a12 - a01) / ((dt01 + dt12) / 2)

      if (jerk > maxJerk) {
        violations.push({
          id: `jerk-${node.id}-${i}`,
          type: 'keyframe-too-fast',
          severity: 'warning',
          nodeId: node.id,
          message: `Jerk ${jerk.toFixed(1)} m/s³ exceeds limit ${maxJerk} m/s³`,
          detail: `Acceleration changes too rapidly between keyframes ${i - 1} and ${i}. Smooth the motion with gentler easing.`,
          fix: {
            type: 'extend-formation',
            nodeId: node.id,
            delta: 1,
            description: `Extend duration by 1s to reduce jerk`,
          },
        })
        break // One violation per node is enough
      }
    }
  }
}

// ── S15-02: Ascent/Descent Rate Constraints ─────────────────────────────────

function checkAscentDescentRates(
  graph: ShowGraph,
  timing: Map<string, TimeRange>,
  formations: Map<string, Vec3[]>,
  constraints: Constraints,
  violations: PhysicsViolation[],
): void {
  const maxAscent = constraints.maxAscentRate ?? 4
  const maxDescent = constraints.maxDescentRate ?? 3

  for (const node of graph.nodes) {
    if (node.type !== 'formation') continue
    const data = node.data as FormationNodeData
    if (data.keyframes.length === 0) continue

    const points = data.formationId ? formations.get(data.formationId) : null
    if (!points || points.length === 0) continue

    const kfs = [{ time: 0, transform: data.transform }, ...data.keyframes]
    for (let i = 1; i < kfs.length; i++) {
      const kf0 = kfs[i - 1]!, kf1 = kfs[i]!
      const dt = kf1.time - kf0.time
      if (dt <= 0) continue

      const pt = points[0]!
      const p0 = applyTransform(pt, interpolateTransform(data.transform, data.keyframes, kf0.time))
      const p1 = applyTransform(pt, interpolateTransform(data.transform, data.keyframes, kf1.time))

      const verticalRate = (p1.y - p0.y) / dt

      if (verticalRate > maxAscent) {
        violations.push({
          id: `ascent-${node.id}-${i}`,
          type: 'keyframe-too-fast',
          severity: 'warning',
          nodeId: node.id,
          message: `Ascent rate ${verticalRate.toFixed(1)} m/s exceeds limit ${maxAscent} m/s`,
          detail: `Vertical climb between keyframes ${i - 1} and ${i} is too fast.`,
          fix: {
            type: 'extend-formation',
            nodeId: node.id,
            delta: Math.min(60, Math.ceil((verticalRate / maxAscent - 1) * data.duration * 10) / 10),
            description: `Extend duration to slow ascent`,
          },
        })
        break
      }

      if (-verticalRate > maxDescent) {
        violations.push({
          id: `descent-${node.id}-${i}`,
          type: 'keyframe-too-fast',
          severity: 'warning',
          nodeId: node.id,
          message: `Descent rate ${(-verticalRate).toFixed(1)} m/s exceeds limit ${maxDescent} m/s`,
          detail: `Vertical descent between keyframes ${i - 1} and ${i} is too fast.`,
          fix: {
            type: 'extend-formation',
            nodeId: node.id,
            delta: Math.min(60, Math.ceil((-verticalRate / maxDescent - 1) * data.duration * 10) / 10),
            description: `Extend duration to slow descent`,
          },
        })
        break
      }
    }
  }
}

// ── Per-edge Transition Duration Checks ─────────────────────────────────────

function checkEdgeTransitions(
  graph: ShowGraph,
  _timing: Map<string, TimeRange>,
  edgeTiming: Map<string, TimeRange>,
  formations: Map<string, Vec3[]>,
  constraints: TransitionConstraints,
  homePositions: Vec3[],
  violations: PhysicsViolation[],
): void {
  for (const edge of graph.edges) {
    if (edge.edgeType !== 'flow' || !edge.transition) continue
    const cfg = edge.transition
    const strategy = getTransition(cfg.strategyId)
    if (!strategy?.computeMinDuration) continue

    const eTime = edgeTiming.get(edge.id)
    if (!eTime) continue
    const currentDuration = eTime.end - eTime.start

    const srcNode = graph.nodes.find((n) => n.id === edge.source)
    const tgtNode = graph.nodes.find((n) => n.id === edge.target)
    if (!srcNode || !tgtNode) continue

    const fromPts: Vec3[] = []
    const toPts: Vec3[] = []

    if (srcNode.type === 'formation') {
      const fd = srcNode.data as FormationNodeData
      const pts = fd.formationId ? formations.get(fd.formationId) : null
      if (pts) {
        const transform = interpolateTransform(fd.transform, fd.keyframes, fd.duration)
        fromPts.push(...pts.map((p) => applyTransform(p, transform)))
      }
    } else if (srcNode.type === 'launch') {
      const riseHeight = 8
      const droneCount = Math.min(20, (srcNode.data as { droneCount: number }).droneCount)
      for (let i = 0; i < droneCount; i++) {
        const hx = homePositions.length > i ? homePositions[i]!.x : 0
        const hz = homePositions.length > i ? homePositions[i]!.z : 0
        fromPts.push({ x: hx, y: riseHeight, z: hz })
      }
    }

    if (tgtNode.type === 'formation') {
      const fd = tgtNode.data as FormationNodeData
      const pts = fd.formationId ? formations.get(fd.formationId) : null
      if (pts) {
        const transform = interpolateTransform(fd.transform, fd.keyframes, 0)
        toPts.push(...pts.map((p) => applyTransform(p, transform)))
      }
    }

    if (fromPts.length === 0 || toPts.length === 0) continue

    const mapping = strategy.mapPoints(fromPts, toPts, [], [])
    const paramsWithDuration = { ...cfg.parameters, _totalDuration: currentDuration }
    const minDuration = strategy.computeMinDuration(mapping, fromPts, toPts, paramsWithDuration, constraints)

    if (minDuration > currentDuration + DURATION_VIOLATION_TOLERANCE_S) {
      const delta = minDuration - currentDuration
      const strategyName = strategy.name

      violations.push({
        id: `trans-short-${edge.id}`,
        type: 'transition-too-short',
        severity: 'error',
        nodeId: edge.target,
        edgeId: edge.id,
        message: `${strategyName} needs ${minDuration.toFixed(1)}s (has ${currentDuration.toFixed(1)}s)`,
        detail: `The "${strategyName}" transition on this edge requires at least ${minDuration.toFixed(1)}s to keep drone velocities within ${constraints.maxVelocity} m/s. Currently only ${currentDuration.toFixed(1)}s is available. Either extend the edge's preferredDuration or push the downstream formation later.`,
        fix: {
          type: 'extend-transition',
          nodeId: edge.target,
          edgeId: edge.id,
          delta: Math.ceil(delta * 10) / 10,
          description: `Extend transition +${(Math.ceil(delta * 10) / 10).toFixed(1)}s`,
        },
      })
    }
  }
}

// ── Keyframe Velocity Checks ─────────────────────────────────────────────────

function checkKeyframeVelocities(
  graph: ShowGraph,
  timing: Map<string, TimeRange>,
  formations: Map<string, Vec3[]>,
  constraints: Constraints,
  violations: PhysicsViolation[],
): void {
  for (const node of graph.nodes) {
    if (node.type !== 'formation') continue
    const data = node.data as FormationNodeData
    if (data.keyframes.length === 0) continue

    const pts = data.formationId ? formations.get(data.formationId) : null
    if (!pts || pts.length === 0) continue

    // Sample the formation transform at keyframe-driven times below.
    let maxVelocity = 0
    let worstTime = 0

    // Build time points: base (0) + all keyframe times
    const times: number[] = [0]
    for (const kf of data.keyframes) {
      times.push(kf.time)
    }
    times.push(data.duration)

    // Sub-sample within each keyframe segment to catch peak instantaneous velocity
    // (average velocity between keyframes can miss peaks from non-linear easing)
    const subsamplesPerSegment = 8
    for (let i = 0; i < times.length - 1; i++) {
      const t0 = times[i]!
      const t1 = times[i + 1]!
      const segDt = t1 - t0
      if (segDt <= 0) continue

      const steps = Math.max(1, subsamplesPerSegment)
      const stepDt = segDt / steps

      for (let s = 0; s < steps; s++) {
        const sampleT0 = t0 + s * stepDt
        const sampleT1 = t0 + (s + 1) * stepDt
        const dt = sampleT1 - sampleT0
        if (dt <= 0) continue

        const transform0 = interpolateTransform(data.transform, data.keyframes, sampleT0)
        const transform1 = interpolateTransform(data.transform, data.keyframes, sampleT1)

        for (const pt of pts) {
          const p0 = applyTransform(pt, transform0)
          const p1 = applyTransform(pt, transform1)
          const dist = Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2 + (p1.z - p0.z) ** 2)
          const velocity = dist / dt
          if (velocity > maxVelocity) {
            maxVelocity = velocity
            worstTime = sampleT0
          }
        }
      }
    }

    if (maxVelocity > constraints.maxVelocity) {
      // Compute how much to extend (and rescale keyframes) to bring velocity in line
      const ratio = maxVelocity / constraints.maxVelocity
      const neededDuration = data.duration * ratio
      const rawDelta = neededDuration - data.duration
      // Cap fix delta to 60s max — beyond that the show structure needs redesign, not time-stretching
      const delta = Math.min(rawDelta, 60)

      violations.push({
        id: `kf-fast-${node.id}`,
        type: 'keyframe-too-fast',
        severity: 'error',
        nodeId: node.id,
        message: `Keyframe motion ${maxVelocity.toFixed(1)} m/s (limit ${constraints.maxVelocity.toFixed(1)} m/s)`,
        detail: `Formation keyframe at t=${worstTime.toFixed(1)}s moves drones at ${maxVelocity.toFixed(1)} m/s, exceeding the ${constraints.maxVelocity.toFixed(1)} m/s limit.${rawDelta > 60 ? ' Consider using a smaller formation or slower keyframe motion.' : ''}`,
        fix: {
          type: 'extend-formation',
          nodeId: node.id,
          delta: Math.ceil(delta * 10) / 10,
          description: `Extend +${(Math.ceil(delta * 10) / 10).toFixed(1)}s (rescales keyframes)`,
        },
      })
    }
  }
}

// ── Formation Spacing Checks ───────────────────────────────────────────────

function checkFormationSpacing(
  graph: ShowGraph,
  formations: Map<string, Vec3[]>,
  constraints: Constraints,
  violations: PhysicsViolation[],
): void {
  const minDist = constraints.minDroneDistance
  for (const node of graph.nodes) {
    if (node.type !== 'formation') continue
    const data = node.data as FormationNodeData
    const pts = data.formationId ? formations.get(data.formationId) : null
    if (!pts || pts.length < 2) continue

    const transform = interpolateTransform(data.transform, data.keyframes, 0)
    const worldPts = pts.map((p) => applyTransform(p, transform))

    let minFound = Infinity
    for (let i = 0; i < worldPts.length; i++) {
      for (let j = i + 1; j < worldPts.length; j++) {
        const a = worldPts[i]!, b = worldPts[j]!
        const d = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
        if (d < minFound) minFound = d
      }
    }

    if (minFound < minDist) {
      const scaleNeeded = (minDist / Math.max(MIN_DIST_FLOOR_M, minFound)).toFixed(1)

      violations.push({
        id: `spacing-${node.id}`,
        type: 'keyframe-too-fast',
        severity: 'warning',
        nodeId: node.id,
        message: `Min drone spacing ${minFound.toFixed(2)}m < ${minDist.toFixed(1)}m limit`,
        detail: `Two or more drones in this formation are closer than ${minDist.toFixed(1)}m (closest pair: ${minFound.toFixed(2)}m). Scale the formation transform up by ${scaleNeeded}x or increase generator spacing/radius.`,
        fix: null,
      })
    }
  }
}

// ── Altitude Bounds Checks ─────────────────────────────────────────────────

function checkAltitudeBounds(
  graph: ShowGraph,
  formations: Map<string, Vec3[]>,
  constraints: Constraints,
  violations: PhysicsViolation[],
): void {
  for (const node of graph.nodes) {
    if (node.type !== 'formation') continue
    const data = node.data as FormationNodeData
    const pts = data.formationId ? formations.get(data.formationId) : null
    if (!pts || pts.length === 0) continue

    const transform = interpolateTransform(data.transform, data.keyframes, 0)
    for (const pt of pts) {
      const p = applyTransform(pt, transform)
      if (p.y < constraints.altitudeMin) {
        violations.push({
          id: `alt-low-${node.id}`,
          type: 'keyframe-too-fast',
          severity: 'warning',
          nodeId: node.id,
          message: `Drone below minimum altitude (${p.y.toFixed(1)}m < ${constraints.altitudeMin}m)`,
          detail: `One or more drones in this formation are below the minimum altitude of ${constraints.altitudeMin}m.`,
          fix: null,
        })
        break
      }
      if (p.y > constraints.altitudeMax) {
        violations.push({
          id: `alt-high-${node.id}`,
          type: 'keyframe-too-fast',
          severity: 'warning',
          nodeId: node.id,
          message: `Drone above maximum altitude (${p.y.toFixed(1)}m > ${constraints.altitudeMax}m)`,
          detail: `One or more drones in this formation exceed the altitude limit of ${constraints.altitudeMax}m.`,
          fix: null,
        })
        break
      }
    }
  }
}

// ── Geofence Bounds Checks ─────────────────────────────────────────────────

function checkGeofenceBounds(
  graph: ShowGraph,
  formations: Map<string, Vec3[]>,
  constraints: Constraints,
  violations: PhysicsViolation[],
): void {
  const maxR = constraints.geofenceRadius
  for (const node of graph.nodes) {
    if (node.type !== 'formation') continue
    const data = node.data as FormationNodeData
    const pts = data.formationId ? formations.get(data.formationId) : null
    if (!pts || pts.length === 0) continue

    const transform = interpolateTransform(data.transform, data.keyframes, 0)
    for (const pt of pts) {
      const p = applyTransform(pt, transform)
      const r = Math.sqrt(p.x * p.x + p.z * p.z)
      if (r > maxR) {
        violations.push({
          id: `geofence-${node.id}`,
          type: 'keyframe-too-fast',
          severity: 'error',
          nodeId: node.id,
          message: `Drone outside geofence (${r.toFixed(1)}m > ${maxR}m radius)`,
          detail: `One or more drones are positioned outside the ${maxR}m geofence radius.`,
          fix: null,
        })
        break
      }
    }
  }
}

// ── Flight Time (Battery) Check ────────────────────────────────────────────

function checkFlightTime(
  timing: Map<string, TimeRange>,
  constraints: Constraints,
  violations: PhysicsViolation[],
): void {
  let maxEnd = 0
  let lastNodeId = ''
  for (const [nodeId, range] of timing) {
    if (range.end > maxEnd) {
      maxEnd = range.end
      lastNodeId = nodeId
    }
  }
  // S15-06: Account for battery reserve
  const effectiveFlightTime = constraints.maxFlightTime * (1 - (constraints.batteryReserve ?? 0))
  if (maxEnd > effectiveFlightTime) {
    violations.push({
      id: 'flight-time',
      type: 'keyframe-too-fast',
      severity: 'error',
      nodeId: lastNodeId,
      message: `Show duration ${maxEnd.toFixed(0)}s exceeds battery limit ${effectiveFlightTime.toFixed(0)}s`,
      detail: `Total show duration of ${maxEnd.toFixed(0)}s exceeds the effective flight time of ${effectiveFlightTime.toFixed(0)}s (${(effectiveFlightTime / 60).toFixed(0)} min, with ${Math.round((constraints.batteryReserve ?? 0) * 100)}% battery reserve).`,
      fix: null,
    })
  }
}

// ── Idle Behavior Velocity Checks ──────────────────────────────────────────

function checkIdleVelocities(
  graph: ShowGraph,
  timing: Map<string, TimeRange>,
  constraints: Constraints,
  violations: PhysicsViolation[],
): void {
  for (const node of graph.nodes) {
    if (node.type !== 'idle') continue
    const data = node.data as IdleNodeData
    const behavior = getIdleBehavior(data.behavior)
    if (!behavior) continue

    const nodeTime = timing.get(node.id)
    if (!nodeTime) continue

    // Sample velocity by checking position delta over small dt
    const dt = IDLE_VELOCITY_SAMPLE_DT_S
    const home: Vec3 = { x: 0, y: 0, z: 0 }
    const params = { center: data.center, radius: data.radius, speed: data.speed, altitude: data.altitude }
    let maxV = 0

    // Check a few drones at a few time samples
    const dronesToCheck = 5 // sample 5 representative drones
    for (let di = 0; di < dronesToCheck; di++) {
      for (let t = nodeTime.start; t < nodeTime.end - dt; t += 0.5) {
        const p0 = behavior.getPosition(di, dronesToCheck, t, params, home)
        const p1 = behavior.getPosition(di, dronesToCheck, t + dt, params, home)
        const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z
        const v = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt
        if (v > maxV) maxV = v
      }
    }

    if (maxV > constraints.maxVelocity) {
      violations.push({
        id: `idle-vel-${node.id}`,
        type: 'keyframe-too-fast',
        severity: 'warning',
        nodeId: node.id,
        message: `Idle behavior peak velocity ${maxV.toFixed(1)} m/s (limit ${constraints.maxVelocity} m/s)`,
        detail: `The "${data.behavior}" idle behavior with speed=${data.speed} radius=${data.radius} produces peak velocity of ${maxV.toFixed(1)} m/s. Reduce speed or radius.`,
        fix: null,
      })
    }

    // S7-04: Swarm collision check — sample pairwise distances
    if (data.behavior === 'swarm' && data.radius > 0) {
      const totalDrones = 20 // check a representative set
      let minDist = Infinity
      for (let t = nodeTime.start; t < nodeTime.end; t += 1.0) {
        const positions: Vec3[] = []
        for (let di = 0; di < totalDrones; di++) {
          positions.push(behavior.getPosition(di, totalDrones, t, params, home))
        }
        for (let a = 0; a < positions.length; a++) {
          for (let b = a + 1; b < positions.length; b++) {
            const pa = positions[a]!, pb = positions[b]!
            const d = Math.sqrt((pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2 + (pa.z - pb.z) ** 2)
            if (d < minDist) minDist = d
          }
        }
      }
      if (minDist < constraints.minDroneDistance) {
        violations.push({
          id: `swarm-spacing-${node.id}`,
          type: 'keyframe-too-fast',
          severity: 'warning',
          nodeId: node.id,
          message: `Swarm min spacing ${minDist.toFixed(2)}m < ${constraints.minDroneDistance}m`,
          detail: `The swarm idle behavior brings drones within ${minDist.toFixed(2)}m of each other, below the ${constraints.minDroneDistance}m limit. Increase radius or reduce drone count.`,
          fix: null,
        })
      }
    }
  }
}

// ── S11-11/S15-11: Continuous Collision Detection During Transitions ────────

function checkTransitionCollisions(
  graph: ShowGraph,
  edgeTiming: Map<string, TimeRange>,
  formations: Map<string, Vec3[]>,
  constraints: Constraints,
  homePositions: Vec3[],
  violations: PhysicsViolation[],
): void {
  if (homePositions.length < 2) return

  const evalConstraints = toTransitionConstraints(constraints)
  const minDist = evalConstraints.motionSpacing
  const MID_SAMPLES = TRANSITION_MID_SAMPLES

  for (const edge of graph.edges) {
    if (edge.edgeType !== 'flow' || !edge.transition) continue
    const eTime = edgeTiming.get(edge.id)
    if (!eTime) continue

    const duration = eTime.end - eTime.start
    if (duration <= 0) continue

    const evalOpts = { constraints: toTransitionConstraints(constraints) }
    const firstStates = evaluateAtTime(graph, formations, eTime.start, homePositions, undefined, evalOpts)
    const N = firstStates.length

    let collisionFound = false
    let worstDist = Infinity
    let worstT = 0

    // Severity policy after the per-frame nudge resolver was removed:
    //   d < motionSpacing × 0.3 → error  (drones effectively coincident — show breaks)
    //   d < motionSpacing       → warning (close pass — author may want to extend duration)
    // The previous 5% slack existed because the iterative nudge sometimes left
    // residual sub-1% violations; without the nudge there's no residual, so the
    // threshold is exact motionSpacing.
    const TIGHT_THRESHOLD = minDist * 0.3
    for (let s = 0; s < MID_SAMPLES; s++) {
      const frac = TRANSITION_FRAC_MIN + (s / (MID_SAMPLES - 1)) * (TRANSITION_FRAC_MAX - TRANSITION_FRAC_MIN)
      const t = eTime.start + frac * duration
      const states = evaluateAtTime(graph, formations, t, homePositions, undefined, evalOpts)

      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const a = states[i]!, b = states[j]!
          const dx = a.position.x - b.position.x
          const dy = a.position.y - b.position.y
          const dz = a.position.z - b.position.z
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
          if (d >= minDist) continue
          if (d < worstDist) {
            worstDist = d
            worstT = t
            collisionFound = true
          }
        }
      }

      if (collisionFound) break
    }

    if (collisionFound) {
      const neededDuration = duration * (minDist / Math.max(worstDist, MIN_DIST_FLOOR_M))
      const delta = Math.max(0.5, neededDuration - duration)
      const severity: 'error' | 'warning' = worstDist < TIGHT_THRESHOLD ? 'error' : 'warning'

      violations.push({
        id: `trans-collision-${edge.id}`,
        type: 'transition-too-short',
        severity,
        nodeId: edge.target,
        edgeId: edge.id,
        message: `Path collision: drones pass within ${worstDist.toFixed(2)}m (min ${minDist.toFixed(1)}m) at t=${worstT.toFixed(1)}s`,
        detail: `Continuous collision detection found crossing/converging paths during this transition. At t=${worstT.toFixed(1)}s, two drones come within ${worstDist.toFixed(2)}m of each other, violating the ${minDist.toFixed(1)}m minimum spacing. Extend the transition duration to give drones more time to separate.`,
        fix: {
          type: 'extend-transition',
          nodeId: edge.target,
          edgeId: edge.id,
          delta: Math.ceil(delta * 10) / 10,
          description: `Extend transition +${(Math.ceil(delta * 10) / 10).toFixed(1)}s to resolve path crossing`,
        },
      })
    }
  }
}
