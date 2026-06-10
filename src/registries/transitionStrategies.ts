// ============================================================================
// S11-01 to S11-09: Transition Strategy Implementations
// ============================================================================
// All new transition types registered via the transition registry.
// ============================================================================

import type { Vec3 } from '../graph/types'
import { v3distSq, v3sub, v3scale, v3normalize } from '../graph/vec3'
import { applyEasing, type EasingType } from '../graph/easing'
import type { TransitionDef } from './transitions'
import { registerTransition, easedDuration, hungarianMapping } from './transitions'
import type { DroneCurve } from '../graph/trajectoryPlanner'

// --- Named constants (plan §S10) ---

/** Phase boundary in the explosion strategy. Scatter outward dominates t < this;
 *  converge to target dominates t > this. Picked so the visual "peak" of the
 *  explosion lands at ~40 % of the animation. */
const EXPLOSION_SCATTER_PHASE = 0.4

/** Inverse of EXPLOSION_SCATTER_PHASE — converge phase fraction. */
const EXPLOSION_CONVERGE_PHASE = 0.6

/** Implosion phase boundaries. Drones approach the focal point during the
 *  first 60 %, then expand to target. The stagger window ensures successive
 *  drones arrive at the focal at slightly different times to avoid pile-up. */
const IMPLOSION_FOCAL_PHASE = 0.6
const IMPLOSION_MIN_FOCAL_T = 0.45
const IMPLOSION_MAX_STAGGER_WINDOW = 0.15

/** Default stagger amount when the param is unset. 50 % gives a clearly
 *  perceptible wave without sacrificing too much travel time. */
const DEFAULT_STAGGER_AMOUNT = 0.5

/** Default gravity strength for the explosion strategy. */
const DEFAULT_EXPLOSION_GRAVITY = 0.3

/** Cap the stagger amount to keep at least 5 % of the duration available
 *  for the actual motion (otherwise the latest drone has no time to move). */
const MAX_STAGGER_AMOUNT = 0.95

// --- Helpers ---

function centroid(points: Vec3[]): Vec3 {
  if (points.length === 0) return { x: 0, y: 0, z: 0 }
  let sx = 0, sy = 0, sz = 0
  for (const p of points) { sx += p.x; sy += p.y; sz += p.z }
  const n = points.length
  return { x: sx / n, y: sy / n, z: sz / n }
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }
}

// --- S11-01: Stagger/Wave Transition ---

function computeStagger(
  index: number,
  total: number,
  positions: Vec3[],
  mode: string,
  curve: EasingType,
): number {
  let raw: number
  switch (mode) {
    case 'by-x': {
      const xs = positions.map((p) => p.x)
      const min = Math.min(...xs), max = Math.max(...xs)
      raw = max > min ? (positions[index]!.x - min) / (max - min) : index / Math.max(1, total - 1)
      break
    }
    case 'by-y': {
      const ys = positions.map((p) => p.y)
      const min = Math.min(...ys), max = Math.max(...ys)
      raw = max > min ? (positions[index]!.y - min) / (max - min) : index / Math.max(1, total - 1)
      break
    }
    case 'by-z': {
      const zs = positions.map((p) => p.z)
      const min = Math.min(...zs), max = Math.max(...zs)
      raw = max > min ? (positions[index]!.z - min) / (max - min) : index / Math.max(1, total - 1)
      break
    }
    case 'by-distance-from-center': {
      const c = centroid(positions)
      const dists = positions.map((p) => Math.sqrt(v3distSq(p, c)))
      const max = Math.max(...dists) || 1
      raw = dists[index]! / max
      break
    }
    case 'random':
      raw = pseudoRandom(index, total)
      break
    default: // by-index
      raw = index / Math.max(1, total - 1)
  }
  return applyEasing(raw, curve)
}

function pseudoRandom(index: number, seed: number): number {
  const x = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453
  return x - Math.floor(x)
}

const staggerTransition: TransitionDef = {
  id: 'stagger',
  name: 'Stagger/Wave',
  mapPoints: (from, to) => hungarianMapping(from, to),

  interpolate(mapping, from, to, t, params) {
    const staggerAmount = Number(params['staggerAmount']) || DEFAULT_STAGGER_AMOUNT
    const mode = String(params['staggerMode'] || 'by-index')
    const curve = (params['staggerCurve'] as EasingType) || 'linear'
    const result: Vec3[] = []

    for (let i = 0; i < mapping.length; i++) {
      const m = mapping[i]!
      const src = from[m.sourceIndex]!, tgt = to[m.targetIndex]!
      const delay = computeStagger(i, mapping.length, from, mode, curve) * staggerAmount
      const localT = Math.max(0, Math.min(1, (t - delay) / (1 - staggerAmount)))
      const eased = applyEasing(localT, 'ease-in-out')
      result.push(lerp3(src, tgt, eased))
    }
    return result
  },

  computeMinDuration(mapping, from, to, params, constraints) {
    const staggerAmount = Math.min(MAX_STAGGER_AMOUNT, Math.max(0, Number(params['staggerAmount']) || DEFAULT_STAGGER_AMOUNT))
    const safetyFactor = Number(params['safetyFactor']) || 1.0
    let maxDist = 0
    for (const m of mapping) {
      const src = from[m.sourceIndex]
      const tgt = to[m.targetIndex]
      if (!src || !tgt) continue
      const d = Math.sqrt(v3distSq(src, tgt))
      if (d > maxDist) maxDist = d
    }
    // Each drone moves over (1 - staggerAmount) × T seconds under ease-in-out.
    return (easedDuration(maxDist, constraints) / (1 - staggerAmount)) * safetyFactor
  },

  planCurves(from, to, params) {
    const staggerAmount = Number(params['staggerAmount']) || DEFAULT_STAGGER_AMOUNT
    const mode = String(params['staggerMode'] || 'by-index')
    const curve = (params['staggerCurve'] as EasingType) || 'linear'
    const N = Math.min(from.length, to.length)
    // Precompute per-drone delays once; closures just sample easing on top.
    const delays = new Array<number>(N)
    for (let i = 0; i < N; i++) {
      delays[i] = computeStagger(i, N, from, mode, curve) * staggerAmount
    }
    const moveFrac = Math.max(1e-6, 1 - staggerAmount)
    const curves: DroneCurve[] = []
    for (let i = 0; i < N; i++) {
      const src = from[i]!, tgt = to[i]!
      const delay = delays[i]!
      curves.push((t) => {
        const localT = Math.max(0, Math.min(1, (t - delay) / moveFrac))
        const eased = applyEasing(localT, 'ease-in-out')
        return lerp3(src, tgt, eased)
      })
    }
    return curves
  },
}

// --- S11-03: Spiral Transition ---

const spiralTransition: TransitionDef = {
  id: 'spiral',
  name: 'Spiral',
  mapPoints: (from, to) => hungarianMapping(from, to),

  interpolate(mapping, from, to, t, params) {
    const turns = Number(params['turns']) || 1
    const radius = Number(params['radius']) || 5
    const direction = Number(params['direction']) || 1 // 1=CW, -1=CCW
    const result: Vec3[] = []
    const eased = applyEasing(t, 'ease-in-out')

    for (const m of mapping) {
      const src = from[m.sourceIndex]!, tgt = to[m.targetIndex]!
      const base = lerp3(src, tgt, eased)
      const angle = eased * turns * Math.PI * 2 * direction
      const r = radius * Math.sin(eased * Math.PI) // Radius peaks at midpoint
      base.x += Math.cos(angle) * r
      base.z += Math.sin(angle) * r
      result.push(base)
    }
    return result
  },

  computeMinDuration(mapping, from, to, params, constraints) {
    const turns = Math.abs(Number(params['turns']) || 1)
    const radius = Math.abs(Number(params['radius']) || 5)
    const safetyFactor = Number(params['safetyFactor']) || 1.0
    let maxChord = 0
    for (const m of mapping) {
      const src = from[m.sourceIndex]
      const tgt = to[m.targetIndex]
      if (!src || !tgt) continue
      const d = Math.sqrt(v3distSq(src, tgt))
      if (d > maxChord) maxChord = d
    }
    // Peak velocity is the sum of chord-component (1.5×chord/T at midpoint under cubic ease)
    // and tangential-component (r×turns×2π×1.5/T at midpoint), since at the midpoint they can
    // align. Equivalent effective path length: chord + 3π·radius·turns. Acceleration falls out
    // of easedDuration's amax check.
    const effectiveArc = maxChord + 3 * Math.PI * radius * turns
    return easedDuration(effectiveArc, constraints) * safetyFactor
  },

  planCurves(from, to, params) {
    const turns = Number(params['turns']) || 1
    const radius = Number(params['radius']) || 5
    const direction = Number(params['direction']) || 1
    const N = Math.min(from.length, to.length)
    const curves: DroneCurve[] = []
    for (let i = 0; i < N; i++) {
      const src = from[i]!, tgt = to[i]!
      curves.push((t) => {
        const eased = applyEasing(t, 'ease-in-out')
        const base = lerp3(src, tgt, eased)
        const angle = eased * turns * Math.PI * 2 * direction
        const r = radius * Math.sin(eased * Math.PI)
        return { x: base.x + Math.cos(angle) * r, y: base.y, z: base.z + Math.sin(angle) * r }
      })
    }
    return curves
  },
}

// --- S11-04: Explosion Transition ---

const explosionTransition: TransitionDef = {
  id: 'explosion',
  name: 'Explosion',
  mapPoints: (from, to) => hungarianMapping(from, to),

  interpolate(mapping, from, to, t, params) {
    const maxRadius = Number(params['maxRadius']) || 15
    const gravity = Number(params['gravity']) || DEFAULT_EXPLOSION_GRAVITY
    const result: Vec3[] = []
    const focal = centroid(from)
    const N = mapping.length

    for (let i = 0; i < N; i++) {
      const m = mapping[i]!
      const src = from[m.sourceIndex]!, tgt = to[m.targetIndex]!
      // Angular jitter: each drone gets a unique radial direction so scatter paths fan out
      // even if their source positions are co-located (e.g. compact starting formation).
      const jitter = (i / N) * Math.PI * 2
      const rawDir = v3sub(src, focal)
      const rawLen = Math.sqrt(rawDir.x * rawDir.x + rawDir.y * rawDir.y + rawDir.z * rawDir.z)
      const baseDir = rawLen > 1e-6 ? v3normalize(rawDir) : { x: 1, y: 0, z: 0 }
      // Rotate baseDir in the XZ plane by the jitter angle, then mix with the original
      // direction (75% original, 25% jittered) so drones with distinct sources stay coherent
      // but co-located drones still fan out.
      const cosJ = Math.cos(jitter), sinJ = Math.sin(jitter)
      const jitterDir = {
        x: baseDir.x * cosJ - baseDir.z * sinJ,
        y: baseDir.y,
        z: baseDir.x * sinJ + baseDir.z * cosJ,
      }
      const dir = rawLen > 0.5
        ? baseDir
        : { x: jitterDir.x, y: jitterDir.y, z: jitterDir.z }
      // Phase 1 (0–0.4): scatter outward from focal, with gravity dragging y down.
      // Phase 2 (0.4–1): converge from scattered position to target. Carries the gravity
      // drop into phase 2 so the y trajectory is continuous (no teleport at t=0.4).
      const fullScatter = v3scale(dir, maxRadius)
      const scatteredApex: Vec3 = {
        x: src.x + fullScatter.x,
        y: src.y + fullScatter.y - gravity * maxRadius,
        z: src.z + fullScatter.z,
      }
      if (t < EXPLOSION_SCATTER_PHASE) {
        const phase = t / EXPLOSION_SCATTER_PHASE
        const eased = applyEasing(phase, 'ease-out')
        const scatter = v3scale(dir, maxRadius * eased)
        result.push({
          x: src.x + scatter.x,
          y: src.y + scatter.y - gravity * eased * eased * maxRadius,
          z: src.z + scatter.z,
        })
      } else {
        const phase = (t - EXPLOSION_SCATTER_PHASE) / EXPLOSION_CONVERGE_PHASE
        const eased = applyEasing(phase, 'ease-in-out')
        result.push(lerp3(scatteredApex, tgt, eased))
      }
    }
    return result
  },

  computeMinDuration(mapping, from, to, params, constraints) {
    const maxRadius = Number(params['maxRadius']) || 15
    const safetyFactor = Number(params['safetyFactor']) || 1.0
    let maxChord = 0
    const focal = centroid(from)
    for (const m of mapping) {
      const src = from[m.sourceIndex]
      const tgt = to[m.targetIndex]
      if (!src || !tgt) continue
      // Scattered position is approximately src + maxRadius along (src-focal) direction.
      const dx = src.x - focal.x, dy = src.y - focal.y, dz = src.z - focal.z
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
      const scattered = { x: src.x + (dx / len) * maxRadius, y: src.y + (dy / len) * maxRadius, z: src.z + (dz / len) * maxRadius }
      const phase2dist = Math.sqrt(v3distSq(scattered, tgt))
      // Phase 1 covers maxRadius over 0.4T; phase 2 covers phase2dist over 0.6T.
      // For each, peak velocity under cubic ease is 1.5 × dist / phaseDuration.
      // Convert to required T: T_phase1 = easedDuration(maxRadius) / 0.4, T_phase2 = easedDuration(phase2dist) / 0.6.
      const phase1T = easedDuration(maxRadius, constraints) / EXPLOSION_SCATTER_PHASE
      const phase2T = easedDuration(phase2dist, constraints) / EXPLOSION_CONVERGE_PHASE
      const requiredForDrone = Math.max(phase1T, phase2T)
      if (requiredForDrone > maxChord) maxChord = requiredForDrone
    }
    return maxChord * safetyFactor
  },

  planCurves(from, to, params) {
    const maxRadius = Number(params['maxRadius']) || 15
    const gravity = Number(params['gravity']) || DEFAULT_EXPLOSION_GRAVITY
    const focal = centroid(from)
    const N = Math.min(from.length, to.length)

    const curves: DroneCurve[] = []
    for (let i = 0; i < N; i++) {
      const src = from[i]!, tgt = to[i]!
      const jitter = (i / N) * Math.PI * 2
      const rawDir = v3sub(src, focal)
      const rawLen = Math.sqrt(rawDir.x * rawDir.x + rawDir.y * rawDir.y + rawDir.z * rawDir.z)
      const baseDir = rawLen > 1e-6 ? v3normalize(rawDir) : { x: 1, y: 0, z: 0 }
      const cosJ = Math.cos(jitter), sinJ = Math.sin(jitter)
      const jitterDir = {
        x: baseDir.x * cosJ - baseDir.z * sinJ,
        y: baseDir.y,
        z: baseDir.x * sinJ + baseDir.z * cosJ,
      }
      const dir = rawLen > 0.5 ? baseDir : jitterDir
      const fullScatter = v3scale(dir, maxRadius)
      const scatteredApex: Vec3 = {
        x: src.x + fullScatter.x,
        y: src.y + fullScatter.y - gravity * maxRadius,
        z: src.z + fullScatter.z,
      }
      curves.push((t) => {
        if (t < EXPLOSION_SCATTER_PHASE) {
          const phase = t / EXPLOSION_SCATTER_PHASE
          const eased = applyEasing(phase, 'ease-out')
          const scatter = v3scale(dir, maxRadius * eased)
          return {
            x: src.x + scatter.x,
            y: src.y + scatter.y - gravity * eased * eased * maxRadius,
            z: src.z + scatter.z,
          }
        }
        const phase = (t - EXPLOSION_SCATTER_PHASE) / EXPLOSION_CONVERGE_PHASE
        const eased = applyEasing(phase, 'ease-in-out')
        return lerp3(scatteredApex, tgt, eased)
      })
    }
    return curves
  },
}

// --- S11-05: Implosion Transition ---

const implosionTransition: TransitionDef = {
  id: 'implosion',
  name: 'Implosion',
  mapPoints: (from, to) => hungarianMapping(from, to),

  interpolate(mapping, from, to, t, _params) {
    const focal = centroid(to)
    const result: Vec3[] = []
    const N = mapping.length
    // Stagger arrival times slightly so drones don't all overlap at the focal.
    // Each drone reaches focal at phase ∈ [IMPLOSION_MIN_FOCAL_T, IMPLOSION_FOCAL_PHASE].
    const staggerWindow = N > 1
      ? Math.min(IMPLOSION_MAX_STAGGER_WINDOW, EXPLOSION_SCATTER_PHASE / N)
      : 0
    void IMPLOSION_MIN_FOCAL_T // documented in constant definition

    for (let i = 0; i < N; i++) {
      const m = mapping[i]!
      const src = from[m.sourceIndex]!, tgt = to[m.targetIndex]!
      const dronePhaseFocal = IMPLOSION_FOCAL_PHASE - (i / Math.max(1, N - 1)) * staggerWindow
      if (t < dronePhaseFocal) {
        // Phase 1: converge to focal
        const phase = t / dronePhaseFocal
        const eased = applyEasing(phase, 'ease-in')
        result.push(lerp3(src, focal, eased))
      } else {
        // Phase 2: expand from focal to target
        const phase = (t - dronePhaseFocal) / (1 - dronePhaseFocal)
        const eased = applyEasing(phase, 'ease-out')
        result.push(lerp3(focal, tgt, eased))
      }
    }
    return result
  },

  computeMinDuration(mapping, from, to, params, constraints) {
    const safetyFactor = Number(params['safetyFactor']) || 1.0
    const focal = centroid(to)
    let maxRequired = 0
    for (const m of mapping) {
      const src = from[m.sourceIndex]
      const tgt = to[m.targetIndex]
      if (!src || !tgt) continue
      const srcToFocal = Math.sqrt(v3distSq(src, focal))
      const focalToTgt = Math.sqrt(v3distSq(focal, tgt))
      // Phase 1 covers srcToFocal in ~0.6T, phase 2 covers focalToTgt in ~0.4T.
      // ease-in/ease-out peak velocity is ~2× average for half-eased motion, so use easedDuration as conservative bound.
      const phase1T = easedDuration(srcToFocal, constraints) / 0.6
      const phase2T = easedDuration(focalToTgt, constraints) / 0.4
      const required = Math.max(phase1T, phase2T)
      if (required > maxRequired) maxRequired = required
    }
    // Funnel-spacing floor: arrivals at focal must be spaced enough that closest pair ≥ minSpacing.
    // Minimum approach speed near focal is ~1.5 × srcToFocal / (0.6T). Arrivals are spaced by staggerWindow×T.
    // Conservative funnel floor: N × minSpacing / maxVelocity.
    const N = mapping.length
    const funnelT = (N * constraints.minSpacing) / Math.max(0.5, constraints.maxVelocity)
    return Math.max(maxRequired, funnelT) * safetyFactor
  },

  planCurves(from, to) {
    const focal = centroid(to)
    const N = Math.min(from.length, to.length)
    const staggerWindow = N > 1
      ? Math.min(IMPLOSION_MAX_STAGGER_WINDOW, EXPLOSION_SCATTER_PHASE / N)
      : 0
    void IMPLOSION_MIN_FOCAL_T
    const curves: DroneCurve[] = []
    for (let i = 0; i < N; i++) {
      const src = from[i]!, tgt = to[i]!
      const dronePhaseFocal = IMPLOSION_FOCAL_PHASE - (i / Math.max(1, N - 1)) * staggerWindow
      const focalRecip = 1 / dronePhaseFocal
      const expandRecip = 1 / Math.max(1e-6, 1 - dronePhaseFocal)
      curves.push((t) => {
        if (t < dronePhaseFocal) {
          const eased = applyEasing(t * focalRecip, 'ease-in')
          return lerp3(src, focal, eased)
        }
        const eased = applyEasing((t - dronePhaseFocal) * expandRecip, 'ease-out')
        return lerp3(focal, tgt, eased)
      })
    }
    return curves
  },
}

// --- S11-06: Cascade/Domino Transition ---

const cascadeTransition: TransitionDef = {
  id: 'cascade',
  name: 'Cascade/Domino',
  mapPoints: (from, to) => hungarianMapping(from, to),

  interpolate(mapping, from, to, t, params) {
    const speed = Math.max(0.1, Number(params['propagationSpeed']) || 1)
    const dirX = Number(params['directionX']) || 1
    const dirY = Number(params['directionY']) || 0
    const dirZ = Number(params['directionZ']) || 0
    const result: Vec3[] = []

    // Compute projection of each source point onto direction
    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1
    const nDir = { x: dirX / dirLen, y: dirY / dirLen, z: dirZ / dirLen }
    const projections = mapping.map((m) => {
      const s = from[m.sourceIndex]!
      return s.x * nDir.x + s.y * nDir.y + s.z * nDir.z
    })
    const minP = Math.min(...projections)
    const maxP = Math.max(...projections)
    const range = (maxP - minP) || 1

    // Delay fraction is bounded to [0, delayFrac]; each drone moves over (1 - delayFrac) of total time.
    const delayFrac = Math.min(0.7, 1 / speed)
    const moveFrac = Math.max(0.3, 1 - delayFrac)

    for (let i = 0; i < mapping.length; i++) {
      const m = mapping[i]!
      const src = from[m.sourceIndex]!, tgt = to[m.targetIndex]!
      const delay = ((projections[i]! - minP) / range) * delayFrac
      const localT = Math.max(0, Math.min(1, (t - delay) / moveFrac))
      const eased = applyEasing(localT, 'ease-in-out')
      result.push(lerp3(src, tgt, eased))
    }
    return result
  },

  computeMinDuration(mapping, from, to, params, constraints) {
    const speed = Math.max(0.1, Number(params['propagationSpeed']) || 1)
    const safetyFactor = Number(params['safetyFactor']) || 1.0
    let maxDist = 0
    for (const m of mapping) {
      const src = from[m.sourceIndex]
      const tgt = to[m.targetIndex]
      if (!src || !tgt) continue
      const d = Math.sqrt(v3distSq(src, tgt))
      if (d > maxDist) maxDist = d
    }
    // Each drone moves over (1 - delayFrac) of total time under ease-in-out.
    const delayFrac = Math.min(0.7, 1 / speed)
    const moveFrac = Math.max(0.3, 1 - delayFrac)
    return (easedDuration(maxDist, constraints) / moveFrac) * safetyFactor
  },

  planCurves(from, to, params) {
    const speed = Math.max(0.1, Number(params['propagationSpeed']) || 1)
    const dirX = Number(params['directionX']) || 1
    const dirY = Number(params['directionY']) || 0
    const dirZ = Number(params['directionZ']) || 0
    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1
    const nDir = { x: dirX / dirLen, y: dirY / dirLen, z: dirZ / dirLen }
    const N = Math.min(from.length, to.length)
    const delayFrac = Math.min(0.7, 1 / speed)
    const moveFrac = Math.max(0.3, 1 - delayFrac)

    // Precompute per-drone projections + delay scalars once.
    let minP = Infinity, maxP = -Infinity
    const projections = new Array<number>(N)
    for (let i = 0; i < N; i++) {
      const s = from[i]!
      const p = s.x * nDir.x + s.y * nDir.y + s.z * nDir.z
      projections[i] = p
      if (p < minP) minP = p
      if (p > maxP) maxP = p
    }
    const range = (maxP - minP) || 1
    const moveRecip = 1 / moveFrac

    const curves: DroneCurve[] = []
    for (let i = 0; i < N; i++) {
      const src = from[i]!, tgt = to[i]!
      const delay = ((projections[i]! - minP) / range) * delayFrac
      curves.push((t) => {
        const localT = Math.max(0, Math.min(1, (t - delay) * moveRecip))
        const eased = applyEasing(localT, 'ease-in-out')
        return lerp3(src, tgt, eased)
      })
    }
    return curves
  },
}

// --- S11-07: Morph Transition (with arc paths) ---

const morphTransition: TransitionDef = {
  id: 'morph',
  name: 'Morph',
  mapPoints: (from, to) => hungarianMapping(from, to),

  interpolate(mapping, from, to, t, params) {
    const arcHeight = Number(params['arcHeight']) || 3
    const result: Vec3[] = []
    const eased = applyEasing(t, 'ease-in-out')

    for (const m of mapping) {
      const src = from[m.sourceIndex]!, tgt = to[m.targetIndex]!
      const mid = lerp3(src, tgt, eased)
      // Arc: sine bump in Y to avoid collisions
      const arc = Math.sin(eased * Math.PI) * arcHeight
      mid.y += arc
      result.push(mid)
    }
    return result
  },

  computeMinDuration(mapping, from, to, params, constraints) {
    const arcHeight = Math.abs(Number(params['arcHeight']) || 3)
    const safetyFactor = Number(params['safetyFactor']) || 1.0
    let maxChord = 0
    for (const m of mapping) {
      const src = from[m.sourceIndex]
      const tgt = to[m.targetIndex]
      if (!src || !tgt) continue
      const d = Math.sqrt(v3distSq(src, tgt))
      if (d > maxChord) maxChord = d
    }
    // Path length ≈ chord + sine-bump arc length. Half-sine of amplitude h over [0,1] has length ≈ π·h/2.
    const arcLength = maxChord + (Math.PI * arcHeight) / 2
    return easedDuration(arcLength, constraints) * safetyFactor
  },

  planCurves(from, to, params) {
    const arcHeight = Number(params['arcHeight']) || 3
    const N = Math.min(from.length, to.length)
    const curves: DroneCurve[] = []
    for (let i = 0; i < N; i++) {
      const src = from[i]!, tgt = to[i]!
      curves.push((t) => {
        const eased = applyEasing(t, 'ease-in-out')
        const mid = lerp3(src, tgt, eased)
        mid.y += Math.sin(eased * Math.PI) * arcHeight
        return mid
      })
    }
    return curves
  },
}

// --- S11-08: Color Sweep Transition ---

const colorSweepTransition: TransitionDef = {
  id: 'color-sweep',
  name: 'Color Sweep',
  mapPoints: (from, to) => hungarianMapping(from, to),

  interpolate(mapping, from, to, t, _params) {
    // Motion: simple linear interpolation (color changes handled by evaluator)
    const result: Vec3[] = []
    const eased = applyEasing(t, 'ease-in-out')
    for (const m of mapping) {
      const src = from[m.sourceIndex]!, tgt = to[m.targetIndex]!
      result.push(lerp3(src, tgt, eased))
    }
    return result
  },

  computeMinDuration(mapping, from, to, params, constraints) {
    const safetyFactor = Number(params['safetyFactor']) || 1.0
    let maxDist = 0
    for (const m of mapping) {
      const src = from[m.sourceIndex]
      const tgt = to[m.targetIndex]
      if (!src || !tgt) continue
      const d = Math.sqrt(v3distSq(src, tgt))
      if (d > maxDist) maxDist = d
    }
    return easedDuration(maxDist, constraints) * safetyFactor
  },

  planCurves(from, to) {
    const N = Math.min(from.length, to.length)
    const curves: DroneCurve[] = []
    for (let i = 0; i < N; i++) {
      const src = from[i]!, tgt = to[i]!
      curves.push((t) => lerp3(src, tgt, applyEasing(t, 'ease-in-out')))
    }
    return curves
  },
}

// --- S11-09: Bounce/Spring Transition ---

const bounceTransition: TransitionDef = {
  id: 'bounce',
  name: 'Bounce/Spring',
  mapPoints: (from, to) => hungarianMapping(from, to),

  interpolate(mapping, from, to, t, params) {
    const damping = Number(params['damping']) || 0.5
    const result: Vec3[] = []

    for (const m of mapping) {
      const src = from[m.sourceIndex]!, tgt = to[m.targetIndex]!
      // Cubic ease-out approach + decaying overshoot oscillation.
      // baseEased ramps 0→1 smoothly; the sine term adds bounce, faded out by (1-baseEased)
      // so the trajectory always settles exactly on the target at t=1.
      const omega = Math.PI * 3 // ~3 bounces
      const baseEased = applyEasing(t, 'ease-out')
      const decay = Math.exp(-damping * t * 10)
      const oscillation = decay * Math.sin(omega * t) * (1 - baseEased)
      const eased = baseEased + oscillation
      result.push(lerp3(src, tgt, eased))
    }
    return result
  },

  computeMinDuration(mapping, from, to, params, constraints) {
    const safetyFactor = Number(params['safetyFactor']) || 1.0
    let maxDist = 0
    for (const m of mapping) {
      const src = from[m.sourceIndex]
      const tgt = to[m.targetIndex]
      if (!src || !tgt) continue
      const d = Math.sqrt(v3distSq(src, tgt))
      if (d > maxDist) maxDist = d
    }
    if (maxDist === 0) return 0
    // For (base ease-out + decay × sin(ωt) × (1−baseEased)), the velocity coefficient at t=0
    // is ~ (2 + ω). With ω = 3π, that's ≈ 11.42. Peak velocity = 11.42 × maxDist / T.
    // This is the binding constraint; the acceleration bound is weaker in practice.
    const peakCoef = 2 + Math.PI * 3
    const v = Math.max(0.5, constraints.maxVelocity)
    const Tv = (peakCoef * maxDist) / v
    const a = constraints.maxAcceleration
    const Ta = a > 0 ? Math.sqrt((peakCoef * peakCoef * maxDist) / a) : 0
    const Tres = Math.max(Tv, Ta)
    return (Math.ceil(Tres * 10) / 10) * safetyFactor
  },

  planCurves(from, to, params) {
    const damping = Number(params['damping']) || 0.5
    const omega = Math.PI * 3
    const N = Math.min(from.length, to.length)
    const curves: DroneCurve[] = []
    for (let i = 0; i < N; i++) {
      const src = from[i]!, tgt = to[i]!
      curves.push((t) => {
        const baseEased = applyEasing(t, 'ease-out')
        const decay = Math.exp(-damping * t * 10)
        const oscillation = decay * Math.sin(omega * t) * (1 - baseEased)
        return lerp3(src, tgt, baseEased + oscillation)
      })
    }
    return curves
  },
}

// --- Register all S11 transitions ---

export function registerS11Transitions(): void {
  registerTransition(staggerTransition)
  registerTransition(spiralTransition)
  registerTransition(explosionTransition)
  registerTransition(implosionTransition)
  registerTransition(cascadeTransition)
  registerTransition(morphTransition)
  registerTransition(colorSweepTransition)
  registerTransition(bounceTransition)
}
