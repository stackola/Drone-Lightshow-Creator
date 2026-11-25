// Turn model output into show data. Everything is clamped and validated, and
// formations go through the same safe-sizing path as manual edits — the model
// suggests, the engine decides what is physically safe.

import { safeSpacing } from '@/core/site'
import type { Effect, Layer, LayerJoint, LightCue, Scene, ShapeSpec, ShowDoc, Vec3 } from '@/core/types'
import type { IdleMotionInput, KeyframeInput, LightInput, PartMotionInput, SceneInput, ShapeInput, ShowPlan, SplitInput, StepInput, TransitionInput } from './schemas'
import { separateGroups, splitSceneDoc } from '@/core/splits'
import { sceneDroneCount } from '@/core/groups'
import type { HoldKey, HoldMotion, SpareRole, TransitionStyle } from '@/core/types'
import { applySpareRole, addSpareLayer, calmMotion, defaultMotion } from '@/core/idle'
import { defaultEffect } from '@/core/effects'
import { DEFAULT_CENTER, fitScene, fitToAirspace, newId, newLayer, newLedSign, newScene, newShape, rasterizeText, withSpareDrones } from '@/core/defaults'
import { SHAPE_BY_KIND } from '@/core/shapes'
import { comfortableSpacing, type Validation } from '@/core/validate'
import { compile } from '@/core/compile'
import { ceilTo } from '@/core/math'
import { alignScenesToBars } from '@/core/music'
import { arriveAt, composeScore, fitToSong, lightTheMusic, musicMoment } from '@/core/musicTools'
import { autoFix, settleParts } from '@/core/fixes'
import { hasMovingParts } from '@/core/joints'

const clamp = (v: number | undefined, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)

export function normalizeHex(v: string | undefined, d: string): string {
  if (typeof v !== 'string') return d
  const s = v.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
  return d
}

/** A darker version of a colour (for pulse rest states). */
function dim(hex: string, k = 0.18): string {
  const n = parseInt(hex.slice(1), 16)
  const c = (x: number) => Math.round(x * k).toString(16).padStart(2, '0')
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`
}

export function effectFromInput(l: LightInput, fallbackColor = '#38bdf8'): Effect {
  const color = normalizeHex(l.color, fallbackColor)
  const brightness = clamp(l.brightness, 0, 1, 1)
  const angle = clamp(l.angle, -360, 360, 0)
  switch (l.effect) {
    case 'solid': return { kind: 'solid', color, brightness }
    case 'gradient': return { kind: 'gradient', a: color, b: normalizeHex(l.color2, '#f472b6'), angle: clamp(l.angle, -360, 360, 90), brightness }
    case 'rainbow': return { kind: 'rainbow', angle, speed: clamp(l.speed, -5, 5, 0.15), scale: 1, brightness }
    case 'pulse': return { kind: 'pulse', a: color, b: normalizeHex(l.color2, dim(color)), period: clamp(l.period, 0.05, 60, 1), beatSync: l.beat_sync ?? true, brightness }
    case 'twinkle': return { kind: 'twinkle', a: color, b: normalizeHex(l.color2, '#ffffff'), rate: clamp(l.rate, 0, 20, 1.5), brightness }
    case 'chase': return { kind: 'chase', a: color, b: normalizeHex(l.color2, '#ffffff'), speed: clamp(l.speed, -5, 5, 0.4), width: clamp(l.width, 0.01, 1, 0.2), brightness }
    case 'wave': return { kind: 'wave', a: color, b: normalizeHex(l.color2, '#ffffff'), angle, speed: clamp(l.speed, -5, 5, 0.5), width: clamp(l.width, 0.02, 1, 0.3), brightness }
    case 'flash': return { kind: 'flash', color: normalizeHex(l.color, '#ffffff'), decay: clamp(l.decay, 0.02, 10, 0.4), beatSync: (l.beat_sync ?? false) || !!l.on_accents, every: Math.round(clamp(l.every, 1, 64, 1)), onAccents: !!l.on_accents, brightness }
    case 'react': return { kind: 'react', color, floor: clamp(l.floor, 0, 1, 0.25), brightness }
    case 'meter': return { kind: 'meter', a: normalizeHex(l.color, '#22c55e'), b: normalizeHex(l.color2, '#ff3b3b'), brightness }
    case 'strobe': return { kind: 'strobe', color: normalizeHex(l.color, '#ffffff'), rate: clamp(l.rate, 0.5, 25, 8), brightness }
    case 'off': return defaultEffect('off')
    case 'image': return { kind: 'image', brightness, ...(l.animate && l.animate !== 'none' ? { anim: l.animate, speed: clamp(l.speed, 0.05, 10, 1) } : {}) }
    case 'palette': {
      const cols = (l.colors ?? []).slice(0, 6).map((c) => normalizeHex(c, color))
      const colors = cols.length >= 2 ? cols : [color, normalizeHex(l.color2, '#f472b6')]
      return { kind: 'palette', colors, mode: l.palette_mode === 'radial' ? 'radial' : 'linear', angle: clamp(l.angle, -360, 360, 90), speed: clamp(l.speed, -5, 5, 0), brightness }
    }
    case 'write': return { kind: 'write', a: color, b: '#000000', pen: normalizeHex(l.color2, '#ffffff'), duration: clamp(l.duration, 0.5, 60, 4), brightness }
    case 'type': return { kind: 'type', a: color, b: '#000000', cursor: normalizeHex(l.color2, '#ffffff'), duration: clamp(l.duration, 0.5, 60, 3), brightness }
    case 'flip': return { kind: 'flip', a: color, b: normalizeHex(l.color2, '#10131c'), duration: clamp(l.duration, 0.5, 60, 3), rate: clamp(l.rate, 1, 30, 12), brightness }
    case 'matrix': return { kind: 'matrix', text: (l.text ?? 'HELLO').toUpperCase().slice(0, 120), a: normalizeHex(l.color, '#ffb020'), b: normalizeHex(l.color2, '#1c1406'), speed: clamp(l.speed, 0, 40, 6), font: l.font_dots === 5 ? 5 : 7, brightness }
  }
}

/** Shape spec at unit size (it is fitted to safe spacing afterwards). Custom shapes are resolved by the caller. */
export function shapeFromInput(s: ShapeInput): ShapeSpec {
  if (s.kind === 'custom' || s.kind === 'model3d') throw new Error('custom and 3D model shapes must be resolved before conversion')
  if (s.kind === 'led_sign') return { kind: 'grid', size: 1, aspect: Math.max(1, (s.columns ?? 21) / 7), scatter: 0, fill: 'filled' }
  if (s.kind === 'text') {
    const font = s.font ?? 'sans'
    const text = (s.text ?? '').trim().slice(0, 60) || 'HELLO'
    return { kind: 'text', size: 1, text, font, mask: rasterizeText(text, font) }
  }
  const spec = newShape(s.kind) as unknown as Record<string, unknown>
  const def = SHAPE_BY_KIND[s.kind]
  for (const p of def.params) {
    const v = (s as Record<string, unknown>)[p.key]
    if (typeof v === 'number' && Number.isFinite(v)) spec[p.key] = p.integer ? Math.round(clamp(v, p.min, p.max, v)) : clamp(v, p.min, p.max, v)
  }
  if (def.hasFill && s.fill) spec.fill = s.fill
  return spec as unknown as ShapeSpec
}

/** Already-generated custom drawings and 3D models, keyed by the shape input they were made for. */
export type CustomShapes = Map<unknown, ShapeSpec>

/** A shape from model input: built-in, or a custom drawing / 3D model generated beforehand (else a placeholder). */
function resolveShape(shapeIn: ShapeInput, custom: ShapeSpec | null | undefined): ShapeSpec {
  if (shapeIn.kind === 'custom' || shapeIn.kind === 'model3d') return withDrawingStyle(custom ?? newShape(shapeIn.kind === 'model3d' ? 'model' : 'sphere'), shapeIn)
  return shapeFromInput(shapeIn)
}

/** A drawing's style (lines / filled / adaptive), as the AI asked. */
export function withDrawingStyle(shape: ShapeSpec, input: ShapeInput): ShapeSpec {
  return shape.kind === 'image' && input.drawing_style ? { ...shape, style: input.drawing_style } : shape
}

/** A shape's own motion inside the formation. */
export function jointFromInput(m: PartMotionInput | undefined): LayerJoint | undefined {
  if (!m || !Number.isFinite(m.amount) || m.amount === 0) return undefined
  const anchors: Record<string, Vec3> = { centre: [0, 0, 0], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0] }
  const rot: Record<string, Vec3> = { facing: [0, 0, 1], upright: [0, 1, 0], across: [1, 0, 0] }
  const slide: Record<string, Vec3> = { facing: [0, 0, 1], upright: [0, 1, 0], across: [1, 0, 0] }
  const axis = (m.kind === 'slide' ? slide : rot)[m.axis ?? (m.kind === 'slide' ? 'upright' : 'facing')]!
  return {
    kind: m.kind,
    anchor: anchors[m.pivot ?? 'centre']!,
    axis: m.reverse ? (axis.map((v) => -v) as Vec3) : axis,
    amount: clamp(Math.abs(m.amount), 0, m.kind === 'swing' ? 90 : m.kind === 'turn' ? 120 : 50, 10),
    period: clamp(m.period_seconds, 1, 120, 8),
    phase: clamp(m.phase, -1, 1, 0),
  }
}

/** The light for a shape: custom drawings keep their own colours unless the model picked a colour. */
function lightFor(light: LightInput, shape: ShapeSpec, fallbackColor: string): Effect {
  const fromDrawing = (shape.kind === 'image' || shape.kind === 'model') && (light.effect === 'image' || (light.effect === 'solid' && !light.color))
  if (fromDrawing) return effectFromInput({ ...light, effect: 'image' }, fallbackColor)
  return effectFromInput(light.effect === 'image' ? { ...light, effect: 'solid' } : light, fallbackColor)
}

/**
 * Build a scene from model input. Custom drawings and 3D models come from
 * `custom` (this shape) or `customs` (any shape of the scene, by its input);
 * without one they fall back to a placeholder sphere.
 */
export function sceneFromInput(doc: ShowDoc, input: SceneInput | StepInput, opts: { custom?: ShapeSpec | null; customs?: CustomShapes; position?: Vec3 } = {}): Scene {
  const shapeIn = input.shape
  const fallbackColor = ['#38bdf8', '#f472b6', '#facc15', '#a78bfa', '#34d399', '#fb923c'][doc.scenes.length % 6]!
  const position: Vec3 = opts.position ?? [clamp(input.across, -2000, 2000, DEFAULT_CENTER[0]), clamp(input.altitude, 10, 1000, DEFAULT_CENTER[1]), DEFAULT_CENTER[2]]
  let scene: Scene
  if (shapeIn.kind === 'led_sign') {
    // A dot-matrix LED panel scrolling the text; the rest of the fleet parks dark behind it.
    const text = (shapeIn.text ?? input.light.text ?? input.name).slice(0, 120)
    scene = { ...newLedSign(doc, text, { color: input.light.color ? normalizeHex(input.light.color, '#ffb020') : undefined, speed: input.light.speed, position, font: input.light.font_dots === 5 ? 5 : 7, columns: shapeIn.columns }), name: input.name.slice(0, 60) || 'LED sign' }
  } else {
    const shape = resolveShape(shapeIn, opts.custom ?? opts.customs?.get(shapeIn))
    scene = newScene(doc, shape.kind, { name: input.name.slice(0, 60) || SHAPE_BY_KIND[shape.kind].label, shape, effect: lightFor(input.light, shape, fallbackColor), position })
    const joint = jointFromInput(shapeIn.moves)
    if (joint) scene = { ...scene, layers: scene.layers.map((l, k) => (k === 0 ? { ...l, joint } : l)) }
  }
  scene = {
    ...scene,
    hold: clamp(input.hold_seconds, 0, 600, 6),
    spin: clamp(input.spin, -90, 90, 0),
    rotation: [clamp(input.tilt, -90, 90, 0), clamp(input.turn, -180, 180, 0), 0],
    flight: { duration: null, dim: input.dim_flight ?? false, ...(input.transition && transitionFromInput(input.transition) ? { style: transitionFromInput(input.transition) } : {}) },
  }
  if (input.idle_motion) scene = { ...scene, motion: motionFromInput(input.idle_motion) }
  if (input.keyframes?.length) scene = { ...scene, keys: keysFromInput(input.keyframes, scene.hold) }
  if (shapeIn.kind !== 'led_sign' && input.spare_fraction && input.spare_fraction > 0.02) scene = withSpareDrones(scene, doc, clamp(input.spare_fraction, 0, 0.7, 0))
  const scale = clamp(shapeIn.scale, 1, 4, 1)
  if (scale > 1.001) {
    const [main, ...rest] = scene.layers
    scene = { ...scene, layers: [{ ...main!, shape: { ...main!.shape, size: ceilTo(main!.shape.size * scale, 0.1) } as ShapeSpec }, ...rest] }
  }
  // More shapes sharing the formation's drones (a name under a logo, a heart beside text).
  const extras = (input.extra_shapes ?? []).slice(0, 3)
  if (extras.length && shapeIn.kind !== 'led_sign') {
    const shares = extras.map((e) => clamp(e.share, 0.05, 0.8, 1 / (extras.length + 1)))
    const total = Math.min(0.9, shares.reduce((a, b) => a + b, 0))
    const k = total / shares.reduce((a, b) => a + b, 0)
    const [main, ...rest] = scene.layers
    const mainWeight = (main?.weight ?? 1)
    const unit = mainWeight / Math.max(0.1, 1 - total)
    const added: Layer[] = extras.map((e, j) => {
      const sh = resolveShape(e.shape, opts.customs?.get(e.shape))
      const joint = jointFromInput(e.shape.moves)
      return { ...newLayer(sh, lightFor(e.light, sh, fallbackColor)), weight: unit * shares[j]! * k, offset: [clamp(e.across, -500, 500, 0), clamp(e.up, -500, 500, 0), 0] as Vec3, ...(joint ? { joint } : {}) }
    })
    scene = { ...scene, layers: [main!, ...added, ...rest] }
  }
  // Rotation changes the extent, so re-check spacing between layers, then make it fit the airspace.
  scene = fitScene(scene, doc.droneCount, comfortableSpacing(safeSpacing(doc.limits)), 'grow')
  scene = fitToAirspace(scene, doc)
  if (input.spare_role && input.spare_role !== 'park') scene = withSpareRole(scene, doc, input.spare_role, input.spare_fraction)
  scene = calmMotion(scene, doc)
  // Moving parts: calmed to what the drones can fly, keeping their beat.
  return hasMovingParts(scene) ? settleParts(scene, doc, { prefer: 'calm' }) : scene
}

/**
 * Split a scene of `doc` into groups with the given formations. Each step is
 * sized for its group's drones and placed on the group's own side unless it
 * says where (`across`).
 */
export function applySplit(doc: ShowDoc, sceneId: string, split: SplitInput, customs?: CustomShapes): ShowDoc {
  const first = splitSceneDoc(doc, sceneId, split.mode, (sub, gi, spot) => {
    const g = split.groups[gi]
    return g?.steps.length ? stepFromInput(sub, g.steps[0]!, spot, customs) : null
  })
  const done = addRemainingSteps(first.doc, sceneId, split, customs)
  const placed = split.groups.some((g) => g.steps.some((st) => st.across !== undefined))
  return placed ? done : separateGroups(done, sceneId)
}

/** A group formation from model input, at `spot` unless it gives its own position. */
export function stepFromInput(sub: ShowDoc, input: StepInput, spot: Vec3, customs?: CustomShapes): Scene {
  const pos: Vec3 = [input.across ?? spot[0], input.altitude ?? spot[1], spot[2]]
  return sceneFromInput(sub, input, { position: pos, customs })
}

function addRemainingSteps(doc: ShowDoc, sceneId: string, split: SplitInput, customs?: CustomShapes): ShowDoc {
  const scene = doc.scenes.find((s) => s.id === sceneId)
  if (!scene?.groups) return doc
  const groups = scene.groups.map((g, gi) => {
    const more = split.groups[gi]?.steps.slice(1, 6) ?? []
    if (!more.length || !g.steps.length) return { ...g, name: split.groups[gi]?.name?.slice(0, 40) || g.name, delay: clamp(split.groups[gi]?.delay_seconds, 0, 120, 0) }
    const sub = { ...doc, droneCount: sceneDroneCount(doc, g.steps[0]!.id) }
    let prev = g.steps[0]!
    const steps = [prev]
    for (const st of more) { prev = stepFromInput(sub, st, prev.position, customs); steps.push(prev) }
    return { ...g, steps, name: split.groups[gi]?.name?.slice(0, 40) || g.name, delay: clamp(split.groups[gi]?.delay_seconds, 0, 120, 0) }
  })
  return { ...doc, scenes: doc.scenes.map((s) => (s.id === sceneId ? { ...s, groups } : s)) }
}

/** Keyframes from model input, clamped to the hold and to sane amounts. */
export function keysFromInput(list: KeyframeInput[], hold: number): HoldKey[] {
  return list.slice(0, 24).map((k) => ({
    t: clamp(k.at_seconds, 0, Math.max(0, hold), 0),
    move: [clamp(k.across, -500, 500, 0), clamp(k.up, -300, 300, 0), clamp(k.toward, -500, 500, 0)] as Vec3,
    rotate: [clamp(k.tilt, -360, 360, 0), clamp(k.turn, -1080, 1080, 0), clamp(k.roll, -360, 360, 0)] as Vec3,
    scale: clamp(k.scale, 0.2, 5, 1),
    ...(k.flow_through ? { through: true } : {}),
  })).sort((a, b) => a.t - b.t)
}

/** Give the scene's spare drones a role, creating a spare layer (25% of drones) if it has none. */
export function withSpareRole(scene: Scene, doc: ShowDoc, role: SpareRole, fraction?: number): Scene {
  const spare = [...scene.layers].reverse().find((l) => l.role || l.effect.kind === 'off')
  if (spare) return applySpareRole(scene, doc, spare.id, role)
  return addSpareLayer(scene, doc, role, clamp(fraction, 0.05, 0.6, 0.25))
}

export function transitionFromInput(t: TransitionInput): TransitionStyle | undefined {
  if (t.style === 'direct') return undefined
  const amount = clamp(t.amount, 0.1, 1, 0.6)
  switch (t.style) {
    case 'cascade': return { kind: 'cascade', amount, order: t.order ?? 'left' }
    case 'swirl': return { kind: 'swirl', amount, turns: Math.round(clamp(t.turns, -3, 3, 0.5) * 4) / 4 || 0.25 }
    case 'burst': return { kind: 'burst', amount }
    case 'ant': return { kind: 'ant', amount, lanes: 0 }
    case 'rain': return { kind: 'rain', amount }
  }
}

export function motionFromInput(m: IdleMotionInput): HoldMotion | undefined {
  if (m.kind === 'none') return undefined
  const d = defaultMotion(m.kind)
  const amount =
    m.kind === 'breathe' ? clamp(m.amount, 0, 30, d.amount * 100) / 100
      : m.kind === 'bob' ? clamp(m.amount, 0, 10, d.amount)
        : clamp(m.amount, 0, 45, d.amount)
  return { kind: m.kind, amount, period: clamp(m.period_seconds, 1, 60, d.period) }
}

export function cueFromInput(start: number, light: LightInput, t: { duration_seconds: number; blend: LightCue['blend']; fade_in?: number; fade_out?: number }): LightCue {
  const duration = clamp(t.duration_seconds, 0.1, 600, 2)
  return {
    id: newId('cue'),
    start: Math.max(0, Math.round(start * 100) / 100),
    duration,
    fadeIn: clamp(t.fade_in, 0, duration, 0),
    fadeOut: clamp(t.fade_out, 0, duration, 0),
    blend: t.blend,
    effect: effectFromInput(light, '#ffffff'),
  }
}

export interface BuiltShow {
  doc: ShowDoc
  validation: Validation
  alignedToMusic: number
  fixesApplied: number
  /** An original score was composed to the show. */
  composed: boolean
}

/**
 * Turn a show plan into a document: build each scene safely, land arrivals on
 * the music's bar lines (if there is music), anchor cues to arrivals, then
 * apply automatic safety fixes.
 */
export function buildShowFromPlan(plan: ShowPlan, base: ShowDoc, custom: CustomShapes = new Map(), opts: { alignToMusic?: boolean; composeScore?: boolean } = {}): BuiltShow {
  let doc: ShowDoc = { ...base, name: plan.title.slice(0, 120) || base.name, scenes: [], cues: [] }
  plan.scenes.slice(0, 30).forEach((s, i) => {
    const scene = sceneFromInput(doc, s, { custom: custom.get(i), customs: custom })
    doc = { ...doc, scenes: [...doc.scenes, scene] }
    if (s.split?.groups.length) doc = applySplit(doc, scene.id, s.split, custom)
  })
  if (plan.return_flight) {
    const style = plan.return_flight.transition ? transitionFromInput(plan.return_flight.transition) : undefined
    doc = { ...doc, site: { ...doc.site, returnFlight: { ...doc.site.returnFlight, dim: plan.return_flight.dim ?? doc.site.returnFlight.dim, ...(style ? { style } : {}) } } }
  }
  const composing = !!opts.composeScore && doc.scenes.length > 0
  const music = composing || (opts.alignToMusic !== false && !!doc.audio)
  let aligned: { aligned: number }
  if (composing) {
    // No song: compose one to the show, with the drops on the chosen hero formations.
    const sc = plan.original_score
    const n = doc.scenes.length
    const idx = (a?: number[]) => a?.map((x) => Math.round(x)).filter((x) => x >= 0 && x < n)
    const heroes = idx(sc?.drops_at)
    doc = composeScore({ ...doc, audio: null }, { bpm: sc?.bpm, heroes: heroes?.length ? heroes : undefined, breaks: idx(sc?.breaks_at) }).doc
    aligned = { aligned: n }
  } else {
    // With music: land every arrival on a bar, put the chosen formations on their sections
    // (earliest first), then fit the rest of the show so the finale ends with the song.
    const a = opts.alignToMusic === false ? { doc, aligned: 0 } : alignScenesToBars(doc)
    doc = a.doc
    aligned = a
  }
  if (music && !composing) {
    const targets = plan.scenes.slice(0, 30).map((s, i) => ({ i, sec: s.arrive_at_section })).filter((x) => x.sec !== undefined)
    let lastLanded = -1
    for (const { i, sec } of targets) {
      const t = musicMoment(doc, { section: Math.round(sec!) - 1 })
      if (t !== null && i < doc.scenes.length && i > lastLanded) { doc = arriveAt(doc, i, t).doc; lastLanded = i }
    }
    if (plan.fit_to_song !== false) doc = (lastLanded >= 0 ? fitToSong(doc, { from: lastLanded }) : fitToSong(doc)).doc
  }
  const times = compile(doc).sceneTimes
  const cues = plan.cues.slice(0, 80).flatMap((q) => {
    const st = times[Math.round(q.scene_index)]
    if (!st) return []
    return [cueFromInput(st.holdStart + q.offset_seconds, q.light, q)]
  })
  doc = { ...doc, cues }
  if (music && plan.music_lighting !== 'none') doc = lightTheMusic(doc, plan.music_lighting === 'subtle' ? 'subtle' : 'bold').doc
  const fixed = autoFix(doc)
  return { doc: fixed.doc, validation: fixed.validation, alignedToMusic: aligned.aligned, fixesApplied: fixed.applied, composed: composing }
}
