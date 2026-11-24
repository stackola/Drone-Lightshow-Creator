// Idle drones: what drones do when a formation doesn't need all of them, and
// how a held formation can stay alive without breaking spacing.
//
// Spare drones get a role — parked dark, a starfield behind the formation, a
// halo, a frame, or a base line — built in the scene's own coordinates so
// they turn and spin with it. Hold motions (breathe, bob, sway) never bring
// drones closer than the base formation; see motion.ts.

import type { Effect, HoldMotion, Layer, Scene, ShapeSpec, ShowDoc, SpareRole, Vec3 } from './types'
import { generateShape } from './shapes'
import { allocate, sceneGeometry } from './compile'
import { DEG, isIdentityRotation, rotationMatrix, transformPoints } from './math'
import { extremeRels, maxSafeMotionAmount } from './validate'
import { defaultEffect } from './effects'
import { comfortableSpacing } from './separation'
import { fitScene, fittedSize, newId, newShape, placeInAirspace } from './defaults'

export interface SpareRoleDef {
  role: SpareRole
  label: string
  hint: string
}

export const SPARE_ROLES: SpareRoleDef[] = [
  { role: 'park', label: 'Parked', hint: 'Lights off, out of sight behind the formation' },
  { role: 'starfield', label: 'Starfield', hint: 'A dim, twinkling sky behind the formation' },
  { role: 'halo', label: 'Halo', hint: 'A glowing ring around the formation' },
  { role: 'frame', label: 'Frame', hint: 'A frame of light around the formation' },
  { role: 'base', label: 'Base', hint: 'A band of light beneath the formation' },
]

export const MOTION_KINDS: { kind: HoldMotion['kind']; label: string; hint: string }[] = [
  { kind: 'none', label: 'Still', hint: 'Holds its pose (spin still applies)' },
  { kind: 'breathe', label: 'Breathe', hint: 'Grows a little and settles back, like breathing. Spacing only ever widens.' },
  { kind: 'bob', label: 'Bob', hint: 'Rises and falls gently as one piece' },
  { kind: 'sway', label: 'Sway', hint: 'Turns back and forth about the vertical axis' },
]

/** Gentle defaults; the editor lowers the amount further if the formation is big. */
export function defaultMotion(kind: HoldMotion['kind']): HoldMotion {
  switch (kind) {
    case 'breathe': return { kind, amount: 0.06, period: 6 }
    case 'bob': return { kind, amount: 1, period: 8 }
    case 'sway': return { kind, amount: 6, period: 10 }
    default: return { kind: 'none', amount: 0, period: 6 }
  }
}

/** Unit and display scale of a motion's amount. */
export function motionAmountUnit(kind: HoldMotion['kind']): { unit: string; scale: number; step: number; max: number } {
  switch (kind) {
    case 'breathe': return { unit: '%', scale: 100, step: 1, max: 100 }
    case 'bob': return { unit: 'm', scale: 1, step: 0.5, max: 50 }
    case 'sway': return { unit: '°', scale: 1, step: 1, max: 90 }
    default: return { unit: '', scale: 1, step: 1, max: 0 }
  }
}

/** Rounding step of a motion's amount (in its own units: fraction, metres, degrees). */
export function motionStep(kind: HoldMotion['kind']): number {
  return kind === 'breathe' ? 0.01 : kind === 'bob' ? 0.1 : 0.5
}

/**
 * If a scene's idle motion is faster than the limits allow (with its spin),
 * turn it down to `headroom` × the safe amount — or remove it if even a little
 * is too much. Used when motion comes from the AI or a preset.
 */
export function calmMotion(scene: Scene, doc: ShowDoc, headroom = 0.8): Scene {
  const m = scene.motion
  if (!m || m.kind === 'none' || m.amount <= 0) return scene
  const g = sceneGeometry(scene, doc.droneCount)
  const rels = extremeRels({ points: g.points, center: scene.position })
  const u = motionAmountUnit(m.kind)
  const safe = maxSafeMotionAmount(rels, scene.spin * DEG, scene.hold, m, doc.limits, u.max / u.scale)
  if (m.amount <= safe) return scene
  const step = motionStep(m.kind)
  const amount = Math.floor((safe * headroom) / step) * step
  if (amount <= 0) {
    const { motion: _drop, ...rest } = scene // eslint-disable-line @typescript-eslint/no-unused-vars
    return rest
  }
  return { ...scene, motion: { ...m, amount } }
}

/** A layer that only holds spare drones (by role, or — in older files — lights off). */
export function isSpareLayer(l: Layer): boolean {
  return !!l.role || l.effect.kind === 'off'
}

interface Extent { min: Vec3; max: Vec3; center: Vec3; width: number; height: number; /** Largest distance from the centre in the picture plane. */ radius: number }

/** Extent of the formation's main (non-spare) layers in scene-local metres. */
export function mainExtent(scene: Scene, n: number): Extent | null {
  const counts = allocate(n, scene.layers.map((l) => l.weight))
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]
  const all: Float32Array[] = []
  scene.layers.forEach((l, i) => {
    if (isSpareLayer(l) || !counts[i]) return
    const pts = generateShape(l.shape, counts[i]!).points
    transformPoints(pts, isIdentityRotation(l.rotation) ? null : rotationMatrix(l.rotation), l.offset)
    all.push(pts)
    for (let k = 0; k < pts.length; k += 3) {
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a]!, pts[k + a]!)
        max[a] = Math.max(max[a]!, pts[k + a]!)
      }
    }
  })
  if (!Number.isFinite(min[0])) return null
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  let radius = 0
  for (const pts of all) for (let k = 0; k < pts.length; k += 3) radius = Math.max(radius, Math.hypot(pts[k]! - center[0], pts[k + 1]! - center[1]))
  return { min, max, center, width: max[0] - min[0], height: max[1] - min[1], radius }
}

function accentOf(scene: Scene): string {
  for (const l of scene.layers) {
    if (isSpareLayer(l)) continue
    const e = l.effect as Record<string, unknown>
    for (const k of ['color', 'b', 'a']) if (typeof e[k] === 'string' && e[k] !== '#1e293b' && e[k] !== '#0b1020') return e[k] as string
  }
  return '#ffffff'
}

/** Shape, placement and look of spare drones in a role, sized for `count` drones at `spacing`. */
export function spareLayerFor(role: SpareRole, ext: Extent | null, count: number, spacing: number, accent: string, roomHeight = Infinity): Pick<Layer, 'shape' | 'offset' | 'rotation' | 'effect'> {
  const e: Extent = ext ?? { min: [-10, -10, 0], max: [10, 10, 0], center: [0, 0, 0], width: 20, height: 20, radius: 14 }
  const [cx, cy, cz] = e.center
  const back = e.min[2]
  const grid = (aspect: number, scatter: number, size: number, fill: 'filled' | 'outline' = 'filled'): ShapeSpec => ({ ...(newShape('grid') as Extract<ShapeSpec, { kind: 'grid' }>), aspect, scatter, size, fill })
  const zero: Vec3 = [0, 0, 0]
  switch (role) {
    case 'park':
      return { shape: grid(1.6, 0, 1), offset: [cx, cy, back - 25], rotation: zero, effect: defaultEffect('off') }
    case 'starfield': {
      // Larger than the formation (but within the airspace height), behind it,
      // lit dim with a slow twinkle. Scatter 0.3 keeps every gap ≥ 70% of the grid step.
      const scatter = 0.3
      const h = Math.max(10, Math.min(Math.max(e.height * 1.4, 30), roomHeight))
      const need = (count * (spacing / (1 - scatter)) ** 2) / h
      const w = Math.max(e.width * 1.3, 30, need * 1.05)
      const fx: Effect = { kind: 'twinkle', a: '#1b2338', b: '#e8eeff', rate: 0.35, brightness: 0.7 }
      return { shape: grid(w / h, scatter, w), offset: [cx, cy, back - 30], rotation: zero, effect: fx }
    }
    case 'halo': {
      // Just clear of the formation's outermost drones.
      const d = Math.max(2 * (e.radius + 1.5 * spacing), (count * spacing) / Math.PI)
      const fx: Effect = { kind: 'chase', a: '#1e293b', b: accent, speed: 0.12, width: 0.5, brightness: 0.9 }
      return { shape: { kind: 'circle', size: d, fill: 'outline' }, offset: [cx, cy, cz], rotation: zero, effect: fx }
    }
    case 'frame': {
      // A rectangle just clear of the formation, growing evenly if there are many spares.
      let w = e.width + 3 * spacing, h = e.height + 3 * spacing
      const perim = count * spacing
      if (2 * (w + h) < perim) { const k = perim / (2 * (w + h)); w *= k; h *= k }
      const fx: Effect = { kind: 'solid', color: accent, brightness: 0.55 }
      return { shape: grid(w / Math.max(1, h), 0, w, 'outline'), offset: [cx, cy, cz], rotation: zero, effect: fx }
    }
    case 'base': {
      // A band at least as wide as the formation, a few rows deep.
      const w = Math.max(e.width * 1.1, spacing * 4)
      const cols = Math.max(2, Math.floor(w / spacing) + 1)
      const aspect = Math.max(1, Math.min(60, (cols * cols) / Math.max(1, count)))
      const rows = Math.ceil(count / cols)
      const fx: Effect = { kind: 'wave', a: accent, b: '#ffffff', angle: 0, speed: 0.25, width: 0.35, brightness: 0.85 }
      return { shape: grid(aspect, 0, w), offset: [cx, e.min[1] - spacing * 2 - ((rows - 1) * spacing) / 2, cz], rotation: zero, effect: fx }
    }
  }
}

/**
 * Give a spare-drone layer a new role. Rebuilds its shape, placement and look
 * around the formation, keeps its drone share, then re-checks spacing and the
 * airspace.
 */
export function applySpareRole(scene: Scene, doc: ShowDoc, layerId: string, role: SpareRole): Scene {
  const n = doc.droneCount
  const idx = scene.layers.findIndex((l) => l.id === layerId)
  if (idx < 0) return scene
  const counts = allocate(n, scene.layers.map((l) => l.weight))
  const target = comfortableSpacing(doc.limits.minSpacing)
  const room = doc.limits.maxAltitude - doc.limits.minAltitude - 10
  const spec = spareLayerFor(role, mainExtent(scene, n), counts[idx]!, target, accentOf(scene), room)
  const layers = scene.layers.map((l, i) => (i === idx ? { ...l, ...spec, role } : l))
  return placeInAirspace(fitScene({ ...scene, layers }, n, target, 'grow'), doc)
}

/**
 * Add a spare-drone layer with a role, taking `fraction` of the drones from
 * the formation. Main shapes that were at their smallest safe size shrink to
 * the new smallest safe size (fewer drones need less room); shapes the user
 * enlarged keep their size.
 */
export function addSpareLayer(scene: Scene, doc: ShowDoc, role: SpareRole, fraction = 0.3): Scene {
  const n = doc.droneCount
  const f = Math.max(0.02, Math.min(0.85, fraction))
  const target = comfortableSpacing(doc.limits.minSpacing)
  const total = scene.layers.reduce((a, l) => a + l.weight, 0) || 1
  const before = allocate(n, scene.layers.map((l) => l.weight))
  const layer: Layer = { id: newId('layer'), role, shape: newShape('grid'), weight: (total * f) / (1 - f), offset: [0, 0, 0], rotation: [0, 0, 0], effect: defaultEffect('off') }
  const layers = [...scene.layers, layer]
  const after = allocate(n, layers.map((l) => l.weight))
  const resized = layers.map((l, i) => {
    if (i === layers.length - 1 || isSpareLayer(l) || !before[i] || !after[i]) return l
    const wasTight = l.shape.size <= fittedSize(l.shape, before[i]!, target) * 1.02
    return wasTight ? { ...l, shape: { ...l.shape, size: fittedSize(l.shape, after[i]!, target) } as ShapeSpec } : l
  })
  return applySpareRole({ ...scene, layers: resized }, doc, layer.id, role)
}
