// ============================================================================
// Drag-preview state — shared between the asset-panel drag source and the 3D
// drop ghost. `dataTransfer.getData` is unavailable during `dragover` (only on
// drop), so the dragged formation id is stashed here at drag-start. The live
// cursor is kept in a module ref (not Zustand) so per-move updates don't
// trigger React re-renders — the ghost reads it inside useFrame.
// ============================================================================

import { create } from 'zustand'

interface DragPreviewState {
  /** Formation being dragged from the asset panel, or null. Mounts/unmounts the ghost. */
  formationId: string | null
  setFormation: (id: string | null) => void
}

export const useDragPreviewStore = create<DragPreviewState>()((set) => ({
  formationId: null,
  setFormation(id) {
    set({ formationId: id })
  },
}))

let _cursorX = 0
let _cursorY = 0
let _hasCursor = false

export function setDragCursor(x: number, y: number): void {
  _cursorX = x
  _cursorY = y
  _hasCursor = true
}

export function clearDragCursor(): void {
  _hasCursor = false
}

export function peekDragCursor(): { x: number; y: number } | null {
  return _hasCursor ? { x: _cursorX, y: _cursorY } : null
}

/** Call on drag-start (with the formation id) and drag-end (with null) from the source. */
export function beginFormationDrag(id: string): void {
  useDragPreviewStore.getState().setFormation(id)
}

export function endFormationDrag(): void {
  useDragPreviewStore.getState().setFormation(null)
  clearDragCursor()
}
