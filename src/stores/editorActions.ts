// ============================================================================
// editorActions — selection-scoped edit operations shared by the keyboard
// shortcuts (useCanvasKeyboard) and the canvas / 3D-viewport context menus,
// so "Delete" and "Duplicate" mean exactly the same thing on every surface.
// All actions snapshot history with a semantic label.
// ============================================================================

import { useGraphStore } from './graphStore'
import { useSelectionStore } from './selectionStore'
import { useHistoryStore } from './historyStore'
import { activeSelectionDomain } from './selectionDomain'
import { toast } from '../components/Toast'

/** Delete the selected nodes/edges (launch + land are protected). */
export function deleteSelected(opts: { confirm?: boolean } = {}): void {
  // While point-editing, Delete must not nuke the formation node out from
  // under the user (the graph selection is still the formation).
  if (activeSelectionDomain() === 'points') {
    toast.info('Exit point edit (Esc) to delete the formation', { duration: 2000 })
    return
  }
  const { selectedNodeIds, selectedEdgeIds, setSelection } = useSelectionStore.getState()
  const totalCount = selectedNodeIds.length + selectedEdgeIds.length
  if (totalCount === 0) return
  if ((opts.confirm ?? true) && !window.confirm(`Delete ${totalCount} item(s)?`)) return
  const { nodes, removeNode, removeEdge } = useGraphStore.getState()
  useHistoryStore.getState().snapshot(`Delete ${totalCount} item${totalCount === 1 ? '' : 's'}`)
  for (const id of selectedNodeIds) {
    const node = nodes.find((n) => n.id === id)
    if (node && (node.type === 'launch' || node.type === 'land')) continue
    removeNode(id)
  }
  for (const id of selectedEdgeIds) removeEdge(id)
  setSelection([], [])
}

/** Duplicate the selected nodes at a slight canvas offset; selects the clones. */
export function duplicateSelected(): void {
  const { selectedNodeIds, setSelection } = useSelectionStore.getState()
  if (selectedNodeIds.length === 0) return
  const { nodes, addNode } = useGraphStore.getState()
  useHistoryStore.getState().snapshot(`Duplicate ${selectedNodeIds.length} node${selectedNodeIds.length === 1 ? '' : 's'}`)
  const newIds: string[] = []
  for (const id of selectedNodeIds) {
    const node = nodes.find((n) => n.id === id)
    if (!node) continue
    const clonedData = JSON.parse(JSON.stringify(node.data))
    // Regenerate nested IDs to avoid collisions
    if (clonedData.idleConfigs) {
      for (const cfg of clonedData.idleConfigs) {
        if (cfg.id) cfg.id = `idle-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      }
    }
    const newId = addNode(
      node.type,
      { x: node.position.x + 50, y: node.position.y + 50 },
      clonedData,
    )
    newIds.push(newId)
  }
  setSelection(newIds, [])
}

/** Toggle lock on selected formation/idle nodes (flips toward the majority). */
export function toggleLockSelected(): void {
  const { selectedNodeIds } = useSelectionStore.getState()
  if (selectedNodeIds.length === 0) return
  const { nodes, updateNodeData } = useGraphStore.getState()
  const targets = selectedNodeIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => n != null && (n.type === 'formation' || n.type === 'idle'))
  if (targets.length === 0) return
  const lockCount = targets.filter((n) => (n.data as { locked?: boolean }).locked).length
  const nextLocked = lockCount < targets.length / 2
  useHistoryStore.getState().snapshot(`${nextLocked ? 'Lock' : 'Unlock'} ${targets.length} node${targets.length === 1 ? '' : 's'}`)
  for (const n of targets) updateNodeData(n.id, { locked: nextLocked } as Partial<typeof n.data>)
  toast.info(`${nextLocked ? 'Locked' : 'Unlocked'} ${targets.length} node${targets.length === 1 ? '' : 's'}`, { duration: 2000 })
}
