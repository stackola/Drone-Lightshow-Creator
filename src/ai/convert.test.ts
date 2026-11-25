import { describe, expect, it } from 'vitest'
import { buildShowFromPlan, effectFromInput, normalizeHex, sceneFromInput, shapeFromInput } from './convert'
import { ShowPlan, type ShowPlan as Plan } from './schemas'
import { newScene, newShow } from '@/core/defaults'
import { compile } from '@/core/compile'
import { validate } from '@/core/validate'
import { alignScenesToBars, barTimes, songSections, summarizeMusic } from '@/core/music'
import { describeMusic } from './context'
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

describe('music-first plans', () => {
  it('fits the song, lands the chosen formation on its section, and lights the music', () => {
    const base = withMusic(newShow(120), 120, 150, 0)
    // A longer intro (60 s), then the drop, then a medium outro.
    base.audio!.energy = base.audio!.beats.map((_, i) => (i < 120 ? 0.2 : i < 240 ? 0.95 : 0.55))
    const plan: Plan = {
      title: 'Drop', concept: 'Calm intro, hero on the drop.',
      scenes: [
        { name: 'Hello', shape: { kind: 'circle' }, light: { effect: 'solid', color: '#ffffff' }, hold_seconds: 8 },
        { name: 'Hero', shape: { kind: 'heart' }, light: { effect: 'solid', color: '#ff3366' }, hold_seconds: 8, arrive_at_section: 2 },
        { name: 'Bye', shape: { kind: 'star' }, light: { effect: 'solid', color: '#ffd36e' }, hold_seconds: 8 },
      ],
      cues: [],
      music_lighting: 'bold',
    }
    const built = buildShowFromPlan(plan, base)
    const sections = songSections(built.doc)
    const c = compile(built.doc)
    expect(c.sceneTimes[1]!.holdStart).toBeCloseTo(sections[1]!.start, 1)
    expect(built.doc.cues.some((q) => q.tag === 'music')).toBe(true)
    expect(built.validation.issues).toEqual([])
    // The finale ends with the song (within a bar).
    expect(Math.abs(c.sceneTimes[2]!.holdEnd - 150)).toBeLessThanOrEqual(2.01)
  })

  it('describes the song for the model: numbered sections and accents', () => {
    const doc = withMusic(newShow(40), 120, 150, 0)
    doc.audio!.accents = [32.1, 96.4]
    const text = describeMusic(doc)
    expect(text).toMatch(/1\. intro/)
    expect(text).toMatch(/drop|verse/)
    expect(text).toMatch(/Accents.*32\.1/)
  })
})

describe('director with an original score', () => {
  it('composes a score with the drops on the chosen hero formations', () => {
    const plan: Plan = { ...PLAN, original_score: { bpm: 110, drops_at: [2], breaks_at: [1] } }
    const built = buildShowFromPlan(plan, newShow(60), new Map(), { composeScore: true })
    expect(built.composed).toBe(true)
    const audio = built.doc.audio!
    expect(audio.generated).toMatch(/^soundtrack-v1/)
    expect(audio.bpm).toBe(110)
    const c = compile(built.doc)
    const drop = audio.sections!.find((s) => s.label === 'drop')!
    expect(drop.start).toBeCloseTo(c.sceneTimes[2]!.holdStart, 2)
    expect(audio.sections!.some((s) => s.label === 'break')).toBe(true)
    expect(built.doc.cues.some((q) => q.tag === 'music')).toBe(true)
    expect(built.validation.issues).toEqual([])
  })
})

describe('director plans with splits', () => {
  it('builds the groups with formations sized for each group, and stays safe', () => {
    const plan: Plan = {
      title: 'Split test', concept: 'Two hearts part ways.',
      scenes: [
        { name: 'Heart', shape: { kind: 'heart' }, light: { effect: 'solid', color: '#ff3366' }, hold_seconds: 4,
          split: { mode: 'halves', groups: [
            { name: 'Left', steps: [{ name: 'Ring', shape: { kind: 'circle', fill: 'outline' }, light: { effect: 'solid' }, hold_seconds: 4 }] },
            { name: 'Right', delay_seconds: 1, steps: [{ name: 'Star', shape: { kind: 'star' }, light: { effect: 'twinkle' } }, { name: 'Dot', shape: { kind: 'circle' }, light: { effect: 'solid' } }] },
          ] } },
        { name: 'Together', shape: { kind: 'circle' }, light: { effect: 'rainbow' } },
      ],
      cues: [],
    }
    expect(ShowPlan.safeParse(plan).success).toBe(true)
    const built = buildShowFromPlan(plan, newShow(80))
    const groups = built.doc.scenes[0]!.groups!
    expect(groups.map((g) => g.steps.length)).toEqual([1, 2])
    const c = compile(built.doc)
    const split = c.segments.find((s) => s.kind === 'split')
    expect(split?.kind).toBe('split')
    if (split?.kind === 'split') expect(split.tracks.map((t) => t.drones.length).sort()).toEqual([40, 40])
    expect(built.validation.issues).toEqual([])
  })
})

describe('plans use every feature', () => {
  it('LED signs, extra shapes, placement and the flight home', () => {
    const plan: Plan = {
      title: 'All in', concept: 'Everything.',
      scenes: [
        { name: 'Sign', shape: { kind: 'led_sign', text: 'HELLO', columns: 18 }, light: { effect: 'matrix', color: '#00ffcc', speed: 5 } },
        { name: 'Logo + name', shape: { kind: 'heart' }, light: { effect: 'solid', color: '#ff3366' }, across: 30, extra_shapes: [{ shape: { kind: 'text', text: 'ANA' }, light: { effect: 'solid', color: '#ffffff' }, up: -40, share: 0.4 }] },
      ],
      cues: [],
      return_flight: { transition: { style: 'rain' }, dim: true },
    }
    expect(ShowPlan.safeParse(plan).success).toBe(true)
    const built = buildShowFromPlan(plan, newShow(120))
    const [sign, logo] = built.doc.scenes
    expect(sign!.layers[0]!.effect).toMatchObject({ kind: 'matrix', text: 'HELLO', a: '#00ffcc' })
    expect(logo!.layers.filter((l) => !l.role).map((l) => l.shape.kind)).toEqual(['heart', 'text'])
    expect(logo!.position[0]).toBe(30)
    expect(built.doc.site.returnFlight.style?.kind).toBe('rain')
    expect(built.doc.site.returnFlight.dim).toBe(true)
    expect(built.validation.issues).toEqual([])
  })

  it('custom drawings and 3D models reach group formations and extra shapes', async () => {
    const { customJobs } = await import('./customs')
    const plan: Plan = {
      title: 'Customs', concept: '',
      scenes: [{
        name: 'Split', shape: { kind: 'custom', description: 'a logo' }, light: { effect: 'solid' },
        extra_shapes: [{ shape: { kind: 'model3d', description: 'a trophy' }, light: { effect: 'image' } }],
        split: { mode: 'halves', groups: [{ steps: [{ name: 'Cat', shape: { kind: 'custom', description: 'a cat' }, light: { effect: 'solid' } }] }, { steps: [{ name: 'Star', shape: { kind: 'star' }, light: { effect: 'solid' } }] }] },
      }],
      cues: [],
    }
    const jobs = customJobs(plan.scenes, 200)
    expect(jobs.map((j) => j.shape.description)).toEqual(['a logo', 'a trophy', 'a cat'])
    // A drawing made for the cat lands in the left group's formation, with its own colours.
    const cat = { kind: 'image' as const, size: 1, name: 'cat', mask: { w: 2, h: 2, bits: '1111' }, colors: null, cw: 0, ch: 0 }
    const customs = new Map<unknown, import('@/core/types').ShapeSpec>([[jobs[2]!.shape, cat]])
    const built = buildShowFromPlan(plan, newShow(200), customs)
    const step = built.doc.scenes[0]!.groups![0]!.steps[0]!
    expect(step.layers[0]!.shape.kind).toBe('image')
    expect(step.layers[0]!.effect.kind).toBe('image')
  })
})

describe('plans with keyframes', () => {
  it('a rocket rises while held, safely', () => {
    const plan: Plan = {
      title: 'Lift-off', concept: '',
      scenes: [
        { name: 'Rocket', shape: { kind: 'cone' }, light: { effect: 'solid', color: '#ffffff' }, hold_seconds: 16, keyframes: [{ at_seconds: 14, up: 15, turn: 90 }] },
        { name: 'Stars', shape: { kind: 'star' }, light: { effect: 'twinkle' } },
      ],
      cues: [],
    }
    expect(ShowPlan.safeParse(plan).success).toBe(true)
    const built = buildShowFromPlan(plan, newShow(80))
    expect(built.doc.scenes[0]!.keys?.[0]).toMatchObject({ t: 14, move: [0, 15, 0], rotate: [0, 90, 0] })
    expect(built.validation.issues).toEqual([])
  })
})

describe('shapes that move on their own', () => {
  it('a swinging sign and a turning star become joints, calmed to what the drones can fly', () => {
    const doc = newShow(200)
    const scene = sceneFromInput(doc, {
      name: 'Sign', hold_seconds: 30,
      shape: { kind: 'text', text: 'OPEN', moves: { kind: 'swing', pivot: 'top', amount: 60, period_seconds: 3 } },
      light: { effect: 'solid', color: '#ffcc00' },
      extra_shapes: [{ shape: { kind: 'star', moves: { kind: 'turn', amount: 20 } }, light: { effect: 'solid', color: '#ffffff' }, up: 30, share: 0.25 }],
    })
    const [sign, star] = scene.layers
    expect(sign!.joint).toMatchObject({ kind: 'swing', anchor: [0, 1, 0], axis: [0, 0, 1], period: 3 })
    expect(star!.joint).toMatchObject({ kind: 'turn', anchor: [0, 0, 0] })
    // 60° every 3 s is far beyond what drones can fly: calmed, keeping the beat.
    expect(sign!.joint!.amount).toBeLessThan(60)
    expect(sign!.joint!.period).toBe(3)
    const d = { ...doc, scenes: [scene] }
    expect(validate(d, compile(d)).issues.filter((i) => i.sceneId === scene.id).map((i) => i.title)).toEqual([])
  })
})
