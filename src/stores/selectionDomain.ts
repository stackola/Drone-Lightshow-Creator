// ============================================================================
// Selection Domain — tiny arbiter over the app's coexisting selection
// systems (see docs/selection-domains.md). NOT a store merger: graph
// selection, point-edit selection, planes and audience keep their own
// stores; this stack just answers "which domain owns Escape / Delete / the
// gizmo right now". 'graph' is the permanent root.
// ============================================================================

import { create } from 'zustand'

export type SelectionDomain = 'graph' | 'points' | 'plane' | 'audience'

interface SelectionDomainState {
  /** Last entry is the active domain; index 0 is always 'graph'. */
  stack: SelectionDomain[]
  push: (d: SelectionDomain) => void
  /** Remove a specific domain wherever it sits (stores call this on exit). */
  remove: (d: SelectionDomain) => void
  /** Pop the active domain. Returns false when already at the root. */
  pop: () => boolean
}

export const useSelectionDomain = create<SelectionDomainState>((set, get) => ({
  stack: ['graph'],

  push(d) {
    set((s) => (s.stack[s.stack.length - 1] === d ? s : { stack: [...s.stack.filter((x) => x !== d), d] }))
  },

  remove(d) {
    if (d === 'graph') return
    set((s) => ({ stack: s.stack.filter((x) => x !== d) }))
  },

  pop() {
    const { stack } = get()
    if (stack.length <= 1) return false
    set({ stack: stack.slice(0, -1) })
    return true
  },
}))

/** The domain that currently owns Escape/Delete/gizmo focus. */
export function activeSelectionDomain(): SelectionDomain {
  const stack = useSelectionDomain.getState().stack
  return stack[stack.length - 1] ?? 'graph'
}
