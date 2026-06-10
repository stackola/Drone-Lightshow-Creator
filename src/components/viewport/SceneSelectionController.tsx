// ============================================================================
// Scene Selection Controller — click/hover a drone in 3D to select/hover its
// owning FORMATION (today only point-edit consumed drone clicks; formations
// were graph-panel-only). Maps the existing drone-click / drone-hover window
// events through the evaluator's per-drone owner map. Renders nothing.
//
// Yields to point-edit mode (which owns drone clicks for per-point selection)
// and only acts on formation owners. Hover sets selectionStore.hoveredNode,
// which HoverBoundingBox already visualises.
// ============================================================================

import { useEffect } from 'react'
import { useSelectionStore } from '../../stores/selectionStore'
import { usePointEditorStore } from './PointEditor'
import { useGraphStore } from '../../stores/graphStore'
import { peekDroneOwners } from '../../stores/evaluationStore'

function formationOwnerOf(droneIndex: number | undefined): string | null {
  if (droneIndex == null || droneIndex < 0) return null
  const nodeId = peekDroneOwners()?.[droneIndex] ?? null
  if (!nodeId) return null
  return useGraphStore.getState().getNode(nodeId)?.type === 'formation' ? nodeId : null
}

export function SceneSelectionController() {
  useEffect(() => {
    // Double-click detection: two clicks on the same formation within 350ms
    // enter point-edit mode — the Figma "drill into the object" gesture.
    let lastClick = { nodeId: null as string | null, time: 0 }
    const onClick = (e: Event) => {
      if (usePointEditorStore.getState().isActive) return
      const detail = (e as CustomEvent<{ droneIndex?: number; shiftKey?: boolean }>).detail
      const nodeId = formationOwnerOf(detail?.droneIndex)
      if (!nodeId) return
      const now = performance.now()
      if (!detail?.shiftKey && lastClick.nodeId === nodeId && now - lastClick.time < 350) {
        // Point editor keys off the formation DEF id, not the node id.
        const node = useGraphStore.getState().getNode(nodeId)
        const defId = (node?.data as { formationId?: string | null } | undefined)?.formationId
        if (defId) usePointEditorStore.getState().enterEditMode(defId)
        lastClick = { nodeId: null, time: 0 }
        return
      }
      lastClick = { nodeId, time: now }
      useSelectionStore.getState().selectNode(nodeId, !!detail?.shiftKey)
    }
    const onHover = (e: Event) => {
      if (usePointEditorStore.getState().isActive) return
      const detail = (e as CustomEvent<{ droneIndex?: number }>).detail
      useSelectionStore.getState().setHoveredNode(formationOwnerOf(detail?.droneIndex))
    }
    window.addEventListener('drone-click', onClick)
    window.addEventListener('drone-hover', onHover)
    return () => {
      window.removeEventListener('drone-click', onClick)
      window.removeEventListener('drone-hover', onHover)
    }
  }, [])
  return null
}
