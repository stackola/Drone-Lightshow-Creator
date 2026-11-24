// Pure document transforms used by the editor's "Fix" buttons and by AI features.

import type { Scene, ShowDoc } from './types'
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

/** Scale spin and hold motion down together (rounded toward calmer). */
export function calmHold(s: Scene, factor: number): Scene {
  const f = Math.max(0, Math.min(1, factor))
  const spin = Math.trunc(s.spin * f * 10) / 10
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
