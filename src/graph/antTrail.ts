// ============================================================================
// Ant Trail Transition — Path-Constrained Flow System
// ============================================================================
// Drones temporarily organize into ordered queues on one or more lane curves.
// Three TIME-BASED phases:
//   Entry  — drones ease from source positions to their lane queue slots
//   Trail  — convoy moves along the lane at constant speed with even spacing
//   Exit   — drones ease from lane queue to target positions
//
// Core invariants:
//   - During trail phase: constant speed, constant spacing, no overtaking
//   - All drones in a lane follow the same path curve
//   - Entry/exit use Hermite interpolation for C1 velocity continuity
//   - Deterministic: same inputs → same output
//
// The entryPhase/exitPhase parameters control what fraction of total time
// is allocated to the merge/peel phases. This ensures merge velocity is
// naturally bounded by (distance / entryTime) rather than by a tiny mergeD.
// ============================================================================

import type { Vec3 } from './types'
import type { PointMapping } from '../registries/transitions'
import { v3add, v3sub, v3scale, v3lerp, v3dist, v3len, v3normalize, v3cross, v3dot, centroid } from './vec3'

// ── Parameters ──────────────────────────────────────────────────────────────

export interface AntTrailParams {
  laneCount: number        // Number of parallel trail lanes (1–8, default 2)
  trailSpeed: number       // Constant speed along trail in m/s (default 6)
  spacing: number          // Target distance between consecutive drones in a lane (m, default 2)
  arcHeight: number        // Vertical arc of the trail path (default 5)
  laneSpread: number       // Lateral distance between outermost lanes (default 8)
  entryPhase: number       // Fraction of total time for entry merge (0.05–0.4, default 0.2)
  exitPhase: number        // Fraction of total time for exit split (0.05–0.4, default 0.2)
  zigzag: number           // Lateral sway amplitude during trail (0–3, default 0)
}

export const DEFAULT_ANT_TRAIL_PARAMS: AntTrailParams = {
  laneCount: 2,
  trailSpeed: 6,
  spacing: 2,
  arcHeight: 5,
  laneSpread: 8,
  entryPhase: 0.2,
  exitPhase: 0.2,
  zigzag: 0,
}

export function parseAntTrailParams(raw: Record<string, unknown>): AntTrailParams {
  const num = (key: string, fallback: number) => {
    const v = Number(raw[key])
    return isNaN(v) ? fallback : v
  }
  return {
    laneCount: Math.max(1, Math.min(8, Math.round(num('laneCount', DEFAULT_ANT_TRAIL_PARAMS.laneCount)))),
    trailSpeed: Math.max(0.5, num('trailSpeed', DEFAULT_ANT_TRAIL_PARAMS.trailSpeed)),
    spacing: Math.max(0.3, num('spacing', DEFAULT_ANT_TRAIL_PARAMS.spacing)),
    arcHeight: num('arcHeight', DEFAULT_ANT_TRAIL_PARAMS.arcHeight),
    laneSpread: Math.max(0, num('laneSpread', DEFAULT_ANT_TRAIL_PARAMS.laneSpread)),
    entryPhase: Math.max(0.05, Math.min(0.4, num('entryPhase', DEFAULT_ANT_TRAIL_PARAMS.entryPhase))),
    exitPhase: Math.max(0.05, Math.min(0.4, num('exitPhase', DEFAULT_ANT_TRAIL_PARAMS.exitPhase))),
    zigzag: Math.max(0, Math.min(3, num('zigzag', DEFAULT_ANT_TRAIL_PARAMS.zigzag))),
  }
}

// ── Cubic Bezier Spline ───────────────────────────────────────────────────

export interface LaneCurve {
  p0: Vec3  // start
  p1: Vec3  // control 1
  p2: Vec3  // control 2
  p3: Vec3  // end
  arcLengthTable: number[]
  totalLength: number
}

function sampleCubicBezier(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const omt = 1 - t
  const omt2 = omt * omt
  const omt3 = omt2 * omt
  const t2 = t * t
  const t3 = t2 * t
  return {
    x: omt3 * p0.x + 3 * omt2 * t * p1.x + 3 * omt * t2 * p2.x + t3 * p3.x,
    y: omt3 * p0.y + 3 * omt2 * t * p1.y + 3 * omt * t2 * p2.y + t3 * p3.y,
    z: omt3 * p0.z + 3 * omt2 * t * p1.z + 3 * omt * t2 * p2.z + t3 * p3.z,
  }
}

function sampleCubicBezierTangent(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const omt = 1 - t
  const omt2 = omt * omt
  const t2 = t * t
  return {
    x: 3 * omt2 * (p1.x - p0.x) + 6 * omt * t * (p2.x - p1.x) + 3 * t2 * (p3.x - p2.x),
    y: 3 * omt2 * (p1.y - p0.y) + 6 * omt * t * (p2.y - p1.y) + 3 * t2 * (p3.y - p2.y),
    z: 3 * omt2 * (p1.z - p0.z) + 6 * omt * t * (p2.z - p1.z) + 3 * t2 * (p3.z - p2.z),
  }
}

const ARC_TABLE_SAMPLES = 128

function buildLaneCurve(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): LaneCurve {
  const arcLengthTable: number[] = [0]
  let prev = p0
  let cumulative = 0
  for (let i = 1; i <= ARC_TABLE_SAMPLES; i++) {
    const t = i / ARC_TABLE_SAMPLES
    const pt = sampleCubicBezier(p0, p1, p2, p3, t)
    cumulative += v3dist(prev, pt)
    arcLengthTable.push(cumulative)
    prev = pt
  }
  return { p0, p1, p2, p3, arcLengthTable, totalLength: cumulative }
}

function distanceToParam(curve: LaneCurve, distance: number): number {
  if (distance <= 0) return 0
  if (distance >= curve.totalLength) return 1
  const table = curve.arcLengthTable
  let lo = 0, hi = table.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (table[mid]! <= distance) lo = mid
    else hi = mid
  }
  const d0 = table[lo]!, d1 = table[hi]!
  if (d1 === d0) return lo / ARC_TABLE_SAMPLES
  const frac = (distance - d0) / (d1 - d0)
  return (lo + frac) / ARC_TABLE_SAMPLES
}

export function sampleLaneAtDistance(curve: LaneCurve, distance: number): Vec3 {
  const t = distanceToParam(curve, distance)
  return sampleCubicBezier(curve.p0, curve.p1, curve.p2, curve.p3, t)
}

export function sampleLaneTangentAtDistance(curve: LaneCurve, distance: number): Vec3 {
  const t = distanceToParam(curve, distance)
  const raw = sampleCubicBezierTangent(curve.p0, curve.p1, curve.p2, curve.p3, t)
  return v3len(raw) > 0.0001 ? v3normalize(raw) : { x: 0, y: 0, z: 1 }
}

// ── Lane Geometry Builder ───────────────────────────────────────────────────

export interface TrailGeometry {
  lanes: LaneCurve[]
  srcCentroid: Vec3
  tgtCentroid: Vec3
  forward: Vec3
  lateral: Vec3
}

export function buildTrailGeometry(
  from: Vec3[],
  to: Vec3[],
  params: AntTrailParams,
): TrailGeometry {
  const srcCentroid = centroid(from)
  const tgtCentroid = centroid(to)

  const diff = v3sub(tgtCentroid, srcCentroid)
  const horizDiff = { x: diff.x, y: 0, z: diff.z }
  const horizLen = v3len(horizDiff)

  const forward = v3len(diff) > 0.001 ? v3normalize(diff) : { x: 0, y: 0, z: 1 }
  const up: Vec3 = { x: 0, y: 1, z: 0 }
  let lateral = v3cross(forward, up)
  if (v3len(lateral) < 0.001) {
    lateral = { x: 0, y: 0, z: 1 }
  } else {
    lateral = v3normalize(lateral)
  }

  const laneCount = Math.min(params.laneCount, Math.max(1, from.length))

  const lanes: LaneCurve[] = []
  for (let li = 0; li < laneCount; li++) {
    const laneFrac = laneCount === 1 ? 0 : (li / (laneCount - 1)) - 0.5
    const offset = v3scale(lateral, laneFrac * params.laneSpread)
    const inset = horizLen * 0.1
    const laneStart = v3add(v3add(srcCentroid, v3scale(forward, inset)), offset)
    const laneEnd = v3add(v3sub(tgtCentroid, v3scale(forward, inset)), offset)
    const arcOffset: Vec3 = { x: 0, y: params.arcHeight, z: 0 }
    const ctrl1 = v3add(v3add(v3lerp(srcCentroid, tgtCentroid, 0.33), offset), arcOffset)
    const ctrl2 = v3add(v3add(v3lerp(srcCentroid, tgtCentroid, 0.67), offset), arcOffset)
    lanes.push(buildLaneCurve(laneStart, ctrl1, ctrl2, laneEnd))
  }

  return { lanes, srcCentroid, tgtCentroid, forward, lateral }
}

// ── Drone-to-Lane Assignment ────────────────────────────────────────────────

export interface DroneSlot {
  droneIdx: number
  laneIdx: number
  slotInLane: number
  totalInLane: number
  sourcePos: Vec3
  targetPos: Vec3
}

export function assignDronesToLanes(
  mapping: PointMapping[],
  from: Vec3[],
  to: Vec3[],
  geometry: TrailGeometry,
): DroneSlot[] {
  const N = mapping.length
  if (N === 0) return []

  const laneCount = geometry.lanes.length

  interface DroneProj { mapIdx: number; lateralProj: number; forwardProj: number }
  const projections: DroneProj[] = []
  for (let mi = 0; mi < N; mi++) {
    const m = mapping[mi]!
    const src = from[m.sourceIndex]!
    const rel = v3sub(src, geometry.srcCentroid)
    projections.push({
      mapIdx: mi,
      lateralProj: v3dot(rel, geometry.lateral),
      forwardProj: v3dot(rel, geometry.forward),
    })
  }

  projections.sort((a, b) => a.lateralProj - b.lateralProj)

  const perLane = Math.floor(N / laneCount)
  let remainder = N - perLane * laneCount
  const laneSizes: number[] = []
  for (let li = 0; li < laneCount; li++) {
    laneSizes.push(perLane + (remainder > 0 ? 1 : 0))
    if (remainder > 0) remainder--
  }

  const laneGroups: DroneProj[][] = Array.from({ length: laneCount }, () => [])
  let offset = 0
  for (let li = 0; li < laneCount; li++) {
    for (let i = 0; i < laneSizes[li]!; i++) {
      laneGroups[li]!.push(projections[offset + i]!)
    }
    offset += laneSizes[li]!
  }

  const slots: DroneSlot[] = []
  for (let li = 0; li < laneCount; li++) {
    const group = laneGroups[li]!
    group.sort((a, b) => a.forwardProj - b.forwardProj)
    for (let si = 0; si < group.length; si++) {
      const dp = group[si]!
      const m = mapping[dp.mapIdx]!
      slots.push({
        droneIdx: dp.mapIdx,
        laneIdx: li,
        slotInLane: si,
        totalInLane: group.length,
        sourcePos: from[m.sourceIndex]!,
        targetPos: to[m.targetIndex]!,
      })
    }
  }

  return slots
}

// ── Easing ─────────────────────────────────────────────────────────────────

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}

// ── Hermite interpolation for C1-continuous entry/exit paths ───────────────

/**
 * Cubic Hermite interpolation between two points with tangent control.
 * p0/p1 are positions, m0/m1 are tangent vectors (velocity * duration).
 * t ∈ [0,1]. Produces C1-continuous path.
 */
function hermite(p0: Vec3, m0: Vec3, p1: Vec3, m1: Vec3, t: number): Vec3 {
  const t2 = t * t
  const t3 = t2 * t
  const h00 = 2 * t3 - 3 * t2 + 1
  const h10 = t3 - 2 * t2 + t
  const h01 = -2 * t3 + 3 * t2
  const h11 = t3 - t2
  return {
    x: h00 * p0.x + h10 * m0.x + h01 * p1.x + h11 * m1.x,
    y: h00 * p0.y + h10 * m0.y + h01 * p1.y + h11 * m1.y,
    z: h00 * p0.z + h10 * m0.z + h01 * p1.z + h11 * m1.z,
  }
}

// ── Per-Lane Metrics ────────────────────────────────────────────────────────

export interface LaneMetrics {
  mergeD: number
  exitD: number
  maxMergeDist: number
  maxExitDist: number
  totalTravel: number
  dronesInLane: number
}

export function computeLaneMetrics(
  lane: LaneCurve,
  laneSlots: DroneSlot[],
  params: AntTrailParams,
): LaneMetrics {
  const S = params.spacing
  const L = lane.totalLength
  const N = laneSlots.length

  const laneEntry = sampleLaneAtDistance(lane, 0)
  const laneExit = sampleLaneAtDistance(lane, L)

  let maxMergeDist = 0
  let maxExitDist = 0
  for (const slot of laneSlots) {
    maxMergeDist = Math.max(maxMergeDist, v3dist(slot.sourcePos, laneEntry))
    maxExitDist = Math.max(maxExitDist, v3dist(slot.targetPos, laneExit))
  }

  const mergeD = Math.max(S, 1.5)
  const exitD = Math.max(S, 1.5)
  const totalTravel = mergeD + L + Math.max(0, N - 1) * S + exitD

  return { mergeD, exitD, maxMergeDist, maxExitDist, totalTravel, dronesInLane: N }
}

// ── Geometry Cache ──────────────────────────────────────────────────────────
// Cache trail geometry across frames to prevent jumpiness from recomputation.
// Keyed on from/to centroid fingerprint.

interface CachedTrail {
  key: string
  geometry: TrailGeometry
  slots: DroneSlot[]
  laneGroups: DroneSlot[][]
  laneMetrics: LaneMetrics[]
}

let _cachedTrail: CachedTrail | null = null

function cacheKey(from: Vec3[], to: Vec3[], params: AntTrailParams): string {
  const sc = centroid(from)
  const tc = centroid(to)
  return `${from.length}:${sc.x.toFixed(2)},${sc.y.toFixed(2)},${sc.z.toFixed(2)}:${to.length}:${tc.x.toFixed(2)},${tc.y.toFixed(2)},${tc.z.toFixed(2)}:${params.laneCount}:${params.laneSpread}`
}

function getCachedTrail(
  mapping: PointMapping[],
  from: Vec3[],
  to: Vec3[],
  params: AntTrailParams,
): CachedTrail {
  const key = cacheKey(from, to, params)
  if (_cachedTrail && _cachedTrail.key === key) return _cachedTrail

  const geometry = buildTrailGeometry(from, to, params)
  const slots = assignDronesToLanes(mapping, from, to, geometry)
  const laneGroups: DroneSlot[][] = Array.from({ length: geometry.lanes.length }, () => [])
  for (const slot of slots) {
    laneGroups[slot.laneIdx]!.push(slot)
  }
  const laneMetrics = geometry.lanes.map((lane, li) =>
    computeLaneMetrics(lane, laneGroups[li]!, params)
  )

  _cachedTrail = { key, geometry, slots, laneGroups, laneMetrics }
  return _cachedTrail
}

// ── Trail Interpolation Engine ──────────────────────────────────────────────
//
// NEW MODEL: Time-based three-phase system
//
// The total transition time t ∈ [0,1] is split into three windows:
//   Entry  [0, entryPhase]     — drones ease from source to their lane queue slot
//   Trail  [entryPhase, 1-exitPhase] — convoy moves along lane at constant speed
//   Exit   [1-exitPhase, 1]    — drones ease from lane queue to target
//
// During ENTRY, each drone independently eases from sourcePos to its assigned
// lane entry point (staggered by slot index). The path uses cubic Hermite
// interpolation starting with zero velocity and ending with the lane tangent,
// giving C1 continuity at the entry→trail boundary.
//
// During TRAIL, the convoy moves at constant speed. Each drone's position is
// determined by its slot offset along the lane curve.
//
// During EXIT, symmetric to entry — Hermite from lane exit to targetPos.
//
// ============================================================================

export function interpolateAntTrail(
  mapping: PointMapping[],
  from: Vec3[],
  to: Vec3[],
  t: number,
  params: AntTrailParams,
  totalDuration: number,
): Vec3[] {
  const N = mapping.length
  if (N === 0) return []

  const clampedT = Math.max(0, Math.min(1, t))

  if (clampedT === 0) return mapping.map((m) => ({ ...from[m.sourceIndex]! }))
  if (clampedT === 1) return mapping.map((m) => ({ ...to[m.targetIndex]! }))

  // Use cached geometry to prevent jumpiness
  const cached = getCachedTrail(mapping, from, to, params)
  const { geometry, slots, laneMetrics } = cached

  const entryEnd = params.entryPhase
  const exitStart = 1 - params.exitPhase
  const trailFraction = Math.max(0.01, exitStart - entryEnd)

  const result: Vec3[] = new Array(N)

  for (const slot of slots) {
    const lane = geometry.lanes[slot.laneIdx]!
    const metrics = laneMetrics[slot.laneIdx]!
    result[slot.droneIdx] = computeDronePositionV2(
      slot, lane, geometry, clampedT, params, metrics,
      entryEnd, exitStart, trailFraction, totalDuration,
    )
  }

  return result
}

/**
 * New three-phase position computation for a single drone.
 */
function computeDronePositionV2(
  slot: DroneSlot,
  lane: LaneCurve,
  geometry: TrailGeometry,
  t: number,
  params: AntTrailParams,
  metrics: LaneMetrics,
  entryEnd: number,
  exitStart: number,
  trailFraction: number,
  _totalDuration: number,
): Vec3 {
  const { slotInLane, totalInLane, sourcePos, targetPos } = slot
  const L = lane.totalLength
  const S = params.spacing

  // Each drone's stagger within the entry/exit phase (later slots start later)
  const staggerFrac = totalInLane > 1 ? slotInLane / (totalInLane - 1) : 0

  // ── ENTRY PHASE ──────────────────────────────────────────────────────────
  if (t <= entryEnd) {
    // Drone's personal entry window: staggered within the entry phase
    // Front of queue (slot 0) starts at t=0 and finishes at ~entryEnd*0.8
    // Back of queue starts at ~entryEnd*0.3 and finishes at entryEnd
    const droneEntryStart = staggerFrac * entryEnd * 0.3
    const droneEntryEnd = entryEnd * (0.7 + staggerFrac * 0.3)
    const entryDuration = droneEntryEnd - droneEntryStart

    if (t < droneEntryStart) return { ...sourcePos }
    if (entryDuration <= 0) return { ...sourcePos }

    const localT = smoothstep((t - droneEntryStart) / entryDuration)

    // Target: the drone's slot position at the start of the lane
    // Slot 0 is at distance 0, slot 1 at distance S, etc.
    const slotDist = Math.min(slotInLane * S, L)
    const laneTarget = sampleLaneAtDistance(lane, slotDist)

    // Hermite interpolation: start with zero velocity, end aligned with lane tangent
    const tangent = sampleLaneTangentAtDistance(lane, slotDist)
    // Scale tangent by the estimated travel distance for a natural arc
    const travelDist = v3dist(sourcePos, laneTarget)
    const m0 = { x: 0, y: 0, z: 0 } // start from rest
    const m1 = v3scale(tangent, travelDist * 0.5) // arrive along lane direction

    return hermite(sourcePos, m0, laneTarget, m1, localT)
  }

  // ── EXIT PHASE ───────────────────────────────────────────────────────────
  if (t >= exitStart) {
    const droneExitStart = exitStart + (1 - staggerFrac) * params.exitPhase * 0.3
    const droneExitEnd = exitStart + params.exitPhase * (0.7 + (1 - staggerFrac) * 0.3)
    const exitDuration = droneExitEnd - droneExitStart

    if (t >= droneExitEnd) return { ...targetPos }
    if (exitDuration <= 0) return { ...targetPos }

    const localT = smoothstep((t - droneExitStart) / exitDuration)

    // Source: drone's slot position near the end of the lane
    const slotDistFromEnd = (totalInLane - 1 - slotInLane) * S
    const exitDist = Math.max(0, L - slotDistFromEnd)
    const laneSource = sampleLaneAtDistance(lane, exitDist)

    // Hermite: start along lane tangent, arrive at rest
    const tangent = sampleLaneTangentAtDistance(lane, exitDist)
    const travelDist = v3dist(laneSource, targetPos)
    const m0 = v3scale(tangent, travelDist * 0.5) // depart along lane direction
    const m1 = { x: 0, y: 0, z: 0 } // arrive at rest

    return hermite(laneSource, m0, targetPos, m1, localT)
  }

  // ── TRAIL PHASE ──────────────────────────────────────────────────────────
  // The convoy moves along the lane at constant speed.
  // At trailT=0 (entry just ended), slot 0 is at distance 0, slot 1 at S, etc.
  // At trailT=1 (exit about to start), slot N-1 is at L - 0, slot N-2 at L - S, etc.
  //
  // Total distance the head (slot 0) must travel during trail phase:
  //   from: 0 (its entry position)
  //   to: L - (totalInLane-1)*S + (totalInLane-1)*S = L (so the tail is at L)
  // Wait — we need all drones to reach their exit positions at the end of trail.
  // The last drone (slot N-1) starts at (N-1)*S. It needs to reach L-(N-1-N+1)*S = L.
  // Actually: at exit start, slot k should be at L - (totalInLane-1-k)*S
  // So the head (slot 0) must travel from 0 to L - (totalInLane-1)*S = L - tailOffset
  // and the tail (slot N-1) travels from (N-1)*S to L.
  // Both travel L - (N-1)*S distance. ✓

  const trailT = (t - entryEnd) / trailFraction

  // Head position at trailT=0: slot k is at k*S (entry end positions)
  // Head position at trailT=1: slot k is at L - (totalInLane-1-k)*S (exit start positions)
  // Linear interpolation between these:
  const startDist = slotInLane * S
  const endDist = L - (totalInLane - 1 - slotInLane) * S
  const droneDist = startDist + trailT * (endDist - startDist)
  const clampedDist = Math.max(0, Math.min(L, droneDist))

  let pos = sampleLaneAtDistance(lane, clampedDist)

  // Zigzag sway
  if (params.zigzag > 0 && L > 0) {
    const normalizedDist = clampedDist / L
    const sway = Math.sin(normalizedDist * Math.PI * 4 + slotInLane * 1.5) * params.zigzag * 0.3
    pos = v3add(pos, v3scale(geometry.lateral, sway))
  }

  return pos
}

// ── Minimum Duration Computation ────────────────────────────────────────────

export function computeAntTrailMinDuration(
  mapping: PointMapping[],
  from: Vec3[],
  to: Vec3[],
  params: AntTrailParams,
  maxVelocity?: number,
): number {
  if (mapping.length === 0) return 0

  const geometry = buildTrailGeometry(from, to, params)
  const slots = assignDronesToLanes(mapping, from, to, geometry)

  const laneGroups: DroneSlot[][] = Array.from({ length: geometry.lanes.length }, () => [])
  for (const slot of slots) {
    laneGroups[slot.laneIdx]!.push(slot)
  }

  let maxTotalTravel = 0
  let maxMerge = 0
  let maxExit = 0
  for (let li = 0; li < geometry.lanes.length; li++) {
    const metrics = computeLaneMetrics(geometry.lanes[li]!, laneGroups[li]!, params)
    maxTotalTravel = Math.max(maxTotalTravel, metrics.totalTravel)
    maxMerge = Math.max(maxMerge, metrics.maxMergeDist)
    maxExit = Math.max(maxExit, metrics.maxExitDist)
  }

  // Trail phase: convoy must travel lane length at trailSpeed
  const trailFraction = Math.max(0.01, 1 - params.entryPhase - params.exitPhase)
  let minDuration = maxTotalTravel / (params.trailSpeed * trailFraction)

  if (maxVelocity && maxVelocity > 0) {
    // Entry phase: drone must travel maxMergeDist in entryPhase * duration
    // → duration ≥ maxMergeDist / (maxVelocity * entryPhase)
    if (params.entryPhase > 0 && maxMerge > 0) {
      minDuration = Math.max(minDuration, maxMerge / (maxVelocity * params.entryPhase))
    }
    // Exit phase: same logic
    if (params.exitPhase > 0 && maxExit > 0) {
      minDuration = Math.max(minDuration, maxExit / (maxVelocity * params.exitPhase))
    }
    // Trail speed constraint
    minDuration = Math.max(minDuration, maxTotalTravel / (maxVelocity * trailFraction))
  }

  return Math.ceil(minDuration * 10) / 10
}

// ── Exports for testing ─────────────────────────────────────────────────────

export { sampleCubicBezier, buildLaneCurve, distanceToParam, smoothstep }
export { centroid }
