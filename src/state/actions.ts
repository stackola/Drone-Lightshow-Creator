import { safeSpacing } from '@/core/site'
import type { Draft } from 'immer'
import type { Effect, Group, LightCue, Scene, ShapeKind, ShapeSpec, ShowDoc, SpareRole } from '@/core/types'
import { SPARE_ROLES, addSpareLayer, applySpareRole, calmMotion } from '@/core/idle'
import { fitScene, fitToAirspace, newId, newLayer, newLedSign, newScene, newShape } from '@/core/defaults'
import { comfortableSpacing, type FixAction, type Issue } from '@/core/validate'
import { applyFixToDoc, autoFix, settleParts, tidySplit } from '@/core/fixes'
import { defaultEffect } from '@/core/effects'
import { getState } from './store'
import { seek } from './playback'
import { SAMPLE_BIRD, SHAPE_BY_KIND } from '@/core/shapes'
import { allocate, findCompiledScene, findSceneTime } from '@/core/compile'
import { SPLIT_MODES, splitSceneDoc, type SplitMode } from '@/core/splits'
import { MIN_KEY_TIME, keyPose, normalizeKeys } from '@/core/keys'
import { findGroup, findScene, groupSizes, pruneGroups, replaceSceneIn, sceneDroneCount } from '@/core/groups'

/**
 * A scene or group step, and the document as it sees it: a group step has
 * only its group's drones, so sizing and fitting use that count.
 */
function ctx(id: string): { scene: Scene | undefined; sub: ShowDoc } {
  const doc = getState().doc
  const ref = findScene(doc, id)
  if (!ref) return { scene: undefined, sub: doc }
  const n = sceneDroneCount(doc, id)
  return { scene: ref.scene, sub: n === doc.droneCount ? doc : { ...doc, droneCount: n } }
}

/** Replace a scene or group step as one undo step. */
function put(id: string, next: Scene, label: string, key?: string) {
  getState().update((d) => { replaceSceneIn(d as ShowDoc, id, next) }, label, key)
}

export function addScene(kind: ShapeKind, opts: { shape?: ShapeSpec; name?: string } = {}) {
  const s = getState()
  const sel = s.selection
  // With a group step selected, the new formation becomes the group's next step.
  if ((sel.kind === 'scene' || sel.kind === 'flight') && findScene(s.doc, sel.id)?.group) {
    const ref = findScene(s.doc, sel.id)!
    return addGroupStep(ref.group!.id, kind, { shape: opts.shape, name: opts.name, after: ref.index })
  }
  const idx = sel.kind === 'scene' || sel.kind === 'flight' ? s.doc.scenes.findIndex((x) => x.id === sel.id) : -1
  const after = idx >= 0 ? s.doc.scenes[idx] : s.doc.scenes[s.doc.scenes.length - 1]
  const scene = newScene(s.doc, kind, { shape: opts.shape, name: opts.name, position: after ? [...after.position] : undefined })
  const at = idx >= 0 ? idx + 1 : s.doc.scenes.length
  s.update((d) => { d.scenes.splice(at, 0, scene as Draft<Scene>) }, `Add ${scene.name}`)
  s.select({ kind: 'scene', id: scene.id })
  return scene
}

/** Add a bird that flaps its wings (a 3D model with moving parts), as fully as the drones can fly. */
export function addFlappingBird() {
  const s = getState()
  const scene = addScene('model', { name: 'Bird', shape: { kind: 'model', size: 30, name: 'Bird', parts: SAMPLE_BIRD.parts.map((p) => ({ ...p })), joints: SAMPLE_BIRD.joints.map((j) => ({ ...j })) } })
  if (!scene) return
  const ref = findScene(getState().doc, scene.id)
  if (!ref) return
  const sub = { ...s.doc, droneCount: sceneDroneCount(getState().doc, scene.id) }
  // The fullest flap these drones can fly at this beat.
  const settled = settleParts({ ...ref.scene, hold: Math.max(ref.scene.hold, 36) }, sub, { prefer: 'calm' })
  getState().update((d) => { replaceSceneIn(d as ShowDoc, scene.id, settled) }, 'Add Bird', 'add-bird')
}

/** Add an LED sign (scrolling dot-matrix text) after the selection. */
export function addLedSign(text = 'WELCOME') {
  const s = getState()
  const sel = s.selection
  const idx = sel.kind === 'scene' || sel.kind === 'flight' ? s.doc.scenes.findIndex((x) => x.id === sel.id) : -1
  const after = idx >= 0 ? s.doc.scenes[idx] : s.doc.scenes[s.doc.scenes.length - 1]
  const scene = newLedSign(s.doc, text, { position: after ? [...after.position] : undefined })
  const at = idx >= 0 ? idx + 1 : s.doc.scenes.length
  s.update((d) => { d.scenes.splice(at, 0, scene as Draft<Scene>) }, 'Add LED sign')
  s.select({ kind: 'scene', id: scene.id })
  return scene
}

/**
 * Resize an LED panel (a grid layer) to exactly cols × rows drones. The rest of
 * the fleet parks dark behind it; other shapes in the scene are kept.
 */
export function resizeLedPanel(sceneId: string, layerId: string, cols: number, rows: number) {
  const s = getState()
  const { scene, sub } = ctx(sceneId)
  const layer = scene?.layers.find((l) => l.id === layerId)
  if (!scene || !layer || layer.shape.kind !== 'grid') return
  const n = sub.droneCount
  const others = scene.layers.filter((l) => l.id !== layerId && !(l.role === 'park'))
  const counts = allocate(n, scene.layers.map((l) => l.weight))
  const otherCount = scene.layers.reduce((a, l, i) => (others.includes(l) ? a + counts[i]! : a), 0)
  const R = Math.max(1, Math.round(rows))
  const C = Math.max(1, Math.min(Math.round(cols), Math.floor((n - otherCount) / R)))
  const panel = C * R
  const spacing = comfortableSpacing(safeSpacing(s.doc.limits))
  const grid = { ...layer.shape, aspect: C / R, scatter: 0, fill: 'filled' as const, size: Math.max(1, (C - 1) * spacing) }
  const rest = n - otherCount - panel
  const park = scene.layers.find((l) => l.role === 'park') ?? { ...newLayer(newShape('grid'), defaultEffect('off')), role: 'park' as const, offset: [0, 0, -25] as [number, number, number] }
  const layers = [
    ...scene.layers.filter((l) => others.includes(l)).map((l) => ({ ...l, weight: counts[scene.layers.indexOf(l)]! })),
    { ...layer, shape: grid, weight: panel },
    ...(rest > 0 ? [{ ...park, weight: rest }] : []),
  ]
  const next = fitScene({ ...scene, layers }, n, spacing, 'grow')
  put(sceneId, next, 'Resize LED panel', `led:${layerId}`)
}

/** A deep copy with fresh ids (layers, groups and their steps), keeping group membership. */
function cloneScene(src: Scene): Scene {
  const copy: Scene = JSON.parse(JSON.stringify(src))
  copy.id = newId('scene')
  const ids = new Map<string, string>()
  copy.layers.forEach((l) => { const id = newId('layer'); ids.set(l.id, id); l.id = id })
  copy.groups?.forEach((g) => {
    g.id = newId('group')
    g.layers = g.layers.map((x) => ids.get(x) ?? x)
    g.steps = g.steps.map(cloneScene)
  })
  return copy
}

export function duplicateScene(id: string) {
  const s = getState()
  const ref = findScene(s.doc, id)
  if (!ref) return
  const copy = cloneScene(ref.scene)
  copy.name = `${ref.scene.name} copy`
  s.update((d) => {
    const r = findScene(d as ShowDoc, id)
    if (!r) return
    if (r.group) r.group.steps.splice(r.index + 1, 0, copy)
    else d.scenes.splice(r.index + 1, 0, copy as Draft<Scene>)
  }, 'Duplicate scene')
  s.select({ kind: 'scene', id: copy.id })
}

export function deleteScene(id: string) {
  const s = getState()
  const ref = findScene(s.doc, id)
  if (!ref) return
  const list = ref.group ? ref.group.steps : s.doc.scenes
  const next = list[ref.index + 1] ?? list[ref.index - 1] ?? ref.parent
  s.update((d) => {
    const r = findScene(d as ShowDoc, id)
    if (!r) return
    if (r.group) r.group.steps.splice(r.index, 1)
    else d.scenes.splice(r.index, 1)
  }, `Delete ${ref.scene.name}`)
  s.select(next ? { kind: 'scene', id: next.id } : { kind: 'show' })
}

export function moveScene(id: string, to: number) {
  const s = getState()
  const from = s.doc.scenes.findIndex((x) => x.id === id)
  if (from < 0 || from === to || from + 1 === to) return
  s.update((d) => {
    const [item] = d.scenes.splice(from, 1)
    d.scenes.splice(to > from ? to - 1 : to, 0, item!)
  }, 'Reorder scenes')
}

export function updateScene(id: string, recipe: (s: Draft<Scene>) => void, label = 'Edit scene', key?: string) {
  getState().update((d) => {
    const ref = findScene(d as ShowDoc, id)
    if (ref) recipe(ref.scene as Draft<Scene>)
  }, label, key)
}

/** Replace a layer's shape, keeping safe spacing and the floor clearance. */
export function setLayerShape(sceneId: string, layerId: string, shape: ShapeSpec, label = 'Change shape') {
  const { scene, sub } = ctx(sceneId)
  if (!scene) return
  const draft: Scene = { ...scene, layers: scene.layers.map((l) => (l.id === layerId ? { ...l, shape } : l)) }
  const fitted = fitToAirspace(fitScene(draft, sub.droneCount, comfortableSpacing(safeSpacing(sub.limits)), 'grow'), sub)
  put(sceneId, fitted, label)
}

export function changeLayerKind(sceneId: string, layerId: string, kind: ShapeKind) {
  const { scene, sub } = ctx(sceneId)
  const layer = scene?.layers.find((l) => l.id === layerId)
  if (!scene || !layer || layer.shape.kind === kind) return
  const next = newShape(kind)
  const s2: Scene = { ...scene, layers: scene.layers.map((l) => (l.id === layerId ? { ...l, shape: next } : l)) }
  const fitted = fitToAirspace(fitScene(s2, sub.droneCount, comfortableSpacing(safeSpacing(sub.limits)), 'exact'), sub)
  const renamed = scene.layers.length === 1 && scene.name === SHAPE_BY_KIND[layer.shape.kind].label ? { ...fitted, name: SHAPE_BY_KIND[kind].label } : fitted
  put(sceneId, renamed, `Change to ${SHAPE_BY_KIND[kind].label}`)
}

export function addLayer(sceneId: string, kind: ShapeKind | 'spare') {
  const { scene, sub } = ctx(sceneId)
  if (!scene) return
  const spare = kind === 'spare'
  const layer = newLayer(newShape(spare ? 'grid' : kind), spare ? defaultEffect('off') : defaultEffect('solid', '#ffffff'))
  if (spare) {
    layer.role = 'park'
    layer.offset = [0, 0, -25]
    layer.weight = 0.3
  }
  const s2: Scene = { ...scene, layers: [...scene.layers, layer] }
  const fitted = fitToAirspace(fitScene(s2, sub.droneCount, comfortableSpacing(safeSpacing(sub.limits)), 'grow'), sub)
  put(sceneId, fitted, spare ? 'Park spare drones' : 'Add shape')
}

/** Use some of a scene's drones as spares in a role (parked, starfield, halo, frame, base). */
export function addSpare(sceneId: string, role: SpareRole) {
  const { scene, sub } = ctx(sceneId)
  if (!scene) return
  // A bigger layout can make the scene's idle motion too fast: keep it safe.
  const next = calmMotion(addSpareLayer(scene, sub, role, 0.3), sub)
  put(sceneId, next, `Spare drones: ${SPARE_ROLES.find((r) => r.role === role)?.label ?? role}`)
}

export function setSpareRole(sceneId: string, layerId: string, role: SpareRole) {
  const { scene, sub } = ctx(sceneId)
  if (!scene) return
  const next = calmMotion(applySpareRole(scene, sub, layerId, role), sub)
  put(sceneId, next, `Spare drones: ${SPARE_ROLES.find((r) => r.role === role)?.label ?? role}`)
}

export function removeLayer(sceneId: string, layerId: string) {
  const { scene } = ctx(sceneId)
  if (!scene || scene.layers.length < 2) return
  put(sceneId, pruneGroups({ ...scene, layers: scene.layers.filter((l) => l.id !== layerId) }), 'Remove shape')
}

/** Set one layer's drone count; the other layers share the remainder in proportion. */
export function setLayerCount(sceneId: string, layerId: string, count: number, counts: number[]) {
  const n = ctx(sceneId).sub.droneCount
  updateScene(sceneId, (sc) => {
    const i = sc.layers.findIndex((l) => l.id === layerId)
    if (i < 0) return
    const c = Math.max(0, Math.min(n, Math.round(count)))
    const others = counts.reduce((a, b, j) => (j === i ? a : a + b), 0)
    sc.layers.forEach((l, j) => {
      l.weight = j === i ? c : others > 0 ? (counts[j]! / others) * (n - c) : (n - c) / Math.max(1, sc.layers.length - 1)
    })
  }, 'Change drone split', `count:${sceneId}`)
}

export function fitSceneToSpacing(sceneId: string, mode: 'exact' | 'grow' = 'exact', target?: number) {
  const { scene, sub } = ctx(sceneId)
  if (!scene) return
  const t = target ?? comfortableSpacing(safeSpacing(sub.limits))
  const fitted = fitToAirspace(fitScene(scene, sub.droneCount, t, mode), sub)
  put(sceneId, fitted, 'Fit to safe spacing')
}

export function applyFix(action: FixAction) {
  const s = getState()
  const labels: Record<FixAction['kind'], string> = { 'fit-spacing': 'Fit to safe spacing', 'set-spin': 'Slow spin', move: 'Move scene', 'grid-spacing': 'Pad spacing', 'fit-airspace': 'Shrink to fit airspace', 'calm-hold': 'Calm hold motion', 'calm-parts': 'Calm moving parts', 'slow-parts': 'Slow moving parts', 'flight-style': 'Fly direct', 'separate-groups': 'Move groups apart' }
  s.replaceDoc(applyFixToDoc(s.doc, action), labels[action.kind])
  s.set({ focus: null })
}

/**
 * Fix every issue that has an automatic fix, as one undo step. Validation is
 * re-run synchronously between passes, so a fix is never applied twice.
 */
export function fixAll() {
  const s = getState()
  const { doc, applied, validation } = autoFix(s.doc)
  if (applied) s.replaceDoc(doc, 'Fix safety issues')
  s.set({ focus: null })
  const left = validation.issues.length
  s.toast(left ? `Fixed what could be fixed automatically — ${left} issue${left > 1 ? 's' : ''} need a decision` : 'All safety issues fixed')
}

export function focusIssue(issue: Issue) {
  const s = getState()
  s.set({ focus: issue })
  if (issue.sceneId) s.select({ kind: 'scene', id: issue.sceneId })
  seek(issue.time)
}

// --- Viewport manipulation ------------------------------------------------------------

/** Selected formation, if any (a selected flight counts as its formation). */
export function selectedSceneId(): string | null {
  const sel = getState().selection
  return sel.kind === 'scene' || sel.kind === 'flight' ? sel.id : null
}

/** Move a scene by a delta; consecutive nudges merge into one undo step. */
export function nudgeScene(id: string, delta: [number, number, number]) {
  updateScene(id, (s) => {
    s.position = [s.position[0] + delta[0], s.position[1] + delta[1], s.position[2] + delta[2]].map((v) => Math.round(v * 100) / 100) as [number, number, number]
  }, 'Move scene', `nudge:${id}`)
}

/**
 * Commit a viewport transform: new centre and rotation, and a uniform scale
 * (applied to every layer's size and offset). Scaling never goes below the
 * safe spacing.
 */
export function transformScene(id: string, t: { position?: [number, number, number]; rotation?: [number, number, number]; scale?: number }, label: string) {
  const { scene, sub } = ctx(id)
  if (!scene) return
  let next: Scene = { ...scene }
  if (t.position) next.position = t.position.map((v) => Math.round(v * 100) / 100) as [number, number, number]
  if (t.rotation) next.rotation = t.rotation.map((v) => Math.round(v * 10) / 10) as [number, number, number]
  if (t.scale && Math.abs(t.scale - 1) > 1e-4) {
    const k = t.scale
    next.layers = next.layers.map((l) => ({ ...l, shape: { ...l.shape, size: Math.round(l.shape.size * k * 10) / 10 } as ShapeSpec, offset: l.offset.map((v) => v * k) as [number, number, number] }))
    next = fitScene(next, sub.droneCount, comfortableSpacing(safeSpacing(sub.limits)), 'grow')
  }
  put(id, next, label)
}

/** Fly the camera to a formation (orbit view). */
export function frameScene(id: string) {
  const s = getState()
  const cs = s.compiled ? findCompiledScene(s.compiled, id) : undefined
  if (!cs) return
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < cs.points.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a]!, cs.points[i + a]!); hi[a] = Math.max(hi[a]!, cs.points[i + a]!) }
  const center: [number, number, number] = [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2]
  const radius = Math.max(5, Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) / 2)
  s.set({ camera: 'orbit', frameRequest: { center, radius, nonce: (s.frameRequest?.nonce ?? 0) + 1 } })
}

// --- Navigation ----------------------------------------------------------------------

export function seekToScene(id: string) {
  const c = getState().compiled
  const t = c ? findSceneTime(c, id) : undefined
  if (t) seek(t.holdStart + Math.min(0.5, (t.holdEnd - t.holdStart) / 2))
}

export function stepScene(dir: 1 | -1) {
  const s = getState()
  const c = s.compiled
  if (!c || !c.sceneTimes.length) return
  const t = s.time
  const list = c.sceneTimes
  let target
  if (dir > 0) target = list.find((x) => x.holdStart > t + 0.6)
  else target = [...list].reverse().find((x) => x.holdStart + 0.5 < t - 0.1)
  if (target) {
    s.select({ kind: 'scene', id: target.id })
    seekToScene(target.id)
  } else if (dir < 0) seek(0)
  else seek(c.duration)
}

// --- Keyframes ----------------------------------------------------------------------------

/** Set the keyframe at hold time tau (rounded to 0.1 s): update the key there, or add one. One undo step. */
export function setKeyAt(id: string, tau: number, v: { move: [number, number, number]; rotate: [number, number, number]; scale: number }, mergeKey?: string) {
  const t = Math.round(Math.max(MIN_KEY_TIME, tau) * 10) / 10
  const r = (x: number, d = 10) => Math.round(x * d) / d
  const values = { move: v.move.map((x) => r(x)) as [number, number, number], rotate: v.rotate.map((x) => r(x)) as [number, number, number], scale: r(v.scale, 1000) }
  updateScene(id, (s) => {
    const keys = s.keys ?? []
    const k = keys.findIndex((x) => Math.abs(x.t - t) < 0.051)
    if (k >= 0) Object.assign(keys[k]!, values)
    else keys.push({ t, ...values })
    keys.sort((a, b) => a.t - b.t)
    s.keys = keys
  }, 'Keyframe', mergeKey)
}

/** Hold time of the playhead if auto-key applies to this formation (playhead inside its hold), else null. */
export function autoKeyTau(id: string): number | null {
  const s = getState()
  if (!s.autoKey || !s.compiled) return null
  const ref = findScene(s.doc, id)
  const t = findSceneTime(s.compiled, id)
  if (!ref || !t) return null
  const tau = s.time - t.holdStart
  return tau >= MIN_KEY_TIME - 1e-6 && tau <= ref.scene.hold + 1e-6 ? tau : null
}

/** Nudge the keyframe at the playhead (auto-key), starting from the pose there; consecutive nudges merge. */
export function nudgeKey(id: string, tau: number, delta: [number, number, number]) {
  const ref = findScene(getState().doc, id)
  if (!ref) return
  const p = keyPose(normalizeKeys(ref.scene.keys, ref.scene.hold), tau)
  setKeyAt(id, tau, { move: [p.move[0] + delta[0], p.move[1] + delta[1], p.move[2] + delta[2]], rotate: p.rotate, scale: p.scale }, `nudgekey:${id}`)
}

// --- Groups (splits and merges) -------------------------------------------------------


/** A new formation for a group's drones, sized for them and kept inside the airspace. */
function newStep(sub: ShowDoc, kind: ShapeKind, position: [number, number, number], opts: { shape?: ShapeSpec; name?: string } = {}): Scene {
  const base = newScene(sub, kind, { shape: opts.shape, name: opts.name, position })
  return { ...base, hold: 6 }
}

export { SPLIT_MODES, type SplitMode }

/**
 * Split a scene into groups that each fly their own formations after its
 * hold: by shape (spare drones stay), or the formation's drones in halves or
 * thirds. Each group starts with one formation of its own, fanned out from
 * where its drones are.
 */
export function splitScene(sceneId: string, mode?: SplitMode) {
  const s = getState()
  const { doc, groups } = splitSceneDoc(s.doc, sceneId, mode)
  if (!groups.length) return
  s.replaceDoc(tidySplit(doc, sceneId), 'Split into groups')
  const first = groups.find((x) => x.steps.length)?.steps[0]
  if (first) s.select({ kind: 'scene', id: first.id })
}

/** Merge a scene's groups back: remove them (their steps are deleted). */
export function unsplitScene(sceneId: string) {
  const { scene } = ctx(sceneId)
  if (!scene?.groups) return
  const { groups: _drop, ...rest } = scene
  void _drop
  put(sceneId, rest, 'Remove groups')
}

/** Add a formation to a group's own sequence (after `after`, or at the end). */
export function addGroupStep(groupId: string, kind: ShapeKind, opts: { shape?: ShapeSpec; name?: string; after?: number } = {}) {
  const s = getState()
  const f = findGroup(s.doc, groupId)
  if (!f) return undefined
  const n = groupSizes(f.parent, s.doc.droneCount)[f.index] ?? 0
  if (!n) return undefined
  const sub = { ...s.doc, droneCount: n }
  const at = opts.after !== undefined ? opts.after + 1 : f.group.steps.length
  const prev = f.group.steps[at - 1]
  const pos = prev ? [...prev.position] as [number, number, number] : [...f.parent.position] as [number, number, number]
  const step = newStep(sub, kind, pos, opts)
  s.update((d) => {
    const g = findGroup(d as ShowDoc, groupId)
    if (g) g.group.steps.splice(at, 0, step)
  }, `Add ${step.name} to ${f.group.name}`)
  s.select({ kind: 'scene', id: step.id })
  return step
}

export function updateGroup(groupId: string, recipe: (g: Draft<Group>) => void, label: string, key?: string) {
  getState().update((d) => {
    const f = findGroup(d as ShowDoc, groupId)
    if (f) recipe(f.group as Draft<Group>)
  }, label, key)
}

export function deleteGroup(groupId: string) {
  const s = getState()
  const f = findGroup(s.doc, groupId)
  if (!f) return
  s.update((d) => {
    const g = findGroup(d as ShowDoc, groupId)
    if (!g) return
    g.parent.groups!.splice(g.index, 1)
    if (!g.parent.groups!.length) delete g.parent.groups
  }, `Remove ${f.group.name}`)
  s.select({ kind: 'scene', id: f.parent.id })
}

// --- Light cues --------------------------------------------------------------------

export const CUE_PRESETS: { label: string; make: () => Omit<LightCue, 'id' | 'start'> }[] = [
  { label: 'Flash on every beat', make: () => ({ duration: 8, fadeIn: 0, fadeOut: 0.5, blend: 'add', effect: { ...(defaultEffect('flash') as Extract<Effect, { kind: 'flash' }>), every: 1 } }) },
  { label: 'Flash on every bar', make: () => ({ duration: 16, fadeIn: 0, fadeOut: 0.5, blend: 'add', effect: { ...(defaultEffect('flash') as Extract<Effect, { kind: 'flash' }>), every: 4, decay: 0.6 } }) },
  { label: 'Single white flash', make: () => ({ duration: 1.5, fadeIn: 0, fadeOut: 0, blend: 'add', effect: { ...(defaultEffect('flash') as Extract<Effect, { kind: 'flash' }>), beatSync: false, decay: 0.4 } }) },
  { label: 'Rainbow sweep', make: () => ({ duration: 6, fadeIn: 1, fadeOut: 1, blend: 'replace', effect: defaultEffect('rainbow') }) },
  { label: 'Gold shimmer', make: () => ({ duration: 6, fadeIn: 1, fadeOut: 1, blend: 'replace', effect: { kind: 'twinkle', a: '#a8620f', b: '#fff1c2', rate: 2, brightness: 1 } }) },
  { label: 'Colour wash', make: () => ({ duration: 4, fadeIn: 1, fadeOut: 1, blend: 'replace', effect: defaultEffect('solid', '#ff3d7f') }) },
  { label: 'Light sweep', make: () => ({ duration: 4, fadeIn: 0.3, fadeOut: 0.3, blend: 'add', effect: { kind: 'wave', a: '#000000', b: '#ffffff', angle: 0, speed: 0.35, width: 0.25, brightness: 1 } }) },
  { label: 'Strobe', make: () => ({ duration: 2, fadeIn: 0, fadeOut: 0, blend: 'replace', effect: defaultEffect('strobe') }) },
  { label: 'Blackout', make: () => ({ duration: 2, fadeIn: 0.5, fadeOut: 0.5, blend: 'replace', effect: defaultEffect('off') }) },
  { label: 'Flash on the music’s hits', make: () => ({ duration: 16, fadeIn: 0, fadeOut: 0.5, blend: 'add', effect: { ...(defaultEffect('flash') as Extract<Effect, { kind: 'flash' }>), onAccents: true, decay: 0.45 } }) },
  { label: 'Breathe with the music', make: () => ({ duration: 16, fadeIn: 1, fadeOut: 1, blend: 'multiply', effect: { kind: 'react', color: '#ffffff', floor: 0.3, brightness: 1 } }) },
  { label: 'Level meter', make: () => ({ duration: 8, fadeIn: 0.5, fadeOut: 0.5, blend: 'replace', effect: defaultEffect('meter') }) },
]

export function addCue(start: number, preset = 0) {
  const s = getState()
  const p = CUE_PRESETS[preset] ?? CUE_PRESETS[0]!
  const cue: LightCue = { id: newId('cue'), start: Math.max(0, start), ...p.make() }
  s.update((d) => { d.cues.push(cue as Draft<LightCue>) }, `Add ${p.label.toLowerCase()}`)
  s.select({ kind: 'cue', id: cue.id })
  return cue
}

export function updateCue(id: string, recipe: (q: Draft<LightCue>) => void, label = 'Edit light cue', key?: string) {
  getState().update((d) => {
    const q = d.cues.find((x) => x.id === id)
    if (q) recipe(q)
  }, label, key)
}

export function deleteCue(id: string) {
  const s = getState()
  s.update((d) => { d.cues = d.cues.filter((q) => q.id !== id) }, 'Delete light cue')
  s.select({ kind: 'show' })
}

export function duplicateCue(id: string) {
  const s = getState()
  const q = s.doc.cues.find((x) => x.id === id)
  if (!q) return
  const copy: LightCue = { ...JSON.parse(JSON.stringify(q)), id: newId('cue'), start: q.start + q.duration }
  s.update((d) => { d.cues.push(copy as Draft<LightCue>) }, 'Duplicate light cue')
  s.select({ kind: 'cue', id: copy.id })
}

export function setDroneCount(n: number) {
  const s = getState()
  const count = Math.max(1, Math.min(2000, Math.round(n)))
  if (count === s.doc.droneCount) return
  s.update((d: Draft<ShowDoc>) => { d.droneCount = count }, 'Drone count', 'droneCount')
}
