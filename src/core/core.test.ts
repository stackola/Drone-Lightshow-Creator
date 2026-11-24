import { describe, expect, it } from 'vitest'
import { assignMinSquared, totalSquared } from './assign'
import { SHAPES, generateShape } from './shapes'
import { minPairDistance, rng } from './math'
import { RAMP_ACC, fastestProfile, moveExtents, profileAcc, profileInverse, profilePeaks, profileS, profileVel, spinAngle, spinPeaks, stretchProfile } from './motion'
import { allocate, compile, padGrid } from './compile'
import { evaluate } from './evaluate'
import { closestPair, comfortableSpacing, flightClosestApproach, validate } from './validate'
import { fitScene, newScene, newShape, newShow, unitSpacing } from './defaults'
import type { ShapeSpec, ShowDoc } from './types'

function randomPoints(n: number, seed: number, scale = 10): Float32Array {
  const r = rng(seed)
  return Float32Array.from({ length: n * 3 }, () => (r() - 0.5) * scale)
}

function permutations(n: number): number[][] {
  if (n === 1) return [[0]]
  const out: number[][] = []
  for (const p of permutations(n - 1)) for (let i = 0; i <= p.length; i++) out.push([...p.slice(0, i), n - 1, ...p.slice(i)])
  return out
}

describe('assignment', () => {
  it('matches brute force on small random instances', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const n = 2 + (seed % 6)
      const a = randomPoints(n, seed), b = randomPoints(n, seed + 100)
      const m = assignMinSquared(a, b)
      expect(new Set(m).size).toBe(n)
      let best = Infinity
      for (const p of permutations(n)) best = Math.min(best, totalSquared(a, b, Int32Array.from(p)))
      expect(totalSquared(a, b, m)).toBeCloseTo(best, 6)
    }
  })

  it('is the identity when targets equal sources', () => {
    const a = randomPoints(50, 7)
    const m = assignMinSquared(a, a)
    expect(Array.from(m)).toEqual(Array.from({ length: 50 }, (_, i) => i))
  })
})

describe('shapes', () => {
  it.each(SHAPES.filter((s) => s.kind !== 'image').map((s) => s.kind))('%s yields exactly n distinct, finite points', (kind) => {
    for (const n of [1, 7, 64, 233]) {
      const spec = newShape(kind)
      const { points } = generateShape({ ...spec, size: 40 } as ShapeSpec, n)
      expect(points.length).toBe(n * 3)
      expect(points.every(Number.isFinite)).toBe(true)
      if (n > 1) expect(minPairDistance(points)).toBeGreaterThan(0.05)
    }
  })

  it('scales linearly with size', () => {
    const s = newShape('heart')
    const a = minPairDistance(generateShape({ ...s, size: 10 } as ShapeSpec, 100).points)
    const b = minPairDistance(generateShape({ ...s, size: 30 } as ShapeSpec, 100).points)
    expect(b / a).toBeCloseTo(3, 4)
  })

  it('fits to an exact spacing target', () => {
    const doc = newShow(150)
    for (const kind of ['circle', 'heart', 'star', 'grid', 'sphere', 'torus', 'text'] as const) {
      const scene = newScene(doc, kind)
      const d = minPairDistance(compile({ ...doc, scenes: [scene] }).scenes[0]!.points)
      const target = comfortableSpacing(doc.limits.minSpacing)
      expect(d).toBeGreaterThanOrEqual(target - 1e-3)
      expect(d).toBeLessThan(target * 1.15)
    }
  })

  it('minPairDistance agrees with brute force for large sets', () => {
    const p = randomPoints(900, 3, 200)
    expect(minPairDistance(p)).toBeCloseTo(closestPair(p).d, 6)
  })
})

describe('motion', () => {
  it('S-curve: s goes 0→1 monotonically with exact peak rate and acceleration', () => {
    for (const p of [{ T: 10, r: 2, h: 1 / 8 }, { T: 4, r: 2, h: 0.5 }, { T: 20, r: 0.5, h: 1 / 19.5 }]) {
      expect(profileS(p, 0)).toBe(0)
      expect(profileS(p, p.T)).toBe(1)
      let v = 0, a = 0, prev = 0
      const N = 200000
      for (let i = 1; i <= N; i++) {
        const t = (i / N) * p.T
        const s = profileS(p, t)
        expect(s).toBeGreaterThanOrEqual(prev - 1e-12)
        // Finite differences agree with the analytic derivatives.
        if (i % 997 === 0 && t > 1e-3 && t < p.T - 1e-3) {
          const dt = 1e-5
          expect((profileS(p, t + dt) - profileS(p, t - dt)) / (2 * dt)).toBeCloseTo(profileVel(p, t), 5)
          expect((profileVel(p, t + dt) - profileVel(p, t - dt)) / (2 * dt)).toBeCloseTo(profileAcc(p, t), 4)
        }
        prev = s
        v = Math.max(v, profileVel(p, t))
        a = Math.max(a, Math.abs(profileAcc(p, t)))
      }
      expect(v).toBeCloseTo(p.h, 9)
      expect(a).toBeCloseTo((RAMP_ACC * p.h) / p.r, 6)
      expect(profileInverse(p, profileS(p, 3.3))).toBeCloseTo(3.3, 6)
    }
  })

  it('fastest profile meets exactly one binding limit and stretching only lowers peaks', () => {
    const L = newShow().limits
    const a = randomPoints(30, 5, 80), b = randomPoints(30, 6, 80)
    const e = moveExtents(a, b)
    const p = fastestProfile(e, L)
    const pk = profilePeaks(e, p)
    expect(pk.h).toBeLessThanOrEqual(L.maxSpeedH + 1e-9)
    expect(pk.up).toBeLessThanOrEqual(L.maxSpeedUp + 1e-9)
    expect(pk.down).toBeLessThanOrEqual(L.maxSpeedDown + 1e-9)
    expect(pk.acc).toBeLessThanOrEqual(L.maxAccel + 1e-9)
    const binding = [pk.h / L.maxSpeedH, pk.up / L.maxSpeedUp, pk.down / L.maxSpeedDown, pk.acc / L.maxAccel]
    expect(Math.max(...binding)).toBeCloseTo(1, 9)
    const slow = profilePeaks(e, stretchProfile(p, p.T * 1.5))
    expect(slow.h).toBeLessThan(pk.h)
    expect(slow.acc).toBeLessThan(pk.acc)
  })

  it('spin angle is continuous and has the closed-form total', () => {
    const omega = 0.5, hold = 10
    let prev = 0
    for (let i = 1; i <= 1000; i++) {
      const a = spinAngle(omega, hold, (i / 1000) * hold)
      expect(a - prev).toBeLessThan(omega * (hold / 1000) + 1e-9)
      expect(a).toBeGreaterThanOrEqual(prev)
      prev = a
    }
    expect(prev).toBeCloseTo(omega * (hold - 3), 9)
  })

  it('spin peak speed is omega * r', () => {
    expect(spinPeaks(0.2, 10, 20).speed).toBeCloseTo(4, 9)
  })
})

describe('allocation', () => {
  it('always sums to n', () => {
    expect(allocate(10, [1, 1, 1])).toEqual([4, 3, 3])
    expect(allocate(7, [0, 0])).toEqual([7, 0])
    for (let n = 1; n < 50; n++) expect(allocate(n, [0.3, 2, 1.1]).reduce((a, b) => a + b)).toBe(n)
  })
})

function demoDoc(n = 120): ShowDoc {
  const doc = newShow(n)
  doc.scenes.push(newScene(doc, 'circle'))
  doc.scenes.push(newScene(doc, 'heart'))
  const sphere = newScene(doc, 'sphere')
  sphere.spin = 20
  doc.scenes.push(sphere)
  doc.scenes.push(newScene(doc, 'text'))
  return doc
}

describe('compile + evaluate', () => {
  it('produces a continuous trajectory for every drone', () => {
    const doc = demoDoc()
    const c = compile(doc)
    const n = c.n
    const prev = new Float32Array(n * 3), cur = new Float32Array(n * 3)
    evaluate(c, 0, prev, null)
    const dt = 0.02
    // Max step bounded by the speed limits (plus float slack).
    const vmax = Math.hypot(doc.limits.maxSpeedH, Math.max(doc.limits.maxSpeedUp, doc.limits.maxSpeedDown))
    for (let t = dt; t <= c.duration; t += dt) {
      evaluate(c, t, cur, null)
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(cur[i * 3]! - prev[i * 3]!, cur[i * 3 + 1]! - prev[i * 3 + 1]!, cur[i * 3 + 2]! - prev[i * 3 + 2]!)
        expect(d).toBeLessThanOrEqual(vmax * dt * 1.01 + 1e-4)
      }
      prev.set(cur)
    }
  })

  it('starts on the pads and ends on the pads', () => {
    const doc = demoDoc(64)
    const c = compile(doc)
    const p = new Float32Array(c.n * 3)
    evaluate(c, 0, p, null)
    expect(Array.from(p)).toEqual(Array.from(padGrid(64, doc.site.gridSpacing)))
    evaluate(c, c.duration, p, null)
    const pads = new Set(Array.from({ length: 64 }, (_, i) => `${c.pads[i * 3]},${c.pads[i * 3 + 2]}`))
    for (let i = 0; i < 64; i++) {
      expect(p[i * 3 + 1]).toBeCloseTo(0, 6)
      expect(pads.has(`${p[i * 3]},${p[i * 3 + 2]}`)).toBe(true)
    }
  })

  it('auto flights respect every dynamic limit', () => {
    const doc = demoDoc()
    const v = validate(doc, compile(doc))
    const L = doc.limits
    expect(v.stats.peakSpeedH).toBeLessThanOrEqual(L.maxSpeedH + 1e-6)
    expect(v.stats.peakClimb).toBeLessThanOrEqual(L.maxSpeedUp + 1e-6)
    expect(v.stats.peakDescent).toBeLessThanOrEqual(L.maxSpeedDown + 1e-6)
    expect(v.stats.peakAccel).toBeLessThanOrEqual(L.maxAccel + 1e-6)
  })

  it('manual flights shorter than the minimum are extended, never unsafe', () => {
    const doc = demoDoc()
    doc.scenes[1]!.flight.duration = 0.5
    const c = compile(doc)
    expect(c.sceneTimes[1]!.extended).toBe(true)
    const v = validate(doc, c)
    expect(v.issues.filter((i) => i.kind === 'speed' || i.kind === 'accel')).toEqual([])
  })
})

describe('validator', () => {
  it('a show built from defaults is clean', () => {
    const doc = demoDoc()
    const v = validate(doc, compile(doc))
    expect(v.issues).toEqual([])
    expect(v.stats.minDistance).toBeGreaterThanOrEqual(doc.limits.minSpacing)
  })

  it('closest approach matches dense sampling', () => {
    const a = randomPoints(40, 11, 30), b = randomPoints(40, 12, 30)
    const exact = flightClosestApproach(a, b, 0)
    let sampled = Infinity
    for (let k = 0; k <= 2000; k++) {
      const s = k / 2000
      const p = a.map((v, i) => v + (b[i]! - v) * s)
      sampled = Math.min(sampled, closestPair(p).d)
    }
    expect(exact.d).toBeLessThanOrEqual(sampled + 1e-6)
    expect(sampled - exact.d).toBeLessThan(0.05)
  })

  it('flags dense formations and the fix resolves them', () => {
    const doc = demoDoc()
    const s = doc.scenes[1]!
    s.layers[0]!.shape = { ...s.layers[0]!.shape, size: s.layers[0]!.shape.size * 0.4 } as ShapeSpec
    let v = validate(doc, compile(doc))
    const issue = v.issues.find((i) => i.kind === 'spacing')!
    expect(issue).toBeTruthy()
    expect(issue.fix?.action.kind).toBe('fit-spacing')
    doc.scenes[1] = fitScene(s, doc.droneCount, comfortableSpacing(doc.limits.minSpacing), 'grow')
    v = validate(doc, compile(doc))
    expect(v.issues).toEqual([])
  })

  it('flags altitude, geofence, spin and battery problems', () => {
    const doc = demoDoc(60)
    doc.scenes[0]!.position = [0, 5, 0]
    doc.scenes[1]!.position = [200, 60, 0]
    doc.scenes[2]!.spin = 400
    doc.limits.maxFlightTime = 30
    const kinds = new Set(validate(doc, compile(doc)).issues.map((i) => i.kind))
    expect(kinds).toEqual(new Set(['altitude', 'geofence', 'spin', 'flight-time']))
  })

  it('detects a real near-miss in a crossing transition', () => {
    // Two drones; the formation spins exactly half a turn, so they swap sides.
    // "Return to own pad" then forces their paths to cross head-on.
    const doc = newShow(2)
    doc.site.gridSpacing = 4
    const scene = newScene(doc, 'grid')
    scene.layers[0]!.shape = { kind: 'grid', size: 4, aspect: 4 }
    scene.hold = 10
    scene.spin = 180 / 7 // ω·(hold − ramp) = π
    doc.scenes.push(scene)
    doc.site.landing = 'any'
    expect(validate(doc, compile(doc)).issues).toEqual([])
    doc.site.landing = 'home'
    const v = validate(doc, compile(doc))
    const miss = v.issues.find((i) => i.kind === 'near-miss')
    expect(miss).toBeTruthy()
    expect(v.stats.minDistance).toBeLessThan(0.01)
  })

  it('exact closest approach of a head-on swap is zero at the midpoint', () => {
    const a = Float32Array.from([-2, 0, 0, 2, 0, 0]), b = Float32Array.from([2, 0, 0, -2, 0, 0])
    const r = flightClosestApproach(a, b, 1)
    expect(r.d).toBeCloseTo(0, 9)
    expect(r.s).toBeCloseTo(0.5, 9)
    expect(r.pairsBelow).toBe(1)
  })

  it('unit spacing is positive for every shape', () => {
    for (const s of SHAPES) {
      if (s.kind === 'image') continue
      expect(unitSpacing(newShape(s.kind), 50)).toBeGreaterThan(0)
    }
  })
})
