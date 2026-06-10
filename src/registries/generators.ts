// ============================================================================
// S5-02: Generator Registry — Formation Point Generators
// ============================================================================

import type { Vec3 } from '../graph/types'
import { createRegistry } from './createRegistry'
import { computePairwiseMinDist } from '../graph/spatialHash'

// Heart-curve parametric constants. The classic cardioid:
//   x(t) = 16 sin³(t)
//   y(t) = 13 cos(t) − 5 cos(2t) − 2 cos(3t) − cos(4t)
// then scaled so its bounding box's larger dimension equals `size`.
// HEART_RAW_HALF_EXTENT (16) is the magnitude both axes are normalized
// against — picked because the formula's x amplitude is exactly 16.
const HEART_X_AMP = 16
const HEART_Y_COEFFS = { c1: 13, c2: -5, c3: -2, c4: -1 } as const
const HEART_RAW_HALF_EXTENT = 16

// Below this absolute arcAngle (radians), the line generator treats the
// requested arc as a straight line — avoids `length/arcAngle` blowing up
// near zero.
const ARC_STRAIGHT_EPSILON_RAD = 0.01

export interface GeneratorDef {
  id: string
  name: string
  defaultParams: Record<string, number>
  generate: (params: Record<string, number>) => Vec3[]
  /**
   * Optional per-generator validation. If omitted, validateGeneratorParams() falls back to
   * a generic check (count > 0, pairwise spacing ≥ minSpacing).
   */
  validate?(params: Record<string, number>, minSpacing?: number): string[]
}

const registry = createRegistry<GeneratorDef>('generators')

export const registerGenerator = registry.register
export const getGenerator = registry.get
export const getAllGenerators = registry.getAll

/**
 * Slice 1 Step 8: validate generator params. Checks count > 0 and (if minSpacing given) that
 * the generated points respect the spacing constraint. Calls the generator's own validate()
 * first if defined; otherwise runs the generic check.
 */
export function validateGeneratorParams(
  generatorId: string,
  params: Record<string, number>,
  minSpacing?: number,
): string[] {
  const def = getGenerator(generatorId)
  if (!def) return [`unknown generator: ${generatorId}`]
  if (def.validate) return def.validate(params, minSpacing)

  const errors: string[] = []
  // Only check `count` if the generator actually uses it (e.g. ring, sphere — but not grid).
  if ('count' in def.defaultParams && (params.count ?? 0) <= 0) {
    errors.push('count must be positive')
  }
  if (minSpacing != null && minSpacing > 0) {
    let pts: Vec3[]
    try {
      pts = def.generate(params)
    } catch {
      errors.push('generator threw on these params')
      return errors
    }
    if (pts.length >= 2) {
      const { minDist } = computePairwiseMinDist(pts, minSpacing)
      if (minDist > 0 && minDist < minSpacing) {
        errors.push(
          `points are ${minDist.toFixed(2)}m apart at closest (constraint: ${minSpacing.toFixed(2)}m); reduce count or increase radius/spacing`,
        )
      }
    }
  }
  return errors
}

// --- Built-in: ring ---
registerGenerator({
  id: 'ring',
  name: 'Ring',
  defaultParams: { count: 50, radius: 10 },
  generate(params) {
    const count = params.count ?? 50
    const radius = params.radius ?? 10
    const points: Vec3[] = []
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      points.push({
        x: Math.cos(angle) * radius,
        y: 0,
        z: Math.sin(angle) * radius,
      })
    }
    return points
  },
})

// --- Built-in: grid ---
registerGenerator({
  id: 'grid',
  name: 'Grid',
  defaultParams: { cols: 10, rows: 10, spacing: 2 },
  generate(params) {
    const cols = params.cols ?? 10
    const rows = params.rows ?? 10
    const spacing = params.spacing ?? 2
    const points: Vec3[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        points.push({
          x: (c - (cols - 1) / 2) * spacing,
          y: 0,
          z: (r - (rows - 1) / 2) * spacing,
        })
      }
    }
    return points
  },
})

// --- Built-in: sphere (fibonacci) ---
registerGenerator({
  id: 'sphere',
  name: 'Sphere',
  defaultParams: { count: 100, radius: 10 },
  generate(params) {
    const count = params.count ?? 100
    const radius = params.radius ?? 10
    const points: Vec3[] = []
    const goldenRatio = (1 + Math.sqrt(5)) / 2
    for (let i = 0; i < count; i++) {
      const theta = Math.acos(1 - (2 * (i + 0.5)) / count)
      const phi = (2 * Math.PI * i) / goldenRatio
      points.push({
        x: Math.sin(theta) * Math.cos(phi) * radius,
        y: Math.cos(theta) * radius,
        z: Math.sin(theta) * Math.sin(phi) * radius,
      })
    }
    return points
  },
})

// --- S13-01: Spiral generator ---
registerGenerator({
  id: 'spiral',
  name: 'Spiral',
  defaultParams: { count: 100, turns: 3, spacing: 0.5, radius: 10 },
  generate(params) {
    const count = params.count ?? 100
    const turns = params.turns ?? 3
    const radius = params.radius ?? 10
    // `spacing` repurposed as innerRadius (defaults to 1/3 of radius so the
    // central handful of drones don't crowd together — at innerRadius=0 the
    // first ~5 points all sat within a couple of metres of the origin). The
    // first point is now placed at innerRadius, the last at radius.
    const innerRadius = params.spacing ?? Math.max(1, radius / 3)
    const points: Vec3[] = []
    for (let i = 0; i < count; i++) {
      const t = i / Math.max(1, count - 1)
      const angle = t * turns * Math.PI * 2
      const r = innerRadius + (radius - innerRadius) * t
      points.push({ x: Math.cos(angle) * r, y: 0, z: Math.sin(angle) * r })
    }
    return points
  },
})

// --- S13-02: Line/Arc generator ---
registerGenerator({
  id: 'line',
  name: 'Line/Arc',
  defaultParams: { count: 50, length: 20, arcAngle: 0 },
  generate(params) {
    const count = params.count ?? 50
    const length = params.length ?? 20
    const arcAngle = (params.arcAngle ?? 0) * Math.PI / 180
    const points: Vec3[] = []
    if (Math.abs(arcAngle) < ARC_STRAIGHT_EPSILON_RAD) {
      for (let i = 0; i < count; i++) {
        const t = count > 1 ? i / (count - 1) - 0.5 : 0
        points.push({ x: t * length, y: 0, z: 0 })
      }
    } else {
      const radius = length / arcAngle
      for (let i = 0; i < count; i++) {
        const t = count > 1 ? i / (count - 1) : 0.5
        const angle = (t - 0.5) * arcAngle
        points.push({ x: Math.sin(angle) * radius, y: 0, z: (Math.cos(angle) - 1) * radius })
      }
    }
    return points
  },
})

// --- S13-03: Heart generator ---
//
// 2026-05-21: redistribute points by arc length instead of uniform t.
// The parametric heart formula has a cusp at t=π where dx/dt → 0 and dy/dt
// changes sharply; sampling uniformly in t collapses several drones onto
// the cusp at sub-cm spacing. Arc-length-uniform sampling distributes them
// evenly along the perimeter, eliminating the cluster.

function _heartRaw(t: number): { x: number; y: number } {
  return {
    x: HEART_X_AMP * Math.pow(Math.sin(t), 3),
    y:
      HEART_Y_COEFFS.c1 * Math.cos(t) +
      HEART_Y_COEFFS.c2 * Math.cos(2 * t) +
      HEART_Y_COEFFS.c3 * Math.cos(3 * t) +
      HEART_Y_COEFFS.c4 * Math.cos(4 * t),
  }
}

registerGenerator({
  id: 'heart',
  name: 'Heart',
  defaultParams: { count: 100, size: 8 },
  generate(params) {
    const count = params.count ?? 100
    const size = params.size ?? 8
    const points: Vec3[] = []
    const scale = size / HEART_RAW_HALF_EXTENT

    // Step 1 — densely sample the curve and accumulate arc length.
    const samples = Math.max(2000, count * 20)
    const ts: number[] = []
    const cum: number[] = [0]
    let prev = _heartRaw(0)
    ts.push(0)
    for (let i = 1; i <= samples; i++) {
      const t = (i / samples) * Math.PI * 2
      const cur = _heartRaw(t)
      const seg = Math.hypot(cur.x - prev.x, cur.y - prev.y)
      cum.push(cum[i - 1]! + seg)
      ts.push(t)
      prev = cur
    }
    const totalLen = cum[cum.length - 1]!

    // Step 2 — for each of `count` output points, walk the sample array
    // until cumulative arc length crosses (i/count) × totalLen, then
    // interpolate t between the bracketing samples. Use that t in the
    // analytic formula so the resulting position is exact, not interpolated.
    let walker = 0
    for (let i = 0; i < count; i++) {
      const target = (i / count) * totalLen
      while (walker < cum.length - 1 && cum[walker + 1]! < target) walker++
      const lo = cum[walker]!
      const hi = cum[walker + 1] ?? totalLen
      const frac = hi > lo ? (target - lo) / (hi - lo) : 0
      const t = ts[walker]! + (ts[walker + 1]! - ts[walker]!) * frac
      const xRaw = HEART_X_AMP * Math.pow(Math.sin(t), 3)
      const yRaw =
        HEART_Y_COEFFS.c1 * Math.cos(t) +
        HEART_Y_COEFFS.c2 * Math.cos(2 * t) +
        HEART_Y_COEFFS.c3 * Math.cos(3 * t) +
        HEART_Y_COEFFS.c4 * Math.cos(4 * t)
      points.push({ x: xRaw * scale, y: yRaw * scale, z: 0 })
    }
    return points
  },
})

// --- S13-04: Star generator ---
registerGenerator({
  id: 'star',
  name: 'Star',
  defaultParams: { count: 100, points_n: 5, outerRadius: 10, innerRadius: 4 },
  generate(params) {
    const count = params.count ?? 100
    const n = params.points_n ?? 5
    const outerR = params.outerRadius ?? 10
    const innerR = params.innerRadius ?? 4
    const pts: Vec3[] = []
    const vertices = n * 2
    const starVertices: Vec3[] = []
    for (let i = 0; i < vertices; i++) {
      const angle = (i / vertices) * Math.PI * 2 - Math.PI / 2
      const r = i % 2 === 0 ? outerR : innerR
      starVertices.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r, z: 0 })
    }
    const segLen = starVertices.length
    for (let i = 0; i < count; i++) {
      const t = (i / count) * segLen
      const seg = Math.floor(t) % segLen
      const frac = t - Math.floor(t)
      const a = starVertices[seg]!, b = starVertices[(seg + 1) % segLen]!
      pts.push({ x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac, z: 0 })
    }
    return pts
  },
})
