// Pure document transforms used by the editor's "Fix" buttons and by AI features.

import { scaleJoints, slowJoints } from './joints'
import type { Scene, ShowDoc, Vec3 } from './types'
import { scaleKeys } from './keys'
import { compile } from './compile'
import { comfortableSpacing, validate, type FixAction, type Validation } from './validate'
import { fitScene, fitToAirspace, placeAboveFloor } from './defaults'
import { fitRolesToAirspace } from './idle'
import { mapScene } from './groups'
import { separateGroups } from './splits'

/** Apply `f` to a scene or group step; `sub` is the document as that scene sees it (its own drone count). */
function replaceScene(doc: ShowDoc, id: string, f: (s: Scene, sub: ShowDoc) => Scene): ShowDoc {
  return mapScene(doc, id, (s, n) => f(s, n === doc.droneCount ? doc : { ...doc, droneCount: n }))
}

export function applyFixToDoc(doc: ShowDoc, action: FixAction): ShowDoc {
  switch (action.kind) {
    case 'fit-spacing':
      return replaceScene(doc, action.sceneId, (s, sub) => placeAboveFloor(fitScene(s, sub.droneCount, action.target, 'grow'), sub))
    case 'set-spin':
      return replaceScene(doc, action.sceneId, (s) => ({ ...s, spin: action.value }))
    case 'move':
      return replaceScene(doc, action.sceneId, (s) => ({
        ...s,
        position: [s.position[0] + action.delta[0], s.position[1] + action.delta[1], s.position[2] + action.delta[2]],
      }))
    case 'grid-spacing':
      return { ...doc, site: { ...doc.site, gridSpacing: action.value } }
    case 'fit-airspace':
      // Scenes with supporting roles shrink by giving drones to their roles; others park spares.
      return replaceScene(doc, action.sceneId, (s, sub) => (s.layers.some((l) => l.role && l.role !== 'park') ? fitRolesToAirspace(s, sub) : fitToAirspace(s, sub)))
    case 'calm-hold':
      return replaceScene(doc, action.sceneId, (s) => calmHold(s, action.factor))
    case 'calm-parts':
      return replaceScene(doc, action.sceneId, (s) => scaleJoints(s, action.factor))
    case 'slow-parts':
      return replaceScene(doc, action.sceneId, (s) => slowJoints(s, action.factor))
    case 'separate-groups':
      return separateGroups(doc, action.sceneId)
    case 'flight-style':
      if (action.sceneId === null) return { ...doc, site: { ...doc.site, returnFlight: { ...doc.site.returnFlight, style: undefined } } }
      return replaceScene(doc, action.sceneId, (s) => ({ ...s, flight: { ...s.flight, style: undefined } }))
  }
}

/**
 * After a split: apply the automatic fixes for the split's own issues (its
 * group formations, and groups passing too close), leaving the rest of the
 * show untouched.
 */
export function tidySplit(doc: ShowDoc, sceneId: string): ShowDoc {
  for (let pass = 0; pass < 3; pass++) {
    const scene = doc.scenes.find((s) => s.id === sceneId)
    const ids = new Set([sceneId, ...(scene?.groups ?? []).flatMap((g) => g.steps.map((st) => st.id))])
    const v = validate(doc, compile(doc))
    const mine = v.issues.filter((i) => i.fix && i.sceneId && ids.has(i.sceneId) && (i.sceneId !== sceneId || i.fix.action.kind === 'separate-groups'))
    if (!mine.length) break
    const seen = new Set<string>()
    for (const i of mine) {
      const key = (i.fix!.action as { sceneId?: string }).sceneId ?? ''
      if (seen.has(key)) continue
      seen.add(key)
      doc = applyFixToDoc(doc, i.fix!.action)
    }
  }
  return doc
}

/** Scale spin, hold motion and keyframes down together (rounded toward calmer). */
export function calmHold(s: Scene, factor: number): Scene {
  const f = Math.max(0, Math.min(1, factor))
  const spin = Math.trunc(s.spin * f * 10) / 10
  s = scaleJoints(s, f)
  if (s.keys?.length) s = { ...s, keys: scaleKeys(s.keys, f).map((k) => ({ ...k, move: k.move.map((v) => Math.round(v * 10) / 10) as Vec3, rotate: k.rotate.map((v) => Math.round(v * 10) / 10) as Vec3, scale: Math.round(k.scale * 1000) / 1000 })) }
  if (!s.motion || s.motion.kind === 'none') return { ...s, spin }
  const step = s.motion.kind === 'breathe' ? 100 : 10
  return { ...s, spin, motion: { ...s.motion, amount: Math.floor(s.motion.amount * f * step) / step } }
}

/**
 * Apply every automatic fix until the show is clean or nothing more can be
 * fixed automatically. Returns the fixed document and its final validation.
 */
export function autoFix(doc: ShowDoc, maxPasses = 4): { doc: ShowDoc; validation: Validation; applied: number } {
  let applied = 0
  let validation = validate(doc, compile(doc))
  for (let pass = 0; pass < maxPasses; pass++) {
    const fixes = validation.issues.filter((i) => i.fix)
    if (!fixes.length) break
    // One fix per scene per pass: later fixes may be obsolete after the first.
    const seen = new Set<string>()
    for (const issue of fixes) {
      const key = issue.fix!.action.kind === 'grid-spacing' ? 'pads' : (issue.fix!.action as { sceneId: string | null }).sceneId ?? 'return'
      if (seen.has(key)) continue
      seen.add(key)
      doc = applyFixToDoc(doc, issue.fix!.action)
      applied++
    }
    validation = validate(doc, compile(doc))
  }
  return { doc, validation, applied }
}

export { comfortableSpacing }

/**
 * Make a formation's moving parts safe on their own: slow, calm or enlarge
 * (whatever the validator suggests for its parts) until its hold is clean.
 * Used when parts come from a preset or the AI, so they start out flyable.
 */
export function settleParts(scene: Scene, doc: ShowDoc, opts: { prefer?: 'slow' | 'calm'; passes?: number } = {}): Scene {
  const kinds = new Set<FixAction['kind']>(['slow-parts', 'calm-parts', 'calm-hold'])
  let cur = scene
  for (let pass = 0; pass < (opts.passes ?? 6); pass++) {
    const sub: ShowDoc = { ...doc, scenes: [cur], cues: [] }
    const v = validate(sub, compile(sub))
    const issue = v.issues.find((i) => i.sceneId === cur.id && i.fix && (kinds.has(i.fix.action.kind) || i.id.startsWith('parts:')))
    if (!issue) return cur
    let action = issue.fix!.action
    // Keep the beat, swing less: speed goes with swing ÷ beat, so 1/k of the swing matches k× slower.
    if (opts.prefer === 'calm' && action.kind === 'slow-parts') action = { kind: 'calm-parts', sceneId: action.sceneId, factor: Math.floor((100 * 0.97) / action.factor) / 100 }
    cur = applyFixToDoc(sub, action).scenes[0]!
  }
  return cur
}
