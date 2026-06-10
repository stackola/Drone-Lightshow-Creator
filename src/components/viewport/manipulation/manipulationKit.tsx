// ============================================================================
// Manipulation Kit — one shared vocabulary for every draggable in the 3D stage.
// Fixes the audit's "everything looks unpressable / no Esc hint / hidden
// modifiers" by centralising: grab/grabbing cursors, a transient modifier-hint
// HUD shown during a drag, and the accent palette handles draw from.
// ============================================================================

import { create } from 'zustand'
import { ACCENT_PRIMARY, ACCENT_HIGHLIGHT } from '../../../ui/colors'

// --- Shared accent palette (design-token aligned; no per-file hex drift) ---
export const MANIP = {
  /** Primary draggable accent (radius / generic). */
  accent: ACCENT_PRIMARY,
  /** Position / center handles. */
  position: ACCENT_HIGHLIGHT,
  /** Direction / vector handles. */
  direction: '#a78bfa',
  /** Hover / active highlight. */
  hot: '#ffffff',
} as const

// --- Cursor helpers -------------------------------------------------------
let _cursorOwners = 0
export function pushGrabCursor(): void {
  _cursorOwners++
  if (document?.body) document.body.style.cursor = 'grab'
}
export function setGrabbingCursor(): void {
  if (document?.body) document.body.style.cursor = 'grabbing'
}
export function popGrabCursor(): void {
  _cursorOwners = Math.max(0, _cursorOwners - 1)
  if (document?.body && _cursorOwners === 0) document.body.style.cursor = ''
}

// --- Modifier-hint HUD ----------------------------------------------------
interface ManipHintState {
  hint: string | null
  setHint: (h: string | null) => void
}

export const useManipHintStore = create<ManipHintState>()((set) => ({
  hint: null,
  setHint: (hint) => set({ hint }),
}))

/** Call on drag-start with a hint string; call again with null on drag-end. */
export function beginManip(hint: string): void {
  setGrabbingCursor()
  useManipHintStore.getState().setHint(hint)
}
export function endManip(): void {
  useManipHintStore.getState().setHint(null)
  if (document?.body) document.body.style.cursor = ''
}

/** Standard modifier hints reused across handles. */
export const HINT = {
  radius: 'Drag to resize · Shift: snap · Esc: cancel',
  center: 'Drag to move · Shift: snap · Ctrl: ground · Alt: vertical · Esc: cancel',
  direction: 'Drag to aim · Shift: 45° · Esc: cancel',
  gizmo: 'Drag to transform · Esc: cancel',
} as const

/** DOM overlay (mount in the viewport HUD, outside the Canvas). */
export function ManipulationHint() {
  const hint = useManipHintStore((s) => s.hint)
  if (!hint) return null
  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
      <div className="floating-panel animate-panel-in px-3 py-1 text-caption text-white/75 whitespace-nowrap">{hint}</div>
    </div>
  )
}
