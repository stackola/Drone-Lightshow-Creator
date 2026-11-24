// Turn model output into show data. Everything is clamped and validated, and
// formations go through the same safe-sizing path as manual edits — the model
// suggests, the engine decides what is physically safe.

import type { Effect, LightCue, Scene, ShapeSpec, ShowDoc, Vec3 } from '@/core/types'
import type { IdleMotionInput, LightInput, SceneInput, ShapeInput, ShowPlan } from './schemas'
import type { HoldMotion, SpareRole } from '@/core/types'
import { applySpareRole, addSpareLayer, calmMotion, defaultMotion } from '@/core/idle'
import { defaultEffect } from '@/core/effects'
import { DEFAULT_CENTER, fitScene, fitToAirspace, newId, newScene, newShape, rasterizeText, withSpareDrones } from '@/core/defaults'
import { SHAPE_BY_KIND } from '@/core/shapes'
import { comfortableSpacing, type Validation } from '@/core/validate'
import { compile } from '@/core/compile'
import { ceilTo } from '@/core/math'
import { alignScenesToBars } from '@/core/music'
import { autoFix } from '@/core/fixes'

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
    case 'flash': return { kind: 'flash', color: normalizeHex(l.color, '#ffffff'), decay: clamp(l.decay, 0.02, 10, 0.4), beatSync: l.beat_sync ?? false, every: Math.round(clamp(l.every, 1, 64, 1)), brightness }
    case 'strobe': return { kind: 'strobe', color: normalizeHex(l.color, '#ffffff'), rate: clamp(l.rate, 0.5, 25, 8), brightness }
    case 'off': return defaultEffect('off')
    case 'image': return { kind: 'image', brightness }
    case 'write': return { kind: 'write', a: color, b: '#000000', pen: normalizeHex(l.color2, '#ffffff'), duration: clamp(l.duration, 0.5, 60, 4), brightness }
    case 'type': return { kind: 'type', a: color, b: '#000000', cursor: normalizeHex(l.color2, '#ffffff'), duration: clamp(l.duration, 0.5, 60, 3), brightness }
    case 'flip': return { kind: 'flip', a: color, b: normalizeHex(l.color2, '#10131c'), duration: clamp(l.duration, 0.5, 60, 3), rate: clamp(l.rate, 1, 30, 12), brightness }
    case 'matrix': return { kind: 'matrix', text: (l.text ?? 'HELLO').toUpperCase().slice(0, 120), a: normalizeHex(l.color, '#ffb020'), b: normalizeHex(l.color2, '#1c1406'), speed: clamp(l.speed, 0, 40, 6), brightness }
  }
}

/** Shape spec at unit size (it is fitted to safe spacing afterwards). Custom shapes are resolved by the caller. */
export function shapeFromInput(s: ShapeInput): ShapeSpec {
  if (s.kind === 'custom' || s.kind === 'model3d') throw new Error('custom and 3D model shapes must be resolved before conversion')
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

/**
 * Build a scene from model input. `custom` supplies already-generated shapes
 * for kind "custom" (from the SVG generator); otherwise it falls back to a sphere.
 */
export function sceneFromInput(doc: ShowDoc, input: SceneInput, opts: { custom?: ShapeSpec | null; position?: Vec3 } = {}): Scene {
  const shapeIn = input.shape
  let shape: ShapeSpec
  if (shapeIn.kind === 'custom' || shapeIn.kind === 'model3d') shape = opts.custom ?? newShape(shapeIn.kind === 'model3d' ? 'model' : 'sphere')
  else shape = shapeFromInput(shapeIn)
  const fallbackColor = ['#38bdf8', '#f472b6', '#facc15', '#a78bfa', '#34d399', '#fb923c'][doc.scenes.length % 6]!
  const wantsImage = input.light.effect === 'image' && (shape.kind === 'image' || shape.kind === 'model')
  const effect = effectFromInput(wantsImage || input.light.effect !== 'image' ? input.light : { ...input.light, effect: 'solid' }, fallbackColor)
  const position: Vec3 = opts.position ?? [DEFAULT_CENTER[0], clamp(input.altitude, 10, 1000, DEFAULT_CENTER[1]), DEFAULT_CENTER[2]]
  let scene = newScene(doc, shape.kind, { name: input.name.slice(0, 60) || SHAPE_BY_KIND[shape.kind].label, shape, effect, position })
  scene = {
    ...scene,
    hold: clamp(input.hold_seconds, 0, 600, 6),
    spin: clamp(input.spin, -90, 90, 0),
    rotation: [clamp(input.tilt, -90, 90, 0), clamp(input.turn, -180, 180, 0), 0],
    flight: { duration: null, dim: input.dim_flight ?? false },
  }
  if (input.idle_motion) scene = { ...scene, motion: motionFromInput(input.idle_motion) }
  if (input.spare_fraction && input.spare_fraction > 0.02) scene = withSpareDrones(scene, doc, clamp(input.spare_fraction, 0, 0.7, 0))
  const scale = clamp(shapeIn.scale, 1, 4, 1)
  if (scale > 1.001) {
    const [main, ...rest] = scene.layers
    scene = { ...scene, layers: [{ ...main!, shape: { ...main!.shape, size: ceilTo(main!.shape.size * scale, 0.1) } as ShapeSpec }, ...rest] }
  }
  // Rotation changes the extent, so re-check spacing between layers, then make it fit the airspace.
  scene = fitScene(scene, doc.droneCount, comfortableSpacing(doc.limits.minSpacing), 'grow')
  scene = fitToAirspace(scene, doc)
  if (input.spare_role && input.spare_role !== 'park') scene = withSpareRole(scene, doc, input.spare_role, input.spare_fraction)
  return calmMotion(scene, doc)
}

/** Give the scene's spare drones a role, creating a spare layer (25% of drones) if it has none. */
export function withSpareRole(scene: Scene, doc: ShowDoc, role: SpareRole, fraction?: number): Scene {
  const spare = [...scene.layers].reverse().find((l) => l.role || l.effect.kind === 'off')
  if (spare) return applySpareRole(scene, doc, spare.id, role)
  return addSpareLayer(scene, doc, role, clamp(fraction, 0.05, 0.6, 0.25))
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
}

/**
 * Turn a show plan into a document: build each scene safely, land arrivals on
 * the music's bar lines (if there is music), anchor cues to arrivals, then
 * apply automatic safety fixes.
 */
export function buildShowFromPlan(plan: ShowPlan, base: ShowDoc, custom: Map<number, ShapeSpec> = new Map(), opts: { alignToMusic?: boolean } = {}): BuiltShow {
  let doc: ShowDoc = { ...base, name: plan.title.slice(0, 120) || base.name, scenes: [], cues: [] }
  plan.scenes.slice(0, 30).forEach((s, i) => {
    doc = { ...doc, scenes: [...doc.scenes, sceneFromInput(doc, s, { custom: custom.get(i) })] }
  })
  const aligned = opts.alignToMusic === false ? { doc, aligned: 0 } : alignScenesToBars(doc)
  doc = aligned.doc
  const times = compile(doc).sceneTimes
  const cues = plan.cues.slice(0, 80).flatMap((q) => {
    const st = times[Math.round(q.scene_index)]
    if (!st) return []
    return [cueFromInput(st.holdStart + q.offset_seconds, q.light, q)]
  })
  doc = { ...doc, cues }
  const fixed = autoFix(doc)
  return { doc: fixed.doc, validation: fixed.validation, alignedToMusic: aligned.aligned, fixesApplied: fixed.applied }
}
