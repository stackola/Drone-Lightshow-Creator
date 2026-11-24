import { describe, expect, it } from 'vitest'
import { compile, expandSet } from './compile'
import { evaluate } from './evaluate'
import { validate, flightClosestApproach } from './validate'
import { fitScene, newScene, newShow } from './defaults'
import { applyFixToDoc } from './fixes'
import { fastestProfile, holdPeaks, holdPose, holdRange, moveExtents, profilePeaks } from './motion'
import { minPairDistance, rng } from './math'
import { normalizeDoc } from './serialize'
import type { HoldMotion, ShapeKind, ShowDoc } from './types'

/** Shows whose formations sit right at the minimum spacing — too dense for straight flights to be safe. */
function denseShow(seed: number, n: number, scenes = 3): ShowDoc {
  const r = rng(seed)
  const kinds: ShapeKind[] = ['circle', 'heart', 'star', 'grid', 'sphere', 'torus', 'cube', 'spiral', 'wave', 'cone', 'helix', 'polygon']
  const doc = newShow(n)
  doc.limits.maxAltitude = 300
  doc.limits.maxRadius = 400
  for (let k = 0; k < scenes; k++) {
    let sc = newScene(doc, kinds[Math.floor(r() * kinds.length)]!)
    sc = fitScene(sc, n, doc.limits.minSpacing * (1 + r() * 0.2), 'exact')
    doc.scenes.push({ ...sc, position: [(r() - 0.5) * 40, 90 + r() * 30, (r() - 0.5) * 40], rotation: [r() * 90, r() * 180, 0] })
  }
  return doc
}

describe('collision-free flights', () => {
  it('dense random shows have no near-misses: straight flights or spread–cross–gather detours', () => {
    let detours = 0
    for (let seed = 1; seed <= 8; seed++) {
      const doc = denseShow(seed, 120 + seed * 15)
      const c = compile(doc)
      const v = validate(doc, c)
      expect(v.issues.filter((i) => i.kind === 'near-miss')).toEqual([])
      expect(v.stats.minDistance).toBeGreaterThanOrEqual(doc.limits.minSpacing - 1e-6)
      detours += c.segments.filter((s) => s.kind === 'flight' && s.detour).length
    }
    // The property is only meaningful if detours were actually needed.
    expect(detours).toBeGreaterThan(4)
  })

  it('detour legs are contiguous, end on the formation, and the spread only widens gaps', () => {
    const doc = denseShow(3, 160)
    const c = compile(doc)
    const flights = c.segments.filter((s) => s.kind === 'flight' && s.detour)
    expect(flights.length).toBeGreaterThan(0)
    for (const seg of flights) {
      if (seg.kind !== 'flight') continue
      expect(seg.legs[0]!.t0).toBeCloseTo(seg.t0, 9)
      expect(seg.legs[seg.legs.length - 1]!.t1).toBeCloseTo(seg.t1, 6)
      for (let i = 1; i < seg.legs.length; i++) {
        expect(seg.legs[i]!.t0).toBeCloseTo(seg.legs[i - 1]!.t1, 9)
        expect(Array.from(seg.legs[i]!.from)).toEqual(Array.from(seg.legs[i - 1]!.to))
      }
      expect(Array.from(seg.legs[0]!.from)).toEqual(Array.from(seg.from))
      expect(Array.from(seg.legs[seg.legs.length - 1]!.to)).toEqual(Array.from(seg.to))
      const spread = seg.legs.find((l) => l.kind === 'spread')
      if (spread) expect(minPairDistance(spread.to)).toBeGreaterThan(minPairDistance(spread.from))
    }
  })

  it('evaluate follows the legs continuously (no jumps at leg boundaries)', () => {
    const doc = denseShow(5, 100)
    const c = compile(doc)
    const seg = c.segments.find((s) => s.kind === 'flight' && s.detour)!
    const a = new Float32Array(c.n * 3), b = new Float32Array(c.n * 3)
    const vmax = Math.hypot(doc.limits.maxSpeedH, Math.max(doc.limits.maxSpeedUp, doc.limits.maxSpeedDown))
    const dt = 0.01
    evaluate(c, seg.t0, a, null)
    for (let t = seg.t0 + dt; t <= seg.t1; t += dt) {
      evaluate(c, t, b, null)
      for (let i = 0; i < c.n; i++) {
        expect(Math.hypot(b[i * 3]! - a[i * 3]!, b[i * 3 + 1]! - a[i * 3 + 1]!, b[i * 3 + 2]! - a[i * 3 + 2]!)).toBeLessThanOrEqual(vmax * dt * 1.01 + 1e-4)
      }
      a.set(b)
    }
  })

  it('expanding a formation scales every gap by k and stays inside the airspace', () => {
    const doc = denseShow(2, 80, 1)
    const pts = compile(doc).scenes[0]!.points
    const out = expandSet(pts, 1.7, doc.limits)
    expect(minPairDistance(out)).toBeCloseTo(minPairDistance(pts) * 1.7, 3)
    const r = flightClosestApproach(pts, out, 0)
    expect(r.d).toBeCloseTo(minPairDistance(pts), 3)
    for (let i = 1; i < out.length; i += 3) expect(out[i]!).toBeGreaterThanOrEqual(doc.limits.minAltitude)
  })
})

describe('jerk limits', () => {
  it('the fastest profile respects speed, acceleration and jerk, and lower jerk means slower flights', () => {
    const L = newShow().limits
    for (const d of [0.5, 3, 20, 80, 200]) {
      const e = moveExtents(Float32Array.from([0, 50, 0]), Float32Array.from([d * 0.8, 50 + d * 0.6, 0]))
      const p = fastestProfile(e, L)
      const pk = profilePeaks(e, p)
      expect(pk.h).toBeLessThanOrEqual(L.maxSpeedH * (1 + 1e-9))
      expect(pk.up).toBeLessThanOrEqual(L.maxSpeedUp * (1 + 1e-9))
      expect(pk.acc).toBeLessThanOrEqual(L.maxAccel * (1 + 1e-9))
      expect(pk.jerk).toBeLessThanOrEqual(L.maxJerk * (1 + 1e-9))
      const soft = fastestProfile(e, { ...L, maxJerk: 1 })
      expect(soft.T).toBeGreaterThanOrEqual(p.T - 1e-9)
      expect(profilePeaks(e, soft).jerk).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('a whole show stays within the jerk limit', () => {
    const doc = denseShow(4, 90)
    const v = validate(doc, compile(doc))
    expect(v.stats.peakJerk).toBeGreaterThan(0)
    expect(v.stats.peakJerk).toBeLessThanOrEqual(doc.limits.maxJerk + 1e-6)
  })
})

describe('hold motions', () => {
  const motions: HoldMotion[] = [
    { kind: 'breathe', amount: 0.06, period: 8 },
    { kind: 'bob', amount: 1.5, period: 6 },
    { kind: 'sway', amount: 6, period: 10 },
  ]

  function heldShow(motion: HoldMotion, spin = 0): ShowDoc {
    const doc = newShow(80)
    const sc = newScene(doc, 'heart')
    doc.scenes.push({ ...sc, hold: 16, spin, motion })
    return doc
  }

  it('never brings drones closer than the base formation, and starts and ends at rest in the base pose', () => {
    for (const m of motions) {
      const doc = heldShow(m, 4)
      const c = compile(doc)
      const cs = c.scenes[0]!
      const ts = c.sceneTimes[0]!
      const base = minPairDistance(cs.points)
      const p = new Float32Array(c.n * 3)
      for (let t = ts.holdStart; t <= ts.holdEnd; t += 0.25) {
        evaluate(c, t, p, null)
        expect(minPairDistance(p)).toBeGreaterThanOrEqual(base - 1e-3)
      }
      const pose0 = holdPose(cs.omega, cs.hold, cs.motion, 0), pose1 = holdPose(cs.omega, cs.hold, cs.motion, cs.hold)
      expect(pose0.scale).toBeCloseTo(1, 9); expect(pose0.dy).toBeCloseTo(0, 9)
      expect(pose1.scale).toBeCloseTo(1, 9); expect(pose1.dy).toBeCloseTo(0, 9)
      // End pose equals the spin-only end points the next flight starts from.
      evaluate(c, ts.holdEnd - 1e-9, p, null)
      for (let i = 0; i < c.n; i++) {
        const k = cs.slot[i]!
        expect(p[i * 3]!).toBeCloseTo(cs.endPoints[k * 3]!, 3)
        expect(p[i * 3 + 1]!).toBeCloseTo(cs.endPoints[k * 3 + 1]!, 3)
      }
      const v = validate(doc, c)
      expect(v.issues).toEqual([])
    }
  })

  it('pose range bounds the motion', () => {
    const r = holdRange(0, 20, { kind: 'bob', amount: 4, period: 4 })
    expect(r.dyMax).toBeGreaterThan(3.9); expect(r.dyMax).toBeLessThanOrEqual(4)
    expect(r.dyMin).toBeLessThan(-3.9)
    const b = holdRange(0, 20, { kind: 'breathe', amount: 0.2, period: 5 })
    expect(b.scaleMax).toBeGreaterThan(1.19); expect(b.scaleMax).toBeLessThanOrEqual(1.2 + 1e-9)
  })

  it('peaks match the analytic bob speed', () => {
    // Away from the envelope ramps, bob speed peaks at A·2π/P.
    const pk = holdPeaks([[0, 0, 0]], 0, 60, { kind: 'bob', amount: 1, period: 10 })
    expect(pk.up).toBeGreaterThan((2 * Math.PI) / 10 * 0.98)
    expect(pk.up).toBeLessThan((2 * Math.PI) / 10 * 1.3)
  })

  it('flags violent motion, and the calm fix makes it safe', () => {
    const doc = heldShow({ kind: 'bob', amount: 12, period: 1.5 }, 10)
    const v = validate(doc, compile(doc))
    const issue = v.issues.find((i) => i.kind === 'spin')!
    expect(issue).toBeTruthy()
    expect(issue.fix!.action.kind).toBe('calm-hold')
    const fixed = applyFixToDoc(doc, issue.fix!.action)
    expect(fixed.scenes[0]!.motion!.amount).toBeLessThan(12)
    expect(validate(fixed, compile(fixed)).issues.filter((i) => i.kind === 'spin')).toEqual([])
  })

  it('breathing and bobbing count toward the altitude limits', () => {
    const doc = heldShow({ kind: 'bob', amount: 8, period: 8 })
    const c = compile(doc)
    let minY = Infinity
    for (let k = 1; k < c.scenes[0]!.points.length; k += 3) minY = Math.min(minY, c.scenes[0]!.points[k]!)
    doc.scenes[0]!.position[1] -= minY - doc.limits.minAltitude - 2 // 2 m above the floor; bob dips 8 m
    const v = validate(doc, compile(doc))
    expect(v.issues.some((i) => i.kind === 'altitude')).toBe(true)
  })

  it('round-trips through the file format', () => {
    const doc = heldShow({ kind: 'sway', amount: 15, period: 7 })
    doc.scenes[0]!.layers[0]!.role = 'halo'
    doc.limits.maxJerk = 4.5
    const back = normalizeDoc(JSON.parse(JSON.stringify(doc)))
    expect(back.scenes[0]!.motion).toEqual({ kind: 'sway', amount: 15, period: 7 })
    expect(back.scenes[0]!.layers[0]!.role).toBe('halo')
    expect(back.limits.maxJerk).toBe(4.5)
    const old = normalizeDoc(JSON.parse(JSON.stringify({ ...doc, limits: { ...doc.limits, maxJerk: undefined } })))
    expect(old.limits.maxJerk).toBe(6)
  })
})
