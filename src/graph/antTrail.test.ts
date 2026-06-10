// ============================================================================
// Tests for Ant Trail — Core Path/Lane Engine
// ============================================================================

import { describe, it, expect } from 'vitest'
import {
  buildTrailGeometry,
  assignDronesToLanes,
  buildLaneCurve,
  sampleLaneAtDistance,
  sampleLaneTangentAtDistance,
  centroid,
  interpolateAntTrail,
  computeAntTrailMinDuration,
  parseAntTrailParams,
  smoothstep,
  sampleCubicBezier,
  DEFAULT_ANT_TRAIL_PARAMS,
  type AntTrailParams,
} from './antTrail'
import {
  v3dist,
  v3lerp,
  v3scale,
  v3normalize,
  v3dot,
  v3len,
} from './vec3'
import type { Vec3 } from './types'
import type { PointMapping } from '../registries/transitions'

// --- Helpers ---

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

function identityMapping(n: number): PointMapping[] {
  return Array.from({ length: n }, (_, i) => ({ sourceIndex: i, targetIndex: i }))
}

// ── Vector math tests ───────────────────────────────────────────────────────

describe('vector math', () => {
  it('v3dist computes euclidean distance', () => {
    expect(v3dist({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBeCloseTo(5)
  })

  it('v3lerp interpolates', () => {
    const r = v3lerp({ x: 0, y: 0, z: 0 }, { x: 10, y: 20, z: 30 }, 0.5)
    expect(r.x).toBeCloseTo(5)
    expect(r.y).toBeCloseTo(10)
    expect(r.z).toBeCloseTo(15)
  })

  it('v3normalize produces unit vector', () => {
    const n = v3normalize({ x: 3, y: 0, z: 4 })
    expect(v3len(n)).toBeCloseTo(1)
  })

  it('v3dot and v3scale work correctly', () => {
    expect(v3dot({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toBe(32)
    const s = v3scale({ x: 1, y: 2, z: 3 }, 2)
    expect(s.x).toBe(2)
    expect(s.y).toBe(4)
    expect(s.z).toBe(6)
  })

  it('centroid computes average', () => {
    const c = centroid([{ x: 0, y: 0, z: 0 }, { x: 10, y: 20, z: 30 }])
    expect(c.x).toBeCloseTo(5)
    expect(c.y).toBeCloseTo(10)
    expect(c.z).toBeCloseTo(15)
  })

  it('centroid of empty array is origin', () => {
    expect(centroid([])).toEqual({ x: 0, y: 0, z: 0 })
  })
})

// ── Smoothstep tests ────────────────────────────────────────────────────────

describe('smoothstep', () => {
  it('returns 0 at t=0', () => expect(smoothstep(0)).toBe(0))
  it('returns 1 at t=1', () => expect(smoothstep(1)).toBe(1))
  it('returns 0.5 at t=0.5', () => expect(smoothstep(0.5)).toBeCloseTo(0.5))
  it('clamps below 0', () => expect(smoothstep(-1)).toBe(0))
  it('clamps above 1', () => expect(smoothstep(2)).toBe(1))
})

// ── Cubic Bezier / Lane Curve tests ─────────────────────────────────────────

describe('LaneCurve', () => {
  const p0: Vec3 = { x: 0, y: 0, z: 0 }
  const p1: Vec3 = { x: 10, y: 10, z: 0 }
  const p2: Vec3 = { x: 20, y: 10, z: 0 }
  const p3: Vec3 = { x: 30, y: 0, z: 0 }

  it('sampleCubicBezier at t=0 returns p0', () => {
    const r = sampleCubicBezier(p0, p1, p2, p3, 0)
    expect(r.x).toBeCloseTo(0)
    expect(r.y).toBeCloseTo(0)
  })

  it('sampleCubicBezier at t=1 returns p3', () => {
    const r = sampleCubicBezier(p0, p1, p2, p3, 1)
    expect(r.x).toBeCloseTo(30)
    expect(r.y).toBeCloseTo(0)
  })

  it('buildLaneCurve totalLength is positive', () => {
    const curve = buildLaneCurve(p0, p1, p2, p3)
    expect(curve.totalLength).toBeGreaterThan(0)
  })

  it('sampleLaneAtDistance at 0 returns start', () => {
    const curve = buildLaneCurve(p0, p1, p2, p3)
    const r = sampleLaneAtDistance(curve, 0)
    expect(v3dist(r, p0)).toBeLessThan(0.01)
  })

  it('sampleLaneAtDistance at totalLength returns end', () => {
    const curve = buildLaneCurve(p0, p1, p2, p3)
    const r = sampleLaneAtDistance(curve, curve.totalLength)
    expect(v3dist(r, p3)).toBeLessThan(0.1)
  })

  it('sampleLaneAtDistance is monotonic along x for this curve', () => {
    const curve = buildLaneCurve(p0, p1, p2, p3)
    let lastX = -Infinity
    for (let d = 0; d <= curve.totalLength; d += curve.totalLength / 20) {
      const pt = sampleLaneAtDistance(curve, d)
      expect(pt.x).toBeGreaterThanOrEqual(lastX - 0.01)
      lastX = pt.x
    }
  })

  it('sampleLaneTangentAtDistance returns non-zero vectors', () => {
    const curve = buildLaneCurve(p0, p1, p2, p3)
    const t = sampleLaneTangentAtDistance(curve, curve.totalLength * 0.5)
    expect(v3len(t)).toBeCloseTo(1, 1)
  })
})

// ── Trail Geometry tests ────────────────────────────────────────────────────

describe('buildTrailGeometry', () => {
  const from = makeGrid(20, 2, { x: -15, y: 10, z: 0 })
  const to = makeGrid(20, 2, { x: 15, y: 10, z: 0 })
  const params = { ...DEFAULT_ANT_TRAIL_PARAMS, laneCount: 2 }

  it('creates correct number of lanes', () => {
    const g = buildTrailGeometry(from, to, params)
    expect(g.lanes).toHaveLength(2)
  })

  it('lanes have positive length', () => {
    const g = buildTrailGeometry(from, to, params)
    for (const lane of g.lanes) {
      expect(lane.totalLength).toBeGreaterThan(0)
    }
  })

  it('forward direction points from source to target', () => {
    const g = buildTrailGeometry(from, to, params)
    expect(g.forward.x).toBeGreaterThan(0)
  })

  it('single lane when laneCount=1', () => {
    const g = buildTrailGeometry(from, to, { ...params, laneCount: 1 })
    expect(g.lanes).toHaveLength(1)
  })

  it('clamps lanes to drone count', () => {
    const small = [{ x: 0, y: 0, z: 0 }]
    const g = buildTrailGeometry(small, small, { ...params, laneCount: 8 })
    expect(g.lanes).toHaveLength(1)
  })

  it('arcHeight elevates control points', () => {
    const g = buildTrailGeometry(from, to, { ...params, arcHeight: 10 })
    // Control points (p1, p2) should be above the start/end y
    for (const lane of g.lanes) {
      expect(lane.p1.y).toBeGreaterThan(10)
      expect(lane.p2.y).toBeGreaterThan(10)
    }
  })

  it('laneSpread creates lateral separation', () => {
    const g = buildTrailGeometry(from, to, { ...params, laneCount: 2, laneSpread: 20 })
    const lane0mid = sampleLaneAtDistance(g.lanes[0]!, g.lanes[0]!.totalLength * 0.5)
    const lane1mid = sampleLaneAtDistance(g.lanes[1]!, g.lanes[1]!.totalLength * 0.5)
    const lateralDist = v3dist(lane0mid, lane1mid)
    expect(lateralDist).toBeGreaterThan(10)
  })
})

// ── Lane Assignment tests ───────────────────────────────────────────────────

describe('assignDronesToLanes', () => {
  it('assigns all drones', () => {
    const from = makeGrid(20, 2, { x: -15, y: 10, z: 0 })
    const to = makeGrid(20, 2, { x: 15, y: 10, z: 0 })
    const mapping = identityMapping(20)
    const g = buildTrailGeometry(from, to, { ...DEFAULT_ANT_TRAIL_PARAMS, laneCount: 2 })
    const slots = assignDronesToLanes(mapping, from, to, g)
    expect(slots).toHaveLength(20)
  })

  it('balances drones across lanes', () => {
    const from = makeGrid(20, 2, { x: -15, y: 10, z: 0 })
    const to = makeGrid(20, 2, { x: 15, y: 10, z: 0 })
    const mapping = identityMapping(20)
    const g = buildTrailGeometry(from, to, { ...DEFAULT_ANT_TRAIL_PARAMS, laneCount: 2 })
    const slots = assignDronesToLanes(mapping, from, to, g)

    const laneCounts = [0, 0]
    for (const s of slots) {
      laneCounts[s.laneIdx]!++
    }
    expect(laneCounts[0]).toBe(10)
    expect(laneCounts[1]).toBe(10)
  })

  it('handles odd drone counts', () => {
    const from = makeGrid(21, 2, { x: -15, y: 10, z: 0 })
    const to = makeGrid(21, 2, { x: 15, y: 10, z: 0 })
    const mapping = identityMapping(21)
    const g = buildTrailGeometry(from, to, { ...DEFAULT_ANT_TRAIL_PARAMS, laneCount: 2 })
    const slots = assignDronesToLanes(mapping, from, to, g)

    const laneCounts = [0, 0]
    for (const s of slots) {
      laneCounts[s.laneIdx]!++
    }
    expect(laneCounts[0]! + laneCounts[1]!).toBe(21)
    expect(Math.abs(laneCounts[0]! - laneCounts[1]!)).toBeLessThanOrEqual(1)
  })

  it('every drone has unique index', () => {
    const from = makeGrid(30, 2, { x: -15, y: 10, z: 0 })
    const to = makeGrid(30, 2, { x: 15, y: 10, z: 0 })
    const mapping = identityMapping(30)
    const g = buildTrailGeometry(from, to, { ...DEFAULT_ANT_TRAIL_PARAMS, laneCount: 3 })
    const slots = assignDronesToLanes(mapping, from, to, g)

    const droneIndices = new Set(slots.map((s) => s.droneIdx))
    expect(droneIndices.size).toBe(30)
  })

  it('slotInLane is sequential within each lane', () => {
    const from = makeGrid(20, 2, { x: -15, y: 10, z: 0 })
    const to = makeGrid(20, 2, { x: 15, y: 10, z: 0 })
    const mapping = identityMapping(20)
    const g = buildTrailGeometry(from, to, { ...DEFAULT_ANT_TRAIL_PARAMS, laneCount: 2 })
    const slots = assignDronesToLanes(mapping, from, to, g)

    const byLane = new Map<number, number[]>()
    for (const s of slots) {
      if (!byLane.has(s.laneIdx)) byLane.set(s.laneIdx, [])
      byLane.get(s.laneIdx)!.push(s.slotInLane)
    }
    for (const [_, slotsInLane] of byLane) {
      slotsInLane.sort((a, b) => a - b)
      for (let i = 0; i < slotsInLane.length; i++) {
        expect(slotsInLane[i]).toBe(i)
      }
    }
  })
})

// ── parseAntTrailParams tests ───────────────────────────────────────────────

describe('parseAntTrailParams', () => {
  it('returns defaults for empty object', () => {
    const p = parseAntTrailParams({})
    expect(p.laneCount).toBe(2)
    expect(p.trailSpeed).toBe(6)
    expect(p.spacing).toBe(2)
    expect(p.arcHeight).toBe(5)
    expect(p.laneSpread).toBe(8)
    expect(p.entryPhase).toBeCloseTo(0.2)
    expect(p.exitPhase).toBeCloseTo(0.2)
    expect(p.zigzag).toBe(0)
  })

  it('clamps laneCount to [1, 8]', () => {
    expect(parseAntTrailParams({ laneCount: 0 }).laneCount).toBe(1)
    expect(parseAntTrailParams({ laneCount: 20 }).laneCount).toBe(8)
  })

  it('clamps entryPhase to [0.05, 0.4]', () => {
    expect(parseAntTrailParams({ entryPhase: 0.01 }).entryPhase).toBeCloseTo(0.05)
    expect(parseAntTrailParams({ entryPhase: 0.9 }).entryPhase).toBeCloseTo(0.4)
  })

  it('clamps zigzag to [0, 3]', () => {
    expect(parseAntTrailParams({ zigzag: -1 }).zigzag).toBe(0)
    expect(parseAntTrailParams({ zigzag: 10 }).zigzag).toBe(3)
  })
})

// ── Interpolation integration tests ─────────────────────────────────────────

describe('interpolateAntTrail', () => {
  const from = makeGrid(20, 3, { x: -15, y: 10, z: 0 })
  const to = makeGrid(20, 3, { x: 15, y: 10, z: 0 })
  const mapping = identityMapping(20)
  const params: AntTrailParams = { ...DEFAULT_ANT_TRAIL_PARAMS, laneCount: 2 }
  const duration = 20

  it('returns correct count', () => {
    const result = interpolateAntTrail(mapping, from, to, 0.5, params, duration)
    expect(result).toHaveLength(20)
  })

  it('returns empty for empty mapping', () => {
    const result = interpolateAntTrail([], from, to, 0.5, params, duration)
    expect(result).toHaveLength(0)
  })

  it('t=0 returns source positions exactly', () => {
    const result = interpolateAntTrail(mapping, from, to, 0, params, duration)
    for (let i = 0; i < result.length; i++) {
      expect(v3dist(result[i]!, from[i]!)).toBeLessThan(0.01)
    }
  })

  it('t=1 returns target positions exactly', () => {
    const result = interpolateAntTrail(mapping, from, to, 1, params, duration)
    for (let i = 0; i < result.length; i++) {
      expect(v3dist(result[i]!, to[i]!)).toBeLessThan(0.01)
    }
  })

  it('drones move away from source at t=0.5', () => {
    const result = interpolateAntTrail(mapping, from, to, 0.5, params, duration)
    let movedCount = 0
    for (let i = 0; i < result.length; i++) {
      if (v3dist(result[i]!, from[i]!) > 1) movedCount++
    }
    expect(movedCount).toBeGreaterThan(0)
  })

  it('no NaN or Infinity at any time step', () => {
    for (let step = 0; step <= 100; step++) {
      const t = step / 100
      const result = interpolateAntTrail(mapping, from, to, t, params, duration)
      for (let i = 0; i < result.length; i++) {
        const p = result[i]!
        expect(isFinite(p.x)).toBe(true)
        expect(isFinite(p.y)).toBe(true)
        expect(isFinite(p.z)).toBe(true)
      }
    }
  })

  it('deterministic: same inputs produce same output', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const a = interpolateAntTrail(mapping, from, to, t, params, duration)
      const b = interpolateAntTrail(mapping, from, to, t, params, duration)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    }
  })

  it('handles single drone', () => {
    const f = [{ x: 0, y: 10, z: 0 }]
    const t2 = [{ x: 20, y: 15, z: 0 }]
    const m = [{ sourceIndex: 0, targetIndex: 0 }]
    const result = interpolateAntTrail(m, f, t2, 0.5, { ...params, laneCount: 1 }, 10)
    expect(result).toHaveLength(1)
    expect(isFinite(result[0]!.x)).toBe(true)
  })

  it('arcHeight elevates drones during trail phase', () => {
    const result = interpolateAntTrail(mapping, from, to, 0.5, { ...params, arcHeight: 10 }, duration)
    const avgY = result.reduce((s, p) => s + p.y, 0) / result.length
    expect(avgY).toBeGreaterThan(11)
  })

  it('laneSpread creates lateral separation at midpoint', () => {
    const result = interpolateAntTrail(mapping, from, to, 0.5, { ...params, laneSpread: 20 }, duration)
    let minZ = Infinity, maxZ = -Infinity
    for (const p of result) {
      minZ = Math.min(minZ, p.z)
      maxZ = Math.max(maxZ, p.z)
    }
    expect(maxZ - minZ).toBeGreaterThan(5)
  })

  it('clamps t outside [0,1]', () => {
    const rNeg = interpolateAntTrail(mapping, from, to, -0.5, params, duration)
    const r0 = interpolateAntTrail(mapping, from, to, 0, params, duration)
    expect(JSON.stringify(rNeg)).toBe(JSON.stringify(r0))

    const rOver = interpolateAntTrail(mapping, from, to, 1.5, params, duration)
    const r1 = interpolateAntTrail(mapping, from, to, 1, params, duration)
    expect(JSON.stringify(rOver)).toBe(JSON.stringify(r1))
  })
})

// ── computeAntTrailMinDuration tests ────────────────────────────────────────

describe('computeAntTrailMinDuration', () => {
  const from = makeGrid(20, 3, { x: -15, y: 10, z: 0 })
  const to = makeGrid(20, 3, { x: 15, y: 10, z: 0 })
  const mapping = identityMapping(20)
  const params: AntTrailParams = { ...DEFAULT_ANT_TRAIL_PARAMS, laneCount: 2 }

  it('returns 0 for empty mapping', () => {
    expect(computeAntTrailMinDuration([], [], [], params)).toBe(0)
  })

  it('returns positive duration for real transition', () => {
    const dur = computeAntTrailMinDuration(mapping, from, to, params)
    expect(dur).toBeGreaterThan(0)
  })

  it('more drones → longer or equal duration (stagger)', () => {
    const from10 = makeGrid(10, 3, { x: -15, y: 10, z: 0 })
    const to10 = makeGrid(10, 3, { x: 15, y: 10, z: 0 })
    const from40 = makeGrid(40, 3, { x: -15, y: 10, z: 0 })
    const to40 = makeGrid(40, 3, { x: 15, y: 10, z: 0 })

    const dur10 = computeAntTrailMinDuration(identityMapping(10), from10, to10, params)
    const dur40 = computeAntTrailMinDuration(identityMapping(40), from40, to40, params)
    expect(dur40).toBeGreaterThanOrEqual(dur10)
  })

  it('more lanes → shorter or equal duration', () => {
    const dur2 = computeAntTrailMinDuration(mapping, from, to, { ...params, laneCount: 2 })
    const dur4 = computeAntTrailMinDuration(mapping, from, to, { ...params, laneCount: 4 })
    expect(dur4).toBeLessThanOrEqual(dur2)
  })

  it('lower trailSpeed → longer duration', () => {
    const durFast = computeAntTrailMinDuration(mapping, from, to, { ...params, trailSpeed: 10 })
    const durSlow = computeAntTrailMinDuration(mapping, from, to, { ...params, trailSpeed: 3 })
    expect(durSlow).toBeGreaterThan(durFast)
  })
})
