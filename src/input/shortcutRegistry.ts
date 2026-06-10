// ============================================================================
// Shortcut Registry — one declarative, mode-aware home for keyboard input.
//
// Why: shortcuts grew across three window listeners (App.tsx globals,
// useCanvasKeyboard, GizmoKeyboardShortcuts) with collisions (Ctrl+G) and
// mode-blindness (W/E/R double-handled). The registry gives every binding a
// scope, resolves precedence in ONE place, detects conflicts in dev, and
// feeds KeyboardShortcutsOverlay so the docs can never drift from reality.
//
// Scopes & precedence (highest wins, first match handles the key):
//   point-edit  — active while the point editor is open
//   graph       — active in Graph mode
//   viewport    — active in Build mode (3D stage focused contexts)
//   global      — always active
// A binding may also pass `when()` for ad-hoc guards.
//
// Chords: 'ctrl+shift+z', 'delete', 'arrowleft', single keys 'w', and
// double-tap chords like 'g g' (two taps within 400 ms).
// ============================================================================

export type ShortcutScope = 'point-edit' | 'graph' | 'viewport' | 'global'

export interface ShortcutDef {
  id: string
  /** Normalized form: [ctrl+][alt+][shift+]key, or 'x x' for double-tap. */
  chord: string
  scope: ShortcutScope
  /** Human label for the shortcuts overlay. */
  label: string
  /** Overlay grouping (e.g. 'Editing', 'Camera', 'Playback'). */
  category: string
  /** Extra guard evaluated at dispatch time. */
  when?: () => boolean
  action: (e: KeyboardEvent) => void
  /** Fire even when an input/textarea is focused (rare; default false). */
  allowInInputs?: boolean
}

const SCOPE_ORDER: ShortcutScope[] = ['point-edit', 'graph', 'viewport', 'global']
const DOUBLE_TAP_MS = 400

const defs = new Map<string, ShortcutDef>()
let lastTap: { key: string; time: number } | null = null

/** Host-provided answer to "which scopes are currently active?". */
let scopeResolver: () => ShortcutScope[] = () => ['global']

export function setScopeResolver(fn: () => ShortcutScope[]): void {
  scopeResolver = fn
}

export function normalizeChord(e: KeyboardEvent): string {
  const key = e.key === ' ' ? 'space' : e.key.toLowerCase()
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  // Shift is a meaningful modifier for letters and named keys; for symbol
  // keys ('?', '+') the symbol itself already encodes the shift.
  if (e.shiftKey && (/^[a-z]$/.test(key) || key.length > 1)) parts.push('shift')
  parts.push(key)
  return parts.join('+')
}

/** Register a shortcut; returns an unregister function. Dev builds warn on
 * chord collisions within the same scope. */
export function registerShortcut(def: ShortcutDef): () => void {
  if (import.meta.env?.DEV) {
    for (const existing of defs.values()) {
      if (existing.chord === def.chord && existing.scope === def.scope && existing.id !== def.id) {
        // eslint-disable-next-line no-console
        console.warn(
          `[shortcuts] chord conflict: "${def.chord}" in scope "${def.scope}" bound by both "${existing.id}" and "${def.id}"`,
        )
      }
    }
  }
  defs.set(def.id, def)
  return () => {
    defs.delete(def.id)
  }
}

/** All registered shortcuts — the overlay renders from this. */
export function listShortcuts(): ShortcutDef[] {
  return [...defs.values()]
}

function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/** The single keydown dispatcher. Returns true when a binding handled it. */
export function dispatchKey(e: KeyboardEvent): boolean {
  const typing = isTypingTarget(e)
  const chord = normalizeChord(e)

  // Double-tap chords: a bare key may complete an 'x x' binding.
  let doubleTapChord: string | null = null
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    const now = performance.now()
    if (lastTap && lastTap.key === chord && now - lastTap.time < DOUBLE_TAP_MS) {
      doubleTapChord = `${chord} ${chord}`
      lastTap = null
    } else {
      lastTap = { key: chord, time: now }
    }
  }

  const activeScopes = scopeResolver()
  for (const scope of SCOPE_ORDER) {
    if (!activeScopes.includes(scope)) continue
    for (const def of defs.values()) {
      if (def.scope !== scope) continue
      if (def.chord !== chord && def.chord !== doubleTapChord) continue
      if (typing && !def.allowInInputs) continue
      if (def.when && !def.when()) continue
      def.action(e)
      return true
    }
  }
  return false
}

/** Install the global listener. Call once from the app shell. */
export function installShortcutListener(): () => void {
  const handler = (e: KeyboardEvent) => {
    dispatchKey(e)
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}
