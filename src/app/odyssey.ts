// "Odyssey" — the flagship demo: a 15-minute, 400-drone show in four acts that
// uses every part of the editor (3D models, text reveals, an LED sign,
// spectacle transitions, idle motion, spare-drone roles and light cues).
// Built only through the public model API, and required by the tests to pass
// every safety check.

import type { Effect, HoldMotion, LightCue, ModelPart, Scene, ShapeSpec, ShowDoc, TextFont, TransitionStyle } from '@/core/types'
import { fitToAirspace, fittedSize, newId, newLayer, newLedSign, newScene, newShape, newShow, rasterizeText } from '@/core/defaults'
import { comfortableSpacing } from '@/core/validate'
import { applySpareRole, applySpareRoles, calmMotion, fitRolesToAirspace } from '@/core/idle'
import { sceneGeometry, type Compiled } from '@/core/compile'
import { maxSafeSpin, validate } from '@/core/validate'
import { autoFix } from '@/core/fixes'
import { alignScenesToBars } from '@/core/music'
import { lightTheMusic } from '@/core/musicTools'
import { scorePlan, soundtrackMeta, type SoundtrackPlan } from '@/core/soundtrack'
import type { SectionLabel } from '@/core/sections'

export const ODYSSEY_DRONES = 400

// --- 3D models (y up, z toward the audience) -----------------------------------------

const TREE: ModelPart[] = [
  { type: 'cylinder', from: [0, -0.5, 0], to: [0, -0.28, 0], radius: 0.07, color: '#8a5a2b' },
  { type: 'cone', from: [0, -0.32, 0], to: [0, 0.02, 0], radius: 0.42, radiusTop: 0.12, color: '#1f9e4a' },
  { type: 'cone', from: [0, -0.06, 0], to: [0, 0.26, 0], radius: 0.33, radiusTop: 0.08, color: '#29b85a' },
  { type: 'cone', from: [0, 0.18, 0], to: [0, 0.46, 0], radius: 0.23, radiusTop: 0, color: '#3fd16f' },
  { type: 'sphere', center: [0, 0.5, 0], radius: 0.06, color: '#ffd23f' },
]

const BALLOON: ModelPart[] = [
  { type: 'ellipsoid', center: [0, 0.22, 0], radii: [0.34, 0.38, 0.34], rotation: [0, 0, 0], color: '#ff4d5e' },
  { type: 'torus', center: [0, 0.2, 0], radius: 0.335, tube: 0.045, rotation: [0, 0, 0], color: '#ffd23f' },
  { type: 'cone', from: [0, -0.12, 0], to: [0, -0.24, 0], radius: 0.14, radiusTop: 0.07, color: '#ff8a3d' },
  { type: 'cylinder', from: [-0.08, -0.24, 0], to: [-0.06, -0.36, 0], radius: 0.012, color: '#d9c7a3' },
  { type: 'cylinder', from: [0.08, -0.24, 0], to: [0.06, -0.36, 0], radius: 0.012, color: '#d9c7a3' },
  { type: 'box', center: [0, -0.42, 0], size: [0.16, 0.11, 0.16], rotation: [0, 0, 0], color: '#b5722e' },
]

const SATURN: ModelPart[] = [
  { type: 'sphere', center: [0, 0, 0], radius: 0.3, color: '#e9c27a' },
  { type: 'torus', center: [0, 0, 0], radius: 0.52, tube: 0.06, rotation: [18, 0, 12], color: '#c08b4f' },
]

const ROCKET: ModelPart[] = [
  { type: 'cylinder', from: [0, -0.5, 0], to: [0, 0.6, 0], radius: 0.22, color: '#e8eef8' },
  { type: 'cone', from: [0, 0.6, 0], to: [0, 1.15, 0], radius: 0.22, radiusTop: 0, color: '#ff4d4d' },
  { type: 'box', center: [0.3, -0.35, 0], size: [0.28, 0.4, 0.06], rotation: [0, 0, -20], color: '#ff4d4d' },
  { type: 'box', center: [-0.3, -0.35, 0], size: [0.28, 0.4, 0.06], rotation: [0, 0, 20], color: '#ff4d4d' },
  { type: 'sphere', center: [0, 0.25, 0.2], radius: 0.09, color: '#38bdf8' },
  { type: 'cone', from: [0, -0.5, 0], to: [0, -0.95, 0], radius: 0.18, radiusTop: 0.02, color: '#ffb02e' },
]

// --- Helpers ------------------------------------------------------------------------------

type Opts = {
  /** Enlarge beyond the smallest safe size (drones further apart, a bigger picture). */
  scale?: number
  hold?: number
  spin?: number
  rotation?: [number, number, number]
  altitude?: number
  motion?: HoldMotion
  transition?: TransitionStyle
  dim?: boolean
}

function apply(doc: ShowDoc, sc: Scene, o: Opts): Scene {
  const k = o.scale ?? 1
  let s: Scene = {
    ...sc,
    layers: k === 1 ? sc.layers : sc.layers.map((l) => ({ ...l, shape: { ...l.shape, size: Math.round(l.shape.size * k * 10) / 10 } as ShapeSpec, offset: l.offset.map((v) => v * k) as [number, number, number] })),
    hold: o.hold ?? sc.hold,
    spin: o.spin ?? 0,
    rotation: o.rotation ?? sc.rotation,
    position: o.altitude !== undefined ? [sc.position[0], o.altitude, sc.position[2]] : sc.position,
    flight: { duration: null, dim: o.dim ?? false, ...(o.transition ? { style: o.transition } : {}) },
    ...(o.motion ? { motion: o.motion } : {}),
  }
  s = fitToAirspace(s, doc)
  return calmMotion(safeSpin(doc, s), doc)
}

/** Keep a scene's spin within the limits for its actual size (80% of the fastest safe rate). */
function safeSpin(doc: ShowDoc, sc: Scene): Scene {
  if (!sc.spin) return sc
  const pts = sceneGeometry(sc, doc.droneCount).points
  let r = 0
  for (let i = 0; i < pts.length; i += 3) r = Math.max(r, Math.hypot(pts[i]! - sc.position[0], pts[i + 2]! - sc.position[2]))
  const safe = maxSafeSpin(sc.spin, sc.hold, r, doc.limits, sc.motion, Math.abs(sc.spin))
  return Math.abs(safe) * 0.8 < Math.abs(sc.spin) ? { ...sc, spin: Math.trunc(safe * 0.8 * 10) / 10 } : sc
}

function shape(doc: ShowDoc, spec: ShapeSpec, name: string, effect: Effect, o: Opts = {}): Scene {
  return apply(doc, newScene(doc, spec.kind, { name, shape: spec, effect }), o)
}

function kind(doc: ShowDoc, k: Parameters<typeof newShape>[0], patch: Record<string, unknown>, name: string, effect: Effect, o: Opts = {}): Scene {
  return shape(doc, { ...newShape(k), ...patch } as ShapeSpec, name, effect, o)
}

function model(doc: ShowDoc, parts: ModelPart[], name: string, o: Opts = {}): Scene {
  return shape(doc, { kind: 'model', size: 1, name, parts }, name, { kind: 'image', brightness: 1 }, o)
}

type Role = 'halo' | 'frame' | 'base' | 'starfield'

/**
 * Text with supporting spare drones: `count` drones write the words (sized
 * for safe spacing), the rest take the given roles in proportion. Built
 * directly, so no drones end up parked dark because the words would be too wide.
 */
function words(doc: ShowDoc, text: string, font: TextFont, effect: Effect, o: Opts, count: number, spares: [Role, number][]): Scene {
  const spec: ShapeSpec = { kind: 'text', size: 1, text, font, mask: rasterizeText(text, font) }
  return withRoles(doc, spec, text.replace(/\n/g, ' '), effect, o, count, spares)
}

/** A main shape of `count` drones plus spare layers sharing the rest of the fleet by weight. */
function withRoles(doc: ShowDoc, spec: ShapeSpec, name: string, effect: Effect, o: Opts, count: number, spares: [Role, number][]): Scene {
  const n = doc.droneCount
  const target = comfortableSpacing(doc.limits.minSpacing)
  const main = { ...newLayer({ ...spec, size: fittedSize(spec, count, target) } as ShapeSpec, effect), weight: count }
  const total = spares.reduce((a, [, w]) => a + w, 0)
  const extra = spares.map(([role, w]) => ({ ...newLayer(newShape('grid'), effect), role, weight: ((n - count) * w) / total }))
  const sc: Scene = { ...newScene(doc, 'circle', { name }), layers: [main, ...extra] }
  return apply(doc, fitRolesToAirspace(applySpareRoles(sc, doc, extra.map((l) => [l.id, l.role])), doc), o)
}

/** Turn the scene's parked drones into a supporting role. */
function applyRole(doc: ShowDoc, sc: Scene, role: Role): Scene {
  const parked = sc.layers.find((l) => l.role === 'park')
  return parked ? applySpareRole(sc, doc, parked.id, role) : sc
}

const flash = (decay = 0.45): Effect => ({ kind: 'flash', color: '#ffffff', decay, beatSync: false, every: 1, brightness: 1 })

// --- The show -----------------------------------------------------------------------------

/** Scenes of Odyssey, in order (cues are placed separately, once the timing is known). */
export function odysseyScenes(doc: ShowDoc): Scene[] {
  const s: Scene[] = []
  // Act I — Dawn
  s.push(kind(doc, 'circle', {}, 'Sunrise', { kind: 'gradient', a: '#ff4b1f', b: '#ffd36e', angle: 90, brightness: 1 },
    { hold: 14, motion: { kind: 'breathe', amount: 0.05, period: 7 }, transition: { kind: 'cascade', amount: 0.3, order: 'top' } }))
  s.push(words(doc, 'WELCOME', 'sans', { kind: 'write', a: '#f4f7ff', b: '#000000', pen: '#ffc44d', duration: 5, brightness: 1 }, { hold: 12 }, 170, [['base', 1], ['starfield', 2]]))
  // Act II — Earth
  s.push(model(doc, TREE, 'Tree of life', { hold: 14, motion: { kind: 'sway', amount: 4, period: 9 }, transition: { kind: 'cascade', amount: 0.8, order: 'top' } }))
  s.push(withRoles(doc, { ...newShape('star'), points: 8, inner: 0.55 } as ShapeSpec, 'Bloom', { kind: 'gradient', a: '#ff5fa2', b: '#ffe066', angle: 90, brightness: 1 },
    { hold: 12, spin: 8, dim: true }, 120, [['starfield', 1]]))
  s.push(kind(doc, 'heart', {}, 'Heart', { kind: 'pulse', a: '#ff2d55', b: '#5c0a1d', period: 0.9, beatSync: false, brightness: 1 },
    { hold: 10, motion: { kind: 'breathe', amount: 0.04, period: 1.8 } }))
  s.push(kind(doc, 'sphere', {}, 'Earth', { kind: 'gradient', a: '#1f6feb', b: '#2bd67b', angle: 90, brightness: 1 },
    { hold: 14, spin: 14, scale: 1.45, transition: { kind: 'swirl', amount: 0.6, turns: 0.5 } }))
  // The LED sign: a 36-column panel; the rest of the fleet is a glowing band beneath it.
  const sign = newLedSign(doc, 'TOGETHER WE SHINE', { color: '#ffb020', speed: 8, columns: 36 })
  const signScene = apply(doc, { ...sign, name: 'Together (LED)' }, { hold: sign.hold, transition: { kind: 'ant', amount: 0.6 } })
  s.push(applyRole(doc, signScene, 'base'))
  // Act III — Sky
  s.push(model(doc, BALLOON, 'Balloon', { hold: 14, motion: { kind: 'bob', amount: 2, period: 8 }, dim: true }))
  s.push(withRoles(doc, { kind: 'model', size: 1, name: 'Rocket', parts: ROCKET }, 'Rocket', { kind: 'image', brightness: 1 }, { hold: 10, spin: 10 }, 200, [['starfield', 1]]))
  s.push(model(doc, SATURN, 'Saturn', { hold: 12, spin: 12, transition: { kind: 'swirl', amount: 0.6, turns: -0.5 } }))
  s.push(withRoles(doc, { ...newShape('spiral'), turns: 3 } as ShapeSpec, 'Galaxy', { kind: 'chase', a: '#3b1d7a', b: '#e9d7ff', speed: 0.25, width: 0.35, brightness: 1 },
    { hold: 12, spin: 10 }, 140, [['halo', 1], ['starfield', 2]]))
  s.push(kind(doc, 'helix', { turns: 3, radius: 0.3 }, 'Helix', { kind: 'chase', a: '#0e2a4a', b: '#5ff2ff', speed: 0.3, width: 0.3, brightness: 1 },
    { hold: 12, spin: 14, transition: { kind: 'cascade', amount: 0.6, order: 'bottom' } }))
  // Act IV — Finale
  s.push(words(doc, 'THANK\nYOU', 'sans', { kind: 'flip', a: '#ffffff', b: '#10131c', duration: 3.5, rate: 12, brightness: 1 }, { hold: 12 }, 130, [['frame', 1], ['starfield', 3]]))
  s.push(kind(doc, 'torus', { thickness: 0.35 }, 'Ring of fire', { kind: 'gradient', a: '#ff3d00', b: '#ffd000', angle: 0, brightness: 1 },
    { hold: 14, spin: 16, rotation: [70, 0, 0], dim: true }))
  s.push(withRoles(doc, { ...newShape('star'), points: 5, inner: 0.42 } as ShapeSpec, 'Star', { kind: 'twinkle', a: '#b27511', b: '#fff6d6', rate: 2.5, brightness: 1 },
    { hold: 10, spin: 6, transition: { kind: 'cascade', amount: 0.5, order: 'center' } }, 130, [['base', 1]]))
  s.push(kind(doc, 'sphere', {}, 'Firework', { kind: 'twinkle', a: '#ff3d7f', b: '#ffffff', rate: 3, brightness: 1 },
    { hold: 16, spin: -18, scale: 1.6, motion: { kind: 'breathe', amount: 0.06, period: 3 }, transition: { kind: 'burst', amount: 0.22 } }))
  s.push(words(doc, 'GOOD\nNIGHT', 'serif', { kind: 'write', a: '#dfe8ff', b: '#000000', pen: '#ffd36e', duration: 5, brightness: 1 }, { hold: 16 }, 120, [['base', 1], ['starfield', 2.5]]))
  return s
}

/** Light cues, placed against the compiled timing (scenes are found by name). */
export function odysseyCues(doc: ShowDoc, c: Compiled): LightCue[] {
  const idx = (name: string) => {
    const i = doc.scenes.findIndex((sc) => sc.name === name)
    if (i < 0) throw new Error(`Odyssey: no scene named ${name}`)
    return i
  }
  const at = (name: string, offset: number) => Math.max(0, Math.round((c.sceneTimes[idx(name)]!.holdStart + offset) * 10) / 10)
  const end = (name: string, offset: number) => Math.max(0, Math.round((c.sceneTimes[idx(name)]!.holdEnd + offset) * 10) / 10)
  const cue = (start: number, rest: Omit<LightCue, 'id' | 'start'>): LightCue => ({ id: newId('cue'), start, ...rest })
  return [
    // Dawn: a warm shimmer as the sun breathes; a flash as WELCOME finishes writing.
    cue(at('Sunrise', 5), { duration: 6, fadeIn: 1.5, fadeOut: 1.5, blend: 'add', effect: { kind: 'twinkle', a: '#000000', b: '#ffe7a8', rate: 1.5, brightness: 0.8 } }),
    cue(at('WELCOME', 5.2), { duration: 1.2, fadeIn: 0, fadeOut: 0, blend: 'add', effect: flash() }),
    // Earth: the heart beats with white flashes; a rainbow sweep across the turning Earth.
    cue(at('Heart', 0), { duration: 1.2, fadeIn: 0, fadeOut: 0, blend: 'add', effect: flash(0.4) }),
    cue(at('Heart', 3), { duration: 1.2, fadeIn: 0, fadeOut: 0, blend: 'add', effect: flash(0.3) }),
    cue(at('Earth', 4), { duration: 6, fadeIn: 1, fadeOut: 1, blend: 'replace', effect: { kind: 'rainbow', angle: 0, speed: 0.25, scale: 1, brightness: 1 } }),
    // Sky: the rocket "launches" with a strobe at the end of its hold; the galaxy sparkles.
    cue(end('Rocket', -2.5), { duration: 2.5, fadeIn: 0, fadeOut: 0.5, blend: 'replace', effect: { kind: 'strobe', color: '#ffffff', rate: 10, brightness: 1 } }),
    cue(at('Galaxy', 6), { duration: 6, fadeIn: 1, fadeOut: 1, blend: 'add', effect: { kind: 'twinkle', a: '#000000', b: '#ffffff', rate: 2, brightness: 0.7 } }),
    // Finale: a blackout breath before the star, then flashes and a gold shimmer on the firework.
    cue(end('Ring of fire', -1.2), { duration: 1.2, fadeIn: 0.6, fadeOut: 0, blend: 'multiply', effect: { kind: 'solid', color: '#000000', brightness: 1 } }),
    cue(at('Star', 0), { duration: 1.5, fadeIn: 0, fadeOut: 0, blend: 'add', effect: flash(0.6) }),
    ...[0, 2, 4, 6, 8].map((k) => cue(at('Firework', k), { duration: 1.4, fadeIn: 0, fadeOut: 0, blend: 'add', effect: flash(0.35) })),
    cue(at('Firework', 9), { duration: 6, fadeIn: 1, fadeOut: 1.5, blend: 'replace', effect: { kind: 'twinkle', a: '#b27511', b: '#fff6d6', rate: 3, brightness: 1 } }),
  ]
}

const BPM = 120
const BAR = (60 / BPM) * 4

/**
 * The score's structure, composed to the show (like a film score): a quiet
 * intro for the takeoff, a build into a drop wherever a hero formation
 * arrives, a marching groove under the ant walk, a break for THANK YOU and an
 * outro under GOOD NIGHT and the landing. Every boundary is on a bar line.
 */
export function odysseyScore(doc: ShowDoc, c: Compiled): SoundtrackPlan {
  const at = (name: string) => c.sceneTimes[doc.scenes.findIndex((s) => s.name === name)]!
  const end = Math.ceil((c.duration + BAR) / BAR) * BAR
  const marks: [SectionLabel, number][] = [['intro', 0], ['verse', at('Sunrise').holdStart]]
  const dropWithBuild = (name: string) => {
    const t = at(name).holdStart
    marks.push(['build', t - 8 * BAR], ['drop', t])
  }
  dropWithBuild('Tree of life')
  marks.push(['verse', at('Heart').holdStart])
  dropWithBuild('Earth')
  marks.push(['verse', at('Together (LED)').flightStart], ['drop', at('Together (LED)').holdStart])
  marks.push(['verse', at('Balloon').holdStart])
  dropWithBuild('Saturn')
  marks.push(['break', at('THANK YOU').holdStart])
  dropWithBuild('Ring of fire')
  marks.push(['outro', at('GOOD NIGHT').holdStart])
  return scorePlan(marks, BPM, end, 2027)
}

/**
 * Build the whole show. `compile` is passed in so the caller decides where
 * (main thread or worker). Text is rasterised with whatever fonts the
 * environment has, so the result is checked and, if a size turned out
 * different, repaired with the same automatic fixes the editor offers.
 */
export function buildOdyssey(compile: (doc: ShowDoc) => Compiled): ShowDoc {
  let doc = newShow(ODYSSEY_DRONES, 'Odyssey')
  doc.limits.maxFlightTime = 17 * 60
  // 400 drones read best from further back than the default.
  doc.site.audienceDistance = 260
  doc.scenes.push(...odysseyScenes(doc))
  // The finale rains down: drones drip to a low carpet, then settle onto the pads.
  doc.site.returnFlight = { duration: null, dim: false, style: { kind: 'rain', amount: 0.3 } }
  if (validate(doc, compile(doc)).issues.length) doc = autoFix(doc).doc
  // Land every arrival on the score's bar grid, then compose the score to the show's timing.
  doc.audio = soundtrackMeta({ bpm: BPM, duration: 25 * 60, sections: [{ label: 'verse', start: 0, end: 25 * 60, energy: 0.5 }], seed: 2027 })
  doc = alignScenesToBars(doc).doc
  doc.audio = soundtrackMeta(odysseyScore(doc, compile(doc)), 'Odyssey — original score')
  // Hand-placed signature moments, plus lighting that follows the score.
  doc.cues = odysseyCues(doc, compile(doc))
  doc = lightTheMusic(doc, 'subtle').doc
  return doc
}
