import type { Draft } from 'immer'
import type { Effect, LightCue, Scene, ShapeKind, ShapeSpec, ShowDoc } from '@/core/types'
import { fitScene, fitToAirspace, newId, newLayer, newScene, newShape } from '@/core/defaults'
import { comfortableSpacing, type FixAction, type Issue } from '@/core/validate'
import { applyFixToDoc, autoFix } from '@/core/fixes'
import { defaultEffect } from '@/core/effects'
import { getState } from './store'
import { seek } from './playback'
import { SHAPE_BY_KIND } from '@/core/shapes'

export function addScene(kind: ShapeKind, opts: { shape?: ShapeSpec; name?: string } = {}) {
  const s = getState()
  const sel = s.selection
  const idx = sel.kind === 'scene' || sel.kind === 'flight' ? s.doc.scenes.findIndex((x) => x.id === sel.id) : -1
  const after = idx >= 0 ? s.doc.scenes[idx] : s.doc.scenes[s.doc.scenes.length - 1]
  const scene = newScene(s.doc, kind, { shape: opts.shape, name: opts.name, position: after ? [...after.position] : undefined })
  const at = idx >= 0 ? idx + 1 : s.doc.scenes.length
  s.update((d) => { d.scenes.splice(at, 0, scene as Draft<Scene>) }, `Add ${scene.name}`)
  s.select({ kind: 'scene', id: scene.id })
  return scene
}

export function duplicateScene(id: string) {
  const s = getState()
  const i = s.doc.scenes.findIndex((x) => x.id === id)
  if (i < 0) return
  const src = s.doc.scenes[i]!
  const copy: Scene = JSON.parse(JSON.stringify(src))
  copy.id = newId('scene')
  copy.name = `${src.name} copy`
  copy.layers.forEach((l) => (l.id = newId('layer')))
  s.update((d) => { d.scenes.splice(i + 1, 0, copy as Draft<Scene>) }, 'Duplicate scene')
  s.select({ kind: 'scene', id: copy.id })
}

export function deleteScene(id: string) {
  const s = getState()
  const i = s.doc.scenes.findIndex((x) => x.id === id)
  if (i < 0) return
  const name = s.doc.scenes[i]!.name
  s.update((d) => { d.scenes.splice(i, 1) }, `Delete ${name}`)
  const next = s.doc.scenes[i + 1] ?? s.doc.scenes[i - 1]
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
    const sc = d.scenes.find((x) => x.id === id)
    if (sc) recipe(sc)
  }, label, key)
}

/** Replace a layer's shape, keeping safe spacing and the floor clearance. */
export function setLayerShape(sceneId: string, layerId: string, shape: ShapeSpec, label = 'Change shape') {
  const s = getState()
  const scene = s.doc.scenes.find((x) => x.id === sceneId)
  if (!scene) return
  const draft: Scene = { ...scene, layers: scene.layers.map((l) => (l.id === layerId ? { ...l, shape } : l)) }
  const fitted = fitToAirspace(fitScene(draft, s.doc.droneCount, comfortableSpacing(s.doc.limits.minSpacing), 'grow'), s.doc)
  s.update((d) => {
    const i = d.scenes.findIndex((x) => x.id === sceneId)
    if (i >= 0) d.scenes[i] = fitted as Draft<Scene>
  }, label)
}

export function changeLayerKind(sceneId: string, layerId: string, kind: ShapeKind) {
  const s = getState()
  const scene = s.doc.scenes.find((x) => x.id === sceneId)
  const layer = scene?.layers.find((l) => l.id === layerId)
  if (!scene || !layer || layer.shape.kind === kind) return
  const next = newShape(kind)
  const s2: Scene = { ...scene, layers: scene.layers.map((l) => (l.id === layerId ? { ...l, shape: next } : l)) }
  const fitted = fitToAirspace(fitScene(s2, s.doc.droneCount, comfortableSpacing(s.doc.limits.minSpacing), 'exact'), s.doc)
  s.update((d) => {
    const i = d.scenes.findIndex((x) => x.id === sceneId)
    if (i < 0) return
    d.scenes[i] = fitted as Draft<Scene>
    if (scene.layers.length === 1 && scene.name === SHAPE_BY_KIND[layer.shape.kind].label) d.scenes[i]!.name = SHAPE_BY_KIND[kind].label
  }, `Change to ${SHAPE_BY_KIND[kind].label}`)
}

export function addLayer(sceneId: string, kind: ShapeKind | 'spare') {
  const s = getState()
  const scene = s.doc.scenes.find((x) => x.id === sceneId)
  if (!scene) return
  const spare = kind === 'spare'
  const layer = newLayer(newShape(spare ? 'grid' : kind), spare ? defaultEffect('off') : defaultEffect('solid', '#ffffff'))
  if (spare) {
    layer.offset = [0, 0, -25]
    layer.weight = 0.3
  }
  const s2: Scene = { ...scene, layers: [...scene.layers, layer] }
  const fitted = fitToAirspace(fitScene(s2, s.doc.droneCount, comfortableSpacing(s.doc.limits.minSpacing), 'grow'), s.doc)
  s.update((d) => {
    const i = d.scenes.findIndex((x) => x.id === sceneId)
    if (i >= 0) d.scenes[i] = fitted as Draft<Scene>
  }, spare ? 'Park spare drones' : 'Add shape')
}

export function removeLayer(sceneId: string, layerId: string) {
  updateScene(sceneId, (sc) => {
    if (sc.layers.length > 1) sc.layers = sc.layers.filter((l) => l.id !== layerId)
  }, 'Remove shape')
}

/** Set one layer's drone count; the other layers share the remainder in proportion. */
export function setLayerCount(sceneId: string, layerId: string, count: number, counts: number[]) {
  const s = getState()
  const n = s.doc.droneCount
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
  const s = getState()
  const scene = s.doc.scenes.find((x) => x.id === sceneId)
  if (!scene) return
  const t = target ?? comfortableSpacing(s.doc.limits.minSpacing)
  const fitted = fitToAirspace(fitScene(scene, s.doc.droneCount, t, mode), s.doc)
  s.update((d) => {
    const i = d.scenes.findIndex((x) => x.id === sceneId)
    if (i >= 0) d.scenes[i] = fitted as Draft<Scene>
  }, 'Fit to safe spacing')
}

export function applyFix(action: FixAction) {
  const s = getState()
  const labels: Record<FixAction['kind'], string> = { 'fit-spacing': 'Fit to safe spacing', 'set-spin': 'Slow spin', move: 'Move scene', 'grid-spacing': 'Pad spacing', 'fit-airspace': 'Shrink to fit airspace', 'calm-hold': 'Calm hold motion' }
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

// --- Navigation ----------------------------------------------------------------------

export function seekToScene(id: string) {
  const c = getState().compiled
  const t = c?.sceneTimes.find((x) => x.id === id)
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
