// ============================================================================
// Selection Store
// ============================================================================

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export type SelectionType = 'node' | 'edge' | 'mixed' | 'none'

export interface SelectionStoreState {
  selectedNodeIds: string[]
  selectedEdgeIds: string[]
  selectionType: SelectionType
  /** B-09 / F-class polish: independently of selection, which node is the
   *  cursor hovering over right now? Lets hover-state visuals (yellow bbox,
   *  card glow) react without changing the current selection. Null when not
   *  hovering anything. */
  hoveredNodeId: string | null

  selectNode: (id: string, additive?: boolean) => void
  selectEdge: (id: string, additive?: boolean) => void
  selectNodes: (ids: string[]) => void
  clearSelection: () => void
  setSelection: (nodeIds: string[], edgeIds: string[]) => void
  setHoveredNode: (id: string | null) => void
}

function deriveType(nodeIds: string[], edgeIds: string[]): SelectionType {
  if (nodeIds.length === 0 && edgeIds.length === 0) return 'none'
  if (nodeIds.length > 0 && edgeIds.length > 0) return 'mixed'
  if (nodeIds.length > 0) return 'node'
  return 'edge'
}

export const useSelectionStore = create<SelectionStoreState>()(
  immer((set) => ({
    selectedNodeIds: [],
    selectedEdgeIds: [],
    selectionType: 'none' as SelectionType,
    hoveredNodeId: null as string | null,

    selectNode(id, additive = false) {
      set((state) => {
        if (additive) {
          state.selectedEdgeIds = [] // Clear edges when adding nodes
          const idx = state.selectedNodeIds.indexOf(id)
          if (idx >= 0) {
            state.selectedNodeIds.splice(idx, 1)
          } else {
            state.selectedNodeIds.push(id)
          }
        } else {
          state.selectedNodeIds = [id]
          state.selectedEdgeIds = []
        }
        state.selectionType = deriveType(state.selectedNodeIds, state.selectedEdgeIds)
      })
    },

    selectEdge(id, additive = false) {
      set((state) => {
        if (additive) {
          state.selectedNodeIds = [] // Clear nodes when adding edges
          const idx = state.selectedEdgeIds.indexOf(id)
          if (idx >= 0) {
            state.selectedEdgeIds.splice(idx, 1)
          } else {
            state.selectedEdgeIds.push(id)
          }
        } else {
          state.selectedNodeIds = []
          state.selectedEdgeIds = [id]
        }
        state.selectionType = deriveType(state.selectedNodeIds, state.selectedEdgeIds)
      })
    },

    selectNodes(ids) {
      set((state) => {
        state.selectedNodeIds = ids
        state.selectedEdgeIds = []
        state.selectionType = deriveType(ids, [])
      })
    },

    clearSelection() {
      set((state) => {
        state.selectedNodeIds = []
        state.selectedEdgeIds = []
        state.selectionType = 'none'
      })
    },

    setSelection(nodeIds, edgeIds) {
      set((state) => {
        state.selectedNodeIds = nodeIds
        state.selectedEdgeIds = edgeIds
        state.selectionType = deriveType(nodeIds, edgeIds)
      })
    },

    setHoveredNode(id) {
      set((state) => {
        state.hoveredNodeId = id
      })
    },
  })),
)
