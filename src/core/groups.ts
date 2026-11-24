// Groups: splits and merges.
//
// After a formation is held, some of its shapes can break away as groups.
// Each group flies its own sequence of formations ("steps") at its own pace,
// while drones not in any group keep holding the formation. The next scene
// then merges everyone back together. Steps are ordinary scenes sized for the
// group's drones, so every scene editor works on them unchanged.

import type { Group, Scene, ShowDoc } from './types'

/** Largest-remainder split of `n` drones by layer weight. */
export function allocate(n: number, weights: number[]): number[] {
  const w = weights.map((x) => Math.max(0, x))
  const total = w.reduce((a, b) => a + b, 0)
  if (total <= 0) return w.map((_, i) => (i === 0 ? n : 0))
  const exact = w.map((x) => (x / total) * n)
  const counts = exact.map(Math.floor)
  let rest = n - counts.reduce((a, b) => a + b, 0)
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (let k = 0; rest > 0; k++, rest--) counts[order[k % order.length]![1]]!++
  return counts
}

/** Sizes of `of` near-equal slices of `count` (the first slices take the remainder). */
export function sliceSizes(count: number, of: number): number[] {
  const k = Math.max(1, Math.round(of))
  const base = Math.floor(count / k), extra = count - base * k
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0))
}

/**
 * Which group each point of a formation belongs to (-1 = none). Points are
 * the scene's formation in point order, with `layerOf` per point. A group
 * takes the points of its layers, or one slice of them sorted across (x) or
 * by height (y); a point joins the first group that claims it.
 */
export function pointGroups(scene: Scene, points: Float32Array, layerOf: Uint16Array): Int32Array {
  const n = layerOf.length
  const out = new Int32Array(n).fill(-1)
  ;(scene.groups ?? []).forEach((g, gi) => {
    const ids = new Set(g.layers)
    const cands: number[] = []
    for (let k = 0; k < n; k++) if (ids.has(scene.layers[layerOf[k]!]?.id ?? '')) cands.push(k)
    let mine = cands
    if (g.part) {
      const a = g.part.axis === 'y' ? 1 : 0
      const sorted = [...cands].sort((p, q) => points[p * 3 + a]! - points[q * 3 + a]! || p - q)
      const sizes = sliceSizes(sorted.length, g.part.of)
      const start = sizes.slice(0, g.part.index).reduce((x, y) => x + y, 0)
      mine = sorted.slice(start, start + (sizes[g.part.index] ?? 0))
    }
    for (const k of mine) if (out[k] === -1) out[k] = gi
  })
  return out
}

/** Drones in each group of a scene with `n` drones. */
export function groupSizes(scene: Scene, n: number): number[] {
  const counts = allocate(n, scene.layers.map((l) => l.weight))
  const claimed = new Set<string>()
  return (scene.groups ?? []).map((g) => {
    let c = 0
    scene.layers.forEach((l, li) => { if (g.layers.includes(l.id)) c += counts[li]! })
    if (g.part) return sliceSizes(c, g.part.of)[g.part.index] ?? 0
    const key = g.layers.join(',')
    if (claimed.has(key)) return 0
    claimed.add(key)
    return c
  })
}

/** True when the scene splits into groups that actually do something. */
export function hasSplit(scene: Scene): boolean {
  return !!scene.groups?.some((g) => g.steps.length > 0)
}

export interface SceneRef {
  scene: Scene
  /** Set for a group step: the scene it splits from, and the group. */
  parent: Scene | null
  group: Group | null
  /** Index of the main scene, or of the step within its group. */
  index: number
  /** Index of the main scene this belongs to. */
  main: number
}

/** Find a scene or a group step by id. Works on immer drafts too. */
export function findScene(doc: ShowDoc, id: string): SceneRef | null {
  for (let i = 0; i < doc.scenes.length; i++) {
    const sc = doc.scenes[i]!
    if (sc.id === id) return { scene: sc, parent: null, group: null, index: i, main: i }
    for (const g of sc.groups ?? []) {
      const k = g.steps.findIndex((st) => st.id === id)
      if (k >= 0) return { scene: g.steps[k]!, parent: sc, group: g, index: k, main: i }
    }
  }
  return null
}

/** Find a group by id. */
export function findGroup(doc: ShowDoc, id: string): { group: Group; parent: Scene; main: number; index: number } | null {
  for (let i = 0; i < doc.scenes.length; i++) {
    const gs = doc.scenes[i]!.groups ?? []
    const k = gs.findIndex((g) => g.id === id)
    if (k >= 0) return { group: gs[k]!, parent: doc.scenes[i]!, main: i, index: k }
  }
  return null
}

/** How many drones a scene (or group step) has. */
export function sceneDroneCount(doc: ShowDoc, id: string): number {
  const ref = findScene(doc, id)
  if (!ref) return doc.droneCount
  if (!ref.parent || !ref.group) return doc.droneCount
  const gi = ref.parent.groups!.indexOf(ref.group)
  return groupSizes(ref.parent, doc.droneCount)[gi] ?? 0
}

/** Replace a scene or group step (immutably); `f` gets the scene and its drone count. */
export function mapScene(doc: ShowDoc, id: string, f: (s: Scene, n: number) => Scene): ShowDoc {
  const ref = findScene(doc, id)
  if (!ref) return doc
  const n = sceneDroneCount(doc, id)
  if (!ref.parent) return { ...doc, scenes: doc.scenes.map((s) => (s.id === id ? f(s, n) : s)) }
  return {
    ...doc,
    scenes: doc.scenes.map((s) => s !== ref.parent ? s : {
      ...s, groups: s.groups!.map((g) => g !== ref.group ? g : { ...g, steps: g.steps.map((st) => (st.id === id ? f(st, n) : st)) }),
    }),
  }
}

/** Put `next` in place of the scene or step with this id (for immer drafts). */
export function replaceSceneIn(d: ShowDoc, id: string, next: Scene): boolean {
  const ref = findScene(d, id)
  if (!ref) return false
  if (ref.group) ref.group.steps[ref.index] = next
  else d.scenes[ref.index] = next
  return true
}

/** Every scene and group step, main scenes first in order, each followed by its steps. */
export function allScenes(doc: ShowDoc): SceneRef[] {
  const out: SceneRef[] = []
  doc.scenes.forEach((sc, i) => {
    out.push({ scene: sc, parent: null, group: null, index: i, main: i })
    for (const g of sc.groups ?? []) g.steps.forEach((st, k) => out.push({ scene: st, parent: sc, group: g, index: k, main: i }))
  })
  return out
}

/** Drop group references to layers that no longer exist, and empty groups' layer lists. */
export function pruneGroups(scene: Scene): Scene {
  if (!scene.groups) return scene
  const ids = new Set(scene.layers.map((l) => l.id))
  const groups = scene.groups.map((g) => ({ ...g, layers: g.layers.filter((id) => ids.has(id)) })).filter((g) => g.layers.length > 0)
  return groups.length ? { ...scene, groups } : { ...scene, groups: undefined }
}
