// Splitting a scene into groups (pure document transforms, shared by the
// editor and the AI features).

import { safeSpacing } from './site'
import type { Group, Scene, ShapeKind, ShapeSpec, ShowDoc, Vec3 } from './types'
import { compileScene, sceneGeometry } from './compile'
import { newId, newScene, newShape } from './defaults'
import { SHAPE_BY_KIND } from './shapes'
import { findScene, groupSizes, pointGroups } from './groups'
import { comfortableSpacing } from './separation'

export type SplitMode = 'shapes' | 'halves' | 'top-bottom' | 'thirds'

export const SPLIT_MODES: { mode: SplitMode; label: string; hint: string }[] = [
  { mode: 'shapes', label: 'By shape', hint: 'Each shape of the formation becomes a group' },
  { mode: 'halves', label: 'Left | right', hint: 'The left and right halves of the formation' },
  { mode: 'top-bottom', label: 'Top | bottom', hint: 'The lower and upper halves of the formation' },
  { mode: 'thirds', label: 'Three columns', hint: 'Three slices, left to right' },
]

const STEP_KINDS: ShapeKind[] = ['heart', 'star', 'circle', 'polygon', 'spiral', 'wave']

/**
 * A first formation for a group. Filled shapes keep groups compact; lower and
 * upper halves become wide, low bands of light that part vertically (two
 * shapes stacked rarely fit under the ceiling, and side by side the halves
 * would cross).
 */
function defaultStep(sub: ShowDoc, gi: number, at: Vec3, mode: SplitMode): Scene {
  if (mode === 'top-bottom') {
    const band = { ...newShape('grid'), aspect: 5, fill: 'filled' } as ShapeSpec
    return { ...newScene(sub, 'grid', { position: at, shape: band, name: gi === 0 ? 'Low band' : 'High band' }), hold: 6 }
  }
  const kind = STEP_KINDS[gi % STEP_KINDS.length]!
  const base = newShape(kind)
  const shape = 'fill' in base ? ({ ...base, fill: 'filled' } as ShapeSpec) : base
  return { ...newScene(sub, kind, { position: at, shape }), hold: 6 }
}

/** Groups (without formations yet) for a split of `scene`. Spare drones with a role stay out. */
export function groupsFor(scene: Scene, mode?: SplitMode): Group[] {
  const main = scene.layers.filter((l) => !l.role)
  if (!main.length) return []
  const m = mode ?? (main.length > 1 ? 'shapes' : 'halves')
  const ids = main.map((l) => l.id)
  const parts: Pick<Group, 'layers' | 'part'>[] =
    m === 'shapes' ? main.map((l) => ({ layers: [l.id] }))
      : m === 'thirds' ? [0, 1, 2].map((index) => ({ layers: ids, part: { axis: 'x' as const, index, of: 3 } }))
        : [0, 1].map((index) => ({ layers: ids, part: { axis: m === 'top-bottom' ? 'y' as const : 'x' as const, index, of: 2 } }))
  const names = m === 'halves' ? ['Left', 'Right'] : m === 'top-bottom' ? ['Lower', 'Upper'] : m === 'thirds' ? ['Left', 'Middle', 'Right'] : main.map((l) => SHAPE_BY_KIND[l.shape.kind].label)
  return parts.map((p, gi) => ({ id: newId('group'), name: names[gi] ?? `Group ${gi + 1}`, delay: 0, steps: [], ...p }))
}

/**
 * For each group: where its drones are in the formation, and a spot for a
 * first formation of its own, fanned out from the formation's centre so the
 * groups move apart.
 */
export function groupSpots(scene: Scene, groups: Group[], n: number): { centre: Vec3; out: Vec3 }[] {
  const draft = { ...scene, groups }
  // Where the drones are when the split begins: the end of the hold (after any spin).
  const cs = compileScene(draft, 0, n)
  const g = { points: cs.endPoints, layerOf: cs.layerOf }
  const of = pointGroups(draft, g.points, g.layerOf)
  return groups.map((_, gi) => {
    let cx = 0, cy = 0, cz = 0, c = 0
    for (let k = 0; k < of.length; k++) if (of[k] === gi) { cx += g.points[k * 3]!; cy += g.points[k * 3 + 1]!; cz += g.points[k * 3 + 2]!; c++ }
    if (c) { cx /= c; cy /= c; cz /= c } else [cx, cy, cz] = scene.position
    const [px, py] = scene.position
    return { centre: [cx, cy, cz], out: [px + (cx - px) * 1.6, py + (cy - py) * 1.4, cz] }
  })
}

/** The document as a group of `parent` sees it: its drone count. */
export function groupDoc(doc: ShowDoc, parent: Scene, groupIndex: number): ShowDoc {
  return { ...doc, droneCount: groupSizes(parent, doc.droneCount)[groupIndex] ?? 0 }
}

/** Horizontal (or vertical) extent of everything a group flies, over all its formations (spin included). */
function groupExtent(group: Group, n: number, axis: 0 | 1): { lo: number; hi: number } {
  let lo = Infinity, hi = -Infinity
  for (const st of group.steps) {
    const p = sceneGeometry(st, n).points
    const c = st.position
    let r = 0
    for (let k = 0; k < p.length / 3; k++) {
      const v = p[k * 3 + axis]!
      lo = Math.min(lo, v); hi = Math.max(hi, v)
      if (axis === 0 && st.spin) r = Math.max(r, Math.hypot(p[k * 3]! - c[0], p[k * 3 + 2]! - c[2]))
    }
    if (r) { lo = Math.min(lo, c[0] - r); hi = Math.max(hi, c[0] + r) }
  }
  return { lo, hi }
}

/**
 * Move a scene's groups apart so no two groups' formations overlap: each
 * group keeps its own formations' layout but shifts (as a whole) outward
 * along the split's axis, leaving a clear gap. Groups that already keep
 * apart don't move.
 */
export function separateGroups(doc: ShowDoc, sceneId: string): ShowDoc {
  const scene = doc.scenes.find((s) => s.id === sceneId)
  const groups = scene?.groups
  if (!scene || !groups || groups.length < 2) return doc
  const sizes = groupSizes(scene, doc.droneCount)
  const gap = 2 * comfortableSpacing(safeSpacing(doc.limits))
  // Lower and upper halves stack vertically if there's room under the ceiling; otherwise side by side.
  let axis: 0 | 1 = groups.every((g) => g.part?.axis === 'y') ? 1 : 0
  if (axis === 1) {
    const ys = groups.map((g, gi) => (g.steps.length && sizes[gi] ? groupExtent(g, sizes[gi]!, 1) : null)).filter((e): e is { lo: number; hi: number } => !!e)
    const need = ys.reduce((a, e) => a + (e.hi - e.lo), 0) + gap * (ys.length - 1)
    if (!ys.length || Math.min(...ys.map((e) => e.lo)) + need > doc.limits.maxAltitude - 4) axis = 0
  }
  let work = groups
  if (axis === 0 && groups.every((g) => g.part?.axis === 'y')) {
    // No room to stack: each half keeps its height order (lower stays lower, so they never cross
    // vertically), brought under the ceiling, and they move apart side by side.
    const ceil = doc.limits.maxAltitude - 4
    work = groups.map((g, gi) => {
      if (!g.steps.length || !sizes[gi]) return g
      const e = groupExtent(g, sizes[gi]!, 1)
      const dy = e.hi > ceil ? ceil - e.hi : 0
      return dy ? { ...g, steps: g.steps.map((st) => ({ ...st, position: [st.position[0], Math.round((st.position[1] + dy) * 10) / 10, st.position[2]] as Vec3 })) } : g
    })
  }
  const ext = work.map((g, gi) => (g.steps.length && sizes[gi] ? groupExtent(g, sizes[gi]!, axis) : null))
  const order = groups.map((_, gi) => gi).filter((gi) => ext[gi]).sort((a, b) => (ext[a]!.lo + ext[a]!.hi) - (ext[b]!.lo + ext[b]!.hi))
  if (order.length < 2) return doc
  // Lay the groups out in order with the gap between them, centred where they were.
  const widths = order.map((gi) => ext[gi]!.hi - ext[gi]!.lo)
  const total = widths.reduce((a, b) => a + b, 0) + gap * (order.length - 1)
  const centre = order.reduce((a, gi) => a + (ext[gi]!.lo + ext[gi]!.hi) / 2, 0) / order.length
  const shift = new Map<number, number>()
  let x = centre - total / 2
  let overlap = false
  for (let k = 1; k < order.length; k++) if (ext[order[k]!]!.lo < ext[order[k - 1]!]!.hi + gap - 1e-6) overlap = true
  if (!overlap && work === groups) return doc
  order.forEach((gi, k) => {
    // Vertically, never push a group down: the lowest stays, the rest stack above it.
    const lo = axis === 1 && k === 0 ? ext[gi]!.lo : x
    shift.set(gi, lo - ext[gi]!.lo)
    x = lo + widths[k]! + gap
  })
  const moved = work.map((g, gi) => {
    const d = shift.get(gi) ?? 0
    if (Math.abs(d) < 1e-6) return g
    return { ...g, steps: g.steps.map((st) => { const p = [...st.position] as Vec3; p[axis] = Math.round((p[axis] + d) * 10) / 10; return { ...st, position: p } }) }
  })
  return { ...doc, scenes: doc.scenes.map((s) => (s.id === sceneId ? { ...s, groups: moved } : s)) }
}

/**
 * Split a scene into groups. `makeStep` builds each group's first formation
 * (default: a simple shape at the group's fanned-out spot); return null for
 * none.
 */
export function splitSceneDoc(doc: ShowDoc, sceneId: string, mode?: SplitMode, makeStep?: (sub: ShowDoc, groupIndex: number, spot: Vec3) => Scene | null): { doc: ShowDoc; groups: Group[] } {
  const ref = findScene(doc, sceneId)
  if (!ref || ref.group) return { doc, groups: [] }
  const scene = ref.scene
  const bare = groupsFor(scene, mode)
  if (!bare.length) return { doc, groups: [] }
  const spots = groupSpots(scene, bare, doc.droneCount)
  const sizes = groupSizes({ ...scene, groups: bare }, doc.droneCount)
  const groups = bare.map((g, gi) => {
    const sub = { ...doc, droneCount: sizes[gi] ?? 0 }
    if (!sub.droneCount) return g
    const step = makeStep ? makeStep(sub, gi, spots[gi]!.out) : defaultStep(sub, gi, spots[gi]!.out, mode ?? (scene.layers.filter((l) => !l.role).length > 1 ? 'shapes' : 'halves'))
    return step ? { ...g, steps: [step] } : g
  })
  const next = { ...doc, scenes: doc.scenes.map((s) => (s.id === sceneId ? { ...s, groups } : s)) }
  // Default formations: lay them out so the groups keep apart.
  const out = makeStep ? next : separateGroups(next, sceneId)
  return { doc: out, groups: out.scenes.find((s) => s.id === sceneId)!.groups! }
}
