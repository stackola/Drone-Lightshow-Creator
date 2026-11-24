import { describe, expect, it } from 'vitest'
import { buildShowFromPlan, effectFromInput, normalizeHex, sceneFromInput, shapeFromInput } from './convert'
import { ShowPlan, type ShowPlan as Plan } from './schemas'
import { newScene, newShow } from '@/core/defaults'
import { compile } from '@/core/compile'
import { validate } from '@/core/validate'
import { alignScenesToBars, barTimes, summarizeMusic } from '@/core/music'
import { autoFix } from '@/core/fixes'
import { beatEnergy } from '@/core/beats'
import type { ShowDoc } from '@/core/types'

function withMusic(doc: ShowDoc, bpm = 120, seconds = 240, offset = 4): ShowDoc {
  const beats = Array.from({ length: Math.floor((seconds * bpm) / 60) }, (_, i) => Math.round(((i * 60) / bpm) * 1000) / 1000)
  // Quiet intro, loud middle, medium end.
  const energy = beats.map((_, i) => (i < 64 ? 0.2 : i < 256 ? 0.95 : 0.55))
  return { ...doc, audio: { name: 'song.mp3', duration: seconds, offset, beats, downbeat: 0, bpm, energy } }
}

const PLAN: Plan = {
  title: 'Launch night',
  concept: 'A countdown into the brand reveal.',
  scenes: [
    { name: 'Three', shape: { kind: 'text', text: '3', font: 'pixel' }, light: { effect: 'solid', color: '#ffffff' }, hold_seconds: 2, spare_fraction: 0.5 },
    { name: 'Star', shape: { kind: 'star', points: 99, fill: 'outline', scale: 1.3 }, light: { effect: 'chase', color: '#331100', color2: '#ffd36e' } },
    { name: 'Globe', shape: { kind: 'sphere' }, light: { effect: 'rainbow' }, hold_seconds: 10, spin: 80 },
    { name: 'Brand', shape: { kind: 'text', text: 'ACME', font: 'sans' }, light: { effect: 'gradient', color: '#00d1b2', color2: 'not-a-colour' }, tilt: 20 },
  ],
  cues: [
    { scene_index: 0, offset_seconds: 0, duration_seconds: 1, blend: 'add', light: { effect: 'flash' } },
    { scene_index: 3, offset_seconds: -2, duration_seconds: 5, blend: 'replace', fade_in: 1, fade_out: 1, light: { effect: 'twinkle', color: '#c08a1e' } },
    { scene_index: 9, offset_seconds: 0, duration_seconds: 1, blend: 'add', light: { effect: 'flash' } },
  ],
}

describe('AI input conversion', () => {
  it('clamps numbers and repairs colours', () => {
    expect(normalizeHex('#ABC', '#000000')).toBe('#aabbcc')
    expect(normalizeHex('red', '#000000')).toBe('#000000')
    expect(effectFromInput({ effect: 'strobe', rate: 500 })).toMatchObject({ kind: 'strobe', rate: 25, color: '#ffffff' })
    expect(effectFromInput({ effect: 'flash', every: 0, beat_sync: true })).toMatchObject({ every: 1, beatSync: true })
    expect(effectFromInput({ effect: 'gradient', color: '#112233', color2: 'nope' })).toMatchObject({ a: '#112233', b: '#f472b6' })
    expect(shapeFromInput({ kind: 'polygon', sides: 50 })).toMatchObject({ kind: 'polygon', sides: 12 })
    expect(shapeFromInput({ kind: 'star', points: 6.6, inner: -3 })).toMatchObject({ points: 7, inner: 0.2 })
  })

  it('the plan schema accepts the fixture', () => {
    expect(ShowPlan.safeParse(PLAN).success).toBe(true)
  })

  it('builds a scene that is safe and above the floor', () => {
    const doc = newShow(150)
    const scene = sceneFromInput(doc, { name: 'Big tilted torus', shape: { kind: 'torus', scale: 2 }, light: { effect: 'solid' }, tilt: 80, altitude: 0 })
    const v = validate({ ...doc, scenes: [scene] }, compile({ ...doc, scenes: [scene] }))
    expect(v.issues).toEqual([])
    expect(scene.rotation[0]).toBe(80)
  })

  it('applies idle motion and spare roles, and calms unsafe motion with the automatic fixes', () => {
    const doc = newShow(160)
    const scene = sceneFromInput(doc, {
      name: 'Logo', shape: { kind: 'heart' }, light: { effect: 'solid', color: '#ff3366' }, hold_seconds: 20,
      spare_fraction: 0.3, spare_role: 'halo', idle_motion: { kind: 'breathe', amount: 25, period_seconds: 2 },
    })
    // 25% breathing every 2 s is far too fast for a big formation: it is calmed on the way in.
    expect(scene.motion?.kind ?? 'none').not.toBe('bob')
    expect(scene.motion?.amount ?? 0).toBeLessThan(0.25)
    expect(scene.layers.map((l) => l.role)).toEqual([undefined, 'halo'])
    const fixed = autoFix({ ...doc, scenes: [scene] })
    expect(fixed.validation.issues).toEqual([])
    const gentle = sceneFromInput(doc, { name: 'Calm', shape: { kind: 'circle' }, light: { effect: 'solid' }, hold_seconds: 20, idle_motion: { kind: 'bob', amount: 1, period_seconds: 8 } })
    expect(gentle.motion).toEqual({ kind: 'bob', amount: 1, period: 8 })
    const still = sceneFromInput(doc, { name: 'x', shape: { kind: 'circle' }, light: { effect: 'solid' }, idle_motion: { kind: 'none' } })
    expect(still.motion).toBeUndefined()
  })

  it('turns a plan into a show that passes every check', () => {
    const built = buildShowFromPlan(PLAN, newShow(160))
    expect(built.doc.name).toBe('Launch night')
    expect(built.doc.scenes.map((s) => s.name)).toEqual(['Three', 'Star', 'Globe', 'Brand'])
    expect(built.doc.scenes[0]!.layers).toHaveLength(2) // spare drones parked
    expect(built.doc.cues).toHaveLength(2) // the cue on scene 9 is dropped
    expect(built.validation.issues).toEqual([])
    // The 80°/s spin was too fast and got slowed by the automatic fixes.
    expect(Math.abs(built.doc.scenes[2]!.spin)).toBeLessThan(80)
  })

  it('lands every formation on a bar line when there is music', () => {
    const built = buildShowFromPlan(PLAN, withMusic(newShow(160), 120, 480))
    expect(built.alignedToMusic).toBe(4)
    const bars = barTimes(built.doc)
    const c = compile(built.doc)
    for (const st of c.sceneTimes) {
      expect(bars.some((b) => Math.abs(b - st.holdStart) < 0.01)).toBe(true)
      expect(st.extended).toBe(false)
    }
    expect(built.validation.issues).toEqual([])
  })

  it('alignment is idempotent and never shortens a flight below its safe minimum', () => {
    const doc = withMusic(newShow(120))
    doc.scenes.push(newScene(doc, 'heart'), newScene(doc, 'sphere'), newScene(doc, 'star'))
    const once = alignScenesToBars(doc).doc
    const twice = alignScenesToBars(once).doc
    expect(twice.scenes.map((s) => [s.hold, s.flight.duration])).toEqual(once.scenes.map((s) => [s.hold, s.flight.duration]))
    for (const st of compile(twice).sceneTimes) expect(st.holdStart - st.flightStart).toBeGreaterThanOrEqual(st.minFlight - 1e-6)
  })

  it('summarises music into bars and sections', () => {
    const m = summarizeMusic(withMusic(newShow(10)))!
    expect(m.bpm).toBe(120)
    expect(m.barLength).toBeCloseTo(2, 6)
    expect(m.sections.map((s) => s.level)).toEqual(['quiet', 'loud', 'medium'])
  })
})

describe('autoFix', () => {
  it('raises a low formation exactly once (no double-applied moves)', () => {
    const doc = newShow(80)
    const s = newScene(doc, 'heart')
    s.position = [0, 0, 0]
    doc.scenes.push(s)
    const { doc: fixed, validation } = autoFix(doc)
    expect(validation.issues).toEqual([])
    const pts = compile(fixed).scenes[0]!.points
    let minY = Infinity
    for (let i = 1; i < pts.length; i += 3) minY = Math.min(minY, pts[i]!)
    expect(minY).toBeGreaterThanOrEqual(doc.limits.minAltitude - 1e-6)
    expect(minY).toBeLessThan(doc.limits.minAltitude + 1)
  })
})

describe('beat energy', () => {
  it('is louder where the signal is louder', () => {
    const sr = 1000
    const x = Float32Array.from({ length: 4000 }, (_, i) => Math.sin(i) * (i < 2000 ? 0.1 : 0.8))
    const e = beatEnergy(x, sr, [0, 1, 2, 3])
    expect(e[3]).toBe(1)
    expect(e[0]!).toBeLessThan(0.2)
  })
})
