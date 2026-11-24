// Pure document transforms used by the editor's "Fix" buttons and by AI features.

import type { Scene, ShowDoc } from './types'
import { compile } from './compile'
import { comfortableSpacing, validate, type FixAction, type Validation } from './validate'
import { fitScene, fitToAirspace, placeAboveFloor } from './defaults'

function replaceScene(doc: ShowDoc, id: string, f: (s: Scene) => Scene): ShowDoc {
  return { ...doc, scenes: doc.scenes.map((s) => (s.id === id ? f(s) : s)) }
}

export function applyFixToDoc(doc: ShowDoc, action: FixAction): ShowDoc {
  switch (action.kind) {
    case 'fit-spacing':
      return replaceScene(doc, action.sceneId, (s) => placeAboveFloor(fitScene(s, doc.droneCount, action.target, 'grow'), doc))
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
      return replaceScene(doc, action.sceneId, (s) => fitToAirspace(s, doc))
    case 'calm-hold':
      return replaceScene(doc, action.sceneId, (s) => calmHold(s, action.factor))
    case 'flight-style':
      if (action.sceneId === null) return { ...doc, site: { ...doc.site, returnFlight: { ...doc.site.returnFlight, style: undefined } } }
      return replaceScene(doc, action.sceneId, (s) => ({ ...s, flight: { ...s.flight, style: undefined } }))
  }
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
