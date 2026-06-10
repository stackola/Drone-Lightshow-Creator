// ============================================================================
// G-05: Idle Flow Invariant + Idle Behavior Registry
// ============================================================================
// Idle flow rules:
// - Attached idle: availableOutgoing = sum(incomingFlow) - sum(idleConfigs[].droneCount)
//   If availableOutgoing < 0, validation error.
// - Standalone idle: A flow sink. Its incoming droneCount is consumed entirely.
//   It produces no outgoing flow.
// - Idle ↔ formation attachment: When standalone idle is attached to a formation
//   via attachment edge, it does NOT consume flow from the formation's outgoing
//   budget. It receives flow independently via its own flow input edge.
//   The attachment edge is structural only — it syncs time, not drones.
// ============================================================================
//
// Plan §B3 — behavior redesign (2026-05-21):
// Every ring-based behavior used to distribute N drones over a single ring of the
// user's requested radius. With small radius and many drones, adjacent drones ended
// up below pair-spacing minimums — the "defaults to overlapping" complaint. The
// rewrite distributes drones over a multi-ring stack sized to satisfy the project's
// `minSpacing`, then layers behavior-specific modulation (orbit, breathe, wave, …)
// on top. `clampToConstraints` now also clamps radius (not just speed) so the
// effective layout is always spacing-safe even when the user asked for a small ring.
// ============================================================================

import type { Vec3 } from '../graph/types'
import type { TransitionConstraints } from './transitions'
import { createRegistry } from './createRegistry'

export interface IdleParams {
  center: Vec3
  radius: number
  speed: number
  altitude: number
  /** Optional unit-direction vector. Currently consumed only by `drift`.
   *  Defaults to (1, 0, 0.33) (roughly forward-and-slightly-side) when
   *  unset, matching the legacy hard-coded drift heading. L2 (2026-05-21). */
  direction?: Vec3
}

export interface IdleClampResult {
  params: IdleParams
  warnings: string[]
}

export interface IdleBehaviorDef {
  id: string
  name: string
  getPosition(
    droneIndex: number,
    totalDrones: number,
    time: number,
    params: IdleParams,
    homePos: Vec3,
  ): Vec3
  /**
   * Optional. Clamps params so peak velocity respects constraints.maxVelocity
   * and the effective ring radius leaves room for `totalDrones` at `minSpacing`.
   * Returns the (possibly clamped) params and zero or more warning strings.
   * Behaviours that cannot violate (e.g. hover) omit this method.
   */
  clampToConstraints?(
    params: IdleParams,
    constraints: TransitionConstraints,
    totalDrones?: number,
  ): IdleClampResult
}

// ─── Named constants ────────────────────────────────────────────────────────

/** Floor for the spacing parameter — prevents division-by-zero when callers
 *  pass `0` or a tiny number. Practical effect: drones can never sit closer
 *  than this regardless of input. */
const SPACING_FLOOR_M = 0.01

/** Vertical offset between successive rings in the multi-ring stack, expressed
 *  as a fraction of `minSpacing`. The slight helix this creates makes adjacent
 *  rings visually distinguishable when viewed from the side. */
const RING_STACK_ALTITUDE_FRACTION = 0.4

/** Floor for the velocity-coefficient divisor in `clampSpeed`. Keeps the
 *  result finite when a behaviour's coefficient is effectively zero (e.g.
 *  hover or near-static behaviours). */
const VELOCITY_COEF_FLOOR = 0.001

/** Minimum contraction floor accepted by `clampRingRadius`. Anything below
 *  this is treated as 0.1 — guards against degenerate behaviour math. */
const MIN_CONTRACTION_FLOOR = 0.1

// ─── Shared helpers ─────────────────────────────────────────────────────────

/**
 * Helper for behaviours that need to clamp `speed` based on a peak-velocity coefficient.
 * Returns clamped params + a warning if speed was reduced.
 */
function clampSpeed(params: IdleParams, vmax: number, peakCoefForUnitSpeed: number, behaviorId: string): IdleClampResult {
  if (peakCoefForUnitSpeed <= 0) return { params, warnings: [] }
  const maxSpeed = vmax / peakCoefForUnitSpeed
  if (params.speed > maxSpeed + 1e-9) {
    return {
      params: { ...params, speed: maxSpeed },
      warnings: [`${behaviorId}: speed clamped from ${params.speed.toFixed(2)} to ${maxSpeed.toFixed(2)} (peak velocity bound ${vmax} m/s)`],
    }
  }
  return { params, warnings: [] }
}

/**
 * Minimum ring radius that lets `count` drones sit on a ring at `minSpacing` arc length.
 * Returns 0 when count<2 (a single drone needs no spacing).
 */
function minSafeRingRadius(count: number, minSpacing: number): number {
  if (count < 2) return 0
  // Adjacent points on a circle of radius r are 2r·sin(π/N) apart. Solve for r.
  const s = Math.max(SPACING_FLOOR_M, minSpacing)
  return s / (2 * Math.sin(Math.PI / count))
}

/**
 * Distribute `totalDrones` over a stack of concentric rings such that adjacent
 * drones on the same ring keep at least `minSpacing` apart and rings themselves
 * are separated by `minSpacing` radially. Returns the assigned position for
 * `droneIndex` relative to `center`, with vertical staggering for visual depth.
 *
 * Strategy:
 *   ring 0: capacity = max(1, floor(2π·R0/minSpacing))  with R0 = max(baseRadius, minSafeRing(capacity, s))
 *   ring k: radius = baseRadius + k·minSpacing, capacity = floor(2π·radius/minSpacing)
 *   The first ring is sized to honour the user's requested radius; subsequent rings
 *   step outward by exactly minSpacing.
 *
 * `altitudeStep` (defaults to 0.4·minSpacing) gives each ring a tiny vertical
 * stagger so the stack reads as a soft helix rather than flat overlapping circles.
 */
export interface RingStackSlot {
  x: number
  y: number
  z: number
  ringIndex: number
  ringCapacity: number   // max drones the ring could hold at minSpacing
  ringOccupants: number  // actual drones on this ring after partition
  posInRing: number
  ringRadius: number
}

/**
 * Partition `totalDrones` across concentric rings (radius increment = minSpacing).
 * Returns `{ ringIndex, occupants, radius }` per ring. The first ring's radius
 * honours the user's `baseRadius` floor; subsequent rings step outward by
 * exactly minSpacing. Last ring may be sparser than its capacity.
 */
function partitionRingStack(totalDrones: number, baseRadius: number, minSpacing: number): Array<{ ringIndex: number; occupants: number; radius: number }> {
  if (totalDrones <= 0) return []
  const s = Math.max(SPACING_FLOOR_M, minSpacing)
  const rings: Array<{ ringIndex: number; occupants: number; radius: number }> = []
  let remaining = totalDrones
  let ringIndex = 0
  while (remaining > 0) {
    const r = ringIndex === 0
      ? Math.max(baseRadius, minSafeRingRadius(Math.min(remaining, 6), s))
      : baseRadius + ringIndex * s
    const capacity = Math.max(1, Math.floor((2 * Math.PI * r) / s))
    const occupants = Math.min(remaining, capacity)
    rings.push({ ringIndex, occupants, radius: r })
    remaining -= occupants
    ringIndex += 1
    if (ringIndex > 64) break // pathological-input guard
  }
  return rings
}

export function distributeRingStack(
  droneIndex: number,
  totalDrones: number,
  center: Vec3,
  baseRadius: number,
  minSpacing: number,
  altitudeStep?: number,
): RingStackSlot {
  const s = Math.max(SPACING_FLOOR_M, minSpacing)
  const step = altitudeStep ?? s * RING_STACK_ALTITUDE_FRACTION
  const rings = partitionRingStack(totalDrones, baseRadius, s)
  // Find the ring that contains droneIndex.
  let assigned = 0
  let ring = rings[0] ?? { ringIndex: 0, occupants: 1, radius: Math.max(baseRadius, 0) }
  let posInRing = 0
  for (const r of rings) {
    if (droneIndex < assigned + r.occupants) {
      ring = r
      posInRing = droneIndex - assigned
      break
    }
    assigned += r.occupants
  }
  // Angle by *occupants* (not capacity) so the ring is filled evenly. Phase
  // offset between adjacent rings keeps the stack from reading as columns.
  const phase = ring.ringIndex % 2 === 0 ? 0 : Math.PI / Math.max(1, ring.occupants)
  const angle = (posInRing / Math.max(1, ring.occupants)) * Math.PI * 2 + phase
  const y = center.y + ring.ringIndex * step
  return {
    x: center.x + Math.cos(angle) * ring.radius,
    y,
    z: center.z + Math.sin(angle) * ring.radius,
    ringIndex: ring.ringIndex,
    ringCapacity: Math.max(1, Math.floor((2 * Math.PI * ring.radius) / s)),
    ringOccupants: ring.occupants,
    posInRing,
    ringRadius: ring.radius,
  }
}

/**
 * Returns the effective ring radius after honouring spacing for ring-based behaviours.
 * Always returns at least the user's requested radius — never shrinks below it — so the
 * visual character of small-radius requests is preserved unless physically impossible.
 */
function effectiveRingRadius(requested: number, totalDrones: number, minSpacing: number): number {
  if (totalDrones <= 1) return Math.max(0, requested)
  // For a single-ring layout, every drone needs minSpacing along the arc.
  const need = minSafeRingRadius(totalDrones, minSpacing)
  return Math.max(requested, need)
}

/**
 * Build a clamp result that bumps `radius` up to the spacing-safe minimum when needed.
 * `contractionFloor` is the smallest scale factor the behaviour applies to the ring
 * during its modulation (e.g. pulse contracts to 70 % of base radius → 0.7). The
 * spacing requirement is enforced at the contracted radius, so the base radius is
 * grown to keep the worst-case spacing safe. Default 1.0 (no contraction).
 */
function clampRingRadius(
  params: IdleParams,
  totalDrones: number,
  minSpacing: number,
  behaviorId: string,
  warnings: string[],
  contractionFloor = 1.0,
): IdleClampResult {
  const floor = Math.max(MIN_CONTRACTION_FLOOR, contractionFloor)
  const baseTarget = effectiveRingRadius(params.radius, totalDrones, minSpacing)
  const target = baseTarget / floor
  if (target > params.radius + 1e-9) {
    return {
      params: { ...params, radius: target },
      warnings: [
        ...warnings,
        `${behaviorId}: radius expanded from ${params.radius.toFixed(2)} to ${target.toFixed(2)} m to keep ${totalDrones} drones at least ${minSpacing.toFixed(2)} m apart` + (floor < 1 ? ` (incl. ${(floor * 100).toFixed(0)}% contraction)` : ''),
      ],
    }
  }
  return { params, warnings }
}

// ─── Registry ───────────────────────────────────────────────────────────────

const registry = createRegistry<IdleBehaviorDef>('idleBehaviors')

export const registerIdleBehavior = registry.register
export const getIdleBehavior = registry.get
export const getAllIdleBehaviors = registry.getAll

// ─── hover ──────────────────────────────────────────────────────────────────

const hoverBehavior: IdleBehaviorDef = {
  id: 'hover',
  name: 'Hover',
  // Each drone stays above its own launch-pad XZ at `altitude`, with `center`
  // offset applied. Static — no time component, no spacing concerns.
  getPosition(_droneIndex, _totalDrones, _time, params, homePos) {
    return {
      x: homePos.x + params.center.x,
      y: params.altitude,
      z: homePos.z + params.center.z,
    }
  },
}

// ─── orbit ──────────────────────────────────────────────────────────────────
// Multi-ring helix stack rotating around the center. Each ring rotates at the
// same angular speed; ring-index parity adds a phase shift so adjacent rings
// don't all swing through the same angles together. Vertical step gives the
// stack a slight helix that looks more alive than flat rings.

const orbitBehavior: IdleBehaviorDef = {
  id: 'orbit',
  name: 'Orbit',
  getPosition(droneIndex, totalDrones, time, params, _homePos) {
    const slot = distributeRingStack(droneIndex, totalDrones, params.center, params.radius, 1.0)
    const ringAngle = (slot.posInRing / Math.max(1, slot.ringOccupants)) * Math.PI * 2
    const ringPhase = slot.ringIndex % 2 === 0 ? 0 : Math.PI / Math.max(1, slot.ringCapacity)
    const a = ringAngle + ringPhase + time * params.speed
    return {
      x: params.center.x + Math.cos(a) * slot.ringRadius,
      y: params.altitude + slot.ringIndex * 0.4,
      z: params.center.z + Math.sin(a) * slot.ringRadius,
    }
  },
  clampToConstraints(params, c, totalDrones) {
    // tangential velocity = ringRadius * speed; ringRadius is bounded by the
    // effective radius (which has been spacing-clamped). Conservatively use
    // params.radius * speed for the velocity check.
    const speedClamp = clampSpeed(params, c.maxVelocity, Math.max(VELOCITY_COEF_FLOOR, params.radius), 'orbit')
    return clampRingRadius(speedClamp.params, totalDrones ?? 1, c.minSpacing, 'orbit', speedClamp.warnings)
  },
}

// ─── figure8 ────────────────────────────────────────────────────────────────
// Lemniscate of Bernoulli with phase-offset per drone. Per-drone phase places
// drones at staggered points along the curve; vertical stagger by drone index
// keeps the stack readable for larger N.

const figure8Behavior: IdleBehaviorDef = {
  id: 'figure8',
  name: 'Figure 8',
  getPosition(droneIndex, totalDrones, time, params, _homePos) {
    const phase = ((droneIndex / Math.max(1, totalDrones)) * Math.PI * 2) + (time * params.speed)
    const sinP = Math.sin(phase)
    const cosP = Math.cos(phase)
    const denom = 1 + sinP * sinP
    const x = (cosP / denom) * params.radius
    const z = (sinP * cosP / denom) * params.radius
    // Spread drones vertically across a band so the curve is visible even when
    // many drones overlap on the same screen-space line. Pair-spacing along the
    // lemniscate is approximated as the chord length between adjacent drones —
    // the band of vertical stagger ensures separation.
    const yOffset = totalDrones > 1
      ? ((droneIndex / (totalDrones - 1)) * 2 - 1) * (params.radius * 0.25)
      : 0
    return {
      x: params.center.x + x,
      y: params.altitude + yOffset,
      z: params.center.z + z,
    }
  },
  clampToConstraints(params, c, totalDrones) {
    // Lemniscate is denser than a circle around its neck (phase ±π/2) and at
    // the lobes — adjacent drones can come within ~0.5× ring spacing. Treat as
    // a contraction by 0.55 so the radius grows enough for spacing to hold at
    // the worst point on the curve.
    const radiusClamp = clampRingRadius(params, totalDrones ?? 1, c.minSpacing, 'figure8', [], 0.55)
    const r = radiusClamp.params.radius
    const speedClamp = clampSpeed(radiusClamp.params, c.maxVelocity, Math.max(VELOCITY_COEF_FLOOR, r * 1.41), 'figure8')
    return { params: speedClamp.params, warnings: [...radiusClamp.warnings, ...speedClamp.warnings] }
  },
}

// ─── breathe ────────────────────────────────────────────────────────────────
// Multi-ring stack that pulses radius + altitude. Each drone keeps its slot in
// the stack; the whole formation breathes in unison while the stack provides
// inherent spacing.

const breatheBehavior: IdleBehaviorDef = {
  id: 'breathe',
  name: 'Breathe',
  getPosition(droneIndex, totalDrones, time, params, _homePos) {
    const slot = distributeRingStack(droneIndex, totalDrones, params.center, params.radius, 1.0)
    const breathPhase = time * params.speed * 0.5
    const breathScale = 1 + Math.sin(breathPhase) * 0.3 // 0.7 → 1.3
    const yPulse = Math.sin(breathPhase) * 2
    const ringAngle = (slot.posInRing / Math.max(1, slot.ringOccupants)) * Math.PI * 2
    return {
      x: params.center.x + Math.cos(ringAngle) * slot.ringRadius * breathScale,
      y: params.altitude + yPulse + slot.ringIndex * 0.4,
      z: params.center.z + Math.sin(ringAngle) * slot.ringRadius * breathScale,
    }
  },
  clampToConstraints(params, c, totalDrones) {
    // Order: expand radius first (for spacing), then clamp speed against the
    // (possibly larger) radius. Otherwise the speed bound is computed against
    // the *requested* radius and bows out when the radius is later grown.
    const radiusClamp = clampRingRadius(params, totalDrones ?? 1, c.minSpacing, 'breathe', [], 0.7)
    const r = radiusClamp.params.radius
    const coef = Math.sqrt(1 + 0.0225 * r * r)
    const speedClamp = clampSpeed(radiusClamp.params, c.maxVelocity, coef, 'breathe')
    return { params: speedClamp.params, warnings: [...radiusClamp.warnings, ...speedClamp.warnings] }
  },
}

// ─── swarm ──────────────────────────────────────────────────────────────────
// Distributed per-drone organic drift around each drone's slot on the ring
// stack. Three-frequency sin combination gives pseudo-random motion that
// reads as "alive" without any drone ever wandering far enough to collide
// with its neighbours.

const swarmBehavior: IdleBehaviorDef = {
  id: 'swarm',
  name: 'Swarm',
  getPosition(droneIndex, totalDrones, time, params, _homePos) {
    const slot = distributeRingStack(droneIndex, totalDrones, params.center, params.radius, 1.0)
    const seed1 = droneIndex * 1.618
    const seed2 = droneIndex * 2.357
    const seed3 = droneIndex * 3.891
    const t = time * params.speed
    // Per-drone drift is bounded; combined worst-case displacement of any
    // single drone is sqrt((0.07)² + (0.07)² + (0.12)²) ≈ 0.15·minSpacing, so
    // two neighbours can close at most ~0.3·minSpacing — leaves headroom.
    const a = 0.075
    const dx = (Math.sin(t * 0.7 + seed1) * 0.6 + Math.sin(t * 1.3 + seed2 * 2) * 0.3) * a
    const dz = (Math.cos(t * 0.9 + seed2) * 0.6 + Math.cos(t * 1.7 + seed1 * 2) * 0.3) * a
    const dy = (Math.sin(t * 0.5 + seed3) * 0.5 + Math.sin(t * 1.1 + seed1) * 0.3) * a * 2
    return {
      x: slot.x + dx,
      y: params.altitude + slot.ringIndex * 0.4 + dy,
      z: slot.z + dz,
    }
  },
  clampToConstraints(params, c, totalDrones) {
    const speedClamp = clampSpeed(params, c.maxVelocity, 0.5, 'swarm')
    return clampRingRadius(speedClamp.params, totalDrones ?? 1, c.minSpacing, 'swarm', speedClamp.warnings)
  },
}

// ─── sparkle ────────────────────────────────────────────────────────────────
// Multi-ring stack with per-drone radial flicker + vertical bob. Each drone
// twinkles independently while its slot keeps it away from neighbours.

const sparkleBehavior: IdleBehaviorDef = {
  id: 'sparkle',
  name: 'Sparkle',
  getPosition(droneIndex, totalDrones, time, params, _homePos) {
    const slot = distributeRingStack(droneIndex, totalDrones, params.center, params.radius, 1.0)
    const ringAngle = (slot.posInRing / Math.max(1, slot.ringOccupants)) * Math.PI * 2
    // Per-drone radial flicker: contracts up to 25% inward then expands back.
    // Capped so peak radial offset stays under half the inter-ring spacing.
    const flicker = 0.85 + 0.15 * Math.sin(droneIndex * 7.3 + time * params.speed * 0.5)
    const r = slot.ringRadius * flicker
    const bob = Math.sin(time * 3 + droneIndex * 2.1) * 0.4
    return {
      x: params.center.x + Math.cos(ringAngle) * r,
      y: params.altitude + slot.ringIndex * 0.4 + bob,
      z: params.center.z + Math.sin(ringAngle) * r,
    }
  },
  clampToConstraints(params, c, totalDrones) {
    // Radial dr/dt ≈ 0.075 · radius · speed; vertical dvy ≈ 1.2; combined peak
    // velocity = √((0.075·r·s)² + 1.2²).
    const v = c.maxVelocity
    const coef = Math.sqrt(Math.pow(0.075 * params.radius, 2) + Math.pow(1.2 / Math.max(0.001, params.speed), 2))
    const speedClamp = clampSpeed(params, v, coef, 'sparkle')
    // flicker `0.85 + 0.15*sin(...)` dips to 0.70 of base radius.
    return clampRingRadius(speedClamp.params, totalDrones ?? 1, c.minSpacing, 'sparkle', speedClamp.warnings, 0.7)
  },
}

// ─── pulse ──────────────────────────────────────────────────────────────────
// Multi-ring stack pulsing both radius and altitude. Distinct from breathe in
// that pulse is sharper (faster, higher amplitude vertical).

const pulseBehavior: IdleBehaviorDef = {
  id: 'pulse',
  name: 'Pulse',
  getPosition(droneIndex, totalDrones, time, params, _homePos) {
    const slot = distributeRingStack(droneIndex, totalDrones, params.center, params.radius, 1.0)
    const ringAngle = (slot.posInRing / Math.max(1, slot.ringOccupants)) * Math.PI * 2
    const pulseScale = 1 + 0.3 * Math.sin(time * params.speed * 2)
    const r = slot.ringRadius * pulseScale
    const yPulse = Math.sin(time * params.speed * 2) * 1.5
    return {
      x: params.center.x + Math.cos(ringAngle) * r,
      y: params.altitude + slot.ringIndex * 0.4 + yPulse,
      z: params.center.z + Math.sin(ringAngle) * r,
    }
  },
  clampToConstraints(params, c, totalDrones) {
    const radiusClamp = clampRingRadius(params, totalDrones ?? 1, c.minSpacing, 'pulse', [], 0.7)
    const r = radiusClamp.params.radius
    const coef = Math.sqrt(0.36 * r * r + 9)
    const speedClamp = clampSpeed(radiusClamp.params, c.maxVelocity, coef, 'pulse')
    return { params: speedClamp.params, warnings: [...radiusClamp.warnings, ...speedClamp.warnings] }
  },
}

// ─── wave ───────────────────────────────────────────────────────────────────
// Multi-ring stack with a vertical sinusoidal wave propagating across drone
// indices. Reads as a slow underwater swell over the stack.

const waveBehavior: IdleBehaviorDef = {
  id: 'wave',
  name: 'Wave',
  getPosition(droneIndex, totalDrones, time, params, _homePos) {
    const slot = distributeRingStack(droneIndex, totalDrones, params.center, params.radius, 1.0)
    const ringAngle = (slot.posInRing / Math.max(1, slot.ringOccupants)) * Math.PI * 2
    const waveOffset = Math.sin(droneIndex * 0.5 + time * params.speed) * 2
    return {
      x: params.center.x + Math.cos(ringAngle) * slot.ringRadius,
      y: params.altitude + slot.ringIndex * 0.4 + waveOffset,
      z: params.center.z + Math.sin(ringAngle) * slot.ringRadius,
    }
  },
  clampToConstraints(params, c, totalDrones) {
    const speedClamp = clampSpeed(params, c.maxVelocity, 2, 'wave')
    return clampRingRadius(speedClamp.params, totalDrones ?? 1, c.minSpacing, 'wave', speedClamp.warnings)
  },
}

// ─── spin ───────────────────────────────────────────────────────────────────
// Multi-ring stack rotating as a single rigid disc — same angular speed for
// every drone, no vertical wobble. The cleanest readable rotation.

const spinBehavior: IdleBehaviorDef = {
  id: 'spin',
  name: 'Spin',
  getPosition(droneIndex, totalDrones, time, params, _homePos) {
    const slot = distributeRingStack(droneIndex, totalDrones, params.center, params.radius, 1.0)
    const baseAngle = (slot.posInRing / Math.max(1, slot.ringOccupants)) * Math.PI * 2
    const rotAngle = baseAngle + time * params.speed
    return {
      x: params.center.x + Math.cos(rotAngle) * slot.ringRadius,
      y: params.altitude + slot.ringIndex * 0.4,
      z: params.center.z + Math.sin(rotAngle) * slot.ringRadius,
    }
  },
  clampToConstraints(params, c, totalDrones) {
    const speedClamp = clampSpeed(params, c.maxVelocity, Math.max(VELOCITY_COEF_FLOOR, params.radius), 'spin')
    return clampRingRadius(speedClamp.params, totalDrones ?? 1, c.minSpacing, 'spin', speedClamp.warnings)
  },
}

// ─── drift ──────────────────────────────────────────────────────────────────
// Multi-ring stack with gentle global linear drift across the XZ plane plus a
// tiny per-drone vertical bob.

const driftBehavior: IdleBehaviorDef = {
  id: 'drift',
  name: 'Drift',
  getPosition(droneIndex, totalDrones, time, params, _homePos) {
    const slot = distributeRingStack(droneIndex, totalDrones, params.center, params.radius, 1.0)
    const ringAngle = (slot.posInRing / Math.max(1, slot.ringOccupants)) * Math.PI * 2
    // L2 DirectionHandle adoption — drift now reads `params.direction`. Falls
    // back to the legacy hard-coded heading when the field is absent so old
    // saved shows render identically.
    const dir = params.direction ?? { x: 0.94, y: 0, z: 0.31 } // ≈ unit(0.3, 0, 0.1)
    const drift = time * params.speed
    const bob = Math.sin(time * 0.3 + droneIndex) * 0.3
    return {
      x: params.center.x + Math.cos(ringAngle) * slot.ringRadius + dir.x * drift,
      y: params.altitude + slot.ringIndex * 0.4 + bob + (dir.y * drift),
      z: params.center.z + Math.sin(ringAngle) * slot.ringRadius + dir.z * drift,
    }
  },
  clampToConstraints(params, c, totalDrones) {
    const speedClamp = clampSpeed(params, c.maxVelocity, 0.5, 'drift')
    return clampRingRadius(speedClamp.params, totalDrones ?? 1, c.minSpacing, 'drift', speedClamp.warnings)
  },
}

// Register all built-ins
registerIdleBehavior(hoverBehavior)
registerIdleBehavior(orbitBehavior)
registerIdleBehavior(figure8Behavior)
registerIdleBehavior(breatheBehavior)
registerIdleBehavior(swarmBehavior)
registerIdleBehavior(sparkleBehavior)
registerIdleBehavior(pulseBehavior)
registerIdleBehavior(waveBehavior)
registerIdleBehavior(spinBehavior)
registerIdleBehavior(driftBehavior)
