// ============================================================================
// Audience Edit Store — transient UI state for editing from the audience POV.
// Kept separate from viewStore.audience (presentation state) so toggling edit
// mode never touches the persisted presentation config. Presentation is the
// default; editing is a pure additive toggle.
// ============================================================================

import { create } from 'zustand'
import { useSelectionDomain } from './selectionDomain'

/** Placement surface: onto the active build plane, or a camera-facing ghost plane. */
export type AudienceSurface = 'plane' | 'free'

export interface AudienceEditState {
  editing: boolean
  surface: AudienceSurface
  /** Depth (m from camera) of the ghost plane used in 'free' placement. */
  placementDepth: number
  /** True while a placement drag is in flight — freezes the audience camera. */
  isPlacing: boolean

  toggleEditing: () => void
  setSurface: (s: AudienceSurface) => void
  setPlacementDepth: (d: number) => void
  setIsPlacing: (p: boolean) => void
}

export const useAudienceEditStore = create<AudienceEditState>()((set) => ({
  editing: false,
  surface: 'plane',
  placementDepth: 40,
  isPlacing: false,

  toggleEditing() {
    set((s) => {
      const editing = !s.editing
      if (editing) useSelectionDomain.getState().push('audience')
      else useSelectionDomain.getState().remove('audience')
      return { editing }
    })
  },
  setSurface(s) {
    set({ surface: s })
  },
  setPlacementDepth(d) {
    set({ placementDepth: Math.max(1, d) })
  },
  setIsPlacing(p) {
    set({ isPlacing: p })
  },
}))
